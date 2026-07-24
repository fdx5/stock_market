import { AccuracyWindow, PredictionEvidence, PredictionItem } from "./api/client";

export type PredictionResult = PredictionItem["result"];

/** Diverging pair for the verdict, reusing the palette the rest of the app already
 * uses for price direction: warm (red) up, cool (blue) down, neutral gray at the
 * midpoint. Korean market convention puts red on the up side — the inverse of the US
 * convention — and every other surface here already follows it, so the prediction page
 * must too or a reader would parse the colors backwards. */
export const RESULT_COLOR: Record<PredictionResult, string> = {
  상승: "var(--up-color)",
  하락: "var(--down-color)",
  보합: "var(--status-neutral)",
};

export const RESULT_ARROW: Record<PredictionResult, string> = {
  상승: "▲",
  하락: "▼",
  보합: "―",
};

export const RESULT_CLASS: Record<PredictionResult, string> = {
  상승: "up",
  하락: "down",
  보합: "flat",
};

/** Market open, in each exchange's own local wall-clock time. */
const MARKET_OPEN: Record<string, { zone: string; hour: number; minute: number; label: string }> = {
  KOSPI: { zone: "Asia/Seoul", hour: 9, minute: 0, label: "한국 증시" },
  KOSDAQ: { zone: "Asia/Seoul", hour: 9, minute: 0, label: "한국 증시" },
  NASDAQ: { zone: "America/New_York", hour: 9, minute: 30, label: "미국 증시" },
};

/** Milliseconds `timeZone` is ahead of UTC at `date`.
 *
 * Formatting the instant *in* the zone and re-reading those wall-clock fields as if
 * they were UTC is the standard way to recover an offset without shipping a timezone
 * library — and it has to be computed rather than hardcoded because New York's offset
 * changes with US daylight saving. */
function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Intl renders midnight as hour 24 in some engines; % 24 normalizes it.
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - date.getTime();
}

/** The instant a market opens on `isoDate` (YYYY-MM-DD), as a real Date.
 *
 * Two passes: guess the instant by reading the wall time as UTC, measure the zone's
 * offset at that guess, then correct. One pass would be wrong for any zone that isn't
 * UTC; the correction is what makes 09:30 mean 09:30 *in New York* rather than in the
 * visitor's own timezone. */
export function marketOpenInstant(isoDate: string, market: string): Date | null {
  const spec = MARKET_OPEN[market];
  if (!spec || !isoDate) return null;
  const hh = String(spec.hour).padStart(2, "0");
  const mm = String(spec.minute).padStart(2, "0");
  const guess = new Date(`${isoDate}T${hh}:${mm}:00Z`);
  if (Number.isNaN(guess.getTime())) return null;
  return new Date(guess.getTime() - timeZoneOffsetMs(guess, spec.zone));
}

export function marketOpenLabel(market: string): string {
  return MARKET_OPEN[market]?.label ?? market;
}

/** "12시간 34분 08초" — the countdown to the opening bell. Returns null once the
 * target has passed so the caller can swap in an "개장" state instead of counting
 * up into negative numbers. */
export function formatCountdown(msRemaining: number): string | null {
  if (msRemaining <= 0) return null;
  const total = Math.floor(msRemaining / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return `${days}일 ${pad(hours)}시간 ${pad(minutes)}분`;
  return `${pad(hours)}시간 ${pad(minutes)}분 ${pad(seconds)}초`;
}

const KRX_CODE = /^\d{6}$/;

export function isKrxCode(code: string): boolean {
  return KRX_CODE.test(code);
}

/** US tickers that have a bundled logo under /img/ticker. Anything absent falls back
 * to a monogram tile rather than a broken image — the roster changes with index
 * weights, so a missing asset is an expected state, not a bug to fix by hand. */
const US_LOGO_FILES: Record<string, string> = {
  NVDA: "nvidia",
  AAPL: "apple",
  MSFT: "microsoft",
  GOOGL: "google",
  GOOG: "google",
  AVGO: "broadcom",
  SPCX: "spacex",
  META: "meta",
  TSLA: "tesla",
  MU: "micron",
  AMD: "amd",
  INTC: "intel",
};

export function usLogoUrl(code: string): string | null {
  const file = US_LOGO_FILES[code];
  return file ? `/img/ticker/${file}.png` : null;
}

/** KRX prices are whole won; US tickers quote to the cent. */
export function formatPrice(value: number, market: string): string {
  const isKr = market === "KOSPI" || market === "KOSDAQ";
  return value.toLocaleString("ko-KR", {
    minimumFractionDigits: isKr ? 0 : 2,
    maximumFractionDigits: isKr ? 0 : 2,
  });
}

/** Currency marks sit on opposite sides of the number in the two conventions: "$12.34"
 * but "12,340원". Returning both slots (one always empty) lets a caller render the
 * amount without branching on market at every call site — and stops US prices from
 * rendering as "313.59 $", which reads as a unit rather than a currency. */
export function moneyAffix(market: string): { prefix: string; suffix: string } {
  return market === "NASDAQ" ? { prefix: "$", suffix: "" } : { prefix: "", suffix: "원" };
}

/** Amount with its currency mark already in the right position. */
export function formatMoney(value: number, market: string): string {
  const { prefix, suffix } = moneyAffix(market);
  return `${prefix}${formatPrice(value, market)}${suffix}`;
}

export function formatChangeRate(rate: number): string {
  return `${rate > 0 ? "+" : ""}${rate.toFixed(2)}%`;
}

/** "2026-07-24T03:13:30+00:00" -> "7월 24일 12:13" in Korea time.
 *
 * Pinned to KST rather than the visitor's locale because it labels when the *Korean*
 * batch published — a reader in another timezone comparing it against the KRX close
 * needs the exchange's clock, not their own. */
export function formatGeneratedAt(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** "20260727" -> "2026년 7월 27일" */
export function formatFullDate(key: string): string {
  if (!/^\d{8}$/.test(key)) return key;
  return `${key.slice(0, 4)}년 ${Number(key.slice(4, 6))}월 ${Number(key.slice(6, 8))}일`;
}

/** Percentage width for the conviction bar. The score is a signed unit value, so the
 * bar is drawn from a centered zero line and only its magnitude sets the length.
 * Floored at 2% so a near-zero score still renders a visible tick rather than
 * vanishing — a 보합 call is a real verdict, not missing data. */
export function scoreWidthPct(score: number): number {
  return Math.max(2, Math.min(100, Math.abs(score) * 100));
}

/** The three direction probabilities, or null for a row written before the
 * probability model shipped. Null is a real state on this page — the date navigator
 * reaches back into history — so every caller has to handle its absence rather than
 * defaulting to zeroes that would render as a confident 0% 상승. */
export function probabilities(
  item: PredictionItem
): { up: number; flat: number; down: number } | null {
  if (item.prob_up === null || item.prob_flat === null || item.prob_down === null) return null;
  return { up: item.prob_up, flat: item.prob_flat, down: item.prob_down };
}

/** Which direction the distribution actually favours. Usually the same as `result`,
 * but not always: `result` is the point forecast's direction and this is the biggest
 * share of the distribution, and near the 보합 boundary a small expected move can sit
 * under the flat threshold while 상승 is still the single most likely bucket. Showing
 * both is the honest rendering; hiding the disagreement would not make it go away. */
export function likeliest(item: PredictionItem): PredictionResult | null {
  const p = probabilities(item);
  if (!p) return null;
  if (p.up >= p.flat && p.up >= p.down) return "상승";
  if (p.down >= p.flat && p.down >= p.up) return "하락";
  return "보합";
}

/** How far ahead the leading bucket is of the 보합 bucket, in points.
 *
 * The card only flags a disagreement between the verdict and the distribution when
 * this is decisive. A 보합 call whose 하락 share leads 보합 by two points is a coin
 * flip dressed up as a finding, and flagging every one of those put the badge on most
 * of the grid — which trains the reader to ignore it on the rows where it matters. */
export function likeliestMargin(item: PredictionItem): number {
  const p = probabilities(item);
  if (!p) return 0;
  return Math.max(p.up, p.down, p.flat) - p.flat;
}

export const RELIABILITY_CLASS: Record<string, string> = {
  높음: "high",
  보통: "mid",
  낮음: "low",
};

/** Display order for the evidence categories. Fixed rather than following the order
 * the backend emitted them in, so the same category is always in the same place across
 * cards and a reader can scan down a column for 수급.
 *
 * Text only — an earlier version prefixed each category with an emoji, which rendered
 * as tofu boxes in the app's font stack. The coloured leading edge already carries the
 * direction, so the icon was decoration that could fail. */
export const EVIDENCE_ORDER: Record<PredictionEvidence["category"], number> = {
  주가: 1,
  거래량: 2,
  수급: 3,
  호가: 4,
  업종지수: 5,
  환율: 6,
  뉴스: 7,
};

export function sortEvidence(entries: PredictionEvidence[]): PredictionEvidence[] {
  return [...entries].sort(
    (a, b) => (EVIDENCE_ORDER[a.category] ?? 99) - (EVIDENCE_ORDER[b.category] ?? 99)
  );
}

/** Distinct categories in display order — the compact chip row on a card. */
export function evidenceCategories(entries: PredictionEvidence[]): PredictionEvidence["category"][] {
  const seen = new Set<PredictionEvidence["category"]>();
  for (const entry of sortEvidence(entries)) seen.add(entry.category);
  return [...seen];
}

/** "65% (13/20)", or a dash when the window holds nothing. A window with no graded
 * predictions is not a 0% hit rate, and printing one would libel a stock that has
 * simply never been checked. */
export function formatAccuracy(window: AccuracyWindow | undefined | null): string {
  if (!window || window.rate === null) return "―";
  return `${window.rate}% (${window.hit}/${window.total})`;
}

export function accuracyTone(window: AccuracyWindow | undefined | null): "up" | "down" | "flat" {
  if (!window || window.rate === null) return "flat";
  if (window.rate >= 60) return "up";
  if (window.rate < 40) return "down";
  return "flat";
}
