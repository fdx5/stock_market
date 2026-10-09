"""Keep verified geography across deploys; coalesce identical slow OSM lookups.

An upstream error is never persisted as an empty lake/crossing survey. A verified
stale survey remains usable while refresh fails, rather than erasing the scene.
"""
from __future__ import annotations

import datetime as dt
import threading
import time
from collections.abc import Callable
from app.services import realestate_store as store

_memory: dict[str, tuple[float, dict]] = {}
_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()
KEEP_S = 30 * 86400
EMPTY_S = 86400
STALE_S = 90 * 86400

def peek_geography(kind: str, lat: float, lon: float, radius: float) -> dict | None:
    """A verified survey already kept (memory, then the store), or None — never a lookup."""
    key = f"geography-v1:{kind}:{lat:.4f}:{lon:.4f}:{int(radius)}"
    now = time.time()
    hit = _memory.get(key)
    if hit and now < hit[0] and hit[1].get("source"):
        return hit[1]
    try:
        saved = store.load_facts(key)
        if saved and isinstance(saved[1], dict) and saved[1].get("source"):
            stamp, body = saved
            if now - dt.datetime.fromisoformat(stamp).timestamp() < STALE_S:
                return body
    except Exception:
        pass
    return None


def cached_geography(kind: str, lat: float, lon: float, radius: float, load: Callable[[], dict]) -> dict:
    key = f"geography-v1:{kind}:{lat:.4f}:{lon:.4f}:{int(radius)}"
    now = time.time()
    hit = _memory.get(key)
    if hit and now < hit[0]:
        return hit[1]
    with _guard:
        lock = _locks.setdefault(key, threading.Lock())
    with lock:
        now = time.time()
        hit = _memory.get(key)
        if hit and now < hit[0]:
            return hit[1]
        stale = None
        try:
            saved = store.load_facts(key)
            if saved and isinstance(saved[1], dict) and saved[1].get("source"):
                stamp, body = saved
                age = now - dt.datetime.fromisoformat(stamp).timestamp()
                ttl = KEEP_S if any(body.get(k) for k in ("rings", "crossings", "points", "signals")) else EMPTY_S
                if age < ttl:
                    _memory[key] = (now + min(ttl - age, 3600), body)
                    return body
                if age < STALE_S:
                    stale = body
        except Exception:
            pass  # Storage unavailable: live data still works.
        body = load()
        if body.get("source"):
            ttl = KEEP_S if any(body.get(k) for k in ("rings", "crossings", "points", "signals")) else EMPTY_S
            _memory[key] = (now + ttl, body)
            try:
                store.save_facts(key, body, dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"))
            except Exception:
                pass
        else:
            body = stale or body
            _memory[key] = (now + (60 if stale else 5), body)
        if len(_memory) > 2000:
            old = next(iter(_memory))
            _memory.pop(old, None)
            with _guard:
                if old != key and old in _locks and not _locks[old].locked():
                    _locks.pop(old, None)
        return body
