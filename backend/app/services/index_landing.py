"""Index landing pages: /kospi, /kosdaq, /nasdaq. Read-only; no database writes.

People who search "코스피", "코스닥" or "나스닥" want the index itself — its level,
today's move, the recent closes and what moved it. The maps answered a different
question (which stocks), so the index had no page of its own. One payload feeds
both the server-rendered HTML (crawlers, first paint) and the React page, so
what a crawler reads is what a reader sees.
"""
from __future__ import annotations

import datetime as dt
import html
import math

from app.services.cache import cache

KST = dt.timezone(dt.timedelta(hours=9))

LANDINGS: dict[str, dict] = {
    "kospi": {
        "path": "/kospi", "name": "코스피", "en": "KOSPI", "history": "KS11", "live": "KOSPI",
        "market": "kospi", "map": "/map", "map_label": "코스피 시가총액 맵",
        "title": "코스피 지수 시세·차트 — 오늘 코스피 등락과 수급 | KOSPIMAP",
        "description": "코스피(KOSPI) 지수 현재가와 전일 대비 등락, 최근 거래일 종가, 52주 최고·최저, 외국인·기관 수급과 오늘 많이 오른·내린 종목을 한 페이지에서 확인하세요.",
        "currency": "pt",
        "faq": [
            ("코스피(KOSPI) 지수란 무엇인가요?",
             "코스피는 한국거래소 유가증권시장에 상장된 보통주 전체의 시가총액을 기준으로 계산하는 대표 주가지수입니다. 1980년 1월 4일의 시가총액을 100으로 두고 현재 시가총액을 비교해 산출합니다."),
            ("코스피 거래 시간은 언제인가요?",
             "정규장은 평일 오전 9시부터 오후 3시 30분(한국 시간)까지입니다. 오전 8시 30분~9시와 오후 3시 20분~3시 30분에는 동시호가로 가격이 정해집니다."),
            ("코스피 지수는 어떻게 움직이나요?",
             "시가총액 가중 방식이라 삼성전자·SK하이닉스처럼 시가총액이 큰 종목의 등락이 지수에 더 크게 반영됩니다. 이 페이지의 시장 분포와 상승·하락 종목 표에서 오늘 지수를 움직인 종목을 확인할 수 있습니다."),
            ("외국인·기관 순매수 금액은 무엇을 뜻하나요?",
             "해당 거래일에 외국인과 기관이 코스피 시장에서 산 금액에서 판 금액을 뺀 값(억원)입니다. 양수면 순매수, 음수면 순매도입니다."),
        ],
    },
    "kosdaq": {
        "path": "/kosdaq", "name": "코스닥", "en": "KOSDAQ", "history": "KQ11", "live": "KOSDAQ",
        "market": "kosdaq", "map": "/kosdaq-map", "map_label": "코스닥 시가총액 맵",
        "title": "코스닥 지수 시세·차트 — 오늘 코스닥 등락과 수급 | KOSPIMAP",
        "description": "코스닥(KOSDAQ) 지수 현재가와 전일 대비 등락, 최근 거래일 종가, 52주 최고·최저, 외국인·기관 수급과 오늘 많이 오른·내린 코스닥 종목을 한 페이지에서 확인하세요.",
        "currency": "pt",
        "faq": [
            ("코스닥(KOSDAQ) 지수란 무엇인가요?",
             "코스닥 지수는 한국거래소 코스닥시장 상장 종목의 시가총액을 기준으로 계산하는 지수입니다. 1996년 7월 1일을 기준으로 하며, 2004년부터 기준지수를 1000으로 조정해 발표하고 있습니다."),
            ("코스닥 거래 시간은 언제인가요?",
             "코스피와 같이 평일 오전 9시부터 오후 3시 30분(한국 시간)까지 정규장이 열립니다."),
            ("코스닥과 코스피는 어떻게 다른가요?",
             "코스피는 유가증권시장의 대형 우량주 중심, 코스닥은 기술·바이오·성장 기업 중심의 시장입니다. 그래서 코스닥은 같은 날에도 코스피보다 등락 폭이 큰 경우가 많습니다."),
            ("코스닥을 움직이는 종목은 어디서 보나요?",
             "이 페이지의 상승·하락 종목 표와 코스닥 시가총액 맵에서 업종별·종목별 등락을 확인할 수 있습니다."),
        ],
    },
    "nasdaq": {
        "path": "/nasdaq", "name": "나스닥", "en": "NASDAQ Composite", "history": "^IXIC", "live": "^IXIC",
        "partner": "^NDX", "partner_name": "나스닥 100",
        "market": "nasdaq100", "map": "/nasdaq100-map", "map_label": "나스닥 100 시가총액 맵",
        "title": "나스닥 지수 시세·차트 — 나스닥 종합·나스닥100 오늘 등락 | KOSPIMAP",
        "description": "나스닥 종합지수(NASDAQ Composite)와 나스닥 100 지수의 현재가, 전일 대비 등락, 최근 거래일 종가, 52주 최고·최저와 오늘 많이 오른·내린 나스닥 100 종목을 한국어로 확인하세요.",
        "currency": "pt",
        "faq": [
            ("나스닥 종합지수와 나스닥 100은 어떻게 다른가요?",
             "나스닥 종합지수는 나스닥 거래소에 상장된 거의 모든 종목을, 나스닥 100은 그중 금융업을 제외한 시가총액 상위 100여 개 기업을 담습니다. 뉴스에서 '나스닥'은 보통 종합지수를 가리킵니다."),
            ("나스닥 거래 시간은 한국 시간으로 언제인가요?",
             "미국 정규장은 현지 시간 오전 9시 30분~오후 4시로, 한국 시간으로는 밤 11시 30분~다음 날 오전 6시입니다. 미국 서머타임 기간에는 한 시간 빠른 밤 10시 30분~오전 5시입니다."),
            ("나스닥은 왜 한국 증시에 영향을 주나요?",
             "반도체·인터넷 등 기술주 비중이 높아, 엔비디아·마이크론 같은 미국 기술주의 움직임이 다음 날 삼성전자·SK하이닉스 등 국내 기술주 흐름과 자주 이어집니다."),
            ("나스닥 100 종목별 등락은 어디서 보나요?",
             "이 페이지의 상승·하락 종목 표와 나스닥 100 시가총액 맵에서 종목별 등락과 비중을 확인할 수 있습니다."),
        ],
    },
}
BY_PATH = {spec["path"]: key for key, spec in LANDINGS.items()}
PAGES = {spec["path"]: (spec["title"], spec["description"]) for spec in LANDINGS.values()}


def _num(value) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _live(spec: dict) -> dict | None:
    """Current level from the same live layers the site header uses."""
    if spec["history"] in ("KS11", "KQ11"):
        from app.data import index_fetcher
        value = index_fetcher.get_index(spec["live"])
        if not value or _num(value.get("close")) is None:
            return None
        return {"close": _num(value["close"]), "change": _num(value.get("change")), "change_pct": _num(value.get("change_pct")),
                "status": value.get("market_status"), "as_of": value.get("updated_at")}
    from app.data import yahoo_bulk_quote
    symbols = [spec["live"], spec["partner"]]
    quotes = cache.get_or_set("index_landing:us_quotes", 30, lambda: yahoo_bulk_quote.get_quotes(symbols), allow_stale=True)
    out = {}
    for symbol in symbols:
        q = (quotes or {}).get(symbol) or {}
        if _num(q.get("close")) is None:
            continue
        stamp = q.get("quote_time")
        out[symbol] = {"close": _num(q["close"]), "change": _num(q.get("change")), "change_pct": _num(q.get("change_pct")),
                       "status": q.get("session"),
                       "as_of": dt.datetime.fromtimestamp(stamp, KST).isoformat(timespec="minutes") if isinstance(stamp, (int, float)) else None}
    head = out.get(spec["live"])
    if head is not None:
        head["partner"] = out.get(spec["partner"])
    return head


def _history(spec: dict) -> list[dict]:
    from app.data.price_fetcher import get_history
    frame = get_history(spec["history"], 1)
    rows = []
    for record in frame.tail(260).to_dict("records"):
        close = _num(record.get("close"))
        if close is None or close <= 0:
            continue
        rows.append({"date": str(record.get("date"))[:10], "open": _num(record.get("open")), "high": _num(record.get("high")),
                     "low": _num(record.get("low")), "close": close})
    return rows


def _ret(rows: list[dict], days: int) -> float | None:
    if len(rows) <= days:
        return None
    base = rows[-1 - days]["close"]
    return (rows[-1]["close"] / base - 1) * 100 if base else None


def _build(key: str) -> dict:
    spec = LANDINGS[key]
    live = None
    try:
        live = _live(spec)
    except Exception:
        live = None
    try:
        rows = _history(spec)
    except Exception:
        rows = []
    # The daily feed's last bar can be an intraday print; the live layer's close is
    # the one the header shows, so the latest row follows it on the same date.
    if live and rows:
        today = (live.get("as_of") or "")[:10]
        if today == rows[-1]["date"]:
            rows[-1]["close"] = live["close"]
        elif today and today > rows[-1]["date"] and spec["history"] in ("KS11", "KQ11"):
            rows.append({"date": today, "open": None, "high": None, "low": None, "close": live["close"]})
    if not live and rows:
        prev = rows[-2]["close"] if len(rows) > 1 else None
        live = {"close": rows[-1]["close"], "change": rows[-1]["close"] - prev if prev else None,
                "change_pct": (rows[-1]["close"] / prev - 1) * 100 if prev else None, "status": None, "as_of": rows[-1]["date"]}
    year = rows[-250:]
    ytd_base = next((row["close"] for row in reversed(rows) if row["date"] < f"{dt.date.today().year}-01-01"), None)
    stats = {
        "high_52w": max((row["high"] or row["close"] for row in year), default=None),
        "low_52w": min((row["low"] or row["close"] for row in year), default=None),
        "return_1w": _ret(rows, 5), "return_1m": _ret(rows, 21), "return_3m": _ret(rows, 63),
        "return_ytd": (rows[-1]["close"] / ytd_base - 1) * 100 if rows and ytd_base else None,
        "ma20": sum(row["close"] for row in rows[-20:]) / 20 if len(rows) >= 20 else None,
        "ma60": sum(row["close"] for row in rows[-60:]) / 60 if len(rows) >= 60 else None,
    }
    investor = None
    if spec["history"] in ("KS11", "KQ11"):
        try:
            from app.data import index_fetcher
            investor = index_fetcher.get_market_investor_summary(spec["live"])
        except Exception:
            investor = None
    breadth = None
    try:
        from app.services import public_markets
        snap = public_markets.snapshot(spec["market"])
        pick = lambda items: [{"code": r["code"], "name": r["name"], "close": r["close"], "change_pct": r["change_pct"], "sector": r["sector"]} for r in items]
        breadth = {"count": snap["count"], "up": snap["up"], "down": snap["down"], "flat": snap["flat"],
                   "gainers": pick(snap["gainers"]), "losers": pick(snap["losers"]), "largest": pick(snap["largest"][:10]),
                   "sectors": snap["sectors"], "collected_at": snap["collected_at"], "currency": snap["currency"]}
    except Exception:
        breadth = None
    return {
        "key": key, "path": spec["path"], "name": spec["name"], "en": spec["en"], "title": spec["title"],
        "description": spec["description"], "map": spec["map"], "map_label": spec["map_label"],
        "partner_name": spec.get("partner_name"), "live": live, "stats": stats,
        "history": rows[-30:], "chart": [{"date": row["date"], "close": row["close"]} for row in rows[-120:]],
        "investor": investor, "breadth": breadth, "faq": [{"q": q, "a": a} for q, a in spec["faq"]],
        "generated_at": dt.datetime.now(KST).isoformat(timespec="seconds"),
    }


def payload(key: str) -> dict:
    if key not in LANDINGS:
        raise KeyError(key)
    return cache.get_or_set(f"index_landing:v1:{key}", 60, lambda: _build(key), allow_stale=True)


# ── server-rendered HTML ──────────────────────────────────────────────────────

def _fmt(value, digits: int = 2) -> str:
    return "—" if value is None else f"{value:,.{digits}f}"


def _pct(value) -> str:
    return "—" if value is None else f"{value:+.2f}%"


def _signed(value, digits: int = 2) -> str:
    return "—" if value is None else f"{value:+,.{digits}f}"


def headline(data: dict) -> str:
    live = data.get("live") or {}
    if live.get("close") is None:
        return ""
    return f"{data['name']} {_fmt(live['close'])} ({_pct(live.get('change_pct'))})"


def render_content(path: str) -> str:
    key = BY_PATH.get(path)
    if not key:
        return ""
    try:
        data = payload(key)
    except Exception:
        return '<p>지수 데이터를 준비 중입니다.</p>'
    esc = html.escape
    live, stats = data.get("live") or {}, data["stats"]
    parts = []
    if live.get("close") is not None:
        parts.append(f'<section><h2>{esc(data["name"])} 지수 현재가</h2><p><strong>{_fmt(live["close"])}</strong> '
                     f'전일 대비 {_signed(live.get("change"))} ({_pct(live.get("change_pct"))}). 기준 {esc(str(live.get("as_of") or ""))}.</p>')
        partner = live.get("partner")
        if partner and partner.get("close") is not None:
            parts.append(f'<p>{esc(data["partner_name"] or "")} {_fmt(partner["close"])} ({_pct(partner.get("change_pct"))})</p>')
        parts.append('</section>')
    parts.append('<section><h2>기간 수익률과 52주 범위</h2><ul>'
                 f'<li>1주 {_pct(stats["return_1w"])}, 1개월 {_pct(stats["return_1m"])}, 3개월 {_pct(stats["return_3m"])}, 연초 대비 {_pct(stats["return_ytd"])}</li>'
                 f'<li>52주 최고 {_fmt(stats["high_52w"])}, 52주 최저 {_fmt(stats["low_52w"])}</li>'
                 f'<li>20일 이동평균 {_fmt(stats["ma20"])}, 60일 이동평균 {_fmt(stats["ma60"])}</li></ul></section>')
    inv = data.get("investor")
    if inv:
        parts.append('<section><h2>투자자별 순매수 (억원)</h2><p>'
                     f'개인 {_signed(_num(inv.get("individual_amount")), 0)}, 외국인 {_signed(_num(inv.get("foreign_amount")), 0)}, '
                     f'기관 {_signed(_num(inv.get("institution_amount")), 0)}</p></section>')
    if data["history"]:
        rows = "".join(f'<tr><th scope="row">{esc(r["date"])}</th><td>{_fmt(r["close"])}</td></tr>' for r in reversed(data["history"][-20:]))
        parts.append(f'<section><h2>{esc(data["name"])} 최근 거래일 종가</h2><table><thead><tr><th>날짜</th><th>종가</th></tr></thead><tbody>{rows}</tbody></table></section>')
    b = data.get("breadth")
    if b:
        def table(caption, items):
            body = "".join(f'<tr><th scope="row"><a href="/stock/{esc(i["code"])}">{esc(i["name"])}</a></th><td>{_fmt(i["close"])} {esc(b["currency"])}</td><td>{_pct(i["change_pct"])}</td></tr>' for i in items)
            return f'<table><caption>{caption}</caption><tbody>{body}</tbody></table>'
        parts.append(f'<section><h2>오늘 {esc(data["name"])} 상승·하락 종목</h2><p>시가총액 상위 {b["count"]}종목 중 상승 {b["up"]}, 하락 {b["down"]}, 보합 {b["flat"]}.</p>'
                     + table("많이 오른 종목", b["gainers"]) + table("많이 내린 종목", b["losers"]) + table("시가총액 상위", b["largest"]) + '</section>')
    parts.append('<section><h2>자주 묻는 질문</h2>' + "".join(f'<h3>{esc(f["q"])}</h3><p>{esc(f["a"])}</p>' for f in data["faq"]) + '</section>')
    others = [(spec["path"], f'{spec["name"]} 지수') for k, spec in LANDINGS.items() if k != key]
    links = [(data["map"], data["map_label"]), *others, ("/today", "오늘 증시 한눈에"), ("/market-brief", "오늘 브리핑")]
    parts.append('<p>' + " · ".join(f'<a href="{h}">{esc(label)}</a>' for h, label in links) + '</p>')
    return "".join(parts)


def structured_data(path: str, site: str) -> dict | None:
    key = BY_PATH.get(path)
    if not key:
        return None
    spec = LANDINGS[key]
    url = f"{site}{spec['path']}"
    return {
        "@context": "https://schema.org",
        "@graph": [
            {"@type": "WebPage", "name": spec["title"], "description": spec["description"], "url": url, "inLanguage": "ko-KR",
             "isPartOf": {"@type": "WebSite", "name": "KOSPIMAP", "url": site},
             "about": {"@type": "Thing", "name": f"{spec['name']} 지수", "alternateName": spec["en"]}},
            {"@type": "BreadcrumbList", "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "KOSPIMAP", "item": site},
                {"@type": "ListItem", "position": 2, "name": f"{spec['name']} 지수", "item": url}]},
            {"@type": "FAQPage", "mainEntity": [
                {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in spec["faq"]]},
        ],
    }
