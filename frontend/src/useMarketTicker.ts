import { API_POLL_MS } from "./apiPolling";
import { useEffect, useState } from "react";
import { MarketTickerItem, MarketTickerTailItem, api } from "./api/client";
import { startVisibilityAwareInterval } from "./pollVisibility";

// Shared server cache expires before the next ten-second poll.
const POLL_MS = API_POLL_MS;

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
let inFlight = false;

/** Outbound bandwidth: the full payload is ~9,600 one-minute sparkline points (~22 KB
 * gzipped) of which only the last minute or two change between polls. Refreshes ask for
 * the last TAIL points and splice them onto the series already held; the server sends the
 * full series' length, first value and left-to-right sum, and any item that does not
 * reproduce them exactly makes the next request a full one. A full fetch also runs every
 * FULL_EVERY_MS regardless, so the drawn series is always the one the full response has. */
const TAIL = 8;
const FULL_EVERY_MS = 5 * 60_000;
let lastFullAt = 0;
let needFull = true;

function seriesSum(points: number[]): number {
  let total = 0;
  for (const value of points) total += value;
  return total;
}

/** The full item rebuilt from a tail response, or null when it cannot be proven identical. */
export function spliceTickerTail(previous: MarketTickerItem | undefined, next: MarketTickerTailItem): MarketTickerItem | null {
  const { points_len: length, points_first: first, points_sum: sum, points: tail, ...rest } = next;
  if (!Number.isInteger(length) || tail.length > length) return null;
  const keep = length - tail.length;
  let points: number[];
  if (keep === 0) points = tail.slice();
  else {
    // The held series' last point was the minute still forming; it must be inside the tail.
    if (!previous || previous.points.length - 1 < keep || previous.points[0] !== first) return null;
    points = previous.points.slice(0, keep).concat(tail);
  }
  const total = seriesSum(points);
  if (points.length !== length || Math.abs(total - sum) > 1e-9 * Math.max(1, Math.abs(sum))) return null;
  return { ...rest, points };
}

function fetchOnce() {
  if (inFlight) return;
  inFlight = true;
  const full = needFull || Date.now() - lastFullAt >= FULL_EVERY_MS;
  const request: Promise<{ items: MarketTickerItem[] }> = full
    ? api.marketTicker()
    : api.marketTickerTail(TAIL).then((res) => {
      const held = new Map(items.map((item) => [item.symbol, item]));
      const rebuilt: MarketTickerItem[] = [];
      for (const item of res.items) {
        const whole = spliceTickerTail(held.get(item.symbol), item);
        if (whole) rebuilt.push(whole);
        else needFull = true;
      }
      return { items: rebuilt };
    });
  request
    .then((res) => {
      if (full) { needFull = false; lastFullAt = Date.now(); }
      const bySymbol = new Map(items.map((item) => [item.symbol, item]));
      for (const item of res.items) {
        const previous = bySymbol.get(item.symbol);
        if (previous?.quote_time && item.quote_time && previous.quote_time > item.quote_time) continue;
        bySymbol.set(item.symbol, item);
      }
      items = [...bySymbol.values()];
      subscribers.forEach((notify) => notify(items));
    })
    .catch(() => {
      // A missed refresh just keeps the last known values on screen.
    })
    .finally(() => {
      inFlight = false;
      // An item that could not be rebuilt is fetched whole now rather than a poll later.
      if (needFull && !full && subscribers.size > 0) fetchOnce();
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
