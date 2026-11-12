"""Index landing pages render from one payload without network access."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.services import index_landing


def fixture_payload(key):
    spec = index_landing.LANDINGS[key]
    return {
        "key": key, "path": spec["path"], "name": spec["name"], "en": spec["en"], "title": spec["title"],
        "description": spec["description"], "map": spec["map"], "map_label": spec["map_label"], "partner_name": spec.get("partner_name"),
        "live": {"close": 5342.73, "change": -32.63, "change_pct": -0.61, "status": "CLOSE", "as_of": "2026-11-12T20:15:00+09:00"},
        "stats": {"high_52w": 9385.59, "low_52w": 3833.35, "return_1w": -0.76, "return_1m": -11.09, "return_3m": -15.19, "return_ytd": 26.78, "ma20": 5560.42, "ma60": 6355.77},
        "history": [{"date": "2026-11-11", "open": None, "high": None, "low": None, "close": 5375.36}, {"date": "2026-11-12", "open": None, "high": None, "low": None, "close": 5342.73}],
        "chart": [], "investor": {"individual_amount": -2689.0, "foreign_amount": 4123.0, "institution_amount": -6624.0},
        "breadth": {"count": 2, "up": 1, "down": 1, "flat": 0, "currency": "KRW", "collected_at": "",
                    "gainers": [{"code": "005930", "name": "삼성전자", "close": 206500.0, "change_pct": 0.24, "sector": "반도체"}],
                    "losers": [], "largest": [], "sectors": []},
        "faq": [{"q": q, "a": a} for q, a in spec["faq"]], "generated_at": "",
    }


def test_rendered_content_carries_level_history_movers_and_faq(monkeypatch):
    monkeypatch.setattr(index_landing, "payload", fixture_payload)
    content = index_landing.render_content("/kospi")
    assert "5,342.73" in content and "-0.61%" in content
    assert "2026-11-12" in content and "52주 최고 9,385.59" in content
    assert 'href="/stock/005930"' in content and "외국인 +4,123" in content
    assert "코스피 거래 시간은 언제인가요?" in content
    assert 'href="/map"' in content and 'href="/kosdaq"' in content and 'href="/nasdaq"' in content
    assert index_landing.headline(fixture_payload("kospi")) == "코스피 5,342.73 (-0.61%)"


def test_structured_data_matches_visible_faq():
    data = index_landing.structured_data("/nasdaq", "https://kospimap.com")
    types = [node["@type"] for node in data["@graph"]]
    assert types == ["WebPage", "BreadcrumbList", "FAQPage"]
    faq = data["@graph"][2]["mainEntity"]
    assert [item["name"] for item in faq] == [q for q, _ in index_landing.LANDINGS["nasdaq"]["faq"]]
    json.dumps(data, ensure_ascii=False)


def test_unknown_path_renders_nothing():
    assert index_landing.render_content("/nope") == ""
    assert index_landing.structured_data("/nope", "https://kospimap.com") is None
