const BASE = "/api/admin";
const TOKEN_KEY = "admin_session";
/** The neuron monitor's own session, minted by its passcode. Stored separately from the
 * admin session because it is strictly less: it opens the monitor's two endpoints and
 * nothing else (see the backend's admin_auth SCOPE_ constants). */
const MONITOR_TOKEN_KEY = "monitor_session";

export interface AdminSession {
  token: string;
  expires_at: number;
}

export interface PageCount {
  path: string;
  count: number;
}

export interface AdminSummary {
  online_now: number;
  total_visits: number;
  views_last_24h: number;
  top_pages: PageCount[];
}

export type AdminTrendRange = "1h" | "3h" | "6h" | "12h" | "24h" | "3d" | "7d" | "30d";

export interface TrendPoint {
  bucket: string;
  path: string;
  count: number;
}

export interface TrendResponse {
  range: AdminTrendRange;
  points: TrendPoint[];
}

export interface ActivityEvent {
  id: number;
  created_at: string;
  session_id: string;
  type: "page_view" | "click" | "stock_view";
  path: string;
  label: string | null;
  stock_code: string | null;
  stock_name: string | null;
}

export interface StockSearchCount {
  code: string;
  name: string;
  count: number;
}

/* ───────────────────────── monitor (neuron view) ─────────────────────────
   The site's own wiring, plus the live signal running through it. See the backend's
   services/site_graph for which parts of the graph are derived from the live route
   table and which are hand-curated. */

/** Which layer of the diagram a node sits in: a client-side route, a backend endpoint,
 * or a store/upstream the endpoints lean on. */
export type MonitorNodeKind = "page" | "api" | "depot";

export interface MonitorNode {
  id: string;
  label: string;
  kind: MonitorNodeKind;
  /** Cluster the node belongs to — the monitor colours and spatially groups by this. */
  group: string;
  /** Client-side route for a page, endpoint template for an api; absent on a depot. */
  path?: string;
  methods?: string[];
}

export interface MonitorEdge {
  source: string;
  target: string;
  /** "call" is page → endpoint, "depend" is endpoint → store/upstream. */
  kind: "call" | "depend";
}

export interface MonitorGraph {
  nodes: MonitorNode[];
  edges: MonitorEdge[];
  /** Curated edges whose endpoint no longer exists, surfaced rather than dropped
   * silently — the diagram says so instead of quietly lying. */
  warnings: string[];
}

/** One completed backend request, as timed by the API pulse middleware. */
export interface ApiPulseEvent {
  id: number;
  ts: number;
  /** The matched route *template*, so every stock code reports as one endpoint. */
  route: string;
  method: string;
  status: number;
  ms: number;
}

export interface MonitorPulse {
  api_cursor: number;
  activity_cursor: number;
  api: ApiPulseEvent[];
  activity: ActivityEvent[];
  active_sessions: number;
}

export interface ActiveSession {
  session_id: string;
  path: string;
  stock_code: string | null;
  stock_name: string | null;
  first_seen: number;
  last_seen: number;
}

/** One region's last-run outcome, as remembered by the web process (volatile — see
 * prediction_batch._last_runs). Absent after a restart until the next run. */
export interface PredictionRunRecord {
  status: "ok" | "skipped" | "error" | null;
  reason: string | null;
  collect_date: string | null;
  predict_date: string | null;
  predict_weekday: string | null;
  saved: number;
  markets: Record<string, { count: number; ai_source: string }>;
  elapsed_seconds: number | null;
  warnings: string[];
  triggered_by: string | null;
  error: string | null;
  finished_at: string;
}

/** DB-derived per-market snapshot (restart-proof — reflects what was actually saved). */
export interface PredictionMarketStat {
  collect_date: string;
  predict_date: string;
  count: number;
  updated_at: string;
}

export interface PredictionStatus {
  running: string[];
  last_runs: Record<string, PredictionRunRecord>;
  markets: Record<string, PredictionMarketStat>;
  regions: Record<string, string[]>;
}

export type BatchRegion = "KR" | "US";

/** One outcome of the hourly "사이트 방문자 현황" KakaoTalk notification (see
 * backend/app/services/kakao_notify.py's run_visitor_stats), regardless of which of
 * the three triggers (cron, in-process fallback, or this panel's own button)
 * produced it. */
export interface KakaoVisitorRun {
  status: "sent" | "not_configured" | "error" | "skipped_recent";
  message?: string;
  stats?: { online_now: number; total_visits: number; views_24h: number };
  error?: string;
  last_sent_at?: string;
  triggered_by: "cron" | "in_process" | "admin";
  finished_at: string;
}

/** Expiry-only view of the stored Kakao token (no token material) — the access token
 * refreshes itself, but the refresh token expires roughly every 2 months and needs
 * scripts/kakao_get_refresh_token.py run again, which the panel warns about while
 * there is still time to act. Null when no token has been stored yet. */
export interface KakaoTokenInfo {
  access_expires_at: string;
  refresh_expires_at: string | null;
}

export interface KakaoVisitorStatus {
  configured: boolean;
  last_run: KakaoVisitorRun | null;
  token?: KakaoTokenInfo | null;
}

/** One outcome of the "AI 예측 배치 실행결과" KakaoTalk notification for a single
 * region, sent ~10 minutes after that region's prediction_batch run finishes (see
 * kakao_notify.schedule_prediction_result) or resent on demand via this panel's
 * '지금 발송' button. */
export interface KakaoPredictionRun {
  region: BatchRegion;
  status: "sent" | "not_configured" | "error";
  message?: string;
  error?: string;
  triggered_by: "auto_delayed" | "admin";
  finished_at: string;
}

export interface KakaoPredictionStatus {
  configured: boolean;
  last_runs: Partial<Record<BatchRegion, KakaoPredictionRun>>;
  token?: KakaoTokenInfo | null;
}

export type CommentSource = "battle" | "fight";

export interface AdminComment {
  id: number;
  source: CommentSource;
  stock_name: string;
  text: string;
  created_at: string;
  visible: boolean;
}

/** One browsable database. On Turso every table lives in one database, so there is a
 * single source; local dev falls back to one .db file per store, hence a list. */
export interface DbSource {
  id: string;
  label: string;
  kind: "turso" | "local";
}

export interface DbTable {
  name: string;
  type: "table" | "view";
  /** null when the row count could not be taken (e.g. a view over a missing table). */
  rows: number | null;
  columns: number;
  ddl: string | null;
}

export interface DbColumn {
  name: string;
  type: string;
  not_null: boolean;
  default: string | number | null;
  primary_key: boolean;
}

export type DbCell = string | number | boolean | null;

export interface DbQueryResult {
  source: string;
  columns: string[];
  rows: DbCell[][];
  row_count: number;
  /** True when the query had more rows than the limit — the grid says so rather than
   * letting the last visible row read as the end of the table. */
  truncated: boolean;
  limit: number;
  elapsed_ms: number;
  sql: string;
}

function readSession(key: string): AdminSession | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AdminSession;
    if (!parsed.token || parsed.expires_at * 1000 <= Date.now()) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

export function getStoredSession(): AdminSession | null {
  return readSession(TOKEN_KEY);
}

function setStoredSession(session: AdminSession): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(session));
}

export function clearStoredSession(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** Whichever session may open the monitor. The admin one is preferred, so someone
 * already logged in is never asked for the passcode on top of it. */
export function getMonitorAccess(): AdminSession | null {
  return getStoredSession() ?? readSession(MONITOR_TOKEN_KEY);
}

/** Drops both, because either could be the one the server just rejected — leaving the
 * expired admin token in place would keep it winning over a fresh passcode session and
 * lock the page out of its own unlock. */
export function clearMonitorAccess(): void {
  localStorage.removeItem(MONITOR_TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

export class AdminAuthError extends Error {}

/** A refusal the visitor is expected to act on — a wrong passcode, or too many tries —
 * as opposed to AdminAuthError, which means "your session is gone, start again". */
export class MonitorLockedError extends Error {}

export async function login(username: string, password: string): Promise<void> {
  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const detail = await res
      .json()
      .then((body) => (typeof body?.detail === "string" ? body.detail : null))
      .catch(() => null);
    throw new AdminAuthError(detail ?? "아이디 또는 비밀번호가 올바르지 않습니다.");
  }
  const data = (await res.json()) as AdminSession;
  setStoredSession(data);
}

/** Trades the monitor passcode for a monitor-scoped session. */
export async function unlockMonitor(passcode: string): Promise<void> {
  const res = await fetch(`${BASE}/monitor/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passcode }),
  });
  if (!res.ok) {
    const detail = await res
      .json()
      .then((body) => (typeof body?.detail === "string" ? body.detail : null))
      .catch(() => null);
    throw new MonitorLockedError(detail ?? "패스코드가 올바르지 않습니다.");
  }
  const data = (await res.json()) as AdminSession;
  localStorage.setItem(MONITOR_TOKEN_KEY, JSON.stringify(data));
}

async function authedGet<T>(path: string): Promise<T> {
  const session = getStoredSession();
  if (!session) throw new AdminAuthError("로그인이 필요합니다.");
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (res.status === 401) {
    clearStoredSession();
    throw new AdminAuthError("세션이 만료되었습니다. 다시 로그인해 주세요.");
  }
  if (!res.ok) throw new Error(`Admin API error: ${res.status}`);
  return res.json() as Promise<T>;
}

/** The monitor's GET, which differs from authedGet only in which session it presents
 * and which it clears when the server says no. */
async function monitorGet<T>(path: string): Promise<T> {
  const session = getMonitorAccess();
  if (!session) throw new AdminAuthError("패스코드가 필요합니다.");
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (res.status === 401) {
    clearMonitorAccess();
    throw new AdminAuthError("세션이 만료되었습니다. 패스코드를 다시 입력해 주세요.");
  }
  if (!res.ok) throw new Error(`Admin API error: ${res.status}`);
  return res.json() as Promise<T>;
}

async function authedDelete(path: string): Promise<void> {
  const session = getStoredSession();
  if (!session) throw new AdminAuthError("로그인이 필요합니다.");
  const res = await fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (res.status === 401) {
    clearStoredSession();
    throw new AdminAuthError("세션이 만료되었습니다. 다시 로그인해 주세요.");
  }
  if (!res.ok) throw new Error(`Admin API error: ${res.status}`);
}

async function authedPatch<T>(path: string, body: unknown): Promise<T> {
  const session = getStoredSession();
  if (!session) throw new AdminAuthError("로그인이 필요합니다.");
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    clearStoredSession();
    throw new AdminAuthError("세션이 만료되었습니다. 다시 로그인해 주세요.");
  }
  if (!res.ok) throw new Error(`Admin API error: ${res.status}`);
  return res.json() as Promise<T>;
}

async function authedPost<T>(path: string): Promise<T> {
  const session = getStoredSession();
  if (!session) throw new AdminAuthError("로그인이 필요합니다.");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (res.status === 401) {
    clearStoredSession();
    throw new AdminAuthError("세션이 만료되었습니다. 다시 로그인해 주세요.");
  }
  if (!res.ok) {
    // Surface the server's own message (e.g. "KR 배치가 이미 실행 중입니다.") so a
    // 409 from a double-click reads as a real explanation, not a bare status code.
    const detail = await res
      .json()
      .then((body) => (typeof body?.detail === "string" ? body.detail : null))
      .catch(() => null);
    throw new Error(detail ?? `Admin API error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function authedPostJson<T>(path: string, body: unknown): Promise<T> {
  const session = getStoredSession();
  if (!session) throw new AdminAuthError("로그인이 필요합니다.");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    clearStoredSession();
    throw new AdminAuthError("세션이 만료되었습니다. 다시 로그인해 주세요.");
  }
  if (!res.ok) {
    // The DB console's 400s carry the reason the query was refused ("SELECT 문만
    // 실행할 수 있습니다.") or SQLite's own parse error — both are meant to be read
    // by the person who typed the query, so they are surfaced verbatim.
    const detail = await res
      .json()
      .then((body) => (typeof body?.detail === "string" ? body.detail : null))
      .catch(() => null);
    throw new Error(detail ?? `Admin API error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Same detail-surfacing as authedPostJson, for the GET side of the DB console. */
async function authedGetDetailed<T>(path: string): Promise<T> {
  const session = getStoredSession();
  if (!session) throw new AdminAuthError("로그인이 필요합니다.");
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (res.status === 401) {
    clearStoredSession();
    throw new AdminAuthError("세션이 만료되었습니다. 다시 로그인해 주세요.");
  }
  if (!res.ok) {
    const detail = await res
      .json()
      .then((body) => (typeof body?.detail === "string" ? body.detail : null))
      .catch(() => null);
    throw new Error(detail ?? `Admin API error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function sourceParam(source: string | null, separator: "?" | "&" = "?"): string {
  return source ? `${separator}source=${encodeURIComponent(source)}` : "";
}

export const adminApi = {
  summary: () => authedGet<AdminSummary>("/summary"),
  trend: (range: AdminTrendRange) => authedGet<TrendResponse>(`/pages/trend?range=${range}`),
  // Fixed 1-week ranking, independent of the trend chart's own range toggle —
  // see admin.py's _RANKING_WINDOW.
  pagesTop: (limit = 7) => authedGet<{ items: PageCount[] }>(`/pages/top?limit=${limit}`),
  stocksTop: (limit = 10) => authedGet<{ items: StockSearchCount[] }>(`/stocks/top?limit=${limit}`),
  tail: (limit = 100) => authedGet<{ events: ActivityEvent[] }>(`/live/tail?limit=${limit}`),
  sessions: () => authedGet<{ sessions: ActiveSession[] }>("/live/sessions"),
  monitorGraph: () => monitorGet<MonitorGraph>("/monitor/graph"),
  // Cursor-based: the response carries the cursors to send next time, so a viewer open
  // for an hour polls the same tiny payload as one that just opened.
  monitorPulse: (apiCursor: number, activityCursor: number) =>
    monitorGet<MonitorPulse>(`/monitor/pulse?api_cursor=${apiCursor}&activity_cursor=${activityCursor}`),
  comments: (limit = 200) => authedGet<{ items: AdminComment[] }>(`/comments?limit=${limit}`),
  deleteComment: (source: CommentSource, id: number) => authedDelete(`/comments/${source}/${id}`),
  setCommentVisibility: (source: CommentSource, id: number, visible: boolean) =>
    authedPatch<{ visible: boolean }>(`/comments/${source}/${id}/visibility`, { visible }),
  predictionStatus: () => authedGet<PredictionStatus>("/prediction/status"),
  // force=true always: the confirm dialog in front of this call already promises
  // "해당 일자 데이터를 삭제 후 재생성합니다" (delete and regenerate that day's rows), which
  // is only true with force — without it, a day that already has rows (the common
  // case; the weekday cron or the Sunday catch-up already ran) makes this a silent
  // no-op that leaves the existing rows untouched instead of regenerating them.
  runPrediction: (region: BatchRegion) =>
    authedPost<{ region: string; status: string }>(`/prediction/run?region=${region}&force=true`),

  kakaoVisitorStatus: () => authedGet<KakaoVisitorStatus>("/notify/kakao/visitors/status"),
  runKakaoVisitorNotify: () => authedPost<KakaoVisitorRun>("/notify/kakao/visitors/run"),

  kakaoPredictionStatus: () => authedGet<KakaoPredictionStatus>("/notify/kakao/prediction/status"),
  runKakaoPredictionNotify: (region: BatchRegion) =>
    authedPost<KakaoPredictionRun>(`/notify/kakao/prediction/run?region=${region}`),

  dbSources: () => authedGet<{ sources: DbSource[] }>("/db/sources"),
  dbTables: (source: string | null) =>
    authedGetDetailed<{ tables: DbTable[] }>(`/db/tables${sourceParam(source)}`),
  dbColumns: (table: string, source: string | null) =>
    authedGetDetailed<{ columns: DbColumn[] }>(
      `/db/tables/${encodeURIComponent(table)}/columns${sourceParam(source)}`
    ),
  /** What a double-click on a table runs — the newest-first default query, executed
   * server-side and returned with its SQL so the editor can show what ran. */
  dbPreview: (table: string, source: string | null, limit: number) =>
    authedGetDetailed<DbQueryResult>(
      `/db/tables/${encodeURIComponent(table)}/preview?limit=${limit}${sourceParam(source, "&")}`
    ),
  dbQuery: (sql: string, source: string | null, limit: number) =>
    authedPostJson<DbQueryResult>("/db/query", { sql, source, limit }),
};
