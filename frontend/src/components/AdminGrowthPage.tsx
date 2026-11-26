import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminAuthError,
  GrowthChannel,
  GrowthControl,
  GrowthLedgerRow,
  GrowthRankRow,
  adminApi,
  clearStoredSession,
  getStoredSession,
} from "../adminApi";
import { Link, navigate } from "../router";
import { useDocumentTitle } from "../useDocumentTitle";
import TrafficTab from "./AdminGrowthTraffic";
import InsightCard from "./AdminGrowthInsight";
import "./adminGrowthControl.css";

/* ──────────────────────────────────────────────────────────────────────────
   방문자 100배 성장 관제실

   Every growth figure on this page is a *verified* session: declared crawlers and
   disguised automation cohorts are taken out on the server (growth_control.py) and
   reported on their own tab, never mixed in. The multiplier is the trailing
   7-closed-day average over a confirmed goal baseline — not a partial day.
   ────────────────────────────────────────────────────────────────────────── */

const nf = new Intl.NumberFormat("ko-KR");
const n0 = (v: number | null | undefined) => (v == null ? "—" : nf.format(Math.round(v)));
const signed = (v: number | null | undefined, unit = "%", digits = 1) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}${unit}`;
const kstDate = (daysAgo = 0) => new Date(Date.now() + 9 * 3_600_000 - daysAgo * 86_400_000).toISOString().slice(0, 10);
const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];
const CHANNELS: GrowthChannel[] = ["search", "social", "referral", "email", "direct"];
const CH_LABEL: Record<GrowthChannel, string> = { search: "검색", social: "소셜·커뮤니티", referral: "외부 링크", email: "메일·알림", direct: "직접·미식별" };
const CH_COLOR: Record<GrowthChannel, string> = {
  search: "var(--gc-blue)", social: "var(--gc-pink)", referral: "var(--gc-amber)", email: "var(--gc-violet)", direct: "var(--gc-muted)",
};
const RANGES = [7, 14, 30, 90, 180, 365, 730];
const TABS = [
  ["overview", "관제 개요"], ["traffic", "유입 출처(UTM)"], ["ledger", "일별 원장"], ["channels", "유입·채널"], ["landings", "랜딩·콘텐츠"],
  ["actions", "조치·실험"], ["automation", "봇·자동화"], ["trust", "신뢰도 진단"],
] as const;
type Tab = (typeof TABS)[number][0];
const FLAG_LABEL: Record<string, string> = {
  live: "진행 중", unverified: "미검증", zero: "0건", spike: "급증", drop: "급감", automation_heavy: "자동화 다수",
};
const SIGNAL_LABEL: Record<string, string> = {
  sitemap_walk_cohort: "사이트맵 순회 묶음", repeat_single_page_cohort: "같은 페이지 반복·1페이지 이탈 묶음", outdated_chrome: "구버전 Chrome", outdated_firefox: "구버전 Firefox",
  outdated_safari: "구버전 Safari", server_linux: "서버형 Linux", non_browser_format: "비브라우저 형식", no_agent: "UA 없음",
};
const SEV_LABEL = { critical: "긴급", warning: "주의", good: "양호", info: "참고" } as const;

function weekdayIdx(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/* ── charts ─────────────────────────────────────────────────────────────── */

function TrendChart({ data, logScale, showExcluded }: { data: GrowthControl; logScale: boolean; showExcluded: boolean }) {
  const rows = data.ledger;
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000, H = 300, L = 48, R = 10, T = 12, B = 26;
  const baseline = data.goal.baseline;
  const top = Math.max(1, ...rows.map((r) => r.sessions + (showExcluded ? r.suspected_sessions ?? 0 : 0)), ...rows.map((r) => r.ma7 ?? 0));
  const milestoneLines = (baseline ? [1, 2, 5, 10, 25, 50, 100].map((m) => ({ m, v: baseline * m })) : []).filter((x) => x.v <= top * 1.6);
  const yMax = Math.max(top, ...milestoneLines.map((x) => x.v)) * 1.08;
  const y = (v: number) => {
    const t = logScale ? Math.log10(Math.max(0, v) + 1) / Math.log10(yMax + 1) : v / yMax;
    return T + (1 - t) * (H - T - B);
  };
  const step = (W - L - R) / Math.max(1, rows.length);
  const x = (i: number) => L + i * step + step / 2;
  const bw = Math.max(1.5, Math.min(26, step * 0.66));
  const ma = rows.map((r, i) => (r.ma7 == null ? null : `${x(i)},${y(r.ma7)}`)).filter(Boolean).join(" ");
  const ticks = (logScale ? [1, 10, 100, 1000, 10000, 100000] : [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(yMax * t))).filter((v) => v <= yMax);
  const labelEvery = Math.max(1, Math.ceil(rows.length / 8));
  const actionsByDay = new Map<string, number>();
  data.actions.forEach((a) => actionsByDay.set(a.day, (actionsByDay.get(a.day) ?? 0) + 1));
  const hovered = hover != null ? rows[hover] : null;

  return (
    <div className="gc-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="일별 검증 세션과 7일 평균"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          setHover(Math.min(rows.length - 1, Math.max(0, Math.floor((px - L) / step))));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="gc-grid" />
            <text x={L - 6} y={y(v) + 3} className="gc-axis" textAnchor="end">{v >= 1000 ? `${v / 1000}k` : v}</text>
          </g>
        ))}
        {milestoneLines.map(({ m, v }) => (
          <g key={m}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={m === 1 ? "gc-base-line" : "gc-mile-line"} />
            <text x={W - R - 4} y={y(v) - 3} className="gc-mile-text" textAnchor="end">{m === 1 ? "기준선" : `${m}×`}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const flags = r.flags;
          const ex = showExcluded ? r.suspected_sessions ?? 0 : 0;
          return (
            <g key={r.date}>
              {hover === i && <rect x={x(i) - step / 2} y={T} width={step} height={H - T - B} className="gc-hover-band" />}
              {ex > 0 && <rect x={x(i) - bw / 2} y={y(r.sessions + ex)} width={bw} height={Math.max(0, y(r.sessions) - y(r.sessions + ex))} className="gc-bar-excluded" />}
              <rect
                x={x(i) - bw / 2}
                y={y(r.sessions)}
                width={bw}
                height={Math.max(0, H - B - y(r.sessions))}
                className={`gc-bar${r.live ? " is-live" : ""}${!r.verified && !r.live ? " is-unverified" : ""}`}
              />
              {(flags.includes("spike") || flags.includes("drop")) && (
                <circle cx={x(i)} cy={T + 5} r={4} className={flags.includes("spike") ? "gc-dot-spike" : "gc-dot-drop"} />
              )}
              {actionsByDay.has(r.date) && (
                <g>
                  <line x1={x(i)} x2={x(i)} y1={T} y2={H - B} className="gc-action-line" />
                  <rect x={x(i) - 7} y={H - B - 14} width={14} height={12} rx={3} className="gc-action-chip" />
                  <text x={x(i)} y={H - B - 5} textAnchor="middle" className="gc-action-text">{actionsByDay.get(r.date)}</text>
                </g>
              )}
              {i % labelEvery === 0 && (
                <text x={x(i)} y={H - 8} textAnchor="middle" className="gc-axis">{r.date.slice(5).replace("-", ".")}</text>
              )}
            </g>
          );
        })}
        {ma && <polyline points={ma} className="gc-ma" />}
      </svg>
      {hovered && hover != null && (
        <div className="gc-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>{hovered.date} ({WEEKDAYS[hovered.weekday]}){hovered.live ? " · 진행 중" : ""}</b>
          <span>검증 세션 <em>{n0(hovered.sessions)}</em></span>
          <span>7일 평균 <em>{n0(hovered.ma7)}</em>{hovered.multiplier != null && <> · {hovered.multiplier.toFixed(2)}×</>}</span>
          {hovered.browsers != null && <span>고유 브라우저 <em>{n0(hovered.browsers)}</em> (신규 {n0(hovered.new_browsers)})</span>}
          <span>전일 {signed(hovered.dod)} · 전주 같은 요일 {signed(hovered.wow)}</span>
          {hovered.verified ? (
            <span className="gc-tip-muted">제외: 자동화 의심 {n0(hovered.suspected_sessions)} · 봇 {n0(hovered.bot_sessions)}</span>
          ) : (
            <span className="gc-tip-muted">미검증 일계(봇 의심 미분리)</span>
          )}
          {hovered.flags.filter((f) => f !== "live").map((f) => <i key={f} className={`gc-flag gc-flag--${f}`}>{FLAG_LABEL[f] ?? f}</i>)}
        </div>
      )}
      <div className="gc-legend">
        <span><i className="gc-sw gc-sw--bar" />검증 세션</span>
        <span><i className="gc-sw gc-sw--ma" />7일 평균</span>
        {showExcluded && <span><i className="gc-sw gc-sw--ex" />자동화 의심(제외분)</span>}
        <span><i className="gc-sw gc-sw--mile" />목표 배수선</span>
        <span><i className="gc-sw gc-sw--action" />조치 기록</span>
        <span><i className="gc-sw gc-sw--spike" />이상치</span>
      </div>
    </div>
  );
}

function ChannelShareChart({ rows }: { rows: GrowthLedgerRow[] }) {
  const W = 1000, H = 200;
  const usable = rows.filter((r) => r.sessions > 0);
  if (usable.length < 2) return <p className="gc-empty">채널 추이를 그리기에 데이터가 부족합니다.</p>;
  const step = W / (usable.length - 1);
  const shares = usable.map((r) => {
    const total = CHANNELS.reduce((s, c) => s + (r.channels[c] ?? 0), 0) || 1;
    return CHANNELS.map((c) => (r.channels[c] ?? 0) / total);
  });
  const layers = CHANNELS.map((c, ci) => {
    const upper = shares.map((s, i) => `${i * step},${H - s.slice(0, ci + 1).reduce((a, b) => a + b, 0) * H}`);
    const lower = shares.map((s, i) => `${i * step},${H - s.slice(0, ci).reduce((a, b) => a + b, 0) * H}`).reverse();
    return <polygon key={c} points={[...upper, ...lower].join(" ")} fill={CH_COLOR[c]} opacity={c === "direct" ? 0.35 : 0.85} />;
  });
  return (
    <div className="gc-share">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="채널별 비중 추이">{layers}</svg>
      <div className="gc-share-axis"><span>{usable[0].date}</span><span>{usable[usable.length - 1].date}</span></div>
    </div>
  );
}

function Heatmap({ grid }: { grid: number[][] }) {
  const max = Math.max(1, ...grid.flat());
  return (
    <div className="gc-heat" role="table" aria-label="요일×시간 평균 검증 세션">
      <div className="gc-heat-row gc-heat-head">
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={h}>{h % 3 === 0 ? h : ""}</span>)}
      </div>
      {grid.map((row, wd) => (
        <div className="gc-heat-row" key={wd}>
          <span>{WEEKDAYS[wd]}</span>
          {row.map((v, h) => (
            <i key={h} title={`${WEEKDAYS[wd]} ${h}시 평균 ${v}세션`} style={{ opacity: 0.08 + (v / max) * 0.92 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Bar({ value, max, color }: { value: number; max: number; color?: string }) {
  return (
    <span className="gc-meter">
      <i style={{ width: `${Math.max(1, (value / Math.max(1, max)) * 100)}%`, background: color }} />
    </span>
  );
}

function RankTable({ rows, cols, keyName }: { rows: GrowthRankRow[]; cols: Array<[string, string]>; keyName: string }) {
  if (!rows.length) return <p className="gc-empty">검증된 데이터가 아직 없습니다.</p>;
  const max = Math.max(1, ...rows.map((r) => r.sessions));
  const total = rows.reduce((s, r) => s + r.sessions, 0) || 1;
  return (
    <div className="gc-table-wrap">
      <table className="gc-table">
        <thead>
          <tr>
            {cols.map(([k, label]) => <th key={k}>{label}</th>)}
            <th className="num">세션</th><th className="num">비중</th><th className="num">이탈률</th><th className="num">PV/세션</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r[keyName]}-${i}`}>
              {cols.map(([k]) => <td key={k} className="gc-cell-key" title={String(r[k] ?? "")}>{String(r[k] ?? "—")}</td>)}
              <td className="num"><Bar value={r.sessions} max={max} />{n0(r.sessions)}</td>
              <td className="num">{((r.sessions / total) * 100).toFixed(1)}%</td>
              <td className={`num${(r.bounce_rate ?? 0) >= 75 ? " is-bad" : ""}`}>{r.bounce_rate == null ? "—" : `${r.bounce_rate.toFixed(0)}%`}</td>
              <td className="num">{r.pages_per_session ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── mission strip ──────────────────────────────────────────────────────── */

function MissionTrack({ data }: { data: GrowthControl }) {
  const mult = data.kpis.multiplier;
  const target = data.goal.target_multiplier || 100;
  const pos = (m: number) => (Math.log(Math.max(1, m)) / Math.log(target)) * 100;
  return (
    <div className="gc-track">
      <div className="gc-track-rail">
        <i className="gc-track-fill" style={{ width: `${Math.min(100, mult ? pos(mult) : 0)}%` }} />
        {[1, ...data.milestones.map((m) => m.multiplier)].map((m) => {
          const ms = data.milestones.find((x) => x.multiplier === m);
          return (
            <span key={m} className={`gc-track-stop${ms?.reached || m === 1 ? " is-reached" : ""}`} style={{ left: `${pos(m)}%` }}>
              <b>{m}×</b>
              <small>{m === 1 ? "기준" : ms?.reached ? `${ms.reached.slice(5)} 달성` : ms?.eta ? `예상 ${ms.eta.slice(2)}` : "—"}</small>
            </span>
          );
        })}
        {mult != null && (
          <span className="gc-track-now" style={{ left: `${Math.min(100, pos(mult))}%` }}>
            <em>현재 {mult.toFixed(2)}×</em>
          </span>
        )}
      </div>
      <p className="gc-track-note">로그 눈금 — 1×→10×와 10×→100×가 같은 거리입니다. 배수 = 최근 7일(마감일) 평균 검증 세션 ÷ 기준선.</p>
    </div>
  );
}

/* ── goal dialog ────────────────────────────────────────────────────────── */

function GoalDialog({ data, onClose, onSaved }: { data: GrowthControl; onClose: () => void; onSaved: () => void }) {
  const opts = data.baseline_options;
  const [method, setMethod] = useState(opts[0]?.method ?? "custom");
  const [custom, setCustom] = useState(String(Math.round(data.goal.baseline ?? 0) || ""));
  const [mult, setMult] = useState(String(data.goal.target_multiplier || 100));
  const [targetDate, setTargetDate] = useState(data.goal.target_date ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const picked = opts.find((o) => o.method === method);
  const value = picked ? picked.value : Number(custom);
  const save = async () => {
    if (!(value > 0)) return setErr("기준선 값을 확인하세요.");
    setBusy(true);
    setErr("");
    try {
      await adminApi.growthGoal({
        baseline: value, method: picked ? picked.method : "custom", baseline_from: picked?.from ?? null, baseline_to: picked?.to ?? null,
        target_multiplier: Number(mult) || 100, target_date: targetDate || null, note: note || null,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="gc-modal" role="dialog" aria-modal="true" aria-label="목표 설정" onClick={onClose}>
      <div className="gc-modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>목표 기준선·목표일 설정</h3>
        <p className="gc-hint">
          새 버전으로 추가되며 이전 설정은 이력으로 남습니다.
          {data.goal.legacy && <> 기존 기준선 {n0(data.goal.legacy.baseline)}명은 {data.goal.legacy.started_at.slice(0, 10)} 시작 시점의 진행 중이던 하루 수치입니다.</>}
        </p>
        <div className="gc-options">
          {opts.map((o) => (
            <label key={o.method} className={method === o.method ? "is-on" : ""}>
              <input type="radio" name="baseline" checked={method === o.method} onChange={() => setMethod(o.method)} />
              <span><b>{o.label}</b><small>{o.from} ~ {o.to}</small></span>
              <em>{n0(o.value)}명/일</em>
            </label>
          ))}
          <label className={method === "custom" ? "is-on" : ""}>
            <input type="radio" name="baseline" checked={method === "custom"} onChange={() => setMethod("custom")} />
            <span><b>직접 입력</b><small>검증 세션 기준 일 평균</small></span>
            <input type="number" min={1} value={custom} onChange={(e) => { setCustom(e.target.value); setMethod("custom"); }} />
          </label>
        </div>
        <div className="gc-form-row">
          <label><span>목표 배수</span><input type="number" min={2} max={10000} value={mult} onChange={(e) => setMult(e.target.value)} /></label>
          <label><span>목표 달성일</span><input type="date" min={kstDate(-1)} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} /></label>
        </div>
        <label className="gc-form-wide"><span>메모</span><input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="기준선을 이렇게 정한 이유" /></label>
        {value > 0 && <p className="gc-hint">목표: 일 {n0(value * (Number(mult) || 100))} 검증 세션 (7일 평균)</p>}
        {err && <p className="gc-error">{err}</p>}
        <div className="gc-modal-actions">
          <button type="button" onClick={onClose}>취소</button>
          <button type="button" className="is-primary" disabled={busy} onClick={save}>{busy ? "저장 중…" : "새 목표 버전 저장"}</button>
        </div>
      </div>
    </div>
  );
}

/* ── tabs ───────────────────────────────────────────────────────────────── */

function OverviewTab({ data, onChanged }: { data: GrowthControl; onChanged: () => void }) {
  const [logScale, setLogScale] = useState(false);
  const [showExcluded, setShowExcluded] = useState(true);
  const maxDelta = Math.max(1, ...data.drivers.map((d) => Math.abs(d.delta)));
  return (
    <>
      <section className="gc-panel">
        <header className="gc-panel-head">
          <div><span className="gc-label">INSIGHTS</span><h2>지금 할 일 — 분석 기반 개선책</h2></div>
          <span className="gc-sub">규칙 기반 진단 · 근거 수치 포함</span>
        </header>
        <div className="gc-insights">
          {data.insights.length ? data.insights.map((it) => (
            <InsightCard key={it.key} it={it} onChanged={onChanged} />
          )) : <p className="gc-empty">진단할 데이터가 아직 충분하지 않습니다.</p>}
        </div>
        {!!data.resolved_insights?.length && (
          <details className="gc-resolved">
            <summary>해결됨 {data.resolved_insights.length}건 — 완료 처리 후 더 이상 진단되지 않는 항목</summary>
            <ul>
              {data.resolved_insights.map((m) => (
                <li key={m.key}><s>{m.title || m.key.split("|")[1]}</s> <em>✓ {m.at.slice(5, 10).replace("-", "/")}</em>{m.note ? ` — ${m.note}` : ""}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <section className="gc-panel">
        <header className="gc-panel-head">
          <div><span className="gc-label">GROWTH VELOCITY</span><h2>날짜별 검증 세션 · 7일 평균 · 목표선</h2></div>
          <div className="gc-toggles">
            <label><input type="checkbox" checked={logScale} onChange={(e) => setLogScale(e.target.checked)} />로그 눈금</label>
            <label><input type="checkbox" checked={showExcluded} onChange={(e) => setShowExcluded(e.target.checked)} />제외분 표시</label>
          </div>
        </header>
        <TrendChart data={data} logScale={logScale} showExcluded={showExcluded} />
      </section>
      <div className="gc-grid2">
        <section className="gc-panel">
          <header className="gc-panel-head">
            <div><span className="gc-label">DRIVERS</span><h2>지난주 대비 성장 기여 (일평균 세션)</h2></div>
          </header>
          {data.drivers.length ? (
            <div className="gc-drivers">
              {data.drivers.map((d) => (
                <div key={d.channel} className="gc-driver">
                  <span><i style={{ background: CH_COLOR[d.channel] }} />{d.label}</span>
                  <div className="gc-driver-axis">
                    <i className={d.delta >= 0 ? "is-up" : "is-down"} style={{ width: `${(Math.abs(d.delta) / maxDelta) * 50}%` }} />
                  </div>
                  <em className={d.delta >= 0 ? "is-up" : "is-down"}>{signed(d.delta, "", 0)}</em>
                  <small>{n0(d.previous)} → {n0(d.current)}</small>
                </div>
              ))}
            </div>
          ) : <p className="gc-empty">최근 14일 중 검증된 날이 부족합니다.</p>}
        </section>
        <section className="gc-panel">
          <header className="gc-panel-head">
            <div><span className="gc-label">ACQUISITION MIX</span><h2>채널 비중 추이 (보정 후)</h2></div>
          </header>
          <ChannelShareChart rows={data.ledger.filter((r) => r.verified)} />
          <div className="gc-legend">
            {CHANNELS.map((c) => <span key={c}><i className="gc-sw" style={{ background: CH_COLOR[c] }} />{CH_LABEL[c]}</span>)}
          </div>
        </section>
      </div>
    </>
  );
}

function LedgerTab({ data }: { data: GrowthControl }) {
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const rows = [...data.ledger].reverse().filter((r) => !onlyFlagged || r.flags.some((f) => f !== "live"));
  const actionsByDay = useMemo(() => {
    const m = new Map<string, string[]>();
    data.actions.forEach((a) => m.set(a.day, [...(m.get(a.day) ?? []), a.title]));
    return m;
  }, [data.actions]);
  const exportCsv = () => {
    const head = ["date", "weekday", "verified", "sessions", "ma7", "multiplier", "dod_pct", "wow_pct", "pageviews", "browsers", "new_browsers",
      ...CHANNELS, "bounce_pct", "engaged_pct", "pages_per_session", "suspected_sessions", "bot_sessions", "raw_sessions", "flags", "actions"];
    const lines = [...data.ledger].map((r) => [r.date, WEEKDAYS[r.weekday], r.verified, r.sessions, r.ma7, r.multiplier, r.dod, r.wow, r.pageviews,
      r.browsers, r.new_browsers, ...CHANNELS.map((c) => r.channels[c]), r.bounce_rate, r.engaged_rate, r.pages_per_session,
      r.suspected_sessions, r.bot_sessions, r.raw_sessions, r.flags.join("|"), (actionsByDay.get(r.date) ?? []).join(" / ")]
      .map((v) => (v == null ? "" : `"${String(v).replace(/"/g, '""')}"`)).join(","));
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kospimap-growth-ledger_${data.start}_${data.end}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <section className="gc-panel">
      <header className="gc-panel-head">
        <div><span className="gc-label">DAILY LEDGER</span><h2>일별 성장 원장</h2></div>
        <div className="gc-toggles">
          <label><input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />표시 있는 날만</label>
          <button type="button" className="gc-btn" onClick={exportCsv}>CSV 내보내기</button>
        </div>
      </header>
      <p className="gc-hint">세션은 봇·자동화 의심을 뺀 검증 값입니다. 원시(기록) 세션과 제외분을 함께 보여 차이를 항상 추적할 수 있습니다.</p>
      <div className="gc-table-wrap gc-ledger">
        <table className="gc-table">
          <thead>
            <tr>
              <th>날짜</th><th className="num">검증 세션</th><th className="num">7일 평균</th><th className="num">배수</th><th className="num">전일</th>
              <th className="num">전주 동요일</th><th className="num">브라우저</th><th>채널 구성</th><th className="num">이탈률</th><th className="num">PV/세션</th>
              <th className="num">제외(의심/봇)</th><th className="num">원시</th><th>표시·조치</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const tot = CHANNELS.reduce((s, c) => s + (r.channels[c] ?? 0), 0) || 1;
              return (
                <tr key={r.date} className={r.live ? "is-live" : ""}>
                  <td className="gc-date">{r.date.slice(2)} <small>{WEEKDAYS[r.weekday]}</small></td>
                  <td className="num strong">{n0(r.sessions)}</td>
                  <td className="num">{n0(r.ma7)}</td>
                  <td className="num">{r.multiplier == null ? "—" : `${r.multiplier.toFixed(2)}×`}</td>
                  <td className={`num ${(r.dod ?? 0) >= 0 ? "is-up" : "is-down"}`}>{signed(r.dod)}</td>
                  <td className={`num ${(r.wow ?? 0) >= 0 ? "is-up" : "is-down"}`}>{signed(r.wow)}</td>
                  <td className="num">{r.browsers == null ? "—" : <>{n0(r.browsers)}<small> / 신규 {n0(r.new_browsers)}</small></>}</td>
                  <td>
                    <span className="gc-mix" title={CHANNELS.map((c) => `${CH_LABEL[c]} ${r.channels[c] ?? 0}`).join(" · ")}>
                      {CHANNELS.map((c) => <i key={c} style={{ width: `${((r.channels[c] ?? 0) / tot) * 100}%`, background: CH_COLOR[c] }} />)}
                    </span>
                  </td>
                  <td className="num">{r.bounce_rate == null ? "—" : `${r.bounce_rate.toFixed(0)}%`}</td>
                  <td className="num">{r.pages_per_session ?? "—"}</td>
                  <td className="num gc-muted">{r.verified ? `${n0(r.suspected_sessions)} / ${n0(r.bot_sessions)}` : "—"}</td>
                  <td className="num gc-muted">{n0(r.raw_sessions)}</td>
                  <td className="gc-flags">
                    {r.flags.map((f) => <i key={f} className={`gc-flag gc-flag--${f}`}>{FLAG_LABEL[f] ?? f}</i>)}
                    {(actionsByDay.get(r.date) ?? []).map((t) => <i key={t} className="gc-flag gc-flag--action" title={t}>조치</i>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ChannelsTab({ data }: { data: GrowthControl }) {
  const total = data.channels.reduce((s, c) => s + c.sessions, 0) || 1;
  return (
    <>
      <section className="gc-channel-cards">
        {CHANNELS.map((c) => {
          const row = data.channels.find((x) => x.channel === c);
          const drv = data.drivers.find((d) => d.channel === c);
          return (
            <article key={c} style={{ borderTopColor: CH_COLOR[c] }}>
              <span>{CH_LABEL[c]}</span>
              <strong>{n0(row?.sessions ?? 0)}</strong>
              <small>{(((row?.sessions ?? 0) / total) * 100).toFixed(1)}% · 이탈 {row?.bounce_rate == null ? "—" : `${row.bounce_rate.toFixed(0)}%`}</small>
              {drv && <em className={drv.delta >= 0 ? "is-up" : "is-down"}>주간 {signed(drv.delta, "/일", 0)}</em>}
            </article>
          );
        })}
      </section>
      <div className="gc-grid2">
        <section className="gc-panel">
          <header className="gc-panel-head"><div><span className="gc-label">SOURCES</span><h2>유입 소스 (채널 보정 후)</h2></div></header>
          <RankTable rows={data.sources} keyName="key" cols={[["channel", "채널"], ["source", "소스"]]} />
        </section>
        <section className="gc-panel">
          <header className="gc-panel-head"><div><span className="gc-label">REFERRERS</span><h2>외부 도메인</h2></div></header>
          <RankTable rows={data.referrers} keyName="key" cols={[["channel", "채널"], ["host", "도메인"]]} />
        </section>
      </div>
      <section className="gc-panel">
        <header className="gc-panel-head">
          <div><span className="gc-label">CAMPAIGNS</span><h2>UTM 캠페인 성과</h2></div>
          <span className="gc-sub">utm_source · utm_medium · utm_campaign</span>
        </header>
        <RankTable rows={data.campaigns} keyName="key" cols={[["utm_source", "source"], ["utm_medium", "medium"], ["utm_campaign", "campaign"]]} />
      </section>
      <div className="gc-grid2">
        <section className="gc-panel">
          <header className="gc-panel-head"><div><span className="gc-label">TIMING</span><h2>요일 × 시간 평균 검증 세션</h2></div></header>
          <Heatmap grid={data.heatmap} />
        </section>
        <section className="gc-panel">
          <header className="gc-panel-head"><div><span className="gc-label">DEVICES</span><h2>기기별 품질</h2></div></header>
          <RankTable rows={data.devices} keyName="device" cols={[["device", "기기"]]} />
        </section>
      </div>
    </>
  );
}

function LandingsTab({ data }: { data: GrowthControl }) {
  const maxMove = Math.max(1, ...data.landing_movers.map((m) => Math.abs(m.delta)));
  return (
    <>
      <section className="gc-panel">
        <header className="gc-panel-head">
          <div><span className="gc-label">LANDING PAGES</span><h2>첫 진입 페이지 — 유입을 받는 문</h2></div>
          <span className="gc-sub">세션의 첫 페이지 기준 · 이탈률 = 한 페이지만 보고 떠난 비율</span>
        </header>
        <RankTable rows={data.landings} keyName="route" cols={[["route", "페이지"]]} />
      </section>
      <section className="gc-panel">
        <header className="gc-panel-head"><div><span className="gc-label">MOVERS</span><h2>지난주 대비 유입 변화가 큰 랜딩</h2></div></header>
        {data.landing_movers.length ? (
          <div className="gc-drivers">
            {data.landing_movers.map((m) => (
              <div key={m.route} className="gc-driver">
                <span className="gc-cell-key" title={m.route}>{m.route}</span>
                <div className="gc-driver-axis"><i className={m.delta >= 0 ? "is-up" : "is-down"} style={{ width: `${(Math.abs(m.delta) / maxMove) * 50}%` }} /></div>
                <em className={m.delta >= 0 ? "is-up" : "is-down"}>{signed(m.delta, "", 0)}</em>
                <small>{n0(m.previous)} → {n0(m.current)}</small>
              </div>
            ))}
          </div>
        ) : <p className="gc-empty">비교할 데이터가 부족합니다.</p>}
      </section>
    </>
  );
}

function ActionsTab({ data, onSaved }: { data: GrowthControl; onSaved: () => void }) {
  const [day, setDay] = useState(kstDate());
  const [category, setCategory] = useState("sns");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    if (!title.trim()) return setErr("무엇을 했는지 제목을 입력하세요.");
    setBusy(true);
    setErr("");
    try {
      await adminApi.growthAction({ day, category, title: title.trim(), detail: detail.trim(), focus_channel: focus || null });
      setTitle("");
      setDetail("");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section className="gc-panel">
        <header className="gc-panel-head">
          <div><span className="gc-label">EXPERIMENT LOG</span><h2>조치·실험 기록</h2></div>
          <span className="gc-sub">기록은 추가만 됩니다 · 효과는 전 7일 vs 후 7일(마감일)로 자동 측정</span>
        </header>
        <div className="gc-action-form">
          <label><span>적용일</span><input type="date" value={day} max={kstDate()} onChange={(e) => setDay(e.target.value)} /></label>
          <label><span>분류</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {Object.entries(data.action_categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label><span>겨냥 채널</span>
            <select value={focus} onChange={(e) => setFocus(e.target.value)}>
              <option value="">전체</option>
              {CHANNELS.map((c) => <option key={c} value={c}>{CH_LABEL[c]}</option>)}
            </select>
          </label>
          <label className="gc-grow"><span>무엇을 했나</span><input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="예: 네이버 서치어드바이저 사이트맵 재제출" /></label>
          <label className="gc-form-wide"><span>가설·메모</span><input value={detail} maxLength={1000} onChange={(e) => setDetail(e.target.value)} placeholder="예: 종목 상세 색인이 늘면 검색 유입이 2주 내 +30%" /></label>
          <button type="button" className="gc-btn is-primary" disabled={busy} onClick={submit}>{busy ? "저장 중…" : "기록 추가"}</button>
        </div>
        {err && <p className="gc-error">{err}</p>}
      </section>
      <section className="gc-panel">
        <header className="gc-panel-head"><div><span className="gc-label">IMPACT</span><h2>조치별 효과</h2></div></header>
        {data.actions.length ? (
          <div className="gc-table-wrap">
            <table className="gc-table">
              <thead><tr><th>적용일</th><th>분류</th><th>조치</th><th className="num">전 7일 평균</th><th className="num">후 평균</th><th className="num">변화</th><th className="num">겨냥 채널</th><th>측정</th></tr></thead>
              <tbody>
                {data.actions.map((a) => (
                  <tr key={a.id}>
                    <td className="gc-date">{a.day}</td>
                    <td><i className="gc-flag gc-flag--action">{a.category_label}</i></td>
                    <td><b>{a.title}</b>{a.detail && <small className="gc-block">{a.detail}</small>}</td>
                    <td className="num">{n0(a.before)}</td>
                    <td className="num">{n0(a.after)}</td>
                    <td className={`num ${(a.change_pct ?? 0) >= 0 ? "is-up" : "is-down"}`}>{signed(a.change_pct)}</td>
                    <td className="num">{a.focus_channel ? <>{CH_LABEL[a.focus_channel]} {n0(a.focus_before)} → {n0(a.focus_after)}</> : "—"}</td>
                    <td>{a.days_measured >= 7 ? "측정 완료" : `${a.days_measured}/7일`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="gc-empty">아직 기록된 조치가 없습니다. SEO·SNS·기능 출시를 할 때마다 기록하면 무엇이 성장을 만들었는지 검증할 수 있습니다.</p>}
        <p className="gc-hint">전후 비교는 계절성·시장 이벤트의 영향을 함께 받습니다. 같은 기간 다른 조치가 겹치면 효과가 섞여 보이니, 가능하면 한 번에 하나씩 기록하세요.</p>
      </section>
    </>
  );
}

function AutomationTab({ data }: { data: GrowthControl }) {
  const a = data.automation;
  const maxFam = Math.max(1, ...a.families.map((f) => f.pageviews));
  return (
    <>
      <section className="gc-panel gc-bot-banner">
        <div>
          <span className="gc-label">EXCLUDED FROM GROWTH</span>
          <h2>봇·자동화 트래픽 — 성장 지표와 분리</h2>
          <p>봇은 사이트 성장과 무관하므로 모든 성장 수치(세션·배수·채널·랜딩)에서 제외하고 여기서만 보여줍니다.</p>
        </div>
        <div className="gc-bot-stats">
          <article><span>선언된 봇 세션</span><strong>{n0(a.bot_sessions)}</strong><small>{n0(a.bot_pageviews)} PV</small></article>
          <article><span>자동화 의심 세션</span><strong>{n0(a.suspected_sessions)}</strong><small>브라우저로 위장한 순회</small></article>
          <article><span>검증 세션 (성장 반영)</span><strong>{n0(data.kpis.range_sessions)}</strong><small>원시 {n0(data.kpis.range_raw_sessions)}</small></article>
        </div>
      </section>
      <div className="gc-grid2">
        <section className="gc-panel">
          <header className="gc-panel-head"><div><span className="gc-label">FAMILIES</span><h2>봇 종류별</h2></div></header>
          {a.families.length ? a.families.map((f) => (
            <div key={f.family} className="gc-rank">
              <b>{f.label}</b>
              <Bar value={f.pageviews} max={maxFam} color="var(--gc-amber)" />
              <em>{n0(f.pageviews)} PV</em>
              <small>{n0(f.sessions)} 세션</small>
            </div>
          )) : <p className="gc-empty">기간 중 기록된 봇이 없습니다.</p>}
        </section>
        <section className="gc-panel">
          <header className="gc-panel-head"><div><span className="gc-label">CRAWLED</span><h2>봇이 많이 가져간 페이지</h2></div></header>
          {a.pages.map((p) => (
            <div key={p.route} className="gc-rank"><b className="gc-cell-key">{p.route}</b><em>{n0(p.pageviews)} PV</em></div>
          ))}
          {!a.pages.length && <p className="gc-empty">—</p>}
        </section>
      </div>
      <section className="gc-panel">
        <header className="gc-panel-head"><div><span className="gc-label">AGENTS</span><h2>선언된 봇 에이전트</h2></div></header>
        <div className="gc-table-wrap">
          <table className="gc-table">
            <thead><tr><th>에이전트</th><th>종류</th><th className="num">PV</th><th className="num">세션</th></tr></thead>
            <tbody>
              {a.agents.map((g) => <tr key={g.agent}><td className="gc-cell-key">{g.agent}</td><td>{g.label}</td><td className="num">{n0(g.pageviews)}</td><td className="num">{n0(g.sessions)}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>
      <div className="gc-grid2">
        <section className="gc-panel">
          <header className="gc-panel-head">
            <div><span className="gc-label">SUSPECTED</span><h2>자동화 의심 에이전트</h2></div>
          </header>
          <p className="gc-hint">
            봇이라고 밝히지 않았지만, 같은 브라우저 문자열이 하루에 {12}세션 이상을 만들고 그중 80% 이상이 리퍼러 없이 서로 다른 상세 페이지 한 장만 열고
            떠난 경우(사이트맵 순회), 또는 구버전·서버형 UA가 같은 패턴을 보인 경우입니다.
          </p>
          {a.suspected_agents.length ? (
            <div className="gc-table-wrap">
              <table className="gc-table">
                <thead><tr><th>에이전트</th><th>근거</th><th className="num">세션</th><th className="num">일수</th></tr></thead>
                <tbody>
                  {a.suspected_agents.map((s) => (
                    <tr key={s.agent}>
                      <td className="gc-cell-key">{s.agent}</td>
                      <td>{s.signals.map((x) => <i key={x} className="gc-flag gc-flag--automation_heavy">{SIGNAL_LABEL[x] ?? x}</i>)}</td>
                      <td className="num">{n0(s.sessions)}</td><td className="num">{s.days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="gc-empty">기간 중 자동화 의심 묶음이 없습니다.</p>}
        </section>
        <section className="gc-panel">
          <header className="gc-panel-head"><div><span className="gc-label">SUSPECTED LANDINGS</span><h2>의심 트래픽이 들어간 페이지</h2></div></header>
          <RankTable rows={a.suspected_landings} keyName="route" cols={[["route", "페이지"]]} />
        </section>
      </div>
    </>
  );
}

function TrustTab({ data }: { data: GrowthControl }) {
  const t = data.trust;
  return (
    <>
      <section className="gc-panel gc-trust-head">
        <div className={`gc-score gc-score--${t.score >= 85 ? "good" : t.score >= 65 ? "warning" : "critical"}`}>
          <strong>{t.score}</strong><span>/ 100</span>
        </div>
        <div>
          <span className="gc-label">DATA TRUST</span>
          <h2>관제 데이터 신뢰도</h2>
          <p className="gc-hint">수집이 살아 있는지, 집계가 빠짐없는지, 봇·자동화·채널 오분류가 걸러졌는지, 목표 기준선이 확정됐는지를 매 조회마다 점검합니다.</p>
        </div>
      </section>
      <section className="gc-panel">
        <div className="gc-checks">
          {t.checks.map((c) => (
            <article key={c.key} className={`gc-check gc-check--${c.status}`}>
              <i>{c.status === "good" ? "정상" : c.status === "warning" ? "주의" : c.status === "critical" ? "위험" : "정보"}</i>
              <b>{c.title}</b>
              <p>{c.detail}</p>
            </article>
          ))}
        </div>
      </section>
      <div className="gc-grid2">
        <section className="gc-panel">
          <header className="gc-panel-head"><div><span className="gc-label">GAPS</span><h2>검증 집계가 없는 날</h2></div></header>
          {t.unverified_days.length ? (
            <p className="gc-hint">{t.unverified_days.join(", ")} — 롤업은 마감일마다 자동으로 쌓이며(최근 {t.backfill_days}일 백필), 그 전까지는 원시 일계를 씁니다.</p>
          ) : <p className="gc-empty">선택 기간의 모든 마감일이 검증 집계되었습니다.</p>}
          {t.mismatch.length > 0 && (
            <div className="gc-table-wrap">
              <table className="gc-table">
                <thead><tr><th>날짜</th><th className="num">일계표</th><th className="num">롤업(검증+의심)</th></tr></thead>
                <tbody>{t.mismatch.map((m) => <tr key={m.date}><td>{m.date}</td><td className="num">{n0(m.daily_table)}</td><td className="num">{n0(m.rollup)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
        <section className="gc-panel">
          <header className="gc-panel-head"><div><span className="gc-label">DEFINITIONS</span><h2>측정 정의</h2></div></header>
          <dl className="gc-defs">
            <dt>검증 세션</dt><dd>사람 브라우저의 페이지뷰가 있는 탭 세션. 선언된 봇과 자동화 의심 묶음은 제외.</dd>
            <dt>고유 브라우저</dt><dd>가명(HMAC) 브라우저 ID 기준 일별 고유 수. 사람 수에 더 가깝습니다(DNT/GPC 제외).</dd>
            <dt>현재 배수</dt><dd>최근 7개 마감일 평균 검증 세션 ÷ 확정 기준선. 진행 중인 오늘은 넣지 않습니다.</dd>
            <dt>오늘 예상</dt><dd>지난 14일의 시간대별 누적 비중(중앙값)으로 지금까지의 세션을 하루치로 환산.</dd>
            <dt>일 성장률</dt><dd>최근 28일 검증 세션의 로그 선형 추세(복리). 필요 성장률 = (목표 ÷ 현재)^(1/남은 일수) − 1.</dd>
            <dt>채널 보정</dt><dd>리퍼러·UTM으로 다시 판정: Bluesky·네이버 블로그/카페·커뮤니티 → 소셜, 기타 검색엔진 → 검색, 자기 도메인 → 직접.</dd>
            <dt>이상치</dt><dd>최근 28일 중앙값 대비 로버스트 z ≥ 3.5(급증) 또는 ≤ −3.5(급감).</dd>
          </dl>
        </section>
      </div>
    </>
  );
}

/* ── page ───────────────────────────────────────────────────────────────── */

export default function AdminGrowthPage() {
  useDocumentTitle("방문자 100배 성장 관제실 | KOSPIMAP");
  const [days, setDays] = useState(30);
  const [custom, setCustom] = useState<{ start: string; end: string } | null>(null);
  const [draft, setDraft] = useState({ start: kstDate(29), end: kstDate() });
  const [customOpen, setCustomOpen] = useState(false);
  const [data, setData] = useState<GrowthControl | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const saved = localStorage.getItem("growth_control_tab");
      return (TABS.some(([k]) => k === saved) ? saved : "overview") as Tab;
    } catch {
      return "overview";
    }
  });
  const [goalOpen, setGoalOpen] = useState(false);

  useEffect(() => {
    if (!getStoredSession()) navigate("/admin");
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    adminApi
      .growthControl(days, custom?.start, custom?.end)
      .then(setData)
      .catch((err) => {
        if (err instanceof AdminAuthError) {
          clearStoredSession();
          navigate("/admin");
        } else setError(err instanceof Error ? err.message : "관제 데이터를 불러오지 못했습니다.");
      })
      .finally(() => setLoading(false));
  }, [days, custom]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 5 * 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const pickTab = (k: Tab) => {
    setTab(k);
    try {
      localStorage.setItem("growth_control_tab", k);
    } catch {
      /* preference only */
    }
  };

  if (!getStoredSession()) return null;
  const k = data?.kpis;
  const goal = data?.goal;
  const gap = k && k.cdgr != null && k.required_cdgr != null ? k.cdgr - k.required_cdgr : null;

  return (
    <main className="gc-page">
      <header className="gc-head">
        <div>
          <div className="gc-kicker"><i /> GROWTH CONTROL · 100×</div>
          <h1>방문자 100배 성장 관제실</h1>
          <p>봇·자동화를 걷어낸 검증 방문만으로 매일의 성장, 원인, 다음 조치를 추적합니다.</p>
        </div>
        <div className="gc-head-side">
          <nav>
            <Link to="/admin/dashboard">대시보드</Link>
            <Link to="/admin/live">실시간</Link>
            <Link to="/admin/monitor">모니터링</Link>
            <Link to="/admin/db">DB 조회</Link>
          </nav>
          {data && (
            <button type="button" className={`gc-trust-pill gc-score--${data.trust.score >= 85 ? "good" : data.trust.score >= 65 ? "warning" : "critical"}`} onClick={() => pickTab("trust")}>
              데이터 신뢰도 <b>{data.trust.score}</b>
            </button>
          )}
        </div>
      </header>

      <div className="gc-toolbar">
        <div className="gc-ranges" role="group" aria-label="조회 기간">
          {RANGES.map((n) => (
            <button key={n} type="button" className={!custom && days === n ? "is-on" : ""} onClick={() => { setCustom(null); setDays(n); setCustomOpen(false); }}>
              {n === 365 ? "1년" : n === 730 ? "2년" : `${n}일`}
            </button>
          ))}
          <button type="button" className={custom ? "is-on" : ""} onClick={() => setCustomOpen((v) => !v)}>직접입력</button>
        </div>
        {customOpen && (
          <div className="gc-custom">
            <input type="date" value={draft.start} max={draft.end} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
            <span>→</span>
            <input type="date" value={draft.end} min={draft.start} max={kstDate()} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
            <button type="button" className="gc-btn is-primary" onClick={() => draft.start <= draft.end && setCustom({ ...draft })}>조회</button>
          </div>
        )}
        <span className="gc-toolbar-meta">
          {loading ? "갱신 중…" : data ? `${new Date(data.generated_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 기준 · KST · 5분마다 자동 갱신` : ""}
          <button type="button" className="gc-btn" onClick={load} disabled={loading}>새로고침</button>
        </span>
      </div>

      {error && <div className="gc-error gc-error--box">{error}</div>}
      {!data ? (
        <div className="gc-skeleton"><i /><i /><i /><i /><div /></div>
      ) : (
        <>
          <section className="gc-mission">
            <div className="gc-mission-goal">
              <span className="gc-label">MISSION</span>
              {goal?.baseline ? (
                <h2>
                  일 {n0(k?.target_daily)} 검증 세션
                  <small> = 기준선 {n0(goal.baseline)} × {goal.target_multiplier}</small>
                </h2>
              ) : (
                <h2>기준선을 정하면 100배 목표가 계산됩니다</h2>
              )}
              <p>
                {goal?.confirmed ? (
                  <>기준선 확정 {goal.created_at?.slice(0, 10)} · {goal.method}</>
                ) : (
                  <span className="gc-warn-text">기준선 미확정 — 기존 값은 시작일의 진행 중이던 하루 수치입니다</span>
                )}
                {goal?.target_date ? <> · 목표일 {goal.target_date} (D-{k?.days_left})</> : <> · 목표일 미설정</>}
              </p>
              <button type="button" className="gc-btn is-primary" onClick={() => setGoalOpen(true)}>목표 설정</button>
            </div>
            <MissionTrack data={data} />
          </section>

          <section className="gc-kpis">
            <article className="is-accent">
              <span>현재 배수</span>
              <strong>{k?.multiplier == null ? "—" : k.multiplier.toFixed(2)}<small>×</small></strong>
              <footer>100× 진행 {k?.log_progress == null ? "—" : `${k.log_progress}%`} (로그) · 선형 {k?.linear_progress ?? "—"}%</footer>
            </article>
            <article>
              <span>7일 평균 검증 세션</span>
              <strong>{n0(k?.ma7)}</strong>
              <footer className={(k?.ma7_change_pct ?? 0) >= 0 ? "is-up" : "is-down"}>직전 7일 대비 {signed(k?.ma7_change_pct)}</footer>
            </article>
            <article>
              <span>오늘 (진행 중)</span>
              <strong>{n0(k?.today?.sessions)}</strong>
              <footer>{k?.projection ? <>예상 {n0(k.projection.projected_sessions)} · 7일 평균 대비 {signed(k.projection.vs_ma7)}</> : "시간대 패턴 수집 중"}</footer>
            </article>
            <article>
              <span>일 성장률 (28일)</span>
              <strong>{signed(k?.cdgr, "%", 2)}</strong>
              <footer className={gap == null ? "" : gap >= 0 ? "is-up" : "is-down"}>
                {k?.required_cdgr == null ? "목표일을 정하면 필요 속도 표시" : <>필요 {k.required_cdgr.toFixed(2)}% · 격차 {signed(gap, "%p", 2)}</>}
              </footer>
            </article>
            <article>
              <span>기간 검증 세션</span>
              <strong>{n0(k?.range_sessions)}</strong>
              <footer>원시 {n0(k?.range_raw_sessions)} · 제외 의심 {n0(k?.range_suspected)} · 봇 {n0(k?.range_bot_sessions)}</footer>
            </article>
            <article>
              <span>최고 기록일</span>
              <strong>{n0(k?.best_day?.sessions)}</strong>
              <footer>{k?.best_day ? `${k.best_day.date} (${WEEKDAYS[weekdayIdx(k.best_day.date)]})` : "—"}</footer>
            </article>
          </section>

          <nav className="gc-tabs" role="tablist">
            {TABS.map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "is-on" : ""} onClick={() => pickTab(key)}>
                {label}
                {key === "automation" && data.automation.suspected_sessions + data.automation.bot_sessions > 0 && <i>{n0(data.automation.suspected_sessions + data.automation.bot_sessions)}</i>}
                {key === "overview" && data.insights.some((x) => x.severity === "critical" && !x.mark) && <i className="is-critical">!</i>}
              </button>
            ))}
          </nav>

          {tab === "overview" && <OverviewTab data={data} onChanged={load} />}
          {tab === "traffic" && <TrafficTab data={data} onChanged={load} />}
          {tab === "ledger" && <LedgerTab data={data} />}
          {tab === "channels" && <ChannelsTab data={data} />}
          {tab === "landings" && <LandingsTab data={data} />}
          {tab === "actions" && <ActionsTab data={data} onSaved={load} />}
          {tab === "automation" && <AutomationTab data={data} />}
          {tab === "trust" && <TrustTab data={data} />}
          {goalOpen && <GoalDialog data={data} onClose={() => setGoalOpen(false)} onSaved={() => { setGoalOpen(false); load(); }} />}
        </>
      )}
    </main>
  );
}
