"""Only HTTP fixtures and a fresh memory cache. No app lifespan or database."""
import datetime as dt
import json

import pytest
import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services import asset_prices as prices
from app.services.cache import TTLCache
from app.routers import asset_prices as routes


def payload(rows, timezone="UTC"):
    return {"meta": {"exchangeTimezoneName": timezone},
            "timestamp": [int(dt.datetime.fromisoformat(day).replace(tzinfo=dt.timezone.utc).timestamp()) for day, _ in rows],
            "indicators": {"quote": [{"close": [close for _, close in rows], "open": [10] * len(rows), "high": [12] * len(rows), "low": [8] * len(rows)}]}}


NOW = dt.datetime(2026, 10, 22, 12, tzinfo=dt.timezone.utc)


def test_calendar_year_and_first_change_uses_close_before_window():
    data = prices.build_history("bitcoin", payload([("2025-10-21", 100), ("2025-10-22", 110), ("2026-10-21", 121), ("2026-10-22", 133.1)]), NOW)
    assert data["start_date"] == "2025-10-22"
    assert len(data["points"]) == 3
    assert data["points"][0]["change"] == 10
    assert data["points"][0]["change_pct"] == pytest.approx(10)
    assert prices.year_start(dt.date(2024, 2, 29)) == dt.date(2023, 2, 28)


def test_exchange_timezone_and_invalid_closes_preserve_verified_duplicate():
    result = payload([("2026-10-22T00:00:00", 20), ("2026-10-22T00:00:00", None), ("2026-10-23", float("nan")), ("2026-10-24", 30)], "America/New_York")
    data = prices.build_history("gold", result, NOW)
    assert data["latest_date"] == "2026-10-21" and data["points"][0]["close"] == 20
    assert data["points"][0]["volume"] is None
    json.dumps(data, allow_nan=False)


def test_zero_and_negative_prices_are_not_fabricated_or_divided_by_zero():
    data = prices.build_history("wti", payload([("2026-10-19", -10), ("2026-10-20", 0), ("2026-10-21", 5)]), NOW)
    assert data["points"][0]["close"] == -10
    assert data["points"][-1]["change"] == 5 and data["points"][-1]["change_pct"] is None


@pytest.mark.parametrize("asset", prices.ASSETS)
def test_seven_routes_and_shared_memory_cache(monkeypatch, asset):
    monkeypatch.setattr(prices, "cache", TTLCache())
    calls = []
    def fetch(key):
        calls.append(key)
        return prices.build_history(key, payload([("2026-10-21", 100), ("2026-10-22", 105)]), NOW)
    monkeypatch.setattr(prices, "_fetch", fetch)
    app = FastAPI();app.include_router(routes.router, prefix="/api/market/assets")
    with TestClient(app) as client:
        for _ in range(2):
            response = client.get(f"/api/market/assets/{asset}/history")
            assert response.status_code == 200
            assert response.json()["symbol"] == prices.ASSETS[asset][0]
            assert len(response.json()["points"]) == 2
        assert client.get("/api/market/assets/UNKNOWN/history").status_code == 404
    assert calls == [asset]


def test_provider_failure_is_recoverable_503(monkeypatch):
    monkeypatch.setattr(prices, "cache", TTLCache())
    calls = []
    def failed(*args, **kwargs):
        calls.append(kwargs);raise requests.Timeout()
    monkeypatch.setattr(prices.requests, "get", failed)
    app = FastAPI();app.include_router(routes.router)
    with TestClient(app) as client:
        assert client.get("/ethereum/history").status_code == 503
        assert len(calls) == 2 and all(call["timeout"] == 8 for call in calls)
        monkeypatch.setattr(prices, "_fetch", lambda key: prices.build_history(key, payload([("2026-10-22", 1)]), NOW))
        assert client.get("/ethereum/history").status_code == 200


def test_secondary_host_recovers_and_no_nan_json(monkeypatch):
    calls = []
    class Response:
        def raise_for_status(self): pass
        def json(self):
            today = dt.datetime.now(dt.timezone.utc).date().isoformat()
            return {"chart": {"result": [payload([(today, 10)])]}}
    def fetch(url, **kwargs):
        calls.append(url)
        if len(calls) == 1:raise requests.ConnectionError()
        return Response()
    monkeypatch.setattr(prices.requests, "get", fetch)
    result = prices._fetch("silver")
    assert "query2" in calls[-1] and result["points"][0]["close"] == 10
    json.dumps(result, allow_nan=False)
