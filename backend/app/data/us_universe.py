import threading

from app.data import us_listing_directory
from app.data.us_company_korean_names import KOREAN_NAMES
from app.data.us_index_fetcher import get_nasdaq100_constituents, get_sp500_constituents
from app.data.us_recent_listings import RECENT_US_LISTINGS
from app.services.cache import cache
from app.services.translation import translate_batch_to_korean

TTL_UNIVERSE_SECONDS = 24 * 3600

KOREAN_NAMES_CACHE_KEY = "us_universe_korean_names"
TTL_KOREAN_NAMES_SECONDS = 24 * 3600

_korean_names_rebuild_lock = threading.Lock()
_korean_names_rebuilding = False


def _load_us_universe() -> list[dict]:
    # S&P500 and Nasdaq100 heavily overlap (most Nasdaq-100 members are also S&P500
    # members) — dedupe by code so a name only needs translating once and search
    # results don't show the same ticker twice. Keeps the full constituent row (not
    # just code/name) so get_us_stock_item can double as a delayed-quote fallback for
    # the detail page without a second fetch.
    seen: dict[str, dict] = {}
    for it in get_sp500_constituents() + get_nasdaq100_constituents():
        seen.setdefault(it["code"], it)
    # New listings that neither index carries yet (see us_recent_listings) — real NASDAQ
    # names, so they belong in search and on the detail page like any constituent.
    # The zero price is only the last-resort snapshot; the detail page quotes live.
    for row in RECENT_US_LISTINGS:
        seen.setdefault(
            row["code"],
            {
                "code": row["code"],
                "name": row["name"],
                "sector": row["sector"],
                "marcap": 0.0,
                "close": 0.0,
                "change": 0.0,
                "change_pct": 0.0,
            },
        )
    return list(seen.values())


def get_us_universe() -> list[dict]:
    return cache.get_or_set("us_universe", TTL_UNIVERSE_SECONDS, _load_us_universe)


# SKHY (SK Hynix's US ADR) isn't a real S&P500/Nasdaq100 constituent — see
# services/us_market_map.py, which adds it to both maps as a standing non-member
# tile — so it will never turn up in get_us_universe()'s scraped roster. But every
# map tile links to /global?code=<ticker>, and that page's quote/history/daily/
# indicators/comments endpoints (see routers/us_stock.py's _resolve_item) all
# resolve their code through this function, so without this the click just landed
# on a 404 "종목을 찾을 수 없습니다" page.
#
# Handled here specifically, as a fallback on a miss, rather than folded into
# get_us_universe() itself: that list also feeds search-as-you-type
# (search_us_stocks) and the Korean-name translation batch, and surfacing a
# non-constituent there was never asked for — this only has to make the one code
# the map can actually link to resolve. `close`/`change`/`change_pct` are a last-
# resort snapshot (see get_us_stock_quote's `snapshot` fallback) for the rare case
# every live quote source is down at once; in the ordinary case Yahoo answers for
# SKHY directly and these are never read.
_SKHY_ITEM = {"code": "SKHY", "name": "SK Hynix", "close": 0.0, "change": 0.0, "change_pct": 0.0}


def get_us_stock_item(code: str) -> dict | None:
    for item in get_us_universe():
        if item["code"] == code:
            return item
    if code == "SKHY":
        return _SKHY_ITEM
    # Any other US-listed stock or ETF (IONQ, IONX, ...): the detail page quotes it
    # live, so the zero snapshot is only the last-resort fallback.
    listed = us_listing_directory.lookup(code)
    if listed:
        return {"code": listed["code"], "name": listed["name"], "close": 0.0, "change": 0.0, "change_pct": 0.0}
    return None


def get_us_stock_name(code: str) -> str | None:
    item = get_us_stock_item(code)
    return item["name"] if item else None


def _load_korean_names() -> dict[str, str]:
    names = sorted({item["name"] for item in get_us_universe()})
    translations = translate_batch_to_korean(names)
    return dict(zip(names, translations))


def _rebuild_korean_names() -> None:
    global _korean_names_rebuilding
    try:
        cache.get_or_set(KOREAN_NAMES_CACHE_KEY, TTL_KOREAN_NAMES_SECONDS, _load_korean_names)
    finally:
        with _korean_names_rebuild_lock:
            _korean_names_rebuilding = False


def warm_us_korean_names() -> None:
    """Mirrors universe.warm_english_names' single-flight startup warm, applied to the
    reverse direction (US company names -> Korean) so "애플"-style search works without
    the first such search paying for (and duplicating) the translate batch."""
    global _korean_names_rebuilding
    with _korean_names_rebuild_lock:
        if _korean_names_rebuilding or cache.peek(KOREAN_NAMES_CACHE_KEY) is not None:
            return
        _korean_names_rebuilding = True
    _rebuild_korean_names()


def _get_korean_names_if_ready() -> dict[str, str] | None:
    """Non-blocking: mirrors universe._get_english_names_if_ready. Reads whatever's
    cached and, if nothing is, kicks off at most one background rebuild (single-flight
    via _korean_names_rebuilding) instead of blocking a live search on a multi-second
    translate batch."""
    cached = cache.peek(KOREAN_NAMES_CACHE_KEY)
    if cached is not None:
        return cached

    global _korean_names_rebuilding
    with _korean_names_rebuild_lock:
        if _korean_names_rebuilding:
            return None
        _korean_names_rebuilding = True

    threading.Thread(target=_rebuild_korean_names, daemon=True).start()
    return None


def get_korean_names_ready() -> dict[str, str]:
    """English company name -> Korean, for callers that want to *display* the Korean
    name rather than search by it. Empty while the translate batch is still warming,
    which reads as "show the English name" — the same non-blocking bargain search makes
    above, and the right one for a page render: a board of 100 cards must not wait on a
    multi-second translation to paint."""
    return _get_korean_names_if_ready() or {}


def search_us_stocks(query: str, limit: int = 30) -> list[dict]:
    query = query.strip()
    if not query:
        return []
    query_lower = query.lower()

    korean_names = _get_korean_names_if_ready()
    matched_english_names: set[str] = set()
    if korean_names:
        matched_english_names = {english for english, korean in korean_names.items() if query in korean}
    # The curated table is the reliable Korean source (the machine translation often
    # echoes its English input), so "앤트로픽" or "엔비디아" must find the ticker even
    # while the translate batch is cold or unhelpful.
    curated_codes = {code for code, korean in KOREAN_NAMES.items() if query in korean}

    matched = [
        item
        for item in get_us_universe()
        if query_lower in item["code"].lower()
        or query_lower in item["name"].lower()
        or item["name"] in matched_english_names
        or item["code"] in curated_codes
    ]
    # An exact ticker ("ANT") must beat every name that merely contains it (PLTR, PWR).
    # sorted() is stable, so the remaining matches keep the universe's own order.
    query_upper = query.upper()
    matched.sort(key=lambda it: 0 if it["code"] == query_upper else 1)
    results = [{"code": it["code"], "name": it["name"], "market": "US"} for it in matched[:limit]]

    # Everything else listed in the US — non-index stocks and every ETF — after the
    # curated names, except that an exact ticker always comes first.
    if len(results) < limit:
        # The index roster writes share classes as BRK.B, the directory as BRK-B.
        known = {r["code"].replace(".", "-") for r in results}
        for row in us_listing_directory.search(query, limit):
            if row["code"] in known:
                continue
            hit = {"code": row["code"], "name": row["name"], "market": "US"}
            if row["etf"]:
                hit["asset_type"] = "ETF"
            if row["code"] == query_upper:
                results.insert(0, hit)
            else:
                results.append(hit)
            if len(results) >= limit:
                break
    return results[:limit]
