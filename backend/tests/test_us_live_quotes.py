"""In-memory market fixtures only; no app startup, databases or saved data."""
from concurrent.futures import ThreadPoolExecutor
import threading
import time

import pandas as pd
import pytest

from app.data import us_index_fetcher as index, us_live_quotes as live, yahoo_bulk_quote as batch, yahoo_quote as chart
from app.services.cache import TTLCache


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    for name in ("_latest", "_attempted", "_symbol_locks"):
        monkeypatch.setattr(live, name, {})
    monkeypatch.setattr(live, "_pending", set())
    monkeypatch.setattr(live, "_queued", set())
    monkeypatch.setattr(live, "_running", False)
    monkeypatch.setattr(index, "cache", TTLCache())


def payload(session="post", price=110, stamp=200):
    meta = {"regularMarketPrice": 100, "previousClose": 90, "regularMarketTime": 100,
            "instrumentType": "EQUITY", "currentTradingPeriod": {"pre": {"start": 150 if session == "pre" else 10, "end": 250 if session == "pre" else 50}}}
    return {"meta": meta, "timestamp": [stamp], "indicators": {"quote": [{"close": [price]}]}}


@pytest.mark.parametrize("session,baseline,expected", [("pre", 100, 10), ("post", 90, 22.22)])
def test_chart_and_batch_agree_on_extended_price_baseline_and_timestamp(session, baseline, expected):
    parsed = chart.as_stock_quote(chart.extract_quote(payload(session)))
    row = {"regularMarketPrice": 100, "regularMarketPreviousClose": 90, "regularMarketTime": 100,
           "marketState": "PRE" if session == "pre" else "POST", f"{session}MarketPrice": 110, f"{session}MarketTime": 200}
    quoted = batch._read(row)
    for key in ("close", "change", "change_pct", "session", "regular_close", "regular_change_pct", "extended_change_pct", "quote_time"):
        assert parsed[key] == quoted[key]
    assert quoted["change_pct"] == expected
    assert quoted["change"] == 110 - baseline


@pytest.mark.parametrize("state,extra", [("PRE", {}), ("PREPRE", {"preMarketPrice": 105, "preMarketTime": 80}), ("CLOSED", {})])
def test_old_post_quote_cannot_resurface_in_a_new_session(state, extra):
    result = batch._read({"regularMarketPrice": 100, "regularMarketPreviousClose": 90, "regularMarketTime": 100,
                          "postMarketPrice": 95, "postMarketTime": 90, "marketState": state, **extra})
    assert result["close"] == 100 and result["session"] == "regular"
    assert result["quote_time"] == 100


def test_futures_never_get_equity_pre_post_labels():
    result = payload()
    result["meta"]["instrumentType"] = "FUTURE"
    parsed = chart.extract_quote(result)
    assert parsed["price"] == 110 and parsed["session"] == "regular"
    assert parsed["previous_close"] == 90 and parsed["quote_time"] == 200


def test_detail_and_overlapping_maps_keep_newest_trade_and_last_good_on_failure(monkeypatch):
    roster = [{"code": "AAPL", "name": "Apple", "sector": "IT", "marcap": 1, "close": 90, "change": 0, "change_pct": 0}]
    monkeypatch.setattr(index, "_fetch_slickcharts", lambda _: roster)
    monkeypatch.setattr(index, "_with_sector", lambda rows: rows)
    recovered = []
    monkeypatch.setattr(live, "recover_missing", lambda codes: recovered.extend(codes))
    monkeypatch.setattr(live, "_fetch_live_quote", lambda code: chart.extract_quote(payload()))
    monkeypatch.setattr(batch, "get_quotes", lambda codes: {})
    assert index.get_sp500_constituents(fresh=True)[0]["close"] == 90
    assert recovered == ["AAPL"]
    assert index.get_us_stock_quote("AAPL", "Apple")["close"] == 110
    assert index.get_nasdaq100_constituents(fresh=True)[0]["close"] == 110
    # An old v7 response and then an empty one cannot overwrite the newer chart trade.
    monkeypatch.setattr(batch, "get_quotes", lambda codes: {"AAPL": {"close": 101, "quote_time": 150}})
    assert index.get_us_stock_quote("AAPL", "Apple")["close"] == 110
    monkeypatch.setattr(batch, "get_quotes", lambda codes: {})
    assert index.get_sp500_constituents(fresh=True)[0]["close"] == 110


def test_chart_recovery_is_single_flight_cached_and_normalizes_share_classes(monkeypatch):
    called = []
    def fetch(code):
        called.append(code)
        time.sleep(.01)
        return chart.extract_quote(payload())
    monkeypatch.setattr(live, "_fetch_live_quote", fetch)
    with ThreadPoolExecutor(max_workers=12) as pool:
        rows = list(pool.map(live.chart_quote, ["BRK.B"] * 24))
    assert all(row["close"] == 110 for row in rows)
    assert called == ["BRK-B"]


def test_failed_recovery_is_throttled_and_keeps_the_prior_print(monkeypatch):
    live.remember({"AAPL": {"close": 110, "quote_time": 200}})
    calls = []
    monkeypatch.setattr(live, "_fetch_live_quote", lambda code: calls.append(code))
    for _ in range(10):
        assert live.chart_quote("AAPL")["close"] == 110
    assert calls == ["AAPL"]


def test_map_recovery_returns_immediately_and_has_one_bounded_queue(monkeypatch):
    starts = []
    class Thread:
        def __init__(self, **kwargs): self.target = kwargs["target"]
        def start(self): starts.append(self.target)
    monkeypatch.setattr(live.threading, "Thread", Thread)
    live.recover_missing([f"S{i}" for i in range(500)])
    live.recover_missing([f"S{i}" for i in range(500)])
    assert len(starts) == 1 and len(live._pending) == 500


def test_background_queue_updates_all_rows_and_caps_upstream_concurrency(monkeypatch):
    active = 0
    maximum = 0
    guard = threading.Lock()
    def fetch(code):
        nonlocal active, maximum
        with guard:
            active += 1; maximum = max(maximum, active)
        time.sleep(.005)
        with guard: active -= 1
        return chart.extract_quote(payload())
    monkeypatch.setattr(live, "_fetch_live_quote", fetch)
    live._pending.update(f"S{i}" for i in range(32))
    live._queued.update(live._pending)
    live._running = True
    live._recover()
    assert len(live.latest([f"S{i}" for i in range(32)])) == 32
    assert 1 < maximum <= 8 and not live._running


def test_global_top100_uses_extended_print_on_both_quote_paths(monkeypatch):
    from app.data import global_top100_batch_quote as top
    monkeypatch.setattr(top, "fetch_rows", lambda codes: [{"symbol": "AAPL", "regularMarketPrice": 100,
        "regularMarketPreviousClose": 90, "regularMarketTime": 100, "marketState": "POST", "postMarketPrice": 110, "postMarketTime": 200}])
    assert top._fetch_chunk(["AAPL"])["AAPL"]["price"] == 110
    class Response:
        def raise_for_status(self): pass
        def json(self): return {"chart": {"result": [payload()]}}
    params = []
    def get(*args, **kwargs): params.append(kwargs["params"]); return Response()
    monkeypatch.setattr(top.requests, "get", get)
    result = top._chart_quote("AAPL")
    assert result["price"] == 110 and result["session"] == "post" and result["quote_time"] == 200
    assert params[0]["includePrePost"] == "true" and params[0]["interval"] == "1m"


def test_global_index_headline_uses_live_quote_while_keeping_history(monkeypatch):
    from app.routers import global_dashboard as dashboard
    df = pd.DataFrame([{"date": "20261016", "close": 90}, {"date": "20261019", "close": 100}])
    monkeypatch.setattr(dashboard.price_fetcher, "get_history", lambda *args, **kwargs: df)
    out = dashboard._widget_data(dashboard.US_WIDGETS[2], {"close": 110, "change": 20, "change_pct": 22.22, "session": "post", "quote_time": 200})
    assert out["close"] == 110 and out["change_pct"] == 22.22
    assert len(out["points"]) == 2 and out["session"] == "post"


def test_global_top100_daily_return_and_session_are_live_without_mutating_snapshot(monkeypatch):
    from app.services import global_top100 as service
    snapshot = [{"symbol": "AAPL", "price": 100, "currency": "USD", "returns": {"d1": 1, "m1": 5}}]
    monkeypatch.setattr(service, "_loaded", True)
    monkeypatch.setattr(service, "_snapshot", snapshot)
    monkeypatch.setattr(service, "_live", {"AAPL": {"price": 110, "currency": "USD", "change_pct": 22.22, "session": "post", "quote_time": 200}})
    row = service.get_top100()["items"][0]
    assert row["returns"] == {"d1": 22.22, "m1": 5}
    assert row["session"] == "post" and row["quote_time"] == 200
    assert snapshot[0]["returns"]["d1"] == 1
