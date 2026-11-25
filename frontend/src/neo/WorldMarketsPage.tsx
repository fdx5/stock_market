import { useEffect, useId, useState, type CSSProperties } from "react";
import type { TreasuryHeadline } from "../api/client";
import StockLogo from "../components/StockLogo";
import { MARKET_ASSETS } from "../marketAssets";
import { Link } from "../router";
import { useMarketTicker } from "../useMarketTicker";
import AdZone from "./AdZone";
import MarketFlag from "./MarketFlag";
import { HoloPanel, NeoEmptyState, NeoSkeleton } from "./NeoComponents";
import WorldMarketsChart from "./WorldMarketsChart";
import { useWorldQuotes } from "./useWorldQuotes";
import {
  indexReturn, indexRows, kst, normalizedQuery, number, quoteSource, quoteStamp, quoteStatus, regions, signed, tone, tradingReturn,
  type BoardPeriod, type Catalog, type ChartPeriod, type IndexRow, type Point, type Region,
} from "./worldMarketModel";
import "./worldMarkets.css";

type Story = {url: string; title: string; source: string; published: string; summary: string; translated: boolean; paragraphs?: string[]; image?: string | null};

function useFeed<T>(url: string | null, interval = 0) {
  const [state, setState] = useState<{url: string; value?: T; error?: boolean; received?: number}>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!url) return;
    const endpoint = url;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch(endpoint, {signal: controller.signal});
        if (!response.ok) throw Error();
        const value: T = await response.json();
        if (!controller.signal.aborted) setState({url: endpoint, value, received: Date.now()});
      } catch {
        if (!controller.signal.aborted) setState(old => ({...(old?.url === endpoint ? old : {}), url: endpoint, error: true}));
      }
      if (interval && !controller.signal.aborted) timer = setTimeout(refresh, interval);
    }
    refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [url, interval, attempt]);
  return {...(state?.url === url ? state : {}), retry: () => setAttempt(n => n + 1)};
}

function Flag({code}: {code: string}) {
  return <img className="wm-mini-flag" src={"/img/world-flags/" + code.toLowerCase() + ".svg"} alt="" />;
}

function Sparkline({points}: {points: Point[]}) {
  if (points.length < 2) return null;
  const values = points.map(point => point.close);
  const low = Math.min(...values), high = Math.max(...values);
  const line = values.map((value, i) => [2 + 96 * i / (values.length - 1), high === low ? 14 : 26 - 23 * (value - low) / (high - low)].join(",")).join(" ");
  return <svg className="wm-spark" viewBox="0 0 100 29" preserveAspectRatio="none" aria-hidden="true"
    data-tone={tone(values[values.length - 1] - values[0])}>
    <polygon points={"2,29 " + line + " 98,29"} fill="currentColor" opacity=".12" />
    <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
  </svg>;
}

function StoryImage({src, alt, source}: {src?: string | null; alt: string; source: string}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return <figure className="wm-story-figure"><img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    <figcaption>사진 · {source}</figcaption></figure>;
}

function NewsStory({story, featured}: {story: Story; featured: boolean}) {
  const [open, setOpen] = useState(false);
  const body = story.paragraphs ?? [];
  const preview = featured ? 2 : 0;
  const shown = open ? body : body.slice(0, preview);
  const minutes = Math.max(1, Math.round((story.summary.length + body.join("").length) / 500));
  const id = useId();
  return <article className={featured ? "wm-story wm-story--lead" : "wm-story"} data-open={open || undefined}>
    {(featured || open) ? <StoryImage src={story.image} alt={story.title} source={story.source} /> :
      story.image && <img className="wm-story-thumb" src={story.image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={e => { e.currentTarget.hidden = true; }} />}
    <div className="wm-story-text">
      <small className="wm-story-meta"><b>{story.source}</b><span>{kst(new Date(story.published))} KST</span>{body.length > 0 && <span>{minutes}분 읽기</span>}{story.translated && <span className="wm-story-tag">자동 번역</span>}</small>
      <h4>{story.title}</h4>
      {story.summary && <p className="wm-story-lead"><span>핵심</span>{story.summary}</p>}
      {body.length > 0 && <div className="wm-story-body" id={id} hidden={!shown.length}>{shown.map((line, i) => <p key={i}>{line}</p>)}</div>}
      <div className="wm-story-actions">
        {body.length > preview && <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(v => !v)}>{open ? "접기" : featured ? `전문 이어 읽기 (${body.length - preview}문단)` : "본문 읽기"}</button>}
        <a href={story.url} target="_blank" rel="noreferrer">원문 보기 ↗</a>
      </div>
      {open && story.translated && <p className="wm-story-note">해외 매체 기사를 자동 번역했습니다. 정확한 표현은 원문을 확인하세요.</p>}
    </div>
  </article>;
}

function Failure({text, retry}: {text: string; retry: () => void}) {
  return <div className="wm-failure" role="status">{text} <button onClick={retry}>다시 조회</button></div>;
}

const heroMarkets = ["^TWII", "KOSPI", "SPX", "IXIC", "N225"];
const boardPeriods: BoardPeriod[] = [1, 5, 20];
const chartPeriods: ChartPeriod[] = [5, 20, 60];
const periodLabel = (period: BoardPeriod) => period === 1 ? "전일 대비" : period + "거래일";
type Sort = "region" | "up" | "down";
const indexLinks: Record<string, [string, string]> = {
  KOSPI: ["/kospi", "코스피 상세"], KOSDAQ: ["/kosdaq", "코스닥 상세"],
  SPX: ["/sp500-map", "S&P 500 종목 지도"], IXIC: ["/nasdaq", "나스닥 상세"],
};

// CNBC labels treasury prints in New York time ("2:37 AM EST"); the page speaks KST.
function etLabelToKst(label: string) {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)\s*(EST|EDT)$/i.exec(label.trim());
  if (!match) return label;
  const hour = (Number(match[1]) % 12) + (match[3].toUpperCase() === "PM" ? 12 : 0);
  const kstHour = (hour + (match[4].toUpperCase() === "EST" ? 14 : 13)) % 24;
  return String(kstHour).padStart(2, "0") + ":" + match[2] + " KST";
}

function MacroWatch() {
  const ticker = useMarketTicker();
  const rates = useFeed<{items: TreasuryHeadline[]}>("/api/global/treasuries/quotes", 60_000);
  const rate = rates.value?.items.find(item => item.tenor === "10");
  const assets = MARKET_ASSETS.filter(asset => ["usd-krw", "wti", "gold"].includes(asset.key));
  return <section className="wm-macro" aria-label="주요 환율·금리·원자재">
    <div className="wm-macro-heading"><h2>증시 밖 변수</h2><span>환율 · 금리 · 원자재</span></div>
    <div className="wm-macro-grid">
      {assets.map(asset => {
        const quote = ticker.find(item => item.symbol === asset.symbol);
        return <Link key={asset.key} className="wm-macro-item" to={"/prices/" + asset.key}>
          <span className="wm-macro-name">{asset.ko} <i aria-hidden="true">↗</i></span>
          <strong>{number(quote?.price)} <small>{asset.key === "usd-krw" ? "원" : "달러"}</small></strong>
          <b data-tone={tone(quote?.change_pct)}>{signed(quote?.change_pct)}</b>
          <time>{quote?.quote_time ? kst(new Date(quote.quote_time * 1000)) + " KST" : "시세 확인 중"}</time>
        </Link>;
      })}
      <Link className="wm-macro-item" to="/global/treasuries/10">
        <span className="wm-macro-name">미국 10년물 금리 <i aria-hidden="true">↗</i></span>
        <strong>{number(rate?.yield_pct, 3)} <small>%</small></strong>
        <b data-tone={tone(rate?.change_bp)}>{signed(rate?.change_bp, " bp", 1)}</b>
        <time>{(rate?.quote_time_label && etLabelToKst(rate.quote_time_label)) ?? (rates.error ? "시세 미확인" : "시세 확인 중")}{rate && (rate.stale || rates.error) ? " · 최근 확인값" : ""}</time>
      </Link>
    </div>
  </section>;
}

function IndexTile({row, period, active, choose}: {row: IndexRow; period: BoardPeriod; active: boolean; choose: (id: string) => void}) {
  const {id, market, quote, label} = row;
  const value = indexReturn(quote, period);
  const strength = value == null ? 0 : Math.min(32, 6 + Math.abs(value) * (period === 1 ? 8 : 3));
  return <button type="button" className="wm-card" data-move={tone(value)} style={{"--wm-heat": strength + "%"} as CSSProperties}
    aria-pressed={active} onClick={() => choose(id)} title={quoteStamp(quote)}>
    <span className="wm-card-country"><Flag code={market.code} />{market.name}</span>
    <strong className="wm-card-name">{label}</strong>
    <span className="wm-card-numbers"><b className="wm-return" data-tone={tone(value)}>{signed(value)}</b>
      <Sparkline points={quote?.points.slice(-20) ?? []} /></span>
    <span className="wm-card-price">{number(quote?.close)} <small>pt</small></span>
    <span className="wm-card-stamp">{quoteStatus(quote)}<br/>{quoteStamp(quote) ?? "—"}</span>
  </button>;
}

function FocusMarket({rows, choose}: {rows: IndexRow[]; choose: (id: string) => void}) {
  const [focus, setFocus] = useState("^TWII");
  const row = rows.find(item => item.id === focus);
  if (!row) return <NeoSkeleton rows={3}/>;
  const q = row.quote;
  return <section className="wm-focus" aria-label="주요 지수 모니터">
    <div className="wm-focus-tabs" role="group" aria-label="주요 지수 선택">
      {heroMarkets.map(id => {
        const item = rows.find(r => r.id === id);
        return item && <button key={id} type="button" aria-pressed={focus === id} onClick={() => setFocus(id)}>{item.label}</button>;
      })}
    </div>
    <div className="wm-focus-body">
      <div><h2><Flag code={row.market.code}/>{row.label}</h2>
        <strong className="wm-focus-price">{number(q?.close)}<small> pt</small></strong>
        <p className="wm-focus-move" data-tone={tone(q?.change_pct)}>{signed(q?.change, " pt")} <b>{signed(q?.change_pct)}</b></p>
      </div>
      {q && q.points.length > 1 && <figure><Sparkline points={q.points.slice(-20)}/><figcaption>최근 {Math.min(q.points.length, 20)}거래일</figcaption></figure>}
    </div>
    <div className="wm-focus-foot"><span><b>{quoteStatus(q)}</b> · {quoteSource(row)}<br/>{quoteStamp(q) ?? "시세 확인 중"}</span>
      <button type="button" onClick={() => choose(row.id)}>상세 차트</button></div>
  </section>;
}

function IndexTable({rows, selected, period, choose}: {rows: IndexRow[]; selected: string; period: BoardPeriod; choose: (id: string) => void}) {
  return <table className="wm-table"><thead><tr><th scope="col">지수 / 시장</th><th scope="col">현재 지수</th>
    <th scope="col">{periodLabel(period)}</th><th scope="col">시세 기준</th></tr></thead>
    <tbody>{rows.map(row => {
      const move = indexReturn(row.quote, period);
      return <tr key={row.id} data-selected={row.id === selected || undefined}><th scope="row">
        <button type="button" aria-pressed={row.id === selected} onClick={() => choose(row.id)}><Flag code={row.market.code}/>
          <span>{row.label}<small>{row.market.name}</small></span></button></th>
        <td>{number(row.quote?.close)}</td><td data-tone={tone(move)}>{signed(move)}</td>
        <td>{quoteStatus(row.quote)}<small>{quoteStamp(row.quote) ?? "—"}</small></td></tr>;
    })}</tbody></table>;
}

function Movers({rows, choose}: {rows: IndexRow[]; choose: (id: string) => void}) {
  const ranked = rows.flatMap(row => {
    const change = indexReturn(row.quote, 1);
    return change != null && !row.quote?.stale ? [{...row, change}] : [];
  }).sort((a, b) => b.change - a.change);
  const up = ranked.filter(row => row.change > 0).slice(0, 3);
  const down = ranked.filter(row => row.change < 0).slice(-3).reverse();
  return <HoloPanel className="wm-movers">
    <div className="wm-side-head"><h2>오늘의 변동</h2><span>최신 시세의 전 거래일 대비</span></div>
    {([{title: "상승 상위", rows: up, move: "up"}, {title: "하락 상위", rows: down, move: "down"}] as const).map(group =>
      <div className="wm-mover-group" key={group.move}>
        <h3 data-tone={group.move}>{group.title}</h3>
        {group.rows.length === 0 && <p className="wm-note">{ranked.length ? "해당 지수 없음" : "시세 확인 중"}</p>}
        {group.rows.map(row => <button type="button" className="wm-mover" onClick={() => choose(row.id)} key={row.id}>
          <Flag code={row.market.code} /><span>{row.label}<small>{row.market.name}</small></span>
          <strong data-tone={group.move}>{signed(row.change)}</strong>
        </button>)}
      </div>
    )}
    <p className="wm-note wm-movers-foot">시장별 거래 시각이 다르며, 시세 갱신에 실패한 지수는 집계에서 제외합니다.</p>
  </HoloPanel>;
}

function RegionalBreadth({rows, active, choose}: {rows: IndexRow[]; active: Region | "전체"; choose: (region: Region) => void}) {
  return <HoloPanel className="wm-regional-breadth">
    <div className="wm-side-head"><h2>지역별 시장 흐름</h2><span>확인된 지수의 전 거래일 대비</span></div>
    {regions.map(region => {
      const local = rows.filter(row => row.region === region && !row.quote?.stale)
        .flatMap(row => {
          const change = indexReturn(row.quote, 1);
          return change == null ? [] : [change];
        });
      const up = local.filter(value => value > 0).length;
      const down = local.filter(value => value < 0).length;
      const flat = local.length - up - down;
      return <button className="wm-regional-row" type="button" key={region} onClick={() => choose(region)}
        aria-label={region + (local.length ? " 상승 " + up + " 보합 " + flat + " 하락 " + down : " 시세 미확인")}
        aria-pressed={active === region}>
        <span>{region}</span><small>{local.length ? "↑ " + up + "　↓ " + down : "시세 미확인"}</small>
        <span className="wm-breadth-bar" aria-hidden="true">
          {up > 0 && <span data-tone="up" style={{flexGrow: up}}/>}
          {flat > 0 && <span data-tone="flat" style={{flexGrow: flat}}/>}
          {down > 0 && <span data-tone="down" style={{flexGrow: down}}/>}
        </span>
      </button>;
    })}
    <Link className="wm-session-link" to="/session-planner">시장별 거래 시간 확인 ↗</Link>
  </HoloPanel>;
}

function CapRanking({catalog, active, choose}: {catalog: Catalog; active: IndexRow; choose: (id: string) => void}) {
  const [expanded, setExpanded] = useState(false);
  const total = catalog.markets.reduce((sum, market) => sum + market.cap, 0);
  const rows = expanded ? catalog.markets : catalog.markets.slice(0, 5);
  const sources = catalog.sources ?? [catalog.source];
  return <HoloPanel className="wm-cap">
    <div className="wm-side-head"><h2>시장 규모 순위</h2><span>국내 상장사 시가총액 · 조 달러</span></div>
    <ol>
      {rows.map((market, index) => <li key={market.code}>
        <button type="button" className="wm-cap-entry" onClick={() => choose(market.indices[0][0])}
          title={market.cap_as_of ?? market.base_date ?? catalog.period}
          aria-pressed={market.code === active.market.code}>
          <span className="wm-cap-rank">{index + 1}</span><Flag code={market.code} /><span>{market.name}</span>
          <strong>{number(market.cap)}</strong>
          <span className="wm-cap-share" aria-hidden="true">
            <span style={{width: market.cap / total * 100 + "%"}}/>
          </span>
        </button>
      </li>)}
    </ol>
    <p className="wm-note wm-cap-caption">막대는 {catalog.markets.length}개 시장의 합계 대비 비중</p>
    <button className="wm-soft-button" type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      {expanded ? "상위 5개만 보기" : "전체 " + catalog.markets.length + "개 시장 보기"} <span aria-hidden="true">{expanded ? "−" : "+"}</span>
    </button>
    <details className="wm-sources">
      <summary>집계 기준 및 출처</summary>
      <p>블룸버그(2026년 4월 말)와 WFE(2026년 3월 말) 집계에 대표 지수와 달러 환율 변동을 반영합니다. 시장별 기준일이 다르며 홍콩은 별도로 집계합니다.</p>
      {sources.map((source, i) => <a href={source} target="_blank" rel="noreferrer" key={source}>{i === 0 ? "블룸버그 집계" : "세계거래소연맹 통계"} ↗</a>)}
    </details>
  </HoloPanel>;
}

function MarketDetail({row, rows, catalog, choose}: {row: IndexRow; rows: IndexRow[]; catalog: Catalog; choose: (id: string) => void}) {
  const [period, setPeriod] = useState<ChartPeriod>(20);
  const [comparison, setComparison] = useState("");
  const {id, label, market, quote} = row;
  const peer = comparison === id ? undefined : rows.find(item => item.id === comparison);
  const points = quote?.points ?? [];
  // N trading-day returns span N+1 closes; the chart must match the metrics below it.
  const chartPoints = points.slice(-(period + 1));
  const prices = chartPoints.map(point => point.close);
  const week = tradingReturn(points, 5), month = tradingReturn(points, 20);
  const link = indexLinks[id];
  return <HoloPanel className="wm-detail" title={label + " 지수 상세"}>
    <MarketFlag code={market.code} large />
    <header className="wm-detail-head">
      <span className="ng-kicker">{market.name} · {id.replace("^", "")}</span>
      <h3>{label}</h3>
      <div className="wm-value"><strong>{number(quote?.close)}</strong><span>pt</span>
        <b data-tone={tone(quote?.change_pct)}>{signed(quote?.change_pct)}{quote?.change != null && <small> ({signed(quote.change, " pt")})</small>}</b></div>
      <p className="wm-note">전 거래일 대비 · {quoteStatus(quote)} · {quoteStamp(quote) ?? "시세 확인 중"} · {quoteSource(row)}</p>
    </header>
    <div className="wm-chart-controls">
      <div className="wm-switch" role="group" aria-label="차트 기간">
        {chartPeriods.map(value => <button type="button" aria-pressed={period === value} key={value} onClick={() => setPeriod(value)}>{value}거래일</button>)}
      </div>
      <label className="wm-compare"><span>비교 지수</span>
        <select aria-label="비교 지수" value={peer?.id ?? ""} onChange={event => setComparison(event.target.value)}>
          <option value="">선택 안 함</option>
          {rows.filter(item => item.id !== id).map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
        </select>
      </label>
    </div>
    <WorldMarketsChart key={id + ":" + period + ":" + peer?.id} label={label} points={chartPoints}
      benchmark={peer ? {label: peer.label, points: peer.quote?.points ?? []} : undefined} />
    {id === "TASI" && <p className="wm-note wm-chart-source">일별 이력 · CNBC</p>}
    <dl className="wm-metrics">
      <div><dt>5거래일 등락률</dt><dd data-tone={tone(week)}>{signed(week)}</dd></div>
      <div><dt>20거래일 등락률</dt><dd data-tone={tone(month)}>{signed(month)}</dd></div>
      <div><dt>표시 구간 최저</dt><dd>{prices.length ? number(Math.min(...prices)) : "—"}</dd></div>
      <div><dt>표시 구간 최고</dt><dd>{prices.length ? number(Math.max(...prices)) : "—"}</dd></div>
    </dl>
    <div className="wm-context">
      <h4>{market.name} 시장 브리핑</h4><p>{market.context}</p>
      <div className="wm-facts">
        <span>시장 시총 <strong>{number(market.cap)}조 달러</strong><small>{market.cap_as_of ?? market.base_date ?? catalog.period} {market.cap_estimated ? "추정" : "집계"}</small></span>
        <div className="wm-context-links">
          {link && <Link to={link[0]}>{link[1]} ↗</Link>}
          {market.code === "KR" || market.code === "US"
            ? <Link to={"/stock/" + market.ticker}><StockLogo className="wm-logo" code={market.ticker} name={market.company}/>{market.company} ↗</Link>
            : <a href={"https://finance.yahoo.com/quote/" + market.ticker + "/"} target="_blank" rel="noreferrer"><StockLogo className="wm-logo" code={market.ticker} name={market.company}/>{market.company} ↗</a>}
        </div>
      </div>
      {market.indices.length > 1 && <div className="wm-siblings" aria-label={market.name + " 지수"}>
        {market.indices.map(([symbol, name]) => <button type="button" key={symbol} onClick={() => choose(symbol)} aria-pressed={id === symbol}>{name}</button>)}
      </div>}
    </div>
  </HoloPanel>;
}

export default function WorldMarketsPage() {
  const catalog = useFeed<Catalog>("/api/world-markets");
  const quotes = useWorldQuotes();
  const [selected, select] = useState("^TWII");
  const [region, setRegion] = useState<Region | "전체">("전체");
  const [period, setPeriod] = useState<BoardPeriod>(1);
  const [sort, setSort] = useState<Sort>("region");
  const [view, setView] = useState<"map" | "table">("map");
  const [search, setSearch] = useState("");
  const markets = catalog.value?.markets ?? [];
  const rows = indexRows(markets, quotes.value);
  const active = rows.find(row => row.id === selected) ?? rows[0];
  const country = active?.market.code;
  const articles = useFeed<Story[]>(country ? "/api/world-markets/news/" + country : null, 900_000);

  const valid = rows.map(row => row.quote?.stale ? null : indexReturn(row.quote, 1)).filter((value): value is number => value != null);
  const breadth = [
    {label: "상승", move: "up", count: valid.filter(value => value > 0).length},
    {label: "보합", move: "flat", count: valid.filter(value => value === 0).length},
    {label: "하락", move: "down", count: valid.filter(value => value < 0).length},
  ];
  const query = normalizedQuery(search);
  const filtered = rows.filter(row => (region === "전체" || row.region === region) &&
    (!query || [row.label, row.id, row.market.name, row.market.code, row.market.company].some(value => normalizedQuery(value).includes(query))));
  const groups = sort === "region"
    ? [...regions.map(name => ({name, rows: filtered.filter(row => row.region === name)})), {name: "기타", rows: filtered.filter(row => !row.region)}]
    : [{name: null, rows: [...filtered].sort((a, b) => {
      const first = indexReturn(a.quote, period), second = indexReturn(b.quote, period);
      if (first == null) return second == null ? 0 : 1;
      if (second == null) return -1;
      return sort === "up" ? second - first : first - second;
    })}];
  const choose = (id: string, jump = true) => {
    select(id);
    if (!jump) return;
    const detail = document.getElementById("wm-brief");
    detail?.focus({preventScroll: true});
    detail?.scrollIntoView({block: "start", behavior: "instant"});
  };

  return <div className="wm-container"><div className="wm-page">
    <header className="wm-header">
      <div className="wm-hero-main">
        <p className="ng-kicker"><span aria-hidden="true"></span> GLOBAL MARKETS</p>
        <h1>전세계 증시</h1>
        <p className="wm-intro">{rows.length ? `${markets.length}개 시장 · ${rows.length}개 대표 지수` : "세계 주요 주가지수"}<br/>거래소별 시세와 전 거래일 대비 흐름</p>
        <nav className="wm-jumps" aria-label="전세계 증시 바로가기">
          <a href="#wm-board">세계 시세판</a><a href="#wm-brief">지수 비교</a><a href="#wm-news">시장 뉴스</a>
        </nav>
      </div>
      <FocusMarket rows={rows} choose={choose}/>
    </header>
      <section className="wm-breadth wm-summary" aria-labelledby="wm-breadth-title">
        <div className="wm-breadth-head"><h2 id="wm-breadth-title">세계 지수 분포</h2>
          {rows.length > 0 && <span>집계 {valid.length} / {rows.length}</span>}
        </div>
        <div className="wm-breadth-counts">
          {breadth.map(item => <div key={item.move}><b data-tone={item.move}>{valid.length ? item.count : "—"}</b><span>{item.label}</span></div>)}
        </div>
        <div className="wm-breadth-bar" aria-hidden="true">
          {valid.length > 0 && breadth.filter(item => item.count).map(item => <span key={item.move} data-tone={item.move} style={{flexGrow: item.count}}/>)}
        </div>
        <div className="wm-breadth-foot"><span>{quotes.error ? "갱신 지연" : "10초마다 조회"} · 거래 시차 및 공급처 지연 반영</span>
          {quotes.received && <time dateTime={new Date(quotes.received).toISOString()}>마지막 수신 {new Date(quotes.received).toLocaleTimeString("ko-KR", {timeZone: "Asia/Seoul", hour12: false})} KST</time>}</div>
      </section>
    {catalog.error && <Failure text="시장 목록을 불러오지 못했습니다." retry={catalog.retry} />}
    {!catalog.value && !catalog.error && <NeoSkeleton />}
    {quotes.error && <Failure text={quotes.value ? "지수 갱신이 지연되어 최근 확인값을 표시합니다." : "지수 시세를 불러오지 못했습니다."} retry={quotes.retry} />}
    {catalog.value && active && <>
      <section className="wm-board-layout" id="wm-board" tabIndex={-1} aria-labelledby="wm-board-title">
        <HoloPanel className="wm-board">
          <div className="wm-section-head"><div><h2 id="wm-board-title">세계 지수 시세판</h2><p>지수를 선택해 차트와 시장 뉴스를 확인하세요.</p></div>
            <div className="wm-switch" role="group" aria-label="시세판 보기">
              <button aria-pressed={view === "map"} onClick={() => setView("map")}>히트맵</button>
              <button aria-pressed={view === "table"} onClick={() => setView("table")}>시세표</button>
            </div>
            <div className="wm-switch" role="group" aria-label="등락률 기준">
              {boardPeriods.map(value => <button type="button" key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{periodLabel(value)}</button>)}
            </div>
          </div>
          <div className="wm-board-controls">
            <div className="wm-filters" role="group" aria-label="지역 필터">
              {(["전체", ...regions] as const).map(value => <button type="button" key={value} aria-pressed={region === value} onClick={() => setRegion(value)}>{value}</button>)}
            </div>
            <div className="wm-board-inputs">
              <input aria-label="지수 또는 국가 검색" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="지수·국가 검색" />
              <select aria-label="지수 정렬" value={sort} onChange={event => setSort(event.target.value as Sort)}>
                <option value="region">지역별</option><option value="up">등락률 높은 순</option><option value="down">등락률 낮은 순</option>
              </select>
            </div>
          </div>
          {groups.filter(group => group.rows.length).map(group => <div key={group.name ?? "sorted"} className="wm-region">
            {group.name && <h3>{group.name} <span>{group.rows.length}</span></h3>}
            {view === "map" ? <div className="wm-grid">{group.rows.map(row => <IndexTile row={row} key={row.id} period={period} active={active.id === row.id} choose={choose} />)}</div>
              : <IndexTable rows={group.rows} selected={active.id} period={period} choose={choose}/>}
          </div>)}
          {filtered.length === 0 && <NeoEmptyState title="조건에 맞는 지수가 없습니다."><button className="wm-soft-button" type="button" onClick={() => {setSearch(""); setRegion("전체");}}>필터 초기화</button></NeoEmptyState>}
          <div className="wm-board-foot"><span className="wm-legend"><span data-tone="down">하락</span><span data-tone="flat">보합</span><span data-tone="up">상승</span></span>
            <span>{filtered.length}개 지수 · 미니 차트 최근 최대 20거래일</span></div>
        </HoloPanel>
        <div className="wm-board-aside">
          <Movers rows={rows} choose={choose} />
          <RegionalBreadth rows={rows} active={region} choose={value => {
            setRegion(region === value ? "전체" : value);
            const board = document.getElementById("wm-board");
            board?.focus({preventScroll: true});
            board?.scrollIntoView({block: "start", behavior: "instant"});
          }} />
        </div>
      </section>
      <MacroWatch />
      <section id="wm-brief" tabIndex={-1} className="wm-brief" aria-labelledby="wm-brief-title">
        <div className="wm-section-head wm-brief-head"><div><h2 id="wm-brief-title">지수 상세와 비교</h2><p>지수 수준과 공통 거래일 수익률을 확인하세요.</p></div>
          <select aria-label="상세 지수 선택" value={active.id} onChange={event => choose(event.target.value, false)}>
            {markets.map(market => <optgroup key={market.code} label={market.name}>{market.indices.map(([id, label]) => <option key={id} value={id}>{market.name} · {label}</option>)}</optgroup>)}
          </select>
        </div>
        <div className="wm-detail-layout"><MarketDetail row={active} rows={rows} catalog={catalog.value} choose={id => choose(id, false)} />
          <CapRanking catalog={catalog.value} active={active} choose={choose} /></div>
      </section>
      <AdZone kind="break" />
      <section className="wm-layout" id="wm-news" aria-label="시장 뉴스">
        <div className="wm-main">
          <HoloPanel className="wm-news">
            <div className="wm-section-head"><div><h2>{active.market.name} 증시 뉴스</h2><p>최근 7일 주요 매체 보도</p></div>
              <select aria-label="뉴스 시장 선택" value={active.market.code}
                onChange={event => {const next = markets.find(market => market.code === event.target.value); if (next) choose(next.indices[0][0], false);}}>
                {markets.map(market => <option key={market.code} value={market.code}>{market.name}</option>)}
              </select>
            </div>
            {articles.error && <Failure text="뉴스 갱신이 지연되고 있습니다." retry={articles.retry}/>}
            {!articles.value && !articles.error && <NeoSkeleton rows={3}/>}
            {articles.value?.map((story, i) => <NewsStory key={country + story.url} story={story} featured={i === 0} />)}
            {articles.value?.length === 0 && <NeoEmptyState title="최근 7일간 확인된 주요 매체의 증시 보도가 없습니다."/>}
          </HoloPanel>
        </div>
      </section>
    </>}
  </div></div>;
}
