"""World-index quotes independent of the six-hour daily-price cache.

Public feeds and process memory only. Failed/older replies preserve the last valid
print with its actual timestamp. Each symbol refreshes independently.
"""
import datetime as dt
import math
import time
from zoneinfo import ZoneInfo

import requests

from app.data import index_fetcher, yahoo_quote
from app.services.cache import cache

SYMBOLS = {
    "SPX": "^GSPC",
    "DJI": "^DJI", "IXIC": "^IXIC", "SOXL": "SOXL", "TQQQ": "TQQQ",
    "N225": "^N225", "SSEC": "000001.SS", "HSI": "^HSI",
    "NIFTY": "^NSEI", "TSX": "^GSPTSE", "CAC": "^FCHI",
    "KOSPI": "^KS11", "KOSDAQ": "^KQ11", "^TWII": "^TWII", "FTSE": "^FTSE",
    "DAX": "^GDAXI", "SMI": "^SSMI", "TASI": "^TASI.SR", "ASX200": "^AXJO",
}
# Yahoo returns only the latest bar for these; CNBC carries the daily series.
CNBC_HISTORY = {"^TASI.SR": ".TASI"}
QUOTE_TTL = 10
HISTORY_TTL = 300
_last_good: dict[str, dict] = {}
DOMESTIC = {"^KS11": "KOSPI", "^KQ11": "KOSDAQ"}


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


def _cash_quote(price, previous, stamp, zone, source):
    price, previous, stamp = float(price), float(previous), int(stamp)
    if not all(math.isfinite(v) and v > 0 for v in (price, previous, stamp)) or stamp > time.time() + 60:
        raise ValueError("Invalid index print")
    row = yahoo_quote.as_stock_quote({"price": price, "previous_close": previous,
                                    "regular_close": price, "session": "regular", "quote_time": stamp})
    return {**row, "quote_source": source, "quote_date": _date(stamp, {"exchangeTimezoneName": zone})}


def _direct_quote(symbol):
    if symbol in DOMESTIC:
        data = index_fetcher.get_index(DOMESTIC[symbol], fresh=True)
        if not data:
            return None
        traded = dt.datetime.fromisoformat(data["updated_at"])
        if traded.tzinfo is None or data["symbol"] != DOMESTIC[symbol]:
            raise ValueError("Invalid domestic index print")
        row = _cash_quote(data["close"], data["close"] - data["change"], traded.timestamp(), "Asia/Seoul", "naver_index")
        return {**row, "market_status": data.get("market_status")}
    if symbol != "^TWII":
        return None
    response = requests.get("https://mis.twse.com.tw/stock/api/getStockInfo.jsp",
                            params={"ex_ch": "tse_t00.tw", "json": 1, "delay": 0, "_": int(time.time() // QUOTE_TTL)},
                            headers={"User-Agent": "Mozilla/5.0", "Referer": "https://mis.twse.com.tw/stock/index.jsp"},
                            timeout=(2, 4))
    response.raise_for_status()
    data = response.json()
    if data.get("rtcode") != "0000":
        return None
    for tick in data.get("msgArray") or []:
        if tick.get("ex") == "tse" and tick.get("ch") == "t00.tw":
            row = _cash_quote(tick["z"], tick["y"], int(tick["tlong"]) // 1000, "Asia/Taipei", "twse_mis")
            if row["quote_date"].replace("-", "") != tick.get("d"):
                raise ValueError("Mismatched TWSE trade date")
            return row
    return None


def _same_session_as_direct(symbol, direct):
    local = dt.datetime.fromtimestamp(time.time(), ZoneInfo("Asia/Taipei"))
    return local.date().isoformat() == direct["quote_date"] and local.time() >= dt.time(13, 35)


def _rebase_on_history(quote: dict, points: list[dict]) -> dict:
    """Measure a Yahoo print against the exchange's previous daily close.

    Yahoo's chart meta `previousClose` has been seen a whole session behind for
    Asian indices (^TWII, ^HSI, 000001.SS, ^AXJO on 2026-11-25), which turned a
    -4.8% day into +3.8%. The daily series carries the right prior bar, so it wins
    whenever it is plausibly the same instrument (within 20%).
    """
    if quote.get("quote_source") != "yahoo_chart" or not quote.get("quote_date"):
        return quote
    prior = [p for p in points if p["date"] < quote["quote_date"]]
    if not prior:
        return quote
    previous = prior[-1]["close"]
    price, regular = quote.get("close"), quote.get("regular_close")
    change = quote.get("change")
    if price is None or change is None or not math.isfinite(previous) or previous <= 0:
        return quote
    stated = price - change
    if stated <= 0 or abs(previous / stated - 1) > 0.2 or abs(previous / stated - 1) < 1e-5:
        return quote
    fixed = {**quote, "change": round(price - previous, 4),
             "change_pct": round((price / previous - 1) * 100, 2), "previous_source": "daily_history"}
    if quote.get("regular_change_pct") is not None and regular:
        fixed["regular_change_pct"] = round((regular / previous - 1) * 100, 2)
    return fixed


def _latest_quote(symbol):
    try:
        direct = _direct_quote(symbol)
    except (requests.RequestException, ValueError, KeyError, IndexError, TypeError, OverflowError, OSError):
        direct = None
    # A valid but frozen primary feed must also give the alternate a chance.
    if direct and time.time() - direct["quote_time"] < 120:
        return direct
    # After the close both feeds hold the same final print; the exchange's own
    # previous close is authoritative (Yahoo's meta has lagged a session for ^TWII).
    if direct and direct.get("quote_source") == "twse_mis" and _same_session_as_direct(symbol, direct):
        return direct
    try:
        result = _chart(symbol, "1d", "1m")
        parsed = yahoo_quote.extract_quote(result)
        if parsed and parsed.get("quote_time"):
            stamp = int(parsed["quote_time"])
            if 0 < stamp <= time.time() + 60 and (not direct or stamp > direct["quote_time"]):
                meta = result["meta"]
                regular = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
                return {**yahoo_quote.as_stock_quote(parsed), "quote_date": _date(stamp, meta),
                        "regular_start": regular.get("start"), "regular_end": regular.get("end")}
    except (RuntimeError, ValueError, TypeError, KeyError, IndexError, OverflowError, OSError):
        pass
    return direct


def cnbc_history(symbol: str) -> list[dict]:
    response = requests.get("https://ts-api.cnbc.com/harmony/app/charts/1Y.json",
                            params={"symbol": CNBC_HISTORY[symbol]},
                            headers={"User-Agent": "Mozilla/5.0"}, timeout=(2, 5))
    response.raise_for_status()
    points = [{"date": f"{bar['tradeTime'][:4]}-{bar['tradeTime'][4:6]}-{bar['tradeTime'][6:8]}", "close": float(bar["close"])}
              for bar in response.json()["barData"]["priceBars"] if bar.get("close")]
    points = [p for p in points if math.isfinite(p["close"]) and p["close"] > 0]
    if not points:
        raise ValueError("World index history is empty")
    return points


def _history(symbol: str) -> list[dict]:
    if symbol in CNBC_HISTORY:
        return cnbc_history(symbol)[-60:]
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
    quote = _latest_quote(symbol)
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
    points = list({p["date"]: dict(p) for p in points}.values())
    if quote and points and points[-1]["date"] > quote["quote_date"]:
        # A newer dated bar beats a timestamped print from an older session.
        quote, stale = None, True
    if quote:
        point = {"date": quote["quote_date"], "close": quote["regular_close"]}
        if not points or points[-1]["date"] < point["date"]:
            points.append(point)
        elif points[-1]["date"] == point["date"]:
            points[-1] = point
        quote = _rebase_on_history(quote, points)
    elif points:
        close = points[-1]["close"]
        previous = points[-2]["close"] if len(points) > 1 else None
        quote = {"close": close, "change": close - previous if previous else None,
                 "change_pct": (close / previous - 1) * 100 if previous else None,
                 "quote_date": points[-1]["date"],
                 "session": "regular", "quote_time": None, "quote_source": "daily_history"}

    row = {**(quote or {"close": None, "change": None, "change_pct": None,
                       "quote_time": None}), "points": points[-60:], "stale": stale}
    now = time.time()
    if quote and quote.get("quote_time"):
        # Yahoo's session bounds span some midday breaks. Allow for breaks plus
        # vendor delay before classifying a frozen session as a missed update.
        if (quote.get("regular_start") or now + 1) < now < (quote.get("regular_end") or 0):
            row["stale"] |= now - max(quote["quote_time"], quote["regular_start"]) > 2 * 3600
        if quote.get("market_status") == "OPEN":
            row["stale"] |= now - quote["quote_time"] > 180
        if quote.get("quote_source") == "twse_mis":
            local = dt.datetime.fromtimestamp(now, ZoneInfo("Asia/Taipei"))
            if local.date().isoformat() == quote["quote_date"] and dt.time(9) < local.time() < dt.time(13, 30):
                row["stale"] |= now - quote["quote_time"] > 180
    if row["close"] is not None:
        _last_good[symbol] = row
    return row


def get_index(code: str) -> dict:
    symbol = SYMBOLS[code]
    return cache.get_or_set(f"world_index_quote:{symbol}", QUOTE_TTL,
                            lambda: _refresh(symbol), allow_stale=False)
