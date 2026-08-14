"""The commodity futures board — one live price per contract, for the 선물가격 panel.

The roster is kr.investing.com's 실시간 선물 table, transcribed: the same contracts, the
same Korean names, in a grouped version of the same order. The *prices* come from Yahoo's
v7 quote endpoint instead of from that page, and the reason is the refresh rate this
board is built for. Investing.com renders its table server-side inside a ~900KB Next.js
document; re-fetching that every ten seconds would move several gigabytes a day off
someone else's servers to read twenty-seven numbers. Yahoo answers the whole roster in a
single request, carries the same contracts (spot-checked against that page: cocoa, coffee
C, sugar No.11 and the metals all agree to the cent), and this app already holds the
cookie+crumb pool that endpoint needs — see yahoo_bulk_quote.

Two kinds of row on investing.com are deliberately absent:

- **금/달러 (XAU/USD).** Excluded by request. It is the only row on that page that is a
  spot currency pair rather than a futures contract, so the board is uniform without it.
- **The LME/London contracts** — 아연, 니켈, LME 구리, 런던 커피, 런던 가스 오일. Yahoo
  does not quote them, and a row that is permanently blank is worse than no row. Their
  COMEX/ICE equivalents are on the board already, aluminium included (ALI=F, which is the
  COMEX contract — it tracks the LME one but is not the same price).

`unit` is what one contract is priced in, because a number like 460.25 for corn means
nothing without "¢/bu" beside it, and the four price scales on this board (dollars,
cents, dollars-per-tonne, index points) otherwise look like one scale with wild outliers.
"""

import datetime as dt

from app.data import yahoo_bulk_quote
from app.services.cache import cache

# The panel polls every 10s; this is what actually bounds how often Yahoo is asked,
# however many visitors have the board open.
TTL_FUTURES_SECONDS = 10

# `icon` names a glyph in the frontend's CommodityIcon set, not a file — the icons are
# drawn as inline SVG, so this is the only place the two sides have to agree.
ROSTER: list[dict] = [
    # ── 금속 ──
    {"symbol": "GC=F", "name": "금", "name_en": "Gold", "icon": "gold", "unit": "$/oz"},
    {"symbol": "SI=F", "name": "은", "name_en": "Silver", "icon": "silver", "unit": "$/oz"},
    {"symbol": "PL=F", "name": "백금", "name_en": "Platinum", "icon": "platinum", "unit": "$/oz"},
    {"symbol": "PA=F", "name": "팔라듐", "name_en": "Palladium", "icon": "palladium", "unit": "$/oz"},
    {"symbol": "HG=F", "name": "구리", "name_en": "Copper", "icon": "copper", "unit": "$/lb"},
    {"symbol": "ALI=F", "name": "알루미늄", "name_en": "Aluminum", "icon": "aluminum", "unit": "$/t"},
    # ── 에너지 ──
    {"symbol": "CL=F", "name": "WTI유", "name_en": "Crude Oil WTI", "icon": "crude", "unit": "$/bbl"},
    {"symbol": "BZ=F", "name": "브렌트유", "name_en": "Brent Oil", "icon": "brent", "unit": "$/bbl"},
    {"symbol": "NG=F", "name": "천연가스", "name_en": "Natural Gas", "icon": "gas", "unit": "$/MMBtu"},
    {"symbol": "HO=F", "name": "난방유", "name_en": "Heating Oil", "icon": "heating-oil", "unit": "$/gal"},
    {"symbol": "RB=F", "name": "가솔린 RBOB", "name_en": "Gasoline RBOB", "icon": "gasoline", "unit": "$/gal"},
    # ── 곡물 ──
    {"symbol": "ZW=F", "name": "미국 소맥", "name_en": "US Wheat", "icon": "wheat", "unit": "¢/bu"},
    {"symbol": "ZC=F", "name": "미국 옥수수", "name_en": "US Corn", "icon": "corn", "unit": "¢/bu"},
    {"symbol": "ZS=F", "name": "미국 대두", "name_en": "US Soybeans", "icon": "soybean", "unit": "¢/bu"},
    {"symbol": "ZL=F", "name": "미국 대두유", "name_en": "US Soybean Oil", "icon": "soybean-oil", "unit": "¢/lb"},
    {"symbol": "ZM=F", "name": "미국 대두박", "name_en": "US Soybean Meal", "icon": "soybean-meal", "unit": "$/t"},
    {"symbol": "ZR=F", "name": "현미", "name_en": "Rough Rice", "icon": "rice", "unit": "$/cwt"},
    {"symbol": "ZO=F", "name": "귀리", "name_en": "Oats", "icon": "oats", "unit": "¢/bu"},
    # ── 소프트 ──
    {"symbol": "CT=F", "name": "미국 원면 No.2", "name_en": "US Cotton No.2", "icon": "cotton", "unit": "¢/lb"},
    {"symbol": "CC=F", "name": "미국 코코아", "name_en": "US Cocoa", "icon": "cocoa", "unit": "$/t"},
    {"symbol": "KC=F", "name": "미국 커피 C", "name_en": "US Coffee C", "icon": "coffee", "unit": "¢/lb"},
    {"symbol": "SB=F", "name": "미국 설탕 No.11", "name_en": "US Sugar No.11", "icon": "sugar", "unit": "¢/lb"},
    {"symbol": "OJ=F", "name": "오렌지 주스", "name_en": "Orange Juice", "icon": "orange-juice", "unit": "¢/lb"},
    # ── 축산 · 임산 ──
    {"symbol": "LE=F", "name": "생우", "name_en": "Live Cattle", "icon": "cattle", "unit": "¢/lb"},
    {"symbol": "GF=F", "name": "육우", "name_en": "Feeder Cattle", "icon": "feeder-cattle", "unit": "¢/lb"},
    {"symbol": "HE=F", "name": "돈육", "name_en": "Lean Hogs", "icon": "hog", "unit": "¢/lb"},
    {"symbol": "LBR=F", "name": "원목", "name_en": "Lumber", "icon": "lumber", "unit": "$/1000bf"},
]

FUTURES_MARKETS = {
    "GC=F": ("us", "COMEX"), "SI=F": ("us", "COMEX"), "HG=F": ("us", "COMEX"), "ALI=F": ("us", "COMEX"),
    "PL=F": ("us", "NYMEX"), "PA=F": ("us", "NYMEX"), "CL=F": ("us", "NYMEX"), "NG=F": ("us", "NYMEX"),
    "HO=F": ("us", "NYMEX"), "RB=F": ("us", "NYMEX"), "BZ=F": ("gb", "ICE Europe"),
    "ZW=F": ("us", "CBOT"), "ZC=F": ("us", "CBOT"), "ZS=F": ("us", "CBOT"), "ZL=F": ("us", "CBOT"),
    "ZM=F": ("us", "CBOT"), "ZR=F": ("us", "CBOT"), "ZO=F": ("us", "CBOT"),
    "CT=F": ("us", "ICE US"), "CC=F": ("us", "ICE US"), "KC=F": ("us", "ICE US"),
    "SB=F": ("us", "ICE US"), "OJ=F": ("us", "ICE US"),
    "LE=F": ("us", "CME"), "GF=F": ("us", "CME"), "HE=F": ("us", "CME"), "LBR=F": ("us", "CME"),
}


def _decimals(price: float) -> int:
    """Enough digits to see the contract move, without printing noise.

    Copper trades at 6.63 and moves in ten-thousandths; cocoa trades at 5637 and moves in
    whole dollars. One fixed precision would either round copper flat or hang three dead
    zeros off cocoa, and the board is read as a column — so the scale decides.
    """
    if price >= 1000:
        return 2
    if price >= 100:
        return 2
    if price >= 10:
        return 3
    return 4


def _build() -> dict:
    quotes = yahoo_bulk_quote.get_quotes([entry["symbol"] for entry in ROSTER])

    # Empty is an upstream failure, not a real market state. Raising keeps an
    # existing last-known-good cache entry instead of replacing the board with [].
    if not quotes:
        raise RuntimeError("Yahoo v7 returned no futures quotes from either host")

    items: list[dict] = []
    updated_at = dt.datetime.now(dt.timezone.utc).isoformat()
    for entry in ROSTER:
        quote = quotes.get(entry["symbol"])
        if not quote:
            # A contract Yahoo did not answer for this round is left out rather than
            # rendered blank; the panel keeps the row it already had (see the frontend's
            # merge) so a one-off gap never empties the board.
            continue
        price = float(quote["close"])
        flag, market_name = FUTURES_MARKETS.get(entry["symbol"], ("us", "CME"))
        items.append(
            {
                "symbol": entry["symbol"],
                "name": entry["name"],
                "name_en": entry["name_en"],
                "icon": entry["icon"],
                "unit": entry["unit"],
                "flag": flag,
                "market_name": market_name,
                "updated_at": updated_at,
                "price": round(price, _decimals(price)),
                "change": quote["change"],
                "change_pct": quote["change_pct"],
                "decimals": _decimals(price),
            }
        )
    return {"items": items}


def get_futures() -> dict:
    return cache.get_or_set("commodity_futures", TTL_FUTURES_SECONDS, _build)
