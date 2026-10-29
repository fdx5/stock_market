import * as THREE from "three";
import type { RealEstateBuildingsResponse } from "../api/client";
import type { Terrain } from "./sceneTerrain";
import { BIKE_EYE, DroneFlight, EYE, MAX_AGL, MAX_SPEED, MIN_AGL } from "./droneFlight";
import { Avatar } from "../walkmode/player/avatar";
import { Bicycles } from "../walkmode/game/Bicycles";
import { CarAudio, loadCarRecordings, playCarEffect } from "../walkmode/game/CarAudio";
import { carProfile } from "../walkmode/game/carProfiles";
import { CAR_SPECS, carGeometry, carModelMaterial } from "./sceneCars";
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

export type DroneResume = { flight: DroneFlight; view: "fpv" | "chase"; autopilot: boolean; autoRotate: boolean };

export class DroneSession {
  private lookDir = new THREE.Vector3();
  readonly flight: DroneFlight;
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
  /** the third-person camera's height angle raised over a low obstacle behind the walker (rad) */
  private chaseLift = 0;
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
    resume?: DroneResume;
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
    this.flight = p.resume?.flight ?? new DroneFlight();
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
    if (!this.p.resume) {
      this.flight.place(x, y, ground, alt, yaw);
      this.flight.tilt = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)), -0.9, 0.1);
    } else {
      this.flight.keys.clear();
      this.flight.sticks.left = [0, 0]; this.flight.sticks.right = [0, 0];
      this.flight.setAutopilot(this.p.resume.autopilot);
      this.flight.setAutoRotate(this.p.resume.autoRotate);
      this.view = this.p.resume.view;
    }
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
  /** `half` (a phone in flight, 40 m up or more): the near ones too every 2nd frame — the frames
   * `half` is true on, those the renderer's walk over the whole scene leaves out (see halfSync). */
  runViewTicks(ticks: ((dt: number) => void)[], at: THREE.Vector3, r: number, dt: number, half?: boolean) {
    const f = this.flight.pos;
    const d = Math.hypot(f.x - at.x, f.z - at.z) - r;
    if (d > this.world.reach) { this.tickDue.clear(); return; }
    // Near traffic must not accumulate two/three frames of collision simulation
    // into one long display frame merely because the drone is higher than 60m.
    const every = d > 800 ? 4 : d > 400 ? 3 : 1;
    const n = ++this.tickN;
    const paired = every === 1 && half !== undefined && !this.p.hq && this.flight.agl >= 40 && !/[?&]halfsync=0/.test(location.search);
    ticks.forEach((fn, i) => {
      const due = (this.tickDue.get(fn) ?? 0) + dt;
      if (paired ? !half : (n + i) % every !== 0) { this.tickDue.set(fn, due); return; }
      this.tickDue.set(fn, 0);
      fn(Math.min(due, paired ? 0.2 : 0.1 * every));
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
    // (held back by the world ahead: its tile work a third of the frame's own time — 5 ms at 60 fps,
    // up to 25 ms on a machine drawing 12 fps. Flying free, the frame rate comes first.)
    w.holding = f.limit < MAX_SPEED - 0.5 ? Math.max(4, Math.min(25, dt * 1000 / 3)) : 0;
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
    if (performance.now() > this.doorAt) { this.doorAt = performance.now() + 200; this.findDoor(); this.settle(); }
    if (f.walking && performance.now() > this.bikeAt) { this.bikeAt = performance.now() + 3000; this.parkBikes(); }
    this.clock += dt;
    if (this.view === "chase") this.chase(dt);
    else { this.model.group.visible = false; if (this.walker) this.walker.root.visible = false; if (f.car) this.placeCar(); else if (f.cycling) this.placeRider(dt); f.apply(this.p.camera); }
    const speed = Math.hypot(f.vel.x, f.vel.z) / MAX_SPEED;
    if (!f.walking) this.audio.update(f.load, speed, f.bumped);
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

  /** 걷기 ↔ 비행: on foot in this same world (its buildings, roads and trees), or flying again. */
  private walker: Avatar | null = null;
  private bikes: Bicycles | null = null;
  /** 자전거 ↔ 걷기 (on foot only): a bicycle under the walker, up to 100 km/h */
  toggleBike() {
    const f = this.flight; if (!f.walking) return false;
    if (!this.bikes) { this.bikes = new Bicycles(); this.p.scene.add(this.bikes.group); }
    const on = f.setCycling(!f.cycling);
    if (on) { const rec = this.bikes.provide({ id: "drone-walker", name: "", dong: "", x: f.pos.x, y: -f.pos.z, z: f.pos.y - BIKE_EYE, heading: Math.atan2(Math.cos(f.yaw), -Math.sin(f.yaw)) }); this.bikes.ride(rec); }
    else { this.bikes.ride(null); this.bikes.records.delete("drone-walker"); this.bikes.sync(f.pos.x, -f.pos.z); }
    if (this.walker && !on) this.walker.pose = "stand";
    return on;
  }
  /** the car being driven: its body (one instance of the traffic's model), its paint, its sound */
  private car: { mesh: THREE.InstancedMesh; kind: string; top: number; audio: CarAudio | null; eyeY: number; label: string } | null = null;
  private parkedCars: THREE.InstancedMesh[] = [];
  private carCtx: AudioContext | null = null;
  /** F on foot: into the nearest car (moving or not) within 4 m — out of the traffic, its driver
   * gone, its own top speed and engine; F again: out of it, the car left parked where it stands. */
  toggleCar(): string | null {
    const f = this.flight; if (!f.walking) return null;
    if (this.car) {
      const c = this.car, mesh = c.mesh; c.audio?.stop(); window.setTimeout(() => c.audio?.dispose(), 300);
      this.parkedCars.push(mesh); this.car = null;
      // (out by the driver's door: to the car's left)
      const lx = Math.cos(f.yaw), lz = -Math.sin(f.yaw), half = (f.car?.width ?? 1.9) / 2 + 0.6;
      f.setDriving(null); f.pos.x -= lx * half; f.pos.z -= lz * half;
      if (this.sound()) playCarEffect("door", this.sound() as unknown as Parameters<typeof playCarEffect>[1]);
      return null;
    }
    let t = this.world.traffic.nearestCar(f.pos.x, -f.pos.z, 6);
    if (!t) {
      // (none at hand: one of the traffic's cars brought to the kerb of the nearest lane — within
      // 60 m — stopped there, heading the lane's way; with no road near, to where the walker stands)
      const any = this.world.traffic.nearestCar(f.pos.x, -f.pos.z, Infinity);
      if (!any) return null;
      const l = this.world.lanePointNear(f.pos.x, -f.pos.z, 60);
      const at = l ? { x: l.x, y: l.y, z: l.z, hx: l.dx, hy: l.dy } : { x: f.pos.x, y: -f.pos.z, z: this.world.groundAt(f.pos.x, -f.pos.z), hx: -Math.sin(f.yaw), hy: Math.cos(f.yaw) };
      const hl = Math.hypot(at.hx, at.hy) || 1;
      t = { ...any, x: at.x, y: at.y, z: at.z, hx: at.hx / hl, hy: at.hy / hl, v: 0 };
    }
    this.world.traffic.takeCar(t.id);
    const sp = CAR_SPECS[t.kind] ?? CAR_SPECS.sedan, label = t.emergency ? (t.kind === "van" ? "구급차" : "소방차") : t.kind;
    const prof = carProfile({ kind: t.kind, label, length: sp.length, width: sp.width, height: sp.height });
    // (each car its own top speed: the kind's, a little either way by the car; the 119s quicker)
    const top = prof.topKmh * (t.emergency ? 1.15 : 1) * (0.94 + ((t.id * 7919) % 13) / 100);
    const m = this.world.traffic.model(t.k) ?? { geometry: carGeometry(t.kind)!, material: carModelMaterial() };
    const mesh = new THREE.InstancedMesh(m.geometry, m.material, 1); mesh.frustumCulled = false; mesh.castShadow = true;
    mesh.setColorAt(0, t.colour); if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.p.scene.add(mesh);
    const eyeY = Math.max(1.15, Math.min(2.6, prof.eye[1] + 0.25));
    this.car = { mesh, kind: t.kind, top, audio: null, eyeY, label };
    f.pos.x = t.x; f.pos.z = -t.y; f.yaw = Math.atan2(-t.hx, t.hy);
    f.setDriving({ top: top / 3.6, accel: prof.spec.accel * 1.25, brake: prof.spec.brake, wheelbase: prof.spec.wheelbase, lock: prof.spec.lock, length: sp.length, width: sp.width, eyeY }, Math.max(0, t.v));
    if (this.walker) this.walker.root.visible = false;
    // (the engine: the recordings of its kind's bank — small, saloon, V8, sports, van, truck, heavy, electric)
    const snd = this.sound();
    if (snd) void loadCarRecordings().then(() => { if (this.car?.mesh !== mesh) return; try { this.car.audio = new CarAudio(snd.ctx, snd.output, snd.noise, prof); playCarEffect("ignition", snd as unknown as Parameters<typeof playCarEffect>[1]); } catch { /* no recordings */ } });
    return `${label} · 최고 ${Math.round(top)}km/h`;
  }
  /** a small sound graph for the car (the drone's own audio is quiet on foot) */
  private sound(): { ctx: AudioContext; output: AudioNode; noise: AudioBuffer; audioGraph: { ctx: AudioContext; output: AudioNode } } | null {
    try {
      if (!this.carCtx) this.carCtx = new AudioContext();
      if (this.carCtx.state === "suspended") void this.carCtx.resume();
      const ctx = this.carCtx, noise = ctx.createBuffer(1, 1, ctx.sampleRate);
      return { ctx, output: ctx.destination, noise, audioGraph: { ctx, output: ctx.destination } };
    } catch { return null; }
  }
  /** the car's body where the flight is; its engine to the speed and the pedals */
  private placeCar() {
    const f = this.flight, c = this.car; if (!c || !f.car) return;
    const fx = -Math.sin(f.yaw), fy = Math.cos(f.yaw);
    this.world.traffic.place(c.mesh, 0, f.pos.x, -f.pos.z, f.pos.y - c.eyeY, fx, fy);
    const v = Math.abs(f.carSpeed), gears = [0.12, 0.24, 0.40, 0.59, 0.79, 1].map(x => x * f.car!.top);
    let lo = 0; for (const g of gears) { if (v <= g) { const r = (v - lo) / Math.max(0.1, g - lo); c.audio?.update(0.15 + r * 0.85, f.throttle, f.carSpeed, f.braking, 0, this.view === "fpv"); break; } lo = g; }
    if (v > gears[gears.length - 1]) c.audio?.update(1, f.throttle, f.carSpeed, f.braking, 0, this.view === "fpv");
    if (f.bumped > 4 && this.sound()) playCarEffect("impact", this.sound() as unknown as Parameters<typeof playCarEffect>[1], f.bumped / 15);
  }
  /** 각 단지 앞 자전거: a bicycle parked by the nearest sidewalk to each complex's name within 600 m */
  private bikeAt = 0;
  private parkBikes() {
    if (!this.bikes) { this.bikes = new Bicycles(); this.p.scene.add(this.bikes.group); }
    const f = this.flight, x = f.pos.x, y = -f.pos.z;
    for (const l of this.signs.labelsOfKind("apt")) {
      if (Math.hypot(l.x - x, l.y - y) > 600) continue;
      const id = `complex:${l.name}`; if (this.bikes.records.has(id)) continue;
      let best: [number, number] | null = null, bd = 60;
      for (const pk of this.world.walkPathsNear(l.x, l.y, 80)) for (let o = 0; o < pk.length;) { const n = pk[o++]; for (let k = 0; k < n; k++) { const px = pk[o + k * 2], py = pk[o + k * 2 + 1], d = Math.hypot(px - l.x, py - l.y); if (d < bd) { bd = d; best = [px, py]; } } o += n * 2; }
      if (!best) {
        // (no sidewalk line by it: at the roadside nearest the complex, past the lane's edge)
        const ln = this.world.lanePointNear(l.x, l.y, 150);
        if (ln) for (const side of [1, -1]) { const px = ln.x - ln.dy * side * (ln.w / 2 + 1.4), py = ln.y + ln.dx * side * (ln.w / 2 + 1.4); if (this.world.roofAt(px, py) < this.world.groundAt(px, py) + 0.5) { best = [px, py]; break; } }
      }
      if (best) this.bikes.provide({ id, name: l.name, dong: "단지 앞", x: best[0], y: best[1], z: this.world.groundAt(best[0], best[1]), heading: 0 });
    }
    this.bikes.sync(x, y);
  }
  /** B on foot by a parked bicycle (within 3 m): that one ridden; elsewhere a bicycle of one's own */
  rideNearest() {
    const f = this.flight; if (!f.walking || this.car) return false;
    const near = this.bikes?.nearest(f.pos.x, -f.pos.z, 3);
    if (near && !f.cycling) { this.bikes!.records.delete(near.id); f.pos.x = near.x; f.pos.z = -near.y; }
    return this.toggleBike();
  }
  /** the bicycle and the rider placed where the flight is (both views) */
  private placeRider(dt: number) {
    const f = this.flight, b = this.bikes?.active; if (!b || !this.walker) return;
    b.x = f.pos.x; b.y = -f.pos.z; b.z = f.pos.y - BIKE_EYE; b.heading = Math.atan2(Math.cos(f.yaw), -Math.sin(f.yaw));
    this.bikes!.update(f.moved, f.steer, f.bikeSpeed);
    this.walker.pedal(f.moved, f.steer);
    this.walker.root.position.set(b.x, b.z, -b.y); this.walker.root.rotation.set(0, f.yaw + Math.PI, -f.steer * Math.min(f.bikeSpeed / 10, 1) * 0.45);
    this.walker.update(dt, f.bikeSpeed);
  }
  /** On foot at (x, y) facing `yaw` — back out of a building's door: there, in third person. */
  walkAt(x: number, y: number, yaw: number) {
    const f = this.flight; if (f.walking) f.setWalking(false, this.world);
    // (the door is right at the wall and the walker faces away from it, so the camera behind them
    // would be inside the building and pulled in to arm's length: stepped out from the door along
    // the way they face until the camera's whole line behind them is clear, on open ground)
    const w = this.world, fx = -Math.sin(yaw), fy = Math.cos(yaw), bx = Math.sin(yaw), bz = Math.cos(yaw);
    const el = 0.28 + 0.04 * 0.8, want = f.cycling ? 6.5 : 6.0;   // (setWalking's tilt, chase's angle)
    for (let s = 0; s <= 10; s += 0.5) {
      const px = x + fx * s, py = y + fy * s, g = w.groundAt(px, py);
      if (w.roofAt(px, py) >= g + 0.5) continue;
      if (this.clearBehind(px, g + EYE + 0.9, -py, bx, bz, el, want) >= want) { x = px; y = py; break; }
    }
    f.pos.x = x; f.pos.z = -y; f.yaw = yaw;
    const on = this.toggleWalk(false);
    // (the camera straight behind at its full distance — not swinging round from wherever it was)
    this.chaseYaw = yaw; this.chaseLift = 0; this.chaseDist = this.chaseWant();
    return on;
  }
  /** On foot (or in a car, on a bike): up again into the air right here — out of the car or off the
   * bike first — not back to where the flight began. */
  takeOff() {
    const f = this.flight; if (!f.walking) return false;
    if (f.car) this.toggleCar();
    if (f.cycling) this.toggleBike();
    this.toggleWalk(false);
    return true;
  }
  toggleWalk(nearSidewalk = true) {
    const f = this.flight;
    // (whatever had the keyboard — a search field, a button — lets it go: W must walk)
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (!f.walking && nearSidewalk) {
      // (down onto the nearest sidewalk within 250 m — not into a wood or a courtyard's middle)
      const x = f.pos.x, y = -f.pos.z; let best: [number, number] | null = null, bd = Infinity;
      for (const pk of this.world.walkPathsNear(x, y, 250)) for (let o = 0; o < pk.length;) {
        const n = pk[o++];
        for (let k = 0; k < n; k++) { const px = pk[o + k * 2], py = pk[o + k * 2 + 1], d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = [px, py]; } }
        o += n * 2;
      }
      if (best && bd < 250) { f.pos.x = best[0]; f.pos.z = -best[1]; }
      else {
        // (no sidewalk line near: beside the nearest road, just past its lane's edge)
        const l = this.world.lanePointNear(x, y, 400);
        if (l) for (const side of [1, -1]) {
          const px = l.x - l.dy * side * (l.w / 2 + 1.6), py = l.y + l.dx * side * (l.w / 2 + 1.6);
          if (this.world.roofAt(px, py) < this.world.groundAt(px, py) + 0.5) { f.pos.x = px; f.pos.z = -py; break; }
        }
      }
    }
    const on = f.setWalking(!f.walking, this.world);
    if (on) this.landedAt = performance.now();
    // (on foot the walker is seen: third person to start with — V still changes it)
    if (on && this.view === "fpv") this.toggleView();
    if (on && !this.walker) { this.walker = new Avatar(7); this.p.scene.add(this.walker.root); }
    if (this.walker) this.walker.root.visible = false;
    this.audio.pause(on);
    return on;
  }
  /** On foot, a building ahead within 3 m (or beside, within 1.5 m): which, and where its wall is. */
  private findDoor() {
    const f = this.flight; if (!f.walking || f.cycling) { f.door = null; return; }
    const x = f.pos.x, y = -f.pos.z, fx = -Math.sin(f.yaw), fy = Math.cos(f.yaw);
    // (ahead first, then every way round: a wall within 4 m whichever way the walker faces)
    const dirs: [number, number, number][] = [[fx, fy, 4]];
    for (let k = 1; k < 8; k++) { const a = Math.atan2(fy, fx) + k * Math.PI / 4; dirs.push([Math.cos(a), Math.sin(a), 4]); }
    for (const [dx, dy, reach] of dirs) for (let d = 0.4; d <= reach; d += 0.3) {
      const px = x + dx * d, py = y + dy * d;
      if (this.world.roofAt(px, py) > this.world.groundAt(px, py) + 0.8) {
        // (the roof raster runs a little past the outline: the outline looked for up to 3 m further in)
        let ring: [number, number][] | null = null;
        for (let e = 0; e <= 3 && !ring; e += 0.5) ring = this.world.buildingRingAt(px + dx * e, py + dy * e);
        // (a building with no surveyed outline here — a neighbouring complex's block drawn by the
        // view itself: its outline traced from the roofs, the cells over the street joined from the
        // point hit, wrapped in their hull)
        if (!ring) ring = this.traceRoof(px + dx * 0.5, py + dy * 0.5);
        f.door = ring && ring.length >= 3 ? { ring, x: px, y: py } : null; return;
      }
    }
    f.door = null;
  }
  private doorAt = 0;
  /** set down at once, before the buildings round were in: for 15 s after, a walker found inside a
   * building (its outline, its roof over them) is moved to the nearest open ground outside it */
  private landedAt = 0;
  private settle() {
    const f = this.flight; if (!f.walking || f.car || performance.now() - this.landedAt > 15000) return;
    const w = this.world, x = f.pos.x, y = -f.pos.z;
    const inside = (px: number, py: number) => w.roofAt(px, py) > w.groundAt(px, py) + 0.8 && (w.roofAt(px, py) - w.groundAt(px, py) > 6 || !!w.buildingRingAt(px, py));
    if (!inside(x, y)) return;
    for (let r = 1; r <= 60; r += 1) for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (!inside(px, py) && !inside(px + Math.cos(a) * 0.8, py + Math.sin(a) * 0.8)) { f.pos.x = px + Math.cos(a) * 0.8; f.pos.z = -(py + Math.sin(a) * 0.8); return; }
    }
  }
  private traced: { x: number; y: number; ring: [number, number][] } | null = null;
  private traceRoof(x: number, y: number): [number, number][] | null {
    if (this.traced && Math.hypot(this.traced.x - x, this.traced.y - y) < 4) return this.traced.ring;
    const w = this.world, up = (qx: number, qy: number) => w.roofAt(qx, qy) > w.groundAt(qx, qy) + 0.8;
    if (!up(x, y)) return null;
    const seen = new Set<number>(), q: [number, number][] = [[0, 0]], pts: [number, number][] = [];
    seen.add(0);
    for (let h = 0; h < q.length && q.length < 6000; h++) {
      const [i, j] = q[h]; pts.push([x + i, y + j]);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj; if (Math.abs(a) > 90 || Math.abs(b) > 90) continue;
        const k = (a + 100) * 1000 + (b + 100); if (seen.has(k)) continue; seen.add(k);
        if (up(x + a, y + b)) q.push([a, b]);
      }
    }
    if (pts.length < 6) return null;
    // (the hull of the cells' corners)
    const c = pts.flatMap(([px, py]) => [[px - 0.5, py - 0.5], [px + 0.5, py - 0.5], [px + 0.5, py + 0.5], [px - 0.5, py + 0.5]] as [number, number][]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo: [number, number][] = [], hi: [number, number][] = [];
    for (const p of c) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let k = c.length - 1; k >= 0; k--) { const p = c[k]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
    const ring = lo.slice(0, -1).concat(hi.slice(0, -1));
    this.traced = { x, y, ring };
    return ring;
  }
  /** In through the door: the building's interior (평면도 기반: its register, its floors, its
   * businesses; a block of flats by its flats) on the walk page, back here on leaving. */
  enterDoor(): boolean {
    const d = this.flight.door; if (!d) return false;
    return this.openInside(d.ring, this.flight.pos.x, -this.flight.pos.z, Math.atan2(Math.cos(this.flight.yaw), -Math.sin(this.flight.yaw)) + Math.PI);
  }
  /** 내부 탐험 from a building's card (its sign): straight in, wherever the drone or the walker is —
   * its outline surveyed or traced from the roofs, the door on its side nearest the viewer */
  enterBuildingAt(x: number, y: number): boolean {
    const ring = this.world.buildingRingAt(x, y) ?? this.traceRoof(x, y);
    if (!ring || ring.length < 3) return false;
    const vx = this.flight.pos.x, vy = -this.flight.pos.z;
    let best: [number, number] = ring[0], bd = Infinity;
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((vx - a[0]) * dx + (vy - a[1]) * dy) / l2)), p: [number, number] = [a[0] + dx * t, a[1] + dy * t], d = Math.hypot(p[0] - vx, p[1] - vy); if (d < bd) { bd = d; best = p; } }
    const cx = ring.reduce((t, p) => t + p[0], 0) / ring.length, cy = ring.reduce((t, p) => t + p[1], 0) / ring.length;
    // (the door a step outside the wall, facing in)
    const ox = best[0] - cx, oy = best[1] - cy, ol = Math.hypot(ox, oy) || 1;
    return this.openInside(ring, best[0] + ox / ol * 1.5, best[1] + oy / ol * 1.5, Math.atan2(oy, ox));
  }
  private campusOf(ring: [number, number][], x: number, y: number): [number, number][][] {
    const all = this.world.buildingRingsNear(x, y, 300).filter(r => r !== ring && r.length >= 3);
    const gap = (a: [number, number][], b: [number, number][]) => {
      let d = Infinity;
      for (const p of a) for (let i = 0; i < b.length; i++) {
        const q = b[i], s = b[(i + 1) % b.length], dx = s[0] - q[0], dy = s[1] - q[1], l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / l2));
        d = Math.min(d, Math.hypot(p[0] - q[0] - dx * t, p[1] - q[1] - dy * t));
      }
      return d;
    };
    const area = (r: [number, number][]) => Math.abs(r.reduce((t, p, i) => { const q = r[(i + 1) % r.length]; return t + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
    const got: [number, number][][] = [ring], left = all.filter(r => area(r) > 150);
    for (let grew = true; grew && got.length < 16;) {
      grew = false;
      for (let i = 0; i < left.length; i++) if (got.some(g => Math.min(gap(g, left[i]), gap(left[i], g)) < 30)) { got.push(left[i]); left.splice(i--, 1); grew = true; if (got.length >= 16) break; }
    }
    return got.slice(1);
  }
  private openInside(ring: [number, number][], doorX: number, doorY: number, heading: number): boolean {
    const c = this.p.data.center; if (!c) return false;
    const kx = Math.cos(c.lat * Math.PI / 180) * 111_320, ky = 110_540;
    const ll = (x: number, y: number) => `${(c.lon + x / kx).toFixed(7)},${(c.lat + y / ky).toFixed(7)}`;
    const [lon, lat] = ll(doorX, doorY).split(",");
    const back = new URLSearchParams(location.search);
    // (out again in front of this building: where the door was, facing it)
    const fx = ring.reduce((t, p) => t + p[0], 0) / ring.length - doorX, fy = ring.reduce((t, p) => t + p[1], 0) / ring.length - doorY, fl = Math.hypot(fx, fy) || 1;
    // (out of the door facing away from the building — the walk's forward is (−sin, cos) of the yaw)
    back.set("walkat", `${doorX.toFixed(2)},${doorY.toFixed(2)},${Math.atan2(fx / fl, -fy / fl).toFixed(3)}`);
    // (the buildings standing with it — within 30 m of it or of each other, 300 m round at most: a
    // hospital's or a campus's other blocks, for its ground floor as one — WalkPage keeps them only
    // for such a building)
    const campus = this.campusOf(ring, doorX, doorY);
    const q = new URLSearchParams({ enter: "1", lat, lon, heading: String(heading),
      foot: ring.slice(0, 60).map(([x, y]) => ll(x, y)).join(";"), back: location.pathname + "?" + back.toString() + location.hash });
    if (campus.length) q.set("campus", campus.map(r => r.slice(0, 40).map(([x, y]) => ll(x, y)).join(";")).join("|"));
    location.href = `/walk?${q}`;
    return true;
  }
  /** 1인칭 ↔ 3인칭. */
  toggleView() {
    this.view = this.view === "fpv" ? "chase" : "fpv";
    this.chaseYaw = this.flight.yaw;
    const c = this.p.camera;
    c.near = this.view === "chase" ? 0.05 : 0.15; c.updateProjectionMatrix();
    return this.view;
  }

  /** How far behind the third-person camera sits: on foot far enough back to see the walker whole
   * with the street round them. */
  private chaseWant() {
    const f = this.flight;
    return f.car ? f.car.length + 4 : f.cycling ? 6.5 : f.walking ? 6.0 : 3.6;
  }
  /** The line from (x, y, z) back to the camera at height angle `el`, in half-metre steps: how far
   * it goes before anything solid (the ground, a roof) — measured from the camera's own base height
   * (on foot 0.9 m over the eye), not the eye's. */
  private clearBehind(x: number, y: number, z: number, bx: number, bz: number, el: number, want: number) {
    const w = this.world;
    for (let s = 0.5; s <= want; s += 0.5) {
      const px = x + bx * Math.cos(el) * s, pz = z + bz * Math.cos(el) * s, py = y + Math.sin(el) * s;
      if (py < Math.max(w.groundAt(px, -pz), w.roofAt(px, -pz)) + 0.6) return Math.max(0.8, s - 0.5);
    }
    return want;
  }
  /** The third-person camera: behind the drone and a little above, its heading following the
   * drone's with a short lag (turns read as turns), its height angle from the camera tilt (a drag
   * looks down on it or up past it); pulled in where a wall or a tree is between them. */
  private chase(dt: number) {
    const f = this.flight, c = this.p.camera;
    const d = Math.atan2(Math.sin(f.yaw - this.chaseYaw), Math.cos(f.yaw - this.chaseYaw));
    this.chaseYaw += d * Math.min(1, dt * 5);
    const el0 = THREE.MathUtils.clamp(0.28 - f.tilt * 0.8, -0.15, 1.35);
    const bx = Math.sin(this.chaseYaw), bz = Math.cos(this.chaseYaw);   // behind: opposite the heading
    const want = this.chaseWant(), base = f.walking ? 0.9 : 0.35;
    let dist = this.clearBehind(f.pos.x, f.pos.y + base, f.pos.z, bx, bz, el0, want), lift = 0;
    // (on foot: a low wall, a fence or a canopy behind — the camera up over it, looking down on the
    // walker, before it is pulled in)
    if (f.walking && dist < want) for (let e = 0.15; e <= 0.75 && el0 + e <= 1.35; e += 0.15) {
      const d2 = this.clearBehind(f.pos.x, f.pos.y + base, f.pos.z, bx, bz, el0 + e, want);
      if (d2 >= want) { dist = d2; lift = e; break; }
    }
    this.chaseLift += (lift - this.chaseLift) * Math.min(1, dt * 4);
    const el = el0 + this.chaseLift;
    this.chaseDist += (dist - this.chaseDist) * Math.min(1, dt * (dist < this.chaseDist ? 20 : 3));
    const r = this.chaseDist;
    c.position.set(f.pos.x + bx * Math.cos(el) * r, f.pos.y + Math.sin(el) * r + 0.35, f.pos.z + bz * Math.cos(el) * r);
    c.lookAt(f.pos.x - bx * 6, f.pos.y + 0.25 - Math.sin(el) * 2.2, f.pos.z - bz * 6);
    if (f.walking && this.walker) {
      // (on foot or on the bike: the walker in view, not the drone — the camera higher and looking
      // down past them, so they stand in the middle of the picture, clear of the bar along the
      // bottom of the screen)
      this.model.group.visible = false; this.walker.root.visible = !f.car;
      if (f.car) this.placeCar();
      else if (f.cycling) this.placeRider(dt);
      else { this.walker.pose = "stand"; this.walker.root.position.set(f.pos.x, f.pos.y - EYE, f.pos.z); this.walker.root.rotation.set(0, f.yaw + Math.PI, 0); this.walker.update(dt, Math.hypot(f.vel.x, f.vel.z)); }
      const fx = -Math.sin(this.chaseYaw), fz = -Math.cos(this.chaseYaw);
      c.position.set(f.pos.x - fx * Math.cos(el) * r, f.pos.y + 0.9 + Math.sin(el) * r, f.pos.z - fz * Math.cos(el) * r);
      // (on foot or on the bike: looking at the walker's waist a step ahead — the whole figure, feet
      // and all, a little below the middle of the picture; in a car, at the road beyond the bonnet)
      if (f.car) c.lookAt(f.pos.x + fx * 9, f.pos.y - 1.2, f.pos.z + fz * 9);
      else c.lookAt(f.pos.x + fx * 1.6, f.pos.y - (f.cycling ? 0.9 : 0.75), f.pos.z + fz * 1.6);
      return;
    }
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
    if (this.walker) { this.walker.root.removeFromParent(); this.walker.dispose(); this.walker = null; }
    if (this.bikes) { this.bikes.dispose(); this.bikes = null; }
    if (this.car) { this.car.audio?.dispose(); this.car.mesh.removeFromParent(); this.car = null; }
    for (const m of this.parkedCars) m.removeFromParent(); this.parkedCars = [];
    void this.carCtx?.close(); this.carCtx = null;
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
