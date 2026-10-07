"""Source-derived architecture with independently sampled runtime observations."""
from __future__ import annotations

import ast
import json
import os
import re
import time
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from app.services import api_pulse, system_telemetry

APP_DIR = Path(__file__).resolve().parents[1]
GROUPS = [
    ("market", "증시 · 시세 엔진", "Market intelligence", "#58cfef", "시세·호가·수급·ETF·글로벌 시총·기술 지표"),
    ("community", "뉴스 · 커뮤니티", "News & community", "#b098ff", "뉴스 수집·종목 토론·댓글·번역"),
    ("realestate", "부동산 · 공간 데이터", "Spatial intelligence", "#eeb97e", "실거래·전월세·단지·GIS·건물·3D 지도"),
    ("prediction", "AI 예측 파이프라인", "Prediction pipeline", "#ee8cb9", "특징 추출·정량 지표·Claude·예측 저장·채점"),
    ("operations", "운영 · 방문 분석", "Operations & analytics", "#75d4b0", "활동 로그·방문 통계·관리자·배치·메일·알림"),
    ("support", "후원 · 결제 연동", "Support & payments", "#ffd16d", "후원 페이지·결제 이동·웹훅·후원자·접속 분석"),
]


def group_for(module: str) -> str:
    name = module.rsplit(".", 1)[-1]
    if name.startswith("realestate") or name == "weather_fetcher": return "realestate"
    if name.startswith(("prediction", "ai_analyst", "predictor", "trading_calendar")): return "prediction"
    if name.startswith(("support", "supporter")): return "support"
    if any(s in name for s in ("news", "discussion", "comment", "translate", "translation", "board_fetcher", "toss_session")): return "community"
    if name.startswith(("admin", "monitor", "system_", "site_graph", "api_pulse", "activity", "visitor", "page_view", "device", "hub_event", "bot_", "kakao", "notify", "mail_", "naver_publish", "naver_blog", "naver_session", "naver_document", "naver_map_screenshot", "naver_brief", "seo", "libsql", "turso", "db_browser", "drive_score", "geo")): return "operations"
    return "market"


def host_group(host: str) -> str:
    host = host.lower()
    main_host = urlsplit(os.environ.get("TURSO_DATABASE_URL", "")).hostname
    estate_host = urlsplit(os.environ.get("REALESTATE_TURSO_DATABASE_URL", "")).hostname
    db_hosts = {main_host, estate_host}
    if estate_host and estate_host != main_host and host == estate_host: return "estate-db"
    if host in db_hosts or host.endswith(("turso.io", "turso.tech")): return "database"
    if any(s in host for s in ("anthropic", "claude.ai")): return "ext-ai"
    if any(s in host for s in ("buymeacoffee", "paypal", "stripe", "kakaopay")): return "ext-pay"
    if any(s in host for s in ("kakao", "resend", "blog.naver")): return "ext-delivery"
    if any(s in host for s in ("data.go.kr", "vworld", "openstreetmap", "overpass", "arcgisonline", "open-meteo", "onemap", "sgis", "k-apt", "kapt", "map.naver", "land.naver", "hogangnono", "maps.googleapis")): return "ext-spatial"
    if any(s in host for s in ("news", "bing", "translate", "ip-api", "toss", "search.naver")): return "ext-content"
    if any(s in host for s in ("finance.naver", "stock.naver", "yahoo", "krx", "seibro", "companiesmarketcap", "slickcharts", "trendforce", "feargreedchart", "financialmodelingprep", "wisereport", "stooq", "nasdaq")): return "ext-market"
    return "ext-resources"


@lru_cache(maxsize=1)
def inventory() -> dict:
    modules = []
    known = {"app." + p.relative_to(APP_DIR).with_suffix("").as_posix().replace("/", ".")
             for folder in ("routers", "services", "data") for p in (APP_DIR / folder).glob("*.py")}
    for module in sorted(known):
        path = APP_DIR / (module.removeprefix("app.").replace(".", "/") + ".py")
        source = path.read_text(encoding="utf-8-sig")
        tree = ast.parse(source)
        docstrings = {id(n.body[0].value) for n in ast.walk(tree)
                      if isinstance(n, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
                      and n.body and isinstance(n.body[0], ast.Expr)
                      and isinstance(n.body[0].value, ast.Constant) and isinstance(n.body[0].value.value, str)}
        imports, hosts = set(), set()
        strings = []
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                base = node.module
                if node.level:
                    base = ".".join(module.split(".")[:-node.level]) + "." + base
                if base in known: imports.add(base)
                for alias in node.names:
                    candidate = base + "." + alias.name
                    if candidate in known: imports.add(candidate)
            elif isinstance(node, ast.Import):
                imports.update(alias.name for alias in node.names if alias.name in known)
            elif isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
                strings.append(node.value)
                for host in re.findall(r'https?://([a-zA-Z0-9.-]+)', node.value):
                    if "." in host and host not in {"kospimap.com", "localhost", "127.0.0.1"}: hosts.add(host.lower())
        tables = sorted(set(re.findall(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[\"`\[]?([a-zA-Z_][a-zA-Z0-9_]*)", "\n".join(strings), re.I)))
        modules.append({"id": module, "file": "backend/" + path.relative_to(APP_DIR.parent).as_posix(),
                        "group": group_for(module), "imports": sorted(imports - {module}), "hosts": sorted(hosts),
                        "tables": tables, "cache": bool(re.search(r"cache\.get_or_set|TTLCache\(|@ttl_cache", source))})
    metadata_path = APP_DIR / "data/system_inventory.json"
    frontend = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else {}
    requirements = APP_DIR.parent / "requirements.txt"
    backend = dict(re.findall(r"^([a-zA-Z0-9_.\[\]-]+)==([^\s#]+)", requirements.read_text(encoding="utf-8"), re.M)) if requirements.exists() else {}
    return {"modules": modules, "frontend": frontend, "backend_dependencies": backend}


def architecture(routes) -> dict:
    info = inventory()
    modules = {m["id"]: m for m in info["modules"]}

    def closure(root):
        found, pending = set(), [root]
        while pending:
            name = pending.pop()
            if name in found or name not in modules: continue
            found.add(name)
            # Infrastructure isn't a business dependency; scanning its own imports
            # would make every route depend on the entire monitored application.
            if name.rsplit(".", 1)[-1] in {"system_atlas", "system_health", "site_graph", "db_browser", "admin_auth"}: continue
            pending.extend(modules[name]["imports"])
        return sorted(found)

    endpoints = []
    for route in routes:
        path = getattr(route, "path", "")
        if not path.startswith("/api") or not hasattr(route, "endpoint"): continue
        module = route.endpoint.__module__
        endpoints.append({"path": path, "methods": sorted(getattr(route, "methods", []) - {"HEAD", "OPTIONS"}),
                          "group": group_for(module), "module": module, "function": route.endpoint.__name__,
                          "dependencies": closure(module)})
    nodes = [
        {"id": "client", "label": "웹 · 모바일 클라이언트", "subtitle": "React 18 · TypeScript · Vite", "kind": "client", "color": "#58cfef", "description": "자체 History 라우터·페이지 코드 분할·가시성 기반 HTTP 폴링"},
        {"id": "graphics", "label": "차트 · 3D 렌더링", "subtitle": "ECharts · Three.js · Workers", "kind": "client", "color": "#b098ff", "description": "lightweight-charts·ECharts·Three.js·WebGL/WebGPU·Web Workers 렌더링 경로"},
        {"id": "gateway", "label": "FastAPI · ASGI 게이트웨이", "subtitle": "Uvicorn · REST · GZip · ETag", "kind": "gateway", "color": "#75d4b0", "description": "HTTP 라우팅·인증·응답 검증·API 요청 시간 관측·정적 SPA 서빙"},
        *[{"id": key, "label": label, "subtitle": sub, "kind": "service", "color": color, "description": desc} for key, label, sub, color, desc in GROUPS],
        {"id": "cache", "label": "인메모리 TTL 캐시", "subtitle": "Single-flight · SWR · LRU", "kind": "storage", "color": "#75d4b0", "description": "최대 20,000 키·만료 데이터 우선 제공·백그라운드 재검증·단일 프로세스 캐시"},
        {"id": "database", "label": "Turso · SQLite 저장소", "subtitle": "HTTPS /v2/pipeline · SQL", "kind": "storage", "color": "#b098ff", "description": "원격 Turso가 설정되면 Hrana HTTP 파이프라인, 미설정 시 로컬 SQLite 파일"},
        {"id": "estate-db", "label": "부동산 데이터 저장소", "subtitle": "실거래 · 전월세 · 단지 이력", "kind": "storage", "color": "#eeb97e", "description": "부동산 전용 Turso 설정 지원·공유 DB 또는 로컬 fallback·백그라운드 이전 상태"},
    ]
    ext_labels = {"ext-market": ("시세 · 금융 데이터", "Naver · Yahoo · KRX · FDR", "#58cfef"),
                  "ext-content": ("뉴스 · 번역 · 커뮤니티", "Toss · Bing · Google · IP", "#b098ff"),
                  "ext-spatial": ("공공 데이터 · 지도", "MOLIT · VWorld · OSM", "#eeb97e"),
                  "ext-ai": ("Claude 분석", "CLI subscription / API", "#ee8cb9"),
                  "ext-delivery": ("메일 · 알림 · 발행", "Resend · SMTP · Kakao · Naver", "#75d4b0"),
                  "ext-pay": ("외부 후원 · 결제", "Buy Me a Coffee · KakaoPay", "#ffd16d"),
                  "ext-resources": ("외부 리소스 · 링크", "CDN · Media · Social · Assets", "#8ca6c3")}
    for key, (label, sub, color) in ext_labels.items():
        hosts = sorted({h for m in modules.values() for h in m["hosts"] if host_group(h) == key} |
                       {h for ref in info["frontend"].get("external", []) for h in ref["hosts"] if host_group(h) == key})
        nodes.append({"id": key, "label": label, "subtitle": sub, "kind": "external", "color": color,
                      "description": "외부 요청의 호스트·상태·시간만 기록하며 키·쿠키·본문은 수집하지 않습니다.", "hosts": hosts})
    edges = {}

    def edge(source, target, protocol, evidence):
        key = (source, target)
        if key not in edges: edges[key] = {"id": source + ":" + target, "source": source, "target": target,
                                         "protocol": protocol, "evidence": evidence, "kind": "declared"}

    edge("client", "gateway", "HTTPS / JSON", "프런트엔드 /api 요청")
    edge("graphics", "client", "UI / Worker", "프런트엔드 의존성·Worker 파일")
    for target in {host_group(h) for ref in info["frontend"].get("external", []) for h in ref["hosts"]}:
        if target.startswith("ext-"): edge("client", target, "Browser / link / asset", "TypeScript AST의 외부 URL 참조 (링크·리소스 포함)")
    for key, *_ in GROUPS:
        group_modules = [m for m in modules.values() if m["group"] == key]
        edge("gateway", key, "REST", "실제 FastAPI 라우트 테이블")
        deps = {d for m in group_modules for d in m["imports"]} | {m["id"] for m in group_modules}
        if any(modules[d]["cache"] for d in deps if d in modules): edge(key, "cache", "TTL / SWR", "소스의 캐시 호출")
        if any(modules[d]["tables"] for d in deps if d in modules):
            edge(key, "estate-db" if key == "realestate" else "database", "SQL / Hrana", "소스의 CREATE TABLE·저장소 import")
        hosts = {h for d in deps if d in modules for h in modules[d]["hosts"]}
        for target in {host_group(h) for h in hosts}:
            if target.startswith("ext-"): edge(key, target, "HTTPS", "소스 URL 호스트·import (분산 추적 아님)")
    # Non-requests transports are declared rather than pretending HTTP timings cover them.
    edge("prediction", "ext-ai", "CLI / SDK", "ai_analyst.py: Claude CLI / Anthropic SDK")
    edge("operations", "ext-delivery", "HTTPS / SMTP / Browser", "prediction_mail.py·kakao_notify.py·naver_publisher.py")
    for node in nodes:
        node["modules"] = [m["id"] for m in modules.values() if m["group"] == node["id"]]
        node["endpoint_count"] = sum(e["group"] == node["id"] for e in endpoints)
        if node["id"] == "gateway":
            node["endpoint_count"] = len(endpoints)
            node["modules"] = sorted({e["module"] for e in endpoints if e["module"] in modules})
        if node["id"] == "database": node["tables"] = sorted({t for m in modules.values() if not m["id"].endswith("realestate_store") for t in m["tables"]})
        if node["id"] == "estate-db": node["tables"] = sorted({t for m in modules.values() if m["id"].endswith("realestate_store") for t in m["tables"]})
    return {"nodes": nodes, "edges": list(edges.values()), "endpoints": endpoints, **info,
            "coverage": {"architecture": "실제 라우트 + Python AST import·URL·테이블 선언 + 빌드 시 프런트엔드 목록",
                         "traffic": "현재 Python 프로세스의 API 요청 / requests HTTPAdapter 호출 / 요청 ContextVar 연결",
                         "limitations": ["실선은 소스 의존성, 이동 신호는 실제 API 활동과 요청에 연결된 HTTP 호출입니다. 프로세스 외부의 분산 추적이나 SQL 인과관계는 포함하지 않습니다.",
                                         "Claude CLI·httpx SDK, SMTP, 브라우저 직접 요청, 외부 결제 페이지 내부 트래픽은 HTTP 관측 범위 밖입니다.",
                                         "API·외부 HTTP는 제한된 메모리 버퍼의 최근 60초 표본입니다. 재시작하면 초기화됩니다.",
                                         "테이블은 소스의 스키마 선언입니다. 실제 DB의 테이블·행 조회는 DB 콘솔에서 확인합니다."]}}


def live_snapshot(routes) -> dict:
    now = time.time()
    graph = architecture(routes)
    retained, _ = api_pulse.since(0, api_pulse.TAIL_MAXLEN)
    events = [e for e in retained if now - 60 <= e["ts"] <= now and not e["route"].startswith("/api/admin/atlas")]
    grouped = defaultdict(list)
    route_groups = {e["path"]: e["group"] for e in graph["endpoints"]}
    for event in events: grouped[route_groups.get(event["route"], "operations")].append(event)
    external = system_telemetry.snapshot(now)
    request_calls = external.pop("request_calls")
    # Resolve using the running environment, including dedicated estate DB hosts.
    # Copy rather than mutating the shared observer's retained events.
    external["recent"] = [{**e, "target": host_group(e["host"])} for e in external["recent"]]
    traces = []
    for event in events[-60:][::-1]:
        if not event.get("trace_id"):
            continue
        calls = [{**e, "target": host_group(e["host"])} for e in request_calls.get(event["trace_id"], [])]
        traces.append({"request": event, "calls": calls[:30], "external_count": len(calls),
                       "calls_truncated": len(calls) > 30})
    endpoints = [{"path": path, "method": method, **system_telemetry.stats([e for e in events if e["route"] == path and e["method"] == method])}
                 for path, method in sorted({(e["route"], e["method"]) for e in events})]
    observed_edges = defaultdict(int)
    for flow in external["flows"]:
        source = route_groups.get(flow["route"])
        if source:
            observed_edges[source + ":" + host_group(flow["host"])] += flow["count"]
    from app.services.cache import cache, MAX_ENTRIES
    with cache._lock:
        expiry = [v[0] for v in cache._store.values()]
        cache_state = {"entries": len(expiry), "fresh": sum(t > now for t in expiry), "stale": sum(t <= now for t in expiry),
                       "refreshing": len(cache._refreshing), "capacity": MAX_ENTRIES}
    from app.services import realestate_store, activity_log
    db_mode = "turso" if os.environ.get("TURSO_DATABASE_URL") else "sqlite"
    return {"at": now, "api": {**system_telemetry.stats(events), "window_s": 60,
                               "window_truncated": len(retained) == api_pulse.TAIL_MAXLEN and retained[0]["ts"] > now - 60,
                               "groups": {key: system_telemetry.stats(value) for key, value in grouped.items()},
                               "breakdown": system_telemetry.breakdown(events, now),
                               "endpoints": endpoints, "recent": events[-60:][::-1]},
            "external": external, "traces": traces, "cache": cache_state,
            "observed_edges": dict(observed_edges),
            "database": {"mode": db_mode, "separate_realestate": realestate_store.SEPARATE,
                         "realestate_mode": "turso" if realestate_store.TURSO_DATABASE_URL else "sqlite"},
            "active_sessions": len(activity_log.active_sessions())}
