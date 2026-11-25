"""Published market payloads and in-memory fixtures only."""
import datetime as dt

import pytest
from fastapi import Response

from app.data import global_index_fetcher as feed
from app.routers import world_markets as world
from app.services.cache import TTLCache


STAMP = int(dt.datetime.fromisoformat("2026-11-25T11:34:00+08:00").timestamp())


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setattr(feed, "cache", TTLCache())
    monkeypatch.setattr(feed, "_last_good", {})
    monkeypatch.setattr(feed.time, "time", lambda: STAMP + 10)
    monkeypatch.setattr(feed, "_history", lambda _: [{"date": "2026-11-24", "close": 40122.35}])


def twse(monkeypatch, **overrides):
    tick = {"ch": "t00.tw", "ex": "tse", "z": "38010.99", "y": "40122.35",
            "d": "20261125", "tlong": str(STAMP * 1000), **overrides}

    class Reply:
        def raise_for_status(self): pass
        def json(self): return {"rtcode": "0000", "msgArray": [tick]}

    monkeypatch.setattr(feed.requests, "get", lambda *a, **kw: Reply())


def test_twse_uses_exchange_timestamp_and_previous_close(monkeypatch):
    twse(monkeypatch)
    monkeypatch.setattr(feed, "_chart", lambda *a: pytest.fail("Unexpected fallback"))
    row = feed.get_index("^TWII")
    assert (row["quote_source"], row["quote_time"], row["close"]) == ("twse_mis", STAMP, 38010.99)
    assert row["change"] == -2111.36 and row["change_pct"] == -5.26 and not row["stale"]
    assert row["points"][-1] == {"date": "2026-11-25", "close": 38010.99}


@pytest.mark.parametrize("replacement", [{"ch": "other.tw"}, {"z": "-"}, {"d": "20261124"},
                                         {"y": "NaN"}, {"tlong": str((STAMP + 3600) * 1000)}])
def test_invalid_primary_uses_alternate(monkeypatch, replacement):
    twse(monkeypatch, **replacement)
    monkeypatch.setattr(feed, "_chart", lambda *a: {"meta": {"regularMarketPrice": 105, "previousClose": 100,
                        "regularMarketTime": STAMP - 1000, "exchangeTimezoneName": "Asia/Taipei"}})
    row = feed.get_index("^TWII")
    assert (row["quote_source"], row["quote_time"], row["change_pct"]) == ("yahoo_chart", STAMP - 1000, 5)


def test_resume_after_an_old_alternate_and_a_failed_refresh(monkeypatch):
    twse(monkeypatch)
    feed.get_index("^TWII")
    twse(monkeypatch, z="-")
    monkeypatch.setattr(feed, "_chart", lambda *a: {"meta": {"regularMarketPrice": 105, "previousClose": 100,
                        "regularMarketTime": STAMP - 1000, "exchangeTimezoneName": "Asia/Taipei"}})
    held = feed._refresh("^TWII")
    assert held["stale"] and held["quote_time"] == STAMP and held["quote_source"] == "twse_mis"
    twse(monkeypatch, tlong=str((STAMP + 5) * 1000))
    assert feed._refresh("^TWII")["stale"] is False


def test_newer_daily_session_beats_older_print_without_inventing_change(monkeypatch):
    twse(monkeypatch)
    monkeypatch.setattr(feed, "_history", lambda _: [{"date": "2026-11-26", "close": 110}])
    row = feed.get_index("^TWII")
    assert row["close"] == 110 and row["change_pct"] is None and row["quote_time"] is None
    assert row["quote_source"] == "daily_history" and row["stale"]


@pytest.mark.parametrize("symbol,code", feed.DOMESTIC.items())
def test_domestic_feed_uses_market_time(monkeypatch, symbol, code):
    monkeypatch.setattr(feed.index_fetcher, "get_index", lambda *a, **kw: {
        "symbol": code, "close": 95, "change": -5, "updated_at": "2026-11-25T12:34:00+09:00", "market_status": "OPEN"})
    row = feed._refresh(symbol)
    assert row["quote_source"] == "naver_index" and row["change_pct"] == -5 and row["quote_time"] == STAMP


def test_single_failure_isolated_and_compact_snapshot_tracks_history_corrections(monkeypatch):
    def read(code):
        if code == "HSI":
            raise RuntimeError()
        return {"points": [{"date": "2026-11-24", "close": 110}, {"date": "2026-11-25", "close": 115}]}
    monkeypatch.setattr(world, "get_index", read)
    rows = world._quotes()
    monkeypatch.setattr(world, "_snapshot", lambda: rows)
    response = Response()
    full = world.board(response)
    assert "no-store" in response.headers["cache-control"]
    assert len(rows) == 17 and rows["HSI"]["stale"] and not full["compact"]
    rows["^TWII"]["points"][-1]["close"] += 1
    tail = world.board(response, full["history"])
    assert tail["compact"] and tail["quotes"]["HSI"]["points"] == []
    assert tail["quotes"]["^TWII"]["points"] == [{"date": "2026-11-25", "close": 116}]
    rows["^TWII"]["points"][0]["close"] += 1
    assert not world.board(response, full["history"])["compact"]
