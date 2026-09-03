import type { StockUniverseMarket, StockUniverseRow } from "../api/client";

/* What the three tabs of 종목정보 differ by, gathered in one table.
 *
 * The backend already normalised the *rows* (one shape, one meaning per field — see
 * services/stock_universe_page.py), so nothing here re-derives data. What is left is
 * genuinely presentational and genuinely per-market: which currency to print, which
 * discussion source the detail panel reads, which news endpoint answers for it.
 *
 * It lives in a table rather than in conditionals inside the components for the usual
 * reason — a fourth tab should be a row here, not a fourth branch in four files. */

export interface MarketSpec {
  key: StockUniverseMarket;
  /** The tab's own label. Short: it sits in a segmented control, not a heading. */
  label: string;
  /** Read under the label, to say what the list actually is. */
  caption: string;
  currency: "KRW" | "USD";
  /** Naver's 종목토론실 only exists for KRX codes. US names read Toss Securities'
   *  community board, which is where Korean retail actually discusses them; "global"
   *  is Naver's 해외종목 토론방, kept as the backend's fallback for a ticker Toss does
   *  not list and still used by the 증시버블 NASDAQ tab. */
  discussion: "naver" | "global" | "toss";
  /** finance.naver's per-code news tab, Naver news search by company name, or Toss's
   *  per-company feed — the last being the only one of the three that is a real feed
   *  for a US listing rather than a keyword search over one. */
  news: "naver-finance" | "naver-search" | "toss";
  assetType: "stock" | "etf";
  flag: "kr" | "us";
}

export const MARKETS: readonly MarketSpec[] = [
  { key: "kospi", label: "코스피", caption: "KOSPI", currency: "KRW", discussion: "naver", news: "naver-finance", assetType: "stock", flag: "kr" },
  { key: "kosdaq", label: "코스닥", caption: "KOSDAQ", currency: "KRW", discussion: "naver", news: "naver-finance", assetType: "stock", flag: "kr" },
  { key: "kr_etf", label: "국내 ETF", caption: "KRX ETF", currency: "KRW", discussion: "naver", news: "naver-finance", assetType: "etf", flag: "kr" },
  { key: "sp500", label: "S&P 500", caption: "미국 대형주", currency: "USD", discussion: "toss", news: "toss", assetType: "stock", flag: "us" },
  { key: "us_etf", label: "해외 ETF", caption: "US ETF", currency: "USD", discussion: "toss", news: "toss", assetType: "etf", flag: "us" },
];

/** The 업종 filter's "전체" option. A sentinel rather than "" so it can never collide
 *  with a real sector label (including "기타"); must match ALL_SECTORS in
 *  services/stock_universe_page.py, which is what actually applies the filter. */
export const ALL_SECTORS = "__all__";

export const DEFAULT_MARKET: StockUniverseMarket = "kospi";
/** 삼성전자 — what the page opens on, per spec. */
export const DEFAULT_CODE = "005930";

export function marketSpec(key: StockUniverseMarket): MarketSpec {
  return MARKETS.find((m) => m.key === key) ?? MARKETS[0];
}

/** The name to show: Korean when the translate cache has produced one, else the
 *  original. Never a placeholder — an English name reads fine, a gap does not. */
export function displayName(row: Pick<StockUniverseRow, "name" | "name_ko">): string {
  return row.name_ko?.trim() || row.name;
}

/* ───────────────────────────── numbers ─────────────────────────────
   Won and dollars are not the same problem. A KRX price is a whole number of won and
   is read in units of thousands; a US price is two decimals. Formatting them through
   one "format a price" helper with a currency flag is how a panel ends up printing
   ₩251,750.00 or $208, so they are separate functions and the call sites pick. */

export function formatPrice(value: number | null | undefined, currency: "KRW" | "USD"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return currency === "KRW"
    ? Math.round(value).toLocaleString("ko-KR")
    : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function priceUnit(currency: "KRW" | "USD"): string {
  return currency === "KRW" ? "원" : "USD";
}

export function formatChange(value: number | null | undefined, currency: "KRW" | "USD"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const body = currency === "KRW"
    ? Math.abs(Math.round(value)).toLocaleString("ko-KR")
    : Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value > 0 ? "▲" : value < 0 ? "▼" : "―"} ${body}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/** Market capitalisation at the scale each market is actually discussed in: 조/억 for
 *  won, T/B for dollars. A raw 1,483,493,196,780,000 is not a number anyone reads. */
export function formatMarketCap(value: number | null | undefined, currency: "KRW" | "USD"): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  if (currency === "KRW") {
    const jo = value / 1e12;
    if (jo >= 1) return `${jo.toFixed(jo >= 100 ? 0 : 1)}조`;
    return `${Math.round(value / 1e8).toLocaleString("ko-KR")}억`;
  }
  const trillion = value / 1e12;
  if (trillion >= 1) return `$${trillion.toFixed(2)}T`;
  return `$${(value / 1e9).toFixed(1)}B`;
}

export function formatVolume(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1e8) return `${(value / 1e8).toFixed(1)}억`;
  if (value >= 1e4) return `${Math.round(value / 1e4).toLocaleString("ko-KR")}만`;
  return Math.round(value).toLocaleString("ko-KR");
}

/** Up / down / flat, as a class suffix. The dead band matters: a 0.00% move printed in
 *  red because it is really -0.001% is a lie the eye believes faster than the number. */
export type Tone = "up" | "down" | "flat";

export function toneOf(changePct: number | null | undefined): Tone {
  if (changePct == null || !Number.isFinite(changePct)) return "flat";
  if (changePct > 0.005) return "up";
  if (changePct < -0.005) return "down";
  return "flat";
}

/* ───────────────────────────── paging ─────────────────────────────
   The rail can be 10 pages deep, which is too many for one button each and too few to
   hide behind arrows alone. This produces the usual windowed run with ellipses, and
   returns nulls for the gaps so the renderer does not have to re-detect them. */

export function pageWindow(current: number, total: number, span = 5): (number | null)[] {
  if (total <= span + 2) return Array.from({ length: total }, (_, i) => i + 1);
  const half = Math.floor(span / 2);
  let start = Math.max(2, current - half);
  const end = Math.min(total - 1, start + span - 1);
  start = Math.max(2, end - span + 1);

  const pages: (number | null)[] = [1];
  if (start > 2) pages.push(null);
  for (let page = start; page <= end; page += 1) pages.push(page);
  if (end < total - 1) pages.push(null);
  pages.push(total);
  return pages;
}

/** Naver's 종목토론 timestamps come back as "2026.08.25 14:03"; Toss's are ISO. Both
 *  are shown as "08.25 14:03" so one list reads consistently whichever fed it. */
export function shortDateTime(raw: string): string {
  if (!raw) return "";
  const iso = raw.includes("T") ? raw.replace("T", " ") : raw;
  const match = iso.match(/(\d{4})[.\-/](\d{2})[.\-/](\d{2})\s*(\d{2}:\d{2})?/);
  if (!match) return raw.slice(0, 16);
  const [, , month, day, time] = match;
  return time ? `${month}.${day} ${time}` : `${month}.${day}`;
}
