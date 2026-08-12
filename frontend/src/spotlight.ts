import { MarketMapItem } from "./api/client";

/* 오늘의 주목 종목 — which six, when they are allowed to change, and what is
 * said about each.
 *
 * ── Where the commentary comes from ──
 *
 * Not from a language model, and the distinction is worth being precise about
 * because the feature reads like it should be. Every sentence this file
 * produces is assembled from numbers the page already holds: the move, the
 * turnover, the stock's rank on both within its own board, its sector's
 * cap-weighted move today, its cap rank, its PER and its foreign holding. The
 * phrasing and the judgement about which two of those facts are worth saying
 * for a given stock are written here, once; the figures are this minute's.
 *
 * That buys three things a generated paragraph cannot. It cannot be wrong about
 * a number, because it has no way to produce one that is not in the payload. It
 * costs nothing per view, where a model call would be six of them per bucket
 * per market. And it says the same thing to every reader at the same moment,
 * which for a "주목 종목" panel is the difference between a market view and six
 * private ones. The project already reached this conclusion once — see the note
 * on PREDICTION_AI_CLOSE_SUMMARY in render.yaml, which is off by default
 * because explaining a move that already happened, out of numbers the app is
 * holding, was not worth what the tokens cost.
 *
 * ── What it is careful not to say ──
 *
 * Everything below is descriptive and backward-looking: what a stock did today
 * and what stood around it while it did. There is no target, no valuation
 * judgement, no forecast and no suggestion to do anything, because this panel
 * is on the front page of a site with no idea who is reading it. "거래대금 3위"
 * is a fact; "지금이 기회" would be advice, and this file must never grow one.
 */

/** Which board a pick belongs to. The two KR ones rank on money; the two US
 * ones cannot, because their payload carries no volume. See BoardKind. */
export type BoardName = "KOSPI" | "KOSDAQ" | "S&P 500" | "NASDAQ 100";

/** What kind of data the board's payload is, which decides both how the three
 * are scored and which observations are available to say about them.
 *
 *  "kr" — has volume, so turnover is real and is half the ranking.
 *  "us" — has no volume at all, so size stands in for it, and no line may
 *         mention 거래대금. It does have a pre/post session flag, which the KR
 *         side has no equivalent of and which is worth saying when set.
 */
export type BoardKind = "kr" | "us";

export interface SpotlightPick {
  item: MarketMapItem;
  market: BoardName;
  /** 1-based rank by today's move within its own board. */
  changeRank: number;
  /** 1-based rank by turnover (close × volume) within its own board. 0 on a
   * board with no volume — see BoardKind. */
  turnoverRank: number;
  /** Cap-weighted move of this stock's sector today, in per cent. */
  sectorChange: number;
  /** How many names of this sector are in the board, so a one-member "sector"
   * can be kept out of the commentary rather than reported as a trend. */
  sectorMembers: number;
  /** 1-based rank by market cap within its own board. */
  capRank: number;
  /** How many names on this board are at the daily price limit today. */
  limitCount: number;
  /** How many names on this board are up at all. The only breadth figure the
   * pre-market hour has to offer, where turnover is not yet a number. */
  riserCount: number;
  /** 1-based rank by today's move within this stock's own sector, and how many
   * names that sector has on the board. Both 0 when it has no usable sector. */
  sectorRank: number;
  sectorSize: number;
  /** The finished commentary, already in reading order. */
  lines: string[];
}

/* ── when the six are allowed to change ──────────────────────────────────── */

/** The KRX session, in minutes from midnight, Seoul time. */
const PRE_OPEN = 8 * 60;
const OPEN = 9 * 60;
const CLOSE = 15 * 60 + 30;

function seoulParts(now: Date): { date: string; minutes: number } {
  /* en-CA gives YYYY-MM-DD, which is the only format here that sorts and
     compares as a plain string. The two calls are deliberate: asking for the
     date and the time in one formatToParts pass would still need the same
     lookup, and this reads. */
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const [h, m] = hm.split(":").map(Number);
  return { date, minutes: h * 60 + m };
}

function previousDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export type SessionPhase = "pre" | "live" | "closed";

export interface Bucket {
  key: string;
  phase: SessionPhase;
}

/** How finely the pre-market window is sliced. Ten minutes rather than the hour
 * the other windows get, because this one starts from nothing: at 08:00 the NXT
 * pre-market has just opened and almost no name has printed yet, so an hourly
 * bucket locks the six on the first two or three quotes of the morning and holds
 * them past every stock that actually moves between 08:10 and 08:50. The other
 * windows open onto a board that is already full and can afford to hold still. */
const PRE_SLICE_MIN = 10;

/** The window the current six belong to. The selection is recomputed only when
 * this key changes, which is what makes the board hold still rather than
 * reshuffling under the reader every time the minute poll lands.
 *
 *   08:00–08:59  프리장 — repicked every ten minutes, see PRE_SLICE_MIN
 *   09:00–15:29  장중  — repicked on the hour
 *   15:30–23:59  마감  — the day's finished ranking
 *   00:00–07:59  마감  — still yesterday's, until the pre-market window opens
 */
export function sessionBucket(now: Date = new Date()): Bucket {
  const { date, minutes } = seoulParts(now);
  if (minutes >= PRE_OPEN && minutes < OPEN) {
    return { key: `pre:${date}:${Math.floor(minutes / PRE_SLICE_MIN)}`, phase: "pre" };
  }
  if (minutes >= OPEN && minutes < CLOSE) {
    return { key: `live:${date}:${Math.floor(minutes / 60)}`, phase: "live" };
  }
  if (minutes >= CLOSE) return { key: `close:${date}`, phase: "closed" };
  return { key: `close:${previousDate(date)}`, phase: "closed" };
}

/**
 * The same window for the US board, on a New York clock.
 *
 * It has to be a different function, and the reason is a bug this replaces. The
 * US board was keyed on the Seoul bucket above, and Seoul time does not divide
 * the New York session at all: the whole US regular session falls between 22:30
 * and 05:00 KST, which is one `close:` bucket until Seoul's midnight and another
 * after it. So the six US names were picked once and then held for the entire
 * session, and the one time they did change it was because a date on the other
 * side of the world had rolled over — not because anything had happened in the
 * market they describe.
 *
 * The session comes from the payload rather than from a clock, because the
 * backend already knows it and holidays and early closes are exactly the days a
 * clock gets wrong. The hour is only used to divide the regular session into the
 * same hourly windows the KR board gets.
 */
export function usSessionBucket(
  session: "pre" | "regular" | "post" | null | undefined,
  now: Date = new Date()
): Bucket {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hour12: false,
  }).format(now);

  if (session === "pre") return { key: `us-pre:${date}`, phase: "pre" };
  if (session === "regular") return { key: `us-live:${date}:${hour}`, phase: "live" };
  // "post", and anything the payload has not said — both are "the session that
  // matters is over", which ranks like a finished day.
  return { key: `us-close:${date}`, phase: "closed" };
}

/* ── which three ─────────────────────────────────────────────────────────── */

/** Below this a "board member" is too small for its percentage to mean much —
 * a 2000억 company can move 15% on the turnover of a single fund's morning. */
const MIN_MARCAP = 200_000_000_000;
/** And below this in turnover the move happened on nobody's money. */
const MIN_TURNOVER = 2_000_000_000;
/** The US floor, in dollars of market cap. There is no turnover to filter on, so
 * size is the only liquidity proxy available — and both these indices are large
 * caps by construction, so this only screens the very bottom of the NASDAQ 100. */
const MIN_US_CAP = 10_000_000_000;
const PICKS = 3;

function turnoverOf(item: MarketMapItem): number {
  return item.close * (item.volume ?? 0);
}

/**
 * Whether this board's volume column means anything yet.
 *
 * It does not, for one hour a day, and the panel used to go blank over it. The
 * KR payload's `volume` is the day's cumulative *regular-session* figure lifted
 * from the ranking-page scrape; only price, change and cap are overlaid with the
 * live NXT quote. So between 08:00 and 09:00 — while the NXT pre-market is the
 * only venue trading and the KRX has not opened — every name on the board reads
 * a real move against a volume of zero, `turnoverOf` returns zero for all of
 * them, and MIN_TURNOVER, a hard filter, threw away the entire board. Six
 * skeleton cards, every morning, for the hour with the day's sharpest movers on
 * it.
 *
 * Asked of the data rather than of the clock, because the clock gets this wrong
 * in both directions: the first minutes after 09:00 are also below the turnover
 * floor for most names, and a holiday is 08:00 all day. A quarter of the board
 * is the threshold so that one stale row cannot flip it on, and so that it flips
 * within seconds of the real open, when the liquid names all print at once.
 */
function turnoverIsReal(items: MarketMapItem[], kind: BoardKind): boolean {
  if (kind !== "kr" || items.length === 0) return false;
  let traded = 0;
  for (const item of items) {
    if ((item.volume ?? 0) > 0) traded += 1;
  }
  return traded * 4 >= items.length;
}

/** The size figure to rank by. `marcap` is an absolute won amount on the KR
 * maps and the constituent's index *weight* in per cent on the US ones — same
 * field name, different quantity — so the US side prefers `market_cap`, which
 * is the real one, and falls back to the weight when it is missing. */
function sizeOf(item: MarketMapItem, kind: BoardKind): number {
  if (kind === "kr") return item.marcap;
  return item.market_cap ?? item.marcap;
}

/** Rank map, 1-based, by a descending key. */
function rankBy(items: MarketMapItem[], key: (i: MarketMapItem) => number): Map<string, number> {
  const sorted = [...items].sort((a, b) => key(b) - key(a));
  const ranks = new Map<string, number>();
  sorted.forEach((item, index) => ranks.set(item.code, index + 1));
  return ranks;
}

/** Cap-weighted move per sector, plus how many names carry it. Same measure the
 * breadth gauge's 업종 list uses, and for the same reason: an equal-weighted
 * sector average lets the smallest name in 반도체 count for as much as Samsung. */
function sectorMoves(items: MarketMapItem[]): Map<string, { change: number; members: number }> {
  const acc = new Map<string, { sum: number; cap: number; members: number }>();
  for (const item of items) {
    const sector = item.sector?.trim();
    if (!sector) continue;
    const cap = Math.max(item.marcap, 0);
    const bucket = acc.get(sector);
    if (bucket) {
      bucket.sum += item.change_pct * cap;
      bucket.cap += cap;
      bucket.members += 1;
    } else {
      acc.set(sector, { sum: item.change_pct * cap, cap, members: 1 });
    }
  }
  const out = new Map<string, { change: number; members: number }>();
  for (const [sector, b] of acc) {
    out.set(sector, { change: b.cap > 0 ? b.sum / b.cap : 0, members: b.members });
  }
  return out;
}

/** Position of a value in a sorted list, 0..1, where 1 is the top. Used to put
 * "how big a move" and "how much money" on the same scale before they are
 * weighed against each other — the two are in different units and a raw sum
 * would just be whichever has the larger numbers. */
function percentile(sortedAsc: number[], value: number): number {
  if (sortedAsc.length === 0) return 0;
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sortedAsc.length;
}

/**
 * The three, per board.
 *
 * The brief was "상위 급등 종목 중에서 판단해서 셋". The judgement is three
 * rules, in the order they matter:
 *
 *  1. It has to have gone up, on real money. A percentage with no turnover
 *     behind it is a quote, not a move, so both floors above are hard filters
 *     rather than score terms.
 *  2. Then rank on the move and the money together. Percentile rather than raw,
 *     because +14% and 4000억 are not comparable numbers; after close the
 *     weighting tips toward turnover, which is what the brief asked for and is
 *     also the honest reading of a finished session — the day's story is where
 *     the volume went, not which micro cap printed the largest percentage.
 *  3. Then spread them. Three names from one sector is one story told three
 *     times, so a sector already represented is skipped while any unrepresented
 *     candidate remains, and only allowed a second slot if the list runs out.
 */
export function pickSpotlight(
  items: MarketMapItem[],
  market: BoardName,
  phase: SessionPhase,
  kind: BoardKind = "kr",
  /* Tickers already spoken for by an earlier board.
   *
   * KOSPI and KOSDAQ are disjoint, so this is unused on the KR desk. The two US
   * indices are not remotely disjoint — the NASDAQ 100 is almost a subset of the
   * S&P 500 by cap — so without it the same two or three mega caps win both rows
   * and "six stocks in focus" is five, or four. The S&P is picked first as the
   * broader board and the NASDAQ row takes the best of what is left, which also
   * makes the second row the more interesting of the two. */
  exclude?: Set<string>
): SpotlightPick[] {
  /* Whether this run has turnover to work with at all. False for the whole US
     side, and false on the KR side during the pre-market hour — see
     turnoverIsReal. Everything below that touches money is switched off by it
     rather than left to produce "거래대금 0원 · 1위" out of a table of ties. */
  const hasTurnover = turnoverIsReal(items, kind);

  const candidates = items.filter((item) =>
    (kind === "kr"
      ? item.change_pct > 0 &&
        item.marcap >= MIN_MARCAP &&
        // The floor is a statement about money, so it can only be applied where
        // there is money to measure. Before the KRX opens, cap is the only
        // liquidity proxy left — the same position the US boards are in
        // permanently — and it is already doing that job on the line above.
        (!hasTurnover || turnoverOf(item) >= MIN_TURNOVER)
      : item.change_pct > 0 && sizeOf(item, kind) >= MIN_US_CAP) &&
    !exclude?.has(item.code)
  );
  if (candidates.length === 0) return [];

  const changeRanks = rankBy(items, (i) => i.change_pct);
  // Meaningless on a board with no usable volume; every entry would be a tie at
  // zero, so the map is simply not built and every turnoverRank comes out 0.
  const turnoverRanks = hasTurnover ? rankBy(items, turnoverOf) : new Map<string, number>();
  const capRanks = rankBy(items, (i) => sizeOf(i, kind));
  const sectors = sectorMoves(items);

  const limitCount = kind === "kr" ? items.filter((i) => i.change_pct >= LIMIT_PCT).length : 0;
  const riserCount = items.filter((i) => i.change_pct > 0).length;

  /* Where each name places inside its own sector. This is the observation that
     keeps the US cards from all reading alike: with no volume, no price limit
     and no extended session to talk about during regular hours, the only notes
     left there were size and sector average, and three cards in a row fell to
     the same one. "Second of seventy-eight in Information Technology" is
     specific, always computable, and says something the other notes do not. */
  const bySector = new Map<string, MarketMapItem[]>();
  for (const item of items) {
    const sector = item.sector?.trim();
    if (!sector) continue;
    const bucket = bySector.get(sector);
    if (bucket) bucket.push(item);
    else bySector.set(sector, [item]);
  }
  const sectorRanks = new Map<string, { rank: number; size: number }>();
  for (const [, members] of bySector) {
    const sorted = [...members].sort((a, b) => b.change_pct - a.change_pct);
    sorted.forEach((item, index) =>
      sectorRanks.set(item.code, { rank: index + 1, size: sorted.length })
    );
  }
  const changesAsc = candidates.map((i) => i.change_pct).sort((a, b) => a - b);
  /* The second axis. Money wherever there is money to measure; size wherever
     there is not — the US boards always, the KR boards until the KRX opens.
     Size is not the same measure and is not pretended to be, but it buys the
     same thing turnover buys: it keeps the three from being whichever small
     constituent happened to print the largest percentage. */
  const secondOf = (i: MarketMapItem) => (hasTurnover ? turnoverOf(i) : sizeOf(i, kind));
  const secondAsc = candidates.map(secondOf).sort((a, b) => a - b);

  /* Weighting the move against the second axis. After the close it tips toward
     turnover, which is the honest reading of a finished session. Before the open
     it tips the other way: the brief for the pre-market hour is the morning's
     급등 names, and the axis it would be tipping toward is a cap ranking that
     barely changes from one day to the next. */
  const moveWeight = phase === "closed" ? 0.45 : hasTurnover || kind === "us" ? 0.62 : 0.7;
  const scored = candidates
    .map((item) => ({
      item,
      score:
        percentile(changesAsc, item.change_pct) * moveWeight +
        percentile(secondAsc, secondOf(item)) * (1 - moveWeight),
    }))
    .sort((a, b) => b.score - a.score);

  const chosen: MarketMapItem[] = [];
  const usedSectors = new Set<string>();
  for (const { item } of scored) {
    if (chosen.length >= PICKS) break;
    const sector = item.sector?.trim() ?? "";
    if (sector && usedSectors.has(sector)) continue;
    chosen.push(item);
    if (sector) usedSectors.add(sector);
  }
  // Only if spreading them left the board short — better a repeated sector than
  // an empty slot.
  for (const { item } of scored) {
    if (chosen.length >= PICKS) break;
    if (chosen.includes(item)) continue;
    chosen.push(item);
  }

  /* The note each card carries is chosen against what the other cards in the
     same row already said. Three stocks that are all up double digits will all
     satisfy "beat its sector", and three cards reciting the same clause with
     different nouns in it read as a table with the headers deleted — which is
     what the first draft of this did, four cards out of six. `used` is what
     stops it: each card takes the highest-priority observation nobody above it
     has used yet, and only falls back to a repeat if it has nothing else true
     to say. */
  const used = new Set<NoteKind>();
  return chosen.map((item) => {
    const sector = item.sector?.trim() ?? "";
    const sectorInfo = sectors.get(sector);
    const pick: Omit<SpotlightPick, "lines"> = {
      item,
      market,
      changeRank: changeRanks.get(item.code) ?? 0,
      turnoverRank: turnoverRanks.get(item.code) ?? 0,
      sectorChange: sectorInfo?.change ?? 0,
      sectorMembers: sectorInfo?.members ?? 0,
      capRank: capRanks.get(item.code) ?? 0,
      limitCount,
      riserCount,
      sectorRank: sectorRanks.get(item.code)?.rank ?? 0,
      sectorSize: sectorRanks.get(item.code)?.size ?? 0,
    };
    return { ...pick, lines: describe(pick, phase, used, kind, hasTurnover) };
  });
}

/* ── what is said about each ─────────────────────────────────────────────── */

const BOARD_LABEL: Record<BoardName, string> = {
  KOSPI: "코스피",
  KOSDAQ: "코스닥",
  "S&P 500": "S&P 500",
  "NASDAQ 100": "나스닥 100",
};

function formatWon(value: number): string {
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(1)}조원`;
  if (value >= 100_000_000) return `${Math.round(value / 100_000_000).toLocaleString()}억원`;
  return `${Math.round(value).toLocaleString()}원`;
}

/** The kinds of observation a card can carry, so a row can avoid repeating one.
 * See the `used` set in pickSpotlight. */
type NoteKind =
  | "limit"
  | "against"
  | "money"
  | "breadth"
  | "bigcap"
  | "carried"
  | "ahead"
  | "session"
  | "sectorrank"
  | "weight"
  | "profile";

/** KRX's daily price limit. A close within a whisker of it is 상한가, and on a
 * board of gainers it is the single most specific thing that can be said about
 * a stock — it did not merely rise, it ran out of room. */
const LIMIT_PCT = 29.0;

/**
 * Two lines per card: what it did, then the most informative true thing
 * standing around it.
 *
 * The second line is *chosen*, and that choice is the whole of the "analysis"
 * here. The candidates below are ordered by how much each tells a reader when
 * it happens to be true, and the first one that both applies and has not
 * already been used in this row wins.
 *
 * The ordering was corrected after reading real output. An earlier draft put
 * "beat its own sector average" high, and it swallowed four cards out of six —
 * of course it did: a stock that is up twelve per cent has beaten any sector
 * average that exists. A fact that is true of every member of a set does not
 * distinguish anything in it, so it now sits second from last and is only
 * allowed when the sector itself actually moved, which is the only case where
 * the comparison carries information.
 */
function describe(
  pick: Omit<SpotlightPick, "lines">,
  phase: SessionPhase,
  used: Set<NoteKind>,
  kind: BoardKind,
  /** Whether turnover is a real figure on this board right now — false for the
   * US side always and for the KR side before the KRX opens. Every clause below
   * that names 거래대금 is gated on it; see turnoverIsReal. */
  hasTurnover: boolean
): string[] {
  const {
    item,
    market,
    changeRank,
    turnoverRank,
    sectorChange,
    sectorMembers,
    capRank,
    limitCount,
    riserCount,
    sectorRank,
    sectorSize,
  } = pick;
  const board = BOARD_LABEL[market];
  const sector = item.sector?.trim() ?? "";
  const turnover = turnoverOf(item);
  /* The daily price limit is a KRX rule. A US stock has no cap to run into, so
     this must never fire there — +30% on NASDAQ is a large move, not a limit,
     and calling it one would be inventing a market mechanic. */
  const atLimit = kind === "kr" && item.change_pct >= LIMIT_PCT;

  /* The US payload says which session it is quoting from, and it is worth
     saying: a reader looking at +4% needs to know whether the market was open
     when it happened. The KR maps carry no equivalent flag. */
  const session = kind === "us" ? item.session : undefined;
  const sessionWord =
    session === "pre"
      ? "프리마켓"
      : session === "post"
        ? "애프터마켓"
        : session === "regular"
          ? "정규장 거래 중"
          : null;

  /* Noun-ending throughout, by request, and it suits the card better than the
     sentences it replaced: six of these stack in a row, and a column of 했다 /
     됐다 endings reads as prose that wants to be read in order, where a column
     of 마감 / 몰림 / 앞섬 reads as six labels that can be scanned in any. The
     tense still has to change with the session — 마감 is a fact after 15:30 and
     a guess before it — so the phase still picks the word, it just picks a noun
     now.

     The US side never reads that clock. `phase` is derived from Seoul time, and
     Seoul time says nothing whatsoever about New York: at 22:48 KST the KRX has
     been shut for seven hours and the NYSE is mid-session, so a US card built on
     it announced "+1.23% 마감" about a market that was open. The session flag on
     the payload is the only correct source there, and when it is missing the
     fallback is deliberately the neutral word rather than the confident one — a
     card that says 거래 중 when trading has stopped is wrong by a few hours,
     where 마감 during the open session is wrong about what the market IS.

     The KR pre-market gets a word of its own, and needs one: 08:00–09:00 is NXT,
     the KRX is shut, and the figure on the card is a pre-market quote against
     yesterday's close. 거래 중 there would name the wrong venue, and the NXT
     session itself stops matching at 08:50 while the last price stands until
     09:00 — so the word describes what the number IS rather than claiming
     anything about this second. */
  const state =
    kind === "us"
      ? (sessionWord ?? "거래 중")
      : phase === "closed"
        ? "마감"
        : phase === "pre"
          ? "프리마켓"
          : "거래 중";
  const lead = atLimit
    ? `${board} 상승률 ${changeRank}위 · 가격제한폭 도달 · +${item.change_pct.toFixed(2)}% ${state}`
    : changeRank <= 20
      ? `${board} 상승률 ${changeRank}위 · +${item.change_pct.toFixed(2)}% ${state}`
      : `+${item.change_pct.toFixed(2)}% ${state}`;

  // A sector is only a sector if several names carry it — one member is this
  // stock wearing a category name, and reporting it as a trend would be a lie
  // by arithmetic.
  const realSector = sector !== "" && sectorMembers >= 3;
  const gap = item.change_pct - sectorChange;

  const candidates: { kind: NoteKind; when: boolean; text: string }[] = [
    {
      /* Only what can be counted. An earlier version of this line said the stock
         closed "매수 주문이 남은 채로" — which is what a 상한가 usually means and
         which this file has no data for whatsoever: there is no order-book depth
         in a market-map payload. It also read in the past tense during the
         session. Both are the exact failure the note at the top of this file
         warns against, and both were caught by reading the real output. */
      kind: "limit",
      when: atLimit,
      text: (() => {
        const many =
          limitCount > 1
            ? `오늘 ${board} 상한가 ${limitCount}종목 중 하나`
            : `오늘 ${board}의 유일한 상한가`;
        return hasTurnover ? `${many} · 거래대금 ${formatWon(turnover)}` : many;
      })(),
    },
    {
      kind: "against",
      when: realSector && sectorChange <= -0.3,
      text: `${sector} 업종 ${sectorChange.toFixed(2)}% 하락 속 나 홀로 역행`,
    },
    {
      // turnoverRank is 0 wherever turnover is not a real figure, so this is
      // already unreachable there, but the guard says why rather than leaving it
      // to a rank that happens to be falsy.
      kind: "money",
      when: hasTurnover && turnoverRank > 0 && turnoverRank <= 10,
      text: `거래대금 ${board} ${turnoverRank}위 · ${formatWon(turnover)} 자금 몰림`,
    },
    {
      /* What stands in for the money line during the pre-market hour. It is
         about the board rather than the stock, deliberately: with no turnover
         to rank on, how broad the morning is decides whether a +6% quote is a
         market opening green or one name being marked up on its own. */
      kind: "breadth",
      when: kind === "kr" && !hasTurnover && riserCount > 0,
      text: `프리마켓에서 ${board} ${riserCount}종목 상승 중`,
    },
    {
      kind: "bigcap",
      when: capRank > 0 && capRank <= 25 && item.change_pct >= 3,
      text:
        kind === "kr"
          ? // "하루" is a claim about a session, and before 09:00 there has not
            // been one — the figure is an hour of pre-market against yesterday's
            // close.
            `시총 ${board} ${capRank}위 대형주의 ${phase === "pre" ? "프리마켓" : "하루"} ${item.change_pct.toFixed(2)}% 이동`
          : `${board} 시총 ${capRank}위 대형주의 ${item.change_pct.toFixed(2)}% 이동`,
    },
    {
      kind: "carried",
      when: realSector && sectorChange >= 1.2 && gap < 3,
      text: `${sector} 업종 +${sectorChange.toFixed(2)}% 강세 흐름에 동반`,
    },
    {
      kind: "ahead",
      // Only when the sector actually went somewhere. Against a flat sector the
      // comparison is arithmetic, not information.
      when: realSector && Math.abs(sectorChange) >= (kind === "us" ? 0.4 : 1) && gap >= (kind === "us" ? 2.5 : 5),
      text: `${sector} 업종 평균 ${sectorChange >= 0 ? "+" : ""}${sectorChange.toFixed(2)}% 대비 큰 폭 앞섬`,
    },
    {
      /* Splits the move into its two legs, which only a US payload can do: the
         regular session and whatever happened around it. Worth a slot of its own
         because "up 4%" and "up 1% then up 3% after the bell on a headline" are
         different events wearing the same number. */
      kind: "session",
      when:
        kind === "us" &&
        sessionWord !== null &&
        typeof item.extended_change_pct === "number",
      text:
        typeof item.regular_change_pct === "number"
          ? `정규장 ${item.regular_change_pct >= 0 ? "+" : ""}${item.regular_change_pct.toFixed(2)}% · ${sessionWord} ${(item.extended_change_pct ?? 0) >= 0 ? "+" : ""}${(item.extended_change_pct ?? 0).toFixed(2)}%`
          : `${sessionWord} ${(item.extended_change_pct ?? 0) >= 0 ? "+" : ""}${(item.extended_change_pct ?? 0).toFixed(2)}% · 정규장 개장 전`,
    },
    {
      // Leading its own sector says more than leading the board, because a
      // sector is a set of companies with the same weather.
      kind: "sectorrank",
      when: realSector && sectorRank > 0 && sectorRank <= 3 && sectorSize >= 8,
      text: `${sector} ${sectorSize}종목 중 상승률 ${sectorRank}위`,
    },
    {
      /* US only: `marcap` on a US constituent is the index weight in per cent,
         not a capitalisation. It is the one figure the KR payload has no
         equivalent of, and on an index page it is exactly the right unit —
         how much of the index this one name actually is. */
      kind: "weight",
      when: kind === "us" && item.marcap > 0.15,
      text: `${board} 지수 내 비중 ${item.marcap.toFixed(2)}%`,
    },
    {
      kind: "profile",
      when: true,
      text: profileOf(item, board, turnover, turnoverRank, kind, hasTurnover, capRank),
    },
  ];

  const applicable = candidates.filter((c) => c.when);
  const fresh = applicable.find((c) => !used.has(c.kind));
  const chosen = fresh ?? applicable[applicable.length - 1];
  if (chosen) used.add(chosen.kind);

  return chosen ? [lead, chosen.text] : [lead];
}

/** The always-true fallback: what this company is, rather than what it did.
 * Never the most interesting line on a card, and never wrong either. */
function profileOf(
  item: MarketMapItem,
  board: string,
  turnover: number,
  turnoverRank: number,
  kind: BoardKind,
  hasTurnover: boolean,
  capRank: number
): string {
  const bits: string[] = [];
  if (kind === "kr") {
    if (hasTurnover && turnoverRank > 0 && turnoverRank <= 60) {
      bits.push(`거래대금 ${formatWon(turnover)} · ${board} ${turnoverRank}위`);
    }
    /* Cap rank takes the money line's place before the open. It is the one
       standing figure that is as true at 08:10 as at 15:30, and without it a
       pre-market card whose only other facts are missing falls through to the
       empty string below — which is how this function ended up as a fallback
       that could itself need one. */
    if (!hasTurnover && capRank > 0) bits.push(`시총 ${board} ${capRank}위`);
    if (typeof item.per === "number" && item.per > 0) bits.push(`PER ${item.per.toFixed(1)}배`);
    if (typeof item.foreign_ratio === "number" && item.foreign_ratio > 0) {
      bits.push(`외국인 지분 ${item.foreign_ratio.toFixed(1)}%`);
    }
    if (bits.length === 0) {
      return hasTurnover ? `거래대금 ${formatWon(turnover)}` : `시총 ${formatWon(item.marcap)}`;
    }
  } else {
    // No turnover, no PER and no holding split in a US map payload — what is
    // left is what the company is worth and where it sits.
    const cap = item.market_cap;
    if (typeof cap === "number" && cap > 0) bits.push(`시총 ${formatUsd(cap)}`);
    if (item.sector) bits.push(item.sector);
    if (bits.length === 0) return `${board} 구성종목`;
  }
  return bits.slice(0, 3).join(" · ");
}

/** Dollars, at the scale a mega cap is actually discussed in. */
function formatUsd(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${Math.round(value / 1e9).toLocaleString()}B`;
  return `$${Math.round(value / 1e6).toLocaleString()}M`;
}
