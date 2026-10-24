from urllib.parse import urlparse

from fastapi import APIRouter, BackgroundTasks, Query, Request, Response

from app.services import audience_analytics, audience_live, bot_detector
from app.site import PRIMARY_SITE_HOST, LEGACY_RENDER_HOST
from app.services.visitor_tracker import tracker
from app.utils import SESSION_ID_PATTERN, client_ip

router = APIRouter()

# It's the "no format check at all" gap that used to let a script mint unlimited
# distinct session_ids to both inflate the visitor counter and grow the tracker's
# in-memory session set without bound — see SESSION_ID_PATTERN's docstring.
_SESSION_ID_PATTERN = SESSION_ID_PATTERN


@router.get("/count")
def visitor_count(request: Request, response: Response, background_tasks: BackgroundTasks,
                  session_id: str = Query(..., pattern=_SESSION_ID_PATTERN)):
    # Crawlers run useVisitorCount.ts like any other client, so the counter this
    # endpoint feeds had been counting them as people. They still get an answer -
    # returning an error or a different shape to a crawler would be a difference worth
    # cloaking for, and there is nothing here to hide - but their heartbeat no longer
    # registers a session.
    is_bot = bot_detector.is_bot(request.headers.get("user-agent"))
    current, total = tracker.heartbeat(session_id, client_ip(request), is_bot=is_bot)
    # Existing real browser presence is also a collection opportunity for tabs
    # opened before the map release and for background tabs. Do not depend on a
    # second JS timer or persistent browser ID just to retain a valid tab visit.
    # Only public same-site pages qualify; leave missing referrers out rather
    # than assuming they belong to a public page.
    try:
        referrer = urlparse(request.headers.get("referer", ""))
        public_page = (referrer.scheme in {"https", "http"}
                       and referrer.hostname in {PRIMARY_SITE_HOST, LEGACY_RENDER_HOST}
                       and bool(referrer.path)
                       and not referrer.path.rstrip("/").startswith("/admin"))
    except ValueError:
        public_page = False
    audience_analytics.note_heartbeat(public_page)
    if public_page:
        observation = audience_analytics.context(request, None, session_id, is_bot, allow_session_only=True)
        if observation:
            background_tasks.add_task(audience_live.record, observation)
    # This endpoint is a heartbeat, not a cacheable count lookup. In particular a
    # custom-domain CDN replaying a cached 200 means the browser looks healthy while
    # the origin expires it from the active set after 60 seconds.
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return {"count": current, "total": total}
