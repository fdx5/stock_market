import threading

import FinanceDataReader as fdr
import pandas as pd

from app.services import name_translation_store
from app.services.cache import cache
from app.services.translation import translate_batch_to_english

TTL_UNIVERSE_SECONDS = 24 * 3600

ENGLISH_NAMES_CACHE_KEY = "universe_english_names"
TTL_ENGLISH_NAMES_SECONDS = 24 * 3600

_english_names_rebuild_lock = threading.Lock()
_english_names_rebuilding = False


def _load_market(market: str) -> pd.DataFrame:
    df = fdr.StockListing(market)
    code_col = "Code" if "Code" in df.columns else "Symbol"
    df = df.rename(columns={code_col: "Code"})
    df = df[["Code", "Name", "Marcap"]].dropna()
    df["Market"] = market
    return df


def _get_kospi_universe() -> pd.DataFrame:
    return cache.get_or_set("kospi_universe", TTL_UNIVERSE_SECONDS, lambda: _load_market("KOSPI"))


def _load_full_universe() -> pd.DataFrame:
    # Search and name-resolution (KOSDAQ MAP tile clicks, the main page's search box)
    # need both markets; get_top_market_cap below intentionally stays KOSPI-only since
    # it feeds the investor-summary table, which has never covered KOSDAQ.
    return pd.concat([_get_kospi_universe(), _load_market("KOSDAQ")], ignore_index=True)


def _get_full_universe() -> pd.DataFrame:
    return cache.get_or_set("full_universe", TTL_UNIVERSE_SECONDS, _load_full_universe)


def get_universe() -> pd.DataFrame:
    return _get_full_universe()[["Code", "Name", "Market"]]


def get_top_market_cap(limit: int = 100) -> list[dict]:
    df = _get_kospi_universe().sort_values("Marcap", ascending=False).head(limit)
    return [{"code": str(row["Code"]), "name": str(row["Name"])} for _, row in df.iterrows()]


def _load_english_names() -> dict[str, str]:
    """Covers the full KOSPI+KOSDAQ universe (~2,700 names), not just the top names by
    market cap — but only ever live-translates the names missing from
    name_translation_store (new listings since the last rebuild). Everything already
    translated in a previous run comes back from one DB read instead of a fresh
    Google Translate round-trip, so a rebuild (every TTL_ENGLISH_NAMES_SECONDS, or on
    every cold boot before this was persisted) stays cheap regardless of how often the
    process restarts."""
    df = _get_full_universe()
    names = sorted(set(df["Name"].astype(str)))

    stored = name_translation_store.get_all()
    missing = [name for name in names if name not in stored]
    if missing:
        translated = translate_batch_to_english(missing)
        new_entries = dict(zip(missing, translated))
        name_translation_store.upsert_many(new_entries)
        stored.update(new_entries)

    return {name: stored[name] for name in names}


def _rebuild_english_names() -> None:
    global _english_names_rebuilding
    try:
        cache.get_or_set(ENGLISH_NAMES_CACHE_KEY, TTL_ENGLISH_NAMES_SECONDS, _load_english_names)
    finally:
        with _english_names_rebuild_lock:
            _english_names_rebuilding = False


def warm_english_names() -> None:
    """Triggers the same single-flight guarded rebuild search uses (see
    _get_english_names_if_ready) rather than an unconditional one, so an early
    request racing this startup call can't spawn a second, overlapping translate
    batch — that duplication is what took the production instance down."""
    global _english_names_rebuilding
    with _english_names_rebuild_lock:
        if _english_names_rebuilding or cache.peek(ENGLISH_NAMES_CACHE_KEY) is not None:
            return
        _english_names_rebuilding = True
    _rebuild_english_names()


def _get_english_names_if_ready() -> dict[str, str] | None:
    """Non-blocking: an English search index takes seconds to build, far too slow for
    a live search-as-you-type request. Reads whatever's cached and, if nothing is
    (cold start or the 24h TTL just lapsed), kicks off at most one background rebuild
    — a `_english_names_rebuilding` flag makes this single-flight, since every search
    that lands while the index is still missing would otherwise start its own
    duplicate rebuild (this is what caused the production 502s: concurrent searches
    each spawning their own 20-thread translate batch against Google Translate,
    exhausting the instance). Meanwhile this and any concurrent search just falls
    back to Korean name/code matching instead of blocking on it."""
    cached = cache.peek(ENGLISH_NAMES_CACHE_KEY)
    if cached is not None:
        return cached

    global _english_names_rebuilding
    with _english_names_rebuild_lock:
        if _english_names_rebuilding:
            return None
        _english_names_rebuilding = True

    threading.Thread(target=_rebuild_english_names, daemon=True).start()
    return None


def search_stocks(query: str, limit: int = 30) -> list[dict]:
    query = query.strip()
    if not query:
        return []

    df = get_universe()
    mask = df["Code"].astype(str).str.contains(query, case=False, na=False) | df[
        "Name"
    ].astype(str).str.contains(query, case=False, na=False)

    english_names = _get_english_names_if_ready()
    if english_names:
        query_lower = query.lower()
        matched_korean_names = {
            korean for korean, english in english_names.items() if query_lower in english.lower()
        }
        if matched_korean_names:
            mask = mask | df["Name"].isin(matched_korean_names)

    matched = df[mask].head(limit)

    return [
        {"code": str(row["Code"]), "name": str(row["Name"]), "market": str(row["Market"])}
        for _, row in matched.iterrows()
    ]


def get_stock_name(code: str) -> str | None:
    df = get_universe()
    row = df[df["Code"].astype(str) == code]
    if row.empty:
        return None
    return str(row.iloc[0]["Name"])
