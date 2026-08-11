"""Where the mail transport's settings live, now that they live in a table.

They started in the environment, which is the ordinary place for a credential and was
right while there was one subscriber and one deploy. What broke that: on Render the
sending secrets are declared `sync: false`, meaning the file says only that they exist
and a human has to type the values into the dashboard. A value nobody typed reads as
"mail is not configured", which is indistinguishable from "mail is off on purpose" —
and that is exactly how a second subscriber's mail failed for a whole day. The Resend
key was set, the SMTP pair behind it was not, so the recipient restriction had nothing
to fall through to.

A row can be written from the admin panel by the person who is looking at the failure,
takes effect on the next send, and reports where it came from. That is the whole
argument for this module.

## Precedence: the table wins

`get` reads the table first and the environment second. DB-over-env rather than the
reverse because the table is the thing an operator can actually change — if the
environment won, a value typed into the panel would appear to save and then quietly do
nothing on a service that already had that variable set. The cost is that a stale row
shadows a corrected environment variable, so `describe` reports the source of every
setting and the panel shows it. Deleting the row (`clear`) hands the setting back to
the environment.

## These values are secrets

`PREDICTION_MAIL_RESEND_KEY` and `PREDICTION_MAIL_PASSWORD` are stored in the clear —
this is a table, not a vault, and anyone holding the Turso credentials can read them.
That is a real widening of the blast radius from "the deploy environment" to "the
deploy environment plus the database", accepted deliberately for the operability above.
What follows from it: nothing here ever returns a secret to a caller that did not
explicitly ask to send with it. `get` is for the SMTP/API call, `describe` is for
everything a person or a screen will read, and `describe` masks.
"""

import datetime as dt
import logging
import os
import time
from pathlib import Path

from dotenv import load_dotenv

from app.services import libsql_gate, turso

load_dotenv()

logger = logging.getLogger(__name__)

TURSO_DATABASE_URL = os.environ.get("TURSO_DATABASE_URL")
TURSO_AUTH_TOKEN = os.environ.get("TURSO_AUTH_TOKEN")

LOCAL_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "store" / "mail_config.db"

_gate = libsql_gate.Gate("mail_config_store")
_conn = None
_RECONNECT_ATTEMPTS = 3
_RECONNECT_DELAY_SECONDS = 1.0

_SCHEMA = """
CREATE TABLE IF NOT EXISTS mail_config (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
"""

# One Resend key per recipient, and the reason is a hard limit on the provider's side
# rather than a preference.
#
# Until a sending domain is verified, a Resend key delivers to exactly one address:
# the one its own account was registered with. Everything else comes back 403 naming
# that address. So a single key cannot serve two subscribers — swapping in a key
# registered to the second subscriber does not add them, it *replaces* the first, which
# is precisely what happened here: the naver address delivered and gmail was refused,
# then the gmail key was installed and the refusal changed sides.
#
# Verifying a domain removes the limit and makes this table unnecessary. Short of that,
# the only arrangement that reaches everyone is for each subscriber to receive through
# a key belonging to their own account — which is allowed, because each of them is then
# the account owner the restriction is written for. This table is that mapping.
_ACCOUNT_SCHEMA = """
CREATE TABLE IF NOT EXISTS mail_account_config (
    email TEXT PRIMARY KEY,
    resend_key TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
"""

# The settings this table is allowed to hold, named exactly as the environment names
# them. One vocabulary for both sources: a row and a variable that mean the same thing
# are spelled the same way, so `describe` can say "this one came from the table, that
# one from the environment" without translating between two sets of names.
KNOWN = (
    "PREDICTION_MAIL_RESEND_KEY",
    "PREDICTION_MAIL_FROM",
    "PREDICTION_MAIL_FROM_NAME",
    "PREDICTION_MAIL_SMTP_HOST",
    "PREDICTION_MAIL_SMTP_PORT",
    "PREDICTION_MAIL_USER",
    "PREDICTION_MAIL_PASSWORD",
)

# Masked by `describe` and never logged. The rest are addresses and hostnames — worth
# showing in full, because "is the sender what I think it is" is a question the panel
# has to be able to answer.
SECRETS = frozenset({"PREDICTION_MAIL_RESEND_KEY", "PREDICTION_MAIL_PASSWORD"})

# Reads happen once per mail, and a batch sends one per subscriber per stock. Without
# this every send would be a round trip to Turso for a value that changes a few times a
# year. Short enough that a value typed into the panel takes effect on the next send
# rather than after a restart, which is the property this module exists to provide.
_TTL_SECONDS = 30.0
_cache: dict[str, str] = {}
_cache_at = 0.0
_account_cache: dict[str, str] = {}
_account_cache_at = 0.0


class UnknownSetting(ValueError):
    """Raised rather than storing the row: a typo'd name would otherwise be written,
    reported back as saved, and never read by anything."""


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def _connect():
    if TURSO_DATABASE_URL:
        return turso.connect(database=TURSO_DATABASE_URL, auth_token=TURSO_AUTH_TOKEN)
    LOCAL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return turso.connect(database=str(LOCAL_DB_PATH))


def _new_ready_connection():
    conn = _connect()
    conn.execute(_SCHEMA)
    conn.execute(_ACCOUNT_SCHEMA)
    conn.commit()
    return conn


def _with_connection(fn):
    """Same reconnect-on-dead-socket pattern as the other stores here — see
    prediction_store for why one retry isn't enough against Turso's idle reclaim."""
    global _conn
    with _gate.hold():
        if _conn is None:
            _conn = _new_ready_connection()
        try:
            return fn(_conn)
        except Exception as first_exc:
            try:
                _conn.close()
            except Exception:
                pass
            last_exc = first_exc
            for attempt in range(_RECONNECT_ATTEMPTS):
                if attempt:
                    time.sleep(_RECONNECT_DELAY_SECONDS)
                try:
                    _conn = _new_ready_connection()
                    return fn(_conn)
                except Exception as exc:
                    logger.warning(
                        "mail_config_store: reconnect %d/%d failed (%s)",
                        attempt + 1,
                        _RECONNECT_ATTEMPTS,
                        exc,
                    )
                    last_exc = exc
                    try:
                        _conn.close()
                    except Exception:
                        pass
            raise last_exc


def _load() -> dict[str, str]:
    """Every row, cached for `_TTL_SECONDS`.

    All of them in one query rather than one query per setting: a single send reads
    four or five of these, and they are a handful of short rows.
    """
    global _cache, _cache_at
    if _cache_at and (time.monotonic() - _cache_at) < _TTL_SECONDS:
        return _cache

    def _run(conn):
        return conn.execute("SELECT name, value FROM mail_config").fetchall()

    try:
        rows = _with_connection(_run)
    except Exception as exc:  # noqa: BLE001
        # A settings table that cannot be reached must not take mail down with it: the
        # environment is still a complete source of configuration on its own, and this
        # module is an override on top of it. Cached (possibly empty) values are
        # returned so the caller falls back to the environment.
        logger.warning("mail_config_store: read failed, falling back to environment (%s)", exc)
        return _cache

    _cache = {r[0]: r[1] for r in rows if r[1]}
    _cache_at = time.monotonic()
    return _cache


def invalidate() -> None:
    """Drops the caches so the next read sees the tables. Called on every write here;
    exposed because a value changed directly in the database is otherwise invisible for
    up to `_TTL_SECONDS`."""
    global _cache_at, _account_cache_at
    _cache_at = 0.0
    _account_cache_at = 0.0


def _load_accounts() -> dict[str, str]:
    """{normalized email: resend key}, cached like `_load`."""
    global _account_cache, _account_cache_at
    if _account_cache_at and (time.monotonic() - _account_cache_at) < _TTL_SECONDS:
        return _account_cache

    def _run(conn):
        return conn.execute("SELECT email, resend_key FROM mail_account_config").fetchall()

    try:
        rows = _with_connection(_run)
    except Exception as exc:  # noqa: BLE001 - same reasoning as _load
        logger.warning("mail_config_store: 계정별 키 조회 실패 (%s)", exc)
        return _account_cache

    _account_cache = {r[0]: r[1] for r in rows if r[1]}
    _account_cache_at = time.monotonic()
    return _account_cache


def account_key(email: str | None) -> str | None:
    """The Resend key registered for one recipient, or None to use the shared one.

    Returns the key in the clear — it goes straight into an Authorization header.
    """
    if not email:
        return None
    return _load_accounts().get(email.strip().lower())


def set_account_key(email: str, key: str) -> dict:
    """Registers one recipient's own Resend key. Empty clears it."""
    addr = (email or "").strip().lower()
    if not addr:
        raise UnknownSetting("메일 주소가 비어 있습니다.")
    cleaned = (key or "").strip()
    if not cleaned:
        return clear_account_key(addr)

    def _run(conn):
        conn.execute(
            "INSERT INTO mail_account_config (email, resend_key, updated_at) "
            "VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET "
            "resend_key = excluded.resend_key, updated_at = excluded.updated_at",
            (addr, cleaned, _now()),
        )
        conn.commit()

    _with_connection(_run)
    invalidate()
    # Neither the address nor the key in the clear — the account handle is enough to
    # correlate this line with the panel row that caused it. Imported here rather than
    # at module scope because mail_subscription_store is a heavier module and this is
    # the only thing in here that needs it.
    from app.services import mail_subscription_store

    logger.info("mail_config_store: 계정 %s 전용 키 저장", mail_subscription_store.account_id(addr))
    return {"stored": True}


def clear_account_key(email: str) -> dict:
    addr = (email or "").strip().lower()

    def _run(conn):
        conn.execute("DELETE FROM mail_account_config WHERE email = ?", (addr,))
        conn.commit()

    _with_connection(_run)
    invalidate()
    return {"stored": False}


def account_keys_masked() -> dict[str, str]:
    """{normalized email: masked key} for the panel. Never the usable value."""
    return {addr: mask(key) or "" for addr, key in _load_accounts().items()}


def get(name: str, default: str | None = None) -> str | None:
    """The sending form: table, then environment, then `default`.

    Returns secrets in the clear — it is what the SMTP login and the Resend header are
    built from. Anything rendering to a person wants `describe`.
    """
    value = _load().get(name)
    if value:
        return value
    env_value = os.environ.get(name)
    if env_value:
        return env_value
    return default


def source(name: str) -> str | None:
    """Where `get` would find this setting: 'db', 'env', or None if nowhere."""
    if _load().get(name):
        return "db"
    if os.environ.get(name):
        return "env"
    return None


def mask(value: str | None) -> str | None:
    """`re_TzcCeTiX_LU16...` -> `re_…cR6`. Enough to tell two keys apart at a glance,
    never enough to use one."""
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:3]}…{value[-3:]}"


def set_value(name: str, value: str) -> dict:
    """Upserts one setting. An empty value is a `clear` — a blank box in the panel
    means "stop overriding this", not "override it with nothing", and storing an empty
    string would make `get` skip it anyway while still reporting source 'db'."""
    if name not in KNOWN:
        raise UnknownSetting(f"알 수 없는 설정 이름입니다: {name}")
    cleaned = (value or "").strip()
    if not cleaned:
        return clear(name)

    def _run(conn):
        conn.execute(
            "INSERT INTO mail_config (name, value, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(name) DO UPDATE SET value = excluded.value, "
            "updated_at = excluded.updated_at",
            (name, cleaned, _now()),
        )
        conn.commit()

    _with_connection(_run)
    invalidate()
    # The name, never the value — this line lands in the deploy log.
    logger.info("mail_config_store: %s 설정됨 (DB)", name)
    return {"name": name, "stored": True, "source": "db"}


def clear(name: str) -> dict:
    """Deletes the row, handing the setting back to the environment."""
    if name not in KNOWN:
        raise UnknownSetting(f"알 수 없는 설정 이름입니다: {name}")

    def _run(conn):
        conn.execute("DELETE FROM mail_config WHERE name = ?", (name,))
        conn.commit()

    _with_connection(_run)
    invalidate()
    logger.info("mail_config_store: %s 삭제됨 (환경변수로 복귀)", name)
    return {"name": name, "stored": False, "source": source(name)}


def describe() -> list[dict]:
    """Every known setting: where it comes from, and what it is with secrets masked.

    The reading form. Safe to return from an endpoint and to render in a browser.
    """
    out = []
    for name in KNOWN:
        value = get(name)
        out.append(
            {
                "name": name,
                "source": source(name),
                "configured": bool(value),
                "secret": name in SECRETS,
                "value": mask(value) if name in SECRETS else value,
            }
        )
    return out
