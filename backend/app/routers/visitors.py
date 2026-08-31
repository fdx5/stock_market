from fastapi import APIRouter, Query, Request, Response

from app.services import bot_detector
from app.services.visitor_tracker import tracker
from app.utils import SESSION_ID_PATTERN, client_ip

router = APIRouter()

# It's the "no format check at all" gap that used to let a script mint unlimited
# distinct session_ids to both inflate the visitor counter and grow the tracker's
# in-memory session set without bound — see SESSION_ID_PATTERN's docstring.
_SESSION_ID_PATTERN = SESSION_ID_PATTERN


@router.get("/count")
def visitor_count(request: Request, response: Response, session_id: str = Query(..., pattern=_SESSION_ID_PATTERN)):
    # Crawlers run useVisitorCount.ts like any other client, so the counter this
    # endpoint feeds had been counting them as people. They still get an answer -
    # returning an error or a different shape to a crawler would be a difference worth
    # cloaking for, and there is nothing here to hide - but their heartbeat no longer
    # registers a session.
    is_bot = bot_detector.is_bot(request.headers.get("user-agent"))
    current, total = tracker.heartbeat(session_id, client_ip(request), is_bot=is_bot)
    # This endpoint is a heartbeat, not a cacheable count lookup. In particular a
    # custom-domain CDN replaying a cached 200 means the browser looks healthy while
    # the origin expires it from the active set after 60 seconds.
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return {"count": current, "total": total}
