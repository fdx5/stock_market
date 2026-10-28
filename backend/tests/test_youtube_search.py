import json

import pytest

from app.services import youtube_search as ys


def page(videos):
    data = {"contents": {"list": [{"videoRenderer": v} for v in videos]}}
    return "<html><script>var ytInitialData = " + json.dumps(data) + ";</script></html>"


def test_parse_results_page_keeps_order_and_dedupes():
    doc = page([
        {"videoId": "abcdefghijk", "title": {"runs": [{"text": "첫 영상"}]}, "ownerText": {"runs": [{"text": "채널"}]},
         "viewCountText": {"simpleText": "조회수 12,345회"}, "lengthText": {"simpleText": "3:21"}},
        {"videoId": "abcdefghijk", "title": {"simpleText": "중복"}},
        {"videoId": "bad"},
        {"videoId": "ZYXWVUTSRQP", "title": {"simpleText": "둘째"}},
    ])
    rows = ys.parse_results_page(doc)
    assert [r["id"] for r in rows] == ["abcdefghijk", "ZYXWVUTSRQP"]
    assert rows[0]["title"] == "첫 영상" and rows[0]["channel"] == "채널" and rows[0]["views"] == 12345 and rows[0]["length"] == "3:21"
    assert rows[1]["views"] is None


def test_clean_query():
    assert ys.clean_query("  코스피   전망 ") == "코스피 전망"
    assert len(ys.clean_query("가" * 200)) == 80
    with pytest.raises(ValueError):
        ys.clean_query("   ")


def test_search_uses_public_page_without_key_and_caches(monkeypatch):
    calls = []
    monkeypatch.delenv("YOUTUBE_DATA_API_KEY", raising=False)
    monkeypatch.setattr(ys, "_public", lambda q: calls.append(q) or [{"id": "abcdefghijk"}])
    ys._memo.clear()
    assert ys.search("시바견")["items"] == [{"id": "abcdefghijk"}]
    assert ys.search("시바견")["q"] == "시바견"
    assert calls == ["시바견"]


def test_search_failure_is_reported_not_raised_raw(monkeypatch):
    import requests
    monkeypatch.delenv("YOUTUBE_DATA_API_KEY", raising=False)
    def boom(q):
        raise requests.ConnectionError("https://example/?key=SECRET")
    monkeypatch.setattr(ys, "_public", boom)
    ys._memo.clear()
    with pytest.raises(ys.SearchError) as e:
        ys.search("abc")
    assert "SECRET" not in str(e.value)


def test_home_mixes_front_page_and_topics_twenty_unique(monkeypatch):
    monkeypatch.delenv("YOUTUBE_DATA_API_KEY", raising=False)
    ys._memo.clear()
    monkeypatch.setattr(ys, "_front_page", lambda: [{"id": f"front{i:06d}"} for i in range(8)])
    monkeypatch.setattr(ys, "_public", lambda q: [{"id": f"t{abs(hash(q)) % 999:03d}{i:07d}"} for i in range(9)] + [{"id": "front000000"}])
    items = ys.home()["items"]
    assert len(items) == 20
    assert len({v["id"] for v in items}) == 20


def test_home_survives_front_page_failure(monkeypatch):
    import requests
    monkeypatch.delenv("YOUTUBE_DATA_API_KEY", raising=False)
    ys._memo.clear()
    def boom():
        raise requests.ConnectionError("down")
    monkeypatch.setattr(ys, "_front_page", boom)
    monkeypatch.setattr(ys, "_public", lambda q: [{"id": f"{q[:2]}x{i:08d}"[:11]} for i in range(6)])
    assert ys.home()["items"]
