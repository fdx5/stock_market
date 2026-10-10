import * as THREE from "three";
import type { RealEstateBuildingsResponse } from "../api/client";
import type { Terrain } from "./sceneTerrain";
import { DroneFlight, MAX_AGL, MAX_SPEED, MIN_AGL } from "./droneFlight";
import { DroneWorld, type ViewExtent, type DroneViewBuildings } from "./droneWorld";
import { DroneAudio } from "./droneAudio";
import { DroneSigns } from "./droneSigns";
import { DroneModel } from "./droneModel";
import { buildWalkers, type WalkPath } from "./sceneWalkers";
import { seaOutsideBox } from './coastGeometry';
import type { WaterField } from './sceneWater';
import { bridgeContains } from './bridgeDeck';
import {frameSlice} from './frameSlice';
import {CoastGeometryJobs} from './coastGeometryJobs';

/* 드론 mode of the 3D view (ComplexHologram): the flight, the world streamed round it and the
 * sound, set up over the view's own scene and taken down again. While it lasts:
 *   - the camera is the drone's (a wide lens, a near plane for 2 m over the ground);
 *   - the view's own ground keeps to its land-use square (its haze-fading skirt to the horizon
 *     moves 30 m down, the backdrop past the drone's tiles: the tiles lie on the real relief);
 *   - the sky's clouds are crisp and the sun shows its corona (droneSky). */

export type DroneHud = {
  autopilot: boolean; autopilotStatus: DroneFlight['autopilotStatus']; autoTargetAgl: number;
  kmh: number; agl: number; alt: number; heading: number; limited: boolean; limit: number;
  tiles: number; ready: number; loading: number; buildings: number; radius: number; clearance: number;
  /** on screen along the flight (m), and the nearest part of the world not yet on screen (m) */
  ahead: number; unready: number;
  /** the nearest part not yet on screen in the half of the world ahead of the flight (m) */
  unreadyFront: number;
};

export class DroneSession {
  readonly flight = new DroneFlight();
  readonly world: DroneWorld;
  readonly audio = new DroneAudio();
  readonly signs = new DroneSigns();
  /** 1인칭 (the drone's camera) or 3인칭 (behind the drone, the drone in view). */
  view: "fpv" | "chase" = "fpv";
  private model = new DroneModel();
  private chaseYaw = 0;
  private chaseDist = 3.6;
  private clock = 0;
  /** The people on the sidewalks round the drone (the view's own walkers, sceneWalkers): made
   * again when the drone has gone 350 m, only while it is low enough to see them. */
  private crowd: { c: NonNullable<Awaited<ReturnType<typeof buildWalkers>>>; x: number; y: number } | null = null;
  private crowdBusy = false;
  private groundBackup: THREE.BufferGeometry | null = null;
  private backdrop: THREE.Mesh | null = null;
  private backdropHeights: Float32Array | null = null;
  private trafficFilters = new Map<Record<string, any>, any>();
  private saved: { fov: number; near: number; far: number } | null = null;
  private sky = 0;
  private hudAt = 0;

  constructor(private readonly p: {
    scene: THREE.Scene; camera: THREE.PerspectiveCamera; ground: THREE.Mesh | null; terrain: Terrain;
    data: RealEstateBuildingsResponse; seed: number; hq: boolean; extent: ViewExtent;
    addWarm: (parent: THREE.Object3D, obj: THREE.Object3D) => void;
    drawReady: (obj: THREE.Object3D) => boolean;
    forget?: (materials: Set<THREE.Material>) => void;
    /** where the view's own trees stand (view frame) */
    viewTrees?: () => [number, number][];
    viewBuildings?: () => DroneViewBuildings | undefined;
    /** the drone's sky, 0…1 (both renderers), and its distance haze (start, end; m) */
    setSky: (k: number, fog?: [number, number]) => void;
    onHud: (h: DroneHud) => void;
  }) {
    this.world = new DroneWorld({ data: p.data, terrain: p.terrain, extent: p.extent, seed: p.seed, hq: p.hq, addWarm: p.addWarm, drawReady: p.drawReady, forget: p.forget, viewTrees: p.viewTrees, viewBuildings:p.viewBuildings,
      viewWater: () => { const water: THREE.Mesh[] = []; for (const root of p.scene.children) if (root !== this.world.root) root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !Array.isArray(m.material) && m.material.userData.water && m.geometry.getAttribute('aSea')) water.push(m); }); return water; },
      onSeaReady: field => { void this.sinkSeaGround(field); },
      onLabels: (k, l) => this.signs.set(k, l) });
  }

  /** Take off from where the camera is (no higher than 500 m over the ground), looking its way. */
  start() {
    const { camera, scene } = this.p;
    scene.add(this.world.root);
    scene.add(this.model.group);
    this.keepGroundToSquare();
    scene.traverse(o => {
      const traffic = o.userData.traffic;
      if (!traffic?.cars || !traffic?.paths || o === this.world.traffic.group) return;
      const previous = traffic.placementFilter;
      this.trafficFilters.set(traffic, previous);
      traffic.placementFilter = (car: { x: number; y: number; hx: number; hy: number }) => {
        const deck = this.world.landmarks.gwanganDeck();
        return previous?.(car) !== false && (!deck || !bridgeContains(deck.P, car.x, car.y, car.hx, car.hy));
      };
    });
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const yaw = Math.atan2(-dir.x, -dir.z);
    const x = camera.position.x, y = -camera.position.z;
    const ground = this.world.groundAt(x, y);
    const alt = THREE.MathUtils.clamp(camera.position.y - ground, 40, Math.min(MAX_AGL, 220));
    this.flight.place(x, y, ground, alt, yaw);
    this.flight.tilt = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)), -0.9, 0.1);
    this.saved = { fov: camera.fov, near: camera.near, far: camera.far };
    camera.fov = 74; camera.near = 0.15; camera.far = 9000;
    camera.updateProjectionMatrix();
    this.flight.apply(camera);
    camera.updateMatrixWorld();
    void this.audio.start();
  }

  /** The view's own ground: everything past its land-use square (the skirt fading to the haze)
   * pulled in to the square's edge, and kept as a backdrop 30 m below (past the drone's tiles,
   * the horizon). Undone on leaving. */
  private keepGroundToSquare() {
    const g = this.p.ground;
    if (!g) return;
    const H = this.p.extent.farHalf;
    this.groundBackup = g.geometry;
    const back = g.geometry.clone();
    this.backdropHeights = (back.getAttribute('position').array as Float32Array).slice();
    g.updateWorldMatrix(true, false);
    // Exact clipping replaces collapsed outer faces, which formed dark vertical seams.
    g.geometry = seaOutsideBox(g.geometry, [-H, -H, H, H], g.matrixWorld, true);
    const mesh = new THREE.Mesh(back, g.material);
    mesh.rotation.copy(g.rotation);
    mesh.position.copy(g.position);
    mesh.position.y -= 30;
    mesh.name = "drone backdrop";
    mesh.updateMatrixWorld();
    this.backdrop = mesh;
    this.p.scene.add(mesh);
  }

  private coastJobs = new CoastGeometryJobs();
  private seaStop = new AbortController();
  private async sinkSeaGround(field: WaterField) {
    this.seaStop.abort();const stop=this.seaStop=new AbortController();
    for (const mesh of [this.p.ground, this.backdrop]) {
      if (!mesh || !this.groundBackup) continue;
      const geometry=mesh.geometry,p = geometry.getAttribute('position') as THREE.BufferAttribute;
      const positions=(p.array as Float32Array).slice();
      const source = mesh === this.backdrop ? this.backdropHeights : null;
      let changed = false;
      for (let i = 0; i < p.count; i++) {
        if(i%1024===0){await frameSlice(4);if(this.ended||stop.signal.aborted||mesh.geometry!==geometry)return;}
        const x = p.getX(i), y = p.getY(i);
        if(x<field.bounds.x0||x>field.bounds.x1||y<field.bounds.y0||y>field.bounds.y1)continue;
        if (!field.wet(x, y)) continue;
        const z = field.level(x, y) - .6 - mesh.position.y;
        const original = source?.[i * 3 + 2] ?? p.getZ(i);
        if (p.getZ(i) > z) { positions[i*3+2]=Math.min(original,z); changed = true; }
      }
      if(changed&&geometry.index){
        const result=await this.coastJobs.normals(positions,Uint32Array.from(geometry.index.array),stop.signal);
        if(!result)continue;
        if(this.ended||stop.signal.aborted||mesh.geometry!==geometry){result.dispose();return;}
        geometry.setAttribute('position',result.getAttribute('position'));geometry.setAttribute('normal',result.getAttribute('normal'));geometry.boundingSphere=result.boundingSphere;geometry.boundingBox=null;
        // Arrays now belong to the live geometry; the temporary has no GPU owner.
        result.dispose();
      }
    }
  }

  /** Where the drone is (for the radar): latitude, longitude, heading, speed, height. */
  readonly where = () => {
    const c = this.p.data.center!, f = this.flight;
    const kx = Math.cos((c.lat * Math.PI) / 180) * 111320;
    return { lat: c.lat + -f.pos.z / 110540, lon: c.lon + f.pos.x / kx, heading: f.heading, kmh: f.kmh, agl: f.agl };
  };
  private tickN = 0;
  /** the worst ms this second: flight, world, cars, people, rest (sky, signs) */
  readonly timing = [0, 0, 0, 0, 0];
  private tickDue = new Map<(dt: number) => void, number>();
  /** Run the view's own moving things (traffic, people, within `r` of `at`): every frame close by
   * and low; 60 m up every 2nd frame; from 400 m off, or 200 m up, every 3rd; from 800 m every
   * 4th (a car there moves about a pixel a step) — staggered, so no frame carries them all; past the haze not at all. */
  runViewTicks(ticks: ((dt: number) => void)[], at: THREE.Vector3, r: number, dt: number) {
    const f = this.flight.pos;
    const d = Math.hypot(f.x - at.x, f.z - at.z) - r;
    if (d > this.world.reach) { this.tickDue.clear(); return; }
    // Near traffic must not accumulate two/three frames of collision simulation
    // into one long display frame merely because the drone is higher than 60m.
    const every = d > 800 ? 4 : d > 400 ? 3 : 1;
    const n = ++this.tickN;
    ticks.forEach((fn, i) => {
      const due = (this.tickDue.get(fn) ?? 0) + dt;
      if ((n + i) % every !== 0) { this.tickDue.set(fn, due); return; }
      this.tickDue.set(fn, 0);
      fn(Math.min(due, 0.1 * every));
    });
  }

  /** One frame (dt in seconds; the view w × h CSS pixels). */
  tick(dt: number, viewW: number, viewH: number) {
    const f = this.flight, w = this.world, T = this.timing, t0 = performance.now();
    f.step(dt, w);
    const x = f.pos.x, y = -f.pos.z;
    const t1 = performance.now();
    w.update(x, y, f.vel.x, -f.vel.z, f.agl, [-Math.sin(f.yaw), Math.cos(f.yaw)]);
    const t2 = performance.now();
    w.traffic.update(dt, this.p.camera.position);
    const t3 = performance.now();
    this.people(x, y);
    if (this.crowd) {
      const see = f.agl < 260;
      this.crowd.c.group.visible = see;
      if (see) this.crowd.c.update(dt, this.p.camera);
    }
    const t4 = performance.now();
    this.clock += dt;
    if (this.view === "chase") this.chase(dt);
    else { this.model.group.visible = false; f.apply(this.p.camera); }
    const speed = Math.hypot(f.vel.x, f.vel.z) / MAX_SPEED;
    this.audio.update(f.load, speed, f.bumped);
    // The sky eases in over a second; the haze closes in toward the edge of the loaded world
    // (its last quarter: the tiles still coming in out there are behind it).
    this.sky = Math.min(1, this.sky + dt);
    const R = w.reach;
    this.p.setSky(this.sky, [R * 0.72, R * 0.98]);
    this.p.camera.updateMatrixWorld();
    this.signs.draw(this.p.camera, viewW, viewH, [R * 0.72, R * 0.98]);
    const now = performance.now();
    // (where a frame's time goes: flight, world, cars, people, signs — the worst of each a second)
    for (const [k, v] of [[0, t1 - t0], [1, t2 - t1], [2, t3 - t2], [3, t4 - t3], [4, now - t4]] as const) T[k] = Math.max(T[k], v);
    if (now - this.hudAt > 120) {
      this.hudAt = now;
      const s = w.stats();
      this.p.onHud({
        autopilot: f.autopilot, autopilotStatus: f.autopilotStatus, autoTargetAgl: f.autoTargetAgl,
        kmh: f.kmh, agl: f.agl, alt: f.pos.y, heading: f.heading, limited: f.limit < MAX_SPEED - 0.5, limit: f.limit * 3.6,
        tiles: s.tiles, ready: s.ready, loading: s.loading, buildings: s.buildings, radius: s.radius, clearance: f.clearance,
        ahead: f.ahead, unready: w.nearestUnready(x, y, 2000),
        unreadyFront: Math.hypot(f.vel.x, f.vel.z) > 0.5 ? w.clearAhead(x, y, f.vel.x / Math.hypot(f.vel.x, f.vel.z), -f.vel.z / Math.hypot(f.vel.x, f.vel.z), 2000) : w.nearestUnready(x, y, 2000),
      });
    }
  }

  private people(x: number, y: number) {
    if (location.search.includes("droneoff=") && /droneoff=[^&]*people/.test(location.search)) return;
    if (this.crowdBusy || this.flight.agl > 200 || (this.crowd && Math.hypot(this.crowd.x - x, this.crowd.y - y) < 350)) return;
    const packs = this.world.walkPathsNear(x, y, 550);
    if (!packs.length) return;
    const paths: WalkPath[] = [];
    for (const pk of packs) for (let o = 0; o < pk.length;) {
      const n = pk[o++], xs = new Float32Array(n), ys = new Float32Array(n), cum = new Float32Array(n);
      for (let k = 0; k < n; k++) { xs[k] = pk[o + k * 2]; ys[k] = pk[o + k * 2 + 1]; if (k) cum[k] = cum[k - 1] + Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]); }
      o += n * 2;
      if (cum[n - 1] > 12) paths.push({ xs, ys, cum, closed: false, lift: 0.5, lateral: 0.6 });
    }
    if (!paths.length) return;
    this.crowdBusy = true;
    const w = this.world;
    const terrain = { at: (px: number, py: number) => w.groundAt(px, py), base: (r: [number, number][]) => Math.min(...r.map(([px, py]) => w.groundAt(px, py))), relief: 0, elevation: null, source: "drone" } as Terrain;
    void buildWalkers(paths, terrain, this.p.seed + Math.round(x / 350) * 31 + Math.round(y / 350) * 17, 10, 700).then(c => {
      this.crowdBusy = false;
      if (!c) return;
      if (this.ended) { c.dispose(); return; }
      const old = this.crowd;
      this.crowd = { c, x, y };
      this.p.addWarm(this.world.root, c.group);
      if (old) this.dropCrowd(old.c);
    }).catch(() => { this.crowdBusy = false; });
  }
  private dropCrowd(c: NonNullable<Awaited<ReturnType<typeof buildWalkers>>>) {
    const mats = new Set<THREE.Material>();
    c.group.traverse(o => { const m = (o as THREE.Mesh).material; if (m) for (const x of Array.isArray(m) ? m : [m]) mats.add(x); });
    c.group.removeFromParent();
    this.p.forget?.(mats);
    c.dispose();
  }
  private ended = false;

  /** 1인칭 ↔ 3인칭. */
  toggleView() {
    this.view = this.view === "fpv" ? "chase" : "fpv";
    this.chaseYaw = this.flight.yaw;
    const c = this.p.camera;
    c.near = this.view === "chase" ? 0.05 : 0.15; c.updateProjectionMatrix();
    return this.view;
  }

  /** The third-person camera: behind the drone and a little above, its heading following the
   * drone's with a short lag (turns read as turns), its height angle from the camera tilt (a drag
   * looks down on it or up past it); pulled in where a wall or a tree is between them. */
  private chase(dt: number) {
    const f = this.flight, c = this.p.camera, w = this.world;
    const d = Math.atan2(Math.sin(f.yaw - this.chaseYaw), Math.cos(f.yaw - this.chaseYaw));
    this.chaseYaw += d * Math.min(1, dt * 5);
    const el = THREE.MathUtils.clamp(0.28 - f.tilt * 0.8, -0.15, 1.35);
    const bx = Math.sin(this.chaseYaw), bz = Math.cos(this.chaseYaw);   // behind: opposite the heading
    const want = 3.6;
    // (the line from the drone back to the camera, in half-metre steps: stop short of anything solid)
    let dist = want;
    for (let s = 0.5; s <= want; s += 0.5) {
      const x = f.pos.x + bx * Math.cos(el) * s, z = f.pos.z + bz * Math.cos(el) * s, y = f.pos.y + Math.sin(el) * s;
      const under = Math.max(w.groundAt(x, -z), w.roofAt(x, -z));
      if (y < under + 0.6) { dist = Math.max(0.8, s - 0.5); break; }
    }
    this.chaseDist += (dist - this.chaseDist) * Math.min(1, dt * (dist < this.chaseDist ? 20 : 3));
    const r = this.chaseDist;
    c.position.set(f.pos.x + bx * Math.cos(el) * r, f.pos.y + Math.sin(el) * r + 0.35, f.pos.z + bz * Math.cos(el) * r);
    c.lookAt(f.pos.x - bx * 6, f.pos.y + 0.25 - Math.sin(el) * 2.2, f.pos.z - bz * 6);
    this.model.group.visible = true;
    this.model.update(dt, f.pos, f.yaw, f.pitchBody, f.roll, f.load, this.clock);
  }

  /** Back to the view as it was. */
  end() {
    const { camera, scene, ground } = this.p;
    this.ended = true;
    this.seaStop.abort();this.coastJobs.dispose();
    this.flight.setAutopilot(false);
    if (this.crowd) { this.dropCrowd(this.crowd.c); this.crowd = null; }
    this.audio.stop();
    this.world.dispose();
    this.p.forget?.(new Set(this.model.materials()));
    this.model.dispose();
    if (ground && this.groundBackup) {
      ground.geometry.dispose(); ground.geometry = this.groundBackup;
    }
    this.groundBackup = null;
    if (this.backdrop) { scene.remove(this.backdrop); this.backdrop.geometry.dispose(); this.backdrop = null; }
    this.backdropHeights = null;
    for (const [traffic, previous] of this.trafficFilters) traffic.placementFilter = previous;
    this.trafficFilters.clear();
    if (this.saved) { camera.fov = this.saved.fov; camera.near = this.saved.near; camera.far = this.saved.far; camera.updateProjectionMatrix(); }
    this.p.setSky(0);
  }
}

export { MIN_AGL, MAX_AGL, MAX_SPEED };
