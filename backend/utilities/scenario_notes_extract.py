"""
Extract underwriting scenario notes from LO free text.

Shared by guided /form chat (post-intake optional notes) and chat intake
(/api/intake/refine and future chat-mode flows). Returns the same
``scenario_notes_delta`` shape as intake message responses.
"""
from __future__ import annotations

import json
import logging
from typing import Literal

from backend import config
from backend.chat.portfolio import ScenarioNote
from backend.utilities.guard import looks_like_gibberish

_log = logging.getLogger(__name__)

ScenarioNotesSource = Literal["form", "chat", "intake"]

_EXTRACT_SYSTEM = """\
You help a mortgage underwriting assistant. Structured intake fields are already captured
unless the caller says otherwise. The loan officer adds free-text about the borrower or deal.

Return JSON only:
{"scenario_notes": [{"text": "short verbatim phrase from input", "paraphrase": "<=12 words", "related_slot": null}]}

Rules:
- Include ONLY underwriting-relevant facts that are not obvious boilerplate.
- Max 3 entries; skip pleasantries and duplicate filler.
- related_slot: slot_id from intake schema when the note clearly relates to one field; else null.
- If the input has no substantive content, return {"scenario_notes": []}.
"""


def extract_scenario_notes_from_text(
    text: str,
    *,
    source: ScenarioNotesSource = "form",
    fallback_to_raw: bool = True,
) -> list[ScenarioNote]:
    """
    Paraphrase LO free text into ScenarioNote entries.

    ``source`` is a caller hint for logging / future prompt tuning (form | chat | intake).
    When OpenAI is unavailable, returns a single note with truncated raw text if
    ``fallback_to_raw`` is True.
    """
    raw = (text or "").strip()
    if not raw:
        return []
    if looks_like_gibberish(raw):
        return []

    if not config.OPENAI_API_KEY:
        if not fallback_to_raw:
            return []
        return [
            ScenarioNote(text=raw, related_slot=None, paraphrase=raw[:120]),
        ]

    from backend.connections.openai import get_openai

    user_content = raw
    if source == "chat":
        user_content = f"[chat intake follow-up]\n{raw}"
    elif source == "intake":
        user_content = f"[intake refine]\n{raw}"

    try:
        resp = get_openai().chat.completions.create(
            model=config.OPENAI_CHAT_MODEL,
            messages=[
                {"role": "system", "content": _EXTRACT_SYSTEM},
                {"role": "user", "content": user_content},
            ],
            max_tokens=300,
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        data = json.loads((resp.choices[0].message.content or "{}").strip())
        notes_raw = data.get("scenario_notes") if isinstance(data, dict) else []
        notes: list[ScenarioNote] = []
        if isinstance(notes_raw, list):
            for n in notes_raw:
                if not isinstance(n, dict):
                    continue
                note_text = str(n.get("text") or "").strip()
                paraphrase = str(n.get("paraphrase") or note_text).strip()
                if not paraphrase and not note_text:
                    continue
                related = n.get("related_slot")
                related_slot = str(related).strip() if related else None
                notes.append(
                    ScenarioNote(
                        text=note_text or paraphrase,
                        related_slot=related_slot or None,
                        paraphrase=paraphrase or note_text,
                    )
                )
        if notes:
            return notes
        if fallback_to_raw:
            return [ScenarioNote(text=raw, related_slot=None, paraphrase=raw[:120])]
        return []
    except Exception as exc:
        _log.warning("extract_scenario_notes_from_text failed (source=%s): %s", source, exc)
        if fallback_to_raw:
            return [ScenarioNote(text=raw, related_slot=None, paraphrase=raw[:120])]
        raise


def scenario_notes_to_delta(notes: list[ScenarioNote]) -> list[dict]:
    """API / client payload — matches intake ``scenario_notes_delta`` items."""
    return [n.to_dict() for n in notes]
