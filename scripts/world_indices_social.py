"""Global index scoreboard posts (08:00 / 17:00 KST) for X, Threads and Bluesky.

Builds a ranked 12-index thumbnail with country flags and three captions sized
for each network. Delivery, receipts and image hosting live in social_publish.py.
"""

import datetime as dt
import io
import json
import math
import os
from pathlib import Path
import re
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw, ImageFont


SITE = "https://kospimap.com"
KST = ZoneInfo("Asia/Seoul")
EDITIONS = {"world_morning": "0800", "world_evening": "1700"}
FLAG_DIR = Path(__file__).with_name("social_flags")
FLAG_EMOJI = {"kr": "🇰🇷", "us": "🇺🇸", "jp": "🇯🇵", "cn": "🇨🇳", "hk": "🇭🇰",
              "tw": "🇹🇼", "gb": "🇬🇧", "de": "🇩🇪", "in": "🇮🇳"}
# (key, label, short label for X, Yahoo symbol, flag, region)
INDICES = (
    ("kospi", "코스피", "코스피", "^KS11", "kr", "asia"),
    ("kosdaq", "코스닥", "코스닥", "^KQ11", "kr", "asia"),
    ("sp500", "S&P 500", "S&P", "^GSPC", "us", "us"),
    ("nasdaq", "나스닥", "나스닥", "^IXIC", "us", "us"),
    ("dow", "다우존스", "다우", "^DJI", "us", "us"),
    ("nikkei", "닛케이225", "닛케이", "^N225", "jp", "asia"),
    ("shanghai", "상하이종합", "상하이", "000001.SS", "cn", "asia"),
    ("hangseng", "항셍", "항셍", "^HSI", "hk", "asia"),
    ("taiex", "대만 가권", "대만", "^TWII", "tw", "asia"),
    ("sensex", "인도 센섹스", "인도", "^BSESN", "in", "asia"),
    ("ftse", "영국 FTSE100", "영국", "^FTSE", "gb", "europe"),
    ("dax", "독일 DAX", "독일", "^GDAXI", "de", "europe"),
)
BASE_TAGS = ("#글로벌증시", "#코스피", "#미국증시", "#해외증시")
WEEKDAYS = "월화수목금토일"


def _get_json(url):
    req = Request(url, headers={"User-Agent": "Mozilla/5.0 (KOSPIMAP-SocialPublisher/1)"})
    with urlopen(req, timeout=20) as response:
        return json.loads(response.read())


def _chart(symbol):
    data = _get_json(f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol)}"
                     "?range=1mo&interval=1d")["chart"]["result"][0]
    stamps = data.get("timestamp") or []
    closes = data["indicators"]["quote"][0]["close"]
    tz = ZoneInfo(data["meta"].get("exchangeTimezoneName") or "UTC")
    rows = [(dt.datetime.fromtimestamp(t, tz).date(), float(c))
            for t, c in zip(stamps, closes) if c is not None and math.isfinite(c) and c > 0]
    # Yahoo can repeat the live bar; keep one close per exchange date.
    series = {}
    for day, close in rows:
        series[day] = close
    meta_price = data["meta"].get("regularMarketPrice")
    if series and meta_price:
        series[max(series)] = float(meta_price)
    return sorted(series.items())


def weekly_mode(day, edition):
    # Saturday evening and all of Sunday have no new sessions: show the week.
    return day.weekday() == 6 or (day.weekday() == 5 and edition == "world_evening")


# Keys served by the site's own validated quote feeds (same numbers as the pages).
SITE_KEYS = {"dow": "dow", "nasdaq": "nasdaq", "nikkei": "nikkei", "shanghai": "shanghai",
             "hangseng": "hangseng", "taiex": "taiwan", "ftse": "ftse"}


def _site_quotes():
    found = {}
    try:
        for item in _get_json(f"{SITE}/api/global/indices")["items"]:
            found[item["key"]] = item
    except Exception as error:
        print(f"::warning::site global quotes unavailable ({type(error).__name__})")
    try:
        kr = _get_json(f"{SITE}/api/investor/indices?fresh=true")
        for key in ("kospi", "kosdaq"):
            found[key] = kr[key]
    except Exception as error:
        print(f"::warning::site KR quotes unavailable ({type(error).__name__})")
    return found


def _valid(*values):
    return all(isinstance(v, (int, float)) and math.isfinite(v) for v in values)


def fetch_quotes(day, edition):
    weekly = weekly_mode(day, edition)
    site = _site_quotes()
    quotes = []
    for key, label, short, symbol, flag, region in INDICES:
        live = site.get(SITE_KEYS.get(key, key))
        close = pct = None
        if live and _valid(live.get("close"), live.get("change_pct")) and live["close"] > 0:
            close, pct = float(live["close"]), float(live["change_pct"])
        if weekly or close is None:
            try:
                series = _chart(symbol)
            except Exception as error:  # One provider gap should not cancel the edition.
                print(f"::warning::{symbol} quote unavailable ({type(error).__name__})")
                series = []
            if live and live.get("points"):
                # Prefer the site's own history where it exists.
                series = [(dt.date.fromisoformat(p["date"]), float(p["close"])) for p in live["points"]
                          if _valid(p.get("close"))]
                if close is not None:
                    series.append((dt.date.fromisoformat(live.get("quote_date") or str(day)), close))
                    series = sorted(dict(series).items())
            if len(series) >= 2:
                last_day, last = series[-1]
                if weekly:
                    base = next((c for d, c in reversed(series) if d <= last_day - dt.timedelta(days=7)), series[0][1])
                else:
                    base = series[-2][1]
                close, pct = (close or last), (last / base - 1) * 100
        # Index daily moves beyond 15% are provider faults, not markets.
        if close is None or pct is None or abs(pct) > (25 if weekly else 15):
            continue
        quotes.append({"key": key, "label": label, "short": short, "flag": flag, "region": region,
                       "close": close, "pct": pct})
    if len(quotes) < 10 or not {"kospi", "kosdaq"} <= {q["key"] for q in quotes}:
        raise RuntimeError("Too few global index quotes to publish")
    for item in quotes:
        item["pct"] = round(item["pct"], 2)
    return sorted(quotes, key=lambda q: q["pct"], reverse=True), weekly


def _verb(pct):
    size = abs(pct)
    if size >= 3:
        return "폭등" if pct > 0 else "폭락"
    if size >= 1.5:
        return "급등" if pct > 0 else "급락"
    if size >= 0.5:
        return "상승" if pct > 0 else "하락"
    return "강보합" if pct >= 0 else "약보합"


def _fmt_pct(pct):
    return f"{pct:+.2f}%"


def analyze(quotes, weekly):
    by_key = {q["key"]: q for q in quotes}
    top, bottom = quotes[0], quotes[-1]
    kospi = by_key["kospi"]
    ups = sum(q["pct"] > 0 for q in quotes)
    downs = sum(q["pct"] < 0 for q in quotes)
    regions = {}
    for name, region in (("미국", "us"), ("유럽", "europe"), ("아시아", "asia")):
        moves = [q["pct"] for q in quotes if q["region"] == region]
        if moves:
            regions[name] = sum(moves) / len(moves)
    rank = quotes.index(kospi) + 1
    period = "이번 주" if weekly else ""
    # The strongest single move leads; Korea leads whenever it is the story.
    lead = max(quotes, key=lambda q: abs(q["pct"]))
    if abs(kospi["pct"]) >= 2 or (abs(kospi["pct"]) >= abs(lead["pct"]) * 0.7 and abs(kospi["pct"]) >= 1):
        lead = kospi
    verb = _verb(lead["pct"])
    if lead is kospi and rank == len(quotes) and kospi["pct"] < 0:
        hook = f"코스피 {_fmt_pct(kospi['pct'])} {verb}… {len(quotes)}개 지수 중 꼴찌"
    elif lead is kospi and rank == 1 and kospi["pct"] > 0:
        hook = f"코스피 {_fmt_pct(kospi['pct'])} {verb}! 세계 1등"
    elif abs(lead["pct"]) >= 1.5:
        hook = f"{lead['label']} {_fmt_pct(lead['pct'])} {verb}"
        hook += f", 코스피는 {_fmt_pct(kospi['pct'])}" if lead is not kospi else ""
    elif ups >= len(quotes) - 2:
        hook = f"세계 증시 동반 상승, 1위 {top['label']} {_fmt_pct(top['pct'])}"
    elif downs >= len(quotes) - 2:
        hook = f"세계 증시 동반 하락, 꼴찌 {bottom['label']} {_fmt_pct(bottom['pct'])}"
    else:
        hook = f"엇갈린 세계 증시, {top['label']} {_fmt_pct(top['pct'])} vs {bottom['label']} {_fmt_pct(bottom['pct'])}"
    if period:
        hook = f"{period} {hook}"
    emoji = "🚨" if lead["pct"] <= -1.5 else "🔥" if lead["pct"] >= 1.5 else "📊"

    best_region = max(regions, key=regions.get)
    worst_region = min(regions, key=regions.get)
    span = "주간" if weekly else ""
    summary = [
        f"{len(quotes)}개 지수 중 {ups}곳 상승, {downs}곳 하락.",
        f"{span}1위 {top['label']} {_fmt_pct(top['pct'])}, 꼴찌 {bottom['label']} {_fmt_pct(bottom['pct'])}.".replace("주간1위", "주간 1위"),
    ]
    if bottom is not kospi and top is not kospi:
        summary.append(f"코스피는 {_fmt_pct(kospi['pct'])}로 {len(quotes)}개 중 {rank}위.")
    kosdaq = by_key["kosdaq"]
    summary.append(f"코스닥은 {_fmt_pct(kosdaq['pct'])}.")
    if best_region != worst_region:
        summary.append(f"권역 평균은 {best_region} {_fmt_pct(regions[best_region])}로 가장 강했고 "
                       f"{worst_region} {_fmt_pct(regions[worst_region])}로 가장 약했습니다.")

    tags = []
    lead_name = re.sub(r"[^0-9A-Za-z가-힣]", "", lead["short"] if lead["short"] != "S&P" else "SNP500")
    if lead_name and abs(lead["pct"]) >= 0.5:
        tags.append(f"#{lead_name}{verb}")
    elif ups >= len(quotes) - 2:
        tags.append("#증시상승")
    elif downs >= len(quotes) - 2:
        tags.append("#증시하락")
    else:
        tags.append(f"#{lead_name}")
    if abs(regions.get("아시아", 0)) >= 1:
        tags.append("#아시아증시")
    elif lead["region"] == "us" or abs(regions.get("미국", 0)) >= 1:
        tags.append("#나스닥" if "#나스닥" not in tags[0] else "#뉴욕증시")
    elif lead["region"] == "europe":
        tags.append("#유럽증시")
    elif weekly:
        tags.append("#주간증시")
    return {"hook": hook, "emoji": emoji, "summary": summary, "tags": tags[:2],
            "ups": ups, "downs": downs, "kospi_rank": rank}


# Set by a manual re-post ("HHMM"): the post is stamped with that time and marked as an update.
UPDATE_STAMP = None
COUNTRY = {"kr": "한국", "us": "미국", "jp": "일본", "cn": "중국", "hk": "홍콩"}


def _slot(edition):
    return UPDATE_STAMP or EDITIONS[edition]


def headline(day, edition):
    slot = _slot(edition)
    suffix = " (업데이트)" if UPDATE_STAMP else ""
    return f"🌏 {day:%m/%d} {slot[:2]}:{slot[2:]} 세계 증시 성적표{suffix}"


def _text_line(q):
    # Threads clients on Windows show flag emoji as letters; use words and arrows there.
    country = COUNTRY.get(q["flag"])
    name = q["label"] if not country or q["label"].startswith(country) else f"{country} {q['label']}"
    arrow = "▲" if q["pct"] > 0 else "▼" if q["pct"] < 0 else "■"
    return f"{arrow} {name} {_fmt_pct(q['pct'])}"


def link(service):
    params = urlencode({"utm_source": "x" if service == "twitter" else service,
                        "utm_campaign": "world_indices"})
    return f"{SITE}/world-markets?{params}"


def _line(q, short=False):
    return f"{FLAG_EMOJI[q['flag']]}{q['short'] if short else q['label']} {_fmt_pct(q['pct'])}"


def captions(day, edition, quotes, analysis, fits):
    """Return {service: text}; ``fits(service, text)`` enforces each network's limit."""
    first = headline(day, edition)
    tags = " ".join([*BASE_TAGS, *analysis["tags"]])
    hook = f"{analysis['emoji']} {analysis['hook']}"
    by_key = {q["key"]: q for q in quotes}
    out = {}

    # X: headline, hook, 2-4 key moves, link, tags. Drop moves, then tags, to fit.
    picks = []
    for q in (by_key["kospi"], quotes[0], quotes[-1], by_key.get("nasdaq")):
        if q and q not in picks:
            picks.append(q)
    x_tags = [*BASE_TAGS[:2], *analysis["tags"]]
    for count in range(len(picks), 0, -1):
        for tag_count in range(len(x_tags), 1, -1):
            text = (f"{first}\n{hook}\n" + " ".join(_line(q, True) for q in picks[:count])
                    + f"\n👉 {link('twitter')}\n" + " ".join(x_tags[:tag_count]))
            if fits("twitter", text):
                out["twitter"] = text
                break
        if "twitter" in out:
            break

    # Threads: full ranking and the plain-language read-out.
    full, brief = " ".join(analysis["summary"]), " ".join(analysis["summary"][:2])
    ranking = "\n".join(f"{i}. {_text_line(q)}" for i, q in enumerate(quotes, 1))
    plain = "\n".join(_text_line(q) for q in quotes)
    edges = "\n".join(_text_line(q) for q in quotes[:3] + quotes[-3:])
    for body, variant, cta in ((full, ranking, "나라별 지수 차트·히트맵 실시간 보기 👉 "),
                               (full, plain, "나라별 차트·히트맵 👉 "), (brief, plain, "👉 "),
                               (full, edges, "나라별 차트·히트맵 👉 "), (brief, edges, "👉 ")):
        text = f"{first}\n{hook}\n\n{body}\n\n{variant}\n\n{cta}{link('threads')}\n{tags}"
        if fits("threads", text):
            out["threads"] = text
            break

    # Bluesky: 300 characters including the link.
    short_body = " ".join(analysis["summary"][:3])
    top3 = " ".join(_line(q, True) for q in quotes[:3])
    low3 = " ".join(_line(q, True) for q in quotes[-3:])
    for text in (
        f"{first}\n{hook}\n{short_body}\n🔺{top3}\n🔻{low3}\n{link('bluesky')}\n{tags}",
        f"{first}\n{hook}\n{short_body}\n{link('bluesky')}\n{tags}",
        f"{first}\n{hook}\n{analysis['summary'][0]}\n{link('bluesky')}\n{' '.join([*BASE_TAGS[:2], *analysis['tags']])}",
    ):
        if fits("bluesky", text):
            out["bluesky"] = text
            break
    missing = {"twitter", "threads", "bluesky"} - out.keys()
    if missing:
        raise RuntimeError("World index captions do not fit: " + ", ".join(sorted(missing)))
    return out


# ---------------------------------------------------------------- thumbnail
W, H = 1600, 900
UP, DOWN, FLAT = (255, 64, 96), (64, 150, 255), (170, 178, 196)
CYAN = (0, 234, 255)
BG = (6, 9, 18)


def _font(size, bold=True):
    candidates = [os.getenv("SOCIAL_FONT_BOLD" if bold else "SOCIAL_FONT", ""),
                  os.getenv("SOCIAL_FONT", ""),
                  "C:/Windows/Fonts/malgunbd.ttf" if bold else "C:/Windows/Fonts/malgun.ttf",
                  "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
                  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"]
    for path in candidates:
        if path and os.path.exists(path):
            return ImageFont.truetype(path, size)
    raise RuntimeError("No Korean font is available for the thumbnail")


def _tone(pct):
    return UP if pct > 0 else DOWN if pct < 0 else FLAT


def _mix(color, other, amount):
    return tuple(round(a * (1 - amount) + b * amount) for a, b in zip(color, other))


def _fit(draw, text, size, width, bold=True):
    while size > 18:
        font = _font(size, bold)
        if draw.textlength(text, font=font) <= width:
            return font
        size -= 2
    return _font(size, bold)


def _flag(code, height):
    with Image.open(FLAG_DIR / f"{code}.png") as raw:
        image = raw.convert("RGBA")
    width = round(image.width * height / image.height)
    image = image.resize((width, height), Image.Resampling.LANCZOS)
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, width - 1, height - 1), radius=6, fill=255)
    image.putalpha(mask)
    return image


def render(day, edition, quotes, analysis, weekly):
    canvas = Image.new("RGB", (W, H), BG)
    glow = Image.new("RGB", (W, H), BG)
    gd = ImageDraw.Draw(glow)
    lead = _tone(quotes[-1]["pct"] if abs(quotes[-1]["pct"]) > abs(quotes[0]["pct"]) else quotes[0]["pct"])
    for r in range(520, 0, -20):  # Soft neon wash behind the headline.
        gd.ellipse((W - 380 - r, -260 - r // 2, W - 380 + r, -260 + r), fill=_mix(BG, lead, 0.16 * (1 - r / 520)))
    canvas.paste(glow)
    draw = ImageDraw.Draw(canvas)
    for x in range(0, W, 40):
        draw.line((x, 0, x, H), fill=(13, 19, 34))
    for y in range(0, H, 40):
        draw.line((0, y, W, y), fill=(13, 19, 34))

    slot = _slot(edition)
    draw.text((48, 34), "GLOBAL MARKET SCOREBOARD" + ("  ·  WEEKLY" if weekly else ""),
              font=_font(26), fill=CYAN)
    size = max(abs(quotes[0]["pct"]), abs(quotes[-1]["pct"]))
    badge = "BREAKING" if size >= 3 else "HOT" if size >= 1.5 else ""
    if badge:
        label = "GLOBAL MARKET SCOREBOARD" + ("  ·  WEEKLY" if weekly else "")
        bx = 48 + draw.textlength(label, font=_font(26)) + 20
        bw = draw.textlength(badge, font=_font(24)) + 28
        draw.rounded_rectangle((bx, 32, bx + bw, 68), radius=18, fill=lead)
        draw.text((bx + bw / 2, 50), badge, font=_font(24), fill=(255, 255, 255), anchor="mm")
    stamp = f"{day:%Y.%m.%d}({WEEKDAYS[day.weekday()]}) {slot[:2]}:{slot[2:]} KST"
    draw.text((W - 48, 34), stamp, font=_font(28), fill=(220, 230, 255), anchor="ra")
    hook = analysis["hook"]
    draw.text((48, 78), hook, font=_fit(draw, hook, 64, W - 96), fill=_mix(lead, (255, 255, 255), 0.15))
    sub = (f"세계 주요 {len(quotes)}개 지수 {'주간 ' if weekly else ''}등락률 순위  ·  "
           f"상승 {analysis['ups']}  하락 {analysis['downs']}  ·  코스피 {analysis['kospi_rank']}위")
    draw.text((50, 160), sub, font=_font(26, bold=False), fill=(150, 164, 196))

    cols, rows, gap, top, left = 4, 3, 18, 214, 40
    cw = (W - 2 * left - (cols - 1) * gap) // cols
    ch = (H - top - 70 - (rows - 1) * gap) // rows
    peak = max(abs(q["pct"]) for q in quotes) or 1
    for i, q in enumerate(quotes):
        x = left + (i % cols) * (cw + gap)
        y = top + (i // cols) * (ch + gap)
        tone = _tone(q["pct"])
        strength = 0.12 + 0.30 * min(1.0, abs(q["pct"]) / peak)
        korea = q["flag"] == "kr"
        draw.rounded_rectangle((x, y, x + cw, y + ch), radius=16, fill=_mix((14, 19, 34), tone, strength),
                               outline=CYAN if korea else _mix(tone, (255, 255, 255), 0.1), width=4 if korea else 2)
        draw.text((x + 18, y + 14), f"{i + 1}", font=_font(30), fill=(235, 240, 255))
        flag = _flag(q["flag"], 40)
        canvas.paste(flag, (x + 62, y + 16), flag)
        draw.text((x + 62 + flag.width + 12, y + 18), q["label"],
                  font=_fit(draw, q["label"], 30, cw - flag.width - 92), fill=(240, 244, 255))
        arrow = "▲" if q["pct"] > 0 else "▼" if q["pct"] < 0 else "■"
        pct = f"{arrow} {_fmt_pct(q['pct'])}"
        draw.text((x + cw - 18, y + ch - 16), pct, font=_fit(draw, pct, 54, cw - 36), fill=_mix(tone, (255, 255, 255), 0.18), anchor="rd")
        draw.text((x + 20, y + 72), f"{q['close']:,.2f}", font=_font(26, bold=False), fill=(190, 200, 225))

    draw.text((48, H - 44), "실시간 세계 증시 히트맵 ▶ kospimap.com/world-markets", font=_font(28), fill=CYAN)
    basis = "주간 등락 (최근 거래일 종가 vs 1주 전)" if weekly else "각 시장 최근 거래일 기준 · 장중 지수는 게시 시점 시세"
    draw.text((W - 48, H - 40), basis, font=_font(20, bold=False), fill=(120, 132, 160), anchor="ra")

    output = io.BytesIO()
    canvas.save(output, "PNG", optimize=True)
    if output.tell() > 975_000:
        output = io.BytesIO()
        canvas.quantize(colors=256, dither=Image.Dither.NONE).save(output, "PNG", optimize=True)
    if output.tell() > 975_000:
        raise RuntimeError("World index thumbnail exceeds the image size budget")
    return output.getvalue()


def make(day, edition, fits):
    quotes, weekly = fetch_quotes(day, edition)
    analysis = analyze(quotes, weekly)
    texts = captions(day, edition, quotes, analysis, fits)
    png = render(day, edition, quotes, analysis, weekly)
    slot = _slot(edition)
    alt = (f"{day:%m/%d} {slot[:2]}:{slot[2:]} 세계 주요 {len(quotes)}개 지수 등락률 순위: "
           + ", ".join(f"{q['label']} {_fmt_pct(q['pct'])}" for q in quotes))
    return texts, [(f"world-{slot}.png", png, alt, None)]
