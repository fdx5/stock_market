import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { AdminAuthError, AdminHealth, clearStoredSession, getStoredSession } from "../adminApi";
import { Link, navigate } from "../router";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { useDocumentTitle } from "../useDocumentTitle";
import Icon from "./SystemAtlasIcon";
import { atlasApi, AtlasArchitecture, AtlasEdge, AtlasEndpoint, AtlasNode, AtlasSnapshot, AtlasStats } from "./systemAtlasApi";
import "./adminSystemAtlas.css";

type View = "topology" | "api" | "storage" | "stack";
type DetailTab = "overview" | "endpoints" | "modules" | "connections";
type History = { at: number; count: number; latency: number | null; external: number; memory: number | null };
const EMPTY: AtlasStats = { count: 0, errors: 0, client_errors: 0, avg_ms: null, last_at: null };
const POS: Record<string, [number, number]> = {
  client: [24, 207], graphics: [24, 311], gateway: [266, 259],
  market: [514, 60], community: [514, 146], realestate: [514, 232], prediction: [514, 318], operations: [514, 404], support: [514, 490],
  cache: [770, 115], database: [770, 302], "estate-db": [770, 489],
  "ext-market": [1026, 60], "ext-content": [1026, 146], "ext-spatial": [1026, 232], "ext-ai": [1026, 318], "ext-delivery": [1026, 404], "ext-pay": [1026, 490],
  "ext-resources": [24, 475],
};
const NODE_W = 208, NODE_H = 72;
const time = (ts?: number | null) => ts ? new Date(ts * 1000).toLocaleTimeString("ko-KR", { hour12: false, timeZone: "Asia/Seoul" }) : "—";
const ms = (v?: number | null) => v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`;
const number = (n?: number | null) => n == null ? "—" : n.toLocaleString("ko-KR");
const colorStyle = (color: string) => ({ "--node-color": color } as CSSProperties);

function nodeStats(node: AtlasNode, live: AtlasSnapshot | null): AtlasStats {
  if (!live) return EMPTY;
  if (node.kind === "service") return live.api.groups[node.id] || EMPTY;
  if (node.id === "gateway") return live.api;
  if (node.kind === "external" || node.id === "database" || node.id === "estate-db") return live.external.groups[node.id] || EMPTY;
  return EMPTY;
}

function Sparkline({ values, color = "#58cfef", height = 62, fill = false }: { values: (number | null)[]; color?: string; height?: number; fill?: boolean }) {
  const max = Math.max(1, ...values.filter((v): v is number => v !== null));
  const points = values.map((v, i) => v === null ? null : [i / Math.max(1, values.length - 1) * 300, height - 5 - v / max * (height - 13)]);
  const segments: number[][][] = []; let current: number[][] = [];
  points.forEach(p => { if (p) current.push(p); else if (current.length) { segments.push(current); current = []; } });
  if (current.length) segments.push(current);
  return <svg className="sa-spark" viewBox={`0 0 300 ${height}`} preserveAspectRatio="none" role="img" aria-label="실제 관측 표본 추이">
    {[.25, .5, .75].map(y => <line key={y} x1="0" x2="300" y1={height * y} y2={height * y} stroke="#ffffff0a"/>)}
    {segments.map((segment, i) => <g key={i}>{fill && segment.length > 1 && <path d={`M${segment[0][0]},${height} L${segment.map(p => p.join(",")).join(" L")} L${segment[segment.length - 1][0]},${height}Z`} fill={color} opacity=".09"/>}
      <polyline points={segment.map(p => p.join(",")).join(" ")} stroke={color} strokeWidth="2" fill="none" vectorEffect="non-scaling-stroke"/>
      {segment.length === 1 && <circle cx={segment[0][0]} cy={segment[0][1]} r="2" fill={color}/>}</g>)}
  </svg>;
}

function Topology({ graph, live, health, selected, onSelect, onEdge, focus, query, zoom, paused, stale }: {
  graph: AtlasArchitecture; live: AtlasSnapshot | null; selected: string; onSelect: (id: string) => void; onEdge: (edge: AtlasEdge) => void;
  focus: boolean; query: string; zoom: number; paused: boolean; stale: boolean;
  health: AdminHealth | null;
}) {
  const near = new Set([selected, ...graph.edges.filter(e => e.source === selected || e.target === selected).flatMap(e => [e.source, e.target])]);
  const matches = (n: AtlasNode) => !query || `${n.label} ${n.subtitle} ${n.modules.join(" ")} ${(n.hosts || []).join(" ")}`.toLowerCase().includes(query.toLowerCase());
  const opaque = (id: string) => { const n = graph.nodes.find(n => n.id === id); return (!focus || near.has(id)) && (!n || matches(n)); };
  return <div className={`sa-map-scroll ${paused || stale ? "is-paused" : ""}`}>
    <svg className="sa-map" style={{ width: `${zoom}%`, height: `${zoom}%` }} viewBox="0 0 1260 610" role="group" aria-label="클라이언트에서 API, 서비스, 저장소, 외부 연동으로 이어지는 시스템 지도">
      <defs><pattern id="sa-dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#96b5cf" opacity=".14"/></pattern>
        <linearGradient id="sa-lane" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#96b5cf" stopOpacity=".025"/><stop offset="1" stopColor="#96b5cf" stopOpacity="0"/></linearGradient>
      </defs>
      <rect width="1260" height="610" fill="url(#sa-dots)"/>
      {[[24, "01", "CLIENT EXPERIENCE"], [266, "02", "API GATEWAY"], [514, "03", "SERVICE DOMAINS"], [770, "04", "DATA & CACHE"], [1026, "05", "EXTERNAL SYSTEMS"]].map(([x, n, label]) => <g key={n}>
        <rect x={Number(x) - 10} y="45" width="228" height="534" rx="12" fill="url(#sa-lane)"/>
        <text x={x} y="26" className="sa-lane-no">{n}</text><text x={Number(x) + 26} y="26" className="sa-lane-label">{label}</text>
      </g>)}
      {graph.edges.map((edge, index) => {
        const from = POS[edge.source], to = POS[edge.target]; if (!from || !to) return null;
        const source = graph.nodes.find(n => n.id === edge.source)!;
        const target = graph.nodes.find(n => n.id === edge.target)!;
        const sameLane = from[0] === to[0], reverse = to[0] < from[0], downward = to[1] > from[1];
        const sx = from[0] + (sameLane ? NODE_W / 2 : reverse ? 0 : NODE_W), sy = from[1] + (sameLane ? downward ? NODE_H : 0 : NODE_H / 2);
        const tx = to[0] + (sameLane ? NODE_W / 2 : reverse ? NODE_W : 0), ty = to[1] + (sameLane ? downward ? 0 : NODE_H : NODE_H / 2);
        const gap = Math.max(32, Math.abs(tx - sx) * .46);
        // Long provider links travel through the gap beside data cards, keeping
        // source and target ports legible without hiding connections behind cards.
        const d = sameLane ? `M${sx},${sy} L${tx},${ty}` : `M${sx},${sy} C${sx + (reverse ? -gap : gap)},${sy} ${tx + (reverse ? gap : -gap)},${ty} ${tx},${ty}`;
        const related = edge.source === selected || edge.target === selected;
        const observed = !paused && !stale && (target.kind === "external" || target.id === "database" || target.id === "estate-db" ? (live?.observed_edges[edge.id] || 0) > 0 : source.kind === "gateway" ? nodeStats(target, live).count > 0 : false);
        const visible = opaque(edge.source) && opaque(edge.target);
        return <g key={edge.id} className={`sa-edge ${related ? "is-related" : ""}`} opacity={visible ? 1 : .07}>
          <path d={d} stroke={source.color} strokeWidth={related ? 2 : 1} strokeOpacity={related ? .75 : .22} fill="none"/>
          {observed && visible && <path className="sa-signal" d={d} stroke={source.color} strokeWidth="2.5" strokeDasharray="4 42" style={{ animationDelay: `${index * -.17}s` }} fill="none"/>}
          <path className="sa-edge-hit" d={d} fill="none" stroke="transparent" strokeWidth="12" onClick={() => onEdge(edge)} tabIndex={visible ? 0 : -1} role="button" aria-label={`${source.label} → ${target.label} 연결 상세`} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEdge(edge); } }}><title>{source.label} → {target.label} · {edge.protocol}</title></path>
        </g>;
      })}
      {graph.nodes.map(node => {
        const pos = POS[node.id]; if (!pos) return null;
        const stats = nodeStats(node, live), selectedNode = selected === node.id;
        const subtitle = node.id === "cache" ? live ? `${number(live.cache.entries)} keys · ${live.cache.refreshing} 갱신 중` : node.subtitle : node.id === "database" ? live ? `${live.database.mode.toUpperCase()} · ${node.tables?.length || 0} table declarations` : node.subtitle : node.subtitle;
        const badge = node.kind === "service" ? `${node.endpoint_count} API` : node.id === "ext-ai" ? "CLI / SDK" : node.kind === "external" ? `${node.hosts?.length || 0} hosts` : node.id === "gateway" ? `${graph.endpoints.length} routes` : node.id === "client" ? `${graph.frontend.routes?.length || 0} pages` : node.id === "graphics" ? `${graph.frontend.workers?.length || 0} workers/shaders` : "DATA";
        const dbDown = node.id === "database" && health && !health.db.ok;
        const state = stale ? "stale" : dbDown || stats.errors ? "error" : stats.client_errors ? "warn" : stats.count || node.id === "database" && health?.db.ok || node.id === "cache" && live?.cache.refreshing ? "active" : "idle";
        return <g key={node.id} transform={`translate(${pos[0]},${pos[1]})`} opacity={opaque(node.id) ? 1 : .14} className={`sa-node ${selectedNode ? "is-selected" : ""}`} style={colorStyle(node.color)} tabIndex={0} role="button" aria-label={`${node.label} 상세 보기`} aria-pressed={selectedNode} onClick={() => onSelect(node.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(node.id); } }}>
          {selectedNode && <rect className="sa-node-aura" x="-5" y="-5" width={NODE_W + 10} height={NODE_H + 10} rx="14"/>}
          <rect className="sa-node-body" width={NODE_W} height={NODE_H} rx="9"/>
          <rect x="0" y="16" width="2" height="46" rx="1" fill={node.color}/>
          <rect x="13" y="13" width="29" height="29" rx="8" fill={node.color} fillOpacity=".09"/>
          <foreignObject x="18" y="18" width="20" height="20"><span style={{ color: node.color }}><Icon name={node.kind === "external" ? "external" : node.id === "estate-db" ? "database" : node.id} size={19}/></span></foreignObject>
          <text x="51" y="26" className="sa-node-title">{node.label}</text>
          <text x="51" y="41" className="sa-node-sub">{badge}</text>
          <circle cx="194" cy="18" r="3" className={`sa-status-${state}`}/>
          <text x="14" y="61" className="sa-node-sub">{subtitle.length > 35 ? subtitle.slice(0, 34) + "…" : subtitle}</text>
          {stats.count > 0 && <text x="194" y="41" textAnchor="end" className="sa-node-traffic" fill={node.color}>{stats.count}</text>}
        </g>;
      })}
      <g transform="translate(25,597)"><circle r="2.5" fill="#75d4b0"/><text x="9" y="3" className="sa-map-note">실선: 소스 의존성 · 이동 신호: 실제 API 요청 / 요청에 연결된 외부 HTTP (프로세스 내부 관측)</text></g>
    </svg>
  </div>;
}

function EndpointList({ endpoints, live, select, limit }: { endpoints: AtlasEndpoint[]; live: AtlasSnapshot | null; select: (endpoint: AtlasEndpoint) => void; limit?: number }) {
  return <div className="sa-endpoints">{endpoints.slice(0, limit).map(endpoint => {
    const stats = live?.api.endpoints.find(e => e.path === endpoint.path);
    return <button key={`${endpoint.path}-${endpoint.methods.join()}`} className="sa-endpoint" onClick={() => select(endpoint)}>
      <span className={`sa-method ${endpoint.methods[0] === "GET" ? "is-get" : ""}`}>{endpoint.methods.join("/")}</span>
      <span className="sa-endpoint-path">{endpoint.path}<small>{endpoint.function} · {endpoint.dependencies.length} dependencies</small></span>
      <span className={stats?.errors ? "sa-red" : "sa-endpoint-ms"}>{ms(stats?.avg_ms)}<small>{stats ? `${stats.count} calls` : "미관측"}</small></span>
    </button>;
  })}{endpoints.length === 0 && <p className="sa-empty">해당하는 API가 없습니다.</p>}</div>;
}

function Inspector({ node, edge, endpoint, graph, live, health, onSelect, onEndpoint, tab, setTab }: {
  node: AtlasNode; edge: AtlasEdge | null; endpoint: AtlasEndpoint | null; graph: AtlasArchitecture; live: AtlasSnapshot | null; health: AdminHealth | null;
  onSelect: (id: string) => void; onEndpoint: (e: AtlasEndpoint | null) => void; tab: DetailTab; setTab: (t: DetailTab) => void;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => setQuery(""), [node.id]);
  const stats = nodeStats(node, live);
  const connections = graph.edges.filter(e => e.source === node.id || e.target === node.id);
  const endpoints = graph.endpoints.filter(e => (node.id === "gateway" || e.group === node.id) && `${e.path} ${e.function}`.toLowerCase().includes(query.toLowerCase()));
  const modules = graph.modules.filter(m => node.modules.includes(m.id) && `${m.id} ${m.file}`.toLowerCase().includes(query.toLowerCase()));
  const neighbors = connections.map(e => graph.nodes.find(n => n.id === (e.source === node.id ? e.target : e.source))!).filter(Boolean);
  const tabs: [DetailTab, string][] = [["overview", "개요"], ["endpoints", "API"], ["modules", "모듈"], ["connections", "연결"]];
  return <aside className="sa-inspector" style={colorStyle(node.color)} aria-label="선택 영역 상세">
    <div className="sa-inspector-label"><span>COMPONENT INSPECTOR</span><span className="sa-index">{String(graph.nodes.indexOf(node) + 1).padStart(2, "0")}</span></div>
    <div className="sa-inspector-title"><span className="sa-big-icon"><Icon name={node.kind === "external" ? "external" : node.id === "estate-db" ? "database" : node.id} size={26}/></span><div><h2>{node.label}</h2><p>{node.subtitle}</p></div></div>
    <p className="sa-description">{node.description}</p>
    <div className="sa-inspector-metrics"><div><span>최근 60초 호출</span><b>{number(stats.count)}</b></div><div><span>평균 응답</span><b>{ms(stats.avg_ms)}</b></div><div><span>5xx / 전송 실패</span><b className={stats.errors ? "sa-red" : ""}>{stats.errors}</b></div></div>
    <nav className="sa-detail-tabs" aria-label="영역 상세 탭">{tabs.map(([key, label]) => <button key={key} onClick={() => { setTab(key); onEndpoint(null); }} aria-selected={tab === key} role="tab">{label}{key === "connections" && <small>{connections.length}</small>}</button>)}</nav>
    <div className="sa-detail-content">
      {edge && <section className="sa-detail-section sa-edge-detail"><h3>선택한 연결</h3><b>{graph.nodes.find(n => n.id === edge.source)?.label}</b><span>↓ {edge.protocol}</span><b>{graph.nodes.find(n => n.id === edge.target)?.label}</b><p>{edge.evidence}</p><small>소스 의존성 · 요청별 인과관계 추적 아님</small></section>}
      {endpoint ? <section className="sa-detail-section">
        <button className="sa-text-button" onClick={() => onEndpoint(null)}>← API 목록</button>
        <h3>{endpoint.methods.join(" · ")}</h3><code className="sa-code-path">{endpoint.path}</code>
        <p>{endpoint.module}<br/>{endpoint.function}()</p>
        <h3>실제 요청 · 외부 HTTP 흐름</h3>
        {(live?.api.recent.filter(e => e.route === endpoint.path && e.trace_id).slice(0, 3) || []).map(request => {
          const calls = live?.external.recent.filter(e => e.trace_id === request.trace_id).slice().reverse() || [];
          return <div key={request.id} className="sa-request-trace"><header><span>REQUEST #{request.trace_id} · {time(request.ts)}</span><b>{ms(request.ms)}</b></header><div><code>{request.method} → API</code><small className={request.status >= 400 ? "sa-red" : "sa-green"}>{request.status}</small></div>{calls.map(call => <div key={call.id}><code>↳ {call.host}</code><small className={call.status === 0 || call.status >= 400 ? "sa-red" : ""}>{call.status || "ERR"} · {ms(call.ms)}</small></div>)}{!calls.length && <p>보존된 표본에 연결된 외부 HTTP 호출이 없습니다. 캐시 응답 또는 관측 범위 밖의 전송일 수 있습니다.</p>}</div>;
        })}
        {!live?.api.recent.some(e => e.route === endpoint.path && e.trace_id) && <p>이 API의 요청 표본이 아직 없거나 최근 표시 버퍼에서 제외되었습니다.</p>}
        <h3>의존성 세부 흐름</h3><div className="sa-dependency-flow"><div>HTTP 요청</div><i>↓</i><div>{endpoint.module.replace("app.routers.", "router / ")}</div><i>↓ import</i>
          {endpoint.dependencies.map(id => <div key={id} className="sa-flow-module">{id.replace("app.", "")}</div>)}<i>↓ 선언된 데이터 연동</i>
          {[...new Set(graph.modules.filter(m => endpoint.dependencies.includes(m.id)).flatMap(m => m.hosts))].map(host => <div key={host} className="sa-flow-host">{host}</div>)}
        </div><small>정적 import 의존성: 이 요청에서 모든 모듈이 실행된다는 의미는 아닙니다.</small>
      </section> : <>
        {tab === "overview" && <>
          <section className="sa-detail-section"><h3>연동 구조 <span>{connections.length} connections</span></h3><div className="sa-mini-network"><span className="sa-mini-core"><Icon name="atlas" size={26}/></span>{neighbors.slice(0, 6).map((n, i) => <button key={n.id} style={{ left: `${50 + Math.cos(i / Math.min(neighbors.length, 6) * Math.PI * 2 - Math.PI / 2) * 39}%`, top: `${50 + Math.sin(i / Math.min(neighbors.length, 6) * Math.PI * 2 - Math.PI / 2) * 34}%`, ...colorStyle(n.color) }} onClick={() => onSelect(n.id)} title={n.label}><Icon name={n.kind === "external" ? "external" : n.id === "estate-db" ? "database" : n.id} size={18}/><small>{n.label.split(" · ")[0]}</small></button>)}<svg viewBox="0 0 300 174" preserveAspectRatio="none" aria-hidden="true">{neighbors.slice(0, 6).map((n, i) => <line key={n.id} x1="150" y1="87" x2={150 + Math.cos(i / Math.min(neighbors.length, 6) * Math.PI * 2 - Math.PI / 2) * 117} y2={87 + Math.sin(i / Math.min(neighbors.length, 6) * Math.PI * 2 - Math.PI / 2) * 59} stroke={n.color} strokeOpacity=".4" strokeDasharray="3 4"/>)}</svg></div></section>
          <section className="sa-detail-section"><h3>구성 정보</h3><dl className="sa-facts"><div><dt>영역 유형</dt><dd>{node.kind}</dd></div><div><dt>등록 API</dt><dd>{node.endpoint_count}</dd></div><div><dt>소스 모듈</dt><dd>{node.modules.length}</dd></div><div><dt>최근 관측</dt><dd>{time(stats.last_at)}</dd></div><div><dt>4xx 응답</dt><dd>{stats.client_errors}</dd></div></dl></section>
          {node.id === "realestate" && <section className="sa-detail-section"><h3>실거래 데이터 수집 상태</h3><dl className="sa-facts"><div><dt>API 키 설정</dt><dd>{health?.realestate.configured === undefined ? "확인 중" : health.realestate.configured ? "설정됨" : "미설정"}</dd></div><div><dt>오늘 매매 / 전월세</dt><dd>{number(health?.realestate.calls_today)} / {number(health?.realestate.calls_today_rent)}</dd></div><div><dt>수집 / 대기 지역</dt><dd>{health?.realestate.collecting || "대기"} / {number(health?.realestate.queued_districts)}</dd></div><div><dt>일일 호출 한도</dt><dd>{number(health?.realestate.daily_limit)}</dd></div></dl><p>최근 이력 확보율 {health?.realestate.recent_coverage === undefined ? "—" : `${Math.round(health.realestate.recent_coverage * 100)}%`}</p><div className="sa-progress-track"><i style={{ width: `${(health?.realestate.recent_coverage || 0) * 100}%` }}/></div>{health?.realestate.last_error && <p className="sa-mini-error">{health.realestate.last_error}</p>}</section>}
          {node.id === "operations" && <section className="sa-detail-section"><h3>서버 · 최근 경고 및 오류</h3><dl className="sa-facts"><div><dt>프로세스 메모리</dt><dd>{number(health?.memory_mb)} MB</dd></div><div><dt>최근 1시간 오류 / 경고</dt><dd>{number(health?.errors_last_hour)} / {number(health?.warnings_last_hour)}</dd></div></dl>{health?.logs.slice(0, 12).map((log, i) => <div className="sa-log-row" key={i}><time>{log.at}</time><b className={log.level === "ERROR" ? "sa-red" : ""}>{log.level}</b> · {log.logger}<p>{log.message}</p></div>)}</section>}
          {node.kind === "storage" && <section className="sa-detail-section"><h3>{node.id === "cache" ? "실시간 캐시 분포" : "스키마 선언"}</h3>{node.id === "cache" ? <><div className="sa-distribution"><i style={{ width: `${live ? live.cache.fresh / Math.max(1, live.cache.entries) * 100 : 0}%` }}/></div><dl className="sa-facts"><div><dt>유효 / 만료</dt><dd>{number(live?.cache.fresh)} / {number(live?.cache.stale)}</dd></div><div><dt>백그라운드 갱신</dt><dd>{number(live?.cache.refreshing)}</dd></div><div><dt>최대 키 수</dt><dd>{number(live?.cache.capacity)}</dd></div></dl></> : <><div className="sa-table-chips">{node.tables?.map(t => <span key={t}>{t}</span>)}</div><p>소스의 CREATE TABLE 선언 · 실제 테이블과 행 수는 DB 콘솔에서 확인</p><Link to="/admin/db" className="sa-text-button">DB 콘솔 열기 ↗</Link>{node.id === "database" && <p>공유 DB 최근 점검: {health ? health.db.ok ? `응답 ${health.db.ms}ms` : "응답 실패" : "확인 중"}</p>}{node.id === "estate-db" && <p>{live?.database.separate_realestate ? "전용 DB 사용" : "공유 DB / 로컬 저장소"} · 전용 DB 직접 ping은 수행하지 않습니다.</p>}</>}</section>}
          {node.kind === "external" && <section className="sa-detail-section"><h3>소스에서 발견된 호스트</h3>{node.hosts?.map(host => { const observed = live?.external.hosts.find(h => h.host === host); return <div className="sa-host" key={host}><code>{host}</code><span>{observed ? ms(observed.avg_ms) : "미관측"}</span></div>; })}<p>requests HTTP만 관측. CLI·SMTP·브라우저·SDK 호출은 미관측일 수 있습니다.</p></section>}
          {node.id === "client" && <section className="sa-detail-section"><h3>프런트엔드 페이지</h3><div className="sa-table-chips">{graph.frontend.routes?.map(p => <span key={p}>{p}</span>)}</div><p>정적 라우트 목록 · 파라미터 경로는 App.tsx에서 별도 처리</p></section>}
          {node.id === "graphics" && <section className="sa-detail-section"><h3>Workers · shaders</h3>{graph.frontend.workers?.map(file => <code className="sa-file" key={file}>{file.replace("frontend/src/", "")}</code>)}</section>}
          {node.id === "operations" && <section className="sa-detail-section"><h3>자동 실행 스케줄 · UTC</h3>{graph.frontend.schedules?.map(s => <div className="sa-schedule" key={s.file}><b>{s.file}</b>{s.cron.map(c => <code key={c}>{c}</code>)}</div>)}</section>}
        </>}
        {(tab === "endpoints" || tab === "modules") && <label className="sa-search sa-detail-search"><Icon name="search" size={14}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder={tab === "endpoints" ? "API 경로 검색" : "모듈 검색"}/></label>}
        {tab === "endpoints" && <EndpointList endpoints={endpoints} live={live} select={onEndpoint}/>}
        {tab === "modules" && <div className="sa-modules">{modules.map(m => <details key={m.id}><summary><Icon name="code" size={15}/>{m.id.replace("app.", "")}<small>{m.imports.length}</small></summary><code className="sa-file">{m.file}</code><h4>imports</h4>{m.imports.map(i => <code className="sa-file" key={i}>{i}</code>)}{m.hosts.length > 0 && <h4>외부 호스트</h4>}{m.hosts.map(h => <code className="sa-file" key={h}>{h}</code>)}{m.tables.length > 0 && <p>TABLES · {m.tables.join(", ")}</p>}</details>)}{modules.length === 0 && <p className="sa-empty">이 영역은 API 모듈 그룹이 아닙니다. 개요에서 기술·저장소 정보를 확인하세요.</p>}</div>}
        {tab === "connections" && <div className="sa-connections">{connections.map(e => { const n = graph.nodes.find(n => n.id === (e.source === node.id ? e.target : e.source))!; return <button key={e.id} onClick={() => onSelect(n.id)} style={colorStyle(n.color)}><span>{e.source === node.id ? "OUT →" : "← IN"}</span><b>{n.label}</b><small>{e.protocol} · {e.evidence}</small></button>; })}</div>}
      </>}
    </div>
    <footer className="sa-inspector-foot"><Icon name="info" size={14}/>소스 구조와 실제 관측을 함께 표시합니다.</footer>
  </aside>;
}

export default function AdminSystemAtlasPage() {
  useDocumentTitle("시스템 아틀라스 · 관리자");
  const [graph, setGraph] = useState<AtlasArchitecture | null>(null);
  const [live, setLive] = useState<AtlasSnapshot | null>(null);
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [error, setError] = useState<string | null>(null), [healthError, setHealthError] = useState<string | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [selected, setSelected] = useState("gateway"), [edge, setEdge] = useState<AtlasEdge | null>(null), [endpoint, setEndpoint] = useState<AtlasEndpoint | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview"), [view, setView] = useState<View>("topology");
  const [paused, setPaused] = useState(false), [focus, setFocus] = useState(false), [query, setQuery] = useState(""), [zoom, setZoom] = useState(100);
  const [refresh, setRefresh] = useState(0), [range, setRange] = useState(5), [eventFilter, setEventFilter] = useState("all");
  const [now, setNow] = useState(Date.now() / 1000);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!getStoredSession()) { navigate("/admin"); return; }
    let gone = false;
    atlasApi.architecture().then(g => { if (!gone) { setGraph(g); setGraphError(null); } }).catch(e => { if (!gone) { if (e instanceof AdminAuthError) { clearStoredSession(); navigate("/admin"); } else setGraphError(`구조 조회 실패: ${e.message}`); } });
    return () => { gone = true; };
  }, [refresh]);
  useEffect(() => {
    if (!getStoredSession() || paused) return;
    let gone = false, loading = false, checking = false;
    const failed = (e: unknown) => { if (e instanceof AdminAuthError) { clearStoredSession(); navigate("/admin"); return true; } return false; };
    const load = async () => {
      if (loading) return; loading = true;
      try { const data = await atlasApi.snapshot(); if (!gone) { setLive(data); setError(null); setHistory(rows => [...rows, { at: data.at, count: data.api.count, latency: data.api.p95_ms ?? null, external: data.external.count, memory: null }].slice(-240)); } }
      catch (e) { if (!gone && !failed(e)) setError(`실시간 갱신 실패: ${e instanceof Error ? e.message : String(e)}`); }
      finally { loading = false; }
    };
    const check = async () => {
      if (checking) return; checking = true;
      try { const data = await atlasApi.health(); if (!gone) { setHealth(data); setHealthError(null); } }
      catch (e) { if (!gone && !failed(e)) setHealthError(`DB·서버 점검 실패: ${e instanceof Error ? e.message : String(e)}`); }
      finally { checking = false; }
    };
    void load(); void check();
    const stop = startVisibilityAwareInterval(() => void load(), 3000);
    const stopHealth = startVisibilityAwareInterval(() => void check(), 15000);
    return () => { gone = true; stop(); stopHealth(); };
  }, [paused, refresh]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now() / 1000), 1000); return () => window.clearInterval(timer); }, []);
  const stale = !paused && (!!error || !!live && now - live.at > 15);
  const select = (id: string) => { setSelected(id); setEdge(null); setEndpoint(null); setTab("overview"); };
  const selectedNode = graph?.nodes.find(n => n.id === selected);
  const shownHistory = useMemo(() => history.filter(h => h.at >= now - range * 60), [history, now, range]);
  const events = useMemo(() => [...(live?.api.recent || []).map(e => ({ ...e, type: "API" })), ...(live?.external.recent || []).map(e => ({ ...e, type: "HTTP" }))].sort((a, b) => b.ts - a.ts).filter(e => eventFilter === "all" || (eventFilter === "errors" ? e.status === 0 || e.status >= 400 : e.type === eventFilter)).slice(0, 60), [live, eventFilter]);
  const relevantEndpoints = graph?.endpoints.filter(e => `${e.path} ${e.module} ${e.function}`.toLowerCase().includes(query.toLowerCase())) || [];
  const exportSnapshot = () => {
    const blob = new Blob([JSON.stringify({ architecture: graph, snapshot: live, captured_at: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `kstock-system-atlas-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
  };
  return <div className="sa-page" ref={root}>
    <aside className="sa-rail"><Link to="/admin/dashboard" className="sa-logo" title="관리자 콘솔"><Icon name="atlas" size={28}/></Link><div className="sa-rail-divider"/>
      <Link to="/admin/dashboard" title="관리자 콘솔"><Icon name="gateway"/></Link><button className="is-active" title="시스템 아틀라스"><Icon name="atlas"/></button><Link to="/admin/monitor" title="뉴런 모니터"><Icon name="operations"/></Link><Link to="/admin/db" title="DB 콘솔"><Icon name="database"/></Link><Link to="/admin/live" title="실시간 접속"><Icon name="client"/></Link>
      <span className="sa-rail-bottom"><Link to="/desk" title="사이트로 돌아가기"><Icon name="back"/></Link><span>KH</span></span>
    </aside>
    <div className="sa-body">
      <header className="sa-header"><div className="sa-breadcrumb"><Link to="/admin/dashboard">관리자</Link><span>/</span><b>시스템 아틀라스</b><span className="sa-environment">{health?.commit && health.commit !== "dev" ? health.commit : "CURRENT INSTANCE"}</span></div><div className="sa-header-right"><span className={`sa-live-badge ${stale ? "is-stale" : paused ? "is-paused" : ""}`}><i/>{paused ? "일시 정지" : stale ? "갱신 지연" : live ? "LIVE OBSERVATION" : "연결 중"}</span><span className="sa-time">{time(now)} KST</span></div></header>
      <main className="sa-main">
        <div className="sa-title-row"><div><p className="sa-eyebrow">K-STOCK HUB / SYSTEM INTELLIGENCE</p><h1>모든 연결을, <span>한눈에.</span></h1><p className="sa-subtitle">서비스 구조부터 실시간 데이터 흐름까지. 시스템 전체를 탐색하는 운영 관제실.</p></div><div className="sa-actions"><button onClick={() => setPaused(p => !p)}><Icon name={paused ? "play" : "pause"} size={15}/>{paused ? "관측 재개" : "일시 정지"}</button><button onClick={() => setRefresh(n => n + 1)} disabled={paused} title={paused ? "관측을 재개하면 새로고침할 수 있습니다" : "구조와 상태 새로고침"}><Icon name="refresh" size={15}/>새로고침</button><button onClick={exportSnapshot} disabled={!graph} title="관측 스냅샷 JSON 다운로드"><Icon name="download" size={16}/></button></div></div>
        {(graphError || error || healthError || stale) && <div className="sa-alert" role="alert"><Icon name="info" size={17}/><span>{graphError || error || healthError || "최근 관측이 15초 이상 지연되었습니다."} {live && `마지막 성공 값 ${time(live.at)} 표시 중.`}</span><button onClick={() => setRefresh(n => n + 1)} disabled={paused}>다시 시도</button></div>}
        <div className="sa-kpis">
          {[{ label: "전체 API", value: number(graph?.endpoints.length), unit: "endpoints", color: "#58cfef", icon: "gateway", sub: `${graph?.modules.length || 0} backend modules`, node: "gateway" },
            { label: "API 처리량", value: live ? (live.api.count / 60).toFixed(2) : "—", unit: "req/s", color: "#75d4b0", icon: "operations", sub: `최근 60초 ${number(live?.api.count)}건${live?.api.window_truncated ? " · 버퍼 초과" : ""}`, node: "gateway", spark: shownHistory.map(h => h.count) },
            { label: "응답 지연 P95", value: ms(live?.api.p95_ms), unit: "", color: "#b098ff", icon: "cache", sub: `평균 ${ms(live?.api.avg_ms)} · API 표본`, node: "gateway", spark: shownHistory.map(h => h.latency) },
            { label: "데이터베이스", value: health ? health.db.ok ? `${health.db.ms}` : "실패" : "—", unit: health?.db.ok ? "ms" : "", color: "#eeb97e", icon: "database", sub: live ? `${live.database.mode.toUpperCase()} · 공유 DB ping${healthError ? " · 이전 값" : ""}` : "공유 DB 점검 중", node: "database" },
            { label: "외부 HTTP", value: number(live?.external.count), unit: "calls / 60s", color: "#ee8cb9", icon: "external", sub: `${live?.external.hosts.length || 0} 관측 호스트 · requests${live?.external.window_truncated ? " · 버퍼 초과" : ""}`, node: "ext-market", spark: shownHistory.map(h => h.external) },
            { label: "유효 캐시", value: number(live?.cache.fresh), unit: "keys", color: "#75d4b0", icon: "cache", sub: `만료 ${number(live?.cache.stale)} · 갱신 ${number(live?.cache.refreshing)}`, node: "cache" }].map(k => <button key={k.label} className="sa-kpi" style={colorStyle(k.color)} onClick={() => select(k.node)}><div className="sa-kpi-label"><span>{k.label}</span><Icon name={k.icon} size={16}/></div><div className="sa-kpi-value">{k.value}<small>{k.unit}</small></div><p>{k.sub}</p>{k.spark && <div className="sa-kpi-spark"><Sparkline values={k.spark} color={k.color} height={34}/></div>}</button>)}
        </div>
        <div className="sa-workspace"><section className="sa-topology-panel">
          <div className="sa-panel-head"><div><span className="sa-panel-dot"/><h2>시스템 연결 지도</h2><span className="sa-count">{graph?.nodes.length || 0} 영역 · {graph?.edges.length || 0} 연결</span></div><button className="sa-icon-button" title="관제 화면 전체화면" onClick={() => { if (!document.fullscreenElement) void root.current?.requestFullscreen().catch(() => setError("이 브라우저에서는 전체화면을 사용할 수 없습니다.")); else void document.exitFullscreen(); }}><Icon name="expand" size={17}/></button></div>
          <div className="sa-map-toolbar"><nav aria-label="모니터링 보기">{([["topology", "전체 구조"], ["api", "API 인벤토리"], ["storage", "DB · 캐시"], ["stack", "기술 스택"]] as [View, string][]).map(([key, label]) => <button key={key} className={view === key ? "is-active" : ""} onClick={() => setView(key)}>{label}</button>)}</nav><label className="sa-search"><Icon name="search" size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder={view === "api" ? "API 경로 검색…" : "영역 · 기술 · 호스트 검색…"} aria-label="시스템 검색"/>{query && <button onClick={() => setQuery("")} aria-label="검색 초기화">×</button>}</label></div>
          {!graph ? <div className="sa-loading"><Icon name="atlas" size={45}/><h3>{graphError ? "구조를 불러오지 못했습니다" : "시스템 구조를 분석하고 있습니다"}</h3><p>라우트 · 서비스 · 저장소 · 외부 연동</p>{graphError && <button onClick={() => setRefresh(n => n + 1)}>구조 다시 불러오기</button>}</div> : <>
            {view === "topology" && <Topology graph={graph} live={live} health={health} selected={selected} onSelect={select} onEdge={e => { setSelected(e.source); setEdge(e); setEndpoint(null); setTab("connections"); }} focus={focus} query={query} zoom={zoom} paused={paused} stale={stale}/>}
            {view === "api" && <div className="sa-inventory"><div className="sa-inventory-head"><h3>{relevantEndpoints.length} API 엔드포인트</h3><span>실제 FastAPI 라우트 테이블 · 평균 응답은 최근 60초 표본</span></div><EndpointList endpoints={relevantEndpoints} live={live} select={e => { setSelected(e.group); setEndpoint(e); setTab("endpoints"); }}/></div>}
            {view === "storage" && <div className="sa-storage-view"><div className="sa-inventory-head"><h3>데이터 계층</h3><span>SQL 저장소 · 캐시 · Circuit breaker</span></div><div className="sa-storage-cards">{graph.nodes.filter(n => n.kind === "storage").map(n => <button key={n.id} style={colorStyle(n.color)} onClick={() => select(n.id)}><Icon name={n.id === "cache" ? "cache" : "database"} size={28}/><h3>{n.label}</h3><p>{n.description}</p><b>{n.id === "cache" ? `${number(live?.cache.entries)} keys` : `${n.tables?.length || 0} schema declarations`}</b></button>)}</div><h3>저장소 게이트 · 프로세스 누적</h3><div className="sa-gate-table"><table><thead><tr><th>저장소</th><th>호출</th><th>대기</th><th>처리</th><th>오류</th><th>상태</th></tr></thead><tbody>{health?.gates.map(g => <tr key={g.name}><td>{g.name}</td><td>{number(g.calls)}</td><td>{g.avg_wait_ms}ms</td><td>{g.avg_work_ms}ms</td><td>{g.errors}</td><td className={g.open ? "sa-red" : "sa-green"}>{g.open ? "차단" : "통과"}</td></tr>)}</tbody></table>{!health && <p className="sa-empty">게이트 상태 점검 중</p>}</div><Link className="sa-text-button" to="/admin/db">실제 테이블 · SQL 조회 콘솔 열기 ↗</Link></div>}
            {view === "stack" && <div className="sa-stack-view"><div className="sa-inventory-head"><h3>기술 스택 & 실행 환경</h3><span>패키지 버전은 프로젝트 선언 기준</span></div><div className="sa-stack-grid"><section><Icon name="client" size={25}/><h3>Frontend</h3>{Object.entries(graph.frontend.dependencies || {}).map(([n, v]) => <div className="sa-stack-row" key={n}><b>{n}</b><code>{v}</code></div>)}<p>History API 라우터 · 순수 CSS · 코드 분할</p></section><section><Icon name="gateway" size={25}/><h3>Backend</h3>{Object.entries(graph.backend_dependencies || {}).map(([n, v]) => <div className="sa-stack-row" key={n}><b>{n}</b><code>{v}</code></div>)}</section><section><Icon name="database" size={25}/><h3>Storage & runtime</h3>{Object.entries(graph.frontend.deployment || {}).map(([n, v]) => <div className="sa-stack-row" key={n}><span>{n}</span><b>{v}</b></div>)}<p>현재 메모리 {number(health?.memory_mb)} MB · 가동 {health ? Math.floor(health.uptime_s / 3600) : "—"}h · 활성 세션 {number(live?.active_sessions)}</p></section><section><Icon name="operations" size={25}/><h3>Background workers</h3>{health?.threads.map(t => <div className="sa-stack-row" key={t.name}><b>{t.name}</b><code>×{t.count}</code></div>)}<p>현재 Python 프로세스의 스레드 목록</p></section></div><details className="sa-coverage"><summary>분석 · 관측 범위와 데이터 해석</summary><p>{graph.coverage.architecture}</p><p>{graph.coverage.traffic}</p>{graph.coverage.limitations.map(l => <p key={l}>{l}</p>)}</details></div>}
          </>}
          <div className="sa-map-footer"><div className="sa-legend"><span><i className="sa-status-active"/>활동 관측</span><span><i className="sa-status-error"/>5xx / 전송 실패</span><span><i className="sa-status-idle"/>최근 표본 없음</span></div><div className="sa-map-controls"><button onClick={() => setFocus(f => !f)} className={focus ? "is-active" : ""} aria-pressed={focus}>선택 영역 집중</button><button onClick={() => setZoom(z => Math.max(75, z - 25))} disabled={zoom <= 75} aria-label="지도 축소">−</button><button onClick={() => setZoom(100)} title="지도 배율 초기화">{zoom}%</button><button onClick={() => setZoom(z => Math.min(200, z + 25))} disabled={zoom >= 200} aria-label="지도 확대">+</button></div></div>
        </section>
        {graph && selectedNode && <Inspector node={selectedNode} edge={edge} endpoint={endpoint} graph={graph} live={live} health={health} onSelect={select} onEndpoint={setEndpoint} tab={tab} setTab={setTab}/>}
        </div>
        <div className="sa-bottom-grid">
          <section className="sa-bottom-card"><header><h2>API 응답 추이</h2><select value={range} onChange={e => setRange(Number(e.target.value))} aria-label="차트 관측 기간"><option value="1">최근 1분</option><option value="5">최근 5분</option><option value="10">최근 10분</option></select></header><div className="sa-chart-metrics"><b>{ms(live?.api.p95_ms)}<small>P95 / 60s</small></b><span><i/>응답 시간</span></div><Sparkline values={shownHistory.map(h => h.latency)} color="#b098ff" height={90} fill/><div className="sa-chart-axis"><span>{shownHistory.length ? time(shownHistory[0].at) : "표본 대기"}</span><span>{time(live?.at)}</span></div><p className="sa-footnote">이 페이지를 연 뒤 수집한 표본 · 트래픽이 없으면 지연 값 없음</p></section>
          <section className="sa-bottom-card"><header><h2>서비스별 호출 분포</h2><span>최근 60초</span></header><div className="sa-service-bars">{graph?.nodes.filter(n => n.kind === "service").map(n => { const stats = nodeStats(n, live); return <button key={n.id} onClick={() => select(n.id)}><span>{n.label.split(" · ")[0]}</span><div><i style={{ width: `${stats.count / Math.max(1, live?.api.count || 0) * 100}%`, background: n.color }}/></div><b>{stats.count}</b></button>; })}</div><p className="sa-footnote">API 요청을 담당 라우터 영역별로 집계</p></section>
          <section className="sa-bottom-card sa-events-card"><header><h2>실시간 이벤트</h2><select value={eventFilter} onChange={e => setEventFilter(e.target.value)} aria-label="이벤트 필터"><option value="all">전체</option><option value="API">API</option><option value="HTTP">외부 HTTP</option><option value="errors">오류 · 4xx</option></select></header><div className="sa-event-list">{events.map(e => <button key={`${e.type}-${e.id}`} onClick={() => { const found = graph?.endpoints.find(p => p.path === e.route); if (found) { setSelected(found.group); setEndpoint(found); setTab("endpoints"); } else if (e.host) { const n = graph?.nodes.find(n => n.hosts?.includes(e.host!)); if (n) select(n.id); } }}><time>{time(e.ts)}</time><span className={`sa-event-type ${e.type === "HTTP" ? "is-http" : ""}`}>{e.type}</span><code title={e.route || e.host}>{e.route || e.host}</code><b className={e.status === 0 || e.status >= 400 ? "sa-red" : "sa-green"}>{e.status || "ERR"}</b><small>{ms(e.ms)}</small></button>)}{!events.length && <p className="sa-empty">현재 관측된 이벤트가 없습니다.<br/>새 요청이 완료되면 여기에 표시됩니다.</p>}</div></section>
        </div>
        <footer className="sa-page-foot"><span><i/>업데이트 {time(live?.at)} · HTTP 폴링 3초 · 서버/DB 점검 15초 · 단일 프로세스 관측</span><span>설계 연결 ≠ 요청별 분산 추적 <button onClick={() => setView("stack")}>관측 범위 보기 ↗</button></span></footer>
      </main>
    </div>
  </div>;
}
