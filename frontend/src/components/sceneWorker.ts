/// <reference lib="webworker" />
import "./workerCpuRaster";
import { fieldFrom, gridAt, waterField, waterSurface, type FieldData, type HeightGrid, type WaterArrays } from "./waterCore";
import { groundCanvasSteps, runNow, seasonNow, waterCovered, type Lamp, type Planting } from "./complexScene";
import type { RealEstateBuildingsResponse, RealEstateRoad, RealEstateParcel } from "../api/client";
import { findBridges, type Bridge } from "./sceneBridges";
import { sidewalkRuns, carriageway, ringIndex, type Run } from "./sceneSidewalk";
import { cutPaths, type WalkPath } from './sceneWalkers';
import { makeGroundGeometry } from "./groundGeometry";
import { FLAT } from "./sceneTerrain";
import { neighbourArrays, type NeighbourJob, type NeighbourArrays } from "./neighbourGeometry";
import {neighbourWasmArrays,neighbourWasmStats} from './neighbourWasm';
import {constrainRoadCorridors}from'./roadCorridors';
import {excludeSurface}from'./surfaceExclusion';
import * as THREE from 'three';
import { readPaint, writePaint } from "./paintStore";

/* The 3D view's scene work that needs no page, done off its thread (sceneWorkerClient.ts):
 * while a complex loads, the page only draws frames and wraps the arrays sent back.
 *
 *   { id, op: "water", rings, grid }            -> { id, result: { field, surface } | null }
 *   { id, op: "ground", data, T, size, seed }   -> { id, result: { color, rough, glow (bitmaps), planting, lamps, covered } }
 */

/** What painting the ground reads of a complex's data (sent instead of all of it). */
export type GroundData = Pick<RealEstateBuildingsResponse, "site" | "roads" | "parcels" | "streets"> & { buildings: { rings: [number, number][][] }[]; context: { rings: [number, number][][] }[] };

export type SceneOps = {
  surfaceCut:{args:{attributes:{name:string;size:number;array:Float32Array}[];index:Uint16Array|Uint32Array|null;rings:[number,number][][]|null;ringsId?:number};result:{attributes:{name:string;size:number;array:Float32Array}[];index:Uint16Array|Uint32Array|null}};
  roads: {args:{roads:RealEstateRoad[];footprints:[number,number][][]};result:RealEstateRoad[]};
  neighbours: { args: { jobs: NeighbourJob[];hybrid?:boolean }; result: {arrays:NeighbourArrays[];mode:string;computeMs:number;memoryBytes:number;inputBytes:number} };
  walkPaths: {args:{paths:WalkPath[];roads:RealEstateRoad[];footprints:[number,number][][];T:number};result:WalkPath[]};
  terrainGround: {args:{T:number;G:number;segs:number;grid:HeightGrid|null};result:{position:Float32Array;normal:Float32Array;uv:Float32Array;index:Uint16Array|Uint32Array;grid:{xs:Float64Array;ys:Float64Array};sphere:{center:[number,number,number];radius:number}}};
  bridges: { args: { roads: RealEstateRoad[]; parcels: RealEstateParcel[]; covered: boolean[]; grid: HeightGrid | null }; result: Bridge[] };
  sidewalks: { args: { roads: RealEstateRoad[]; footprints: [number, number][][] }; result: Run[] };
  water: { args: { rings: [number, number][][]; holes?:[number,number][][]; grid: HeightGrid | null }; result: { field: FieldData; surface: WaterArrays | null } | null };
  ground: { args: { data: GroundData; T: number; size: number; seed: number; landscape?: boolean; grid?: HeightGrid }; result: { color: ImageBitmap; rough: ImageBitmap; glow: ImageBitmap; planting: Planting; lamps: Lamp[]; covered: boolean[] } };
};
type Msg = { [K in keyof SceneOps]: { id: number; op: K; args: SceneOps[K]["args"] } }[keyof SceneOps];

// (the whole job at once: nothing here waits on frames)
const go = async () => true;

async function water({ rings, holes=[], grid }: SceneOps["water"]["args"]): Promise<[SceneOps["water"]["result"], Transferable[]]> {
  const at = grid ? gridAt(grid) : () => 0;
  const field = await waterField(rings, at, go, holes);
  if (!field) return [null, []];
  const surface = await waterSurface(rings, fieldFrom(field, at), go, holes);
  const transfer: Transferable[] = [field.lvl.buffer, field.wet.buffer, field.dist.buffer];
  if (surface) for (const a of Object.values(surface)) transfer.push(a.buffer);
  return [{ field, surface }, transfer];
}

/* The painted ground, kept (paintStore) for the next visit: painting it is the longest piece of
 * a complex's first frame (0.6-1.2 s here), and the same complex, data and season paint the same
 * pixels. Keyed by this worker's own script (its build) and everything the paint reads; written
 * a while after the paint, so its encoding never runs while a complex loads. */
const PAINTED_AT = typeof location !== "undefined" ? location.href : "";
const RAW: ImageBitmapOptions = { colorSpaceConversion: "none", premultiplyAlpha: "none" };
function fingerprint(v: unknown): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const mix = (n: number) => { h1 = Math.imul(h1 ^ n, 16777619); h2 = Math.imul(h2 ^ (n + 0x9e3779b9), 2246822519); };
  const f = new Float64Array(1), u = new Uint32Array(f.buffer);
  const walk = (x: unknown): void => {
    if (x === null || x === undefined) mix(x === null ? 1 : 2);
    else if (typeof x === "number") { f[0] = x; mix(u[0]); mix(u[1]); }
    else if (typeof x === "string") { mix(x.length); for (let i = 0; i < x.length; i++) mix(x.charCodeAt(i)); }
    else if (typeof x === "boolean") mix(x ? 3 : 4);
    else if (ArrayBuffer.isView(x)) {
      const b = new Uint8Array(x.buffer, x.byteOffset, x.byteLength); mix(b.length);
      if (b.byteOffset % 4 === 0 && b.length % 4 === 0) { const w = new Uint32Array(b.buffer, b.byteOffset, b.length / 4); for (let i = 0; i < w.length; i++) mix(w[i]); }
      else for (let i = 0; i < b.length; i++) mix(b[i]);
    } else if (Array.isArray(x)) { mix(x.length); for (const e of x) walk(e); }
    else if (typeof x === "object") for (const k of Object.keys(x as object).sort()) { walk(k); walk((x as Record<string, unknown>)[k]); }
  };
  walk(v);
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}
type GroundResult = SceneOps["ground"]["result"];
const GROUND_MAPS = ["color", "rough", "glow"] as const;

async function ground(args: SceneOps["ground"]["args"]): Promise<[GroundResult, Transferable[]]> {
  const { data, T, size, seed, landscape, grid } = args;
  const key = `ground:${PAINTED_AT}:${seasonNow()}:${fingerprint(args)}`;
  try {
    const hit = await readPaint(key);
    if (hit) {
      const maps = await Promise.all(GROUND_MAPS.map(n => createImageBitmap(hit.blobs[n], { ...RAW, imageOrientation: "flipY" })));
      const [color, rough, glow] = maps, rest = hit.params as Pick<GroundResult, "planting" | "lamps" | "covered">;
      return [{ color, rough, glow, ...rest }, maps];
    }
  } catch { /* painted below */ }
  const full = data as unknown as RealEstateBuildingsResponse;
  const made = runNow(groundCanvasSteps(full, T, size, seed, landscape, grid));
  // (upright already: a bitmap is not flipped on its way to the GPU in WebGL)
  const up = (c: HTMLCanvasElement) => createImageBitmap(c as unknown as OffscreenCanvas, { imageOrientation: "flipY" });
  const [color, rough, glow] = await Promise.all([up(made.color), up(made.rough), up(made.glow)]);
  const result = { color, rough, glow, planting: made.planting, lamps: made.lamps, covered: waterCovered(full) };
  const kept = { color: made.color, rough: made.rough, glow: made.glow } as unknown as Record<string, OffscreenCanvas>;
  const rest = { planting: result.planting, lamps: result.lamps, covered: result.covered };
  setTimeout(() => {
    const bitmaps = Object.fromEntries(GROUND_MAPS.map(n => [n, kept[n].transferToImageBitmap()]));
    void writePaint(key, structuredClone(rest), bitmaps);
  }, 6000);
  return [result, [color, rough, glow]];
}

/** The surface cut's rings, sent once per complex (sceneWorkerClient). */
const sharedRings = new Map<number, [number, number][][]>();

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    let result: unknown, transfer: Transferable[] = [];
    if(m.op==='surfaceCut'){
      const {ringsId}=m.args;let rings=m.args.rings;
      if(ringsId!==undefined){if(rings){sharedRings.set(ringsId,rings);if(sharedRings.size>4)sharedRings.delete(sharedRings.keys().next().value!);}else rings=sharedRings.get(ringsId)??null;}
      if(!rings)throw Error('surface rings unknown');
      const g=new THREE.BufferGeometry();for(const a of m.args.attributes)g.setAttribute(a.name,new THREE.BufferAttribute(a.array,a.size));if(m.args.index)g.setIndex(new THREE.BufferAttribute(m.args.index,1));
      await excludeSurface(g,rings,go);
      const attributes=Object.entries(g.attributes).map(([name,a])=>({name,size:a.itemSize,array:a.array})),index=g.index?.array??null;
      result={attributes,index};transfer=attributes.map(a=>a.array.buffer);if(index)transfer.push(index.buffer);
    }
    else if(m.op==='roads')result=constrainRoadCorridors(m.args.roads,m.args.footprints);
    else if (m.op === 'neighbours') {
      const start=performance.now();let mode='javascript';
      const arrays = m.args.hybrid ? await neighbourWasmArrays(m.args.jobs).then(a=>{mode='rust-wasm';return a;}).catch(()=>m.args.jobs.map(neighbourArrays)) : m.args.jobs.map(neighbourArrays);
      result = {arrays,mode,computeMs:performance.now()-start,memoryBytes:mode==='rust-wasm'?neighbourWasmStats.memoryBytes:0,inputBytes:mode==='rust-wasm'?neighbourWasmStats.inputBytes:0};
      transfer = arrays.flatMap(a => Object.values(a).map(v => v.buffer)) as ArrayBuffer[];
    } else if (m.op === 'terrainGround') {
      const geo=await makeGroundGeometry(m.args.T,m.args.G,m.args.grid ? {...FLAT,at:gridAt(m.args.grid)} : FLAT,m.args.segs,go);
      if (!geo) throw Error('ground layout cancelled');
      const sphere=geo.boundingSphere!;
      result={position:geo.attributes.position.array,normal:geo.attributes.normal.array,uv:geo.attributes.uv.array,index:geo.index!.array,grid:geo.userData.grid,sphere:{center:sphere.center.toArray(),radius:sphere.radius}};
      transfer=[geo.attributes.position.array.buffer,geo.attributes.normal.array.buffer,geo.attributes.uv.array.buffer,geo.index!.array.buffer,geo.userData.grid.xs.buffer,geo.userData.grid.ys.buffer] as ArrayBuffer[];
      geo.dispose();
    } else if (m.op === 'walkPaths') {
      const {paths,roads,footprints,T} = m.args;
      const inside = ringIndex(footprints), onRoad = carriageway(roads,0.8);
      const cut = cutPaths(paths,(x,y) => Math.abs(x)>T || Math.abs(y)>T || inside(x,y) || onRoad(x,y));
      result = cut;
      transfer = [...new Set(cut.flatMap(p => [p.xs.buffer,p.ys.buffer,p.cum.buffer]))] as ArrayBuffer[];
    } else if (m.op === "water") [result, transfer] = await water(m.args);
    else if (m.op === "ground") [result, transfer] = await ground(m.args);
    else if (m.op === "bridges") {
      result = findBridges(m.args.roads, m.args.parcels, m.args.covered,
        m.args.grid ? { ...FLAT, at: gridAt(m.args.grid) } : FLAT);
    } else if (m.op === "sidewalks") result = sidewalkRuns(m.args.roads, m.args.footprints);
    if (m.op === "bridges" || m.op === "sidewalks") {
      for (const item of result as Record<string, unknown>[]) for (const value of Object.values(item)) {
        if (ArrayBuffer.isView(value)) transfer.push(value.buffer as ArrayBuffer);
      }
    }
    (self as unknown as Worker).postMessage({ id: m.id, result }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: m.id, error: String(err) });
  }
};
