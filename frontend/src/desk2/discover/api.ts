import { useEffect, useState } from "react";
import { startVisibilityAwareInterval } from "../../pollVisibility";

export type EditionStatus = { status: "ready" | "loading" | "unavailable"; refreshing: boolean; stale: boolean; edition: string | null; next_update_at?: string; collected_at?: string };
export interface InvestmentVideo { id: string; rank: number; title: string; channel: string; views: number; published_at: string; duration_seconds: number | null; thumbnail: string; url: string; topic: string }
export type VideoEdition = EditionStatus & { market: "kr" | "us"; window_start: string; window_end: string; candidate_count: number; items: InvestmentVideo[] };
export interface Holding { code: string; name: string; weight_pct: number; shares: number; reference_price: number | null; purchase_price: null; reported_value: number; activity: "new" | "add" | "reduce" | "hold" | "unavailable" | "sold"; shares_change_pct: number | null; current_price?: number | null; current_weight_pct?: number | null; reference_return_pct?: number | null; current_value?: number | null; quote_time?: number | null; price_source?: string; position_id?: string; cusip?: string; asset_type?: "equity" | "preferred" | "put" | "call" | "bond"; previous_weight_pct?: number | null; weight_change_pct?: number | null; previous_shares?: number; underlying_price?: number | null; daily_change_pct?: number | null; }
export interface Investor { id: string; name: string; name_en: string; firm: string; style: string; color: string; available: boolean; period?: string; report_date?: string; reported_value?: number; source_url?: string; photo_url?: string; photo_source?: string; photo_credit?: string; photo_license?: string; photo_license_url?: string; holding_count: number; top3_weight: number; new_count: number; add_count: number; top_holdings: Holding[]; collected_at?: string; cik?: string; data_basis?: string; scope_note?: string; scope_url?: string; previous_report_date?: string; previous_source_url?: string; has_options?: boolean; option_count?: number; equity_count?: number; exit_count?: number; }
export interface Consensus { code: string; name: string; count: number; investors: string[]; max_weight: number }
export type InvestorEdition = EditionStatus & { items: Investor[]; consensus: Consensus[]; available_count: number; consensus_period?: string };
export type PortfolioEdition = EditionStatus & { investor: Investor; holdings: Holding[]; exited_holdings?: Holding[]; estimated_equity_value: number | null; valuation_complete?: boolean; purchase_price_disclosed: false };

export function useEditorial<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true, busy = false;
    const controller = new AbortController();
    setData(null); setError(false);
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        const response = await fetch(`/api/editorial/${path}`, { cache: "no-cache", signal: controller.signal });
        if (!response.ok) throw new Error("Editorial unavailable");
        const result = await response.json() as T;
        if (alive) { setData(result); setError(false); }
      } catch { if (alive) setError(true); }
      finally { busy = false; }
    };
    load();
    const stop = startVisibilityAwareInterval(load, 20_000);
    return () => { alive = false; controller.abort(); stop(); };
  }, [path]);
  return { data, error };
}

export const formatViews = (value: number) => value >= 10000 ? `${(value / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만` : value.toLocaleString("ko-KR");
export const editionTime = (end?: string) => end ? new Date(end).toLocaleTimeString("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" }) : "08:00";
export const videoWindowText = (data: VideoEdition | null) => data?.window_start && data.window_end
  ? `${dateText(data.window_start, true)} ~ ${dateText(data.window_end, true)}(KST) 공개`
  : "매일 08:00 · 16:00 KST 갱신";
export const dollars = (value: number | null | undefined) => value == null ? "—" : `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const percent = (value: number | null | undefined, signed = false) => value == null ? "—" : `${signed && value > 0 ? "+" : ""}${value.toFixed(2)}%`;
export const compactDollars = (value: number | null | undefined) => value == null ? "—" : value >= 1e9 ? `$${(value / 1e9).toLocaleString("en-US", { maximumFractionDigits: 1 })}B` : `$${(value / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
export const dateText = (value: string | undefined, time = false) => value ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", ...(time ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}) }) : "확인 중";
