/* Pure floor data: markets, labels, formatters, the snapshot type and row selection.
 * No React and no network here, so the display painters can run in a worker. */
import type {
  FuturesItem, GlobalIndexWidget, GlobalTop20Item, HotIssueEdition, InvestorSummaryItem, KospiNightQuote,
  MarketMapItem, MarketTickerItem, TreasuryHeadline,
} from "../api/client";
import type { MarketIndices } from "../useMarketIndices";
import { stockIconUrl } from "../stockIcon";
import { usCompanyLogoProxyUrl } from "../usLogo";

export const MARKETS = {
  kospi: { label: "KOSPI", venue: "KRX", currency: "KRW", map: "/map", index: "/kospi", color: "#5fe3ff" },
  kosdaq: { label: "KOSDAQ", venue: "KRX", currency: "KRW", map: "/kosdaq-map", index: "/kosdaq", color: "#b99cff" },
  sp500: { label: "S&P 500", venue: "NYSE · NASDAQ", currency: "USD", map: "/sp500-map", index: "/ranking/sp500-market-cap", color: "#74e0bf" },
} as const;
export type ExchangeMarket = keyof typeof MARKETS;
export type Language = "ko" | "en";
export const OUTER_TICKER_STOCK_LIMIT = 120;

export const STORAGE_ASSETS = "/3d/exchange-floor";
export const STOCK_PANELS = 16;

/** Every data panel on the floor: [Korean, English, kind]. Kinds group panels in the monitor picker. */
export const PANEL_LABELS: Record<string, [string, string, "market" | "stocks" | "global" | "assets" | "desk"]> = {
  overview: ["빅 보드 · 기준 지수", "Big board · benchmark", "market"],
  treemap: ["시장 지도", "Market map", "market"],
  heatgrid: ["시가총액 상위 히트맵", "Top-cap heat grid", "market"],
  breadth: ["시장 폭 · 등락 비율", "Market breadth", "market"],
  histogram: ["등락률 분포", "Return distribution", "market"],
  sectors: ["업종 관제", "Sector desk", "market"],
  capshare: ["시가총액 비중", "Cap concentration", "market"],
  investor: ["투자자별 수급", "Investor flows", "market"],
  tri: ["3대 시장", "Three markets", "market"],
  session: ["거래 세션", "Trading sessions", "global"],
  clocks: ["세계 시각", "World clocks", "global"],
  leaders: ["시가총액 상위", "Market leaders", "stocks"],
  gainers: ["상승률 상위", "Top gainers", "stocks"],
  laggards: ["하락률 상위", "Top decliners", "stocks"],
  movers: ["거래대금 상위", "Turnover leaders", "stocks"],
  world: ["세계 증시", "World indices", "global"],
  globaltop: ["세계 시가총액 TOP", "Global market-cap leaders", "global"],
  semis: ["반도체 데스크", "Semiconductor desk", "global"],
  bigtech: ["빅테크 데스크", "Big tech desk", "global"],
  futures: ["지수 선물", "Index futures", "global"],
  rates: ["미국 국채 금리", "US Treasury yields", "global"],
  news: ["오늘의 핫이슈", "Today's hot issues", "desk"],
  brief: ["핵심 지표 · 일정", "Key numbers & agenda", "desk"],
  crypto: ["디지털 자산", "Digital assets", "assets"],
  fx: ["환율 데스크", "FX desk", "assets"],
  metals: ["귀금속 · 산업금속", "Metals", "assets"],
  energy: ["에너지", "Energy", "assets"],
  agri: ["농산물 · 축산", "Agriculture & livestock", "assets"],
};
export const ASSET_SINGLES: Record<string, { ko: string; en: string; unit: string; href: string; digits: number }> = {
  "KRW=X": { ko: "원/달러 환율", en: "USD / KRW", unit: "KRW", href: "/prices/usd-krw", digits: 2 },
  "GC=F": { ko: "금 선물", en: "Gold futures", unit: "USD/oz", href: "/prices/gold", digits: 1 },
  "CL=F": { ko: "WTI 원유", en: "WTI crude", unit: "USD/bbl", href: "/prices/wti", digits: 2 },
  "BTC-USD": { ko: "비트코인", en: "Bitcoin", unit: "USD", href: "/prices/bitcoin", digits: 0 },
  "NQ=F": { ko: "나스닥100 선물", en: "Nasdaq 100 futures", unit: "PT", href: "/global", digits: 1 },
  "ES=F": { ko: "S&P500 선물", en: "S&P 500 futures", unit: "PT", href: "/global", digits: 1 },
  "ETH-USD": { ko: "이더리움", en: "Ethereum", unit: "USD", href: "/prices/bitcoin", digits: 1 },
  "SI=F": { ko: "은 선물", en: "Silver futures", unit: "USD/oz", href: "/prices/silver", digits: 2 },
};
for (const [symbol, spec] of Object.entries(ASSET_SINGLES)) PANEL_LABELS["a:" + symbol] = [spec.ko, spec.en, "assets"];

const formatNumber = [new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }),
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }),
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 })];
export const displayValue = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value) ? "—" : (formatNumber[digits] ?? formatNumber[2]).format(value);
export const fixedValue = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const changeText = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? "—" : (value > 0 ? "+" : "") + value.toFixed(2) + "%";
export const changeTone = (value: number | null | undefined) => value && value > 0 ? "up" : value && value < 0 ? "down" : "flat";
export const isPrice = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
export const companyLogo = (market: ExchangeMarket, code: string) => market === "sp500" ? usCompanyLogoProxyUrl(code) : stockIconUrl(code);
export const marketCode = (value: string | null): ExchangeMarket => value === "kosdaq" || value === "sp500" ? value : "kospi";
export const stockIndex = (id: string) => /^s(1[0-5]|[0-9])$/.test(id) ? Number(id.slice(1)) : -1;
export const assetSymbol = (id: string) => id.startsWith("a:") ? id.slice(2) : "";
const formatTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
export const shortTime = (value: string | number | null | undefined) => {
  if (!value) return "—";
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? "—" : formatTime.format(date) + " KST";
};


export type FloorExtras = {
  world: GlobalIndexWidget[];
  futures: FuturesItem[];
  investor: InvestorSummaryItem[];
  rates: TreasuryHeadline[];
  kospiNight: KospiNightQuote | null;
  kospiFutures: KospiNightQuote | null;
  hot: HotIssueEdition | null;
  globalTop: GlobalTop20Item[];
};

export type FloorIndex = { close: number; change: number | null; time: string | number | null; status?: string; points: number[] };
export type SectorStat = { name: string; change: number; count: number; cap: number };
export type FloorSnapshot = {
  market: ExchangeMarket; rows: MarketMapItem[]; tickers: Record<string, MarketTickerItem>;
  outerTickerRows: MarketMapItem[];
  failed: boolean; received: string | null; index: FloorIndex | null;
  indices: Record<ExchangeMarket, FloorIndex | null>; investorTotals: MarketIndices["kospiInvestor"];
  capBasis: "market_cap" | "index_weight" | undefined; session: string | undefined;
  up: number; down: number; flat: number; sectors: SectorStat[]; extras: FloorExtras;
};

export function rowsForPanel(snapshot: FloorSnapshot, panel: string) {
  const number = stockIndex(panel);
  if (number >= 0) return snapshot.rows.slice(number, number + 1);
  if (panel === "movers") return [...snapshot.rows].sort((a, b) => (b.turnover ?? b.close * (b.volume ?? 0)) - (a.turnover ?? a.close * (a.volume ?? 0)));
  if (panel !== "gainers" && panel !== "laggards") return snapshot.rows;
  const direction = panel === "gainers" ? 1 : -1;
  return snapshot.rows.filter(row => Number.isFinite(row.change_pct) && row.change_pct * direction > 0)
    .sort((a, b) => (b.change_pct - a.change_pct) * direction);
}
