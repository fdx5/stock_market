import { useEffect, useState } from "react";
import { api, type TreasuryHeadline } from "./api/client";
import { startVisibilityAwareInterval } from "./pollVisibility";

let items: TreasuryHeadline[] = [];
let inFlight = false;
let stop: (() => void) | null = null;
const listeners = new Set<(next: TreasuryHeadline[]) => void>();
function publish() { listeners.forEach(listener => listener(items)); }
function load() {
  if (inFlight) return;
  inFlight = true;
  api.treasuryHeadlines().then(next => {
    items = (["2", "10"] as const).map(tenor => {
      const old = items.find(item => item.tenor === tenor);
      const quote = next.items.find(item => item.tenor === tenor);
      if (quote?.yield_pct != null && Number.isFinite(quote.yield_pct)) return quote;
      return old ? { ...old, stale: true } : { tenor, symbol: `US${tenor}Y`, yield_pct: null, change_bp: null, stale: true };
    });
    publish();
  }).catch(() => { items = items.map(item => ({ ...item, stale: true })); publish(); })
    .finally(() => { inFlight = false; });
}
export function useTreasuryHeadlines() {
  const [value, setValue] = useState(items);
  useEffect(() => {
    listeners.add(setValue); setValue(items);
    if (listeners.size === 1) { load(); stop = startVisibilityAwareInterval(load, 15_000); }
    return () => { listeners.delete(setValue); if (!listeners.size) { stop?.(); stop = null; } };
  }, []);
  return value;
}
