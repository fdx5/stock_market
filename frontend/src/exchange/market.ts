import { useEffect, useMemo, useState } from "react";
import { api, type MarketMapItem, type MarketMapResponse, type MarketTickerItem } from "../api/client";
import { API_POLL_MS } from "../apiPolling";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { useMarketIndices } from "../useMarketIndices";
import { useMarketTicker } from "../useMarketTicker";
import { stockIconUrl } from "../stockIcon";
import { usCompanyLogoProxyUrl } from "../usLogo";
import layout from "./layout.json";

export const MARKETS = {
  kospi: { label: "KOSPI", venue: "KRX", currency: "KRW", map: "/map", index: "/kospi", color: "#71e8fe" },
  kosdaq: { label: "KOSDAQ", venue: "KRX", currency: "KRW", map: "/kosdaq-map", index: "/kosdaq", color: "#c0a6ff" },
  sp500: { label: "S&P 500", venue: "US", currency: "USD", map: "/sp500-map", index: "/ranking/sp500-market-cap", color: "#f4c986" },
} as const;
export type ExchangeMarket = keyof typeof MARKETS;
export type Language = "ko" | "en";
export const FLOOR = layout;
export const STORAGE_ASSETS = "/3d/exchange-floor";
export const PANEL_LABELS: Record<string, [string, string]> = {
  overview: ["중앙 시세판", "Market wall"], leaders: ["대표 종목", "Market leaders"],
  breadth: ["시장 흐름", "Market breadth"], sectors: ["업종 관제", "Sector desk"],
  gainers: ["상승률 상위", "Top gainers"], laggards: ["하락률 상위", "Top decliners"],
  commodities: ["원자재 · 환율", "Commodities & FX"],
};
const ASSETS = [
  { symbol: "CL=F", name: "WTI", href: "/prices/wti", unit: "USD/bbl" },
  { symbol: "GC=F", name: "GOLD", href: "/prices/gold", unit: "USD/oz" },
  { symbol: "SI=F", name: "SILVER", href: "/prices/silver", unit: "USD/oz" },
  { symbol: "KRW=X", name: "USD/KRW", href: "/prices/usd-krw", unit: "KRW" },
  { symbol: "BTC-USD", name: "BITCOIN", href: "/prices/bitcoin", unit: "USD" },
] as const;

const formatNumber = [new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }),
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }),
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 })];
export const displayValue = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value) ? "—" : (formatNumber[digits] ?? formatNumber[2]).format(value);
export const changeText = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "—" : (value > 0 ? "+" : "") + value.toFixed(2) + "%";
export const changeTone = (value: number | null | undefined) => value && value > 0 ? "up" : value && value < 0 ? "down" : "flat";
export const isPrice = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
export const companyLogo = (market: ExchangeMarket, code: string) => market === "sp500" ? usCompanyLogoProxyUrl(code) : stockIconUrl(code);
export const marketCode = (value: string | null): ExchangeMarket => value === "kosdaq" || value === "sp500" ? value : "kospi";
export const postNumber = (id: string) => /^post[0-7]$/.test(id) ? Number(id.slice(4)) : -1;
const formatTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
export const shortTime = (value: string | number | null | undefined) => {
  if (!value) return "—";
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? "—" : formatTime.format(date) + " KST";
};

type Sample = { value: MarketMapResponse | null; failed: boolean };
const EMPTY_SAMPLE: Sample = { value: null, failed: false };
const SAMPLE_LIMIT = 50;

function useSample(market: ExchangeMarket) {
  const [samples, setSamples] = useState<Partial<Record<ExchangeMarket, Sample>>>({});
  useEffect(() => {
    let active = true;
    let pending: AbortController | undefined;
    const update = async () => {
      if (!active || pending || document.hidden) return;
      const request = new AbortController();
      pending = request;
      const timeout = window.setTimeout(() => request.abort(), 9_500);
      try {
        const value = await (market === "sp500" ? api.sp500Ranking(SAMPLE_LIMIT, request.signal)
          : market === "kosdaq" ? api.kosdaqMap(SAMPLE_LIMIT, false, request.signal)
            : api.marketMap(SAMPLE_LIMIT, false, request.signal));
        if (!value.items.some(item => isPrice(item.close))) throw new Error("empty market sample");
        if (active) setSamples(old => ({ ...old, [market]: { value, failed: false } }));
      } catch {
        if (active) setSamples(old => ({ ...old, [market]: { value: old[market]?.value ?? null, failed: true } }));
      } finally { window.clearTimeout(timeout); pending = undefined; }
    };
    void update();
    const stop = startVisibilityAwareInterval(() => { void update(); }, API_POLL_MS);
    return () => { active = false; stop(); pending?.abort(); };
  }, [market]);
  return samples[market] ?? EMPTY_SAMPLE;
}

const noPoints: number[] = [];
function useKrHistory(market: ExchangeMarket) {
  const [histories, setHistories] = useState<Partial<Record<ExchangeMarket, number[]>>>({});
  useEffect(() => {
    if (market === "sp500") return;
    let active = true;
    const read = () => api.indexHistory(market === "kospi" ? "KOSPI" : "KOSDAQ", 1)
      .then(value => { if (active) setHistories(old => ({ ...old, [market]: value.points.map(row => row.close).filter(isPrice).slice(-60) })); })
      .catch(() => {});
    void read();
    const stop = startVisibilityAwareInterval(() => { void read(); }, 300_000);
    return () => { active = false; stop(); };
  }, [market]);
  return histories[market] ?? noPoints;
}

export type Commodity = (typeof ASSETS)[number] & { quote: MarketTickerItem | undefined };
export type FloorIndex = { close: number; change: number | null; time: string | number | null; status?: string };
export type FloorSnapshot = {
  market: ExchangeMarket; rows: MarketMapItem[]; quotes: Commodity[];
  failed: boolean; received: string | null; index: FloorIndex | null; series: number[];
  capBasis: "market_cap" | "index_weight" | undefined; session: string | undefined;
  up: number; down: number; flat: number; sectors: { name: string; change: number; count: number }[];
};

export function useFloorQuotes(market: ExchangeMarket): FloorSnapshot {
  const { value, failed } = useSample(market);
  const tickers = useMarketTicker();
  const indices = useMarketIndices();
  const krSeries = useKrHistory(market);
  return useMemo(() => {
    const rows = (value?.items ?? []).filter(row => /^[A-Za-z0-9.-]{1,16}$/.test(row.code) && isPrice(row.close));
    const us = tickers.find(item => item.symbol === "^GSPC");
    const kr = market === "kosdaq" ? indices.kosdaq : indices.kospi;
    const index = market === "sp500"
      ? (us && isPrice(us.price) ? { close: us.price, change: us.change_pct, time: us.quote_time ?? null } : null)
      : (kr && isPrice(kr.close) ? { close: kr.close, change: kr.change_pct, time: kr.updated_at, status: kr.market_status } : null);
    let up = 0, down = 0, flat = 0;
    const groups = new Map<string, { name: string; change: number; count: number }>();
    for (const row of rows) {
      if (!Number.isFinite(row.change_pct)) continue;
      if (row.change_pct > 0) up++;
      else if (row.change_pct < 0) down++;
      else flat++;
      const name = row.sector || "—";
      const group = groups.get(name) ?? { name, change: 0, count: 0 };
      group.change += row.change_pct;
      group.count++;
      groups.set(name, group);
    }
    const sectors = [...groups.values()].map(group => ({ ...group, change: group.change / group.count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8);
    return { market, rows, failed, received: value?.generated_at ?? null, index, up, down, flat, sectors,
      series: market === "sp500" ? (us?.points ?? noPoints).filter(isPrice).slice(-60) : krSeries,
      quotes: ASSETS.map(asset => ({ ...asset, quote: tickers.find(item => item.symbol === asset.symbol && isPrice(item.price)) })),
      capBasis: value?.ranking_basis, session: value?.session };
  }, [market, value, failed, tickers, indices, krSeries]);
}

export function rowsForPanel(snapshot: FloorSnapshot, panel: string) {
  const number = postNumber(panel);
  if (number >= 0) return snapshot.rows.slice(number, number + 1);
  if (panel !== "gainers" && panel !== "laggards") return snapshot.rows;
  const direction = panel === "gainers" ? 1 : -1;
  return snapshot.rows.filter(row => Number.isFinite(row.change_pct) && row.change_pct * direction > 0)
    .sort((a, b) => (b.change_pct - a.change_pct) * direction);
}

export function useStockHistory(market: ExchangeMarket, code: string | undefined) {
  const [entries, setEntries] = useState<Record<string, number[]>>({});
  const key = code ? market + ":" + code : undefined;
  const existing = key ? entries[key] : undefined;
  useEffect(() => {
    if (!code || !key || existing) return;
    let active = true;
    api.marketSparklines([code], market === "sp500" ? "us" : "kr").then(data => {
      if (active) setEntries(old => {
        const recent = Object.entries(old).slice(-19);
        return { ...Object.fromEntries(recent), [key]: (data.items[code]?.points ?? []).filter(isPrice).slice(-60) };
      });
    }).catch(() => {});
    return () => { active = false; };
  }, [market, code, key, existing]);
  return existing ?? noPoints;
}

const EMPTY_SERIES: Record<string, number[]> = {};
export function usePostSeries(market: ExchangeMarket, rows: MarketMapItem[]) {
  const symbols = rows.slice(0, 8).map(row => row.code).sort().join(",");
  const [result, setResult] = useState<{ market: ExchangeMarket; series: Record<string, number[]> }>();
  useEffect(() => {
    if (!symbols) return;
    let active = true;
    const load = () => { void api.marketSparklines(symbols.split(","), market === "sp500" ? "us" : "kr").then(data => {
      if (active) setResult({ market, series: Object.fromEntries(Object.entries(data.items)
        .map(([code, chart]) => [code, chart.points.filter(isPrice).slice(-60)])) });
    }).catch(() => {}); };
    load();
    const stop = startVisibilityAwareInterval(load, 300_000);
    return () => { active = false; stop(); };
  }, [market, symbols]);
  return result?.market === market ? result.series : EMPTY_SERIES;
}
