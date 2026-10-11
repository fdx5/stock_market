import {mergePlaces, normalizePlace, placeSources, type DronePlace, type PlaceSource} from './dronePlaces';

// Public domain-bound VWorld browser key, already used by the 3D view. No history
// or user queries are persisted. Two requests at once; edits abort the old batch.
const callbacks = new Map<string, (body: any) => void>();
let sequence = 0;
const cache = new Map<string, DronePlace[]>();
function lookup(query: string, source: PlaceSource, key: string, domain: string, signal: AbortSignal) {
  return new Promise<DronePlace[]>((resolve,reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted','AbortError')); return; }
    const host = window as unknown as Record<string,unknown>;
    // Late cancelled JSONP replies become no-ops without keeping old callbacks.
    host.__dronePlaceCallbacks ??= new Proxy({}, {get:(_,name)=>callbacks.get(String(name)) ?? (()=>{})});
    const name = `p${Date.now().toString(36)}${sequence++}`, script = document.createElement('script');
    const finish = () => { clearTimeout(timer); callbacks.delete(name); script.remove(); signal.removeEventListener('abort',abort); };
    const abort = () => { finish(); reject(new DOMException('Aborted','AbortError')); };
    const timer = window.setTimeout(()=>{finish();reject(new Error('검색 응답 시간 초과'));},6000);
    callbacks.set(name, body => {
      finish(); const response=body?.response;
      if (response?.status==='NOT_FOUND') { resolve([]); return; }
      if (response?.status!=='OK') { reject(new Error('검색 정보를 가져오지 못했습니다.')); return; }
      resolve((response.result?.items ?? []).map((item:any)=>normalizePlace(item,source)).filter((p:DronePlace|null):p is DronePlace=>!!p));
    });
    signal.addEventListener('abort',abort,{once:true});
    script.onerror=()=>{finish();reject(new Error('검색 연결 실패'));};
    const q=new URLSearchParams({service:'search',request:'search',version:'2.0',crs:'EPSG:4326',size:'8',page:'1',
      query,type:source.type,...(source.category?{category:source.category}:{}),format:'json',key,domain,callback:`__dronePlaceCallbacks.${name}`});
    script.referrerPolicy='no-referrer'; script.src='https://api.vworld.kr/req/search?'+q; document.head.appendChild(script);
  });
}

export async function searchDronePlaces(query:string,key:string,domain:string,signal:AbortSignal,onResults:(items:DronePlace[])=>void) {
  const cacheKey=domain+':'+query, hit=cache.get(cacheKey);
  if (hit) { onResults(hit); return {failed:0,sources:0}; }
  const sources=placeSources(query), found:DronePlace[]=[], failures:number[]=[];
  let next=0;
  await Promise.all([0,1].map(async()=>{
    while(next<sources.length&&!signal.aborted) {
      const i=next++;
      try { found.push(...await lookup(query,sources[i],key,domain,signal)); if(!signal.aborted)onResults(mergePlaces(found,query)); }
      catch { if(!signal.aborted)failures.push(i); }
    }
  }));
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  if(!failures.length) { cache.set(cacheKey,mergePlaces(found,query)); if(cache.size>24)cache.delete(cache.keys().next().value!); }
  return {failed:failures.length,sources:sources.length};
}
