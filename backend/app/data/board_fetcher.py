import json
import re
from urllib.parse import parse_qs, urlparse

import requests
from bs4 import BeautifulSoup

from app.services.cache import cache

TTL_BOARD_SECONDS = 3 * 60

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://finance.naver.com/",
}

# Board list/detail/comments each hit a different Naver host (finance.naver.com,
# m.stock.naver.com, apis.naver.com) on every single view - detail and comments have
# no useful cache warming path (the nid is different for every post), so avoiding a
# fresh TCP/TLS handshake per request is the only latency win available. A shared,
# connection-pooled session (same fix already applied in naver_price_fetcher.py)
# reuses a keep-alive connection per host instead of paying that handshake every time.
_session = requests.Session()
_session.headers.update(HEADERS)
_session.mount(
    "https://",
    requests.adapters.HTTPAdapter(pool_connections=10, pool_maxsize=20, max_retries=1),
)


def _fetch_board_page(code: str, page: int) -> list[dict]:
    url = f"https://finance.naver.com/item/board.naver?code={code}&page={page}"
    resp = _session.get(url, timeout=4)
    resp.raise_for_status()
    resp.encoding = "utf-8"  # this board is served as UTF-8, unlike the older price pages
    soup = BeautifulSoup(resp.text, "html.parser")

    table = soup.select_one("table.type2")
    if table is None:
        return []

    posts = []
    for tr in table.select("tr"):
        link = tr.select_one("td.title a")
        if not link:
            continue
        nid = parse_qs(urlparse(link.get("href", "")).query).get("nid", [None])[0]
        if not nid:
            continue

        cells = [td.get_text(" ", strip=True) for td in tr.select("td")]
        if len(cells) < 6:
            continue

        try:
            posts.append(
                {
                    "nid": nid,
                    "title": link.get_text(strip=True),
                    "date": cells[0],
                    "author": cells[2],
                    "views": int(cells[3].replace(",", "") or 0),
                    "likes": int(cells[4].replace(",", "") or 0),
                    "dislikes": int(cells[5].replace(",", "") or 0),
                }
            )
        except (ValueError, IndexError):
            continue
    return posts


def get_board_posts(code: str, page: int = 1, fresh: bool = False) -> list[dict]:
    key = f"board:{code}:{page}"
    try:
        return cache.get_or_set(
            key, TTL_BOARD_SECONDS, lambda: _fetch_board_page(code, page), allow_stale=not fresh
        )
    except Exception:
        return []


def _image_src(img) -> str | None:
    # Naver's editor lazy-loads images; the real URL sometimes only lives in a
    # data-* attribute while src holds a blank placeholder.
    for attr in ("data-lazy-src", "data-src", "src"):
        value = img.get(attr)
        if value:
            return value
    return None


def _fetch_board_detail(nid: str) -> dict | None:
    # The classic board_read.naver page now just embeds an iframe of Naver's mobile
    # stock app, which renders this client-side — no server-rendered content to scrape
    # there. This is the JSON API that page calls internally (found by inspecting its
    # network traffic, since it isn't documented anywhere).
    url = f"https://m.stock.naver.com/front-api/discussion/detail?id={nid}"
    resp = _session.get(url, timeout=4)
    resp.raise_for_status()
    payload = resp.json()
    if not payload.get("isSuccess"):
        return None

    result = payload.get("result") or {}
    soup = BeautifulSoup(result.get("contentHtml") or "", "html.parser")

    blocks = []
    for comp in soup.select(".se-component"):
        classes = comp.get("class") or []
        if "se-image" in classes:
            img = comp.select_one("img")
            src = _image_src(img) if img else None
            if src:
                blocks.append({"type": "image", "src": src})
            continue

        for para in comp.select(".se-text-paragraph") or [comp]:
            text = para.get_text("\n", strip=True)
            if text:
                blocks.append({"type": "text", "text": text})

    return {
        "nid": nid,
        "title": result.get("title", ""),
        "author": (result.get("writer") or {}).get("nickname", ""),
        "written_at": result.get("writtenAt", ""),
        "blocks": blocks,
    }


def get_board_detail(nid: str) -> dict | None:
    key = f"board_detail:{nid}"
    try:
        return cache.get_or_set(key, TTL_BOARD_SECONDS, lambda: _fetch_board_detail(nid))
    except Exception:
        return None


# Board posts have no reply feature of their own — replies instead go through Naver's
# shared cross-service "cbox" comment platform (the same system news/blog comments use),
# with "finance" as the ticket and "cbox12" as the stock-discussion pool. Neither value
# is documented anywhere; both were found by tracing the mobile discussion page's own
# network requests.
COMMENT_URL = "https://apis.naver.com/commentBox/cbox/web_neo_list_jsonp.json"
_JSONP_RE = re.compile(r"^[^(]*\((.*)\)\s*;?\s*$", re.S)


def _parse_jsonp(text: str) -> dict:
    match = _JSONP_RE.match(text)
    if not match:
        raise ValueError("Unexpected comment response format")
    return json.loads(match.group(1))


def _fetch_board_comments(nid: str) -> list[dict]:
    params = {
        "ticket": "finance",
        "templateId": "default",
        "pool": "cbox12",
        "lang": "ko",
        "country": "KR",
        "objectId": nid,
        "categoryId": "*",
        "pageSize": 50,
        "indexSize": 10,
        "listType": "OBJECT",
        "pageType": "more",
        "page": 1,
        "currentPage": 1,
        "sort": "NEW",
    }
    resp = _session.get(COMMENT_URL, params=params, timeout=4)
    resp.raise_for_status()
    payload = _parse_jsonp(resp.text)
    if not payload.get("success"):
        return []

    result = payload.get("result") or {}
    comments = []
    for row in result.get("commentList") or []:
        if row.get("deleted") or row.get("blind") or row.get("hiddenByCleanbot"):
            continue
        text = (row.get("contents") or "").strip()
        if not text:
            continue
        comments.append(
            {
                "id": row.get("commentNo", ""),
                "author": row.get("userName") or "",
                "text": text,
                "written_at": row.get("regTime", ""),
                "likes": row.get("sympathyCount", 0),
                "dislikes": row.get("antipathyCount", 0),
            }
        )
    return comments


def get_board_comments(nid: str) -> list[dict]:
    key = f"board_comments:{nid}"
    try:
        return cache.get_or_set(key, TTL_BOARD_SECONDS, lambda: _fetch_board_comments(nid))
    except Exception:
        return []
