from __future__ import annotations

import json
import logging
import sys
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, Query, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

# Repo root (parent of `backend/`)
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _remove_appledouble_sidecars_in_venv_site_packages() -> None:
    """macOS / exFAT can leave AppleDouble files named ``._*`` next to real wheels.

    ``pip`` may report ``Ignoring invalid distribution -…``; worse, ``transformers``
    walks ``site-packages`` and reads ``*.py`` paths as UTF-8 — a binary ``._`` file
    in that tree raises ``UnicodeDecodeError`` at import. Remove only ``._*`` files
    under this interpreter's ``site-packages`` (never the repo source tree).
    """
    if sys.platform != "darwin":
        return
    lib = Path(sys.prefix) / "lib"
    if not lib.is_dir():
        return
    for site in lib.glob("python*/site-packages"):
        if not site.is_dir():
            continue
        try:
            for p in site.rglob("._*"):
                if p.is_file():
                    try:
                        p.unlink()
                    except OSError:
                        pass
        except OSError:
            pass


_remove_appledouble_sidecars_in_venv_site_packages()

from backend import config  # noqa: E402
from backend.eligibility import (  # noqa: E402
    EligibilityRequest,
    EligibilityResponse,
    EligibleProgram,
    NearMissProgram,
    ProgramExclusion,
    QuickEligibilityRequest,
    QuickEligibilityResponse,
)
from backend import eligibility as eligibility_routes  # noqa: E402
from backend.chat.routes import router as _intake_router  # noqa: E402
from backend.eligibility import geo_router as _geo_router  # noqa: E402
from backend import scenario as form_history_routes  # noqa: E402
from backend.utilities.guard import (  # noqa: E402
    GREETING_REPLY,
    UNDERSTOOD_REPLY,
    is_greeting,
    should_reject_chat_message,
)
from backend.pdf import (  # noqa: E402
    ScenarioPdfRequest,
    enrich_scenario_pdf_request,
    generate_scenario_pdf_bytes,
    scenario_pdf_filename,
)
from backend.rag import (  # noqa: E402
    chat_once_results_general,
    chat_once_with_program,
    get_program_map,
    retrieval_diagnostics,
)

# Eligibility engine — imported lazily so missing MySQL doesn't break the whole API
try:
    from backend.eligibility import find_eligible_programs as _find_eligible  # noqa: E402
    _ELIGIBILITY_AVAILABLE = True
except Exception:
    _ELIGIBILITY_AVAILABLE = False

from backend.connections.logging import setup_logging, write_api_io_log

setup_logging()
_log = logging.getLogger(__name__)

app = FastAPI(title="Newpoint Mortgage Assistant API")

app.include_router(_intake_router)
app.include_router(_geo_router)
app.include_router(eligibility_routes.router)
app.include_router(form_history_routes.router)

# LoanPASS pricing runs as its own service (backend/pricing_app.py) so it can be
# restarted independently. For single-process dev, set MOUNT_PRICING_INLINE=1 to
# also serve /api/loanpass/* from here.
if config.MOUNT_PRICING_INLINE:
    from backend.loanpass_routes import router as _loanpass_router  # noqa: E402

    app.include_router(_loanpass_router)
    _log.info("LoanPASS pricing mounted INLINE (MOUNT_PRICING_INLINE=1).")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^https?://newpointassist\.algodel\.com(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _io_block(raw: bytes, limit: int = 2500) -> str:
    """Pretty, indented body for the terminal — JSON gets formatted; long bodies truncated."""
    try:
        text = raw.decode("utf-8", "replace").strip()
    except Exception:
        return f"    <{len(raw)} bytes>"
    if not text:
        return "    (empty)"
    try:
        import json as _json

        text = _json.dumps(_json.loads(text), indent=2, ensure_ascii=False)
    except Exception:
        text = " ".join(text.split())  # not JSON — collapse whitespace
    if len(text) > limit:
        text = text[:limit] + f"\n… (+{len(text) - limit} more chars)"
    return "\n".join("    " + line for line in text.splitlines())


_API_BAR = "━" * 78

if config.LOG_API_IO or config.LOG_API_IO_TO_FILE:

    @app.middleware("http")
    async def _log_api_io(request, call_next):
        """Log every /api/* request + JSON response to the terminal and/or logs/api_io_*.json.

        Terminal: LOG_API_IO. Files: LOG_API_IO_FILE. Bodies include PII — keep off in prod.
        """
        import time as _time

        path = request.url.path
        if not path.startswith("/api/"):
            return await call_next(request)

        started = _time.perf_counter()
        req_body: bytes | None = None
        if request.method in ("POST", "PUT", "PATCH"):
            req_body = await request.body()  # cached, so downstream handlers can still read it
            if config.LOG_API_IO:
                _log.info(
                    "\n%s\n▶ %s %s\n  request:\n%s",
                    _API_BAR,
                    request.method,
                    path,
                    _io_block(req_body),
                )
        elif config.LOG_API_IO:
            qs = ("?" + request.url.query) if request.url.query else ""
            _log.info("\n%s\n▶ %s %s%s", _API_BAR, request.method, path, qs)

        response = await call_next(request)
        ms = (_time.perf_counter() - started) * 1000
        ctype = response.headers.get("content-type", "")
        query = request.url.query or ""

        if "application/json" in ctype:
            chunks = [section async for section in response.body_iterator]
            payload = b"".join(chunks)
            if config.LOG_API_IO:
                _log.info(
                    "◀ %s %s  ·  %d  ·  %.0f ms\n  response:\n%s\n%s",
                    request.method,
                    path,
                    response.status_code,
                    ms,
                    _io_block(payload),
                    _API_BAR,
                )
            write_api_io_log(
                method=request.method,
                path=path,
                query=query,
                status_code=response.status_code,
                duration_ms=ms,
                request_body=req_body,
                response_body=payload,
                content_type=ctype,
            )
            from starlette.responses import Response as _Resp

            return _Resp(
                content=payload,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type,
            )

        if config.LOG_API_IO:
            _log.info(
                "◀ %s %s  ·  %d  ·  %.0f ms  (%s)\n%s",
                request.method,
                path,
                response.status_code,
                ms,
                ctype or "no-content-type",
                _API_BAR,
            )
        write_api_io_log(
            method=request.method,
            path=path,
            query=query,
            status_code=response.status_code,
            duration_ms=ms,
            request_body=req_body,
            response_body=None,
            content_type=ctype or None,
        )
        return response


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)
    # Optional: force a specific program (otherwise auto-detect from question; default consolidated).
    program: str | None = None
    # Session tracking (set after an eligibility check)
    session_id: str | None = None
    selected_program: str | None = None
    program_id: int | None = None
    # Raw user input (before scenario context is prepended); used for intent checks
    user_text: str | None = None
    # results_general = search mortgage_matrices + all guideline collections (top 10 chunks)
    mode: str | None = None
    scenario_summary: str | None = None
    # Eligibility results from the wizard (when user skipped program selection)
    matched_programs: list[dict] | None = None
    geo_exclusions: list[dict] | None = None
    overlay_exclusions: list[dict] | None = None
    total_screened: int | None = None
    eligibility_request: dict | None = None


class ChatResponse(BaseModel):
    reply: str
    sources: list[dict]
    used_llm: bool
    program: str | None = None
    collection: str | None = None


class HealthResponse(BaseModel):
    ok: bool
    qdrant_url: str
    collection: str
    program_collections: dict[str, str]
    openai_configured: bool
    chat_model: str


class RetrievalDebugResponse(BaseModel):
    query: str
    result_count: int
    toc_like_count: int
    hits: list[dict]


# ---------------------------------------------------------------------------
# Session logging helpers
# ---------------------------------------------------------------------------
_log_engine = None
_log_tables_checked = False
_has_search_sessions = False
_has_chat_messages = False
_has_form_history_scenario = False


def _get_log_engine():
    from backend.connections.db import get_engine  # noqa: PLC0415

    return get_engine()


def _table_has_columns(table: str, required: frozenset[str]) -> bool:
    from sqlalchemy import text  # noqa: PLC0415

    eng = _get_log_engine()
    with eng.begin() as conn:
        cols = {
            r[0]
            for r in conn.execute(
                text(
                    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                    "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t"
                ),
                {"t": table},
            ).fetchall()
        }
    return required.issubset(cols)


def _ensure_log_tables() -> None:
    global _log_tables_checked, _has_search_sessions, _has_chat_messages, _has_form_history_scenario
    if _log_tables_checked:
        return
    from sqlalchemy import text  # noqa: PLC0415

    eng = _get_log_engine()
    with eng.begin() as conn:
        tables = {
            r[0]
            for r in conn.execute(
                text(
                    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES "
                    "WHERE TABLE_SCHEMA = DATABASE()"
                )
            ).fetchall()
        }
    _search_session_cols = frozenset(
        {"session_id", "occupancy", "loan_purpose", "eligible_programs"}
    )
    _chat_cols = frozenset({"session_id", "role", "content"})
    _has_search_sessions = "search_sessions" in tables and _table_has_columns(
        "search_sessions", _search_session_cols
    )
    _has_chat_messages = "chat_messages" in tables and _table_has_columns(
        "chat_messages", _chat_cols
    )
    _has_form_history_scenario = "form_history_scenario" in tables
    _log_tables_checked = True


def _sf(v: object) -> float | None:
    """Safe string-to-float for form fields."""
    try:
        return float(str(v).replace(",", "").replace("$", "").replace("%", "")) if v else None
    except (TypeError, ValueError):
        return None


def _si(v: object) -> int | None:
    """Safe string-to-int for form fields."""
    try:
        return int(float(str(v))) if v else None
    except (TypeError, ValueError):
        return None


def _log_session(body: "EligibilityRequest", session_id: str, result: dict, eligible_programs: list) -> None:
    """Insert one row into search_sessions. Errors are swallowed so the API never fails."""
    from sqlalchemy import text  # noqa: PLC0415
    try:
        _ensure_log_tables()
        if not _has_search_sessions:
            return
        eng = _get_log_engine()
        with eng.begin() as conn:
            conn.execute(text("""
                INSERT INTO search_sessions (
                    session_id, occupancy, loan_purpose, state,
                    value_sales_price, loan_amount, ltv, estimated_dti,
                    documentation_type, prepayment_terms, property_type,
                    citizenship, decision_credit_score,
                    existing_first_lien, cltv, dscr, credit_event,
                    total_screened, programs_matched, eligible_programs
                ) VALUES (
                    :session_id, :occupancy, :loan_purpose, :state,
                    :vsp, :la, :ltv, :dti,
                    :doc_type, :ppt, :prop_type,
                    :citizenship, :fico,
                    :efl, :cltv, :dscr, :credit_event,
                    :total_screened, :programs_matched, :eligible_programs
                )
            """), {
                "session_id": session_id,
                "occupancy": body.occupancy or None,
                "loan_purpose": body.loanPurpose or None,
                "state": body.state or None,
                "vsp": _sf(body.valueSalesPrice),
                "la": _sf(body.loanAmount),
                "ltv": _sf(body.ltv),
                "dti": _sf(body.estimatedDti),
                "doc_type": body.documentationType or None,
                "ppt": body.prepaymentTerms or None,
                "prop_type": body.propertyType or None,
                "citizenship": body.citizenship or None,
                "fico": _si(body.decisionCreditScore),
                "efl": _sf(body.existingFirstLien),
                "cltv": _sf(body.cltv),
                "dscr": _sf(body.dscr),
                "credit_event": " | ".join(
                    x for x in (body.creditEvent, body.creditEventType, body.yearsSinceEvent) if (x or "").strip()
                ) or None,
                "total_screened": result.get("total_screened") or 0,
                "programs_matched": len(eligible_programs),
                "eligible_programs": json.dumps([p.model_dump() for p in eligible_programs]),
            })
    except Exception as exc:
        _log.warning(
            "search_sessions log failed (run ingest/migrations/014_recreate_search_sessions.sql): %s",
            exc,
        )


eligibility_routes.configure(_log_session)

form_history_routes.configure(
    find_eligible=_find_eligible if _ELIGIBILITY_AVAILABLE else None,
    eligibility_available=_ELIGIBILITY_AVAILABLE,
    ensure_log_tables=_ensure_log_tables,
    get_has_form_history=lambda: _has_form_history_scenario,
    get_log_engine=_get_log_engine,
)


def _log_chat(session_id: str, user_msg: str, assistant_reply: str, selected_program: str | None) -> None:
    """Insert user + assistant turn into chat_messages. Errors are swallowed."""
    from sqlalchemy import text  # noqa: PLC0415
    try:
        _ensure_log_tables()
        if not _has_chat_messages:
            return
        eng = _get_log_engine()
        with eng.begin() as conn:
            conn.execute(text("""
                INSERT INTO chat_messages (session_id, role, content, selected_program)
                VALUES (:sid, :role, :content, :prog)
            """), [
                {"sid": session_id, "role": "user",      "content": user_msg,        "prog": selected_program},
                {"sid": session_id, "role": "assistant", "content": assistant_reply, "prog": selected_program},
            ])
    except Exception as exc:
        _log.warning("chat_messages log failed: %s", exc)


@app.websocket("/")
async def ws_root(ws: WebSocket) -> None:
    # Some tooling/dev clients attempt a WS connection to "/".
    # We don't use WebSockets here, but accepting avoids noisy 403 logs.
    await ws.accept()
    await ws.close()


@app.get("/api/form-placeholders")
def form_placeholders() -> dict[str, str]:
    """Example values for form inputs (shown as faint placeholders in the UI)."""
    return {
        "valueSalesPrice": "1,000,000",
        "loanAmount": "700,000",
        "ltv": "70",
        "decisionCreditScore": "720",
        "estimatedDti": "43",
        "dscr": "1.15",
        "existingFirstLien": "0",
        "cltv": "75",
    }


@app.get("/api/health", response_model=HealthResponse)
def health():
    program_map = get_program_map()
    program_collections = {
        name: config.program_collection_name_from_key(key) for key, name in program_map.items()
    }
    return HealthResponse(
        ok=True,
        qdrant_url=config.QDRANT_URL,
        collection=config.COLLECTION_NAME,
        program_collections=program_collections,
        openai_configured=bool(config.OPENAI_API_KEY),
        chat_model=config.OPENAI_CHAT_MODEL if config.OPENAI_API_KEY else "",
    )


@app.post("/api/chat", response_model=ChatResponse)
def chat(body: ChatRequest):
    raw_user_input = (body.user_text or body.message or "").strip()
    if is_greeting(raw_user_input):
        prog_name = (body.program or "").strip()
        if prog_name:
            reply = (
                f"Hi there! I'm your mortgage advisor for the {prog_name} program. "
                "Feel free to ask me anything about eligibility requirements, "
                "documentation, LTV limits, or any other details for this program."
            )
        else:
            reply = GREETING_REPLY
        if body.session_id:
            _log_chat(body.session_id, body.message, reply, body.selected_program)
        return ChatResponse(
            reply=reply,
            sources=[],
            used_llm=False,
            program=body.program,
            collection=None,
        )
    if should_reject_chat_message(raw_user_input, selected_program=body.selected_program):
        reply = UNDERSTOOD_REPLY
        if body.session_id:
            _log_chat(body.session_id, body.message, reply, body.selected_program)
        return ChatResponse(
            reply=reply,
            sources=[],
            used_llm=False,
            program=body.program,
            collection=None,
        )
    try:
        selected = (body.selected_program or "").strip() or None
        if body.program_id is not None and not selected:
            selected = f"pid:{body.program_id}"

        # Selected-program scope must always win, even if UI sends mode=results_general.
        if selected:
            out = chat_once_with_program(
                body.message,
                program=body.program,
                selected_program=selected,
                scenario_summary=body.scenario_summary,
            )
        else:
            out = chat_once_results_general(
                body.message,
                scenario_summary=body.scenario_summary,
                matched_programs=body.matched_programs,
                geo_exclusions=body.geo_exclusions,
                overlay_exclusions=body.overlay_exclusions,
                total_screened=body.total_screened,
                eligibility_request=body.eligibility_request,
            )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    if out.get("empty"):
        raise HTTPException(status_code=400, detail="Empty message")
    reply = (out.get("reply") or "").strip()
    if body.session_id:
        _log_chat(body.session_id, body.message, reply, body.selected_program)
    return ChatResponse(
        reply=reply,
        sources=out.get("sources") or [],
        used_llm=bool(out.get("used_llm")),
        program=out.get("program"),
        collection=out.get("collection"),
    )


class ProductFilterRequest(BaseModel):
    program_ids: list[int]
    loan_term: int | None = None       # total_term_years to match (None = no filter)
    interest_only: bool | None = None  # True = IO required, False = non-IO only, None = any
    fthb: bool = False                 # must be FTHB-eligible

class ProductFilterResponse(BaseModel):
    eligible_ids: list[int]
    count: int

@app.post("/api/products/filter", response_model=ProductFilterResponse)
def product_filter(body: ProductFilterRequest):
    """Filter a set of program_ids by product-level preferences (term, IO, FTHB)."""
    if not body.program_ids:
        return ProductFilterResponse(eligible_ids=[], count=0)
    from sqlalchemy import text as sa_text, bindparam  # noqa: PLC0415
    clauses = ["pp.program_id IN :ids"]
    if body.loan_term is not None:
        clauses.append("dt.total_term_years = :term")
    if body.interest_only is True:
        clauses.append("pp.io_flag = 1")
    elif body.interest_only is False:
        clauses.append("pp.io_flag = 0")
    if body.fthb:
        clauses.append("pp.is_fthb_eligible = 1")
    where = " AND ".join(clauses)
    sql = sa_text(f"""
        SELECT DISTINCT pp.program_id
        FROM map_program_products pp
        JOIN dim_product_types dt ON dt.id = pp.product_type_id
        WHERE {where}
    """).bindparams(bindparam("ids", expanding=True))
    params: dict = {"ids": body.program_ids}
    if body.loan_term is not None:
        params["term"] = body.loan_term
    try:
        eng = _get_log_engine()
        with eng.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        eligible_ids = [int(r[0]) for r in rows]
        # Programs with no product rows at all pass through (no constraint)
        check_sql = sa_text(
            "SELECT DISTINCT program_id FROM map_program_products WHERE program_id IN :ids"
        ).bindparams(bindparam("ids", expanding=True))
        with eng.connect() as conn:
            covered = {int(r[0]) for r in conn.execute(check_sql, {"ids": body.program_ids}).fetchall()}
        uncovered = [pid for pid in body.program_ids if pid not in covered]
        final = list(set(eligible_ids) | set(uncovered))
        return ProductFilterResponse(eligible_ids=final, count=len(final))
    except Exception as exc:
        _log.error("product_filter error: %s", exc)
        return ProductFilterResponse(eligible_ids=body.program_ids, count=len(body.program_ids))


class SummarizeNotesRequest(BaseModel):
    notes: list[str]
    program_name: str = ""


class SummarizeNotesResponse(BaseModel):
    summary: str
    bullets: list[str] = []


def _parse_note_bullets(text: str) -> list[str]:
    import re

    raw = (text or "").strip()
    if not raw:
        return []
    lines = [re.sub(r"^[-•*]\s*", "", ln).strip() for ln in raw.splitlines()]
    bullets = [ln for ln in lines if ln]
    if len(bullets) >= 2:
        return bullets
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z\"“])", raw)
    parts = [p.strip() for p in parts if len(p.strip()) > 12]
    return parts if len(parts) > 1 else [raw]


class ParseScenarioRequest(BaseModel):
    text: str = Field(..., min_length=8, max_length=4000)


class ParseScenarioResponse(BaseModel):
    extracted: dict[str, str] = {}


class ExtractScenarioNotesRequest(BaseModel):
    text: str = Field(..., min_length=2, max_length=4000)
    source: str = Field(
        default="form",
        description="Caller hint: form (guided wizard), chat (conversational intake), intake (refine)",
    )


class ExtractScenarioNotesResponse(BaseModel):
    scenario_notes_delta: list[dict] = []


@app.post("/api/scenario-notes/extract", response_model=ExtractScenarioNotesResponse)
def extract_scenario_notes_endpoint(body: ExtractScenarioNotesRequest):
    """Paraphrase LO free text into scenario notes (form chat, chat intake, refine)."""
    from backend.utilities.scenario_notes_extract import (
        extract_scenario_notes_from_text,
        scenario_notes_to_delta,
    )

    src = (body.source or "form").strip().lower()
    if src not in ("form", "chat", "intake"):
        src = "form"
    try:
        notes = extract_scenario_notes_from_text(body.text, source=src)  # type: ignore[arg-type]
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return ExtractScenarioNotesResponse(scenario_notes_delta=scenario_notes_to_delta(notes))


class ParseLoanFormResponse(BaseModel):
    fields: dict[str, str] = {}
    source: str = ""
    filled_count: int = 0


@app.post("/api/parse-loan-form", response_model=ParseLoanFormResponse)
async def parse_loan_form(file: UploadFile = File(...)):
    """Extract wizard intake fields from an uploaded 1003 PDF or Fannie 3.4 XML/HTML file."""
    from backend.form_import import parse_loan_form_upload

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded.")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File is too large (max 15 MB).")
    try:
        result = parse_loan_form_upload(file.filename, content)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return ParseLoanFormResponse(**result)


@app.post("/api/parse-scenario", response_model=ParseScenarioResponse)
def parse_scenario(body: ParseScenarioRequest):
    """Extract structured intake fields from a free-text borrower scenario (Chat Mode)."""
    if not config.OPENAI_API_KEY:
        return ParseScenarioResponse(extracted={})
    from backend.connections.openai import get_openai

    oc = get_openai()
    schema_hint = (
        "Extract structured mortgage intake fields from the borrower's message. "
        "Return a JSON object only (no markdown). All values must be strings. Omit fields you cannot confidently infer.\n\n"
        "FIELD REFERENCE (use exact values shown):\n"
        "  citizenship: 'US Citizen' | 'Permanent Resident Alien' | 'Non-Permanent Resident Alien' | 'Foreign National'\n"
        "  occupancy: 'Primary Residence' | 'Second Home' | 'Investment Property'\n"
        "  loanPurpose: 'Purchase' | 'Refinance' | 'Cash-Out Refinance'\n"
        "  propertyType: 'Single Family' | 'Condo' | 'Townhouse' | '2-4 unit' | '5-8 unit' | 'Manufactured' | 'Mixed Use'\n"
        "  isSecondLien: 'yes' (piggyback/second lien) | 'no' (first lien only)\n"
        "  investmentIncomePath: 'income' (personal income) | 'dscr' (rental DSCR)\n"
        "  documentationType: 'Full Documentation' | 'Bank Statements (12 or 24 Months)' | "
        "'1099' | 'Asset Utilization' | 'P&L with 2 month Bank Statement' | "
        "'Alternative Documentation' | 'Rental Income'\n"
        "  creditEventCategory: 'None' | 'Bankruptcy' | 'Foreclosure' | 'Short Sale' | 'Deed in Lieu' | 'Mortgage Late'\n"
        "  creditEventType: specific sub-type within the category (e.g. 'Chapter 7', 'Chapter 13')\n"
        "  yearsSinceCreditEvent: '<1 year' | '1-2 years' | '2-3 years' | '3-4 years' | '4-7 years' | '7+ years'\n"
        "  firstTimeHomebuyer: 'Yes' | 'No'\n"
        "  firstTimeInvestor: 'Yes' | 'No'\n"
        "  prepaymentTerms: 'No Penalty' | '1 Year' | '2 Year' | '3 Year' | '4 Year' | '5 Year'\n"
        "  rentalType: 'Long-term rental' | 'Short-term rental'\n"
        "  state: 2-letter US state code (e.g. 'FL', 'TX')\n"
        "  valueSalesPrice, loanAmount, existingFirstLien, existingSecondLienBalance: numeric strings (digits only, no $ or commas)\n"
        "  ltv, estimatedDti: integer percent string (e.g. '75', '43')\n"
        "  dscr: decimal string (e.g. '1.15')\n"
        "  decisionCreditScore: integer 300–850\n\n"
        "Always extract decisionCreditScore when FICO or credit score is mentioned. "
        "Infer investmentIncomePath='dscr' when borrower mentions DSCR, rental income, or gross rent. "
        "Do not guess values that are not clearly stated."
    )
    try:
        resp = oc.chat.completions.create(
            model=config.OPENAI_CHAT_MODEL,
            messages=[
                {"role": "system", "content": schema_hint},
                {"role": "user", "content": body.text},
            ],
            max_tokens=400,
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        raw = (resp.choices[0].message.content or "{}").strip()
        import json

        data = json.loads(raw)
        if not isinstance(data, dict):
            return ParseScenarioResponse(extracted={})
        extracted = {str(k): str(v) for k, v in data.items() if v is not None and str(v).strip()}
        return ParseScenarioResponse(extracted=extracted)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


class ExtractScenarioRequest(BaseModel):
    text: str = Field(..., min_length=2, max_length=4000)


class ExtractScenarioResponse(BaseModel):
    extracted: dict[str, Any] = {}
    notes: list[str] = []
    ambiguous: list[dict] = []


# Field/value reference for the ChatIntakeExperience prototype schema. These
# enum values must stay in sync with the QUESTIONS array in
# ChatIntakeExperience.jsx (snake_case codes, NOT the production /api/parse-scenario
# label set). Used to fill the guided-chat form when a user types freeform text.
_EXTRACT_SCENARIO_SYSTEM = (
    "You extract structured mortgage-scenario fields from a loan officer's free-text "
    "message and return ONLY a JSON object (no markdown). Use the EXACT field names and "
    "value codes below. Omit any field you cannot confidently infer — never guess.\n\n"
    "FIELDS (value codes in quotes):\n"
    "  citizenship: 'us_citizen' | 'permanent_resident' | 'non_permanent_resident' | 'foreign_national' | 'itin_daca'\n"
    "  occupancy: 'primary' | 'second_home' | 'investment'\n"
    "  loanPurpose: 'purchase' | 'rate_term' (rate & term refi) | 'cash_out' (cash-out refi)\n"
    "  lienPosition: 'first' | 'second' (standalone HELOC/HELOAN) | 'piggyback'\n"
    "  secondLienType: 'heloc' | 'heloan'\n"
    "  propertyType: 'single_family' | 'pud' | 'townhouse' | 'condo' | 'two_to_four' (2-4 units)\n"
    "  documentationType: 'full_doc' | 'bank_stmt_personal' | 'bank_stmt_business' | 'pl_only' | 'asset_util'\n"
    "  housingHistory: '0x30x12' | '1x30x12' | '0x60x12' | '1x60x12'\n"
    "  hasCreditEvent: 'yes' | 'no'\n"
    "  isRuralProperty: 'yes' | 'no'\n"
    "  powerOfAttorney: 'yes' | 'no'\n"
    "  nonArmsLength: 'yes' | 'no'\n"
    "  state: 2-letter US state code (e.g. 'FL', 'TX')\n"
    "  propertyValue, loanAmount: numeric strings, digits only (no $ or commas)\n"
    "  ltv, estimatedDti: integer percent string (e.g. '75', '43')\n"
    "  creditScore: integer 300-850 string\n\n"
    "Return strings for every value. If bank statements are mentioned without specifying "
    "personal vs business, prefer 'bank_stmt_personal'. Do NOT compute LTV — the caller does that."
)


@app.post("/api/extract-scenario", response_model=ExtractScenarioResponse)
def extract_scenario(body: ExtractScenarioRequest):
    """Extract guided-chat (ChatIntakeExperience) form fields from free text.

    Mirrors the client-side extractScenarioFromText() return shape
    ({extracted, notes, ambiguous}) but LLM-backed. Returns empty extracted when
    OpenAI is unconfigured so the caller surfaces a "couldn't read that" message.
    """
    if not config.OPENAI_API_KEY:
        return ExtractScenarioResponse()
    from backend.connections.openai import get_openai

    oc = get_openai()
    try:
        resp = oc.chat.completions.create(
            model=config.OPENAI_CHAT_MODEL,
            messages=[
                {"role": "system", "content": _EXTRACT_SCENARIO_SYSTEM},
                {"role": "user", "content": body.text},
            ],
            max_tokens=400,
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        raw = (resp.choices[0].message.content or "{}").strip()
        data = json.loads(raw)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    if not isinstance(data, dict):
        return ExtractScenarioResponse()

    extracted = {str(k): str(v) for k, v in data.items() if v is not None and str(v).strip()}
    # Compute LTV server-side when value + loan are present and LTV wasn't given.
    pv = _sf(extracted.get("propertyValue"))
    la = _sf(extracted.get("loanAmount"))
    if pv and la and not extracted.get("ltv"):
        ltv = (la / pv) * 100
        if 0 < ltv < 1000:
            extracted["ltv"] = f"{ltv:.2f}"
    return ExtractScenarioResponse(extracted=extracted)


@app.post("/api/summarize-notes", response_model=SummarizeNotesResponse)
def summarize_notes(body: SummarizeNotesRequest):
    from backend.utilities.notes import (
        SUMMARIZE_SYSTEM_PROMPT,
        filter_notes_for_summarize,
        normalize_consideration_bullets,
    )

    filtered = filter_notes_for_summarize(body.notes or [])
    if not filtered or not config.OPENAI_API_KEY:
        return SummarizeNotesResponse(summary="", bullets=[])
    from backend.connections.openai import get_openai
    oc = get_openai()
    notes_text = "\n".join(f"- {n}" for n in filtered)
    user_parts: list[str] = []
    if (body.program_name or "").strip():
        user_parts.append(f"Program: {body.program_name.strip()}")
    user_parts.append(
        "Write 5–8 bullets for the Additional Considerations section only. "
        "Each bullet must use Topic: consideration format (e.g. 'Acreage: Max acreage is 20…'). "
        "Key Metrics and available products are already on the card — omit redundant topics."
    )
    user_parts.append(notes_text)
    user_content = "\n\n".join(user_parts)
    try:
        resp = oc.chat.completions.create(
            model=config.OPENAI_CHAT_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": SUMMARIZE_SYSTEM_PROMPT,
                },
                {"role": "user", "content": user_content},
            ],
            max_tokens=520,
            temperature=0.3,
        )
        summary = (resp.choices[0].message.content or "").strip()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    bullets = normalize_consideration_bullets(_parse_note_bullets(summary))
    return SummarizeNotesResponse(summary=summary, bullets=bullets)


@app.post("/api/scenario/pdf")
def scenario_pdf_download(body: ScenarioPdfRequest):
    """Generate and download loan scenario PDF (profile + matched + rejected programs)."""
    find_fn = _find_eligible if _ELIGIBILITY_AVAILABLE else None
    pdf_body = enrich_scenario_pdf_request(body, find_fn)

    try:
        pdf_bytes = generate_scenario_pdf_bytes(pdf_body)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"PDF generation failed: {e}") from e
    filename = scenario_pdf_filename()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/retrieval-debug", response_model=RetrievalDebugResponse)
def retrieval_debug(q: str = Query(..., min_length=2, max_length=500)):
    try:
        out = retrieval_diagnostics(q, limit=8)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return RetrievalDebugResponse(
        query=out.get("query") or q,
        result_count=int(out.get("result_count") or 0),
        toc_like_count=int(out.get("toc_like_count") or 0),
        hits=out.get("hits") or [],
    )

