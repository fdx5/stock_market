import datetime as dt
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query

from app.data.market_ticker_fetcher import get_market_ticker
from app.data.price_fetcher import get_history
from app.services.indicators import compute_indicators
from app.services.market_map import get_kosdaq_map, get_kospi_map
from app.utils import dataframe_to_records

router = APIRouter()

KST = ZoneInfo("Asia/Seoul")

# FinanceDataReader codes for the composite indices themselves (not individual stocks) -
# these don't live in the KOSPI/KOSDAQ stock universe, so they're mapped here rather than
# resolved through the per-stock `_resolve_name`/universe lookup.
INDEX_CODES = {"KOSPI": "KS11", "KOSDAQ": "KQ11"}


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


@router.get("/index/{symbol}/history")
def index_history(symbol: str, years: int = Query(3, ge=1, le=10)):
    code = INDEX_CODES.get(symbol.upper())
    if code is None:
        raise HTTPException(status_code=404, detail=f"지원하지 않는 지수입니다: {symbol}")
    try:
        df = get_history(code, years)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=f"지수 데이터를 가져올 수 없습니다: {exc}") from exc
    indicator_df = compute_indicators(df)
    points = dataframe_to_records(indicator_df)
    latest = points[-1] if points else {}
    return {"symbol": symbol.upper(), "points": points, "latest": latest}
