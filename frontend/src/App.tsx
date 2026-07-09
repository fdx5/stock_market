import { useEffect, useRef, useState } from "react";
import { IndicatorPoint, NewsItem, StockQuote, StockSearchResult, StockSummary, api } from "./api/client";
import { syncTimeScales } from "./chartSync";
import IndicatorPanel, { IndicatorPanelHandle } from "./components/IndicatorPanel";
import InvestorTrendPage from "./components/InvestorTrendPage";
import KosdaqMapPage from "./components/KosdaqMapPage";
import KospiMapPage from "./components/KospiMapPage";
import MarketOverviewPanel from "./components/MarketOverviewPanel";
import PriceChart, { PriceChartHandle } from "./components/PriceChart";
import RecentNewsDigest from "./components/RecentNewsDigest";
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
  if (path === "/kosdaq-map") {
    return <KosdaqMapPage />;
  }
  if (path === "/battle") {
    return <TugOfWarPage />;
  }
  return <Dashboard />;
}

const QUOTE_POLL_MS = 10_000;

function Dashboard() {
  useDocumentTitle("코스피 종목정보");

  const [selected, setSelected] = useState<StockSearchResult | null>(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    return code ? { code, name: "", market: "KOSPI" } : null;
  });
  const [summary, setSummary] = useState<StockSummary | null>(null);
  const [liveQuote, setLiveQuote] = useState<StockQuote | null>(null);
  const [indicatorPoints, setIndicatorPoints] = useState<IndicatorPoint[]>([]);
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

    Promise.all([api.summary(code), api.indicators(code, 3), api.news(code)])
      .then(([summaryRes, indicatorsRes, newsRes]) => {
        setSummary(summaryRes);
        setIndicatorPoints(indicatorsRes.points);
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
        setNews([]);
      })
      .finally(() => setLoading(false));

    return () => {
      if (followUpTimer !== undefined) window.clearTimeout(followUpTimer);
    };
  }, [selected]);

  // The daily-bar /summary endpoint only moves once every several hours, so the
  // stock-header price/change display is kept fresh separately via the live-quote
  // endpoint instead, polled on its own short interval.
  useEffect(() => {
    setLiveQuote(null);
    if (!selected) return;
    const code = selected.code;
    let cancelled = false;

    const poll = () => {
      api
        .quote(code)
        .then((res) => {
          if (!cancelled) setLiveQuote(res);
        })
        .catch(() => {
          // A missed refresh just keeps showing the last known price.
        });
    };

    poll();
    const id = window.setInterval(poll, QUOTE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
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
            <Link to="/kosdaq-map" className="kospi-map-nav-link">
              🟢 KOSDAQ MAP
            </Link>
            <Link to="/battle" className="kospi-map-nav-link">
              🔥 시총 줄다리기
            </Link>
            <VisitorBadge />
          </div>
          <p className="app-subtitle">
            종목을 검색하면 현재 시세와 등락률, 일봉 차트(최근 3개월 기본 표시, 최대 3년 조회), 최근 3일 뉴스 요약과 관련 뉴스를 한눈에 확인할 수 있습니다.
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
            {(() => {
              const close = liveQuote?.close ?? summary.close;
              const change = liveQuote?.change ?? summary.change;
              const changePct = liveQuote?.change_pct ?? summary.change_pct;
              return (
                <div className="card stock-header" ref={stockHeaderRef}>
                  <span className="name">{summary.name}</span>
                  <span className="code">{summary.code}</span>
                  <span
                    className={`price ${change > 0 ? "change-up" : change < 0 ? "change-down" : "change-flat"}`}
                  >
                    {close.toLocaleString()}원 ({change >= 0 ? "+" : ""}
                    {change.toLocaleString()}, {changePct}%)
                  </span>
                </div>
              );
            })()}

            <RecentNewsDigest items={news} name={summary.name} />

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
