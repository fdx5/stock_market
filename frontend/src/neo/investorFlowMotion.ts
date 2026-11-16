import type { IndexQuote, MarketInvestorSummary } from "../api/client";

export const FLOW_DURATION_MS = 10_000;
export const FLOW_STALE_MS = 30_000;
export type FlowAmounts = [number, number, number];
export interface FlowTransition { from: FlowAmounts; to: FlowAmounts; startedAt: number }

/** The public feed supplies signed NET amounts in KRW 100M, not gross buys/sells. */
export function investorWon(source: MarketInvestorSummary | null): FlowAmounts | null {
  if (!source) return null;
  const amounts: FlowAmounts = [source.individual_amount, source.foreign_amount, source.institution_amount];
  return amounts.every(value => typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(Math.round(value * 100_000_000)))
    ? amounts.map(value => Math.round(value * 100_000_000)) as FlowAmounts : null;
}

export function flowIsFresh(source: MarketInvestorSummary | null, quote: IndexQuote | null, now: number): boolean {
  const fetched = (source?.fetched_at ?? 0) * 1000;
  const quoted = Date.parse(quote?.updated_at ?? "");
  const today = new Date(now + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "");
  return quote?.market_status === "OPEN" && source?.business_date === today
    && fetched <= now + 10_000 && now - fetched <= FLOW_STALE_MS
    && Number.isFinite(quoted) && quoted <= now + 10_000 && now - quoted <= 90_000;
}

/** A bounded, gently reversing path between two received values; never extrapolate. */
export function flowValuesAt(transition: FlowTransition, now: number): FlowAmounts {
  const p = Math.max(0, Math.min(1, (now - transition.startedAt) / FLOW_DURATION_MS));
  if (p === 0) return transition.from;
  if (p === 1) return transition.to;
  return transition.to.map((target, index) => {
    const wave = .065 * Math.sin(Math.PI * p) * Math.sin(12 * Math.PI * p + index * 1.7);
    const progress = Math.max(0, Math.min(1, p + wave));
    return Math.round(transition.from[index] + (target - transition.from[index]) * progress);
  }) as FlowAmounts;
}

export const sameAmounts = (a: FlowAmounts | null, b: FlowAmounts | null) =>
  a === b || !!a && !!b && a.every((value, index) => value === b[index]);
