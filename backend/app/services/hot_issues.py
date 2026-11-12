"""오늘의 핫이슈: two editions a day (07:00 and 22:00 KST). Read-only here.

Editions are written outside the web host — a local scheduled job researches the
news, writes one JSON edition per slot and appends it to the public
``editorial-editions`` branch (never overwriting, never deleting). The server only
reads: it serves the latest slot that has been published, falling back to the
previous ones, and validates every edition with the same rules the writer used.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import threading
import time
from urllib.parse import urlparse

import requests

KST = dt.timezone(dt.timedelta(hours=9))
SLOTS = ((7, 0), (22, 0))
ARCHIVE_BASE = "https://raw.githubusercontent.com/fdx5/stock_market/editorial-editions/"
CATEGORIES = ("global", "korea", "macro", "policy", "earnings", "geopolitics", "tech", "commodity", "fx", "crypto")
IMPACTS = ("호재", "악재", "중립", "혼재")
# Pictures only from hosts whose files carry an explicit licence or are public domain.
# Anything else is dropped rather than hot-linked from a news site.
IMAGE_HOSTS = ("upload.wikimedia.org",)
YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
STOCK_CODE = re.compile(r"^[A-Z0-9.\-]{1,16}$")

SCHEMA: dict = {
    "type": "object", "additionalProperties": False,
    "required": ["headline", "dek", "mood", "key_numbers", "stories", "watchlist", "takeaways"],
    "properties": {
        "headline": {"type": "string", "description": "이번 판 전체를 대표하는 한 줄 제목 (40자 이내)"},
        "dek": {"type": "string", "description": "이번 판 핵심을 2~3문장으로 요약"},
        "mood": {"type": "object", "additionalProperties": False, "required": ["tone", "summary"], "properties": {
            "tone": {"type": "string", "enum": ["risk-on", "risk-off", "mixed"]},
            "summary": {"type": "string", "description": "시장 분위기 한 문장"}}},
        "key_numbers": {"type": "array", "maxItems": 8, "items": {"type": "object", "additionalProperties": False,
            "required": ["label", "value", "change", "note"], "properties": {
                "label": {"type": "string"}, "value": {"type": "string"}, "change": {"type": "string"}, "note": {"type": "string"}}}},
        "stories": {"type": "array", "minItems": 4, "maxItems": 10, "items": {"type": "object", "additionalProperties": False,
            "required": ["title", "category", "region", "impact", "importance", "summary", "body", "why_it_matters", "affected", "sources", "image", "video", "original_title"],
            "properties": {
                "title": {"type": "string", "description": "한국어 제목 (45자 이내)"},
                "original_title": {"type": "string", "description": "해외 기사면 원문 제목, 국내면 빈 문자열"},
                "category": {"type": "string", "enum": list(CATEGORIES)},
                "region": {"type": "string", "enum": ["global", "korea"]},
                "impact": {"type": "string", "enum": list(IMPACTS)},
                "importance": {"type": "integer", "minimum": 1, "maximum": 5},
                "summary": {"type": "string", "description": "핵심 요약 1~2문장"},
                "body": {"type": "array", "minItems": 1, "maxItems": 5, "items": {"type": "string"}, "description": "상세 설명 문단"},
                "why_it_matters": {"type": "string", "description": "국내 투자자에게 왜 중요한지"},
                "affected": {"type": "array", "maxItems": 8, "items": {"type": "object", "additionalProperties": False,
                    "required": ["name", "code", "direction"], "properties": {
                        "name": {"type": "string"}, "code": {"type": "string", "description": "KRX 6자리 또는 미국 티커, 모르면 빈 문자열"},
                        "direction": {"type": "string", "enum": ["up", "down", "mixed"]}}}},
                "sources": {"type": "array", "minItems": 1, "maxItems": 5, "items": {"type": "object", "additionalProperties": False,
                    "required": ["publisher", "title", "url", "language", "published_at"], "properties": {
                        "publisher": {"type": "string"}, "title": {"type": "string"}, "url": {"type": "string"},
                        "language": {"type": "string", "enum": ["ko", "en", "ja", "zh", "other"]}, "published_at": {"type": "string"}}}},
                "image": {"type": ["object", "null"], "additionalProperties": False, "required": ["url", "alt", "credit", "license", "source_url"], "properties": {
                    "url": {"type": "string"}, "alt": {"type": "string"}, "credit": {"type": "string"}, "license": {"type": "string"}, "source_url": {"type": "string"}}},
                "video": {"type": ["object", "null"], "additionalProperties": False, "required": ["youtube_id", "title", "channel"], "properties": {
                    "youtube_id": {"type": "string"}, "title": {"type": "string"}, "channel": {"type": "string"}}},
            }}},
        "watchlist": {"type": "array", "maxItems": 8, "items": {"type": "object", "additionalProperties": False,
            "required": ["when", "event", "note"], "properties": {"when": {"type": "string"}, "event": {"type": "string"}, "note": {"type": "string"}}}},
        "takeaways": {"type": "array", "minItems": 2, "maxItems": 5, "items": {"type": "string"}},
    },
}


def slot_times(day: dt.date) -> list[dt.datetime]:
    return [dt.datetime(day.year, day.month, day.day, h, m, tzinfo=KST) for h, m in SLOTS]


def current_slot(now: dt.datetime | None = None) -> dt.datetime:
    now = (now or dt.datetime.now(KST)).astimezone(KST)
    for slot in reversed(slot_times(now.date())):
        if slot <= now:
            return slot
    return slot_times(now.date() - dt.timedelta(days=1))[-1]


def next_slot(now: dt.datetime | None = None) -> dt.datetime:
    now = (now or dt.datetime.now(KST)).astimezone(KST)
    for slot in slot_times(now.date()) + slot_times(now.date() + dt.timedelta(days=1)):
        if slot > now:
            return slot
    raise AssertionError("unreachable")


def recent_slots(now: dt.datetime | None = None, count: int = 6) -> list[dt.datetime]:
    slot = current_slot(now)
    out = [slot]
    while len(out) < count:
        slot = current_slot(slot - dt.timedelta(minutes=1))
        out.append(slot)
    return out


def archive_path(slot: dt.datetime) -> str:
    slot = slot.astimezone(KST)
    return f"hot-issues/{slot.date().isoformat()}/{slot:%H%M}.json"


def parse_slot(day: str, hhmm: str) -> dt.datetime | None:
    try:
        date = dt.date.fromisoformat(day)
    except ValueError:
        return None
    slot = next((s for s in slot_times(date) if f"{s:%H%M}" == hhmm), None)
    return slot


def _text(value, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _url(value) -> str:
    url = str(value or "").strip()
    parsed = urlparse(url)
    return url[:600] if parsed.scheme in ("http", "https") and parsed.netloc else ""


def clean(payload: dict, slot: dt.datetime) -> dict:
    """Normalise an edition; raise ValueError if it is not publishable."""
    if not isinstance(payload, dict):
        raise ValueError("edition is not an object")
    stories = []
    for raw in payload.get("stories") or []:
        if not isinstance(raw, dict):
            continue
        sources = [{"publisher": _text(s.get("publisher"), 60), "title": _text(s.get("title"), 200), "url": _url(s.get("url")),
                    "language": s.get("language") if s.get("language") in ("ko", "en", "ja", "zh", "other") else "other",
                    "published_at": _text(s.get("published_at"), 40)}
                   for s in raw.get("sources") or [] if isinstance(s, dict) and _url(s.get("url"))][:5]
        title, summary = _text(raw.get("title"), 90), _text(raw.get("summary"), 400)
        body = [_text(p, 1200) for p in raw.get("body") or [] if _text(p, 10)][:5]
        if not (title and summary and body and sources):
            continue
        image = raw.get("image") if isinstance(raw.get("image"), dict) else None
        if image:
            url = _url(image.get("url"))
            image = {"url": url, "alt": _text(image.get("alt"), 160), "credit": _text(image.get("credit"), 160),
                     "license": _text(image.get("license"), 80), "source_url": _url(image.get("source_url"))} \
                if url and urlparse(url).netloc in IMAGE_HOSTS and _text(image.get("license"), 80) else None
        video = raw.get("video") if isinstance(raw.get("video"), dict) else None
        if video:
            vid = str(video.get("youtube_id") or "").strip()
            video = {"youtube_id": vid, "title": _text(video.get("title"), 160), "channel": _text(video.get("channel"), 80)} if YOUTUBE_ID.match(vid) else None
        affected = []
        for a in raw.get("affected") or []:
            if not isinstance(a, dict) or not _text(a.get("name"), 40):
                continue
            code = str(a.get("code") or "").strip().upper()
            affected.append({"name": _text(a.get("name"), 40), "code": code if STOCK_CODE.match(code) else "",
                             "direction": a.get("direction") if a.get("direction") in ("up", "down", "mixed") else "mixed"})
        importance = raw.get("importance")
        stories.append({
            "id": f"s{len(stories) + 1}", "title": title, "original_title": _text(raw.get("original_title"), 200),
            "category": raw.get("category") if raw.get("category") in CATEGORIES else "global",
            "region": "korea" if raw.get("region") == "korea" else "global",
            "impact": raw.get("impact") if raw.get("impact") in IMPACTS else "중립",
            "importance": importance if isinstance(importance, int) and 1 <= importance <= 5 else 3,
            "summary": summary, "body": body, "why_it_matters": _text(raw.get("why_it_matters"), 600),
            "affected": affected[:8], "sources": sources, "image": image, "video": video,
        })
    if len(stories) < 3:
        raise ValueError("fewer than three publishable stories")
    stories.sort(key=lambda s: -s["importance"])
    for i, story in enumerate(stories, 1):
        story["rank"] = i
    mood = payload.get("mood") if isinstance(payload.get("mood"), dict) else {}
    headline = _text(payload.get("headline"), 90)
    if not headline:
        raise ValueError("missing headline")
    return {
        "slot": slot.astimezone(KST).isoformat(timespec="minutes"),
        "edition": slot.astimezone(KST).date().isoformat(), "slot_label": f"{slot.astimezone(KST):%H:%M}",
        "generated_at": _text(payload.get("generated_at"), 40), "model": _text(payload.get("model"), 60),
        "headline": headline, "dek": _text(payload.get("dek"), 600),
        "mood": {"tone": mood.get("tone") if mood.get("tone") in ("risk-on", "risk-off", "mixed") else "mixed", "summary": _text(mood.get("summary"), 200)},
        "key_numbers": [{k: _text(n.get(k), 80) for k in ("label", "value", "change", "note")}
                        for n in payload.get("key_numbers") or [] if isinstance(n, dict) and _text(n.get("label"), 5)][:8],
        "stories": stories[:10],
        "watchlist": [{k: _text(w.get(k), 200) for k in ("when", "event", "note")}
                      for w in payload.get("watchlist") or [] if isinstance(w, dict) and _text(w.get("event"), 5)][:8],
        "takeaways": [_text(t, 300) for t in payload.get("takeaways") or [] if _text(t, 5)][:5],
    }


def _fetch(slot: dt.datetime) -> dict | None:
    local = os.environ.get("HOT_ISSUES_LOCAL_DIR")  # local preview only: tmp/hot-issues/<date>-<HHMM>.json
    if local:
        path = os.path.join(local, f"{slot.astimezone(KST):%Y-%m-%d-%H%M}.json")
        try:
            with open(path, encoding="utf-8") as fh:
                return clean(json.load(fh), slot)
        except (OSError, ValueError, TypeError, AttributeError):
            return None
    try:  # written on the server (hot_issue_writer)
        from app.services import hot_issue_store
        stored = hot_issue_store.get_edition(slot.astimezone(KST).isoformat(timespec="minutes"))
        if stored:
            return clean(stored, slot)
    except Exception:
        pass
    try:  # backup: an edition appended to the public data branch by the local tool
        response = requests.get(ARCHIVE_BASE + archive_path(slot), timeout=8)
    except requests.RequestException:
        return None
    if response.status_code != 200:
        return None
    try:
        return clean(response.json(), slot)
    except (ValueError, TypeError, AttributeError):
        return None


_memo: dict[str, tuple[float, dict | None]] = {}
_memo_lock = threading.Lock()


def edition(slot: dt.datetime) -> dict | None:
    """A published edition never changes (held an hour); a missing one is asked again after a minute."""
    key = archive_path(slot)
    with _memo_lock:
        hit = _memo.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1]
    value = _fetch(slot)
    with _memo_lock:
        _memo[key] = (time.monotonic() + (3600 if value else 60), value)
        if len(_memo) > 200:
            for stale in sorted(_memo, key=lambda k: _memo[k][0])[:50]:
                _memo.pop(stale, None)
    return value


def forget(slot: dt.datetime) -> None:
    with _memo_lock:
        _memo.pop(archive_path(slot), None)


def current(now: dt.datetime | None = None) -> dict:
    now = (now or dt.datetime.now(KST)).astimezone(KST)
    slots = recent_slots(now, 6)
    for slot in slots:
        found = edition(slot)
        if found:
            today = [s for s in slot_times(now.date()) if s <= now]
            return {**found, "latest_slot": slots[0].isoformat(timespec="minutes"), "is_latest": slot == slots[0],
                    "next_update": next_slot(now).isoformat(timespec="minutes"),
                    "today_slots": [{"slot": s.isoformat(timespec="minutes"), "label": f"{s:%H:%M}", "published": bool(edition(s))} for s in today]}
    return {"stories": [], "latest_slot": slots[0].isoformat(timespec="minutes"), "next_update": next_slot(now).isoformat(timespec="minutes"), "today_slots": []}


def log(days: int = 7, now: dt.datetime | None = None) -> list[dict]:
    now = (now or dt.datetime.now(KST)).astimezone(KST)
    rows = []
    for offset in range(days):
        for slot in reversed(slot_times(now.date() - dt.timedelta(days=offset))):
            if slot > now:
                continue
            found = edition(slot)
            rows.append({"slot": slot.isoformat(timespec="minutes"), "published": bool(found),
                         "generated_at": found.get("generated_at") if found else None, "model": found.get("model") if found else None,
                         "stories": len(found["stories"]) if found else 0, "headline": found.get("headline") if found else None,
                         "sources": sum(len(s["sources"]) for s in found["stories"]) if found else 0,
                         "images": sum(1 for s in found["stories"] if s["image"]) if found else 0,
                         "videos": sum(1 for s in found["stories"] if s["video"]) if found else 0})
    return rows


PAGE = ("오늘의 핫이슈 — 국내·해외 증시 호재·악재 한 장 정리 | KOSPIMAP",
        "매일 07:00·22:00, 국내외 증시를 움직인 핵심 이슈와 호재·악재를 한 장에 정리합니다. 해외 뉴스는 한국어로 번역해 요약합니다.")


def render_content() -> str:
    import html as _html
    esc = _html.escape
    try:
        data = current()
    except Exception:
        return ""
    if not data.get("stories"):
        return "<p>첫 판을 준비하고 있습니다. 매일 07:00·22:00에 새 판이 올라옵니다.</p>"
    parts = [f'<p><strong>{esc(data["edition"])} {esc(data["slot_label"])}판</strong> · {esc(data["headline"])}</p>',
             f'<p>{esc(data.get("dek") or "")}</p>']
    for story in data["stories"]:
        sources = " · ".join(f'<a href="{esc(s["url"])}" rel="nofollow noopener">{esc(s["publisher"])}</a>' for s in story["sources"])
        parts.append(f'<article><h2>{story["rank"]}. [{esc(story["impact"])}] {esc(story["title"])}</h2>'
                     f'<p>{esc(story["summary"])}</p>' + "".join(f"<p>{esc(p)}</p>" for p in story["body"])
                     + (f'<p>왜 중요한가: {esc(story["why_it_matters"])}</p>' if story["why_it_matters"] else "")
                     + f'<p>출처: {sources}</p></article>')
    if data.get("takeaways"):
        parts.append("<h2>핵심 정리</h2><ul>" + "".join(f"<li>{esc(t)}</li>" for t in data["takeaways"]) + "</ul>")
    return "".join(parts)


def structured_data(site: str) -> dict:
    try:
        data = current()
    except Exception:
        data = {}
    graph = [{"@type": "WebPage", "name": PAGE[0], "description": PAGE[1], "url": f"{site}/hot-issues", "inLanguage": "ko-KR",
              "isPartOf": {"@type": "WebSite", "name": "KOSPIMAP", "url": site}},
             {"@type": "BreadcrumbList", "itemListElement": [
                 {"@type": "ListItem", "position": 1, "name": "KOSPIMAP", "item": site},
                 {"@type": "ListItem", "position": 2, "name": "오늘의 핫이슈", "item": f"{site}/hot-issues"}]}]
    if data.get("stories"):
        graph.append({"@type": "Article", "headline": data["headline"][:110], "description": data.get("dek", "")[:300],
                      "datePublished": data["slot"], "dateModified": data["slot"], "inLanguage": "ko-KR",
                      "mainEntityOfPage": f"{site}/hot-issues",
                      "author": {"@type": "Organization", "name": "KOSPIMAP", "url": site},
                      "publisher": {"@type": "Organization", "name": "KOSPIMAP", "url": site}})
    return {"@context": "https://schema.org", "@graph": graph}
