import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api, type EtfItem } from "../../api/client";
import { useLanguage } from "../../i18n/LanguageContext";
import { Link } from "../../router";
import { startVisibilityAwareInterval } from "../../pollVisibility";
import { useBodyScrollLock } from "../../useBodyScrollLock";
import { useDocumentTitle } from "../../useDocumentTitle";
import StockLogo from "../../components/StockLogo";
import ServiceConnections from "../../markets/ServiceConnections";
import "../../markets/researchServices.css";
import "../../desk2/pages.css";
import { HoloPanel, NeoEmptyState, NeoSkeleton } from "../NeoComponents";
import NeoIcon from "../NeoIcon";
import { SORTS, etfPath, etfUrl, finite, isGeared, popularEtfs, position52, readEtfChoices, selectEtfs, summarizeEtfs, volumeRatio,
  type EtfChoices, type EtfRegion, type EtfScreen, type EtfSort } from "./model";
import "./etfMarket.css";

const Discussion = lazy(() => import("../../desk2/reader/Discussion"));
const sortLabels: Record<EtfSort, [string, string]> = { turnover: ["거래대금", "Turnover"], volume: ["거래량", "Volume"], change: ["등락률", "Change"],
  d20: ["20일 수익률", "20D return"], d60: ["60일 수익률", "60D return"], d120: ["120일 수익률", "120D return"],
  ytd: ["연초 대비", "YTD return"], surge: ["거래량 / 평균", "Relative volume"], pos52: ["52주 위치", "52W position"], name: ["종목명", "Name"] };
const screenLabels: [EtfScreen, string, string][] = [["all", "전체", "All"], ["plain", "레버리지·인버스 제외", "Exclude geared"],
  ["rising", "상승", "Gainers"], ["falling", "하락", "Losers"], ["geared", "레버리지·인버스", "Geared"]];
const tone = (v: number | null | undefined) => finite(v) && v > 0 ? "is-up" : finite(v) && v < 0 ? "is-down" : "is-flat";
const pct = (v: number | null | undefined) => finite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(2)}%` : "—";
const detail = (e: EtfItem) => `/stock/${encodeURIComponent(e.code)}?asset=ETF`;
const explorer = (e: EtfItem) => `/discussion-explorer?code=${encodeURIComponent(e.code)}&name=${encodeURIComponent(e.name)}&market=${e.region}&asset=ETF`;

function Trend({ item }: { item: EtfItem }) {
  const values = item.sparkline;
  const valid = values.filter(finite);
  if (valid.length < 2) return <span className="em-trend-empty">—</span>;
  const low = Math.min(...valid), span = Math.max(...valid) - low;
  const points = values.map((v, i) => finite(v) ? `${i && finite(values[i - 1]) ? "L" : "M"}${i / Math.max(1, values.length - 1) * 120},${span ? 29 - (v - low) / span * 26 : 16}` : "").join(" ");
  return <svg className={`em-trend ${tone(item.change_pct)}`} viewBox="0 0 120 32" preserveAspectRatio="none" role="img" aria-label={`${item.name} ${valid.length}개 가격 표본 추이`}>
    <path className="em-trend-guide" d="M0 30H120" /><path d={points} />
  </svg>;
}

function Dialog({ title, children, close, wide = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const nodes = [...(ref.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select,[tabindex="0"]') ?? [])].filter(el => el.getClientRects().length > 0);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); ref.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("keydown", key, true); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="em-scrim" onClick={e => e.target === e.currentTarget && close()}>
    <section ref={ref} className={`em-dialog${wide ? " em-dialog--wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="em-dialog-title" tabIndex={-1}>
      <header><div><small className="ng-kicker">ETF WORKSPACE</small><h2 id="em-dialog-title">{title}</h2></div><button type="button" onClick={close} aria-label="닫기 / Close"><NeoIcon name="close" /></button></header>
      <div className="em-dialog-body">{children}</div>
    </section>
  </div>, document.body);
}

export default function EtfMarketPage({ region }: { region: EtfRegion }) {
  const { lang } = useLanguage();
  const L = (ko: string, en: string) => lang === "ko" ? ko : en;
  const marketName = region === "KR" ? L("국내 ETF", "Korea ETFs") : L("해외 ETF", "Overseas ETFs");
  useDocumentTitle(`${marketName} 마켓 · 인기 순위·수익률 비교 | K-Stock Hub`);
  const [choices, setChoices] = useState(() => readEtfChoices(window.location.search));
  const [items, setItems] = useState<EtfItem[]>([]);
  const [updated, setUpdated] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [popularity, setPopularity] = useState<"turnover" | "volume">("turnover");
  const [compareOpen, setCompareOpen] = useState(false);
  const [board, setBoard] = useState<EtfItem | null>(null);
  const [message, setMessage] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const patch = (next: Partial<EtfChoices>) => setChoices(current => ({ ...current, ...next }));
  useBodyScrollLock(compareOpen || !!board);

  useEffect(() => {
    let cancelled = false, pending = false;
    const load = async () => {
      if (pending) return;
      pending = true; setRefreshing(true);
      try {
        const response = await api.etfs(region);
        if (!cancelled) { setItems(response.items.filter(e => e.region === region)); setUpdated(response.updated_at); setError(""); }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : L("시세를 불러오지 못했습니다.", "Could not load quotes.")); }
      finally { pending = false; if (!cancelled) { setLoading(false); setRefreshing(false); } }
    };
    void load();
    const stop = startVisibilityAwareInterval(() => void load(), 10_000);
    return () => { cancelled = true; stop(); };
  }, [region, reload]);

  useEffect(() => {
    const url = etfUrl(region, choices);
    if (window.location.pathname + window.location.search === url) return;
    const routeChanged = window.location.pathname !== etfPath(region);
    window.history.replaceState(window.history.state, "", url);
    if (routeChanged) window.dispatchEvent(new PopStateEvent("popstate"));
  }, [region, choices]);
  useEffect(() => {
    const sync = () => { if (window.location.pathname === etfPath(region)) setChoices(readEtfChoices(window.location.search)); };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [region]);

  const visible = useMemo(() => selectEtfs(items, choices), [items, choices]);
  const stats = useMemo(() => summarizeEtfs(items), [items]);
  const popular = useMemo(() => popularEtfs(items, popularity), [items, popularity]);
  const compared = choices.compare.flatMap(code => { const e = items.find(item => item.code === code); return e ? [e] : []; });
  const charted = stats.up + stats.down + stats.flat;
  const price = (v: number | null | undefined) => finite(v) ? new Intl.NumberFormat(lang === "ko" ? "ko-KR" : "en-US", {
    style: "currency", currencyDisplay: "narrowSymbol", currency: region === "KR" ? "KRW" : "USD", maximumFractionDigits: region === "KR" ? 0 : 2, minimumFractionDigits: region === "KR" ? 0 : 2 }).format(v) : "—";
  const compact = (v: number | null | undefined) => finite(v) ? new Intl.NumberFormat(lang === "ko" ? "ko-KR" : "en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v) : "—";
  const amount = (v: number) => finite(v) ? `${region === "KR" ? "₩" : "$"}${new Intl.NumberFormat(region === "US" ? "en-US" : lang === "ko" ? "ko-KR" : "en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v)}` : "—";
  const timestamp = updated && Number.isFinite(Date.parse(updated)) ? new Intl.DateTimeFormat(lang === "ko" ? "ko-KR" : "en-GB", {
    timeZone: region === "KR" ? "Asia/Seoul" : "America/New_York", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(updated)) : "—";
  const selectCompare = (item: EtfItem) => {
    setMessage("");
    setChoices(current => {
      if (current.compare.includes(item.code)) return { ...current, compare: current.compare.filter(code => code !== item.code) };
      if (current.compare.length >= 4) return current;
      return { ...current, compare: [...current.compare, item.code] };
    });
    if (!choices.compare.includes(item.code) && choices.compare.length >= 4) setMessage(L("최대 4개까지 비교할 수 있습니다. 선택한 종목을 해제해 주세요.", "Compare up to four funds. Deselect a fund first."));
  };
  const comparisonInput = (e: EtfItem) => <input type="checkbox" checked={choices.compare.includes(e.code)} onChange={() => selectCompare(e)} aria-label={`${e.name} ${L("비교 선택", "select for comparison")}`} />;
  const setSort = (sort: EtfSort) => patch({ sort, direction: choices.sort === sort ? choices.direction === "desc" ? "asc" : "desc" : sort === "name" ? "asc" : "desc" });
  const sortHead = (sort: EtfSort, short?: string) => <th scope="col" aria-sort={choices.sort === sort ? choices.direction === "desc" ? "descending" : "ascending" : "none"}>
    <button type="button" onClick={() => setSort(sort)}>{short ?? L(...sortLabels[sort])}<span aria-hidden="true">{choices.sort === sort ? choices.direction === "desc" ? "↓" : "↑" : "↕"}</span></button></th>;
  const unavailable = loading || !updated;
  const breadth = [
    { label: L("상승", "Up"), count: stats.up, color: "var(--market-up)" },
    { label: L("보합", "Flat"), count: stats.flat, color: "var(--market-flat)" },
    { label: L("하락", "Down"), count: stats.down, color: "var(--market-down)" },
  ];
  const upShare = charted ? stats.up / charted * 100 : 0;
  const flatEnd = charted ? (stats.up + stats.flat) / charted * 100 : 0;
  const breadthLabel = unavailable ? L("등락 시세 확인 중", "Waiting for price changes") : !charted ? L("등락 분포 데이터 없음", "No price change data")
    : breadth.map(row => `${row.label} ${row.count} (${(row.count / charted * 100).toFixed(1)}%)`).join(", ");
  const filtered = !!(choices.q || choices.category || choices.screen !== "all");
  const resetFilters = () => patch({ q: "", category: "", screen: "all" });
  const session = (e: EtfItem) => e.session === "pre" ? L("프리마켓", "Pre-market") : e.session === "post" ? L("애프터마켓", "After-hours") : "";
  const position = (e: EtfItem) => { const p = position52(e); return p === null ? "—" : <div className="em-position" title={`${price(e.week52_low)} — ${price(e.week52_high)}`}><span><i style={{ left: `${p}%` }} /></span><small>{p.toFixed(0)}%</small></div>; };
  const cards = (mobile = false) => <div className={mobile ? "em-mobile-list" : "em-fund-grid"}>{visible.map((e, i) => <article key={e.code} className="em-fund-card">
    <div className="em-fund-identity"><span className="em-rank">{String(i + 1).padStart(2, "0")}</span><StockLogo code={e.code} name={e.name} assetType="etf" className="em-logo" /><Link to={detail(e)}><strong>{e.name}</strong><small>{e.code} · {e.category}</small></Link>{comparisonInput(e)}</div>
    <div className="em-card-quote"><b>{price(e.close)}</b><span className={tone(e.change_pct)}>{pct(e.change_pct)}</span></div>
    <p className="em-benchmark">{e.benchmark}{isGeared(e) && <em>{L("레버리지·인버스", "Geared")}</em>}{session(e) && <em>{session(e)}</em>}</p>
    <Trend item={e} /><dl className="em-card-data">{(["d20", "d60", "d120", "ytd"] as const).map(k => <div key={k}><dt>{k === "ytd" ? "YTD" : `${k.slice(1)}${L("일", "D")}`}</dt><dd className={tone(e.returns[k])}>{pct(e.returns[k])}</dd></div>)}</dl>
    <div className="em-card-facts"><span>{L("거래대금", "Turnover")} <b>{amount(e.turnover)}</b></span><span>{L("거래량", "Volume")} <b>{compact(e.volume)}</b></span></div>
    <div className="em-card-facts"><span>{L("52주 위치", "52W position")}</span>{position(e)}</div>
    <nav><Link to={detail(e)}>{L("상세·차트", "Details & chart")} ↗</Link><button type="button" onClick={() => setBoard(e)}>{L("토론", "Discuss")}</button><Link to={explorer(e)}>{L("3D 탐험", "3D explorer")}</Link></nav>
  </article>)}</div>;
  const compareMetrics: { name: string; value: (e: EtfItem) => ReactNode }[] = [
    { name: L("추종지수", "Benchmark"), value: e => e.benchmark }, { name: L("현재가", "Price"), value: e => price(e.close) },
    { name: L("일간 등락률", "Daily change"), value: e => <b className={tone(e.change_pct)}>{pct(e.change_pct)}</b> },
    ...(["d20", "d60", "d120", "ytd"] as const).map(k => ({ name: k === "ytd" ? L("연초 대비", "YTD") : `${k.slice(1)}${L("거래일 수익률", "D return")}`, value: (e: EtfItem) => <b className={tone(e.returns[k])}>{pct(e.returns[k])}</b> })),
    { name: L("거래대금", "Turnover"), value: e => amount(e.turnover) }, { name: L("거래량", "Volume"), value: e => compact(e.volume) },
    { name: L("거래량 / 평균", "Relative volume"), value: e => volumeRatio(e) === null ? "—" : `${volumeRatio(e)!.toFixed(2)}×` },
    { name: L("52주 최저 / 최고", "52W low / high"), value: e => `${price(e.week52_low)} / ${price(e.week52_high)}` },
    { name: L("상품 유형", "Fund type"), value: e => isGeared(e) ? L("레버리지·인버스", "Leveraged / inverse") : L("일반", "Ungeared") },
  ];

  return <main className="em-market" lang={lang}>
    <header className="em-heading"><div><span className="ng-kicker">ETF TERMINAL / {region === "KR" ? "KOREA" : "UNITED STATES"}</span><h1>{marketName} <span>{L("마켓", "Market")}</span></h1><p>{region === "KR" ? L("국내 상장 ETF의 거래 흐름과 수익률을 한 화면에서 탐색하세요.", "Explore trading activity and returns of Korea-listed ETFs.") : L("미국 상장 ETF의 거래 흐름과 달러 기준 수익률을 비교하세요.", "Compare US-listed ETF activity and returns in dollars.")}</p></div>
      <nav className="em-market-switch" aria-label={L("ETF 시장 선택", "ETF markets")}><Link to="/etf/kr" aria-current={region === "KR" ? "page" : undefined}><img src="/img/flag/kr.svg" alt="" />{L("국내 ETF", "Korea")}</Link><Link to="/etf/us" aria-current={region === "US" ? "page" : undefined}><img src="/img/flag/us.svg" alt="" />{L("해외 ETF", "Overseas")}</Link></nav>
    </header>
    <div className="em-meta"><span><i className={error ? "em-offline" : ""} />{error ? L("갱신 지연", "Update delayed") : L("10초 자동 갱신", "Updates every 10s")}</span><span>{region === "KR" ? "KRX · KRW" : "US LISTED · USD"}</span><span>{timestamp} {region === "KR" ? "KST" : "ET"} · {L("조회 시각", "Retrieved")}</span><button type="button" onClick={() => setReload(n => n + 1)} disabled={refreshing}><NeoIcon name="orbit" />{refreshing ? L("갱신 중", "Updating") : L("새로고침", "Refresh")}</button></div>
    {error && <div className="em-alert" role="alert"><NeoIcon name="bolt" /><span>{items.length ? L("시세 갱신이 지연되어 마지막 성공 데이터를 표시합니다.", "Showing the last successful quotes while updates are delayed.") : L("시세를 불러오지 못했습니다.", "Could not load quotes.")} <small>{error}</small></span><button type="button" onClick={() => setReload(n => n + 1)}>{L("다시 시도", "Retry")}</button></div>}
    <section className="em-overview" aria-label={L("ETF 시장 요약", "ETF market summary")}>
      <HoloPanel><span>{L("수집 ETF", "Tracked funds")}</span><strong>{unavailable ? "—" : items.length}<small>{L("종목", "funds")}</small></strong><p>{region === "KR" ? L("국내 상장 주요 ETF", "Selected Korea-listed ETFs") : L("미국 상장 주요 ETF", "Selected US-listed ETFs")}</p></HoloPanel>
      <HoloPanel><span>{L("표본 총 거래대금", "Tracked turnover")}</span><strong>{unavailable ? "—" : amount(stats.total)}</strong><p>{L("수집 종목 합계 · 시장 전체 아님", "Tracked funds only, not the entire market")}</p></HoloPanel>
      <HoloPanel className="em-breadth-panel"><span>{L("상승 · 하락 분포", "Price change distribution")}</span>
        <div className="em-breadth-content">
          <div className="em-breadth-donut" role="img" aria-label={breadthLabel} style={{ background: !unavailable && charted
            ? `conic-gradient(var(--market-up) 0% ${upShare}%, var(--market-flat) ${upShare}% ${flatEnd}%, var(--market-down) ${flatEnd}% 100%)`
            : "var(--line-soft)" }}><span aria-hidden="true"><b>{unavailable || !charted ? "—" : charted}</b><small>{L("종목", "funds")}</small></span></div>
          <dl className="em-breadth-legend">{breadth.map(row => <div key={row.label}>
            <dt><i style={{ background: row.color }} />{row.label}</dt><dd><b>{unavailable ? "—" : row.count}</b><small>{!unavailable && charted ? `${(row.count / charted * 100).toFixed(1)}%` : "—"}</small></dd>
          </div>)}</dl>
        </div>
      </HoloPanel>
      <HoloPanel><span>{L("거래 집중 테마", "Leading category")}</span><strong className="em-theme-value">{stats.categories[0]?.name ?? "—"}</strong><p>{stats.categories[0] ? `${L("거래대금 비중", "Turnover share")} ${stats.categories[0].share.toFixed(1)}%` : L("시세 수집 후 표시", "Available with quotes")}</p></HoloPanel>
    </section>
    <section className="em-popular" aria-labelledby="em-popular-title"><div className="em-section-title"><div><span className="ng-kicker">IN THE SPOTLIGHT</span><h2 id="em-popular-title">{L("지금 거래가 몰리는 인기 ETF", "Most actively traded ETFs")} <span>TOP 4</span></h2></div><div className="em-segment" role="group" aria-label={L("인기 순위 기준", "Popularity metric")}>{(["turnover", "volume"] as const).map(metric => <button type="button" key={metric} aria-pressed={popularity === metric} onClick={() => setPopularity(metric)}>{L(...sortLabels[metric])}</button>)}</div></div>
      <p className="em-section-note">{L(`수집 ETF 중 ${popularity === "turnover" ? "거래대금" : "거래량"} 상위 순위 · 검색·필터와 별도로 표시`, `Top tracked funds by ${popularity} · independent of your filters`)}</p>
      {loading ? <NeoSkeleton rows={2} /> : popular.length ? <div className="em-popular-grid">{popular.map((e, i) => <HoloPanel key={e.code} className="em-popular-card">
        <div className="em-popular-top"><span className="em-popular-rank">0{i + 1}<small>{L("인기", "TOP")}</small></span><StockLogo code={e.code} name={e.name} assetType="etf" className="em-logo" /><Link to={detail(e)}><strong>{e.name}</strong><small>{e.code} · {e.category}</small></Link></div>
        <div className="em-popular-price"><b>{price(e.close)}</b><span className={tone(e.change_pct)}>{pct(e.change_pct)}</span></div><Trend item={e} />
        <div className="em-popular-foot"><span>{L(...sortLabels[popularity])}<b>{popularity === "turnover" ? amount(e.turnover) : compact(e.volume)}</b></span>
          <button type="button" onClick={() => selectCompare(e)} aria-label={`${e.name} ${choices.compare.includes(e.code) ? L("비교 해제", "remove from comparison") : L("비교 추가", "add to comparison")}`} aria-pressed={choices.compare.includes(e.code)}>{choices.compare.includes(e.code) ? "✓ " : "+ "}{L("비교", "Compare")}</button>
        </div>{isGeared(e) && <span className="em-geared-label">{L("레버리지·인버스", "Leveraged / inverse")}</span>}
      </HoloPanel>)}</div> : <NeoEmptyState title={L("거래 순위를 표시할 데이터가 없습니다.", "No trading ranking available.")} />}
    </section>
    <div className="em-workspace"><section className="em-screener" aria-labelledby="em-list-title" id="etf-list"><div className="em-section-title"><div><span className="ng-kicker">FUND SCREENER</span><h2 id="em-list-title">{L("ETF 탐색", "Explore ETFs")} <span>{visible.length}<small> / {items.length}</small></span></h2></div><div className="em-segment" role="group" aria-label={L("목록 보기", "List view")}>{(["table", "card"] as const).map(view => <button type="button" key={view} aria-pressed={choices.view === view} onClick={() => patch({ view })}><NeoIcon name={view === "table" ? "menu" : "layers"} />{view === "table" ? L("목록", "List") : L("카드", "Cards")}</button>)}</div></div>
      <div className="em-controls"><div className="em-control-row"><label className="em-search"><NeoIcon name="search" /><input ref={searchRef} type="search" value={choices.q} onChange={e => patch({ q: e.target.value })} onKeyDown={e => { if (e.key === "Escape") patch({ q: "" }); }} placeholder={L("ETF명 · 코드 · 추종지수 검색", "Search fund, ticker or benchmark")} aria-label={L("ETF 검색", "Search ETFs")} />{choices.q && <button type="button" onClick={() => { patch({ q: "" }); searchRef.current?.focus(); }} aria-label={L("검색어 지우기", "Clear search")}><NeoIcon name="close" /></button>}</label>
        <label className="em-sort"><span>{L("정렬", "Sort")}</span><select aria-label={L("정렬 기준", "Sort by")} value={choices.sort} onChange={e => patch({ sort: e.target.value as EtfSort, direction: e.target.value === "name" ? "asc" : "desc" })}>{SORTS.map(sort => <option key={sort} value={sort}>{L(...sortLabels[sort])}</option>)}</select></label><button className="em-direction" type="button" onClick={() => patch({ direction: choices.direction === "desc" ? "asc" : "desc" })} aria-label={choices.direction === "desc" ? L("현재 내림차순, 오름차순으로 변경", "Descending, switch to ascending") : L("현재 오름차순, 내림차순으로 변경", "Ascending, switch to descending")}>{choices.direction === "desc" ? "↓" : "↑"}</button></div>
        <div className="em-filters" role="group" aria-label={L("빠른 필터", "Quick filters")}>{screenLabels.map(([id, ko, en]) => <button type="button" key={id} aria-pressed={choices.screen === id} onClick={() => patch({ screen: id })}>{L(ko, en)}</button>)}<label className="em-category-select"><span className="em-sr-only">{L("카테고리", "Category")}</span><select value={choices.category} onChange={e => patch({ category: e.target.value })}><option value="">{L("전체 테마", "All categories")}</option>{choices.category && !stats.categories.some(c => c.name === choices.category) && <option value={choices.category}>{choices.category}</option>}{stats.categories.map(c => <option key={c.name}>{c.name}</option>)}</select></label></div>
        {filtered && <div className="em-active-filters"><span>{[choices.q && `“${choices.q}”`, choices.category, choices.screen !== "all" && L(...screenLabels.find(([id]) => id === choices.screen)!.slice(1) as [string, string])].filter(Boolean).join(" · ")}</span><button type="button" onClick={resetFilters}>{L("필터 초기화", "Reset filters")} ×</button></div>}
      </div>
      <div className="em-list-status" role="status" aria-live="polite">{L(`${visible.length}개 종목`, `${visible.length} funds`)}<span>{L("체크박스로 최대 4개 비교 · 수익률은 거래일 기준", "Select up to 4 to compare · returns use trading days")}</span></div>
      {loading ? <NeoSkeleton rows={8} /> : !items.length ? <NeoEmptyState title={error ? L("시세 연결을 확인해 주세요.", "Check the quote connection.") : L("현재 제공되는 ETF 시세가 없습니다.", "No ETF quotes are available.")}><button type="button" onClick={() => setReload(n => n + 1)}>{L("다시 불러오기", "Reload")}</button></NeoEmptyState> : !visible.length ? <NeoEmptyState title={L("조건에 맞는 ETF가 없습니다.", "No funds match your filters.")}><button type="button" onClick={resetFilters}>{L("필터 초기화", "Reset filters")}</button></NeoEmptyState> : choices.view === "card" ? cards() : <>
        <p className="em-scroll-hint">↔ {L("표를 좌우로 스크롤하면 모든 지표를 볼 수 있습니다. 종목명은 고정됩니다.", "Scroll sideways for all metrics. Fund names stay visible.")}</p>
        <div className="em-table-scroll" role="region" aria-label={L("ETF 시세표, 좌우 스크롤 가능", "ETF quotes, horizontally scrollable")} tabIndex={0}><table className="em-table"><caption className="em-sr-only">{marketName} · {region === "KR" ? "KRW" : "USD"} · {L("수익률 및 거래 순위", "Returns and trading rankings")}</caption><thead><tr><th scope="col" className="em-check-col">{L("비교", "Pick")}</th><th scope="col" className="em-name-col" aria-sort={choices.sort === "name" ? choices.direction === "asc" ? "ascending" : "descending" : "none"}><button type="button" onClick={() => setSort("name")}>{L("종목 / 추종지수", "Fund / benchmark")} ↕</button></th><th scope="col">{L("현재가", "Price")}</th>{sortHead("change")}{sortHead("turnover")}{sortHead("d20", L("20일", "20D"))}{sortHead("d60", L("60일", "60D"))}{sortHead("d120", L("120일", "120D"))}{sortHead("ytd", "YTD")}{sortHead("volume")}{sortHead("surge", L("거래배수", "Rel vol"))}<th scope="col">{L("가격 추이", "Trend")}</th>{sortHead("pos52", L("52주 위치", "52W"))}<th scope="col">{L("바로가기", "Explore")}</th></tr></thead>
          <tbody>{visible.map((e, i) => <tr key={e.code} data-selected={choices.compare.includes(e.code)}><td className="em-check-col">{comparisonInput(e)}</td><th scope="row" className="em-name-col"><div className="em-table-identity"><span className="em-rank">{i + 1}</span><StockLogo code={e.code} name={e.name} assetType="etf" className="em-logo" /><Link to={detail(e)}><strong>{e.name}</strong><small>{e.code} · {e.benchmark}</small></Link></div><div className="em-table-tags"><span>{e.category}</span>{isGeared(e) && <em>{L("레버리지·인버스", "Geared")}</em>}{session(e) && <em>{session(e)}</em>}</div></th><td className="em-price-cell">{price(e.close)}</td><td className={tone(e.change_pct)}>{pct(e.change_pct)}</td><td>{amount(e.turnover)}</td>{(["d20", "d60", "d120", "ytd"] as const).map(k => <td key={k} className={tone(e.returns[k])}>{pct(e.returns[k])}</td>)}<td>{compact(e.volume)}</td><td>{volumeRatio(e) === null ? "—" : `${volumeRatio(e)!.toFixed(1)}×`}</td><td className="em-trend-cell"><Trend item={e} /></td><td>{position(e)}</td><td><div className="em-row-actions"><Link to={detail(e)} aria-label={`${e.name} ${L("상세·차트", "details and chart")}`}><NeoIcon name="chart" /></Link><button type="button" onClick={() => setBoard(e)} aria-label={`${e.name} ${L("토론", "discuss")}`}><NeoIcon name="news" /></button><Link to={explorer(e)} aria-label={`${e.name} 3D ${L("탐험", "explorer")}`}><NeoIcon name="orbit" /></Link></div></td></tr>)}</tbody></table></div>{cards(true)}</>}
    </section>
    <aside className="em-insights" aria-label={L("ETF 시장 인사이트", "ETF market insights")}><HoloPanel className="em-category-panel"><div className="em-panel-title"><NeoIcon name="layers" /><h2>{L("테마별 거래 흐름", "Category activity")}</h2></div><p>{L("선택하면 해당 테마만 표시합니다.", "Select a category to filter the list.")}</p><button className="em-category-all" type="button" onClick={() => patch({ category: "" })} aria-pressed={!choices.category}>{L("전체 테마", "All categories")}<span>{items.length}</span></button>{stats.categories.map(c => <button type="button" key={c.name} className="em-category" aria-pressed={choices.category === c.name} onClick={() => patch({ category: choices.category === c.name ? "" : c.name })}><span><b>{c.name}</b><small>{c.count}{L("종목", " funds")}</small><strong className={tone(c.average)}>{pct(c.average)}</strong></span><span className="em-category-bar"><i style={{ width: `${c.share}%` }} /></span><span className="em-category-foot"><small>{amount(c.turnover)}</small><small>{c.share.toFixed(1)}%</small></span></button>)}<p className="em-muted">{L("평균 등락은 종목별 등락률 단순 평균입니다.", "Average changes are equally weighted.")}</p></HoloPanel>
      <HoloPanel className="em-guide-panel"><span className="ng-kicker">READ THE NUMBERS</span><h2>{L("비교할 때 확인하세요", "Know your metrics")}</h2><dl><div><dt>{L("20·60·120일", "20 / 60 / 120D")}</dt><dd>{L("거래일 기준 가격 수익률. 분배금 재투자 총수익률과 다를 수 있습니다.", "Trading-day price returns may differ from total returns with distributions reinvested.")}</dd></div><div><dt>{L("거래배수", "Relative volume")}</dt><dd>{L("당일 거래량 ÷ 제공처 평균 거래량. 장중에는 하루 전체 평균과 비교됩니다.", "Current volume / provider average volume. Intraday volume is compared with a full-day average.")}</dd></div><div><dt>{L("52주 위치", "52W position")}</dt><dd>{L("최근 52주 최저가를 0%, 최고가를 100%로 표시합니다.", "0% is the 52-week low; 100% is the high.")}</dd></div></dl><Link to="/guides/etf-comparison">{L("ETF 비교 가이드", "ETF comparison guide")} <NeoIcon name="arrow" /></Link></HoloPanel>
    </aside></div>
    <footer className="em-footnote"><p>{region === "KR" ? L("시세: 네이버 금융 · 통화: 원(KRW)", "Quotes: Naver Finance · Currency: KRW") : L("시세: Yahoo Finance · 미국 상장 ETF · 통화: 달러(USD)", "Quotes: Yahoo Finance · US-listed ETFs · Currency: USD")} · {L("거래대금은 제공값 또는 현재가 × 거래량의 추정값입니다.", "Turnover is provider-reported or estimated as price × volume.")}</p><p>{L("수집 목록은 시장 전체를 포함하지 않습니다. 시세는 지연될 수 있으며 ‘—’는 미제공 항목입니다. 인기 순위는 거래 지표이며 추천이나 투자 성과를 의미하지 않습니다. 레버리지·인버스 상품의 장기 성과는 기초지수의 배수와 다를 수 있습니다.", "Coverage is a selected roster. Quotes may be delayed; — means unavailable. Activity rankings are not recommendations or investment performance. Leveraged and inverse fund returns can diverge from the index multiple over time.")}</p></footer>
    {region === "US" && <p className="em-footnote">{L("미국 ETF는 제공처의 최근 정규장 거래량을 우선 사용합니다. 프리·애프터마켓 가격과 거래량의 기준 시점은 다를 수 있습니다.", "US ETFs prioritize the provider's latest regular-session volume. Extended-hours prices and trading volume can refer to different sessions.")}</p>}
    <ServiceConnections compact path={etfPath(region)} region={region} />
    {choices.compare.length > 0 && <div className="em-compare-tray"><div><span className="em-compare-count">{choices.compare.length}<small>/4</small></span><div className="em-selected-funds">{choices.compare.map(code => <button type="button" key={code} onClick={() => patch({ compare: choices.compare.filter(c => c !== code) })} aria-label={`${code} ${L("비교 해제", "remove from comparison")}`}>{items.find(e => e.code === code)?.name ?? code}<span>×</span></button>)}</div></div><div><button type="button" className="em-clear-compare" onClick={() => { patch({ compare: [] }); setMessage(""); }}>{L("비우기", "Clear")}</button><button type="button" className="em-primary" disabled={compared.length < 2} onClick={() => setCompareOpen(true)}>{L("선택 ETF 비교", "Compare selected")} <NeoIcon name="arrow" /></button></div></div>}
    {message && <div className="em-toast" role="status">{message}<button type="button" onClick={() => setMessage("")} aria-label={L("닫기", "Close")}>×</button></div>}
    {compareOpen && <Dialog wide title={L(`${compared.length}개 ETF 한눈에 비교`, `Compare ${compared.length} ETFs`)} close={() => setCompareOpen(false)}><p className="em-dialog-note">{region === "KR" ? "KRW" : "USD"} · {L("수집된 동일 시장 ETF 비교 · 미제공 값은 —", "Same-market comparison · unavailable values shown as —")}</p><div className="em-compare-scroll" tabIndex={0} role="region" aria-label={L("ETF 비교표", "ETF comparison table")}><table className="em-compare-table"><thead><tr><th scope="col">{L("비교 항목", "Metric")}</th>{compared.map(e => <th key={e.code} scope="col"><StockLogo code={e.code} name={e.name} assetType="etf" className="em-logo" /><Link to={detail(e)}>{e.name}<small>{e.code} ↗</small></Link></th>)}</tr></thead><tbody>{compareMetrics.map(metric => <tr key={metric.name}><th scope="row">{metric.name}</th>{compared.map(e => <td key={e.code}>{metric.value(e)}</td>)}</tr>)}</tbody></table></div><p className="em-dialog-note">{L("분배금·총보수·추적오차는 현재 데이터에 포함되지 않습니다. 거래 지표와 가격 수익률만으로 상품의 적합성을 판단하지 마세요.", "Distributions, fees and tracking error are not included in this feed. Activity and price returns alone do not determine suitability.")}</p></Dialog>}
    {board && <Dialog title={`${board.name} · ${L("토론", "Discussion")}`} close={() => setBoard(null)}><div className="d2"><Suspense fallback={<NeoSkeleton rows={4} />}><Discussion code={board.code} name={board.name} source={region === "KR" ? "naver" : "toss-etf"} explorerHref={explorer(board)} /></Suspense></div></Dialog>}
  </main>;
}
