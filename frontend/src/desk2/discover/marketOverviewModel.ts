import type { MarketMapItem } from "../../api/client";

export const MOVE_BINS = [
  { label: "≤−3", range: "−3% 이하", en: "−3% and below", tone: "down", test: (v: number) => v <= -3 },
  { label: "−3~−1", range: "−3% 초과 −1% 이하", en: "Above −3% to −1%", tone: "down", test: (v: number) => v > -3 && v <= -1 },
  { label: "−1~0", range: "−1% 초과 0% 미만", en: "Above −1% to below 0%", tone: "down", test: (v: number) => v > -1 && v < 0 },
  { label: "0", range: "보합 0%", en: "Unchanged, 0%", tone: "flat", test: (v: number) => v === 0 },
  { label: "0~1", range: "0% 초과 1% 미만", en: "Above 0% to below 1%", tone: "up", test: (v: number) => v > 0 && v < 1 },
  { label: "1~3", range: "1% 이상 3% 미만", en: "1% to below 3%", tone: "up", test: (v: number) => v >= 1 && v < 3 },
  { label: "≥+3", range: "3% 이상", en: "3% and above", tone: "up", test: (v: number) => v >= 3 },
] as const;

export function overviewDistribution(items: MarketMapItem[]) {
  const unique = new Map<string, MarketMapItem>();
  for (const item of items) if (item.code && !unique.has(item.code)) unique.set(item.code, item);
  const valid = [...unique.values()].filter(item => Number.isFinite(item.change_pct) && Number.isFinite(item.close) && item.close > 0);
  const bins = MOVE_BINS.map(bin => valid.filter(item => bin.test(item.change_pct)).sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct) || a.code.localeCompare(b.code)));
  const up = valid.filter(item => item.change_pct > 0).length;
  const down = valid.filter(item => item.change_pct < 0).length;
  return { total: valid.length, received: unique.size, up, down, flat: valid.length - up - down,
    upShare: valid.length ? up / valid.length * 100 : null, bins };
}
