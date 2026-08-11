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

export interface SpotlightPick {
  item: MarketMapItem;
  market: "KOSPI" | "KOSDAQ";
  /** 1-based rank by today's move within its own board. */
  changeRank: number;
  /** 1-based rank by turnover (close × volume) within its own board. */
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

/** The window the current six belong to. The selection is recomputed only when
 * this key changes, which is what makes the board hold still rather than
 * reshuffling under the reader every time the minute poll lands.
 *
 *   08:00–08:59  프리장 — picked once and held for the hour
 *   09:00–15:29  장중  — repicked on the hour
 *   15:30–23:59  마감  — the day's finished ranking
 *   00:00–07:59  마감  — still yesterday's, until the pre-market window opens
 */
export function sessionBucket(now: Date = new Date()): Bucket {
  const { date, minutes } = seoulParts(now);
  if (minutes >= PRE_OPEN && minutes < OPEN) return { key: `pre:${date}`, phase: "pre" };
  if (minutes >= OPEN && minutes < CLOSE) {
    return { key: `live:${date}:${Math.floor(minutes / 60)}`, phase: "live" };
  }
  if (minutes >= CLOSE) return { key: `close:${date}`, phase: "closed" };
  return { key: `close:${previousDate(date)}`, phase: "closed" };
}

/* ── which three ─────────────────────────────────────────────────────────── */

/** Below this a "board member" is too small for its percentage to mean much —
 * a 2000억 company can move 15% on the turnover of a single fund's morning. */
const MIN_MARCAP = 200_000_000_000;
/** And below this in turnover the move happened on nobody's money. */
const MIN_TURNOVER = 2_000_000_000;
const PICKS = 3;

function turnoverOf(item: MarketMapItem): number {
  return item.close * (item.volume ?? 0);
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
  market: "KOSPI" | "KOSDAQ",
  phase: SessionPhase
): SpotlightPick[] {
  const candidates = items.filter(
    (item) =>
      item.change_pct > 0 &&
      item.marcap >= MIN_MARCAP &&
      turnoverOf(item) >= MIN_TURNOVER
  );
  if (candidates.length === 0) return [];

  const changeRanks = rankBy(items, (i) => i.change_pct);
  const turnoverRanks = rankBy(items, turnoverOf);
  const capRanks = rankBy(items, (i) => i.marcap);
  const sectors = sectorMoves(items);

  const limitCount = items.filter((i) => i.change_pct >= LIMIT_PCT).length;
  const changesAsc = candidates.map((i) => i.change_pct).sort((a, b) => a - b);
  const turnoversAsc = candidates.map(turnoverOf).sort((a, b) => a - b);

  const moveWeight = phase === "closed" ? 0.45 : 0.62;
  const scored = candidates
    .map((item) => ({
      item,
      score:
        percentile(changesAsc, item.change_pct) * moveWeight +
        percentile(turnoversAsc, turnoverOf(item)) * (1 - moveWeight),
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
    };
    return { ...pick, lines: describe(pick, phase, used) };
  });
}

/* ── what is said about each ─────────────────────────────────────────────── */

const BOARD_LABEL: Record<"KOSPI" | "KOSDAQ", string> = {
  KOSPI: "코스피",
  KOSDAQ: "코스닥",
};

function formatWon(value: number): string {
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(1)}조원`;
  if (value >= 100_000_000) return `${Math.round(value / 100_000_000).toLocaleString()}억원`;
  return `${Math.round(value).toLocaleString()}원`;
}

/** The kinds of observation a card can carry, so a row can avoid repeating one.
 * See the `used` set in pickSpotlight. */
type NoteKind = "limit" | "against" | "money" | "bigcap" | "carried" | "ahead" | "profile";

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
  used: Set<NoteKind>
): string[] {
  const { item, market, changeRank, turnoverRank, sectorChange, sectorMembers, capRank, limitCount } =
    pick;
  const board = BOARD_LABEL[market];
  const sector = item.sector?.trim() ?? "";
  const turnover = turnoverOf(item);
  const atLimit = item.change_pct >= LIMIT_PCT;

  const verb = phase === "closed" ? "마감했다" : "거래되고 있다";
  const lead = atLimit
    ? `${board} 상승률 ${changeRank}위. 가격제한폭까지 올라 +${item.change_pct.toFixed(2)}%로 ${verb}.`
    : changeRank <= 20
      ? `${board} 상승률 ${changeRank}위. +${item.change_pct.toFixed(2)}%로 ${verb}.`
      : `+${item.change_pct.toFixed(2)}%로 ${verb}.`;

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
      text:
        limitCount > 1
          ? `오늘 ${board}에서 가격제한폭까지 오른 ${limitCount}종목 중 하나. 거래대금 ${formatWon(turnover)}.`
          : `오늘 ${board}에서 가격제한폭까지 오른 유일한 종목. 거래대금 ${formatWon(turnover)}.`,
    },
    {
      kind: "against",
      when: realSector && sectorChange <= -0.3,
      text: `${sector} 업종이 ${sectorChange.toFixed(2)}%로 밀린 가운데 홀로 반대 방향으로 움직였다.`,
    },
    {
      kind: "money",
      when: turnoverRank > 0 && turnoverRank <= 10,
      text: `거래대금 ${formatWon(turnover)}으로 ${board} ${turnoverRank}위, 하루 자금이 이 종목에 몰렸다.`,
    },
    {
      kind: "bigcap",
      when: capRank > 0 && capRank <= 25 && item.change_pct >= 3,
      text: `시총 ${board} ${capRank}위 대형주가 하루 만에 ${item.change_pct.toFixed(2)}% 움직였다.`,
    },
    {
      kind: "carried",
      when: realSector && sectorChange >= 1.2 && gap < 3,
      text: `${sector} 업종 전체가 +${sectorChange.toFixed(2)}%로 강세인 흐름에 함께 실렸다.`,
    },
    {
      kind: "ahead",
      // Only when the sector actually went somewhere. Against a flat sector the
      // comparison is arithmetic, not information.
      when: realSector && Math.abs(sectorChange) >= 1 && gap >= 5,
      text: `${sector} 업종 평균 ${sectorChange >= 0 ? "+" : ""}${sectorChange.toFixed(2)}%를 크게 앞질렀다.`,
    },
    {
      kind: "profile",
      when: true,
      text: profileOf(item, board, turnover, turnoverRank),
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
  turnoverRank: number
): string {
  const bits: string[] = [];
  if (turnoverRank > 0 && turnoverRank <= 60) {
    bits.push(`거래대금 ${formatWon(turnover)}(${board} ${turnoverRank}위)`);
  }
  if (typeof item.per === "number" && item.per > 0) bits.push(`PER ${item.per.toFixed(1)}배`);
  if (typeof item.foreign_ratio === "number" && item.foreign_ratio > 0) {
    bits.push(`외국인 지분 ${item.foreign_ratio.toFixed(1)}%`);
  }
  if (bits.length === 0) return `거래대금 ${formatWon(turnover)}.`;
  return `${bits.slice(0, 3).join(" · ")}.`;
}
