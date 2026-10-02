/// <reference lib="webworker" />
import { fieldFrom, gridAt, waterField, waterSurface, type FieldData, type HeightGrid, type WaterArrays } from "./waterCore";
import { groundCanvasSteps, runNow, waterCovered, type Lamp, type Planting } from "./complexScene";
import type { RealEstateBuildingsResponse, RealEstateRoad, RealEstateParcel } from "../api/client";
import { findBridges, type Bridge } from "./sceneBridges";
import { sidewalkRuns, carriageway, ringIndex, type Run } from "./sceneSidewalk";
import { cutPaths, type WalkPath } from './sceneWalkers';
import { makeGroundGeometry } from "./groundGeometry";
import { FLAT } from "./sceneTerrain";

/* The 3D view's scene work that needs no page, done off its thread (sceneWorkerClient.ts):
 * while a complex loads, the page only draws frames and wraps the arrays sent back.
 *
 *   { id, op: "water", rings, grid }            -> { id, result: { field, surface } | null }
 *   { id, op: "ground", data, T, size, seed }   -> { id, result: { color, rough, glow (bitmaps), planting, lamps, covered } }
 */

/** What painting the ground reads of a complex's data (sent instead of all of it). */
export type GroundData = Pick<RealEstateBuildingsResponse, "site" | "roads" | "parcels" | "streets"> & { buildings: { rings: [number, number][][] }[]; context: { rings: [number, number][][] }[] };

export type SceneOps = {
  walkPaths: {args:{paths:WalkPath[];roads:RealEstateRoad[];footprints:[number,number][][];T:number};result:WalkPath[]};
  terrainGround: {args:{T:number;G:number;segs:number;grid:HeightGrid|null};result:{position:Float32Array;normal:Float32Array;uv:Float32Array;index:Uint16Array|Uint32Array;grid:{xs:Float64Array;ys:Float64Array};sphere:{center:[number,number,number];radius:number}}};
  bridges: { args: { roads: RealEstateRoad[]; parcels: RealEstateParcel[]; covered: boolean[]; grid: HeightGrid | null }; result: Bridge[] };
  sidewalks: { args: { roads: RealEstateRoad[]; footprints: [number, number][][] }; result: Run[] };
  water: { args: { rings: [number, number][][]; grid: HeightGrid | null }; result: { field: FieldData; surface: WaterArrays | null } | null };
  ground: { args: { data: GroundData; T: number; size: number; seed: number }; result: { color: ImageBitmap; rough: ImageBitmap; glow: ImageBitmap; planting: Planting; lamps: Lamp[]; covered: boolean[] } };
};
type Msg = { [K in keyof SceneOps]: { id: number; op: K; args: SceneOps[K]["args"] } }[keyof SceneOps];

// (the whole job at once: nothing here waits on frames)
const go = async () => true;

async function water({ rings, grid }: SceneOps["water"]["args"]): Promise<[SceneOps["water"]["result"], Transferable[]]> {
  const at = grid ? gridAt(grid) : () => 0;
  const field = await waterField(rings, at, go);
  if (!field) return [null, []];
  const surface = await waterSurface(rings, fieldFrom(field, at), go);
  const transfer: Transferable[] = [field.lvl.buffer, field.wet.buffer, field.dist.buffer];
  if (surface) for (const a of Object.values(surface)) transfer.push(a.buffer);
  return [{ field, surface }, transfer];
}

async function ground({ data, T, size, seed }: SceneOps["ground"]["args"]): Promise<[SceneOps["ground"]["result"], Transferable[]]> {
  const full = data as unknown as RealEstateBuildingsResponse;
  const made = runNow(groundCanvasSteps(full, T, size, seed));
  // (upright already: a bitmap is not flipped on its way to the GPU in WebGL)
  const up = (c: HTMLCanvasElement) => createImageBitmap(c as unknown as OffscreenCanvas, { imageOrientation: "flipY" });
  const [color, rough, glow] = await Promise.all([up(made.color), up(made.rough), up(made.glow)]);
  return [{ color, rough, glow, planting: made.planting, lamps: made.lamps, covered: waterCovered(full) }, [color, rough, glow]];
}

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    let result: unknown, transfer: Transferable[] = [];
    if (m.op === 'terrainGround') {
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
