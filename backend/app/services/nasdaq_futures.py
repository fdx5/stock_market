"""NQ prints split by US cash-market hours; process memory and public feeds only.

These are two time windows of the same CME contract, not separate instruments.
The regular window is 09:30–16:00 America/New_York; the night window is outside it.
"""
import datetime as dt
import math
import time
from zoneinfo import ZoneInfo

import requests

from app.data import market_ticker_fetcher
from app.services.cache import cache

ET = ZoneInfo("America/New_York")
_last_good: dict[str, dict] = {}


def _window(stamp: int) -> str:
    local = dt.datetime.fromtimestamp(stamp, ET)
    return "day" if local.weekday() < 5 and 570 <= local.hour * 60 + local.minute < 960 else "night"


def _history() -> list[dict]:
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        try:
            response = requests.get(
                f"https://{host}/v8/finance/chart/NQ=F",
                params={"range": "5d", "interval": "5m", "includePrePost": "true", "_": int(time.time() // 60)},
                headers={"User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache"}, timeout=(2, 4),
            )
            response.raise_for_status()
            result = response.json()["chart"]["result"][0]
            closes = result["indicators"]["quote"][0]["close"]
            bars = [{"quote_time": int(stamp), "close": float(close), "quote_source": "yahoo_5m"}
                    for stamp, close in zip(result.get("timestamp") or [], closes)
                    if close is not None and math.isfinite(float(close)) and float(close) > 0]
            if bars:
                return bars[-1600:]
        except (requests.RequestException, KeyError, ValueError, TypeError, IndexError):
            continue
    raise RuntimeError("Nasdaq futures history unavailable")


def _split(bars: list[dict]) -> dict:
    ordered = sorted(bars, key=lambda bar: bar["quote_time"])
    regular = [bar for bar in ordered if _window(bar["quote_time"]) == "day"]
    result = {}
    for window in ("day", "night"):
        candidates = regular if window == "day" else [bar for bar in ordered if _window(bar["quote_time"]) == "night"]
        if not candidates:
            continue
        row = candidates[-1]
        date = dt.datetime.fromtimestamp(row["quote_time"], ET).date()
        # Day: previous regular window's last print. Night: the last regular print
        # preceding that overnight quote (including a Friday-to-Monday boundary).
        baseline = [bar for bar in regular if bar["quote_time"] < row["quote_time"] and
                    (window == "night" or dt.datetime.fromtimestamp(bar["quote_time"], ET).date() < date)]
        previous = baseline[-1]["close"] if baseline else None
        result[window] = {**row, "symbol": "NQ=F", "window": window,
                          "change": row["close"] - previous if previous else None,
                          "change_pct": round((row["close"] / previous - 1) * 100, 2) if previous else None,
                          "stale": False}
    return result


def _refresh() -> dict:
    bars = []
    history_failed = False
    try:
        bars = cache.get_or_set("nasdaq_header_history", 60, _history, allow_stale=False)
    except Exception:
        history_failed = True
    live = None
    try:
        live = next((row for row in market_ticker_fetcher.get_market_ticker() if row["symbol"] == "NQ=F"), None)
    except Exception:
        pass
    if live and live.get("quote_time") and math.isfinite(live["price"]) and live["price"] > 0:
        bars = [*bars, {"close": live["price"], "quote_time": live["quote_time"], "quote_source": "yahoo_chart"}]
    result = _split(bars)
    for window in ("day", "night"):
        row = result.get(window)
        old = _last_good.get(window)
        if old and (not row or row["quote_time"] < old["quote_time"]):
            row = {**old, "stale": True}
        elif row:
            row = {**row, "stale": history_failed or live is None}
        if row:
            _last_good[window] = row
        result[window] = row
    return result


def get_quotes() -> dict:
    return cache.get_or_set("nasdaq_header_quotes", 10, _refresh, allow_stale=False)
