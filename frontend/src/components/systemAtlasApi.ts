import { authedGet, AdminHealth } from "../adminApi";

export interface AtlasStats {
  count: number; errors: number; client_errors: number; avg_ms: number | null;
  p50_ms?: number | null; p95_ms?: number | null; max_ms?: number | null; slow?: number; last_at: number | null;
}
export interface AtlasNode {
  id: string; label: string; subtitle: string; kind: "client" | "gateway" | "service" | "storage" | "external";
  color: string; description: string; modules: string[]; endpoint_count: number; hosts?: string[]; tables?: string[];
}
export interface AtlasEdge { id: string; source: string; target: string; protocol: string; evidence: string; kind: string }
export interface AtlasModule { id: string; file: string; group: string; imports: string[]; hosts: string[]; tables: string[]; cache: boolean }
export interface AtlasEndpoint { path: string; methods: string[]; group: string; module: string; function: string; dependencies: string[] }
export interface AtlasArchitecture {
  nodes: AtlasNode[]; edges: AtlasEdge[]; modules: AtlasModule[]; endpoints: AtlasEndpoint[]; backend_dependencies: Record<string, string>;
  frontend: { dependencies?: Record<string, string>; dev_dependencies?: Record<string, string>; routes?: string[]; source_files?: number;
    workers?: string[]; external?: Array<{ file: string; hosts: string[] }>; schedules?: Array<{ file: string; cron: string[]; endpoints: string[] }>;
    deployment?: { provider: string; container: string; runtime: string; worker_policy: string; domain: string } };
  coverage: { architecture: string; traffic: string; limitations: string[] };
}
export interface AtlasEvent { id: number; ts: number; method: string; status: number; ms: number; route?: string; host?: string; trace_id?: number; target?: string }
export interface AtlasBreakdown {
  status: Record<string, number>; latency: number[]; timeline: Array<AtlasStats & { at: number }>;
}
export interface AtlasTrace { request: AtlasEvent; calls: AtlasEvent[]; external_count: number; calls_truncated: boolean }
export interface AtlasAction {
  id: number; ts: number; type: "page_view" | "click" | "stock_view" | "hub";
  path: string; group: string; label: string; stock_code: string; stock_name: string; action?: string | null;
}
export interface AtlasSession {
  id: string; first_seen: number; last_seen: number; last_heartbeat: number | null;
  online: boolean; active: boolean; path: string; events: AtlasAction[];
}
export interface AtlasBehavior {
  window_s: number; capacity: number; event_count: number; online_count: number; active_count: number;
  truncated: boolean; sessions: AtlasSession[];
}
export interface AtlasSnapshot {
  at: number; active_sessions: number; observed_edges: Record<string, number>;
  api: AtlasStats & { window_s: number; window_truncated: boolean; groups: Record<string, AtlasStats>; endpoints: Array<AtlasStats & { path: string; method: string }>; recent: AtlasEvent[]; breakdown?: AtlasBreakdown };
  external: AtlasStats & { started_at: number; window_s: number; window_truncated: boolean; groups: Record<string, AtlasStats>;
    hosts: Array<AtlasStats & { host: string }>; recent: AtlasEvent[]; flows?: Array<AtlasStats & { route: string; host: string }>; breakdown?: AtlasBreakdown };
  traces?: AtlasTrace[];
  behavior?: AtlasBehavior;
  cache: { entries: number; fresh: number; stale: number; refreshing: number; capacity: number };
  database: { mode: string; separate_realestate: boolean; realestate_mode: string };
}
export const atlasApi = {
  architecture: () => authedGet<AtlasArchitecture>("/atlas/architecture"),
  snapshot: () => authedGet<AtlasSnapshot>("/atlas/snapshot"),
  health: () => authedGet<AdminHealth>("/atlas/health"),
};
