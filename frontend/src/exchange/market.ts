import { useEffect, useMemo, useState } from "react";
import {
  api, type FuturesItem, type GlobalIndexWidget, type GlobalTop20Item, type HotIssueEdition, type InvestorSummaryItem,
  type KospiNightQuote, type MarketMapItem, type MarketMapResponse, type MarketTickerItem, type TreasuryHeadline,
} from "../api/client";
import { API_POLL_MS } from "../apiPolling";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { useMarketIndices, type MarketIndices } from "../useMarketIndices";
import { useMarketTicker } from "../useMarketTicker";
import { stockIconUrl } from "../stockIcon";
import { usCompanyLogoProxyUrl } from "../usLogo";
import layout from "./layout.json";

export const MARKETS = {
  kospi: { label: "KOSPI", venue: "KRX", currency: "KRW", map: "/map", index: "/kospi", color: "#5fe3ff" },
  kosdaq: { label: "KOSDAQ", venue: "KRX", currency: "KRW", map: "/kosdaq-map", index: "/kosdaq", color: "#b99cff" },
  sp500: { label: "S&P 500", venue: "NYSE · NASDAQ", currency: "USD", map: "/sp500-map", index: "/ranking/sp500-market-cap", color: "#ffc871" },
} as const;
export type ExchangeMarket = keyof typeof MARKETS;
export type Language = "ko" | "en";
export const FLOOR = layout;
export const STORAGE_ASSETS = "/3d/exchange-floor";
export const STOCK_PANELS = 16;

/** Every data panel on the floor: [Korean, English, kind]. Kinds group panels in the monitor picker. */
export const PANEL_LABELS: Record<string, [string, string, "market" | "stocks" | "global" | "assets" | "desk"]> = {
  overview: ["빅 보드 · 기준 지수", "Big board · benchmark", "market"],
  treemap: ["시장 지도", "Market map", "market"],
  heatgrid: ["시가총액 상위 히트맵", "Top-cap heat grid", "market"],
  breadth: ["시장 폭 · 등락 비율", "Market breadth", "market"],
  histogram: ["등락률 분포", "Return distribution", "market"],
  sectors: ["업종 관제", "Sector desk", "market"],
  capshare: ["시가총액 비중", "Cap concentration", "market"],
  investor: ["투자자별 수급", "Investor flows", "market"],
  tri: ["3대 시장", "Three markets", "market"],
  session: ["거래 세션", "Trading sessions", "global"],
  clocks: ["세계 시각", "World clocks", "global"],
  leaders: ["시가총액 상위", "Market leaders", "stocks"],
  gainers: ["상승률 상위", "Top gainers", "stocks"],
  laggards: ["하락률 상위", "Top decliners", "stocks"],
  movers: ["거래대금 상위", "Turnover leaders", "stocks"],
  world: ["세계 증시", "World indices", "global"],
  globaltop: ["세계 시가총액 TOP", "Global market-cap leaders", "global"],
  semis: ["반도체 데스크", "Semiconductor desk", "global"],
  bigtech: ["빅테크 데스크", "Big tech desk", "global"],
  futures: ["지수 선물", "Index futures", "global"],
  rates: ["미국 국채 금리", "US Treasury yields", "global"],
  news: ["오늘의 핫이슈", "Today's hot issues", "desk"],
  brief: ["핵심 지표 · 일정", "Key numbers & agenda", "desk"],
  crypto: ["디지털 자산", "Digital assets", "assets"],
  fx: ["환율 데스크", "FX desk", "assets"],
  metals: ["귀금속 · 산업금속", "Metals", "assets"],
  energy: ["에너지", "Energy", "assets"],
  agri: ["농산물 · 축산", "Agriculture & livestock", "assets"],
};
export const ASSET_SINGLES: Record<string, { ko: string; en: string; unit: string; href: string; digits: number }> = {
  "KRW=X": { ko: "원/달러 환율", en: "USD / KRW", unit: "KRW", href: "/prices/usd-krw", digits: 2 },
  "GC=F": { ko: "금 선물", en: "Gold futures", unit: "USD/oz", href: "/prices/gold", digits: 1 },
  "CL=F": { ko: "WTI 원유", en: "WTI crude", unit: "USD/bbl", href: "/prices/wti", digits: 2 },
  "BTC-USD": { ko: "비트코인", en: "Bitcoin", unit: "USD", href: "/prices/bitcoin", digits: 0 },
  "NQ=F": { ko: "나스닥100 선물", en: "Nasdaq 100 futures", unit: "PT", href: "/global", digits: 1 },
  "ES=F": { ko: "S&P500 선물", en: "S&P 500 futures", unit: "PT", href: "/global", digits: 1 },
  "ETH-USD": { ko: "이더리움", en: "Ethereum", unit: "USD", href: "/prices/bitcoin", digits: 1 },
  "SI=F": { ko: "은 선물", en: "Silver futures", unit: "USD/oz", href: "/prices/silver", digits: 2 },
};
for (const [symbol, spec] of Object.entries(ASSET_SINGLES)) PANEL_LABELS["a:" + symbol] = [spec.ko, spec.en, "assets"];

const formatNumber = [new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }),
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }),
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 })];
export const displayValue = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value) ? "—" : (formatNumber[digits] ?? formatNumber[2]).format(value);
export const fixedValue = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const changeText = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "—" : (value > 0 ? "+" : "") + value.toFixed(2) + "%";
export const changeTone = (value: number | null | undefined) => value && value > 0 ? "up" : value && value < 0 ? "down" : "flat";
export const isPrice = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
export const companyLogo = (market: ExchangeMarket, code: string) => market === "sp500" ? usCompanyLogoProxyUrl(code) : stockIconUrl(code);
export const marketCode = (value: string | null): ExchangeMarket => value === "kosdaq" || value === "sp500" ? value : "kospi";
export const stockIndex = (id: string) => /^s(1[0-5]|[0-9])$/.test(id) ? Number(id.slice(1)) : -1;
export const assetSymbol = (id: string) => id.startsWith("a:") ? id.slice(2) : "";
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
const SAMPLE_LIMIT = 80;

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
function useKrHistory() {
  const [histories, setHistories] = useState<{ kospi: number[]; kosdaq: number[] }>({ kospi: noPoints, kosdaq: noPoints });
  useEffect(() => {
    let active = true;
    const read = () => {
      for (const key of ["kospi", "kosdaq"] as const) {
        api.indexHistory(key === "kospi" ? "KOSPI" : "KOSDAQ", 1)
          .then(value => { if (active) setHistories(old => ({ ...old, [key]: value.points.map(row => row.close).filter(isPrice).slice(-120) })); })
          .catch(() => {});
      }
    };
    read();
    const stop = startVisibilityAwareInterval(read, 300_000);
    return () => { active = false; stop(); };
  }, []);
  return histories;
}

/** Polls one endpoint on its own cadence while the tab is visible; keeps the last good value. */
function usePoll<T>(load: () => Promise<T>, every: number): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    let active = true;
    const read = () => { load().then(next => { if (active) setValue(next); }).catch(() => {}); };
    read();
    const stop = startVisibilityAwareInterval(read, every);
    return () => { active = false; stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [every]);
  return value;
}

export type FloorExtras = {
  world: GlobalIndexWidget[];
  futures: FuturesItem[];
  investor: InvestorSummaryItem[];
  rates: TreasuryHeadline[];
  kospiNight: KospiNightQuote | null;
  kospiFutures: KospiNightQuote | null;
  hot: HotIssueEdition | null;
  globalTop: GlobalTop20Item[];
};

export function useFloorExtras(): FloorExtras {
  const world = usePoll(() => api.globalIndices().then(r => r.items), 60_000);
  const futures = usePoll(() => api.futures().then(r => r.items), 60_000);
  const investor = usePoll(() => api.investorSummary().then(r => r.items), 300_000);
  const rates = usePoll(() => api.treasuryHeadlines().then(r => r.items), 60_000);
  const kospiNight = usePoll(() => api.kospiNight(), 60_000);
  const kospiFutures = usePoll(() => api.kospiFutures(), 60_000);
  const hot = usePoll(() => api.hotIssues(), 600_000);
  const globalTop = usePoll(() => api.globalTop20().then(r => r.items), 300_000);
  return useMemo(() => ({
    world: world ?? [], futures: futures ?? [], investor: investor ?? [], rates: rates ?? [],
    kospiNight, kospiFutures, hot, globalTop: globalTop ?? [],
  }), [world, futures, investor, rates, kospiNight, kospiFutures, hot, globalTop]);
}

export type FloorIndex = { close: number; change: number | null; time: string | number | null; status?: string; points: number[] };
export type SectorStat = { name: string; change: number; count: number; cap: number };
export type FloorSnapshot = {
  market: ExchangeMarket; rows: MarketMapItem[]; tickers: Record<string, MarketTickerItem>;
  failed: boolean; received: string | null; index: FloorIndex | null;
  indices: Record<ExchangeMarket, FloorIndex | null>; investorTotals: MarketIndices["kospiInvestor"];
  capBasis: "market_cap" | "index_weight" | undefined; session: string | undefined;
  up: number; down: number; flat: number; sectors: SectorStat[]; extras: FloorExtras;
};

export function useFloorQuotes(market: ExchangeMarket): FloorSnapshot {
  const { value, failed } = useSample(market);
  const ticker = useMarketTicker();
  const indices = useMarketIndices();
  const kr = useKrHistory();
  const extras = useFloorExtras();
  return useMemo(() => {
    const rows = (value?.items ?? []).filter(row => /^[A-Za-z0-9.-]{1,16}$/.test(row.code) && isPrice(row.close));
    const tickers = Object.fromEntries(ticker.filter(item => isPrice(item.price)).map(item => [item.symbol, item]));
    const us = tickers["^GSPC"];
    const all: Record<ExchangeMarket, FloorIndex | null> = {
      kospi: indices.kospi && isPrice(indices.kospi.close) ? { close: indices.kospi.close, change: indices.kospi.change_pct,
        time: indices.kospi.updated_at, status: indices.kospi.market_status, points: kr.kospi } : null,
      kosdaq: indices.kosdaq && isPrice(indices.kosdaq.close) ? { close: indices.kosdaq.close, change: indices.kosdaq.change_pct,
        time: indices.kosdaq.updated_at, status: indices.kosdaq.market_status, points: kr.kosdaq } : null,
      sp500: us ? { close: us.price, change: us.change_pct, time: us.quote_time ?? null, points: us.points.filter(isPrice) } : null,
    };
    let up = 0, down = 0, flat = 0;
    const groups = new Map<string, SectorStat>();
    for (const row of rows) {
      if (!Number.isFinite(row.change_pct)) continue;
      if (row.change_pct > 0) up++;
      else if (row.change_pct < 0) down++;
      else flat++;
      const name = row.sector || "—";
      const group = groups.get(name) ?? { name, change: 0, count: 0, cap: 0 };
      const cap = row.marcap || 1;
      group.change += row.change_pct * cap;
      group.cap += cap;
      group.count++;
      groups.set(name, group);
    }
    const sectors = [...groups.values()].map(group => ({ ...group, change: group.change / (group.cap || 1) }))
      .sort((a, b) => b.cap - a.cap);
    return { market, rows, tickers, failed, received: value?.generated_at ?? null, index: all[market], indices: all,
      investorTotals: market === "kosdaq" ? indices.kosdaqInvestor : indices.kospiInvestor,
      up, down, flat, sectors, extras, capBasis: value?.ranking_basis, session: value?.session };
  }, [market, value, failed, ticker, indices, kr, extras]);
}

export function rowsForPanel(snapshot: FloorSnapshot, panel: string) {
  const number = stockIndex(panel);
  if (number >= 0) return snapshot.rows.slice(number, number + 1);
  if (panel === "movers") return [...snapshot.rows].sort((a, b) => (b.turnover ?? b.close * (b.volume ?? 0)) - (a.turnover ?? a.close * (a.volume ?? 0)));
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
        return { ...Object.fromEntries(recent), [key]: (data.items[code]?.points ?? []).filter(isPrice).slice(-90) };
      });
    }).catch(() => {});
    return () => { active = false; };
  }, [market, code, key, existing]);
  return existing ?? noPoints;
}

const EMPTY_SERIES: Record<string, number[]> = {};
/** Daily closes for the 16 post stocks, refreshed every five minutes. */
export function usePostSeries(market: ExchangeMarket, rows: MarketMapItem[]) {
  const symbols = rows.slice(0, STOCK_PANELS).map(row => row.code).sort().join(",");
  const [result, setResult] = useState<{ market: ExchangeMarket; series: Record<string, number[]> }>();
  useEffect(() => {
    if (!symbols) return;
    let active = true;
    const load = () => { void api.marketSparklines(symbols.split(","), market === "sp500" ? "us" : "kr").then(data => {
      if (active) setResult({ market, series: Object.fromEntries(Object.entries(data.items)
        .map(([code, chart]) => [code, chart.points.filter(isPrice).slice(-90)])) });
    }).catch(() => {}); };
    load();
    const stop = startVisibilityAwareInterval(load, 300_000);
    return () => { active = false; stop(); };
  }, [market, symbols]);
  return result?.market === market ? result.series : EMPTY_SERIES;
}
