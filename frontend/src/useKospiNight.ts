import { useEffect, useState } from "react";
import { api, type KospiNightQuote } from "./api/client";
import { startVisibilityAwareInterval } from "./pollVisibility";

let quote: KospiNightQuote | null = null;
let inFlight = false;
let stop: (() => void) | null = null;
const listeners = new Set<(next: KospiNightQuote | null) => void>();
function publish() { listeners.forEach(listener => listener(quote)); }
function load() {
  if (inFlight) return;
  inFlight = true;
  api.kospiNight().then(next => {
    if (quote?.quote_time && (!next.quote_time || next.quote_time < quote.quote_time)) {
      quote = { ...quote, stale: true };
    } else quote = next;
    publish();
  }).catch(() => {
    if (quote) { quote = { ...quote, stale: true, fetch_failed: true }; publish(); }
  }).finally(() => { inFlight = false; });
}
export function useKospiNight() {
  const [value, setValue] = useState(quote);
  useEffect(() => {
    listeners.add(setValue);
    setValue(quote);
    if (listeners.size === 1) { load(); stop = startVisibilityAwareInterval(load, 10_000); }
    return () => { listeners.delete(setValue); if (!listeners.size) { stop?.(); stop = null; } };
  }, []);
  return value;
}
