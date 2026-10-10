import * as THREE from 'three';
type Pt=[number,number];
/** Exact convex subtraction in footprint x/y. Generated pieces preserve all
 * original vertex attributes, including paving UVs and kerb vertex colours. */
export async function excludeSurface(geometry:THREE.BufferGeometry,rings:readonly Pt[][],pace:()=>Promise<boolean>){
 const blockers:Pt[][]=[],bins=new Map<string,number[]>(),cell=12;
 for(const ring of rings){if(ring.length<3)continue;
  const pts=ring.map(p=>new THREE.Vector2(...p));
  for(const tri of THREE.ShapeUtils.triangulateShape(pts,[])){
   const p=tri.map(i=>ring[i]),id=blockers.length;blockers.push(p);
   for(let x=Math.floor(Math.min(...p.map(q=>q[0]))/cell);x<=Math.floor(Math.max(...p.map(q=>q[0]))/cell);x++)for(let y=Math.floor(Math.min(...p.map(q=>q[1]))/cell);y<=Math.floor(Math.max(...p.map(q=>q[1]))/cell);y++){const key=x+':'+y,l=bins.get(key);if(l)l.push(id);else bins.set(key,[id]);}
  }
 }
 const source=geometry.index?geometry.toNonIndexed():geometry,attributes=Object.entries(source.attributes),offsets:number[]=[];let stride=0;
 for(const[,a]of attributes){offsets.push(stride);stride+=a.itemSize;}
 const pi=attributes.findIndex(([name])=>name==='position'),po=offsets[pi],position=source.getAttribute('position'),outputs=attributes.map(()=>[] as number[]);let changed=false;
 const half=(poly:number[][],a:Pt,b:Pt,sign:number,inside:boolean)=>{
  const out:number[][]=[],dist=(p:number[])=>((b[0]-a[0])*(-p[po+2]-a[1])-(b[1]-a[1])*(p[po]-a[0]))*sign;
  for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],dp=dist(p),dq=dist(q),ip=inside?dp>=0:dp<=0,iq=inside?dq>=0:dq<=0;if(ip)out.push(p);if(ip!==iq){const t=dp/(dp-dq);out.push(p.map((v,k)=>v+(q[k]-v)*t));}}return out;
 };
 for(let k=0;k<position.count;k+=3){
  if(k%900===0&&!await pace()){if(source!==geometry)source.dispose();return;}
  const original=[0,1,2].map(i=>attributes.flatMap(([,a])=>Array.from({length:a.itemSize},(_,j)=>a.array[(k+i)*a.itemSize+j]))),candidates=new Set<number>();
  const xs=original.map(p=>p[po]),ys=original.map(p=>-p[po+2]);
  // A plan-view footprint cannot prove a collision with an elevated deck.
  // Road meshes and paint retain their level attributes through worker copies.
  const levels=source.getAttribute('roadLevel'),elevated=levels&&[0,1,2].every(i=>levels.getX(k+i)>0);
  if(!elevated)for(let x=Math.floor(Math.min(...xs)/cell);x<=Math.floor(Math.max(...xs)/cell);x++)for(let y=Math.floor(Math.min(...ys)/cell);y<=Math.floor(Math.max(...ys)/cell);y++)for(const id of bins.get(x+':'+y)??[])candidates.add(id);
  let pieces=[original];
  for(const id of candidates){const t=blockers[id],sign=Math.sign((t[1][0]-t[0][0])*(t[2][1]-t[0][1])-(t[1][1]-t[0][1])*(t[2][0]-t[0][0]));if(!sign)continue;
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
