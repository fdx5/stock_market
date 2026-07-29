import io

import FinanceDataReader as fdr
import pandas as pd
import requests

from app.data import yahoo_bulk_quote
from app.data.global_marketcap_fetcher import HEADERS, get_live_quotes_bulk
from app.services.cache import cache

SLICKCHARTS_URLS = {
    "sp500": "https://www.slickcharts.com/sp500",
    "nasdaq100": "https://www.slickcharts.com/nasdaq100",
}

# One request returns every constituent, with weights and a delayed regular-hours
# price/change — unlike the KRX maps, which need a paginated Naver scrape just for the
# roster. The prices here are only a fallback now (see _constituents); the roster itself
# is what this key exists for, and a short TTL keeps a mid-session index change from
# taking minutes to appear.
TTL_CONSTITUENTS_SECONDS = 15
# The extended-hours overlay rides its own key on the same cadence: three Yahoo requests
# for the S&P, one for the Nasdaq-100. Separate from the roster above because the two
# have nothing to do with each other — the roster's composition and weights change a few
# times a year, the prices change all evening.
TTL_QUOTES_SECONDS = 15
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


# The S&P 500 sector map covers most of the Nasdaq-100 but structurally cannot cover
# the members that aren't in the S&P at all — foreign issuers (ASML, ARM, Shopify,
# PDD, MELI, Ferrovial, Coca-Cola Europacific, Thomson Reuters), which are ineligible
# for the S&P 500 by domicile rather than by size, plus recent listings that haven't
# been added yet. That was ~15 of 100 names all landing in "Other", which is fine for
# a treemap's leftover zone but not for a page that groups *by* sector. These are
# hand-assigned to the GICS sector each company's own listing reports, using the same
# sector strings the map above emits so nothing downstream has to special-case them.
# A member not listed here still falls back to "Other" — this is a patch over a known
# gap, not a second classification source.
_NON_SP500_SECTORS = {
    "ASML": "Information Technology",
    "ARM": "Information Technology",
    "SHOP": "Information Technology",
    "ALAB": "Information Technology",
    "NBIS": "Information Technology",
    "CRWV": "Information Technology",
    "MSTR": "Information Technology",
    "PDD": "Consumer Discretionary",
    "MELI": "Consumer Discretionary",
    "CCEP": "Consumer Staples",
    "TRI": "Industrials",
    "FER": "Industrials",
    "RKLB": "Industrials",
    "SPCX": "Industrials",
    "ALNY": "Health Care",
}


def _with_sector(items: list[dict]) -> list[dict]:
    # The S&P 500's GICS sector map also covers the large majority of Nasdaq-100
    # names (heavy overlap between the two indices); the rest are picked up by the
    # hand-assigned table above, and anything in neither falls back to "Other" rather
    # than attempting a second, less reliable classification source.
    sectors = _get_sp500_sectors()
    return [
        {**it, "sector": sectors.get(it["code"]) or _NON_SP500_SECTORS.get(it["code"], "Other")}
        for it in items
    ]


# What a constituent row carries when its live quote is missing — the slickcharts
# figures are scraped from a regular-hours table, so they are a regular-session quote by
# construction and must never be labelled pre/post.
_REGULAR_ONLY = {"session": "regular", "regular_change_pct": None, "extended_change_pct": None}


def _merge_quote(item: dict, quote: dict | None) -> dict:
    """Overlays one live quote onto its slickcharts row.

    `close`/`change`/`change_pct` are replaced outright rather than added alongside: the
    map tile, the board card and the sector average all read those three fields, and two
    competing versions of "the price" is exactly how the same stock ends up disagreeing
    with itself on two pages of this site.
    """
    if quote is None:
        return {**item, **_REGULAR_ONLY, "regular_close": item["close"]}
    return {**item, **quote}


def _constituents(index: str, fresh: bool) -> list[dict]:
    """The index's roster with an extended-hours price overlaid on every name.

    Slickcharts' table is a regular-hours snapshot: at 16:00 ET it stops moving, and
    without this overlay every US surface on the site stayed at that close for the whole
    Korean evening — the hours when a Seoul visitor is most likely to be looking, and
    when earnings actually land. See yahoo_bulk_quote for why the overlay is one batched
    request per 200 names rather than one per constituent.
    """
    roster = cache.get_or_set(
        f"slickcharts:{index}",
        TTL_CONSTITUENTS_SECONDS,
        lambda: _with_sector(_fetch_slickcharts(index)),
        allow_stale=not fresh,
    )
    quotes = cache.get_or_set(
        f"us_quotes:{index}",
        TTL_QUOTES_SECONDS,
        lambda: yahoo_bulk_quote.get_quotes([it["code"] for it in roster]),
        allow_stale=not fresh,
    )
    return [_merge_quote(it, quotes.get(it["code"])) for it in roster]


def get_sp500_constituents(fresh: bool = False) -> list[dict]:
    return _constituents("sp500", fresh)


def get_nasdaq100_constituents(fresh: bool = False) -> list[dict]:
    return _constituents("nasdaq100", fresh)


def market_session(items: list[dict]) -> str:
    """Which US session a whole list of names is quoting from — what a page badges its
    header with.

    The majority wins rather than "any name is in it": a handful of rows can lag a
    session boundary (a thin name with no pre-market print yet still reports its
    previous post-market one), and a page header that flips to 프리장 because three of
    503 stocks did is wrong more often than it is early.
    """
    if not items:
        return "regular"
    counts: dict[str, int] = {}
    for item in items:
        session = item.get("session") or "regular"
        counts[session] = counts.get(session, 0) + 1
    return max(counts.items(), key=lambda kv: kv[1])[0]


def get_us_stock_quote(code: str, name: str, snapshot: dict | None = None) -> dict:
    """Live-ish quote for one US ticker's detail page — the page a visitor lands on when
    they search a foreign name from the dashboard.

    Three sources, tried in order, all of them producing the same shape so the page never
    has to know which one answered:

    1. the batched v7 quote endpoint the maps and boards run on, so a stock's detail page
       and its tile on /sp500-map can't quote different numbers;
    2. the v8 chart endpoint (`get_live_quotes_bulk`), which needs no crumb and so still
       answers if the handshake in (1) is being refused. It is also extended-hours aware,
       just without the regular/extended split;
    3. the caller's cached constituent row — up to a day old (us_universe holds that
       snapshot for 24h), so it is a last resort, not a live quote.

    Only the first two can report an extended session. (3) is reported as regular
    whatever it happens to hold: its own session label would be as stale as its price,
    and a day-old "애프터장" badge is a worse lie than no badge.
    """
    quote = yahoo_bulk_quote.get_quotes([code]).get(code)
    if quote:
        return {"code": code, "name": name, **quote}

    live = get_live_quotes_bulk([code]).get(code)
    if live and live["previous_close"]:
        price, regular_close = live["price"], live["regular_close"]
        session = live["session"]
        return {
            "code": code,
            "name": name,
            "close": price,
            "change": price - live["previous_close"],
            "change_pct": (price / live["previous_close"] - 1) * 100,
            "session": session,
            "regular_close": regular_close,
            # Pre-market has no regular session of its own yet to report — see the same
            # distinction in yahoo_bulk_quote._read.
            "regular_change_pct": (
                None
                if session == "pre" or not live["previous_close"]
                else (regular_close / live["previous_close"] - 1) * 100
            ),
            "extended_change_pct": (
                None if session == "regular" or not regular_close else (price / regular_close - 1) * 100
            ),
        }

    if snapshot:
        return {
            "code": code,
            "name": name,
            "close": snapshot["close"],
            "change": snapshot["change"],
            "change_pct": snapshot["change_pct"],
            "regular_close": snapshot["close"],
            **_REGULAR_ONLY,
        }

    return {
        "code": code,
        "name": name,
        "close": 0.0,
        "change": 0.0,
        "change_pct": 0.0,
        "regular_close": 0.0,
        **_REGULAR_ONLY,
    }
