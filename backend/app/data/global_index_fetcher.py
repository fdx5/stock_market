"""World-index quotes independent of the six-hour daily-price cache.

Public feeds and process memory only. Failed/older replies preserve the last valid
print with its actual timestamp. Each symbol refreshes independently.
"""
import datetime as dt
import math
import time
from zoneinfo import ZoneInfo

import requests

from app.data import yahoo_quote
from app.services.cache import cache

SYMBOLS = {
    "DJI": "^DJI", "IXIC": "^IXIC", "SOXL": "SOXL", "TQQQ": "TQQQ",
    "N225": "^N225", "SSEC": "000001.SS", "HSI": "^HSI",
    "^TWII": "^TWII", "FTSE": "^FTSE",
}
QUOTE_TTL = 10
HISTORY_TTL = 300
_last_good: dict[str, dict] = {}


def _chart(symbol: str, period: str, interval: str) -> dict:
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        try:
            response = requests.get(
                f"https://{host}/v8/finance/chart/{symbol}",
                params={"range": period, "interval": interval,
                        **yahoo_quote.BASE_PARAMS, "_": int(time.time() // QUOTE_TTL)},
                headers={"User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache"},
                timeout=(2, 4),
            )
            response.raise_for_status()
            result = response.json()["chart"]["result"][0]
            if result:
                return result
        except (requests.RequestException, ValueError, KeyError, IndexError, TypeError):
            continue
    raise RuntimeError("World index feed unavailable")


def _date(stamp: int, meta: dict) -> str:
    zone = ZoneInfo(meta.get("exchangeTimezoneName") or "UTC")
    return dt.datetime.fromtimestamp(stamp, zone).date().isoformat()


def _history(symbol: str) -> list[dict]:
    result = _chart(symbol, "3mo", "1d")
    closes = result["indicators"]["quote"][0]["close"]
    points = []
    for stamp, close in zip(result.get("timestamp") or [], closes):
        if close is not None and math.isfinite(float(close)) and float(close) > 0:
            points.append({"date": _date(stamp, result["meta"]), "close": float(close)})
    if not points:
        raise ValueError("World index history is empty")
    return points[-60:]


def _refresh(symbol: str) -> dict:
    old = _last_good.get(symbol, {})
    quote = None
    try:
        result = _chart(symbol, "1d", "1m")
        parsed = yahoo_quote.extract_quote(result)
        if parsed and parsed.get("quote_time"):
            quote = {**yahoo_quote.as_stock_quote(parsed),
                     "quote_date": _date(parsed["quote_time"], result["meta"])}
    except (RuntimeError, ValueError, TypeError, KeyError, IndexError, OverflowError):
        pass
    stale = quote is None
    if old.get("quote_time") and (quote is None or quote["quote_time"] < old["quote_time"]):
        quote = {k: v for k, v in old.items() if k not in ("points", "stale")}
        stale = True

    try:
        points = cache.get_or_set(f"world_index_history:{symbol}", HISTORY_TTL,
                                  lambda: _history(symbol))
    except Exception:
        points = old.get("points", [])
    # Copy the cached daily series. Repair a missing/null current daily bar using
    # the actual regular-session print; extended-hours prices stay in the headline.
    points = [dict(p) for p in points]
    if quote:
        point = {"date": quote["quote_date"], "close": quote["regular_close"]}
        if not points or points[-1]["date"] < point["date"]:
            points.append(point)
        elif points[-1]["date"] == point["date"]:
            points[-1] = point
    elif points:
        close = points[-1]["close"]
        previous = points[-2]["close"] if len(points) > 1 else close
        quote = {"close": close, "change": close - previous,
                 "change_pct": (close / previous - 1) * 100,
                 "session": "regular", "quote_time": None, "quote_source": "daily_history"}

    row = {**(quote or {"close": None, "change": None, "change_pct": None,
                       "quote_time": None}), "points": points[-60:], "stale": stale}
    if row["close"] is not None:
        _last_good[symbol] = row
    return row


def get_index(code: str) -> dict:
    symbol = SYMBOLS[code]
    return cache.get_or_set(f"world_index_quote:{symbol}", QUOTE_TTL,
                            lambda: _refresh(symbol), allow_stale=False)
