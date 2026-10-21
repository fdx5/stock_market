import type { AtlasArchitecture, AtlasEvent, AtlasSnapshot, AtlasStats } from "../components/systemAtlasApi";

export type SynapseKind = "core" | "service" | "api" | "module" | "host" | "storage" | "client";
export interface SynapseNode {
  id: string; label: string; detail: string; kind: SynapseKind; group: string; color: string;
  position: [number, number, number]; parent?: string; path?: string; host?: string;
}
export interface SynapseLink { id: string; source: number; target: number; kind: "structure" | "request" | "http"; label: string }
export interface SynapseGraph {
  nodes: SynapseNode[]; links: SynapseLink[]; byId: Map<string, number>;
  adjacency: Map<number, number[]>; domains: SynapseNode[]; omitted: number;
}
export interface ObservedFlow { route: string; host: string; target?: string }
export const DOMAIN_COLORS: Record<string, string> = {
  market: "#58e9db", community: "#6daaff", realestate: "#b698ff", prediction: "#ffc27c",
  operations: "#ff759c", support: "#a5db8c", gateway: "#b9ecff",
};
export const EMPTY_STATS: AtlasStats = { count: 0, errors: 0, client_errors: 0, avg_ms: null, last_at: null };
export const apiId = (path: string) => `api:${path}`;
export const hostId = (host: string) => `host:${host}`;
export const requestLink = (path: string) => `request:${path}`;
export const httpLink = (route: string, host: string) => `http:${route}:${host}`;
export function hash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); h = Math.imul(h ^ h >>> 16, 0x85ebca6b); h = Math.imul(h ^ h >>> 13, 0xc2b2ae35); return ((h ^ h >>> 16) >>> 0) / 4294967296; }

/** Equal spacing on a sphere keeps the topology's depth when viewed from the side. */
function spherePosition(index: number, total: number, radius: number): [number, number, number] {
  // The six service domains form an octahedron, with equal reach on all three axes.
  if (total === 6) {
    const axes: [number, number, number][] = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    return axes[index].map(value => value * radius) as [number, number, number];
  }
  const y = 1 - 2 * (index + .5) / Math.max(1, total);
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = index * Math.PI * (3 - Math.sqrt(5)) + .18;
  return [Math.cos(angle) * ring * radius, y * radius, Math.sin(angle) * ring * radius];
}

/** Stable, bounded geometry. Every vertex is an inventory item; decorative stars are
 * rendered separately and never counted as systems or measured connections. */
export function buildSynapseGraph(graph: AtlasArchitecture, flows: ObservedFlow[] = []): SynapseGraph {
  const nodes: SynapseNode[] = [], links: SynapseLink[] = [], byId = new Map<string, number>();
  const linkIds = new Set<string>(); let omitted = 0;
  const add = (node: SynapseNode) => { if (byId.has(node.id)) return; if (nodes.length >= 16000) { omitted++; return; } byId.set(node.id, nodes.length); nodes.push(node); };
  const edge = (id: string, from: string, to: string, kind: SynapseLink["kind"], label: string) => {
    const source = byId.get(from), target = byId.get(to);
    if (source === undefined || target === undefined || source === target || linkIds.has(id)) return;
    if (links.length >= 40000) { omitted++; return; }
    linkIds.add(id); links.push({ id, source, target, kind, label });
  };
  const domains = graph.nodes.filter(n => n.kind === "service");
  const centers = new Map<string, [number, number, number]>();
  domains.forEach((n, i) => {
    centers.set(n.id, spherePosition(i, domains.length, 185));
  });
  const other = graph.nodes.filter(n => n.kind !== "service" && n.id !== "gateway");
  graph.nodes.forEach(n => {
    const position: [number, number, number] = centers.get(n.id) || (n.id === "gateway" ? [0, 0, 0] : spherePosition(other.indexOf(n), other.length, 320));
    add({ id: n.id, label: n.label, detail: n.description, kind: n.kind === "gateway" ? "core" : n.kind === "external" ? "host" : n.kind,
      group: n.id, color: DOMAIN_COLORS[n.id] || n.color, position });
  });
  if(flows.some(f=>!f.route))add({id:"unscoped-http",label:"요청 문맥 없는 HTTP",detail:"요청 경로가 제공되지 않은 HTTP 표본의 집계점. 배치 여부 또는 API 인과관계를 추정하지 않습니다.",kind:"core",group:"operations",color:"#d3a8ea",position:[-90,-215,-45]});
  const satellite = (id: string, group: string, tier: number): [number, number, number] => {
    const center = centers.get(group) || nodes[byId.get(group) ?? 0]?.position || [0, 0, 0];
    const a = hash(id) * Math.PI * 2, y = hash(id + "elevation") * 2 - 1;
    const ring = Math.sqrt(1 - y * y);
    const r = tier + hash(id + "radius") * 44;
    return [center[0] + Math.cos(a) * ring * r, center[1] + y * r, center[2] + Math.sin(a) * ring * r];
  };
  graph.endpoints.forEach(e => add({ id: apiId(e.path), label: e.path, detail: `${e.methods.join(" / ")} · ${e.function} · ${e.module}`,
    kind: "api", group: e.group, parent: e.group, path: e.path, color: DOMAIN_COLORS[e.group] || "#8eabbf", position: satellite(e.path, e.group, 25) }));
  graph.modules.forEach(m => add({ id: `module:${m.id}`, label: m.id.replace(/^app\./, ""), detail: m.file,
    kind: "module", group: m.group, parent: m.group, color: DOMAIN_COLORS[m.group] || "#8eabbf", position: satellite(m.id, m.group, 53) }));
  const hostGroups = new Map<string, string>();
  graph.nodes.forEach(n => n.hosts?.forEach(h => hostGroups.set(h, n.id)));
  flows.forEach(f=>{if(f.target&&byId.has(f.target))hostGroups.set(f.host,f.target);});
  const hosts = new Set([...hostGroups.keys(), ...graph.modules.flatMap(m => m.hosts), ...flows.map(f => f.host)]);
  hosts.forEach(h => { const group = hostGroups.get(h) || "ext-resources"; add({ id: hostId(h), label: h, detail: "외부 HTTP 호스트 · 원문 URL 및 인증 정보 제외", kind: "host", group, parent: group, host: h,
    color: nodes[byId.get(group) ?? 0]?.color || "#9aaaff", position: satellite(h, group, 19) }); });
  graph.edges.forEach(e => edge(`architecture:${e.id}`, e.source, e.target, "structure", `${e.protocol} · ${e.evidence}`));
  graph.endpoints.forEach(e => {
    edge(requestLink(e.path), e.group, apiId(e.path), "request", "서비스 → API · 완료 요청의 수신 재생");
    e.dependencies.forEach(d => edge(`dependency:${e.path}:${d}`, apiId(e.path), `module:${d}`, "structure", "소스에 선언된 API 의존성"));
  });
  graph.modules.forEach(m => {
    edge(`owns:${m.id}`, m.group, `module:${m.id}`, "structure", "서비스 소속 모듈");
    m.imports.forEach(d => edge(`import:${m.id}:${d}`, `module:${m.id}`, `module:${d}`, "structure", "소스 import 의존성"));
    m.hosts.forEach(h => edge(`host-declaration:${m.id}:${h}`, `module:${m.id}`, hostId(h), "structure", "소스에 선언된 외부 연동"));
  });
  hosts.forEach(h => edge(`host-parent:${h}`, hostGroups.get(h) || "ext-resources", hostId(h), "structure", "호스트 소속 영역"));
  flows.forEach(f => edge(httpLink(f.route, f.host), f.route?apiId(f.route):"unscoped-http", hostId(f.host), "http", f.route?"요청 문맥으로 연결된 외부 HTTP":"요청 문맥 없는 외부 HTTP 표본"));
  const adjacency = new Map<number, number[]>();
  links.forEach((e, i) => { for (const n of [e.source, e.target]) { const list = adjacency.get(n) || []; list.push(i); adjacency.set(n, list); } });
  return { nodes, links, byId, adjacency, domains: nodes.filter(n => n.kind === "service"), omitted };
}

export function statsFor(node: SynapseNode, live: AtlasSnapshot | null): AtlasStats {
  if (!live) return EMPTY_STATS;
  if (node.path) {
    const all = live.api.endpoints.filter(e => e.path === node.path);
    if (!all.length) return EMPTY_STATS;
    const count = all.reduce((s, e) => s + e.count, 0);
    return { count, errors: all.reduce((s,e) => s + e.errors, 0), client_errors: all.reduce((s,e) => s + e.client_errors, 0),
      avg_ms: count ? all.reduce((s,e) => s + (e.avg_ms || 0) * e.count, 0) / count : null,
      last_at: Math.max(...all.map(e => e.last_at || 0)) || null };
  }
  if (node.host) return live.external.hosts.find(h => h.host === node.host) || EMPTY_STATS;
  if (node.id === "unscoped-http") {
    const routes=externalRoutes(live),events=live.external.recent.filter(e=>!e.route&&!routes.has(e.id)),count=events.length;
    return {count,errors:events.filter(e=>e.status===0||e.status>=500).length,client_errors:events.filter(e=>e.status>=400&&e.status<500).length,
      avg_ms:count?events.reduce((s,e)=>s+e.ms,0)/count:null,last_at:count?Math.max(...events.map(e=>e.ts)):null};
  }
  if (node.kind === "core") return live.api;
  if (node.kind === "module") return EMPTY_STATS;
  return live.api.groups[node.id] || live.external.groups[node.id] || EMPTY_STATS;
}

export interface SynapseSignal { key: string; link: string; fault: boolean; ts: number }
export function snapshotSignals(live: AtlasSnapshot | null): SynapseSignal[] {
  if (!live) return [];
  const signals: SynapseSignal[] = [];
  live.api.recent.forEach(e => { if (e.route) signals.push({ key: `api:${e.id}:${e.ts}`, link: requestLink(e.route), fault: e.status === 0 || e.status >= 400, ts: e.ts }); });
  const routes=externalRoutes(live);
  live.external.recent.forEach(c=>{if(c.host)signals.push({key:`http:${c.id}:${c.ts}`,link:httpLink(c.route||routes.get(c.id)||"",c.host),fault:c.status===0||c.status>=400,ts:c.ts});});
  live.traces?.forEach(t => t.calls.forEach(c => { if (t.request.route && c.host) signals.push({ key: `http:${c.id}:${c.ts}`, link: httpLink(t.request.route, c.host), fault: c.status === 0 || c.status >= 400, ts: c.ts }); }));
  return [...new Map(signals.map(s=>[s.key,s])).values()];
}
function externalRoutes(live:AtlasSnapshot|null){const routes=new Map<number,string>();live?.traces?.forEach(t=>t.calls.forEach(c=>{if(t.request.route)routes.set(c.id,t.request.route);}));return routes;}
export function observedFlows(live: AtlasSnapshot | null): ObservedFlow[] {
  const map = new Map<string, ObservedFlow>();
  const routes=externalRoutes(live);
  live?.external.flows?.forEach(f => map.set(httpLink(f.route, f.host), { route: f.route, host: f.host }));
  live?.external.recent.forEach(c=>{if(c.host){const route=c.route||routes.get(c.id)||"";map.set(httpLink(route,c.host),{route,host:c.host,target:c.target});}});
  live?.traces?.forEach(t => t.calls.forEach(c => { if (t.request.route && c.host) map.set(httpLink(t.request.route, c.host), { route: t.request.route, host: c.host, target:c.target }); }));
  return [...map.values()].sort((a,b) => httpLink(a.route,a.host).localeCompare(httpLink(b.route,b.host)));
}
export type JournalEvent = AtlasEvent & { key: string; type: "API" | "HTTP" };
export function journalEvents(live: AtlasSnapshot | null): JournalEvent[] {
  return [...(live?.api.recent || []).map(e => ({ ...e, key: `api:${e.id}:${e.ts}`, type: "API" as const })), ...(live?.external.recent || []).map(e => ({ ...e, key: `http:${e.id}:${e.ts}`, type: "HTTP" as const }))].sort((a,b) => b.ts - a.ts).slice(0, 180);
}
