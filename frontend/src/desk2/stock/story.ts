import type { IndicatorPoint, InvestorTrendRecord } from "../../api/client";
import type { Lang } from "../../i18n/LanguageContext";
import { eok, pct } from "../lib";
import { streakOf } from "./Flows";
import type { PeerSummary } from "./Peers";
import type { PeriodReturn } from "./Technicals";

/* The stock page's lead story, written from the numbers.
 *
 * Same rules as the front page (and as spotlight.ts before it): every clause is set
 * from a figure already on the page by a rule written here, so it cannot misstate
 * one; it costs nothing per view; and it describes what happened and where the
 * stock stands, never what to do. Korean particles after a company name are chosen
 * by the last syllable, which an arbitrary name does not reliably give, so the
 * sentences are built to need none after the name ("삼성전자의", "삼성전자," ).
 *
 * The headline picks the single most notable fact of the day — a buying streak, a
 * 52-week extreme, a volume surge, a sector lead — and pairs it with the move. */

export interface StoryInput {
  lang: Lang;
  name: string;
  currency: "KRW" | "USD";
  close: number;
  change: number;
  changePct: number;
  points: IndicatorPoint[];
  flows: InvestorTrendRecord[];
  peers: PeerSummary | null;
  returns: PeriodReturn[];
  benchName: string | null;
}

export interface Story {
  headline: string;
  deck: string[];
}

function moveWord(v: number, ko: boolean): string {
  if (ko) return v >= 5 ? "급등" : v >= 1 ? "상승" : v > 0 ? "강보합" : v === 0 ? "보합" : v > -1 ? "약보합" : v > -5 ? "하락" : "급락";
  return v >= 5 ? "surges" : v >= 1 ? "rises" : v > 0 ? "edges up" : v === 0 ? "is unchanged" : v > -1 ? "edges down" : v > -5 ? "falls" : "slumps";
}

export function writeStory(s: StoryInput): Story {
  const ko = s.lang !== "en";
  const money = (v: number) =>
    s.currency === "KRW" ? (ko ? `${Math.round(v).toLocaleString()}원` : `₩${Math.round(v).toLocaleString()}`) : `$${v.toFixed(2)}`;
  const latest = s.points[s.points.length - 1];
  const year = s.points.slice(-252);
  const hi = year.length ? Math.max(...year.map((p) => p.high)) : null;
  const lo = year.length ? Math.min(...year.map((p) => p.low)) : null;
  const rangePos = hi != null && lo != null && hi > lo ? ((s.close - lo) / (hi - lo)) * 100 : null;
  const volRatio = latest?.volume_ma20 ? (latest.volume / latest.volume_ma20) * 100 : null;
  const foreign = streakOf(s.flows, "foreign_amount");
  const inst = streakOf(s.flows, "institution_amount");
  const m1 = s.returns.find((r) => r.key === "1m");

  /* ── the headline's one fact ── */
  let clause: { ko: string; en: string } | null = null;
  if (foreign && foreign.days >= 3)
    clause = { ko: `외국인 ${foreign.days}일 연속 ${foreign.buying ? "순매수" : "순매도"}`, en: `foreigners ${foreign.buying ? "buy" : "sell"} for a ${foreign.days}th straight day` };
  else if (rangePos != null && rangePos >= 97) clause = { ko: "52주 최고가권", en: "it trades near a 52-week high" };
  else if (rangePos != null && rangePos <= 3) clause = { ko: "52주 최저가권", en: "it trades near a 52-week low" };
  else if (volRatio != null && volRatio >= 200) clause = { ko: `거래량 평소의 ${(volRatio / 100).toFixed(1)}배`, en: `volume runs ${(volRatio / 100).toFixed(1)}x normal` };
  else if (inst && inst.days >= 3)
    clause = { ko: `기관 ${inst.days}일 연속 ${inst.buying ? "순매수" : "순매도"}`, en: `institutions ${inst.buying ? "buy" : "sell"} for a ${inst.days}th straight day` };
  else if (s.peers && s.peers.moveRank === 1 && s.peers.count >= 5) clause = { ko: `${s.peers.sector} 업종 상승률 1위`, en: `it leads the ${s.peers.sector} sector` };
  else if (m1?.value != null && Math.abs(m1.value) >= 15) clause = { ko: `한 달 새 ${pct(m1.value)}`, en: `${pct(m1.value)} over a month` };

  const headline = ko
    ? clause
      ? `${s.name}, ${clause.ko} 속 ${s.changePct === 0 ? "" : `${Math.abs(s.changePct).toFixed(2)}% `}${moveWord(s.changePct, true)}`
      : `${s.name}, ${s.changePct === 0 ? "" : `${Math.abs(s.changePct).toFixed(2)}% `}${moveWord(s.changePct, true)}`
    : `${s.name} ${moveWord(s.changePct, false)}${s.changePct === 0 ? "" : ` ${Math.abs(s.changePct).toFixed(2)}%`}${clause ? ` as ${clause.en}` : ""}`;

  /* ── the body ── */
  const deck: string[] = [];
  const dirKo = s.change > 0 ? "올랐다" : s.change < 0 ? "내렸다" : "변동이 없었다";
  deck.push(
    ko
      ? `${s.name}의 주가는 ${money(s.close)}로 전일보다 ${s.change === 0 ? "" : `${money(Math.abs(s.change))}(${pct(s.changePct)}) `}${dirKo}.` +
          (rangePos != null && hi != null && lo != null ? ` 최근 52주 범위(${money(lo)}~${money(hi)})에서는 ${rangePos.toFixed(0)}% 지점이다.` : "")
      : `${s.name} is at ${money(s.close)}, ${s.change === 0 ? "unchanged" : `${s.change > 0 ? "up" : "down"} ${money(Math.abs(s.change))} (${pct(s.changePct)})`} on the previous close.` +
          (rangePos != null ? ` It sits ${rangePos.toFixed(0)}% of the way up its 52-week range.` : "")
  );

  if (latest) {
    const arr =
      latest.sma5 != null && latest.sma20 != null && latest.sma60 != null
        ? latest.sma5 > latest.sma20 && latest.sma20 > latest.sma60
          ? ko ? "정배열" : "in rising order"
          : latest.sma5 < latest.sma20 && latest.sma20 < latest.sma60
            ? ko ? "역배열" : "in falling order"
            : ko ? "혼조" : "mixed"
        : null;
    const rel = m1?.value != null && m1.bench != null ? m1.value - m1.bench : null;
    const parts: string[] = [];
    if (arr) parts.push(ko ? `5·20·60일 이동평균은 ${arr} ${m1?.value != null ? "상태이고" : "상태다"}` : `Its 5-, 20- and 60-day averages are ${arr}`);
    if (m1?.value != null)
      parts.push(
        ko
          ? `최근 1개월 수익률은 ${pct(m1.value)}${rel != null && s.benchName ? `로 ${s.benchName}보다 ${Math.abs(rel).toFixed(2)}%p ${rel >= 0 ? "높다" : "낮다"}` : "다"}`
          : `its one-month return is ${pct(m1.value)}${rel != null && s.benchName ? `, ${Math.abs(rel).toFixed(2)} points ${rel >= 0 ? "ahead of" : "behind"} the ${s.benchName}` : ""}`
      );
    if (parts.length) deck.push(ko ? `${parts.join(", ")}.` : `${parts.join("; ")}.`);
    const rsi = latest.rsi14;
    if (rsi != null || volRatio != null) {
      deck.push(
        ko
          ? (volRatio != null ? `거래량은 20일 평균의 ${volRatio.toFixed(0)}%${rsi != null ? "이고, " : "다."}` : "") +
            (rsi != null ? `RSI(14)는 ${rsi.toFixed(1)}로 ${rsi >= 70 ? "과열권" : rsi <= 30 ? "침체권" : "중립 구간"}에 있다.` : "")
          : [volRatio != null ? `Volume is ${volRatio.toFixed(0)}% of its 20-day average` : null, rsi != null ? `RSI(14) reads ${rsi.toFixed(1)}, ${rsi >= 70 ? "overbought" : rsi <= 30 ? "oversold" : "neutral"}` : null]
              .filter(Boolean)
              .join("; ") + "."
      );
    }
  }

  if (s.flows.length >= 5) {
    const n = Math.min(20, s.flows.length);
    const sum = (k: "foreign_amount" | "institution_amount" | "individual_amount") => s.flows.slice(0, n).reduce((a, r) => a + r[k], 0);
    const f = sum("foreign_amount");
    const i = sum("institution_amount");
    const p = sum("individual_amount");
    const verb = (v: number) => (ko ? (v >= 0 ? "순매수" : "순매도") : v >= 0 ? "bought" : "sold");
    deck.push(
      ko
        ? `최근 ${n}거래일 동안 외국인은 ${eok(Math.abs(f), s.lang, false)} ${verb(f)}, 기관은 ${eok(Math.abs(i), s.lang, false)} ${verb(i)}, 개인은 ${eok(Math.abs(p), s.lang, false)} ${verb(p)}했다.`
        : `Over ${n} sessions foreigners net ${verb(f)} ${eok(Math.abs(f), s.lang, false)}, institutions ${verb(i)} ${eok(Math.abs(i), s.lang, false)} and individuals ${verb(p)} ${eok(Math.abs(p), s.lang, false)}.`
    );
  }

  if (s.peers) {
    deck.push(
      ko
        ? `${s.peers.sector} 업종 ${s.peers.count}개 종목 가운데 시가총액 ${s.peers.capRank}위이며, 오늘 등락률로는 ${s.peers.moveRank}위다. 업종 평균은 ${pct(s.peers.avg)}였다.`
        : `Among ${s.peers.count} ${s.peers.sector} names it ranks ${s.peers.capRank} by size and ${s.peers.moveRank} on today's move; the sector averaged ${pct(s.peers.avg)}.`
    );
  }

  return { headline, deck };
}
