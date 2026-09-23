import { PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { StockBoard, StockBoardItem, StockBoardSector, api, mergeBoardRefresh } from "../../api/client";
import { useLanguage } from "../../i18n/LanguageContext";
import { useTranslatedTexts } from "../../i18n/useTranslatedTexts";
import { startVisibilityAwareInterval } from "../../pollVisibility";
import { Link, navigate } from "../../router";
import { useDocumentTitle } from "../../useDocumentTitle";
import SessionSplit from "../../components/SessionSplit";
import StockLogo from "../../components/StockLogo";
import Colophon from "../Colophon";
import Finder from "../Finder";
import Masthead from "../Masthead";
import Tape from "../Tape";
import { Marker, SectionHead, Skel } from "../parts";
import { num, pct, toneOf, useL } from "../lib";
import { useBroadsheet, useFinderHotkey } from "../shell";
import "../pages.css";
import "../etf/etf.css";
import "./board.css";

/* TOP 100면 — /kospi-100, /kosdaq-100, /nasdaq-100 as the paper's big-cap page.
 *
 * The data handling is the classic board's, unchanged: one full load with three
 * months of closes per name, then a slim refresh every ten seconds that splices the
 * new prices onto the series already in hand (mergeBoardRefresh), and a full reload
 * every fifteen minutes so the bars keep gaining days. Every card still answers
 * "how is this doing" at four horizons — today, the three-month line (with a hover
 * readout), the 52-week range and the 1W/1M/3M/YTD returns — plus its rank inside
 * its own 업종 and its move against the board, and on the NASDAQ board the split
 * between the regular session and after-hours.
 *
 * New around it:
 *  - a front block written from the board (the average move, how broad it was, the
 *    sector that carried it, the best and worst names, how many sit near a 52-week
 *    high);
 *  - a sector strip sized by market cap and shaded by the day's move;
 *  - a table view (one row per name, every horizon in columns) beside the card
 *    and compact views;
 *  - market, 업종, ordering, view and search live in the URL.
 * The strip of market headers, the site index and the colophon are the broadsheet's. */

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
    flat: p.get("group") === "none",
    q: p.get("q") ?? "",
  };
}

function Spark({ points, dates, fmt, trend }: { points: number[]; dates: string[]; fmt: (v: number) => string; trend: "up" | "down" | "flat" }) {
  const L = useL();
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const g = useMemo(() => {
    if (points.length < 2) return null;
    const lo = Math.min(...points);
    const hi = Math.max(...points);
    const span = hi - lo || 1;
    const x = (i: number) => (i / (points.length - 1)) * 100;
    const y = (v: number) => 94 - ((v - lo) / span) * 88;
    const c = points.map((v, i) => [x(i), y(v)] as const);
    const line = c.map(([a, b]) => `${a.toFixed(2)},${b.toFixed(2)}`).join(" ");
    return { c, line, area: `0,100 ${line} 100,100`, base: y(points[0]) };
  }, [points]);
  if (!g) return <div className="bd-spark is-empty">{L("차트 데이터 없음", "No chart data")}</div>;
  const i = hover ?? points.length - 1;
  const [hx, hy] = g.c[i];
  const off = dates.length - points.length;
  const d = dates[off + i] ?? "";
  const label = i === points.length - 1 ? L("현재", "Now") : d.length === 8 ? `${d.slice(4, 6)}.${d.slice(6)}` : d;
  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    setHover(Math.min(points.length - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * (points.length - 1)))));
  };
  return (
    <div className={`bd-spark is-${trend}`}>
      <svg ref={ref} viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={L("최근 3개월 종가 추이", "Closes over three months")} onPointerMove={move} onPointerLeave={() => setHover(null)}>
        <polyline className="bd-spark-area" points={g.area} />
        <line className="bd-spark-base" x1="0" x2="100" y1={g.base} y2={g.base} vectorEffect="non-scaling-stroke" />
        <polyline className="bd-spark-line" points={g.line} vectorEffect="non-scaling-stroke" />
        {hover !== null && <line className="bd-spark-cross" x1={hx} x2={hx} y1="0" y2="100" vectorEffect="non-scaling-stroke" />}
      </svg>
      <span className="bd-spark-dot" style={{ left: `${hx}%`, top: `${hy}%` }} />
      <span className={`bd-spark-read ${hover !== null ? "is-on" : ""}`}>
        <b>{fmt(points[i])}</b>
        <i>{label}</i>
      </span>
    </div>
  );
}

export default function BoardPage({ market }: { market: Market }) {
  const { lang } = useLanguage();
  const L = useL();
  useBroadsheet();
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
  const [finderOpen, setFinderOpen] = useState(false);
  useFinderHotkey(setFinderOpen);
  const boardRef = useRef<StockBoard | null>(null);
  const lastFull = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    // Switching boards keeps this page mounted; the previous market's view state
    // would filter the new one to nothing. The URL's own state survives the first mount.
    if (first.current) {
      first.current = false;
    } else {
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
    const loadFull = () =>
      api
        .stockBoard(market)
        .then((b) => {
          if (cancelled) return;
          lastFull.current = Date.now();
          apply(b);
        })
        .catch(fail);
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
      stop();
    };
  }, [market]);

  useEffect(() => {
    const p = new URLSearchParams();
    if (sector) p.set("sector", sector);
    if (sort !== "marcap") p.set("sort", sort);
    if (view !== "card") p.set("view", view);
    if (flat) p.set("group", "none");
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
  const updated = board?.generated_at ? board.generated_at.replace("T", " ").slice(5, 19) : "";
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
                  <dd className={`d2-num is-${toneOf(it.returns[k])}`}>{pct(it.returns[k], 1)}</dd>
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

  return (
    <div className="d2 bd" lang={lang}>
      <a className="d2-skip" href="#bd-list">
        {L("본문 바로가기", "Skip to content")}
      </a>
      <Masthead
        onPrint={() => window.print()}
        section={{
          ko: meta.ko.replace(" 100", " TOP 100"),
          en: meta.en.replace(" 100", " TOP 100"),
          taglineKo: us ? "나스닥100 지수 편입 상위 100종목을 업종별로" : `${meta.ko.replace(" 100", "")} 시가총액 상위 100종목을 업종별로`,
          taglineEn: us ? "The NASDAQ 100, by sector" : `The top 100 ${meta.en.replace(" 100", "")} names by size, by sector`,
        }}
      />
      <Tape />

      <div className="d2-cmd bd-bar" data-d2-sticky>
        <div className="d2-cmd-inner bd-bar-inner">
          <Marker options={BOARDS.map((x) => ({ id: x.market, label: L(x.ko, x.en) }))} value={market} onChange={(m) => navigate(BOARDS.find((x) => x.market === m)!.path)} label={L("시장", "Market")} className="bd-boards" />
          <label className="st-search">
            <span aria-hidden="true">⌕</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={L("종목명 · 코드", "Name or code")} aria-label={L("종목 검색", "Search")} autoComplete="off" />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label={L("지우기", "Clear")}>
                ×
              </button>
            )}
          </label>
          <div className="sk-seg" role="group" aria-label={L("보기", "View")}>
            {(["card", "compact", "table"] as View[]).map((v) => (
              <button key={v} type="button" className={view === v ? "is-on" : ""} aria-pressed={view === v} onClick={() => setView(v)}>
                {v === "card" ? L("카드", "Cards") : v === "compact" ? L("간략", "Compact") : L("표", "Table")}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="d2-main">
        <section className="d2-sec bd-front" aria-label={L("보드 1면", "Board front")}>
          {front && b ? (
            <>
              <p className="d2-lead-kicker">
                <span className="d2-lead-status is-live">{L("10초마다 갱신", "Live, every 10s")}</span>
                {updated && <span>{updated} {L("기준", "")}</span>}
                {board?.session && board.session !== "regular" && <span className="sk-session">{board.session === "pre" ? L("프리마켓 시세", "Pre-market prices") : L("애프터마켓 시세", "After-hours prices")}</span>}
              </p>
              <h2 className="bd-head">{headline}</h2>
              <div className="bd-front-grid">
                <div>
                  <div className="d2-adbar" role="img" aria-label={`${b.up} / ${b.flat} / ${b.down}`}>
                    <span className="is-up" style={{ flexGrow: b.up }}>{b.up}</span>
                    <span className="is-flat" style={{ flexGrow: Math.max(b.flat, 2) }}>{b.flat}</span>
                    <span className="is-down" style={{ flexGrow: b.down }}>{b.down}</span>
                  </div>
                  <p className="bd-front-note">
                    {L("시가총액 가중 평균", "Cap-weighted average")} <b className={`d2-num is-${toneOf(b.avg_change_pct)}`}>{pct(b.avg_change_pct)}</b> · {L("상승 · 보합 · 하락", "up · flat · down")}
                  </p>
                  <dl className="ef-leaders bd-leaders">
                    <div>
                      <dt>{L("상승 선두", "Top gainer")}</dt>
                      <dd>
                        <Link to={`/stock/${front.best.code}`}>{nameOf.get(front.best.code)}</Link>
                        <b className={`d2-num is-${toneOf(front.best.change_pct)}`}>{pct(front.best.change_pct)}</b>
                      </dd>
                    </div>
                    <div>
                      <dt>{L("하락 선두", "Top loser")}</dt>
                      <dd>
                        <Link to={`/stock/${front.worst.code}`}>{nameOf.get(front.worst.code)}</Link>
                        <b className={`d2-num is-${toneOf(front.worst.change_pct)}`}>{pct(front.worst.change_pct)}</b>
                      </dd>
                    </div>
                    <div>
                      <dt>{L("52주 고점권", "Near 52W high")}</dt>
                      <dd>
                        <button type="button" onClick={() => setSort("range")}>{L("고점 근접순으로 보기", "Sort by it")}</button>
                        <b className="d2-num">
                          {num(front.nearHigh)}
                          {L("종목", "")}
                        </b>
                      </dd>
                    </div>
                    <div>
                      <dt>{L("52주 저점권", "Near 52W low")}</dt>
                      <dd>
                        <span />
                        <b className="d2-num">
                          {num(front.nearLow)}
                          {L("종목", "")}
                        </b>
                      </dd>
                    </div>
                  </dl>
                </div>
                <div>
                  <h3 className="sk-col-head">{L("업종 지도", "Sectors by size")}</h3>
                  <div className="bd-strip">
                    {sectors.map((s) => {
                      const share = (s.marcap / totalCap) * 100;
                      return (
                        <button
                          key={s.sector}
                          type="button"
                          className={`is-${dir(s.avg_change_pct)} ${sector === s.sector ? "is-me" : ""}`}
                          style={{ flexGrow: share, ["--heat" as string]: Math.min(1, Math.abs(s.avg_change_pct) / 3).toFixed(2) }}
                          data-narrow={share < 7 ? "" : undefined}
                          onClick={() => setSector(sector === s.sector ? "" : s.sector)}
                          title={`${s.sector} ${pct(s.avg_change_pct)} · ${s.count}`}
                        >
                          <span>{s.sector}</span>
                          <b>{pct(s.avg_change_pct, 1)}</b>
                        </button>
                      );
                    })}
                  </div>
                  <p className="bd-front-note">{L("폭은 업종 시가총액, 색은 시총가중 등락. 누르면 그 업종만 봅니다.", "Width is the sector's size, shade its move. Click to filter.")}</p>
                </div>
              </div>
            </>
          ) : error ? (
            <p className="d2-empty">{error}</p>
          ) : (
            <div className="sk-loading">
              <Skel h={40} w="60%" />
              <Skel h={120} />
            </div>
          )}
        </section>

        <section id="bd-list" className="d2-sec" aria-labelledby="bd-list-h">
          <SectionHead id="bd-list-h" no="01" kicker={L("종목 보드", "The board")} title={L(`${meta.ko} 전 종목`, `All of the ${meta.en}`)} note={L(`${visible.length}종목 표시 · 카드를 누르면 종목면으로 갑니다.`, `${visible.length} shown · a card opens its company page.`)} />
          <div className="ef-controls">
            <div className="bd-controls">
              <Marker options={SORTS.map((s) => ({ id: s.key, label: L(s.ko, s.en) }))} value={sort} onChange={setSort} label={L("정렬", "Order")} />
              {view !== "table" && (
                <div className="sk-seg" role="group" aria-label={L("묶음", "Grouping")}>
                  <button type="button" className={!flat ? "is-on" : ""} aria-pressed={!flat} onClick={() => setFlat(false)}>
                    {L("업종별", "By sector")}
                  </button>
                  <button type="button" className={flat ? "is-on" : ""} aria-pressed={flat} onClick={() => setFlat(true)}>
                    {L("전체 순위", "One list")}
                  </button>
                </div>
              )}
            </div>
            <div className="st-chips" role="group" aria-label={L("업종", "Sector")}>
              <button type="button" className={!sector ? "is-on" : ""} onClick={() => setSector("")}>
                {L("전체", "All")}
                <small>{items.length}</small>
              </button>
              {sectors.map((s) => (
                <button key={s.sector} type="button" className={sector === s.sector ? "is-on" : ""} onClick={() => setSector(sector === s.sector ? "" : s.sector)}>
                  {s.sector}
                  <small>{s.count}</small>
                  <em className={`is-${dir(s.avg_change_pct)}`}>{pct(s.avg_change_pct, 1)}</em>
                </button>
              ))}
            </div>
          </div>

          {!board && !error && (
            <div className="bd-grid">
              {Array.from({ length: 8 }, (_, i) => (
                <Skel key={i} h={300} />
              ))}
            </div>
          )}
          {board && visible.length === 0 && <p className="d2-empty">{L("조건에 맞는 종목이 없습니다.", "Nothing matches.")}</p>}

          {board && view === "table" && visible.length > 0 && (
            <div className="d2-table-wrap bd-table">
              <table className="d2-table">
                <thead>
                  <tr>
                    <th className="is-rank">#</th>
                    <th className="is-name">{L("종목", "Name")}</th>
                    <th>{L("현재가", "Price")}</th>
                    <th>{L("등락률", "Change")}</th>
                    <th>{L("시장 대비", "vs board")}</th>
                    <th>{L("업종 내", "In sector")}</th>
                    <th>{L("1주", "1W")}</th>
                    <th>{L("1개월", "1M")}</th>
                    <th>{L("3개월", "3M")}</th>
                    <th>{L("연초", "YTD")}</th>
                    <th>{L("52주 위치", "52W")}</th>
                    <th>{board.marcap_kind === "weight" ? L("비중", "Weight") : L("시가총액", "Cap")}</th>
                    <th>{L("거래량", "Volume")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((it) => {
                    const rk = derived.ranks.get(it.code) ?? { r: 1, n: 1 };
                    const rel = it.change_pct - derived.avg;
                    return (
                      <tr key={it.code} onClick={() => navigate(`/stock/${it.code}`)} style={{ cursor: "pointer" }}>
                        <td className="is-rank">{it.rank}</td>
                        <td className="is-name">
                          <span className="ef-tname">
                            <StockLogo code={it.code} name={nameOf.get(it.code)} className="d2-table-logo" />
                            <span>
                              <b>{nameOf.get(it.code)}</b>
                              <small>
                                {it.code} · {it.sector}
                              </small>
                            </span>
                          </span>
                        </td>
                        <td className="d2-num">{price(it.close)}</td>
                        <td className={`d2-num is-${toneOf(it.change_pct)}`}>{pct(it.change_pct)}</td>
                        <td className={`d2-num is-${toneOf(rel)}`}>{rel > 0 ? "+" : rel < 0 ? "−" : ""}{Math.abs(rel).toFixed(2)}%p</td>
                        <td className="d2-num sk-muted">
                          {rk.r}/{rk.n}
                        </td>
                        {(["w1", "m1", "m3", "ytd"] as const).map((k) => (
                          <td key={k} className={`d2-num is-${toneOf(it.returns[k])}`}>
                            {pct(it.returns[k], 1)}
                          </td>
                        ))}
                        <td className="ef-t52">
                          {it.week52_pos != null && (
                            <i>
                              <i style={{ left: `${it.week52_pos * 100}%` }} />
                            </i>
                          )}
                        </td>
                        <td className="d2-num">{size(it.marcap)}</td>
                        <td className="d2-num">{it.volume != null ? vol(it.volume) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {board &&
            view !== "table" &&
            groups.map((g, gi) => (
              <section key={g.summary?.sector ?? `all-${gi}`} className="bd-group">
                {g.summary && (
                  <header className="bd-group-head">
                    <h3>{g.summary.sector}</h3>
                    <span>
                      {g.summary.count}
                      {L("종목", " names")} · {size(g.summary.marcap)}
                    </span>
                    <b className={`d2-num is-${dir(g.summary.avg_change_pct)}`}>
                      {pct(g.summary.avg_change_pct)} <small>{L("시총가중", "cap-wtd")}</small>
                    </b>
                    <span className="bd-mini" role="img" aria-label={`${g.summary.up} / ${g.summary.flat} / ${g.summary.down}`}>
                      <i className="is-up" style={{ flexGrow: g.summary.up }} />
                      <i className="is-flat" style={{ flexGrow: g.summary.flat }} />
                      <i className="is-down" style={{ flexGrow: g.summary.down }} />
                    </span>
                  </header>
                )}
                <div className={`bd-grid ${view === "compact" ? "is-compact" : ""}`}>{g.items.map((it) => card(it, view === "compact"))}</div>
              </section>
            ))}

          <p className="sk-disclaimer">
            {L(
              "시세·시가총액은 실시간(장중 10초 갱신), 차트·52주 범위·기간수익률은 일봉 종가 기준입니다. 기간수익률은 거래일 기준(1주=5거래일, 1개월=21거래일, 3개월=63거래일)이며 연초수익률은 전년도 종가 대비입니다.",
              "Prices and sizes are live (every 10s in session); the chart, 52-week range and period returns use daily closes. Periods count sessions (1W = 5, 1M = 21, 3M = 63); YTD is against last year's final close."
            )}
          </p>
        </section>
      </main>

      <Colophon />
      <Finder open={finderOpen} onClose={() => setFinderOpen(false)} />
    </div>
  );
}
