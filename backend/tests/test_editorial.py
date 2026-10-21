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
    monkeypatch.setattr(service, "SEED_DIR", tmp_path / "new-seed-store")
    monkeypatch.setattr(service, "BUNDLED_DIR", tmp_path / "new-bundled-store")
    for name, value in (("_snapshots", {}), ("_running", set()), ("_attempted", {}), ("_loaded", set()),
                        ("_attempted_editions", {}), ("_failures", {})):
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


def test_first_deployment_loads_verified_public_seed_without_creating_saved_files():
    service.SEED_DIR.mkdir()
    seed = {"edition": "2026-10-20", "items": [video()]}
    (service.SEED_DIR / "videos-us.json").write_text(json.dumps(seed), encoding="utf-8")
    service._load("videos-us")
    assert service._snapshots["videos-us"] == seed
    assert not service.DATA_DIR.exists()


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
    service._attempted["videos-us"] -= 61
    real_ensure("videos-us")
    assert len(calls) == 2


def test_eight_am_edition_is_not_throttled_by_previous_edition_attempt(monkeypatch):
    clock = [dt.datetime(2026, 10, 21, 7, 59, tzinfo=source.KST)]
    video_window = source.video_edition_window
    monkeypatch.setattr(source, "video_edition_window", lambda: video_window(clock[0]))
    calls = []
    class FakeThread:
        def __init__(self, **kwargs): calls.append(kwargs)
        def start(self): pass
    monkeypatch.setattr(threading, "Thread", FakeThread)
    real_ensure("videos-kr")
    service._running.clear()
    clock[0] = clock[0].replace(hour=8, minute=0)
    real_ensure("videos-kr")
    assert len(calls) == 2


def test_newer_bundle_wins_over_older_runtime_without_changing_files():
    service._save("videos-kr", {"edition": "2026-10-19", "items": [video()]})
    old_file = next(service.DATA_DIR.glob("*.json"))
    before = old_file.read_bytes()
    service.BUNDLED_DIR.mkdir()
    (service.BUNDLED_DIR / "videos-kr-2026-10-21.json").write_text(
        json.dumps({"edition": "2026-10-21", "items": [video(views=200)]}), encoding="utf-8")
    service._load("videos-kr")
    assert service._snapshots["videos-kr"]["edition"] == "2026-10-21"
    assert old_file.read_bytes() == before


def collector_payload():
    start, cutoff = source.video_edition_window()
    return {"market": "us", "edition": cutoff.date().isoformat(),
            "window_start": start.isoformat(), "window_end": cutoff.isoformat(),
            "collected_at": dt.datetime.now(source.UTC).isoformat(), "candidate_count": 1,
            "items": [video(channel="Public channel", published_at=(start + dt.timedelta(hours=1)).isoformat())]}


def test_collector_requires_auth_and_saves_only_append_only_public_rows(monkeypatch):
    monkeypatch.setenv("EDITORIAL_REFRESH_TOKEN", "test-only-collector-token")
    app = FastAPI()
    app.include_router(router, prefix="/api/editorial")
    client = TestClient(app)
    payload = collector_payload()
    url = "/api/editorial/videos/edition"
    assert client.post(url, json=payload).status_code == 401
    headers = {"Authorization": "Bearer test-only-collector-token"}
    result = client.post(url, json=payload, headers=headers)
    assert result.status_code == 200 and result.json()["status"] == "saved"
    files = list(service.DATA_DIR.glob("*.json"))
    before = files[0].read_bytes()
    assert client.post(url, json=payload, headers=headers).json()["status"] == "already_current"
    assert len(list(service.DATA_DIR.glob("*.json"))) == 1
    assert files[0].read_bytes() == before
    saved = json.loads(before)
    assert saved["items"][0]["url"] == "https://www.youtube.com/watch?v=abcdefghijk"
    assert saved["items"][0]["rank"] == 1


def test_collector_rejects_old_edition_and_wrong_publication_window():
    payload = collector_payload()
    payload["edition"] = "2020-01-01"
    with pytest.raises(ValueError): service.accept_video_edition("us", payload)
    payload = collector_payload()
    payload["items"][0]["published_at"] = "2020-01-01T00:00:00Z"
    with pytest.raises(ValueError): service.accept_video_edition("us", payload)
    assert not service.DATA_DIR.exists()


def test_archive_recovery_validates_window_and_canonicalizes_video_urls(monkeypatch):
    payload = collector_payload()
    payload["items"][0]["url"] = "https://untrusted.invalid/"
    class Response:
        def json(self): return payload
    monkeypatch.setattr(source, "_request", lambda _url: Response())
    result = source.archived_videos("us")
    assert result["items"][0]["url"] == "https://www.youtube.com/watch?v=abcdefghijk"
    assert result["source"] == "youtube_collector_archive"
    assert source.fetch_videos("us") == result
    payload["edition"] = "2020-01-01"
    assert source.archived_videos("us") is None


def test_public_rss_recovers_exact_metadata_without_relative_date_guesses():
    document = '''<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
    <entry><yt:videoId>abcdefghijk</yt:videoId><title>나스닥 미국주식 시황</title><author><name>Public channel</name></author>
    <published>2026-10-20T12:30:00Z</published><media:group><media:community><media:statistics views="123456"/></media:community></media:group></entry></feed>'''
    candidates = {"abcdefghijk": {"rss_eligible": True, "duration_seconds": 610}}
    rows = source.parse_video_feed(document, candidates)
    assert len(rows) == 1 and rows[0]["views"] == 123456
    assert rows[0]["published_at"] == "2026-10-20T12:30:00Z"
    candidates["abcdefghijk"]["rss_eligible"] = False
    assert source.parse_video_feed(document, candidates) == []


@pytest.mark.parametrize("moment,start,end", [
    ("2026-10-21T07:59:59+09:00", "2026-10-20T00:00:00+09:00", "2026-10-20T16:00:00+09:00"),
    ("2026-10-21T08:00:00+09:00", "2026-10-20T00:00:00+09:00", "2026-10-21T08:00:00+09:00"),
    ("2026-10-21T15:59:59+09:00", "2026-10-20T00:00:00+09:00", "2026-10-21T08:00:00+09:00"),
    ("2026-10-21T16:00:00+09:00", "2026-10-21T00:00:00+09:00", "2026-10-21T16:00:00+09:00"),
    ("2026-11-01T00:00:00+09:00", "2026-10-31T00:00:00+09:00", "2026-10-31T16:00:00+09:00"),
    ("2027-01-01T07:00:00Z", "2027-01-01T00:00:00+09:00", "2027-01-01T16:00:00+09:00"),
])
def test_video_slots_include_weekends_and_month_year_boundaries(moment, start, end):
    actual = source.video_edition_window(dt.datetime.fromisoformat(moment))
    assert tuple(t.isoformat() for t in actual) == (start, end)


@pytest.mark.parametrize("market,title", [("kr", "코스피 국내주식 시황"), ("us", "나스닥 미국주식 시황")])
def test_afternoon_ranking_excludes_yesterday_and_cutoff_and_orders_by_cumulative_views(market, title):
    start, end = source.video_edition_window(dt.datetime(2026, 10, 21, 16, tzinfo=source.KST))
    rows = [video("00000000001", title=title, published_at="2026-10-20T23:59:59+09:00", views=99999),
            video("00000000002", title=title, published_at=start.isoformat(), views=200),
            video("00000000003", title=title, published_at="2026-10-21T15:59:59+09:00", views=500),
            video("00000000004", title=title, published_at=end.isoformat(), views=88888)]
    assert [r["id"] for r in source.rank_videos(rows, market, start, end)] == ["00000000003", "00000000002"]


def test_afternoon_triggers_despite_successful_morning_and_recent_failed_attempt(monkeypatch):
    clock = [dt.datetime(2026, 10, 21, 15, 59, 59, tzinfo=source.KST)]
    window = source.video_edition_window
    monkeypatch.setattr(source, "video_edition_window", lambda: window(clock[0]))
    calls = []
    class FakeThread:
        def __init__(self, **kwargs): calls.append(kwargs)
        def start(self): pass
    monkeypatch.setattr(threading, "Thread", FakeThread)
    monkeypatch.setattr(service, "_loaded", set(service.KINDS))
    morning_end = window(clock[0])[1].isoformat()
    service._snapshots["videos-kr"] = {"edition": "2026-10-21", "window_end": morning_end, "items": [video()]}
    real_ensure("videos-kr")
    assert not calls
    service._attempted["videos-kr"] = service.time.monotonic()
    service._attempted_editions["videos-kr"] = morning_end
    clock[0] = clock[0].replace(hour=16, minute=0, second=0)
    assert service._status("videos-kr", service._snapshots["videos-kr"])["stale"]
    real_ensure("videos-kr"); real_ensure("videos-kr")
    assert len(calls) == 1
    assert service._status("videos-kr", None)["next_update_at"] == "2026-10-22T08:00:00+09:00"


def test_morning_next_update_is_afternoon_but_investors_stay_daily(monkeypatch):
    morning = dt.datetime(2026, 10, 21, 8, tzinfo=source.KST)
    monkeypatch.setattr(source, "video_edition_window", lambda: (morning - dt.timedelta(hours=32), morning))
    monkeypatch.setattr(source, "edition_window", lambda: (morning - dt.timedelta(hours=32), morning))
    assert service._status("videos-us", None)["next_update_at"] == "2026-10-21T16:00:00+09:00"
    assert service._status("investors", None)["next_update_at"] == "2026-10-22T08:00:00+09:00"


def test_afternoon_archive_cannot_restore_morning_and_uses_separate_path(monkeypatch):
    now = dt.datetime(2026, 10, 21, 17, tzinfo=source.KST)
    start, end = source.video_edition_window(now)
    payload = {"market": "us", "edition": "2026-10-21", "window_start": start.isoformat(),
               "window_end": end.isoformat(), "collected_at": now.isoformat(),
               "items": [video(published_at=start.isoformat())]}
    urls = []
    class Response:
        def json(self): return payload
    def request(url):
        urls.append(url)
        return Response()
    monkeypatch.setattr(source, "_request", request)
    assert source.archived_videos("us", now)["window_end"] == end.isoformat()
    assert urls[-1].endswith("editions/2026-10-21/16/videos-us.json")
    assert source.video_archive_path("us", end.replace(hour=8)) == "editions/2026-10-21/videos-us.json"
    payload["window_end"] = end.replace(hour=8).isoformat()
    assert source.archived_videos("us", now) is None


def test_restart_prefers_afternoon_over_late_morning_file_without_changing_history():
    afternoon = {"edition": "2026-10-21", "window_end": "2026-10-21T16:00:00+09:00",
                 "collected_at": "2026-10-21T16:01:00+09:00", "items": [video()]}
    morning = {"edition": "2026-10-21", "window_end": "2026-10-21T08:00:00+09:00",
               "collected_at": "2026-10-21T18:00:00+09:00", "items": [video(views=10)]}
    service._save("videos-us", afternoon)
    service._save("videos-us", morning)
    before = {p.name: p.read_bytes() for p in service.DATA_DIR.glob("*.json")}
    service._load("videos-us")
    assert service._snapshots["videos-us"] == afternoon
    assert {p.name: p.read_bytes() for p in service.DATA_DIR.glob("*.json")} == before


def test_collector_rejects_wrong_slot_even_when_today_videos_match():
    payload = collector_payload()
    payload["window_end"] = "2020-01-01T08:00:00+09:00"
    with pytest.raises(ValueError, match="slot"):
        service.accept_video_edition("us", payload)
    assert not service.DATA_DIR.exists()


def test_partial_collector_retry_cannot_displace_fuller_verified_list_or_restart_recovery():
    payload = collector_payload()
    fuller = {**payload, "items": [video(f"{i:011d}", published_at=payload["window_start"]) for i in range(20)]}
    service._save("videos-us", fuller)
    service._snapshots["videos-us"] = fuller
    # The incomplete copy was collected later by another network.
    payload["collected_at"] = (dt.datetime.now(source.UTC) + dt.timedelta(seconds=1)).isoformat()
    assert service.accept_video_edition("us", payload)["status"] == "already_current"
    assert service._snapshots["videos-us"] == fuller
    service._save("videos-us", payload)
    service._snapshots.clear(); service._loaded.clear()
    service._load("videos-us")
    assert service._snapshots["videos-us"] == fuller
