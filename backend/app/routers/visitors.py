from fastapi import APIRouter, Query, Request

from app.services import bot_detector
from app.services.visitor_tracker import tracker
from app.utils import SESSION_ID_PATTERN, client_ip

router = APIRouter()

# It's the "no format check at all" gap that used to let a script mint unlimited
# distinct session_ids to both inflate the visitor counter and grow the tracker's
# in-memory session set without bound — see SESSION_ID_PATTERN's docstring.
_SESSION_ID_PATTERN = SESSION_ID_PATTERN


@router.get("/count")
def visitor_count(request: Request, session_id: str = Query(..., pattern=_SESSION_ID_PATTERN)):
    # Crawlers run useVisitorCount.ts like any other client, so the counter this
    # endpoint feeds had been counting them as people. They still get an answer -
    # returning an error or a different shape to a crawler would be a difference worth
    # cloaking for, and there is nothing here to hide - but their heartbeat no longer
    # registers a session.
    is_bot = bot_detector.is_bot(request.headers.get("user-agent"))
    current, total = tracker.heartbeat(session_id, client_ip(request), is_bot=is_bot)
    return {"count": current, "total": total}
