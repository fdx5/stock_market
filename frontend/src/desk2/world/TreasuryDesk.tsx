import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link } from "../../router";
import { startVisibilityAwareInterval } from "../../pollVisibility";
import { useDocumentTitle } from "../../useDocumentTitle";
import { useBroadsheet } from "../shell";
import { useL } from "../lib";
import "./treasuries.css";

type Point = { time: number; date: string; yield_pct: number; change_bp: number | null };
type Quote = { tenor: string; yield_pct: number | null; change_bp?: number | null; previous_close?: number | null;
  open?: number | null; high?: number | null; low?: number | null; quote_time_label?: string;
  provider_realtime?: boolean; stale?: boolean; session_date: string | null; chart_stale: boolean; points: Point[] };
type Snapshot = { items: Quote[]; source: string; generated_at: string };
type History = { points: Point[]; as_of: string; source: string };
const last = <T,>(items: T[]) => items[items.length - 1];
const fmt = (n: number | null | undefined, digits = 3) => n == null ? "—" : n.toFixed(digits);
const bp = (n: number | null | undefined) => n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)} bp`;
const clock = (seconds: number) => new Date(seconds * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" });
async function read<T>(path: string): Promise<T> {
  const response = await fetch(path, { signal: AbortSignal.timeout(20000), cache: "no-store" });
  if (!response.ok) throw new Error("데이터를 불러오지 못했습니다. 다시 시도해 주세요.");
  return response.json() as Promise<T>;
}
function useTreasuries() {
  const [data, setData] = useState<Snapshot | null>(null), [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let gone = false, busy = false;
    const load = async () => {
      if (busy) return; busy = true;
      try { const next = await read<Snapshot>("/api/global/treasuries"); if (!gone) { setData(next); setError(""); } }
      catch (e) { if (!gone) setError(e instanceof Error ? e.message : "금리 조회 실패"); }
      finally { busy = false; }
    };
    void load(); const stop = startVisibilityAwareInterval(() => void load(), 30000);
    return () => { gone = true; stop(); };
  }, [reload]);
  return { data, error, retry: () => setReload(n => n + 1) };
}

function Plots({ points, daily = false, compact = false }: { points: Point[]; daily?: boolean; compact?: boolean }) {
  const L = useL();
  const [hover, setHover] = useState<number | null>(null);
  if (!points.length) return <div className="ty-empty">{L("그래프 자료를 불러오지 못했습니다. 새로고침으로 다시 시도할 수 있습니다.", "Chart data is unavailable. Refresh to retry.")}</div>;
  const W = 760, left = 55, right = 12, chartW = W - left - right;
  const first = points[0].time, span = last(points).time - first || 1;
  const x = (p: Point) => left + (p.time - first) / span * chartW;
  const lo = Math.min(...points.map(p => p.yield_pct)), hi = Math.max(...points.map(p => p.yield_pct));
  const pad = Math.max((hi - lo) * .15, .005);
  const y = (n: number) => 16 + (hi + pad - n) / (hi - lo + pad * 2) * 160;
  const extent = Math.max(.1, ...points.map(p => Math.abs(p.change_bp ?? 0)));
  const deltaY = (n: number) => 61 - n / extent * 44;
  const focused = hover === null ? last(points) : points[Math.min(hover, points.length-1)];
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p).toFixed(2)},${y(p.yield_pct).toFixed(2)}`).join(" ");
  const move = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(), target = (event.clientX - rect.left) / rect.width * W;
    let nearest = 0;
    points.forEach((p, i) => { if (Math.abs(x(p) - target) < Math.abs(x(points[nearest]) - target)) nearest = i; });
    setHover(nearest);
  };
  return <div className={`ty-plots${compact ? " is-compact" : ""}`} tabIndex={0}
    onKeyDown={e => { if (["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); setHover(n => Math.max(0, Math.min(points.length-1, (n ?? points.length-1) + (e.key === "ArrowRight" ? 1 : -1)))); } }}
    aria-label={L("금리와 변동폭 그래프. 방향키로 이력을 확인하세요.", "Yield and change charts. Use arrow keys to inspect history.")}>
    <div className="ty-plot-label"><span>{L("금리", "Yield")} <small>%</small></span><b>{fmt(focused.yield_pct)}%</b></div>
    <svg viewBox={`0 0 ${W} 202`} role="img" aria-label={daily ? "국채 금리 일별 이력" : "미국 국채 당일 금리"} onMouseMove={move} onMouseLeave={() => setHover(null)}>
      {[0,1,2,3,4].map(i => <g key={i}><line x1={left} x2={W-right} y1={16+i*40} y2={16+i*40} className="ty-grid"/><text x={left-8} y={20+i*40} textAnchor="end">{(hi+pad-(hi-lo+pad*2)*i/4).toFixed(2)}</text></g>)}
      <path d={line} className="ty-yield-line"/>
      {points.length === 1 && <circle cx={x(points[0])} cy={y(points[0].yield_pct)} r={4} className="ty-point"/>}
      {hover !== null && <><line x1={x(focused)} x2={x(focused)} y1={16} y2={176} className="ty-cursor"/><circle cx={x(focused)} cy={y(focused.yield_pct)} r={4} className="ty-point"/></>}
      <text x={left} y={198}>{daily ? points[0].date : clock(points[0].time)}</text><text x={W-right} y={198} textAnchor="end">{daily ? last(points).date : clock(last(points).time)}</text>
    </svg>
    <div className="ty-plot-label"><span>{daily ? L("전 거래일 대비", "Daily change") : L("전일 종가 대비", "From previous close")} <small>bp</small></span><b className={(focused.change_bp ?? 0) >= 0 ? "is-up" : "is-down"}>{bp(focused.change_bp)}</b></div>
    <svg viewBox={`0 0 ${W} 130`} role="img" aria-label="금리 등락폭 bp 그래프" onMouseMove={move} onMouseLeave={() => setHover(null)}>
      <line x1={left} x2={W-right} y1={61} y2={61} className="ty-zero"/>
      <text x={left-8} y={21} textAnchor="end">+{extent.toFixed(1)}</text><text x={left-8} y={65} textAnchor="end">0</text><text x={left-8} y={109} textAnchor="end">−{extent.toFixed(1)}</text>
      {points.filter(p => p.change_bp !== null).map(p => <line key={p.time} x1={x(p)} x2={x(p)} y1={61} y2={deltaY(p.change_bp!)} className={p.change_bp! >= 0 ? "ty-bar-up" : "ty-bar-down"} strokeWidth={Math.max(1, Math.min(6, chartW/points.length*.7))}/>)}
      {hover !== null && <line x1={x(focused)} x2={x(focused)} y1={12} y2={110} className="ty-cursor"/>}
      <text x={left} y={127}>{daily ? points[0].date : clock(points[0].time)}</text><text x={W-right} y={127} textAnchor="end">{daily ? last(points).date : clock(last(points).time)}</text>
    </svg>
    <div className="ty-readout">{focused.date} {!daily && `${clock(focused.time)} ET`} · {fmt(focused.yield_pct)}% · {bp(focused.change_bp)}</div>
  </div>;
}
function YieldHeader({ quote }: { quote: Quote }) {
  const L = useL();
  return <><div className="ty-instrument"><Link to={`/global/treasuries/${quote.tenor}`}>{L(`미국 ${quote.tenor}년물`, `US ${quote.tenor}-Year Treasury`)}</Link><span>US{quote.tenor}Y</span></div>
    <div className="ty-price"><strong>{fmt(quote.yield_pct)}<small>%</small></strong><b className={(quote.change_bp ?? 0) >= 0 ? "is-up" : "is-down"}>{bp(quote.change_bp)}</b></div>
    <p className="ty-asof">{quote.quote_time_label || "—"} · {quote.stale ? L("마지막 수신값", "Last received") : quote.provider_realtime ? L("실시간 피드 · 30초 확인", "Real-time feed · 30s refresh") : L("지연 여부 미확인", "Delay unconfirmed")}</p></>;
}
export default function TreasuryDesk() {
  const L = useL(); const { data, error, retry } = useTreasuries();
  return <section id="w-treasuries" className="ty-desk d2-sec" aria-labelledby="ty-title"><header className="ty-section-head"><div><span className="ty-kicker">US TREASURY / LIVE YIELDS</span><h2 id="ty-title">{L("미국 국채 금리", "US Treasury yields")}</h2><p>{L("당일 금리와 전일 대비 등락폭 · 미국 동부시간 · 1bp = 0.01%p", "Today's yields and changes · US Eastern time · 1bp = 0.01 percentage point")}</p></div><button type="button" onClick={retry}>{L("새로고침", "Refresh")}</button></header>
    {error && <p className="ty-error" role="alert">{error}{data && L(" · 마지막 성공 값 표시 중", " · Showing last successful data")}</p>}
    {!data && !error && <p role="status" className="ty-loading">{L("실제 국채 금리와 그래프를 연결하는 중…", "Loading Treasury yields and charts…")}</p>}
    <div className="ty-cards">{data?.items.map(q => <article className="ty-card" key={q.tenor}><YieldHeader quote={q}/><div className="ty-session">{q.session_date || "—"}{q.chart_stale && ` · ${L("최근 거래 데이터", "Latest trading data")}`}</div><Plots points={q.points} compact/><Link to={`/global/treasuries/${q.tenor}`} className="ty-detail-link">{L("최근 3년 이력 보기", "Explore 3-year history")} ↗</Link></article>)}</div>
    <p className="ty-source">CNBC / Tradeweb · {L("화면이 보일 때 30초마다 확인합니다. 공급 지연·휴장 시 마지막 데이터 시각을 확인하세요.", "Refreshes every 30 seconds while visible. Check timestamps for delays or closed markets.")}</p></section>;
}
export function TreasuryDetailPage({ tenor }: { tenor: "2" | "5" | "10" }) {
  const L = useL(); useBroadsheet(); useDocumentTitle(`미국 ${tenor}년물 국채 금리 · 3년 이력 | KOSPIMAP`);
  const { data, error: quoteError, retry } = useTreasuries(); const quote = data?.items.find(q => q.tenor === tenor);
  const [history, setHistory] = useState<History | null>(null), [error, setError] = useState("");
  const [reload, setReload] = useState(0), [range, setRange] = useState("3y"), [page, setPage] = useState(0);
  useEffect(() => {
    let gone = false, busy = false; setHistory(null); setError(""); setPage(0);
    const load = async () => { if (busy) return; busy = true;
      try { const next = await read<History>(`/api/global/treasuries/${tenor}/history`); if (!gone) { setHistory(next); setError(""); } }
      catch (e) { if (!gone) setError(e instanceof Error ? e.message : "이력 조회 실패"); } finally { busy = false; } };
    void load(); const stop = startVisibilityAwareInterval(() => void load(), 900000); return () => { gone = true; stop(); };
  }, [tenor, reload]);
  const points = useMemo(() => { if (range === "1d") return quote?.points || [];
    const cutoff = new Date(); cutoff.setUTCMonth(cutoff.getUTCMonth() - (range === "1m" ? 1 : range === "3m" ? 3 : range === "1y" ? 12 : 36));
    return (history?.points || []).filter(p => p.date >= cutoff.toISOString().slice(0,10)); }, [history, quote, range]);
  const rows = useMemo(() => [...(history?.points || [])].reverse(), [history]);
  return <main className="ty-detail d2"><header className="ty-detail-top"><div><Link to="/global">← {L("해외 증시", "World markets")}</Link><p className="ty-kicker">US TREASURY / HISTORICAL YIELDS</p><h1>{L(`미국 ${tenor}년물 국채 금리`, `US ${tenor}-Year Treasury yield`)}</h1></div><nav className="ty-maturities" aria-label="국채 만기 선택">{(["2","5","10"] as const).map(t => <Link key={t} to={`/global/treasuries/${t}`} className={t === tenor ? "is-active" : ""}>{L(`${t}년물`, `${t}-Year`)}</Link>)}</nav></header>
    {(quoteError || error) && <p className="ty-error" role="alert">{quoteError || error}<button type="button" onClick={() => { retry(); setReload(n => n+1); }}>다시 시도</button></p>}
    <section className="ty-detail-quote">{quote ? <><YieldHeader quote={quote}/><dl>{[[L("전일 종가","Previous close"),quote.previous_close],[L("시가","Open"),quote.open],[L("고가","High"),quote.high],[L("저가","Low"),quote.low]].map(([label,value]) => <div key={String(label)}><dt>{label}</dt><dd>{fmt(value as number)}%</dd></div>)}</dl></> : <p role="status">현재 금리 연결 중…</p>}</section>
    <section className="ty-detail-chart"><header><h2>{L("금리 · 등락폭 추이","Yield & change history")}</h2><div className="ty-ranges" role="group" aria-label="차트 기간">{[["1d","1일"],["1m","1개월"],["3m","3개월"],["1y","1년"],["3y","3년"]].map(([key,label]) => <button type="button" key={key} aria-pressed={range === key} onClick={() => setRange(key)}>{label}</button>)}</div></header>
      {!history && range !== "1d" && !error ? <p role="status">{L("최근 3년의 실제 금리 이력을 불러오는 중…","Loading three years of history…")}</p> : <Plots points={points} daily={range !== "1d"}/>}
      <p className="ty-source">{range === "1d" ? L("당일 장중 자료 · 30초 갱신","Intraday · 30-second refresh") : L("일별 자료 · 15분 확인 · 주말과 결측일은 보간하지 않습니다.","Daily observations · 15-minute refresh · Missing days are not interpolated.")} · CNBC / Tradeweb{history && ` · ${L("이력 기준일","History as of")} ${history.as_of}`}</p></section>
    <section className="ty-history"><header><h2>{L("최근 3년 일별 변동 이력","Three-year daily history")}</h2><span>{rows.length.toLocaleString()} {L("거래일","observations")}</span></header><div className="ty-table-wrap"><table><thead><tr><th scope="col">{L("날짜 (미국 동부)","Date (US Eastern)")}</th><th scope="col">{L("금리","Yield")}</th><th scope="col">{L("전 거래일 대비","Daily change")}</th></tr></thead><tbody>{rows.slice(page*30,page*30+30).map(p => <tr key={p.date}><td>{p.date}</td><td>{fmt(p.yield_pct)}%</td><td className={(p.change_bp ?? 0) >= 0 ? "is-up" : "is-down"}>{bp(p.change_bp)}</td></tr>)}</tbody></table></div><div className="ty-pagination"><button type="button" disabled={!page} onClick={() => setPage(n => n-1)}>← {L("이전","Previous")}</button><span>{rows.length ? page+1 : 0} / {Math.ceil(rows.length/30)}</span><button type="button" disabled={(page+1)*30 >= rows.length} onClick={() => setPage(n => n+1)}>{L("다음","Next")} →</button></div></section>
  </main>;
}
