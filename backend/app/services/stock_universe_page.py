"""One paged, cap-ranked roster shape for KOSPI, KOSDAQ and the S&P 500.

The 종목정보 page (/stocks) puts a list on the left and a detail panel on the right,
and the list is the same list three times over — 50 names by market capitalisation,
with a logo, a price and a move. The three markets it draws from do not agree on much
underneath: KOSPI and KOSDAQ come from Naver's cap ranking in won, the S&P 500 from a
US snapshot where `marcap` means index *weight* and the real capitalisation lives in
`market_cap`, in dollars, and only the US side has a Korean rendering of the name.

Normalising that here rather than in the page is the point of this module. The client
receives one row type with one meaning per field, so its list component has no
per-market branch in it, and a fourth market later is a MARKETS entry rather than a
third branch in a component.

Paging is a slice of an already-cached snapshot, not a new upstream query: the same
map calls the treemap pages use are memoised for their own TTL (see market_map and
us_market_map), so turning to page 7 costs a list slice and nothing on the wire.
"""

from __future__ import annotations

import datetime as dt
from typing import Callable

from app.data.us_company_korean_names import KOREAN_NAMES
from app.data.us_universe import get_korean_names_ready
from app.services import korean_search, logo_tone
from app.services.market_map import get_kosdaq_map, get_kospi_map
from app.services.stock_board import US_SECTOR_KO
from app.services.us_market_map import get_sp500_map

KST = dt.timezone(dt.timedelta(hours=9))

# Fixed by the page's design — the spec is "50개 마다 페이징". Sent on every response
# anyway so the client derives its page count from the server rather than repeating
# the constant.
PAGE_SIZE = 50


class MarketSpec:
    """How one tab's universe is loaded and what its numbers mean.

    `depth` is where each roster is cut off. It is a product decision, not a limit of
    the source: past a few hundred names by capitalisation the rows are companies
    nobody is scrolling a list to find, and every extra 100 KRX names is another
    upstream page fetch on a cold cache.
    """

    def __init__(
        self,
        key: str,
        label: str,
        currency: str,
        depth: int,
        loader: Callable[[int, bool], list[dict]],
        *,
        cap_field: str = "marcap",
    ) -> None:
        self.key = key
        self.label = label
        self.currency = currency
        self.depth = depth
        self.loader = loader
        # Which field on the upstream row is a real market capitalisation. On the US
        # snapshot `marcap` is the index weight in per cent, so reading it as a cap
        # would sort and label every US row wrongly.
        self.cap_field = cap_field


MARKETS: dict[str, MarketSpec] = {
    "kospi": MarketSpec("kospi", "KOSPI", "KRW", 500, lambda n, fresh: get_kospi_map(n, fresh=fresh)),
    "kosdaq": MarketSpec("kosdaq", "KOSDAQ", "KRW", 500, lambda n, fresh: get_kosdaq_map(n, fresh=fresh)),
    "sp500": MarketSpec(
        "sp500", "S&P 500", "USD", 500, lambda n, fresh: get_sp500_map(n, fresh=fresh), cap_field="market_cap"
    ),
}

MARKET_KEYS = tuple(MARKETS)


def _korean_name(code: str, name: str, translated: dict[str, str]) -> str | None:
    """The Korean rendering of a US company name, curated first, machine second.

    Same order and the same reason as us_company_korean_names.news_query: the machine
    translation returns its input unchanged when its upstream is unavailable, so an
    English string reaching the rail would look like a successful translation and
    displace a curated name that is actually right.
    """
    curated = KOREAN_NAMES.get(code.upper())
    if curated:
        return curated
    candidate = translated.get(name)
    if candidate and any("가" <= ch <= "힣" for ch in candidate):
        return candidate
    return None


def _sector(spec: MarketSpec, raw) -> str:
    name = str(raw or "").strip()
    if spec.currency != "USD":
        return name
    return US_SECTOR_KO.get(name, "기타") if name else ""


def _row(spec: MarketSpec, item: dict, rank: int, korean: dict[str, str]) -> dict:
    name = str(item.get("name") or "")
    code = str(item.get("code") or "")
    cap = item.get(spec.cap_field)
    return {
        "rank": rank,
        "code": code,
        "name": name,
        # US only, and null when neither source has a Korean name — the client renders
        # the English one in that case rather than a gap.
        "name_ko": _korean_name(code, name, korean) if spec.currency == "USD" else None,
        # The KR maps already label 업종 in Korean; the US snapshot uses GICS names in
        # English, which read as a different kind of data beside them and are too long
        # for the rail's column. Same map the NASDAQ board translates with, so a sector
        # is spelled one way across the whole site.
        "sector": _sector(spec, item.get("sector")),
        "close": item.get("close"),
        "change": item.get("change"),
        "change_pct": item.get("change_pct"),
        # Always a real capitalisation, in `currency` — never an index weight.
        "marcap": float(cap) if isinstance(cap, (int, float)) else None,
        "volume": item.get("volume"),
        "per": item.get("per"),
        "roe": item.get("roe"),
        # True when this company's mark is dark ink throughout and would disappear
        # against the dark theme — the client puts a light plate behind those and
        # leaves every other logo alone. See services/logo_tone.
        "logo_dark": logo_tone.known_dark(code),
    }


# The 업종 filter's "everything" option. A sentinel rather than an empty string so it
# cannot collide with a real sector label — the same reason and the same shape as
# MarketMapPage's ALL_SECTORS on the client.
ALL_SECTORS = "__all__"


def get_page(
    market: str,
    page: int = 1,
    size: int = PAGE_SIZE,
    sector: str | None = None,
    query: str | None = None,
    fresh: bool = False,
) -> dict:
    """One page of `market`'s cap ranking, optionally narrowed by 업종 and by name.

    Filtering happens here and not on the client because the client only ever holds 50
    rows: filtering those would search one page of a ten-page market and call it a
    market. The whole roster is filtered first, and the pages are cut from the result —
    so 업종 and the search box both change which rows appear *and* how many pages there
    are.

    `query` matches a name, its Korean rendering, or the code/ticker, and understands
    초성 — ㅅㅅㅈㅈ finds 삼성전자. See services/korean_search.

    Two things deliberately survive the filter:

    `rank` is the position in the whole market, assigned before filtering. A 반도체 view
    that renumbered 삼성전자 to 1 would be saying something false, and the detail panel
    prints the same number as "시총 N위".

    `sectors` is computed from the unfiltered roster, so the dropdown holds the same
    options with the same counts whichever one is currently chosen — a filter whose
    own control changes shape when used is one nobody can navigate back out of.

    `page` is clamped rather than rejected: the roster shrinks and grows between
    requests, and switching to a narrow 업종 while on page 8 should land on that
    sector's last page, not on an error.
    """
    spec = MARKETS[market]
    items = spec.loader(spec.depth, fresh)
    # The upstream maps are cap-ordered already, but rank is rendered on every row and
    # must not depend on that staying true — the same reason stock_board sorts its
    # NASDAQ roster explicitly.
    ranked = sorted(
        items,
        key=lambda it: (it.get(spec.cap_field) or 0),
        reverse=True,
    )[: spec.depth]

    korean = get_korean_names_ready() if spec.currency == "USD" else {}
    rows = [_row(spec, item, rank, korean) for rank, item in enumerate(ranked, start=1)]

    sectors = _sector_options(rows)
    active = sector if sector and sector != ALL_SECTORS else None
    if active:
        rows = [row for row in rows if row["sector"] == active]

    # After the sector, so the two compose: a search inside 반도체/전자 searches that
    # sector. `name_ko` is included because the S&P 500 rail shows it — a reader
    # looking at 엔비디아 must be able to search for what is on screen, not only for
    # "NVIDIA Corp".
    term = (query or "").strip()
    if term:
        rows = [
            row for row in rows
            if korean_search.matches_any(term, row["name"], row.get("name_ko"), row["code"])
        ]

    total = len(rows)
    total_pages = max(1, -(-total // size))
    page = max(1, min(page, total_pages))
    start = (page - 1) * size
    window = rows[start : start + size]

    # Only the rows actually being sent, and only behind the response: a code nobody
    # has scrolled to is not worth a logo download.
    logo_tone.warm([row["code"] for row in window])

    return {
        "market": spec.key,
        "label": spec.label,
        "currency": spec.currency,
        "sector": active or ALL_SECTORS,
        "sectors": sectors,
        "query": term,
        "page": page,
        "page_size": size,
        "total": total,
        "total_pages": total_pages,
        "generated_at": dt.datetime.now(KST).isoformat(timespec="seconds"),
        "items": window,
    }


def _sector_options(rows: list[dict]) -> list[dict]:
    """Every 업종 in the market, largest combined capitalisation first.

    Ordered by size rather than alphabetically because the list is read as "what this
    market is made of" — 반도체 belongs at the top of a KOSPI dropdown, not under ㅂ.
    """
    totals: dict[str, float] = {}
    counts: dict[str, int] = {}
    for row in rows:
        name = row["sector"]
        if not name:
            continue
        totals[name] = totals.get(name, 0.0) + (row["marcap"] or 0.0)
        counts[name] = counts.get(name, 0) + 1
    return [
        {"sector": name, "count": counts[name], "marcap": totals[name]}
        for name in sorted(totals, key=lambda n: totals[n], reverse=True)
    ]
