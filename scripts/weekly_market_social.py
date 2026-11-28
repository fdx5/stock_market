"""A Saturday recap shared by Buffer and the Naver Blog publisher."""

import datetime as dt
import io
import math
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit

from PIL import Image, ImageDraw

try:
    from world_indices_social import _font
except ModuleNotFoundError:
    from scripts.world_indices_social import _font


EDITION = "weekly_market"
POST_AT = dt.time(18)
SITE = "https://kospimap.com"
SPECS = (
    ("KOSPI", "코스피", "KR", "/kospi", "원·달러 환율과 외국인 현물 수급을 먼저 살피고 반도체 대형주가 함께 움직이는지 확인합니다."),
    ("KOSDAQ", "코스닥", "KR", "/kosdaq", "바이오·로봇·2차전지의 상승 종목 수와 거래대금이 늘어나는지 살핍니다."),
    ("IXIC", "나스닥 종합", "US", "/nasdaq", "미국 국채 금리를 주시하며 대형 기술주 이외 종목에도 매수가 확산되는지 살핍니다."),
)
TAGS = ["주간증시", "코스피", "코스닥", "나스닥", "주간시황", "다음주증시", "코스피맵"]


class NotReady(RuntimeError):
    """The report has no complete set of closes or enough sourced news yet."""


@dataclass(frozen=True)
class News:
    day: dt.date
    title: str
    summary: str
    source: str
    url: str


@dataclass(frozen=True)
class Market:
    code: str
    name: str
    path: str
    rows: tuple[tuple[dt.date, float], ...]
    news: tuple[News, ...]
    outlook: str

    @property
    def weekly(self):
        return change(self.rows[-1][1], self.rows[0][1])

    @property
    def moves(self):
        return [(day, change(close, previous))
                for (_, previous), (day, close) in zip(self.rows, self.rows[1:])]

    def detail(self):
        base, last = self.rows[0], self.rows[-1]
        closes = [close for _, close in self.rows[1:]]
        best = max(self.moves, key=lambda row: row[1])
        worst = min(self.moves, key=lambda row: row[1])
        lines = [
            f"주간 {signed(self.weekly)} · {base[0]:%m/%d} 종가 {base[1]:,.2f} → {last[0]:%m/%d} 종가 {last[1]:,.2f}",
            f"{len(closes)}거래일 종가 범위 {min(closes):,.2f}~{max(closes):,.2f}",
            "일별 전일 대비 " + " · ".join(f"{day:%m/%d} {signed(value)}" for day, value in self.moves),
        ]
        if len(closes) > 1:
            lines.append(f"가장 강한 날 {best[0]:%m/%d} {signed(best[1])} · 가장 약한 날 {worst[0]:%m/%d} {signed(worst[1])}")
        return lines


@dataclass(frozen=True)
class Week:
    saturday: dt.date
    markets: tuple[Market, ...]
    events: tuple[News, ...]

    @property
    def period(self):
        return f"{self.saturday - dt.timedelta(days=5):%m/%d}~{self.saturday - dt.timedelta(days=1):%m/%d}"


def change(close, previous):
    return (close / previous - 1) * 100


def signed(value):
    return f"{value:+.2f}%"


def headline(day):
    return f"{day:%m/%d} 주간 증시 | 코스피·코스닥·나스닥"


def _get_optional(read_json, url):
    try:
        return read_json(url)
    except HTTPError as exc:
        if exc.code != 404:
            raise
        return {}


def _sessions(start, end, region):
    # Shared with the server's prediction batch, including full exchange holidays.
    from app.services import trading_calendar

    days = [start + dt.timedelta(days=offset) for offset in range((end - start).days + 1)]
    if any(not trading_calendar.has_calendar_for(day, region) for day in days):
        raise NotReady(f"{region} 거래소 휴장표 확인 필요")
    return [day for day in days if trading_calendar.is_trading_day(day, region)]


def _read_prices(read_json, code, region, monday, friday):
    expected = _sessions(monday, friday, region)
    previous = _sessions(monday - dt.timedelta(days=10), monday - dt.timedelta(days=1), region)
    if not expected or not previous:
        raise NotReady(f"{code} 거래일 확인 필요")
    if region == "KR":
        points = read_json(f"{SITE}/api/market/index/{code}/history?years=1")["points"]
    else:
        quotes = read_json(f"{SITE}/api/global/indices")["items"]
        points = next(row["points"] for row in quotes if row["code"] == code)
    target = {day.isoformat() for day in [previous[-1], *expected]}
    closes = {}
    for row in points:
        key, close = row.get("date"), row.get("close")
        if key in target and isinstance(close, (int, float)) and math.isfinite(close) and close > 0:
            closes[key] = close
    missing = target - closes.keys()
    if missing:
        raise NotReady(f"{code} 종가 미확인 {', '.join(sorted(missing))}")
    return tuple((day, closes[day.isoformat()]) for day in [previous[-1], *expected])


def _source_url(value):
    if not isinstance(value, str):
        return False
    url = urlsplit(value)
    return url.scheme == "https" and bool(url.hostname) and not url.username and not url.password


def _clean(value):
    return " ".join(value.split()) if isinstance(value, str) else ""


def _weekly_news(read_json, monday, friday):
    urls = [f"{SITE}/api/hot-issues/{monday + dt.timedelta(days=i)}/2200" for i in range(5)]
    with ThreadPoolExecutor(max_workers=5) as pool:
        editions = list(pool.map(lambda url: _get_optional(read_json, url), urls))
    records = []
    for edition in editions:
        for story in edition.get("stories", []):
            for source in story.get("sources", []):
                try:
                    day = dt.date.fromisoformat(str(source.get("published_at", ""))[:10])
                except ValueError:
                    continue
                title = _clean(source.get("title"))
                publisher = _clean(source.get("publisher"))
                url = source.get("url")
                if not (monday <= day <= friday and title and publisher and _source_url(url)):
                    continue
                # Keep the publisher's headline and explicitly attribute it. The
                # archive's AI-generated narrative is not used as a primary source.
                records.append((story.get("importance", 0), story.get("region", ""),
                                _clean(story.get("title")), News(day, title, "", publisher, url)))
                break
    return records


def _select_news(records, code):
    terms = {
        "KOSPI": r"코스피|KOSPI|한국은행|삼성전자|SK하이닉스|증안펀드|원[·/]달러",
        "KOSDAQ": r"코스닥|KOSDAQ|바이오|로봇|2차전지|이차전지|소부장|증안펀드",
        "IXIC": r"나스닥|NASDAQ|엔비디아|Nvidia|연준|FOMC|PCE|미국 증시|뉴욕증시|미 국채",
    }[code]
    ranked = sorted(records, key=lambda row: (row[0] or 0, row[3].day), reverse=True)
    wanted_region = "global" if code == "IXIC" else "korea"
    relevant = [row for row in ranked if re.search(terms, row[2] + " " + row[3].title, re.I)]
    regional = [row for row in ranked if row[1] == wanted_region]
    selected = []
    for _, _, _, news in relevant + regional:
        if any(news.url == existing.url or news.title == existing.title for existing in selected):
            continue
        selected.append(news)
        if len(selected) == 2:
            break
    if not selected:
        raise NotReady(f"{code} 출처가 확인된 주간 뉴스 없음")
    return tuple(selected)


def _next_events(read_json, saturday):
    try:
        source = read_json(f"{SITE}/api/discovery/calendar")
    except OSError:
        return ()
    events = []
    for row in source.get("items", []):
        try:
            at = dt.datetime.fromisoformat(row["at"]).astimezone(dt.timezone(dt.timedelta(hours=9)))
        except (ValueError, KeyError, TypeError):
            continue
        if saturday < at.date() <= saturday + dt.timedelta(days=7) and _source_url(row.get("source_url")):
            events.append(News(at.date(), _clean(row.get("title")), f"한국시간 {at:%H:%M}",
                               _clean(row.get("source")), row["source_url"]))
    return tuple(sorted(events, key=lambda event: event.day)[:3])


def _pilot():
    """Source-checked editorial context for the first edition."""
    friday = dt.date(2026, 11, 27)
    thursday = dt.date(2026, 11, 26)
    bok = News(thursday, "한국은행 기준금리 3.25%로 인상",
               "금융통화위원회는 물가와 금융안정 위험을 고려해 기존 3.00%에서 0.25%p 올렸습니다.",
               "한국은행", "https://www.bok.or.kr/portal/bbs/P0000559/view.do?menuNo=200690&nttId=11067084&programType=newsData")
    return {
        "KOSPI": (
            News(friday, "외국인·기관 동반 매수에 4,900선 회복",
                 "금요일에는 외국인과 기관의 동반 순매수와 반도체주 반등이 지수 회복을 뒷받침했습니다.",
                 "한국경제", "https://www.hankyung.com/article/2026112751366"), bok),
        "KOSDAQ": (
            News(friday, "바이오·로봇·2차전지로 반등 확산",
                 "금요일에는 대형 바이오와 로봇, 2차전지 등 여러 업종이 함께 오르며 700선을 회복했습니다.",
                 "한국경제", "https://www.hankyung.com/article/2026112753921"),
            News(friday, "기관 순매수 상위에 로봇·2차전지·바이오",
                 "연합뉴스 집계에서 레인보우로보틱스, 에코프로, 에이비엘바이오가 기관 순매수 상위에 포함됐습니다.",
                 "연합뉴스", "https://www.yna.co.kr/view/AKR20261127122700008")),
        "IXIC": (
            News(friday, "추수감사절 휴장 뒤 금요일 조기 마감",
                 "26일 휴장 후 27일에는 미 동부시간 오후 1시에 정규장이 끝났습니다.",
                 "나스닥 거래소", "https://www.nasdaqtrader.com/TraderNews.aspx?id=ETA2026-69"),
            News(dt.date(2026, 11, 25), "미국 10월 개인소비지출 발표",
                 "미 경제분석국은 10월 명목 개인소비지출이 전월 대비 0.3% 늘었다고 발표했습니다.",
                 "미 경제분석국", "https://www.bea.gov/sites/default/files/2026-11/pi1026.pdf")),
    }


def load(day, read_json):
    if day.weekday() != 5:
        raise ValueError("주간 증시 발행일은 한국시간 토요일입니다.")
    monday = day - dt.timedelta(days=5)
    friday = day - dt.timedelta(days=1)
    pilot = _pilot() if day == dt.date(2026, 11, 28) else None
    with ThreadPoolExecutor(max_workers=5) as pool:
        prices = [pool.submit(_read_prices, read_json, code, region, monday, friday)
                  for code, _, region, _, _ in SPECS]
        news_task = pool.submit(_weekly_news, read_json, monday, friday) if pilot is None else None
        events_task = pool.submit(_next_events, read_json, day) if pilot is None else None
        archive = news_task.result() if news_task else []
        markets = []
        for (code, name, _, path, watch), future in zip(SPECS, prices):
            rows = future.result()
            closes = [close for _, close in rows[1:]]
            outlook = (f"다음 주에는 {watch} "
                       f"이번 주 종가 상단 {max(closes):,.2f}를 넘으면 후속 매수의 확산을, "
                       f"하단 {min(closes):,.2f}를 밑돌면 변동성 확대 여부를 확인할 구간입니다.")
            if pilot and code == "KOSPI":
                outlook = ("다음 주에는 4,900선에서 외국인 순매수가 이어지는지 확인합니다. "
                           "25일 종가 4,697.51은 이번 주 종가 하단이었고, 24일 종가 5,006.03을 회복하려면 반도체 밖으로도 상승이 확산되는지 볼 필요가 있습니다.")
            if pilot and code == "KOSDAQ":
                outlook = ("700선 안착 여부와 함께 바이오·로봇·2차전지에서 상승 종목 수와 거래대금이 유지되는지 확인합니다. "
                           "상승이 소수 대형주에 집중되고 거래대금이 줄면 금요일 반등의 지속성을 낮춰 볼 근거입니다.")
            if pilot and code == "IXIC":
                outlook = ("정상 거래시간으로 돌아온 뒤 대형 기술주와 반도체가 반등을 이어가는지 확인합니다. "
                           "12월 4일 고용 발표 전후로 미국 국채 금리와 나스닥 종합이 함께 어떻게 움직이는지도 관전 포인트입니다.")
            news = pilot[code] if pilot else _select_news(archive, code)
            markets.append(Market(code, name, path, rows, news, outlook))
        events = events_task.result() if events_task else (
            News(dt.date(2026, 12, 4), "미국 11월 고용보고서", "한국시간 22:30", "미 노동통계국",
                 "https://www.bls.gov/schedule/news_release/empsit.htm"),
        )
    return Week(day, tuple(markets), events)


def render(week, market):
    width, height = 1080, 1350
    image = Image.new("RGB", (width, height), "#100d19")
    draw = ImageDraw.Draw(image)
    text = "#f6f0fe"
    muted = "#bcb0cd"
    gold = "#f1cd76"
    tone = "#ff828d" if market.weekly >= 0 else "#8dbaff"

    def label(x, y, value, size, color=text, bold=False):
        draw.text((x, y), value, font=_font(size, bold), fill=color, anchor="lt")

    def wrap(value, size, pixels=930):
        font = _font(size, False)
        lines, line = [], ""
        for word in value.split():
            trial = f"{line} {word}" if line else word
            if line and draw.textlength(trial, font=font) > pixels:
                lines.append(line)
                line = word
            else:
                line = trial
        return lines + [line] if line else lines

    draw.rectangle((0, 0, width, 10), fill=gold)
    label(56, 46, "KOSPIMAP  /  주간 증시", 29, gold, True)
    label(56, 100, market.name, 75, text, True)
    label(56, 198, f"{week.saturday.year}년 {week.period}  ·  거래소 현지 세션 기준", 28, muted)
    draw.rounded_rectangle((56, 258, 1024, 690), radius=22, fill="#1b1428", outline="#514465", width=2)
    label(82, 286, signed(market.weekly), 61, tone, True)
    label(430, 307, f"마지막 종가  {market.rows[-1][1]:,.2f}", 35, text, True)
    label(82, 376, f"전주 마지막 종가 {market.rows[0][1]:,.2f} 대비 누적 수익률", 26, muted)
    returns = [change(close, market.rows[0][1]) for _, close in market.rows]
    low = min(0, *returns) - 0.35
    high = max(0, *returns) + 0.35
    y_for = lambda value: 580 - (value - low) / (high - low) * 136
    x_for = lambda i: 128 + i * (816 / (len(returns) - 1))
    draw.line((105, y_for(0), 974, y_for(0)), fill="#56496a", width=2)
    coords = [(x_for(i), y_for(value)) for i, value in enumerate(returns)]
    draw.line(coords, fill=tone, width=6, joint="curve")
    for i, ((day, _), (x, y)) in enumerate(zip(market.rows, coords)):
        draw.ellipse((x - 6, y - 6, x + 6, y + 6), fill=tone)
        label(x - 33, 609, f"{day:%m/%d}", 23, muted)
        if i:
            label(x - 40, 645, signed(market.moves[i - 1][1]), 21, text)

    y = 731
    label(56, y, "이번 주 주요 뉴스", 34, gold, True)
    y += 57
    for item in market.news:
        for line in wrap(f"{item.day:%m/%d}  {item.title}", 30)[:2]:
            label(56, y, line, 30)
            y += 39
        label(56, y, item.source, 23, muted)
        y += 41
    y = max(y + 10, 975)
    label(56, y, "다음 주 확인할 점", 34, gold, True)
    y += 54
    for line in wrap(market.outlook, 29)[:4]:
        label(56, y, line, 29)
        y += 40
    draw.line((56, 1240, 1024, 1240), fill="#514465", width=2)
    label(56, 1266, "KOSPIMAP.COM  ·  지수 차트와 시세", 26, muted)
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=True)
    alt = f"{market.name} {week.period}. {' / '.join(market.detail()[:3])}. {market.outlook}"
    return output.getvalue(), alt


def captions(week, fits):
    header = headline(week.saturday)
    summary = " · ".join(f"{market.name} {signed(market.weekly)}" for market in week.markets)
    if week.saturday == dt.date(2026, 11, 28):
        hook = "금요일 국내 반등 뒤 외국인 수급과 바이오·로봇·2차전지 상승 폭, 12/04 미국 고용을 확인합니다."
    else:
        hook = "지수별 일일 등락과 주요 뉴스, 다음 주 관전 포인트를 세 장에 정리했습니다."
    texts = {}
    for service, source in (("threads", "threads"), ("twitter", "x"), ("bluesky", "bluesky")):
        query = urlencode({"utm_source": source, "utm_medium": "social",
                           "utm_campaign": f"{EDITION}-{week.saturday:%Y%m%d}"})
        url = f"{SITE}/world-markets?{query}"
        tags = " ".join(f"#{tag}" for tag in TAGS[:4])
        candidates = [
            f"{header}\n{week.period} | {summary}\n{hook}\n{url}\n{tags}",
            f"{header}\n{week.period} | {summary}\n주간 차트·뉴스·다음 주 전망 ↘\n{url}\n{tags}",
            f"{header}\n{week.period} | {summary}\n{url}\n{tags}",
        ]
        texts[service] = next(candidate for candidate in candidates if fits(service, candidate))
    return texts


def make(day, fits, read_json):
    week = load(day, read_json)
    media = []
    for market in week.markets:
        png, alt = render(week, market)
        media.append((f"weekly_market_{market.code.lower()}.png", png, alt, None))
    return captions(week, fits), media
