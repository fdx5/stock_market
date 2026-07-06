import type { PredictionResult } from "../api/client";

function directionClass(direction: PredictionResult["direction"]): string {
  if (direction === "상승") return "up";
  if (direction === "하락") return "down";
  return "flat";
}

function directionArrow(direction: PredictionResult["direction"]): string {
  if (direction === "상승") return "▲";
  if (direction === "하락") return "▼";
  return "―";
}

export default function PredictionCard({ prediction }: { prediction: PredictionResult }) {
  const cls = directionClass(prediction.direction);

  return (
    <div className="card prediction-card">
      <div className="prediction-top">
        <span className={`direction-badge ${cls}`}>
          {directionArrow(prediction.direction)} 다음날 예상: {prediction.direction}
        </span>
        <span className="confidence-tag">신뢰도 {prediction.confidence}</span>
      </div>

      <div className="predicted-range">
        예상 범위{" "}
        <strong>
          {prediction.predicted_range.low.toLocaleString()}원 ~{" "}
          {prediction.predicted_range.high.toLocaleString()}원
        </strong>
        {" · "}기준가 {prediction.last_close.toLocaleString()}원 · 예상 중심가{" "}
        {prediction.predicted_price.toLocaleString()}원
      </div>

      <ul className="reasoning-list">
        {prediction.reasoning.map((reason, idx) => (
          <li key={idx}>{reason}</li>
        ))}
      </ul>

      <div className="outlook-block">
        <div>
          <span className="label">단기 전망(1주)</span>
          {prediction.outlook.short_term}
        </div>
        <div style={{ marginTop: 6 }}>
          <span className="label">중기 전망(1개월)</span>
          {prediction.outlook.mid_term}
        </div>
      </div>

      <div className="disclaimer">{prediction.disclaimer}</div>
    </div>
  );
}
