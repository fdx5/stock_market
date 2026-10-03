import { useEffect, useState } from "react";
import { AdminAuthError, clearStoredSession, getStoredSession, fetchSupportLog, fetchSupportLogDetail,
  SupportLogOverview, SupportLogSession, SupportLogDetail } from "../adminApi";
import { Link, navigate } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import "./adminSupportLog.css";

const clock = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
const duration = (seconds: number) => `${Math.floor(Math.round(seconds) / 60)}분 ${Math.round(seconds) % 60}초`;
function failure(error: unknown) {
  if (error instanceof AdminAuthError) { clearStoredSession(); navigate("/admin"); }
}

export default function AdminSupportLogPage() {
  useDocumentTitle("후원 페이지 접속 로그 · 관리자");
  const [hours, setHours] = useState(24);
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<SupportLogOverview | null>(null);
  const [selected, setSelected] = useState<SupportLogSession | null>(null);
  const [detail, setDetail] = useState<SupportLogDetail | null>(null);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!getStoredSession()) { navigate("/admin"); return; }
    let live = true;
    setLoading(true); setData(null); setError(""); setSelected(null); setDetail(null);
    fetchSupportLog(hours, offset).then(result => { if (live) setData(result); })
      .catch(e => { if (live) { failure(e); setError("접속 로그를 불러오지 못했습니다. 다시 시도해 주세요."); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [hours, offset, refresh]);
  useEffect(() => {
    if (!selected) return;
    let live = true;
    setDetail(null); setDetailError("");
    fetchSupportLogDetail(hours, selected.session_id).then(result => { if (live) setDetail(result); })
      .catch(e => { if (live) { failure(e); setDetailError("상세 기록을 불러오지 못했습니다."); } });
    return () => { live = false; };
  }, [hours, selected]);
  return <main className="asl-page">
    <header className="asl-header"><div><Link to="/admin/dashboard">← 관리자 대시보드</Link>
      <h1>☕ 후원 페이지 접속 로그</h1><p>세션별 방문과 클릭 기록 · 한국 시각(KST)</p></div>
      <button onClick={() => setRefresh(n => n + 1)} disabled={loading}>새로고침</button></header>
    <div className="asl-ranges" aria-label="조회 기간">{([[24,"24시간"],[48,"48시간"],[72,"3일"],[168,"7일"]] as const).map(([n,label]) =>
      <button key={n} aria-pressed={hours === n} onClick={() => { setHours(n); setOffset(0); setData(null); }} disabled={loading}>{label}</button>)}</div>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">접속 기록을 불러오는 중입니다…</p>}
    {data && !loading && <>
      <p className="asl-period">{clock(data.since)} ~ {clock(data.until)}</p>
      <div className="asl-stats">{[
        ["접속 세션",data.summary.sessions.toLocaleString()], ["페이지 방문",data.summary.views.toLocaleString()],
        ["전체 클릭",data.summary.clicks.toLocaleString()], ["카카오페이 링크 클릭",data.summary.pay_clicks.toLocaleString()],
        ["측정된 화면 체류",duration(data.summary.seconds)],
      ].map(([label,value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <p className="asl-note">화면 체류는 후원 페이지가 보인 시간만 합산합니다. 과거 기록은 체류 시간이 미측정일 수 있습니다. 카카오페이 링크 클릭은 결제 완료를 뜻하지 않습니다.</p>
      <div className="asl-columns">
        <section className="asl-panel" aria-label="접속 세션 목록"><h2>접속 세션 <small>{data.total.toLocaleString()}개</small></h2>
          {!data.items.length && <p>선택한 기간에 접속 기록이 없습니다.</p>}
          <div className="asl-sessions">{data.items.map(row => <button key={row.session_id} className={selected?.session_id === row.session_id ? "is-selected" : ""}
            onClick={() => setSelected(row)} aria-pressed={selected?.session_id === row.session_id}>
            <strong>{clock(row.first_seen)}</strong><code>{row.session_id.slice(0,8)}</code>
            <span>{row.device || "기기 미확인"} · {row.browser || "브라우저 미확인"}</span>
            <span>방문 {row.views} · 클릭 {row.clicks} · 결제 링크 {row.pay_clicks}</span>
            <span>화면 체류 {row.dwell_samples ? duration(row.seconds) : "미측정"}</span>
          </button>)}</div>
          <nav className="asl-pagination" aria-label="세션 목록 페이지">
            <button disabled={!offset} onClick={() => setOffset(n => Math.max(0,n-50))}>이전</button>
            <span>{Math.floor(offset/50)+1} / {Math.max(1,Math.ceil(data.total/50))}</span>
            <button disabled={offset+50 >= data.total} onClick={() => setOffset(n => n+50)}>다음</button>
          </nav>
        </section>
        <section className="asl-panel asl-detail" aria-label="세션 상세"><h2>세션 상세</h2>
          {!selected ? <p>접속 세션을 선택하면 시간순 행동 내역을 볼 수 있습니다.</p> : <>
            <code className="asl-id">{selected.session_id}</code>
            <dl><dt>첫 기록</dt><dd>{clock(selected.first_seen)}</dd><dt>마지막 기록</dt><dd>{clock(selected.last_seen)}</dd>
              <dt>측정된 화면 체류</dt><dd>{selected.dwell_samples ? duration(selected.seconds) : "미측정"}</dd>
              <dt>접속 환경</dt><dd>{[selected.device,selected.os,selected.browser].filter(Boolean).join(" · ") || "미확인"}</dd>
              <dt>유입 경로</dt><dd>{selected.source || "직접 / 미확인"}</dd></dl>
            <h3>방문·클릭 타임라인</h3>
            {detailError && <p role="alert">{detailError}</p>}
            {!detail && !detailError && <p role="status">상세 기록을 불러오는 중입니다…</p>}
            {detail && <><ol className="asl-timeline">{detail.events.map((event,index) => <li key={index}>
              <time>{clock(event.created_at)}</time><strong>{event.type === "page_view" ? "후원 페이지 방문" : "클릭"}</strong>
              <span>{event.object_key === "support-pay" ? "카카오페이 후원 버튼" : event.object_key === "support-qr" ? "카카오페이 QR 링크" : event.label || "이름 없는 항목"}</span>
            </li>)}</ol>{!detail.events.length && <p>이 기간에 방문·클릭 내역이 없습니다.</p>}
              {detail.truncated && <p>기록이 많아 첫 500개를 표시합니다.</p>}</>}
          </>}
        </section>
      </div>
    </>}
  </main>;
}
