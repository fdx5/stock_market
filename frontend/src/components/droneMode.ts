import * as THREE from "three";
import type { RealEstateBuildingsResponse } from "../api/client";
import type { Terrain } from "./sceneTerrain";
import { DroneFlight, MAX_AGL, MAX_SPEED, MIN_AGL } from "./droneFlight";
import { DroneWorld, type ViewExtent, type DroneViewBuildings } from "./droneWorld";
import type {NearBuildingSource} from './nearBuildingTargets';
import { DroneAudio } from "./droneAudio";
import { DroneSigns } from "./droneSigns";
import { DroneCctv } from './droneCctv';
import { DroneLive } from './droneLive';
import type {DroneLabel} from './ringBuildings';
import { DroneModel } from "./droneModel";
import { buildWalkers, type WalkPath } from "./sceneWalkers";
import { seaOutsideBox } from './coastGeometry';
import type { WaterField } from './sceneWater';
import { bridgeContains } from './bridgeDeck';
import {frameSlice} from './frameSlice';
import {CoastGeometryJobs} from './coastGeometryJobs';
import {syncGroundRelief} from './roadDrape';

/* 드론 mode of the 3D view (ComplexHologram): the flight, the world streamed round it and the
 * sound, set up over the view's own scene and taken down again. While it lasts:
 *   - the camera is the drone's (a wide lens, a near plane for 2 m over the ground);
 *   - the view's own ground keeps to its land-use square; actual DEM tiles supply the ground
 *     beyond it, without an extrapolated departure-area sheet over the destination;
 *   - the sky's clouds are crisp and the sun shows its corona (droneSky). */

export type DroneHud = {
  autoRotate:boolean;
  autopilot: boolean; autopilotStatus: DroneFlight['autopilotStatus']; autoTargetAgl: number;
  kmh: number; agl: number; alt: number; heading: number; limited: boolean; limit: number;
  tiles: number; ready: number; loading: number; buildings: number; radius: number; clearance: number;
  /** on screen along the flight (m), and the nearest part of the world not yet on screen (m) */
  ahead: number; unready: number;
  /** the nearest part not yet on screen in the half of the world ahead of the flight (m) */
  unreadyFront: number;
};

export class DroneSession {
  private lookDir = new THREE.Vector3();
  readonly flight = new DroneFlight();
  readonly world: DroneWorld;
  readonly audio = new DroneAudio();
  readonly signs = new DroneSigns();
  readonly cctv:DroneCctv;
  /** the live public layers (subway, emergency rooms, road speeds, 따릉이, car parks) */
  readonly live:DroneLive;
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
  private trafficFilters = new Map<Record<string, any>, any>();
  private saved: { fov: number; near: number; far: number } | null = null;
  private sky = 0;
  private hudAt = 0;
  private stationLabels:DroneLabel[]|undefined;
  private bridgeLabels:readonly DroneLabel[]|undefined;

  constructor(private readonly p: {
    scene: THREE.Scene; camera: THREE.PerspectiveCamera; ground: THREE.Mesh | null; terrain: Terrain;
    data: RealEstateBuildingsResponse; seed: number; hq: boolean; extent: ViewExtent;
    addWarm: (parent: THREE.Object3D, obj: THREE.Object3D) => void;
    drawReady: (obj: THREE.Object3D) => boolean;
    forget?: (materials: Set<THREE.Material>) => void;
    /** where the view's own trees stand (view frame) */
    viewTrees?: () => [number, number][];
    viewBuildings?: () => DroneViewBuildings | undefined;
    nearBuildings?: () => NearBuildingSource | undefined;
    stationLabels?:()=>DroneLabel[]|undefined;
    bridgeLabels?:()=>readonly DroneLabel[];
    onSeaReady?:(field:WaterField)=>void;
    /** the view's own water (its rivers' field), once it is made */
    viewRiver?:()=>WaterField|null;
    /** the drone's sky, 0…1 (both renderers), and its distance haze (start, end; m) */
    setSky: (k: number, fog?: [number, number]) => void;
    /** a phone (not hq): the renderer's lighter shadows while the drone flies */
    setLite?: (on: boolean) => void;
    onHud: (h: DroneHud) => void;
  }) {
    this.world = new DroneWorld({ data: p.data, terrain: p.terrain, extent: p.extent, seed: p.seed, hq: p.hq, addWarm: p.addWarm, drawReady: p.drawReady, forget: p.forget, viewTrees: p.viewTrees, viewBuildings:p.viewBuildings,nearBuildings:p.nearBuildings,
      viewWater: () => this.viewWater(),
      onSeaReady: field => { void this.sinkSeaGround(field); p.onSeaReady?.(field); },
      onLabels: (k, l) => this.signs.set(k, l) });
    this.cctv=new DroneCctv(p.scene,this.signs,p.data.center!, (x,y)=>this.world.groundAt(x,y));
    this.live=new DroneLive(this.signs,p.data.center!,(x,y)=>this.world.groundAt(x,y),this.world,p.scene);
  }

  /** Take off from the camera, starting within 220 m of the ground, looking its way. */
  start() {
    const { camera, scene } = this.p;
    scene.add(this.world.root);
    scene.add(this.model.group);
    if (!this.p.hq) { this.p.setLite?.(true); this.signs.lite = true; }
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

  /** Keep only the departure area's surveyed square. The broad extrapolated
   * skirt must not survive as another ground layer: lowering it by 30 m still
   * covers real destination terrain in lower valleys. Restored on leaving. */
  private keepGroundToSquare() {
    const g = this.p.ground;
    if (!g) return;
    const H = this.p.extent.farHalf;
    this.groundBackup = g.geometry;
    g.updateWorldMatrix(true, false);
    // Exact clipping replaces collapsed outer faces, which formed dark vertical seams.
    // (off the page, in the coast worker: on the page it held the drone's first frame 60 ms; the
    // ground stands uncut the moment it takes — no tile is in past the square yet)
    const source = g.geometry, box: [number, number, number, number] = [-H, -H, H, H], matrix = g.matrixWorld.clone();
    this.groundCut = this.coastJobs.cut(source, box, matrix, true, this.cutStop.signal).catch(() => null).then(cut => {
      const geo = cut ?? (this.ended ? null : seaOutsideBox(source, box, matrix, true));
      if (!geo) return;
      if (this.ended || g.geometry !== source) { geo.dispose(); return; }
      g.geometry = geo;
    });
  }

  private coastJobs = new CoastGeometryJobs();
  private seaStop = new AbortController();
  private cutStop = new AbortController();
  /** The view's ground cut to its square (keepGroundToSquare), done. */
  private groundCut: Promise<void> = Promise.resolve();
  /** Only the session owning this source may update its clipped visible ground. */
  async syncGround(source:THREE.BufferGeometry){
    if(this.groundBackup!==source)return;
    await this.groundCut;
    const mesh=this.p.ground,visible=mesh?.geometry;
    if(this.ended||!visible||this.groundBackup!==source)return;
    let deadline=performance.now()+2;
    await syncGroundRelief(source,visible,async()=>{
      if(performance.now()>deadline){await frameSlice(6);deadline=performance.now()+2;}
      return !this.ended&&mesh?.geometry===visible;
    });
  }
  private async sinkSeaGround(field: WaterField) {
    this.seaStop.abort();const stop=this.seaStop=new AbortController();
    // (the cut ground sunk, never the view's own kept for the end)
    await this.groundCut;
    if (this.ended || stop.signal.aborted) return;
    for (const mesh of [this.p.ground]) {
      if (!mesh || !this.groundBackup) continue;
      const geometry=mesh.geometry;
      if(field.coast&&geometry.index){
        const result=await this.coastJobs.sink(geometry,field.coast.data,mesh.position.y,stop.signal);
        if(!result)continue;
        if(this.ended||stop.signal.aborted||mesh.geometry!==geometry){result.dispose();return;}
        for(const[name,a]of Object.entries(result.attributes))geometry.setAttribute(name,a);
        geometry.setIndex(result.index);geometry.boundingSphere=result.boundingSphere;geometry.boundingBox=null;
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

  /** The view's own neighbourhood (the complex, its streets, trees, people: everything of the
   * scene that lies inside its ±farHalf square) is left out of the scene while the drone is
   * further from it than everything loaded round the drone and 400 m more — past the haze,
   * unseen — and back in 200 m before it could come into the haze again. Out of the scene, it costs the renderer nothing a frame
   * (its scene sync and draw lists walked some 300 meshes for nothing). */
  private viewHidden: THREE.Object3D[] | null = null;
  private viewParts: THREE.Object3D[] | null = null;
  private viewCull(x: number, y: number) {
    const H = this.p.extent.farHalf, d = Math.max(0, Math.hypot(x, y) - H * Math.SQRT2), R = this.world.reach;
    if (!this.viewHidden && d > R + 400) {
      if (!this.viewParts) {
        // (once: the scene's roots that lie wholly inside the view's square)
        const box = new THREE.Box3(), lim = H + 400;
        this.viewParts = this.p.scene.children.filter(o => {
          if (o === this.world.root || (o as THREE.Light).isLight || (o as THREE.Camera).isCamera || o === this.model.group) return false;
          box.setFromObject(o);
          return !box.isEmpty() && box.min.x > -lim && box.max.x < lim && box.min.z > -lim && box.max.z < lim;
        });
      }
      this.viewHidden = this.viewParts.filter(o => o.visible);
      for (const o of this.viewHidden) o.visible = false;
    } else if (this.viewHidden && d < R + 200) {
      // (back while still past the haze's end (0.98 of the reach): its ~300 meshes return to the
      // renderer four a frame — 1.4 s, 80 m at the drone's top speed)
      for (const o of this.viewHidden) o.visible = true;
      this.viewHidden = null;
    }
  }
  private restoreView() { if (this.viewHidden) { for (const o of this.viewHidden) o.visible = true; this.viewHidden = null; } }

  /** The view's rivers drawn as the tiles' are while the drone flies (droneWorld.riverOn): their
   * waves in world metres and one direction — along their own channel, each met the tiles' surface
   * at the square's edge in a line. Put back as they were at the end. */
  private viewWater() { const water: THREE.Mesh[] = []; for (const root of this.p.scene.children) if (root !== this.world.root) root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !Array.isArray(m.material) && m.material.userData.water && m.geometry.getAttribute('aSea')) water.push(m); }); return water; }
  private waterKept = new Map<THREE.BufferGeometry, { uv: Float32Array; flow: Float32Array }>();
  private waterAt = 0;
  private matchViewWater() {
    // (a walk of the view's scene: every second while its water may still be on the way, then
    // every ten)
    const now = performance.now();
    if (now - this.waterAt < (this.waterKept.size ? 10000 : 1000)) return;
    this.waterAt = now;
    const v = new THREE.Vector3();
    for (const m of this.viewWater()) {
      const g = m.geometry;
      if (this.waterKept.has(g)) continue;
      const pos = g.getAttribute('position') as THREE.BufferAttribute, uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined,
        flow = g.getAttribute('aFlow') as THREE.BufferAttribute | undefined, sea = g.getAttribute('aSea') as THREE.BufferAttribute | undefined;
      if (!uv || !flow) continue;
      this.waterKept.set(g, { uv: (uv.array as Float32Array).slice(), flow: (flow.array as Float32Array).slice() });
      m.updateWorldMatrix(true, false);
      for (let i = 0; i < pos.count; i++) {
        if (sea && sea.getX(i) > 0.5) continue;
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        uv.setXY(i, v.x, -v.z); flow.setXY(i, -0.6, 0.8);
      }
      uv.needsUpdate = flow.needsUpdate = true;
      void this.cutViewWater(m);
    }
  }
  /** The view's water cut to its square exactly (off the page), as each tile's is to its own:
   * its arrays swapped in the live geometry (as sinkSeaGround's), the originals kept for the end. */
  private waterCut = new Map<THREE.BufferGeometry, { attributes: Record<string, THREE.BufferAttribute | THREE.InterleavedBufferAttribute>; index: THREE.BufferAttribute | null; sphere: THREE.Sphere | null }>();
  private async cutViewWater(m: THREE.Mesh) {
    const H = this.p.extent.farHalf, g = m.geometry, sea = g.getAttribute('aSea') as THREE.BufferAttribute | undefined;
    if (!sea || !g.index || this.waterCut.has(g)) return;
    // (rivers only: a sea's edge with the tiles' is the sea coverage's work)
    const was = (sea.array as Float32Array).slice();
    if (was.some(v => v >= 0.5)) return;
    // (the cut keeps the sea's triangles in the box: the rivers' too, marked so for it)
    (sea.array as Float32Array).fill(1);
    const cut = await this.coastJobs.cut(g, [-H, -H, H, H], m.matrixWorld, true, this.seaStop.signal).catch(() => null);
    (sea.array as Float32Array).set(was);
    if (!cut) return;
    if (this.ended || m.geometry !== g || this.waterCut.has(g)) { cut.dispose(); return; }
    (cut.getAttribute('aSea') as THREE.BufferAttribute | undefined)?.array.fill(0);
    this.waterCut.set(g, { attributes: { ...g.attributes }, index: g.index, sphere: g.boundingSphere?.clone() ?? null });
    for (const [name, a] of Object.entries(cut.attributes)) g.setAttribute(name, a);
    g.setIndex(cut.index); g.boundingSphere = cut.boundingSphere; g.boundingBox = null;
  }
  /** The river bed under the view's water laid as the tiles' is (droneWorld.riverOn): 0.35 m under
   * the surface at the bank, deeper out to 3 m — under the view's own 0.35 m everywhere, its water
   * read paler than the tiles' at the square's edge. On the drone's copy of the ground, in slices. */
  private bedAt = 0;
  private bedDone = false;
  private layViewBed() {
    if (this.bedDone || this.ended) return;
    const g = this.p.ground, f = this.p.viewRiver?.();
    if (!g || !f || !this.groundBackup || g.geometry === this.groundBackup) return;
    const p = g.geometry.getAttribute('position') as THREE.BufferAttribute, oy = g.position.y;
    // (2 ms a frame: 6000 vertices a frame, each asked of the river five times, was 50 ms at once)
    const t0 = performance.now();
    let changed = false, end = this.bedAt;
    for (let i = this.bedAt; i < p.count; i++, end = i) {
      if ((i & 255) === 0 && performance.now() - t0 > 2) break;
      const x = p.getX(i), y = p.getY(i);
      if (!f.wet(x, y) && !f.wet(x + 4, y) && !f.wet(x - 4, y) && !f.wet(x, y + 4) && !f.wet(x, y - 4)) continue;
      const z0 = p.getZ(i) + oy, L = f.level(x, y);
      const sh = f.shore(x, y), bed = L - Math.min(3, 0.35 + 0.15 * sh), k = f.wet(x, y) ? 1 : Math.max(0, Math.min(1, (L + 0.4 - z0) / 0.4));
      if (!k || z0 <= bed) continue;
      p.setZ(i, z0 + k * (bed - z0) - oy); changed = true;
    }
    this.bedAt = end;
    if (changed) p.needsUpdate = true;
    if (end >= p.count) { this.bedDone = true; g.geometry.computeVertexNormals(); g.geometry.computeBoundingSphere(); }
  }
  private restoreWater() {
    for (const [g, k] of this.waterCut) {
      for (const [name, a] of Object.entries(k.attributes)) g.setAttribute(name, a);
      g.setIndex(k.index); g.boundingSphere = k.sphere; g.boundingBox = null;
    }
    this.waterCut.clear();
    for (const [g, k] of this.waterKept) {
      const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined, flow = g.getAttribute('aFlow') as THREE.BufferAttribute | undefined;
      if (uv && uv.array.length === k.uv.length) { (uv.array as Float32Array).set(k.uv); uv.needsUpdate = true; }
      if (flow && flow.array.length === k.flow.length) { (flow.array as Float32Array).set(k.flow); flow.needsUpdate = true; }
    }
    this.waterKept.clear();
  }

  /** One frame (dt in seconds; the view w × h CSS pixels). */
  tick(dt: number, viewW: number, viewH: number) {
    const f = this.flight, w = this.world, T = this.timing, t0 = performance.now();
    f.step(dt, w);
    const x = f.pos.x, y = -f.pos.z;
    const t1 = performance.now();
    w.update(x, y, f.vel.x, -f.vel.z, f.agl, [-Math.sin(f.yaw), Math.cos(f.yaw)]);
    const t2 = performance.now();
    w.traffic.update(dt, this.p.camera.position, this.p.camera.getWorldDirection(this.lookDir));
    const t3 = performance.now();
    this.people(x, y);
    if (this.crowd) {
      const see = f.agl < 260;
      this.crowd.c.group.visible = see;
      if (see) this.crowd.c.update(dt, this.p.camera);
    }
    this.viewCull(x, y);
    this.matchViewWater();
    this.layViewBed();
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
    const stations=this.p.stationLabels?.();
    if(stations!==this.stationLabels){this.stationLabels=stations;this.signs.set('surface-stations',stations??null);}
    const bridges=this.p.bridgeLabels?.();
    if(bridges!==this.bridgeLabels){this.bridgeLabels=bridges;this.signs.set('view-bridges',bridges?[...bridges]:null);}
    this.cctv.update(performance.now());
    this.signs.draw(this.p.camera, viewW, viewH, [R * 0.72, R * 0.98]);
    const now = performance.now();
    // (where a frame's time goes: flight, world, cars, people, signs — the worst of each a second)
    for (const [k, v] of [[0, t1 - t0], [1, t2 - t1], [2, t3 - t2], [3, t4 - t3], [4, now - t4]] as const) T[k] = Math.max(T[k], v);
    if (now - this.hudAt > 120) {
      this.hudAt = now;
      const s = w.stats();
      this.p.onHud({
        autoRotate:f.autoRotate,
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
    this.crowdBusy = true;
    const w = this.world;
    const terrain = { at: (px: number, py: number) => w.groundAt(px, py), base: (r: [number, number][]) => Math.min(...r.map(([px, py]) => w.groundAt(px, py))), relief: 0, elevation: null, source: "drone" } as Terrain;
    // (the sidewalks of the tiles round the drone read a few ms at a time: all at once — thousands
    // of lines — held a frame 10-20 ms)
    const walkPaths = async () => {
      const paths: WalkPath[] = [];
      let slice = performance.now();
      for (const pk of packs) for (let o = 0; o < pk.length;) {
        if (performance.now() - slice > 3) { await frameSlice(); slice = performance.now(); if (this.ended) return paths; }
        const n = pk[o++], xs = new Float32Array(n), ys = new Float32Array(n), cum = new Float32Array(n);
        for (let k = 0; k < n; k++) { xs[k] = pk[o + k * 2]; ys[k] = pk[o + k * 2 + 1]; if (k) cum[k] = cum[k - 1] + Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]); }
        o += n * 2;
        if (cum[n - 1] > 12) paths.push({ xs, ys, cum, closed: false, lift: 0.5, lateral: 0.6 });
      }
      return paths;
    };
    void walkPaths().then(paths => paths.length && !this.ended ? buildWalkers(paths, terrain, this.p.seed + Math.round(x / 350) * 31 + Math.round(y / 350) * 17, 10, 700) : null).then(c => {
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
    if (!this.p.hq) this.p.setLite?.(false);
    this.restoreView();
    this.restoreWater();
    this.seaStop.abort();this.coastJobs.dispose();
    this.flight.setAutopilot(false);
    this.flight.setAutoRotate(false);
    if (this.crowd) { this.dropCrowd(this.crowd.c); this.crowd = null; }
    this.audio.stop();
    this.p.forget?.(new Set(this.cctv.materials()));
    this.cctv.dispose();
    this.p.forget?.(new Set(this.live.materials()));
    this.live.dispose();
    this.world.dispose();
    this.p.forget?.(new Set(this.model.materials()));
    this.model.dispose();
    this.cutStop.abort();
    if (ground && this.groundBackup) {
      if (ground.geometry !== this.groundBackup) ground.geometry.dispose();
      ground.geometry = this.groundBackup;
    }
    this.groundBackup = null;
    for (const [traffic, previous] of this.trafficFilters) traffic.placementFilter = previous;
    this.trafficFilters.clear();
    if (this.saved) { camera.fov = this.saved.fov; camera.near = this.saved.near; camera.far = this.saved.far; camera.updateProjectionMatrix(); }
    this.p.setSky(0);
  }
}

export { MIN_AGL, MAX_AGL, MAX_SPEED };
