import datetime as dt
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query

from app.services.market_map import get_kospi_map

router = APIRouter()

KST = ZoneInfo("Asia/Seoul")


@router.get("/map")
def kospi_map(limit: int = Query(500, ge=1, le=800)):
    items = get_kospi_map(limit)
    return {
        "generated_at": dt.datetime.now(KST).isoformat(timespec="seconds"),
        "count": len(items),
        "items": items,
    }
