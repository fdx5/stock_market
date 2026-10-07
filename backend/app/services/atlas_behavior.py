"""Admin-only, bounded session behavior projection; never queries or writes a DB."""
import hashlib
import hmac
import secrets
from collections import defaultdict

WINDOW_SECONDS = 900
EVENTS_PER_SESSION = 80
_alias_key = secrets.token_bytes(32)


def _alias(session_id: str) -> str:
    # Stable within this process; never expose the browser's original session key.
    return hmac.new(_alias_key, session_id.encode(), hashlib.sha256).hexdigest()[:16]


def _group(path: str) -> str:
    if path.startswith(("/realestate", "/complex", "/apart")):
        return "realestate"
    if path.startswith(("/news", "/discussion", "/board")):
        return "community"
    if path.startswith(("/ai-", "/prediction", "/forecast", "/grading")):
        return "prediction"
    if path.startswith("/support"):
        return "support"
    return "market"


def snapshot(now: float) -> dict:
    from app.services import activity_log, visitor_tracker
    retained, states = activity_log.behavior_state()
    presence = visitor_tracker.tracker.observed_presence(now)
    grouped = defaultdict(list)
    for event in retained:
        if not now - WINDOW_SECONDS <= event["ts"] <= now:
            continue
        if event["path"].startswith("/admin") or event["type"] not in ("page_view", "click", "stock_view", "hub"):
            continue
        if event["type"] == "hub" and event.get("action") == "dwell":
            continue
        sid = event["session_id"]
        path = event["path"].split("?", 1)[0].split("#", 1)[0][:200]
        grouped[sid].append({"id": event["id"], "ts": event["ts"], "type": event["type"],
                             "path": path, "group": _group(path),
                             "label": (event.get("label") or "")[:100],
                             "stock_code": (event.get("stock_code") or "")[:20],
                             "stock_name": (event.get("stock_name") or "")[:100],
                             "action": event.get("action")})
    # Quiet but still connected tabs remain observable, without heartbeat log rows.
    candidates = set(grouped) | set(presence)
    sessions = []
    truncated = len(retained) == activity_log.BEHAVIOR_MAXLEN and retained[0]["ts"] > now - WINDOW_SECONDS
    event_count = 0
    for sid in candidates:
        events = sorted(grouped[sid], key=lambda e: (e["ts"], e["id"]))
        state = states.get(sid, {})
        last_seen = events[-1]["ts"] if events else state.get("last_seen", presence.get(sid, now))
        active = now - activity_log.ACTIVE_TTL_SECONDS <= last_seen <= now and bool(events)
        event_count += len(events)
        truncated |= len(events) > EVENTS_PER_SESSION
        sessions.append({"id": _alias(sid), "first_seen": state.get("first_seen", events[0]["ts"] if events else last_seen),
                         "last_seen": last_seen, "last_heartbeat": presence.get(sid),
                         "online": sid in presence, "active": active,
                         "path": events[-1]["path"] if events else "",
                         "events": events[-EVENTS_PER_SESSION:]})
    sessions.sort(key=lambda s: (s["online"], s["active"], s["last_seen"], s["id"]), reverse=True)
    return {"window_s": WINDOW_SECONDS, "capacity": activity_log.BEHAVIOR_MAXLEN,
            "event_count": event_count, "online_count": len(presence),
            "active_count": sum(s["active"] for s in sessions),
            "truncated": truncated, "sessions": sessions}
