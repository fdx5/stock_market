import datetime as dt
import logging
import math
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
# "flag" is a country code the frontend resolves to /img/flag/<code>.svg — an image, not
# an emoji, because Chrome on Windows renders regional-indicator emoji as bare letter
# pairs ("US") rather than a flag. "group" sorts each index into one of the dashboard's
# two rolling flip-tiles (US vs. overseas). FDR only auto-prepends Yahoo's "^" for index
# codes it recognises — DJI/IXIC/N225/SSEC/HSI/FTSE are on that list, but the Taiwan
# weighted index is not, so it's passed as the explicit Yahoo symbol "^TWII".
US_WIDGETS = [
    {"key": "dow", "label": "다우존스", "code": "DJI", "unit": "index", "flag": "us", "group": "us"},
    {"key": "nasdaq", "label": "나스닥종합", "code": "IXIC", "unit": "index", "flag": "us", "group": "us"},
    {"key": "soxl", "label": "SOXL", "code": "SOXL", "unit": "usd", "flag": "us", "group": "us"},
    {"key": "tqqq", "label": "TQQQ", "code": "TQQQ", "unit": "usd", "flag": "us", "group": "us"},
]

OVERSEAS_WIDGETS = [
    {"key": "nikkei", "label": "니케이225", "code": "N225", "unit": "index", "flag": "jp", "group": "overseas"},
    {"key": "shanghai", "label": "상하이종합", "code": "SSEC", "unit": "index", "flag": "cn", "group": "overseas"},
    {"key": "hangseng", "label": "항셍지수", "code": "HSI", "unit": "index", "flag": "hk", "group": "overseas"},
    {"key": "taiwan", "label": "대만 가권", "code": "^TWII", "unit": "index", "flag": "tw", "group": "overseas"},
    {"key": "ftse", "label": "FTSE 100", "code": "FTSE", "unit": "index", "flag": "gb", "group": "overseas"},
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
        "flag": "kr",
        "group": "us",
        "source": "naver",
    },
    "night": {
        "key": "kospi_fut_night",
        "label": "코스피 야간선물 (KORU)",
        "code": "KORU",
        "unit": "usd",
        "flag": "kr",
        "group": "us",
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


def _sanitized(item: dict, empty: dict) -> dict:
    """Guarantee one tile is JSON-renderable, whatever its feed returned.

    Starlette renders with allow_nan=False, so a single non-finite number anywhere in
    the payload raises at render time and takes the *entire* grid down with a 500 —
    which is exactly how every index once vanished at once. A tile whose quote didn't
    come through cleanly degrades to its own empty state instead; the rest still ship."""
    if not all(math.isfinite(item[k]) for k in ("close", "change", "change_pct") if item.get(k) is not None):
        logger.warning("global_dashboard: non-finite quote for %s, blanking tile", item.get("key"))
        return empty
    item["points"] = [p for p in item["points"] if p.get("close") is not None and math.isfinite(p["close"])]
    return item


def _widget_data(widget: dict) -> dict:
    # "source" only steers the fetch below; it isn't part of the wire format.
    meta = {k: v for k, v in widget.items() if k != "source"}
    empty = {**meta, "close": None, "change": None, "change_pct": None, "points": []}

    if widget.get("source") == "naver":
        try:
            return _sanitized({**meta, **kospi_futures_fetcher.get_index(widget["code"])}, empty)
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
    return _sanitized(
        {
            **meta,
            "close": float(latest["close"]),
            "change": change,
            "change_pct": change_pct,
            "points": dataframe_to_records(tail[["date", "close"]]),
        },
        empty,
    )


@router.get("/indices")
def indices():
    items = [_widget_data(w) for w in US_WIDGETS]

    session = _kospi_session(dt.datetime.now(KST))
    if session:
        partner = _widget_data(KOSPI_SESSION_WIDGETS[session])
        # A tile that failed to load has nothing to show, so drop it rather than flipping
        # a dash into the US rotation every few seconds. When it did load, it rides the
        # same bottom-to-top flip as everything else — slotted right after SOXL, the tile
        # it historically doubled for.
        if partner["close"] is not None:
            soxl_at = next((i for i, it in enumerate(items) if it["key"] == "soxl"), len(items) - 1)
            items.insert(soxl_at + 1, partner)

    items += [_widget_data(w) for w in OVERSEAS_WIDGETS]

    return {"items": items}


@router.get("/{code}/enrichment")
def enrichment(code: str, lang: str = Query("ko")):
    item = get_us_stock_item(code)
    name = item["name"] if item else code
    return get_global_enrichment(code, name, lang)


@router.get("/{code}/discussion")
def discussion(code: str, limit: int = Query(10, ge=1, le=50), offset: str | None = Query(None)):
    return global_discussion_fetcher.get_discussion(code, limit, offset)
