import type { IndicatorPoint, MarketMapItem, SectorMap, UsSectorMap } from "../../api/client";
import { dailyPoints, finite, periodReturns } from "./stockReturns";

export interface BriefQuote { close: number; change?: number; change_pct?: number; name?: string; session?: "pre" | "regular" | "post" }
export interface PeerComparison { sector: string; count: number; own: number; average: number; relative: number; session: string; asOf: string | null; names: { code: string; name: string; change: number }[] }
export function peerComparison(code: string, map: Pick<SectorMap | UsSectorMap, "sector" | "items"> & { generated_at?: string }): PeerComparison | null {
  const target = map.items.find((p) => p.code.toUpperCase() === code.toUpperCase());
  if (!map.sector || !target || !finite(target.close) || target.close <= 0 || !finite(target.change_pct)) return null;
  const session = target.session ?? "regular";
  const others = map.items.filter((p) => p.code.toUpperCase() !== code.toUpperCase() && finite(p.close) && p.close > 0 && finite(p.change_pct) && (p.session ?? "regular") === session);
  if (!others.length) return null;
  const average = others.reduce((sum, p) => sum + p.change_pct, 0) / others.length;
  return { sector: map.sector, count: others.length, own: target.change_pct, average, relative: target.change_pct - average, session, asOf: map.generated_at && Number.isFinite(Date.parse(map.generated_at)) ? map.generated_at : null, names: [...others].sort((a: MarketMapItem, b: MarketMapItem) => (b.market_cap ?? b.marcap) - (a.market_cap ?? a.marcap)).slice(0, 3).map((p) => ({ code: p.code, name: p.name, change: p.change_pct })) };
}

export interface BriefInput { points: IndicatorPoint[]; quote: BriefQuote | null; summary?: { date: string; close: number; change_pct: number } | null; peers?: PeerComparison | null; bench?: IndicatorPoint[] | null }
export function stockBrief(input: BriefInput) {
  const points = dailyPoints(input.points);
  const latest = points[points.length - 1];
  const validQuote = input.quote && finite(input.quote.close) && input.quote.close > 0 ? input.quote : null;
  const price = validQuote?.close ?? (input.summary && finite(input.summary.close) && input.summary.close > 0 ? input.summary.close : latest?.close ?? null);
  const day = validQuote ? finite(validQuote.change_pct) ? validQuote.change_pct : null : input.summary && finite(input.summary.change_pct) ? input.summary.change_pct : null;
  const returns = periodReturns(points, input.bench ?? null);
  const month = returns.find((r) => r.key === "1m")!;
  const volumeRatio = latest && finite(latest.volume) && latest.volume >= 0 && finite(latest.volume_ma20) && latest.volume_ma20 > 0 ? latest.volume / latest.volume_ma20 : null;
  const rsi = latest && finite(latest.rsi14) && latest.rsi14 >= 0 && latest.rsi14 <= 100 ? latest.rsi14 : null;
  const distance20 = latest && finite(latest.sma20) && latest.sma20 > 0 ? (latest.close / latest.sma20 - 1) * 100 : null;
  const recent = points.slice(-20);
  const low = recent.length ? Math.min(...recent.map((p) => p.close)) : null;
  const high = recent.length ? Math.max(...recent.map((p) => p.close)) : null;
  return { points, latest, price, day, returns, month, volumeRatio, rsi, distance20, recent, low, high, peers: input.peers ?? null, priceKind: validQuote ? "quote" : "daily" };
}
