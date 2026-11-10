import datetime as dt
import math
import time

import requests

from app.services.cache import cache

# The day-session futures print for ~6.75h a day; a 30s TTL keeps the tile live
# without hammering Naver for a widget that only shows two decimals of change.
TTL_SECONDS = 30

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
}

# Naver's own index feed, keyed by its internal code — "FUT" is 코스피 200 선물.
# Note this is the *day* session only: outside 09:00-15:45 KST both endpoints keep
# returning the last day-session print rather than erroring, which is why the caller
# only ever asks for it while that session is open.
BASIC_URL = "https://m.stock.naver.com/api/index/{code}/basic"
CHART_URL = "https://api.stock.naver.com/chart/domestic/index/{code}"

# Matches the ~3 months of daily closes the other tiles' sparklines carry.
SPARKLINE_POINTS = 60


def _to_float(value) -> float:
    return float(str(value).replace(",", ""))


def _points(code: str) -> list[dict]:
    resp = requests.get(
        CHART_URL.format(code=code),
        headers=HEADERS,
        params={"periodType": "dayCandle", "count": SPARKLINE_POINTS},
        timeout=4,
    )
    resp.raise_for_status()
    out = []
    for info in resp.json().get("priceInfos") or []:
        raw = str(info.get("localDate") or "")
        close = info.get("closePrice")
        if len(raw) != 8 or close is None:
            continue
        out.append({"date": f"{raw[:4]}-{raw[4:6]}-{raw[6:]}", "close": float(close)})
    # Naver ignores small `count` values and hands back its full window, so trim to the
    # same span the other tiles' sparklines carry.
    return out[-SPARKLINE_POINTS:]


def _fetch(code: str) -> dict:
    resp = requests.get(BASIC_URL.format(code=code), headers=HEADERS, timeout=4)
    resp.raise_for_status()
    basic = resp.json()

    # Both deltas arrive already signed ("-0.60" / "-0.06"), so the direction field
    # sitting next to them is redundant here.
    return {
        "close": _to_float(basic["closePrice"]),
        "change": _to_float(basic["compareToPreviousClosePrice"]),
        "change_pct": _to_float(basic["fluctuationsRatio"]),
        "points": _points(code),
    }


def get_index(code: str) -> dict:
    """Quote + sparkline for one Naver-coded domestic index. Raises on failure so the
    caller can fall back rather than render a tile full of nulls."""
    return cache.get_or_set(f"naver_index:{code}", TTL_SECONDS, lambda: _fetch(code))


# Header badge: the headline print only (no sparkline), refreshed every 10 seconds
# server-wide so every visitor shares one Naver request.
HEADER_TTL_SECONDS = 10
HEADER_FAIL_BACKOFF_SECONDS = 30  # a down source must not see one retry per visitor poll
_header_failed_at: float | None = None


def _header_quote() -> dict:
    resp = requests.get(BASIC_URL.format(code="FUT"), headers=HEADERS, timeout=(3, 5))
    resp.raise_for_status()
    basic = resp.json()
    close = _to_float(basic["closePrice"])
    change = _to_float(basic["compareToPreviousClosePrice"])
    change_pct = _to_float(basic["fluctuationsRatio"])
    if not all(math.isfinite(v) for v in (close, change, change_pct)) or close <= 0:
        raise ValueError("Invalid quote")
    stamp = None
    try:
        stamp = int(dt.datetime.fromisoformat(str(basic["localTradedAt"])).timestamp())
    except (KeyError, ValueError, TypeError):
        pass
    return {"close": close, "change": change, "change_pct": change_pct, "quote_time": stamp,
            "session_state": "open" if basic.get("marketStatus") == "OPEN" else "closed"}


def get_header_quote() -> dict:
    """KOSPI 200 day-session futures for the header badge; never raises."""
    global _header_failed_at
    failed = {"close": None, "change": None, "change_pct": None, "quote_time": None,
              "session_state": "closed", "stale": True, "fetch_failed": True}
    if _header_failed_at is not None and time.monotonic() - _header_failed_at < HEADER_FAIL_BACKOFF_SECONDS:
        return failed
    try:
        quote = cache.get_or_set("naver_fut_header", HEADER_TTL_SECONDS, _header_quote)
        _header_failed_at = None
        return {**quote, "stale": False, "fetch_failed": False}
    except Exception:
        _header_failed_at = time.monotonic()
        return failed
