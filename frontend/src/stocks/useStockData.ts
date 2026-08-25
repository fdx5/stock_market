import { useCallback, useEffect, useRef, useState } from "react";
import {
  OhlcvPoint,
  StockUniverseMarket,
  StockUniversePage,
  StockUniverseRow,
  StockUniverseSort,
  api,
} from "../api/client";

/** The slice of a quote this panel actually renders.
 *
 * The two markets' quote endpoints return different shapes — the KR one carries
 * `marcap`, the US one carries the pre/post session instead — and the panel reads only
 * the three fields both agree on. Naming that overlap here is what lets one hook serve
 * both without a union type leaking into every component that displays a price. */
export interface LiveQuote {
  close: number;
  change: number;
  change_pct: number;
}

/** The page's live cadence, from the spec: both the visible 50 rows and the open
 *  stock's own numbers refresh on this interval. */
export const REFRESH_MS = 10_000;

/* Why polling is written twice here rather than shared with a generic usePoll:
 * the two things being polled fail differently and must recover differently.
 *
 * A roster refresh that fails should leave the 50 rows on screen exactly as they were
 * — a list that empties itself because one request timed out is worse than a list ten
 * seconds stale. A detail refresh that fails is the same, but it must also not race:
 * the viewer can click another stock while a refresh for the previous one is in
 * flight, and the late response has to be dropped rather than painted over the new
 * selection. Both are three lines; a shared abstraction that covered both would be
 * longer than both and would still need the caller to say which behaviour it wanted.
 */

interface RosterState {
  page: StockUniversePage | null;
  loading: boolean;
  error: string;
}

/** One page of a market's cap ranking, refreshed in place every REFRESH_MS.
 *
 * `loading` is true only while there is nothing to show — a background refresh of an
 * already-rendered page never flips it, because a spinner replacing a list the viewer
 * is reading, six times a minute, is the failure mode this whole page must avoid.
 *
 * The returned page is matched against the requested (market, page) *during render*,
 * not cleared by an effect. That distinction is the whole reason this reads the way it
 * does: an effect that clears stale state runs after the render that follows the
 * click, so for exactly one render the hook would hand back the previous market's rows
 * under the new market's tab. That is long enough for a caller to act on them — and
 * one did, adopting KOSPI's top name as the S&P 500 tab's selection and leaving the
 * detail panel a market behind the rail. Validating here means stale data is never
 * observable at all, rather than observable briefly.
 */
export function useStockRoster(
  market: StockUniverseMarket,
  page: number,
  size: number,
  sector: string,
  query: string,
  sort: StockUniverseSort,
): RosterState {
  const [state, setState] = useState<RosterState>({ page: null, loading: true, error: "" });
  // What the newest request was for, so a response that arrives after the viewer has
  // moved on is dropped rather than stored.
  const wanted = useRef({ market, page, sector, query, sort });

  useEffect(() => {
    wanted.current = { market, page, sector, query, sort };
    let cancelled = false;

    const load = (initial: boolean) => {
      api
        .stockUniverse(market, page, size, sector, query, sort)
        .then((result) => {
          if (
            cancelled ||
            wanted.current.market !== market ||
            wanted.current.page !== page ||
            wanted.current.sector !== sector ||
            wanted.current.query !== query
            || wanted.current.sort !== sort
          ) {
            return;
          }
          setState({ page: result, loading: false, error: "" });
        })
        .catch(() => {
          if (cancelled) return;
          // Only an initial load can report failure by emptying the panel; a failed
          // refresh keeps the rows it already has and says nothing.
          if (initial) setState((old) => ({ ...old, loading: false, error: "종목 목록을 불러오지 못했습니다." }));
        });
    };

    load(true);
    const timer = window.setInterval(() => load(false), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [market, page, size, sector, query, sort]);

  // The response carries the market, sector and page it is for, so this is a comparison of
  // what arrived against what is wanted — not a guess from a separate flag.
  const fresh =
    state.page &&
    state.page.market === market &&
    state.page.page === page &&
    state.page.sector === sector &&
    state.page.query === query
    && state.page.sort === sort
      ? state.page
      : null;
  return { page: fresh, loading: fresh === null && !state.error, error: fresh === null ? state.error : "" };
}

export interface DetailState {
  /** The roster row this panel opened from — name, sector, cap. Present immediately on
   *  a click, because the list already had it; the panel never waits to draw itself. */
  row: StockUniverseRow;
  /** The live quote, which is what the 10s tick actually moves. Null until the first
   *  response, and the panel falls back to `row`'s numbers meanwhile. */
  quote: LiveQuote | null;
  history: OhlcvPoint[];
  historyLoading: boolean;
}

/** Live price and chart history for the open stock.
 *
 * The quote polls; the history does not. A daily OHLCV series gains a point once a
 * session, and its last close is the quote the panel is already refreshing — so the
 * chart's final point is patched from the quote rather than re-downloading three years
 * of bars six times a minute. */
export function useStockDetail(row: StockUniverseRow | null, isUs: boolean): DetailState | null {
  const [quote, setQuote] = useState<LiveQuote | null>(null);
  const [history, setHistory] = useState<OhlcvPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const code = row?.code ?? "";

  const fetchQuote = useCallback(
    (): Promise<LiveQuote> => (isUs ? api.usStockQuote(code) : api.quote(code)),
    [code, isUs],
  );

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setQuote(null);

    const load = () => {
      fetchQuote()
        .then((result) => !cancelled && setQuote(result))
        .catch(() => {
          /* Keep the last good quote; the row's own numbers back it up regardless. */
        });
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [code, fetchQuote]);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setHistory([]);
    setHistoryLoading(true);
    const request = isUs ? api.usHistory(code, 1) : api.history(code, 1);
    request
      .then((result) => !cancelled && setHistory(result.points))
      .catch(() => !cancelled && setHistory([]))
      .finally(() => !cancelled && setHistoryLoading(false));
    return () => {
      cancelled = true;
    };
  }, [code, isUs]);

  if (!row) return null;
  return { row, quote, history, historyLoading };
}

/** The chart series with its last point pinned to the live close.
 *
 * Without this the panel shows a headline price that ticks and a chart that ends on
 * yesterday's — the same number, in two places, disagreeing. */
export function withLiveClose(history: OhlcvPoint[], close: number | null | undefined): OhlcvPoint[] {
  if (!history.length || close == null || !Number.isFinite(close)) return history;
  const last = history[history.length - 1];
  if (last.close === close) return history;
  return [...history.slice(0, -1), { ...last, close }];
}
