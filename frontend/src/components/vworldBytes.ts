/** Public survey files: share pending downloads and retain bounded reusable bytes. */
type RecordBytes={at:number;data:ArrayBuffer};
const memory=new Map<string,RecordBytes>(),pending=new Map<string,Promise<ArrayBuffer>>();
const limit=32*1024*1024,ttl=24*60*60*1000;
let total=0,active=0;
const queue:(()=>void)[]=[];
let db:Promise<IDBDatabase|null>|undefined;
function database():Promise<IDBDatabase|null>{
  return db??=new Promise(resolve=>{
    if(typeof indexedDB==='undefined'){resolve(null);return;}
    const request=indexedDB.open('kospimap.vworld-bytes.v1',1);
    let settled=false;
    const finish=(value:IDBDatabase|null)=>{if(settled){value?.close();return;}settled=true;clearTimeout(timer);resolve(value);};
    const timer=setTimeout(()=>finish(null),100);
    request.onupgradeneeded=()=>{request.result.createObjectStore('bytes');request.result.createObjectStore('meta');};
    request.onsuccess=()=>finish(request.result);request.onerror=()=>finish(null);request.onblocked=()=>finish(null);
  });
}
async function kept(key:string):Promise<ArrayBuffer|null>{
  try{
    const store=await database();if(!store)return null;
    return await new Promise(resolve=>{
      const timer=setTimeout(()=>resolve(null),100);
      const r=store.transaction('bytes').objectStore('bytes').get(key);
      r.onsuccess=()=>{clearTimeout(timer);const v=r.result as RecordBytes|undefined;resolve(v&&Date.now()-v.at<ttl?v.data:null);};
      r.onerror=()=>{clearTimeout(timer);resolve(null);};
    });
  }catch{return null;}
}
async function remember(key:string,data:ArrayBuffer,persist=true){
  if(data.byteLength>limit)return;
  const old=memory.get(key);if(old)total-=old.data.byteLength;
  memory.delete(key);memory.set(key,{at:Date.now(),data});total+=data.byteLength;
  while(total>limit || memory.size>512){const first=memory.keys().next().value!;total-=memory.get(first)!.data.byteLength;memory.delete(first);}
  if(!persist)return;
  try{
    const store=await database();if(!store)return;
    const tx=store.transaction(['bytes','meta'],'readwrite'),at=Date.now();
    tx.objectStore('bytes').put({at,data},key);tx.objectStore('meta').put({key,at,size:data.byteLength},key);
    const r=tx.objectStore('meta').getAll();
    r.onsuccess=()=>{
      const rows=r.result.sort((a,b)=>a.at-b.at);let size=rows.reduce((s,r)=>s+r.size,0),count=rows.length;
      for(const row of rows)if(size>limit || count>512 || at-row.at>ttl){tx.objectStore('bytes').delete(row.key);tx.objectStore('meta').delete(row.key);size-=row.size;count--;}
    };
  }catch{/* Storage availability never prevents original downloads. */}
}
async function admission(){if(active<6){active++;return;}await new Promise<void>(resolve=>queue.push(resolve));}
function leave(){const next=queue.shift();if(next)next();else active--;}
export async function sharedVworldBytes(url:string,load:(signal:AbortSignal)=>Promise<ArrayBuffer>,signal?:AbortSignal):Promise<ArrayBuffer>{
  if(signal?.aborted)throw new DOMException('View closed','AbortError');
  const u=new URL(url);u.searchParams.delete('Key');const key=u.toString();
  let hit=memory.get(key);
  if(hit && Date.now()-hit.at>=ttl){total-=hit.data.byteLength;memory.delete(key);hit=undefined;}
  if(hit){memory.delete(key);memory.set(key,hit);return hit.data.slice(0);}
  let work=pending.get(key);
  if(!work){
    work=(async()=>{
      const stored=await kept(key);if(stored){void remember(key,stored,false);return stored;}
      await admission();const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),10000);
      try{const data=await load(ctl.signal);void remember(key,data);return data;}
      finally{clearTimeout(timer);leave();}
    })();
    pending.set(key,work);void work.finally(()=>pending.delete(key)).catch(()=>{});
  }
  // A closing view cancels its waiter; another view still owns the shared fetch.
  let abort:(()=>void)|undefined;
  try{
    const data=signal?await Promise.race([work,new Promise<never>((_,reject)=>{abort=()=>reject(new DOMException('View closed','AbortError'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();})]):await work;
    return data.slice(0); // Consumers transfer images to workers; cached bytes stay owned.
  }finally{if(abort)signal!.removeEventListener('abort',abort);}
}
