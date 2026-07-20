import logging

from fastapi import APIRouter, Query

from app.data import global_discussion_fetcher, price_fetcher
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


def _widget_data(widget: dict) -> dict:
    try:
        df = price_fetcher.get_history(widget["code"], years=1)
    except Exception:
        logger.exception("global_dashboard: failed to load history for %s", widget["code"])
        return {**widget, "close": None, "change": None, "change_pct": None, "points": []}

    tail = df.tail(SPARKLINE_POINTS)
    latest = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else latest
    change = float(latest["close"] - prev["close"])
    change_pct = float(change / prev["close"] * 100) if prev["close"] else 0.0
    return {
        **widget,
        "close": float(latest["close"]),
        "change": change,
        "change_pct": change_pct,
        "points": dataframe_to_records(tail[["date", "close"]]),
    }


@router.get("/indices")
def indices():
    return {"items": [_widget_data(w) for w in INDEX_WIDGETS]}


@router.get("/{code}/enrichment")
def enrichment(code: str, lang: str = Query("ko")):
    item = get_us_stock_item(code)
    name = item["name"] if item else code
    return get_global_enrichment(code, name, lang)


@router.get("/{code}/discussion")
def discussion(code: str, limit: int = Query(10, ge=1, le=50), offset: str | None = Query(None)):
    return global_discussion_fetcher.get_discussion(code, limit, offset)
