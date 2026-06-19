"""
Call 1 — Extractor LLM.
Maps user text to slot codes + scenario notes. Two modes:
  'turn'  — short reply answering a specific question (last_target_slots is a strong prior)
  'bulk'  — initial multi-field dump from the LO
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

from backend.chat.portfolio import parameters_for_llm, ScenarioNote

_log = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
You are the EXTRACTOR for a mortgage loan-intake chat. The user is a loan officer (LO) describing a borrower scenario. You receive:
  (a) parameters_by_priority — slot schema grouped by essential / optional
  (b) portfolio — slots already filled
  (c) last_target_slots — the slot(s) the bot just asked about (STRONG prior for short replies)
  (d) user_text — the LO's latest message

Return JSON ONLY in this exact shape:
{
  "extracted": {
    "<slot_id>": { "value": <coerced>, "confidence": 0.0-1.0, "source_phrase": "..." }
  },
  "removed": ["<slot_id>", ...],
  "ambiguities": [
    { "slot_id": "<slot_id>", "user_phrase": "<raw phrase>", "candidates": ["<option_code>", ...] }
  ],
  "scenario_notes": [
    { "text": "<verbatim phrase>", "related_slot": "<slot_id or null>", "paraphrase": "<<=12 words>" }
  ]
}

RULES:
1. Use the EXACT codes from the schema options (e.g. "us_citizen" not "US Citizen", "purchase" not "Purchase").
2. For enum slots: if a value cleanly maps → put it in extracted{}. If the user's phrase SOUNDS like a valid option but doesn't exactly match any code, label, or alias → put it in ambiguities[] with the closest candidate codes. If the value is completely unrecognisable for that slot → scenario_notes.
3. For currency/number: return a raw number (no $, commas, %). For LTV/DTI, return the whole-number percent (e.g. 80). DSCR is a DECIMAL RATIO, not a percent — return it as-is (e.g. "1.15", "0.95", "1.0"); NEVER convert it to a percent. ONLY extract dscr when the user explicitly states a coverage ratio ("DSCR 1.15", "1.2 DSCR", "ratio of 1.0", "rents cover 1.25x"); NEVER guess or infer a DSCR value.
4. multi_enum slots must be arrays.
5. Confidence: 0.95+ only when explicitly stated; 0.80-0.94 for paraphrased/hedged; <0.80 for inferred.
6. last_target_slots: weight heavily — a one-word reply almost certainly answers that slot.
7. Anything underwriting-relevant that does NOT map to a slot → scenario_notes entry. Skip pleasantries. Max 3 per turn.
8. Do NOT invent slot IDs not in the schema. Do NOT re-echo existing portfolio values.
9. Do NOT propose a next question.
10. For property_value and loan_amount: return the raw integer (e.g. 850000 not 850k).
11. If doc_type is "full_doc" and occupancy is investment property, automatically set
    investment_income_path = "income" (Full Documentation always means personal income / DTI,
    never DSCR). Do not ask about it; it is implicit.
12. REMOVALS: If the user explicitly asks to remove, clear, reset, or ignore a previously-set value
    ("remove X", "clear X", "forget X", "actually ignore that", "scratch that X"), add the slot_id
    to the "removed" array. Do NOT put it in "extracted". Only remove slots that exist in the
    portfolio. If the user corrects a value ("actually it's 700" / "change FICO to 700"), put the
    new value in "extracted" — do NOT add it to "removed".
13. BULK MODE: When last_target_slots is empty the user may have given 10–20 values in one paste.
    Scan EVERY clause of the input and map ALL mentioned values. Return ~1 entry per mentioned value.
    State names and abbreviations: "TX"/"Texas"/"texas" → property_state: "TX". If the state spelling
    is close but not exact (e.g. "texass"), put it in ambiguities[] with candidates ["TX"].
    Partial abbreviations (e.g. "Flo" for Florida, "Cal" for California, "Penn" for Pennsylvania):
    treat as ambiguous — put in ambiguities[] with the most likely 2-letter code as the sole candidate,
    e.g. ambiguities: [{slot_id:"property_state", user_phrase:"Flo", candidates:["FL"]}].
14. CITY → STATE inference: If the user mentions a well-known city (and property_state is not yet filled),
    infer the state automatically and put it in extracted{} as property_state.
    Examples: "Miami" or "Miami, FL" → property_state: "FL"; "Los Angeles" → "CA"; "Houston" → "TX";
    "Chicago" → "IL"; "Phoenix" → "AZ"; "Atlanta" → "GA"; "Seattle" → "WA"; "Denver" → "CO";
    "Las Vegas" → "NV"; "Portland" → "OR"; "Boston" → "MA"; "Philadelphia" → "PA";
    "Nashville" → "TN"; "Charlotte" → "NC"; "Dallas" / "Austin" / "San Antonio" → "TX";
    "Orlando" / "Tampa" / "Jacksonville" / "Fort Lauderdale" → "FL";
    "San Francisco" / "San Diego" / "Sacramento" / "San Jose" → "CA";
    "New York" / "NYC" / "Brooklyn" / "Manhattan" / "Queens" / "Bronx" / "Staten Island" → "NY";
    "Newark" → "NJ"; "Detroit" → "MI"; "Minneapolis" → "MN"; "Baltimore" → "MD";
    "Columbus" / "Cleveland" / "Cincinnati" → "OH"; "Indianapolis" → "IN";
    "Louisville" → "KY"; "Memphis" → "TN"; "Richmond" → "VA"; "Salt Lake City" → "UT".
    Confidence for city→state inference: 0.92. If the city is ambiguous (e.g. "Portland" could
    be OR or ME) put it in ambiguities[] with the top candidate.
15. RESERVES vs LIQUID ASSETS — distinguish the COUNT of months from a DOLLAR amount:
    • "<N> months of reserves / liquid assets / PITIA" → reserves_months = <N>
      (e.g. "six months of liquid assets" → reserves_months: 6). This is a COUNT, not dollars.
    • A DOLLAR amount of cash / savings / liquid funds ("$50k in reserves", "$50,000 liquid assets")
      → assets = 50000.
    NEVER put a months count into "assets", and NEVER put a dollar amount into "reserves_months".
16. doc_timeframe — when doc_type is full_doc, bank statements, P&L, or 1099, extract ONLY "12"
    or "24". Map "1 year (of tax returns)", "one year", "12 months" → "12"; "2 years", "24 months"
    → "24". Put the value in extracted{} as doc_timeframe, NOT scenario_notes.
17. LOAN PURPOSE inference: paying off / refinancing an EXISTING mortgage or lien with a new loan
    is a refinance, not a purchase.
    • Cash-out — they say "cash out" / "take equity", OR the new loan amount exceeds the existing
      payoff/UPB (the difference is cash to the borrower) → loan_purpose = "cash_out".
      e.g. "pay off the $400k first lien with a new $600k loan" → cash_out (borrower nets ~$200k).
    • Replacing the existing loan with no cash out (new loan ≈ payoff) → loan_purpose = "rate_term".
    • A brand-new home purchase → "purchase".
    Confidence ~0.85 when inferred from "pay off the existing/first…" phrasing (not explicit).
18. scenario_notes are ONLY for underwriting-relevant facts that map to NO slot. NEVER note the
    property location (state / county / city — those are property_state / state_county / state_city),
    credit events, or anything you already put in extracted{}. A note that merely restates a
    captured field is forbidden.
19. CREDIT EVENTS — extract every detail present in one pass: category (BK/FC/SS/…) →
    credit_event_category; chapter + outcome ("Ch 7 discharged", "chapter 13 dismissed") →
    credit_event_type; elapsed time → years_since_event bucket. "BK Ch7 - 7+ years ago" must
    yield all three, not just the category.
    SEASONING from a stated YEAR or MM/YYYY: compute elapsed years as (year of "today" minus the
    stated year) and pick the bucket — "today" is in the payload. Example: today 2026, "foreclosure
    in 2022" → 2026-2022 = 4 years → "4-7 years" (NOT "<1 year"). "in 2019" with today 2026 → 7 →
    "7+ years". Relative phrases map directly: "7 years ago"/"7+ yrs back" → "7+ years"; "last year"
    → "<1 year". NEVER return "<1 year" for a year that is several years before "today".
20. HELOC STRUCTURE — on a standalone-second HELOC (second_lien_product = "heloc"):
    • The credit limit / line amount IS loan_amount ("a $150k HELOC", "line of $150,000"
      → loan_amount = 150000).
    • Draw period → heloc_draw_years, ONLY "2", "3", or "5" ("three-year draw",
      "5 yr draw period" → "5").
    • The amount drawn at closing → heloc_initial_draw ("drawing $50k upfront",
      "initial draw of 50,000" → 50000). NEVER put a HELOC draw into cash_in_hand.
21. CITIZENSHIP normalization — map the cue to the slot code even when buried in filler
    or code-mixed / Hinglish phrasing, ESPECIALLY when last_target_slots includes citizenship:
    • "US" / "U.S." / "USA" / "American" / "US citizen" / "citizen" → citizenship = "us_citizen"
    • "green card" / "permanent resident" / "PR" / "LPR" → "perm_resident"
    • "ITIN" → "itin"
    • "visa" / "work visa" / "H-1B" / "non-permanent" / "non perm" → "non_perm_resident"
    • "DACA" → "daca"
    • "foreign national" / "non-resident alien" → "foreign_national"
    Examples: "Citizenship toh US hi hai" (Hinglish for "citizenship is US") → us_citizen;
    "borrower US ka hai" → us_citizen; "green card holder hai" → perm_resident.
    Only treat a bare pronoun "us" as us_citizen when the slot is citizenship (target or
    the word "citizenship" is present) — otherwise it is the ordinary word "us".
22. DSCR IS NOT A DOCUMENTATION TYPE. "DSCR" is an income-qualification PATH, not a doc_type.
    • NEVER map "DSCR" (or "doc type DSCR", "change documentation to DSCR", "DSCR loan") to
      any doc_type value — not full_doc, NOT asset_utilization, not bank_statements, nothing.
    • DSCR is valid ONLY when occupancy is investment_property. If occupancy IS investment,
      a DSCR mention sets investment_income_path = "dscr". If occupancy is NOT investment
      (primary_residence / second_home) or occupancy is unknown, DO NOT extract anything for
      a DSCR mention — return it as neither doc_type nor income path (the app explains the
      conflict separately). Do not substitute the "closest" doc type.
23. CAPABILITY QUESTIONS ARE NOT SCENARIO DATA (this rule OVERRIDES all extraction below).
    If the user is ASKING whether you offer / allow / support something — rather than stating
    THEIR borrower's scenario — extract NOTHING (return empty "extracted", no scenario_notes).
    Signals: the message is a question (ends with "?" or is phrased as one) AND uses inquiry
    wording like "do you do / offer / have / allow / support", "can you / can I", "is there /
    are there", "what about", "do you give", "what programs".
    Even if it NAMES values (DACA, ITIN, jumbo, DSCR, a state, an LTV), DO NOT map them —
    "Do you do jumbo loans for DACA?" extracts NOTHING (the user is not saying the borrower is
    DACA; they're asking about availability). The app answers capability questions separately.
    EXCEPTION: if the same message ALSO clearly states the borrower's own value
    ("the borrower is DACA — do you do jumbo?"), extract that stated value only.
"""


@dataclass
class ExtractorAmbiguity:
    slot_id: str
    user_phrase: str
    candidates: list[str] = field(default_factory=list)


@dataclass
class ExtractorResult:
    extracted: dict = field(default_factory=dict)    # {slot_id: {value, confidence, source_phrase}}
    removed: list[str] = field(default_factory=list) # slot_ids to clear
    ambiguities: list[ExtractorAmbiguity] = field(default_factory=list)  # near-miss values
    scenario_notes: list[ScenarioNote] = field(default_factory=list)
    raw_response: str = ""


async def extractor_llm(
    session: "IntakeSession",  # type: ignore[name-defined]
    user_text: str,
    mode: str = "turn",
) -> ExtractorResult:
    """Call OpenAI (json mode) to extract slot values and scenario notes."""
    import sys
    from pathlib import Path
    ROOT = Path(__file__).resolve().parents[2]
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from backend import config  # noqa: F401  (used below for OPENAI_CHAT_MODEL)
    from backend.connections.openai import get_async_openai

    client = get_async_openai()

    from datetime import datetime  # noqa: PLC0415

    params = parameters_for_llm(session.portfolio, bulk=(mode == "bulk"))
    payload = {
        "parameters_by_priority": params,
        "portfolio": {k: v for k, v in session.portfolio.items() if not k.endswith(("_status", "_source", "_confidence"))},
        "last_target_slots": session.last_target_slots if mode == "turn" else [],
        # The model needs today's date to compute "years since" from a stated year/date.
        "today": datetime.now().strftime("%Y-%m-%d"),
        "user_text": user_text,
    }

    for attempt in range(2):
        try:
            resp = await client.chat.completions.create(
                model=config.OPENAI_CHAT_MODEL,
                temperature=0.1 if attempt == 0 else 0.0,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": json.dumps(payload)},
                ],
            )
            raw = resp.choices[0].message.content or "{}"
            data = json.loads(raw)
            extracted = data.get("extracted") or {}
            removed = [r for r in (data.get("removed") or []) if isinstance(r, str)]
            ambig_raw = data.get("ambiguities") or []
            ambiguities = [
                ExtractorAmbiguity(
                    slot_id=a.get("slot_id", ""),
                    user_phrase=a.get("user_phrase", ""),
                    candidates=a.get("candidates") or [],
                )
                for a in ambig_raw
                if isinstance(a, dict) and a.get("slot_id")
            ]
            notes_raw = data.get("scenario_notes") or []
            notes = [
                ScenarioNote(
                    text=n.get("text", ""),
                    related_slot=n.get("related_slot"),
                    paraphrase=n.get("paraphrase", ""),
                )
                for n in notes_raw
                if isinstance(n, dict) and n.get("text", "").strip()
            ]
            return ExtractorResult(
                extracted=extracted,
                removed=removed,
                ambiguities=ambiguities,
                scenario_notes=notes,
                raw_response=raw,
            )
        except json.JSONDecodeError as exc:
            _log.warning("extractor_llm JSON parse error (attempt %d): %s", attempt + 1, exc)
            if attempt == 1:
                return ExtractorResult()
        except Exception as exc:
            _log.error("extractor_llm error (attempt %d): %s", attempt + 1, exc)
            if attempt == 1:
                return ExtractorResult()

    return ExtractorResult()
