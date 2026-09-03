"""Small process-local cache for expensive, read-only admin aggregates.

The dashboard polls fixed windows far more often than their contents materially
change.  Caching the final JSON-shaped value prevents identical GROUP BY queries from
reaching Turso at all.  Entries are deliberately short lived and bounded; deploys do
not need invalidation because a process restart starts with an empty cache.
"""

from __future__ import annotations

import copy
import functools
import threading
import time
from collections import OrderedDict
from typing import Callable, TypeVar


T = TypeVar("T")
_lock = threading.Lock()
_entries: "OrderedDict[tuple, tuple[float, object]]" = OrderedDict()
_MAX_ENTRIES = 64


def ttl_cache(seconds: float) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """Cache one endpoint result by arguments for ``seconds``.

    Copies on both sides keep FastAPI response preparation (or a caller) from ever
    mutating the shared cached object.
    """

    def decorate(fn: Callable[..., T]) -> Callable[..., T]:
        @functools.wraps(fn)
        def wrapped(*args, **kwargs):
            key = (fn.__module__, fn.__qualname__, args, tuple(sorted(kwargs.items())))
            now = time.monotonic()
            with _lock:
                hit = _entries.get(key)
                if hit is not None and hit[0] > now:
                    _entries.move_to_end(key)
                    return copy.deepcopy(hit[1])

            value = fn(*args, **kwargs)
            with _lock:
                _entries[key] = (now + seconds, copy.deepcopy(value))
                _entries.move_to_end(key)
                while len(_entries) > _MAX_ENTRIES:
                    _entries.popitem(last=False)
            return value

        return wrapped

    return decorate
