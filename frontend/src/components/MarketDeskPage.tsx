import { useEffect, useMemo, useRef, useState } from "react";
import { IndicatorPoint, NewsItem, StockQuote, StockSearchResult, StockSummary, api } from "../api/client";
import { syncTimeScales } from "../chartSync";
import { trillionSuffix, wonSuffix } from "../i18n/format";
import { useLanguage, useT } from "../i18n/LanguageContext";
import { useTranslatedText, useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { useMobileBarDismissed } from "../mobileBarPreference";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link, navigate } from "../router";
import { scrollBelowStickyHeader, scrollToSection, trackStickyHeight } from "../stickyScroll";
import { reportStockView } from "../useActivityTracking";
import { useDocumentTitle } from "../useDocumentTitle";
import { useMarketSnapshot } from "../useMarketSnapshot";
import { recordRecent } from "../watchlist";
import NewBadge from "./NewBadge";
import StockListIcon from "./StockListIcon";
import BattleIcon from "./BattleIcon";
import CommandPalette from "./CommandPalette";
import DeskIndexStrip from "./DeskIndexStrip";
import DiscussionHeadlineTicker from "./DiscussionHeadlineTicker";
import DiscussionIcon from "./DiscussionIcon";
import EtfIcon from "./EtfIcon";
import MarketBubbleNavLink from "./MarketBubbleNavLink";
import MarketBubbleStockLink from "./MarketBubbleStockLink";
import CommodityPanel from "./CommodityPanel";
import Footer from "./Footer";
import GlobalIndexGrid from "./GlobalIndexGrid";
import GlobalNewsIcon from "./GlobalNewsIcon";
import GlobeRankIcon from "./GlobeRankIcon";
import HeaderDateTime from "./HeaderDateTime";
import IndicatorBadges from "./IndicatorBadges";
import IndicatorPanel, { IndicatorPanelHandle } from "./IndicatorPanel";
import LanguageToggle from "./LanguageToggle";
import Logo from "./Logo";
import MarketBreadthGauge from "./MarketBreadthGauge";
import MarketIcon from "./MarketIcon";
import { MarketFlowBoard, MarketIndexBoard } from "./MarketOverviewPanel";
import MarketTickerBar from "./MarketTickerBar";
import MarketSentimentPanel from "./MarketSentimentPanel";
import MobileStockBar from "./MobileStockBar";
import OrderBookBalance from "./OrderBookBalance";
import PredictIcon from "./PredictIcon";
import PriceChart, { PriceChartHandle } from "./PriceChart";
import RankIcon from "./RankIcon";
import RecentNewsDigest from "./RecentNewsDigest";
import SearchBar from "./SearchBar";
import SectorMapPanel from "./SectorMapPanel";
import SidePanel from "./SidePanel";
import SpotlightBoard from "./SpotlightBoard";
import StockIcon from "./StockIcon";
import StockQuickAccess from "./StockQuickAccess";
import StockRadarBoard from "./StockRadarBoard";
import ThemeToggle from "./ThemeToggle";
import "./marketDesk.css";

/* The market desk.
 *
 * Same site, same data, same components — a different order. What the classic
 * dashboard does is stack every panel it owns down one column: the whole market
 * band first, then the stock. That is the order the page was *built* in, not the
 * order it is read in, and it has two costs. The stock detail — the thing a
 * visitor came for, and the only part of the page that answers a question about
 * a specific company — starts below the fold on every screen. And the market
 * band spends its height on one list at a time, because seven rankings share a
 * tab bar, so six of the seven are invisible until clicked.
 *
 * This page is arranged around what gets read instead:
 *
 *   1. a command bar that stays put, so search is never something to scroll
 *      back to, and ⌘K reaches any stock or board from anywhere;
 *   2. a pulse row — the index, the breadth under it, and what the room is
 *      looking at — three different answers to "how is it going" side by side
 *      rather than stacked;
 *   3. 오늘의 주목 종목 — the same question one level down, four names per
 *      board with a line saying what stood around them;
 *   4. the global band, unchanged;
 *   5. the flow board, which is the classic panel's seven tabs given a section
 *      of their own and the full width to be read in;
 *   6. the focus workspace, which is the stock detail, whole.
 *
 * Nothing was dropped to do it. Every panel the classic desk renders is
 * rendered here, by the same component, with the same props — this file
 * imports MarketIndexBoard and MarketFlowBoard rather than reimplementing
 * either, so the two pages cannot drift apart in what they show. What is new
 * is additive: the breadth gauge, the spotlight board, the radar board, the
 * palette and the rail.
 */

const QUOTE_POLL_MS = 10_000;
const DEFAULT_STOCK_CODE = "005930"; // Samsung Electronics
/** How long a changed price stays lit. Long enough to catch out of the corner
 * of an eye, short enough that a fast tape does not strobe. */
const FLASH_MS = 900;

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

/** The bands the rail knows about. Ids are the scroll targets. */
const SECTIONS = [
  { id: "desk-pulse", label: "마켓 펄스" },
  { id: "desk-spotlight", label: "주목 종목" },
  { id: "desk-global", label: "글로벌" },
  { id: "desk-flow", label: "수급 · 순위" },
];

export default function MarketDeskPage({ initialCode }: { initialCode?: string }) {
  const { lang } = useLanguage();
  const t = useT();

  const [selected] = useState<StockSearchResult | null>(() => {
    const code = initialCode ?? new URLSearchParams(window.location.search).get("code") ?? DEFAULT_STOCK_CODE;
    return { code, name: "", market: "KOSPI" };
  });
  const [summary, setSummary] = useState<StockSummary | null>(null);
  useDocumentTitle(summary ? `${summary.name} 주가·차트·외국인 기관 수급 | K-Stock Hub` : "마켓 데스크 · K-Stock Hub");
  const [liveQuote, setLiveQuote] = useState<StockQuote | null>(null);
  const [quotePending, setQuotePending] = useState(false);
  const [indicatorPoints, setIndicatorPoints] = useState<IndicatorPoint[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [overview, setOverview] = useState<string[]>([]);
  const [perEstimate, setPerEstimate] = useState<string | null>(null);
  const [sharesOutstanding, setSharesOutstanding] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);
  /** "up" | "down" for one beat after the live price moves. See FLASH_MS. */
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  const priceChartRef = useRef<PriceChartHandle>(null);
  const indicatorPanelRef = useRef<IndicatorPanelHandle>(null);
  const stockHeaderRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const skipInitialScrollRef = useRef(!initialCode && !new URLSearchParams(window.location.search).get("code"));

  /* The command bar sticks *below* the site header, and the site header has no
     fixed height — the nav row wraps to two and three lines as the viewport
     narrows, and the language and theme toggles can change its height again at
     the same width. So the height is measured and published as a custom
     property rather than guessed at with a magic number that would be wrong on
     most phones. Observed rather than read once, because the wrap point is
     crossed by rotating a tablet, not only by loading the page at a width. */
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
    if (!selected) return;
    const code = selected.code;
    setLoading(true);
    setError(null);
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
      const align = () => {
        const target = stockHeaderRef.current;
        if (target) scrollBelowStickyHeader(target);
      };
      requestAnimationFrame(align);
      followUpTimer = window.setTimeout(align, 400);
    };

    // Four independent calls rather than one Promise.all, so the header and
    // chart render as soon as /summary and /indicators land instead of waiting
    // on the slower news and overview scrapes — and a failure in either of
    // those secondary calls leaves its own panel empty rather than blanking the
    // page. Identical to the classic desk's loader, deliberately.
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
      .catch(() => {});

    api
      .news(code)
      .then((res) => {
        if (!cancelled) setNews(res.items);
      })
      .catch(() => {})
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
      .catch(() => {});

    return () => {
      cancelled = true;
      if (followUpTimer !== undefined) window.clearTimeout(followUpTimer);
    };
  }, [selected]);

  // The daily-bar /summary endpoint only moves every few hours, so the header
  // price is kept fresh from the live-quote endpoint on its own short interval.
  useEffect(() => {
    setLiveQuote(null);
    setQuotePending(true);
    if (!selected) {
      setQuotePending(false);
      return;
    }
    const code = selected.code;
    let cancelled = false;

    const poll = () => {
      api
        .quote(code)
        .then((res) => {
          if (cancelled) return;
          /* The flash is decided here, against the previous response, rather
             than in an effect watching `liveQuote` — an effect would also fire
             on the first quote of a newly selected stock, which is not a move,
             and would light the header every time the reader changed company. */
          setLiveQuote((prev) => {
            if (prev && res.close !== prev.close) {
              setFlash(res.close > prev.close ? "up" : "down");
            }
            return res;
          });
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setQuotePending(false);
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
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);

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

  /* The rail's scrollspy. rootMargin pulls the detection line down to a third
     of the way from the top, so a band counts as "the one being read" while it
     occupies the middle of the screen rather than the instant its top edge
     clears the header. */
  useEffect(() => {
    const observed = SECTIONS.map((s) => document.getElementById(s.id)).filter(
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
  }, [summary, error]);

  /* The two KR boards as one list, for the breadth gauge. Breadth across one of
     them is not breadth across the market — KOSDAQ is where most of the listed
     names are and where a retail reader's holdings mostly sit, and a KOSPI-only
     count says the opposite thing on plenty of days. Shared with the spotlight
     board, which is built from the same two responses. */
  const krSnapshot = useMarketSnapshot();
  const krBoard = useMemo(
    () => (krSnapshot.generatedAt === null ? null : [...krSnapshot.kospi, ...krSnapshot.kosdaq]),
    [krSnapshot]
  );

  const summaryName = useTranslatedText(summary?.name ?? "");
  const translatedOverview = useTranslatedTexts(overview);
  const mobileBarDismissed = useMobileBarDismissed();
  const awaitingQuote = quotePending && liveQuote === null;

  const suppressDefaultStockViewRef = useRef(!initialCode && !new URLSearchParams(window.location.search).get("code"));

  useEffect(() => {
    if (!summary) return;
    if (suppressDefaultStockViewRef.current) {
      suppressDefaultStockViewRef.current = false;
      return;
    }
    reportStockView(summary.code, summary.name);
    recordRecent({ code: summary.code, name: summary.name, market: selected?.market ?? "KOSPI" });
  }, [summary, selected]);

  const selectStock = (stock: StockSearchResult) => {
    if (stock.market === "US") {
      navigate(`/stock/${stock.code}`);
      return;
    }
    navigate(`/stock/${stock.code}`);
  };



  const close = liveQuote?.close ?? summary?.close;
  const change = liveQuote?.change ?? summary?.change;
  const changePct = liveQuote?.change_pct ?? summary?.change_pct;

  const headerTone = useMemo(() => {
    if (change === undefined) return "flat";
    return change > 0 ? "up" : change < 0 ? "down" : "flat";
  }, [change]);

  return (
    <div className={`app app--desk ${mobileBarDismissed ? "app--bar-dismissed" : ""}`} ref={pageRef}>
      {/* ── Header and nav: deliberately identical to the classic desk's. The
             brief was to rebuild everything between the nav row and the footer,
             and a visitor moving between the two pages should not have to
             relearn where the site's own furniture is. ── */}
      <header className="app-header" ref={headerRef}>
        <div className="app-title-row">
          <div className="app-brand">
            <h1 className="sr-only">K-Stock Hub</h1>
            <Link to="/hub" aria-label="K-Stock Hub 태양계 홈">
              <Logo className="app-logo-wide" />
            </Link>
          </div>
          <div className="app-header-meta">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
        <div className="app-nav-row">
          <Link to="/stocks" className="kospi-map-nav-link kospi-map-nav-link--stocks">
            <StockListIcon /> 종목정보
          </Link>
          <Link to="/stock/005930" className="kospi-map-nav-link kospi-map-nav-link--stock-detail"><span aria-hidden="true">⌕</span> 종목상세</Link>
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
          <Link to="/etf" className="kospi-map-nav-link kospi-map-nav-link--etf">
            <EtfIcon /> ETF
          </Link>
          <Link to="/market-brief" className="kospi-map-nav-link kospi-map-nav-link--brief">오늘 브리핑</Link>
          <Link to="/discussion-explorer?code=005930&name=삼성전자&market=KR&asset=STOCK" className="kospi-map-nav-link kospi-map-nav-link--discussion">
            <DiscussionIcon /> 종목토론
          </Link>
          <MarketBubbleNavLink />
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

      {/* ── The command deck. Sticky, because searching is not a thing you do
             once on arrival — it is the main verb of the page, and on the
             classic desk it scrolls away after the first screen and has to be
             scrolled back to.

             Laid out as a grid rather than a row of flex children, and that is
             the whole fix for how sparse this strip used to look. The search
             field had `flex: 1` on a 1680px page, so it was a thousand pixels
             of empty input; the clock sat at the far right at its own fixed
             size with a column of dead air above and below it; and the chip row
             underneath ran out after six chips and left the rest of the line
             blank. Three separate holes, all of them the same mistake — letting
             one element absorb width it had no use for.

             Now the search takes a readable measure and stops, the space it
             used to waste carries the live index (the one thing worth having in
             a bar that stays on screen — see DeskIndexStrip), and the clock
             spans both rows so its height is the deck's height rather than a
             gap. ── */}
      <div className="desk-command">
        <div className="desk-command-grid">
          <div className="desk-command-search">
            <SearchBar onSelect={selectStock} />
            <CommandPalette onSelectStock={selectStock} />
          </div>
          <DeskIndexStrip />
          <div className="desk-command-clock">
            <HeaderDateTime />
          </div>
          <MarketSentimentPanel />
          <div className="desk-command-chips">
            <StockQuickAccess onSelect={selectStock} activeCode={selected?.code} />
          </div>
        </div>
      </div>

      <MarketTickerBar />

      {/* ── The rail. Four bands is few enough to name and far enough apart to
             be worth jumping between; it doubles as a position indicator on a
             page this tall. Hidden below the desktop breakpoint, where the
             bands are one column and the scroll is short enough not to need
             it. ── */}
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
        {/* ── Band 1: the pulse. Three different answers to "how is the market
               doing" that a reader would otherwise have to visit three places
               for — where the index closed, how broad the move under it
               actually was, and which names the room is on. Side by side on a
               desktop specifically because the first two are only useful
               against each other: an index up with breadth at 30 is a different
               market from an index up with breadth at 70, and stacking them
               hides the comparison. ── */}
        <section className="desk-band desk-band--pulse" id="desk-pulse" aria-labelledby="desk-pulse-title">
          <div className="desk-band-head">
            <h2 id="desk-pulse-title">{t("마켓 펄스")}</h2>
            <span className="desk-band-rule" aria-hidden="true" />
          </div>
          <div className="desk-pulse-grid">
            <div className="desk-card desk-card--index">
              <MarketIndexBoard />
            </div>
            <div className="desk-card desk-card--breadth">
              <MarketBreadthGauge items={krBoard} scopeLabel="코스피+코스닥" />
            </div>
            <div className="desk-card desk-card--radar">
              <StockRadarBoard onSelect={selectStock} activeCode={selected?.code} />
            </div>
          </div>
        </section>

        {/* ── Band 2: the six. Sits directly under the pulse because it is the
               same question one level down — the pulse says how the market
               went, this says which names carried it, and the reader who wants
               a specific stock out of "코스피 +0.7%" has to be given one
               somewhere. Three per board, picked on the move and the money
               together, held still for the session window they belong to.

               See spotlight.ts for the selection, the commentary, and why none
               of the commentary is generated. ── */}
        <section className="desk-band" id="desk-spotlight" aria-labelledby="desk-spotlight-title">
          <div className="desk-band-head">
            <h2 id="desk-spotlight-title">{t("오늘의 주목 종목")}</h2>
            <span className="desk-band-rule" aria-hidden="true" />
          </div>
          <SpotlightBoard onSelect={selectStock} activeCode={selected?.code} />
        </section>

        {/* ── Band 3: the world. Unchanged from the classic desk, moved out from
               under the KR index so the two are peers rather than one being a
               footnote to the other. ── */}
        <section className="desk-band" id="desk-global" aria-labelledby="desk-global-title">
          <div className="desk-band-head">
            <h2 id="desk-global-title">{t("글로벌 지수")}</h2>
            <span className="desk-band-rule" aria-hidden="true" />
          </div>
          <GlobalIndexGrid />
        </section>

        {/* ── Band 4: the flow board — the classic panel's seven rankings, given
               the full width instead of a half column. Same component, same
               tabs, same data; what changes is that the table is now wide
               enough to read without its own horizontal scroll on a laptop. ── */}
        <section className="desk-band" id="desk-flow" aria-labelledby="desk-flow-title">
          <div className="desk-band-head">
            <h2 id="desk-flow-title">{t("수급 · 순위")}</h2>
            <span className="desk-band-rule" aria-hidden="true" />
          </div>
          <div className="desk-card desk-card--flow">
            <MarketFlowBoard onSelectStock={selectStock} />
          </div>
        </section>

        {/* ── Band 5: the workspace. Everything the classic desk's stock zone
               carries, in the same two-column shape, with the header made
               sticky so the name and price stay on screen while the reader is
               down in the chart or the discussion. ── */}
        <section className="desk-band desk-band--market-reference" aria-labelledby="desk-reference-title">
          <div className="desk-band-head">
            <h2 id="desk-reference-title">시장 원자재·산업 지표</h2>
            <span className="desk-band-rule" aria-hidden="true" />
          </div>
          <CommodityPanel />
        </section>

      </main>

      {summary && (
        <MobileStockBar
          anchorRef={stockHeaderRef}
          stock={{ code: summary.code, name: summary.name, market: selected?.market ?? "KOSPI" }}
          displayName={summaryName}
          close={liveQuote?.close ?? summary.close}
          change={liveQuote?.change ?? summary.change}
          changePct={liveQuote?.change_pct ?? summary.change_pct}
          awaitingQuote={awaitingQuote}
        />
      )}

      <Footer />
    </div>
  );
}
