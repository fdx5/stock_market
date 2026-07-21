import { useEffect, useState } from "react";
import { PopularStock, api } from "./api/client";
import { startVisibilityAwareInterval } from "./pollVisibility";

const REFRESH_MS = 60_000;

// The quick-access strip and the search dropdown both want this list, and they're
// always on screen together — one in-flight promise per limit is shared between
// them instead of each mounting its own fetch. Cleared on completion of the
// refresh cycle so the ranking still moves; the backend caches it for 60s anyway.
const inflight = new Map<number, Promise<PopularStock[]>>();
const lastValue = new Map<number, PopularStock[]>();

function load(limit: number): Promise<PopularStock[]> {
  const existing = inflight.get(limit);
  if (existing) return existing;
  const promise = api
    .popularSearches(limit)
    .then((res) => {
      lastValue.set(limit, res.items);
      return res.items;
    })
    .catch(() => lastValue.get(limit) ?? [])
    .finally(() => inflight.delete(limit));
  inflight.set(limit, promise);
  return promise;
}

/** Most-viewed stocks across all visitors in the last 24h. Returns null while the
 * first response is in flight so callers can render a skeleton rather than briefly
 * flashing an "empty" state. */
export function usePopularStocks(limit = 8): PopularStock[] | null {
  const [items, setItems] = useState<PopularStock[] | null>(() => lastValue.get(limit) ?? null);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      load(limit).then((next) => {
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
  }, [limit]);

  return items;
}
