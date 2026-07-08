import { useEffect, useState } from "react";
import { StockSearchResult, Top100PredictionItem, api } from "../api/client";
import { Link } from "../router";

function directionClass(direction: Top100PredictionItem["direction"]): string {
  if (direction === "상승") return "up";
  if (direction === "하락") return "down";
  return "flat";
}

function directionArrow(direction: Top100PredictionItem["direction"]): string {
  if (direction === "상승") return "▲";
  if (direction === "하락") return "▼";
  return "―";
}

export default function Top100PredictionPanel({
  onSelectStock,
}: {
  onSelectStock: (stock: StockSearchResult) => void;
}) {
  const [date, setDate] = useState<string | null>(null);
  const [items, setItems] = useState<Top100PredictionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .top100Predictions()
      .then((res) => {
        if (cancelled) return;
        setDate(res.date);
        setItems(res.items);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || "예측 목록을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="card top100-panel">
      <div className="top100-header">
        <h2>코스피 시총 100위 장전 예측</h2>
        {date && <span className="top100-date">{date} 종가 기준</span>}
      </div>
      <p className="top100-subtitle">
        전일 종가까지의 데이터로 산출한 다음 거래일 방향성입니다. 종목명을 누르면 예측 결과를 바로 조회하고, 신뢰도 옆
        이력 버튼을 누르면 예측 적중 이력으로 이동합니다.
      </p>

      {loading && <div className="loading-state">예측 목록을 생성하는 중입니다. 첫 로딩은 다소 걸릴 수 있어요...</div>}
      {error && <div className="error-state">{error}</div>}

      {!loading && !error && (
        <div className="top100-table-wrap">
          <table className="top100-table">
            <thead>
              <tr>
                <th className="col-rank">#</th>
                <th className="col-name">종목명</th>
                <th className="col-price">기준가</th>
                <th className="col-direction">예측</th>
                <th className="col-confidence">신뢰도</th>
                <th className="col-history">이력</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.code}>
                  <td className="col-rank">{item.rank}</td>
                  <td className="col-name">
                    <button
                      type="button"
                      className="top100-name-link"
                      onClick={() => onSelectStock({ code: item.code, name: item.name, market: "KOSPI" })}
                    >
                      {item.name}
                    </button>
                    <span className="top100-code">{item.code}</span>
                  </td>
                  <td className="col-price">{item.last_close.toLocaleString()}원</td>
                  <td className="col-direction">
                    <span className={`direction-badge ${directionClass(item.direction)}`}>
                      {directionArrow(item.direction)} {item.direction}
                    </span>
                  </td>
                  <td className="col-confidence">{item.confidence}</td>
                  <td className="col-history">
                    <Link to={`/predictions/${item.code}`} className="top100-history-btn">
                      이력 보기
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
