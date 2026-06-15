"""
Intake session store — MySQL-backed persistence with graceful fallback.

Tables are created on first use. If MySQL is unavailable the in-memory
dict is returned (resets on server restart, suitable for dev/testing).
"""
from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Any

from backend.chat.portfolio import ScenarioNote

_log = logging.getLogger(__name__)

# In-memory fallback (keyed by session_id)
_MEMORY_STORE: dict[str, dict] = {}
_TABLES_CHECKED = False
_TABLES_OK = False


@dataclass
class IntakeTurn:
    role: str                   # "user" | "bot"
    text: str
    payload: dict = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.utcnow)

    def to_dict(self) -> dict:
        ca = self.created_at
        return {
            "role": self.role,
            "text": self.text,
            "payload": self.payload,
            "created_at": ca.isoformat() if hasattr(ca, "isoformat") else str(ca),
        }


@dataclass
class IntakeSession:
    session_id: str
    portfolio: dict = field(default_factory=dict)
    scenario_notes: list[ScenarioNote] = field(default_factory=list)
    question_count: int = 0
    user_answer_count: int = 0   # v6: substantive user answers (≠ question_count)
    combined_streak: int = 0
    single_streak: int = 0
    preview_shown: bool = False
    turns: list[IntakeTurn] = field(default_factory=list)
    last_action: str = ""
    last_target_slots: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)


def _get_engine():
    try:
        from backend.connections.db import get_engine
        return get_engine()
    except Exception:
        return None


def _ensure_tables() -> bool:
    global _TABLES_CHECKED, _TABLES_OK
    if _TABLES_CHECKED:
        return _TABLES_OK
    _TABLES_CHECKED = True
    try:
        engine = _get_engine()
        if engine is None:
            return False
        from sqlalchemy import text
        with engine.connect() as conn:
            tables = {r[0] for r in conn.execute(
                text("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()")
            ).fetchall()}
        _TABLES_OK = "intake_sessions" in tables
        return _TABLES_OK
    except Exception as exc:
        _log.warning("intake_sessions table check failed: %s", exc)
        return False


def create_session() -> IntakeSession:
    return IntakeSession(session_id=str(uuid.uuid4()))


def load_session(session_id: str) -> IntakeSession:
    if _ensure_tables():
        try:
            engine = _get_engine()
            from sqlalchemy import text
            with engine.connect() as conn:
                row = conn.execute(
                    text("SELECT * FROM intake_sessions WHERE session_id = :sid"),
                    {"sid": session_id},
                ).mappings().fetchone()
            if row is None:
                raise ValueError(f"Session {session_id} not found")
            portfolio = json.loads(row["portfolio_json"] or "{}")
            notes_raw = json.loads(row["scenario_notes_json"] or "[]")
            turns_raw = json.loads(row["turns_json"] or "[]")
            return IntakeSession(
                session_id=row["session_id"],
                portfolio=portfolio,
                scenario_notes=[ScenarioNote.from_dict(n) for n in notes_raw],
                question_count=row["question_count"],
                combined_streak=row["combined_streak"],
                single_streak=row["single_streak"],
                preview_shown=bool(row["preview_shown"]),
                turns=[IntakeTurn(**t) for t in turns_raw],
                last_action=row["last_action"] or "",
                last_target_slots=json.loads(row["last_target_slots"] or "[]"),
                created_at=row["created_at"],
                updated_at=row["updated_at"],
            )
        except ValueError:
            raise
        except Exception as exc:
            _log.warning("load_session DB error, trying memory: %s", exc)

    raw = _MEMORY_STORE.get(session_id)
    if raw is None:
        raise ValueError(f"Session {session_id} not found")
    return _session_from_raw(raw)


def save_session(session: IntakeSession) -> None:
    session.updated_at = datetime.utcnow()
    portfolio_json = json.dumps(session.portfolio)
    notes_json = json.dumps([n.to_dict() for n in session.scenario_notes])
    turns_json = json.dumps([t.to_dict() for t in session.turns])
    last_target_json = json.dumps(session.last_target_slots)

    if _ensure_tables():
        try:
            engine = _get_engine()
            from sqlalchemy import text
            with engine.begin() as conn:
                conn.execute(text("""
                    INSERT INTO intake_sessions
                      (session_id, portfolio_json, scenario_notes_json, turns_json,
                       question_count, combined_streak, single_streak, preview_shown,
                       last_action, last_target_slots, created_at, updated_at)
                    VALUES
                      (:sid, :pj, :nj, :tj,
                       :qc, :cs, :ss, :ps,
                       :la, :lts, :ca, :ua)
                    ON DUPLICATE KEY UPDATE
                      portfolio_json = VALUES(portfolio_json),
                      scenario_notes_json = VALUES(scenario_notes_json),
                      turns_json = VALUES(turns_json),
                      question_count = VALUES(question_count),
                      combined_streak = VALUES(combined_streak),
                      single_streak = VALUES(single_streak),
                      preview_shown = VALUES(preview_shown),
                      last_action = VALUES(last_action),
                      last_target_slots = VALUES(last_target_slots),
                      updated_at = VALUES(updated_at)
                """), {
                    "sid": session.session_id,
                    "pj": portfolio_json,
                    "nj": notes_json,
                    "tj": turns_json,
                    "qc": session.question_count,
                    "cs": session.combined_streak,
                    "ss": session.single_streak,
                    "ps": int(session.preview_shown),
                    "la": session.last_action,
                    "lts": last_target_json,
                    "ca": session.created_at,
                    "ua": session.updated_at,
                })
            return
        except Exception as exc:
            _log.warning("save_session DB error, falling back to memory: %s", exc)

    _MEMORY_STORE[session.session_id] = _session_to_raw(session)


def _session_to_raw(s: IntakeSession) -> dict:
    return {
        "session_id": s.session_id,
        "portfolio": s.portfolio,
        "scenario_notes": [n.to_dict() for n in s.scenario_notes],
        "turns": [t.to_dict() for t in s.turns],
        "question_count": s.question_count,
        "combined_streak": s.combined_streak,
        "single_streak": s.single_streak,
        "preview_shown": s.preview_shown,
        "last_action": s.last_action,
        "last_target_slots": s.last_target_slots,
        "created_at": s.created_at.isoformat(),
        "updated_at": s.updated_at.isoformat(),
    }


def _session_from_raw(raw: dict) -> IntakeSession:
    return IntakeSession(
        session_id=raw["session_id"],
        portfolio=raw.get("portfolio") or {},
        scenario_notes=[ScenarioNote.from_dict(n) for n in (raw.get("scenario_notes") or [])],
        turns=[
            IntakeTurn(
                role=t["role"], text=t["text"], payload=t.get("payload") or {},
                created_at=(datetime.fromisoformat(t["created_at"]) if isinstance(t.get("created_at"), str) else (t.get("created_at") or datetime.utcnow())),
            )
            for t in (raw.get("turns") or [])
        ],
        question_count=raw.get("question_count", 0),
        combined_streak=raw.get("combined_streak", 0),
        single_streak=raw.get("single_streak", 0),
        preview_shown=bool(raw.get("preview_shown", False)),
        last_action=raw.get("last_action", ""),
        last_target_slots=raw.get("last_target_slots") or [],
        created_at=datetime.fromisoformat(raw["created_at"]) if raw.get("created_at") else datetime.utcnow(),
        updated_at=datetime.fromisoformat(raw["updated_at"]) if raw.get("updated_at") else datetime.utcnow(),
    )
