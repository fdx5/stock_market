import { PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { GlobalTop100Item, api } from "../../api/client";
import CompanyLogo from "../../components/CompanyLogo";
import { formatPrice } from "../../components/GlobalTop100Sparkline";
import { hiResFlagUrl } from "../../data/flagCodes";
import { useLanguage } from "../../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../../pollVisibility";
import { useDocumentTitle } from "../../useDocumentTitle";
import Colophon from "../Colophon";
import Finder from "../Finder";
import Masthead from "../Masthead";
import { Marker, SectionHead, Skel } from "../parts";
import { pct, toneOf, useL } from "../lib";
import { useBroadsheet, useFinderHotkey } from "../shell";
import "../pages.css";
import "./globalcap.css";

/* 세계 시총면 — the hundred largest companies on earth, as a league table.
 *
 * Kept from the classic page, on the same endpoint and the same 20-second poll:
 * live price, day move and market cap, the rank change since yesterday, the
 * 90-session sparkline with its hover readout, 1M return, PER and the analyst
 * rating, search, the five orderings, and the expanded row with seven return
 * windows, sector, EPS, margin, growth, PER, analyst count, the company profile and
 * the CEO's photo; the first-build "warming up" state and the provenance note.
 *
 * New:
 *  - a front block written from the list: the leader and its size, the total, how
 *    many rose and fell, the biggest movers and climbers;
 *  - 국가별 and 업종별 shares drawn as strips — click one to filter the table;
 *  - a returns table with all seven windows side by side, plus 1M and 1Y orderings;
 *  - country, sector, ordering, view and search live in the URL. */

type SortKey = "marcap" | "change" | "rankChange" | "m1" | "y1" | "pe" | "name";
type View = "list" | "table";

const SORTS: { id: SortKey; ko: string; en: string; score: (it: GlobalTop100Item) => number | null; asc?: boolean }[] = [
  { id: "marcap", ko: "시가총액", en: "Size", score: (it) => it.market_cap_usd },
  { id: "change", ko: "오늘 등락", en: "Today", score: (it) => it.change_pct },
  { id: "rankChange", ko: "순위 상승", en: "Climbers", score: (it) => it.rank_change },
  { id: "m1", ko: "1개월", en: "1M", score: (it) => it.returns.m1 ?? null },
  { id: "y1", ko: "1년", en: "1Y", score: (it) => it.returns.y1 ?? null },
  { id: "pe", ko: "PER 낮은 순", en: "Low P/E", score: (it) => (it.trailing_pe != null && it.trailing_pe > 0 ? it.trailing_pe : null), asc: true },
  { id: "name", ko: "이름", en: "Name", score: () => 0 },
];

const WINDOWS: { key: keyof GlobalTop100Item["returns"]; ko: string; en: string }[] = [
  { key: "d1", ko: "1일", en: "1D" },
  { key: "w1", ko: "7일", en: "7D" },
  { key: "m1", ko: "1개월", en: "1M" },
  { key: "m3", ko: "3개월", en: "3M" },
  { key: "m6", ko: "6개월", en: "6M" },
  { key: "y1", ko: "1년", en: "1Y" },
  { key: "all", ko: "전체", en: "All" },
];

const COUNTRY_KO: Record<string, string> = {
  USA: "미국",
  China: "중국",
  UK: "영국",
  Switzerland: "스위스",
  Canada: "캐나다",
  Japan: "일본",
  France: "프랑스",
  Taiwan: "대만",
  "S. Korea": "한국",
  Germany: "독일",
  "S. Arabia": "사우디",
  Netherlands: "네덜란드",
  India: "인도",
  Denmark: "덴마크",
  Australia: "호주",
  Ireland: "아일랜드",
  Spain: "스페인",
  Italy: "이탈리아",
  Sweden: "스웨덴",
  "Hong Kong": "홍콩",
  Brazil: "브라질",
  UAE: "UAE",
  Belgium: "벨기에",
  Singapore: "싱가포르",
};

const SECTOR_KO: Record<string, string> = {
  Technology: "기술",
  "Financial Services": "금융",
  Healthcare: "헬스케어",
  "Consumer Defensive": "필수소비재",
  "Communication Services": "커뮤니케이션",
  Industrials: "산업재",
  "Consumer Cyclical": "경기소비재",
  Energy: "에너지",
  "Basic Materials": "소재",
  Utilities: "유틸리티",
  "Real Estate": "부동산",
};

const RATING: Record<string, { ko: string; en: string; tone: string }> = {
  strong_buy: { ko: "강력매수", en: "Strong buy", tone: "buy2" },
  buy: { ko: "매수", en: "Buy", tone: "buy" },
  hold: { ko: "중립", en: "Hold", tone: "hold" },
  sell: { ko: "매도", en: "Sell", tone: "sell" },
  strong_sell: { ko: "강력매도", en: "Strong sell", tone: "sell2" },
};

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  const sort = p.get("sort") as SortKey | null;
  return {
    q: p.get("q") ?? "",
    sort: (sort && SORTS.some((s) => s.id === sort) ? sort : "marcap") as SortKey,
    view: (p.get("view") === "table" ? "table" : "list") as View,
    country: p.get("country") ?? "",
    sector: p.get("sector") ?? "",
  };
}

const trillion = (usd: number | null, lang: "ko" | "en") => (usd == null ? "—" : lang === "ko" ? `$${(usd / 1e12).toFixed(2)}조` : `$${(usd / 1e12).toFixed(2)}T`);

function Rank({ value }: { value: number | null }) {
  if (value == null) return null;
  if (value === 0) return <span className="gc-rchg is-flat">–</span>;
  return <span className={`gc-rchg ${value > 0 ? "is-climb" : "is-slide"}`}>{value > 0 ? `▲${value}` : `▼${-value}`}</span>;
}

function Rating({ item }: { item: GlobalTop100Item }) {
  const { lang } = useLanguage();
  if (!item.recommendation_key) return <span className="gc-rating is-none">—</span>;
  const r = RATING[item.recommendation_key];
  return <span className={`gc-rating is-${r?.tone ?? "hold"}`}>{r ? (lang === "ko" ? r.ko : r.en) : item.recommendation_label}</span>;
}

/** 90 sessions of closes with a readout that follows the pointer. */
function Spark({ item }: { item: GlobalTop100Item }) {
  const L = useL();
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const pts = item.spark_points;
  const geo = useMemo(() => {
    if (pts.length < 2) return null;
    const lo = Math.min(...pts);
    const hi = Math.max(...pts);
    const span = hi - lo || 1;
    const c = pts.map((v, i) => [(i / (pts.length - 1)) * 100, 94 - ((v - lo) / span) * 88] as const);
    return { c, line: c.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" "), base: 94 - ((pts[0] - lo) / span) * 88 };
  }, [pts]);
  if (!geo) return <span className="gc-spark is-empty">{L("차트 없음", "No chart")}</span>;
  const trend = toneOf(pts[pts.length - 1] - pts[0]);
  const i = hover ?? pts.length - 1;
  const [hx, hy] = geo.c[i];
  const offset = item.spark_dates.length - pts.length;
  const d = item.spark_dates[offset + i] ?? "";
  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    setHover(Math.min(pts.length - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1)))));
  };
  return (
    <span className={`gc-spark is-${trend}`}>
      <svg ref={ref} viewBox="0 0 100 100" preserveAspectRatio="none" onPointerMove={move} onPointerLeave={() => setHover(null)} role="img" aria-label={L("최근 시세 추이", "Recent prices")}>
        <line x1="0" x2="100" y1={geo.base} y2={geo.base} className="gc-spark-base" vectorEffect="non-scaling-stroke" />
        <polyline points={geo.line} className="gc-spark-line" vectorEffect="non-scaling-stroke" />
        {hover !== null && <line x1={hx} x2={hx} y1="0" y2="100" className="gc-spark-cross" vectorEffect="non-scaling-stroke" />}
      </svg>
      <i className="gc-spark-dot" style={{ left: `${hx}%`, top: `${hy}%` }} />
      <small className={hover !== null ? "is-on" : ""}>
        <b>{formatPrice(pts[i], item.currency)}</b> {hover === null || i === pts.length - 1 ? L("현재", "now") : `${d.slice(4, 6)}.${d.slice(6, 8)}`}
      </small>
    </span>
  );
}

function Detail({ item }: { item: GlobalTop100Item }) {
  const L = useL();
  const { lang } = useLanguage();
  const desc = lang === "en" ? item.description_en ?? item.description_ko : item.description_ko ?? item.description_en;
  const sector = item.sector ? (lang === "ko" ? SECTOR_KO[item.sector] ?? item.sector : item.sector) : "—";
  return (
    <div className="gc-detail">
      <div className="gc-detail-main">
        <dl className="gc-windows">
          {WINDOWS.map((w) => {
            const v = item.returns[w.key] ?? null;
            return (
              <div key={w.key}>
                <dt>{L(w.ko, w.en)}</dt>
                <dd className={`is-${toneOf(v)}`}>{pct(v)}</dd>
              </div>
            );
          })}
        </dl>
        <dl className="gc-stats">
          <div>
            <dt>{L("업종", "Sector")}</dt>
            <dd>{sector}</dd>
          </div>
          <div>
            <dt>{L("세부 산업", "Industry")}</dt>
            <dd>{item.industry ?? "—"}</dd>
          </div>
          <div>
            <dt>{L("희석 EPS", "Diluted EPS")}</dt>
            <dd>{item.trailing_eps != null ? item.trailing_eps.toFixed(2) : "—"}</dd>
          </div>
          <div>
            <dt>{L("순이익률", "Net margin")}</dt>
            <dd>{item.profit_margin != null ? `${(item.profit_margin * 100).toFixed(1)}%` : "—"}</dd>
          </div>
          <div>
            <dt>{L("EPS 성장률", "EPS growth")}</dt>
            <dd>{item.earnings_growth != null ? `${(item.earnings_growth * 100).toFixed(1)}%` : "—"}</dd>
          </div>
          <div>
            <dt>PER</dt>
            <dd>{item.trailing_pe != null ? item.trailing_pe.toFixed(2) : "—"}</dd>
          </div>
          <div>
            <dt>{L("애널리스트 의견", "Analysts")}</dt>
            <dd>
              <Rating item={item} />
              {item.analyst_count != null && <small> ({item.analyst_count})</small>}
            </dd>
          </div>
        </dl>
        {desc && <p className="gc-desc">{desc}</p>}
      </div>
      <figure className="gc-ceo">
        {item.ceo_photo_url ? (
          <img src={item.ceo_photo_url} alt={item.ceo_name ?? item.name} loading="lazy" />
        ) : (
          <span className="gc-ceo-fallback">
            <CompanyLogo item={item} className="gc-logo" />
          </span>
        )}
        <figcaption>{item.ceo_name ? `CEO · ${item.ceo_name}` : item.name}</figcaption>
      </figure>
    </div>
  );
}

export default function GlobalCapPage() {
  const { lang } = useLanguage();
  const L = useL();
  useBroadsheet();
  useDocumentTitle("글로벌 시가총액 TOP 100 | K-Stock Hub");
  const init = useMemo(readUrl, []);
  const [items, setItems] = useState<GlobalTop100Item[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [liveAt, setLiveAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState(init.q);
  const [sort, setSort] = useState<SortKey>(init.sort);
  const [view, setView] = useState<View>(init.view);
  const [country, setCountry] = useState(init.country);
  const [sector, setSector] = useState(init.sector);
  const [open, setOpen] = useState<string | null>(null);
  const [finderOpen, setFinderOpen] = useState(false);
  useFinderHotkey(setFinderOpen);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .globalTop100()
        .then((d) => {
          if (cancelled) return;
          setItems(d.items);
          setUpdatedAt(d.updated_at);
          setLiveAt(d.live_updated_at);
          setError("");
        })
        // A failed tick leaves the list on screen.
        .catch((e: Error) => !cancelled && setError(e.message));
    load();
    const stop = startVisibilityAwareInterval(load, 20_000);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  useEffect(() => {
    const p = new URLSearchParams();
    if (query.trim()) p.set("q", query.trim());
    if (sort !== "marcap") p.set("sort", sort);
    if (view !== "list") p.set("view", view);
    if (country) p.set("country", country);
    if (sector) p.set("sector", sector);
    const next = `${window.location.pathname}${p.toString() ? `?${p}` : ""}`;
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, "", next);
  }, [query, sort, view, country, sector]);

  const all = useMemo(() => items ?? [], [items]);
  const warming = items !== null && items.length === 0 && updatedAt === null;
  const totalCap = useMemo(() => all.reduce((s, i) => s + (i.market_cap_usd ?? 0), 0), [all]);

  const shares = (key: (i: GlobalTop100Item) => string | null) => {
    const m = new Map<string, { cap: number; n: number; move: number }>();
    for (const it of all) {
      const k = key(it);
      if (!k) continue;
      const e = m.get(k) ?? { cap: 0, n: 0, move: 0 };
      e.cap += it.market_cap_usd ?? 0;
      e.n += 1;
      e.move += (it.market_cap_usd ?? 0) * (it.change_pct ?? 0);
      m.set(k, e);
    }
    return [...m.entries()].map(([k, e]) => ({ key: k, cap: e.cap, n: e.n, move: e.cap ? e.move / e.cap : 0 })).sort((a, b) => b.cap - a.cap);
  };
  const byCountry = useMemo(() => shares((i) => i.country), [all]); // eslint-disable-line react-hooks/exhaustive-deps
  const bySector = useMemo(() => shares((i) => i.sector), [all]); // eslint-disable-line react-hooks/exhaustive-deps

  const front = useMemo(() => {
    if (all.length === 0) return null;
    const ranked = [...all].sort((a, b) => (b.market_cap_usd ?? 0) - (a.market_cap_usd ?? 0));
    const moved = all.filter((i) => i.change_pct != null);
    const up = moved.filter((i) => (i.change_pct ?? 0) > 0.05).length;
    const down = moved.filter((i) => (i.change_pct ?? 0) < -0.05).length;
    const byMove = [...moved].sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0));
    const climbers = all.filter((i) => (i.rank_change ?? 0) > 0).sort((a, b) => (b.rank_change ?? 0) - (a.rank_change ?? 0));
    const weighted = totalCap ? all.reduce((s, i) => s + (i.market_cap_usd ?? 0) * (i.change_pct ?? 0), 0) / totalCap : 0;
    return { leader: ranked[0], second: ranked[1], up, down, flat: moved.length - up - down, best: byMove[0], worst: byMove[byMove.length - 1], climbers: climbers.slice(0, 3), weighted };
  }, [all, totalCap]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let list = all;
    if (country) list = list.filter((i) => i.country === country);
    if (sector) list = list.filter((i) => i.sector === sector);
    if (needle) list = list.filter((i) => i.symbol.toLowerCase().includes(needle) || i.name.toLowerCase().includes(needle) || (COUNTRY_KO[i.country] ?? "").includes(needle));
    const opt = SORTS.find((s) => s.id === sort) ?? SORTS[0];
    if (sort === "name") return [...list].sort((a, b) => a.name.localeCompare(b.name));
    return [...list].sort((a, b) => {
      const sa = opt.score(a);
      const sb = opt.score(b);
      if (sa === null && sb === null) return a.rank - b.rank;
      if (sa === null) return 1;
      if (sb === null) return -1;
      return (opt.asc ? sa - sb : sb - sa) || a.rank - b.rank;
    });
  }, [all, query, sort, country, sector]);

  // Today's cap order, which the live overlay can move ahead of the nightly rank.
  const liveRank = useMemo(() => {
    const m = new Map<string, number>();
    [...all].sort((a, b) => (b.market_cap_usd ?? 0) - (a.market_cap_usd ?? 0)).forEach((it, i) => m.set(it.symbol, i + 1));
    return m;
  }, [all]);

  const cName = (c: string) => (lang === "ko" ? COUNTRY_KO[c] ?? c : c);
  const sName = (s: string) => (lang === "ko" ? SECTOR_KO[s] ?? s : s);
  const flag = (it: GlobalTop100Item) => hiResFlagUrl(it.country) ?? it.flag_url;
  const time = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(lang === "ko" ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "";

  const headline = front
    ? L(
        `세계 시총 1위 ${front.leader.name} ${trillion(front.leader.market_cap_usd, "ko")}, 100대 기업 합계 ${trillion(totalCap, "ko")}`,
        `${front.leader.name} leads at ${trillion(front.leader.market_cap_usd, "en")}; the top 100 add up to ${trillion(totalCap, "en")}`
      )
    : "";

  return (
    <div className="d2 gc" lang={lang}>
      <a className="d2-skip" href="#gc-list">
        {L("본문 바로가기", "Skip to content")}
      </a>
      <Masthead
        rail={false}
        onPrint={() => window.print()}
        section={{ ko: "글로벌 시총", en: "Global Caps", taglineKo: "전 세계 시가총액 상위 100개 기업의 순위·주가·재무", taglineEn: "The world's hundred largest companies — rank, price and fundamentals" }}
      />

      <div className="d2-cmd gc-bar" data-d2-sticky>
        <div className="d2-cmd-inner gc-bar-inner">
          <label className="st-search">
            <span aria-hidden="true">⌕</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={L("기업명 · 심볼 · 국가", "Company, ticker or country")} aria-label={L("기업 검색", "Search")} autoComplete="off" />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label={L("지우기", "Clear")}>
                ×
              </button>
            )}
          </label>
          {(country || sector) && (
            <button
              type="button"
              className="gc-clear"
              onClick={() => {
                setCountry("");
                setSector("");
              }}
            >
              {[country && cName(country), sector && sName(sector)].filter(Boolean).join(" · ")} ×
            </button>
          )}
          <div className="sk-seg" role="group" aria-label={L("보기", "View")}>
            <button type="button" className={view === "list" ? "is-on" : ""} aria-pressed={view === "list"} onClick={() => setView("list")}>
              {L("순위표", "League")}
            </button>
            <button type="button" className={view === "table" ? "is-on" : ""} aria-pressed={view === "table"} onClick={() => setView("table")}>
              {L("수익률표", "Returns")}
            </button>
          </div>
        </div>
      </div>

      <main className="d2-main">
        <section className="d2-sec gc-front" aria-label={L("세계 시총 1면", "Front")}>
          <p className="d2-lead-kicker">
            <span className="d2-lead-status is-live">{L("20초마다 갱신", "Live, every 20s")}</span>
            {liveAt && <span>{L(`시세 ${time(liveAt)} 기준`, `Prices at ${time(liveAt)}`)}</span>}
            {updatedAt && <span>{L(`순위·재무 ${time(updatedAt)} 갱신`, `Ranks ${time(updatedAt)}`)}</span>}
          </p>
          {!front ? (
            error ? (
              <p className="d2-empty">{error}</p>
            ) : (
              <div className="sk-loading">
                {warming && <p className="d2-empty">{L("서버가 데이터를 처음 준비하는 중입니다. 몇 분 정도 걸릴 수 있어요.", "The server is building the list for the first time — this can take a few minutes.")}</p>}
                <Skel h={44} w="64%" />
                <Skel h={140} />
              </div>
            )
          ) : (
            <>
              <h2 className="gc-head">{headline}</h2>
              <div className="gc-front-grid">
                <div className="gc-leader">
                  <span className="gc-leader-no">1</span>
                  <CompanyLogo item={front.leader} className="gc-logo gc-logo--xl" />
                  <div>
                    <b>{front.leader.name}</b>
                    <small>
                      {cName(front.leader.country)} · {front.leader.symbol}
                    </small>
                    <p>
                      <span className="d2-num">{front.leader.price != null ? formatPrice(front.leader.price, front.leader.currency) : "—"}</span>
                      <em className={`d2-num is-${toneOf(front.leader.change_pct)}`}>{pct(front.leader.change_pct)}</em>
                    </p>
                    {front.second && front.leader.market_cap_usd && front.second.market_cap_usd && (
                      <p className="gc-leader-gap">
                        {L(
                          `2위 ${front.second.name}보다 ${trillion(front.leader.market_cap_usd - front.second.market_cap_usd, "ko")} 앞서 있습니다`,
                          `${trillion(front.leader.market_cap_usd - front.second.market_cap_usd, "en")} ahead of ${front.second.name}`
                        )}
                      </p>
                    )}
                  </div>
                </div>
                <div>
                  <div className="d2-adbar" role="img" aria-label={`${front.up} / ${front.flat} / ${front.down}`}>
                    <span className="is-up" style={{ flexGrow: front.up }}>
                      {front.up}
                    </span>
                    <span className="is-flat" style={{ flexGrow: Math.max(front.flat, 2) }}>
                      {front.flat}
                    </span>
                    <span className="is-down" style={{ flexGrow: front.down }}>
                      {front.down}
                    </span>
                  </div>
                  <p className="gc-note">
                    {L("시총가중 평균", "Cap-weighted")} <b className={`d2-num is-${toneOf(front.weighted)}`}>{pct(front.weighted)}</b> · {L("상승 · 보합 · 하락", "up · flat · down")}
                  </p>
                  <dl className="gc-movers">
                    <div>
                      <dt>{L("오늘 가장 많이 오른", "Best today")}</dt>
                      <dd>
                        <button type="button" onClick={() => setOpen(front.best.symbol)}>
                          {front.best.name}
                        </button>
                        <b className={`d2-num is-${toneOf(front.best.change_pct)}`}>{pct(front.best.change_pct)}</b>
                      </dd>
                    </div>
                    <div>
                      <dt>{L("오늘 가장 많이 내린", "Worst today")}</dt>
                      <dd>
                        <button type="button" onClick={() => setOpen(front.worst.symbol)}>
                          {front.worst.name}
                        </button>
                        <b className={`d2-num is-${toneOf(front.worst.change_pct)}`}>{pct(front.worst.change_pct)}</b>
                      </dd>
                    </div>
                    {front.climbers.map((c) => (
                      <div key={c.symbol}>
                        <dt>{L("순위 상승", "Climber")}</dt>
                        <dd>
                          <button type="button" onClick={() => setOpen(c.symbol)}>
                            {c.name}
                          </button>
                          <b className="gc-rchg is-climb">▲{c.rank_change}</b>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>

              <div className="gc-strips">
                <div>
                  <h3 className="sk-col-head">{L("국가별 시가총액", "By country")}</h3>
                  <div className="gc-strip">
                    {byCountry.map((c) => {
                      const share = (c.cap / totalCap) * 100;
                      return (
                        <button
                          key={c.key}
                          type="button"
                          className={`${country === c.key ? "is-me" : ""}${share < 6.5 ? " is-thin" : ""}`}
                          style={{ flexGrow: share }}
                          onClick={() => setCountry(country === c.key ? "" : c.key)}
                          title={`${cName(c.key)} ${share.toFixed(1)}% · ${c.n}${L("개사", "")}`}
                        >
                          <span>{cName(c.key)}</span>
                          <b>{share.toFixed(share < 10 ? 1 : 0)}%</b>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <h3 className="sk-col-head">{L("업종별 시가총액", "By sector")}</h3>
                  <div className="gc-strip gc-strip--sector">
                    {bySector.map((s) => {
                      const share = (s.cap / totalCap) * 100;
                      return (
                        <button
                          key={s.key}
                          type="button"
                          className={`is-${toneOf(s.move)}${sector === s.key ? " is-me" : ""}${share < 6.5 ? " is-thin" : ""}`}
                          style={{ flexGrow: share, ["--heat" as string]: Math.min(1, Math.abs(s.move) / 2).toFixed(2) }}
                          onClick={() => setSector(sector === s.key ? "" : s.key)}
                          title={`${sName(s.key)} ${share.toFixed(1)}% · ${pct(s.move)} · ${s.n}`}
                        >
                          <span>{sName(s.key)}</span>
                          <b>{pct(s.move, 1)}</b>
                        </button>
                      );
                    })}
                  </div>
                  <p className="gc-note">{L("폭은 시가총액 비중, 색은 시총가중 등락. 누르면 그 국가·업종만 봅니다.", "Width is share of the total, shade the day's weighted move. Click to filter.")}</p>
                </div>
              </div>
            </>
          )}
        </section>

        <section id="gc-list" className="d2-sec" aria-labelledby="gc-list-h">
          <SectionHead
            id="gc-list-h"
            no="01"
            kicker={L("순위표", "The table")}
            title={L("세계 시가총액 상위 100", "The world's top 100 by market value")}
            note={L(`${visible.length}개 기업 · 줄을 누르면 수익률, 재무, 회사 소개가 펼쳐집니다.`, `${visible.length} shown · open a row for returns, fundamentals and profile.`)}
          />
          <div className="gc-controls">
            <Marker options={SORTS.map((s) => ({ id: s.id, label: L(s.ko, s.en) }))} value={sort} onChange={setSort} label={L("정렬", "Order")} className="gc-sorts" />
          </div>

          {!items && !error && (
            <div className="gc-rows">
              {Array.from({ length: 10 }, (_, i) => (
                <Skel key={i} h={64} />
              ))}
            </div>
          )}
          {items && !warming && visible.length === 0 && <p className="d2-empty">{L("조건에 맞는 기업이 없습니다.", "Nothing matches.")}</p>}

          {view === "list" ? (
            <ol className="gc-rows">
              {visible.map((it) => {
                const isOpen = open === it.symbol;
                const f = flag(it);
                return (
                  <li key={it.symbol} className={isOpen ? "is-open" : ""}>
                    <button type="button" className="gc-row" onClick={() => setOpen(isOpen ? null : it.symbol)} aria-expanded={isOpen}>
                      <span className="gc-rank">
                        <b>{liveRank.get(it.symbol)}</b>
                        <Rank value={it.rank_change} />
                      </span>
                      <CompanyLogo item={it} className="gc-logo" />
                      <span className="gc-id">
                        <b>{it.name}</b>
                        <small>
                          {f && <img src={f} alt="" />}
                          {cName(it.country)} · {it.symbol}
                        </small>
                      </span>
                      <span className="gc-px">
                        <b className="d2-num">{it.price != null ? formatPrice(it.price, it.currency) : "—"}</b>
                        <em className={`d2-num is-${toneOf(it.change_pct)}`}>{pct(it.change_pct)}</em>
                      </span>
                      <span className="gc-cap">
                        <small>{L("시가총액", "Mkt cap")}</small>
                        <b className="d2-num">{trillion(it.market_cap_usd, lang)}</b>
                        <i className="gc-cap-bar" style={{ width: `${Math.max(2, ((it.market_cap_usd ?? 0) / (front?.leader.market_cap_usd || 1)) * 100)}%` }} aria-hidden="true" />
                      </span>
                      <Spark item={it} />
                      <span className="gc-tags">
                        <span className={`d2-num is-${toneOf(it.returns.m1 ?? null)}`}>
                          <i>{L("1개월", "1M")}</i>
                          {pct(it.returns.m1 ?? null)}
                        </span>
                        <span className="d2-num">
                          <i>PER</i>
                          {it.trailing_pe != null ? it.trailing_pe.toFixed(1) : "—"}
                        </span>
                        <Rating item={it} />
                      </span>
                      <span className="gc-toggle" aria-hidden="true">
                        {isOpen ? "−" : "+"}
                      </span>
                    </button>
                    {isOpen && <Detail item={it} />}
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="d2-table-wrap gc-table">
              <table className="d2-table">
                <thead>
                  <tr>
                    <th className="is-rank">#</th>
                    <th className="is-name">{L("기업", "Company")}</th>
                    <th>{L("국가", "Country")}</th>
                    <th>{L("주가", "Price")}</th>
                    <th>{L("시가총액", "Mkt cap")}</th>
                    {WINDOWS.map((w) => (
                      <th key={w.key}>{L(w.ko, w.en)}</th>
                    ))}
                    <th>PER</th>
                    <th>{L("의견", "Rating")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((it) => (
                    <tr key={it.symbol}>
                      <td className="is-rank">{liveRank.get(it.symbol)}</td>
                      <td className="is-name">
                        <button
                          type="button"
                          onClick={() => {
                            setView("list");
                            setOpen(it.symbol);
                          }}
                        >
                          <CompanyLogo item={it} className="gc-logo gc-logo--sm" />
                          {it.name}
                        </button>
                      </td>
                      <td className="gc-tcountry">{cName(it.country)}</td>
                      <td>{it.price != null ? formatPrice(it.price, it.currency) : "—"}</td>
                      <td>{trillion(it.market_cap_usd, lang)}</td>
                      {WINDOWS.map((w) => {
                        const v = it.returns[w.key] ?? null;
                        return (
                          <td key={w.key} className={`is-${toneOf(v)}`}>
                            {w.key === "all" && v != null && Math.abs(v) >= 1000 ? `${v > 0 ? "+" : ""}${Math.round(v).toLocaleString()}%` : pct(v, 1)}
                          </td>
                        );
                      })}
                      <td>{it.trailing_pe != null ? it.trailing_pe.toFixed(1) : "—"}</td>
                      <td>
                        <Rating item={it} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="sk-disclaimer">
            {L(
              "순위·국가·로고는 companiesmarketcap.com, 시세는 Yahoo Finance 기준이며 20초마다 갱신됩니다. 순위 변동은 전일 대비이고, 번호는 실시간 시가총액 순서입니다. CEO 사진은 Wikidata의 자유 이용 사진입니다.",
              "Ranks, countries and logos from companiesmarketcap.com; prices from Yahoo Finance, refreshed every 20 seconds. Rank changes are against yesterday; the number is today's live order. CEO photos are freely licensed images via Wikidata."
            )}
          </p>
        </section>
      </main>

      <Colophon />
      <Finder open={finderOpen} onClose={() => setFinderOpen(false)} />
    </div>
  );
}
