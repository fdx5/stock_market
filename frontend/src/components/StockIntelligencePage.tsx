import { useEffect, useMemo, useState } from "react";
import type { CompanyOverview, IndicatorPoint, InvestorTrendRecord, NewsItem, StockQuote, StockSummary } from "../api/client";
import { api } from "../api/client";
import { Link, navigate } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import { useStockDetailSeo } from "../useStockDetailSeo";
import BoardPanel from "./BoardPanel";
import DailyPricePanel from "./DailyPricePanel";
import DiscussionHeadlineTicker from "./DiscussionHeadlineTicker";
import Footer from "./Footer";
import IndicatorPanel from "./IndicatorPanel";
import MarketBubbleStockLink from "./MarketBubbleStockLink";
import NewsPanel from "./NewsPanel";
import OrderBookPanel from "./OrderBookPanel";
import PriceChart from "./PriceChart";
import SearchBar from "./SearchBar";
import ShortSellPanel from "./ShortSellPanel";
import StockIcon from "./StockIcon";
import StockDetailDeskHeader from "./StockDetailDeskHeader";
import "./stockIntelligence.css";

type Section = "chart" | "flow" | "orderbook" | "short" | "company" | "news" | "board" | "daily";

const nf = new Intl.NumberFormat("ko-KR");
const compact = new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 });
const sectionNav: { id: Section; label: string }[] = [
  { id: "chart", label: "차트·기술지표" }, { id: "flow", label: "투자자 수급" },
  { id: "orderbook", label: "호가" }, { id: "short", label: "공매도·대차" },
  { id: "company", label: "기업정보" }, { id: "news", label: "관련뉴스" },
  { id: "board", label: "종목토론" }, { id: "daily", label: "일별시세" },
];

function tone(value: number | null | undefined) { return (value ?? 0) > 0 ? "is-up" : (value ?? 0) < 0 ? "is-down" : ""; }
function pct(value: number | null | undefined) { return value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`; }
function amount(value: number) { return `${value > 0 ? "+" : ""}${compact.format(value)}원`; }

function FlowTable({ rows }: { rows: InvestorTrendRecord[] }) {
  const totals = useMemo(() => rows.reduce((a, r) => ({ individual: a.individual + r.individual_amount, institution: a.institution + r.institution_amount, foreign: a.foreign + r.foreign_amount }), { individual: 0, institution: 0, foreign: 0 }), [rows]);
  return <>
    <div className="si-flow-summary">
      {([['외국인', totals.foreign], ['기관', totals.institution], ['개인', totals.individual]] as const).map(([label, value]) => <div key={label}><span>{label} 누적 순매수</span><strong className={tone(value)}>{amount(value)}</strong></div>)}
    </div>
    <div className="si-table-scroll"><table className="si-table"><thead><tr><th>일자</th><th>종가</th><th>외국인</th><th>기관</th><th>개인</th></tr></thead><tbody>{rows.map(r => <tr key={r.date}><td>{r.date.slice(5).replace('-', '.')}</td><td>{nf.format(r.close)}</td><td className={tone(r.foreign_amount)}>{amount(r.foreign_amount)}</td><td className={tone(r.institution_amount)}>{amount(r.institution_amount)}</td><td className={tone(r.individual_amount)}>{amount(r.individual_amount)}</td></tr>)}</tbody></table></div>
  </>;
}

export default function StockIntelligencePage({ code }: { code: string }) {
  const [summary, setSummary] = useState<StockSummary | null>(null);
  const [quote, setQuote] = useState<StockQuote | null>(null);
  const [points, setPoints] = useState<IndicatorPoint[]>([]);
  const [overview, setOverview] = useState<CompanyOverview | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [flows, setFlows] = useState<InvestorTrendRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeSection, setActiveSection] = useState<Section>("chart");
  useDocumentTitle(summary ? `${summary.name} 종합분석·주가·수급 | K-Stock Hub` : "종목 종합정보 | K-Stock Hub");
  useStockDetailSeo({ code, name: summary?.name, market: "KR", price: summary?.close });

  useEffect(() => {
    let alive = true; setLoading(true); setError(""); window.scrollTo({ top: 0 });
    Promise.allSettled([api.summary(code), api.indicators(code, 3), api.overview(code), api.news(code), api.investorTrend(code, 30), api.quote(code)])
      .then(results => {
        if (!alive) return;
        const [s, p, o, n, f, q] = results;
        if (s.status === "fulfilled") setSummary(s.value); else setError("종목 정보를 불러오지 못했습니다.");
        if (p.status === "fulfilled") setPoints(p.value.points);
        if (o.status === "fulfilled") setOverview(o.value);
        if (n.status === "fulfilled") setNews(n.value.items);
        if (f.status === "fulfilled") setFlows(f.value.records);
        if (q.status === "fulfilled") setQuote(q.value);
      }).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [code]);

  useEffect(() => {
    const sections = sectionNav
      .map(({ id }) => document.getElementById(`si-${id}`))
      .filter((element): element is HTMLElement => Boolean(element));
    if (!sections.length || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActiveSection(visible.target.id.replace("si-", "") as Section);
      },
      { rootMargin: "-145px 0px -55% 0px", threshold: [0.05, 0.25, 0.5] },
    );
    sections.forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, [summary]);

  const latest = points[points.length - 1];
  const previous20 = points[points.length - 21]?.close;
  const return20 = latest && previous20 ? ((latest.close / previous20) - 1) * 100 : null;
  const high52 = points.slice(-252).reduce((m, p) => Math.max(m, p.high), 0);
  const low52 = points.slice(-252).reduce((m, p) => Math.min(m, p.low), Number.POSITIVE_INFINITY);
  const rangePos = summary && high52 > low52 ? ((summary.close - low52) / (high52 - low52)) * 100 : null;
  const flow20 = flows.slice(0, 20).reduce((a, r) => a + r.foreign_amount + r.institution_amount, 0);
  const volumeRatio = latest?.volume_ma20 ? (latest.volume / latest.volume_ma20) * 100 : null;
  const trendAlignment = latest?.sma5 != null && latest?.sma20 != null && latest?.sma60 != null
    ? latest.sma5 > latest.sma20 && latest.sma20 > latest.sma60 ? "정배열" : latest.sma5 < latest.sma20 && latest.sma20 < latest.sma60 ? "역배열" : "혼조"
    : "—";
  const bandPosition = latest?.bb_upper != null && latest?.bb_lower != null && latest.bb_upper > latest.bb_lower
    ? ((latest.close - latest.bb_lower) / (latest.bb_upper - latest.bb_lower)) * 100 : null;
  const priceStructure = latest?.sma20 == null
    ? "산출 대기"
    : latest.close >= latest.sma20 ? "20일선 상단" : "20일선 하단";
  const participation = flow20 > 0 ? "기관·외국인 순매수" : flow20 < 0 ? "기관·외국인 순매도" : "수급 중립";
  const riskLevel = latest?.volatility20 == null
    ? "산출 대기"
    : latest.volatility20 >= 40 ? "변동성 높음" : latest.volatility20 >= 20 ? "변동성 보통" : "변동성 낮음";
  const scroll = (id: Section) => document.getElementById(`si-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return <div className="si-page">
    <StockDetailDeskHeader market="KR" />

    <div className="si-detail-search-deck"><div><span>STOCK LOOKUP</span><strong>종목 통합검색</strong><small>국내·해외 종목명 또는 코드를 검색하세요.</small></div><div className="si-search"><SearchBar onSelect={stock => navigate(`/stock/${stock.code.toUpperCase()}`)} /></div></div>

    {loading && !summary && <div className="si-loading">시장 데이터를 정리하고 있습니다…</div>}
    {error && !summary && <div className="si-loading is-error">{error}</div>}
    {summary && <main>
      <section className="si-hero">
        <div className="si-identity"><StockIcon code={code} className="si-logo" /><div><span className="si-market">KRX · {summary.date}</span><h1>{summary.name}</h1><p>{code}</p></div></div>
        <div className="si-quote"><strong>{nf.format(summary.close)}<small>원</small></strong><span className={tone(summary.change)}>{summary.change > 0 ? "+" : ""}{nf.format(summary.change)} · {pct(summary.change_pct)}</span></div>
        <div className="si-hero-action"><button onClick={() => scroll("chart")}>종합 분석 보기 ↓</button><Link to={`/discussion-explorer?code=${code}&name=${encodeURIComponent(summary.name)}&market=KR&asset=STOCK`}>토론 바로가기</Link><MarketBubbleStockLink code={code} market="kr" /></div>
      </section>
      <div className="si-talk-ticker"><DiscussionHeadlineTicker code={code} limit={30} /></div>

      <section className="si-signal-grid" aria-label="핵심 투자 지표">
        <article><span>20거래일 추세</span><strong className={tone(return20)}>{pct(return20)}</strong><small>단기 가격 모멘텀</small></article>
        <article><span>RSI 14</span><strong>{latest?.rsi14?.toFixed(1) ?? "—"}</strong><small>{latest?.rsi14 != null ? latest.rsi14 >= 70 ? "과열 구간" : latest.rsi14 <= 30 ? "침체 구간" : "중립 구간" : "데이터 대기"}</small></article>
        <article><span>52주 가격 위치</span><strong>{rangePos == null ? "—" : `${rangePos.toFixed(0)}%`}</strong><small>{low52 < Infinity ? `${nf.format(low52)} — ${nf.format(high52)}` : "범위 계산 중"}</small></article>
        <article><span>외국인+기관 20일</span><strong className={tone(flow20)}>{amount(flow20)}</strong><small>누적 순매수 금액</small></article>
        <article><span>거래량</span><strong>{compact.format(summary.volume)}</strong><small>최근 거래일 체결량</small></article>
        <article><span>변동성 20</span><strong>{latest?.volatility20 == null ? "—" : `${latest.volatility20.toFixed(1)}%`}</strong><small>최근 변동 위험</small></article>
        <article><span>시가총액</span><strong>{quote?.marcap ? `${(quote.marcap / 1e12).toFixed(1)}조` : "—"}</strong><small>현재가 기준</small></article>
        <article><span>거래량 강도</span><strong>{volumeRatio == null ? "—" : `${volumeRatio.toFixed(0)}%`}</strong><small>20일 평균 대비</small></article>
        <article><span>이동평균 배열</span><strong>{trendAlignment}</strong><small>5일·20일·60일선</small></article>
        <article><span>볼린저밴드 위치</span><strong>{bandPosition == null ? "—" : `${bandPosition.toFixed(0)}%`}</strong><small>하단 0 · 상단 100</small></article>
      </section>

      <section className="si-research-brief" aria-label="오늘의 체크포인트">
        <header><div><span>RESEARCH BRIEF</span><h2>오늘의 체크포인트</h2></div><p>{summary.date} 종가 및 최근 공개 데이터 기준</p></header>
        <div className="si-brief-grid">
          <article><span>가격 구조</span><strong>{priceStructure}</strong><p>이동평균 배열은 {trendAlignment}, 20거래일 수익률은 {pct(return20)}입니다.</p></article>
          <article><span>시장 참여</span><strong className={tone(flow20)}>{participation}</strong><p>최근 20거래일 합산 {amount(flow20)}, 거래량은 20일 평균의 {volumeRatio == null ? "산출 대기" : `${volumeRatio.toFixed(0)}%`}입니다.</p></article>
          <article><span>위험 관찰</span><strong>{riskLevel}</strong><p>20일 변동성 {latest?.volatility20 == null ? "산출 대기" : `${latest.volatility20.toFixed(1)}%`}, 52주 범위 내 {rangePos == null ? "산출 대기" : `${rangePos.toFixed(0)}%`} 위치입니다.</p></article>
        </div>
      </section>

      <nav className="si-section-nav" aria-label="종목 상세 섹션">{sectionNav.map(item => <button key={item.id} className={activeSection === item.id ? "is-active" : ""} aria-current={activeSection === item.id ? "location" : undefined} onClick={() => scroll(item.id)}>{item.label}</button>)}</nav>

      <section className="si-section si-chart-section" id="si-chart"><header><div><span>PRICE ACTION</span><h2>추세와 기술지표</h2></div><p>가격·거래량·이동평균과 모멘텀을 같은 시간축에서 읽습니다.</p></header><div className="si-chart-grid"><div className="si-panel si-price-chart"><PriceChart points={points} /></div><div className="si-panel"><IndicatorPanel points={points} latest={latest ?? null} /></div></div></section>

      <div className="si-two-col">
        <section className="si-section" id="si-flow"><header><div><span>OWNERSHIP FLOW</span><h2>투자자별 수급</h2></div><p>최근 30거래일 순매수 금액</p></header><div className="si-panel"><FlowTable rows={flows} /></div></section>
        <section className="si-section" id="si-orderbook"><header><div><span>MARKET DEPTH</span><h2>호가와 잔량</h2></div><p>매수·매도 대기 물량의 균형</p></header><div className="si-panel"><OrderBookPanel code={code} /></div></section>
      </div>

      <section className="si-section" id="si-short"><header><div><span>POSITIONING RISK</span><h2>공매도·대차·신용</h2></div><p>실제 공개된 계열만 제공하며 없는 수치는 추정하지 않습니다.</p></header><div className="si-panel"><ShortSellPanel code={code} /></div></section>

      <section className="si-section" id="si-company"><header><div><span>COMPANY PROFILE</span><h2>기업 정보와 밸류에이션</h2></div></header><div className="si-company-grid"><div className="si-panel si-company-copy">{overview?.overview?.length ? overview.overview.map((line, i) => <p key={i}>{line}</p>) : <p>기업 개요를 준비하고 있습니다.</p>}</div><div className="si-company-facts"><div><span>예상 PER</span><strong>{overview?.per_estimate ? `${overview.per_estimate}배` : "—"}</strong></div><div><span>발행주식수</span><strong>{overview?.shares_outstanding ? compact.format(overview.shares_outstanding) : "—"}</strong></div><div><span>MACD</span><strong className={tone(latest?.macd_hist)}>{latest?.macd_hist?.toFixed(2) ?? "—"}</strong></div><div><span>ATR 14</span><strong>{latest?.atr14?.toFixed(0) ?? "—"}</strong></div></div></div></section>

      <div className="si-two-col si-content-pair">
        <section className="si-section" id="si-news"><header><div><span>CATALYSTS</span><h2>관련 뉴스</h2></div></header><div className="si-panel"><NewsPanel items={news} name={summary.name} /></div></section>
        <section className="si-section" id="si-board"><header><div><span>MARKET VOICE</span><h2>종목 토론</h2></div></header><div className="si-panel"><BoardPanel code={code} name={summary.name} /></div></section>
      </div>

      <section className="si-section" id="si-daily"><header><div><span>RAW MARKET DATA</span><h2>일별 시세</h2></div><p>시가·고가·저가·종가·거래량·거래대금</p></header><div className="si-panel"><DailyPricePanel code={code} /></div></section>
      <p className="si-disclaimer">본 페이지는 공개 시장 데이터를 구조화한 정보 서비스이며 투자 권유가 아닙니다. 지연·정정 가능성을 확인하고 최종 판단은 거래소 및 공시 원문을 기준으로 하세요.</p>
    </main>}
    <Footer />
  </div>;
}
