"""Isolated RAM caches and mocked feeds only; no app startup or database access."""
from concurrent.futures import ThreadPoolExecutor
import threading

import pytest

from app.data import index_fetcher as index, market_ticker_fetcher as ticker
from app.routers import investor
from app.services import cache as cache_module
from app.services.cache import TTLCache


@pytest.fixture
def clock(monkeypatch):
    now = [100.0]
    monkeypatch.setattr(cache_module.time, "time", lambda: now[0])
    monkeypatch.setattr(index, "cache", TTLCache())
    monkeypatch.setattr(ticker, "cache", TTLCache())
    monkeypatch.setattr(index.requests, "get", lambda *a, **kw: pytest.fail("Unexpected network request"))
    return now


@pytest.mark.parametrize("kind", ["index", "investor", "ticker"])
def test_next_five_second_poll_receives_new_quote_without_extra_stale_cycle(monkeypatch, clock, kind):
    calls = []

    def fetch(*args):
        calls.append(clock[0])
        # Simulate source latency: a TTL of 5s would miss the very next poll.
        clock[0] += .25
        return {"value": len(calls)}

    if kind == "index":
        monkeypatch.setattr(index, "_fetch_index", fetch)
        read = lambda: index.get_index("KOSPI", fresh=True)
    elif kind == "investor":
        monkeypatch.setattr(index, "_fetch_market_investor", fetch)
        read = lambda: index.get_market_investor_summary("KOSPI", fresh=True)
    else:
        monkeypatch.setattr(ticker, "_fetch_all", fetch)
        read = ticker.get_market_ticker

    assert read() == {"value": 1}
    assert read() == {"value": 1}
    clock[0] = 105.0
    assert read() == {"value": 2}
    assert len(calls) == 2


def test_concurrent_visitors_share_one_ticker_request(monkeypatch, clock):
    entered, release = threading.Event(), threading.Event()
    calls = []

    def fetch():
        calls.append(1)
        entered.set()
        assert release.wait(3)
        return [{"symbol": "BTC-USD", "price": 100}]

    monkeypatch.setattr(ticker, "_fetch_all", fetch)
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(ticker.get_market_ticker) for _ in range(8)]
        assert entered.wait(3)
        release.set()
        assert all(f.result() == [{"symbol": "BTC-USD", "price": 100}] for f in futures)
    assert len(calls) == 1


def test_failed_ticker_refresh_preserves_cached_quote_and_recovers(monkeypatch, clock):
    monkeypatch.setattr(ticker, "_fetch_all", lambda: [{"price": 100}])
    assert ticker.get_market_ticker() == [{"price": 100}]
    clock[0] = 105

    def fail():
        raise RuntimeError("Feed unavailable")

    monkeypatch.setattr(ticker, "_fetch_all", fail)
    with pytest.raises(RuntimeError, match="Feed unavailable"):
        ticker.get_market_ticker()
    # Inspect only this test's new in-memory cache; an error cannot overwrite it.
    assert ticker.cache._store["market_ticker"][1] == [{"price": 100}]
    monkeypatch.setattr(ticker, "_fetch_all", lambda: [{"price": 101}])
    assert ticker.get_market_ticker() == [{"price": 101}]


def test_four_index_feeds_run_in_parallel(monkeypatch, clock):
    ready = threading.Barrier(4, timeout=3)

    def fetch(symbol, fresh):
        assert fresh is True
        ready.wait()
        return {"symbol": symbol}

    monkeypatch.setattr(index, "get_index", fetch)
    monkeypatch.setattr(index, "get_market_investor_summary", fetch)
    result = investor.indices(fresh=True)
    assert set(result) == {"kospi", "kosdaq", "kospi_investor", "kosdaq_investor"}
    assert result["kosdaq_investor"] == {"symbol": "KOSDAQ"}
