import { useEffect, useMemo, useState } from "react";
import {
  api, type FuturesItem, type GlobalIndexWidget, type GlobalTop20Item, type HotIssueEdition, type InvestorSummaryItem,
  type KospiNightQuote, type MarketMapItem, type MarketMapResponse, type MarketTickerItem, type TreasuryHeadline,
} from "../api/client";
import { API_POLL_MS } from "../apiPolling";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { useMarketIndices, type MarketIndices } from "../useMarketIndices";
import { useMarketTicker } from "../useMarketTicker";
import {
  STOCK_PANELS, isPrice, rowsForPanel, stockIndex, type ExchangeMarket, type FloorExtras, type FloorIndex, type FloorSnapshot, type SectorStat,
} from "./marketCore";

export * from "./marketCore";
import layout from "./layout.json";
/** The atrium plan (scripts/exchange_layout.py), shared with the Blender build. */
export const FLOOR = layout;

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
