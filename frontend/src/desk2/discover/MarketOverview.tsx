import { useEffect, useState } from "react";
import { api, type MarketMapItem, type MarketSession } from "../../api/client";
import { useMarketIndices } from "../../useMarketIndices";
import { useMarketTicker } from "../../useMarketTicker";
import { Link } from "../../router";
import { pct, toneOf, useL } from "../lib";
import MarketBreadth from "./MarketBreadth";
import NeoIndexChart from "../../neo/NeoIndexChart";
import { useDesignMode } from "../../neo/settings";
import { RollingNumber, useOverviewMotion } from "./OverviewMotion";
import "./discovery.css";
import "./overviewMotion.css";
import "./marketOverview.css";
import { marketAssetPath } from "../../marketAssets";

type Props = { market: "kr" | "us"; items: MarketMapItem[]; asOf?: string | null; generatedAt?: string | null; session?: MarketSession | null; leadingSector?: string; bigTechMove?: number; bigTechShare?: number };

function stamp(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`;
}

const CROSS_ASSETS = [
  { symbol: "CL=F", name: "WTI 유가", en: "WTI oil", unit: "USD/배럴", unitEn: "USD/barrel", digits: 2 },
  { symbol: "GC=F", name: "금 선물", en: "Gold futures", unit: "USD/트로이온스", unitEn: "USD/troy oz", digits: 2 },
  { symbol: "SI=F", name: "은 선물", en: "Silver futures", unit: "USD/트로이온스", unitEn: "USD/troy oz", digits: 2 },
  { symbol: "BTC-USD", name: "비트코인", en: "Bitcoin", unit: "USD", unitEn: "USD", digits: 2 },
  { symbol: "ETH-USD", name: "이더리움", en: "Ethereum", unit: "USD", unitEn: "USD", digits: 2 },
  { symbol: "XRP-USD", name: "리플 XRP", en: "XRP", unit: "USD", unitEn: "USD", digits: 4 },
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

export default function MarketOverview({ market, items, asOf, generatedAt, session, leadingSector, bigTechMove, bigTechShare }: Props) {
  const design = useDesignMode();
  const L = useL();
  const indices = useMarketIndices();
  const ticker = useMarketTicker();
  const motion = useOverviewMotion();
  const lines = useDomesticLines(market);
  const number = (text: string) => <RollingNumber text={text} active={motion.active} />;
  const fx = ticker.find(item => item.symbol === "KRW=X");
  const quotes = market === "kr" ? [
    { name: "KOSPI", price: indices.kospi?.close, change: indices.kospi?.change_pct, points: lines.KOSPI ?? [], url: "/index/kospi", time: indices.kospi?.updated_at },
    { name: "KOSDAQ", price: indices.kosdaq?.close, change: indices.kosdaq?.change_pct, points: lines.KOSDAQ ?? [], url: "/index/kosdaq", time: indices.kosdaq?.updated_at },
  ] : ["^GSPC", "^NDX"].map((symbol, i) => {
    const quote = ticker.find(item => item.symbol === symbol);
    return { name: i ? "NASDAQ 100" : "S&P 500", price: quote?.price, change: quote?.change_pct, points: quote?.points ?? [], url: i ? "/nasdaq100-map" : "/sp500-map", time: quote?.quote_time ? new Date(quote.quote_time * 1000).toISOString() : undefined };
  });
  const collected = stamp(generatedAt) ?? asOf;
  const sessionText = session === "pre" ? L("프리마켓", "Pre-market") : session === "post" ? L("애프터마켓", "After-hours") : session === "regular" ? L("정규장", "Regular session") : null;
  const flow = (value?: number) => value != null && Number.isFinite(value) ? `${value > 0 ? "+" : ""}${Math.round(value).toLocaleString()}${L("억", "")}` : "—";
  return <div className="ed-market-overview" ref={motion.ref} data-market={market} data-motion={motion.active ? "on" : "off"} data-motion-cycle={motion.cycle}>
    <div className="ed-overview-topline"><nav className="ed-market-switch" aria-label={L("시장 선택", "Choose a market")}><Link to="/desk" aria-current={market === "kr" ? "page" : undefined}>{L("한국 시장", "Korea")}<span>KR</span></Link><Link to="/global" aria-current={market === "us" ? "page" : undefined}>{L("미국 시장", "United States")}<span>US</span></Link></nav><span className="ed-overview-time">{collected ? <>{L("종목 집계", "Stocks as of")} <time dateTime={generatedAt ?? undefined}>{collected}</time> KST</> : L("시장 데이터 확인 중", "Waiting for market data")}</span></div>
    <div className="ed-overview-title"><div><span className="ed-eyebrow">MARKET / {market === "kr" ? "SEOUL" : "NEW YORK"}</span><h1 className="d2-title">{market === "kr" ? L("오늘의 국내 시장", "Korea at a glance") : L("지금의 미국 시장", "The US at a glance")}</h1></div><Link className="ed-market-map-link" to={market === "kr" ? "/kospi-map" : "/sp500-map"}>{L("시장 지도", "Market map")} <span aria-hidden="true">↗</span></Link></div>
    <div className="ed-market-reading"><div className="ed-market-primary"><div className="ed-overview-quotes">{quotes.map(quote => <Link key={quote.name} to={quote.url} className={`ed-overview-quote is-${toneOf(quote.change)}`}>
      <span>{quote.name}<i aria-hidden="true">↗</i></span><strong>{number(quote.price != null && Number.isFinite(quote.price) && quote.price > 0 ? quote.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—")}</strong><b className={`is-${toneOf(quote.change)}`}>{number(pct(quote.change))}</b><MiniLine points={quote.points} up={(quote.change ?? 0) >= 0} cycle={motion.cycle} /><small className="ed-quote-basis">{stamp(quote.time) ? `${stamp(quote.time)} KST` : L("최근 지수 시세", "Latest index quote")}</small>
    </Link>)}</div>
      {design === "neo" && <NeoIndexChart quotes={quotes} />}
      <div className="ed-overview-context"><div><Link to="/prices/usd-krw" className="ed-fx-link"><span>{L("원/달러", "USD/KRW")} ↗</span><b>{number(fx && Number.isFinite(fx.price) && fx.price > 0 ? `${fx.price.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}${L("원", " KRW")}` : "—")}</b></Link></div>{market === "kr" ? <><div><span>{L("코스피 외국인 순매수", "KOSPI foreign net buying")}</span><b className={`is-${toneOf(indices.kospiInvestor?.foreign_amount)}`}>{number(flow(indices.kospiInvestor?.foreign_amount))}</b></div><div><span>{L("코스피 기관 순매수", "KOSPI institutional net buying")}</span><b className={`is-${toneOf(indices.kospiInvestor?.institution_amount)}`}>{number(flow(indices.kospiInvestor?.institution_amount))}</b></div></> : <><div><span>{L("주도 섹터", "Leading sector")}</span><b>{leadingSector ?? "—"}</b></div><div><span>{L("빅테크 7 등락", "Big Tech 7 move")}</span><b className={`is-${toneOf(bigTechMove)}`}>{number(pct(bigTechMove))}{bigTechShare != null && <small>{L("비중", "Weight")} {number(`${(bigTechShare * 100).toFixed(0)}%`)}</small>}</b></div></>}</div>
      <p className="ed-overview-basis">{market === "kr" ? L("지수 전일 대비 · 수급 단위 억원", "Indices vs. previous close · flows in KRW 100M") : <>{L("종목 시세", "Stock quotes")} {sessionText ?? L("세션 확인 중", "Session pending")} · {L("지수와 종목의 기준 시각은 다를 수 있습니다", "Index and stock quote times may differ")}</>}</p>
    </div><MarketBreadth market={market} items={items} active={motion.active} cycle={motion.cycle} /></div>
    <div className="ed-assets-heading"><span>{L("함께 보는 자산", "Across assets")}</span><small>{L("유가 · 귀금속 · 가상자산", "Energy · metals · crypto")}</small></div>
    <div className="ed-overview-assets" role="group" aria-label={L("유가·금·은·가상자산 시세", "Oil, gold, silver and crypto quotes")}>
      {CROSS_ASSETS.map(asset => {
        const quote = ticker.find(item => item.symbol === asset.symbol);
        const price = quote && Number.isFinite(quote.price) && quote.price > 0 ? quote.price : null;
        const updated = quote?.quote_time ? new Date(quote.quote_time * 1000).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : null;
        return <Link to={marketAssetPath(asset.symbol)!} key={asset.symbol} className="ed-asset-quote" title={`${L(asset.name, asset.en)} · ${L(asset.unit, asset.unitEn)}${updated ? ` · ${updated}` : ""}`}>
          <span>{L(asset.name, asset.en)}<small>{L(asset.unit, asset.unitEn)}</small></span>
          <div><strong>{number(price == null ? "—" : `$${price.toLocaleString("en-US", { minimumFractionDigits: asset.digits, maximumFractionDigits: asset.digits })}`)}</strong><b className={`is-${toneOf(quote?.change_pct)}`}>{number(price == null ? "—" : pct(quote?.change_pct))}</b></div>
          <MiniLine points={quote?.points ?? []} up={(quote?.change_pct ?? 0) >= 0} cycle={motion.cycle} />
        </Link>;
      })}
    </div>
  </div>;
}
