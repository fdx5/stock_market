"""New RAM caches and public feed fixtures only; no app startup or database."""
import datetime as dt
from zoneinfo import ZoneInfo

import pytest

from app.services import nasdaq_futures as feed
from app.services.cache import TTLCache

ET = ZoneInfo("America/New_York")


def bar(date, clock, close):
    stamp = dt.datetime.fromisoformat(f"{date}T{clock}").replace(tzinfo=ET).timestamp()
    return {"quote_time": int(stamp), "close": close, "quote_source": "fixture"}


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setattr(feed, "cache", TTLCache())
    monkeypatch.setattr(feed, "_last_good", {})
    monkeypatch.setattr(feed, "_history", lambda: [bar("2026-11-13", "15:55", 100),
                        bar("2026-11-16", "09:25", 102), bar("2026-11-16", "15:55", 105)])
    monkeypatch.setattr(feed.market_ticker_fetcher, "get_market_ticker", lambda: [{"symbol": "NQ=F", "price": 110,
                         "quote_time": bar("2026-11-16", "20:00", 110)["quote_time"]}])


def test_day_and_night_are_distinct_windows_of_same_contract():
    row = feed.get_quotes()
    assert row["day"]["close"] == 105 and row["day"]["change_pct"] == 5
    assert row["night"]["close"] == 110 and row["night"]["change_pct"] == 4.76
    assert row["day"]["symbol"] == row["night"]["symbol"] == "NQ=F"
    assert row["day"]["quote_time"] < row["night"]["quote_time"]


def test_during_regular_hours_night_keeps_preopen_print(monkeypatch):
    stamp = bar("2026-11-16", "11:00", 106)["quote_time"]
    monkeypatch.setattr(feed.market_ticker_fetcher, "get_market_ticker", lambda: [{"symbol": "NQ=F", "price": 106, "quote_time": stamp}])
    monkeypatch.setattr(feed, "_history", lambda: [bar("2026-11-13", "15:55", 100), bar("2026-11-16", "09:25", 102)])
    row = feed.get_quotes()
    assert row["day"]["close"] == 106 and row["day"]["change_pct"] == 6
    assert row["night"]["close"] == 102 and row["night"]["change_pct"] == 2


@pytest.mark.parametrize("date,clock,window", [("2026-07-10", "09:29", "night"), ("2026-07-10", "09:30", "day"),
    ("2026-07-10", "15:59", "day"), ("2026-07-10", "16:00", "night"), ("2026-11-16", "09:30", "day")])
def test_boundaries_handle_summer_and_winter_time(date, clock, window):
    assert feed._window(bar(date, clock, 100)["quote_time"]) == window


def test_old_or_failed_responses_do_not_rewind_either_window(monkeypatch):
    old = feed.get_quotes()
    monkeypatch.setattr(feed.market_ticker_fetcher, "get_market_ticker", lambda: [])
    def failed(): raise RuntimeError("feed down")
    monkeypatch.setattr(feed, "_history", failed)
    monkeypatch.setattr(feed, "cache", TTLCache())
    row = feed._refresh()
    for window in ("day", "night"):
        assert row[window]["close"] == old[window]["close"]
        assert row[window]["quote_time"] == old[window]["quote_time"]
        assert row[window]["stale"] is True


def test_missing_baseline_is_unknown_instead_of_fake_zero_percent():
    row = feed._split([bar("2026-11-16", "20:00", 110)])
    assert row["night"]["change_pct"] is None


def test_history_outage_keeps_new_price_without_reusing_a_past_sessions_baseline(monkeypatch):
    old = feed.get_quotes()
    monkeypatch.setattr(feed, "cache", TTLCache())
    def failed(): raise RuntimeError("history down")
    monkeypatch.setattr(feed, "_history", failed)
    monkeypatch.setattr(feed.market_ticker_fetcher, "get_market_ticker", lambda: [{"symbol": "NQ=F", "price": 120,
                         "quote_time": bar("2026-11-17", "20:00", 120)["quote_time"]}])
    row = feed.get_quotes()
    assert row["day"]["quote_time"] == old["day"]["quote_time"]
    assert row["night"]["close"] == 120 and row["night"]["stale"] is True
    assert row["night"]["change_pct"] is None


def test_history_is_cached_across_ten_second_live_refreshes(monkeypatch):
    now = [100.0]
    monkeypatch.setattr("app.services.cache.time.time", lambda: now[0])
    calls = []
    def history():
        calls.append(1)
        return [bar("2026-11-13", "15:55", 100), bar("2026-11-16", "15:55", 105)]
    monkeypatch.setattr(feed, "_history", history)
    feed.get_quotes()
    now[0] += 11
    feed.get_quotes()
    assert calls == [1]
