from concurrent.futures import ThreadPoolExecutor, as_completed

from app.data import investor_fetcher
from app.data.universe import get_top_market_cap
from app.services.cache import cache

TTL_SUMMARY_SECONDS = 30 * 60
SUMMARY_STOCK_COUNT = 20


def _load_summary() -> list[dict]:
    universe = get_top_market_cap(SUMMARY_STOCK_COUNT)
    order = {entry["code"]: idx for idx, entry in enumerate(universe)}

    items = []
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {
            pool.submit(investor_fetcher.get_investor_trend, entry["code"], 1): entry for entry in universe
        }
        for future in as_completed(futures):
            entry = futures[future]
            try:
                trend = future.result()
            except Exception:
                continue
            if not trend:
                continue

            latest = trend[0]
            items.append(
                {
                    "code": entry["code"],
                    "name": entry["name"],
                    "date": latest["date"],
                    "individual_amount": latest["individual_amount"],
                    "institution_amount": latest["institution_amount"],
                    "foreign_amount": latest["foreign_amount"],
                }
            )

    items.sort(key=lambda it: order.get(it["code"], len(order)))
    return items


def get_investor_summary() -> list[dict]:
    return cache.get_or_set("investor_summary", TTL_SUMMARY_SECONDS, _load_summary)
