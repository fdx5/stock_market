"""A year of daily closes per stock, reduced to the handful of numbers a card needs.

The 100-종목 board pages (`/api/market/board`) draw a sparkline on every card and
label it with a 52-week range and four trailing returns. All of that is derivable
from one daily-bar series per symbol, so this module fetches exactly that — once per
symbol per TTL — and hands back a compact summary instead of the raw frame. The board
service never sees an OHLCV table; it only ever sees `SparkSeries`.

Two upstreams, one shape:

- KR: Naver's `siseJson.naver` chart endpoint. One request covers a full year of daily
  bars in ~15KB and needs no auth, which is what makes 100 codes affordable. It is not
  JSON — it's a JS array literal with single-quoted headers — hence `_parse_naver_rows`.
- US: Yahoo's v8 chart endpoint, the same one `price_fetcher`/`yahoo_quote` already
  talk to. Its `meta` carries `fiftyTwoWeekHigh`/`Low` outright, so those are read
  rather than recomputed from the series.

Both are fetched through a bounded thread pool: the point of this module is that a
cold board costs one wave of parallel requests, not 100 serial ones. A symbol whose
fetch fails is simply absent from the result — a card without a sparkline still shows
its price, so a partial map is much better than a failed request.
"""

import ast
import datetime as dt
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import requests

logger = logging.getLogger(__name__)

# Naver's chart host is the same origin family the rest of the KR scrapes use.
_NAVER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://finance.naver.com/",
}
_YAHOO_HEADERS = {"User-Agent": _NAVER_HEADERS["User-Agent"]}

# 100 codes over 12 workers is ~9 waves. Higher would finish sooner but starts to look
# like a scrape to the upstream; this is the same order of concurrency market_map's
# page fetch already uses.
_MAX_WORKERS = 12
_TIMEOUT_SECONDS = 8

# How many closes the card's sparkline actually draws. Roughly three months of trading
# days — long enough to show a trend, short enough that 100 of them stay a small JSON
# payload. The 52-week range and the trailing returns still come off the full year.
SPARKLINE_POINTS = 60

# Trading days behind the latest bar that each trailing return is measured from. Not
# calendar days: the series is indexed by session, so counting sessions is both exact
# and free. ~5 / ~21 / ~63 sessions are the usual 1주 / 1개월 / 3개월 conventions.
# d20/d120 are the literal session-count conventions the 순위 board's ranking tables
# ask for (거래일 기준 20일/120일), distinct from m1/m3's calendar-month framing even
# though d20 lands close to m1.
# YTD is not in here because it isn't a fixed offset — see `_summarize`.
_RETURN_OFFSETS = {"w1": 5, "m1": 21, "m3": 63, "d20": 20, "d60": 60, "d120": 120, "d240": 240}


@dataclass
class SparkSeries:
    """One symbol's card-facing history summary.

    `points` is chronological closes (oldest first) and is the only field the
    sparkline itself reads. Everything else is a label drawn beside it. Any field can
    be None when the series is too short to support it — a stock listed three weeks
    ago has no 3-month return, and saying so is more honest than reporting one
    measured against its IPO price.
    """

    points: list[float] = field(default_factory=list)
    # Session dates for `points` — same length, same order (YYYYMMDD). What lets the
    # card's sparkline tooltip name the day it's hovering rather than count backwards.
    dates: list[str] = field(default_factory=list)
    week52_high: float | None = None
    week52_low: float | None = None
    returns: dict[str, float | None] = field(default_factory=dict)


def _pct(now: float, then: float) -> float | None:
    if not then:
        return None
    return round((now / then - 1) * 100, 2)


def _summarize(bars: list[tuple[str, float, float, float]]) -> SparkSeries | None:
    """Turns a chronological year of (YYYYMMDD, high, low, close) bars into the card
    summary.

    High and low are carried separately from close (rather than reusing close for all
    three) because a 52-week range quoted on closes understates it — the real high and
    low of the window are intraday prints, which is what every quote page shows.
    """
    bars = [b for b in bars if b[3] and b[3] > 0]
    if len(bars) < 2:
        return None

    closes = [b[3] for b in bars]
    latest = closes[-1]
    returns: dict[str, float | None] = {}
    for key, offset in _RETURN_OFFSETS.items():
        # `> offset` rather than `>=`: an N-session return needs an N-sessions-ago bar
        # *plus* today's, so a series of exactly N bars can't supply one.
        returns[key] = _pct(latest, closes[-1 - offset]) if len(closes) > offset else None

    # YTD is measured against last year's final close, not the first session of this
    # year — the same baseline every exchange quotes it from, and the reason it can't
    # be expressed as a fixed session offset like the three above. None when the window
    # doesn't reach back past New Year (early January, or a recent listing), which is a
    # real "not applicable yet" rather than a zero.
    year_start = f"{dt.date.today().year}0101"
    prior = [b[3] for b in bars if b[0] < year_start]
    returns["ytd"] = _pct(latest, prior[-1]) if prior else None

    highs = [b[1] for b in bars if b[1]] or closes
    lows = [b[2] for b in bars if b[2]] or closes

    return SparkSeries(
        points=[round(c, 4) for c in closes[-SPARKLINE_POINTS:]],
        dates=[b[0] for b in bars[-SPARKLINE_POINTS:]],
        week52_high=round(max(highs), 4),
        week52_low=round(min(lows), 4),
        returns=returns,
    )


# ───────────────────────────── KR (Naver siseJson) ─────────────────────────────

_ROW_RE = re.compile(r'\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*(\d+)')


def _parse_naver_rows(text: str) -> list[tuple[str, float, float, float]]:
    """(YYYYMMDD, high, low, close) per session, oldest first.

    The endpoint returns a JS array literal — a single-quoted Korean header row
    followed by double-quoted data rows — which happens to also be a valid *Python*
    literal, so `ast.literal_eval` reads it directly. The regex fallback exists
    because that only holds while the payload stays well-formed; a truncated or
    subtly-reshaped response should cost the sparkline, not the whole board.
    """
    rows: list[list] = []
    try:
        parsed = ast.literal_eval(text.strip())
        rows = [r for r in parsed if isinstance(r, list) and len(r) >= 5 and str(r[0]).isdigit()]
    except (ValueError, SyntaxError):
        rows = [[m.group(1), 0, float(m.group(3)), float(m.group(4)), float(m.group(5))] for m in _ROW_RE.finditer(text)]

    # Columns: 날짜, 시가, 고가, 저가, 종가, 거래량, 외국인소진율.
    return [(str(r[0]), float(r[2]), float(r[3]), float(r[4])) for r in rows]


def _fetch_kr(code: str, start: str, end: str) -> SparkSeries | None:
    url = (
        "https://api.finance.naver.com/siseJson.naver"
        f"?symbol={code}&requestType=1&startTime={start}&endTime={end}&timeframe=day"
    )
    try:
        resp = requests.get(url, headers=_NAVER_HEADERS, timeout=_TIMEOUT_SECONDS)
        resp.raise_for_status()
        resp.encoding = "euc-kr"
        bars = _parse_naver_rows(resp.text)
    except Exception:  # noqa: BLE001 - one symbol's failure must not sink the board
        return None
    return _summarize(bars)


# ───────────────────────────── US (Yahoo v8 chart) ─────────────────────────────


def _fetch_us(symbol: str) -> SparkSeries | None:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1y"
    try:
        resp = requests.get(url, headers=_YAHOO_HEADERS, timeout=_TIMEOUT_SECONDS)
        resp.raise_for_status()
        result = resp.json()["chart"]["result"][0]
        quote = (result.get("indicators", {}).get("quote") or [{}])[0]
        stamps = result.get("timestamp") or []
        closes = quote.get("close") or []
        highs = quote.get("high") or []
        lows = quote.get("low") or []
        # Yahoo pads no-trade sessions with nulls; a bar is only usable if it has a
        # close, and the date has to come from the aligned timestamp rather than the
        # filtered list's position.
        bars = [
            (
                dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y%m%d"),
                float(h or c),
                float(low or c),
                float(c),
            )
            for ts, h, low, c in zip(stamps, highs, lows, closes)
            if c is not None
        ]
    except Exception:  # noqa: BLE001 - same best-effort contract as the KR path
        return None

    summary = _summarize(bars)
    if summary is None:
        return None

    # Yahoo publishes the exchange-official 52-week range in `meta`; prefer it over the
    # one computed from a 1y window of daily bars, which can miss a print by a day or
    # two at the window's edge.
    meta = result.get("meta") or {}
    if meta.get("fiftyTwoWeekHigh"):
        summary.week52_high = round(float(meta["fiftyTwoWeekHigh"]), 4)
    if meta.get("fiftyTwoWeekLow"):
        summary.week52_low = round(float(meta["fiftyTwoWeekLow"]), 4)
    return summary


# ───────────────────────────────── public API ─────────────────────────────────


def _gather(fetch, symbols: list[str]) -> dict[str, SparkSeries]:
    out: dict[str, SparkSeries] = {}
    if not symbols:
        return out
    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        for symbol, series in zip(symbols, pool.map(fetch, symbols)):
            if series is not None:
                out[symbol] = series
    return out


def get_kr_sparklines(codes: list[str]) -> dict[str, SparkSeries]:
    """One year of daily bars per 6-digit KRX code, summarized. Keyed by code; codes
    whose fetch failed are absent."""
    today = dt.date.today()
    # Exactly 52 weeks, so the range this produces is the one the "52주" label claims.
    # (Yahoo hands the US path its own official range in `meta`; there is no KR
    # equivalent, so the window itself has to be the right length.)
    start = (today - dt.timedelta(weeks=52)).strftime("%Y%m%d")
    end = today.strftime("%Y%m%d")
    return _gather(lambda code: _fetch_kr(code, start, end), codes)


def get_us_sparklines(symbols: list[str]) -> dict[str, SparkSeries]:
    """The US counterpart, keyed by ticker."""
    return _gather(_fetch_us, symbols)
