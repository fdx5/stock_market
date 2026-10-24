import { DataRow } from "./researchApi";
import { delta, localNumber } from "./researchFormat";

export function alignReturns(asset: DataRow[], benchmark: DataRow[], key = "close") {
  const other = new Map(benchmark.map(r => [r.date, r[key]]));
  const rows = asset.filter(r => r[key] > 0 && typeof other.get(r.date) === "number" && other.get(r.date) > 0);
  if (rows.length < 2) return [];
  const first = rows[0];
  return rows.map(r => ({ date: r.date, asset: delta(r[key], first[key]), benchmark: delta(other.get(r.date), other.get(first.date)), relative: ((r[key] / first[key]) / (other.get(r.date) / other.get(first.date)) - 1) * 100 }));
}
export function combineCurrency(asset: DataRow[], fx: DataRow[]) {
  const map = new Map(fx.map(r => [r.date, r.close]));
  const aligned = asset.filter(r => r.close > 0 && typeof map.get(r.date) === "number" && map.get(r.date) > 0);
  if (aligned.length < 2) return [];
  const first = aligned[0];
  return aligned.map(r => ({ date: r.date, asset: delta(r.close, first.close), fx: delta(map.get(r.date), map.get(first.date)), total: (r.close / first.close * map.get(r.date) / map.get(first.date) - 1) * 100 }));
}
export function liquidityMetrics(rows: DataRow[]): DataRow[] {
  const complete = rows.filter(r => r.close > 0);
  return complete.map((r, i) => {
    const previous = complete.slice(Math.max(0, i - 20), i); const average = previous.length === 20 && previous.every(p => typeof p.volume === "number" && p.volume >= 0) ? previous.reduce((s, p) => s + p.volume, 0) / 20 : null;
    return { ...r, relative_volume: average && average > 0 && typeof r.volume === "number" && r.volume >= 0 ? r.volume / average : null, range_pct: r.high > 0 && r.low > 0 ? (r.high - r.low) / r.close * 100 : null, amount: typeof r.volume === "number" && r.volume >= 0 ? r.close * r.volume : null };
  });
}
export function bondPrice(face: number, coupon: number, years: number, yieldPct: number, frequency = 2) {
  if (![face, coupon, years, yieldPct, frequency].every(Number.isFinite) || face <= 0 || coupon < 0 || years <= 0 || years > 100 || frequency < 1 || Math.abs(years * frequency - Math.round(years * frequency)) > .000001 || yieldPct <= -100 * frequency) return null;
  const periods = Math.round(years * frequency), payment = face * coupon / 100 / frequency, rate = yieldPct / 100 / frequency;
  let value = 0;
  for (let i = 1; i <= periods; i++) value += (payment + (i === periods ? face : 0)) / Math.pow(1 + rate, i);
  return Number.isFinite(value) ? value : null;
}
export function bondYield(face: number, coupon: number, years: number, price: number, frequency = 2) {
  if (!(price > 0) || bondPrice(face, coupon, years, 0, frequency) === null) return null;
  let low = -90, high = 1000;
  if ((bondPrice(face, coupon, years, low, frequency) ?? 0) < price || (bondPrice(face, coupon, years, high, frequency) ?? Infinity) > price) return null;
  for (let i = 0; i < 120; i++) { const mid = (low + high) / 2; if ((bondPrice(face, coupon, years, mid, frequency) ?? 0) > price) low = mid; else high = mid; }
  return (low + high) / 2;
}
export function overlap(a: DataRow[], b: DataRow[]) {
  const group = (items: DataRow[]) => { const m = new Map<string, number>(); for (const r of items) { const code = String(r.code ?? "").toUpperCase().trim(), weight = localNumber(r.weight); if (code && weight !== null && weight >= 0 && weight <= 100) m.set(code, (m.get(code) ?? 0) + weight); } return m; };
  const left = group(a), right = group(b);
  const totalA = [...left.values()].reduce((s, x) => s + x, 0), totalB = [...right.values()].reduce((s, x) => s + x, 0);
  if (totalA > 100.1 || totalB > 100.1) return null;
  const rows = [...new Set([...left.keys(), ...right.keys()])].map(code => ({ code, a: left.get(code) ?? 0, b: right.get(code) ?? 0, overlap: Math.min(left.get(code) ?? 0, right.get(code) ?? 0), combined: ((left.get(code) ?? 0) + (right.get(code) ?? 0)) / 2 })).sort((a, b) => b.combined - a.combined);
  return { rows, total: rows.reduce((s, r) => s + r.overlap, 0), coverageA: totalA, coverageB: totalB };
}
export function orderCost(units: DataRow[], budget: number) {
  if (!Number.isFinite(budget) || budget <= 0) return null;
  let remaining = budget, quantity = 0, spent = 0;
  for (const unit of units) {
    if (!(unit.ask_price > 0) || !(unit.ask_size >= 0)) continue;
    const take = Math.min(unit.ask_size, remaining / unit.ask_price); quantity += take; spent += take * unit.ask_price; remaining -= take * unit.ask_price;
    if (remaining < 1e-6) break;
  }
  const best = units[0]?.ask_price;
  return { spent, unfilled: Math.max(0, remaining), quantity, average: quantity ? spent / quantity : null, impact: best > 0 && quantity ? ((spent / quantity) / best - 1) * 100 : null };
}
