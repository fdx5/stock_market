import os
import threading
from pathlib import Path

import libsql
from dotenv import load_dotenv

load_dotenv()

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

# Falls back to a local libSQL (SQLite-compatible) file when no Turso credentials are
# configured, so local dev works without an account.
LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "comments.db"

_lock = threading.Lock()
_schema_ready = False

_SCHEMA = """
CREATE TABLE IF NOT EXISTS battle_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    side TEXT NOT NULL,
    username TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
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


def _row_to_comment(row: tuple) -> dict:
    id_, side, username, text, created_at = row
    return {"id": id_, "side": side, "username": username, "text": text, "created_at": created_at}


def add_comment(side: str, username: str, text: str, created_at: str) -> dict:
    conn = _connect()
    _ensure_schema(conn)
    cursor = conn.execute(
        "INSERT INTO battle_comments (side, username, text, created_at) VALUES (?, ?, ?, ?)",
        (side, username, text, created_at),
    )
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    return {"id": new_id, "side": side, "username": username, "text": text, "created_at": created_at}


def list_comments(limit: int = 200) -> list[dict]:
    """Newest first."""
    conn = _connect()
    _ensure_schema(conn)
    rows = conn.execute(
        "SELECT id, side, username, text, created_at FROM battle_comments "
        "ORDER BY id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    conn.close()
    return [_row_to_comment(row) for row in rows]


def count_by_side() -> dict[str, int]:
    conn = _connect()
    _ensure_schema(conn)
    rows = conn.execute("SELECT side, COUNT(*) FROM battle_comments GROUP BY side").fetchall()
    conn.close()
    counts = {"samsung": 0, "skhynix": 0}
    for side, count in rows:
        if side in counts:
            counts[side] = count
    return counts
