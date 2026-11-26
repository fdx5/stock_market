"""Every headless-browser launch in this package goes through here.

Why (incident 2026-11-26 12:00–12:11 KST): the web server on Render started Chromium to
render the KOSPI/KOSDAQ maps for a Naver blog post. Measured locally, that export peaks
at ~1.1 GB (Chromium + two 1920x1200@2x treemaps) — on a 2 GB instance that already
holds the app's caches. It ran inside the same process that serves the site, retried
every two minutes, and the site answered 502 until the instance restarted.

The rule this module enforces:

  * **Not in the web server.** On Render (env RENDER set) a browser is refused unless
    SERVER_BROWSER_ALLOWED=1 is set deliberately. Browser work belongs to the PC worker
    (backend/scripts/naver_blog_worker.py) or a separate machine.
  * **One at a time.** A process-wide lock; nested use in the same thread is fine.
  * **Only with headroom.** Where allowed on a server, the launch is refused when the
    container's free memory is below SERVER_BROWSER_HEADROOM_MB (default 1300).

Callers get BrowserUnavailable — "not here, not now" — and must treat it as a deferral
(hand the work back, do not count it as a failed attempt).
"""
from __future__ import annotations

import functools
import logging
import os
import threading
from contextlib import contextmanager
from pathlib import Path

log = logging.getLogger(__name__)

ON_SERVER = bool(os.environ.get("RENDER"))
HEADROOM_MB = int(os.environ.get("SERVER_BROWSER_HEADROOM_MB", "1300"))
_lock = threading.RLock()


class BrowserUnavailable(RuntimeError):
    """A headless browser may not be started here or now."""


def allowed() -> bool:
    return not ON_SERVER or os.environ.get("SERVER_BROWSER_ALLOWED") == "1"


def _read_int(path: str) -> int | None:
    try:
        raw = Path(path).read_text().strip()
        return None if raw == "max" else int(raw)
    except (OSError, ValueError):
        return None


def free_memory_mb() -> float | None:
    """Free memory of this container (cgroup v2/v1), else of the machine."""
    for limit_p, usage_p in (("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.current"),
                             ("/sys/fs/cgroup/memory/memory.limit_in_bytes", "/sys/fs/cgroup/memory/memory.usage_in_bytes")):
        limit, usage = _read_int(limit_p), _read_int(usage_p)
        if limit and usage is not None and limit < 1 << 50:
            return (limit - usage) / 2**20
    try:
        import psutil  # type: ignore
        return psutil.virtual_memory().available / 2**20
    except Exception:
        return None


@contextmanager
def slot(purpose: str, wait: float = 600):
    if not allowed():
        raise BrowserUnavailable(f"{purpose}: no headless browser in the web server (set SERVER_BROWSER_ALLOWED=1 to override)")
    if not _lock.acquire(timeout=wait):
        raise BrowserUnavailable(f"{purpose}: another browser task is still running")
    try:
        if ON_SERVER:
            free = free_memory_mb()
            if free is not None and free < HEADROOM_MB:
                raise BrowserUnavailable(f"{purpose}: only {free:.0f} MB free, need {HEADROOM_MB} MB")
        yield
    finally:
        _lock.release()


def uses_browser(purpose: str):
    """Decorator: the function runs only inside a browser slot."""
    def wrap(fn):
        @functools.wraps(fn)
        def inner(*args, **kwargs):
            with slot(purpose):
                return fn(*args, **kwargs)
        return inner
    return wrap
