"""Feeds for the admin monitor's neuron view: the wiring diagram, and the live signal.

Two feeds, deliberately shaped around what an animation needs rather than what a table
needs. `/graph` is fetched once and is pure structure. `/pulse` is polled and carries
only what has happened since the caller's cursor — so a viewer that has been open for an
hour is sending and receiving the same tiny payload as one that just opened.

The third endpoint is the door. The view is meant to be openable from outside without
handing over the admin account, so `/unlock` trades a passcode for a monitor-scoped
session that reaches these two endpoints and nothing else — see admin_auth's SCOPE_
constants. It is the one route here that is not itself behind that session.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from app.services import activity_log, admin_auth, api_pulse, site_graph
from app.services.admin_auth import require_monitor
from app.utils import client_ip

router = APIRouter()


class UnlockPayload(BaseModel):
    passcode: str


@router.post("/unlock")
def unlock(payload: UnlockPayload, request: Request):
    """Passcode → monitor session. Throttled per client rather than locked outright: a
    door that anyone may knock on must not be lockable for everyone by a stranger
    knocking wrong (see admin_auth._monitor_failures)."""
    try:
        result = admin_auth.unlock_monitor(payload.passcode, client_ip(request) or "unknown")
    except admin_auth.TooManyAttemptsError as exc:
        raise HTTPException(
            status_code=429,
            detail=f"시도가 너무 많습니다. {max(1, exc.retry_after // 60)}분 후에 다시 시도해 주세요.",
            headers={"Retry-After": str(exc.retry_after)},
        )
    if result is None:
        raise HTTPException(status_code=401, detail="패스코드가 올바르지 않습니다.")
    token, expires_at = result
    return {"token": token, "expires_at": expires_at}


@router.get("/graph", dependencies=[Depends(require_monitor)])
def graph(request: Request):
    """The site's structure: page nodes, api nodes, store/upstream nodes, and the edges
    between them. See services/site_graph for which parts are derived and which curated.

    Built per request rather than cached: it is fetched once per viewer, it costs a walk
    over the route table, and caching it would mean a route added by a future deploy
    could be missing from a diagram whose entire job is to be accurate.
    """
    return site_graph.build_graph(request.app.routes)


@router.get("/pulse", dependencies=[Depends(require_monitor)])
def pulse(
    api_cursor: int = Query(0, ge=0),
    activity_cursor: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=500),
):
    """Everything that has fired since the caller's cursors.

    Two independent cursors because the two streams have independent id sequences
    (api_pulse and activity_log each count their own). `cursor=0` on a first call would
    replay whatever the ring buffers happen to hold, which for a live view is noise —
    so a client that wants to start clean asks for `?api_cursor=-1`-style behaviour by
    reading the returned cursors from an empty first call. Simpler in practice: the
    frontend does one priming call, keeps the cursors, and ignores the events.
    """
    api_events, api_next = api_pulse.since(api_cursor, limit)

    # activity_log's tail is newest-first and has no "since" of its own; it is small
    # (500) and polled at a human cadence, so filtering here is cheaper than adding an
    # index to it.
    activity_events = [e for e in activity_log.recent_events(limit) if e["id"] > activity_cursor]
    activity_events.reverse()
    activity_next = max([e["id"] for e in activity_events], default=activity_cursor)

    return {
        "api_cursor": api_next,
        "activity_cursor": activity_next,
        "api": api_events,
        "activity": activity_events,
        "active_sessions": len(activity_log.active_sessions()),
    }
