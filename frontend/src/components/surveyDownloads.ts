/** Start the four bounded model downloads as each source list arrives. A slow
 * neighbouring list must not consume the entire batch deadline before healthy
 * building models can even start. No geometry is simplified or omitted. */
export async function downloadSurveyModels<T,R>(lists:Promise<T[]>[],o:{
  signal?:AbortSignal;key:(entry:T)=>string;rank:(entry:T)=>number;
  load:(entry:T)=>Promise<R|null>;onPending?:(entry:T)=>void;
}):Promise<R[]>{
  const seen=new Set<string>(),queue:{entry:T;rank:number}[]=[],active=new Set<Promise<void>>(),out:R[]=[];
  const pump=()=>{
    while(active.size<4&&queue.length&&!o.signal?.aborted){
      const {entry}=queue.shift()!;
      const job=Promise.resolve().then(()=>o.load(entry)).then(result=>{if(result!==null)out.push(result);}).finally(()=>{active.delete(job);pump();});
      active.add(job);
    }
  };
  await Promise.all(lists.map(async list=>{
    for(const entry of await list){const id=o.key(entry);if(seen.has(id))continue;seen.add(id);queue.push({entry,rank:o.rank(entry)});}
    queue.sort((a,b)=>a.rank-b.rank);pump();
  }));
  // Completion may launch another queued model, so a single snapshot of the
  // active promises is insufficient. Keep completed geometry on deadline abort.
  while(active.size)await Promise.all([...active]);
  for(const {entry} of queue)o.onPending?.(entry);
  return out;
}
