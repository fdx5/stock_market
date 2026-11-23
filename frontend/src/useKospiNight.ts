import { useEffect, useState } from "react";
import { api, type KospiNightQuote } from "./api/client";
import { startVisibilityAwareInterval } from "./pollVisibility";

/** One shared 10-second poll per quote, however many badges mount it. */
function createQuotePoller(fetch: () => Promise<KospiNightQuote>) {
  let quote: KospiNightQuote | null = null;
  let inFlight = false;
  let stop: (() => void) | null = null;
  const listeners = new Set<(next: KospiNightQuote | null) => void>();
  const publish = () => listeners.forEach(listener => listener(quote));
  function load() {
    if (inFlight) return;
    inFlight = true;
    fetch().then(next => {
      if (quote?.quote_time && (!next.quote_time || next.quote_time < quote.quote_time)) {
        quote = { ...quote, stale: true };
      } else quote = next;
      publish();
    }).catch(() => {
      if (quote) { quote = { ...quote, stale: true, fetch_failed: true }; publish(); }
    }).finally(() => { inFlight = false; });
  }
  return function useQuote() {
    const [value, setValue] = useState(quote);
    useEffect(() => {
      listeners.add(setValue);
      setValue(quote);
      if (listeners.size === 1) { load(); stop = startVisibilityAwareInterval(load, 10_000); }
      return () => { listeners.delete(setValue); if (!listeners.size) { stop?.(); stop = null; } };
    }, []);
    return value;
  };
}

export const useKospiNight = createQuotePoller(() => api.kospiNight());
/** KOSPI 200 day-session futures (Naver FUT). */
export const useKospiFutures = createQuotePoller(() => api.kospiFutures());

const FRESH_SECONDS = 30 * 60;
type TradingQuote = KospiNightQuote & { close: number; quote_time: number };

export function useOpenKospiQuote() {
  const day = useKospiFutures();
  const night = useKospiNight();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    return startVisibilityAwareInterval(update, 10_000);
  }, []);

  const isTrading = (quote: KospiNightQuote | null): quote is TradingQuote =>
    quote?.session_state === "open" && quote.close != null && quote.quote_time != null &&
    now / 1000 - quote.quote_time < FRESH_SECONDS;

  const dayOpen = isTrading(day);
  if (isTrading(night) && (!dayOpen || night.quote_time > day.quote_time)) {
    return { session: "night", quote: night } as const;
  }
  return dayOpen ? { session: "day", quote: day } as const : null;
}
