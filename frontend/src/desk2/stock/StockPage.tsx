import { API_POLL_MS } from "../../apiPolling";
import MoversEntry from "../../neo/MoversEntry";
import ServiceConnections from "../../markets/ServiceConnections";
import "../../markets/researchServices.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CompanyOverview, GlobalEnrichment, IndicatorPoint, InvestorTrendRecord, StockBoard, StockSummary } from "../../api/client";
import { api } from "../../api/client";
import { useLanguage } from "../../i18n/LanguageContext";
import AdZone from "../../neo/AdZone";
import { useDesignMode } from "../../neo/settings";
import { startVisibilityAwareInterval } from "../../pollVisibility";
import { Link } from "../../router";
import { reportStockView } from "../../useActivityTracking";
import { useDocumentTitle } from "../../useDocumentTitle";
import { useStockDetailSeo } from "../../useStockDetailSeo";
import { useWatchlist } from "../../useWatchlist";
import { recentStockUrl, recordRecent } from "../../watchlist";
import StockLogo from "../../components/StockLogo";
import StockDiscussionRoom from "../../components/discussion/StockDiscussionRoom";
import type { DiscussionPost } from "../../components/discussion/types";
import StockNewsRoom from "../../components/discussion/StockNewsRoom";
import Colophon from "../Colophon";
import CommodityDesk from "../CommodityDesk";
import Finder from "../Finder";
import Masthead from "../Masthead";
import { SectionHead, Skel } from "../parts";
import { krwPrice, num, pct, shares, toneOf, usd, usdPrice, useL, won } from "../lib";
import { useBroadsheet, useFinderHotkey } from "../shell";
import Daily from "./Daily";
import { OrderBookLadder, ShortInterest } from "./Depth";
import Flows from "./Flows";
import Forecast from "./Forecast";
import Peers, { PeerSummary } from "./Peers";
import StockChart from "./StockChart";
import StockDiscussionTicker from "./StockDiscussionTicker";
import Technicals, { RangeBar, Returns, periodReturns } from "./Technicals";
import { writeStory } from "./story";
import StockInsights from "./StockInsights";
import { stockBrief } from "./stockBriefModel";
import { useStockValuation } from "./useStockValuation";
import "../pages.css";
import "./stockHub.css";

interface Quote {
  close: number;
  change: number;
  change_pct: number;
  marcap?: number;
  session?: "pre" | "regular" | "post";
  name?: string;
}

type StockTabId = "overview" | "news" | "discussion" | "technicals" | "flows" | "company";

const QUOTE_POLL_MS = API_POLL_MS;

function resolveInitialTab(us: boolean, isEtf: boolean): StockTabId {
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash.replace(/^#/, "").toLowerCase();
  const raw = (params.get("tab") || hash || "").toLowerCase();
  if (raw === "news" || raw === "sk-news") return "news";
  if (raw === "discussion" || raw === "talk" || raw === "sk-discussion" || raw === "sk-room") return "discussion";
  if (raw === "technicals" || raw === "tech" || raw === "daily" || raw === "sk-tech" || raw === "sk-daily" || raw === "sk-market") return "technicals";
  if (!us && (raw === "flows" || raw === "flow" || raw === "depth" || raw === "sk-flow" || raw === "sk-depth")) return "flows";
  if (!isEtf && (raw === "company" || raw === "peers" || raw === "sk-company" || raw === "sk-peers")) return "company";
  return "overview";
}

function useBubbleMarket(code: string, us: boolean): string | null {
  const [m, setM] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setM(null);
    const markets = us ? (["nasdaq"] as const) : (["kospi", "kosdaq"] as const);
    Promise.all(markets.map((mk) => api.stockBoard(mk).then((b: StockBoard) => ({ mk, b }))))
      .then((all) => {
        if (!alive) return;
        const hit = all.find(({ b }) => [...b.items].sort((x, y) => x.rank - y.rank).slice(0, 20).some((i) => i.code.toUpperCase() === code.toUpperCase()));
        setM(hit?.mk ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [code, us]);
  return m;
}

export default function StockPage({ code: rawCode, isEtf = false }: { code: string; isEtf?: boolean }) {
  const design = useDesignMode();
  const { lang } = useLanguage();
  const L = useL();
  const code = rawCode.toUpperCase();
  const valuation = useStockValuation(code, isEtf);
  const us = !/^\d[0-9A-Z]{5}$/.test(code);
  const market: "KR" | "US" = us ? "US" : "KR";
  const currency = us ? "USD" : "KRW";
  useBroadsheet();

  const [summary, setSummary] = useState<StockSummary | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [receivedAt, setReceivedAt] = useState<string | null>(null);
  const [quoteUnavailable, setQuoteUnavailable] = useState(false);
  const [points, setPoints] = useState<IndicatorPoint[]>([]);
  const [overview, setOverview] = useState<CompanyOverview | null>(null);
  const [enrich, setEnrich] = useState<GlobalEnrichment | null>(null);
  const [flows, setFlows] = useState<InvestorTrendRecord[]>([]);
  const [bench, setBench] = useState<{ name: string; points: IndicatorPoint[] } | null>(null);
  const [sectorName, setSectorName] = useState<string | null>(null);
  const [boardMarket, setBoardMarket] = useState<"KOSPI" | "KOSDAQ" | null>(null);
  const [peers, setPeers] = useState<PeerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [finderOpen, setFinderOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<StockTabId>(() => resolveInitialTab(us, isEtf));
  const [discussionPost, setDiscussionPost] = useState<DiscussionPost | null>(null);
  const [copied, setCopied] = useState(false);
  const { recents } = useWatchlist();
  const bubble = useBubbleMarket(code, us);
  const tabStageRef = useRef<HTMLDivElement>(null);
  useFinderHotkey(setFinderOpen);

  const name = (us ? quote?.name : summary?.name ?? quote?.name) ?? "";
  useDocumentTitle(name ? `${name} 주가·차트·수급 | K-Stock Hub` : "종목 상세 | K-Stock Hub");
  useStockDetailSeo({ code, name: name || undefined, market, price: quote?.close ?? summary?.close });

  useEffect(() => {
    setActiveTab(resolveInitialTab(us, isEtf));
    setDiscussionPost(null);
  }, [code, us, isEtf]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setSummary(null);
    setQuote(null);
    setReceivedAt(null);
    setQuoteUnavailable(false);
    setPoints([]);
    setOverview(null);
    setEnrich(null);
    setFlows([]);
    setBench(null);
    setPeers(null);
    setSectorName(null);
    setBoardMarket(null);
    const acceptQuote = (q: Quote) => {
      if (!alive) return;
      if (!Number.isFinite(q.close) || q.close <= 0) {
        setQuoteUnavailable(true);
        if (us) setError(L("시세 자료를 확인하지 못했습니다.", "Quote data unavailable."));
        return;
      }
      setQuote(q);
      setReceivedAt(new Date().toISOString());
      setQuoteUnavailable(false);
    };

    if (us) {
      Promise.allSettled([
        api.usStockQuote(code).then(acceptQuote).catch(() => {
          if (alive) {
            setQuoteUnavailable(true);
            setError(L("해외 종목 정보를 불러오지 못했습니다.", "Could not load this stock."));
          }
        }),
        api.usStockIndicators(code, 3).then((ind) => {
          if (alive) setPoints(ind.points);
        }),
        isEtf ? Promise.resolve(null) : api.globalEnrichment(code, "ko").then((en) => {
          if (alive) setEnrich(en);
        }),
      ]).then(() => {
        if (!alive) return;
        setLoading(false);
      });
    } else {
      Promise.allSettled([
        api.summary(code).then((s) => {
          if (alive) setSummary(s);
        }).catch(() => {
          if (alive) setError(L("종목 정보를 불러오지 못했습니다.", "Could not load this stock."));
        }),
        api.indicators(code, 3).then((ind) => {
          if (alive) setPoints(ind.points);
        }),
        api.quote(code).then(acceptQuote).catch(() => {
          if (alive) setQuoteUnavailable(true);
        }),
      ]).then(() => {
        if (!alive) return;
        setLoading(false);
      });
      if (!isEtf) api.overview(code).then((o) => alive && setOverview(o)).catch(() => {});
      api.investorTrend(code, 30).then((f) => alive && setFlows(f.records)).catch(() => {});
      (isEtf ? Promise.resolve({ market: "KOSPI" as const, sector: "" }) : api.sector(code))
        .then((s) => {
          if (!alive) return;
          setBoardMarket(s.market);
          setSectorName(s.sector || null);
          const sym = s.market === "KOSDAQ" ? "KOSDAQ" : "KOSPI";
          return api.indexHistory(sym, 1).then((h) => alive && setBench({ name: sym === "KOSDAQ" ? L("코스닥", "KOSDAQ") : L("코스피", "KOSPI"), points: h.points }));
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, us, isEtf]);

  /* Live quote polling */
  useEffect(() => {
    let cancelled = false;
    let pending = false;
    const poll = () => {
      if (cancelled || pending) return;
      pending = true;
      return (us ? api.usStockQuote(code) : api.quote(code))
        .then((q) => {
          if (cancelled) return;
          if (!Number.isFinite(q.close) || q.close <= 0) {
            setQuoteUnavailable(true);
            return;
          }
          setQuote(q);
          setReceivedAt(new Date().toISOString());
          setQuoteUnavailable(false);
        })
        .catch(() => {
          if (!cancelled) setQuoteUnavailable(true);
        })
        .finally(() => {
          pending = false;
        });
    };
    const stop = startVisibilityAwareInterval(poll, QUOTE_POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [code, us]);

  useEffect(() => {
    if (!name) return;
    reportStockView(code, name);
    recordRecent({ code, name, market: us ? "US" : boardMarket ?? "KR", asset_type: isEtf ? "ETF" : "STOCK" });
  }, [code, name, us, boardMarket, isEtf]);

  const close = quote?.close ?? summary?.close ?? points[points.length - 1]?.close ?? 0;
  const change = quote?.change ?? summary?.change ?? 0;
  const changePct = quote?.change_pct ?? summary?.change_pct ?? 0;
  const tone = toneOf(changePct);
  const latest = points[points.length - 1];
  const brief = useMemo(() => stockBrief({ points, quote, summary, peers: peers?.comparison, bench: bench?.points, valuation }), [points, quote, summary, peers, bench, valuation]);
  const year = points.slice(-252);
  const hi52 = year.length ? Math.max(...year.map((p) => p.high)) : null;
  const lo52 = year.length ? Math.min(...year.map((p) => p.low)) : null;
  const returns = useMemo(() => periodReturns(points, bench?.points ?? null), [points, bench]);
  const price = (v: number) => (us ? usdPrice(v) : krwPrice(v, lang));

  const story = useMemo(
    () =>
      name && points.length
        ? writeStory({ lang, name, currency, close, change, changePct, points, flows, peers, returns, benchName: bench?.name ?? null })
        : null,
    [lang, name, currency, close, change, changePct, points, flows, peers, returns, bench],
  );

  const tabs = useMemo(() => {
    const list: { id: StockTabId; ko: string; en: string; live?: boolean }[] = [
      { id: "overview", ko: "종합 요약", en: "Overview" },
      { id: "news", ko: "관련 기사", en: "News" },
      { id: "discussion", ko: "종목 토론", en: "Discussion", live: true },
      { id: "technicals", ko: "지표 · 일별", en: "Indicators · daily" },
    ];
    if (!us) list.push({ id: "flows", ko: isEtf ? "수급" : "수급 · 호가", en: isEtf ? "Flows" : "Flows · depth" });
    if (!isEtf) list.push({ id: "company", ko: "기업 · 업종", en: "Company · peers" });
    return list;
  }, [us, isEtf]);

  const selectTab = useCallback((next: StockTabId, scrollToStage = true, post: DiscussionPost | null = null) => {
    setDiscussionPost(post);
    setActiveTab(next);
    if (scrollToStage && tabStageRef.current) {
      const rect = tabStageRef.current.getBoundingClientRect();
      const offset = window.innerWidth <= 640 ? 150 : 170;
      if (rect.top < offset - 20 || rect.top > window.innerHeight * 0.65) {
        window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - offset), behavior: "smooth" });
      }
    }
  }, []);

  const share = async () => {
    const url = `${window.location.origin}/stock/${code}${isEtf ? "?asset=ETF" : ""}`;
    try {
      if (navigator.share) await navigator.share({ title: `${name} | K-Stock Hub`, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }
    } catch {
      /* cancelled */
    }
  };

  const asset = isEtf ? "ETF" : "STOCK";
  const explorer = `/discussion-explorer?code=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}&market=${market}&asset=${asset}`;
  const marketLabel = us ? (isEtf ? L("미국 ETF", "US ETF") : L("미국 주식", "US stock")) : isEtf ? L("국내 ETF", "KRX ETF") : boardMarket === "KOSDAQ" ? L("코스닥", "KOSDAQ") : L("코스피", "KOSPI");
  const marcap = us ? (enrich?.marcap_usd ? usd(enrich.marcap_usd) : null) : quote?.marcap ? won(quote.marcap, lang) : null;
  const sessionLabel = us && quote?.session === "pre" ? L("프리마켓", "Pre-market") : us && quote?.session === "post" ? L("애프터마켓", "After-hours") : null;
  const others = recents.filter((r) => r.code.toUpperCase() !== code).slice(0, 8);
  const description = us ? enrich?.description?.split(/(?<=[.!?])\s+/).slice(0, 6) ?? [] : overview?.overview ?? [];

  const chartPanel = (
    <section id="sk-chart" className="d2-sec" aria-labelledby="sk-chart-h">
      <SectionHead
        id="sk-chart-h"
        no="01"
        kicker={L("주가 차트", "Price chart")}
        title={L("3년 가격 추이", "Three-year price trend")}
        note={L("5·20·60·120일 이동평균과 볼린저 밴드를 켜고 끌 수 있습니다.", "Toggle 5/20/60/120-day moving averages and Bollinger bands.")}
      />
      <StockChart points={points} currency={currency} />
    </section>
  );

  return (
    <div className="d2 sk" lang={lang}>
      <a className="d2-skip" href="#sk-top">
        {L("본문 바로가기", "Skip to content")}
      </a>
      <Masthead
        onPrint={() => window.print()}
        section={{ ko: "종목", en: "Company", taglineKo: "한 종목을 한 화면에 — 차트·뉴스·토론·지표", taglineEn: "One company, one workspace — chart, news, discussion and indicators" }}
      />

      {/* Compact Sticky Workspace Tab Hub — replaces the old 10-item horizontal TOC */}
      <div className="sk-hub-bar" role="region" aria-label={L("종목 워크스페이스 탐색", "Stock workspace navigation")}>
        <div className="sk-hub-id">
          {us && enrich?.logo_url ? (
            <img className="sk-hub-id-logo" src={enrich.logo_url} alt="" />
          ) : (
            <StockLogo code={code} name={name} className="sk-hub-id-logo" assetType={isEtf ? "etf" : "stock"} />
          )}
          <b className="sk-hub-id-name">{name || code}</b>
          <span className={`sk-hub-id-px is-${tone}`}>
            {close ? price(close) : "—"} <em>{pct(changePct)}</em>
          </span>
        </div>

        <nav className="sk-hub-tabs" role="tablist" aria-label={L("종목 정보 탭", "Stock sections")}>
          {tabs.map((tab) => {
            const isOn = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isOn}
                className={`sk-hub-tab ${isOn ? "is-active" : ""}`}
                onClick={() => selectTab(tab.id, true)}
              >
                {tab.live && <span className="sk-hub-tab-dot" aria-hidden="true" />}
                <span>{L(tab.ko, tab.en)}</span>
              </button>
            );
          })}
        </nav>

        <button type="button" className="sk-hub-find" onClick={() => setFinderOpen(true)} aria-label={L("다른 종목 찾기", "Find another stock")}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 5 5" />
          </svg>
          <span>{L("종목 찾기", "Find")}</span>
          <kbd>/</kbd>
        </button>
      </div>

      <main className="d2-main">
        {!isEtf && <MoversEntry code={code} place="stock" market={us ? "us" : "kr"} />}

        {loading && !name && (
          <div className="sk-loading">
            <Skel h={60} w="45%" />
            <Skel h={30} w="30%" />
            <Skel h={340} />
          </div>
        )}
        {error && !name && (
          <div className="sk-error">
            <p>{error}</p>
            <button type="button" className="sk-button" onClick={() => setFinderOpen(true)}>
              {L("다른 종목 찾기", "Find another stock")}
            </button>
          </div>
        )}

        {name && (
          <>
            {/* Persistent Compact Top Anchor: Hero + Chart */}
            <section id="sk-top" className="d2-sec sk-top sk-top-compact" aria-label={name}>
              <div className={design === "neo" ? "ng-stock-top-grid" : undefined}>
                <div className="sk-hero">
                  <div className="sk-hero-main">
                    <p className="sk-kicker">
                      <span>{marketLabel}</span>
                      {sectorName && <span>{sectorName}</span>}
                      {peers && (
                        <span>
                          {L("업종 내 시총", "Sector rank")} {peers.capRank}
                          {L("위", "")}
                        </span>
                      )}
                      {sessionLabel && <span className="sk-session">{sessionLabel}</span>}
                      <span>{summary?.date ?? latest?.date ?? ""}</span>
                    </p>
                    <h1 className="sk-name">{name}</h1>
                    <p className="sk-code">
                      <b>{code}</b>
                      <Link to={explorer}>{L("종목토론 전체 ↗", "Full discussion ↗")}</Link>
                      {!us && <Link to={`/investor/${code}`}>{L("투자자 동향", "Investor trend")}</Link>}
                      {!us && !isEtf && <Link to={`/stock/${code}/outlook`}>{L("전망", "Outlook")}</Link>}
                      {bubble && <Link to={`/market-bubbles?market=${bubble}`}>{L("증시버블", "Bubbles")}</Link>}
                      <button type="button" onClick={share}>
                        {copied ? L("링크 복사됨", "Link copied") : L("공유", "Share")}
                      </button>
                    </p>
                    <div className={`sk-price is-${tone}`}>
                      <b>{close ? price(close) : "—"}</b>
                      <span>
                        {change > 0 ? "▲" : change < 0 ? "▼" : "–"} {us ? Math.abs(change).toFixed(2) : Math.abs(change).toLocaleString()} <em>{pct(changePct)}</em>
                      </span>
                    </div>
                    <dl className="sk-facts">
                      {marcap && (
                        <div>
                          <dt>{L("시가총액", "Market cap")}</dt>
                          <dd>{marcap}</dd>
                        </div>
                      )}
                      {(summary?.volume ?? latest?.volume) != null && (
                        <div>
                          <dt>{L("거래량", "Volume")}</dt>
                          <dd>{shares(summary?.volume ?? latest?.volume ?? 0, lang)}</dd>
                        </div>
                      )}
                      {overview?.per_estimate && (
                        <div>
                          <dt>{L("예상 PER", "Fwd PER")}</dt>
                          <dd>
                            {overview.per_estimate}
                            {L("배", "x")}
                          </dd>
                        </div>
                      )}
                      {overview?.shares_outstanding && (
                        <div>
                          <dt>{L("발행주식수", "Shares out")}</dt>
                          <dd>{shares(overview.shares_outstanding, lang)}</dd>
                        </div>
                      )}
                      {latest?.volatility20 != null && (
                        <div>
                          <dt>{L("20일 변동성", "20D vol")}</dt>
                          <dd>{(latest.volatility20 * 100).toFixed(2)}%</dd>
                        </div>
                      )}
                    </dl>
                    {hi52 != null && lo52 != null && close > 0 && <RangeBar low={lo52} high={hi52} now={close} fmt={price} />}
                    {design === "neo" && !isEtf && description.length > 0 && (
                      <div className="ng-stock-profile">
                        <span className="ng-kicker">COMPANY / IN BRIEF</span>
                        <p>
                          {description.join(" ").slice(0, 180)}
                          {description.join(" ").length > 180 ? "…" : ""}
                        </p>
                        <button type="button" onClick={() => selectTab("company", true)}>
                          {L("기업 · 업종 비교 보기", "Company & peers")} →
                        </button>
                      </div>
                    )}
                  </div>
                  {design !== "neo" && <Forecast code={code} />}
                </div>

                {design === "neo" && chartPanel}
              </div>

              <AdZone kind="break" />
            </section>

            {/* Focused Active Tab Stage — dramatically reduces page scroll length */}
            <div className="sk-tab-stage" ref={tabStageRef} role="tabpanel">
              {activeTab === "overview" && (
                <>
                  <StockDiscussionTicker key={`${code}:${asset}`} code={code} market={market} kind={asset}
                    onSelect={(post) => selectTab("discussion", true, post)} />
                  <StockInsights model={brief} code={code} isEtf={isEtf} receivedAt={receivedAt} quoteUnavailable={quoteUnavailable} />

                  {/* 1-Tap Shortcuts into Dedicated News & Discussion Rooms */}
                  <div className="sk-hub-shortcuts">
                    <button type="button" className="sk-shortcut-card" onClick={() => selectTab("news", true)}>
                      <span className="sk-shortcut-copy">
                        <span className="sk-shortcut-kicker">RELATED NEWS</span>
                        <strong>{L(`${name} 관련 기사 바로 읽기`, `${name} related news`)}</strong>
                        <span>{L("언론사 필터 · 분할/카드 모드로 전문과 핵심 요약 확인", "Filter by outlet and read full articles & summaries")}</span>
                      </span>
                      <span className="sk-shortcut-arrow" aria-hidden="true">→</span>
                    </button>

                    <button type="button" className="sk-shortcut-card is-talk" onClick={() => selectTab("discussion", true)}>
                      <span className="sk-shortcut-copy">
                        <span className="sk-shortcut-kicker">LIVE DISCUSSION</span>
                        <strong>{L(`${name} 실시간 종목 토론 50건`, `${name} live discussion`)}</strong>
                        <span>{L("핫 키워드 · 공감 우세 · 본문·댓글 한눈에 스캔", "Hot keywords, sentiment gauge, and instant post reader")}</span>
                      </span>
                      <span className="sk-shortcut-arrow" aria-hidden="true">→</span>
                    </button>
                  </div>

                  {/* Executive Duo: Auto Data Story + AI Forecast */}
                  <div className="sk-overview-duo">
                    {story && (
                      <div className="sk-overview-card">
                        <article className="sk-story">
                          <p className="d2-lead-kicker">
                            <span>{L("오늘의 종목 리포트", "Today's company brief")}</span>
                            <span>{latest?.date}</span>
                          </p>
                          <h2>{story.headline}</h2>
                          <div className="sk-story-body">
                            {story.deck.map((p, i) => (
                              <p key={i}>
                                {i === 0 && <b className="d2-lead-dateline">{L("【요약】", us ? "SUMMARY —" : "SUMMARY —")} </b>}
                                {p}
                              </p>
                            ))}
                          </div>
                        </article>
                      </div>
                    )}

                    {design === "neo" && (
                      <div className="sk-overview-card">
                        <details className="ng-stock-forecast" open>
                          <summary>
                            {L("AI 예측 자세히", "AI forecast details")} <span>▾</span>
                          </summary>
                          <Forecast code={code} />
                        </details>
                      </div>
                    )}
                  </div>

                  {others.length > 0 && (
                    <nav className="sk-recents" aria-label={L("최근 본 종목", "Recently viewed")}>
                      <span>{L("최근 본 종목", "Recently viewed")}</span>
                      {others.map((r) => (
                        <Link key={r.code} to={recentStockUrl(r)}>
                          {r.name}
                        </Link>
                      ))}
                    </nav>
                  )}

                  <ServiceConnections
                    compact
                    path={`/stock/${code}`}
                    code={code}
                    market={us ? "nasdaq" : boardMarket === "KOSDAQ" ? "kosdaq" : "kospi"}
                    region={isEtf ? market : undefined}
                  />
                </>
              )}

              {activeTab === "news" && (
                <section id="sk-news" aria-labelledby="sk-news-h">
                  <div className="sk-tab-panel-head">
                    <div>
                      <span className="sk-tab-panel-kicker">RELATED NEWS</span>
                      <h2 id="sk-news-h">{L(`${name} 주요 관련 기사`, `${name} related news`)}</h2>
                      <p>{L("언론사별 필터와 분할·카드 모드로 기사를 이 화면에서 바로 읽을 수 있습니다.", "Filter by outlet and read full articles right here.")}</p>
                    </div>
                  </div>
                  <StockNewsRoom code={code} name={name} us={us} track={us ? "us" : "kr"} />
                </section>
              )}

              {activeTab === "discussion" && (
                <section id="sk-discussion" aria-labelledby="sk-discussion-h">
                  <div className="sk-tab-panel-head">
                    <div>
                      <span className="sk-tab-panel-kicker">LIVE DISCUSSION</span>
                      <h2 id="sk-discussion-h">{L(`${name} 실시간 종목 토론`, `${name} live discussion`)}</h2>
                      <p>{L("최신 토론 50건을 한 번에 불러와 분할 리딩·연속 펼쳐보기·핫 키워드로 편안하게 읽을 수 있습니다.", "Scan 50 latest posts at once with split reading, stream cards, and hot keywords.")}</p>
                    </div>
                  </div>
                  <StockDiscussionRoom
                    code={code}
                    name={name}
                    market={market}
                    kind={asset}
                    explorerHref={explorer}
                    initialPost={discussionPost}
                  />
                </section>
              )}

              {activeTab === "technicals" && (
                <>
                  <section id="sk-tech" className="d2-sec" aria-labelledby="sk-tech-h">
                    <SectionHead
                      id="sk-tech-h"
                      no="01"
                      kicker={L("수익률 · 기술 지표", "Returns · indicators")}
                      title={L("기간 수익률과 기술적 위치", "Period returns & technicals")}
                      note={bench ? L(`기간 수익률은 ${bench.name} 지수와 같은 기간끼리 비교합니다.`, `Compared against ${bench.name} over the same sessions.`) : undefined}
                    />
                    <div className="sk-tech-grid">
                      <Returns items={returns} benchName={bench?.name ?? null} />
                      <Technicals points={points} currency={currency} />
                    </div>
                  </section>

                  <section id="sk-daily" className="d2-sec" aria-labelledby="sk-daily-h">
                    <SectionHead id="sk-daily-h" no="02" kicker={L("일별 시세", "Daily prices")} title={L("최근 거래일별 시세", "Daily session history")} />
                    <Daily code={code} market={market} />
                  </section>

                  {us && (
                    <section id="sk-market" className="d2-sec" aria-labelledby="sk-market-h">
                      <SectionHead id="sk-market-h" no="03" kicker={L("원자재 · 메모리", "Commodities · memory")} title={L("시장 바깥의 가격", "Prices outside the market")} />
                      <CommodityDesk />
                    </section>
                  )}
                </>
              )}

              {activeTab === "flows" && !us && (
                <>
                  <section id="sk-flow" className="d2-sec" aria-labelledby="sk-flow-h">
                    <SectionHead
                      id="sk-flow-h"
                      no="01"
                      kicker={L("투자자별 수급", "Investor flows")}
                      title={L("외국인 · 기관 · 개인 순매수", "Net buying by investor")}
                      note={L("최근 30거래일 순매수(억원).", "Last 30 sessions (KRW 100M).")}
                    />
                    <Flows rows={flows} code={code} />
                  </section>

                  {!isEtf && (
                    <section id="sk-depth" className="d2-sec" aria-labelledby="sk-depth-h">
                      <SectionHead
                        id="sk-depth-h"
                        no="02"
                        kicker={L("호가 · 공매도 · 대차", "Order book · short interest")}
                        title={L("대기 물량과 공매도 추이", "Resting orders and short interest")}
                        note={L("실제 공개된 계열만 싣고, 없는 수치는 추정하지 않습니다.", "Only published series are shown; nothing is estimated.")}
                      />
                      <div className="sk-depth-grid">
                        <OrderBookLadder code={code} />
                        <ShortInterest code={code} />
                      </div>
                    </section>
                  )}
                </>
              )}

              {activeTab === "company" && !isEtf && (
                <>
                  <section id="sk-company" className="d2-sec" aria-labelledby="sk-company-h">
                    <SectionHead id="sk-company-h" no="01" kicker={L("기업 정보", "Company profile")} title={L("기업 개요 및 핵심 지표", "Company profile & facts")} />
                    <div className="sk-company">
                      <div className="sk-company-copy">
                        {description.length ? description.map((line, i) => <p key={i}>{line}</p>) : <p className="d2-empty">{L("기업 개요를 준비하고 있습니다.", "Profile not available yet.")}</p>}
                      </div>
                      <dl className="sk-company-facts">
                        <div>
                          <dt>{L("종목코드", "Ticker")}</dt>
                          <dd>{code}</dd>
                        </div>
                        <div>
                          <dt>{L("시장", "Market")}</dt>
                          <dd>{marketLabel}</dd>
                        </div>
                        {sectorName && (
                          <div>
                            <dt>{L("업종", "Sector")}</dt>
                            <dd>{sectorName}</dd>
                          </div>
                        )}
                        {marcap && (
                          <div>
                            <dt>{L("시가총액", "Market cap")}</dt>
                            <dd>{marcap}</dd>
                          </div>
                        )}
                        {overview?.per_estimate && (
                          <div>
                            <dt>{L("예상 PER", "Fwd PER")}</dt>
                            <dd>{overview.per_estimate}</dd>
                          </div>
                        )}
                        {overview?.shares_outstanding && (
                          <div>
                            <dt>{L("발행주식수", "Shares out")}</dt>
                            <dd>{num(overview.shares_outstanding)}</dd>
                          </div>
                        )}
                        {latest?.atr14 != null && (
                          <div>
                            <dt>ATR 14</dt>
                            <dd>{price(latest.atr14)}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  </section>

                  <section id="sk-peers" className="d2-sec" aria-labelledby="sk-peers-h">
                    <SectionHead
                      id="sk-peers-h"
                      no="02"
                      kicker={L("동일 업종 비교", "Sector peers")}
                      title={L("동일 업종 주요 종목", "Sector peer comparison")}
                      note={us ? L("S&P 500 같은 섹터 종목.", "S&P 500 names in the same sector.") : L("같은 업종 상장 종목. 열 제목을 누르면 정렬됩니다.", "Listed names in the same sector. Click a column to sort.")}
                    />
                    <Peers code={code} market={market} onSummary={setPeers} />
                  </section>
                </>
              )}
            </div>

            <p className="sk-disclaimer">
              {L(
                "공개 시장 데이터를 구조화한 정보 서비스이며 투자 권유가 아닙니다. 지연·정정 가능성이 있으니 최종 판단은 거래소와 공시 원문을 기준으로 하세요.",
                "An information service built from public market data, not investment advice. Figures may be delayed or corrected; rely on exchange filings for decisions.",
              )}
            </p>
          </>
        )}
      </main>

      <Colophon />
      <Finder open={finderOpen} onClose={() => setFinderOpen(false)} />
    </div>
  );
}
