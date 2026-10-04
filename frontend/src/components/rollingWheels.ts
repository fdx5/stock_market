import * as THREE from 'three';
import {mergeGeometries}from'three/examples/jsm/utils/BufferGeometryUtils.js';
import {onSceneMemoryRelease}from'./sceneMemory';
export interface RollingWheel{x:number;y:number;z:number;radius:number;width:number;side:number}
export interface RollingRig{body:THREE.BufferGeometry;wheels:RollingWheel[];full:boolean}
const rigs=new Map<THREE.BufferGeometry,RollingRig>();

/** Preserve the downloaded body; replace only its explicit rim/tyre material
 * slots with a shared rolling model. Axle positions come from the actual mesh. */
export function modelWheelRig(g:THREE.BufferGeometry):RollingRig{
 const hit=rigs.get(g);if(hit)return hit;
 const p=g.attributes.position,u=g.attributes.uv,idx=g.index;
 if(!u||!idx)return {body:g,wheels:[],full:false};
 const wheelTriangles:number[][]=[],bodyIndex:number[]=[],rimPoints:number[][]=[];
 for(let k=0;k<idx.count;k+=3){const tri=[idx.getX(k),idx.getX(k+1),idx.getX(k+2)],part=Math.floor(u.getX(tri[0])*16);
  if((part===3||part===9)&&tri.every(v=>Math.floor(u.getX(v)*16)===part)){
   wheelTriangles.push(tri);if(part===3)for(const v of tri)rimPoints.push([p.getX(v),p.getY(v),p.getZ(v)]);
  }else bodyIndex.push(...tri);
 }
 const split=(points:number[][],axis:number,gap:number)=>{
  points.sort((a,b)=>a[axis]-b[axis]);const groups:number[][][]=[];
  for(const q of points){const last=groups[groups.length-1];if(!last||q[axis]-last[last.length-1][axis]>gap)groups.push([q]);else last.push(q);}return groups;
 };
 const centers=split(rimPoints,0,.06).flatMap(group=>split(group,2,.18).map(v=>{
  const minY=Math.min(...v.map(p=>p[1])),maxY=Math.max(...v.map(p=>p[1]));
  return {x:v.reduce((s,p)=>s+p[0],0)/v.length,y:(minY+maxY)/2,z:(Math.min(...v.map(p=>p[2]))+Math.max(...v.map(p=>p[2])))/2,radius:(maxY-minY)/1.34};
 })).filter(c=>c.radius>.15&&c.radius<1);
 if(!centers.length)return {body:g,wheels:[],full:false};
 const bounds=centers.map(()=>({lo:[Infinity,Infinity,Infinity],hi:[-Infinity,-Infinity,-Infinity]}));
 for(const tri of wheelTriangles){const x=tri.reduce((s,v)=>s+p.getX(v)/3,0),z=tri.reduce((s,v)=>s+p.getZ(v)/3,0);
  let best=0,dist=Infinity;centers.forEach((c,i)=>{const d=(x-c.x+Math.sign(c.x)*.1)**2+(z-c.z)**2;if(d<dist){best=i;dist=d;}});
  for(const v of tri){const a=[p.getX(v),p.getY(v),p.getZ(v)],b=bounds[best];for(let j=0;j<3;j++){b.lo[j]=Math.min(b.lo[j],a[j]);b.hi[j]=Math.max(b.hi[j],a[j]);}}
 }
 const wheels=centers.map((c,i)=>{const b=bounds[i];return {x:(b.lo[0]+b.hi[0])/2,y:(b.lo[1]+b.hi[1])/2,z:c.z,radius:(b.hi[1]-b.lo[1])/2,width:b.hi[0]-b.lo[0],side:Math.sign(c.x)};});
 const body=new THREE.BufferGeometry();for(const[name,a]of Object.entries(g.attributes))body.setAttribute(name,a);body.setIndex(bodyIndex);body.boundingSphere=g.boundingSphere?.clone()??null;
 const rig={body,wheels,full:true};rigs.set(g,rig);return rig;
}

/** Fallback wheel centers match the procedural vehicle builders. */
const layouts:Record<string,[number,number,number[]]>={
 ambulance:[1.96,.37,[1.85,-1.8]],police:[1.84,.34,[1.45,-1.5]],fire:[2.4,.5,[2.55,-2.3]],
 'dump-orange':[2.45,.52,[3.6,2.25,-1.9,-3.25]],'dump-yellow':[2.45,.52,[3.6,2.25,-1.9,-3.25]],
 'dump-small':[1.95,.4,[2,-1.6]],excavator:[2.45,.5,[1.3,-1.3]],lowbed:[2.6,.4,[7.2,5.4,-6.2,-7.2]],
 'cargo-crane':[2.35,.48,[3.1,-1.7,-2.95]],'mobile-crane':[2.75,.62,[4.6,3,-1.9,-3.5]],pump:[2.45,.52,[4.6,3.2,-2.5,-3.85]],
 wing:[2.45,.5,[3.6,-2.3,-3.6]],tanker:[2.48,.52,[5.3,3.8,-4.6,-5.8]],
 'box-cooled':[1.75,.36,[1.75,-1.55]],'box-dry':[1.75,.36,[1.75,-1.55]],ladder:[1.78,.36,[1.7,-1.6]],tow:[1.95,.4,[2.05,-1.55]],sweeper:[2.1,.45,[2.2,-1.8]],
 'bus-village':[2.3,.35,[2.6,-2.6]],'bus-coach':[2.5,.35,[4.2,-3,-4.2]],'bus-double':[2.5,.35,[4.2,-3.1,-4.3]],
};
export function fallbackWheelRig(g:THREE.BufferGeometry,name:string,dims:readonly number[],spec?:{width:number;length:number;wheel:number;axles:number[]}):RollingRig{
 if(name==='scooter')return {body:g,full:false,wheels:[-.62,.62].map(z=>({x:.065,y:.27,z,radius:.27,width:.04,side:1}))};
 const [w,r,zs]=spec?[spec.width,spec.wheel,spec.axles.map(t=>(t-.5)*spec.length)]:layouts[name]??[dims[1],.4,[dims[0]*.32,-dims[0]*.32]];
 return {body:g,full:false,wheels:zs.flatMap(z=>[-1,1].map(side=>({x:side*(w/2+.018),y:r,z,radius:r,width:.04,side})))};
}
export function wheelRotation(distance:number,radius:number){return distance/Math.max(radius,.01)%(Math.PI*2);}

let full:THREE.BufferGeometry|undefined,rim:THREE.BufferGeometry|undefined;
export function rollingWheelGeometry(rimOnly=false){
 if(rimOnly&&rim)return rim;if(!rimOnly&&full)return full;
 const pieces:THREE.BufferGeometry[]=[];
 const add=(g:THREE.BufferGeometry,color:string)=>{const c=new THREE.Color(color),a=new Float32Array(g.attributes.position.count*3);for(let i=0;i<a.length;i+=3)a.set([c.r,c.g,c.b],i);g.setAttribute('color',new THREE.BufferAttribute(a,3));g.deleteAttribute('uv');pieces.push(g);};
 if(!rimOnly)add(new THREE.CylinderGeometry(1,1,1,20,1).rotateZ(Math.PI/2),'#17191c');
 // Closed opaque backing: legacy procedural wheels cannot expose the road
 // through the rotating spoke gaps, even when their source tyre is open.
 if(rimOnly)add(new THREE.CylinderGeometry(.94,.94,.04,20).rotateZ(Math.PI/2).translate(.46,0,0),'#17191c');
 const face=rimOnly?.5:.51;
 add(new THREE.CylinderGeometry(.67,.67,.04,20).rotateZ(Math.PI/2).translate(face,0,0),'#34383d');
 add(new THREE.TorusGeometry(.63,.035,4,20).rotateY(Math.PI/2).translate(face+.035,0,0),'#d8dde1');
 add(new THREE.CylinderGeometry(.16,.16,.08,12).rotateZ(Math.PI/2).translate(face+.055,0,0),'#c6ccd1');
 for(let i=0;i<5;i++){const a=i*Math.PI*2/5,g=new THREE.BoxGeometry(.065,.1,.49);g.translate(face+.03,0,.385);g.rotateX(a);add(g,'#d8dde1');}
 if(!rimOnly){
  add(new THREE.TorusGeometry(.89,.026,3,20).rotateY(Math.PI/2).translate(.51,0,0),'#51565c');
  for(let i=0;i<12;i++){const g=new THREE.BoxGeometry(.3,.035,.1).translate(.3,0,.973).rotateX(i*Math.PI/6);add(g,i%2?'#252a30':'#3d4349');}
 }
 const flat=pieces.map(g=>g.index?g.toNonIndexed():g);
 const out=mergeGeometries(flat,false)!;flat.forEach((g,i)=>{if(g!==pieces[i])g.dispose();});pieces.forEach(g=>g.dispose());out.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(out.attributes.position.count*2),2));out.computeBoundingSphere();
 if(rimOnly)rim=out;else full=out;return out;
}
onSceneMemoryRelease(()=>{rigs.forEach(r=>r.body.dispose());rigs.clear();full?.dispose();rim?.dispose();full=undefined;rim=undefined;});
