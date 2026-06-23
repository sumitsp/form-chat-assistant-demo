from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from openai import OpenAI
from qdrant_client import QdrantClient, models
from sqlalchemy import create_engine, text

import config
from chatbot_retrieval.chat_guard import CONTACT_REPRESENTATIVE_REPLY, deflection_reply_if_needed
from chatbot_retrieval.embeddings import embed_query, warmup_embeddings
from chatbot_retrieval.general_chat import chat_once_selected_program

_client: QdrantClient | None = None
_program_map: dict[str, str] | None = None
_meta_client: QdrantClient | None = None
_sql_engine = None


def get_qdrant_client() -> QdrantClient:
    global _client
    if _client is None:
        _client = QdrantClient(url=config.QDRANT_URL, prefer_grpc=False, timeout=120)
    return _client


def get_engine() -> QdrantClient:
    """Warm up Qdrant + embedding backend (OpenAI 1536-dim by default)."""
    warmup_embeddings()
    return get_qdrant_client()


def get_meta_client() -> QdrantClient:
    """
    Separate Qdrant client for fast metadata calls (e.g., list collections).
    Uses a shorter timeout so /api/health stays responsive.
    """
    global _meta_client
    if _meta_client is None:
        _meta_client = QdrantClient(url=config.QDRANT_URL, prefer_grpc=False, timeout=10)
    return _meta_client


def _get_sql_engine():
    global _sql_engine
    if _sql_engine is None:
        _sql_engine = create_engine(config.mysql_url(), pool_pre_ping=True)
    return _sql_engine


def get_program_map() -> dict[str, str]:
    """
    Fixed mapping for lender-level guideline collections.
    """
    global _program_map
    if _program_map is None:
        _program_map = dict(config.PROGRAM_DISPLAY_NAMES)
    return _program_map


def detect_program_key(question: str) -> str | None:
    """
    If the user clearly mentions a single program, return its program_key.
    Matches on folder name tokens and on the slug form.
    """
    q = question.lower()
    brand_aliases: list[tuple[str, str]] = [
        ("denali", "nqm"),
        ("nqm funding", "nqm"),
        ("deephaven", "everest"),
        ("everest", "everest"),
        ("summit", "versus"),
        ("verus", "versus"),
    ]
    brand_hits = sorted({key for token, key in brand_aliases if token in q})
    if len(brand_hits) == 1:
        return brand_hits[0]

    hits: list[str] = []
    for key, name in get_program_map().items():
        if not key:
            continue
        if key in q:
            hits.append(key)
            continue
        lender_code = (config.lender_code_from_key(key) or "").lower()
        if lender_code and lender_code in q:
            hits.append(key)
            continue
        # handle common summit spelling variant in user prompts
        if key == "versus" and ("verus" in q or "summit" in q or "versus" in q):
            hits.append(key)
            continue
        # Loose match: any of the significant tokens from program name
        tokens = [t for t in re.findall(r"[a-z0-9]{3,}", name.lower()) if t not in {"loan", "matrix", "guideline"}]
        if tokens and all(tok in q for tok in tokens[:2]):  # require at least 2 tokens if present
            hits.append(key)
            continue
        if any(tok in q for tok in tokens[:1]) and "(" in name and ")" in name:
            # Also allow matching by vendor shorthand inside parentheses
            inner = name[name.find("(") + 1 : name.find(")")].strip().lower()
            if inner and inner in q:
                hits.append(key)

    hits = sorted(set(hits))
    if len(hits) == 1:
        return hits[0]
    return None


def _extract_borrower_question(message: str) -> str:
    """UI wraps know-more prompts; extract the user's line for intent detection."""
    m = re.search(r"Borrower question:\s*(.+?)(?:\n\n|\Z)", message, re.I | re.S)
    return m.group(1).strip() if m else (message or "").strip()


def _extract_scenario_summary_from_message(message: str) -> str | None:
    m = re.search(r"Loan scenario:\s*(.+?)(?:\n\nBorrower question:|\Z)", message, re.I | re.S)
    return m.group(1).strip() if m else None


def _extract_program_title_from_context(message: str) -> str | None:
    m = re.search(
        r'Program context:.*?selected\s+["\']([^"\']+)["\']',
        message,
        re.I | re.S,
    )
    return m.group(1).strip() if m else None


def _is_documentation_question(question: str) -> bool:
    low = (question or "").lower()
    return bool(
        re.search(
            r"\b("
            r"documentation|document types?|doc types?|income doc(?:umentation)?|"
            r"docs?\s+accepted|accepted\s+docs?|what\s+docs?|which\s+docs?|"
            r"full[\s-]?doc(?:umentation)?|bank[\s-]?statements?|1099|wvoe|"
            r"asset[\s-]?util(?:ization)?|p&l|profit\s+and\s+loss|dscr[\s-]?rental"
            r")\b",
            low,
        )
        or "docs accepted" in low
        or "documentation accepted" in low
    )


def _is_geo_restrictions_question(question: str) -> bool:
    low = (question or "").lower()
    return bool(
        re.search(
            r"\b("
            r"geo(?:graphical|graphic)?|geographic|geographical|geo[\s-]?restriction|state[\s-]?restriction|"
            r"ineligible\s+state|restricted\s+state|location\s+restriction|"
            r"county\s+restriction|state\s+overlay|where\s+.*ineligible"
            r")\b",
            low,
        )
    )


def _parse_state_from_scenario_summary(scenario_summary: str | None) -> str | None:
    if not scenario_summary:
        return None
    m = re.search(r"State=[^(]+\(([A-Z]{2})\)", scenario_summary)
    return m.group(1).upper() if m else None


def _merge_deduped_hits(*hit_groups: list[Any], limit: int = 10) -> list[Any]:
    dedup: dict[str, Any] = {}
    for group in hit_groups:
        for hit in group:
            rid = str(getattr(hit, "id", ""))
            existing = dedup.get(rid)
            if existing is None or (hit.score or 0) > (existing.score or 0):
                dedup[rid] = hit
    ranked = sorted(dedup.values(), key=lambda h: float(h.score or 0), reverse=True)
    return ranked[:limit]


# Denali (NQM) catalog when MySQL `programs` is unavailable (migration 006, current matrix set).
_NQM_DOC_CATALOG_FALLBACK: tuple[tuple[str, str], ...] = (
    ("Flex Supreme", '["full_doc","bank_stmt_12","bank_stmt_24","bank_stmt_business","pl_2mo_bs","asset_util","1099","dscr_rental","non_traditional"]'),
    ("Flex Select", '["full_doc","bank_stmt_12","bank_stmt_24","bank_stmt_business","pl_2mo_bs","asset_util","1099","wvoe","dscr_rental","non_traditional"]'),
    ("Select ITIN", '["full_doc","bank_stmt_12","bank_stmt_24","bank_stmt_business","pl_2mo_bs","asset_util","1099","dscr_rental","itin","non_traditional"]'),
    ("Super Jumbo", '["full_doc","bank_stmt_24","bank_stmt_business","pl_2mo_bs","asset_util","dscr_rental","non_traditional"]'),
    ("Second Lien Select", '["full_doc","bank_stmt_12","bank_stmt_24","bank_stmt_business","pl_2mo_bs","asset_util","1099","dscr_rental"]'),
    ("DSCR Supreme", '["dscr_rental"]'),
    ("Investor DSCR", '["dscr_rental"]'),
    ("Investor DSCR No Ratio", '["dscr_rental"]'),
    ("DSCR Multi 5-8 Unit", '["dscr_rental"]'),
    ("Foreign National", '["full_doc","bank_stmt_12","bank_stmt_24","bank_stmt_business","asset_util","dscr_rental","non_traditional"]'),
)


def _build_program_docs_context(lender_key: str, rows: list[tuple[str, str]]) -> str:
    from chatbot_retrieval.eligibility import _format_doc_types_allowed

    display = get_program_map().get(lender_key, lender_key)
    lines = [f"Structured eligibility data for {display} (lender program catalog):"]
    for program_name, raw_docs in rows:
        lines.append(f"- {program_name}: {_format_doc_types_allowed(raw_docs)}")
    return "\n".join(lines)


def _fetch_lender_program_docs_context(lender_key: str) -> str | None:
    """Program catalog doc_types_allowed from MySQL, with ingest fallback for Denali."""
    lender_code = config.lender_code_from_key(lender_key)
    rows: list[tuple[str, str]] = []
    if lender_code:
        try:
            engine = _get_sql_engine()
            with engine.connect() as conn:
                rows = [
                    (str(name), str(raw))
                    for name, raw in conn.execute(
                        text(
                            """
                            SELECT p.program_name, p.doc_types_allowed
                            FROM dim_programs p
                            INNER JOIN dim_lenders l ON l.id = p.lender_id
                            WHERE l.code = :code
                            ORDER BY p.program_name
                            """
                        ),
                        {"code": lender_code},
                    ).fetchall()
                ]
        except Exception:
            rows = []
    if not rows and lender_key == "nqm":
        rows = list(_NQM_DOC_CATALOG_FALLBACK)
    if not rows:
        return None
    return _build_program_docs_context(lender_key, rows)


def _fetch_program_doc_row(
    lender_key: str,
    *,
    program_id: int | None = None,
    program_name: str | None = None,
    program_name_np: str | None = None,
) -> dict[str, str] | None:
    """Single program doc_types_allowed from dim_programs (matrix catalog)."""
    lender_code = config.lender_code_from_key(lender_key)
    if not lender_code:
        return None
    clauses: list[str] = []
    params: dict[str, Any] = {"code": lender_code}
    if program_id is not None:
        clauses.append("p.program_id = :program_id")
        params["program_id"] = program_id
    elif program_name_np:
        clauses.append(
            "(LOWER(p.program_name_np) = LOWER(:np) OR LOWER(p.program_name_np) LIKE LOWER(:np_like))"
        )
        params["np"] = program_name_np.strip()
        params["np_like"] = f"%{program_name_np.strip()}%"
    elif program_name:
        clauses.append(
            "(LOWER(p.program_name) = LOWER(:pn) OR LOWER(p.program_name_np) = LOWER(:pn))"
        )
        params["pn"] = program_name.strip()
    else:
        return None
    sql = f"""
        SELECT p.program_name, p.program_name_np, p.doc_types_allowed
        FROM dim_programs p
        INNER JOIN dim_lenders l ON l.id = p.lender_id
        WHERE l.code = :code AND ({" OR ".join(clauses)})
        LIMIT 1
    """
    try:
        engine = _get_sql_engine()
        with engine.connect() as conn:
            row = conn.execute(text(sql), params).fetchone()
        if not row:
            return None
        return {
            "program_name": str(row[0]),
            "program_name_np": str(row[1] or ""),
            "doc_types_allowed": str(row[2] or ""),
        }
    except Exception:
        return None


def _detect_program_name_hint(message: str, lender_key: str) -> str | None:
    """Match display name (program_name_np) mentioned in the question."""
    lender_code = config.lender_code_from_key(lender_key)
    if not lender_code:
        return None
    low = (message or "").lower()
    try:
        engine = _get_sql_engine()
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    """
                    SELECT program_name, program_name_np
                    FROM dim_programs p
                    INNER JOIN dim_lenders l ON l.id = p.lender_id
                    WHERE l.code = :code
                    ORDER BY CHAR_LENGTH(COALESCE(p.program_name_np, p.program_name)) DESC
                    """
                ),
                {"code": lender_code},
            ).fetchall()
    except Exception:
        return None
    for pname, pnp in rows:
        for label in (str(pnp or "").strip(), str(pname or "").strip()):
            if len(label) >= 6 and label.lower() in low:
                return label
    return None


def _format_single_program_docs_reply(row: dict[str, str]) -> str:
    from chatbot_retrieval.eligibility import _format_doc_types_allowed

    display = (row.get("program_name_np") or row.get("program_name") or "Program").strip()
    docs = _format_doc_types_allowed(row.get("doc_types_allowed"))
    return f"Accepted income documentation for {display}:\n\n{docs}"


def _documentation_reply_if_available(
    lender_key: str | None,
    message: str,
    *,
    selected_program: str | None = None,
    selected_meta: dict[str, Any] | None = None,
) -> str | None:
    user_q = _extract_borrower_question(message)
    if not (_is_documentation_question(user_q) or _is_documentation_question(message)):
        return None
    key = lender_key or (
        str(selected_meta["lender_key"])
        if selected_meta and selected_meta.get("lender_key")
        else detect_program_key(user_q) or detect_program_key(message)
    )
    if not key:
        return None

    row: dict[str, str] | None = None
    if selected_meta and selected_meta.get("program_mysql_id") is not None:
        row = _fetch_program_doc_row(
            key, program_id=int(selected_meta["program_mysql_id"]),
        )
    if not row and selected_meta and selected_meta.get("program_name"):
        row = _fetch_program_doc_row(key, program_name=str(selected_meta["program_name"]))
    if not row:
        title = _extract_program_title_from_context(message) or _detect_program_name_hint(
            user_q, key
        ) or _detect_program_name_hint(message, key)
        if title:
            row = _fetch_program_doc_row(key, program_name_np=title)
    if not row and selected_program:
        sp = selected_program.strip()
        if " - " in sp:
            row = _fetch_program_doc_row(key, program_name_np=sp.split(" - ", 1)[1].strip())
        if not row:
            row = _fetch_program_doc_row(key, program_name_np=sp)

    if row:
        return _format_single_program_docs_reply(row)

    structured = _fetch_lender_program_docs_context(key)
    if structured:
        return _format_documentation_reply_from_catalog(key, structured, user_q or message)
    return None


def _is_unhelpful_doc_reply(text: str) -> bool:
    low = (text or "").lower()
    return (
        "could not find" in low
        or "couldn't find" in low
        or "insufficient information" in low
        or "contact our representative" in low
    )


def _format_documentation_reply_from_catalog(
    lender_key: str,
    structured: str,
    question: str,
) -> str:
    display = get_program_map().get(lender_key, lender_key)
    low = question.lower()
    program_lines = [ln.strip() for ln in structured.splitlines() if ln.strip().startswith("- ")]

    if "full documentation" in low or "full doc" in low:
        with_full = [ln for ln in program_lines if "full documentation" in ln.lower()]
        intro = (
            f"{display} accepts Full Documentation on qualifying programs. "
            "Full Documentation is traditional income verification (for example W-2s, pay stubs, and tax returns) "
            "per program guidelines."
        )
        if with_full:
            names = [ln.split(":", 1)[0].lstrip("- ").strip() for ln in with_full]
            intro += f" Programs that include Full Documentation: {', '.join(names)}."
        body_lines = program_lines
    else:
        intro = f"Accepted income documentation types for {display} programs:"
        body_lines = program_lines

    bullets = []
    for ln in body_lines[:12]:
        name, _, docs = ln.partition(":")
        bullets.append(f"- {name.lstrip('- ').strip()}: {docs.strip()}")
    if len(program_lines) > 12:
        bullets.append(f"- …and {len(program_lines) - 12} more programs (see catalog).")
    return "\n".join([intro, ""] + bullets).strip()


def _fetch_lender_geo_restrictions_rows(
    lender_key: str,
    *,
    state_filter: str | None = None,
) -> list[dict[str, str]]:
    """Geographic restrictions from map_geographic_restrictions (matrix eligibility data)."""
    lender_code = config.lender_code_from_key(lender_key)
    if not lender_code:
        return []
    sql = """
        SELECT
            COALESCE(p.program_name, 'All programs') AS program_name,
            m.state,
            m.restriction_type,
            m.restriction_detail
        FROM map_geographic_restrictions m
        INNER JOIN dim_lenders l ON l.id = m.lender_id
        LEFT JOIN dim_programs p ON p.program_id = m.program_id
        WHERE l.code = :code
    """
    params: dict[str, Any] = {"code": lender_code}
    if state_filter:
        sql += " AND m.state = :state"
        params["state"] = state_filter.upper()
    sql += " ORDER BY m.state, program_name, m.restriction_type"
    try:
        engine = _get_sql_engine()
        with engine.connect() as conn:
            return [
                {
                    "program_name": str(r[0]),
                    "state": str(r[1]),
                    "restriction_type": str(r[2] or ""),
                    "restriction_detail": str(r[3] or "").strip(),
                }
                for r in conn.execute(text(sql), params).fetchall()
                if (r[3] or "").strip()
            ]
    except Exception:
        return []


def _format_geo_restrictions_reply(
    lender_key: str,
    rows: list[dict[str, str]],
    *,
    focus_state: str | None = None,
) -> str:
    display = get_program_map().get(lender_key, lender_key)
    if not rows:
        if focus_state:
            return (
                f"No state-specific geographic restriction rows are loaded for {display} "
                f"in {focus_state}. Other states may still have restrictions — ask without a "
                f"single-state scenario or contact an Acme representative."
            )
        return (
            f"No geographic restriction rows are loaded for {display} in the database. "
            "Please contact an Acme representative."
        )

    from collections import defaultdict

    by_state: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    for row in rows:
        by_state[row["state"]].append(
            (row["restriction_detail"], row["restriction_type"], row["program_name"]),
        )

    states = sorted(by_state.keys())
    if focus_state and focus_state.upper() in by_state:
        fs = focus_state.upper()
        states = [fs] + [s for s in states if s != fs]

    lines = [
        f"{display} geographic restrictions (from program matrix / eligibility data):",
        "",
    ]
    if focus_state and focus_state.upper() in by_state:
        lines.append(f"Your scenario state ({focus_state.upper()}) is listed first.")
        lines.append("")

    for st in states:
        lines.append(f"{st}:")
        detail_map: dict[tuple[str, str], list[str]] = defaultdict(list)
        for detail, rtype, prog in by_state[st]:
            detail_map[(detail, rtype)].append(prog)
        for (detail, rtype), progs in detail_map.items():
            progs_u = sorted(set(progs))
            type_hint = ""
            if "full_ineligibility" in rtype.lower() or rtype.lower() in (
                "ineligible",
                "ineligible_state",
            ):
                type_hint = " [ineligible]"
            elif "partial" in rtype.lower() or "overlay" in rtype.lower() or "ltv" in rtype.lower():
                type_hint = " [overlay / partial restriction]"
            if len(progs_u) >= 6:
                sample = ", ".join(progs_u[:4])
                lines.append(
                    f"  • {detail}{type_hint} — applies to multiple programs "
                    f"(e.g. {sample}, and others)."
                )
            else:
                lines.append(f"  • {detail}{type_hint} — Programs: {', '.join(progs_u)}.")
        lines.append("")

    lines.append(
        "These rules are applied during eligibility screening for the selected state. "
        "County- or city-level follow-ups may apply for some locations."
    )
    return "\n".join(lines).strip()


def _geo_restrictions_reply_if_available(
    lender_key: str,
    message: str,
    *,
    scenario_summary: str | None = None,
) -> str | None:
    if not lender_key or not _is_geo_restrictions_question(message):
        return None
    focus_state = _parse_state_from_scenario_summary(scenario_summary)
    rows = _fetch_lender_geo_restrictions_rows(lender_key, state_filter=None)
    if not rows and focus_state:
        rows = _fetch_lender_geo_restrictions_rows(lender_key, state_filter=focus_state)
    if not rows:
        return None
    return _format_geo_restrictions_reply(lender_key, rows, focus_state=focus_state)


def _expand_query(query: str) -> list[str]:
    q = query.strip()
    if not q:
        return [query]
    expansions = [q]
    low = q.lower()
    # Common DSCR/matrix questions benefit from keyword expansion.
    if any(k in low for k in ["cash out", "cash-out", "refi", "refinance", "ltv", "cltv", "dscr", "4-unit", "2-4"]):
        expansions.extend(
            [
                f"{q} DSCR cash-out max LTV 2-4 unit",
                f"{q} matrix DSCR credit score loan balance LTV cash-out",
            ]
        )
    if any(k in low for k in ["program", "products", "loan type", "what do you offer", "offer"]):
        expansions.extend(
            [
                f"{q} product matrix loan options",
                f"{q} eligible programs non-qm dscr bank statement itin",
                f"{q} guideline product names",
            ]
        )
    if _is_documentation_question(q):
        expansions.extend(
            [
                f"{q} income documentation types full doc bank statement 1099 asset utilization",
                f"{q} documentation alternatives allowed programs wage earner",
            ]
        )
    if _is_geo_restrictions_question(q):
        expansions.extend(
            [
                f"{q} geographic restrictions ineligible states state overlays",
                f"{q} matrix geographic restrictions county city eligibility",
            ]
        )
    return expansions[:5]


def _tokenize(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]{3,}", text.lower()))


def _is_toc_like(text: str) -> bool:
    sample = text[:2200]
    if not sample.strip():
        return True
    lines = [ln.strip() for ln in sample.splitlines() if ln.strip()]
    if not lines:
        return True
    toc_like_lines = 0
    for ln in lines[:40]:
        if re.search(r"\.{5,}\s*\d+\s*$", ln):
            toc_like_lines += 1
        elif re.search(r"\btable of contents\b", ln.lower()):
            toc_like_lines += 2
    return toc_like_lines >= max(3, len(lines) // 3)


def _rerank_hits(query: str, hits: list[Any]) -> list[Any]:
    qtokens = _tokenize(query)
    rescored: list[tuple[float, Any]] = []
    for hit in hits:
        payload = hit.payload or {}
        body = (payload.get("text") or "").strip()
        doc = str(payload.get("relpath") or payload.get("source") or "")
        dlow = doc.lower()
        score = float(hit.score or 0.0)

        if _is_toc_like(body):
            score -= 0.18

        overlap = len(qtokens & _tokenize(body[:1500]))
        score += min(0.12, overlap * 0.015)

        if any(k in dlow for k in ["matrix", "guideline", "program", "nonqm", "dscr"]):
            score += 0.03

        rescored.append((score, hit))

    rescored.sort(key=lambda x: x[0], reverse=True)
    return [row for _, row in rescored]
def retrieve(
    client: QdrantClient,
    query: str,
    *,
    limit: int = 5,
    collection_name: str | None = None,
    query_filter: models.Filter | None = None,
):
    queries = _expand_query(query)
    dedup: dict[str, Any] = {}
    cname = collection_name or config.COLLECTION_NAME

    for q in queries:
        qv = embed_query(q)
        rows = client.query_points(
            collection_name=cname,
            query=qv,
            limit=max(12, limit * 3),
            with_payload=True,
            query_filter=query_filter,
        ).points
        for row in rows:
            rid = str(getattr(row, "id", ""))
            existing = dedup.get(rid)
            if existing is None or (row.score or 0) > (existing.score or 0):
                dedup[rid] = row

    ranked = _rerank_hits(query, list(dedup.values()))
    return ranked[:limit]


def _retrieve_for_lender(
    client: QdrantClient,
    query: str,
    *,
    lender_key: str,
    per_source_limit: int = 3,
    program_mysql_id: int | None = None,
) -> list[Any]:
    out: list[Any] = []
    guideline_collection = config.program_collection_name_from_key(lender_key)
    out.extend(retrieve(client, query, limit=per_source_limit, collection_name=guideline_collection))

    lender_code = config.lender_code_from_key(lender_key)
    if lender_code:
        must: list[models.FieldCondition] = [
            models.FieldCondition(key="lender_id", match=models.MatchValue(value=lender_code))
        ]
        if program_mysql_id is not None:
            must.append(
                models.FieldCondition(
                    key="program_mysql_id",
                    match=models.MatchValue(value=int(program_mysql_id)),
                )
            )
        qfilter = models.Filter(must=must)
        out.extend(
            retrieve(
                client,
                query,
                limit=per_source_limit,
                collection_name=config.matrix_collection_name(),
                query_filter=qfilter,
            )
        )
    return _rerank_hits(query, out)[: max(2, per_source_limit * 2)]


 


def _lender_key_from_investor_label(name: str) -> str | None:
    """Map UI investor/lender label to guideline collection key (RAG)."""
    low = (name or "").strip().lower()
    if not low:
        return None
    if any(t in low for t in ("denali", "nqm")):
        return "nqm"
    if any(t in low for t in ("everest", "deephaven", "dhm")):
        return "everest"
    if any(t in low for t in ("summit", "verus", "vmc", "versus")):
        return "versus"
    return _lender_key_from_code(name)


def _meta_from_dim_row(row: Any) -> dict[str, Any] | None:
    lender_key = _lender_key_from_code(str(row[2]))
    if not lender_key:
        return None
    program_name_np = str(row[3] or "").strip() if len(row) > 3 else ""
    lender_id: int | None = None
    if len(row) > 4 and row[4] is not None:
        try:
            lender_id = int(row[4])
        except (TypeError, ValueError):
            lender_id = None
    return {
        "program_mysql_id": int(row[0]),
        "program_name": str(row[1]),
        "program_name_np": program_name_np or str(row[1]),
        "lender_code": str(row[2]),
        "lender_key": lender_key,
        "lender_id": lender_id,
    }


def _resolve_selected_program_meta_fallback(sp: str) -> dict[str, Any] | None:
    """Infer lender for Qdrant RAG when MySQL catalog tables are unavailable."""
    if re.match(r"^pid:\d+$", sp, re.I):
        return None
    lender_part = ""
    program_part = sp
    if " - " in sp:
        lender_part, program_part = sp.split(" - ", 1)
        lender_part = lender_part.strip()
        program_part = program_part.strip()
    lender_key = (
        _lender_key_from_investor_label(lender_part)
        if lender_part
        else _lender_key_from_investor_label(program_part)
    ) or detect_program_key(sp)
    if not lender_key:
        return None
    return {
        "program_mysql_id": None,
        "program_name": program_part or sp,
        "program_name_np": program_part or sp,
        "lender_code": config.lender_code_from_key(lender_key) or "",
        "lender_key": lender_key,
    }


def _resolve_selected_program_meta(selected_program: str | None) -> dict[str, Any] | None:
    """
    Resolve UI selection into lender/program ids for RAG retrieval.
    Uses dim_programs (eligibility schema); never raises if tables are missing.
    """
    if not selected_program or not selected_program.strip():
        return None
    sp = selected_program.strip()

    lender_part = ""
    program_part = sp
    if " - " in sp and not re.match(r"^pid:\d+$", sp, re.I):
        lender_part, program_part = sp.split(" - ", 1)
        lender_part = lender_part.strip()
        program_part = program_part.strip()

    pid_match = re.match(r"^pid:(\d+)$", sp, re.I)
    program_id = int(pid_match.group(1)) if pid_match else None

    try:
        engine = _get_sql_engine()
        with engine.connect() as conn:
            if program_id is not None:
                row = conn.execute(
                    text(
                        """
                        SELECT p.program_id, p.program_name, l.code AS lender_code,
                               p.program_name_np, p.lender_id
                        FROM dim_programs p
                        INNER JOIN dim_lenders l ON l.id = p.lender_id
                        WHERE p.program_id = :program_id
                        LIMIT 1
                        """
                    ),
                    {"program_id": program_id},
                ).fetchone()
                if row:
                    meta = _meta_from_dim_row(row)
                    if meta:
                        return meta

            if lender_part and program_part:
                row = conn.execute(
                    text(
                        """
                        SELECT p.program_id, p.program_name, l.code AS lender_code,
                               p.program_name_np, p.lender_id
                        FROM dim_programs p
                        INNER JOIN dim_lenders l ON l.id = p.lender_id
                        WHERE (
                            LOWER(p.program_name) = LOWER(:program_name)
                            OR LOWER(p.program_name_np) = LOWER(:program_name)
                          )
                          AND (
                            LOWER(l.lender_name) = LOWER(:lender_name)
                            OR LOWER(l.brand_name) = LOWER(:lender_name)
                            OR LOWER(l.code) = LOWER(:lender_name)
                          )
                        LIMIT 1
                        """
                    ),
                    {"program_name": program_part, "lender_name": lender_part},
                ).fetchone()
                if row:
                    meta = _meta_from_dim_row(row)
                    if meta:
                        return meta

            if program_part:
                row = conn.execute(
                    text(
                        """
                        SELECT p.program_id, p.program_name, l.code AS lender_code,
                               p.program_name_np, p.lender_id
                        FROM dim_programs p
                        INNER JOIN dim_lenders l ON l.id = p.lender_id
                        WHERE LOWER(p.program_name) = LOWER(:program_name)
                           OR LOWER(p.program_name_np) = LOWER(:program_name)
                        LIMIT 1
                        """
                    ),
                    {"program_name": program_part},
                ).fetchone()
                if row:
                    meta = _meta_from_dim_row(row)
                    if meta:
                        return meta
    except Exception:
        pass

    return _resolve_selected_program_meta_fallback(sp)


def _guideline_and_matrix_collections() -> list[str]:
    """Mortgage matrices + all lender guideline collections."""
    return list(
        dict.fromkeys(
            [config.matrix_collection_name(), *config.GUIDELINE_COLLECTIONS.values()],
        ),
    )


def retrieve_guidelines_and_matrices(
    client: QdrantClient,
    query: str,
    *,
    limit: int = 10,
) -> list[Any]:
    """Search mortgage_matrices and every guideline collection; return top N chunks."""
    dedup: dict[str, Any] = {}
    collections = _guideline_and_matrix_collections()
    per_coll = max(6, (limit * 2) // max(1, len(collections)))

    for cname in collections:
        try:
            hits = retrieve(client, query, limit=per_coll, collection_name=cname)
        except Exception:
            continue
        for hit in hits:
            rid = str(getattr(hit, "id", ""))
            existing = dedup.get(rid)
            if existing is None or (hit.score or 0) > (existing.score or 0):
                dedup[rid] = hit

    ranked = _rerank_hits(query, list(dedup.values()))
    clean = [h for h in ranked if not _is_toc_like((h.payload or {}).get("text") or "")]
    return (clean or ranked)[:limit]


def retrieve_per_program(
    client: QdrantClient,
    query: str,
    *,
    per_program_limit: int = 3,
) -> list[Any]:
    """
    For consolidated questions, retrieve a small number of hits from each program collection
    so the answer can be compared program-by-program without cross-program bleed.
    """
    out: list[Any] = []
    for _key, _program_name in get_program_map().items():
        out.extend(
            _retrieve_for_lender(
                client,
                query,
                lender_key=_key,
                per_source_limit=per_program_limit,
            )
        )
    return _rerank_hits(query, out)[: max(3, len(get_program_map()) * per_program_limit)]


def _tidy_pdf_noise(text: str) -> str:
    """Soften TOC dot leaders and runaway newlines from PDF extraction."""
    text = re.sub(r"\.{6,}", " ... ", text)
    text = re.sub(r"[ \t]*\.{4,}[ \t]*", " ... ", text)
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()


def _normalize_program_input(program: str | None) -> str | None:
    if not program:
        return None
    p = program.strip().lower()
    if not p:
        return None
    if p in get_program_map():
        return p
    if "nqm" in p or "denali" in p:
        return "nqm"
    if "everest" in p or "deephaven" in p or "dhm" in p:
        return "everest"
    if "verus" in p or "summit" in p or "versus" in p or "vmc" in p:
        return "versus"
    return None


def _excerpt_preview(text: str, max_chars: int = 720) -> str:
    text = _tidy_pdf_noise(text)
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars]
    last_para = cut.rfind("\n\n")
    if last_para > int(max_chars * 0.45):
        cut = cut[:last_para]
    else:
        last_sp = cut.rfind(" ")
        if last_sp > int(max_chars * 0.55):
            cut = cut[:last_sp]
    return cut.rstrip() + "..."


def _looks_like_grid(text: str) -> bool:
    """Heuristic: matrix / table-like PDF text (tabs or spaced columns)."""
    sample = text[:4000]
    lines = [ln for ln in sample.splitlines() if ln.strip()]
    if len(lines) < 5:
        return False
    tab_lines = sum(1 for ln in lines if "\t" in ln)
    spaced_cols = sum(1 for ln in lines if re.search(r"\S {2,}\S", ln))
    return tab_lines >= 3 or spaced_cols >= min(6, len(lines) // 2)


def build_context(hits) -> str:
    blocks = []
    for i, p in enumerate(hits, 1):
        pl = p.payload or {}
        src = pl.get("relpath") or pl.get("source") or "unknown"
        raw = (pl.get("text") or "").strip()
        text = raw if len(raw) <= 3000 else raw[:2999] + "..."
        blocks.append(f"[{i}] Source: {src}\n{text}")
    return "\n\n---\n\n".join(blocks)


def answer_with_openai(question: str, context: str, *, valid_programs: list[str]) -> str:
    if not config.OPENAI_API_KEY:
        return ""
    oc = OpenAI(api_key=config.OPENAI_API_KEY)
    resp = oc.chat.completions.create(
        model=config.OPENAI_CHAT_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "SOURCE OF TRUTH (MANDATORY)\n"
                    "You MUST use ONLY the provided context.\n"
                    "You MUST NOT use:\n"
                    "prior knowledge\n"
                    "general mortgage knowledge\n"
                    "assumptions or common sense\n"
                    "information not explicitly present in the context\n"
                    "Every answer must be fully grounded in the context.\n\n"
                    "NO HALLUCINATION / NO GUESSING\n"
                    "You MUST NOT:\n"
                    "invent facts, rules, limits, or program details\n"
                    "assume missing values (e.g., LTV, DTI, reserves)\n"
                    "generalize beyond what is explicitly written\n"
                    "If something is not clearly stated, treat it as UNKNOWN.\n\n"
                    "HANDLING MISSING INFORMATION\n"
                    "You MAY provide a partial answer when only some lenders/programs are covered.\n"
                    "If a detail is missing, either omit it or mention it in one brief natural sentence.\n"
                    "Do NOT repeat 'unknown' many times.\n"
                    "Do NOT ask clarifying or follow-up questions in the final answer.\n"
                    "Do NOT repeat or re-ask questions already implied/answered by the user message.\n\n"
                    "PROGRAM NAMES (STRICT)\n"
                    f"You MUST only refer to programs using one of these exact names:\n{', '.join(valid_programs) if valid_programs else '(none)'}\n"
                    "Do NOT invent program names.\n"
                    "If you cannot attribute a fact to a specific program, omit it.\n\n"
                    "NO OVERCONFIDENT REJECTIONS\n"
                    "Do NOT say 'no fit' or 'not eligible' unless the context explicitly states it.\n\n"
                    "WHEN A POLICY DETAIL IS NOT FOUND\n"
                    "If details for a lender/program are not in the excerpts:\n"
                    "- Prefer omitting it entirely when the rest of the answer is complete.\n"
                    "- If you must note a gap, use one short conversational sentence.\n"
                    "- Do NOT use robotic/meta phrasing such as: \"not found in the provided context\", "
                    "\"retrieved guidelines\", or \"the context does not contain\".\n"
                    "- Do NOT suggest checking a lender matrix, contacting the lender directly, or consulting external documents.\n"
                    "- Do not ask follow-up questions; stop at the best grounded answer.\n\n"
                    "CITATIONS\n"
                    "Do NOT include citations like [1] in your output.\n"
                    "Do NOT mention 'Source:' or file names.\n\n"
                    "ANSWER STYLE\n"
                    "Write like a knowledgeable mortgage colleague — clear, professional, and human.\n"
                    "Avoid robotic or system-like language (never refer to \"context\", \"retrieved data\", or \"provided information\").\n"
                    "No headings like 'By program' or 'General'.\n"
                    "No long preambles.\n\n"
                    "ANSWER STRUCTURE\n"
                    "Start with a 1-2 sentence direct answer.\n"
                    "Then, for each applicable program, write a short 2-3 sentence mini-summary (plain text).\n"
                    "After each mini-summary, include 2-4 bullets with the concrete caps/requirements.\n"
                    "If multiple programs apply, you MAY mention them inline, e.g.:\n"
                    "- \"Max LTV (cash-out): Denali (NQM) 75%, Summit (Verus) 70%\"\n"
                    "Only include a program name next to a fact if that fact is clearly tied to that program in context.\n"
                    "For each program you mention, include 2-4 bullets so the answer feels complete.\n"
                    "Prefer including: max LTV/CLTV, min FICO, DSCR requirement, and any loan amount limit if present.\n"
                    "If something is missing, omit it.\n"
                    "Do NOT include any follow-up question lines.\n"
                    "Do NOT include explanations, reasoning steps, or commentary.\n\n"
                    "PROGRAM / PRODUCT QUESTIONS\n"
                    "When asked about programs, products, or options:\n"
                    "Extract names ONLY from the context (matrices, sections, headings).\n"
                    "Do NOT create or infer new program names.\n"
                    "Organize into MAXIMUM 2 sections.\n"
                    "Each section should contain concise bullet points.\n\n"
                    "STRICT INTERPRETATION RULE\n"
                    "Stay as close as possible to the original wording.\n"
                    "Do NOT reinterpret policy meaning.\n"
                    "Do NOT merge multiple rules unless explicitly connected in context.\n"
                    "If wording is ambiguous, reflect it conservatively.\n\n"
                    "FORMATTING RULES (MANDATORY)\n"
                    "Output MUST be plain text only.\n"
                    "Do NOT use:\n"
                    "markdown\n"
                    "bold/italics\n"
                    "headings\n"
                    "code blocks\n"
                    "Use short lines.\n"
                    "Use bullets starting with '- '.\n"
                    "Keep output compact and clean.\n\n"
                    "PRIORITY ORDER\n"
                    "Follow this priority strictly:\n"
                    "1. Grounded in context\n"
                    "2. Fully cited\n"
                    "3. Correct\n"
                    "4. Concise\n"
                    "If a tradeoff is required, ALWAYS prefer correctness and grounding over completeness.\n\n"
                    "FINAL VALIDATION (SELF-CHECK BEFORE ANSWERING)\n"
                    "Before generating the final answer, ensure:\n"
                    "Every statement is backed by context\n"
                    "No external knowledge is used\n"
                    "No assumptions are made\n"
                    "If any of the above fails, remove the unsupported parts.\n"
                ),
            },
            {
                "role": "user",
                "content": f"Context:\n{context}\n\nQuestion: {question}",
            },
        ],
        temperature=0.2,
    )
    return (resp.choices[0].message.content or "").strip()


def _is_rate_question(question: str) -> bool:
    q = question.lower()
    keys = [
        "interest rate",
        "rate today",
        "today's rate",
        "todays rate",
        "pricing",
        "price today",
        "apr",
    ]
    return any(k in q for k in keys)


def _context_has_pricing_data(context: str) -> bool:
    c = context.lower()
    pricing_keys = [
        "rate sheet",
        "pricing",
        "coupon",
        "margin",
        "index",
        "apr",
        "interest rate",
        "lock period",
    ]
    return any(k in c for k in pricing_keys)


def _humanize_robotic_phrases(text: str) -> str:
    """Rewrite common LLM meta-phrasing into natural advisor language."""
    t = text
    subs: list[tuple[str, str]] = [
        (
            r"Details regarding (.+?) were not found in the provided context\.?",
            r"I don't have \1 in the guidelines I pulled up.",
        ),
        (
            r"Details (?:for|regarding|about) (.+?) were not found(?: in the provided context)?\.?",
            r"I don't have \1 in the guidelines I pulled up.",
        ),
        (
            r"(.+?) was not found in the provided context\.?",
            r"I wasn't able to find \1 in the guidelines I have on file.",
        ),
        (
            r"(.+?) were not found in the provided context\.?",
            r"I wasn't able to find \1 in the guidelines I have on file.",
        ),
        (
            r"Specific information regarding (.+?) was not found(?: in the provided context)?\.?",
            r"I don't have \1 details in what I pulled up.",
        ),
        (
            r"The context does not contain (?:information about )?(.+?)\.?",
            r"I don't have \1 in the material I pulled up.",
        ),
        (
            r"The context does not provide specific details about (.+?) for the scenario described\..*?I cannot provide an answer about this program\.?",
            r"I don't have specific details about \1 in my guidelines.",
        ),
        (
            r"The context does not provide specific details about (.+?)\.",
            r"I don't have specific details about \1 in my guidelines.",
        ),
    ]
    for pattern, repl in subs:
        t = re.sub(pattern, repl, t, flags=re.I)
    return t


def _clean_answer_text(text: str) -> str:
    t = text.replace("\r\n", "\n").strip()
    if not t:
        return t
    t = _humanize_robotic_phrases(t)
    # Normalize common markdown artifacts into plain text.
    t = re.sub(r"\*\*(.*?)\*\*", r"\1", t)
    t = re.sub(r"^#{1,6}\s*", "", t, flags=re.MULTILINE)
    t = re.sub(r"^\s*[-*]\s{2,}", "- ", t, flags=re.MULTILINE)
    t = re.sub(r"^\s{2,}[-*]\s+", "- ", t, flags=re.MULTILINE)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def _llm_answer_looks_grounded(text: str) -> bool:
    """
    Minimal heuristic: non-empty and not the generic failure string.
    Grounding is enforced by the system prompt and retrieved context.
    """
    t = (text or "").strip()
    if not t:
        return False
    low = t.lower()
    if "insufficient information" in low:
        return False
    return True


def _strip_citations_and_sources(text: str) -> str:
    t = (text or "").strip()
    if not t:
        return t
    # Remove bracket citations and "Source:" lines if any slipped through.
    t = re.sub(r"\s*\[\d+\]\s*", "", t)
    t = re.sub(r"(?im)^\s*source:\s*.*$", "", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def _limit_clarifying_questions(text: str, *, max_questions: int = 1) -> str:
    """
    Keep at most N clarifying questions in the reply text.
    Looks for a section starting with 'Clarifying questions' (case-insensitive).
    """
    t = (text or "").strip()
    if not t or max_questions < 0:
        return t

    lines = t.splitlines()
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if re.match(r"(?i)^\s*(clarifying questions|follow-?up questions?)\s*:\s*$", line.strip()):
            out.append("Follow-up question:")
            i += 1
            kept = 0
            # consume question lines
            while i < len(lines):
                ln = lines[i]
                if not ln.strip():
                    i += 1
                    continue
                # stop if a new section starts
                if re.match(r"^[A-Za-z][A-Za-z ]{2,}:\s*$", ln.strip()):
                    break
                is_q = bool(re.match(r"^\s*([-*]|\d+[\.\)])\s+", ln))
                if is_q and kept < max_questions:
                    # normalize to "- "
                    qtext = re.sub(r"^\s*([-*]|\d+[\.\)])\s+", "", ln).strip()
                    if qtext:
                        out.append(f"- {qtext}")
                        kept += 1
                i += 1
            # If none kept, drop section entirely
            if kept == 0:
                out = [ln for ln in out if ln.strip().lower() != "follow-up question:"]
            continue
        out.append(line)
        i += 1

    cleaned = "\n".join(out)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned


def _extract_key_lines(question: str, text: str, *, max_lines: int = 3) -> list[str]:
    """
    Pull a few high-signal lines from a chunk that match question keywords.
    This is a retrieval-only fallback (no LLM), so it must stay conservative.
    """
    q = question.lower()
    keys: list[str] = []
    for k in ["cash-out", "cash out", "ltv", "cltv", "dscr", "2-4", "4-unit", "4 unit", "rental", "refi", "refinance", "texas", "tx"]:
        if k in q:
            keys.append(k)
    # Always include these general matrix terms to catch relevant rows.
    keys.extend(["cash-out", "cash out", "ltv", "cltv", "dscr", "2-4", "4-unit", "rate/term", "rate term"])
    keys = list(dict.fromkeys(keys))[:10]

    lines = [ln.strip(" \t\r") for ln in (text or "").splitlines()]
    scored: list[tuple[int, str]] = []
    for ln in lines:
        low = ln.lower()
        if len(low) < 12:
            continue
        score = sum(1 for k in keys if k in low)
        if score <= 0:
            continue
        # Prefer lines with percentages/numbers
        if re.search(r"\b\d{2,3}\s*%|\b\d+\.\d+\b|\b\d{2,}\b", ln):
            score += 1
        # Prefer lines explicitly mentioning LTV/CLTV/cash-out.
        if ("ltv" in low) or ("cltv" in low) or ("cash out" in low) or ("cash-out" in low):
            score += 2
        scored.append((score, ln))
    scored.sort(key=lambda x: x[0], reverse=True)
    out: list[str] = []
    for _, ln in scored:
        if ln not in out:
            out.append(ln)
        if len(out) >= max_lines:
            break
    return out


def retrieval_only_answer(question: str, hits) -> str:
    """
    Produce a structured, conservative answer directly from retrieved snippets.
    Group by program and cite each bullet with [n] where n is the hit rank.
    """
    by_program: dict[str, list[tuple[int, dict]]] = {}
    for i, h in enumerate(hits, 1):
        pl = h.payload or {}
        program = (pl.get("program") or "Unknown program").strip()
        by_program.setdefault(program, []).append((i, pl))

    lines: list[str] = []
    lines.append("By program:")

    for program in sorted(by_program.keys()):
        rows = by_program[program]
        snippets: list[tuple[int, str, str]] = []
        for idx, pl in rows:
            rel = (pl.get("relpath") or pl.get("source") or "unknown").strip()
            text = (pl.get("text") or "").strip()
            key_lines = _extract_key_lines(question, text, max_lines=2)
            for kl in key_lines:
                snippets.append((idx, kl, rel))

        # De-dup identical lines while keeping order by hit rank
        seen = set()
        deduped: list[tuple[int, str, str]] = []
        for idx, kl, rel in snippets:
            key = (kl, rel)
            if key in seen:
                continue
            seen.add(key)
            deduped.append((idx, kl, rel))

        lines.append(f"- {program}")
        if not deduped:
            lines.append("  - No cash-out/LTV/DSCR line found in the top retrieved excerpts.")
            continue

        # Keep it compact: at most 2 bullets per program.
        for _idx, kl, _rel in deduped[:2]:
            lines.append(f"  - {kl}")

    # Minimal clarifying questions (only what’s needed to locate the exact row)
    lines.append("")
    lines.append("To get an exact max LTV for your case, tell me:")
    lines.append("- which program to check (Denali / Everest / Summit) or say “compare all 3”")
    lines.append("- whether the matrix row is based on loan balance tier (e.g., $750k loan amount vs property value)")
    return "\n".join(lines).strip()


def hits_to_sources(
    hits,
    *,
    preview_max_chars: int = 280,
) -> list[dict[str, Any]]:
    """Build source list for API/UI with short, cleaned previews."""
    out: list[dict[str, Any]] = []
    for i, p in enumerate(hits, 1):
        pl = p.payload or {}
        raw = (pl.get("text") or "").strip()
        body = _excerpt_preview(raw, preview_max_chars)
        layout = "ascii" if _looks_like_grid(raw) else "prose"
        out.append(
            {
                "index": i,
                "path": pl.get("relpath") or pl.get("source") or "unknown",
                "text": body,
                "layout": layout,
                "score": float(p.score) if p.score is not None else None,
            }
        )
    return out


def chat_once(message: str) -> dict[str, Any]:
    return chat_once_with_program(message, program=None, selected_program=None)


def chat_once_results_general(
    message: str,
    *,
    scenario_summary: str | None = None,
    matched_programs: list[dict[str, Any]] | None = None,
    geo_exclusions: list[dict[str, Any]] | None = None,
    overlay_exclusions: list[dict[str, Any]] | None = None,
    total_screened: int | None = None,
    eligibility_request: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Flow 2 — all SQL + matrices + guidelines + optional eligibility re-screen."""
    from chatbot_retrieval.general_chat import chat_once_results_general as _flow2

    return _flow2(
        message,
        scenario_summary=scenario_summary,
        matched_programs=matched_programs,
        geo_exclusions=geo_exclusions,
        overlay_exclusions=overlay_exclusions,
        total_screened=total_screened,
        eligibility_request=eligibility_request,
    )


def chat_once_with_program(
    message: str,
    program: str | None,
    selected_program: str | None = None,
    *,
    scenario_summary: str | None = None,
) -> dict[str, Any]:
    message = message.strip()
    if not message:
        return {"reply": "", "sources": [], "used_llm": False, "empty": True}

    selected_meta = _resolve_selected_program_meta(selected_program)

    effective_scenario = (scenario_summary or "").strip() or _extract_scenario_summary_from_message(message)

    # Flow 1 — same question router as general chat, scoped to one program (SQL + Qdrant)
    if selected_meta and selected_meta.get("program_mysql_id") is not None:
        return chat_once_selected_program(
            message,
            selected_meta,
            scenario_summary=effective_scenario or None,
        )

    client = get_engine()
    # Program resolution (legacy fallback when MySQL program id is unavailable):
    # - if caller supplies program: use it
    # - else try to detect from question
    program_key: str | None = None
    if program:
        program_key = _normalize_program_input(program)
    else:
        program_key = detect_program_key(message)
    if selected_meta and selected_meta.get("lender_key"):
        program_key = str(selected_meta["lender_key"])

    geo_reply = _geo_restrictions_reply_if_available(program_key or "", message)
    if geo_reply and program_key:
        return {
            "reply": geo_reply,
            "sources": [],
            "used_llm": False,
            "program": get_program_map().get(program_key),
            "collection": config.program_collection_name_from_key(program_key),
        }

    doc_reply = _documentation_reply_if_available(
        program_key,
        message,
        selected_program=selected_program,
        selected_meta=selected_meta,
    )
    if doc_reply:
        return {
            "reply": doc_reply,
            "sources": [],
            "used_llm": False,
            "program": (
                (selected_meta or {}).get("program_name_np")
                or (selected_meta or {}).get("program_name")
                or get_program_map().get(program_key or "")
            ),
            "collection": (
                config.program_collection_name_from_key(program_key)
                if program_key
                else config.matrix_collection_name()
            ),
        }

    # Choose retrieval strategy:
    # - Explicit/detected program: query that program's collection
    # - Otherwise: query each program collection and merge (for clean comparisons)
    collection_name = config.COLLECTION_NAME
    if program_key and program_key in get_program_map():
        collection_name = f"{config.program_collection_name_from_key(program_key)} + {config.matrix_collection_name()}"
        hits = _retrieve_for_lender(
            client,
            message,
            lender_key=program_key,
            per_source_limit=3,
            program_mysql_id=(
                int(selected_meta["program_mysql_id"])
                if selected_meta and selected_meta.get("program_mysql_id") is not None
                else None
            ),
        )
    else:
        collection_name = f"{config.matrix_collection_name()} + lender guideline collections"
        hits = retrieve_per_program(client, message, per_program_limit=2)

    if hits:
        clean_hits = [h for h in hits if not _is_toc_like((h.payload or {}).get("text") or "")]
        if clean_hits:
            hits = clean_hits[:5]

    if not hits:
        return {
            "reply": CONTACT_REPRESENTATIVE_REPLY,
            "sources": [],
            "used_llm": False,
        }

    ctx = build_context(hits)
    valid_programs = sorted(set(get_program_map().values()))
    reply = answer_with_openai(message, ctx, valid_programs=valid_programs)
    if reply:
        if _is_rate_question(message) and not _context_has_pricing_data(ctx):
            reply = (
                "I don't have live rate-sheet data in the indexed documents, so I can't quote today's interest rate.\n"
                "I can still narrow eligibility for your scenario (12-month bank statement, 700 FICO, 75% LTV) and list "
                "which programs fit. For exact pricing, please provide or upload today's rate sheet."
            )
        else:
            reply = _strip_citations_and_sources(_clean_answer_text(reply))
        reply = _limit_clarifying_questions(reply, max_questions=0)
        replacement = deflection_reply_if_needed(reply)
        if replacement:
            reply = replacement
        sources = hits_to_sources(hits, preview_max_chars=220)
        if _llm_answer_looks_grounded(reply):
            return {
                "reply": reply,
                "sources": sources,
                "used_llm": True,
                "program": get_program_map().get(program_key) if program_key else None,
                "collection": collection_name,
            }
        # Fallback: deterministic answer from retrieved snippets.
        return {
            "reply": retrieval_only_answer(message, hits),
            "sources": sources,
            "used_llm": False,
            "program": get_program_map().get(program_key) if program_key else None,
            "collection": collection_name,
        }

    sources = hits_to_sources(hits, preview_max_chars=260)
    short_reply = (
        "No LLM API key is configured, so answers are not synthesized. "
        "Use the excerpts below (tables use a fixed-width layout). "
        "Set OPENAI_API_KEY in `.env` for concise, cited answers."
    )
    return {
        "reply": short_reply,
        "sources": sources,
        "used_llm": False,
        "program": get_program_map().get(program_key) if program_key else None,
        "collection": collection_name,
    }


def retrieval_diagnostics(message: str, limit: int = 8) -> dict[str, Any]:
    client = get_engine()
    hits = retrieve_per_program(client, message, per_program_limit=max(1, limit // 3))
    hits = hits[:limit]
    rows: list[dict[str, Any]] = []
    for i, h in enumerate(hits, 1):
        payload = h.payload or {}
        raw = (payload.get("text") or "").strip()
        rows.append(
            {
                "rank": i,
                "score": float(h.score or 0.0),
                "path": payload.get("relpath") or payload.get("source") or "unknown",
                "toc_like": _is_toc_like(raw),
                "preview": _excerpt_preview(raw, 180),
            }
        )
    toc_count = sum(1 for r in rows if r["toc_like"])
    return {
        "query": message,
        "result_count": len(rows),
        "toc_like_count": toc_count,
        "hits": rows,
    }

