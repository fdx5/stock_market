import os
import threading
from pathlib import Path

import libsql
from dotenv import load_dotenv

load_dotenv()

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

# Same Turso-with-local-fallback shape as visitor_store.py / page_view_store.py, so the
# Kakao refresh token (which Kakao periodically rotates — see kakao_notify.py) survives
# backend restarts and redeploys instead of falling back to the stale value baked into
# KAKAO_REFRESH_TOKEN at deploy time.
LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "kakao_tokens.db"

_lock = threading.Lock()
_conn = None

# Single row (id fixed at 1): this app only ever sends "나에게 보내기" notifications to
# one Kakao account (the site admin's), so there is exactly one token to track — not a
# per-user table.
_SCHEMA = """
CREATE TABLE IF NOT EXISTS kakao_tokens (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    access_expires_at TEXT NOT NULL,
    refresh_expires_at TEXT,
    updated_at TEXT NOT NULL
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
    """Same retry-once-on-a-fresh-connection shape as visitor_store.py — see that
    module's docstring for why a single process-wide connection is reused here."""
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


def get() -> dict | None:
    def _run(conn):
        row = conn.execute(
            "SELECT access_token, refresh_token, access_expires_at, refresh_expires_at "
            "FROM kakao_tokens WHERE id = 1"
        ).fetchone()
        return row

    row = _with_connection(_run)
    if row is None:
        return None
    access_token, refresh_token, access_expires_at, refresh_expires_at = row
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "access_expires_at": access_expires_at,
        "refresh_expires_at": refresh_expires_at,
    }


def save(
    access_token: str,
    refresh_token: str,
    access_expires_at: str,
    refresh_expires_at: str | None,
    updated_at: str,
) -> None:
    """Upserts the single token row. Called both after the initial one-time OAuth
    exchange (see scripts/kakao_get_refresh_token.py) and after every in-process
    refresh (see kakao_notify.py) — Kakao sometimes rotates the refresh_token on
    refresh, so this always overwrites it rather than only updating access_token."""

    def _run(conn):
        conn.execute(
            """
            INSERT INTO kakao_tokens (id, access_token, refresh_token, access_expires_at, refresh_expires_at, updated_at)
            VALUES (1, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                access_token = excluded.access_token,
                refresh_token = excluded.refresh_token,
                access_expires_at = excluded.access_expires_at,
                refresh_expires_at = excluded.refresh_expires_at,
                updated_at = excluded.updated_at
            """,
            (access_token, refresh_token, access_expires_at, refresh_expires_at, updated_at),
        )
        conn.commit()

    _with_connection(_run)
