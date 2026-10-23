"""US benchmark Treasury yields from the same CNBC/Tradeweb quote and chart feed.

Public market reads only. No database, synthetic points, futures substitution, or
conversion of bond-price percentage changes into yield changes.
"""
from __future__ import annotations

import math
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import requests

from app.services.cache import cache

NY = ZoneInfo("America/New_York")
TENORS = ("2", "5", "10")
HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://www.cnbc.com/"}
GRAPHQL = "https://webql-redesign.cnbcfm.com/graphql"
QUERY = """query getQuoteChartData($symbol:String,$timeRange:String,$startDate:String,$endDate:String,$granularity:String){
 chartData(symbol:$symbol,timeRange:$timeRange,startDate:$startDate,endDate:$endDate,granularity:$granularity){
 symbol timeRange priceBars{close tradeTime tradeTimeinMills}}} """
_last_quotes = {}
_last_lock = threading.Lock()


def number(value):
    try:
        result = float(str(value).replace("%", "").replace(",", "").strip())
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def _json(url, params):
    response = requests.get(url, params=params, headers=HEADERS, timeout=(3, 9))
    response.raise_for_status()
    return response.json()


def _fetch_quotes():
    data = _json("https://quote.cnbc.com/quote-html-webservice/quote.htm", {
        "symbols": "US2Y|US5Y|US10Y", "requestMethod": "itv", "noform": 1,
        "fund": 1, "exthrs": 1, "output": "json"})
    rows = data.get("ITVQuoteResult", {}).get("ITVQuote", [])
    if isinstance(rows, dict):
        rows = [rows]
    out = {}
    for row in rows:
        symbol = row.get("symbol")
        if symbol not in {f"US{x}Y" for x in TENORS} or str(row.get("code", "0")) != "0":
            continue
        current, previous = number(row.get("last")), number(row.get("previous_day_closing"))
        if current is None:
            continue
        out[symbol] = {"yield_pct": current, "previous_close": previous,
                       "change_bp": round((current - previous) * 100, 4) if previous is not None else None,
                       "open": number(row.get("open")), "high": number(row.get("high")), "low": number(row.get("low")),
                       "quote_time_label": row.get("last_timedate"),
                       "provider_realtime": str(row.get("realTime", "")).lower() == "true",
                       "received_at": datetime.now(timezone.utc).isoformat()}
    if not out:
        raise ValueError("Treasury quote source returned no valid yields")
    with _last_lock:
        _last_quotes.update(out)
    return out


def quotes():
    try:
        return cache.get_or_set("treasury:quotes:v1", 15, _fetch_quotes, allow_stale=False)
    except Exception:
        with _last_lock:
            return {key: {**row, "stale": True} for key, row in _last_quotes.items()}


def normalize_bars(bars, daily=False):
    points = {}
    for row in bars or []:
        value, millis = number(row.get("close")), number(row.get("tradeTimeinMills"))
        if value is None or millis is None or not -5 <= value <= 30:
            continue
        try:
            stamp = int(millis / 1000)
            at = datetime.fromtimestamp(stamp, timezone.utc)
            if daily:
                day = datetime.strptime(str(row["tradeTime"])[:8], "%Y%m%d").date().isoformat()
                key = day
            else:
                day = at.astimezone(NY).date().isoformat()
                key = stamp
            points[key] = {"time": stamp, "date": day, "yield_pct": value}
        except (ValueError, OverflowError, OSError, KeyError):
            continue
    return [points[key] for key in sorted(points)]


def _chart(tenor, **variables):
    import json
    data = _json(GRAPHQL, {"query": QUERY, "variables": json.dumps({"symbol": f"US{tenor}Y", **variables})})
    chart = data.get("data", {}).get("chartData")
    if not chart or not chart.get("priceBars"):
        raise ValueError("Treasury chart source returned no observations")
    return chart["priceBars"]


def intraday(tenor):
    def load():
        points = normalize_bars(_chart(tenor, timeRange="1D"))
        if not points:
            raise ValueError("Treasury intraday series is empty")
        latest_day = points[-1]["date"]
        return [p for p in points if p["date"] == latest_day]
    return cache.get_or_set(f"treasury:intraday:{tenor}", 30, load)


def _snapshot():
    with ThreadPoolExecutor(max_workers=4) as pool:
        quote_future = pool.submit(quotes)
        futures = {tenor: pool.submit(intraday, tenor) for tenor in TENORS}
        current = quote_future.result()
        items = []
        for tenor in TENORS:
            symbol = f"US{tenor}Y"
            quote = current.get(symbol, {})
            try:
                points = futures[tenor].result()
            except Exception:
                points = []
            baseline = quote.get("previous_close")
            items.append({"tenor": tenor, "symbol": symbol, **quote,
                "yield_pct": quote.get("yield_pct", points[-1]["yield_pct"] if points else None),
                "points": [{**p, "change_bp": round((p["yield_pct"] - baseline) * 100, 4) if baseline is not None else None} for p in points],
                "session_date": points[-1]["date"] if points else None,
                "chart_as_of": points[-1]["time"] if points else None,
                "chart_stale": bool(points and datetime.now(timezone.utc).timestamp() - points[-1]["time"] > 900),
                "chart_error": not bool(points)})
    return {"items": items, "source": "CNBC / Tradeweb", "timezone": "America/New_York",
            "refresh_seconds": 30, "generated_at": datetime.now(timezone.utc).isoformat()}


def snapshot():
    return cache.get_or_set("treasury:snapshot:v1", 15, _snapshot, allow_stale=False)


def history(tenor, years=3, now=None):
    now = now or datetime.now(NY)
    try:
        start = now.date().replace(year=now.year - years)
    except ValueError:
        start = now.date().replace(year=now.year - years, day=28)
    def load():
        bars = _chart(tenor, startDate=(start - timedelta(days=7)).strftime("%Y%m%d") + "000000",
                      endDate=now.strftime("%Y%m%d") + "235959", granularity="1D")
        points = normalize_bars(bars, daily=True)
        result, previous = [], None
        for point in points:
            delta = round((point["yield_pct"] - previous) * 100, 4) if previous is not None else None
            previous = point["yield_pct"]
            if start.isoformat() <= point["date"] <= now.date().isoformat():
                result.append({**point, "change_bp": delta})
        if not result:
            raise ValueError("No Treasury history in selected period")
        return {"tenor": tenor, "years": years, "points": result, "source": "CNBC / Tradeweb",
                "start_date": start.isoformat(), "end_date": now.date().isoformat(),
                "as_of": result[-1]["date"], "granularity": "daily",
                "received_at": datetime.now(timezone.utc).isoformat()}
    return cache.get_or_set(f"treasury:history:{tenor}:{years}:{now.date()}", 900, load)
