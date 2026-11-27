import datetime as dt
from zoneinfo import ZoneInfo

from app.services import naver_social_content as content
from app.services import naver_social_publisher as pub

KST = ZoneInfo("Asia/Seoul")


def at(y, m, d, hh, mm):
    return dt.datetime(y, m, d, hh, mm, tzinfo=KST)


def test_every_sns_edition_has_a_blog_twin():
    from app.services import ops_timeline

    assert {e for e, *_ in ops_timeline.SNS} == set(content.EDITIONS)
    for edition, (hhmm, *_rest) in content.EDITIONS.items():
        sns = next(t for e, t, *_ in ops_timeline.SNS if e == edition)
        assert hhmm == sns or (edition in ("morning", "evening")), edition


def test_due_follows_sns_time_and_window():
    # Friday 2026-11-27 (KRX open; US half day is still a session).
    assert (dt.date(2026, 11, 27), "movers_open") not in pub.due(at(2026, 11, 27, 9, 29))
    assert (dt.date(2026, 11, 27), "movers_open") in pub.due(at(2026, 11, 27, 9, 30))
    assert (dt.date(2026, 11, 27), "movers_open") not in pub.due(at(2026, 11, 27, 12, 31))
    assert (dt.date(2026, 11, 27), "close") in pub.due(at(2026, 11, 27, 21, 59))


def test_market_rules():
    # Thanksgiving 2026-11-26: no US session, so the US editions that cover it are off.
    assert not pub.applies(dt.date(2026, 11, 26), "us_movers_pre")      # 21:10 KST covers 11/26 US
    assert not pub.applies(dt.date(2026, 11, 27), "us_movers_open")     # 00:50 KST covers 11/26 US
    assert not pub.applies(dt.date(2026, 11, 27), "nasdaq_close")       # 07:00 KST after 11/26 US
    assert pub.applies(dt.date(2026, 11, 26), "nasdaq_close")           # after 11/25 US
    # Saturday: KRX editions off, world scoreboards and hot issues on.
    sat = dt.date(2026, 11, 28)
    assert not pub.applies(sat, "close") and pub.applies(sat, "world_morning") and pub.applies(sat, "morning")


def test_links_carry_the_campaign():
    url = content.link("/map", dt.date(2026, 11, 26), "close", "#s1")
    assert url.startswith("https://kospimap.com/map?utm_source=naver_blog&utm_medium=blog")
    assert "utm_campaign=nb_close-20261126" in url and url.endswith("#s1")


def test_tags_are_clean_and_capped():
    tags = content.clean_tags(["#코스피", "코스피", "S&P 500", "x", "AI 반도체 쇼크", "1234"] + [f"태그{i}" for i in range(30)], 10)
    assert tags[:3] == ["코스피", "SP500", "AI반도체쇼크"] and len(tags) == 10


def test_recovery_uses_archived_editions_and_prioritizes_current_slots():
    friday = dt.date(2026, 11, 27)
    saturday = dt.date(2026, 11, 28)
    recoverable = pub.due(at(2026, 11, 28, 7, 16), recover=True)
    assert recoverable.index((saturday, "morning")) < recoverable.index((friday, "evening"))
    assert (saturday, "us_movers_open") in recoverable
    assert (friday, "movers_close") in recoverable
    assert (friday, "close") not in recoverable
    assert (friday, "world_evening") not in recoverable
    assert (friday, "evening") not in pub.due(at(2026, 11, 28, 13, 15), recover=True)


def test_queue_records_missed_windows_and_preserves_worker_results(monkeypatch, tmp_path):
    store = pub.store
    monkeypatch.setattr(store, "TURSO_DATABASE_URL", None)
    monkeypatch.setattr(store, "LOCAL_DB_PATH", tmp_path / "queue.db")
    monkeypatch.setattr(store, "_conn", None)
    store.enqueue("2026-11-27", "close", content.CAT_MAPS)
    assert store.claim("2026-11-27:close")
    store.release("2026-11-27:close", "source unavailable", refund=True)
    store.enqueue("2026-11-27", "movers_close", content.CAT_MOVERS)
    store.mark_published("2026-11-27:movers_close", log_no="123456", post_url="https://example.com/123456",
                         title="title", tags=[], variant="A", campaign="campaign", category_seen=9, chars=10, images=0)

    now = at(2026, 11, 28, 6, 30)
    queued, missed = pub.reconcile_schedule(now)
    assert queued > 0 and missed > 0
    assert store.get("2026-11-27:close")["last_error"] == "source unavailable"
    assert store.get("2026-11-27:world_evening")["status"] == "skipped"
    assert store.get("2026-11-27:movers_close")["status"] == "published"
    assert store.get("2026-11-27:evening")["status"] == "pending"
    assert store.get("2026-11-28:us_movers_open")["status"] == "pending"
    assert store.get("2026-11-28:close") is None
    assert pub.reconcile_schedule(now) == (0, 0)


def test_web_tick_reconciles_with_delivery_disabled(monkeypatch):
    monkeypatch.delenv("NAVER_PUBLISH_ON_SERVER", raising=False)
    monkeypatch.setitem(pub._server, "queue_checked_at", None)
    observed = []

    def reconcile(now):
        observed.append(now)
        return 1, 0

    def publish(*args, **kwargs):
        raise AssertionError("the web server must not try to deliver")

    monkeypatch.setattr(pub, "reconcile_schedule", reconcile)
    monkeypatch.setattr(pub, "run_due", publish)
    pub._server_tick()
    assert pub.server_status()["queue_checked_at"] == observed[0].isoformat(timespec="seconds")
    assert pub.server_status()["delivery_mode"] == "disabled"
