import { useEffect, useMemo, useRef, useState } from "react";
import { CompanyNewsItem, GlobalEnrichment, IndicatorPoint, UsStockQuote, api } from "../api/client";
import { syncTimeScales } from "../chartSync";
import { trillionSuffix, wonSuffix } from "../i18n/format";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link, navigate } from "../router";
import { scrollToSection, trackStickyHeight } from "../stickyScroll";
import { reportStockView } from "../useActivityTracking";
import { useDocumentTitle } from "../useDocumentTitle";
import { recordRecent } from "../watchlist";
import BattleIcon from "./BattleIcon";
import DailyPricePanel from "./DailyPricePanel";
import DramPricePanel from "./DramPricePanel";
import Footer from "./Footer";
import GlobalBoardPanel from "./GlobalBoardPanel";
import GlobalIndexGrid from "./GlobalIndexGrid";
import GlobalNewsIcon from "./GlobalNewsIcon";
import GlobeRankIcon from "./GlobeRankIcon";
import GlobalNewsList from "./GlobalNewsList";
import IndicatorPanel, { IndicatorPanelHandle } from "./IndicatorPanel";
import LanguageToggle from "./LanguageToggle";
import PredictIcon from "./PredictIcon";
import RankIcon from "./RankIcon";
import DashboardIcon from "./DashboardIcon";
import Logo from "./Logo";
import MacroRatesStrip from "./MacroRatesStrip";
import MarketIcon from "./MarketIcon";
import MarketBreadthGauge from "./MarketBreadthGauge";
import MarketTickerBar from "./MarketTickerBar";
import PriceChart, { PriceChartHandle } from "./PriceChart";
import CommandPalette from "./CommandPalette";
import HeaderDateTime from "./HeaderDateTime";
import SearchBar from "./SearchBar";
import SessionBadge from "./SessionBadge";
import SessionSplit from "./SessionSplit";
import StockQuickAccess from "./StockQuickAccess";
import ThemeToggle from "./ThemeToggle";
import SpotlightBoard from "./SpotlightBoard";
import StockRadarBoard from "./StockRadarBoard";
import UsIndexStrip from "./UsIndexStrip";
import UsRankBoard from "./UsRankBoard";
import UsSectorMapPanel from "./UsSectorMapPanel";
import VisitorBadge from "./VisitorBadge";
import { useUsMarketSnapshot } from "../useUsMarketSnapshot";
import "./marketDesk.css";

const QUOTE_POLL_MS = 10_000;

/** The bands the rail knows about, in page order. Ids are the scroll targets.
 *
 * There is no 수급 band here and there cannot be: no free US feed breaks volume
 * out by participant, so the KR desk's 개인/외국인/기관 board has no counterpart.
 * Its slot is taken by the rankings the constituent snapshots do support — see
 * UsRankBoard. */
const SECTIONS = [
  { id: "gdesk-pulse", label: "마켓 펄스" },
  { id: "gdesk-spotlight", label: "주목 종목" },
  { id: "gdesk-index", label: "글로벌 지수" },
  { id: "gdesk-rank", label: "순위" },
  { id: "gdesk-focus", label: "종목" },
];

type Tab = "news" | "board" | "daily";

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
    navigate(stock.market === "US" ? `/global?code=${stock.code}` : `/desk?code=${stock.code}`);
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

  /* The same two constituent maps the breadth gauge, the spotlight and the
     ranking board all read, pulled once and shared — see useUsMarketSnapshot. */
  const usSnapshot = useUsMarketSnapshot();
  const usBoard = useMemo(
    () => (usSnapshot.generatedAt === null ? null : usSnapshot.all),
    [usSnapshot]
  );

  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);
  const pageRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  /* The command deck sticks below the site header, whose height is not fixed —
     the nav row wraps as the viewport narrows. Measured and published as a custom
     property rather than guessed at. Same mechanism as the KR desk. */
  useEffect(() => {
    const header = headerRef.current;
    const page = pageRef.current;
    if (!header || !page) return;
    const apply = () => page.style.setProperty("--desk-header-h", `${header.offsetHeight}px`);
    apply();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", apply);
      return () => window.removeEventListener("resize", apply);
    }
    const observer = new ResizeObserver(apply);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  /* And the whole pinned stack's height, for CSS. See trackStickyHeight — the
     bands' scroll-margin has to land on the same line the rail's own click does,
     and the only way to guarantee that is for both to come from one measurement. */
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    return trackStickyHeight(page);
  }, []);

  useEffect(() => {
    const observed = SECTIONS.map((sec) => document.getElementById(sec.id)).filter(
      (el): el is HTMLElement => el !== null
    );
    if (observed.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: "-33% 0px -55% 0px" }
    );
    observed.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [quote, error]);



  return (
    <div className="app app--desk app--gdesk" ref={pageRef}>
      <header className="app-header" ref={headerRef}>
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
          <Link to="/desk" className="kospi-map-nav-link kospi-map-nav-link--home">
            <DashboardIcon /> {t("홈")}
          </Link>
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
          <Link to="/kospi-100" className="kospi-map-nav-link kospi-map-nav-link--top100">
            <RankIcon /> TOP 100
          </Link>
          <Link to="/ai-prediction" className="kospi-map-nav-link kospi-map-nav-link--predict">
            <PredictIcon /> AI 예측
          </Link>
          <Link to="/global-top100" className="kospi-map-nav-link kospi-map-nav-link--globaltop100">
            <GlobeRankIcon /> {t("글로벌 시총")}
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
            <img src="/img/mini_app.webp" alt="" className="mini-apps-icon" />
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

      {/* The command deck, same shape as the KR desk's: search and ⌘K on the
          left, the live index in the middle, the clock spanning both rows on the
          right, and the shortcut chips underneath. The index here is the US
          majors with any KR-flagged instrument filtered out — see UsIndexStrip.

          The chips and the search are asked for US-only, since the popular
          ranking and the browser's own trail both mix markets by construction and
          this page must not surface KR names. */}
      <div className="desk-command">
        <div className="desk-command-grid">
          <div className="desk-command-search">
            <SearchBar onSelect={selectStock} />
            <CommandPalette onSelectStock={selectStock} />
          </div>
          <UsIndexStrip />
          <div className="desk-command-clock">
            <HeaderDateTime />
          </div>
          <div className="desk-command-chips">
            <StockQuickAccess onSelect={selectStock} activeCode={code} market="US" />
          </div>
        </div>
      </div>

      <nav className="desk-rail" aria-label={t("구역 이동")}>
        <ul>
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <button
                type="button"
                className={activeSection === section.id ? "is-active" : ""}
                aria-current={activeSection === section.id ? "true" : undefined}
                onClick={() => scrollToSection(section.id)}
              >
                <span className="desk-rail-dot" aria-hidden="true" />
                <span className="desk-rail-label">{t(section.label)}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main className="desk-main">
        {/* ── Band 1: the pulse, US edition. The breadth gauge is the same
               component the KR desk uses — advancing against declining and a
               cap-weighted sector average are the same two questions on any
               board — fed the S&P 500 and NASDAQ 100 union instead. The radar is
               asked for the US popular ranking. ── */}
        <section className="desk-band desk-band--pulse" id="gdesk-pulse" aria-labelledby="gdesk-pulse-title">
          <div className="desk-band-head">
            <h2 id="gdesk-pulse-title">{t("마켓 펄스")}</h2>
            <span className="desk-band-rule" aria-hidden="true" />
          </div>
          <div className="desk-pulse-grid desk-pulse-grid--us">
            <div className="desk-card desk-card--breadth">
              <MarketBreadthGauge items={usBoard} scopeLabel="S&P 500 + 나스닥 100" />
            </div>
            <div className="desk-card desk-card--radar">
              <StockRadarBoard onSelect={selectStock} activeCode={code} market="US" />
            </div>
          </div>
        </section>

        {/* ── Band 2: the six, from the two US boards. ── */}
        <section className="desk-band" id="gdesk-spotlight" aria-labelledby="gdesk-spotlight-title">
          <div className="desk-band-head">
            <h2 id="gdesk-spotlight-title">{t("오늘의 주목 종목")}</h2>
            <span className="desk-band-rule" aria-hidden="true" />
          </div>
          <SpotlightBoard onSelect={selectStock} activeCode={code} kind="us" />
        </section>

        {/* ── Band 3: the index grid and the macro strip. `excludeKr` drops KORU,
               a Korea leverage ETF that trades in New York and is therefore filed
               under the US group — correctly, and still a KR instrument. The FX
               strip stays: a US name is quoted in the dollar it converts. ── */}
        <section className="desk-band" id="gdesk-index" aria-labelledby="gdesk-index-title">
          <div className="desk-band-head">
            <h2 id="gdesk-index-title">{t("글로벌 지수")}</h2>
            <span className="desk-band-rule" aria-hidden="true" />
          </div>
          <GlobalIndexGrid excludeKr />
          <MacroRatesStrip variant="card" />
        </section>

        {/* ── Band 4: the rankings that stand in for the KR desk's 수급 board. ── */}
        <section className="desk-band" id="gdesk-rank" aria-labelledby="gdesk-rank-title">
          <div className="desk-band-head">
            <h2 id="gdesk-rank-title">{t("순위")}</h2>
            <span className="desk-band-rule" aria-hidden="true" />
          </div>
          <div className="desk-card desk-card--flow">
            <UsRankBoard onSelect={selectStock} activeCode={code} />
          </div>
        </section>

        {/* ── Band 5: the workspace — this page's original stock detail, whole and
               unchanged, inside the desk's own band. ── */}
        <section className="desk-band desk-band--focus" id="gdesk-focus" aria-labelledby="gdesk-focus-title">
          <div className="desk-band-head">
            <h2 id="gdesk-focus-title">{t("종목 상세")}</h2>
            <span className="desk-band-rule" aria-hidden="true" />
          </div>

      {loading && (
        <span className="sr-only" role="status">
          {t("데이터를 불러오는 중...")}
        </span>
      )}
      {error && <div className="error-state">{t(error)}</div>}

      {!error && code && <DramPricePanel code={code} market="US" />}

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
                <span className="code">{quote.code}</span>
                <span
                  className={`price ${quote.change > 0 ? "change-up" : quote.change < 0 ? "change-down" : "change-flat"}`}
                >
                  <SessionBadge session={quote.session} />
                  {formatUsd(quote.close)} ({formatUsdChange(quote.change)}, {quote.change_pct.toFixed(2)}%)
                </span>
                {/* The figure above is measured from the previous regular close, so
                    after the bell it already carries the after-hours leg — this breaks
                    the two apart. Renders nothing during regular hours. */}
                <SessionSplit quote={quote} className="stock-header-session" />
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
              defaultExpanded
            />
          </div>

          {/* Stretched to the chart column's height (see .side-col in styles.css) so
              the sector map below can absorb whatever height the news/discussion panel
              leaves over — on desktop that gap was most of the column. */}
          <div className="side-col">
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
                <button
                  type="button"
                  className={`market-overview-tab ${tab === "daily" ? "active" : ""}`}
                  onClick={() => setTab("daily")}
                >
                  {t("일별")}
                </button>
              </div>

              {tab === "news" && (
                <GlobalNewsList code={code} name={quote?.name ?? code} items={news} loading={newsLoading} />
              )}
              {tab === "board" && <GlobalBoardPanel code={code} name={quote?.name ?? code} />}
              {tab === "daily" && <DailyPricePanel code={code} market="US" />}
            </div>

            <UsSectorMapPanel code={code} onSelectStock={selectStock} />
          </div>
        </div>
      )}
        </section>
      </main>

      <Footer />
    </div>
  );
}
