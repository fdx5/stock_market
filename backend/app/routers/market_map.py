import datetime as dt
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.data.market_ticker_fetcher import TTL_TICKER_SECONDS, get_market_ticker
from app.data.price_fetcher import get_history
from app.data.us_index_fetcher import TTL_CONSTITUENTS_SECONDS as US_SECTOR_TTL_SECONDS
from app.data.us_index_fetcher import market_session as us_market_session
from app.data.us_logo_fetcher import get_us_logo
from app.data.weather_fetcher import TTL_WEATHER_SECONDS, get_seoul_weather
from app.services.indicators import compute_indicators
from app.services.market_map import (
    LONG_TAIL_TTL_SECONDS,
    SECTOR_PEER_LIMIT,
    get_kosdaq_map,
    get_kospi_map,
    get_sector_map,
)
from app.services.stock_board import BOARD_LIMIT, MARKETS, get_board
from app.services.us_market_map import (
    US_SECTOR_PEER_LIMIT,
    get_nasdaq100_map_with_skhynix,
    get_sp500_map_with_skhynix,
    get_us_sector_map,
)
from app.utils import dataframe_to_records

router = APIRouter()

KST = ZoneInfo("Asia/Seoul")

# FinanceDataReader codes for the composite indices themselves (not individual stocks) -
# these don't live in the KOSPI/KOSDAQ stock universe, so they're mapped here rather than
# resolved through the per-stock `_resolve_name`/universe lookup.
INDEX_CODES = {"KOSPI": "KS11", "KOSDAQ": "KQ11"}


@router.get("/map")
def kospi_map(response: Response, limit: int = Query(500, ge=1, le=800), fresh: bool = Query(False)):
    response.headers["Cache-Control"] = "no-store"
    items = get_kospi_map(limit, fresh=fresh)
    return {
        "generated_at": dt.datetime.now(KST).isoformat(timespec="seconds"),
        "count": len(items),
        "items": items,
    }


@router.get("/kosdaq-map")
def kosdaq_map(response: Response, limit: int = Query(200, ge=1, le=200), fresh: bool = Query(False)):
    response.headers["Cache-Control"] = "no-store"
    items = get_kosdaq_map(limit, fresh=fresh)
    return {
        "generated_at": dt.datetime.now(KST).isoformat(timespec="seconds"),
        "count": len(items),
        "items": items,
    }


@router.get("/sp500-map")
def sp500_map(response: Response, limit: int = Query(503, ge=1, le=503), fresh: bool = Query(False)):
    response.headers["Cache-Control"] = "no-store"
    items = get_sp500_map_with_skhynix(limit, fresh=fresh)
    return {
        "generated_at": dt.datetime.now(KST).isoformat(timespec="seconds"),
        # Which US session these prices came from — outside regular hours each item's
        # close is its pre/post print. The two KR maps above have no equivalent field:
        # NXT's after-hours trading is already folded into their prices with no separate
        # session to name (see stock_quote_fetcher).
        "session": us_market_session(items),
        "count": len(items),
        "items": items,
    }


@router.get("/nasdaq100-map")
def nasdaq100_map(response: Response, limit: int = Query(103, ge=1, le=103), fresh: bool = Query(False)):
    response.headers["Cache-Control"] = "no-store"
    items = get_nasdaq100_map_with_skhynix(limit, fresh=fresh)
    return {
        "generated_at": dt.datetime.now(KST).isoformat(timespec="seconds"),
        "session": us_market_session(items),
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
def sector_map(
    response: Response,
    code: str = Query(..., min_length=6, max_length=6),
    limit: int = Query(SECTOR_PEER_LIMIT, ge=1, le=120),
):
    """Peers sharing the given stock's sector, sized and colored like the full market
    map — the dashboard draws these into the space left beside its chart column.

    Cached by the browser for LONG_TAIL_TTL_SECONDS: it's filtered from the full KOSPI/
    KOSDAQ map snapshot (see get_sector_map), which never refreshes faster than that
    tier regardless of this endpoint's own poll cadence, so a shorter client cache would
    buy nothing. Unlike /map's own `generated_at` (rendered on screen as a ticking "as
    of" clock - see MarketMapPage/StockBoardPage), this one is never displayed, so
    letting the browser reuse a response for a while has no visible effect at all.
    """
    response.headers["Cache-Control"] = f"public, max-age={LONG_TAIL_TTL_SECONDS}"
    result = get_sector_map(code, limit)
    return {"generated_at": dt.datetime.now(KST).isoformat(timespec="seconds"), **result}


@router.get("/us-sector-map")
def us_sector_map(
    response: Response,
    code: str = Query(..., min_length=1, max_length=10),
    limit: int = Query(US_SECTOR_PEER_LIMIT, ge=1, le=120),
):
    """S&P 500 peers sharing the given US ticker's GICS sector, sized by index weight
    and colored by change — /global draws these into the space beside its chart column,
    the way /sector-map serves the KR dashboard. Tickers, unlike the 6-digit KR codes
    above, vary in length (from `V` to `GOOGL`), hence the wider bounds.

    See /sector-map's docstring for why this is safe to let the browser cache: its
    `generated_at` is likewise never rendered, and the underlying S&P constituents
    snapshot itself never refreshes faster than US_SECTOR_TTL_SECONDS.
    """
    response.headers["Cache-Control"] = f"public, max-age={US_SECTOR_TTL_SECONDS}"
    result = get_us_sector_map(code, limit)
    return {"generated_at": dt.datetime.now(KST).isoformat(timespec="seconds"), **result}


@router.get("/us-logo/{ticker}")
def us_logo(ticker: str):
    """One US company logo, proxied from companiesmarketcap so it arrives same-origin.

    Only the map pages' PNG export uses this — the tiles on screen load the same image
    straight from that host, which costs this app nothing. The export can't: the logo
    host sends no CORS header, and a cross-origin image taints the canvas the map is
    redrawn into, which makes the toBlob() behind the download throw. See
    data/us_logo_fetcher for the full story and what this does and doesn't cost.
    """
    logo = get_us_logo(ticker)
    if logo is None:
        raise HTTPException(status_code=404, detail=f"로고를 찾을 수 없습니다: {ticker}")
    content, media_type = logo
    return Response(
        content=content,
        media_type=media_type,
        # A company's logo at a fixed URL is about as immutable as this app serves — and
        # every byte saved here is one not spent on the next export click.
        headers={"Cache-Control": "public, max-age=1209600, immutable"},
    )


@router.get("/ticker")
def ticker(response: Response):
    """Neither field this returns is ever shown with a timestamp (see MarketTickerBar),
    so a browser reusing a response for TTL_TICKER_SECONDS - the fastest this can
    possibly change server-side anyway - is free: the 5s client poll (useMarketTicker)
    already outruns that TTL, so roughly half its requests become cache hits with
    identical bytes to what a real fetch would have returned."""
    response.headers["Cache-Control"] = f"public, max-age={TTL_TICKER_SECONDS}"
    return {"items": get_market_ticker()}


@router.get("/weather")
def weather(response: Response):
    """Current Seoul weather for the dashboard header calendar. No timestamp in the
    payload or on screen, and weather itself doesn't move fast - safe to let the
    browser reuse a response for the same TTL_WEATHER_SECONDS the server cache uses."""
    response.headers["Cache-Control"] = f"public, max-age={TTL_WEATHER_SECONDS}"
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
