from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any, TypedDict

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from qdrant_client import QdrantClient, models
from sqlalchemy import text

from backend import config
from backend.connections.db import get_engine as _get_db_engine
from backend.connections.openai import get_openai
from backend.connections.qdrant import get_qdrant
from backend.utilities.guard import CONTACT_REPRESENTATIVE_REPLY, deflection_reply_if_needed
from backend.connections.embeddings import embed_query, warmup_embeddings

_program_map: dict[str, str] | None = None


def get_qdrant_client() -> QdrantClient:
    return get_qdrant("default")


def get_engine() -> QdrantClient:
    """Warm up Qdrant + embedding backend (OpenAI 1536-dim by default)."""
    warmup_embeddings()
    return get_qdrant_client()


def get_meta_client() -> QdrantClient:
    """
    Separate Qdrant client for fast metadata calls (e.g., list collections).
    Uses a shorter timeout so /api/health stays responsive.
    """
    return get_qdrant("meta")


def _get_sql_engine():
    return _get_db_engine()


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
    from backend.eligibility import _format_doc_types_allowed

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
    from backend.eligibility import _format_doc_types_allowed

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


def _lender_key_from_code(code: str | None) -> str | None:
    if not code:
        return None
    c = code.strip().upper()
    for key, lender_code in config.LENDER_CODE_BY_KEY.items():
        if lender_code == c:
            return key
    return None


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
    oc = get_openai()
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


# ===========================================================================
# Folded in from general_chat.py (forwarder wrappers dropped — names resolve
# directly within this module now). One alias preserved:
# ===========================================================================

_extract_user_question = _extract_borrower_question  # was a cross-module forwarder


def _format_program_chat_reply(text: str) -> str:
    """
    Know More follow-ups: short intro paragraph, then bullet lines for the UI.
    Converts inline 'Topic: detail' prose into bullets when the model skips them.
    """
    raw = (text or "").strip()
    if not raw:
        return raw
    if re.search(r"(?m)^[-•*]\s+", raw):
        return raw

    closing = ""
    per_match = re.search(
        r"(?:\n\n|\.\s+)(Per\s+[^.]+\.)",
        raw,
        re.I,
    )
    if per_match:
        closing = per_match.group(1).strip()
        raw = (raw[: per_match.start()] + " " + raw[per_match.end() :]).strip()
        raw = re.sub(r"\s+", " ", raw).strip()

    parts = re.split(r"([A-Z][A-Za-z][A-Za-z /]*):\s*", raw)
    if len(parts) >= 5:
        intro = parts[0].strip().rstrip(":")
        bullets: list[str] = []
        for i in range(1, len(parts) - 1, 2):
            label = parts[i].strip()
            body = parts[i + 1].strip()
            body = re.split(r"(?=[A-Z][A-Za-z][A-Za-z /]*:\s)", body)[0].strip()
            body = body.rstrip(". ").strip()
            if label and body:
                bullets.append(f"- {label}: {body}.")
        if len(bullets) >= 2:
            out = intro.rstrip(":")
            if out and not out.endswith((".", ":", "!", "?")):
                out += "."
            if not re.search(r"\bhere are the details\b", out, re.I):
                if out.rstrip().endswith("following"):
                    out = out.rstrip(".") + ". Here are the details:"
                else:
                    out += " Here are the details:"
            return "\n\n".join(
                [p for p in [out, "\n".join(bullets[:10]), closing] if p]
            )

    sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z"“(])', raw)
    sentences = [s.strip() for s in sentences if s.strip()]
    if len(sentences) < 3:
        return raw if not closing else f"{raw}\n\n{closing}"
    intro = sentences[0]
    bullet_lines = [f"- {s}" for s in sentences[1:8]]
    out = f"{intro}\n\n" + "\n".join(bullet_lines)
    if closing:
        out += f"\n\n{closing}"
    return out





_SQL_MAP_TABLES: dict[str, dict[str, Any]] = {
    "dim_programs": {
        "columns": [
            "program_id", "lender_id", "program_name_np",
            "fico_min", "fico_max", "loan_amt_min", "loan_amt_max", "max_dti",
            "max_ltv_purchase", "max_ltv_rate_term", "max_ltv_cashout",
        ],
        "needs_lender": True,
    },
    "map_ltv_matrix": {
        "columns": [
            "lender_id", "program_id", "fico_min", "loan_amt_min", "loan_amt_max", "dscr_band",
            "occupancy_type", "property_type", "loan_purpose", "borrower_type", "doc_type",
            "max_ltv", "max_cltv", "special_overlays",
        ],
        "needs_lender": True,
    },
    "map_credit_history_seasoning": {
        "columns": [
            "lender_id", "program_id", "event_type", "tier", "min_months_seasoning",
            "max_ltv_overlay", "max_cltv_overlay", "max_loan_amount_overlay", "notes",
        ],
        "needs_lender": True,
    },
    "map_housing_history_seasoning": {
        "columns": [
            "lender_id", "program_id", "history_pattern", "tier",
            "max_ltv_overlay", "max_cltv_overlay", "max_loan_amount_overlay", "notes",
        ],
        "needs_lender": True,
    },
    "map_geographic_restrictions": {
        "columns": ["id", "lender_id", "program_id", "state", "restriction_type", "restriction_detail"],
        "needs_lender": True,
    },
    "map_program_doc_req_details": {
        "columns": ["lender_id", "program_id", "scenario", "category", "content"],
        "needs_lender": True,
    },
    "map_program_rule_guideline": {
        "columns": ["lender_id", "program_id", "category", "content"],
        "needs_lender": True,
    },
    "map_program_fthb_eligibility": {
        "columns": ["program_id", "is_fthb_eligible", "fthb_max_loan_cap"],
        "needs_lender": False,
    },
    "map_program_prepayment_options": {
        "columns": ["id", "program_id", "prepayment_term_id", "occupancy_scope", "ineligible_states"],
        "needs_lender": False,
    },
    "map_program_products": {
        "columns": ["id", "program_id", "product_type_id", "io_flag", "is_fthb_eligible"],
        "needs_lender": False,
    },
}


def _is_guideline_question(question: str) -> bool:
    """
    Returns True when the question is asking about lender-wide policy/narrative content
    that lives in the guideline PDFs rather than structured SQL map tables.
    These should be answered from the guideline Qdrant collection (lender-level).
    """
    low = question.lower()
    return bool(re.search(
        r"\b("
        r"credit\s+score|tradeline|qualifying\s+fico|fico\s+score|credit\s+report"
        r"|eligible\s+borrower|citizenship|permanent\s+resident|non-permanent|itin|foreign\s+national"
        r"|self.?employ|self\s+employed|business\s+owner|wage\s+earner|w-?2|1099|tax\s+return"
        r"|bank\s+statement|profit.{0,5}loss|p&l|asset\s+util"
        r"|escrow|escrow\s+waiver|hpml"
        r"|appraisal|ltv\s+overlay|declining\s+market"
        r"|reserve|piit?a"
        r"|gift\s+fund|down\s+payment"
        r"|power\s+of\s+attorney|poa|vesting|entity|trust|llc"
        r"|subordinate|second\s+lien|heloc|piggyback"
        r"|seller\s+concession|interested\s+party"
        r"|prepayment|penalty\s+structure"
        r"|additional\s+borrower|co.borrower|co-borrower"
        r"|how\s+many\s+score|one\s+score|two\s+score|1\s+score|2\s+score|3\s+score|single\s+score"
        r"|am\s+i\s+eligible|can\s+i\s+qualify|do\s+i\s+qualify|qualify\s+for|eligible\s+for"
        r"|property\s+condition|first.time\s+investor|seasoning|credit\s+event|draw\s+period"
        r"|how\s+is|what\s+is|define|definition|what\s+are|what\s+does"
        r")\b",
        low,
    ))


def _route_selected_program_query(question: str) -> tuple[str, list[str]]:
    # Operate only on the real user question, not the full contextPrompt
    q = _extract_user_question(question)
    low = q.lower()
    sql_tables: list[str] = []

    # Core program parameters (FICO range, loan amount, DTI, LTV summary)
    if re.search(r"\b(min fico|max fico|loan amount|min loan|max loan|max dti|maximum dti|max.{0,5}dti)\b", low):
        sql_tables.append("dim_programs")
    # DTI — appears in rule_guideline with full details and conditions
    if re.search(r"\b(dti|debt[- ]to[- ]income|dti req|dti limit|dti rule)\b", low):
        sql_tables.append("dim_programs")
        sql_tables.append("map_program_rule_guideline")
    # LTV matrix
    if re.search(r"\b(ltv|cltv|max ltv|cash[- ]?out ltv|rate[- /]?term|occupancy|property type|borrower type|dscr band)\b", low):
        sql_tables.append("map_ltv_matrix")
    # Credit / housing event seasoning
    if re.search(r"\b(credit event|bankruptcy|bk|foreclosure|short sale|deed in lieu|dil|seasoning)\b", low):
        sql_tables.append("map_credit_history_seasoning")
    if re.search(r"\b(housing history|mortgage history|0x30|0x60|0x90|late payment|30.day|60.day)\b", low):
        sql_tables.append("map_housing_history_seasoning")
    # Geographic
    if _is_geo_restrictions_question(low):
        sql_tables.append("map_geographic_restrictions")
    # Income / document types
    if re.search(r"\b(document\s+req|doc\s+req|income\s+req|income\s+doc|bank\s+statement|1099|wvoe|asset\s+util|p&l|self.?employ|wage\s+earner|full\s+doc|alt\s+doc)\b", low):
        sql_tables.append("map_program_doc_req_details")
    # Rule / overlay snippets (escrow, occupancy, loan purpose, interest only, buydown, reserves)
    if re.search(r"\b(rule|overlay|escrow|loan\s+purpose|interest\s+only|buydown|2-1\s+buydown|cash.out\s+refi|product\s+type|eligible\s+property|reserves|piit?a)\b", low) and not _is_geo_restrictions_question(low):
        sql_tables.append("map_program_rule_guideline")
    # FTHB
    if re.search(r"\b(first.time\s+home.?buyer|fthb)\b", low):
        sql_tables.append("map_program_fthb_eligibility")
    # Prepayment / points / fees
    if re.search(r"\b(prepayment|prepay|penalty|points\s+and\s+fees)\b", low):
        sql_tables.append("map_program_prepayment_options")
        sql_tables.append("map_program_rule_guideline")
    # Delayed financing / debt consolidation — program rule snippets often mirror matrix
    if re.search(r"\b(delayed\s+financ|debt\s+consolidat|cash[- ]?out\s+refi)\b", low):
        sql_tables.append("map_program_rule_guideline")
    # Products
    if re.search(r"\b(product|arm|fixed\s+rate|interest.only\s+term|io\s+period|loan\s+term)\b", low):
        sql_tables.append("map_program_products")
        sql_tables.append("map_program_rule_guideline")
    # Co-borrower / additional borrower
    if re.search(r"\b(co.?borrower|additional\s+borrower|non.?occupant)\b", low):
        sql_tables.append("map_program_rule_guideline")

    sql_tables = list(dict.fromkeys(sql_tables))
    if sql_tables:
        return "sql", sql_tables
    # Default: rule snippets + core program params cover most generic questions
    return "sql", ["dim_programs", "map_program_rule_guideline"]


def _fetch_sql_map_rows_for_program(
    lender_id: int | None,
    program_id: int,
    tables: list[str],
    *,
    question: str = "",
    scenario_summary: str | None = None,
    max_rows_per_table: int = 120,
) -> dict[str, list[dict[str, Any]]]:
    engine = _get_sql_engine()
    out: dict[str, list[dict[str, Any]]] = {}
    state_filter = _parse_state_from_scenario_summary(scenario_summary)

    with engine.connect() as conn:
        for table in tables:
            if table == "dim_programs":
                try:
                    row = conn.execute(
                        text(
                            """
                            SELECT dp.program_id, dp.lender_id, dp.program_name_np, dp.program_name,
                                   dp.fico_min, dp.fico_max, dp.loan_amt_min, dp.loan_amt_max, dp.max_dti,
                                   dp.max_ltv_purchase, dp.max_ltv_rate_term, dp.max_ltv_cashout
                            FROM dim_programs dp
                            WHERE dp.program_id = :program_id
                            LIMIT 1
                            """
                        ),
                        {"program_id": int(program_id)},
                    ).fetchone()
                    if row:
                        cols = [
                            "program_id", "lender_id", "program_name_np", "program_name",
                            "fico_min", "fico_max", "loan_amt_min", "loan_amt_max", "max_dti",
                            "max_ltv_purchase", "max_ltv_rate_term", "max_ltv_cashout",
                        ]
                        out[table] = [{col: row[i] for i, col in enumerate(cols)}]
                except Exception:
                    pass
                continue

            spec = _SQL_MAP_TABLES.get(table)
            if not spec:
                continue
            cols = list(spec["columns"])
            mcols = ", ".join(f"m.{c}" for c in cols)
            where = ["m.program_id = :program_id"]
            params: dict[str, Any] = {"program_id": int(program_id), "lim": int(max_rows_per_table)}
            if spec.get("needs_lender") and lender_id is not None:
                where.append("m.lender_id = :lender_id")
                params["lender_id"] = int(lender_id)
            if table == "map_geographic_restrictions" and state_filter:
                where.append("m.state = :state")
                params["state"] = state_filter.upper()

            kw_filter = _sql_keyword_filter_clause(question, table)
            if kw_filter:
                where.append(kw_filter[0])
                params.update(kw_filter[1])

            sql = f"SELECT {mcols} FROM {table} m WHERE {' AND '.join(where)} LIMIT :lim"
            try:
                rows = conn.execute(text(sql), params).fetchall()
            except Exception:
                continue
            if not rows and table == "map_geographic_restrictions" and state_filter:
                where_no_state = [w for w in where if w != "m.state = :state"]
                params_no_state = {k: v for k, v in params.items() if k != "state"}
                try:
                    rows = conn.execute(
                        text(f"SELECT {mcols} FROM {table} m WHERE {' AND '.join(where_no_state)} LIMIT :lim"),
                        params_no_state,
                    ).fetchall()
                except Exception:
                    rows = []
            parsed: list[dict[str, Any]] = []
            for r in rows:
                parsed.append({col: r[i] for i, col in enumerate(cols)})
            if parsed:
                out[table] = parsed
    return out


def _sql_map_context(table_rows: dict[str, list[dict[str, Any]]]) -> str:
    blocks: list[str] = []
    for table, rows in table_rows.items():
        lines = [f"[{table}] ({len(rows)} rows)"]
        for r in rows:
            parts = []
            for k, v in r.items():
                if v is None or str(v).strip() == "":
                    continue
                parts.append(f"{k}={v}")
            if parts:
                lines.append("- " + "; ".join(parts))
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks).strip()


def _program_name_tokens(name: str) -> list[str]:
    toks = [t for t in re.findall(r"[a-z0-9]{3,}", (name or "").lower()) if t not in {"loan", "program", "correspondent", "standard", "doc"}]
    return toks[:4]


def _hit_mentions_program(hit: Any, program_name: str) -> bool:
    payload = hit.payload or {}
    text = f"{payload.get('section_path','')} {payload.get('heading_level_1','')} {payload.get('heading_level_2','')} {payload.get('text','')}".lower()
    toks = _program_name_tokens(program_name)
    if not toks:
        return True
    matched = sum(1 for t in toks if t in text)
    return matched >= min(2, len(toks))


_LENDER_DISPLAY_NAMES: dict[int, str] = {
    1: "Denali (NQM Funding)",
    2: "Everest (Deephaven)",
    3: "Summit (Verus)",
}

_LENDER_KEY_DISPLAY: dict[str, str] = {
    "nqm": "Denali (NQM Funding)",
    "everest": "Everest (Deephaven)",
    "versus": "Summit (Verus)",
}


def _lender_display_name(lender_id: int | None, lender_key: str) -> str:
    if lender_id is not None and lender_id in _LENDER_DISPLAY_NAMES:
        return _LENDER_DISPLAY_NAMES[lender_id]
    key = (lender_key or "").lower()
    return _LENDER_KEY_DISPLAY.get(key, "the lender")


# Mortgage topic aliases → guideline heading / search phrases
_GUIDELINE_TOPIC_ALIASES: list[tuple[str, list[str]]] = [
    (r"delayed\s+financ", ["CASH-OUT REFINANCE", "cash-out refinance owned less than 6 months", "delayed financing"]),
    (r"prepayment|prepay|points\s+and\s+fees|penalty\s+structure", ["PREPAYMENT", "POINTS AND FEES", "prepayment penalties points and fees"]),
    (r"debt\s+consolidat", ["DEBT CONSOLIDATION", "debt consolidation cash-out refinance"]),
    (r"escrow\s+waiver|escrow\s+waivers", ["ESCROW WAIVERS", "escrow waivers HPML"]),
    (r"residual\s+income", ["RESIDUAL INCOME", "residual income requirements"]),
    (r"credit\s+score|tradeline|qualifying\s+fico", ["CREDIT SCORE", "TRADELINE", "qualifying credit score"]),
    (r"co.?borrower|additional\s+borrower|primary\s+wage\s+earner|representative\s+score", ["QUALIFYING CREDIT SCORE", "qualifying credit score primary wage earner"]),
    (r"self.?employ", ["SELF-EMPLOY", "self-employment income"]),
    (r"cash[- ]?out\s+refi", ["CASH-OUT REFINANCE", "cash-out refinance"]),
]


def _expand_guideline_query(query: str) -> list[str]:
    q = query.strip()
    if not q:
        return [query]
    expansions = [q]
    low = q.lower()
    for pattern, phrases in _GUIDELINE_TOPIC_ALIASES:
        if re.search(pattern, low):
            expansions.extend(phrases)
    # Preserve ALL-CAPS section titles from the user question (e.g. "PREPAYMENT PENALTIES, POINTS, AND FEES")
    for m in re.finditer(r"[A-Z][A-Z0-9\s,\-&/]{3,}", q):
        phrase = re.sub(r"\s+", " ", m.group()).strip(" ,")
        if len(phrase) > 3:
            expansions.append(phrase)
            # Also add the first significant word for heading MatchText
            first = phrase.split()[0]
            if len(first) > 3:
                expansions.append(first)
    return list(dict.fromkeys(expansions))[:8]


def _guideline_heading_search_terms(query: str) -> list[str]:
    terms: list[str] = []
    low = query.lower()
    for pattern, phrases in _GUIDELINE_TOPIC_ALIASES:
        if re.search(pattern, low):
            terms.extend(phrases[:2])
    for m in re.finditer(r"[A-Z][A-Z0-9\s,\-&/]{3,}", query):
        phrase = re.sub(r"\s+", " ", m.group()).strip(" ,")
        if len(phrase) > 3:
            terms.append(phrase[:48])
            first = phrase.split()[0]
            if len(first) > 3:
                terms.append(first)
    # Fallback: significant words from the question
    for w in re.findall(r"[a-z]{4,}", low):
        if w not in {"what", "when", "where", "which", "program", "requirements", "requirement", "guidelines"}:
            terms.append(w.upper())
    return list(dict.fromkeys(terms))[:6]


def _guideline_hit_blob(hit: Any) -> str:
    pl = hit.payload or {}
    return " ".join(
        str(pl.get(k) or "")
        for k in ("section_path", "heading_level_1", "heading_level_2", "heading_level_3", "text")
    )


def _rerank_guideline_hits(query: str, hits: list[Any]) -> list[Any]:
    qtokens = _tokenize(query)
    low = query.lower()
    alias_tokens: set[str] = set()
    for pattern, phrases in _GUIDELINE_TOPIC_ALIASES:
        if re.search(pattern, low):
            alias_tokens |= _tokenize(" ".join(phrases))

    rescored: list[tuple[float, Any]] = []
    for hit in hits:
        pl = hit.payload or {}
        body = _guideline_hit_blob(hit)
        if _is_toc_like(body):
            continue
        score = float(hit.score or 0.0)
        btokens = _tokenize(body[:2500])
        heading = f"{pl.get('heading_level_1', '')} {pl.get('heading_level_2', '')} {pl.get('heading_level_3', '')}"
        htokens = _tokenize(heading)

        overlap = len(qtokens & btokens)
        heading_overlap = len(qtokens & htokens)
        alias_overlap = len(alias_tokens & htokens) + len(alias_tokens & btokens)

        score += heading_overlap * 0.22
        score += overlap * 0.025
        score += alias_overlap * 0.18

        # Exact heading phrase match is a strong signal
        h2 = str(pl.get("heading_level_2") or "").lower()
        if any(a.lower() in h2 for a in _guideline_heading_search_terms(query)):
            score += 0.35

        rescored.append((score, hit))

    rescored.sort(key=lambda x: x[0], reverse=True)
    return [h for _, h in rescored]


def _build_guideline_context(hits: list[Any]) -> str:
    blocks: list[str] = []
    for i, hit in enumerate(hits, 1):
        pl = hit.payload or {}
        section = " > ".join(
            x for x in (pl.get("heading_level_1"), pl.get("heading_level_2"), pl.get("heading_level_3")) if x
        )
        raw = (pl.get("text") or "").strip()
        text = raw if len(raw) <= 3500 else raw[:3499] + "..."
        blocks.append(f"[{i}] Guideline Section: {section or 'General'}\n{text}")
    return "\n\n---\n\n".join(blocks)


def _is_guideline_primary_question(question: str) -> bool:
    """True when the answer should come mainly from lender guideline PDFs."""
    low = _extract_user_question(question).lower()
    return bool(
        re.search(
            r"\b("
            r"prepayment|prepay|points\s+and\s+fees|delayed\s+financ|debt\s+consolidat"
            r"|escrow|compliance|transaction\s+type|residual\s+income|credit\s+score|tradeline"
            r"|self.?employ|income\s+req|documentation|eligible\s+borrower|citizenship"
            r"|gift\s+fund|reserve|subordinate|appraisal|condo|leasehold|vesting"
            r")\b",
            low,
        )
        or _is_guideline_question(question)
    )


def _retrieve_lender_guidelines(
    client: QdrantClient,
    query: str,
    *,
    lender_key: str,
    limit: int = 10,
) -> list[Any]:
    """
    Retrieve from the lender's guideline collection (lender-scoped, no program filter).
    Uses semantic search PLUS heading MatchText lookup so section titles like
    'PREPAYMENT PENALTIES, POINTS, AND FEES' are found reliably.
    """
    guideline_collection = config.program_collection_name_from_key(lender_key)
    dedup: dict[str, Any] = {}

    try:
        # 1) Semantic search with topic-expanded queries
        for eq in _expand_guideline_query(query):
            for hit in retrieve(client, eq, limit=max(8, limit), collection_name=guideline_collection):
                rid = str(getattr(hit, "id", ""))
                existing = dedup.get(rid)
                if existing is None or (hit.score or 0) > (existing.score or 0):
                    dedup[rid] = hit

        # 2) Heading MatchText — direct lookup by section title
        for term in _guideline_heading_search_terms(query):
            try:
                flt = models.Filter(
                    should=[
                        models.FieldCondition(key="heading_level_2", match=models.MatchText(text=term)),
                        models.FieldCondition(key="heading_level_1", match=models.MatchText(text=term)),
                        models.FieldCondition(key="section_path", match=models.MatchText(text=term)),
                    ]
                )
                pts = client.query_points(
                    collection_name=guideline_collection,
                    query=embed_query(query),
                    query_filter=flt,
                    limit=6,
                    with_payload=True,
                ).points
                for hit in pts:
                    rid = str(getattr(hit, "id", ""))
                    existing = dedup.get(rid)
                    if existing is None or (hit.score or 0) > (existing.score or 0):
                        dedup[rid] = hit
            except Exception:
                continue

        ranked = _rerank_guideline_hits(query, list(dedup.values()))
        return ranked[:limit]
    except Exception:
        return []


_SQL_KEYWORD_STOPWORDS = frozenset(
    {
        "what", "when", "where", "which", "program", "programs", "requirements", "requirement",
        "guidelines", "about", "tell", "does", "have", "this", "that", "with", "from", "your",
        "there", "their", "they", "would", "could", "should", "been", "being", "also", "maximum",
        "minimum", "allowed", "allow", "eligible", "eligibility",
    }
)


def _sql_question_keywords(question: str) -> list[str]:
    return [
        w
        for w in re.findall(r"[a-z0-9]{4,}", (question or "").lower())
        if w not in _SQL_KEYWORD_STOPWORDS
    ][:6]


def _sql_keyword_filter_clause(question: str, table: str) -> tuple[str, dict[str, Any]] | None:
    """Optional LIKE filter for large narrative SQL tables."""
    if table not in ("map_program_rule_guideline", "map_program_doc_req_details"):
        return None
    low = (question or "").lower()
    if re.search(r"\b(co.?borrower|co borrower|additional\s+borrower|non.?occupant)\b", low):
        return None
    terms = _sql_question_keywords(question)
    if not terms:
        return None
    parts: list[str] = []
    params: dict[str, Any] = {}
    for i, term in enumerate(terms):
        key = f"kw{i}"
        params[key] = f"%{term}%"
        parts.append(f"(LOWER(m.category) LIKE :{key} OR LOWER(m.content) LIKE :{key})")
    return f"({' OR '.join(parts)})", params


def _fetch_sql_map_rows_all_programs(
    tables: list[str],
    *,
    question: str,
    scenario_summary: str | None = None,
    max_rows_per_table: int = 120,
) -> dict[str, list[dict[str, Any]]]:
    """Fetch question-routed SQL rows across all lenders/programs."""
    engine = _get_sql_engine()
    out: dict[str, list[dict[str, Any]]] = {}
    state_filter = _parse_state_from_scenario_summary(scenario_summary)

    with engine.connect() as conn:
        for table in tables:
            if table == "dim_programs":
                try:
                    rows = conn.execute(
                        text(
                            """
                            SELECT dp.program_id, dp.lender_id, dl.lender_name, dl.brand_name,
                                   COALESCE(NULLIF(TRIM(dp.program_name_np), ''), dp.program_name) AS program_name_np,
                                   dp.program_code, dp.fico_min, dp.fico_max,
                                   dp.loan_amt_min, dp.loan_amt_max, dp.max_dti,
                                   dp.occupancy_types, dp.doc_types_allowed, dp.is_dscr_program
                            FROM dim_programs dp
                            JOIN dim_lenders dl ON dl.id = dp.lender_id
                            WHERE dp.is_active = 1
                            ORDER BY dp.lender_id, dp.program_id
                            """
                        )
                    ).fetchall()
                    cols = [
                        "program_id", "lender_id", "lender_name", "brand_name", "program_name_np",
                        "program_code", "fico_min", "fico_max", "loan_amt_min", "loan_amt_max", "max_dti",
                        "occupancy_types", "doc_types_allowed", "is_dscr_program",
                    ]
                    parsed = [{col: r[i] for i, col in enumerate(cols)} for r in rows]
                    if parsed:
                        out[table] = parsed
                except Exception:
                    pass
                continue

            spec = _SQL_MAP_TABLES.get(table)
            if not spec:
                continue

            cols = list(spec["columns"])
            mcols = ", ".join(f"m.{c}" for c in cols)
            where = ["1=1"]
            params: dict[str, Any] = {"lim": int(max_rows_per_table)}

            if table == "map_geographic_restrictions" and state_filter:
                where.append("m.state = :state")
                params["state"] = state_filter.upper()

            kw_filter = _sql_keyword_filter_clause(question, table)
            if kw_filter:
                where.append(kw_filter[0])
                params.update(kw_filter[1])

            if spec.get("needs_lender"):
                lender_join = "dl.id = m.lender_id"
            else:
                lender_join = "dl.id = dp.lender_id"

            sql = f"""
                SELECT {mcols},
                       COALESCE(NULLIF(TRIM(dp.program_name_np), ''), dp.program_name) AS program_name_np,
                       dl.lender_name, dl.brand_name
                FROM {table} m
                LEFT JOIN dim_programs dp ON dp.program_id = m.program_id
                LEFT JOIN dim_lenders dl ON {lender_join}
                WHERE {' AND '.join(where)}
                ORDER BY dl.id, m.program_id
                LIMIT :lim
            """
            try:
                rows = conn.execute(text(sql), params).fetchall()
            except Exception:
                continue

            extra_cols = cols + ["program_name_np", "lender_name", "brand_name"]
            parsed = [{col: r[i] for i, col in enumerate(extra_cols)} for r in rows]
            if parsed:
                out[table] = parsed
    return out


def _sql_map_context_all_programs(table_rows: dict[str, list[dict[str, Any]]]) -> str:
    blocks: list[str] = []
    for table, rows in table_rows.items():
        lines = [f"[{table}] ({len(rows)} rows across all lenders/programs)"]
        for r in rows:
            lender = r.get("lender_name") or r.get("brand_name") or ""
            program = r.get("program_name_np") or r.get("program_name") or f"program_id={r.get('program_id')}"
            prefix = f"{lender} / {program}".strip(" /")
            parts = []
            for k, v in r.items():
                if k in ("lender_name", "brand_name", "program_name_np", "program_name"):
                    continue
                if v is None or str(v).strip() == "":
                    continue
                parts.append(f"{k}={v}")
            if parts:
                lines.append(f"- [{prefix}] " + "; ".join(parts))
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks).strip()


def _retrieve_all_matrices(client: QdrantClient, query: str, *, limit: int = 12) -> list[Any]:
    try:
        hits = retrieve(client, query, limit=max(12, limit * 2), collection_name=config.matrix_collection_name())
        clean = [h for h in hits if not _is_toc_like((h.payload or {}).get("text") or "")]
        return _rerank_hits(query, clean or hits)[:limit]
    except Exception:
        return []


def _retrieve_all_guidelines(client: QdrantClient, query: str, *, limit: int = 15) -> list[Any]:
    dedup: dict[str, Any] = {}
    per_lender = max(5, limit // max(1, len(get_program_map())))
    for lender_key in get_program_map():
        for hit in _retrieve_lender_guidelines(client, query, lender_key=lender_key, limit=per_lender):
            rid = str(getattr(hit, "id", ""))
            existing = dedup.get(rid)
            if existing is None or (hit.score or 0) > (existing.score or 0):
                dedup[rid] = hit
    ranked = _rerank_guideline_hits(query, list(dedup.values()))
    return ranked[:limit]


def _build_matrix_context(hits: list[Any]) -> str:
    blocks: list[str] = []
    for i, hit in enumerate(hits, 1):
        pl = hit.payload or {}
        prog = pl.get("program_name") or f"program_id={pl.get('program_id')}"
        lender_id = pl.get("lender_id")
        try:
            lender_name = _LENDER_DISPLAY_NAMES.get(int(lender_id), f"Lender {lender_id}")
        except (TypeError, ValueError):
            lender_name = "Unknown lender"
        raw = (pl.get("text") or "").strip()
        text = raw if len(raw) <= 3500 else raw[:3499] + "..."
        blocks.append(f"[{i}] Matrix — {prog} ({lender_name})\n{text}")
    return "\n\n---\n\n".join(blocks)


def _build_guideline_context_all_lenders(hits: list[Any]) -> str:
    blocks: list[str] = []
    for i, hit in enumerate(hits, 1):
        pl = hit.payload or {}
        lender_id = pl.get("lender_id")
        try:
            lender_name = _LENDER_DISPLAY_NAMES.get(int(lender_id), "Lender guidelines")
        except (TypeError, ValueError):
            lender_name = "Lender guidelines"
        section = " > ".join(
            x for x in (pl.get("heading_level_1"), pl.get("heading_level_2"), pl.get("heading_level_3")) if x
        )
        raw = (pl.get("text") or "").strip()
        text = raw if len(raw) <= 3500 else raw[:3499] + "..."
        blocks.append(f"[{i}] {lender_name} — {section or 'General'}\n{text}")
    return "\n\n---\n\n".join(blocks)



def _parse_fico_from_scenario(scenario_summary: str | None) -> int | None:
    if not scenario_summary:
        return None
    m = re.search(r"FICO\s*=\s*(\d{3})", scenario_summary, re.I)
    if not m:
        return None
    try:
        val = int(m.group(1))
    except ValueError:
        return None
    return val if 300 <= val <= 850 else None


def _parse_fico_scores_from_question(question: str) -> dict[str, Any]:
    """Extract primary and co-borrower FICO scores from a free-text question."""
    q = (question or "").strip()
    low = q.lower()
    scores = [
        int(m)
        for m in re.findall(r"\b([3-8]\d{2})\b", q)
        if 300 <= int(m) <= 850
    ]

    primary_fico: int | None = None
    co_fico: int | None = None

    co_match = re.search(
        r"(?:co[- ]?borrower|co borrower|additional borrower)[^.]{0,120}?(?:fico|credit\s+score|score)?[^0-9]{0,20}(\d{3})",
        low,
    )
    if co_match:
        co_fico = int(co_match.group(1))

    self_match = re.search(
        r"(?:and i have|my fico|my credit|i have a fico of|i'm at|i am at)[^.]{0,60}?(?:fico|credit\s+score|score)?[^0-9]{0,20}(\d{3})",
        low,
    )
    if self_match:
        primary_fico = int(self_match.group(1))

    if len(scores) >= 2:
        ordered = sorted(scores, reverse=True)
        if co_fico is not None and primary_fico is None:
            primary_fico = next((s for s in ordered if s != co_fico), ordered[0])
        elif primary_fico is not None and co_fico is None:
            co_fico = next((s for s in ordered if s != primary_fico), ordered[-1])
        elif primary_fico is None and co_fico is None:
            primary_fico, co_fico = ordered[0], ordered[1]
    elif len(scores) == 1:
        lone = scores[0]
        if co_fico is not None and lone != co_fico:
            primary_fico = lone
        elif primary_fico is None and co_fico is None:
            primary_fico = lone

    has_co_borrower = bool(
        re.search(r"\bco[- ]?borrower|co borrower|additional borrower\b", low)
        or co_fico is not None
    )
    equal_income = bool(re.search(r"\bequal\s+(?:qualifying\s+)?income\b", low))

    return {
        "primary_fico": primary_fico,
        "co_borrower_fico": co_fico,
        "all_scores": scores,
        "has_co_borrower": has_co_borrower,
        "equal_income": equal_income,
    }


def _is_hypothetical_scenario_question(question: str, scenario_summary: str | None = None) -> bool:
    low = (question or "").lower()
    if re.search(
        r"\b(what if|what happens if|suppose|hypothetically|if i had|if my|if we had|if our)\b",
        low,
    ):
        return True
    if re.search(r"\bco[- ]?borrower|additional borrower\b", low) and re.search(
        r"\b(fico|credit score|score)\b", low
    ):
        return True
    ficos = _parse_fico_scores_from_question(question)
    if ficos.get("all_scores") and scenario_summary:
        base_fico = _parse_fico_from_scenario(scenario_summary)
        if base_fico is not None and any(s != base_fico for s in ficos["all_scores"]):
            return True
    return False


def _is_scenario_eligibility_question(question: str) -> bool:
    low = (question or "").lower()
    return bool(
        re.search(
            r"\b("
            r"what programs|which programs|programs are we|programs am i|programs can we"
            r"|eligible for|eligibility|qualify for|can we qualify|can i qualify|can we get|can i get"
            r"|what options|what are our options"
            r")\b",
            low,
        )
    )


def _eligibility_request_is_dscr(req: dict[str, Any]) -> bool:
    if (req.get("dscr") or "").strip():
        return True
    occ = (req.get("occupancy") or "").lower()
    return "investment" in occ and not (req.get("documentationType") or "").strip()


def _resolve_qualifying_fico(
    *,
    primary_fico: int | None,
    co_borrower_fico: int | None,
    is_dscr_path: bool,
    equal_income: bool = False,
) -> tuple[int | None, str]:
    scores = [s for s in (primary_fico, co_borrower_fico) if s is not None]
    if not scores:
        return None, ""
    if co_borrower_fico is None:
        return primary_fico, "Single borrower — representative score applies."

    if is_dscr_path:
        q = max(scores)
        return q, (
            f"DSCR path: highest representative score ({q}) is used for qualifying "
            f"(except DSCR No Ratio programs, which use the lowest score)."
        )

    if equal_income:
        q = max(scores)
        return q, f"Equal qualifying income across borrowers: highest representative score ({q}) is used."

    if primary_fico is not None:
        return (
            primary_fico,
            "Income documentation path: the primary wage earner's representative score "
            f"({primary_fico}) is used for qualifying. A co-borrower's lower score does not "
            "change qualifying FICO unless they are the primary wage earner.",
        )

    q = max(scores)
    return q, f"Highest representative score ({q}) used when wage earner is unclear."


def _eligibility_result_to_chat_payload(
    result: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], int]:
    eligible: list[dict[str, Any]] = []
    for r in result.get("eligible") or []:
        eligible.append(
            {
                "investor": r.get("lender") or r.get("investor") or "",
                "investor_name": r.get("lender_name") or r.get("investor_name") or "",
                "program_name": r.get("program_name") or "",
                "program_name_np": r.get("program_name_np"),
                "is_dscr": bool(r.get("is_dscr")),
                "is_itin": bool(r.get("is_itin")),
                "is_foreign_nat": bool(r.get("is_foreign_nat")),
                "min_fico": r.get("min_fico"),
                "max_loan": r.get("max_loan"),
                "max_ltv_purchase": r.get("max_ltv_purchase"),
                "max_ltv_rate_term": r.get("max_ltv_refi"),
                "max_ltv_cashout": r.get("max_ltv_cashout"),
                "max_dti": r.get("max_dti"),
                "min_dscr": r.get("min_dscr"),
                "doc_type": r.get("doc_type"),
                "occupancy": r.get("occupancy_code"),
                "doc_types_allowed": r.get("doc_types_allowed"),
                "special_overlay": r.get("special_overlay"),
                "program_id": r.get("program_id"),
            }
        )

    def _exclusions(key: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for r in result.get(key) or []:
            if isinstance(r, dict):
                out.append(
                    {
                        "program_name": str(r.get("program_name") or ""),
                        "reason": str(r.get("reason") or ""),
                    }
                )
        return out

    return (
        eligible,
        _exclusions("geo_exclusions"),
        _exclusions("overlay_exclusions"),
        int(result.get("total_screened") or 0),
    )


class HypotheticalRescreenMeta(TypedDict, total=False):
    is_hypothetical: bool
    rescreened: bool
    qualifying_fico: int | None
    rule_note: str
    primary_fico: int | None
    co_borrower_fico: int | None
    equal_income: bool
    is_dscr_path: bool


def _empty_hypo_meta(*, is_hypothetical: bool = False, rescreened: bool = False) -> HypotheticalRescreenMeta:
    return {"is_hypothetical": is_hypothetical, "rescreened": rescreened}


def _maybe_rescreen_hypothetical_scenario(
    *,
    user_question: str,
    scenario_summary: str | None,
    eligibility_request: dict[str, Any] | None,
    matched_programs: list[dict[str, Any]] | None,
    geo_exclusions: list[dict[str, Any]] | None,
    overlay_exclusions: list[dict[str, Any]] | None,
    total_screened: int | None,
) -> tuple[
    list[dict[str, Any]] | None,
    list[dict[str, Any]] | None,
    list[dict[str, Any]] | None,
    int | None,
    str,
    HypotheticalRescreenMeta,
]:
    """
    Re-run eligibility when the user asks a what-if that changes FICO / co-borrower facts.
    Returns (matched, geo, overlay, total, header_note, meta).
    """
    hypothetical = _is_hypothetical_scenario_question(user_question, scenario_summary)
    if not hypothetical:
        return matched_programs, geo_exclusions, overlay_exclusions, total_screened, "", _empty_hypo_meta()

    ficos = _parse_fico_scores_from_question(user_question)
    scenario_elig_q = _is_scenario_eligibility_question(user_question)

    if not eligibility_request:
        if scenario_elig_q:
            note = (
                "=== Hypothetical Scenario — prior results STALE ===\n"
                "The user changed scenario facts (e.g. co-borrower FICO) in their question. "
                "Do NOT treat any prior Eligibility Engine Results as authoritative.\n"
                "Answer from Qualifying Credit Score guidelines and program matrix min FICO rules.\n"
                "Do NOT invent minimum FICO requirements for co-borrowers unless explicitly in context.\n"
            )
            return None, None, None, None, note, _empty_hypo_meta(is_hypothetical=True)
        return (
            matched_programs,
            geo_exclusions,
            overlay_exclusions,
            total_screened,
            "",
            _empty_hypo_meta(is_hypothetical=True),
        )

    is_dscr = _eligibility_request_is_dscr(eligibility_request)
    qualifying, rule_note = _resolve_qualifying_fico(
        primary_fico=ficos.get("primary_fico"),
        co_borrower_fico=ficos.get("co_borrower_fico"),
        is_dscr_path=is_dscr,
        equal_income=bool(ficos.get("equal_income")),
    )
    if qualifying is None:
        return (
            matched_programs,
            geo_exclusions,
            overlay_exclusions,
            total_screened,
            "",
            _empty_hypo_meta(is_hypothetical=True),
        )

    modified = dict(eligibility_request)
    modified["decisionCreditScore"] = str(qualifying)
    if ficos.get("has_co_borrower"):
        modified["nonOccupantCoBorrower"] = modified.get("nonOccupantCoBorrower") or "Yes"
    if ficos.get("co_borrower_fico") is not None:
        modified["noCbFico"] = str(ficos["co_borrower_fico"])

    from backend.eligibility import find_eligible_programs

    try:
        result = find_eligible_programs(modified, quick=True)
    except Exception:
        return (
            matched_programs,
            geo_exclusions,
            overlay_exclusions,
            total_screened,
            "",
            _empty_hypo_meta(is_hypothetical=True),
        )

    fresh_matched, fresh_geo, fresh_overlay, fresh_total = _eligibility_result_to_chat_payload(result)
    note = (
        "=== Hypothetical Scenario Re-screen (AUTHORITATIVE for this answer) ===\n"
        "The user asked a what-if that changes credit scores. Original wizard eligibility is STALE.\n"
        f"Qualifying FICO used for re-screen: {qualifying}. {rule_note}\n"
        f"Primary borrower FICO from question: {ficos.get('primary_fico')}; "
        f"Co-borrower FICO from question: {ficos.get('co_borrower_fico')}.\n"
        "Do NOT invent separate minimum FICO rules for co-borrowers unless explicitly in guidelines.\n"
    )
    return fresh_matched, fresh_geo, fresh_overlay, fresh_total, note, {
        "is_hypothetical": True,
        "rescreened": True,
        "qualifying_fico": qualifying,
        "rule_note": rule_note,
        "primary_fico": ficos.get("primary_fico"),
        "co_borrower_fico": ficos.get("co_borrower_fico"),
        "equal_income": bool(ficos.get("equal_income")),
        "is_dscr_path": is_dscr,
    }


def _is_co_borrower_fico_eligibility_question(question: str) -> bool:
    low = (question or "").lower()
    return bool(
        re.search(r"\bco[- ]?borrower|additional borrower\b", low)
        and re.search(r"\b(fico|credit score|score)\b", low)
        and _is_scenario_eligibility_question(question)
    )


def _format_deterministic_program_line(prog: dict[str, Any]) -> str:
    name = (prog.get("program_name_np") or prog.get("program_name") or "Unknown").strip()
    lender = (prog.get("investor_name") or prog.get("investor") or "").strip()
    label = f"**{name}** ({lender})" if lender else f"**{name}**"
    metrics: list[str] = []
    if prog.get("min_fico") is not None:
        metrics.append(f"min FICO {prog['min_fico']}")
    if prog.get("max_loan") is not None:
        try:
            metrics.append(f"max loan ${int(prog['max_loan']):,}")
        except (TypeError, ValueError):
            pass
    if prog.get("max_dti") is not None:
        metrics.append(f"max DTI {prog['max_dti']}%")
    for key, label_txt in (
        ("max_ltv_purchase", "max LTV purchase"),
        ("max_ltv_rate_term", "max LTV rate/term"),
        ("max_ltv_cashout", "max LTV cash-out"),
    ):
        val = prog.get(key)
        if val is not None and str(val).strip():
            metrics.append(f"{label_txt} {val}%")
    if metrics:
        return f"- {label}: {', '.join(metrics)}"
    return f"- {label}"


def _format_deterministic_matched_programs(programs: list[dict[str, Any]] | None) -> str:
    if not programs:
        return "_No programs matched this what-if scenario._"
    by_lender: dict[str, list[dict[str, Any]]] = {}
    for prog in programs:
        lender = (prog.get("investor_name") or prog.get("investor") or "Other").strip()
        by_lender.setdefault(lender, []).append(prog)
    lines: list[str] = []
    for lender in sorted(by_lender.keys()):
        lines.append(f"**{lender}**")
        for prog in by_lender[lender]:
            lines.append(_format_deterministic_program_line(prog))
    return "\n".join(lines)


def _hypothetical_fico_guideline_caveats(
    guideline_context: str,
    meta: HypotheticalRescreenMeta,
) -> str:
    """Short LLM pass for tradeline / multi-borrower caveats — guidelines only, no program list."""
    if not guideline_context.strip() or not config.OPENAI_API_KEY:
        return ""
    qualifying = meta.get("qualifying_fico")
    prompt = (
        "Write 1–3 short bullet points of underwriting caveats for a co-borrower FICO what-if. "
        f"Qualifying FICO already determined: {qualifying}. "
        f"Primary FICO: {meta.get('primary_fico')}; co-borrower FICO: {meta.get('co_borrower_fico')}. "
        "Use ONLY the guideline excerpts below.\n"
        "Do NOT name loan programs. Do NOT list excluded programs. "
        "Do NOT invent minimum FICO for additional/co-borrowers unless the excerpt explicitly states it. "
        "Focus on tradeline requirements, representative score rules, or wage-earner assumptions if present.\n"
        "If nothing relevant beyond what was already stated, reply with exactly: NONE"
    )
    raw = answer_with_openai(prompt, guideline_context, valid_programs=[]).strip()
    if not raw or raw.upper() == "NONE":
        return ""
    return raw


def _answer_co_borrower_fico_hypothetical(
    *,
    user_question: str,
    scenario_summary: str | None,
    matched_programs: list[dict[str, Any]] | None,
    geo_exclusions: list[dict[str, Any]] | None,
    overlay_exclusions: list[dict[str, Any]] | None,
    total_screened: int | None,
    meta: HypotheticalRescreenMeta,
    client: QdrantClient,
) -> dict[str, Any]:
    """Deterministic co-borrower FICO what-if answer — avoids LLM inventing exclusion lists."""
    qualifying = meta.get("qualifying_fico")
    rule_note = (meta.get("rule_note") or "").strip()
    primary = meta.get("primary_fico")
    cob = meta.get("co_borrower_fico")
    matched_n = len(matched_programs or [])

    lines: list[str] = [
        f"**Qualifying FICO for this what-if: {qualifying}**",
        "",
        rule_note,
    ]
    if primary is not None and cob is not None:
        lines.append(f"(Your FICO: {primary}; co-borrower FICO: {cob}.)")
    lines.extend(["", "**Important caveats:**"])

    if meta.get("is_dscr_path"):
        lines.append(
            "- Most DSCR programs use the **highest** representative score; "
            "**DSCR No Ratio** uses the **lowest** — confirm which path applies."
        )
    elif meta.get("equal_income"):
        lines.append("- Equal qualifying income: the **highest** representative score applies.")
    else:
        lines.append(
            "- This answer assumes **you** are the primary wage earner (your score drives qualifying)."
        )
        lines.append(
            "- If the co-borrower is the primary wage earner instead, qualifying FICO would be their score."
        )
        lines.append(
            "- If qualifying incomes are **equal**, the **highest** representative score applies — not the lower one."
        )

    guideline_hits = _retrieve_all_guidelines(
        client,
        "QUALIFYING CREDIT SCORE primary wage earner representative score tradeline co-borrower",
        limit=10,
    )
    guideline_context = _build_guideline_context_all_lenders(guideline_hits) if guideline_hits else ""
    llm_caveats = _hypothetical_fico_guideline_caveats(guideline_context, meta)
    if llm_caveats:
        lines.append("")
        lines.append(llm_caveats)

    lines.extend(["", f"**Matched programs ({matched_n}):**", ""])
    lines.append(_format_deterministic_matched_programs(matched_programs))

    screened = int(total_screened or 0)
    if screened > matched_n:
        lines.extend(
            [
                "",
                f"_{matched_n} of {screened} programs matched your wizard scenario. "
                "Other programs were screened but did not fit (occupancy, doc type, LTV, DTI, loan amount, or other matrix gates). "
                "Specific per-program exclusion reasons were **not** captured for those non-matches — "
                "they are not listed here because we cannot confirm why each failed._",
            ]
        )

    documented = (geo_exclusions or []) + (overlay_exclusions or [])
    if documented:
        lines.extend(["", "**Documented exclusions (from eligibility engine):**"])
        for ex in documented:
            lines.append(f"- {ex.get('program_name', 'Program')}: {ex.get('reason', '')}")

    reply = _strip_citations_and_sources(_clean_answer_text("\n".join(lines).strip()))
    sources: list[dict[str, Any]] = [
        {
            "index": 0,
            "path": "eligibility_engine",
            "text": f"{matched_n} matched (hypothetical co-borrower FICO re-screen)",
            "layout": "prose",
            "score": None,
        }
    ]
    sources.extend(hits_to_sources(guideline_hits, preview_max_chars=220))
    return {
        "reply": reply,
        "sources": sources,
        "used_llm": bool(llm_caveats),
        "program": None,
        "collection": "hypothetical eligibility re-screen + qualifying credit guidelines",
    }


def _needs_eligibility_context(question: str, *, is_hypothetical: bool = False) -> bool:
    """Only inject wizard eligibility results when the user is asking about matching/exclusions."""
    low = (question or "").lower()
    if is_hypothetical and _is_scenario_eligibility_question(question):
        return True
    if _is_eligibility_explanation_question(question):
        return True
    if _is_scenario_eligibility_question(question):
        return True
    if re.search(
        r"\b("
        r"matched programs?|my results|results table|programs you (?:showed|suggested|matched)"
        r"|from (?:my|the) (?:results|matches)|across my programs"
        r")\b",
        low,
    ):
        return True
    return False


def _is_eligibility_explanation_question(question: str) -> bool:
    low = (question or "").lower()
    return bool(
        re.search(
            r"\b("
            r"why|reason|not suggested|not included|not shown|not listed|not matched|didn.?t match"
            r"|excluded|other programs|weren.?t|where not|why any|why only|why just"
            r")\b",
            low,
        )
    )


def _format_eligibility_results_context(
    *,
    matched_programs: list[dict[str, Any]] | None,
    geo_exclusions: list[dict[str, Any]] | None,
    overlay_exclusions: list[dict[str, Any]] | None,
    total_screened: int | None,
    header_prefix: str = "",
) -> str:
    """Format the eligibility engine output — authoritative for matched vs excluded programs."""
    if not matched_programs and not geo_exclusions and not overlay_exclusions and not header_prefix:
        return ""

    out_lines: list[str] = []
    if header_prefix.strip():
        out_lines.append(header_prefix.strip())
    out_lines.append(
        "=== Eligibility Engine Results (AUTHORITATIVE — use this for matched/excluded programs) ==="
    )
    if total_screened is not None:
        out_lines.append(f"Total programs screened: {total_screened}")
    if matched_programs is not None:
        out_lines.append(f"Matched programs ({len(matched_programs)}):")
        for p in matched_programs:
            name = (p.get("program_name_np") or p.get("program_name") or "Unknown").strip()
            investor = (p.get("investor_name") or p.get("investor") or "").strip()
            parts = [f"{name} ({investor})" if investor else name]
            if p.get("program_id") is not None:
                parts.append(f"program_id={p['program_id']}")
            for key in (
                "min_fico", "max_loan", "max_dti", "min_dscr",
                "max_ltv_purchase", "max_ltv_rate_term", "max_ltv_cashout",
                "doc_type", "occupancy", "doc_types_allowed", "is_dscr", "is_itin", "is_foreign_nat",
            ):
                val = p.get(key)
                if val is not None and str(val).strip() != "":
                    parts.append(f"{key}={val}")
            overlay = (p.get("special_overlay") or "").strip()
            if overlay:
                parts.append(f"overlay={overlay[:200]}")
            out_lines.append("- " + "; ".join(parts))

    if geo_exclusions:
        out_lines.append(f"\nGeographic exclusions ({len(geo_exclusions)}):")
        for ex in geo_exclusions:
            out_lines.append(f"- {ex.get('program_name', 'Program')}: {ex.get('reason', '')}")

    if overlay_exclusions:
        out_lines.append(f"\nOverlay / credit / matrix exclusions ({len(overlay_exclusions)}):")
        for ex in overlay_exclusions:
            out_lines.append(f"- {ex.get('program_name', 'Program')}: {ex.get('reason', '')}")

    return "\n".join(out_lines).strip()


def _extract_scenario_summary_from_message(message: str) -> str | None:
    m = re.search(r"Loan scenario:\s*(.+?)(?:\n\nBorrower question:|\Z)", message, re.I | re.S)
    return m.group(1).strip() if m else None


def _retrieve_program_matrices(
    client: QdrantClient,
    query: str,
    *,
    lender_key: str,
    program_mysql_id: int,
    limit: int = 6,
) -> list[Any]:
    del lender_key  # scope by program_mysql_id only (unique across catalog)
    try:
        qfilter = models.Filter(
            must=[
                models.FieldCondition(
                    key="program_mysql_id",
                    match=models.MatchValue(value=int(program_mysql_id)),
                ),
            ]
        )
        hits = retrieve(
            client,
            query,
            limit=max(8, limit * 2),
            collection_name=config.matrix_collection_name(),
            query_filter=qfilter,
        )
        clean = [h for h in hits if not _is_toc_like((h.payload or {}).get("text") or "")]
        return _rerank_hits(query, clean or hits)[:limit]
    except Exception:
        return []


def _chat_selected_program_strict(
    message: str,
    selected_meta: dict[str, Any],
    *,
    scenario_summary: str | None = None,
) -> dict[str, Any]:
    """
    Selected program: question-routed SQL for this program_id, lender guidelines,
    and program-scoped matrix Qdrant points, then synthesize a scoped answer.
    """
    user_question = _extract_user_question(message)
    if not user_question.strip():
        return {"reply": "", "sources": [], "used_llm": False, "empty": True}

    program_id = int(selected_meta["program_mysql_id"])
    lender_key = str(selected_meta.get("lender_key") or "")
    lender_id_raw = selected_meta.get("lender_id")
    lender_id_int = int(lender_id_raw) if lender_id_raw is not None else None
    program_name = str(
        selected_meta.get("program_name_np")
        or selected_meta.get("program_name")
        or f"program_id={program_id}"
    )
    lender_display = _lender_display_name(lender_id_int, lender_key)
    scenario_summary = scenario_summary or _extract_scenario_summary_from_message(message)

    _, sql_tables = _route_selected_program_query(message)
    table_rows = _fetch_sql_map_rows_for_program(
        lender_id_int,
        program_id,
        sql_tables,
        question=user_question,
        scenario_summary=scenario_summary,
    )
    sql_context = _sql_map_context(table_rows) if table_rows else ""
    sql_sources = [
        {
            "index": i + 1,
            "path": t,
            "text": f"{len(rows)} SQL rows ({program_name})",
            "layout": "prose",
            "score": None,
        }
        for i, (t, rows) in enumerate(table_rows.items())
    ]

    client = get_engine()
    guideline_query = user_question
    if re.search(r"\bco[- ]?borrower|fico|credit score\b", user_question, re.I):
        guideline_query = (
            f"{user_question} qualifying credit score primary wage earner representative score"
        )

    guideline_hits = _retrieve_lender_guidelines(
        client,
        guideline_query,
        lender_key=lender_key,
        limit=12 if _is_guideline_primary_question(user_question) else 8,
    )
    guideline_context = _build_guideline_context(guideline_hits) if guideline_hits else ""
    guideline_sources = hits_to_sources(guideline_hits, preview_max_chars=220)

    matrix_hits = _retrieve_program_matrices(
        client,
        user_question,
        lender_key=lender_key,
        program_mysql_id=program_id,
        limit=6,
    )
    matrix_context = _build_matrix_context(matrix_hits) if matrix_hits else ""
    matrix_sources = hits_to_sources(matrix_hits, preview_max_chars=220)

    has_sql = bool(sql_context)
    has_guidelines = bool(guideline_context)
    has_matrix = bool(matrix_context)

    if not has_sql and not has_guidelines and not has_matrix:
        return {
            "reply": CONTACT_REPRESENTATIVE_REPLY,
            "sources": [],
            "used_llm": False,
            "program": get_program_map().get(lender_key) or program_name,
            "collection": (
                f"{config.program_collection_name_from_key(lender_key)} + "
                f"{config.matrix_collection_name()} (selected: {program_name})"
            ),
        }

    context_parts: list[str] = []
    if has_sql:
        context_parts.append(
            f"=== {program_name} — Structured SQL Data ===\n{sql_context}"
        )
    if has_matrix:
        context_parts.append(
            f"=== {program_name} — Matrix Summary (Qdrant) ===\n{matrix_context}"
        )
    if has_guidelines:
        context_parts.append(
            f"=== {lender_display} — Underwriting Guidelines (Qdrant) ===\n{guideline_context}"
        )
    combined_ctx = "\n\n".join(context_parts)

    scenario_block = ""
    if scenario_summary and scenario_summary.strip():
        scenario_block = f"Borrower scenario:\n{scenario_summary.strip()}\n\n"

    strict_question = (
        "You are an expert Non-QM mortgage advisor. The borrower selected "
        f"**{program_name}** ({lender_display}). Answer ONLY about this program.\n\n"
        f"{scenario_block}"
        f"Question:\n{user_question}\n\n"
        "Instructions:\n"
        "- Answer ONLY the question asked.\n"
        "- Use ONLY the context sections below.\n"
        "- FORMAT (required): Start with 1–2 short sentences that directly answer the question.\n"
        "  Then add 3–6 bullet lines, each starting with '- '.\n"
        "  Prefer 'Topic: detail' on each bullet (e.g. '- Co-borrower: Must be a relative…').\n"
        "  Put one rule or requirement per bullet — do NOT write one long paragraph.\n"
        "- Lender-wide guideline rules apply to this program unless matrix/SQL shows a program-specific overlay.\n"
        "- When citing lender-wide policy, say e.g. 'Per Denali (NQM Funding) guidelines…' using the lender name above.\n"
        "- Do NOT mention other programs or lenders.\n"
        "- Do NOT mention lender_id, program_id, or internal database IDs.\n"
        "- Do NOT say 'not found in the provided context' or similar meta phrasing.\n"
        "- If a detail is missing, say briefly that it is not specified for this program.\n"
    )

    valid_programs = [program_name]
    reply = answer_with_openai(strict_question, combined_ctx, valid_programs=valid_programs).strip()
    all_sources = sql_sources + matrix_sources + guideline_sources
    guideline_collection = config.program_collection_name_from_key(lender_key)
    collection_name = f"SQL + {guideline_collection} + mortgage_matrices (selected: {program_name})"

    if reply:
        if _is_rate_question(user_question) and not _context_has_pricing_data(combined_ctx):
            reply = (
                "I don't have live rate-sheet data in the indexed documents, so I can't quote today's interest rate. "
                "I can still explain eligibility and structure options from the retrieved guidelines and matrices. "
                "For exact pricing, please contact an Acme representative."
            )
        else:
            reply = _strip_citations_and_sources(_clean_answer_text(reply))
            reply = _format_program_chat_reply(reply)
        reply = _limit_clarifying_questions(reply, max_questions=0)
        replacement = deflection_reply_if_needed(reply)
        if replacement:
            reply = replacement
        if _llm_answer_looks_grounded(reply):
            return {
                "reply": reply,
                "sources": all_sources,
                "used_llm": True,
                "program": get_program_map().get(lender_key) or program_name,
                "collection": collection_name,
            }
        fallback_hits = guideline_hits or matrix_hits
        return {
            "reply": retrieval_only_answer(user_question, fallback_hits)
            if fallback_hits
            else CONTACT_REPRESENTATIVE_REPLY,
            "sources": all_sources,
            "used_llm": False,
            "program": get_program_map().get(lender_key) or program_name,
            "collection": collection_name,
        }

    return {
        "reply": (
            "No LLM API key is configured. Set OPENAI_API_KEY in `.env` for synthesized answers. "
            "Retrieved excerpts are available in the response metadata."
        ),
        "sources": all_sources,
        "used_llm": False,
        "program": get_program_map().get(lender_key) or program_name,
        "collection": collection_name,
    }


def chat_once_selected_program(
    message: str,
    selected_meta: dict[str, Any],
    *,
    scenario_summary: str | None = None,
) -> dict[str, Any]:
    """Flow 1 — selected program: SQL + guidelines + matrices scoped to one program."""
    return _chat_selected_program_strict(
        message,
        selected_meta,
        scenario_summary=scenario_summary,
    )


def _chat_all_programs_general(
    message: str,
    *,
    scenario_summary: str | None = None,
    matched_programs: list[dict[str, Any]] | None = None,
    geo_exclusions: list[dict[str, Any]] | None = None,
    overlay_exclusions: list[dict[str, Any]] | None = None,
    total_screened: int | None = None,
    eligibility_request: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    No program selected: assemble context from ALL SQL map tables (routed by question),
    all matrix Qdrant points, and all lender guideline collections, then answer.
    """
    user_question = _extract_user_question(message)
    if not user_question.strip():
        return {"reply": "", "sources": [], "used_llm": False, "empty": True}

    client = get_engine()

    (
        matched_programs,
        geo_exclusions,
        overlay_exclusions,
        total_screened,
        hypothetical_note,
        hypo_meta,
    ) = _maybe_rescreen_hypothetical_scenario(
        user_question=user_question,
        scenario_summary=scenario_summary,
        eligibility_request=eligibility_request,
        matched_programs=matched_programs,
        geo_exclusions=geo_exclusions,
        overlay_exclusions=overlay_exclusions,
        total_screened=total_screened,
    )

    if hypo_meta.get("rescreened") and _is_co_borrower_fico_eligibility_question(user_question):
        return _answer_co_borrower_fico_hypothetical(
            user_question=user_question,
            scenario_summary=scenario_summary,
            matched_programs=matched_programs,
            geo_exclusions=geo_exclusions,
            overlay_exclusions=overlay_exclusions,
            total_screened=total_screened,
            meta=hypo_meta,
            client=client,
        )

    is_hypothetical = bool(hypo_meta.get("is_hypothetical"))
    needs_eligibility = _needs_eligibility_context(user_question, is_hypothetical=is_hypothetical)

    eligibility_ctx = ""
    if needs_eligibility:
        eligibility_ctx = _format_eligibility_results_context(
            matched_programs=matched_programs,
            geo_exclusions=geo_exclusions,
            overlay_exclusions=overlay_exclusions,
            total_screened=total_screened,
            header_prefix=hypothetical_note,
        )
    has_eligibility = bool(eligibility_ctx)
    explain_why_excluded = _is_eligibility_explanation_question(user_question)

    guideline_query = user_question
    if is_hypothetical and re.search(r"\bco[- ]?borrower|fico|credit score\b", user_question, re.I):
        guideline_query = f"{user_question} qualifying credit score primary wage earner representative score"

    _, sql_tables = _route_selected_program_query(message)
    if (explain_why_excluded or needs_eligibility) and "dim_programs" in sql_tables:
        sql_tables = [t for t in sql_tables if t != "dim_programs"]

    table_rows = (
        _fetch_sql_map_rows_all_programs(
            sql_tables,
            question=user_question,
            scenario_summary=scenario_summary,
        )
        if sql_tables
        else {}
    )
    sql_context = _sql_map_context_all_programs(table_rows) if table_rows else ""
    sql_sources = [
        {"index": i + 1, "path": t, "text": f"{len(rows)} SQL rows (all programs)", "layout": "prose", "score": None}
        for i, (t, rows) in enumerate(table_rows.items())
    ]

    matrix_hits = _retrieve_all_matrices(client, user_question, limit=8 if needs_eligibility else 6)
    matrix_context = _build_matrix_context(matrix_hits) if matrix_hits else ""
    matrix_sources = hits_to_sources(matrix_hits, preview_max_chars=220)

    guideline_hits = _retrieve_all_guidelines(
        client, guideline_query, limit=15 if not explain_why_excluded else 8
    )
    guideline_context = _build_guideline_context_all_lenders(guideline_hits) if guideline_hits else ""
    guideline_sources = hits_to_sources(guideline_hits, preview_max_chars=220)

    has_sql = bool(sql_context)
    has_matrix = bool(matrix_context)
    has_guidelines = bool(guideline_context)

    if not has_eligibility and not has_sql and not has_matrix and not has_guidelines:
        return {
            "reply": CONTACT_REPRESENTATIVE_REPLY,
            "sources": [],
            "used_llm": False,
            "program": None,
            "collection": "eligibility + SQL + mortgage_matrices + all guideline collections",
        }

    context_parts: list[str] = []
    if has_eligibility:
        context_parts.append(eligibility_ctx)
    if has_sql:
        context_parts.append(f"=== All Programs — Structured SQL Data (supplementary) ===\n{sql_context}")
    if has_matrix:
        context_parts.append(f"=== All Programs — Matrix Summaries (Qdrant) ===\n{matrix_context}")
    if has_guidelines:
        context_parts.append(f"=== All Lenders — Underwriting Guidelines (Qdrant) ===\n{guideline_context}")
    combined_ctx = "\n\n".join(context_parts)

    question_block = user_question
    if needs_eligibility and scenario_summary and scenario_summary.strip():
        question_block = f"Borrower scenario:\n{scenario_summary.strip()}\n\nQuestion:\n{user_question}"

    eligibility_instructions = ""
    concise_instructions = ""
    if not needs_eligibility:
        concise_instructions = (
            "- Answer ONLY the question asked. Be concise and direct.\n"
            "- Do NOT recap the borrower's matched eligibility programs, FICO, LTV, DTI, or wizard scenario "
            "unless the question explicitly asks about them.\n"
            "- Do NOT list programs that were screened but did not match, and do NOT mention exclusion reasons.\n"
            "- Prefer 2–6 sentences or a short focused bullet list — no preamble about the borrower's scenario.\n"
        )
    if has_eligibility:
        eligibility_instructions = (
            "- The Eligibility Engine Results section is AUTHORITATIVE for which programs matched this scenario.\n"
            "- ONLY programs listed under 'Matched programs' were suggested in the results table.\n"
            "- Programs under Geographic exclusions or Overlay exclusions were screened but failed — "
            "cite the exact exclusion reason when explaining why a program was not suggested.\n"
            "- Do NOT invent program names. Do NOT guess from the full 30-program catalog.\n"
            "- Do NOT invent minimum FICO requirements for co-borrowers or additional borrowers "
            "unless explicitly stated in the guidelines or matrix context.\n"
            "- If a program is not in Matched, Geographic exclusions, or Overlay exclusions, "
            "say it was screened but no specific exclusion reason was captured.\n"
        )
        if is_hypothetical:
            eligibility_instructions += (
                "- This is a WHAT-IF / co-borrower credit score question. Explain qualifying credit score "
                "rules from the guidelines (primary wage earner, representative score) before listing programs.\n"
                "- A co-borrower's lower FICO does NOT automatically disqualify the loan on income-doc paths "
                "when the primary wage earner meets program minimums — unless guidelines say otherwise.\n"
                "- List ONLY programs under 'Matched programs' as eligible for this what-if scenario.\n"
                "- Do NOT contradict yourself by listing the same program as both matched and excluded.\n"
                "- If Geographic exclusions and Overlay exclusions are empty, do NOT invent an exclusion list.\n"
            )
        if explain_why_excluded:
            eligibility_instructions += (
                "- This question asks WHY programs were or were not suggested — answer primarily from "
                "Eligibility Engine Results, grouped by lender, listing each excluded program with its reason.\n"
                "- Only list excluded programs that appear under Geographic exclusions or Overlay exclusions.\n"
            )

    strict_question = (
        "You are an expert Non-QM mortgage advisor. The borrower has NOT selected a specific program yet "
        "and may be comparing options across Denali (NQM Funding), Summit (Verus), and Everest (Deephaven).\n\n"
        f"{question_block}\n\n"
        "Instructions:\n"
        f"{concise_instructions}"
        f"{eligibility_instructions}"
        "- Answer using ONLY the context sections below.\n"
        "- When citing program-specific matrix or SQL facts, name the program and lender explicitly.\n"
        "- When citing lender-wide underwriting policy from guidelines, say 'Per Denali (NQM Funding) guidelines…' etc.\n"
        "- Compare across programs/lenders only when the question asks broadly or multiple options apply.\n"
        "- Do NOT mention lender_id, program_id, or internal database IDs in your answer.\n"
        "- Do NOT say 'contact our representative' if the answer is present in the context.\n"
        "- If something is missing for one lender, either skip it or mention it briefly in plain language — "
        "never say 'not found in the provided context' or similar meta phrasing.\n"
    )

    valid_programs = sorted(
        {
            str(p.get("program_name_np") or p.get("program_name") or "")
            for p in (matched_programs or [])
            if needs_eligibility and (p.get("program_name_np") or p.get("program_name"))
        }
        | {
            str(r.get("program_name_np") or r.get("program_name") or "")
            for rows in table_rows.values()
            for r in rows
            if r.get("program_name_np") or r.get("program_name")
        }
        | set(get_program_map().values())
    )
    valid_programs = [p for p in valid_programs if p]

    reply = answer_with_openai(strict_question, combined_ctx, valid_programs=valid_programs).strip()
    all_sources = sql_sources + matrix_sources + guideline_sources
    if has_eligibility:
        all_sources.insert(
            0,
            {
                "index": 0,
                "path": "eligibility_engine",
                "text": f"{len(matched_programs or [])} matched, "
                f"{len(geo_exclusions or [])} geo excluded, "
                f"{len(overlay_exclusions or [])} overlay excluded",
                "layout": "prose",
                "score": None,
            },
        )
    collection_name = "eligibility results + SQL + mortgage_matrices + all guideline collections"

    if reply:
        if _is_rate_question(user_question) and not _context_has_pricing_data(combined_ctx):
            reply = (
                "I don't have live rate-sheet data in the indexed documents, so I can't quote today's interest rate. "
                "I can still explain eligibility and structure options from the retrieved guidelines and matrices. "
                "For exact pricing, please contact an Acme representative."
            )
        else:
            reply = _strip_citations_and_sources(_clean_answer_text(reply))
        reply = _limit_clarifying_questions(reply, max_questions=0)
        replacement = deflection_reply_if_needed(reply)
        if replacement:
            reply = replacement
        if _llm_answer_looks_grounded(reply):
            return {
                "reply": reply,
                "sources": all_sources,
                "used_llm": True,
                "program": None,
                "collection": collection_name,
            }
        fallback_hits = guideline_hits or matrix_hits
        return {
            "reply": retrieval_only_answer(user_question, fallback_hits)
            if fallback_hits
            else CONTACT_REPRESENTATIVE_REPLY,
            "sources": all_sources,
            "used_llm": False,
            "program": None,
            "collection": collection_name,
        }

    return {
        "reply": (
            "No LLM API key is configured. Set OPENAI_API_KEY in `.env` for synthesized answers. "
            "Retrieved excerpts are available in the response metadata."
        ),
        "sources": all_sources,
        "used_llm": False,
        "program": None,
        "collection": collection_name,
    }


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
    """
    No program selected: search all SQL map tables, all matrix Qdrant points,
    and all lender guideline collections, then synthesize an answer.
    """
    return _chat_all_programs_general(
        message,
        scenario_summary=scenario_summary,
        matched_programs=matched_programs,
        geo_exclusions=geo_exclusions,
        overlay_exclusions=overlay_exclusions,
        total_screened=total_screened,
        eligibility_request=eligibility_request,
    )
