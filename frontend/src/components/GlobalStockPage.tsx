import { useEffect, useMemo, useRef, useState } from "react";
import { CompanyNewsItem, GlobalEnrichment, IndicatorPoint, UsStockQuote, api } from "../api/client";
import { syncTimeScales } from "../chartSync";
import { trillionSuffix, wonSuffix } from "../i18n/format";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link, navigate } from "../router";
import { scrollBelowStickyHeader, scrollToSection, trackStickyHeight } from "../stickyScroll";
import { reportStockView } from "../useActivityTracking";
import { useDocumentTitle } from "../useDocumentTitle";
import { recordRecent } from "../watchlist";
import NewBadge from "./NewBadge";
import StockListIcon from "./StockListIcon";
import BattleIcon from "./BattleIcon";
import DailyPricePanel from "./DailyPricePanel";
import CommodityPanel from "./CommodityPanel";
import Footer from "./Footer";
import EtfNavLink from "./EtfNavLink";
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
import DiscussionHeadlineTicker from "./DiscussionHeadlineTicker";
import Logo from "./Logo";
import MacroRatesStrip from "./MacroRatesStrip";
import MarketIcon from "./MarketIcon";
import MarketBubbleStockLink from "./MarketBubbleStockLink";
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

export default function GlobalStockPage({ initialCode }: { initialCode?: string } = {}) {
  const t = useT();
  const { lang } = useLanguage();
  // Read as state, not straight off `window.location`: the app's router keys only on
  // pathname, so a /global -> /global hop (picking another US stock from the search
  // below) changes nothing it watches and would leave this page showing the previous
  // ticker. popstate is what navigate() fires, so listening to it covers both that
  // hop and the browser's own back/forward.
  const [code, setCode] = useState(() => initialCode?.toUpperCase() ?? new URLSearchParams(window.location.search).get("code") ?? "");

  useEffect(() => {
    const syncCode = () => setCode(initialCode?.toUpperCase() ?? new URLSearchParams(window.location.search).get("code") ?? "");
    window.addEventListener("popstate", syncCode);
    return () => window.removeEventListener("popstate", syncCode);
  }, [initialCode]);

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
  const stockHeaderRef = useRef<HTMLDivElement>(null);
  const reportedRef = useRef(false);
  // Mirrors the KR desk (see MarketDeskPage): a landing that already carries a
  // ?code= — a search hit or a shared link — should auto-scroll down to the
  // stock detail band, which sits below the market bands on this page. Only a
  // bare /global with no code at all (which just shows the error state) skips it.
  const skipInitialScrollRef = useRef(!new URLSearchParams(window.location.search).get("code"));

  useDocumentTitle(quote ? `${quote.name} - K-Stock Hub` : "K-Stock Hub");

  // A US pick stays on this page (swapping the ?code=), a KR pick has to go back to
  // the dashboard, which owns the KR pipeline — the inverse of Dashboard's own
  // handler, so the two pages hand off to each other in both directions.
  const selectStock = (stock: { code: string; market: string }) => {
    navigate(`/stock/${stock.code.toUpperCase()}`);
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

    const skipScroll = skipInitialScrollRef.current;
    skipInitialScrollRef.current = false;
    let followUpTimer: number | undefined;

    // Offset by the sticky header rather than scrollIntoView'd flush to the
    // viewport top — same reasoning as MarketDeskPage/Dashboard: without it the
    // stock's name and price land underneath .app-header. A follow-up scroll
    // corrects for the chart's own late layout settle.
    const scrollToResult = () => {
      if (skipScroll || cancelled) return;
      const align = () => {
        const target = stockHeaderRef.current;
        if (target) scrollBelowStickyHeader(target);
      };
      requestAnimationFrame(align);
      followUpTimer = window.setTimeout(align, 400);
    };

    Promise.all([api.usStockQuote(code), api.usStockIndicators(code, 3)])
      .then(([quoteRes, indicatorRes]) => {
        if (cancelled) return;
        setQuote(quoteRes);
        setIndicatorPoints(indicatorRes.points);
        scrollToResult();
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || "데이터를 가져오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (followUpTimer !== undefined) window.clearTimeout(followUpTimer);
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
    /* Written on the page root, so every write invalidates style for the whole
       page. A horizontal drag fires this on nearly every frame while the height
       changes only where the nav row wraps, so the write is skipped unless the
       figure actually moved, and the measuring is coalesced to one frame. */
    let published = Number.NaN,
      frame = 0;
    const publish = () => {
      frame = 0;
      const height = header.offsetHeight;
      if (height === published) return;
      published = height;
      page.style.setProperty("--desk-header-h", `${height}px`);
    };
    const apply = () => {
      if (!frame) frame = requestAnimationFrame(publish);
    };
    publish();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", apply);
      return () => {
        if (frame) cancelAnimationFrame(frame);
        window.removeEventListener("resize", apply);
      };
    }
    const observer = new ResizeObserver(apply);
    observer.observe(header);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
    };
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
    <div className={`app app--desk app--gdesk ${initialCode ? "is-stock-detail" : ""}`} ref={pageRef}>
      <header className="app-header" ref={headerRef}>
        <div className="app-title-row">
          <div className="app-brand">
            {initialCode ? (
              <Link to="/global" className="gdesk-intelligence-brand">K-STOCK <b>INTELLIGENCE</b></Link>
            ) : (
              <Link to="/">
                <Logo className="app-logo-wide" />
              </Link>
            )}
          </div>
          <div className="app-header-meta">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
        <div className="app-nav-row">
          <Link to={initialCode ? "/global" : "/desk"} className="kospi-map-nav-link kospi-map-nav-link--home">
            <DashboardIcon /> {initialCode ? "글로벌 메인" : t("홈")}
          </Link>
          <Link to="/stocks" className="kospi-map-nav-link kospi-map-nav-link--stocks">
            <StockListIcon /> 종목정보
          </Link>
          <Link to="/stock/AAPL" className="kospi-map-nav-link kospi-map-nav-link--stock-detail"><span aria-hidden="true">⌕</span> 종목상세</Link>
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
            <MarketIcon /> NASDAQ
          </Link>
          <EtfNavLink />
          <Link to="/kospi-100" className="kospi-map-nav-link kospi-map-nav-link--top100">
            <RankIcon /> TOP100
          </Link>
          <Link to="/ai-prediction" className="kospi-map-nav-link kospi-map-nav-link--predict">
            <PredictIcon /> AI예측
          </Link>
          <Link to="/global-top100" className="kospi-map-nav-link kospi-map-nav-link--globaltop100">
            <GlobeRankIcon /> {t("글로벌시총")}
          </Link>
          <Link to="/fight" className="kospi-map-nav-link kospi-map-nav-link--battle">
            <BattleIcon /> {t("시총대결")}
          </Link>
          <Link to="/news" className="kospi-map-nav-link kospi-map-nav-link--news">
            <GlobalNewsIcon /> NEWS
          </Link>
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
        <section className="desk-band desk-band--market-reference" aria-labelledby="gdesk-reference-title">
          <div className="desk-band-head">
            <h2 id="gdesk-reference-title">글로벌 원자재·메모리 지표</h2>
            <span className="desk-band-rule" aria-hidden="true" />
          </div>
          <CommodityPanel />
        </section>

      </main>

      <Footer />
    </div>
  );
}
