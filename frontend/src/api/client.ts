const BASE = "/api";

export interface StockSearchResult {
  code: string;
  name: string;
  market: string;
  asset_type?: "STOCK" | "ETF";
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
  /** Naver's search snippet. Only the US path fills it in — finance.naver's per-code
   * news tab (the KR source) publishes headlines without one. */
  summary?: string;
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
  /* The two KR maps carry these as well, and always have — they were simply
   * never declared, because the treemaps size by cap and colour by change and
   * needed none of them. The spotlight board is built out of them: turnover
   * (close × volume) is how it tells a real move from a thin one, and the rest
   * are what its commentary is written from.
   *
   * Optional because this same type backs the S&P 500 and NASDAQ 100 maps,
   * whose upstream is a different scraper. Anything reading them has to cope
   * with absence rather than assume a number. `per` and `roe` are null for a
   * few dozen names even on the KR side — a company with no earnings has no
   * ratio, which is a fact about the company and not a gap in the data. */
  volume?: number;
  /** Session-consistent accumulated trading value. On KR maps this is Naver's
   * reported value rather than the less accurate close × volume estimate. */
  turnover?: number;
  shares?: number;
  foreign_ratio?: number;
  per?: number | null;
  roe?: number | null;
  /** US maps only, and the field that has to be read instead of `marcap` there:
   * on a US constituent `marcap` is the index *weight* in per cent, not a
   * capitalisation, so the two names mean different quantities on the two sides.
   * This is the real one, in dollars. */
  market_cap?: number | null;
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

/** Just a stock's sector name — the cheap counterpart to SectorMap, which also
 * builds/filters the full ranked cohort. Used purely to decide whether a
 * sector-specific panel (e.g. the DRAM price panel for 반도체/전자) applies. */
export interface SectorName {
  code: string;
  market: "KOSPI" | "KOSDAQ";
  sector: string;
}

/** Just a US ticker's GICS sector name — the cheap counterpart to UsSectorMap, which
 * also builds/sorts the full S&P 500 cohort. `sector` is null when the ticker isn't
 * found in either cached constituent snapshot. */
export interface UsSectorName {
  code: string;
  sector: string | null;
}

/** One item's current print off TrendForce's DRAM spot-price table — `price` is the
 * table's own "Session Average", `change_pct` its signed day-over-day move. */
export interface DramPriceItem {
  item_name: string;
  price: number;
  daily_high: number | null;
  daily_low: number | null;
  change_pct: number | null;
}

/** The dashboard's DRAM price panel's data — whatever the daily batch last stored.
 * `price_date` is null before the very first batch run has ever completed. */
export interface DramPriceResponse {
  price_date: string | null;
  items: DramPriceItem[];
}

/** One commodity contract on the 선물가격 board.
 *
 * `unit` is what the price is quoted in ("¢/bu", "$/oz") and is not decoration: the
 * board puts corn at 460 next to cocoa at 5637 next to copper at 6.63, and without the
 * unit those read as one scale with outliers. `decimals` is chosen server-side from the
 * price's own magnitude for the same reason — see futures_fetcher._decimals. */
export interface FuturesItem {
  symbol: string;
  name: string;
  name_en: string;
  /** Key into CommodityIcon's glyph set, not a URL. */
  icon: string;
  unit: string;
  flag: string;
  market_name: string;
  updated_at: string;
  price: number;
  change: number;
  change_pct: number;
  decimals: number;
}

/** One point on one item's price history. */
export interface DramHistoryPoint {
  price_date: string;
  price: number;
  change_pct: number | null;
}

/** One item's whole recorded series, oldest first. */
export interface DramHistorySeries {
  item_name: string;
  points: DramHistoryPoint[];
}

/** Every item's series for the 이력 page's chart.
 *
 * `dates` is the union of every date any item has a print for — the chart's x-domain.
 * An item's `points` can be shorter than it (TrendForce adds and drops items over
 * time), which is why the series carry their own dates rather than being positional
 * against this list. */
export interface DramHistoryResponse {
  dates: string[];
  items: DramHistorySeries[];
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
  /** NASDAQ only: absolute market capitalization in USD. */
  market_cap?: number | null;
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

/* ────────────────────────── 종목정보 (/stocks) ──────────────────────────
   The page's left rail is one cap-ranked list rendered three times over, so its rows
   arrive already normalised: `marcap` is a real capitalisation in `currency` on every
   market, never the index weight the US snapshot calls by that name, and there is no
   per-market branch anywhere in the list. See services/stock_universe_page.py. */

export type StockUniverseMarket = "kospi" | "kosdaq" | "kr_etf" | "sp500" | "us_etf";
export type StockUniverseSort = "default" | "change_asc" | "change_desc";

export interface StockUniverseRow {
  rank: number;
  code: string;
  name: string;
  /** US only, and null until the translate cache warms — render `name` in that case. */
  name_ko: string | null;
  sector: string;
  close: number | null;
  change: number | null;
  change_pct: number | null;
  marcap: number | null;
  volume?: number | null;
  per?: number | null;
  roe?: number | null;
  /** This company's mark is dark ink throughout and would disappear on the dark theme,
   *  so it gets a light plate behind it (see services/logo_tone.py). Arrives false on
   *  the very first request for a row and true from the next refresh — the server
   *  measures logos behind the response rather than making the page wait on them. */
  logo_dark?: boolean;
  asset_type?: "STOCK" | "ETF";
}

export interface StockUniverseSector {
  sector: string;
  count: number;
  marcap: number;
}

export interface StockUniversePage {
  market: StockUniverseMarket;
  label: string;
  currency: "KRW" | "USD";
  /** The active 업종, or ALL_SECTORS. */
  sector: string;
  /** The active name search, echoed back so a stale response can be told apart from a
   *  current one — the same role `sector` and `page` play. */
  query: string;
  sort: StockUniverseSort;
  /** Every 업종 in the market, biggest first — computed from the *unfiltered* roster,
   *  so the dropdown holds the same options whichever one is chosen. */
  sectors: StockUniverseSector[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  generated_at: string;
  items: StockUniverseRow[];
}

/* ─────────────────────── 글로벌 시가총액 TOP 100 페이지 ─────────────────────── */

export interface GlobalTop100Returns {
  d1: number | null;
  w1: number | null;
  m1: number | null;
  m3: number | null;
  m6: number | null;
  y1: number | null;
  all: number | null;
}

export type AnalystRecommendation = "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";

export interface GlobalTop100Item {
  rank: number;
  /** Positive = climbed that many ranks since yesterday, negative = fell, null = no
   * prior-day snapshot yet for this symbol (first day after launch, or a new entrant
   * to the TOP 100 since yesterday) — render as nothing rather than a placeholder. */
  rank_change: number | null;
  symbol: string;
  name: string;
  country: string;
  flag_url: string | null;
  logo_url: string | null;
  detail_path: string | null;
  /** Current CEO's name + a freely-licensed real photo, sourced from Wikidata (see
   * backend/app/data/ceo_photo_fetcher.py) — null whenever that company or its CEO
   * isn't findable there, which the row falls back from gracefully. */
  ceo_name: string | null;
  ceo_photo_url: string | null;
  /** Null only if the live batch-quote overlay hasn't reached this symbol yet. */
  price: number | null;
  currency: string | null;
  market_cap_usd: number | null;
  change_pct: number | null;
  returns: Partial<GlobalTop100Returns>;
  spark_points: number[];
  spark_dates: string[];
  sector: string | null;
  industry: string | null;
  description_ko: string | null;
  description_en: string | null;
  trailing_eps: number | null;
  profit_margin: number | null;
  earnings_growth: number | null;
  trailing_pe: number | null;
  recommendation_key: AnalystRecommendation | null;
  recommendation_label: string | null;
  analyst_count: number | null;
}

export interface GlobalTop100Response {
  items: GlobalTop100Item[];
  /** When the slow layer (roster/fundamentals/returns) was last rebuilt — see
   * services/global_top100.py. Null before the very first refresh has completed. */
  updated_at: string | null;
  /** When the live price/market-cap overlay was last refreshed — a few seconds to
   * ~20s old under normal polling. */
  live_updated_at: string | null;
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

/** One stock's board, as served by the batched /stock/discussions endpoint the desk's
 * 오늘의 종목 토론 band reads. `posts` is empty for a stock whose board is quiet or
 * whose upstream fetch failed — the band draws that as "아직 글이 없습니다", not as an
 * error, because the two are indistinguishable from here and neither is worth an
 * error state. */
export interface StockDiscussionGroup {
  name: string;
  posts: BoardPost[];
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
  /** False when KRX isn't actively trading (nights, weekends, holidays) — Naver
   * serves the 호가 table with every row blank in that state rather than an error,
   * and this app reads that the same way rather than treating it as a fetch failure. */
  available: boolean;
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
   because what is available is a per-source question, and not even a per-stock one:
   the 공매도 figures come from KRX and 대차잔고 from SEIBro, so a SEIBro outage drops
   that one series and leaves the rest. 공매도잔고 and 신용융자잔고 have no free
   source at all (the backend balance_fetcher header records exactly what was tried),
   so they are typed but never sent. The modal renders whatever it is handed and
   nothing for what it isn't, so wiring one later is a backend-only change. */

export type BalanceSeriesKey =
  | "short_volume"
  | "short_weight"
  | "short_value"
  | "loan"
  | "uptick_applied"
  | "uptick_exempt"
  // Reserved: see the note above. No source, so never present in `series`.
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
  close: number;
  weekly_change_pct: number;
  foreign_buy_days: number;
  foreign_sell_days: number;
  institution_amount: number;
  individual_amount: number;
}

/** One code's trailing return off a year of daily bars — see
 * backend/app/services/market_map.get_returns_for_codes. Null when the series doesn't
 * reach back that far (a recent listing) or the fetch failed for that symbol. */
export interface MarketReturns {
  w1: number | null;
  d20: number | null;
  d60: number | null;
  d120: number | null;
  d240: number | null;
}

export interface MarketSparkline {
  points: number[];
  dates: string[];
  returns: MarketReturns;
}

export interface EtfItem {
  code: string;
  naver_code: string;
  name: string;
  benchmark: string;
  category: string;
  region: "KR" | "US";
  currency: string;
  close: number;
  change: number;
  change_pct: number;
  volume: number;
  turnover: number;
  average_volume: number | null;
  session: "regular" | "pre" | "post";
  returns: { d20: number | null; d60: number | null; d120: number | null; ytd: number | null };
  week52_high: number | null;
  week52_low: number | null;
  sparkline: number[];
}

export interface EtfMarketResponse {
  region: "KR" | "US";
  updated_at: string;
  items: EtfItem[];
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

/** One article in Toss's per-company news feed.
 *
 * Deliberately close to `NewsItem` — the news tab renders both through one list — but
 * addressed by `id` rather than by URL, because Toss serves the body itself and only
 * discloses the outlet's own link on the detail response. */
export interface TossNewsItem {
  id: string;
  title: string;
  press: string;
  press_logo: string;
  date: string;
  summary: string;
  image_url: string | null;
}

export interface TossNewsArticle {
  title: string;
  press: string;
  date: string;
  /** Toss's own digest of the article, three sentences or so. Shown above the body. */
  summary_sentences: string[];
  /** Null only when the article could not be read at all; Toss supplies the body as
   *  data, so unlike the Naver path this is not the common case. */
  paragraphs: string[] | null;
  link: string;
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

async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { detail?: string });
    throw new Error(body.detail || `요청 실패 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** Like getJSON but requires HTTP revalidation. For realtime reads (the live quote) that
 * must reflect the server's current value on every call — including an immediate re-entry
 * into a detail view (KOSPI map tile / search) where the browser could otherwise serve a
 * previously cached response and flash a stale price. */
async function getJSONFresh<T>(url: string): Promise<T> {
  // Revalidate live reads instead of discarding their previous bytes. The backend's
  // ETag makes an unchanged poll a header-only 304; changed data still arrives now.
  const res = await fetch(url, { cache: "no-cache" });
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
  etfs: (region: "KR" | "US") => getJSONFresh<EtfMarketResponse>(`${BASE}/etfs?region=${region}`),
  etfQuote: (code: string, region: "KR" | "US") =>
    getJSONFresh<EtfItem>(`${BASE}/etfs/${encodeURIComponent(code)}/quote?region=${region}`),
  etfDiscussions: () => getJSONFresh<{ items: Record<string, BoardPost[]> }>(`${BASE}/etfs/discussions?region=KR`),
  etfGlobalDiscussions: () => getJSONFresh<{ items: Record<string, GlobalDiscussionPost[]> }>(`${BASE}/etfs/discussions?region=US`),
  tossEtfDiscussion: (code: string, limit = 10, offset?: string | null) =>
    getJSONFresh<{ items: GlobalDiscussionPost[]; next_offset: string | null }>(
      `${BASE}/etfs/${encodeURIComponent(code)}/toss-discussion?limit=${limit}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`
    ),
  search: (q: string, signal?: AbortSignal, includeEtf = false) => getJSON<StockSearchResult[]>(`${BASE}/search?q=${encodeURIComponent(q)}${includeEtf ? "&include_etf=true" : ""}`, { signal }),
  /* `market` narrows the ranking to one side. The log is overwhelmingly KR, so a
     US-only strip taken from the combined top 20 is empty most days — the backend
     ranks a deeper pool and filters it, which is the only way the global page can
     show a US 실시간 인기 strip at all. Omitted keeps the combined ranking the KR
     surfaces have always shown. */
  popularSearches: (limit = 8, market?: "US" | "KR") =>
    getJSON<{ items: PopularStock[] }>(
      `${BASE}/search/popular?limit=${limit}${market ? `&market=${market}` : ""}`
    ),
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
  globalTop100: () => getJSONFresh<GlobalTop100Response>(`${BASE}/global-top100`),
  marketMap: (limit = 500, fresh = false) =>
    getJSONFresh<MarketMapResponse>(
      `${BASE}/market/map?limit=${limit}&fresh=${fresh}`
    ),
  kosdaqMap: (limit = 200, fresh = false) =>
    getJSONFresh<MarketMapResponse>(
      `${BASE}/market/kosdaq-map?limit=${limit}&fresh=${fresh}`
    ),
  /** 20일/120일 등락률 for just the given codes — call with the rows actually on
   * screen (a ranking table's 50 or 20 codes), not a whole screened universe. */
  marketReturns: (codes: string[], market: "kr" | "us" = "kr") =>
    getJSON<{ items: Record<string, MarketReturns> }>(
      `${BASE}/market/returns?codes=${codes.join(",")}&market=${market}`
    ),
  sp500Map: (limit = 503, fresh = false) =>
    getJSONFresh<MarketMapResponse>(
      `${BASE}/market/sp500-map?limit=${limit}&fresh=${fresh}`
    ),
  nasdaq100Map: (limit = 103, fresh = false) =>
    getJSONFresh<MarketMapResponse>(
      `${BASE}/market/nasdaq100-map?limit=${limit}&fresh=${fresh}`
    ),
  stockBoard: (market: "kospi" | "kosdaq" | "nasdaq", fresh = false) =>
    getJSON<StockBoard>(`${BASE}/market/board?market=${market}&fresh=${fresh}`),
  /** The same board without its sparkline history — for a page that already has one.
   * Pair with `mergeBoardRefresh`. */
  stockBoardRefresh: (market: "kospi" | "kosdaq" | "nasdaq") =>
    getJSON<StockBoardRefresh>(`${BASE}/market/board?market=${market}&slim=true`),
  /** One page of a market's cap ranking for the 종목정보 rail. Always re-fetched:
   *  the page polls it every 10s for live prices. */
  stockUniverse: (market: StockUniverseMarket, page = 1, size = 50, sector?: string, q?: string, sort: StockUniverseSort = "default") =>
    getJSONFresh<StockUniversePage>(
      `${BASE}/market/stock-list?market=${market}&page=${page}&size=${size}` +
        (sector ? `&sector=${encodeURIComponent(sector)}` : "") +
        (q ? `&q=${encodeURIComponent(q)}` : "") +
        (sort !== "default" ? `&sort=${sort}` : "")
    ),
  /** Korean-language coverage of a US company, from Naver's news search — the S&P 500
   *  counterpart to `news`, which reads finance.naver's per-code tab. */
  usNews: (code: string, limit = 15) =>
    getJSON<{ code: string; name: string; query: string; items: NewsItem[] }>(
      `${BASE}/us-stock/${encodeURIComponent(code)}/news?limit=${limit}`
    ),
  /** One news article's body, extracted server-side, for reading it inside the
   *  종목정보 panel. `paragraphs` is null when the outlet's page cannot be reduced to
   *  an article — a paywall or a script-built page — and the panel then offers the
   *  headline and an external link. */
  newsArticle: (link: string, signal?: AbortSignal) =>
    getJSON<{ paragraphs: string[] | null }>(
      `${BASE}/stock/news-article?link=${encodeURIComponent(link)}`,
      { signal },
    ),
  sectorMap: (code: string, limit = 40) =>
    getJSON<SectorMap & { generated_at: string }>(`${BASE}/market/sector-map?code=${code}&limit=${limit}`),
  sector: (code: string) => getJSON<SectorName>(`${BASE}/market/sector?code=${code}`),
  usSector: (code: string) => getJSON<UsSectorName>(`${BASE}/market/us-sector?code=${encodeURIComponent(code)}`),
  dramPrice: () => getJSON<DramPriceResponse>(`${BASE}/market/dram-price`),
  futures: () => getJSON<{ items: FuturesItem[] }>(`${BASE}/market/futures`),
  dramPriceHistory: (days = 400) =>
    getJSON<DramHistoryResponse>(`${BASE}/market/dram-price/history?days=${days}`),
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
  /** Several stocks' boards in one request — see the endpoint's docstring for why the
   *  desk band cannot do this one code at a time. */
  stockDiscussions: (codes: string[], limit = 5) =>
    getJSONFresh<{ items: Record<string, StockDiscussionGroup> }>(
      `${BASE}/stock/discussions?codes=${encodeURIComponent(codes.join(","))}&limit=${limit}`
    ),
  boardDetail: (code: string, nid: string, signal?: AbortSignal) => getJSON<BoardDetail>(`${BASE}/stock/${code}/board/${nid}`, { signal }),
  boardComments: (code: string, nid: string, signal?: AbortSignal) =>
    getJSON<{ nid: string; items: BoardComment[]; count: number }>(
      `${BASE}/stock/${code}/board/${nid}/comments`,
      { signal },
    ),
  marketSparklines: (codes: string[], market: "kr" | "us" = "kr") =>
    getJSON<{ items: Record<string, MarketSparkline> }>(
      `${BASE}/market/sparklines?codes=${codes.join(",")}&market=${market}`
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
  translateToKorean: (texts: string[]) =>
    postJSON<{ translations: string[] }>(`${BASE}/translate`, {
      texts,
      target_lang: "ko",
    }),
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
  usStockQuote: (code: string) => getJSONFresh<UsStockQuote>(`${BASE}/us-stock/${code}/quote`),
  usHistory: (code: string, years = 3) =>
    getJSON<{ code: string; name: string; points: OhlcvPoint[] }>(
      `${BASE}/us-stock/${encodeURIComponent(code)}/history?years=${years}`
    ),
  usStockIndicators: (code: string, years = 3) =>
    getJSON<{ code: string; name: string; points: IndicatorPoint[]; latest: IndicatorPoint }>(
      `${BASE}/us-stock/${code}/indicators?years=${years}`
    ),
  usDailyPrices: (code: string, offset = 0, limit = 20) =>
    getJSON<DailyPricePage>(`${BASE}/us-stock/${code}/daily?offset=${offset}&limit=${limit}`),
  globalIndices: () => getJSON<{ items: GlobalIndexWidget[] }>(`${BASE}/global/indices`),
  globalEnrichment: (code: string, lang: string = "ko") =>
    getJSON<GlobalEnrichment>(`${BASE}/global/${code}/enrichment?lang=${lang}`),
  globalDiscussion: (code: string, limit = 10, offset?: string | null, discussionType: "foreignStock" | "foreignEtf" = "foreignStock") =>
    getJSON<{ items: GlobalDiscussionPost[]; next_offset: string | null }>(
      `${BASE}/global/${code}/discussion?limit=${limit}&discussion_type=${discussionType}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`
    ),
  /** A US listing's 종목토론 from Toss's board. Same response shape as
   *  `globalDiscussion`, which is what lets the backend fall back to Naver's 해외종목
   *  토론방 for a ticker Toss does not list without the caller noticing. */
  tossDiscussion: (code: string, limit = 10, offset?: string | null) =>
    getJSON<{ items: GlobalDiscussionPost[]; next_offset: string | null }>(
      `${BASE}/global/${encodeURIComponent(code)}/toss-discussion?limit=${limit}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`
    ),
  /** Korean-language news for a US listing, from Toss. Paged at the source, so `page`
   *  really does advance — unlike the Naver-search path, which answers one block. */
  tossNews: (code: string, limit = 12, page = 1) =>
    getJSON<{ items: TossNewsItem[]; has_next: boolean }>(
      `${BASE}/global/${encodeURIComponent(code)}/toss-news?limit=${limit}&page=${page}`
    ),
  tossNewsArticle: (id: string, signal?: AbortSignal) =>
    getJSON<TossNewsArticle>(
      `${BASE}/global/toss-news-article?id=${encodeURIComponent(id)}`,
      { signal },
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
