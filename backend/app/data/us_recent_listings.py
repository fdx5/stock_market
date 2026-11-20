"""US companies that are listed and trading but not yet in either index roster.

The US surfaces of this app (both maps, the sector cohort beside /global, search, the
detail page, the sitemap) are all built from the slickcharts S&P 500 / Nasdaq-100
scrapes. A brand-new mega-cap listing is in neither on its first day: Nasdaq-100 adds a
large IPO only after its fast-entry window, and the S&P 500 requires seasoning. Until
then it would be invisible everywhere on the site even though it trades on NASDAQ.

Rows here fill that gap. Each one is a real exchange listing (not a synthetic tile like
SKHY — see us_market_map), so unlike SKHY it also joins search and the NASDAQ board.
Every consumer skips a row whose ticker the scrape already carries, so once the index
adds the name the scraped constituent simply takes over; the row can then be removed
at leisure without anything breaking in between.
"""

from __future__ import annotations

RECENT_US_LISTINGS: tuple[dict, ...] = (
    {
        "code": "ANT",
        # Yahoo's longName is "Anthropic, PBC"; the short form is what the maps print.
        "name": "Anthropic",
        "name_ko": "앤트로픽",
        "sector": "Information Technology",
        "exchange": "NASDAQ",
        "listed_on": "2026-11-19",
        "ipo_price": 83.0,
        # Fallback only, for when Yahoo's marketCap is missing from a quote: the
        # $1.2716T Yahoo reported at the first close ($97.17) implies ~13.09bn shares.
        "shares_outstanding": 13_087_000_000,
    },
)

RECENT_US_LISTING_CODES: frozenset[str] = frozenset(row["code"] for row in RECENT_US_LISTINGS)


def recent_listing(code: str) -> dict | None:
    code = (code or "").strip().upper()
    return next((row for row in RECENT_US_LISTINGS if row["code"] == code), None)
