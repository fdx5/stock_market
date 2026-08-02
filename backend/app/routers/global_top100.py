import os
import secrets

from fastapi import APIRouter, Header, HTTPException

from app.services import global_top100

router = APIRouter()

# Same no-default-disables-the-endpoint shape as notify.py's NOTIFY_TOKEN — an unset
# token disables the manual-refresh trigger outright rather than leaving an expensive
# (100-symbol Yahoo scrape) endpoint publicly callable behind a guessable value.
REFRESH_TOKEN = os.environ.get("GLOBAL_TOP100_REFRESH_TOKEN")


def _require_refresh_token(authorization: str | None) -> None:
    if not REFRESH_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="GLOBAL_TOP100_REFRESH_TOKEN이 설정되지 않아 새로고침 트리거가 비활성화되어 있습니다.",
        )
    supplied = ""
    if authorization and authorization.startswith("Bearer "):
        supplied = authorization[len("Bearer ") :]
    if not supplied or not secrets.compare_digest(supplied, REFRESH_TOKEN):
        raise HTTPException(status_code=401, detail="토큰이 올바르지 않습니다.")


@router.get("")
def get_top100():
    """The 글로벌 시가총액 TOP 100 page's data — full snapshot (roster, fundamentals,
    returns, rank-change) merged with the ~20s-fresh live price overlay. See
    services/global_top100.get_top100 for how the two layers are combined."""
    return global_top100.get_top100()


@router.post("/refresh")
def refresh_top100(authorization: str | None = Header(None)):
    """Nightly cron trigger (see .github/workflows/global-top100-refresh.yml) plus
    main.py's in-process fallback: forces a full rebuild of the roster/fundamentals/
    returns snapshot and records today's ranks for tomorrow's rank-change comparison."""
    _require_refresh_token(authorization)
    return global_top100.force_refresh_full()
