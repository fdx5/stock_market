import { useEffect, useRef, useState } from "react";
import type { Drawing, ImageAnalysis } from "./interior/plan/imagePlan";
import {apartmentName,drawingLookupIdentity} from './apartmentIdentity';
import {drawingSelection} from './drawingSelection';

interface Catalogue {status:string;name?:string;naverId?:string;plans:Drawing[];types?:Drawing[]}
const lists=new Map<string,Promise<Catalogue>>(),results=new Map<string,Promise<ImageAnalysis>>();
function once<T>(cache:Map<string,Promise<T>>,key:string,fetcher:()=>Promise<T>){
  const hit=cache.get(key);if(hit)return hit;
  const task=fetcher().catch(e=>{cache.delete(key);throw e;});cache.set(key,task);
  while(cache.size>32)cache.delete(cache.keys().next().value!);return task;
}
async function json<T>(url:string,timeout=20000):Promise<T>{const r=await fetch(url,{signal:AbortSignal.timeout(timeout)});if(!r.ok)throw Error("source");return r.json();}
export function drawingImage(d:Drawing){return `/api/realestate/floor-plan-image?${new URLSearchParams({naver_id:d.naverId,key:d.key})}`;}
const scaleLabels:Record<string,string>={single_axis_dimensions:"단일 축 치수·원본 비율 보정",dimension_chains:"구간별 표기 치수 인식",recognized_dimensions:"도면 표기 치수 인식",room_area_ratio:"방별 면적·가로세로 비율 추정",exclusive_area_ratio:"전용면적·실내 영역 비율 추정"};

export type DrawingStatus="loading"|"ready"|"unavailable"|"not_found"|"type_selection"|"analysis_failed"|"needs_review";
export default function NaverFloorPlans({name,lat,lon,town,region,pnu='',area,onAnalysis,onStatus,onAreaChoice,rejectedKey,onRetry}:{name:string;lat:number;lon:number;town:string;region:string;pnu?:string;area:number|undefined;onAnalysis:(analysis:ImageAnalysis|null)=>void;onStatus:(status:DrawingStatus)=>void;onAreaChoice:(drawing:Drawing)=>void;rejectedKey?:string|null;onRetry?:()=>void}) {
 const [data,setData]=useState<Catalogue|null>(null),[loadedIdentity,setLoadedIdentity]=useState(""),[message,setMessage]=useState("원본 평면도 목록을 확인하는 중…"),[selected,setSelected]=useState(""),[analysis,setAnalysis]=useState<ImageAnalysis|null>(null),[zoom,setZoom]=useState(false),[retry,setRetry]=useState(0);
 const callback=useRef(onAnalysis);callback.current=onAnalysis;
 const statusCallback=useRef(onStatus);statusCallback.current=onStatus;
 const areaCallback=useRef(onAreaChoice);areaCallback.current=onAreaChoice;
 const [failed,setFailed]=useState(false);
 const [overlay,setOverlay]=useState(false);
 const searchName=apartmentName(name,town);
 const identity=drawingLookupIdentity(searchName,town,region,lat,lon);
 useEffect(()=>{let active=true;setData(null);setSelected("");setAnalysis(null);callback.current(null);statusCallback.current("loading");setMessage("원본 평면도 목록을 확인하는 중…");
  const url=`/api/realestate/floor-plans?${new URLSearchParams({name:searchName,lat:String(lat),lon:String(lon),town,region,...(pnu?{pnu}:{})})}`;
  void once(lists,identity+retry,()=>json<Catalogue>(url)).then(d=>{if(!active)return;setData(d);setLoadedIdentity(identity);if(d.status!=="available")statusCallback.current(d.status==='unavailable'?'unavailable':'not_found');setMessage(d.status==="available"?"":d.status==='ambiguous'?"동명이 있는 여러 단지가 검색되었습니다. 단지 위치를 확인해 주세요.":d.status==='unavailable'?"단지 도면 서버에 연결하지 못했습니다. 다시 확인해 주세요.":"이 아파트 단지에서 공개한 원본 도면을 찾지 못했습니다.");}).catch(()=>{if(active){setMessage("원본 도면 서버에 연결하지 못했습니다.");statusCallback.current("unavailable");}});return()=>{active=false;};
 },[identity,retry]);
 const {matches,severalTypes,chosen}=drawingSelection(loadedIdentity===identity?data?.plans??[]:[],area,selected);
 useEffect(()=>{if(chosen&&(area===undefined||Math.abs(chosen.exclusiveArea-area)>.005))areaCallback.current(chosen);},[chosen?.key,area]);
 const choices=data?.types??data?.plans.filter((p,i,all)=>all.findIndex(a=>a.typeId===p.typeId)===i)??[];
 useEffect(()=>{let active=true;setAnalysis(null);setOverlay(false);callback.current(null);if(!chosen){if(data?.status==="available"&&loadedIdentity===identity){setMessage(severalTypes?"단지 원본을 찾았습니다. 같은 면적의 A·B 등 주택형을 선택해 주세요.":"단지 원본을 찾았습니다. 아래 원본 주택형을 선택하면 인테리어를 구성합니다.");statusCallback.current("type_selection");}return;}
  statusCallback.current("loading");
  setFailed(false);
  setMessage(`${chosen.typeName} ${chosen.variant} · 이미지와 치수를 분석하는 중…`);
  const started=performance.now();
  void once(results,chosen.key,()=>json<ImageAnalysis>(`/api/realestate/floor-plan-analysis?${new URLSearchParams({naver_id:chosen.naverId,key:chosen.key})}`,45000)).then(a=>{if(!active)return;setAnalysis(a);callback.current(a.status==="ready"?a:null);statusCallback.current(a.status);const elapsed=performance.now()-started;setMessage(a.status==="ready"?`${chosen.typeName} 원본 분석 적용 · ${(elapsed<100?0:elapsed/1000).toFixed(1)}초 · ${a.application?.geometryBasis==='reviewed_public_drawing_copy'?'공개 도면 사본·구획 보정(근사)':a.application?.areaAnnotationAdjusted?'원본 구조·전용면적 축척 보정':scaleLabels[a.scale?.basis??""]??"전용면적 기준 축척 보정"}`:a.reason==="source_wall_mismatch"?"원본은 확보했지만 벽 위치를 충분히 읽지 못했습니다. 다른 원본 주택형을 선택하거나 다시 분석해 주세요.":"원본은 확보했지만 공간 구획을 읽지 못했습니다. 다른 원본 주택형을 선택하거나 다시 분석해 주세요.");}).catch(()=>{if(active){setFailed(true);setMessage("원본은 확보했지만 분석 서버 응답을 받지 못했습니다. 다시 시도해 주세요.");statusCallback.current("analysis_failed");}});return()=>{active=false;};
 },[identity,loadedIdentity,chosen?.key,retry]);
 return <section className="wk-original-plan" aria-label="실제 원본 평면도">
  <label>{data?.name??searchName} · 단지 원본 평면도 <b>{chosen?.typeName??"주택형 선택"}</b></label>
  <p role="status">{chosen?.key===rejectedKey?"원본 배치의 통행 검증을 통과하지 못했습니다. 원본 도면을 보존하고 실내 진입을 보류합니다.":message}</p>
  {loadedIdentity===identity&&!!choices.length&&<div className="wk-chips">{choices.map(p=><button key={p.typeId} className={chosen?.typeId===p.typeId?"on":""} onClick={()=>{setSelected(p.key);onAreaChoice(p);}}>{p.typeName}<small>전용 {p.exclusiveArea}㎡{p.imageUrl?"":" · 원본 이미지 없음"}</small></button>)}</div>}
  {matches.length>1&&<div className="wk-chips">{matches.map(p=><button key={p.key} className={chosen?.key===p.key?"on":""} onClick={()=>{setSelected(p.key);setZoom(false);}}>{p.typeName} · {p.variant}</button>)}</div>}
  {analysis?.sourceMatch&&<p className="wk-plan-match">세대 벽 경계 일치 {(analysis.sourceMatch.wallF1*100).toFixed(1)}% · {analysis.status==='ready'?"원본 구조 적용 가능":"구조 재확인 필요"}{analysis.sourceMatch.floorCoverage!==undefined&&<> · 바닥 영역 반영 {(analysis.sourceMatch.floorCoverage*100).toFixed(1)}%</>}<br/><small>원본의 배치와 벽 구조를 기준으로 구성합니다. 치수·면적의 차이는 보정하며 가구와 마감은 연출입니다.</small></p>}
  {chosen&&<details><summary>원본 이미지·면적 확인</summary><div className="wk-row"><span>전용 {chosen.exclusiveArea}㎡ · 공급 {chosen.supplyArea}㎡</span><button className="wk-btn" onClick={()=>setZoom(v=>!v)}>{zoom?"원래 크기":"2배 확대"}</button>{!!analysis?.pixelRooms?.length&&<button className="wk-btn" aria-pressed={overlay} onClick={()=>setOverlay(v=>!v)}>인식 구획 {overlay?"숨기기":"겹쳐 보기"}</button>}<a href={chosen.sourceUrl} target="_blank" rel="noreferrer">도면 출처</a></div><div className={`wk-public-image${zoom?" is-zoom":""}`}><div className="wk-plan-canvas"><img src={drawingImage(chosen)} alt={`${data?.name??name} ${chosen.typeName} ${chosen.variant} 원본 평면도`} loading="lazy"/>{overlay&&analysis?.imageSize&&<svg className="wk-plan-overlay" viewBox={`0 0 ${analysis.imageSize[0]} ${analysis.imageSize[1]}`} aria-label="원본 위의 인식 공간 구획">{analysis.pixelRooms?.map(r=><rect key={r.id} x={r.rect[0]} y={r.rect[1]} width={r.rect[2]-r.rect[0]} height={r.rect[3]-r.rect[1]} vectorEffect="non-scaling-stroke"/>)}</svg>}</div></div><p>{analysis?.note??"원본 이미지의 치수와 벽 위치를 읽습니다. 가구·재질은 별도의 인테리어 연출입니다."}</p></details>}
  {failed||data?.status!=="available"||analysis?.status==="needs_review"||chosen?.key===rejectedKey?<button className="wk-btn" onClick={()=>{onRetry?.();if(chosen)results.delete(chosen.key);setRetry(v=>v+1);}}>원본 다시 확인</button>:null}
 </section>;
}
