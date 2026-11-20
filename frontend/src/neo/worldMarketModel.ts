export type Market = {
  code: string;
  name: string;
  cap: number;
  cap_as_of?: string | null;
  cap_estimated?: boolean;
  base_cap?: number;
  base_date?: string | null;
  indices: [string, string][];
  ticker: string;
  company: string;
  context: string;
};

export type Catalog = {source: string; sources?: string[]; period: string; markets: Market[]};
export type Point = {date: string; close: number};
export type Quote = {
  close: number | null;
  change: number | null;
  change_pct: number | null;
  points: Point[];
  quote_time: number | null;
  quote_date?: string | null;
  quote_source?: string | null;
  stale: boolean;
};

export const regions = ["아시아·태평양", "미주", "유럽", "중동"] as const;
export type Region = typeof regions[number];

const marketRegions: Record<string, Region> = {
  US: "미주", CA: "미주", CN: "아시아·태평양", JP: "아시아·태평양", HK: "아시아·태평양",
  IN: "아시아·태평양", TW: "아시아·태평양", KR: "아시아·태평양", AU: "아시아·태평양",
  GB: "유럽", FR: "유럽", DE: "유럽", CH: "유럽", SA: "중동",
};

export type IndexRow = {id: string; label: string; market: Market; region?: Region; quote?: Quote};
export type BoardPeriod = 1 | 5 | 20;
export type ChartPeriod = 5 | 20 | 60;

export const number = (value?: number | null, digits = 2) =>
  value == null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("ko-KR", {minimumFractionDigits: digits, maximumFractionDigits: digits});
export const signed = (value?: number | null, suffix = "%", digits = 2) =>
  value == null || !Number.isFinite(value) ? "—" : (value > 0 ? "+" : "") + number(value, digits) + suffix;
export const tone = (value?: number | null) =>
  value == null || !Number.isFinite(value) ? "missing" : value > 0 ? "up" : value < 0 ? "down" : "flat";

export const kst = (date: Date) => date.toLocaleString("ko-KR", {
  timeZone: "Asia/Seoul", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
});
export const quoteStamp = (quote?: Quote) => quote?.quote_time
  ? kst(new Date(quote.quote_time * 1000)) + " KST"
  : quote?.quote_date ?? quote?.points[quote.points.length - 1]?.date;

export const indexRows = (markets: Market[], quotes?: Record<string, Quote>): IndexRow[] =>
  markets.flatMap(market => market.indices.map(([id, label]) => ({
    id, label, market, region: marketRegions[market.code], quote: quotes?.[id],
  })));

export function tradingReturn(points: Point[], sessions: number) {
  const first = points[points.length - sessions - 1];
  const last = points[points.length - 1];
  return first && last && first.close > 0 ? (last.close / first.close - 1) * 100 : null;
}

export function indexReturn(quote: Quote | undefined, period: BoardPeriod) {
  if (!quote) return null;
  const value = period === 1 ? quote.change_pct : tradingReturn(quote.points, period);
  return value != null && Number.isFinite(value) ? value : null;
}

export const normalizedQuery = (value: string) => value.toLowerCase().replace(/[\s&^./_-]+/g, "");

export function compareSeries(primary: Point[], benchmark: Point[]) {
  const byDate = new Map(benchmark.map(point => [point.date, point.close]));
  const overlap = primary.flatMap(point => {
    const other = byDate.get(point.date);
    return other != null && other > 0 && point.close > 0 ? [{...point, benchmark: other}] : [];
  });
  const base = overlap[0];
  return overlap.map(point => ({
    date: point.date,
    value: (point.close / base.close - 1) * 100,
    benchmark: (point.benchmark / base.benchmark - 1) * 100,
  }));
}
