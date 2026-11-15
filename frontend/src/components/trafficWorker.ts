/// <reference lib="webworker" />
import * as THREE from "three";
import { DroneTraffic, type TrafficFrame } from "./droneTraffic";

/* The drone's traffic off the page (droneTrafficClient.ts): the whole simulation — lanes, signals,
 * crossings, every car's driving and its instance placed for the camera — runs here; the page only
 * copies the placed instances into its meshes. */

type In =
  | { type: "init"; seed: number; lite: boolean }
  | { type: "near"; kinds: boolean[]; roofs: [number, number][] }
  | { type: "add"; tile: string; packed: Float32Array; stops?: Float32Array; banks?: Float32Array }
  | { type: "remove"; tile: string }
  | { type: "take"; id: number }
  | { type: "step"; dt: number; cam: [number, number, number]; look: [number, number, number] | null }
  | { type: "dispose" };

let sim: DroneTraffic | null = null;
const cam = new THREE.Vector3(), look = new THREE.Vector3();
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (e: MessageEvent<In>) => {
  const m = e.data;
  if (m.type === "init") { sim = new DroneTraffic(m.seed, m.lite, true); return; }
  if (!sim) return;
  switch (m.type) {
    case "near": sim.setNear(m.kinds, m.roofs); break;
    case "add": sim.addTile(m.tile, m.packed, m.stops, m.banks); break;
    case "remove": sim.removeTile(m.tile); break;
    case "take": sim.takeCar(m.id); break;
    case "step": {
      const t0 = performance.now();
      cam.set(m.cam[0], m.cam[1], m.cam[2]);
      if (m.look) look.set(m.look[0], m.look[1], m.look[2]);
      sim.update(m.dt, cam, m.look ? look : undefined);
      const f: TrafficFrame = sim.frame();
      f.ms = performance.now() - t0;
      const moved: Transferable[] = [f.far.m.buffer, f.far.c.buffer, f.bodies.buffer, ...f.beacons.map(b => b.buffer)];
      for (const p of f.near) moved.push(p.m.buffer, p.c.buffer);
      scope.postMessage(f, moved);
      break;
    }
    case "dispose": sim.dispose(); sim = null; scope.close(); break;
  }
};
