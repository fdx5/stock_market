import { type MarketMapItem } from "../../api/client";
import { useMarketIndices } from "../../useMarketIndices";
import { useMarketTicker } from "../../useMarketTicker";
import { Link } from "../../router";
import { measureBreadth, pct } from "../lib";
import "./discovery.css";

type Props = { market: "kr" | "us"; items: MarketMapItem[]; asOf?: string | null; leadingSector?: string; bigTechMove?: number; bigTechShare?: number };

function MiniLine({ points, up }: { points: number[]; up: boolean }) {
  const clean = points.filter(Number.isFinite);
  if (clean.length < 2) return null;
  const low = Math.min(...clean), range = Math.max(...clean) - low || 1;
  return <svg className={`ed-mini-line ${up ? "is-up" : "is-down"}`} viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true"><path d={clean.map((value, i) => `${i ? "L" : "M"}${i / (clean.length - 1) * 120},${26 - (value - low) / range * 24}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}

export default function MarketOverview({ market, items, asOf, leadingSector, bigTechMove, bigTechShare }: Props) {
  const indices = useMarketIndices();
  const ticker = useMarketTicker();
  const breadth = measureBreadth(items);
  const fx = ticker.find(item => item.symbol === "KRW=X");
  const quotes = market === "kr" ? [
    { name: "KOSPI", price: indices.kospi?.close, change: indices.kospi?.change_pct, points: [] as number[], url: "/index/kospi" },
    { name: "KOSDAQ", price: indices.kosdaq?.close, change: indices.kosdaq?.change_pct, points: [] as number[], url: "/index/kosdaq" },
  ] : ["^GSPC", "^NDX"].map((symbol, i) => {
    const quote = ticker.find(item => item.symbol === symbol);
    return { name: i ? "NASDAQ 100" : "S&P 500", price: quote?.price, change: quote?.change_pct, points: quote?.points ?? [], url: i ? "/nasdaq100-map" : "/sp500-map" };
  });
  const total = breadth?.total || 1;
  return <div className="ed-market-overview">
    <div className="ed-overview-title"><div><span className="ed-eyebrow">MARKET / {market === "kr" ? "SEOUL" : "NEW YORK"}</span><h1>{market === "kr" ? "오늘의 국내 시장" : "지금의 미국 시장"}</h1></div><span className="ed-overview-time">{asOf ? `${asOf} 조회` : "시장 데이터 확인 중"}<i aria-hidden="true" /></span></div>
    <div className="ed-overview-grid"><div className="ed-overview-quotes">{quotes.map(quote => <Link key={quote.name} to={quote.url} className="ed-overview-quote"><span>{quote.name}<i aria-hidden="true">↗</i></span><strong>{quote.price?.toLocaleString("en-US", { maximumFractionDigits: 2 }) ?? "—"}</strong><b className={quote.change != null && quote.change >= 0 ? "is-up" : "is-down"}>{pct(quote.change)}</b><MiniLine points={quote.points} up={(quote.change ?? 0) >= 0} /></Link>)}</div>
      <div className="ed-overview-breadth"><div><span>시장 안쪽</span><b>{breadth ? `${breadth.up.toLocaleString()}종목 상승` : "확인 중"}</b><small>{breadth ? `${breadth.total.toLocaleString()}종목 기준` : ""}</small></div><div className="ed-breadth-line" role="img" aria-label={breadth ? `상승 ${breadth.up}, 보합 ${breadth.flat}, 하락 ${breadth.down}` : "시장 폭 확인 중"}><i className="is-up" style={{ width: `${(breadth?.up ?? 0) / total * 100}%` }} /><i className="is-flat" style={{ width: `${(breadth?.flat ?? 0) / total * 100}%` }} /><i className="is-down" style={{ width: `${(breadth?.down ?? 0) / total * 100}%` }} /></div><p><span className="is-up">상승 {breadth?.up ?? "—"}</span><span>보합 {breadth?.flat ?? "—"}</span><span className="is-down">하락 {breadth?.down ?? "—"}</span></p></div>
      <div className="ed-overview-context"><div><span>원/달러</span><b>{fx ? `${fx.price.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}원` : "—"}</b></div>{market === "kr" ? <><div><span>코스피 외국인</span><b className={(indices.kospiInvestor?.foreign_amount ?? 0) >= 0 ? "is-up" : "is-down"}>{indices.kospiInvestor ? `${indices.kospiInvestor.foreign_amount > 0 ? "+" : ""}${Math.round(indices.kospiInvestor.foreign_amount).toLocaleString()}억` : "—"}</b></div><div><span>코스피 기관</span><b className={(indices.kospiInvestor?.institution_amount ?? 0) >= 0 ? "is-up" : "is-down"}>{indices.kospiInvestor ? `${indices.kospiInvestor.institution_amount > 0 ? "+" : ""}${Math.round(indices.kospiInvestor.institution_amount).toLocaleString()}억` : "—"}</b></div></> : <><div><span>주도 섹터</span><b>{leadingSector ?? "—"}</b></div><div><span>빅테크 7</span><b className={(bigTechMove ?? 0) >= 0 ? "is-up" : "is-down"}>{pct(bigTechMove)} <small>{bigTechShare != null ? `· 비중 ${(bigTechShare * 100).toFixed(0)}%` : ""}</small></b></div></>}</div></div>
  </div>;
}
