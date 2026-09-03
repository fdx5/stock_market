"""Shared session and symbol resolution for Toss Securities' public read endpoints.

Toss keys a listing by two different opaque codes, and which one a given endpoint
wants is not guessable from the endpoint's shape:

  productCode  (AAPL -> "US19801212001")  the *listing*: quotes, the community board
  companyCode  (AAPL -> "NAS000C7F-E0")   the *issuer*: news coverage

Both come back from the same autocomplete lookup, so resolving them together costs
one request instead of two and keeps them from drifting apart in the cache. The
discussion and news fetchers each take the one they need from here rather than
re-deriving it, which is also why this is a module and not a helper inside either
of them.
"""

import requests

from app.services.cache import cache

TTL_CODES_SECONDS = 24 * 60 * 60
INFO_API = "https://wts-info-api.tossinvest.com"

session = requests.Session()
session.headers.update(
    {
        "User-Agent": "Mozilla/5.0 (compatible; KStockHub/1.0)",
        "Accept": "application/json",
        "Origin": "https://www.tossinvest.com",
        "Referer": "https://www.tossinvest.com/",
    }
)
session.mount(
    "https://",
    requests.adapters.HTTPAdapter(pool_connections=10, pool_maxsize=20, max_retries=1),
)


def _resolve_codes(symbol: str) -> dict[str, str | None]:
    response = session.post(
        f"{INFO_API}/api/v3/search-all/wts-auto-complete",
        json={"query": symbol, "sections": [{"type": "PRODUCT"}]},
        timeout=4,
    )
    response.raise_for_status()
    sections = response.json().get("result") or []
    for section in sections:
        for item in (section.get("data") or {}).get("items") or []:
            # Autocomplete answers with near matches too (searching AAPL also returns
            # Apple-adjacent listings), so only an exact ticker match may be taken.
            if str(item.get("symbol") or "").upper() == symbol.upper():
                return {
                    "product_code": item.get("productCode") or item.get("code"),
                    "company_code": item.get("companyCode"),
                }
    return {"product_code": None, "company_code": None}


def resolve_codes(symbol: str) -> dict[str, str | None]:
    """Both Toss codes for a ticker, or a pair of Nones for one Toss does not list.

    Cached for a day: a listing's codes are assigned once and never change, and the
    lookup is otherwise paid on every board and news request.
    """
    symbol = symbol.upper()
    try:
        return cache.get_or_set(
            f"toss_codes:{symbol}",
            TTL_CODES_SECONDS,
            lambda: _resolve_codes(symbol),
        )
    except Exception:
        return {"product_code": None, "company_code": None}


def resolve_product_code(symbol: str) -> str | None:
    return resolve_codes(symbol)["product_code"]


def resolve_company_code(symbol: str) -> str | None:
    return resolve_codes(symbol)["company_code"]
