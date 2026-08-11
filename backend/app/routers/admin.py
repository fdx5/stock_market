from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel

from app.services import (
    activity_log,
    dram_price,
    hub_event_store,
    kakao_notify,
    mail_subscription_store,
    page_view_store,
    prediction_batch,
    prediction_mail,
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


# ── the entrance page's own behaviour ──
#
# Kept apart from the page and stock endpoints above on purpose. Those answer
# "where did people go" and "what did they look up"; these answer "what did
# people DO once they were on the front page", which is a different question
# with different units — objects touched rather than paths visited, and seconds
# stayed rather than arrivals counted. Mixing them would make both harder to
# read and would put dwell seconds into counts that mean views.


@router.get("/hub/summary", dependencies=[Depends(require_admin)])
def hub_summary(range: str = Query("24h", pattern="^(1h|3h|6h|12h|24h|3d|7d|30d)$")):
    """The tiles: how many sessions, how long they stayed, how much they touched.

    `avg_seconds` and `median_seconds` are both returned because they disagree
    here and the disagreement matters — a few visitors leave the orbit running
    and pull the mean well above a typical stay."""
    delta, _ = _RANGE_CONFIG[range]
    since = (datetime.now(timezone.utc) - delta).isoformat()
    totals = hub_event_store.action_totals(since)
    dwell = hub_event_store.dwell_stats(since)
    sessions = hub_event_store.session_count(since)
    clicks = totals.get("object_click", 0)
    return {
        "range": range,
        "sessions": sessions,
        "totals": totals,
        "dwell": dwell,
        # Touches per session. The single number that says whether the page is
        # something people use or something they look at once and leave.
        "clicks_per_session": (clicks / sessions) if sessions else 0.0,
        # Of the sessions that reached the page, how many turned the music on.
        "bgm_sessions": totals.get("bgm", 0),
    }


@router.get("/hub/trend", dependencies=[Depends(require_admin)])
def hub_trend(range: str = Query("24h", pattern="^(1h|3h|6h|12h|24h|3d|7d|30d)$")):
    """Entrance-page events per action per bucket — the same ranges and the same
    KST bucketing the page trend uses, so one set of range buttons drives both."""
    delta, granularity = _RANGE_CONFIG[range]
    since = datetime.now(timezone.utc) - delta
    return {"range": range, "points": hub_event_store.counts_by_bucket(since.isoformat(), granularity)}


@router.get("/hub/objects/top", dependencies=[Depends(require_admin)])
def hub_objects_top(
    limit: int = Query(200, ge=1, le=500),
    action: str | None = Query(None, pattern="^(object_click|control|bgm|focus|exit)$"),
):
    """The 메인 반응 순위. Fixed 7-day window like the other two rankings, so
    flipping the chart's range never reshuffles a ranking underneath it.

    `action` narrows it to one kind of interaction; left off, every object the
    page can report is ranked together."""
    since = (datetime.now(timezone.utc) - _RANKING_WINDOW).isoformat()
    return {"items": hub_event_store.top_objects(since, limit, action)}


@router.get("/hub/session/{session_id}", dependencies=[Depends(require_admin)])
def hub_session(session_id: str, limit: int = Query(200, ge=1, le=500)):
    """One visitor's trail through the page, oldest first — what the live log's
    session row expands into."""
    return {"session_id": session_id, "events": hub_event_store.session_detail(session_id, limit)}


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


@router.get("/mail/status", dependencies=[Depends(require_admin)])
def mail_status():
    """'예측 메일 발송' card: one row per subscribed account, plus today's send count.

    Addresses arrive masked and stay masked — the panel keys its rows on the mask and
    sends it back to trigger a send, so the clear address never reaches the browser at
    all. See mail_subscription_store.mask.
    """
    summary = mail_subscription_store.today_summary()
    accounts = [
        {**target, **summary.get(target["id"], {"sent_today": 0, "last_sent_at": None})}
        for target in mail_subscription_store.list_targets()
    ]
    return {
        "configured": prediction_mail.is_configured(),
        # Which transport is live — "resend" or "smtp". The two fail in different ways
        # and this is the only screen that can say which one is in play.
        "backend": prediction_mail.backend_name(),
        # Whether SMTP is standing behind the API transport. It matters to whoever
        # reads this screen because it decides what happens to a second subscriber:
        # an unverified Resend sender reaches only the Resend account's own address,
        # and with this false every other account's mail simply fails.
        "smtp_fallback": (
            prediction_mail.backend_name() == "resend" and prediction_mail.smtp_configured()
        ),
        # Presence-only view of the mail settings this process can see. Returned
        # always, not just on failure, so the panel can explain "발송 설정 필요"
        # instead of only stating it. Never carries a value.
        "diagnosis": prediction_mail.config_diagnosis(),
        "accounts": accounts,
        "today": mail_subscription_store.seoul_today(),
    }


@router.get("/mail/history", dependencies=[Depends(require_admin)])
def mail_history(limit: int = Query(60, ge=1, le=300)):
    """발송이력, newest first. Failed attempts are included on purpose — an empty list
    and a list of failures mean very different things to whoever is debugging why a
    mail never arrived."""
    return {"items": mail_subscription_store.recent_sends(limit=limit)}


@router.post("/mail/send", dependencies=[Depends(require_admin)])
def mail_send(
    account: str | None = Query(None, description="계정 id (mail/status의 accounts[].id). 생략 시 전체"),
    date: str | None = Query(None, pattern=r"^\d{8}$"),
):
    """The 수기 발송 button.

    Manual by definition, so it bypasses the once-a-day cap the scheduled batch
    observes — an operator pressing this a second time means it. Runs inline rather
    than in the background: a handful of mails is a few seconds, and the panel's whole
    value is showing what actually happened rather than 'accepted'.
    """
    if not prediction_mail.is_configured():
        raise HTTPException(
            status_code=503,
            detail="메일 발송이 설정되지 않았습니다. PREDICTION_MAIL_USER / PREDICTION_MAIL_PASSWORD 를 등록해 주세요.",
        )
    return prediction_mail.send_subscriptions(
        predict_date=date, manual=True, only_account=account
    )


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
