"""A short live tail of API requests, for the admin monitor's neuron view.

activity_log already records what the *visitor* did — page views, clicks, stock
selections. That is half the picture: it says a browser lit up, but nothing about the
backend work that followed. The monitor draws API endpoints as their own nodes, and
without this they would sit inert while the page nodes around them fired.

Deliberately in-process and bounded, like activity_log's own tail: a fixed-size ring
buffer that the oldest events fall out of. Nothing here is persisted, and nothing here
is on the critical path of the request it describes — `record` appends a small dict
under a lock and returns.

Events are keyed by a monotonically increasing id so a poller can ask for "everything
after N" without re-reading what it already has, and without depending on clocks.
"""

import itertools
import threading
import time
from collections import deque

# ~10 seconds of a busy moment, which is all a 1s poll ever needs to catch up on. A
# viewer that falls further behind than this skips the gap rather than replaying it —
# for a live signal display, stale signals are worse than missing ones.
TAIL_MAXLEN = 600

_lock = threading.Lock()
_id_counter = itertools.count(1)
_tail: deque[dict] = deque(maxlen=TAIL_MAXLEN)


def record(route: str, method: str, status: int, duration_ms: float) -> None:
    """One completed API request. `route` should be the matched *route template*
    (`/api/stock/{code}/quote`), not the concrete path — the monitor draws one node per
    endpoint, and a per-path key would scatter one endpoint across thousands of them."""
    event = {
        "id": next(_id_counter),
        "ts": time.time(),
        "route": route,
        "method": method,
        "status": status,
        "ms": round(duration_ms, 1),
    }
    with _lock:
        _tail.append(event)


def since(cursor: int, limit: int) -> tuple[list[dict], int]:
    """Events newer than `cursor`, oldest first, plus the cursor to pass next time.

    The returned cursor is the newest id in the buffer rather than the newest id
    *returned*, so a caller that hits `limit` still moves past the overflow instead of
    walking a backlog it will never catch up with. Same reasoning as the buffer size:
    this feed is for showing what is happening now.
    """
    with _lock:
        events = [e for e in _tail if e["id"] > cursor]
        newest = _tail[-1]["id"] if _tail else cursor
    return events[-limit:], newest


def newest_id() -> int:
    """The current head, for a client that wants to start from "now" rather than
    replaying whatever the buffer happens to be holding."""
    with _lock:
        return _tail[-1]["id"] if _tail else 0
