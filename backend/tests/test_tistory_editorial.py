import datetime as dt
from types import SimpleNamespace

import pytest

from app.services import naver_document_model as model, tistory_editorial as editorial


FRIDAY = dt.date(2026, 11, 27)
SATURDAY = dt.date(2026, 11, 28)


def test_schedule_uses_kst_and_market_sessions():
    friday = {slot.edition: slot for slot in editorial.plan(FRIDAY)}
    saturday = {slot.edition: slot for slot in editorial.plan(SATURDAY)}
    assert next(iter(friday)) == "intro"
    assert friday["brief_kospi"].due_at.time() == dt.time(16, 20)
    assert {key for key in friday if key.startswith("brief_")} == set(editorial.BRIEFS)
    assert "us_movers_open" not in friday
    assert saturday["us_movers_open"].campaign == "ts_us_movers_open_20261128"
    assert "close" not in saturday


def test_html_preserves_public_tracking_without_inserting_raw_markup():
    slot = editorial.INTRO
    paragraphs = [model._paragraph_nodes([
        model._text_node("<script>unsafe</script>", bold=True, url="javascript:alert(1)"),
        model._text_node("KOSPIMAP", url="https://kospimap.com/map?utm_source=naver_blog&limit=10#section"),
    ])]
    html = editorial._components([model._text_component(paragraphs)], slot)
    assert "<script>" not in html and "javascript:" not in html
    assert "<strong>&lt;script&gt;unsafe&lt;/script&gt;</strong>" in html
    assert "limit=10&amp;utm_source=tistory&amp;utm_medium=blog&amp;utm_campaign=ts_intro#section" in html


def test_archive_matches_the_exact_slot_and_date(monkeypatch):
    monkeypatch.setattr(editorial, "_assets", lambda day: {
        "abcdabcdabcdabcdabcd-midday-kospi.png",
        "01234567890123456789-kospi.png",
    })
    assert editorial._archived(FRIDAY, "kospi.png").endswith("2026-11-27/01234567890123456789-kospi.png")
    assert editorial._archived(SATURDAY, "kosdaq.png") is None


def _rss(items: list[tuple[str, str]]) -> bytes:
    rows = "".join(f"<item><link>{link}</link><description><![CDATA[{body}]]></description></item>" for link, body in items)
    return f"<rss><channel>{rows}</channel></rss>".encode()


def test_public_confirmation_requires_unique_marker_and_same_blog():
    data = _rss([
        (f"{editorial.BLOG}/1", '<a href="https://kospimap.com/?utm_campaign=ts_intro">Intro</a>'),
        (f"{editorial.BLOG}/2", "utm_campaign=ts_evening_20261127"),
        (f"{editorial.BLOG}/3", "utm_campaign=ts_evening_20261127"),
        ("https://outside.example/4", "utm_campaign=ts_morning_20261127"),
        (f"{editorial.BLOG}/5", "utm_campaign=ts_close_20261127 utm_campaign=ts_midday_20261127"),
    ])
    assert editorial._feed_links(data) == {"ts_intro": f"{editorial.BLOG}/1"}
    with pytest.raises(ValueError):
        editorial._feed_links(b"<html/>")


def test_server_prepares_once_and_records_publication_without_replacing_draft(monkeypatch, tmp_path):
    monkeypatch.delenv("TURSO_DATABASE_URL", raising=False)
    monkeypatch.setattr(editorial, "LOCAL_DB_PATH", tmp_path / "test.db")
    for field, value in {"_connection": None, "_last_tick": None, "_feed_ok": None,
                         "_feed_checked_at": None, "_last_errors": {}}.items():
        monkeypatch.setattr(editorial, field, value)
    calls = []

    def compose(slot):
        calls.append(slot.key)
        if slot.key != "intro":
            raise editorial.content.NotReady("waiting")
        return editorial.INTRO_TITLE, "<p>original draft</p>"

    rss = _rss([(f"{editorial.BLOG}/1", "utm_campaign=ts_intro")])
    monkeypatch.setattr(editorial, "compose", compose)
    monkeypatch.setattr(editorial, "_public", lambda url: SimpleNamespace(content=rss))
    now = dt.datetime.combine(FRIDAY, dt.time(7, 0), tzinfo=editorial.KST)
    assert editorial.tick(now)
    assert editorial.tick(now)
    assert calls == ["intro"]
    assert editorial.get_draft("intro")["html"] == "<p>original draft</p>"
    result = editorial.status(FRIDAY, now=now)
    assert result["publish_mode"] == "api_retired" and result["feed_ok"] is True
    assert result["jobs"][0]["state"] == "published"
    assert result["jobs"][0]["published_url"] == f"{editorial.BLOG}/1"
