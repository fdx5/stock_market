from pathlib import Path

from app.services import seo


def test_home_title_targets_search_queries():
    html = (Path(__file__).resolve().parents[2] / "frontend" / "index.html").read_text(encoding="utf-8")
    title = seo.PAGES["/"][0] if hasattr(seo, "PAGES") else None
    for token in ("코스피", "코스닥", "히트맵", "오늘 증시", "급등주"):
        assert token in html.split("</title>")[0]
    if title:
        assert "히트맵" in title
