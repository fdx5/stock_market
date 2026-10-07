import type { AtlasAction, AtlasArchitecture, AtlasEvent, AtlasSnapshot } from "./systemAtlasApi";
import { pageLabel } from "../useActivityTracking";
export const FLOW_WIDTH = 1200, FLOW_HEIGHT = 760;
export const DOMAIN_COLORS: Record<string, string> = { market: "#4edbff", community: "#a795ff", realestate: "#ffb969", prediction: "#f28bc6", operations: "#54e2b3", support: "#f9d56e" };
export const DOMAIN_NAMES: Record<string, string> = { market: "증시", community: "뉴스", realestate: "부동산", prediction: "AI 예측", operations: "운영", support: "후원" };
export function flowPositions(graph: AtlasArchitecture) {
  const points: Record<string, { x: number; y: number }> = { ingress: { x: 30, y: 357 }, gateway: { x: 160, y: 357 }, batch: { x: 160, y: 656 } };
  const sites = [{x:440,y:136},{x:745,y:160},{x:465,y:366},{x:748,y:402},{x:440,y:614},{x:748,y:649}];
  graph.nodes.filter(n => n.kind === "service").forEach((n, i) => points[n.id] = sites[i] || {x:600,y:380});
  [...graph.nodes.filter(n => n.kind === "external"), ...graph.nodes.filter(n => n.id === "database" || n.id === "estate-db")].forEach((n, i) => points[n.id] = { x: 1077, y: 87 + i * 72 });
  return points;
}
export function hostDestination(graph: AtlasArchitecture, host: string) {
  const exact = graph.nodes.find(n => n.hosts?.includes(host)); if (exact) return exact.id;
  if (/turso\.(io|tech)$/.test(host)) return "database";
  if (/finance\.naver|stock\.naver|yahoo|krx|seibro|companiesmarketcap|slickcharts|financialmodelingprep|wisereport|stooq|nasdaq/.test(host)) return "ext-market";
  if (/data\.go\.kr|vworld|openstreetmap|overpass|arcgisonline|open-meteo|sgis|k-apt|map\.naver|land\.naver|hogangnono/.test(host)) return "ext-spatial";
  if (/anthropic|claude\.ai/.test(host)) return "ext-ai";
  if (/buymeacoffee|paypal|stripe|kakaopay/.test(host)) return "ext-pay";
  if (/kakao|resend|blog\.naver/.test(host)) return "ext-delivery";
  if (/news|bing|translate|ip-api|toss|search\.naver/.test(host)) return "ext-content";
  return "ext-resources";
}
export function callDestination(graph: AtlasArchitecture, call: AtlasEvent) {
  return call.target && graph.nodes.some(n => n.id === call.target) ? call.target : hostDestination(graph, call.host || "");
}
export type FlowRecord = { key: string; request: AtlasEvent; calls: AtlasEvent[]; group: string; batch: boolean; fault: boolean; slow: boolean; session?: string; action?: AtlasAction };
export function actionLabel(action: AtlasAction) {
  if (action.type === "page_view") return `페이지 이동 · ${action.label || pageLabel(action.path)}`;
  if (action.type === "stock_view") return `종목 조회 · ${action.stock_name || action.stock_code}`;
  if (action.type === "hub") {
    const name = ({ object_click: "메인 선택", focus: "관심 대상", control: "화면 조작", bgm: "BGM 변경", exit: "메인에서 이동" } as Record<string, string>)[action.action || ""] || "메인 상호작용";
    return action.label ? `${name} · ${action.label}` : name;
  }
  return action.label || "화면 선택";
}
export const sessionLabel = (id: string) => `접속 ${id.slice(0, 8).toUpperCase()}`;
export function behaviorRecords(live: AtlasSnapshot | null, session: string | null = null, window = 60): FlowRecord[] {
  if (!live) return [];
  return (live.behavior?.sessions || []).filter(s => !session || s.id === session).flatMap(s => s.events
    .filter(e => e.ts <= live.at && e.ts >= live.at - window)
    .map(action => ({ key: `user:${s.id}:${action.id}:${action.ts}`, request: { id: action.id, ts: action.ts, method: "USER", status: 200, ms: 0, route: action.path },
      calls: [], group: action.group, batch: false, fault: false, slow: false, session: s.id, action })))
    .sort((a, b) => b.request.ts - a.request.ts || b.request.id - a.request.id);
}
export function flowRecords(graph: AtlasArchitecture, live: AtlasSnapshot | null, mode: "users" | "system" = "users", session: string | null = null): FlowRecord[] {
  if (!live) return [];
  if (mode === "users") return behaviorRecords(live, session);
  const groups = new Map(graph.endpoints.map(e => [e.path, e.group]));
  const linked = new Map((live.traces || []).map(t => [t.request.id, t.calls]));
  const unique = new Map<string, FlowRecord>();
  for (const request of [...(live.api.recent || []), ...(live.traces || []).map(t => t.request)]) {
    if (request.ts > live.at || request.ts < live.at - 60) continue;
    const calls = linked.get(request.id) || [], key = `api:${request.id}:${request.ts}`;
    unique.set(key, { key, request, calls, group: groups.get(request.route || "") || "operations", batch: false, fault: !request.status || request.status >= 500 || calls.some(c => !c.status || c.status >= 500), slow: request.ms >= 1000 });
  }
  for (const request of live.external.recent || []) {
    if (request.trace_id || request.ts > live.at || request.ts < live.at - 60) continue;
    const key = `http:${request.id}:${request.ts}`;
    unique.set(key, { key, request, calls: [request], group: "batch", batch: true, fault: !request.status || request.status >= 500, slow: request.ms >= 1000 });
  }
  return [...unique.values()].sort((a, b) => b.request.ts - a.request.ts || b.request.id - a.request.id).slice(0, 80);
}
export const UNIT_COLORS = ["#55d9ff", "#ba9bff", "#ff8f85"];
export type CrawlEvent = { id: number; unit: number; target: string; kind: "depart" | "arrival"; record: FlowRecord };
export type FlowState = { live: AtlasSnapshot | null; selected: string; focus: string | null; replay: number; motion: boolean; reduced: boolean; speed: number; mode: "users" | "system"; session: string | null };
