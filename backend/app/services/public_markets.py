"""Public market snapshots for discovery, sharing and embeds. No database writes."""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from io import BytesIO
import html
import math
import re
from urllib.parse import urlencode
from email.utils import format_datetime

from app.services.cache import cache
from app.site import PRIMARY_SITE_URL as SITE

KST = timezone(timedelta(hours=9))
MARKETS = {
    "kospi": {"name": "코스피", "path": "/map", "limit": 500, "currency": "KRW"},
    "kosdaq": {"name": "코스닥", "path": "/kosdaq-map", "limit": 200, "currency": "KRW"},
    "nasdaq100": {"name": "나스닥 100", "path": "/nasdaq100-map", "limit": 103, "currency": "USD"},
}
PAGE_MARKETS = {"/today": "kospi", "/map": "kospi", "/kospi-100": "kospi", "/ranking/trading-value": "kospi",
                "/kosdaq-map": "kosdaq", "/kosdaq-100": "kosdaq", "/nasdaq100-map": "nasdaq100", "/nasdaq-100": "nasdaq100"}
PAGES = {
    "/today": ("오늘 증시 한눈에 · 코스피 코스닥 상승·하락·거래대금 | K-Stock Hub", "코스피·코스닥·나스닥 100 표본의 상승·하락 종목, 거래 집중과 업종 흐름을 실제 시세로 비교하세요. 시장 카드 공유, RSS 구독과 평일 확인 알림을 제공합니다."),
    "/share-market": ("증시 카드 공유·시장 위젯 퍼가기 | K-Stock Hub", "코스피·코스닥·나스닥 100 시장 요약 카드를 내려받고, 외부 사이트용 증시 위젯과 공유 링크를 만들어 보세요."),
}


def number(value):
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError, OverflowError):
        return None


def summarize(market: str, items: list[dict], collected_at: str) -> dict:
    spec = MARKETS[market]
    rows, seen = [], set()
    for item in items:
        code = str(item.get("code") or "").strip().upper()
        price = number(item.get("close"))
        if not re.fullmatch(r"[A-Z0-9.-]{1,16}", code) or code in seen or price is None or price <= 0:
            continue
        seen.add(code)
        volume = number(item.get("volume"))
        turnover = number(item.get("turnover"))
        actual = turnover is not None and turnover >= 0
        rows.append({
            "code": code, "name": str(item.get("name") or code)[:80],
            "sector": str(item.get("sector") or "미분류")[:80], "close": price,
            "change_pct": number(item.get("change_pct")), "volume": volume if volume is not None and volume >= 0 else None,
            "turnover": turnover if actual else number(price * volume) if volume is not None and volume >= 0 else None,
            "turnover_kind": "reported" if actual else "estimate", "quote_time": number(item.get("quote_time")),
        })
    known = [row for row in rows if row["change_pct"] is not None]
    rising = sorted((row for row in known if row["change_pct"] > 0), key=lambda row: (-row["change_pct"], row["code"]))
    falling = sorted((row for row in known if row["change_pct"] < 0), key=lambda row: (row["change_pct"], row["code"]))
    sectors = {}
    for row in known:
        group = sectors.setdefault(row["sector"], [])
        group.append(row["change_pct"])
    return {
        "market": market, "name": spec["name"], "currency": spec["currency"], "map_path": spec["path"],
        "collected_at": collected_at, "count": len(rows), "known_count": len(known),
        "up": len(rising), "down": len(falling), "flat": len(known) - len(rising) - len(falling),
        "missing_change": len(rows) - len(known),
        "advance_ratio": len(rising) / len(known) * 100 if known else None,
        "average_change": sum(row["change_pct"] for row in known) / len(known) if known else None,
        "gainers": rising[:6], "losers": falling[:6],
        "turnover": sorted((row for row in rows if row["turnover"] is not None), key=lambda row: (-row["turnover"], row["code"]))[:6],
        "largest": rows[:15],
        "sectors": sorted(({"name": name, "count": len(values), "average_change": sum(values) / len(values)} for name, values in sectors.items()), key=lambda row: (-row["average_change"], row["name"]))[:8],
        "basis": ("나스닥 100 구성 종목 중 시세가 제공된 표본. " if market == "nasdaq100" else "기존 시장 지도에 포함된 시가총액 상위 표본. ") + "전체 시장·지수 수익률이 아니며 평균은 표본의 단순평균입니다. 집계 시각과 실제 체결 시각은 다를 수 있습니다.",
        "_rows": rows,
    }


def snapshot(market: str) -> dict:
    def build():
        from app.services import market_map, us_market_map
        loaders = {"kospi": market_map.get_kospi_map, "kosdaq": market_map.get_kosdaq_map, "nasdaq100": us_market_map.get_nasdaq100_map}
        items = loaders[market](MARKETS[market]["limit"], fresh=False)
        if not items:
            raise RuntimeError("Market snapshot is not ready")
        return summarize(market, items, datetime.now(KST).isoformat(timespec="seconds"))
    return cache.get_or_set(f"public_market:v1:{market}", 60, build)


def public_payload(value: dict) -> dict:
    return {key: item for key, item in value.items() if not key.startswith("_")}


def cached_stock(code: str) -> tuple[dict, dict] | None:
    """Search populated snapshots only: stock HTML never launches per-symbol fetches."""
    for market in MARKETS:
        value = cache.peek(f"public_market:v1:{market}")
        if value:
            for row in value["_rows"]:
                if row["code"] == code:
                    return value, row
    return None


def _pct(value) -> str:
    return "미제공" if value is None else f"{value:+.2f}%"


def seo_content(path: str, stock_code: str = "", market: str = "kospi") -> str:
    if stock_code:
        found = cached_stock(stock_code)
        if not found:
            return ""
        value, row = found
        return (f'<section><h2>{html.escape(row["name"])} 최근 제공 시세</h2>'
                f'<p>현재가 {row["close"]:,.2f} {value["currency"]}, 전일 대비 {_pct(row["change_pct"])}. '
                f'화면 집계 {html.escape(value["collected_at"])}. 실제 체결 시각과 다를 수 있습니다.</p></section>')
    market = market if path == "/today" and market in MARKETS else PAGE_MARKETS.get(path)
    if not market:
        return ""
    try:
        value = snapshot(market)
    except Exception:
        return '<p>시장 요약을 준비 중입니다. 시장 지도에서 수신 상태를 확인할 수 있습니다.</p>'
    rows = value["turnover"] if path == "/ranking/trading-value" else value["largest"]
    table = "".join(f'<tr><th scope="row"><a href="/stock/{row["code"]}">{html.escape(row["name"])}</a></th>'
                    f'<td>{row["close"]:,.2f} {value["currency"]}</td><td>{_pct(row["change_pct"])}</td>'
                    f'<td>{html.escape(row["sector"])}</td></tr>' for row in rows)
    return (f'<section><h2>{value["name"]} 실제 시세와 시장 분포</h2><p>시총 상위 표본 {value["count"]}종목, '
            f'등락률 확인 {value["known_count"]}종목 중 상승 {value["up"]}, 하락 {value["down"]}, 보합 {value["flat"]}. '
            f'화면 집계 {html.escape(value["collected_at"])}.</p><p>{html.escape(value["basis"])}</p>'
            '<table><caption>수신된 종목 시세 · 거래규모는 제공값 또는 현재가×거래량의 근사치</caption>'
            '<thead><tr><th>종목</th><th>가격</th><th>등락률</th><th>업종</th></tr></thead>'
            f'<tbody>{table}</tbody></table><p><a href="/today">오늘 시장 요약</a> · '
            f'<a href="{value["map_path"]}">시장 지도</a> · <a href="/share-market">시장 카드와 위젯 공유</a></p></section>')


def widget_html(market: str, value: dict | None) -> str:
    spec = MARKETS[market]
    target = f'{SITE}/today?{urlencode({"market": market, "utm_source": "market_widget", "utm_medium": "referral", "utm_campaign": "free_distribution"})}'
    if value:
        rows = "".join(f'<tr><th scope="row"><a target="_blank" rel="noopener" href="{SITE}/stock/{row["code"]}?utm_source=market_widget&amp;utm_medium=referral&amp;utm_campaign=free_distribution">{html.escape(row["name"])}</a></th><td>{row["close"]:,.2f}</td><td>{_pct(row["change_pct"])}</td></tr>' for row in value["largest"][:5])
        body = f'<p>표본 {value["count"]}종목 · 상승 {value["up"]} / 하락 {value["down"]}</p><table><thead><tr><th>종목</th><th>{spec["currency"]}</th><th>등락률</th></tr></thead><tbody>{rows}</tbody></table><small>화면 집계 {html.escape(value["collected_at"])} · 체결 시각과 다를 수 있음</small>'
    else:
        body = '<p>시장 데이터를 준비 중입니다. 전체 시장에서 확인하세요.</p>'
    return (f'<!doctype html><html lang="ko" data-design="neo" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>{spec["name"]} 시장 위젯</title><link rel="stylesheet" href="/public-market-widget.css"></head>'
            f'<body><section class="ng-panel public-market-widget"><span class="ng-kicker">KOSPIMAP / MARKET SNAPSHOT</span><h2>{spec["name"]} 시장 요약</h2>{body}<a class="widget-cta" href="{html.escape(target, quote=True)}" target="_blank" rel="noopener">KOSPIMAP에서 전체 시장 보기 ↗</a><small>표본의 가격 정보 · 투자 참고용</small></section></body></html>')


def card_png(value: dict) -> bytes:
    from PIL import Image, ImageDraw, ImageFont
    from pathlib import Path
    def font(size):
        for path in ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "C:/Windows/Fonts/malgun.ttf"):
            if Path(path).is_file():
                return ImageFont.truetype(path, size)
        return ImageFont.load_default()
    canvas = Image.new("RGB", (1200, 630), "#0b070e")
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((28, 28, 1172, 602), radius=18, fill="#19111e", outline="#735683", width=2)
    draw.text((65, 55), "KOSPIMAP / MARKET SNAPSHOT", font=font(22), fill="#bf85ff")
    draw.text((65, 105), f'{value["name"]} 오늘 시장 한눈에', font=font(44), fill="#f8f6f1")
    draw.text((65, 185), f'표본 {value["count"]}종목 · 등락률 확인 {value["known_count"]}종목', font=font(23), fill="#b6a5c0")
    for x, label, amount, color in ((65, "상승", value["up"], "#ff6c83"), (420, "하락", value["down"], "#64aaff"), (775, "보합", value["flat"], "#baafc1")):
        draw.text((x, 245), label, font=font(24), fill="#b6a5c0")
        draw.text((x, 285), str(amount), font=font(72), fill=color)
    leaders = value["gainers"][:3]
    leader_text = "표본 상승 상위: " + " · ".join(f'{row["name"][:12]} {_pct(row["change_pct"])}' for row in leaders)
    while draw.textlength(leader_text, font=font(21)) > 1060:
        leader_text = leader_text[:-2].rstrip(" …") + "…"
    draw.text((65, 400), leader_text, font=font(21), fill="#f8f6f1")
    draw.text((65, 465), "집계 " + value["collected_at"], font=font(20), fill="#b6a5c0")
    draw.text((65, 510), "표본 분포이며 지수 수익률이 아닙니다 · 실제 체결 시각과 다를 수 있음", font=font(18), fill="#b6a5c0")
    draw.text((65, 553), "kospimap.com/today", font=font(22), fill="#bf85ff")
    stream = BytesIO()
    canvas.save(stream, format="PNG", optimize=True)
    return stream.getvalue()


def calendar_lines(lines: list[str]) -> str:
    """RFC 5545 folding preserves UTF-8 characters and the 75-octet limit."""
    folded = []
    for line in lines:
        part = ""
        for char in line:
            if len((part + char).encode("utf-8")) > 75:
                folded.append(part)
                part = " "
            part += char
        folded.append(part)
    return "\r\n".join(folded)


def brief_feed(records: list[dict]) -> str:
    """Only already-published briefs; stable GUIDs, no invented publication times."""
    items, seen, dates = [], set(), []
    for item in records:
        day, market = str(item.get("date", "")), str(item.get("market", "")).lower()
        if market not in {"kospi", "kosdaq"} or (day, market) in seen:
            continue
        try:
            if datetime.strptime(day, "%Y-%m-%d").strftime("%Y-%m-%d") != day:
                continue
        except ValueError:
            continue
        seen.add((day, market))
        published = ""
        try:
            stamp = datetime.fromisoformat(str(item.get("created_at", "")).replace("Z", "+00:00"))
            stamp = stamp.replace(tzinfo=KST) if stamp.tzinfo is None else stamp
            dates.append(stamp)
            published = f"<pubDate>{format_datetime(stamp)}</pubDate>"
        except ValueError:
            pass
        url = f"{SITE}/market-brief/{day}/{market}"
        link = url + "?utm_source=market_feed&amp;utm_medium=referral&amp;utm_campaign=repeat_visit"
        title = f"{day} {MARKETS[market]['name']} 장마감 브리핑"
        items.append(f'<item><title>{html.escape(title)}</title><link>{link}</link><guid isPermaLink="true">{url}</guid><description>종가, 수급과 거래 흐름을 날짜별 브리핑에서 확인하세요.</description>{published}</item>')
    built = f"<lastBuildDate>{format_datetime(max(dates))}</lastBuildDate>" if dates else ""
    return ('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>'
            f'<title>KOSPIMAP 장마감 브리핑</title><link>{SITE}/market-brief</link>'
            f'<description>발행된 코스피·코스닥 브리핑을 받아보세요.</description><language>ko-KR</language>{built}'
            f'{"".join(items)}</channel></rss>')
