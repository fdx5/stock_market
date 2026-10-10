import type {PhotoBuilding} from './vworld3d';

/** CPU-only, bounded decoded survey reuse. Callers receive owned copies, so
 * translating/disposing a match or transferring buffers cannot damage the next
 * job. Failures and missing models are never cached. Nothing is persisted. */
export class SurveyModelCache {
  private rows=new Map<string,{model:PhotoBuilding;bytes:number;at:number}>();
  private bytes=0;
  private hits=0;
  private misses=0;
  private evicted=0;
  constructor(private limit=24*1024*1024,private capacity=1024,private ttl=5*60*1000,private clock=()=>Date.now()){}
  private copy(m:PhotoBuilding):PhotoBuilding{return {...m,geometry:m.geometry.clone(),texture:null,hull:m.hull.map(p=>[...p]),src:{...m.src}};}
  private drop(key:string){const row=this.rows.get(key);if(!row)return;this.rows.delete(key);this.bytes-=row.bytes;row.model.geometry.dispose();this.evicted++;}
  get(key:string){
    const row=this.rows.get(key);
    if(!row||this.clock()-row.at>=this.ttl){if(row)this.drop(key);this.misses++;return null;}
    this.rows.delete(key);this.rows.set(key,row);this.hits++;return this.copy(row.model);
  }
  put(key:string,model:PhotoBuilding){
    // Photographic landmark textures stay outside the generic shape cache.
    if(model.texture)return;
    const bytes=Object.values(model.geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0)+(model.geometry.index?.array.byteLength??0)+model.hull.length*16+1024;
    if(bytes>this.limit)return;
    this.drop(key);this.rows.set(key,{model:this.copy(model),bytes,at:this.clock()});this.bytes+=bytes;
    while(this.bytes>this.limit||this.rows.size>this.capacity)this.drop(this.rows.keys().next().value!);
  }
  clear(){for(const row of this.rows.values())row.model.geometry.dispose();this.rows.clear();this.bytes=0;}
  stats(){return{entries:this.rows.size,bytes:this.bytes,limit:this.limit,capacity:this.capacity,hits:this.hits,misses:this.misses,evicted:this.evicted};}
}
