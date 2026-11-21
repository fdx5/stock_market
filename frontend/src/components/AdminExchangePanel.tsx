import { useEffect, useState } from "react";
import { AdminAuthError, authedGet } from "../adminApi";
import { navigate } from "../router";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { PANEL_LABELS } from "../exchange/market";
import "./adminResearch.css";

type Data = {
  days: number; views: number; sessions: number;
  actions: { action: string; count: number; sessions: number }[];
  trend: { day: string; views: number; sessions: number; actions: number }[];
  recent: { at: string; path: string; action: string; label: string | null }[];
};

/** object_key = exchange:<kind>:<detail> → 사람이 읽는 이름. */
function actionLabel(action: string): string {
  if (action === "view") return "페이지 조회";
  const [kind, ...rest] = action.split(":");
  const detail = rest.join(":");
  if (kind === "entry") return detail === "menu" ? "진입 · 메뉴" : "진입 · " + detail;
  if (kind === "3d") return detail === "failed" ? "3D 시작 실패" : "3D 입장 · " + detail.toUpperCase();
  if (kind === "panel") return "관제 화면 열기 · " + (PANEL_LABELS[detail]?.[0] ?? (/^s\d+$/.test(detail) ? "포스트 종목 " + (Number(detail.slice(1)) + 1) : detail));
  if (kind === "station") return "이동 · " + detail;
  if (kind === "market") return "시장 전환 · " + detail.toUpperCase();
  if (kind === "sound") return "음향 켜기";
  return action;
}
const kst = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function AdminExchangePanel() {
  const [days, setDays] = useState(7), [revision, refresh] = useState(0);
  const [result, setResult] = useState<Data | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let alive = true, pending = false;
    const load = async () => {
      if (pending) return; pending = true;
      try { const data = await authedGet<Data>(`/exchange/stats?days=${days}`); if (alive) { setResult(data); setError(""); } }
      catch (e) { if (alive) { if (e instanceof AdminAuthError) navigate("/admin"); else setError(e instanceof Error ? e.message : "거래소 통계를 불러오지 못했습니다."); } }
      finally { pending = false; }
    };
    void load(); const stop = startVisibilityAwareInterval(() => void load(), 300_000);
    return () => { alive = false; stop(); };
  }, [days, revision]);
  const data = result?.days === days ? result : null;
  const count = (prefix: string) => data ? data.actions.filter(a => a.action.startsWith(prefix)).reduce((s, a) => s + a.count, 0) : 0;
  const entered = count("3d:webgpu") + count("3d:webgl2"), failed = count("3d:failed");
  const panels = data ? data.actions.filter(a => a.action.startsWith("panel:")) : [];
  return <section className="admin-panel ars-panel" aria-label="증권 거래소 분석">
    <header className="ars-head"><div><small>3D EXCHANGE / 400평</small><h2>증권 거래소 · 방문과 동작 로그</h2><p>페이지 조회·세션, 3D 입장 성공률(WebGPU/WebGL2), 메뉴 진입, 많이 연 관제 화면과 이동·시장 전환을 집계합니다.</p></div>
      <div className="ars-controls"><label>기간<select value={days} onChange={e => setDays(Number(e.target.value))}>{[1, 7, 30].map(n => <option key={n} value={n}>최근 {n}일</option>)}</select></label><button type="button" onClick={() => refresh(n => n + 1)}>새로고침</button><a href="/exchange" target="_blank" rel="noopener">페이지 열기 ↗</a></div></header>
    {error && <p role="alert">{error}</p>}{!data && !error && <p role="status">통계 불러오는 중…</p>}
    {data && <>
      <div className="ars-metrics">{[["페이지 조회", data.views], ["방문 세션", data.sessions], ["메뉴 진입", count("entry:")], ["3D 입장", entered],
        ["3D 성공률", entered + failed ? Math.round(entered / (entered + failed) * 100) + "%" : "—"], ["관제 화면 열기", count("panel:")]].map(([name, value]) =>
        <article key={String(name)}><small>{name}</small><strong>{typeof value === "number" ? value.toLocaleString("ko-KR") : value}</strong></article>)}</div>
      <p className="ars-note">봇 제외 · 한국시간 기준. 3D 입장은 렌더러 준비가 끝난 방문만 셉니다.</p>
      <div className="ars-split">
        <div className="ars-table"><table><caption>일별 추이</caption><thead><tr><th>날짜</th><th>조회</th><th>세션</th><th>동작</th></tr></thead><tbody>{data.trend.map(r => <tr key={r.day}><th>{r.day}</th><td>{r.views}</td><td>{r.sessions}</td><td>{r.actions}</td></tr>)}</tbody></table>{!data.trend.length && <p>선택 기간에 기록이 없습니다.</p>}</div>
        <div className="ars-table"><table><caption>많이 연 관제 화면</caption><thead><tr><th>화면</th><th>횟수</th><th>세션</th></tr></thead><tbody>{panels.map(r => <tr key={r.action}><th>{actionLabel(r.action)}</th><td>{r.count}</td><td>{r.sessions}</td></tr>)}</tbody></table>{!panels.length && <p>아직 기록이 없습니다.</p>}</div>
      </div>
      <div className="ars-table"><table><caption>동작별 집계</caption><thead><tr><th>동작</th><th>횟수</th><th>세션</th></tr></thead><tbody>{data.actions.map(r => <tr key={r.action}><th>{actionLabel(r.action)}</th><td>{r.count}</td><td>{r.sessions}</td></tr>)}</tbody></table>{!data.actions.length && <p>동작 기록이 없습니다.</p>}</div>
      <details className="ars-recent"><summary>최근 로그 {data.recent.length}건</summary><div className="ars-table"><table><thead><tr><th>한국시간</th><th>페이지</th><th>동작</th><th>내용</th></tr></thead><tbody>{data.recent.map((r, i) => <tr key={i}><td>{kst(r.at)}</td><td>{r.path}</td><td>{actionLabel(r.action)}</td><td>{r.label ?? "—"}</td></tr>)}</tbody></table></div></details>
    </>}
  </section>;
}
