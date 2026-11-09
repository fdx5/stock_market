import { useEffect, useState } from "react";
import { api, type MarketMapItem } from "../api/client";
import { startVisibilityAwareInterval } from "../pollVisibility";

export type BoardMarket = "kospi" | "kosdaq" | "nasdaq100";
export interface BoardSnapshot { items: MarketMapItem[]; generatedAt: string | null; settled: boolean; delayed: boolean; version: number }

const REFRESH_MS = 20_000;
const empty = (): BoardSnapshot => ({ items: [], generatedAt: null, settled: false, delayed: false, version: 0 });
const cache: Record<BoardMarket, BoardSnapshot> = { kospi: empty(), kosdaq: empty(), nasdaq100: empty() };
const request = (market: BoardMarket) => market === "kospi" ? api.marketMap(100, true) : market === "kosdaq" ? api.kosdaqMap(100, true) : api.nasdaq100Map(103, true);

/** Only the market on screen is polled: the board never adds requests for hidden tabs. */
export function usePulseBoardMarket(market: BoardMarket) {
  const [snapshot, setSnapshot] = useState<BoardSnapshot>(cache[market]);
  useEffect(() => {
    let live = true, busy = false;
    setSnapshot(cache[market]);
    const load = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const response = await request(market);
        const previous = cache[market];
        const newer = Date.parse(response.generated_at ?? "") >= (Date.parse(previous.generatedAt ?? "") || 0);
        if (Array.isArray(response.items) && response.items.length && newer)
          cache[market] = { items: response.items, generatedAt: response.generated_at ?? null, settled: true, delayed: false, version: previous.version + 1 };
        else cache[market] = { ...previous, settled: true };
      } catch {
        // A failed refresh keeps the last good board on screen.
        cache[market] = { ...cache[market], settled: true, delayed: true };
      } finally { busy = false; }
      if (live) setSnapshot(cache[market]);
    };
    void load();
    const stop = startVisibilityAwareInterval(() => { void load(); }, REFRESH_MS);
    return () => { live = false; stop(); };
  }, [market]);
  return snapshot;
}

/** Top 100 by market cap, one row per code. */
export function boardStocks(items: MarketMapItem[]) {
  const unique = new Map<string, MarketMapItem>();
  for (const item of items) if (item.code && !unique.has(item.code) && Number.isFinite(item.marcap) && item.marcap > 0) unique.set(item.code, item);
  return [...unique.values()].sort((a, b) => b.marcap - a.marcap).slice(0, 100);
}
