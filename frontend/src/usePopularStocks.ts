import { useEffect, useState } from "react";
import { PopularStock, api } from "./api/client";
import { startVisibilityAwareInterval } from "./pollVisibility";

const REFRESH_MS = 60_000;

// The quick-access strip and the search dropdown both want this list, and they're
// always on screen together — one in-flight promise per key is shared between
// them instead of each mounting its own fetch. Cleared on completion of the
// refresh cycle so the ranking still moves; the backend caches it for 60s anyway.
//
// Keyed on limit *and* market, since the global desk asks for the US-only ranking
// while the strip beside it may be asking for the combined one, and the two are
// different lists that must not share a slot.
type Market = "US" | "KR" | undefined;
const keyOf = (limit: number, market: Market) => `${limit}:${market ?? "all"}`;

const inflight = new Map<string, Promise<PopularStock[]>>();
const lastValue = new Map<string, PopularStock[]>();

function load(limit: number, market: Market): Promise<PopularStock[]> {
  const key = keyOf(limit, market);
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = api
    .popularSearches(limit, market)
    .then((res) => {
      lastValue.set(key, res.items);
      return res.items;
    })
    .catch(() => lastValue.get(key) ?? [])
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** Most-viewed stocks across all visitors in the last 24h. Returns null while the
 * first response is in flight so callers can render a skeleton rather than briefly
 * flashing an "empty" state. */
export function usePopularStocks(limit = 8, market?: "US" | "KR"): PopularStock[] | null {
  const [items, setItems] = useState<PopularStock[] | null>(
    () => lastValue.get(keyOf(limit, market)) ?? null
  );

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      load(limit, market).then((next) => {
        if (!cancelled) setItems(next);
      });
    };
    run();
    // Routed through the shared helper rather than a bare setInterval so this
    // poller gets a phase offset like every other one, and stops ticking while the
    // tab is in the background.
    const stopPolling = startVisibilityAwareInterval(run, REFRESH_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [limit, market]);

  return items;
}
