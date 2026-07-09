import threading
import time
from typing import Any, Callable


class TTLCache:
    """Simple in-process TTL cache. Single-instance deployment, no external store needed."""

    def __init__(self) -> None:
        self._store: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get_or_set(self, key: str, ttl_seconds: float, factory: Callable[[], Any]) -> Any:
        now = time.time()
        with self._lock:
            cached = self._store.get(key)
            if cached is not None and cached[0] > now:
                return cached[1]

        value = factory()

        with self._lock:
            self._store[key] = (now + ttl_seconds, value)
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
