from app.data.exchange_fetcher import get_usd_krw
from app.data.global_marketcap_fetcher import get_company_detail, get_global_top20, get_live_quotes_bulk
from app.data.stock_quote_fetcher import get_stock_quote
from app.services.cache import cache

SAMSUNG_CODE = "005930"
SKHYNIX_CODE = "000660"

TTL_BATTLE_SECONDS = 3
TTL_EXCHANGE_SECONDS = 3
# The companiesmarketcap.com scrape itself barely moves within seconds of a repeat
# request — it reads as a periodic snapshot, not a live feed — so its ranking/logos/
# composition are cached generously, and freshness instead comes from overlaying Yahoo
# Finance quotes (see get_live_quotes_bulk) on a much shorter cache below.
TTL_GLOBAL_TOP20_SNAPSHOT_SECONDS = 5 * 60
TTL_GLOBAL_TOP20_QUOTES_SECONDS = 10
TTL_COMPANY_DETAIL_SECONDS = 60 * 60


def _fetch_battle() -> dict:
    return {
        "samsung": get_stock_quote(SAMSUNG_CODE),
        "skhynix": get_stock_quote(SKHYNIX_CODE),
    }


def get_battle() -> dict:
    return cache.get_or_set("battle_marketcap", TTL_BATTLE_SECONDS, _fetch_battle)


def get_exchange_rate() -> dict | None:
    return cache.get_or_set("battle_usd_krw", TTL_EXCHANGE_SECONDS, get_usd_krw)


def _get_global_top20_snapshot() -> list[dict]:
    return cache.get_or_set("global_top20_snapshot", TTL_GLOBAL_TOP20_SNAPSHOT_SECONDS, get_global_top20)


def get_global_top20_cached() -> list[dict]:
    items = _get_global_top20_snapshot()
    symbols = [it["code"] for it in items if it.get("code")]
    quotes = cache.get_or_set(
        "global_top20_quotes", TTL_GLOBAL_TOP20_QUOTES_SECONDS, lambda: get_live_quotes_bulk(symbols)
    )

    result = []
    for it in items:
        quote = quotes.get(it["code"])
        if quote and quote["previous_close"]:
            # A same-currency price ratio, not an absolute price — several of these
            # tickers quote in their home currency on Yahoo (e.g. 005930.KS in KRW,
            # 2222.SR in SAR) while companiesmarketcap's marcap_usd is USD-denominated.
            # Multiplying by an absolute foreign-currency price would silently inflate
            # the USD figure by whatever that currency's exchange rate is; the ratio
            # sidesteps needing a live FX rate for each ticker's currency at all.
            ratio = quote["price"] / quote["previous_close"]
            it = {**it, "marcap_usd": it["marcap_usd"] * ratio, "change_pct": (ratio - 1) * 100}
        result.append(it)
    return result


def get_company_detail_cached(detail_path: str) -> dict | None:
    return cache.get_or_set(
        f"company_detail:{detail_path}", TTL_COMPANY_DETAIL_SECONDS, lambda: get_company_detail(detail_path)
    )
