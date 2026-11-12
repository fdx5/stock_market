"""Slot arithmetic and edition validation for 오늘의 핫이슈 (no network)."""
import datetime as dt
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.services import hot_issues as hi

KST = hi.KST


def at(h, m=0, day=12):
    return dt.datetime(2026, 11, day, h, m, tzinfo=KST)


@pytest.mark.parametrize("now,slot,nxt", [
    (at(6, 59), at(22, 0, 11), at(7)), (at(7), at(7), at(22)), (at(13, 5), at(7), at(22)),
    (at(21, 59), at(7), at(22)), (at(22, 0), at(22), at(7, 0, 13)), (at(23, 59), at(22), at(7, 0, 13)),
])
def test_slots(now, slot, nxt):
    assert hi.current_slot(now) == slot
    assert hi.next_slot(now) == nxt


def test_recent_slots_walk_back_across_midnight():
    assert hi.recent_slots(at(8), 4) == [at(7), at(22, 0, 11), at(7, 0, 11), at(22, 0, 10)]
    assert hi.archive_path(at(22)) == "hot-issues/2026-11-12/2200.json"
    assert hi.parse_slot("2026-11-12", "0700") == at(7)
    assert hi.parse_slot("2026-11-12", "1300") is None


def story(**over):
    base = {"title": "제목", "original_title": "", "category": "macro", "region": "global", "impact": "악재", "importance": 4,
            "summary": "요약", "body": ["문단"], "why_it_matters": "이유", "affected": [{"name": "삼성전자", "code": "005930", "direction": "down"}],
            "sources": [{"publisher": "Reuters", "title": "t", "url": "https://www.reuters.com/a", "language": "en", "published_at": ""}],
            "image": None, "video": None}
    return {**base, **over}


def edition(stories):
    return {"headline": "헤드라인", "dek": "요약", "mood": {"tone": "risk-off", "summary": "s"}, "key_numbers": [],
            "stories": stories, "watchlist": [], "takeaways": ["a", "b"]}


def test_clean_ranks_by_importance_and_filters_unsafe_media():
    out = hi.clean(edition([
        story(title="낮음", importance=2, image={"url": "https://news.example.com/p.jpg", "alt": "a", "credit": "c", "license": "x", "source_url": ""}),
        story(title="높음", importance=5, video={"youtube_id": "dQw4w9WgXcQ", "title": "v", "channel": "c"},
              image={"url": "https://upload.wikimedia.org/x.jpg", "alt": "a", "credit": "c", "license": "CC BY-SA 4.0", "source_url": ""}),
        story(title="중간", importance=3, video={"youtube_id": "bad id", "title": "v", "channel": "c"}, affected=[{"name": "X", "code": "<b>", "direction": "??"}]),
    ]), at(22))
    assert [s["title"] for s in out["stories"]] == ["높음", "중간", "낮음"]
    assert [s["rank"] for s in out["stories"]] == [1, 2, 3]
    assert out["stories"][0]["image"]["url"].startswith("https://upload.wikimedia.org/")
    assert out["stories"][0]["video"]["youtube_id"] == "dQw4w9WgXcQ"
    assert out["stories"][1]["video"] is None and out["stories"][1]["affected"] == [{"name": "X", "code": "", "direction": "mixed"}]
    assert out["stories"][2]["image"] is None  # not an allow-listed, licensed host
    assert out["slot"] == "2026-11-12T22:00+09:00" and out["slot_label"] == "22:00"


def test_clean_rejects_thin_or_unsourced_editions():
    with pytest.raises(ValueError):
        hi.clean(edition([story(), story(sources=[{"publisher": "x", "title": "t", "url": "javascript:alert(1)", "language": "en", "published_at": ""}])]), at(7))
    with pytest.raises(ValueError):
        hi.clean({**edition([story(), story(), story()]), "headline": ""}, at(7))


def test_current_falls_back_to_the_previous_published_slot(monkeypatch):
    published = {hi.archive_path(at(7)): hi.clean(edition([story(), story(), story()]), at(7))}
    monkeypatch.setattr(hi, "edition", lambda slot: published.get(hi.archive_path(slot)))
    out = hi.current(at(22, 5))
    assert out["slot"] == "2026-11-12T07:00+09:00" and out["is_latest"] is False
    assert out["next_update"] == "2026-11-13T07:00+09:00"
    assert [s["published"] for s in out["today_slots"]] == [True, False]


@pytest.fixture
def fresh_store(monkeypatch, tmp_path):
    """A brand-new temporary database: never the repository's or production's."""
    from app.services import hot_issue_store as store
    monkeypatch.setattr(store, "TURSO_DATABASE_URL", None)
    monkeypatch.setattr(store, "LOCAL_DB_PATH", tmp_path / "hot_issues.db")
    monkeypatch.setattr(store, "_conn", None)
    return store


def test_writer_publishes_once_and_logs_every_attempt(monkeypatch, fresh_store):
    from app.services import hot_issue_writer as w
    monkeypatch.setattr(w, "_published", set())
    calls = []
    def fake_generate(slot):
        calls.append(slot)
        return {**edition([story(), story(), story()]), "generated_at": "2026-11-12T21:40:00+09:00", "model": "m"}, {"seconds": 1}
    monkeypatch.setattr(w, "generate", fake_generate)
    assert w.run_slot(at(22), "schedule") == "published"
    assert w.run_slot(at(22), "admin") == "exists"
    assert len(calls) == 1
    assert hi.clean(fresh_store.get_edition("2026-11-12T22:00+09:00"), at(22))["headline"] == "헤드라인"
    assert [r["event"] for r in fresh_store.runs_for("2026-11-12T22:00+09:00")] == ["started", "published"]
    assert w._should_try(at(22), at(22, 10)) is False


def test_writer_stops_after_three_starts(monkeypatch, fresh_store):
    from app.services import hot_issue_writer as w
    monkeypatch.setattr(w, "_published", set())
    monkeypatch.setattr(w, "generate", lambda slot: (_ for _ in ()).throw(RuntimeError("search failed")))
    clock = {"now": at(21, 40)}
    monkeypatch.setattr(w, "_now", lambda: clock["now"])
    for minute in (35, 44, 53):
        clock["now"] = at(21, minute)
        assert w._should_try(at(22), clock["now"]) is True
        assert w.run_slot(at(22), "schedule") == "failed"
        assert w._should_try(at(22), at(21, minute + 1)) is False  # waits RETRY_GAP
    events = [r["event"] for r in fresh_store.runs_for("2026-11-12T22:00+09:00")]
    assert events.count("started") == 3 and events.count("failed") == 3
    assert w._should_try(at(22), at(22, 30)) is False
