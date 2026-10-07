import { useEffect, useRef, useState } from "react";
import { AdminHealth } from "../adminApi";
import Icon from "./SystemAtlasIcon";
import { AtlasArchitecture, AtlasSnapshot } from "./systemAtlasApi";
import type { MonitorView } from "./AtlasMonitoring";
import type { NexusQuality, NexusState } from "./atlasNexusWorld";
import "./atlasNexus.css";

const ms = (v?: number | null) => v == null ? "—" : v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`;
const num = (v?: number | null) => v == null ? "—" : v.toLocaleString("ko-KR");
type Props = { graph: AtlasArchitecture; live: AtlasSnapshot | null; health: AdminHealth | null; selected: string; onSelect: (id: string) => void; onView: (view: MonitorView, filter?: string) => void; paused: boolean; stale: boolean; healthStale: boolean };

export default function AtlasNexus({ graph, live, health, selected, onSelect, onView, paused, stale, healthStale }: Props) {
  const host = useRef<HTMLDivElement>(null), world = useRef<{ reset: () => void; invalidate: () => void; dispose: () => void } | null>(null);
  const [quality, setQuality] = useState<NexusQuality>(() => window.innerWidth <= 700 ? "balanced" : "cinematic");
  const [motion, setMotion] = useState(true), [ready, setReady] = useState(false), [failure, setFailure] = useState(false), [retry, setRetry] = useState(0);
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const current = useRef<NexusState>({ live, selected, motion, reduced });
  current.current = { live, selected, motion: motion && !paused, reduced };
  const callback = useRef(onSelect); callback.current = onSelect;
  useEffect(() => { const media = matchMedia("(prefers-reduced-motion: reduce)"); const change = () => setReduced(media.matches); media.addEventListener("change", change); return () => media.removeEventListener("change", change); }, []);
  useEffect(() => {
    let gone = false; setReady(false); setFailure(false);
    import("./atlasNexusWorld").then(({ createNexusWorld }) => {
      if (gone || !host.current) return;
      try { world.current = createNexusWorld(host.current, graph, quality, () => current.current, id => callback.current(id), () => { if (!gone) setRetry(n => n + 1); }); setReady(true); }
      catch { if (host.current) host.current.replaceChildren(); setFailure(true); }
    }).catch(() => { if (!gone) setFailure(true); });
    return () => { gone = true; world.current?.dispose(); world.current = null; };
  }, [graph, quality, retry]);
  useEffect(() => world.current?.invalidate(), [live, selected, motion, reduced, paused]);
  const node = graph.nodes.find(n => n.id === selected) || graph.nodes.find(n => n.id === "gateway")!;
  const stats = selected === "gateway" ? live?.api : live?.api.groups[selected] || live?.external.groups[selected];
  const inspect = () => onView(node.kind === "external" ? "external" : node.kind === "storage" ? "storage" : node.id === "gateway" ? "api" : "services");
  const services = graph.nodes.filter(n => n.kind === "service");
  const status = paused ? "OBSERVATION PAUSED" : stale || healthStale ? "SIGNAL DELAY" : !live ? "ACQUIRING SIGNAL" : live.api.errors || live.external.errors || health?.db.ok === false ? "ATTENTION REQUIRED" : "OBSERVATION ACTIVE";
  return <section className={`an-nexus ${ready ? "is-ready" : ""} ${failure ? "is-fallback" : ""}`} aria-label="3D 사이버 관제 센터">
    <div className="an-scene" ref={host}/><div className="an-vignette" aria-hidden="true"/><div className="an-film-grain" aria-hidden="true"/>
    <div className="an-context-note" role="status">그래픽 연결을 복구하고 있습니다. 관측 정보는 계속 갱신됩니다.</div>
    <div className="an-space-title"><div className="an-coordinate">SECTOR 01 <i/> K-STOCK HUB / CONTROL SPACE</div><h1>ATLAS<span>NEXUS</span></h1><p>데이터가 공간이 되는 곳.<br/>사이버 관제의 새로운 시야.</p></div>
    <div className="an-scene-controls"><label><span>그래픽 품질</span><select aria-label="3D 그래픽 품질" value={quality} onChange={e => setQuality(e.target.value as NexusQuality)}><option value="cinematic">시네마틱</option><option value="balanced">균형</option><option value="eco">절전</option></select></label><button onClick={() => { setMotion(m => !m); world.current?.invalidate(); }} aria-pressed={!motion} disabled={reduced} title={reduced ? "기기의 모션 감소 설정이 적용되었습니다" : "센티널과 공간 애니메이션 제어"}><Icon name={motion ? "pause" : "play"} size={13}/>{reduced ? "모션 감소" : motion ? "모션 정지" : "모션 재개"}</button><button onClick={() => world.current?.reset()} disabled={!ready} title="3D 카메라 초기화"><Icon name="refresh" size={14}/>시점 초기화</button></div>
    {!ready && !failure && <div className="an-scene-loading" role="status"><Icon name="atlas" size={36}/><span>관제 공간 초기화 중</span></div>}
    {failure && <div className="an-scene-loading an-scene-fallback" role="status"><Icon name="atlas" size={42}/><h2>저전력 관제 모드</h2><p>3D 공간을 사용할 수 없어 데이터 관제로 연결했습니다.</p><button onClick={() => setRetry(n => n + 1)}>3D 다시 연결</button></div>}
    <div className="an-core-caption"><span className="an-core-cross"/><b>API GATEWAY</b><span>TOPOLOGY / {graph.nodes.length} NODES</span><small>흐름 신호 · 최근 60초 관측</small></div>
    <aside className="an-hud an-hud-left" aria-label="핵심 지표와 서비스 선택"><header><span>01 / CORE TELEMETRY</span><Icon name="operations" size={16}/></header><div className="an-primary-stat"><span>API 처리량</span><strong>{live ? (live.api.count / 60).toFixed(2) : "—"}<small>req/s</small></strong><div className="an-mini-meter">{Array.from({ length: 24 }, (_, i) => <i key={i} className={live && i < Math.min(24, Math.ceil(live.api.count / 8)) ? "is-filled" : ""}/>)}</div></div><div className="an-vitals"><button onClick={() => onView("api")}><span>응답 P95</span><b>{ms(live?.api.p95_ms)}</b><Icon name="arrow" size={12}/></button><button onClick={() => onView("api", "errors")}><span>API 5xx / 실패</span><b className={live?.api.errors ? "an-red" : ""}>{num(live?.api.errors)}</b><Icon name="arrow" size={12}/></button><button onClick={() => onView("external")}><span>외부 HTTP / 60s</span><b>{num(live?.external.count)}</b><Icon name="arrow" size={12}/></button><button onClick={() => onView("storage")}><span>공유 DB</span><b className={health?.db.ok === false ? "an-red" : ""}>{healthStale ? "점검 지연" : health ? health.db.ok ? ms(health.db.ms) : "연결 실패" : "—"}</b><Icon name="arrow" size={12}/></button></div><div className="an-hud-divider"><span>DOMAIN CHANNELS</span><b>{services.length} SECTORS</b></div><div className="an-domains">{services.map((n, i) => { const s = live?.api.groups[n.id]; return <button key={n.id} onClick={() => onSelect(n.id)} aria-pressed={selected === n.id} className={`${selected === n.id ? "is-selected" : ""} ${s?.errors ? "has-error" : ""}`}><span>{String(i + 1).padStart(2, "0")}</span><i/><b>{n.id === "prediction" ? "AI 예측" : n.label.split(" · ")[0]}</b><small>{live ? s?.count || 0 : "—"}</small><Icon name="arrow" size={12}/></button>; })}</div></aside>
    <aside className="an-hud an-hud-right" aria-label="선택한 3D 영역 정보"><header><span>02 / DOMAIN FOCUS</span><span className="an-focus-dot"/></header><div className="an-focus-icon"><Icon name={node.id === "gateway" ? "atlas" : node.kind === "external" ? "external" : node.id} size={27}/><span>{node.id.toUpperCase()}</span></div><h2>{node.label}</h2><p>{node.subtitle}</p><dl><div><dt>요청 / 60초</dt><dd>{num(stats?.count)}</dd></div><div><dt>P95 지연</dt><dd>{ms(stats?.p95_ms)}</dd></div><div><dt>5xx / 실패</dt><dd className={stats?.errors ? "an-red" : ""}>{num(stats?.errors)}</dd></div><div><dt>등록 API</dt><dd>{node.endpoint_count}</dd></div></dl><button className="an-inspect" onClick={inspect}>상세 분석 열기<Icon name="arrow" size={15}/></button><div className="an-focus-note"><Icon name="info" size={12}/>{!live ? "관측 데이터 수집 중" : stats?.count ? "현재 프로세스의 최근 관측" : "최근 호출 표본 없음"}</div></aside>
    <div className="an-sentinel-tag"><span className="an-target-bracket"/><div><b>S-01 / SENTINEL</b><span>VISUAL PATROL UNIT</span></div><i/><span className="an-target-line"/></div>
    <div className="an-interaction-note"><Icon name="expand" size={13}/><span>공간을 드래그해 회전 · 노드를 선택해 탐색</span></div>
    <footer className="an-deck-footer"><div className={`an-observation-state ${stale || healthStale ? "is-stale" : paused ? "is-paused" : ""}`}><i/><span>{status}</span><small>프로세스 관측 / 최근 60초</small></div><div><span>활성 세션</span><b>{num(live?.active_sessions)}</b></div><button onClick={() => onView("storage")}><span>유효 캐시</span><b>{num(live?.cache.fresh)}</b></button><button onClick={() => onView("traces")}><span>요청 추적</span><b>{num(live?.traces?.length)}<Icon name="arrow" size={13}/></b></button><button onClick={() => onView("overview")} className="an-open-analysis"><Icon name="gateway" size={16}/>전체 운영 요약<Icon name="arrow" size={15}/></button></footer>
  </section>;
}
