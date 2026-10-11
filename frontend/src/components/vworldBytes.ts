/** Public survey files: bounded memory reuse and cancellable shared downloads.
 * Previously saved browser records are read only; this loader never writes,
 * replaces or removes stored records. */
type RecordBytes={at:number;data:ArrayBuffer};
type Download={promise:Promise<ArrayBuffer>;stop:AbortController;owners:number;finished:boolean};
const memory=new Map<string,RecordBytes>(),pending=new Map<string,Download>();
const limit=32*1024*1024,ttl=24*60*60*1000;
let total=0,active=0;
const queue:{start:()=>void;cancel:()=>void}[]=[];
let db:Promise<IDBDatabase|null>|undefined;
const stopped=()=>new DOMException('View closed','AbortError');
function database():Promise<IDBDatabase|null>{
  return db??=new Promise(resolve=>{
    // Do not create or upgrade a persistent store for an ephemeral byte cache.
    if(typeof indexedDB==='undefined'||!indexedDB.databases){resolve(null);return;}
    let settled=false;
    const finish=(value:IDBDatabase|null)=>{if(settled){value?.close();return;}settled=true;clearTimeout(timer);resolve(value);};
    const timer=setTimeout(()=>finish(null),100);
    void indexedDB.databases().then(inventory=>{
      if(settled||!inventory.some(d=>d.name==='kospimap.vworld-bytes.v1')){finish(null);return;}
      const request=indexedDB.open('kospimap.vworld-bytes.v1');
      request.onupgradeneeded=()=>{request.transaction?.abort();finish(null);};
      request.onsuccess=()=>{if(request.result.objectStoreNames.contains('bytes'))finish(request.result);else{request.result.close();finish(null);}};
      request.onerror=()=>finish(null);request.onblocked=()=>finish(null);
    }).catch(()=>finish(null));
  });
}
async function kept(key:string):Promise<ArrayBuffer|null>{
  try{
    const store=await database();if(!store)return null;
    return await new Promise(resolve=>{
      const timer=setTimeout(()=>resolve(null),100);
      const r=store.transaction('bytes','readonly').objectStore('bytes').get(key);
      r.onsuccess=()=>{clearTimeout(timer);const v=r.result as RecordBytes|undefined;resolve(v&&Date.now()-v.at<ttl?v.data:null);};
      r.onerror=()=>{clearTimeout(timer);resolve(null);};
    });
  }catch{return null;}
}
function remember(key:string,data:ArrayBuffer){
  if(data.byteLength>limit)return;
  const old=memory.get(key);if(old)total-=old.data.byteLength;
  memory.delete(key);memory.set(key,{at:Date.now(),data});total+=data.byteLength;
  while(total>limit || memory.size>512){const first=memory.keys().next().value!;total-=memory.get(first)!.data.byteLength;memory.delete(first);}
}
function admission(signal:AbortSignal):Promise<void>{
  if(signal.aborted)return Promise.reject(stopped());
  if(active<6){active++;return Promise.resolve();}
  return new Promise((resolve,reject)=>{
    const waiter={
      start:()=>{signal.removeEventListener('abort',waiter.cancel);resolve();},
      cancel:()=>{const i=queue.indexOf(waiter);if(i>=0)queue.splice(i,1);signal.removeEventListener('abort',waiter.cancel);reject(stopped());},
    };
    queue.push(waiter);signal.addEventListener('abort',waiter.cancel,{once:true});
  });
}
function leave(){const next=queue.shift();if(next)next.start();else active--;}
async function waitFor<T>(work:Promise<T>,signal?:AbortSignal):Promise<T>{
  if(!signal)return work;
  if(signal.aborted)throw stopped();
  let abort:()=>void=()=>{};
  try{return await Promise.race([work,new Promise<never>((_,reject)=>{abort=()=>reject(stopped());signal.addEventListener('abort',abort,{once:true});})]);}
  finally{signal.removeEventListener('abort',abort);}
}
export async function sharedVworldBytes(url:string,load:(signal:AbortSignal)=>Promise<ArrayBuffer>,signal?:AbortSignal):Promise<ArrayBuffer>{
  if(signal?.aborted)throw stopped();
  const u=new URL(url);u.searchParams.delete('Key');const key=u.toString();
  let hit=memory.get(key);
  if(hit && Date.now()-hit.at>=ttl){total-=hit.data.byteLength;memory.delete(key);hit=undefined;}
  if(hit){memory.delete(key);memory.set(key,hit);return hit.data.slice(0);}
  let work=pending.get(key);
  if(!work){
    const entry:Download={promise:Promise.resolve(new ArrayBuffer(0)),stop:new AbortController(),owners:0,finished:false};
    entry.promise=(async()=>{
      try{
        const stored=await waitFor(kept(key),entry.stop.signal);if(stored){remember(key,stored);return stored;}
        await admission(entry.stop.signal);
        const timer=setTimeout(()=>entry.stop.abort(),10000);
        try{
          if(entry.stop.signal.aborted)throw stopped();
          const data=await waitFor(load(entry.stop.signal),entry.stop.signal);remember(key,data);return data;
        }finally{clearTimeout(timer);leave();}
      }finally{entry.finished=true;}
    })();
    pending.set(key,entry);work=entry;
    void entry.promise.finally(()=>{if(pending.get(key)===entry)pending.delete(key);}).catch(()=>{});
  }
  work.owners++;
  try{
    const data=await waitFor(work.promise,signal);
    return data.slice(0); // Consumers transfer images to workers; cached bytes stay owned.
  }finally{
    // Cancel only the final owner's work. Stale queued files must not delay the
    // new viewing corridor, while other live views retain their shared fetch.
    if(--work.owners===0&&!work.finished){work.stop.abort();if(pending.get(key)===work)pending.delete(key);}
  }
}
