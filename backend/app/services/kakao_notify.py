import json
import os
import threading
import time
from datetime import datetime, timedelta, timezone

import requests
from dotenv import load_dotenv

from app.services import kakao_token_store, notify_stats_store, page_view_store, visitor_store
from app.services.visitor_tracker import tracker

load_dotenv()

# No default: like PREDICTION_BATCH_TOKEN in prediction.py, an unset key just disables
# the feature (run() below returns "not_configured") rather than crashing the hourly
# cron every time it fires.
KAKAO_REST_API_KEY = os.environ.get("KAKAO_REST_API_KEY")
# Only needed if "보안 > Client Secret" was turned on for this app in Kakao Developers;
# most apps leave it off, in which case this stays unset and is simply omitted below.
KAKAO_CLIENT_SECRET = os.environ.get("KAKAO_CLIENT_SECRET")

KAKAO_TOKEN_URL = "https://kauth.kakao.com/oauth/token"
KAKAO_SEND_URL = "https://kapi.kakao.com/v2/api/talk/memo/default/send"

# Same production URL the existing cron workflows (ai-prediction.yml, keep-alive.yml)
# already hit — kept as a plain constant here for the same reason: this app runs as a
# single deployed instance, not something with multiple environments to parameterize.
SITE_URL = "https://kospi-predictor.onrender.com"

# Refresh proactively once the access token has less than this long left, so a
# borderline-expired token from a slow request never gets used. Kakao's access tokens
# last ~6 hours and this job runs hourly, so in practice this fires on roughly every
# 5th-6th run, not every run.
_REFRESH_MARGIN = timedelta(minutes=10)

# This job has two independent triggers (GitHub Actions cron and main.py's in-process
# fallback — same dual-trigger shape as prediction_batch, for when Render's free-tier
# instance sleeps through GitHub's cron), and unlike the prediction batch there is no
# natural idempotency key to de-dupe on: every call just sends "the current numbers".
# If both triggers land within the same hour, skipping a run that's this soon after the
# last recorded snapshot is what stops the admin from getting two KakaoTalk messages
# back to back instead of one.
_MIN_INTERVAL = timedelta(minutes=50)

# The admin dashboard's manual "지금 발송" button (see routers/admin.py) and its
# polling read of "what happened last" both need the *same* record regardless of
# which trigger (cron, in-process fallback, or that button) produced it — mirrors
# prediction_batch's own volatile in-memory _last_runs cache. Resets on restart,
# which is fine: there is nothing to recover, just "what happened since boot".
#
# Named "visitor" to distinguish it from the separate 예측 배치 결과 notification's own
# cache below (_last_prediction_runs) — two independent message types, two caches.
_last_visitor_run_lock = threading.Lock()
_last_visitor_run: dict | None = None


def _record_last_visitor_run(result: dict) -> dict:
    global _last_visitor_run
    with _last_visitor_run_lock:
        _last_visitor_run = result
    return result


def get_last_visitor_run() -> dict | None:
    with _last_visitor_run_lock:
        return _last_visitor_run


# One slot per region (KR/US run independently, ~14 hours apart) rather than a single
# value — the admin dashboard's 예측 배치 결과 card shows both at once, same shape as
# prediction_batch's own per-region _last_runs.
_last_prediction_lock = threading.Lock()
_last_prediction_runs: dict[str, dict] = {}


def _record_last_prediction_run(region: str, result: dict) -> dict:
    with _last_prediction_lock:
        _last_prediction_runs[region] = result
    return result


def get_last_prediction_run(region: str) -> dict | None:
    with _last_prediction_lock:
        return _last_prediction_runs.get(region)


def get_last_prediction_runs() -> dict[str, dict]:
    with _last_prediction_lock:
        return dict(_last_prediction_runs)


def is_configured() -> bool:
    return bool(KAKAO_REST_API_KEY) and kakao_token_store.get() is not None


def describe_token() -> dict | None:
    """Expiry-only view of the stored token for the admin dashboard's 카카오 알림 cards.
    Deliberately carries no token material — just the two timestamps that explain the
    two ways this integration goes quiet: the access token expiring (normal, refreshed
    automatically) and the refresh token expiring (~2 months, needs
    scripts/kakao_get_refresh_token.py run again). Without these on screen there is no
    way to tell "about to re-auth" from "already dead" until a send fails."""
    stored = kakao_token_store.get()
    if stored is None:
        return None
    return {
        "access_expires_at": stored["access_expires_at"],
        "refresh_expires_at": stored["refresh_expires_at"],
    }


class KakaoNotConfigured(Exception):
    """Raised when KAKAO_REST_API_KEY is unset or no refresh token has been stored yet
    (see scripts/kakao_get_refresh_token.py for the one-time setup that provides it)."""


class KakaoApiError(Exception):
    """A Kakao HTTP call that came back non-2xx (or 200 with a failing result_code).

    Exists because requests' own HTTPError stops at "401 Client Error: Unauthorized
    for url: https://kauth.kakao.com/oauth/token", which is the same string for every
    possible cause — and that string was all the admin dashboard could show. Kakao puts
    the actual reason in the response body, so this carries it through to the dashboard
    instead of throwing it away at the raise_for_status() call.
    """

    def __init__(self, message: str, status_code: int | None = None, code=None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


# Kakao's error bodies name the failure but not the fix; these map the codes this
# integration can actually hit onto the specific thing to go change. KOE010 in
# particular is what a server missing KAKAO_CLIENT_SECRET looks like — the same token
# refresh succeeds from a machine whose .env has it, which is exactly how it stays
# hidden until you compare the two.
_KAKAO_ERROR_HINTS = {
    "KOE010": (
        "앱 키/Client Secret이 카카오 앱 설정과 일치하지 않습니다. "
        "배포 환경의 KAKAO_REST_API_KEY와 KAKAO_CLIENT_SECRET 환경변수를 확인하세요 "
        "(카카오 개발자 콘솔에서 Client Secret을 켰다면 서버에도 반드시 설정해야 합니다)."
    ),
    "KOE320": "인가 코드가 유효하지 않습니다. scripts/kakao_get_refresh_token.py로 토큰을 다시 발급하세요.",
    "-401": "토큰이 만료되었거나 연결이 해제되었습니다. scripts/kakao_get_refresh_token.py로 다시 인증하세요.",
    "-402": "카카오 앱에 '카카오톡 메시지 전송(talk_message)' 동의항목 권한이 없습니다.",
    "-403": "메시지 전송 한도를 초과했습니다. 잠시 후 다시 시도하세요.",
}


def _kakao_error(action: str, resp: requests.Response) -> KakaoApiError:
    """Turns a failed Kakao response into a message an admin can act on. The two Kakao
    hosts disagree on error schema — kauth (토큰) answers with error/error_description/
    error_code, kapi (메시지) with msg/code — so both spellings are read here."""
    try:
        body = resp.json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        body = {}

    code = body.get("error_code", body.get("code"))
    detail = (
        body.get("error_description")
        or body.get("msg")
        or body.get("error")
        or (resp.text or "").strip()[:200]
    )

    message = f"{action} 실패 (HTTP {resp.status_code})"
    if detail:
        message += f": {detail}"
    if code is not None:
        message += f" [{code}]"
    hint = _KAKAO_ERROR_HINTS.get(str(code))
    if hint:
        message += f" — {hint}"
    return KakaoApiError(message, status_code=resp.status_code, code=code)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _refresh_access_token(stored: dict) -> str:
    if not KAKAO_REST_API_KEY:
        raise KakaoNotConfigured("KAKAO_REST_API_KEY is not set")

    payload = {
        "grant_type": "refresh_token",
        "client_id": KAKAO_REST_API_KEY,
        "refresh_token": stored["refresh_token"],
    }
    if KAKAO_CLIENT_SECRET:
        payload["client_secret"] = KAKAO_CLIENT_SECRET

    resp = requests.post(KAKAO_TOKEN_URL, data=payload, timeout=10)
    if not resp.ok:
        raise _kakao_error("카카오 토큰 갱신", resp)
    data = resp.json()

    now = datetime.now(timezone.utc)
    access_token = data["access_token"]
    access_expires_at = _iso(now + timedelta(seconds=data["expires_in"]))
    # Kakao only includes a new refresh_token in the response when it decides to
    # rotate it (typically as the old one nears its own ~2-month expiry) — falling
    # back to the existing one when absent is what keeps a non-rotating refresh from
    # being overwritten with nothing.
    refresh_token = data.get("refresh_token", stored["refresh_token"])
    refresh_expires_at = (
        _iso(now + timedelta(seconds=data["refresh_token_expires_in"]))
        if "refresh_token_expires_in" in data
        else stored.get("refresh_expires_at")
    )

    kakao_token_store.save(access_token, refresh_token, access_expires_at, refresh_expires_at, _iso(now))
    return access_token


def get_valid_access_token() -> str:
    stored = kakao_token_store.get()
    if stored is None:
        raise KakaoNotConfigured(
            "No Kakao refresh token stored yet — run scripts/kakao_get_refresh_token.py once."
        )
    expires_at = datetime.fromisoformat(stored["access_expires_at"])
    if expires_at - datetime.now(timezone.utc) > _REFRESH_MARGIN:
        return stored["access_token"]
    return _refresh_access_token(stored)


def send_text_message(access_token: str, text: str) -> None:
    template_object = {
        "object_type": "text",
        "text": text,
        "link": {"web_url": SITE_URL, "mobile_web_url": SITE_URL},
        "button_title": "사이트 방문",
    }
    resp = requests.post(
        KAKAO_SEND_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        data={"template_object": json.dumps(template_object, ensure_ascii=False)},
        timeout=10,
    )
    if not resp.ok:
        raise _kakao_error("카카오 메시지 발송", resp)

    # A successful send answers 200 {"result_code":0}. Kakao also uses 200 with a
    # non-zero result_code for partial/soft failures, so status alone would report
    # those as sent.
    try:
        body = resp.json()
    except ValueError:
        return
    if isinstance(body, dict) and body.get("result_code") not in (0, None):
        raise KakaoApiError(
            f"카카오 메시지 발송 실패 (result_code={body['result_code']})",
            status_code=resp.status_code,
            code=body.get("result_code"),
        )


def send_message(text: str) -> None:
    """The one send entry point both notification types go through.

    Retries once on a 401 from the send API after forcing a token refresh. The stored
    access_expires_at is only Kakao's estimate from issue time: a token can stop being
    accepted before it — the account re-consents, another refresh supersedes it, the
    clocks disagree — and get_valid_access_token(), which trusts that timestamp, would
    otherwise hand back the dead token on every attempt with no path to recovery short
    of waiting out the recorded expiry. A 401 from the *token* endpoint is not retried
    here: that one is a credentials problem (see KOE010 above), and repeating it just
    produces the same answer.
    """
    try:
        send_text_message(get_valid_access_token(), text)
        return
    except KakaoApiError as exc:
        if exc.status_code != 401:
            raise

    stored = kakao_token_store.get()
    if stored is None:
        raise KakaoNotConfigured(
            "No Kakao refresh token stored yet — run scripts/kakao_get_refresh_token.py once."
        )
    send_text_message(_refresh_access_token(stored), text)


def _diff_and_pct(current: int, previous: int | None) -> tuple[int | None, float | None]:
    if previous is None:
        return None, None
    diff = current - previous
    if previous == 0:
        # No prior baseline to divide by — anything above zero reads as "new" rather
        # than an undefined or infinite percentage.
        pct = None
    else:
        pct = diff / previous * 100
    return diff, pct


def _format_line(label: str, current: int, previous: int | None) -> str:
    diff, pct = _diff_and_pct(current, previous)
    current_str = f"{current:,}"
    if previous is None:
        return f"{label}: {current_str}"
    if diff == 0:
        return f"{label}: {current_str} (전일 대비 변동 없음)"
    sign = "+" if diff > 0 else ""
    if pct is None:
        return f"{label}: {current_str} (전일 대비 {sign}{diff:,}, 신규)"
    return f"{label}: {current_str} (전일 대비 {sign}{diff:,}, {sign}{pct:.1f}%)"


def _kst_now() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=9)


def build_message(online_now: int, total_visits: int, views_24h: int, previous: dict | None) -> str:
    ts = _kst_now().strftime("%m/%d %H:%M")
    lines = [
        f"📊 사이트 방문자 현황 ({ts} 기준)",
        _format_line("현재 접속자", online_now, previous["online_now"] if previous else None),
        _format_line("누적 방문자", total_visits, previous["total_visits"] if previous else None),
        _format_line("최근 24시간 조회수", views_24h, previous["views_24h"] if previous else None),
    ]
    if previous is None:
        lines.append("(전일 데이터가 아직 없어 비교 없이 현재 값만 보여드려요)")
    return "\n".join(lines)


def run_visitor_stats(force: bool = False, triggered_by: str = "cron") -> dict:
    """Collects the current stats, records this run as a snapshot, compares against
    the snapshot closest to 24 hours ago, and sends the result via Kakao "나에게 보내기".
    This is the "사이트 방문자 현황" notification. Called by the hourly cron trigger
    (see routers/notify.py), by main.py's in-process fallback scheduler, and by the
    admin dashboard's manual "지금 발송" button (routers/admin.py) — the last of which
    passes force=True so a deliberate click always actually sends, bypassing the
    _MIN_INTERVAL de-dupe guard meant only to stop the first two triggers from
    double-sending within the same hour.

    Every outcome — sent, skipped, not configured, or errored — is recorded via
    _record_last_visitor_run so the dashboard can show "what happened last" regardless
    of which of the three triggers produced it.
    """
    now = datetime.now(timezone.utc)
    finished_at = _iso(now)

    if not force:
        last = notify_stats_store.latest()
        if last is not None and now - datetime.fromisoformat(last["created_at"]) < _MIN_INTERVAL:
            return _record_last_visitor_run(
                {
                    "status": "skipped_recent",
                    "last_sent_at": last["created_at"],
                    "triggered_by": triggered_by,
                    "finished_at": finished_at,
                }
            )

    since_24h = (now - timedelta(hours=24)).isoformat()

    base = {"triggered_by": triggered_by, "finished_at": finished_at}

    # Gathering the numbers touches four stores, three of them over the network
    # (Turso) — so it fails for its own reasons, independent of anything Kakao does.
    # Recorded as an error like any other rather than allowed to escape: uncaught, it
    # leaves the admin's manual send as a bare HTTP 500 with nothing in the card's
    # last-run history to explain it.
    try:
        online_now = tracker.current_count()
        total_visits = visitor_store.total_count()
        views_24h = page_view_store.count_today(since_24h)
        previous = notify_stats_store.closest_to((now - timedelta(hours=24)).isoformat())
        # Recorded regardless of what happens below — it's a true reading of the site
        # at this instant, and future runs need it as their own "24h ago" baseline even
        # if this particular send never went out.
        notify_stats_store.record(now.isoformat(), online_now, total_visits, views_24h)
    except Exception as exc:
        return _record_last_visitor_run(
            {**base, "status": "error", "error": f"방문자 통계 조회 실패: {exc}"}
        )

    stats = {"online_now": online_now, "total_visits": total_visits, "views_24h": views_24h}
    message = build_message(online_now, total_visits, views_24h, previous)
    base = {**base, "message": message, "stats": stats}

    if not KAKAO_REST_API_KEY or kakao_token_store.get() is None:
        return _record_last_visitor_run({**base, "status": "not_configured"})

    try:
        send_message(message)
    except Exception as exc:
        return _record_last_visitor_run({**base, "status": "error", "error": str(exc)})

    return _record_last_visitor_run({**base, "status": "sent"})


# ---------------------------------------------------------------------------
# AI 예측 배치 실행결과 notification
# ---------------------------------------------------------------------------
#
# Separate from run_visitor_stats above: this fires once per prediction_batch region
# run (KR = 코스피·코스닥, US = 나스닥), ~10 minutes after that run finishes — see
# schedule_prediction_result, called from prediction_batch.run_batch. There is no
# _MIN_INTERVAL guard here: unlike the hourly visitor stats (which has three
# overlapping triggers racing for the same clock hour), each region run is its own
# one-off event with nothing else contending for it, and the admin dashboard's own
# manual "지금 발송" button is a deliberate re-send of the same data, not a race.

_PREDICTION_NOTIFY_DELAY_SECONDS = 10 * 60

_REGION_LABELS = {"KR": "한국장 (코스피·코스닥)", "US": "미국장 (나스닥)"}
_PREDICTION_STATUS_LABELS = {"ok": "성공", "skipped": "스킵", "error": "실패"}
_AI_SOURCE_LABELS = {"claude": "Claude", "heuristic": "휴리스틱"}

_SKIP_REASON_LABELS = {
    "already_ran": "이미 실행됨(중복 방지)",
    "already_running": "다른 실행이 진행 중이라 건너뜀",
}


def _format_kst(iso_str: str | None) -> str:
    if not iso_str:
        return _kst_now().strftime("%m/%d %H:%M")
    return (datetime.fromisoformat(iso_str) + timedelta(hours=9)).strftime("%m/%d %H:%M")


def build_prediction_message(region: str, summary: dict) -> str:
    label = _REGION_LABELS.get(region, region)
    status = summary.get("status")
    status_label = _PREDICTION_STATUS_LABELS.get(status, status or "알 수 없음")
    when = _format_kst(summary.get("finished_at"))

    lines = [f"🤖 AI 예측 배치 실행결과 ({when} 완료)", f"{label} — {status_label}"]

    if status == "error":
        lines.append(f"오류: {summary.get('error') or '알 수 없는 오류'}")
        return "\n".join(lines)

    if status == "skipped":
        reason = _SKIP_REASON_LABELS.get(summary.get("reason"), summary.get("reason") or "알 수 없음")
        lines.append(f"사유: {reason}")
        return "\n".join(lines)

    saved = summary.get("saved") or 0
    detail = f"{saved}종목 저장"
    elapsed = summary.get("elapsed_seconds")
    if elapsed is not None:
        detail += f" · {elapsed}초 소요"
    lines.append(detail)

    for market, stat in (summary.get("markets") or {}).items():
        count = stat.get("count", 0)
        # A db_snapshot summary has no ai_source at all — which analyst path ran is only
        # known to the process that ran it. Drop the field rather than print
        # "확인 불가", which would read as a failed detection.
        if "ai_source" not in stat:
            lines.append(f"· {market}: {count}종목")
            continue
        source = stat["ai_source"]
        source_label = _AI_SOURCE_LABELS.get(source, source or "확인 불가")
        lines.append(f"· {market}: {source_label} ({count}종목)")

    if summary.get("source") == "db_snapshot":
        # Rebuilt from stored rows because the process that ran the batch is gone (see
        # prediction_batch.last_run_or_snapshot) — say so, since the missing 소요시간 and
        # 분석 경로 are absent for that reason rather than because the run lacked them.
        lines.append("(서버 재시작으로 실행 로그가 없어 저장된 예측 데이터 기준으로 요약했습니다)")

    predict_date = summary.get("predict_date")
    if predict_date and len(predict_date) == 8:
        weekday = summary.get("predict_weekday")
        date_label = f"{predict_date[4:6]}/{predict_date[6:8]}"
        lines.append(f"예측일 {date_label}" + (f"({weekday})" if weekday else ""))

    warnings = summary.get("warnings") or []
    if warnings:
        preview = warnings[:2]
        more = len(warnings) - len(preview)
        note = " / ".join(preview) + (f" 외 {more}건" if more > 0 else "")
        lines.append(f"⚠ 경고 {len(warnings)}건: {note}")

    return "\n".join(lines)


def send_prediction_result(region: str, summary: dict, triggered_by: str) -> dict:
    """Builds and sends the "AI 예측 배치 실행결과" message for one region's run
    summary (the same shape prediction_batch._record keeps), recording the outcome
    under get_last_prediction_run(region) regardless of how it turns out."""
    message = build_prediction_message(region, summary)
    base = {
        "region": region,
        "message": message,
        "triggered_by": triggered_by,
        "finished_at": summary.get("finished_at") or _iso(datetime.now(timezone.utc)),
    }

    if not KAKAO_REST_API_KEY or kakao_token_store.get() is None:
        return _record_last_prediction_run(region, {**base, "status": "not_configured"})

    try:
        send_message(message)
    except Exception as exc:
        return _record_last_prediction_run(region, {**base, "status": "error", "error": str(exc)})

    return _record_last_prediction_run(region, {**base, "status": "sent"})


def _delayed_prediction_send(region: str, summary: dict) -> None:
    time.sleep(_PREDICTION_NOTIFY_DELAY_SECONDS)
    try:
        send_prediction_result(region, summary, triggered_by="auto_delayed")
    except Exception:
        # Mirrors the tolerance in main.py's _kakao_notify_loop — a failed send here
        # (network blip, Kakao API hiccup) isn't worth doing anything more than
        # dropping, since there is no retry queue for this one-off notification.
        pass


def schedule_prediction_result(region: str, summary: dict) -> None:
    """Fires 10 minutes after a prediction_batch region run finishes (see
    prediction_batch.run_batch, the only caller) — long enough that the admin
    dashboard's own view of the run has settled before the KakaoTalk copy goes out.

    Runs in a daemon thread rather than a persistent job queue: if the process
    restarts inside that 10-minute window the send is simply lost, the same
    volatility already accepted for prediction_batch's own in-memory _last_runs.
    """
    threading.Thread(target=_delayed_prediction_send, args=(region, summary), daemon=True).start()
