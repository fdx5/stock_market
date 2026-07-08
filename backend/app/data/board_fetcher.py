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


def _fetch_board_page(code: str, page: int) -> list[dict]:
    url = f"https://finance.naver.com/item/board.naver?code={code}&page={page}"
    resp = requests.get(url, headers=HEADERS, timeout=8)
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


def get_board_posts(code: str, page: int = 1) -> list[dict]:
    key = f"board:{code}:{page}"
    try:
        return cache.get_or_set(key, TTL_BOARD_SECONDS, lambda: _fetch_board_page(code, page))
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
    resp = requests.get(url, headers=HEADERS, timeout=8)
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
