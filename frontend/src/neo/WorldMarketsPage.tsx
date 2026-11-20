import { useEffect, useState } from "react";
import MarketFlag from "./MarketFlag";
import StockLogo from "../components/StockLogo";
import AdSenseBanner from "./AdSenseBanner";
import { HoloPanel, NeoEmptyState, NeoSkeleton } from "./NeoComponents";
import "./worldMarkets.css";

type Market = {code: string; name: string; cap: number; indices: [string, string][]; ticker: string; company: string; context: string};
type Catalog = {source: string; period: string; markets: Market[]};
type Point = {date: string; close: number};
type Quote = {close: number | null; change: number | null; change_pct: number | null; points: Point[]; quote_time: number | null; stale: boolean};
type Story = {url: string; title: string; source: string; published: string; summary: string; translated: boolean};

function useFeed<T>(url: string, interval = 0) {
  const [state, setState] = useState<{url: string; value?: T; error?: boolean}>({url});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch(url, {signal: controller.signal});
        if (!response.ok) throw Error();
        const value: T = await response.json();
        if (!controller.signal.aborted) setState({url, value});
      } catch {
        if (!controller.signal.aborted) setState(old => ({url, value: old.url === url ? old.value : undefined, error: true}));
      }
      if (interval && !controller.signal.aborted) timer = setTimeout(refresh, interval);
    }
    refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [url, interval, attempt]);
  return {...(state.url === url ? state : {}), retry: () => setAttempt(n => n + 1)};
}

const number = (n?: number | null) => n == null ? "—" : n.toLocaleString("ko-KR", {minimumFractionDigits: 2, maximumFractionDigits: 2});
const signed = (n?: number | null) => n == null ? "—" : (n > 0 ? "+" : "") + number(n);
const tone = (n?: number | null) => !n ? "flat" : n > 0 ? "up" : "down";
const kst = (date: Date) => date.toLocaleString("ko-KR", {timeZone: "Asia/Seoul", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false});

function Trace({points, large = false}: {points: Point[]; large?: boolean}) {
  if (points.length < 2) return large ? <p>비교할 거래일 데이터가 부족합니다.</p> : null;
  const values = points.map(p => p.close);
  const low = Math.min(...values), high = Math.max(...values);
  const line = values.map((n, i) => `${2 + 196 * i / (values.length - 1)},${high === low ? 25 : 47 - 44 * (n - low) / (high - low)}`).join(" ");
  return <svg className={large ? "wm-chart" : "wm-spark"} viewBox="0 0 200 50" preserveAspectRatio="none" role="img"
    data-tone={tone(values[values.length - 1] - values[0])} aria-label={`${points[0].date}부터 ${points[points.length-1].date}까지 지수 추이, 최저 ${number(low)}, 최고 ${number(high)}`}>
    <polygon points={`2,50 ${line} 198,50`} fill="currentColor" opacity=".08" />
    <polyline points={line} fill="none" stroke="currentColor" strokeWidth={large ? 2 : 1.4} vectorEffect="non-scaling-stroke" />
  </svg>;
}

function Placement({type, secondary = false}: {type: "banner" | "rectangle" | "rail"; secondary?: boolean}) {
  const variant = type === "rectangle" ? (secondary ? "secondary-rectangle" : "rectangle") : "banner";
  return <aside aria-label="광고" className={`wm-ad wm-ad-${type}`}>
    {import.meta.env.DEV ? <small>광고 · {type === "banner" ? "가로 배너" : type === "rail" ? "세로 배너" : "사각 배너"}</small> :
      <AdSenseBanner labelled variant={variant} fluid={type === "rail"} />}
  </aside>;
}

function Failure({text, retry}: {text: string; retry: () => void}) {
  return <div className="wm-failure" role="status">{text} <button onClick={retry}>다시 조회</button></div>;
}

export default function WorldMarketsPage() {
  const catalog = useFeed<Catalog>("/api/world-markets");
  const quotes = useFeed<Record<string, Quote>>("/api/world-markets/quotes", 60_000);
  const [selected, select] = useState("DJI");
  const market = catalog.value?.markets.find(m => m.indices.some(([id]) => id === selected));
  const articles = useFeed<Story[]>(`/api/world-markets/news/${market?.code ?? "US"}`, 900_000);
  const name = market?.indices.find(([id]) => id === selected)?.[1];
  const quote = quotes.value?.[selected];
  const points = quote?.points ?? [];
  const last = points[points.length - 1];
  const weekStart = points[points.length - 6];
  const closes = points.map(point => point.close);
  const choose = (code: string) => {
    select(code);
    document.getElementById("wm-brief")?.focus({preventScroll: true});
    document.getElementById("wm-brief")?.scrollIntoView({block: "start"});
  };
  return <div className="wm-page">
    <header className="wm-header"><div><span className="ng-kicker">GLOBAL EQUITIES</span><h1>전세계 증시</h1></div>
      {catalog.value && <a href={catalog.value.source} target="_blank" rel="noreferrer">시총 순위 기준 · {catalog.value.period} ↗</a>}</header>
    {catalog.error && <Failure text="시장 목록을 불러오지 못했습니다." retry={catalog.retry} />}
    {!catalog.value && !catalog.error && <NeoSkeleton />}
    {quotes.error && <Failure text="지수 갱신이 지연되고 있습니다." retry={quotes.retry} />}
    {catalog.value && <><div className="wm-label"><h2>주요 지수</h2><span>10개 시장 · 12개 지수 · 전 거래일 대비</span></div>
      <div className="wm-grid">{catalog.value.markets.flatMap((m, i) => m.indices.map(([id, label]) => {
        const q = quotes.value?.[id];
        return <button key={id} type="button" onClick={() => choose(id)} aria-pressed={selected === id} className="wm-card">
          <MarketFlag code={m.code}/><small>{String(i + 1).padStart(2, "0")}　{m.name}</small><strong>{label}</strong>
          <span className="wm-price">{number(q?.close)}</span>
          <span className="wm-return" data-tone={tone(q?.change_pct)}>{q?.change_pct != null ? signed(q.change_pct) + "%" : quotes.value || quotes.error ? "시세 미확인" : "조회 중"}</span>
          <span className="wm-asof">{q?.quote_time ? kst(new Date(q.quote_time * 1000)) + " KST" : q?.points.slice(-1)[0]?.date ?? "—"}{q?.stale && " · 최근값"}</span>
          <Trace points={q?.points.slice(-20) ?? []} />
        </button>;
      }))}</div>
      <p className="wm-note">국내 상장사 시가총액 기준 · 홍콩 별도 집계 · 차트는 최근 최대 20거래일</p>
    </>}
    <Placement type="banner" />
    {market && <section id="wm-brief" tabIndex={-1} className="wm-brief">
      <div className="wm-label"><h2>국가별 브리핑</h2>
        <select aria-label="상세 지수 선택" value={selected} onChange={e => select(e.target.value)}>{catalog.value?.markets.map(m => <optgroup key={m.code} label={m.name}>{m.indices.map(([id, label]) => <option key={id} value={id}>{m.name} · {label}</option>)}</optgroup>)}</select></div>
      <div className="wm-layout"><div className="wm-main">
        <HoloPanel className="wm-detail"><MarketFlag code={market.code} large/><span className="ng-kicker">{market.code} / INDEX</span><h3>{name}</h3>
          <div className="wm-value">{number(quote?.close)} <small data-tone={tone(quote?.change_pct)}>{signed(quote?.change)} pt ({signed(quote?.change_pct)}%)</small></div>
          <p className="wm-note">Yahoo Finance · {quote?.quote_time ? kst(new Date(quote.quote_time * 1000)) + " KST" : last?.date ?? "기준 시각 확인 중"}{quote?.stale && " · 최근 확인값"}</p>
          <Trace points={points} large />
          {last && <div className="wm-chart-axis"><span>{points[0].date}</span><span>최근 {points.length}거래일</span><span>{last.date}</span></div>}
          {last && <dl className="wm-metrics">
            <div><dt>5거래일 등락률</dt><dd>{weekStart ? signed((last.close / weekStart.close - 1) * 100) + "%" : "—"}</dd></div>
            <div><dt>기간 최저 종가</dt><dd>{number(Math.min(...closes))}</dd></div>
            <div><dt>기간 최고 종가</dt><dd>{number(Math.max(...closes))}</dd></div>
          </dl>}
          <p>{market.context}</p>
          <div className="wm-facts"><span>시장 시총 ({catalog.value?.period}) <b>{number(market.cap)}조 달러</b></span>
            <a href={market.code === "KR" || market.code === "US" ? `/stock/${market.ticker}` : `https://finance.yahoo.com/quote/${market.ticker}/`}><StockLogo className="wm-logo" code={market.ticker} name={market.company}/> {market.company} ↗</a></div>
        </HoloPanel>
        <HoloPanel className="wm-news"><h3>{market.name} 주요 이슈</h3>
          {articles.error && <Failure text="뉴스 갱신이 지연되고 있습니다." retry={articles.retry}/>}
          {!articles.value && !articles.error && <NeoSkeleton rows={3}/>}
          {articles.value?.map(s => <article key={s.url}><small>{s.source}{s.translated && " · 한국어 번역"} · {kst(new Date(s.published))} KST</small><h4><a href={s.url} target="_blank" rel="noreferrer">{s.title} ↗</a></h4>{s.summary && <p>{s.summary}</p>}</article>)}
          {articles.value?.length === 0 && <NeoEmptyState title="최근 7일간 확인된 주요 매체의 증시 보도가 없습니다."/>}
        </HoloPanel>
        <div className="wm-rectangle-pair">
          <Placement type="rectangle" />
          <Placement type="rectangle" secondary />
        </div>
      </div><Placement type="rail" /></div>
    </section>}
  </div>;
}
