/// <reference lib="webworker" />
import { fieldFrom, gridAt, waterField, waterSurface, type FieldData, type HeightGrid, type WaterArrays } from "./waterCore";
import { groundCanvasSteps, runNow, waterCovered, type Lamp, type Planting } from "./complexScene";
import type { RealEstateBuildingsResponse } from "../api/client";

/* The 3D view's scene work that needs no page, done off its thread (sceneWorkerClient.ts):
 * while a complex loads, the page only draws frames and wraps the arrays sent back.
 *
 *   { id, op: "water", rings, grid }            -> { id, result: { field, surface } | null }
 *   { id, op: "ground", data, T, size, seed }   -> { id, result: { color, rough, glow (bitmaps), planting, lamps, covered } }
 */

/** What painting the ground reads of a complex's data (sent instead of all of it). */
export type GroundData = Pick<RealEstateBuildingsResponse, "site" | "roads" | "parcels" | "streets"> & { buildings: { rings: [number, number][][] }[]; context: { rings: [number, number][][] }[] };

export type SceneOps = {
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
    const [result, transfer] = m.op === "water" ? await water(m.args) : m.op === "ground" ? await ground(m.args) : [null, []];
    (self as unknown as Worker).postMessage({ id: m.id, result }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: m.id, error: String(err) });
  }
};
