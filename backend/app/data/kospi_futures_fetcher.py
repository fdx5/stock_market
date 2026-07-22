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
