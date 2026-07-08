from app.data.stock_quote_fetcher import get_stock_quote
from app.services.cache import cache

SAMSUNG_CODE = "005930"
SKHYNIX_CODE = "000660"

TTL_BATTLE_SECONDS = 3


def _fetch_battle() -> dict:
    return {
        "samsung": get_stock_quote(SAMSUNG_CODE),
        "skhynix": get_stock_quote(SKHYNIX_CODE),
    }


def get_battle() -> dict:
    return cache.get_or_set("battle_marketcap", TTL_BATTLE_SECONDS, _fetch_battle)
