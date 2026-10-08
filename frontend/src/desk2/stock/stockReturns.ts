import type { IndicatorPoint } from "../../api/client";

export interface PeriodReturn { key: string; ko: string; en: string; value: number | null; bench: number | null; start?: string; end?: string }
export const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export function dailyPoints(points: IndicatorPoint[]): IndicatorPoint[] {
  const byDate = new Map<string, IndicatorPoint>();
  for (const p of points) if (/^\d{4}-\d{2}-\d{2}$/.test(p.date) && finite(p.close) && p.close > 0) byDate.set(p.date, p);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export function periodReturns(raw: IndicatorPoint[], benchmark: IndicatorPoint[] | null): PeriodReturn[] {
  const points = dailyPoints(raw);
  const end = points[points.length - 1];
  const bench = new Map(dailyPoints(benchmark ?? []).map((p) => [p.date, p.close]));
  const calc = (start: IndicatorPoint | undefined) => ({
    value: start && end ? (end.close / start.close - 1) * 100 : null,
    // A missing endpoint is a gap, never a licence to compare different dates.
    bench: start && end && bench.has(start.date) && bench.has(end.date) ? (bench.get(end.date)! / bench.get(start.date)! - 1) * 100 : null,
    start: start?.date, end: end?.date,
  });
  const windows = [{ key: "1w", ko: "1주", en: "1W", n: 5 }, { key: "1m", ko: "1개월", en: "1M", n: 21 }, { key: "3m", ko: "3개월", en: "3M", n: 63 }, { key: "6m", ko: "6개월", en: "6M", n: 126 }, { key: "1y", ko: "1년", en: "1Y", n: 252 }];
  const out = windows.map((w) => ({ key: w.key, ko: w.ko, en: w.en, ...calc(points[points.length - 1 - w.n]) }));
  out.push({ key: "ytd", ko: "연초 이후", en: "YTD", ...calc(end ? [...points].reverse().find((p) => p.date.slice(0, 4) < end.date.slice(0, 4)) : undefined) });
  return out;
}
