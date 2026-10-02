import * as THREE from "three";
import { primeCarGeometry } from "./sceneCars";
import { kitGeometries, PROCEDURAL, type Pack } from "./vehicleShapes";
import type { ShapeArrays, HeroArrays } from "./vehicleWorker";
import { coupangTruck, cybertruck, type HeroName } from "./heroVehicles";
import { frameSlice } from "./frameSlice";
import { fetchStatic } from "../staticCdn";
import { onSceneMemoryRelease } from "./sceneMemory";

/* The traffic's vehicle shapes, made once a session in a worker (vehicleWorker.ts): the page
 * only wraps the arrays it gets back. Where workers can't run, made here in slices. */

export type Shapes = { kit: Map<string, THREE.BufferGeometry>; procedural: Map<string, THREE.BufferGeometry>; heroes: Partial<Record<HeroName, HeroArrays>> };
let shapes: Promise<Shapes> | null = null;
const running = new Map<Worker, () => void>();
onSceneMemoryRelease(() => {
  running.forEach((cancel, w) => { w.terminate(); cancel(); }); running.clear();
  const old = shapes; shapes = null;
  void old?.then(s => { s.kit.forEach(g => g.dispose()); s.procedural.forEach(g => g.dispose()); s.kit.clear(); s.procedural.clear(); for (const name of Object.keys(s.heroes) as HeroName[]) delete s.heroes[name]; }).catch(() => {});
});

const unpack = (a: ShapeArrays) => {
  const g = new THREE.BufferGeometry();
  for (const [name, [arr, size]] of Object.entries(a.attrs)) g.setAttribute(name, new THREE.BufferAttribute(arr, size));
  if (a.index) g.setIndex(new THREE.BufferAttribute(a.index, 1));
  if (a.groups) for (const group of a.groups) g.addGroup(group.start, group.count, group.materialIndex);
  g.computeBoundingSphere();
  return g;
};

async function onPage(): Promise<Shapes> {
  const [meta, bin] = await Promise.all([
    fetchStatic("/3d/vehicles.json").then(r => { if (!r.ok) throw new Error("vehicles.json " + r.status); return r.json() as Promise<Pack>; }),
    fetchStatic("/3d/vehicles.bin").then(r => { if (!r.ok) throw new Error("vehicles.bin " + r.status); return r.arrayBuffer(); }),
  ]);
  await frameSlice();
  const kit = kitGeometries(meta, bin), procedural = new Map<string, THREE.BufferGeometry>();
  for (const [name, make] of PROCEDURAL) { await frameSlice(); procedural.set(name, make()); }
  const heroes: Shapes['heroes'] = {};
  for (const [name, make] of [["coupang", coupangTruck], ["cyber", cybertruck]] as const) {
    await frameSlice();
    const {geometry, wheel, material, ...meta} = make(true);
    const pack = (g: THREE.BufferGeometry): ShapeArrays => ({attrs: Object.fromEntries(Object.entries(g.attributes).map(([n,a]) => [n, [a.array as Float32Array, a.itemSize]])),index:g.index?.array as Uint16Array | Uint32Array ?? null,groups:g.groups});
    heroes[name] = {...meta, geometry:pack(geometry), wheel:pack(wheel)}; material.dispose();
  }
  return { kit, procedural, heroes };
}

/** The shapes (once a session). Start it early: the first complex's traffic waits on it. */
export function vehicleShapes(): Promise<Shapes> {
  shapes ??= new Promise<Shapes>(resolve => {
    let worker: Worker;
    try { worker = new Worker(new URL("./vehicleWorker.ts", import.meta.url), { type: "module" }); }
    catch { void onPage().then(resolve); return; }
    running.set(worker, () => resolve({kit: new Map(), procedural: new Map(), heroes:{}}));
    worker.onmessage = (e: MessageEvent<{ kit: Record<string, ShapeArrays>; cars: Record<string, ShapeArrays>; procedural: Record<string, ShapeArrays>; heroes: Shapes['heroes']; error?: string }>) => {
      worker.terminate();
      running.delete(worker);
      const d = e.data;
      if (d.error) { console.info("[3D] vehicle shapes on the page:", d.error); void onPage().then(resolve); return; }
      // (the passenger cars into sceneCars' own store: carGeometry gives these from now on)
      for (const [name, a] of Object.entries(d.cars)) primeCarGeometry(name, unpack(a));
      resolve({
        kit: new Map(Object.entries(d.kit).map(([n, a]) => [n, unpack(a)])),
        procedural: new Map(Object.entries(d.procedural).map(([n, a]) => [n, unpack(a)])),
        heroes: d.heroes,
      });
    };
    worker.onerror = () => { worker.terminate(); running.delete(worker); void onPage().then(resolve); };
    worker.postMessage(0);
  });
  shapes.catch(() => { shapes = null; });
  return shapes;
}

export function heroGeometry(a: HeroArrays) {
  return {...a, geometry: unpack(a.geometry), wheel: unpack(a.wheel)};
}
