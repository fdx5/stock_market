"""오늘의 급등·급락 이유: every KOSPI/KOSDAQ trading day at 09:20, 12:30 and 16:00 KST.

Collects the whole-market top gainers and losers (Naver ranking feeds), attaches each
name's latest news and a 20-day price line, asks Claude to explain each move in plain
Korean from that news only, and stores the edition once (movers_store, append-only).
If the model is unavailable the edition still publishes, with news headlines as reasons.
"""
from __future__ import annotations

import datetime as dt
import html
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

import requests

log = logging.getLogger(__name__)
KST = ZoneInfo("Asia/Seoul")
SLOTS = ((9, 20), (12, 30), (16, 0))
SLOT_NAMES = {"0920": "장 초반", "1230": "점심", "1600": "장 마감"}
# SNS edition per slot; links carry utm_campaign=<edition>-<YYYYMMDD> so each post's visits can be counted.
SOCIAL_EDITIONS = {"0920": "movers_open", "1230": "movers_noon", "1600": "movers_close"}
UA = {"User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36"}
GAINERS, LOSERS = 10, 6
MIN_TURNOVER_M = 3_000      # 30억원 (Naver reports 백만원)
MIN_MARCAP_100M = 500       # 500억원 (Naver reports 억원)
EXCLUDE = re.compile(r"스팩|\d*우[A-C]?$|우\(전환\)$|ETN|리츠$")
LATE_LIMIT = dt.timedelta(hours=2)
MAX_ATTEMPTS = 3
RETRY_GAP = dt.timedelta(minutes=6)

SCHEMA: dict = {
    "type": "object",
    "required": ["headline", "dek", "social_hook", "hashtags", "themes", "stocks"],
    "properties": {
        "headline": {"type": "string", "description": "페이지 제목. 45자 이내. 가장 눈에 띄는 종목·숫자를 앞에. 이모지 금지."},
        "dek": {"type": "string", "description": "오늘 시장 흐름 2~3문장 요약. 쉬운 말."},
        "social_hook": {"type": "string", "description": "SNS 첫 문장. 32자 이내. 궁금해서 누르고 싶게. 이모지·느낌표 남발 금지."},
        "hashtags": {"type": "array", "maxItems": 4, "items": {"type": "string"},
                     "description": "오늘 내용에서 사람들이 실제로 검색할 해시태그 2~4개. # 없이, 띄어쓰기 없이. 종목명·테마명 위주."},
        "themes": {"type": "array", "maxItems": 4, "items": {"type": "object", "required": ["name", "codes"],
                   "properties": {"name": {"type": "string"}, "codes": {"type": "array", "items": {"type": "string"}}}}},
        "stocks": {"type": "array", "items": {"type": "object", "required": ["code", "reason", "theme"],
                   "properties": {"code": {"type": "string"},
                                  "reason": {"type": "string", "description": "움직인 이유 2~3문장. 제공된 뉴스에 근거."},
                                  "theme": {"type": "string", "description": "8자 이내 테마·재료 키워드"}}}},
    },
}

PROMPT = """당신은 증권 전문 기자입니다. 아래는 {when} 기준 코스피·코스닥 전 종목 중 급등·급락 상위 종목과 각 종목의 최근 뉴스 제목·요약입니다.

할 일:
1. 종목마다 왜 올랐는지/내렸는지 2~3문장으로 설명하세요. 제공된 뉴스에서 확인되는 사실만 쓰고, 뉴스로 이유가 확인되지 않으면 "뚜렷한 공시나 뉴스 없이 수급이 몰렸다"처럼 솔직하게 쓰세요. 수치(등락률, 거래대금)를 한 번 넣어 주세요.
2. 종목마다 8자 이내 테마·재료 키워드(예: 2차전지, 수주, 실적, 임상, 무상증자)를 붙이세요.
3. 여러 종목이 같은 재료로 움직였다면 themes로 묶으세요.
4. headline: 오늘 가장 이야기거리가 되는 움직임을 숫자와 함께 45자 이내로. 예) "상한가 3종목, 로봇주가 시장을 끌었다"
5. dek: 지수 흐름과 급등락 종목의 공통점을 2~3문장으로.
6. social_hook: SNS 첫 줄. 32자 이내, 클릭하고 싶게, 과장·허위 금지.
7. hashtags: 오늘 내용에서 사람들이 검색할 해시태그 2~4개(종목명·테마명). 기본 태그(#급등주 #특징주 #주식)는 자동으로 붙으니 넣지 마세요.
{feedback}
문체 규칙: 신문 기사처럼 짧고 쉬운 '~했다/~이다'체. 이모지, 특수 아이콘, "주목할 만하다", "눈여겨볼", "살펴보겠습니다", "~것으로 보입니다" 같은 상투적·AI스러운 표현 금지. 투자 권유 금지.

지수: {indices}

종목 데이터(JSON):
{stocks}
"""


def _now() -> dt.datetime:
    return dt.datetime.now(KST)


# ------------------------------------------------------------------ slots
def slot_times(day: dt.date) -> list[dt.datetime]:
    return [dt.datetime(day.year, day.month, day.day, h, m, tzinfo=KST) for h, m in SLOTS]


def parse_slot(day: str, hhmm: str) -> dt.datetime | None:
    try:
        date = dt.date.fromisoformat(day)
    except ValueError:
        return None
    return next((s for s in slot_times(date) if f"{s:%H%M}" == hhmm), None)


def key(slot: dt.datetime) -> str:
    return slot.astimezone(KST).isoformat(timespec="minutes")


def is_trading_day(day: dt.date) -> bool:
    try:
        from app.services.trading_calendar import is_trading_day as check
        return check(day, "KR")
    except Exception:
        return day.weekday() < 5


def due_slot(now: dt.datetime | None = None) -> dt.datetime | None:
    now = (now or _now()).astimezone(KST)
    if not is_trading_day(now.date()):
        return None
    for slot in reversed(slot_times(now.date())):
        if slot <= now:
            return slot if now - slot <= LATE_LIMIT else None
    return None


# ------------------------------------------------------------------ collection
def _num(value) -> float | None:
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _get(url: str, **params):
    response = requests.get(url, params=params, headers=UA, timeout=8)
    response.raise_for_status()
    return response.json()


def _ranking(direction: str, market: str) -> list[dict]:
    data = _get(f"https://m.stock.naver.com/api/stocks/{direction}/{market}", page=1, pageSize=80)
    rows = []
    for item in data.get("stocks") or []:
        name = str(item.get("stockName") or "")
        pct, turnover, marcap = _num(item.get("fluctuationsRatio")), _num(item.get("accumulatedTradingValue")), _num(item.get("marketValue"))
        if (item.get("stockEndType") != "stock" or EXCLUDE.search(name) or pct is None
                or (turnover or 0) < MIN_TURNOVER_M or (marcap or 0) < MIN_MARCAP_100M):
            continue
        status = (item.get("compareToPreviousPrice") or {}).get("name") or ""
        rows.append({"code": item["itemCode"], "name": name, "market": "코스피" if market == "KOSPI" else "코스닥",
                     "close": _num(item.get("closePrice")), "change_pct": pct,
                     "limit": "상한가" if status == "UPPER_LIMIT" else "하한가" if status == "LOWER_LIMIT" else "",
                     "turnover_100m": round((turnover or 0) / 100), "marcap_100m": round(marcap or 0)})
    return rows


def _news(code: str) -> list[dict]:
    try:
        data = _get(f"https://m.stock.naver.com/api/news/stock/{code}", pageSize=6, page=1)
    except Exception:
        return []
    cutoff = (_now() - dt.timedelta(days=4)).strftime("%Y%m%d%H%M")
    out = []
    for group in data or []:
        for item in group.get("items") or []:
            stamp = str(item.get("datetime") or "")
            if stamp < cutoff or not item.get("title"):
                continue
            out.append({"title": html.unescape(str(item["title"])).strip()[:120],
                        "summary": html.unescape(str(item.get("body") or "")).strip()[:160],
                        "press": str(item.get("officeName") or "")[:30],
                        "at": f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:8]} {stamp[8:10]}:{stamp[10:12]}",
                        "url": item.get("mobileNewsUrl") or f"https://n.news.naver.com/mnews/article/{item.get('officeId')}/{item.get('articleId')}"})
    return out[:4]


def _line(code: str) -> list[float]:
    end = _now()
    start = end - dt.timedelta(days=45)
    try:
        rows = _get(f"https://api.stock.naver.com/chart/domestic/item/{code}/day",
                    startDateTime=f"{start:%Y%m%d}0000", endDateTime=f"{end:%Y%m%d}2359")
        return [float(r["closePrice"]) for r in rows if r.get("closePrice")][-20:]
    except Exception:
        return []


def _index(code: str) -> dict:
    try:
        d = _get(f"https://m.stock.naver.com/api/index/{code}/basic")
        return {"name": d.get("stockName") or code, "close": _num(d.get("closePrice")), "change_pct": _num(d.get("fluctuationsRatio"))}
    except Exception:
        return {"name": code, "close": None, "change_pct": None}


def collect() -> dict:
    with ThreadPoolExecutor(max_workers=4) as pool:
        up_kp, up_kq, dn_kp, dn_kq = pool.map(lambda a: _ranking(*a), (("up", "KOSPI"), ("up", "KOSDAQ"), ("down", "KOSPI"), ("down", "KOSDAQ")))
    gainers = sorted(up_kp + up_kq, key=lambda r: -r["change_pct"])[:GAINERS]
    losers = sorted(dn_kp + dn_kq, key=lambda r: r["change_pct"])[:LOSERS]
    picked = [r for r in gainers if r["change_pct"] > 0] + [r for r in losers if r["change_pct"] < 0]
    if len(picked) < 6:
        raise RuntimeError("not enough movers")
    with ThreadPoolExecutor(max_workers=8) as pool:
        news = list(pool.map(lambda r: _news(r["code"]), picked))
        lines = list(pool.map(lambda r: _line(r["code"]), picked))
    for row, items, line in zip(picked, news, lines):
        row["news"], row["line"] = items, line
        row["direction"] = "up" if row["change_pct"] > 0 else "down"
    return {"indices": [_index("KOSPI"), _index("KOSDAQ")], "stocks": picked,
            "limit_up": sum(1 for r in up_kp + up_kq if r["limit"] == "상한가"),
            "limit_down": sum(1 for r in dn_kp + dn_kq if r["limit"] == "하한가")}


# ------------------------------------------------------------------ writing
def _cli_env() -> dict:
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    token = env.get("CLAUDE_CODE_OAUTH_TOKEN")
    if token:
        env["CLAUDE_CODE_OAUTH_TOKEN"] = "".join(token.split())
    return env


def ask_claude(prompt: str, timeout: int = 420) -> tuple[dict, str]:
    exe = shutil.which(os.environ.get("CLAUDE_CLI", "claude"))
    if not exe:
        raise RuntimeError("claude CLI not found")
    cmd = [exe, "-p", "--model", os.environ.get("MOVERS_MODEL", "opus"), "--output-format", "json",
           "--json-schema", json.dumps(SCHEMA, ensure_ascii=False), "--tools", "", "--no-session-persistence"]
    with tempfile.TemporaryDirectory(prefix="movers-") as cwd:
        proc = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8",
                              timeout=timeout, cwd=cwd, env=_cli_env())
    if proc.returncode != 0:
        raise RuntimeError(f"claude exited {proc.returncode}")
    result = json.loads(proc.stdout)
    if result.get("is_error") or not isinstance(result.get("structured_output"), dict):
        raise RuntimeError("no structured output")
    return result["structured_output"], next(iter(result.get("modelUsage") or {}), "")


def _pct(v: float) -> str:
    return f"{v:+.2f}%".replace("+", "+")


def _fallback(data: dict) -> dict:
    stocks = data["stocks"]
    top = stocks[0]
    ups = [s for s in stocks if s["direction"] == "up"]
    downs = [s for s in stocks if s["direction"] == "down"]
    kp = data["indices"][0]
    for s in stocks:
        lead = s["news"][0]["title"] if s["news"] else ""
        verb = "올랐다" if s["direction"] == "up" else "내렸다"
        s["reason"] = (f"'{lead}' 소식이 전해진 가운데 {abs(s['change_pct']):.1f}% {verb}. 거래대금은 {s['turnover_100m']:,}억원."
                       if lead else f"뚜렷한 뉴스 없이 거래대금 {s['turnover_100m']:,}억원이 몰리며 {abs(s['change_pct']):.1f}% {verb}.")
        s["theme"] = s["limit"] or ("급등" if s["direction"] == "up" else "급락")
    return {
        "headline": f"{top['name']} {_pct(top['change_pct'])}, 오늘 가장 많이 오른 종목은",
        "dek": (f"코스피는 {_pct(kp['change_pct'])}로 거래를 이어갔다. " if kp.get("change_pct") is not None else "")
               + f"상승률 상위 {len(ups)}종목과 하락률 상위 {len(downs)}종목의 움직임과 관련 뉴스를 정리했다.",
        "social_hook": f"{top['name']} {_pct(top['change_pct'])}, 이유가 뭘까",
        "hashtags": [re.sub(r"[^0-9A-Za-z가-힣]", "", s["name"]) for s in ups[:2]],
        "themes": [],
    }


AI_TELLS = re.compile(r"[\U0001F300-\U0001FAFF☀-➿]|주목할 만|눈여겨|살펴보겠|것으로 보입니다")


def _plain(text: str, limit: int) -> str:
    text = AI_TELLS.sub("", " ".join(str(text or "").split()))
    return text.strip()[:limit]


def social_feedback(days: int = 14) -> str:
    """Past posts' first lines and hashtags with the visits each brought, best and worst."""
    from app.services import movers_store, page_view_store
    since = (_now() - dt.timedelta(days=days)).astimezone(dt.timezone.utc).isoformat(timespec="seconds")
    visits: dict[str, int] = {}
    for row in page_view_store.social_campaign_views(since):
        visits[row["campaign"]] = visits.get(row["campaign"], 0) + row["visitors"]
    posts = []
    for campaign, count in visits.items():
        m = re.fullmatch(r"(movers_\w+)-(\d{8})", campaign or "")
        hhmm = next((h for h, e in SOCIAL_EDITIONS.items() if m and e == m.group(1)), None)
        if not hhmm:
            continue
        day = f"{m.group(2)[:4]}-{m.group(2)[4:6]}-{m.group(2)[6:]}"
        stored = movers_store.get_edition(f"{day}T{hhmm[:2]}:{hhmm[2:]}+09:00")
        if stored and stored.get("social_hook"):
            posts.append((count, stored["social_hook"], stored.get("hashtags") or []))
    if len(posts) < 3:
        return ""
    posts.sort(key=lambda p: -p[0])
    line = lambda p: f'- 유입 {p[0]}명: "{p[1]}" 해시태그 {" ".join("#" + t for t in p[2])}'
    return ("\n지난 SNS 게시글 반응(링크로 들어온 방문자 수). 반응이 좋았던 첫 문장과 해시태그의 특징(숫자, 종목명, 궁금증 유발 방식)을 "
            "참고해 더 나은 문장을 쓰세요. 그대로 베끼지는 마세요.\n반응 좋음:\n" + "\n".join(map(line, posts[:3]))
            + "\n반응 낮음:\n" + "\n".join(map(line, posts[-3:])) + "\n")


def generate(slot: dt.datetime) -> dict:
    data = collect()
    payload = _fallback(data)
    model = ""
    when = f"{slot:%Y년 %m월 %d일 %H:%M}"
    try:
        lean = [{k: s[k] for k in ("code", "name", "market", "change_pct", "limit", "turnover_100m", "marcap_100m")}
                | {"news": [{"title": n["title"], "summary": n["summary"], "at": n["at"]} for n in s["news"]]} for s in data["stocks"]]
        try:
            feedback = social_feedback()
        except Exception:
            feedback = ""
        written, model = ask_claude(PROMPT.format(when=when, feedback=feedback, indices=json.dumps(data["indices"], ensure_ascii=False),
                                                  stocks=json.dumps(lean, ensure_ascii=False)))
        by_code = {str(w.get("code")): w for w in written.get("stocks") or []}
        for s in data["stocks"]:
            w = by_code.get(s["code"])
            if w and w.get("reason"):
                s["reason"], s["theme"] = _plain(w["reason"], 400), _plain(w.get("theme"), 12) or s["theme"]
        codes = {s["code"] for s in data["stocks"]}
        payload = {"headline": _plain(written.get("headline"), 60) or payload["headline"],
                   "dek": _plain(written.get("dek"), 300) or payload["dek"],
                   "social_hook": _plain(written.get("social_hook"), 40) or payload["social_hook"],
                   "hashtags": [t for t in (re.sub(r"[^0-9A-Za-z가-힣]", "", str(h)) for h in written.get("hashtags") or []) if 2 <= len(t) <= 20][:4],
                   "themes": [{"name": _plain(t.get("name"), 14), "codes": [c for c in t.get("codes") or [] if c in codes]}
                              for t in written.get("themes") or [] if t.get("name")][:4]}
    except Exception as exc:
        log.warning("movers writer fell back to headlines: %s", type(exc).__name__)
    slot = slot.astimezone(KST)
    return {**payload, **data, "slot": key(slot), "edition": slot.date().isoformat(), "slot_label": f"{slot:%H:%M}",
            "slot_name": SLOT_NAMES.get(f"{slot:%H%M}", ""), "generated_at": _now().isoformat(timespec="seconds"),
            "model": model or "headlines"}


_lock = threading.Lock()
_published: set[str] = set()


def run_slot(slot: dt.datetime, trigger: str) -> str:
    from app.services import movers_store as store
    k = key(slot)
    if not _lock.acquire(blocking=False):
        return "busy"
    try:
        if store.get_edition(k):
            return "exists"
        store.log_run(k, _now().isoformat(timespec="seconds"), "started", trigger)
        try:
            payload = generate(slot)
        except Exception as exc:
            store.log_run(k, _now().isoformat(timespec="seconds"), "failed", trigger, f"{type(exc).__name__}: {exc}"[:500])
            return "failed"
        created = store.save_edition(k, payload, payload["model"], payload["generated_at"])
        forget(slot)
        store.log_run(k, _now().isoformat(timespec="seconds"), "published" if created else "exists", trigger,
                      json.dumps({"stocks": len(payload["stocks"]), "model": payload["model"]}))
        _published.add(k)
        return "published" if created else "exists"
    finally:
        _lock.release()


def _should_try(slot: dt.datetime, now: dt.datetime) -> bool:
    from app.services import movers_store as store
    k = key(slot)
    if k in _published:
        return False
    if store.get_edition(k):
        _published.add(k)
        return False
    runs = store.runs_for(k)
    if sum(1 for r in runs if r["event"] == "started") >= MAX_ATTEMPTS:
        return False
    last = max((r["at"] for r in runs), default="")
    return not last or now - dt.datetime.fromisoformat(last) >= RETRY_GAP


def _loop() -> None:
    time.sleep(120)
    while True:
        try:
            now = _now()
            slot = due_slot(now)
            if slot and _should_try(slot, now):
                run_slot(slot, "schedule")
        except Exception:
            log.exception("movers scheduler tick failed")
        time.sleep(45)


def start_scheduler() -> None:
    if os.environ.get("MOVERS_SCHEDULER", "1") == "0":
        return
    threading.Thread(target=_loop, daemon=True, name="movers-writer").start()


# ------------------------------------------------------------------ reading
_memo: dict[str, tuple[float, dict | None]] = {}
_memo_lock = threading.Lock()


def edition(slot: dt.datetime) -> dict | None:
    k = key(slot)
    with _memo_lock:
        hit = _memo.get(k)
        if hit and hit[0] > time.monotonic():
            return hit[1]
    try:
        from app.services import movers_store
        value = movers_store.get_edition(k)
    except Exception:
        value = None
    with _memo_lock:
        _memo[k] = (time.monotonic() + (3600 if value else 60), value)
        if len(_memo) > 200:
            for stale in sorted(_memo, key=lambda x: _memo[x][0])[:50]:
                _memo.pop(stale, None)
    return value


def forget(slot: dt.datetime) -> None:
    with _memo_lock:
        _memo.pop(key(slot), None)


def _recent(now: dt.datetime, days: int = 7) -> list[dt.datetime]:
    out = []
    for offset in range(days):
        day = now.date() - dt.timedelta(days=offset)
        out += [s for s in reversed(slot_times(day)) if s <= now]
    return out


def next_slot(now: dt.datetime) -> dt.datetime:
    day = now.date()
    for _ in range(10):
        if is_trading_day(day):
            for s in slot_times(day):
                if s > now:
                    return s
        day += dt.timedelta(days=1)
    return slot_times(day)[0]


def current(now: dt.datetime | None = None) -> dict:
    now = (now or _now()).astimezone(KST)
    for slot in _recent(now):
        found = edition(slot)
        if found:
            day = slot.date()
            return {**found, "next_update": key(next_slot(now)),
                    "day_slots": [{"slot": key(s), "label": f"{s:%H:%M}", "name": SLOT_NAMES[f"{s:%H%M}"],
                                   "published": bool(edition(s))} for s in slot_times(day) if s <= now]}
    return {"stocks": [], "next_update": key(next_slot(now)), "day_slots": []}


def for_stock(code: str, now: dt.datetime | None = None) -> dict | None:
    """The stock's entry in the latest edition of the last two days, for the stock page."""
    data = current(now)
    if not data.get("stocks") or data["edition"] < ((now or _now()) - dt.timedelta(days=3)).date().isoformat():
        return None
    for s in data["stocks"]:
        if s["code"] == code:
            return {"edition": data["edition"], "slot_label": data["slot_label"], "path": edition_path(data),
                    **{k: s.get(k) for k in ("name", "change_pct", "reason", "theme", "limit", "direction")}}
    return None


# ------------------------------------------------------------------ SEO
PAGE = ("오늘 급등주·급락주 이유 총정리 — 상한가·특징주 실시간 | KOSPIMAP",
        "코스피·코스닥 급등주와 급락주가 왜 움직였는지 뉴스 근거로 쉽게 정리합니다. 평일 09:20·12:30·16:00 업데이트, 상한가·하한가·테마 흐름과 20일 차트를 한 번에 확인하세요.")


def edition_path(data: dict) -> str:
    return f"/movers/{data['edition']}/{data['slot_label'].replace(':', '')}"


def edition_metadata(data: dict) -> tuple[str, str]:
    ups = sorted((s for s in data["stocks"] if s["direction"] == "up"), key=lambda s: -s["turnover_100m"])
    names = ", ".join(s["name"] for s in (ups or data["stocks"])[:3])
    return (f"{data['edition'][5:].replace('-', '/')} {data['slot_name']} 급등주 이유: {names} | KOSPIMAP",
            f"{data['headline']} — {data['dek']}"[:160])


def sitemap_editions(now: dt.datetime | None = None) -> list[tuple[str, str]]:
    from app.services import movers_store
    now = (now or _now()).astimezone(KST)
    out = []
    for k in movers_store.published_slots(now.isoformat(timespec="minutes"), 200):
        slot = parse_slot(k[:10], k[11:16].replace(":", ""))
        if slot and key(slot) == k and slot <= now:
            out.append((f"/movers/{slot:%Y-%m-%d/%H%M}", k[:10]))
    return out


def render_content(data: dict, archive: bool = False) -> str:
    esc = html.escape
    if not data.get("stocks"):
        return "<p>평일 09:20 · 12:30 · 16:00에 급등·급락 종목과 이유를 정리합니다.</p>"
    parts = [f'<p><strong>{esc(data["edition"])} {esc(data["slot_label"])} {esc(data["slot_name"])}</strong> · {esc(data["headline"])}</p>',
             f'<p>{esc(data["dek"])}</p>']
    if archive:
        parts.append('<p><a href="/movers">최신 급등·급락 이유 보기</a></p>')
    for title, direction in (("급등주와 오른 이유", "up"), ("급락주와 내린 이유", "down")):
        rows = [s for s in data["stocks"] if s["direction"] == direction]
        if not rows:
            continue
        parts.append(f"<h2>{title}</h2>")
        for s in rows:
            verb = "급등" if direction == "up" else "급락"
            news = " · ".join(f'<a href="{esc(n["url"])}" rel="nofollow noopener">{esc(n["press"])}: {esc(n["title"])}</a>' for n in s["news"][:2])
            parts.append(f'<article><h3><a href="/stock/{esc(s["code"])}">{esc(s["name"])}</a> {verb} 이유 ({s["change_pct"]:+.2f}%{" · " + esc(s["limit"]) if s["limit"] else ""})</h3>'
                         f'<p>{esc(s.get("reason", ""))}</p><p>{esc(s["market"])} · 종가 {s["close"]:,.0f}원 · 거래대금 {s["turnover_100m"]:,}억원 · 테마 {esc(s.get("theme", ""))}</p>'
                         + (f"<p>관련 뉴스: {news}</p>" if news else "") + "</article>")
    return "".join(parts)


def structured_data(site: str, data: dict, archive: bool = False) -> dict:
    path = edition_path(data) if archive and data.get("stocks") else "/movers"
    title, description = edition_metadata(data) if archive and data.get("stocks") else PAGE
    url = site + path
    graph = [{"@type": "WebPage", "name": title, "description": description, "url": url, "inLanguage": "ko-KR",
              "isPartOf": {"@type": "WebSite", "name": "KOSPIMAP", "url": site}},
             {"@type": "BreadcrumbList", "itemListElement": [
                 {"@type": "ListItem", "position": 1, "name": "KOSPIMAP", "item": site},
                 {"@type": "ListItem", "position": 2, "name": "급등·급락 이유", "item": f"{site}/movers"}]}]
    if data.get("stocks"):
        graph.append({"@type": "NewsArticle", "headline": data["headline"][:110], "description": data["dek"][:300],
                      "datePublished": data["generated_at"], "dateModified": data["generated_at"], "inLanguage": "ko-KR",
                      "mainEntityOfPage": url, "image": f"{site}/movers/og/{data['edition']}/{data['slot_label'].replace(':', '')}.png",
                      "author": {"@type": "Organization", "name": "KOSPIMAP", "url": site},
                      "publisher": {"@type": "Organization", "name": "KOSPIMAP", "url": site}})
    return {"@context": "https://schema.org", "@graph": graph}
