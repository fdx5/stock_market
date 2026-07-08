from concurrent.futures import ThreadPoolExecutor, as_completed

from app.data.naver_price_fetcher import fetch_market_cap_page
from app.services.cache import cache

# Independent cache tiers from the KOSPI MAP's (different requested cadence for this
# feature) — cached per Naver page under its own key namespace so the two features'
# freshness guarantees don't collide on a shared cache entry.
TIER1_PAGES = 1
TIER1_TTL_SECONDS = 10
TIER2_PAGES = 3
TIER2_TTL_SECONDS = 2 * 60
TIER3_PAGES = 6
TIER3_TTL_SECONDS = 5 * 60


def _page_ttl(page: int) -> int:
    if page <= TIER1_PAGES:
        return TIER1_TTL_SECONDS
    if page <= TIER2_PAGES:
        return TIER2_TTL_SECONDS
    return TIER3_TTL_SECONDS


def _get_page(page: int) -> list[dict]:
    ttl = _page_ttl(page)
    return cache.get_or_set(f"top100live_naver_page:{page}", ttl, lambda: fetch_market_cap_page(page))


def get_live_prices(codes: list[str]) -> dict[str, dict]:
    """code -> {close, change, change_pct} for whichever of `codes` show up in the live
    KOSPI market-cap ranking (TIER3_PAGES pages comfortably covers our top 100 list even
    after Naver's ETF rows dilute the ranking)."""
    wanted = set(codes)
    found: dict[str, dict] = {}

    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(_get_page, page) for page in range(1, TIER3_PAGES + 1)]
        for future in as_completed(futures):
            try:
                rows = future.result()
            except Exception:  # noqa: BLE001 - one bad page shouldn't sink the rest
                continue
            for row in rows:
                if row["code"] in wanted:
                    found[row["code"]] = {
                        "close": row["close"],
                        "change": row["change"],
                        "change_pct": row["change_pct"],
                    }

    return found
