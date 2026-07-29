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

# The neuron monitor's own passcode, so the page can be opened from outside without
# handing out the admin account. Its own salt, not ADMIN_PASSWORD_SALT: a deployment
# that rotates the admin salt would otherwise silently invalidate the baked-in passcode
# hash below as a side effect. Same PBKDF2 treatment — the passcode never appears in
# source as plaintext, and MONITOR_PASSCODE / MONITOR_PASSCODE_HASH override it.
_MONITOR_SALT = os.environ.get("MONITOR_PASSCODE_SALT", "5c2e91af73")
_DEFAULT_MONITOR_HASH = "cc4899c24d5c923730fa5a93fecba34cc6137e39c131f998aa3e2be736338205"


def _hash(value: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", value.encode(), salt.encode(), _PBKDF2_ITERATIONS).hex()


def _hash_password(password: str) -> str:
    return _hash(password, _PASSWORD_SALT)


def _hash_passcode(passcode: str) -> str:
    return _hash(passcode, _MONITOR_SALT)


_env_password = os.environ.get("ADMIN_PASSWORD")
if _env_password:
    ADMIN_PASSWORD_HASH = _hash_password(_env_password)
else:
    ADMIN_PASSWORD_HASH = os.environ.get("ADMIN_PASSWORD_HASH", _DEFAULT_PASSWORD_HASH)

_env_passcode = os.environ.get("MONITOR_PASSCODE")
if _env_passcode:
    MONITOR_PASSCODE_HASH = _hash_passcode(_env_passcode)
else:
    MONITOR_PASSCODE_HASH = os.environ.get("MONITOR_PASSCODE_HASH", _DEFAULT_MONITOR_HASH)

TOKEN_TTL_SECONDS = 12 * 60 * 60

# Shorter than an admin session on purpose: this one is handed out on a passcode alone,
# to someone who may be on a device the admin does not control.
MONITOR_TOKEN_TTL_SECONDS = 6 * 60 * 60

MAX_LOGIN_ATTEMPTS = 5

# Sessions are scoped, because the two doors are not the same door: "admin" is the full
# dashboard, "monitor" is the neuron view and nothing else. A monitor token presented to
# an admin endpoint is simply not a session there.
SCOPE_ADMIN = "admin"
SCOPE_MONITOR = "monitor"

# Single-process in-memory session store — same assumption visitor_tracker.py and
# cache.py's TTLCache already make about this app running as one instance. A
# restart just means the admin logs in again; not worth persisting for an
# internal tool with one fixed account.
_lock = threading.Lock()
_sessions: dict[str, tuple[float, str]] = {}

# Counts consecutive failed login attempts against the single admin account. There is
# no TTL/auto-reset by design: once locked, the account stays locked until ADMIN_PASSWORD
# is changed, which on this single-process app requires an env var change plus a restart
# — and a restart is exactly what clears this counter.
_failed_login_count = 0

# The monitor passcode is deliberately *not* locked the same way. Its door is meant to be
# opened from outside, so a permanent lock after N failures would let any passer-by take
# the monitor offline for everyone by guessing wrong a few times. Instead each client is
# throttled on its own sliding window: wrong guesses cost that client its next few
# minutes and cost everyone else nothing.
MONITOR_MAX_ATTEMPTS = 8
MONITOR_ATTEMPT_WINDOW_SECONDS = 10 * 60
_monitor_failures: dict[str, list[float]] = {}


class AccountLockedError(Exception):
    """Raised when login is attempted after MAX_LOGIN_ATTEMPTS consecutive failures."""


class TooManyAttemptsError(Exception):
    """Raised when one client has burned its monitor passcode attempts for now.

    Carries the seconds until its window frees up, so the caller can say when to retry
    rather than leaving the visitor to guess.
    """

    def __init__(self, retry_after: int) -> None:
        super().__init__(f"retry after {retry_after}s")
        self.retry_after = retry_after


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

    with _lock:
        _failed_login_count = 0
    return _issue(SCOPE_ADMIN, TOKEN_TTL_SECONDS)


def unlock_monitor(passcode: str, client: str) -> tuple[str, float] | None:
    """Trades the monitor passcode for a monitor-scoped session. `client` is whatever
    identifies the caller (its IP); it only scopes the throttle, never the session."""
    now = time.time()
    with _lock:
        recent = [t for t in _monitor_failures.get(client, []) if now - t < MONITOR_ATTEMPT_WINDOW_SECONDS]
        if recent:
            _monitor_failures[client] = recent
        else:
            _monitor_failures.pop(client, None)
        if len(recent) >= MONITOR_MAX_ATTEMPTS:
            oldest = min(recent)
            raise TooManyAttemptsError(int(MONITOR_ATTEMPT_WINDOW_SECONDS - (now - oldest)) + 1)

    if not secrets.compare_digest(_hash_passcode(passcode), MONITOR_PASSCODE_HASH):
        with _lock:
            _monitor_failures.setdefault(client, []).append(now)
        return None

    with _lock:
        _monitor_failures.pop(client, None)
    return _issue(SCOPE_MONITOR, MONITOR_TOKEN_TTL_SECONDS)


def _issue(scope: str, ttl: float) -> tuple[str, float]:
    token = secrets.token_urlsafe(32)
    expires_at = time.time() + ttl
    with _lock:
        _prune_locked()
        _sessions[token] = (expires_at, scope)
    return token, expires_at


def _prune_locked() -> None:
    now = time.time()
    expired = [token for token, (expires_at, _) in _sessions.items() if expires_at <= now]
    for token in expired:
        del _sessions[token]


def _verify(token: str, scopes: tuple[str, ...]) -> bool:
    with _lock:
        session = _sessions.get(token)
        if session is None:
            return False
        expires_at, scope = session
        if expires_at <= time.time():
            del _sessions[token]
            return False
        return scope in scopes


def logout(token: str) -> None:
    with _lock:
        _sessions.pop(token, None)


def _require(authorization: str | None, scopes: tuple[str, ...]) -> None:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.removeprefix("Bearer ").strip()
    if not _verify(token, scopes):
        raise HTTPException(status_code=401, detail="Invalid or expired session")


def require_admin(authorization: str | None = Header(default=None)) -> None:
    _require(authorization, (SCOPE_ADMIN,))


def require_monitor(authorization: str | None = Header(default=None)) -> None:
    """The neuron view's door: a passcode session opens it, and an admin session — which
    is strictly more than the passcode buys — opens it without a second prompt."""
    _require(authorization, (SCOPE_ADMIN, SCOPE_MONITOR))
