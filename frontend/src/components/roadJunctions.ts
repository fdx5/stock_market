import type {RealEstateRoad} from '../api/client';
type Point=[number,number];
/** Same three-metre knots and edge normals as rendered asphalt, including
 * filled junctions. Used to exclude pavements from the actual carriageway. */
export function roadFootprints(roads:readonly RealEstateRoad[]):Point[][]{
 const out:Point[][]=[];
 for(const r of roads){const pts:Point[]=[];
  for(let i=1;i<r.line.length;i++){const a=r.line[i-1],b=r.line[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);for(let d=0;d<len;d+=3)pts.push([a[0]+(b[0]-a[0])*d/len,a[1]+(b[1]-a[1])*d/len]);}
  if(r.line.length<2)continue;pts.push(r.line[r.line.length-1]);
  const edge=pts.map((p,i)=>{const a=pts[Math.max(0,i-1)],b=pts[Math.min(pts.length-1,i+1)],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1,w=r.width/2;return [[p[0]-dy/l*w,p[1]+dx/l*w],[p[0]+dy/l*w,p[1]-dx/l*w]] as [Point,Point];});
  for(let i=1;i<edge.length;i++){const a=edge[i-1],b=edge[i];out.push([a[0],a[1],b[1]],[a[0],b[1],b[0]]);}
 }
 return out.concat(roadJunctionHulls([...roads]));
}
/** The exact junction polygons used by asphalt and street furniture alike. */
export function roadJunctionHulls(roads:RealEstateRoad[]):Point[][]{
 const ends:{x:number;y:number;hx:number;hy:number;w:number}[]=[];
 for(const r of roads){const p=r.line,n=p.length;if(n<2)continue;
  for(const start of [true,false]){const a=start?p[0]:p[n-1],b=start?p[1]:p[n-2],dx=a[0]-b[0],dy=a[1]-b[1],l=Math.hypot(dx,dy)||1;ends.push({x:a[0],y:a[1],hx:dx/l,hy:dy/l,w:r.width});}
 }
 const nodes:{x:number;y:number;ends:number[]}[]=[];
 ends.forEach((e,i)=>{let k=nodes.findIndex(n=>Math.hypot(n.x-e.x,n.y-e.y)<6);if(k<0){k=nodes.length;nodes.push({x:e.x,y:e.y,ends:[]});}nodes[k].ends.push(i);});
 const jn=nodes.filter(n=>n.ends.length>=2),parent=jn.map((_,i)=>i);
 const find=(i:number):number=>parent[i]===i?i:(parent[i]=find(parent[i]));
 jn.forEach((a,i)=>jn.forEach((b,j)=>{if(j>i&&a.ends.length>=3&&b.ends.length>=3&&Math.hypot(a.x-b.x,a.y-b.y)<35)parent[find(i)]=find(j);}));
 const groups=new Map<number,number[]>();jn.forEach((n,i)=>{const r=find(i);groups.set(r,[...(groups.get(r)??[]),...n.ends]);});
 const hull=(pts:Point[])=>{const p=[...pts].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);if(p.length<3)return p;
  const cross=(o:Point,a:Point,b:Point)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]),lo:Point[]=[],hi:Point[]=[];
  for(const q of p){while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],q)<=0)lo.pop();lo.push(q);}
  for(let i=p.length-1;i>=0;i--){const q=p[i];while(hi.length>=2&&cross(hi[hi.length-2],hi[hi.length-1],q)<=0)hi.pop();hi.push(q);}return lo.slice(0,-1).concat(hi.slice(0,-1));
 };
 return [...groups.values()].map(group=>hull(group.flatMap(k=>{const e=ends[k],rx=e.hy,ry=-e.hx,hw=e.w/2;return [[e.x+rx*hw,e.y+ry*hw],[e.x-rx*hw,e.y-ry*hw]] as Point[];}))).filter(h=>h.length>=3);
}
