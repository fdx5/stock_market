"""급등·급락 이유 editions and their run log. Append-only.

One edition per slot (09:20 / 12:30 / 16:00 KST on trading days), written once:
INSERT ... ON CONFLICT DO NOTHING. Nothing here updates or deletes stored rows.
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
LOCAL_DB_PATH = Path(os.environ.get("MOVERS_LOCAL_DB") or Path(__file__).resolve().parent.parent / "data" / "store" / "movers.db")

_gate = libsql_gate.Gate("movers_store")
_conn = None

_SCHEMA = (
    """
CREATE TABLE IF NOT EXISTS movers_editions (
    slot TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    model TEXT,
    created_at TEXT NOT NULL
)
""",
    """
CREATE TABLE IF NOT EXISTS movers_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot TEXT NOT NULL,
    at TEXT NOT NULL,
    event TEXT NOT NULL,
    trigger TEXT,
    detail TEXT
)
""",
    "CREATE INDEX IF NOT EXISTS idx_movers_runs_slot ON movers_runs (slot, at)",
)


def _connect():
    if TURSO_DATABASE_URL and not os.environ.get("MOVERS_LOCAL_DB"):
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
    body = json.dumps(payload, ensure_ascii=False, allow_nan=False)

    def run(conn):
        cur = conn.execute(
            "INSERT INTO movers_editions (slot, payload, model, created_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(slot) DO NOTHING", (slot, body, model, created_at))
        conn.commit()
        return (cur.rowcount or 0) > 0
    stored = bool(_with_connection(run))
    if stored:
        try:  # IndexNow: Bing/Naver learn about the new edition right away.
            from app.services import indexnow
            path = indexnow.edition_path("movers", slot)
            if path:
                indexnow.notify([path, path.rsplit("/", 2)[0]])
        except Exception:
            pass
    return stored


def get_edition(slot: str) -> dict | None:
    row = _with_connection(lambda conn: conn.execute("SELECT payload FROM movers_editions WHERE slot = ?", (slot,)).fetchone())
    if not row:
        return None
    try:
        return json.loads(row[0])
    except (TypeError, ValueError):
        return None


def published_slots(through: str, limit: int) -> list[str]:
    rows = _with_connection(lambda conn: conn.execute(
        "SELECT slot FROM movers_editions WHERE slot <= ? ORDER BY slot DESC LIMIT ?", (through, limit)).fetchall())
    return [row[0] for row in rows]


def published_keys(market: str, limit: int) -> list[str]:
    """Stored keys for one market, newest first (revision rows "<key>~r1" included).

    published_slots("~", n) orders every "us:" key ahead of all KR keys, so once the
    US side holds n rows the KR editions drop out of it; this asks per market instead."""
    where = "slot >= 'us:'" if market == "us" else "slot < 'us:'"
    rows = _with_connection(lambda conn: conn.execute(
        f"SELECT slot FROM movers_editions WHERE {where} ORDER BY slot DESC LIMIT ?", (limit,)).fetchall())
    return [row[0] for row in rows]


def get_editions(keys: list[str]) -> dict[str, dict | None]:
    """Payloads for these keys in one read; a row whose payload does not parse maps to None."""
    if not keys:
        return {}
    marks = ", ".join("?" for _ in keys)
    rows = _with_connection(lambda conn: conn.execute(
        f"SELECT slot, payload FROM movers_editions WHERE slot IN ({marks})", tuple(keys)).fetchall())
    out: dict[str, dict | None] = {}
    for slot, payload in rows:
        try:
            value = json.loads(payload)
        except (TypeError, ValueError):
            value = None
        out[slot] = value if isinstance(value, dict) else None
    return out


def log_run(slot: str, at: str, event: str, trigger: str = "", detail: str = "") -> None:
    def run(conn):
        conn.execute("INSERT INTO movers_runs (slot, at, event, trigger, detail) VALUES (?, ?, ?, ?, ?)",
                     (slot, at, event, trigger, detail[:1000]))
        conn.commit()
    _with_connection(run)


def runs_for(slot: str) -> list[dict]:
    rows = _with_connection(lambda conn: conn.execute(
        "SELECT at, event, trigger, detail FROM movers_runs WHERE slot = ? ORDER BY at", (slot,)).fetchall())
    return [{"at": at, "event": event, "trigger": trigger, "detail": detail} for at, event, trigger, detail in rows]


def recent_runs(since: str, limit: int = 50) -> list[dict]:
    rows = _with_connection(lambda conn: conn.execute(
        "SELECT slot, at, event, trigger, detail FROM movers_runs WHERE at >= ? ORDER BY at DESC LIMIT ?", (since, limit)).fetchall())
    return [{"slot": s, "at": a, "event": e, "trigger": t, "detail": d} for s, a, e, t, d in rows]
