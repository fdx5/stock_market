import * as THREE from 'three';
import type {RealEstateRoad} from '../api/client';
import type {Terrain} from './sceneTerrain';
import {gridAt,fieldFrom,type FieldData} from './waterCore';
import {roadApproachTerrain} from './roadApproaches';
import {clipRoadLine,roadProfileKey,nearestRoadPoint,roadLevel} from './roadLevels';
import {buildRoadMarkings} from './sceneStreet';
import {drapeRoadSurface} from './roadDrape';
import {excludeSurface} from './surfaceExclusion';
import {seaOutsideBox} from './coastGeometry';

export type InitialRoadJob={roads:RealEstateRoad[];terrain?:Terrain['grid'];water?:FieldData;
  ground:Float32Array;xs:Float64Array;ys:Float64Array;footprints:[number,number][][];half:number};
export type RoadArrays={attributes:{name:string;size:number;array:Float32Array}[];profiles:Map<string,number>;color?:number};
export type InitialRoadResult={paint:RoadArrays[];ms:number;timings:Record<string,number>};
const pace=async()=>true;
const pack=(g:THREE.BufferGeometry):RoadArrays=>({attributes:Object.entries(g.attributes).map(([name,a])=>({name,size:a.itemSize,array:a.array as Float32Array})),profiles:g.userData.roadProfiles});
function clip(g:THREE.BufferGeometry,half:number){
  g.setIndex(Array.from({length:g.getAttribute('position').count},(_,i)=>i));
  const bounded=seaOutsideBox(g,[-half,-half,half,half],new THREE.Matrix4(),true,true);
  const flat=bounded.index?bounded.toNonIndexed():bounded;
  for(const [name,a]of Object.entries(flat.attributes))g.setAttribute(name,a);
  g.setIndex(null);g.computeBoundingSphere();
  if(flat!==bounded)flat.dispose();bounded.dispose();
}
/** True-width surveyed lines on the road already painted in the departure
 * ground. Detailed asphalt/junctions join later; first lines do not wait for
 * a second copy of that asphalt, traffic, network crossings, or page frames. */
export async function initialRoadGeometry(job:InitialRoadJob):Promise<InitialRoadResult>{
  const started=performance.now(),at=job.terrain?gridAt(job.terrain):()=>0;
  const timings:Record<string,number>={};let stamp=started;const mark=(name:string)=>{const now=performance.now();timings[name]=now-stamp;stamp=now;};
  const water=job.water?fieldFrom(job.water,at):null;
  // Work only on the displayed square plus the exact grading/junction context.
  // Preserve full structure profiles and the original dash phase at the cut.
  const offsets=new Map<RealEstateRoad,number>(),roads:RealEstateRoad[]=[];
  for(const r of job.roads.filter(r=>roadLevel(r)>=0&&r.structure!=='tunnel'&&r.structure!=='underpass'))for(const line of clipRoadLine(r.line,job.half+128+r.width/2)){
    const piece={...r,id:roadProfileKey(r),profile_line:r.profile_line??r.line,line};
    offsets.set(piece,nearestRoadPoint(r.line,line[0][0],line[0][1]).along);roads.push(piece);
  }
  const base:Terrain={at,base:r=>Math.min(...r.map(p=>at(...p))),source:'initial-road-grid',elevation:null,relief:0,grid:job.terrain,
    waterAt:water?(x,y)=>water.wet(x,y)?water.level(x,y):null:undefined};
  const terrain=roadApproachTerrain(roads,base);
  const ground=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(job.ground,3));
  ground.userData.grid={xs:job.xs,ys:job.ys};
  const paint=await buildRoadMarkings(roads,terrain,undefined,undefined,undefined,true,offsets);
  mark('lines');
  try{
    for(const m of paint.group.children as THREE.Mesh[]){
      clip(m.geometry,job.half);
      await excludeSurface(m.geometry,job.footprints,pace);
      mark('paintCut'+paint.group.children.indexOf(m));
      await drapeRoadSurface(m.geometry,ground,pace,.05);
      mark('paintDrape'+paint.group.children.indexOf(m));
      clip(m.geometry,job.half);
    }
    return {paint:paint.group.children.map(m=>({...pack((m as THREE.Mesh).geometry),color:((m as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex()})),ms:performance.now()-started,timings};
  }finally{paint.dispose();ground.dispose();}
}
