import { useEffect, useState } from "react";
import { AdminAuthError, authedGet } from "../adminApi";
import { navigate } from "../router";
import { SERVICES } from "../markets/catalog";
import { RESEARCH_ACTIONS } from "../markets/researchActions";
import { startVisibilityAwareInterval } from "../pollVisibility";
import "./adminResearch.css";
type Row = { path: string; name: string; views: number; sessions: number; actions: number };
type Data = { days: number; path: string; pages: Row[]; actions: { path: string; action: string; count: number; sessions: number }[]; trend: { day: string; views: number; actions: number }[]; recent: { at: string; path: string; action: string; code?: string; name?: string }[] };
const label = (path: string) => SERVICES.find(s => s.path === path)?.name ?? path;
const actionLabel = (key: string) => RESEARCH_ACTIONS[key as keyof typeof RESEARCH_ACTIONS] ?? key;
export default function AdminResearchPanel() {
  const [days, setDays] = useState(7), [path, setPath] = useState(""), [revision, refresh] = useState(0);
  const [result, setResult] = useState<Data | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let alive = true, pending = false;
    const load = async () => {
      if (pending) return; pending = true;
      try { const data = await authedGet<Data>(`/research/stats?days=${days}&path=${encodeURIComponent(path)}`); if (alive) { setResult(data); setError(""); } }
      catch (e) { if (alive) { if (e instanceof AdminAuthError) navigate("/admin"); else setError(e instanceof Error ? e.message : "신규 서비스 통계를 불러오지 못했습니다."); } }
      finally { pending = false; }
    };
    void load(); const stop = startVisibilityAwareInterval(() => void load(), 30_000);
    return () => { alive = false; stop(); };
  }, [days, path, revision]);
  const data = result?.days === days && result.path === path ? result : null;
  return <section className="admin-panel ars-panel" aria-label="신규 서비스 페이지 분석"><header className="ars-head"><div><small>RESEARCH SERVICES / 36 PAGES</small><h2>신규 서비스 · 페이지별 분석</h2><p>조회·방문 세션·기능 사용·일별 추이와 최근 동작을 함께 확인합니다.</p></div><div className="ars-controls"><label>기간<select value={days} onChange={e => setDays(Number(e.target.value))}>{[1, 7, 30].map(n => <option key={n} value={n}>최근 {n}일</option>)}</select></label><label>분석 페이지<select value={path} onChange={e => setPath(e.target.value)}><option value="">신규 36개 전체</option>{SERVICES.map(s => <option key={s.path} value={s.path}>{s.name}</option>)}</select></label><button type="button" onClick={() => refresh(n => n + 1)}>새로고침</button></div></header>
    {error && <p role="alert">{error}</p>}{!data && !error && <p role="status">통계 불러오는 중…</p>}
    {data && <><div className="ars-metrics">{[["페이지 조회", data.pages.reduce((n, r) => n + r.views, 0)], ["페이지별 세션 합계", data.pages.reduce((n, r) => n + r.sessions, 0)], ["주요 기능 동작", data.pages.reduce((n, r) => n + r.actions, 0)]].map(([name, value]) => <article key={String(name)}><small>{name}</small><strong>{Number(value).toLocaleString("ko-KR")}</strong></article>)}</div>
      <p className="ars-note">봇 제외 · 세션은 페이지 안에서 중복 제외하며 여러 페이지 방문은 각각 집계됩니다. 기간은 최근 {days}일, 일별 구분은 한국시간입니다. 배포 전 기능 동작 기록은 소급 생성하지 않습니다.</p>
      <div className="ars-table"><table><caption>페이지별 이용 현황 · 페이지명을 누르면 해당 페이지로 필터링</caption><thead><tr><th>페이지</th><th>조회</th><th>세션</th><th>기능 동작</th></tr></thead><tbody>{data.pages.map(row => <tr key={row.path}><th><button type="button" onClick={() => setPath(row.path)}>{row.name}</button><small>{row.path}</small></th><td>{row.views.toLocaleString()}</td><td>{row.sessions.toLocaleString()}</td><td>{row.actions.toLocaleString()}</td></tr>)}</tbody></table></div>
      <div className="ars-split"><div className="ars-table"><table><caption>일별 추이</caption><thead><tr><th>한국시간 날짜</th><th>조회</th><th>동작</th></tr></thead><tbody>{data.trend.map(r => <tr key={r.day}><th>{r.day}</th><td>{r.views}</td><td>{r.actions}</td></tr>)}</tbody></table>{!data.trend.length && <p>선택 기간에 기록이 없습니다.</p>}</div><div className="ars-table"><table><caption>기능별 사용 · 선택 페이지 기준</caption><thead><tr><th>페이지 / 기능</th><th>횟수</th><th>세션</th></tr></thead><tbody>{data.actions.map(r => <tr key={`${r.path}:${r.action}`}><th>{label(r.path)}<small>{actionLabel(r.action)}</small></th><td>{r.count}</td><td>{r.sessions}</td></tr>)}</tbody></table>{!data.actions.length && <p>기능 동작 기록이 없습니다.</p>}</div></div>
      <details className="ars-recent"><summary>최근 기능 사용 로그 {data.recent.length}건</summary><div className="ars-table"><table><thead><tr><th>한국시간</th><th>페이지</th><th>동작</th><th>선택 종목</th></tr></thead><tbody>{data.recent.map((r, i) => <tr key={i}><td>{new Date(r.at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</td><td>{label(r.path)}</td><td>{actionLabel(r.action)}</td><td>{r.name || r.code || "—"}{r.name && r.code ? ` (${r.code})` : ""}</td></tr>)}</tbody></table></div></details>
      <p className="ars-note">검색 입력문·가정 금액·자유 메모·파일 이름과 내용은 이 기능 로그에 저장하지 않습니다. 선택 완료된 공개 종목 코드·이름과 동작 종류만 기록합니다.</p></>}
  </section>;
}
