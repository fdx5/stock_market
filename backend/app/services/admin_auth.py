import hashlib
import os
import secrets
import threading
import time

from fastapi import Header, HTTPException

# Credentials are never stored in source as plaintext. The password is compared as a
# salted PBKDF2 hash so the source reveals nothing usable if it leaks. Deployments can
# override either the raw password (ADMIN_PASSWORD, hashed at startup) or supply their
# own precomputed hash (ADMIN_PASSWORD_HASH); the baked-in default hash below is only a
# fallback so the internal dashboard keeps working without env config.
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "fdx5")

_PASSWORD_SALT = os.environ.get("ADMIN_PASSWORD_SALT", "9f3c1a7e2b")
_PBKDF2_ITERATIONS = 200_000
_DEFAULT_PASSWORD_HASH = "01b168cbd08d19fbeb28999d128b3c684a510e26785d0ea8dd4456a9f747696e"


def _hash_password(password: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode(), _PASSWORD_SALT.encode(), _PBKDF2_ITERATIONS
    ).hex()


_env_password = os.environ.get("ADMIN_PASSWORD")
if _env_password:
    ADMIN_PASSWORD_HASH = _hash_password(_env_password)
else:
    ADMIN_PASSWORD_HASH = os.environ.get("ADMIN_PASSWORD_HASH", _DEFAULT_PASSWORD_HASH)

TOKEN_TTL_SECONDS = 12 * 60 * 60

MAX_LOGIN_ATTEMPTS = 5

# Single-process in-memory session store — same assumption visitor_tracker.py and
# cache.py's TTLCache already make about this app running as one instance. A
# restart just means the admin logs in again; not worth persisting for an
# internal tool with one fixed account.
_lock = threading.Lock()
_sessions: dict[str, float] = {}

# Counts consecutive failed login attempts against the single admin account. There is
# no TTL/auto-reset by design: once locked, the account stays locked until ADMIN_PASSWORD
# is changed, which on this single-process app requires an env var change plus a restart
# — and a restart is exactly what clears this counter.
_failed_login_count = 0


class AccountLockedError(Exception):
    """Raised when login is attempted after MAX_LOGIN_ATTEMPTS consecutive failures."""


def login(username: str, password: str) -> tuple[str, float] | None:
    global _failed_login_count
    with _lock:
        if _failed_login_count >= MAX_LOGIN_ATTEMPTS:
            raise AccountLockedError()

    if not (
        secrets.compare_digest(username, ADMIN_USERNAME)
        and secrets.compare_digest(_hash_password(password), ADMIN_PASSWORD_HASH)
    ):
        with _lock:
            _failed_login_count += 1
        return None

    token = secrets.token_urlsafe(32)
    expires_at = time.time() + TOKEN_TTL_SECONDS
    with _lock:
        _failed_login_count = 0
        _prune_locked()
        _sessions[token] = expires_at
    return token, expires_at


def _prune_locked() -> None:
    now = time.time()
    expired = [token for token, expires_at in _sessions.items() if expires_at <= now]
    for token in expired:
        del _sessions[token]


def _verify(token: str) -> bool:
    with _lock:
        expires_at = _sessions.get(token)
        if expires_at is None:
            return False
        if expires_at <= time.time():
            del _sessions[token]
            return False
        return True


def logout(token: str) -> None:
    with _lock:
        _sessions.pop(token, None)


def require_admin(authorization: str | None = Header(default=None)) -> None:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.removeprefix("Bearer ").strip()
    if not _verify(token):
        raise HTTPException(status_code=401, detail="Invalid or expired session")
