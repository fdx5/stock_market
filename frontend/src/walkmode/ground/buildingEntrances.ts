import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { BuildingCategory } from "../building/categories";

/** Civic/commercial thresholds, separate from apartment 공동현관. Their width is constrained by the
 * surveyed facade; their architectural details are reconstructed, not claimed to be measured doors.
 * One merged draw per finish, shared materials/textures, no additional realtime lights. */
type Finish="stone"|"darkStone"|"metal"|"bronze"|"glass"|"soffit"|"light";
let shared:Record<Finish,THREE.Material>|null=null;
function materials(){
  if(shared)return shared;
  const std=(color:string,roughness:number,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
  shared={stone:std("#c8c5bd",.72),darkStone:std("#313b43",.55),metal:std("#aebfc8",.25,.85),bronze:std("#80664b",.32,.78),glass:new THREE.MeshPhysicalMaterial({color:"#8bb6ca",roughness:.1,metalness:.08,transparent:true,opacity:.38,depthWrite:false,side:THREE.DoubleSide}),soffit:std("#ece3d4",.7),light:new THREE.MeshBasicMaterial({color:"#ffe3ac"})};
  Object.values(shared).forEach(m=>m.userData.entranceShared=true);return shared;
}
export function entranceDimensions(category:BuildingCategory,facadeSpan:number,floors:number,area:number){
  const monumental=category==="public"||category==="museum",large=monumental||category==="department"||category==="hospital";
  const cap=category==="shop"?10:category==="station"?11:category==="hospital"?25:32;
  const W=Math.max(3.2,Math.min(cap,facadeSpan*2-1.2,Math.max(large?12:6,Math.sqrt(Math.max(area,80))*(large?.5:.32))));
  const H=Math.min(Math.max(3.2,floors*3.3-.4),monumental?8.5:category==="department"?7.4:category==="hospital"?6.3:5.4);
  return {width:W,height:H,depth:large?Math.min(5.5,W*.24):2.5,monumental};
}
export function buildBuildingEntrance(category:BuildingCategory,span:number,floors:number,area:number,sign:THREE.Texture,night:number){
  const M=materials(),d=entranceDimensions(category,span,floors,area),W=d.width,H=d.height,D=d.depth;
  const parts=new Map<Finish,THREE.BufferGeometry[]>(),owned:THREE.BufferGeometry[]=[];
  const add=(key:Finish,g:THREE.BufferGeometry)=>{const list=parts.get(key)??[];list.push(g);parts.set(key,list);};
  const box=(key:Finish,x:number,y:number,z:number,w:number,h:number,dep:number)=>add(key,new RoundedBoxGeometry(w,h,dep,1,Math.min(.04,w/5,h/5,dep/5)).translate(x,y,z));
  const column=(x:number,z:number,r:number)=>add("stone",new THREE.CylinderGeometry(r,r*1.05,H-.55,16).translate(x,(H-.55)/2,z));
  const stone=category==="department"||category==="office"?"darkStone":"stone",trim=category==="department"||category==="museum"?"bronze":"metal";
  // Broad portal, a full glazed vestibule, several automatic door bays (no apartment intercoms).
  box(stone,-W/2+.35,H/2,-.1,.7,H,.6);box(stone,W/2-.35,H/2,-.1,.7,H,.6);
  box(stone,0,H-.38,-.1,W,.76,.6);
  const bays=Math.max(1,Math.min(6,Math.floor((W-1.4)/2.7))),bay=(W-1.4)/bays;
  for(let i=0;i<bays;i++){
    const x=-W/2+.7+bay*(i+.5);
    box("glass",x,1.45,.08,bay-.12,2.9,.045);
    box(trim,x,2.97,.1,bay,.13,.15);
    for(const side of [-1,1]){box(trim,x+side*(bay/2-.04),1.5,.11,.08,3,.13);box(trim,x+side*.12,1.25,.15,.035,.6,.04);}
    box("metal",x,1.05,.13,bay-.16,.04,.025);
    if(H>4)box("glass",x,(3.1+H-.8)/2,.04,bay-.12,H-3.9,.045);
  }
  // A canopy large enough for the building's public entrance; hospital/department drop-off style.
  box(stone,0,H*.72,D*.44,W+1,.25,D);
  box("soffit",0,H*.72-.16,D*.44,W+.5,.08,D-.2);
  const lightCount=Math.max(2,Math.floor(W/3));
  for(let i=0;i<lightCount;i++)box("light",-W*.4+W*.8*(i+.5)/lightCount,H*.72-.21,D*.45,.65,.025,.12);
  for(const side of [-1,1]){
    const x=side*(W/2-.6);
    if(d.monumental){column(x,D-.65,.3);box("stone",x,.15,D-.65,1,.3,1);box("stone",x,H-.5,D-.65,1,.3,1);}
    else if(W>12)box(trim,x,H*.36,D-.6,.18,H*.72,.18);
  }
  if(d.monumental){box("stone",0,H+.05,.2,W+1.3,.35,1.2);for(let x=-W/2+1.6;x<W/2-1;x+=2.4)box("stone",x,H-.13,.18,.14,.8,.75);}
  // Large civic forecourt paving and a flush, wheelchair-accessible central approach.
  box("stone",0,-.04,D*.48,W+1.5,.08,D+1.4);
  box("darkStone",0,.012,.55,Math.max(2.5,W*.45),.02,1.4);
  // Bollards stay outside the main passage, rather than blocking the player or doors.
  if(W>12)for(const x of [-W*.42,W*.42])box(trim,x,.45,D+.1,.16,.9,.16);
  const group=new THREE.Group();
  for(const [key,list] of parts){const geo=mergeGeometries(list,false);list.forEach(g=>g.dispose());if(!geo)continue;owned.push(geo);const mesh=new THREE.Mesh(geo,M[key]);if(key==="glass")mesh.renderOrder=2;group.add(mesh);}
  const sm=new THREE.MeshBasicMaterial({map:sign,toneMapped:false});sm.userData.entranceShared=true;
  const plate=new THREE.Mesh(new THREE.PlaneGeometry(Math.min(W*.65,12),Math.min(1.1,H*.16)),sm);plate.position.set(0,H-.5,.25);group.add(plate);owned.push(plate.geometry);
  group.userData.entranceCategory=category;group.userData.facadeWidth=span*2;group.userData.dimensions=d;group.userData.source="surveyed-facade / reconstructed-architecture";
  void night;
  return {group,extent:W/2+.8,opening:{hw:(W-1.4)/2,top:3,depth:2.2},dispose(){owned.forEach(g=>g.dispose());sm.dispose();sign.dispose();}};
}
export function disposeBuildingEntranceShared(){if(!shared)return;Object.values(shared).forEach(m=>m.dispose());shared=null;}
