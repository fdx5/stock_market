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
_conn = None

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


def _new_ready_connection():
    conn = _connect()
    conn.execute(_SCHEMA)
    conn.commit()
    return conn


def _with_connection(fn):
    """Runs `fn(conn)` against a single lazily-created, process-wide connection,
    serialized behind `_lock` — opening a fresh remote Hrana connection per call was
    the previous approach, but concurrent open/close cycles from multiple request
    threads raced against each other in the libsql client's stream handling and
    surfaced as `stream not found` errors. Reusing one connection also skips the
    remote handshake on every comment fetch/post. If the connection turns out to be
    dead (e.g. Turso closed an idle stream server-side), drop it and retry once on a
    fresh one instead of failing the request."""
    global _conn
    with _lock:
        if _conn is None:
            _conn = _new_ready_connection()
        try:
            return fn(_conn)
        except Exception:
            try:
                _conn.close()
            except Exception:
                pass
            _conn = _new_ready_connection()
            return fn(_conn)


def _row_to_comment(row: tuple) -> dict:
    id_, side, username, text, created_at = row
    return {"id": id_, "side": side, "username": username, "text": text, "created_at": created_at}


def add_comment(side: str, username: str, text: str, created_at: str) -> dict:
    def _run(conn):
        cursor = conn.execute(
            "INSERT INTO battle_comments (side, username, text, created_at) VALUES (?, ?, ?, ?)",
            (side, username, text, created_at),
        )
        conn.commit()
        return cursor.lastrowid

    new_id = _with_connection(_run)
    return {"id": new_id, "side": side, "username": username, "text": text, "created_at": created_at}


def list_comments(limit: int = 200) -> list[dict]:
    """Newest first."""

    def _run(conn):
        return conn.execute(
            "SELECT id, side, username, text, created_at FROM battle_comments "
            "ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()

    rows = _with_connection(_run)
    return [_row_to_comment(row) for row in rows]


def count_by_side() -> dict[str, int]:
    def _run(conn):
        return conn.execute("SELECT side, COUNT(*) FROM battle_comments GROUP BY side").fetchall()

    rows = _with_connection(_run)
    counts = {"samsung": 0, "skhynix": 0}
    for side, count in rows:
        if side in counts:
            counts[side] = count
    return counts
