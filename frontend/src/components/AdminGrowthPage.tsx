import { useEffect, useMemo, useState } from "react";
import { AdminAuthError, GrowthOverview, adminApi, clearStoredSession, getStoredSession } from "../adminApi";
import { Link, navigate } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import "./adminGrowth.css";

const nf = new Intl.NumberFormat("ko-KR");
const names: Record<string, string> = { search: "검색", email: "메일", social: "소셜", referral: "외부 링크", direct: "직접 방문" };

export default function AdminGrowthPage() {
  useDocumentTitle("100배 성장 통계 | K-Stock Hub");
  const [days, setDays] = useState(90), [data, setData] = useState<GrowthOverview | null>(null), [error, setError] = useState("");
  useEffect(() => { if (!getStoredSession()) navigate("/admin"); }, []);
  useEffect(() => { let cancelled = false; setError(""); adminApi.growthOverview(days).then(v => { if (!cancelled) setData(v); }).catch(err => { if (err instanceof AdminAuthError) { clearStoredSession(); navigate("/admin"); } else if (!cancelled) setError(err instanceof Error ? err.message : "통계를 불러오지 못했습니다."); }); return () => { cancelled = true; }; }, [days]);
  const max = useMemo(() => Math.max(1, ...(data?.daily.map(d => d.visitors) || [1])), [data]);
  if (!getStoredSession()) return null;
  return <main className="admin-growth">
    <header><div><small>ACQUISITION MISSION</small><h1>방문자 100배 성장 관제실</h1><p>검색·메일·캠페인 유입과 날짜별 목표 달성률을 추적합니다.</p></div><nav><Link to="/admin/dashboard">대시보드</Link><Link to="/admin/db">DB</Link><Link to="/admin/monitor">모니터링</Link></nav></header>
    <div className="ranges">{[30,90,365,730].map(n => <button className={days===n?"active":""} onClick={() => setDays(n)} key={n}>{n}일</button>)}</div>
    {error && <div className="error">{error}</div>}
    {!data ? <div className="loading">성장 데이터를 집계하고 있습니다…</div> : <>
      <section className="cards"><article><span>기준 일 방문자</span><strong>{nf.format(data.goal.baseline_daily_visitors)}</strong><small>{new Date(data.goal.started_at).toLocaleDateString("ko-KR")} 시작</small></article><article><span>오늘 방문자</span><strong>{nf.format(data.today.visitors)}</strong><small>{nf.format(data.today.pageviews)} 페이지뷰</small></article><article className="accent"><span>현재 성장 배수</span><strong>{data.current_multiplier.toFixed(2)}×</strong><small>1차 10× · 최종 100×</small></article><article><span>100배 달성률</span><strong>{data.achievement_pct.toFixed(2)}%</strong><small>{nf.format(data.goal.baseline_daily_visitors * 100)}명/일 목표</small></article></section>
      <section className="panel"><h2>날짜별 순 방문자 성장</h2><div className="chart">{data.daily.map(d => <div className="bar" key={d.date} title={`${d.date} · ${nf.format(d.visitors)}명 · ${d.multiplier}×`}><i style={{height:`${Math.max(2,d.visitors/max*100)}%`}}/><span>{d.date.slice(5)}</span></div>)}</div></section>
      <div className="grid"><section className="panel"><h2>유입 채널</h2>{data.channels.map(c => <div className="row" key={c.channel}><b>{names[c.channel] || c.channel}</b><span>{nf.format(c.visitors)}명</span><em>{nf.format(c.pageviews)} PV</em></div>)}</section><section className="panel"><h2>검색엔진 유입</h2>{data.search_sources.length ? data.search_sources.map(s => <div className="row" key={s.source}><b>{s.source}</b><span>{nf.format(s.visitors)}명</span><em>{nf.format(s.pageviews)} PV</em></div>) : <p className="empty">아직 검색 유입 데이터가 없습니다.</p>}</section></div>
      <section className="panel"><h2>페이지별 방문자</h2><div className="table"><div className="head"><b>경로</b><span>순 방문자</span><em>페이지뷰</em></div>{data.pages.map(p => <div key={p.path}><b>{p.path}</b><span>{nf.format(p.visitors)}</span><em>{nf.format(p.pageviews)}</em></div>)}</div></section>
      <section className="panel"><h2>메일·캠페인 유입</h2><p className="hint">메일 링크에 <code>utm_source=newsletter&amp;utm_medium=email&amp;utm_campaign=캠페인명</code>을 붙이면 자동 집계됩니다.</p>{data.campaigns.map(c => <div className="row" key={`${c.campaign}-${c.source}`}><b>{c.campaign}</b><span>{c.source}</span><em>{nf.format(c.visitors)}명</em></div>)}</section>
    </>}
  </main>;
}
