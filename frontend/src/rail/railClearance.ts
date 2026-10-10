/** CPU-only subtraction of train clearance prisms from building surfaces.
 * The registered footprint and all faces outside the passage stay in place.
 * Attributes are interpolated at cut edges; this works in WebGL and WebGPU. */
export interface Clearance {a:number[];b:number[];half:number;bottom:number;top:number}
export interface CutGeometry {attributes:Record<string,{array:Float32Array;size:number}>;index:Uint32Array;groups:{start:number;count:number;materialIndex:number}[]}
type Vertex={p:number[];v:number[]};
const mix=(a:Vertex,b:Vertex,t:number):Vertex=>({p:a.p.map((x,i)=>x+(b.p[i]-x)*t),v:a.v.map((x,i)=>x+(b.v[i]-x)*t)});
const clip=(poly:Vertex[],plane:number[],inside:boolean)=>{
  const out:Vertex[]=[];if(!poly.length)return out;
  const value=(p:number[])=>plane[0]*p[0]+plane[1]*p[1]+plane[2]*p[2]+plane[3];
  let a=poly[poly.length-1],da=value(a.p),ina=inside?da>=-1e-7:da<=1e-7;
  for(const b of poly){const db=value(b.p),inb=inside?db>=-1e-7:db<=1e-7;
    if(ina!==inb)out.push(mix(a,b,da/(da-db)));
    if(inb)out.push(b);a=b;da=db;ina=inb;
  }return out;
};
export function clearancePlanes(c:Clearance):number[][]{
  const dx=c.b[0]-c.a[0],dz=c.b[2]-c.a[2],len=Math.hypot(dx,dz)||1,ux=dx/len,uz=dz/len,nx=-uz,nz=ux;
  const along=ux*c.a[0]+uz*c.a[2],side=nx*c.a[0]+nz*c.a[2],grade=(c.b[1]-c.a[1])/len;
  const level=c.a[1]-grade*along;
  return [[ux,0,uz,-along+.2],[-ux,0,-uz,along+len+.2],
    [nx,0,nz,-side+c.half],[-nx,0,-nz,side+c.half],
    [-grade*ux,1,-grade*uz,-level-c.bottom],[grade*ux,-1,grade*uz,level+c.top]];
}
export function cutBuilding(input:CutGeometry,matrix:number[],clearances:Clearance[]):CutGeometry|null{
  const keys=Object.keys(input.attributes),sizes=keys.map(k=>input.attributes[k].size),offsets:number[]=[];let width=0;
  sizes.forEach(s=>{offsets.push(width);width+=s;});
  const position=input.attributes.position.array,world=(i:number)=>{
    const x=position[i*3],y=position[i*3+1],z=position[i*3+2];
    return [matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12],matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13],matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14]];
  };
  const prisms=clearances.map(c=>({planes:clearancePlanes(c),box:[Math.min(c.a[0],c.b[0])-c.half-.3,Math.min(c.a[1],c.b[1])+c.bottom-.3,Math.min(c.a[2],c.b[2])-c.half-.3,Math.max(c.a[0],c.b[0])+c.half+.3,Math.max(c.a[1],c.b[1])+c.top+.3,Math.max(c.a[2],c.b[2])+c.half+.3]}));
  // Spatial bins bound the candidates for a wall or roof instead of testing every
  // triangle against every resampled rail segment in the neighbourhood.
  const bins=new Map<string,number[]>(),CELL=40;
  prisms.forEach((p,i)=>{for(let x=Math.floor(p.box[0]/CELL);x<=Math.floor(p.box[3]/CELL);x++)for(let z=Math.floor(p.box[2]/CELL);z<=Math.floor(p.box[5]/CELL);z++){const k=x+','+z;const a=bins.get(k)??[];a.push(i);bins.set(k,a);}});
  const extra:Record<string,number[]>=Object.fromEntries(keys.map(k=>[k,[]])),indices:number[]=[],groups:CutGeometry['groups']=[];
  let changed=false,next=position.length/3,lastMaterial=-1;
  const pushIndex=(ids:number[],material:number)=>{if(material!==lastMaterial){groups.push({start:indices.length,count:0,materialIndex:material});lastMaterial=material;}indices.push(...ids);groups[groups.length-1].count+=ids.length;};
  const vertex=(i:number):Vertex=>({p:world(i),v:keys.flatMap(k=>{const a=input.attributes[k];return Array.from(a.array.subarray(i*a.size,(i+1)*a.size));})});
  const emit=(poly:Vertex[],material:number)=>{
    if(poly.length<3)return;const ids:number[]=[];
    for(const v of poly){ids.push(next++);keys.forEach((k,i)=>extra[k].push(...v.v.slice(offsets[i],offsets[i]+sizes[i])));}
    for(let i=1;i<ids.length-1;i++)pushIndex([ids[0],ids[i],ids[i+1]],material);
  };
  let gi=0;
  for(let i=0;i<input.index.length;i+=3){
    while(gi+1<input.groups.length&&i>=input.groups[gi].start+input.groups[gi].count)gi++;
    const material=input.groups[gi]?.materialIndex??0,ids=Array.from(input.index.subarray(i,i+3));
    if(ids[0]===ids[1]||ids[0]===ids[2]||ids[1]===ids[2]){pushIndex(ids,material);continue;}
    const pts=ids.map(world),box=[...Array.from({length:3},(_,a)=>Math.min(...pts.map(p=>p[a]))),...Array.from({length:3},(_,a)=>Math.max(...pts.map(p=>p[a])))];
    const candidates=new Set<number>();
    for(let x=Math.floor(box[0]/CELL);x<=Math.floor(box[3]/CELL);x++)for(let z=Math.floor(box[2]/CELL);z<=Math.floor(box[5]/CELL);z++)for(const n of bins.get(x+','+z)??[])candidates.add(n);
    const nearby=[...candidates].map(n=>prisms[n]).filter(p=>![0,1,2].some(a=>box[a]>p.box[a+3]||box[a+3]<p.box[a]));
    if(!nearby.length){pushIndex(ids,material);continue;}
    let polys=[ids.map(vertex)],cut=false;
    for(const prism of nearby){const out:Vertex[][]=[];
      for(const poly of polys){
        let remaining=poly;const kept:Vertex[][]=[];
        for(const plane of prism.planes){const outside=clip(remaining,plane,false);if(outside.length>=3)kept.push(outside);remaining=clip(remaining,plane,true);if(remaining.length<3)break;}
        if(remaining.length>=3){cut=true;out.push(...kept);}else out.push(poly);
      }polys=out;if(!polys.length)break;
    }
    if(cut){changed=true;for(const poly of polys)emit(poly,material);}else pushIndex(ids,material);
  }
  if(!changed)return null;
  const attributes:CutGeometry['attributes']={};
  for(const k of keys){const old=input.attributes[k],array=new Float32Array(old.array.length+extra[k].length);array.set(old.array);array.set(extra[k],old.array.length);attributes[k]={array,size:old.size};}
  return {attributes,index:new Uint32Array(indices),groups};
}
