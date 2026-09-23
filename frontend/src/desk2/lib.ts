import { useEffect, useState } from "react";
import { GlobalIndexWidget, MarketMapItem, StockSearchResult, api } from "../api/client";
import { Lang, useLanguage } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { navigate } from "../router";

/* Shared plumbing for the /desk2 broadsheet.
 *
 * Everything here is either formatting or a refcounted poll. The formatting is
 * gathered in one place because a newspaper page lives or dies on the numbers
 * being set the same way everywhere — a sign, a thin space, the same number of
 * decimals for the same kind of figure — and the old desk's components each
 * carried their own copy of pct() and formatAmount(), which had drifted. */

export type Tone = "up" | "down" | "flat";

export function toneOf(value: number | null | undefined): Tone {
  if (value === null || value === undefined || !Number.isFinite(value)) return "flat";
  return value > 0 ? "up" : value < 0 ? "down" : "flat";
}

/** Bilingual copy without a dictionary round trip. The desk's own strings are
 * new, so rather than growing the shared dictionary by a hundred entries that
 * only this page reads, each call site carries both languages. */
export function useL(): (ko: string, en: string) => string {
  const { lang } = useLanguage();
  return (ko, en) => (lang === "en" ? en : ko);
}

export function signed(value: number, digits = 2): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

export function pct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${signed(value, digits)}%`;
}

export function num(value: number, digits = 0): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function arrow(value: number): string {
  return value > 0 ? "▲" : value < 0 ? "▼" : "–";
}

/** An investor flow quoted in 억원, the unit Naver publishes it in. */
export function eok(value: number, lang: Lang, withSign = true): string {
  // A flow that rounds to nothing is set as a plain zero, never "−0억".
  if (Math.round(Math.abs(value)) === 0) value = 0;
  const abs = Math.abs(value);
  const sign = withSign ? (value > 0 ? "+" : value < 0 ? "−" : "") : "";
  if (lang === "en") {
    if (abs >= 10_000) return `${sign}₩${(abs / 10_000).toFixed(2)}T`;
    return `${sign}₩${(abs / 10).toFixed(1)}B`;
  }
  if (abs >= 10_000) return `${sign}${(abs / 10_000).toFixed(2)}조`;
  return `${sign}${Math.round(abs).toLocaleString()}억`;
}

/** A won amount, set in 조/억. */
export function won(value: number, lang: Lang): string {
  if (!value) return "—";
  if (lang === "en") {
    if (value >= 1e12) return `₩${(value / 1e12).toFixed(1)}T`;
    return `₩${(value / 1e9).toFixed(1)}B`;
  }
  if (value >= 1e12) return `${(value / 1e12).toFixed(1)}조`;
  return `${Math.round(value / 1e8).toLocaleString()}억`;
}

export function usd(value: number): string {
  if (!value) return "—";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  return `$${(value / 1e6).toFixed(0)}M`;
}

export function shares(value: number, lang: Lang): string {
  if (!value) return "—";
  if (lang === "en") {
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M sh`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K sh`;
    return `${value} sh`;
  }
  if (value >= 1e8) return `${(value / 1e8).toFixed(1)}억주`;
  if (value >= 1e4) return `${Math.round(value / 1e4).toLocaleString()}만주`;
  return `${value.toLocaleString()}주`;
}

export function krwPrice(value: number, lang: Lang): string {
  return lang === "en" ? `₩${value.toLocaleString()}` : `${value.toLocaleString()}원`;
}

export function usdPrice(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function turnoverOf(item: MarketMapItem): number {
  return item.turnover ?? (item.volume ?? 0) * item.close;
}

/** Where a click on any stock row goes. The desk has no workspace of its own —
 * the detail page is the workspace — so every row is a link to it. */
export function openStock(stock: StockSearchResult | { code: string; asset_type?: "STOCK" | "ETF" }): void {
  const etf = "asset_type" in stock && stock.asset_type === "ETF";
  navigate(`/stock/${encodeURIComponent(stock.code)}${etf ? "?asset=ETF" : ""}`);
}

export function openEtf(code: string): void {
  navigate(`/stock/${encodeURIComponent(code)}?asset=ETF`);
}

/* ── time ────────────────────────────────────────────────────────────────── */

export const SEOUL = "Asia/Seoul";
export const NEW_YORK = "America/New_York";

export function zoneParts(now: Date, tz: string): { y: number; m: number; d: number; wd: number; min: number; sec: number } {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now)) {
    out[p.type] = p.value;
  }
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(out.weekday);
  const hour = Number(out.hour) % 24;
  return {
    y: Number(out.year),
    m: Number(out.month),
    d: Number(out.day),
    wd,
    min: hour * 60 + Number(out.minute),
    sec: Number(out.second),
  };
}

export function clockText(now: Date, tz: string, withSeconds = true): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hour12: false,
  }).format(now);
}

/** A ticking clock that stands down while the tab is hidden. */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let id: number | undefined;
    const start = () => {
      if (id !== undefined) return;
      setNow(new Date());
      id = window.setInterval(() => setNow(new Date()), intervalMs);
    };
    const stop = () => {
      window.clearInterval(id);
      id = undefined;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
  return now;
}

/* ── global indices, shared ──────────────────────────────────────────────── */

/* The front page's headline quotes the Nasdaq and the global band draws every
   index in full, so the one endpoint gets two readers. Same refcounted shape as
   useMarketIndices. */
let globalItems: GlobalIndexWidget[] | null = null;
const globalListeners = new Set<(items: GlobalIndexWidget[] | null) => void>();
let stopGlobal: (() => void) | null = null;

function loadGlobal() {
  api
    .globalIndices()
    .then((res) => {
      globalItems = res.items;
      globalListeners.forEach((fn) => fn(globalItems));
    })
    .catch(() => {
      if (globalItems === null) {
        globalItems = [];
        globalListeners.forEach((fn) => fn(globalItems));
      }
    });
}

export function useGlobalIndices(): GlobalIndexWidget[] | null {
  const [items, setItems] = useState<GlobalIndexWidget[] | null>(globalItems);
  useEffect(() => {
    globalListeners.add(setItems);
    if (globalItems !== null) setItems(globalItems);
    if (globalListeners.size === 1) {
      loadGlobal();
      stopGlobal = startVisibilityAwareInterval(loadGlobal, 60_000);
    }
    return () => {
      globalListeners.delete(setItems);
      if (globalListeners.size === 0) {
        stopGlobal?.();
        stopGlobal = null;
      }
    };
  }, []);
  return items;
}

/* ── the fear & greed readings ───────────────────────────────────────────── */

export interface SentimentReading {
  key: "kospi" | "kosdaq" | "sp500";
  name: string;
  score: number | null;
}

/** Same three sources the classic desk reads: the published KOSPI and US
 * fear/greed indices, and a KOSDAQ reading derived from a year of closes
 * (momentum against the 20-day mean, discounted for volatility). */
function kosdaqScore(points: Array<{ close?: number }>): number | null {
  const a = points.map((p) => Number(p.close)).filter(Number.isFinite);
  if (a.length < 30) return null;
  const r = a.slice(-20);
  const mean = r.reduce((x, y) => x + y, 0) / r.length;
  const momentum = (a[a.length - 1] / mean - 1) * 50 + 50;
  const vol = Math.sqrt(r.slice(1).reduce((s, v, i) => s + (v / r[i] - 1) ** 2, 0) / (r.length - 1)) * 100;
  return Math.round(Math.max(0, Math.min(100, momentum - Math.max(0, vol - 1.5) * 8)));
}

export function useSentiment(): SentimentReading[] {
  const [items, setItems] = useState<SentimentReading[]>([
    { key: "kospi", name: "KOSPI", score: null },
    { key: "kosdaq", name: "KOSDAQ", score: null },
    { key: "sp500", name: "S&P 500", score: null },
  ]);
  useEffect(() => {
    const c = new AbortController();
    Promise.allSettled([
      fetch("https://kospi.feargreedchart.com/api/?action=kospi", { signal: c.signal }).then((r) => r.json()),
      fetch("https://feargreedchart.com/api/?action=all", { signal: c.signal }).then((r) => r.json()),
      fetch("/api/market/index/KOSDAQ/history?years=1", { signal: c.signal }).then((r) => r.json()),
    ]).then(([kr, us, kd]) => {
      if (c.signal.aborted) return;
      const k = kr.status === "fulfilled" && Number.isFinite(+kr.value?.score) ? +kr.value.score : null;
      const s = us.status === "fulfilled" && Number.isFinite(+us.value?.score?.score) ? +us.value.score.score : null;
      const d = kd.status === "fulfilled" ? kosdaqScore(kd.value?.points ?? []) : null;
      setItems([
        { key: "kospi", name: "KOSPI", score: k },
        { key: "kosdaq", name: "KOSDAQ", score: d },
        { key: "sp500", name: "S&P 500", score: s },
      ]);
    });
    return () => c.abort();
  }, []);
  return items;
}

export function sentimentLabel(score: number, lang: Lang): string {
  if (lang === "en") {
    return score <= 20 ? "Extreme fear" : score <= 40 ? "Fear" : score <= 60 ? "Neutral" : score <= 80 ? "Greed" : "Extreme greed";
  }
  return score <= 20 ? "극단적 공포" : score <= 40 ? "공포" : score <= 60 ? "중립" : score <= 80 ? "탐욕" : "극단적 탐욕";
}

/* ── breadth ─────────────────────────────────────────────────────────────── */

export interface SectorHeat {
  sector: string;
  change: number;
  members: number;
  cap: number;
}

export interface Breadth {
  total: number;
  up: number;
  down: number;
  flat: number;
  strongUp: number;
  strongDown: number;
  limitUp: MarketMapItem[];
  limitDown: MarketMapItem[];
  /** 0 = everything down, 100 = everything up — share of decisive names that rose. */
  temperature: number;
  capWeighted: number;
  equalWeighted: number;
  /** Every sector with at least three members, strongest first. */
  sectors: SectorHeat[];
  /** Counts per bucket of today's move, in HISTOGRAM_BINS order. */
  histogram: number[];
  /** The day's heaviest turnover, for the front page. */
  topTurnover: MarketMapItem[];
}

export const STRONG_PCT = 5;
/** KRX's daily limit is ±30%; a print at 29.5% or beyond is at the limit once
 * tick rounding is allowed for. */
const LIMIT_PCT = 29.5;

/** Upper bounds (exclusive) of each bucket; the last is open-ended. Zero gets a
 * bucket of its own because "unchanged" is a distinct reading, not a thin slice
 * of either side. */
export const HISTOGRAM_BINS: { label: string; test: (v: number) => boolean; tone: Tone }[] = [
  { label: "−10↓", test: (v) => v <= -10, tone: "down" },
  { label: "−5", test: (v) => v > -10 && v <= -5, tone: "down" },
  { label: "−3", test: (v) => v > -5 && v <= -3, tone: "down" },
  { label: "−1", test: (v) => v > -3 && v <= -1, tone: "down" },
  { label: "−0", test: (v) => v > -1 && v < 0, tone: "down" },
  { label: "0", test: (v) => v === 0, tone: "flat" },
  { label: "+0", test: (v) => v > 0 && v < 1, tone: "up" },
  { label: "+1", test: (v) => v >= 1 && v < 3, tone: "up" },
  { label: "+3", test: (v) => v >= 3 && v < 5, tone: "up" },
  { label: "+5", test: (v) => v >= 5 && v < 10, tone: "up" },
  { label: "+10↑", test: (v) => v >= 10, tone: "up" },
];

export function measureBreadth(items: MarketMapItem[]): Breadth | null {
  if (items.length === 0) return null;
  let up = 0,
    down = 0,
    strongUp = 0,
    strongDown = 0,
    capSum = 0,
    capTotal = 0,
    plainSum = 0;
  const limitUp: MarketMapItem[] = [];
  const limitDown: MarketMapItem[] = [];
  const histogram = HISTOGRAM_BINS.map(() => 0);
  const buckets = new Map<string, { sum: number; cap: number; members: number }>();

  for (const item of items) {
    const v = item.change_pct;
    if (v > 0) up += 1;
    else if (v < 0) down += 1;
    if (v >= STRONG_PCT) strongUp += 1;
    else if (v <= -STRONG_PCT) strongDown += 1;
    if (v >= LIMIT_PCT) limitUp.push(item);
    else if (v <= -LIMIT_PCT) limitDown.push(item);
    const bin = HISTOGRAM_BINS.findIndex((b) => b.test(v));
    if (bin >= 0) histogram[bin] += 1;

    const size = Math.max(item.market_cap ?? item.marcap, 0);
    capSum += v * size;
    capTotal += size;
    plainSum += v;

    const sector = item.sector?.trim();
    if (!sector) continue;
    const cap = Math.max(item.marcap, 0);
    const bucket = buckets.get(sector);
    if (bucket) {
      bucket.sum += v * cap;
      bucket.cap += cap;
      bucket.members += 1;
    } else {
      buckets.set(sector, { sum: v * cap, cap, members: 1 });
    }
  }

  const sectors: SectorHeat[] = [];
  for (const [sector, b] of buckets) {
    if (b.members < 3 || b.cap <= 0) continue;
    sectors.push({ sector, change: b.sum / b.cap, members: b.members, cap: b.cap });
  }
  sectors.sort((a, b) => b.change - a.change);

  const topTurnover = [...items]
    .filter((item) => turnoverOf(item) > 0)
    .sort((a, b) => turnoverOf(b) - turnoverOf(a))
    .slice(0, 5);

  const decisive = up + down;
  return {
    total: items.length,
    up,
    down,
    flat: items.length - up - down,
    strongUp,
    strongDown,
    limitUp: limitUp.sort((a, b) => b.change_pct - a.change_pct),
    limitDown: limitDown.sort((a, b) => a.change_pct - b.change_pct),
    temperature: decisive > 0 ? (up / decisive) * 100 : 50,
    capWeighted: capTotal > 0 ? capSum / capTotal : 0,
    equalWeighted: items.length > 0 ? plainSum / items.length : 0,
    sectors,
    histogram,
    topTurnover,
  };
}

export function moodOf(temperature: number, lang: Lang): { label: string; tone: "hot" | "warm" | "even" | "cool" | "cold" } {
  const ko = lang !== "en";
  if (temperature >= 70) return { label: ko ? "상승 폭넓음" : "Broad advance", tone: "hot" };
  if (temperature >= 56) return { label: ko ? "상승 우세" : "Advancers lead", tone: "warm" };
  if (temperature > 44) return { label: ko ? "혼조세" : "Mixed", tone: "even" };
  if (temperature > 30) return { label: ko ? "하락 우세" : "Decliners lead", tone: "cool" };
  return { label: ko ? "하락 폭넓음" : "Broad decline", tone: "cold" };
}
