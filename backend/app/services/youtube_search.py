"""YouTube search for the walk mode's TV (/walk): what a viewer types on the TV's YouTube app.

With a YouTube Data API key on the server (YOUTUBE_DATA_API_KEY) it asks the API; without one it
reads YouTube's public results page, as the editorial collector does. Answers are kept in memory for
ten minutes (failures one); nothing is written to the database and no key or URL is ever logged.
"""

from __future__ import annotations

import html
import logging
import os
import random
import re
import threading
import time

import requests

from app.data.editorial_sources import VIDEO_ID, _request, _text, _walk, embedded_json

log = logging.getLogger(__name__)

TTL, FAIL_TTL, MAX_ENTRIES, LIMIT = 600, 60, 500, 24
_lock = threading.Lock()
_memo: dict[str, tuple[float, float, list[dict] | None]] = {}


class SearchError(Exception):
    pass


def clean_query(q: str | None) -> str:
    """The query as searched: whitespace collapsed, at most 80 characters; empty is an error."""
    s = re.sub(r"\s+", " ", str(q or "")).strip()[:80]
    if not s:
        raise ValueError("검색어를 입력하세요.")
    return s


def _views(text: str) -> int | None:
    digits = re.sub(r"[^0-9]", "", text or "")
    return int(digits) if digits else None


def parse_results_page(document: str) -> list[dict]:
    """The videos of a youtube.com/results page, in its order (live and short-form ones included)."""
    data = embedded_json(document, "ytInitialData")
    out, seen = [], set()
    for node in _walk(data):
        row = node.get("videoRenderer") if isinstance(node, dict) else None
        if not row:
            continue
        vid = row.get("videoId", "")
        if not VIDEO_ID.fullmatch(vid) or vid in seen:
            continue
        seen.add(vid)
        out.append({
            "id": vid, "title": _text(row.get("title", {})),
            "channel": _text(row.get("ownerText") or row.get("longBylineText") or {}),
            "views": _views(_text(row.get("viewCountText", {}))),
            "length": _text(row.get("lengthText", {})) or None,
            "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
        })
        if len(out) >= LIMIT:
            break
    return out


def _api(q: str, key: str) -> list[dict]:
    data = _request("https://www.googleapis.com/youtube/v3/search", params={
        "part": "snippet", "type": "video", "q": q, "maxResults": LIMIT, "regionCode": "KR",
        "relevanceLanguage": "ko", "safeSearch": "moderate", "key": key}).json()
    out = []
    for item in data.get("items", []):
        vid = item.get("id", {}).get("videoId", "")
        if not VIDEO_ID.fullmatch(vid):
            continue
        sn = item.get("snippet", {})
        out.append({"id": vid, "title": html.unescape(sn.get("title", "")), "channel": sn.get("channelTitle", ""),
                    "views": None, "length": None, "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"})
    return out


def _public(q: str) -> list[dict]:
    page = _request("https://www.youtube.com/results", params={"search_query": q, "hl": "ko", "gl": "KR"}).text
    return parse_results_page(page)


# The TV's first page: what youtube.com shows a signed-out viewer in Korea, and (since that page is
# often empty signed out) the results of a few of these, a different few each time.
HOME_TOPICS = ["인기 급상승 동영상", "오늘의 뉴스", "주식 시장 전망", "부동산 시장", "경제 뉴스", "라이브 음악", "여행 브이로그",
               "요리 레시피", "스포츠 하이라이트", "게임 실황", "다큐멘터리", "과학 이야기", "IT 리뷰", "자동차 리뷰", "예능 클립",
               "영화 리뷰", "건강 정보", "인테리어", "캠핑", "반려동물", "운동 루틴", "역사 이야기", "드라마 클립", "클래식 음악"]
HOME_LIMIT = 20


def _front_page() -> list[dict]:
    page = _request("https://www.youtube.com/", params={"hl": "ko", "gl": "KR"}).text
    return parse_results_page(page)


def home() -> dict:
    """Twenty videos for the TV's first page, drawn afresh on every call: youtube.com's front page
    (kept five minutes) and the results of four topics picked at random (each kept ten minutes),
    mixed. Failures of one source are skipped; only all failing is an error."""
    now = time.time()
    pool: list[dict] = []
    with _lock:
        hit = _memo.get("\0home")
    if hit and now - hit[0] < hit[1]:
        pool += hit[2] or []
    else:
        try:
            front = _front_page()
            ttl = 300
        except (requests.RequestException, ValueError, TypeError, KeyError) as exc:
            log.info("youtube home failed (%s)", type(exc).__name__)
            front, ttl = None, FAIL_TTL
        with _lock:
            _memo["\0home"] = (now, ttl, front)
        pool += front or []
    for topic in random.sample(HOME_TOPICS, 4):
        try:
            pool += search(topic)["items"]
        except SearchError:
            continue
    seen: set[str] = set()
    unique = [v for v in pool if not (v["id"] in seen or seen.add(v["id"]))]
    if not unique:
        raise SearchError("유튜브 영상을 불러오지 못했습니다.")
    random.shuffle(unique)
    return {"items": unique[:HOME_LIMIT]}


def search(q: str | None) -> dict:
    query = clean_query(q)
    now = time.time()
    with _lock:
        hit = _memo.get(query.lower())
        if hit and now - hit[0] < hit[1]:
            if hit[2] is None:
                raise SearchError("유튜브 검색에 잠시 실패했습니다.")
            return {"q": query, "items": hit[2]}
    items: list[dict] | None
    try:
        key = os.environ.get("YOUTUBE_DATA_API_KEY")
        items = _api(query, key) if key else _public(query)
        if not items and key:
            items = _public(query)
        ttl = TTL
    except (requests.RequestException, ValueError, TypeError, KeyError) as exc:
        # (never the exception's text: a request URL could carry the server's API key)
        log.info("youtube search failed (%s)", type(exc).__name__)
        items, ttl = None, FAIL_TTL
    with _lock:
        if len(_memo) >= MAX_ENTRIES:
            for k, _ in sorted(_memo.items(), key=lambda kv: kv[1][0])[: MAX_ENTRIES // 2]:
                _memo.pop(k, None)
        _memo[query.lower()] = (now, ttl, items)
    if items is None:
        raise SearchError("유튜브 검색에 잠시 실패했습니다.")
    return {"q": query, "items": items}
