"""Gathers everything one stock's next-day prediction is computed from.

Deliberately a separate layer from the scoring in prediction_engine: the batch runs
~34 stocks against half a dozen scraped upstreams, and a fetch that fails for one
stock must degrade that stock's inputs rather than take the run down. Every fetch
here is individually guarded and reports what it got, so the engine can weight on
what's actually present instead of assuming a full feature set.
"""

import datetime as dt
import logging
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

from app.data import investor_fetcher, news_fetcher, orderbook_fetcher, price_fetcher
from app.data.company_news_fetcher import fetch_bing_news
from app.data.prediction_universe import MARKET_KOSDAQ, MARKET_KOSPI, MARKET_NASDAQ, is_korean_market
from app.services.cache import cache
from app.services.indicators import compute_indicators

logger = logging.getLogger(__name__)

# Two years is enough for every indicator used here (the longest lookback is the
# 120-day SMA) with room for the dropna the engine does, and is a materially cheaper
# fetch than the dashboard's default three.
HISTORY_YEARS = 2

NEWS_LIMIT = 10

TTL_INDEX_CONTEXT_SECONDS = 30 * 60

# FinanceDataReader's symbols for each roster market's own index. The market regime is
# shared across every stock in a market, so it's fetched once per run and cached, not
# per stock.
INDEX_SYMBOLS = {
    MARKET_KOSPI: ("KS11", "코스피"),
    MARKET_KOSDAQ: ("KQ11", "코스닥"),
    MARKET_NASDAQ: ("IXIC", "나스닥 종합"),
}


def _safe(label: str, code: str, fn, default):
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001 - one bad upstream must not fail the run
        logger.warning("prediction_features: %s failed for %s (%s)", label, code, exc)
        return default


def _load_indicators(code: str) -> pd.DataFrame | None:
    df = price_fetcher.get_history(code, HISTORY_YEARS)
    if df is None or df.empty:
        return None
    return compute_indicators(df)


def _orderbook_pressure(code: str) -> dict | None:
    """Bid/ask imbalance from the 10-level ladder, normalized to [-1, 1].

    Naver's ladder is the same 20-minute-delayed feed used everywhere else in this app
    (see orderbook_fetcher), so this is a read of end-of-session resting depth rather
    than a live tape — which is exactly the right granularity for a batch that runs
    after the close and is asking "how did the book look when trading stopped".

    Only KRX names have this: the US roster has no equivalent free depth source, and
    the engine redistributes the weight rather than scoring a fabricated zero.
    """
    book = orderbook_fetcher.get_orderbook(code)
    if not book:
        return None
    bid_qty = book.get("total_bid_qty") or 0
    ask_qty = book.get("total_ask_qty") or 0
    total = bid_qty + ask_qty
    if total <= 0:
        return None

    imbalance = (bid_qty - ask_qty) / total

    # Depth concentrated at the touch says something the totals don't: a book where the
    # best bid alone carries a large share of all bid volume is a real buyer, whereas
    # the same total spread thinly across ten levels is mostly parked orders.
    bids = book.get("bids") or []
    asks = book.get("asks") or []
    top_bid = bids[0]["qty"] if bids else 0
    top_ask = asks[-1]["qty"] if asks else 0
    touch_total = top_bid + top_ask
    touch_imbalance = (top_bid - top_ask) / touch_total if touch_total > 0 else 0.0

    return {
        "bid_qty": bid_qty,
        "ask_qty": ask_qty,
        "imbalance": round(imbalance, 4),
        "touch_imbalance": round(touch_imbalance, 4),
        "spread": (asks[-1]["price"] - bids[0]["price"]) if (bids and asks) else None,
    }


def _investor_flow(code: str) -> dict | None:
    """Recent foreign/institutional net buying — the supply-demand read that most
    reliably separates a KRX move that continues from one that fades. Naver publishes
    this per stock for KRX names only; US names simply don't carry it."""
    rows = investor_fetcher.get_investor_trend(code, page_size=10)
    if not rows:
        return None
    recent = rows[:5]
    # Both figures are 억원, already converted by investor_fetcher from Naver's raw net
    # quantities — summing them over the window gives 5-day cumulative net buying.
    foreign = sum(float(r.get("foreign_amount") or 0) for r in recent)
    institution = sum(float(r.get("institution_amount") or 0) for r in recent)
    return {
        "foreign_5d": round(foreign, 1),
        "institution_5d": round(institution, 1),
        "days": len(recent),
    }


def _headlines(item: dict) -> list[dict]:
    """Recent coverage, normalized to {title, press, date} regardless of source.

    KRX names come from Naver's per-stock news tab (already keyed to the exact
    company); US names have no such per-ticker feed here, so they go through the same
    Bing news search the global pages use, queried by company name.
    """
    if is_korean_market(item["market"]):
        raw = news_fetcher.get_news(item["code"], NEWS_LIMIT)
        return [
            {"title": it.get("title", ""), "press": it.get("press", ""), "date": it.get("date", "")}
            for it in raw
            if it.get("title")
        ]

    raw = fetch_bing_news(item.get("english_name") or item["name"], NEWS_LIMIT)
    return [
        {
            "title": it.get("title", ""),
            "press": it.get("source", ""),
            "date": it.get("published", ""),
        }
        for it in raw
        if it.get("title")
    ]


def _load_index_context(market: str) -> dict | None:
    symbol_name = INDEX_SYMBOLS.get(market)
    if not symbol_name:
        return None
    symbol, label = symbol_name
    df = price_fetcher.get_history(symbol, 1)
    if df is None or len(df) < 25:
        return None

    closes = df["close"].astype(float)
    last = float(closes.iloc[-1])
    prev = float(closes.iloc[-2])
    ma20 = float(closes.tail(20).mean())
    change_1d = (last / prev - 1) * 100 if prev else 0.0
    change_5d = (last / float(closes.iloc[-6]) - 1) * 100 if len(closes) >= 6 else 0.0

    return {
        "label": label,
        "close": round(last, 2),
        "change_1d_pct": round(change_1d, 2),
        "change_5d_pct": round(change_5d, 2),
        # Above/below the 20-day mean is the single cheapest statement of regime, and
        # it's what the engine's market-context term keys on.
        "above_ma20": last > ma20,
    }


def get_index_context(market: str) -> dict | None:
    return cache.get_or_set(
        f"prediction_index_context:{market}",
        TTL_INDEX_CONTEXT_SECONDS,
        lambda: _load_index_context(market),
    )


def collect_for_stock(item: dict) -> dict | None:
    """Every input for one stock. Returns None only when price history is missing —
    without a close there is nothing to predict a move *from*, so that one failure is
    fatal for the stock (and the batch skips it) while every other gap is tolerated.
    """
    code = item["code"]
    indicator_df = _safe("history", code, lambda: _load_indicators(code), None)
    if indicator_df is None or len(indicator_df) < 30:
        logger.warning("prediction_features: insufficient history for %s, skipping", code)
        return None

    korean = is_korean_market(item["market"])
    orderbook = _safe("orderbook", code, lambda: _orderbook_pressure(code), None) if korean else None
    flows = _safe("investor", code, lambda: _investor_flow(code), None) if korean else None
    headlines = _safe("news", code, lambda: _headlines(item), [])

    return {
        "item": item,
        "indicators": indicator_df,
        "orderbook": orderbook,
        "flows": flows,
        "headlines": headlines,
        "index": _safe("index", code, lambda: get_index_context(item["market"]), None),
    }


def collect_all(roster: list[dict], max_workers: int = 4) -> list[dict]:
    """Collects the whole roster concurrently.

    Capped low on purpose: each stock fans out to several scraped endpoints on the
    same two hosts (Naver, Bing), and a wide pool turns one batch run into a burst
    those hosts can reasonably read as abuse. Four in flight keeps a ~34-stock run to
    a couple of minutes while staying a polite client.
    """
    if not roster:
        return []
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        results = list(pool.map(collect_for_stock, roster))
    return [r for r in results if r is not None]


def latest_close(indicator_df: pd.DataFrame) -> tuple[float, str]:
    row = indicator_df.iloc[-1]
    return float(row["close"]), str(row["date"])


def as_of_is_stale(indicator_df: pd.DataFrame, session: dt.date, tolerance_days: int = 4) -> bool:
    """Whether the newest bar predates the session the batch thinks it is reporting on.

    The data sources are delayed and occasionally lag a full day, and predicting
    "tomorrow" off a close that is actually several sessions old would be wrong in a
    way nothing downstream could detect. The tolerance absorbs a normal weekend plus
    a holiday; anything beyond that is flagged so the batch can note it.
    """
    try:
        last = dt.datetime.strptime(str(indicator_df.iloc[-1]["date"]), "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return False
    return (session - last).days > tolerance_days
