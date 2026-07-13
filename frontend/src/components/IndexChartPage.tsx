import { useEffect, useRef, useState } from "react";
import { IndicatorPoint, api } from "../api/client";
import { syncTimeScales } from "../chartSync";
import { useT } from "../i18n/LanguageContext";
import { Link } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import Footer from "./Footer";
import IndicatorPanel, { IndicatorPanelHandle } from "./IndicatorPanel";
import LanguageToggle from "./LanguageToggle";
import PriceChart, { PriceChartHandle } from "./PriceChart";
import ThemeToggle from "./ThemeToggle";

const LABELS: Record<"KOSPI" | "KOSDAQ", string> = {
  KOSPI: "코스피",
  KOSDAQ: "코스닥",
};

export default function IndexChartPage({ symbol }: { symbol: "KOSPI" | "KOSDAQ" }) {
  const t = useT();
  useDocumentTitle("K-Stock Hub");

  const [points, setPoints] = useState<IndicatorPoint[]>([]);
  const [latest, setLatest] = useState<IndicatorPoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const priceChartRef = useRef<PriceChartHandle>(null);
  const indicatorPanelRef = useRef<IndicatorPanelHandle>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .indexHistory(symbol, 3)
      .then((res) => {
        if (cancelled) return;
        setPoints(res.points);
        setLatest(res.points[res.points.length - 1] ?? null);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || "데이터를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    if (points.length === 0) return;
    let cleanup: (() => void) | undefined;

    const id = requestAnimationFrame(() => {
      const priceChart = priceChartRef.current?.getChart();
      const indicatorCharts = indicatorPanelRef.current?.getCharts() ?? [];
      const charts = [priceChart, ...indicatorCharts].filter(
        (c): c is NonNullable<typeof c> => c !== null && c !== undefined
      );
      if (charts.length > 1) {
        const initialRange = priceChart?.timeScale().getVisibleRange();
        if (initialRange) {
          indicatorCharts.forEach((chart) => chart.timeScale().setVisibleRange(initialRange));
        }
        cleanup = syncTimeScales(charts);
      }
    });

    return () => {
      cancelAnimationFrame(id);
      cleanup?.();
    };
  }, [points]);

  const label = LABELS[symbol];
  const change = latest?.close !== undefined && points.length > 1 ? latest.close - points[points.length - 2].close : 0;
  const changePct = points.length > 1 ? (change / points[points.length - 2].close) * 100 : 0;

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="back-link">
          ← {t("메인으로")}
        </Link>
        <div>
          <div className="app-title-row">
            <h1 className="app-title">{t(label)} {t("지수 차트")}</h1>
            <span className="app-header-meta app-header-meta-inline">
              <LanguageToggle />
              <ThemeToggle />
            </span>
          </div>
          {latest && (
            <p className="app-subtitle">
              {latest.close.toLocaleString()}
              {" "}
              <span style={{ color: change >= 0 ? "var(--up-color)" : "var(--down-color)" }}>
                {change >= 0 ? "▲" : "▼"} {Math.abs(change).toLocaleString()} (
                {changePct >= 0 ? "+" : ""}
                {changePct.toFixed(2)}%)
              </span>
              {" · "}
              {latest.date} {t("기준")}
            </p>
          )}
        </div>
      </header>

      {loading && <div className="loading-state">{t("불러오는 중...")}</div>}
      {error && <div className="error-state">{t(error)}</div>}

      {!loading && !error && (
        <div className="main-col">
          <PriceChart points={points} ref={priceChartRef} />
          <IndicatorPanel points={points} latest={latest} ref={indicatorPanelRef} />
        </div>
      )}

      <Footer />
    </div>
  );
}
