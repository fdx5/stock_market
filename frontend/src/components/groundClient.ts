import type { RealEstateBuildingsResponse } from "../api/client";
import { groundTexture, paintGroundSteps, primeWaterCovered, runSliced, type GroundPlan } from "./complexScene";
import { sceneWork } from "./sceneWorkerClient";
import {textureBudgetEnabled}from'./textureBudget';
import type {HeightGrid} from './waterCore';

/* The ground's paint (land use, the parcel's landscaping, roads, lamp light), made in the scene
 * worker: on the page it was the largest step before a complex's first frame (~180 ms of the
 * page's thread on a 4x slowed CPU, and as much again rasterising its canvases), and again when
 * the land use arrived. Painted on the page in slices where the worker can't run. */

export async function groundPlan(data: RealEstateBuildingsResponse, T: number, size: number, seed: number, pace: () => Promise<boolean>, grid?: HeightGrid): Promise<GroundPlan | null> {
  const ring0 = (b: { rings: [number, number][][] }) => ({ rings: [b.rings[0]] });
  const job = sceneWork("ground", {
    data: { site: data.site, roads: data.roads, parcels: data.parcels, streets: data.streets, buildings: data.buildings.map(ring0), context: data.context.map(ring0) },
    T, size, seed, landscape: textureBudgetEnabled(), grid:textureBudgetEnabled()?grid:undefined,
  });
  if (job) {
    let made: Awaited<typeof job> | null = null;
    try { made = await job; } catch { made = null; }
    if (made) {
      if (!await pace()) { made.color.close(); made.rough.close(); made.glow.close(); return null; }
      if (data.parcels) primeWaterCovered(data.parcels, made.covered);
      const color = groundTexture(made.color, true), rough = groundTexture(made.rough, false), glow = groundTexture(made.glow, true);
      color.addEventListener("dispose", () => made!.color.close()); rough.addEventListener("dispose", () => made!.rough.close()); glow.addEventListener("dispose", () => made!.glow.close());
      return { color, rough, glow, planting: made.planting, lamps: made.lamps };
    }
  }
  if (!await pace()) return null;
  return runSliced(paintGroundSteps(data, T, size, seed, textureBudgetEnabled(),grid), pace);
}
