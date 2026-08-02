"""Trailing returns (1일/7일/1개월/3개월/6개월/1년/전체기간) and a sparkline series for
the global TOP 100 page, one Yahoo v8 chart call per symbol with `range=max` so every
constituent — KR, US, or any other Yahoo-recognized ticker — is measured against its
full trading history rather than mixing a KR-only 1-year window (see
sparkline_fetcher.get_kr_sparklines) with a US decades-long one. That inconsistency is
exactly why this is a separate module instead of an extension of sparkline_fetcher:
the two board pages sparkline_fetcher serves only ever need up to a 1-year YTD figure,
this page explicitly asked for "전체기간" (all-time).

Same shape as sparkline_fetcher._fetch_us / _summarize otherwise — see that module for
the reasoning behind the offset-based return math and the sparkline point trim.
"""

import datetime as dt
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import requests

logger = logging.getLogger(__name__)

_YAHOO_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
}

# 100 symbols over 12 workers — same concurrency ceiling sparkline_fetcher uses, to
# stay under whatever unstated rate limit keeps this endpoint unauthenticated at all.
_MAX_WORKERS = 12
_TIMEOUT_SECONDS = 10

# How many trailing daily closes the row's sparkline actually draws. A `range=max`
# series can span decades for an old megacap; only the tail is kept for the chart —
# the full series is still used underneath to compute every return window.
SPARKLINE_POINTS = 90

# Trading sessions behind the latest bar for each fixed-window return. Not calendar
# days, for the same reason sparkline_fetcher counts sessions: the series is indexed
# by session, so this is both exact and free. "all" has no offset — see _summarize.
_RETURN_OFFSETS = {"d1": 1, "w1": 5, "m1": 21, "m3": 63, "m6": 126, "y1": 252}


@dataclass
class GlobalReturnSeries:
    """One symbol's row-facing history: `points`/`dates` feed the sparkline, `returns`
    is the {d1,w1,m1,m3,m6,y1,all} percentage map. Any return can be None when the
    series doesn't reach back that far (a recent IPO has no y1 return, and honestly
    saying so beats measuring one against an IPO price)."""

    points: list[float] = field(default_factory=list)
    dates: list[str] = field(default_factory=list)
    returns: dict[str, float | None] = field(default_factory=dict)


def _pct(now: float, then: float) -> float | None:
    if not then:
        return None
    return round((now / then - 1) * 100, 2)


def _summarize(bars: list[tuple[str, float]]) -> GlobalReturnSeries | None:
    bars = [b for b in bars if b[1] and b[1] > 0]
    if len(bars) < 2:
        return None

    closes = [b[1] for b in bars]
    latest = closes[-1]
    returns: dict[str, float | None] = {}
    for key, offset in _RETURN_OFFSETS.items():
        returns[key] = _pct(latest, closes[-1 - offset]) if len(closes) > offset else None
    # Filled in by _fetch_one from a separate max-range call, against the ticker's
    # true earliest known close — this 2y-bounded series can't supply it honestly.
    returns["all"] = None

    return GlobalReturnSeries(
        points=[round(c, 4) for c in closes[-SPARKLINE_POINTS:]],
        dates=[b[0] for b in bars[-SPARKLINE_POINTS:]],
        returns=returns,
    )


def _fetch_bars(symbol: str, range_: str) -> list[tuple[str, float]]:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range={range_}"
    resp = requests.get(url, headers=_YAHOO_HEADERS, timeout=_TIMEOUT_SECONDS)
    resp.raise_for_status()
    result = resp.json()["chart"]["result"][0]
    quote = (result.get("indicators", {}).get("quote") or [{}])[0]
    stamps = result.get("timestamp") or []
    closes = quote.get("close") or []
    return [
        (dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y%m%d"), float(c))
        for ts, c in zip(stamps, closes)
        if c is not None
    ]


def _fetch_one(symbol: str) -> GlobalReturnSeries | None:
    # `range=2y&interval=1d` stays genuinely daily (verified: ~501 bars, one per
    # session) — comfortably more than the 252-session y1 offset needs. `range=max`
    # would also answer 200, but Yahoo silently coarsens very long ranges to monthly
    # bars behind the same `interval=1d` request, which would put "1개월" and "3개월"
    # offsets on the wrong footing entirely (session count != bar count once the
    # granularity changes). A second, separate call at max range is used only for its
    # very first bar, as the all-time baseline — coarse granularity is irrelevant to
    # a single fixed reference point.
    try:
        bars = _fetch_bars(symbol, "2y")
    except Exception:  # noqa: BLE001 - one symbol's failure must not sink the page
        logger.warning("global_returns_fetcher: failed for %s", symbol, exc_info=True)
        return None

    series = _summarize(bars)
    if series is None:
        return None

    try:
        inception_bars = _fetch_bars(symbol, "max")
        if inception_bars and series.points:
            series.returns["all"] = _pct(series.points[-1], inception_bars[0][1])
    except Exception:  # noqa: BLE001 - all-time is a nice-to-have, not worth losing the rest for
        logger.warning("global_returns_fetcher: max-range fetch failed for %s", symbol, exc_info=True)

    return series


def get_global_returns(symbols: list[str]) -> dict[str, GlobalReturnSeries]:
    """Returns/sparkline series for many symbols at once, fanned out over a thread
    pool. A symbol whose fetch fails is simply absent — callers should still show the
    row with whatever else they have (price, logo, rank) rather than dropping it."""
    out: dict[str, GlobalReturnSeries] = {}
    if not symbols:
        return out
    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        for symbol, series in zip(symbols, pool.map(_fetch_one, symbols)):
            if series is not None:
                out[symbol] = series
    return out
