import { useEffect, useMemo, useState } from "react";
import { BoardPost, EtfItem, GlobalDiscussionPost, api } from "../../api/client";
import { useLanguage } from "../../i18n/LanguageContext";
import { startVisibilityAwareInterval } from "../../pollVisibility";
import { Link } from "../../router";
import { useBodyScrollLock } from "../../useBodyScrollLock";
import { useDocumentTitle } from "../../useDocumentTitle";
import StockLogo from "../../components/StockLogo";
import Colophon from "../Colophon";
import Finder from "../Finder";
import Masthead from "../Masthead";
import { Marker, SectionHead, Skel, Spark } from "../parts";
import { krwPrice, num, pct, shares, toneOf, usd, usdPrice, useL, won } from "../lib";
import Discussion from "../reader/Discussion";
import { useBroadsheet, useFinderHotkey } from "../shell";
import "../pages.css";
import "./etf.css";

/* ETF면 — the funds, set as a paper's fund page.
 *
 * Everything the classic ETF page did is here, on the same two endpoints and the
 * same cadences (quotes every ten seconds, discussion titles every three minutes):
 * 국내/해외 tabs, search with suggestions, the seven orderings, category filters,
 * card and table views, each fund's rolling discussion titles, the board opened
 * over the page (Naver for KRX funds, Toss for US ones), links to the fund's own
 * page and the 3D explorer, and the leveraged-product disclaimer.
 *
 * What is new is the reading around it:
 *  - a front block written from the numbers — how many funds rose, where the
 *    money went, which categories led;
 *  - a category table: each category's average move, breadth and share of the
 *    day's turnover, so "which themes are money flowing into" is one glance;
 *  - 거래 급증: today's volume against the fund's own average, as a column and an
 *    ordering — the classic page had the average and never used it;
 *  - 52-week position as an ordering;
 *  - leveraged and inverse funds carry a tag, because the disclaimer at the foot
 *    applies to them and a reader should not have to know that;
 *  - region, category, ordering, view and search live in the URL. */

type Region = "KR" | "US";
type SortKey = "turnover" | "volume" | "change" | "d20" | "d60" | "d120" | "surge" | "pos52" | "name";
type View = "card" | "table";

const pos52 = (e: EtfItem) =>
  e.week52_high && e.week52_low && e.week52_high > e.week52_low ? Math.min(100, Math.max(0, ((e.close - e.week52_low) / (e.week52_high - e.week52_low)) * 100)) : null;
const surge = (e: EtfItem) => (e.average_volume ? (e.volume / e.average_volume) * 100 : null);
const geared = (e: EtfItem) => /레버리지|인버스|2X|3X|Ultra|Bear|Bull|Leverag|Inverse|\b-?[23]x\b/i.test(`${e.name} ${e.benchmark}`);

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  const sort = p.get("sort") as SortKey | null;
  return {
    region: (p.get("region") === "US" ? "US" : "KR") as Region,
    q: p.get("q") ?? "",
    category: p.get("category") ?? "",
    sort: (sort && ["turnover", "volume", "change", "d20", "d60", "d120", "surge", "pos52", "name"].includes(sort) ? sort : "turnover") as SortKey,
    view: (p.get("view") === "table" ? "table" : "card") as View,
  };
}

function Ticker({ titles, onOpen }: { titles: { id: string; title: string }[]; onOpen: (id: string) => void }) {
  const L = useL();
  if (titles.length === 0) return <p className="ef-talk is-empty">{L("최근 토론 글이 없습니다", "No recent posts")}</p>;
  return (
    <div className="ef-talk" aria-label={L("최근 토론 글", "Recent posts")}>
      <span>{L("토론", "Talk")}</span>
      <div className="ef-talk-window">
        <div className="ef-talk-track" style={{ animationDuration: `${Math.max(12, titles.length * 3.5)}s`, ["--n" as string]: titles.length }}>
          {[...titles, titles[0]].map((t, i) => (
            <button key={`${t.id}-${i}`} type="button" onClick={() => onOpen(t.id)} title={t.title}>
              {t.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function EtfPage() {
  const { lang } = useLanguage();
  const L = useL();
  useBroadsheet();
  useDocumentTitle("ETF 마켓 · K-Stock Hub");
  const init = useMemo(readUrl, []);
  const [region, setRegion] = useState<Region>(init.region);
  const [byRegion, setByRegion] = useState<Record<Region, EtfItem[]>>({ KR: [], US: [] });
  const [updatedAt, setUpdatedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState(init.q);
  const [focus, setFocus] = useState(false);
  const [sort, setSort] = useState<SortKey>(init.sort);
  const [category, setCategory] = useState(init.category);
  const [view, setView] = useState<View>(init.view);
  const [board, setBoard] = useState<{ item: EtfItem; id: string | null } | null>(null);
  const [krTalk, setKrTalk] = useState<Record<string, BoardPost[]>>({});
  const [usTalk, setUsTalk] = useState<Record<string, GlobalDiscussionPost[]>>({});
  const [finderOpen, setFinderOpen] = useState(false);
  useFinderHotkey(setFinderOpen);
  useBodyScrollLock(board !== null);

  useEffect(() => {
    let cancelled = false;
    const load = (first = false) => {
      if (first) setLoading(true);
      api
        .etfs(region)
        .then((r) => {
          if (cancelled) return;
          setByRegion((p) => ({ ...p, [region]: r.items }));
          setUpdatedAt(r.updated_at);
          setError("");
        })
        .catch((e: Error) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setLoading(false));
    };
    load(true);
    const stop = startVisibilityAwareInterval(() => load(), 10_000);
    return () => {
      cancelled = true;
      stop();
    };
  }, [region]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      Promise.all([api.etfDiscussions(), api.etfGlobalDiscussions()])
        .then(([kr, us]) => {
          if (cancelled) return;
          setKrTalk(kr.items);
          setUsTalk(us.items);
        })
        .catch(() => {});
    load();
    const stop = startVisibilityAwareInterval(load, 180_000);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  useEffect(() => {
    const p = new URLSearchParams();
    if (region !== "KR") p.set("region", region);
    if (query) p.set("q", query);
    if (category) p.set("category", category);
    if (sort !== "turnover") p.set("sort", sort);
    if (view !== "card") p.set("view", view);
    const next = `/etf${p.toString() ? `?${p}` : ""}`;
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, "", next);
  }, [region, query, category, sort, view]);

  const items = byRegion[region];
  const price = (v: number) => (region === "US" ? usdPrice(v) : krwPrice(v, lang));
  const money = (v: number) => (region === "US" ? usd(v) : won(v, lang));

  const q = query.trim().toLowerCase();
  const suggestions = useMemo(() => (q ? items.filter((i) => `${i.name} ${i.code} ${i.benchmark}`.toLowerCase().includes(q)).slice(0, 6) : []), [items, q]);

  const visible = useMemo(() => {
    const key = (e: EtfItem): number => {
      switch (sort) {
        case "change":
          return e.change_pct;
        case "d20":
        case "d60":
        case "d120":
          return e.returns[sort] ?? -Infinity;
        case "surge":
          return surge(e) ?? -Infinity;
        case "pos52":
          return pos52(e) ?? -Infinity;
        case "volume":
          return e.volume;
        default:
          return e.turnover;
      }
    };
    return items
      .filter((e) => (!category || e.category === category) && `${e.name} ${e.code} ${e.benchmark}`.toLowerCase().includes(q))
      .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name, "ko") : key(b) - key(a)));
  }, [items, category, q, sort]);

  /* The front block's numbers. */
  const stats = useMemo(() => {
    if (items.length === 0) return null;
    const up = items.filter((e) => e.change_pct > 0).length;
    const down = items.filter((e) => e.change_pct < 0).length;
    const total = items.reduce((s, e) => s + e.turnover, 0);
    const byTurn = [...items].sort((a, b) => b.turnover - a.turnover);
    const byChg = [...items].sort((a, b) => b.change_pct - a.change_pct);
    const bySurge = items.filter((e) => surge(e) != null && e.volume > 0).sort((a, b) => (surge(b) ?? 0) - (surge(a) ?? 0));
    const cats = new Map<string, { n: number; up: number; sum: number; turn: number }>();
    for (const e of items) {
      const c = cats.get(e.category) ?? { n: 0, up: 0, sum: 0, turn: 0 };
      c.n += 1;
      c.up += e.change_pct > 0 ? 1 : 0;
      c.sum += e.change_pct;
      c.turn += e.turnover;
      cats.set(e.category, c);
    }
    const categories = [...cats.entries()]
      .map(([name, c]) => ({ name, count: c.n, avg: c.sum / c.n, breadth: (c.up / c.n) * 100, share: total ? (c.turn / total) * 100 : 0 }))
      .sort((a, b) => b.share - a.share);
    return { up, down, flat: items.length - up - down, total, top: byTurn[0], best: byChg[0], worst: byChg[byChg.length - 1], surge: bySurge[0], categories };
  }, [items]);

  const talkFor = (e: EtfItem) =>
    (e.region === "KR" ? krTalk[e.code]?.map((p) => ({ id: p.nid, title: p.title })) : usTalk[e.code]?.map((p) => ({ id: p.id, title: p.title || p.text }))) ?? [];

  const switchRegion = (r: Region) => {
    if (r === region) return;
    setRegion(r);
    setCategory("");
    setQuery("");
  };

  const headline = stats
    ? lang === "ko"
      ? `${region === "KR" ? "국내" : "해외"} ETF ${num(items.length)}종 가운데 ${num(stats.up)}종 상승, 거래대금은 ${stats.top.name}에 가장 많이 몰렸다`
      : `${num(stats.up)} of ${num(items.length)} ${region === "KR" ? "Korean" : "US"} ETFs rose; the most money went into ${stats.top.name}`
    : "";

  const sorts: { id: SortKey; ko: string; en: string }[] = [
    { id: "turnover", ko: "거래대금", en: "Turnover" },
    { id: "volume", ko: "거래량", en: "Volume" },
    { id: "surge", ko: "거래 급증", en: "Volume surge" },
    { id: "change", ko: "오늘 등락", en: "Today" },
    { id: "d20", ko: "20일", en: "20D" },
    { id: "d60", ko: "60일", en: "60D" },
    { id: "d120", ko: "120일", en: "120D" },
    { id: "pos52", ko: "52주 위치", en: "52W position" },
    { id: "name", ko: "이름", en: "Name" },
  ];

  const explorer = (e: EtfItem) => `/discussion-explorer?code=${encodeURIComponent(e.code)}&name=${encodeURIComponent(e.name)}&market=${e.region}&asset=ETF`;
  const detail = (e: EtfItem) => `/stock/${encodeURIComponent(e.code)}?asset=ETF`;
  const categories = useMemo(() => [...new Set(items.map((i) => i.category))], [items]);

  return (
    <div className="d2 ef" lang={lang}>
      <a className="d2-skip" href="#ef-list">
        {L("본문 바로가기", "Skip to content")}
      </a>
      <Masthead
        onPrint={() => window.print()}
        section={{ ko: "ETF", en: "ETF", taglineKo: "돈이 담기는 바구니들 — 국내·해외 ETF 시세면", taglineEn: "The baskets the money goes into — Korean and US funds" }}
      />

      <div className="d2-cmd ef-bar" data-d2-sticky>
        <div className="d2-cmd-inner ef-bar-inner">
          <Marker
            options={[
              { id: "KR", label: (<><img src="/img/flag/kr.svg" alt="" />{L("국내 ETF", "Korea")}</>) },
              { id: "US", label: (<><img src="/img/flag/us.svg" alt="" />{L("해외 ETF", "US")}</>) },
            ]}
            value={region}
            onChange={switchRegion}
            label={L("시장", "Market")}
            className="st-markets"
          />
          <div className="st-search ef-search">
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocus(true)}
              onBlur={() => window.setTimeout(() => setFocus(false), 150)}
              placeholder={L("ETF명 · 코드 · 추종지수", "Fund, code or index")}
              aria-label={L("ETF 검색", "Search ETFs")}
              autoComplete="off"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label={L("지우기", "Clear")}>
                ×
              </button>
            )}
            {focus && suggestions.length > 0 && (
              <div className="ef-suggest" role="listbox">
                {suggestions.map((s) => (
                  <Link key={s.code} to={detail(s)}>
                    <b>{s.name}</b>
                    <small>
                      {s.code} · {s.benchmark}
                    </small>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <div className="sk-seg ef-view" role="group" aria-label={L("보기", "View")}>
            <button type="button" className={view === "card" ? "is-on" : ""} aria-pressed={view === "card"} onClick={() => setView("card")}>
              {L("카드", "Cards")}
            </button>
            <button type="button" className={view === "table" ? "is-on" : ""} aria-pressed={view === "table"} onClick={() => setView("table")}>
              {L("표", "Table")}
            </button>
          </div>
        </div>
      </div>

      <main className="d2-main">
        <section className="d2-sec ef-front" aria-label={L("ETF 1면", "ETF front")}>
          {stats ? (
            <>
              <p className="d2-lead-kicker">
                <span className="d2-lead-status is-live">{L("10초마다 갱신", "Live, every 10s")}</span>
                {updatedAt && (
                  <span>
                    {new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(updatedAt))} {L("기준", "KST")}
                  </span>
                )}
                <span>{L("데이터로 쓴 ETF 1면", "Written from data")}</span>
              </p>
              <h2 className="ef-head">{headline}</h2>
              <div className="ef-front-grid">
                <div className="ef-stats">
                  <div className="ef-ad">
                    <div className="d2-adbar" role="img" aria-label={`${L("상승", "Up")} ${stats.up} ${L("하락", "Down")} ${stats.down}`}>
                      <span className="is-up" style={{ flexGrow: stats.up }}>{stats.up}</span>
                      <span className="is-flat" style={{ flexGrow: Math.max(stats.flat, items.length * 0.02) }}>{stats.flat}</span>
                      <span className="is-down" style={{ flexGrow: stats.down }}>{stats.down}</span>
                    </div>
                    <small>
                      {L("상승 · 보합 · 하락", "Up · flat · down")} · {L("총 거래대금", "Total turnover")} <b className="d2-num">{money(stats.total)}</b>
                    </small>
                  </div>
                  <dl className="ef-leaders">
                    {[
                      { k: L("거래대금 1위", "Top turnover"), e: stats.top, v: money(stats.top.turnover) },
                      { k: L("상승 선두", "Top gainer"), e: stats.best, v: pct(stats.best.change_pct), tone: toneOf(stats.best.change_pct) },
                      { k: L("하락 선두", "Top loser"), e: stats.worst, v: pct(stats.worst.change_pct), tone: toneOf(stats.worst.change_pct) },
                      ...(stats.surge ? [{ k: L("거래 급증", "Volume surge"), e: stats.surge, v: `${((surge(stats.surge) ?? 0) / 100).toFixed(1)}${L("배", "x")}` }] : []),
                    ].map((r) => (
                      <div key={r.k}>
                        <dt>{r.k}</dt>
                        <dd>
                          <Link to={detail(r.e)}>{r.e.name}</Link>
                          <b className={`d2-num ${r.tone ? `is-${r.tone}` : ""}`}>{r.v}</b>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <div className="ef-cats">
                  <h3 className="sk-col-head">{L("카테고리별 흐름", "By category")}</h3>
                  <table className="d2-table">
                    <thead>
                      <tr>
                        <th className="is-name">{L("카테고리", "Category")}</th>
                        <th>{L("종목", "Funds")}</th>
                        <th>{L("평균 등락", "Avg move")}</th>
                        <th>{L("상승 비율", "Rising")}</th>
                        <th>{L("거래대금 비중", "Turnover share")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.categories.slice(0, 8).map((c) => (
                        <tr key={c.name} className={category === c.name ? "is-me" : ""} onClick={() => setCategory(category === c.name ? "" : c.name)} style={{ cursor: "pointer" }}>
                          <td className="is-name">{c.name}</td>
                          <td className="d2-num">{c.count}</td>
                          <td className={`d2-num is-${toneOf(c.avg)}`}>{pct(c.avg)}</td>
                          <td className="d2-num">{c.breadth.toFixed(0)}%</td>
                          <td className="ef-share">
                            <i style={{ width: `${Math.min(100, c.share)}%` }} />
                            <b className="d2-num">{c.share.toFixed(1)}%</b>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : loading ? (
            <div className="sk-loading">
              <Skel h={40} w="70%" />
              <Skel h={140} />
            </div>
          ) : null}
        </section>

        <section id="ef-list" className="d2-sec" aria-labelledby="ef-list-h">
          <SectionHead
            id="ef-list-h"
            no="01"
            kicker={L("ETF 시세", "Fund quotes")}
            title={region === "KR" ? L("국내 상장 ETF", "Korean-listed ETFs") : L("미국 상장 ETF", "US-listed ETFs")}
            note={L(`${visible.length}개 표시 · 정렬과 카테고리를 바꿔 보세요.`, `${visible.length} shown · change the ordering or category.`)}
          />
          <div className="ef-controls">
            <Marker options={sorts.map((s) => ({ id: s.id, label: L(s.ko, s.en) }))} value={sort} onChange={setSort} label={L("정렬", "Order")} />
            <div className="st-chips" role="group" aria-label={L("카테고리", "Category")}>
              <button type="button" className={!category ? "is-on" : ""} onClick={() => setCategory("")}>
                {L("전체", "All")}
                <small>{items.length}</small>
              </button>
              {categories.map((c) => (
                <button key={c} type="button" className={category === c ? "is-on" : ""} onClick={() => setCategory(c)}>
                  {c}
                  <small>{items.filter((i) => i.category === c).length}</small>
                </button>
              ))}
            </div>
          </div>

          {error && <p className="d2-empty">{error}</p>}
          {loading && items.length === 0 ? (
            <div className="ef-grid">
              {Array.from({ length: 8 }, (_, i) => (
                <Skel key={i} h={260} />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <p className="d2-empty">{L("조건에 맞는 ETF가 없습니다.", "No ETFs match.")}</p>
          ) : view === "card" ? (
            <div className="ef-grid">
              {visible.map((e, i) => {
                const t = toneOf(e.change_pct);
                const p52 = pos52(e);
                const sg = surge(e);
                return (
                  <article key={e.code} className={`ef-card is-${t}`}>
                    <header>
                      <span className="ef-rank">{i + 1}</span>
                      <StockLogo code={e.code} name={e.name} className="ef-logo" assetType="etf" />
                      <span className="ef-id">
                        <Link to={detail(e)}>
                          <h3>{e.name}</h3>
                        </Link>
                        <small>
                          {e.code} · {e.benchmark}
                        </small>
                      </span>
                    </header>
                    <p className="ef-tags">
                      <span>{e.category}</span>
                      {geared(e) && <span className="is-geared">{L("레버리지·인버스", "Leveraged/inverse")}</span>}
                      {e.session !== "regular" && <span className="is-session">{e.session === "pre" ? L("프리마켓", "Pre") : L("애프터마켓", "After")}</span>}
                      {sg != null && sg >= 200 && <span className="is-surge">{L(`거래 ${(sg / 100).toFixed(1)}배`, `${(sg / 100).toFixed(1)}x volume`)}</span>}
                    </p>
                    <div className={`ef-price is-${t}`}>
                      <b>{price(e.close)}</b>
                      <span>
                        {e.change > 0 ? "▲" : e.change < 0 ? "▼" : "–"} {region === "US" ? Math.abs(e.change).toFixed(2) : Math.abs(e.change).toLocaleString()} <em>{pct(e.change_pct)}</em>
                      </span>
                    </div>
                    <Spark points={e.sparkline} tone={t} className="ef-spark" />
                    <dl className="ef-returns">
                      {(["d20", "d60", "d120", "ytd"] as const).map((k) => (
                        <div key={k}>
                          <dt>{k === "ytd" ? "YTD" : `${k.slice(1)}${L("일", "D")}`}</dt>
                          <dd className={`d2-num is-${toneOf(e.returns[k])}`}>{pct(e.returns[k])}</dd>
                        </div>
                      ))}
                    </dl>
                    <dl className="ef-facts">
                      <div>
                        <dt>{L("거래량", "Volume")}</dt>
                        <dd>{shares(e.volume, lang)}</dd>
                      </div>
                      <div>
                        <dt>{L("거래대금", "Turnover")}</dt>
                        <dd>{money(e.turnover)}</dd>
                      </div>
                    </dl>
                    {p52 != null && (
                      <div className="ef-52">
                        <span>
                          {L("52주", "52W")} {e.week52_low != null ? price(e.week52_low) : "—"}
                        </span>
                        <i>
                          <i style={{ left: `${p52}%` }} />
                        </i>
                        <span>{e.week52_high != null ? price(e.week52_high) : "—"}</span>
                      </div>
                    )}
                    <Ticker titles={talkFor(e)} onOpen={(id) => setBoard({ item: e, id })} />
                    <nav className="ef-actions">
                      <Link to={detail(e)}>{L("종목면", "Fund page")} →</Link>
                      <button type="button" onClick={() => setBoard({ item: e, id: null })}>
                        {L("토론방", "Board")}
                      </button>
                      <Link to={explorer(e)}>{L("3D 탐험", "3D explorer")} ✦</Link>
                    </nav>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="d2-table-wrap ef-table">
              <table className="d2-table">
                <thead>
                  <tr>
                    <th className="is-rank">#</th>
                    <th className="is-name">{L("종목", "Fund")}</th>
                    <th>{L("현재가", "Price")}</th>
                    <th>{L("등락", "Change")}</th>
                    <th>20{L("일", "D")}</th>
                    <th>60{L("일", "D")}</th>
                    <th>120{L("일", "D")}</th>
                    <th>{L("거래량", "Volume")}</th>
                    <th>{L("급증", "Surge")}</th>
                    <th>{L("거래대금", "Turnover")}</th>
                    <th>{L("추이", "Trend")}</th>
                    <th>{L("52주", "52W")}</th>
                    <th>{L("토론", "Talk")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((e, i) => {
                    const t = toneOf(e.change_pct);
                    const p52 = pos52(e);
                    const sg = surge(e);
                    const talk = talkFor(e).length;
                    return (
                      <tr key={e.code}>
                        <td className="is-rank">{i + 1}</td>
                        <td className="is-name">
                          <Link to={detail(e)} className="ef-tname">
                            <StockLogo code={e.code} name={e.name} className="d2-table-logo" assetType="etf" />
                            <span>
                              <b>{e.name}</b>
                              <small>
                                {e.code} · {e.category}
                                {geared(e) && ` · ${L("레버리지·인버스", "geared")}`}
                              </small>
                            </span>
                          </Link>
                        </td>
                        <td className="d2-num">{price(e.close)}</td>
                        <td className={`d2-num is-${t}`}>{pct(e.change_pct)}</td>
                        <td className={`d2-num is-${toneOf(e.returns.d20)}`}>{pct(e.returns.d20)}</td>
                        <td className={`d2-num is-${toneOf(e.returns.d60)}`}>{pct(e.returns.d60)}</td>
                        <td className={`d2-num is-${toneOf(e.returns.d120)}`}>{pct(e.returns.d120)}</td>
                        <td className="d2-num">{shares(e.volume, lang)}</td>
                        <td className={`d2-num ${sg != null && sg >= 200 ? "sk-strong" : "sk-muted"}`}>{sg == null ? "—" : `${(sg / 100).toFixed(1)}x`}</td>
                        <td className="d2-num">{money(e.turnover)}</td>
                        <td className="ef-tspark">
                          <Spark points={e.sparkline} tone={t} fill={false} />
                        </td>
                        <td className="ef-t52">
                          {p52 != null && (
                            <i>
                              <i style={{ left: `${p52}%` }} />
                            </i>
                          )}
                        </td>
                        <td>
                          <button type="button" className="ef-tboard" onClick={() => setBoard({ item: e, id: null })}>
                            {L("토론", "Board")}
                            {talk > 0 && <b>{talk}</b>}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="sk-disclaimer">
            {L(
              "시세는 정보 제공처의 지연 및 거래 세션에 따라 실제 체결가와 차이가 날 수 있습니다. 레버리지·인버스 ETF는 일간 수익률을 추종하는 상품으로, 장기 성과가 기초지수의 배수와 다를 수 있습니다.",
              "Quotes may differ from executed prices with provider delays and sessions. Leveraged and inverse ETFs track daily returns; over longer periods their performance can differ from the stated multiple of the index."
            )}
          </p>
        </section>
      </main>

      <Colophon />
      <Finder open={finderOpen} onClose={() => setFinderOpen(false)} />

      {board && (
        <div className="d2-find-scrim ef-board-scrim" onMouseDown={(e) => e.target === e.currentTarget && setBoard(null)}>
          <section className="d2-find ef-board" role="dialog" aria-modal="true" aria-label={`${board.item.name} ${L("토론방", "board")}`}>
            <header className="ef-board-head">
              <StockLogo code={board.item.code} name={board.item.name} className="ef-logo" assetType="etf" />
              <span>
                <small>{board.item.region === "KR" ? L("네이버 종목 토론방", "Naver discussion board") : L("토스증권 커뮤니티", "Toss community")}</small>
                <h2>{board.item.name}</h2>
              </span>
              <button type="button" className="st-sheet-close" onClick={() => setBoard(null)} aria-label={L("닫기", "Close")}>
                ×
              </button>
            </header>
            <div className="ef-board-body">
              <Discussion
                key={`${board.item.code}-${board.id ?? "list"}`}
                code={board.item.code}
                name={board.item.name}
                source={board.item.region === "KR" ? "naver" : "toss-etf"}
                initialId={board.id}
                explorerHref={explorer(board.item)}
              />
              {board.item.region === "KR" && (
                <a className="d2-more ef-naver" href={`https://finance.naver.com/item/board.naver?code=${board.item.code}`} target="_blank" rel="noreferrer">
                  {L("네이버에서 전체 게시판 보기", "Full board on Naver")} ↗
                </a>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
