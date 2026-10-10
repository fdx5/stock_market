import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { originAt, toLonLat, type Origin } from "../world/geo";
import { makeMaterials, type Materials } from "../world/materials";
import { World } from "../world/World";
import { Traffic, type Kind } from "../traffic/Traffic";
import { loadCarModels, carModelMaterial, carLampMap } from "../vehicle/cars";
import { coupangTruck, cybertruck, type HeroShape } from "../vehicle/heroes";
import { SPECS, Vehicle, IDLE, type Controls, type VehicleName } from "../vehicle/physics";
import { Input, type Action } from "./Input";
import { cockpit } from "../vehicle/cockpit";
import type {SurfaceRailLayer} from '../../rail/SurfaceRailLayer';

/* The drive game: its own renderer, world, traffic and vehicle — nothing shared with the 3D
 * building view but static files. A fixed 120 Hz clock drives the vehicle; the world streams in
 * workers and comes on screen a mesh a frame; the frame's own work is kept small. */

export type TimeOfDay = "day" | "sunset" | "night";
export interface GameOptions {
  canvas: HTMLCanvasElement; lat: number; lon: number; key: string; domain: string; apiBase: string;
  vehicle: VehicleName; time: TimeOfDay; quality: "high" | "standard";
  onAction?(a: Action): void;
  onProgress?(text: string, share: number): void;
}
export interface Frame {
  speed: number; gear: string; revs: number; x: number; y: number; hx: number; hy: number; dt: number;
  bump: number; bumpHit: string | null; slip: number; boosting: boolean; braking: boolean;
}

const PASSENGER_PAINT = ["#f7f7f5", "#f7f7f5", "#ecebe6", "#ecebe6", "#6b6e72", "#4a4d51", "#141518", "#141518", "#141518", "#b9bcc0", "#223a5e", "#3d5f86", "#7a1c22", "#c8bca6", "#5a4336"];
const KIND_TABLE: [string, number, number, string[] | null][] = [
  ["sedan", 12, 1, PASSENGER_PAINT], ["sedan-large", 8, 1, PASSENGER_PAINT], ["sedan-sports", 8, 1.06, PASSENGER_PAINT], ["suv", 10, 1, PASSENGER_PAINT],
  ["suv-small", 8, 1.02, PASSENGER_PAINT], ["suv-luxury", 6, 1, PASSENGER_PAINT], ["hatchback-sports", 5, 1.02, PASSENGER_PAINT], ["kei-box", 4, 1, PASSENGER_PAINT],
  ["taxi", 8, 1, ["#e8772a", "#f2f2f0", "#c9ccd0"]], ["mpv", 5, 0.98, PASSENGER_PAINT], ["van", 3, 0.95, ["#f4f4f2", "#c9ccd0", "#2d5fa8"]],
  ["cargo", 4, 0.9, ["#2d5fa8", "#e9e9e6"]], ["boxtruck", 3, 0.9, ["#f4f4f2", "#e9e9e6"]], ["bus", 4, 0.8, ["#2a6fc4", "#3b9a44", "#2a6fc4"]],
  ["container", 1, 0.8, ["#b2402f", "#2e5e8c"]], ["garbage", 1, 0.75, ["#3f8f4e"]], ["mixer", 1, 0.75, ["#e8e6e0"]],
];

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.3, 2600);
  readonly origin: Origin;
  world!: World; traffic!: Traffic; vehicle!: Vehicle; mats!: Materials;
  input: Input;
  private sun = new THREE.DirectionalLight("#fff3e0", 3.2);
  private hemi = new THREE.HemisphereLight("#cfe2ff", "#5b5348", 1.1);
  private sky = new Sky();
  private heroMesh!: THREE.Mesh; private heroWheels!: THREE.InstancedMesh; private hero!: HeroShape;
  private headlight: THREE.SpotLight | null = null;
  private cab: ReturnType<typeof cockpit> | null = null;
  private raf = 0; private last = 0; private acc = 0; private worldAt = 0;
  private prev = { x: 0, y: 0, hx: 1, hy: 0 };
  private z = 0; private zPrev = 0; private pitch = 0; private roll = 0; private spin = 0;
  private camAt = new THREE.Vector3(); private camEye = new THREE.Vector3(); private camInit = false;
  view: "chase" | "cockpit" = "chase";
  /** the hardest knock of this frame's physics steps */
  lastHit: { bump: number; what: string | null; car: import("../vehicle/physics").Body | null } = { bump: 0, what: null, car: null };
  /** (tests) the vehicle passes through traffic */
  ghost = false;
  paused = false; running = false; frozen = false;
  /** the controls this frame (the game's rules may override: a wreck, an empty tank) */
  controlFilter: ((c: Controls) => Controls) | null = null;
  route: Float32Array | null = null;
  /** called each display frame with the vehicle's state, after the step */
  onFrame: ((f: Frame) => void) | null = null;
  /** per frame extras (missions, effects): seconds */
  ticks: ((dt: number) => void)[] = [];
  perf = { frames: 0, worst: 0, over20: 0, over33: 0, sum: 0, renderMs: 0, cpuMs: 0, intervals: [] as number[], long: [] as { at: number; gap: number; seg: Record<string, number> }[] };
  private seg: Record<string, number> = {};
  private mark(name: string, t0: number) { const t = performance.now(); this.seg[name] = (this.seg[name] ?? 0) + t - t0; return t; }
  look = { yaw: 0, pitch: 0, held: false };
  private disposed = false;
  private rail?: SurfaceRailLayer;
  private frameNo = 0;
  private frustum = new THREE.Frustum(); private pm = new THREE.Matrix4();

  constructor(private o: GameOptions) {
    this.origin = originAt(o.lat, o.lon);
    this.renderer = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: true, powerPreference: "high-performance", stencil: false });
    // (the full resolution: the frame budget is met by keeping the frame's work small, not by
    // drawing fewer pixels)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, o.quality === "high" ? 2 : 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.82;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.input = new Input(a => this.action(a));
    this.setupSky();
  }

  private setupSky() {
    const t = this.o.time;
    this.sky.scale.setScalar(4500);
    const u = this.sky.material.uniforms;
    u.turbidity.value = t === "sunset" ? 6 : 3.2; u.rayleigh.value = t === "night" ? 0.2 : t === "sunset" ? 2.6 : 1.3;
    u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.85;
    const elev = t === "day" ? 42 : t === "sunset" ? 4 : -12, azim = t === "day" ? 205 : 250;
    const phi = THREE.MathUtils.degToRad(90 - elev), theta = THREE.MathUtils.degToRad(azim);
    const dir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(dir);
    this.scene.add(this.sky);
    this.sunDir.copy(dir.y > 0.05 ? dir : new THREE.Vector3(-0.3, 0.6, 0.4).normalize());
    const fog = t === "day" ? "#c4d1dd" : t === "sunset" ? "#d7b59a" : "#1a2333";
    this.scene.fog = new THREE.Fog(fog, 420, 1350);
    this.scene.background = new THREE.Color(fog);
    this.sun.color.set(t === "day" ? "#fff4e2" : t === "sunset" ? "#ffb27a" : "#9fb4d8");
    this.sun.intensity = t === "day" ? 2.6 : t === "sunset" ? 1.7 : 0.22;
    this.hemi.intensity = t === "day" ? 0.55 : t === "sunset" ? 0.4 : 0.32;
    this.hemi.color.set(t === "night" ? "#5f74a0" : "#cfe2ff");
    this.sun.castShadow = true;
    const hq = this.o.quality === "high";
    this.sun.shadow.mapSize.set(hq ? 4096 : 2048, hq ? 4096 : 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 10; sc.far = 900;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    // reflections: the sky itself, once
    const pm = new THREE.PMREMGenerator(this.renderer), sk = new THREE.Scene();
    const sky2 = new Sky(); sky2.scale.setScalar(4500);
    Object.assign(sky2.material.uniforms.turbidity, { value: u.turbidity.value }); sky2.material.uniforms.rayleigh.value = u.rayleigh.value;
    sky2.material.uniforms.sunPosition.value.copy(dir);
    sk.add(sky2);
    const env = pm.fromScene(sk, 0.02).texture;
    this.scene.environment = env;
    this.scene.environmentIntensity = t === "night" ? 0.2 : t === "sunset" ? 0.35 : 0.5;
    sky2.material.dispose(); sky2.geometry.dispose(); pm.dispose();
  }
  private sunDir = new THREE.Vector3();

  /** Load everything, stream the start's surroundings, put the vehicle on a road there. */
  async start() {
    const o = this.o, progress = (t: string, k: number) => o.onProgress?.(t, k);
    progress("재질과 차량을 준비합니다", 0.05);
    const [mats, models] = await Promise.all([makeMaterials(), loadCarModels()]);
    this.mats = mats;
    mats.setNight(o.time === "night" ? 1 : o.time === "sunset" ? 0.45 : 0);
    if (this.disposed) return;
    // traffic kinds from the modelled cars
    const carMat = carModelMaterial();
    // (their head and tail lamps lit from dusk)
    carMat.emissiveMap = carLampMap(); carMat.emissive.set("#ffffff");
    carMat.emissiveIntensity = o.time === "night" ? 3 : o.time === "sunset" ? 1.2 : 0;
    const kinds: Kind[] = [];
    for (const [name, weight, speed, paint] of KIND_TABLE) {
      const g = models.get(name);
      if (!g) continue;
      g.computeBoundingBox();
      const b = g.boundingBox!;
      kinds.push({ name, geo: g, length: b.max.z - b.min.z, width: b.max.x - b.min.x, speed, weight, paint });
    }
    this.traffic = new Traffic(kinds, carMat, o.quality === "high" ? 140 : 90);
    this.traffic.target = o.quality === "high" ? 85 : 55;
    this.scene.add(this.traffic.group);
    this.world = new World({
      origin: this.origin, key: o.key, domain: o.domain, apiBase: o.apiBase, scene: this.scene, mats,
      onRoads: (added, removed) => { if (removed.length) this.traffic.graph.remove(removed); if (added.length) this.traffic.graph.add(added); },
    });
    progress("지형과 도로를 불러옵니다", 0.12);
    await this.world.init();
    if (this.disposed) return;
    void import('../../rail/SurfaceRailLayer').then(({SurfaceRailLayer})=>{
      if(this.disposed)return;
      this.rail=new SurfaceRailLayer({origin:this.origin,heightAt:(x,y)=>this.world.heightAt(x,y)});
      this.scene.add(this.rail.group);
    }).catch(()=>{});
    // the vehicle
    this.makeHero(o.vehicle);
    this.vehicle = new Vehicle(SPECS[o.vehicle], 0, 0, 0, {
      others: (x, y, r) => (this.ghost ? [] : this.traffic.near(x, y, r)),
      building: pts => !this.ghost && this.world.buildingAt(pts) > 0,
      pole: (x, y, hx, hy, hl, hw) => !this.ghost && this.world.poleIn(x, y, hx, hy, hl, hw),
    });
    this.traffic.setPlayer(this.vehicle.body);
    // stream the surroundings, drawing meanwhile
    this.running = true; this.frozen = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    const t0 = performance.now();
    for (;;) {
      await new Promise(r => setTimeout(r, 120));
      if (this.disposed) return;
      this.world.update(0, 0, 1, 0, 0);
      const k = this.world.readiness(0, 0, 320);
      progress(`주변 지역을 불러옵니다 · ${Math.round(k * 100)}%`, 0.15 + k * 0.75);
      if ((k >= 0.999 && this.world.backlog === 0) || performance.now() - t0 > 40000) break;
    }
    // on the nearest road, heading along it
    const hit = this.traffic.graph.nearest(0, 0, 400, true) ?? this.traffic.graph.nearest(0, 0, 400, false);
    if (hit) {
      const e = this.traffic.graph.edges[hit.edge], p = this.traffic.graph.at(e, hit.d, { x: 0, y: 0, h: 0, ux: 0, uy: 0 });
      const off = (Math.min(1, this.traffic.graph.lanesOf(e) - 1) + 0.5) * this.traffic.graph.laneW(e);
      this.vehicle.place(p.x + p.uy * off, p.y - p.ux * off, Math.atan2(p.uy, p.ux));
    }
    this.prev = { x: this.vehicle.body.x, y: this.vehicle.body.y, hx: this.vehicle.body.hx, hy: this.vehicle.body.hy };
    this.z = this.zPrev = this.world.surfaceAt(this.vehicle.body.x, this.vehicle.body.y) || 0;
    progress("셰이더를 준비합니다", 0.93);
    this.placeCamera(1, true);
    await this.prepare?.();
    await this.warmUp();
    progress("출발!", 1);
    this.frozen = false;
  }
  /** (set by the game's rules: their objects made before the warm-up) */
  prepare: (() => Promise<void> | void) | null = null;
  /** Objects whose materials must be compiled before the drive (effects, pickups…). */
  warmExtras: THREE.Object3D[] = [];

  /** Every material the drive can show, in every form it is drawn in (plain and instanced, lit
   * and in the sun's shadow pass), compiled now behind the loading screen — none later, mid-drive. */
  /** The shadow pass draws every caster with one depth material unless it has its own; switching
   * that one between instanced, batched and plain meshes (and instances with and without colours)
   * set its program up again at each switch (~9 a frame, ~1 ms on a slow phone). Instanced and
   * batched meshes get theirs, one per kind. */
  private depthOf = new Map<string, THREE.MeshDepthMaterial>();
  private instancedDepth() {
    this.scene.traverse(o => {
      const im = o as THREE.InstancedMesh, bm = o as THREE.BatchedMesh;
      if (!(im.isInstancedMesh || bm.isBatchedMesh) || !im.castShadow) return;
      const m = Array.isArray(im.material) ? im.material[0] : im.material;
      const key = bm.isBatchedMesh ? `batch|${m.alphaTest > 0}` : `${!!im.instanceColor}|${m.alphaTest > 0}`;
      if (im.userData.depthKey === key) return;
      let d = this.depthOf.get(key);
      if (!d) { d = new THREE.MeshDepthMaterial(); this.depthOf.set(key, d); }
      im.customDepthMaterial = d; im.userData.depthKey = key;
    });
  }
  private async warmUp() {
    const m = this.mats, tri = new THREE.BufferGeometry();
    tri.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0.3, 0, 0, 0, 0.3, 0], 3));
    tri.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    tri.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    tri.setAttribute("color", new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
    const plain = [m.ground, m.water, m.asphalt, m.walks, m.marks, m.concrete, m.roofs, ...Object.values(m.facades)];
    const inst = [m.lampPost, m.crown, m.pool];
    const group = new THREE.Group();
    // (the tiles' surfaces are drawn as batches: their programs are the batched ones)
    for (const mat of plain) { const o = new THREE.BatchedMesh(1, 3, 3, mat); o.addInstance(o.addGeometry(tri)); o.castShadow = o.receiveShadow = true; o.frustumCulled = false; group.add(o); }
    for (const mat of inst) { const o = new THREE.InstancedMesh(tri, mat, 1); o.setMatrixAt(0, new THREE.Matrix4()); o.castShadow = o.receiveShadow = true; group.add(o); }
    // in front of the camera (frustum culling would skip them), out of the shadow camera's way
    const cam = this.camera, dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    group.position.copy(cam.position).addScaledVector(dir, 2);
    group.lookAt(cam.position);
    const extras = this.warmExtras.map(o => ({ o, parent: o.parent, vis: o.visible }));
    const hidden: { o: THREE.Object3D; vis: boolean }[] = [];
    for (const { o } of extras) { o.visible = true; o.traverse(c => { if (!c.visible) { hidden.push({ o: c, vis: c.visible }); c.visible = true; } }); group.add(o); }
    // (the traffic's instances: at least one drawn)
    const counts: [THREE.InstancedMesh, number][] = [];
    this.traffic.group.traverse(c => { const im = c as THREE.InstancedMesh; if (im.isInstancedMesh && im.count === 0) { counts.push([im, 0]); im.count = 1; } });
    this.scene.add(group);
    this.instancedDepth();
    try {
      await this.renderer.compileAsync(this.scene, cam);
      // one real frame: the shadow pass's depth programs too
      this.renderer.render(this.scene, cam);
    } finally {
      for (const [im, n] of counts) im.count = n;
      for (const h of hidden) h.o.visible = h.vis;
      for (const { o, parent, vis } of extras) { o.visible = vis; if (parent) parent.add(o); else o.removeFromParent(); }
      group.removeFromParent();
      tri.dispose();
    }
  }

  private makeHero(name: VehicleName) {
    const h = this.hero = name === "coupang" ? coupangTruck() : cybertruck();
    const boxMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });
    this.heroMesh = new THREE.Mesh(h.geometry, [boxMat, h.material]);
    this.heroMesh.castShadow = this.heroMesh.receiveShadow = true;
    this.heroMesh.matrixAutoUpdate = false;
    // (its own material: one shared by an instanced and a plain mesh is set up again for each)
    this.heroWheels = new THREE.InstancedMesh(h.wheel, boxMat.clone(), h.wheels.length);
    this.heroWheels.castShadow = this.heroWheels.receiveShadow = true; this.heroWheels.frustumCulled = false;
    this.scene.add(this.heroMesh, this.heroWheels);
    if (this.o.time !== "day") {
      // its own head and tail lamps lit (children of the body: they follow it)
      const white = new THREE.MeshBasicMaterial({ color: "#fff6e6", toneMapped: false }), red = new THREE.MeshBasicMaterial({ color: "#c8140a", toneMapped: false });
      for (const l of h.lamps) { const b = new THREE.Mesh(new THREE.BoxGeometry(l.w, l.h, 0.03), l.red ? red : white); b.position.set(l.x, l.y, l.z + (l.z > 0 ? 0.02 : -0.02)); this.heroMesh.add(b); }
    }
    if (this.o.time !== "day") {
      // the vehicle's own headlamps on the road ahead
      const s = new THREE.SpotLight("#fff2d8", this.o.time === "night" ? 3200 : 1200, 110, 0.6, 0.55, 2);
      s.castShadow = false;
      this.headlight = s;
      this.scene.add(s, s.target);
    }
  }

  private action(a: Action) {
    if (a === "view") this.view = this.view === "chase" ? "cockpit" : "chase";
    this.o.onAction?.(a);
  }

  /** The vehicle's pose drawn at fraction `a` between the last two physics steps. */
  private pose(a: number) {
    const b = this.vehicle.body, p = this.prev;
    const x = p.x + (b.x - p.x) * a, y = p.y + (b.y - p.y) * a;
    let hx = p.hx + (b.hx - p.hx) * a, hy = p.hy + (b.hy - p.hy) * a; const l = Math.hypot(hx, hy) || 1; hx /= l; hy /= l;
    return { x, y, hx, hy, z: this.zPrev + (this.z - this.zPrev) * a };
  }

  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const cpu0 = performance.now();
    const dtRaw = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(0.1, Math.max(0, dtRaw));
    if (!this.frozen && this.running) {
      this.perf.frames++; this.perf.sum += dtRaw * 1000; this.perf.worst = Math.max(this.perf.worst, dtRaw * 1000);
      if (dtRaw * 1000 > 20) this.perf.over20++; if (dtRaw * 1000 > 33.4) this.perf.over33++;
      if (this.perf.intervals.length < 20000) this.perf.intervals.push(+(dtRaw * 1000).toFixed(2));
    }
    // (where a long frame's time went: kept for the frames after a long gap)
    if (dtRaw * 1000 > 30 && !this.frozen && this.perf.long.length < 200) this.perf.long.push({ at: Math.round(now), gap: Math.round(dtRaw * 1000), seg: { ...this.seg } });
    this.seg = {};
    let t = cpu0;
    let ctl = this.paused || this.frozen ? IDLE : this.input.read(dt);
    if (this.controlFilter) ctl = this.controlFilter(ctl);
    const v = this.vehicle;
    const H = 1 / 120;
    if (v && !this.paused) {
      this.acc = Math.min(this.acc + dt, H * 12);
      let bump = 0, hit: string | null = null;
      this.lastHit = { bump: 0, what: null, car: null };
      while (this.acc >= H) {
        this.prev.x = v.body.x; this.prev.y = v.body.y; this.prev.hx = v.body.hx; this.prev.hy = v.body.hy;
        v.step(H, ctl);
        if (v.bump > bump) { bump = v.bump; hit = v.bumpHit; this.lastHit = { bump, what: v.bumpHit, car: v.bumpCar }; }
        this.acc -= H;
      }
      t = this.mark("physics", t);
      // height on the ground or a deck (kept where the tile isn't in)
      this.zPrev = this.z;
      const s = this.world.surfaceAt(v.body.x, v.body.y, this.z);
      if (Number.isFinite(s)) this.z += (s - this.z) * Math.min(1, dt * 20);
      const a = this.acc / H, p = this.pose(a);
      this.drawHero(p, dt);
      t = this.mark("hero", t);
      this.traffic.update(this.frozen ? 0 : dt, p.x, p.y, (x, y) => this.inView(x, y));
      t = this.mark("traffic", t);
      if (!this.frozen) for (const f of this.ticks) f(dt);
      t = this.mark("session", t);
      this.onFrame?.({ speed: v.body.speed, gear: v.gearLabel, revs: v.revsShare, x: p.x, y: p.y, hx: p.hx, hy: p.hy, dt, bump, bumpHit: hit, slip: v.slip, boosting: v.boosting, braking: v.braking });
      this.placeCamera(dt, false, p);
      if (now - this.worldAt > 200) { this.worldAt = now; this.world.update(p.x, p.y, p.hx, p.hy, Math.abs(v.body.speed), this.route); }
      t = this.mark("camera+world", t);
    }
    this.world?.frame(this.frozen ? 6 : 2);
    if(!this.frozen&&!this.paused)this.rail?.update(now/1000,this.camera.position);
    t = this.mark("uploads", t);
    this.followSun();
    // A slow device (the frame's own work over ~9 ms): the sun's shadow map drawn every other
    // frame (its pass is nearly half the drawing); a fast one, every frame.
    const slow = this.perf.cpuMs > 9;
    this.renderer.shadowMap.autoUpdate = !slow;
    if (slow) this.renderer.shadowMap.needsUpdate = (this.frameNo & 1) === 0;
    if ((this.frameNo & 31) === 0) this.instancedDepth();
    this.frameNo++;
    const r0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.mark("render", r0);
    this.perf.renderMs = this.perf.renderMs * 0.95 + (performance.now() - r0) * 0.05;
    this.perf.cpuMs = this.perf.cpuMs * 0.95 + (performance.now() - cpu0) * 0.05;
  };

  private drawHero(p: { x: number; y: number; hx: number; hy: number; z: number }, dt: number) {
    const v = this.vehicle, L = v.spec.length * 0.4, W = v.spec.width * 0.4;
    // pitch and roll from the surface under the wheels
    const S = (x: number, y: number) => { const s = this.world.surfaceAt(x, y, this.z); return Number.isFinite(s) ? s : this.z; };
    const f = S(p.x + p.hx * L, p.y + p.hy * L), b = S(p.x - p.hx * L, p.y - p.hy * L), l = S(p.x - p.hy * W, p.y + p.hx * W), r = S(p.x + p.hy * W, p.y - p.hx * W);
    this.pitch += (Math.atan2(f - b, 2 * L) - this.pitch) * Math.min(1, dt * 12);
    this.roll += (Math.atan2(l - r, 2 * W) - this.roll) * Math.min(1, dt * 12);
    const m = this.heroMesh.matrix, q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-this.pitch, Math.atan2(p.hx, -p.hy), this.roll, "YXZ"));
    m.compose(new THREE.Vector3(p.x, p.z + 0.02, -p.y), q, new THREE.Vector3(1, 1, 1));
    this.heroMesh.matrixWorldNeedsUpdate = true;
    this.heroMesh.visible = this.view === "chase";
    this.spin = (this.spin + (v.body.speed * dt) / this.hero.radius) % (Math.PI * 2);
    const wl = new THREE.Matrix4(), tmp = new THREE.Matrix4(), flip = new THREE.Matrix4().makeRotationY(Math.PI);
    this.hero.wheels.forEach((w, i) => {
      wl.makeTranslation(w.x, this.hero.radius, w.z);
      if (w.z > 0) wl.multiply(tmp.makeRotationY(v.steer));
      if (w.side < 0) wl.multiply(flip);
      wl.multiply(tmp.makeRotationX(w.side < 0 ? -this.spin : this.spin));
      this.heroWheels.setMatrixAt(i, tmp.multiplyMatrices(m, wl));
    });
    this.heroWheels.instanceMatrix.needsUpdate = true;
    this.heroWheels.visible = this.view === "chase";
    if (this.view === "cockpit") {
      if (!this.cab) { this.cab = cockpit(this.o.vehicle); this.cab.group.matrixAutoUpdate = false; this.scene.add(this.cab.group); }
      this.cab.group.visible = true;
      this.cab.group.matrix.copy(m); this.cab.group.matrixWorldNeedsUpdate = true;
      this.cab.setSteer(v.steer);
    } else if (this.cab) this.cab.group.visible = false;
    if (this.headlight) {
      this.headlight.position.set(p.x + p.hx * 2.6, p.z + 1.0, -(p.y + p.hy * 2.6));
      this.headlight.target.position.set(p.x + p.hx * 30, p.z - 1, -(p.y + p.hy * 30));
    }
  }

  private placeCamera(dt: number, snap: boolean, pose?: { x: number; y: number; hx: number; hy: number; z: number }) {
    const v = this.vehicle;
    if (!v) return;
    const p = pose ?? { x: v.body.x, y: v.body.y, hx: v.body.hx, hy: v.body.hy, z: this.z };
    const cam = this.camera;
    if (this.view === "cockpit") {
      // the eye in the vehicle's frame (+x its left, y up, +z forward), with the body's pitch and roll
      const [ex, ey, ez] = v.spec.eye, m = this.heroMesh.matrix;
      cam.position.set(ex, ey, ez).applyMatrix4(m);
      const yaw = this.look.yaw, pitch = this.look.pitch - 0.06;
      const look = new THREE.Vector3(ex + Math.sin(yaw) * Math.cos(pitch) * 20, ey + Math.sin(pitch) * 20, ez + Math.cos(yaw) * Math.cos(pitch) * 20).applyMatrix4(m);
      cam.lookAt(look);
      if (cam.fov !== 72) { cam.fov = 72; cam.near = 0.05; cam.updateProjectionMatrix(); }
      this.camInit = false;
      return;
    }
    const big = this.o.vehicle === "coupang", speed = Math.abs(v.body.speed);
    const yaw = this.look.yaw, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const bx = p.hx * cy - p.hy * sy, by = p.hx * sy + p.hy * cy;
    const back = (big ? 11 : 9.5) + Math.min(3, speed * 0.05), high = (big ? 4.3 : 3.4) - this.look.pitch * 5;
    this.camAt.set(p.x + p.hx * 6, p.z + 1.3, -(p.y + p.hy * 6));
    const eye = new THREE.Vector3(p.x - bx * back, p.z + high, -(p.y - by * back));
    // (not under the ground: the eye at least 1.5 m over it)
    const g = this.world?.surfaceAt(eye.x, -eye.z, p.z);
    if (Number.isFinite(g)) eye.y = Math.max(eye.y, g + 1.5);
    if (snap || !this.camInit) { this.camEye.copy(eye); this.camInit = true; }
    else this.camEye.lerp(eye, 1 - Math.exp(-dt * 7));
    cam.position.copy(this.camEye);
    cam.lookAt(this.camAt);
    const fov = 60 + Math.min(16, speed * 0.35) + (v.boosting ? 8 : 0);
    if (Math.abs(cam.fov - fov) > 0.05 || cam.near !== 0.3) { cam.near = 0.3; cam.fov += (fov - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix(); }
  }

  /** The sun's shadow box follows the vehicle, moved in whole texels (no shimmer). */
  private followSun() {
    const v = this.vehicle;
    if (!v) return;
    const size = this.sun.shadow.mapSize.x, texel = 220 / size;
    const cx = Math.round(v.body.x / texel) * texel, cz = Math.round(-v.body.y / texel) * texel;
    this.sun.target.position.set(cx, this.z, cz);
    this.sun.position.set(cx + this.sunDir.x * 400, this.z + this.sunDir.y * 400, cz + this.sunDir.z * 400);
  }

  private inView(x: number, y: number) {
    const cam = this.camera;
    const dx = x - cam.position.x, dz = -y - cam.position.z;
    if (dx * dx + dz * dz > 260 * 260) return false;
    this.pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
    return this.frustum.containsPoint(new THREE.Vector3(x, this.z + 1, -y));
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }
  lonLat(x: number, y: number) { return toLonLat(this.origin, x, y); }
  /** VWorld's key and the site's API, for lookups outside the world's tiles */
  get sources() { return { key: this.o.key, domain: this.o.domain, apiBase: this.o.apiBase }; }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.input.dispose();
    this.rail?.dispose();
    this.world?.dispose();
    this.traffic?.dispose();
    this.mats?.dispose();
    this.cab?.dispose();
    this.depthOf.forEach(d => d.dispose());
    this.renderer.dispose();
  }
}
