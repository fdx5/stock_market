"""Editorial contracts, entirely in memory or new pytest temporary directories."""
import datetime as dt
import json
import threading

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.data import editorial_sources as source
from app.routers.editorial import router
from app.services import editorial as service

real_ensure = service.ensure


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    monkeypatch.setattr(service, "DATA_DIR", tmp_path / "new-editorial-store")
    for name, value in (("_snapshots", {}), ("_running", set()), ("_attempted", {}), ("_loaded", set())):
        monkeypatch.setattr(service, name, value)
    monkeypatch.setattr(service, "ensure", lambda _kind: None)
    monkeypatch.setattr(service.us_live_quotes, "recover_missing", lambda _codes: None)
    monkeypatch.setattr(service.us_live_quotes, "latest", lambda _codes: {})


@pytest.mark.parametrize("hour,edition", [(7, "2026-10-19"), (8, "2026-10-20"), (23, "2026-10-20")])
def test_cutoff_uses_latest_eight_am_and_calendar_previous_day(hour, edition):
    start, end = source.edition_window(dt.datetime(2026, 10, 20, hour, tzinfo=source.KST))
    assert end.date().isoformat() == edition
    assert start.hour == 0 and end.hour == 8
    assert end - start == dt.timedelta(hours=32)


def video(identifier="abcdefghijk", **changes):
    return {"id": identifier, "title": "나스닥 미국주식 시황", "views": 100,
            "published_at": "2026-10-19T09:00:00+09:00", **changes}


def test_video_ranking_deduplicates_and_limits_to_twenty():
    start, end = source.edition_window(dt.datetime(2026, 10, 20, 10, tzinfo=source.KST))
    rows = [video(f"{i:011d}", views=i) for i in range(25)]
    rows += [video("00000000024", views=99)]
    ranked = source.rank_videos(rows, "us", start, end)
    assert len(ranked) == 20
    assert ranked[0]["views"] == 99
    assert [row["rank"] for row in ranked] == list(range(1, 21))
    assert len({row["id"] for row in ranked}) == 20


@pytest.mark.parametrize("changes", [
    {"published_at": "2026-10-19"}, {"published_at": "2026-10-18T23:59:59+09:00"},
    {"published_at": "2026-10-20T08:00:00+09:00"}, {"title": "코스피 국내주식 시황"},
    {"title": "NASDAQ stock news"}, {"views": "100"}, {"views": -1},
    {"id": "../../invalid"}, {"title": "나스닥 원금보장 텔레그램"},
])
def test_video_rejects_unverified_dates_wrong_market_and_invalid_counts(changes):
    start, end = source.edition_window(dt.datetime(2026, 10, 20, 10, tzinfo=source.KST))
    assert source.rank_videos([video(**changes)], "us", start, end) == []


def test_domestic_and_global_feeds_are_separate():
    start, end = source.edition_window(dt.datetime(2026, 10, 20, 10, tzinfo=source.KST))
    rows = [video(), video("12345678901", title="코스피 국내주식 시황")]
    assert [r["id"] for r in source.rank_videos(rows, "kr", start, end)] == ["12345678901"]
    assert [r["id"] for r in source.rank_videos(rows, "us", start, end)] == ["abcdefghijk"]


def test_public_watch_parser_uses_exact_views_and_publication_time():
    player = {"videoDetails": {"videoId": "abcdefghijk", "title": "나스닥", "author": "채널", "viewCount": "123456", "lengthSeconds": "610"},
              "microformat": {"playerMicroformatRenderer": {"publishDate": "2026-10-19T09:00:00+09:00"}}}
    document = "var ytInitialPlayerResponse = " + json.dumps(player) + "; otherJavaScript();"
    parsed = source.parse_watch_page(document, "abcdefghijk")
    assert parsed["views"] == 123456 and parsed["duration_seconds"] == 610
    assert source.parse_watch_page(document, "notthesame1") is None
    player["microformat"]["playerMicroformatRenderer"]["liveBroadcastDetails"] = {"isLiveNow": True}
    assert source.parse_watch_page("ytInitialPlayerResponse = " + json.dumps(player), "abcdefghijk") is None


def test_portfolio_reports_reference_price_never_invents_purchase_cost():
    document = '''<div id="p2"><span>Q2 2026</span><span>30 Jun 2026</span><span>1</span><span>$1,000</span></div>
    <table id="grid"><tbody><tr><td></td><td class="stock"><a href="/m/stock.php?sym=AAPL">AAPL - Apple</a></td>
    <td>100%</td><td>Add 5.00%</td><td>10</td><td>$100</td><td>$1,000</td><td></td><td>$120</td></tr></tbody></table>'''
    result = source.parse_portfolio(document, source.INVESTORS[0])
    row = result["holdings"][0]
    assert result["report_date"] == "2026-06-30"
    assert row["reference_price"] == 100 and row["purchase_price"] is None
    assert row["activity"] == "add" and row["shares_change_pct"] == 5
    assert row["snapshot_price"] == 120


def test_ark_daily_holdings_keep_fund_weights_and_exclude_private_tickers():
    csv = ('date,fund,company,ticker,cusip,shares,market value ($),weight (%)\n'
           '10/19/2026,ARKK,Tesla,TSLA,88160R101,10,$1200,60%\n'
           '10/19/2026,ARKK,Private Company,,PRIVATE,8,$800,40%\n')
    result = source.parse_ark_holdings(csv, {"id": "wood"})
    assert result["data_basis"] == "daily_fund" and result["report_date"] == "2026-10-19"
    assert result["reported_value"] == 2000
    assert len(result["holdings"]) == 1
    row = result["holdings"][0]
    assert row["weight_pct"] == 60 and row["reference_price"] == 120
    assert row["activity"] == "unavailable" and row["purchase_price"] is None


def test_immutable_snapshots_preserve_every_saved_edition():
    first = {"edition": "2026-10-19", "items": [video()]}
    service._save("videos-us", first)
    old_file = next(service.DATA_DIR.glob("*.json"))
    old_bytes = old_file.read_bytes()
    second = {"edition": "2026-10-20", "items": [video(views=200)]}
    service._save("videos-us", second)
    assert len(list(service.DATA_DIR.glob("*.json"))) == 2
    assert old_file.read_bytes() == old_bytes
    service._load("videos-us")
    assert service._snapshots["videos-us"] == second


def test_failed_refresh_keeps_previous_saved_and_memory_edition(monkeypatch):
    previous = {"edition": "2026-10-19", "items": [video()]}
    service._snapshots["videos-us"] = previous
    service._running.add("videos-us")
    monkeypatch.setattr(source, "fetch_videos", lambda _: (_ for _ in ()).throw(RuntimeError("fixture failure")))
    service._refresh("videos-us")
    assert service._snapshots["videos-us"] == previous
    assert "videos-us" not in service._running
    assert not service.DATA_DIR.exists()


def holding(code, **changes):
    return {"code": code, "name": code, "weight_pct": 50, "activity": "hold", "shares": 10,
            "reference_price": 100, "purchase_price": None, "snapshot_price": 120, **changes}


def seed_portfolios():
    _, cutoff = source.edition_window()
    edition = cutoff.date().isoformat()
    service._snapshots["investors"] = {"edition": edition, "items": [
        {"id": "buffett", "period": "Q2 2026", "report_date": "2026-06-30", "holdings": [holding("AAPL"), holding("MSFT")]},
        {"id": "ackman", "period": "Q2 2026", "report_date": "2026-06-30", "holdings": [holding("AAPL")]},
        {"id": "tepper", "period": "Q1 2026", "report_date": "2026-03-31", "holdings": [holding("AAPL")]},
    ]}


def test_consensus_never_mixes_different_quarters():
    seed_portfolios()
    result = service.get_investors()
    assert result["consensus_period"] == "Q2 2026"
    assert result["consensus"][0]["investors"] == ["buffett", "ackman"]
    assert result["available_count"] == 3


def test_daily_fund_never_displaces_quarterly_consensus(monkeypatch):
    seed_portfolios()
    service._snapshots["investors"]["items"].append({"id": "wood", "data_basis": "daily_fund", "period": "ARKK", "report_date": "2026-10-19", "holdings": [holding("AAPL")]})
    result = service.get_investors()
    assert result["consensus_period"] == "Q2 2026"
    assert result["consensus"][0]["investors"] == ["buffett", "ackman"]


def test_partial_source_failure_preserves_old_holdings_and_retries_only_missing_profiles(monkeypatch):
    _, cutoff = source.edition_window()
    edition = cutoff.date().isoformat()
    monkeypatch.setattr(source, "INVESTORS", source.INVESTORS[:2])
    previous = {"items": [{"id": "buffett", "edition": edition, "holdings": [holding("AAPL")]},
                          {"id": "ackman", "edition": "old", "holdings": [holding("MSFT")]}]}
    calls = []
    def fail(profile):
        calls.append(profile["id"])
        raise RuntimeError("unavailable")
    monkeypatch.setattr(source, "fetch_portfolio", fail)
    with pytest.raises(RuntimeError):
        service._collect_investors(previous)
    assert calls == ["ackman"]
    assert previous["items"][1]["holdings"][0]["code"] == "MSFT"
    monkeypatch.setattr(source, "fetch_portfolio", lambda profile: {"id": profile["id"], "holdings": [holding("GOOG")]})
    result = service._collect_investors(previous)
    assert result["complete"] and result["items"][0]["holdings"][0]["code"] == "AAPL"
    assert result["items"][1]["holdings"][0]["code"] == "GOOG"


def test_live_quotes_update_returns_and_estimated_current_weights(monkeypatch):
    seed_portfolios()
    monkeypatch.setattr(service.us_live_quotes, "latest", lambda _: {"AAPL": {"close": 180, "quote_time": 123, "quote_source": "test"}})
    result = service.get_portfolio("buffett")
    assert result["valuation_complete"] and not result["stale"]
    assert result["holdings"][0]["current_weight_pct"] == 60
    assert result["holdings"][0]["reference_return_pct"] == 80
    assert result["holdings"][0]["quote_time"] == 123
    assert result["purchase_price_disclosed"] is False


def test_incomplete_prices_do_not_produce_misleading_partial_weights():
    seed_portfolios()
    service._snapshots["investors"]["items"][0]["holdings"][1]["snapshot_price"] = None
    result = service.get_portfolio("buffett")
    assert result["valuation_complete"] is False
    assert result["estimated_equity_value"] is None
    assert all(row["current_weight_pct"] is None for row in result["holdings"])


def test_router_validates_market_and_investor_and_disables_cache():
    app = FastAPI()
    app.include_router(router, prefix="/api/editorial")
    client = TestClient(app)
    assert client.get("/api/editorial/videos?market=eu").status_code == 422
    response = client.get("/api/editorial/videos?market=us")
    assert response.status_code == 200 and response.json()["market"] == "us"
    assert response.headers["cache-control"] == "no-store"
    assert client.get("/api/editorial/investors/unknown").status_code == 404
    assert client.get("/api/editorial/investors").status_code == 200


def test_scheduling_is_single_flight_and_retries_after_failure(monkeypatch):
    # Exercise the real scheduler entry, but do not execute threads or any source.
    calls = []
    class FakeThread:
        def __init__(self, **kwargs): calls.append(kwargs)
        def start(self): pass
    monkeypatch.setattr(service, "_loaded", set(service.KINDS))
    monkeypatch.setattr(service, "_snapshots", {})
    monkeypatch.setattr(service, "_running", set())
    monkeypatch.setattr(service, "_attempted", {})
    monkeypatch.setattr(threading, "Thread", FakeThread)
    real_ensure("videos-us"); real_ensure("videos-us")
    assert len(calls) == 1
    service._running.clear()
    real_ensure("videos-us")
    assert len(calls) == 1
    service._attempted["videos-us"] -= 901
    real_ensure("videos-us")
    assert len(calls) == 2
