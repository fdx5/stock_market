"""Process-local cache for expensive, read-only admin aggregates — stale-while-revalidate.

The dashboard polls fixed windows far more often than their contents materially
change, and every aggregate reads the one Turso database the whole site writes to.
When that database was slow, a cached value that had just expired made the next
request wait on the query, and a query that outran the client's read timeout failed
the request outright — the dashboard's panels then sat on "loading" for good.

So an entry that has expired is still served at once, while one background refresh
per key recomputes it; a refresh that fails keeps the last good value (and says so in
`stale_since`). Only the very first read of a key waits on the database. Entries are
bounded; a process restart starts empty.
"""

from __future__ import annotations

import copy
import functools
import logging
import threading
import time
from collections import OrderedDict
from typing import Callable, TypeVar

log = logging.getLogger(__name__)

T = TypeVar("T")
_lock = threading.Lock()
# key -> (fresh until (monotonic), value, last refresh error or None)
_entries: "OrderedDict[tuple, tuple[float, object, str | None]]" = OrderedDict()
_refreshing: set[tuple] = set()
_MAX_ENTRIES = 96


def _refresh(key: tuple, fn: Callable, args: tuple, kwargs: dict, seconds: float) -> None:
    try:
        value = fn(*args, **kwargs)
    except Exception as exc:  # noqa: BLE001 — the last good value keeps serving
        log.warning("admin cache: refreshing %s failed (%s)", key[1], exc)
        with _lock:
            hit = _entries.get(key)
            if hit is not None:
                # Try again in a little while rather than on every request.
                _entries[key] = (time.monotonic() + min(30.0, seconds), hit[1], f"{type(exc).__name__}: {exc}"[:200])
            _refreshing.discard(key)
        return
    with _lock:
        _entries[key] = (time.monotonic() + seconds, copy.deepcopy(value), None)
        _entries.move_to_end(key)
        while len(_entries) > _MAX_ENTRIES:
            _entries.popitem(last=False)
        _refreshing.discard(key)


def ttl_cache(seconds: float) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """Cache one endpoint result by arguments; recompute it in the background once it
    is older than ``seconds``. Copies on both sides keep response preparation from
    mutating the shared object."""

    def decorate(fn: Callable[..., T]) -> Callable[..., T]:
        @functools.wraps(fn)
        def wrapped(*args, **kwargs):
            key = (fn.__module__, fn.__qualname__, args, tuple(sorted(kwargs.items())))
            now = time.monotonic()
            with _lock:
                hit = _entries.get(key)
                if hit is not None:
                    _entries.move_to_end(key)
                    if hit[0] <= now and key not in _refreshing:
                        _refreshing.add(key)
                        threading.Thread(
                            target=_refresh, args=(key, fn, args, kwargs, seconds), name="admin-cache-refresh", daemon=True
                        ).start()
                    return copy.deepcopy(hit[1])

            value = fn(*args, **kwargs)  # the first read of a key: nothing to serve yet
            with _lock:
                _entries[key] = (now + seconds, copy.deepcopy(value), None)
                _entries.move_to_end(key)
                while len(_entries) > _MAX_ENTRIES:
                    _entries.popitem(last=False)
            return value

        wrapped.__wrapped__ = fn  # type: ignore[attr-defined]
        return wrapped

    return decorate


def status() -> list[dict]:
    """What the cache holds, for the dashboard's health view: each entry's age past
    its freshness and its last refresh error, if any."""
    now = time.monotonic()
    with _lock:
        return [
            {"name": key[1], "args": repr(key[2])[:60], "overdue_s": round(max(0.0, now - until), 1), "error": err}
            for key, (until, _, err) in _entries.items()
        ]
