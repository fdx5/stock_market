/** Broad-phase only: candidates include every overlapping triangle. The exact
 * plane clipping and maximum-height calculation remain the existing JS code. */
export type RoadBvhPart = { nodes:Uint32Array; ids:Uint32Array; offset:number };
export type RoadBvhData = { parts:RoadBvhPart[]; triangles:number; buildMs:number; workerMs:number; workers:number };
export type RoadTriangleIndex = { query:(x0:number,y0:number,x1:number,y1:number)=>number[] };

export function roadBvhIndex(data:RoadBvhData):RoadTriangleIndex {
 const parts=data.parts.map(p=>({...p,bounds:new Float32Array(p.nodes.buffer,p.nodes.byteOffset,p.nodes.length)}));
 return { query:(x0,y0,x1,y1)=>{
  const found:number[]=[],stack:number[]=[];
  for(const p of parts){stack.push(0);
   while(stack.length){const at=stack.pop()!*8,b=p.bounds,n=p.nodes;
    // Tiny margin covers the barycentric edge tolerance of the exact narrow phase.
    const margin=1e-5+Math.max(b[at+2]-b[at],b[at+3]-b[at+1])*2e-6;
    if(b[at]>x1+margin||b[at+1]>y1+margin||b[at+2]<x0-margin||b[at+3]<y0-margin)continue;
    const count=n[at+7];
    if(count){const start=n[at+6];for(let j=start;j<start+count;j++)found.push((p.ids[j]+p.offset)*3);}
    else stack.push(n[at+4],n[at+5]);
   }
  }
  return found;
 }};
}

/** Same median-split algorithm, used only by the controlled JS/WASM benchmark. */
export function buildRoadBvhJs(bounds:Float32Array):RoadBvhPart {
 const count=bounds.length/4,ids=Uint32Array.from({length:count},(_,i)=>i),words:number[]=[],floats:number[]=[];
 const centroid=(id:number,axis:number)=>bounds[id*4+axis]+bounds[id*4+axis+2];
 const split=(start:number,end:number):number=>{
  const node=words.length/8,b=[Infinity,Infinity,-Infinity,-Infinity];
  for(let i=start;i<end;i++){const q=ids[i]*4;b[0]=Math.min(b[0],bounds[q]);b[1]=Math.min(b[1],bounds[q+1]);b[2]=Math.max(b[2],bounds[q+2]);b[3]=Math.max(b[3],bounds[q+3]);}
  words.push(0,0,0,0,0,0,start,end-start);floats.push(...b,0,0,0,0);
  if(end-start>8){const axis=b[2]-b[0]>=b[3]-b[1]?0:1,middle=(start+end)>>1;
   // In-place quickselect; deterministic median pivot, matching median partitioning.
   let lo=start,hi=end-1;
   while(lo<hi){const pivot=centroid(ids[(lo+hi)>>1],axis);let i=lo,j=hi;
    while(i<=j){while(centroid(ids[i],axis)<pivot)i++;while(centroid(ids[j],axis)>pivot)j--;if(i<=j){const t=ids[i];ids[i++]=ids[j];ids[j--]=t;}}
    if(middle<=j)hi=j;else if(middle>=i)lo=i;else break;
   }
   words[node*8+4]=split(start,middle);words[node*8+5]=split(middle,end);words[node*8+7]=0;
  }
  return node;
 };
 if(count)split(0,count);
 const nodes=Uint32Array.from(words),f=new Float32Array(nodes.buffer);
 for(let i=0;i<f.length;i+=8)for(let j=0;j<4;j++)f[i+j]=floats[i+j];
 return {nodes,ids,offset:0};
}
