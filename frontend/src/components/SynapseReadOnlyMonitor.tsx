import { ComponentType, useEffect, useMemo, useRef, useState } from "react";
import { AdminAuthError, adminApi, clearMonitorAccess, getMonitorAccess, type ActivityEvent, type ApiPulseEvent, type MonitorGraph } from "../adminApi";
import { Link } from "../router";
import { startVisibilityAwareInterval } from "../pollVisibility";
import { useDocumentTitle } from "../useDocumentTitle";
import { apiId } from "../monitor/synapseModel";
import type { AtlasArchitecture, AtlasSnapshot, AtlasStats } from "./systemAtlasApi";
import type { MonitorView } from "./AtlasMonitoring";
import SynapseObservatory from "./SynapseObservatory";

const colors=["#58e9db","#6daaff","#b698ff","#ffc27c","#ff759c","#a5db8c","#e5a5ef"];
function stats(events:ApiPulseEvent[]):AtlasStats {
  const sorted=events.map(e=>e.ms).sort((a,b)=>a-b),count=events.length;
  return {count,errors:events.filter(e=>!e.status||e.status>=500).length,client_errors:events.filter(e=>e.status>=400&&e.status<500).length,
    avg_ms:count?events.reduce((s,e)=>s+e.ms,0)/count:null,p50_ms:count?sorted[Math.ceil(count*.5)-1]:null,p95_ms:count?sorted[Math.ceil(count*.95)-1]:null,last_at:count?Math.max(...events.map(e=>e.ts)):null};
}
export function monitorArchitecture(source:MonitorGraph):AtlasArchitecture {
  const groups=[...new Set(source.nodes.filter(n=>n.kind==="api").map(n=>n.group))];
  const color=(group:string)=>colors[Math.max(0,groups.indexOf(group))%colors.length];
  const ids=new Map(source.nodes.map(n=>[n.id,n.kind==="api"&&n.path?apiId(n.path):n.id]));
  return {nodes:[{id:"gateway",label:"API 게이트웨이",subtitle:"API PULSE",kind:"gateway",color:"#b9ecff",description:"서버에서 관측된 완료 API 요청",modules:[],endpoint_count:source.nodes.filter(n=>n.kind==="api").length},
    ...groups.map(id=>({id,label:id,subtitle:"SERVICE DOMAIN",kind:"service" as const,color:color(id),description:`${id} 영역의 등록 API와 선언된 연결`,modules:[],endpoint_count:source.nodes.filter(n=>n.kind==="api"&&n.group===id).length})),
    ...source.nodes.filter(n=>n.kind!=="api").map(n=>({id:n.id,label:n.label,subtitle:n.path||n.group,kind:n.kind==="page"?"client" as const:"storage" as const,color:color(n.group),description:n.path||"소스에 선언된 저장소 / 외부 의존성 · 개별 HTTP 및 SQL 계측 없음",modules:[],endpoint_count:0}))],
    edges:[...groups.map(id=>({id:`gateway:${id}`,source:"gateway",target:id,kind:"declared",protocol:"REST",evidence:"API 영역 분류"})),...source.edges.map((e,i)=>({id:`legacy:${i}`,source:ids.get(e.source)||e.source,target:ids.get(e.target)||e.target,kind:"declared",protocol:e.kind,evidence:"선언된 페이지 호출 / API 의존성 · 요청별 인과관계 아님"}))],
    endpoints:source.nodes.filter(n=>n.kind==="api"&&n.path).map(n=>({path:n.path!,methods:n.methods||["GET"],group:n.group,module:"",function:n.label,dependencies:[]})),modules:[],frontend:{},backend_dependencies:{},
    coverage:{architecture:"서버의 등록 API 및 선언된 페이지·저장소 연결",traffic:"현재 화면에서 수신한 최근 60초 API 표본",limitations:["모니터 전용 권한에는 외부 HTTP·SQL·서버 상태 계측이 포함되지 않습니다.",...source.warnings]}};
}

export default function SynapseReadOnlyMonitor({Lock}:{Lock:ComponentType<{onUnlocked:()=>void}>}) {
  useDocumentTitle("SYNAPSE · 통신 모니터링");
  const [authed,setAuthed]=useState(()=>!!getMonitorAccess()),[source,setSource]=useState<MonitorGraph|null>(null);
  const [error,setError]=useState<string|null>(null),[paused,setPaused]=useState(false),[retry,setRetry]=useState(0);
  const [events,setEvents]=useState<ApiPulseEvent[]>([]),[actions,setActions]=useState<ActivityEvent[]>([]),[sessions,setSessions]=useState(0);
  const [at,setAt]=useState<number|null>(null),[view,setView]=useState<MonitorView|null>(null);
  const cursors=useRef({api:0,activity:0}), detail=useRef<HTMLElement>(null);
  const architecture=useMemo(()=>source?monitorArchitecture(source):null,[source]);
  const denied=(e:unknown)=>{if(e instanceof AdminAuthError){clearMonitorAccess();setAuthed(false);setSource(null);setEvents([]);setActions([]);setAt(null);cursors.current={api:0,activity:0};return true;}return false;};
  useEffect(()=>{if(!authed)return;let gone=false;adminApi.monitorGraph().then(g=>{if(!gone){setSource(g);setError(null);}}).catch(e=>{if(!gone&&!denied(e))setError("연결 구조를 불러오지 못했습니다. 다시 연결해 주세요.");});return()=>{gone=true;};},[authed,retry]);
  useEffect(()=>{
    if(!authed||!source||paused)return;let gone=false,busy=false;
    const poll=async()=>{if(busy)return;busy=true;try{
      const data=await adminApi.monitorPulse(cursors.current.api,cursors.current.activity);if(gone)return;
      const now=Date.now()/1000;cursors.current={api:data.api_cursor,activity:data.activity_cursor};
      setEvents(old=>{const byKey=new Map([...old,...data.api].filter(e=>e.ts>=now-60).map(e=>[`${e.id}:${e.ts}`,e]));return [...byKey.values()].slice(-6000);});
      setActions(old=>{const byKey=new Map([...old,...data.activity].map(e=>[e.id,e]));return [...byKey.values()].slice(-100);});
      setAt(now);setSessions(data.active_sessions);setError(null);
    }catch(e){if(!gone&&!denied(e))setError("실시간 신호 수신이 지연되고 있습니다. 마지막 수신 표본을 표시합니다.");}finally{busy=false;}};
    void poll();const stop=startVisibilityAwareInterval(()=>void poll(),1000);return()=>{gone=true;stop();};
  },[authed,source,paused,retry]);
  const live=useMemo<AtlasSnapshot|null>(()=>{
    if(!architecture||at===null)return null;
    const groups:Record<string,AtlasStats>={};architecture.nodes.filter(n=>n.kind==="service").forEach(n=>{const paths=new Set(architecture.endpoints.filter(e=>e.group===n.id).map(e=>e.path));groups[n.id]=stats(events.filter(e=>paths.has(e.route)));});
    const bins=Array.from({length:12},(_,i)=>{const start=at-60+i*5;return {...stats(events.filter(e=>e.ts>=start&&e.ts<start+5)),at:start};});
    return {at,active_sessions:sessions,observed_edges:{},api:{...stats(events),window_s:60,window_truncated:events.length>=6000,groups,endpoints:architecture.endpoints.flatMap(e=>e.methods.map(method=>({...stats(events.filter(r=>r.route===e.path&&r.method===method)),path:e.path,method}))),recent:[...events].sort((a,b)=>b.ts-a.ts),breakdown:{status:{},latency:[],timeline:bins}},
      external:{...stats([]),started_at:at,window_s:60,window_truncated:false,groups:{},hosts:[],recent:[],flows:[]},traces:[],cache:{entries:0,fresh:0,stale:0,refreshing:0,capacity:0},database:{mode:"unobserved",separate_realestate:false,realestate_mode:"unobserved"}};
  },[architecture,events,at,sessions]);
  const openView=(next:MonitorView)=>{setView(next);window.setTimeout(()=>detail.current?.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"start"}),0);};
  if(!authed)return <Lock onUnlocked={()=>setAuthed(true)}/>;
  return <main className="sn-standalone"><header className="sn-access-bar"><Link to="/">← K-STOCK HUB</Link><span>MONITOR ACCESS · {sessions} 접속</span><button onClick={()=>setPaused(p=>!p)}>{paused?"관측 재개":"관측 정지"}</button></header>
    {error&&<div className="sn-access-error" role="alert">{error}<button onClick={()=>setRetry(r=>r+1)}>다시 연결</button></div>}
    {architecture?<SynapseObservatory graph={architecture} live={live} health={null} selected="gateway" onSelect={()=>{}} onView={openView} paused={paused} stale={!!error} healthStale={false} limited/>:<p className="sn-access-loading">통신 연결 구조를 불러오고 있습니다…</p>}
    <section className="sn-access-detail" ref={detail} aria-label="모니터 추가 관측"><header><h2>{view==="stack"?"관측 범위":"API · 사용자 행동 관측"}</h2><span>모니터 전용 권한 · 외부 HTTP / DB 상태 계측 미포함</span></header>
      {view&&<div className="sn-access-summary"><p>{architecture?.coverage.traffic}</p>{architecture?.coverage.limitations.map((s,i)=><p key={i}>{s}</p>)}<button onClick={()=>setView(null)}>설명 접기</button></div>}
      <h3>최근 사용자 행동 <small>API 호출과 별도 관측 · 최대 100개</small></h3><div className="sn-access-actions">{[...actions].reverse().map(e=><div key={e.id}><time>{new Date(e.created_at).toLocaleTimeString("en-GB",{timeZone:"Asia/Seoul"})}</time><b>{e.type}</b><code>{(e.path||"/").split("?")[0]}</code></div>)}{!actions.length&&<p>사용자 행동 표본을 기다립니다.</p>}</div>
    </section>
  </main>;
}
