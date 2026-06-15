"""Reject low-quality or off-topic chat messages before RAG."""
from __future__ import annotations

import re

UNDERSTOOD_REPLY = (
    "We did not understand the query. Please provide more details or contact our representative."
)

_GREETING_WORDS = frozenset({"hi", "hey", "hello", "howdy", "greetings", "yo", "sup"})

GREETING_REPLY = (
    "Hi there! I'm your mortgage advisor for this session. Feel free to ask me anything about "
    "your matched programs, eligibility details, documentation requirements, or any other "
    "questions about your loan scenario."
)


def is_greeting(message: str) -> bool:
    """True when the entire message is a bare greeting with no content."""
    stripped = re.sub(r"[^a-z0-9\s]", "", _normalize(message)).strip()
    return stripped in _GREETING_WORDS

CONTACT_REPRESENTATIVE_REPLY = (
    "We could not find that specific detail in the retrieved program guidelines. "
    "Please contact our representative for further assistance."
)

_DEFLECTION_RE = re.compile(
    r"(?:"
    r"consult\s+(?:the\s+)?(?:lender\s+)?matrix"
    r"|check\s+(?:the\s+)?(?:lender\s+)?matrix"
    r"|contact\s+(?:the\s+)?lender(?:\s+directly)?"
    r"|may\s+be\s+helpful\s+to\s+consult"
    r"|helpful\s+to\s+consult"
    r")",
    re.IGNORECASE,
)


def deflection_reply_if_needed(text: str) -> str | None:
    """Replace lender-matrix deflections with a contact-representative message."""
    t = (text or "").strip()
    if not t:
        return CONTACT_REPRESENTATIVE_REPLY
    low = t.lower()
    if _DEFLECTION_RE.search(t):
        return CONTACT_REPRESENTATIVE_REPLY
    if "couldn't find that specific detail" in low or "could not find that specific detail" in low:
        if _DEFLECTION_RE.search(t) or "lender" in low or "matrix" in low:
            return CONTACT_REPRESENTATIVE_REPLY
    return None

# Whole-message (normalized) matches
_EXACT_BLOCK = frozenset(
    {
        "nothing",
        "none",
        "n/a",
        "na",
        "shutup",
        "stfu",
        "nevermind",
        "nvm",
        "idk",
        "dunno",
        "whatever",
        "ok",
        "okay",
        "yes",
        "no",
        "yep",
        "nope",
        "test",
        "testing",
        "lol",
        "lmao",
        "bye",
        "thanks",
        "thank you",
        "stop",
        "quiet",
    }
)

# Substring / phrase block (normalized)
_PHRASE_BLOCK = (
    "shut up",
    "shut your",
    "be quiet",
    "go away",
    "leave me alone",
    "don't talk",
    "dont talk",
    "no thanks",
    "not interested",
)

_DOMAIN_RE = re.compile(
    r"\b("
    r"loan|mortgage|ltv|cltv|fico|dti|dscr|refi|refinance|purchase|programs?|"
    r"property|properties|occupancy|investor|lien|heloc|fthb|itin|dac|citizen|"
    r"documentation|doc|eligible|eligibility|overlay|prepay|prepayment|"
    r"asset\s+qualifier|qualifier|"
    r"cash[\s-]?out|bank\s*stmt|foreign\s*national|non[\s-]?qm|nqm|"
    r"qualify|qualification|requirement|guidelines?|borrower|underwriting|"
    r"credit|income|rental|investment|condo|warrantable|second\s+lien|"
    r"first[\s-]?time|homebuyer|arm|fixed|io\b|interest[\s-]?only|"
    r"bank\s*statements?|statements?|"
    r"geo(?:graphic)?|geographic|restriction|restrictions|state|states|county|"
    r"escrow|waiver|waivers|"
    r"denali|everest|summit|deephaven|verus|acme|lenders?|matrix|"
    r"documentation\s+type|doc\s+type|product|products|seasoning|housing"
    r")\b",
    re.IGNORECASE,
)

_FOLLOWUP_RE = re.compile(
    r"\b(more|explain|help|details|clarify|summary|overview|tell|show|list)\b",
    re.IGNORECASE,
)

_FOLLOWUP_PHRASE_RE = re.compile(
    r"(tell me more|more (?:detail|info)|explain (?:this|that|more)|"
    r"what about|how about|can you (?:explain|clarify)|help me understand)",
    re.IGNORECASE,
)

_WORD_RE = re.compile(r"\b[\w']+\b", re.UNICODE)


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _word_count(text: str) -> int:
    return len(_WORD_RE.findall(text))


def _is_blocklisted(norm: str) -> bool:
    if norm in _EXACT_BLOCK:
        return True
    for phrase in _PHRASE_BLOCK:
        if phrase in norm:
            return True
    return False


def looks_like_gibberish(text: str) -> bool:
    letters = sum(1 for c in text if c.isalpha())
    if letters == 0:
        return True
    words = _WORD_RE.findall(text)
    if not words:
        return True
    long_words = sum(1 for w in words if len(w) >= 3)
    return long_words == 0 and len(words) >= 1


def should_reject_chat_message(
    message: str,
    *,
    selected_program: str | None = None,
) -> bool:
    """
    Return True when the message should not be sent to RAG.

    Rules (stricter without a selected program):
    - Blocklisted rude / empty phrases (e.g. nothing, shut up)
    - Fewer than 3 words unless mortgage-related or follow-up wording
    - No mortgage / follow-up signal and reads off-topic or gibberish
    """
    raw = (message or "").strip()
    if not raw:
        return True

    norm = _normalize(raw)
    if _is_blocklisted(norm):
        return True

    if looks_like_gibberish(raw):
        return True

    words = _word_count(raw)
    has_domain = bool(_DOMAIN_RE.search(raw))
    program_selected = bool((selected_program or "").strip())
    has_followup = program_selected and (
        bool(_FOLLOWUP_PHRASE_RE.search(raw)) or bool(_FOLLOWUP_RE.search(raw))
    )

    if program_selected:
        if words < 2:
            return True
        if words < 3 and not (has_domain or has_followup):
            return True
        if words >= 3 and not has_domain and not has_followup:
            return True
        return False

    if words < 3:
        return not has_domain

    return not has_domain
