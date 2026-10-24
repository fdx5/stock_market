import type { StockBoard } from "../api/client";

export const MARKETS = ["kospi", "kosdaq", "nasdaq"] as const;
export type DiscoveryMarket = typeof MARKETS[number];
export const MARKET_NAMES: Record<DiscoveryMarket, string> = { kospi: "코스피 TOP 100", kosdaq: "코스닥 TOP 100", nasdaq: "나스닥 TOP 100" };
export const SORTS = ["change", "change-asc", "amount", "cap", "m1", "m3", "per", "high"] as const;
export type DiscoverySort = typeof SORTS[number];
export const PRESETS = ["all", "gainers", "losers", "liquid", "near-high", "value"] as const;
export type DiscoveryPreset = typeof PRESETS[number];
export type DiscoveryRow = {
  id: string; market: DiscoveryMarket; currency: "KRW" | "USD"; code: string; name: string;
  sector: string; close: number | null; change: number | null; cap: number | null;
  volume: number | null; amount: number | null; per: number | null; roe: number | null;
  high: number | null; low: number | null; highGap: number | null;
  w1: number | null; m1: number | null; m3: number | null; ytd: number | null;
};
export type DiscoveryFilters = {
  market: DiscoveryMarket; q: string; sector: string; preset: DiscoveryPreset;
  sort: DiscoverySort; minChange: number | null; maxPer: number | null;
};
export const finite = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const positive = (v: unknown) => { const n = finite(v); return n !== null && n > 0 ? n : null; };

export function discoveryRows(boards: Partial<Record<DiscoveryMarket, StockBoard>>): DiscoveryRow[] {
  return MARKETS.flatMap(market => (boards[market]?.items ?? []).map(item => {
    const close = positive(item.close), volume = finite(item.volume), high = positive(item.week52_high);
    return {
      id: `${market}:${item.code}`, market, currency: market === "nasdaq" ? "USD" as const : "KRW" as const,
      code: item.code, name: item.name_ko || item.name, sector: item.sector || "미분류",
      close, change: finite(item.change_pct), cap: positive(market === "nasdaq" ? item.market_cap : item.marcap),
      volume: volume !== null && volume >= 0 ? volume : null,
      amount: close !== null && volume !== null && volume >= 0 ? finite(close * volume) : null,
      per: positive(item.per), roe: finite(item.roe), high, low: positive(item.week52_low),
      highGap: close !== null && high !== null ? (close / high - 1) * 100 : null,
      w1: finite(item.returns?.w1), m1: finite(item.returns?.m1), m3: finite(item.returns?.m3), ytd: finite(item.returns?.ytd),
    };
  }));
}

export function readFilters(params: URLSearchParams): DiscoveryFilters {
  const member = <T extends string>(value: string | null, options: readonly T[], fallback: T): T => options.includes(value as T) ? value as T : fallback;
  const number = (key: string, min: number, max: number) => {
    const raw = params.get(key);
    if (!raw?.trim()) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  return { market: member(params.get("market"), MARKETS, "kospi"), q: (params.get("q") ?? "").slice(0, 80),
    sector: (params.get("sector") ?? "").slice(0, 100), preset: member(params.get("preset"), PRESETS, "all"),
    sort: member(params.get("sort"), SORTS, "change"), minChange: number("min", -100, 1000), maxPer: number("per", 0.01, 10000) };
}

export function screenRows(rows: DiscoveryRow[], filters: DiscoveryFilters): DiscoveryRow[] {
  const query = filters.q.toLocaleLowerCase("ko-KR").trim();
  const result = rows.filter(row => {
    if (row.market !== filters.market || (filters.sector && row.sector !== filters.sector)) return false;
    if (query && !`${row.code} ${row.name}`.toLocaleLowerCase("ko-KR").includes(query)) return false;
    if (filters.minChange !== null && (row.change === null || row.change < filters.minChange)) return false;
    if (filters.maxPer !== null && (row.per === null || row.per > filters.maxPer)) return false;
    if (filters.preset === "gainers") return row.change !== null && row.change > 0;
    if (filters.preset === "losers") return row.change !== null && row.change < 0;
    if (filters.preset === "liquid") return row.amount !== null && row.amount > 0;
    if (filters.preset === "near-high") return row.highGap !== null && row.highGap <= 0 && row.highGap >= -5;
    if (filters.preset === "value") return row.per !== null && row.per <= 15;
    return true;
  });
  const key = ({ "change-asc": "change", amount: "amount", cap: "cap", m1: "m1", m3: "m3", per: "per", high: "highGap", change: "change" } as const)[filters.sort];
  const direction = filters.sort === "per" || filters.sort === "change-asc" ? 1 : -1;
  return result.sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av === null || bv === null) return av === bv ? a.name.localeCompare(b.name, "ko-KR") : av === null ? 1 : -1;
    return (av - bv) * direction || a.name.localeCompare(b.name, "ko-KR");
  });
}

export function sectorStrength(rows: DiscoveryRow[], market: DiscoveryMarket) {
  const groups = new Map<string, DiscoveryRow[]>();
  for (const row of rows.filter(r => r.market === market)) groups.set(row.sector, [...(groups.get(row.sector) ?? []), row]);
  return [...groups].map(([sector, items]) => {
    const known = items.filter(i => i.change !== null), weighted = known.filter(i => i.cap !== null);
    const totalCap = weighted.reduce((sum, i) => sum + i.cap!, 0);
    const amountRows = items.filter(i => i.amount !== null);
    return { sector, count: items.length, known: known.length, weightedCount: weighted.length,
      up: known.filter(i => i.change! > 0).length, down: known.filter(i => i.change! < 0).length,
      flat: known.filter(i => i.change === 0).length,
      move: totalCap ? weighted.reduce((sum, i) => sum + i.cap! * i.change!, 0) / totalCap : null,
      amount: amountRows.length ? amountRows.reduce((sum, i) => sum + i.amount!, 0) : null,
      leader: [...known].sort((a, b) => b.change! - a.change!)[0] ?? null };
  }).sort((a, b) => a.move === null || b.move === null ? a.move === b.move ? 0 : a.move === null ? 1 : -1 : b.move - a.move);
}

export function compareIds(params: URLSearchParams): string[] {
  return [...new Set((params.get("codes") ?? "kospi:005930,kospi:000660").split(","))]
    .filter(id => /^(kospi|kosdaq):[0-9][0-9A-Z]{5}$/.test(id) || /^nasdaq:[A-Z0-9.\-]{1,16}$/.test(id)).slice(0, 4);
}

export function rowsCsv(rows: DiscoveryRow[]): string {
  // Prefix formula-like text before quoting, so downloaded cells stay plain text.
  const cell = (v: string | number | null) => {
    const raw = typeof v === "string" ? v.replace(/^[=+@\-\t\r]/, "'$&") : String(v ?? "");
    return `"${raw.replace(/"/g, '""')}"`;
  };
  const header = ["시장", "코드", "종목", "통화", "현재가", "등락률(%)", "시가총액", "거래량", "종가×거래량(근사)", "PER", "1개월(%)", "3개월(%)"];
  return "\uFEFF" + [header, ...rows.map(r => [r.market, r.code, r.name, r.currency, r.close, r.change, r.cap, r.volume, r.amount, r.per, r.m1, r.m3])].map(row => row.map(cell).join(",")).join("\r\n");
}
