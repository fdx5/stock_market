"""The fixed roster the AI 종목예측 batch scores every trading day.

Three market-cap top-10s plus four semiconductor names carried explicitly (AMD,
Intel, Micron, SanDisk) — the extras are the whole point of hardcoding them: none
are reliably inside the Nasdaq-100's top 10 by weight, but they are the names a
KOSPI/KOSDAQ audience actually watches, because Samsung Electronics and SK Hynix
trade off their read-through.
"""

import re

import FinanceDataReader as fdr
import pandas as pd

from app.data.us_index_fetcher import get_nasdaq100_constituents
from app.services.cache import cache

TTL_ROSTER_SECONDS = 12 * 3600

TOP_N = 10

MARKET_KOSPI = "KOSPI"
MARKET_KOSDAQ = "KOSDAQ"
MARKET_NASDAQ = "NASDAQ"

# The Korean market batch covers these two; the US batch covers NASDAQ alone. Keeping
# the grouping here (rather than inlining the pair at every call site) is what lets
# prediction_batch treat "which markets does this run own" as a single value.
KR_MARKETS = (MARKET_KOSPI, MARKET_KOSDAQ)
US_MARKETS = (MARKET_NASDAQ,)

# Added on top of the Nasdaq-100 top 10 by weight. AMD/INTC/MU sit well outside that
# top 10 and SNDK isn't an index member at all (SanDisk re-listed as a standalone
# Nasdaq issue after splitting from Western Digital in Feb 2025), so none would
# survive a pure market-cap cut — they're here by explicit request.
US_EXTRA_TICKERS = ("AMD", "INTC", "MU", "SNDK")

# The page renders Korean names, and the US roster is small and stable enough that a
# literal map beats routing 14 names through the Google Translate endpoint on every
# batch run — that path is best-effort, and a batch that silently falls back to
# English names on a bad day would look broken next to the KRX rows.
US_KOREAN_NAMES = {
    "SPCX": "스페이스X",
    "AAPL": "애플",
    "MSFT": "마이크로소프트",
    "NVDA": "엔비디아",
    "AMZN": "아마존",
    "GOOGL": "알파벳 A",
    "GOOG": "알파벳 C",
    "META": "메타 플랫폼스",
    "AVGO": "브로드컴",
    "TSLA": "테슬라",
    "NFLX": "넷플릭스",
    "COST": "코스트코",
    "PLTR": "팔란티어",
    "CSCO": "시스코",
    "TMUS": "티모바일",
    "AMD": "AMD",
    "INTC": "인텔",
    "MU": "마이크론 테크놀로지",
    "SNDK": "샌디스크",
}


def _is_common_stock(code: str) -> bool:
    """Filters KRX preferred shares out of the market-cap ranking.

    Without this, 삼성전자우 lands in the KOSPI top 10 directly behind 삼성전자 and
    burns a slot on a second line for a company already covered — a "시총 TOP 10" that
    is really eight companies. KRX issues common stock on codes ending in 0 and
    preferred/derived classes on 5, 7, K, L, M and similar, so the last character is
    the standard discriminator.
    """
    return bool(code) and code[-1] == "0"


def _load_krx_top(market: str) -> list[dict]:
    df = fdr.StockListing(market)
    code_col = "Code" if "Code" in df.columns else "Symbol"
    df = df.rename(columns={code_col: "Code"})
    df = df[["Code", "Name", "Marcap"]].dropna()
    df = df[df["Code"].astype(str).map(_is_common_stock)]
    df = df.sort_values("Marcap", ascending=False).head(TOP_N)
    return [
        {
            "code": str(row["Code"]),
            "name": str(row["Name"]),
            "market": market,
            "market_cap": float(row["Marcap"]),
        }
        for _, row in df.iterrows()
    ]


# Strips the share-class tail slickcharts appends ("Alphabet Inc. Class A" /
# "... Class C", "Space Exploration Technologies Corp. Class A Common Stock") so two
# listings of one company collapse to the same key.
_SHARE_CLASS_RE = re.compile(r"\s+class\s+[a-z]\b.*$", re.IGNORECASE)


def _company_key(name: str) -> str:
    return _SHARE_CLASS_RE.sub("", name or "").strip().rstrip(".,").lower()


def _load_nasdaq_roster() -> list[dict]:
    """Nasdaq-100's ten heaviest members plus the four explicit extras, deduped.

    `marcap` on a slickcharts constituent is index weight, not an absolute market
    cap — it's a cap-share proxy, which is all the ordering needs (see
    us_index_fetcher._fetch_slickcharts). The extras are appended after the cut so an
    extra that *is* already in the top 10 (AMD has drifted in and out) doesn't push a
    genuine top-10 name off the list or appear twice.
    """
    constituents = get_nasdaq100_constituents()
    by_weight = sorted(constituents, key=lambda it: it.get("marcap") or 0, reverse=True)

    # The Nasdaq-100 lists Alphabet's two share classes as separate members (as the
    # real index does), so a naive top-10 spends two slots on one company. Ranking by
    # market cap means ranking companies, so the classes collapse to whichever is
    # heavier and the freed slot goes to the next real name.
    deduped: list[dict] = []
    seen_companies: set[str] = set()
    for item in by_weight:
        key = _company_key(item["name"])
        if key in seen_companies:
            continue
        seen_companies.add(key)
        deduped.append(item)

    roster: list[dict] = []
    seen: set[str] = set()
    for item in deduped[:TOP_N]:
        seen.add(item["code"])
        roster.append(
            {
                "code": item["code"],
                "name": US_KOREAN_NAMES.get(item["code"], item["name"]),
                "english_name": item["name"],
                "market": MARKET_NASDAQ,
                "market_cap": float(item.get("marcap") or 0),
                "sector": item.get("sector", "Other"),
            }
        )

    by_code = {item["code"]: item for item in constituents}
    for ticker in US_EXTRA_TICKERS:
        if ticker in seen:
            continue
        seen.add(ticker)
        known = by_code.get(ticker, {})
        english = known.get("name") or ticker
        roster.append(
            {
                "code": ticker,
                "name": US_KOREAN_NAMES.get(ticker, english),
                "english_name": english,
                "market": MARKET_NASDAQ,
                "market_cap": float(known.get("marcap") or 0),
                "sector": known.get("sector", "Other"),
            }
        )
    return roster


def get_kospi_roster() -> list[dict]:
    return cache.get_or_set(
        "prediction_roster:kospi", TTL_ROSTER_SECONDS, lambda: _load_krx_top(MARKET_KOSPI)
    )


def get_kosdaq_roster() -> list[dict]:
    return cache.get_or_set(
        "prediction_roster:kosdaq", TTL_ROSTER_SECONDS, lambda: _load_krx_top(MARKET_KOSDAQ)
    )


def get_nasdaq_roster() -> list[dict]:
    return cache.get_or_set("prediction_roster:nasdaq", TTL_ROSTER_SECONDS, _load_nasdaq_roster)


def get_roster(markets: tuple[str, ...]) -> list[dict]:
    """Flattened roster for the given markets, in the order the page groups them."""
    loaders = {
        MARKET_KOSPI: get_kospi_roster,
        MARKET_KOSDAQ: get_kosdaq_roster,
        MARKET_NASDAQ: get_nasdaq_roster,
    }
    roster: list[dict] = []
    for market in markets:
        loader = loaders.get(market)
        if loader is None:
            continue
        roster.extend(loader())
    return roster


def is_korean_market(market: str) -> bool:
    return market in KR_MARKETS


# KRX 호가 가격 단위, as unified across 유가증권/코스닥 by the 2023-01-25 tick-size reform:
# (upper bound exclusive, tick). Above the last bound the tick is KRX_TOP_TICK.
#
# A predicted price has to be a price the market can actually print. Without this the
# page quotes 삼성전자 at 245,234원 — a number no order book will ever show, since that
# name trades in 500원 steps — and the forecast reads as false precision rather than as
# a level someone could put an order at.
KRX_TICK_TABLE = (
    (2_000, 1),
    (5_000, 5),
    (20_000, 10),
    (50_000, 50),
    (200_000, 100),
    (500_000, 500),
)
KRX_TOP_TICK = 1_000

# The minimum increment for a US equity quoted at or above $1 (SEC Rule 612). Sub-dollar
# names can quote in $0.0001, but nothing on this roster trades anywhere near that.
US_TICK = 0.01


def krx_tick_size(price: float) -> int:
    """The 호가 단위 that applies at `price`."""
    for ceiling, tick in KRX_TICK_TABLE:
        if price < ceiling:
            return tick
    return KRX_TOP_TICK


def snap_to_tick(price: float, market: str) -> float:
    """Rounds a computed price to the nearest tick its market would actually quote.

    The tier is read off the snapped-to price band it falls in, which is how the
    exchange itself decides. Rounding up across a tier boundary is safe: every bound in
    the table is an exact multiple of the wider tick above it (200,000 is a multiple of
    500, 500,000 of 1,000, and so on), so a price pushed onto a boundary is still a
    valid quote in the higher tier rather than landing between two ticks.
    """
    if price <= 0:
        return round(price, 2)
    if not is_korean_market(market):
        return round(round(price / US_TICK) * US_TICK, 2)
    tick = krx_tick_size(price)
    return float(round(price / tick) * tick)
