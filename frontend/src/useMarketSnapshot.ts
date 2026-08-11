import { useEffect, useState } from "react";
import { MarketMapItem, api } from "./api/client";
import { startVisibilityAwareInterval } from "./pollVisibility";

/* One pull of the two market maps, however many things are reading them.
 *
 * These two responses are the richest thing the frontend can get in a single
 * round trip: every listed name in the KOSPI 500 and the KOSDAQ 200 with its
 * code, sector, cap, shares, today's move, volume, PER, ROE and foreign
 * holding. The backend already warms both for the treemap pages, so they are
 * cached reads.
 *
 * Two panels on the market desk are built entirely out of them — the breadth
 * gauge and the spotlight board — and the API client has no request dedupe, so
 * without this each would fetch both maps on its own timer. Same refcounted
 * singleton shape as useMarketIndices: first subscriber starts the poll, last
 * one stops it, everyone shares the snapshot.
 *
 * A minute is the right cadence. These are cap-ranking snapshots rather than a
 * tape — the whole board does not reorder in fifteen seconds, and both panels
 * are read as context rather than watched for a tick. */

export interface MarketSnapshot {
  kospi: MarketMapItem[];
  kosdaq: MarketMapItem[];
  /** When the backend generated the KOSPI side. Null until the first response. */
  generatedAt: string | null;
}

const EMPTY: MarketSnapshot = { kospi: [], kosdaq: [], generatedAt: null };
const REFRESH_MS = 60_000;

let snapshot: MarketSnapshot = EMPTY;
const listeners = new Set<(value: MarketSnapshot) => void>();
let stopPolling: (() => void) | null = null;

function load() {
  Promise.all([api.marketMap(500, false), api.kosdaqMap(200, false)])
    .then(([kospi, kosdaq]) => {
      snapshot = {
        kospi: kospi.items,
        kosdaq: kosdaq.items,
        generatedAt: kospi.generated_at ?? null,
      };
      for (const listener of listeners) listener(snapshot);
    })
    .catch(() => {
      // A missed refresh keeps the last snapshot rather than blanking every
      // reader at once.
    });
}

/** Null-ish state is `generatedAt === null`, which is what callers test to know
 * whether to draw a skeleton. */
export function useMarketSnapshot(): MarketSnapshot {
  const [value, setValue] = useState<MarketSnapshot>(snapshot);

  useEffect(() => {
    listeners.add(setValue);
    // Hand a newcomer whatever is already known, rather than leaving it on
    // skeletons until the next tick of a poll that is already running.
    if (snapshot !== EMPTY) setValue(snapshot);

    if (listeners.size === 1) {
      load();
      stopPolling = startVisibilityAwareInterval(load, REFRESH_MS);
    }

    return () => {
      listeners.delete(setValue);
      if (listeners.size === 0 && stopPolling) {
        stopPolling();
        stopPolling = null;
      }
    };
  }, []);

  return value;
}
