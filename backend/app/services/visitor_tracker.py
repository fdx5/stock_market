import threading
import time

# A session counts as "currently on the site" if its last heartbeat was within this
# window. Single-process in-memory tracking is fine here since this app runs as one
# instance (see cache.py's TTLCache for the same assumption).
HEARTBEAT_TTL_SECONDS = 60


class VisitorTracker:
    def __init__(self) -> None:
        self._sessions: dict[str, float] = {}
        self._lock = threading.Lock()

    def heartbeat(self, session_id: str) -> int:
        now = time.time()
        with self._lock:
            self._sessions[session_id] = now
            self._prune(now)
            return len(self._sessions)

    def _prune(self, now: float) -> None:
        cutoff = now - HEARTBEAT_TTL_SECONDS
        stale = [sid for sid, seen_at in self._sessions.items() if seen_at < cutoff]
        for sid in stale:
            del self._sessions[sid]


tracker = VisitorTracker()
