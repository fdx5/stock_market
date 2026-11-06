import type { MarketMapItem } from "../api/client";
import { hasReturn } from "./marketQuote";

export type Mood = "extreme-fear" | "fear" | "neutral" | "greed" | "extreme-greed";
export function moodOf(score: number): Mood { return score < 25 ? "extreme-fear" : score < 45 ? "fear" : score <= 55 ? "neutral" : score <= 75 ? "greed" : "extreme-greed"; }
export function fearGreed(items: MarketMapItem[]) {
  const unique = new Map<string, MarketMapItem>();
  for (const item of items) if (item.code && Number.isFinite(item.marcap) && item.marcap > 0 && !unique.has(item.code)) unique.set(item.code, item);
  const universe = [...unique.values()].sort((a, b) => b.marcap - a.marcap).slice(0, 60);
  const known = universe.filter(item => Number.isFinite(item.close) && item.close > 0 && hasReturn(item)), count = known.length;
  const up = known.filter(item => item.change_pct > 0).length, down = known.filter(item => item.change_pct < 0).length, flat = count - up - down;
  const coverage = universe.length ? count / universe.length : 0;
  // A small/failed response or unverified zero quotes cannot become a neutral score.
  if (universe.length < 48 || count < 48 || coverage < .8) return { score: null, mood: null, breadth: null, momentum: null, weightedReturn: null, up, down, flat, count, total: universe.length, coverage, asOf: null };
  const cap = known.reduce((sum, item) => sum + item.marcap, 0);
  const weightedReturn = known.reduce((sum, item) => sum + item.marcap / cap * item.change_pct, 0);
  const breadth = (up + flat * .5) / count * 100;
  // 3 percentage points is this model's fixed scale, not a claimed market standard.
  const momentum = 50 + 50 * Math.tanh(weightedReturn / 3);
  const score = Math.round(Math.max(0, Math.min(100, breadth * .55 + momentum * .45)));
  const times = known.map(item => item.quote_time ?? item.quote_received_at).filter((t): t is number => typeof t === "number" && Number.isFinite(t) && t > 0);
  return { score, mood: moodOf(score), breadth, momentum, weightedReturn, up, down, flat, count, total: universe.length, coverage, asOf: times.length === count ? Math.min(...times) * 1000 : null };
}
