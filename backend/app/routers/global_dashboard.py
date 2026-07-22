import datetime as dt
import logging
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query

from app.data import global_discussion_fetcher, kospi_futures_fetcher, price_fetcher
from app.data.us_universe import get_us_stock_item
from app.services.battle import get_global_enrichment
from app.utils import dataframe_to_records

logger = logging.getLogger(__name__)

router = APIRouter()

# FinanceDataReader dispatches these non-KR-style codes to Yahoo Finance under the
# hood — DJI/IXIC are Yahoo's index codes (^DJI/^IXIC), same mechanism already proven
# for arbitrary US tickers by price_fetcher.get_history / us_stock.py.
# DJI/IXIC are point-valued indices; SOXL/TQQQ are ETFs whose "close" is a real
# per-share USD price — "unit" tells the frontend which of those to display.
INDEX_WIDGETS = [
    {"key": "dow", "label": "다우존스", "code": "DJI", "unit": "index"},
    {"key": "nasdaq", "label": "나스닥종합", "code": "IXIC", "unit": "index"},
    {"key": "soxl", "label": "SOXL", "code": "SOXL", "unit": "usd"},
    {"key": "tqqq", "label": "TQQQ", "code": "TQQQ", "unit": "usd"},
]

# ~3 months of daily closes — enough for a simple sparkline trend without shipping a
# full year of points for a small non-interactive widget.
SPARKLINE_POINTS = 60

KST = ZoneInfo("Asia/Seoul")

# The SOXL tile doubles as a KOSPI-futures window: whenever a KOSPI futures session is
# open, whatever is trading in it rides along in that slot and the frontend alternates
# the two. It takes two different instruments because no single free feed covers both
# sessions:
#   - KRX day session -> the real 코스피 200 선물, off Naver's index feed.
#   - KRX night session -> KORU. KRX's own CME-linked night futures have no free,
#     no-auth quote source at all (Naver's "FUT" freezes at the 15:45 day close, Yahoo
#     carries no CME KOSPI symbol, Investing.com's API 403s). KORU is the US-listed 3x
#     Korea bull ETF — it trades US hours, i.e. inside the night window, and being
#     leveraged it tracks the same directional bet, so it stands in as the proxy. The
#     label says KORU rather than pretending to be the futures print.
KOSPI_SESSION_WIDGETS = {
    "day": {
        "key": "kospi_fut_day",
        "label": "코스피200 주간선물",
        "code": "FUT",
        "unit": "index",
        "source": "naver",
    },
    "night": {
        "key": "kospi_fut_night",
        "label": "코스피 야간선물 (KORU)",
        "code": "KORU",
        "unit": "usd",
        "source": "yahoo",
    },
}


def _kospi_session(now: dt.datetime) -> str | None:
    """Which KOSPI 200 futures session is open right now, if any.

    Day is 09:00-15:45 KST; night is 18:00-05:00 KST, which straddles midnight and so
    lands its two halves on different weekdays — Mon-Fri evenings, Tue-Sat mornings.
    Holidays aren't modelled: on one the widget shows a flat previous close, which is
    the same thing every other tile on this grid does when its market is shut."""
    weekday = now.weekday()  # Mon=0 .. Sun=6
    minutes = now.hour * 60 + now.minute

    if weekday < 5 and 9 * 60 <= minutes < 15 * 60 + 45:
        return "day"
    if weekday < 5 and minutes >= 18 * 60:
        return "night"
    if 1 <= weekday <= 5 and minutes < 5 * 60:
        return "night"
    return None


def _widget_data(widget: dict) -> dict:
    # "source" only steers the fetch below; it isn't part of the wire format.
    meta = {k: v for k, v in widget.items() if k != "source"}
    empty = {**meta, "close": None, "change": None, "change_pct": None, "points": []}

    if widget.get("source") == "naver":
        try:
            return {**meta, **kospi_futures_fetcher.get_index(widget["code"])}
        except Exception:
            logger.exception("global_dashboard: failed to load Naver index %s", widget["code"])
            return empty

    try:
        df = price_fetcher.get_history(widget["code"], years=1)
    except Exception:
        logger.exception("global_dashboard: failed to load history for %s", widget["code"])
        return empty

    tail = df.tail(SPARKLINE_POINTS)
    latest = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else latest
    change = float(latest["close"] - prev["close"])
    change_pct = float(change / prev["close"] * 100) if prev["close"] else 0.0
    return {
        **meta,
        "close": float(latest["close"]),
        "change": change,
        "change_pct": change_pct,
        "points": dataframe_to_records(tail[["date", "close"]]),
    }


@router.get("/indices")
def indices():
    items = [_widget_data(w) for w in INDEX_WIDGETS]

    session = _kospi_session(dt.datetime.now(KST))
    if session:
        partner = _widget_data(KOSPI_SESSION_WIDGETS[session])
        # A tile that failed to load has nothing to rotate to, so leave the slot alone
        # rather than flipping SOXL out for a dash every few seconds.
        if partner["close"] is not None:
            for item in items:
                if item["key"] == "soxl":
                    item["alt"] = partner

    return {"items": items}


@router.get("/{code}/enrichment")
def enrichment(code: str, lang: str = Query("ko")):
    item = get_us_stock_item(code)
    name = item["name"] if item else code
    return get_global_enrichment(code, name, lang)


@router.get("/{code}/discussion")
def discussion(code: str, limit: int = Query(10, ge=1, le=50), offset: str | None = Query(None)):
    return global_discussion_fetcher.get_discussion(code, limit, offset)
