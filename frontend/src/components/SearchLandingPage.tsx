import { useEffect, useMemo, useState } from "react";
import { api, IndicatorPoint, InvestorSummaryItem, MarketMapItem, NewsItem, StockSummary } from "../api/client";
import { Link } from "../router";
import Footer from "./Footer";
import Logo from "./Logo";
import "./searchLanding.css";
import "./searchLandingLogoFix.css";

type Kind = "outlook" | "news" | "sector" | "trading" | "investor-ranking" | "etf-compare" | "us-etf" | "sp500";

type Predict = { name: string; prediction?: string; predicted_change_pct?: number; confidence?: number; signals?: string[]; [key: string]: unknown };
type EtfRow = { code: string; name: string; close: number; change_pct: number; turnover: number; returns: Record<string, number | null>; week52_high: number | null; week52_low: number | null; currency: string };

const nf = new Intl.NumberFormat("ko-KR");
const pct = (value: number | null | undefined) => value == null ? "-" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
const tone = (value: number) => value > 0 ? "up" : value < 0 ? "down" : "flat";

export default function SearchLandingPage({ kind, code, slug, codes }: { kind: Kind; code?: string; slug?: string; codes?: string[] }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<StockSummary | null>(null);
  const [indicators, setIndicators] = useState<IndicatorPoint | null>(null);
  const [prediction, setPrediction] = useState<Predict | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [rows, setRows] = useState<MarketMapItem[]>([]);
  const [investors, setInvestors] = useState<InvestorSummaryItem[]>([]);
  const [etfs, setEtfs] = useState<EtfRow[]>([]);
  const [updatedAt, setUpdatedAt] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    const run = async () => {
      if ((kind === "outlook" || kind === "news") && code) {
        const base = await api.summary(code);
        if (cancelled) return;
        setSummary(base); setUpdatedAt(base.date);
        if (kind === "news") setNews((await api.news(code)).items);
        else {
          const [ind, pred] = await Promise.all([
            api.indicators(code, 3),
            fetch(`/api/stock/${encodeURIComponent(code)}/predict`).then(r => { if (!r.ok) throw new Error("전망 데이터를 불러오지 못했습니다."); return r.json(); }),
          ]);
          setIndicators(ind.latest); setPrediction(pred as Predict);
        }
      } else if (kind === "sector" || kind === "trading") {
        const [kospi, kosdaq] = await Promise.all([api.marketMap(500), api.kosdaqMap(200)]);
        if (cancelled) return;
        const all = [...kospi.items, ...kosdaq.items];
        const filtered = kind === "sector" ? all.filter(item => /반도체|전자|semiconductor/i.test(item.sector)) : all;
        filtered.sort((a, b) => kind === "trading" ? ((b.close * (b.volume || 0)) - (a.close * (a.volume || 0))) : b.change_pct - a.change_pct);
        setRows(filtered.slice(0, 100)); setUpdatedAt(kospi.generated_at);
      } else if (kind === "investor-ranking") {
        const [flows, market] = await Promise.all([api.investorSummary(), api.marketMap(500)]);
        const allowed = new Set(market.items.map(item => item.code));
        setInvestors(flows.items.filter(item => allowed.has(item.code)).sort((a, b) => b.foreign_amount - a.foreign_amount).slice(0, 50));
        setUpdatedAt(flows.items[0]?.date || "");
      } else if (kind === "etf-compare" && codes?.length === 2) {
        const values = await Promise.all(codes.map(value => api.etfQuote(value, "KR")));
        setEtfs(values as EtfRow[]); setUpdatedAt(new Date().toISOString());
      } else if (kind === "us-etf") {
        const data = await api.etfs("US");
        setEtfs((data.items as EtfRow[]).sort((a, b) => b.turnover - a.turnover)); setUpdatedAt(data.updated_at);
      } else if (kind === "sp500") {
        const data = await api.sp500Map(503);
        setRows([...data.items].sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0)).slice(0, 100)); setUpdatedAt(data.generated_at);
      }
    };
    run().catch((err: Error) => !cancelled && setError(err.message)).finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [kind, code, slug, codes?.join("/")]);

  const meta = useMemo(() => {
    const name = summary?.name || code || "";
    if (kind === "outlook") return [`${name} 주가 전망`, `${name}의 기술적 지표와 다음 거래일 전망을 데이터로 확인합니다.`];
    if (kind === "news") return [`${name} 관련 뉴스`, `${name} 주가와 함께 최신 관련 뉴스를 날짜순으로 확인합니다.`];
    if (kind === "sector") return ["반도체 관련주·등락률", "코스피·코스닥 반도체 관련주의 현재가, 등락률과 거래대금을 비교합니다."];
    if (kind === "trading") return ["오늘 거래대금 순위", "코스피·코스닥 종목을 현재 거래대금 기준으로 비교합니다."];
    if (kind === "investor-ranking") return ["코스피 외국인 순매수 종목", "코스피 주요 종목의 외국인·기관·개인 순매수 금액을 비교합니다."];
    if (kind === "etf-compare") return ["KODEX 200·TIGER 200 비교", "대표 코스피200 ETF의 가격, 거래대금과 기간 수익률을 나란히 비교합니다."];
    if (kind === "us-etf") return ["미국 ETF 거래대금 순위", "미국 주요 ETF의 현재가, 거래대금과 기간 수익률 순위입니다."];
    return ["S&P500 시가총액 순위", "S&P500 주요 기업을 시가총액 기준으로 비교합니다."];
  }, [kind, summary, code]);

  useEffect(() => {
    document.title = `${meta[0]} | K-Stock Hub`.replace(" | K-Stock Hub | K-Stock Hub", " | K-Stock Hub");
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute("content", meta[1]);
    document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.setAttribute("content", document.title);
    document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.setAttribute("content", meta[1]);
  }, [meta]);

  return <div className="search-landing">
    <header className="sl-header"><Link to="/hub" aria-label="K-Stock Hub 태양계 홈"><Logo className="sl-logo" /></Link><nav><Link to="/">마켓 데스크</Link><Link to="/ranking/trading-value">거래대금</Link><Link to="/sector/semiconductor">반도체</Link><Link to="/ranking/us-etf">미국 ETF</Link></nav></header>
    <main className="sl-main">
      <p className="sl-kicker">K‑STOCK DATA LANDING</p><h1>{meta[0]}</h1><p className="sl-lead">{meta[1]}</p>
      {updatedAt && <p className="sl-updated">데이터 기준 {updatedAt.replace("T", " ").slice(0, 16)}</p>}
      {loading && <div className="sl-state">시장 데이터를 불러오는 중입니다.</div>}
      {error && <div className="sl-state sl-error">{error}</div>}
      {!loading && !error && summary && <section className="sl-summary"><div><span>현재가</span><strong>{nf.format(summary.close)}원</strong></div><div><span>등락률</span><strong className={tone(summary.change_pct)}>{pct(summary.change_pct)}</strong></div><div><span>거래량</span><strong>{nf.format(summary.volume)}주</strong></div></section>}
      {!loading && kind === "outlook" && indicators && <><section className="sl-cards"><article><span>전망</span><strong>{String(prediction?.prediction || prediction?.result || "데이터 분석")}</strong><p>예상 변동 {pct(Number(prediction?.predicted_change_pct ?? prediction?.change_rate ?? 0))}</p></article><article><span>RSI(14)</span><strong>{indicators.rsi14?.toFixed(1) || "-"}</strong><p>{(indicators.rsi14 || 50) >= 70 ? "과열 구간" : (indicators.rsi14 || 50) <= 30 ? "침체 구간" : "중립 구간"}</p></article><article><span>MACD</span><strong>{indicators.macd?.toFixed(2) || "-"}</strong><p>신호선 {indicators.macd_signal?.toFixed(2) || "-"}</p></article></section><Related code={code!} /></>}
      {!loading && kind === "news" && <><section className="sl-news">{news.map(item => <a key={item.link} href={item.link} target="_blank" rel="noreferrer"><span>{item.press} · {item.date}</span><h2>{item.title}</h2>{item.summary && <p>{item.summary}</p>}</a>)}</section><Related code={code!} /></>}
      {!loading && rows.length > 0 && <StockTable rows={rows} mode={kind} />}
      {!loading && investors.length > 0 && <section className="sl-table-wrap"><table><thead><tr><th>순위</th><th>종목</th><th>외국인</th><th>기관</th><th>개인</th></tr></thead><tbody>{investors.map((item, i) => <tr key={item.code}><td>{i + 1}</td><td><Link to={`/stock/${item.code}/investor`}><b>{item.name}</b><small>{item.code}</small></Link></td><td className={tone(item.foreign_amount)}>{nf.format(item.foreign_amount)}억원</td><td>{nf.format(item.institution_amount)}억원</td><td>{nf.format(item.individual_amount)}억원</td></tr>)}</tbody></table></section>}
      {!loading && etfs.length > 0 && <section className="sl-table-wrap"><table><thead><tr><th>ETF</th><th>현재가</th><th>등락률</th><th>거래대금</th><th>1개월</th><th>3개월</th><th>YTD</th></tr></thead><tbody>{etfs.map(item => <tr key={item.code}><td><b>{item.name}</b><small>{item.code}</small></td><td>{nf.format(item.close)} {item.currency}</td><td className={tone(item.change_pct)}>{pct(item.change_pct)}</td><td>{nf.format(Math.round(item.turnover))}</td><td>{pct(item.returns?.d20)}</td><td>{pct(item.returns?.d60)}</td><td>{pct(item.returns?.ytd)}</td></tr>)}</tbody></table></section>}
    </main><Footer />
  </div>;
}

function Related({ code }: { code: string }) { return <nav className="sl-related"><h2>관련 분석</h2><Link to={`/stock/${code}`}>주가·차트</Link><Link to={`/stock/${code}/investor`}>외국인·기관 수급</Link><Link to={`/stock/${code}/outlook`}>주가 전망</Link><Link to={`/stock/${code}/news`}>관련 뉴스</Link></nav>; }
function StockTable({ rows, mode }: { rows: MarketMapItem[]; mode: Kind }) { return <section className="sl-table-wrap"><table><thead><tr><th>순위</th><th>종목</th><th>업종</th><th>현재가</th><th>등락률</th><th>{mode === "sp500" ? "시가총액" : "거래대금"}</th></tr></thead><tbody>{rows.map((item, i) => <tr key={item.code}><td>{i + 1}</td><td><Link to={/^[0-9]{6}$/.test(item.code) ? `/stock/${item.code}` : `/global?code=${item.code}`}><b>{item.name}</b><small>{item.code}</small></Link></td><td>{item.sector}</td><td>{nf.format(item.close)}</td><td className={tone(item.change_pct)}>{pct(item.change_pct)}</td><td>{nf.format(Math.round(mode === "sp500" ? (item.market_cap || 0) : item.close * (item.volume || 0)))}</td></tr>)}</tbody></table></section>; }
