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

export interface StockQuote {
  code: string;
  name: string;
  close: number;
  change: number;
  change_pct: number;
  marcap: number;
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

export interface BoardBlock {
  type: "text" | "image";
  text?: string;
  src?: string;
}

export interface BoardDetail {
  nid: string;
  title: string;
  author: string;
  written_at: string;
  blocks: BoardBlock[];
}

export interface IndexQuote {
  symbol: string;
  name: string;
  close: number;
  change: number;
  change_pct: number;
  market_status: string;
  updated_at: string;
}

export interface MarketInvestorSummary {
  individual_amount: number;
  foreign_amount: number;
  institution_amount: number;
}

export interface InvestorSummaryItem {
  code: string;
  name: string;
  date: string;
  individual_amount: number;
  institution_amount: number;
  foreign_amount: number;
}

export interface InvestorTrendRecord {
  date: string;
  close: number;
  change: number;
  individual_amount: number;
  institution_amount: number;
  foreign_amount: number;
}

export interface BattleSide {
  code: string;
  name: string;
  close: number;
  change: number;
  change_pct: number;
  marcap: number;
}

export interface ExchangeRate {
  rate: number;
  change: number;
  change_pct: number;
}

export type CheerSide = "samsung" | "skhynix";

export interface CheerComment {
  id: number;
  side: CheerSide;
  username: string;
  text: string;
  created_at: string;
}

export interface GlobalTop20Item {
  rank: number;
  name: string;
  code: string;
  logo_url: string | null;
  marcap_usd: number;
  change_pct: number | null;
  flag_url: string | null;
  country: string;
  detail_path: string | null;
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { detail?: string });
    throw new Error(body.detail || `요청 실패 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

async function postJSON<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { detail?: string });
    throw new Error(body.detail || `요청 실패 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  search: (q: string) => getJSON<StockSearchResult[]>(`${BASE}/search?q=${encodeURIComponent(q)}`),
  summary: (code: string) => getJSON<StockSummary>(`${BASE}/stock/${code}/summary`),
  quote: (code: string) => getJSON<StockQuote>(`${BASE}/stock/${code}/quote`),
  history: (code: string, years = 3) =>
    getJSON<{ code: string; name: string; points: OhlcvPoint[] }>(
      `${BASE}/stock/${code}/history?years=${years}`
    ),
  indicators: (code: string, years = 3) =>
    getJSON<{ code: string; name: string; points: IndicatorPoint[]; latest: IndicatorPoint }>(
      `${BASE}/stock/${code}/indicators?years=${years}`
    ),
  news: (code: string) =>
    getJSON<{ code: string; name: string; items: NewsItem[] }>(`${BASE}/stock/${code}/news`),
  marketMap: (limit = 500) =>
    getJSON<{ generated_at: string; count: number; items: MarketMapItem[] }>(
      `${BASE}/market/map?limit=${limit}`
    ),
  kosdaqMap: (limit = 200) =>
    getJSON<{ generated_at: string; count: number; items: MarketMapItem[] }>(
      `${BASE}/market/kosdaq-map?limit=${limit}`
    ),
  board: (code: string, page = 1) =>
    getJSON<{ code: string; name: string; page: number; items: BoardPost[] }>(
      `${BASE}/stock/${code}/board?page=${page}`
    ),
  boardDetail: (code: string, nid: string) => getJSON<BoardDetail>(`${BASE}/stock/${code}/board/${nid}`),
  indices: () =>
    getJSON<{
      kospi: IndexQuote | null;
      kosdaq: IndexQuote | null;
      kospi_investor: MarketInvestorSummary | null;
      kosdaq_investor: MarketInvestorSummary | null;
    }>(`${BASE}/investor/indices`),
  investorSummary: () => getJSON<{ items: InvestorSummaryItem[] }>(`${BASE}/investor/summary`),
  investorTrend: (code: string, days = 20) =>
    getJSON<{ code: string; name: string; records: InvestorTrendRecord[] }>(
      `${BASE}/investor/${code}?days=${days}`
    ),
  battle: () => getJSON<{ samsung: BattleSide; skhynix: BattleSide }>(`${BASE}/battle/status`),
  exchangeRate: () => getJSON<ExchangeRate>(`${BASE}/battle/exchange`),
  cheerComments: () =>
    getJSON<{ items: CheerComment[]; counts: { samsung: number; skhynix: number } }>(`${BASE}/battle/comments`),
  postCheerComment: (side: CheerSide, username: string, text: string) =>
    postJSON<CheerComment>(`${BASE}/battle/comments`, { side, username, text }),
  globalTop20: () => getJSON<{ items: GlobalTop20Item[] }>(`${BASE}/battle/global-top20`),
  companyDetail: (path: string) =>
    getJSON<{ description: string }>(`${BASE}/battle/global-top20/detail?path=${encodeURIComponent(path)}`),
};
