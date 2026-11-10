"""In-memory responses and clocks; no DB, app startup or network."""
import pytest
import requests
from app.data import kospi_futures_fetcher as fut
from app.services.cache import cache

BASIC = {"closePrice": "812.10", "compareToPreviousClosePrice": "36.25", "fluctuationsRatio": "4.67",
         "marketStatus": "OPEN", "localTradedAt": "2026-11-10T15:34:59+09:00"}

@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setattr(fut, "_header_failed_at", None)
    monkeypatch.setattr(cache, "get_or_set", lambda key, ttl, factory, **kw: factory())

def mock(monkeypatch, payload=None, error=None):
    calls = []
    class Response:
        def raise_for_status(self): pass
        def json(self): return dict(payload)
    def get(url, **kwargs):
        calls.append(url)
        if error: raise error
        return Response()
    monkeypatch.setattr(fut.requests, "get", get)
    return calls

def test_parses_day_futures(monkeypatch):
    mock(monkeypatch, BASIC)
    quote = fut.get_header_quote()
    assert quote["close"] == 812.1 and quote["change_pct"] == 4.67
    assert quote["session_state"] == "open" and quote["stale"] is False
    assert quote["quote_time"] == 1794292499

def test_closed_market_and_bad_stamp(monkeypatch):
    mock(monkeypatch, {**BASIC, "marketStatus": "CLOSE", "localTradedAt": "?"})
    quote = fut.get_header_quote()
    assert quote["session_state"] == "closed" and quote["quote_time"] is None

def test_failure_backs_off(monkeypatch):
    calls = mock(monkeypatch, error=requests.ConnectionError())
    assert fut.get_header_quote()["fetch_failed"] is True
    assert fut.get_header_quote()["close"] is None
    assert len(calls) == 1

def test_rejects_non_finite(monkeypatch):
    mock(monkeypatch, {**BASIC, "closePrice": "nan"})
    assert fut.get_header_quote()["fetch_failed"] is True
