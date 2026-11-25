import { useEffect, useRef, useState } from "react";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { API_POLL_MS } from "../apiPolling";
import type { Quote } from "./worldMarketModel";

type Quotes = Record<string, Quote>;
type Snapshot = {history: string; compact: boolean; quotes: Quotes};

export function useWorldQuotes() {
  const [state, setState] = useState<{value?: Quotes; received?: number; error?: boolean}>({});
  const retry = useRef<() => void>(() => {});
  useEffect(() => {
    let previous: Snapshot | undefined;
    let pending: AbortController | undefined;
    let mounted = true;
    async function refresh() {
      if (pending) return;
      const controller = new AbortController();
      pending = controller;
      const timeout = window.setTimeout(() => controller.abort(), 45_000);
      try {
        const url = "/api/world-markets/board" + (previous ? "?history=" + previous.history : "");
        const response = await fetch(url, {cache: "no-store", signal: controller.signal});
        if (!response.ok) throw Error();
        const next: Snapshot = await response.json();
        if (!mounted) return;
        if (next.compact) {
          if (!previous || previous.history !== next.history) throw Error();
          for (const [code, quote] of Object.entries(next.quotes)) {
            quote.points = previous.quotes[code].points.slice(0, -1).concat(quote.points);
          }
        }
        previous = next;
        setState(old => {
          const value = {...next.quotes};
          for (const [code, quote] of Object.entries(value)) {
            const held = old.value?.[code];
            if (!held || held.close == null) continue;
            const reverted = quote.quote_time && held.quote_time && quote.quote_time < held.quote_time;
            const olderDay = (quote.quote_date ?? "") < (held.quote_date ?? "");
            if (quote.close == null || reverted || olderDay ||
                (!quote.quote_time && held.quote_time && held.quote_date === quote.quote_date)) {
              value[code] = {...held, stale: true};
            }
          }
          return {value, received: Date.now()};
        });
      } catch {
        previous = undefined;
        if (mounted) setState(old => ({...old, error: true, value: old.value &&
          Object.fromEntries(Object.entries(old.value).map(([id, quote]) => [id, {...quote, stale: true}]))}));
      } finally {
        clearTimeout(timeout);
        pending = undefined;
      }
    }
    retry.current = refresh;
    void refresh();
    const stop = startVisibilityAwareInterval(refresh, API_POLL_MS);
    return () => { mounted = false; stop(); pending?.abort(); };
  }, []);
  return {...state, retry: () => retry.current()};
}
