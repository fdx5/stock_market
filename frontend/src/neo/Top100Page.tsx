import TrendChart from "../charts/TrendChart";
import { useEffect, useMemo, useRef, useState } from "react";
import { StockBoard, StockBoardItem, StockBoardSector, api, mergeBoardRefresh } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { useTranslatedTexts } from "../i18n/useTranslatedTexts";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { Link, navigate } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import SessionSplit from "../components/SessionSplit";
import StockLogo from "../components/StockLogo";
import { pct, toneOf, useL } from "../desk2/lib";
import { HoloPanel, NeoEmptyState, NeoSkeleton } from "./NeoComponents";
import NeoIcon from "./NeoIcon";
import "./top100.css";

type Market = "kospi" | "kosdaq" | "nasdaq";
type SortKey = "marcap" | "gainers" | "losers" | "volume" | "range" | "momentum";
type View = "card" | "compact" | "table";

const POLL_MS = 10_000;
const FULL_RELOAD_MS = 15 * 60 * 1000;
const FLAT = 0.05;

const BOARDS: { market: Market; path: string; ko: string; en: string }[] = [
  { market: "kospi", path: "/kospi-100", ko: "코스피 100", en: "KOSPI 100" },
  { market: "kosdaq", path: "/kosdaq-100", ko: "코스닥 100", en: "KOSDAQ 100" },
  { market: "nasdaq", path: "/nasdaq-100", ko: "나스닥 100", en: "NASDAQ 100" },
];

const SORTS: { key: SortKey; ko: string; en: string; score: (i: StockBoardItem) => number | null }[] = [
  { key: "marcap", ko: "시가총액", en: "Size", score: (i) => i.marcap },
  { key: "gainers", ko: "상승률", en: "Gainers", score: (i) => i.change_pct },
  { key: "losers", ko: "하락률", en: "Losers", score: (i) => -i.change_pct },
  { key: "volume", ko: "거래량", en: "Volume", score: (i) => i.volume ?? null },
  { key: "range", ko: "52주 고점 근접", en: "Near 52W high", score: (i) => i.week52_pos },
  { key: "momentum", ko: "1개월 수익률", en: "1M return", score: (i) => i.returns.m1 ?? null },
];

const dir = (v: number): "up" | "down" | "flat" => (v > FLAT ? "up" : v < -FLAT ? "down" : "flat");

function tidyUsName(name: string): string {
  const t = name
    .replace(/\s*\((?:[^()]*)\)\s*$/, "")
    .replace(/\s*(?:Class\s+[A-Z]\s+)?(?:Common Stock|Capital Stock|Ordinary Shares|Common Shares|American Depositary Shares?|Registered Shares?|Depositary Shares?)\s*$/i, "")
    .replace(/[\s,]+$/, "");
  return t || name;
}

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  const sort = p.get("sort") as SortKey | null;
  const view = p.get("view") as View | null;
  return {
    sector: p.get("sector") ?? "",
    sort: (sort && SORTS.some((s) => s.key === sort) ? sort : "marcap") as SortKey,
    view: (view === "compact" || view === "table" ? view : "card") as View,
    flat: p.get("group") !== "sector",
    q: p.get("q") ?? "",
  };
}

function Spark({points,dates,fmt,trend}:{points:number[];dates:string[];fmt:(v:number)=>string;trend:"up"|"down"|"flat"}) {
 return <TrendChart points={points} dates={dates} trend={trend} className="bd-spark" format={fmt} />;
}

export default function Top100Page({ market }: { market: Market }) {
  const { lang } = useLanguage();
  const L = useL();
  const meta = BOARDS.find((b) => b.market === market) ?? BOARDS[0];
  useDocumentTitle(`${meta.en.replace(" 100", " TOP 100")} | K-Stock Hub`);
  const init = useMemo(readUrl, []);
  const [board, setBoard] = useState<StockBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sector, setSector] = useState(init.sector);
  const [sort, setSort] = useState<SortKey>(init.sort);
  const [query, setQuery] = useState(init.q);
  const [flat, setFlat] = useState(init.flat);
  const [view, setView] = useState<View>(init.view);
  const [refreshing, setRefreshing] = useState(false);
  const reloadRef = useRef<() => void>(() => {});
  const boardRef = useRef<StockBoard | null>(null);
  const lastFull = useRef(0);
  const previousMarket = useRef(market);

  useEffect(() => {
    // Switching boards keeps this page mounted; the previous market's view state
    // would filter the new one to nothing. The URL's own state survives the first mount.
    if (previousMarket.current !== market) {
      previousMarket.current = market;
      setSector("");
      setSort("marcap");
      setQuery("");
    }
    setBoard(null);
    setError(null);
    boardRef.current = null;
    lastFull.current = 0;
    let cancelled = false;
    const apply = (b: StockBoard) => {
      if (cancelled) return;
      boardRef.current = b;
      setBoard(b);
      setError(null);
    };
    const fail = (e: Error) => !cancelled && setError(e.message);
    const loadFull = () => {
      setRefreshing(true);
      return api
        .stockBoard(market)
        .then((b) => {
          if (cancelled) return;
          lastFull.current = Date.now();
          apply(b);
        })
        .catch(fail).finally(() => { if (!cancelled) setRefreshing(false); });
    };
    reloadRef.current = loadFull;
    const load = () => {
      const prev = boardRef.current;
      if (!prev || Date.now() - lastFull.current >= FULL_RELOAD_MS) return void loadFull();
      api
        .stockBoardRefresh(market)
        .then((r) => {
          if (cancelled) return;
          const merged = mergeBoardRefresh(prev, r);
          if (merged) apply(merged);
          else loadFull();
        })
        .catch(fail);
    };
    load();
    const stop = startVisibilityAwareInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      reloadRef.current = () => {};
      stop();
    };
  }, [market]);

  useEffect(() => {
    const p = new URLSearchParams();
    if (sector) p.set("sector", sector);
    if (sort !== "marcap") p.set("sort", sort);
    if (view !== "card") p.set("view", view);
    if (!flat) p.set("group", "sector");
    if (query) p.set("q", query);
    const next = `${meta.path}${p.toString() ? `?${p}` : ""}`;
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, "", next);
  }, [sector, sort, view, flat, query, meta.path]);

  const items = board?.items ?? [];
  const us = market === "nasdaq";
  const currency = board?.currency ?? (us ? "USD" : "KRW");
  const translated = useTranslatedTexts(us ? [] : items.map((i) => i.name));
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    items.forEach((it, i) => m.set(it.code, us ? (it.name_ko && lang === "ko" ? it.name_ko : tidyUsName(it.name)) : translated[i] ?? it.name));
    return m;
  }, [items, translated, us, lang]);

  const price = (v: number) => (currency === "USD" ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : lang === "en" ? `₩${Math.round(v).toLocaleString()}` : `${Math.round(v).toLocaleString()}원`);
  const bare = (v: number) => (currency === "USD" ? v.toFixed(2) : Math.round(v).toLocaleString());
  const size = (v: number) => {
    if (board?.marcap_kind === "weight") return `${v.toFixed(2)}%`;
    const eok = v / 1e8;
    if (lang === "en") return eok >= 10_000 ? `₩${(eok / 10_000).toFixed(1)}T` : `₩${(eok / 10).toFixed(1)}B`;
    return eok >= 10_000 ? `${(eok / 10_000).toFixed(1)}조` : `${Math.round(eok).toLocaleString()}억`;
  };
  const vol = (v: number) => (lang === "en" ? (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e3).toFixed(1)}K`) : v >= 1e8 ? `${(v / 1e8).toFixed(1)}억` : v >= 1e4 ? `${Math.round(v / 1e4).toLocaleString()}만` : v.toLocaleString());

  /* Board-wide figures each card reads. */
  const derived = useMemo(() => {
    const avg = board?.breadth.avg_change_pct ?? 0;
    const by = new Map<string, StockBoardItem[]>();
    items.forEach((it) => by.set(it.sector, [...(by.get(it.sector) ?? []), it]));
    const ranks = new Map<string, { r: number; n: number }>();
    by.forEach((b) => [...b].sort((a, c) => c.change_pct - a.change_pct).forEach((it, i) => ranks.set(it.code, { r: i + 1, n: b.length })));
    return { avg, ranks };
  }, [items, board]);

  const visible = useMemo(() => {
    const n = query.trim().toLowerCase();
    const opt = SORTS.find((s) => s.key === sort) ?? SORTS[0];
    return items
      .filter((it) => (!sector || it.sector === sector) && (!n || it.code.toLowerCase().includes(n) || it.name.toLowerCase().includes(n) || (nameOf.get(it.code) ?? "").toLowerCase().includes(n)))
      .sort((a, b) => {
        const x = opt.score(a);
        const y = opt.score(b);
        if (x === null && y === null) return a.rank - b.rank;
        if (x === null) return 1;
        if (y === null) return -1;
        return y - x || a.rank - b.rank;
      });
  }, [items, sector, sort, query, nameOf]);

  const sectors = board?.sectors ?? [];
  const groups = useMemo(() => {
    if (flat || view === "table") return [{ summary: null as StockBoardSector | null, items: visible }];
    return sectors.map((s) => ({ summary: s, items: visible.filter((i) => i.sector === s.sector) })).filter((g) => g.items.length > 0);
  }, [flat, view, sectors, visible]);

  /* The front block. */
  const front = useMemo(() => {
    if (!board || items.length === 0) return null;
    const byChg = [...items].sort((a, b) => b.change_pct - a.change_pct);
    const bySec = [...sectors].filter((s) => s.count >= 2).sort((a, b) => b.avg_change_pct - a.avg_change_pct);
    const nearHigh = items.filter((i) => i.week52_pos != null && i.week52_pos >= 0.97).length;
    const nearLow = items.filter((i) => i.week52_pos != null && i.week52_pos <= 0.03).length;
    const heaviest = [...sectors].sort((a, b) => b.marcap - a.marcap)[0];
    return { best: byChg[0], worst: byChg[byChg.length - 1], topSec: bySec[0], lowSec: bySec[bySec.length - 1], nearHigh, nearLow, heaviest };
  }, [board, items, sectors]);

  const b = board?.breadth;
  // Built so that no particle follows a sector name — 이/가 depends on the name's
  // last syllable, which an arbitrary label does not reliably give.
  const lead = front?.topSec && front.topSec.avg_change_pct > 0 ? front.topSec : front?.lowSec;
  const headline =
    front && b && lead
      ? lang === "ko"
        ? `${meta.ko} 시총가중 ${pct(b.avg_change_pct)}, ${lead === front.topSec ? "업종 선두" : "업종 최약세"}는 ${lead.sector} ${pct(lead.avg_change_pct)}`
        : `${meta.en} ${pct(b.avg_change_pct)} cap-weighted; ${lead === front.topSec ? "led by" : "weakest:"} ${lead.sector} ${pct(lead.avg_change_pct)}`
      : "";
  const generated = board?.generated_at ? new Date(board.generated_at) : null;
  const updated = generated && !Number.isNaN(generated.getTime()) ? generated.toLocaleString(lang === "ko" ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "";
  const totalCap = sectors.reduce((s, x) => s + x.marcap, 0) || 1;

  const card = (it: StockBoardItem, compact: boolean) => {
    const t = dir(it.change_pct);
    const trend = it.points.length >= 2 ? dir((it.points[it.points.length - 1] / it.points[0] - 1) * 100) : "flat";
    const rk = derived.ranks.get(it.code) ?? { r: 1, n: 1 };
    const rel = it.change_pct - derived.avg;
    const nm = nameOf.get(it.code) ?? it.name;
    return (
      <article key={it.code} className={`bd-card is-${t} ${compact ? "is-compact" : ""}`}>
        <a
          className="bd-hit"
          href={`/stock/${it.code}`}
          aria-label={`${nm} ${price(it.close)} ${pct(it.change_pct)}`}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            navigate(`/stock/${it.code}`);
          }}
        />
        <header>
          <span className="bd-rank">{it.rank}</span>
          <StockLogo code={it.code} name={nm} className="bd-logo" />
          <span className="bd-id">
            <h3 title={nm}>{nm}</h3>
            <small>
              {it.code} · {it.sector}
            </small>
          </span>
        </header>
        <div className={`bd-price is-${t}`}>
          <b>
            {price(it.close)}
            {(it.session === "pre" || it.session === "post") && <em className="bd-session">{it.session === "pre" ? "PRE" : "AFT"}</em>}
          </b>
          <span>
            {pct(it.change_pct)} <small>{it.change > 0 ? "+" : it.change < 0 ? "−" : ""}{bare(Math.abs(it.change))}</small>
          </span>
        </div>
        <SessionSplit quote={it} className="bd-split" />
        <p className="bd-rel">
          <span className={`is-${dir(rel)}`}>
            {L("시장 대비", "vs board")} <b>{rel > 0 ? "+" : rel < 0 ? "−" : ""}{Math.abs(rel).toFixed(2)}%p</b>
          </span>
          <span>{L(`${it.sector} ${rk.r}/${rk.n}위`, `#${rk.r} of ${rk.n} in ${it.sector}`)}</span>
        </p>
        <Spark points={it.points} dates={board?.spark_dates ?? []} fmt={price} trend={trend} />
        {!compact && (
          <>
            {it.week52_pos != null && it.week52_low != null && it.week52_high != null && (
              <div className="bd-52">
                <span>
                  {L("52주", "52W")} <small>{L("고점 대비", "from high")} {pct((it.close / it.week52_high - 1) * 100, 1)}</small>
                </span>
                <i>
                  <i style={{ left: `${it.week52_pos * 100}%` }} />
                </i>
                <span className="bd-52-ends">
                  <small>{bare(it.week52_low)}</small>
                  <small>{bare(it.week52_high)}</small>
                </span>
              </div>
            )}
            <dl className="bd-returns">
              {(["w1", "m1", "m3", "ytd"] as const).map((k) => (
                <div key={k}>
                  <dt>{k === "w1" ? L("1주", "1W") : k === "m1" ? L("1개월", "1M") : k === "m3" ? L("3개월", "3M") : L("연초", "YTD")}</dt>
                  <dd className={`tb-number is-${toneOf(it.returns[k])}`}>{pct(it.returns[k], 1)}</dd>
                </div>
              ))}
            </dl>
            <dl className="bd-stats">
              <div>
                <dt>{board?.marcap_kind === "weight" ? L("지수 비중", "Weight") : L("시가총액", "Market cap")}</dt>
                <dd>{size(it.marcap)}</dd>
              </div>
              {it.volume != null && (
                <div>
                  <dt>{L("거래량", "Volume")}</dt>
                  <dd>{vol(it.volume)}</dd>
                </div>
              )}
              {it.per != null && (
                <div>
                  <dt>PER</dt>
                  <dd>{it.per.toFixed(1)}</dd>
                </div>
              )}
              {it.roe != null && (
                <div>
                  <dt>ROE</dt>
                  <dd>{it.roe.toFixed(1)}%</dd>
                </div>
              )}
              {it.foreign_ratio != null && (
                <div>
                  <dt>{L("외국인", "Foreign")}</dt>
                  <dd>{it.foreign_ratio.toFixed(1)}%</dd>
                </div>
              )}
            </dl>
          </>
        )}
      </article>
    );
  };

  const reset = () => { setQuery(""); setSector(""); setSort("marcap"); };
  return <main className="ng-top100" lang={lang}>
    <header className="tb-hero">
      <div><span className="ng-kicker">MARKET LEADERS / TOP 100</span><h1>{L(meta.ko, meta.en).replace(" 100", " TOP 100")}</h1><p>{us ? L("나스닥 100 구성 종목의 시세와 흐름을 한눈에", "Prices and momentum across the NASDAQ 100") : L("시가총액 상위 100종목의 시세와 흐름을 한눈에", "Prices and momentum across the 100 largest companies")}</p><a className="tb-jump" href="#tb-list">{L("종목 바로 보기", "Jump to companies")} ↓</a></div>
      <div className="tb-update"><span><i />{L("10초 간격 자동 갱신", "Auto-refresh every 10s")}</span>{updated && <time dateTime={board?.generated_at}>{updated} KST</time>}<button type="button" disabled={refreshing} onClick={() => reloadRef.current()}><span aria-hidden="true">↻</span>{refreshing ? L("갱신 중", "Refreshing") : L("새로고침", "Refresh")}</button></div>
    </header>
    <nav className="tb-markets" aria-label={L("TOP 100 시장 선택", "Choose TOP 100 market")}>{BOARDS.map(m => <Link key={m.market} to={m.path} aria-current={market === m.market ? "page" : undefined}><span>{m.market.toUpperCase()}</span><strong>{L(m.ko, m.en)}</strong><NeoIcon name="chevron" /></Link>)}</nav>
    {error && <div className="tb-error" role="alert"><span>{board ? L("시세 갱신이 지연되어 마지막 데이터를 표시합니다.", "Refresh delayed. Showing the last available data.") : error}</span><button type="button" disabled={refreshing} onClick={() => reloadRef.current()}>{L("다시 시도", "Retry")}</button></div>}
    {!board && !error && <HoloPanel className="tb-loading"><NeoSkeleton rows={4} /></HoloPanel>}
    {front && b && <>
      <div className="tb-metrics">
        <HoloPanel><span className="tb-label">{L("시총가중 등락률", "Cap-weighted change")}</span><strong className={`tb-value is-${toneOf(b.avg_change_pct)}`}>{pct(b.avg_change_pct)}</strong><small>{L("전체 종목의 시가총액 비중 반영", "Weighted by each company's size")}</small></HoloPanel>
        <HoloPanel><span className="tb-label">{L("상승 / 하락", "Advancing / declining")}</span><strong className="tb-value"><span className="is-up">{b.up}</span><i>/</i><span className="is-down">{b.down}</span></strong><small>{L(`보합 ${b.flat} · 전체 ${items.length}종목`, `${b.flat} unchanged · ${items.length} companies`)}</small></HoloPanel>
        <HoloPanel><span className="tb-label">{L("상승 선두", "Top gainer")}</span><Link className="tb-leader" to={`/stock/${front.best.code}`}>{nameOf.get(front.best.code)}<span>↗</span></Link><strong className={`tb-subvalue is-${toneOf(front.best.change_pct)}`}>{pct(front.best.change_pct)}</strong></HoloPanel>
        <HoloPanel><span className="tb-label">{L("52주 고점권", "Near 52-week high")}</span><button className="tb-high" onClick={() => { setSort("range"); document.getElementById("tb-list")?.scrollIntoView({ behavior: "smooth" }); }}><strong className="tb-value">{front.nearHigh}<small>{L("종목", "stocks")}</small></strong><span>{L("고점 근접순 보기", "Sort by proximity")} ↗</span></button></HoloPanel>
      </div>
      <div className="tb-overview">
        <HoloPanel title={L("시장 흐름", "Market breadth")}><div className="tb-panel-head"><h2>{L("시장 흐름", "Market breadth")}</h2>{board?.session && <span>{board.session === "pre" ? L("프리마켓", "Pre-market") : board.session === "post" ? L("애프터마켓", "After-hours") : L("정규장 기준", "Regular session")}</span>}</div><p className="tb-headline">{headline || L("종목별 흐름을 확인하세요.", "Explore the moves behind the market.")}</p><div className="tb-breadth" role="img" aria-label={L(`상승 ${b.up}, 보합 ${b.flat}, 하락 ${b.down}`, `${b.up} advancing, ${b.flat} unchanged, ${b.down} declining`)}><i className="is-up" style={{ flexGrow: b.up }} /><i className="is-flat" style={{ flexGrow: b.flat }} /><i className="is-down" style={{ flexGrow: b.down }} /></div><div className="tb-breadth-labels"><span className="is-up">{L("상승", "Up")} {b.up}</span><span>{L("보합", "Flat")} {b.flat}</span><span className="is-down">{L("하락", "Down")} {b.down}</span></div><div className="tb-laggard"><span>{L("하락 선두", "Top decliner")}</span><Link to={`/stock/${front.worst.code}`}>{nameOf.get(front.worst.code)}</Link><b className={`is-${toneOf(front.worst.change_pct)}`}>{pct(front.worst.change_pct)}</b></div></HoloPanel>
        <HoloPanel title={L("주요 업종", "Leading sectors")}><div className="tb-panel-head"><h2>{L("주요 업종", "Leading sectors")}</h2><span>{L("시가총액 비중순 · 선택해 필터", "By size · select to filter")}</span></div><div className="tb-sector-map">{[...sectors].sort((a, c) => c.marcap - a.marcap).slice(0, 6).map(s => <button key={s.sector} type="button" aria-pressed={sector === s.sector} onClick={() => setSector(sector === s.sector ? "" : s.sector)}><span>{s.sector}<small>{L(`${s.count}종목`, `${s.count} stocks`)}</small></span><strong className={`is-${dir(s.avg_change_pct)}`}>{pct(s.avg_change_pct)}</strong><i style={{ width: `${Math.max(2, s.marcap / totalCap * 100)}%` }} /></button>)}</div></HoloPanel>
      </div>
    </>}
    <section id="tb-list" className="tb-list" aria-labelledby="tb-list-heading">
      <div className="tb-list-head"><div><span className="ng-kicker">RANKING / {market.toUpperCase()}</span><h2 id="tb-list-heading">{L("종목 한눈에 보기", "Explore the companies")} <small>{visible.length}<span> / {items.length}</span></small></h2></div><div className="tb-views" role="group" aria-label={L("보기 방식", "Display mode")}>{(["card", "compact", "table"] as View[]).map(v => <button type="button" key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v === "card" ? L("카드", "Cards") : v === "compact" ? L("간략", "Compact") : L("비교표", "Table")}</button>)}</div></div>
      <HoloPanel className="tb-controls">
        <div className="tb-tools"><label className="tb-search"><NeoIcon name="search" /><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={L("종목명 또는 코드 검색", "Search name or symbol")} aria-label={L("종목 검색", "Search companies")} autoComplete="off" />{query && <button type="button" onClick={() => setQuery("")} aria-label={L("검색어 지우기", "Clear search")}>×</button>}</label><label className="tb-sort"><span>{L("정렬", "Sort")}</span><select value={sort} onChange={e => setSort(e.target.value as SortKey)}>{SORTS.map(s => <option key={s.key} value={s.key}>{s.key === "marcap" && board?.marcap_kind === "weight" ? L("지수 비중", "Index weight") : L(s.ko, s.en)}</option>)}</select></label>{view !== "table" && <div className="tb-grouping" role="group" aria-label={L("종목 묶음", "Grouping")}><button type="button" aria-pressed={flat} onClick={() => setFlat(true)}>{L("전체 순위", "All ranks")}</button><button type="button" aria-pressed={!flat} onClick={() => setFlat(false)}>{L("업종별", "By sector")}</button></div>}{(query || sector || sort !== "marcap") && <button type="button" className="tb-reset" onClick={reset}>{L("초기화", "Reset")}</button>}</div>
        <div className="tb-chips" role="group" aria-label={L("업종 필터", "Filter sectors")}><button type="button" aria-pressed={!sector} onClick={() => setSector("")}>{L("전체 업종", "All sectors")}<small>{items.length}</small></button>{sectors.map(s => <button type="button" key={s.sector} aria-pressed={sector === s.sector} onClick={() => setSector(sector === s.sector ? "" : s.sector)}>{s.sector}<small>{s.count}</small></button>)}</div>
      </HoloPanel>
      {board && visible.length === 0 && <NeoEmptyState title={L("조건에 맞는 종목이 없습니다", "No matching companies")}><button type="button" className="tb-reset" onClick={reset}>{L("검색·필터 초기화", "Clear search and filters")}</button></NeoEmptyState>}
      {board && view === "table" && visible.length > 0 && <><p className="tb-table-hint">{L("좌우로 밀면 기간별 수익률과 추가 지표를 볼 수 있습니다.", "Scroll sideways for period returns and additional metrics.")}</p><div className="tb-table-wrap" tabIndex={0} role="region" aria-label={L("종목 비교표", "Company comparison table")}><table><caption className="tb-sr-only">{L(meta.ko, meta.en)} · {L("종목 비교", "Company comparison")}</caption><thead><tr><th scope="col">{board.marcap_kind === "weight" ? L("종목 / 비중 순위", "Company / weight rank") : L("종목 / 시총 순위", "Company / size rank")}</th><th scope="col">{L("현재가", "Price")}</th><th scope="col">{L("등락률", "Change")}</th><th scope="col">{L("시장 대비", "vs board")}</th><th scope="col">{L("업종 내", "In sector")}</th>{[L("1주", "1W"), L("1개월", "1M"), L("3개월", "3M"), L("연초", "YTD"), L("52주 위치", "52W"), board.marcap_kind === "weight" ? L("비중", "Weight") : L("시가총액", "Cap"), L("거래량", "Volume")].map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead><tbody>{visible.map(it => { const rk = derived.ranks.get(it.code) ?? { r: 1, n: 1 }; const rel = it.change_pct - derived.avg; return <tr key={it.code}><th scope="row"><Link to={`/stock/${it.code}`}><span className="bd-rank">{it.rank}</span><StockLogo code={it.code} name={nameOf.get(it.code)} className="bd-logo" /><span><b>{nameOf.get(it.code)}</b><small>{it.code} · {it.sector}</small></span></Link></th><td>{price(it.close)}</td><td className={`is-${toneOf(it.change_pct)}`}>{pct(it.change_pct)}</td><td className={`is-${toneOf(rel)}`}>{rel > 0 ? "+" : rel < 0 ? "−" : ""}{Math.abs(rel).toFixed(2)}%p</td><td>{rk.r}/{rk.n}</td>{(["w1", "m1", "m3", "ytd"] as const).map(k => <td key={k} className={`is-${toneOf(it.returns[k])}`}>{pct(it.returns[k], 1)}</td>)}<td>{it.week52_pos != null ? <span className="tb-range" title={`${Math.round(it.week52_pos * 100)}%`}><i style={{ left: `${Math.max(0, Math.min(100, it.week52_pos * 100))}%` }} /></span> : "—"}</td><td>{size(it.marcap)}</td><td>{it.volume != null ? vol(it.volume) : "—"}</td></tr>; })}</tbody></table></div></>}
      {board && view !== "table" && groups.map((g, gi) => <section key={g.summary?.sector ?? `all-${gi}`} className="bd-group">{g.summary && <header className="bd-group-head"><h3>{g.summary.sector}</h3><span>{g.items.length}{L("종목", " stocks")}</span><b className={`is-${dir(g.summary.avg_change_pct)}`}>{pct(g.summary.avg_change_pct)}</b></header>}<div className={`bd-grid ${view === "compact" ? "is-compact" : ""}`}>{g.items.map(it => card(it, view === "compact"))}</div></section>)}
    </section>
    <footer className="tb-footnote"><p>{L("시세는 10초 간격으로 갱신을 요청하며 원천 제공 상태에 따라 지연될 수 있습니다. 차트·52주 범위·기간 수익률은 일봉 종가 기준입니다.", "Prices refresh every 10 seconds and may be delayed by the source. Charts, 52-week ranges and period returns use daily closes.")}</p><p>{L("1주 5거래일 · 1개월 21거래일 · 3개월 63거래일 · 연초 수익률은 전년도 종가 대비", "1W: 5 sessions · 1M: 21 · 3M: 63 · YTD: versus the previous year-end close")}</p></footer>
  </main>;
}
