import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import type { AdminHealth } from "../adminApi";
import type { AtlasArchitecture, AtlasSnapshot } from "./systemAtlasApi";
import type { MonitorView } from "./AtlasMonitoring";
import Icon from "./SystemAtlasIcon";
import { apiId, buildSynapseGraph, hostId, journalEvents, observedFlows, snapshotSignals, statsFor, type JournalEvent, type ObservedFlow } from "../monitor/synapseModel";
import { SynapseScene, type SceneOptions } from "../monitor/synapseScene";
import "./synapseObservatory.css";

const num = (value?: number | null) => value == null ? "—" : value.toLocaleString("ko-KR");
const ms = (value?: number | null) => value == null ? "—" : value >= 1000 ? `${(value/1000).toFixed(2)}s` : `${Math.round(value)}ms`;
const clockFormat = new Intl.DateTimeFormat("en-GB", {hour12:false, timeZone:"Asia/Seoul", hour:"2-digit", minute:"2-digit", second:"2-digit"});
const time = (ts: number) => clockFormat.format(ts*1000);
const tint = (color: string) => ({"--signal":color} as CSSProperties);
const kindLabel: Record<string,string> = {core:"게이트웨이",service:"서비스",api:"API",module:"모듈",host:"외부 연동",storage:"저장소",client:"클라이언트"};
interface Props {
  graph: AtlasArchitecture; live: AtlasSnapshot | null; health: AdminHealth | null; selected: string;
  onSelect: (id: string) => void; onView: (view: MonitorView, filter?: string) => void;
  paused: boolean; stale: boolean; healthStale: boolean; limited?: boolean;
}

export default function SynapseObservatory({graph,live,health,onSelect,onView,paused,stale,healthStale,limited=false}:Props) {
  const [selected,setSelected]=useState("gateway"),[domain,setDomain]=useState("all"),[query,setQuery]=useState("");
  const [isolate,setIsolate]=useState(false),[faultsOnly,setFaultsOnly]=useState(false),[motion,setMotion]=useState(true);
  const [autoRotate,setAutoRotate]=useState(true),[inspectorOpen,setInspectorOpen]=useState(false);
  const [speed,setSpeed]=useState(1.5),[quality,setQuality]=useState<SceneOptions["quality"]>("balanced");
  const [reduced,setReduced]=useState(()=>matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [failure,setFailure]=useState<string|null>(null),[retry,setRetry]=useState(0),[ready,setReady]=useState(false);
  const [hover,setHover]=useState<string|null>(null),[performance,setPerformance]=useState({fps:0,draws:0});
  const [journalFilter,setJournalFilter]=useState("all"),[held,setHeld]=useState(false),[heldEvents,setHeldEvents]=useState<JournalEvent[]>([]);
  const [eventKey,setEventKey]=useState<string|null>(null),[replaying,setReplaying]=useState(false),[fullscreenError,setFullscreenError]=useState("");
  const root=useRef<HTMLElement>(null),host=useRef<HTMLDivElement>(null),labels=useRef<HTMLDivElement>(null),scene=useRef<SynapseScene|null>(null);
  const replayTimer=useRef<number>();
  const receivedSignals=useRef(new Set<string>()),cameraView=useRef<{position:number[];target:number[]}|null>(null);
  // A stable key prevents rebuilding the scene on every metrics refresh.
  const knownFlows=useRef({graph,entries:new Map<string,ObservedFlow>()});
  if(knownFlows.current.graph!==graph)knownFlows.current={graph,entries:new Map()};
  const flowKey=useMemo(()=>{
  observedFlows(live).forEach(f=>{const key=`${f.route}\n${f.host}`,previous=knownFlows.current.entries.get(key);if(previous||knownFlows.current.entries.size<10000)knownFlows.current.entries.set(key,{...f,target:f.target||previous?.target});});
    return JSON.stringify([...knownFlows.current.entries.values()]);
  },[graph,live]);
  const model=useMemo(()=>buildSynapseGraph(graph,JSON.parse(flowKey)),[graph,flowKey]);
  const signals=useMemo(()=>snapshotSignals(live),[live]);
  const events=useMemo(()=>journalEvents(live),[live]);
  const faults=useMemo(()=>{
    const ids=new Set<string>();
    live?.api.endpoints.forEach(e=>{if(e.errors||e.client_errors)ids.add(apiId(e.path));});
    live?.external.hosts.forEach(e=>{if(e.errors||e.client_errors)ids.add(hostId(e.host));});
    for(const [id,s] of Object.entries({...live?.api.groups,...live?.external.groups}))if(s.errors||s.client_errors)ids.add(id);
    if(live&&(live.api.errors||live.api.client_errors))ids.add("gateway");
    return ids;
  },[live]);
  const node=model.nodes[model.byId.get(selected)??model.byId.get("gateway")??0];
  const stats=node?statsFor(node,live):null;
  const connections=node?(model.adjacency.get(model.byId.get(node.id)!)||[]).map(i=>model.links[i]):[];
  const found=useMemo(()=>model.nodes.filter(n=>(domain==="all"||n.group===domain||n.id===domain)&&(!faultsOnly||faults.has(n.id))&&`${n.label} ${n.detail}`.toLowerCase().includes(query.toLowerCase())),[model,domain,query,faultsOnly,faults]);
  const visibleEvents=(held?heldEvents:events).filter(e=>(journalFilter==="all"||e.type===journalFilter||journalFilter==="errors"&&(e.status===0||e.status>=400))&&
    (domain==="all"||graph.endpoints.some(p=>p.path===e.route&&p.group===domain)||e.host&&graph.nodes.find(n=>n.id===domain)?.hosts?.includes(e.host)));
  const chosenEvent=events.find(e=>e.key===eventKey)||heldEvents.find(e=>e.key===eventKey);
  const trace=chosenEvent&&live?.traces?.find(t=>chosenEvent.type==="API"?t.request.id===chosenEvent.id:t.calls.some(c=>c.id===chosenEvent.id));
  const hovered=hover?model.nodes[model.byId.get(hover)??-1]:null;
  const select=(id:string,focus=false)=>{setSelected(id);setInspectorOpen(true);setEventKey(null);const n=model.nodes[model.byId.get(id)??-1];if(n)onSelect(n.parent||n.id);if(focus)scene.current?.focus(id);};
  const selectRef=useRef(select);selectRef.current=select;
  useEffect(()=>{const media=matchMedia("(prefers-reduced-motion: reduce)");const change=()=>setReduced(media.matches);media.addEventListener("change",change);return()=>media.removeEventListener("change",change);},[]);
  useEffect(()=>{
    if(!host.current||!labels.current)return;
    setReady(false);setFailure(null);let world:SynapseScene|null=null;
    try{world=new SynapseScene(host.current,labels.current,model,receivedSignals.current);if(cameraView.current)world.restoreView(cameraView.current);world.onSelect=id=>selectRef.current(id);world.onHover=setHover;world.onStats=(fps,draws)=>setPerformance({fps,draws});world.onFailure=setFailure;world.onReady=()=>setReady(true);scene.current=world;}
    catch{setFailure("3D 그래픽을 시작하지 못했습니다. 아래 노드 목록과 로그에서 관측을 계속할 수 있습니다.");}
    return()=>{if(world)cameraView.current=world.captureView();world?.dispose();scene.current=null;};
  },[retry]);
  useEffect(()=>{scene.current?.updateGraph(model);},[model,retry]);
  useEffect(()=>{scene.current?.applyOptions({selected,domain,query,isolate,faultsOnly,motion:motion&&!reduced,autoRotate,paused:paused||stale,speed,quality,faults});},[model,retry,selected,domain,query,isolate,faultsOnly,motion,reduced,autoRotate,paused,stale,speed,quality,faults]);
  useEffect(()=>{scene.current?.ingest(signals);},[signals,model,retry,paused,stale,motion,reduced]);
  useEffect(()=>()=>window.clearTimeout(replayTimer.current),[]);
  const replay=()=>{scene.current?.ingest(signals,true);setReplaying(true);window.clearTimeout(replayTimer.current);replayTimer.current=window.setTimeout(()=>setReplaying(false),2500);};
  const openEvent=(e:JournalEvent)=>{const id=e.type==="API"?apiId(e.route||""):hostId(e.host||"");select(id,true);setEventKey(e.key);};
  const selectDomain=(id:string)=>{setDomain(id);setQuery("");setIsolate(false);if(id!=="all")select(id,true);else scene.current?.home();};
  const full=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await root.current?.requestFullscreen();setFullscreenError("");}catch{setFullscreenError("이 브라우저에서는 전체화면을 사용할 수 없습니다.");}};
  const state=paused?"관측 일시 정지":stale?"수신 지연 · 마지막 표본":live?"실제 표본 수신 중":"관측 연결 중";
  const timeline=live?.api.breakdown?.timeline||[];

  return <section className={`sn-observatory sn-cinematic ${!motion||reduced||paused||stale?"is-still":""}`} ref={root} aria-label="시냅스 통신 관제">
    <header className="sn-masthead"><div className="sn-brand"><div className="sn-brand-mark" aria-hidden="true">✳</div><div><div className="sn-overline">K-STOCK HUB <span>/</span> COMMUNICATION OBSERVATORY</div><h1>SYNAPSE<span>연결의 우주</span><sup>01</sup></h1></div></div><div className="sn-mast-status"><span className={`sn-live ${paused||stale?"is-muted":""}`}><i/>{state}</span><small>단일 프로세스 · 최근 60초</small></div></header>
    <div className="sn-metrics">
      <div><span>TOPOLOGY <small>구조 노드 / 연결</small></span><strong>{num(model.nodes.length)}<em>/ {num(model.links.length)}</em></strong><small>API · 소스 모듈 · 외부 호스트</small></div>
      <button onClick={()=>onView("api")}><span>API PULSE <small>완료 요청</small></span><strong>{live?(live.api.count/Math.max(1,live.api.window_s)).toFixed(2):"—"}<em>req/s</em></strong><small>{num(live?.api.count)}건 / {live?.api.window_s||60}초</small></button>
      <button onClick={()=>onView("external")}><span>EXTERNAL <small>외부 통신</small></span><strong>{limited?"—":num(live?.external.hosts.length)}<em>hosts</em></strong><small>{limited?"현재 권한에서 계측 미제공":`${num(live?.external.count)} HTTP 표본`}</small></button>
      <button onClick={()=>onView("api","slow")}><span>LATENCY <small>응답 지연</small></span><strong>{ms(live?.api.p95_ms)}<em>P95</em></strong><small>P50 {ms(live?.api.p50_ms)}</small></button>
      <button className="sn-metric-alert" onClick={()=>{setFaultsOnly(f=>!f);setDomain("all");setInspectorOpen(true);}} aria-pressed={faultsOnly}><span>ATTENTION <small>실패 · 응답 오류</small></span><strong>{live?num(live.api.errors+live.external.errors):"—"}<em>5xx / 전송</em></strong><small>4xx {live?num(live.api.client_errors+live.external.client_errors):"—"} · 오류 노드 강조 ↗</small></button>
    </div>
    <div className={`sn-workspace ${inspectorOpen?"has-inspector":""}`}><div className="sn-universe-panel">
      <div className="sn-universe-head"><div><i/><span>NEURAL TOPOLOGY</span><small>입체 통신망</small></div><label className="sn-search sn-command-search"><Icon name="search" size={16}/><input aria-label="통신 노드 검색" value={query} onFocus={()=>setInspectorOpen(true)} onChange={e=>{setQuery(e.target.value);setInspectorOpen(true);}} placeholder="API · 모듈 · 호스트 탐색"/>{query&&<button onClick={()=>setQuery("")} aria-label="노드 검색 초기화">×</button>}</label><span className="sn-render-status">{ready&&!failure?`${performance.fps||"—"} FPS` : "GRAPHICS CONNECTING"}<b>WEBGL</b></span><button className="sn-inspector-toggle" aria-expanded={inspectorOpen} onClick={()=>setInspectorOpen(v=>!v)}><Icon name="trace" size={14}/>{inspectorOpen?"패널 접기":"노드 탐색"}</button></div>
      <div className="sn-universe">
        <div className="sn-nebula" aria-hidden="true"/><div className="sn-scene" ref={host}/><div className="sn-labels" ref={labels}/>
        <div className="sn-universe-caption"><span>LIVE SYSTEM / 001</span><h2>A living<br/><em>constellation.</em></h2><p>연결이 모여, 하나의 우주가 됩니다.</p><div className="sn-orbit-caption"><i/> SYNAPTIC FIELD <span>01 — ∞</span></div></div>
        <div className="sn-map-meta"><span><i/> 구조 연결</span><span><i/> 실제 요청 재생</span><span><i/> 오류 신호</span></div>
        <div className="sn-coordinate" aria-hidden="true"><span>Y</span><b>╱</b><i>└── X</i><small>3D ORBIT</small></div>
        {(!ready||failure)&&<div className="sn-fallback" role="status"><Icon name="atlas" size={32}/><b>{failure?"목록 관제 사용 가능":"신경망을 구성하고 있습니다"}</b><p>{failure||"실제 서비스와 소스 의존성을 입체 공간에 배치합니다."}</p>{failure&&<button onClick={()=>setRetry(r=>r+1)}>3D 다시 연결</button>}</div>}
        {hovered&&<div className="sn-hover" style={tint(hovered.color)}><span>{kindLabel[hovered.kind]}</span><b>{hovered.label}</b><small>클릭하여 연결과 관측 표본 탐색</small></div>}
        <div className="sn-flight-controls"><button onClick={()=>scene.current?.home()} aria-label="전체 연결망 보기" title="전체 연결망 보기"><Icon name="atlas" size={17}/></button><button onClick={()=>scene.current?.zoom(.82)} aria-label="연결망 확대">+</button><button onClick={()=>scene.current?.zoom(1.22)} aria-label="연결망 축소">−</button><button onClick={()=>void full()} aria-label="연결망 전체화면"><Icon name="expand" size={15}/></button></div>
        <div className="sn-space-foot"><span>드래그 회전 <i>·</i> 휠 확대 <i>·</i> 노드 선택</span><b>{replaying?"보존 표본 재생 중":paused?"PAUSED":stale?"STALE DATA":!live?.api.count&&!live?.external.count?"WAITING FOR SIGNAL":"OBSERVED SIGNALS"}</b></div>
      </div>
      <nav className="sn-domains" aria-label="통신 영역 필터"><button onClick={()=>selectDomain("all")} aria-pressed={domain==="all"}><i style={{background:"#bcdae6"}}/>전체 영역<small>{graph.nodes.length}</small></button>{model.domains.map(n=><button key={n.id} style={tint(n.color)} onClick={()=>selectDomain(n.id)} aria-pressed={domain===n.id}><i/>{n.label.split(" · ")[0]}<small>{num(live?.api.groups[n.id]?.count||0)}</small></button>)}</nav>
      <div className="sn-control-bar"><button className="sn-rotation-toggle" aria-pressed={autoRotate&&!reduced} disabled={reduced} onClick={()=>setAutoRotate(v=>!v)}><Icon name="refresh" size={14}/>{autoRotate&&!reduced?"자동 회전 정지":"자동 회전 시작"}</button><label>흐름 속도<select aria-label="신호 재생 속도" value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={.7}>차분하게</option><option value={1.5}>빠르게</option><option value={3}>초고속</option></select></label><label>그래픽<select aria-label="신경망 그래픽 품질" value={quality} onChange={e=>setQuality(e.target.value as SceneOptions["quality"])}><option value="high">정밀</option><option value="balanced">균형</option><option value="eco">절전</option></select></label><button aria-pressed={!motion||reduced} disabled={reduced} onClick={()=>setMotion(m=>!m)}><Icon name={motion&&!reduced?"pause":"play"} size={13}/>{reduced?"모션 감소":motion?"모션 정지":"모션 재개"}</button><button onClick={replay} disabled={!signals.length||paused||stale||!motion||reduced||!!failure}><Icon name="play" size={13}/>표본 재생</button></div>
    </div>
    <aside className="sn-inspector" aria-label="신경망 노드 상세" hidden={!inspectorOpen}>
      <header><span>NODE INTELLIGENCE</span><button className="sn-inspector-close" onClick={()=>setInspectorOpen(false)} aria-label="노드 상세 패널 닫기">×</button></header>

      {query||faultsOnly?<div className="sn-search-results"><div><b>{num(found.length)}개 노드</b><button onClick={()=>{setQuery("");setFaultsOnly(false);}}>필터 해제</button></div>{found.slice(0,60).map(n=><button key={n.id} onClick={()=>select(n.id,true)} style={tint(n.color)} aria-pressed={node?.id===n.id}><i/><span>{n.label}</span><small>{kindLabel[n.kind]}</small></button>)}{!found.length&&<p>조건에 맞는 노드가 없습니다.</p>}{found.length>60&&<p>상위 60개 표시 · 검색어를 좁혀 주세요.</p>}</div>:null}
      {node&&<><div className="sn-node-identity" style={tint(node.color)}><div className="sn-node-glyph"><Icon name={node.kind==="module"?"code":node.kind==="api"?"gateway":node.kind==="host"?"external":node.id} size={25}/></div><span>{kindLabel[node.kind]} <i>/ {String((model.byId.get(node.id)||0)+1).padStart(3,"0")}</i></span><h2>{node.label}</h2><p>{node.detail}</p><div className="sn-node-state" data-state={stale?"stale":stats?.errors?"error":stats?.client_errors?"warn":stats?.count?"active":"idle"}><i/>{stale?"마지막 수신 표본":stats?.errors?"실패 관측":stats?.client_errors?"4xx 응답 관측":stats?.count?"통신 관측":node.kind==="module"?"정적 의존성 · 실행 계측 없음":"최근 통신 표본 없음"}</div></div>
      <div className="sn-node-metrics"><div><span>호출 / 60s</span><b>{node.kind==="module"?"—":num(stats?.count)}</b></div><div><span>평균 지연</span><b>{ms(stats?.avg_ms)}</b></div><div><span>연결</span><b>{num(connections.length)}</b></div></div>
      <div className="sn-node-actions"><button onClick={()=>scene.current?.focus(node.id)}><Icon name="search" size={13}/>노드로 이동</button><button aria-pressed={isolate} onClick={()=>setIsolate(f=>!f)}><Icon name="trace" size={13}/>인접 연결만</button></div>
      <div className="sn-connections"><header><h3>연결된 노드</h3><span>{connections.length} LINKS</span></header><div>{connections.slice(0,80).map(e=>{const next=model.nodes[e.source===model.byId.get(node.id)?e.target:e.source];return <button key={e.id} style={tint(next.color)} onClick={()=>select(next.id,true)} title={e.label}><span className="sn-link-direction">{e.source===model.byId.get(node.id)?"↗":"↙"}</span><span><b>{next.label}</b><small>{e.kind==="http"?"관측된 HTTP 경로":e.kind==="request"?"완료 요청 수신 경로":"선언된 구조 의존성"}</small></span><i/></button>;})}{!connections.length&&<p>등록된 연결이 없습니다.</p>}{connections.length>80&&<p>80개 표시 · 검색으로 나머지 노드를 탐색할 수 있습니다.</p>}</div></div></>}
      <footer className="sn-inspector-foot"><span><i/>서버 / DB {limited?"계측 미제공":healthStale?"점검 지연":health?health.db.ok?"응답 확인":"점검 실패":"점검 대기"}</span><button onClick={()=>onView("storage")}>자세히 ↗</button></footer>
    </aside></div>
    {fullscreenError&&<p className="sn-notice" role="status">{fullscreenError}</p>}
    <div className="sn-lower"><section className="sn-journal"><header><div><span className="sn-overline">SIGNAL JOURNAL</span><h2>신호의 기록 <small>{visibleEvents.length} EVENTS</small></h2></div><div className="sn-journal-tools"><select aria-label="신호 로그 필터" value={journalFilter} onChange={e=>setJournalFilter(e.target.value)}><option value="all">전체 통신</option><option value="API">API 요청</option><option value="HTTP">외부 HTTP</option><option value="errors">오류 · 4xx</option></select><button aria-pressed={held} onClick={()=>{if(!held)setHeldEvents(events);setHeld(h=>!h);}}>{held?"로그 갱신 재개":"로그 고정"}</button></div></header><div className="sn-log-columns"><span>TIME / KST</span><span>TYPE</span><span>ROUTE / HOST</span><span>STATUS</span><span>LATENCY</span></div><div className="sn-event-list" role="log" aria-label="실제 통신 로그" aria-live="off">{visibleEvents.slice(0,100).map(e=><button key={e.key} className={`sn-event ${e.status===0||e.status>=400?"is-error":""}`} aria-pressed={e.key===eventKey} onClick={()=>openEvent(e)}><time>{time(e.ts)}</time><span className={`sn-event-type is-${e.type.toLowerCase()}`}>{e.type}</span><code title={e.type==="HTTP"?e.host:e.route}>{e.type==="HTTP"?e.host:e.route}</code><b>{e.status||"ERR"}</b><small>{ms(e.ms)}</small></button>)}{!visibleEvents.length&&<div className="sn-empty"><span>◎</span><b>{live?"새로운 통신 신호를 기다립니다":"관측 서버에 연결하고 있습니다"}</b><p>수신된 실제 요청만 이곳에 기록됩니다.</p></div>}</div><footer><span>완료 요청의 수신 시점 재생 · 화면 로그 최대 100개</span><button onClick={()=>onView("traces")}>전체 요청 추적 ↗</button></footer></section>
    <section className="sn-telemetry"><header><span className="sn-overline">{chosenEvent?"SIGNAL INSPECTOR":"TRAFFIC SPECTRUM"}</span><h2>{chosenEvent?"선택한 통신 경로":"60초의 맥박"}</h2></header>{chosenEvent?<div className="sn-trace"><div><b>{chosenEvent.method}</b><code>{chosenEvent.type==="HTTP"?chosenEvent.host:chosenEvent.route}</code><span>{chosenEvent.status||"ERR"} · {ms(chosenEvent.ms)}</span></div>{trace?<><p>요청 #{trace.request.trace_id||trace.request.id}에 연결된 외부 HTTP</p>{trace.calls.map(c=><button key={c.id} onClick={()=>select(hostId(c.host||""),true)}><span>↳</span><code>{c.host}</code><b>{ms(c.ms)}</b></button>)}{!trace.calls.length&&<p>연결된 외부 HTTP 표본이 없습니다.</p>}{trace.calls_truncated&&<p>보존 한도로 일부 호출이 생략되었습니다.</p>}</>:<p>이 표본에 연결된 요청 추적 정보가 없습니다.</p>}<button className="sn-text-button" onClick={()=>setEventKey(null)}>← 트래픽 추이</button></div>:<><div className="sn-spectrum" aria-label="최근 60초 API 요청량">{timeline.length?timeline.map((b,i)=><div key={i} title={`${time(b.at)} · ${b.count}건 · 오류 ${b.errors}`}><i style={{height:`${Math.max(2,b.count/Math.max(1,...timeline.map(t=>t.count))*100)}%`,background:b.errors?"#fb7894":undefined}}/></div>):<span>시간대별 표본 대기 중</span>}</div><div className="sn-spectrum-axis"><span>−60s</span><span>−30s</span><span>NOW</span></div><div className="sn-traffic-key"><span><i/>완료 요청</span><span><i/>실패 포함 구간</span></div><p>빛은 관측된 완료 요청을 압축 재생합니다. 흐름 속도는 화면 재생 속도이며 실제 네트워크 지연과 다릅니다.</p></>}<footer><b>{live?time(live.at):"—"}</b><span>마지막 표본 · KST</span></footer></section></div>
    <footer className="sn-coverage"><span>구조 {num(model.nodes.length)} 노드 · {num(model.links.length)} 연결{model.omitted?` · 표시 한도 밖 ${num(model.omitted)}개`:""} · {performance.draws||"—"} draw calls</span><span>{live?.api.window_truncated||live?.external.window_truncated?"관측 버퍼 한도로 일부 표본 생략 · ":""}SQL·SDK·브라우저 직접 통신은 별도 계측 필요 <button onClick={()=>onView("stack")}>관측 범위 ↗</button></span></footer>
  </section>;
}
