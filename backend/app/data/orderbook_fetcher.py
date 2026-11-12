import requests
from app.data.http_pool import mount_pool

# Naver retired /api/domestic/detail/{code}/hoga (404 from 2026-11). The stock
# page now reads its 10-level KRX ladder from the stockSecurity order-book feed;
# the mobile asking-price feed (5 levels) stays as the fallback.
ORDER_BOOK_URL = "https://stock.naver.com/api/stockSecurity/items/v2/domestic/{code}/order-book?depth=10"
ASKING_PRICE_URL = "https://m.stock.naver.com/api/stock/{code}/askingPrice"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
    "Referer": "https://stock.naver.com/",
}
_session = requests.Session()
_session.headers.update(HEADERS)
mount_pool(_session)


def _parse_int(value) -> int:
    cleaned = str(value).replace(",", "").strip() if value is not None else ""
    return int(cleaned) if cleaned else 0


def _level(raw, price_key: str, qty_key: str, code: str) -> tuple[int, int]:
    if not isinstance(raw, dict):
        raise ValueError(f"호가 단계 형식이 올바르지 않습니다: {code}")
    try:
        price = _parse_int(str(raw.get(price_key) or "").split(".")[0])
        qty = _parse_int(raw.get(qty_key))
    except ValueError as exc:
        raise ValueError(f"호가 값이 올바르지 않습니다: {code}") from exc
    if price < 0 or qty < 0:
        raise ValueError(f"호가 값이 올바르지 않습니다: {code}")
    return price, qty


def _ladder(code: str, ask_rows, bid_rows, price_key: str, qty_key: str, total_ask, total_bid) -> dict:
    if not isinstance(ask_rows, list) or not isinstance(bid_rows, list):
        raise ValueError(f"호가 응답 형식이 올바르지 않습니다: {code}")
    asks = [{"price": p, "qty": q} for p, q in (_level(r, price_key, qty_key, code) for r in ask_rows) if p > 0]
    bids = [{"price": p, "qty": q} for p, q in (_level(r, price_key, qty_key, code) for r in bid_rows) if p > 0]
    return {
        "code": code,
        "delayed_minutes": 20,
        "available": bool(asks or bids),
        "asks": sorted(asks, key=lambda level: level["price"], reverse=True),
        "bids": sorted(bids, key=lambda level: level["price"], reverse=True),
        "total_ask_qty": _parse_int(total_ask),
        "total_bid_qty": _parse_int(total_bid),
    }


def _order_book(code: str) -> dict:
    resp = _session.get(ORDER_BOOK_URL.format(code=code), timeout=6)
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, dict) or data.get("itemCode") != code:
        raise ValueError(f"호가 응답 형식이 올바르지 않습니다: {code}")
    return _ladder(code, data.get("askLevels"), data.get("bidLevels"), "price", "volume",
                   data.get("totalAskVolume"), data.get("totalBidVolume"))


def _asking_price(code: str) -> dict:
    resp = _session.get(ASKING_PRICE_URL.format(code=code), timeout=6)
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, dict) or "sellInfo" not in data:
        raise ValueError(f"호가 응답 형식이 올바르지 않습니다: {code}")
    return _ladder(code, data.get("sellInfo"), data.get("buyInfos"), "price", "count",
                   data.get("totalSell"), data.get("totalBuy"))


def get_orderbook(code: str) -> dict:
    """Return asks high-to-low and bids best-first from Naver's delayed feed.

    Failures must propagate so the stale-while-revalidate cache retains its last
    good ladder. A valid empty ladder returns available=False, not a fake quote.
    """
    try:
        return _order_book(code)
    except Exception as primary:
        try:
            return _asking_price(code)
        except Exception:
            raise primary
