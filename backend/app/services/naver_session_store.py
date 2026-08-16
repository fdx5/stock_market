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

import base64
import datetime as dt
import hashlib
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

# OPTIONAL. Leave it unset and the key is derived from TURSO_AUTH_TOKEN instead (see
# _derived_key) — that is the intended setup, because it means nothing extra has to be
# configured on Render and nothing can fall out of sync with the local .env.
#
# Set it only to encrypt the session under a secret the database credentials cannot
# reach. If you do, it must match on every machine that reads or writes the session.
#
# With neither this nor TURSO_AUTH_TOKEN available the feature is off, not degraded to
# plaintext: get() returns None and the publisher reports "not_configured", the same
# shape kakao_notify uses for a missing KAKAO_REST_API_KEY.
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
    key_fingerprint TEXT,
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
    # Added after the table shipped; ALTER is the migration for a single-row table.
    try:
        conn.execute("ALTER TABLE naver_sessions ADD COLUMN key_fingerprint TEXT")
    except Exception:
        pass
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


def _derived_key() -> bytes | None:
    """Encryption key derived from TURSO_AUTH_TOKEN, so no new secret has to be set.

    Setting a separate NAVER_SESSION_KEY in the Render dashboard was one more manual
    step that had to be kept in sync with the local .env, and forgetting it silently
    disabled publishing. Deriving instead means the deployed service and the machine
    that seeds the session agree automatically, because they already share the Turso
    credentials — the same ones that reach the database holding the ciphertext.

    Deriving rather than storing also keeps the key out of the database: a dump of the
    briefs DB still does not yield a login.

    PBKDF2 with a fixed salt is appropriate here. The input is a high-entropy API token,
    not a human password, so the salt is only domain separation — it stops this key from
    colliding with anything else derived from the same token.

    Consequence to know about: rotating TURSO_AUTH_TOKEN invalidates the stored session.
    get() already treats an undecryptable blob as "no session" and the publisher alerts
    for a re-seed, so that degrades to the same one-minute recovery as an expired login.
    """
    if not TURSO_AUTH_TOKEN:
        return None
    digest = hashlib.pbkdf2_hmac(
        "sha256", TURSO_AUTH_TOKEN.encode("utf-8"), b"naver-session-store/v1", 200_000, dklen=32
    )
    return base64.urlsafe_b64encode(digest)


def _fernet():
    """Returns a Fernet, or None when no key material is available.

    NAVER_SESSION_KEY still wins when set — an explicit key remains supported for anyone
    who wants the session encrypted under a secret the database credentials cannot
    reach. Otherwise the key is derived (see _derived_key).

    Imported lazily so the rest of the backend still boots on a machine without the
    `cryptography` wheel — every other caller in this app treats a missing optional
    dependency as "feature off", not as a startup failure.
    """
    key = NAVER_SESSION_KEY.encode("utf-8") if NAVER_SESSION_KEY else _derived_key()
    if not key:
        return None
    try:
        from cryptography.fernet import Fernet

        return Fernet(key)
    except Exception:
        log.exception("Naver session key is present but unusable as a Fernet key")
        return None


def key_fingerprint() -> str | None:
    """Short, non-reversible id for the key currently in play.

    Stored alongside the session so a later read can tell "encrypted under a different
    key" apart from "no session at all". Those two look identical otherwise — decryption
    just fails — and they need opposite responses: a key mismatch means the deriving
    secret changed (TURSO_AUTH_TOKEN rotated, or the deployed service holds a different
    token for the same database), while a missing session means nobody has logged in yet.

    A truncated SHA-256 of the key, so the value is safe to log and to return from the
    admin status endpoint.
    """
    key = NAVER_SESSION_KEY.encode("utf-8") if NAVER_SESSION_KEY else _derived_key()
    if not key:
        return None
    return hashlib.sha256(key).hexdigest()[:16]


def key_source() -> str:
    """Which key is in play — for the setup script's diagnostics."""
    if NAVER_SESSION_KEY:
        return "NAVER_SESSION_KEY"
    if TURSO_AUTH_TOKEN:
        return "derived from TURSO_AUTH_TOKEN"
    return "none"


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
    fingerprint = key_fingerprint()
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

    def _run(conn):
        if seeded:
            conn.execute(
                """
                INSERT INTO naver_sessions
                    (id, cookies_encrypted, blog_id, key_fingerprint, seeded_at, refreshed_at, last_ok_at)
                VALUES (1, ?, ?, ?, ?, ?, NULL)
                ON CONFLICT(id) DO UPDATE SET
                    cookies_encrypted = excluded.cookies_encrypted,
                    blog_id = excluded.blog_id,
                    key_fingerprint = excluded.key_fingerprint,
                    seeded_at = excluded.seeded_at,
                    refreshed_at = excluded.refreshed_at,
                    last_ok_at = NULL
                """,
                (blob, blog_id, fingerprint, now, now),
            )
        else:
            conn.execute(
                """
                INSERT INTO naver_sessions
                    (id, cookies_encrypted, blog_id, key_fingerprint, seeded_at, refreshed_at, last_ok_at)
                VALUES (1, ?, ?, ?, ?, ?, NULL)
                ON CONFLICT(id) DO UPDATE SET
                    cookies_encrypted = excluded.cookies_encrypted,
                    blog_id = excluded.blog_id,
                    key_fingerprint = excluded.key_fingerprint,
                    refreshed_at = excluded.refreshed_at
                """,
                (blob, blog_id, fingerprint, now, now),
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
            "SELECT cookies_encrypted, blog_id, seeded_at, refreshed_at, last_ok_at, key_fingerprint "
            "FROM naver_sessions WHERE id = 1"
        ).fetchone()

    row = _with_connection(_run)
    if row is None:
        return None

    blob, blog_id, seeded_at, refreshed_at, last_ok_at, stored_fp = row
    try:
        cookies = json.loads(fernet.decrypt(blob.encode("utf-8")).decode("utf-8"))
    except Exception:
        current_fp = key_fingerprint()
        if stored_fp and current_fp and stored_fp != current_fp:
            # The distinction that matters: this is not a missing login, it is the same
            # login encrypted under a key this process cannot reproduce — TURSO_AUTH_TOKEN
            # differs from the one used to seed it. Re-running the login script fixes it,
            # but so does pointing this process at the original token.
            log.error(
                "Naver session was encrypted under a different key (stored %s, current %s). "
                "TURSO_AUTH_TOKEN does not match the machine that seeded the session.",
                stored_fp, current_fp,
            )
        else:
            log.exception("stored Naver session could not be decrypted; re-seed required")
        return None

    return {
        "cookies": cookies,
        "blog_id": blog_id,
        "seeded_at": seeded_at,
        "refreshed_at": refreshed_at,
        "last_ok_at": last_ok_at,
    }


def stored_key_fingerprint() -> str | None:
    """The fingerprint recorded when the session was written, read without decrypting.

    Comparable against key_fingerprint() to tell a key mismatch apart from a missing
    session — the one diagnosis that cannot be made from a failed decryption alone.
    """
    def _run(conn):
        return conn.execute("SELECT key_fingerprint FROM naver_sessions WHERE id = 1").fetchone()

    row = _with_connection(_run)
    return row[0] if row else None


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
