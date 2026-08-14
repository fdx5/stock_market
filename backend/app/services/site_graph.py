"""The site's own wiring diagram, for the admin monitor's neuron view.

Four layers, which is what makes the picture read as a nervous system rather than a
box diagram: a visitor touches a **page**, the page calls one or more **api** endpoints,
each endpoint leans on a **store** (a cache, a table) or reaches out to an **upstream**
feed (Naver, Yahoo, slickcharts). A signal entering at a page node has somewhere to
travel to, and that travel is the thing the monitor animates.

Where each layer's truth comes from matters, because a wiring diagram that quietly goes
stale is worse than no diagram:

- **api nodes are enumerated from the live FastAPI route table**, so they cannot drift.
  Add a route and it appears; delete one and it is gone.
- **pages and edges are curated below.** There is no way to derive "which endpoints does
  /desk call" from the backend — that knowledge lives in the frontend's components. So
  it is written out by hand, and then *checked*: any edge naming a route that no longer
  exists is dropped and reported in `warnings`, where the monitor shows it. The drift
  becomes visible instead of becoming a lie.

The page list is App.tsx's route table, in the same order, including the two routes that
carry a parameter (/investor/{code}, /index/{symbol}) — the monitor reduces a real
visitor's path to those templates before looking the node up. The call list is what the
page's own component *and every component it renders* asks for, followed to the leaves:
/desk draws /api/stock/{code}/board because it renders SidePanel, which renders
BoardPanel. Three calls are left out of every page's list and applied by `build_graph`
instead, because they belong to the app shell rather than to any one route — see
SHELL_CALLS below.
"""

from typing import Iterable

# ─────────────────────────────── layer 1: pages ───────────────────────────────
# `path` is the client-side route, which is also the key activity_log reports events
# under — that join is what lets a real visitor's page view light the right node.
PAGES: list[dict] = [
    {"id": "page:/", "label": "허브 (태양계)", "path": "/", "group": "entry"},
    {"id": "page:/desk", "label": "마켓 데스크", "path": "/desk", "group": "stock"},
    # Still routed, and deliberately: nothing links to it any more, but bookmarks and
    # anything already indexed keep resolving here. See App.tsx.
    {"id": "page:/dashboard", "label": "종목 대시보드 (구)", "path": "/dashboard", "group": "stock"},
    {"id": "page:/global", "label": "해외 종목", "path": "/global", "group": "stock"},
    {"id": "page:/global-top100", "label": "글로벌 시총 TOP100", "path": "/global-top100", "group": "stock"},
    {"id": "page:/etf", "label": "ETF 마켓", "path": "/etf", "group": "etf"},
    {"id": "page:/discussion-explorer", "label": "종목토론탐험", "path": "/discussion-explorer", "group": "stock"},
    {"id": "page:/map", "label": "KOSPI MAP", "path": "/map", "group": "map"},
    {"id": "page:/kosdaq-map", "label": "KOSDAQ MAP", "path": "/kosdaq-map", "group": "map"},
    {"id": "page:/sp500-map", "label": "S&P500 MAP", "path": "/sp500-map", "group": "map"},
    {"id": "page:/nasdaq100-map", "label": "NASDAQ100 MAP", "path": "/nasdaq100-map", "group": "map"},
    {"id": "page:/kospi-100", "label": "KOSPI TOP100", "path": "/kospi-100", "group": "board"},
    {"id": "page:/kosdaq-100", "label": "KOSDAQ TOP100", "path": "/kosdaq-100", "group": "board"},
    {"id": "page:/nasdaq-100", "label": "NASDAQ TOP100", "path": "/nasdaq-100", "group": "board"},
    # The two parameterised routes. Written as templates because that is what the
    # monitor reduces /investor/005930 and /index/kospi to before matching.
    {"id": "page:/investor/{code}", "label": "투자자 동향", "path": "/investor/{code}", "group": "market"},
    {"id": "page:/index/{symbol}", "label": "지수 차트", "path": "/index/{symbol}", "group": "market"},
    {"id": "page:/dram-price", "label": "D램 현물가", "path": "/dram-price", "group": "market"},
    {"id": "page:/ai-prediction", "label": "AI 예측", "path": "/ai-prediction", "group": "predict"},
    {"id": "page:/ai-prediction/grading", "label": "예측 채점", "path": "/ai-prediction/grading", "group": "predict"},
    {"id": "page:/fight", "label": "시총대결", "path": "/fight", "group": "play"},
    {"id": "page:/battle", "label": "줄다리기", "path": "/battle", "group": "play"},
    {"id": "page:/news", "label": "뉴스", "path": "/news", "group": "news"},
    {"id": "page:/admin", "label": "관리자 로그인", "path": "/admin", "group": "admin"},
    {"id": "page:/admin/dashboard", "label": "관리자", "path": "/admin/dashboard", "group": "admin"},
    {"id": "page:/admin/db", "label": "DB 콘솔", "path": "/admin/db", "group": "admin"},
    {"id": "page:/admin/monitor", "label": "모니터", "path": "/admin/monitor", "group": "admin"},
]

# ─────────────────────── layer 3/4: stores and upstreams ───────────────────────
DEPOTS: list[dict] = [
    {"id": "store:cache", "label": "TTL 캐시", "group": "store"},
    {"id": "store:turso", "label": "Turso DB", "group": "store"},
    {"id": "store:activity", "label": "활동 로그", "group": "store"},
    {"id": "up:naver", "label": "Naver 금융", "group": "upstream"},
    {"id": "up:yahoo", "label": "Yahoo Finance", "group": "upstream"},
    {"id": "up:toss", "label": "토스증권 커뮤니티", "group": "upstream"},
    {"id": "up:slickcharts", "label": "slickcharts", "group": "upstream"},
    {"id": "up:cmc", "label": "companiesmarketcap", "group": "upstream"},
    {"id": "up:fdr", "label": "FinanceDataReader", "group": "upstream"},
    {"id": "up:krx", "label": "KRX · SEIBro", "group": "upstream"},
    {"id": "up:trendforce", "label": "TrendForce", "group": "upstream"},
    {"id": "up:bing", "label": "Bing 뉴스", "group": "upstream"},
    {"id": "up:gtranslate", "label": "Google 번역", "group": "upstream"},
    {"id": "up:openmeteo", "label": "Open-Meteo", "group": "upstream"},
    {"id": "up:ipapi", "label": "ip-api", "group": "upstream"},
    {"id": "up:claude", "label": "Claude (예측)", "group": "upstream"},
    {"id": "up:kakao", "label": "Kakao 알림", "group": "upstream"},
    {"id": "up:resend", "label": "Resend 메일", "group": "upstream"},
]

# ───────────────────────── page → api (hand-maintained) ─────────────────────────
PAGE_CALLS: dict[str, list[str]] = {
    # The entrance reads the four index numbers on its rail and nothing else — the
    # planets are geometry, not data.
    "page:/": ["/api/investor/indices", "/api/global/indices"],
    "page:/desk": [
        "/api/search",
        "/api/search/popular",
        "/api/stock/{code}/summary",
        "/api/stock/{code}/quote",
        "/api/stock/{code}/indicators",
        "/api/stock/{code}/news",
        "/api/stock/{code}/overview",
        "/api/stock/{code}/orderbook",
        "/api/stock/{code}/balance",
        "/api/stock/{code}/daily",
        "/api/stock/{code}/board",
        "/api/stock/{code}/board/{nid}",
        "/api/stock/{code}/board/{nid}/comments",
        # 종목 레이더 and 오늘의 주목 종목 both carry a US side, so the desk quotes
        # US tickers through the US endpoints rather than the KR ones.
        "/api/us-stock/{code}/quote",
        "/api/us-stock/{code}/daily",
        "/api/market/map",
        "/api/market/kosdaq-map",
        "/api/market/sp500-map",
        "/api/market/nasdaq100-map",
        "/api/market/sector-map",
        "/api/market/dram-price",
        "/api/market/futures",
        "/api/market/ticker",
        "/api/market/weather",
        "/api/investor/indices",
        "/api/investor/summary",
        "/api/investor/weekly-foreign-top",
        "/api/global/indices",
        "/api/visitors/count",
        "/api/translate",
    ],
    "page:/dashboard": [
        "/api/search",
        "/api/search/popular",
        "/api/stock/{code}/summary",
        "/api/stock/{code}/quote",
        "/api/stock/{code}/indicators",
        "/api/stock/{code}/news",
        "/api/stock/{code}/overview",
        "/api/stock/{code}/orderbook",
        "/api/stock/{code}/balance",
        "/api/stock/{code}/daily",
        "/api/stock/{code}/board",
        "/api/stock/{code}/board/{nid}",
        "/api/stock/{code}/board/{nid}/comments",
        "/api/market/map",
        "/api/market/kosdaq-map",
        "/api/market/sector-map",
        "/api/market/dram-price",
        "/api/market/futures",
        "/api/market/ticker",
        "/api/market/weather",
        "/api/investor/indices",
        "/api/investor/summary",
        "/api/investor/weekly-foreign-top",
        "/api/global/indices",
        "/api/visitors/count",
        "/api/translate",
    ],
    # No KR market data at all by design — see StockRadarBoard's `market` prop.
    "page:/global": [
        "/api/search",
        "/api/search/popular",
        "/api/us-stock/{code}/quote",
        "/api/us-stock/{code}/indicators",
        "/api/us-stock/{code}/daily",
        "/api/global/indices",
        "/api/global/{code}/enrichment",
        "/api/global/{code}/discussion",
        "/api/fight/news",
        "/api/fight/news/article",
        "/api/market/sp500-map",
        "/api/market/nasdaq100-map",
        "/api/market/us-sector-map",
        "/api/market/dram-price",
        "/api/market/ticker",
        "/api/market/weather",
        "/api/visitors/count",
        "/api/translate",
    ],
    "page:/global-top100": ["/api/global-top100", "/api/visitors/count"],
    "page:/etf": [
        "/api/etfs",
        "/api/etfs/discussions",
        "/api/etfs/{code}/toss-discussion",
        "/api/translate",
    ],
    "page:/map": ["/api/market/map", "/api/market/ticker", "/api/visitors/count", "/api/translate"],
    "page:/kosdaq-map": [
        "/api/market/kosdaq-map",
        "/api/market/ticker",
        "/api/visitors/count",
        "/api/translate",
    ],
    "page:/sp500-map": [
        "/api/market/sp500-map",
        "/api/market/us-logo/{ticker}",
        "/api/market/ticker",
        "/api/visitors/count",
        "/api/translate",
    ],
    "page:/nasdaq100-map": [
        "/api/market/nasdaq100-map",
        "/api/market/us-logo/{ticker}",
        "/api/market/ticker",
        "/api/visitors/count",
        "/api/translate",
    ],
    "page:/kospi-100": [
        "/api/market/board",
        "/api/market/ticker",
        "/api/visitors/count",
        "/api/translate",
    ],
    "page:/kosdaq-100": [
        "/api/market/board",
        "/api/market/ticker",
        "/api/visitors/count",
        "/api/translate",
    ],
    "page:/nasdaq-100": [
        "/api/market/board",
        "/api/market/us-logo/{ticker}",
        "/api/market/ticker",
        "/api/visitors/count",
        "/api/translate",
    ],
    "page:/investor/{code}": ["/api/investor/{code}", "/api/translate"],
    "page:/index/{symbol}": ["/api/market/index/{symbol}/history"],
    "page:/dram-price": ["/api/market/dram-price/history"],
    "page:/ai-prediction": [
        "/api/prediction",
        "/api/prediction/dates",
        "/api/prediction/accuracy",
        "/api/prediction/stock/{code}",
        "/api/visitors/count",
    ],
    "page:/ai-prediction/grading": [
        "/api/prediction/grading-matrix",
        "/api/prediction/stock/{code}",
    ],
    "page:/fight": [
        "/api/fight/status",
        "/api/fight/comments",
        "/api/fight/news",
        "/api/fight/news/article",
        "/api/battle/global-top20",
        "/api/battle/global-top20/detail",
        "/api/visitors/count",
        "/api/translate",
    ],
    "page:/battle": [
        "/api/battle/status",
        "/api/battle/comments",
        "/api/battle/exchange",
        "/api/battle/global-top20",
        "/api/battle/global-top20/detail",
        "/api/visitors/count",
        "/api/translate",
    ],
    "page:/news": [
        "/api/fight/news",
        "/api/fight/news/article",
        "/api/battle/global-top20",
        "/api/visitors/count",
        "/api/translate",
    ],
    "page:/admin": ["/api/admin/login"],
    "page:/admin/dashboard": [
        "/api/admin/summary",
        "/api/admin/pages/trend",
        "/api/admin/pages/visitor-trend",
        "/api/admin/pages/top",
        "/api/admin/stocks/top",
        "/api/admin/hub/summary",
        "/api/admin/hub/trend",
        "/api/admin/hub/objects/top",
        "/api/admin/hub/session/{session_id}",
        "/api/admin/live/tail",
        "/api/admin/live/sessions",
        "/api/admin/comments",
        "/api/admin/comments/{source}/{comment_id}",
        "/api/admin/comments/{source}/{comment_id}/visibility",
        "/api/admin/prediction/status",
        "/api/admin/prediction/run",
        "/api/admin/dram-price/status",
        "/api/admin/dram-price/run",
        "/api/admin/notify/kakao/visitors/status",
        "/api/admin/notify/kakao/visitors/run",
        "/api/admin/notify/kakao/prediction/status",
        "/api/admin/notify/kakao/prediction/run",
        "/api/admin/notify/kakao/dram-price/status",
        "/api/admin/notify/kakao/dram-price/run",
        "/api/admin/mail/status",
        "/api/admin/mail/history",
        "/api/admin/mail/send",
    ],
    "page:/admin/db": [
        "/api/admin/db/sources",
        "/api/admin/db/tables",
        "/api/admin/db/tables/{table}/columns",
        "/api/admin/db/tables/{table}/preview",
        "/api/admin/db/query",
    ],
    "page:/admin/monitor": [
        "/api/admin/monitor/unlock",
        "/api/admin/monitor/graph",
        "/api/admin/monitor/pulse",
    ],
}

# ─────────────────────────── the app shell's own calls ───────────────────────────
# Three endpoints belong to no page in particular, because they are fired by code that
# wraps every page: the language provider resolves the visitor's country once per
# session, and the activity tracker reports a page view on every route change. Listing
# them per page would have added an edge from all 24 nodes twice over and taught a
# reader nothing they can't read here, so `build_graph` attaches them instead.
SHELL_CALLS: list[str] = ["/api/geo/country"]
# ...and this one from every route except the admin ones, which never report themselves
# — admin usage would otherwise pollute the very statistics it is looking at (see the
# frontend's useActivityTracking.isAdminPath).
VISITOR_SHELL_CALLS: list[str] = ["/api/activity/event"]

# ───────────────────── api → store / upstream (hand-maintained) ─────────────────
# Keyed by route prefix rather than exact path: every /api/stock/* endpoint ultimately
# reads Naver through the same cache, and listing them one by one would be twenty lines
# saying the same thing. Longest prefix wins, so a specific route can still override.
API_DEPENDS: list[tuple[str, list[str]]] = [
    ("/api/etfs/{code}/toss-discussion", ["store:cache", "up:toss"]),
    ("/api/etfs/discussions", ["store:cache", "up:naver", "up:toss"]),
    ("/api/etfs", ["store:cache", "up:naver", "up:yahoo"]),
    ("/api/market/us-logo", ["up:cmc"]),
    ("/api/market/sp500-map", ["store:cache", "up:slickcharts", "up:yahoo"]),
    ("/api/market/nasdaq100-map", ["store:cache", "up:slickcharts", "up:yahoo"]),
    ("/api/market/us-sector-map", ["store:cache", "up:slickcharts", "up:yahoo"]),
    ("/api/market/board", ["store:cache", "up:naver", "up:yahoo", "up:slickcharts"]),
    ("/api/market/ticker", ["store:cache", "up:yahoo"]),
    ("/api/market/weather", ["store:cache", "up:openmeteo"]),
    # Scraped once a day and kept in Turso, so a read serves the stored snapshot and
    # only the batch route goes out to TrendForce.
    ("/api/market/dram-price", ["store:cache", "store:turso"]),
    ("/api/market/dram-price/refresh", ["store:turso", "up:trendforce", "up:kakao"]),
    ("/api/market", ["store:cache", "up:naver"]),
    ("/api/stock/{code}/balance", ["store:cache", "up:naver", "up:krx"]),
    ("/api/stock", ["store:cache", "up:naver"]),
    ("/api/us-stock", ["store:cache", "up:yahoo"]),
    ("/api/global-top100", ["store:cache", "store:turso", "up:cmc", "up:yahoo"]),
    ("/api/global", ["store:cache", "up:cmc", "up:yahoo"]),
    ("/api/battle", ["store:cache", "up:cmc", "store:turso"]),
    ("/api/fight/news", ["store:cache", "up:bing", "up:gtranslate"]),
    ("/api/fight", ["store:cache", "up:naver", "store:turso"]),
    ("/api/investor", ["store:cache", "up:fdr"]),
    ("/api/search", ["store:cache", "store:turso", "up:fdr"]),
    ("/api/prediction/run", ["up:claude", "store:turso"]),
    ("/api/prediction", ["store:turso", "store:cache"]),
    ("/api/activity/event", ["store:activity", "store:turso"]),
    ("/api/visitors", ["store:turso"]),
    ("/api/admin/notify", ["up:kakao", "store:turso"]),
    ("/api/admin/mail", ["store:turso", "up:resend"]),
    ("/api/admin/db", ["store:turso"]),
    ("/api/admin/live", ["store:activity"]),
    ("/api/admin/monitor", ["store:activity"]),
    ("/api/admin/prediction", ["store:turso", "up:claude"]),
    ("/api/admin/dram-price", ["store:turso", "up:trendforce"]),
    ("/api/admin", ["store:turso"]),
    ("/api/notify", ["up:kakao", "store:turso"]),
    ("/api/translate", ["store:cache", "up:gtranslate"]),
    ("/api/geo", ["store:cache", "up:ipapi"]),
]

# Which neuron cluster an endpoint belongs to, by path prefix — the monitor colours and
# spatially groups by this, so related endpoints sit together in the cloud.
_GROUP_BY_PREFIX: list[tuple[str, str]] = [
    ("/api/admin/monitor", "monitor"),
    ("/api/admin", "admin"),
    ("/api/notify", "admin"),
    ("/api/etfs", "etf"),
    ("/api/market", "market"),
    ("/api/us-stock", "stock"),
    ("/api/stock", "stock"),
    ("/api/global", "stock"),
    ("/api/prediction", "predict"),
    ("/api/battle", "play"),
    ("/api/fight", "play"),
    ("/api/investor", "market"),
    ("/api/search", "core"),
    ("/api/activity", "core"),
    ("/api/visitors", "core"),
    ("/api/translate", "core"),
    ("/api/geo", "core"),
    ("/api/health", "core"),
]


def _group_for(path: str) -> str:
    for prefix, group in _GROUP_BY_PREFIX:
        if path.startswith(prefix):
            return group
    return "core"


def _depends_for(path: str) -> list[str]:
    best: list[str] = []
    best_len = -1
    for prefix, depots in API_DEPENDS:
        if path.startswith(prefix) and len(prefix) > best_len:
            best, best_len = depots, len(prefix)
    return best


def _api_label(path: str) -> str:
    """The endpoint's own tail, which is what identifies it once the cluster it sits in
    already carries the prefix. `/api/stock/{code}/quote` reads as "{code}/quote"."""
    tail = path.removeprefix("/api/")
    for prefix, _ in _GROUP_BY_PREFIX:
        stem = prefix.removeprefix("/api/")
        if tail.startswith(stem + "/"):
            return tail[len(stem) + 1 :]
    return tail


def _calls_for(page: dict) -> list[str]:
    """A page's curated calls plus whichever shell calls apply to it, de-duplicated so a
    page that already lists one does not get two edges to the same endpoint."""
    calls = list(PAGE_CALLS.get(page["id"], []))
    shell = SHELL_CALLS if page["path"].startswith("/admin") else SHELL_CALLS + VISITOR_SHELL_CALLS
    for path in shell:
        if path not in calls:
            calls.append(path)
    return calls


def build_graph(routes: Iterable) -> dict:
    """Nodes and edges for the monitor, given the app's live route table.

    Takes `routes` rather than importing the app, so this module stays free of a circular
    import back to main and stays trivially testable with a fake route list.
    """
    api_nodes: dict[str, dict] = {}
    for route in routes:
        path = getattr(route, "path", "")
        methods = getattr(route, "methods", None)
        if not path.startswith("/api") or not methods:
            continue
        verbs = sorted(methods - {"HEAD", "OPTIONS"})
        if not verbs:
            continue
        api_nodes[path] = {
            "id": f"api:{path}",
            "label": _api_label(path),
            "path": path,
            "methods": verbs,
            "group": _group_for(path),
            "kind": "api",
        }

    nodes: list[dict] = [{**p, "kind": "page"} for p in PAGES]
    nodes += sorted(api_nodes.values(), key=lambda n: n["path"])
    nodes += [{**d, "kind": "depot"} for d in DEPOTS]
    known = {n["id"] for n in nodes}

    edges: list[dict] = []
    warnings: list[str] = []

    curated_pages = {p["id"] for p in PAGES}
    for page_id in PAGE_CALLS:
        if page_id not in curated_pages:
            warnings.append(f"알 수 없는 페이지 노드: {page_id}")

    for page in PAGES:
        for path in _calls_for(page):
            target = f"api:{path}"
            if target not in known:
                # The curated table has outlived the route it names. Reported rather than
                # silently dropped — this is exactly the drift the docstring warns about.
                warnings.append(f"사라진 API 경로를 가리키는 연결: {page['id']} → {path}")
                continue
            edges.append({"source": page["id"], "target": target, "kind": "call"})

    for path in api_nodes:
        for depot in _depends_for(path):
            if depot in known:
                edges.append({"source": f"api:{path}", "target": depot, "kind": "depend"})

    return {"nodes": nodes, "edges": edges, "warnings": warnings}
