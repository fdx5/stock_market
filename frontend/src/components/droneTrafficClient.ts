import * as THREE from "three";
import { DroneTraffic, TRAFFIC_KINDS, TRAFFIC_EMERGENCY_FROM, type TrafficFrame } from "./droneTraffic";

/* The drone's traffic with its simulation in a worker (trafficWorker.ts). On a phone the cars'
 * driving and placing was a tenth of a long flight's main thread, growing with the city's roads;
 * here the page keeps only the meshes (a DroneTraffic that is never given lanes: its kit, its
 * materials, its instanced meshes) and copies each step's placed instances into them.
 *
 * A step is asked for each frame and answered within it or the next; while one is out, the frames'
 * time is added up and sent with the next ask (a busy worker never queues steps). The cars round
 * the camera come with each step: what the walker, the bike and the driven car run into, and the
 * car a walker gets into, are read from them on the page at once.
 *
 * Off by default for now (?trafficworker=1 turns it on): checked at a busy junction, its cars stood
 * closer together than on the page (pairs under 1 m: 24 against 2) — to be found before it is the
 * default. */

export type TrafficApi = Pick<DroneTraffic, "group" | "addTile" | "removeTile" | "update" | "bodiesNear" | "nearestCar" | "takeCar" | "model" | "modelOf" | "place" | "materials" | "dispose">;

export function trafficInWorker() {
  if (typeof Worker === "undefined" || typeof location === "undefined") return false;
  return new URLSearchParams(location.search).get("trafficworker") === "1";
}

export function makeDroneTraffic(seed: number, lite: boolean): TrafficApi {
  if (trafficInWorker()) { try { return new DroneTrafficClient(seed, lite); } catch { /* (no worker: on the page) */ } }
  return new DroneTraffic(seed, lite);
}

type Body = { id: number; kind: number; x: number; y: number; z: number; hx: number; hy: number; v: number; r: number; g: number; b: number };

export class DroneTrafficClient implements TrafficApi {
  private readonly view: DroneTraffic;
  private readonly worker: Worker;
  private busy = false;
  private owed = 0;
  private bodies: Body[] = [];
  private taken = new Set<number>();
  private disposed = false;
  /** the worker's last step (ms) and cars, for the checks */
  stats = { ms: 0, cars: 0, steps: 0, waits: 0 };
  get group() { return this.view.group; }

  constructor(seed: number, lite: boolean) {
    this.view = new DroneTraffic(seed, lite);
    this.worker = new Worker(new URL("./trafficWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<TrafficFrame>) => this.receive(e.data);
    this.worker.onerror = e => { console.warn("[traffic] worker failed", e.message); };
    this.worker.postMessage({ type: "init", seed, lite });
    void this.view.nearReady.then(() => { if (!this.disposed) this.worker.postMessage({ type: "near", ...this.view.nearKinds() }); });
  }

  private receive(f: TrafficFrame) {
    this.busy = false;
    if (this.disposed) return;
    this.view.applyFrame(f);
    const b = f.bodies, out: Body[] = [];
    for (let o = 0; o + 10 < b.length; o += 11) {
      const id = b[o];
      if (this.taken.has(id)) continue;
      out.push({ id, kind: b[o + 1], x: b[o + 2], y: b[o + 3], z: b[o + 4], hx: b[o + 5], hy: b[o + 6], v: b[o + 7], r: b[o + 8], g: b[o + 9], b: b[o + 10] });
    }
    this.bodies = out;
    this.stats.ms = f.ms ?? 0; this.stats.cars = f.cars; this.stats.steps++;
  }

  addTile(tile: string, packed: Float32Array, stops?: Float32Array, banks?: Float32Array) {
    if (this.disposed) return;
    // (copies: the tile keeps its own)
    const p = packed.slice(), s = stops?.slice(), k = banks?.slice();
    this.worker.postMessage({ type: "add", tile, packed: p, stops: s, banks: k }, [p.buffer, ...(s ? [s.buffer] : []), ...(k ? [k.buffer] : [])]);
  }
  removeTile(tile: string) { if (!this.disposed) this.worker.postMessage({ type: "remove", tile }); }

  update(dt: number, camera: THREE.Vector3, look?: THREE.Vector3) {
    if (this.disposed) return;
    this.owed += dt;
    if (this.busy) { this.stats.waits++; return; }
    this.busy = true;
    const step = Math.min(this.owed, 0.25);
    this.owed = 0;
    this.worker.postMessage({ type: "step", dt: step, cam: [camera.x, camera.y, camera.z], look: look ? [look.x, look.y, look.z] : null });
  }

  bodiesNear(x: number, y: number, r: number) {
    const out: { x: number; y: number; z: number; hx: number; hy: number; length: number; width: number }[] = [];
    for (const c of this.bodies) {
      if (Math.abs(c.x - x) > r || Math.abs(c.y - y) > r) continue;
      const L = TRAFFIC_KINDS[c.kind]?.length ?? 4.6;
      out.push({ x: c.x, y: c.y, z: c.z, hx: c.hx, hy: c.hy, length: L, width: L > 8 ? 2.5 : L > 5.5 ? 2.1 : 1.85 });
    }
    return out;
  }

  nearestCar(x: number, y: number, r: number) {
    let best: Body | null = null, bd = r;
    for (const c of this.bodies) { const d = Math.hypot(c.x - x, c.y - y); if (d < bd) { bd = d; best = c; } }
    if (!best) return null;
    const k = TRAFFIC_KINDS[best.kind];
    return { id: best.id, k: best.kind, kind: k.name, colour: new THREE.Color(best.r, best.g, best.b), x: best.x, y: best.y, z: best.z, hx: best.hx, hy: best.hy, v: best.v, emergency: best.kind >= TRAFFIC_EMERGENCY_FROM, length: k.length };
  }

  takeCar(id: number) {
    const had = this.bodies.some(c => c.id === id);
    if (!had) return false;
    this.taken.add(id);
    this.bodies = this.bodies.filter(c => c.id !== id);
    this.worker.postMessage({ type: "take", id });
    return true;
  }

  model(k: number) { return this.view.model(k); }
  modelOf(name: string) { return this.view.modelOf(name); }
  place(im: THREE.InstancedMesh, i: number, x: number, y: number, z: number, hx: number, hy: number) { this.view.place(im, i, x, y, z, hx, hy); }
  materials() { return this.view.materials(); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.postMessage({ type: "dispose" });
    setTimeout(() => this.worker.terminate(), 500);
    this.view.dispose();
  }
}
