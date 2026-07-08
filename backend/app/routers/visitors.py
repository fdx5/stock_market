from fastapi import APIRouter, Query

from app.services.visitor_tracker import tracker

router = APIRouter()


@router.get("/count")
def visitor_count(session_id: str = Query(...)):
    return {"count": tracker.heartbeat(session_id)}
