"""Keeps a sick database from taking the whole site down.

Every libSQL-backed store in this package serializes its remote calls behind a
module-global lock — see comment_store._with_connection for why (concurrent
Hrana stream open/close races inside the client and surfaces as "stream not
found"). That is the right call while Turso is healthy and a liability while it
is not, because of how the two halves interact:

  * a remote call that hangs or retries holds the store's lock for its whole
    duration, and every other request touching that store queues behind it;
  * FastAPI runs *sync* path operations in a bounded worker threadpool, and
    Starlette serves static files from that same pool.

So enough queued database work stops the process answering anything at all —
including `/` , the built frontend's assets, and the health check the platform
uses to decide whether the service is alive. A database outage becomes a total
outage, and then the failed health check triggers a restart, and the restart
re-runs the startup warmers against the same sick database. That loop is what
turns a few minutes of upstream trouble into a site that 502s on every reload.

This module bounds it, with two guards:

  * **A bounded wait.** The lock is acquired with a timeout. A caller that
    cannot get in gives up and releases its worker thread instead of parking on
    a stalled remote call, so the pool cannot be drained.
  * **A breaker.** After repeated *errors* the gate opens and short-circuits
    for a cooldown. A database that is down then costs one fast rejection per
    request rather than a full connection handshake, which is both what was
    hammering the upstream and what was making each request expensive. Only
    calls that actually raise count here — a timed-out wait means the queue was
    long, which is a load signal and not an outage.

Callers see `StoreUnavailable`. Treat it as "no data right now": it is a
normal, expected outcome, not a bug. Everything reachable without the database
— the entrance, the whole 3D scene, every static asset — keeps serving.
"""

from __future__ import annotations

import logging
import threading
import time
from contextlib import contextmanager

logger = logging.getLogger(__name__)


class StoreUnavailable(RuntimeError):
    """The store could not be reached quickly enough, or is in cooldown."""


# Every gate made, for the admin health view (name, load, breaker state).
_registry: list["Gate"] = []


def all_gates() -> list[dict]:
    return [g.stats() for g in list(_registry)]


class Gate:
    """One per store, guarding that store's connection.

    Per-store rather than global on purpose: Turso failing does not have to
    take down the local-file fallback stores with it, and a slow table should
    not block an unrelated one.
    """

    def __init__(
        self,
        name: str,
        *,
        lock_timeout: float = 4.0,
        fail_threshold: int = 4,
        cooldown: float = 25.0,
    ) -> None:
        self.name = name
        # Long enough that a healthy remote round trip (tens of milliseconds)
        # never trips it, short enough that a worker thread is never held for
        # anything like the platform's own request timeout.
        self._lock_timeout = lock_timeout
        self._fail_threshold = fail_threshold
        self._cooldown = cooldown

        self._lock = threading.Lock()
        self._state = threading.Lock()
        self._failures = 0
        self._open_until = 0.0
        # Load figures for the admin health view.
        self._calls = 0
        self._busy = 0
        self._errors = 0
        self._wait_ms = 0.0  # moving averages
        self._work_ms = 0.0
        self._last_error = ""
        _registry.append(self)

    def stats(self) -> dict:
        with self._state:
            return {
                "name": self.name,
                "calls": self._calls,
                "busy_rejects": self._busy,
                "errors": self._errors,
                "avg_wait_ms": round(self._wait_ms, 1),
                "avg_work_ms": round(self._work_ms, 1),
                "open": time.monotonic() < self._open_until,
                "failures": self._failures,
                "last_error": self._last_error,
            }

    def _note(self, wait: float, work: float) -> None:
        with self._state:
            self._calls += 1
            self._wait_ms += (wait * 1000 - self._wait_ms) * 0.1
            self._work_ms += (work * 1000 - self._work_ms) * 0.1

    @property
    def is_open(self) -> bool:
        """True while the breaker is short-circuiting calls."""
        with self._state:
            return time.monotonic() < self._open_until

    @contextmanager
    def hold(self):
        """Acquires the store's lock, or raises StoreUnavailable."""
        with self._state:
            if time.monotonic() < self._open_until:
                raise StoreUnavailable(f"{self.name}: unavailable (cooling down)")

        asked = time.monotonic()
        if not self._lock.acquire(timeout=self._lock_timeout):
            with self._state:
                self._busy += 1
            # Give up rather than wait it out: the point of the bounded wait is that
            # this worker thread goes back to the pool instead of parking on a call it
            # cannot join.
            #
            # Deliberately NOT counted as a breaker failure. A full queue says the store
            # is *busy*, which is a statement about how much work arrived at once, not
            # about the store's health — prediction_store's reads pull thousands of rows
            # and legitimately take seconds each, so a few honest readers arriving
            # together can exhaust this timeout with nothing wrong anywhere. Counting
            # those as failures opened the breaker on the fourth one and turned a burst
            # into a 25-second blackout of every endpoint backed by that store. Real
            # trouble still trips it: an exception raised out of the call below does.
            raise StoreUnavailable(f"{self.name}: busy for over {self._lock_timeout}s")

        got = time.monotonic()
        try:
            yield
        except StoreUnavailable:
            raise
        except Exception as exc:
            with self._state:
                self._errors += 1
                self._last_error = f"{type(exc).__name__}: {exc}"[:200]
            self._record_failure()
            raise
        else:
            self._record_success()
        finally:
            self._lock.release()
            self._note(got - asked, time.monotonic() - got)

    def _record_failure(self) -> None:
        with self._state:
            self._failures += 1
            if self._failures >= self._fail_threshold and time.monotonic() >= self._open_until:
                self._open_until = time.monotonic() + self._cooldown
                logger.warning(
                    "libsql gate %s opened after %d failures; pausing %.0fs",
                    self.name,
                    self._failures,
                    self._cooldown,
                )

    def _record_success(self) -> None:
        with self._state:
            # One clean call is enough to close the breaker: the failure mode
            # this guards against is an upstream outage, and those end all at
            # once rather than tapering.
            self._failures = 0
            self._open_until = 0.0
