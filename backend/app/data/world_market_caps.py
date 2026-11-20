"""Carry each market's published capitalisation forward to the latest close.

cap(now) = cap(base) x index(now) / index(base) x USD value of the currency(now / base).
A benchmark index stands in for the whole market, so the result is an estimate; the
published base figure and date stay in the payload beside it.
"""
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import math

from app.data.global_index_fetcher import CNBC_HISTORY, _chart, _date, cnbc_history
from app.data.world_markets import BASE_DATES, DEFAULT_BASE_DATE, MARKETS
from app.services.cache import cache

# Index weights for the market, and the Yahoo FX symbol with whether it is quoted
# as local units per dollar (True) or dollars per local unit (False).
PROXIES = {
    "US": ({"^GSPC": 1}, None), "CN": ({"000001.SS": 1}, ("CNY=X", True)),
    "JP": ({"^N225": 1}, ("JPY=X", True)), "HK": ({"^HSI": 1}, ("HKD=X", True)),
    "IN": ({"^NSEI": 1}, ("INR=X", True)), "CA": ({"^GSPTSE": 1}, ("CAD=X", True)),
    "TW": ({"^TWII": 1}, ("TWD=X", True)), "KR": ({"^KS11": .88, "^KQ11": .12}, ("KRW=X", True)),
    "GB": ({"^FTSE": 1}, ("GBPUSD=X", False)), "FR": ({"^FCHI": 1}, ("EURUSD=X", False)),
    "DE": ({"^GDAXI": 1}, ("EURUSD=X", False)), "CH": ({"^SSMI": 1}, ("CHF=X", True)),
    "SA": ({"^TASI.SR": 1}, ("SAR=X", True)), "AU": ({"^AXJO": 1}, ("AUDUSD=X", False)),
}


def _series(symbol):
    if symbol in CNBC_HISTORY:
        return [(p["date"], p["close"]) for p in cnbc_history(symbol)]
    result = _chart(symbol, "1y", "1d")
    closes = result["indicators"]["quote"][0]["close"]
    return [(_date(t, result["meta"]), float(c)) for t, c in zip(result.get("timestamp") or [], closes)
            if c is not None and math.isfinite(float(c)) and float(c) > 0]


def _ratio(series, base_date):
    before = [close for day, close in series if day <= base_date]
    if not before:
        raise ValueError("No close on or before the base date")
    return series[-1][1] / before[-1], series[-1][0]


def _estimate():
    symbols = {s for weights, fx in PROXIES.values() for s in [*weights, *([fx[0]] if fx else [])]}
    with ThreadPoolExecutor(max_workers=8) as pool:
        series = dict(zip(symbols, pool.map(lambda s: _safe(_series, s), symbols)))
    caps = {}
    for code, _, base_cap, *_ in MARKETS:
        weights, fx = PROXIES[code]
        base_date = BASE_DATES.get(code, DEFAULT_BASE_DATE)
        try:
            moves = [(_ratio(series[s], base_date), w) for s, w in weights.items()]
            factor = sum(r * w for (r, _), w in moves) / sum(weights.values())
            as_of = max(day for (_, day), _ in moves)
            if fx:
                fx_ratio, _ = _ratio(series[fx[0]], base_date)
                factor *= 1 / fx_ratio if fx[1] else fx_ratio
            caps[code] = {"cap": round(base_cap * factor, 3), "as_of": as_of, "estimated": True}
        except (TypeError, ValueError, KeyError, ZeroDivisionError):
            caps[code] = {"cap": base_cap, "as_of": base_date, "estimated": False}
        caps[code].update(base_cap=base_cap, base_date=base_date)
    return caps


def _safe(fn, arg):
    try:
        return fn(arg)
    except Exception:
        return None


def latest_caps():
    return cache.get_or_set("world_markets:caps", 3600, _estimate)
