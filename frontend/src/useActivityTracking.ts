import { useEffect, useRef } from "react";
import { getSessionId } from "./session";

const EVENT_ENDPOINT = "/api/activity/event";
const CLICK_DEBOUNCE_MS = 500;

/** A route's display name in the admin statistics.
 *
 * Every route App.tsx can render needs its own entry here, and the fallback
 * has to be something that reads as "unrecognised". Three separate rows in
 * the admin ranking used to come back labelled "대시보드" with no way to tell
 * them apart: /dashboard, which really is the stock desk, plus /global and
 * /ai-prediction, which had no case of their own and so landed on the old
 * fallback — which returned "대시보드" too. Anything unmatched is now "기타",
 * so a route added to App.tsx without a line here shows up as obviously
 * missing rather than quietly impersonating the desk. */
export function pageLabel(path: string): string {
  // "/" is the orbit entrance now, not the stock desk — the desk moved to
  // /dashboard. Without this the admin dashboard filed every landing on the new
  // main page under "대시보드" and the two were indistinguishable in the stats.
  if (path === "/") return "메인 (태양계)";
  if (path === "/dashboard") return "종목 대시보드";
  if (/^\/investor\//.test(path)) return "투자자 동향";
  if (/^\/index\/(kospi|kosdaq)/i.test(path)) return "지수 차트";
  if (path === "/kospi-100") return "코스피 100";
  if (path === "/kosdaq-100") return "코스닥 100";
  if (path === "/nasdaq-100") return "나스닥 100";
  if (path === "/map") return "KOSPI 맵";
  if (path === "/kosdaq-map") return "KOSDAQ 맵";
  if (path === "/sp500-map") return "S&P500 맵";
  if (path === "/nasdaq100-map") return "NASDAQ100 맵";
  if (path === "/global") return "해외 종목";
  if (path === "/battle") return "줄다리기";
  if (path === "/fight") return "시총대결";
  if (path === "/news") return "뉴스";
  if (path === "/ai-prediction") return "AI 종목예측";
  if (path === "/ai-prediction/grading") return "AI 예측 채점";
  if (path === "/admin") return "관리자 로그인";
  if (path === "/admin/dashboard") return "관리자 대시보드";
  if (path === "/admin/db") return "관리자 DB";
  return "기타";
}

function isAdminPath(path: string): boolean {
  return path === "/admin" || path.startsWith("/admin/");
}

function sendEvent(body: Record<string, unknown>) {
  fetch(EVENT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: getSessionId(), ...body }),
    keepalive: true,
  }).catch(() => {
    // Best-effort telemetry — a dropped event isn't worth surfacing to the visitor.
  });
}

export function reportStockView(code: string, name: string): void {
  if (isAdminPath(window.location.pathname)) return;
  sendEvent({
    type: "stock_view",
    path: window.location.pathname,
    stock_code: code,
    stock_name: name,
  });
}

/** Mounted once at the app root. Reports a page_view whenever `path` changes, and a
 * click event (debounced per label+path) for clicks on interactive elements — the
 * data behind the admin dashboard's live tail and per-page trend graph. Events that
 * occur on the admin pages themselves are never sent, so admin usage never pollutes
 * the stats it displays. */
export function useActivityTracking(path: string): void {
  const lastClickRef = useRef<{ key: string; ts: number } | null>(null);

  useEffect(() => {
    if (isAdminPath(path)) return;
    sendEvent({ type: "page_view", path, label: pageLabel(path) });
  }, [path]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const currentPath = window.location.pathname;
      if (isAdminPath(currentPath)) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const interactive = target.closest("a, button, [role='button'], .search-option");
      if (!interactive) return;
      const label =
        interactive.getAttribute("aria-label") ||
        interactive.getAttribute("title") ||
        interactive.textContent?.trim().slice(0, 100) ||
        interactive.tagName.toLowerCase();
      const key = `${currentPath}::${label}`;
      const now = Date.now();
      const last = lastClickRef.current;
      if (last && last.key === key && now - last.ts < CLICK_DEBOUNCE_MS) return;
      lastClickRef.current = { key, ts: now };
      sendEvent({ type: "click", path: currentPath, label });
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}
