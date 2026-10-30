import type { FloorPlan } from "./plan/types";
import type { Seg } from "./build";
import { furnitureFootprints } from "./spawn";

export class InteriorSafetyError extends Error {}
/** Validate the furnished, body-sized walking space, not merely a graph of room names. */
export function interiorReachability(plan:FloorPlan,segments:Seg[],furniture:Seg[],start:[number,number]) {
 const [x0,z0,x1,z1]=plan.bounds,C=.08,R=.24,nx=Math.ceil((x1-x0)/C),nz=Math.ceil((z1-z0)/C);
 const targets=plan.rooms.filter(r=>["living","kitchen","bedroom","master","bathroom","ensuite","dressroom","alpha"].includes(r.type));
 if(nx*nz>300000||nx<1||nz<1)return targets.map(r=>r.label);
 const buckets=new Map<string,number[]>(),marks=new Uint32Array(segments.length);let stamp=0;
 segments.forEach(([a,b,c,d],k)=>{for(let j=Math.floor(Math.min(b,d));j<=Math.floor(Math.max(b,d));j++)for(let i=Math.floor(Math.min(a,c));i<=Math.floor(Math.max(a,c));i++){const key=`${i}:${j}`,ids=buckets.get(key)??[];ids.push(k);buckets.set(key,ids);}});
 const boxes=furnitureFootprints(furniture),free=new Uint8Array(nx*nz),seen=new Uint8Array(nx*nz);
 const clear=(x:number,z:number)=>{
  if(boxes.some(([a,b,c,d])=>x>a-R&&x<c+R&&z>b-R&&z<d+R))return false;
  stamp++;
  for(let j=Math.floor(z-R);j<=Math.floor(z+R);j++)for(let i=Math.floor(x-R);i<=Math.floor(x+R);i++)for(const k of buckets.get(`${i}:${j}`)??[]){
   if(marks[k]===stamp)continue;marks[k]=stamp;
   const [a,b,c,d]=segments[k],dx=c-a,dz=d-b,t=Math.max(0,Math.min(1,((x-a)*dx+(z-b)*dz)/(dx*dx+dz*dz||1)));
   if(Math.hypot(x-a-t*dx,z-b-t*dz)<R)return false;
  }
  return true;
 };
 let nearest=-1,best=Infinity;
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
  const x=x0+(i+.5)*C,z=z0+(j+.5)*C;
  if(!plan.rooms.some(r=>x>=r.rect[0]-.0001&&x<=r.rect[2]+.0001&&z>=r.rect[1]-.0001&&z<=r.rect[3]+.0001)||!clear(x,z))continue;
  const k=j*nx+i;free[k]=1;const d=Math.hypot(x-start[0],z-start[1]);if(d<best){best=d;nearest=k;}
 }
 if(nearest<0||best>.3)return targets.map(r=>r.label);
 const queue=[nearest];seen[nearest]=1;
 for(let h=0;h<queue.length;h++){const k=queue[h],i=k%nx;for(const q of [i>0?k-1:-1,i<nx-1?k+1:-1,k-nx,k+nx])if(q>=0&&q<free.length&&free[q]&&!seen[q]){seen[q]=1;queue.push(q);}}
 return targets.filter(r=>!queue.some(k=>{const x=x0+(k%nx+.5)*C,z=z0+(Math.floor(k/nx)+.5)*C;return x>r.rect[0]&&x<r.rect[2]&&z>r.rect[1]&&z<r.rect[3];})).map(r=>r.label);
}
