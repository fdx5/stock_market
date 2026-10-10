/// <reference lib="webworker" />
import './workerCpuRaster';
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { photoBuildingsNear, surveyedShape, surveyModelCacheStats, type PhotoBuilding,type SurveyFailure } from "./vworld3d";
import { fastMergeVertices } from "./fastMerge";
import { aerialColours, type AerialColours } from "./aerial";
import { matchSurveyBuildings,surveyCompleteFor,surveyAlignment,type SurveyBlock } from './surveyBuildingMatch';
import type {SurveyShapeModel} from './surveyShapeModel';
import {modelBlocksRoad} from './roadModelConflict';
import {ringIndex} from './footprintIndex';
import {applyBuildingAppearance,surveyedAppearance,type BuildingAppearance} from './buildingAppearance';
import {mergeSurveyParts} from './surveyPartMerge';
import type {NearBuildingSource} from './nearBuildingTargets';

/* Match registered footprints to measured geometry. No source photographs are
 * downloaded or applied to drone buildings. Return lit, constructed materials
 * and the coarse ranges to replace after the measured geometry is GPU-ready. */

export type SurveyJob = {
  id: number; key: string; lat0: number; lon0: number;
  /** RingResult.towers: x, y, height, ground, index start, count, style, outline, area (9 each) */
  towers: Float32Array;
  /** the outlines of the large complexes (empty for the rest), one per tower */
  outlines: [number, number][][];
  /** each block's colour (r, g, b) */
  tints: Float32Array;
  /** Registered floor height relative to the shared facade's floor grid. */
  facadeScale?: Float32Array;
  appearances?: (BuildingAppearance|undefined)[];
  /** The preceding GPU-ready batches, cloned without detaching live geometry. */
  previous?:SurveyPart[];
  roadGuard?:NearBuildingSource['roadGuard'];
  debug?:boolean;
};
export type SurveyPart = { material: number; position: Float32Array; normal: Float32Array; uv: Float32Array | null; color: Float32Array; facade?:Float32Array|null; index: Uint32Array;
  /** style, source outline, first vertex, vertex count, surface (0 wall, 1 roof, 2 end) */
  paintSpans: Uint32Array; sphere: [number, number, number, number]; box: [number, number, number, number, number, number] };
/** material: the block's style index (SURVEY_STYLES: its facade), or -1 the plain one */
export type SurveyResult = { id: number; parts: SurveyPart[]; hide: Float32Array; models: number; matched: number; ms: number; retry: boolean;
  cache?:ReturnType<typeof surveyModelCacheStats>;
  misses?:{source:number;x:number;y:number;complete:boolean;nearest:{x:number;y:number;height:number;distance:number;roadRejected:boolean;conflict?:[number,number,number];hull:[number,number][]}[]}[];
  /** the tall models found (centre x, y and top), for checking */
  tall?: number[] };
export type FacadeJob={kind:'facades';id:number;key:string;models:SurveyShapeModel[];blocks?:SurveyBlock[];extra?:number[];want?:number[];roads?:[number,number][][];buildingRings?:[number,number][][]};
export type FacadeResult={id:number;matches?:[number,number[]][];checked?:number[];rejected?:number[]};

/** A tile's buildings' colours, read off the aerial photographs (aerial.ts: the roof's median,
 * the facade's bright paint beside the outline) — read, never drawn. */
export type ColourJob = { kind: "colours"; id: number; key: string; lat0: number; lon0: number; rings: [number, number][][] };
export type ColourResult = { id: number; colours: (AerialColours | null)[]; retry: boolean };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const roadContexts=new Map<string,{roads:ReturnType<typeof ringIndex>;buildings:ReturnType<typeof ringIndex>}>();

scope.onmessage = async (e: MessageEvent<SurveyJob | ColourJob | FacadeJob>) => {
  if('kind' in e.data&&e.data.kind==='facades'){
    const j=e.data;
    const models=j.models.map(m=>{let height=-Infinity;for(let i=2;i<m.position.length;i+=3)height=Math.max(height,m.position[i]);return {cx:m.cx??0,cy:m.cy??0,hull:m.hull??[],height};});
    const matches=j.blocks?[...matchSurveyBuildings(j.blocks,models,j.models[0]?.ox??0,j.models[0]?.oy??0)]:undefined;
    const want=matches?new Set([...matches.flatMap(([,a])=>a),...j.extra??[],...j.want??[]]):null;
    const checked=j.models.map((_,i)=>i).filter(i=>!want||want.has(i)),rejected:number[]=[];
    if(j.roads&&j.buildingRings){const onRoad=ringIndex(j.roads),onBuilding=ringIndex(j.buildingRings,.75);
      for(const i of checked){const m=j.models[i];if(modelBlocksRoad(m.position,m.index,m.ox,m.oy,onRoad,onBuilding))rejected.push(i);}}
    scope.postMessage({id:j.id,matches,checked,rejected} satisfies FacadeResult);return;
  }
  if ((e.data as ColourJob).kind === "colours") {
    const j = e.data as ColourJob;
    // (level 17, ~1 m a pixel: a roof's colour reads as well, at a sixteenth of the pictures)
    try {
      const colours = await aerialColours(j.key, j.lat0, j.lon0, j.rings, undefined, 17, true);
      scope.postMessage({ id: j.id, colours, retry: false } satisfies ColourResult);
    } catch { scope.postMessage({ id: j.id, colours: [], retry: true } satisfies ColourResult); }
    return;
  }
  return survey(e as MessageEvent<SurveyJob>);
};

async function survey(e: MessageEvent<SurveyJob>) {
  const t0 = performance.now();
  const { id, key, lat0, lon0, towers, tints, outlines, facadeScale,appearances } = e.data;
  const T = 9;
  const blocks = Array.from({ length: towers.length / T }, (_, i) => ({
    x: towers[i * T], y: towers[i * T + 1], h: towers[i * T + 2], g: towers[i * T + 3], s: towers[i * T + 4], n: towers[i * T + 5], style: towers[i * T + 6],
    c: new THREE.Color(tints[i * 3], tints[i * 3 + 1], tints[i * 3 + 2]), scale: facadeScale?.[i] ?? 1, source: towers[i * T + 7], outline: outlines[i] ?? [],appearance:appearances?.[i],
  }));
  // (a large complex's whole outline is looked over, not just round its centre)
  const probes: { x: number; y: number }[] = [...blocks];
  let photos: PhotoBuilding[] = [];
  const failures:SurveyFailure[]=[];
  try { photos = await photoBuildingsNear(key, lat0, lon0, probes, { onFailure: f=>failures.push(f), deadlineMs: 8000,outlines }); } catch { failures.push({kind:'unknown'}); }
  photos.forEach(ph=>ph.geometry.computeBoundingBox());
  const [ox,oy]=surveyAlignment(blocks,photos.map(ph=>({...ph,height:ph.geometry.boundingBox!.max.z})));
  const diagnostics=e.data.debug?photos.map(ph=>({key:ph.key,x:ph.cx+ox,y:ph.cy+oy,height:ph.geometry.boundingBox!.max.z,hull:ph.hull.map(([x,y])=>[x+ox,y+oy] as [number,number])})):[];
  const roadRejected=new Set<string>();
  const roadConflicts=new Map<string,[number,number,number]>();
  const complete=surveyCompleteFor(blocks,failures);
  // Only models that can replace one of this batch's registered buildings need
  // the expensive annex/road check. Neighbour models are never displayed.
  const preliminary=matchSurveyBuildings(blocks,photos.map(ph=>({...ph,height:ph.geometry.boundingBox!.max.z})),ox,oy,complete);
  const wanted=new Set([...preliminary.values()].flat());
  const guard=e.data.roadGuard;
  if(guard){let context=roadContexts.get(guard.key);
    if(!context){context={roads:ringIndex(guard.roads),buildings:ringIndex(guard.buildings,.75)};roadContexts.set(guard.key,context);if(roadContexts.size>2)roadContexts.delete(roadContexts.keys().next().value!);}
    photos=photos.filter((ph,i)=>{if(!wanted.has(i))return true;const rejected=modelBlocksRoad(ph.geometry.attributes.position.array as Float32Array,new Uint32Array(ph.geometry.index!.array),ox,oy,context!.roads,context!.buildings,e.data.debug?p=>roadConflicts.set(ph.key,p):undefined);if(rejected){roadRejected.add(ph.key);ph.geometry.dispose();}return !rejected;});
  }
  type Piece = { g: THREE.BufferGeometry; style: number; source: number; surface: number };
  const byMat = new Map<number, Piece[]>();
  const put = (m: number, g: THREE.BufferGeometry | null, c: THREE.Color, bl: (typeof blocks)[number], surface = 0) => {
    if (!g) return;
    const n = g.getAttribute("position").count, col = new Float32Array(n * 3);
    for (let j = 0; j < n; j++) { col[j * 3] = c.r; col[j * 3 + 1] = c.g; col[j * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    if(bl.appearance){applyBuildingAppearance(g,bl.appearance,bl.g-.25,surface!==0);m=bl.style;}
    const uv = g.getAttribute('uv');
    if (!bl.appearance&&m >= 0 && surface === 0 && uv && bl.scale !== 1) for (let j = 0; j < uv.count; j++) uv.setY(j,uv.getY(j)*bl.scale);
    // (one attribute set per material: merged geometries must agree)
    for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color","facade"].includes(name)) g.deleteAttribute(name);
    if(!g.getAttribute('facade'))g.setAttribute('facade',new THREE.BufferAttribute(new Float32Array(n*4),4));
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const shared = fastMergeVertices(g);
    if (shared !== g) g.dispose();
    let list = byMat.get(m); if (!list) byMat.set(m, list = []);
    list.push({ g: shared, style: bl.style, source: bl.source, surface });
  };
  const hide: number[] = [];
  let matched = 0;
  const groups = matchSurveyBuildings(blocks, photos.map(ph => ({ ...ph, height: ph.geometry.boundingBox!.max.z })), ox, oy, complete);
  const misses=e.data.debug?blocks.flatMap((bl,i)=>groups.has(i)?[]:[{source:bl.source,x:bl.x,y:bl.y,complete:complete[i],nearest:diagnostics.map(ph=>({x:ph.x,y:ph.y,height:ph.height,hull:ph.hull,distance:Math.hypot(bl.x-ph.x,bl.y-ph.y),roadRejected:roadRejected.has(ph.key),conflict:roadConflicts.get(ph.key)})).sort((a,b)=>a.distance-b.distance).slice(0,3)}]):undefined;
  for (const [bi, models] of groups) {
    const bl = blocks[bi];
    for (const mi of models) {
      const ph = photos[mi], top = ph.geometry.boundingBox!.max.z;
      const shape = surveyedShape(ph, bl.g - 0.25, undefined, 1.0, undefined, top < 150||bl.appearance?.style==='apt');
      if(bl.appearance){const body=shape.roofZ===null?top:shape.roofZ-shape.z0;bl.appearance=surveyedAppearance(bl.appearance,body);}
      for (const gg of [shape.walls, shape.roofs, shape.cores, shape.ends, shape.bands, shape.painted]) gg?.translate(ox, oy, 0);
      put(bl.style, shape.walls, bl.c, bl); put(-1, shape.roofs, bl.c, bl, 1);
      put(-1, shape.cores, bl.c, bl,2); put(-1, shape.bands, bl.c, bl,2); put(-1, shape.ends, bl.c.clone().multiplyScalar(0.86), bl, 2);
      shape.painted?.dispose();
    }
    matched++;
    hide.push(bl.style, bl.s, bl.n);
  }
  const parts: SurveyPart[] = [];
  for (const [material, list] of byMat) {
    // (with and without uv apart: a part made without one keeps the plain material's look)
    const withUv = list.filter(p => p.g.getAttribute("uv")), without = list.filter(p => !p.g.getAttribute("uv"));
    for (const group of [withUv, without]) {
      if (!group.length) continue;
      const merged = mergeGeometries(group.map(p => p.g), false);
      if (!merged) continue;
      const a = (n: string) => (merged.getAttribute(n)?.array as Float32Array | undefined) ?? null;
      const index = merged.index ? new Uint32Array(merged.index.array) : new Uint32Array(Array.from({ length: merged.getAttribute("position").count }, (_, i) => i));
      const spans: number[] = []; let first = 0;
      for (const p of group) { const n = p.g.getAttribute('position').count; if(p.surface!==3)spans.push(p.style, p.source, first, n, p.surface); first += n; p.g.dispose(); }
      merged.computeBoundingBox(); merged.computeBoundingSphere();
      const s = merged.boundingSphere!;
      const b = merged.boundingBox!;
      const part: SurveyPart = { material, position: a("position")!, normal: a("normal")!, uv: a("uv"), color: a("color")!,facade:a('facade'), index, paintSpans: new Uint32Array(spans), sphere: [s.center.x,s.center.y,s.center.z,s.radius], box: [b.min.x,b.min.y,b.min.z,b.max.x,b.max.y,b.max.z] };
      parts.push(part);
      merged.dispose();
    }
  }
  const hideArr = new Float32Array(hide);
  const tall: number[] = [];
  for (const ph of photos) { ph.geometry.computeBoundingBox(); const top = ph.geometry.boundingBox!.max.z; if (top > 60) tall.push(Math.round(ph.cx + ox), Math.round(ph.cy + oy), Math.round(top)); }
  photos.forEach(ph => ph.geometry.dispose());
  const merged=parts.length&&e.data.previous?.length?mergeSurveyParts([...e.data.previous,...parts]):parts;
  const buffers:Transferable[]=[hideArr.buffer];
  for(const p of merged)for(const a of [p.position,p.normal,p.uv,p.color,p.facade,p.index,p.paintSpans])if(a)buffers.push(a.buffer as ArrayBuffer);
  const out: SurveyResult = { id, parts:merged, hide: hideArr, models: photos.length, matched, ms: performance.now() - t0, retry: failures.length > 0, tall,misses,cache:e.data.debug?surveyModelCacheStats():undefined };
  scope.postMessage(out, [...new Set(buffers)]);
}
