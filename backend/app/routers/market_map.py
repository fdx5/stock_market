import datetime as dt
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query

from app.data.market_ticker_fetcher import get_market_ticker
from app.data.price_fetcher import get_history
from app.data.weather_fetcher import get_seoul_weather
from app.services.indicators import compute_indicators
from app.services.market_map import SECTOR_PEER_LIMIT, get_kosdaq_map, get_kospi_map, get_sector_map
from app.services.stock_board import BOARD_LIMIT, MARKETS, get_board
from app.services.us_market_map import US_SECTOR_PEER_LIMIT, get_nasdaq100_map, get_sp500_map, get_us_sector_map
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


@router.get("/sp500-map")
def sp500_map(limit: int = Query(503, ge=1, le=503), fresh: bool = Query(False)):
    items = get_sp500_map(limit, fresh=fresh)
    return {
        "generated_at": dt.datetime.now(KST).isoformat(timespec="seconds"),
        "count": len(items),
        "items": items,
    }


@router.get("/nasdaq100-map")
def nasdaq100_map(limit: int = Query(103, ge=1, le=103), fresh: bool = Query(False)):
    items = get_nasdaq100_map(limit, fresh=fresh)
    return {
        "generated_at": dt.datetime.now(KST).isoformat(timespec="seconds"),
        "count": len(items),
        "items": items,
    }


@router.get("/board")
def stock_board(
    market: str = Query(..., pattern="^(kospi|kosdaq|nasdaq)$"),
    limit: int = Query(BOARD_LIMIT, ge=10, le=BOARD_LIMIT),
    fresh: bool = Query(False),
    slim: bool = Query(False),
):
    """The 100-종목 card board — the ranked roster plus, per card, a sparkline, its
    52-week range and its trailing returns, and per 업종 a cap-weighted summary.
    See services/stock_board for what it's assembled from.

    `slim=true` omits the sparkline history (`points` and `spark_dates`) and is what
    the page's 10s refresh asks for; everything that actually changes during a session
    is still there."""
    if market not in MARKETS:  # pragma: no cover - the pattern above already rejects these
        raise HTTPException(status_code=404, detail=f"지원하지 않는 시장입니다: {market}")
    return get_board(market, limit, fresh=fresh, slim=slim)


@router.get("/sector-map")
def sector_map(code: str = Query(..., min_length=6, max_length=6), limit: int = Query(SECTOR_PEER_LIMIT, ge=1, le=120)):
    """Peers sharing the given stock's sector, sized and colored like the full market
    map — the dashboard draws these into the space left beside its chart column."""
    result = get_sector_map(code, limit)
    return {"generated_at": dt.datetime.now(KST).isoformat(timespec="seconds"), **result}


@router.get("/us-sector-map")
def us_sector_map(
    code: str = Query(..., min_length=1, max_length=10),
    limit: int = Query(US_SECTOR_PEER_LIMIT, ge=1, le=120),
):
    """S&P 500 peers sharing the given US ticker's GICS sector, sized by index weight
    and colored by change — /global draws these into the space beside its chart column,
    the way /sector-map serves the KR dashboard. Tickers, unlike the 6-digit KR codes
    above, vary in length (from `V` to `GOOGL`), hence the wider bounds."""
    result = get_us_sector_map(code, limit)
    return {"generated_at": dt.datetime.now(KST).isoformat(timespec="seconds"), **result}


@router.get("/ticker")
def ticker():
    return {"items": get_market_ticker()}


@router.get("/weather")
def weather():
    """Current Seoul weather for the dashboard header calendar."""
    return get_seoul_weather()


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
