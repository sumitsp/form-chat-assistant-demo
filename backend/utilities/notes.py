"""Filter and prompt helpers for /api/summarize-notes (Additional Considerations)."""

from __future__ import annotations

import re

MAX_ADDITIONAL_CONSIDERATIONS_DISPLAY = 8
MIN_ADDITIONAL_CONSIDERATIONS_TARGET = 5

# map_program_rule_guideline categories already on the program card / scenario
SUMMARIZE_EXCLUDED_NOTE_CATEGORIES: frozenset[str] = frozenset(
    {
        # Key metrics already on the program card
        "credit score",
        "product type",
        "documentation",
        "doc type",
        "max dti",
        "dti requirements",
        "dti >50%",
        "loan amounts",
        "loan purpose",
        "occupancy",
        "property type",
        "property types",
        "tradelines",
        # Eligibility gates handled elsewhere (layers 1/5/NPRA)
        "citizenship",
        "eligible borrower",
        "eligible borrowers",
        "foreign national",
        "state eligibility",
        "state limitations",
        "geographic restrictions",
        "ineligible states",
        "ineligible geos",
        "loan type",
    }
)

_EXCLUDED_FOR_PROMPT = ", ".join(
    sorted(c.title() for c in SUMMARIZE_EXCLUDED_NOTE_CATEGORIES)
)

SUMMARIZE_SYSTEM_PROMPT = (
    "You are a mortgage advisor writing the **Additional Considerations** section on a "
    "program detail card. The borrower already sees Key Metrics (minimum FICO, maximum loan, "
    "maximum LTV, maximum DTI) and available products on the same card — do not repeat those.\n\n"
    f"Write {MIN_ADDITIONAL_CONSIDERATIONS_TARGET}–{MAX_ADDITIONAL_CONSIDERATIONS_DISPLAY} bullet points "
    "(aim for at least 5 when the notes support it). One point per line, each starting with '- '. "
    "Be direct and plain.\n\n"
    "FORMAT (required): each bullet must be exactly `Topic: consideration` — a short topic label, "
    "then a colon and space, then one concise sentence. Example:\n"
    "- Acreage: Max acreage is 20 for primary and second homes, and 5 for investment properties.\n"
    "- Appraisals: A second appraisal is required for loans over $2,000,000.\n\n"
    "EXCLUDE entirely (redundant with the card or scenario): "
    f"{_EXCLUDED_FOR_PROMPT}. "
    "Also skip generic credit-score floors, DTI caps, loan amount min/max, documentation types, "
    "product types, occupancy, or property type unless the note adds a specific exception or overlay.\n\n"
    "PREFER topics such as reserves, appraisals, acreage, gift funds, first-time homebuyer, "
    "cash-out, entity vesting, interest-only, declining markets, and geographic or conditional rules."
)


def normalize_consideration_bullets(
    bullets: list[str],
    *,
    max_items: int = MAX_ADDITIONAL_CONSIDERATIONS_DISPLAY,
) -> list[str]:
    """Ensure Topic: consideration shape and cap display count."""
    out: list[str] = []
    seen: set[str] = set()
    for raw in bullets:
        line = re.sub(r"^[-•*]\s*", "", (raw or "").strip())
        if not line or line in seen:
            continue
        if ":" not in line:
            line = f"General: {line}"
        else:
            topic, _, rest = line.partition(":")
            topic = topic.strip()
            rest = rest.strip()
            if topic and rest:
                line = f"{topic}: {rest}"
        seen.add(line)
        out.append(line)
        if len(out) >= max_items:
            break
    return out


def note_category_prefix(note: str) -> str:
    """Leading category from 'Category: content' guideline rows."""
    if ":" not in note:
        return ""
    return note.split(":", 1)[0].strip().lower()


def filter_notes_for_summarize(notes: list[str]) -> list[str]:
    """Drop guideline categories that duplicate the program detail card."""
    out: list[str] = []
    for raw in notes:
        n = (raw or "").strip()
        if not n:
            continue
        if note_category_prefix(n) in SUMMARIZE_EXCLUDED_NOTE_CATEGORIES:
            continue
        out.append(n)
    return out
