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
  /dashboard call" from the backend — that knowledge lives in the frontend's components.
  So it is written out by hand, and then *checked*: any edge naming a route that no
  longer exists is dropped and reported in `warnings`, where the monitor shows it. The
  drift becomes visible instead of becoming a lie.

Curation is deliberately partial on the edge side. Every endpoint is a node, but only
the calls that carry a page's primary data are drawn — wiring up all 85 would make the
diagram a hairball and teach a reader nothing.
"""

from typing import Iterable

# ─────────────────────────────── layer 1: pages ───────────────────────────────
# `path` is the client-side route, which is also the key activity_log reports events
# under — that join is what lets a real visitor's page view light the right node.
PAGES: list[dict] = [
    {"id": "page:/", "label": "허브", "path": "/", "group": "entry"},
    {"id": "page:/dashboard", "label": "종목 대시보드", "path": "/dashboard", "group": "stock"},
    {"id": "page:/global", "label": "해외 종목", "path": "/global", "group": "stock"},
    {"id": "page:/global-top100", "label": "글로벌 시총 TOP100", "path": "/global-top100", "group": "stock"},
    {"id": "page:/map", "label": "KOSPI MAP", "path": "/map", "group": "map"},
    {"id": "page:/kosdaq-map", "label": "KOSDAQ MAP", "path": "/kosdaq-map", "group": "map"},
    {"id": "page:/sp500-map", "label": "S&P500 MAP", "path": "/sp500-map", "group": "map"},
    {"id": "page:/nasdaq100-map", "label": "NASDAQ100 MAP", "path": "/nasdaq100-map", "group": "map"},
    {"id": "page:/kospi-100", "label": "KOSPI TOP100", "path": "/kospi-100", "group": "board"},
    {"id": "page:/kosdaq-100", "label": "KOSDAQ TOP100", "path": "/kosdaq-100", "group": "board"},
    {"id": "page:/nasdaq-100", "label": "NASDAQ TOP100", "path": "/nasdaq-100", "group": "board"},
    {"id": "page:/ai-prediction", "label": "AI 예측", "path": "/ai-prediction", "group": "predict"},
    {"id": "page:/ai-prediction/grading", "label": "예측 채점", "path": "/ai-prediction/grading", "group": "predict"},
    {"id": "page:/fight", "label": "시총대결", "path": "/fight", "group": "play"},
    {"id": "page:/battle", "label": "줄다리기", "path": "/battle", "group": "play"},
    {"id": "page:/news", "label": "뉴스", "path": "/news", "group": "news"},
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
    {"id": "up:slickcharts", "label": "slickcharts", "group": "upstream"},
    {"id": "up:cmc", "label": "companiesmarketcap", "group": "upstream"},
    {"id": "up:fdr", "label": "FinanceDataReader", "group": "upstream"},
    {"id": "up:claude", "label": "Claude (예측)", "group": "upstream"},
    {"id": "up:kakao", "label": "Kakao 알림", "group": "upstream"},
]

# ───────────────────────── page → api (hand-maintained) ─────────────────────────
PAGE_CALLS: dict[str, list[str]] = {
    "page:/": ["/api/visitors/count", "/api/market/ticker"],
    "page:/dashboard": [
        "/api/search",
        "/api/search/popular",
        "/api/stock/{code}/summary",
        "/api/stock/{code}/indicators",
        "/api/stock/{code}/quote",
        "/api/stock/{code}/news",
        "/api/stock/{code}/overview",
        "/api/stock/{code}/orderbook",
        "/api/market/sector-map",
        "/api/market/ticker",
        "/api/global/indices",
        "/api/activity/event",
    ],
    "page:/global": [
        "/api/us-stock/{code}/quote",
        "/api/us-stock/{code}/indicators",
        "/api/us-stock/{code}/daily",
        "/api/global/{code}/enrichment",
        "/api/global/{code}/discussion",
        "/api/market/us-sector-map",
    ],
    "page:/global-top100": ["/api/global-top100"],
    "page:/map": ["/api/market/map", "/api/market/ticker"],
    "page:/kosdaq-map": ["/api/market/kosdaq-map", "/api/market/ticker"],
    "page:/sp500-map": ["/api/market/sp500-map", "/api/market/ticker", "/api/market/us-logo/{ticker}"],
    "page:/nasdaq100-map": ["/api/market/nasdaq100-map", "/api/market/ticker", "/api/market/us-logo/{ticker}"],
    "page:/kospi-100": ["/api/market/board", "/api/market/ticker"],
    "page:/kosdaq-100": ["/api/market/board", "/api/market/ticker"],
    "page:/nasdaq-100": ["/api/market/board", "/api/market/ticker"],
    "page:/ai-prediction": ["/api/prediction", "/api/prediction/dates", "/api/prediction/accuracy"],
    "page:/ai-prediction/grading": ["/api/prediction/grading-matrix", "/api/prediction/accuracy"],
    "page:/fight": ["/api/fight/status", "/api/fight/comments", "/api/fight/news", "/api/battle/global-top20"],
    "page:/battle": ["/api/battle/status", "/api/battle/comments", "/api/battle/exchange"],
    "page:/news": ["/api/fight/news", "/api/fight/news/article"],
    "page:/admin/dashboard": [
        "/api/admin/summary",
        "/api/admin/pages/trend",
        "/api/admin/pages/top",
        "/api/admin/stocks/top",
        "/api/admin/live/tail",
        "/api/admin/live/sessions",
    ],
    "page:/admin/db": ["/api/admin/db/sources", "/api/admin/db/tables", "/api/admin/db/query"],
    "page:/admin/monitor": [
        "/api/admin/monitor/unlock",
        "/api/admin/monitor/graph",
        "/api/admin/monitor/pulse",
    ],
}

# ───────────────────── api → store / upstream (hand-maintained) ─────────────────
# Keyed by route prefix rather than exact path: every /api/stock/* endpoint ultimately
# reads Naver through the same cache, and listing them one by one would be twenty lines
# saying the same thing. Longest prefix wins, so a specific route can still override.
API_DEPENDS: list[tuple[str, list[str]]] = [
    ("/api/market/us-logo", ["up:cmc"]),
    ("/api/market/sp500-map", ["store:cache", "up:slickcharts", "up:yahoo"]),
    ("/api/market/nasdaq100-map", ["store:cache", "up:slickcharts", "up:yahoo"]),
    ("/api/market/us-sector-map", ["store:cache", "up:slickcharts", "up:yahoo"]),
    ("/api/market/board", ["store:cache", "up:naver", "up:yahoo", "up:slickcharts"]),
    ("/api/market/ticker", ["store:cache", "up:yahoo"]),
    ("/api/market/weather", ["store:cache"]),
    ("/api/market", ["store:cache", "up:naver"]),
    ("/api/stock", ["store:cache", "up:naver"]),
    ("/api/us-stock", ["store:cache", "up:yahoo"]),
    ("/api/global-top100", ["store:cache", "store:turso", "up:cmc", "up:yahoo"]),
    ("/api/global", ["store:cache", "up:cmc", "up:yahoo"]),
    ("/api/battle", ["store:cache", "up:cmc", "store:turso"]),
    ("/api/fight", ["store:cache", "up:naver", "store:turso"]),
    ("/api/investor", ["store:cache", "up:fdr"]),
    ("/api/search", ["store:cache", "store:turso"]),
    ("/api/prediction/run", ["up:claude", "store:turso"]),
    ("/api/prediction", ["store:turso", "store:cache"]),
    ("/api/activity/event", ["store:activity", "store:turso"]),
    ("/api/visitors", ["store:turso"]),
    ("/api/admin/notify", ["up:kakao", "store:turso"]),
    ("/api/admin/db", ["store:turso"]),
    ("/api/admin/live", ["store:activity"]),
    ("/api/admin/monitor", ["store:activity"]),
    ("/api/admin/prediction", ["store:turso", "up:claude"]),
    ("/api/admin", ["store:turso"]),
    ("/api/translate", ["store:cache"]),
    ("/api/geo", ["store:cache"]),
]

# Which neuron cluster an endpoint belongs to, by path prefix — the monitor colours and
# spatially groups by this, so related endpoints sit together in the cloud.
_GROUP_BY_PREFIX: list[tuple[str, str]] = [
    ("/api/admin/monitor", "monitor"),
    ("/api/admin", "admin"),
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

    for page_id, calls in PAGE_CALLS.items():
        if page_id not in known:
            warnings.append(f"알 수 없는 페이지 노드: {page_id}")
            continue
        for path in calls:
            target = f"api:{path}"
            if target not in known:
                # The curated table has outlived the route it names. Reported rather than
                # silently dropped — this is exactly the drift the docstring warns about.
                warnings.append(f"사라진 API 경로를 가리키는 연결: {page_id} → {path}")
                continue
            edges.append({"source": page_id, "target": target, "kind": "call"})

    for path in api_nodes:
        for depot in _depends_for(path):
            if depot in known:
                edges.append({"source": f"api:{path}", "target": depot, "kind": "depend"})

    return {"nodes": nodes, "edges": edges, "warnings": warnings}
