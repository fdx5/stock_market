import { useEffect, useMemo, useState } from "react";
import { AccuracyWindow, AccuracyWindows, PredictionItem, api } from "../../api/client";
import StockLogo from "../../components/StockLogo";
import {
  RESULT_ARROW,
  RESULT_CLASS,
  formatChangeRate,
  formatFullDate,
  formatMoney,
  likeliest,
  probabilities,
  sortEvidence,
} from "../../prediction";
import { Link } from "../../router";
import { useBodyScrollLock } from "../../useBodyScrollLock";
import { useL } from "../lib";

/* The pieces the 예보면 and the 채점표 share: the three-way probability bar, the
 * verdict mark, and the reader a call opens into. Both pages open the same reader
 * so a call reads the same wherever it was clicked. */

export const MARKET_KO: Record<string, string> = { KOSPI: "코스피", KOSDAQ: "코스닥", NASDAQ: "나스닥" };
export const MARKET_EN: Record<string, string> = { KOSPI: "KOSPI", KOSDAQ: "KOSDAQ", NASDAQ: "NASDAQ" };
export const MARKET_ORDER = ["KOSPI", "KOSDAQ", "NASDAQ"];

export type Dir = "up" | "down" | "flat";
export const dirOf = (result: PredictionItem["result"]): Dir => RESULT_CLASS[result] as Dir;

/** "20260923" → "9.23" — the short form a dateline column can hold. */
export function shortDate(key: string): string {
  if (!/^\d{8}$/.test(key)) return key;
  return `${Number(key.slice(4, 6))}.${Number(key.slice(6, 8))}`;
}

/** Three shares of one whole, drawn as one bar and printed under it. A row written
 * before the probability model shipped has no shares, and says so instead of drawing
 * a confident zero. */
export function ProbBar({ item, labels = true }: { item: PredictionItem; labels?: boolean }) {
  const L = useL();
  const p = probabilities(item);
  if (!p) return <p className="fc-prob is-none">{L("확률 기록 없음", "No probabilities on file")}</p>;
  return (
    <div className="fc-prob" role="img" aria-label={L(`상승 ${p.up}%, 보합 ${p.flat}%, 하락 ${p.down}%`, `Up ${p.up}%, flat ${p.flat}%, down ${p.down}%`)}>
      <span className="fc-prob-bar" aria-hidden="true">
        <i className="is-up" style={{ width: `${p.up}%` }} />
        <i className="is-flat" style={{ width: `${p.flat}%` }} />
        <i className="is-down" style={{ width: `${p.down}%` }} />
      </span>
      {labels && (
        <span className="fc-prob-read" aria-hidden="true">
          <span className="is-up">
            {L("상승", "Up")} <b>{p.up}</b>
          </span>
          <span className="is-flat">
            {L("보합", "Flat")} <b>{p.flat}</b>
          </span>
          <span className="is-down">
            {L("하락", "Down")} <b>{p.down}</b>
          </span>
        </span>
      )}
    </div>
  );
}

export function Verdict({ result, size = "md" }: { result: PredictionItem["result"]; size?: "md" | "lg" }) {
  const L = useL();
  const d = dirOf(result);
  const label = result === "상승" ? L("상승", "Up") : result === "하락" ? L("하락", "Down") : L("보합", "Flat");
  return (
    <span className={`fc-verdict is-${d} fc-verdict--${size}`}>
      <i aria-hidden="true">{RESULT_ARROW[result]}</i>
      {label}
    </span>
  );
}

/** A graded call's stamp — 적중 or 빗나감, set like a rubber stamp in the margin.
 * An ungraded call gets nothing: there is no verdict to stamp yet. */
export function Stamp({ hit }: { hit: boolean | null }) {
  const L = useL();
  if (hit === null) return null;
  return <span className={`fc-stamp ${hit ? "is-hit" : "is-miss"}`}>{hit ? L("적중", "Hit") : L("빗나감", "Miss")}</span>;
}

/** A hit rate as good / fair / bad. Its own classes, not up/down: a 36% record is
 * poor, not "falling", and must not wear the market's red or blue. */
export function grade(w: { rate: number | null } | undefined | null): "good" | "fair" | "bad" | "none" {
  if (!w || w.rate === null) return "none";
  return w.rate >= 60 ? "good" : w.rate < 40 ? "bad" : "fair";
}

function rateText(w: AccuracyWindow | undefined | null): string {
  return w && w.rate !== null ? `${w.rate}%` : "—";
}

/** A stock's past calls against what happened, and its hit rate over three windows. */
function TrackRecord({ code, currentDate }: { code: string; currentDate: string }) {
  const L = useL();
  const [rows, setRows] = useState<PredictionItem[] | null>(null);
  const [accuracy, setAccuracy] = useState<AccuracyWindows | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError("");
    api
      .predictionHistory(code, 20)
      .then((res) => {
        if (cancelled) return;
        setRows(res.items);
        setAccuracy(res.accuracy);
      })
      .catch((e: Error) => !cancelled && setError(e.message || L("예측 이력을 불러오지 못했습니다.", "Could not load the record.")));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (error) return <p className="d2-empty">{error}</p>;
  if (!rows) return <p className="d2-empty">{L("이력을 불러오는 중…", "Loading the record…")}</p>;
  const past = rows.filter((r) => r.predict_date !== currentDate);

  return (
    <>
      <dl className="fc-windows">
        {[
          { ko: "최근 20거래일", en: "Last 20", w: accuracy?.recent20 },
          { ko: "최근 60거래일", en: "Last 60", w: accuracy?.recent60 },
          { ko: "전체", en: "All", w: accuracy?.all },
        ].map((x) => (
          <div key={x.ko} className={`is-${grade(x.w)}`}>
            <dt>{L(x.ko, x.en)}</dt>
            <dd>{rateText(x.w)}</dd>
            <small>{x.w && x.w.total > 0 ? `${x.w.hit}/${x.w.total}` : L("채점 전", "none yet")}</small>
          </div>
        ))}
      </dl>
      {past.length === 0 ? (
        <p className="d2-empty">{L("아직 이 종목의 지난 예측 기록이 없습니다.", "No earlier calls for this name yet.")}</p>
      ) : (
        <div className="fc-history">
          <table className="d2-table">
            <caption className="sr-only">{L("지난 예측과 실제 결과", "Past calls against outcomes")}</caption>
            <thead>
              <tr>
                <th className="is-name">{L("예측일", "Session")}</th>
                <th>{L("예측", "Call")}</th>
                <th>{L("예상", "Expected")}</th>
                <th>{L("실제", "Actual")}</th>
                <th>{L("실제 등락", "Actual move")}</th>
                <th>{L("결과", "Result")}</th>
              </tr>
            </thead>
            <tbody>
              {past.map((r) => (
                <tr key={r.predict_date} className={r.hit === null ? "" : r.hit ? "is-hit" : "is-miss"}>
                  <td className="is-name">{shortDate(r.predict_date)}</td>
                  <td className={`is-${dirOf(r.result)}`}>{r.result}</td>
                  <td className={`is-${dirOf(r.result)}`}>{formatChangeRate(r.change_rate)}</td>
                  <td className={r.actual_result ? `is-${dirOf(r.actual_result)}` : ""}>{r.actual_result ?? "—"}</td>
                  <td>{r.actual_change_rate !== null ? formatChangeRate(r.actual_change_rate) : "—"}</td>
                  <td>{r.hit === null ? <span className="d2-muted">{L("채점 전", "Pending")}</span> : <Stamp hit={r.hit} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** A call opened in full: the numbers, the distribution and what the band means,
 * how far the inputs can be trusted, why the stock closed where it did, the evidence
 * line by line, the model's own reasoning with its score, and the stock's record.
 * ← / → walk to the neighbouring call in whatever list opened it. */
export function ForecastReader({
  item,
  onClose,
  onStep,
}: {
  item: PredictionItem;
  onClose: () => void;
  /** -1 / +1 to the previous / next call in the opener's order; absent when the
   * opener has no order to walk (the matrix, where a click is one cell). */
  onStep?: (delta: -1 | 1) => void;
}) {
  const L = useL();
  useBodyScrollLock(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (onStep && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        onStep(e.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onStep]);

  const d = dirOf(item.result);
  const evidence = useMemo(() => sortEvidence(item.evidence), [item.evidence]);
  const top = likeliest(item);
  const scoreW = Math.max(2, Math.min(100, Math.abs(item.score) * 100)) / 2;
  const krx = item.market === "KOSPI" || item.market === "KOSDAQ";

  return (
    <div className="d2-find-scrim fc-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <article className={`d2-find fc-reader is-${d}`} role="dialog" aria-modal="true" aria-label={L(`${item.name} AI 예측 상세`, `${item.name} forecast`)}>
        <header className="fc-reader-head">
          <StockLogo code={item.code} name={item.name} className="fc-logo" />
          <span>
            <small>
              {MARKET_KO[item.market] ?? item.market} · {item.code} · {L("예측일", "for")} {formatFullDate(item.predict_date)}
            </small>
            <h2>{item.name}</h2>
          </span>
          {onStep && (
            <span className="fc-reader-step">
              <button type="button" onClick={() => onStep(-1)} aria-label={L("이전 종목", "Previous")}>
                ‹
              </button>
              <button type="button" onClick={() => onStep(1)} aria-label={L("다음 종목", "Next")}>
                ›
              </button>
            </span>
          )}
          <button type="button" className="st-sheet-close" onClick={onClose} aria-label={L("닫기", "Close")}>
            ×
          </button>
        </header>

        <div className="fc-reader-body">
          <section className="fc-reader-call">
            <Verdict result={item.result} size="lg" />
            <dl>
              <div>
                <dt>{L("기준 종가", "Base close")}</dt>
                <dd>{formatMoney(item.base_price, item.market)}</dd>
              </div>
              <div>
                <dt>{L("예측 시세", "Forecast")}</dt>
                <dd className={`is-${d}`}>{formatMoney(item.predict_price, item.market)}</dd>
              </div>
              <div>
                <dt>{L("예상 등락률", "Expected")}</dt>
                <dd className={`is-${d}`}>{formatChangeRate(item.change_rate)}</dd>
              </div>
              {item.hit === null ? (
                <div>
                  <dt>{L("확신도", "Conviction")}</dt>
                  <dd>
                    {item.confidence} <small>({item.score > 0 ? "+" : ""}{item.score.toFixed(2)})</small>
                  </dd>
                </div>
              ) : (
                <div>
                  <dt>{L("실제 결과", "Outcome")}</dt>
                  <dd className={item.actual_result ? `is-${dirOf(item.actual_result)}` : ""}>
                    {item.actual_result ?? L("확인 불가", "n/a")}
                    {item.actual_change_rate !== null ? ` ${formatChangeRate(item.actual_change_rate)}` : ""} <Stamp hit={item.hit} />
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {item.prob_up !== null && (
            <section className="fc-reader-sec">
              <h3>{L("다음 거래일 방향 확률", "Next-session odds")}</h3>
              <ProbBar item={item} />
              <p className="fc-note">
                {L(
                  `종가 대비 ±${item.flat_band?.toFixed(2) ?? "0.40"}% 안쪽은 보합으로 셉니다. 이 폭은 종목의 20일 변동성에서 나오며, 채점할 때도 같은 기준을 씁니다.`,
                  `Moves inside ±${item.flat_band?.toFixed(2) ?? "0.40"}% count as flat. The band comes from the stock's 20-day volatility and is the same one the grade uses.`
                )}
                {top && top !== item.result
                  ? L(
                      ` 예상 등락률은 보합 폭 안쪽이지만, 분포에서 가장 큰 쪽은 ${top}입니다.`,
                      ` The expected move sits inside the band, but the largest share of the distribution is ${top === "상승" ? "up" : top === "하락" ? "down" : "flat"}.`
                    )
                  : ""}
              </p>
            </section>
          )}

          {item.reliability !== null && (
            <section className="fc-reader-sec">
              <h3>
                {L("예측 신뢰도", "Reliability")} <b className={`fc-rel is-${item.reliability_grade === "높음" ? "high" : item.reliability_grade === "낮음" ? "low" : "mid"}`}>{item.reliability_grade} {item.reliability}</b>
              </h3>
              <span className="fc-meter" aria-hidden="true">
                <i style={{ width: `${item.reliability}%` }} />
              </span>
              {item.reliability_notes.length > 0 && (
                <ul className="fc-notes">
                  {item.reliability_notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
              <p className="fc-note">
                {L(
                  "확신도가 지표가 한쪽으로 얼마나 쏠렸는가라면, 신뢰도는 그 지표를 얼마나 믿을 수 있는가입니다. 신뢰도가 낮을수록 확률 분포는 33/33/33 쪽으로 넓어집니다.",
                  "Conviction is how hard the inputs lean; reliability is how far they can be trusted. The lower it is, the closer the odds are pulled toward a three-way split."
                )}
              </p>
            </section>
          )}

          {item.close_summary && (
            <section className="fc-reader-sec">
              <h3>
                {L("장 마감 설명", "Why it closed there")}
                {item.close_change_rate !== null && (
                  <b className={`d2-num is-${item.close_change_rate > 0 ? "up" : item.close_change_rate < 0 ? "down" : "flat"}`}>
                    {shortDate(item.collect_date)} {formatChangeRate(item.close_change_rate)}
                  </b>
                )}
              </h3>
              <p className="fc-copy">{item.close_summary}</p>
            </section>
          )}

          {evidence.length > 0 && (
            <section className="fc-reader-sec">
              <h3>
                {L("근거 데이터", "Evidence")} <small>{evidence.length}</small>
              </h3>
              <ul className="fc-evidence">
                {evidence.map((e, i) => (
                  <li key={`${e.category}-${i}`} className={`is-${e.impact}`}>
                    <span>{e.category}</span>
                    <b>{e.label}</b>
                    <em>{e.value}</em>
                  </li>
                ))}
              </ul>
              <p className="fc-note">
                {L(
                  "판단에 실제로 쓰인 항목만 싣습니다. 수집하지 못한 데이터는 여기 없고, 그 사실은 신뢰도 사유에 적힙니다.",
                  "Only inputs the call actually used are listed; anything that could not be collected is noted under reliability instead."
                )}
              </p>
            </section>
          )}

          <section className="fc-reader-sec">
            <h3>{L("AI 판단 근거", "The model's reasoning")}</h3>
            <p className="fc-copy">{item.detail}</p>
            <div className="fc-gauge">
              <span className="fc-gauge-track" aria-hidden="true">
                <i className={`is-${d}`} style={{ width: `${scoreW}%`, [item.score >= 0 ? "left" : "right"]: "50%" }} />
              </span>
              <span className="fc-gauge-axis">
                <span>−1.0 {L("하락", "down")}</span>
                <b>
                  {L("종합점수", "Score")} {item.score > 0 ? "+" : ""}
                  {item.score.toFixed(2)} · {L("확신도", "conviction")} {item.confidence}
                </b>
                <span>{L("상승", "up")} +1.0</span>
              </span>
            </div>
            <p className="fc-dateline">
              {L("수집일", "Computed from")} {formatFullDate(item.collect_date)} · {L("예측일", "for")} {formatFullDate(item.predict_date)}
            </p>
          </section>

          <section className="fc-reader-sec">
            <h3>{L("이 종목의 적중 기록", "This stock's record")}</h3>
            <TrackRecord code={item.code} currentDate={item.predict_date} />
          </section>

          <footer className="fc-reader-foot">
            <Link to={krx ? `/stock/${item.code}` : `/stock/${encodeURIComponent(item.code)}`} className="d2-more">
              {L(`${item.name} 종목면 보기`, `Open ${item.name}`)} →
            </Link>
            <p className="sk-disclaimer">
              {L(
                "이 예측은 공개된 시세·지표·언론 데이터에 기반한 AI의 통계적 추정이며 투자 자문이나 매매 권유가 아닙니다. 투자 판단과 그 결과의 책임은 투자자 본인에게 있습니다.",
                "A statistical estimate from public prices, indicators and news — not investment advice. Decisions and their outcomes are the investor's own."
              )}
            </p>
          </footer>
        </div>
      </article>
    </div>
  );
}
