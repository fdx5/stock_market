"""Encrypted storage for the Naver blog login session.

Naver killed the official blog write API (openapi.naver.com/blog/writePost.json) on
2020-05-06 precisely to stop programmatic bulk posting, and nothing replaced it — the
2026 NAVER API HUB migration only carried the read-side search APIs across. So there is
no key/token to request: the only credential that can publish a post is a real logged-in
browser session, i.e. the NID_AUT / NID_SES / BUC cookies.

That makes this module the security-sensitive one in the feature. Three rules follow
from it:

1. The account password is never stored anywhere. A human types it once, in a real
   browser, in scripts/naver_login_setup.py. What comes back out is cookies.
2. Cookies are Fernet-encrypted with NAVER_SESSION_KEY before they touch the database,
   so a Turso dump (or the local SQLite fallback file) is not a login.
3. Nothing session-shaped is ever written into the repo. exports/ — which is where the
   earlier Playwright attempt left a full Chromium profile including Network/Cookies and
   "Login Data" — is now in .gitignore for the same reason.

The single-row table shape and the Turso-with-local-fallback connection handling are
lifted from kakao_token_store.py; see that module for why one process-wide connection is
reused. Like the Kakao refresh token, this row is seeded once from a local machine and
then read (and re-written, on every keep-alive) by the deployed service.
"""

import datetime as dt
import json
import logging
import os
from pathlib import Path

from app.services import libsql_gate, turso
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger(__name__)

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

# Fernet key (urlsafe base64, 32 bytes) used to encrypt the cookie blob. Generate with
# scripts/naver_login_setup.py --genkey, then set it BOTH in the local .env used to run
# that script and as a Render secret — the local machine writes the row, the deployed
# service reads it, and they have to agree.
#
# Unset means the feature is off, not that it degrades to plaintext: get() returns None
# and the publisher reports "not_configured", the same shape kakao_notify uses for a
# missing KAKAO_REST_API_KEY.
NAVER_SESSION_KEY = os.environ.get("NAVER_SESSION_KEY")

LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "naver_session.db"

_gate = libsql_gate.Gate("naver_session_store")
_conn = None

# Single row (id fixed at 1): this app publishes to exactly one blog
# (blog.naver.com/kospi-predictor) from one account, so there is one session to track.
_SCHEMA = """
CREATE TABLE IF NOT EXISTS naver_sessions (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    cookies_encrypted TEXT NOT NULL,
    blog_id TEXT NOT NULL,
    seeded_at TEXT NOT NULL,
    refreshed_at TEXT NOT NULL,
    last_ok_at TEXT
)
"""


def _connect():
    if TURSO_DATABASE_URL:
        return turso.connect(database=TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
    LOCAL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return turso.connect(database=str(LOCAL_DB_PATH))


def _new_ready_connection():
    conn = _connect()
    conn.execute(_SCHEMA)
    conn.commit()
    return conn


def _with_connection(fn):
    global _conn
    with _gate.hold():
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


def _fernet():
    """Returns a Fernet, or None when NAVER_SESSION_KEY is unset/invalid.

    Imported lazily so the rest of the backend still boots on a machine without the
    `cryptography` wheel — every other caller in this app treats a missing optional
    dependency as "feature off", not as a startup failure.
    """
    if not NAVER_SESSION_KEY:
        return None
    try:
        from cryptography.fernet import Fernet

        return Fernet(NAVER_SESSION_KEY.encode("utf-8"))
    except Exception:
        log.exception("NAVER_SESSION_KEY is set but unusable as a Fernet key")
        return None


def generate_key() -> str:
    """Convenience for the setup script: a fresh urlsafe-base64 Fernet key."""
    from cryptography.fernet import Fernet

    return Fernet.generate_key().decode("utf-8")


def is_configured() -> bool:
    return _fernet() is not None


def save(cookies: list[dict], blog_id: str, *, seeded: bool = False) -> None:
    """Encrypts and upserts the cookie list.

    `seeded=True` marks a fresh human login (scripts/naver_login_setup.py) and resets
    seeded_at. Every other call is a keep-alive or post-publish refresh: Naver rotates
    NID_SES as the session is used, so the newest cookie jar always overwrites the old
    one — dropping that rotation is one of the ways a session dies early.
    """
    fernet = _fernet()
    if fernet is None:
        raise RuntimeError("NAVER_SESSION_KEY is not set; refusing to store cookies in plaintext")

    blob = fernet.encrypt(json.dumps(cookies, ensure_ascii=False).encode("utf-8")).decode("utf-8")
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

    def _run(conn):
        if seeded:
            conn.execute(
                """
                INSERT INTO naver_sessions (id, cookies_encrypted, blog_id, seeded_at, refreshed_at, last_ok_at)
                VALUES (1, ?, ?, ?, ?, NULL)
                ON CONFLICT(id) DO UPDATE SET
                    cookies_encrypted = excluded.cookies_encrypted,
                    blog_id = excluded.blog_id,
                    seeded_at = excluded.seeded_at,
                    refreshed_at = excluded.refreshed_at,
                    last_ok_at = NULL
                """,
                (blob, blog_id, now, now),
            )
        else:
            conn.execute(
                """
                INSERT INTO naver_sessions (id, cookies_encrypted, blog_id, seeded_at, refreshed_at, last_ok_at)
                VALUES (1, ?, ?, ?, ?, NULL)
                ON CONFLICT(id) DO UPDATE SET
                    cookies_encrypted = excluded.cookies_encrypted,
                    blog_id = excluded.blog_id,
                    refreshed_at = excluded.refreshed_at
                """,
                (blob, blog_id, now, now),
            )
        conn.commit()

    _with_connection(_run)


def get() -> dict | None:
    """Returns {"cookies": [...], "blog_id": str, ...} or None.

    None covers every "cannot publish" case — no key, no row, or a blob this key cannot
    decrypt (which happens if NAVER_SESSION_KEY was rotated without re-seeding). The
    publisher treats all three the same way: don't attempt, tell the admin.
    """
    fernet = _fernet()
    if fernet is None:
        return None

    def _run(conn):
        return conn.execute(
            "SELECT cookies_encrypted, blog_id, seeded_at, refreshed_at, last_ok_at "
            "FROM naver_sessions WHERE id = 1"
        ).fetchone()

    row = _with_connection(_run)
    if row is None:
        return None

    blob, blog_id, seeded_at, refreshed_at, last_ok_at = row
    try:
        cookies = json.loads(fernet.decrypt(blob.encode("utf-8")).decode("utf-8"))
    except Exception:
        log.exception("stored Naver session could not be decrypted; re-seed required")
        return None

    return {
        "cookies": cookies,
        "blog_id": blog_id,
        "seeded_at": seeded_at,
        "refreshed_at": refreshed_at,
        "last_ok_at": last_ok_at,
    }


def mark_ok() -> None:
    """Records that the session successfully published. Read by the admin/status view
    to answer "when did this last actually work", which is the question that matters
    when deciding whether a re-seed is overdue."""
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

    def _run(conn):
        conn.execute("UPDATE naver_sessions SET last_ok_at = ? WHERE id = 1", (now,))
        conn.commit()

    _with_connection(_run)


def clear() -> None:
    def _run(conn):
        conn.execute("DELETE FROM naver_sessions WHERE id = 1")
        conn.commit()

    _with_connection(_run)
