import { useEffect, useState } from "react";
import { MarketTickerItem, api } from "./api/client";
import { startVisibilityAwareInterval } from "./pollVisibility";

// Backend TTL_TICKER_SECONDS is 10s, so anything faster than that just re-fetches
// the same cached snapshot from our own API.
const POLL_MS = 5_000;

/** One poller for /api/market/ticker, shared by every component that reads it.
 *
 * The dashboard has two consumers (the scrolling belt and the FX/oil strip). Given
 * a poller each, they fetched twice as often as needed and — worse — on unrelated
 * offsets, so the belt's DOM was being re-rendered at irregular intervals while its
 * CSS transform animation was running, which reads as dropped frames. One timer and
 * one state update means both consumers change together, on a predictable beat. */
let items: MarketTickerItem[] = [];
const subscribers = new Set<(next: MarketTickerItem[]) => void>();
let stopPolling: (() => void) | null = null;

function fetchOnce() {
  api
    .marketTicker()
    .then((res) => {
      items = res.items;
      subscribers.forEach((notify) => notify(items));
    })
    .catch(() => {
      // A missed refresh just keeps the last known values on screen.
    });
}

function subscribe(notify: (next: MarketTickerItem[]) => void): () => void {
  subscribers.add(notify);
  if (subscribers.size === 1) {
    fetchOnce();
    stopPolling = startVisibilityAwareInterval(fetchOnce, POLL_MS);
  } else if (items.length > 0) {
    // A late subscriber gets the current snapshot immediately rather than waiting
    // out the rest of the shared interval on an empty render.
    notify(items);
  }
  return () => {
    subscribers.delete(notify);
    if (subscribers.size === 0) {
      stopPolling?.();
      stopPolling = null;
    }
  };
}

export function useMarketTicker(): MarketTickerItem[] {
  const [value, setValue] = useState<MarketTickerItem[]>(items);
  useEffect(() => subscribe(setValue), []);
  return value;
}
