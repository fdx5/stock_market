const BASE = "/api";

export interface StockSearchResult {
  code: string;
  name: string;
  market: string;
}

export interface OhlcvPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorPoint extends OhlcvPoint {
  sma5: number | null;
  sma20: number | null;
  sma60: number | null;
  sma120: number | null;
  ema12: number | null;
  ema26: number | null;
  macd: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  rsi14: number | null;
  bb_upper: number | null;
  bb_mid: number | null;
  bb_lower: number | null;
  volume_ma20: number | null;
  obv: number | null;
  atr14: number | null;
  volatility20: number | null;
}

export interface PredictionResult {
  code: string;
  name: string;
  direction: "상승" | "하락" | "보합";
  confidence: "강" | "중" | "약";
  score: number;
  last_close: number;
  predicted_price: number;
  predicted_range: { low: number; high: number };
  reasoning: string[];
  outlook: { short_term: string; mid_term: string };
  disclaimer: string;
}

export interface NewsItem {
  title: string;
  link: string;
  press: string;
  date: string;
}

export interface StockSummary {
  code: string;
  name: string;
  date: string;
  close: number;
  change: number;
  change_pct: number;
  volume: number;
}

export interface Top100PredictionItem {
  rank: number;
  code: string;
  name: string;
  direction: "상승" | "하락" | "보합";
  confidence: "강" | "중" | "약";
  score: number;
  last_close: number;
  date: string;
}

export interface PredictionHistoryRecord {
  date: string;
  predicted_direction: "상승" | "하락" | "보합";
  confidence: "강" | "중" | "약" | null;
  actual_direction: "상승" | "하락" | "보합" | null;
  actual_change_pct: number | null;
  correct: boolean | null;
}

export interface MarketMapItem {
  code: string;
  name: string;
  sector: string;
  marcap: number;
  close: number;
  change: number;
  change_pct: number;
}

export interface BoardPost {
  nid: string;
  title: string;
  date: string;
  author: string;
  views: number;
  likes: number;
  dislikes: number;
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { detail?: string });
    throw new Error(body.detail || `요청 실패 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  search: (q: string) => getJSON<StockSearchResult[]>(`${BASE}/search?q=${encodeURIComponent(q)}`),
  summary: (code: string) => getJSON<StockSummary>(`${BASE}/stock/${code}/summary`),
  history: (code: string, years = 3) =>
    getJSON<{ code: string; name: string; points: OhlcvPoint[] }>(
      `${BASE}/stock/${code}/history?years=${years}`
    ),
  indicators: (code: string, years = 3) =>
    getJSON<{ code: string; name: string; points: IndicatorPoint[]; latest: IndicatorPoint }>(
      `${BASE}/stock/${code}/indicators?years=${years}`
    ),
  predict: (code: string) => getJSON<PredictionResult>(`${BASE}/stock/${code}/predict`),
  news: (code: string) =>
    getJSON<{ code: string; name: string; items: NewsItem[] }>(`${BASE}/stock/${code}/news`),
  top100Predictions: () =>
    getJSON<{ date: string; items: Top100PredictionItem[] }>(`${BASE}/predictions/top100`),
  predictionHistory: (code: string) =>
    getJSON<{ code: string; name: string; records: PredictionHistoryRecord[] }>(
      `${BASE}/predictions/history/${code}`
    ),
  marketMap: (limit = 500) =>
    getJSON<{ generated_at: string; count: number; items: MarketMapItem[] }>(
      `${BASE}/market/map?limit=${limit}`
    ),
  board: (code: string, page = 1) =>
    getJSON<{ code: string; name: string; page: number; items: BoardPost[] }>(
      `${BASE}/stock/${code}/board?page=${page}`
    ),
};
