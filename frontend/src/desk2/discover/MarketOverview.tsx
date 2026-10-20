import { useEffect, useState } from "react";
import { api, type MarketMapItem } from "../../api/client";
import { useMarketIndices } from "../../useMarketIndices";
import { useMarketTicker } from "../../useMarketTicker";
import { Link } from "../../router";
import { measureBreadth, pct, toneOf } from "../lib";
import { RollingNumber, useOverviewMotion } from "./OverviewMotion";
import "./discovery.css";
import "./overviewMotion.css";

type Props = { market: "kr" | "us"; items: MarketMapItem[]; asOf?: string | null; leadingSector?: string; bigTechMove?: number; bigTechShare?: number };

const CROSS_ASSETS = [
  { symbol: "CL=F", name: "WTI 유가", unit: "USD/배럴", digits: 2 },
  { symbol: "GC=F", name: "금 선물", unit: "USD/트로이온스", digits: 2 },
  { symbol: "SI=F", name: "은 선물", unit: "USD/트로이온스", digits: 2 },
  { symbol: "BTC-USD", name: "비트코인", unit: "USD", digits: 2 },
  { symbol: "XRP-USD", name: "리플 XRP", unit: "USD", digits: 4 },
];

function MiniLine({ points, up, cycle }: { points: number[]; up: boolean; cycle: number }) {
  const clean = points.filter(Number.isFinite);
  if (clean.length < 2) return null;
  const low = Math.min(...clean), range = Math.max(...clean) - low || 1;
  return <svg className={`ed-mini-line ${up ? "is-up" : "is-down"}`} viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true"><path key={cycle} className="ed-overview-trace" pathLength="1" d={clean.map((value, i) => `${i ? "L" : "M"}${i / (clean.length - 1) * 120},${26 - (value - low) / range * 24}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" /></svg>;
}

// Only the history is loaded here; the five-second beat replays the same real line.
const domesticLines = new Map<string, Promise<number[]>>();
function useDomesticLines(market: "kr" | "us") {
  const [lines, setLines] = useState<Record<string, number[]>>({});
  useEffect(() => {
    if (market !== "kr") return;
    let alive = true;
    for (const symbol of ["KOSPI", "KOSDAQ"] as const) {
      let pending = domesticLines.get(symbol);
      if (!pending) {
        pending = api.indexHistory(symbol, 1).then(data => (data.points ?? []).slice(-60).map(point => point.close).filter(Number.isFinite));
        domesticLines.set(symbol, pending);
        pending.catch(() => { domesticLines.delete(symbol); });
      }
      pending.then(points => { if (alive) setLines(previous => ({ ...previous, [symbol]: points })); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [market]);
  return lines;
}

export default function MarketOverview({ market, items, asOf, leadingSector, bigTechMove, bigTechShare }: Props) {
  const indices = useMarketIndices();
  const ticker = useMarketTicker();
  const motion = useOverviewMotion();
  const lines = useDomesticLines(market);
  const number = (text: string) => <RollingNumber text={text} active={motion.active} />;
  const breadth = measureBreadth(items);
  const fx = ticker.find(item => item.symbol === "KRW=X");
  const quotes = market === "kr" ? [
    { name: "KOSPI", price: indices.kospi?.close, change: indices.kospi?.change_pct, points: lines.KOSPI ?? [], url: "/index/kospi" },
    { name: "KOSDAQ", price: indices.kosdaq?.close, change: indices.kosdaq?.change_pct, points: lines.KOSDAQ ?? [], url: "/index/kosdaq" },
  ] : ["^GSPC", "^NDX"].map((symbol, i) => {
    const quote = ticker.find(item => item.symbol === symbol);
    return { name: i ? "NASDAQ 100" : "S&P 500", price: quote?.price, change: quote?.change_pct, points: quote?.points ?? [], url: i ? "/nasdaq100-map" : "/sp500-map" };
  });
  const total = breadth?.total || 1;
  return <div className="ed-market-overview" ref={motion.ref} data-motion={motion.active ? "on" : "off"} data-motion-cycle={motion.cycle}>
    <div className="ed-overview-title"><div><span className="ed-eyebrow">MARKET / {market === "kr" ? "SEOUL" : "NEW YORK"}</span><h1 className="d2-title">{market === "kr" ? "오늘의 국내 시장" : "지금의 미국 시장"}</h1></div><span className="ed-overview-time">{asOf ? <>{number(asOf)} 조회</> : "시장 데이터 확인 중"}<i aria-hidden="true" /></span></div>
    <div className="ed-overview-grid"><div className="ed-overview-quotes">{quotes.map(quote => <Link key={quote.name} to={quote.url} className="ed-overview-quote"><span>{quote.name}<i aria-hidden="true">↗</i></span><strong>{number(quote.price?.toLocaleString("en-US", { maximumFractionDigits: 2 }) ?? "—")}</strong><b className={quote.change != null && quote.change >= 0 ? "is-up" : "is-down"}>{number(pct(quote.change))}</b><MiniLine points={quote.points} up={(quote.change ?? 0) >= 0} cycle={motion.cycle} /></Link>)}</div>
      <div className="ed-overview-breadth"><div><span>시장 안쪽</span><b>{breadth ? <>{number(breadth.up.toLocaleString())}종목 상승</> : "확인 중"}</b><small>{breadth ? <>{number(breadth.total.toLocaleString())}종목 기준</> : ""}</small></div><div key={motion.cycle} className="ed-breadth-line" role="img" aria-label={breadth ? `상승 ${breadth.up}, 보합 ${breadth.flat}, 하락 ${breadth.down}` : "시장 폭 확인 중"}><i className="is-up" style={{ width: `${(breadth?.up ?? 0) / total * 100}%` }} /><i className="is-flat" style={{ width: `${(breadth?.flat ?? 0) / total * 100}%` }} /><i className="is-down" style={{ width: `${(breadth?.down ?? 0) / total * 100}%` }} /></div><p><span className="is-up">상승 {number(String(breadth?.up ?? "—"))}</span><span>보합 {number(String(breadth?.flat ?? "—"))}</span><span className="is-down">하락 {number(String(breadth?.down ?? "—"))}</span></p></div>
      <div className="ed-overview-context"><div><span>원/달러</span><b>{number(fx ? `${fx.price.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}원` : "—")}</b></div>{market === "kr" ? <><div><span>코스피 외국인</span><b className={(indices.kospiInvestor?.foreign_amount ?? 0) >= 0 ? "is-up" : "is-down"}>{number(indices.kospiInvestor ? `${indices.kospiInvestor.foreign_amount > 0 ? "+" : ""}${Math.round(indices.kospiInvestor.foreign_amount).toLocaleString()}억` : "—")}</b></div><div><span>코스피 기관</span><b className={(indices.kospiInvestor?.institution_amount ?? 0) >= 0 ? "is-up" : "is-down"}>{number(indices.kospiInvestor ? `${indices.kospiInvestor.institution_amount > 0 ? "+" : ""}${Math.round(indices.kospiInvestor.institution_amount).toLocaleString()}억` : "—")}</b></div></> : <><div><span>주도 섹터</span><b>{leadingSector ?? "—"}</b></div><div><span>빅테크 7</span><b className={(bigTechMove ?? 0) >= 0 ? "is-up" : "is-down"}>{number(pct(bigTechMove))} <small>{bigTechShare != null ? <>· 비중 {number(`${(bigTechShare * 100).toFixed(0)}%`)}</> : ""}</small></b></div></>}</div></div>
    <div className="ed-overview-assets" role="group" aria-label="유가·금·은·가상자산 시세">
      {CROSS_ASSETS.map(asset => {
        const quote = ticker.find(item => item.symbol === asset.symbol);
        const price = quote && Number.isFinite(quote.price) && quote.price > 0 ? quote.price : null;
        const updated = quote?.quote_time ? new Date(quote.quote_time * 1000).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : null;
        return <div key={asset.symbol} className="ed-asset-quote" title={`${asset.name} · ${asset.unit}${updated ? ` · ${updated} 시세` : ""}`}>
          <span>{asset.name}<small>{asset.unit}</small></span>
          <div><strong>{number(price == null ? "—" : `$${price.toLocaleString("en-US", { minimumFractionDigits: asset.digits, maximumFractionDigits: asset.digits })}`)}</strong><b className={`is-${toneOf(quote?.change_pct)}`}>{number(price == null ? "—" : pct(quote?.change_pct))}</b></div>
          <MiniLine points={quote?.points ?? []} up={(quote?.change_pct ?? 0) >= 0} cycle={motion.cycle} />
        </div>;
      })}
    </div>
  </div>;
}
