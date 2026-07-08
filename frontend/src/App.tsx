import { useEffect, useRef, useState } from "react";
import {
  IndicatorPoint,
  NewsItem,
  PredictionResult,
  StockSearchResult,
  StockSummary,
  api,
} from "./api/client";
import { syncTimeScales } from "./chartSync";
import IndicatorPanel, { IndicatorPanelHandle } from "./components/IndicatorPanel";
import InvestorTrendPage from "./components/InvestorTrendPage";
import KospiMapPage from "./components/KospiMapPage";
import MarketOverviewPanel from "./components/MarketOverviewPanel";
import PredictionCard from "./components/PredictionCard";
import PriceChart, { PriceChartHandle } from "./components/PriceChart";
import SearchBar from "./components/SearchBar";
import SidePanel from "./components/SidePanel";
import TugOfWarPage from "./components/TugOfWarPage";
import VisitorBadge from "./components/VisitorBadge";
import { Link, useRoute } from "./router";
import { useDocumentTitle } from "./useDocumentTitle";

export default function App() {
  const path = useRoute();
  const investorMatch = path.match(/^\/investor\/([^/]+)\/?$/);
  if (investorMatch) {
    return <InvestorTrendPage code={investorMatch[1]} />;
  }
  if (path === "/map") {
    return <KospiMapPage />;
  }
  if (path === "/battle") {
    return <TugOfWarPage />;
  }
  return <Dashboard />;
}

function Dashboard() {
  useDocumentTitle("코스피 종목정보");

  const [selected, setSelected] = useState<StockSearchResult | null>(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    return code ? { code, name: "", market: "KOSPI" } : null;
  });
  const [summary, setSummary] = useState<StockSummary | null>(null);
  const [indicatorPoints, setIndicatorPoints] = useState<IndicatorPoint[]>([]);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceChartRef = useRef<PriceChartHandle>(null);
  const indicatorPanelRef = useRef<IndicatorPanelHandle>(null);
  const stockHeaderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selected) return;
    const code = selected.code;
    setLoading(true);
    setError(null);
    let followUpTimer: number | undefined;

    Promise.all([api.summary(code), api.indicators(code, 3), api.predict(code), api.news(code)])
      .then(([summaryRes, indicatorsRes, predictRes, newsRes]) => {
        setSummary(summaryRes);
        setIndicatorPoints(indicatorsRes.points);
        setPrediction(predictRes);
        setNews(newsRes.items);

        const scrollToResult = () => {
          stockHeaderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        };
        requestAnimationFrame(scrollToResult);
        // The price chart (canvas-based, autoSize) and board panel can still be
        // settling their own layout a moment after this first paint — on mobile
        // especially, that late reflow can nudge the page enough to leave the
        // result just off the top. A follow-up scroll corrects for it.
        followUpTimer = window.setTimeout(scrollToResult, 400);
      })
      .catch((err: Error) => {
        setError(err.message || "데이터를 불러오지 못했습니다.");
        setSummary(null);
        setIndicatorPoints([]);
        setPrediction(null);
        setNews([]);
      })
      .finally(() => setLoading(false));

    return () => {
      if (followUpTimer !== undefined) window.clearTimeout(followUpTimer);
    };
  }, [selected]);

  useEffect(() => {
    if (indicatorPoints.length === 0) return;
    let cleanup: (() => void) | undefined;

    const id = requestAnimationFrame(() => {
      const priceChart = priceChartRef.current?.getChart();
      const indicatorCharts = indicatorPanelRef.current?.getCharts() ?? [];
      const charts = [priceChart, ...indicatorCharts].filter(
        (c): c is NonNullable<typeof c> => c !== null && c !== undefined
      );
      if (charts.length > 1) {
        // Align RSI/MACD to the price chart's current window immediately, since
        // sync only takes effect on the *next* user-driven range change.
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
  }, [indicatorPoints]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <div className="app-title-row">
            <h1 className="app-title">코스피 종합 정보</h1>
            <Link to="/map" className="kospi-map-nav-link">
              🗺 KOSPI MAP
            </Link>
            <Link to="/battle" className="kospi-map-nav-link">
              🔥 시총 줄다리기
            </Link>
            <VisitorBadge />
          </div>
          <p className="app-subtitle">
            종목을 검색하면 다음날 예상 주가와 근거, 일봉 차트(최근 3개월 기본 표시, 최대 3년 조회), 관련 뉴스를 한눈에 확인할 수 있습니다.
          </p>
        </div>
        <SearchBar onSelect={setSelected} />
      </header>

      <MarketOverviewPanel onSelectStock={setSelected} />

      {!selected && <div className="empty-state">종목을 검색해 주세요. (예: 삼성전자, 005930)</div>}
      {loading && <div className="loading-state">데이터를 불러오는 중...</div>}
      {error && <div className="error-state">{error}</div>}

      {selected && summary && !loading && !error && (
        <div className="layout">
          <div className="main-col">
            <div className="card stock-header" ref={stockHeaderRef}>
              <span className="name">{summary.name}</span>
              <span className="code">{summary.code}</span>
              <span
                className={`price ${
                  summary.change > 0 ? "change-up" : summary.change < 0 ? "change-down" : "change-flat"
                }`}
              >
                {summary.close.toLocaleString()}원 ({summary.change >= 0 ? "+" : ""}
                {summary.change.toLocaleString()}, {summary.change_pct}%)
              </span>
            </div>

            {prediction && <PredictionCard prediction={prediction} />}

            <PriceChart points={indicatorPoints} ref={priceChartRef} />
            <IndicatorPanel
              points={indicatorPoints}
              latest={indicatorPoints[indicatorPoints.length - 1] ?? null}
              ref={indicatorPanelRef}
            />
          </div>

          <SidePanel code={summary.code} name={summary.name} news={news} />
        </div>
      )}
    </div>
  );
}
