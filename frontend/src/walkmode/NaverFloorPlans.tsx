import { useEffect, useRef, useState } from "react";
import type { Drawing, ImageAnalysis } from "./interior/plan/imagePlan";

interface Catalogue {status:string;name?:string;naverId?:string;plans:Drawing[];types?:Drawing[]}
const lists=new Map<string,Promise<Catalogue>>(),results=new Map<string,Promise<ImageAnalysis>>();
function once<T>(cache:Map<string,Promise<T>>,key:string,fetcher:()=>Promise<T>){
  const hit=cache.get(key);if(hit)return hit;
  const task=fetcher().catch(e=>{cache.delete(key);throw e;});cache.set(key,task);
  while(cache.size>32)cache.delete(cache.keys().next().value!);return task;
}
async function json<T>(url:string,timeout=20000):Promise<T>{const r=await fetch(url,{signal:AbortSignal.timeout(timeout)});if(!r.ok)throw Error("source");return r.json();}
export function drawingImage(d:Drawing){return `/api/realestate/floor-plan-image?${new URLSearchParams({naver_id:d.naverId,key:d.key})}`;}

export type DrawingStatus="loading"|"ready"|"unavailable"|"needs_review";
export default function NaverFloorPlans({name,lat,lon,town,region,area,onAnalysis,onStatus,onAreaChoice,rejectedKey,onRetry}:{name:string;lat:number;lon:number;town:string;region:string;area:number|undefined;onAnalysis:(analysis:ImageAnalysis|null)=>void;onStatus:(status:DrawingStatus)=>void;onAreaChoice:(drawing:Drawing)=>void;rejectedKey?:string|null;onRetry?:()=>void}) {
 const [data,setData]=useState<Catalogue|null>(null),[loadedIdentity,setLoadedIdentity]=useState(""),[message,setMessage]=useState("원본 평면도 목록을 확인하는 중…"),[selected,setSelected]=useState(""),[analysis,setAnalysis]=useState<ImageAnalysis|null>(null),[zoom,setZoom]=useState(false),[retry,setRetry]=useState(0);
 const callback=useRef(onAnalysis);callback.current=onAnalysis;
 const statusCallback=useRef(onStatus);statusCallback.current=onStatus;
 const [failed,setFailed]=useState(false);
 const identity=`${name}|${lat.toFixed(5)}|${lon.toFixed(5)}|${town}|${region}`;
 useEffect(()=>{let active=true;setData(null);setSelected("");setAnalysis(null);callback.current(null);statusCallback.current("loading");setMessage("원본 평면도 목록을 확인하는 중…");
  const url=`/api/realestate/floor-plans?${new URLSearchParams({name,lat:String(lat),lon:String(lon),town,region})}`;
  void once(lists,identity+retry,()=>json<Catalogue>(url)).then(d=>{if(!active)return;setData(d);setLoadedIdentity(identity);if(d.status!=="available")statusCallback.current("unavailable");setMessage(d.status==="available"?"":"이 단지의 원본 도면을 아직 확인하지 못했습니다. 실제 도면으로 표시하지 않습니다.");}).catch(()=>{if(active){setMessage("원본 도면 서버에 연결하지 못했습니다.");statusCallback.current("unavailable");}});return()=>{active=false;};
 },[identity,retry]);
 const matches=loadedIdentity===identity?data?.plans.filter(p=>area!==undefined&&Math.abs(p.exclusiveArea-area)<=.005)??[]:[];
 const severalTypes=new Set(matches.map(p=>p.typeId)).size>1;
 const chosen=matches.find(p=>p.key===selected)??(severalTypes?undefined:matches[0]);
 const choices=data?.types??data?.plans.filter((p,i,all)=>all.findIndex(a=>a.typeId===p.typeId)===i)??[];
 useEffect(()=>{let active=true;setAnalysis(null);callback.current(null);if(!chosen){if(data?.status==="available"&&loadedIdentity===identity){setMessage(severalTypes?"같은 전용면적에 여러 주택형이 있습니다. A·B 등 해당 타입을 선택해 주세요.":"선택 전용면적과 일치하는 도면이 없습니다. 원본의 주택형을 선택해 주세요.");statusCallback.current(severalTypes?"needs_review":"unavailable");}return;}
  statusCallback.current("loading");
  setFailed(false);
  setMessage(`${chosen.typeName} ${chosen.variant} · 이미지와 치수를 분석하는 중…`);
  const started=performance.now();
  void once(results,chosen.key,()=>json<ImageAnalysis>(`/api/realestate/floor-plan-analysis?${new URLSearchParams({naver_id:chosen.naverId,key:chosen.key})}`,45000)).then(a=>{if(!active)return;setAnalysis(a);callback.current(a.status==="ready"?a:null);statusCallback.current(a.status);const elapsed=performance.now()-started;setMessage(a.status==="ready"?`${chosen.typeName} 원본 분석 적용 · ${(elapsed<100?0:elapsed/1000).toFixed(1)}초 · ${a.scale?.basis==="dimension_chains"?"구간별 표기 치수 인식":a.scale?.basis==="recognized_dimensions"?"도면 표기 치수 인식":"전용면적 기준 축척 보정"}`:"원본은 확보했지만 구조 인식 검증을 통과하지 못했습니다. 원본을 먼저 확인해 주세요.");}).catch(()=>{if(active){setFailed(true);setMessage("원본 도면 분석을 완료하지 못했습니다. 다시 시도해 주세요.");statusCallback.current("unavailable");}});return()=>{active=false;};
 },[identity,loadedIdentity,chosen?.key,retry]);
 return <section className="wk-original-plan" aria-label="실제 원본 평면도">
  <label>원본 평면도 우선 적용 <b>{chosen?.typeName??"단지·평형 매칭"}</b></label>
  <p role="status">{chosen?.key===rejectedKey?"원본 자동 배치의 통행 검증을 통과하지 못했습니다. 평균 추정 구조를 별도로 안내합니다.":message}</p>
  {loadedIdentity===identity&&!!choices.length&&<div className="wk-chips">{choices.map(p=><button key={p.typeId} className={chosen?.typeId===p.typeId?"on":""} onClick={()=>{setSelected(p.key);onAreaChoice(p);}}>{p.typeName}<small>전용 {p.exclusiveArea}㎡{p.imageUrl?"":" · 원본 이미지 없음"}</small></button>)}</div>}
  {matches.length>1&&<div className="wk-chips">{matches.map(p=><button key={p.key} className={chosen?.key===p.key?"on":""} onClick={()=>{setSelected(p.key);setZoom(false);}}>{p.typeName} · {p.variant}</button>)}</div>}
  {chosen&&<details><summary>원본 이미지·면적 확인</summary><div className="wk-row"><span>전용 {chosen.exclusiveArea}㎡ · 공급 {chosen.supplyArea}㎡</span><button className="wk-btn" onClick={()=>setZoom(v=>!v)}>{zoom?"원래 크기":"2배 확대"}</button><a href={chosen.sourceUrl} target="_blank" rel="noreferrer">네이버 원본</a></div><div className={`wk-public-image${zoom?" is-zoom":""}`}><img src={drawingImage(chosen)} alt={`${data?.name??name} ${chosen.typeName} ${chosen.variant} 원본 평면도`} loading="lazy"/></div><p>{analysis?.note??"원본 이미지의 치수와 벽 위치를 읽습니다. 가구·재질은 별도의 인테리어 연출입니다."}</p></details>}
  {failed||data?.status!=="available"||analysis?.status==="needs_review"||chosen?.key===rejectedKey?<button className="wk-btn" onClick={()=>{onRetry?.();if(chosen)results.delete(chosen.key);setRetry(v=>v+1);}}>원본 다시 확인</button>:null}
 </section>;
}
