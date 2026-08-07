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
  * **A breaker.** After repeated failures the gate opens and short-circuits
    for a cooldown. A database that is down then costs one fast rejection per
    request rather than a full connection handshake, which is both what was
    hammering the upstream and what was making each request expensive.

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

        if not self._lock.acquire(timeout=self._lock_timeout):
            # Busy for longer than any healthy call takes: treat it as the
            # store being in trouble rather than waiting it out.
            self._record_failure()
            raise StoreUnavailable(f"{self.name}: busy for over {self._lock_timeout}s")

        try:
            yield
        except StoreUnavailable:
            raise
        except Exception:
            self._record_failure()
            raise
        else:
            self._record_success()
        finally:
            self._lock.release()

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
