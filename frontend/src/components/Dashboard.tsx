import { useEffect, useRef, useState } from "react";
import { IndicatorPoint, NewsItem, StockQuote, StockSearchResult, StockSummary, api } from "../api/client";
import { syncTimeScales } from "../chartSync";
import { trillionSuffix, wonSuffix } from "../i18n/format";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { useTranslatedText, useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import BattleIcon from "./BattleIcon";
import Footer from "./Footer";
import GlobalNewsIcon from "./GlobalNewsIcon";
import IndicatorPanel, { IndicatorPanelHandle } from "./IndicatorPanel";
import LanguageToggle from "./LanguageToggle";
import Logo from "./Logo";
import MarketIcon from "./MarketIcon";
import MarketOverviewPanel from "./MarketOverviewPanel";
import PriceChart, { PriceChartHandle } from "./PriceChart";
import RecentNewsDigest from "./RecentNewsDigest";
import SearchBar from "./SearchBar";
import SidePanel from "./SidePanel";
import StockIcon from "./StockIcon";
import ThemeToggle from "./ThemeToggle";
import VisitorBadge from "./VisitorBadge";

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

export default function Dashboard() {
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
  const [newsLoading, setNewsLoading] = useState(true);
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
    // Cleared up front rather than left showing the previous stock while its own
    // fetch is still in flight — each section below now reveals independently as
    // soon as its own call resolves, so a stale chart/news list would otherwise
    // flash briefly under the new stock's header. summary is cleared too (instead
    // of only hidden behind `loading`) so the header renders its skeleton rather
    // than the previous stock's stale price/name while the new one is in flight.
    setSummary(null);
    setIndicatorPoints([]);
    setNews([]);
    setNewsLoading(true);
    setOverview([]);
    setPerEstimate(null);
    setSharesOutstanding(null);
    let followUpTimer: number | undefined;
    let cancelled = false;
    const skipScroll = skipInitialScrollRef.current;
    skipInitialScrollRef.current = false;

    const scrollToResult = () => {
      if (skipScroll || cancelled) return;
      requestAnimationFrame(() => stockHeaderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      // The price chart (canvas-based, autoSize) and board panel can still be
      // settling their own layout a moment after this first paint — on mobile
      // especially, that late reflow can nudge the page enough to leave the
      // result just off the top. A follow-up scroll corrects for it.
      followUpTimer = window.setTimeout(
        () => stockHeaderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        400
      );
    };

    // Fired independently instead of behind one Promise.all: the price header/chart
    // (the primary content) can now render as soon as /summary + /indicators land,
    // without waiting on the slower news/company-overview scrapes — and a failure in
    // either of those secondary calls no longer blanks out an otherwise-working page.
    api
      .summary(code)
      .then((res) => {
        if (cancelled) return;
        setSummary(res);
        setLoading(false);
        scrollToResult();
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || "데이터를 불러오지 못했습니다.");
        setSummary(null);
        setLoading(false);
      });

    api
      .indicators(code, 3)
      .then((res) => {
        if (!cancelled) setIndicatorPoints(res.points);
      })
      .catch(() => {
        // A missed indicators fetch just leaves the chart empty rather than
        // taking down the rest of the page.
      });

    api
      .news(code)
      .then((res) => {
        if (!cancelled) setNews(res.items);
      })
      .catch(() => {
        // A missed news fetch just leaves that panel empty.
      })
      .finally(() => {
        if (!cancelled) setNewsLoading(false);
      });

    api
      .overview(code)
      .then((res) => {
        if (cancelled) return;
        setOverview(res.overview);
        setPerEstimate(res.per_estimate);
        setSharesOutstanding(res.shares_outstanding);
      })
      .catch(() => {
        // A missed overview fetch just leaves those fields blank.
      });

    return () => {
      cancelled = true;
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
            <MarketIcon /> KOSPI
          </Link>
          <Link to="/kosdaq-map" className="kospi-map-nav-link kospi-map-nav-link--kosdaq">
            <MarketIcon /> KOSDAQ
          </Link>
          <Link to="/sp500-map" className="kospi-map-nav-link kospi-map-nav-link--sp500">
            <MarketIcon /> S&P500
          </Link>
          <Link to="/nasdaq100-map" className="kospi-map-nav-link kospi-map-nav-link--nasdaq">
            <MarketIcon /> NASDAQ100
          </Link>
          <Link to="/fight" className="kospi-map-nav-link kospi-map-nav-link--battle">
            <BattleIcon /> {t("시총대결")}
          </Link>
          <Link to="/news" className="kospi-map-nav-link kospi-map-nav-link--news">
            <GlobalNewsIcon /> NEWS
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
      </header>

      <div className="app-header-trailing">
        <p className="app-subtitle">
          {t(
            "종목 검색시 현재 시세 및 등락률, 차트, 종목토론과 뉴스를 확인할 수 있습니다."
          )}
        </p>
        <SearchBar onSelect={setSelected} />
      </div>

      <MarketOverviewPanel onSelectStock={setSelected} />

      {!selected && <div className="empty-state">{t("종목을 검색해 주세요. (예: 삼성전자, 005930)")}</div>}
      {loading && (
        <span className="sr-only" role="status">
          {t("데이터를 불러오는 중...")}
        </span>
      )}
      {error && <div className="error-state">{t(error)}</div>}

      {selected && !error && (
        <div className="layout">
          <div className="main-col">
            {(() => {
              // Keeps the header card mounted (and its layout stable) through a stock
              // switch instead of hiding the whole page behind a loading text block —
              // only the fields that actually depend on `summary` swap to a skeleton.
              if (!summary) {
                return (
                  <div className="card stock-header stock-header-skeleton" ref={stockHeaderRef} aria-hidden="true">
                    <span className="name">
                      <span className="skeleton" style={{ width: 22, height: 22, borderRadius: 5 }} />
                      <span className="skeleton" style={{ width: 120, height: 20 }} />
                    </span>
                    <span className="code">
                      <span className="skeleton" style={{ width: 56, height: 14 }} />
                    </span>
                    <span className="price">
                      <span className="skeleton" style={{ width: 150, height: 22 }} />
                    </span>
                    <span className="marcap">
                      <span className="skeleton" style={{ width: 220, height: 14 }} />
                    </span>
                  </div>
                );
              }

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
                    <StockIcon className="stock-header-logo" code={summary.code} />
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

            <RecentNewsDigest items={news} name={summaryName} loading={newsLoading} />

            <PriceChart points={indicatorPoints} ref={priceChartRef} />
            <IndicatorPanel
              points={indicatorPoints}
              latest={indicatorPoints[indicatorPoints.length - 1] ?? null}
              ref={indicatorPanelRef}
            />
          </div>

          <SidePanel code={selected.code} name={summaryName} news={news} />
        </div>
      )}

      <Footer />
    </div>
  );
}
