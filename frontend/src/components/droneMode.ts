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
import { applyViewFov, cameraControlsPaused, viewPreferences } from "../walkmode/viewPreferences";
import { rememberWalkEntry, walkAnchor, walkLink,type WalkEntry } from "../walkmode/walkLink";
import { EntranceLayer, ENTRANCE_SPEC, entranceKind, inRing, placeEntrance, ringArea, type Entrance } from "./droneEntrances";
import { GARAGE_BIKES, GARAGE_CARS, type GarageBike, type GarageCar } from "../walkmode/game/garage";
import { crashSound } from "../walkmode/game/CarAudio";
import { Sound } from "../walkmode/game/sound";
import { wallet } from "../walkmode/game/wallet";
import { missions } from "../walkmode/game/missions";

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
  /** where the walker's body faces: toward the way it goes (a step aside or back turns it), else its last heading */
  private bodyYaw: number | null = null;
  private chaseDist = 3.6;
  /** Kept level when the rear boom meets an obstacle. */
  private chaseLift = 0;
  private landedMoved = 0;
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
    applyViewFov(this.p.camera);
    this.feel(dt);
    if (!cameraControlsPaused()) f.step(dt, w);
    if (f.walking) this.landedMoved += f.moved;
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
    if (f.walking && performance.now() > this.entranceAt) { this.entranceAt = performance.now() + 900; this.layEntrances(); }
    if (f.walking) { this.stepEntrance(dt); this.navTick(dt); this.missionTick(); } else if (this.nav) this.clearNav();
    if (f.crash > 0) { this.onCrash(f.crash); f.crash = 0; }
    if (f.walking) this.pickups(dt); else if (this.coins) this.coins.mesh.visible = false;
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
  toggleCar(model?: GarageCar): string | null {
    const f = this.flight; if (!f.walking) return null;
    if (model && !this.car) return this.spawnCar(model);
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
  /** N's garage: the chosen car brought to the kerb beside the walker (the nearest lane within 40 m,
   * heading its way; else where they stand, the way they face) and got into, engine running */
  spawnCar(model: GarageCar): string | null {
    const f = this.flight; if (!f.walking) return null;
    if (this.car) this.toggleCar();
    if (f.cycling) this.toggleBike();
    const x = f.pos.x, y = -f.pos.z, l = this.world.lanePointNear(x, y, 40);
    const at = l ? { x: l.x - l.dy * (l.w / 2 - 1.2), y: l.y + l.dx * (l.w / 2 - 1.2), z: l.z, hx: l.dx, hy: l.dy } : { x: x - Math.sin(f.yaw) * 3, y: y + Math.cos(f.yaw) * 3, z: this.world.groundAt(x, y), hx: -Math.sin(f.yaw), hy: Math.cos(f.yaw) };
    const sp0 = CAR_SPECS[model.kind] ?? CAR_SPECS.sedan, sp = model.size ? { length: model.size[0], width: model.size[1], height: model.size[2] } : sp0;
    const prof = carProfile({ kind: model.kind, label: model.name, length: sp.length, width: sp.width, height: sp.height });
    // (the traffic's own modelled body of that kind and its paint shader; the drawn one before the kit is in)
    const body = this.world.traffic.modelOf(model.kind) ?? this.world.traffic.modelOf("sedan") ?? { geometry: carGeometry(model.kind) ?? carGeometry("sedan")!, material: carModelMaterial() };
    const mesh = new THREE.InstancedMesh(body.geometry, body.material, 1); mesh.frustumCulled = false; mesh.castShadow = true;
    mesh.setColorAt(0, new THREE.Color(model.paint)); if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.p.scene.add(mesh);
    const eyeY = Math.max(1.15, Math.min(2.6, prof.eye[1] + 0.25)), top = model.top;
    this.car = { mesh, kind: model.kind, top, audio: null, eyeY, label: model.name };
    const hl = Math.hypot(at.hx, at.hy) || 1;
    f.pos.x = at.x; f.pos.z = -at.y; f.yaw = Math.atan2(-at.hx / hl, at.hy / hl);
    f.setDriving({ top: top / 3.6, accel: prof.spec.accel * 1.25 * model.pull, brake: prof.spec.brake, wheelbase: prof.spec.wheelbase, lock: prof.spec.lock, length: sp.length, width: sp.width, eyeY }, 0);
    if (this.walker) this.walker.root.visible = false;
    const snd = this.sound();
    if (snd) void loadCarRecordings().then(() => { if (this.car?.mesh !== mesh) return; try { this.car.audio = new CarAudio(snd.ctx, snd.output, snd.noise, prof); playCarEffect("door", snd as unknown as Parameters<typeof playCarEffect>[1]); window.setTimeout(() => playCarEffect("ignition", snd as unknown as Parameters<typeof playCarEffect>[1]), 350); } catch { /* no recordings */ } });
    missions.event("garage"); this.topSent = 0;
    return `${model.name} · 최고 ${Math.round(top)}km/h`;
  }
  /** the garage's lists, for the page */
  readonly garage = { cars: GARAGE_CARS, bikes: GARAGE_BIKES };
  /** N's garage: a bicycle of this kind under the walker */
  spawnBike(model: GarageBike) {
    const f = this.flight; if (!f.walking) return false;
    if (this.car) this.toggleCar();
    f.bike = { top: model.top, accel: model.accel };
    if (!f.cycling) this.toggleBike();
    this.bikes?.paint(model.paint);
    return true;
  }
  // ---------------------------------------------------------------- coins in the street
  /** Play money lying about on the pavements round the walker (a dozen within 150 m, made again as
   * they go): walked, ridden or driven over, picked up — a chime, and the wallet's balance. */
  private coins: { mesh: THREE.InstancedMesh; at: { x: number; y: number; z: number; v: number }[]; t: number; next: number } | null = null;
  private pickups(dt: number) {
    const f = this.flight, x = f.pos.x, y = -f.pos.z;
    if (!this.coins) {
      const geo = new THREE.CylinderGeometry(0.28, 0.28, 0.06, 24).rotateX(Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({ color: "#ffd24a", emissive: "#ffb000", emissiveIntensity: 0.8, metalness: 0.9, roughness: 0.25 });
      const mesh = new THREE.InstancedMesh(geo, mat, 16); mesh.count = 0; mesh.frustumCulled = false; this.p.scene.add(mesh);
      this.coins = { mesh, at: [], t: 0, next: 0 };
    }
    const c = this.coins; c.mesh.visible = true; c.t += dt;
    // (gone too far from: dropped; too few: more on the nearest pavement lines, 30–150 m off)
    c.at = c.at.filter(p => Math.hypot(p.x - x, p.y - y) < 260);
    if (c.at.length < 12 && c.t > c.next) {
      c.next = c.t + 0.5;
      const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 120, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      const w = this.nearestWalk(px, py, 40);
      if (w && this.world.roofAt(w[0], w[1]) < this.world.groundAt(w[0], w[1]) + 0.5) c.at.push({ x: w[0], y: w[1], z: this.world.groundAt(w[0], w[1]), v: [500, 1000, 1000, 2000, 5000][Math.floor(Math.random() * 5)] });
    }
    const reach = f.car ? 3 : f.cycling ? 2 : 1.4, m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), at = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < c.at.length; i++) {
      const p = c.at[i];
      if (Math.hypot(p.x - x, p.y - y) < reach) { c.at.splice(i--, 1); this.collect(p.v); continue; }
      q.setFromAxisAngle(up, c.t * 3 + i);
      c.mesh.setMatrixAt(n++, m.compose(at.set(p.x, p.z + 0.9 + Math.sin(c.t * 2.5 + i) * 0.12, -p.y), q, one));
    }
    c.mesh.count = n; c.mesh.instanceMatrix.needsUpdate = true;
  }
  /** what the walker did this frame, for 오늘의 미션: metres on foot and on the bike, jumps, top speed */
  private walked = 0; private biked = 0; private wasAir = false; private topSent = 0;
  private missionTick() {
    const f = this.flight;
    if (f.car) { const kmh = Math.abs(f.carSpeed) * 3.6; if (kmh > this.topSent + 5) { this.topSent = kmh; missions.event("speed", kmh); } }
    else if (f.cycling) { this.biked += f.moved; if (this.biked >= 10) { missions.event("bike", Math.floor(this.biked)); this.biked %= 1; } }
    else { this.walked += f.moved; if (this.walked >= 10) { missions.event("walk", Math.floor(this.walked)); this.walked %= 1; } }
    const air = f.hop > 0.05; if (air && !this.wasAir) missions.event("jump"); this.wasAir = air;
  }
  private collect(v: number) {
    wallet.earn(v); missions.event("coin");
    const snd = this.sound();
    if (snd) for (const [k, fr] of [[0, 1318], [1, 1760]] as const) { const t = snd.ctx.currentTime + k * 0.09, o = snd.ctx.createOscillator(), g = snd.ctx.createGain(); o.type = "triangle"; o.frequency.value = fr; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35); o.connect(g); g.connect(snd.output); o.start(t); o.stop(t + 0.4); }
    window.dispatchEvent(new CustomEvent("drone-pickup", { detail: { amount: v } }));
  }
  private carRoll = 0; private carPitch = 0; private tmpM = new THREE.Matrix4(); private tmpR = new THREE.Matrix4(); private tmpE = new THREE.Euler();
  /** How it feels: the lens widening a little in a sprint and with speed (a car, a bike), and a
   * jump's landing — a thump. */
  private fovKick = 0; private wasHop = false;
  private lines: HTMLDivElement | null = null; private linesShown = 0;
  /** one composited layer over the canvas (no draw calls, no shader): a conic of thin streaks masked
   * to the edges, scaled outward on a loop; its opacity is the speed */
  private speedLines(k: number, calm = false) {
    if (Math.abs(k - this.linesShown) < 0.01 && (k > 0 || !this.lines)) return;
    if (!this.lines) {
      if (k <= 0) return;
      const d = document.createElement("div"); d.className = "drone-speedlines"; d.setAttribute("aria-hidden", "true");
      if (!document.getElementById("drone-speedlines-css")) {
        const st = document.createElement("style"); st.id = "drone-speedlines-css";
        st.textContent = ".drone-speedlines{position:fixed;inset:-6%;pointer-events:none;z-index:2;opacity:0;will-change:transform,opacity;background:repeating-conic-gradient(from 3deg at 50% 52%,rgba(255,255,255,0) 0deg 2.1deg,rgba(235,245,255,.75) 2.3deg,rgba(255,255,255,0) 2.6deg 4.9deg,rgba(235,245,255,.45) 5.05deg,rgba(255,255,255,0) 5.3deg 7.3deg);-webkit-mask-image:radial-gradient(ellipse 62% 58% at 50% 52%,transparent 55%,#000 100%);mask-image:radial-gradient(ellipse 62% 58% at 50% 52%,transparent 55%,#000 100%);animation:drone-speedlines .22s linear infinite}.drone-speedlines.calm{animation:none}@keyframes drone-speedlines{from{transform:scale(1) rotate(0deg)}to{transform:scale(1.07) rotate(.6deg)}}";
        document.head.appendChild(st);
      }
      document.body.appendChild(d); this.lines = d;
    }
    this.lines.classList.toggle("calm", calm); this.linesShown = k; this.lines.style.opacity = k.toFixed(3); this.lines.style.display = k > 0.005 ? "" : "none";
  }
  /** on foot and on the bike: footsteps on the paving, the bicycle's tyres, freewheel and brake */
  private fx: Sound | null = null; private stepAcc = 0; private wasCycling = false;
  private footSounds() {
    const f = this.flight;
    if (!f.walking) { if (this.wasCycling) { this.fx?.stopBicycle(); this.wasCycling = false; } return; }
    if (!this.fx) this.fx = new Sound();
    this.fx.resume();
    const k = f.keys, fwd = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) + Math.max(0, f.sticks.right[1]), back = (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) + Math.max(0, -f.sticks.right[1]);
    if (f.cycling) { this.fx.bicycle({ speed: f.bikeSpeed, pedal: Math.min(1, fwd), brake: Math.min(1, back) }); this.wasCycling = true; this.stepAcc = 0; return; }
    if (this.wasCycling) { this.fx.stopBicycle(); this.wasCycling = false; }
    if (f.car || f.hop > 0.02) return;
    // (a step each stride's half: longer strides running, longer still in a sprint)
    this.stepAcc += f.moved;
    const run = Math.hypot(f.vel.x, f.vel.z) > 3, len = f.sprinting ? 1.45 : run ? 1.1 : 0.78;
    if (this.stepAcc > len) { this.stepAcc = 0; this.fx.step("stone", run); }
  }
  private feel(dt: number) {
    const f = this.flight, c = this.p.camera;
    let want = 0;
    if (f.walking) want = f.car ? 9 * Math.min(1, Math.abs(f.carSpeed) / Math.max(10, f.car.top)) : f.cycling ? 6 * Math.min(1, f.bikeSpeed / Math.max(5, f.bike.top)) : f.sprinting ? 6 : 0;
    this.fovKick += (want - this.fovKick) * (1 - Math.exp(-dt * 3));
    this.footSounds();
    // (speed lines at the screen's edges, rushing outward: a car past ~40 km/h, a bike flat out)
    const sk = !f.walking ? 0 : f.car ? (Math.abs(f.carSpeed) - 11) / 22 : f.cycling ? (f.bikeSpeed - 7) / 10 : 0;
    // (with 움직임 줄이기 — the default — fainter and still, never rushing)
    const calm = viewPreferences().reduceMotion;
    this.speedLines(THREE.MathUtils.clamp(sk, 0, 1) * (calm ? 0.3 : 0.5), calm);
    if (this.fovKick > 0.05) { c.fov += this.fovKick; c.updateProjectionMatrix(); }
    const air = f.hop > 0.02;
    if (this.wasHop && !air && f.walking) {
      if (!f.car && !f.cycling) { this.fx?.step("stone", true); this.stepAcc = 0; }
      const snd = this.sound(); if (snd) { const t = snd.ctx.currentTime, o = snd.ctx.createOscillator(), g = snd.ctx.createGain(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.12); g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15); o.connect(g); g.connect(snd.output); o.start(t); o.stop(t + 0.16); }
    }
    this.wasHop = air;
  }
  /** a knock: the crunch (louder the harder), and the page's shake and flash */
  private crashAt = 0;
  private onCrash(v: number) {
    if (performance.now() - this.crashAt < 350 || v < 3) return;
    this.crashAt = performance.now();
    const snd = this.sound(); if (snd) crashSound(snd.ctx, snd.output, Math.min(1.5, v / 14), !!this.car);
    window.dispatchEvent(new CustomEvent("drone-crash", { detail: { level: Math.min(1, v / 20), car: !!this.car } }));
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
    // (the body on its springs: leaning out of a turn, the nose dipping under the brakes and lifting
    // under the throttle — eased, a few degrees at most)
    const v0 = Math.abs(f.carSpeed), wantRoll = -f.steer * Math.min(1, v0 / 25) * 0.055, wantPitch = (f.braking || f.handbrake ? 0.03 : 0) - f.throttle * Math.min(1, v0 / 15) * 0.012;
    this.carRoll += (wantRoll - this.carRoll) * 0.12; this.carPitch += (wantPitch - this.carPitch) * 0.1;
    if (Math.abs(this.carRoll) + Math.abs(this.carPitch) > 0.001) {
      const m = this.tmpM; c.mesh.getMatrixAt(0, m);
      m.multiply(this.tmpR.makeRotationFromEuler(this.tmpE.set(this.carPitch, 0, this.carRoll)));
      c.mesh.setMatrixAt(0, m); c.mesh.instanceMatrix.needsUpdate = true;
    }
    const v = Math.abs(f.carSpeed), gears = [0.12, 0.24, 0.40, 0.59, 0.79, 1].map(x => x * f.car!.top);
    // (revs: the share of this gear's top — a shift drops them to the next gear's ratio, about 55–75 %,
    // never back to idle; the tyres squeal in a hard turn at speed and on the handbrake)
    const slip = Math.abs(f.steer) * Math.min(1, Math.max(0, v - 8) / 14) * 0.9 + (f.handbrake && v > 3 ? 0.85 : 0);
    let revs = 1; for (const g of gears) if (v <= g) { revs = Math.max(0.12, v / g); break; }
    c.audio?.update(revs, f.throttle, f.carSpeed, f.braking, slip, this.view === "fpv");
    // (the knock itself is onCrash's: the crunch, the shake)
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
    if (on) { this.landedAt = performance.now(); this.landedMoved = 0; }
    // (on foot the walker is seen: third person to start with — V still changes it)
    if (on && this.view === "fpv") this.toggleView();
    if (on && !this.walker) { this.walker = new Avatar(0); this.p.scene.add(this.walker.root); }
    if (this.walker) this.walker.root.visible = false;
    this.audio.pause(on);
    return on;
  }
  // ---------------------------------------------------------------- entrances
  private entrances: EntranceLayer | null = null;
  private entranceAt = 0;
  private entranceCache = new Map<[number, number][], Entrance[]>();
  /** tall blocks traced from the roofs (no register outline): their outlines, kept while near */
  private blocks: { ring: [number, number][]; c: [number, number]; x0: number; y0: number; x1: number; y1: number }[] = [];
  private tracedBlocks(x: number, y: number, known: [number, number][][]): [number, number][][] {
    const w = this.world;
    this.blocks = this.blocks.filter(b => Math.hypot(b.c[0] - x, b.c[1] - y) < 260);
    const inside = (px: number, py: number) => known.some(r => inRing(px, py, r)) || this.blocks.some(b => px >= b.x0 - 1 && px <= b.x1 + 1 && py >= b.y0 - 1 && py <= b.y1 + 1 && inRing(px, py, b.ring));
    let traced = 0;
    for (let r = 8; r <= 110 && traced < 3; r += 8) for (let k = 0, n = Math.max(8, Math.round(r * 0.8)); k < n && traced < 3; k++) {
      const a = (k / n) * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      // (a block of flats or an office slab: over 8 m tall here)
      if (w.roofAt(px, py) - w.groundAt(px, py) < 8 || inside(px, py)) continue;
      traced++;
      const ring = this.traceRaw(px, py, 6);
      if (!ring || ringArea(ring) < 120 || ringArea(ring) > 12000) { this.blocks.push({ ring: [[px - 2, py - 2], [px + 2, py - 2], [px + 2, py + 2], [px - 2, py + 2]], c: [px, py], x0: px - 2, y0: py - 2, x1: px + 2, y1: py + 2 }); continue; }
      const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
      this.blocks.push({ ring, c: [xs.reduce((t, v) => t + v, 0) / xs.length, ys.reduce((t, v) => t + v, 0) / ys.length], x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
    }
    if (this.blocks.length > 240) this.blocks.splice(0, this.blocks.length - 240);
    return this.blocks.filter(b => b.ring.length > 4 && Math.hypot(b.c[0] - x, b.c[1] - y) < 130).map(b => b.ring);
  }
  private standsBehind(e: Entrance) {
    const w = this.world;
    for (const d of [1.2, 2.5, 4]) { const px = e.x - e.nx * d, py = e.y - e.ny * d; if (w.roofAt(px, py) - w.groundAt(px, py) > 2.2) return true; }
    return false;
  }
  /** A block of flats' 공동현관s: a long slab has one for each core (about every 28 m along its
   * front), all on the side its first door faces; any other building its one entrance. */
  entrancesFor(ring: [number, number][]): Entrance[] {
    const e = this.entranceFor(ring); if (!e) return [];
    if (e.kind !== "apartment") return [e];
    // (the front's extent: the outline's corners on the door's wall line)
    const along = ring.map(p => ({ t: (p[0] - e.x) * e.tx + (p[1] - e.y) * e.ty, n: (p[0] - e.x) * e.nx + (p[1] - e.y) * e.ny })).filter(q => Math.abs(q.n) < 3);
    if (along.length < 2) return [e];
    const t0 = Math.min(...along.map(q => q.t)), t1 = Math.max(...along.map(q => q.t)), L = t1 - t0;
    const n = Math.max(1, Math.min(5, Math.round(L / 28)));
    if (n < 2) return [e];
    const out: Entrance[] = [];
    for (let i = 0; i < n; i++) {
      const t = t0 + (L * (i + 0.5)) / n, q: Entrance = { ...e, key: `${e.key}#${i}`, x: e.x + e.tx * t, y: e.y + e.ty * t };
      q.z = this.world.groundAt(q.x + q.nx * 0.6, q.y + q.ny * 0.6);
      this.snapToFacade(q); out.push(q);
    }
    return out;
  }
  /** Every building within 110 m of the walker given its entrance (kept per outline while it lasts). */
  private layEntrances() {
    const f = this.flight, x = f.pos.x, y = -f.pos.z, w = this.world;
    if (!this.entrances) { this.entrances = new EntranceLayer(); this.p.scene.add(this.entrances.group); }
    // (one building is often outlined twice — the place's register outline and the tile's surveyed one
    // it is drawn from, larger: the entrance goes on the outermost, the one whose walls are seen)
    const all = w.buildingRingsNear(x, y, 110), info = all.map(r => ({ r, a: ringArea(r), c: [r.reduce((t, p) => t + p[0], 0) / r.length, r.reduce((t, p) => t + p[1], 0) / r.length] as [number, number] }));
    const rings = info.filter(q => !info.some(o => o !== q && o.a > q.a * 1.05 && inRing(q.c[0], q.c[1], o.r))).map(q => q.r);
    // (blocks drawn only from a tile's surveyed models — a neighbouring complex's 동 with no register
    // outline — traced from their roofs, a few a pass, so they have their doors before they are reached)
    rings.push(...this.tracedBlocks(x, y, rings));
    const list: Entrance[] = [], seen = new Set<string>();
    for (const ring of rings) {
      let es = this.entranceCache.get(ring);
      if (es === undefined) { es = this.entrancesFor(ring); this.entranceCache.set(ring, es); }
      // (one building's outline held by several sources — the place's own, the view's, a tile's — has one set of entrances)
      // (only where a building actually stands behind the doors: an outline with nothing drawn on it
      // — a block not yet loaded, one gone — gets no doors standing alone in a field)
      for (const e of es) if (!seen.has(e.key) && this.standsBehind(e)) { seen.add(e.key); list.push(e); }
      if (list.length > 220) break;
    }
    if (this.entranceCache.size > 3000) this.entranceCache.clear();
    // (the doors that move: the entrance being gone into, else the nearest within 14 m)
    const near = this.entering?.e ?? list.reduce<Entrance | null>((b, e) => { const d = Math.hypot(e.x - x, e.y - y); return d < 14 && (!b || d < Math.hypot(b.x - x, b.y - y)) ? e : b; }, null);
    this.entrances.set(list, near);
    this.entrances.nameSigns(x, y);
  }
  // ---------------------------------------------------------------- going in
  /** Going in through an entrance: walked to its doors, which slide open, and through them, the
   * picture fading meanwhile; then the interior. The walker's keys wait while it lasts. */
  private entering: { t: number; e: Entrance; from: [number, number]; front: [number, number]; inside: [number, number]; d1: number; meta: Partial<WalkEntry>; done: boolean } | null = null;
  private stepEntrance(dt: number) {
    const f = this.flight, L = this.entrances;
    const en = this.entering, here: [number, number] = [f.pos.x, -f.pos.z];
    const act = L?.activeEntrance;
    const at = act ? Math.hypot(act.x + act.nx - here[0], act.y + act.ny - here[1]) < 4.2 : false;
    if (L?.doors(dt, !!en || (at && !f.car))) this.whoosh();
    if (!en) return;
    en.t += dt; f.keys.clear();
    // (the walk's forward is (−sin yaw, cos yaw): facing in, along −n)
    const e = en.e, inward = Math.atan2(e.nx, -e.ny);
    let p: [number, number], v = 0;
    if (en.t < en.d1) { const k = en.t / en.d1, s = k * k * (3 - 2 * k); p = [en.from[0] + (en.front[0] - en.from[0]) * s, en.from[1] + (en.front[1] - en.from[1]) * s]; v = Math.hypot(en.front[0] - en.from[0], en.front[1] - en.from[1]) / en.d1; }
    // (at the doors: they open, and a slow step up to the threshold — never past the facade; the
    // picture is black before the threshold is reached, then the interior)
    else { const k = Math.min(1, (en.t - en.d1) / 1.3), s2 = k * (2 - k); p = [en.front[0] + (en.inside[0] - en.front[0]) * s2, en.front[1] + (en.inside[1] - en.front[1]) * s2]; v = 0.6 * (1 - k); }
    // (facing the doors from the moment it starts; the eye at walking height over the paving)
    const g = this.world.groundAt(p[0], p[1]);
    f.pos.x = p[0]; f.pos.z = -p[1]; f.pos.y = g + EYE + 0.02; f.yaw += Math.atan2(Math.sin(inward - f.yaw), Math.cos(inward - f.yaw)) * Math.min(1, dt * 8);
    f.vel.set(-Math.sin(f.yaw) * v, 0, -Math.cos(f.yaw) * v);
    if (en.t >= en.d1 + 1.3 && !en.done) { en.done = true; this.openInside(e.ring, e.x + e.nx * 1.2, e.y + e.ny * 1.2, Math.atan2(-e.ny, -e.nx), en.meta); }
  }
  // ---------------------------------------------------------------- the way to an entrance
  /** Shown on the ground: glowing chevrons every 2 m along the shortest way on foot round the
   * buildings (A* on a 1 m grid of open ground), made again if the walker strays 8 m from it;
   * cleared on arrival, where E goes in. */
  private nav: { e: Entrance; mesh: THREE.InstancedMesh; path: [number, number][]; t: number; check: number } | null = null;
  navTo(e?: Entrance | null): boolean {
    const f = this.flight; if (!f.walking) return false;
    if (!e) {
      // (X: the nearest way in — the building faced first, else any within 250 m)
      const L = this.entrances; if (!L) return false;
      const x = f.pos.x, y = -f.pos.z;
      e = (f.door ? L.of(f.door.ring) ?? this.entranceFor(f.door.ring) : null) ?? L.entrances.reduce<Entrance | null>((b, q) => !b || Math.hypot(q.x - x, q.y - y) < Math.hypot(b.x - x, b.y - y) ? q : b, null);
      if (!e) return false;
    }
    const path = this.walkRoute([f.pos.x, -f.pos.z], [e.x + e.nx * 1.6, e.y + e.ny * 1.6]);
    this.clearNav();
    if (!path) { f.nav = { label: `${e.name ?? ENTRANCE_SPEC[e.kind].label}: 걸어서 가는 길을 찾지 못했어요`, left: -1 }; window.setTimeout(() => { if (!this.nav && f.nav?.left === -1) f.nav = null; }, 2500); return false; }
    const pts: [number, number][] = [];
    for (let i = 0; i + 1 < path.length; i++) { const a = path[i], b = path[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = i === 0 ? 1.5 : 0; t < l; t += 2) pts.push([a[0] + (b[0] - a[0]) * t / l, a[1] + (b[1] - a[1]) * t / l]); }
    const shape = new THREE.Shape([new THREE.Vector2(-0.45, -0.3), new THREE.Vector2(0, 0.15), new THREE.Vector2(0.45, -0.3), new THREE.Vector2(0.45, -0.05), new THREE.Vector2(0, 0.45), new THREE.Vector2(-0.45, -0.05)]);
    const geo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: "#5ef0ff", transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, pts.length)); mesh.frustumCulled = false; mesh.renderOrder = 4;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), at = new THREE.Vector3();
    pts.forEach((p, i) => {
      const n = pts[Math.min(pts.length - 1, i + 1)], pr = pts[Math.max(0, i - 1)], dx = n[0] - pr[0], dy = n[1] - pr[1];
      // (the chevron's tip — +y of its shape, −z after the turn down — toward the way ahead, x east / y north)
      q.setFromAxisAngle(up, Math.atan2(-dx, dy));
      const deck = this.world.roadZ(p[0], p[1]);
      mesh.setMatrixAt(i, m.compose(at.set(p[0], Math.max(this.world.groundAt(p[0], p[1]), deck ?? -Infinity) + 0.12, -p[1]), q, one));
    });
    mesh.count = pts.length; mesh.instanceMatrix.needsUpdate = true;
    this.p.scene.add(mesh);
    this.nav = { e, mesh, path, t: 0, check: 0 };
    f.nav = { label: e.name ? `${e.name} ${ENTRANCE_SPEC[e.kind].label}` : ENTRANCE_SPEC[e.kind].label, left: this.navLeft() };
    return true;
  }
  clearNav() {
    const n = this.nav; if (!n) return;
    n.mesh.removeFromParent(); n.mesh.geometry.dispose(); (n.mesh.material as THREE.Material).dispose(); n.mesh.dispose();
    this.nav = null; this.flight.nav = null;
  }
  private navLeft() {
    const n = this.nav!, x = this.flight.pos.x, y = -this.flight.pos.z;
    let best = 0, bd = Infinity; n.path.forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = i; } });
    let left = bd; for (let i = best; i + 1 < n.path.length; i++) left += Math.hypot(n.path[i + 1][0] - n.path[i][0], n.path[i + 1][1] - n.path[i][1]);
    return left;
  }
  private navTick(dt: number) {
    const n = this.nav; if (!n) return;
    n.t += dt; (n.mesh.material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.35 * Math.sin(n.t * 4);
    const f = this.flight, x = f.pos.x, y = -f.pos.z, e = n.e;
    if (this.entering) { this.clearNav(); return; }
    if (Math.hypot(e.x + e.nx - x, e.y + e.ny - y) < 4) { this.clearNav(); missions.event("guide"); return; }
    if ((n.check += dt) > 1) {
      n.check = 0;
      const left = this.navLeft();
      // (strayed off the way: a new one from here)
      const off = n.path.reduce((m, p, i) => i + 1 < n.path.length ? Math.min(m, distSeg(x, y, p, n.path[i + 1])) : m, Infinity);
      if (off > 8) { this.navTo(e); return; }
      if (f.nav) f.nav = { ...f.nav, left };
    }
  }
  /** the shortest way on foot from a to b round the buildings: A* on a 1 m grid (8 ways, no corner
   * cutting), open where no roof stands over the ground; then straightened where the line is clear */
  private walkRoute(a: [number, number], b: [number, number]): [number, number][] | null {
    // (room round both ends to go about a large building — a hospital's blocks span 200 m)
    const w = this.world, C = 1, pad = 120;
    const x0 = Math.min(a[0], b[0]) - pad, y0 = Math.min(a[1], b[1]) - pad, nx = Math.ceil((Math.max(a[0], b[0]) + pad - x0) / C), ny = Math.ceil((Math.max(a[1], b[1]) + pad - y0) / C);
    if (nx * ny > 640 * 640) return null;
    const state = new Uint8Array(nx * ny);
    const free = (k: number) => { if (state[k]) return state[k] === 1; const px = x0 + (k % nx + 0.5) * C, py = y0 + (Math.floor(k / nx) + 0.5) * C; const ok = w.roofAt(px, py) <= w.groundAt(px, py) + 0.8; state[k] = ok ? 1 : 2; return ok; };
    const cell = (x: number, y: number) => Math.max(0, Math.min(nx - 1, Math.floor((x - x0) / C))) + Math.max(0, Math.min(ny - 1, Math.floor((y - y0) / C))) * nx;
    const near = (x: number, y: number) => { const c0 = cell(x, y); if (free(c0)) return c0; for (let r = 1; r < 8; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue; const ci = c0 % nx + i, cj = Math.floor(c0 / nx) + j; if (ci < 0 || cj < 0 || ci >= nx || cj >= ny) continue; const k = ci + cj * nx; if (free(k)) return k; } return -1; };
    const s = near(...a), t = near(...b); if (s < 0 || t < 0) return null;
    const g = new Float32Array(nx * ny).fill(Infinity), came = new Int32Array(nx * ny).fill(-1), closed = new Uint8Array(nx * ny);
    const tx = t % nx, ty = Math.floor(t / nx), h = (k: number) => Math.hypot(k % nx - tx, Math.floor(k / nx) - ty);
    const hf: number[] = [], hk: number[] = [];
    const push = (fv: number, k: number) => { let i = hf.length; hf.push(fv); hk.push(k); while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= fv) break; hf[i] = hf[p]; hk[i] = hk[p]; i = p; } hf[i] = fv; hk[i] = k; };
    const pop = () => { const top = hk[0], lf = hf.pop()!, lk = hk.pop()!, n = hf.length; if (n) { let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = -1, mf = lf; if (l < n && hf[l] < mf) { m = l; mf = hf[l]; } if (r < n && hf[r] < mf) m = r; if (m < 0) break; hf[i] = hf[m]; hk[i] = hk[m]; i = m; } hf[i] = lf; hk[i] = lk; } return top; };
    g[s] = 0; push(h(s), s);
    let found = false, steps = 0;
    while (hf.length && steps++ < 420000) {
      const k = pop(); if (closed[k]) continue; closed[k] = 1; if (k === t) { found = true; break; }
      const i = k % nx, j = Math.floor(k / nx);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue; const ai = i + di, aj = j + dj; if (ai < 0 || aj < 0 || ai >= nx || aj >= ny) continue;
        const q = ai + aj * nx; if (closed[q] || !free(q)) continue;
        if (di && dj && (!free(i + di + j * nx) || !free(i + (j + dj) * nx))) continue;
        const ng = g[k] + (di && dj ? Math.SQRT2 : 1); if (ng < g[q]) { g[q] = ng; came[q] = k; push(ng + h(q), q); }
      }
    }
    if (!found) return null;
    const cells: [number, number][] = [];
    for (let k = t; k >= 0; k = came[k]) { cells.push([x0 + (k % nx + 0.5) * C, y0 + (Math.floor(k / nx) + 0.5) * C]); if (k === s) break; }
    cells.reverse();
    const clear = (p: [number, number], q: [number, number]) => { const l = Math.hypot(q[0] - p[0], q[1] - p[1]); for (let d = 0; d <= l; d += 0.5) if (!free(cell(p[0] + (q[0] - p[0]) * d / l, p[1] + (q[1] - p[1]) * d / l))) return false; return true; };
    const out: [number, number][] = [a]; let i = 0;
    while (i < cells.length - 1) { let j = cells.length - 1; while (j > i + 1 && !clear(cells[i], cells[j])) j--; out.push(cells[j]); i = j; }
    out.push(b);
    return out;
  }
  /** a sliding door's air and motor */
  private whoosh() {
    const snd = this.sound(); if (!snd) return;
    const c = snd.ctx, t = c.currentTime, len = Math.floor(c.sampleRate * 0.8), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = b;
    const fl = c.createBiquadFilter(); fl.type = "bandpass"; fl.Q.value = 0.8; fl.frequency.setValueAtTime(500, t); fl.frequency.exponentialRampToValueAtTime(1600, t + 0.6);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
    const o = c.createOscillator(), og = c.createGain(); o.frequency.value = 120; og.gain.setValueAtTime(0.02, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    src.connect(fl); fl.connect(g); g.connect(snd.output); o.connect(og); og.connect(snd.output); src.start(t); o.start(t); src.stop(t + 0.8); o.stop(t + 0.62);
  }
  /** start going in at entrance `e` (from wherever the walker is: from afar, set down 6 m before it) */
  private goIn(e: Entrance, meta: Partial<WalkEntry> = {}) {
    if (this.entering) return true;
    const f = this.flight, here: [number, number] = [f.pos.x, -f.pos.z];
    // (a big building's revolving drum stands in the middle: in through the sliding doors beside it)
    const drum = e.kind === "hospital" || e.kind === "office" || e.kind === "store" || e.kind === "civic", side = drum ? (e.w / 2 + Math.min(3.2, e.w * 0.38) / 2) / 2 : 0;
    const ux = e.tx * side, uy = e.ty * side;
    // (the walk ends at the threshold, just outside the glass: the building is entered by the cut to
    // its interior, not by walking through its wall)
    const front: [number, number] = [e.x + ux + e.nx * 1.4, e.y + uy + e.ny * 1.4], inside: [number, number] = [e.x + ux + e.nx * 0.45, e.y + uy + e.ny * 0.45];
    // (walked there only along open ground: never through a wall or round a corner of the building —
    // from afar, or with anything solid between, set down 6 m before the doors facing them)
    const w = this.world, open = (a: [number, number], b: [number, number]) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 0; t <= l; t += 0.4) { const px = a[0] + (b[0] - a[0]) * t / l, py = a[1] + (b[1] - a[1]) * t / l; if (w.roofAt(px, py) > w.groundAt(px, py) + 0.8) return false; } return true; };
    let from = here;
    if (!f.walking || Math.hypot(here[0] - front[0], here[1] - front[1]) > 9 || !open(here, front)) {
      // (set down before the doors on open ground with a clear walk to them and a clear view back:
      // not inside a wing of the building that stands out past the entrance)
      const solid = (q: [number, number]) => w.roofAt(q[0], q[1]) > w.groundAt(q[0], q[1]) + 0.8;
      from = [front[0] + e.nx * 4.6, front[1] + e.ny * 4.6];
      for (const d of [4.6, 3.6, 5.6, 2.6, 7, 8.5, 10, 1.6]) {
        const q: [number, number] = [front[0] + e.nx * d, front[1] + e.ny * d], cam: [number, number] = [q[0] + e.nx * 5, q[1] + e.ny * 5];
        if (!solid(q) && open(q, front) && open(q, cam)) { from = q; break; }
      }
    }
    const d1 = Math.max(0.5, Math.min(3, Math.hypot(from[0] - front[0], from[1] - front[1]) / 2.4));
    this.entering = { t: 0, e, from, front, inside, d1, meta: { ...meta, name: meta.name || undefined }, done: false };
    missions.event("enter");
    this.entrances?.set(this.entrances.entrances.includes(e) ? this.entrances.entrances : [...this.entrances.entrances, e], e);
    if (this.view === "fpv" && f.walking) this.toggleView();
    window.dispatchEvent(new CustomEvent("drone-entering", { detail: { label: e.name ? `${e.name} · ${ENTRANCE_SPEC[e.kind].label}` : ENTRANCE_SPEC[e.kind].label, after: d1, cut: from !== here } }));
    return true;
  }
  /** the entrance of one building: its kind from the map's names in it and its size and height */
  entranceFor(ring: [number, number][]): Entrance | null {
    if (ring.length < 3) return null;
    const w = this.world, cx = ring.reduce((t, p) => t + p[0], 0) / ring.length, cy = ring.reduce((t, p) => t + p[1], 0) / ring.length;
    const area = ringArea(ring), R = Math.sqrt(area) / 2 + 30;
    const names = this.signs.labelsNear(cx, cy, R).filter(l => inRing(l.x, l.y, ring) || Math.hypot(l.x - cx, l.y - cy) < Math.sqrt(area) / 2 + 8).map(l => ({ name: l.name, kind: l.kind }));
    const height = Math.max(0, w.roofAt(cx, cy) - w.groundAt(cx, cy));
    // (the slab's slenderness: its outline's long side over its short, from the bounding box along its longest edge)
    let best = 0, ux = 1, uy = 0;
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > best) { best = l; ux = (b[0] - a[0]) / l; uy = (b[1] - a[1]) / l; } }
    const us = ring.map(p => p[0] * ux + p[1] * uy), vs = ring.map(p => -p[0] * uy + p[1] * ux), L1 = Math.max(...us) - Math.min(...us), L2 = Math.max(...vs) - Math.min(...vs);
    const aptNear = this.signs.labelsNear(cx, cy, Math.sqrt(area) / 2 + 45).some(l => l.kind === "apt");
    const kind = entranceKind(names, area, height, { aptNear, slender: Math.max(L1, L2) / Math.max(1, Math.min(L1, L2)) });
    const lane = w.lanePointNear(cx, cy, 160), walk = this.nearestWalk(cx, cy, 80);
    const toward: [number, number] | null = walk ?? (lane ? [lane.x, lane.y] : null);
    const e = placeEntrance(ring, kind, toward, (px, py) => w.groundAt(px, py), `${cx.toFixed(1)},${cy.toFixed(1)}`);
    if (e) this.snapToFacade(e);
    // (its name for the sign: a label inside its outline first, of the kind it is if there are several)
    // (a building's own name: not a block number, nor a service point's label — an ambulance bay, a car park, a bike dock)
    const named = names.filter(n => n.name && !/^\d+동$/.test(n.name) && !/^(service|er|parking|bike|cctv|exit|subway|train|station)$/.test(n.kind) && !/\p{Extended_Pictographic}|구급차|주차|정류장|출구/u.test(n.name));
    if (e && named.length) e.name = (named.find(n => kind === "hospital" ? n.kind === "hospital" || /병원/.test(n.name) : kind === "school" ? n.kind === "school" : kind === "civic" ? n.kind === "gov" : true) ?? named[0]).name;
    return e;
  }
  /** The entrance moved onto the facade as drawn: a level ray from 12 m out toward the wall at eye
   * height, against the world's buildings (not instanced things); the first wall within 6 m outside
   * the outline or 1 m inside it is where the doors go. */
  private ray = new THREE.Raycaster();
  private snapToFacade(e: Entrance) {
    const R = 18, o = new THREE.Vector3(e.x + e.nx * R, e.z + 1.6, -(e.y + e.ny * R)), dir = new THREE.Vector3(-e.nx, 0, e.ny);
    this.ray.set(o, dir); this.ray.far = R + 1.2;
    let best = Infinity;
    const hits: THREE.Intersection[] = [];
    this.world.root.traverse(m => {
      const mesh = m as THREE.Mesh; if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || !mesh.visible || !mesh.geometry) return;
      hits.length = 0; try { mesh.raycast(this.ray, hits); } catch { return; }
      for (const h of hits) if (h.distance < best) best = h.distance;
    });
    if (!Number.isFinite(best)) return;
    const out = R - best;   // (+: the drawn wall stands this far outside the outline)
    if (!(out > -1 && out < 14) || Math.abs(out) <= 0.15) return;
    // (far out, only a wall of this same building: solid all the way back from it to the outline —
    // a separate building in front has open ground between)
    if (out > 4) { const w = this.world; for (let d = out - 0.4; d > 0.3; d -= 0.5) { const px = e.x + e.nx * d, py = e.y + e.ny * d; if (w.roofAt(px, py) <= w.groundAt(px, py) + 0.8) return; } }
    e.x += e.nx * out; e.y += e.ny * out; e.z = this.world.groundAt(e.x + e.nx * 0.6, e.y + e.ny * 0.6);
  }
  private nearestWalk(x: number, y: number, r: number): [number, number] | null {
    let best: [number, number] | null = null, bd = r;
    for (const pk of this.world.walkPathsNear(x, y, r)) for (let o = 0; o < pk.length;) { const n = pk[o++]; for (let k = 0; k < n; k++) { const px = pk[o + k * 2], py = pk[o + k * 2 + 1], d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = [px, py]; } } o += n * 2; }
    return best;
  }
  /** On foot, a building ahead within 3 m (or beside, within 1.5 m): which, and where its wall is. */
  private findDoor() {
    const f = this.flight; if (!f.walking || f.cycling || f.car) { f.door = null; return; }
    // (an entrance within 4.5 m: in through it — the door is where its doors are)
    const near = this.entrances?.nearest(f.pos.x, -f.pos.z, 4.5);
    if (near) { const e = near.e; f.door = { ring: e.ring, x: e.x + e.nx * 0.2, y: e.y + e.ny * 0.2, label: ENTRANCE_SPEC[e.kind].label, at: true, name: e.name }; return; }
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
        if (!ring || ring.length < 3) { f.door = null; return; }
        // (at a wall away from its entrance: the way in shown and how far; E still goes in, at the entrance)
        const e = this.entrances?.of(ring) ?? this.entranceFor(ring);
        f.door = e ? { ring, x: e.x + e.nx * 0.2, y: e.y + e.ny * 0.2, label: ENTRANCE_SPEC[e.kind].label, at: false, far: Math.round(Math.hypot(e.x - x, e.y - y)) } : { ring, x: px, y: py };
        return;
      }
    }
    f.door = null;
  }
  private doorAt = 0;
  /** set down at once, before the buildings round were in: for 15 s after, a walker found inside a
   * building (its outline, its roof over them) is moved to the nearest open ground outside it */
  private landedAt = 0;
  private settle() {
    // Only recover a bad landing while the user has not started walking. Late roof tiles must
    // never teleport a running player back out of a building every 200 ms.
    const f = this.flight; if (!f.walking || f.car || this.landedMoved > .15 || performance.now() - this.landedAt > 15000) return;
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
    const ring = this.traceRaw(x, y, 0.8);
    if (ring) this.traced = { x, y, ring };
    return ring;
  }
  /** the hull of the roof cells joined to (x, y) that stand more than `above` m over the ground */
  private traceRaw(x: number, y: number, above: number): [number, number][] | null {
    const w = this.world, up = (qx: number, qy: number) => w.roofAt(qx, qy) > w.groundAt(qx, qy) + above;
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
    return lo.slice(0, -1).concat(hi.slice(0, -1));
  }
  /** In through the door: the building's interior (평면도 기반: its register, its floors, its
   * businesses; a block of flats by its flats) on the walk page, back here on leaving. */
  enterDoor(): boolean {
    const d = this.flight.door; if (!d) return false;
    // (at an entrance: gone in through its doors, facing in, whichever way the walker stood)
    const e = d.label ? this.entrances?.of(d.ring) ?? this.entranceFor(d.ring) : null;
    if (e) {
      if (!this.entrances) { this.entrances = new EntranceLayer(); this.p.scene.add(this.entrances.group); }
      // (at a wall away from the doors: the way there shown — E again at the doors goes in)
      if (!d.at && Math.hypot(e.x - this.flight.pos.x, e.y + this.flight.pos.z) > 9) return this.navTo(e);
      // (named public buildings — a hospital, a school, a store — go in as buildings, no unit chooser)
      return this.goIn(e, { kind: e.kind === "apartment" ? "apartment" : e.name && /hospital|school|civic|store|museum|station/.test(e.kind) ? "building" : undefined, name: e.name });
    }
    return this.openInside(d.ring, this.flight.pos.x, -this.flight.pos.z, Math.atan2(Math.cos(this.flight.yaw), -Math.sin(this.flight.yaw)) + Math.PI);
  }
  /** 내부 탐험 from a building's card (its sign): straight in, wherever the drone or the walker is —
   * its outline surveyed or traced from the roofs, the door on its side nearest the viewer */
  enterBuildingAt(x: number, y: number,metadata:Partial<WalkEntry>={}): boolean {
    const ring = this.world.buildingRingAt(x, y) ?? this.traceRoof(x, y);
    if (!ring || ring.length < 3) return false;
    // (straight in at its entrance — the drawing's way in on the street side)
    const ent = this.entranceFor(ring);
    // (on foot: walked in through it, its doors opening; flying: straight in)
    if (ent && this.flight.walking) { if (!this.entrances) { this.entrances = new EntranceLayer(); this.p.scene.add(this.entrances.group); } return this.goIn(ent, metadata); }
    if (ent) return this.openInside(ring, ent.x + ent.nx * 1.2, ent.y + ent.ny * 1.2, Math.atan2(-ent.ny, -ent.nx), metadata);
    const vx = this.flight.pos.x, vy = -this.flight.pos.z;
    let best: [number, number] = ring[0], bd = Infinity;
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((vx - a[0]) * dx + (vy - a[1]) * dy) / l2)), p: [number, number] = [a[0] + dx * t, a[1] + dy * t], d = Math.hypot(p[0] - vx, p[1] - vy); if (d < bd) { bd = d; best = p; } }
    const cx = ring.reduce((t, p) => t + p[0], 0) / ring.length, cy = ring.reduce((t, p) => t + p[1], 0) / ring.length;
    // (the door a step outside the wall, facing in)
    const ox = best[0] - cx, oy = best[1] - cy, ol = Math.hypot(ox, oy) || 1;
    return this.openInside(ring, best[0] + ox / ol * 1.5, best[1] + oy / ol * 1.5, Math.atan2(oy, ox),metadata);
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
  private openInside(ring: [number, number][], doorX: number, doorY: number, heading: number,metadata:Partial<WalkEntry>={}): boolean {
    const c = this.p.data.center; if (!c) return false;
    const kx = Math.cos(c.lat * Math.PI / 180) * 111_320, ky = 110_540;
    const ll = (x: number, y: number): [number, number] => [c.lon + x / kx, c.lat + y / ky];
    const back = new URLSearchParams(location.search);
    // (out again in front of this building: where the door was, facing it)
    const fx = ring.reduce((t, p) => t + p[0], 0) / ring.length - doorX, fy = ring.reduce((t, p) => t + p[1], 0) / ring.length - doorY, fl = Math.hypot(fx, fy) || 1;
    // (out of the door facing away from the building — the walk's forward is (−sin, cos) of the yaw)
    back.set("walkat", `${doorX.toFixed(2)},${doorY.toFixed(2)},${Math.atan2(fx / fl, -fy / fl).toFixed(3)}`);
    // (the buildings standing with it — within 30 m of it or of each other, 300 m round at most: a
    // hospital's or a campus's other blocks, for its ground floor as one — WalkPage keeps them only
    // for such a building)
    const campus = this.campusOf(ring, doorX, doorY);
    const foot = ring.map(([x, y]) => ll(x, y)), [lat, lon] = walkAnchor(foot);
    rememberWalkEntry({ lat, lon, foot, campus: campus.map(r => r.map(([x, y]) => ll(x, y))),
      door: ll(doorX, doorY), heading, name:metadata.name??'',floors:metadata.floors??0,kind:metadata.kind,use:metadata.use,dong:metadata.dong,pnu:metadata.pnu,complexId:metadata.complexId,back: location.pathname + "?" + back.toString() + location.hash });
    location.href = walkLink(lat, lon, 1, metadata);
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
    const extra = f.car ? Math.min(3.5, Math.abs(f.carSpeed) * 0.07) : f.cycling ? Math.min(1.8, f.bikeSpeed * 0.12) : f.walking && f.sprinting ? 0.8 : 0;
    return ((f.car ? f.car.length + 4 : f.cycling ? 6.5 : f.walking ? 6.0 : 3.6) + extra) * viewPreferences().distance;
  }
  /** The line from (x, y, z) back to the camera at height angle `el`, in half-metre steps: how far
   * it goes before anything solid (the ground, a roof), at the camera's own pivot height. */
  private clearBehind(x: number, y: number, z: number, bx: number, bz: number, el: number, want: number) {
    const w = this.world, walking = this.flight.walking;
    const step = walking ? .1 : .5;
    for (let s = step; s <= want; s += step) {
      const px = x + bx * Math.cos(el) * s, pz = z + bz * Math.cos(el) * s, py = y + Math.sin(el) * s, g = w.groundAt(px, -pz);
      // (on the ground what stops the boom is a building's wall — inside a surveyed outline, or a
      // roof over 6 m — not a kerb, a canopy edge or the roof raster running past a wall)
      let top = g;
      if (walking) { const roof = w.roofAt(px, -pz); if (roof - g > 0.8 && (roof - g > 6 || w.buildingRingAt(px, -pz))) top = roof; }
      else top = Math.max(g, w.roofAt(px, -pz));
      if (py < top + (walking ? 0.3 : 0.6)) return Math.max(walking ? 0.3 : 0.8, s - step);
    }
    return want;
  }
  /** Behind the body on foot, on the bike or in a car: the boom at the wanted height angle if it is
   * clear; else raised (up to ~60°) to look over what is behind, the longest clear one taken; never
   * pulled in so close that the view becomes the body's own eye, unless a wall is right behind. */
  private boom(x: number, y: number, z: number, yaw: number, el0: number, want: number): { el: number; side: number; dist: number } {
    // (the wanted place first; then a little to either side and higher, still at full distance — a
    // lamp post, a corner or a rise behind is looked past, not zoomed into; the one nearest the wanted)
    let best = { el: el0, side: 0, dist: 0 };
    for (const lift of [0, 0.16, 0.34]) for (const side of [0, 0.28, -0.28, 0.55, -0.55]) {
      const el = Math.min(1.0, el0 + lift), a = yaw + side, d = this.clearBehind(x, y, z, Math.sin(a), Math.cos(a), el, want);
      if (d >= want - 0.05) return { el, side, dist: want };
      if (d > best.dist + 0.3) best = { el, side, dist: d };
    }
    // (blocked every way by the coarse grid: back as far as the real drawn walls allow — chase()
    // asks them — never closer than 2.4 m from the body)
    return { el: best.el, side: best.side, dist: Math.max(best.dist, Math.min(want, 2.4)) };
  }
  /** The third-person camera: behind the drone and a little above, its heading following the
   * drone's with a short lag (turns read as turns), its height angle from the camera tilt (a drag
   * looks down on it or up past it); pulled in where a wall or a tree is between them. */
  private boomEl = 0.28; private boomSide = 0; private blockedFor = 0;
  /** The buildings as drawn (the tiles' registered and surveyed buildings, the view's own): the
   * camera boom tested against their real faces, so it can never sit inside a wall the coarse roof
   * grid misses. Ten times a second; the meshes near gathered once a second. */
  private wallMeshes: THREE.Mesh[] = []; private wallAt = 0; private wallHit = { t: 0, d: Infinity, x: 0, z: 0 };
  private wallRay(x: number, y: number, z: number, bx: number, bz: number, el: number, want: number): number {
    const now = performance.now();
    if (now - this.wallAt > 1000) {
      this.wallAt = now; this.wallMeshes = [];
      const view = this.p.viewBuildings?.()?.group, near = new THREE.Vector3(x, y, z), sph = new THREE.Sphere();
      const take = (root: THREE.Object3D) => root.traverse(o => {
        const m = o as THREE.Mesh; if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || !m.geometry) return;
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        sph.copy(m.geometry.boundingSphere!).applyMatrix4(m.matrixWorld);
        if (sph.distanceToPoint(near) < 40) this.wallMeshes.push(m);
      });
      this.world.root.traverse(o => { if (/registered buildings|surveyed|drone view tile/.test(o.name)) take(o); });
      if (view) take(view);
    }
    // (a fresh ray only every 100 ms or after moving a metre; between, the last answer)
    if (now - this.wallHit.t > 100 || Math.hypot(x - this.wallHit.x, z - this.wallHit.z) > 1) {
      const dir = new THREE.Vector3(bx * Math.cos(el), Math.sin(el), bz * Math.cos(el));
      this.ray.set(new THREE.Vector3(x, y, z), dir); this.ray.far = want + 0.5;
      let d = Infinity; const hits: THREE.Intersection[] = [];
      for (const m of this.wallMeshes) { if (!m.visible) continue; hits.length = 0; try { m.raycast(this.ray, hits); } catch { continue; } for (const h of hits) if (h.distance < d) d = h.distance; }
      this.wallHit = { t: now, d, x, z };
    }
    // (kept a little in front of the face; still never into the body's own eye)
    return Number.isFinite(this.wallHit.d) ? Math.max(0.7, this.wallHit.d - 0.4) : want;
  }
  private chase(dt: number) {
    const f = this.flight, c = this.p.camera;
    const d = Math.atan2(Math.sin(f.yaw - this.chaseYaw), Math.cos(f.yaw - this.chaseYaw));
    // On foot, on the bike or in a car the camera stays behind: it follows the heading closely, and
    // a jump of the heading (a turn on the spot, out of a door, a car brought round, a cut to an
    // entrance) is taken at once rather than swung round past the side or the front.
    if (f.walking) this.chaseYaw = Math.abs(d) > 1.6 ? f.yaw : this.chaseYaw + d * (1 - Math.exp(-dt * (f.car ? 7 : 9)));
    else this.chaseYaw += d * (1 - Math.exp(-dt * (viewPreferences().reduceMotion ? 14 : 5)));
    // (and from a little above: looking up or down tilts it within a band, never under the ground
    // nor straight overhead)
    const el0 = f.walking ? THREE.MathUtils.clamp(0.28 - f.tilt * 0.8, f.car ? 0.1 : 0.12, f.car ? 0.5 : 0.62) : THREE.MathUtils.clamp(0.28 - f.tilt * 0.8, -0.15, 1.35);
    const want = this.chaseWant(), base = f.walking ? (f.car ? .9 : .65) : .35;
    const fit = f.walking ? this.boom(f.pos.x, f.pos.y + base, f.pos.z, this.chaseYaw, el0, want) : { el: el0, side: 0, dist: this.clearBehind(f.pos.x, f.pos.y + base, f.pos.z, Math.sin(this.chaseYaw), Math.cos(this.chaseYaw), el0, want) };
    // (the raised angle and the swing to the side eased in and out, not jumped)
    const ease = 1 - Math.exp(-dt * 5);
    this.boomEl += ((f.walking ? fit.el : el0) - this.boomEl) * ease;
    this.boomSide += ((f.walking ? fit.side : 0) - this.boomSide) * ease;
    const camYaw = this.chaseYaw + this.boomSide, bx = Math.sin(camYaw), bz = Math.cos(camYaw);   // behind: opposite the heading
    // (the real drawn walls: the boom kept in front of them, but no nearer the body than 2 m)
    const wall = f.walking ? this.wallRay(f.pos.x, f.pos.y + base, f.pos.z, bx, bz, this.boomEl, fit.dist) : Infinity;
    let dist = Math.min(fit.dist, f.walking ? Math.max(2, wall) : Infinity);
    // (a block must last a moment before the camera comes in — a post or a branch flicking by is
    // not a wall; then it comes in smoothly, and goes back out smoothly)
    if (dist < this.chaseDist - 0.3) { this.blockedFor += dt; if (this.blockedFor < 0.18 && dist > 1.2) dist = this.chaseDist; } else this.blockedFor = 0;
    // Obstacles retract the boom without automatically pitching the user's view up and down.
    this.chaseLift = 0;
    const el = el0 + this.chaseLift;
    this.chaseDist += (dist - this.chaseDist) * (1 - Math.exp(-dt * (dist < this.chaseDist ? 9 : 2.5)));
    // (the near plane with the boom: far enough out that the depth buffer keeps facades and their
    // windows apart — 5 cm against 9 km made close walls flicker)
    const wantNear = f.walking ? THREE.MathUtils.clamp(this.chaseDist * 0.18, 0.3, 1.0) : 0.1;
    if (Math.abs(c.near - wantNear) > 0.03) { c.near = wantNear; c.updateProjectionMatrix(); }
    const r = this.chaseDist;
    c.position.set(f.pos.x + bx * Math.cos(el) * r, f.pos.y + Math.sin(el) * r + 0.35, f.pos.z + bz * Math.cos(el) * r);
    c.lookAt(f.pos.x - bx * 6, f.pos.y + 0.25 - Math.sin(el) * 2.2, f.pos.z - bz * 6);
    if (f.walking && this.walker) {
      // (on foot or on the bike: the walker in view, not the drone — the camera higher and looking
      // down past them, so they stand in the middle of the picture, clear of the bar along the
      // bottom of the screen)
      this.model.group.visible = false; this.walker.root.visible = !f.car && r > 1.15;
      if (f.car) this.placeCar();
      else if (f.cycling) this.placeRider(dt);
      else {
        const sp = Math.hypot(f.vel.x, f.vel.z);
        if (this.bodyYaw === null) this.bodyYaw = f.yaw;
        if (sp > 0.25) { const t = Math.atan2(-f.vel.x, -f.vel.z), d = Math.atan2(Math.sin(t - this.bodyYaw), Math.cos(t - this.bodyYaw)); this.bodyYaw += d * (1 - Math.exp(-dt * 12)); }
        this.walker.pose = "stand"; this.walker.air = f.hop > 0.05; this.walker.root.position.set(f.pos.x, f.pos.y - EYE, f.pos.z); this.walker.root.rotation.set(0, this.bodyYaw + Math.PI, 0);
        this.walker.cadence = sp > 4.5 ? 0.92 : 1;
        this.walker.update(dt, sp);
      }
      if (f.car || f.cycling) this.bodyYaw = f.yaw;
      const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
      // Keep one pivot and one pitch as the boom retracts. Scaling the whole offset by a
      // near-wall blend, then aiming at another moving point, caused 20-degree frame jumps.
      const eb = this.boomEl;
      c.position.set(f.pos.x - fx * Math.cos(eb) * r, f.pos.y + base + Math.sin(eb) * r, f.pos.z - fz * Math.cos(eb) * r);
      // (never inside the ground behind — a slope rising there)
      const under = this.world.groundAt(c.position.x, -c.position.z) + 0.45;
      if (c.position.y < under) c.position.y = under;
      // (on foot or on the bike: looking at the walker's waist a step ahead — the whole figure, feet
      // and all, a little below the middle of the picture; in a car, at the road beyond the bonnet)
      // (aimed at the body itself — the pivot over the walker or rider, the road past the car's bonnet —
      // so a camera lifted over a rise behind still has them in frame, never below it)
      const lifted = c.position.y - (f.pos.y + base + Math.sin(eb) * r);
      if (f.car) c.lookAt(f.pos.x + fx * 9, f.pos.y - 1.2 + lifted * 0.6, f.pos.z + fz * 9);
      else { const px = f.pos.x, py = f.pos.y + base, pz = f.pos.z, dx = px - c.position.x, dy = py - c.position.y, dz = pz - c.position.z, l = Math.hypot(dx, dy, dz) || 1; c.lookAt(px + dx / l * 3, py + dy / l * 3, pz + dz / l * 3); }
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
    this.fx?.stopBicycle(); this.fx?.close(); this.fx = null;
    this.lines?.remove(); this.lines = null;
    this.p.forget?.(new Set(this.cctv.materials()));
    this.cctv.dispose();
    this.p.forget?.(new Set(this.live.materials()));
    this.live.dispose();
    this.world.dispose();
    this.p.forget?.(new Set(this.model.materials()));
    this.model.dispose();
    if (this.walker) { this.walker.root.removeFromParent(); this.walker.dispose(); this.walker = null; }
    if (this.bikes) { this.bikes.dispose(); this.bikes = null; }
    this.clearNav();
    this.entrances?.dispose(); this.entrances = null; this.entranceCache.clear();
    if (this.coins) { this.coins.mesh.removeFromParent(); this.coins.mesh.geometry.dispose(); (this.coins.mesh.material as THREE.Material).dispose(); this.coins.mesh.dispose(); this.coins = null; }
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

function distSeg(x: number, y: number, a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}
