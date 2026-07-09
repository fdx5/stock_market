import threading

import FinanceDataReader as fdr
import pandas as pd

from app.services.cache import cache
from app.services.translation import translate_batch_to_english

TTL_UNIVERSE_SECONDS = 24 * 3600

ENGLISH_NAMES_CACHE_KEY = "universe_english_names"
TTL_ENGLISH_NAMES_SECONDS = 24 * 3600


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
    names = sorted(set(get_universe()["Name"].astype(str)))
    translations = translate_batch_to_english(names)
    return dict(zip(names, translations))


def warm_english_names() -> None:
    """Blocking; meant to be run on a background thread (see main.py's startup hook)
    so the ~2,700-name translate batch doesn't hold up app startup."""
    cache.get_or_set(ENGLISH_NAMES_CACHE_KEY, TTL_ENGLISH_NAMES_SECONDS, _load_english_names)


def _get_english_names_if_ready() -> dict[str, str] | None:
    """Non-blocking: an English search index (~2,700 names through the live
    translator) takes tens of seconds to build, far too slow for a live
    search-as-you-type request. Reads whatever's cached and, if nothing is (cold
    start or the 24h TTL just lapsed), kicks off a background rebuild so a search a
    little later benefits — meanwhile this and any concurrent search just falls back
    to Korean name/code matching instead of blocking on it."""
    cached = cache.peek(ENGLISH_NAMES_CACHE_KEY)
    if cached is not None:
        return cached

    threading.Thread(target=warm_english_names, daemon=True).start()
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
