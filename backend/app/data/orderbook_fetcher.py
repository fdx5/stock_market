import requests
from app.data.http_pool import mount_pool

# Naver's legacy sise HTML now redirects to a client-rendered page. Use the
# JSON feed that the replacement stock page uses for its 10-level KRX ladder.
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


def get_orderbook(code: str) -> dict:
    """Return asks high-to-low and bids best-first from Naver's delayed feed.

    Failures must propagate so the stale-while-revalidate cache retains its last
    good ladder. A valid empty ladder returns available=False, not a fake quote.
    """
    resp = _session.get(f"https://stock.naver.com/api/domestic/detail/{code}/hoga", timeout=6)
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, dict) or data.get("itemCode") != code or not any(
        f"hoga{i}" in data for i in range(1, 11)
    ):
        raise ValueError(f"호가 응답 형식이 올바르지 않습니다: {code}")

    asks: list[dict] = []
    bids: list[dict] = []
    for i in range(1, 11):
        raw = data.get(f"hoga{i}")
        if raw is None or raw == "":
            continue
        # Each level is ask price : bid price : ask quantity : bid quantity.
        fields = raw.split(":")
        if len(fields) != 4:
            raise ValueError(f"호가 단계 형식이 올바르지 않습니다: {code}, {i}")
        ask, bid, ask_qty, bid_qty = map(_parse_int, fields)
        if min(ask, bid, ask_qty, bid_qty) < 0:
            raise ValueError(f"호가 값이 올바르지 않습니다: {code}, {i}")
        if ask > 0:
            asks.append({"price": ask, "qty": ask_qty})
        if bid > 0:
            bids.append({"price": bid, "qty": bid_qty})

    return {
        "code": code,
        "delayed_minutes": 20,
        "available": bool(asks or bids),
        "asks": sorted(asks, key=lambda level: level["price"], reverse=True),
        "bids": sorted(bids, key=lambda level: level["price"], reverse=True),
        "total_ask_qty": _parse_int(data.get("totalSellVolume")),
        "total_bid_qty": _parse_int(data.get("totalBuyVolume")),
    }
