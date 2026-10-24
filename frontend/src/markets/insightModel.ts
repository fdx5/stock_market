import { DiscoveryRow, finite } from "./discoveryModel";

/** Every comparison uses the same complete-case universe, never a mix of denominators. */
export function marketInside(rows: DiscoveryRow[]) {
  const valid = rows.filter(r => r.cap !== null && r.cap > 0 && r.change !== null).sort((a, b) => b.cap! - a.cap!);
  const cap = valid.reduce((sum, r) => sum + r.cap!, 0);
  const weighted = cap ? valid.reduce((sum, r) => sum + r.cap! * r.change!, 0) / cap : null;
  const equal = valid.length ? valid.reduce((sum, r) => sum + r.change!, 0) / valid.length : null;
  const leaders = valid.slice(0, 3), rest = valid.slice(3);
  const topCap = leaders.reduce((sum, r) => sum + r.cap!, 0), restCap = cap - topCap;
  const withoutTop3 = restCap > 0 ? rest.reduce((sum, r) => sum + r.cap! * r.change!, 0) / restCap : null;
  const contribution = cap ? leaders.reduce((sum, r) => sum + r.cap! * r.change!, 0) / cap : null;
  const up = valid.filter(r => r.change! > 0).length, down = valid.filter(r => r.change! < 0).length;
  return { total: rows.length, count: valid.length, weighted, equal, withoutTop3, contribution,
    topShare: cap ? topCap / cap * 100 : null, up, down, flat: valid.length - up - down, leaders,
    divergence: weighted !== null && weighted > 0 && up < valid.length / 2,
    signFlip: weighted !== null && withoutTop3 !== null && weighted * withoutTop3 < 0 };
}

export function recoveryScenario(lossPercent: number) {
  const loss = finite(lossPercent);
  if (loss === null || loss < 0 || loss >= 100) return null;
  const remaining = 100 - loss;
  return { loss, remaining, recovery: loss === 0 ? 0 : loss / remaining * 100 };
}

export function targetDistance(current: number | null, target: number | null) {
  if (current === null || target === null || !Number.isFinite(current) || !Number.isFinite(target) || current <= 0 || target <= 0) return null;
  return finite((target / current - 1) * 100);
}

export function peerTradeoffs(base: DiscoveryRow, candidate: DiscoveryRow) {
  if (base.market !== candidate.market || base.sector !== candidate.sector || base.id === candidate.id) return [];
  const delta = (a: number | null, b: number | null) => a !== null && b !== null ? b - a : null;
  return [
    { label: "PER", delta: delta(base.per, candidate.per), unit: "배", interpretation: "낮다는 사실만으로 저평가를 뜻하지 않습니다." },
    { label: "ROE", delta: delta(base.roe, candidate.roe), unit: "%p", interpretation: "높은 ROE에는 자본 규모와 부채의 영향이 있을 수 있습니다." },
    { label: "1개월 등락률", delta: delta(base.m1, candidate.m1), unit: "%p", interpretation: "최근 성과가 향후 수익을 보장하지 않습니다." },
    { label: "52주 고점 대비", delta: delta(base.highGap, candidate.highGap), unit: "%p", interpretation: "높을수록 고점에 가깝다는 뜻이며, 안전성 점수는 아닙니다." },
  ];
}
