import os
import secrets
import threading
import time

from fastapi import Header, HTTPException

# Overridable on Render via env vars without a code change; these defaults are the
# credentials the admin dashboard was commissioned with.
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "fdx5")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "***REDACTED***")

TOKEN_TTL_SECONDS = 12 * 60 * 60

# Single-process in-memory session store — same assumption visitor_tracker.py and
# cache.py's TTLCache already make about this app running as one instance. A
# restart just means the admin logs in again; not worth persisting for an
# internal tool with one fixed account.
_lock = threading.Lock()
_sessions: dict[str, float] = {}


def login(username: str, password: str) -> tuple[str, float] | None:
    if not (secrets.compare_digest(username, ADMIN_USERNAME) and secrets.compare_digest(password, ADMIN_PASSWORD)):
        return None
    token = secrets.token_urlsafe(32)
    expires_at = time.time() + TOKEN_TTL_SECONDS
    with _lock:
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
