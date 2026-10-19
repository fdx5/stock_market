import { useEffect, useState } from "react";
import { MarketMapItem, MarketSession, api } from "./api/client";
import { startVisibilityAwareInterval } from "./pollVisibility";

/* The US counterpart to useMarketSnapshot: one pull of the S&P 500 and NASDAQ
 * 100 constituent maps, shared by everything on the global desk that is built
 * out of them — the breadth gauge, the spotlight board and the ranking board.
 *
 * Same refcounted-singleton shape and the same reasoning: the API client has no
 * request dedupe, both responses are already warmed for the treemap pages, and
 * three panels each running their own timer would be six requests a minute for
 * two payloads.
 *
 * Two things differ from the KR side and both matter to callers:
 *
 *  - `marcap` does not mean here what it means on the KR maps: on a US item it is
 *    the constituent's index *weight* in per cent, not a capitalisation.
 *    `market_cap` is the real figure, in dollars. Anything ranking or weighting US
 *    names by size has to read that one.
 *
 *    (`volume` is present on both sides — the Yahoo overlay in us_index_fetcher
 *    carries it onto every constituent, so turnover is computable here too. This
 *    note used to say it was not, which was true before that overlay existed.)
 *  - There is a session. US quotes can be pre-market or after-hours, and the
 *    payload says which, so a reader can be told that a move happened after the
 *    bell instead of being shown it as though the market were open.
 */

export interface UsMarketSnapshot {
  sp500: MarketMapItem[];
  nasdaq: MarketMapItem[];
  /** Union of both, deduplicated by ticker — the two indices overlap heavily and
   * counting Apple twice would skew every breadth and ranking figure drawn from
   * this. S&P wins on a collision: it is the broader of the two. */
  all: MarketMapItem[];
  session: MarketSession | null;
  generatedAt: string | null;
}

const EMPTY: UsMarketSnapshot = {
  sp500: [],
  nasdaq: [],
  all: [],
  session: null,
  generatedAt: null,
};
const REFRESH_MS = 10_000;

let snapshot: UsMarketSnapshot = EMPTY;
const listeners = new Set<(value: UsMarketSnapshot) => void>();
let stopPolling: (() => void) | null = null;
let inFlight = false;

function merge(sp500: MarketMapItem[], nasdaq: MarketMapItem[]): MarketMapItem[] {
  const byCode = new Map<string, MarketMapItem>();
  for (const item of sp500) byCode.set(item.code, item);
  for (const item of nasdaq) if (!byCode.has(item.code)) byCode.set(item.code, item);
  return [...byCode.values()];
}

function load() {
  if (inFlight) return;
  inFlight = true;
  Promise.allSettled([api.sp500Map(503, false), api.nasdaq100Map(103, false)])
    .then(([spResult, nqResult]) => {
      if (spResult.status === "rejected" && nqResult.status === "rejected") return;
      const sp500 = spResult.status === "fulfilled" ? spResult.value : null;
      const nasdaq = nqResult.status === "fulfilled" ? nqResult.value : null;
      const spItems = sp500?.items ?? snapshot.sp500;
      const nqItems = nasdaq?.items ?? snapshot.nasdaq;
      snapshot = {
        sp500: spItems,
        nasdaq: nqItems,
        all: merge(spItems, nqItems),
        session: sp500?.session ?? nasdaq?.session ?? snapshot.session,
        generatedAt: sp500?.generated_at ?? nasdaq?.generated_at ?? snapshot.generatedAt,
      };
      for (const listener of listeners) listener(snapshot);
    })
    .catch(() => {
      // A missed refresh keeps the last snapshot rather than blanking every
      // reader at once.
    })
    .finally(() => { inFlight = false; });
}

export function useUsMarketSnapshot(): UsMarketSnapshot {
  const [value, setValue] = useState<UsMarketSnapshot>(snapshot);

  useEffect(() => {
    listeners.add(setValue);
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
