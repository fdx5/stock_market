import * as THREE from 'three';
type Pt=[number,number];
/** Exact convex subtraction in footprint x/y. Generated pieces preserve all
 * original vertex attributes, including paving UVs and kerb vertex colours. */
export async function excludeSurface(geometry:THREE.BufferGeometry,rings:readonly Pt[][],pace:()=>Promise<boolean>){
 // (the footprints' triangles and their bins: the same rings cut the asphalt and every paint mesh
 // in turn — triangulated once for them all)
 const {blockers,bins,boxes}=blockersOf(rings),cell=12;
 const binKey=(x:number,y:number)=>(x+65536)*131072+(y+65536);
 const source=geometry.index?geometry.toNonIndexed():geometry,attributes=Object.entries(source.attributes),offsets:number[]=[];let stride=0;
 for(const[,a]of attributes){offsets.push(stride);stride+=a.itemSize;}
 const pi=attributes.findIndex(([name])=>name==='position'),po=offsets[pi],position=source.getAttribute('position'),outputs=attributes.map(()=>[] as number[]);let changed=false;
 const half=(poly:number[][],a:Pt,b:Pt,sign:number,inside:boolean)=>{
  const out:number[][]=[],dist=(p:number[])=>((b[0]-a[0])*(-p[po+2]-a[1])-(b[1]-a[1])*(p[po]-a[0]))*sign;
  for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],dp=dist(p),dq=dist(q),ip=inside?dp>=0:dp<=0,iq=inside?dq>=0:dq<=0;if(ip)out.push(p);if(ip!==iq){const t=dp/(dp-dq);out.push(p.map((v,k)=>v+(q[k]-v)*t));}}return out;
 };
 for(let k=0;k<position.count;k+=3){
  if(k%900===0&&!await pace()){if(source!==geometry)source.dispose();return;}
  const xs=[position.getX(k),position.getX(k+1),position.getX(k+2)],ys=[-position.getZ(k),-position.getZ(k+1),-position.getZ(k+2)],candidates=new Set<number>();
  // A plan-view footprint cannot prove a collision with an elevated deck.
  // Road meshes and paint retain their level attributes through worker copies.
  const levels=source.getAttribute('roadLevel'),elevated=levels&&[0,1,2].every(i=>levels.getX(k+i)>0);
  if(!elevated)for(let x=Math.floor(Math.min(...xs)/cell);x<=Math.floor(Math.max(...xs)/cell);x++)for(let y=Math.floor(Math.min(...ys)/cell);y<=Math.floor(Math.max(...ys)/cell);y++){const l=bins.get(binKey(x,y));if(l)for(const id of l)candidates.add(id);}
  // (no footprint near it — nearly every triangle: copied as it is)
  if(!candidates.size){attributes.forEach(([,a],j)=>{const o=outputs[j],n=a.itemSize,arr=a.array;for(let v=k*n,e=(k+3)*n;v<e;v++)o.push(arr[v]);});continue;}
  const original=[0,1,2].map(i=>attributes.flatMap(([,a])=>Array.from({length:a.itemSize},(_,j)=>a.array[(k+i)*a.itemSize+j])));
  let pieces=[original];
  const tx0=Math.min(...xs),tx1=Math.max(...xs),ty0=Math.min(...ys),ty1=Math.max(...ys);
  for(const id of candidates){
   // (a footprint triangle whose box misses this one's: nothing to clip)
   const bb=boxes[id];if(bb[0]>=tx1||bb[2]<=tx0||bb[1]>=ty1||bb[3]<=ty0)continue;
   const t=blockers[id],sign=Math.sign((t[1][0]-t[0][0])*(t[2][1]-t[0][1])-(t[1][1]-t[0][1])*(t[2][0]-t[0][0]));if(!sign)continue;
   const next:number[][][]=[];
   for(const poly of pieces){let rest=poly;
    // A boundary touch with zero horizontal intersection area is not paving
    // over asphalt. Preserve vertical kerbs and avoid needless subdivisions.
    let overlap=poly;for(let edge=0;edge<3;edge++)overlap=half(overlap,t[edge],t[(edge+1)%3],sign,true);
    let area=0;for(let i=0;i<overlap.length;i++){const p=overlap[i],q=overlap[(i+1)%overlap.length];area+=p[po]*-q[po+2]-q[po]*-p[po+2];}
    if(Math.abs(area)<1e-8){next.push(poly);continue;}changed=true;
    for(let edge=0;edge<3&&rest.length>=3;edge++){const outside=half(rest,t[edge],t[(edge+1)%3],sign,false);if(outside.length>=3)next.push(outside);rest=half(rest,t[edge],t[(edge+1)%3],sign,true);}
   }pieces=next;if(!pieces.length)break;
  }
  for(const poly of pieces)for(let i=1;i+1<poly.length;i++)for(const p of [poly[0],poly[i],poly[i+1]])attributes.forEach(([,a],j)=>{for(let v=0;v<a.itemSize;v++)outputs[j].push(p[offsets[j]+v]);});
 }
 if(changed){geometry.setIndex(null);attributes.forEach(([name,a],i)=>geometry.setAttribute(name,new THREE.Float32BufferAttribute(outputs[i],a.itemSize)));geometry.computeBoundingSphere();}
 if(source!==geometry)source.dispose();
}

const blockerCache=new WeakMap<readonly Pt[][],{blockers:Pt[][];bins:Map<number,number[]>;boxes:number[][]}>();
function blockersOf(rings:readonly Pt[][]){
 let hit=blockerCache.get(rings);if(hit)return hit;
 const blockers:Pt[][]=[],bins=new Map<number,number[]>(),cell=12,binKey=(x:number,y:number)=>(x+65536)*131072+(y+65536);
 for(const ring of rings){if(ring.length<3)continue;
  const pts=ring.map(p=>new THREE.Vector2(...p));
  for(const tri of THREE.ShapeUtils.triangulateShape(pts,[])){
   const p=tri.map(i=>ring[i]),id=blockers.length;blockers.push(p);
   for(let x=Math.floor(Math.min(...p.map(q=>q[0]))/cell);x<=Math.floor(Math.max(...p.map(q=>q[0]))/cell);x++)for(let y=Math.floor(Math.min(...p.map(q=>q[1]))/cell);y<=Math.floor(Math.max(...p.map(q=>q[1]))/cell);y++){const key=binKey(x,y),l=bins.get(key);if(l)l.push(id);else bins.set(key,[id]);}
  }
 }
 const boxes=blockers.map(p=>[Math.min(p[0][0],p[1][0],p[2][0]),Math.min(p[0][1],p[1][1],p[2][1]),Math.max(p[0][0],p[1][0],p[2][0]),Math.max(p[0][1],p[1][1],p[2][1])]);
 hit={blockers,bins,boxes};blockerCache.set(rings,hit);return hit;
}
