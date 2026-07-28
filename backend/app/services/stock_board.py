"""The 100-종목 카드 보드 behind `/api/market/board` — KOSPI, KOSDAQ and NASDAQ 100.

Deliberately assembled from snapshots the app already keeps warm rather than from its
own scrape. The ranked roster, each name's sector, and its live NXT-aware price all
come straight out of `market_map` / `us_market_map`, which the map pages poll and the
startup warmer primes; the only thing this module fetches for itself is a year of
daily bars per symbol (`sparkline_fetcher`), and that lands on its own slow cache.

So a board request during normal operation costs no upstream call at all, and — more
importantly — a card here can never disagree with the same stock's tile on the map
page. Both read the same number.

What each card gets beyond price and change:

- a ~3-month sparkline whose last point is pinned to the live price (see `_apply_spark`)
- the 52-week range plus where inside it the stock currently sits
- 1주 / 1개월 / 3개월 / YTD trailing returns
- KR only: 거래량 / PER / ROE / 외국인비율, which ride along free on the market-cap
  page scrape the roster already comes from

and each sector gets a cap-weighted average change and an up/flat/down split, computed
here so every group header on the page is derived from exactly one definition.
"""

import datetime as dt
from zoneinfo import ZoneInfo

from app.data.sparkline_fetcher import SparkSeries, get_kr_sparklines, get_us_sparklines
from app.data.us_universe import get_korean_names_ready
from app.services.cache import cache
from app.services.market_map import get_kosdaq_map, get_kospi_map
from app.services.us_market_map import get_nasdaq100_map

KST = ZoneInfo("Asia/Seoul")

BOARD_LIMIT = 100

# Daily bars change once a session; the live price that gets pinned onto the end of the
# sparkline comes from the roster snapshot's own 10s tier, not from here. So this can
# be slow, and should be: it is the only part of a board request that can touch the
# network at all.
TTL_SPARK_SECONDS = 15 * 60

# A ±0.05% move is a tick or two on most of these names — counting it as 상승 or 하락
# would make the breadth bar read as though nothing ever trades flat. Matches how the
# board's own cards render a flat badge.
FLAT_BAND_PCT = 0.05

MARKETS = ("kospi", "kosdaq", "nasdaq")

_LABELS = {"kospi": "KOSPI", "kosdaq": "KOSDAQ", "nasdaq": "NASDAQ 100"}

# GICS sector names as slickcharts/FinanceDataReader hand them over, in Korean. The KR
# maps already emit Korean sector labels (see market_map._SECTOR_KEYWORDS), so this is
# what puts all three boards' 업종 grouping into one language.
#
# These are the standard Korean renderings of the GICS sectors, not a remapping onto
# the KR maps' buckets. Forcing NASDAQ into 반도체/전자 and 유통/소비재 would be lossy
# in both directions — GICS splits consumer into 임의/필수 where the KRX bucket doesn't,
# and files semiconductors under 정보기술 alongside software — so the US board keeps
# the classification its own index actually uses. 금융 and 기타 coincide with the KR
# labels because they genuinely mean the same thing.
_US_SECTOR_KO = {
    "Information Technology": "정보기술",
    "Technology": "정보기술",
    "Communication Services": "커뮤니케이션",
    "Consumer Discretionary": "임의소비재",
    "Consumer Staples": "필수소비재",
    "Health Care": "헬스케어",
    "Healthcare": "헬스케어",
    "Financials": "금융",
    "Industrials": "산업재",
    "Energy": "에너지",
    "Utilities": "유틸리티",
    "Materials": "소재",
    "Real Estate": "부동산",
    "Other": "기타",
}


def _week52_position(close: float, low: float | None, high: float | None) -> float | None:
    """Where `close` sits inside its 52-week range, 0 (at the low) to 1 (at the high).

    None when the range is unusable — no data, or a high and low that coincide, which
    would otherwise divide by zero. Clamped because the live price can print outside a
    range whose bars were fetched minutes earlier, and a marker sitting off the end of
    its own track reads as a bug rather than as a new high.
    """
    if low is None or high is None or high <= low:
        return None
    return round(min(max((close - low) / (high - low), 0.0), 1.0), 4)


def _apply_spark(item: dict, series: SparkSeries | None) -> dict:
    """Merges one symbol's history summary into its roster row.

    The last sparkline point is overwritten with the live close rather than left as
    the last fetched bar. During a session those are the same bar — the daily feed's
    final row *is* today, still printing — so this keeps the line's endpoint moving
    with the price instead of freezing at whatever it was when the 15-minute history
    cache last refreshed. Outside a session the live quote is that session's close (or
    its NXT print), which is also what the last bar holds. Either way the reader gets
    the one guarantee that matters: where the line ends is the number written above it.
    """
    if series is None or not series.points:
        return {**item, "points": [], "week52_high": None, "week52_low": None, "week52_pos": None, "returns": {}}

    points = list(series.points)
    close = item.get("close") or 0
    if close > 0:
        points[-1] = round(float(close), 4)

    return {
        **item,
        "points": points,
        "week52_high": series.week52_high,
        "week52_low": series.week52_low,
        "week52_pos": _week52_position(close, series.week52_low, series.week52_high),
        "returns": series.returns,
    }


def _sector_summaries(items: list[dict]) -> list[dict]:
    """One row per 업종, ordered by combined size — the order the page stacks its
    groups in, so the sectors carrying the market's weight are the ones read first.

    The average change is cap-weighted, not a plain mean of the members' percentages:
    a sector whose one trillion-won name is down 3% while four small caps are up 1%
    did not have a good day, and a plain mean would say it did. This is the same
    weighting the market map's sector zones use.
    """
    buckets: dict[str, dict] = {}
    for item in items:
        bucket = buckets.setdefault(
            item["sector"],
            {"sector": item["sector"], "count": 0, "marcap": 0.0, "up": 0, "flat": 0, "down": 0, "_weighted": 0.0},
        )
        weight = max(item.get("marcap") or 0.0, 0.0)
        change = item.get("change_pct") or 0.0
        bucket["count"] += 1
        bucket["marcap"] += weight
        bucket["_weighted"] += change * weight
        if change > FLAT_BAND_PCT:
            bucket["up"] += 1
        elif change < -FLAT_BAND_PCT:
            bucket["down"] += 1
        else:
            bucket["flat"] += 1

    summaries = []
    for bucket in buckets.values():
        weighted = bucket.pop("_weighted")
        bucket["avg_change_pct"] = round(weighted / bucket["marcap"], 2) if bucket["marcap"] > 0 else 0.0
        summaries.append(bucket)

    summaries.sort(key=lambda b: b["marcap"], reverse=True)
    return summaries


def _breadth(items: list[dict]) -> dict:
    """The board's own one-line verdict: how many names rose, fell and held, and the
    cap-weighted average move across all of them — i.e. what the 100 stocks did as a
    single portfolio, which is the honest way to summarize an index-shaped list."""
    up = sum(1 for it in items if (it.get("change_pct") or 0) > FLAT_BAND_PCT)
    down = sum(1 for it in items if (it.get("change_pct") or 0) < -FLAT_BAND_PCT)
    total_cap = sum(max(it.get("marcap") or 0.0, 0.0) for it in items)
    weighted = sum((it.get("change_pct") or 0.0) * max(it.get("marcap") or 0.0, 0.0) for it in items)
    return {
        "up": up,
        "down": down,
        "flat": len(items) - up - down,
        "avg_change_pct": round(weighted / total_cap, 2) if total_cap > 0 else 0.0,
    }


def _kr_roster(market: str, limit: int, fresh: bool) -> list[dict]:
    ranked = get_kospi_map(limit, fresh=fresh) if market == "kospi" else get_kosdaq_map(limit, fresh=fresh)
    return [
        {
            "rank": rank,
            "code": it["code"],
            "name": it["name"],
            "sector": it["sector"],
            "close": it["close"],
            "change": it["change"],
            "change_pct": it["change_pct"],
            "marcap": it["marcap"],
            "volume": it.get("volume"),
            "per": it.get("per"),
            "roe": it.get("roe"),
            "foreign_ratio": it.get("foreign_ratio"),
        }
        for rank, it in enumerate(ranked[:limit], start=1)
    ]


def _nasdaq_roster(limit: int, fresh: bool) -> list[dict]:
    # slickcharts already returns the Nasdaq-100 ordered by index weight, but sort
    # explicitly anyway — `rank` is written from this order and shown on every card, so
    # it must not depend on an upstream's ordering staying what it is today.
    ranked = sorted(get_nasdaq100_map(103, fresh=fresh), key=lambda it: it["marcap"], reverse=True)[:limit]
    korean = get_korean_names_ready()
    return [
        {
            "rank": rank,
            "code": it["code"],
            "name": it["name"],
            # The Korean rendering of the company name, already translated and cached
            # for search (see us_universe). Null when it isn't in that map yet, which
            # the frontend renders as the English name rather than as a gap.
            "name_ko": korean.get(it["name"]),
            "sector": _US_SECTOR_KO.get(it["sector"], "기타"),
            "close": it["close"],
            "change": it["change"],
            "change_pct": it["change_pct"],
            # For the US board this is the constituent's index weight (%), not an
            # absolute cap — see `marcap_kind` on the response, and the same note in
            # us_market_map. It is still the right thing to weight sector averages by.
            "marcap": it["marcap"],
        }
        for rank, it in enumerate(ranked, start=1)
    ]


def _spark_dates(series: dict[str, SparkSeries]) -> list[str]:
    """The sparkline window's session dates, sent once for the whole board rather than
    repeated on all 100 cards — 60 date strings against 6,000.

    Taken from the longest series present. Every name on these boards is a top-100
    large cap that trades every session its market is open, so they share one calendar;
    a card aligns the array to its own points from the *end*, which stays correct even
    for a series that happens to be shorter (a recent listing) and only misaligns for a
    stock that was halted mid-window — a case the card's own price and change are
    unaffected by.
    """
    longest = max(series.values(), key=lambda s: len(s.dates), default=None)
    return longest.dates if longest else []


def _sparklines(market: str, codes: list[str]) -> dict[str, SparkSeries]:
    fetch = get_us_sparklines if market == "nasdaq" else get_kr_sparklines
    # Keyed by market alone rather than by the roster: ranks shuffle constantly and a
    # code-list key would miss its cache every time the 100th name changed, turning a
    # warm board into a fresh 100-symbol fetch for no benefit.
    return cache.get_or_set(f"board_spark:{market}", TTL_SPARK_SECONDS, lambda: fetch(codes))


def get_board(market: str, limit: int = BOARD_LIMIT, fresh: bool = False) -> dict:
    """The full card board for one market. `market` must be one of MARKETS."""
    if market == "nasdaq":
        items = _nasdaq_roster(limit, fresh)
        marcap_kind = "weight"
        currency = "USD"
    else:
        items = _kr_roster(market, limit, fresh)
        marcap_kind = "krw"
        currency = "KRW"

    series = _sparklines(market, [it["code"] for it in items])
    items = [_apply_spark(it, series.get(it["code"])) for it in items]

    return {
        "market": market,
        "label": _LABELS[market],
        "currency": currency,
        "marcap_kind": marcap_kind,
        "generated_at": dt.datetime.now(KST).isoformat(timespec="seconds"),
        "spark_dates": _spark_dates(series),
        "count": len(items),
        "breadth": _breadth(items),
        "sectors": _sector_summaries(items),
        "items": items,
    }


def warm_boards() -> None:
    """Primes each market's history cache at boot, the way the map snapshots are —
    without it the first visitor after a deploy pays for 100 symbol fetches inline."""
    for market in MARKETS:
        try:
            get_board(market)
        except Exception:  # noqa: BLE001 - a cold-start warm is best-effort by nature
            pass
