from pathlib import Path

from app.services import seo


def test_home_title_targets_search_queries():
    html = (Path(__file__).resolve().parents[2] / "frontend" / "index.html").read_text(encoding="utf-8")
    title = seo.PAGES["/"][0] if hasattr(seo, "PAGES") else None
    for token in ("코스피", "코스닥", "히트맵", "오늘 증시", "급등주"):
        assert token in html.split("</title>")[0]
    if title:
        assert "히트맵" in title


def test_served_home_card_matches_search_title():
    import json

    cards = json.loads((Path(__file__).resolve().parents[1] / "app" / "data" / "social_cards.json").read_text(encoding="utf-8"))
    home = cards["/"]
    assert "히트맵" in home["title"] and "급등주" in home["title"]
    assert "오늘 증시" in home["description"]
    assert "히트맵" in cards["/map"]["description"]
