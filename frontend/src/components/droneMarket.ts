import type { RealEstateNearbyComplex, RealEstateTypeView } from '../api/client';

/** Display money in 만원, truncating below 천만원 rather than rounding up. */
export function dronePrice(manwon: number): string {
  if (!Number.isFinite(manwon) || manwon <= 0) return '—';
  const thousands = Math.floor(manwon / 1000);
  if (!thousands) return '1천만 미만';
  const eok = Math.floor(thousands / 10), rest = thousands % 10;
  return eok ? `${eok.toLocaleString('ko-KR')}억${rest ? ` ${rest}천` : ''}` : `${rest}천만`;
}

const normalizedName = (name: string) => name.replace(/[\s()·\-_.,]/g, '').replace(/아파트$/, '');

/** Candidates already match the exact parcel. Never choose an arbitrary complex on a shared lot. */
export function droneComplexMatch(name: string, items: RealEstateNearbyComplex[]): RealEstateNearbyComplex | null {
  const matches = items.filter(item => normalizedName(item.name) === normalizedName(name));
  return matches.length === 1 ? matches[0] : items.length === 1 ? items[0] : null;
}

export type DroneMarketQuote = {
  average: number; samples: number; from: string; to: string;
  change: number | null; tone: 'up' | 'down' | 'flat' | 'unknown'; direct: boolean;
};

/** Same-area trades from the past 365 days. Direct deals are used only when there are no brokered deals. */
export function droneMarketQuote(type: RealEstateTypeView, now = new Date()): DroneMarketQuote | null {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const lower = today - 365 * 86400000;
  const rows = (type.deals ?? type.history).filter(row => {
    const [date, price] = row, s = String(date);
    if (!/^\d{8}$/.test(s) || !Number.isFinite(price) || price <= 0) return false;
    const t = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
    const check = new Date(t);
    return check.getUTCFullYear() === +s.slice(0, 4) && check.getUTCMonth() + 1 === +s.slice(4, 6)
      && check.getUTCDate() === +s.slice(6, 8) && t >= lower && t <= today;
  });
  const brokered = rows.filter(row => !row[3]), samples = brokered.length ? brokered : rows;
  if (!samples.length) return null;
  const average = samples.reduce((total, row) => total + row[1], 0) / samples.length;
  const change = typeof type.change_pct === 'number' && Number.isFinite(type.change_pct) ? type.change_pct : null;
  const dates = samples.map(row => row[0]).sort((a, b) => a - b);
  const dotted = (value: number) => { const s = String(value); return `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`; };
  return { average, samples: samples.length, from: dotted(dates[0]), to: dotted(dates[dates.length - 1]),
    change, tone: change === null ? 'unknown' : change > 0 ? 'up' : change < 0 ? 'down' : 'flat', direct: !brokered.length };
}
