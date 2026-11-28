"""Naver blog posts for every automated SNS edition.

The SNS posts are a few lines and a picture. A blog post that ranks in Naver search
has to be more than that: a readable article with the numbers written out, the reasons
in full sentences, a few headings people actually search for, and links that bring the
reader to the matching page on the site. Each builder below takes the same data the SNS
edition used (and the same pictures — the heatmap exports, the scoreboard thumbnail, the
movers card), and writes the longer piece.

Writing rules (from the owner): no emoji, no "총정리!!"-style filler, plain polite Korean
the way a person who follows the market would write it, and always the site link.
Every link carries utm_source=naver_blog&utm_campaign=nb_<edition>-<YYYYMMDD>, which is
what naver_social_perf counts and naver_social_tuning learns from.

A builder raises NotReady when its edition's data does not exist yet (the hot-issue
writer is still working, the close quote is not final). The publisher retries those
until the edition's window closes.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import math
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from app.services.naver_document_model import (
    _image_slot,
    _paragraph,
    _paragraph_nodes,
    _text_component,
    _text_node,
)

KST = ZoneInfo("Asia/Seoul")
SITE = "https://kospimap.com"
log = logging.getLogger(__name__)

# Blog categories (blog.naver.com/kospi-predictor, under 게시판).
CAT_HOT, CAT_MAPS, CAT_BRIEF, CAT_MOVERS, CAT_WORLD = 6, 7, 8, 9, 10
CATEGORY_NAMES = {CAT_HOT: "오늘의 핫이슈", CAT_MAPS: "코스피/코스닥/나스닥", CAT_BRIEF: "오늘의 브리핑",
                  CAT_MOVERS: "급등/급락의 이유", CAT_WORLD: "글로벌 증시"}

# edition -> (KST post time, window hours, category, session rule, kind, label)
# Post times are the SNS times in scripts/social_publish.py, so both go out together.
EDITIONS: dict[str, tuple[str, float, int, str, str, str]] = {
    "us_movers_open": ("00:50", 4, CAT_MOVERS, "us-12h", "movers", "나스닥100 개장 직후 급등락 이유"),
    "us_movers_close": ("06:50", 4, CAT_MOVERS, "us-12h", "movers", "나스닥100 마감 급등락 이유"),
    "nasdaq_close": ("07:00", 3, CAT_MAPS, "us-prev", "heatmap", "나스닥100 마감 히트맵"),
    "morning": ("07:15", 3, CAT_HOT, "daily", "hot", "오늘의 핫이슈 아침판"),
    "world_morning": ("08:00", 4, CAT_WORLD, "daily", "world", "세계 증시 성적표 아침"),
    "movers_open": ("09:30", 3, CAT_MOVERS, "kr", "movers", "국내 장 초반 급등락 이유"),
    "midday": ("12:00", 3, CAT_MAPS, "kr", "heatmap", "코스피·코스닥 장중 히트맵"),
    "movers_noon": ("12:40", 3, CAT_MOVERS, "kr", "movers", "국내 점심 급등락 이유"),
    "close": ("16:00", 6, CAT_MAPS, "kr", "heatmap", "코스피·코스닥 장마감 히트맵"),
    "movers_close": ("16:15", 6, CAT_MOVERS, "kr", "movers", "국내 장 마감 급등락 이유"),
    "world_evening": ("17:00", 4, CAT_WORLD, "daily", "world", "세계 증시 성적표 저녁"),
    "weekly_market": ("18:00", 24, CAT_MAPS, "saturday", "weekly_market", "코스피·코스닥·나스닥 주간 시황"),
    "us_movers_pre": ("21:10", 3, CAT_MOVERS, "us-12h", "movers", "나스닥100 프리마켓 급등락 이유"),
    "evening": ("22:15", 3, CAT_HOT, "daily", "hot", "오늘의 핫이슈 밤판"),
}

DISCLAIMER = ("이 글은 공개된 시세와 뉴스를 바탕으로 정리한 참고 자료이며 특정 종목의 매수·매도를 권하는 글이 아닙니다. "
              "투자 판단과 책임은 본인에게 있습니다.")


class NotReady(RuntimeError):
    """The edition's data is not published yet; try again later in the window."""


@dataclass
class Post:
    edition: str
    day: dt.date
    title: str
    body: list[dict]
    tags: list[str]
    images: list[tuple[str, bytes]] = field(default_factory=list)
    variant: str = ""
    campaign: str = ""
    category_no: int = 0

    @property
    def category_name(self) -> str:
        return CATEGORY_NAMES.get(self.category_no, "")

    def text(self) -> str:
        out = []
        for comp in self.body:
            for para in comp.get("value") or []:
                out.append("".join(n.get("value", "") for n in para.get("nodes") or []))
        return "\n".join(out)


# ------------------------------------------------------------------ helpers

def _scripts_on_path() -> None:
    root = Path(__file__).resolve().parents[3] / "scripts"
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    if os.name == "nt":
        os.environ.setdefault("SOCIAL_FONT", "C:/Windows/Fonts/malgun.ttf")
        os.environ.setdefault("SOCIAL_FONT_BOLD", "C:/Windows/Fonts/malgunbd.ttf")


def _get(url: str, *, raw: bool = False, timeout: int = 30):
    req = Request(url, headers={"User-Agent": "Mozilla/5.0 (KOSPIMAP-NaverBlog/1)"})
    try:
        with urlopen(req, timeout=timeout) as resp:
            body = resp.read()
    except HTTPError as exc:
        if exc.code == 404:
            raise NotReady(f"not published yet: {url.replace(SITE, '')}") from None
        raise
    return body if raw else json.loads(body)


def campaign(day: dt.date, edition: str) -> str:
    return f"nb_{edition}-{day:%Y%m%d}"


def link(path: str, day: dt.date, edition: str, anchor: str = "") -> str:
    q = urlencode({"utm_source": "naver_blog", "utm_medium": "blog", "utm_campaign": campaign(day, edition)})
    sep = "&" if "?" in path else "?"
    return f"{SITE}{path}{sep}{q}{anchor}"


def _pick(options: list[str], seed: str) -> str:
    """Stable choice per post: re-running a build gives the same wording."""
    h = int(hashlib.sha256(seed.encode()).hexdigest(), 16)
    return options[h % len(options)]


def pct(v: float) -> str:
    return f"{v:+.2f}%"


def _verb(v: float) -> str:
    a = abs(v)
    if a >= 3:
        return "급등" if v > 0 else "급락"
    if a >= 1:
        return "상승" if v > 0 else "하락"
    if a >= 0.2:
        return "소폭 상승" if v > 0 else "소폭 하락"
    return "보합"


def kday(day: dt.date) -> str:
    return f"{day.month}월 {day.day}일"


def weekday(day: dt.date) -> str:
    return "월화수목금토일"[day.weekday()]


def heading(text: str) -> dict:
    return _text_component([_paragraph(""), _paragraph(text, bold=True, size="fs19")])


def paras(lines: list[str], *, gap: bool = False) -> dict:
    out = []
    for i, line in enumerate(lines):
        if gap and i:
            out.append(_paragraph(""))
        out.append(_paragraph(line))
    return _text_component(out)


def link_line(prefix: str, label: str, url: str) -> dict:
    nodes = [_text_node(prefix)] if prefix else []
    nodes.append(_text_node(label, url=url, bold=True))
    return _paragraph_nodes(nodes)


def links_block(title: str, items: list[tuple[str, str]]) -> dict:
    lines = [_paragraph(""), _paragraph(title, bold=True, size="fs19")]
    lines += [link_line("· ", label, url) for label, url in items]
    return _text_component(lines)


def clean_tags(values: list[str], limit: int = 15) -> list[str]:
    out = []
    for value in values:
        tag = re.sub(r"[^0-9A-Za-z가-힣]", "", str(value or ""))
        if 2 <= len(tag) <= 20 and any(c.isalpha() for c in tag) and tag not in out:
            out.append(tag)
    return out[:limit]


def short(text: str, n: int) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= n else text[: n - 1].rstrip(" ,·…") + "…"


def closing(day: dt.date, edition: str, extra: list[tuple[str, str]] | None = None) -> list[dict]:
    items = list(extra or [])
    items += [("코스피 시가총액 히트맵 실시간 보기", link("/map", day, edition)),
              ("오늘의 증시 핫이슈 모아보기", link("/hot-issues", day, edition)),
              ("오늘 급등·급락 종목과 이유", link("/movers", day, edition))]
    seen, uniq = set(), []
    for label, url in items:
        base = url.split("?")[0]
        if base not in seen:
            seen.add(base)
            uniq.append((label, url))
    return [links_block("KOSPIMAP에서 더 보기", uniq[:5]),
            _text_component([_paragraph(""), _paragraph(f"※ {DISCLAIMER}", size="fs13")])]


US_NAMES = {
    "AAPL": "애플", "MSFT": "마이크로소프트", "NVDA": "엔비디아", "AMZN": "아마존", "GOOGL": "알파벳A", "GOOG": "알파벳C",
    "META": "메타", "TSLA": "테슬라", "AVGO": "브로드컴", "COST": "코스트코", "NFLX": "넷플릭스", "AMD": "AMD",
    "PEP": "펩시코", "ADBE": "어도비", "CSCO": "시스코", "TMUS": "T모바일", "INTC": "인텔", "QCOM": "퀄컴",
    "TXN": "텍사스인스트루먼트", "INTU": "인튜이트", "AMGN": "암젠", "AMAT": "어플라이드머티어리얼즈", "ISRG": "인튜이티브서지컬",
    "MU": "마이크론", "LRCX": "램리서치", "KLAC": "KLA", "ADI": "아날로그디바이스", "PANW": "팔로알토", "CRWD": "크라우드스트라이크",
    "PLTR": "팔란티어", "MSTR": "스트래티지", "ASML": "ASML", "ARM": "ARM", "SNPS": "시놉시스", "CDNS": "케이던스",
    "MRVL": "마벨", "ABNB": "에어비앤비", "BKNG": "부킹홀딩스", "SBUX": "스타벅스", "MDLZ": "몬델리즈", "GILD": "길리어드",
    "VRTX": "버텍스", "REGN": "리제네론", "PYPL": "페이팔", "DASH": "도어대시", "AXON": "액손", "SNDK": "샌디스크",
    "APP": "앱러빈", "COIN": "코인베이스", "SHOP": "쇼피파이", "WDAY": "워크데이", "FTNT": "포티넷", "DDOG": "데이터독",
    "ZS": "지스케일러", "TEAM": "아틀라시안", "CEG": "컨스텔레이션에너지", "HON": "허니웰", "CMCSA": "컴캐스트",
    "LIN": "린데", "ORLY": "오라일리", "MELI": "메르카도리브레", "PDD": "PDD", "CSX": "CSX", "MAR": "메리어트", "WBD": "워너브라더스",
}
SECTOR_KO = {
    "Information Technology": "정보기술", "Communication Services": "커뮤니케이션", "Consumer Discretionary": "경기소비재",
    "Consumer Staples": "필수소비재", "Health Care": "헬스케어", "Financials": "금융", "Industrials": "산업재",
    "Energy": "에너지", "Utilities": "유틸리티", "Materials": "소재", "Real Estate": "부동산",
}


def us_name(code: str) -> str:
    name = US_NAMES.get(code)
    return f"{name}({code})" if name and name != code else code


def first_sentences(text: str, n: int = 2) -> str:
    parts = re.split(r"(?<=[.다요])\s+", " ".join(str(text or "").split()))
    return " ".join(parts[:n])


def movers_excerpt(day: dt.date, edition: str, count: int, page_edition: str) -> list[dict]:
    """A short "why did it move" section from a movers edition, when it exists."""
    try:
        _scripts_on_path()
        import movers_social as movers  # noqa: WPS433
        data = movers._edition(day, edition)
    except Exception:
        return []
    stocks = (data.get("stocks") or [])[:count]
    if not stocks:
        return []
    us = movers.market(edition) == "us"
    lines = []
    for st in stocks:
        label = us_name(st["code"]) if us else st["name"]
        lines.append(f"{label} {pct(st['change_pct'])}: {first_sentences(st.get('reason'), 2)}")
    path = f"{movers.base(edition)}/{day}/{movers.EDITIONS[edition]}"
    return [heading("많이 움직인 종목, 왜 그랬을까"), paras(lines, gap=True),
            _text_component([link_line("", "종목별 이유 전체 보기", link(path, day, page_edition))])]


def hot_excerpt(day: dt.date, page_edition: str, count: int = 3) -> list[dict]:
    """Today's top hot-issue headlines (morning edition, or last night's)."""
    for d, slot in ((day, "0700"), (day - dt.timedelta(days=1), "2200")):
        try:
            data = _get(f"{SITE}/api/hot-issues/{d}/{slot}")
        except Exception:
            continue
        stories = sorted(data.get("stories") or [], key=lambda x: x.get("rank") or 99)[:count]
        if not stories:
            continue
        lines = [_paragraph(""), _paragraph("같이 보면 좋은 오늘의 이슈", bold=True, size="fs19")]
        for i, st in enumerate(stories, 1):
            lines.append(_paragraph(f"{i}. {' '.join(st['title'].split())}", bold=True))
            lines.append(_paragraph(first_sentences(st.get("summary"), 2)))
        lines.append(link_line("", "핫이슈 전체 기사와 출처 보기", link(f"/hot-issues/{d}/{slot}", day, page_edition)))
        return [_text_component(lines)]
    return []


# ------------------------------------------------------------------ hot issues

def build_hot(day: dt.date, edition: str, variant: str, *, include_image: bool = True) -> Post:
    slot = "0700" if edition == "morning" else "2200"
    data = _get(f"{SITE}/api/hot-issues/{day}/{slot}")
    published = dt.datetime.fromisoformat(data["slot"]).astimezone(KST)
    if published.date() != day or not data.get("stories"):
        raise NotReady("hot-issue edition not ready")
    images = [(f"{day}_hot_cover.png", _get(f"{SITE}/hot-issues/og/{day}/{slot}.png", raw=True))] if include_image else []
    stories = sorted(data["stories"], key=lambda s: s.get("rank") or 99)
    when = "아침" if slot == "0700" else "밤"
    lead = " ".join(stories[0]["title"].split())
    n = len(stories)
    titles = {
        "A": f"{kday(day)} 오늘의 증시 핫이슈 {n}가지 | {short(lead, 30)}",
        "B": f"{short(lead, 32)} 외 {n - 1}건, {kday(day)} {when} 주식 뉴스",
        "C": f"[{day:%m/%d} {when}] 주식시장 핫이슈 정리, {short(lead, 30)}",
    }
    page = f"/hot-issues/{day}/{slot}"
    opener = _pick([
        f"{kday(day)}({weekday(day)}) {when} 기준으로 주식시장에 영향을 줄 만한 뉴스 {n}건을 골랐습니다.",
        f"{when}에 챙겨볼 증시 이슈 {n}가지입니다. {kday(day)} {slot[:2]}시 기준으로 정리했습니다.",
        f"{kday(day)} {when}, 투자자가 알아두면 좋은 시장 뉴스 {n}건을 순서대로 적었습니다.",
    ], f"{day}{edition}")
    body: list[dict] = [paras([opener, " ".join(str(data.get("headline") or "").split())] +
                              ([" ".join(str(data.get("dek")).split())] if data.get("dek") else []), gap=True),
                        _image_slot("cover")]
    mood = (data.get("mood") or {}).get("summary")
    if mood:
        body.append(paras(["", f"한 줄 분위기: {mood}"]))
    numbers = data.get("key_numbers") or []
    if numbers:
        body.append(heading("숫자로 보는 시장"))
        body.append(paras([f"· {k.get('label')} {k.get('value')} ({k.get('change')})" + (f" — {k['note']}" if k.get("note") else "")
                           for k in numbers[:8]]))
    for i, story in enumerate(stories, 1):
        body.append(heading(f"{i}. {' '.join(story['title'].split())}"))
        lines = [story.get("summary") or ""] + [p for p in (story.get("body") or [])[:4] if p]
        if story.get("why_it_matters"):
            lines.append(f"왜 중요한가: {story['why_it_matters']}")
        affected = [a for a in story.get("affected") or [] if a.get("name")]
        if affected:
            arrows = {"up": "수혜", "down": "부담"}
            lines.append("관련 종목: " + ", ".join(
                f"{a['name']}" + (f"({arrows[a['direction']]})" if a.get("direction") in arrows else "") for a in affected[:6]))
        body.append(paras([l for l in lines if l], gap=True))
        extra = [link_line("", "이 이슈 원문 출처와 관련 종목 차트 보기", link(page, day, edition, f"#s{i}"))]
        for src in (story.get("sources") or [])[:2]:
            if src.get("url") and src.get("title"):
                extra.append(_paragraph_nodes([_text_node(f"출처 {src.get('publisher') or ''}: "),
                                               _text_node(short(src["title"], 60), url=src["url"])]))
        body.append(_text_component(extra))
    watch = data.get("watchlist") or []
    if watch:
        body.append(heading("앞으로 지켜볼 일정"))
        body.append(paras([f"· {w.get('when')} {w.get('event')}" + (f" — {w['note']}" if w.get("note") else "") for w in watch[:6]]))
    take = data.get("takeaways") or []
    if take:
        body.append(heading("정리하면"))
        body.append(paras([f"{i}. {t}" for i, t in enumerate(take[:4], 1)]))
    body += closing(day, edition, [(f"{kday(day)} {when} 핫이슈 전체 기사와 출처 보기", link(page, day, edition))])

    names = []
    for s in stories:
        names += list(s.get("social_keywords") or [])
        names += [a["name"] for a in s.get("affected") or [] if a.get("name")]
    tags = clean_tags(["오늘의핫이슈", "증시뉴스", "주식뉴스", "코스피", "코스닥", f"{day.month}월{day.day}일증시",
                       "주식시황", *names], 15 if variant.endswith("wide") else 10)
    return Post(edition, day, titles[variant[0]], body, tags, images)


# ------------------------------------------------------------------ heatmaps

def _social():
    _scripts_on_path()
    import social_publish  # noqa: WPS433 (scripts/social_publish.py)
    return social_publish


def _snap(market: str) -> dict:
    return _get(f"{SITE}/market-snapshot/{market}.json")


def _breadth_lines(name: str, snap: dict, *, korean: bool = True) -> list[str]:
    up, down, flat = snap.get("up", 0), snap.get("down", 0), snap.get("flat", 0)
    total = snap.get("known_count") or (up + down + flat)
    mood = "오른 종목이 더 많았습니다" if up > down else "내린 종목이 더 많았습니다" if down > up else "오른 종목과 내린 종목 수가 비슷했습니다"
    lines = [f"{name} 시가총액 상위 {total}종목 가운데 상승 {up}개, 하락 {down}개, 보합 {flat}개로 {mood}."]
    def nm(r):
        return r["name"] if korean else us_name(r["code"])
    if snap.get("gainers"):
        lines.append("많이 오른 종목: " + ", ".join(f"{nm(r)} {r['change_pct']:+.1f}%" for r in snap["gainers"][:5]) + ".")
    if snap.get("losers"):
        lines.append("많이 내린 종목: " + ", ".join(f"{nm(r)} {r['change_pct']:+.1f}%" for r in snap["losers"][:5]) + ".")
    big = [r for r in snap.get("largest") or [] if r.get("change_pct") is not None][:5]
    if big and any(r["change_pct"] for r in big):
        lines.append("시가총액 상위 종목은 " + ", ".join(f"{nm(r)} {r['change_pct']:+.1f}%" for r in big) + "였습니다.")
    sectors = sorted([s for s in snap.get("sectors") or [] if s.get("count", 0) >= 3], key=lambda s: s["average_change"])
    if len(sectors) >= 2:
        hi, lo = (SECTOR_KO.get(x["name"], x["name"]) for x in (sectors[-1], sectors[0]))
        lines.append(f"업종 평균으로는 {hi}({sectors[-1]['average_change']:+.2f}%) 쪽이 가장 강했고 "
                     f"{lo}({sectors[0]['average_change']:+.2f}%) 쪽이 가장 약했습니다.")
    turnover = snap.get("turnover") or []
    if turnover:
        lines.append("거래대금이 많이 몰린 종목은 " + ", ".join(nm(r) for r in turnover[:4]) + "입니다.")
    return lines


HEATMAP_HOWTO = ("히트맵에서 사각형의 크기는 시가총액, 색은 등락률입니다. 빨간색이 진할수록 많이 올랐고 파란색이 진할수록 많이 내렸습니다. "
                 "같은 업종끼리 묶여 있어서 어느 업종으로 돈이 몰렸는지 한눈에 보입니다.")


def _flows(investor: dict | None, day: dt.date) -> str | None:
    """KOSPI investor net buying for the day, in words (amounts arrive in 억원)."""
    if not investor or str(investor.get("business_date")) != day.strftime("%Y%m%d"):
        return None
    try:
        def money(v):
            v = abs(float(v))
            return f"{v / 10000:,.2f}조원" if v >= 10000 else f"{v:,.0f}억원"
        parts = []
        for key, who in (("foreign_amount", "외국인"), ("institution_amount", "기관"), ("individual_amount", "개인")):
            v = float(investor[key])
            parts.append(f"{who}은 {money(v)} 순{'매수' if v >= 0 else '매도'}")
        return "코스피 투자자별 수급을 보면 " + ", ".join(parts) + "했습니다."
    except Exception:
        return None


def build_heatmap(day: dt.date, edition: str, variant: str) -> Post:
    sp = _social()
    if edition == "close":
        quotes = {m: sp.close_report(day, m) for m in ("kospi", "kosdaq")}
        images = []
        for market, title, png, stamp in sp.export_maps():
            fetched = stamp.astimezone(KST)
            if fetched.date() != day or fetched < sp.market_close(day):
                raise NotReady(f"{market} map not refreshed after the close")
            images.append((f"{day}_{market}_{market}map.png", sp.format_map(png, title, quotes[market][0], day, fetched)))
        return _krx_post(day, edition, variant, images, closing_day=True)
    if edition == "midday":
        _, media = sp.make_midday(day, preview=False)
        images = [(f"{day}_{name.split('-')[-1].removesuffix('.png')}_{name.split('-')[-1].removesuffix('.png')}map.png", png)
                  for name, png, _, _ in media]
        return _krx_post(day, edition, variant, images, closing_day=False)
    _, media = sp.make_nasdaq_close(day, preview=False)
    images = [(f"{day}_nasdaq_nasdaq100map.png", media[0][1])]
    return _nasdaq_post(day, edition, variant, images)


def _krx_post(day, edition, variant, images, *, closing_day: bool) -> Post:
    idx = _get(f"{SITE}/api/investor/indices?fresh=true")
    k, q = idx["kospi"], idx["kosdaq"]
    kp, kq = float(k["change_pct"]), float(q["change_pct"])
    snaps = {m: _snap(m) for m in ("kospi", "kosdaq")}
    when = "마감" if closing_day else "점심"
    titles = {
        "A": f"{kday(day)} 코스피 {float(k['close']):,.2f}({pct(kp)}) {when}, 히트맵으로 보는 오늘 시장",
        "B": f"코스피·코스닥 {'장마감' if closing_day else '장중'} 히트맵 {kday(day)} | 코스피 {pct(kp)} 코스닥 {pct(kq)}",
        "C": f"오늘 코스피 {_verb(kp)} {pct(kp)}, 시가총액 히트맵과 업종 흐름 ({day:%m/%d} {'마감' if closing_day else '12시'})",
    }
    if closing_day:
        opener = _pick([
            f"{kday(day)} 국내 증시는 코스피 {float(k['close']):,.2f}({pct(kp)}), 코스닥 {float(q['close']):,.2f}({pct(kq)})로 마감했습니다.",
            f"{kday(day)}({weekday(day)}) 코스피는 {pct(kp)} {_verb(kp)}한 {float(k['close']):,.2f}, 코스닥은 {pct(kq)} 움직인 {float(q['close']):,.2f}에 거래를 마쳤습니다.",
        ], f"{day}{edition}")
    else:
        opener = _pick([
            f"{kday(day)} 12시 무렵 코스피는 {float(k['close']):,.2f}({pct(kp)}), 코스닥은 {float(q['close']):,.2f}({pct(kq)})입니다.",
            f"오전장이 끝나갈 무렵인 {kday(day)} 낮 12시, 코스피 {pct(kp)}, 코스닥 {pct(kq)} 흐름입니다.",
        ], f"{day}{edition}")
    flows = _flows(idx.get("kospi_investor"), day) if closing_day else None
    body = [paras([opener] + ([flows] if flows else []) + [
        "아래 히트맵은 KOSPIMAP의 시가총액 지도를 그대로 내려받은 그림입니다. " + HEATMAP_HOWTO], gap=True)]
    by_market = {}
    for name, png in images:
        by_market["kosdaq" if "kosdaq" in name else "kospi"] = name.rsplit("_", 1)[-1].removesuffix(".png")
    for market, label, path in (("kospi", "코스피", "/map"), ("kosdaq", "코스닥", "/kosdaq-map")):
        body.append(heading(f"{label} 히트맵 {'마감' if closing_day else '장중'}"))
        if market in by_market:
            body.append(_image_slot(by_market[market]))
        body.append(paras(_breadth_lines(label, snaps[market]), gap=True))
        body.append(_text_component([link_line("", f"{label} 히트맵 실시간으로 보기", link(path, day, edition))]))
    body += movers_excerpt(day, "movers_close" if closing_day else "movers_noon", 4, edition)
    extra = [("오늘 장마감 브리핑 보기", link(f"/market-brief/{day}/kospi", day, edition))] if closing_day else []
    extra.append(("코스닥 시가총액 히트맵", link("/kosdaq-map", day, edition)))
    body += closing(day, edition, extra)
    gainers = [r["name"] for m in ("kospi", "kosdaq") for r in (snaps[m].get("gainers") or [])[:2]]
    tags = clean_tags(["코스피", "코스닥", "히트맵", "코스피히트맵", "주식시황", "장마감" if closing_day else "장중시황",
                       "국내증시", "주식", f"{day.month}월{day.day}일증시", "업종별등락", *gainers],
                      15 if variant.endswith("wide") else 10)
    return Post(edition, day, titles[variant[0]], body, tags, images)


def _nasdaq_post(day, edition, variant, images) -> Post:
    index = _get("https://api.stock.naver.com/index/.NDX/basic")
    level = float(str(index["closePrice"]).replace(",", ""))
    change = float(index["fluctuationsRatio"])
    session = day - dt.timedelta(days=1)
    snap = _snap("nasdaq100")
    titles = {
        "A": f"나스닥100 히트맵 {kday(session)} 마감 | 나스닥100 {pct(change)} {_verb(change)}",
        "B": f"간밤 미국증시 나스닥100 {pct(change)}, 종목별 히트맵으로 보기 ({day:%m/%d})",
        "C": f"{kday(day)} 아침 미국주식 정리, 나스닥100 {level:,.2f}({pct(change)}) 히트맵",
    }
    opener = _pick([
        f"미국 {kday(session)} 정규장에서 나스닥100 지수는 {level:,.2f}({pct(change)})로 마감했습니다.",
        f"간밤 뉴욕 증시에서 나스닥100은 {pct(change)} {_verb(change)}해 {level:,.2f}에 끝났습니다.",
    ], f"{day}{edition}")
    body = [paras([opener, "아래는 나스닥100 구성 종목을 시가총액 크기와 등락률 색으로 그린 히트맵입니다. "
                   "종목 맵은 한국 시간 아침에 조회해 시간외 변동이 일부 반영될 수 있습니다."], gap=True),
            _image_slot(images[0][0].rsplit("_", 1)[-1].removesuffix(".png")),
            heading("나스닥100 종목 흐름"),
            paras(_breadth_lines("나스닥100", snap, korean=False), gap=True),
            _text_component([link_line("", "나스닥100 히트맵 실시간으로 보기", link("/nasdaq100-map", day, edition))])]
    body += movers_excerpt(day, "us_movers_close", 4, edition)
    body += hot_excerpt(day, edition)
    body += closing(day, edition, [("나스닥100 급등·급락 이유", link("/movers/us", day, edition)),
                                   ("세계 증시 성적표", link("/world-markets", day, edition))])
    tags = clean_tags(["나스닥", "나스닥100", "미국증시", "미국주식", "해외주식", "뉴욕증시", "히트맵", "나스닥히트맵",
                       f"{day.month}월{day.day}일미국증시", *[US_NAMES.get(g["code"], g["code"]) for g in (snap.get("gainers") or [])[:3]]],
                      15 if variant.endswith("wide") else 10)
    return Post(edition, day, titles[variant[0]], body, tags, images)


# ------------------------------------------------------------------ world scoreboard

def build_world(day: dt.date, edition: str, variant: str) -> Post:
    _scripts_on_path()
    import world_indices_social as world  # noqa: WPS433

    quotes, weekly = world.fetch_quotes(day, edition)
    analysis = world.analyze(quotes, weekly)
    png = world.render(day, edition, quotes, analysis, weekly)
    when = "아침" if edition == "world_morning" else "저녁"
    hook = analysis["hook"]
    titles = {
        "A": f"{kday(day)} 세계 증시 성적표({when}) | {short(hook, 34)}",
        "B": f"{short(hook, 34)}, 세계 12개 지수 등락률 순위 ({day:%m/%d})",
        "C": f"{'이번 주' if weekly else '오늘'} 세계 증시 순위, 코스피는 {analysis['kospi_rank']}위 ({kday(day)} {when})",
    }
    country = world.COUNTRY
    def name(q):
        c = country.get(q["flag"])
        return q["label"] if not c or q["label"].startswith(c) else f"{c} {q['label']}"
    opener = _pick([
        f"{kday(day)} {when} 기준으로 세계 주요 {len(quotes)}개 지수의 {'한 주' if weekly else '최근 거래일'} 등락률을 순위로 정리했습니다.",
        f"{'이번 주' if weekly else '최근 거래일'} 세계 증시가 어떻게 움직였는지 {len(quotes)}개 대표 지수로 비교했습니다. {kday(day)} {when} 기준입니다.",
    ], f"{day}{edition}")
    ranking = [f"{i}. {name(q)} {pct(q['pct'])}" for i, q in enumerate(quotes, 1)]
    regions = {"asia": "아시아", "us": "미국", "europe": "유럽"}
    by_region = []
    for code, label in regions.items():
        rows = [q for q in quotes if q["region"] == code]
        if rows:
            avg = sum(q["pct"] for q in rows) / len(rows)
            by_region.append(f"{label}: " + ", ".join(f"{name(q)} {pct(q['pct'])}" for q in rows) + f" (평균 {pct(avg)})")
    timing = ("아침판에는 전날 밤 끝난 미국·유럽 증시와 전 거래일 아시아 증시가, 저녁판에는 오늘 마감한 아시아 증시와 "
              "장중인 유럽 증시가 반영됩니다." if not weekly else "주말판은 한 주 동안의 등락률을 비교합니다.")
    body = [paras([opener, f"{hook}. " + " ".join(analysis["summary"]), timing], gap=True),
            _image_slot("world"),
            heading("세계 주요 지수 순위"), paras(ranking),
            heading("권역별로 보면"), paras(by_region, gap=True),
            _text_component([link_line("", "나라별 지수 차트와 히트맵 보기", link("/world-markets", day, edition))])]
    body += hot_excerpt(day, edition)
    body += closing(day, edition, [("세계 증시 실시간 보기", link("/world-markets", day, edition)),
                                   ("나스닥100 히트맵", link("/nasdaq100-map", day, edition))])
    tags = clean_tags(["글로벌증시", "세계증시", "해외증시", "미국증시", "코스피", "나스닥", "닛케이", "항셍",
                       "증시순위", f"{day.month}월{day.day}일증시", *[t.lstrip("#") for t in analysis["tags"]]],
                      15 if variant.endswith("wide") else 10)
    return Post(edition, day, titles[variant[0]], body, tags, [(f"{day}_world_world.png", png)])


# ------------------------------------------------------------------ movers

def build_movers(day: dt.date, edition: str, variant: str, *, include_image: bool = True) -> Post:
    _scripts_on_path()
    import movers_social as movers  # noqa: WPS433

    try:
        data = movers._edition(day, edition)
    except RuntimeError as exc:
        raise NotReady(str(exc)) from None
    stocks = data.get("stocks") or []
    if not stocks:
        raise NotReady("movers edition has no stocks")
    images = [(f"{day}_movers_movers.png", movers.screenshot(day, edition))] if include_image else []
    us = movers.market(edition) == "us"
    slot = movers.EDITIONS[edition]
    page = f"{movers.base(edition)}/{day}/{slot}"
    when = movers.NAMES[edition]
    ups = [s for s in stocks if s["direction"] == "up"]
    downs = [s for s in stocks if s["direction"] == "down"]
    lead = (ups or downs)[0]
    names = " ".join(s["name"] for s in (ups[:2] or downs[:2]))
    market_word = "나스닥100" if us else "국내"
    hh, mm = map(int, EDITIONS[edition][0].split(":"))
    # US editions are named after the US session (KST 00:50 and 06:50 belong to the previous US day).
    sday = (dt.datetime(day.year, day.month, day.day, hh, mm) - dt.timedelta(hours=12)).date() if us else day
    dlabel = f"미국 {kday(sday)}" if us else kday(day)
    titles = {
        "A": f"{dlabel} {market_word} {when} 급등주·급락주 이유 | {short(names, 24)}",
        "B": f"{lead['name']} {pct(lead['change_pct'])} 왜? {dlabel} {when} {'미국주식' if us else ''} 급등락 종목 정리".replace("  ", " "),
        "C": f"{'' if us else '오늘 '}{dlabel + ' ' if us else ''}{when} 특징주 {len(stocks)}종목 오른 이유·내린 이유 ({sday:%m/%d}) {short(data.get('social_hook') or '', 22)}".strip(),
    }
    indices = ", ".join(f"{i['name']} {float(i['close']):,.2f}({pct(float(i['change_pct']))})" for i in data.get("indices") or [])
    opener = _pick([
        f"{dlabel} {when} 기준으로 {market_word} 증시에서 크게 움직인 종목 {len(stocks)}개와 그 이유를 정리했습니다."
        + (f" 한국 시간으로는 {kday(day)} {slot[:2]}:{slot[2:]} 기준입니다." if us else ""),
        f"{when}에 유난히 많이 오르거나 내린 {market_word} 종목들을 모았습니다. 한국 시간 {kday(day)} {slot[:2]}:{slot[2:]} 기준입니다.",
    ], f"{day}{edition}")
    intro = [opener]
    if indices:
        intro.append(f"같은 시각 지수는 {indices}입니다.")
    if data.get("dek"):
        intro.append(" ".join(str(data["dek"]).split()))
    body = [paras(intro, gap=True), _image_slot("movers")]
    themes = data.get("themes") or []
    if themes:
        by_code = {s["code"]: s["name"] for s in stocks}
        body.append(heading("오늘 묶여서 움직인 테마"))
        body.append(paras([f"· {t['name']}: " + ", ".join(by_code.get(c, c) for c in t.get("codes") or []) for t in themes[:5]]))

    def block(title: str, rows: list[dict]):
        if not rows:
            return
        body.append(heading(title))
        for s in rows:
            tail = " 상한가" if s.get("limit") == "상한가" else " 하한가" if s.get("limit") == "하한가" else ""
            head = f"{s['name']}({s['code']}) {pct(s['change_pct'])}{tail}"
            facts = []
            if s.get("turnover_100m") and not us:
                facts.append(f"거래대금 {s['turnover_100m']:,}억원")
            if s.get("marcap_100m") and not us:
                facts.append(f"시가총액 {s['marcap_100m']:,}억원")
            if s.get("ret_20d") is not None:
                facts.append(f"최근 20거래일 {s['ret_20d']:+.1f}%")
            if s.get("theme"):
                facts.append(f"테마 {s['theme']}")
            stock_path = f"/stock/{s['code']}"
            body.append(_text_component([
                _paragraph(""), _paragraph(head, bold=True),
                _paragraph(" ".join(str(s.get("reason") or "").split())),
                *([_paragraph(" · ".join(facts), size="fs13")] if facts else []),
                link_line("", f"{s['name']} 차트와 최근 뉴스 보기", link(stock_path, day, edition)),
            ]))

    block("크게 오른 종목과 이유", ups)
    block("크게 내린 종목과 이유", downs)
    if not us and (data.get("limit_up") or data.get("limit_down")):
        body.append(paras(["", f"이 시각 상한가 {data.get('limit_up') or 0}종목, 하한가 {data.get('limit_down') or 0}종목이었습니다."]))
    body += closing(day, edition, [(f"{kday(day)} {when} 급등·급락 이유 전체 보기", link(page, day, edition)),
                                   ("나스닥100 히트맵" if us else "코스피 히트맵", link("/nasdaq100-map" if us else "/map", day, edition))])
    base = ["미국주식", "나스닥", "해외주식", "미국주식급등", "나스닥100"] if us else ["급등주", "특징주", "급락주", "주식", "코스피", "코스닥"]
    dyn = list(data.get("hashtags") or []) + [t["name"] for t in themes[:3]] + [s["name"] for s in (ups[:4] + downs[:2])]
    tags = clean_tags([*base, f"{sday.month}월{sday.day}일{'미국주식' if us else '특징주'}", "급등이유", *dyn],
                      15 if variant.endswith("wide") else 10)
    return Post(edition, day, titles[variant[0]], body, tags, images)


def build_weekly(day: dt.date, edition: str, variant: str) -> Post:
    _scripts_on_path()
    import weekly_market_social as weekly

    try:
        report = weekly.load(day, _get)
    except weekly.NotReady as exc:
        raise NotReady(str(exc)) from exc
    lead = max(report.markets, key=lambda market: abs(market.weekly))
    titles = {
        "A": f"{report.period} 주간 시황｜코스피·코스닥·나스닥과 다음 주 전망",
        "B": f"{report.period} 주간 증시｜{lead.name} {weekly.signed(lead.weekly)}, 코스피·코스닥·나스닥",
        "C": f"다음 주 증시 전망｜{report.period} 코스피·코스닥·나스닥 마감과 주요 뉴스",
    }
    body = [paras([
        f"{report.period} 거래소 현지 정규장 종가를 모아 한 주의 흐름을 확인했습니다. "
        "주간 등락률은 각 시장 전주 마지막 거래일 종가 대비입니다.",
        " · ".join(f"{market.name} {weekly.signed(market.weekly)}" for market in report.markets),
    ], gap=True)]
    images = []
    for market in report.markets:
        image_key = market.code.lower()
        png, _ = weekly.render(report, market)
        images.append((f"weekly_market_{image_key}.png", png))
        body.extend([heading(f"{market.name} 주간 흐름"), _image_slot(image_key), paras(market.detail()),
                     heading(f"{market.name} 주요 뉴스")])
        for news in market.news:
            body.append(_text_component([link_line(f"{news.day:%m/%d} · {news.source} · ", news.title, news.url)]))
            if news.summary:
                body.append(paras([news.summary]))
        body.extend([heading(f"{market.name} 다음 주 관전 포인트"), paras([market.outlook]),
                     _text_component([link_line("", f"{market.name} 지수 차트 보기", link(market.path, day, edition))])])
    if report.events:
        body.append(heading("다음 주 주요 경제 일정"))
        for event in report.events:
            body.append(_text_component([link_line(f"{event.day:%m/%d} {event.summary} · ", event.title, event.url)]))
    body.extend([paras([DISCLAIMER]), _text_component([link_line("", "세계 증시 비교", link("/world-markets", day, edition))])])
    tags = clean_tags([*weekly.TAGS, "국내증시", "미국증시", "증시전망"], 10)
    return Post(edition, day, titles[variant[0]], body, tags, images)


BUILDERS = {"hot": build_hot, "heatmap": build_heatmap, "world": build_world, "movers": build_movers,
            "weekly_market": build_weekly}
TITLE_ARMS = ("A", "B", "C")
TAG_ARMS = ("tight", "wide")


def build(day: dt.date, edition: str, variant: str) -> Post:
    kind = EDITIONS[edition][4]
    post = BUILDERS[kind](day, edition, variant)
    post.variant = variant
    post.campaign = campaign(day, edition)
    post.category_no = EDITIONS[edition][2]
    post.title = short(post.title, 70)
    return post
