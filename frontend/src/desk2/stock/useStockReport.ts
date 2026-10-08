import { useEffect, useState } from "react";
import { api, CompanyOverview, GlobalEnrichment, IndicatorPoint, StockSummary, SectorMap, UsSectorMap } from "../../api/client";
import { startVisibilityAwareInterval } from "../../pollVisibility";
import { BriefQuote, peerComparison, PeerComparison } from "./stockBriefModel";

type Status = "loading" | "ready" | "unavailable";
type Feed = "quote" | "history" | "profile" | "peers";
export function useStockReport(code: string, isEtf: boolean) {
  const us = !/^\d[0-9A-Z]{5}$/.test(code);
  const [quote, setQuote] = useState<BriefQuote | null>(null);
  const [summary, setSummary] = useState<StockSummary | null>(null);
  const [points, setPoints] = useState<IndicatorPoint[]>([]);
  const [overview, setOverview] = useState<CompanyOverview | null>(null);
  const [enrich, setEnrich] = useState<GlobalEnrichment | null>(null);
  const [peers, setPeers] = useState<PeerComparison | null>(null);
  const [receivedAt, setReceivedAt] = useState<string | null>(null);
  const [status, setStatus] = useState<Partial<Record<Feed, Status>>>({ quote: "loading", history: "loading" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    let quoting = false;
    const controllers = new Set<AbortController>();
    const request = <T,>(fetch: (signal: AbortSignal) => Promise<T>) => {
      const controller = new AbortController();
      controllers.add(controller);
      const timer = window.setTimeout(() => controller.abort(), 25_000);
      return fetch(controller.signal).finally(() => { window.clearTimeout(timer); controllers.delete(controller); });
    };
    const mark = (feed: Feed, value: Status) => { if (alive) setStatus((s) => ({ ...s, [feed]: value })); };
    const run = <T,>(feed: Feed, fetch: (signal: AbortSignal) => Promise<T>, accept: (value: T) => void, silent = false) => {
      if (!silent) mark(feed, "loading");
      return request(fetch).then((value) => { if (alive) { accept(value); mark(feed, "ready"); } }).catch(() => mark(feed, "unavailable"));
    };
    const loadQuote = (silent = true) => {
      if (quoting) return;
      quoting = true;
      return run<BriefQuote>("quote", (signal) => us ? api.usStockQuote(code, signal) : api.quote(code, signal), (q) => {
        if (!Number.isFinite(q.close) || q.close <= 0) throw new Error("Unusable quote");
        setQuote(q); setReceivedAt(new Date().toISOString());
      }, silent).finally(() => { quoting = false; });
    };
    loadQuote(false);
    run("history", (signal) => us ? api.usStockIndicators(code, 3, signal) : api.indicators(code, 3, signal), (r) => {
      if (!r.points.length) throw new Error("No daily prices");
      setPoints(r.points);
    });
    if (!us) request((signal) => api.summary(code, signal)).then((s) => { if (alive) setSummary(s); }).catch(() => {});
    if (!isEtf) {
      run<SectorMap | UsSectorMap>("peers", (signal) => us ? api.usSectorMap(code, 40, signal) : api.sectorMap(code, 40, signal), (r) => {
        const result = peerComparison(code, r);
        if (!result) throw new Error("No comparable peers");
        setPeers(result);
      });
      if (us) run("profile", (signal) => api.globalEnrichment(code, "ko", signal), setEnrich);
      else run("profile", (signal) => api.overview(code, signal), setOverview);
    }
    const stop = startVisibilityAwareInterval(() => loadQuote(), 10_000);
    return () => { alive = false; stop(); for (const controller of controllers) controller.abort(); };
  }, [code, us, isEtf, revision]);
  return { us, quote, summary, points, overview, enrich, peers, receivedAt, status, reload: () => setRevision((r) => r + 1) };
}
