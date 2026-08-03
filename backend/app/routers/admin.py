from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel

from app.services import (
    activity_log,
    dram_price,
    kakao_notify,
    page_view_store,
    prediction_batch,
    prediction_store,
    stock_search_store,
    visitor_store,
)
from app.services.admin_auth import require_admin
from app.services.visitor_tracker import tracker
from app.services import admin_auth

router = APIRouter()


class LoginPayload(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(payload: LoginPayload):
    try:
        result = admin_auth.login(payload.username, payload.password)
    except admin_auth.AccountLockedError:
        raise HTTPException(
            status_code=423,
            detail="로그인 5회 실패로 계정이 잠겼습니다. 비밀번호를 변경할 때까지 로그인할 수 없습니다.",
        )
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
    "3d": (timedelta(days=3), "day"),
    "7d": (timedelta(days=7), "day"),
    "30d": (timedelta(days=30), "day"),
}


@router.get("/pages/trend", dependencies=[Depends(require_admin)])
def pages_trend(range: str = Query("24h", pattern="^(1h|3h|6h|12h|24h|3d|7d|30d)$")):
    delta, granularity = _RANGE_CONFIG[range]
    since = datetime.now(timezone.utc) - delta
    points = page_view_store.counts_by_bucket(since.isoformat(), granularity)
    return {"range": range, "points": points}


@router.get("/pages/visitor-trend", dependencies=[Depends(require_admin)])
def pages_visitor_trend(range: str = Query("24h", pattern="^(1h|3h|6h|12h|24h|3d|7d|30d)$")):
    """Same range/bucketing as /pages/trend (the admin dashboard's trend panel can
    toggle between the two without changing any of its other query controls), one
    distinct-session count per bucket instead of a per-page breakdown."""
    delta, granularity = _RANGE_CONFIG[range]
    since = datetime.now(timezone.utc) - delta
    points = page_view_store.unique_visitors_by_bucket(since.isoformat(), granularity)
    return {"range": range, "points": points}


# Both ranking panels (unlike the trend chart) always aggregate over a fixed
# 1-week window regardless of the chart's own selected range — a ranking that
# reshuffled every time someone flipped the chart to "1시간" would be more
# confusing than useful.
_RANKING_WINDOW = timedelta(days=7)


# The admin ranking lists scroll past their top ten now, so these ceilings are
# what actually bounds them. Both are well past the real cardinality: the app
# has a couple of dozen distinct routes, and a stock ranking is filtered client
# side to searches with double-digit counts before it is drawn.
@router.get("/pages/top", dependencies=[Depends(require_admin)])
def pages_top(limit: int = Query(7, ge=1, le=200)):
    since = (datetime.now(timezone.utc) - _RANKING_WINDOW).isoformat()
    items = page_view_store.counts_by_page(since)[:limit]
    return {"items": items}


@router.get("/stocks/top", dependencies=[Depends(require_admin)])
def stocks_top(limit: int = Query(10, ge=1, le=500)):
    since = (datetime.now(timezone.utc) - _RANKING_WINDOW).isoformat()
    items = stock_search_store.top_searches(since, limit)
    return {"items": items}


@router.get("/live/tail", dependencies=[Depends(require_admin)])
def live_tail(limit: int = Query(100, ge=1, le=500)):
    return {"events": activity_log.recent_events(limit)}


@router.get("/live/sessions", dependencies=[Depends(require_admin)])
def live_sessions():
    return {"sessions": activity_log.active_sessions()}


@router.get("/prediction/status", dependencies=[Depends(require_admin)])
def prediction_status():
    """Batch health for the admin panel: what's running, each region's last outcome,
    and the DB-derived per-market snapshot."""
    return prediction_batch.get_status()


@router.get("/notify/kakao/visitors/status", dependencies=[Depends(require_admin)])
def kakao_notify_visitors_status():
    """'사이트 방문자 현황' card: whether the Kakao integration has a stored token yet,
    and how the last send (by any of the three triggers — cron, in-process fallback,
    or this panel's own button) went. `last_run` is None only if the process hasn't
    run it even once since it last restarted. `token` carries the stored token's two
    expiry timestamps (no token material) so a refresh token nearing its ~2-month end
    is visible here before it takes the notifications down."""
    return {
        "configured": kakao_notify.is_configured(),
        "last_run": kakao_notify.get_last_visitor_run(),
        "token": kakao_notify.describe_token(),
    }


@router.post("/notify/kakao/visitors/run", dependencies=[Depends(require_admin)])
def kakao_notify_visitors_run():
    """Manual send from the '사이트 방문자 현황' card's '지금 발송' button. Always
    force=True — a deliberate click should always actually send, bypassing the
    _MIN_INTERVAL guard that only exists to stop the hourly cron and the in-process
    fallback from double-sending within the same hour. Runs inline (unlike the
    prediction batch's background+poll dance) because a Kakao send takes a couple
    seconds, not minutes."""
    return kakao_notify.run_visitor_stats(force=True, triggered_by="admin")


@router.get("/notify/kakao/prediction/status", dependencies=[Depends(require_admin)])
def kakao_notify_prediction_status():
    """'AI 예측 배치 실행결과' card: per-region (KR/US) last-send outcome. A region is
    absent from `last_runs` if no send (scheduled or manual) has completed for it
    since this process last restarted. `token` is the same expiry view as the visitor
    card's — one integration, one token."""
    return {
        "configured": kakao_notify.is_configured(),
        "last_runs": kakao_notify.get_last_prediction_runs(),
        "token": kakao_notify.describe_token(),
    }


@router.post("/notify/kakao/prediction/run", dependencies=[Depends(require_admin)])
def kakao_notify_prediction_run(region: str = Query(..., pattern=r"^(KR|US)$")):
    """Manual send from the '지금 발송' button in the same card, for one region.
    Describes that region's last batch outcome rather than re-running the batch — this
    button resends the notification for whatever already happened.

    Goes through prediction_batch.last_run_or_snapshot rather than reading
    get_status()['last_runs'] directly: that dict only remembers runs *this process*
    performed, so after any restart (every deploy, and each region only runs about once
    a day) it is empty and this button answered 404 for both regions even though the
    batch results were sitting in the database. The 404 now means what it says — no
    stored rows for the region at all."""
    summary = prediction_batch.last_run_or_snapshot(region)
    if summary is None:
        raise HTTPException(
            status_code=404,
            detail=f"{region} 배치 실행 이력이 없습니다. 배치를 먼저 실행해 주세요.",
        )
    return kakao_notify.send_prediction_result(region, summary, triggered_by="admin")


@router.post("/prediction/run", dependencies=[Depends(require_admin)])
def prediction_run(background: BackgroundTasks, region: str = Query(..., pattern=r"^(KR|US)$")):
    """Admin-triggered manual re-run. Authenticated by the admin session, NOT the
    PREDICTION_BATCH_TOKEN cron secret — so the dashboard can trigger a batch without
    that secret ever reaching the browser.

    Always force=True (a manual re-run means 'regenerate this session', deleting and
    recreating the day's rows — see prediction_batch/prediction_store). Runs in the
    background because a full region takes minutes; the panel polls /prediction/status
    to watch it. Refuses if that region is already in flight so a double-click can't
    stack two runs.
    """
    if prediction_batch.is_running(region):
        raise HTTPException(status_code=409, detail=f"{region} 배치가 이미 실행 중입니다.")
    background.add_task(prediction_batch.run_batch, region, True, "admin")
    return {"region": region, "status": "accepted"}


@router.get("/dram-price/status", dependencies=[Depends(require_admin)])
def dram_price_status():
    """DRAM 현물가격 배치 health for the admin panel: in-flight state, this process's
    last outcome, and the DB-derived latest stored date/item count (restart-proof)."""
    return dram_price.get_status()


@router.post("/dram-price/run", dependencies=[Depends(require_admin)])
def dram_price_run(background: BackgroundTasks):
    """Admin-triggered manual re-run. Authenticated by the admin session, NOT the
    DRAM_PRICE_REFRESH_TOKEN cron secret — so the dashboard can trigger a batch without
    that secret ever reaching the browser. Runs in the background (a scrape+DB write
    takes a couple seconds, not minutes, but the shape mirrors /prediction/run so the
    panel's polling logic is identical); refuses if a run is already in flight."""
    if dram_price.is_running():
        raise HTTPException(status_code=409, detail="DRAM 현물가격 배치가 이미 실행 중입니다.")
    background.add_task(dram_price.run_batch, "admin")
    return {"status": "accepted"}


@router.get("/notify/kakao/dram-price/status", dependencies=[Depends(require_admin)])
def kakao_notify_dram_price_status():
    """'D램 현물가격 배치 실행결과' card: last-send outcome, regardless of which
    trigger (the ~10분 지연 auto-send after a batch run, or this panel's own button)
    produced it. `token` is the same expiry view the other Kakao cards use."""
    return {
        "configured": kakao_notify.is_configured(),
        "last_run": kakao_notify.get_last_dram_run(),
        "token": kakao_notify.describe_token(),
    }


@router.post("/notify/kakao/dram-price/run", dependencies=[Depends(require_admin)])
def kakao_notify_dram_price_run():
    """Manual send from the '지금 발송' button in the same card. Resends the last
    recorded batch outcome rather than re-running the batch."""
    summary = dram_price.get_status()["last_run"]
    if summary is None:
        raise HTTPException(
            status_code=404, detail="DRAM 현물가격 배치 실행 이력이 없습니다. 배치를 먼저 실행해 주세요."
        )
    return kakao_notify.send_dram_result(summary, triggered_by="admin")


@router.delete("/prediction", dependencies=[Depends(require_admin)])
def prediction_delete(
    predict_date: str = Query(..., pattern=r"^\d{8}$"),
    market: str = Query(..., pattern=r"^(KOSPI|KOSDAQ|NASDAQ)$"),
):
    """Takes down one (예측일자, 시장) slice with no replacement — for a day already
    known to be wrong (bad upstream data, a bug since fixed) that shouldn't keep
    showing on the page while nobody has decided yet whether/when to regenerate it.
    Deliberately separate from `/prediction/run`, which always deletes *and*
    regenerates in the same call — sometimes the right next step is just "make the bad
    rows go away" without also kicking off a multi-minute rerun in the same breath.
    """
    deleted = prediction_store.delete_predictions_by_predict_date(predict_date, market)
    return {"predict_date": predict_date, "market": market, "deleted": deleted}
