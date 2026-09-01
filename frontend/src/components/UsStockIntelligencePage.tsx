import { useEffect, useMemo, useState } from "react";
import type { CompanyNewsItem, GlobalEnrichment, IndicatorPoint, UsStockQuote } from "../api/client";
import { api } from "../api/client";
import { Link, navigate } from "../router";
import { reportStockView } from "../useActivityTracking";
import { useDocumentTitle } from "../useDocumentTitle";
import { useStockDetailSeo } from "../useStockDetailSeo";
import { recordRecent } from "../watchlist";
import { startVisibilityAwareInterval } from "../pollVisibility";
import CommodityPanel from "./CommodityPanel";
import DailyPricePanel from "./DailyPricePanel";
import DiscussionHeadlineTicker from "./DiscussionHeadlineTicker";
import Footer from "./Footer";
import GlobalBoardPanel from "./GlobalBoardPanel";
import GlobalNewsList from "./GlobalNewsList";
import IndicatorPanel from "./IndicatorPanel";
import MarketBubbleStockLink from "./MarketBubbleStockLink";
import PriceChart from "./PriceChart";
import SearchBar from "./SearchBar";
import StockDetailDeskHeader from "./StockDetailDeskHeader";
import StockIntelligenceSkeleton from "./StockIntelligenceSkeleton";
import UsSectorMapPanel from "./UsSectorMapPanel";
import "./stockIntelligence.css";

const pct = (value: number | null | undefined) => value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
const tone = (value: number | null | undefined) => (value ?? 0) > 0 ? "is-up" : (value ?? 0) < 0 ? "is-down" : "";
const money = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cap = (value: number | null | undefined) => !value ? "—" : value >= 1e12 ? `$${(value / 1e12).toFixed(2)}T` : `$${(value / 1e9).toFixed(1)}B`;
// indicators.py stores volatility20 as the raw standard deviation of daily returns
// (0.0214 = 2.14% a day), not a percentage — printed straight it read "0.0%" on every
// ticker. Same scale as IndicatorPanel's 20일 변동성 tile further down this page.
const dailyVolPct = (value: number | null | undefined) => value == null ? null : value * 100;
const QUOTE_POLL_MS = 10_000;

export default function UsStockIntelligencePage({ code }: { code: string }) {
  const ticker = code.toUpperCase();
  const [quote, setQuote] = useState<UsStockQuote | null>(null);
  const [points, setPoints] = useState<IndicatorPoint[]>([]);
  const [enrichment, setEnrichment] = useState<GlobalEnrichment | null>(null);
  const [news, setNews] = useState<CompanyNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useDocumentTitle(quote ? `${quote.name} 종합분석 · K-Stock Intelligence` : `${ticker} 종합분석`);
  useStockDetailSeo({ code: ticker, name: quote?.name, market: "US", price: quote?.close });

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(""); window.scrollTo({ top: 0 });
    Promise.allSettled([
      api.usStockQuote(ticker), api.usStockIndicators(ticker, 3),
      api.globalEnrichment(ticker, "ko"), api.usStockQuote(ticker),
    ]).then(async ([q, indicators, enriched]) => {
      if (!alive) return;
      if (q.status === "fulfilled") {
        setQuote(q.value);
        try { const result = await api.fightNews(ticker, q.value.name, "ko", 5); if (alive) setNews(result.items.slice(0, 5)); } catch { if (alive) setNews([]); }
      } else setError("해외 종목 정보를 불러오지 못했습니다.");
      if (indicators.status === "fulfilled") setPoints(indicators.value.points);
      if (enriched.status === "fulfilled") setEnrichment(enriched.value);
    }).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [ticker]);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      api.usStockQuote(ticker)
        .then(value => { if (!cancelled) setQuote(value); })
        .catch(() => { /* Keep the last successful quote on a transient failure. */ });
    };
    const stopPolling = startVisibilityAwareInterval(poll, QUOTE_POLL_MS);
    return () => { cancelled = true; stopPolling(); };
  }, [ticker]);

  // Mirrors the KR page: stock_view for the 인기 종목 ranking, recordRecent for the
  // 최근 본 종목 dock this route already shows.
  useEffect(() => {
    if (!quote) return;
    reportStockView(ticker, quote.name);
    recordRecent({ code: ticker, name: quote.name, market: "US" });
  }, [ticker, quote?.name]);

  const latest = points[points.length - 1];
  const old20 = points[points.length - 21]?.close;
  const return20 = latest && old20 ? (latest.close / old20 - 1) * 100 : null;
  const volumeRatio = latest?.volume_ma20 ? latest.volume / latest.volume_ma20 * 100 : null;
  const high52 = Math.max(...points.slice(-252).map(point => point.high), 0);
  const low52 = Math.min(...points.slice(-252).map(point => point.low), Number.POSITIVE_INFINITY);
  const range52 = latest && high52 > low52 ? (latest.close - low52) / (high52 - low52) * 100 : null;
  const volatilityPct = dailyVolPct(latest?.volatility20);
  const description = useMemo(() => enrichment?.description?.split(/(?<=[.!?])\s+/).slice(0, 5) ?? [], [enrichment]);

  return <div className="si-page si-page--us">
    <StockDetailDeskHeader market="US" />
    <div className="si-detail-search-deck"><div><span>GLOBAL STOCK LOOKUP</span><strong>해외·국내 종목 통합검색</strong><small>기업명 또는 티커를 검색하면 종합정보로 이동합니다.</small></div><div className="si-search"><SearchBar onSelect={stock => navigate(`/stock/${stock.code.toUpperCase()}`)} /></div></div>
    {loading && !quote && <StockIntelligenceSkeleton signals={6} brief={false} label="해외 시장 데이터를 정리하고 있습니다…" />}
    {error && !quote && <div className="si-loading is-error">{error}</div>}
    {quote && <main>
      <section className="si-hero">
        <div className="si-identity">{enrichment?.logo_url ? <img className="si-logo si-global-logo" src={enrichment.logo_url} alt="" /> : <span className="si-ticker-logo">{ticker.slice(0, 2)}</span>}<div><span className="si-market">US MARKET · {latest?.date ?? "LATEST"}</span><h1>{quote.name}</h1><p>{ticker}</p></div></div>
        <div className="si-quote"><strong>{money(quote.close)}</strong><span className={tone(quote.change)}>{quote.change >= 0 ? "+" : ""}{money(Math.abs(quote.change))} · {pct(quote.change_pct)}</span><small className="si-session-label">{quote.session === "pre" ? "프리마켓" : quote.session === "post" ? "애프터마켓" : "정규장"}</small></div>
        <div className="si-hero-action"><button onClick={() => document.getElementById("si-chart")?.scrollIntoView({ behavior: "smooth" })}>종합 분석 보기 ↓</button><Link to={`/discussion-explorer?code=${ticker}&name=${encodeURIComponent(quote.name)}&market=US&asset=STOCK`}>토론 바로가기</Link><MarketBubbleStockLink code={ticker} market="nasdaq" /></div>
      </section>
      <div className="si-talk-ticker"><DiscussionHeadlineTicker code={ticker} market="US" limit={30} /></div>
      <section className="si-signal-grid" aria-label="해외 종목 핵심 지표">
        <article><span>20거래일 추세</span><strong className={tone(return20)}>{pct(return20)}</strong><small>단기 가격 모멘텀</small></article>
        <article><span>RSI 14</span><strong>{latest?.rsi14?.toFixed(1) ?? "—"}</strong><small>{(latest?.rsi14 ?? 50) >= 70 ? "과열 구간" : (latest?.rsi14 ?? 50) <= 30 ? "침체 구간" : "중립 구간"}</small></article>
        <article><span>52주 가격 위치</span><strong>{range52 == null ? "—" : `${range52.toFixed(0)}%`}</strong><small>연중 저점 0 · 고점 100</small></article>
        <article><span>시가총액</span><strong>{cap(enrichment?.marcap_usd)}</strong><small>미국 달러 기준</small></article>
        <article><span>거래량 강도</span><strong>{volumeRatio == null ? "—" : `${volumeRatio.toFixed(0)}%`}</strong><small>20일 평균 대비</small></article>
        <article><span>변동성 20</span><strong>{volatilityPct == null ? "—" : `${volatilityPct.toFixed(2)}%`}</strong><small>20일 일간 변동 폭</small></article>
      </section>
      <section className="si-section si-chart-section" id="si-chart"><header><div><span>PRICE ACTION</span><h2>추세와 기술지표</h2></div><p>3년 가격·거래량·이동평균을 동일 시간축에서 확인합니다.</p></header><div className="si-chart-grid"><div className="si-panel si-price-chart"><PriceChart points={points} /></div><div className="si-panel"><IndicatorPanel points={points} latest={latest ?? null} defaultExpanded /></div></div></section>
      <section className="si-section"><header><div><span>MARKET CONTEXT</span><h2>글로벌 원자재·메모리 지표</h2></div><p>주요 선물과 메모리 현물 가격</p></header><CommodityPanel /></section>
      <section className="si-section"><header><div><span>COMPANY PROFILE</span><h2>기업 개요</h2></div></header><div className="si-company-grid"><div className="si-panel si-company-copy">{description.length ? description.map((line, index) => <p key={index}>{line}</p>) : <p>기업 설명 데이터를 준비하고 있습니다.</p>}</div><div className="si-company-facts"><div><span>티커</span><strong>{ticker}</strong></div><div><span>시가총액</span><strong>{cap(enrichment?.marcap_usd)}</strong></div><div><span>MACD</span><strong className={tone(latest?.macd_hist)}>{latest?.macd_hist?.toFixed(2) ?? "—"}</strong></div><div><span>ATR 14</span><strong>{latest?.atr14 == null ? "—" : money(latest.atr14)}</strong></div></div></div></section>
      <div className="si-two-col si-content-pair"><section className="si-section"><header><div><span>CATALYSTS</span><h2>관련 뉴스</h2></div><p>한국어 번역 · 최신 5건</p></header><div className="si-panel"><GlobalNewsList code={ticker} name={quote.name} items={news} loading={loading} language="ko" /></div></section><section className="si-section"><header><div><span>MARKET VOICE</span><h2>해외 종목 토론</h2></div></header><div className="si-panel"><GlobalBoardPanel code={ticker} name={quote.name} /></div></section></div>
      <section className="si-section"><header><div><span>SECTOR CONTEXT</span><h2>동일 업종 비교</h2></div><p>S&amp;P 500 동일 섹터 종목</p></header><div className="si-panel"><UsSectorMapPanel code={ticker} onSelectStock={stock => navigate(`/stock/${stock.code}`)} /></div></section>
      <section className="si-section"><header><div><span>RAW MARKET DATA</span><h2>일별 시세</h2></div><p>시가·고가·저가·종가·거래량</p></header><div className="si-panel"><DailyPricePanel code={ticker} market="US" /></div></section>
      <p className="si-disclaimer">공개 시장 데이터를 구조화한 정보 서비스이며 투자 권유가 아닙니다. 미국 시장 데이터는 제공처와 거래 세션에 따라 지연될 수 있습니다.</p>
    </main>}
    <Footer />
  </div>;
}
