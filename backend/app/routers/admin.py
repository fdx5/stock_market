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


# (timedelta, granularity) per range — anything an hour scale or finer buckets by
# minute so the chart stays continuous even over a short window; day-scale ranges
# bucket by day so a month of points doesn't mean a month of per-minute rows.
_RANGE_CONFIG: dict[str, tuple[timedelta, str]] = {
    "1h": (timedelta(hours=1), "minute"),
    "3h": (timedelta(hours=3), "minute"),
    "6h": (timedelta(hours=6), "minute"),
    "12h": (timedelta(hours=12), "minute"),
    "24h": (timedelta(hours=24), "minute"),
    "7d": (timedelta(days=7), "day"),
    "30d": (timedelta(days=30), "day"),
}


@router.get("/pages/trend", dependencies=[Depends(require_admin)])
def pages_trend(range: str = Query("24h", pattern="^(1h|3h|6h|12h|24h|7d|30d)$")):
    delta, granularity = _RANGE_CONFIG[range]
    since = datetime.now(timezone.utc) - delta
    points = page_view_store.counts_by_bucket(since.isoformat(), granularity)
    return {"range": range, "points": points}


@router.get("/live/tail", dependencies=[Depends(require_admin)])
def live_tail(limit: int = Query(100, ge=1, le=500)):
    return {"events": activity_log.recent_events(limit)}


@router.get("/live/sessions", dependencies=[Depends(require_admin)])
def live_sessions():
    return {"sessions": activity_log.active_sessions()}
