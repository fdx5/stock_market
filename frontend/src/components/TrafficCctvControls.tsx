import {useEffect,useRef,useState} from 'react';
import {loadCameras,type CameraResult} from './trafficCctv';
import type {DroneCctv} from './droneCctv';
import type {DroneWhere} from './DroneRadar';
import type {DroneSigns,Sign} from './droneSigns';

export default function TrafficCctvControls({cctv,signs,vkey,domain,where,onPick,onUpdate}:{cctv:DroneCctv;signs:DroneSigns;vkey:string;domain:string;where:()=>DroneWhere|null;onPick:(s:Sign)=>void;onUpdate:(s:CameraResult)=>void}){
  const [enabled,setEnabled]=useState(true),[result,setResult]=useState<CameraResult|null>(null),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
  const current=useRef({where,onPick,onUpdate});current.current={where,onPick,onUpdate};
  useEffect(()=>{const refresh=()=>setRetry(r=>r+1);window.addEventListener('cctv-refresh',refresh);return()=>window.removeEventListener('cctv-refresh',refresh);},[]);
  useEffect(()=>{
    const stop=new AbortController();let last:{lat:number;lon:number}|null=null,loading=false,lastAt=0;
    if(!enabled){cctv.set([]);if(signs.selected?.startsWith('cctv:'))window.dispatchEvent(new Event('drone-card-close'));return;}
    const run=async()=>{
      const p=current.current.where();if(!p||loading||document.hidden)return;
      const now=Date.now(),distance=last?Math.hypot((p.lat-last.lat)*110540,(p.lon-last.lon)*111320*Math.cos(p.lat*Math.PI/180)):Infinity;
      if(last&&now-lastAt<120000&&distance<500)return;
      loading=true;setBusy(true);
      try{
        const value=await loadCameras(p.lat,p.lon,vkey,domain,stop.signal,retry>0);
        if(stop.signal.aborted)return;
        setResult(value);cctv.set(value.items);current.current.onUpdate(value);
        // Failed lookups retry after 15 s, rather than turning into an empty success.
        if(!value.locationFailed&&['ok','needs_key'].includes(value.status)){last=p;lastAt=now;}
      }catch{if(!stop.signal.aborted)setResult({items:[],status:'unavailable',locationFailed:true});}
      finally{loading=false;if(!stop.signal.aborted)setBusy(false);}
    };
    void run();const timer=window.setInterval(()=>void run(),15000);
    return()=>{stop.abort();clearInterval(timer);cctv.set([]);};
  },[enabled,retry,cctv,signs,vkey,domain]);
  return <div className="re-cctv-controls">
    <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> CCTV 표시</label>
    {enabled&&<details><summary>주변 CCTV {busy?'조회 중…':`${result?.items.length??0}곳`}</summary>
      <div className="re-cctv-list">
        {!!result?.items.length&&<p>가까운 {Math.min(160,result.items.length)}곳 표시 · 영상 연결 여부를 확인하세요.</p>}
        {result?.items.slice(0,160).map(c=><button key={c.id} type="button" onClick={()=>{const s=signs.all().find(s=>s.camera?.id===c.id);if(s)current.current.onPick(s);}}>{c.name}<small>{c.media?'영상 연결':'위치 정보'}</small></button>)}
        {!busy&&!result?.items.length&&<p>{result?.locationFailed?'CCTV 위치를 불러오지 못했습니다.':'주변에 제공되는 CCTV가 없습니다.'}</p>}
        {result?.status==='needs_key'&&<p>공개 영상 연동 준비 중 · 위치 정보 제공</p>}
        {['partial','unavailable'].includes(result?.status??'')&&<p>일부 CCTV 영상 정보를 불러오지 못했습니다.</p>}
        <button type="button" onClick={()=>setRetry(r=>r+1)}>CCTV 새로고침</button>
        <small>위치: 국토교통부 VWorld · 영상: 국가교통정보센터</small>
      </div>
    </details>}
  </div>;
}
