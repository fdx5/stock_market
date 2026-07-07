import { useEffect, useState } from "react";
import { PredictionHistoryRecord, api } from "../api/client";
import { Link } from "../router";

function directionLabel(direction: PredictionHistoryRecord["predicted_direction"] | null): string {
  if (!direction) return "-";
  if (direction === "상승") return "▲ 상승";
  if (direction === "하락") return "▼ 하락";
  return "― 보합";
}

function resultRowClass(record: PredictionHistoryRecord): string {
  if (record.correct === null) return "pending";
  return record.correct ? "correct" : "incorrect";
}

function resultLabel(record: PredictionHistoryRecord): string {
  if (record.correct === null) return "결과 대기";
  return record.correct ? "적중" : "실패";
}

export default function PredictionHistoryPage({ code }: { code: string }) {
  const [name, setName] = useState<string>("");
  const [records, setRecords] = useState<PredictionHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .predictionHistory(code)
      .then((res) => {
        if (cancelled) return;
        setName(res.name);
        setRecords(res.records);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || "예측 이력을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  const gradedCount = records.filter((r) => r.correct !== null).length;
  const correctCount = records.filter((r) => r.correct === true).length;
  const accuracyPct = gradedCount > 0 ? Math.round((correctCount / gradedCount) * 100) : null;

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="back-link">
          ← 메인으로
        </Link>
        <div>
          <h1 className="app-title">
            {name || code} 예측 적중 이력 <span className="app-title-code">{code}</span>
          </h1>
          <p className="app-subtitle">
            날짜별 장전 예측(전일 종가 기준)과 해당일 실제 등락 방향을 비교합니다. 적중은 녹색, 실패는 빨간색으로
            표시됩니다.
          </p>
        </div>
      </header>

      {loading && <div className="loading-state">불러오는 중...</div>}
      {error && <div className="error-state">{error}</div>}

      {!loading && !error && (
        <>
          {accuracyPct !== null && (
            <div className="card accuracy-summary">
              <span className="accuracy-value">{accuracyPct}%</span>
              <span className="accuracy-label">
                적중률 ({correctCount}/{gradedCount}건, 결과 대기 {records.length - gradedCount}건)
              </span>
            </div>
          )}

          {records.length === 0 && <div className="empty-state">아직 기록된 예측 이력이 없습니다.</div>}

          {records.length > 0 && (
            <div className="history-table-wrap card">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>예측 방향</th>
                    <th>신뢰도</th>
                    <th>실제 방향</th>
                    <th>등락률</th>
                    <th>결과</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.date} className={`history-row ${resultRowClass(record)}`}>
                      <td>{record.date}</td>
                      <td>{directionLabel(record.predicted_direction)}</td>
                      <td>{record.confidence ?? "-"}</td>
                      <td>{directionLabel(record.actual_direction)}</td>
                      <td>{record.actual_change_pct !== null ? `${record.actual_change_pct}%` : "-"}</td>
                      <td className="history-result-cell">{resultLabel(record)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
