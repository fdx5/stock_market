import { useEffect, useState } from "react";
import { AccuracyWindows, PredictionItem, api } from "../../api/client";
import { Link } from "../../router";
import { Skel } from "../parts";
import { pct, useL } from "../lib";

/* AI 예측 — the site's own next-session forecast for this stock, and its record.
 *
 * The forecasts already exist (the /ai-prediction batch writes one per stock per
 * session) but the stock page never showed them: a reader had to know to go to
 * another page and find the name. Here the latest call sits beside the price with
 * its three probabilities, and directly under it the part that makes a forecast
 * readable at all — how often this model has been right about this stock, and the
 * last ten graded calls as hits and misses. A forecast without its record is a
 * claim; with it, it is information. Hidden entirely for a stock the batch does not
 * cover. */

export default function Forecast({ code }: { code: string }) {
  const L = useL();
  const [items, setItems] = useState<PredictionItem[] | null>(null);
  const [accuracy, setAccuracy] = useState<AccuracyWindows | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    api
      .predictionHistory(code, 12)
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        setAccuracy(r.accuracy);
      })
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (items === null)
    return (
      <aside className="sk-ai">
        <Skel h={16} w="40%" />
        <Skel h={40} />
        <Skel h={60} />
      </aside>
    );
  if (items.length === 0) return null;

  const latest = items[0];
  const graded = items.filter((i) => i.hit !== null).slice(0, 10);
  const date = (d: string) => (d.length === 8 ? `${d.slice(4, 6)}.${d.slice(6)}` : d.slice(5).replace("-", "."));
  const dir = latest.result === "상승" ? "up" : latest.result === "하락" ? "down" : "flat";
  const probs = [
    { key: "up", label: L("상승", "Up"), v: latest.prob_up },
    { key: "flat", label: L("보합", "Flat"), v: latest.prob_flat },
    { key: "down", label: L("하락", "Down"), v: latest.prob_down },
  ].filter((p) => p.v != null) as { key: string; label: string; v: number }[];
  const rate = accuracy?.recent20?.rate ?? accuracy?.all?.rate ?? null;
  const resultEn = latest.result === "상승" ? "Up" : latest.result === "하락" ? "Down" : "Flat";

  return (
    <aside className="sk-ai" aria-labelledby="sk-ai-title">
      <h3 id="sk-ai-title">
        {L("AI 예측", "AI forecast")}
        <small>
          {date(latest.predict_date)} {L("장 예상", "session")}
        </small>
      </h3>
      <div className={`sk-ai-call is-${dir}`}>
        <b>{L(latest.result, resultEn)}</b>
        <span>
          {L("예상가", "Target")} <em className="d2-num">{latest.predict_price.toLocaleString()}</em>
          <em className="d2-num">({pct(latest.change_rate)})</em>
        </span>
      </div>
      {probs.length > 0 && (
        <div className="sk-ai-probs" role="img" aria-label={probs.map((p) => `${p.label} ${p.v}%`).join(", ")}>
          {probs.map((p) => (
            <i key={p.key} className={`is-${p.key}`} style={{ flexGrow: Math.max(p.v, 1) }}>
              {p.v >= 12 && `${p.label} ${p.v}%`}
            </i>
          ))}
        </div>
      )}
      <dl className="sk-ai-facts">
        {latest.confidence && (
          <div>
            <dt>{L("확신도", "Conviction")}</dt>
            <dd>{latest.confidence}</dd>
          </div>
        )}
        {latest.reliability_grade && (
          <div>
            <dt>{L("신뢰도", "Reliability")}</dt>
            <dd>
              {latest.reliability_grade}
              {latest.reliability != null && <small> {latest.reliability}</small>}
            </dd>
          </div>
        )}
        <div>
          <dt>{L("최근 20회 적중", "Hit rate, last 20")}</dt>
          <dd className="d2-num">{rate == null ? "—" : `${rate}%`}</dd>
        </div>
      </dl>
      {graded.length > 0 && (
        <div className="sk-ai-record">
          <span>{L("최근 채점", "Recent calls")}</span>
          <ol>
            {graded.map((g) => (
              <li key={g.predict_date} className={g.hit ? "is-hit" : "is-miss"} title={`${date(g.predict_date)} ${g.result} → ${g.actual_result ?? ""} ${pct(g.actual_change_rate)}`}>
                {g.hit ? "○" : "×"}
              </li>
            ))}
          </ol>
        </div>
      )}
      {latest.evidence.length > 0 && (
        <ul className="sk-ai-evidence">
          {latest.evidence.slice(0, 4).map((e, i) => (
            <li key={i} className={`is-${e.impact}`}>
              <span>{e.label}</span>
              <b>{e.value}</b>
            </li>
          ))}
        </ul>
      )}
      <p className="sk-note">
        {L("기계적 산출값이며 투자 권유가 아닙니다.", "A mechanical estimate, not advice.")}{" "}
        <Link to="/ai-prediction" className="d2-more">
          {L("AI 예측 전체", "All forecasts")} →
        </Link>
      </p>
    </aside>
  );
}
