import threading
import time
from datetime import datetime, timedelta, timezone

from app.services import visitor_store

# A session counts as "currently on the site" if its last heartbeat was within this
# window. The authoritative set is persisted in Turso so deploys, restarts and
# overlapping instances do not reset or split the number. The local set is a
# failure fallback only.
# Background browser timers are commonly throttled to roughly one-minute cadence.
# Two minutes retains an open tab across that jitter without treating abandoned tabs
# as online for long; the client still schedules a heartbeat every 20 seconds.
HEARTBEAT_TTL_SECONDS = 120

# Caps how many *new* (never-seen-before) sessions a single IP can register toward
# the cumulative visitor total per rolling window. A real visitor only ever mints one
# new session per browser tab (crypto.randomUUID(), cached in sessionStorage — see
# useVisitorCount.ts), so even someone testing in a dozen tabs/incognito windows stays
# far under this; it exists to stop a script that mints unlimited random session_ids
# from inflating the counter and growing _known_sessions/the Turso table without
# bound, not to constrain normal use.
NEW_SESSION_LIMIT_PER_IP = 20
NEW_SESSION_WINDOW_SECONDS = 3600

# Heartbeats queued for the store writer, coalesced per session. The bound keeps a
# stalled store from growing memory; overflow only skips that one heartbeat's write.
MAX_PENDING_HEARTBEATS = 5000


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
        # The shared store is written by one background thread, never on the request
        # thread: each heartbeat used to wait up to the store gate's 4s lock timeout,
        # so a slow store held one request worker per visitor every 20 seconds.
        # Responses carry the counts from the writer's latest round trip.
        self._shared_current: int | None = None
        self._pending: dict[str, tuple[str, str, bool]] = {}
        self._wake = threading.Event()
        self._writer: threading.Thread | None = None

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
            with self._lock:
                self._prune(now)
                return self._shared_current or len(self._sessions), self._total_cache
        with self._lock:
            self._sessions[session_id] = now
            self._prune(now)
            is_new = session_id not in self._known_sessions

        register_session = is_new and self._allow_new_session(client_ip, now)
        seen_at = datetime.now(timezone.utc)
        with self._lock:
            if register_session:
                self._known_sessions.add(session_id)
            queued = self._pending.get(session_id)
            if queued is not None or len(self._pending) < MAX_PENDING_HEARTBEATS:
                self._pending[session_id] = (
                    seen_at.isoformat(),
                    (seen_at - timedelta(seconds=HEARTBEAT_TTL_SECONDS)).isoformat(),
                    register_session or bool(queued and queued[2]),
                )
            if self._writer is None:
                self._writer = threading.Thread(target=self._write_loop, name="visitor-heartbeat-writer", daemon=True)
                self._writer.start()
            current = max(self._shared_current or 0, len(self._sessions))
            total = self._total_cache
        self._wake.set()
        # A throttled new session deliberately isn't added to _known_sessions: it
        # still counts toward `current` (the heartbeat above already recorded it) so
        # the "currently online" figure isn't wrong for a real visitor caught by a
        # false-positive throttle, but its *next* heartbeat re-checks the limit
        # instead of the throttle only ever applying once.

        return current, total

    def _write_loop(self) -> None:
        self._persistent_total()
        while True:
            self._wake.wait()
            self._wake.clear()
            with self._lock:
                batch, self._pending = self._pending, {}
            for session_id, (seen_at, active_since, register_session) in batch.items():
                try:
                    current, total = visitor_store.heartbeat_and_counts(
                        session_id, seen_at, active_since, register_session=register_session,
                    )
                except Exception:
                    # Presence is useful but must never make a reader's page fail
                    # merely because the analytics store is temporarily unavailable.
                    continue
                with self._lock:
                    self._shared_current = current
                    self._total_cache = total

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

    def observed_presence(self, now: float) -> dict[str, float]:
        """Local heartbeat evidence only: no DB query, registration or pruning."""
        with self._lock:
            return {sid: seen for sid, seen in self._sessions.items()
                    if now - HEARTBEAT_TTL_SECONDS <= seen <= now}

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
