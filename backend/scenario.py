"""Form-mode saved scenario history — POST/GET /api/form-history/*."""

from __future__ import annotations

import json
import logging
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/form-history", tags=["form-history"])

_find_eligible: Callable[..., dict] | None = None
_eligibility_available = False
_ensure_log_tables: Callable[[], None] | None = None
_get_has_form_history: Callable[[], bool] = lambda: False
_get_log_engine: Callable[[], Any] | None = None


def configure(
    *,
    find_eligible: Callable[..., dict] | None,
    eligibility_available: bool,
    ensure_log_tables: Callable[[], None],
    get_has_form_history: Callable[[], bool],
    get_log_engine: Callable[[], Any],
) -> None:
    global _find_eligible, _eligibility_available, _ensure_log_tables, _get_has_form_history, _get_log_engine
    _find_eligible = find_eligible
    _eligibility_available = eligibility_available
    _ensure_log_tables = ensure_log_tables
    _get_has_form_history = get_has_form_history
    _get_log_engine = get_log_engine


def _table_available() -> bool:
    if _ensure_log_tables is not None:
        _ensure_log_tables()
    return _get_has_form_history()


# Cached set of form_history_scenario columns. Lets the vault degrade
# gracefully when later migrations (015 tags, 016 status) haven't been applied.
_fhs_cols_cache: set[str] | None = None


def _fhs_columns() -> set[str]:
    global _fhs_cols_cache
    if _fhs_cols_cache is not None:
        return _fhs_cols_cache
    if _get_log_engine is None:
        return set()
    from sqlalchemy import text  # noqa: PLC0415

    try:
        eng = _get_log_engine()
        with eng.connect() as conn:
            _fhs_cols_cache = {
                r[0]
                for r in conn.execute(
                    text(
                        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'form_history_scenario'"
                    )
                ).fetchall()
            }
    except Exception as exc:
        _log.warning("form_history_scenario column check failed: %s", exc)
        _fhs_cols_cache = set()
    return _fhs_cols_cache


# Scenario lifecycle stages (Scenario Vault status column).
VALID_STATUSES = ("draft", "active", "locked", "closed", "archived", "lost")
DEFAULT_STATUS = "draft"


def _normalize_status(raw: Any, fallback: str | None = DEFAULT_STATUS) -> str | None:
    if raw is None:
        return fallback
    s = str(raw).strip().lower()
    return s if s in VALID_STATUSES else fallback


VAULT_SCENARIO_DESCRIPTION_KEY = "_vaultScenarioDescription"
SCENARIO_DESCRIPTION_MAX_CHARS = 50

VALID_ORIGINS = ("form", "chat")
DEFAULT_ORIGIN = "form"


def _normalize_origin(raw: Any) -> str:
    s = str(raw or DEFAULT_ORIGIN).strip().lower()
    return "chat" if s == "chat" else DEFAULT_ORIGIN


def _scenario_description_value(raw: Any) -> str | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    return text[:SCENARIO_DESCRIPTION_MAX_CHARS]


class FormHistorySaveRequest(BaseModel):
    session_id: str | None = None
    broker_name: str | None = Field(default=None, max_length=200)
    client_name: str = Field(..., min_length=1, max_length=200)
    client_phone: str | None = Field(default=None, max_length=40)
    client_email: str = Field(..., min_length=1, max_length=255)
    scenario_description: str | None = Field(default=None, max_length=SCENARIO_DESCRIPTION_MAX_CHARS)
    origin: str | None = Field(default=None, max_length=10)
    status: str | None = Field(default=None, max_length=20)
    form_fields: dict[str, Any] = Field(default_factory=dict)


class FormHistoryUpdateRequest(BaseModel):
    """Edit-in-place: recompute eligibility from new form_fields, keep identity.

    client_name / client_phone / client_email / status are optional — when omitted
    the existing values are preserved (Edit saves under the same name).
    """

    client_name: str | None = Field(default=None, max_length=200)
    client_phone: str | None = Field(default=None, max_length=40)
    client_email: str | None = Field(default=None, max_length=255)
    status: str | None = Field(default=None, max_length=20)
    form_fields: dict[str, Any] = Field(default_factory=dict)


class FormHistoryStatusRequest(BaseModel):
    status: str = Field(..., max_length=20)


class FormHistorySaveResponse(BaseModel):
    ok: bool
    id: int | None = None
    programs_matched: int = 0
    message: str = ""


class FormHistorySummaryItem(BaseModel):
    id: int
    session_id: str | None = None
    broker_name: str
    client_name: str
    client_phone: str | None = None
    client_email: str | None = None
    programs_matched: int = 0
    status: str = DEFAULT_STATUS
    occupancy: str | None = None
    lien_position: str | None = None
    documentation_type: str | None = None
    state: str | None = None
    scenario_description: str | None = None
    origin: str = DEFAULT_ORIGIN
    created_at: str | None = None


class FormHistoryListResponse(BaseModel):
    items: list[FormHistorySummaryItem]
    total: int


class FormHistoryDetailResponse(FormHistorySummaryItem):
    form_fields: dict[str, Any] = Field(default_factory=dict)
    accepted_programs: str | None = None
    rejected_programs: str | None = None


def _compute_eligibility(form_fields: dict[str, Any]) -> tuple[int, str, str]:
    """Run the engine over form_fields → (matched_count, accepted_str, rejected_str)."""
    from backend.eligibility import (  # noqa: PLC0415
        EligibilityTraceCollector,
        format_accepted_programs_string,
        format_rejected_programs_string,
    )

    try:
        result = _find_eligible(form_fields, collect_trace=True)  # type: ignore[misc]
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Eligibility engine error: {exc}") from exc

    trace_data = result.get("program_trace")
    accepted_str = ""
    rejected_str = ""
    if trace_data and isinstance(trace_data, dict):
        collector = EligibilityTraceCollector.from_dict(trace_data)
        accepted_str = format_accepted_programs_string(collector)
        rejected_str = format_rejected_programs_string(collector)
    matched_count = len(result.get("eligible") or [])
    return matched_count, accepted_str, rejected_str


@router.post("/save", response_model=FormHistorySaveResponse)
def save_form_history(body: FormHistorySaveRequest) -> FormHistorySaveResponse:
    if not _eligibility_available or _find_eligible is None:
        return FormHistorySaveResponse(ok=False, message="Eligibility engine unavailable")
    if not body.form_fields:
        raise HTTPException(status_code=400, detail="form_fields is required")

    matched_count, accepted_str, rejected_str = _compute_eligibility(body.form_fields)

    try:
        if not _table_available() or _get_log_engine is None:
            return FormHistorySaveResponse(
                ok=False,
                programs_matched=matched_count,
                message="Table form_history_scenario not found — run migration 010",
            )
        from sqlalchemy import text  # noqa: PLC0415

        cols = "session_id, broker_name, client_name, client_phone, client_email, " \
            "form_fields, accepted_programs, rejected_programs, programs_matched"
        vals = ":session_id, :broker_name, :client_name, :client_phone, :client_email, " \
            ":form_fields, :accepted_programs, :rejected_programs, :programs_matched"
        params = {
            "session_id": (body.session_id or "").strip() or None,
            "broker_name": (body.broker_name or "").strip() or "",
            "client_name": body.client_name.strip(),
            "client_phone": (body.client_phone or "").strip() or None,
            "client_email": body.client_email.strip(),
            "form_fields": json.dumps(body.form_fields, ensure_ascii=False),
            "accepted_programs": accepted_str or None,
            "rejected_programs": rejected_str or None,
            "programs_matched": matched_count,
        }
        if "status" in _fhs_columns():
            cols += ", status"
            vals += ", :status"
            params["status"] = _normalize_status(body.status)
        fhs_cols = _fhs_columns()
        desc = _scenario_description_value(body.scenario_description) or _vault_scenario_description(
            body.form_fields
        )
        if "scenario_description" in fhs_cols:
            cols += ", scenario_description"
            vals += ", :scenario_description"
            params["scenario_description"] = desc
        if "origin" in fhs_cols:
            cols += ", origin"
            vals += ", :origin"
            params["origin"] = _normalize_origin(body.origin)

        eng = _get_log_engine()
        with eng.begin() as conn:
            row = conn.execute(
                text(f"INSERT INTO form_history_scenario ({cols}) VALUES ({vals})"),
                params,
            )
            new_id = row.lastrowid
        return FormHistorySaveResponse(
            ok=True,
            id=int(new_id) if new_id else None,
            programs_matched=matched_count,
            message="Scenario saved",
        )
    except Exception as exc:
        _log.warning("form_history_scenario save failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Failed to save profile: {exc}") from exc


def _parse_form_fields_dict(raw_form: Any) -> dict[str, Any]:
    if isinstance(raw_form, str):
        try:
            loaded = json.loads(raw_form)
            if isinstance(loaded, dict):
                return loaded
        except json.JSONDecodeError:
            return {}
    if isinstance(raw_form, dict):
        return raw_form
    return {}


def _vault_scenario_description(raw_form: Any) -> str | None:
    parsed = _parse_form_fields_dict(raw_form)
    v = parsed.get(VAULT_SCENARIO_DESCRIPTION_KEY)
    return _scenario_description_value(v)


def _row_scenario_description(row: dict[str, Any]) -> str | None:
    if "scenario_description" in row:
        col = _scenario_description_value(row.get("scenario_description"))
        if col:
            return col
    return _vault_scenario_description(row.get("form_fields"))


def _snippet_from_form_fields(raw_form: Any) -> tuple[str | None, str | None, str | None, str | None]:
    """occupancy, lien_position, documentation_type, state."""
    parsed = _parse_form_fields_dict(raw_form)

    def _s(key: str) -> str | None:
        v = parsed.get(key)
        if v is None:
            return None
        text = str(v).strip()
        return text or None

    occupancy = _s("occupancy")
    lien = _s("lienPosition")
    if not lien:
        is_second = str(parsed.get("isSecondLien") or "").strip().lower() in {"yes", "y", "true", "1"}
        piggy = _s("piggybackPurpose")
        if piggy:
            lien = "second_lien_piggyback"
        elif is_second:
            lien = "second_lien"
        elif parsed.get("isSecondLien") is not None:
            lien = "first_lien"
    doc = _s("documentationType")
    state = _s("state")
    return occupancy, lien, doc, state


@router.get("", response_model=FormHistoryListResponse)
def list_form_history(
    q: str = Query(default=""),
    limit: int = Query(default=100, ge=1, le=200),
    status: str = Query(default="all"),
    sort: str = Query(default="modified"),
) -> FormHistoryListResponse:
    if _ensure_log_tables is not None:
        _ensure_log_tables()
    if not _table_available() or _get_log_engine is None:
        return FormHistoryListResponse(items=[], total=0)

    from sqlalchemy import text  # noqa: PLC0415

    has_status = "status" in _fhs_columns()
    term = (q or "").strip()
    params: dict[str, Any] = {"limit": int(limit)}
    clauses: list[str] = []

    fhs_cols = _fhs_columns()
    if term:
        search_cols = ["client_name", "broker_name", "client_email", "client_phone"]
        if has_status:
            search_cols.append("status")
        if "scenario_description" in fhs_cols:
            search_cols.append("scenario_description")
        if "origin" in fhs_cols:
            search_cols.append("origin")
        clauses.append("(" + " OR ".join(f"{c} LIKE :like" for c in search_cols) + ")")
        params["like"] = f"%{term}%"

    # Lifecycle status filter (only when the column exists). "all" → no clause.
    if has_status:
        st = _normalize_status(status, fallback=None)
        if st:
            clauses.append("status = :status_eq")
            params["status_eq"] = st

    where = " AND ".join(clauses) if clauses else "1=1"

    order_map = {
        "modified": "created_at DESC, id DESC",
        "name": "client_name ASC, id DESC",
        "matches": "programs_matched DESC, created_at DESC",
    }
    order_by = order_map.get((sort or "modified").strip().lower(), order_map["modified"])

    select_cols = (
        "id, session_id, broker_name, client_name, client_phone, client_email, "
        "programs_matched, created_at, form_fields"
    )
    if has_status:
        select_cols += ", status"
    if "scenario_description" in fhs_cols:
        select_cols += ", scenario_description"
    if "origin" in fhs_cols:
        select_cols += ", origin"

    sql = f"""
        SELECT {select_cols}
        FROM form_history_scenario
        WHERE {where}
        ORDER BY {order_by}
        LIMIT :limit
    """
    eng = _get_log_engine()
    with eng.connect() as conn:
        rows = conn.execute(text(sql), params).fetchall()

    items: list[FormHistorySummaryItem] = []
    for row in rows:
        r = dict(row._mapping)
        created = r.get("created_at")
        form_fields = r.get("form_fields")
        occupancy, lien, doc, state = _snippet_from_form_fields(form_fields)
        items.append(
            FormHistorySummaryItem(
                id=int(r["id"]),
                session_id=r.get("session_id"),
                broker_name=str(r.get("broker_name") or ""),
                client_name=str(r.get("client_name") or ""),
                client_phone=r.get("client_phone"),
                client_email=r.get("client_email"),
                programs_matched=int(r.get("programs_matched") or 0),
                status=_normalize_status(r.get("status")) or DEFAULT_STATUS,
                occupancy=occupancy,
                lien_position=lien,
                documentation_type=doc,
                state=state,
                scenario_description=_row_scenario_description(r),
                origin=_normalize_origin(r.get("origin")) if "origin" in fhs_cols else DEFAULT_ORIGIN,
                created_at=created.isoformat() if created is not None else None,
            )
        )
    return FormHistoryListResponse(items=items, total=len(items))


@router.get("/{record_id}", response_model=FormHistoryDetailResponse)
def get_form_history(record_id: int) -> FormHistoryDetailResponse:
    if _ensure_log_tables is not None:
        _ensure_log_tables()
    if not _table_available() or _get_log_engine is None:
        raise HTTPException(status_code=404, detail="History table not available")

    from sqlalchemy import text  # noqa: PLC0415

    fhs_cols = _fhs_columns()
    extra = ""
    if "status" in fhs_cols:
        extra += ", status"
    if "scenario_description" in fhs_cols:
        extra += ", scenario_description"
    if "origin" in fhs_cols:
        extra += ", origin"
    eng = _get_log_engine()
    with eng.connect() as conn:
        row = conn.execute(
            text(f"""
                SELECT id, session_id, broker_name, client_name, client_phone, client_email,
                       programs_matched, created_at, form_fields, accepted_programs,
                       rejected_programs{extra}
                FROM form_history_scenario
                WHERE id = :id
            """),
            {"id": int(record_id)},
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Record not found")

    r = dict(row._mapping)
    raw_form = r.get("form_fields")
    if isinstance(raw_form, str):
        try:
            form_fields = json.loads(raw_form)
        except json.JSONDecodeError:
            form_fields = {}
    elif isinstance(raw_form, dict):
        form_fields = raw_form
    else:
        form_fields = {}

    created = r.get("created_at")
    occupancy, lien, doc, state = _snippet_from_form_fields(form_fields)
    return FormHistoryDetailResponse(
        id=int(r["id"]),
        session_id=r.get("session_id"),
        broker_name=str(r.get("broker_name") or ""),
        client_name=str(r.get("client_name") or ""),
        client_phone=r.get("client_phone"),
        client_email=r.get("client_email"),
        programs_matched=int(r.get("programs_matched") or 0),
        status=_normalize_status(r.get("status")) or DEFAULT_STATUS,
        occupancy=occupancy,
        lien_position=lien,
        documentation_type=doc,
        state=state,
        scenario_description=_row_scenario_description(r),
        origin=_normalize_origin(r.get("origin")) if "origin" in fhs_cols else DEFAULT_ORIGIN,
        created_at=created.isoformat() if created is not None else None,
        form_fields=form_fields,
        accepted_programs=r.get("accepted_programs"),
        rejected_programs=r.get("rejected_programs"),
    )


class FormHistoryMutateResponse(BaseModel):
    ok: bool
    id: int | None = None
    programs_matched: int = 0
    message: str = ""


def _record_exists(record_id: int) -> bool:
    from sqlalchemy import text  # noqa: PLC0415

    eng = _get_log_engine()  # type: ignore[misc]
    with eng.connect() as conn:
        return (
            conn.execute(
                text("SELECT 1 FROM form_history_scenario WHERE id = :id"),
                {"id": int(record_id)},
            ).fetchone()
            is not None
        )


@router.delete("/{record_id}", response_model=FormHistoryMutateResponse)
def delete_form_history(record_id: int) -> FormHistoryMutateResponse:
    if not _table_available() or _get_log_engine is None:
        raise HTTPException(status_code=404, detail="History table not available")
    from sqlalchemy import text  # noqa: PLC0415

    try:
        eng = _get_log_engine()
        with eng.begin() as conn:
            res = conn.execute(
                text("DELETE FROM form_history_scenario WHERE id = :id"),
                {"id": int(record_id)},
            )
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="Record not found")
    except HTTPException:
        raise
    except Exception as exc:
        _log.warning("form_history_scenario delete failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Failed to delete: {exc}") from exc
    return FormHistoryMutateResponse(ok=True, id=int(record_id), message="Scenario deleted")


@router.put("/{record_id}", response_model=FormHistoryMutateResponse)
def update_form_history(record_id: int, body: FormHistoryUpdateRequest) -> FormHistoryMutateResponse:
    """Edit-in-place: recompute eligibility from new form_fields, keep identity."""
    if not _eligibility_available or _find_eligible is None:
        return FormHistoryMutateResponse(ok=False, message="Eligibility engine unavailable")
    if not body.form_fields:
        raise HTTPException(status_code=400, detail="form_fields is required")
    if not _table_available() or _get_log_engine is None:
        raise HTTPException(status_code=404, detail="History table not available")
    if not _record_exists(record_id):
        raise HTTPException(status_code=404, detail="Record not found")

    matched_count, accepted_str, rejected_str = _compute_eligibility(body.form_fields)

    from sqlalchemy import text  # noqa: PLC0415

    sets = [
        "form_fields = :form_fields",
        "accepted_programs = :accepted_programs",
        "rejected_programs = :rejected_programs",
        "programs_matched = :programs_matched",
    ]
    params: dict[str, Any] = {
        "id": int(record_id),
        "form_fields": json.dumps(body.form_fields, ensure_ascii=False),
        "accepted_programs": accepted_str or None,
        "rejected_programs": rejected_str or None,
        "programs_matched": matched_count,
    }
    # Only overwrite identity fields when explicitly provided (Edit keeps them).
    if body.client_name and body.client_name.strip():
        sets.append("client_name = :client_name")
        params["client_name"] = body.client_name.strip()
    if body.client_phone is not None:
        sets.append("client_phone = :client_phone")
        params["client_phone"] = body.client_phone.strip() or None
    if body.client_email and body.client_email.strip():
        sets.append("client_email = :client_email")
        params["client_email"] = body.client_email.strip()
    fhs_cols = _fhs_columns()
    if "status" in fhs_cols and body.status is not None:
        normalized = _normalize_status(body.status, fallback=None)
        if normalized:
            sets.append("status = :status")
            params["status"] = normalized
    if "scenario_description" in fhs_cols:
        desc = _vault_scenario_description(body.form_fields)
        if desc:
            sets.append("scenario_description = :scenario_description")
            params["scenario_description"] = desc

    try:
        eng = _get_log_engine()
        with eng.begin() as conn:
            conn.execute(
                text(f"UPDATE form_history_scenario SET {', '.join(sets)} WHERE id = :id"),
                params,
            )
    except Exception as exc:
        _log.warning("form_history_scenario update failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Failed to update: {exc}") from exc
    return FormHistoryMutateResponse(
        ok=True, id=int(record_id), programs_matched=matched_count, message="Scenario updated"
    )


@router.patch("/{record_id}/status", response_model=FormHistoryMutateResponse)
def set_form_history_status(
    record_id: int, body: FormHistoryStatusRequest
) -> FormHistoryMutateResponse:
    """Change a scenario's lifecycle status (draft/active/locked/closed/archived)."""
    if not _table_available() or _get_log_engine is None:
        raise HTTPException(status_code=404, detail="History table not available")
    if "status" not in _fhs_columns():
        raise HTTPException(status_code=409, detail="Status column missing — run migration 016")
    normalized = _normalize_status(body.status, fallback=None)
    if not normalized:
        raise HTTPException(
            status_code=422, detail=f"Invalid status — expected one of {', '.join(VALID_STATUSES)}"
        )
    from sqlalchemy import text  # noqa: PLC0415

    try:
        eng = _get_log_engine()
        with eng.begin() as conn:
            res = conn.execute(
                text("UPDATE form_history_scenario SET status = :s WHERE id = :id"),
                {"s": normalized, "id": int(record_id)},
            )
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="Record not found")
    except HTTPException:
        raise
    except Exception as exc:
        _log.warning("form_history_scenario status update failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Failed to set status: {exc}") from exc
    return FormHistoryMutateResponse(
        ok=True, id=int(record_id), message=f"Status set to {normalized}"
    )
