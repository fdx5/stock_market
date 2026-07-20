import threading
import time
from datetime import datetime, timezone

from app.services import visitor_store

# A session counts as "currently on the site" if its last heartbeat was within this
# window. Single-process in-memory tracking is fine here since this app runs as one
# instance (see cache.py's TTLCache for the same assumption).
HEARTBEAT_TTL_SECONDS = 60

# Caps how many *new* (never-seen-before) sessions a single IP can register toward
# the cumulative visitor total per rolling window. A real visitor only ever mints one
# new session per browser tab (crypto.randomUUID(), cached in sessionStorage — see
# useVisitorCount.ts), so even someone testing in a dozen tabs/incognito windows stays
# far under this; it exists to stop a script that mints unlimited random session_ids
# from inflating the counter and growing _known_sessions/the Turso table without
# bound, not to constrain normal use.
NEW_SESSION_LIMIT_PER_IP = 20
NEW_SESSION_WINDOW_SECONDS = 3600


class VisitorTracker:
    def __init__(self) -> None:
        self._sessions: dict[str, float] = {}
        self._lock = threading.Lock()
        # Sessions already persisted to the cumulative store during this process's
        # lifetime, so a session heartbeating every 20s doesn't re-hit the DB each time.
        self._known_sessions: set[str] = set()
        self._total_cache: int = 0
        # IP -> timestamps of its recent new-session registrations, pruned to the
        # window on every check — this itself stays small (one short list per active
        # IP, not one entry per session_id) so it can't reproduce the same unbounded
        # growth this whole mechanism exists to prevent.
        self._new_session_log: dict[str, list[float]] = {}

    def heartbeat(self, session_id: str, client_ip: str | None) -> tuple[int, int]:
        now = time.time()
        with self._lock:
            self._sessions[session_id] = now
            self._prune(now)
            current = len(self._sessions)
            is_new = session_id not in self._known_sessions
            total = self._total_cache

        if is_new and self._allow_new_session(client_ip, now):
            # Hits the persistent store outside the lock so a first-time visit doesn't
            # block every other session's heartbeat for the duration of the DB round-trip.
            total = visitor_store.record_and_total(session_id, datetime.now(timezone.utc).isoformat())
            with self._lock:
                self._known_sessions.add(session_id)
                self._total_cache = total
        # A throttled new session deliberately isn't added to _known_sessions: it
        # still counts toward `current` (the heartbeat above already recorded it) so
        # the "currently online" figure isn't wrong for a real visitor caught by a
        # false-positive throttle, but its *next* heartbeat re-checks the limit
        # instead of the throttle only ever applying once.

        return current, total

    def current_count(self) -> int:
        """Read-only peek at how many sessions are currently online, for the admin
        dashboard — unlike heartbeat(), doesn't register a session of its own."""
        now = time.time()
        with self._lock:
            self._prune(now)
            return len(self._sessions)

    def _allow_new_session(self, client_ip: str | None, now: float) -> bool:
        if not client_ip:
            # No IP to key on (shouldn't normally happen behind Cloudflare/Render) —
            # fail open rather than break the counter for every visitor whenever this
            # happens.
            return True
        with self._lock:
            cutoff = now - NEW_SESSION_WINDOW_SECONDS
            log = [t for t in self._new_session_log.get(client_ip, []) if t > cutoff]
            if len(log) >= NEW_SESSION_LIMIT_PER_IP:
                self._new_session_log[client_ip] = log
                return False
            log.append(now)
            self._new_session_log[client_ip] = log
            return True

    def _prune(self, now: float) -> None:
        cutoff = now - HEARTBEAT_TTL_SECONDS
        stale = [sid for sid, seen_at in self._sessions.items() if seen_at < cutoff]
        for sid in stale:
            del self._sessions[sid]


tracker = VisitorTracker()
