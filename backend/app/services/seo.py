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
from app.data.universe import get_stock_name
from app.services import market_brief_store

SITE = "https://kospi-predictor.onrender.com"
IMAGE = f"{SITE}/img/kospi-map-preview.png"
MARKET_BRIEF_ROUTE = re.compile(r"^/market-brief/(\d{4}-\d{2}-\d{2})/(kospi|kosdaq|samsung|hynix|hyundai|sksquare|semco|\d{6})$", re.I)
STOCK_ROUTE = re.compile(r"^/stock/(\d{6})$", re.I)
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

PAGES: dict[str, tuple[str, str]] = {
    "/": ("K-Stock Hub | 코스피·코스닥·미국 주식 시세와 ETF", "코스피·코스닥·미국 증시 시세, 시가총액 맵, 거래대금 순위, ETF와 종목토론을 한곳에서 확인하세요."),
    "/desk": ("국내 주식 시세와 오늘의 시장 현황 | K-Stock Hub", "코스피·코스닥 지수, 국내 주식 현재가, 거래대금, 외국인·기관 수급과 오늘의 주목 종목을 확인하세요."),
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
    canonical_path = "/" if path == "/type2" else path.rstrip("/") or "/"
    brief, brief_day, brief_market = _market_brief(canonical_path)
    stock_code, stock_name = _stock_identity(canonical_path)
    investor_code, investor_name = _investor_identity(canonical_path)
    page_lookup = "/market-brief" if brief_day else canonical_path
    title, description = PAGES.get(page_lookup, PAGES["/"])
    page_image = IMAGE
    if brief:
        title = f"{brief_day} {brief_market.upper()} 오늘 브리핑 | K-Stock Hub"
        description = _brief_description(brief, brief_day, brief_market)
        page_image = f"{SITE}/market-brief/og/{brief_day}/{brief_market}.png"
    elif stock_code:
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
    if investor_code:
        title = f"{investor_name} 외국인·기관 매매동향 | K-Stock Hub"
        description = f"{investor_name}({investor_code})의 날짜별 개인·기관·외국인 순매수 금액(억원)과 종가 추이를 확인하세요."

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
                        {"@type": "ListItem", "position": 3, "name": investor_name, "item": f"{SITE}/stock/{investor_code}"},
                        {"@type": "ListItem", "position": 4, "name": "외국인·기관 매매동향", "item": canonical},
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
        report_content = (
            f'<p>{html.escape(stock_name)} 현재가와 기간별 차트, 거래량, 기술적 지표, '
            '외국인·기관 매매동향 및 관련 뉴스를 제공합니다.</p>'
            '<nav aria-label="종목 관련 분석" style="display:flex;flex-wrap:wrap;gap:12px">'
            f'<a href="/investor/{stock_code}">{html.escape(stock_name)} 외국인·기관 수급</a>'
            f'<a href="/discussion-explorer?code={stock_code}&amp;name={html.escape(stock_name, quote=True)}">{html.escape(stock_name)} 종목토론</a>'
            '<a href="/market-brief">오늘 브리핑</a></nav>'
        )
    elif investor_code:
        try:
            records = investor_fetcher.get_investor_trend(investor_code, 10)
        except Exception:
            records = []
        rows = "".join(
            "<tr><td>{date}</td><td>{close:,.0f}원</td><td>{individual:+.1f}억</td>"
            "<td>{institution:+.1f}억</td><td>{foreign:+.1f}억</td></tr>".format(
                date=html.escape(str(record.get("date", ""))),
                close=float(record.get("close") or 0),
                individual=float(record.get("individual_amount") or 0),
                institution=float(record.get("institution_amount") or 0),
                foreign=float(record.get("foreign_amount") or 0),
            )
            for record in records
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
        report_content = (
            f'<p>{html.escape(investor_name)}({investor_code})의 날짜별 개인·기관·외국인 순매수 금액(억원)과 '
            '종가 추이입니다. 매수(+)는 순매수, 매도(-)는 순매도를 의미합니다.</p>'
            f'{table}'
            '<nav aria-label="관련 정보" style="display:flex;flex-wrap:wrap;gap:12px">'
            f'<a href="/stock/{investor_code}">{html.escape(investor_name)} 주가·차트</a>'
            f'<a href="/discussion-explorer?code={investor_code}&amp;name={html.escape(investor_name, quote=True)}">{html.escape(investor_name)} 종목토론</a>'
            '<a href="/desk">국내 주식 시세</a></nav>'
        )
    shell = (
        '<section data-seo-shell="true" style="min-height:100vh;padding:48px 6%;'
        'background:#08111f;color:#eef6ff;font-family:sans-serif">'
        f'<h1 style="font-size:32px">{html.escape(title)}</h1>'
        f'<p style="max-width:760px;line-height:1.8;color:#b9c9da">{html.escape(description)}</p>'
        f'{report_content}'
        f'<nav aria-label="주요 서비스" style="display:flex;flex-wrap:wrap;gap:16px">{nav}</nav>'
        '</section>'
    )
    return document.replace('<div id="root"></div>', f'<div id="root">{shell}</div>', 1)


def build_sitemap(kr_stocks: list[dict]) -> str:
    """Public route inventory plus data-rich stock pages Google can discover."""
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

    for stock in kr_stocks:
        # Only a bare six-digit code has a page behind it: STOCK_ROUTE/INVESTOR_ROUTE
        # above and App.tsx both match exactly `\d{6}`, so anything else renders the
        # generic shell rather than a stock page. Stripping non-digits (what this used
        # to do) turned KRX's 신형우선주 codes — "00680K", "00088K", "01200K" and ten
        # others in the top 1,000 by market cap — into five-digit codes like "00680",
        # which is neither the real code nor a routable one: 26 sitemap URLs answering
        # 200 with the generic title, i.e. thin content spending crawl budget. Such a
        # code has no landing page to offer, so it belongs out of the sitemap entirely.
        code = str(stock.get("code", "")).strip().upper()
        if not re.fullmatch(r"\d{6}", code):
            continue
        urls.append((f"{SITE}/stock/{code}", "0.8", "daily", today))
        urls.append((f"{SITE}/investor/{code}", "0.6", "daily", today))

    for ticker, name in (
        ("AAPL", "Apple"), ("MSFT", "Microsoft"), ("NVDA", "NVIDIA"),
        ("AMZN", "Amazon"), ("GOOGL", "Alphabet"), ("META", "Meta"),
        ("TSLA", "Tesla"), ("AVGO", "Broadcom"), ("AMD", "AMD"),
        ("MU", "Micron Technology"), ("SKHY", "SK Hynix ADR"),
    ):
        query = urlencode({"code": ticker, "name": name})
        urls.append((f"{SITE}/global?{query}", "0.7", "daily", today))

    rows = []
    for loc, priority, frequency, lastmod in urls:
        escaped_loc = html.escape(loc, quote=False)
        rows.append(
            f"  <url><loc>{escaped_loc}</loc><lastmod>{lastmod}</lastmod>"
            f"<changefreq>{frequency}</changefreq><priority>{priority}</priority></url>"
        )
    return '<?xml version="1.0" encoding="UTF-8"?>\n' \
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(rows) + "\n</urlset>\n"


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
