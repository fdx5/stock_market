import { useEffect, useState } from "react";
import { adminApi, type TistoryDraft, type TistoryStatus } from "../adminApi";
import "./adminOpsTimeline.css";

const kstDay = (offset: number) => new Date(Date.now() + (9 - 24 * offset) * 3_600_000).toISOString().slice(0, 10);
const STATE = {
  published: ["공개 확인", "ok"],
  ready: ["원고 준비", "run"],
  scheduled: ["예정", "wait"],
  waiting: ["원본 대기", "warn"],
  error: ["준비 오류", "bad"],
} satisfies Record<TistoryStatus["jobs"][number]["state"], [string, string]>;

export default function AdminTistoryPanel() {
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<TistoryStatus | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState<TistoryDraft | null>(null);
  const [draftError, setDraftError] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let active = true;
    const load = () => {
      adminApi.tistoryStatus(kstDay(offset)).then(result => {
        if (active) { setData(result); setError(""); }
      }).catch(err => {
        if (active) setError(err instanceof Error ? err.message : "티스토리 상태를 불러오지 못했습니다.");
      });
    };
    load();
    const interval = window.setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [offset, refresh]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    adminApi.tistoryDraft(selected).then(result => {
      if (active) setDraft(result);
    }).catch(err => {
      if (active) setDraftError(err instanceof Error ? err.message : "원고를 불러오지 못했습니다.");
    });
    return () => { active = false; };
  }, [selected]);

  function selectDay(day: number) {
    if (day === offset) return;
    setData(null);
    setOffset(day);
    setSelected("");
    setError("");
  }

  function openDraft(key: string) {
    if (selected === key) return;
    setSelected(key);
    setDraft(null);
    setDraftError("");
    setCopied("");
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(`${label} 복사 완료`);
    } catch {
      setCopied("입력란의 내용을 직접 선택해 복사해 주세요.");
    }
  }

  return <div className="ot">
    <header className="ot-head">
      <div>
        <h2>티스토리</h2>
        <p>서버가 시각별 원고를 준비하고 공개 RSS로 게시 결과를 확인합니다.</p>
      </div>
      <div className="ot-head-tools">
        <div className="ot-days" aria-label="원고 날짜">
          <button type="button" aria-pressed={offset === 1} onClick={() => selectDay(1)}>어제</button>
          <button type="button" aria-pressed={offset === 0} onClick={() => selectDay(0)}>오늘</button>
        </div>
        <button type="button" className="ot-btn" onClick={() => setRefresh(value => value + 1)}>새로고침</button>
      </div>
    </header>
    {error && <p className="ot-error">{error}</p>}
    {!data && !error && <p className="ot-empty">불러오는 중…</p>}
    {data && <>
      <section className="ot-group">
        <header>
          <h3>{data.day} 발행 준비</h3>
          <span className="ot-chip is-off">자동 발행 API 종료</span>
        </header>
        <p className="ot-msg">
          원고 작성 {data.last_tick ? data.last_tick.slice(5, 16).replace("T", " ") : "기록 대기"}
          {" · "}공개 RSS {data.feed_ok === true ? `확인 ${data.feed_checked_at?.slice(11, 16) ?? ""}` : data.feed_ok === false ? "확인 실패" : "확인 대기"}
        </p>
        <p className="ot-msg">
          <a className="ot-link" href={data.blog} target="_blank" rel="noreferrer">블로그</a>
          {" · "}<a className="ot-link" href={data.api_notice} target="_blank" rel="noreferrer">API 종료 공지</a>
        </p>
        <ol>{data.jobs.map(job => {
          const [label, tone] = STATE[job.state];
          return <li key={job.key}>
            <time>{job.key === "intro" ? "소개" : job.at}</time>
            <div className="ot-job"><b>{job.title ?? job.label}</b><span>{job.category}</span></div>
            <div className="ot-job-tools">
              <span className={`ot-chip is-${tone}`}>{label}</span>
              {job.prepared_at && <button type="button" className="ot-btn" aria-pressed={selected === job.key}
                onClick={() => openDraft(job.key)}>원고 보기</button>}
              {job.published_url && <a className="ot-link" href={job.published_url} target="_blank" rel="noreferrer">게시물</a>}
            </div>
          </li>;
        })}</ol>
      </section>
      {selected && <section className="ot-group ot-tistory-draft">
        <header>
          <h3>티스토리 원고</h3>
          <a className="ot-link" href={data.editor} target="_blank" rel="noreferrer">티스토리 편집기 열기</a>
        </header>
        {draftError && <p className="ot-error">{draftError}</p>}
        {!draft && !draftError && <p className="ot-empty">원고를 불러오는 중…</p>}
        {draft && <>
          <label>제목<input readOnly value={draft.title} /></label>
          <p className="ot-msg">카테고리 {draft.category} · 편집기의 HTML 모드에 본문을 붙여넣을 수 있습니다.</p>
          <label>본문 HTML<textarea readOnly rows={12} value={draft.html} spellCheck={false} /></label>
          <div className="ot-job-tools">
            <button type="button" className="ot-btn" onClick={() => void copy(draft.title, "제목")}>제목 복사</button>
            <button type="button" className="ot-btn" onClick={() => void copy(draft.html, "본문 HTML")}>본문 HTML 복사</button>
            <span className="ot-msg" role="status">{copied}</span>
          </div>
        </>}
      </section>}
    </>}
  </div>;
}
