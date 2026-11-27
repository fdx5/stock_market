"""Prepare Tistory articles and verify public publication through its RSS feed."""
from __future__ import annotations

import datetime as dt
import logging
import os
import re
import threading
import time
from dataclasses import dataclass
from html import escape
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from xml.etree import ElementTree

import requests
from bs4 import BeautifulSoup

from app.services import libsql_gate, market_brief_store, naver_document_model as model
from app.services import naver_social_content as content, naver_social_publisher as schedule, trading_calendar, turso
from app.services.naver_blog_exporter import TARGET_CONFIG

BLOG = "https://kospi-map.tistory.com"
INTRO_SOURCE = "https://m.blog.naver.com/kospi-predictor/224493125897"
INTRO_TITLE = "코스피맵(KOSPIMAP) 소개 | 국내·미국 증시를 한 화면에 모은 시장 관제실"
API_NOTICE = "https://cs.daum.net/notice/5108?selectedCategoryId=60782"
START_DAY = dt.date(2026, 11, 27)
KST = schedule.KST
LOCAL_DB_PATH = Path(__file__).resolve().parents[1] / "data" / "store" / "tistory_editorial.db"
ASSET_API = "https://api.github.com/repos/fdx5/stock_market/contents"
ASSET_RAW = "https://raw.githubusercontent.com/fdx5/stock_market/social-post-assets"
log = logging.getLogger(__name__)
_gate = libsql_gate.Gate("tistory_editorial")
_connection = None
_tick_lock = threading.Lock()
_asset_cache: dict[dt.date, tuple[float, set[str]]] = {}
_last_tick: str | None = None
_feed_checked_at: str | None = None
_feed_ok: bool | None = None
_last_errors: dict[str, str] = {}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS tistory_editorial_drafts (
    draft_key TEXT PRIMARY KEY,
    source_day TEXT NOT NULL,
    edition TEXT NOT NULL,
    campaign TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    html TEXT NOT NULL,
    prepared_at TEXT NOT NULL,
    published_url TEXT,
    verified_at TEXT
)
"""

CATEGORIES = {
    content.CAT_HOT: "오늘의 핫이슈",
    content.CAT_MAPS: "코스닥,코스닥,나스닥",
    content.CAT_BRIEF: "오늘의 브리핑",
    content.CAT_MOVERS: "급등,급락의 이유",
    content.CAT_WORLD: "글로벌 증시",
}
BRIEFS = {f"brief_{entry['market'].lower()}": entry for entry in TARGET_CONFIG}
ARCHIVES = {
    "close": ("kospi.png", "kosdaq.png"),
    "midday": ("midday-kospi.png", "midday-kosdaq.png"),
    "nasdaq_close": ("nasdaq100.png",),
    "world_morning": ("world-0800.png",),
    "world_evening": ("world-1700.png",),
}
_CAMPAIGN = re.compile(r"\butm_campaign=(ts_[a-z0-9_]+)(?![a-z0-9_])")


@dataclass(frozen=True)
class Slot:
    day: dt.date
    edition: str
    at: str
    label: str
    category: str

    @property
    def key(self) -> str:
        return "intro" if self.edition == "intro" else f"{self.day}:{self.edition}"

    @property
    def campaign(self) -> str:
        return "ts_intro" if self.edition == "intro" else f"ts_{self.edition}_{self.day:%Y%m%d}"

    @property
    def due_at(self) -> dt.datetime:
        return dt.datetime.combine(self.day, dt.time.fromisoformat(self.at), tzinfo=KST)


INTRO = Slot(START_DAY, "intro", "00:00", "KOSPIMAP 소개", "kospimap 소개")


def plan(day: dt.date) -> list[Slot]:
    if day < START_DAY:
        return []
    slots = [Slot(day, edition, at, label, CATEGORIES[category])
             for edition, (at, _, category, _, _, label) in content.EDITIONS.items()
             if schedule.applies(day, edition)]
    if trading_calendar.is_trading_day(day, "KR"):
        slots.extend(Slot(day, edition, "16:20", f"{meta['name']} 장마감 브리핑", CATEGORIES[content.CAT_BRIEF])
                     for edition, meta in BRIEFS.items())
    return [INTRO, *sorted(slots, key=lambda slot: slot.at)]


def _ready_connection():
    url = os.environ.get("TURSO_DATABASE_URL")
    if url:
        connection = turso.connect(database=url, auth_token=os.environ.get("TURSO_AUTH_TOKEN"))
    else:
        LOCAL_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        connection = turso.connect(database=str(LOCAL_DB_PATH))
    connection.execute(_SCHEMA)
    connection.execute("CREATE INDEX IF NOT EXISTS idx_tistory_editorial_day ON tistory_editorial_drafts(source_day)")
    connection.commit()
    return connection


def _db(operation):
    global _connection
    with _gate.hold():
        if _connection is None:
            _connection = _ready_connection()
        try:
            return operation(_connection)
        except Exception as exc:
            if not turso.should_retry(exc):
                raise
            _connection.close()
            _connection = _ready_connection()
            return operation(_connection)


def _now() -> str:
    return dt.datetime.now(KST).isoformat(timespec="seconds")


def _index(days: list[dt.date]) -> dict[str, dict]:
    marks = ", ".join("?" for _ in days)
    names = ("key", "title", "prepared_at", "published_url", "verified_at")
    rows = _db(lambda db: db.execute(
        f"SELECT draft_key, title, prepared_at, published_url, verified_at FROM tistory_editorial_drafts "
        f"WHERE draft_key = 'intro' OR source_day IN ({marks})", tuple(str(day) for day in days)).fetchall())
    return {row[0]: dict(zip(names, row)) for row in rows}


def get_draft(key: str) -> dict | None:
    names = ("key", "category", "title", "html", "prepared_at", "published_url")
    row = _db(lambda db: db.execute(
        "SELECT draft_key, category, title, html, prepared_at, published_url FROM tistory_editorial_drafts WHERE draft_key = ?",
        (key,)).fetchone())
    return dict(zip(names, row)) if row else None


def _save(slot: Slot, title: str, html: str) -> None:
    def insert(db):
        db.execute(
            "INSERT INTO tistory_editorial_drafts (draft_key, source_day, edition, campaign, category, title, html, prepared_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(draft_key) DO NOTHING",
            (slot.key, str(slot.day), slot.edition, slot.campaign, slot.category, title, html, _now()))
        db.commit()
    _db(insert)


def _public(url: str) -> requests.Response:
    response = requests.get(url, timeout=(3, 8), allow_redirects=False,
                            headers={"User-Agent": "KOSPIMAP-Editorial/1"})
    if response.status_code != 200:
        response.raise_for_status()
        raise ValueError("unexpected public source response")
    return response


def _link(url: str, slot: Slot) -> str | None:
    value = urlsplit(url)
    if value.scheme not in ("http", "https") or not value.hostname or value.username or value.password:
        return None
    if value.hostname != "kospimap.com":
        return url
    original = [(name, item) for name, item in parse_qsl(value.query) if not name.startswith("utm_")]
    campaign = [("utm_source", "tistory"), ("utm_medium", "blog"), ("utm_campaign", slot.campaign)]
    return urlunsplit(("https", "kospimap.com", value.path, urlencode(original + campaign), value.fragment))


def _anchor(label: str, url: str, slot: Slot) -> str:
    link = _link(url, slot)
    return f'<a href="{escape(link, quote=True)}">{label}</a>' if link else label


def _image(url: str, label: str) -> str:
    return f'<p><img src="{escape(url, quote=True)}" alt="{escape(label, quote=True)}"></p>'


def _components(parts: list[dict], slot: Slot, images: dict[str, str] | None = None) -> str:
    result = []
    for part in parts:
        image_key = part.get(model.IMAGE_MARKER)
        if image_key:
            if images and image_key in images:
                result.append(_image(images[image_key], slot.label))
            continue
        for line in part.get("value") or []:
            fragments = []
            for node in line.get("nodes") or []:
                text = escape(node.get("value") or "")
                if node.get("style", {}).get("bold"):
                    text = f"<strong>{text}</strong>"
                link = (node.get("link") or {}).get("url")
                fragments.append(_anchor(text, link, slot) if link else text)
            result.append(f"<p>{''.join(fragments) or '<br>'}</p>")
    return "\n".join(result)


def _intro(slot: Slot) -> str:
    soup = BeautifulSoup(_public(INTRO_SOURCE).content, "html.parser")
    body = soup.select_one(".se-main-container")
    if body is None:
        raise content.NotReady("introduction body not available")
    output = []
    for item in body.select("p.se-text-paragraph, img.se-image-resource"):
        if item.name == "img":
            url = item.get("src") or ""
            parts = urlsplit(url)
            if parts.scheme == "https" and (parts.hostname or "").endswith(".pstatic.net"):
                output.append(_image(url, item.get("alt") or "KOSPIMAP 화면"))
        else:
            fragments = []
            for node in item.find_all(string=True):
                text = escape(str(node))
                anchor = node.find_parent("a", href=True)
                fragments.append(_anchor(text, anchor["href"], slot) if anchor else text)
            line = "".join(fragments).strip()
            if line:
                output.append(f"<p>{line}</p>")
    if not output or len(body.get_text(strip=True)) < 500:
        raise content.NotReady("introduction body incomplete")
    return "\n".join(output)


def _assets(day: dt.date) -> set[str]:
    cached = _asset_cache.get(day)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    try:
        data = _public(f"{ASSET_API}/{day}?ref=social-post-assets").json()
    except requests.HTTPError as exc:
        if exc.response is None or exc.response.status_code != 404:
            raise
        data = []
    if not isinstance(data, list):
        raise ValueError("unexpected archive index")
    names = {entry["name"] for entry in data if entry.get("type") == "file"}
    for cached_day in tuple(_asset_cache):
        if cached_day != day and abs((cached_day - day).days) > 2:
            _asset_cache.pop(cached_day)
    _asset_cache[day] = (time.monotonic() + 300, names)
    return names


def _archived(day: dt.date, suffix: str) -> str | None:
    pattern = re.compile(rf"[a-f0-9]{{20}}-{re.escape(suffix)}")
    names = sorted(name for name in _assets(day) if pattern.fullmatch(name))
    # If there are two versions, the source only guarantees date and edition.
    return f"{ASSET_RAW}/{day}/{names[0]}" if len(names) == 1 else None


def _archive_article(slot: Slot) -> tuple[str, str, str]:
    edition, day = slot.edition, slot.day
    images = [_archived(day, suffix) for suffix in ARCHIVES[edition]]
    if not all(images):
        raise content.NotReady("dated chart not available")
    path = "/world-markets" if edition.startswith("world_") else "/nasdaq100-map" if edition == "nasdaq_close" else "/map"
    title = f"{day:%Y-%m-%d} {slot.label}"
    header = f"<p>{day:%Y년 %m월 %d일} {slot.at} 한국시간 배포판입니다. 당시 시세와 순위는 아래 자료에 표시했습니다.</p>"
    charts = "\n".join(_image(url, slot.label) for url in images if url)
    return title, f"{header}\n{charts}\n<p>{escape(content.DISCLAIMER)}</p>", path


def compose(slot: Slot) -> tuple[str, str]:
    edition, day = slot.edition, slot.day
    if edition == "intro":
        title, html, path = INTRO_TITLE, _intro(slot), "/"
    elif edition in BRIEFS:
        meta = BRIEFS[edition]
        market = meta["market"]
        brief = market_brief_store.get(str(day), market)
        if not brief or brief.get("date") != str(day):
            raise content.NotReady("dated market brief not available")
        title = model.build_title(brief, meta)
        html = _components(model.build_body_components(brief, meta, site_url=content.SITE), slot)
        path = f"/market-brief/{day}/{market.lower()}"
    elif edition in ARCHIVES:
        title, html, path = _archive_article(slot)
    elif content.EDITIONS[edition][4] == "hot":
        post = content.build_hot(day, edition, "A-tight", include_image=False)
        clock = "0700" if edition == "morning" else "2200"
        path = f"/hot-issues/{day}/{clock}"
        title, html = post.title, _components(post.body, slot, {"cover": f"{content.SITE}/hot-issues/og/{day}/{clock}.png"})
    else:
        post = content.build_movers(day, edition, "A-tight", include_image=False)
        import movers_social

        clock = movers_social.EDITIONS[edition]
        path = f"{movers_social.base(edition)}/{day}/{clock}"
        try:
            figure = _archived(day, f"movers-{clock}.png")
        except (requests.RequestException, ValueError):
            figure = None
        title, html = post.title, _components(post.body, slot, {"movers": figure} if figure else None)
    return title, f'{html}\n<p>{_anchor("KOSPIMAP에서 보기", content.SITE + path, slot)}</p>'


def _feed_links(data: bytes) -> dict[str, str]:
    channel = ElementTree.fromstring(data).find("channel")
    if channel is None:
        raise ValueError("Tistory RSS channel missing")
    results: dict[str, set[str]] = {}
    for item in channel.findall("item"):
        url = (item.findtext("link") or "").strip()
        value = urlsplit(url)
        if value.scheme not in ("http", "https") or value.netloc != "kospi-map.tistory.com" or value.path in ("", "/", "/rss"):
            continue
        html = " ".join((item.findtext("description") or "", item.findtext("{http://purl.org/rss/1.0/modules/content/}encoded") or ""))
        found = set(_CAMPAIGN.findall(html))
        if len(found) == 1:
            results.setdefault(found.pop(), set()).add(url)
    return {campaign: urls.pop() for campaign, urls in results.items() if len(urls) == 1}


def _record_public(links: dict[str, str], checked_at: str) -> None:
    if not links:
        return

    def update(db):
        db.executemany(
            "UPDATE tistory_editorial_drafts SET published_url = ?, verified_at = ? "
            "WHERE campaign = ? AND published_url IS NULL",
            [(url, checked_at, campaign) for campaign, url in links.items()])
        db.commit()
    _db(update)


def tick(now: dt.datetime | None = None) -> bool:
    global _last_tick, _feed_checked_at, _feed_ok, _last_errors
    if not _tick_lock.acquire(blocking=False):
        return False
    try:
        now = now or dt.datetime.now(KST)
        days = [now.date() - dt.timedelta(days=1), now.date()]
        slots = {slot.key: slot for day in days for slot in plan(day)}
        existing = _index(days)
        recent_errors = {}
        for slot in slots.values():
            if slot.key in existing or now < slot.due_at:
                continue
            try:
                title, html = compose(slot)
                _save(slot, title, html)
            except content.NotReady:
                continue
            except Exception as exc:
                recent_errors[slot.key] = type(exc).__name__
                log.warning("Tistory draft preparation failed for %s (%s)", slot.key, type(exc).__name__)
        _last_errors = recent_errors
        try:
            _record_public(_feed_links(_public(f"{BLOG}/rss").content), _now())
            _feed_ok = True
        except (requests.RequestException, ElementTree.ParseError, ValueError) as exc:
            _feed_ok = False
            log.warning("Tistory public feed check failed (%s)", type(exc).__name__)
        _feed_checked_at = _last_tick = _now()
        return True
    finally:
        _tick_lock.release()


def status(day: dt.date | None = None, *, now: dt.datetime | None = None) -> dict:
    now = now or dt.datetime.now(KST)
    day = day or now.date()
    existing = _index([day])
    jobs = []
    for slot in plan(day):
        row = existing.get(slot.key, {})
        if row.get("published_url"):
            state = "published"
        elif row:
            state = "ready"
        elif now < slot.due_at:
            state = "scheduled"
        elif slot.key in _last_errors:
            state = "error"
        else:
            state = "waiting"
        jobs.append({"key": slot.key, "at": slot.at, "label": slot.label, "category": slot.category,
                     "state": state, "title": row.get("title"), "prepared_at": row.get("prepared_at"),
                     "published_url": row.get("published_url"), "verified_at": row.get("verified_at")})
    return {"day": str(day), "blog": BLOG, "editor": f"{BLOG}/manage/newpost", "api_notice": API_NOTICE,
            "publish_mode": "api_retired", "last_tick": _last_tick, "feed_checked_at": _feed_checked_at,
            "feed_ok": _feed_ok, "jobs": jobs}


def _loop() -> None:
    time.sleep(45)
    while True:
        try:
            tick()
        except Exception:
            log.exception("Tistory editorial tick failed")
        time.sleep(300)


def start_scheduler() -> None:
    threading.Thread(target=_loop, daemon=True, name="tistory-editorial").start()
