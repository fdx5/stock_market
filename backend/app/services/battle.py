from app.data.exchange_fetcher import get_usd_krw
from app.data.global_marketcap_fetcher import get_company_detail, get_global_top20
from app.data.stock_quote_fetcher import get_stock_quote
from app.services.cache import cache

SAMSUNG_CODE = "005930"
SKHYNIX_CODE = "000660"

TTL_BATTLE_SECONDS = 3
TTL_EXCHANGE_SECONDS = 3
TTL_GLOBAL_TOP20_SECONDS = 5
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


def get_global_top20_cached() -> list[dict]:
    return cache.get_or_set("global_top20", TTL_GLOBAL_TOP20_SECONDS, get_global_top20)


def get_company_detail_cached(detail_path: str) -> dict | None:
    return cache.get_or_set(
        f"company_detail:{detail_path}", TTL_COMPANY_DETAIL_SECONDS, lambda: get_company_detail(detail_path)
    )
