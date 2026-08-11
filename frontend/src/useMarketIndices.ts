import { useEffect, useState } from "react";
import { IndexQuote, MarketInvestorSummary, api } from "./api/client";
import { startVisibilityAwareInterval } from "./pollVisibility";

/* One poll of /investor/indices, however many things are reading it.
 *
 * The API client has no request dedupe — every call is a bare fetch — so two
 * components that both want the index are two requests every fifteen seconds,
 * from every open tab, forever. That was fine while exactly one component
 * wanted it. The market desk wants it twice: the pulse row draws the full index
 * board, and the sticky command bar draws a compact strip of the same numbers,
 * which is worth having precisely because it is sticky — scrolled down into the
 * chart, the index is the one piece of context that stops being visible.
 *
 * So the poll lives here instead of in a component. The first subscriber starts
 * it, the last one stops it, and everyone in between gets the same snapshot
 * from the same request. Adding a third reader later costs nothing.
 *
 * Deliberately not a full client-side cache layer. This is one endpoint with
 * one shape and one cadence; a general solution would be a bigger thing than
 * the problem, and the other endpoints on the page each have exactly one
 * reader. */

export interface MarketIndices {
  kospi: IndexQuote | null;
  kosdaq: IndexQuote | null;
  kospiInvestor: MarketInvestorSummary | null;
  kosdaqInvestor: MarketInvestorSummary | null;
}

const EMPTY: MarketIndices = {
  kospi: null,
  kosdaq: null,
  kospiInvestor: null,
  kosdaqInvestor: null,
};

const REFRESH_MS = 15_000;

let snapshot: MarketIndices = EMPTY;
const listeners = new Set<(value: MarketIndices) => void>();
let stopPolling: (() => void) | null = null;

function load() {
  /* fresh=false on purpose: this reuses the backend's stale-while-revalidate
     cache rather than forcing a synchronous re-scrape on every page entry. With
     a 10-20s TTL the worst case is a few seconds of staleness, which is far
     cheaper than blocking a request thread on Naver for every visitor's first
     paint. Same reasoning the component version carried. */
  api
    .indices(false)
    .then((res) => {
      snapshot = {
        kospi: res.kospi,
        kosdaq: res.kosdaq,
        kospiInvestor: res.kospi_investor,
        kosdaqInvestor: res.kosdaq_investor,
      };
      for (const listener of listeners) listener(snapshot);
    })
    .catch(() => {
      // A missed refresh keeps the last snapshot rather than blanking every
      // reader at once.
    });
}

export function useMarketIndices(): MarketIndices {
  const [value, setValue] = useState<MarketIndices>(snapshot);

  useEffect(() => {
    listeners.add(setValue);
    /* Hand the newcomer whatever is already known before its first request
       resolves — a second consumer mounting thirty seconds in should not sit on
       skeletons waiting for the next tick of a poll that is already running. */
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
