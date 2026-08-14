import itertools
import threading
import time
from collections import deque
from datetime import datetime, timezone

from app.services import hub_event_store, page_view_store, stock_search_store

# Bounds memory the same way visitor_tracker.py's session dict does: a fixed-size
# ring buffer for the live tail (oldest events just fall off) rather than growing
# without limit. page_view and click events both persist to page_view_store (the
# admin dashboard's "조회수"/trend/TOP-pages figures are a page-activity count,
# not navigations alone) and stock_view persists to stock_search_store.
TAIL_MAXLEN = 500

# A session counts as "currently active" for the live panel if its last reported
# event (page view, click, or stock view) was within this window — mirrors
# visitor_tracker.HEARTBEAT_TTL_SECONDS but slightly looser since activity events
# fire on interaction, not a fixed heartbeat cadence.
ACTIVE_TTL_SECONDS = 90

MAX_LABEL_LEN = 100
MAX_PATH_LEN = 200

_lock = threading.Lock()
_id_counter = itertools.count(1)
_tail: deque[dict] = deque(maxlen=TAIL_MAXLEN)
_sessions: dict[str, dict] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def record_event(
    session_id: str,
    event_type: str,
    path: str,
    label: str | None = None,
    stock_code: str | None = None,
    stock_name: str | None = None,
    action: str | None = None,
    object_key: str | None = None,
    value: float | None = None,
    referrer: str | None = None,
    source_channel: str | None = None,
    source_name: str | None = None,
    utm_source: str | None = None,
    utm_medium: str | None = None,
    utm_campaign: str | None = None,
) -> None:
    now = time.time()
    created_at = _now_iso()
    # Store one canonical key for an SPA route. Older/browser-specific clients can
    # include a query string, fragment, or trailing slash; treating those as separate
    # pages makes the admin UI label a known route as "기타".
    path = path.split("?", 1)[0].split("#", 1)[0].rstrip("/") or "/"
    path = path[:MAX_PATH_LEN]
    label = label[:MAX_LABEL_LEN] if label else None
    object_key = object_key[:MAX_LABEL_LEN] if object_key else None

    event = {
        "id": next(_id_counter),
        "created_at": created_at,
        "session_id": session_id,
        "type": event_type,
        "path": path,
        "label": label,
        "stock_code": stock_code,
        "stock_name": stock_name,
        # Only ever set on hub events. Carried on every event so the live tail
        # stays one uniform shape for the client to render.
        "action": action,
        "object_key": object_key,
        "value": value,
    }

    with _lock:
        _tail.append(event)
        state = _sessions.setdefault(session_id, {"first_seen": now})
        state["last_seen"] = now
        state["path"] = path
        if stock_code:
            state["stock_code"] = stock_code
            state["stock_name"] = stock_name
        # What the live panel shows beside a session on the entrance page: how
        # much of it they have actually touched, and how long they have been
        # there. Accumulated here rather than queried per poll — the live panel
        # refreshes on a timer and this is a dictionary lookup, not a table scan.
        if event_type == "hub":
            if action == "dwell" and value:
                state["hub_seconds"] = state.get("hub_seconds", 0.0) + float(value)
            elif action:
                state["hub_actions"] = state.get("hub_actions", 0) + 1

    if event_type in ("page_view", "click"):
        threading.Thread(
            target=page_view_store.record_page_view,
            args=(session_id, path, created_at, event_type, referrer, source_channel,
                  source_name, utm_source, utm_medium, utm_campaign),
            daemon=True,
        ).start()
    elif event_type == "hub" and action:
        threading.Thread(
            target=hub_event_store.record,
            args=(session_id, action, created_at, object_key, label, value),
            daemon=True,
        ).start()
    elif event_type == "stock_view" and stock_code and stock_name:
        # The frontend only ever calls reportStockView() for a real search
        # selection or a code carried in via a link (e.g. a market-map tile) —
        # the default Samsung Electronics landing on a bare "/" is deliberately
        # never reported (see Dashboard.tsx), so nothing extra to filter here.
        threading.Thread(
            target=stock_search_store.record_search,
            args=(session_id, stock_code, stock_name, created_at),
            daemon=True,
        ).start()


def recent_events(limit: int = 100) -> list[dict]:
    with _lock:
        events = list(_tail)[-limit:]
    events.reverse()
    return events


def active_sessions(ttl: float = ACTIVE_TTL_SECONDS) -> list[dict]:
    now = time.time()
    cutoff = now - ttl
    with _lock:
        stale = [sid for sid, state in _sessions.items() if state["last_seen"] < cutoff]
        for sid in stale:
            del _sessions[sid]
        items = [
            {
                "session_id": sid,
                "path": state["path"],
                "stock_code": state.get("stock_code"),
                "stock_name": state.get("stock_name"),
                "first_seen": state["first_seen"],
                "last_seen": state["last_seen"],
                "hub_actions": state.get("hub_actions", 0),
                "hub_seconds": state.get("hub_seconds", 0.0),
            }
            for sid, state in _sessions.items()
        ]
    items.sort(key=lambda item: item["last_seen"], reverse=True)
    return items
