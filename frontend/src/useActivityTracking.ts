import { useEffect, useRef } from "react";
import { getSessionId } from "./session";

const EVENT_ENDPOINT = "/api/activity/event";
const CLICK_DEBOUNCE_MS = 500;
const ATTRIBUTION_KEY = "traffic_attribution_v1";

type Attribution = {
  referrer: string;
  source_channel: "search" | "email" | "social" | "referral" | "direct";
  source_name: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
};

function acquisitionAttribution(): Attribution {
  try {
    const stored = sessionStorage.getItem(ATTRIBUTION_KEY);
    if (stored) return JSON.parse(stored) as Attribution;
  } catch { /* storage can be unavailable in private modes */ }
  const query = new URLSearchParams(window.location.search);
  const utmSource = query.get("utm_source") || "";
  const utmMedium = query.get("utm_medium") || "";
  const utmCampaign = query.get("utm_campaign") || "";
  const referrer = document.referrer || "";
  let host = "";
  try { host = referrer ? new URL(referrer).hostname.toLowerCase() : ""; } catch { host = ""; }
  const text = `${utmSource} ${utmMedium}`.toLowerCase();
  let source_channel: Attribution["source_channel"] = "direct";
  let source_name = utmSource || (host ? host.replace(/^www\./, "") : "direct");
  if (/email|newsletter|mail/.test(text)) source_channel = "email";
  else if (query.has("gclid") || /google\.|search\.naver\.|bing\.|search\.daum\./.test(host)) {
    source_channel = "search";
    source_name = query.has("gclid") || host.includes("google") ? "google" : host.includes("naver") ? "naver" : host.includes("daum") ? "daum" : "bing";
  } else if (/instagram|facebook|twitter|x\.com|youtube|t\.co|linkedin|threads/.test(host) || /social/.test(text)) source_channel = "social";
  else if (host && !host.includes(window.location.hostname)) source_channel = "referral";
  const result = { referrer, source_channel, source_name, utm_source: utmSource, utm_medium: utmMedium, utm_campaign: utmCampaign };
  try { sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(result)); } catch { /* best effort */ }
  return result;
}

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
  if (/^\/stock\/\d{6}$/i.test(path)) return "국내 종목 상세";
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
  if (path === "/discussion-explorer") return "종목토론";
  if (path === "/market-bubbles") return "증시버블";
  if (path === "/battle") return "줄다리기";
  if (path === "/fight") return "시총대결";
  if (path === "/news") return "뉴스";
  if (path === "/market-brief") return "오늘 브리핑";
  if (/^\/market-brief\/\d{4}-\d{2}-\d{2}\/(kospi|kosdaq|samsung|hynix|hyundai|sksquare|semco|\d{6})$/i.test(path)) return "날짜별 오늘 브리핑";
  if (path === "/ai-prediction") return "AI 종목예측";
  if (path === "/ai-prediction/grading") return "AI 예측 채점";
  if (path === "/admin") return "관리자 로그인";
  if (path === "/admin/dashboard") return "관리자 대시보드";
  if (path === "/admin/db") return "관리자 DB";
  if (path === "/admin/monitor") return "관리자 모니터";
  if (path === "/admin/growth") return "성장 통계";
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

export type MarketBubbleAction = "bubble_click" | "discussion_post" | "market_switch" | "stock_detail";

export function reportMarketBubbleEvent(options: {
  action: MarketBubbleAction;
  market: "kospi" | "kosdaq" | "nasdaq";
  code?: string;
  name?: string;
  detail?: string;
}): void {
  if (isAdminPath(window.location.pathname)) return;
  const actionLabels: Record<MarketBubbleAction, string> = {
    bubble_click: "버블 클릭",
    discussion_post: "토론 게시글 클릭",
    market_switch: "시장 전환",
    stock_detail: "종목 상세 이동",
  };
  sendEvent({
    type: "click",
    path: "/market-bubbles",
    label: `${actionLabels[options.action]} · ${options.name || options.market}${options.detail ? ` · ${options.detail}` : ""}`.slice(0, 100),
    stock_code: options.code,
    stock_name: options.name,
    object_key: `bubble:${options.action}:${options.market}:${options.code || options.market}`.slice(0, 100),
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
        label: `종목토론 · ${name} (${code}) · ${market}/${assetKind}`.slice(0, 100),
        stock_code: code,
        stock_name: name,
        ...acquisitionAttribution(),
      });
      return;
    }
    sendEvent({ type: "page_view", path, label: pageLabel(path), ...acquisitionAttribution() });
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
    function onChange(event: Event) {
      const currentPath = window.location.pathname;
      if (isAdminPath(currentPath)) return;
      const select = event.target instanceof HTMLSelectElement ? event.target : null;
      if (!select) return;
      const name = select.getAttribute("aria-label") || select.name || "선택 항목";
      sendEvent({
        type: "click",
        path: currentPath,
        label: `${name} 변경 · ${select.value || "최신"}`.slice(0, 100),
        object_key: `select:${select.value || "latest"}`.slice(0, 100),
      });
    }
    document.addEventListener("click", onClick, true);
    document.addEventListener("change", onChange, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("change", onChange, true);
    };
  }, []);
}
