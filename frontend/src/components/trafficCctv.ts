export type TrafficCamera = { id:string; name:string; lat:number; lon:number; source:string; address?:string;
  media?:string|null; format?:'hls'|'mp4'|'image'; updatedAt?:string };

export function cameraPoint(camera:TrafficCamera,origin:{lat:number;lon:number}) {
  return {x:(camera.lon-origin.lon)*111320*Math.cos(origin.lat*Math.PI/180),y:(camera.lat-origin.lat)*110540};
}
export function cameraFromFeature(f:any):TrafficCamera|null {
  const p=f?.properties,xy=f?.geometry?.coordinates;
  if(f?.geometry?.type!=='Point'||!Array.isArray(xy)||!p)return null;
  const lon=Number(xy[0]),lat=Number(xy[1]),name=String(p.cctvname??'').trim();
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<33||lat>39||lon<124||lon>132||!name)return null;
  return {id:`vworld:${f.id??`${lon.toFixed(6)}:${lat.toFixed(6)}:${name}`}`,name:name.slice(0,160),lat,lon,
    address:String(p.locate??'').slice(0,200),source:'국토교통부 VWorld · 경찰청 교통 CCTV'};
}
export function mergeCameras(items:TrafficCamera[],origin:{lat:number;lon:number}) {
  const out:TrafficCamera[]=[];
  // Video-bearing provider records win only when the name and position match.
  for(const c of [...items].sort((a,b)=>Number(!!b.media)-Number(!!a.media))) {
    if(out.some(p=>p.id===c.id||(p.name.replace(/\s/g,'')===c.name.replace(/\s/g,'')&&Math.hypot(...Object.values(cameraPoint(c,p)))<60)))continue;
    out.push(c);
  }
  return out.sort((a,b)=>{const available=Number(!!b.media)-Number(!!a.media);if(available)return available;
    const p=cameraPoint(a,origin),q=cameraPoint(b,origin);return Math.hypot(p.x,p.y)-Math.hypot(q.x,q.y);}).slice(0,500);
}

const callbacks=new Map<string,(value:any)=>void>();let seq=0;
async function locations(lat:number,lon:number,key:string,domain:string,signal:AbortSignal) {
  const result:TrafficCamera[]=[];
  for(let page=1;page<=3;page++) {
    const body:any=await new Promise((resolve,reject)=>{
      if(signal.aborted){reject(new DOMException('Aborted','AbortError'));return;}
      const host=window as unknown as Record<string,unknown>;
      host.__trafficCctvCallbacks??=new Proxy({},{get:(_,name)=>callbacks.get(String(name))??(()=>{})});
      const name=`c${seq++}`,script=document.createElement('script');
      const done=()=>{clearTimeout(timer);callbacks.delete(name);script.remove();signal.removeEventListener('abort',abort);};
      const abort=()=>{done();reject(new DOMException('Aborted','AbortError'));};
      const timer=window.setTimeout(()=>{done();reject(new Error('CCTV 위치 조회 시간 초과'));},7000);
      callbacks.set(name,body=>{done();resolve(body);});signal.addEventListener('abort',abort,{once:true});
      script.onerror=()=>{done();reject(new Error('CCTV 위치 연결 실패'));};
      const dx=2300/(111320*Math.cos(lat*Math.PI/180)),dy=2300/110540;
      script.src='https://api.vworld.kr/req/data?'+new URLSearchParams({service:'data',request:'GetFeature',version:'2.0',
        data:'LT_P_UTISCCTV',crs:'EPSG:4326',geomFilter:`BOX(${lon-dx},${lat-dy},${lon+dx},${lat+dy})`,
        size:'1000',page:String(page),format:'json',key,domain,callback:`__trafficCctvCallbacks.${name}`});
      script.referrerPolicy='no-referrer';document.head.appendChild(script);
    });
    const r=body?.response;
    if(r?.status==='NOT_FOUND')break;
    if(r?.status!=='OK')throw new Error('CCTV 위치를 불러오지 못했습니다.');
    const fs=r.result?.featureCollection?.features??[];
    for(const f of fs){const c=cameraFromFeature(f);if(c)result.push(c);}
    if(fs.length<1000)break;
  }
  return result;
}
export type CameraResult={items:TrafficCamera[];status:string;locationFailed:boolean};
// City CCTV remains disconnected until UTIC approval and a verified city feed.
const CITY_LOCATION_LINKS_ENABLED=false;
const cache=new Map<string,{at:number;value:CameraResult}>();
export async function loadCameras(lat:number,lon:number,key:string,domain:string,signal:AbortSignal,refresh=false):Promise<CameraResult> {
  const cell=`${Math.round(lat/.005)}:${Math.round(lon/.005)}`,hit=cache.get(cell);
  if(!refresh&&hit&&Date.now()-hit.at<180000)return hit.value;
  const results=await Promise.allSettled([
    CITY_LOCATION_LINKS_ENABLED?locations(lat,lon,key,domain,signal):Promise.resolve([]),
    fetch(`/api/realestate/cctv?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}${refresh?'&fresh=true':''}`,{signal}).then(async r=>{if(!r.ok)throw new Error('CCTV 연결 실패');return r.json();}),
  ]);
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  const [map,video]=results;
  const data=video.status==='fulfilled'?video.value:null;
  const feeds:TrafficCamera[]=Array.isArray(data?.items)?data.items:[];
  const items=mergeCameras([...(map.status==='fulfilled'?map.value:[]),...feeds.filter(c=>!!c.media&&c.id.startsWith('its:'))],{lat,lon});
  const value={items,status:data?.status??'unavailable',locationFailed:map.status==='rejected'};
  if(!value.locationFailed&&['ok','needs_key'].includes(value.status)){cache.set(cell,{at:Date.now(),value});while(cache.size>24)cache.delete(cache.keys().next().value!);}
  return value;
}
