"""Public discussion reader. No database, member profiles or persistent post storage.

Collection is demand-driven; entry refreshes coalesce for five seconds. Process-local
snapshots keep paging stable; a restart expires snapshots, never stored data.
"""
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from datetime import datetime, timezone, timedelta
from collections import OrderedDict
from threading import Lock
from urllib.parse import urlencode, urlparse, parse_qs, urljoin, urlunparse
from urllib.robotparser import RobotFileParser
import re
import time
import uuid
import unicodedata
from html import unescape
import logging
from itertools import islice

import requests
from bs4 import BeautifulSoup, NavigableString, Tag, Comment

KST = timezone(timedelta(hours=9))
UA = "KospimapCommunity/1.0 (public discussion index; no AI training)"
SOURCES = {
    "kr": [("pax-market", "팍스넷 · 거래소 시황", "pax", "N00801"), ("pax-analysis", "팍스넷 · 시황분석", "pax", "N11022"), ("82-stock", "82cook · 주식", "82", "주식")],
    "global": [("pax-us", "팍스넷 · 미국주식", "pax", "N11039"), ("82-us", "82cook · 미국주식", "82", "미국주식")],
    "property": [("pax-property", "팍스넷 · 부동산 검색", "pax", "N00801"), ("82-property", "82cook · 부동산", "82", "부동산"), ("82-apartment", "82cook · 아파트", "82", "아파트")],
}
_locks = {key: Lock() for key in SOURCES}
_guard = Lock()
_robots = {}
_snapshots = OrderedDict()
_latest = {}
_attempted = {}
_previews = OrderedDict()
_post_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="community-body")
_refresh_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="community-refresh")
_refreshing = set()
_log = logging.getLogger(__name__)
_body_failures = {}
_body_backoff = {}
_comment_cache = OrderedDict()


def clean(value):
    return re.sub(r"\s+", " ", re.sub(r"[\u200b-\u200f\ufeff]", "", value or "")).strip()


def html_soup(data):
    """Decode Korean bytes strictly, rather than guessing Latin-1 or losing characters.

    Valid UTF-8 wins even when an old page incorrectly declares EUC-KR.
    CP949 is the Korean legacy superset; never turn undecodable bytes into '?'.
    Literal question marks in upstream text are preserved, never guessed back.
    """
    if isinstance(data, str): return BeautifulSoup(data, "html.parser")
    for encoding in ("utf-8-sig", "cp949", "euc-kr"):
        try: return BeautifulSoup(data.decode(encoding, errors="strict"), "html.parser")
        except UnicodeDecodeError: continue
    raise ValueError("unsupported source encoding")


def title_key(title):
    text = unicodedata.normalize("NFKC", clean(title)).casefold()
    text = re.sub(r"\s+", "", text)
    # Decoration does not distinguish repeated registrations of the same heading.
    return text.strip("~.!?★☆●○■□◆◇▲△▼▽-=*_…ㆍ·")


def post_identity(item):
    url = urlparse(item.get("url", ""))
    params = parse_qs(url.query)
    if url.hostname in {"www.paxnet.co.kr", "paxnet.co.kr"} and params.get("seq"):
        return "pax-" + params["seq"][0]
    if url.hostname in {"www.82cook.com", "82cook.com"} and params.get("num"):
        return "82-" + params["num"][0]
    return item["id"]


def deduplicate(items):
    """Group a display index only. Original links remain available in each group."""
    identities, headings, result = {}, {}, []
    for original in sorted(items, key=lambda p: (p["published_at"], p["id"]), reverse=True):
        identity, heading = post_identity(original), title_key(original["title"])
        if identity in identities: continue
        # Generic short headings can describe unrelated discussions.
        existing = headings.get(heading) if len(heading) >= 8 else None
        if existing is not None:
            identities[identity] = existing
            existing["duplicate_count"] += 1
            if len(existing["related_posts"]) < 20:
                existing["related_posts"].append({k: original[k] for k in ("id", "title", "source", "url", "published_at") if k in original})
            continue
        item = dict(original)
        item["duplicate_count"] = original.get("duplicate_count", 0)
        item["related_posts"] = list(original.get("related_posts", []))
        identities[identity] = item
        if len(heading) >= 8: headings[heading] = item
        result.append(item)
    return result


def _request(url):
    # Fixed, code-owned URLs only. Redirects are not followed to a new origin.
    r = requests.get(url, headers={"User-Agent": UA}, timeout=(4, 10), allow_redirects=False, stream=True)
    try:
        r.raise_for_status()
        if r.is_redirect:
            raise ValueError("redirect")
        data = bytearray()
        for chunk in r.iter_content(65536):
            data.extend(chunk)
            if len(data) > 2_000_000:
                raise ValueError("response too large")
        return bytes(data)
    finally:
        r.close()


def _get(url):
    host = urlparse(url).netloc
    with _guard:
        cached = _robots.get(host)
    if not cached or time.monotonic() - cached[0] > 3600:
        parser = RobotFileParser()
        parser.parse(_request(f"https://{host}/robots.txt").decode("utf-8", "replace").splitlines())
        cached = (time.monotonic(), parser)
        with _guard:
            _robots[host] = cached
    if not cached[1].can_fetch(UA, url):
        raise ValueError("source policy")
    return _request(url)


def _topic(title):
    if re.search(r"금리|정책|대출|세금|규제|연준|금통위", title): return "정책·금리"
    if re.search(r"시황|증시|코스피|코스닥|나스닥|지수|환율", title): return "시황"
    if re.search(r"가격|시세|집값|매매|전세|월세|실거래|분양", title): return "시세·거래"
    if re.search(r"질문|궁금|까요|나요|어떤|어떻", title): return "질문"
    return "의견"


def parse_82(data, source, board):
    soup = html_soup(data)
    items = []
    for row in soup.select("tbody tr:not(.noticeList)"):
        a, date = row.select_one("td.title a"), row.select_one("td.regdate[title]")
        if not a or not date: continue
        num = parse_qs(urlparse(a.get("href", "")).query).get("num", [""])[0]
        title = clean(a.get_text())[:300]
        if not num.isdigit() or not title: continue
        if board == "kr" and re.search(r"미국|미장|해외|나스닥|테슬라|엔비디아", title): continue
        try: written = datetime.strptime(date["title"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=KST).astimezone(timezone.utc).isoformat()
        except ValueError: continue
        count = row.select_one("td.title em")
        items.append({"id": f"82-{num}", "title": title, "published_at": written,
                      "url": f"https://www.82cook.com/entiz/read.php?bn=15&num={num}",
                      "source_id": source[0], "source": source[1], "language": "ko",
                      "topic": _topic(title), "comments": int(count.get_text()) if count and count.get_text().isdigit() else None,
                      "excerpt": "", "excerpt_kind": "원문에서 본문과 댓글을 읽을 수 있습니다."})
    return items


def parse_pax(data, source, board):
    soup = html_soup(data)
    items = []
    for seq in soup.select("[data-seq]"):
        row = seq.parent
        a, date = row.select_one("a.best-title"), row.select_one("[data-date-format]")
        number = seq.get("data-seq", "")
        if not a or not date or not number.isdigit(): continue
        title = clean(a.get_text())[:300]
        # The property source searches title+body; keep a topic-specific title index.
        if board == "property" and not re.search(r"부동산|아파트|집값|전세|월세|분양|재건축|주택", title): continue
        try: written = datetime.strptime(date["data-date-format"].replace(" KST ", " "), "%a %b %d %H:%M:%S %Y").replace(tzinfo=KST).astimezone(timezone.utc).isoformat()
        except ValueError: continue
        comments = row.select_one(".comment-num")
        items.append({"id": f"pax-{number}", "title": title, "published_at": written,
                      "url": f"https://www.paxnet.co.kr/tbbs/view?id={source[3]}&seq={number}",
                      "source_id": source[0], "source": source[1], "language": "ko", "topic": _topic(title),
                      "comments": int(comments.get_text()) if comments and comments.get_text().isdigit() else None,
                      "excerpt": "", "excerpt_kind": "원문에서 본문과 댓글을 읽을 수 있습니다."})
    return items


def collect(source, board):
    try:
        if source[2] == "82":
            items = []
            for page in range(1, 4):
                url = "https://www.82cook.com/entiz/enti.php?" + urlencode({"bn": "15", "searchType": "search", "search1": "1", "keys": source[3], "page": page})
                batch = parse_82(_get(url), source, board)
                items.extend(batch)
                if not batch: break
        else:
            items = []
            for page in range(1, 7 if board == "property" else 4):
                params = {"tbbsType": "S" if board == "property" else "L", "id": source[3], "page": page, "sort": "recentOrdr"}
                if board == "property": params.update({"sType": "cnt", "sText": "부동산"})
                batch = parse_pax(_get("https://www.paxnet.co.kr/tbbs/list?" + urlencode(params)), source, board)
                items.extend(batch)
                if not batch: break
        return items, {"id": source[0], "name": source[1], "status": "ok" if items else "empty", "count": len(items)}
    except Exception:
        return [], {"id": source[0], "name": source[1], "status": "unavailable", "count": 0}


def publish(board, readable, states, old=None, checked=0, candidates=0, complete=True):
    source_states = [dict(state, readable_count=sum(p["source_id"] == state["id"] for p in readable)) for state in states]
    if complete:
        for state in source_states:
            if state["status"] == "ok" and not state["readable_count"]: state["status"] = "unavailable"
    data = {"snapshot": uuid.uuid4().hex, "board": board, "items": deduplicate(readable), "sources": source_states,
            "checked_at": datetime.now(timezone.utc).isoformat(), "checked_count": checked, "candidate_count": candidates,
            "collected_at": datetime.now(timezone.utc).isoformat() if readable and any(s["status"] == "ok" for s in source_states) else (old.get("collected_at") if old else None)}
    with _guard:
        _snapshots[data["snapshot"]] = data
        _latest[board] = data["snapshot"]
        while len(_snapshots) > 64:
            key = next(k for k in _snapshots if k not in _latest.values())
            _snapshots.pop(key)
    return data


def latest(board, refresh=False):
    with _locks[board]:
        now = time.monotonic()
        previous = _latest.get(board)
        if previous and now - _attempted.get(board, 0) < (5 if refresh else 60):
            with _guard: return _snapshots[previous]
        _attempted[board] = now
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(lambda source: collect(source, board), SOURCES[board]))
        unique, states = {}, []
        for items, state in results:
            states.append(state)
            for item in items: unique.setdefault(item["id"], item)
        # Retain the last successful source slice if just that source is unavailable.
        if previous:
            with _guard: old = _snapshots[previous]
            failed = {s["id"] for s in states if s["status"] != "ok"}
            for item in old["items"]:
                if item["source_id"] in failed: unique.setdefault(item["id"], item)
        # Publish only articles whose complete readable body or attachments were
        # actually obtained. Keep that body in the immutable reading snapshot.
        _log.info("Community %s: checking %s public candidates", board, len(unique))
        candidates = iter(sorted(unique.values(), key=lambda p: (p["published_at"], p["id"]), reverse=True))
        # Keep only four queued jobs per board, so one cold board cannot monopolize
        # the shared pool. Publish completed, readable bodies without waiting for
        # the slowest origin request in the entire collection.
        pending = {_post_pool.submit(verified_post, item) for item in islice(candidates, 4)}
        readable, checked, last_publish = [], 0, time.monotonic()
        while pending:
            done, pending = wait(pending, return_when=FIRST_COMPLETED)
            for future in done:
                item = future.result()
                checked += 1
                if item is not None: readable.append(item)
                next_item = next(candidates, None)
                if next_item is not None: pending.add(_post_pool.submit(verified_post, next_item))
            if readable and (len(readable) == 1 or checked % 10 == 0 or time.monotonic() - last_publish >= 2):
                publish(board, readable, states, old if previous else None, checked, len(unique), complete=False)
                last_publish = time.monotonic()
        _log.info("Community %s: ready %s of %s checked", board, len(readable), checked)
        return publish(board, readable, states, old if previous else None, checked, len(unique))


def responsive_latest(board, refresh=False):
    with _guard:
        key = _latest.get(board)
        data = _snapshots.get(key)
        due = time.monotonic() - _attempted.get(board, 0) >= (5 if refresh else 60)
        launch = (data is None or due) and board not in _refreshing
        if launch: _refreshing.add(board)
    if launch:
        def update():
            try: latest(board, refresh)
            finally:
                with _guard: _refreshing.discard(board)
        _refresh_pool.submit(update)
    with _guard:
        refreshing = board in _refreshing
        data = _snapshots.get(_latest.get(board), data)
    if data is None:
        data = {"snapshot": "", "board": board, "items": [], "sources": [{"id": s[0], "name": s[1], "status": "pending", "count": 0} for s in SOURCES[board]], "checked_at": datetime.now(timezone.utc).isoformat(), "collected_at": None}
    return data, refreshing


def listing(board, page=1, snapshot=None, query="", source="", topic="", refresh=False, background=False):
    refreshing = False
    if snapshot:
        with _guard: data = _snapshots.get(snapshot)
        if not data or data["board"] != board: raise LookupError("snapshot expired")
    elif background: data, refreshing = responsive_latest(board, refresh)
    else: data = latest(board, refresh)
    items = [i for i in data["items"] if (not query or query.casefold() in i["title"].casefold()) and (not source or i["source_id"] == source) and (not topic or i["topic"] == topic)]
    public_items = [{k: v for k, v in item.items() if k != "_body"} for item in items[(page-1)*50:page*50]]
    return {k: v for k, v in data.items() if k != "items"} | {"items": public_items, "total": len(items), "page": page, "page_size": 50, "pages": max(1, (len(items)+49)//50), "refresh_seconds": 60, "refreshing": refreshing, "grouped_duplicates": sum(p.get("duplicate_count", 0) for p in items)}


def attachment_url(value, base):
    if not value or len(value) > 2048: return None
    url = urlparse(urljoin(base, value.strip()))
    if url.scheme not in {"https", "http"} or url.username or url.password: return None
    if url.hostname not in {"www.paxnet.co.kr", "paxnet.co.kr", "image.paxnet.co.kr", "img.paxnet.co.kr", "www.82cook.com", "82cook.com"}: return None
    try:
        if url.port not in {None, 80, 443}: return None
    except ValueError: return None
    if re.search(r"\.(?:svg|html?|js)(?:$|[/?])", url.path, re.I): return None
    return urlunparse(("https", url.hostname, url.path, url.params, url.query, ""))


_CONTROL_WORD = r"(?:공유하기|공유|페이스북|트위터|네이버\s*밴드|밴드|스크랩|카카오\s*스토리|카카오톡|라인|URL\s*복사|닫기)"
_CONTROL_RUN = re.compile(r"(?<![가-힣A-Za-z])(?:0\s+)?" + _CONTROL_WORD + r"(?:\s+" + _CONTROL_WORD + r"){2,}(?![가-힣A-Za-z])", re.I)
_HTML_TAG = re.compile(r"</?(?:iframe|script|style|object|embed|video|div|p|br|img|a|span|strong|em|b|i|button|input|form|nav|section|article|ul|ol|li)\b[^>]*>", re.I)
_URL = re.compile(r"https?://[^\s<>\"']+", re.I)


def youtube_video(value):
    value = unescape(value or "").strip().split()
    if not value: return None
    raw = value[0].rstrip(".,;!)]}↗")
    if raw.startswith("//"): raw = "https:" + raw
    url = urlparse(raw)
    if url.scheme not in {"http", "https"} or url.username or url.password: return None
    host = url.hostname
    parts = url.path.strip("/").split("/")
    video_id = None
    if host in {"youtu.be", "www.youtu.be"} and len(parts) == 1:
        video_id = parts[0]
    elif host in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"}:
        if len(parts) == 2 and parts[0] in {"embed", "shorts", "live"}: video_id = parts[1]
        elif url.path == "/watch": video_id = parse_qs(url.query).get("v", [None])[0]
    if not video_id or not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id): return None
    return {"video_id": video_id, "title": "유튜브 영상", "portrait": bool(parts and parts[0] == "shorts")}


def expand_literal_html(content):
    # Some boards store embed markup as escaped text, including nested entities.
    # Parse only recognized HTML fragments; all output is still structured data.
    for _ in range(3):
        changed = False
        for node in list(content.find_all(string=True)):
            if isinstance(node, Comment) or node.parent is None or node.parent.name in {"script", "style"}: continue
            candidate = unescape(str(node))
            if not _HTML_TAG.search(candidate): continue
            fragment = BeautifulSoup(candidate, "html.parser")
            node.replace_with(*list(fragment.contents))
            changed = True
        if not changed: break


def clean_body_controls(content):
    # UI chrome is not article content. Also handle menus pasted as plain text
    # into a forum post: require a run of controls containing a UI action.
    for el in content.select("script,style,object,embed,video,form,noscript,button,input,select,textarea,nav,[role='button'],[role='navigation'],.share,.sns,.social-share,.article-share,.share-tools,.sns-area,.share-area,.social-tools"):
        if el.parent is not None: el.decompose()
    for el in content.select("iframe"):
        if not youtube_video(el.get("src", "")): el.decompose()
    for el in content.select("a[href]"):
        if re.fullmatch(_CONTROL_WORD, clean(el.get_text(" ", strip=True)), re.I) and re.search(r"javascript:|share|sharer|intent/|scrap|copy|kakao", el.get("href", ""), re.I):
            el.decompose()


def readable_text(text):
    text = _CONTROL_RUN.sub(lambda m: "\n\n" if re.search(r"공유|스크랩|URL\s*복사", m.group(), re.I) else m.group(), text)
    text = re.sub(r"[\u200b-\u200f\ufeff]", "", text).replace("\r\n", "\n").replace("\r", "\n")
    return re.sub(r"\n{3,}", "\n\n", "\n".join(re.sub(r"[^\S\n]+", " ", line).strip() for line in text.split("\n"))).strip()


def public_link(value, base):
    if not value: return None
    url = urlparse(urljoin(base, value.strip()))
    if url.scheme not in {"https", "http"} or not url.hostname or url.username or url.password: return None
    return url.geturl()


def parse_preview(data, url, is_pax=True):
    soup = html_soup(data)
    content = soup.select_one("#bbsWrtCntn" if is_pax else ".read_cont, .read_content, #readContent")
    if not content: return {"text": "", "excerpt": "", "images": [], "blocks": [], "status": "unavailable"}
    expand_literal_html(content)
    clean_body_controls(content)
    images, seen, blocks, buffer = [], set(), [], []
    seen_videos = set()

    def add_video(video):
        if video["video_id"] not in seen_videos:
            seen_videos.add(video["video_id"])
            blocks.append({"type": "youtube", **video})

    def paragraph(text):
        if text.strip(): blocks.extend({"type": "paragraph", "text": p} for p in text.strip().split("\n\n") if p.strip())

    def flush():
        text = readable_text("".join(buffer))
        buffer.clear()
        start = 0
        for match in _URL.finditer(text):
            video = youtube_video(match.group())
            if not video: continue
            paragraph(text[start:match.start()])
            add_video(video)
            start = match.end()
        paragraph(text[start:])

    def walk(node):
        if isinstance(node, Comment): return
        if isinstance(node, NavigableString):
            buffer.append(str(node))
            return
        if not isinstance(node, Tag): return
        if node.name == "iframe":
            video = youtube_video(node.get("src", ""))
            if video:
                flush()
                width, height = node.get("width", ""), node.get("height", "")
                if str(width).isdigit() and str(height).isdigit() and int(width) > 0:
                    video["portrait"] = int(height) > int(width) * 1.2
                title = clean(node.get("title", ""))
                if title: video["title"] = title[:160]
                add_video(video)
            return
        if node.name == "br":
            buffer.append("\n")
            return
        if node.name == "img":
            dimensions = [int(node[a]) for a in ("width", "height") if str(node.get(a, "")).isdigit()]
            if any(n <= 2 for n in dimensions): return
            candidates = [node.get(a) for a in ("data-original", "data-src", "data-lazy-src", "src")]
            src = next((safe for value in candidates if (safe := attachment_url(value, url))), None)
            if not src or src in seen: return
            seen.add(src)
            image = {"url": src, "alt": clean(node.get("alt", ""))[:160] or f"첨부 이미지 {len(images) + 1}"}
            images.append(image)
            flush()
            blocks.append({"type": "image", **image})
            return
        block = node.name in {"p", "div", "section", "article", "blockquote", "h1", "h2", "h3", "h4", "ul", "ol", "table", "tr"}
        if block: buffer.append("\n\n")
        if node.name == "li": buffer.append("\n• ")
        if node.name in {"td", "th"}: buffer.append("  ")
        for child in node.children: walk(child)
        if node.name == "a" and node.get_text(strip=True):
            href = public_link(node.get("href"), url)
            if href and href != node.get_text(strip=True): buffer.append(f" ({href})")
        if block: buffer.append("\n\n")

    walk(content)
    flush()
    text = "\n\n".join(b["text"] for b in blocks if b["type"] == "paragraph")
    # The legacy response field remains for older clients, but is no longer truncated.
    return {"text": text, "excerpt": text, "images": images, "blocks": blocks, "status": "ok" if blocks else "empty"}


def load_post(item):
    post_id = item["id"]
    with _guard: cached = _previews.get(post_id)
    ttl = 300 if cached and cached[1].get("status") == "ok" else 30
    if cached and time.monotonic() - cached[0] < ttl: return cached[1]
    result = {"text": "", "excerpt": "", "images": [], "blocks": [], "status": "unavailable"}
    # A source may expose search headings while requiring login for every body.
    # Stop repeatedly requesting that source after confirmed failures; never
    # bypass its access controls, and periodically permit a fresh public check.
    host = urlparse(item["url"]).hostname
    with _guard:
        if _body_backoff.get(host, 0) > time.monotonic(): return result
    for attempt in range(2):
        try:
            result = parse_preview(_get(item["url"]), item["url"], item["id"].startswith("pax-"))
            break
        except (requests.Timeout, requests.ConnectionError):
            if attempt: break
        except Exception: break
    with _guard:
        if item["id"].startswith("82-"):
            if result["status"] == "ok":
                _body_failures[host] = 0
                _body_backoff[host] = 0
            else:
                _body_failures[host] = _body_failures.get(host, 0) + 1
                if _body_failures[host] >= 3:
                    _body_backoff[host] = time.monotonic() + 120
                    _body_failures[host] = 0
        _previews[post_id] = (time.monotonic(), result)
        while len(_previews) > 256: _previews.popitem(last=False)
    return result


def verified_post(item):
    body = item.get("_body") or load_post(item)
    if body.get("status") != "ok" or not body.get("blocks"): return None
    return dict(item, _body=body)


def preview(board, snapshot, post_id):
    with _guard:
        data = _snapshots.get(snapshot)
        item = next((p for p in data["items"] if p["id"] == post_id), None) if data and data["board"] == board else None
    if not item: raise LookupError("snapshot expired")
    return item.get("_body") or load_post(item)


def parse_comments(data, source_url, page=1):
    soup = html_soup(data)
    scripts = "\n".join(s.get_text() for s in soup.select('script'))
    count = re.search(r'''\$\(["']#commentCnt["']\)\.html\(["'](\d+)["']\)''', scripts)
    total = int(count[1]) if count else None
    last_page = re.search(r'''if\(\s*["'](\d+)["']\s*==\s*["'](\d+)["']\s*\)\s*\{\s*\$\(["']#und-list["']\)\.hide\(\)''', scripts)
    items, seen = [], set()
    for node in soup.select('.text[id^="text_"]'):
        comment_id = node.get('id', '').removeprefix('text_')
        content = node.find('p', class_='cont', recursive=False)
        if not comment_id.isdigit() or comment_id in seen or content is None: continue
        body = parse_preview(f'<div id="bbsWrtCntn">{content}</div>', source_url)
        if not body['blocks']: continue
        seen.add(comment_id)
        date = node.select_one('.data-date-format')
        written = None
        if date:
            try: written = datetime.strptime(date['data-date-format'].replace(' KST ', ' '), '%a %b %d %H:%M:%S %Y').replace(tzinfo=KST).astimezone(timezone.utc).isoformat()
            except (KeyError, ValueError): pass
        thread = node.find_parent('li', class_='list')
        parent = thread.select_one('.text[id^="text_"]') if thread else None
        parent_id = parent.get('id', '').removeprefix('text_') if parent else None
        if parent_id == comment_id: parent_id = None
        action = node.select_one('button[onclick*="replyAddForm"]')
        relation = re.search(r'''replyAddForm\(\s*["']\d+["']\s*,\s*this\s*,\s*["'](\d+)["']''', action.get('onclick', '')) if action else None
        if relation and relation[1] != '0': parent_id = relation[1]
        # No writer ID, nickname, profile URL or profile image enters the response.
        items.append({'id': comment_id, 'parent_id': parent_id, 'published_at': written, 'blocks': body['blocks']})
    if not items and total is None:
        return {'status': 'unavailable', 'items': [], 'total': None, 'has_more': False, 'page': page}
    has_more = bool(items) and (last_page[1] != last_page[2] if last_page else total is not None and total > page * len(items))
    return {'status': 'ok', 'items': items, 'total': total, 'has_more': has_more, 'page': page}


def comments(board, snapshot, post_id, page=1):
    with _guard:
        data = _snapshots.get(snapshot)
        item = next((p for p in data['items'] if p['id'] == post_id), None) if data and data['board'] == board else None
        cached = _comment_cache.get((post_id, page))
    if not item: raise LookupError('snapshot expired')
    if cached and time.monotonic() - cached[0] < 30: return cached[1]
    result = {'status': 'unavailable', 'items': [], 'total': None, 'has_more': False, 'page': page}
    query = parse_qs(urlparse(item['url']).query)
    bbs_id, seq = query.get('id', [''])[0], query.get('seq', [''])[0]
    if item['id'].startswith('pax-') and re.fullmatch(r'N\d{1,10}', bbs_id) and re.fullmatch(r'\d{1,20}', seq):
        url = 'https://www.paxnet.co.kr/tbbs/bbsCommentList?' + urlencode({'id': bbs_id, 'seq': seq, 'page': page, 'orderType': '', 'commentSeq': 0, 'modCmt': 'N'})
        try: result = parse_comments(_get(url), item['url'], page)
        except Exception: pass
    with _guard:
        _comment_cache[(post_id, page)] = (time.monotonic(), result)
        while len(_comment_cache) > 256: _comment_cache.popitem(last=False)
    return result
