"""
Slot engine — portfolio state, planning, ordering and eligibility-request
translation for the chat intake.

The master field catalog (SLOT_DEFS) and value normalization/predicates now
live in backend/metrics.py; they are imported below and re-exported so
`from backend.chat.portfolio import ...` callers keep working.

The 'portfolio' is a flat dict with keys like:
  citizenship, citizenship_status, citizenship_source, citizenship_confidence, ...
  occupancy, occupancy_status, ...
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from backend.metrics import (
    get_chips_for_slot,
    get_state_fields,
)

from backend.metrics import (
    SLOT_DEFS,
    _SLOT_BY_ID,
    _CITY_TO_STATE,
    _STATE_NAME_TO_CODE,
    _is_dscr_path,
    _is_filled,
    _is_triggered,
    _needs_fico,
    city_to_state_code,
    infer_geo_followups_from_county,
    normalize_geo_slot_value,
    normalize_property_state_value,
    property_state_code,
    uses_cltv_leverage,
)
from backend.metrics import portfolio_to_eligibility_request  # moved to the contract module



def _geo_zip_complete(portfolio: dict) -> bool:
    if not _is_filled(portfolio, "state_zip"):
        return False
    digits = re.sub(r"\D", "", str(portfolio.get("state_zip") or ""))
    return len(digits) == 5


def next_geo_slot_missing(portfolio: dict) -> dict | None:
    """
    Next conditional location follow-up for chat intake (mirrors form-mode geo step).
    Returns an ASK_SLOT_DEFINITIVE payload dict, or None when geo is complete / N/A.
    """
    state = property_state_code(portfolio)
    if not state or not _is_filled(portfolio, "property_state"):
        return None
    if not _is_filled(portfolio, "state_county"):
        slot_def = _SLOT_BY_ID.get("state_county") or {}
        return _payload(
            "state_county",
            str(slot_def.get("prompt") or "Which county is the property in?"),
            input_type="text",
            hint=slot_def.get("hint"),
        )

    def _payload(
        slot_id: str,
        text: str,
        *,
        chips: list[dict] | None = None,
        input_type: str = "chips",
        hint: str | None = None,
    ) -> dict:
        slot_def = _SLOT_BY_ID.get(slot_id) or {}
        return {
            "slot_ids": [slot_id],
            "style": "definitive",
            "text": text,
            "chips": chips,
            "input_type": input_type,
            "hint": hint or slot_def.get("hint"),
        }

    missing: dict[str, Any] | None = None
    for field in get_state_fields(state):
        sid = field["slot_id"]
        if field.get("widget") == "zip":
            if not _geo_zip_complete(portfolio):
                missing = field
                break
        elif not _is_filled(portfolio, sid):
            missing = field
            break

    if missing:
        slot_id = missing["slot_id"]
        widget = missing.get("widget") or "select"
        chips = get_chips_for_slot(slot_id, state) or None
        input_type = "number" if widget == "zip" else "chips"
        if widget == "zip":
            chips = None
        return _payload(
            slot_id,
            str(missing.get("prompt") or "Please provide location details."),
            chips=chips,
            input_type=input_type,
            hint=missing.get("hint"),
        )

    if state == "HI" and not _is_filled(portfolio, "hi_lava_zone"):
        return _payload(
            "hi_lava_zone",
            "Which Hawaii lava zone is the property in?",
            chips=[
                {"code": "Zone 1", "label": "Zone 1"},
                {"code": "Zone 2", "label": "Zone 2"},
                {"code": "Zone 3-9", "label": "Zone 3-9 (lower risk)"},
            ],
        )
    return None


# Natural pairing candidates for combined questions (2:1 rule enforcement)
PAIRABLE_SLOTS: dict[str, list[str]] = {
    # Currency/number pairs
    "property_value":        ["loan_amount", "property_type"],
    "loan_amount":           ["property_value", "cash_in_hand", "existing_first_lien"],
    "fico":                  ["estimated_dti"],
    "estimated_dti":         ["fico", "assets"],
    "assets":                ["estimated_dti"],
    "cash_in_hand":          ["loan_amount", "existing_mortgage_upb"],
    "existing_first_lien":   ["loan_amount"],
    "existing_mortgage_upb": ["cash_in_hand"],
    # Enum pairs explicitly approved in the combined-question catalogue
    "dscr":                  ["rental_type"],
    "rental_type":           ["dscr"],
    "occupancy":             ["loan_purpose"],
    "loan_purpose":          ["occupancy"],
    "property_state":        ["property_type"],
    "property_type":         ["property_value", "property_state"],
    "entity_vesting":        ["prepayment_terms"],
    "prepayment_terms":      ["entity_vesting"],
    # credit_event_category and years_since_event are NEVER paired with other slots —
    # always asked as a single dedicated credit-event turn.
}


# ---------------------------------------------------------------------------
# Portfolio helpers
# (_is_filled / _is_triggered are imported from backend.metrics)
# ---------------------------------------------------------------------------

# Intake mode ("lo" | "uw") rides in the portfolio dict (same pattern as the
# free-text-dump flag) so it persists with the session without a DB migration.
# LO asks only triggered essentials; UW additionally offers the optional batch.
_INTAKE_MODE_KEY = "_intake_mode"


def intake_mode(portfolio: dict) -> str:
    """Return the intake mode for this session ('lo' or 'uw'); defaults to 'lo'."""
    return "uw" if portfolio.get(_INTAKE_MODE_KEY) == "uw" else "lo"


def set_intake_mode(portfolio: dict, mode: str) -> dict:
    """Store the intake mode on the portfolio. Unknown values fall back to 'lo'."""
    updated = dict(portfolio)
    updated[_INTAKE_MODE_KEY] = "uw" if str(mode).lower() in ("uw", "underwriter") else "lo"
    return updated


def merge_extracted(
    portfolio: dict,
    extracted: dict,
    source: str = "llm_extract",
) -> dict:
    """Merge LLM-extracted {slot_id: {value, confidence, source_phrase}} into portfolio."""
    updated = dict(portfolio)
    updated_slots: set[str] = set()
    for slot_id, info in extracted.items():
        if slot_id not in _SLOT_BY_ID:
            continue
        value = info.get("value")
        confidence = float(info.get("confidence") or 0.0)
        if value is None or value == "":
            continue
        if slot_id == "property_state":
            value = normalize_property_state_value(str(value))
        # Allow high-confidence extractions (explicit corrections) to overwrite any existing value.
        # Only protect confirmed slots from low-confidence inferences (<0.85).
        existing_conf = float(updated.get(f"{slot_id}_confidence") or 0.0)
        existing_status = updated.get(f"{slot_id}_status", "pending")
        if existing_status == "filled" and confidence < 0.85 and existing_conf >= 0.85:
            continue
        updated[slot_id] = value
        updated[f"{slot_id}_status"] = "filled" if confidence >= 0.85 else "inferred"
        updated[f"{slot_id}_source"] = source
        updated[f"{slot_id}_confidence"] = confidence
        updated_slots.add(slot_id)

    # Re-triangulate when a loan triangle field was explicitly updated so the
    # dependent slot is recomputed even if all three were already filled.
    try:
        pv = float(str(updated.get("property_value") or 0).replace(",", "").replace("$", ""))
        la = float(str(updated.get("loan_amount") or 0).replace(",", "").replace("$", ""))
        lv = float(str(updated.get("ltv") or 0).replace(",", "").replace("%", ""))
        if "ltv" in updated_slots and pv > 0 and lv > 0:
            updated = set_slot(updated, "loan_amount", round(pv * lv / 100), source="auto_computed")
        elif "loan_amount" in updated_slots and pv > 0 and la > 0:
            updated = set_slot(updated, "ltv", round(la / pv * 100), source="auto_computed")
        elif "property_value" in updated_slots and la > 0 and lv > 0:
            updated = set_slot(updated, "loan_amount", round(pv * lv / 100), source="auto_computed")
    except (ValueError, ZeroDivisionError, TypeError):
        pass

    if "property_state" in updated_slots and property_state_code(portfolio) != property_state_code(
        updated
    ):
        geo_from_batch = {
            sid: updated.get(sid)
            for sid in _GEO_FOLLOWUP_SLOTS
            if sid in updated_slots and str(updated.get(sid) or "").strip()
        }
        updated = clear_geo_followups(updated)
        for sid, val in geo_from_batch.items():
            updated = set_slot(updated, sid, val, source=source)

    return triangulate_loan_fields(updated)


def validate_extracted_values(
    extracted: dict,
    existing_portfolio: dict,
) -> tuple[dict, list[dict], list[str]]:
    """Validate Extractor output against SLOT_DEFS option lists (v6 §2 + pain-point 1).

    Returns:
        valid      — slot_id → extraction info dict (safe to pass to merge_extracted)
        ambiguities — list of {slot_id, user_phrase, candidates} for ASK_CLARIFY
        discarded   — list of slot_ids whose values were too wrong to suggest anything
    """
    valid: dict = {}
    ambiguities: list[dict] = []
    discarded: list[str] = []

    for slot_id, info in extracted.items():
        slot = _SLOT_BY_ID.get(slot_id)
        if slot is None:
            # Unknown slot — skip silently
            continue

        value = info.get("value")
        if value is None or value == "":
            continue

        # State slot — use dedicated Levenshtein validator (kind=text, so must come first)
        if slot_id == "property_state":
            code, suggestion = validate_state_input(str(value))
            if code:
                # Exact match — normalise to 2-letter code
                valid[slot_id] = {**info, "value": code}
            elif suggestion:
                # Near-miss — clarify
                ambiguities.append({
                    "slot_id": slot_id,
                    "user_phrase": str(value),
                    "candidates": [suggestion],
                })
            else:
                # Too far off — discard
                discarded.append(slot_id)
            continue

        # Non-enum slots (currency, number, text) — pass through as-is
        if slot.get("kind") != "enum" or not slot.get("options"):
            valid[slot_id] = info
            continue

        options: list[dict] = slot["options"]

        # General enum — check code, label, and lowercase alias
        low = str(value).strip().lower()
        matched_code: str | None = None
        for opt in options:
            if (
                low == opt["code"].lower()
                or low == opt["label"].lower()
                or low.replace("-", "").replace(" ", "") == opt["code"].lower().replace("_", "")
            ):
                matched_code = opt["code"]
                break

        if matched_code:
            valid[slot_id] = {**info, "value": matched_code}
            continue

        # years_since_event — the Extractor sometimes returns a raw count ("5 years",
        # "5 years back", "18 months") instead of a bucket code. Bucket it numerically
        # (same boundaries as the frontend computeYearsSinceBucket) instead of
        # discarding the answer and re-asking the timing.
        if slot_id == "years_since_event":
            num = re.search(r"(\d+(?:\.\d+)?)", low)
            if num:
                n = float(num.group(1))
                if "month" in low:
                    n = n / 12.0
                bucket = (
                    "<1 year" if n < 1
                    else "1-2 years" if n < 2
                    else "2-3 years" if n < 3
                    else "3-4 years" if n < 4
                    else "4-7 years" if n < 7
                    else "7+ years"
                )
                valid[slot_id] = {**info, "value": bucket}
                continue

        # Near-miss: find best candidate(s) by prefix or substring
        candidates = [
            opt["code"] for opt in options
            if low in opt["code"].lower() or low in opt["label"].lower()
            or opt["code"].lower().startswith(low[:3]) or opt["label"].lower().startswith(low[:3])
        ]
        if candidates:
            ambiguities.append({
                "slot_id": slot_id,
                "user_phrase": str(value),
                "candidates": candidates[:3],
            })
        else:
            # Nothing close — discard and let the LLM re-ask naturally
            discarded.append(slot_id)

    return valid, ambiguities, discarded


def clear_slot(portfolio: dict, slot_id: str) -> dict:
    """Remove a slot value entirely (set back to pending with no value)."""
    updated = dict(portfolio)
    updated.pop(slot_id, None)
    updated[f"{slot_id}_status"] = "pending"
    updated.pop(f"{slot_id}_source", None)
    updated.pop(f"{slot_id}_confidence", None)
    return updated


def _parse_money(val: Any) -> float:
    try:
        return float(str(val or 0).replace(",", "").replace("$", "").replace("%", ""))
    except (ValueError, TypeError):
        return 0.0


def loan_amount_sidebar_label(_portfolio: dict) -> str:
    return "Loan Amount"


def loan_amount_prompt(_portfolio: dict) -> str:
    return "What's the loan amount, down payment, or LTV?"


def slot_sidebar_label(portfolio: dict, slot_id: str) -> str:
    if slot_id == "loan_amount":
        return loan_amount_sidebar_label(portfolio)
    slot = _SLOT_BY_ID.get(slot_id, {})
    return slot.get("sidebar_label", slot_id)


def slot_prompt(portfolio: dict, slot_id: str) -> str:
    if slot_id == "loan_amount":
        return loan_amount_prompt(portfolio)
    slot = _SLOT_BY_ID.get(slot_id, {})
    return slot.get("prompt") or slot.get("sidebar_label", slot_id)


def leverage_slot_labels(portfolio: dict) -> tuple[str, str]:
    if uses_cltv_leverage(portfolio):
        return ("LTV", "What's the LTV on the new lien?")
    return ("LTV", "What's the LTV?")


_GEO_FOLLOWUP_SLOTS = (
    "state_county", "state_city", "state_borough", "state_zip",
    "is_in_indianapolis", "is_in_baltimore", "is_in_philadelphia", "is_in_memphis", "is_in_lubbock",
    "hi_lava_zone",
)
_GEO_SUB_SLOTS = (
    "state_city", "state_borough", "state_zip",
    "is_in_indianapolis", "is_in_baltimore", "is_in_philadelphia", "is_in_memphis", "is_in_lubbock",
)


def clear_geo_sub_followups(portfolio: dict) -> dict:
    """Drop borough / city / zip / metro answers when county changes (keep county)."""
    p = dict(portfolio)
    for slot_id in _GEO_SUB_SLOTS:
        p[slot_id] = ""
        p[f"{slot_id}_status"] = "pending"
        p.pop(f"{slot_id}_source", None)
        p[f"{slot_id}_confidence"] = 0.0
    return p


def clear_geo_followups(portfolio: dict) -> dict:
    """Drop county / borough / zip / metro geo answers when property state changes."""
    p = dict(portfolio)
    for slot_id in _GEO_FOLLOWUP_SLOTS:
        p[slot_id] = ""
        p[f"{slot_id}_status"] = "pending"
        p.pop(f"{slot_id}_source", None)
        p[f"{slot_id}_confidence"] = 0.0
    return p


def apply_county_geo_inference(portfolio: dict) -> dict:
    """Fill state-specific geo follow-ups from county (e.g. TX Lubbock vs Other)."""
    state = property_state_code(portfolio)
    county = str(portfolio.get("state_county") or "").strip()
    if not state or not county:
        return portfolio
    inferred = infer_geo_followups_from_county(state, county)
    p = dict(portfolio)
    for slot_id, value in inferred.items():
        p = set_slot(p, slot_id, value, source="county_inference")
    return p


def set_slot(portfolio: dict, slot_id: str, value: Any, source: str = "user_chip") -> dict:
    updated = dict(portfolio)
    if slot_id == "property_state" and value is not None:
        value = normalize_property_state_value(str(value))
        if property_state_code(portfolio) != property_state_code({"property_state": value}):
            updated = clear_geo_followups(updated)
    updated[slot_id] = value
    updated[f"{slot_id}_status"] = "filled"
    updated[f"{slot_id}_source"] = source
    updated[f"{slot_id}_confidence"] = 1.0
    if slot_id == "state_county":
        if str(portfolio.get("state_county") or "").strip() != str(value or "").strip():
            updated = clear_geo_sub_followups(updated)
        updated = apply_county_geo_inference(updated)
    return updated


def triangulate_loan_fields(portfolio: dict) -> dict:
    """Auto-fill property_value, loan_amount, ltv, and cltv when enough inputs are known.

    Piggyback: `ltv` = new 2nd lien LTV; `cltv` = (1st + 2nd) / value.
    Subordination: `ltv` = new 1st LTV; `cltv` = (1st + retained 2nd) / value.
    Also auto-infers investment_income_path = 'income' when doc_type = 'full_doc'.
    """
    p = dict(portfolio)

    # Full Documentation always implies personal income path — never DSCR.
    if p.get("doc_type") == "full_doc" and not _is_filled(p, "investment_income_path"):
        p = set_slot(p, "investment_income_path", "income", source="auto_inferred")

    pv_ok = _is_filled(p, "property_value")
    la_ok = _is_filled(p, "loan_amount")
    lv_ok = _is_filled(p, "ltv")
    cltv_ok = _is_filled(p, "cltv")
    try:
        pv = _parse_money(p.get("property_value"))
        la = _parse_money(p.get("loan_amount"))
        lv = _parse_money(p.get("ltv"))
        cltv_v = _parse_money(p.get("cltv"))

        if p.get("lien_position") == "second_lien_piggyback":
            first = _parse_money(p.get("existing_first_lien"))
            if pv_ok and la_ok and pv > 0:
                if not lv_ok:
                    p = set_slot(p, "ltv", round(la / pv * 100), source="auto_computed")
                if not cltv_ok:
                    p = set_slot(p, "cltv", round((first + la) / pv * 100), source="auto_computed")
            elif pv_ok and lv_ok and not la_ok and lv > 0:
                loan = pv * lv / 100
                p = set_slot(p, "loan_amount", round(loan), source="auto_computed")
                if not cltv_ok:
                    p = set_slot(p, "cltv", round((first + loan) / pv * 100), source="auto_computed")
            elif pv_ok and cltv_ok and not la_ok and cltv_v > 0:
                loan = max(0.0, pv * cltv_v / 100 - first)
                p = set_slot(p, "loan_amount", round(loan), source="auto_computed")
                if loan > 0 and not lv_ok:
                    p = set_slot(p, "ltv", round(loan / pv * 100), source="auto_computed")
        elif p.get("existing_second_lien") == "Yes — needs subordination":
            second = _parse_money(p.get("existing_second_lien_balance"))
            if pv_ok and la_ok and pv > 0:
                if not lv_ok:
                    p = set_slot(p, "ltv", round(la / pv * 100), source="auto_computed")
                if not cltv_ok:
                    p = set_slot(p, "cltv", round((la + second) / pv * 100), source="auto_computed")
            elif pv_ok and lv_ok and not la_ok and lv > 0:
                loan = pv * lv / 100
                p = set_slot(p, "loan_amount", round(loan), source="auto_computed")
                if not cltv_ok:
                    p = set_slot(p, "cltv", round((loan + second) / pv * 100), source="auto_computed")
            elif pv_ok and cltv_ok and not la_ok and cltv_v > 0:
                loan = max(0.0, pv * cltv_v / 100 - second)
                p = set_slot(p, "loan_amount", round(loan), source="auto_computed")
                if loan > 0 and not lv_ok:
                    p = set_slot(p, "ltv", round(loan / pv * 100), source="auto_computed")
        elif pv_ok and la_ok and not lv_ok and pv > 0 and la > 0:
            p = set_slot(p, "ltv", round(la / pv * 100), source="auto_computed")
        elif pv_ok and lv_ok and not la_ok and pv > 0 and lv > 0:
            p = set_slot(p, "loan_amount", round(pv * lv / 100), source="auto_computed")
        elif la_ok and lv_ok and not pv_ok and lv > 0 and la > 0:
            p = set_slot(p, "property_value", round(la / (lv / 100)), source="auto_computed")
    except (ValueError, ZeroDivisionError, TypeError):
        pass
    return p


def confirm_slot(portfolio: dict, slot_id: str) -> dict:
    """Promote inferred → filled (user confirmed the inferred value)."""
    updated = dict(portfolio)
    if updated.get(f"{slot_id}_status") == "inferred":
        updated[f"{slot_id}_status"] = "filled"
        updated[f"{slot_id}_source"] = "user_chip"
        updated[f"{slot_id}_confidence"] = 1.0
    return updated


# ---------------------------------------------------------------------------
# Milestone helpers
# ---------------------------------------------------------------------------

# Collected only in the frontend PostEssentialsOptionalPicker — not the server checklist.
_POST_ESSENTIALS_PICKER_SLOTS = frozenset({"acreage"})

# Checklist / submit readiness: ask geo follow-ups before eligibility when state requires them.
_CHECKLIST_SLOT_ORDER: tuple[str, ...] = (
    "citizenship",
    "occupancy",
    "loan_purpose",
    "property_type",
    "property_value",
    "loan_amount",
    "ltv",
    "cltv",
    "property_state",
    "state_county",
    "state_city",
    "state_borough",
    "state_zip",
    "is_in_indianapolis",
    "is_in_baltimore",
    "is_in_philadelphia",
    "is_in_memphis",
    "is_in_lubbock",
    "lien_position",
    "existing_first_lien",
    "existing_second_lien",
    "existing_second_lien_balance",
    "fico",
    "doc_type",
    "doc_timeframe",
    "estimated_dti",
    "dscr",
    "rental_type",
    "investment_income_path",
    "prepayment_terms",
    "bank_stmt_source",
    "self_employment_years",
    "first_time_homebuyer",
    "first_time_investor",
    "established_primary_res",
    "credit_event_category",
    "credit_event_type",
    "years_since_event",
    "payment_history",
    "cash_in_hand",
    "rural_property",
    "power_of_attorney",
    "non_arms_length",
)


def _checklist_slot_display(slot: dict, portfolio: dict) -> dict:
    return {
        "id": slot["id"],
        "label": slot_sidebar_label(portfolio, slot["id"]),
        "kind": slot["kind"],
        "hint": slot.get("hint"),
        "options": slot.get("options") or [],
    }


def section1_complete(portfolio: dict) -> bool:
    for slot in SLOT_DEFS:
        if slot["section"] != 1:
            continue
        if not _is_triggered(slot, portfolio):
            continue
        if not _is_filled(portfolio, slot["id"]):
            return False
    return True


# All "red-star" fields from the wizard — must be filled before Run Eligibility appears.
_CORE_SLOTS_BEFORE_PREVIEW = frozenset({
    "citizenship",
    "occupancy",
    "loan_purpose",
    "property_type",
    "ltv",
    "fico",
    "doc_type",
    "property_state",
    "lien_position",
    "prepayment_terms",
})


def core_slots_ready(portfolio: dict) -> bool:
    """True when every red-star (wizard-required) field is filled for this scenario.

    Checks all slots in _CORE_SLOTS_BEFORE_PREVIEW that are triggered, plus
    estimated_dti (non-DSCR path) or dscr (DSCR path).
    """
    for slot_id in _CORE_SLOTS_BEFORE_PREVIEW:
        slot = _SLOT_BY_ID.get(slot_id)
        if slot is None:
            continue
        if not _is_triggered(slot, portfolio):
            continue  # not applicable to this scenario
        if not _is_filled(portfolio, slot_id):
            return False
    dti_slot = _SLOT_BY_ID.get("estimated_dti")
    dscr_slot = _SLOT_BY_ID.get("dscr")
    if dti_slot and _is_triggered(dti_slot, portfolio) and not _is_filled(portfolio, "estimated_dti"):
        return False
    if dscr_slot and _is_triggered(dscr_slot, portfolio) and not _is_filled(portfolio, "dscr"):
        return False
    return True


def ready_for_final_eligibility(portfolio: dict) -> bool:
    """All triggered essential slots filled, including required geo follow-ups."""
    if next_geo_slot_missing(portfolio) is not None:
        return False
    for slot in SLOT_DEFS:
        if slot["priority"] == "optional":
            continue
        if not _is_triggered(slot, portfolio):
            continue
        if not _is_filled(portfolio, slot["id"]):
            return False
    return True


def filled_essentials_count(portfolio: dict) -> int:
    return sum(
        1 for slot in SLOT_DEFS
        if slot["priority"] == "essential"
        and _is_triggered(slot, portfolio)
        and _is_filled(portfolio, slot["id"])
    )


def list_remaining_triggered_slots(portfolio: dict, *, limit: int = 12) -> list[dict]:
    """Triggered, unfilled non-optional slots for the inline checklist (geo included)."""
    by_id: dict[str, dict] = {}
    for slot in SLOT_DEFS:
        if slot["priority"] == "optional":
            continue
        if not _is_triggered(slot, portfolio):
            continue
        if slot["id"] in _POST_ESSENTIALS_PICKER_SLOTS:
            continue
        if not _is_filled(portfolio, slot["id"]):
            by_id[slot["id"]] = _checklist_slot_display(slot, portfolio)

    ordered: list[dict] = []
    for sid in _CHECKLIST_SLOT_ORDER:
        if sid in by_id:
            ordered.append(by_id.pop(sid))
            if len(ordered) >= limit:
                return ordered
    for item in by_id.values():
        ordered.append(item)
        if len(ordered) >= limit:
            break
    return ordered


def list_remaining_themed_slots(
    portfolio: dict, *, max_n: int = 3, min_n: int = 2
) -> list[dict]:
    """Like list_remaining_triggered_slots but keeps items from the same section together
    and prioritises numeric/currency fields over enum (options) questions.

    Section selection:
    - Prefer the section whose items contain the most numeric/currency fields (gives
      actionable quantitative asks first).
    - Break ties by the section with the most total items, then lowest section number.
    - Return up to max_n from that one section only — never bleed into other sections.

    Within the chosen section:
    - currency fields first, then number fields, then enum — so quantitative inputs
      always surface before option-click chips.
    """
    _slot_meta: dict[str, dict] = {s["id"]: s for s in SLOT_DEFS}
    _slot_section: dict[str, int] = {sid: m.get("section", 99) for sid, m in _slot_meta.items()}
    _slot_kind: dict[str, str] = {sid: m.get("kind", "enum") for sid, m in _slot_meta.items()}

    by_section: dict[int, list[dict]] = {}
    by_id: dict[str, dict] = {}

    _DEDICATED_TURN_SLOTS = {
        "payment_history", "credit_event_category", "credit_event_type", "years_since_event",
    }
    for slot in SLOT_DEFS:
        if slot["priority"] == "optional":
            continue
        if not _is_triggered(slot, portfolio):
            continue
        if slot["id"] in _POST_ESSENTIALS_PICKER_SLOTS:
            continue
        if slot["id"] in _DEDICATED_TURN_SLOTS:
            continue  # always asked as standalone dedicated questions — exclude from themed hints
        if not _is_filled(portfolio, slot["id"]):
            by_id[slot["id"]] = _checklist_slot_display(slot, portfolio)

    # Populate sections in _CHECKLIST_SLOT_ORDER (preserves section-internal ordering)
    for sid in _CHECKLIST_SLOT_ORDER:
        if sid in by_id:
            item = by_id.pop(sid)
            sec = _slot_section.get(item["id"], 99)
            by_section.setdefault(sec, []).append(item)
    for item in by_id.values():  # any extras not in checklist order
        sec = _slot_section.get(item["id"], 99)
        by_section.setdefault(sec, []).append(item)

    if not by_section:
        return []

    def _numeric_count(items: list[dict]) -> int:
        return sum(1 for it in items if _slot_kind.get(it["id"], "enum") in ("currency", "number"))

    # Pick section: most numeric fields → most total items → lowest section number
    best_sec = max(
        by_section.keys(),
        key=lambda s: (_numeric_count(by_section[s]), len(by_section[s]), -s),
    )

    # Sort within the section: currency → number → enum
    _kind_rank = {"currency": 0, "number": 1, "enum": 2}
    batch = sorted(
        by_section[best_sec],
        key=lambda it: _kind_rank.get(_slot_kind.get(it["id"], "enum"), 2),
    )
    return batch[:max_n]


def list_remaining_prioritized_slots(portfolio: dict, *, max_n: int = 4) -> list[dict]:
    """Unfilled triggered slots for hint / still-missing text.

    Sorts currency → number → enum (numeric first), then checklist order within
    each kind. Returns at most max_n items (may span sections).

    Dedicated-turn slots (payment_history, credit event slots) are excluded —
    they are always asked as their own separate questions by the planner.
    """
    _DEDICATED = {
        "payment_history",
        "credit_event_category",
        "credit_event_type",
        "years_since_event",
    }
    _slot_kind: dict[str, str] = {s["id"]: s.get("kind", "enum") for s in SLOT_DEFS}
    _order_index = {sid: i for i, sid in enumerate(_CHECKLIST_SLOT_ORDER)}
    _kind_rank = {"currency": 0, "number": 1, "enum": 2}
    remaining = [
        s for s in list_remaining_triggered_slots(portfolio, limit=50)
        if s["id"] not in _DEDICATED
    ]
    ordered = sorted(
        remaining,
        key=lambda it: (
            _kind_rank.get(_slot_kind.get(it["id"], "enum"), 2),
            _order_index.get(it["id"], 999),
        ),
    )
    return ordered[:max_n]


def lien_followup_missing(portfolio: dict) -> str | None:
    """Lien follow-ups required before CLTV triangulation can be meaningful."""
    lien_pos = portfolio.get("lien_position")
    if lien_pos == "second_lien_piggyback" and not _is_filled(portfolio, "existing_first_lien"):
        return "existing_first_lien"
    if lien_pos == "first_lien_only" and not _is_filled(portfolio, "existing_second_lien"):
        return "existing_second_lien"
    if (
        lien_pos == "first_lien_only"
        and portfolio.get("existing_second_lien") == "Yes — needs subordination"
        and not _is_filled(portfolio, "existing_second_lien_balance")
    ):
        return "existing_second_lien_balance"
    return None


def loan_triangle_missing(portfolio: dict) -> str | None:
    """Return the slot_id that should be asked next to complete the loan triangle.

    If property_value is known but neither loan_amount nor ltv is filled → ask loan_amount.
    If loan_amount is known but neither property_value nor ltv is filled → ask property_value.
    Returns None when the triangle is complete or cannot be resolved.
    """
    if lien_followup_missing(portfolio):
        return None
    pv_ok = _is_filled(portfolio, "property_value")
    la_ok = _is_filled(portfolio, "loan_amount")
    lv_ok = _is_filled(portfolio, "ltv")
    if pv_ok and not la_ok and not lv_ok:
        return "loan_amount"
    if la_ok and not pv_ok and not lv_ok:
        return "property_value"
    return None


_GEO_OPTIONAL_IDS = frozenset({
    "state_county", "state_city", "state_borough", "state_zip",
    "is_in_indianapolis", "is_in_baltimore", "is_in_philadelphia", "is_in_memphis", "is_in_lubbock",
})

# Highest-impact optional refinements after core intake (max 4 shown in chat).
_CRITICAL_OPTIONAL_ORDER = (
    "gift_funds_pct",
    "interest_only",
    "prepayment_terms",
    "rural_property",
    "declining_market",
    "property_condition",
    "tradelines",
    "first_time_homebuyer",
    "first_time_investor",
    "established_primary_res",
    "cash_in_hand",
    "bank_stmt_source",
    "self_employment_years",
)


def _optional_path_excluded_slot_ids(portfolio: dict) -> frozenset[str]:
    """Slots that must not appear in optional refinements for this income/doc path."""
    excluded: set[str] = set()
    if _is_dscr_path(portfolio):
        excluded.update({
            "estimated_dti", "bank_stmt_source", "self_employment_years",
            "investment_income_path", "doc_type",
        })
    else:
        excluded.update({"dscr", "rental_type"})
    if portfolio.get("doc_type") == "full_doc":
        excluded.update({
            "dscr", "rental_type", "investment_income_path",
            "bank_stmt_source", "self_employment_years",
        })
    return frozenset(excluded)


def _slot_to_optional_display(slot: dict) -> dict:
    opts = [{"code": o["code"], "label": o["label"]} for o in (slot.get("options") or [])]
    return {
        "id": slot["id"],
        "label": slot["sidebar_label"],
        "prompt": slot.get("prompt") or slot["sidebar_label"],
        "kind": slot["kind"],
        "section": slot["section"],
        "hint": slot.get("hint"),
        "options": opts or None,
    }


def _eligible_for_critical_optional(slot: dict, portfolio: dict, excluded: frozenset[str]) -> bool:
    sid = slot["id"]
    if sid in excluded or sid in _GEO_OPTIONAL_IDS:
        return False
    if _is_filled(portfolio, sid):
        return False
    # Both optional and (triggered) essential refinements from _CRITICAL_OPTIONAL_ORDER
    # may surface in the chat pill — gate on the slot's own trigger condition.
    return _is_triggered(slot, portfolio)


def list_critical_optional_detail_slots(portfolio: dict, *, limit: int = 4) -> list[dict]:
    """Up to `limit` high-impact optional refinements for the chat pill UI."""
    excluded = _optional_path_excluded_slot_ids(portfolio)
    out: list[dict] = []
    seen: set[str] = set()
    for sid in _CRITICAL_OPTIONAL_ORDER:
        if len(out) >= limit:
            break
        slot = _SLOT_BY_ID.get(sid)
        if not slot or sid in seen:
            continue
        if not _eligible_for_critical_optional(slot, portfolio, excluded):
            continue
        out.append(_slot_to_optional_display(slot))
        seen.add(sid)
    return out


def list_optional_detail_slots(portfolio: dict) -> list[dict]:
    """Return ALL unfilled slots suitable for the optional-details mini-form.
    Includes optional-priority slots plus essential slots that are NOT triggered
    for this scenario (triggered essentials get asked by the Asker in the main flow).
    Returns full metadata including section, kind, and options for the frontend form."""
    out = []
    for slot in SLOT_DEFS:
        if slot["id"] in _GEO_OPTIONAL_IDS:
            continue
        if _is_filled(portfolio, slot["id"]):
            continue
        # Triggered essentials are critical and get asked normally — skip them here.
        if slot["priority"] == "essential" and _is_triggered(slot, portfolio):
            continue
        out.append(_slot_to_optional_display(slot))
    return out


# ---------------------------------------------------------------------------
# LLM parameter representation
# ---------------------------------------------------------------------------

def parameters_for_llm(portfolio: dict, bulk: bool = False) -> dict:
    """
    Build the compact schema representation passed to each LLM call.

    Priority is two-tier: `essential` (required when its `trigger` condition
    applies) and `optional`. bulk=True (used by the Extractor in bulk mode)
    includes ALL essential slots regardless of trigger, so the LLM can extract
    them from a dense initial dump; otherwise only triggered essentials are sent.
    """
    def _compact(s: dict) -> dict:
        return {
            "id": s["id"],
            "label": slot_sidebar_label(portfolio, s["id"]),
            "kind": s["kind"],
            "options": [o["code"] for o in s.get("options") or []] or None,
            "prompt_template": s.get("prompt"),
            "hint": s.get("hint"),
            "filled": _is_filled(portfolio, s["id"]),
            "value": portfolio.get(s["id"]),
        }

    return {
        "essential": [
            _compact(s) for s in SLOT_DEFS
            if s["priority"] == "essential"
            and (bulk or s.get("trigger") is None or s["trigger"](portfolio))
        ],
        "optional": [
            _compact(s) for s in SLOT_DEFS
            if s["priority"] == "optional"
        ],
    }


# ---------------------------------------------------------------------------
# Portfolio → EligibilityRequest
# ---------------------------------------------------------------------------

def force_combined_next(session: Any, asker_out: dict) -> dict | None:
    """Attempt to upgrade a definitive proposal to a combined question using PAIRABLE_SLOTS."""
    proposed = asker_out.get("proposed_next") or {}
    slot_ids = proposed.get("slot_ids") or []
    if not slot_ids:
        return None
    primary = slot_ids[0]
    partners = PAIRABLE_SLOTS.get(primary, [])
    if not partners:
        return None
    for partner in partners:
        slot_def = _SLOT_BY_ID.get(partner)
        if slot_def and not _is_filled(session.portfolio, partner) and _is_triggered(slot_def, session.portfolio):
            combined = dict(proposed)
            combined["style"] = "combined"
            combined["slot_ids"] = [primary, partner]
            combined["input_type"] = "mixed"
            if not combined.get("text"):
                combined["text"] = (
                    f"{slot_sidebar_label(session.portfolio, primary)}"
                    f" and {slot_sidebar_label(session.portfolio, partner)}?"
                )
            return combined
    return None


def force_definitive_next(session: Any, asker_out: dict) -> dict | None:
    """Downgrade a combined proposal to a definitive single-slot question."""
    proposed = asker_out.get("proposed_next") or {}
    slot_ids = proposed.get("slot_ids") or []
    if not slot_ids:
        return None
    primary = slot_ids[0]
    slot_def = _SLOT_BY_ID.get(primary)
    if not slot_def:
        return None
    result = dict(proposed)
    result["style"] = "definitive"
    result["slot_ids"] = [primary]
    # CRITICAL: clear Asker's mixed chips so _serialize looks up the correct
    # slot-specific options from SLOT_DEFS instead of using the stale combined set.
    result["chips"] = None
    # Replace combined question text with this slot's own prompt.
    result["text"] = slot_prompt(session.portfolio, primary)
    result["input_type"] = slot_def["kind"] if slot_def["kind"] in (
        "chips", "chips_multi", "currency", "number"
    ) else ("chips" if slot_def.get("options") else "currency")
    return result


# ---------------------------------------------------------------------------
# v6 — Deterministic slot ordering + strict validation helpers
# ---------------------------------------------------------------------------

def _levenshtein(a: str, b: str) -> int:
    """Edit distance between two strings (for near-miss state validation)."""
    if a == b:
        return 0
    if len(a) > len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i]
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            curr.append(min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost))
        prev = curr
    return prev[-1]


def validate_state_input(raw: str) -> tuple[str | None, str | None]:
    """Strict state validation (v6 pain-point 1).

    Returns:
        (code, None)        — clean exact match, normalised to 2-letter code.
        (None, best_code)   — near-miss (Levenshtein ≤ 2); suggest clarification.
        (None, None)        — too far; discard and re-ask.
    """
    v = raw.strip()
    if not v:
        return None, None
    up = v.upper()
    # Exact 2-letter code
    if up in _STATE_NAME_TO_CODE.values():
        return up, None
    # Exact state name (case-insensitive, allow dots)
    low = v.lower().replace(".", "")
    if low in _STATE_NAME_TO_CODE:
        return _STATE_NAME_TO_CODE[low], None
    # Near-miss: fuzzy match against full state names
    best_name, best_name_dist = min(
        ((n, _levenshtein(low, n)) for n in _STATE_NAME_TO_CODE),
        key=lambda x: x[1],
    )
    # Near-miss: fuzzy match against 2-letter codes
    best_code, best_code_dist = min(
        ((c, _levenshtein(up, c)) for c in _STATE_NAME_TO_CODE.values()),
        key=lambda x: x[1],
    )
    if best_name_dist <= 2:
        return None, _STATE_NAME_TO_CODE[best_name]
    if best_code_dist <= 1:
        return None, best_code
    return None, None


# Canonical deterministic question order (v6 §3). Maps to existing slot IDs.
# Optional slots (priority == "optional") are intentionally included but
# next_slot_strict() skips them — they are batched in OFFER_OPTIONAL_BATCH.
SLOT_ORDER: tuple[str, ...] = (
    # ─── Block 1: Character + Capital ──────────────────────────────
    "citizenship",
    "visa_category",
    "occupancy",
    "loan_purpose",
    "lien_position",
    "second_lien_product",
    "heloc_draw_years",
    "heloc_initial_draw",
    "property_type",
    "property_value",
    "loan_amount",
    "ltv",
    "cltv",
    "existing_first_lien",
    "existing_second_lien",
    "existing_second_lien_balance",
    "fico",
    "first_time_homebuyer",
    "first_time_investor",
    "established_primary_res",
    "investment_income_path",
    # ─── Block 2: Capacity ─────────────────────────────────────────
    "doc_type",
    "doc_timeframe",
    "estimated_dti",
    "dscr",
    "rental_type",
    "cash_in_hand",
    "prepayment_terms",
    "prepay_stepdown",
    "reserves_months",
    "vacant_property",
    "recently_rehabbed",
    "bank_stmt_source",
    "self_employment_years",
    # ─── Block 3: Collateral (geo + condition) ─────────────────────
    "property_state",
    "state_county",
    "state_city",
    "state_borough",
    "state_zip",
    "is_in_indianapolis",
    "is_in_baltimore",
    "is_in_philadelphia",
    "is_in_memphis",
    "is_in_lubbock",
    "hi_lava_zone",
    # ─── Block 4: Credit + Housing ─────────────────────────────────
    "credit_event_category",
    "credit_event_type",
    "years_since_event",
    "payment_history",
    # ─── Block 5: Transaction Conditions ───────────────────────────
    "rural_property",
    "power_of_attorney",
    "non_arms_length",
)


def next_slot_strict(portfolio: dict) -> dict | None:
    """Return the next slot to ask per deterministic SLOT_ORDER (v6 §3).

    Never returns optional-priority slots — those are bundled in OFFER_OPTIONAL_BATCH.
    Returns the full slot definition dict, or None when all triggered non-optional
    slots are filled.
    """
    for slot_id in SLOT_ORDER:
        slot = _SLOT_BY_ID.get(slot_id)
        if slot is None:
            continue
        if slot.get("priority") == "optional":
            continue
        if not _is_triggered(slot, portfolio):
            continue
        if _is_filled(portfolio, slot_id):
            continue
        return slot
    return None


# Fields that /api/eligibility/quick cares about — used by preview-threshold check.
_QUICK_PAYLOAD_FIELDS: tuple[str, ...] = (
    "citizenship",
    "occupancy",
    "loan_purpose",
    "lien_position",
    "property_type",
    "property_value",
    "loan_amount",
    "ltv",
    "fico",
    "property_state",
    "doc_type",
)


def quick_eligibility_fill_ratio(portfolio: dict) -> float:
    """Fraction of triggered quick-payload fields that are filled (v6 §5).

    Returns a float 0.0–1.0. Triggered-but-not-applicable fields are excluded
    from both numerator and denominator so the ratio stays meaningful.
    """
    total = 0
    filled = 0
    for slot_id in _QUICK_PAYLOAD_FIELDS:
        slot = _SLOT_BY_ID.get(slot_id)
        if slot is None:
            continue
        if not _is_triggered(slot, portfolio):
            continue
        total += 1
        if _is_filled(portfolio, slot_id):
            filled += 1
    return filled / total if total > 0 else 0.0


def full_triggered_fill_ratio(portfolio: dict) -> float:
    """Fraction of ALL triggered essential (non-optional) slots that are filled.

    This is a much broader measure than quick_eligibility_fill_ratio (which only
    checks 11 core fields). Use this to gate the OFFER_PREVIEW milestone so that
    a single bulk extraction cannot trigger it just by filling the narrow quick set.
    """
    total = 0
    filled = 0
    for slot in SLOT_DEFS:
        if slot["priority"] == "optional":
            continue
        if not _is_triggered(slot, portfolio):
            continue
        total += 1
        if _is_filled(portfolio, slot["id"]):
            filled += 1
    return filled / total if total > 0 else 0.0


# Display order for the end-of-intake optional batch card (v6 §4b).
_OPTIONAL_BATCH_ORDER: tuple[str, ...] = (
    "interest_only",
    "gift_funds_pct",
    "declining_market",
    "property_condition",
    "acreage",
    "tradelines",
    "prepay_stepdown",
    "vacant_property",
    "recently_rehabbed",
    "first_time_homebuyer",
    "first_time_investor",
)


def list_optional_batch_slots(portfolio: dict) -> list[dict]:
    """All triggered, unfilled optional slots for the end-of-intake batch card (v6 §4b)."""
    result: list[dict] = []
    seen: set[str] = set()
    for sid in _OPTIONAL_BATCH_ORDER:
        if sid in seen:
            continue
        slot = _SLOT_BY_ID.get(sid)
        if slot is None:
            continue
        if not _is_triggered(slot, portfolio):
            continue
        if _is_filled(portfolio, sid):
            continue
        result.append(_slot_to_optional_display(slot))
        seen.add(sid)
    return result


# ---------------------------------------------------------------------------
# Scenario note
# ---------------------------------------------------------------------------

@dataclass
class ScenarioNote:
    text: str
    related_slot: str | None
    paraphrase: str
    created_at: datetime = field(default_factory=datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "related_slot": self.related_slot,
            "paraphrase": self.paraphrase,
            "created_at": self.created_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ScenarioNote":
        return cls(
            text=d.get("text", ""),
            related_slot=d.get("related_slot"),
            paraphrase=d.get("paraphrase", ""),
            created_at=datetime.fromisoformat(d["created_at"]) if d.get("created_at") else datetime.utcnow(),
        )
