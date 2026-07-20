import threading

from app.data.us_index_fetcher import get_nasdaq100_constituents, get_sp500_constituents
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
    return list(seen.values())


def get_us_universe() -> list[dict]:
    return cache.get_or_set("us_universe", TTL_UNIVERSE_SECONDS, _load_us_universe)


def get_us_stock_item(code: str) -> dict | None:
    for item in get_us_universe():
        if item["code"] == code:
            return item
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


def search_us_stocks(query: str, limit: int = 30) -> list[dict]:
    query = query.strip()
    if not query:
        return []
    query_lower = query.lower()

    korean_names = _get_korean_names_if_ready()
    matched_english_names: set[str] = set()
    if korean_names:
        matched_english_names = {english for english, korean in korean_names.items() if query in korean}

    matched = [
        item
        for item in get_us_universe()
        if query_lower in item["code"].lower()
        or query_lower in item["name"].lower()
        or item["name"] in matched_english_names
    ]
    return [{"code": it["code"], "name": it["name"], "market": "US"} for it in matched[:limit]]
