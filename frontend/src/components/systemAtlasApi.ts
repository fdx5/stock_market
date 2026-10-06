import { authedGet, AdminHealth } from "../adminApi";

export interface AtlasStats {
  count: number; errors: number; client_errors: number; avg_ms: number | null;
  p95_ms?: number | null; last_at: number | null;
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
export interface AtlasEvent { id: number; ts: number; method: string; status: number; ms: number; route?: string; host?: string; trace_id?: number }
export interface AtlasSnapshot {
  at: number; active_sessions: number; observed_edges: Record<string, number>;
  api: AtlasStats & { window_s: number; window_truncated: boolean; groups: Record<string, AtlasStats>; endpoints: Array<AtlasStats & { path: string }>; recent: AtlasEvent[] };
  external: AtlasStats & { started_at: number; window_s: number; window_truncated: boolean; groups: Record<string, AtlasStats>;
    hosts: Array<AtlasStats & { host: string }>; recent: AtlasEvent[] };
  cache: { entries: number; fresh: number; stale: number; refreshing: number; capacity: number };
  database: { mode: string; separate_realestate: boolean; realestate_mode: string };
}
export const atlasApi = {
  architecture: () => authedGet<AtlasArchitecture>("/atlas/architecture"),
  snapshot: () => authedGet<AtlasSnapshot>("/atlas/snapshot"),
  health: () => authedGet<AdminHealth>("/atlas/health"),
};
