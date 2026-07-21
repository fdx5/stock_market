import { useEffect, useRef, useState } from "react";
import { CompanyNewsItem, GlobalEnrichment, IndicatorPoint, UsStockQuote, api } from "../api/client";
import { syncTimeScales } from "../chartSync";
import { trillionSuffix, wonSuffix } from "../i18n/format";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link, navigate } from "../router";
import { reportStockView } from "../useActivityTracking";
import { useDocumentTitle } from "../useDocumentTitle";
import { recordRecent } from "../watchlist";
import BattleIcon from "./BattleIcon";
import FavoriteButton from "./FavoriteButton";
import Footer from "./Footer";
import GlobalBoardPanel from "./GlobalBoardPanel";
import GlobalIndexGrid from "./GlobalIndexGrid";
import GlobalNewsIcon from "./GlobalNewsIcon";
import GlobalNewsList from "./GlobalNewsList";
import IndicatorPanel, { IndicatorPanelHandle } from "./IndicatorPanel";
import LanguageToggle from "./LanguageToggle";
import Logo from "./Logo";
import MacroRatesStrip from "./MacroRatesStrip";
import MarketIcon from "./MarketIcon";
import MarketTickerBar from "./MarketTickerBar";
import PriceChart, { PriceChartHandle } from "./PriceChart";
import SearchBar from "./SearchBar";
import StockQuickAccess from "./StockQuickAccess";
import ThemeToggle from "./ThemeToggle";
import VisitorBadge from "./VisitorBadge";

const QUOTE_POLL_MS = 10_000;

type Tab = "news" | "board";

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatUsdChange(change: number): string {
  const sign = change >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(change).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatMarcapKrw(krw: number, lang: "ko" | "en"): string {
  return `${(krw / 1_000_000_000_000).toFixed(1)}${trillionSuffix(lang)}${wonSuffix(lang)}`;
}

function formatMarcapUsd(usd: number): string {
  if (usd >= 1_000_000_000_000) return `$${(usd / 1_000_000_000_000).toFixed(2)}T`;
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
  return `$${(usd / 1_000_000).toFixed(1)}M`;
}

/** Splits a single-paragraph description into up to 5 whole-sentence lines, mirroring
 * how Dashboard.tsx's own overview block reads (several short <p> lines, not one dense
 * paragraph) even though this description arrives as one string, not pre-split bullets. */
function splitDescriptionLines(text: string, maxLines = 5): string[] {
  const sentences = text
    .trim()
    .split(/(?<=[.!?다요])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.slice(0, maxLines);
}

export default function GlobalStockPage() {
  const t = useT();
  const { lang } = useLanguage();
  // Read as state, not straight off `window.location`: the app's router keys only on
  // pathname, so a /global -> /global hop (picking another US stock from the search
  // below) changes nothing it watches and would leave this page showing the previous
  // ticker. popstate is what navigate() fires, so listening to it covers both that
  // hop and the browser's own back/forward.
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get("code") ?? "");

  useEffect(() => {
    const syncCode = () => setCode(new URLSearchParams(window.location.search).get("code") ?? "");
    window.addEventListener("popstate", syncCode);
    return () => window.removeEventListener("popstate", syncCode);
  }, []);

  const [quote, setQuote] = useState<UsStockQuote | null>(null);
  const [enrichment, setEnrichment] = useState<GlobalEnrichment | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
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

  // A US pick stays on this page (swapping the ?code=), a KR pick has to go back to
  // the dashboard, which owns the KR pipeline — the inverse of Dashboard's own
  // handler, so the two pages hand off to each other in both directions.
  const selectStock = (stock: { code: string; market: string }) => {
    navigate(stock.market === "US" ? `/global?code=${stock.code}` : `/?code=${stock.code}`);
  };

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

  // Logo/market-cap/description — independent of the quote poll above (its own
  // slug-guess + scrape round trip can take longer), so it fills in progressively
  // rather than blocking the price/chart from rendering.
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setEnrichment(null);
    setLogoFailed(false);
    api
      .globalEnrichment(code, lang)
      .then((res) => {
        if (!cancelled) setEnrichment(res);
      })
      .catch(() => {
        // A missed enrichment fetch just leaves the logo/marcap/description blank.
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

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
    // Mirrors Dashboard: a US name opened here belongs in the same "최근 본 종목"
    // strip as a KR one. Stored with market "US" so the chip routes back to this
    // page rather than the KR detail view, which can't resolve a ticker.
    recordRecent({ code: quote.code, name: quote.name, market: "US" });
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

      {/* Same live belt as the dashboard, and the same reason for it here: this
          page is about a US name, and the belt carries the FX/index/commodity
          context that name trades against. Sits directly under the nav so it reads
          as a live band across the top of the page. */}
      <MarketTickerBar />

      {/* Until now this page was a navigation dead end: a visitor arriving from a
          map tile or a trending chip could only leave via the browser's back
          button or a market-map link. It gets the dashboard's own search + shortcut
          strip so any stock, KR or US, is reachable from here too. */}
      <div className="app-header-trailing">
        <SearchBar onSelect={selectStock} />
        <StockQuickAccess onSelect={selectStock} activeCode={code} />
      </div>

      <GlobalIndexGrid />

      {/* The dashboard's own FX/oil pair, repeated here under the index grid. It
          reads from the shared market-ticker poller, so a second placement costs
          no extra request — and a US name is quoted in the dollar this rate
          converts, which makes it more relevant on this page, not less. */}
      <MacroRatesStrip variant="card" />

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
                <span className="name">
                  {enrichment && !logoFailed ? (
                    <img
                      src={enrichment.logo_url}
                      alt=""
                      className="stock-header-logo"
                      onError={() => setLogoFailed(true)}
                    />
                  ) : (
                    <span className="fight-logo-fallback stock-header-logo">{quote.name.slice(0, 2)}</span>
                  )}
                  {quote.name}
                </span>
                <FavoriteButton stock={{ code: quote.code, name: quote.name, market: "US" }} />
                <span className="code">{quote.code}</span>
                <span
                  className={`price ${quote.change > 0 ? "change-up" : quote.change < 0 ? "change-down" : "change-flat"}`}
                >
                  {formatUsd(quote.close)} ({formatUsdChange(quote.change)}, {quote.change_pct.toFixed(2)}%)
                </span>
                {enrichment?.marcap_krw != null && (
                  <span
                    className={`marcap ${quote.change > 0 ? "change-up" : quote.change < 0 ? "change-down" : "change-flat"}`}
                  >
                    {t("시가총액")} {formatMarcapKrw(enrichment.marcap_krw, lang)}
                    {enrichment.marcap_usd != null && ` (${formatMarcapUsd(enrichment.marcap_usd)})`}
                  </span>
                )}
                {enrichment?.description && (
                  <div className="overview">
                    {splitDescriptionLines(enrichment.description).map((line, idx) => (
                      <p key={idx}>{line}</p>
                    ))}
                  </div>
                )}
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
