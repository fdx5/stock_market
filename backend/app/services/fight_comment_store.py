import os
import threading
from pathlib import Path

import libsql
from dotenv import load_dotenv

load_dotenv()

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

# Same Turso DB as comment_store.py, just a different table — falls back to a local
# libSQL file when no Turso credentials are configured, so local dev works without an
# account.
LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "fight_comments.db"

_lock = threading.Lock()
_conn = None

_SCHEMA = """
CREATE TABLE IF NOT EXISTS fight_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_code TEXT NOT NULL,
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
    """Same backfill approach as comment_store.py: ADD COLUMN ... DEFAULT 'Y' sets
    the default and retroactively fills every pre-existing row with 'Y' in one
    statement, so comments created before this column existed stay displayed."""
    cols = [row[1] for row in conn.execute("PRAGMA table_info(fight_comments)").fetchall()]
    if "is_visible" not in cols:
        conn.execute("ALTER TABLE fight_comments ADD COLUMN is_visible TEXT NOT NULL DEFAULT 'Y'")
        conn.commit()


def _new_ready_connection():
    conn = _connect()
    conn.execute(_SCHEMA)
    conn.commit()
    _ensure_is_visible_column(conn)
    return conn


def _with_connection(fn):
    """Same reuse-one-connection-with-retry-once approach as comment_store.py: opening
    a fresh remote Hrana connection per call let concurrent request threads race each
    other in the libsql client's stream handling (`stream not found`), so this keeps a
    single lazily-created, process-wide connection behind `_lock` instead."""
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
    id_, company_code, username, text, created_at, is_visible = row
    return {
        "id": id_,
        "company_code": company_code,
        "username": username,
        "text": text,
        "created_at": created_at,
        "is_visible": is_visible,
    }


def add_comment(company_code: str, username: str, text: str, created_at: str) -> dict:
    def _run(conn):
        cursor = conn.execute(
            "INSERT INTO fight_comments (company_code, username, text, created_at, is_visible) "
            "VALUES (?, ?, ?, ?, 'Y')",
            (company_code, username, text, created_at),
        )
        conn.commit()
        return cursor.lastrowid

    new_id = _with_connection(_run)
    return {
        "id": new_id,
        "company_code": company_code,
        "username": username,
        "text": text,
        "created_at": created_at,
        "is_visible": "Y",
    }


def list_comments_for_pair(code_a: str, code_b: str, limit: int = 200, visible_only: bool = True) -> list[dict]:
    """Comments are stored per company, not per matchup — this merges the two
    companies' comment pools and returns them newest-first, so whichever pairing the
    user picks always shows that pairing's combined, up-to-date discussion.
    `visible_only` (default True) hides admin-moderated ('N') comments; the public
    /fight page relies on this default."""

    def _run(conn):
        if visible_only:
            return conn.execute(
                "SELECT id, company_code, username, text, created_at, is_visible FROM fight_comments "
                "WHERE company_code IN (?, ?) AND is_visible = 'Y' ORDER BY id DESC LIMIT ?",
                (code_a, code_b, limit),
            ).fetchall()
        return conn.execute(
            "SELECT id, company_code, username, text, created_at, is_visible FROM fight_comments "
            "WHERE company_code IN (?, ?) ORDER BY id DESC LIMIT ?",
            (code_a, code_b, limit),
        ).fetchall()

    rows = _with_connection(_run)
    return [_row_to_comment(row) for row in rows]


def list_comments_for_company(code: str, limit: int = 200, visible_only: bool = True) -> list[dict]:
    """Same shape as list_comments_for_pair but scoped to one company — backs the
    global (S&P500/Nasdaq100) stock detail page's discussion board, which has no
    "vs" pairing concept."""

    def _run(conn):
        if visible_only:
            return conn.execute(
                "SELECT id, company_code, username, text, created_at, is_visible FROM fight_comments "
                "WHERE company_code = ? AND is_visible = 'Y' ORDER BY id DESC LIMIT ?",
                (code, limit),
            ).fetchall()
        return conn.execute(
            "SELECT id, company_code, username, text, created_at, is_visible FROM fight_comments "
            "WHERE company_code = ? ORDER BY id DESC LIMIT ?",
            (code, limit),
        ).fetchall()

    rows = _with_connection(_run)
    return [_row_to_comment(row) for row in rows]


def list_all_comments(limit: int = 500) -> list[dict]:
    """All fight comments across every matchup, newest first, regardless of
    visibility — unlike list_comments_for_pair (scoped to one matchup, visible-only
    by default), this backs the admin moderation panel which needs to see and
    moderate every comment including ones already hidden."""

    def _run(conn):
        return conn.execute(
            "SELECT id, company_code, username, text, created_at, is_visible FROM fight_comments "
            "ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()

    rows = _with_connection(_run)
    return [_row_to_comment(row) for row in rows]


def delete_comment(comment_id: int) -> bool:
    def _run(conn):
        cursor = conn.execute("DELETE FROM fight_comments WHERE id = ?", (comment_id,))
        conn.commit()
        return cursor.rowcount or 0

    return _with_connection(_run) > 0


def set_visibility(comment_id: int, visible: bool) -> bool:
    def _run(conn):
        cursor = conn.execute(
            "UPDATE fight_comments SET is_visible = ? WHERE id = ?",
            ("Y" if visible else "N", comment_id),
        )
        conn.commit()
        return cursor.rowcount or 0

    return _with_connection(_run) > 0


def count_by_company(code_a: str, code_b: str) -> dict[str, int]:
    def _run(conn):
        return conn.execute(
            "SELECT company_code, COUNT(*) FROM fight_comments "
            "WHERE company_code IN (?, ?) AND is_visible = 'Y' GROUP BY company_code",
            (code_a, code_b),
        ).fetchall()

    rows = _with_connection(_run)
    counts = {code_a: 0, code_b: 0}
    for company_code, count in rows:
        if company_code in counts:
            counts[company_code] = count
    return counts
