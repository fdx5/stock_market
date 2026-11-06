"""In-memory responses and clocks; no DB, app startup or network."""
from concurrent.futures import ThreadPoolExecutor
import copy
import time
import pytest
import requests
from app.services import kospi_night as night

@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setattr(night, "_latest", None)
    monkeypatch.setattr(night, "_attempted", None)
    monkeypatch.setattr(night, "_failed", False)

def body(price=803.45, stamp="2026-11-06 21:47:18"):
    return {"stale": False, "night": {"price": price, "prevClose": 783.25,
        "updated": stamp, "live": True, "sessionDate": "2026-11-06",
        "points": [{"t": 1793969238000, "v": price}]}}

def mock_get(monkeypatch, payload, calls):
    class Response:
        def raise_for_status(self): pass
        def json(self): return copy.deepcopy(payload)
    def get(url, **kwargs):
        assert url == night.FEED_URL and kwargs["timeout"] == (3, 5)
        calls.append(url)
        time.sleep(.005)
        return Response()
    monkeypatch.setattr(night.requests, "get", get)

def test_quote_baseline_and_kst_timestamp():
    parsed = night._parse(body())
    assert parsed["close"] == 803.45 and parsed["change"] == 20.2 and parsed["change_pct"] == 2.58
    assert parsed["quote_time"] == 1793969238
    assert parsed["points"][0]["close"] == 803.45

def test_visitors_share_one_crawl_and_refresh_at_ten_seconds(monkeypatch):
    calls, clock = [], [100.0]
    mock_get(monkeypatch, body(), calls)
    monkeypatch.setattr(night.time, "monotonic", lambda: clock[0])
    with ThreadPoolExecutor(max_workers=16) as pool:
        rows = list(pool.map(lambda _: night.get_quote(), range(32)))
    assert len(calls) == 1 and all(row["close"] == 803.45 for row in rows)
    clock[0] += 9.9
    night.get_quote(); assert len(calls) == 1
    clock[0] += .1
    night.get_quote(); assert len(calls) == 2

def test_failure_and_older_source_preserve_last_value_and_report_delay(monkeypatch):
    calls, clock = [], [100.0]
    mock_get(monkeypatch, body(), calls)
    monkeypatch.setattr(night.time, "monotonic", lambda: clock[0])
    night.get_quote()
    clock[0] += 10
    def fail(*args, **kwargs): raise requests.Timeout()
    monkeypatch.setattr(night.requests, "get", fail)
    quote = night.get_quote()
    assert quote["close"] == 803.45 and quote["stale"] and quote["fetch_failed"]
    clock[0] += 10
    mock_get(monkeypatch, body(790, "2026-11-06 21:40:00"), calls)
    assert night.get_quote()["close"] == 803.45

@pytest.mark.parametrize("price", [None, 0, -1, float("nan"), float("inf"), True])
def test_invalid_quotes_are_not_published(monkeypatch, price):
    mock_get(monkeypatch, body(price), [])
    quote = night.get_quote()
    assert quote["close"] is None and quote["stale"]

def test_ticker_reads_minute_bars_and_pre_session_baseline(monkeypatch):
    from app.data import market_ticker_fetcher as ticker
    params = []
    class Response:
        def raise_for_status(self): pass
        def json(self): return {"chart": {"result": [{"meta": {"regularMarketPrice": 100, "previousClose": 90,
            "regularMarketTime": 100, "instrumentType": "EQUITY", "currentTradingPeriod": {"pre": {"start": 150, "end": 250}}},
            "timestamp": [200], "indicators": {"quote": [{"close": [110]}]}}]}}
    def get(*args, **kwargs): params.append(kwargs["params"]); return Response()
    monkeypatch.setattr(ticker.requests, "get", get)
    monkeypatch.setattr(ticker, "_fetch_closes", lambda *args: [100] * 12)
    result = ticker._fetch_one({"symbol": "SOXL", "label": "SOXL"})
    assert params[0]["interval"] == "1m" and params[0]["includePrePost"] == "true"
    assert result["price"] == 110 and result["change_pct"] == 10 and result["session"] == "pre"
