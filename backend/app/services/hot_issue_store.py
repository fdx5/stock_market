"""오늘의 핫이슈 editions and the writer's run log. Append-only.

An edition is written once per slot (07:00 / 13:00 / 22:00 KST) and never replaced:
INSERT ... ON CONFLICT DO NOTHING. The run log is a list of events (started,
published, failed, skipped) — rows are only ever added, so the admin page can show
every attempt. Nothing here updates or deletes stored rows.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from dotenv import load_dotenv

from app.services import libsql_gate, turso

load_dotenv()

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")
LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "hot_issues.db"

_gate = libsql_gate.Gate("hot_issue_store")
_conn = None

_SCHEMA = (
    """
CREATE TABLE IF NOT EXISTS hot_issue_editions (
    slot TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    model TEXT,
    created_at TEXT NOT NULL
)
""",
    """
CREATE TABLE IF NOT EXISTS hot_issue_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot TEXT NOT NULL,
    at TEXT NOT NULL,
    event TEXT NOT NULL,
    trigger TEXT,
    detail TEXT
)
""",
    "CREATE INDEX IF NOT EXISTS idx_hot_issue_runs_slot ON hot_issue_runs (slot, at)",
)


def _connect():
    if TURSO_DATABASE_URL:
        return turso.connect(database=TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
    LOCAL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return turso.connect(database=str(LOCAL_DB_PATH))


def _new_ready_connection():
    conn = _connect()
    for statement in _SCHEMA:
        conn.execute(statement)
    conn.commit()
    return conn


def _with_connection(fn):
    global _conn
    with _gate.hold():
        if _conn is None:
            _conn = _new_ready_connection()
        try:
            return fn(_conn)
        except Exception as exc:
            if not turso.should_retry(exc):
                raise
            try:
                _conn.close()
            except Exception:
                pass
            _conn = _new_ready_connection()
            return fn(_conn)


def save_edition(slot: str, payload: dict, model: str, created_at: str) -> bool:
    """True if this call stored the slot's edition; False if one already existed (kept as is)."""
    body = json.dumps(payload, ensure_ascii=False, allow_nan=False)

    def run(conn):
        cur = conn.execute(
            "INSERT INTO hot_issue_editions (slot, payload, model, created_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(slot) DO NOTHING", (slot, body, model, created_at))
        conn.commit()
        return (cur.rowcount or 0) > 0
    return bool(_with_connection(run))


def get_edition(slot: str) -> dict | None:
    row = _with_connection(lambda conn: conn.execute("SELECT payload FROM hot_issue_editions WHERE slot = ?", (slot,)).fetchone())
    if not row:
        return None
    try:
        return json.loads(row[0])
    except (TypeError, ValueError):
        return None


def log_run(slot: str, at: str, event: str, trigger: str = "", detail: str = "") -> None:
    def run(conn):
        conn.execute("INSERT INTO hot_issue_runs (slot, at, event, trigger, detail) VALUES (?, ?, ?, ?, ?)",
                     (slot, at, event, trigger, detail[:1000]))
        conn.commit()
    _with_connection(run)


def runs_for(slot: str) -> list[dict]:
    rows = _with_connection(lambda conn: conn.execute(
        "SELECT at, event, trigger, detail FROM hot_issue_runs WHERE slot = ? ORDER BY at", (slot,)).fetchall())
    return [{"at": at, "event": event, "trigger": trigger, "detail": detail} for at, event, trigger, detail in rows]


def recent_runs(since: str, limit: int = 200) -> list[dict]:
    rows = _with_connection(lambda conn: conn.execute(
        "SELECT slot, at, event, trigger, detail FROM hot_issue_runs WHERE at >= ? ORDER BY at DESC LIMIT ?", (since, limit)).fetchall())
    return [{"slot": slot, "at": at, "event": event, "trigger": trigger, "detail": detail} for slot, at, event, trigger, detail in rows]
