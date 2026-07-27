import { useEffect, useMemo, useState } from "react";
import { GradingMatrixResponse, api } from "../api/client";
import { formatChangeRate } from "../prediction";
import { Link } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import DashboardIcon from "./DashboardIcon";
import Footer from "./Footer";
import LanguageToggle from "./LanguageToggle";
import Logo from "./Logo";
import ThemeToggle from "./ThemeToggle";

const MARKET_TABS = [
  { key: "ALL", label: "전체" },
  { key: "KOSPI", label: "코스피" },
  { key: "KOSDAQ", label: "코스닥" },
  { key: "NASDAQ", label: "나스닥" },
];

const LIMIT_OPTIONS = [20, 40, 60];

/** "20260727" -> "7/27" — the matrix header needs a column label narrow enough that
 * 20-60 of them still fit across a screen; the full "2026년 7월 27일" the rest of the
 * page uses would blow the column width out immediately. */
function shortDateLabel(dateKey: string): string {
  if (!/^\d{8}$/.test(dateKey)) return dateKey;
  return `${Number(dateKey.slice(4, 6))}/${Number(dateKey.slice(6, 8))}`;
}

/** One matrix cell: a small tile whose fill says hit/miss/pending and whose tooltip
 * carries the actual numbers, so the grid stays scannable as a shape while the detail
 * is still one hover away. */
function MatrixCell({ cell }: { cell: GradingMatrixResponse["rows"][number]["cells"][string] | undefined }) {
  if (!cell) {
    return <td className="pred-matrix-cell pred-matrix-cell--empty" aria-label="예측 없음" />;
  }
  const state = cell.hit === null ? "pending" : cell.hit ? "hit" : "miss";
  const title =
    cell.hit === null
      ? `예측 ${cell.result} (${formatChangeRate(cell.change_rate)}) · 채점 대기`
      : `예측 ${cell.result} (${formatChangeRate(cell.change_rate)}) → 실제 ${cell.actual_result} (${formatChangeRate(
          cell.actual_change_rate ?? 0
        )}) · ${cell.hit ? "적중" : "실패"}`;
  return (
    <td className={`pred-matrix-cell pred-matrix-cell--${state}`} title={title}>
      <span className="pred-matrix-mark" aria-hidden="true">
        {state === "pending" ? "···" : state === "hit" ? "✓" : "✕"}
      </span>
    </td>
  );
}

export default function PredictionGradingPage() {
  useDocumentTitle("채점 결과 매트릭스 | K-Stock Hub");

  const [market, setMarket] = useState("ALL");
  const [limit, setLimit] = useState(20);
  const [data, setData] = useState<GradingMatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .predictionGradingMatrix(market === "ALL" ? null : market, limit)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || "채점 결과를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [market, limit]);

  // Newest session on the right, oldest on the left — the same left-to-right time
  // axis every other chart on the site uses. The API returns dates newest-first.
  const dates = useMemo(() => (data ? [...data.dates].reverse() : []), [data]);

  const rows = data?.rows ?? [];

  return (
    <div className="app app--prediction-grading">
      <header className="app-header">
        <div className="app-title-row">
          <div className="app-brand">
            <Link to="/" aria-label="K-Stock Hub">
              <Logo className="app-logo-wide" />
            </Link>
          </div>
          <div className="app-header-meta">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
        <div className="app-nav-row">
          <Link to="/dashboard" className="kospi-map-nav-link kospi-map-nav-link--home">
            <DashboardIcon /> 홈
          </Link>
          <Link to="/ai-prediction" className="kospi-map-nav-link">
            ← AI 예측으로
          </Link>
        </div>
      </header>

      <section className="pred-matrix-hero">
        <h1 className="pred-matrix-title">채점 결과 매트릭스</h1>
        <p className="pred-matrix-sub">
          최근 {limit}거래일 동안 종목별 예측이 실제로 맞았는지 한 화면에서 확인합니다.
        </p>
      </section>

      <div className="pred-matrix-controls">
        <div className="pred-tabs" role="tablist" aria-label="시장 선택">
          {MARKET_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={market === tab.key}
              className={`pred-tab${market === tab.key ? " is-active" : ""}`}
              onClick={() => setMarket(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="pred-matrix-legend">
          <span className="pred-matrix-legend-item">
            <span className="pred-matrix-mark pred-matrix-mark--hit">✓</span> 적중
          </span>
          <span className="pred-matrix-legend-item">
            <span className="pred-matrix-mark pred-matrix-mark--miss">✕</span> 실패
          </span>
          <span className="pred-matrix-legend-item">
            <span className="pred-matrix-mark pred-matrix-mark--pending">···</span> 채점 대기
          </span>
          <label className="pred-sort">
            <span className="sr-only">표시 기간</span>
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {LIMIT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  최근 {n}거래일
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error ? <p className="pred-error">{error}</p> : null}

      {!error && loading ? <p className="pred-matrix-loading">불러오는 중…</p> : null}

      {!error && !loading && rows.length === 0 ? (
        <p className="pred-empty">아직 채점된 예측이 없습니다.</p>
      ) : null}

      {!error && rows.length > 0 ? (
        <div className="pred-matrix-scroll">
          <table className="pred-matrix">
            <thead>
              <tr>
                <th className="pred-matrix-stockhead" scope="col">
                  종목
                </th>
                {dates.map((d) => (
                  <th key={d.date} scope="col" title={d.label}>
                    {shortDateLabel(d.date)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.code}>
                  <th className="pred-matrix-stockhead" scope="row">
                    <span className="pred-matrix-stockname">{row.name}</span>
                    <span className="pred-matrix-stockmarket">{row.market}</span>
                  </th>
                  {dates.map((d) => <MatrixCell key={d.date} cell={row.cells[d.date]} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Footer />
    </div>
  );
}
