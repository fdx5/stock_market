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

export type AdminTrendRange = "1h" | "3h" | "6h" | "12h" | "24h" | "7d" | "30d";

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

export const adminApi = {
  summary: () => authedGet<AdminSummary>("/summary"),
  trend: (range: AdminTrendRange) => authedGet<TrendResponse>(`/pages/trend?range=${range}`),
  // Fixed 1-week ranking, independent of the trend chart's own range toggle —
  // see admin.py's _RANKING_WINDOW.
  pagesTop: (limit = 7) => authedGet<{ items: PageCount[] }>(`/pages/top?limit=${limit}`),
  stocksTop: (limit = 10) => authedGet<{ items: StockSearchCount[] }>(`/stocks/top?limit=${limit}`),
  tail: (limit = 100) => authedGet<{ events: ActivityEvent[] }>(`/live/tail?limit=${limit}`),
  sessions: () => authedGet<{ sessions: ActiveSession[] }>("/live/sessions"),
};
