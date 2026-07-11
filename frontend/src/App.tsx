import { useEffect, useRef, useState } from "react";
import { IndicatorPoint, NewsItem, StockQuote, StockSearchResult, StockSummary, api } from "./api/client";
import { syncTimeScales } from "./chartSync";
import Footer from "./components/Footer";
import IndicatorPanel, { IndicatorPanelHandle } from "./components/IndicatorPanel";
import InvestorTrendPage from "./components/InvestorTrendPage";
import KosdaqMapPage from "./components/KosdaqMapPage";
import KospiMapPage from "./components/KospiMapPage";
import LanguageToggle from "./components/LanguageToggle";
import Logo from "./components/Logo";
import MarketOverviewPanel from "./components/MarketOverviewPanel";
import PriceChart, { PriceChartHandle } from "./components/PriceChart";
import RecentNewsDigest from "./components/RecentNewsDigest";
import SearchBar from "./components/SearchBar";
import SidePanel from "./components/SidePanel";
import ThemeToggle from "./components/ThemeToggle";
import TugOfWarPage from "./components/TugOfWarPage";
import VisitorBadge from "./components/VisitorBadge";
import { trillionSuffix, wonSuffix } from "./i18n/format";
import { useLanguage, useT } from "./i18n/LanguageContext";
import { useTranslatedText, useTranslatedTexts } from "./i18n/useTranslatedTexts";
import { startVisibilityAwareInterval } from "./pollVisibility";
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
const DEFAULT_STOCK_CODE = "005930"; // Samsung Electronics

function formatMarcap(marcap: number, lang: "ko" | "en"): string {
  return `${(marcap / 1_000_000_000_000).toFixed(1)}${trillionSuffix(lang)}`;
}

function formatMarcapChange(change: number, lang: "ko" | "en"): string {
  const sign = change > 0 ? "+" : change < 0 ? "-" : "";
  return `${sign}${(Math.abs(change) / 1_000_000_000_000).toFixed(1)}${trillionSuffix(lang)}`;
}

function formatPerEstimate(per: string, lang: "ko" | "en"): string {
  return lang === "en" ? `${per}x` : `${per}배`;
}

function formatShares(shares: number, lang: "ko" | "en"): string {
  return lang === "en" ? `${shares.toLocaleString()} shares` : `${shares.toLocaleString()}주`;
}

function Dashboard() {
  const { lang } = useLanguage();
  const t = useT();
  useDocumentTitle("K-Stock Hub");

  const [selected, setSelected] = useState<StockSearchResult | null>(() => {
    // No `?code=` in the URL means a plain landing on the dashboard — default
    // to Samsung Electronics instead of showing the empty "search a stock" state.
    const code = new URLSearchParams(window.location.search).get("code") ?? DEFAULT_STOCK_CODE;
    return { code, name: "", market: "KOSPI" };
  });
  const [summary, setSummary] = useState<StockSummary | null>(null);
  const [liveQuote, setLiveQuote] = useState<StockQuote | null>(null);
  const [indicatorPoints, setIndicatorPoints] = useState<IndicatorPoint[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [overview, setOverview] = useState<string[]>([]);
  const [perEstimate, setPerEstimate] = useState<string | null>(null);
  const [sharesOutstanding, setSharesOutstanding] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceChartRef = useRef<PriceChartHandle>(null);
  const indicatorPanelRef = useRef<IndicatorPanelHandle>(null);
  const stockHeaderRef = useRef<HTMLDivElement>(null);
  // A plain landing on "/" (no `?code=`) silently defaults `selected` to Samsung
  // instead of showing the empty state - that synthetic first load shouldn't yank
  // the page down. Explicit searches and code-in-URL entries (shared links) should
  // still auto-scroll to the result, so the skip only applies to that first run.
  const skipInitialScrollRef = useRef(!new URLSearchParams(window.location.search).get("code"));

  useEffect(() => {
    if (!selected) return;
    const code = selected.code;
    setLoading(true);
    setError(null);
    let followUpTimer: number | undefined;
    const skipScroll = skipInitialScrollRef.current;
    skipInitialScrollRef.current = false;

    Promise.all([api.summary(code), api.indicators(code, 3), api.news(code), api.overview(code)])
      .then(([summaryRes, indicatorsRes, newsRes, overviewRes]) => {
        setSummary(summaryRes);
        setIndicatorPoints(indicatorsRes.points);
        setNews(newsRes.items);
        setOverview(overviewRes.overview);
        setPerEstimate(overviewRes.per_estimate);
        setSharesOutstanding(overviewRes.shares_outstanding);

        if (skipScroll) return;
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
        setOverview([]);
        setPerEstimate(null);
        setSharesOutstanding(null);
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
    const stopPolling = startVisibilityAwareInterval(poll, QUOTE_POLL_MS);
    return () => {
      cancelled = true;
      stopPolling();
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

  const summaryName = useTranslatedText(summary?.name ?? "");
  const translatedOverview = useTranslatedTexts(overview);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <div className="app-title-row">
            <div className="app-brand">
              <h1 className="sr-only">K-Stock Hub</h1>
              <Logo className="app-logo-wide" />
            </div>
            <div className="app-header-meta">
              <LanguageToggle />
              <ThemeToggle />
            </div>
          </div>
          <div className="app-nav-row">
            <Link to="/map" className="kospi-map-nav-link">
              🗺 KOSPI
            </Link>
            <Link to="/kosdaq-map" className="kospi-map-nav-link">
              🟢 KOSDAQ
            </Link>
            <Link to="/battle" className="kospi-map-nav-link">
              {t("🔥 시총대결")}
            </Link>
            <a
              href="https://chs2147.github.io/mini-apps"
              target="_blank"
              rel="noopener noreferrer"
              className="kospi-map-nav-link"
            >
              <img src="/img/mini_app.png" alt="" className="mini-apps-icon" />
              Mini Apps
            </a>
            <VisitorBadge />
          </div>
          <p className="app-subtitle">
            {t(
              "종목 검색시 현재 시세 및 등락률, 차트, 종목토론과 뉴스를 확인할 수 있습니다."
            )}
          </p>
        </div>
        <SearchBar onSelect={setSelected} />
      </header>

      <MarketOverviewPanel onSelectStock={setSelected} />

      {!selected && <div className="empty-state">{t("종목을 검색해 주세요. (예: 삼성전자, 005930)")}</div>}
      {loading && <div className="loading-state">{t("데이터를 불러오는 중...")}</div>}
      {error && <div className="error-state">{t(error)}</div>}

      {selected && summary && !loading && !error && (
        <div className="layout">
          <div className="main-col">
            {(() => {
              const close = liveQuote?.close ?? summary.close;
              const change = liveQuote?.change ?? summary.change;
              const changePct = liveQuote?.change_pct ?? summary.change_pct;
              const marcap = liveQuote?.marcap;
              // Naver's live-quote endpoint only reports the current market cap, not its
              // delta, so the change is derived from the same day-over-day ratio as the
              // price change (previous close implied by change_pct) — consistent with how
              // the price change above is computed, and refreshed on the same poll.
              const marcapChange =
                marcap !== undefined ? marcap - marcap / (1 + changePct / 100) : undefined;
              return (
                <div className="card stock-header" ref={stockHeaderRef}>
                  <span className="name">
                    <img
                      className="stock-header-logo"
                      src={`https://ssl.pstatic.net/imgstock/fn/real/logo/png/stock/Stock${summary.code}.png`}
                      alt=""
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                    {summaryName}
                  </span>
                  <span className="code">{summary.code}</span>
                  <span
                    className={`price ${change > 0 ? "change-up" : change < 0 ? "change-down" : "change-flat"}`}
                  >
                    {close.toLocaleString()}{wonSuffix(lang)} ({change >= 0 ? "+" : ""}
                    {change.toLocaleString()}, {changePct}%)
                  </span>
                  {marcap !== undefined && marcapChange !== undefined && (
                    <span
                      className={`marcap ${marcapChange > 0 ? "change-up" : marcapChange < 0 ? "change-down" : "change-flat"}`}
                    >
                      {t("시가총액")} {formatMarcap(marcap, lang)}
                      {wonSuffix(lang)} ({formatMarcapChange(marcapChange, lang)}
                      {wonSuffix(lang)})
                    </span>
                  )}
                  {(perEstimate || sharesOutstanding !== null) && (
                    <span className="fundamentals">
                      {perEstimate && `${t("추정PER")} ${formatPerEstimate(perEstimate, lang)}`}
                      {perEstimate && sharesOutstanding !== null && " · "}
                      {sharesOutstanding !== null &&
                        `${t("상장주식수")} ${formatShares(sharesOutstanding, lang)}`}
                    </span>
                  )}
                  {translatedOverview.length > 0 && (
                    <div className="overview">
                      {translatedOverview.map((line, idx) => (
                        <p key={idx}>{line}</p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            <RecentNewsDigest items={news} name={summaryName} />

            <PriceChart points={indicatorPoints} ref={priceChartRef} />
            <IndicatorPanel
              points={indicatorPoints}
              latest={indicatorPoints[indicatorPoints.length - 1] ?? null}
              ref={indicatorPanelRef}
            />
          </div>

          <SidePanel code={summary.code} name={summaryName} news={news} />
        </div>
      )}

      <Footer />
    </div>
  );
}
