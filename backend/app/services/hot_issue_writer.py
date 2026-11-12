"""Writes 오늘의 핫이슈 on the server, twice a day (07:00 and 22:00 KST).

A scheduler thread starts each edition 25 minutes before its slot (06:35 → 07:00,
21:35 → 22:00 KST). Claude Code — the same CLI and subscription token
the AI forecast uses — researches the news with WebSearch/WebFetch only and answers
in hot_issues.SCHEMA. Every source, picture and video is checked, the edition is
validated by the same rules the page reads with, and it is stored once per slot
(hot_issue_store, append-only). Each attempt is logged for the admin page.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import requests

from app.services import hot_issues as hi

log = logging.getLogger(__name__)

PROMPT = Path(__file__).resolve().parent.parent / "data" / "hot_issues_prompt.md"
LEAD = dt.timedelta(minutes=25)       # start this long before the slot
LATE_LIMIT = dt.timedelta(hours=3)    # after this, a missed slot is left for the next one
MAX_ATTEMPTS = 3
RETRY_GAP = dt.timedelta(minutes=8)
TIMEOUT = int(os.environ.get("HOT_ISSUES_TIMEOUT", "1500"))
UA = {"User-Agent": "Mozilla/5.0 (compatible; KOSPIMAP-hot-issues/1.0; +https://kospimap.com)"}
FOCUS = {
    "0700": "아침 판입니다. 밤사이 미국·유럽 증시 마감과 주요 뉴스, 그리고 오늘 국내 장 개장 전에 알아야 할 이슈(해외 증시 영향, 환율, 국내 공시·정책 일정)를 중심으로 정리합니다.",
    "1300": "점심 판입니다. 오늘 오전 국내 증시 흐름과 그 원인(수급, 업종·종목 급등락, 오전 발표된 지표·공시), 아시아 증시와 미국 선물 동향을 중심으로 정리합니다.",
    "2200": "밤 판입니다. 오늘 국내 증시 마감 결과와 원인, 장 마감 후 나온 국내 뉴스, 그리고 곧 열리는 미국 증시에 영향을 줄 이슈(경제지표, 실적, 연준·정책 발언)를 중심으로 정리합니다.",
}
_lock = threading.Lock()


def _now() -> dt.datetime:
    return dt.datetime.now(hi.KST)


def market_data() -> dict:
    """Live figures from the site's own services (read-only)."""
    from app.services import index_landing
    out: dict = {}
    for key in ("kospi", "kosdaq", "nasdaq"):
        try:
            d = index_landing.payload(key)
            live = d.get("live") or {}
            breadth = d.get("breadth") or {}
            fmt = lambda rows: [f'{s["name"]} {s["change_pct"]:+.2f}%' for s in rows[:5] if s.get("change_pct") is not None]
            out[d["name"]] = {"value": live.get("close"), "change_pct": live.get("change_pct"), "as_of": live.get("as_of"),
                              "investor_net_100m_krw": d.get("investor"), "top_gainers": fmt(breadth.get("gainers") or []),
                              "top_losers": fmt(breadth.get("losers") or [])}
            if live.get("partner"):
                out["나스닥 100"] = {"value": live["partner"].get("close"), "change_pct": live["partner"].get("change_pct")}
        except Exception as exc:
            out[key] = {"error": type(exc).__name__}
    try:
        from app.data.market_ticker_fetcher import get_market_ticker
        out["ticker"] = [{"symbol": i["symbol"], "label": i["label"], "price": i["price"], "change_pct": i["change_pct"]} for i in get_market_ticker()]
    except Exception as exc:
        out["ticker"] = {"error": type(exc).__name__}
    return out


def build_prompt(slot: dt.datetime, now: dt.datetime | None = None) -> str:
    now = now or _now()
    window = 14 if f"{slot:%H%M}" == "0700" else 10
    return PROMPT.read_text(encoding="utf-8").format(
        slot_human=f"{slot:%Y년 %m월 %d일 %H:%M}", slot_focus=FOCUS[f"{slot:%H%M}"], window_hours=window,
        data_time=now.strftime("%Y-%m-%d %H:%M KST"), market_data=json.dumps(market_data(), ensure_ascii=False, indent=1))


def _cli_env() -> dict:
    # Same rules as ai_analyst's subscription path: never fall back to metered API
    # billing because a key happens to be present, and repair a pasted token.
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    token = env.get("CLAUDE_CODE_OAUTH_TOKEN")
    if token:
        env["CLAUDE_CODE_OAUTH_TOKEN"] = "".join(token.split())
    return env


def ask_claude(prompt: str, timeout: int = TIMEOUT) -> tuple[dict, dict]:
    from app.services.ai_analyst import _redact
    exe = shutil.which(os.environ.get("CLAUDE_CLI", "claude"))
    if not exe:
        raise RuntimeError("claude CLI를 찾을 수 없습니다")
    cmd = [exe, "-p", "--output-format", "json", "--json-schema", json.dumps(hi.SCHEMA, ensure_ascii=False),
           "--tools", "WebSearch,WebFetch", "--no-session-persistence", "--allowedTools", "WebSearch", "WebFetch"]
    # Pinned: the CLI's own default on the server turned out to be Haiku, and this
    # job (weighing and translating the day's reports accurately) needs the strongest model.
    cmd[2:2] = ["--model", os.environ.get("HOT_ISSUES_MODEL", "opus")]
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="hot-issues-") as cwd:  # no repository context
        proc = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8",
                              timeout=timeout, cwd=cwd, env=_cli_env())
    if proc.returncode != 0:
        raise RuntimeError(_redact(f"claude exited {proc.returncode}: {(proc.stderr or proc.stdout)[-400:]}"))
    result = json.loads(proc.stdout)
    if result.get("is_error") or not isinstance(result.get("structured_output"), dict):
        raise RuntimeError(_redact(f"no structured output: {str(result.get('result'))[:300]}"))
    usage = {"seconds": round(time.monotonic() - started), "turns": result.get("num_turns"),
             "cost_usd": result.get("total_cost_usd"), "model": next(iter(result.get("modelUsage") or {}), "")}
    return result["structured_output"], usage


def _reachable(url: str, image: bool = False) -> bool:
    try:
        r = requests.get(url, timeout=20, headers=UA, stream=True, allow_redirects=True)
        ok = r.status_code < 400 and (not image or r.headers.get("Content-Type", "").startswith("image/"))
        r.close()
        # Some publishers refuse bots outright (401/403); the link still opens for readers.
        return ok or (not image and r.status_code in (401, 403))
    except requests.RequestException:
        return False


def verify(payload: dict) -> dict:
    """Drop what does not check out: dead sources, unlicensed or broken pictures, unembeddable videos."""
    stories = []
    for story in payload.get("stories") or []:
        if not isinstance(story, dict):
            continue
        story["sources"] = [s for s in story.get("sources") or [] if isinstance(s, dict) and _reachable(str(s.get("url", "")))]
        img = story.get("image")
        if img and not (str(img.get("url", "")).startswith("https://upload.wikimedia.org/") and img.get("license") and _reachable(img["url"], image=True)):
            story["image"] = None
        vid = story.get("video")
        if vid:
            try:
                ok = requests.get("https://www.youtube.com/oembed", timeout=15, headers=UA, params={
                    "url": f"https://www.youtube.com/watch?v={vid.get('youtube_id')}", "format": "json"}).status_code == 200
            except requests.RequestException:
                ok = False
            if not ok:
                story["video"] = None
        if story["sources"]:
            stories.append(story)
    payload["stories"] = stories
    return payload


def generate(slot: dt.datetime) -> tuple[dict, dict]:
    """Research, verify and validate one edition. Returns (raw payload, usage). Raises on failure."""
    raw, usage = ask_claude(build_prompt(slot))
    raw = verify(raw)
    raw["generated_at"] = _now().isoformat(timespec="seconds")
    raw["model"] = usage.get("model", "")
    hi.clean(raw, slot)  # raises ValueError if it is not publishable
    return raw, usage


def run_slot(slot: dt.datetime, trigger: str) -> str:
    """Write the slot's edition if it is not there yet. Returns the outcome."""
    from app.services import hot_issue_store as store
    key = slot.isoformat(timespec="minutes")
    if not _lock.acquire(blocking=False):
        return "busy"
    try:
        if store.get_edition(key):
            return "exists"
        store.log_run(key, _now().isoformat(timespec="seconds"), "started", trigger)
        try:
            raw, usage = generate(slot)
        except Exception as exc:
            detail = f"{type(exc).__name__}: {exc}"[:900]
            store.log_run(key, _now().isoformat(timespec="seconds"), "failed", trigger, detail)
            log.warning("hot issues %s failed: %s", key, detail)
            return "failed"
        created = store.save_edition(key, raw, raw.get("model", ""), raw["generated_at"])
        hi.forget(slot)
        store.log_run(key, _now().isoformat(timespec="seconds"), "published" if created else "exists", trigger,
                      json.dumps({**usage, "stories": len(raw["stories"]),
                                  "images": sum(1 for s in raw["stories"] if s.get("image")),
                                  "videos": sum(1 for s in raw["stories"] if s.get("video"))}, ensure_ascii=False))
        _published.add(key)
        return "published" if created else "exists"
    finally:
        _lock.release()


def due_slot(now: dt.datetime | None = None) -> dt.datetime | None:
    """The slot to write now: the one starting within LEAD, or a missed one still within LATE_LIMIT."""
    now = now or _now()
    slot = hi.current_slot(now + LEAD)
    return slot if now - slot <= LATE_LIMIT else None


_published: set[str] = set()


def _should_try(slot: dt.datetime, now: dt.datetime) -> bool:
    from app.services import hot_issue_store as store
    key = slot.isoformat(timespec="minutes")
    if key in _published:
        return False
    if store.get_edition(key):
        _published.add(key)
        return False
    runs = store.runs_for(key)
    # Starts, not failures: a run cut off by a restart never logs a failure either.
    if sum(1 for r in runs if r["event"] == "started") >= MAX_ATTEMPTS:
        return False
    last = max((r["at"] for r in runs), default="")
    return not last or now - dt.datetime.fromisoformat(last) >= RETRY_GAP


def _loop() -> None:
    time.sleep(90)  # let the app finish starting
    while True:
        try:
            now = _now()
            slot = due_slot(now)
            if slot and _should_try(slot, now):
                run_slot(slot, "schedule")
        except Exception:
            log.exception("hot issues scheduler tick failed")
        time.sleep(60)


def start_scheduler() -> None:
    if os.environ.get("HOT_ISSUES_SCHEDULER", "1") == "0":
        return
    threading.Thread(target=_loop, daemon=True, name="hot-issues-writer").start()
