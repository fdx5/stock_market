"""Persistent support messages; admission checks and insertion share one SQL statement."""
import os
from datetime import datetime, timezone
from pathlib import Path

from app.services import libsql_gate, turso

LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data/store/support_comments.db"
_gate = libsql_gate.Gate("support_comments")
_conn = None
_SCHEMA = """CREATE TABLE IF NOT EXISTS support_comments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 request_id TEXT NOT NULL UNIQUE,
 username TEXT NOT NULL,
 text TEXT NOT NULL,
 text_key TEXT NOT NULL,
 author_hash TEXT NOT NULL,
 posted_at INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 is_visible TEXT NOT NULL DEFAULT 'Y'
)"""


def _run(fn):
    global _conn
    with _gate.hold():
        if _conn is None:
            database = os.environ.get("TURSO_DATABASE_URL")
            if database:
                _conn = turso.connect(database=database, auth_token=os.environ.get("TURSO_AUTH_TOKEN"))
            else:
                LOCAL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
                _conn = turso.connect(database=str(LOCAL_DB_PATH))
            _conn.execute(_SCHEMA)
            _conn.execute("CREATE INDEX IF NOT EXISTS idx_support_author_time ON support_comments(author_hash, posted_at)")
            _conn.commit()
        try:
            return fn(_conn)
        except Exception:
            # Never retry a write with an unknown result. A browser retry uses request_id.
            _conn.close()
            _conn = None
            raise


def _public(row):
    return dict(zip(("id", "username", "text", "created_at", "is_visible"), row))


def list_comments(limit=30, before=None, visible_only=True):
    def query(conn):
        return conn.execute(
            "SELECT id, username, text, created_at, is_visible FROM support_comments "
            "WHERE is_visible != 'D' AND (? = 0 OR is_visible = 'Y') "
            "AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?",
            (int(visible_only), before, before, limit),
        ).fetchall()
    return [_public(row) for row in _run(query)]


def add_comment(request_id, username, text, text_key, author_hash, now):
    created_at = datetime.fromtimestamp(now, timezone.utc).isoformat()

    def insert(conn):
        existing = conn.execute(
            "SELECT id, username, text, created_at, is_visible FROM support_comments "
            "WHERE request_id = ? AND author_hash = ? AND username = ? AND text = ?",
            (request_id, author_hash, username, text),
        ).fetchone()
        if existing:
            return _public(existing) if existing[4] == 'Y' else None
        # Atomic on SQLite and remote Turso, including requests from different workers.
        row = conn.execute(
            "INSERT INTO support_comments (request_id, username, text, text_key, author_hash, posted_at, created_at) "
            "SELECT ?, ?, ?, ?, ?, ?, ? "
            "WHERE NOT EXISTS (SELECT 1 FROM support_comments WHERE request_id = ?) "
            "AND NOT EXISTS (SELECT 1 FROM support_comments WHERE author_hash = ? AND posted_at > ?) "
            "AND (SELECT COUNT(*) FROM support_comments WHERE author_hash = ? AND posted_at > ?) < 5 "
            "AND NOT EXISTS (SELECT 1 FROM support_comments WHERE author_hash = ? AND text_key = ? AND posted_at > ?) "
            "RETURNING id, username, text, created_at, is_visible",
            (request_id, username, text, text_key, author_hash, now, created_at, request_id,
             author_hash, now - 60, author_hash, now - 86400, author_hash, text_key, now - 86400),
        ).fetchone()
        conn.commit()
        return _public(row) if row else None
    return _run(insert)


def set_visibility(comment_id, visible):
    def update(conn):
        cursor = conn.execute("UPDATE support_comments SET is_visible = ? WHERE id = ? AND is_visible != 'D'", ('Y' if visible else 'N', comment_id))
        conn.commit()
        return cursor.rowcount > 0
    return _run(update)


def delete_comment(comment_id):
    # Preserve rate-limit history even after moderation removes a public message.
    def remove(conn):
        cursor = conn.execute("UPDATE support_comments SET is_visible = 'D', username = '', text = '' WHERE id = ? AND is_visible != 'D'", (comment_id,))
        conn.commit()
        return cursor.rowcount > 0
    return _run(remove)
