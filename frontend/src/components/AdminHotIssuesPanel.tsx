import { useEffect, useState } from "react";
import { AdminAuthError, authedGet, authedPost } from "../adminApi";
import { navigate } from "../router";
import { startVisibilityAwareInterval } from "../pollVisibility";
import "./adminResearch.css";

type Edition = { slot: string; published: boolean; generated_at: string | null; model: string | null; stories: number; headline: string | null; sources: number; images: number; videos: number };
type Data = {
  days: number; views: number; sessions: number;
  actions: { action: string; count: number; sessions: number }[];
  trend: { day: string; views: number; sessions: number; actions: number }[];
  recent: { at: string; path: string; action: string; label: string | null }[];
  editions: Edition[];
  runs: { slot: string; at: string; event: string; trigger: string | null; detail: string | null }[];
};
const EVENT: Record<string, string> = { started: "작성 시작", published: "발행", failed: "실패", exists: "이미 발행됨", log_unavailable: "로그 조회 실패" };
const TRIGGER: Record<string, string> = { schedule: "자동", admin: "관리자" };

/** 어떤 동작인지 사람이 읽는 이름으로. object_key = hotissue:<action>. */
function actionLabel(action: string): string {
  if (action === "view") return "페이지 조회";
  if (action === "entry:header") return "진입 · 상단 버튼(코스피200 선물 왼쪽)";
  if (action === "entry:menu") return "진입 · 메뉴";
  const names: Record<string, string> = { open: "기사 펼치기", source: "출처 기사 열기", video: "영상 재생", stock: "관련 종목 이동", edition: "판 전환" };
  const [kind, ...rest] = action.split(":");
  return names[kind] ? `${names[kind]} · ${rest.join(":")}` : action;
}
const kst = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function AdminHotIssuesPanel() {
  const [days, setDays] = useState(7), [revision, refresh] = useState(0);
  const [result, setResult] = useState<Data | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const runNow = async () => {
    try { const r = await authedPost<{ slot: string }>("/hot-issues/run"); setNotice(`${r.slot.slice(5, 16).replace("T", " ")}판 작성을 시작했습니다. 3~5분 뒤 새로고침하세요.`); }
    catch (e) { setNotice(e instanceof Error ? e.message : "실행하지 못했습니다."); }
  };
  useEffect(() => {
    let alive = true, pending = false;
    const load = async () => {
      if (pending) return; pending = true;
      try { const data = await authedGet<Data>(`/hot-issues/stats?days=${days}`); if (alive) { setResult(data); setError(""); } }
      catch (e) { if (alive) { if (e instanceof AdminAuthError) navigate("/admin"); else setError(e instanceof Error ? e.message : "핫이슈 통계를 불러오지 못했습니다."); } }
      finally { pending = false; }
    };
    void load(); const stop = startVisibilityAwareInterval(() => void load(), 30_000);
    return () => { alive = false; stop(); };
  }, [days, revision]);
  const data = result?.days === days ? result : null;
  const entries = data ? data.actions.filter(a => a.action.startsWith("entry:")) : [];
  const published = data ? data.editions.filter(e => e.published).length : 0;
  return <section className="admin-panel ars-panel" aria-label="오늘의 핫이슈 분석">
    <header className="ars-head"><div><small>HOT ISSUES / 07:00 · 13:00 · 22:00</small><h2>오늘의 핫이슈 · 발행과 조회 로그</h2><p>판별 발행 상태, 페이지 조회·세션, 진입 경로(상단 버튼/메뉴)와 기사별 동작을 따로 집계합니다.</p></div>
      <div className="ars-controls"><label>기간<select value={days} onChange={e => setDays(Number(e.target.value))}>{[1, 7, 30].map(n => <option key={n} value={n}>최근 {n}일</option>)}</select></label><button type="button" onClick={() => refresh(n => n + 1)}>새로고침</button><button type="button" onClick={() => void runNow()}>지금 판 생성</button><a href="/hot-issues" target="_blank" rel="noopener">페이지 열기 ↗</a></div></header>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}{!data && !error && <p role="status">통계 불러오는 중…</p>}
    {data && <>
      <div className="ars-metrics">{[["페이지 조회", data.views], ["방문 세션", data.sessions], ["상단 버튼 진입", entries.find(a => a.action === "entry:header")?.count ?? 0], ["메뉴 진입", entries.find(a => a.action === "entry:menu")?.count ?? 0], [`발행된 판 (${data.editions.length}개 중)`, published]].map(([name, value]) => <article key={String(name)}><small>{name}</small><strong>{Number(value).toLocaleString("ko-KR")}</strong></article>)}</div>
      <p className="ars-note">봇 제외 · 한국시간 기준. 진입 경로는 클릭 기록이라 주소를 직접 입력하거나 검색으로 들어온 조회는 '페이지 조회'에만 잡힙니다.</p>
      <div className="ars-table"><table><caption>판별 발행 로그 (최근 {Math.min(days, 14)}일)</caption><thead><tr><th>판</th><th>상태</th><th>기사</th><th>출처</th><th>사진/영상</th><th>작성</th><th>헤드라인</th></tr></thead>
        <tbody>{data.editions.map(e => <tr key={e.slot}><th>{e.slot.slice(5, 10).replace("-", ".")} {e.slot.slice(11, 16)}</th><td>{e.published ? "발행" : "미발행"}</td><td>{e.stories || "—"}</td><td>{e.sources || "—"}</td><td>{e.published ? `${e.images}/${e.videos}` : "—"}</td><td>{e.generated_at ? kst(e.generated_at) : "—"}</td><td>{e.headline ?? ""}</td></tr>)}</tbody></table></div>
      <details className="ars-recent" open><summary>서버 작성 실행 로그 {data.runs.length}건 · 매일 06:35 / 12:35 / 21:35 자동 시작</summary><div className="ars-table"><table><thead><tr><th>한국시간</th><th>판</th><th>이벤트</th><th>실행</th><th>내용</th></tr></thead>
        <tbody>{data.runs.map((r, i) => <tr key={i}><td>{r.at ? kst(r.at) : "—"}</td><td>{r.slot ? `${r.slot.slice(5, 10).replace("-", ".")} ${r.slot.slice(11, 16)}` : "—"}</td><td>{EVENT[r.event] ?? r.event}</td><td>{TRIGGER[r.trigger ?? ""] ?? r.trigger ?? "—"}</td><td style={{ maxWidth: 420, whiteSpace: "normal", wordBreak: "break-all" }}>{r.detail ?? ""}</td></tr>)}</tbody></table>{!data.runs.length && <p>아직 실행 기록이 없습니다.</p>}</div></details>
      <div className="ars-split">
        <div className="ars-table"><table><caption>일별 추이</caption><thead><tr><th>날짜</th><th>조회</th><th>세션</th><th>동작</th></tr></thead><tbody>{data.trend.map(r => <tr key={r.day}><th>{r.day}</th><td>{r.views}</td><td>{r.sessions}</td><td>{r.actions}</td></tr>)}</tbody></table>{!data.trend.length && <p>선택 기간에 기록이 없습니다.</p>}</div>
        <div className="ars-table"><table><caption>동작별 집계</caption><thead><tr><th>동작</th><th>횟수</th><th>세션</th></tr></thead><tbody>{data.actions.map(r => <tr key={r.action}><th>{actionLabel(r.action)}</th><td>{r.count}</td><td>{r.sessions}</td></tr>)}</tbody></table>{!data.actions.length && <p>동작 기록이 없습니다.</p>}</div>
      </div>
      <details className="ars-recent"><summary>최근 로그 {data.recent.length}건</summary><div className="ars-table"><table><thead><tr><th>한국시간</th><th>페이지</th><th>동작</th><th>내용</th></tr></thead><tbody>{data.recent.map((r, i) => <tr key={i}><td>{kst(r.at)}</td><td>{r.path}</td><td>{actionLabel(r.action)}</td><td>{r.label ?? "—"}</td></tr>)}</tbody></table></div></details>
    </>}
  </section>;
}
