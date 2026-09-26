import { useCallback, useEffect, useMemo, useState } from "react";
import type { CompanyOverview, GlobalEnrichment, IndicatorPoint, InvestorTrendRecord, StockBoard, StockSummary } from "../../api/client";
import { api } from "../../api/client";
import { useLanguage } from "../../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../../pollVisibility";
import { Link, navigate } from "../../router";
import { reportStockView } from "../../useActivityTracking";
import { useDocumentTitle } from "../../useDocumentTitle";
import { useStockDetailSeo } from "../../useStockDetailSeo";
import { useWatchlist } from "../../useWatchlist";
import { recordRecent } from "../../watchlist";
import StockLogo from "../../components/StockLogo";
import Colophon from "../Colophon";
import CommodityDesk from "../CommodityDesk";
import Finder from "../Finder";
import Masthead from "../Masthead";
import { SectionHead, Skel } from "../parts";
import { krwPrice, num, pct, shares, toneOf, usd, usdPrice, useL, won } from "../lib";
import Discussion from "../reader/Discussion";
import News from "../reader/News";
import { jumpTo, useBroadsheet, useFinderHotkey, useScrollSpy } from "../shell";
import Daily from "./Daily";
import { OrderBookLadder, ShortInterest } from "./Depth";
import Flows from "./Flows";
import Forecast from "./Forecast";
import Peers, { PeerSummary } from "./Peers";
import StockChart from "./StockChart";
import Technicals, { RangeBar, Returns, periodReturns } from "./Technicals";
import { writeStory } from "./story";
import "../pages.css";

/* 종목면 — one company, set as a newspaper's company page.
 *
 * The classic detail page stacked ten signal tiles, a three-card brief and a run of
 * panels in the order they were built. This one is laid out the way a financial
 * paper sets a company page: the name and the price across the top with the day's
 * forecast in the ear, a lead story written from the numbers under it, then the
 * sections a reader goes to in order — chart, indicators, who is buying, depth,
 * the company, its peers, what is being said and written, and the raw sessions.
 *
 * Everything the classic KR and US pages carried is here, on the same endpoints and
 * cadences (the quote still polls every ten seconds); what is new is the story, the
 * AI forecast with its track record, period returns against the stock's own index,
 * streak-aware investor flows, a peer table with this stock's rank, comments on
 * board posts, sharing, and a strip of recently opened names.
 *
 * One component for both markets: the differences are data sources and which
 * sections exist (an ETF has no order book, company profile or sector here, a US
 * name has no 수급 or 공매도 feed), not layout. */

interface Quote {
  close: number;
  change: number;
  change_pct: number;
  marcap?: number;
  session?: "pre" | "regular" | "post";
  name?: string;
}

const QUOTE_POLL_MS = 10_000;

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

function TalkTape({ code, us, asset }: { code: string; us: boolean; asset: "STOCK" | "ETF" }) {
  const L = useL();
  const [titles, setTitles] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    const req = us
      ? api.globalDiscussion(code, 20).then((r) => r.items.map((p) => ({ id: p.id, title: p.title || p.text })))
      : api.board(code, 1, false).then((r) => r.items.map((p) => ({ id: p.nid, title: p.title })));
    req.then((t) => !cancelled && setTitles(t.slice(0, 20))).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code, us]);
  if (titles.length === 0) return null;
  const href = `/discussion-explorer?code=${encodeURIComponent(code)}&market=${us ? "US" : "KR"}&asset=${asset}`;
  return (
    <div className="d2-tape sk-talktape" aria-label={L("최근 종목토론 제목", "Latest discussion titles")}>
      <span className="d2-tape-label">TALK</span>
      <div className="d2-tape-viewport">
        <div className="d2-tape-track" style={{ animationDuration: `${Math.max(40, titles.length * 6)}s`, "--tape-dur": `${Math.max(40, titles.length * 6)}s` } as React.CSSProperties}>
          {[...titles, ...titles].map((t, i) => (
            <button key={`${t.id}-${i}`} type="button" className="d2-tape-cell" onClick={() => navigate(href)}>
              <em>{String((i % titles.length) + 1).padStart(2, "0")}</em>
              <span>{t.title}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function StockPage({ code: rawCode, isEtf = false }: { code: string; isEtf?: boolean }) {
  const { lang } = useLanguage();
  const L = useL();
  const code = rawCode.toUpperCase();
  const us = !/^\d[0-9A-Z]{5}$/.test(code);
  const market: "KR" | "US" = us ? "US" : "KR";
  const currency = us ? "USD" : "KRW";
  useBroadsheet();

  const [summary, setSummary] = useState<StockSummary | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
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
  const [active, setActive] = useState("sk-top");
  const [copied, setCopied] = useState(false);
  const { recents } = useWatchlist();
  const bubble = useBubbleMarket(code, us);
  useFinderHotkey(setFinderOpen);

  const name = (us ? quote?.name : summary?.name) ?? "";
  useDocumentTitle(name ? `${name} 주가·차트·수급 | K-Stock Hub` : "종목 상세 | K-Stock Hub");
  useStockDetailSeo({ code, name: name || undefined, market, price: quote?.close ?? summary?.close });

  /* The first load: everything the page draws, independently, so a slow feed never
     holds up the header. */
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setSummary(null);
    setQuote(null);
    setPoints([]);
    setOverview(null);
    setEnrich(null);
    setFlows([]);
    setBench(null);
    setPeers(null);
    setSectorName(null);
    setBoardMarket(null);
    window.scrollTo({ top: 0 });

    if (us) {
      Promise.allSettled([api.usStockQuote(code), api.usStockIndicators(code, 3), isEtf ? Promise.resolve(null) : api.globalEnrichment(code, "ko")]).then(([q, ind, en]) => {
        if (!alive) return;
        if (q.status === "fulfilled") setQuote(q.value);
        else setError(L("해외 종목 정보를 불러오지 못했습니다.", "Could not load this stock."));
        if (ind.status === "fulfilled") setPoints(ind.value.points);
        if (en.status === "fulfilled" && en.value) setEnrich(en.value);
        setLoading(false);
      });
    } else {
      Promise.allSettled([api.summary(code), api.indicators(code, 3), api.quote(code)]).then(([s, ind, q]) => {
        if (!alive) return;
        if (s.status === "fulfilled") setSummary(s.value);
        else setError(L("종목 정보를 불러오지 못했습니다.", "Could not load this stock."));
        if (ind.status === "fulfilled") setPoints(ind.value.points);
        if (q.status === "fulfilled") setQuote(q.value);
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

  /* The live price. */
  useEffect(() => {
    let cancelled = false;
    const poll = () => (us ? api.usStockQuote(code) : api.quote(code)).then((q) => !cancelled && setQuote(q)).catch(() => {});
    const stop = startVisibilityAwareInterval(poll, QUOTE_POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [code, us]);

  useEffect(() => {
    if (!name) return;
    reportStockView(code, name);
    recordRecent({ code, name, market: us ? "US" : boardMarket ?? "KOSPI" });
  }, [code, name, us, boardMarket]);

  const close = quote?.close ?? summary?.close ?? points[points.length - 1]?.close ?? 0;
  const change = quote?.change ?? summary?.change ?? 0;
  const changePct = quote?.change_pct ?? summary?.change_pct ?? 0;
  const tone = toneOf(changePct);
  const latest = points[points.length - 1];
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
    [lang, name, currency, close, change, changePct, points, flows, peers, returns, bench]
  );

  const sections = useMemo(() => {
    const s: { id: string; ko: string; en: string }[] = [
      { id: "sk-top", ko: "1면", en: "Top" },
      { id: "sk-chart", ko: "차트", en: "Chart" },
      { id: "sk-tech", ko: "지표", en: "Indicators" },
    ];
    if (!us) s.push({ id: "sk-flow", ko: "수급", en: "Flows" });
    if (!us && !isEtf) s.push({ id: "sk-depth", ko: "호가·공매도", en: "Depth" });
    if (!isEtf) s.push({ id: "sk-company", ko: "기업", en: "Company" });
    if (!isEtf) s.push({ id: "sk-peers", ko: "업종", en: "Peers" });
    s.push({ id: "sk-room", ko: "뉴스·토론", en: "News · talk" });
    s.push({ id: "sk-daily", ko: "일별", en: "Daily" });
    if (us) s.push({ id: "sk-market", ko: "원자재", en: "Commodities" });
    return s.map((x, i) => ({ ...x, no: String(i).padStart(2, "0") }));
  }, [us, isEtf]);
  useScrollSpy(sections.map((s) => s.id), setActive, [loading]);
  const jump = useCallback((id: string) => {
    jumpTo(id);
    setActive(id);
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
      /* the reader closed the share sheet */
    }
  };

  const asset = isEtf ? "ETF" : "STOCK";
  const explorer = `/discussion-explorer?code=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}&market=${market}&asset=${asset}`;
  const marketLabel = us ? (isEtf ? L("미국 ETF", "US ETF") : L("미국 주식", "US stock")) : isEtf ? L("국내 ETF", "KRX ETF") : boardMarket === "KOSDAQ" ? L("코스닥", "KOSDAQ") : L("코스피", "KOSPI");
  const marcap = us ? (enrich?.marcap_usd ? usd(enrich.marcap_usd) : null) : quote?.marcap ? won(quote.marcap, lang) : null;
  const sessionLabel = us && quote?.session === "pre" ? L("프리마켓", "Pre-market") : us && quote?.session === "post" ? L("애프터마켓", "After-hours") : null;
  const others = recents.filter((r) => r.code.toUpperCase() !== code).slice(0, 8);
  const description = us ? enrich?.description?.split(/(?<=[.!?])\s+/).slice(0, 6) ?? [] : overview?.overview ?? [];

  return (
    <div className="d2 sk" lang={lang}>
      <a className="d2-skip" href="#sk-top">
        {L("본문 바로가기", "Skip to content")}
      </a>
      <Masthead
        onPrint={() => window.print()}
        section={{ ko: "종목", en: "Company", taglineKo: "한 종목을 한 면에 — 시세·수급·지표·뉴스·토론", taglineEn: "One company, one page — price, flows, indicators, news and talk" }}
      />

      {/* The bar that stays: who this is, what it trades at, and where on the page you are. */}
      <div className="d2-cmd sk-bar" data-d2-sticky>
        <div className="d2-cmd-inner sk-bar-inner">
          <div className="sk-bar-id">
            {us && enrich?.logo_url ? <img className="sk-bar-logo" src={enrich.logo_url} alt="" /> : <StockLogo code={code} name={name} className="sk-bar-logo" assetType={isEtf ? "etf" : "stock"} />}
            <b>{name || code}</b>
            <span className={`sk-bar-px is-${tone}`}>
              {close ? price(close) : "—"} <em>{pct(changePct)}</em>
            </span>
          </div>
          <nav className="d2-cmd-index" aria-label={L("지면 목차", "Sections")}>
            {sections.map((s) => (
              <button key={s.id} type="button" className={active === s.id ? "is-on" : ""} aria-current={active === s.id ? "true" : undefined} onClick={() => jump(s.id)}>
                <i>{s.no}</i>
                <span>{L(s.ko, s.en)}</span>
              </button>
            ))}
          </nav>
          <button type="button" className="d2-cmd-find" onClick={() => setFinderOpen(true)} aria-label={L("종목·메뉴 찾기", "Find")}>
            <span className="d2-cmd-find-glyph" aria-hidden="true">
              ⌕
            </span>
            <span className="d2-cmd-find-text">{L("다른 종목 찾기", "Find another stock")}</span>
            <kbd>/</kbd>
          </button>
        </div>
      </div>

      <main className="d2-main">
        {loading && !name && (
          <div className="sk-loading">
            <Skel h={60} w="45%" />
            <Skel h={30} w="30%" />
            <Skel h={380} />
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
            <section id="sk-top" className="d2-sec sk-top" aria-label={name}>
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
                    <Link to={explorer}>{L("종목토론", "Discussion")}</Link>
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
                </div>
                <Forecast code={code} />
              </div>

              <TalkTape code={code} us={us} asset={asset} />

              {story && (
                <article className="sk-story">
                  <p className="d2-lead-kicker">
                    <span>{L("오늘의 종목 기사", "Today's company story")}</span>
                    <span>{L("데이터로 쓴 기사", "Written from data")}</span>
                  </p>
                  <h2>{story.headline}</h2>
                  <p className="d2-lead-byline">
                    <b>{L("마켓데스크 자동조판", "Market Desk, typeset automatically")}</b>
                    {latest?.date}
                  </p>
                  <div className="sk-story-body">
                    {story.deck.map((p, i) => (
                      <p key={i}>
                        {i === 0 && <b className="d2-lead-dateline">{L("【서울=마켓데스크】", us ? "NEW YORK —" : "SEOUL —")}</b>}
                        {p}
                      </p>
                    ))}
                  </div>
                </article>
              )}

              {others.length > 0 && (
                <nav className="sk-recents" aria-label={L("최근 본 종목", "Recently viewed")}>
                  <span>{L("최근 본 종목", "Recently viewed")}</span>
                  {others.map((r) => (
                    <Link key={r.code} to={`/stock/${r.code}`}>
                      {r.name}
                    </Link>
                  ))}
                </nav>
              )}
            </section>

            <section id="sk-chart" className="d2-sec" aria-labelledby="sk-chart-h">
              <SectionHead
                id="sk-chart-h"
                no="01"
                kicker={L("주가 차트", "Price chart")}
                title={L("3년의 가격, 한 장의 그림", "Three years of price on one page")}
                note={L("5·20·60·120일 이동평균과 볼린저 밴드를 켜고 끌 수 있습니다.", "Toggle the 5/20/60/120-day averages and the Bollinger band.")}
              />
              <StockChart points={points} currency={currency} />
            </section>

            <section id="sk-tech" className="d2-sec" aria-labelledby="sk-tech-h">
              <SectionHead
                id="sk-tech-h"
                no="02"
                kicker={L("수익률 · 기술 지표", "Returns · indicators")}
                title={L("얼마나 왔고, 지금 어디쯤인가", "How far it has come, and where it stands")}
                note={bench ? L(`기간 수익률은 ${bench.name} 지수와 같은 기간끼리 비교합니다.`, `Period returns are set against the ${bench.name} over the same sessions.`) : undefined}
              />
              <div className="sk-tech-grid">
                <Returns items={returns} benchName={bench?.name ?? null} />
                <Technicals points={points} currency={currency} />
              </div>
            </section>

            {!us && (
              <section id="sk-flow" className="d2-sec" aria-labelledby="sk-flow-h">
                <SectionHead id="sk-flow-h" no="03" kicker={L("투자자별 수급", "Investor flows")} title={L("누가 사고, 누가 팔았나", "Who bought, who sold")} note={L("외국인·기관·개인의 순매수(억원), 최근 30거래일.", "Net buying by investor (KRW 100M), last 30 sessions.")} />
                <Flows rows={flows} code={code} />
              </section>
            )}

            {!us && !isEtf && (
              <section id="sk-depth" className="d2-sec" aria-labelledby="sk-depth-h">
                <SectionHead id="sk-depth-h" no="04" kicker={L("호가 · 공매도 · 대차", "Order book · short interest")} title={L("대기 물량과 빌린 주식", "Resting orders and borrowed shares")} note={L("실제 공개된 계열만 싣고, 없는 수치는 추정하지 않습니다.", "Only published series are shown; nothing is estimated.")} />
                <div className="sk-depth-grid">
                  <OrderBookLadder code={code} />
                  <ShortInterest code={code} />
                </div>
              </section>
            )}

            {!isEtf && (
              <section id="sk-company" className="d2-sec" aria-labelledby="sk-company-h">
                <SectionHead id="sk-company-h" no={sections.find((s) => s.id === "sk-company")?.no ?? ""} kicker={L("기업 정보", "Company profile")} title={L("무엇을 하는 회사인가", "What the company does")} />
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
            )}

            {!isEtf && (
              <section id="sk-peers" className="d2-sec" aria-labelledby="sk-peers-h">
                <SectionHead id="sk-peers-h" no={sections.find((s) => s.id === "sk-peers")?.no ?? ""} kicker={L("동일 업종 비교", "Sector peers")} title={L("이웃 종목 사이에서", "Among its neighbours")} note={us ? L("S&P 500 같은 섹터 종목.", "S&P 500 names in the same sector.") : L("같은 업종 상장 종목. 열 제목을 누르면 정렬됩니다.", "Listed names in the same sector. Click a column to sort.")} />
                <Peers code={code} market={market} onSummary={setPeers} />
              </section>
            )}

            <section id="sk-room" className="d2-sec" aria-labelledby="sk-room-h">
              <SectionHead id="sk-room-h" no={sections.find((s) => s.id === "sk-room")?.no ?? ""} kicker={L("관련 기사 · 종목 토론", "News · discussion")} title={L("쓰인 것과 말해지는 것", "What is written, and what is said")} note={L("기사와 글은 이 페이지 안에서 읽을 수 있습니다.", "Articles and posts open right here.")} />
              <div className="sk-room">
                <div>
                  <h3 className="sk-col-head">{L("관련 기사", "News")}</h3>
                  <News code={code} name={name} source={us ? "toss" : "naver-finance"} lead />
                </div>
                <div>
                  <h3 className="sk-col-head">{L("종목 토론", "Discussion")}</h3>
                  <Discussion code={code} name={name} source={us ? "toss" : "naver"} explorerHref={explorer} />
                </div>
              </div>
            </section>

            <section id="sk-daily" className="d2-sec" aria-labelledby="sk-daily-h">
              <SectionHead id="sk-daily-h" no={sections.find((s) => s.id === "sk-daily")?.no ?? ""} kicker={L("일별 시세", "Daily prices")} title={L("거래일마다 한 줄", "One line per session")} />
              <Daily code={code} market={market} />
            </section>

            {us && (
              <section id="sk-market" className="d2-sec" aria-labelledby="sk-market-h">
                <SectionHead id="sk-market-h" no={sections.find((s) => s.id === "sk-market")?.no ?? ""} kicker={L("원자재 · 메모리", "Commodities · memory")} title={L("시장 바깥의 가격", "Prices outside the market")} />
                <CommodityDesk />
              </section>
            )}

            <p className="sk-disclaimer">
              {L(
                "공개 시장 데이터를 구조화한 정보 서비스이며 투자 권유가 아닙니다. 지연·정정 가능성이 있으니 최종 판단은 거래소와 공시 원문을 기준으로 하세요.",
                "An information service built from public market data, not investment advice. Figures may be delayed or corrected; rely on exchange filings for decisions."
              )}
            </p>
          </>
        )}
      </main>

      <Colophon />

      <nav className="sk-dock" aria-label={L("빠른 이동", "Quick navigation")}>
        {sections.slice(0, 5).map((s) => (
          <button key={s.id} type="button" className={active === s.id ? "is-on" : ""} onClick={() => jump(s.id)}>
            <i>{s.no}</i>
            <span>{L(s.ko, s.en)}</span>
          </button>
        ))}
        <button type="button" onClick={() => setFinderOpen(true)}>
          <i>⌕</i>
          <span>{L("찾기", "Find")}</span>
        </button>
      </nav>
      <Finder open={finderOpen} onClose={() => setFinderOpen(false)} />
    </div>
  );
}
