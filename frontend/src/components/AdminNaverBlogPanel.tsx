import { useEffect, useMemo, useState } from "react";
import { adminApi, type NaverSocialReport } from "../adminApi";

const STATUS_KO: Record<string, string> = {
  published: "게시", pending: "대기", publishing: "게시 중", failed: "실패", skipped: "건너뜀",
};
const KIND_KO: Record<string, string> = { hot: "핫이슈", heatmap: "히트맵", world: "세계 증시", movers: "급등락 이유" };

/** 네이버 블로그 자동 게시: PC 발행기 상태, 최근 게시글, 유입 성과와 튜닝 학습 결과. */
export default function AdminNaverBlogPanel() {
  const [data, setData] = useState<NaverSocialReport | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const load = () => adminApi.naverBlogSocial(7).then(v => { setData(v); setError(""); })
      .catch(e => setError(e instanceof Error ? e.message : "불러오지 못했습니다"));
    load();
    const t = window.setInterval(() => { if (!document.hidden) load(); }, 120_000);
    return () => window.clearInterval(t);
  }, []);
  const recentInflow = useMemo(() => {
    const rows = data?.inflow ?? [];
    const last7 = rows.slice(-7);
    return last7.length ? last7.reduce((a, r) => a + r.sessions, 0) / 7 : 0;
  }, [data]);
  if (error) return <section className="ot-group"><header><h3>네이버 블로그 성과</h3></header><p className="ot-error">{error}</p></section>;
  if (!data) return <section className="ot-group"><header><h3>네이버 블로그 성과</h3></header><p className="ot-empty">불러오는 중…</p></section>;
  const seen = data.worker ? new Date(data.worker.seen_at) : null;
  const fresh = seen ? Date.now() - seen.getTime() < 25 * 60_000 : false;
  const multiple = data.baseline_sessions_per_day ? recentInflow / data.baseline_sessions_per_day : 0;
  return <section className="ot-group nb-panel">
    <header><h3>네이버 블로그 성과</h3><small>블로그 링크로 들어온 방문 · 검색 노출 · 제목/태그 변형 학습</small>
      <span className={`ot-chip is-${fresh ? "ok" : "bad"}`}>{fresh ? "PC 발행기 정상" : "PC 발행기 응답 없음"}</span></header>
    <div className="ot-summary">
      <div><b>{seen ? seen.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "-"}</b><span>발행기 마지막 응답</span></div>
      <div className="is-ok"><b>{recentInflow.toFixed(1)}</b><span>최근 7일 하루 평균 유입 세션</span></div>
      <div><b>{data.baseline_sessions_per_day}</b><span>도입 전 하루 평균</span></div>
      <div className={multiple >= 100 ? "is-ok" : ""}><b>{multiple ? `${multiple.toFixed(1)}배` : "-"}</b><span>목표 100배({data.target_sessions_per_day}/일)</span></div>
    </div>
    <h4>최근 게시글</h4>
    <div className="nb-table-wrap"><table className="nb-table">
      <thead><tr><th>날짜</th><th>판</th><th>상태</th><th>제목</th><th>변형</th><th>유입</th><th>검색순위</th><th>공감</th></tr></thead>
      <tbody>{data.posts.map(p => <tr key={p.post_key}>
        <td>{p.day.slice(5)}</td><td>{p.kind || p.edition}</td>
        <td><span className={`ot-chip is-${p.status === "published" ? "ok" : p.status === "failed" || p.status === "skipped" ? "bad" : "wait"}`}>{STATUS_KO[p.status] ?? p.status}</span>
          {p.status === "published" && p.category_seen !== null && p.category_seen !== p.category_no && <small> 카테고리 {p.category_seen}</small>}</td>
        <td>{p.post_url ? <a href={p.post_url} target="_blank" rel="noopener noreferrer">{p.title}</a> : <small>{(p.last_error ?? "").slice(0, 80)}</small>}</td>
        <td>{p.variant ?? "-"}</td><td>{p.visits_live ?? p.visits ?? "-"}</td><td>{p.search_rank ?? "-"}</td><td>{p.likes ?? "-"}</td>
      </tr>)}</tbody>
    </table></div>
    <h4>변형별 성과 (보상 = 유입 + 검색 10위 내 3점)</h4>
    <div className="nb-arms">{Object.entries(data.arms).map(([kind, arms]) => <div key={kind}>
      <b>{KIND_KO[kind] ?? kind}</b>
      {Object.keys(arms).length === 0 ? <small>측정 대기 (게시 다음 날 23:30부터)</small> :
        <ul>{Object.entries(arms).sort((a, b) => b[1].mean - a[1].mean).map(([arm, v]) =>
          <li key={arm}><code>{arm}</code> 평균 {v.mean} · {v.n}건<small>{v.best_title}</small></li>)}</ul>}
    </div>)}</div>
    {data.runs.length > 0 && <div className="ot-runs"><h4>발행 기록</h4><ul>{data.runs.slice(0, 12).map((r, i) => <li key={i}>
      <time>{r.at.slice(5, 16).replace("T", " ")}</time><span>{r.post_key.split(":")[1]}</span>
      <span className={`ot-chip is-${r.event === "published" ? "ok" : r.event === "skipped" ? "off" : "bad"}`}>{r.event}</span>
      <small>{r.detail.slice(0, 120)}</small></li>)}</ul></div>}
  </section>;
}
