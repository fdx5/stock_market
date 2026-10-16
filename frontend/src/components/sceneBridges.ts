import * as THREE from "three";
import type { RealEstateParcel, RealEstateRoad } from "../api/client";
import {roadHeight,sameRoadLevel,roadProfileKey,nearestRoadPoint} from "./roadLevels";
import {roadApproachTerrain} from "./roadApproaches";

import type { Terrain } from "./sceneTerrain";
import {surfaceGeometry} from './surfaceGeometry';

/* Structures are admitted only by official road-link attributes. Water adjacency
 * never creates a bridge. Deck height is a DEM-derived profile; no surveyed Z is
 * available in this feed, so invented clearance/ramps/piers are deliberately absent. */
export interface Bridge {
 x:Float32Array;y:Float32Array;nx:Float32Array;ny:Float32Array;s:Float32Array;h:Float32Array;
 left_h?:Float32Array;right_h?:Float32Array;
 half:number;outer:number;lanes:number;level:number;box:[number,number,number,number];road:RealEstateRoad;
 /** the sidewalk on each side; per point, an edge with no parapet (another deck's lanes there:
  * a ramp merging); the piers as [x, y, foot, top] */
 sw?:number;openL?:Uint8Array;openR?:Uint8Array;piers?:Float32Array;
}
/** The structure's dimensions — one design for every bridge, the same as the streamed tiles'
 * (droneRoads.ts): a 1.4 m slab edge, a 1 m parapet 0.3 m outside the sidewalk, a pier every 45 m
 * of the official bridge's chain (one column under a deck up to 14 m, two over). */
export const DECK={slab:1.4,parapet:1,margin:.3,pierSpan:45,pierHalf:.9} as const;
/** The sidewalk's width on a road of registered width w (sceneSidewalk.sidewalkWidth). */
const sidewalkOf=(w:number)=>w>=30?5:w>=20?4:w>=12?3:2.25;
export function findBridges(roads:RealEstateRoad[],_parcels:RealEstateParcel[],_covered:boolean[],terrain:Terrain):Bridge[]{
 const surface=roadApproachTerrain(roads,terrain);
 const out:Bridge[]=[];
 for(const road of roads){
  if(!['bridge','elevated'].includes(road.structure??'')||!road.structure_source||road.line.length<2)continue;
  const pts:[number,number][]=[];
  for(let i=1;i<road.line.length;i++){const a=road.line[i-1],b=road.line[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);for(let d=0;d<len;d+=3)pts.push([a[0]+(b[0]-a[0])*d/len,a[1]+(b[1]-a[1])*d/len]);}
  pts.push(road.line[road.line.length-1]);if(pts.length<2)continue;
  const x=Float32Array.from(pts,p=>p[0]),y=Float32Array.from(pts,p=>p[1]),nx=new Float32Array(pts.length),ny=new Float32Array(pts.length),s=new Float32Array(pts.length),h=new Float32Array(pts.length);
  const normals=surfaceGeometry.miters(pts);
  for(let k=0;k<pts.length;k++){nx[k]=normals[k][0];ny[k]=normals[k][1];h[k]=roadHeight(road,surface,x[k],y[k]);if(k)s[k]=s[k-1]+Math.hypot(x[k]-x[k-1],y[k]-y[k-1]);}
  const half=road.width/2;
  const left_h=Float32Array.from(x,(_,k)=>roadHeight(road,surface,x[k]+nx[k]*half,y[k]+ny[k]*half));
  const right_h=Float32Array.from(x,(_,k)=>roadHeight(road,surface,x[k]-nx[k]*half,y[k]-ny[k]*half));
  out.push({x,y,nx,ny,s,h,left_h,right_h,half,outer:half,lanes:road.lanes,level:Math.min(...h),road,box:[Math.min(...x)-half,Math.min(...y)-half,Math.max(...x)+half,Math.max(...y)+half]});
 }
 // The parapets: none where an edge lies on another road's lanes at about its height.
 const ground=roads.filter(r=>!['bridge','elevated','tunnel','underpass'].includes(r.structure??''));
 const onRoad=(x:number,y:number)=>ground.some(r=>nearestRoadPoint(r.line,x,y).distance<r.width/2+1.4);
 for(const b of out){
  b.sw=sidewalkOf(b.road.width);const h=b.half+b.sw+DECK.margin;
  // (another deck's lanes, or a road at grade the deck meets at its height: the tiles' rule)
  const onOther=(x:number,y:number,z:number)=>ground.some(r=>Math.abs(terrain.at(x,y)-z)<2.5&&nearestRoadPoint(r.line,x,y).distance<r.width/2)||out.some(o=>{if(o===b||x<o.box[0]-1||x>o.box[2]+1||y<o.box[1]-1||y>o.box[3]+1)return false;
   if(nearestRoadPoint(o.road.line,x,y).distance>=o.half)return false;let k=0,best=Infinity;for(let i=0;i<o.x.length;i++){const d=(o.x[i]-x)**2+(o.y[i]-y)**2;if(d<best){best=d;k=i;}}return Math.abs(o.h[k]-z)<2.5;});
  b.openL=Uint8Array.from(b.x,(_,k)=>onOther(b.x[k]+b.nx[k]*h,b.y[k]+b.ny[k]*h,b.h[k])?1:0);
  b.openR=Uint8Array.from(b.x,(_,k)=>onOther(b.x[k]-b.nx[k]*h,b.y[k]-b.ny[k]*h,b.h[k])?1:0);
  // piers at fixed stations of the chain (the same in every tile), on the ground or the river bed,
  // never on a road under the deck
  const line=b.road.profile_line??b.road.line,piers:number[]=[],w=b.road.width;
  for(let k=1;k<b.x.length;k++){
   const sa=nearestRoadPoint(line,b.x[k-1],b.y[k-1]).along,sb=nearestRoadPoint(line,b.x[k],b.y[k]).along;
   if(Math.floor(sa/DECK.pierSpan)===Math.floor(sb/DECK.pierSpan))continue;
   const f=Math.max(0,Math.min(1,(Math.max(Math.floor(sa/DECK.pierSpan),Math.floor(sb/DECK.pierSpan))*DECK.pierSpan-sa)/((sb-sa)||1)));
   const px=b.x[k-1]+(b.x[k]-b.x[k-1])*f,py=b.y[k-1]+(b.y[k]-b.y[k-1])*f,pz=b.h[k-1]+(b.h[k]-b.h[k-1])*f,nx=b.nx[k-1]+(b.nx[k]-b.nx[k-1])*f,ny=b.ny[k-1]+(b.ny[k]-b.ny[k-1])*f;
   for(const c of w>14?[-w/4,w/4]:[0]){const cx=px+nx*c,cy=py+ny*c,gz=terrain.at(cx,cy);
    if(pz-DECK.slab-gz>2.5&&!onRoad(cx,cy))piers.push(cx,cy,gz-2,pz-DECK.slab);}
  }
  b.piers=Float32Array.from(piers);
 }
 return out;
}
/** The deck's height under (x, y), or null off every bridge. */
export function bridgeHeight(bridges: Bridge[]) {
  return (x: number, y: number, road?:RealEstateRoad): number | null => {
    let height: number | null = null,closest=Infinity;
    for (const b of bridges) {
      if(road&&(!sameRoadLevel(b.road,road)||roadProfileKey(b.road)!==roadProfileKey(road)))continue;
      if (x < b.box[0] || x > b.box[2] || y < b.box[1] || y > b.box[3]) continue;
      let best = Infinity, h = 0;
      for (let k = 1; k < b.x.length; k++) {
        const ax = b.x[k - 1], ay = b.y[k - 1], dx = b.x[k] - ax, dy = b.y[k] - ay, l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
        const d2 = (x - ax - dx * t) ** 2 + (y - ay - dy * t) ** 2;
        if (d2 < best) { best = d2; h = b.h[k - 1] + (b.h[k] - b.h[k - 1]) * t; }
      }
      // A nearby deck is not this road's deck. Without an owner, the closest
      // centreline wins; an equal-distance tie keeps the upper surface stable.
      if(best<=b.outer*b.outer&&(best<closest-1e-7||Math.abs(best-closest)<=1e-7)){
        height=Math.abs(best-closest)<=1e-7&&height!==null?Math.max(height,h):h;closest=best;
      }
    }
    return height;
  };
}

/** The road's ground: a bridge's deck where there is one, the terrain elsewhere. */
export function roadGround(terrain: Terrain, bridges: Bridge[]): Terrain {
  if (!bridges.length) return terrain;
  const deck = bridgeHeight(bridges);
  return { ...terrain, roadAt:(road,x,y)=>deck(x,y,road)??roadHeight(road,terrain,x,y) };
}


/** The bridges' structure, one design (DECK) — the tiles' too: each side's slab edge and parapet,
 * the slab's underside, the deck's top under the carriageway and sidewalks (there from the moment
 * the bridge is placed, before the asphalt), the piers. */
export function buildBridges(bridges:Bridge[]){
 const st:number[]=[],top:number[]=[];
 const quad=(a:number[],b:number[],c:number[],d:number[])=>st.push(...a,...b,...c,...a,...c,...d);
 for(const b of bridges){
  const sw=b.sw??sidewalkOf(b.road.width),hw=b.half+sw+DECK.margin;
  // (frame x east, y north, z up to world x, z up, -y)
  const pt=(i:number,off:number,z:number)=>[b.x[i]+b.nx[i]*off,((off>0?b.left_h?.[i]:b.right_h?.[i])??b.h[i])+z,-(b.y[i]+b.ny[i]*off)];
  for(let k=1;k<b.x.length;k++){
   for(const side of [-1,1]){
    if((side>0?b.openL:b.openR)?.[k-1])continue;
    const o=side*hw,i=side*(hw-.3);
    quad(pt(k-1,o,-DECK.slab),pt(k,o,-DECK.slab),pt(k,o,DECK.parapet),pt(k-1,o,DECK.parapet));
    quad(pt(k-1,o,DECK.parapet),pt(k,o,DECK.parapet),pt(k,i,DECK.parapet),pt(k-1,i,DECK.parapet));
    quad(pt(k-1,i,DECK.parapet),pt(k,i,DECK.parapet),pt(k,i,0),pt(k-1,i,0));
   }
   quad(pt(k-1,-hw,-DECK.slab),pt(k,-hw,-DECK.slab),pt(k,hw,-DECK.slab),pt(k-1,hw,-DECK.slab));
   const l0=pt(k-1,hw,-.06),l1=pt(k,hw,-.06),r0=pt(k-1,-hw,-.06),r1=pt(k,-hw,-.06);
   top.push(...l0,...r0,...r1,...l0,...r1,...l1);
  }
  const P=b.piers??new Float32Array(0),H=DECK.pierHalf;
  for(let q=0;q<P.length;q+=4){const x=P[q],y=P[q+1],z0=P[q+2],z1=P[q+3],c=[[-H,-H],[H,-H],[H,H],[-H,H]];
   for(let e=0;e<4;e++){const [ax,ay]=c[e],[bx,by]=c[(e+1)%4];quad([x+ax,z0,-(y+ay)],[x+bx,z0,-(y+by)],[x+bx,z1,-(y+by)],[x+ax,z1,-(y+ay)]);}}
 }
 const group=new THREE.Group();group.name='bridges';group.userData.heightSource='dem-bank-interpolation';
 // (the tiles' concrete, #b9b6ae)
 const mat=new THREE.MeshStandardMaterial({color:'#b9b6ae',roughness:.85,metalness:0,side:THREE.DoubleSide});
 if(st.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(st,3));g.computeVertexNormals();const m=new THREE.Mesh(g,mat);m.name='bridge structure';m.castShadow=true;m.receiveShadow=true;group.add(m);}
 const deckMat=new THREE.MeshStandardMaterial({color:'#4a4b4e',roughness:.95,side:THREE.DoubleSide});
 if(top.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(top,3));g.computeVertexNormals();const m=new THREE.Mesh(g,deckMat);m.name='bridge deck';m.receiveShadow=true;group.add(m);}
 return {group,dispose:()=>{group.traverse(o=>{if((o as THREE.Mesh).isMesh)(o as THREE.Mesh).geometry.dispose();});mat.dispose();deckMat.dispose();}};
}
