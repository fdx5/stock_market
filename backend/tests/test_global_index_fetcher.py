"""Public-feed fixtures and fresh in-memory caches; no DB or app startup."""
import datetime as dt
import json
from concurrent.futures import ThreadPoolExecutor

import pytest
import requests
from fastapi import Response

from app.data import global_index_fetcher as feed
from app.routers import global_dashboard as dashboard
from app.services.cache import TTLCache


REAL_CHART = feed._chart
STAMP = int(dt.datetime(2026, 11, 16, 6, tzinfo=dt.timezone.utc).timestamp())


def payload(price=110, stamp=STAMP):
    return {"meta": {"regularMarketPrice": price, "previousClose": 100,
                     "chartPreviousClose": 40, "regularMarketTime": stamp,
                     "exchangeTimezoneName": "Asia/Tokyo", "instrumentType": "INDEX"},
            "timestamp": [stamp - 3 * 86400, stamp],
            "indicators": {"quote": [{"close": [100, None]}]}}


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setattr(feed, "cache", TTLCache())
    monkeypatch.setattr(feed, "_last_good", {})
    monkeypatch.setattr(feed, "_chart", lambda *args: payload())


@pytest.mark.parametrize("code,symbol", list(feed.SYMBOLS.items()))
def test_every_region_has_a_live_quote_actual_timestamp_and_repaired_daily_bar(monkeypatch, code, symbol):
    calls = []
    def chart(actual, period, interval):
        calls.append((actual, period, interval))
        return payload()
    monkeypatch.setattr(feed, "_chart", chart)
    row = feed.get_index(code)
    assert calls == [(symbol, "1d", "1m"), (symbol, "3mo", "1d")]
    assert row["close"] == 110 and row["change_pct"] == 10
    assert row["quote_time"] == STAMP and row["stale"] is False
    assert row["points"] == [{"date": "2026-11-13", "close": 100}, {"date": "2026-11-16", "close": 110}]


def test_quote_expires_in_ten_seconds_while_daily_history_is_reused(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr("app.services.cache.time.time", lambda: clock[0])
    calls = []
    def chart(symbol, period, interval):
        calls.append(period)
        return payload(110 if clock[0] < 110 else 120, STAMP + int(clock[0]))
    monkeypatch.setattr(feed, "_chart", chart)
    assert feed.get_index("N225")["close"] == 110
    clock[0] = 109
    assert feed.get_index("N225")["close"] == 110
    clock[0] = 111
    row = feed.get_index("N225")
    assert row["close"] == 120 and row["change_pct"] == 20
    assert row["points"][-1]["close"] == 120
    assert calls == ["1d", "3mo", "1d"]


@pytest.mark.parametrize("reply", [None, payload(99, STAMP - 60), payload(float("nan"))])
def test_failed_invalid_or_older_reply_keeps_price_and_original_trade_time(monkeypatch, reply):
    first = feed.get_index("N225")
    def chart(*args):
        if reply is None:
            raise RuntimeError("feed down")
        return reply
    monkeypatch.setattr(feed, "_chart", chart)
    row = feed._refresh("^N225")
    assert row["close"] == first["close"] and row["quote_time"] == STAMP
    assert row["stale"] is True


def test_history_failure_still_returns_latest_quote(monkeypatch):
    def chart(symbol, period, interval):
        if period == "3mo": raise RuntimeError("history down")
        return payload()
    monkeypatch.setattr(feed, "_chart", chart)
    row = feed.get_index("SSEC")
    assert row["close"] == 110 and row["stale"] is False
    assert row["points"][-1]["date"] == "2026-11-16"


def test_cold_quote_failure_marks_daily_fallback_and_never_fabricates_trade_time(monkeypatch):
    def chart(symbol, period, interval):
        if period == "1d": raise RuntimeError("quote down")
        return payload()
    monkeypatch.setattr(feed, "_chart", chart)
    row = feed.get_index("HSI")
    assert row["close"] == 100 and row["quote_time"] is None and row["stale"] is True
    assert row["quote_source"] == "daily_history"


def test_endpoint_failure_is_isolated_preserves_order_and_disables_http_cache(monkeypatch):
    monkeypatch.setattr(dashboard, "_kospi_session", lambda now: None)
    actual = feed.get_index
    def index(code):
        if code == "HSI": raise RuntimeError("one index down")
        return actual(code)
    monkeypatch.setattr(feed, "get_index", index)
    response = Response()
    result = dashboard.indices(response)
    assert response.headers["Cache-Control"] == "no-store"
    assert [r["key"] for r in result["items"]] == [w["key"] for w in dashboard.US_WIDGETS + dashboard.OVERSEAS_WIDGETS]
    assert sum(r["close"] == 110 for r in result["items"]) == 8
    json.dumps(result, allow_nan=False)


def test_concurrent_readers_share_one_refresh(monkeypatch):
    calls = []
    def chart(*args):
        calls.append(args)
        return payload()
    monkeypatch.setattr(feed, "_chart", chart)
    with ThreadPoolExecutor(12) as pool:
        rows = list(pool.map(feed.get_index, ["N225"] * 24))
    assert all(row["close"] == 110 for row in rows)
    assert len(calls) == 2


def test_transport_retries_other_host_and_preserves_shanghai_dot(monkeypatch):
    monkeypatch.setattr(feed, "_chart", REAL_CHART)
    calls = []
    class Reply:
        def raise_for_status(self): pass
        def json(self): return {"chart": {"result": [payload()]}}
    def get(url, **kwargs):
        calls.append((url, kwargs))
        if len(calls) == 1: raise requests.Timeout()
        return Reply()
    monkeypatch.setattr(feed.requests, "get", get)
    assert feed._chart("000001.SS", "1d", "1m")["meta"]["regularMarketPrice"] == 110
    assert "query1" in calls[0][0] and "query2" in calls[1][0]
    assert all(url.endswith("/000001.SS") for url, _ in calls)
    assert calls[0][1]["timeout"] == (2, 4)


def test_daily_dates_use_exchange_timezone():
    stamp = int(dt.datetime(2026, 11, 16, 23, tzinfo=dt.timezone.utc).timestamp())
    assert feed._date(stamp, {"exchangeTimezoneName": "Asia/Tokyo"}) == "2026-11-17"
