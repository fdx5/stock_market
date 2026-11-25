"""급등·급락 이유: 국내(코스피·코스닥)와 미국(나스닥100)을 따로, 하루 세 판씩.

KR: KRX trading days at 09:20, 12:30 and 16:00 KST, whole-market Naver rankings.
US: US trading sessions at 21:00 (pre-market), 00:40 (first hour) and 06:40 (close) KST,
    the NASDAQ-100 from the site's own map feed (extended-hours aware).

Each edition attaches every name's latest news and a 20-session price line, asks Claude
to explain each move in plain Korean from that news only, and is stored once
(movers_store, append-only; US keys are prefixed "us:"). If the model is unavailable the
edition still publishes, with news headlines as reasons.
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
MARKETS = ("kr", "us")
SLOTS = {"kr": ((9, 20), (12, 30), (16, 0)), "us": ((21, 0), (0, 40), (6, 40))}
SLOT_NAMES = {"0920": "장 초반", "1230": "점심", "1600": "장 마감", "2100": "프리마켓", "0040": "개장 직후", "0640": "마감"}
# SNS edition per slot; links carry utm_campaign=<edition>-<YYYYMMDD> so each post's visits can be counted.
SOCIAL_EDITIONS = {"kr": {"0920": "movers_open", "1230": "movers_noon", "1600": "movers_close"},
                   "us": {"2100": "us_movers_pre", "0040": "us_movers_open", "0640": "us_movers_close"}}
UA = {"User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36"}
GAINERS, LOSERS = {"kr": 10, "us": 8}, {"kr": 6, "us": 6}
MIN_TURNOVER_M = 3_000      # 30억원 (Naver reports 백만원)
MIN_MARCAP_100M = 500       # 500억원 (Naver reports 억원)
EXCLUDE = re.compile(r"스팩|\d*우[A-C]?$|우\(전환\)$|ETN|리츠$")
LATE_LIMIT = dt.timedelta(hours=2)
# Closing editions stay true for hours, so a missed run may still be written late.
LATE_LIMITS = {"1600": dt.timedelta(hours=7), "0640": dt.timedelta(hours=5), "2100": dt.timedelta(hours=2)}
MAX_ATTEMPTS = 3
RETRY_GAP = dt.timedelta(minutes=6)

SCHEMA: dict = {
    "type": "object",
    "required": ["headline", "dek", "social_hook", "hashtags", "themes", "stocks"],
    "properties": {
        "headline": {"type": "string", "description": "페이지 제목. 45자 이내. 가장 눈에 띄는 종목·숫자를 앞에. 이모지 금지."},
        "dek": {"type": "string", "description": "시장 흐름 2~3문장 요약. 쉬운 말."},
        "social_hook": {"type": "string", "description": "SNS 첫 문장. 32자 이내. 궁금해서 누르고 싶게. 이모지·느낌표 남발 금지."},
        "hashtags": {"type": "array", "maxItems": 4, "items": {"type": "string"},
                     "description": "사람들이 실제로 검색할 해시태그 2~4개. # 없이, 띄어쓰기 없이. 종목명·테마명 위주."},
        "themes": {"type": "array", "maxItems": 4, "items": {"type": "object", "required": ["name", "codes"],
                   "properties": {"name": {"type": "string"}, "codes": {"type": "array", "items": {"type": "string"}}}}},
        "stocks": {"type": "array", "items": {"type": "object", "required": ["code", "reason", "theme"],
                   "properties": {"code": {"type": "string"},
                                  "reason": {"type": "string", "description": "움직인 이유 6~8문장(350~550자). 뉴스에 근거."},
                                  "theme": {"type": "string", "description": "8자 이내 테마·재료 키워드"}}}},
    },
}

UNIVERSE = {"kr": "코스피·코스닥 전 종목 중 급등·급락 상위 종목",
            "us": "미국 나스닥100 구성 종목 중 급등·급락 상위 종목(장 시작 전·후에는 시간외 가격 기준)"}
CHECKS = {"kr": "공시, 실적, 거래소 조회공시 답변 등", "us": "실적 발표 일정, 가이던스, 애널리스트 의견 변화 등"}
BASE_TAGS_NOTE = {"kr": "#급등주 #특징주 #주식", "us": "#미국주식 #나스닥 #해외주식"}

PROMPT = """당신은 증권 전문 기자입니다. 아래는 {when}(한국 시간) 기준 {universe}과 각 종목의 최근 뉴스 제목·요약입니다.

할 일:
1. 종목마다 왜 올랐는지/내렸는지 6~8문장(350~550자)으로 충실하게 설명하세요. 주식을 잘 모르는 사람도 이해할 수 있게 다음 순서로 쓰세요: ①이 회사가 무엇을 하는 곳인지 한 문장 ②오늘 나온 소식(재료)을 구체적으로(누가, 무엇을, 얼마나) ③그 소식이 왜 주가를 움직이는지 쉬운 말로 ④같은 업종·시장 분위기와의 관계 ⑤거래대금·시가총액·최근 20거래일 흐름(ret_20d) 숫자로 본 수급 ⑥앞으로 확인할 점({checks})과 주의할 점. 제공된 뉴스에서 확인되는 사실만 쓰고, 뉴스로 이유가 확인되지 않으면 "뚜렷한 뉴스 없이 매수세가 몰렸다"처럼 솔직하게 쓰세요.
2. 종목마다 8자 이내 테마·재료 키워드(예: 2차전지, 수주, 실적, AI반도체, 임상)를 붙이세요.
3. 여러 종목이 같은 재료로 움직였다면 themes로 묶으세요.
4. headline: 가장 이야기거리가 되는 움직임을 숫자와 함께 45자 이내로. 예) "상한가 3종목, 로봇주가 시장을 끌었다"
5. dek: 지수 흐름과 급등락 종목의 공통점을 2~3문장으로.
6. social_hook: SNS 첫 줄. 32자 이내, 클릭하고 싶게, 과장·허위 금지.
7. hashtags: 사람들이 검색할 해시태그 2~4개(종목명·테마명, 한국어 우선). 기본 태그({base_tags})는 자동으로 붙으니 넣지 마세요.
{feedback}
문체 규칙: 신문 기사처럼 짧고 쉬운 '~했다/~이다'체. 미국 종목은 한국어 이름을 쓰세요. 이모지, 특수 아이콘, "주목할 만하다", "눈여겨볼", "살펴보겠습니다", "~것으로 보입니다" 같은 상투적·AI스러운 표현 금지. "제공된 뉴스", "주어진 자료"처럼 자료 출처를 언급하지 말고 기자가 직접 취재한 기사처럼 쓰세요. 투자 권유 금지.

지수: {indices}

종목 데이터(JSON):
{stocks}
"""


def _now() -> dt.datetime:
    return dt.datetime.now(KST)


# ------------------------------------------------------------------ slots
def slot_times(day: dt.date, market: str = "kr") -> list[dt.datetime]:
    """KR: the slots of that KST day. US: the slots of that US session (21:00 the same KST day, the rest the next)."""
    out = []
    for h, m in SLOTS[market]:
        d = day + dt.timedelta(days=1) if market == "us" and h < 12 else day
        out.append(dt.datetime(d.year, d.month, d.day, h, m, tzinfo=KST))
    return out


def session_day(slot: dt.datetime, market: str) -> dt.date:
    return (slot - dt.timedelta(hours=12)).date() if market == "us" else slot.date()


def parse_slot(day: str, hhmm: str, market: str = "kr") -> dt.datetime | None:
    try:
        date = dt.date.fromisoformat(day)
    except ValueError:
        return None
    sessions = (date, date - dt.timedelta(days=1)) if market == "us" else (date,)
    return next((s for d in sessions for s in slot_times(d, market) if s.date() == date and f"{s:%H%M}" == hhmm), None)


def key(slot: dt.datetime, market: str = "kr") -> str:
    iso = slot.astimezone(KST).isoformat(timespec="minutes")
    return f"us:{iso}" if market == "us" else iso


def is_trading_day(day: dt.date, market: str = "kr") -> bool:
    try:
        from app.services.trading_calendar import is_trading_day as check
        return check(day, "US" if market == "us" else "KR")
    except Exception:
        return day.weekday() < 5


def _candidates(now: dt.datetime, market: str, back: int = 1, ahead: int = 0) -> list[dt.datetime]:
    slots = []
    for offset in range(-back, ahead + 1):
        d = now.date() + dt.timedelta(days=offset)
        if is_trading_day(d, market):
            slots += slot_times(d, market)
    return sorted(slots)


def due_slot(now: dt.datetime | None = None, market: str = "kr") -> dt.datetime | None:
    now = (now or _now()).astimezone(KST)
    past = [s for s in _candidates(now, market) if s <= now]
    if not past:
        return None
    slot = past[-1]
    return slot if now - slot <= LATE_LIMITS.get(f"{slot:%H%M}", LATE_LIMIT) else None


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


def _us_news(rc: str) -> list[dict]:
    try:
        data = _get(f"https://api.stock.naver.com/news/worldStock/{rc}", pageSize=6, page=1)
    except Exception:
        return []
    cutoff = (_now() - dt.timedelta(days=4)).strftime("%Y%m%d%H%M%S")
    out = []
    for item in data or []:
        stamp = str(item.get("dt") or "")
        if stamp < cutoff or not item.get("tit"):
            continue
        out.append({"title": html.unescape(str(item["tit"])).strip()[:120],
                    "summary": html.unescape(str(item.get("subcontent") or "")).strip()[:160],
                    "press": str(item.get("ohnm") or "")[:30],
                    "at": f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:8]} {stamp[8:10]}:{stamp[10:12]}",
                    "url": f"https://m.stock.naver.com/worldstock/stock/{rc}/news"})
    return out[:4]


def _toss_news(symbol: str) -> list[dict]:
    """Korean coverage of US names from the site's Toss feed; links stay on the site's own news page."""
    try:
        from app.data.toss_news_fetcher import get_toss_news
        items = get_toss_news(symbol, 6).get("items") or []
    except Exception:
        return []
    out = []
    for n in items:
        stamp = str(n.get("date") or "")
        if not n.get("title") or stamp[:10] < (_now() - dt.timedelta(days=4)).date().isoformat():
            continue
        out.append({"title": str(n["title"])[:120], "summary": str(n.get("summary") or "")[:160], "press": str(n.get("press") or "")[:30],
                    "at": stamp[:16].replace("T", " "), "url": f"https://kospimap.com/stock/{symbol}/news"})
    return out[:4]


def _line(code: str, foreign: bool = False) -> tuple[list[float], list[str]]:
    end = _now()
    start = end - dt.timedelta(days=45)
    kind = "foreign" if foreign else "domestic"
    try:
        rows = _get(f"https://api.stock.naver.com/chart/{kind}/item/{code}/day",
                    startDateTime=f"{start:%Y%m%d}0000", endDateTime=f"{end:%Y%m%d}2359")
        rows = [r for r in rows if r.get("closePrice")][-20:]
        return [float(r["closePrice"]) for r in rows], [f'{r["localDate"][:4]}-{r["localDate"][4:6]}-{r["localDate"][6:]}' for r in rows]
    except Exception:
        return [], []


def _index(code: str) -> dict:
    try:
        d = _get(f"https://m.stock.naver.com/api/index/{code}/basic")
        return {"name": d.get("stockName") or code, "close": _num(d.get("closePrice")), "change_pct": _num(d.get("fluctuationsRatio"))}
    except Exception:
        return {"name": code, "close": None, "change_pct": None}


def _us_index(code: str, name: str) -> dict:
    try:
        d = _get(f"https://api.stock.naver.com/index/{code}/basic")
        return {"name": name, "close": _num(d.get("closePrice")), "change_pct": _num(d.get("fluctuationsRatio"))}
    except Exception:
        return {"name": name, "close": None, "change_pct": None}


def _finish(picked: list[dict], lines: list[tuple[list[float], list[str]]], news: list[list[dict]]) -> None:
    for row, items, (line, dates) in zip(picked, news, lines):
        row["news"], row["line"], row["line_dates"] = items, line, dates
        row["ret_20d"] = round((line[-1] / line[0] - 1) * 100, 2) if len(line) >= 2 and line[0] else None
        row["direction"] = "up" if row["change_pct"] > 0 else "down"


def collect_kr() -> dict:
    with ThreadPoolExecutor(max_workers=4) as pool:
        up_kp, up_kq, dn_kp, dn_kq = pool.map(lambda a: _ranking(*a), (("up", "KOSPI"), ("up", "KOSDAQ"), ("down", "KOSPI"), ("down", "KOSDAQ")))
    gainers = sorted(up_kp + up_kq, key=lambda r: -r["change_pct"])[:GAINERS["kr"]]
    losers = sorted(dn_kp + dn_kq, key=lambda r: r["change_pct"])[:LOSERS["kr"]]
    picked = [r for r in gainers if r["change_pct"] > 0] + [r for r in losers if r["change_pct"] < 0]
    if len(picked) < 6:
        raise RuntimeError("not enough movers")
    with ThreadPoolExecutor(max_workers=8) as pool:
        news = list(pool.map(lambda r: _news(r["code"]), picked))
        lines = list(pool.map(lambda r: _line(r["code"]), picked))
    _finish(picked, lines, news)
    return {"market": "kr", "indices": [_index("KOSPI"), _index("KOSDAQ")], "stocks": picked,
            "limit_up": sum(1 for r in up_kp + up_kq if r["limit"] == "상한가"),
            "limit_down": sum(1 for r in dn_kp + dn_kq if r["limit"] == "하한가")}


def _usd(value: float) -> str:
    if value >= 1e12:
        return f"{value / 1e12:.2f}조 달러"
    return f"{value / 1e8:,.0f}억 달러" if value >= 1e8 else f"{value / 1e4:,.0f}만 달러"


def collect_us() -> dict:
    from app.services import us_market_map
    items = us_market_map.get_nasdaq100_map(103, fresh=True) or []
    rows = []
    for it in items:
        close, pct = _num(it.get("close")), _num(it.get("change_pct"))
        if not it.get("code") or close is None or close <= 0 or pct is None:
            continue
        volume = _num(it.get("volume")) or 0
        cap = _num(it.get("market_cap")) or 0
        rows.append({"code": str(it["code"]).upper(), "name": str(it.get("name") or it["code"]), "market": "나스닥",
                     "close": close, "change_pct": round(pct, 2), "limit": "", "session": it.get("session") or "",
                     "turnover_100m": round(close * volume / 1e8, 1), "marcap_100m": round(cap / 1e8),
                     "price_label": f"${close:,.2f}", "turnover_label": _usd(close * volume), "marcap_label": _usd(cap)})
    if len(rows) < 50:
        raise RuntimeError("NASDAQ-100 snapshot is not ready")
    gainers = sorted((r for r in rows if r["change_pct"] > 0), key=lambda r: -r["change_pct"])[:GAINERS["us"]]
    losers = sorted((r for r in rows if r["change_pct"] < 0), key=lambda r: r["change_pct"])[:LOSERS["us"]]
    picked = gainers + losers
    if len(picked) < 6:
        raise RuntimeError("not enough movers")

    def korean(row):
        try:
            d = _get(f"https://api.stock.naver.com/stock/{row['code']}.O/basic")
            return d.get("stockName") or row["name"]
        except Exception:
            return row["name"]
    with ThreadPoolExecutor(max_workers=8) as pool:
        names = list(pool.map(korean, picked))
        news = list(pool.map(lambda r: _us_news(f"{r['code']}.O") or _toss_news(r["code"]), picked))
        lines = list(pool.map(lambda r: _line(f"{r['code']}.O", foreign=True), picked))
    for row, name in zip(picked, names):
        row["name_en"], row["name"] = row["name"], re.sub(r"\s*\(.*\)$", "", name).strip() or name
    _finish(picked, lines, news)
    return {"market": "us", "indices": [_us_index(".IXIC", "나스닥 종합"), _us_index(".NDX", "나스닥100"), _us_index(".INX", "S&P 500")],
            "stocks": picked, "session": next((r["session"] for r in rows if r["session"]), "")}


def collect(market: str = "kr") -> dict:
    return collect_us() if market == "us" else collect_kr()


# ------------------------------------------------------------------ writing
def _cli_env() -> dict:
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    token = env.get("CLAUDE_CODE_OAUTH_TOKEN")
    if token:
        env["CLAUDE_CODE_OAUTH_TOKEN"] = "".join(token.split())
    return env


_last_usage: dict[str, int] = {}


def ask_claude(prompt: str, timeout: int = 420) -> tuple[dict, str]:
    exe = shutil.which(os.environ.get("CLAUDE_CLI", "claude"))
    if not exe:
        raise RuntimeError("claude CLI not found")
    cmd = [exe, "-p", "--model", os.environ.get("MOVERS_MODEL") or os.environ.get("HOT_ISSUES_MODEL", "opus"), "--output-format", "json",
           "--json-schema", json.dumps(SCHEMA, ensure_ascii=False), "--tools", "", "--no-session-persistence"]
    with tempfile.TemporaryDirectory(prefix="movers-") as cwd:
        proc = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8",
                              timeout=timeout, cwd=cwd, env=_cli_env())
    if proc.returncode != 0:
        raise RuntimeError(f"claude exited {proc.returncode}")
    result = json.loads(proc.stdout)
    if result.get("is_error") or not isinstance(result.get("structured_output"), dict):
        raise RuntimeError("no structured output")
    # modelUsage can list a small helper model first; the writer is the one that produced the most output.
    usage = result.get("modelUsage") or {}
    model = max(usage, key=lambda m: (usage[m] or {}).get("outputTokens", 0), default="")
    _last_usage.clear()
    _last_usage.update({m: (u or {}).get("outputTokens", 0) for m, u in usage.items()})
    return result["structured_output"], model


def _pct(v: float) -> str:
    return f"{v:+.2f}%"


def _fallback(data: dict) -> dict:
    us = data.get("market") == "us"
    stocks = data["stocks"]
    top = stocks[0]
    ups = [s for s in stocks if s["direction"] == "up"]
    downs = [s for s in stocks if s["direction"] == "down"]
    lead_index = data["indices"][0]
    for s in stocks:
        lead = s["news"][0]["title"] if s["news"] else ""
        verb = "올랐다" if s["direction"] == "up" else "내렸다"
        parts = [f"'{lead}' 소식이 전해진 가운데 {abs(s['change_pct']):.1f}% {verb}." if lead
                 else f"뚜렷한 뉴스 없이 {abs(s['change_pct']):.1f}% {verb}."]
        parts += [f"같은 시기 '{n['title']}' 기사도 나왔다." for n in s["news"][1:2]]
        if us:
            parts.append(f"거래대금은 약 {s['turnover_label']}, 시가총액은 {s['marcap_label']} 규모다.")
        else:
            parts.append(f"거래대금은 {s['turnover_100m']:,}억원으로 시가총액 {s['marcap_100m']:,}억원 규모 종목치고 "
                         + ("매매가 활발했다." if s["turnover_100m"] * 10 >= s["marcap_100m"] else "매매가 많지는 않았다."))
        if s.get("ret_20d") is not None:
            parts.append(f"최근 20거래일 주가는 {s['ret_20d']:+.1f}% 움직였다.")
        parts.append("실적 발표 일정과 회사 발표를 확인할 필요가 있다." if us else "회사 공시와 거래소 조회공시 답변이 나오는지 확인할 필요가 있다.")
        s["reason"] = " ".join(parts)
        s["theme"] = s["limit"] or ("급등" if s["direction"] == "up" else "급락")
    return {
        "headline": f"{top['name']} {_pct(top['change_pct'])}, {'나스닥100에서 ' if us else '오늘 '}가장 많이 오른 종목은",
        "dek": (f"{lead_index['name']}는 {_pct(lead_index['change_pct'])} 움직였다. " if lead_index.get("change_pct") is not None else "")
               + f"상승률 상위 {len(ups)}종목과 하락률 상위 {len(downs)}종목의 움직임과 관련 뉴스를 정리했다.",
        "social_hook": f"{top['name']} {_pct(top['change_pct'])}, 이유가 뭘까",
        "hashtags": [re.sub(r"[^0-9A-Za-z가-힣]", "", s["name"]) for s in ups[:2]],
        "themes": [],
    }


AI_TELLS = re.compile(r"[\U0001F300-\U0001FAFF☀-➿]|주목할 만|눈여겨|살펴보겠|것으로 보입니다|제공된 (?:뉴스|자료|데이터)(?:에서|에는|로는|상)?\s*")


def _plain(text: str, limit: int) -> str:
    text = AI_TELLS.sub("", " ".join(str(text or "").split()))
    return text.strip()[:limit]


def social_feedback(market: str = "kr", days: int = 14) -> str:
    """Past posts' first lines and hashtags with the visits each brought, best and worst."""
    from app.services import movers_store, page_view_store
    since = (_now() - dt.timedelta(days=days)).astimezone(dt.timezone.utc).isoformat(timespec="seconds")
    visits: dict[str, int] = {}
    for row in page_view_store.social_campaign_views(since):
        visits[row["campaign"]] = visits.get(row["campaign"], 0) + row["visitors"]
    by_edition = {e: h for h, e in SOCIAL_EDITIONS[market].items()}
    posts = []
    for campaign, count in visits.items():
        m = re.fullmatch(r"([a-z_]+)-(\d{8})", campaign or "")
        hhmm = by_edition.get(m.group(1)) if m else None
        if not hhmm:
            continue
        day = f"{m.group(2)[:4]}-{m.group(2)[4:6]}-{m.group(2)[6:]}"
        stored = movers_store.get_edition(("us:" if market == "us" else "") + f"{day}T{hhmm[:2]}:{hhmm[2:]}+09:00")
        if stored and stored.get("social_hook"):
            posts.append((count, stored["social_hook"], stored.get("hashtags") or []))
    if len(posts) < 3:
        return ""
    posts.sort(key=lambda p: -p[0])
    line = lambda p: f'- 유입 {p[0]}명: "{p[1]}" 해시태그 {" ".join("#" + t for t in p[2])}'
    return ("\n지난 SNS 게시글 반응(링크로 들어온 방문자 수). 반응이 좋았던 첫 문장과 해시태그의 특징(숫자, 종목명, 궁금증 유발 방식)을 "
            "참고해 더 나은 문장을 쓰세요. 그대로 베끼지는 마세요.\n반응 좋음:\n" + "\n".join(map(line, posts[:3]))
            + "\n반응 낮음:\n" + "\n".join(map(line, posts[-3:])) + "\n")


def generate(slot: dt.datetime, market: str = "kr") -> dict:
    data = collect(market)
    payload = _fallback(data)
    model = ""
    when = f"{slot:%Y년 %m월 %d일 %H:%M}"
    try:
        lean = [{k: s.get(k) for k in ("code", "name", "market", "change_pct", "limit", "turnover_100m", "marcap_100m", "ret_20d",
                                        "turnover_label", "marcap_label")}
                | {"news": [{"title": n["title"], "summary": n["summary"], "at": n["at"]} for n in s["news"]]} for s in data["stocks"]]
        try:
            feedback = social_feedback(market)
        except Exception:
            feedback = ""
        written, model = ask_claude(PROMPT.format(when=when, universe=UNIVERSE[market], checks=CHECKS[market],
                                                  base_tags=BASE_TAGS_NOTE[market], feedback=feedback,
                                                  indices=json.dumps(data["indices"], ensure_ascii=False),
                                                  stocks=json.dumps(lean, ensure_ascii=False)))
        by_code = {str(w.get("code")).upper(): w for w in written.get("stocks") or []}
        for s in data["stocks"]:
            w = by_code.get(s["code"].upper())
            if w and w.get("reason"):
                s["reason"], s["theme"] = _plain(w["reason"], 1400), _plain(w.get("theme"), 12) or s["theme"]
        codes = {s["code"] for s in data["stocks"]}
        payload = {"headline": _plain(written.get("headline"), 60) or payload["headline"],
                   "dek": _plain(written.get("dek"), 300) or payload["dek"],
                   "social_hook": _plain(written.get("social_hook"), 40) or payload["social_hook"],
                   "hashtags": [t for t in (re.sub(r"[^0-9A-Za-z가-힣]", "", str(h)) for h in written.get("hashtags") or []) if 2 <= len(t) <= 20][:4],
                   "themes": [{"name": _plain(t.get("name"), 14), "codes": [str(c).upper() if market == "us" else str(c) for c in t.get("codes") or []
                                                                           if (str(c).upper() if market == "us" else str(c)) in codes]}
                              for t in written.get("themes") or [] if t.get("name")][:4]}
    except Exception as exc:
        log.warning("movers writer (%s) fell back to headlines: %s", market, type(exc).__name__)
    slot = slot.astimezone(KST)
    return {**payload, **data, "slot": slot.isoformat(timespec="minutes"), "edition": slot.date().isoformat(),
            "slot_label": f"{slot:%H:%M}", "slot_name": SLOT_NAMES.get(f"{slot:%H%M}", ""),
            "generated_at": _now().isoformat(timespec="seconds"), "model": model or "headlines",
            "model_usage": dict(_last_usage) if model else {}}


_lock = threading.Lock()
_published: set[str] = set()


# An edition written without Opus (headline fallback or a weaker model) gets one revision,
# stored as a new row "<key>~r1"; the original row is kept as it is (append-only).
REVISION = "~r1"


def _weak(payload: dict) -> bool:
    return "opus" not in str(payload.get("model") or "").lower()


def _target(store, k: str) -> str | None:
    """The row to write for this slot: the slot itself, its one revision, or None when done."""
    base = store.get_edition(k)
    if not base:
        return k
    if _weak(base) and not store.get_edition(k + REVISION):
        return k + REVISION
    return None


def run_slot(slot: dt.datetime, trigger: str, market: str = "kr") -> str:
    from app.services import movers_store as store
    if not _lock.acquire(blocking=False):
        return "busy"
    try:
        k = _target(store, key(slot, market))
        if not k:
            return "exists"
        store.log_run(k, _now().isoformat(timespec="seconds"), "started", trigger)
        try:
            payload = generate(slot, market)
        except Exception as exc:
            store.log_run(k, _now().isoformat(timespec="seconds"), "failed", trigger, f"{type(exc).__name__}: {exc}"[:500])
            return "failed"
        created = store.save_edition(k, payload, payload["model"], payload["generated_at"])
        forget(slot, market)
        store.log_run(k, _now().isoformat(timespec="seconds"), "published" if created else "exists", trigger,
                      json.dumps({"stocks": len(payload["stocks"]), "model": payload["model"]}))
        _published.add(key(slot, market))
        return "published" if created else "exists"
    finally:
        _lock.release()


def _should_try(slot: dt.datetime, now: dt.datetime, market: str) -> bool:
    from app.services import movers_store as store
    base = key(slot, market)
    if base in _published:
        return False
    k = _target(store, base)
    if not k:
        _published.add(base)
        return False
    runs = store.runs_for(k)
    if sum(1 for r in runs if r["event"] == "started") >= MAX_ATTEMPTS:
        return False
    last = max((r["at"] for r in runs), default="")
    return not last or now - dt.datetime.fromisoformat(last) >= RETRY_GAP


def _loop() -> None:
    time.sleep(120)
    while True:
        for market in MARKETS:
            try:
                now = _now()
                slot = due_slot(now, market)
                if slot and _should_try(slot, now, market):
                    run_slot(slot, "schedule", market)
            except Exception:
                log.exception("movers scheduler tick failed (%s)", market)
        time.sleep(45)


def start_scheduler() -> None:
    if os.environ.get("MOVERS_SCHEDULER", "1") == "0":
        return
    threading.Thread(target=_loop, daemon=True, name="movers-writer").start()


# ------------------------------------------------------------------ reading
_memo: dict[str, tuple[float, dict | None]] = {}
_memo_lock = threading.Lock()


def edition(slot: dt.datetime, market: str = "kr") -> dict | None:
    k = key(slot, market)
    with _memo_lock:
        hit = _memo.get(k)
        if hit and hit[0] > time.monotonic():
            return hit[1]
    try:
        from app.services import movers_store
        value = movers_store.get_edition(k + REVISION) or movers_store.get_edition(k)
    except Exception:
        value = None
    if value is not None:
        value.setdefault("market", market)
    with _memo_lock:
        _memo[k] = (time.monotonic() + (3600 if value else 60), value)
        if len(_memo) > 200:
            for stale in sorted(_memo, key=lambda x: _memo[x][0])[:50]:
                _memo.pop(stale, None)
    return value


def forget(slot: dt.datetime, market: str = "kr") -> None:
    with _memo_lock:
        _memo.pop(key(slot, market), None)


def next_slot(now: dt.datetime, market: str = "kr") -> dt.datetime:
    upcoming = [s for s in _candidates(now, market, back=1, ahead=10) if s > now]
    return upcoming[0] if upcoming else now + dt.timedelta(days=1)


def current(now: dt.datetime | None = None, market: str = "kr") -> dict:
    now = (now or _now()).astimezone(KST)
    for slot in reversed([s for s in _candidates(now, market, back=7) if s <= now]):
        found = edition(slot, market)
        if found:
            session = session_day(slot, market)
            return {**found, "next_update": next_slot(now, market).isoformat(timespec="minutes"),
                    "day_slots": [{"slot": s.isoformat(timespec="minutes"), "label": f"{s:%H:%M}", "name": SLOT_NAMES[f"{s:%H%M}"],
                                   "published": bool(edition(s, market))} for s in slot_times(session, market) if s <= now]}
    return {"market": market, "stocks": [], "next_update": next_slot(now, market).isoformat(timespec="minutes"), "day_slots": []}


def for_stock(code: str, now: dt.datetime | None = None) -> dict | None:
    """The stock's entry in the latest edition of the last few days, for the stock page (KR and US)."""
    for market in MARKETS:
        data = current(now, market)
        if not data.get("stocks") or data["edition"] < ((now or _now()) - dt.timedelta(days=3)).date().isoformat():
            continue
        for s in data["stocks"]:
            if s["code"].upper() == code.upper():
                return {"edition": data["edition"], "slot_label": data["slot_label"], "path": edition_path(data),
                        **{k: s.get(k) for k in ("name", "change_pct", "reason", "theme", "limit", "direction")}}
    return None


# ------------------------------------------------------------------ SEO
PAGE = ("오늘 급등주·급락주 이유 총정리 — 상한가·특징주 실시간 | KOSPIMAP",
        "코스피·코스닥 급등주와 급락주가 왜 움직였는지 뉴스 근거로 쉽게 정리합니다. 평일 09:20·12:30·16:00 업데이트, 상한가·하한가·테마 흐름과 20일 차트를 한 번에 확인하세요.")
PAGE_US = ("나스닥100 급등주·급락주 이유 — 미국 주식 특징주 정리 | KOSPIMAP",
           "엔비디아·테슬라 등 나스닥100 종목이 왜 올랐고 내렸는지 뉴스 근거로 쉽게 정리합니다. 프리마켓 21:00·개장 직후 00:40·마감 06:40(한국 시간) 업데이트.")


def page(market: str) -> tuple[str, str]:
    return PAGE_US if market == "us" else PAGE


def base_path(market: str) -> str:
    return "/movers/us" if market == "us" else "/movers"


def edition_path(data: dict) -> str:
    return f"{base_path(data.get('market', 'kr'))}/{data['edition']}/{data['slot_label'].replace(':', '')}"


def og_path(data: dict) -> str:
    return f"{base_path(data.get('market', 'kr'))}/og/{data['edition']}/{data['slot_label'].replace(':', '')}.png"


def edition_metadata(data: dict) -> tuple[str, str]:
    us = data.get("market") == "us"
    ups = sorted((s for s in data["stocks"] if s["direction"] == "up"), key=lambda s: -s["turnover_100m"])
    names = ", ".join(s["name"] for s in (ups or data["stocks"])[:3])
    return (f"{data['edition'][5:].replace('-', '/')} {'나스닥100 ' if us else ''}{data['slot_name']} 급등주 이유: {names} | KOSPIMAP",
            f"{data['headline']} — {data['dek']}"[:160])


def sitemap_editions(now: dt.datetime | None = None) -> list[tuple[str, str]]:
    from app.services import movers_store
    now = (now or _now()).astimezone(KST)
    out = []
    for k in movers_store.published_slots("~", 400):
        market = "us" if k.startswith("us:") else "kr"
        iso = k[3:] if market == "us" else k
        slot = parse_slot(iso[:10], iso[11:16].replace(":", ""), market)
        if slot and key(slot, market) == k and slot <= now:
            out.append((f"{base_path(market)}/{slot:%Y-%m-%d/%H%M}", iso[:10]))
    return out


def render_content(data: dict, archive: bool = False) -> str:
    esc = html.escape
    market = data.get("market", "kr")
    us = market == "us"
    if not data.get("stocks"):
        return f"<p>{'미국장 거래일 21:00 · 00:40 · 06:40(한국 시간)' if us else '평일 09:20 · 12:30 · 16:00'}에 급등·급락 종목과 이유를 정리합니다.</p>"
    parts = [f'<p><strong>{esc(data["edition"])} {esc(data["slot_label"])} {esc(data["slot_name"])}</strong> · {esc(data["headline"])}</p>',
             f'<p>{esc(data["dek"])}</p>']
    if archive:
        parts.append(f'<p><a href="{base_path(market)}">최신 급등·급락 이유 보기</a></p>')
    parts.append(f'<p><a href="{base_path("kr" if us else "us")}">{"국내 코스피·코스닥" if us else "미국 나스닥100"} 급등·급락 이유 보기</a></p>')
    for title, direction in (("급등주와 오른 이유", "up"), ("급락주와 내린 이유", "down")):
        rows = [s for s in data["stocks"] if s["direction"] == direction]
        if not rows:
            continue
        parts.append(f"<h2>{title}</h2>")
        for s in rows:
            verb = "급등" if direction == "up" else "급락"
            news = " · ".join(f'<a href="{esc(n["url"])}" rel="nofollow noopener">{esc(n["press"])}: {esc(n["title"])}</a>' for n in s["news"][:2])
            price = s.get("price_label") or f'{s["close"]:,.0f}원'
            turnover = s.get("turnover_label") or f'{s["turnover_100m"]:,}억원'
            parts.append(f'<article><h3><a href="/stock/{esc(s["code"])}">{esc(s["name"])}</a> {verb} 이유 ({s["change_pct"]:+.2f}%{" · " + esc(s["limit"]) if s.get("limit") else ""})</h3>'
                         f'<p>{esc(s.get("reason", ""))}</p><p>{esc(s["market"])} · 가격 {esc(price)} · 거래대금 {esc(turnover)} · 테마 {esc(s.get("theme", ""))}</p>'
                         + (f"<p>관련 뉴스: {news}</p>" if news else "") + "</article>")
    return "".join(parts)


def structured_data(site: str, data: dict, archive: bool = False) -> dict:
    market = data.get("market", "kr")
    path = edition_path(data) if archive and data.get("stocks") else base_path(market)
    title, description = edition_metadata(data) if archive and data.get("stocks") else page(market)
    url = site + path
    graph = [{"@type": "WebPage", "name": title, "description": description, "url": url, "inLanguage": "ko-KR",
              "isPartOf": {"@type": "WebSite", "name": "KOSPIMAP", "url": site}},
             {"@type": "BreadcrumbList", "itemListElement": [
                 {"@type": "ListItem", "position": 1, "name": "KOSPIMAP", "item": site},
                 {"@type": "ListItem", "position": 2, "name": "나스닥100 급등·급락 이유" if market == "us" else "급등·급락 이유",
                  "item": site + base_path(market)}]}]
    if data.get("stocks"):
        graph.append({"@type": "NewsArticle", "headline": data["headline"][:110], "description": data["dek"][:300],
                      "datePublished": data["generated_at"], "dateModified": data["generated_at"], "inLanguage": "ko-KR",
                      "mainEntityOfPage": url, "image": site + og_path(data),
                      "author": {"@type": "Organization", "name": "KOSPIMAP", "url": site},
                      "publisher": {"@type": "Organization", "name": "KOSPIMAP", "url": site}})
    return {"@context": "https://schema.org", "@graph": graph}
