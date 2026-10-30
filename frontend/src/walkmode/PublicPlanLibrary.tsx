import { useEffect, useMemo, useState } from "react";
interface PublicPlan { id:string;project:string;block:string;unitType:string;exclusiveArea:number;image:string;width:number;height:number;source:string;sourceUrl:string;sourceDate:string;dongs:string[] }
interface Catalogue {count:number;plans:PublicPlan[];note:string}
let cached:Promise<Catalogue>|null=null;
function catalogue(){return cached??=(fetch("/3d/walk/plans/index.json",{signal:AbortSignal.timeout(18000)}).then(r=>{if(!r.ok)throw Error("catalogue");return r.json();}).catch(e=>{cached=null;throw e;}));}

export default function PublicPlanLibrary({area}:{area:number|undefined}) {
 const [data,setData]=useState<Catalogue|null>(null),[error,setError]=useState(false),[query,setQuery]=useState(""),[near,setNear]=useState(false),[selected,setSelected]=useState(""),[zoom,setZoom]=useState(false);
 useEffect(()=>{let active=true;void catalogue().then(d=>{if(active)setData(d);}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[]);
 const filtered=useMemo(()=>data?.plans.filter(p=>(!near||!area||Math.abs(p.exclusiveArea-area)<1)&&`${p.project} ${p.block} ${p.unitType}`.replace(/\s/g,"").toLowerCase().includes(query.replace(/\s/g,"").toLowerCase()))??[],[data,query,near,area]);
 const plan=filtered.find(p=>p.id===selected)??filtered[0];
 if(error)return <p className="wk-warn">공개 도면 목록을 불러오지 못했습니다. 자료실을 닫았다 다시 열어 주세요.</p>;
 if(!data)return <p className="wk-sub" role="status">LH 공개 원본 도면 목록을 불러오는 중…</p>;
 return <div className="wk-public-library">
  <p>LH 공개 주택형 도면 {data.count}건 · 2021.09 자료. 현재 아파트와 자동으로 연결한 도면은 아닙니다.</p>
  <label>사업지구·주택형 검색<input value={query} onChange={e=>{setQuery(e.target.value);setSelected("");setZoom(false);}} placeholder="예: 수서, 고양향동, 84A"/></label>
  <label className="wk-public-area"><input type="checkbox" checked={near} onChange={e=>setNear(e.target.checked)}/>선택 평형 근처만 보기 {area?`(${area.toFixed(2)}㎡ ±1㎡)`:""}</label>
  <label>공개 도면 선택<select value={plan?.id??""} onChange={e=>{setSelected(e.target.value);setZoom(false);}}>{filtered.map(p=><option key={p.id} value={p.id}>{p.project} {p.block} · {p.unitType} · {p.exclusiveArea}㎡</option>)}</select></label>
  {!plan?<p className="wk-sub">조건에 맞는 공개 도면이 없습니다.</p>:<>
    <div className="wk-row"><b>{plan.project} {plan.block} · {plan.unitType}</b><button className="wk-btn" onClick={()=>setZoom(v=>!v)}>{zoom?"도면 원래 크기":"도면 2배 확대"}</button></div>
    <div className={`wk-public-image${zoom?" is-zoom":""}`}><img key={plan.id} src={plan.image} width={plan.width} height={plan.height} alt={`${plan.project} ${plan.unitType} LH 공개 원본 평면도`} loading="lazy"/></div>
    <p>{plan.source} · 전용 {plan.exclusiveArea}㎡ · {plan.sourceDate} · 동 {plan.dongs.join(", ")||"미기재"} · <a href={plan.sourceUrl} target="_blank" rel="noreferrer">공식 출처</a></p>
    <p>단지·동·주택형 일치 여부를 확인한 후 참고해 주세요. 이미지 도면을 3D 실제 구조로 변환한 상태는 아닙니다.</p>
  </>}
 </div>;
}
