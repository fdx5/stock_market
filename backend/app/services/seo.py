"""Route-aware SEO shell for the React SPA.

Search crawlers receive the same application, but not the same metadata.  Rendering
these tags on the server avoids making indexing depend on a second JavaScript pass and
prevents every stock URL from canonicalising to the generic desk page.
"""

from __future__ import annotations

import html
import json
import re
from urllib.parse import urlencode
from datetime import date, datetime, timezone

from app.data import investor_fetcher
from app.data.universe import get_stock_name, get_top_market_cap_all
from app.services import market_brief_store
from app.services.cache import cache

from app.site import PRIMARY_SITE_URL

SITE = PRIMARY_SITE_URL
IMAGE = f"{SITE}/img/kospi-map-preview.png"
MARKET_BRIEF_ROUTE = re.compile(r"^/market-brief/(\d{4}-\d{2}-\d{2})/(kospi|kosdaq|samsung|hynix|hyundai|sksquare|semco|\d{6})$", re.I)
STOCK_ROUTE = re.compile(r"^/stock/(\d{6})$", re.I)
STOCK_LANDING_ROUTE = re.compile(r"^/stock/(\d{6})/(investor|outlook|news)$", re.I)
INVESTOR_ROUTE = re.compile(r"^/investor/(\d{6})$", re.I)


def _market_brief(path: str) -> tuple[dict | None, str, str]:
    match = MARKET_BRIEF_ROUTE.fullmatch(path)
    if not match:
        return None, "", ""
    day, market_slug = match.groups()
    try:
        datetime.strptime(day, "%Y-%m-%d")
        from app.services.market_brief import normalize_target
        target = normalize_target(market_slug)
        report = market_brief_store.get(day, target)
    except Exception:
        report = None
    return report, day, market_slug.lower()


def _brief_description(report: dict, day: str, market: str) -> str:
    summary = " ".join(str(report.get("summary") or "").split())
    if summary:
        return summary[:157] + ("…" if len(summary) > 157 else "")
    return f"{day} {market.upper()} 종가, 등락률, 투자자 수급과 업종 흐름을 정리한 데이터 기반 오늘 브리핑입니다."


def _stock_identity(path: str) -> tuple[str, str]:
    match = STOCK_ROUTE.fullmatch(path)
    if not match:
        return "", ""
    code = match.group(1)
    try:
        name = get_stock_name(code) or code
    except Exception:
        name = code
    return code, name


def _investor_identity(path: str) -> tuple[str, str]:
    match = INVESTOR_ROUTE.fullmatch(path)
    if not match:
        return "", ""
    code = match.group(1)
    try:
        name = get_stock_name(code) or code
    except Exception:
        name = code
    return code, name


# The whole KOSPI+KOSDAQ board, market-cap ordered. `get_top_market_cap_all` is itself
# cached for a day, so calling it per request costs a dict lookup, not a KRX fetch.
UNIVERSE_LIMIT = 10_000
INVESTOR_HUB = "/market/kospi/foreign-buying"


def kr_universe() -> list[dict]:
    try:
        return get_top_market_cap_all(UNIVERSE_LIMIT)
    except Exception:
        return []


def _investor_neighbours(code: str) -> list[tuple[str, str]]:
    """Market-cap adjacent names, so every /investor page links to other /investor
    pages instead of being a crawl dead end reachable only from the sitemap."""

    def build() -> dict:
        rows = [
            (str(item.get("code", "")), str(item.get("name", "")))
            for item in kr_universe()
            if re.fullmatch(r"\d{6}", str(item.get("code", "")).strip().upper() or "")
        ]
        if not rows:
            # Raising leaves nothing in the cache, so a KRX snapshot that is briefly
            # unavailable does not pin an empty table here for the next six hours.
            raise RuntimeError("KR universe unavailable")
        return {"rows": rows, "index": {row[0]: position for position, row in enumerate(rows)}}

    try:
        table = cache.get_or_set("seo_investor_neighbours", 6 * 3600, build)
        rows: list[tuple[str, str]] = table["rows"]
        position = table["index"].get(code)
    except Exception:
        return []
    if position is None:
        return []
    start = max(0, position - 4)
    return [row for row in rows[start:position + 5] if row[0] != code][:8]


def _investor_digest(records: list[dict]) -> dict:
    """Turn the raw rows into the handful of numbers that make each of the ~2,700
    investor pages read differently from every other one."""
    if not records:
        return {}
    latest = records[0]
    oldest = records[-1]
    close = float(latest.get("close") or 0)
    change = float(latest.get("change") or 0)
    previous = close - change
    totals = {
        key: round(sum(float(row.get(key) or 0) for row in records), 1)
        for key in ("individual_amount", "institution_amount", "foreign_amount")
    }
    first_close = float(oldest.get("close") or 0)
    streak = 0
    lead = float(records[0].get("foreign_amount") or 0)
    for row in records:
        value = float(row.get("foreign_amount") or 0)
        if value == 0 or (value > 0) != (lead > 0):
            break
        streak += 1
    return {
        "days": len(records),
        "date": str(latest.get("date") or ""),
        "close": close,
        "change": change,
        "change_pct": (change / previous * 100) if previous else 0.0,
        "period_pct": ((close - first_close) / first_close * 100) if first_close else 0.0,
        "first_date": str(oldest.get("date") or ""),
        "streak": streak,
        "streak_side": "순매수" if lead > 0 else "순매도",
        **totals,
    }


def _amount(value: float) -> str:
    return f"{value:+,.1f}억원"


def is_unknown_kr_code(path: str) -> bool:
    """True for a six-digit code that is not listed on KOSPI or KOSDAQ.

    These answered 200 with a populated-looking shell, so Google logged every
    delisted or mistyped code — and every code it had ever crawled — as a real
    page and then filed it under soft 404. Answering 404 keeps those out of the
    index and stops them consuming the crawl budget the live pages need.

    Deliberately conservative: if the KRX universe failed to load we return False
    rather than 404 the entire KR side of the site.
    """
    match = (
        INVESTOR_ROUTE.fullmatch(path)
        or STOCK_ROUTE.fullmatch(path)
        or STOCK_LANDING_ROUTE.fullmatch(path)
    )
    if not match:
        return False

    def build() -> set[str]:
        codes = {str(item.get("code", "")).strip().upper() for item in kr_universe()}
        if not codes:
            raise RuntimeError("KR universe unavailable")
        return codes

    try:
        # Cached, so the six-digit check costs a set lookup rather than a re-sort of
        # the whole KRX board on every stock and investor page view.
        known = cache.get_or_set("seo_known_kr_codes", 6 * 3600, build)
    except Exception:
        return False
    return bool(known) and match.group(1) not in known


def _investor_faq(name: str, code: str, digest: dict) -> list[tuple[str, str]]:
    if not digest:
        return [
            (
                f"{name}({code}) 투자자별 매매동향은 어디서 확인하나요?",
                f"이 페이지에서 {name}의 날짜별 개인·기관·외국인 순매수 금액과 종가를 확인할 수 있습니다. "
                "거래일 종료 후 집계되며, 휴장일과 신규 상장 직후에는 데이터가 비어 있을 수 있습니다.",
            )
        ]
    foreign = digest["foreign_amount"]
    institution = digest["institution_amount"]
    return [
        (
            f"{name} 외국인 순매수는 최근 얼마인가요?",
            f"최근 {digest['days']}거래일({digest['first_date']}~{digest['date']}) 동안 외국인은 "
            f"{_amount(foreign)}을 순{'매수' if foreign > 0 else '매도'}했습니다. "
            f"같은 기간 기관은 {_amount(institution)}, 개인은 {_amount(digest['individual_amount'])}입니다.",
        ),
        (
            f"{name} 최근 종가와 등락률은 얼마인가요?",
            f"{digest['date']} 종가는 {digest['close']:,.0f}원으로 전 거래일 대비 "
            f"{digest['change']:+,.0f}원({digest['change_pct']:+.2f}%) 변동했으며, "
            f"{digest['days']}거래일 기준 누적 등락률은 {digest['period_pct']:+.2f}%입니다.",
        ),
        (
            f"{name} 수급 데이터는 얼마나 자주 갱신되나요?",
            "거래일마다 장 종료 후 집계된 확정 수치로 갱신됩니다. 무료 공개 데이터 특성상 "
            "하루 단위 집계이며, 장중 시간대별 실시간 수급은 제공되지 않습니다. "
            "순매수 금액은 투자자별 순매수 수량에 당일 종가를 곱해 산출한 근사치입니다.",
        ),
    ]

PAGES: dict[str, tuple[str, str]] = {
    "/sector/semiconductor": ("반도체 관련주·등락률 | K-Stock Hub", "코스피·코스닥 반도체 관련주의 현재가, 등락률과 거래대금을 비교합니다."),
    "/ranking/trading-value": ("오늘 거래대금 순위 | K-Stock Hub", "코스피·코스닥 종목을 오늘 거래대금 기준으로 비교합니다."),
    "/market/kospi/foreign-buying": ("종목별 외국인·기관 수급 전체보기 | K-Stock Hub", "코스피·코스닥 상장 종목의 외국인·기관·개인 순매수 금액을 비교하고 종목별 투자자 매매동향 페이지로 이동하세요."),
    "/ranking/us-etf": ("미국 ETF 거래대금 순위 | K-Stock Hub", "미국 주요 ETF의 현재가, 거래대금과 기간 수익률 순위입니다."),
    "/ranking/sp500-market-cap": ("S&P500 시가총액 순위 | K-Stock Hub", "S&P500 주요 기업을 시가총액 기준으로 비교합니다."),
    "/etf/compare/069500/102110": ("KODEX 200·TIGER 200 비교 | K-Stock Hub", "대표 코스피200 ETF의 가격, 거래대금과 기간 수익률을 나란히 비교합니다."),
    "/hub": ("K-Stock Hub 태양계 시장 탐험", "K-Stock Hub의 태양계 인터페이스에서 국내외 주식 시장과 주요 서비스를 탐험하세요."),
    "/": ("K-Stock Hub | 코스피·코스닥·미국 주식 시세와 ETF", "코스피·코스닥·미국 증시 시세, 시가총액 맵, 거래대금 순위, ETF와 종목토론을 한곳에서 확인하세요."),
    "/desk": ("국내 주식 시세와 오늘의 시장 현황 | K-Stock Hub", "코스피·코스닥 지수, 국내 주식 현재가, 거래대금, 외국인·기관 수급과 오늘의 주목 종목을 확인하세요."),
    "/stocks": ("종목정보 | 코스피·코스닥·S&P500 종목 시세와 토론 | K-Stock Hub", "코스피·코스닥·S&P 500 종목을 시가총액순으로 보고, 종목별 시세와 차트, 종목토론과 최신 뉴스를 한 화면에서 확인하세요."),
    "/map": ("코스피 시가총액 맵과 주식 히트맵 | K-Stock Hub", "코스피 주요 종목의 시가총액 비중과 등락률을 업종별 주식 히트맵으로 비교하세요."),
    "/kosdaq-map": ("코스닥 시가총액 맵과 주식 히트맵 | K-Stock Hub", "코스닥 주요 종목의 시가총액 비중과 등락률을 업종별로 확인하세요."),
    "/sp500-map": ("S&P 500 시가총액 맵과 미국 주식 히트맵 | K-Stock Hub", "S&P 500 종목의 시가총액 비중과 등락률을 한눈에 비교하는 미국 주식 히트맵입니다."),
    "/nasdaq100-map": ("나스닥 100 시가총액 맵 | K-Stock Hub", "나스닥 100 기술주의 시가총액 비중과 등락률을 실시간 주식 히트맵으로 확인하세요."),
    "/etf": ("국내·미국 ETF 순위와 거래대금 | K-Stock Hub", "국내 ETF와 미국 ETF의 현재가, 등락률, 수익률과 거래대금 순위를 검색하고 비교하세요."),
    "/kospi-100": ("코스피 시가총액·거래대금 순위 TOP 100 | K-Stock Hub", "코스피 종목의 시가총액, 거래대금, 등락률과 기간 수익률 순위를 비교하세요."),
    "/kosdaq-100": ("코스닥 시가총액·거래대금 순위 TOP 100 | K-Stock Hub", "코스닥 종목의 시가총액, 거래대금과 상승·하락률 순위를 확인하세요."),
    "/nasdaq-100": ("나스닥 종목 시세와 순위 TOP 100 | K-Stock Hub", "나스닥 주요 종목의 주가, 시가총액, 거래량과 기간별 수익률을 비교하세요."),
    "/global-top100": ("세계 기업 시가총액 순위 TOP 100 | K-Stock Hub", "전 세계 기업 시가총액 순위와 국가·업종별 주요 기업 정보를 확인하세요."),
    "/global": ("미국 주식 시세와 종목 분석 | K-Stock Hub", "미국 주식 현재가, 등락률, 차트, 뉴스와 종목토론을 한 화면에서 확인하세요."),
    "/discussion-explorer": ("주식·ETF 종목토론 | K-Stock Hub", "국내외 주식과 ETF의 최근 게시글과 댓글을 3D 공간에서 탐색하세요."),
    "/news": ("오늘의 국내외 증시 뉴스 | K-Stock Hub", "국내 증시와 미국 증시에 영향을 주는 주요 경제·기업 뉴스를 확인하세요."),
    "/market-brief": ("오늘 브리핑 | K-Stock Hub", "오늘 코스피·코스닥 종가, 외국인·기관 수급, 거래대금, 상승 종목 비중과 업종 흐름을 분석한 데이터 기반 오늘 브리핑입니다."),
    "/dram-price": ("D램 현물가격과 메모리 반도체 가격 추이 | K-Stock Hub", "D램 현물가격과 메모리 반도체 가격 변화를 기간별 차트로 확인하세요."),
    "/ai-prediction": ("AI 주가 예측과 종목 분석 | K-Stock Hub", "국내외 주식의 AI 예측 결과와 기술적 지표, 과거 예측 채점 결과를 확인하세요."),
    "/fight": ("기업 시가총액 비교 | K-Stock Hub", "국내외 주요 기업의 시가총액과 기업 정보를 직관적으로 비교하세요."),
    "/index/kospi": ("코스피 지수 차트와 기술적 지표 | K-Stock Hub", "코스피 지수의 기간별 차트와 이동평균, RSI 등 보조지표를 확인하세요."),
    "/index/kosdaq": ("코스닥 지수 차트와 기술적 지표 | K-Stock Hub", "코스닥 지수의 기간별 차트와 이동평균, RSI 등 보조지표를 확인하세요."),
}


def _replace_meta(document: str, selector: str, value: str) -> str:
    escaped = html.escape(value, quote=True)
    pattern = rf'(<meta\s+{selector}\s+content=")[^"]*("\s*/?>)'
    return re.sub(pattern, rf"\g<1>{escaped}\g<2>", document, count=1)


def render_spa_shell(template: str, path: str, query: dict[str, str]) -> str:
    canonical_path = "/hub" if path == "/type2" else path.rstrip("/") or "/"
    brief, brief_day, brief_market = _market_brief(canonical_path)
    stock_code, stock_name = _stock_identity(canonical_path)
    stock_landing = STOCK_LANDING_ROUTE.fullmatch(canonical_path)
    stock_landing_kind = ""
    if stock_landing:
        stock_code = stock_landing.group(1)
        stock_landing_kind = stock_landing.group(2).lower()
        _, stock_name = _stock_identity(f"/stock/{stock_code}")
    investor_code, investor_name = _investor_identity(canonical_path)
    page_lookup = "/market-brief" if brief_day else canonical_path
    title, description = PAGES.get(page_lookup, PAGES["/"])
    page_image = IMAGE
    if brief:
        title = f"{brief_day} {brief_market.upper()} 오늘 브리핑 | K-Stock Hub"
        description = _brief_description(brief, brief_day, brief_market)
        page_image = f"{SITE}/market-brief/og/{brief_day}/{brief_market}.png"
    elif stock_code:
        if stock_landing_kind == "investor":
            title = f"{stock_name} 외국인·기관 수급 | K-Stock Hub"
            description = f"{stock_name}({stock_code})의 날짜별 외국인·기관·개인 순매수와 주가 흐름을 확인하세요."
        elif stock_landing_kind == "outlook":
            title = f"{stock_name} 주가 전망·기술적 분석 | K-Stock Hub"
            description = f"{stock_name}({stock_code})의 RSI, MACD, 이동평균과 데이터 기반 다음 거래일 전망을 확인하세요."
        elif stock_landing_kind == "news":
            title = f"{stock_name} 관련 뉴스·주가 | K-Stock Hub"
            description = f"{stock_name}({stock_code}) 주가와 최신 관련 뉴스를 날짜순으로 확인하세요."
        else:
            title = f"{stock_name} 주가·차트·외국인 기관 수급 | K-Stock Hub"
            description = f"{stock_name}({stock_code}) 주가, 등락률, 거래량, 차트, 기술적 지표, 외국인·기관 수급과 최신 뉴스를 한 페이지에서 확인하세요."

    code = re.sub(r"[^A-Za-z0-9.-]", "", query.get("code", ""))[:16]
    supplied_name = re.sub(r"[<>\r\n]", "", query.get("name", "")).strip()[:80]
    display_name = supplied_name or code
    canonical_query: dict[str, str] = {}
    if code and canonical_path in {"/desk", "/global", "/discussion-explorer"}:
        canonical_query["code"] = code
        if display_name:
            canonical_query["name"] = display_name
            market_word = "미국 주식" if canonical_path == "/global" else "주식"
            title = f"{display_name} {market_word} 시세·차트·수급 | K-Stock Hub"
            description = f"{display_name}({code})의 현재가, 등락률, 차트, 투자자 수급과 최신 종목 정보를 확인하세요."
        if canonical_path == "/desk" and re.fullmatch(r"\d{6}", code):
            canonical_path = f"/stock/{code}"
            canonical_query = {}
    investor_records: list[dict] = []
    investor_digest: dict = {}
    if investor_code:
        try:
            investor_records = investor_fetcher.get_investor_trend(investor_code, 30)
        except Exception:
            investor_records = []
        investor_digest = _investor_digest(investor_records)
        title = f"{investor_name} 외국인·기관 매매동향 ({investor_code}) | K-Stock Hub"
        if investor_digest:
            # Every one of these pages used to ship the same sentence with a different
            # name substituted in — ~2,700 descriptions Google could only read as one
            # template. Quoting the page's actual numbers makes each one unique and
            # gives the snippet something worth clicking.
            description = (
                f"{investor_name}({investor_code}) 최근 {investor_digest['days']}거래일 외국인 "
                f"{investor_digest['foreign_amount']:+,.0f}억, 기관 {investor_digest['institution_amount']:+,.0f}억, "
                f"개인 {investor_digest['individual_amount']:+,.0f}억. "
                f"{investor_digest['date']} 종가 {investor_digest['close']:,.0f}원"
                f"({investor_digest['change_pct']:+.2f}%). 날짜별 투자자 순매수 추이."
            )
        else:
            description = (
                f"{investor_name}({investor_code})의 날짜별 개인·기관·외국인 순매수 금액(억원)과 "
                "종가 추이를 확인하세요."
            )

    canonical = f"{SITE}{canonical_path}"
    if canonical_query:
        canonical += "?" + urlencode(canonical_query)

    document = re.sub(r"<title>.*?</title>", f"<title>{html.escape(title)}</title>", template, count=1, flags=re.S)
    document = _replace_meta(document, 'name="description"', description)
    if page_lookup == "/market-brief":
        document = _replace_meta(
            document,
            'name="keywords"',
            "오늘 증시 마감, 코스피 장 마감, 코스닥 장 마감, 국내 증시 분석, 외국인 기관 수급, 주식 시황, 오늘 브리핑",
        )
    document = _replace_meta(document, 'property="og:title"', title)
    document = _replace_meta(document, 'property="og:description"', description)
    document = _replace_meta(document, 'property="og:url"', canonical)
    document = _replace_meta(document, 'property="og:type"', "article" if brief else "website")
    document = _replace_meta(document, 'property="og:image"', page_image)
    document = _replace_meta(document, 'property="og:image:secure_url"', page_image)
    document = _replace_meta(document, 'property="og:image:alt"', f"{brief_day} {brief_market.upper()} 오늘 브리핑 핵심 지표" if brief else "K-Stock Hub 시장 데이터")
    document = _replace_meta(document, 'name="twitter:title"', title)
    document = _replace_meta(document, 'name="twitter:description"', description)
    document = _replace_meta(document, 'name="twitter:image"', page_image)
    document = _replace_meta(document, 'name="twitter:image:alt"', f"{brief_day} {brief_market.upper()} 오늘 브리핑 핵심 지표" if brief else "K-Stock Hub 시장 데이터")
    document = re.sub(
        r'(<link\s+rel="canonical"\s+href=")[^"]*("\s*/?>)',
        rf"\g<1>{html.escape(canonical, quote=True)}\g<2>",
        document,
        count=1,
    )

    structured: dict = {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "name": title,
        "description": description,
        "url": canonical,
        "image": page_image,
        "isPartOf": {"@type": "WebSite", "name": "K-Stock Hub", "url": SITE},
        "inLanguage": "ko-KR",
    }
    if brief:
        published = str(brief.get("created_at") or f"{brief_day}T16:00:00+09:00")
        structured = {
            "@context": "https://schema.org",
            "@type": "Article",
            "headline": title.removesuffix(" | K-Stock Hub"),
            "description": description,
            "image": [page_image],
            "datePublished": published,
            "dateModified": published,
            "mainEntityOfPage": {"@type": "WebPage", "@id": canonical},
            "author": {"@type": "Organization", "name": "K-Stock Hub", "url": SITE},
            "publisher": {"@type": "Organization", "name": "K-Stock Hub", "url": SITE},
            "inLanguage": "ko-KR",
        }
    elif stock_code:
        structured = {
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": "WebPage",
                    "name": title,
                    "description": description,
                    "url": canonical,
                    "isPartOf": {"@type": "WebSite", "name": "K-Stock Hub", "url": SITE},
                    "about": {"@type": "Corporation", "name": stock_name, "identifier": stock_code},
                    "inLanguage": "ko-KR",
                },
                {
                    "@type": "BreadcrumbList",
                    "itemListElement": [
                        {"@type": "ListItem", "position": 1, "name": "K-Stock Hub", "item": SITE},
                        {"@type": "ListItem", "position": 2, "name": "국내 주식", "item": f"{SITE}/desk"},
                        {"@type": "ListItem", "position": 3, "name": stock_name, "item": canonical},
                    ],
                },
            ],
        }
    elif investor_code:
        structured = {
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": "WebPage",
                    "name": title,
                    "description": description,
                    "url": canonical,
                    "isPartOf": {"@type": "WebSite", "name": "K-Stock Hub", "url": SITE},
                    "about": {"@type": "Corporation", "name": investor_name, "identifier": investor_code},
                    "inLanguage": "ko-KR",
                },
                {
                    "@type": "BreadcrumbList",
                    "itemListElement": [
                        {"@type": "ListItem", "position": 1, "name": "K-Stock Hub", "item": SITE},
                        {"@type": "ListItem", "position": 2, "name": "국내 주식", "item": f"{SITE}/desk"},
                        {"@type": "ListItem", "position": 3, "name": "외국인·기관 수급", "item": f"{SITE}{INVESTOR_HUB}"},
                        {"@type": "ListItem", "position": 4, "name": investor_name, "item": canonical},
                    ],
                },
                {
                    "@type": "Dataset",
                    "name": f"{investor_name}({investor_code}) 투자자별 순매수 추이",
                    "description": description,
                    "url": canonical,
                    "creator": {"@type": "Organization", "name": "K-Stock Hub", "url": SITE},
                    "temporalCoverage": (
                        f"{investor_digest['first_date']}/{investor_digest['date']}"
                        if investor_digest
                        else ""
                    ),
                    "variableMeasured": ["종가", "개인 순매수", "기관 순매수", "외국인 순매수"],
                    "isAccessibleForFree": True,
                    "inLanguage": "ko-KR",
                },
                {
                    "@type": "FAQPage",
                    "mainEntity": [
                        {
                            "@type": "Question",
                            "name": question,
                            "acceptedAnswer": {"@type": "Answer", "text": answer},
                        }
                        for question, answer in _investor_faq(investor_name, investor_code, investor_digest)
                    ],
                },
            ],
        }
    script = '<script type="application/ld+json">' + json.dumps(structured, ensure_ascii=False).replace("</", "<\\/") + "</script>"
    document = document.replace("</head>", f"{script}\n  </head>", 1)

    # Naver's Yeti can render JavaScript, but its official SPA guidance still
    # recommends server-rendering the important content. React replaces this
    # lightweight shell as soon as it mounts; crawlers and slow connections get
    # a meaningful heading, summary, and crawlable internal links immediately.
    links = [
        ("/desk", "국내 주식 시세"), ("/map", "코스피 시가총액 맵"),
        ("/kosdaq-map", "코스닥 시가총액 맵"), ("/etf", "국내·해외 ETF"),
        ("/sp500-map", "S&P 500 맵"), ("/nasdaq100-map", "나스닥 100 맵"),
        ("/news", "증시 뉴스"), ("/market-brief", "오늘 브리핑"),
        ("/discussion-explorer", "종목토론"),
        (INVESTOR_HUB, "외국인·기관 수급 종목"),
        ("/stock/005930", "삼성전자 주가"), ("/stock/000660", "SK하이닉스 주가"),
        ("/stock/373220", "LG에너지솔루션 주가"), ("/stock/207940", "삼성바이오로직스 주가"),
        ("/stock/005380", "현대차 주가"), ("/stock/035420", "NAVER 주가"),
    ]
    nav = "".join(f'<a href="{href}">{html.escape(label)}</a>' for href, label in links)
    report_content = ""
    if brief:
        analysis = brief.get("analysis") or []
        points = "".join(f"<li>{html.escape(str(point))}</li>" for point in analysis[:6])
        report_content = f'<ul style="max-width:760px;line-height:1.8">{points}</ul>'
        try:
            archive = market_brief_store.dates(24)
        except Exception:
            archive = []
        archive_links = "".join(
            f'<a href="/market-brief/{item["date"]}/{str(item["market"]).lower()}">'
            f'{html.escape(str(item["date"]))} {html.escape(str(item["market"]))}</a>'
            for item in archive
            if item.get("date") and item.get("market") in {"KOSPI", "KOSDAQ"}
        )
        report_content += f'<nav aria-label="최근 오늘 브리핑" style="display:flex;flex-wrap:wrap;gap:12px">{archive_links}</nav>'
    elif stock_code:
        # /stock/<code>, /outlook and /news used to emit byte-identical bodies, so the
        # only thing separating them was a <title> the client then overwrote with the
        # generic desk copy. Each landing page states what is actually on it.
        intro = {
            "outlook": (
                f'<p>{html.escape(stock_name)}({stock_code})의 RSI(14), MACD, 이동평균선 배열과 '
                '거래량 추이를 바탕으로 한 다음 거래일 전망 지표입니다. 투자 판단의 참고 자료이며 '
                '매매 권유가 아닙니다.</p>'
            ),
            "news": (
                f'<p>{html.escape(stock_name)}({stock_code}) 관련 최신 뉴스를 날짜순으로 모았습니다. '
                '기사 제목과 함께 당일 주가·등락률을 나란히 확인할 수 있습니다.</p>'
            ),
        }.get(
            stock_landing_kind,
            f'<p>{html.escape(stock_name)}({stock_code}) 현재가와 기간별 차트, 거래량, 기술적 지표, '
            '외국인·기관 매매동향 및 관련 뉴스를 제공합니다.</p>',
        )
        siblings = "".join(
            f'<a href="{href}">{html.escape(label)}</a>'
            for href, label in (
                (f"/stock/{stock_code}", f"{stock_name} 주가·차트"),
                (f"/investor/{stock_code}", f"{stock_name} 외국인·기관 수급"),
                (f"/stock/{stock_code}/outlook", f"{stock_name} 주가 전망"),
                (f"/stock/{stock_code}/news", f"{stock_name} 관련 뉴스"),
            )
            if href != canonical_path
        )
        report_content = (
            f'{intro}'
            '<nav aria-label="종목 관련 분석" style="display:flex;flex-wrap:wrap;gap:12px">'
            f'{siblings}'
            f'<a href="/discussion-explorer?code={stock_code}&amp;name={html.escape(stock_name, quote=True)}">{html.escape(stock_name)} 종목토론</a>'
            '<a href="/market-brief">오늘 브리핑</a></nav>'
        )
    elif investor_code:
        records = investor_records
        rows = "".join(
            "<tr><td>{date}</td><td>{close:,.0f}원</td><td>{individual:+.1f}억</td>"
            "<td>{institution:+.1f}억</td><td>{foreign:+.1f}억</td></tr>".format(
                date=html.escape(str(record.get("date", ""))),
                close=float(record.get("close") or 0),
                individual=float(record.get("individual_amount") or 0),
                institution=float(record.get("institution_amount") or 0),
                foreign=float(record.get("foreign_amount") or 0),
            )
            for record in records[:20]
        )
        if rows:
            table = (
                '<table style="border-collapse:collapse;max-width:760px;width:100%">'
                '<caption style="text-align:left;margin-bottom:8px;color:#b9c9da">'
                '최근 개인·기관·외국인 순매수(억원)</caption>'
                '<thead><tr><th style="text-align:left;padding:4px 8px">날짜</th>'
                '<th style="text-align:right;padding:4px 8px">종가</th>'
                '<th style="text-align:right;padding:4px 8px">개인</th>'
                '<th style="text-align:right;padding:4px 8px">기관</th>'
                '<th style="text-align:right;padding:4px 8px">외국인</th></tr></thead>'
                f'<tbody>{rows}</tbody></table>'
            )
        else:
            table = "<p>투자자 매매동향 데이터를 아직 준비 중입니다.</p>"
        summary = ""
        if investor_digest:
            summary = (
                f'<p>{html.escape(investor_name)}은(는) {investor_digest["first_date"]}부터 '
                f'{investor_digest["date"]}까지 {investor_digest["days"]}거래일 동안 외국인이 '
                f'{_amount(investor_digest["foreign_amount"])}, 기관이 '
                f'{_amount(investor_digest["institution_amount"])}, 개인이 '
                f'{_amount(investor_digest["individual_amount"])}을 순매매했습니다. '
                f'같은 기간 주가는 {investor_digest["period_pct"]:+.2f}% 변동해 '
                f'{investor_digest["date"]} {investor_digest["close"]:,.0f}원'
                f'({investor_digest["change_pct"]:+.2f}%)에 마감했습니다.'
                + (
                    f' 외국인은 최근 {investor_digest["streak"]}거래일 연속 '
                    f'{investor_digest["streak_side"]} 중입니다.'
                    if investor_digest["streak"] >= 2
                    else ""
                )
                + "</p>"
            )
        faq_pairs = _investor_faq(investor_name, investor_code, investor_digest)
        faq_html = "".join(
            f'<h3 style="margin:16px 0 4px;font-size:17px">{html.escape(question)}</h3>'
            f'<p style="max-width:760px;line-height:1.8;color:#b9c9da">{html.escape(answer)}</p>'
            for question, answer in faq_pairs
        )
        neighbours = "".join(
            f'<a href="/investor/{other_code}">{html.escape(other_name)} 수급</a>'
            for other_code, other_name in _investor_neighbours(investor_code)
        )
        report_content = (
            f'<p>{html.escape(investor_name)}({investor_code})의 날짜별 개인·기관·외국인 순매수 금액(억원)과 '
            '종가 추이입니다. 매수(+)는 순매수, 매도(-)는 순매도를 의미합니다.</p>'
            f'{summary}'
            f'{table}'
            f'<h2 style="margin-top:32px;font-size:22px">자주 묻는 질문</h2>{faq_html}'
            '<nav aria-label="관련 정보" style="display:flex;flex-wrap:wrap;gap:12px">'
            f'<a href="/stock/{investor_code}">{html.escape(investor_name)} 주가·차트</a>'
            f'<a href="/stock/{investor_code}/outlook">{html.escape(investor_name)} 주가 전망</a>'
            f'<a href="/stock/{investor_code}/news">{html.escape(investor_name)} 관련 뉴스</a>'
            f'<a href="/discussion-explorer?code={investor_code}&amp;name={html.escape(investor_name, quote=True)}">{html.escape(investor_name)} 종목토론</a>'
            f'<a href="{INVESTOR_HUB}">외국인·기관 수급 종목 전체</a>'
            '<a href="/desk">국내 주식 시세</a></nav>'
            + (
                '<nav aria-label="비슷한 시가총액 종목의 수급" style="display:flex;flex-wrap:wrap;gap:12px">'
                f'{neighbours}</nav>'
                if neighbours
                else ""
            )
        )
    elif canonical_path == INVESTOR_HUB:
        # The ~2,700 /investor pages were previously reachable only from their own
        # stock page and the sitemap. This hub gives them a single crawlable parent,
        # and every SEO shell links to it, so each one now sits two clicks from home.
        entries = "".join(
            f'<a href="/investor/{html.escape(str(item["code"]))}">'
            f'{html.escape(str(item["name"]))} 외국인·기관 수급</a>'
            for item in kr_universe()
            if re.fullmatch(r"\d{6}", str(item.get("code", "")).strip().upper() or "")
        )
        report_content = (
            '<p>코스피·코스닥 상장 종목의 날짜별 개인·기관·외국인 순매수 금액(억원)과 종가 추이를 '
            '종목별로 확인할 수 있습니다. 시가총액 순으로 정렬했습니다.</p>'
            '<h2 style="margin-top:32px;font-size:22px">종목별 투자자 매매동향</h2>'
            '<nav aria-label="종목별 투자자 매매동향" style="display:flex;flex-wrap:wrap;gap:10px 16px;'
            f'max-width:1100px;line-height:2">{entries}</nav>'
        )
    # The <h1> repeated the site name on every page ("… | K-Stock Hub"), which is
    # boilerplate in the one place Google most wants the page's own subject.
    heading = title.removesuffix(" | K-Stock Hub")
    shell = (
        '<section data-seo-shell="true" style="min-height:100vh;padding:48px 6%;'
        'background:#08111f;color:#eef6ff;font-family:sans-serif">'
        f'<h1 style="font-size:32px">{html.escape(heading)}</h1>'
        f'<p style="max-width:760px;line-height:1.8;color:#b9c9da">{html.escape(description)}</p>'
        f'{report_content}'
        f'<nav aria-label="주요 서비스" style="display:flex;flex-wrap:wrap;gap:16px">{nav}</nav>'
        '</section>'
    )
    return document.replace('<div id="root"></div>', f'<div id="root">{shell}</div>', 1)


SITEMAP_SECTIONS = ("pages", "stocks", "investor")


def _urlset(urls: list[tuple[str, str, str, str]]) -> str:
    rows = []
    for loc, priority, frequency, lastmod in urls:
        escaped_loc = html.escape(loc, quote=False)
        rows.append(
            f"  <url><loc>{escaped_loc}</loc><lastmod>{lastmod}</lastmod>"
            f"<changefreq>{frequency}</changefreq><priority>{priority}</priority></url>"
        )
    return '<?xml version="1.0" encoding="UTF-8"?>\n' \
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(rows) + "\n</urlset>\n"


def latest_trading_day() -> str:
    """The last session actually reflected in the investor data.

    `lastmod` used to be `date.today()` on every URL of every section, refreshed
    daily — including weekends and holidays, when nothing behind those URLs had
    changed. A sitemap whose lastmod is always "now" tells Google nothing, and
    Google discounts it. One upstream lookup gives every investor URL an honest
    date, and it is cached for an hour alongside the sitemap response itself.
    """

    def resolve() -> str:
        try:
            # pageSize 30 on purpose: the same key /investor/005930 and the React page
            # already populate, so this adds no upstream request of its own.
            records = investor_fetcher.get_investor_trend("005930", 30)
            day = str(records[0]["date"]) if records else ""
        except Exception:
            day = ""
        return day if re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) else date.today().isoformat()

    try:
        return cache.get_or_set("seo_latest_trading_day", 3600, resolve)
    except Exception:
        return date.today().isoformat()


def _valid_codes(kr_stocks: list[dict]) -> list[str]:
    # Only a bare six-digit code has a page behind it: STOCK_ROUTE/INVESTOR_ROUTE
    # above and App.tsx both match exactly `\d{6}`, so anything else renders the
    # generic shell rather than a stock page. Stripping non-digits (what this used
    # to do) turned KRX's 신형우선주 codes — "00680K", "00088K", "01200K" and ten
    # others in the top 1,000 by market cap — into five-digit codes like "00680",
    # which is neither the real code nor a routable one: 26 sitemap URLs answering
    # 200 with the generic title, i.e. thin content spending crawl budget. Such a
    # code has no landing page to offer, so it belongs out of the sitemap entirely.
    codes = []
    for stock in kr_stocks:
        code = str(stock.get("code", "")).strip().upper()
        if re.fullmatch(r"\d{6}", code):
            codes.append(code)
    return codes


def build_sitemap_index() -> str:
    """Split by section so Search Console reports coverage per section.

    With one flat sitemap, "3,000 of 5,000 not indexed" was a single unreadable
    number; per-section submission shows immediately whether it is the investor
    pages or the stock landing pages that Google is declining.
    """
    today = date.today().isoformat()
    entries = "".join(
        f"  <sitemap><loc>{SITE}/sitemap-{section}.xml</loc><lastmod>{today}</lastmod></sitemap>\n"
        for section in SITEMAP_SECTIONS
    )
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            f"{entries}</sitemapindex>\n")


def build_pages_sitemap() -> str:
    today = date.today().isoformat()
    urls: list[tuple[str, str, str, str]] = []
    priorities = {"/": "1.0", "/desk": "0.9", "/map": "0.9", "/market-brief": "0.9", "/etf": "0.8"}
    for path in PAGES:
        urls.append((f"{SITE}{path}", priorities.get(path, "0.7"), "daily", today))

    try:
        brief_dates = market_brief_store.dates(1000)
    except Exception:
        brief_dates = []
    for item in brief_dates:
        day = str(item.get("date") or "")
        market = str(item.get("market") or "").lower()
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) or market not in {"kospi", "kosdaq"}:
            continue
        urls.append((f"{SITE}/market-brief/{day}/{market}", "0.8", "never", day))

    for ticker, name in (
        ("AAPL", "Apple"), ("MSFT", "Microsoft"), ("NVDA", "NVIDIA"),
        ("AMZN", "Amazon"), ("GOOGL", "Alphabet"), ("META", "Meta"),
        ("TSLA", "Tesla"), ("AVGO", "Broadcom"), ("AMD", "AMD"),
        ("MU", "Micron Technology"), ("SKHY", "SK Hynix ADR"),
    ):
        query = urlencode({"code": ticker, "name": name})
        urls.append((f"{SITE}/global?{query}", "0.7", "daily", today))
    return _urlset(urls)


def build_stocks_sitemap(kr_stocks: list[dict]) -> str:
    lastmod = latest_trading_day()
    urls: list[tuple[str, str, str, str]] = []
    for code in _valid_codes(kr_stocks):
        urls.append((f"{SITE}/stock/{code}", "0.8", "daily", lastmod))
        # /stock/<code>/investor is gone: it 301s to /investor/<code>. Listing a URL
        # that redirects is exactly what Search Console reports as "페이지에 리디렉션이
        # 있음", and it was competing with /investor/<code> for the same query.
        urls.append((f"{SITE}/stock/{code}/outlook", "0.6", "daily", lastmod))
        urls.append((f"{SITE}/stock/{code}/news", "0.6", "daily", lastmod))
    return _urlset(urls)


def build_investor_sitemap(kr_stocks: list[dict]) -> str:
    lastmod = latest_trading_day()
    urls = [(f"{SITE}{INVESTOR_HUB}", "0.9", "daily", lastmod)]
    for code in _valid_codes(kr_stocks):
        urls.append((f"{SITE}/investor/{code}", "0.7", "daily", lastmod))
    return _urlset(urls)


def build_rss(kr_stocks: list[dict]) -> str:
    """Compact discovery feed for Naver Search Advisor and feed readers."""
    now = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
    items: list[str] = []
    try:
        brief_dates = market_brief_store.dates(30)
    except Exception:
        brief_dates = []
    for item in brief_dates:
        day = str(item.get("date") or "")
        market = str(item.get("market") or "").upper()
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) or market not in {"KOSPI", "KOSDAQ"}:
            continue
        url = f"{SITE}/market-brief/{day}/{market.lower()}"
        title = f"{day} {market} 오늘 브리핑"
        try:
            report = market_brief_store.get(day, market) or {}
            description = _brief_description(report, day, market)
            published = datetime.fromisoformat(str(item.get("created_at") or day)).astimezone(timezone.utc)
            pub_date = published.strftime("%a, %d %b %Y %H:%M:%S +0000")
        except Exception:
            description = _brief_description({}, day, market)
            pub_date = now
        items.append(f"<item><title>{html.escape(title)}</title><link>{html.escape(url)}</link>"
                     f"<guid isPermaLink=\"true\">{html.escape(url)}</guid><description>{html.escape(description)}</description>"
                     f"<pubDate>{pub_date}</pubDate></item>")
    featured = [(path, *PAGES[path]) for path in ("/", "/desk", "/market-brief", "/map", "/kosdaq-map", "/etf", "/news")]
    for path, title, description in featured:
        url = f"{SITE}{path}"
        items.append(f"<item><title>{html.escape(title)}</title><link>{html.escape(url)}</link>"
                     f"<guid isPermaLink=\"true\">{html.escape(url)}</guid><description>{html.escape(description)}</description>"
                     f"<pubDate>{now}</pubDate></item>")
    for stock in kr_stocks[:30]:
        # Same reason build_sitemap validates rather than strips: /desk only promotes a
        # code to the stock page when it is exactly six digits (App.tsx), and stripping
        # the letter off a 신형우선주 code produced a five-digit code that matches
        # nothing at all.
        code = str(stock.get("code", "")).strip().upper()
        name = str(stock.get("name", "")).strip()[:80]
        if not re.fullmatch(r"\d{6}", code) or not name:
            continue
        url = f"{SITE}/desk?" + urlencode({"code": code, "name": name})
        title = f"{name} 주가·차트·투자자 동향"
        items.append(f"<item><title>{html.escape(title)}</title><link>{html.escape(url)}</link>"
                     f"<guid isPermaLink=\"true\">{html.escape(url)}</guid>"
                     f"<description>{html.escape(name)}({code})의 현재가와 시장 정보를 확인하세요.</description>"
                     f"<pubDate>{now}</pubDate></item>")
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>'
            f'<title>K-Stock Hub 증시 정보</title><link>{SITE}</link>'
            '<description>국내외 주식 시세, 시가총액 맵, ETF와 시장 정보</description><language>ko-KR</language>'
            f'<lastBuildDate>{now}</lastBuildDate>{"".join(items)}</channel></rss>\n')
