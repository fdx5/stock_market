"""?tail=N on /api/market/ticker: the bandwidth-saving refresh shape useMarketTicker splices."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers import market_map


def _client(monkeypatch, items):
    monkeypatch.setattr(market_map, "get_market_ticker", lambda: items)
    app = FastAPI()
    app.include_router(market_map.router, prefix="/api/market")
    return TestClient(app)


def test_tail_carries_last_points_and_full_series_check(monkeypatch):
    points = [100.1, 100.2, 99.95, 100.4, 100.35]
    client = _client(monkeypatch, [{"symbol": "BTC-USD", "price": 100.35, "points": points}])
    full = client.get("/api/market/ticker").json()["items"][0]
    assert full["points"] == points and "points_sum" not in full
    tail = client.get("/api/market/ticker?tail=2").json()["items"][0]
    assert tail["points"] == points[-2:]
    assert tail["points_len"] == 5 and tail["points_first"] == 100.1
    total = 0.0
    for value in points:
        total += value
    assert tail["points_sum"] == total
    assert tail["price"] == 100.35


def test_tail_with_empty_series_and_bounds(monkeypatch):
    client = _client(monkeypatch, [{"symbol": "GC=F", "price": 1, "points": []}])
    item = client.get("/api/market/ticker?tail=8").json()["items"][0]
    assert item["points"] == [] and item["points_len"] == 0 and item["points_first"] is None
    assert client.get("/api/market/ticker?tail=0").status_code == 422
    assert client.get("/api/market/ticker?tail=65").status_code == 422
