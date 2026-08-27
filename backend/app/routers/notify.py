import os
import secrets

from fastapi import APIRouter, Header, HTTPException

from app.services import kakao_notify

router = APIRouter()

# Shared secret for the cron trigger — same no-default shape as prediction.py's
# BATCH_TOKEN: an unset token disables the endpoint outright rather than leaving a
# publicly-callable notification trigger behind a guessable value.
NOTIFY_TOKEN = os.environ.get("KAKAO_NOTIFY_TOKEN")


def _require_notify_token(authorization: str | None) -> None:
    if not NOTIFY_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="KAKAO_NOTIFY_TOKEN이 설정되지 않아 알림 트리거가 비활성화되어 있습니다.",
        )
    supplied = ""
    if authorization and authorization.startswith("Bearer "):
        supplied = authorization[len("Bearer ") :]
    if not supplied or not secrets.compare_digest(supplied, NOTIFY_TOKEN):
        raise HTTPException(status_code=401, detail="알림 토큰이 올바르지 않습니다.")


@router.post("/kakao/run")
def run_kakao_notify(authorization: str | None = Header(None)):
    """Hourly cron trigger: computes visitor stats, compares against ~24h ago, and
    sends the result via KakaoTalk "나에게 보내기" — the '사이트 방문자 현황' message.
    Fires every hour but only actually sends in the four KST hours listed in
    kakao_notify._SEND_HOURS_KST; the rest return "skipped_off_schedule".
    See kakao_notify.run_visitor_stats() for the actual logic and
    services/kakao_token_store.py for how the OAuth token is kept fresh between
    calls. The separate 'AI 예측 배치 실행결과' notification has no cron endpoint of
    its own — it fires automatically from prediction_batch.run_batch (see
    kakao_notify.schedule_prediction_result), 10 minutes after each region's run."""
    _require_notify_token(authorization)
    try:
        return kakao_notify.run_visitor_stats()
    except kakao_notify.KakaoNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc))
