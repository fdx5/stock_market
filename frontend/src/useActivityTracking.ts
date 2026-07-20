import { useEffect, useRef } from "react";
import { getSessionId } from "./session";

const EVENT_ENDPOINT = "/api/activity/event";
const CLICK_DEBOUNCE_MS = 500;

export function pageLabel(path: string): string {
  if (/^\/investor\//.test(path)) return "투자자 동향";
  if (/^\/index\/(kospi|kosdaq)/i.test(path)) return "지수 차트";
  if (path === "/map") return "KOSPI 맵";
  if (path === "/kosdaq-map") return "KOSDAQ 맵";
  if (path === "/sp500-map") return "S&P500 맵";
  if (path === "/nasdaq100-map") return "NASDAQ100 맵";
  if (path === "/battle") return "줄다리기";
  if (path === "/fight") return "시총대결";
  if (path === "/news") return "뉴스";
  if (path === "/admin") return "관리자 로그인";
  if (path === "/admin/dashboard") return "관리자 대시보드";
  return "대시보드";
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
