import wasmUrl from '../wasm/scene-geometry/scene_geometry.wasm?url';
import {hybridSceneEnabled} from './hybridScene';
import {onSceneMemoryRelease} from './sceneMemory';

export type InstanceKernel = {
 memory: WebAssembly.Memory;
 alloc_input(n:number):number; free_input(p:number,n:number):void;
 alloc_matrices(n:number):number; free_matrices(p:number,n:number):void;
 instance_compose(p:number,out:number,n:number):void;
};
let pending:Promise<InstanceKernel|undefined>|undefined;
let generation=0;
onSceneMemoryRelease(()=>{generation++;pending=undefined;});
export async function prepareInstanceKernel():Promise<InstanceKernel|undefined>{
 if(!hybridSceneEnabled())return undefined;
 const owner=generation;
 pending??=(async()=>{
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),1000);
  try{const r=await fetch(wasmUrl,{signal:abort.signal});if(!r.ok)throw Error('instance kernel unavailable');
   const k=(await WebAssembly.instantiate(await r.arrayBuffer(),{})).instance.exports as unknown as InstanceKernel;
   return owner===generation?k:undefined;
  }catch{return undefined;}finally{clearTimeout(timer);}
 })();
 return pending;
}

/** Reusable batch: position, yaw/pitch and non-uniform scale in double precision.
 * Only the final matrices round to float32, matching the GPU attribute contract.
 * No worker round-trip or allocation is needed per animation frame. */
export class InstanceBatch {
 readonly input:Float64Array;
 private inputPtr=0;
 private outputPtr=0;
 private disposed=false;
 constructor(readonly capacity:number,private kernel?:InstanceKernel){
  if(!Number.isInteger(capacity)||capacity<0||capacity>1000000)throw Error('invalid instance capacity');
  this.input=new Float64Array(capacity*9);
  if(kernel&&capacity){this.inputPtr=kernel.alloc_input(this.input.length);this.outputPtr=kernel.alloc_matrices(capacity);}
 }
 set(i:number,x:number,y:number,z:number,yaw:number,pitch:number,sx:number,sy:number,sz:number){
  const a=this.input,o=i*9;a[o]=x;a[o+1]=y;a[o+2]=z;a[o+3]=yaw;a[o+4]=pitch;a[o+5]=sx;a[o+6]=sy;a[o+7]=sz;a[o+8]=1;
 }
 compose(target:Float32Array,count=this.capacity){
  if(this.disposed)throw Error('instance batch disposed');
  if(!Number.isInteger(count)||count<0||count>this.capacity||target.length<count*16)throw Error('invalid instance output');
  if(!count)return;
  const k=this.kernel;
  if(k){
   new Float64Array(k.memory.buffer,this.inputPtr,count*9).set(this.input.subarray(0,count*9));
   k.instance_compose(this.inputPtr,this.outputPtr,count);
   target.set(new Float32Array(k.memory.buffer,this.outputPtr,count*16));
  }else{
   for(let i=0;i<count;i++)composeInstance(this.input,i*9,target,i*16);
  }
 }
 get wasm(){return !!this.kernel;}
 get retainedBytes(){return this.input.byteLength+(this.kernel?this.capacity*(9*8+16*4):0);}
 dispose(){if(this.disposed)return;this.disposed=true;if(this.kernel&&this.capacity){this.kernel.free_input(this.inputPtr,this.input.length);this.kernel.free_matrices(this.outputPtr,this.capacity);}this.kernel=undefined;}
}

export function composeInstance(a:Float64Array,o:number,t:Float32Array,v:number){
 const s=Math.sin(a[o+3]/2),c=Math.cos(a[o+3]/2),p=Math.sin(a[o+4]/2),q=Math.cos(a[o+4]/2);
 const x=c*p,y=s*q,z=-s*p,w=c*q,x2=x+x,y2=y+y,z2=z+z;
 const xx=x*x2,xy=x*y2,xz=x*z2,yy=y*y2,yz=y*z2,zz=z*z2,wx=w*x2,wy=w*y2,wz=w*z2;
 const sx=a[o+5],sy=a[o+6],sz=a[o+7];
 t[v]=(1-(yy+zz))*sx;t[v+1]=(xy+wz)*sx;t[v+2]=(xz-wy)*sx;t[v+3]=0;
 t[v+4]=(xy-wz)*sy;t[v+5]=(1-(xx+zz))*sy;t[v+6]=(yz+wx)*sy;t[v+7]=0;
 t[v+8]=(xz+wy)*sz;t[v+9]=(yz-wx)*sz;t[v+10]=(1-(xx+yy))*sz;t[v+11]=0;
 t[v+12]=a[o];t[v+13]=a[o+1];t[v+14]=a[o+2];t[v+15]=1;
}
