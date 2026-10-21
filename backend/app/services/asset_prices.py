"""Read-only, bounded daily price history for the seven cross-market assets."""
import calendar
import datetime as dt
import math
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests

from app.services.cache import cache

ASSETS = {
    "usd-krw": ("KRW=X", "KRW"),
    "bitcoin": ("BTC-USD", "USD"),
    "ethereum": ("ETH-USD", "USD"),
    "xrp": ("XRP-USD", "USD"),
    "wti": ("CL=F", "USD/barrel"),
    "gold": ("GC=F", "USD/troy oz"),
    "silver": ("SI=F", "USD/troy oz"),
}


def year_start(day: dt.date) -> dt.date:
    return day.replace(year=day.year - 1, day=min(day.day, calendar.monthrange(day.year - 1, day.month)[1]))


def _number(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def build_history(asset: str, result: dict, now: dt.datetime) -> dict:
    symbol, unit = ASSETS[asset]
    zone_name = result.get("meta", {}).get("exchangeTimezoneName") or "UTC"
    try:
        zone = ZoneInfo(zone_name)
    except (ZoneInfoNotFoundError, ValueError):
        zone_name, zone = "UTC", dt.timezone.utc
    end = now.astimezone(zone).date()
    start = year_start(end)
    quote = (result.get("indicators", {}).get("quote") or [{}])[0]
    by_date = {}
    for index, stamp in enumerate(result.get("timestamp") or []):
        try:
            day = dt.datetime.fromtimestamp(stamp, zone).date()
        except (TypeError, ValueError, OverflowError, OSError):
            continue
        values = {key: _number((quote.get(key) or [])[index]) if index < len(quote.get(key) or []) else None for key in ("open", "high", "low", "close", "volume")}
        if values["close"] is None or day > end:
            continue
        # An upstream incomplete duplicate must never replace a verified daily close.
        by_date[day] = {"date": day.isoformat(), **values}
    points, previous = [], None
    for day, point in sorted(by_date.items()):
        close = point["close"]
        point["change"] = close - previous if previous is not None else None
        point["change_pct"] = (close / previous - 1) * 100 if previous not in (None, 0) else None
        previous = close
        if day >= start:
            points.append(point)
    if not points:
        raise ValueError("No daily prices available")
    return {"asset": asset, "symbol": symbol, "unit": unit, "source": "Yahoo Finance", "timezone": zone_name,
            "start_date": start.isoformat(), "end_date": end.isoformat(), "latest_date": points[-1]["date"],
            "fetched_at": now.isoformat(), "points": points}


def _fetch(asset: str) -> dict:
    now = dt.datetime.now(dt.timezone.utc)
    start = year_start(now.date()) - dt.timedelta(days=10)
    params = {"period1": int(dt.datetime.combine(start, dt.time(), dt.timezone.utc).timestamp()),
              "period2": int(now.timestamp()), "interval": "1d"}
    for host in ("https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"):
        try:
            response = requests.get(f"{host}/v8/finance/chart/{ASSETS[asset][0]}", params=params,
                                    headers={"User-Agent": "Mozilla/5.0"}, timeout=8)
            response.raise_for_status()
            return build_history(asset, response.json()["chart"]["result"][0], now)
        except (requests.RequestException, KeyError, IndexError, TypeError, ValueError):
            continue
    raise RuntimeError("Daily price provider unavailable")


def get_asset_history(asset: str) -> dict:
    if asset not in ASSETS:
        raise KeyError(asset)
    # At most seven in-memory entries; no database or persistent file writes.
    return cache.get_or_set(f"asset_daily_v1:{asset}", 300, lambda: _fetch(asset), allow_stale=False)
