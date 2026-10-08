import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AtlasAction, AtlasSession, AtlasSnapshot } from "./systemAtlasApi";
import { actionLabel, DOMAIN_COLORS, DOMAIN_NAMES, sessionLabel } from "./atlasFlowModel";
import { pageLabel } from "../useActivityTracking";
import SystemAtlasIcon from "./SystemAtlasIcon";
import "./atlasSessionWatch.css";

type View = "journey" | "timeline";
const time = (ts: number) => new Date(ts * 1000).toLocaleTimeString("ko-KR", { hour12: false });
const age = (now: number, ts: number) => now - ts < 60 ? `${Math.max(0, Math.floor(now - ts))}초 전` : `${Math.floor((now - ts) / 60)}분 전`;
const status = (s: AtlasSession) => s.online ? s.active ? "접속 · 활동 중" : "접속 유지" : s.active ? "최근 활동" : "최근 활동 없음";
const color = (group: string) => DOMAIN_COLORS[group] || "#55d9ff";
const tint = (group: string) => ({ "--aw-color": color(group) } as CSSProperties);
const offset: Record<string, number> = { market: 0, community: -18, realestate: 18, prediction: -9, support: 9 };
const elapsed = (a: AtlasAction, b: AtlasAction) => {
  const seconds = Math.max(0, Math.round(b.ts - a.ts));
  return seconds < 1 ? "연속" : seconds < 60 ? `+${seconds}초` : `+${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
};
const kind = (e: AtlasAction) => e.type === "page_view" ? "페이지 이동" : e.type === "stock_view" ? "종목 조회" : e.type === "hub" ? "메인 상호작용" : "클릭 · 선택";

function ActivitySpark({ session, now }: { session: AtlasSession; now: number }) {
  const buckets = Array.from({ length: 10 }, () => 0);
  session.events.forEach(e => { const i = Math.min(9, Math.floor((e.ts - now + 300) / 30)); if (e.ts <= now && i >= 0) buckets[i]++; });
  const max = Math.max(1, ...buckets);
  return <svg className="aw-spark" viewBox="0 0 74 26" aria-hidden="true">
    {buckets.map((n, i) => <rect key={i} x={i * 7.5} y={24 - (n ? 3 + n / max * 19 : 1)} width="4" height={n ? 3 + n / max * 19 : 1} rx="1" opacity={n ? 1 : .2}/>)}</svg>;
}

function SessionLane({ session, rank, now, seconds, selected, view, follow, onSelect, onEvent }: {
  session: AtlasSession; rank: number; now: number; seconds: number; selected: boolean; view: View; follow: boolean;
  onSelect: () => void; onEvent: (e: AtlasAction) => void;
}) {
  const events = session.events.filter(e => e.ts >= now - seconds && e.ts <= now);
  const visible = selected ? events : events.slice(-6);
  const plot = useRef<HTMLDivElement>(null), followTime = useRef(true);
  useEffect(() => {
    const element = plot.current;
    if (!element) return;
    const latest = () => { if (followTime.current) element.scrollLeft = element.scrollWidth - element.clientWidth; };
    const observer = new ResizeObserver(latest); observer.observe(element); latest();
    return () => observer.disconnect();
  }, []);
  useEffect(() => { followTime.current = follow; if (follow && plot.current) plot.current.scrollLeft = plot.current.scrollWidth - plot.current.clientWidth; }, [follow]);
  useEffect(() => { followTime.current = true; if (plot.current) plot.current.scrollLeft = plot.current.scrollWidth - plot.current.clientWidth; }, [seconds, view, selected]);
  useEffect(() => { if (followTime.current && plot.current) plot.current.scrollLeft = plot.current.scrollWidth - plot.current.clientWidth; }, [now]);
  const x = (e: AtlasAction) => 18 + (e.ts - now + seconds) / seconds * 924;
  const y = (e: AtlasAction) => 48 + (offset[e.group] || 0);
  const last = session.events[session.events.length - 1];
  return <article className={`aw-lane ${selected ? "is-selected" : ""}`} data-session={session.id} data-view={view}>
    <button className="aw-lane-label" aria-pressed={selected} onClick={onSelect}>
      <span className="aw-identity"><em>{String(rank).padStart(2, "0")}</em><i className={session.online ? "is-online" : ""}/>{sessionLabel(session.id)}</span>
      <b>{last ? pageLabel(last.path) : "행동 대기"}</b>
      <small>{status(session)}{last && ` · ${age(now, last.ts)}`}</small>
      <span className="aw-lane-count"><strong>{events.length}</strong> 행동 / {seconds / 60}분{view === "journey" && events.length > visible.length && <span>최근 {visible.length}개 요약</span>}</span>
    </button>
    <div className={`aw-lane-plot aw-${view}`} ref={plot} onWheel={() => { followTime.current = false; }} onTouchStart={() => { followTime.current = false; }}>
      {view === "journey" ? <div className="aw-path" role="group" aria-label={`${sessionLabel(session.id)} 시간순 행동 경로`}>
        {visible.map((e, i) => <div className="aw-path-step" key={e.id}>
          {i > 0 && <div className="aw-connector"><small>{elapsed(visible[i - 1], e)}</small><SystemAtlasIcon name="arrow" size={21}/></div>}
          <button className={`aw-action-card ${i === visible.length - 1 && now - e.ts <= 10 ? "is-new" : ""}`} style={tint(e.group)} data-action={e.id}
            aria-label={`${time(e.ts)} ${actionLabel(e)}`} onClick={() => onEvent(e)} title={`${actionLabel(e)} · ${e.path}`}>
            <span className="aw-card-top"><span><SystemAtlasIcon name={e.group} size={16}/>{DOMAIN_NAMES[e.group] || "화면"}</span><em>{String(events.length - visible.length + i + 1).padStart(2, "0")}</em></span>
            <strong>{e.stock_name || e.label || pageLabel(e.path)}</strong><span className="aw-card-kind">{kind(e)}</span>
            <span className="aw-card-bottom"><time>{time(e.ts)}</time>{i === visible.length - 1 && <b>최근</b>}</span>
          </button>
        </div>)}
        {!events.length && <div className="aw-quiet"><SystemAtlasIcon name="client" size={23}/><div><b>{session.online ? "접속 유지 · 새 행동 대기" : "이 구간의 행동 없음"}</b><span>{last ? `마지막 관측 ${age(now, last.ts)} · 시간 범위를 넓혀 확인하세요.` : "관측된 이동이나 클릭이 생기면 경로가 표시됩니다."}</span></div></div>}
      </div> : <svg viewBox="0 0 960 100" role="group" aria-label={`${sessionLabel(session.id)} 시간순 행동 경로`}>
        {[0, 1, 2, 3, 4].map(i => <line key={i} x1={18 + i * 231} x2={18 + i * 231} y1="12" y2="80" className="aw-grid"/>)}
        <line x1="18" x2="942" y1="48" y2="48" className="aw-baseline"/>
        {events.slice(1).map((e, i) => <path key={`edge:${e.id}`} d={`M${x(events[i])},${y(events[i])} L${x(e)},${y(e)}`} stroke={color(e.group)} className="aw-trail"/>)}
        {events.map((e, i) => {
          const labelSpace = (events[i + 1] ? x(events[i + 1]) : 960) - x(e);
          return <g key={e.id} role="button" tabIndex={0} aria-label={`${time(e.ts)} ${actionLabel(e)}`} data-action={e.id}
            onClick={() => onEvent(e)} onKeyDown={key => { if (key.key === "Enter" || key.key === " ") { key.preventDefault(); onEvent(e); } }}>
            <title>{time(e.ts)} · {actionLabel(e)} · {e.path}</title>
            <rect x={x(e) - 9} y={y(e) - 25} width={labelSpace > 90 ? Math.min(122, labelSpace) : 18} height="36" fill="transparent" pointerEvents="all"/>
            <circle cx={x(e)} cy={y(e)} r={e.type === "page_view" ? 5 : 4} fill={color(e.group)} className="aw-action"/>
            {labelSpace > 90 && <text x={Math.min(832, x(e) + 8)} y={y(e) - 10} fill={color(e.group)}>{(e.stock_name || e.label || pageLabel(e.path)).slice(0, 14)}</text>}
          </g>;
        })}
        {!events.length && <text x="28" y="38" className="aw-wait">{session.online ? "접속 유지 중 · 이 구간의 행동 없음" : "이 구간의 행동 없음"}</text>}
        <circle cx="942" cy="48" r="3" className={`aw-now ${session.active ? "is-active" : ""}`}/>
        {[0, 1, 2, 3, 4].map(i => <text key={`time:${i}`} className="aw-time" x={18 + i * 231} y="94" textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}>{i === 4 ? "현재" : time(now - seconds + seconds * i / 4)}</text>)}
      </svg>}
    </div>
  </article>;
}

export default function AtlasSessionWatch({ live, selected, onSelect, paused, stale }: {
  live: AtlasSnapshot | null; selected: string | null; onSelect: (id: string | null) => void; paused: boolean; stale: boolean;
}) {
  const [seconds, setSeconds] = useState(300), [view, setView] = useState<View>("journey"), [picked, setPicked] = useState<{ session: string; event: number } | null>(null);
  const [follow, setFollow] = useState(true), details = useRef<HTMLDivElement>(null);
  const sessions = live?.behavior?.sessions || [], now = live?.at || Date.now() / 1000;
  const shown = selected ? sessions.filter(s => s.id === selected) : sessions;
  const focused = selected ? shown[0] : null;
  const action = focused?.events.find(e => e.id === picked?.event && picked.session === focused.id);
  useEffect(() => { if (follow && details.current) details.current.scrollTop = details.current.scrollHeight; }, [live, selected, follow]);
  const choose = (id: string | null) => { onSelect(id); setPicked(null); };
  return <section className="aw-watch" aria-label="접속 세션 행동 관찰" data-mode={selected ? "session" : "all"}>
    <header className="aw-head"><div><span className="aw-eyebrow">SESSION / LIVE JOURNEYS</span><h2>접속 세션 행동 관찰<i className={paused || stale ? "is-stale" : ""}/></h2>
      <p>{selected ? `${sessionLabel(selected)} 고정 관찰 · 도표, 거미, 로그가 이 세션을 따라갑니다.` : "활동이 있는 세션을 최근 행동 순으로 먼저 표시합니다. 세션을 클릭하면 해당 흐름에 집중합니다."}</p></div>
      <div className="aw-tools"><button onClick={() => choose(null)} aria-pressed={!selected}><SystemAtlasIcon name="client" size={15}/>전체 세션</button>
        <label>시간 범위<select aria-label="세션 행동 시간 범위" value={seconds} onChange={e => setSeconds(Number(e.target.value))}><option value={60}>1분</option><option value={300}>5분</option><option value={900}>15분</option></select></label>
        <span className={`aw-live ${paused || stale ? "is-stale" : ""}`}><i/>{paused ? "관측 정지" : stale ? "갱신 지연" : "실시간 갱신"}</span></div></header>
    <div className="aw-summary"><span><SystemAtlasIcon name="client" size={22}/><div><b>{live?.behavior?.online_count ?? "—"}</b><small>접속 확인 <em>최근 120초</em></small></div></span>
      <span><SystemAtlasIcon name="cache" size={22}/><div><b>{live?.behavior?.active_count ?? "—"}</b><small>활동 세션 <em>최근 90초</em></small></div></span>
      <span><SystemAtlasIcon name="trace" size={22}/><div><b>{live?.behavior?.event_count ?? "—"}</b><small>관측 행동 <em>최근 15분</em></small></div></span>
      <div className="aw-legend">{Object.entries(DOMAIN_NAMES).filter(([g]) => g !== "operations").map(([g, label]) => <span key={g} style={tint(g)}><i/>{label}</span>)}</div></div>
    {!!sessions.length && <div className="aw-session-picker" role="group" aria-label="관찰할 접속 세션 선택">{sessions.map((s, i) => {
      const last = s.events[s.events.length - 1];
      return <button key={s.id} aria-pressed={selected === s.id} onClick={() => choose(selected === s.id ? null : s.id)}>
        <span className="aw-picker-top"><span><i className={s.online ? "is-online" : ""}/>{sessionLabel(s.id)}</span><em>{String(i + 1).padStart(2, "0")}</em></span>
        <span className="aw-picker-page">{last ? actionLabel(last) : "관측 행동 없음"}</span>
        <span className="aw-picker-bottom"><small>{status(s)}{last && ` · ${age(now, last.ts)}`}</small><ActivitySpark session={s} now={now}/></span>
      </button>;
    })}</div>}
    <div className="aw-viewbar"><div><b>{selected ? "선택 세션" : `${sessions.length}개 관측 세션`}</b><small>{view === "journey" ? "시간순 경로 · 전체는 최근 6개 요약, 선택하면 구간 전체" : "실제 발생 시각 · 좌우로 시간축 탐색"}</small></div>
      <div className="aw-view-toggle" role="group" aria-label="행동 도표 보기"><button aria-pressed={view === "journey"} onClick={() => setView("journey")}><SystemAtlasIcon name="trace" size={15}/>행동 경로</button><button aria-pressed={view === "timeline"} onClick={() => setView("timeline")}><SystemAtlasIcon name="operations" size={15}/>시간축</button></div></div>
    <div className="aw-lanes">{shown.map((s, i) => <SessionLane key={s.id} session={s} rank={selected ? sessions.indexOf(s) + 1 : i + 1} now={now} seconds={seconds} view={view} follow={follow} selected={s.id === selected} onSelect={() => choose(selected === s.id ? null : s.id)} onEvent={e => { onSelect(s.id); setPicked({ session: s.id, event: e.id }); }} />)}
      {!shown.length && <p className="aw-empty">{selected ? "선택 세션의 관측 기간이 지났거나 서버가 재시작됐습니다. 전체 세션에서 다시 선택할 수 있습니다." : live?.behavior ? "접속 세션을 기다리고 있습니다. 행동이 발생하면 경로가 그려집니다." : "세션 관측 연결 대기 중"}</p>}</div>
    {focused && <section className="aw-detail"><header><h3><SystemAtlasIcon name="trace" size={17}/>{action ? "선택한 행동" : "시간순 행동 기록"}</h3><span>{focused.events.length ? `${age(now, focused.last_seen)} 마지막 행동` : "관측 행동 없음"}</span><button aria-pressed={follow} onClick={() => setFollow(v => !v)}>{follow ? "최신 행동 따라가기 ON" : "최신 행동 따라가기 OFF"}</button>{action && <button onClick={() => setPicked(null)}>전체 기록</button>}</header>
      <div className="aw-detail-list" ref={details} onWheel={() => setFollow(false)} onTouchMove={() => setFollow(false)}>{(action ? [action] : focused.events).map(e => <button key={e.id} data-detail-action={e.id} style={tint(e.group)} onClick={() => setPicked({ session: focused.id, event: e.id })}><time>{time(e.ts)}</time><i/><strong>{actionLabel(e)}</strong><span>{pageLabel(e.path)} · {e.path}</span></button>)}{!focused.events.length && <p className="aw-empty">접속은 확인했으며 아직 관측된 행동이 없습니다.</p>}</div></section>}
    <footer><span>브라우저 탭 세션 · 식별된 봇 제외 · 최근 15분 / 최대 {live?.behavior?.capacity || 2000}개 행동 · 세션별 최근 80개 · 서버 메모리 관측{live?.behavior?.truncated ? " · 표본 일부 생략" : ""}</span><span>연결선은 실제 관측 순서 · 미니 막대는 최근 5분 행동 빈도</span></footer>
  </section>;
}
