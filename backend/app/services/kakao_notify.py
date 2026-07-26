import json
import os
import threading
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
_last_run_lock = threading.Lock()
_last_run: dict | None = None


def _record_last_run(result: dict) -> dict:
    global _last_run
    with _last_run_lock:
        _last_run = result
    return result


def get_last_run() -> dict | None:
    with _last_run_lock:
        return _last_run


def is_configured() -> bool:
    return bool(KAKAO_REST_API_KEY) and kakao_token_store.get() is not None


class KakaoNotConfigured(Exception):
    """Raised when KAKAO_REST_API_KEY is unset or no refresh token has been stored yet
    (see scripts/kakao_get_refresh_token.py for the one-time setup that provides it)."""


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
    resp.raise_for_status()
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
    resp.raise_for_status()


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


def run(force: bool = False, triggered_by: str = "cron") -> dict:
    """Collects the current stats, records this run as a snapshot, compares against
    the snapshot closest to 24 hours ago, and sends the result via Kakao "나에게 보내기".
    Called by the hourly cron trigger (see routers/notify.py), by main.py's
    in-process fallback scheduler, and by the admin dashboard's manual "지금 발송"
    button (routers/admin.py) — the last of which passes force=True so a deliberate
    click always actually sends, bypassing the _MIN_INTERVAL de-dupe guard meant only
    to stop the first two triggers from double-sending within the same hour.

    Every outcome — sent, skipped, not configured, or errored — is recorded via
    _record_last_run so the dashboard can show "what happened last" regardless of
    which of the three triggers produced it.
    """
    now = datetime.now(timezone.utc)
    finished_at = _iso(now)

    if not force:
        last = notify_stats_store.latest()
        if last is not None and now - datetime.fromisoformat(last["created_at"]) < _MIN_INTERVAL:
            return _record_last_run(
                {
                    "status": "skipped_recent",
                    "last_sent_at": last["created_at"],
                    "triggered_by": triggered_by,
                    "finished_at": finished_at,
                }
            )

    since_24h = (now - timedelta(hours=24)).isoformat()

    online_now = tracker.current_count()
    total_visits = visitor_store.total_count()
    views_24h = page_view_store.count_today(since_24h)
    stats = {"online_now": online_now, "total_visits": total_visits, "views_24h": views_24h}

    previous = notify_stats_store.closest_to((now - timedelta(hours=24)).isoformat())
    # Recorded regardless of what happens below — it's a true reading of the site
    # at this instant, and future runs need it as their own "24h ago" baseline even
    # if this particular send never went out.
    notify_stats_store.record(now.isoformat(), online_now, total_visits, views_24h)

    message = build_message(online_now, total_visits, views_24h, previous)
    base = {"message": message, "stats": stats, "triggered_by": triggered_by, "finished_at": finished_at}

    if not KAKAO_REST_API_KEY or kakao_token_store.get() is None:
        return _record_last_run({**base, "status": "not_configured"})

    try:
        access_token = get_valid_access_token()
        send_text_message(access_token, message)
    except Exception as exc:
        return _record_last_run({**base, "status": "error", "error": str(exc)})

    return _record_last_run({**base, "status": "sent"})
