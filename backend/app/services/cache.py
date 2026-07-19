import threading
import time
from collections import OrderedDict
from typing import Any, Callable

# Safety net against unbounded memory growth: this cache has no expiry sweep (an
# entry that's never accessed again after going stale just sits there forever), and
# at least one cache key used to incorporate a client-supplied integer with no upper
# bound (`years` on the stock history/indicators endpoints) — a client cycling through
# many distinct values could grow _store without limit until the process runs out of
# memory. Every route's own input validation is the first line of defense (see the
# `years` Query(le=...) bounds added alongside this), but capping the cache itself
# means a similar oversight in some future endpoint can't repeat the same failure
# mode. 20,000 is generous relative to this app's actual key space (a few thousand
# KRX codes times a handful of cache-key variants each) — normal traffic should never
# come close to evicting a still-useful entry.
MAX_ENTRIES = 20_000


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
        # OrderedDict (not dict) so a read/write can cheaply move a key to the
        # most-recently-used end — that ordering is what MAX_ENTRIES eviction below
        # uses to drop the least-recently-used entry first, not just an arbitrary one.
        self._store: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._lock = threading.Lock()
        self._key_locks: dict[str, threading.Lock] = {}
        self._refreshing: set[str] = set()

    def _key_lock(self, key: str) -> threading.Lock:
        with self._lock:
            lock = self._key_locks.setdefault(key, threading.Lock())
        return lock

    def _evict_if_needed_locked(self) -> None:
        """Caller must already hold self._lock. Evicting a lock object currently held
        by an in-flight refresh would let a concurrent caller create a second "fresh"
        lock for the same key and defeat single-flight, so only _store (the actual
        cached payloads, and the real memory risk) is capped here — _key_locks stays
        unbounded, but each entry is a bare Lock object, negligible next to the
        dataframe/JSON-sized values _store holds."""
        while len(self._store) > MAX_ENTRIES:
            self._store.popitem(last=False)

    def get_or_set(
        self, key: str, ttl_seconds: float, factory: Callable[[], Any], allow_stale: bool = True
    ) -> Any:
        """`allow_stale=False` is for callers that must reflect the current market
        state right now (e.g. a page's first load) — an expired entry is refreshed
        synchronously instead of being served stale while refreshing in the background.
        Still single-flighted against any refresh already in flight for this key, so it
        never doubles up on the upstream call."""
        now = time.time()
        with self._lock:
            cached = self._store.get(key)
            if cached is not None:
                self._store.move_to_end(key)

        if cached is not None and cached[0] > now:
            return cached[1]

        if cached is not None and allow_stale:
            with self._lock:
                already_refreshing = key in self._refreshing
                if not already_refreshing:
                    self._refreshing.add(key)
            if not already_refreshing:
                threading.Thread(
                    target=self._background_refresh, args=(key, ttl_seconds, factory), daemon=True
                ).start()
            return cached[1]

        # Cold start, or a caller that can't accept stale data: refresh synchronously
        # under the per-key lock, so concurrent callers share one fetch instead of
        # stampeding, and so we never race a background refresh already in flight.
        return self._refresh_locked(key, ttl_seconds, factory)

    def _background_refresh(self, key: str, ttl_seconds: float, factory: Callable[[], Any]) -> None:
        try:
            self._refresh_locked(key, ttl_seconds, factory)
        finally:
            with self._lock:
                self._refreshing.discard(key)

    def _refresh_locked(self, key: str, ttl_seconds: float, factory: Callable[[], Any]) -> Any:
        lock = self._key_lock(key)
        with lock:
            with self._lock:
                cached = self._store.get(key)
            if cached is not None and cached[0] > time.time():
                return cached[1]
            return self._refresh(key, ttl_seconds, factory)

    def _refresh(self, key: str, ttl_seconds: float, factory: Callable[[], Any]) -> Any:
        value = factory()
        with self._lock:
            self._store[key] = (time.time() + ttl_seconds, value)
            self._store.move_to_end(key)
            self._evict_if_needed_locked()
        return value

    def peek(self, key: str) -> Any | None:
        """Non-blocking read: returns the cached value if present and unexpired,
        otherwise None — never calls a factory. For callers on a latency-sensitive
        path (e.g. live search-as-you-type) that must not block on a slow rebuild."""
        now = time.time()
        with self._lock:
            cached = self._store.get(key)
            if cached is not None and cached[0] > now:
                self._store.move_to_end(key)
                return cached[1]
        return None


cache = TTLCache()
