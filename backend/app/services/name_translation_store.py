import os
import threading
from pathlib import Path

import libsql
from dotenv import load_dotenv

load_dotenv()

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

# Falls back to a local libSQL (SQLite-compatible) file when no Turso credentials are
# configured, mirroring comment_store.py/visitor_store.py so translated names survive
# backend restarts instead of the in-memory cache resetting to empty every deploy.
LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "name_translations.db"

_lock = threading.Lock()
_conn = None

_SCHEMA = """
CREATE TABLE IF NOT EXISTS name_translations (
    korean_name TEXT PRIMARY KEY,
    english_name TEXT NOT NULL
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
    serialized behind `_lock` — see comment_store.py for why (concurrent open/close
    cycles raced against each other in the libsql client's stream handling)."""
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


def get_all() -> dict[str, str]:
    def _run(conn):
        return conn.execute("SELECT korean_name, english_name FROM name_translations").fetchall()

    rows = _with_connection(_run)
    return {korean: english for korean, english in rows}


def upsert_many(translations: dict[str, str]) -> None:
    """Called only with names not yet in the table (see universe.py's diff against
    get_all()), so a plain insert-or-replace per row is fine — this never runs against
    the full ~2,700-name universe after the first-ever boot, only the handful of newly
    listed names since the last rebuild."""
    if not translations:
        return

    def _run(conn):
        for korean, english in translations.items():
            conn.execute(
                "INSERT INTO name_translations (korean_name, english_name) VALUES (?, ?) "
                "ON CONFLICT(korean_name) DO UPDATE SET english_name = excluded.english_name",
                (korean, english),
            )
        conn.commit()

    _with_connection(_run)
