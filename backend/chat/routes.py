"""
/api/intake/* — server-side chat intake (backend.chat package).

Routes:
  POST /api/intake/start
  POST /api/intake/message
  POST /api/intake/refine
  POST /api/intake/preview
  POST /api/intake/preview-shown
  POST /api/intake/submit
  POST /api/intake/bulk_fill
  POST /api/intake/edit_slot
  POST /api/intake/next_question
  POST /api/intake/chip_answer
  POST /api/intake/confirm_inferred
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.eligibility import EligibilityRequest, QuickEligibilityRequest
from backend.eligibility import build_full_response, build_quick_response, run_eligibility_engine
from backend.chat.session import (
    IntakeTurn,
    create_session,
    load_session,
    save_session,
)
from backend.chat.next_question import asker_llm
from backend.chat.extract import ExtractorAmbiguity, extractor_llm
from backend.utilities.guard import is_greeting
from backend.chat.next_question import (
    Action,
    apply_action_bookkeeping,
    greeting_bot_text,
    increment_user_answer_count,
    milestone_bot_text,
    planner_gate,
    planner_override,
)
from backend.metrics import get_chips_for_slot
from backend.chat.portfolio import (
    _SLOT_BY_ID,
    city_to_state_code,
    clear_slot,
    confirm_slot,
    leverage_slot_labels,
    normalize_geo_slot_value,
    slot_prompt,
    slot_sidebar_label,
    merge_extracted,
    validate_extracted_values,
    parameters_for_llm,
    intake_mode,
    set_intake_mode,
    portfolio_to_eligibility_request,
    ready_for_final_eligibility,
    uses_cltv_leverage,
    set_slot,
    triangulate_loan_fields,
    list_remaining_prioritized_slots,
    list_remaining_triggered_slots,
    SLOT_ORDER,
    ScenarioNote,
)

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/intake")

_FREE_TEXT_DUMP_FLAG = "_free_text_dump_offered"


# ---------------------------------------------------------------------------
# v6 — resolve_answer: map letter / label / code to a chip_code without LLM
# ---------------------------------------------------------------------------

import re as _re

_STATE_CODE_TO_NAME: dict[str, str] = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "Washington D.C.",
}


def _display_candidate(slot_id: str, code: str) -> str:
    """Human-readable label for a candidate code, e.g. 'FL' → 'Florida (FL)'."""
    if slot_id == "property_state" and code.upper() in _STATE_CODE_TO_NAME:
        name = _STATE_CODE_TO_NAME[code.upper()]
        return f"{name} ({code.upper()})"
    return code


def resolve_answer(user_input: str, target_slots: list[str]) -> dict | None:
    """Try to resolve user input as a letter (A/B/C) or label match (v6 §6).

    Returns {slot_id, chip_code, chip_label} if resolved, else None.
    Falls through to the Extractor when unresolved.
    """
    if not target_slots:
        return None
    slot_id = target_slots[0]
    slot_def = _SLOT_BY_ID.get(slot_id)
    if not slot_def:
        return None
    options: list[dict] = slot_def.get("options") or []
    if not options:
        return None

    # Normalise: strip "option " prefix so "Option D" → "D"
    text = _re.sub(r"^option\s+", "", user_input.strip().lower())

    # 1. Single letter (e.g. "A", "b", "C")
    if len(text) == 1 and text.isalpha():
        idx = ord(text) - ord("a")
        if 0 <= idx < len(options):
            opt = options[idx]
            return {"slot_id": slot_id, "chip_code": opt["code"], "chip_label": opt["label"]}

    # 2. Letter + label / period / paren (e.g. "A primary", "A. Primary", "A) Yes")
    m = _re.match(r"^([a-z])[\s.)]+(.*)$", text)
    if m:
        idx = ord(m.group(1)) - ord("a")
        if 0 <= idx < len(options):
            opt = options[idx]
            return {"slot_id": slot_id, "chip_code": opt["code"], "chip_label": opt["label"]}

    # 3. Exact code or label match
    for opt in options:
        if text == opt["code"].lower() or text == opt["label"].lower():
            return {"slot_id": slot_id, "chip_code": opt["code"], "chip_label": opt["label"]}

    # 4. Starts-with code or label (e.g. "primary" matches "primary_residence")
    for opt in options:
        code_low = opt["code"].lower().replace("_", " ")
        label_low = opt["label"].lower()
        if code_low.startswith(text) or label_low.startswith(text):
            return {"slot_id": slot_id, "chip_code": opt["code"], "chip_label": opt["label"]}

    # 5. "Other" aliases — map to whichever chip has code/label containing "other"
    _OTHER_ALIASES = {
        "outside", "other area", "none of these", "none of the above",
        "different", "not listed", "not on the list", "elsewhere",
        "something else", "neither", "n/a", "na", "not applicable",
        "different county", "different city", "different location",
    }
    if text in _OTHER_ALIASES or text.startswith("outside"):
        for opt in options:
            if "other" in opt["code"].lower() or "other" in opt["label"].lower():
                return {"slot_id": slot_id, "chip_code": opt["code"], "chip_label": opt["label"]}

    return None

_FREE_TEXT_SKIP_NORMALIZED = frozenset(
    {
        "skip",
        "nothing to add",
        "nothing",
        "no",
        "none",
        "n/a",
        "na",
        "next",
        "continue",
    }
)


def _normalize_intake_user_text(text: str) -> str:
    import re

    return re.sub(r"[^a-z0-9\s]", "", (text or "").lower()).strip()


def _is_free_text_skip_message(text: str) -> bool:
    norm = _normalize_intake_user_text(text)
    if not norm:
        return False
    if norm in _FREE_TEXT_SKIP_NORMALIZED:
        return True
    return norm.startswith("skip") and len(norm.split()) <= 2


def _free_text_dump_offered(session: object) -> bool:
    return bool((session.portfolio or {}).get(_FREE_TEXT_DUMP_FLAG))


def _set_free_text_dump_offered(session: object) -> None:
    session.portfolio[_FREE_TEXT_DUMP_FLAG] = True


def _maybe_offer_free_text_before_fourth_ask(session: object, action: Action) -> Action:
    """Insert a free-text-only turn before the 4th structured question (once per session)."""
    if _free_text_dump_offered(session):
        return action
    if session.question_count != 3:
        return action
    if action.kind not in ("ASK_SLOT_DEFINITIVE", "ASK_SLOT_COMBINED", "ASK_CLARIFY"):
        return action
    _set_free_text_dump_offered(session)
    remaining = list_remaining_prioritized_slots(session.portfolio, max_n=4)
    hints = [s["label"] for s in remaining]
    still_missing = ", ".join(hints) if hints else ""
    return Action(
        "OFFER_FREE_TEXT",
        {
            "text": (
                "Please add some more context as free text — I'll extract everything."
            ),
            "still_missing": still_missing,
            "hint": (
                'Say "Skip" or "Nothing to Add" if you prefer option-based questions. '
                "Otherwise type extra details in your own words."
            ),
        },
    )


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class IntakeStartRequest(BaseModel):
    initial_text: str = ""
    preseed_portfolio: dict = {}
    mode: str = "lo"  # "lo" (loan officer — essentials only) | "uw" (underwriter — + optionals)


class IntakeMessageRequest(BaseModel):
    session_id: str
    user_text: str


class IntakePreviewRequest(BaseModel):
    session_id: str


class IntakeSubmitRequest(BaseModel):
    session_id: str
    include_partial: bool = False


class IntakeBulkFillRequest(BaseModel):
    session_id: str
    values: dict  # {slot_id: value}


class IntakeEditSlotRequest(BaseModel):
    session_id: str
    slot_id: str
    value: object


class IntakeNextQuestionRequest(BaseModel):
    session_id: str


class IntakeConfirmInferredRequest(BaseModel):
    session_id: str
    slot_id: str


class IntakeChipAnswerRequest(BaseModel):
    session_id: str
    slot_id: str
    chip_code: str
    chip_label: str


class IntakeExtractRequest(BaseModel):
    """Stateless extract-only request — the conversational dispatcher lives on the client."""
    text: str = ""
    portfolio: dict = {}              # snake_case slot portfolio (working memory held by the client)
    last_target_slots: list[str] = []  # weights the Extractor's "turn" mode
    mode: str = "lo"                 # "lo" | "underwriter" (or "uw")


class IntakeAssistRequest(BaseModel):
    """Turn-intent assist — the user's message wasn't scenario data; classify + reply.

    The /chat client calls this ONLY when a turn extracted nothing, to tell apart an
    on-topic capability question (answer it), an off-topic message (deflect), and
    abuse / junk (decline) — so the bot stops treating questions as failed answers.
    """
    text: str = ""
    pending_question: str = ""  # the scenario question the chat is currently waiting on
    mode: str = "lo"           # "lo" | "underwriter" (or "uw")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _bucket_from_years(years: float) -> str:
    """Elapsed years → credit-event seasoning bucket (matches CREDIT_EVENT_YEAR_BUCKETS)."""
    if years < 1:
        return "<1 year"
    if years < 2:
        return "1-2 years"
    if years < 3:
        return "2-3 years"
    if years < 4:
        return "3-4 years"
    if years < 7:
        return "4-7 years"
    return "7+ years"


def _humanize_option_code(slot_id: str, code: str) -> str:
    """Raw slot option code → human label ("first_lien_only" → "First Lien Only").

    Used for clarification candidates so the UI never shows snake_case codes. Falls back
    to a Title-Cased prettify when the code isn't a known option.
    """
    from backend.metrics import SLOT_DEFS  # noqa: PLC0415

    for s in SLOT_DEFS:
        if s.get("id") == slot_id:
            for o in s.get("options") or []:
                if o.get("code") == code:
                    return o.get("label") or code
            break
    return code.replace("_", " ").title() if code else code


def _serialize(
    session: object,
    action: Action,
    scenario_notes_delta: list | None = None,
    newly_captured_ids: list | None = None,
    updated_ids: list | None = None,
) -> dict:
    """Build the response payload from a session + action."""
    kind = action.kind
    payload = action.payload or {}
    bot_text = payload.get("text") or milestone_bot_text(action, session.portfolio)

    chips = payload.get("chips") or None
    input_type = payload.get("input_type") or "chips"
    hint = payload.get("hint")

    # Milestone-specific chips
    if kind == "OFFER_PREVIEW":
        still_missing = payload.get("still_missing") or []
        preview_can_submit = payload.get("can_submit", False)
        chips = [{"code": "_continue_intake", "label": "Add more detail →"}]
        if preview_can_submit:
            chips.append({"code": "_submit", "label": "Run full eligibility"})
        input_type = "chips"
    elif kind == "OFFER_SUBMIT":
        chips = [{"code": "_submit", "label": "Run Eligibility"}]
        input_type = "chips"

    # LTV/CLTV-based chips only for single-slot questions targeting loan_amount or ltv.
    # loan_amount always keeps input_type="text" (free-text entry; chips are quick-pick suggestions).
    if kind == "ASK_SLOT_DEFINITIVE":
        slot_ids = payload.get("slot_ids") or []
        if len(slot_ids) == 1 and slot_ids[0] in ("loan_amount", "ltv", "cltv"):
            try:
                pv = float(str(session.portfolio.get("property_value") or 0).replace(",", "").replace("$", ""))
                if pv > 0:
                    buckets = [60, 65, 70, 75, 80]
                    sid = slot_ids[0]
                    pct_label = "CLTV" if sid == "cltv" else "LTV"
                    chips = [
                        {
                            "code": f"ltv_{b}",
                            "label": f"${pv * b / 100:,.0f} ({b}% {pct_label})",
                        }
                        for b in buckets
                    ]
                    if sid == "loan_amount":
                        # Free-text input; LTV chips are optional quick-picks alongside the composer
                        hint = "Enter a loan amount, down payment %, or LTV — or pick below"
                        input_type = "text"
                    else:
                        hint = f'or type: "${pv * 0.75:,.0f}"'
                        input_type = "chips"
            except (ValueError, TypeError):
                pass

    # Fallback: if the Asker didn't emit chips for an enum slot, pull them from SLOT_DEFS
    if kind in ("ASK_SLOT_DEFINITIVE", "ASK_SLOT_COMBINED", "ASK_CLARIFY") and not chips:
        for sid in (payload.get("slot_ids") or []):
            slot_def = _SLOT_BY_ID.get(sid)
            if slot_def and slot_def.get("kind") == "enum" and slot_def.get("options"):
                chips = [{"code": o["code"], "label": o["label"]} for o in slot_def["options"]]
                input_type = "chips"
                break

    # Build confirmed_fields summary for display in the chat UI
    confirmed_fields: list[dict] = []
    # Geo code → display label lookup (keyed by state for county/city)
    _state = session.portfolio.get("property_state", "")
    _geo_label_maps: dict[str, dict[str, str]] = {
        "state_county": {
            c["code"]: c["label"]
            for c in get_chips_for_slot("state_county", _state)
        },
        "state_city": {
            c["code"]: c["label"]
            for c in get_chips_for_slot("state_city", _state)
        },
        "state_borough": {
            c["code"]: c["label"]
            for c in get_chips_for_slot("state_borough", _state)
        },
    }
    for sid in (newly_captured_ids or []):
        slot_def = _SLOT_BY_ID.get(sid)
        val = session.portfolio.get(sid)
        if val is None or slot_def is None:
            continue
        if sid == "ltv":
            label, _ = leverage_slot_labels(session.portfolio)
        else:
            label = slot_sidebar_label(session.portfolio, sid)
        skind = slot_def.get("kind", "")
        try:
            if skind == "currency":
                confirmed_fields.append({"label": label, "value": f"${float(str(val)):,.0f}"})
            elif skind == "enum":
                opts = {o["code"]: o["label"] for o in (slot_def.get("options") or [])}
                confirmed_fields.append({"label": label, "value": opts.get(str(val), str(val))})
            elif sid in _geo_label_maps and str(val) in _geo_label_maps[sid]:
                # Resolve geo chip code to its display label (e.g. "other" → "Other")
                confirmed_fields.append({"label": label, "value": _geo_label_maps[sid][str(val)]})
            else:
                confirmed_fields.append({"label": label, "value": str(val)})
        except (ValueError, TypeError):
            confirmed_fields.append({"label": label, "value": str(val)})

    portfolio_delta = {
        k: v for k, v in session.portfolio.items()
        if not k.endswith(("_status", "_source", "_confidence"))
        and not k.startswith("_")  # internal flags (_intake_mode, _free_text_dump_offered)
    }

    resp: dict = {
        "session_id": session.session_id,
        "bot_text": bot_text or "",
        "input_type": input_type,
        "chips": chips,
        "hint": hint,
        "action": kind,
        "target_slots": payload.get("slot_ids") or [],
        "portfolio_delta": portfolio_delta,
        "scenario_notes_delta": [n.to_dict() for n in (scenario_notes_delta or [])],
        "question_count": session.question_count,
        "can_submit": ready_for_final_eligibility(session.portfolio),
        "confirmed_fields": confirmed_fields,
    }

    if kind == "ASK_SLOT_COMBINED":
        resp["subfields"] = _build_subfields(
            session.portfolio, payload.get("slot_ids") or [], payload
        )
    if kind == "OFFER_CHECKLIST":
        resp["checklist"] = {
            "slots": payload.get("slots") or [],
            "can_submit": payload.get("can_submit", False),
        }
    if kind == "OFFER_PREVIEW":
        resp["still_missing"] = payload.get("still_missing") or []

    if kind == "OFFER_OPTIONAL_BATCH":
        # v6 §4b — end-of-intake optional batch card
        resp["optional_batch"] = {
            "slots": payload.get("slots") or [],
        }
        resp["input_type"] = "optional_batch"
        resp["chips"] = [
            {"code": "_skip_optionals", "label": "Skip all"},
            {"code": "_submit", "label": "Continue →"},
        ]

    if kind == "OFFER_FREE_TEXT":
        resp["input_type"] = "text"
        resp["chips"] = []
        resp["target_slots"] = []
        if payload.get("hint"):
            resp["hint"] = payload.get("hint")
        if payload.get("still_missing"):
            resp["still_missing"] = payload.get("still_missing")

    return resp


def _build_subfields(portfolio: dict, slot_ids: list[str], payload: dict) -> list[dict]:
    from backend.chat.portfolio import _SLOT_BY_ID  # noqa: PLC0415
    subfields = []
    for sid in slot_ids:
        slot_def = _SLOT_BY_ID.get(sid) or {}
        # Each enum slot gets its OWN options as chips (not the merged Asker chips)
        slot_chips = None
        if slot_def.get("kind") in ("enum", "boolean") and slot_def.get("options"):
            slot_chips = [
                {"code": o["code"], "label": o["label"]}
                for o in slot_def["options"]
            ]
        subfields.append({
            "slot_id": sid,
            "kind": slot_def.get("kind", "number"),
            "label": slot_sidebar_label(portfolio, sid),
            "prompt": slot_prompt(portfolio, sid),
            "chips": slot_chips,
            "hint": slot_def.get("hint"),
        })
    return subfields


async def _run_eligibility_inprocess(portfolio: dict, scenario_notes: list, quick: bool = False) -> dict:
    """Call the shared eligibility service (same path as /api/eligibility/*)."""
    req = portfolio_to_eligibility_request(portfolio, scenario_notes)
    return run_eligibility_engine(req, quick=quick)


def _append_turn(session: object, role: str, text: str, payload: dict | None = None) -> None:
    session.turns.append(IntakeTurn(role=role, text=text, payload=payload or {}))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/start")
async def intake_start(req: IntakeStartRequest) -> dict:
    """Create a new intake session, optionally with an initial bulk-text dump."""
    session = create_session()
    session.portfolio = set_intake_mode(session.portfolio, req.mode)
    extractor_result = None

    if req.preseed_portfolio:
        for slot_id, value in req.preseed_portfolio.items():
            session.portfolio = set_slot(session.portfolio, slot_id, value, source="form_draft")

    filled_before: set[str] = set()
    if req.initial_text.strip():
        # Fast-path: greetings need no LLM — detect before calling the Extractor.
        if is_greeting(req.initial_text) and not req.preseed_portfolio:
            text = (
                "Hi there! I'm your mortgage advisor for this session. "
                "Tell me about the loan scenario — borrower type, property value, "
                "loan amount, state, and doc type — and I'll get started."
            )
            action = Action("GREETING", {"text": text})
            apply_action_bookkeeping(session, action)
            _append_turn(session, "user", req.initial_text)
            _append_turn(session, "bot", text, action.payload)
            save_session(session)
            return _serialize(session, action, scenario_notes_delta=[], newly_captured_ids=[])

        filled_before = {
            k for k in session.portfolio
            if not k.endswith(("_status", "_source", "_confidence"))
            and session.portfolio.get(f"{k}_status") in ("filled", "inferred")
        }
        extractor_result = await extractor_llm(session, req.initial_text, mode="bulk")
        session.portfolio = merge_extracted(
            session.portfolio, extractor_result.extracted, source="llm_bulk"
        )
        # Normalize geo sub-fields to predefined chip codes (e.g. "Palm beach county" → "other")
        for _geo_slot in ("state_county", "state_city", "state_borough"):
            _raw_val = session.portfolio.get(_geo_slot)
            if _raw_val:
                _normed = normalize_geo_slot_value(_geo_slot, str(_raw_val), session.portfolio)
                if _normed != _raw_val:
                    session.portfolio = set_slot(session.portfolio, _geo_slot, _normed, source="geo_normalize")
        session.scenario_notes.extend(extractor_result.scenario_notes)
        _append_turn(session, "user", req.initial_text)

    newly_captured = [
        k for k in session.portfolio
        if not k.endswith(("_status", "_source", "_confidence"))
        and session.portfolio.get(f"{k}_status") in ("filled", "inferred")
        and k not in filled_before
    ]

    # If the user sent text but we couldn't extract anything useful, ask them to try again
    if (
        req.initial_text.strip()
        and not newly_captured
        and not (extractor_result and extractor_result.scenario_notes)
    ):
        if is_greeting(req.initial_text):
            text = (
                "Hi there! I'm your mortgage advisor for this session. "
                "Tell me about the loan scenario — borrower type, property value, "
                "loan amount, state, and doc type — and I'll get started."
            )
        else:
            text = (
                "I didn't pick up any loan details from that. "
                'Try describing the scenario — e.g. "buying a primary residence '
                'in Texas, $500K property, 75% LTV, full doc, 720 FICO" '
                "— and I'll extract what I can."
            )
        action = Action("GREETING", {"text": text})
        apply_action_bookkeeping(session, action)
        _append_turn(session, "bot", text, action.payload)
        save_session(session)
        return _serialize(session, action, scenario_notes_delta=[], newly_captured_ids=[])

    # Stage A — gate (may skip Call 2)
    action = planner_gate(session)
    if action is None:
        if not req.initial_text.strip() and not req.preseed_portfolio:
            # Cold-start greeting — no question counted
            action = Action("GREETING", {"text": greeting_bot_text()})
        else:
            asker_result = await asker_llm(session, extractor_result)
            action = planner_override(session, asker_result)

    action = _maybe_offer_free_text_before_fourth_ask(session, action)
    apply_action_bookkeeping(session, action)
    _append_turn(session, "bot", action.payload.get("text") or milestone_bot_text(action, session.portfolio), action.payload)
    save_session(session)

    return _serialize(
        session, action,
        scenario_notes_delta=extractor_result.scenario_notes if extractor_result else [],
        newly_captured_ids=newly_captured,
    )


_PORTFOLIO_META_SUFFIXES = ("_status", "_source", "_confidence")


def _is_filled(portfolio: dict, slot_id: str) -> bool:
    return portfolio.get(f"{slot_id}_status") in ("filled", "inferred")


_PERCENT_SLOTS = ("ltv", "cltv", "estimated_dti", "gift_funds_pct")

# Display overrides so captured pills show EXACTLY what the Mortgage Profile sidebar
# shows (frontend loanWizardProfileSections) — not the longer SLOT_DEFS chip labels.
_SIDEBAR_VALUE_LABELS: dict[str, dict[str, str]] = {
    "lien_position": {
        "first_lien_only": "First Lien",
        "second_lien": "Second Lien (Standalone)",
        "second_lien_piggyback": "Second Lien (Piggyback)",
    },
    "second_lien_product": {"heloc": "HELOC", "heloan": "HELOAN"},
}


def _humanize_slot(slot_id: str, value, portfolio: dict) -> dict | None:
    """Snake_case slot value → {label, value} for the brain-dump summary card."""
    slot = _SLOT_BY_ID.get(slot_id)
    if slot is None or value in (None, ""):
        return None
    label = slot_sidebar_label(portfolio, slot_id)
    kind = slot.get("kind")
    disp: object = value
    sidebar_override = _SIDEBAR_VALUE_LABELS.get(slot_id, {}).get(str(value).lower())
    if sidebar_override:
        disp = sidebar_override
    elif slot_id == "property_state":
        disp = _STATE_CODE_TO_NAME.get(str(value).upper(), str(value))
    elif kind == "enum" and slot.get("options"):
        for opt in slot["options"]:
            if str(opt.get("code", "")).lower() == str(value).lower():
                disp = opt.get("label", value)
                break
    elif kind == "currency":
        try:
            disp = f"${int(round(float(str(value).replace(',', '').replace('$', '')))):,}"
        except (ValueError, TypeError):
            disp = str(value)
    elif slot_id in _PERCENT_SLOTS:
        disp = f"{value}%"
    else:
        disp = str(value)
    return {"label": str(label), "value": str(disp)}


@router.post("/extract")
async def intake_extract(req: IntakeExtractRequest) -> dict:
    """Stateless extract-only: free text + portfolio → validated delta, ambiguities, notes.

    The conversational /chat dispatcher (frontend lib/chatConversation.ts) owns the turn
    loop now, so this endpoint has no session row, no planner, and no persistence. It just
    reuses the same Extractor the /api/intake planner uses: extractor_llm →
    validate_extracted_values → merge_extracted. The client holds the snake_case portfolio
    as working memory and passes it back each turn.

    Response:
      extracted          — snake_case value delta (feed to portfolioToFormPatch on the client)
      portfolio          — full merged portfolio (incl. _status/_confidence) to store for next call
      ambiguous          — [{slot, candidates}] near-misses for the reinforcement loop
      notes              — short note strings (paraphrase preferred) for quick display
      scenario_notes_delta — standard scenario-note items (same shape as intake responses)
    """
    empty = {"extracted": {}, "portfolio": dict(req.portfolio or {}),
             "ambiguous": [], "notes": [], "scenario_notes_delta": []}
    if not req.text.strip():
        return empty

    # Ephemeral, unsaved session to carry portfolio + last-target weighting into the Extractor.
    session = create_session()
    session.portfolio = set_intake_mode(dict(req.portfolio or {}), req.mode)
    session.last_target_slots = list(req.last_target_slots or [])

    # Bulk mode when nothing's been captured yet (the opening brain-dump); else turn mode.
    has_any = any(
        _is_filled(session.portfolio, k)
        for k in session.portfolio
        if not k.endswith(_PORTFOLIO_META_SUFFIXES)
    )
    extractor_result = await extractor_llm(
        session, req.text, mode="turn" if has_any else "bulk"
    )

    valid, ambiguities, _discarded = validate_extracted_values(
        extractor_result.extracted, session.portfolio
    )

    # Deterministic credit-event seasoning from a stated YEAR — the LLM is unreliable at
    # date arithmetic ("foreclosure in 2022" came back "<1 year"). If a 4-digit year is in
    # the text and a seasoning was extracted, recompute the bucket exactly from today.
    if "years_since_event" in valid:
        _ym = _re.search(r"\b(?:19|20)\d{2}\b", req.text)
        if _ym:
            from datetime import datetime as _dt  # noqa: PLC0415

            _elapsed = _dt.now().year - int(_ym.group(0))
            if 0 <= _elapsed <= 100:
                valid["years_since_event"] = {
                    "value": _bucket_from_years(_elapsed),
                    "confidence": 0.95,
                    "source_phrase": _ym.group(0),
                }

    # Deterministic county fallback. state_county is a free-text geo slot the LLM (gpt-4o-mini,
    # temp 0.1) captures inconsistently from a dense dump. If the text explicitly says
    # "<Name> County" and a state is known, fill it so it isn't re-asked.
    if "state_county" not in valid:
        _state_code = str(
            (valid.get("property_state") or {}).get("value")
            or session.portfolio.get("property_state")
            or ""
        ).strip().upper()
        if _state_code:
            _county = _re.search(
                r"\b([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)?)\s+County\b", req.text
            )
            if _county:
                valid["state_county"] = {
                    "value": _county.group(1).strip(),
                    "confidence": 0.9,
                    "source_phrase": _county.group(0).strip(),
                }

    # If a cash-out amount is present but loan purpose wasn't captured, infer cash-out
    # refinance — a cash-out target only exists on a cash-out refi. (The Extractor misses
    # loan_purpose inconsistently from dense dumps even when the cash-out is stated.)
    if "loan_purpose" not in valid and not _is_filled(session.portfolio, "loan_purpose"):
        _has_cashout = bool(
            (valid.get("cash_in_hand") or {}).get("value")
            or _is_filled(session.portfolio, "cash_in_hand")
        )
        if _has_cashout:
            valid["loan_purpose"] = {
                "value": "cash_out",
                "confidence": 0.9,
                "source_phrase": "cash out",
            }

    # Deterministic property-value / loan-amount fallback. These core triangle figures are
    # still dropped by the LLM from a dense dump, which re-asks the value/loan/LTV question.
    def _money(raw: str) -> str | None:
        m = _re.match(r"\$?\s*([\d,]+(?:\.\d+)?)\s*([kKmM])?", raw.strip())
        if not m:
            return None
        num = float(m.group(1).replace(",", ""))
        mult = {"k": 1_000, "m": 1_000_000}.get((m.group(2) or "").lower(), 1)
        return str(int(round(num * mult)))

    if "property_value" not in valid and not _is_filled(session.portfolio, "property_value"):
        _pv = _re.search(
            r"(?:property\s+value|value\s+(?:of|is|at))\s*\$?\s*([\d,]{3,}(?:\.\d+)?\s*[kKmM]?)",
            req.text, _re.IGNORECASE,
        )
        if _pv and (_v := _money(_pv.group(1))):
            valid["property_value"] = {"value": _v, "confidence": 0.9, "source_phrase": _pv.group(0).strip()}

    if "loan_amount" not in valid and not _is_filled(session.portfolio, "loan_amount"):
        _la = _re.search(
            r"loan\s+amount\s*(?:is|of)?\s*\$?\s*([\d,]{3,}(?:\.\d+)?\s*[kKmM]?)",
            req.text, _re.IGNORECASE,
        )
        if _la and (_v := _money(_la.group(1))):
            valid["loan_amount"] = {"value": _v, "confidence": 0.9, "source_phrase": _la.group(0).strip()}

    merged = merge_extracted(session.portfolio, valid, source="llm_extract")

    # Delta = value keys that actually changed vs. the incoming portfolio.
    # Exclude status/meta companions and leading-underscore meta keys (e.g. _intake_mode).
    incoming = req.portfolio or {}
    delta = {
        k: v
        for k, v in merged.items()
        if not k.startswith("_")
        and not k.endswith(_PORTFOLIO_META_SUFFIXES)
        and v not in (None, "")
        and v != incoming.get(k)
    }

    # Human-readable rows for the brain-dump summary card ("I picked these up…"),
    # ordered to match the form/SLOT_ORDER (citizenship → occupancy → … ), with any
    # extras not in SLOT_ORDER appended at the end.
    _order = {sid: i for i, sid in enumerate(SLOT_ORDER)}
    captured = [
        row
        for k in sorted(delta, key=lambda s: _order.get(s, len(_order)))
        if (row := _humanize_slot(k, delta[k], merged))
    ]
    # Low-confidence extractions → confirmation prompts ("Inferred … — confirm if wrong").
    inferred = []
    for sid, info in valid.items():
        if float(info.get("confidence") or 0.0) >= 0.85:
            continue
        row = _humanize_slot(sid, merged.get(sid, info.get("value")), merged)
        if row:
            inferred.append({"slot": sid, **row, "phrase": (info.get("source_phrase") or "").strip()})

    notes = [n.to_dict() for n in extractor_result.scenario_notes]
    return {
        "extracted": delta,
        "portfolio": merged,
        "captured": captured,
        "inferred": inferred,
        "ambiguous": [
            {
                "slot": a.get("slot_id", ""),
                "label": slot_sidebar_label(merged, a.get("slot_id", "")),
                # Humanize raw option codes → labels ("first_lien_only" → "First Lien Only").
                "candidates": [
                    _humanize_option_code(a.get("slot_id", ""), c)
                    for c in a.get("candidates", [])
                ],
            }
            for a in ambiguities
        ],
        "notes": [(n.get("paraphrase") or n.get("text") or "").strip() for n in notes],
        "scenario_notes_delta": notes,
    }


@router.post("/message")
async def intake_message(req: IntakeMessageRequest) -> dict:
    """Process a user turn: extract → merge → gate → (asker) → override → persist."""
    try:
        session = load_session(req.session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")

    _append_turn(session, "user", req.user_text)

    filled_before = {
        k for k in session.portfolio
        if not k.endswith(("_status", "_source", "_confidence"))
        and session.portfolio.get(f"{k}_status") in ("filled", "inferred")
    }

    if session.last_action == "OFFER_FREE_TEXT" and _is_free_text_skip_message(req.user_text):
        action = planner_gate(session)
        if action is None:
            asker_result = await asker_llm(session, None)
            action = planner_override(session, asker_result)
        action = _maybe_offer_free_text_before_fourth_ask(session, action)
        apply_action_bookkeeping(session, action)
        _append_turn(
            session,
            "bot",
            action.payload.get("text") or milestone_bot_text(action, session.portfolio),
            action.payload,
        )
        save_session(session)
        return _serialize(session, action, scenario_notes_delta=[], newly_captured_ids=[])

    # Fast-path: if no scenario has been captured yet and the message is a greeting or
    # pure junk, skip the Extractor LLM entirely.
    if session.question_count == 0 and is_greeting(req.user_text):
        text = (
            "Hi! Go ahead and describe the loan scenario — property value, "
            "state, doc type, FICO — and I'll start filling things in."
        )
        action = Action("GREETING", {"text": text})
        apply_action_bookkeeping(session, action)
        _append_turn(session, "bot", text, action.payload)
        save_session(session)
        return _serialize(session, action, scenario_notes_delta=[], newly_captured_ids=[])

    # v6: try letter/label resolution before calling the Extractor LLM
    resolved = resolve_answer(req.user_text, session.last_target_slots)
    if resolved:
        session.portfolio = set_slot(
            session.portfolio, resolved["slot_id"], resolved["chip_code"], source="user_letter"
        )
        session.portfolio = triangulate_loan_fields(session.portfolio)
        newly_captured = [
            k for k in session.portfolio
            if not k.endswith(("_status", "_source", "_confidence"))
            and session.portfolio.get(f"{k}_status") in ("filled", "inferred")
            and k not in filled_before
        ]
        increment_user_answer_count(session)
        action = planner_gate(session)
        if action is None:
            asker_result = await asker_llm(session, None)
            action = planner_override(session, asker_result)
        action = _maybe_offer_free_text_before_fourth_ask(session, action)
        apply_action_bookkeeping(session, action)
        _append_turn(session, "bot", action.payload.get("text") or milestone_bot_text(action, session.portfolio), action.payload)
        save_session(session)
        return _serialize(session, action, scenario_notes_delta=[], newly_captured_ids=newly_captured)

    # Pre-extractor: city→state inference (deterministic, no LLM needed).
    # If property_state is not yet filled and the user's text looks like a single city name,
    # infer and merge the state immediately before the LLM runs.
    _user_text_stripped = req.user_text.strip()
    if not session.portfolio.get("property_state") and _user_text_stripped:
        _inferred_state = city_to_state_code(_user_text_stripped)
        if _inferred_state:
            # set_slot takes a plain value (the inferred 2-letter code); merge_extracted
            # expects {value, confidence} dicts and would crash on a bare string.
            session.portfolio = set_slot(
                session.portfolio, "property_state", _inferred_state, source="city_inference"
            )
            newly_captured.append("property_state")

    # Call 1 — Extractor
    extractor_result = await extractor_llm(session, req.user_text, mode="turn")

    # v6: validate enum values before merging — garbage discarded, near-misses queued as ambiguities
    _valid_extracted, _validation_ambiguities, _discarded = validate_extracted_values(
        extractor_result.extracted, session.portfolio
    )
    for _va in _validation_ambiguities:
        extractor_result.ambiguities.append(
            ExtractorAmbiguity(
                slot_id=_va["slot_id"],
                user_phrase=_va["user_phrase"],
                candidates=_va["candidates"],
            )
        )
    session.portfolio = merge_extracted(
        session.portfolio, _valid_extracted, source="llm_extract"
    )
    # Normalize geo sub-fields to predefined chip codes (e.g. "Miami-Dade" → "other")
    for _geo_slot in ("state_county", "state_city", "state_borough"):
        _raw_val = session.portfolio.get(_geo_slot)
        if _raw_val:
            _normed = normalize_geo_slot_value(_geo_slot, str(_raw_val), session.portfolio)
            if _normed != _raw_val:
                session.portfolio = set_slot(session.portfolio, _geo_slot, _normed, source="geo_normalize")
    # Apply explicit removals (user said "remove X" / "clear X")
    for slot_id in (extractor_result.removed or []):
        session.portfolio = clear_slot(session.portfolio, slot_id)
    session.scenario_notes.extend(extractor_result.scenario_notes)

    newly_captured = [
        k for k in session.portfolio
        if not k.endswith(("_status", "_source", "_confidence"))
        and session.portfolio.get(f"{k}_status") in ("filled", "inferred")
        and k not in filled_before
    ]

    # v6: increment user_answer_count if we captured something substantive
    if newly_captured or extractor_result.scenario_notes:
        increment_user_answer_count(session)

    # If no context has been gathered yet and this message is still useless, nudge the user
    if (
        session.question_count == 0
        and not newly_captured
        and not extractor_result.scenario_notes
    ):
        text = (
            "I didn't pick up any loan details from that. "
            "Try describing the scenario — e.g. borrower type, property value, "
            "loan amount, state, and doc type — and I'll extract what I can."
        )
        action = Action("GREETING", {"text": text})
        apply_action_bookkeeping(session, action)
        _append_turn(session, "bot", text, action.payload)
        save_session(session)
        return _serialize(session, action, scenario_notes_delta=[], newly_captured_ids=[])

    # v6: if Extractor returned ambiguities, handle them.
    if extractor_result.ambiguities:
        ambig_list = extractor_result.ambiguities

        # Separate into:
        #   exact_match  — user_phrase is identical to the sole candidate (safe to auto-merge)
        #   single_fuzzy — 1 candidate but user said something different (need confirmation)
        #   multi        — 2+ candidates (need selection)
        def _is_exact(a) -> bool:
            return (
                len(a.candidates) == 1
                and a.candidates[0].strip().lower() == a.user_phrase.strip().lower()
            )

        exact   = [a for a in ambig_list if _is_exact(a)]
        fuzzy1  = [a for a in ambig_list if len(a.candidates) == 1 and not _is_exact(a)]
        multi   = [a for a in ambig_list if len(a.candidates) > 1]
        zero    = [a for a in ambig_list if len(a.candidates) == 0]

        # 1. Auto-merge exact matches silently
        for a in exact:
            merge_extracted(session.portfolio, {a.slot_id: a.candidates[0]})
            newly_captured.append(a.slot_id)

        # 2. Single fuzzy match: "Did you mean X?" — Yes / Enter different
        needs_clarify = fuzzy1 + multi
        if needs_clarify:
            if len(needs_clarify) == 1:
                a = needs_clarify[0]
                if len(a.candidates) == 1:
                    # Fuzzy single — friendly confirmation
                    cand = a.candidates[0]
                    display = _display_candidate(a.slot_id, cand)
                    clarify_text = f'Did you mean **{display}**?'
                    clarify_chips = [
                        {"code": cand, "label": f"Yes, {display}"},
                        {"code": "_clarify_other", "label": "Enter different"},
                    ]
                else:
                    # Multi-candidate selection
                    cands_str = " or ".join(a.candidates[:3])
                    clarify_text = f'You said "{a.user_phrase}" — did you mean {cands_str}?'
                    clarify_chips = [{"code": c, "label": c} for c in a.candidates[:4]]
                    clarify_chips.append({"code": "_clarify_other", "label": "Something else"})
            else:
                parts = [f'"{a.user_phrase}"' for a in needs_clarify[:3]]
                clarify_text = (
                    f"Quick check on {len(parts)} things: "
                    + ", ".join(parts)
                    + " — can you confirm or correct?"
                )
                clarify_chips = []

            # Include zero-candidate items as free-text fall-through
            if zero and not clarify_chips:
                pass  # batched into the generic text prompt above

            ambig_action = Action("ASK_CLARIFY", {
                "text": clarify_text,
                "chips": clarify_chips or None,
                "slot_ids": [a.slot_id for a in needs_clarify[:3]],
                "ambiguities": [
                    {"slot_id": a.slot_id, "user_phrase": a.user_phrase, "candidates": a.candidates}
                    for a in needs_clarify
                ],
                "input_type": "chips" if clarify_chips else "text",
            })
            apply_action_bookkeeping(session, ambig_action)
            _append_turn(session, "bot", clarify_text, ambig_action.payload)
            save_session(session)
            return _serialize(session, ambig_action, scenario_notes_delta=extractor_result.scenario_notes, newly_captured_ids=newly_captured)

    # Stage A — gate
    action = planner_gate(session)
    if action is None:
        # Call 2 — Asker (only when deterministic gate didn't fire)
        asker_result = await asker_llm(session, extractor_result)
        action = planner_override(session, asker_result)

    action = _maybe_offer_free_text_before_fourth_ask(session, action)
    apply_action_bookkeeping(session, action)
    _append_turn(session, "bot", action.payload.get("text") or milestone_bot_text(action, session.portfolio), action.payload)
    save_session(session)

    return _serialize(
        session, action,
        scenario_notes_delta=extractor_result.scenario_notes,
        newly_captured_ids=newly_captured,
    )


@router.post("/refine")
async def intake_refine(req: IntakeMessageRequest) -> dict:
    """Post-eligibility free text: extract slots + session notes, then offer re-run."""
    try:
        session = load_session(req.session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")

    _append_turn(session, "user", req.user_text)

    filled_before = {
        k for k in session.portfolio
        if not k.endswith(("_status", "_source", "_confidence"))
        and session.portfolio.get(f"{k}_status") in ("filled", "inferred")
    }

    extractor_result = await extractor_llm(session, req.user_text, mode="turn")
    session.portfolio = merge_extracted(
        session.portfolio, extractor_result.extracted, source="llm_extract"
    )
    for slot_id in (extractor_result.removed or []):
        session.portfolio = clear_slot(session.portfolio, slot_id)
    session.scenario_notes.extend(extractor_result.scenario_notes)

    newly_captured = [
        k for k in session.portfolio
        if not k.endswith(("_status", "_source", "_confidence"))
        and session.portfolio.get(f"{k}_status") in ("filled", "inferred")
        and k not in filled_before
    ]

    parts: list[str] = []
    if newly_captured:
        parts.append("I updated your mortgage profile with a few new details.")
    if extractor_result.scenario_notes:
        parts.append("I added underwriting notes to your session.")
    if not parts:
        parts.append("Thanks — I saved that context.")
    bot_text = (
        " ".join(parts)
        + " Run eligibility again when you're ready."
    )

    action = Action("REFINE_COMPLETE", {"text": bot_text})
    _append_turn(session, "bot", bot_text, action.payload)
    save_session(session)

    resp = _serialize(
        session,
        action,
        scenario_notes_delta=extractor_result.scenario_notes,
        newly_captured_ids=newly_captured,
    )
    resp["chips"] = [{"code": "_rerun_eligibility", "label": "Run Eligibility"}]
    resp["input_type"] = "chips"
    return resp


@router.post("/preview")
async def intake_preview(req: IntakePreviewRequest) -> dict:
    """Run quick eligibility via shared service (prefer POST /api/eligibility/quick from clients)."""
    try:
        session = load_session(req.session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")

    req_dict = portfolio_to_eligibility_request(session.portfolio, session.scenario_notes)
    quick_body = QuickEligibilityRequest(**req_dict, include_programs=True)
    quick_resp = build_quick_response(quick_body)
    eligible = [p.model_dump() for p in (quick_resp.eligible or [])]
    n = quick_resp.count

    session.preview_shown = True
    save_session(session)

    can_submit = ready_for_final_eligibility(session.portfolio)
    return {
        "eligible": eligible,
        "session_id": session.session_id,
        "preview_shown": True,
        "geo_blocked_count": quick_resp.geo_blocked_count or 0,
        "overlay_blocked_count": quick_resp.overlay_blocked_count or 0,
        "total_screened": quick_resp.total_screened or 0,
        "bot_text": f"{n} program{'s' if n != 1 else ''} match{'es' if n == 1 else ''} so far.",
        "chips": [
            {"code": "_keep_going", "label": "Continue →"},
            *([{"code": "_submit", "label": "Run full eligibility"}] if can_submit else []),
        ],
        "can_submit": can_submit,
        "action": "PREVIEW_RESULT",
    }


@router.post("/preview-shown")
async def intake_preview_shown(req: IntakePreviewRequest) -> dict:
    """Mark mid-intake preview as shown (after client-side /api/eligibility/quick)."""
    try:
        session = load_session(req.session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")

    session.preview_shown = True
    save_session(session)
    return {
        "ok": True,
        "session_id": session.session_id,
        "can_submit": ready_for_final_eligibility(session.portfolio),
    }


@router.post("/submit")
async def intake_submit(req: IntakeSubmitRequest) -> dict:
    """Run full eligibility via shared service (prefer POST /api/eligibility/full from clients)."""
    try:
        session = load_session(req.session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")

    if not req.include_partial and not ready_for_final_eligibility(session.portfolio):
        missing = list_remaining_triggered_slots(session.portfolio)
        raise HTTPException(
            status_code=400,
            detail={"missing_slots": missing},
        )

    req_dict = portfolio_to_eligibility_request(session.portfolio, session.scenario_notes)
    full_resp = build_full_response(EligibilityRequest(**req_dict))
    return {
        "session_id": session.session_id,
        "eligible": [p.model_dump() for p in full_resp.eligible],
        "near_misses": [p.model_dump() for p in full_resp.near_misses],
        "geo_blocked_count": full_resp.geo_blocked_count,
        "overlay_blocked_count": full_resp.overlay_blocked_count,
        "geo_exclusions": [e.model_dump() for e in full_resp.geo_exclusions],
        "overlay_exclusions": [e.model_dump() for e in full_resp.overlay_exclusions],
        "rag_ineligible": full_resp.rag_ineligible,
        "total_screened": full_resp.total_screened,
        "scenario_notes": [n.to_dict() for n in session.scenario_notes],
    }


@router.post("/bulk_fill")
async def intake_bulk_fill(req: IntakeBulkFillRequest) -> dict:
    """Merge checklist values into portfolio and run planner."""
    try:
        session = load_session(req.session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")

    for slot_id, value in req.values.items():
        if value is not None and value != "":
            session.portfolio = set_slot(session.portfolio, slot_id, value, source="user_chip")

    session.portfolio = triangulate_loan_fields(session.portfolio)
    action = planner_gate(session) or Action("OFFER_SUBMIT", {})
    apply_action_bookkeeping(session, action)
    save_session(session)

    return _serialize(session, action)


@router.post("/edit_slot")
async def intake_edit_slot(req: IntakeEditSlotRequest) -> dict:
    """Sidebar click-to-edit: update a single slot value. No LLM."""
    try:
        session = load_session(req.session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")

    session.portfolio = set_slot(session.portfolio, req.slot_id, req.value, source="user_edit")
    session.portfolio = triangulate_loan_fields(session.portfolio)
    save_session(session)

    return {
        "session_id": session.session_id,
        "slot_id": req.slot_id,
        "value": req.value,
        "portfolio_delta": {
            k: v for k, v in session.portfolio.items()
            if not k.endswith(("_status", "_source", "_confidence"))
            and not k.startswith("_")
        },
        "can_submit": ready_for_final_eligibility(session.portfolio),
    }


@router.post("/next_question")
async def intake_next_question(req: IntakeNextQuestionRequest) -> dict:
    """Return the next question after a sidebar edit — no LLM extraction, no slot fill.

    Runs planner_gate → Asker → planner_override and returns the next action,
    identical to the tail of chip_answer but without touching any slot values.
    """
    try:
        session = load_session(req.session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")

    action = planner_gate(session)
    if action is None:
        asker_result = await asker_llm(session, None)
        action = planner_override(session, asker_result)

    action = _maybe_offer_free_text_before_fourth_ask(session, action)
    apply_action_bookkeeping(session, action)
    _append_turn(session, "bot", action.payload.get("text") or milestone_bot_text(action, session.portfolio), action.payload)
    save_session(session)

    return _serialize(session, action, scenario_notes_delta=[], newly_captured_ids=[])


@router.post("/chip_answer")
async def intake_chip_answer(req: IntakeChipAnswerRequest) -> dict:
    """Fast path for single-slot chip selections — skips Extractor LLM.

    Sets the chosen slot directly, then runs planner_gate → Asker → planner_override.
    Saves one LLM call vs the full /message flow.
    """
    try:
        session = load_session(req.session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")

    filled_before = {
        k for k in session.portfolio
        if not k.endswith(("_status", "_source", "_confidence"))
        and session.portfolio.get(f"{k}_status") in ("filled", "inferred")
    }

    # Direct slot fill — no Extractor LLM
    session.portfolio = set_slot(session.portfolio, req.slot_id, req.chip_code, source="user_chip")
    session.portfolio = triangulate_loan_fields(session.portfolio)
    _append_turn(session, "user", req.chip_label)
    increment_user_answer_count(session)

    newly_captured = [
        k for k in session.portfolio
        if not k.endswith(("_status", "_source", "_confidence"))
        and session.portfolio.get(f"{k}_status") in ("filled", "inferred")
        and k not in filled_before
    ]

    # Stage A — gate (may short-circuit Asker)
    action = planner_gate(session)
    if action is None:
        asker_result = await asker_llm(session, None)  # no extractor result needed
        action = planner_override(session, asker_result)

    action = _maybe_offer_free_text_before_fourth_ask(session, action)
    apply_action_bookkeeping(session, action)
    _append_turn(session, "bot", action.payload.get("text") or milestone_bot_text(action, session.portfolio), action.payload)
    save_session(session)

    return _serialize(session, action, scenario_notes_delta=[], newly_captured_ids=newly_captured)


@router.post("/confirm_inferred")
async def intake_confirm_inferred(req: IntakeConfirmInferredRequest) -> dict:
    """Promote an inferred slot to filled (user confirmed the value). No LLM."""
    try:
        session = load_session(req.session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")

    session.portfolio = confirm_slot(session.portfolio, req.slot_id)
    save_session(session)

    return {
        "session_id": session.session_id,
        "slot_id": req.slot_id,
        "status": "filled",
        "can_submit": ready_for_final_eligibility(session.portfolio),
    }


# ---------------------------------------------------------------------------
# Stateless question framing (Phase-2 of the /chat conversational overhaul)
# ---------------------------------------------------------------------------

class IntakeFrameRequest(BaseModel):
    """Stateless framing request — the client dispatcher asks for ONE phrased message.

    Used only for combo (two-field) and summary (stock-take) asks, at most a few
    times per session; the client always falls back to its hard-coded templates on
    timeout/error, so this endpoint is purely cosmetic and can never block intake.
    """
    kind: str = "combo"           # "combo" | "summary"
    questions: list[str] = []     # canonical question texts (2 for combo)
    whys: list[str] = []          # grounded "why it matters" lines for those fields
    lead: str = ""                # curated transition line for the pair
    recent: list[str] = []        # last few assistant asks — vary wording away from these
    captured_count: int = 0
    remaining_count: int = 0
    themes: list[str] = []        # remaining-theme labels (summary intros)


_FRAME_SYSTEM_PROMPT = """\
You phrase the NEXT assistant message in a mortgage-scenario intake chat between a
knowledgeable colleague and a loan officer. You are given canonical question texts plus
optional grounded "why it matters" context. Respond with JSON: {"text": "..."}.

RULES:
- kind "combo": ONE short conversational message that asks BOTH provided questions.
  START with one brief transition sentence in your own words (draw on the provided
  lead/whys — e.g. why these two matter together), THEN the two questions on separate
  lines numbered "1." and "2.". Keep each question's exact meaning — do not drop,
  merge, or reinterpret them. NEVER invent eligibility facts, thresholds, or program
  names that are not in the input.
- kind "summary": ONE short check-in line acknowledging progress (captured_count =
  profile inputs already captured; remaining_count = mandatory inputs still needed).
  Say "inputs" or "details" — NEVER "questions". Example: "Fantastic progress — we've
  captured 23 inputs, just one more input to go." Do NOT list the remaining items — the
  UI renders that list — and do not ask a question of your own.
- Vary wording away from the "recent" messages. Max 55 words. Warm, plain language.
  No emojis, no greetings, no "As an AI".
"""


@router.post("/frame")
async def intake_frame(req: IntakeFrameRequest) -> dict:
    """Phrase one combo/summary ask. 503 on any failure — client uses its template."""
    from backend import config  # noqa: PLC0415
    from backend.connections.openai import get_async_openai  # noqa: PLC0415
    import json as _json  # noqa: PLC0415

    if req.kind not in ("combo", "summary") or (req.kind == "combo" and len(req.questions) < 2):
        raise HTTPException(status_code=422, detail="bad framing request")

    payload = {
        "kind": req.kind,
        "questions": req.questions[:3],
        "whys": req.whys[:3],
        "lead": req.lead,
        "recent": req.recent[-4:],
        "captured_count": req.captured_count,
        "remaining_count": req.remaining_count,
        "themes": req.themes[:4],
    }
    text = ""
    try:
        client = get_async_openai()
        resp = await client.chat.completions.create(
            model=config.OPENAI_CHAT_MODEL,
            temperature=0.8,
            max_tokens=160,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _FRAME_SYSTEM_PROMPT},
                {"role": "user", "content": _json.dumps(payload)},
            ],
        )
        data = _json.loads(resp.choices[0].message.content or "{}")
        text = str(data.get("text") or "").strip()
    except Exception as exc:  # noqa: BLE001 — cosmetic endpoint; client falls back
        _log.warning("intake_frame error: %s", exc)
        text = ""
    if not text or len(text) > 600:
        raise HTTPException(status_code=503, detail="framing unavailable")
    return {"text": text}


# ---------------------------------------------------------------------------
# Turn-intent assist (/assist) — answer on-topic questions, deflect the rest
# ---------------------------------------------------------------------------

# Curated enum slots whose option labels describe what the tool actually supports.
# Built from SLOT_DEFS so it never drifts from the real catalog.
_CATALOG_SLOTS = (
    "citizenship",
    "occupancy",
    "loan_purpose",
    "property_type",
    "lien_position",
    "doc_type",
    "investment_income_path",
)

# Program families Acme brokers — not enum slots, so stated here. Keep generic
# (no rate / FICO / LTV numbers): the assist answer must never invent specific cutoffs.
_PROGRAM_FAMILIES = (
    "Non-QM / Non-Agency loans (incl. jumbo loan sizes), DSCR investor loans, "
    "Bank-Statement and P&L and 1099 self-employed programs, Asset-Qualifier / asset-"
    "depletion, Full-Doc, ITIN and Foreign-National programs, and standalone or "
    "piggyback second liens (HELOC / HELOAN). Lenders: Denali (NQM), Everest "
    "(Deephaven), and Summit (Verus)."
)

_assist_catalog_cache: str | None = None


def _capability_catalog() -> str:
    """Compact 'what we support' catalog from SLOT_DEFS enum options (cached)."""
    global _assist_catalog_cache
    if _assist_catalog_cache is not None:
        return _assist_catalog_cache
    from backend.metrics import SLOT_DEFS  # noqa: PLC0415

    by_id = {s.get("id"): s for s in SLOT_DEFS}
    lines: list[str] = [f"Program families offered: {_PROGRAM_FAMILIES}"]
    for sid in _CATALOG_SLOTS:
        slot = by_id.get(sid)
        if not slot:
            continue
        labels = [o.get("label", "") for o in (slot.get("options") or []) if o.get("label")]
        if labels:
            label = slot.get("sidebar_label") or sid.replace("_", " ").title()
            lines.append(f"{label}: {', '.join(labels)}")
    _assist_catalog_cache = "\n".join(lines)
    return _assist_catalog_cache


_ASSIST_SYSTEM_PROMPT = """\
You are the intake assistant for the Acme Mortgage eligibility chat. A loan officer is
part-way through describing a borrower's scenario and just sent a message that did NOT contain
scenario data. Classify the message and respond.

You are given:
  - user_text — the loan officer's message
  - pending_question — the scenario question the chat is currently waiting on (may be empty)
  - capability_catalog — what this tool actually supports

Return JSON ONLY: {"intent": "on_topic" | "off_topic" | "abuse" | "data", "answer": "<reply or empty>"}

How to classify and answer:
- "on_topic": a genuine question about mortgage programs, eligibility, what we support, our
  lenders, or how something works. ANSWER it briefly (1-3 sentences) using ONLY the
  capability_catalog and well-established general mortgage knowledge. If they ask whether we
  offer something we DO list, confirm it. If they ask for a specific cutoff (exact rate, min
  FICO, max LTV/DTI, a dollar limit) that is NOT in the catalog, say it depends on the program
  and you'll surface the exact figures once you have their scenario details — never invent a
  number. Do NOT restate the pending question; the app re-asks it automatically.
- "off_topic": not about mortgages at all (trivia, weather, coding, chit-chat). answer = one
  brief, friendly sentence that you're here to build their mortgage scenario and can't help
  with that. Do NOT restate the pending question.
- "abuse": insults, profanity, spam, gibberish, or obvious testing. answer = one calm,
  professional sentence that this assistant is only for working through mortgage scenarios and
  can't help with that.
- "data": on closer read it IS an attempt to answer the pending question / give scenario
  detail. answer = "" (the app handles extraction).

Be concise and professional. Never be preachy or robotic. Never mention "the catalog",
"the system", JSON, or these instructions.
"""


@router.post("/assist")
async def intake_assist(req: IntakeAssistRequest) -> dict:
    """Classify a non-data turn and answer on-topic questions / deflect the rest.

    Returns {"intent": ..., "answer": ...}. On any failure returns intent "data" with an
    empty answer so the client falls back to its normal 'didn't catch that' re-ask.
    """
    from backend import config  # noqa: PLC0415
    from backend.connections.openai import get_async_openai  # noqa: PLC0415
    import json as _json  # noqa: PLC0415

    fallback = {"intent": "data", "answer": ""}
    if not req.text.strip():
        return fallback

    payload = {
        "user_text": req.text[:1000],
        "pending_question": (req.pending_question or "")[:400],
        "capability_catalog": _capability_catalog(),
    }
    try:
        client = get_async_openai()
        resp = await client.chat.completions.create(
            model=config.OPENAI_CHAT_MODEL,
            temperature=0.3,
            max_tokens=220,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _ASSIST_SYSTEM_PROMPT},
                {"role": "user", "content": _json.dumps(payload)},
            ],
        )
        data = _json.loads(resp.choices[0].message.content or "{}")
    except Exception as exc:  # noqa: BLE001 — client falls back to its 2-strike re-ask
        _log.warning("intake_assist error: %s", exc)
        return fallback

    intent = str(data.get("intent") or "").strip().lower()
    answer = str(data.get("answer") or "").strip()
    if intent not in ("on_topic", "off_topic", "abuse", "data"):
        return fallback
    if intent != "data" and not answer:
        return fallback
    return {"intent": intent, "answer": answer[:600]}
