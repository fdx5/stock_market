import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi, type OpsJob, type OpsStatus, type OpsTimeline } from "../adminApi";
import "./adminOpsTimeline.css";
import AdminNaverBlogPanel from "./AdminNaverBlogPanel";

const STATUS: Record<OpsStatus, { label: string; tone: string }> = {
  ok: { label: "성공", tone: "ok" }, failed: { label: "실패", tone: "bad" }, missed: { label: "미실행", tone: "bad" },
  running: { label: "진행 중", tone: "run" }, pending: { label: "예정", tone: "wait" }, off: { label: "쉼", tone: "off" },
  unknown: { label: "확인 불가", tone: "warn" },
};
const kstDay = (offset = 0) => new Date(Date.now() + 9 * 3600_000 - offset * 86_400_000).toISOString().slice(0, 10);
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function Chip({ status }: { status: OpsStatus }) {
  const s = STATUS[status];
  return <span className={`ot-chip is-${s.tone}`}>{s.label}</span>;
}

function ActionButton({ job, onDone }: { job: OpsJob; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  if (!job.action) return null;
  const label = job.action.startsWith("kakao") ? "지금 발송" : "다시 실행";
  const run = () => {
    if (!window.confirm(`${job.name} — ${label}할까요?`)) return;
    setBusy(true); setMsg("");
    const call = job.action === "dram" ? adminApi.runDramPriceBatch()
      : job.action === "kakao:visitors" ? adminApi.runKakaoVisitorNotify()
      : job.action?.startsWith("prediction:") ? adminApi.runPrediction(job.action.split(":")[1] as "KR" | "US")
      : Promise.reject(new Error("지원하지 않는 작업"));
    call.then(() => { setMsg("요청했습니다"); onDone(); }).catch(e => setMsg(e instanceof Error ? e.message : "실패")).finally(() => setBusy(false));
  };
  return <><button type="button" className="ot-btn" onClick={run} disabled={busy}>{busy ? "요청 중…" : label}</button>{msg && <small className="ot-msg">{msg}</small>}</>;
}

/** 운영 타임테이블: one day of every scheduled job by service — what ran, what failed, what is next. */
export default function AdminOpsTimeline() {
  const [day, setDay] = useState(kstDay());
  const [data, setData] = useState<OpsTimeline | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    adminApi.opsTimeline(day).then(v => { setData(v); setError(""); })
      .catch(e => setError(e instanceof Error ? e.message : "불러오지 못했습니다")).finally(() => setLoading(false));
  }, [day]);
  useEffect(() => {
    load();
    const t = window.setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  const problems = useMemo(() => (data?.jobs ?? []).filter(j => j.status === "failed" || j.status === "missed"), [data]);
  const today = day === kstDay();
  const nowMin = data && today ? minutes(data.now.slice(11, 16)) : null;

  return <div className="ot">
    <header className="ot-head">
      <div>
        <h2>운영 타임테이블</h2>
        <p>모든 자동 작업을 시간순으로 모았습니다. 실패나 미실행은 빨간색으로 표시됩니다.</p>
      </div>
      <div className="ot-head-tools">
        <div className="ot-days" role="tablist" aria-label="날짜">
          <button type="button" aria-pressed={day === kstDay(1)} onClick={() => setDay(kstDay(1))}>어제</button>
          <button type="button" aria-pressed={today} onClick={() => setDay(kstDay())}>오늘</button>
        </div>
        <button type="button" className="ot-btn" onClick={load} disabled={loading}>{loading ? "갱신 중…" : "새로고침"}</button>
      </div>
    </header>
    {error && <p className="ot-error">{error}</p>}
    {!data ? <p className="ot-empty">불러오는 중…</p> : <>
      <div className="ot-summary">
        <div className="is-ok"><b>{data.counts.ok}</b><span>성공</span></div>
        <div className={problems.length ? "is-bad" : ""}><b>{problems.length}</b><span>실패·미실행</span></div>
        <div className="is-run"><b>{data.counts.running}</b><span>진행 중</span></div>
        <div><b>{data.counts.pending}</b><span>예정</span></div>
        <div className="is-off"><b>{data.counts.off + data.counts.unknown}</b><span>쉼·확인 불가</span></div>
      </div>

      {problems.length > 0 && <section className="ot-alert" aria-label="확인 필요">
        <h3>확인이 필요한 작업 {problems.length}건</h3>
        <ul>{problems.map(j => <li key={j.id}><time>{j.at}</time><b>{j.name}</b><span>{j.detail}</span><ActionButton job={j} onDone={load} /></li>)}</ul>
      </section>}

      <section className="ot-board" aria-label="24시간 타임테이블">
        <div className="ot-board-inner">
          <div className="ot-ruler"><span />{[0, 3, 6, 9, 12, 15, 18, 21, 24].map(h => <i key={h} style={{ left: `${h / 24 * 100}%` }}>{String(h).padStart(2, "0")}</i>)}</div>
          {data.groups.map(g => {
            const jobs = data.jobs.filter(j => j.group === g.key);
            return <div className="ot-row" key={g.key}>
              <div className="ot-row-label"><b>{g.label}</b><small>{jobs.filter(j => j.status === "ok").length}/{jobs.filter(j => j.status !== "off").length}</small></div>
              <div className="ot-track">
                {nowMin !== null && <span className="ot-now" style={{ left: `${nowMin / 1440 * 100}%` }} />}
                {jobs.map(j => <a key={j.id} href={`#ot-${j.id}`} className={`ot-dot is-${STATUS[j.status].tone}`} style={{ left: `${minutes(j.at) / 1440 * 100}%` }}
                  title={`${j.at} ${j.name} · ${STATUS[j.status].label}\n${j.detail}`}><span className="sr-only">{j.at} {j.name} {STATUS[j.status].label}</span></a>)}
              </div>
            </div>;
          })}
        </div>
        <p className="ot-legend">{(["ok", "failed", "running", "pending", "off"] as OpsStatus[]).map(s => <span key={s}><i className={`ot-dot is-${STATUS[s].tone}`} />{s === "failed" ? "실패·미실행" : STATUS[s].label}</span>)}</p>
      </section>

      <div className="ot-groups">
        {data.groups.map(g => {
          const jobs = data.jobs.filter(j => j.group === g.key);
          const bad = jobs.filter(j => j.status === "failed" || j.status === "missed").length;
          return <section key={g.key} className={`ot-group${bad ? " has-bad" : ""}`}>
            <header><h3>{g.label}</h3><small>{g.hint}</small>{bad > 0 && <span className="ot-chip is-bad">문제 {bad}</span>}</header>
            <ol>{jobs.map(j => <li key={j.id} id={`ot-${j.id}`} className={`is-${STATUS[j.status].tone}`}>
              <time>{j.at}</time>
              <div className="ot-job"><b>{j.name}</b><span>{j.detail}</span></div>
              <div className="ot-job-tools"><Chip status={j.status} />
                {j.link && <a className="ot-link" href={j.link} target="_blank" rel="noopener noreferrer">열기</a>}
                <ActionButton job={j} onDone={load} /></div>
            </li>)}</ol>
            {g.key === "sns" && data.github_runs.length > 0 && <div className="ot-runs">
              <h4>게시 실행 기록 (GitHub Actions)</h4>
              <ul>{data.github_runs.slice(0, 8).map(r => <li key={r.id}>
                <time>{r.at.slice(5, 16).replace("T", " ")}</time>
                <span>{r.event === "schedule" ? "자동" : r.event === "workflow_dispatch" ? "수동·서버" : r.event}</span>
                <span className={`ot-chip is-${r.status !== "completed" ? "run" : r.conclusion === "success" ? "ok" : r.conclusion === "skipped" || r.conclusion === "cancelled" ? "off" : "bad"}`}>
                  {r.status !== "completed" ? "진행 중" : r.conclusion === "success" ? "성공" : r.conclusion === "failure" ? "실패" : r.conclusion === "cancelled" ? "취소" : r.conclusion === "skipped" ? "건너뜀" : r.conclusion ?? "?"}</span>
                <a className="ot-link" href={r.url} target="_blank" rel="noopener noreferrer">로그</a>
              </li>)}</ul>
            </div>}
          </section>;
        })}
        <AdminNaverBlogPanel />
      </div>
    </>}
  </div>;
}
