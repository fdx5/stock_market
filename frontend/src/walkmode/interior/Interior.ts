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
import { furnish, shadowMoved, switchState, type Furnished, type Interactable, type MonitorScreen } from "./furnish";
import type { VendingSession } from "./vending";
import { BASE_SETS, loadSets, disposeSets, Library, makePalette, SETS, STYLE_SETS, type Palette, type SetName } from "./materials";
import { boxProjected, probeBox, zones as zoneTable, zoneLit, type ZoneUniform } from "./lightZones";
import { paintedView, sunAt } from "./view";
import { waterTime } from "./water";
import { Avatar } from "../player/avatar";
import { Cat, Robot, type PetKind } from "./life";
import { CONSUME, ITEM_NAME, type ItemKind } from "./pantry";
import { SHOP_LABEL, shopOf, type ShopItem, type ShopKind } from "./shop";
import { missions } from "../game/missions";
import { SOCIAL_LABEL, type Social } from "./npcLines";
import { wallet } from "../game/wallet";
import type { Sound, WaterKind } from "../game/sound";
import type { FloorPlan } from "./plan/types";
import { facilityLook } from "./facilityMaterials";
import { People, type PersonTalk } from "./facilityPeople";
import type { Spot } from "./facilityFurnish";
import { withKitGeometryCache } from "./models";
import { applyViewFov, viewPreferences } from "../viewPreferences";
import { furnitureFootprints, walkingSpawn } from "./spawn";
import { InteriorSafetyError, interiorReachability } from "./navigation";
import {moveThroughGaps,passageNear} from './movement';

/* The interior: a flat built from its plan, furnished, lit and walked through. One renderer (the
 * page's); its output resolution is set once on entry and kept. Everything that could cost a frame
 * later — textures, programs, the reflection probes — is done behind the loading bar. */

export interface HudState { target: string | null; room: string; seated: string | null; view: "first" | "third"; /** the whole flat seen from above, cut below the ceiling */ overhead?: boolean; /** the target is the pet (it can be looked at up close) */ pet?: boolean; /** what R does with the hand's item now ("콜라 마시기"), or that it is being drunk */ use?: string | null; /** the way being shown on the floor: where to, how far */ guide?: string | null }
/** a building's person spoken to: their words, where they can show the way to, what to ask next */
export interface InteriorTalk { name: string; text: string; /** liking for the visitor (0…100) and in words */ rel?: number; relWord?: string; destinations: { label: string; x: number; z: number }[]; directory: { label: string; uses: string }[]; questions: string[]; /** what they sell here, if anything */ shop?: { kind: ShopKind; label: string } | null }
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
  onMonitor?(): void;
  onVending?(session: VendingSession): void;
  /** a shelf's or a counter's goods (the page's shop menu), and a word on the screen for a moment */
  onShop?(kind: ShopKind, label: string): void;
  onToast?(text: string): void;
  /** a building's person talked to (the page shows the dialogue), or the talk over (null) */
  onTalk?(t: InteriorTalk | null): void;
  levels?: { level: number; label: string; uses: string }[];
}

const EYE = 1.6, RADIUS = 0.24;
// Three's init replaces global LTC tables with new textures. Repeating it on every floor left
// the previous two GPU tables alive. The same immutable tables serve all interior instances.
let areaLightsReady = false;
function ensureAreaLights() { if (!areaLightsReady) { RectAreaLightUniformsLib.init(); areaLightsReady = true; } }
/** a plan this big across (m) is a large floor — a hospital's, a mall's: its batches cut into
 * squares, its lamps sharing the area lights, its far parts not drawn */
const LARGE = 48;
/** how far a large floor's walls, floors and ceilings are drawn, and its furniture and fittings (m) */
const SHELL_FAR = 95, FURN_FAR = 48;
/** the share of a lamp's light that falls evenly on its zone when no area light is lighting it */
const FILL = 0.55;

/** One lamp of the plan (a ceiling light, a window's daylight, the TV): where and how bright. A
 * large floor has far more of them than the scene's RECT_LIGHTS area lights, which are handed to
 * the ones nearest the walker and faded across; the rest light their zone as an even fill. */
interface Lamp { zone: number; pos: THREE.Vector3; look: THREE.Vector3; w: number; h: number; color: THREE.Color; base: number; window?: number; tv?: boolean; now: number; k: number }

/** The wall and furniture segments in 4 m cells: walking, the camera and the look ray test only
 * those near them (a large floor has tens of thousands). */
class SegGrid {
  private cells = new Map<number, number[]>();
  private mark: Uint32Array; private stamp = 0;
  constructor(private segs: Seg[], private C = 4) {
    this.mark = new Uint32Array(segs.length);
    segs.forEach(([ax, az, bx, bz], i) => {
      const i0 = Math.floor(Math.min(ax, bx) / C), i1 = Math.floor(Math.max(ax, bx) / C), j0 = Math.floor(Math.min(az, bz) / C), j1 = Math.floor(Math.max(az, bz) / C);
      for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) { const k = (a + 2048) * 4096 + (b + 2048); const l = this.cells.get(k); if (l) l.push(i); else this.cells.set(k, [i]); }
    });
  }
  /** the segments in the cells a box touches, each once */
  query(x0: number, z0: number, x1: number, z1: number, out: Seg[] = []): Seg[] {
    const C = this.C; if (++this.stamp === 0xffffffff) { this.mark.fill(0); this.stamp = 1; }
    for (let a = Math.floor(Math.min(x0, x1) / C); a <= Math.floor(Math.max(x0, x1) / C); a++) for (let b = Math.floor(Math.min(z0, z1) / C); b <= Math.floor(Math.max(z0, z1) / C); b++) {
      const l = this.cells.get((a + 2048) * 4096 + (b + 2048)); if (!l) continue;
      for (const i of l) if (this.mark[i] !== this.stamp) { this.mark[i] = this.stamp; out.push(this.segs[i]); }
    }
    return out;
  }
}
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
  ensureAreaLights();
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
  /** every lamp of the plan, and the scene's area lights each lighting one of them (null: free) */
  private lamps: Lamp[] = [];
  private pool: { light: THREE.RectAreaLight; lamp: Lamp | null }[] = [];
  private poolAt = new THREE.Vector3(1e9, 0, 0); private poolT = 0;
  /** the floor area of each zone (for its fill) */
  private zoneFloor = new Map<number, number>();
  private large = false;
  private grid!: SegGrid;
  /** a large floor's meshes and how far each is drawn: its bounds' middle and radius */
  private culled: { o: THREE.Object3D; c: THREE.Vector3; r: number; far: number }[] = [];
  private cullAt = new THREE.Vector3(1e9, 0, 0);
  private shadowAt = new THREE.Vector3(1e9, 0, 0);
  private hitAt = new WeakMap<Interactable, THREE.Vector3>();
  private zoneLevel = new Map<number, number>();
  /** each zone's surface area (floor, ceiling, walls), for its bounce light */
  private zoneArea = new Map<number, number>();
  private wetZones = new Set<number>();
  private tvLamp: Lamp | null = null;
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
  overhead = false;
  inspectionMode=false;
  inspectionIssues:string[]=[];
  /** the camera as shown: it follows pos/yaw/pitch — at once while walking and looking, eased over
   * a moment when they jump (sitting, lying, standing, changing view), never a sudden turn */
  private shown = { yaw: 0, pitch: -0.05, pos: new THREE.Vector3(), anchor: new THREE.Vector2(), boom: 1.5, ease: 0, init: false };
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
  /** Drinking or eating what is in the hand: raised to the mouth and tipped (first person), or held
   * at the face (third); its sounds on their beats — opened, swallowed three times, then 캬~. */
  private sip: { t: number; obj: THREE.Object3D; how: "can" | "carton" | "bottle" | "cup" | "crunch" | "soft"; name: string; own: boolean; beat: number } | null = null;
  private sipM = new THREE.Matrix4(); private sipQ = new THREE.Quaternion(); private sipE = new THREE.Euler(); private sipP = new THREE.Vector3(); private sipS = new THREE.Vector3(1, 1, 1);
  /** R: the hand's item drunk or eaten (milk, cola, beer, fruit, cake…) */
  consumeHand(): boolean {
    const k = this.furn.pantry.handKind() as ItemKind | null, how = k ? CONSUME[k] : undefined;
    if (this.sip || !k || !how || !this.furn.pantry.hand) return false;
    this.startSip(this.furn.pantry.hand, how, ITEM_NAME[k], false);
    return true;
  }
  private startSip(obj: THREE.Object3D, how: NonNullable<Interior["sip"]>["how"], name: string, own: boolean) {
    this.o.sound.resume();
    if (own) { obj.matrixAutoUpdate = false; this.dynamic.add(obj); }
    this.sip = { t: 0, obj, how, name, own, beat: 0 };
    this.emitHud(true);
  }
  private sipBeats(dt: number) {
    const s = this.sip; if (!s) return;
    s.t += dt;
    const food = s.how === "crunch" || s.how === "soft", snd = this.o.sound;
    // (the beats: open at 0.15 s; three swallows from 0.9 s; the voice after; done at 3.6 s)
    const beats = food ? [0.35, 1.5, 2.55] : [0.15, 0.95, 1.4, 1.85, 2.45];
    while (s.beat < beats.length && s.t >= beats[s.beat]) {
      const b = s.beat++;
      if (food) { if (b < 2) snd.chew(s.how === "crunch"); else { snd.gulp(0.6); snd.ahh(true); } }
      else if (b === 0) { if (s.how === "can") snd.canOpen(); else if (s.how === "cup") snd.play("click"); else snd.capOpen(); }
      else if (b < 4) snd.gulp(1 - (b - 1) * 0.12);
      else snd.ahh(false);
    }
    if (s.t >= (food ? 3.6 : 3.4)) {
      if (s.own) { s.obj.removeFromParent(); s.obj.traverse(o => { if (!(o instanceof THREE.Mesh)) return; if (o.userData.dropMaterial) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }); (s.obj.children[0] as THREE.Mesh | undefined)?.geometry.dispose(); }
      else this.furn.pantry.consume();
      missions.event(food ? "eat" : "drink");
      this.sip = null; this.emitHud(true);
    }
  }
  /** Something bought at a counter, had there and then: a can, a bottle, a cup (with its lid), a
   * carton or a bite of food, made in its colour and brought to the mouth with its sounds. */
  consumeBought(it: ShopItem): boolean {
    if (this.sip || this.furn.pantry.hand || !it.how) return false;
    const how = it.how, g = new THREE.Group(), col = new THREE.Color(it.color);
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.4, metalness: how === "can" ? 0.6 : 0 });
    const geo = how === "can" ? new THREE.CylinderGeometry(0.033, 0.033, 0.122, 18) : how === "bottle" ? new THREE.CylinderGeometry(0.03, 0.034, 0.2, 14) : how === "cup" ? new THREE.CylinderGeometry(0.045, 0.034, 0.14, 18)
      : how === "carton" ? new THREE.BoxGeometry(0.055, 0.1, 0.04) : new THREE.BoxGeometry(0.1, 0.05, 0.08);
    const body = new THREE.Mesh(geo, mat); g.add(body);
    // (a cup's white lid, a bottle's cap)
    if (how === "cup" || how === "bottle") { const lid = new THREE.Mesh(new THREE.CylinderGeometry(how === "cup" ? 0.047 : 0.016, how === "cup" ? 0.047 : 0.016, 0.014, 14), new THREE.MeshStandardMaterial({ color: "#f4f4f1", roughness: 0.6 })); lid.position.y = how === "cup" ? 0.077 : 0.107; g.add(lid); }
    g.traverse(o => { if (o instanceof THREE.Mesh) o.userData.dropMaterial = true; });
    this.startSip(g, how, it.name, true);
    return true;
  }
  /** where the item is while it is drunk: raised and tipped toward the mouth, then lowered */
  private sipPose(cam: THREE.Camera) {
    const s = this.sip; if (!s) return;
    const food = s.how === "crunch" || s.how === "soft", T = food ? 3.6 : 3.4;
    const up = Math.min(1, s.t / 0.55), down = Math.max(0, (s.t - (T - 0.6)) / 0.6), lift = up * (1 - down);
    const ease = lift * lift * (3 - 2 * lift);
    // (tipped back while swallowing; a bite is brought to the mouth and moved a little)
    const tip = food ? 0.45 * ease : ease * (0.8 + 0.3 * Math.max(0, Math.min(1, (s.t - 0.9) / 1.3)));
    const chew = food ? Math.sin(s.t * 9) * 0.01 * ease : 0;
    if (this.view === "first" && !this.seated) {
      // (brought up toward the mouth, below the eye and a hand's length off — not into the lens)
      this.sipP.set(0.15 - 0.1 * ease, -0.2 + 0.08 * ease + chew, -0.4 + 0.08 * ease);
      this.sipQ.setFromEuler(this.sipE.set(0.25 + tip, -0.35 * (1 - ease), 0));
      this.sipM.compose(this.sipP, this.sipQ, this.sipS);
      cam.updateMatrixWorld(); this.holdM.multiplyMatrices(cam.matrixWorld, this.sipM);
    } else {
      const fy = this.shell.floorAt(this.pos.x, this.pos.y), y = fy + 0.98 + 0.58 * ease;
      const d = 0.34 - 0.18 * ease;
      this.holdM.makeRotationFromEuler(this.sipE.set(-tip, this.yaw, 0, "YXZ")).setPosition(this.pos.x - Math.sin(this.yaw) * d, y, this.pos.y - Math.cos(this.yaw) * d);
    }
    s.obj.matrix.copy(this.holdM); s.obj.matrixWorldNeedsUpdate = true;
  }
  // ---------------------------------------------------------------- talk and the way shown
  private talking: PersonTalk | null = null;
  private static peer(role: PersonTalk["role"]) { return role === "patient" || role === "visitor" || role === "shopper" || role === "student" || role === "guest"; }
  private openTalk(t: PersonTalk) {
    if (this.talking?.id !== t.id) missions.event("talk");
    this.talking = t;
    if (!this.o.onTalk) return;
    document.exitPointerLock?.();
    this.keys.clear();
    this.emitTalk(t.text, t.rel, t.relWord);
  }
  /** the dialogue's actions, in order: the social ones (a gift when something is carried), more talk, goodbye */
  private talkActions: (Social | "more" | "bye")[] = [];
  private emitTalk(text: string, rel: number, relWord: string) {
    const t = this.talking; if (!t || !this.o.onTalk) return;
    const shop = shopOf(t.room, this.o.plan.facility?.kind ?? "", t.role);
    const gift = wallet.items.find(i => i.kind === "goods");
    this.talkActions = ["greet", "joke", "compliment", "story", "rumor", "worry", "building", "tip", ...(gift ? ["gift" as const] : []), "more", "bye"];
    this.o.onTalk({ name: t.name, text, rel, relWord, destinations: this.destinations(), directory: this.o.levels ?? [], shop: shop ? { kind: shop, label: t.room && !/복도|로비/.test(t.room) ? t.room : SHOP_LABEL[shop] } : null,
      questions: this.talkActions.map(a => a === "more" ? "다른 얘기도 들려주세요" : a === "bye" ? (Interior.peer(t.role) ? "좋은 하루 되세요" : "고맙습니다") : a === "gift" ? `🎁 ${gift!.name} 선물하기` : SOCIAL_LABEL[a]) });
  }
  /** the dialogue's buttons: a social action (their answer, their liking for the visitor changed),
   * more talk, or thanks and goodbye */
  ask(i: number) {
    const t = this.talking; if (!t || !this.people) return;
    const a = this.talkActions[i];
    if (a === "more") { this.people.talkAgain(t.id); return; }
    if (a && a !== "bye") {
      const gift = a === "gift" ? wallet.items.find(x => x.kind === "goods") : undefined;
      if (a === "gift" && gift) wallet.use(gift.id);
      const places = [...new Set(this.o.plan.rooms.map(r => r.label).filter(l => !/복도|화장실|계단|창고|준비실|의국|직원|재구성/.test(l)))].slice(0, 30);
      const ans = this.people.social(t.id, a, places, gift?.name); if (!ans) return;
      missions.event(a === "gift" ? "gift" : "social");
      this.emitTalk(ans.text, ans.rel, ans.relWord);
      return;
    }
    this.people.reply(t.id, Interior.peer(t.role) ? ["네, 그쪽도요!", "감사합니다, 안녕히 가세요.", "네~ 다음에 또 봬요."][t.id % 3] : ["천만에요, 좋은 하루 되세요!", "네, 조심히 다니세요.", "별말씀을요. 또 필요하면 불러 주세요."][t.id % 3]);
    this.closeTalk();
  }
  closeTalk() { this.talking = null; this.o.onTalk?.(null); }
  /** where on this floor the way can be shown: lifts, toilets, the counters, shops, departments, the
   * vending machines and the way out — the nearest of each, by name, nearest first */
  private destinations(): { label: string; x: number; z: number }[] {
    const plan = this.o.plan, out: { label: string; x: number; z: number; d: number }[] = [];
    const add = (label: string, x: number, z: number) => {
      const d = Math.hypot(x - this.pos.x, z - this.pos.y), old = out.find(o => o.label === label);
      if (old) { if (d < old.d) Object.assign(old, { x, z, d }); return; }
      out.push({ label, x, z, d });
    };
    const name = (l: string) => l.replace(/\s*\d+$/, "");
    for (const r of plan.rooms) {
      const x = (r.rect[0] + r.rect[2]) / 2, z = (r.rect[1] + r.rect[3]) / 2, l = r.label;
      if (r.type === "liftHall" || /엘리베이터/.test(l)) add("엘리베이터", x, z);
      else if (r.type === "restroom" || /화장실/.test(l)) add("화장실", x, z);
      // (the staff's own rooms — 준비실, 의국, 창고, 직원실, single consulting rooms — are not destinations)
      else if (/준비실|의국|창고|직원|처치|상담실|진료실|검사실|기계|전기|설비|재구성/.test(l)) continue;
      else if (/원무|접수|수납|안내|약국|편의점|카페|커피|식당|푸드|매점|은행|ATM/.test(l)) add(name(l), x, z);
      else if (/센터|채혈|영상|응급|대기/.test(l) && !/복도/.test(l)) add(name(l), x, z);
    }
    for (const it of this.interactables) if (it.id.startsWith("vending-")) { it.hit.getWorldPosition(this.tmpV); add("음료 자판기", this.tmpV.x, this.tmpV.z); }
    const door = plan.openings.find(o => o.type === "front_door");
    if (door) add("출입구", door.axis === "x" ? door.at : door.center, door.axis === "x" ? door.center : door.at);
    return out.sort((a, b) => a.d - b.d).slice(0, 12).map(({ label, x, z }) => ({ label, x, z }));
  }
  private guide: { mesh: THREE.InstancedMesh; to: THREE.Vector2; label: string; path: THREE.Vector2[]; t: number } | null = null;
  /** Show the way to (x, z) on the floor: a line of glowing chevrons along the shortest walkable
   * route (a body-sized search round the walls and furniture), gone on arrival. */
  guideTo(x: number, z: number, label = "목적지") {
    this.clearGuide();
    const path = this.route([this.pos.x, this.pos.y], [x, z]);
    this.closeTalk();
    if (!path) { this.o.onHud?.({ ...this.hud, guide: `${label}: 이 층에서 가는 길을 찾지 못했어요` }); return false; }
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i], b = path[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = i === 0 ? 0.9 : 0; t < l; t += 0.9) pts.push(new THREE.Vector2(a[0] + (b[0] - a[0]) * t / l, a[1] + (b[1] - a[1]) * t / l));
    }
    const shape = new THREE.Shape([new THREE.Vector2(-0.16, -0.1), new THREE.Vector2(0, 0.08), new THREE.Vector2(0.16, -0.1), new THREE.Vector2(0.16, 0.02), new THREE.Vector2(0, 0.2), new THREE.Vector2(-0.16, 0.02)]);
    const geo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: "#5ef0ff", transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, pts.length)); mesh.frustumCulled = false; mesh.renderOrder = 5;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1), at = new THREE.Vector3();
    pts.forEach((p, i) => {
      const n = pts[Math.min(pts.length - 1, i + 1)], prev = pts[Math.max(0, i - 1)], dx = n.x - prev.x, dz = n.y - prev.y;
      // (the chevron's tip, +y in its shape, rotated onto −z, turned to the way ahead)
      q.setFromAxisAngle(up, Math.atan2(-dx, -dz));
      mesh.setMatrixAt(i, m.compose(at.set(p.x, this.shell.floorAt(p.x, p.y) + 0.02, p.y), q, sc));
    });
    mesh.count = pts.length; mesh.instanceMatrix.needsUpdate = true;
    this.dynamic.add(mesh);
    this.guide = { mesh, to: new THREE.Vector2(x, z), label, path: path.map(p => new THREE.Vector2(p[0], p[1])), t: 0 };
    this.emitHud(true);
    return true;
  }
  clearGuide() {
    const g = this.guide; if (!g) return;
    g.mesh.removeFromParent(); g.mesh.geometry.dispose(); (g.mesh.material as THREE.Material).dispose(); g.mesh.dispose();
    this.guide = null; if (!this.disposed) this.emitHud(true);
  }
  private guideLeft() {
    const g = this.guide; if (!g) return 0;
    // (along the route from its point nearest the walker)
    let best = 0, bd = Infinity;
    g.path.forEach((p, i) => { const d = p.distanceTo(this.pos); if (d < bd) { bd = d; best = i; } });
    let left = bd; for (let i = best; i + 1 < g.path.length; i++) left += g.path[i].distanceTo(g.path[i + 1]);
    return left;
  }
  private guideTick(dt: number) {
    const g = this.guide; if (!g) return;
    g.t += dt;
    (g.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.35 * Math.sin(g.t * 4);
    if (this.pos.distanceTo(g.to) < 1.6) {
      this.clearGuide(); missions.event("guide"); this.o.onHud?.({ ...this.hud, guide: `${g.label}에 도착했어요` });
      setTimeout(() => { if (!this.guide && !this.disposed) this.emitHud(true); }, 2500); return;
    }
    if (Math.floor(g.t * 2) !== Math.floor((g.t - dt) * 2)) this.emitHud();
  }
  /** the shortest body-sized way between two points: A* on a 0.25 m grid over the rooms, each
   * cell clear of walls and furniture by 0.22 m, then straightened where the line is clear */
  private route(from: [number, number], to: [number, number]): [number, number][] | null {
    const [x0, z0, x1, z1] = this.o.plan.bounds, C = 0.25, R = 0.22, nx = Math.ceil((x1 - x0) / C), nz = Math.ceil((z1 - z0) / C);
    if (nx < 1 || nz < 1 || nx * nz > 4_000_000) return null;
    const state = new Uint8Array(nx * nz); // 0 unknown, 1 free, 2 blocked
    const rooms = this.o.plan.rooms;
    const free = (k: number) => {
      if (state[k]) return state[k] === 1;
      const x = x0 + (k % nx + 0.5) * C, z = z0 + (Math.floor(k / nx) + 0.5) * C;
      let ok = rooms.some(r => x >= r.rect[0] && x <= r.rect[2] && z >= r.rect[1] && z <= r.rect[3]);
      if (ok) for (const [a, b, c, d] of this.grid.query(x - R - .05, z - R - .05, x + R + .05, z + R + .05)) {
        const dx = c - a, dz = d - b, t = Math.max(0, Math.min(1, ((x - a) * dx + (z - b) * dz) / (dx * dx + dz * dz || 1)));
        if (Math.hypot(x - a - t * dx, z - b - t * dz) < R) { ok = false; break; }
      }
      state[k] = ok ? 1 : 2; return ok;
    };
    const cell = (x: number, z: number) => Math.max(0, Math.min(nx - 1, Math.floor((x - x0) / C))) + Math.max(0, Math.min(nz - 1, Math.floor((z - z0) / C))) * nx;
    // (the nearest free cells to the two ends: the walker and a counter may stand by furniture)
    const near = (x: number, z: number) => {
      const c0 = cell(x, z); if (free(c0)) return c0;
      for (let r = 1; r < 14; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        const ci = (c0 % nx) + i, cj = Math.floor(c0 / nx) + j; if (ci < 0 || cj < 0 || ci >= nx || cj >= nz) continue;
        const k = ci + cj * nx; if (free(k)) return k;
      }
      return -1;
    };
    const s = near(...from), e = near(...to); if (s < 0 || e < 0) return null;
    const g = new Float32Array(nx * nz).fill(Infinity), came = new Int32Array(nx * nz).fill(-1), closed = new Uint8Array(nx * nz);
    const ex = e % nx, ez = Math.floor(e / nx), h = (k: number) => Math.hypot(k % nx - ex, Math.floor(k / nx) - ez);
    // (a binary heap of cells by f)
    const hf: number[] = [], hk: number[] = [];
    const push = (f: number, k: number) => {
      let i = hf.length; hf.push(f); hk.push(k);
      while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; hf[i] = hf[p]; hk[i] = hk[p]; i = p; }
      hf[i] = f; hk[i] = k;
    };
    const pop = () => {
      const top = hk[0], lf = hf.pop()!, lk = hk.pop()!, n = hf.length;
      if (n) {
        let i = 0;
        for (;;) { const l = i * 2 + 1, r = l + 1; let m = -1, mf = lf; if (l < n && hf[l] < mf) { m = l; mf = hf[l]; } if (r < n && hf[r] < mf) { m = r; } if (m < 0) break; hf[i] = hf[m]; hk[i] = hk[m]; i = m; }
        hf[i] = lf; hk[i] = lk;
      }
      return top;
    };
    g[s] = 0; push(h(s), s);
    let found = false, steps = 0;
    while (hf.length && steps++ < 800000) {
      const k = pop(); if (closed[k]) continue; closed[k] = 1;
      if (k === e) { found = true; break; }
      const i = k % nx, j = Math.floor(k / nx);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const q = a + b * nx; if (closed[q] || !free(q)) continue;
        // (no corner cutting past a blocked cell)
        if (di && dj && (!free(i + di + j * nx) || !free(i + (j + dj) * nx))) continue;
        const ng = g[k] + (di && dj ? Math.SQRT2 : 1);
        if (ng < g[q]) { g[q] = ng; came[q] = k; push(ng + h(q), q); }
      }
    }
    if (!found) return null;
    const cells: [number, number][] = [];
    for (let k = e; k >= 0; k = came[k]) { cells.push([x0 + (k % nx + 0.5) * C, z0 + (Math.floor(k / nx) + 0.5) * C]); if (k === s) break; }
    cells.reverse();
    // (straightened: from each kept point to the farthest one in clear sight, sampled every 0.2 m)
    const clearLine = (a: [number, number], b: [number, number]) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 0; t <= l; t += 0.2) if (!free(cell(a[0] + (b[0] - a[0]) * t / l, a[1] + (b[1] - a[1]) * t / l))) return false; return true; };
    const out: [number, number][] = [from];
    let i = 0;
    while (i < cells.length - 1) { let j = cells.length - 1; while (j > i + 1 && !clearLine(cells[i], cells[j])) j--; out.push(cells[j]); i = j; }
    out.push(to);
    return out;
  }
  /** (where a frame's time goes: a running average a section) */
  private lap(name: string) { const t = performance.now(), s = this.perf.seg; s[name] = (s[name] ?? 0) * 0.98 + (t - this.segT) * 0.02; this.segT = t; }

  constructor(readonly renderer: THREE.WebGLRenderer, private o: InteriorOptions) {
    ensureAreaLights();
    this.scene.add(this.static, this.dynamic, this.avatar.root);
    // (the sun's shadow map is drawn only when the flat's own things move: the walker casts none)
    this.avatar.root.traverse(o => { o.castShadow = false; });
  }

  // ---------------------------------------------------------------- loading
  async load(signal?: AbortSignal) {
    const t0 = performance.now(), plan = this.o.plan, P = (k: number, s: string) => this.o.onProgress?.(k, s);
    this.large = Math.max(plan.bounds[2] - plan.bounds[0], plan.bounds[3] - plan.bounds[1]) > LARGE;
    // (the recorded sounds come down alongside, without holding the flat up)
    void this.o.sound.loadRecordings();
    const mark = (n: string, t: number) => { this.perf.phases[n] = Math.round(performance.now() - t); return performance.now(); };
    let t = t0;
    P(0.02, "자재 텍스처를 내려받는 중");
    // (the common sets, and the style's own floors and tiles only)
    const names: SetName[] = [...new Set<SetName>([...BASE_SETS, ...STYLE_SETS[plan.style]])];
    const sets = await loadSets(names, (k, label) => P(0.02 + k * 0.5, label), signal);
    if (this.disposed) {disposeSets(sets);return;}
    t = mark("textures", t);
    this.lib = new Library(sets);
    this.P = makePalette(this.lib, plan.style);
    // (a building: its own floors and things over the style's — facilityMaterials.ts)
    const look = plan.facility ? facilityLook(this.P, plan.facility.kind, plan.facility.name, this.lib) : null;
    const spots: Spot[] = [];
    if (look) { this.P = look.P; this.facDispose = look.dispose; }
    P(0.54, "벽·바닥·천장을 세우는 중");
    await nextFrame();
    const B = new Batcher(this.large ? 16 : 0);
    this.shell = buildShell(plan, this.P, B, this.dynamic, look?.finishes);
    // (the walls, floors and ceilings drawn further than the things in the rooms)
    const shellMeshes = B.build();
    for (const m of shellMeshes) this.static.add(m);
    t = mark("shell", t);
    await nextFrame();
    P(0.6, "가구와 설비를 배치하는 중");
    switchState.clear();
    this.furn = withKitGeometryCache(() => furnish(plan, this.shell, this.P, B, this.dynamic, this.hits,
      look ? { X: look.X, signs: look.signs, spots, hooks: { lift: () => this.o.onLift?.(), levels: this.o.levels,
        monitor: screen => { this.monitor = screen; this.zoomScreen("monitor"); this.o.onMonitor?.(); },
        vending: session => this.o.onVending?.(session), vendSound: kind => { this.o.sound.resume(); this.o.sound.play(kind === "motor" ? "fridge" : "thud"); },
        shop: (kind, label) => { document.exitPointerLock?.(); this.o.onShop?.(kind, label); },
        consume: item => { if (!this.consumeBought(item)) this.o.onToast?.("손에 든 것을 먼저 내려놓아 주세요"); },
        toast: text => this.o.onToast?.(text),
        fx: name => { this.o.sound.resume(); this.o.sound.fx(name); },
        drink: (can, name) => { if (!this.sip && !this.furn.pantry.hand) this.startSip(can, "can", name, true); else (can.children[0] as THREE.Mesh | undefined)?.geometry.dispose(); },
      } } : undefined));
    await nextFrame();
    const furnMeshes = B.build();
    for (const m of furnMeshes) this.static.add(m);
    t = mark("furnish", t);
    // (food cooked on the hob eaten: brought to the mouth with the bite's sounds)
    this.furn.eat = (food, name) => { if (this.sip || this.furn.pantry.hand) { food.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }); return; } this.startSip(food, "soft", name, true); };
    this.segs = [...this.shell.segments, ...this.furn.colliders];
    this.furnitureBounds=furnitureFootprints(this.furn.colliders);
    this.grid = new SegGrid(this.segs);
    if (this.large) {
      const add = (o: THREE.Object3D, far: number) => {
        const b = new THREE.Box3().setFromObject(o); if (b.isEmpty()) return;
        this.culled.push({ o, c: b.getCenter(new THREE.Vector3()), r: b.getSize(new THREE.Vector3()).length() / 2, far });
      };
      for (const m of shellMeshes) add(m, SHELL_FAR);
      for (const m of furnMeshes) add(m, FURN_FAR);
      for (const o of this.dynamic.children) add(o, FURN_FAR);
    }
    // (a large floor's polished floors: the reflection probe is taken in one room, so a sharp
    // reflection elsewhere shows lamps where there are none — streaks sliding over the floor as the
    // eye moves; there a soft sheen instead, the area lights' own highlights kept)
    if (this.large) {
      const floors = new Set<THREE.Material>([this.P.floorMain, this.P.floorRoom, this.P.floorEntry, ...Object.entries(look?.finishes ?? {}).filter(([k]) => k.startsWith("floor:")).map(([, m]) => m)]);
      for (const m of floors) { const f = m as THREE.MeshPhysicalMaterial; f.clearcoatRoughness = Math.max(f.clearcoatRoughness ?? 0, 0.45); f.roughness = Math.max(f.roughness, 0.4); f.envMapIntensity = Math.min(f.envMapIntensity ?? 1, 0.35); }
    }
    // the zones' lights
    P(0.66, "조명을 설치하는 중");
    zoneTable.reset();
    this.setupLights();
    for (const m of this.lib.all) zoneLit(m, this.zoneU);
    for (const m of [this.P.ledPanel, this.P.ledWarm, this.P.lampShade]) zoneLit(m, this.zoneU, true);
    // the view out of the windows
    const sunS = sunAt(this.o.hour);
    if (this.o.view) this.scene.background = this.o.view;
    else { this.viewRT = paintedView(this.renderer, this.o.hour, plan.floor * 2.9 + 1.5, plan.complexId.length + plan.floor); this.scene.background = this.viewRT.texture; }
    this.scene.backgroundIntensity = plan.facility ? .9 + (1 - sunS.night) * .35 : 1.05 + (1 - sunS.night) * .45;
    // Every mirror uses its own physical plane, including bedroom dressing tables.
    for (const mr of this.furn.mirrors) {
      let geometry:THREE.BufferGeometry=new THREE.PlaneGeometry(mr.w,mr.h);
      if(mr.radius){
        geometry.dispose();const w=mr.w/2,h=mr.h/2,k=mr.radius,s=new THREE.Shape();
        s.moveTo(-w+k,-h);s.lineTo(w-k,-h);s.quadraticCurveTo(w,-h,w,-h+k);s.lineTo(w,h-k);s.quadraticCurveTo(w,h,w-k,h);s.lineTo(-w+k,h);s.quadraticCurveTo(-w,h,-w,h-k);s.lineTo(-w,-h+k);s.quadraticCurveTo(-w,-h,-w+k,-h);
        geometry=new THREE.ShapeGeometry(s,16);
      }
      const r = new Reflector(geometry, { textureWidth: 1024, textureHeight: Math.round(1024 * mr.h / mr.w), color: 0xc9cdd0, clipBias: 0.002, multisample: 4 });
      r.userData.room=mr.room;r.userData.reflection='local-plane';
      r.position.copy(mr.pos).addScaledVector(mr.normal, 0.0015); r.lookAt(r.position.clone().add(mr.normal));
      const draw = r.onBeforeRender;
      r.onBeforeRender = (renderer, scene, camera, ...rest) => {
        // (not in the AO pass's own render, nor from across the flat)
        if ((scene as THREE.Scene).overrideMaterial || camera.position.distanceTo(r.position) > 4.5) return;
        // Mirrors behind opaque walls do not need an extra scene render.
        if([...this.shell.segments,...this.doorSegs()].some(s=>{
          const t=segHit(camera.position.x,camera.position.z,r.position.x,r.position.z,...s);return t!==null&&t>1e-5&&t<.995;
        }))return;
        const others=this.mirrors.filter(m=>m!==r).map(m=>({m,visible:m.visible}));
        for(const {m} of others)m.visible=false;
        try{draw.call(r, renderer, scene, camera, ...rest);}
        finally{for(const {m,visible} of others)m.visible=visible;}
      };
      this.mirrors.push(r); this.dynamic.add(r);
    }
    this.interactables = [...this.furn.interactables, ...this.doorInteractables()];
    // places to sit or lie down
    for (const s of this.furn.seats) this.interactables.push({ id: `seat-${s.label}`, zone: s.zone, room: s.room, hit: s.hit, label: () => s.label, act: () => { this.sit(s.pose === "lie" ? "침대에 누워 있음" : s.label === "소파에 앉기" ? "소파에 앉아 있음" : s.label === "벤치에 앉기" ? "벤치에 앉아 있음" : "의자에 앉아 있음", s.eye, s.yaw, s.pose); return null; } });
    const collide = (x: number, z: number, r: number) => this.collide(x, z, r);
    if (plan.facility) {
      // a building: its people instead of a pet
      this.people = new People(plan, spots, (text, pitch) => this.o.sound.babble(text, pitch), this.o.hour);
      this.people.onTalk = t => this.openTalk(t);
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
    if(!plan.facility&&!plan.imageAnalysis){
      const saved=this.shell.doors.map(d=>({d,rotation:d.pivot.rotation.y,position:d.leaf.position.clone()}));
      for(const {d} of saved)if(d.kind!=="front"){if(d.kind==="slide")d.leaf.position.copy(d.slideTo!);else d.pivot.rotation.y=d.openYaw;}
      const openDoors=this.doorSegs();
      for(const {d,rotation,position} of saved){d.pivot.rotation.y=rotation;d.leaf.position.copy(position);}
      const blocked=interiorReachability(plan,[...this.segs,...openDoors],this.furn.colliders,[this.pos.x,this.pos.y]);
      if(blocked.length){
        throw new InteriorSafetyError(`가구·문 배치 후 통행을 확보하지 못한 공간: ${[...new Set(blocked)].join(", ")}`);
      }
    }
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
    this.nearFrame(0, true);
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
    // (a large floor: the zones round the way in — the programs and targets are the same everywhere,
    // the rest come as walked to)
    const leads = [...lead.values()].map(r => ({ r, d: Math.hypot((r.rect[0] + r.rect[2]) / 2 - this.pos.x, (r.rect[1] + r.rect[3]) / 2 - this.pos.y) })).sort((a, b) => a.d - b.d).slice(0, this.large ? 4 : Infinity).map(x => x.r);
    if (this.large) {
      // (a large floor: every part of it drawn once, all at once, culling off — each mesh's buffers
      // on the GPU now, none uploaded later on the walk; then a few looks round the way in)
      const shown: THREE.Object3D[] = [];
      this.scene.traverse(o => { if ((o as THREE.Mesh).isMesh && o.frustumCulled) { o.frustumCulled = false; shown.push(o); } });
      for (const m of this.culled) m.o.visible = true;
      this.renderFrame();
      for (const o of shown) o.frustumCulled = true;
    }
    for (const r of leads) { const [x0, z0, x1, z1] = r.rect; looks.push([(x0 + x1) / 2, (z0 + z1) / 2, 0], [(x0 + x1) / 2, (z0 + z1) / 2, Math.PI]); }
    for (const [x, z, yaw] of looks) { this.pos.set(x, z); this.yaw = yaw; this.applyCamera(0); this.nearFrame(0, true); this.lightsFrame(0); this.renderFrame(); }
    // (a large floor's many washrooms: their mirrors' first frames as walked by — one would be enough)
    for (const m of this.large ? this.mirrors.slice(0, 1) : this.mirrors) {
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(m.quaternion);
      this.camera.position.copy(m.position).addScaledVector(n, 1.2).setY(1.6); this.camera.lookAt(m.position); this.camera.updateMatrixWorld();
      this.renderFrame();
    }
    t = mark("looks", t);
    this.pos.copy(keep.p); this.yaw = keep.yaw; this.pitch = keep.pitch; this.applyCamera(0);
    this.nearFrame(0, true); this.lightsFrame(0);
    this.renderFrame();
    await nextFrame();
    this.perf.loadMs = Math.round(performance.now() - t0);
    P(1, "입장합니다");
  }

  private setupLights() {
    const H = this.shell.H;
    // ceiling lights: a few area lights a zone (they light only their zone)
    const add = (zone: number, pos: THREE.Vector3, w: number, h: number, color: THREE.ColorRepresentation, intensity: number, down = true, windowIdx?: number, inward?: THREE.Vector3) => {
      // (a large floor's zone lamps are big — a lobby's is tens of metres across — where lum's
      // small-source sum, L·A/h², overstates what reaches the floor many times: corrected by the
      // exact view factor of the rectangle from the floor below its middle)
      if (this.large && down && intensity > 0) {
        const c = Math.max(0.3, pos.y), X = w / 2 / c, Y = h / 2 / c;
        const F = (2 / Math.PI) * (X / Math.sqrt(1 + X * X) * Math.atan(Y / Math.sqrt(1 + X * X)) + Y / Math.sqrt(1 + Y * Y) * Math.atan(X / Math.sqrt(1 + Y * Y)));
        intensity *= Math.max(1, (w * h / (Math.PI * c * c)) / Math.max(1e-4, F));
      }
      if (down) intensity *= this.o.plan.facility ? .75 : .85;
      const lamp: Lamp = { zone, pos: pos.clone(), look: down ? new THREE.Vector3(pos.x, pos.y - 1, pos.z) : pos.clone().add(inward!), w, h, color: new THREE.Color(color), base: intensity, window: windowIdx, now: intensity, k: 0 };
      this.lamps.push(lamp);
      return lamp;
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
    if (tv?.pos && tv.normal) { this.tvLamp = add(tv.zone ?? 0, tv.pos, tv.w ?? 1.5, tv.h ?? 0.85, "#c9d6ff", 0, false, undefined, tv.normal); this.tvLamp.tv = true; }
    // (always the same number of area lights: the programs don't depend on the plan, so they
    // can be compiled before it exists — see prewarmInterior; a flat's lamps each have one, a large
    // floor's share them — nearFrame)
    for (let i = 0; i < RECT_LIGHTS; i++) {
      const l = new THREE.RectAreaLight("#000000", 0, 0.1, 0.1); l.position.set(0, -50, 0); this.scene.add(l);
      this.pool.push({ light: l, lamp: null });
    }
    this.zoneU.value = new Array(RECT_LIGHTS).fill(-1);
    if (this.lamps.length > RECT_LIGHTS && !this.large) console.warn(`walk: ${this.lamps.length} lamps (> ${RECT_LIGHTS}) on a small plan`);
    if (!this.large) this.lamps.slice(0, RECT_LIGHTS).forEach((l, i) => { l.k = 1; this.seat(i, l); });
    for (const z of this.shell.zones.values()) this.zoneLevel.set(z, 1);
    for (const r of this.o.plan.rooms) {
      const z = this.shell.zones.get(r.zone)!, [x0, z0, x1, z1] = r.rect, w = x1 - x0, d = z1 - z0;
      this.zoneArea.set(z, (this.zoneArea.get(z) ?? 0) + 2 * w * d + 2 * (w + d) * H);
      this.zoneFloor.set(z, (this.zoneFloor.get(z) ?? 0) + w * d);
      if (r.type === "bathroom" || r.type === "ensuite" || r.type === "restroom") this.wetZones.add(z);
    }
    // the sun through the glass, with soft shadows
    this.sun.color.copy(s.color); this.sun.intensity = s.intensity * (this.o.plan.facility ? .65 : .75);
    const [x0, z0, x1, z1] = this.o.plan.bounds, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    this.sun.position.set(cx + s.dir.x * 30, s.dir.y * 30, cz + s.dir.z * 30); this.sun.target.position.set(cx, 0, cz);
    this.sun.castShadow = s.intensity > 0;
    const big = this.renderer.capabilities.maxTextureSize >= 8192;
    this.sun.shadow.mapSize.set(big ? 4096 : 2048, big ? 4096 : 2048);
    // (a large floor: the shadow round the walker only, moved with them — nearFrame)
    const sc = this.sun.shadow.camera, r = this.large ? 34 : Math.hypot(x1 - x0, z1 - z0) / 2 + 2;
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 5; sc.far = 70;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.025; this.sun.shadow.radius = 4;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    // Soft fill keeps matte walls legible at night without restoring sharp specular glare.
    this.hemi.intensity = this.o.plan.facility ? .22 + .06 * (1 - s.night) : .04 + .08 * (1 - s.night);
  }

  private setupPost() {
    const r = this.renderer;
    // (on: a previous interior on this renderer left it off, and its loading renders need the sun's shadow)
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap; r.shadowMap.autoUpdate = true; r.shadowMap.needsUpdate = true;
    r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = .9;
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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), this.o.plan.facility ? .035 : .12, .45, this.o.plan.facility ? 2 : 1.2);
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
    this.scene.environment = env.texture; this.scene.environmentIntensity = this.o.plan.facility ? .55 : .85;
  }
  /** where the light round the flat is taken: its living room; a building's largest room off the corridor */
  private probeRoom() {
    const rooms = this.o.plan.rooms, area = (r: (typeof rooms)[number]) => (r.rect[2] - r.rect[0]) * (r.rect[3] - r.rect[1]);
    // (a large floor: the room the walker comes into — its biggest room may be a store 200 m away,
    // dark then, its lamps not among the lit, and every surface would take that darkness round)
    const st = this.o.plan.facility?.start;
    if (this.large && st) return rooms.find(r => st[0] >= r.rect[0] && st[0] <= r.rect[2] && st[1] >= r.rect[1] && st[1] <= r.rect[3]) ?? rooms.slice().sort((a, b) => Math.hypot((a.rect[0] + a.rect[2]) / 2 - st[0], (a.rect[1] + a.rect[3]) / 2 - st[1]) - Math.hypot((b.rect[0] + b.rect[2]) / 2 - st[0], (b.rect[1] + b.rect[3]) / 2 - st[1]))[0];
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
    const plan=this.o.plan;
    if(!plan.facility){
      const room=plan.rooms.find(r=>r.type===(plan.imageAnalysis?"living":"entrance"))??plan.rooms[0];
      const preferred:[number,number]=plan.imageAnalysis?.start.slice(0,2) as [number,number]??[(room.rect[0]+room.rect[2])/2,room.rect[1]+.65];
      const safe=walkingSpawn(plan,this.shell.segments,this.furn.colliders,this.doorSegs(),preferred)
        ??(plan.imageAnalysis?walkingSpawn(plan,this.shell.segments,this.furn.colliders,this.doorSegs(),preferred,.001,.09):null);
      if(!safe){
        throw new InteriorSafetyError("가구와 벽을 피한 입장 공간을 확보하지 못했습니다. 다른 인테리어를 선택해 주세요.");
      }
      this.pos.set(safe[0],safe[1]);this.yaw=safe[2];this.vel.set(0,0);return;
    }
    const st = plan.facility?.start;
    if (st) {
      const safe=walkingSpawn(plan,this.shell.segments,this.furn.colliders,this.doorSegs(),[st[0],st[1]]);
      if(!safe)throw new InteriorSafetyError("출입구 주변에 통행 가능한 공간을 확보하지 못했습니다.");
      this.pos.set(safe[0],safe[1]);this.yaw=safe[2];this.vel.set(0,0);return;
    }
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
  /** Camera inspection preserves source geometry when a symbolic door is too
   * narrow to walk through. It does not relax body collision or invent a door. */
  inspectRoom(id:string){
    const plan=this.o.plan,room=plan.rooms.find(r=>r.id===id);if(!room||!plan.imageAnalysis)return;
    const [x0,z0,x1,z1]=room.rect,preferred:[number,number]=[(x0+x1)/2,(z0+z1)/2];
    const local={...plan,rooms:plan.rooms.filter(r=>r.zone===room.zone)};
    const safe=walkingSpawn(local,this.shell.segments,this.furn.colliders,this.doorSegs(),preferred)
      ??walkingSpawn(local,this.shell.segments,this.furn.colliders,this.doorSegs(),preferred,.001,.09);
    this.pos.set(safe?.[0]??preferred[0],safe?.[1]??preferred[1]);
    this.yaw=safe?.[2]??Math.PI;this.pitch=-.06;this.view="first";this.seated=null;this.vel.set(0,0);this.keys.clear();this.shown.ease=.15;this.emitHud(true);
  }
  private overlay = false;
  private monitor: MonitorScreen | null = null;
  private screenLook: { yaw: number; pitch: number } | null = null;
  setOverlay(on: boolean) { this.overlay = on; this.keys.clear(); this.stick.set(0, 0); this.runStick = false; if (on) this.vel.set(0, 0); }
  monitorScreen() { return this.monitor ? this.project(this.monitor.corners) : null; }
  closeMonitor() { this.zoomScreen(null); this.monitor = null; }
  resetLook() { if (!this.seated) { this.pitch = -.04; this.shown.ease = .15; } }
  keyDown = (e: KeyboardEvent) => {
    if (this.overlay) return;
    const t = e.target instanceof HTMLElement ? e.target : null;
    if(t?.closest('.wk-laptop-layer')||document.querySelector('.wk-laptop-layer.is-fullscreen'))return;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.code === "KeyE" || e.code === "Enter") { e.preventDefault(); if (!e.repeat) this.interact(); return; }
    if (e.code === "KeyR") { if (!e.repeat) this.consumeHand(); return; }
    if (e.code === "KeyV") { if (!e.repeat) this.toggleView(); return; }
    if (e.code === "KeyT") { if (!e.repeat) this.toggleOverhead(); return; }
    if (e.code === "KeyZ" && !e.repeat) { if (this.petZoomed()) this.zoomPet(false); else if (this.target?.id === "cat") this.zoomPet(true); return; }
    if (/^(Key[WASD]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Space)$/.test(e.code)) { e.preventDefault(); this.keys.add(e.code); if (this.seated && /Key[WASD]|Arrow/.test(e.code)) this.standUp(); }
  };
  keyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  blur = () => { this.keys.clear(); };
  setStick(x: number, y: number, run: boolean) { if (this.overlay) return; this.stick.set(x, y); this.runStick = run; if (this.seated && (Math.abs(x) > 0.3 || Math.abs(y) > 0.3)) this.standUp(); }
  look(dx: number, dy: number) { if (this.overlay) return; this.yaw -= dx; this.pitch = Math.max(-1.35, Math.min(1.3, this.pitch - dy)); }
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
    const walls = new Set(this.shell.segments);
    for (const sg of this.grid.query(e.x, e.z, mid.x, mid.z)) {
      if (!walls.has(sg)) continue;
      const [a, b, cc, d] = sg, h = segHit(e.x, e.z, mid.x, mid.z, a, b, cc, d);
      if (h !== null && h * L < L - 0.25) return null;
    }
    const r = this.renderer.domElement.getBoundingClientRect(), out: { x: number; y: number }[] = [];
    for (const p of c) { const v = p.clone().project(this.camera); if (v.z > 1 || v.z < -1) return null; out.push({ x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }); }
    return out;
  }
  /** Zoom in on a screen (the TV, the laptop): the eye square in front of it, at the distance where it
   * fills nine tenths of the view; null steps back to where the walker stood. */
  zoomScreen(which: "tv" | "laptop" | "monitor" | null) {
    if (!which) { if (this.seated?.label === "화면") this.standUp(); return; }
    const c = which === "tv" ? this.furn.tv?.corners : which === "monitor" ? this.monitor?.corners : this.furn.laptop.cornersNow?.();
    if (!c) return;
    const mid = c[0].clone().add(c[2]).multiplyScalar(0.5), n = screenNormal(c);
    const w = c[0].distanceTo(c[1]), h = c[0].distanceTo(c[3]);
    const vf = THREE.MathUtils.degToRad(this.camera.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * this.camera.aspect);
    const d = Math.max((w / 2) / Math.tan(hf / 2), (h / 2) / Math.tan(vf / 2)) / 0.9;
    const back = this.seated?.label === "화면" ? this.seated.back : this.pos.clone();
    if (this.seated?.label !== "화면") this.screenLook = { yaw: this.yaw, pitch: this.pitch };
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
  toggleOverhead() { this.overhead = !this.overhead; this.emitHud(); }
  toggleView() { this.view = this.view === "first" ? "third" : "first"; this.shown.ease = viewPreferences().reduceMotion ? .15 : .3; this.emitHud(); }
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
  standUp() {
    if (!this.seated) return;
    const restore = this.seated.label === "화면" ? this.screenLook : null;
    if (this.cat) this.cat.hold = null;
    this.pos.copy(this.seated.back); this.seated = null; this.avatar.pose = "stand";
    this.recoverFurnitureOverlap();
    this.pitch = restore?.pitch ?? -.05; if (restore) this.yaw = restore.yaw;
    this.screenLook = null; this.shown.ease = restore ? .2 : .8; this.emitHud(true);
  }

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
    this.sipBeats(dt);
    this.guideTick(dt);
    this.lap("things");
    const walker = { x: this.pos.x, z: this.pos.y, speed: this.seated ? 0 : this.vel.length(), seated: !!this.seated };
    if (this.seated) { const f = new THREE.Vector3(-Math.sin(this.seated.yaw), 0, -Math.cos(this.seated.yaw)); walker.x = this.seated.eye.x + f.x * 0.6; walker.z = this.seated.eye.z + f.z * 0.6; }
    this.cat?.update(dt, walker);
    this.people?.update(dt, walker);
    this.robot?.update(dt, [{ x: walker.x, z: walker.z, r: 0.25 }, ...(this.cat ? [{ x: this.cat.pos.x, z: this.cat.pos.y, r: 0.2 }] : [])]);
    this.lap("life");
    this.nearFrame(dt);
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

  private furnitureBounds:[number,number,number,number][]=[];
  private recoverFurnitureOverlap(){
    if(!this.furnitureBounds.some(([a,b,c,d])=>this.pos.x>a+.001&&this.pos.x<c-.001&&this.pos.y>b+.001&&this.pos.y<d-.001))return;
    const safe=walkingSpawn(this.o.plan,this.shell.segments,this.furn.colliders,this.doorSegs(),[this.pos.x,this.pos.y]);
    if(safe){this.pos.set(safe[0],safe[1]);this.vel.set(0,0);}
  }
  private move(dt: number) {
    if (this.seated) { this.avatar.update(dt, 0); return; }
    this.recoverFurnitureOverlap();
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
    const segments=this.segsIn(Math.min(this.pos.x,nx)-.3,Math.min(this.pos.y,nz)-.3,Math.max(this.pos.x,nx)+.3,Math.max(this.pos.y,nz)+.3);
    const [px,pz]=moveThroughGaps([this.pos.x,this.pos.y],[nx,nz],segments);
    const p=new THREE.Vector2(px,pz);
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
  /** Keep the camera on this side of walls/jambs, including in passages smaller
   * than the former fixed camera radius. The near plane adapts to actual clearance. */
  private clearOf(x: number, z: number): THREE.Vector2 {
    const px = this.pos.x, pz = this.pos.y, segs = this.segsIn(px, pz, x, z);
    const [cx,cz]=moveThroughGaps([px,pz],[x,z],segs);
    return new THREE.Vector2(cx,cz);
  }
  /** a circle against the wall and furniture segments (and the doors where they stand now) */
  private collide(x: number, z: number, radius = RADIUS, people = true): THREE.Vector2 {
    const RADIUS = radius;
    const segs = this.segsIn(x - radius - 0.5, z - radius - 0.5, x + radius + 0.5, z + radius + 0.5);
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
  /** the walls' and furniture's segments, and the doors' as they stand, within a box */
  private segsIn(x0: number, z0: number, x1: number, z1: number): Seg[] {
    const out = this.grid.query(x0, z0, x1, z1);
    return out.concat(this.doorSegs(Math.min(x0, x1) - 1.2, Math.min(z0, z1) - 1.2, Math.max(x0, x1) + 1.2, Math.max(z0, z1) + 1.2));
  }
  private doorSegs(x0 = -Infinity, z0 = -Infinity, x1 = Infinity, z1 = Infinity): Seg[] {
    const out: Seg[] = [];
    for (const d of this.shell.doors) {
      if (d.hinge[0] < x0 || d.hinge[0] > x1 || d.hinge[1] < z0 || d.hinge[1] > z1) { if (d.kind !== "slide") continue; const p = d.leaf.position; if (p.x < x0 || p.x > x1 || p.z < z0 || p.z > z1) continue; }
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
  /** an area light given to a lamp (null: none) */
  private seat(i: number, lamp: Lamp | null) {
    const slot = this.pool[i]; slot.lamp = lamp;
    const l = slot.light;
    if (!lamp) { l.intensity = 0; l.position.set(0, -50, 0); l.width = l.height = 0.1; this.zoneU.value[i] = -1; return; }
    l.position.copy(lamp.pos); l.lookAt(lamp.look); l.width = lamp.w; l.height = lamp.h; l.color.copy(lamp.color);
    l.intensity = lamp.now * lamp.k; this.zoneU.value[i] = lamp.zone;
  }
  private wanted: Set<Lamp> | null = null;
  /** A large floor: the area lights to the lamps nearest the walker (their own room's first), faded
   * across as they change hands; the meshes beyond their distance hidden; the sun's shadow brought
   * round the walker. */
  private nearFrame(dt: number, force = false) {
    if (!this.large) return;
    const c = this.camera.position;
    // the lamps' hands: every metre walked, or a fifth of a second
    this.poolT -= dt;
    if (force || this.poolT <= 0 || this.poolAt.distanceToSquared(c) > 1) {
      this.poolT = 0.2; this.poolAt.copy(c);
      const here = this.shell.zones.get(this.shell.roomAt(this.pos.x, this.pos.y)?.zone ?? "") ?? -1;
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const score = (l: Lamp) => {
        const ox = l.pos.x - c.x, oz = l.pos.z - c.z;
        const d = Math.hypot(Math.max(Math.abs(ox) - l.w / 2, 0), Math.max(Math.abs(oz) - l.h / 2, 0));
        // (its own room's first; those behind the walker after those ahead; a dark one last)
        return (l.zone === here ? -100 : 0) + d + (d > 5 && ox * fx + oz * fz < 0 ? 10 : 0) + (l.now <= 0 ? 1000 : 0);
      };
      const want = new Set(this.lamps.filter(l => !l.tv).map(l => ({ l, s: score(l) })).sort((a, b) => a.s - b.s).slice(0, RECT_LIGHTS - (this.tvLamp ? 1 : 0)).map(x => x.l));
      if (this.tvLamp) want.add(this.tvLamp);
      const held = new Set(this.pool.map(p => p.lamp).filter(Boolean) as Lamp[]);
      const waiting = [...want].filter(l => !held.has(l));
      this.pool.forEach((p, i) => {
        // (a slot whose lamp is no longer wanted gives it up once faded out; a free one takes the next)
        if (p.lamp && !want.has(p.lamp) && p.lamp.k <= 0) this.seat(i, null);
        if (!p.lamp && waiting.length) this.seat(i, waiting.shift()!);
      });
      this.wanted = want;
    }
    // what is drawn: every two metres
    if (force || this.cullAt.distanceToSquared(c) > 4) {
      this.cullAt.copy(c);
      for (const m of this.culled) m.o.visible = m.c.distanceTo(c) - m.r < m.far;
    }
    // the sun's shadow round the walker
    if (this.sun.castShadow && (force || Math.hypot(this.shadowAt.x - this.pos.x, this.shadowAt.z - this.pos.y) > 8)) {
      this.shadowAt.set(this.pos.x, 0, this.pos.y);
      const s = sunAt(this.o.hour);
      this.sun.position.set(this.pos.x + s.dir.x * 30, s.dir.y * 30, this.pos.y + s.dir.z * 30); this.sun.target.position.set(this.pos.x, 0, this.pos.y);
      this.sun.target.updateMatrixWorld(); this.shadowFrames = Math.max(this.shadowFrames, 1);
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
      zoneTable.level(z, next);
    }
    // each lamp's brightness now: its switch, the daylight and curtains at a window, the TV
    for (const l of this.lamps) {
      if (l.window !== undefined) {
        const open = this.furn.curtainOpen.get(l.window)?.() ?? 1;
        const w = this.shell.windows[l.window];
        const facing = Math.max(0.35, 0.65 + 0.35 * -w.inward.dot(s.dir));
        l.now = (this.o.plan.facility ? .75 : .9) * s.skyIntensity * open * facing;
      } else if (l.tv) l.now += ((this.furn.tv?.on ? 1.3 : 0) - l.now) * Math.min(1, dt * 6);
      else l.now = l.base * (this.zoneLevel.get(l.zone) ?? 1);
    }
    // (a large floor: each lamp faded in as an area light, or out into its zone's even fill)
    if (this.large) {
      const want = this.wanted, k = dt > 0 ? Math.min(1, dt * 3.5) : 1;
      const fill = new Map<number, number>();
      for (const l of this.lamps) {
        const lit = !!want?.has(l) && this.pool.some(p => p.lamp === l);
        l.k = lit ? Math.min(1, l.k + k) : Math.max(0, l.k - k);
        if (l.zone < 0 || l.tv) continue;
        // (its flux, π·L·A, a share of it spread over its zone's floor)
        const e = Math.PI * l.now * l.w * l.h * FILL / Math.max(4, this.zoneFloor.get(l.zone) ?? 4);
        fill.set(l.zone, (fill.get(l.zone) ?? 0) + e * (1 - l.k));
      }
      for (const z of this.zoneFloor.keys()) zoneTable.fill(z, fill.get(z) ?? 0);
    }
    for (const p of this.pool) if (p.lamp) p.light.intensity = p.lamp.now * p.lamp.k;
    if (changed && this.probeDirty === 0) this.probeDirty = 3;
  }
  private applyCamera(dt: number) {
    const cam = this.camera;
    const prefs = viewPreferences(); applyViewFov(cam);
    const sh = this.shown;
    if (!sh.init || dt <= 0) { sh.yaw = this.yaw; sh.pitch = this.pitch; sh.anchor.copy(this.pos); }
    else {
      sh.ease = Math.max(0, sh.ease - dt);
      const k = 1 - Math.exp(-dt * (sh.ease > 0 ? 6 : this.view === "third" ? 18 : 40));
      const dy = Math.atan2(Math.sin(this.yaw - sh.yaw), Math.cos(this.yaw - sh.yaw));
      const turnLimit = this.view === "third" ? dt * 3.6 : Infinity;
      sh.yaw += THREE.MathUtils.clamp(dy * k, -turnLimit, turnLimit);
      sh.pitch += THREE.MathUtils.clamp((this.pitch - sh.pitch) * k, -turnLimit, turnLimit);
      // Carry the camera with the body; damp its orbit, not the runner's world translation.
      sh.pos.x += this.pos.x - sh.anchor.x; sh.pos.z += this.pos.y - sh.anchor.y;
      sh.anchor.copy(this.pos);
    }
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
      const bob = this.view === "first" && !prefs.reduceMotion ? Math.sin(this.bob) * 0.012 * Math.min(1, this.vel.length() / 1.4) : 0;
      if (this.view === "first") {
        // the eye a little in front of the face (never through a wall or a door's jamb: inside the
        // wall's thickness its faces are not drawn, and the frame flashed through it)
        const e = this.clearOf(this.pos.x - Math.sin(this.yaw) * 0.13, this.pos.y - Math.cos(this.yaw) * 0.13);
        cam.position.set(e.x, this.eyeY + bob, e.y);
      } else {
        // over the shoulder, pulled in before a wall
        const back = 2.8 * prefs.distance, bx = Math.sin(sh.yaw), bz = Math.cos(sh.yaw);
        // Use the displayed heading for both orbit and aim. Test the actual boom, including
        // moving doors, instead of testing its centre then snapping a shoulder into a jamb.
        const safe = this.clearOf(this.pos.x + bx * back, this.pos.y + bz * back);
        let d = Math.max(.1, Math.hypot(safe.x - this.pos.x, safe.y - this.pos.y));
        // (pulled in quickly before a wall, let out slowly)
        const sb = sh;
        sb.boom = dt > 0 ? sb.boom + (d - sb.boom) * (1 - Math.exp(-dt * (d < sb.boom ? 18 : 3))) : d;
        d = Math.min(d + 0.05, sb.boom);
        // (the shoulder's offset too kept on this side of the walls: in a narrow hall it put the
        // camera inside one)
        const e = this.clearOf(this.pos.x + bx * d, this.pos.y + bz * d);
        cam.position.set(e.x, this.eyeY + 0.22, e.y);
      }
    }
    // eased toward what was set (dt 0: the warm-up renders, at once)
    if (!sh.init || dt <= 0) { sh.yaw = this.yaw; sh.pitch = this.pitch; sh.pos.copy(cam.position); sh.init = true; }
    else {
      const kp = 1 - Math.exp(-dt * (sh.ease > 0 ? 6 : this.view === "third" ? 18 : 1000));
      sh.pos.lerp(cam.position, kp); cam.position.copy(sh.pos);
    }
    // Recheck the interpolated path: turning a corner must not lerp through its wall.
    if (!this.seated) { const safe = this.clearOf(cam.position.x, cam.position.z); cam.position.x = safe.x; cam.position.z = safe.y; sh.pos.copy(cam.position); }
    const near=passageNear(cam.position.x,cam.position.z,this.segsIn(cam.position.x-.2,cam.position.z-.2,cam.position.x+.2,cam.position.z+.2));
    if(Math.abs(cam.near-near)>.00001){cam.near=near;cam.updateProjectionMatrix();}
    cam.rotation.set(sh.pitch, sh.yaw, 0, "YXZ");
    // what the hand holds: low and to the right of the eye, or before the body seen from behind
    if (this.sip) this.sipPose(cam);
    else if (this.furn.pantry.hand) {
      const m = this.holdM; cam.updateMatrixWorld();
      if (this.view === "first" && !this.seated) m.multiplyMatrices(cam.matrixWorld, this.holdEye);
      else m.makeRotationY(this.yaw).setPosition(this.pos.x - Math.sin(this.yaw) * 0.34, this.shell.floorAt(this.pos.x, this.pos.y) + 0.98, this.pos.y - Math.cos(this.yaw) * 0.34);
      this.furn.pantry.holdAt(m);
    }
    if (this.overhead) { this.overheadCamera(); ar.visible = true; cam.updateMatrixWorld(); return; }
    if (cam.up.y !== 1) { cam.up.set(0, 1, 0); cam.far = 400; cam.updateProjectionMatrix(); }
    // the head hidden from its own eye (the body stays: look down and it's there)
    ar.visible = this.seated?.label !== "화면" && this.seated?.label !== "반려동물" && (this.view === "third" ? Math.hypot(cam.position.x - this.pos.x, cam.position.z - this.pos.y) > .65 : (!(this.seated?.pose === "lie") && (this.pitch < -0.55 || this.mirrors.some(m => m.position.distanceTo(cam.position) < 4.5))));
    cam.updateMatrixWorld();
  }
  /** The whole flat from straight above, the walls and furniture cut just under the ceiling:
   * the rendered plan. The walker keeps moving in it and is shown where they stand. */
  private overheadCamera() {
    const cam = this.camera, [x0, z0, x1, z1] = this.o.plan.bounds, cut = (this.o.plan.ceilingHeightM ?? 2.4) - .08;
    const aspect = Math.max(.2, cam.aspect), w = (x1 - x0) * 1.12 + 1, d = (z1 - z0) * 1.12 + 1, fov = 40;
    const half = Math.tan(fov / 2 * Math.PI / 180), h = Math.max(d / 2 / half, w / 2 / half / aspect) + cut;
    cam.fov = fov; cam.up.set(0, 0, -1); cam.position.set((x0 + x1) / 2, h, (z0 + z1) / 2); cam.lookAt((x0 + x1) / 2, 0, (z0 + z1) / 2);
    cam.near = h - cut; cam.far = h + 1; cam.updateProjectionMatrix();
  }
  private pick() {
    if (this.overhead) { if (this.target) { this.target = null; this.emitHud(); } return; }
    // (zoomed in on a screen, the screen is the whole world: nothing else to point at)
    if (this.seated?.label === "화면" || this.seated?.label === "반려동물") { this.target = null; this.emitHud(); return; }
    this.ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this.ray.far = this.view === "third" ? Math.hypot(this.camera.position.x - this.pos.x, this.camera.position.z - this.pos.y) + 2.4 : 2.3;
    let best: Interactable | null = null, bd = Infinity;
    const cp = this.camera.position, reach = this.ray.far + 2.5;
    for (const it of this.interactables) {
      if (it.enabled && !it.enabled()) continue;
      // (a large floor's thousands: only those within reach — where each is, taken once)
      if (this.large) { const at = it.id.startsWith("person-") ? it.hit.getWorldPosition(this.tmpV) : this.hitAt.get(it) ?? this.hitAt.set(it, it.hit.getWorldPosition(new THREE.Vector3())).get(it)!; if (Math.abs(at.x - cp.x) > reach || Math.abs(at.z - cp.z) > reach) continue; }
      const hits = this.ray.intersectObject(it.hit, true);
      if (hits.length && hits[0].distance < bd && Math.hypot(hits[0].point.x - this.pos.x, hits[0].point.z - this.pos.y) <= 2.7) { bd = hits[0].distance; best = it; }
    }
    // (only what isn't behind a wall: the walls cut the ray)
    if (best) {
      const p = this.camera.position, q = p.clone().addScaledVector(this.ray.ray.direction, bd);
      const walls = new Set(this.shell.segments);
      if (this.grid.query(p.x, p.z, q.x, q.z).some(sg => walls.has(sg) && segHit(p.x, p.z, q.x, q.z, sg[0], sg[1], sg[2], sg[3]) !== null && Math.hypot(q.x - p.x, q.z - p.z) > 0.3)) best = null;
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
    const k = this.furn?.pantry.handKind() as ItemKind | null, how = k ? CONSUME[k] : undefined;
    const use = this.sip ? `${this.sip.name} ${this.sip.how === "crunch" || this.sip.how === "soft" ? "먹는 중" : "마시는 중"}` : k && how ? `${ITEM_NAME[k]} ${how === "crunch" || how === "soft" ? "먹기" : "마시기"}` : null;
    const guide = this.guide ? `${this.guide.label}까지 ${Math.max(1, Math.round(this.guideLeft()))}m · 바닥 화살표를 따라가세요` : null;
    const h: HudState = { target: this.target?.label() ?? null, room, seated: this.seated?.label ?? null, view: this.view, overhead: this.overhead, pet: this.target?.id === "cat", use, guide };
    if (force || h.target !== this.hud.target || h.room !== this.hud.room || h.seated !== this.hud.seated || h.view !== this.hud.view || h.overhead !== this.hud.overhead || h.pet !== this.hud.pet || h.use !== this.hud.use || h.guide !== this.hud.guide) { this.hud = h; this.o.onHud?.(h); }
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
    for (let i = 0, j = 0; i < seq.length; i++) { acc += seq[i]; cnt++; while (j < i && acc - seq[j] >= 1000) { acc -= seq[j++]; cnt--; } if (acc >= 1000) worst1s = Math.min(worst1s, (cnt * 1000) / acc); }
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
    this.clearGuide();
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
