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
  // Activity rows may originate from older clients that sent a query string or
  // trailing slash. Classify the canonical route instead of falling through to 기타.
  const cleanPath = path.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  path = cleanPath;
  // "/" is the orbit entrance now, not the stock desk — the desk moved to
  // /dashboard. Without this the admin dashboard filed every landing on the new
  // main page under "대시보드" and the two were indistinguishable in the stats.
  if (path === "/") return "메인 (태양계)";
  if (path === "/desk") return "마켓 데스크";
  if (path === "/dashboard") return "종목 대시보드 (구)";
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
  if (path === "/global-top100") return "글로벌 시총 TOP100";
  if (path === "/etf") return "ETF 마켓";
  if (path === "/discussion-explorer") return "종목토론탐험";
  if (path === "/battle") return "줄다리기";
  if (path === "/fight") return "시총대결";
  if (path === "/news") return "뉴스";
  if (path === "/ai-prediction") return "AI 종목예측";
  if (path === "/ai-prediction/grading") return "AI 예측 채점";
  if (path === "/admin") return "관리자 로그인";
  if (path === "/admin/dashboard") return "관리자 대시보드";
  if (path === "/admin/db") return "관리자 DB";
  if (path === "/admin/monitor") return "관리자 모니터";
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

/* ─────────────────────── the entrance page's own trail ───────────────────────
   The generic click handler below cannot describe the front page. It reads a
   label off whatever DOM element was clicked, and most of that page is a WebGL
   canvas — the planets are not elements, so tapping Jupiter reports nothing at
   all, and the controls that ARE elements come back as whatever text they
   happened to be showing. What follows is reported deliberately by the page
   itself, with stable keys, so a ranking can group by object across a rename
   and a session's trail reads as a sequence of decisions rather than of clicks.

   Kept as its own event type rather than more `click` rows: those feed the
   page-view counts, and a tap on a planet is not a page view. */
export type HubAction = "object_click" | "control" | "bgm" | "focus" | "dwell" | "exit";

export function reportHubEvent(
  action: HubAction,
  options: { key?: string; label?: string; value?: number } = {}
): void {
  if (isAdminPath(window.location.pathname)) return;
  sendEvent({
    type: "hub",
    path: window.location.pathname,
    action,
    object_key: options.key,
    label: options.label,
    value: options.value,
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

export function reportDiscussionPostClick(options: {
  code: string;
  name: string;
  title: string;
  postId: string;
  market: "KR" | "US";
  assetKind: "STOCK" | "ETF";
}): void {
  if (isAdminPath(window.location.pathname)) return;
  const context = `${options.market}/${options.assetKind}`;
  sendEvent({
    type: "click",
    path: "/discussion-explorer",
    label: `게시글 클릭 · ${options.title}`.slice(0, 100),
    stock_code: options.code,
    stock_name: options.name,
    object_key: `${context}:${options.postId}`.slice(0, 100),
  });
}

export function reportDiscussionSearchSelection(options: {
  code: string;
  name: string;
  market: "KR" | "US";
  assetKind: "STOCK" | "ETF";
}): void {
  if (isAdminPath(window.location.pathname)) return;
  sendEvent({
    type: "click",
    path: "/discussion-explorer",
    label: `종목 검색 이동 · ${options.name} (${options.code}) · ${options.market}/${options.assetKind}`.slice(0, 100),
    stock_code: options.code,
    stock_name: options.name,
    object_key: `search:${options.market}/${options.assetKind}:${options.code}`.slice(0, 100),
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
    if (path === "/discussion-explorer") {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code") || "005930";
      const name = params.get("name") || code;
      const market = params.get("market") === "US" ? "US" : "KR";
      const assetKind = params.get("asset") === "ETF" ? "ETF" : "STOCK";
      sendEvent({
        type: "page_view",
        path,
        label: `종목토론탐험 · ${name} (${code}) · ${market}/${assetKind}`.slice(0, 100),
        stock_code: code,
        stock_name: name,
      });
      return;
    }
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
