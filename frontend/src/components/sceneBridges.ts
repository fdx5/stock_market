import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RealEstateParcel, RealEstateRoad } from "../api/client";
import {roadHeight,sameRoadLevel,roadProfileKey} from "./roadLevels";
import {roadApproachTerrain} from "./roadApproaches";

import type { Terrain } from "./sceneTerrain";

/* Structures are admitted only by official road-link attributes. Water adjacency
 * never creates a bridge. Deck height is a DEM-derived profile; no surveyed Z is
 * available in this feed, so invented clearance/ramps/piers are deliberately absent. */
export interface Bridge {
 x:Float32Array;y:Float32Array;nx:Float32Array;ny:Float32Array;s:Float32Array;h:Float32Array;
 left_h?:Float32Array;right_h?:Float32Array;
 half:number;outer:number;lanes:number;level:number;box:[number,number,number,number];road:RealEstateRoad;
}
export function findBridges(roads:RealEstateRoad[],_parcels:RealEstateParcel[],_covered:boolean[],terrain:Terrain):Bridge[]{
 const surface=roadApproachTerrain(roads,terrain);
 const out:Bridge[]=[];
 for(const road of roads){
  if(!['bridge','elevated'].includes(road.structure??'')||!road.structure_source||road.line.length<2)continue;
  const pts:[number,number][]=[];
  for(let i=1;i<road.line.length;i++){const a=road.line[i-1],b=road.line[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);for(let d=0;d<len;d+=3)pts.push([a[0]+(b[0]-a[0])*d/len,a[1]+(b[1]-a[1])*d/len]);}
  pts.push(road.line[road.line.length-1]);if(pts.length<2)continue;
  const x=Float32Array.from(pts,p=>p[0]),y=Float32Array.from(pts,p=>p[1]),nx=new Float32Array(pts.length),ny=new Float32Array(pts.length),s=new Float32Array(pts.length),h=new Float32Array(pts.length);
  for(let k=0;k<pts.length;k++){const a=pts[Math.max(0,k-1)],b=pts[Math.min(pts.length-1,k+1)],l=Math.hypot(b[0]-a[0],b[1]-a[1])||1;nx[k]=-(b[1]-a[1])/l;ny[k]=(b[0]-a[0])/l;h[k]=roadHeight(road,surface,x[k],y[k]);if(k)s[k]=s[k-1]+Math.hypot(x[k]-x[k-1],y[k]-y[k-1]);}
  const half=road.width/2;
  const left_h=Float32Array.from(x,(_,k)=>roadHeight(road,surface,x[k]+nx[k]*half,y[k]+ny[k]*half));
  const right_h=Float32Array.from(x,(_,k)=>roadHeight(road,surface,x[k]-nx[k]*half,y[k]-ny[k]*half));
  out.push({x,y,nx,ny,s,h,left_h,right_h,half,outer:half,lanes:road.lanes,level:Math.min(...h),road,box:[Math.min(...x)-half,Math.min(...y)-half,Math.max(...x)+half,Math.max(...y)+half]});
 }return out;
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


/** A thin schematic slab only; detailed piers/parapets need measured structure geometry. */
export function buildBridges(bridges:Bridge[]){
 const geometries:THREE.BufferGeometry[]=[];
 for(const b of bridges){const p:number[]=[];
  const pt=(i:number,off:number,z:number)=>[b.x[i]+b.nx[i]*off,((off>0?b.left_h?.[i]:b.right_h?.[i])??b.h[i])+z,-(b.y[i]+b.ny[i]*off)];
  for(let k=1;k<b.x.length;k++)for(const side of [-1,1]){
   const a=pt(k-1,side*b.half,0),c=pt(k,side*b.half,0),d=pt(k,side*b.half,-.25),e=pt(k-1,side*b.half,-.25);
   p.push(...a,...c,...d,...a,...d,...e);
  }
  if(p.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.computeVertexNormals();geometries.push(g);}
 }
 const group=new THREE.Group();group.name='bridges';group.userData.heightSource='dem-bank-interpolation';
 const mat=new THREE.MeshStandardMaterial({color:'#777777',roughness:.9,side:THREE.DoubleSide});
 if(geometries.length){const g=mergeGeometries(geometries)!;group.add(new THREE.Mesh(g,mat));geometries.forEach(g=>g.dispose());}
 return {group,dispose:()=>{group.traverse(o=>{if((o as THREE.Mesh).isMesh)(o as THREE.Mesh).geometry.dispose();});mat.dispose();}};
}
