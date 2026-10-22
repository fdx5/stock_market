import { useSyncExternalStore } from "react";
import { api, type MarketMapItem } from "../api/client";
import { startVisibilityAwareInterval } from "../pollVisibility";

export type AtlasMarket = "kospi" | "kosdaq" | "nasdaq100";
export interface AtlasMapSnapshot {
  items: MarketMapItem[];
  generatedAt: string | null;
  settled: boolean;
  delayed: boolean;
}
const empty = (): AtlasMapSnapshot => ({ items: [], generatedAt: null, settled: false, delayed: false });
const EMPTY = { kospi: empty(), kosdaq: empty(), nasdaq100: empty() };
let snapshot = EMPTY;
const listeners = new Set<() => void>();
let inFlight = false;
let stopPolling: (() => void) | null = null;
const markets: AtlasMarket[] = ["kospi", "kosdaq", "nasdaq100"];

async function load() {
  if (inFlight || document.visibilityState === "hidden") return;
  inFlight = true;
  try {
    // Read existing warmed map endpoints; no force refresh or S&P 500 download.
    const results = await Promise.allSettled([api.marketMap(60, false), api.kosdaqMap(60, false), api.nasdaq100Map(60, false)]);
    const next = { ...snapshot };
    results.forEach((result, i) => {
      const key = markets[i];
      const response = result.status === "fulfilled" ? result.value : null;
      const oldTime = Date.parse(snapshot[key].generatedAt ?? "");
      const newTime = Date.parse(response?.generated_at ?? "");
      if (response && Array.isArray(response.items) && response.items.length &&
          !(Number.isFinite(oldTime) && Number.isFinite(newTime) && newTime < oldTime)) {
        next[key] = { items: response.items, generatedAt: response.generated_at ?? null, settled: true, delayed: false };
      } else {
        // A failure of one market must not blank the other two or its last good map.
        next[key] = { ...snapshot[key], settled: true, delayed: true };
      }
    });
    snapshot = next;
    listeners.forEach(listener => listener());
  } finally { inFlight = false; }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void load();
    stopPolling = startVisibilityAwareInterval(() => { void load(); }, 30_000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { stopPolling?.(); stopPolling = null; }
  };
}
export function useAtlasMiniMaps() {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
}
