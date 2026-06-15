"""Next-question logic for chat intake — deterministic planner gate + LLM asker.

Merged from the former chat/planner.py (planner_gate / planner_override /
milestones) and chat/asker.py (asker_llm). The planner decides deterministically
when a milestone fires; the asker proposes the next question only when it does not.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from backend import config
from backend.chat.portfolio import (
    PAIRABLE_SLOTS,
    _SLOT_BY_ID,
    core_slots_ready,
    filled_essentials_count,
    force_combined_next,
    force_definitive_next,
    full_triggered_fill_ratio,
    intake_mode,
    leverage_slot_labels,
    lien_followup_missing,
    list_optional_batch_slots,
    list_remaining_themed_slots,
    list_remaining_triggered_slots,
    loan_triangle_missing,
    next_geo_slot_missing,
    next_slot_strict,
    parameters_for_llm,
    ready_for_final_eligibility,
    section1_complete,
)

_log = logging.getLogger(__name__)


# === Asker (LLM next-question proposal) ===================================

_SYSTEM_PROMPT = """\
You are the ASKER for a mortgage loan-intake chat with a loan officer (LO). The Extractor has already run. You receive:
  (a) parameters_by_priority — slot schema grouped essential / optional
  (b) portfolio — filled slots (post-Extractor merge)
  (c) last_target_slots — slot(s) the bot just asked about
  (d) extracted_this_turn — slot IDs captured this turn
  (e) recent_turns — last 3 user/bot exchanges
  (f) question_count, single_streak, combined_streak — pacing context

Return JSON ONLY:
{
  "ambiguities": [
    { "slot_id": "<id>", "candidates": ["code_a","code_b"], "reason": "..." }
  ],
  "proposed_next": {
    "style": "definitive" | "combined" | "clarify",
    "slot_ids": ["<id>"] or ["<id_a>","<id_b>"],
    "text": "<question, max 30 words, conversational and warm>",
    "chips": null,
    "input_type": "chips" | "currency" | "number" | "mixed"
  }
}

AMBIGUITY (Step 1):
- If the last reply COULD mean two different values for a slot we asked about, add to ambiguities[].
- Examples: "rate-and-cash-out" → loan_purpose ambiguous; "mostly primary" → occupancy hedged.
- If ambiguous → set proposed_next.style = "clarify", target that slot.

CLARIFICATION LIBRARY (use these as few-shot examples when ambiguity is detected):
  last_slot=loan_purpose,        said "rate and cash-out"                → "Rate-and-term (no cash) or cash-out refi?" [Rate & Term, Cash-Out]
  last_slot=occupancy,           said "investment-ish, live there sometimes" → "Primary, second home, or investment?" [Primary, Second Home, Investment]
  last_slot=occupancy,           said "house hack"                       → "Primary — house hack counts on 2-4 unit?" [Primary, Investment]
  last_slot=citizenship,         said "green card"                       → "Permanent Resident or already a US Citizen?" [Permanent Resident, US Citizen]
  last_slot=citizenship,         said "on a visa"                        → "Work visa (non-perm resident) or Foreign National?" [Work Visa, Foreign National]
  last_slot=property_type,       said "townhome"                         → "Townhouse on its own land, or part of a PUD?" [Townhouse, PUD]
  last_slot=property_type,       said "condo"                            → "Warrantable or non-warrantable condo?" [Warrantable, Non-Warrantable]
  last_slot=doc_type,            said "bank statements"                  → "12-month, 24-month, or business bank statements?" [12-Mo, 24-Mo, Business]
  last_slot=lien_position,       said "HELOC"                            → "HELOC = 2nd lien — confirming?" [Yes 2nd lien, No 1st lien]
  last_slot=fico,                said "650 and 740"                      → "Two borrowers — lower score (650) drives qualifying. Use 650?" [Use 650, Enter different]
  last_slot=existing_second_lien,said "HELOC sitting behind"             → "Subordinating the HELOC, or paying it off in this transaction?" [Subordinating, Paying off]
  last_slot=dti,                 said "around 43"                        → (no clarify — extract 43, mark inferred)
  last_slot=acreage,             said "5 acres-ish"                      → (no clarify — extract 5, mark inferred)

NEXT QUESTION (Step 2 — only if no ambiguity):
- Pick the most useful unfilled triggered essential slot.
- DEFAULT to style = "definitive" (single slot). Only use "combined" for the EXACT pairs in the catalogue below.

ALLOWED COMBINED PAIRS (only these — any other combination → definitive):
  property_value + loan_amount           → "Property value and loan amount?"
  loan_amount + cash_in_hand             → "Loan amount and cash-in-hand target?"          (loan_purpose=cash_out)
  fico + estimated_dti                   → "FICO and estimated DTI?"                       (income path)
  estimated_dti + assets                 → "DTI and liquid assets?"                        (income path)
  property_state + property_type         → "State and property type?"
  property_value + property_type         → "Property value, and type — SFR, condo, 2-4?"
  dscr + rental_type                     → "DSCR ratio, and long-term or short-term?"      (DSCR path)
  occupancy + loan_purpose               → "How will it be used, and purchase or refi?"    (first ask only)
  existing_first_lien + loan_amount      → "Existing 1st UPB and the new 2nd-lien amount?" (2nd lien)
  existing_mortgage_upb + cash_in_hand   → "Existing balance, and target cash-out?"        (cash-out refi)
  entity_vesting + prepayment_terms      → "Vesting and prepayment penalty?"               (investment)
  # credit_event is always a dedicated single-turn question — never combined with other slots

BUSINESS RULES (implicit — never ask the user about these):
- doc_type = "full_doc" → investment_income_path is always "income". Never ask about DSCR path.
- 5-8 unit property_type → always DSCR path. Never ask investment_income_path.
- After property_state is filled, the planner asks state-specific location follow-ups (county, city, ZIP, metro). Do not skip or replace those with other slots.

COMBINING RULES:
- NEVER combine citizenship, fico, payment_history, or lien_position with any other slot — always alone.
- Enum slots MAY combine ONLY for the specific pairs listed in the catalogue above.
- NEVER combine slots from unrelated sections.
- When in doubt → style = "definitive".

PHRASING STYLE (pick based on question_count):
- question_count ≤ 2: Conversational ("Let's start with...", "How will the borrower use this property?")
- question_count 3–7: Standard (direct question: "What's the FICO score?")
- question_count ≥ 8: Terse ("FICO?", "DTI?", "State?")
- Never use the exact same phrasing as the most recent bot turn in recent_turns.

QUESTION STYLE RULES:
- Max 30 words. Warm and direct — brief acknowledgment ("Got it!", "Perfect.") is fine.
- Sound like a knowledgeable colleague, not a form.
- Always set chips = null. The Python layer injects the correct options automatically.
- currency/number slots: input_type "currency" or "number".
- combined: input_type = "mixed".
- clarify: rephrase as "When you said X, did you mean A or B?" — always style = "clarify".
"""


@dataclass
class AskerResult:
    ambiguities: list[dict] = field(default_factory=list)
    proposed_next: dict = field(default_factory=dict)
    raw_response: str = ""


async def asker_llm(
    session: "IntakeSession",  # type: ignore[name-defined]
    extractor_result: "ExtractorResult | None",  # type: ignore[name-defined]
) -> AskerResult:
    """Call OpenAI (json mode) to detect ambiguity and propose next question."""
    from backend.connections.openai import get_async_openai

    client = get_async_openai()

    params = parameters_for_llm(session.portfolio)
    extracted_ids = list((extractor_result.extracted or {}).keys()) if extractor_result else []

    recent_turns = [
        {"role": t.role, "text": t.text}
        for t in session.turns[-6:]          # last 3 pairs
    ]

    payload = {
        "parameters_by_priority": params,
        "portfolio": {k: v for k, v in session.portfolio.items()
                      if not k.endswith(("_status", "_source", "_confidence"))},
        "last_target_slots": session.last_target_slots,
        "extracted_this_turn": extracted_ids,
        "recent_turns": recent_turns,
        "question_count": session.question_count,
        "single_streak": session.single_streak,
        "combined_streak": session.combined_streak,
    }

    for attempt in range(2):
        try:
            resp = await client.chat.completions.create(
                model=config.OPENAI_CHAT_MODEL,
                temperature=0.2 if attempt == 0 else 0.0,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": json.dumps(payload)},
                ],
            )
            raw = resp.choices[0].message.content or "{}"
            data = json.loads(raw)
            return AskerResult(
                ambiguities=data.get("ambiguities") or [],
                proposed_next=data.get("proposed_next") or {},
                raw_response=raw,
            )
        except json.JSONDecodeError as exc:
            _log.warning("asker_llm JSON parse error (attempt %d): %s", attempt + 1, exc)
            if attempt == 1:
                return AskerResult()
        except Exception as exc:
            _log.error("asker_llm error (attempt %d): %s", attempt + 1, exc)
            if attempt == 1:
                return AskerResult()

    return AskerResult()


# === Planner (deterministic gate + milestones) ===========================

@dataclass
class Action:
    kind: str
    payload: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Stage A — planner_gate
# ---------------------------------------------------------------------------

def planner_gate(session: Any) -> Action | None:
    """
    Checks hard milestones in priority order.
    Returns a deterministic Action if one fires, else None (→ run Call 2).
    """
    # 1. Hard cap at 10 questions → inline checklist while anything required is still missing
    if session.question_count >= 10:
        remaining = list_remaining_triggered_slots(session.portfolio, limit=12)
        if remaining:
            return Action("OFFER_CHECKLIST", {
                "slots": remaining,
                "can_submit": ready_for_final_eligibility(session.portfolio),
            })

    # 2b. Lien follow-ups before loan triangle (CLTV needs 1st/2nd balances)
    lien_ask = lien_followup_missing(session.portfolio)
    if lien_ask:
        slot_def = _SLOT_BY_ID.get(lien_ask, {})
        return Action("ASK_SLOT_DEFINITIVE", {
            "slot_ids": [lien_ask],
            "style": "definitive",
            "text": slot_def.get("prompt"),
            "input_type": slot_def.get("kind", "currency"),
        })

    # 3. Loan triangle priority — if property_value is known but not loan_amount/ltv (or vice
    #    versa), always ask for the missing piece before anything else.
    triangle_missing = loan_triangle_missing(session.portfolio)
    if triangle_missing:
        slot_def = _SLOT_BY_ID.get(triangle_missing, {})
        if triangle_missing == "loan_amount":
            text = "What's the loan amount, down payment, or LTV?"
        elif triangle_missing == "ltv":
            _, text = leverage_slot_labels(session.portfolio)
        elif triangle_missing == "cltv":
            text = "What's the combined CLTV?"
        else:
            text = "And what's the property value?"
        return Action("ASK_SLOT_DEFINITIVE", {
            "slot_ids": [triangle_missing],
            "style": "definitive",
            "text": text,
            "input_type": slot_def.get("kind", "currency"),
        })

    # 3b. State-specific location follow-ups (county, city, ZIP, metro flags)
    geo_ask = next_geo_slot_missing(session.portfolio)
    if geo_ask:
        return Action("ASK_SLOT_DEFINITIVE", geo_ask)

    # 3c. years_since_event immediate follow-up — fires ONLY when credit_event_category
    #     was just filled with a real event and years_since_event is still missing.
    #     This must run before next_slot_strict so the follow-up is always immediate.
    from backend.chat.portfolio import _is_filled, _is_triggered  # noqa: PLC0415
    _yse_def = _SLOT_BY_ID.get("years_since_event", {})
    if (
        session.portfolio.get("credit_event_category") not in (None, "", "None")
        and not _is_filled(session.portfolio, "years_since_event")
        and _is_triggered(_yse_def, session.portfolio)
    ):
        return Action("ASK_SLOT_DEFINITIVE", {
            "slot_ids": ["years_since_event"],
            "style": "definitive",
            "text": "How long ago did this happen?",
            "hint": None,
            "input_type": "chips",
        })

    # v6 §5 — Preview fires when ≥5 user answers OR when ≥80% of all triggered
    # triggered essential slots are filled (expanded list, not just the narrow
    # 11-field quick set). The fill_ratio path uses full_triggered_fill_ratio so a
    # single bulk message cannot easily reach 80% by only covering the small quick set.
    if not session.preview_shown:
        user_answers = getattr(session, "user_answer_count", 0)
        fill_ratio = full_triggered_fill_ratio(session.portfolio)
        if user_answers >= 5 or fill_ratio >= 0.80:
            # Use themed grouping: max 3, min 2, same section — avoids mixing DTI/Credit/Rural
            still_missing = list_remaining_themed_slots(session.portfolio, max_n=3, min_n=2)
            return Action("OFFER_PREVIEW", {
                "still_missing": still_missing,
                "can_submit": len(still_missing) == 0,
            })

    # All triggered essential slots filled → submit. In underwriter (uw) mode we
    # first offer the optional batch card; LO mode skips optionals entirely.
    if ready_for_final_eligibility(session.portfolio):
        if intake_mode(session.portfolio) == "uw":
            optional_slots = list_optional_batch_slots(session.portfolio)
            if optional_slots:
                return Action("OFFER_OPTIONAL_BATCH", {"slots": optional_slots})
        return Action("OFFER_SUBMIT", {})

    # v6 §3 — Deterministic next slot (skips Asker LLM for normal single-slot questions).
    next_s = next_slot_strict(session.portfolio)
    if next_s:
        slot_id = next_s["id"]
        # Dedicated-turn slots: force chips input and include hint so UI is correct.
        _DEDICATED_TURN = {"payment_history", "credit_event_category"}
        if slot_id in _DEDICATED_TURN:
            slot_def = _SLOT_BY_ID.get(slot_id, {})
            return Action("ASK_SLOT_DEFINITIVE", {
                "slot_ids": [slot_id],
                "style": "definitive",
                "text": slot_def.get("prompt"),
                "hint": slot_def.get("hint"),
                "input_type": "chips",
            })
        kind = next_s.get("kind", "text")
        input_type = kind if kind in ("chips", "chips_multi", "currency", "number") else (
            "chips" if next_s.get("options") else "text"
        )
        return Action("ASK_SLOT_DEFINITIVE", {
            "slot_ids": [slot_id],
            "style": "definitive",
            "text": next_s.get("prompt"),
            "input_type": input_type,
        })

    return None   # → run Call 2 (Asker)


# ---------------------------------------------------------------------------
# Stage B — planner_override
# ---------------------------------------------------------------------------

def planner_override(session: Any, asker_out: Any) -> Action:
    """
    Runs AFTER Call 2 (Asker).
    1. Clarify always wins if there are ambiguities.
    2. Enforce 2:1 single:combined ratio.
    3. Accept the Asker's proposal otherwise.
    """
    ambiguities = asker_out.ambiguities if hasattr(asker_out, "ambiguities") else (asker_out.get("ambiguities") or [])
    proposed = asker_out.proposed_next if hasattr(asker_out, "proposed_next") else (asker_out.get("proposed_next") or {})

    # 1. Clarify always wins
    if ambiguities:
        clarify = dict(proposed)
        clarify["style"] = "clarify"
        return Action("ASK_CLARIFY", clarify)

    style = proposed.get("style", "definitive")

    # 2. Enforce 2:1 ratio
    #    single_streak >= 2 AND Asker proposes definitive → try to force combined
    if session.single_streak >= 2 and style == "definitive":
        forced = force_combined_next(session, {"proposed_next": proposed})
        if forced:
            return Action("ASK_SLOT_COMBINED", forced)

    #    combined_streak >= 1 AND Asker proposes combined → force back to definitive
    if session.combined_streak >= 1 and style == "combined":
        forced = force_definitive_next(session, {"proposed_next": proposed})
        if forced:
            return Action("ASK_SLOT_DEFINITIVE", forced)

    # 3. Validate combined proposals: reject invalid pairings and enum/boolean slots
    if style == "combined":
        slot_ids = proposed.get("slot_ids") or []
        primary = slot_ids[0] if slot_ids else ""
        secondary = slot_ids[1] if len(slot_ids) > 1 else ""
        _DEDICATED_SLOTS = {"credit_event_category", "credit_event_type", "years_since_event", "payment_history"}
        # These slots are always asked alone — never combined with anything
        if primary in _DEDICATED_SLOTS or secondary in _DEDICATED_SLOTS:
            forced = force_definitive_next(session, {"proposed_next": proposed})
            return Action("ASK_SLOT_DEFINITIVE", forced or {**proposed, "slot_ids": [primary], "style": "definitive", "chips": None})
        # A pair is valid only when secondary is an approved partner for primary in PAIRABLE_SLOTS.
        # PAIRABLE_SLOTS now encodes the full approved catalogue including enum pairs.
        invalid_pairing = bool(secondary and secondary not in PAIRABLE_SLOTS.get(primary, []))
        if invalid_pairing:
            forced = force_definitive_next(session, {"proposed_next": proposed})
            # Always return definitive — even if force_definitive_next fails, use first slot.
            # Clear chips+text so _serialize rebuilds them from SLOT_DEFS correctly.
            first = [primary] if primary else slot_ids[:1]
            slot_prompt = (_SLOT_BY_ID.get(first[0]) or {}).get("prompt") if first else None
            return Action(
                "ASK_SLOT_DEFINITIVE",
                forced or {
                    **proposed,
                    "slot_ids": first,
                    "style": "definitive",
                    "chips": None,
                    "text": slot_prompt,
                },
            )
        return Action("ASK_SLOT_COMBINED", proposed)

    return Action("ASK_SLOT_DEFINITIVE", proposed)


# ---------------------------------------------------------------------------
# Bookkeeping
# ---------------------------------------------------------------------------

def apply_action_bookkeeping(session: Any, action: Action) -> None:
    """Update session streak / question_count / preview_shown based on action."""
    session.last_action = action.kind
    session.last_target_slots = action.payload.get("slot_ids") or []

    if action.kind == "OFFER_FREE_TEXT":
        return

    if action.kind in ("ASK_SLOT_DEFINITIVE", "ASK_SLOT_COMBINED", "ASK_CLARIFY"):
        session.question_count += 1

    if action.kind == "ASK_SLOT_COMBINED":
        session.combined_streak += 1
        session.single_streak = 0
    elif action.kind == "ASK_SLOT_DEFINITIVE":
        session.single_streak += 1
        session.combined_streak = 0
    # ASK_CLARIFY does not update streaks (it clears after)
    elif action.kind == "ASK_CLARIFY":
        session.combined_streak = 0
        session.single_streak = 0

    if action.kind == "OFFER_PREVIEW":
        session.preview_shown = True


def increment_user_answer_count(session: Any) -> None:
    """Increment the v6 substantive-answer counter (called after each user turn with slot content)."""
    if hasattr(session, "user_answer_count"):
        session.user_answer_count += 1
    else:
        session.user_answer_count = 1


# ---------------------------------------------------------------------------
# Bot-text templates for milestone actions
# ---------------------------------------------------------------------------

def milestone_bot_text(action: Action, portfolio: dict) -> str:
    kind = action.kind
    if kind == "OFFER_SUBMIT":
        return "Looks like I have everything needed — ready to run full eligibility?"
    if kind == "OFFER_CHECKLIST":
        slots = action.payload.get("slots") or []
        n = len(slots)
        if n == 0:
            return ""
        return (
            f"Almost there — {n} detail{'s' if n != 1 else ''} still needed. "
            "Fill what you can below (location, credit, loan details, etc.):"
        )
    if kind == "OFFER_OPTIONAL_BATCH":
        return (
            "Got all the essentials. A few optional details — fill what you know "
            "or skip them all:"
        )
    if kind == "OFFER_PREVIEW":
        return ""
    return ""


def greeting_bot_text() -> str:
    return (
        "Hi! Tell me about the loan scenario — borrower, property, loan amount, "
        "state, doc type. Paste as much or as little as you have and I'll fill in the gaps."
    )
