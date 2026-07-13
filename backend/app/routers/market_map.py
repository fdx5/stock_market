import datetime as dt
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query

from app.data.market_ticker_fetcher import get_market_ticker
from app.services.market_map import get_kosdaq_map, get_kospi_map

router = APIRouter()

KST = ZoneInfo("Asia/Seoul")


@router.get("/map")
def kospi_map(limit: int = Query(500, ge=1, le=800), fresh: bool = Query(False)):
    items = get_kospi_map(limit, fresh=fresh)
    return {
        "generated_at": dt.datetime.now(KST).isoformat(timespec="seconds"),
        "count": len(items),
        "items": items,
    }


@router.get("/kosdaq-map")
def kosdaq_map(limit: int = Query(200, ge=1, le=200), fresh: bool = Query(False)):
    items = get_kosdaq_map(limit, fresh=fresh)
    return {
        "generated_at": dt.datetime.now(KST).isoformat(timespec="seconds"),
        "count": len(items),
        "items": items,
    }


@router.get("/ticker")
def ticker():
    return {"items": get_market_ticker()}
