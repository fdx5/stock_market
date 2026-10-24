import { ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "../router";
import { pct } from "../desk2/lib";
import { compareIds, discoveryRows, DiscoveryFilters, DiscoveryMarket, DiscoveryPreset, DiscoveryRow, DiscoverySort, MARKET_NAMES, MARKETS, readFilters, rowsCsv, screenRows, sectorStrength } from "./discoveryModel";
import { useDiscoveryData } from "./useDiscoveryData";
import { MarketInside, RecoveryLab, TradeoffLab } from "./DecisionTools";
import ServiceCatalogGrid from "./ServiceCatalogGrid";
import ServiceConnections from "./ServiceConnections";
import NewBadge from "./ResearchNewBadge";
import SymbolPicker, { boardSymbols, symbolMarket } from "./SymbolPicker";
import "./marketDiscovery.css";
import "./researchServices.css";
import "./neoResearch.css";

export type DiscoveryPage = "hub" | "inside" | "tradeoffs" | "recovery" | "radar" | "screener" | "compare" | "sectors";
const PAGES: { id: DiscoveryPage; path: string; title: string; subtitle: string; action: string; no: string }[] = [
  { id: "hub", path: "/markets", title: "시장 탐색", subtitle: "오늘의 움직임에서 나의 다음 질문까지.", action: "시장을 한눈에", no: "00" },
  { id: "inside", path: "/market-inside", title: "시장 속사정", subtitle: "평균은 올랐는데, 왜 내 종목은 다를까요?", action: "대형주 3개를 빼고 시장 읽기", no: "01" },
  { id: "tradeoffs", path: "/stock-tradeoffs", title: "종목 선택의 대가", subtitle: "후보를 바꿀 때 달라지는 조건을, 숨김없이.", action: "같은 업종, 다른 선택의 대가", no: "02" },
  { id: "recovery", path: "/recovery-lab", title: "회복 거리 실험실", subtitle: "손실률과 원금 회복률의 차이를 직접 실험하세요.", action: "손실 뒤 회복에 필요한 상승률", no: "03" },
  { id: "radar", path: "/market-radar", title: "주도주 레이더", subtitle: "오늘 누가 움직였는지, 숫자로 먼저 확인하세요.", action: "움직이는 종목 찾기", no: "01" },
  { id: "screener", path: "/stock-screener", title: "종목 스크리너", subtitle: "조건은 간단하게. 후보는 선명하게.", action: "내 조건으로 좁히기", no: "02" },
  { id: "compare", path: "/stock-compare", title: "종목 비교", subtitle: "네 종목까지 나란히 놓고 같은 기준으로 읽으세요.", action: "후보를 나란히 비교", no: "03" },
  { id: "sectors", path: "/sector-strength", title: "업종 강도판", subtitle: "한 종목의 상승인지, 업종 전체의 흐름인지.", action: "강한 업종 확인하기", no: "04" },
];
const PRESET_NAMES: Record<DiscoveryPreset, string> = { all: "전체", gainers: "상승", losers: "하락", liquid: "거래 집중", "near-high": "52주 고점 근접", value: "PER 15 이하" };
const SORT_NAMES: Record<DiscoverySort, string> = { change: "등락률 높은 순", "change-asc": "등락률 낮은 순", amount: "거래규모 근사치 순", cap: "시가총액 순", m1: "1개월 등락률 순", m3: "3개월 등락률 순", per: "PER 낮은 순", high: "52주 고점 가까운 순" };
const tone = (v: number | null) => v === null || v === 0 ? "flat" : v > 0 ? "up" : "down";
const price = (v: number | null, currency: "KRW" | "USD") => v === null ? "—" : `${v.toLocaleString("ko-KR", { maximumFractionDigits: currency === "USD" ? 2 : 0 })} ${currency === "USD" ? "USD" : "원"}`;
const amount = (v: number | null, currency: "KRW" | "USD") => {
  if (v === null) return "—";
  const unit = currency === "USD" ? "USD" : "원";
  return v >= 1e12 ? `${(v / 1e12).toFixed(2)}조 ${unit}` : v >= 1e8 ? `${(v / 1e8).toFixed(1)}억 ${unit}` : `${v.toLocaleString("ko-KR", { maximumFractionDigits: 0 })} ${unit}`;
};
const figure = (v: number | null, digits = 1) => v === null ? "—" : v.toLocaleString("ko-KR", { maximumFractionDigits: digits });
function Change({ value }: { value: number | null }) { return <span className={`mdis-change is-${tone(value)}`}>{pct(value)}</span>; }

function useQuery() {
  const [params, setParams] = useState(() => new URLSearchParams(window.location.search));
  useEffect(() => {
    const sync = () => setParams(new URLSearchParams(window.location.search));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) if (value === null || (value === "" && key !== "codes")) next.delete(key); else next.set(key, value);
    const query = next.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    window.dispatchEvent(new Event("research:context"));
    setParams(next);
  };
  return [params, update] as const;
}

function Share() {
  const [message, setMessage] = useState("");
  const [fallback, setFallback] = useState("");
  const copy = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setMessage("현재 조건이 담긴 링크를 복사했습니다."); setFallback(""); }
    catch { setFallback(window.location.href); setMessage("아래 링크를 선택해 복사하세요."); }
  };
  return <div className="mdis-share"><button type="button" data-research-action="copy_link" onClick={() => void copy()}>링크 복사</button><span role="status">{message}</span>{fallback && <input aria-label="공유 링크" value={fallback} readOnly onFocus={e => e.target.select()} />}</div>;
}

function MarketSelect({ market, onChange }: { market: DiscoveryMarket; onChange: (market: DiscoveryMarket) => void }) {
  return <div className="mdis-markets" role="group" aria-label="시장 선택">{MARKETS.map(m => <button type="button" key={m} aria-pressed={m === market} onClick={() => onChange(m)}>{MARKET_NAMES[m]}</button>)}</div>;
}

function StockTable({ rows, selected, onSelect }: { rows: DiscoveryRow[]; selected: string[]; onSelect: (id: string) => void }) {
  const [limit, setLimit] = useState(30);
  useEffect(() => setLimit(30), [rows]);
  return <>
    <div className="mdis-table-scroll" tabIndex={0} role="region" aria-label="종목 목록, 가로로 스크롤 가능"><table className="mdis-table">
      <caption>조건에 맞는 {rows.length}종목 · 빈 값은 미제공</caption>
      <thead><tr><th scope="col">비교</th><th scope="col">종목</th><th scope="col">현재가</th><th scope="col">오늘</th><th scope="col">거래규모 근사치</th><th scope="col">시가총액</th><th scope="col">PER</th><th scope="col">1개월</th><th scope="col">고점 대비</th></tr></thead>
      <tbody>{rows.slice(0, limit).map(row => <tr key={row.id}>
        <td><input type="checkbox" checked={selected.includes(row.id)} disabled={selected.length >= 4 && !selected.includes(row.id)} onChange={() => onSelect(row.id)} aria-label={`${row.name} 비교 선택`} /></td>
        <th scope="row"><Link to={`/stock/${encodeURIComponent(row.code)}`}>{row.name}</Link><small>{row.code} · {row.sector}</small></th>
        <td>{price(row.close, row.currency)}</td><td><Change value={row.change} /></td><td>{amount(row.amount, row.currency)}</td><td>{amount(row.cap, row.currency)}</td><td>{figure(row.per)}</td><td><Change value={row.m1} /></td><td><Change value={row.highGap} /></td>
      </tr>)}</tbody>
    </table></div>
    {!rows.length && <p className="mdis-empty" role="status">조건에 맞는 종목이 없습니다. 검색어 또는 필터를 줄여 보세요.</p>}
    {rows.length > limit && <button type="button" className="mdis-more" onClick={() => setLimit(n => n + 30)}>30개 더 보기 ({Math.min(limit, rows.length)}/{rows.length})</button>}
  </>;
}

function Download({ rows }: { rows: DiscoveryRow[] }) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([rowsCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "kstock-screen.csv"; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <button type="button" data-research-action="export_csv" onClick={download} disabled={!rows.length}>결과 CSV</button>;
}

function Hub({ rows, ready }: { rows: DiscoveryRow[]; ready: boolean }) {
  return <>
    <section className="mdis-overview" aria-label="시장별 표본 현황">{MARKETS.map(market => {
      const items = rows.filter(r => r.market === market), known = items.filter(r => r.change !== null);
      const up = known.filter(r => r.change! > 0).length, down = known.filter(r => r.change! < 0).length;
      const average = known.length ? known.reduce((sum, r) => sum + r.change!, 0) / known.length : null;
      return <Link to={`/market-radar?market=${market}`} key={market} className="mdis-market-card"><span>{MARKET_NAMES[market]}</span><strong><Change value={average} /></strong><small>표본 단순평균 · {known.length}종목</small><div className="mdis-breadth" aria-label={`상승 ${up}, 하락 ${down}, 보합 ${known.length - up - down}`}><i className="is-up" style={{ width: `${known.length ? up / known.length * 100 : 0}%` }} /><i className="is-down" style={{ width: `${known.length ? down / known.length * 100 : 0}%` }} /></div><p>상승 {up} <span>보합 {known.length - up - down}</span> 하락 {down}</p></Link>;
    })}</section>
    {!ready && <p role="status">시장 집계를 불러오는 중입니다…</p>}
    <section className="mdis-workflows" aria-labelledby="mdis-workflows"><div className="mdis-section-title"><span>YOUR NEXT QUESTION</span><h2 id="mdis-workflows">남들과 다른 질문부터 시작하세요.</h2></div><div className="mdis-workflow-grid">{PAGES.filter(p => ["inside", "tradeoffs", "recovery"].includes(p.id)).map(page => <Link className="mdis-workflow" to={page.path} key={page.id}><span>{page.no} / {page.title}</span><h3>{page.action} <b aria-hidden="true">↗</b></h3><p>{page.subtitle}</p><small>{page.id === "inside" ? "평균의 착시 · 상승 확산 · 상위 3종목 제외 실험" : page.id === "tradeoffs" ? "같은 업종 · 기준 종목 대비 차이 · 비교 불가 이유" : "손실·회복 비대칭 · 목표 가격 거리 · 비저장 실험"}</small></Link>)}</div></section>
    <section className="mdis-existing" aria-label="분석 기반 도구"><h2>분석 기반 도구</h2><div>{PAGES.filter(p => ["radar", "screener", "compare", "sectors"].includes(p.id)).map(p => <Link key={p.id} to={p.path}>{p.title} ↗</Link>)}</div></section>
    <section className="mdis-existing" aria-labelledby="mdis-existing"><h2 id="mdis-existing">더 넓게 읽기</h2><div><Link to="/etf">ETF 탐색 ↗</Link><Link to="/global">해외 증시 ↗</Link><Link to="/market-brief">오늘 브리핑 ↗</Link><Link to="/map">시장 지도 ↗</Link><Link to="/stocks">전체 종목정보 ↗</Link></div></section>
  </>;
}

function Compare({ rows, ids, onSelect, query, onQuery }: { rows: DiscoveryRow[]; ids: string[]; onSelect: (id: string) => void; query: string; onQuery: (q: string) => void }) {
  const [draftQuery, setDraftQuery] = useState(query);
  useEffect(() => setDraftQuery(query), [query]);
  const chosen = ids.map(id => rows.find(row => row.id === id)).filter((r): r is DiscoveryRow => !!r);
  const searchOptions = useMemo(() => boardSymbols(rows.filter(row => !ids.includes(row.id))), [rows, ids]);
  const candidates = rows.filter(row => `${row.name} ${row.code}`.toLowerCase().includes(draftQuery.toLowerCase().trim())).slice(0, draftQuery ? 20 : 8);
  const metrics: { name: string; render: (row: DiscoveryRow) => ReactNode }[] = [
    { name: "시장 / 통화", render: r => `${MARKET_NAMES[r.market]} / ${r.currency}` },
    { name: "업종", render: r => r.sector }, { name: "현재가", render: r => price(r.close, r.currency) },
    { name: "오늘 등락률", render: r => <Change value={r.change} /> },
    { name: "1주 등락률", render: r => <Change value={r.w1} /> }, { name: "1개월 등락률", render: r => <Change value={r.m1} /> },
    { name: "3개월 등락률", render: r => <Change value={r.m3} /> }, { name: "연초 이후", render: r => <Change value={r.ytd} /> },
    { name: "시가총액", render: r => amount(r.cap, r.currency) }, { name: "PER (배)", render: r => figure(r.per) },
    { name: "ROE (%)", render: r => figure(r.roe) }, { name: "52주 고가", render: r => price(r.high, r.currency) },
    { name: "52주 저가", render: r => price(r.low, r.currency) }, { name: "고점 대비", render: r => <Change value={r.highGap} /> },
  ];
  return <>
    <section className="mdis-picker" aria-label="비교할 종목 찾기"><SymbolPicker label="비교할 종목 검색" value={draftQuery} onChange={setDraftQuery} options={searchOptions} disabled={ids.length >= 4} hint={ids.length >= 4 ? "최대 4종목입니다. 선택한 종목을 해제하면 추가할 수 있습니다." : "시장별 TOP 100 표본에서 종목명·코드로 찾아 추가하세요."} onSelect={item => { const row = rows.find(row => row.code === item.code && row.market === symbolMarket(item)); if (row && !ids.includes(row.id) && ids.length < 4) onSelect(row.id); setDraftQuery(""); onQuery(""); }} /><span>{ids.length}/4 선택 · 같은 종목은 한 번만 추가됩니다.</span><div className="mdis-candidates">{candidates.map(r => <button type="button" key={r.id} aria-pressed={ids.includes(r.id)} disabled={ids.length >= 4 && !ids.includes(r.id)} onClick={() => onSelect(r.id)}>{r.name} <small>{r.code} · {r.market.toUpperCase()}</small> {ids.includes(r.id) ? "−" : "+"}</button>)}</div>{!candidates.length && <p role="status">현재 TOP 100 표본에서 종목을 찾지 못했습니다.</p>}</section>
    {ids.filter(id => !chosen.some(r => r.id === id)).length > 0 && <p className="mdis-notice" role="status">아직 불러오지 못했거나 현재 표본에 없는 선택: {ids.filter(id => !chosen.some(r => r.id === id)).map(id => <button type="button" key={id} onClick={() => onSelect(id)}>{id} 선택 해제</button>)}</p>}
    {chosen.length ? <div className="mdis-table-scroll" tabIndex={0} role="region" aria-label="종목 비교표, 가로로 스크롤 가능"><table className="mdis-table mdis-compare"><caption>통화와 시장별 집계시각을 함께 확인하세요. 기간 등락률은 배당을 포함한 총수익률과 다릅니다.</caption><thead><tr><th scope="col">비교 항목</th>{chosen.map(r => <th scope="col" key={r.id}><Link to={`/stock/${r.code}`}>{r.name}</Link><small>{r.code}</small><button type="button" aria-label={`${r.name} 비교 해제`} onClick={() => onSelect(r.id)}>선택 해제</button></th>)}</tr></thead><tbody>{metrics.map(metric => <tr key={metric.name}><th scope="row">{metric.name}</th>{chosen.map(r => <td key={r.id}>{metric.render(r)}</td>)}</tr>)}</tbody></table></div> : <p className="mdis-empty">종목을 선택하면 비교표가 표시됩니다.</p>}
  </>;
}

function Sectors({ rows, market }: { rows: DiscoveryRow[]; market: DiscoveryMarket }) {
  const sectors = sectorStrength(rows, market), currency = market === "nasdaq" ? "USD" : "KRW";
  return <><p className="mdis-method">각 업종의 현재 표본에 포함된 종목을 시가총액으로 가중했습니다. 업종지수의 실제 수익률이나 과거 순환매 순위를 뜻하지 않습니다.</p><div className="mdis-sector-grid">{sectors.map((s, i) => <article key={s.sector} className="mdis-sector-card"><div className="mdis-sector-top"><span>{String(i + 1).padStart(2, "0")}</span><h2><Link to={`/stock-screener?market=${market}&sector=${encodeURIComponent(s.sector)}`}>{s.sector}</Link></h2><Change value={s.move} /></div><p>표본 {s.count}종목 · 가중 계산 {s.weightedCount}종목</p><div className="mdis-breadth" aria-label={`상승 ${s.up}, 보합 ${s.flat}, 하락 ${s.down}, 미제공 ${s.count - s.known}`}><i className="is-up" style={{ width: `${s.count ? s.up / s.count * 100 : 0}%` }} /><i className="is-down" style={{ width: `${s.count ? s.down / s.count * 100 : 0}%` }} /></div><p>상승 {s.up} · 보합 {s.flat} · 하락 {s.down} · 미제공 {s.count - s.known}</p><dl><div><dt>거래규모 근사 합계</dt><dd>{amount(s.amount, currency)}</dd></div><div><dt>등락률 선두</dt><dd>{s.leader ? <><Link to={`/stock/${s.leader.code}`}>{s.leader.name}</Link> <Change value={s.leader.change} /></> : "—"}</dd></div></dl><Link className="mdis-text-link" to={`/stock-screener?market=${market}&sector=${encodeURIComponent(s.sector)}`}>업종 내 후보 찾기 ↗</Link></article>)}</div>{!sectors.length && <p className="mdis-empty">표시할 업종 집계가 없습니다.</p>}</>;
}

export default function MarketDiscoveryPage({ mode }: { mode: DiscoveryPage }) {
  const [params, update] = useQuery();
  const filters = readFilters(params), selected = params.has("codes") || mode === "compare" ? compareIds(params) : [];
  const data = useDiscoveryData();
  const rows = useMemo(() => discoveryRows(data.boards), [data.boards]);
  const filtered = useMemo(() => screenRows(rows, filters), [rows, params.toString()]);
  const current = PAGES.find(page => page.id === mode)!;
  const sectors = [...new Set(rows.filter(r => r.market === filters.market).map(r => r.sector))].sort((a, b) => a.localeCompare(b, "ko-KR"));
  const select = (id: string) => update({ codes: (selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id].slice(0, 4)).join(",") });
  const setPreset = (preset: DiscoveryPreset) => update({ preset, sort: preset === "losers" ? "change-asc" : preset === "liquid" ? "amount" : preset === "near-high" ? "high" : preset === "value" ? "per" : "change" });
  const activeBoard = data.boards[filters.market];
  const hasData = Object.keys(data.boards).length > 0;
  return <div className="mdis ng-research" lang="ko">
    <a className="d2-skip" href="#mdis-main">본문 바로가기</a>

    <nav className="mdis-nav" aria-label="시장 탐색 메뉴">{PAGES.map(page => <Link key={page.id} to={page.path} aria-current={mode === page.id ? "page" : undefined}>{page.title} <NewBadge /></Link>)}</nav>
    <main id="mdis-main" className="mdis-main">
      <section className="mdis-hero"><div><p className="mdis-kicker">MARKET DISCOVERY / {current.no}</p><h1>{current.title}<span aria-hidden="true">.</span></h1><p>{current.subtitle}</p><small>가입 없이 탐색 · 조건을 링크로 공유</small></div><div className="mdis-hero-aside"><span>FROM SIGNAL TO CONTEXT</span><p>움직임을 찾고<br />맥락을 비교하다.</p><Share /></div></section>
      <section className="mdis-data-status" aria-label="데이터 상태"><div><b>분석 범위</b><span>시장별 현재 TOP 100 표본 · 전체 상장 종목 순위와 다릅니다.</span></div><button type="button" disabled={data.loading} onClick={() => void data.refresh()}>{data.loading ? "집계 불러오는 중…" : "집계 새로고침"}</button><ul>{MARKETS.map(m => {
        const board = data.boards[m], date = board?.generated_at ? new Date(board.generated_at) : null;
        const time = date && Number.isFinite(date.getTime()) ? date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "미수신";
        return <li key={m} className={data.errors[m] ? "mdis-status-error" : ""}>{MARKET_NAMES[m]} · {board?.items.length ?? 0}종목 · 집계 {time} KST{m === "nasdaq" && board ? ` · ${board.session === "pre" ? "장전" : board.session === "post" ? "장후" : "정규장 기준"}` : ""}{data.errors[m] ? ` · ${board ? "갱신 실패, 이전 집계 표시" : "불러오기 실패"}` : ""}</li>;
      })}</ul><small>집계시각은 체결시각이 아닙니다. 원천 시세 지연과 거래시간 차이가 있을 수 있습니다.</small></section>
      {Object.keys(data.errors).length > 0 && <p className="mdis-notice" role="status">일부 시장 집계를 불러오지 못했습니다. 집계 새로고침으로 다시 시도할 수 있습니다.</p>}
      {mode === "hub" ? <Hub rows={rows} ready={hasData || !data.loading} /> : <>
        {mode !== "compare" && <MarketSelect market={filters.market} onChange={market => update({ market, sector: null })} />}
        {mode === "inside" ? <MarketInside rows={rows} market={filters.market} /> : mode === "tradeoffs" ? <TradeoffLab rows={rows} market={filters.market} baseId={params.get("base")} onBase={base => update({ base })} /> : mode === "recovery" ? <RecoveryLab key={filters.market} rows={rows} market={filters.market} /> : mode === "compare" ? <Compare rows={rows} ids={selected} onSelect={select} query={filters.q} onQuery={q => update({ q })} /> : mode === "sectors" ? <Sectors rows={rows} market={filters.market} /> : <>
          <div className="mdis-presets" role="group" aria-label="빠른 조건">{Object.entries(PRESET_NAMES).map(([id, label]) => <button type="button" key={id} aria-pressed={filters.preset === id} onClick={() => setPreset(id as DiscoveryPreset)}>{label}</button>)}</div>
          <section className="mdis-filters" aria-label="종목 필터"><label>종목명 · 코드<input type="search" value={filters.q} placeholder="예: 삼성전자, NVDA" onChange={e => update({ q: e.target.value })} /></label><label>업종<select value={filters.sector} onChange={e => update({ sector: e.target.value })}><option value="">전체 업종</option>{filters.sector && !sectors.includes(filters.sector) && <option value={filters.sector}>{filters.sector} (표본 없음)</option>}{sectors.map(s => <option key={s}>{s}</option>)}</select></label>
            {mode === "screener" && <><label>최소 등락률 (%)<input type="number" min={-100} max={1000} step="any" placeholder="제한 없음" value={params.get("min") ?? ""} onChange={e => update({ min: e.target.value })} /></label><label>최대 PER (배)<input type="number" min="0.01" max={10000} step="any" placeholder="제한 없음" value={params.get("per") ?? ""} onChange={e => update({ per: e.target.value })} /></label></>}
            <label>정렬<select value={filters.sort} onChange={e => update({ sort: e.target.value })}>{Object.entries(SORT_NAMES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><button type="button" onClick={() => update({ q: null, sector: null, min: null, per: null, preset: null, sort: null })}>조건 초기화</button>
          </section>
          <div className="mdis-results-head"><p><b>{filtered.length}</b>종목 <span>/ 현재 표본 {activeBoard?.items.length ?? 0}종목</span></p><Download rows={filtered} /></div>
          <p className="mdis-method">{filters.preset === "near-high" ? "현재가가 52주 고가보다 0~5% 낮은 종목입니다. 고가 데이터가 없는 종목은 제외합니다. " : filters.preset === "value" ? "0 < PER ≤ 15인 종목입니다. 저평가 여부를 보장하는 기준은 아닙니다. " : ""}거래규모는 현재가 × 거래량의 근사치입니다. 실제 체결대금과 다릅니다. PER 미제공·0 이하 종목은 PER 조건에서 제외됩니다.</p>
          <StockTable rows={filtered} selected={selected} onSelect={select} />
          <aside className="mdis-tray" aria-label="비교 선택"><div><b>비교 후보 {selected.length}/4</b><span>{selected.map(id => rows.find(r => r.id === id)?.name || id).join(" · ") || "목록에서 비교할 종목을 선택하세요."}</span></div><Link to={`/stock-compare?codes=${encodeURIComponent(selected.join(","))}`}>선택 종목 비교 ↗</Link><button type="button" onClick={() => update({ codes: "" })}>선택 비우기</button></aside>
        </>}
      </>}
      {mode === "hub" ? <ServiceCatalogGrid /> : <ServiceConnections path={current.path} market={filters.market} />}
      <details className="mdis-explainer"><summary>숫자를 읽는 기준</summary><p>각 시장의 기존 TOP 100 보드에서 제공하는 종목만 분석합니다. 신규 상장·표본 변경·데이터 지연으로 목록이 달라질 수 있습니다. 미제공 값은 0으로 바꾸지 않습니다. 나스닥 보드의 지수 비중을 달러 시가총액으로 사용하지 않습니다.</p><p>52주 고점 대비 = (현재가 / 52주 고가 − 1) × 100. 업종 강도는 해당 업종 표본의 시가총액 가중 등락률입니다. 시장 간 통화 금액은 환산하지 않으며, 기간 등락률은 가격 변화 비교입니다.</p><p>이 페이지는 공개 시장 정보를 비교하는 도구입니다. 조건에 맞는다는 사실이 향후 수익이나 매매 적합성을 보장하지 않습니다.</p></details>
    </main>
  </div>;
}
