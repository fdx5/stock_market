import io

import FinanceDataReader as fdr
import pandas as pd
import requests

from app.data.global_marketcap_fetcher import HEADERS, get_live_quotes_bulk
from app.services.cache import cache

SLICKCHARTS_URLS = {
    "sp500": "https://www.slickcharts.com/sp500",
    "nasdaq100": "https://www.slickcharts.com/nasdaq100",
}

# One request returns every constituent (weight/price/change included), unlike the
# KRX maps which need a paginated Naver scrape plus a separate bulk quote call — so a
# single short TTL is enough to keep this feeling live without hammering slickcharts.
TTL_CONSTITUENTS_SECONDS = 15
TTL_SECTOR_SECONDS = 24 * 3600


def _parse_pct(text: object) -> float:
    try:
        return float(str(text).replace("%", "").replace(",", "").strip())
    except (ValueError, TypeError):
        return 0.0


def _parse_float(text: object) -> float:
    try:
        return float(str(text).replace(",", "").strip())
    except (ValueError, TypeError):
        return 0.0


def _fetch_slickcharts(index: str) -> list[dict]:
    """Scrapes slickcharts.com's index-weight table for every constituent's ticker,
    full name, index weight, and a delayed price/change snapshot in one request.
    Index weight is a reliable market-cap-share proxy for treemap sizing (it's
    exactly what a cap-weighted index computes), so this avoids the alternative of
    firing one Yahoo Finance request per constituent (500+ for the S&P) on every
    refresh."""
    url = SLICKCHARTS_URLS[index]
    resp = requests.get(url, headers=HEADERS, timeout=8)
    resp.raise_for_status()
    table = pd.read_html(io.StringIO(resp.text))[0]

    items: list[dict] = []
    seen_codes: set[str] = set()
    for _, row in table.iterrows():
        code = str(row["Symbol"]).strip()
        name = str(row["Company"]).strip()
        # Nasdaq-100's table lists Alphabet's two share classes (GOOGL/GOOG) as
        # separate rows, same as the real index — kept as-is. A genuinely duplicate
        # row (rare table-parsing artifact) would double-count that name's weight.
        if not code or not name or code in seen_codes:
            continue
        seen_codes.add(code)
        items.append(
            {
                "code": code,
                "name": name,
                "marcap": _parse_pct(row["Weight"]),
                "close": _parse_float(row["Price"]),
                "change": _parse_float(row["Chg"]),
                "change_pct": _parse_pct(row["% Chg"]),
            }
        )
    return items


def _load_sp500_sectors() -> dict[str, str]:
    df = fdr.StockListing("S&P500")[["Symbol", "Sector"]]
    return dict(zip(df["Symbol"].astype(str), df["Sector"]))


def _get_sp500_sectors() -> dict[str, str]:
    return cache.get_or_set("sp500_sectors", TTL_SECTOR_SECONDS, _load_sp500_sectors)


def _with_sector(items: list[dict]) -> list[dict]:
    # The S&P 500's GICS sector map also covers the large majority of Nasdaq-100
    # names (heavy overlap between the two indices) — names it doesn't cover (e.g. a
    # recent IPO, a non-S&P Nasdaq-100 member) fall back to "Other" rather than
    # attempting a second, less reliable classification source.
    sectors = _get_sp500_sectors()
    return [{**it, "sector": sectors.get(it["code"], "Other")} for it in items]


def get_sp500_constituents(fresh: bool = False) -> list[dict]:
    return cache.get_or_set(
        "slickcharts:sp500",
        TTL_CONSTITUENTS_SECONDS,
        lambda: _with_sector(_fetch_slickcharts("sp500")),
        allow_stale=not fresh,
    )


def get_nasdaq100_constituents(fresh: bool = False) -> list[dict]:
    return cache.get_or_set(
        "slickcharts:nasdaq100",
        TTL_CONSTITUENTS_SECONDS,
        lambda: _with_sector(_fetch_slickcharts("nasdaq100")),
        allow_stale=not fresh,
    )


def get_us_stock_quote(code: str, name: str, snapshot: dict | None = None) -> dict:
    """Live-ish quote for one US ticker's detail page, reusing the same Yahoo Finance
    chart endpoint the global top-20 board overlays onto companiesmarketcap's
    snapshot (see global_marketcap_fetcher.get_live_quotes_bulk). Falls back to the
    slickcharts constituent snapshot (`snapshot`, already carrying a delayed
    close/change/change_pct — see _fetch_slickcharts) whenever Yahoo's request fails,
    so the detail page always has a price to show rather than a hard error."""
    live = get_live_quotes_bulk([code]).get(code)
    if live and live["previous_close"]:
        change = live["price"] - live["previous_close"]
        change_pct = (live["price"] / live["previous_close"] - 1) * 100
        return {"code": code, "name": name, "close": live["price"], "change": change, "change_pct": change_pct}

    if snapshot:
        return {
            "code": code,
            "name": name,
            "close": snapshot["close"],
            "change": snapshot["change"],
            "change_pct": snapshot["change_pct"],
        }

    return {"code": code, "name": name, "close": 0.0, "change": 0.0, "change_pct": 0.0}
