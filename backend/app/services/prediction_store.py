import os
import threading
from pathlib import Path

import libsql
from dotenv import load_dotenv

load_dotenv()

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

# Falls back to a local libSQL (SQLite-compatible) file when no Turso credentials are
# configured, so local dev works without an account. Set TURSO_DATABASE_URL /
# TURSO_AUTH_TOKEN (see .env.example) to persist through redeploys in production.
LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "predictions.db"

_lock = threading.Lock()
_schema_ready = False

_SCHEMA = """
CREATE TABLE IF NOT EXISTS predictions (
    code TEXT NOT NULL,
    date TEXT NOT NULL,
    name TEXT,
    direction TEXT NOT NULL,
    confidence TEXT,
    score REAL,
    last_close REAL,
    PRIMARY KEY (code, date)
)
"""


def _connect():
    if TURSO_DATABASE_URL:
        return libsql.connect(database=TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
    LOCAL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return libsql.connect(database=str(LOCAL_DB_PATH))


def _ensure_schema(conn) -> None:
    global _schema_ready
    if _schema_ready:
        return
    with _lock:
        conn.execute(_SCHEMA)
        conn.commit()
        _schema_ready = True


def _row_to_record(row: tuple) -> dict:
    code, date, name, direction, confidence, score, last_close = row
    return {
        "code": code,
        "date": date,
        "name": name,
        "direction": direction,
        "confidence": confidence,
        "score": score,
        "last_close": last_close,
    }


def get_predictions_for_date(date: str) -> dict[str, dict]:
    """code -> prediction record for the given date, for codes that have one."""
    conn = _connect()
    _ensure_schema(conn)
    rows = conn.execute(
        "SELECT code, date, name, direction, confidence, score, last_close "
        "FROM predictions WHERE date = ?",
        (date,),
    ).fetchall()
    conn.close()
    return {row[0]: _row_to_record(row) for row in rows}


def get_history_for_code(code: str) -> dict[str, dict]:
    """date -> prediction record for the given code, across all recorded days."""
    conn = _connect()
    _ensure_schema(conn)
    rows = conn.execute(
        "SELECT code, date, name, direction, confidence, score, last_close "
        "FROM predictions WHERE code = ?",
        (code,),
    ).fetchall()
    conn.close()
    return {row[1]: _row_to_record(row) for row in rows}


def save_predictions(date: str, predictions: dict[str, dict]) -> None:
    """Upsert {code: record} into the store under the given date."""
    conn = _connect()
    _ensure_schema(conn)
    for code, record in predictions.items():
        conn.execute(
            "INSERT INTO predictions (code, date, name, direction, confidence, score, last_close) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT (code, date) DO UPDATE SET "
            "name = excluded.name, direction = excluded.direction, confidence = excluded.confidence, "
            "score = excluded.score, last_close = excluded.last_close",
            (
                code,
                date,
                record.get("name"),
                record["direction"],
                record.get("confidence"),
                record.get("score"),
                record.get("last_close"),
            ),
        )
    conn.commit()
    conn.close()
