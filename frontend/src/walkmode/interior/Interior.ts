import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Batcher } from "./geom";
import { buildShell, type Seg, type Shell } from "./build";
import { furnish, shadowMoved, switchState, type Furnished, type Interactable } from "./furnish";
import { BASE_SETS, loadSets, Library, makePalette, SETS, STYLE_SETS, type Palette, type SetName } from "./materials";
import { boxProjected, probeBox, zoneBounce, zoneLevels, zoneLit, type ZoneUniform } from "./lightZones";
import { paintedView, sunAt } from "./view";
import { waterTime } from "./water";
import { Avatar } from "../player/avatar";
import { Cat, Robot, type PetKind } from "./life";
import type { Sound, WaterKind } from "../game/sound";
import type { FloorPlan } from "./plan/types";
import { facilityLook } from "./facilityMaterials";
import { People } from "./facilityPeople";
import type { Spot } from "./facilityFurnish";

/* The interior: a flat built from its plan, furnished, lit and walked through. One renderer (the
 * page's); its output resolution is set once on entry and kept. Everything that could cost a frame
 * later — textures, programs, the reflection probes — is done behind the loading bar. */

export interface HudState { target: string | null; room: string; seated: string | null; view: "first" | "third"; /** the target is the pet (it can be looked at up close) */ pet?: boolean }
export interface InteriorOptions {
  plan: FloorPlan; hour: number;
  /** the flat's pet: a Shiba Inu (default) or a cat */
  pet?: PetKind;
  /** the real view from the flat's height (WalkGame), or null for the painted one */
  view?: THREE.CubeTexture | null;
  sound: Sound;
  onProgress?(k: number, text: string): void;
  onHud?(s: HudState): void;
  onExit?(): void;
  /** the TV switched on or off (its browser opens with it) */
  onTv?(on: boolean): void;
  /** a lit TV used again: its menu brought back (the pointer freed to reach it), not switched off */
  onTvMenu?(): void;
  /** the laptop opened (the page lays the game over its screen) or shut */
  onLaptop?(on: boolean): void;
  /** a building other than flats (plan.facility): its lift called (the page shows the floor panel),
   * and its floors for the directory in the lift hall */
  onLift?(): void;
  levels?: { level: number; label: string; uses: string }[];
}

const EYE = 1.6, RADIUS = 0.24;
/** the bounce light's share (1: as computed) */
const BOUNCE = 1;
/** the living-room probe's height */
const PROBE_Y = 1.3;
/** area lights in every interior (padded with dark ones) */
export const RECT_LIGHTS = 28;
/** a screen's facing, from its corners (top-left, top-right, bottom-right, bottom-left) */
function screenNormal(c: THREE.Vector3[]) { return new THREE.Vector3().subVectors(c[3], c[0]).cross(new THREE.Vector3().subVectors(c[1], c[0])).normalize(); }
const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()));

/** Compile the interior's programs before its plan exists (while the flat is being chosen): the
 * same materials with 1×1 stand-in textures, the same light rig, environment and target. The
 * returned handle keeps the programs alive until the real interior has its own. */
export async function prewarmInterior(renderer: THREE.WebGLRenderer): Promise<{ release(): void }> {
  RectAreaLightUniformsLib.init();
  const px = (c: number[]) => { const t = new THREE.DataTexture(new Uint8Array(c), 1, 1); t.needsUpdate = true; return t; };
  const sets = new Map<SetName, import("./materials").TexSet>();
  for (const n of Object.keys(SETS) as SetName[]) {
    const map = px([200, 200, 200, 255]); map.colorSpace = THREE.SRGBColorSpace;
    sets.set(n, { map, normalMap: px([128, 128, 255, 255]), arm: px([255, 200, 0, 255]), size: SETS[n] });
  }
  const lib = new Library(sets);
  const scene = new THREE.Scene(), zones: ZoneUniform = { value: [] };
  const g = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  g.setAttribute("zone", new THREE.Float32BufferAttribute(new Array(g.getAttribute("position").count).fill(1), 1));
  const mats: THREE.Material[] = [], lamps: THREE.Material[] = [], floors: THREE.Material[] = [];
  for (const st of ["modern_white", "wood_natural", "gray_minimal", "classic_walnut", "nordic_bright", "hotel_dark", "vintage_warm"] as const) {
    const P = makePalette(lib, st);
    mats.push(...Object.values(P) as THREE.Material[]);
    lamps.push(P.ledPanel, P.ledWarm, P.lampShade);
    floors.push(P.floorMain);
    // the per-object ones furnish.ts makes (a canvas print, a screen with a picture, a lit liner)
    mats.push(new THREE.MeshPhysicalMaterial({ map: px([1, 1, 1, 255]), roughness: 0.9 }));
    const scr = (P.screen as THREE.MeshPhysicalMaterial).clone(); scr.emissiveMap = px([1, 1, 1, 255]); mats.push(scr);
    mats.push(new THREE.MeshPhysicalMaterial({ color: "#f4f6f7", roughness: 0.4, emissive: "#eef6ff" }));
    mats.push(new THREE.MeshPhysicalMaterial({ color: "#808080", roughness: 0.8, sheen: 1, sheenColor: new THREE.Color("#ffffff"), sheenRoughness: 0.5 }));
    mats.push(new THREE.MeshPhysicalMaterial({ color: "#9ccf5a", roughness: 0.05, clearcoat: 1, emissive: "#3a5a10" }));
  }
  const lampSet = new Set<THREE.Material>(lamps);
  for (const m of mats) { const lamp = lampSet.has(m); zoneLit(m, zones, lamp); if (floors.includes(m)) boxProjected(m); const me = new THREE.Mesh(g, m); me.castShadow = me.receiveShadow = true; scene.add(me); }
  const avatar = new Avatar(1); scene.add(avatar.root);
  avatar.root.traverse(o => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) zoneLit(m, zones); });
  for (let i = 0; i < RECT_LIGHTS; i++) scene.add(new THREE.RectAreaLight("#ffffff", 0, 0.1, 0.1));
  zones.value = new Array(RECT_LIGHTS).fill(1);
  const sun = new THREE.DirectionalLight(); sun.castShadow = true; scene.add(sun, new THREE.HemisphereLight());
  const pm = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment(), env = pm.fromScene(room, 0.04); room.dispose();
  scene.environment = env.texture;
  const cam = new THREE.PerspectiveCamera();
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  const r0 = { tm: renderer.toneMapping, shadow: renderer.shadowMap.enabled };
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.toneMapping = THREE.NeutralToneMapping;
  try { await renderer.compileAsync(scene, cam); } finally { renderer.setRenderTarget(prev); renderer.toneMapping = r0.tm; }
  return {
    release() {
      for (const m of mats) m.dispose();
      lib.dispose(); g.dispose(); avatar.dispose(); env.dispose(); pm.dispose(); rt.dispose();
    },
  };
}

export class Interior {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.04, 400);
  private composer!: EffectComposer;
  private gtao!: GTAOPass;
  private bloom!: UnrealBloomPass;
  private lib: Library | null = null;
  private P!: Palette;
  shell!: Shell;
  furn!: Furnished;
  private static = new THREE.Group();
  private dynamic = new THREE.Group();
  /** what the look ray hits that isn't drawn: kept out of the scene */
  private hits = new THREE.Group();
  private zoneU: ZoneUniform = { value: [] };
  private rect: { light: THREE.RectAreaLight; zone: number; base: number; window?: number }[] = [];
  private zoneLevel = new Map<number, number>();
  /** each zone's surface area (floor, ceiling, walls), for its bounce light */
  private zoneArea = new Map<number, number>();
  private wetZones = new Set<number>();
  private tvLight: THREE.RectAreaLight | null = null;
  private doorsMoving = false; private shadowFrames = 2;
  private sun = new THREE.DirectionalLight();
  private hemi = new THREE.HemisphereLight("#dfe8f5", "#8a7a66", 0.05);
  private viewRT: THREE.WebGLCubeRenderTarget | null = null;
  private probe: { rt: THREE.WebGLCubeRenderTarget; cam: THREE.CubeCamera; env: THREE.WebGLRenderTarget | null; pmrem: THREE.PMREMGenerator } | null = null;
  private wetProbe: THREE.WebGLRenderTarget | null = null;
  private placeholder: THREE.WebGLRenderTarget | null = null;
  private probeDirty = 0;
  private mirrors: Reflector[] = [];
  // (the same person as outside — Avatar(7) in WalkGame — in socks: shoes are left at the door)
  avatar = (() => { const a = new Avatar(7); a.shoes(false); return a; })();
  cat: Cat | null = null;
  /** a building's people (facilityPeople.ts) */
  people: People | null = null;
  private facDispose: (() => void) | null = null;
  /** the flat's pet (for the map) */
  get pet(): { pos: THREE.Vector2 } | null { return this.cat; }
  robot: Robot | null = null;
  // the walker
  pos = new THREE.Vector2(); yaw = 0; pitch = -0.05; private vel = new THREE.Vector2();
  private eyeY = EYE; private bob = 0; private stepAcc = 0;
  view: "first" | "third" = "first";
  /** the camera as shown: it follows pos/yaw/pitch — at once while walking and looking, eased over
   * a moment when they jump (sitting, lying, standing, changing view), never a sudden turn */
  private shown = { yaw: 0, pitch: -0.05, pos: new THREE.Vector3(), boom: 1.5, ease: 0, init: false };
  seated: { label: string; eye: THREE.Vector3; yaw: number; pose: "sit" | "lie"; back: THREE.Vector2 } | null = null;
  private keys = new Set<string>(); private stick = new THREE.Vector2(); private runStick = false;
  private ray = new THREE.Raycaster(); private target: Interactable | null = null;
  private hud: HudState = { target: null, room: "", seated: null, view: "first" };
  private raf = 0; private last = 0; private running = false; private disposed = false;
  private segs: Seg[] = [];
  private interactables: Interactable[] = [];
  perf = { frames: 0, intervals: [] as number[], worst: 0, cpuMs: 0, started: 0, loadMs: 0, phases: {} as Record<string, number>, seg: {} as Record<string, number>, long: [] as { at: number; ms: number; room: string; seg: Record<string, number> }[] };
  private segT = 0;
  private tmpV = new THREE.Vector3();
  private holdM = new THREE.Matrix4();
  private holdEye = new THREE.Matrix4().compose(new THREE.Vector3(0.15, -0.2, -0.4), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, -0.35, 0)), new THREE.Vector3(1, 1, 1));
  /** (where a frame's time goes: a running average a section) */
  private lap(name: string) { const t = performance.now(), s = this.perf.seg; s[name] = (s[name] ?? 0) * 0.98 + (t - this.segT) * 0.02; this.segT = t; }

  constructor(readonly renderer: THREE.WebGLRenderer, private o: InteriorOptions) {
    RectAreaLightUniformsLib.init();
    this.scene.add(this.static, this.dynamic, this.avatar.root);
    // (the sun's shadow map is drawn only when the flat's own things move: the walker casts none)
    this.avatar.root.traverse(o => { o.castShadow = false; });
  }

  // ---------------------------------------------------------------- loading
  async load(signal?: AbortSignal) {
    const t0 = performance.now(), plan = this.o.plan, P = (k: number, s: string) => this.o.onProgress?.(k, s);
    // (the recorded sounds come down alongside, without holding the flat up)
    void this.o.sound.loadRecordings();
    const mark = (n: string, t: number) => { this.perf.phases[n] = Math.round(performance.now() - t); return performance.now(); };
    let t = t0;
    P(0.02, "자재 텍스처를 내려받는 중");
    // (the common sets, and the style's own floors and tiles only)
    const names: SetName[] = [...new Set<SetName>([...BASE_SETS, ...STYLE_SETS[plan.style]])];
    const sets = await loadSets(names, (k, label) => P(0.02 + k * 0.5, label), signal);
    if (this.disposed) return;
    t = mark("textures", t);
    this.lib = new Library(sets);
    this.P = makePalette(this.lib, plan.style);
    // (a building: its own floors and things over the style's — facilityMaterials.ts)
    const look = plan.facility ? facilityLook(this.P, plan.facility.kind, plan.facility.name) : null;
    const spots: Spot[] = [];
    if (look) { this.P = look.P; this.facDispose = look.dispose; }
    P(0.54, "벽·바닥·천장을 세우는 중");
    await nextFrame();
    const B = new Batcher();
    this.shell = buildShell(plan, this.P, B, this.dynamic);
    await nextFrame();
    P(0.6, "가구와 설비를 배치하는 중");
    switchState.clear();
    this.furn = furnish(plan, this.shell, this.P, B, this.dynamic, this.hits,
      look ? { X: look.X, signs: look.signs, spots, hooks: { lift: () => this.o.onLift?.(), levels: this.o.levels } } : undefined);
    await nextFrame();
    for (const m of B.build()) this.static.add(m);
    t = mark("build", t);
    this.segs = [...this.shell.segments, ...this.furn.colliders];
    // the zones' lights
    P(0.66, "조명을 설치하는 중");
    this.setupLights();
    for (const m of this.lib.all) zoneLit(m, this.zoneU);
    for (const m of [this.P.ledPanel, this.P.ledWarm, this.P.lampShade]) zoneLit(m, this.zoneU, true);
    zoneLevels.value.fill(1); zoneBounce.value.fill(0);
    // the view out of the windows
    const sunS = sunAt(this.o.hour);
    if (this.o.view) this.scene.background = this.o.view;
    else { this.viewRT = paintedView(this.renderer, this.o.hour, plan.floor * 2.9 + 1.5, plan.complexId.length + plan.floor); this.scene.background = this.viewRT.texture; }
    this.scene.backgroundIntensity = 1.25 + (1 - sunS.night) * 0.9;
    // mirrors that reflect (the bathroom cabinets)
    for (const mr of this.furn.mirrors) {
      const r = new Reflector(new THREE.PlaneGeometry(mr.w, mr.h), { textureWidth: 1024, textureHeight: Math.round(1024 * mr.h / mr.w), color: 0xc9cdd0, clipBias: 0.002, multisample: 4 });
      r.position.copy(mr.pos).addScaledVector(mr.normal, 0.0015); r.lookAt(r.position.clone().add(mr.normal));
      const draw = r.onBeforeRender;
      r.onBeforeRender = (renderer, scene, camera, ...rest) => {
        // (not in the AO pass's own render, nor from across the flat)
        if ((scene as THREE.Scene).overrideMaterial || camera.position.distanceTo(r.position) > 4.5) return;
        draw.call(r, renderer, scene, camera, ...rest);
      };
      this.mirrors.push(r); this.dynamic.add(r);
    }
    this.interactables = [...this.furn.interactables, ...this.doorInteractables()];
    // places to sit or lie down
    for (const s of this.furn.seats) this.interactables.push({ id: `seat-${s.label}`, zone: s.zone, room: s.room, hit: s.hit, label: () => s.label, act: () => { this.sit(s.pose === "lie" ? "침대에 누워 있음" : s.label === "소파에 앉기" ? "소파에 앉아 있음" : s.label === "벤치에 앉기" ? "벤치에 앉아 있음" : "의자에 앉아 있음", s.eye, s.yaw, s.pose); return null; } });
    const collide = (x: number, z: number, r: number) => this.collide(x, z, r);
    if (plan.facility) {
      // a building: its people instead of a pet
      this.people = new People(plan, spots, () => this.o.sound.play("click"));
      this.people.root.traverse(o => { o.castShadow = false; });
      this.dynamic.add(this.people.root);
      this.interactables.push(...this.people.interactables((x, z) => this.shell.roomAt(x, z)));
    } else {
    // the cat, and a robot vacuum by the sofa
    this.cat = new Cat(plan, this.shell, collide, this.o.sound, this.o.pet ?? "dog");
    this.dynamic.add(this.cat.root);
    const cat = this.cat, living = plan.rooms.find(r => r.type === "living") ?? plan.rooms[0];
    this.interactables.push({ id: "cat", zone: 0, room: living, hit: cat.hit, label: () => cat.label(), act: () => cat.pet() });
    if (this.furn.dock) {
      const robot = this.robot = new Robot(this.furn.dock, this.shell, collide, this.o.sound);
      this.dynamic.add(robot.root, robot.dockMesh);
      this.interactables.push({ id: "robot", zone: 0, room: living, hit: robot.hit, label: () => robot.label(), act: () => robot.toggle() });
    }
    }
    // every lit material the rolled, zoned light loop (furniture extras, the cat, the walker too)
    this.scene.traverse(o => { const m = (o as THREE.Mesh).material; for (const x of (Array.isArray(m) ? m : m ? [m] : [])) if ((x as THREE.MeshStandardMaterial).isMeshStandardMaterial && !x.customProgramCacheKey().startsWith("zone")) zoneLit(x, this.zoneU); });
    // the living room's polished floor reflects the room where it is (the probe is taken there)
    {
      const living = this.probeRoom();
      const box = new THREE.Box3();
      for (const r of plan.rooms) if (r.zone === living.zone) box.union(new THREE.Box3(new THREE.Vector3(r.rect[0], -0.05, r.rect[1]), new THREE.Vector3(r.rect[2], this.shell.H + 0.2, r.rect[3])));
      probeBox.min.value.copy(box.min); probeBox.max.value.copy(box.max);
      probeBox.at.value.set((living.rect[0] + living.rect[2]) / 2, PROBE_Y, (living.rect[1] + living.rect[3]) / 2);
      boxProjected(this.P.floorMain);
    }
    t = mark("lights", t);
    // the post chain at the canvas's own resolution
    P(0.72, "셰이더를 준비하는 중");
    this.setupPost();
    this.placeAtEntrance();
    this.applyCamera(0);
    await nextFrame();
    // every texture to the GPU, every program compiled, now
    for (const m of this.lib.all) for (const k of ["map", "normalMap", "roughnessMap", "aoMap"] as const) { const tx = (m as THREE.MeshPhysicalMaterial)[k]; if (tx) this.renderer.initTexture(tx); }
    t = mark("upload", t);
    P(0.8, "셰이더를 준비하는 중");
    // (an environment from the start, of the same kind the probes make: their arrival later
    // changes a texture, not every program)
    this.setupProbe();
    const pm = this.probe!.pmrem, room = new RoomEnvironment();
    this.placeholder = pm.fromScene(room, 0.04); room.dispose();
    this.scene.environment = this.placeholder.texture; this.scene.environmentIntensity = 0.3;
    for (const m of [this.P.wallWet, this.P.floorWet, this.P.ceramic, this.P.threshold] as THREE.MeshPhysicalMaterial[]) m.envMap = this.placeholder.texture;
    // (for the target the frame is drawn into: linear, not tone-mapped — the screen's variants
    // would be compiled for nothing and the real ones again on the first frame)
    const prevRT = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.composer.renderTarget1);
    await this.renderer.compileAsync(this.scene, this.camera);
    this.renderer.setRenderTarget(prevRT);
    t = mark("compile", t);
    if (this.disposed) return;
    P(0.9, "빛 반사를 계산하는 중");
    // the direct light first, then once more with that as the light round (two bounces)
    // (daylight at the windows and the bounce light set before: the probes see the lit flat)
    this.lightsFrame(0);
    this.scene.environmentIntensity = 0;
    this.captureProbe(); await nextFrame();
    this.captureProbe();
    this.captureWet();
    t = mark("probe", t);
    // first real frames from every room and before every mirror (the shadow, AO and reflection
    // passes, their targets and programs), behind the loading screen — none on the walk
    P(0.95, "방마다 미리 그려보는 중");
    const keep = { p: this.pos.clone(), yaw: this.yaw, pitch: this.pitch };
    const looks: [number, number, number][] = [];
    // (a drawn floor's many rooms: one look a zone, from its biggest room)
    const lead = new Map<string, FloorPlan["rooms"][number]>();
    for (const r of this.o.plan.rooms) { const l = lead.get(r.zone), a = (q: typeof r) => (q.rect[2] - q.rect[0]) * (q.rect[3] - q.rect[1]); if (!l || a(r) > a(l)) lead.set(r.zone, r); }
    for (const r of lead.values()) { const [x0, z0, x1, z1] = r.rect; looks.push([(x0 + x1) / 2, (z0 + z1) / 2, 0], [(x0 + x1) / 2, (z0 + z1) / 2, Math.PI]); }
    for (const [x, z, yaw] of looks) { this.pos.set(x, z); this.yaw = yaw; this.applyCamera(0); this.renderFrame(); }
    for (const m of this.mirrors) {
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(m.quaternion);
      this.camera.position.copy(m.position).addScaledVector(n, 1.2).setY(1.6); this.camera.lookAt(m.position); this.camera.updateMatrixWorld();
      this.renderFrame();
    }
    this.pos.copy(keep.p); this.yaw = keep.yaw; this.pitch = keep.pitch; this.applyCamera(0);
    this.renderFrame();
    await nextFrame();
    this.perf.loadMs = Math.round(performance.now() - t0);
    P(1, "입장합니다");
  }

  private setupLights() {
    const H = this.shell.H;
    // ceiling lights: a few area lights a zone (they light only their zone)
    const add = (zone: number, pos: THREE.Vector3, w: number, h: number, color: THREE.ColorRepresentation, intensity: number, down = true, windowIdx?: number, inward?: THREE.Vector3) => {
      const l = new THREE.RectAreaLight(color, intensity, w, h);
      l.position.copy(pos);
      if (down) l.lookAt(pos.x, pos.y - 1, pos.z); else l.lookAt(pos.clone().add(inward!));
      this.scene.add(l);
      this.rect.push({ light: l, zone, base: intensity, window: windowIdx });
    };
    // Each lamp's luminance from the light it should put on the floor below (in the scene's
    // units, where the noon sun is ~3.4): illuminance ≈ L·A / (π·h²) for an area A at height h.
    const lum = (target: number, area: number, h = H) => (target * Math.PI * h * h) / Math.max(0.01, area);
    for (const c of this.shell.ceilingLights) {
      const warm = c.kind === "coffer" ? "#ffe2bd" : c.room.type === "bathroom" || c.room.type === "ensuite" ? "#fff8f0" : "#fff3e4";
      if (c.kind === "coffer") {
        // the cove's glow from the recess, and the downlights' share
        const a1 = c.w * 0.9 * c.h * 0.9, a2 = (c.w + 0.8) * (c.h + 0.8);
        add(c.zone, c.pos, c.w * 0.9, c.h * 0.9, warm, lum(0.32, a1));
        add(c.zone, c.pos.clone().setY(H - 0.01), c.w + 0.8, c.h + 0.8, "#fff4e6", lum(0.16, a2));
      } else if (c.kind === "down") add(c.zone, c.pos, c.w, c.h, "#fff1dc", lum(0.36, c.w * c.h));
      else if (c.kind === "linear") add(c.zone, c.pos, c.w * 1.4, 0.3, "#fff3e4", lum(0.32, c.w * 1.4 * 0.3, H - 0.85));
      else if (c.kind === "bath") add(c.zone, c.pos, 0.6, 0.6, warm, lum(0.3, 0.36));
      else add(c.zone, c.pos, c.w * 1.6, c.h * 1.6, warm, lum(0.42, c.w * c.h * 2.56));
    }
    for (const p of this.furn.pendants) add(p.zone, p.pos, p.w, p.h, "#ffd9a6", lum(0.28, p.w * p.h, 0.7));
    // daylight through each window: a soft area light facing in (curtains turn it down)
    const s = sunAt(this.o.hour);
    this.shell.windows.forEach((w, i) => {
      add(w.zone, w.center.clone().addScaledVector(w.inward, 0.02), w.width, w.height, s.sky.clone().lerp(new THREE.Color("#fff6ea"), 0.45), 0, false, i, w.inward);
    });
    // the TV's own light on the room, while it is on
    const tv = this.furn.tv;
    if (tv?.pos && tv.normal) { add(tv.zone ?? 0, tv.pos, tv.w ?? 1.5, tv.h ?? 0.85, "#c9d6ff", 0, false, undefined, tv.normal); this.tvLight = this.rect[this.rect.length - 1].light; }
    // (always the same number of area lights: the programs don't depend on the plan, so they
    // can be compiled before it exists — see prewarmInterior)
    while (this.rect.length < RECT_LIGHTS) add(-1, new THREE.Vector3(0, -50, 0), 0.1, 0.1, "#000000", 0);
    if (this.rect.length > RECT_LIGHTS) console.warn(`walk: ${this.rect.length} area lights (> ${RECT_LIGHTS}): programs recompile`);
    this.zoneU.value = this.rect.map(r => r.zone);
    for (const z of this.shell.zones.values()) this.zoneLevel.set(z, 1);
    for (const r of this.o.plan.rooms) {
      const z = this.shell.zones.get(r.zone)!, [x0, z0, x1, z1] = r.rect, w = x1 - x0, d = z1 - z0;
      this.zoneArea.set(z, (this.zoneArea.get(z) ?? 0) + 2 * w * d + 2 * (w + d) * H);
      if (r.type === "bathroom" || r.type === "ensuite" || r.type === "restroom") this.wetZones.add(z);
    }
    // the sun through the glass, with soft shadows
    this.sun.color.copy(s.color); this.sun.intensity = s.intensity;
    const [x0, z0, x1, z1] = this.o.plan.bounds, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    this.sun.position.set(cx + s.dir.x * 30, s.dir.y * 30, cz + s.dir.z * 30); this.sun.target.position.set(cx, 0, cz);
    this.sun.castShadow = s.intensity > 0;
    const big = this.renderer.capabilities.maxTextureSize >= 8192;
    this.sun.shadow.mapSize.set(big ? 4096 : 2048, big ? 4096 : 2048);
    const sc = this.sun.shadow.camera, r = Math.hypot(x1 - x0, z1 - z0) / 2 + 2;
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 5; sc.far = 70;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.025; this.sun.shadow.radius = 4;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.hemi.intensity = 0.04 + 0.08 * (1 - s.night);
  }

  private setupPost() {
    const r = this.renderer;
    // (on: a previous interior on this renderer left it off, and its loading renders need the sun's shadow)
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap; r.shadowMap.autoUpdate = true; r.shadowMap.needsUpdate = true;
    r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    // (the frame's own depth feeds the AO, its normals rebuilt from it: no second scene pass)
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(size.x, size.y) });
    this.composer = new EffectComposer(r, rt);
    this.composer.setPixelRatio(1);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // (three's GTAOPass reads its own target's depth in setGBuffer even when given one: it is made,
    // then switched over and its never-drawn target freed)
    this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
    this.gtao.setGBuffer(rt.depthTexture!);
    (this.gtao as unknown as { normalRenderTarget: THREE.WebGLRenderTarget }).normalRenderTarget.dispose();
    this.gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
    this.gtao.blendIntensity = 0.85;
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.12, 0.45, 1.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.setSize(size.x, size.y);
    // opaque draws grouped by program: every program switch uploads all 28 area lights again
    // (three's own order is by material, which interleaves programs)
    const props = (r as unknown as { properties: { get(m: THREE.Material): { currentProgram?: { id: number } } } }).properties;
    const prog = new WeakMap<THREE.Material, number>();
    const pid = (m: THREE.Material) => {
      let v = prog.get(m);
      if (v === undefined) { const p = props.get(m).currentProgram; if (!p) return 0; prog.set(m, v = p.id); }
      return v;
    };
    type Item = { groupOrder: number; renderOrder: number; material: THREE.Material & { id: number }; z: number; id: number };
    r.setOpaqueSort(((a: Item, b: Item) => a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder || pid(a.material) - pid(b.material) || a.material.id - b.material.id || a.z - b.z || a.id - b.id) as never);
  }

  private setupProbe() {
    const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(0.05, 40, rt);
    this.probe = { rt, cam, env: null, pmrem: new THREE.PMREMGenerator(this.renderer) };
  }
  /** The flat as seen from the living room, as the light every surface takes from round it. */
  private captureProbe(at?: THREE.Vector3) {
    const p = this.probe; if (!p) return;
    const living = this.probeRoom();
    const [x0, z0, x1, z1] = living.rect;
    p.cam.position.copy(at ?? new THREE.Vector3((x0 + x1) / 2, PROBE_Y, (z0 + z1) / 2));
    const vis = this.avatar.root.visible; this.avatar.root.visible = false;
    this.mirrors.forEach(m => (m.visible = false));
    p.cam.update(this.renderer, this.scene);
    this.mirrors.forEach(m => (m.visible = true));
    this.avatar.root.visible = vis;
    const env = p.pmrem.fromCubemap(p.rt.texture);
    p.env?.dispose(); p.env = env;
    this.scene.environment = env.texture; this.scene.environmentIntensity = 0.85;
  }
  /** where the light round the flat is taken: its living room; a building's largest room off the corridor */
  private probeRoom() {
    const rooms = this.o.plan.rooms, area = (r: (typeof rooms)[number]) => (r.rect[2] - r.rect[0]) * (r.rect[3] - r.rect[1]);
    return rooms.find(r => r.type === "living") ?? (this.o.plan.facility ? rooms.filter(r => r.type !== "corridor" && r.type !== "stair").sort((a, b) => area(b) - area(a))[0] : undefined) ?? rooms[0];
  }
  /** Bathrooms reflect a bathroom (their tiles and chrome), not the living room. */
  private captureWet() {
    const p = this.probe; if (!p) return;
    const bath = this.o.plan.rooms.find(r => r.type === "bathroom" || r.type === "restroom");
    if (!bath) return;
    const [x0, z0, x1, z1] = bath.rect;
    const keep = this.scene.environment;
    p.cam.position.set((x0 + x1) / 2, 1.4, (z0 + z1) / 2);
    this.mirrors.forEach(m => (m.visible = false));
    p.cam.update(this.renderer, this.scene);
    this.mirrors.forEach(m => (m.visible = true));
    const env = p.pmrem.fromCubemap(p.rt.texture);
    this.wetProbe?.dispose(); this.wetProbe = env;
    for (const m of [this.P.wallWet, this.P.floorWet, this.P.ceramic, this.P.threshold] as THREE.MeshPhysicalMaterial[]) { m.envMap = env.texture; m.needsUpdate = false; }
    this.scene.environment = keep;
  }

  private doorInteractables(): Interactable[] {
    return this.shell.doors.map((d, i) => {
      const room = this.o.plan.rooms.find(r => r.id === d.opening.a)!;
      return {
        id: `door-${i}`, zone: d.zone, room, hit: d.kind === "slide" ? d.pivot : d.leaf,
        label: () => d.kind === "front" ? (this.o.plan.facility ? "출입문으로 나가기" : "현관문 열고 밖으로 나가기") : `${d.label} ${d.want > 0.5 ? "닫기" : "열기"}`,
        act: () => {
          if (d.kind === "front") { d.want = 0.35; this.o.sound.play("doorlock"); setTimeout(() => this.o.onExit?.(), 700); return null; }
          d.want = d.want > 0.5 ? 0 : 1; return "door";
        },
      };
    });
  }

  private placeAtEntrance() {
    const st = this.o.plan.facility?.start;
    if (st) { this.pos.set(st[0], st[1]); this.yaw = st[2]; return; }
    const entry = this.o.plan.rooms.find(r => r.type === "entrance") ?? this.o.plan.rooms[0];
    const hall = this.o.plan.openings.find(o => o.a === entry.id && o.b !== "out") ?? this.o.plan.openings.find(o => o.b === entry.id);
    const [x0, z0, x1, z1] = entry.rect;
    this.pos.set((x0 + x1) / 2, z0 + 0.65);
    // looking into the flat
    if (hall) { const tx = hall.axis === "z" ? hall.center : hall.at, tz = hall.axis === "z" ? hall.at + 2 : hall.center; this.yaw = Math.atan2(-(tx - this.pos.x), -(tz - this.pos.y)); }
    else this.yaw = Math.PI;
    void z1; void x1;
  }

  // ---------------------------------------------------------------- input
  keyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.code === "KeyE" || e.code === "Enter") { e.preventDefault(); if (!e.repeat) this.interact(); return; }
    if (e.code === "KeyV") { if (!e.repeat) this.toggleView(); return; }
    if (e.code === "KeyZ" && !e.repeat) { if (this.petZoomed()) this.zoomPet(false); else if (this.target?.id === "cat") this.zoomPet(true); return; }
    if (/^(Key[WASD]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Space)$/.test(e.code)) { e.preventDefault(); this.keys.add(e.code); if (this.seated && /Key[WASD]|Arrow/.test(e.code)) this.standUp(); }
  };
  keyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  blur = () => { this.keys.clear(); };
  setStick(x: number, y: number, run: boolean) { this.stick.set(x, y); this.runStick = run; if (this.seated && (Math.abs(x) > 0.3 || Math.abs(y) > 0.3)) this.standUp(); }
  look(dx: number, dy: number) { this.yaw -= dx; this.pitch = Math.max(-1.35, Math.min(1.3, this.pitch - dy)); }
  /** shut the laptop (from the page's button too), stepping back if zoomed in on it */
  closeLaptop() {
    if (this.furn.laptop.on) this.furn.laptop.on = false;
    if (this.seated?.label === "화면") this.standUp();
  }
  /** the laptop's screen on the page (CSS px corners) once it is open and faces the eye */
  laptopScreen(): { x: number; y: number }[] | null {
    const l = this.furn.laptop;
    if (!l.on || (l.open ?? 0) < 1 || !l.cornersNow) return null;
    return this.project(l.cornersNow());
  }
  /** four world corners on the page, or null when behind the eye or turned away from it */
  private project(c: THREE.Vector3[]) {
    const mid = c[0].clone().add(c[2]).multiplyScalar(0.5), n = screenNormal(c);
    if (n.dot(this.tmpV.subVectors(this.camera.position, mid)) <= 0.02) return null;
    // (and not through a wall: the walls between the eye and the screen hide it)
    const e = this.camera.position, L = Math.hypot(mid.x - e.x, mid.z - e.z);
    for (const [a, b, cc, d] of this.segs.slice(0, this.shell.segments.length)) {
      const h = segHit(e.x, e.z, mid.x, mid.z, a, b, cc, d);
      if (h !== null && h * L < L - 0.25) return null;
    }
    const r = this.renderer.domElement.getBoundingClientRect(), out: { x: number; y: number }[] = [];
    for (const p of c) { const v = p.clone().project(this.camera); if (v.z > 1 || v.z < -1) return null; out.push({ x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }); }
    return out;
  }
  /** Zoom in on a screen (the TV, the laptop): the eye square in front of it, at the distance where it
   * fills nine tenths of the view; null steps back to where the walker stood. */
  zoomScreen(which: "tv" | "laptop" | null) {
    if (!which) { if (this.seated?.label === "화면") this.standUp(); return; }
    const c = which === "tv" ? this.furn.tv?.corners : this.furn.laptop.cornersNow?.();
    if (!c) return;
    const mid = c[0].clone().add(c[2]).multiplyScalar(0.5), n = screenNormal(c);
    const w = c[0].distanceTo(c[1]), h = c[0].distanceTo(c[3]);
    const vf = THREE.MathUtils.degToRad(this.camera.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    const d = Math.max((w / 2) / Math.tan(hf / 2), (h / 2) / Math.tan(vf / 2)) / 0.9;
    const back = this.seated?.label === "화면" ? this.seated.back : this.pos.clone();
    this.seated = { label: "화면", eye: mid.clone().addScaledVector(n, d), yaw: Math.atan2(n.x, n.z), pose: "sit", back };
    this.yaw = this.seated.yaw; this.pitch = Math.asin(Math.max(-1, Math.min(1, -n.y))); this.shown.ease = 0.9;
    this.avatar.root.visible = false; this.emitHud(true);
  }
  zoomed() { return this.seated?.label === "화면"; }
  /** A close look at the pet: it sits and looks up, the eye at its face's height half a metre in
   * front, following it; null steps back. */
  zoomPet(on: boolean) {
    const c = this.cat; if (!c) return;
    if (!on) { c.hold = null; if (this.seated?.label === "반려동물") this.standUp(); return; }
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), d = c.species === "dog" ? 0.55 : 0.45, y = c.species === "dog" ? 0.46 : 0.3;
    const eye = new THREE.Vector3(c.pos.x + fx * d, this.shell.floorAt(c.pos.x, c.pos.y) + y, c.pos.y + fz * d);
    c.hold = eye.clone();
    this.seated = { label: "반려동물", eye, yaw: Math.atan2(fx, fz), pose: "sit", back: this.seated?.back ?? this.pos.clone() };
    this.yaw = this.seated.yaw; this.pitch = -0.12; this.shown.ease = 0.9; this.emitHud(true);
  }
  petZoomed() { return this.seated?.label === "반려동물"; }
  /** the TV's screen on the page (CSS px corners) while it is on and faces the eye; null when it is
   * behind or turned away (the page then hides its browser) */
  tvScreen(): { x: number; y: number }[] | null {
    const tv = this.furn.tv;
    return tv?.on && tv.corners ? this.project(tv.corners) : null;
  }
  /** the TV from its browser: on or off, and the picture on its screen (null: its own still) */
  tvPower(on: boolean) { this.furn.tv?.power?.(on); this.probeDirty = Math.max(this.probeDirty, 8); }
  tvPicture(img: HTMLImageElement | null) { this.furn.tv?.picture?.(img); }
  // (into first person: eyes level, ahead the way the body faces)
  toggleView() { this.view = this.view === "first" ? "third" : "first"; if (this.view === "first" && !this.seated) this.pitch = -0.04; this.shown.ease = 0.6; this.emitHud(); }
  interact() {
    this.o.sound.resume();
    const t = this.target; if (!t) return;
    // (the TV on: E opens its menu again from wherever the viewer stands; it is turned off from there)
    if (t.id === "tv" && this.furn.tv?.on && this.o.onTvMenu) { this.o.onTvMenu(); this.emitHud(true); return; }
    const s = t.act();
    if (t.id === "tv") this.o.onTv?.(!!this.furn.tv?.on);
    if (t.id === "laptop") { if (!this.furn.laptop.on) this.closeLaptop(); this.o.onLaptop?.(this.furn.laptop.on); }
    if (s) this.o.sound.play(s === "water" ? "click" : s);
    this.probeDirty = Math.max(this.probeDirty, t.id.startsWith("switch") || t.id.startsWith("curtain") || t.id === "tv" ? 8 : 0);
    this.emitHud(true);
  }
  sit(label: string, eye: THREE.Vector3, yaw: number, pose: "sit" | "lie") {
    this.seated = { label, eye, yaw, pose, back: this.pos.clone() };
    this.yaw = yaw; this.pitch = pose === "lie" ? 0.75 : -0.08; this.avatar.pose = pose; this.shown.ease = 0.9; this.emitHud(true);
  }
  standUp() { if (!this.seated) return; if (this.cat) this.cat.hold = null; this.pos.copy(this.seated.back); this.seated = null; this.avatar.pose = "stand"; this.pitch = -0.05; this.shown.ease = 0.8; this.emitHud(true); }

  // ---------------------------------------------------------------- the frame
  start() {
    if (this.running) return;
    this.running = true;
    window.addEventListener("keydown", this.keyDown, true); window.addEventListener("keyup", this.keyUp, true); window.addEventListener("blur", this.blur);
    this.last = performance.now(); this.perf.started = this.last;
    this.raf = requestAnimationFrame(this.loop);
  }
  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const c0 = performance.now(), raw = now - this.last; this.last = now;
    const dt = Math.min(0.1, raw / 1000);
    if (this.perf.frames++ > 2) { if (this.perf.intervals.length < 36000) this.perf.intervals.push(+raw.toFixed(2)); this.perf.worst = Math.max(this.perf.worst, raw); }
    // (a long frame: where, and what the last one spent its time on)
    if (raw > 30 && this.perf.frames > 3 && this.perf.long.length < 100) this.perf.long.push({ at: Math.round(now - this.perf.started), ms: Math.round(raw), room: this.shell.roomAt(this.pos.x, this.pos.y)?.id ?? "", seg: { ...this.perf.seg } });
    waterTime.value += dt;
    this.segT = c0;
    this.move(dt);
    this.animateDoors(dt);
    this.lap("move");
    for (const it of this.interactables) it.update?.(dt);
    this.lap("things");
    const walker = { x: this.pos.x, z: this.pos.y, speed: this.seated ? 0 : this.vel.length(), seated: !!this.seated };
    if (this.seated) { const f = new THREE.Vector3(-Math.sin(this.seated.yaw), 0, -Math.cos(this.seated.yaw)); walker.x = this.seated.eye.x + f.x * 0.6; walker.z = this.seated.eye.z + f.z * 0.6; }
    this.cat?.update(dt, walker);
    this.people?.update(dt, walker);
    this.robot?.update(dt, [{ x: walker.x, z: walker.z, r: 0.25 }, ...(this.cat ? [{ x: this.cat.pos.x, z: this.cat.pos.y, r: 0.2 }] : [])]);
    this.lap("life");
    this.lightsFrame(dt);
    this.applyCamera(dt);
    this.lap("lights+cam");
    this.pick();
    this.lap("pick");
    const loud: Partial<Record<WaterKind, number>> = {};
    for (const it of this.interactables) if (it.loud) {
      const l = it.loud(); if (l <= 0) continue;
      const p = it.hit.getWorldPosition(this.tmpV), d = Math.hypot(p.x - this.pos.x, p.z - this.pos.y), k = it.channel ?? "air";
      loud[k] = (loud[k] ?? 0) + l / (1 + d * d * 0.25);
    }
    this.o.sound.running(loud);
    if (this.probeDirty > 0 && --this.probeDirty === 0) this.captureProbe();
    this.lap("sound+probe");
    // the sun's shadow map is redrawn only when something casting one moves (doors, curtains, the
    // fridge door); the cat, the robot and the walker are grounded by the AO instead
    const r = this.renderer;
    if (r.shadowMap.autoUpdate) r.shadowMap.autoUpdate = false;
    if (this.doorsMoving || now - shadowMoved.at < 100 || this.shadowFrames > 0) { r.shadowMap.needsUpdate = true; this.shadowFrames = Math.max(0, this.shadowFrames - 1); }
    this.renderFrame();
    this.lap("render");
    this.perf.cpuMs = this.perf.cpuMs * 0.95 + (performance.now() - c0) * 0.05;
  };

  private move(dt: number) {
    if (this.seated) { this.avatar.update(dt, 0); return; }
    const k = this.keys;
    let fx = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) + this.stick.x;
    let fz = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) + this.stick.y;
    const len = Math.hypot(fx, fz); if (len > 1) { fx /= len; fz /= len; }
    const run = k.has("ShiftLeft") || k.has("ShiftRight") || this.runStick;
    const speed = run ? 2.8 : 1.4;
    // forward is where the camera looks (−z rotated by yaw)
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wx = (fx * cy - fz * sy) * speed, wz = (-fx * sy - fz * cy) * speed;
    const a = 1 - Math.exp(-dt * (len > 0.05 ? 9 : 12));
    this.vel.x += (wx - this.vel.x) * a; this.vel.y += (wz - this.vel.y) * a;
    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.y + this.vel.y * dt;
    const p = this.collide(nx, nz);
    const moved = Math.hypot(p.x - this.pos.x, p.y - this.pos.y);
    this.pos.copy(p);
    const sp = moved / Math.max(1e-4, dt);
    this.avatar.update(dt, sp);
    // footsteps every ~0.7 m, sounding like the floor
    this.stepAcc += moved; this.bob += moved * 4.4;
    if (this.stepAcc > (run ? 0.95 : 0.68)) {
      this.stepAcc = 0;
      const r = this.shell.roomAt(p.x, p.y), t = r?.type;
      const hard = t === "lobby" || t === "corridor" || t === "liftHall" || t === "stair" || t === "parking" || t === "plant" || t === "waiting" || t === "gallery" || t === "shop" || t === "service";
      this.o.sound.step(t === "bathroom" || t === "ensuite" || t === "utility" || t === "entrance" || t === "restroom" ? "tile" : hard || ((t === "living" || t === "kitchen" || t === "hall") && this.o.plan.style !== "wood_natural") ? "stone" : "wood", run);
    }
  }
  /** where the camera may stand on the way from the body to (x, z): short of the first wall, door or
   * jamb crossed (by 0.1 m), and at least 0.1 m off every face — so the near plane stays in the room */
  private clearOf(x: number, z: number): THREE.Vector2 {
    const segs = this.segs.concat(this.doorSegs()), px = this.pos.x, pz = this.pos.y;
    const len = Math.hypot(x - px, z - pz) || 1e-6;
    let t = 1;
    for (const [ax, az, bx, bz] of segs) { const h = segHit(px, pz, x, z, ax, az, bx, bz); if (h !== null) t = Math.min(t, Math.max(0, h - 0.1 / len)); }
    return this.collide(px + (x - px) * t, pz + (z - pz) * t, 0.1);
  }
  /** a circle against the wall and furniture segments (and the doors where they stand now) */
  private collide(x: number, z: number, radius = RADIUS, people = true): THREE.Vector2 {
    const RADIUS = radius;
    const segs = this.segs.concat(this.doorSegs());
    const p = new THREE.Vector2(x, z);
    for (let it = 0; it < 4; it++) {
      let pushed = false;
      for (const [ax, az, bx, bz] of segs) {
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - az) * dz) / l2));
        const cx = ax + dx * t, cz = az + dz * t, ex = p.x - cx, ez = p.y - cz, d = Math.hypot(ex, ez);
        if (d < RADIUS && d > 1e-6) { p.x = cx + (ex / d) * RADIUS; p.y = cz + (ez / d) * RADIUS; pushed = true; }
      }
      if (!pushed) break;
    }
    // (a building's people: stepped round, the walls still kept)
    if (this.people && people && radius > 0.15) for (const c of this.people.circles()) {
      const ex = p.x - c.x, ez = p.y - c.z, d = Math.hypot(ex, ez), r = c.r + radius;
      if (d < r && d > 1e-6) p.copy(this.collide(c.x + (ex / d) * r, c.z + (ez / d) * r, radius, false));
    }
    return p;
  }
  private doorSegs(): Seg[] {
    const out: Seg[] = [];
    for (const d of this.shell.doors) {
      if (d.kind === "slide") {
        if (d.fixedSeg) out.push(d.fixedSeg);
        const p = d.leaf.position, a = d.leaf.rotation.y, h = d.length / 2, ux = Math.cos(a), uz = -Math.sin(a);
        out.push([p.x - ux * h, p.z - uz * h, p.x + ux * h, p.z + uz * h]);
      } else {
        const a = d.pivot.rotation.y, ux = Math.cos(a), uz = -Math.sin(a);
        out.push([d.hinge[0], d.hinge[1], d.hinge[0] + ux * d.length, d.hinge[1] + uz * d.length]);
      }
    }
    return out;
  }
  private animateDoors(dt: number) {
    this.doorsMoving = false;
    for (const d of this.shell.doors) {
      if (d.t === d.want) continue;
      this.doorsMoving = true; this.shadowFrames = 1;
      d.t += Math.sign(d.want - d.t) * Math.min(Math.abs(d.want - d.t), dt * (d.kind === "slide" ? 1.3 : 1.6));
      const e = d.t * d.t * (3 - 2 * d.t);
      if (d.kind === "slide") d.leaf.position.lerpVectors(d.slideFrom!, d.slideTo!, e);
      else d.pivot.rotation.y = d.closedYaw + (d.openYaw - d.closedYaw) * e;
      if (d.t === d.want && d.kind === "swing" && d.want === 0) this.o.sound.play("thud");
    }
  }
  private lightsFrame(dt: number) {
    const s = sunAt(this.o.hour);
    let changed = false;
    for (const [z] of this.zoneLevel) {
      const want = switchState.get(z) === false ? 0 : 1, cur = this.zoneLevel.get(z)!;
      if (cur === want) continue;
      // (LEDs: on at once, off with a short fade)
      const next = want > cur ? want : Math.max(want, cur - dt * 9);
      this.zoneLevel.set(z, next); changed = true;
      zoneLevels.value[z] = next;
    }
    for (const r of this.rect) {
      if (r.window !== undefined) {
        const open = this.furn.curtainOpen.get(r.window)?.() ?? 1;
        const w = this.shell.windows[r.window];
        const facing = Math.max(0.35, 0.65 + 0.35 * -w.inward.dot(s.dir));
        r.light.intensity = 1.2 * s.skyIntensity * open * facing;
      } else if (changed) r.light.intensity = r.base * (this.zoneLevel.get(r.zone) ?? 1);
    }
    if (this.tvLight) this.tvLight.intensity += ((this.furn.tv?.on ? 1.3 : 0) - this.tvLight.intensity) * Math.min(1, dt * 6);
    if (changed && this.probeDirty === 0) this.probeDirty = 3;
    this.bounceFrame();
  }
  /** The light each room's lamps and windows put in, interreflected: a room with reflectance ρ
   * holds Φ/S·ρ/(1−ρ) of indirect light on its surfaces. What the probe can't give per room. */
  private bounceFrame() {
    const flux = new Map<number, number>();
    for (const r of this.rect) {
      if (r.zone < 0 || r.light.intensity <= 0) continue;
      flux.set(r.zone, (flux.get(r.zone) ?? 0) + Math.PI * r.light.intensity * r.light.width * r.light.height);
    }
    // (white paper and paint ≈ 0.5 over the room with its floor; tiled bathrooms ≈ 0.65)
    const k = (rho: number) => rho / (1 - rho) * BOUNCE;
    let fAll = 0, sAll = 0;
    for (const [z, S] of this.zoneArea) {
      const f = flux.get(z) ?? 0; fAll += f; sAll += S;
      zoneBounce.value[z] = (f / S) * k(this.wetZones.has(z) ? 0.65 : 0.5);
    }
    zoneBounce.value[0] = sAll ? (fAll / sAll) * k(0.5) : 0;
  }
  private applyCamera(dt: number) {
    const cam = this.camera;
    const floor = this.shell.floorAt(this.pos.x, this.pos.y);
    this.eyeY += (floor + EYE - this.eyeY) * Math.min(1, dt * 10 || 1);
    const ar = this.avatar.root;
    if (this.seated) {
      const s = this.seated;
      cam.position.copy(s.eye);
      const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
      if (s.pose === "lie") {
        // on the back, head at the eye, feet toward where it looks
        ar.rotation.set(-Math.PI / 2, s.yaw + Math.PI, 0, "YXZ");
        ar.position.set(s.eye.x + fx * 1.62, s.eye.y - 0.12, s.eye.z + fz * 1.62);
      } else {
        ar.rotation.set(0, s.yaw + Math.PI, 0, "YXZ");
        ar.position.set(s.eye.x - fx * 0.12, s.eye.y - 1.15, s.eye.z - fz * 0.12);
      }
    } else {
      ar.rotation.set(0, this.yaw + Math.PI, 0, "YXZ"); ar.position.set(this.pos.x, floor, this.pos.y);
      const bob = this.view === "first" ? Math.sin(this.bob) * 0.012 * Math.min(1, this.vel.length() / 1.4) : 0;
      if (this.view === "first") {
        // the eye a little in front of the face (never through a wall or a door's jamb: inside the
        // wall's thickness its faces are not drawn, and the frame flashed through it)
        const e = this.clearOf(this.pos.x - Math.sin(this.yaw) * 0.13, this.pos.y - Math.cos(this.yaw) * 0.13);
        cam.position.set(e.x, this.eyeY + bob, e.y);
      } else {
        // over the shoulder, pulled in before a wall
        const back = 1.5, bx = Math.sin(this.yaw), bz = Math.cos(this.yaw);
        let d = back;
        for (const [ax, az, cx, cz] of this.segs) {
          const hit = segHit(this.pos.x, this.pos.y, this.pos.x + bx * back, this.pos.y + bz * back, ax, az, cx, cz);
          if (hit !== null) d = Math.min(d, hit * back - 0.15);
        }
        d = Math.max(0.25, d);
        // (pulled in quickly before a wall, let out slowly)
        const sb = this.shown;
        sb.boom = dt > 0 ? sb.boom + (d - sb.boom) * (1 - Math.exp(-dt * (d < sb.boom ? 18 : 3))) : d;
        d = Math.min(d + 0.05, sb.boom);
        // (the shoulder's offset too kept on this side of the walls: in a narrow hall it put the
        // camera inside one)
        const e = this.clearOf(this.pos.x + bx * d + Math.cos(this.yaw) * 0.25, this.pos.y + bz * d - Math.sin(this.yaw) * 0.25);
        cam.position.set(e.x, this.eyeY + 0.12, e.y);
      }
    }
    // eased toward what was set (dt 0: the warm-up renders, at once)
    const sh = this.shown;
    if (!sh.init || dt <= 0) { sh.yaw = this.yaw; sh.pitch = this.pitch; sh.pos.copy(cam.position); sh.init = true; }
    else {
      sh.ease = Math.max(0, sh.ease - dt);
      const k = 1 - Math.exp(-dt * (sh.ease > 0 ? 6 : 40)), kp = sh.ease > 0 ? 1 - Math.exp(-dt * 6) : 1;
      let dy = this.yaw - sh.yaw; dy -= Math.round(dy / (Math.PI * 2)) * Math.PI * 2;
      sh.yaw += dy * k; sh.pitch += (this.pitch - sh.pitch) * k;
      sh.pos.lerp(cam.position, kp); cam.position.copy(sh.pos);
    }
    cam.rotation.set(sh.pitch, sh.yaw, 0, "YXZ");
    // what the hand holds: low and to the right of the eye, or before the body seen from behind
    if (this.furn.pantry.hand) {
      const m = this.holdM; cam.updateMatrixWorld();
      if (this.view === "first" && !this.seated) m.multiplyMatrices(cam.matrixWorld, this.holdEye);
      else m.makeRotationY(this.yaw).setPosition(this.pos.x - Math.sin(this.yaw) * 0.34, this.shell.floorAt(this.pos.x, this.pos.y) + 0.98, this.pos.y - Math.cos(this.yaw) * 0.34);
      this.furn.pantry.holdAt(m);
    }
    // the head hidden from its own eye (the body stays: look down and it's there)
    ar.visible = this.seated?.label !== "화면" && this.seated?.label !== "반려동물" && (this.view === "third" || (!(this.seated?.pose === "lie") && (this.pitch < -0.55 || this.mirrors.some(m => m.position.distanceTo(cam.position) < 4.5))));
    cam.updateMatrixWorld();
  }
  private pick() {
    // (zoomed in on a screen, the screen is the whole world: nothing else to point at)
    if (this.seated?.label === "화면" || this.seated?.label === "반려동물") { this.target = null; this.emitHud(); return; }
    this.ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this.ray.far = this.view === "third" ? 3.6 : 2.3;
    let best: Interactable | null = null, bd = Infinity;
    for (const it of this.interactables) {
      if (it.enabled && !it.enabled()) continue;
      const hits = this.ray.intersectObject(it.hit, true);
      if (hits.length && hits[0].distance < bd) { bd = hits[0].distance; best = it; }
    }
    // (only what isn't behind a wall: the walls cut the ray)
    if (best) {
      const p = this.camera.position, q = p.clone().addScaledVector(this.ray.ray.direction, bd);
      if (this.segs.slice(0, this.shell.segments.length).some(([a, b, c, d]) => segHit(p.x, p.z, q.x, q.z, a, b, c, d) !== null && Math.hypot(q.x - p.x, q.z - p.z) > 0.3)) best = null;
    }
    this.target = best;
    this.emitHud();
  }
  /** one frame through the post chain; the AO reads the depth of whichever buffer the scene is drawn into */
  private renderFrame() {
    const d = this.composer.readBuffer.depthTexture;
    if (d && this.gtao.depthTexture !== d) this.gtao.setGBuffer(d);
    this.composer.render();
  }
  private emitHud(force = false) {
    const room = this.shell.roomAt(this.pos.x, this.pos.y)?.label ?? "";
    const h: HudState = { target: this.target?.label() ?? null, room, seated: this.seated?.label ?? null, view: this.view, pet: this.target?.id === "cat" };
    if (force || h.target !== this.hud.target || h.room !== this.hud.room || h.seated !== this.hud.seated || h.view !== this.hud.view || h.pet !== this.hud.pet) { this.hud = h; this.o.onHud?.(h); }
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix();
    if (this.composer) {
      const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.composer.setSize(s.x, s.y); this.gtao.setSize(s.x, s.y);
    }
  }

  /** frame statistics since entry (for the measurement script) */
  stats() {
    const iv = this.perf.intervals.slice().sort((a, b) => a - b), n = iv.length;
    const q = (k: number) => iv[Math.min(n - 1, Math.floor(n * k))] ?? 0;
    // the lowest fps over any one second
    let worst1s = Infinity, acc = 0, cnt = 0;
    const seq = this.perf.intervals;
    for (let i = 0, j = 0; i < seq.length; i++) { acc += seq[i]; cnt++; while (acc > 1000 && j < i) { acc -= seq[j++]; cnt--; } if (acc >= 990) worst1s = Math.min(worst1s, (cnt * 1000) / acc); }
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    return { frames: n, avgFps: n ? 1000 / (seq.reduce((a, b) => a + b, 0) / n) : 0, min1sFps: Number.isFinite(worst1s) ? worst1s : null, p95: q(0.95), p99: q(0.99), maxMs: this.perf.worst, cpuMs: this.perf.cpuMs, loadMs: this.perf.loadMs, phases: this.perf.phases, seg: Object.fromEntries(Object.entries(this.perf.seg).map(([k, v]) => [k, +v.toFixed(2)])), long: this.perf.long.map(l => `${l.at}ms ${l.ms}ms ${l.room}`),
      drawingBuffer: [size.x, size.y], pixelRatio: this.renderer.getPixelRatio(), calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.keyDown, true); window.removeEventListener("keyup", this.keyUp, true); window.removeEventListener("blur", this.blur);
    this.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry?.dispose(); });
    this.mirrors.forEach(m => m.dispose());
    this.furn?.dispose();
    this.lib?.dispose();
    this.shell?.lampMeshes.forEach(l => l.forEach(m => m.dispose()));
    this.viewRT?.dispose(); this.probe?.rt.dispose(); this.probe?.env?.dispose(); this.probe?.pmrem.dispose(); this.wetProbe?.dispose(); this.placeholder?.dispose();
    this.composer?.renderTarget1.depthTexture?.dispose(); this.composer?.renderTarget2.depthTexture?.dispose();
    this.composer?.renderTarget1.dispose(); this.composer?.renderTarget2.dispose(); this.gtao?.dispose(); this.bloom?.dispose();
    this.renderer.setOpaqueSort(null);
    this.sun.shadow.map?.dispose();
    this.people?.dispose(); this.facDispose?.();
    this.avatar.dispose(); this.cat?.dispose(); this.robot?.dispose(); this.o.sound.purr(0); this.o.sound.whirr(0);
    this.scene.clear();
  }
}

/** where segment p→q crosses a→b, as a fraction of p→q (null if not) */
function segHit(px: number, pz: number, qx: number, qz: number, ax: number, az: number, bx: number, bz: number): number | null {
  const rx = qx - px, rz = qz - pz, sx = bx - ax, sz = bz - az, den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((ax - px) * sz - (az - pz) * sx) / den, u = ((ax - px) * rz - (az - pz) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
