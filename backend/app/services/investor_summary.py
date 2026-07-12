from concurrent.futures import ThreadPoolExecutor, as_completed

from app.data import investor_fetcher
from app.data.universe import get_top_market_cap
from app.services.cache import cache

TTL_SUMMARY_SECONDS = 30 * 60
SUMMARY_STOCK_COUNT = 100


def _load_summary() -> list[dict]:
    universe = get_top_market_cap(SUMMARY_STOCK_COUNT)
    order = {entry["code"]: idx for idx, entry in enumerate(universe)}

    items = []
    with ThreadPoolExecutor(max_workers=16) as pool:
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


TTL_WEEKLY_FOREIGN_SECONDS = 30 * 60
WEEKLY_FOREIGN_TRADING_DAYS = 5
WEEKLY_FOREIGN_TOP_N = 20


def _load_weekly_foreign() -> list[dict]:
    universe = get_top_market_cap(SUMMARY_STOCK_COUNT)

    items = []
    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = {
            pool.submit(investor_fetcher.get_investor_trend, entry["code"], WEEKLY_FOREIGN_TRADING_DAYS): entry
            for entry in universe
        }
        for future in as_completed(futures):
            entry = futures[future]
            try:
                trend = future.result()
            except Exception:
                continue
            if not trend:
                continue

            items.append(
                {
                    "code": entry["code"],
                    "name": entry["name"],
                    # Sum of daily net foreign amounts over the trading days Naver
                    # returned (usually 5) — the closest a free source gets to a
                    # true "weekly" foreign net-buy/sell figure.
                    "amount": round(sum(r["foreign_amount"] for r in trend), 1),
                }
            )

    return items


def get_weekly_foreign_top() -> dict:
    items = cache.get_or_set("weekly_foreign_top", TTL_WEEKLY_FOREIGN_SECONDS, _load_weekly_foreign)
    buy = sorted(items, key=lambda it: it["amount"], reverse=True)[:WEEKLY_FOREIGN_TOP_N]
    sell = sorted(items, key=lambda it: it["amount"])[:WEEKLY_FOREIGN_TOP_N]
    return {"buy": buy, "sell": sell}
