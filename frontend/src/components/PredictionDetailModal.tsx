import { useEffect, useState } from "react";
import { AccuracyWindows, PredictionItem, api } from "../api/client";
import {
  RELIABILITY_CLASS,
  RESULT_ARROW,
  RESULT_CLASS,
  accuracyTone,
  formatChangeRate,
  formatFullDate,
  formatMoney,
  isKrxCode,
  likeliest,
  scoreWidthPct,
  sortEvidence,
  usLogoUrl,
} from "../prediction";
import { Link } from "../router";
import { useBodyScrollLock } from "../useBodyScrollLock";
import PredictionProbabilityBar from "./PredictionProbabilityBar";
import StockIcon from "./StockIcon";

/** Past calls for this stock with the outcome of each, plus the hit rate over three
 * windows. This is the page's evidence that the forecasts are worth reading — it is a
 * table rather than a chart on purpose, because "예측 상승 / 실제 하락" is a comparison a
 * reader has to be able to make row by row, not squint at. */
function TrackRecord({ code, currentDate }: { code: string; currentDate: string }) {
  const [rows, setRows] = useState<PredictionItem[] | null>(null);
  const [accuracy, setAccuracy] = useState<AccuracyWindows | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    api
      .predictionHistory(code, 20)
      .then((res) => {
        if (cancelled) return;
        setRows(res.items);
        setAccuracy(res.accuracy);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || "예측 이력을 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) return <p className="pred-modal-empty">{error}</p>;
  if (!rows) return <p className="pred-modal-empty">이력을 불러오는 중...</p>;

  const past = rows.filter((r) => r.predict_date !== currentDate);

  return (
    <>
      <div className="pred-acc-row">
        {[
          { label: "최근 20거래일", window: accuracy?.recent20 },
          { label: "최근 60거래일", window: accuracy?.recent60 },
          { label: "전체", window: accuracy?.all },
        ].map((w) => (
          <div key={w.label} className={`pred-acc-tile pred-acc-tile--${accuracyTone(w.window)}`}>
            <span className="pred-acc-label">{w.label}</span>
            <span className="pred-acc-value">{w.window?.rate !== null && w.window ? `${w.window.rate}%` : "―"}</span>
            <span className="pred-acc-hint">
              {w.window && w.window.total > 0 ? `${w.window.hit}/${w.window.total} 적중` : "채점된 예측 없음"}
            </span>
          </div>
        ))}
      </div>

      {past.length === 0 ? (
        <p className="pred-modal-empty">아직 이 종목의 지난 예측 기록이 없습니다.</p>
      ) : (
        <div className="pred-history-scroll">
          <table className="pred-history">
            <caption className="sr-only">{code} 지난 예측과 실제 결과 비교</caption>
            <thead>
              <tr>
                <th scope="col">예측일자</th>
                <th scope="col">예측</th>
                <th scope="col">예상 등락</th>
                <th scope="col">실제</th>
                <th scope="col">실제 등락</th>
                <th scope="col">결과</th>
              </tr>
            </thead>
            <tbody>
              {past.map((row) => (
                <tr key={row.predict_date} className={row.hit === null ? "" : row.hit ? "is-hit" : "is-miss"}>
                  <td>{formatFullDate(row.predict_date)}</td>
                  <td className={`pred-history-result pred-history-result--${RESULT_CLASS[row.result]}`}>
                    {row.result}
                  </td>
                  <td className={`pred-history-num pred-history-result--${RESULT_CLASS[row.result]}`}>
                    {formatChangeRate(row.change_rate)}
                  </td>
                  <td
                    className={`pred-history-result${
                      row.actual_result ? ` pred-history-result--${RESULT_CLASS[row.actual_result]}` : ""
                    }`}
                  >
                    {row.actual_result ?? "―"}
                  </td>
                  <td className="pred-history-num">
                    {row.actual_change_rate !== null ? formatChangeRate(row.actual_change_rate) : "―"}
                  </td>
                  <td>
                    {row.hit === null ? (
                      // Not a miss — the session it predicts either hasn't traded yet or
                      // hasn't been graded. Rendering it as ✕ would understate every
                      // stock's record by however many rows are still open.
                      <span className="pred-history-pending">채점 전</span>
                    ) : (
                      <span className={`pred-history-mark pred-history-mark--${row.hit ? "hit" : "miss"}`}>
                        {row.hit ? "✓ 적중" : "✕ 빗나감"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function PredictionDetailModal({
  item,
  onClose,
}: {
  item: PredictionItem;
  onClose: () => void;
}) {
  useBodyScrollLock(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tone = RESULT_CLASS[item.result];
  const logo = usLogoUrl(item.code);
  // KRX names have a detail page on this site; US tickers live on the global page.
  const detailHref = isKrxCode(item.code) ? `/?code=${item.code}` : `/global?code=${item.code}`;
  const evidence = sortEvidence(item.evidence);
  const top = likeliest(item);

  return (
    <div className="pred-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className={`pred-modal pred-modal--${tone}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${item.name} AI 예측 상세`}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="pred-modal-close" onClick={onClose} aria-label="닫기">
          ×
        </button>

        <header className="pred-modal-head">
          <span className="pred-modal-logo">
            {isKrxCode(item.code) ? (
              <StockIcon code={item.code} className="pred-card-logo-img" />
            ) : logo ? (
              <img src={logo} alt="" className="pred-card-logo-img" />
            ) : (
              <span className="pred-card-logo-mono">{item.name.slice(0, 2)}</span>
            )}
          </span>
          <span className="pred-modal-id">
            <strong>{item.name}</strong>
            <span className="pred-modal-sub">
              {item.code} · {item.market}
            </span>
          </span>
          <span className={`pred-verdict pred-verdict--${tone}`}>
            <span className="pred-verdict-arrow" aria-hidden="true">
              {RESULT_ARROW[item.result]}
            </span>
            {item.result}
          </span>
        </header>

        <dl className="pred-modal-figures">
          <div>
            <dt>기준 종가</dt>
            <dd>{formatMoney(item.base_price, item.market)}</dd>
          </div>
          <div>
            <dt>예측 시세</dt>
            <dd className={`pred-modal-figure--${tone}`}>{formatMoney(item.predict_price, item.market)}</dd>
          </div>
          <div>
            <dt>예상 등락률</dt>
            <dd className={`pred-modal-figure--${tone}`}>{formatChangeRate(item.change_rate)}</dd>
          </div>
          {item.hit === null ? (
            <div>
              <dt>확신도</dt>
              <dd>
                {item.confidence} (종합점수 {item.score > 0 ? "+" : ""}
                {item.score.toFixed(2)})
              </dd>
            </div>
          ) : (
            <div>
              <dt>실제 결과</dt>
              <dd className={item.hit ? "pred-modal-figure--hit" : "pred-modal-figure--miss"}>
                {item.actual_result ?? "확인 불가"}
                {item.actual_change_rate !== null ? ` ${formatChangeRate(item.actual_change_rate)}` : ""}
                <span className="pred-modal-figure-tag">{item.hit ? "적중" : "빗나감"}</span>
              </dd>
            </div>
          )}
        </dl>

        {item.prob_up !== null ? (
          <section className="pred-modal-section">
            <h3>익일 방향 확률</h3>
            <PredictionProbabilityBar item={item} />
            <p className="pred-modal-note">
              종가 대비 ±{item.flat_band?.toFixed(2) ?? "0.40"}% 이내는 보합으로 계산합니다. 이 밴드는 종목의
              20일 변동성에서 산출되며, 나중에 실제 결과를 채점할 때도 같은 기준을 씁니다.
              {top && top !== item.result
                ? ` 예상 등락률(${formatChangeRate(item.change_rate)})은 보합 밴드 안이지만 분포상으로는 ${top} 확률이 가장 높습니다.`
                : ""}
            </p>
          </section>
        ) : null}

        {item.reliability !== null ? (
          <section className="pred-modal-section">
            <h3>
              예측 신뢰도
              <span
                className={`pred-chip pred-chip--reliability pred-chip--${
                  RELIABILITY_CLASS[item.reliability_grade ?? "보통"]
                }`}
              >
                {item.reliability_grade} <b>{item.reliability}</b>
              </span>
            </h3>
            <div className="pred-reliability-track">
              <span
                className={`pred-reliability-fill pred-reliability-fill--${
                  RELIABILITY_CLASS[item.reliability_grade ?? "보통"]
                }`}
                style={{ width: `${item.reliability}%` }}
                aria-hidden="true"
              />
            </div>
            <ul className="pred-reliability-notes">
              {item.reliability_notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            <p className="pred-modal-note">
              확신도가 <em>지표가 얼마나 한쪽으로 쏠렸는가</em>라면, 신뢰도는 <em>그 지표를 얼마나 믿을 수
              있는가</em>입니다. 신뢰도가 낮을수록 위 확률 분포도 더 넓게(33/33/33에 가깝게) 계산됩니다.
            </p>
          </section>
        ) : null}

        {item.close_summary ? (
          <section className="pred-modal-section">
            <h3>
              장 마감 설명
              {item.close_change_rate !== null ? (
                <span
                  className={`pred-chip pred-chip--${
                    item.close_change_rate > 0 ? "up" : item.close_change_rate < 0 ? "down" : "flat"
                  }`}
                >
                  {formatFullDate(item.collect_date)} {formatChangeRate(item.close_change_rate)}
                </span>
              ) : null}
            </h3>
            <p className="pred-modal-detail">{item.close_summary}</p>
          </section>
        ) : null}

        {evidence.length ? (
          <section className="pred-modal-section">
            <h3>근거 데이터</h3>
            <ul className="pred-evidence">
              {evidence.map((entry, i) => (
                <li key={`${entry.category}-${i}`} className={`pred-evidence-item pred-evidence-item--${entry.impact}`}>
                  <span className="pred-evidence-cat">{entry.category}</span>
                  <span className="pred-evidence-body">
                    <span className="pred-evidence-label">{entry.label}</span>
                    <span className="pred-evidence-value">{entry.value}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="pred-modal-note">
              실제 판단에 사용된 항목만 표시합니다. 수집되지 않은 데이터는 목록에 나타나지 않고, 그 사실은 위
              신뢰도 사유에 기록됩니다.
            </p>
          </section>
        ) : null}

        <section className="pred-modal-section">
          <h3>AI 판단 근거</h3>
          <p className="pred-modal-detail">{item.detail}</p>
          <div className="pred-modal-gauge">
            <span className="pred-gauge-track">
              <span className="pred-gauge-zero" aria-hidden="true" />
              <span
                className={`pred-gauge-fill pred-gauge-fill--${tone}`}
                style={{ width: `${scoreWidthPct(item.score) / 2}%`, [item.score >= 0 ? "left" : "right"]: "50%" }}
                aria-hidden="true"
              />
            </span>
            <span className="pred-modal-gauge-axis">
              <span>-1.0 하락</span>
              <span>종합점수 {item.score > 0 ? "+" : ""}{item.score.toFixed(2)} · 확신도 {item.confidence}</span>
              <span>상승 +1.0</span>
            </span>
          </div>
          <p className="pred-modal-meta">
            수집일자 {formatFullDate(item.collect_date)} · 예측일자 {formatFullDate(item.predict_date)}
          </p>
        </section>

        <section className="pred-modal-section">
          <h3>예측 정확도와 지난 기록</h3>
          <TrackRecord code={item.code} currentDate={item.predict_date} />
        </section>

        <footer className="pred-modal-foot">
          <Link to={detailHref} className="pred-modal-link">
            {item.name} 상세 차트 보기 <span aria-hidden="true">›</span>
          </Link>
          <p className="pred-modal-disclaimer">
            본 예측은 공개된 시세·지표·언론 데이터에 기반한 AI의 통계적 추정이며, 투자 자문이나 매매 권유가
            아닙니다. 투자 판단과 그 결과에 대한 책임은 투자자 본인에게 있습니다.
          </p>
        </footer>
      </div>
    </div>
  );
}
