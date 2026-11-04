"""Fake clocks and memory-only quotes: no application startup or saved databases."""
from concurrent.futures import ThreadPoolExecutor
import threading

import pytest

from app.services import cache as cache_module, market_map_quotes as kr
from app.data import us_index_fetcher as us, us_live_quotes as live


@pytest.fixture
def clock(monkeypatch):
    now = [100.0]
    monkeypatch.setattr(cache_module.time, "time", lambda: now[0])
    monkeypatch.setattr(kr, "cache", cache_module.TTLCache())
    monkeypatch.setattr(kr, "_latest", {})
    monkeypatch.setattr(us, "cache", cache_module.TTLCache())
    monkeypatch.setattr(live, "_latest", {})
    monkeypatch.setattr(live, "recover_missing", lambda codes: None)
    return now


def quote(code, pct, stamp):
    return {"code": code, "close": 287500, "change_pct": pct, "quote_time": stamp}


@pytest.mark.parametrize("market,total", [("kospi", 500), ("kosdaq", 200)])
def test_entry_after_expiry_and_all_limits_share_latest_price(monkeypatch, clock, market, total):
    codes = [f"{n:06d}" for n in range(total)]
    calls = []
    def upstream(group):
        calls.append(group)
        return {c: quote(c, 2.88 if clock[0] < 104 else 3.60, clock[0]) for c in group}
    monkeypatch.setattr(kr, "get_stock_quotes_bulk", upstream)
    assert kr.get_map_quotes(market, codes)[codes[0]]["change_pct"] == 2.88
    assert [len(group) for group in calls] == [20, 30, total - 50]
    clock[0] = 105
    # Full snapshot must itself return 3.60, even before any partial request arrives.
    full = kr.get_map_quotes(market, codes)
    assert full[codes[0]]["change_pct"] == 3.60
    assert full[codes[30]]["change_pct"] == 3.60
    for limit in (20, 50):
        assert kr.get_map_quotes(market, codes[:limit])[codes[0]] == full[codes[0]]
    assert len(calls) == 5  # No duplicate fetch for partial requests; tail retains 60s cadence.
    clock[0] = 161
    assert kr.get_map_quotes(market, codes)[codes[-1]]["change_pct"] == 3.60


def test_saturated_background_slots_cannot_block_price_refresh(monkeypatch, clock):
    monkeypatch.setattr(kr, "get_stock_quotes_bulk", lambda codes: {c: quote(c, clock[0], clock[0]) for c in codes})
    kr.get_map_quotes("kospi", ["005380"])
    clock[0] = 105
    def unavailable_thread(*args, **kwargs):
        raise RuntimeError("background refresh unavailable")
    monkeypatch.setattr(cache_module.threading, "Thread", unavailable_thread)
    assert kr.get_map_quotes("kospi", ["005380"])["005380"]["change_pct"] == 105


def test_top_sixty_scanner_keeps_its_five_second_refresh(monkeypatch, clock):
    codes = [str(i) for i in range(60)]
    monkeypatch.setattr(kr, "get_stock_quotes_bulk", lambda group: {c: quote(c, clock[0], clock[0]) for c in group})
    kr.get_map_quotes("kospi", codes)
    clock[0] = 105
    assert kr.get_map_quotes("kospi", codes)[codes[-1]]["change_pct"] == 105


def test_partial_failure_and_older_print_preserve_last_success(monkeypatch, clock):
    monkeypatch.setattr(kr, "get_stock_quotes_bulk", lambda codes: {c: quote(c, 3.60, 100) for c in codes})
    kr.get_map_quotes("kospi", ["005380", "005930"])
    clock[0] = 105
    monkeypatch.setattr(kr, "get_stock_quotes_bulk", lambda codes: {"005930": quote("005930", 4, 105)})
    rows = kr.get_map_quotes("kospi", ["005380", "005930"])
    assert rows["005380"]["change_pct"] == 3.60
    assert rows["005930"]["change_pct"] == 4
    clock[0] = 110
    monkeypatch.setattr(kr, "get_stock_quotes_bulk", lambda codes: {"005380": quote("005380", 2.88, 90)})
    assert kr.get_map_quotes("kospi", ["005380"])["005380"]["change_pct"] == 3.60
    clock[0] = 115
    def failed(codes):
        raise RuntimeError("fixture outage")
    monkeypatch.setattr(kr, "get_stock_quotes_bulk", failed)
    assert kr.get_map_quotes("kospi", ["005380"])["005380"]["change_pct"] == 3.60


def test_concurrent_entries_share_one_quote_fetch(monkeypatch, clock):
    calls = []
    started, release = threading.Event(), threading.Event()
    def upstream(codes):
        calls.append(codes)
        started.set()
        assert release.wait(2)
        return {c: quote(c, 3.60, 100) for c in codes}
    monkeypatch.setattr(kr, "get_stock_quotes_bulk", upstream)
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(kr.get_map_quotes, "kospi", ["005380"]) for _ in range(4)]
        assert started.wait(2)
        release.set()
        assert all(f.result()["005380"]["change_pct"] == 3.60 for f in futures)
    assert len(calls) == 1


@pytest.mark.parametrize("index", ["sp500", "nasdaq100"])
@pytest.mark.parametrize("session", ["pre", "post"])
def test_us_expired_overlay_returns_new_session_on_first_request(monkeypatch, clock, index, session):
    roster = [{"code": "AAPL", "close": 100, "change_pct": 2.88}]
    monkeypatch.setattr(us, "_fetch_slickcharts", lambda index: roster)
    monkeypatch.setattr(us, "_with_sector", lambda rows: rows)
    monkeypatch.setattr(us.yahoo_bulk_quote, "get_quotes", lambda codes: {
        "AAPL": {**quote("AAPL", 2.88 if clock[0] < 104 else 3.60, clock[0]),
                 "session": "regular" if clock[0] < 104 else session}
    })
    assert us._constituents(index, False)[0]["session"] == "regular"
    clock[0] = 105
    result = us._constituents(index, False)[0]
    assert result["change_pct"] == 3.60
    assert result["session"] == session
