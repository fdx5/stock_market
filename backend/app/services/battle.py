from app.data.naver_price_fetcher import fetch_market_cap_page
from app.services.cache import cache

# Samsung Electronics and SK Hynix are always rank #1/#2 by market cap, so they're
# both on page 1 of the same live ranking page the KOSPI MAP already scrapes.
SAMSUNG_CODE = "005930"
SKHYNIX_CODE = "000660"

TTL_BATTLE_SECONDS = 3


def _fetch_battle() -> dict:
    rows = fetch_market_cap_page(1)
    by_code = {row["code"]: row for row in rows}
    return {
        "samsung": by_code.get(SAMSUNG_CODE),
        "skhynix": by_code.get(SKHYNIX_CODE),
    }


def get_battle() -> dict:
    return cache.get_or_set("battle_marketcap", TTL_BATTLE_SECONDS, _fetch_battle)
