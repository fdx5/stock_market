const BASE = "/api";

export interface StockSearchResult {
  code: string;
  name: string;
  market: string;
}

export interface PopularStock {
  code: string;
  name: string;
  market: string;
  count: number;
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

/** Which US trading session a quote came from. Anything without a pre/post session
 * of its own — FX, futures, crypto, indices — is always "regular". */
export type MarketSession = "pre" | "regular" | "post";

export interface MarketTickerItem {
  symbol: string;
  label: string;
  price: number;
  change: number;
  change_pct: number;
  points: number[];
  currency: string;
  session: MarketSession;
}

/** The extended-hours half of a US quote, shared by map tiles, board cards and the
 * /global detail header so all three describe an after-hours price the same way.
 *
 * When `session` is "pre" or "post", `close` is that session's print and `change_pct`
 * is measured from the *previous regular close* — i.e. it already contains the day's
 * regular move plus the extended one, which is what a reader wants after the bell.
 * `regular_change_pct` and `extended_change_pct` split that back into its two legs.
 *
 * All optional: the KR maps and boards never send them (NXT's after-hours trading is
 * folded straight into the price, with no separate session to name). */
export interface ExtendedHours {
  session?: MarketSession;
  /** The regular session's own last print. */
  regular_close?: number | null;
  /** The regular session's move. Null in pre-market — that session hasn't run yet,
   * which is a different statement from 0.00%. */
  regular_change_pct?: number | null;
  /** The extended leg alone, versus `regular_close`. Null during regular hours. */
  extended_change_pct?: number | null;
}

export interface MarketMapItem extends ExtendedHours {
  code: string;
  name: string;
  sector: string;
  marcap: number;
  close: number;
  change: number;
  change_pct: number;
}

export interface MarketMapResponse {
  generated_at: string;
  count: number;
  items: MarketMapItem[];
  /** Which US session the whole snapshot is quoting from — the page badges its header
   * with it. Absent on the two KR maps. */
  session?: MarketSession;
}

export interface SectorMap {
  code: string;
  market: "KOSPI" | "KOSDAQ";
  sector: string;
  /** Market-cap-weighted change across `items`, matching how the full map's sector
   * zone headers compute theirs. */
  avg_change_pct: number;
  count: number;
  items: MarketMapItem[];
}

/** The /global page's counterpart to SectorMap: the S&P 500 cohort sharing one US
 * ticker's GICS sector. `marcap` on each item is the constituent's index weight (%),
 * not an absolute market cap — see MarketMapPage's note on the same field. */
export interface UsSectorMap {
  code: string;
  index: "S&P500";
  /** null when the ticker is in neither index snapshot, which also means no `items`. */
  sector: string | null;
  /** Which US session the cohort's prices came from. */
  session?: MarketSession;
  /** Weight-weighted change across `items`, matching how the S&P500 map's own sector
   * zone headers compute theirs. */
  avg_change_pct: number;
  count: number;
  items: MarketMapItem[];
}

/** Trailing returns off the same daily series the sparkline is drawn from. Any of
 * them is null when the window doesn't reach that far back — a stock listed three
 * weeks ago has no 3-month return, and `ytd` is null until the series crosses a New
 * Year. Null renders as "—", never as 0%. */
export interface BoardReturns {
  w1: number | null;
  m1: number | null;
  m3: number | null;
  ytd: number | null;
}

/** One card on a /kospi-100 · /kosdaq-100 · /nasdaq-100 board. */
export interface StockBoardItem extends ExtendedHours {
  rank: number;
  code: string;
  name: string;
  /** NASDAQ only: the Korean rendering of `name`, or null while the translate cache
   * is still warming (the card then shows the English name). */
  name_ko?: string | null;
  sector: string;
  close: number;
  change: number;
  change_pct: number;
  /** Won for the KR boards; index weight (%) for NASDAQ — see `marcap_kind`. */
  marcap: number;
  /** KR boards only — these ride along on the market-cap page scrape. Null when the
   * figure genuinely doesn't exist (a loss-making company has no PER). */
  volume?: number | null;
  per?: number | null;
  roe?: number | null;
  foreign_ratio?: number | null;
  /** ~3 months of closes, oldest first, with the last point pinned to `close`. */
  points: number[];
  week52_high: number | null;
  week52_low: number | null;
  /** Where `close` sits in the 52-week range, 0 (low) to 1 (high). Null when the
   * range is unusable. */
  week52_pos: number | null;
  returns: Partial<BoardReturns>;
}

export interface StockBoardSector {
  sector: string;
  count: number;
  marcap: number;
  /** Cap-weighted, matching how the market map's sector zones compute theirs. */
  avg_change_pct: number;
  up: number;
  flat: number;
  down: number;
}

export interface StockBoard {
  market: "kospi" | "kosdaq" | "nasdaq";
  label: string;
  currency: "KRW" | "USD";
  /** What `marcap` on each item means — an absolute won figure, or an index weight. */
  marcap_kind: "krw" | "weight";
  /** Which US session the whole board is quoting from — NASDAQ only; the KR boards
   * always report "regular". The page header badges it once instead of every card
   * repeating it. */
  session: MarketSession;
  generated_at: string;
  /** The sparkline window's session dates (YYYYMMDD), sent once for the whole board
   * instead of repeated on every card. Align to an item's `points` from the END. */
  spark_dates: string[];
  count: number;
  breadth: { up: number; flat: number; down: number; avg_change_pct: number };
  /** Ordered by combined size — the order the page stacks its groups in. */
  sectors: StockBoardSector[];
  items: StockBoardItem[];
}

/* ────────────────────── the board's 10s refresh payload ──────────────────────
   A board is mostly sparkline history — 100 names × 60 daily closes — and none of
   that moves during a session except each series' last point, which is that item's
   own `close`. So a page that already has the board refreshes with `slim=true`,
   which sends everything that does change and leaves the bars out, and splices the
   new closes onto the series it is already holding.

   Worth the two extra types: at a 10s cadence the alternative is re-sending a year
   of bars six times a minute per viewer, and this app pays for its outbound. */

export type StockBoardRefreshItem = Omit<StockBoardItem, "points">;

export interface StockBoardRefresh extends Omit<StockBoard, "items" | "spark_dates"> {
  items: StockBoardRefreshItem[];
}

/** Folds a slim refresh onto the board already in hand.
 *
 * Returns null when the refresh names a stock we hold no history for — i.e. the
 * roster gained a name since the last full load. The caller re-fetches the whole
 * board instead; that costs one extra request on an event that happens about as
 * often as the top 100 actually changes, and the alternative is a card drawn with
 * an empty chart. */
export function mergeBoardRefresh(prev: StockBoard, next: StockBoardRefresh): StockBoard | null {
  // A board fetched while the backend's sparkline cache was cold carries no bars at all
  // — that cache is per-market, so it misses all-or-nothing, and the window is real: for
  // ~40s after a deploy the live board serves 100 empty series. Splicing prices onto
  // nothing would leave every chart blank until the reader reloaded, so hand it back to
  // be fetched whole, which is the only thing that carries bars. Costs nothing extra
  // exactly when it fires: with no history to send, a full response IS a slim one.
  //
  // Deliberately "no item has bars", not "some item lacks them" — a name whose own
  // series is missing is a different and ordinary thing (KOSPI usually has one), and
  // treating that as cold would mean a full fetch every 10s forever.
  if (!prev.items.some((it) => it.points.length > 0)) return null;

  const history = new Map(prev.items.map((it) => [it.code, it.points]));
  const items: StockBoardItem[] = [];
  for (const item of next.items) {
    const points = history.get(item.code);
    if (!points) return null;
    // The backend pins a series' final point to the live close (see `_apply_spark`);
    // do the same here so the line still ends at the number printed above it.
    const pinned = points.length > 0 ? [...points.slice(0, -1), item.close] : points;
    items.push({ ...item, points: pinned });
  }
  // The session dates belong to the points, which are the ones we kept.
  return { ...next, spark_dates: prev.spark_dates, items };
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

/* ───────────────────── 공매도 수급, by session ─────────────────────
   One stock's published 공매도 figures, newest session first. Each arrives with its
   own move against the previous *row* — the previous session the source actually
   published, which over a weekend is not "yesterday" — computed on the backend so
   the two views of it never drift apart.

   `series` names what this stock actually has, in display order, and `units` says
   what each one counts. Both are the backend's answer rather than a constant here,
   because what is available is a per-source question: the three 잔고 series below
   have no free source at all (KRX blanks 잔고 on the anonymous embed and walls the
   rest — the backend balance_fetcher header records exactly what was tried), so
   they are typed but never sent today. The modal renders whatever it is handed and
   nothing for what it isn't, so wiring one later is a backend-only change. */

export type BalanceSeriesKey =
  | "short_volume"
  | "short_weight"
  | "short_value"
  | "uptick_applied"
  | "uptick_exempt"
  // Reserved: see the note above. No source, so never present in `series` today.
  | "loan"
  | "short_balance"
  | "credit";

/** How the value column formats: "주"/"원" as grouped integers, "%" to two decimals. */
export type BalanceUnit = "주" | "원" | "%";

export interface BalanceFigure {
  /** Null when the session published no figure — rendered as "—", never as 0. */
  value: number | null;
  /** Move against the previous published session, in the series' own unit — so
   * percentage points for a "%" series. Null on the oldest row, and whenever either
   * side of the subtraction is missing. */
  change: number | null;
  /** Null when `change` is; when the previous figure was 0, since a rate off a zero
   * base is undefined rather than infinite; and always for a "%" series, where a
   * rate of change of a rate is not a number anyone reads. */
  change_pct: number | null;
}

export type BalanceRow = { date: string } & Partial<Record<BalanceSeriesKey, BalanceFigure>>;

export interface BalanceHistory {
  code: string;
  series: BalanceSeriesKey[];
  units: Partial<Record<BalanceSeriesKey, BalanceUnit>>;
  count: number;
  items: BalanceRow[];
}

export interface DailyPricePoint {
  date: string;
  close: number;
  change: number;
  change_pct: number;
  volume: number;
  /** 거래대금, derived from volume x typical price — see the backend's daily_prices
   * service for why no free feed carries the exchange's own figure. */
  value: number;
  open: number;
  high: number;
  low: number;
}

export interface DailyPricePage {
  code: string;
  name: string;
  items: DailyPricePoint[];
  has_more: boolean;
  total: number;
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

export interface UsStockQuote extends ExtendedHours {
  code: string;
  name: string;
  close: number;
  change: number;
  change_pct: number;
  session: MarketSession;
}

export interface GlobalIndexPoint {
  date: string;
  close: number;
}

export interface GlobalIndexWidget {
  key: string;
  label: string;
  code: string;
  unit: "index" | "usd";
  close: number | null;
  change: number | null;
  change_pct: number | null;
  points: GlobalIndexPoint[];
  /** Country code resolved to /img/flag/<flag>.svg, shown ahead of the label. */
  flag?: string;
  /** Which rolling flip-tile this index belongs to: the US majors or the overseas
   * markets. The live KOSPI 200 futures print joins "us" while its session is open. */
  group?: "us" | "overseas";
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

export type PredictionDirection = "상승" | "하락" | "보합";

/** One input the call was actually computed from. Categories with no data are absent
 * from the list rather than present-and-empty — see prediction_quality.build_evidence. */
export interface PredictionEvidence {
  category: "주가" | "거래량" | "수급" | "업종지수" | "환율" | "뉴스" | "호가";
  label: string;
  value: string;
  impact: "positive" | "negative" | "neutral";
}

/** `rate` is null when the window holds no graded predictions at all — which is a
 * different fact from a 0% hit rate and has to render differently. */
export interface AccuracyWindow {
  total: number;
  hit: number;
  rate: number | null;
}

export interface AccuracyWindows {
  recent20: AccuracyWindow;
  recent60: AccuracyWindow;
  all: AccuracyWindow;
}

export interface SessionScore {
  predict_date: string;
  total: number;
  hit: number;
  rate: number | null;
}

/** One stock's next-session call, as written by the batch (see prediction_store).
 *
 * Fields fall into three groups: the call itself (result/predict_price/change_rate),
 * the call's account of itself (probabilities, reliability, close explanation,
 * evidence), and what actually happened (the actual_ fields and `hit`) — the last of
 * which stays null until the predicted session has traded and been graded. */
export interface PredictionItem {
  /** 수집일자 — the session the prediction was computed from. */
  collect_date: string;
  /** 예측일자 — the session being predicted. */
  predict_date: string;
  code: string;
  name: string;
  market: string;
  result: PredictionDirection;
  base_price: number;
  predict_price: number;
  change_rate: number;
  /** Combined 40% technical + 60% qualitative score, -1..1. Drives the conviction bar. */
  score: number;
  confidence: "강" | "중" | "약";
  detail: string;

  /** Whole percentages summing to exactly 100. Null on rows written before the
   * probability model shipped. */
  prob_up: number | null;
  prob_flat: number | null;
  prob_down: number | null;
  /** The ±% band this row counts as 보합, and the band its grade was judged against. */
  flat_band: number | null;

  /** 0-100 with its grade and the specific reasons it isn't 100. Distinct from
   * `confidence`: that is how hard the inputs lean, this is what they're worth. */
  reliability: number | null;
  reliability_grade: "높음" | "보통" | "낮음" | null;
  reliability_notes: string[];

  /** The 수집일자 session's own move, and why it closed there. */
  close_change_rate: number | null;
  close_summary: string | null;
  evidence: PredictionEvidence[];

  /** 시가총액 as of the 수집일자, snapshotted on the row. KRX rows carry won; NASDAQ
   * rows carry index weight, a cap-share proxy — comparable within a market but not
   * across them, which is fine because the page only ever sorts inside one group. */
  market_cap: number | null;

  /** Null until the predicted session has closed and been graded. */
  actual_price: number | null;
  actual_change_rate: number | null;
  actual_result: PredictionDirection | null;
  hit: boolean | null;
  graded_at: string | null;

  /** Attached by the API for every code on the page, so a card can show its track
   * record without a request per card. */
  accuracy?: AccuracyWindows | null;

  created_at: string;
  updated_at: string;
}

export interface PredictionSummary {
  up: number;
  down: number;
  flat: number;
  avg_change_rate: number;
  strong: number;
  avg_reliability: number | null;
  low_reliability: number;
  /** How many of this group's rows have been graded, and how many of those were right.
   * Both zero on a day whose session hasn't traded yet. */
  graded: number;
  hit: number;
}

export interface PredictionGroup {
  market: string;
  label: string;
  items: PredictionItem[];
  summary: PredictionSummary;
}

export interface PredictionDateOption {
  date: string;
  iso: string;
  weekday: string;
  label: string;
  /** Markets with rows on this 예측일자. The KR and US batches usually target
   * different days, so this is how the page finds where a missing market went.
   * Absent on `previous_session`, which is a scoreboard entry rather than a
   * navigator option. */
  markets?: string[];
}

export interface PredictionDay extends PredictionDateOption {
  groups: PredictionGroup[];
  count: number;
  generated_at: string | null;
  collect_dates: string[];
  /** Recent graded sessions, newest first — the header's 적중 이력 strip. */
  scoreboard: SessionScore[];
  /** The most recent graded session older than the one on screen. Today's own
   * predictions are ungraded by definition, so this is the last checkable result. */
  previous_session: (SessionScore & PredictionDateOption) | null;
}

export interface PredictionAccuracy {
  markets: Record<string, AccuracyWindows>;
  sessions: SessionScore[];
  /** `sessions`, split per market — KOSPI/KOSDAQ/NASDAQ grade on independent
   * calendars, so a pooled tally hides which one a stretch actually belongs to. */
  sessions_by_market: Record<string, SessionScore[]>;
  windows: { short: number; long: number };
}

/** One stock x 예측일자 cell in the 채점결과 매트릭스. Absent (rather than present with
 * nulls) when that stock had no prediction on that date at all — a roster only
 * partially overlaps across sessions as market-cap rank shifts. */
export interface GradingMatrixCell {
  result: PredictionDirection;
  predict_price: number;
  change_rate: number;
  confidence: "강" | "중" | "약";
  /** Null until the session has traded and been graded — a real "not yet known"
   * state, distinct from a miss. */
  actual_result: PredictionDirection | null;
  actual_price: number | null;
  actual_change_rate: number | null;
  hit: boolean | null;
}

export interface GradingMatrixRow {
  code: string;
  name: string;
  market: string;
  cells: Record<string, GradingMatrixCell>;
}

export interface GradingMatrixResponse {
  dates: PredictionDateOption[];
  rows: GradingMatrixRow[];
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { detail?: string });
    throw new Error(body.detail || `요청 실패 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** Like getJSON but bypasses the HTTP cache. For realtime reads (the live quote) that
 * must reflect the server's current value on every call — including an immediate re-entry
 * into a detail view (KOSPI map tile / search) where the browser could otherwise serve a
 * previously cached response and flash a stale price. */
async function getJSONFresh<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
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
  popularSearches: (limit = 8) => getJSON<{ items: PopularStock[] }>(`${BASE}/search/popular?limit=${limit}`),
  summary: (code: string) => getJSON<StockSummary>(`${BASE}/stock/${code}/summary`),
  quote: (code: string) => getJSONFresh<StockQuote>(`${BASE}/stock/${code}/quote`),
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
  balanceHistory: (code: string) => getJSON<BalanceHistory>(`${BASE}/stock/${code}/balance`),
  dailyPrices: (code: string, offset = 0, limit = 20) =>
    getJSON<DailyPricePage>(`${BASE}/stock/${code}/daily?offset=${offset}&limit=${limit}`),
  marketMap: (limit = 500, fresh = false) =>
    getJSON<MarketMapResponse>(
      `${BASE}/market/map?limit=${limit}&fresh=${fresh}`
    ),
  kosdaqMap: (limit = 200, fresh = false) =>
    getJSON<MarketMapResponse>(
      `${BASE}/market/kosdaq-map?limit=${limit}&fresh=${fresh}`
    ),
  sp500Map: (limit = 503, fresh = false) =>
    getJSON<MarketMapResponse>(
      `${BASE}/market/sp500-map?limit=${limit}&fresh=${fresh}`
    ),
  nasdaq100Map: (limit = 103, fresh = false) =>
    getJSON<MarketMapResponse>(
      `${BASE}/market/nasdaq100-map?limit=${limit}&fresh=${fresh}`
    ),
  stockBoard: (market: "kospi" | "kosdaq" | "nasdaq", fresh = false) =>
    getJSON<StockBoard>(`${BASE}/market/board?market=${market}&fresh=${fresh}`),
  /** The same board without its sparkline history — for a page that already has one.
   * Pair with `mergeBoardRefresh`. */
  stockBoardRefresh: (market: "kospi" | "kosdaq" | "nasdaq") =>
    getJSON<StockBoardRefresh>(`${BASE}/market/board?market=${market}&slim=true`),
  sectorMap: (code: string, limit = 40) =>
    getJSON<SectorMap & { generated_at: string }>(`${BASE}/market/sector-map?code=${code}&limit=${limit}`),
  usSectorMap: (code: string, limit = 40) =>
    getJSON<UsSectorMap & { generated_at: string }>(
      `${BASE}/market/us-sector-map?code=${encodeURIComponent(code)}&limit=${limit}`
    ),
  marketTicker: () => getJSON<{ items: MarketTickerItem[] }>(`${BASE}/market/ticker`),
  seoulWeather: () =>
    getJSON<{ temperature: number; code: number; is_day: boolean }>(`${BASE}/market/weather`),
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
  usDailyPrices: (code: string, offset = 0, limit = 20) =>
    getJSON<DailyPricePage>(`${BASE}/us-stock/${code}/daily?offset=${offset}&limit=${limit}`),
  globalIndices: () => getJSON<{ items: GlobalIndexWidget[] }>(`${BASE}/global/indices`),
  globalEnrichment: (code: string, lang: string = "ko") =>
    getJSON<GlobalEnrichment>(`${BASE}/global/${code}/enrichment?lang=${lang}`),
  globalDiscussion: (code: string, limit = 10, offset?: string | null) =>
    getJSON<{ items: GlobalDiscussionPost[]; next_offset: string | null }>(
      `${BASE}/global/${code}/discussion?limit=${limit}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`
    ),
  predictionDates: (limit = 30) =>
    getJSON<{ items: PredictionDateOption[] }>(`${BASE}/prediction/dates?limit=${limit}`),
  // `date` is the 예측일자 (the session being predicted), which is what the page's
  // date navigator moves through — a reader picks which day's forecast to look at,
  // not which day it was computed on.
  predictions: (date?: string | null, market?: string | null) => {
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    if (market) params.set("market", market);
    const query = params.toString();
    return getJSON<PredictionDay>(`${BASE}/prediction${query ? `?${query}` : ""}`);
  },
  predictionHistory: (code: string, limit = 20) =>
    getJSON<{
      code: string;
      name: string;
      items: PredictionItem[];
      accuracy: AccuracyWindows | null;
    }>(`${BASE}/prediction/stock/${encodeURIComponent(code)}?limit=${limit}`),
  predictionAccuracy: () => getJSON<PredictionAccuracy>(`${BASE}/prediction/accuracy`),
  predictionGradingMatrix: (market?: string | null, limit = 20) => {
    const params = new URLSearchParams();
    if (market) params.set("market", market);
    params.set("limit", String(limit));
    return getJSON<GradingMatrixResponse>(`${BASE}/prediction/grading-matrix?${params.toString()}`);
  },
};
