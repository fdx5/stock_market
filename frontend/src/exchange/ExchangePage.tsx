import { memo, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../i18n/LanguageContext";
import { reportExchange } from "../useActivityTracking";
import {
  ASSET_SINGLES, FLOOR, MARKETS, PANEL_LABELS, STORAGE_ASSETS, assetSymbol, changeText, changeTone, companyLogo, displayValue,
  marketCode, rowsForPanel, stockDetailPath, stockIndex, useFloorQuotes, usePostSeries, useStockHistory, shortTime,
  type ExchangeMarket, type FloorSnapshot, type Language,
} from "./market";
import type { AtriumMood, FloorDriver, LiftState } from "./floorEngine";
import ArtViewer, { artLabel } from "./ArtViewer";
import { PAINTERS, areaChart, searchedStockPainter, type PaintEnv } from "./panels";
import { api, type MarketMapItem, type StockSearchResult } from "../api/client";
import { loadDisplayFonts } from "./screens";
import { openFloorSound } from "./sound";
import FloorHeatmap from "./FloorHeatmap";
import "./exchange.css";

type FloorAudio = Awaited<ReturnType<typeof openFloorSound>>;
type Phase = "loading" | "webgpu" | "webgl2" | "failed";
type Station = (typeof FLOOR.stations)[number];
const MARKETS_LIST = Object.keys(MARKETS) as ExchangeMarket[];
const t = (lang: Language, ko: string, en: string) => lang === "ko" ? ko : en;
const KINDS = ["market", "stocks", "global", "assets", "desk"] as const;
/** Overlays that scroll by touch; every other touch move on the floor is a camera drag. */
const SCROLLERS = ".exchange-focus, .exchange-monitor-picker > div, .exchange-station-list, .exchange-stock-search ul, .exchange-heatmap-box, .exchange-art-docent-body";

function panelLabel(id: string, lang: Language, data?: FloorSnapshot) {
  if (id.startsWith("art:") || id.startsWith("sculpture:")) return artLabel(id, lang);
  const i = stockIndex(id);
  if (i >= 0) {
    const row = data?.rows[i];
    return (row ? (data?.market === "sp500" ? row.code : row.name) + " · " : "") + t(lang, "포스트 ", "Post ") + String(Math.floor(i / 2) + 1).padStart(2, "0");
  }
  return PANEL_LABELS[id]?.[lang === "ko" ? 0 : 1] ?? id;
}

function LiveChart({ points, color, label, empty }: { points: number[]; color: string; label: string; empty: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    const paint = () => {
      const { width, height } = element.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      areaChart(ctx, points, 6, 10, Math.max(1, width - 12), Math.max(1, height - 20), color, { width: 2.4, minmax: true });
    };
    const observer = new ResizeObserver(paint);
    observer.observe(element);
    paint();
    return () => observer.disconnect();
  }, [points, color]);
  return <div className="exchange-chart">
    <canvas ref={canvas} role="img" aria-label={label} />
    {points.length < 2 && <span>{empty}</span>}
  </div>;
}

/** The same painter as the 3D display, drawn at the dialog's own pixel density. */
type PainterFn = (typeof PAINTERS)[string];
function PanelView({ id, data, lang, series, painter: override }: {
  id: string; data: FloorSnapshot; lang: Language; series: Record<string, number[]>; painter?: PainterFn;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (id !== "clocks" && id !== "session") return;
    const timer = window.setInterval(() => setTick(v => v + 1), 1000);
    return () => window.clearInterval(timer);
  }, [id]);
  useEffect(() => {
    const canvas = ref.current, painter = override ?? PAINTERS[id];
    if (!canvas || !painter) return;
    let alive = true;
    const logos = new Map<string, HTMLImageElement | null>();
    const screen = FLOOR.screens.filter(s => s.id === id).reduce((a, b) => a.w * a.h >= b.w * b.h ? a : b);
    // Very wide wall boards reflow for the dialog instead of shrinking into an unreadable strip.
    const aspect = id === "clocks" || id === "session" ? 1.7 : Math.min(screen.w / screen.h, 2.7);
    const draw = () => {
      if (!alive) return;
      const { width } = canvas.getBoundingClientRect();
      if (!width) return;
      const ratio = Math.min(2.5, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(width * ratio / aspect);
      const g = canvas.getContext("2d");
      if (!g) return;
      g.setTransform(canvas.height / 720, 0, 0, canvas.height / 720, 0, 0);
      const env: PaintEnv = {
        lang, series, now: Date.now(), cycle: 0,
        logo(gg, market, code, x, y, size) {
          const url = companyLogo(market, code), img = logos.get(url);
          gg.fillStyle = "#f4f6fa";
          gg.beginPath(); gg.roundRect(x, y, size, size, size * .24); gg.fill();
          if (img?.complete && img.naturalWidth) gg.drawImage(img, x + size * .09, y + size * .09, size * .82, size * .82);
          else if (img === undefined) {
            const next = new Image();
            next.crossOrigin = "anonymous";
            logos.set(url, next);
            next.onload = draw;
            next.onerror = () => logos.set(url, null);
            next.src = url;
          }
        },
      };
      painter(g, 720 * aspect, 720, data, env);
    };
    void loadDisplayFonts().then(draw);
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => { alive = false; observer.disconnect(); };
  }, [id, data, lang, series, tick, override]);
  return <canvas ref={ref} className="exchange-panel-view" role="img" aria-label={panelLabel(id, lang, data)} />;
}

function Logo({ market, code }: { market: ExchangeMarket; code: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="exchange-stock-logo">{failed ? code.slice(0, 2)
    : <img src={companyLogo(market, code)} alt="" loading="lazy" onError={() => setFailed(true)} />}</span>;
}

/** Big-board detail: period returns, breadth, flows, index movers, sectors and related gauges. */
function OverviewDetails({ data, lang }: { data: FloorSnapshot; lang: Language }) {
  const pts = data.index?.points ?? [];
  const last = data.index?.close ?? pts[pts.length - 1];
  const ret = (n: number) => pts.length > n && last ? (last / pts[pts.length - 1 - n] - 1) * 100 : null;
  const hi = pts.length ? Math.max(...pts, last ?? 0) : null, lo = pts.length ? Math.min(...pts) : null;
  const total = data.up + data.flat + data.down;
  const capSum = data.rows.reduce((sum, r) => sum + (r.marcap || 0), 0) || 1;
  const movers = data.rows.filter(r => Number.isFinite(r.change_pct)).map(r => ({ r, c: (r.marcap || 0) / capSum * r.change_pct }))
    .sort((a, b) => b.c - a.c);
  const pushers = movers.filter(m => m.c > 0).slice(0, 5), draggers = movers.filter(m => m.c < 0).slice(-5).reverse();
  const sectors = [...data.sectors].filter(x => x.count >= 2).sort((a, b) => b.change - a.change);
  const flows = data.market === "sp500" ? null : data.investorTotals;
  const flowMax = flows ? Math.max(1, Math.abs(flows.individual_amount), Math.abs(flows.foreign_amount), Math.abs(flows.institution_amount)) : 1;
  const ten = data.extras.rates.find(r => r.tenor === "10");
  const related: [string, string, number | null | undefined][] = [
    ...(Object.keys(MARKETS) as ExchangeMarket[]).filter(k => k !== data.market).map(k => [MARKETS[k].label, displayValue(data.indices[k]?.close), data.indices[k]?.change] as [string, string, number | null | undefined]),
    ["USD/KRW", displayValue(data.tickers["KRW=X"]?.price), data.tickers["KRW=X"]?.change_pct],
    [t(lang, "미 10년물", "US 10Y"), ten?.yield_pct == null ? "—" : ten.yield_pct.toFixed(3) + "%", ten?.change_bp == null ? null : ten.change_bp / 100],
    [t(lang, "코스피200 야간", "KOSPI200 night"), displayValue(data.extras.kospiNight?.close), data.extras.kospiNight?.change_pct],
    [t(lang, "나스닥100 선물", "Nasdaq 100 fut."), displayValue(data.tickers["NQ=F"]?.price), data.tickers["NQ=F"]?.change_pct],
  ];
  const rowName = (r: MarketMapItem) => data.market === "sp500" ? r.code : r.name;
  return <div className="exchange-ov">
    <section><h3>{t(lang, "기간 수익률", "Period returns")}</h3>
      <dl className="exchange-ov-stats">
        {([[t(lang, "5거래일", "5D"), ret(5)], [t(lang, "20거래일", "20D"), ret(20)], [t(lang, "60거래일", "60D"), ret(60)],
          [t(lang, "고점 대비", "From high"), hi && last ? (last / hi - 1) * 100 : null]] as const).map(([k, v]) =>
          <div key={k}><dt>{k}</dt><dd data-tone={changeTone(v)}>{changeText(v)}</dd></div>)}
        <div><dt>{t(lang, "기간 고점", "Period high")}</dt><dd>{displayValue(hi)}</dd></div>
        <div><dt>{t(lang, "기간 저점", "Period low")}</dt><dd>{displayValue(lo)}</dd></div>
      </dl></section>
    <section><h3>{t(lang, "시장 폭", "Breadth")} <small>{t(lang, "표본", "sample")} {total}</small></h3>
      <div className="exchange-ov-breadth">{total ? <>
        <i data-tone="up" style={{ flex: data.up }} /><i data-tone="flat" style={{ flex: data.flat }} /><i data-tone="down" style={{ flex: data.down }} /></> : null}</div>
      <p className="exchange-ov-line"><b data-tone="up">{t(lang, "상승", "Up")} {data.up}</b><b data-tone="flat">{t(lang, "보합", "Flat")} {data.flat}</b>
        <b data-tone="down">{t(lang, "하락", "Down")} {data.down}</b><span>ADR {data.down ? (data.up / data.down).toFixed(2) : "—"}</span></p></section>
    {flows && <section><h3>{t(lang, "투자자 순매수", "Net buying by investor")} <small>{t(lang, "억원", "KRW 100M")}</small></h3>
      <ul className="exchange-ov-flows">{([[t(lang, "개인", "Retail"), flows.individual_amount], [t(lang, "외국인", "Foreign"), flows.foreign_amount],
        [t(lang, "기관", "Institution"), flows.institution_amount]] as const).map(([k, v]) => <li key={k}><span>{k}</span>
          <i><b data-tone={changeTone(v)} style={{ width: Math.abs(v) / flowMax * 50 + "%", [v >= 0 ? "left" : "right"]: "50%" }} /></i>
          <strong data-tone={changeTone(v)}>{(v > 0 ? "+" : "") + Math.round(v).toLocaleString("en-US")}</strong></li>)}</ul></section>}
    <section className="exchange-ov-two"><div><h3>{t(lang, "지수 끌어올린 종목", "Lifting the index")}</h3>
      <ol>{pushers.map(({ r, c }) => <li key={r.code}><span>{rowName(r)}</span><b data-tone="up">{changeText(r.change_pct)}</b><small>+{c.toFixed(2)}p</small></li>)}</ol></div>
      <div><h3>{t(lang, "지수 끌어내린 종목", "Dragging the index")}</h3>
      <ol>{draggers.map(({ r, c }) => <li key={r.code}><span>{rowName(r)}</span><b data-tone="down">{changeText(r.change_pct)}</b><small>{c.toFixed(2)}p</small></li>)}</ol></div></section>
    <section className="exchange-ov-two"><div><h3>{t(lang, "강한 업종", "Strongest sectors")}</h3>
      <ol>{sectors.slice(0, 3).map(x => <li key={x.name}><span>{x.name}</span><b data-tone={changeTone(x.change)}>{changeText(x.change)}</b><small>{x.count}</small></li>)}</ol></div>
      <div><h3>{t(lang, "약한 업종", "Weakest sectors")}</h3>
      <ol>{sectors.slice(-3).reverse().map(x => <li key={x.name}><span>{x.name}</span><b data-tone={changeTone(x.change)}>{changeText(x.change)}</b><small>{x.count}</small></li>)}</ol></div></section>
    <section><h3>{t(lang, "연관 지표", "Related gauges")}</h3>
      <ul className="exchange-ov-related">{related.map(([k, v, c]) => <li key={k}><span>{k}</span><strong>{v}</strong><b data-tone={changeTone(c)}>{changeText(c)}</b></li>)}</ul></section>
    <p className="exchange-fine">{t(lang, "지수 영향은 표본 내 시가총액 비중 × 등락률로 추정한 값(퍼센트포인트)이며, 업종은 시가총액 가중 평균입니다.",
      "Index impact is estimated as cap weight within the sample × change (percentage points); sectors are cap-weighted.")}</p>
  </div>;
}

type Picked = { code: string; name: string; market: ExchangeMarket };
/** Search any listed stock (KR or US) and show it in the post-monitor layout. */
function StockSearch({ lang, onPick }: { lang: Language; onPick: (pick: Picked) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockSearchResult[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api.search(q, controller.signal).then(items => setResults(items.filter(i => i.asset_type !== "ETF").slice(0, 8))).catch(() => {});
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);
  const pick = (item: StockSearchResult) => {
    onPick({ code: item.code, name: item.name, market: item.market === "US" ? "sp500" : item.market === "KOSDAQ" ? "kosdaq" : "kospi" });
    setQuery(""); setResults([]);
  };
  return <div className="exchange-stock-search" role="search">
    <input type="search" value={query} placeholder={t(lang, "종목명·코드 검색 (국내·미국)", "Search a stock (KR · US)")}
      aria-label={t(lang, "종목 검색", "Search stocks")} onChange={event => setQuery(event.target.value)}
      onKeyDown={event => { event.stopPropagation(); if (event.key === "Enter" && results[0]) pick(results[0]); }} />
    {results.length > 0 && <ul>{results.map(item => <li key={item.market + item.code}>
      <button type="button" onClick={() => pick(item)}><strong>{item.name}</strong><span>{item.code} · {item.market}</span></button>
    </li>)}</ul>}
  </div>;
}

/** Quote and daily closes for a searched stock, shaped like a market-map row; refreshed every minute. */
function usePickedStock(pick: Picked | undefined) {
  const [row, setRow] = useState<MarketMapItem>();
  const points = useStockHistory(pick?.market ?? "kospi", pick?.code);
  useEffect(() => {
    setRow(undefined);
    if (!pick) return;
    let alive = true;
    const read = () => {
      const request = pick.market === "sp500"
        ? api.usStockQuote(pick.code).then(q => ({ code: pick.code, name: q.name || pick.name, sector: "NYSE · NASDAQ", marcap: 0,
          close: q.close, change: q.change, change_pct: q.change_pct }))
        : api.quote(pick.code).then(q => ({ code: pick.code, name: q.name || pick.name, sector: pick.market === "kosdaq" ? "KOSDAQ" : "KOSPI",
          marcap: q.marcap, close: q.close, change: q.change, change_pct: q.change_pct, turnover: (q as { turnover?: number }).turnover }));
      request.then(value => { if (alive) setRow(value as MarketMapItem); }).catch(() => {});
    };
    read();
    const timer = window.setInterval(read, 60_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [pick]);
  return { row, points };
}

function FocusPanel({ data, id, lang, histories, onClose }: {
  data: FloorSnapshot; id: string; lang: Language; histories: Record<string, number[]>; onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [stock, setStock] = useState<string>();
  const spec = MARKETS[data.market];
  const lists = ["leaders", "gainers", "laggards", "movers"].includes(id);
  const isStock = lists || stockIndex(id) >= 0;
  const panelRows = isStock ? rowsForPanel(data, id).slice(0, 14) : [];
  const selected = panelRows.find(row => row.code === stock) ?? panelRows[0];
  const loadedSeries = useStockHistory(data.market, lists && selected && !histories[selected.code]?.length ? selected.code : undefined);
  const stockPoints = (selected && histories[selected.code]) || loadedSeries;
  const symbol = assetSymbol(id);
  const single = stockIndex(id) >= 0;
  const [picked, setPicked] = useState<Picked>();
  const searched = usePickedStock(picked);
  const searchedPainter = useMemo(() => picked && searched.row
    ? searchedStockPainter(searched.row, picked.market, (picked.market === "sp500" ? "US" : picked.market.toUpperCase()) + " · SEARCH") : undefined,
  [picked, searched.row]);
  const searchedSeries = useMemo(() => picked ? { [picked.code]: searched.points } : histories, [picked, searched.points, histories]);
  useEffect(() => { closeButton.current?.focus(); }, []);

  let details: ReactNode = null;
  if (lists && selected) {
    details = <>
      <div className="exchange-focus-name"><Logo key={selected.code} market={data.market} code={selected.code} />
        <div><strong>{selected.name}</strong><small>{selected.code} · {selected.sector || spec.venue}</small></div></div>
      <div className="exchange-focus-quote"><strong>{displayValue(selected.close, data.market === "sp500" ? 2 : 0)} <small>{spec.currency}</small></strong>
        <b data-tone={changeTone(selected.change_pct)}>{changeText(selected.change_pct)}</b></div>
      <LiveChart points={stockPoints} color={spec.color} label={selected.name + " " + t(lang, "일별 종가", "daily closes")}
        empty={t(lang, "아직 수신된 차트 데이터가 없습니다.", "Chart data is unavailable.")} />
      <ul className="exchange-focus-rows">
        {panelRows.map(row => <li key={row.code}><button type="button" aria-pressed={row.code === selected.code} onClick={() => setStock(row.code)}>
          <strong>{row.name}</strong><span>{row.code}</span><b data-tone={changeTone(row.change_pct)}>{changeText(row.change_pct)}</b>
        </button></li>)}
      </ul>
    </>;
  }
  const link = picked ? { to: stockDetailPath(picked.market, picked.code), label: t(lang, picked.name + " 상세 보기", "Open " + picked.name) }
    : isStock && selected ? { to: stockDetailPath(data.market, selected.code), label: t(lang, "종목 상세 보기", "Open stock details") }
    : symbol ? { to: ASSET_SINGLES[symbol].href, label: t(lang, "자산 시세·차트", "Asset price and chart") }
      : id === "overview" ? { to: spec.index, label: t(lang, "지수 상세 보기", "Open index details") }
        : id === "news" || id === "brief" ? { to: "/hot-issues", label: t(lang, "오늘의 핫이슈 전체", "Read today's hot issues") }
          : ["world", "futures", "rates", "semis", "bigtech", "globaltop", "session", "clocks"].includes(id) ? { to: "/global", label: t(lang, "세계 증시", "World markets") }
            : ["metals", "energy", "agri", "fx", "crypto"].includes(id) ? { to: "/prices/gold", label: t(lang, "원자재·환율 시세", "Commodity and FX prices") }
              : { to: spec.map, label: t(lang, "전체 시장 지도", "Open market map") };

  const heat = id === "heatgrid" || id === "treemap";
  return <aside className="exchange-focus" aria-labelledby="exchange-panel-heading" data-panel={id} data-wide={heat || undefined}>
    <div className="exchange-focus-head">
      <div><span>{spec.venue} / {spec.label}</span><h2 id="exchange-panel-heading">{panelLabel(id, lang, data)}</h2></div>
      <button ref={closeButton} type="button" className="exchange-action" aria-label={t(lang, "관제 화면 닫기", "Close market monitor")} onClick={onClose}>×</button>
    </div>
    {single && <StockSearch lang={lang} onPick={next => { setPicked(next); reportExchange("search:" + next.code, "종목 검색 · " + next.name); }} />}
    {single && picked && <div className="exchange-search-note">
      <span>{picked.name} · {picked.code}{searched.row ? "" : " — " + t(lang, "시세 불러오는 중", "loading quote")}</span>
      <button type="button" className="exchange-action" onClick={() => setPicked(undefined)}>{t(lang, "포스트 종목으로", "Back to post stock")}</button>
    </div>}
    {!heat && PAINTERS[id] && (!picked || searchedPainter) && <PanelView key={picked?.code ?? id} id={id} data={data} lang={lang} series={searchedSeries} painter={searchedPainter} />}
    {heat && <FloorHeatmap market={data.market} fallback={data.rows} lang={lang} />}
    {id === "overview" && <OverviewDetails data={data} lang={lang} />}
    {details}
    <a className="exchange-detail-link" href={link.to} target="_blank" rel="noopener noreferrer"
      aria-label={link.label + " (" + t(lang, "새 탭", "new tab") + ")"}>{link.label} ↗</a>
  </aside>;
}

function Joystick({ driver, lang }: { driver: FloorDriver | null; lang: Language }) {
  const stick = useRef<HTMLSpanElement>(null);
  const pointer = useRef<number>();
  const motion = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointer.current !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - rect.left - rect.width / 2) / (rect.width * .36);
    const dy = (event.clientY - rect.top - rect.height / 2) / (rect.height * .36);
    const norm = Math.max(1, Math.hypot(dx, dy));
    if (stick.current) stick.current.style.transform = "translate(" + dx / norm * 23 + "px," + dy / norm * 23 + "px)";
    driver?.move(dx / norm, -dy / norm);
  };
  const end = () => {
    pointer.current = undefined;
    if (stick.current) stick.current.style.transform = "";
    driver?.move(0, 0);
  };
  return <button className="exchange-joystick" type="button" aria-label={t(lang, "이동 조이스틱", "Movement joystick")}
    onPointerDown={event => {
      pointer.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      motion(event);
    }} onPointerMove={motion} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
    <span ref={stick} />
  </button>;
}

function MarketSwitch({ market, lang, choose }: { market: ExchangeMarket; lang: Language; choose: (m: ExchangeMarket) => void }) {
  return <div className="exchange-switch-mini" data-market={market} role="group" aria-label={t(lang, "거래소 시장 선택", "Select exchange market")}>
    {MARKETS_LIST.map(key => (
      <button
        key={key}
        type="button"
        data-option={key}
        aria-pressed={market === key}
        title={t(lang, `${MARKETS[key].label} 거래소로 전환`, `Switch trading floor to ${MARKETS[key].label}`)}
        onClick={() => choose(key)}
      >
        <i className="exchange-switch-dot" aria-hidden="true" />
        <span>{MARKETS[key].label}</span>
      </button>
    ))}
  </div>;
}

const plan = (x: number, z: number) => ({ left: (50 + x / FLOOR.room.width * 100) + "%", top: (50 + z / FLOOR.room.depth * 100) + "%" });

/** The round floor plan, drawn from the same layout the 3D hall is built from (viewBox in metres). */
const FloorPlan = memo(function FloorPlan() {
  const R = FLOOR.room.radius, rad = Math.PI / 180;
  const pt = (r: number, t: number) => `${(r * Math.sin(t * rad)).toFixed(2)} ${(r * Math.cos(t * rad)).toFixed(2)}`;
  const band = (r0: number, r1: number, a0: number, a1: number) => {
    const big = a1 - a0 > 180 ? 1 : 0;
    // Angles grow toward +x from +z, i.e. clockwise on this plan (x right, z down): sweep flag 0.
    return `M${pt(r1, a0)}A${r1} ${r1} 0 ${big} 0 ${pt(r1, a1)}L${pt(r0, a1)}A${r0} ${r0} 0 ${big} 1 ${pt(r0, a0)}Z`;
  };
  return <svg className="exchange-plan-svg" viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`} aria-hidden="true">
    <circle r={R - .2} className="exchange-plan-wall" />
    <circle r={FLOOR.radii.gallery} className="exchange-plan-gallery" />
    {FLOOR.desks.map((d, i) => <path key={i} d={band(d.r - .05, d.r + .8, d.a0, d.a1)} className="exchange-plan-desk" />)}
    {FLOOR.lounges.map(l => <path key={l.t} d={band(17.1, 20.7, l.t - 11, l.t + 11)} className="exchange-plan-lounge" />)}
    <circle r={FLOOR.radii.counter} className="exchange-plan-counter" />
    <circle r={FLOOR.tower.plinth} className="exchange-plan-core" />
    {FLOOR.columns.map(c => <circle key={c.x + ":" + c.z} cx={c.x} cy={c.z} r={.9} className="exchange-plan-column" />)}
  </svg>;
});

// Start fetching the 3D WebGPU floorEngine chunk immediately on module load (overlaps with React mount!)
const floorEngineMod = typeof window !== "undefined" ? import("./floorEngine") : null;

export default function ExchangePage() {
  const { lang } = useLanguage();
  const [market, setMarket] = useState<ExchangeMarket>(() => marketCode(new URLSearchParams(location.search).get("market")));
  const data = useFloorQuotes(market);
  const histories = usePostSeries(market, data.rows);
  const [phase, setPhase] = useState<Phase>("loading");
  const [progress, setProgress] = useState(0);
  const [retry, setRetry] = useState({ id: 0, recovery: false });
  const [driver, setDriver] = useState<FloorDriver | null>(null);
  const [focus, setFocus] = useState<string>();
  const [showMap, setShowMap] = useState(true);
  const [sound, setSound] = useState(false);
  const [soundError, setSoundError] = useState(false);
  const [full, setFull] = useState(false);
  const [mood, setMood] = useState<AtriumMood>(() => {
    if (typeof window !== "undefined") {
      const raw = new URLSearchParams(window.location.search).get("testChange");
      if (raw !== null && Number.isFinite(Number(raw)) && Number(raw) >= 3.0) return "night";
    }
    return "daylight";
  });
  const moodManualRef = useRef(false);
  const chooseMood = (next: AtriumMood, label: string, prefix = "무드 · ") => {
    moodManualRef.current = true;
    setMood(next);
    reportExchange("mood:" + next, prefix + label);
  };
  const [tour, setTour] = useState(false);
  const [lift, setLift] = useState<LiftState | null>(null);
  const [floor, setFloor] = useState(0);
  // On phones (portrait or landscape), fill the viewport without browser fullscreen swipe gestures.
  const [immersive, setImmersive] = useState(() => matchMedia("(max-width: 760px), ((pointer: coarse) and (max-height: 520px))").matches);
  const viewportFullscreen = matchMedia("(any-pointer: coarse), (max-width: 760px)").matches;
  // The market switch lives in the site's context bar, left of 오늘의 핫이슈; inside the floor when immersive.
  const [slot, setSlot] = useState<Element | null>(null);
  useEffect(() => { setSlot(document.querySelector(".ng-exchange-slot")); }, []);
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const mark = useRef<HTMLElement>(null);
  const audio = useRef<FloorAudio | null>(null);
  const audioPending = useRef(false);
  const activeAudio = useRef(true);
  const currentPosition = useRef({ ...FLOOR.spawn });
  const displays = useRef({ snapshot: data, series: histories, language: lang });
  displays.current = { snapshot: data, series: histories, language: lang };
  const spec = MARKETS[market];

  useEffect(() => {
    if (!host.current || !canvas.current) return;
    const container = host.current, element = canvas.current;
    let engine: FloorDriver | undefined, failed = false;
    const controller = new AbortController();
    const signal = controller.signal;
    setPhase("loading");
    setProgress(0);
    setDriver(null);
    const onError = (error: unknown) => {
      if (signal.aborted || failed) return;
      failed = true;
      controller.abort();
      console.warn("[exchange] 3D floor failed", error);
      setDriver(null);
      if (!retry.recovery) {
        setRetry({ id: retry.id + 1, recovery: true });
      } else {
        reportExchange("3d:failed", "3D 시작 실패");
        setPhase("failed");
      }
    };
    void (floorEngineMod ?? import("./floorEngine")).then(({ createFloor }) => createFloor(container, element, signal, {
      renderer(mode) { setPhase(mode); reportExchange("3d:" + mode, "3D 입장 " + mode.toUpperCase()); },
      progress: setProgress,
      position(x, z, yaw) {
        currentPosition.current = { ...currentPosition.current, x, z, yaw };
        if (mark.current) {
          Object.assign(mark.current.style, plan(x, z));
          mark.current.style.rotate = -yaw + "rad";
        }
        audio.current?.position(x, z, yaw);
      },
      select(id) { setFocus(id); audio.current?.select(); reportExchange("panel:" + id, (id.includes(":") && !id.startsWith("a:") ? "감상 · " : "관제 화면 · ") + panelLabel(id, "ko")); },
      lift: setLift,
      floor: setFloor,
      tour: setTour,
      initialDisplays: () => displays.current,
      error: onError,
    }, retry.recovery)).then(value => {
      engine = value;
      if (signal.aborted || failed) value.dispose();
      else setDriver(value);
    }).catch(onError);
    return () => { controller.abort(); engine?.dispose(); };
  }, [retry]);
  const lastUpdateMeta = useRef<{ driver: FloorDriver | null; market: ExchangeMarket; lang: Language }>({ driver: null, market, lang });
  useEffect(() => {
    if (!driver) return;
    const prev = lastUpdateMeta.current;
    const immediate = prev.driver !== driver || prev.market !== market || prev.lang !== lang;
    lastUpdateMeta.current = { driver, market, lang };
    if (immediate) {
      driver.update(data, histories, lang);
      return;
    }
    // Coalesce staggered polling responses (13 endpoints settling over ~1-3s) so screens.update() runs once per batch!
    const timer = window.setTimeout(() => { driver.update(data, histories, lang); }, 120);
    return () => window.clearTimeout(timer);
  }, [data, driver, histories, lang, market]);
  useEffect(() => {
    if (moodManualRef.current) return;
    const raw = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("testChange") : null;
    const effectiveChange = raw !== null && Number.isFinite(Number(raw)) ? Number(raw) : data.index?.change;
    if (typeof effectiveChange === "number" && Number.isFinite(effectiveChange) && effectiveChange >= 3.0) {
      setMood("night");
    }
  }, [data.index?.change]);
  useEffect(() => { driver?.setMood(mood); }, [driver, mood]);
  // Pause 3D frames while a full-screen 2D painting overlay covers the hall (3D sculpture viewer renders live!).
  useEffect(() => {
    const fullOverlay = !!focus && focus.startsWith("art:");
    driver?.suspend(fullOverlay);
  }, [driver, focus]);
  useEffect(() => {
    document.documentElement.classList.toggle("exchange-immersive", immersive);
    return () => document.documentElement.classList.remove("exchange-immersive");
  }, [immersive]);
  const leaveImmersive = () => {
    setImmersive(false);
    reportExchange("view:compact", "몰입 모드 축소");
  };
  // A swipe on the floor is a camera drag, never a page gesture: no scrolling, pull-to-refresh,
  // pinch zoom or swipe-to-exit-full-screen. Lists that really scroll keep their own panning.
  useEffect(() => {
    if (!immersive && !full) return;
    const page = pageRef.current;
    if (!page) return;
    const guard = (event: TouchEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.touches.length < 2 && target?.closest(SCROLLERS)) return;
      if (event.cancelable) event.preventDefault();
    };
    page.addEventListener("touchmove", guard, { passive: false });
    return () => page.removeEventListener("touchmove", guard);
  }, [immersive, full]);
  useEffect(() => {
    activeAudio.current = true;
    return () => { activeAudio.current = false; audio.current?.close(); audio.current = null; };
  }, []);
  useEffect(() => {
    const watch = () => setFull(document.fullscreenElement === pageRef.current);
    document.addEventListener("fullscreenchange", watch);
    return () => document.removeEventListener("fullscreenchange", watch);
  }, []);
  useEffect(() => {
    if (!focus) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFocus(undefined);
        canvas.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);

  function chooseMarket(next: ExchangeMarket) {
    if (next === market) return;
    setMarket(next);
    reportExchange("market:" + next, "시장 전환 " + MARKETS[next].label);
    const url = new URL(location.href);
    if (next === "kospi") url.searchParams.delete("market");
    else url.searchParams.set("market", next);
    window.history.replaceState(window.history.state, "", url);
  }
  function inspect(id: string) {
    reportExchange("panel:" + id, "관제 화면 · " + panelLabel(id, "ko"));
    driver?.stop();
    setFocus(id);
    audio.current?.select();
  }
  function visit(station: Station) {
    reportExchange("station:" + station.id, "이동 · " + station.ko);
    driver?.jump(station);
    if (!driver && PAINTERS[station.id]) inspect(station.id);
    else setFocus(undefined);
  }
  async function toggleSound() {
    if (audio.current) {
      audio.current.close();
      audio.current = null;
      setSound(false);
      return;
    }
    if (audioPending.current) return;
    audioPending.current = true;
    setSoundError(false);
    try {
      const instance = await openFloorSound();
      if (!activeAudio.current) { instance.close(); return; }
      const pose = currentPosition.current;
      instance.position(pose.x, pose.z, pose.yaw);
      audio.current = instance;
      setSound(true);
      reportExchange("sound:on", "음향 켜기");
    } catch { if (activeAudio.current) setSoundError(true); }
    finally { audioPending.current = false; }
  }
  const toggleFullscreen = () => {
    if (document.fullscreenElement === pageRef.current) void document.exitFullscreen().catch(() => {});
    else if (viewportFullscreen) setImmersive(true);
    else void pageRef.current?.requestFullscreen().catch(() => {});
  };
  const toggleTour = () => {
    const next = !tour;
    if (next) setFocus(undefined);
    setTour(next);
    driver?.setTour(next);
    reportExchange("tour:" + (next ? "on" : "off"), "시네마틱 투어");
  };
  const sampleStatus = data.failed ? t(lang, "표본 갱신 지연", "Sample delayed") : t(lang, "표본 갱신", "Sample updated");

  return <main ref={pageRef} className="exchange-page" data-market={market} data-phase={phase} data-immersive={immersive || undefined} data-tour={tour || undefined}>
    <h1 className="exchange-sr-title">{t(lang, "증권 거래소", "Stock exchange")} · {spec.label}</h1>
    {slot && !immersive && createPortal(<MarketSwitch market={market} lang={lang} choose={chooseMarket} />, slot)}
    <div className="exchange-stage">
      <div className="exchange-view" ref={host} style={{ backgroundImage: "url(" + STORAGE_ASSETS + "/floor-preview-v6.webp)" }}>
        <canvas key={retry.id} ref={canvas} className="exchange-canvas" tabIndex={0} aria-label={t(lang, "3D 거래소. 방향키로 이동하고 모니터를 선택하세요.", "3D trading floor. Use arrow keys to move and select a monitor.")} />
      </div>
      {!(focus?.startsWith("art:") || focus?.startsWith("sculpture:")) && <div className="exchange-overlay-top">
        <div className="exchange-top-primary">
          {(immersive || !slot) && <MarketSwitch market={market} lang={lang} choose={chooseMarket} />}
          {(data.received || data.failed) && <div className="exchange-status">
            <i data-live={!data.failed} />
            <small>{sampleStatus}{data.received ? " " + shortTime(data.received) : ""}</small>
          </div>}
          <div className="exchange-top-utility">
            <button type="button" className="exchange-action" aria-pressed={sound} onClick={() => { void toggleSound(); }}>{sound ? t(lang, "음향 켜짐", "Sound on") : t(lang, "음향", "Sound")}</button>
            {immersive ? <button type="button" className="exchange-action" onClick={leaveImmersive}>{t(lang, "축소", "Exit")}</button>
              : (viewportFullscreen || document.fullscreenEnabled) && <button type="button" className="exchange-action" aria-pressed={full} onClick={toggleFullscreen}>{full ? t(lang, "전체화면 종료", "Exit full screen") : t(lang, "전체화면", "Full screen")}</button>}
          </div>
        </div>
        <div className="exchange-stage-actions">
          <div className="exchange-mood-switch" role="group" aria-label={t(lang, "아트리움 조명 무드", "Atrium lighting mood")}>
            {([
              ["daylight", t(lang, "주간", "Day")],
              ["golden", t(lang, "골든아워", "Golden")],
              ["night", t(lang, "네온나이트", "Night")],
            ] as const).map(([key, label]) => (
              <button key={key} type="button" className="exchange-mood-btn" aria-pressed={mood === key} disabled={!driver}
                onClick={() => chooseMood(key, label)}>{label}</button>
            ))}
          </div>
          <button type="button" className="exchange-action exchange-tour-btn" aria-pressed={tour} disabled={!driver}
            onClick={toggleTour}>
            {tour ? t(lang, "투어 중지", "Stop tour") : t(lang, "시네마틱 투어", "Tour")}
          </button>
        </div>
      </div>}
      {soundError && <p className="exchange-sound-error" role="status">{t(lang, "이 기기에서 음향을 시작하지 못했습니다.", "Sound could not start on this device.")}</p>}
      {phase === "loading" && <div className="exchange-entry" role="status">
        <div><span>{t(lang, `${Math.round(FLOOR.room.pyeong)}평 · ${FLOOR.room.area.toLocaleString("en-US")}㎡ 아트리움 거래소`, `${FLOOR.room.area.toLocaleString("en-US")} m² trading atrium`)}</span>
          <strong>{t(lang, "거래소를 불러오는 중", "Loading the trading floor")}</strong>
          <small>{progress < .99 ? t(lang, "3D 모델·라이트맵 수신 ", "Receiving model and lightmaps ") + Math.round(progress * 100) + "%"
            : t(lang, "재질·전광판 셰이더 준비", "Compiling materials and displays")}</small>
          <i className="exchange-progress"><b style={{ width: Math.round(progress * 100) + "%" }} /></i></div>
      </div>}
      {phase === "failed" && <div className="exchange-entry" role="status"><div>
        <strong>{t(lang, "3D 거래소에 연결하지 못했습니다.", "The 3D trading floor could not start.")}</strong>
        <small>{t(lang, "아래 관제 화면에서 시세와 차트를 계속 볼 수 있습니다.", "The market monitors below still show quotes and charts.")}</small>
        <button type="button" className="exchange-action" onClick={() => setRetry(value => ({ id: value.id + 1, recovery: false }))}>{t(lang, "3D 다시 시도", "Retry 3D")}</button>
      </div></div>}
      {!focus && driver && <>
        <span className="exchange-reticle" aria-hidden="true" />
        <Joystick driver={driver} lang={lang} />
        {showMap && <div className="exchange-minimap">
          <span>{t(lang, "거래소 평면도", "Floor map")} <b className="exchange-floor-badge">{floor + 1}F</b></span>
          <div aria-hidden="true" className="exchange-plan">
            <FloorPlan />
            <b ref={mark} className="exchange-plan-person" />
          </div>
        </div>}
        <div className="exchange-instructions"><span>{t(lang, "WASD / 방향키 이동 · Shift 빠르게 · 드래그 시점 · 모니터·작품 클릭", "WASD / arrows move · Shift runs · drag to look · click monitors or art")}</span>
          <small>{t(lang, "왼쪽 조이스틱 이동 · 화면 드래그 · 모니터·작품 탭", "Left joystick moves · drag to look · tap monitors or art")}</small></div>
      </>}
      {focus && (focus.startsWith("art:") || focus.startsWith("sculpture:")
        ? <ArtViewer key={focus} id={focus} lang={lang} driver={driver} onClose={() => { setFocus(undefined); canvas.current?.focus({ preventScroll: true }); }} />
        : <FocusPanel key={market + ":" + focus} data={data} id={focus} lang={lang} histories={histories} onClose={() => {
          setFocus(undefined); canvas.current?.focus({ preventScroll: true });
        }} />)}
      {driver && lift?.inside != null && !focus && <div className="exchange-lift" role="group" aria-label={t(lang, "엘리베이터 층 선택", "Elevator floors")}>
        <span>{t(lang, "글라스 엘리베이터", "Glass elevator")}</span>
        <div>{[3, 2, 1, 0].map(f => <button key={f} type="button" aria-pressed={lift.floor === f && !lift.moving}
          onClick={() => { driver.ride(f); reportExchange("lift:" + (f + 1), "엘리베이터 " + (f + 1) + "층"); }}>{f + 1}F</button>)}</div>
        {lift.moving && <small>{t(lang, "이동 중", "Moving")}</small>}
      </div>}
    </div>
    <div className="exchange-controls">
      <div className="exchange-station-list" aria-label={t(lang, "거래소 내부 이동", "Move to a station")}>
        <button type="button" className="exchange-action" disabled={!driver} onClick={() => { driver?.jump(FLOOR.spawn); setFocus(undefined); }}>{t(lang, "입구", "Entrance")}</button>
        {FLOOR.stations.map(station => <button type="button" className="exchange-action" key={station.id} onClick={() => visit(station)}>{station[lang]}</button>)}
      </div>
      <div className="exchange-utilities">
        <button type="button" className="exchange-action" aria-pressed={showMap} disabled={!driver} onClick={() => setShowMap(value => !value)}>{t(lang, "평면도", "Floor map")}</button>
        <details className="exchange-monitor-picker"><summary className="exchange-action">{t(lang, "관제 화면", "Monitors")} {Object.keys(PANEL_LABELS).length} <span>↑</span></summary>
          <div>{KINDS.map(kind => <section key={kind}>
            <h3>{{ market: t(lang, "시장", "Market"), stocks: t(lang, "종목", "Stocks"), global: t(lang, "세계", "Global"),
              assets: t(lang, "자산", "Assets"), desk: t(lang, "브리핑", "Briefing") }[kind]}</h3>
            {Object.entries(PANEL_LABELS).filter(([, v]) => v[2] === kind).map(([id]) => <button key={id} type="button" className="exchange-action" onClick={event => {
              event.currentTarget.closest("details")?.removeAttribute("open"); inspect(id);
            }}>{panelLabel(id, lang)}</button>)}
          </section>)}
          <section>
            <h3>{t(lang, "포스트 종목 · 검색", "Post stocks · search")}</h3>
            {Array.from({ length: 16 }, (_, i) => "s" + i).map(id => <button key={id} type="button" className="exchange-action" onClick={event => {
              event.currentTarget.closest("details")?.removeAttribute("open"); inspect(id);
            }}>{panelLabel(id, lang, data)}</button>)}
          </section></div>
        </details>
      </div>
    </div>
  </main>;
}
