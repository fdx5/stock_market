import { useEffect, useRef, useState } from "react";
import { CompanyNewsItem, IndicatorPoint, UsStockQuote, api } from "../api/client";
import { syncTimeScales } from "../chartSync";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link } from "../router";
import { reportStockView } from "../useActivityTracking";
import { useDocumentTitle } from "../useDocumentTitle";
import Footer from "./Footer";
import GlobalBoardPanel from "./GlobalBoardPanel";
import GlobalNewsList from "./GlobalNewsList";
import IndicatorPanel, { IndicatorPanelHandle } from "./IndicatorPanel";
import LanguageToggle from "./LanguageToggle";
import Logo from "./Logo";
import PriceChart, { PriceChartHandle } from "./PriceChart";
import ThemeToggle from "./ThemeToggle";

const QUOTE_POLL_MS = 10_000;

type Tab = "news" | "board";

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatUsdChange(change: number): string {
  const sign = change >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(change).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function GlobalStockPage() {
  const t = useT();
  const { lang } = useLanguage();
  const code = new URLSearchParams(window.location.search).get("code") ?? "";

  const [quote, setQuote] = useState<UsStockQuote | null>(null);
  const [indicatorPoints, setIndicatorPoints] = useState<IndicatorPoint[]>([]);
  const [news, setNews] = useState<CompanyNewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("news");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const priceChartRef = useRef<PriceChartHandle>(null);
  const indicatorPanelRef = useRef<IndicatorPanelHandle>(null);
  const reportedRef = useRef(false);

  useDocumentTitle(quote ? `${quote.name} - K-Stock Hub` : "K-Stock Hub");

  useEffect(() => {
    if (!code) {
      setLoading(false);
      setError("종목 코드가 없습니다.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    reportedRef.current = false;

    Promise.all([api.usStockQuote(code), api.usStockIndicators(code, 3)])
      .then(([quoteRes, indicatorRes]) => {
        if (cancelled) return;
        setQuote(quoteRes);
        setIndicatorPoints(indicatorRes.points);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || "데이터를 가져오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  // Live-ish price/change, refreshed on its own short interval — same role as
  // Dashboard's liveQuote poll for KR stocks.
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    const poll = () => {
      api
        .usStockQuote(code)
        .then((res) => {
          if (!cancelled) setQuote(res);
        })
        .catch(() => {
          // A missed refresh just keeps showing the last known price.
        });
    };
    const stopPolling = startVisibilityAwareInterval(poll, QUOTE_POLL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [code]);

  // News depends on the resolved company name (a better Bing query than the bare
  // ticker), which only arrives once the quote call above resolves.
  useEffect(() => {
    if (!code || !quote) return;
    let cancelled = false;
    setNewsLoading(true);
    api
      .fightNews(code, quote.name, lang)
      .then((res) => {
        if (!cancelled) setNews(res.items);
      })
      .catch(() => {
        if (!cancelled) setNews([]);
      })
      .finally(() => {
        if (!cancelled) setNewsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code, quote?.name, lang]);

  useEffect(() => {
    if (!quote || reportedRef.current) return;
    reportedRef.current = true;
    reportStockView(quote.code, quote.name);
  }, [quote]);

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
        <div className="app-title-row">
          <div className="app-brand">
            <Link to="/">
              <Logo className="app-logo-wide" />
            </Link>
          </div>
          <div className="app-header-meta">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {loading && (
        <span className="sr-only" role="status">
          {t("데이터를 불러오는 중...")}
        </span>
      )}
      {error && <div className="error-state">{t(error)}</div>}

      {!error && (
        <div className="layout">
          <div className="main-col">
            {!quote ? (
              <div className="card stock-header stock-header-skeleton" aria-hidden="true">
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
              </div>
            ) : (
              <div className="card stock-header">
                <span className="name">{quote.name}</span>
                <span className="code">{quote.code}</span>
                <span
                  className={`price ${quote.change > 0 ? "change-up" : quote.change < 0 ? "change-down" : "change-flat"}`}
                >
                  {formatUsd(quote.close)} ({formatUsdChange(quote.change)}, {quote.change_pct.toFixed(2)}%)
                </span>
              </div>
            )}

            <PriceChart points={indicatorPoints} ref={priceChartRef} />
            <IndicatorPanel
              points={indicatorPoints}
              latest={indicatorPoints[indicatorPoints.length - 1] ?? null}
              ref={indicatorPanelRef}
            />
          </div>

          <div className="card side-panel">
            <div className="market-overview-tab-bar">
              <button
                type="button"
                className={`market-overview-tab ${tab === "news" ? "active" : ""}`}
                onClick={() => setTab("news")}
              >
                {t("관련 뉴스")}
              </button>
              <button
                type="button"
                className={`market-overview-tab ${tab === "board" ? "active" : ""}`}
                onClick={() => setTab("board")}
              >
                {t("종목토론방")}
              </button>
            </div>

            {tab === "news" && (
              <GlobalNewsList code={code} name={quote?.name ?? code} items={news} loading={newsLoading} />
            )}
            {tab === "board" && <GlobalBoardPanel code={code} name={quote?.name ?? code} />}
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}
