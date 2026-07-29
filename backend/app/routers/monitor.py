"""Feeds for the admin monitor's neuron view: the wiring diagram, and the live signal.

Two endpoints, deliberately shaped around what an animation needs rather than what a
table needs. `/graph` is fetched once and is pure structure. `/pulse` is polled and
carries only what has happened since the caller's cursor — so a viewer that has been
open for an hour is sending and receiving the same tiny payload as one that just opened.
"""

from fastapi import APIRouter, Depends, Query, Request

from app.services import activity_log, api_pulse, site_graph
from app.services.admin_auth import require_admin

router = APIRouter(dependencies=[Depends(require_admin)])


@router.get("/graph")
def graph(request: Request):
    """The site's structure: page nodes, api nodes, store/upstream nodes, and the edges
    between them. See services/site_graph for which parts are derived and which curated.

    Built per request rather than cached: it is fetched once per viewer, it costs a walk
    over the route table, and caching it would mean a route added by a future deploy
    could be missing from a diagram whose entire job is to be accurate.
    """
    return site_graph.build_graph(request.app.routes)


@router.get("/pulse")
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
