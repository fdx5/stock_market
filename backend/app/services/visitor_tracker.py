import threading
import time
from datetime import datetime, timedelta, timezone

from app.services import visitor_store

# A session counts as "currently on the site" if its last heartbeat was within this
# window. The authoritative set is persisted in Turso so deploys, restarts and
# overlapping instances do not reset or split the number. The local set is a
# failure fallback only.
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

    def heartbeat(self, session_id: str, client_ip: str | None, is_bot: bool = False) -> tuple[int, int]:
        """`is_bot` short-circuits both counters rather than throttling them.

        NEW_SESSION_LIMIT_PER_IP below was written against a script minting random
        session ids from one address, and a search crawler defeats it without trying:
        it renders each URL in a fresh browser context (so every page is a new session
        id, exactly as a first-time visitor looks) from a large pool of addresses, so
        no per-IP window ever fills. A 2026-08-22..24 crawl accordingly registered
        hundreds of "new visitors" a day against a real audience a fraction of that
        size, and the cumulative total is a permanent row per session - wrong once,
        wrong forever. The identification is now made from the User-Agent at the route
        (see routers/visitors.py) instead of inferred from behaviour here.
        """
        now = time.time()
        if is_bot:
            return self.current_count(), self._persistent_total()
        with self._lock:
            self._sessions[session_id] = now
            self._prune(now)
            current = len(self._sessions)
            is_new = session_id not in self._known_sessions
            total = self._total_cache

        register_session = is_new and self._allow_new_session(client_ip, now)
        seen_at = datetime.now(timezone.utc)
        try:
            current, total = visitor_store.heartbeat_and_counts(
                session_id,
                seen_at.isoformat(),
                (seen_at - timedelta(seconds=HEARTBEAT_TTL_SECONDS)).isoformat(),
                register_session=register_session,
            )
        except Exception:
            # Presence is useful but must never make a reader's page fail merely
            # because the analytics store is temporarily unavailable.
            pass
        if register_session:
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
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=HEARTBEAT_TTL_SECONDS)
        try:
            return visitor_store.active_count(cutoff.isoformat())
        except Exception:
            pass
        with self._lock:
            self._prune(now)
            return len(self._sessions)

    def _persistent_total(self) -> int:
        try:
            total = visitor_store.total_count()
            with self._lock:
                self._total_cache = total
            return total
        except Exception:
            return self._total_cache

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
