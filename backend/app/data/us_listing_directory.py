"""Every US-listed stock and ETF, from Nasdaq Trader's public symbol directory.

The curated US universe (S&P 500 + Nasdaq-100 + a hand-kept recent-listings list) is
what the maps, translations and rankings are built on, and it is deliberately small.
Search can't stop there: a visitor typing IONQ, or a leveraged single-stock ETF such
as IONX/IONL, got nothing back, because none of them is an index constituent or in
the curated ETF table.

Nasdaq Trader publishes the full list of securities on NASDAQ, NYSE, NYSE American,
NYSE Arca and Cboe as two pipe-delimited files, refreshed daily, with an ETF flag.
That is the authoritative source the exchanges themselves use, so it is what search
and the detail-page lookup fall back to here — memory only, refreshed once a day.
"""

import logging
import re
import time

import requests

from app.services.cache import cache

logger = logging.getLogger(__name__)

SOURCES = (
    # (url, symbol column, etf column, test-issue column)
    ("https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt", "Symbol", "ETF", "Test Issue"),
    ("https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt", "ACT Symbol", "ETF", "Test Issue"),
)
TTL_SECONDS = 24 * 3600
_TIMEOUT = (5, 20)
# After a failed fetch, search must not wait on the directory again on every keystroke.
RETRY_AFTER_SECONDS = 600
_failed_at: float | None = None

# Warrants, rights and units are listed separately from the shares they belong to and
# only crowd search results; preferred series carry a '$' in the symbol.
_SKIP_NAME = re.compile(r"\b(warrants?|rights?|units?)\b", re.IGNORECASE)
_NAME_SUFFIX = re.compile(
    r"\s*-?\s*(Class [A-Z] )?(Common Stock|Ordinary Shares?|Common Shares?|Depositary Shares?)\b.*$",
    re.IGNORECASE,
)


def _clean_name(name: str) -> str:
    cleaned = _NAME_SUFFIX.sub("", name).strip(" -,")
    return cleaned or name.strip()


def parse(text: str, symbol_col: str, etf_col: str, test_col: str) -> list[dict]:
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return []
    header = lines[0].split("|")
    try:
        i_sym, i_name, i_etf, i_test = (
            header.index(symbol_col),
            header.index("Security Name"),
            header.index(etf_col),
            header.index(test_col),
        )
    except ValueError:
        return []
    rows = []
    for line in lines[1:]:
        cols = line.split("|")
        if len(cols) < len(header) or line.startswith("File Creation Time"):
            continue
        symbol, name = cols[i_sym].strip(), cols[i_name].strip()
        if not symbol or not name or cols[i_test].strip() == "Y" or "$" in symbol:
            continue
        etf = cols[i_etf].strip() == "Y"
        if not etf and _SKIP_NAME.search(name):
            continue
        rows.append(
            {
                # Yahoo (every quote source here) writes share classes with '-': BRK-B.
                "code": symbol.replace(".", "-").upper(),
                "name": name if etf else _clean_name(name),
                "etf": etf,
            }
        )
    return rows


def _load() -> list[dict]:
    seen: dict[str, dict] = {}
    for url, sym, etf, test in SOURCES:
        response = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=_TIMEOUT)
        response.raise_for_status()
        for row in parse(response.text, sym, etf, test):
            seen.setdefault(row["code"], row)
    if len(seen) < 1000:
        raise ValueError(f"US listing directory looks truncated ({len(seen)} rows)")
    return list(seen.values())


def get_listings() -> list[dict]:
    """All listings, or [] when the directory can't be fetched (search then simply
    falls back to the curated universe, exactly as before)."""
    global _failed_at
    cached = cache.peek("us_listing_directory", max_stale_seconds=7 * 24 * 3600)
    if _failed_at is not None and time.monotonic() - _failed_at < RETRY_AFTER_SECONDS:
        return cached or []
    try:
        rows = cache.get_or_set("us_listing_directory", TTL_SECONDS, _load)
        _failed_at = None
        return rows
    except Exception as exc:  # noqa: BLE001 - a directory outage must not break search
        _failed_at = time.monotonic()
        logger.warning("us_listing_directory: fetch failed (%s)", exc)
        return cached or []


def _index() -> dict[str, dict]:
    listings = get_listings()
    if not listings:
        return {}
    return cache.get_or_set(
        "us_listing_directory_index", TTL_SECONDS, lambda: {row["code"]: row for row in listings}
    )


def lookup(code: str) -> dict | None:
    return _index().get(code.strip().upper())


def search(query: str, limit: int) -> list[dict]:
    """Ticker or name contains `query`; exact ticker first, then ticker prefix."""
    needle = query.strip().casefold()
    if not needle or limit <= 0:
        return []
    upper = needle.upper()
    hits = [row for row in get_listings() if needle in row["code"].casefold() or needle in row["name"].casefold()]
    hits.sort(key=lambda r: (r["code"] != upper, not r["code"].startswith(upper), len(r["code"]), r["code"]))
    return hits[:limit]
