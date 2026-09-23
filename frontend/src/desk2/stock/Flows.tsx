import { useMemo, useState } from "react";
import type { InvestorTrendRecord } from "../../api/client";
import { useLanguage } from "../../i18n/LanguageContext";
import { Link } from "../../router";
import { eok, toneOf, useL } from "../lib";

/* 투자자별 수급 — who has been buying this stock, and for how long.
 *
 * The classic page printed thirty rows of three numbers. Three questions sit behind
 * that table and none of them could be answered at a glance: which side has been
 * accumulating over the month (the running totals, drawn as three lines), what each
 * day looked like (a diverging bar per investor per day), and whether the latest
 * move is a habit or a one-off (the streak — "외국인 5일 연속 순매수"). The rows are
 * still here, under the chart, for anyone who wants the figures.
 *
 * Amounts are 억원, as investor_fetcher publishes them. */

type Key = "foreign_amount" | "institution_amount" | "individual_amount";
const SIDES: { key: Key; ko: string; en: string; cls: string }[] = [
  { key: "foreign_amount", ko: "외국인", en: "Foreigners", cls: "is-f" },
  { key: "institution_amount", ko: "기관", en: "Institutions", cls: "is-i" },
  { key: "individual_amount", ko: "개인", en: "Individuals", cls: "is-p" },
];

/** Consecutive sessions, newest first, on the same side of zero as the latest one. */
export function streakOf(rows: InvestorTrendRecord[], key: Key): { days: number; buying: boolean } | null {
  if (rows.length === 0 || rows[0][key] === 0) return null;
  const buying = rows[0][key] > 0;
  let days = 0;
  for (const r of rows) {
    if ((buying && r[key] > 0) || (!buying && r[key] < 0)) days += 1;
    else break;
  }
  return { days, buying };
}

export default function Flows({ rows, code }: { rows: InvestorTrendRecord[]; code: string }) {
  const { lang } = useLanguage();
  const L = useL();
  const [days, setDays] = useState<5 | 20 | 30>(20);
  // Newest first from the API; the chart wants oldest first.
  const shown = rows.slice(0, days);
  const chrono = useMemo(() => [...shown].reverse(), [shown]);

  const totals = SIDES.map((s) => ({ ...s, total: shown.reduce((a, r) => a + r[s.key], 0), streak: streakOf(rows, s.key) }));

  // Running sums for the three lines.
  const cum = SIDES.map((s) => {
    let acc = 0;
    return chrono.map((r) => (acc += r[s.key]));
  });
  const all = cum.flat();
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const range = hi - lo || 1;
  const W = 600;
  const H = 180;
  const x = (i: number) => (chrono.length > 1 ? (i / (chrono.length - 1)) * W : W / 2);
  const y = (v: number) => 8 + (1 - (v - lo) / range) * (H - 16);

  const dayMax = Math.max(1, ...shown.flatMap((r) => SIDES.map((s) => Math.abs(r[s.key]))));

  if (rows.length === 0) return <p className="d2-empty">{L("수급 데이터가 없습니다.", "No flow data.")}</p>;

  return (
    <div className="sk-flows">
      <div className="sk-flows-top">
        <div className="sk-seg" role="group" aria-label={L("기간", "Window")}>
          {[5, 20, 30].map((n) => (
            <button key={n} type="button" className={days === n ? "is-on" : ""} aria-pressed={days === n} onClick={() => setDays(n as 5 | 20 | 30)}>
              {n}
              {L("일", "D")}
            </button>
          ))}
        </div>
        <Link to={`/investor/${code}`} className="d2-more">
          {L("수급 추이 전체", "Full flow history")} →
        </Link>
      </div>

      <div className="sk-flows-sum">
        {totals.map((t) => (
          <div key={t.key} className={t.cls}>
            <span>
              <i aria-hidden="true" />
              {L(t.ko, t.en)} {days}
              {L("일 누적", "D total")}
            </span>
            <b className={`d2-num is-${toneOf(t.total)}`}>{eok(t.total, lang)}</b>
            {t.streak && t.streak.days >= 2 ? (
              <em>
                {L(`${t.streak.days}일 연속 ${t.streak.buying ? "순매수" : "순매도"}`, `${t.streak.days} straight days of net ${t.streak.buying ? "buying" : "selling"}`)}
              </em>
            ) : (
              <em className="is-quiet">{L("연속 흐름 없음", "no streak")}</em>
            )}
          </div>
        ))}
      </div>

      <figure className="sk-flows-chart">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={L("투자자별 누적 순매수 추이", "Cumulative net buying by investor")}>
          <line className="sk-zero" x1="0" x2={W} y1={y(0)} y2={y(0)} vectorEffect="non-scaling-stroke" />
          {cum.map((series, i) => (
            <path key={SIDES[i].key} className={`sk-cum ${SIDES[i].cls}`} d={series.map((v, j) => `${j ? "L" : "M"}${x(j).toFixed(1)},${y(v).toFixed(1)}`).join("")} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        <figcaption>
          ▲ {L(`최근 ${days}거래일 누적 순매수(억원). 가로선은 0.`, `Cumulative net buying over ${days} sessions (KRW 100M). The rule is zero.`)}
          <span className="sk-legend">
            {SIDES.map((s) => (
              <i key={s.key} className={s.cls}>
                {L(s.ko, s.en)}
              </i>
            ))}
          </span>
        </figcaption>
      </figure>

      <div className="d2-table-wrap sk-flows-table">
        <table className="d2-table">
          <thead>
            <tr>
              <th className="is-name">{L("일자", "Date")}</th>
              <th>{L("종가", "Close")}</th>
              {SIDES.map((s) => (
                <th key={s.key} colSpan={2}>
                  {L(s.ko, s.en)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.date}>
                <td className="is-name d2-num">{r.date.slice(5).replace("-", ".")}</td>
                <td className="d2-num">{r.close.toLocaleString()}</td>
                {SIDES.map((s) => {
                  const v = r[s.key];
                  const w = (Math.abs(v) / dayMax) * 50;
                  return [
                    <td key={`${s.key}-v`} className={`d2-num is-${toneOf(v)}`}>
                      {eok(v, lang)}
                    </td>,
                    <td key={`${s.key}-b`} className="sk-daybar" aria-hidden="true">
                      <i className="sk-mid" />
                      <i className={`sk-fill is-${toneOf(v)}`} style={v >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
                    </td>,
                  ];
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
