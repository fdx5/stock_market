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
    created_at TEXT NOT NULL,
    is_visible TEXT NOT NULL DEFAULT 'Y'
)
"""


def _connect():
    if TURSO_DATABASE_URL:
        return libsql.connect(database=TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
    LOCAL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return libsql.connect(database=str(LOCAL_DB_PATH))


def _ensure_is_visible_column(conn):
    """Backfills `is_visible` on tables created before this column existed — ADD
    COLUMN ... DEFAULT 'Y' both sets the default for future inserts and retroactively
    fills every pre-existing row with 'Y' in one statement, so old comments stay
    displayed rather than silently vanishing behind the new visibility filter."""
    cols = [row[1] for row in conn.execute("PRAGMA table_info(battle_comments)").fetchall()]
    if "is_visible" not in cols:
        conn.execute("ALTER TABLE battle_comments ADD COLUMN is_visible TEXT NOT NULL DEFAULT 'Y'")
        conn.commit()


def _new_ready_connection():
    conn = _connect()
    conn.execute(_SCHEMA)
    conn.commit()
    _ensure_is_visible_column(conn)
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
    id_, side, username, text, created_at, is_visible = row
    return {
        "id": id_,
        "side": side,
        "username": username,
        "text": text,
        "created_at": created_at,
        "is_visible": is_visible,
    }


def add_comment(side: str, username: str, text: str, created_at: str) -> dict:
    def _run(conn):
        cursor = conn.execute(
            "INSERT INTO battle_comments (side, username, text, created_at, is_visible) "
            "VALUES (?, ?, ?, ?, 'Y')",
            (side, username, text, created_at),
        )
        conn.commit()
        return cursor.lastrowid

    new_id = _with_connection(_run)
    return {
        "id": new_id,
        "side": side,
        "username": username,
        "text": text,
        "created_at": created_at,
        "is_visible": "Y",
    }


def list_comments(limit: int = 200, visible_only: bool = True) -> list[dict]:
    """Newest first. `visible_only` (default True) restricts to comments the admin
    hasn't hidden — every public-facing caller relies on this default. The admin
    moderation panel passes False to see hidden ('N') comments too."""

    def _run(conn):
        if visible_only:
            return conn.execute(
                "SELECT id, side, username, text, created_at, is_visible FROM battle_comments "
                "WHERE is_visible = 'Y' ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return conn.execute(
            "SELECT id, side, username, text, created_at, is_visible FROM battle_comments "
            "ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()

    rows = _with_connection(_run)
    return [_row_to_comment(row) for row in rows]


def delete_comment(comment_id: int) -> bool:
    def _run(conn):
        cursor = conn.execute("DELETE FROM battle_comments WHERE id = ?", (comment_id,))
        conn.commit()
        return cursor.rowcount or 0

    return _with_connection(_run) > 0


def set_visibility(comment_id: int, visible: bool) -> bool:
    def _run(conn):
        cursor = conn.execute(
            "UPDATE battle_comments SET is_visible = ? WHERE id = ?",
            ("Y" if visible else "N", comment_id),
        )
        conn.commit()
        return cursor.rowcount or 0

    return _with_connection(_run) > 0


def count_by_side() -> dict[str, int]:
    def _run(conn):
        return conn.execute(
            "SELECT side, COUNT(*) FROM battle_comments WHERE is_visible = 'Y' GROUP BY side"
        ).fetchall()

    rows = _with_connection(_run)
    counts = {"samsung": 0, "skhynix": 0}
    for side, count in rows:
        if side in counts:
            counts[side] = count
    return counts
