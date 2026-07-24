const BASE = "/api/admin";
const TOKEN_KEY = "admin_session";

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

export type CommentSource = "battle" | "fight";

export interface AdminComment {
  id: number;
  source: CommentSource;
  stock_name: string;
  text: string;
  created_at: string;
  visible: boolean;
}

export function getStoredSession(): AdminSession | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AdminSession;
    if (!parsed.token || parsed.expires_at * 1000 <= Date.now()) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return parsed;
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    return null;
  }
}

function setStoredSession(session: AdminSession): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(session));
}

export function clearStoredSession(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class AdminAuthError extends Error {}

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

export const adminApi = {
  summary: () => authedGet<AdminSummary>("/summary"),
  trend: (range: AdminTrendRange) => authedGet<TrendResponse>(`/pages/trend?range=${range}`),
  // Fixed 1-week ranking, independent of the trend chart's own range toggle —
  // see admin.py's _RANKING_WINDOW.
  pagesTop: (limit = 7) => authedGet<{ items: PageCount[] }>(`/pages/top?limit=${limit}`),
  stocksTop: (limit = 10) => authedGet<{ items: StockSearchCount[] }>(`/stocks/top?limit=${limit}`),
  tail: (limit = 100) => authedGet<{ events: ActivityEvent[] }>(`/live/tail?limit=${limit}`),
  sessions: () => authedGet<{ sessions: ActiveSession[] }>("/live/sessions"),
  comments: (limit = 200) => authedGet<{ items: AdminComment[] }>(`/comments?limit=${limit}`),
  deleteComment: (source: CommentSource, id: number) => authedDelete(`/comments/${source}/${id}`),
  setCommentVisibility: (source: CommentSource, id: number, visible: boolean) =>
    authedPatch<{ visible: boolean }>(`/comments/${source}/${id}/visibility`, { visible }),
  predictionStatus: () => authedGet<PredictionStatus>("/prediction/status"),
  runPrediction: (region: BatchRegion) =>
    authedPost<{ region: string; status: string }>(`/prediction/run?region=${region}`),
};
