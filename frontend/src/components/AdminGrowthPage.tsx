import { useEffect, useMemo, useState } from "react";
import { AdminAuthError, GrowthOverview, adminApi, clearStoredSession, getStoredSession } from "../adminApi";
import { Link, navigate } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import "./adminGrowth.css";
import "./adminGrowthPastel.css";
import "./adminGrowthFilters.css";

const nf = new Intl.NumberFormat("ko-KR");
const channelNames: Record<string, string> = { search: "검색", email: "메일", social: "소셜", referral: "외부 링크", direct: "직접 방문" };
const channelColors: Record<string, string> = { search: "#bde0fe", email: "#cdb4db", social: "#ffc8dd", referral: "#ffe5b4", direct: "#b8e0d2" };
const quickRanges = [1, 3, 5, 7, 15, 30, 90, 365, 730];
const kstDate = (daysAgo = 0) => new Date(Date.now() + 9 * 60 * 60 * 1000 - daysAgo * 86_400_000).toISOString().slice(0, 10);

function TrendChart({ rows }: { rows: GrowthOverview["daily"] }) {
  const points = useMemo(() => {
    if (!rows.length) return "";
    const max = Math.max(1, ...rows.map(row => row.visitors));
    return rows.map((row, index) => `${rows.length === 1 ? 50 : index / (rows.length - 1) * 100},${92 - row.visitors / max * 76}`).join(" ");
  }, [rows]);
  const labels = rows.filter((_, index) => index === 0 || index === rows.length - 1 || index % Math.max(1, Math.ceil(rows.length / 5)) === 0);
  const total = rows.reduce((sum, row) => sum + row.visitors, 0);
  const peak = rows.reduce((best, row) => !best || row.visitors > best.visitors ? row : best, rows[0]);
  return <div className="growth-trend">
    <div className="growth-trend__summary"><span><i /> 순 방문자</span><strong>기간 합계 {nf.format(total)}명</strong><em>{peak ? `최고 ${peak.date} · ${nf.format(peak.visitors)}명` : "데이터 수집 중"}</em></div>
    {rows.length ? <div className="growth-trend__canvas">
      <div className="growth-trend__grid"><i/><i/><i/><i/></div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="날짜별 순 방문자 추세">
        <defs><linearGradient id="growthArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#cdb4db" stopOpacity=".45"/><stop offset=".55" stopColor="#bde0fe" stopOpacity=".2"/><stop offset="1" stopColor="#bde0fe" stopOpacity="0"/></linearGradient></defs>
        <polygon points={`0,100 ${points} 100,100`} fill="url(#growthArea)"/>
        <polyline points={points} fill="none" stroke="#bde0fe" strokeWidth="1.7" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"/>
      </svg>
      <div className="growth-trend__labels">{labels.map(row => <span key={row.date}>{row.date.slice(5).replace("-", ".")}</span>)}</div>
    </div> : <p className="empty">수집된 방문 데이터가 없습니다.</p>}
  </div>;
}

export default function AdminGrowthPage() {
  useDocumentTitle("100배 성장 통계 | K-Stock Hub");
  const [days, setDays] = useState(30);
  const [customOpen, setCustomOpen] = useState(false);
  const [startDate, setStartDate] = useState(kstDate(29));
  const [endDate, setEndDate] = useState(kstDate());
  const [appliedDates, setAppliedDates] = useState<{ start: string; end: string } | null>(null);
  const [data, setData] = useState<GrowthOverview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { if (!getStoredSession()) navigate("/admin"); }, []);
  useEffect(() => { let cancelled = false; setData(null); setError(""); adminApi.growthOverview(days, appliedDates?.start, appliedDates?.end).then(value => { if (!cancelled) setData(value); }).catch(err => { if (err instanceof AdminAuthError) { clearStoredSession(); navigate("/admin"); } else if (!cancelled) setError(err instanceof Error ? err.message : "통계를 불러오지 못했습니다."); }); return () => { cancelled = true; }; }, [days, appliedDates]);
  const selectQuickRange = (value: number) => { setDays(value); setAppliedDates(null); setCustomOpen(false); };
  const applyCustomRange = () => {
    if (!startDate || !endDate || startDate > endDate) { setError("시작일과 종료일을 올바르게 선택해 주세요."); return; }
    const selectedDays = Math.floor((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1;
    if (selectedDays > 730) { setError("최대 730일까지 조회할 수 있습니다."); return; }
    setDays(selectedDays); setAppliedDates({ start: startDate, end: endDate });
  };
  const maxChannel = Math.max(1, ...(data?.channels.map(item => item.visitors) || [1]));
  const channelTotal = Math.max(1, data?.channels.reduce((sum, item) => sum + item.visitors, 0) || 1);
  let channelCursor = 0;
  const channelDonut = data?.channels.map(item => { const start = channelCursor; channelCursor += item.visitors / channelTotal * 100; return `${channelColors[item.channel] || "#94a3b8"} ${start}% ${channelCursor}%`; }).join(",") || "#203a55 0 100%";
  const maxPage = Math.max(1, ...(data?.pages.map(item => item.visitors) || [1]));
  if (!getStoredSession()) return null;
  return <main className="admin-growth">
    <div className="growth-orb growth-orb--one"/><div className="growth-orb growth-orb--two"/>
    <header className="growth-header"><div><div className="growth-kicker"><i/> ACQUISITION MISSION</div><h1>방문자 100배 성장 관제실</h1><p>검색부터 캠페인까지, 유입의 흐름과 목표 달성 과정을 한눈에 확인합니다.</p></div><nav><Link to="/admin/dashboard">대시보드</Link><Link to="/admin/db">DB 조회</Link><Link to="/admin/monitor">모니터링</Link></nav></header>
    <div className="growth-toolbar"><div className="growth-range-control"><div className="ranges" role="group" aria-label="조회 기간">{quickRanges.map(n => <button type="button" className={!appliedDates&&days===n?"active":""} onClick={() => selectQuickRange(n)} key={n}>{n===365?"1년":n===730?"2년":`${n}일`}</button>)}<button type="button" className={appliedDates?"active":""} onClick={() => setCustomOpen(value => !value)}>직접입력</button></div>{customOpen&&<div className="growth-custom-range" role="group" aria-label="직접 조회 기간"><label><span>시작일</span><input type="date" value={startDate} max={endDate||kstDate()} onChange={event=>setStartDate(event.target.value)}/></label><i>→</i><label><span>종료일</span><input type="date" value={endDate} min={startDate} max={kstDate()} onChange={event=>setEndDate(event.target.value)}/></label><button type="button" onClick={applyCustomRange}>조회</button></div>}</div><span>데이터 기준 · KST</span></div>
    {error && <div className="error">{error}</div>}
    {!data ? <div className="growth-skeleton"><i/><i/><i/><i/><div/></div> : <>
      <section className="cards">
        <article><div className="metric-icon metric-icon--baseline">B</div><span>기준 일 방문자</span><strong>{nf.format(data.goal.baseline_daily_visitors)}<small>명</small></strong><footer>{new Date(data.goal.started_at).toLocaleDateString("ko-KR")} 출발</footer></article>
        <article><div className="metric-icon metric-icon--today">T</div><span>오늘 순 방문자</span><strong>{nf.format(data.today.visitors)}<small>명</small></strong><footer>{nf.format(data.today.pageviews)} 페이지뷰</footer></article>
        <article className="accent"><div className="metric-icon metric-icon--growth">×</div><span>현재 성장 배수</span><strong>{data.current_multiplier.toFixed(2)}<small>×</small></strong><footer>1차 목표 10× · 최종 100×</footer></article>
        <article><div className="metric-icon metric-icon--goal">%</div><span>100배 달성률</span><strong>{data.achievement_pct.toFixed(2)}<small>%</small></strong><div className="goal-meter"><i style={{width:`${Math.max(1, data.achievement_pct)}%`}}/></div><footer>목표 {nf.format(data.goal.baseline_daily_visitors * 100)}명/일</footer></article>
      </section>
      <section className="panel panel--trend"><div className="panel-heading"><div><span className="panel-label">GROWTH VELOCITY</span><h2>날짜별 순 방문자 성장</h2></div><span>선 위에 마우스를 올리면 날짜별 수치를 확인할 수 있습니다.</span></div><TrendChart rows={data.daily}/></section>
      <div className="grid"><section className="panel"><div className="panel-heading"><div><span className="panel-label">ACQUISITION MIX</span><h2>유입 채널 분포</h2></div></div><div className="channel-layout"><div className="channel-donut" style={{background:`conic-gradient(${channelDonut})`}}><div><strong>{nf.format(channelTotal)}</strong><span>순 방문자</span></div></div><div className="channel-list">{data.channels.map(item => <div className="channel" key={item.channel}><div><b><i style={{background:channelColors[item.channel] || "#94a3b8"}}/>{channelNames[item.channel] || item.channel}</b><span>{(item.visitors/channelTotal*100).toFixed(1)}%</span></div><div className="channel-meter"><i style={{width:`${item.visitors/maxChannel*100}%`,background:channelColors[item.channel] || "#94a3b8"}}/></div></div>)}</div></div></section>
      <section className="panel"><div className="panel-heading"><div><span className="panel-label">ORGANIC SEARCH</span><h2>검색엔진 유입</h2></div></div>{data.search_sources.length ? data.search_sources.map((item,index) => <div className="rank-row" key={item.source}><span>{String(index+1).padStart(2,"0")}</span><b>{item.source}</b><em>{nf.format(item.visitors)}명</em><small>{nf.format(item.pageviews)} PV</small></div>) : <p className="empty">검색 유입을 기다리고 있습니다. 데이터가 들어오면 엔진별로 자동 분류됩니다.</p>}</section></div>
      <section className="panel"><div className="panel-heading"><div><span className="panel-label">PAGE PERFORMANCE</span><h2>페이지별 방문 성과</h2></div><span>순 방문자 기준 상위 50개 페이지</span></div><div className="page-bars">{data.pages.slice(0,6).map((page,index) => <div key={page.path}><span>{index+1}</span><b title={page.path}>{page.path}</b><div><i style={{width:`${page.visitors/maxPage*100}%`}}/></div><em>{nf.format(page.visitors)}명</em></div>)}</div><div className="table"><div className="head"><b>페이지 경로</b><span>순 방문자</span><em>페이지뷰</em></div>{data.pages.map(page => <div key={page.path}><b title={page.path}>{page.path}</b><span>{nf.format(page.visitors)}</span><em>{nf.format(page.pageviews)}</em></div>)}</div></section>
      <section className="panel"><div className="panel-heading"><div><span className="panel-label">CAMPAIGN ATTRIBUTION</span><h2>메일·캠페인 유입</h2></div></div><p className="hint">메일 링크에 <code>utm_source=newsletter&amp;utm_medium=email&amp;utm_campaign=캠페인명</code>을 붙이면 자동 집계됩니다.</p>{data.campaigns.length ? data.campaigns.map(c => <div className="campaign-row" key={`${c.campaign}-${c.source}`}><b>{c.campaign}</b><span>{c.source}</span><em>{nf.format(c.visitors)}명</em></div>) : <p className="empty">아직 집계된 캠페인이 없습니다.</p>}</section>
    </>}
  </main>;
}
