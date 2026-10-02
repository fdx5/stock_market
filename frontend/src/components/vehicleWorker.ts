/// <reference lib="webworker" />
import type * as THREE from "three";
import { CAR_SPECS, carGeometry } from "./sceneCars";
import { kitGeometries, PROCEDURAL, type Pack } from "./vehicleShapes";
import { fetchStatic } from "../staticCdn";
import { coupangTruck, cybertruck, type HeroName, type HeroShape } from "./heroVehicles";

/* Every vehicle shape of the traffic, made off the page once a session (see vehicleClient):
 * the Kenney kit decoded with its creased normals, the passenger cars from their proportions,
 * the boxed trucks and buses. Sent back as plain arrays. */

export type ShapeArrays = { attrs: Record<string, [Float32Array, number]>; index: Uint16Array | Uint32Array | null; groups?: THREE.BufferGeometry['groups'] };
export type HeroArrays = Omit<HeroShape, 'geometry' | 'wheel' | 'material'> & {geometry: ShapeArrays; wheel: ShapeArrays};
const pack = (g: THREE.BufferGeometry, transfer: ArrayBuffer[]): ShapeArrays => {
  const attrs: ShapeArrays["attrs"] = {};
  for (const [name, a] of Object.entries(g.attributes) as [string, THREE.BufferAttribute][]) {
    const arr = Float32Array.from(a.array as ArrayLike<number>);
    attrs[name] = [arr, a.itemSize]; transfer.push(arr.buffer);
  }
  const index = g.index ? (g.index.array as Uint16Array | Uint32Array).slice() : null;
  if (index) transfer.push(index.buffer as ArrayBuffer);
  return { attrs, index, groups: g.groups.map(group => ({...group})) };
};

self.onmessage = async () => {
  const transfer: ArrayBuffer[] = [];
  const out: { kit: Record<string, ShapeArrays>; cars: Record<string, ShapeArrays>; procedural: Record<string, ShapeArrays>; heroes: Partial<Record<HeroName, HeroArrays>>; error?: string } = { kit: {}, cars: {}, procedural: {}, heroes: {} };
  try {
    const [meta, bin] = await Promise.all([
      fetchStatic("/3d/vehicles.json").then(r => { if (!r.ok) throw new Error("vehicles.json " + r.status); return r.json() as Promise<Pack>; }),
      fetchStatic("/3d/vehicles.bin").then(r => { if (!r.ok) throw new Error("vehicles.bin " + r.status); return r.arrayBuffer(); }),
    ]);
    for (const [name, g] of kitGeometries(meta, bin)) out.kit[name] = pack(g, transfer);
    for (const name of Object.keys(CAR_SPECS)) { const g = carGeometry(name); if (g) out.cars[name] = pack(g, transfer); }
    for (const [name, make] of PROCEDURAL) out.procedural[name] = pack(make(), transfer);
    for (const [name, make] of [["coupang", coupangTruck], ["cyber", cybertruck]] as const) {
      const {geometry, wheel, material, ...meta} = make(true);
      out.heroes[name] = {...meta, geometry: pack(geometry, transfer), wheel: pack(wheel, transfer)};
      geometry.dispose(); wheel.dispose(); material.dispose();
    }
  } catch (err) { out.error = String(err); }
  (self as unknown as Worker).postMessage(out, transfer);
};
