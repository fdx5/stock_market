from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.services import activity_log, page_view_store, visitor_store
from app.services.admin_auth import require_admin
from app.services.visitor_tracker import tracker
from app.services import admin_auth

router = APIRouter()


class LoginPayload(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(payload: LoginPayload):
    result = admin_auth.login(payload.username, payload.password)
    if result is None:
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 올바르지 않습니다.")
    token, expires_at = result
    return {"token": token, "expires_at": expires_at}


@router.get("/summary", dependencies=[Depends(require_admin)])
def summary():
    since_24h = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    top_pages = page_view_store.counts_by_page(since_24h)[:5]
    return {
        "online_now": tracker.current_count(),
        "total_visits": visitor_store.total_count(),
        "views_last_24h": page_view_store.count_today(since_24h),
        "top_pages": top_pages,
    }


@router.get("/pages/trend", dependencies=[Depends(require_admin)])
def pages_trend(range: str = Query("24h", pattern="^(24h|7d|30d)$")):
    if range == "24h":
        since = datetime.now(timezone.utc) - timedelta(hours=24)
        bucket_chars = 16  # "...T14:05" — minute buckets
    else:
        since = datetime.now(timezone.utc) - timedelta(days=7 if range == "7d" else 30)
        bucket_chars = 10  # "...12-25" — daily buckets
    points = page_view_store.counts_by_bucket(since.isoformat(), bucket_chars)
    return {"range": range, "points": points}


@router.get("/live/tail", dependencies=[Depends(require_admin)])
def live_tail(limit: int = Query(100, ge=1, le=500)):
    return {"events": activity_log.recent_events(limit)}


@router.get("/live/sessions", dependencies=[Depends(require_admin)])
def live_sessions():
    return {"sessions": activity_log.active_sessions()}
