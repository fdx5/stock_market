import threading
import time
from datetime import datetime, timezone

from app.services import visitor_store

# A session counts as "currently on the site" if its last heartbeat was within this
# window. Single-process in-memory tracking is fine here since this app runs as one
# instance (see cache.py's TTLCache for the same assumption).
HEARTBEAT_TTL_SECONDS = 60


class VisitorTracker:
    def __init__(self) -> None:
        self._sessions: dict[str, float] = {}
        self._lock = threading.Lock()
        # Sessions already persisted to the cumulative store during this process's
        # lifetime, so a session heartbeating every 20s doesn't re-hit the DB each time.
        self._known_sessions: set[str] = set()
        self._total_cache: int = 0

    def heartbeat(self, session_id: str) -> tuple[int, int]:
        now = time.time()
        with self._lock:
            self._sessions[session_id] = now
            self._prune(now)
            current = len(self._sessions)
            is_new = session_id not in self._known_sessions
            total = self._total_cache

        if is_new:
            # Hits the persistent store outside the lock so a first-time visit doesn't
            # block every other session's heartbeat for the duration of the DB round-trip.
            total = visitor_store.record_and_total(session_id, datetime.now(timezone.utc).isoformat())
            with self._lock:
                self._known_sessions.add(session_id)
                self._total_cache = total

        return current, total

    def _prune(self, now: float) -> None:
        cutoff = now - HEARTBEAT_TTL_SECONDS
        stale = [sid for sid, seen_at in self._sessions.items() if seen_at < cutoff]
        for sid in stale:
            del self._sessions[sid]


tracker = VisitorTracker()
