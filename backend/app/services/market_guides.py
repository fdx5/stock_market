"""Public editorial content shared by the SPA and the initial HTML; no DB access."""
from __future__ import annotations

import html
import json
from pathlib import Path

_APP = Path(__file__).resolve().parents[1]
_CATALOG = _APP / "static/content/market-guides.json"
if not _CATALOG.is_file():
    _CATALOG = _APP.parents[1] / "frontend/src/guides/market-guides.json"
CATALOG = json.loads(_CATALOG.read_text(encoding="utf-8"))
GUIDES = {f"/guides/{guide['slug']}": guide for guide in CATALOG["guides"]}
PAGES = {"/guides": (f"{CATALOG['title']} | K-Stock Hub", CATALOG["description"])}
PAGES.update({path: (f"{guide['title']} | K-Stock Hub", guide["description"]) for path, guide in GUIDES.items()})


def _link(href: str, label: str) -> str:
    return f'<a href="{html.escape(href, quote=True)}">{html.escape(label)}</a>'


def render_content(path: str) -> str:
    guide = GUIDES.get(path)
    if guide:
        content = f'<p>작성·검토: K-Stock Hub · <time datetime="{CATALOG["updated"]}">{CATALOG["updated"]}</time> · 약 {guide["minutes"]}분</p>'
        for section in guide["sections"]:
            content += f'<section><h2>{html.escape(section["title"])}</h2>'
            content += "".join(f'<p>{html.escape(p)}</p>' for p in section["paragraphs"]) + "</section>"
        content += '<h2>직접 확인하기</h2><ul>'
        content += "".join(f'<li>{_link(tool["href"], tool["label"])}</li>' for tool in guide["tools"]) + "</ul>"
        if guide.get("sources"):
            content += '<h2>참고 자료</h2><ul>' + "".join(f'<li>{_link(s["href"], s["label"])}</li>' for s in guide["sources"]) + "</ul>"
    elif path == "/guides":
        content = '<p>가격을 보기 전에 비교 기준부터 정리하세요. 각 안내에서 실제 시장 도구로 바로 이동할 수 있습니다.</p>'
    else:
        return ""
    content += '<nav aria-label="시장 읽기 안내"><h2>함께 읽기</h2><ul>'
    content += "".join(f'<li>{_link(other, item["title"])}</li>' for other, item in GUIDES.items() if other != path) + "</ul></nav>"
    content += '<p>시세와 데이터는 투자 참고용입니다. 데이터의 기준 시점과 표본 범위를 확인하세요.</p>'
    return content


def structured_data(path: str, site: str) -> dict:
    guide = GUIDES.get(path)
    title, description = PAGES[path]
    page = {
        "@type": "Article" if guide else "CollectionPage",
        "headline" if guide else "name": guide["title"] if guide else CATALOG["title"],
        "description": description,
        "url": f"{site}{path}",
        "inLanguage": "ko-KR",
        "isAccessibleForFree": True,
    }
    if guide:
        page.update({
            "datePublished": CATALOG["updated"], "dateModified": CATALOG["updated"],
            "mainEntityOfPage": {"@type": "WebPage", "@id": f"{site}{path}"},
            "author": {"@type": "Organization", "name": "K-Stock Hub", "url": site},
        })
    crumbs = [{"@type": "ListItem", "position": 1, "name": "K-Stock Hub", "item": f"{site}/"},
              {"@type": "ListItem", "position": 2, "name": CATALOG["title"], "item": f"{site}/guides"}]
    if guide:
        crumbs.append({"@type": "ListItem", "position": 3, "name": guide["title"], "item": f"{site}{path}"})
    return {"@context": "https://schema.org", "@graph": [page, {"@type": "BreadcrumbList", "itemListElement": crumbs}]}
