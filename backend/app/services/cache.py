import threading
import time
from typing import Any, Callable


class TTLCache:
    """In-process TTL cache with single-flight + stale-while-revalidate.

    Two properties that matter under concurrent load from many clients
    polling the same key:
    - Single-flight: concurrent misses on a never-before-cached key share one
      factory() call instead of each one stampeding the upstream.
    - Stale-while-revalidate: once a key has been populated at least once, an
      expired entry is still returned immediately while a single background
      thread refreshes it. Callers never block on a slow upstream, and a
      failing upstream just leaves the last-known-good value in place.
    """

    def __init__(self) -> None:
        self._store: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()
        self._key_locks: dict[str, threading.Lock] = {}
        self._refreshing: set[str] = set()

    def _key_lock(self, key: str) -> threading.Lock:
        with self._lock:
            lock = self._key_locks.setdefault(key, threading.Lock())
        return lock

    def get_or_set(self, key: str, ttl_seconds: float, factory: Callable[[], Any]) -> Any:
        now = time.time()
        with self._lock:
            cached = self._store.get(key)

        if cached is not None and cached[0] > now:
            return cached[1]

        if cached is not None:
            with self._lock:
                already_refreshing = key in self._refreshing
                if not already_refreshing:
                    self._refreshing.add(key)
            if not already_refreshing:
                threading.Thread(
                    target=self._refresh, args=(key, ttl_seconds, factory), daemon=True
                ).start()
            return cached[1]

        # Cold start: nothing cached yet for this key, so we must fetch
        # synchronously. A per-key lock keeps concurrent callers from all
        # hitting the upstream at once — the rest just wait and reuse the
        # first caller's result.
        lock = self._key_lock(key)
        with lock:
            with self._lock:
                cached = self._store.get(key)
            if cached is not None and cached[0] > time.time():
                return cached[1]
            return self._refresh(key, ttl_seconds, factory)

    def _refresh(self, key: str, ttl_seconds: float, factory: Callable[[], Any]) -> Any:
        try:
            value = factory()
        finally:
            with self._lock:
                self._refreshing.discard(key)
        with self._lock:
            self._store[key] = (time.time() + ttl_seconds, value)
        return value

    def peek(self, key: str) -> Any | None:
        """Non-blocking read: returns the cached value if present and unexpired,
        otherwise None — never calls a factory. For callers on a latency-sensitive
        path (e.g. live search-as-you-type) that must not block on a slow rebuild."""
        now = time.time()
        with self._lock:
            cached = self._store.get(key)
            if cached is not None and cached[0] > now:
                return cached[1]
        return None


cache = TTLCache()
