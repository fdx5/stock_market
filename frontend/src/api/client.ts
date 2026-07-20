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

export interface CompanyOverview {
  code: string;
  name: string;
  overview: string[];
  per_estimate: string | null;
  shares_outstanding: number | null;
}

export interface MarketTickerItem {
  symbol: string;
  label: string;
  price: number;
  change: number;
  change_pct: number;
  points: number[];
  currency: string;
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

export interface BoardComment {
  id: string;
  author: string;
  text: string;
  written_at: string;
  likes: number;
  dislikes: number;
}

export interface OrderBookLevel {
  price: number;
  qty: number;
}

export interface OrderBook {
  code: string;
  delayed_minutes: number;
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  total_ask_qty: number;
  total_bid_qty: number;
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

export interface WeeklyForeignItem {
  code: string;
  name: string;
  amount: number;
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

export interface CompanyNewsItem {
  title: string;
  link: string;
  source: string;
  published: string;
  image_url: string | null;
  snippet: string | null;
}

export interface FightComment {
  id: number;
  company_code: string;
  username: string;
  text: string;
  created_at: string;
}

export interface UsStockQuote {
  code: string;
  name: string;
  close: number;
  change: number;
  change_pct: number;
}

export interface GlobalIndexPoint {
  date: string;
  close: number;
}

export interface GlobalIndexWidget {
  key: string;
  label: string;
  code: string;
  close: number | null;
  change: number | null;
  change_pct: number | null;
  points: GlobalIndexPoint[];
}

export interface GlobalEnrichment {
  logo_url: string;
  marcap_usd: number | null;
  marcap_krw: number | null;
  description: string | null;
}

export interface GlobalDiscussionPost {
  id: string;
  title: string;
  text: string;
  author: string;
  written_at: string;
  likes: number;
  dislikes: number;
  views: number;
  is_reply: boolean;
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
  overview: (code: string) => getJSON<CompanyOverview>(`${BASE}/stock/${code}/overview`),
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
  orderbook: (code: string) => getJSON<OrderBook>(`${BASE}/stock/${code}/orderbook`),
  marketMap: (limit = 500, fresh = false) =>
    getJSON<{ generated_at: string; count: number; items: MarketMapItem[] }>(
      `${BASE}/market/map?limit=${limit}&fresh=${fresh}`
    ),
  kosdaqMap: (limit = 200, fresh = false) =>
    getJSON<{ generated_at: string; count: number; items: MarketMapItem[] }>(
      `${BASE}/market/kosdaq-map?limit=${limit}&fresh=${fresh}`
    ),
  sp500Map: (limit = 503, fresh = false) =>
    getJSON<{ generated_at: string; count: number; items: MarketMapItem[] }>(
      `${BASE}/market/sp500-map?limit=${limit}&fresh=${fresh}`
    ),
  nasdaq100Map: (limit = 103, fresh = false) =>
    getJSON<{ generated_at: string; count: number; items: MarketMapItem[] }>(
      `${BASE}/market/nasdaq100-map?limit=${limit}&fresh=${fresh}`
    ),
  marketTicker: () => getJSON<{ items: MarketTickerItem[] }>(`${BASE}/market/ticker`),
  indexHistory: (symbol: "KOSPI" | "KOSDAQ", years = 3) =>
    getJSON<{ symbol: string; points: IndicatorPoint[]; latest: IndicatorPoint }>(
      `${BASE}/market/index/${symbol}/history?years=${years}`
    ),
  board: (code: string, page = 1, fresh = false) =>
    getJSON<{ code: string; name: string; page: number; items: BoardPost[] }>(
      `${BASE}/stock/${code}/board?page=${page}&fresh=${fresh}`
    ),
  boardDetail: (code: string, nid: string) => getJSON<BoardDetail>(`${BASE}/stock/${code}/board/${nid}`),
  boardComments: (code: string, nid: string) =>
    getJSON<{ nid: string; items: BoardComment[]; count: number }>(
      `${BASE}/stock/${code}/board/${nid}/comments`
    ),
  indices: (fresh = false) =>
    getJSON<{
      kospi: IndexQuote | null;
      kosdaq: IndexQuote | null;
      kospi_investor: MarketInvestorSummary | null;
      kosdaq_investor: MarketInvestorSummary | null;
    }>(`${BASE}/investor/indices?fresh=${fresh}`),
  investorSummary: () => getJSON<{ items: InvestorSummaryItem[] }>(`${BASE}/investor/summary`),
  weeklyForeignTop: () =>
    getJSON<{ buy: WeeklyForeignItem[]; sell: WeeklyForeignItem[] }>(`${BASE}/investor/weekly-foreign-top`),
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
  companyDetail: (path: string, lang: string = "ko") =>
    getJSON<{ description: string }>(
      `${BASE}/battle/global-top20/detail?path=${encodeURIComponent(path)}&lang=${lang}`
    ),
  translate: (texts: string[]) =>
    postJSON<{ translations: string[] }>(`${BASE}/translate`, { texts }),
  fightStatus: (codeA: string, codeB: string) =>
    getJSON<{ a: GlobalTop20Item; b: GlobalTop20Item }>(
      `${BASE}/fight/status?a=${encodeURIComponent(codeA)}&b=${encodeURIComponent(codeB)}`
    ),
  fightComments: (codeA: string, codeB: string) =>
    getJSON<{ items: FightComment[]; counts: Record<string, number> }>(
      `${BASE}/fight/comments?a=${encodeURIComponent(codeA)}&b=${encodeURIComponent(codeB)}`
    ),
  postFightComment: (companyCode: string, username: string, text: string) =>
    postJSON<FightComment>(`${BASE}/fight/comments`, { company_code: companyCode, username, text }),
  fightNews: (code: string, name: string, lang: string = "ko", limit: number = 6) =>
    getJSON<{ items: CompanyNewsItem[] }>(
      `${BASE}/fight/news?code=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}&lang=${lang}&limit=${limit}`
    ),
  fightArticle: (link: string, code: string, lang: string = "ko") =>
    getJSON<{ paragraphs: string[] | null }>(
      `${BASE}/fight/news/article?link=${encodeURIComponent(link)}&code=${encodeURIComponent(code)}&lang=${lang}`
    ),
  companyComments: (code: string, limit = 200) =>
    getJSON<{ items: FightComment[]; count: number }>(
      `${BASE}/fight/company-comments?code=${encodeURIComponent(code)}&limit=${limit}`
    ),
  usStockQuote: (code: string) => getJSON<UsStockQuote>(`${BASE}/us-stock/${code}/quote`),
  usStockIndicators: (code: string, years = 3) =>
    getJSON<{ code: string; name: string; points: IndicatorPoint[]; latest: IndicatorPoint }>(
      `${BASE}/us-stock/${code}/indicators?years=${years}`
    ),
  globalIndices: () => getJSON<{ items: GlobalIndexWidget[] }>(`${BASE}/global/indices`),
  globalEnrichment: (code: string, lang: string = "ko") =>
    getJSON<GlobalEnrichment>(`${BASE}/global/${code}/enrichment?lang=${lang}`),
  globalDiscussion: (code: string, limit = 20) =>
    getJSON<{ items: GlobalDiscussionPost[] }>(`${BASE}/global/${code}/discussion?limit=${limit}`),
};
