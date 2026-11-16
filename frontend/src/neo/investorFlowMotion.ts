import type { IndexQuote, MarketInvestorSummary } from "../api/client";

export const FLOW_DURATION_MS = 60_000;
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

/** Keep the unresolved won digits alive even when the rounded feed repeats.
 * This is explicitly labelled visual motion, bounded below half the feed's
 * KRW 100M precision. It never accumulates or changes a net buy/sell sign.
 */
function noise(time: number, seed: number): number {
  const at = (index: number) => {
    let hash = Math.imul(index ^ seed, 0x45d9f3b);
    hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
    return ((hash ^ (hash >>> 16)) >>> 0) / 0xffffffff * 2 - 1;
  };
  const index = Math.floor(time), p = time - index, ease = p * p * (3 - 2 * p);
  return at(index) + (at(index + 1) - at(index)) * ease;
}

export function flowMicroValuesAt(base: FlowAmounts, change: FlowAmounts, startedAt: number, now: number, initialDirection = 1): FlowAmounts {
  const seconds = Math.max(0, Math.min(FLOW_DURATION_MS, now - startedAt)) / 1000;
  const envelope = Math.max(0, Math.min(1, seconds / .8, (FLOW_DURATION_MS / 1000 - seconds) / .8));
  return base.map((value, index) => {
    if (value === 0) return 0;
    const amplitude = Math.min(18_000_000, 3_200_000 + Math.abs(change[index]) * .025, Math.abs(value) * .02);
    const seed = (Math.floor(startedAt / 1000) ^ Math.imul(index + 1, 19790321) ^ Math.round(Math.abs(change[index]))) | 0;
    const tempo = .85 + (seed >>> 0) % 61 / 100;
    const t = seconds * tempo;
    // Independent short bursts, slow drifts and lulls instead of a repeating sine.
    const irregular = .44 * noise(t / .47, seed) + .28 * noise(t / 1.63, seed + 13)
      + .18 * noise(t / 5.71, seed + 31) + .10 * noise(t / 13.9, seed + 57);
    const opening = (Math.sign(change[index]) || Math.sign(initialDirection) || 1) * .4 * Math.exp(-seconds / 3);
    const wave = Math.max(-1, Math.min(1, irregular * (1 - Math.exp(-seconds / 2)) + opening));
    return Math.round(value + amplitude * wave * envelope);
  }) as FlowAmounts;
}

export const sameAmounts = (a: FlowAmounts | null, b: FlowAmounts | null) =>
  a === b || !!a && !!b && a.every((value, index) => value === b[index]);
