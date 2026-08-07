import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { loadStockIconUrl } from "../stockIcon";
import {
  BLACK_HOLE,
  type FeedKey,
  NEUTRON_BINARY,
  PLANETS,
  PLUTO_TEXTURE,
  STAR,
  TOUR_ORDER,
  VOYAGER,
  type PlanetSpec,
  type MoonSpec,
} from "./bodies";
import {
  DISC_FRAG,
  DISC_VERT,
  GLOW_FRAG,
  GLOW_VERT,
  GRADE_SHADER,
  JET_FRAG,
  JET_VERT,
  LENSING_SHADER,
  MILKYWAY_FRAG,
  MILKYWAY_VERT,
  NEBULA_FRAG,
  NEBULA_VERT,
  PLANET_FRAG,
  PLANET_VERT,
  REMNANT_FRAG,
  REMNANT_VERT,
  RING_FRAG,
  RING_VERT,
  SKYPHOTO_FRAG,
  SKYPHOTO_VERT,
  STAR_FRAG,
  STAR_VERT,
  SUNGLOW_FRAG,
  SUNGLOW_VERT,
  SUN_FRAG,
  SUN_VERT,
  TRAIL_FRAG,
  TRAIL_VERT,
} from "./shaders";

/* ============================================================================
   ORBIT II — the engine.
   ----------------------------------------------------------------------------
   The WebGL half of the type-2 entrance, kept out of React entirely for the
   same reason the neuron monitor's scene is (see monitor/scene.ts): everything
   here runs on the animation frame and mutates matrices and typed arrays in
   place. A React render per frame, for a scene React has no opinions about,
   would be sixty reconciliations a second to move a planet three pixels.

   The component owns *what* the page knows — it polls the indices, it holds
   the language, it renders the HUD. This owns *how* that looks, including the
   floating body labels: those are real DOM, but they are this file's DOM,
   written with direct `style.transform` assignments rather than through
   props.

   Three things are worth knowing before reading:

   1. Everything is in scene units, not pixels. See bodies.ts.
   2. Quality is adaptive. The scene measures its own frame rate and steps
      down through three tiers (see TIERS), because the same page has to hold
      up on a desktop GPU and on a mid-range phone, and the honest way to do
      that is to notice which one you are on rather than to guess from the
      user agent.
   3. Nothing here reaches into the page. The only outward channel is the
      callbacks in SceneCallbacks.
   ========================================================================= */

/* ────────────────────────────── quality tiers ────────────────────────────── */

export type Tier = "ultra" | "high" | "low";

interface TierConfig {
  /** Hard ceiling on device pixel ratio. The single biggest lever there is:
   * this scene is entirely fragment-bound, so pixels cost more than anything
   * else in it. */
  dpr: number;
  stars: number;
  asteroids: number;
  /** Latitude/longitude segments on a planet sphere. */
  segments: number;
  bloom: boolean;
  /** The lensing pass is a full-screen resample with three texture fetches;
   * it is the first thing to go. */
  lensing: boolean;
  moons: boolean;
  nebula: boolean;
  /** MSAA samples on the composer's target. Fixed at construction — changing
   * it means rebuilding the render targets, which is not worth doing mid-run. */
  msaa: number;
  grain: number;
  debris: number;
}

const TIERS: Record<Tier, TierConfig> = {
  ultra: { dpr: 2, stars: 26000, asteroids: 3600, segments: 96, bloom: true, lensing: true, moons: true, nebula: true, msaa: 4, grain: 0.035, debris: 900 },
  high: { dpr: 1.6, stars: 14000, asteroids: 1600, segments: 64, bloom: true, lensing: true, moons: true, nebula: true, msaa: 0, grain: 0.03, debris: 480 },
  low: { dpr: 1.15, stars: 6000, asteroids: 520, segments: 40, bloom: false, lensing: false, moons: false, nebula: true, msaa: 0, grain: 0.02, debris: 180 },
};

const TIER_ORDER: Tier[] = ["ultra", "high", "low"];

/** Below this for a whole sample window and the scene drops a tier. 45 rather
 * than 60 so a couple of dropped frames during a fly-to don't demote a machine
 * that is otherwise comfortable. */
const TIER_DOWN_FPS = 44;
const TIER_SAMPLE_MS = 1600;

/** A first guess, refined by measurement within a couple of seconds. Phones
 * and tablets start one tier down not because they are necessarily slow but
 * because starting high and dropping is a visible stutter on the way in,
 * whereas starting lower and never rising is merely quieter. */
function initialTier(): Tier {
  if (typeof window === "undefined") return "high";
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  if (coarse && (cores <= 6 || memory <= 4)) return "low";
  if (coarse) return "high";
  if (cores <= 4 || memory <= 4) return "high";
  return "ultra";
}

/* ────────────────────────────── public surface ────────────────────────────── */

export interface BodyInfo {
  key: string;
  /** The destination — what the permanent label reads. */
  ko: string;
  en: string;
  /** The body's own name, shown when the pointer is on it. */
  bodyKo: string;
  bodyEn: string;
  to: string;
  feed?: FeedKey;
  accent: string;
  /** Radius in scene units — how close a fly-to should stop. */
  size: number;
  /** Whether the HUD keeps a label on it at all times, or only on hover. */
  primary: boolean;
}

export interface SceneCallbacks {
  /** Pointer entered/left a body. `null` on leave. */
  onHover(body: BodyInfo | null): void;
  /** A body was chosen — open its destination. From the sky this is the
   * *second* tap on an already-focused body; from the dock it fires at the end
   * of the fly-to, which is what makes that transition read as arriving
   * somewhere rather than as a delay. */
  onSelect(body: BodyInfo): void;
  /** The camera has taken a body as its pivot, or let go of one. The shell
   * uses it to say that a second tap will open it. */
  onFocus(body: BodyInfo | null): void;
  /** The moment the first frame is on screen — the shell fades its overlay. */
  onReady(): void;
  onTier(tier: Tier): void;
}

export type FeedMap = Record<FeedKey, number | null>;

/* ────────────────────────────── small helpers ────────────────────────────── */

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Real starlight is a temperature, not a colour choice: blue-white hottest,
 * down through white and yellow to orange and red. Weighted so the field still
 * reads as mostly white at a glance, which real skies do. */
const STAR_COLORS: [number, number, number, number][] = [
  [1.0, 1.0, 1.0, 0.34],
  [0.78, 0.85, 1.0, 0.19],
  [1.0, 0.96, 0.85, 0.18],
  [1.0, 0.83, 0.6, 0.14],
  [1.0, 0.66, 0.5, 0.09],
  [0.55, 0.92, 0.95, 0.06],
];
const STAR_COLOR_TOTAL = STAR_COLORS.reduce((s, c) => s + c[3], 0);

function pickStarColor(rand: () => number): [number, number, number] {
  let roll = rand() * STAR_COLOR_TOTAL;
  for (const [r, g, b, w] of STAR_COLORS) {
    roll -= w;
    if (roll <= 0) return [r, g, b];
  }
  return [1, 1, 1];
}

/* ─────────────────────── the glow-point pool ───────────────────────
   One draw call for every soft light in the scene that is not a body: comet
   heads and tails, Pluto's debris, Io's plumes, Enceladus's geysers, the
   neutron pair, the supernova knots. Each slot is a position plus a size,
   colour and alpha, and every effect below rents a contiguous range of them.
   Rendered additively with depth-write off, so they layer as light. */
class GlowPool {
  readonly points: THREE.Points;
  readonly position: Float32Array;
  readonly size: Float32Array;
  readonly color: Float32Array;
  readonly alpha: Float32Array;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private cursor = 0;

  constructor(capacity: number, pixelRatio: number) {
    this.position = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.color = new Float32Array(capacity * 3);
    this.alpha = new Float32Array(capacity);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.position, 3));
    this.geometry.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    this.geometry.setAttribute("aColor", new THREE.BufferAttribute(this.color, 3));
    this.geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    // The pool is scattered all over the scene and its contents move every
    // frame; a bounding sphere computed once would cull half of it at random.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      uniforms: { uPixelRatio: { value: pixelRatio } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  /** Reserves `count` consecutive slots. Allocation is one-way — every effect
   * takes its range at construction and keeps it for the scene's lifetime. */
  allocate(count: number): number {
    const start = this.cursor;
    this.cursor += count;
    return start;
  }

  set(i: number, x: number, y: number, z: number, size: number, r: number, g: number, b: number, a: number) {
    this.position[i * 3] = x;
    this.position[i * 3 + 1] = y;
    this.position[i * 3 + 2] = z;
    this.size[i] = size;
    this.color[i * 3] = r;
    this.color[i * 3 + 1] = g;
    this.color[i * 3 + 2] = b;
    this.alpha[i] = a;
  }

  hide(i: number) {
    this.alpha[i] = 0;
  }

  setPixelRatio(ratio: number) {
    this.material.uniforms.uPixelRatio.value = ratio;
  }

  flush() {
    this.geometry.attributes.position.needsUpdate = true;
    (this.geometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/* ────────────────────────── per-body scene records ────────────────────────── */

interface MoonRig {
  spec: MoonSpec;
  info: BodyInfo;
  pivot: THREE.Object3D;
  holder: THREE.Object3D;
  mesh: THREE.Object3D;
  material?: THREE.ShaderMaterial;
  /** Range in the glow pool for a vent, if this moon has one. */
  ventStart?: number;
  ventCount?: number;
}

interface PlanetRig {
  spec: PlanetSpec;
  info: BodyInfo;
  anchor: THREE.Object3D;
  body: THREE.Object3D;
  axis: THREE.Object3D;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  ring?: THREE.Mesh;
  ringMaterial?: THREE.ShaderMaterial;
  trail: THREE.Line;
  trailMaterial: THREE.ShaderMaterial;
  moons: MoonRig[];
  angle: number;
  /** Eased 0..1 towards 1 while hovered or selected. */
  focus: number;
}

interface Pickable {
  object: THREE.Object3D;
  info: BodyInfo;
  /** What the label and the fly-to actually aim at — the body itself, which
   * for a moon is not the same object as its hit sphere's parent. */
  anchor: THREE.Object3D;
}

interface LabelRig {
  info: BodyInfo;
  anchor: THREE.Object3D;
  el: HTMLDivElement;
  valueEl: HTMLSpanElement;
  nameEl: HTMLSpanElement;
  bodyEl: HTMLSpanElement;
  lastText: string;
  lastValue: string;
  lastBody: string;
  visible: boolean;
}

/* ────────────────────────────── the scene ────────────────────────────── */

/* Half again what it was. Everything that frames the star is written as a
 * multiple of this — the corona's reach, its hit sphere, the camera's floor
 * below — so they all follow. The one thing that does not follow for free is
 * the inner system: the corona now reaches 41 units, past Mercury at 26 and
 * Venus at 37, so both of those spend their orbits inside its outer haze. */
const SUN_RADIUS = 12;
/** Pluto's own radius. Named because the tidal stretch has to work out how
 * long the filament it is drawing has actually become in world units. */
const PLUTO_RADIUS = 2.4;

/** The axis the galaxy's plane is perpendicular to, in scene coordinates.
 *
 * Tilted off the ecliptic, because the real one is: the solar system's plane
 * and the galaxy's are nothing like parallel, and a band that ran along the
 * orbits would read as a ring belonging to this system. One constant, shared
 * by the photographed band and the glow painted around it — they have to be
 * the same band or the sky has two galaxies in it. */
const GALACTIC_POLE = new THREE.Vector3(0.36, 0.86, -0.35).normalize();

/** Where the camera rests, and how wide it sees, for a given viewport shape.
 *
 * One fixed position cannot serve all three. The system is a flat, wide disc:
 * on a 16:9 desktop its width is comfortably inside the frame, but on a phone
 * held upright the *horizontal* field is the constraint and the same camera
 * shows a postage stamp in the middle of a tall black screen. So a portrait
 * viewport gets both a wider lens and more distance, and is framed on the
 * inner system — Saturn's orbit rather than Neptune's — because a phone screen
 * that tries to hold all eight planets holds none of them legibly. Pinching
 * out still reaches the rest. */
function viewFor(aspect: number, height: number): { position: THREE.Vector3; fov: number } {
  if (aspect < 0.8) return { position: new THREE.Vector3(0, 210, 520), fov: 58 };
  if (aspect < 1.25) return { position: new THREE.Vector3(0, 150, 380), fov: 50 };
  // A phone turned sideways: plenty of width, almost no height.
  if (aspect > 1.9 && height < 560) return { position: new THREE.Vector3(0, 80, 300), fov: 54 };
  return { position: new THREE.Vector3(0, 92, 268), fov: 46 };
}

/** Where the arrival flight begins: the same view, much further out and much
 * higher, so the system unfolds from above as the camera drops into the
 * plane. Capped below OrbitControls' own maxDistance, which clamps the radius
 * on its first update() and would otherwise snap the camera inward on frame
 * one, before the tween has moved at all. */
function introStartFor(rest: THREE.Vector3): THREE.Vector3 {
  const start = rest.clone();
  start.setY(start.y * 2.4).multiplyScalar(1.35);
  if (start.length() > 870) start.setLength(870);
  return start;
}

/** The layer the invisible hit spheres live on, and nothing else does.
 *
 * They must be hit-testable and never drawn, and `material.visible = false` is
 * NOT how you get that: three skips such a material's *shading*, but the mesh
 * still goes through the pipeline and still writes depth, so every hit sphere
 * was punching a hole in the sky around its body — a faint twelve-sided
 * outline with the starfield missing inside it, which is exactly what the
 * sphere's own tessellation looks like. Layers cut them out of rendering
 * properly: the camera only ever draws layer 0, the raycaster only ever tests
 * this one, and the two sets stay disjoint by construction. */
const PICK_LAYER = 1;

export class HubScene {
  private container: HTMLElement;
  private callbacks: SceneCallbacks;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass | null = null;
  private lensPass: ShaderPass | null = null;
  private gradePass: ShaderPass;
  /** THREE.Clock is deprecated as of r18x in favour of Timer. Connected to
   * the document below, which lets it use the Page Visibility API: a tab
   * returning from the background otherwise hands back one enormous delta and
   * every orbit in the scene jumps a minute forward at once. The delta is
   * still clamped at the call site — connect() covers the tab-switch case, not
   * a long main-thread stall. */
  private timer = new THREE.Timer();

  private tier: Tier;
  private config: TierConfig;
  /** True when the caller named a tier explicitly, which also switches off the
   * frame-rate sampling below — a pinned tier that demotes itself anyway is
   * not pinned. */
  private pinned: boolean;
  private reducedMotion: boolean;

  private labelLayer: HTMLDivElement;
  private labels: LabelRig[] = [];
  private pickables: Pickable[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(-10, -10);
  private pointerInside = false;

  private planets: PlanetRig[] = [];
  private sunMaterial!: THREE.ShaderMaterial;
  private coronaMaterial!: THREE.ShaderMaterial;
  /** Billboarded to the camera every frame — see buildStar. */
  private corona!: THREE.Mesh;
  private nebulaMaterial: THREE.ShaderMaterial | null = null;
  private starMaterial!: THREE.ShaderMaterial;
  private starGeometry!: THREE.BufferGeometry;
  private belt: THREE.InstancedMesh | null = null;
  private beltGroup!: THREE.Object3D;

  private glow!: GlowPool;
  private textures: THREE.Texture[] = [];
  private disposables: { dispose(): void }[] = [];

  /* black hole */
  private holeGroup!: THREE.Object3D;
  private discMaterial!: THREE.ShaderMaterial;
  private feed = 0;
  /* the jet, fired along the spin axis whenever something is swallowed */
  private jetGroup!: THREE.Object3D;
  private jetMaterials: THREE.ShaderMaterial[] = [];
  /** Every cone in the jet, with the fraction of the beam's width it carries.
   * Four of them: a sheath and a bright spine, in each of two directions. */
  private jetCones: { mesh: THREE.Mesh; width: number }[] = [];
  /** Six floats per grain of gas in the beam: where along it the grain starts,
   * which arm of the helix it belongs to, how far off the axis it rides, how
   * fast it climbs, a size roll, and which pole it left by. */
  private jetParticles: Float32Array = new Float32Array(0);
  private jetParticleStart = 0;
  private jetParticleCount = 0;
  /** The beam's frame in world space, rebuilt each frame from the hole's own
   * axes so the swirl turns with the disc rather than with the world. */
  private jetAxis = new THREE.Vector3();
  private jetSideA = new THREE.Vector3();
  private jetSideB = new THREE.Vector3();

  /* Pluto, on its way in */
  private pluto!: THREE.Mesh;
  private plutoMaterial!: THREE.ShaderMaterial;
  private plutoDebrisStart = 0;
  private plutoDebris: Float32Array = new Float32Array(0);
  /** How many debris slots were reserved in the glow pool. Fixed for the
   * scene's lifetime: the pool hands out ranges once and never compacts. */
  private debrisCount = 0;

  /* the blue star the hole eats after Pluto */
  private blueStar!: THREE.Mesh;
  private blueStarMaterial!: THREE.ShaderMaterial;
  private blueStarHalo!: THREE.Mesh;
  private blueStarHaloMaterial!: THREE.ShaderMaterial;
  /** Four floats per stream particle: position along the ribbon, two spreads,
   * and a size/phase roll. */
  private stream: Float32Array = new Float32Array(0);
  private streamStart = 0;
  private streamCount = 0;
  /** How many of them are currently drawn. A demotion lowers this; every slot
   * past it is explicitly hidden rather than left holding its last frame,
   * which is what a demotion that only shrank the loop bound would do. */
  private activeDebris = 0;

  /* the neutron binary */
  private neutronGroup!: THREE.Object3D;
  private neutronSlots = { a: 0, b: 0, merged: 0 };
  /** The pair's orbital phase, integrated frame by frame — see updateNeutron. */
  private neutronAngle = 0;
  /** The layered gas shells of the remnant, innermost first. */
  private remnant: { mesh: THREE.Mesh; material: THREE.ShaderMaterial; scale: number }[] = [];
  /** Clumps of ejecta flying clear of the shells. Six floats each: direction
   * xyz, speed, size, colour roll. */
  private knots: Float32Array = new Float32Array(0);
  private knotStart = 0;
  private knotCount = 0;
  private flash = 0;

  /* the probe */
  private voyager!: THREE.Object3D;

  /* comets */
  private cometStart = 0;
  private comets: { a: number; e: number; incl: number; node: number; period: number; phase: number; hue: THREE.Color }[] = [];
  private readonly COMET_TAIL = 46;

  /* camera choreography */
  private flight: {
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    t: number;
    duration: number;
    /** Fired on arrival. Only the dock's "go here" flights carry one — a tap
     * in the sky focuses without navigating, and the intro has none. */
    body: BodyInfo | null;
    /** The body being flown to, when it is one. Planets keep orbiting during
     * the flight, so the destination is re-aimed at it every frame; without
     * this the camera arrives where the body *was* a second ago. */
    follow: THREE.Object3D | null;
  } | null = null;
  private warp = 0;
  /** Set the first time the visitor moves the camera themselves. After that a
   * resize keeps their view instead of re-framing it out from under them —
   * which matters on a phone, where the address bar collapsing on scroll fires
   * a resize the visitor did not ask for. */
  private userMoved = false;
  private idleFor = 0;
  private tourIndex = 0;
  private tourEnabled = false;
  private tourTimer = 0;

  private hovered: BodyInfo | null = null;
  /** The body the camera is currently centred on, if any. Two things hang off
   * it: the orbit controls pivot around this body rather than the sun (so
   * zooming goes toward what you are looking at), and a second tap on it opens
   * its destination instead of re-framing it. */
  private selectedKey: string | null = null;
  /** The scene object `controls.target` rides along with. Null means the sun. */
  private followAnchor: THREE.Object3D | null = null;
  /** Where that anchor was last frame — the follow moves the rig by the
   * difference rather than snapping the pivot onto the body, so whatever the
   * visitor has panned or zoomed to since is not undone every frame. */
  private followPrev = new THREE.Vector3();
  /** How close the controls may get while a body is held. Kept apart from
   * controls.minDistance because the free-flying floor is recomputed every
   * frame (see updateZoomFloor) and would otherwise overwrite it. */
  private focusFloor = 14;
  private feedValues: FeedMap = { KOSPI: null, KOSDAQ: null, SPX: null, NDX: null };
  private lang: "ko" | "en" = "ko";
  private pulse = 0;

  private frame = 0;
  private fpsFrames = 0;
  private fpsSince = 0;
  private running = true;
  private ready = false;

  private resizeObserver: ResizeObserver;
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();

  constructor(container: HTMLElement, callbacks: SceneCallbacks, tier?: Tier) {
    this.container = container;
    this.callbacks = callbacks;
    this.pinned = tier !== undefined;
    this.tier = tier ?? initialTier();
    this.config = TIERS[this.tier];
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false, // MSAA happens on the composer's target instead
      powerPreference: "high-performance",
      alpha: false,
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.config.dpr));
    this.renderer.setSize(width, height);
    this.renderer.setClearColor(0x02040a, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.classList.add("h2-canvas");
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const view = viewFor(width / height, height);
    this.camera = new THREE.PerspectiveCamera(view.fov, width / height, 0.4, 6000);
    // The intro starts far out and above; see startIntro(). Kept inside the
    // controls' own maxDistance below — OrbitControls clamps the radius on its
    // first update(), and a start outside that clamp snaps to it on frame one,
    // which is a visible jump before the arrival tween has even begun.
    this.camera.position.copy(introStartFor(view.position));

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;

    /* Free exploration, on a leash.
     *
     * Panning used to be off, and the wheel zoomed at the sun and nowhere
     * else, which meant the only way to get a close look at anything was to
     * tap it and accept the camera's framing. Anything the scene does not
     * treat as a body — the belt, the far side of Saturn's rings, the stretch
     * of sky the black hole's jet crosses — could not be approached at all.
     *
     * So: the pivot moves (pan), and the wheel and the pinch aim at whatever
     * is under the pointer rather than at the pivot (zoomToCursor). Together
     * those are enough to put the camera anywhere, which is the point.
     *
     * The leash is maxTargetRadius. A visitor who pans the system off-screen
     * has no obvious way back to it, and that was the real reason panning was
     * off; a hard ceiling on how far the pivot can travel from the sun means
     * the system is always behind you rather than gone. It is set beyond the
     * furthest thing the camera is ever flown to, which is the probe out past
     * 800 units — a leash that clamps a fly-to would drag the camera off its
     * own destination every frame. */
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.panSpeed = 0.8;
    this.controls.zoomToCursor = true;
    this.controls.maxTargetRadius = 1000;
    this.controls.minDistance = 14;
    this.controls.maxDistance = 900;
    // Stop just short of both poles, so the scene never flips through the
    // gimbal and the orbital plane never collapses to a perfectly flat line.
    this.controls.minPolarAngle = 0.16;
    this.controls.maxPolarAngle = Math.PI - 0.22;
    this.controls.rotateSpeed = 0.62;
    this.controls.zoomSpeed = 0.85;
    this.controls.autoRotateSpeed = 0.24;
    this.controls.target.set(0, 0, 0);
    /* Right-drag and middle-drag pan; two fingers pinch *and* pan, which is
       the whole gesture set a phone has. The one thing missing is the mouse
       gesture most people already know for this — shift and drag — and that
       is not a mode OrbitControls has, so bindEvents() swaps what the left
       button does while the key is held. */
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    // The camera keeps its default (layer 0 only), so anything on PICK_LAYER
    // is never drawn; the raycaster is pointed at PICK_LAYER alone, so it only
    // ever considers hit spheres and never the art.
    this.raycaster.layers.set(PICK_LAYER);

    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "h2-labels";
    container.appendChild(this.labelLayer);

    this.glow = new GlowPool(6200, this.renderer.getPixelRatio());
    this.scene.add(this.glow.points);

    this.buildBackdrop();
    this.buildStar();
    this.buildPlanets();
    this.buildAsteroidBelt();
    this.buildBlackHole();
    this.buildNeutronBinary();
    this.buildVoyager();
    this.buildComets();

    this.composer = this.buildComposer(width, height);
    this.gradePass = this.composer.passes[this.composer.passes.length - 1] as ShaderPass;

    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    /* A handle on the running scene, dev builds only — Vite compiles this
       branch out of production entirely. Worth keeping: the only way to find
       out which of seventy objects is drawing a given artifact is to reach in
       and hide them one at a time, and the alternative to a handle is adding
       one temporarily every time and forgetting to take it out. Same spirit as
       the type-1 hub's own ?hbtier / ?hboff switches. */
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__orbit2 = this;
    }
    this.startIntro();
    this.timer.connect(document);
    this.fpsSince = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  /* ══════════════════════════ construction ══════════════════════════ */

  private texture(url: string): THREE.Texture {
    const tex = new THREE.TextureLoader().load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    // Equirectangular maps wrap in longitude and clamp in latitude; letting
    // latitude wrap smears the north pole across the south one.
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    this.textures.push(tex);
    return tex;
  }

  /** The nebula shell and the starfield inside it. */
  private buildBackdrop() {
    this.buildMilkyWay();

    if (this.config.nebula) {
      const geo = new THREE.SphereGeometry(2600, 48, 32);
      this.nebulaMaterial = new THREE.ShaderMaterial({
        vertexShader: NEBULA_VERT,
        fragmentShader: NEBULA_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uColorA: { value: new THREE.Color(0x0a1234) },
          uColorB: { value: new THREE.Color(0x3a1f6e) },
          uColorC: { value: new THREE.Color(0x8a3c7a) },
          uIntensity: { value: 0.5 },
          uGalacticPole: { value: GALACTIC_POLE.clone() },
        },
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        /* Additive, so the photograph behind it survives. This shell used to
           write a solid colour over every pixel of the sky — which was fine
           when there was nothing behind it but the clear colour, and would now
           paint out the Milky Way completely. Adding is also the truer model:
           gas in front of a star field does not replace it, it glows in front
           of it.

           Left out of the transparent queue on purpose (`transparent` stays
           false; three applies the blend mode either way). The transparent
           queue is drawn after the opaque one, so a "transparent" backdrop
           with depthTest off would add itself over the planets and the sun
           rather than behind them. */
        blending: THREE.AdditiveBlending,
      });
      const nebula = new THREE.Mesh(geo, this.nebulaMaterial);
      nebula.renderOrder = -20;
      nebula.frustumCulled = false;
      this.scene.add(nebula);
      this.disposables.push(geo, this.nebulaMaterial);
    }

    this.buildSkyPhoto();

    const count = this.config.stars;
    const rand = mulberry32(20260807);
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const color = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const flare = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // On a shell rather than in a volume: these are meant to be at infinity,
      // and a volume would give the near ones visible parallax against the
      // planets, which would read as fireflies inside the solar system.
      const u = rand() * 2 - 1;
      const theta = rand() * Math.PI * 2;
      const r = 1900 + rand() * 500;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(theta) * s * r;
      pos[i * 3 + 1] = u * r;
      pos[i * 3 + 2] = Math.sin(theta) * s * r;

      // Heavily skewed: a real field is overwhelmingly faint stars with a few
      // bright ones, and a uniform distribution reads as noise.
      const brightness = Math.pow(rand(), 3.4);
      size[i] = 0.9 + brightness * 5.2;
      const [cr, cg, cb] = pickStarColor(rand);
      const lift = 0.55 + brightness * 0.45;
      color[i * 3] = cr * lift;
      color[i * 3 + 1] = cg * lift;
      color[i * 3 + 2] = cb * lift;
      phase[i] = rand();
      flare[i] = brightness > 0.72 ? (brightness - 0.72) * 3.0 : 0;
    }

    this.starGeometry = new THREE.BufferGeometry();
    this.starGeometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.starGeometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    this.starGeometry.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
    this.starGeometry.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    this.starGeometry.setAttribute("aFlare", new THREE.BufferAttribute(flare, 1));

    this.starMaterial = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: this.renderer.getPixelRatio() } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const stars = new THREE.Points(this.starGeometry, this.starMaterial);
    stars.frustumCulled = false;
    stars.renderOrder = -10;
    this.scene.add(stars);
    this.disposables.push(this.starGeometry, this.starMaterial);
  }

  /** The Milky Way, as a real 360° photograph of the whole sky.
   *
   * Credit: ESO/S. Brunier (eso0932a), CC BY 4.0 — a 6000×3000 equirectangular
   * panorama, republished here at 4096 and, for the low tier, 2048. Same
   * licence and the same visible-credit requirement as the Horsehead, which is
   * why both are named in the HUD.
   *
   * This replaces a band that was drawn procedurally, and the reason is width
   * rather than fidelity. `pow(band, 26)` is a stripe a few degrees thick: it
   * is what the galaxy looks like in a wide-field photograph reduced to one
   * number, and it read as a seam across the sky rather than as a galaxy. The
   * photograph brings the real thing — the bulge, the dust lanes through it,
   * the Magellanic Clouds off to one side — and the shader widens it further
   * (see MILKYWAY_FRAG) so it covers the sky the way it does from a dark site.
   *
   * The sphere sits outside the starfield shell (1900–2400) but inside the far
   * plane, and is drawn before everything: it is the background the rest of
   * the sky is layered onto. */
  private buildMilkyWay() {
    /* The panorama is the single largest asset this page loads, so the low
       tier — which is the phone tier — gets a quarter of the pixels. At the
       size the band is drawn, that difference is most visible in the bulge and
       barely anywhere else. */
    const texture = this.texture(this.tier === "low" ? "/img/sky/milkyway-2k.webp" : "/img/sky/milkyway-4k.webp");

    // Enough segments that the UV-to-longitude mapping stays smooth across a
    // sphere this large; the shader reads the geometry's own UVs.
    const geo = new THREE.SphereGeometry(2900, 96, 64);
    const material = new THREE.ShaderMaterial({
      vertexShader: MILKYWAY_VERT,
      fragmentShader: MILKYWAY_FRAG,
      uniforms: {
        uMap: { value: texture },
        // Low enough to sit behind a starfield rather than compete with it.
        uIntensity: { value: 0.62 },
        uWiden: { value: 1.5 },
        uHaze: { value: 0.85 },
        uTint: { value: new THREE.Color(0.78, 0.86, 1.05) },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });

    const mesh = new THREE.Mesh(geo, material);
    /* Tip the image's own pole onto the galactic pole the painted glow uses,
       then spin it about that axis to bring the bulge round to where there is
       sky to show it in — from the resting camera the core sits off to one
       side rather than directly behind the sun, which would have put the
       brightest part of the sky behind the brightest object in it. */
    mesh.quaternion
      .setFromUnitVectors(new THREE.Vector3(0, 1, 0), GALACTIC_POLE)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 2.35));
    mesh.renderOrder = -24;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.disposables.push(geo, material);
  }

  /** The Horsehead, as a real photograph hung in one corner of the sky.
   *
   * Credit: ESO (eso0202a), CC BY 4.0 — https://www.eso.org/public/images/eso0202a/
   * ESO requires that credit be shown *visibly*, which is why it also appears
   * in the HUD rather than only here. Same footing as the planet textures,
   * which are CC BY 4.0 from Solar System Scope and public-domain NASA/USGS.
   *
   * Placed low and to one side: the black hole already owns the upper left and
   * the neutron remnant the upper right, and the lower sky is where this page
   * has room. Far enough out (2450) to sit outside every orbit and behind the
   * whole starfield. */
  private buildSkyPhoto() {
    const texture = new THREE.TextureLoader().load("/img/sky/horsehead.jpg");
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.textures.push(texture);

    const width = 1100;
    const geo = new THREE.PlaneGeometry(width, width * (1054 / 1024));
    const material = new THREE.ShaderMaterial({
      vertexShader: SKYPHOTO_VERT,
      fragmentShader: SKYPHOTO_FRAG,
      uniforms: {
        uMap: { value: texture },
        // Low: this is meant to read as something very far away, not as the
        // subject. It shares the sky with a star and a black hole.
        uIntensity: { value: 0.6 },
        uTint: { value: new THREE.Color(0.72, 0.82, 1.0) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    const mesh = new THREE.Mesh(geo, material);
    // Far enough left and down to own the empty lower sky, but pulled inboard
    // of an earlier aim that put the horse's head half outside the frame and
    // the rest of it behind the index readout.
    const dir = new THREE.Vector3(-0.3, -0.4, -0.87).normalize();
    mesh.position.copy(dir).multiplyScalar(2450);
    mesh.lookAt(0, 0, 0);
    // Between the procedural nebula (-20) and the starfield (-10), so the
    // stars come out in front of it as they should.
    mesh.renderOrder = -16;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.disposables.push(geo, material);
  }

  private buildStar() {
    const geo = new THREE.SphereGeometry(SUN_RADIUS, this.config.segments, this.config.segments / 2);
    this.sunMaterial = new THREE.ShaderMaterial({
      vertexShader: SUN_VERT,
      fragmentShader: SUN_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uPulse: { value: 0 },
        /* Warmer and lifted. The old ramp ran from a near-black oxblood to a
           pale cream, which is closer to what a G-type photosphere really
           looks like but reads on screen as a dim ember with a white middle.
           Every stop moves toward orange and up in value: the cool lanes are
           now a lit red rather than a dark one, and the hot granules keep
           enough yellow to still be the brightest thing on the surface without
           going white — a white core is what stops a star reading as orange
           however orange the rest of it is. */
        uCool: { value: new THREE.Color(0xcc4a0d) },
        uWarm: { value: new THREE.Color(0xffa23a) },
        uHot: { value: new THREE.Color(0xffe3ab) },
      },
    });
    const sun = new THREE.Mesh(geo, this.sunMaterial);
    this.scene.add(sun);
    this.disposables.push(geo, this.sunMaterial);

    /* A camera-facing disc rather than a shell — see SUNGLOW_FRAG. Built two
       units across so the shader gets position.xy in -1..1 for free, then
       scaled to the reach the glow should actually have. */
    const CORONA_REACH = SUN_RADIUS * 3.4;
    const coronaGeo = new THREE.PlaneGeometry(2, 2, 1, 1);
    this.coronaMaterial = new THREE.ShaderMaterial({
      vertexShader: SUNGLOW_VERT,
      fragmentShader: SUNGLOW_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uPulse: { value: 0 },
        // The corona follows the photosphere: further toward orange, and up,
        // or a warm star sits inside a paler halo than itself.
        uColor: { value: new THREE.Color(0xff9b38) },
        uIntensity: { value: 0.68 },
        // Where the photosphere's edge falls in the disc's own 0..1 radius.
        uUnit: { value: SUN_RADIUS / CORONA_REACH },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.corona = new THREE.Mesh(coronaGeo, this.coronaMaterial);
    this.corona.scale.setScalar(CORONA_REACH);
    this.corona.renderOrder = 3;
    this.scene.add(this.corona);
    this.disposables.push(coronaGeo, this.coronaMaterial);

    // The one real light in the scene. Only the asteroid belt and the two
    // spacecraft read it — every other surface computes its own lighting from
    // uSunPos, which is what lets the terminator be soft. decay 0 because a
    // physically correct 1/r² falloff over a 200-unit system would leave
    // Neptune's rocks unlit.
    const light = new THREE.PointLight(0xfff1d4, 2.1, 0, 0);
    this.scene.add(light);
    this.scene.add(new THREE.AmbientLight(0x2a3450, 0.9));

    // The star is a destination too — the dashboard.
    const hit = this.hitSphere(SUN_RADIUS * 1.9);
    sun.add(hit);
    const info: BodyInfo = { key: "sun", ko: STAR.ko, en: STAR.en, bodyKo: STAR.bodyKo, bodyEn: STAR.bodyEn, to: STAR.to, accent: "#ffce6a", size: SUN_RADIUS, primary: true };
    this.pickables.push({ object: hit, info, anchor: sun });
    this.addLabel(info, sun);
  }

  /** An invisible, generously oversized sphere so a body 200 units away is
   * still a comfortable tap target on a phone. Raycasting against the visible
   * mesh alone would make Mercury a two-pixel target.
   *
   * Invisible by *layer*, not by material — see PICK_LAYER. */
  private hitSphere(radius: number): THREE.Mesh {
    const geo = new THREE.SphereGeometry(radius, 12, 8);
    const mat = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.layers.set(PICK_LAYER);
    this.disposables.push(geo, mat);
    return mesh;
  }

  private planetMaterial(
    map: THREE.Texture,
    glow: string,
    atmosphere: number,
    ambient: number,
    brightness = 1
  ) {
    return new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: PLANET_FRAG,
      uniforms: {
        uMap: { value: map },
        uSunPos: { value: new THREE.Vector3(0, 0, 0) },
        uAtmoColor: { value: new THREE.Color(glow) },
        uAtmoStrength: { value: atmosphere },
        uFocus: { value: 0 },
        uTrend: { value: 0 },
        uAmbient: { value: ambient },
        uExposure: { value: brightness },
      },
    });
  }

  private buildPlanets() {
    for (const spec of PLANETS) {
      const pivot = new THREE.Object3D();
      pivot.rotation.x = spec.inclination;
      this.scene.add(pivot);

      /* The track. Opacity runs around it with a bright head at the planet's
         own position (see TRAIL_FRAG), so the ring reads as being swept rather
         than as a drawn hoop. */
      const segments = 220;
      const trailPos = new Float32Array((segments + 1) * 3);
      const trailAngle = new Float32Array(segments + 1);
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        trailPos[i * 3] = Math.cos(a) * spec.radius;
        trailPos[i * 3 + 1] = 0;
        trailPos[i * 3 + 2] = Math.sin(a) * spec.radius;
        trailAngle[i] = a;
      }
      const trailGeo = new THREE.BufferGeometry();
      trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
      trailGeo.setAttribute("aAngle", new THREE.BufferAttribute(trailAngle, 1));
      const trailMat = new THREE.ShaderMaterial({
        vertexShader: TRAIL_VERT,
        fragmentShader: TRAIL_FRAG,
        uniforms: {
          uColor: { value: new THREE.Color(spec.glow) },
          uHead: { value: 0 },
          uOpacity: { value: 0.9 },
          uFocus: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const trail = new THREE.Line(trailGeo, trailMat);
      trail.renderOrder = 1;
      pivot.add(trail);
      this.disposables.push(trailGeo, trailMat);

      const anchor = new THREE.Object3D();
      pivot.add(anchor);
      const body = new THREE.Object3D();
      body.position.x = spec.radius;
      anchor.add(body);

      // The equatorial plane: the rings and the moons live in it, which is
      // where the real ones are. Uranus's is nearly vertical, as its is.
      const axis = new THREE.Object3D();
      axis.rotation.z = spec.ring ? spec.ring.tilt : 0.18;
      body.add(axis);

      const geo = new THREE.SphereGeometry(spec.size, this.config.segments, this.config.segments / 2);
      const material = this.planetMaterial(this.texture(spec.texture), spec.glow, spec.atmosphere, 0.28, spec.brightness);
      const mesh = new THREE.Mesh(geo, material);
      axis.add(mesh);
      this.disposables.push(geo, material);

      const info: BodyInfo = { key: spec.key, ko: spec.ko, en: spec.en, bodyKo: spec.bodyKo, bodyEn: spec.bodyEn, to: spec.to, feed: spec.feed, accent: spec.glow, size: spec.size, primary: true };
      const hit = this.hitSphere(Math.max(spec.size * 2.6, 4.2));
      body.add(hit);
      this.pickables.push({ object: hit, info, anchor: body });
      this.addLabel(info, body);

      let ring: THREE.Mesh | undefined;
      let ringMaterial: THREE.ShaderMaterial | undefined;
      if (spec.ring) {
        const inner = spec.size * spec.ring.inner;
        const outer = spec.size * spec.ring.outer;
        // Rotated into the XZ plane on the CPU so the shader can read radius
        // straight off `position.xz`, and so local +Y is the plane normal that
        // RING_VERT hands down for the backscatter term.
        const ringGeo = new THREE.RingGeometry(inner, outer, 180, 8);
        ringGeo.rotateX(-Math.PI / 2);
        ringMaterial = new THREE.ShaderMaterial({
          vertexShader: RING_VERT,
          fragmentShader: RING_FRAG,
          uniforms: {
            uColor: { value: new THREE.Color(...spec.ring.color) },
            uSunPos: { value: new THREE.Vector3(0, 0, 0) },
            uPlanetPos: { value: new THREE.Vector3() },
            uPlanetRadius: { value: spec.size },
            uInner: { value: inner },
            uOuter: { value: outer },
            uOpacity: { value: spec.ring.opacity },
            uFocus: { value: 0 },
            uStyle: { value: spec.ring.style === "saturn" ? 0 : 1 },
          },
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        ring = new THREE.Mesh(ringGeo, ringMaterial);
        ring.renderOrder = 2;
        axis.add(ring);
        this.disposables.push(ringGeo, ringMaterial);
      }

      const moons: MoonRig[] = [];
      if (this.config.moons && spec.moons) {
        for (const moon of spec.moons) moons.push(this.buildMoon(moon, axis, spec));
      }

      this.planets.push({
        spec,
        info,
        anchor,
        body,
        axis,
        mesh,
        material,
        ring,
        ringMaterial,
        trail,
        trailMaterial: trailMat,
        moons,
        angle: spec.phase * Math.PI * 2,
        focus: 0,
      });
    }
  }

  private buildMoon(spec: MoonSpec, parent: THREE.Object3D, host: PlanetSpec): MoonRig {
    const pivot = new THREE.Object3D();
    pivot.rotation.y = spec.phase * Math.PI * 2;
    parent.add(pivot);
    const holder = new THREE.Object3D();
    holder.position.x = spec.radius;
    pivot.add(holder);

    let mesh: THREE.Object3D;
    let material: THREE.ShaderMaterial | undefined;

    if (spec.logo) {
      /* Earth's two corporate satellites. A photograph of a company does not
         exist, so these are the same Naver-backed logos every other part of
         this app uses, as camera-facing sprites — a logo mapped onto a sphere
         would be unreadable from every angle but one. */
      const mat = new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.setScalar(spec.size * 3.1);
      loadStockIconUrl(spec.logo).then((url) => {
        // The logo is fetched over the network and the visitor may well have
        // left before it lands. Creating a GPU texture for a scene that has
        // already released its context leaks it — nothing is left to dispose
        // it, because dispose() has already walked the list.
        if (!this.running) return;
        const tex = new THREE.TextureLoader().load(url, () => {
          mat.opacity = 1;
          mat.needsUpdate = true;
        });
        tex.colorSpace = THREE.SRGBColorSpace;
        this.textures.push(tex);
        mat.map = tex;
      });
      this.disposables.push(mat);
      mesh = sprite;
    } else if (spec.craft === "starship") {
      mesh = this.buildStarship(spec.size);
    } else {
      const geo = new THREE.SphereGeometry(spec.size, Math.max(24, this.config.segments / 2), Math.max(12, this.config.segments / 4));
      // Moons run a little hot too: the same dark rock and ice as the inner
      // planets, at a fraction of the on-screen size.
      material = this.planetMaterial(this.texture(spec.texture), spec.glow, 0.18, 0.32, 1.3);
      mesh = new THREE.Mesh(geo, material);
      this.disposables.push(geo, material);
    }
    holder.add(mesh);

    const info: BodyInfo = { key: `${host.key}:${spec.key}`, ko: spec.ko, en: spec.en, bodyKo: spec.ko, bodyEn: spec.en, to: spec.to, accent: spec.glow, size: spec.size, primary: false };
    const hit = this.hitSphere(Math.max(spec.size * 3.0, 1.6));
    holder.add(hit);
    this.pickables.push({ object: hit, info, anchor: holder });
    this.addLabel(info, holder);

    const rig: MoonRig = { spec, info, pivot, holder, mesh, material };

    /* Io's plumes and Enceladus's geysers — real features of exactly these two
       bodies, not decoration. Io is the most volcanically active object in the
       solar system, driven by the tidal flexing of the very orbit it is on;
       Enceladus vents water ice from its south pole hard enough to supply
       Saturn's E ring. */
    if (spec.vent) {
      const n = spec.vent === "io" ? 26 : 34;
      rig.ventStart = this.glow.allocate(n);
      rig.ventCount = n;
    }

    return rig;
  }

  /** Mars's satellite: Starship. Built from primitives rather than a model —
   * the project ships no loader and no glTF, and at this body's on-screen size
   * a silhouette plus an engine plume is all that survives anyway. */
  private buildStarship(size: number): THREE.Object3D {
    const group = new THREE.Object3D();
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3b2, metalness: 0.85, roughness: 0.38 });
    this.disposables.push(metal);

    const bodyGeo = new THREE.CylinderGeometry(size * 0.3, size * 0.3, size * 2.1, 16);
    const hull = new THREE.Mesh(bodyGeo, metal);
    group.add(hull);
    this.disposables.push(bodyGeo);

    const noseGeo = new THREE.ConeGeometry(size * 0.3, size * 0.85, 16);
    const nose = new THREE.Mesh(noseGeo, metal);
    nose.position.y = size * 1.47;
    group.add(nose);
    this.disposables.push(noseGeo);

    const finGeo = new THREE.BoxGeometry(size * 0.08, size * 0.62, size * 0.42);
    for (const angle of [0.6, -0.6, Math.PI - 0.6, Math.PI + 0.6]) {
      const fin = new THREE.Mesh(finGeo, metal);
      fin.position.set(Math.cos(angle) * size * 0.3, -size * 0.85, Math.sin(angle) * size * 0.3);
      fin.rotation.y = -angle;
      group.add(fin);
    }
    this.disposables.push(finGeo);

    const plumeGeo = new THREE.ConeGeometry(size * 0.26, size * 1.5, 14, 1, true);
    const plumeMat = new THREE.MeshBasicMaterial({
      color: 0x9fd4ff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const plume = new THREE.Mesh(plumeGeo, plumeMat);
    plume.position.y = -size * 1.75;
    plume.rotation.x = Math.PI;
    plume.name = "plume";
    group.add(plume);
    this.disposables.push(plumeGeo, plumeMat);

    // Leaned over so the craft reads as travelling along its orbit rather than
    // standing on end in space.
    group.rotation.z = -0.5;
    return group;
  }

  private buildAsteroidBelt() {
    this.beltGroup = new THREE.Object3D();
    this.scene.add(this.beltGroup);

    const count = this.config.asteroids;
    if (count === 0) return;

    // One low-poly rock, instanced. Each gets its own scale, orientation and
    // shade, which is enough for a field this small on screen — a belt of
    // identical spheres reads as beads on a string.
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: false });
    this.belt = new THREE.InstancedMesh(geo, mat, count);
    this.belt.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    this.belt.frustumCulled = false;
    this.disposables.push(geo, mat);

    const rand = mulberry32(614529);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();

    // Between Mars (65) and Jupiter (118), inset from both so the band reads as
    // strictly between the two tracks rather than grazing either. Jupiter used
    // to sit at 96 and was moved out to clear this band once it doubled in
    // size; the band itself has not moved.
    const inner = 72;
    const outer = 88;

    for (let i = 0; i < count; i++) {
      // Concentrated toward the middle of the band, thinning at both edges —
      // a uniform ring has visible hard borders.
      const t = (rand() + rand() + rand()) / 3;
      const r = inner + t * (outer - inner);
      const a = rand() * Math.PI * 2;
      // The real belt is a torus, not a disc: it has real vertical thickness,
      // proportionally more of it than the planets' own inclinations.
      const y = (rand() - 0.5) * 5.5 * (1 - Math.abs(t - 0.5));
      pos.set(Math.cos(a) * r, y, Math.sin(a) * r);

      const s = 0.09 + Math.pow(rand(), 2.6) * 0.62;
      scale.set(s * (0.7 + rand() * 0.6), s * (0.7 + rand() * 0.6), s * (0.7 + rand() * 0.6));
      e.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      q.setFromEuler(e);
      m.compose(pos, q, scale);
      this.belt.setMatrixAt(i, m);

      const shade = 0.32 + rand() * 0.5;
      color.setRGB(shade * (0.9 + rand() * 0.2), shade * 0.88, shade * 0.76);
      this.belt.setColorAt(i, color);
    }
    this.belt.instanceMatrix.needsUpdate = true;
    if (this.belt.instanceColor) this.belt.instanceColor.needsUpdate = true;
    this.beltGroup.add(this.belt);
  }

  private buildBlackHole() {
    this.holeGroup = new THREE.Object3D();
    this.holeGroup.position.set(...BLACK_HOLE.position);
    this.scene.add(this.holeGroup);

    const HORIZON = 6.5;

    // The horizon itself. Pure black, and it *writes depth*: it is what hides
    // the far half of the disc behind it. The lensing pass then draws the
    // shadow's hard edge and the photon ring over the top.
    const horizonGeo = new THREE.SphereGeometry(HORIZON, 40, 24);
    const horizonMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const horizon = new THREE.Mesh(horizonGeo, horizonMat);
    this.holeGroup.add(horizon);
    this.disposables.push(horizonGeo, horizonMat);

    const discGeo = new THREE.RingGeometry(HORIZON * 1.35, HORIZON * 5.2, 220, 24);
    discGeo.rotateX(-Math.PI / 2);
    this.discMaterial = new THREE.ShaderMaterial({
      vertexShader: DISC_VERT,
      fragmentShader: DISC_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uInner: { value: HORIZON * 1.35 },
        uOuter: { value: HORIZON * 5.2 },
        uSpinAxis: { value: new THREE.Vector3(0, 1, 0) },
        uFeed: { value: 0 },
        uGlowTint: { value: new THREE.Color(0x39ff9e) },
        uGlowMix: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const disc = new THREE.Mesh(discGeo, this.discMaterial);
    disc.renderOrder = 4;
    // Tipped well off edge-on so the disc reads as a disc from the default
    // camera rather than as a bright line.
    this.holeGroup.rotation.set(0.44, 0.6, 0.18);
    this.holeGroup.add(disc);
    this.disposables.push(discGeo, this.discMaterial);

    const info: BodyInfo = { key: "blackhole", ko: BLACK_HOLE.ko, en: BLACK_HOLE.en, bodyKo: BLACK_HOLE.bodyKo, bodyEn: BLACK_HOLE.bodyEn, to: BLACK_HOLE.to, accent: "#ff9a4d", size: HORIZON * 2.2, primary: true };
    const hit = this.hitSphere(HORIZON * 3.4);
    this.holeGroup.add(hit);
    this.pickables.push({ object: hit, info, anchor: this.holeGroup });
    this.addLabel(info, this.holeGroup);

    /* Pluto, drifting in and eventually eaten — the type-1 hub's signature
       event, kept. It is on no route: the joke is that it is not a planet, so
       it is not a destination either. */
    const plutoGeo = new THREE.SphereGeometry(PLUTO_RADIUS, 40, 24);
    this.plutoMaterial = this.planetMaterial(this.texture(PLUTO_TEXTURE), "#d8c6b4", 0.15, 0.42, 1.4);
    this.pluto = new THREE.Mesh(plutoGeo, this.plutoMaterial);
    this.scene.add(this.pluto);
    this.disposables.push(plutoGeo, this.plutoMaterial);

    this.buildJets();

    this.debrisCount = this.config.debris;
    this.activeDebris = this.debrisCount;
    this.buildBlueStar();

    this.plutoDebrisStart = this.glow.allocate(this.debrisCount);
    // Per particle: release time, three axes of spread, and a phase.
    this.plutoDebris = new Float32Array(this.debrisCount * 5);
    const rand = mulberry32(77213);
    for (let i = 0; i < this.debrisCount; i++) {
      this.plutoDebris[i * 5] = rand(); // when in the tear it is released
      this.plutoDebris[i * 5 + 1] = (rand() - 0.5) * 2;
      this.plutoDebris[i * 5 + 2] = (rand() - 0.5) * 2;
      this.plutoDebris[i * 5 + 3] = (rand() - 0.5) * 2;
      this.plutoDebris[i * 5 + 4] = rand();
    }
  }

  /** The pair of beams the hole fires when it swallows something.
   *
   * Both go out along the spin axis — perpendicular to the accretion disc, in
   * opposite directions at once, which is what a relativistic jet is. They are
   * children of holeGroup, so they inherit its tilt for free and stay square
   * to the disc no matter how the hole is turned: local +Y is the disc's own
   * normal, because the disc geometry is a ring rotated onto the XZ plane.
   *
   * Each beam is two nested cones. The sheath is wide and hollow and gets its
   * brightness from the limb term in the shader, which is what gives a beam
   * edges; the spine is a thin bright core down the middle of it. Four meshes,
   * two materials, one geometry — the cone is built one unit long so the
   * frame can scale it to whatever length the event calls for. */
  private buildJets() {
    // Open-ended: the cone is a wall of gas, and a cap across the head would
    // read as a lid on it. Narrow at the horizon, opening slightly on the way
    // out — jets are collimated, but not perfectly.
    const geo = new THREE.CylinderGeometry(1, 0.14, 1, 30, 1, true);
    geo.translate(0, 0.5, 0); // base at the origin, head at +1
    this.disposables.push(geo);

    this.jetGroup = new THREE.Object3D();
    this.jetGroup.visible = false;
    this.holeGroup.add(this.jetGroup);

    for (const spine of [0, 1]) {
      const material = new THREE.ShaderMaterial({
        vertexShader: JET_VERT,
        fragmentShader: JET_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uHead: { value: 0 },
          uEnergy: { value: 0 },
          uSpine: { value: spine },
          uHot: { value: new THREE.Color(1.0, 0.98, 0.94) },
          uCool: { value: new THREE.Color(0.36, 0.6, 1.0) },
        },
        transparent: true,
        depthWrite: false,
        // Depth *tested*, though: the horizon is opaque and writes depth, so
        // the beam going away from the camera is correctly cut off behind it.
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.jetMaterials.push(material);
      this.disposables.push(material);

      for (const sign of [1, -1]) {
        const mesh = new THREE.Mesh(geo, material);
        // The second beam is the first one turned over — same geometry, so the
        // head is at the far end of it either way.
        if (sign < 0) mesh.rotation.x = Math.PI;
        mesh.renderOrder = 5;
        mesh.frustumCulled = false;
        this.jetGroup.add(mesh);
        this.jetCones.push({ mesh, width: spine ? 0.28 : 1 });
      }
    }

    /* The gas the beam is actually made of. The cones alone are a shape: they
       have a length and a colour and they flicker, but nothing in them is
       visibly *moving material*, and at seven seconds there is far too long to
       look at that. These are the grains, and they climb the beam on a helix.

       Three arms rather than a uniform ring. A cylinder of randomly placed
       particles reads as noise no matter how it turns — the eye needs
       structure to see rotation at all, and a small number of banded arms is
       the least structure that gives it one.

       And the gas leaves in puffs, not as an even stream. Spreading the launch
       phases uniformly gives a sheath of constant density, which the eye reads
       as a lit tube — a shape, not material. Quantising them into a handful of
       clots, each with its own climb rate so it holds together on the way out,
       is what turns the beam into something that is visibly being *thrown*:
       discrete masses of smoke, wound into spiral bands by the same rotation,
       climbing one after another. That is where the hurricane in this comes
       from. The jitter is small on purpose — widen it much past a twentieth of
       the beam and the clots overlap back into the sheath they replaced. */
    this.jetParticleCount = this.tier === "low" ? 240 : this.tier === "high" ? 520 : 820;
    this.jetParticleStart = this.glow.allocate(this.jetParticleCount);
    this.jetParticles = new Float32Array(this.jetParticleCount * 7);
    const rand = mulberry32(51877);
    const arms = 3;
    const puffs = 7;
    // One rate per clot rather than per grain, so a clot arrives as a clot.
    const puffRate: number[] = [];
    for (let k = 0; k < puffs; k++) puffRate.push(0.84 + rand() * 0.3);
    for (let i = 0; i < this.jetParticleCount; i++) {
      const p = i * 7;
      const puff = i % puffs;
      // Where along the beam it starts — banded, not scattered.
      this.jetParticles[p] = (puff / puffs + (rand() - 0.5) * 0.055 + 1) % 1;
      // Tighter around the arm than before: crisp bands, not a smeared ring.
      this.jetParticles[p + 1] = ((i % arms) / arms) * Math.PI * 2 + (rand() - 0.5) * 0.4;
      // How far off the axis. Biased outward, so each clot has a wall.
      this.jetParticles[p + 2] = 0.42 + Math.pow(rand(), 0.7) * 1.06;
      this.jetParticles[p + 3] = puffRate[puff]; // how fast it climbs
      this.jetParticles[p + 4] = rand(); // size and brightness roll
      this.jetParticles[p + 5] = i % 2 === 0 ? 1 : -1; // which pole it left by
      this.jetParticles[p + 6] = puff / puffs; // the clot's own phase
    }
  }

  /** The hole's second course: a blue star the size of this system's own,
   * torn apart and swallowed after Pluto.
   *
   * Same photosphere shader as the sun, run on a hot-star colour ramp — this
   * is a real O/B-type surface, not a blue ball, and at the size of the sun it
   * is close enough to the camera during the approach that the difference
   * shows. Hidden outright for most of the cycle, which is what makes the one
   * genuinely expensive shader on the page affordable twice. */
  private buildBlueStar() {
    const geo = new THREE.SphereGeometry(SUN_RADIUS, this.config.segments, this.config.segments / 2);
    this.blueStarMaterial = new THREE.ShaderMaterial({
      vertexShader: SUN_VERT,
      fragmentShader: SUN_FRAG,
      uniforms: {
        uTime: { value: 0 },
        // Hot stars are not just brighter, they are bluer all the way down:
        // even the cool lanes of the granulation sit above white.
        uPulse: { value: 0.55 },
        uCool: { value: new THREE.Color(0x1d4bd6) },
        uWarm: { value: new THREE.Color(0x6fb4ff) },
        uHot: { value: new THREE.Color(0xecf6ff) },
      },
    });
    this.blueStar = new THREE.Mesh(geo, this.blueStarMaterial);
    this.blueStar.visible = false;
    this.scene.add(this.blueStar);
    this.disposables.push(geo, this.blueStarMaterial);

    // Its halo, on the same billboard trick the sun's corona uses.
    const haloGeo = new THREE.PlaneGeometry(2, 2, 1, 1);
    this.blueStarHaloMaterial = new THREE.ShaderMaterial({
      vertexShader: SUNGLOW_VERT,
      fragmentShader: SUNGLOW_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uPulse: { value: 0.7 },
        uColor: { value: new THREE.Color(0x6fb0ff) },
        uIntensity: { value: 0.75 },
        uUnit: { value: 1 / 3.4 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.blueStarHalo = new THREE.Mesh(haloGeo, this.blueStarHaloMaterial);
    this.blueStarHalo.scale.setScalar(SUN_RADIUS * 3.4);
    this.blueStarHalo.visible = false;
    this.blueStarHalo.renderOrder = 3;
    this.scene.add(this.blueStarHalo);
    this.disposables.push(haloGeo, this.blueStarHaloMaterial);

    /* The accretion stream. A tidally disrupted star does not fall in as a
       lump: it is drawn out into a long ribbon of gas that winds most of the
       way round the hole before it arrives. These are that ribbon. */
    this.streamCount = this.tier === "low" ? 160 : this.tier === "high" ? 380 : 620;
    this.streamStart = this.glow.allocate(this.streamCount);
    this.stream = new Float32Array(this.streamCount * 4);
    const rand = mulberry32(515151);
    for (let i = 0; i < this.streamCount; i++) {
      this.stream[i * 4] = rand(); // where along the ribbon it sits
      this.stream[i * 4 + 1] = rand(); // lateral spread
      this.stream[i * 4 + 2] = rand(); // vertical spread
      this.stream[i * 4 + 3] = rand(); // size / phase roll
    }
  }

  private buildNeutronBinary() {
    this.neutronGroup = new THREE.Object3D();
    this.neutronGroup.position.set(...NEUTRON_BINARY.position);
    this.scene.add(this.neutronGroup);

    this.neutronSlots.a = this.glow.allocate(1);
    this.neutronSlots.b = this.glow.allocate(1);
    this.neutronSlots.merged = this.glow.allocate(1);

    /* The remnant: four nested shells of gas, not one.
     *
     * A single shell can only ever be one colour at one radius, which is a
     * smoke bubble. Real ejecta is layered — the fastest, hottest material is
     * already far out while denser stuff is still climbing behind it, and each
     * layer is lit by a different element. Four of them, each with its own
     * seed, expansion rate, lumpiness and species pair, is what turns this into
     * a cloud you can look into.
     *
     * All additive with depth-write off, so they can only ever ADD light to
     * the sky behind them, never box it out — which is what keeps a large
     * effect from reading as a pasted-on rectangle, and is also why the merged
     * remnant stays visible in the middle of its own explosion.
     */
    const shellGeo = new THREE.SphereGeometry(1, 64, 40);
    this.disposables.push(shellGeo);

    /* Real Crab colours, each pair "diffuse gas" then "lit filament".
     *
     * `extra` marks the layers added to widen the palette. Six shells is two
     * more full-sphere additive passes than four, and on the cheap tier that
     * is exactly the kind of cost that shows up as a dropped frame rate for
     * twenty seconds of every fifty-two — so `low` keeps the original four and
     * everything else gets the full spread. */
    const LAYERS: { a: number; b: number; scale: number; warp: number; detail: number; seed: number; extra?: boolean }[] = [
      // Synchrotron continuum — the blue-white haze from the pulsar's own wind,
      // which in the real object sits INSIDE the filaments.
      { a: 0x3a6bd8, b: 0xcfe4ff, scale: 0.62, warp: 0.1, detail: 2.4, seed: 3.1 },
      // Ionised helium, the violet that only very hot ejecta shows.
      { a: 0x3a1a7a, b: 0xb98cff, scale: 0.72, warp: 0.13, detail: 2.8, seed: 63.5, extra: true },
      // Doubly-ionised oxygen: the teal-green that makes a remnant read as
      // something other than fire.
      { a: 0x0d6b62, b: 0x6fffd8, scale: 0.82, warp: 0.16, detail: 3.2, seed: 11.7 },
      // Iron, and dust lit from inside — the gold band between green and red.
      { a: 0x7a4a08, b: 0xffd489, scale: 0.92, warp: 0.18, detail: 3.5, seed: 84.2, extra: true },
      // Hydrogen-alpha and nitrogen: the orange-red body of the web.
      { a: 0x8c1f10, b: 0xff9c56, scale: 1.0, warp: 0.2, detail: 3.9, seed: 27.4 },
      // Singly-ionised sulphur on the outermost, coolest, thinnest skin.
      { a: 0x5e0f2a, b: 0xff5570, scale: 1.18, warp: 0.26, detail: 4.6, seed: 41.9 },
    ];

    for (const layer of LAYERS) {
      if (layer.extra && this.tier === "low") continue;
      const material = new THREE.ShaderMaterial({
        vertexShader: REMNANT_VERT,
        fragmentShader: REMNANT_FRAG,
        uniforms: {
          uColorA: { value: new THREE.Color(layer.a) },
          uColorB: { value: new THREE.Color(layer.b) },
          uIntensity: { value: 0 },
          uSeed: { value: layer.seed },
          uDetail: { value: layer.detail },
          // The filament net is the expensive part; the cheap tier gets a
          // coarser one rather than none.
          uOctaves: { value: this.tier === "low" ? 3 : 5 },
          uWarp: { value: layer.warp },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(shellGeo, material);
      mesh.visible = false;
      mesh.renderOrder = 5;
      this.neutronGroup.add(mesh);
      this.remnant.push({ mesh, material, scale: layer.scale });
      this.disposables.push(material);
    }

    /* The knots: discrete clumps of gas thrown clear of the shells and
       scattered through open space, which is the half of an explosion a set of
       nested surfaces cannot show. Each carries one of the same emission
       colours, flies at its own speed and decelerates, so the cloud keeps
       spreading and thinning long after the shells have faded. */
    this.knotCount = this.tier === "low" ? 130 : this.tier === "high" ? 320 : 540;
    this.knotStart = this.glow.allocate(this.knotCount);
    // Per knot: three direction components, speed, size and a colour roll.
    this.knots = new Float32Array(this.knotCount * 6);
    const krand = mulberry32(90210);
    for (let i = 0; i < this.knotCount; i++) {
      // Isotropic directions, then clumped by raising the speed spread — real
      // ejecta is neither uniform nor a neat sphere.
      const u = krand() * 2 - 1;
      const theta = krand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      this.knots[i * 6] = Math.cos(theta) * s;
      this.knots[i * 6 + 1] = u;
      this.knots[i * 6 + 2] = Math.sin(theta) * s;
      this.knots[i * 6 + 3] = 0.35 + Math.pow(krand(), 1.7) * 1.0;
      this.knots[i * 6 + 4] = 0.6 + krand() * 2.2;
      this.knots[i * 6 + 5] = krand();
    }

    const info: BodyInfo = { key: "neutron", ko: NEUTRON_BINARY.ko, en: NEUTRON_BINARY.en, bodyKo: NEUTRON_BINARY.bodyKo, bodyEn: NEUTRON_BINARY.bodyEn, to: NEUTRON_BINARY.to, accent: "#9fd0ff", size: 5, primary: true };
    const hit = this.hitSphere(12);
    this.neutronGroup.add(hit);
    this.pickables.push({ object: hit, info, anchor: this.neutronGroup });
    this.addLabel(info, this.neutronGroup);
  }

  private buildVoyager() {
    this.voyager = new THREE.Object3D();
    // Deliberately dim. With decay 0 the sun lights this as hard at 800 units
    // out as it does the asteroid belt at 80, and a bright metal probe out in
    // the dark reads as a bug rather than as a spacecraft.
    const metal = new THREE.MeshStandardMaterial({ color: 0x6c7280, metalness: 0.7, roughness: 0.5 });
    const gold = new THREE.MeshStandardMaterial({ color: 0x8a6a30, metalness: 0.9, roughness: 0.35 });
    this.disposables.push(metal, gold);

    // The high-gain antenna, which is most of what the real craft looks like.
    // Double-sided: it is a dish, and from behind a single-sided one is a hole.
    const dishGeo = new THREE.SphereGeometry(1.5, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.42);
    const dishMat = metal.clone();
    dishMat.side = THREE.DoubleSide;
    this.disposables.push(dishMat);
    const dish = new THREE.Mesh(dishGeo, dishMat);
    dish.rotation.x = Math.PI;
    this.voyager.add(dish);
    this.disposables.push(dishGeo);

    const busGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.5, 16);
    const bus = new THREE.Mesh(busGeo, gold);
    bus.position.y = -0.75;
    this.voyager.add(bus);
    this.disposables.push(busGeo);

    const boomGeo = new THREE.CylinderGeometry(0.05, 0.05, 4.4, 6);
    const boom = new THREE.Mesh(boomGeo, metal);
    boom.rotation.z = Math.PI / 2;
    boom.position.set(-2.1, -0.9, 0);
    this.voyager.add(boom);
    this.disposables.push(boomGeo);

    const rtgGeo = new THREE.CylinderGeometry(0.24, 0.24, 1.5, 8);
    const rtg = new THREE.Mesh(rtgGeo, metal);
    rtg.rotation.z = Math.PI / 2;
    rtg.position.set(-4.3, -0.9, 0);
    this.voyager.add(rtg);
    this.disposables.push(rtgGeo);

    this.scene.add(this.voyager);

    const info: BodyInfo = { key: "voyager", ko: VOYAGER.ko, en: VOYAGER.en, bodyKo: VOYAGER.bodyKo, bodyEn: VOYAGER.bodyEn, to: VOYAGER.to, accent: "#cfe4ff", size: 2.5, primary: false };
    const hit = this.hitSphere(5);
    this.voyager.add(hit);
    this.pickables.push({ object: hit, info, anchor: this.voyager });
    this.addLabel(info, this.voyager);
  }

  private buildComets() {
    const rand = mulberry32(4242);
    const count = this.tier === "low" ? 2 : 4;
    this.cometStart = this.glow.allocate(count * (this.COMET_TAIL + 1));
    for (let i = 0; i < count; i++) {
      this.comets.push({
        a: 130 + rand() * 120, // semi-major axis
        e: 0.62 + rand() * 0.24, // properly eccentric — comets are not planets
        incl: (rand() - 0.5) * 1.3,
        node: rand() * Math.PI * 2,
        period: 90 + rand() * 130,
        phase: rand(),
        hue: new THREE.Color().setHSL(0.5 + rand() * 0.12, 0.75, 0.66),
      });
    }
  }

  private buildComposer(width: number, height: number): EffectComposer {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    // HalfFloat so the bloom has real HDR headroom above 1.0 — with an 8-bit
    // target the sun and the photon ring clip to white before the threshold
    // pass ever sees how bright they actually are.
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: this.config.msaa,
      depthBuffer: true,
      stencilBuffer: false,
    });
    const composer = new EffectComposer(this.renderer, target);
    composer.setSize(width, height);
    composer.setPixelRatio(this.renderer.getPixelRatio());

    composer.addPass(new RenderPass(this.scene, this.camera));

    if (this.config.lensing) {
      this.lensPass = new ShaderPass(LENSING_SHADER as never);
      composer.addPass(this.lensPass);
    }

    if (this.config.bloom) {
      /* Threshold well above 1.0 in linear HDR, which is the whole reason the
         composer's target is half-float: only things that are genuinely
         emitting — the photosphere, the faculae, the photon ring, the neutron
         pair — clear it. A low threshold pulls the lit face of every planet
         into the bloom too, and the result is a scene where nothing is bright
         because everything is. */
      // Raised alongside the planets' own exposure: at 0.62 the brightened
      // bodies started clearing the threshold themselves and dissolved into
      // glowing smudges. Only genuinely emitting things belong in the bloom.
      this.bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.95, 0.5, 0.95);
      composer.addPass(this.bloom);
    }

    const grade = new ShaderPass(GRADE_SHADER as never);
    grade.uniforms.uGrain.value = this.config.grain;
    grade.uniforms.uResolution.value = [width, height];
    // Last pass — it writes to the screen, so it also owns the final look.
    grade.renderToScreen = true;
    composer.addPass(grade);

    return composer;
  }

  /* ══════════════════════════ labels ══════════════════════════ */

  private addLabel(info: BodyInfo, anchor: THREE.Object3D) {
    const el = document.createElement("div");
    el.className = `h2-tag${info.primary ? "" : " is-secondary"}`;
    el.style.setProperty("--accent", info.accent);

    const dot = document.createElement("span");
    dot.className = "h2-tag-dot";
    const name = document.createElement("span");
    name.className = "h2-tag-name";
    const value = document.createElement("span");
    value.className = "h2-tag-val";
    /* The body's own name — 수성, 지구, 블랙홀. Empty except while the pointer
       is on it (or the camera is holding it), so the resting sky stays a map
       of destinations and only the thing you are actually pointing at also
       tells you what it is. */
    const body = document.createElement("span");
    body.className = "h2-tag-body";

    el.append(dot, name, value, body);
    this.labelLayer.appendChild(el);
    this.labels.push({
      info,
      anchor,
      el,
      nameEl: name,
      valueEl: value,
      bodyEl: body,
      lastText: "",
      lastValue: "",
      lastBody: "",
      visible: false,
    });
  }

  /** Which labels earn a place this frame, and how far away each one is.
   *
   * A label qualifies when its body is a primary destination (or is under the
   * pointer / selected — moons and the probe only announce themselves that
   * way, since thirteen permanent captions inside Jupiter's moon system would
   * be unreadable), is in front of the camera, and has not faded out with
   * distance. Hovered and selected bodies bypass the budget entirely: the one
   * thing a visitor has actually pointed at must never be the label that got
   * cut. */
  private labelCandidates(
    camDir: THREE.Vector3,
    budget: number
  ): Map<LabelRig, { distance: number; fade: number }> {
    const kept = new Map<LabelRig, { distance: number; fade: number }>();
    const ranked: { label: LabelRig; distance: number; fade: number }[] = [];
    // Relative to how far the camera itself is sitting, so the fade behaves the
    // same when parked outside Neptune and when flown up against Mercury.
    const orbit = this.camera.position.distanceTo(this.controls.target);
    const reach = orbit + 480;

    for (const label of this.labels) {
      const { info } = label;
      const pinned = this.hovered?.key === info.key || this.selectedKey === info.key;
      if (!info.primary && !pinned) continue;

      label.anchor.getWorldPosition(this.tmpV);
      const toBody = this.tmpV.sub(this.camera.position);
      // Behind the camera: project() still returns a finite point, mirrored.
      if (toBody.dot(camDir) <= 0) continue;

      const distance = toBody.length();
      const fade = 1 - clamp01((distance - reach) / reach);
      if (fade <= 0.02) continue;

      if (pinned) kept.set(label, { distance, fade });
      else ranked.push({ label, distance, fade });
    }

    ranked.sort((a, b) => a.distance - b.distance);
    for (const entry of ranked) {
      if (kept.size >= budget) break;
      kept.set(entry.label, { distance: entry.distance, fade: entry.fade });
    }
    return kept;
  }

  /** Projects every label to screen and writes its transform directly. Runs
   * once a frame; nothing here touches React.
   *
   * Two passes rather than one, because whether a label is shown depends on
   * the *other* labels: on a narrow viewport only the nearest handful survive,
   * and that cannot be decided until all of their distances are known. The
   * first pass measures; the second writes. */
  private updateLabels() {
    const rect = this.container.getBoundingClientRect();
    const halfW = rect.width / 2;
    const halfH = rect.height / 2;
    const camDir = this.camera.getWorldDirection(this.tmpV2);
    const halfFov = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const narrow = rect.width < 760;

    /* A phone cannot hold eleven captions over a solar system without them
       becoming a pile of overlapping pills, and a distance threshold is the
       wrong tool for it — what counts as "far" changes completely between the
       resting view and a body the camera has flown right up to. A hard cap on
       *how many* is stable at every zoom, and nothing is lost: the dock below
       carries the full list, with the same names and the same numbers. */
    const budget = narrow ? 5 : Infinity;
    const shown = this.labelCandidates(camDir, budget);

    for (const label of this.labels) {
      const { info } = label;
      const measured = shown.get(label);
      if (!measured) {
        if (label.visible) {
          label.el.classList.remove("is-on");
          label.visible = false;
        }
        continue;
      }
      const { distance, fade } = measured;
      const hovered = this.hovered?.key === info.key;
      const selected = this.selectedKey === info.key;

      label.anchor.getWorldPosition(this.tmpV);
      this.tmpV.project(this.camera);
      const rawX = this.tmpV.x * halfW + halfW;
      const rawY = -this.tmpV.y * halfH + halfH;

      /* A body genuinely outside the frame gets no label at all. Clamping is
         only meant to rescue a body sitting *on* the edge whose caption would
         hang off it — the black hole and the neutron binary, being the only
         routes to the two TOP 100 boards, are the ones that matters for.
         Applied unconditionally it does the opposite: fly the camera down to
         Saturn and every other body in the system, most of them now far behind
         the viewport, stacks its name in a row along the top border. */
      const slackX = rect.width * 0.06;
      const slackY = rect.height * 0.06;
      if (rawX < -slackX || rawX > rect.width + slackX || rawY < -slackY || rawY > rect.height + slackY) {
        if (label.visible) {
          label.el.classList.remove("is-on");
          label.visible = false;
        }
        continue;
      }

      // The label is anchored to the right of its body (see .h2-tag's
      // translate in hub2.css), so the right margin has to allow for its own
      // width; 150px covers the longest of them.
      const x = Math.min(Math.max(rawX, 12), rect.width - 150);
      const y = Math.min(Math.max(rawY, 14), rect.height - 14);

      /* Stand the label off by the body's own apparent radius, so it sits
         beside what it names instead of on top of it. A fixed offset works
         for Mercury and buries the black hole's accretion disc under its own
         caption. */
      const apparent = (info.size / distance / halfFov) * halfH;
      label.el.style.setProperty("--offset", `${Math.min(Math.max(apparent + 12, 14), 130).toFixed(0)}px`);
      label.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      label.el.style.opacity = (hovered || selected ? 1 : fade * 0.92).toFixed(2);

      const text = this.lang === "en" ? info.en : info.ko;
      if (text !== label.lastText) {
        label.nameEl.textContent = text;
        label.lastText = text;
      }

      const raw = info.feed ? this.feedValues[info.feed] : null;
      const valueText = raw === null || raw === undefined ? "" : `${raw >= 0 ? "+" : ""}${raw.toFixed(2)}%`;
      if (valueText !== label.lastValue) {
        label.valueEl.textContent = valueText;
        label.el.dataset.tone = raw === null || raw === undefined ? "flat" : raw > 0 ? "up" : raw < 0 ? "down" : "flat";
        label.lastValue = valueText;
      }

      // Only the body under the pointer (or held by the camera) says what it
      // is; on every other label it stays empty and collapses to nothing.
      const bodyText = hovered || selected ? (this.lang === "en" ? info.bodyEn : info.bodyKo) : "";
      if (bodyText !== label.lastBody) {
        label.bodyEl.textContent = bodyText;
        label.lastBody = bodyText;
      }

      label.el.classList.toggle("is-hot", hovered || selected);
      if (!label.visible) {
        label.el.classList.add("is-on");
        label.visible = true;
      }
    }
  }

  /* ══════════════════════════ interaction ══════════════════════════ */

  private pointerDownAt: { x: number; y: number; t: number } | null = null;

  private bindEvents() {
    const el = this.renderer.domElement;
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerleave", this.onPointerLeave);
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointerup", this.onPointerUp);
    this.controls.addEventListener("start", this.onUserInput);
    window.addEventListener("wheel", this.onUserInput, { passive: true });
    window.addEventListener("keydown", this.onModifier);
    window.addEventListener("keyup", this.onModifier);
  }

  /** Shift held: the left button pans instead of orbiting. Read off the event
   * rather than tracked, so a Shift released while the window was not focused
   * cannot leave the button stuck in the wrong mode. */
  private onModifier = (event: KeyboardEvent) => {
    this.controls.mouseButtons.LEFT = event.shiftKey ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  };

  private onUserInput = () => {
    this.idleFor = 0;
    this.userMoved = true;
    this.controls.autoRotate = false;
  };

  private setPointerFromEvent(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onPointerMove = (event: PointerEvent) => {
    this.setPointerFromEvent(event);
    this.pointerInside = true;
    this.idleFor = 0;
    this.controls.autoRotate = false;
  };

  private onPointerLeave = () => {
    this.pointerInside = false;
    this.pointer.set(-10, -10);
    if (this.hovered) {
      this.hovered = null;
      this.callbacks.onHover(null);
      this.renderer.domElement.style.cursor = "grab";
    }
  };

  private onPointerDown = (event: PointerEvent) => {
    this.onUserInput();
    // Only the primary button chooses. The other two are pan and dolly now, and
    // a right-drag that happens to end where it started is not a tap.
    this.pointerDownAt = event.button === 0 ? { x: event.clientX, y: event.clientY, t: performance.now() } : null;
  };

  private onPointerUp = (event: PointerEvent) => {
    const down = this.pointerDownAt;
    this.pointerDownAt = null;
    if (!down) return;
    // A drag that happens to end on a body is a camera move, not a choice.
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    if (moved > 9 || performance.now() - down.t > 700) return;

    this.setPointerFromEvent(event);
    const hit = this.pick();
    if (hit) this.tapBody(hit.info);
  };

  private pick(): Pickable | null {
    if (this.pointer.x < -1 || this.pointer.x > 1) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const objects = this.pickables.map((p) => p.object);
    const hits = this.raycaster.intersectObjects(objects, false);
    if (hits.length === 0) return null;
    const first = hits[0].object;
    return this.pickables.find((p) => p.object === first) ?? null;
  }

  /* ══════════════════════════ camera ══════════════════════════ */

  /** The resting view for the container's current shape. */
  private restPosition(): THREE.Vector3 {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    return viewFor(width / height, height).position;
  }

  private startIntro() {
    // A long, slow arrival: the system unfolds once, from far outside the
    // orbit of Neptune down into the plane. Skipped entirely under reduced
    // motion, which is the whole point of the setting.
    if (this.reducedMotion) {
      this.camera.position.copy(this.restPosition());
      this.controls.target.set(0, 0, 0);
      return;
    }
    this.beginFlight({
      fromPos: this.camera.position.clone(),
      toPos: this.restPosition(),
      fromTarget: this.controls.target.clone(),
      toTarget: new THREE.Vector3(0, 0, 0),
      t: 0,
      duration: 3.4,
      body: null,
      follow: null,
    });
  }

  /** Chooses a camera position for a body: outside the system looking in, and
   * a little above the plane, blended with wherever the camera already is so
   * a fly-to across the system doesn't whip through 180°. */
  private framePosition(target: THREE.Vector3, size: number): THREE.Vector3 {
    const distance = Math.max(size * 6.5, 16);
    const outward = target.clone().setY(0);
    if (outward.lengthSq() < 0.01) outward.set(0, 0, 1);
    outward.normalize();
    const tangent = new THREE.Vector3(-outward.z, 0, outward.x);
    const preferred = outward.multiplyScalar(0.78).add(tangent.multiplyScalar(0.3)).add(new THREE.Vector3(0, 0.42, 0)).normalize();
    const current = this.camera.position.clone().sub(target);
    const dir = current.lengthSq() > 0.01 ? current.normalize().multiplyScalar(0.35).add(preferred.multiplyScalar(0.65)).normalize() : preferred;
    return target.clone().add(dir.multiplyScalar(distance));
  }

  /** What a tap on a body in the sky does.
   *
   * Two steps, deliberately. A single tap used to fly to the body and then
   * navigate, which meant a visitor could never actually *look* at anything —
   * pointing at Jupiter to see it left the page. So the first tap frames the
   * body and hands the camera to it: from then on dragging orbits that body
   * and the wheel/pinch zooms toward it rather than toward the sun. Only a
   * second tap on the same body opens its destination.
   *
   * The rule is uniform across every clickable thing in the scene — the star,
   * the eight planets, the moons, the black hole, the neutron binary and the
   * probe — so there is never a body whose first tap does something else. */
  tapBody(info: BodyInfo) {
    if (this.selectedKey === info.key) {
      this.callbacks.onSelect(info);
      return;
    }
    this.focusOn(info);
  }

  /** Frames a body and makes it the camera's pivot. Does not navigate. */
  focusOn(info: BodyInfo, duration = 1.05) {
    const pickable = this.pickables.find((p) => p.info.key === info.key);
    if (!pickable) return false;

    this.selectedKey = info.key;
    this.followAnchor = pickable.anchor;
    this.callbacks.onFocus(info);

    /* Close enough to fill the frame, but not inside the body itself. This is
       the floor for as long as the camera holds it; updateZoomFloor() reads it
       rather than replacing it. */
    this.focusFloor = Math.max(info.size * 1.7, 2.2);

    const target = pickable.anchor.getWorldPosition(new THREE.Vector3());
    this.followPrev.copy(target);
    if (this.reducedMotion) {
      // No tween, but still re-seat the camera so the body is centred and the
      // pivot is where the follow logic expects it.
      this.camera.position.copy(this.framePosition(target, info.size));
      this.controls.target.copy(target);
      return true;
    }

    this.beginFlight({
      fromPos: this.camera.position.clone(),
      toPos: this.framePosition(target, info.size),
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      t: 0,
      // Short enough to feel like a response to the tap rather than a cutscene.
      duration,
      body: null,
      follow: pickable.anchor,
    });
    return true;
  }

  /** The HUD dock's "go here": fly, then open. The dock is the page's explicit
   * navigation — a list of destinations, reachable by keyboard — so it stays
   * one press. Exploring is what the sky is for. Returns false when no body
   * carries that key, so the caller can navigate directly instead of waiting
   * for a fly-to that will never arrive. */
  selectByKey(key: string): boolean {
    const pickable = this.pickables.find((p) => p.info.key === key);
    if (!pickable) return false;
    const info = pickable.info;

    if (this.reducedMotion) {
      this.callbacks.onSelect(info);
      return true;
    }

    this.selectedKey = info.key;
    const target = pickable.anchor.getWorldPosition(new THREE.Vector3());
    this.beginFlight({
      fromPos: this.camera.position.clone(),
      toPos: this.framePosition(target, info.size),
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      t: 0,
      duration: 1.05,
      body: info,
      follow: pickable.anchor,
    });
    return true;
  }

  /** Dock hover: highlight only. Never moves the camera. */
  focusByKey(key: string | null) {
    if (this.selectedKey && this.followAnchor) return; // a real focus outranks a hover
    this.selectedKey = key;
  }

  /** Back to the whole system, and hand the pivot back to the sun. */
  resetCamera() {
    this.selectedKey = null;
    this.followAnchor = null;
    this.userMoved = false;
    this.focusFloor = 14;
    this.callbacks.onFocus(null);
    this.beginFlight({
      fromPos: this.camera.position.clone(),
      toPos: this.restPosition(),
      fromTarget: this.controls.target.clone(),
      toTarget: new THREE.Vector3(0, 0, 0),
      t: 0,
      duration: 1.5,
      body: null,
      follow: null,
    });
  }

  setTour(on: boolean) {
    this.tourEnabled = on;
    // Fire on the very next frame, and start at the first stop rather than the
    // second — the index is advanced before it is used.
    this.tourTimer = 0;
    if (on) this.tourIndex = -1;
    else this.controls.autoRotate = false;
  }

  /** One stop every TOUR_INTERVAL seconds, flight included.
   *
   * The clock deliberately keeps running while the camera is in transit. An
   * earlier version paused it during the flight, which made the real period
   * "dwell plus however long the trip happened to take" — a number that
   * changed with the distance between one body and the next, so the tour
   * never actually had a tempo. Counting through the flight means each stop
   * gets the same ten seconds no matter where it is. */
  private advanceTour(dt: number) {
    if (!this.tourEnabled) return;
    this.tourTimer -= dt;
    if (this.tourTimer > 0) return;
    this.tourTimer = HubScene.TOUR_INTERVAL;

    this.tourIndex = (this.tourIndex + 1) % TOUR_ORDER.length;
    const pickable = this.pickables.find((p) => p.info.key === TOUR_ORDER[this.tourIndex]);
    // A body the current quality tier dropped (moons at the low tier) simply
    // is not there to visit; skip to the next tick rather than stalling.
    if (!pickable) return;

    /* A tour looks, it does not navigate — which is exactly what focusing a
       body does, so it goes through the same path and inherits the follow
       behaviour: the camera rides each planet along its orbit for the whole
       time it is parked there. */
    this.focusOn(pickable.info, HubScene.TOUR_FLIGHT);
  }

  /** Starts a camera move and takes the controls away for its duration.
   *
   * Both halves matter. `enabled = false` stops a drag from fighting the
   * tween — OrbitControls re-derives the camera position from its own
   * spherical state on every update(), so an input delta arriving mid-flight
   * would be applied on top of whatever this wrote and the camera would
   * corkscrew. `autoRotate = false` is the same problem from the other side:
   * an idle scene that has started drifting would keep drifting *through* a
   * fly-to and never actually arrive at the body it was aimed at. */
  private beginFlight(flight: NonNullable<HubScene["flight"]>) {
    this.flight = flight;
    this.controls.enabled = false;
    this.controls.autoRotate = false;
  }

  /** Rides the focused body. Called after the orbital update so the body's
   * position is this frame's, and before controls.update() so the pivot is
   * already right when the controls re-derive the camera from it.
   *
   * The whole rig — pivot and camera together — is translated by however far
   * the body moved since last frame. That is what makes this a follow rather
   * than a snap: the visitor's own orbit angle and zoom distance are preserved
   * while the body carries them along its orbit.
   *
   * Measuring the body against its own last position rather than against the
   * pivot matters now that the pivot can be moved. The older version wrote the
   * body's position straight into the target, so a pan away from Jupiter was
   * undone on the very next frame and the camera appeared welded to it. */
  private updateFollow() {
    if (!this.followAnchor || this.flight) return;
    this.followAnchor.getWorldPosition(this.tmpV);
    this.tmpV2.copy(this.tmpV).sub(this.followPrev);
    this.followPrev.copy(this.tmpV);
    if (this.tmpV2.lengthSq() < 1e-10) return;
    this.controls.target.add(this.tmpV2);
    this.camera.position.add(this.tmpV2);
  }

  /** How close the controls may get to the pivot, recomputed every frame.
   *
   * A single floor cannot serve both jobs. Out at the whole-system view it
   * stops the camera from being flown into the middle of the sun, and a few
   * units of clearance above the photosphere is about right for that. But the
   * pivot is no longer pinned to the sun: point at Mercury and zoom and the
   * same floor holds you at arm's length from a body one unit across. So the
   * floor relaxes as the pivot travels away from the star, continuously rather
   * than in a step — a jump in minDistance is a jump in the camera, because
   * the controls clamp the radius on the next update().
   *
   * Both constants are written off SUN_RADIUS rather than left as the literals
   * they used to be (14 and 12, which were that radius plus six and one and a
   * half times it). A star that grows and a floor that does not is a camera
   * that can be flown inside the photosphere. */
  private updateZoomFloor() {
    if (this.followAnchor) {
      this.controls.minDistance = this.focusFloor;
      return;
    }
    const floor = SUN_RADIUS + 6;
    const fromStar = this.controls.target.length();
    this.controls.minDistance = THREE.MathUtils.clamp(floor - (fromStar - SUN_RADIUS * 1.5) * 0.5, 2.5, floor);
  }

  private updateFlight(dt: number) {
    if (!this.flight) {
      this.warp *= Math.exp(-dt * 5);
      return;
    }
    const f = this.flight;

    /* Re-aim at the body as it moves. Planets do not wait for the camera:
       over a one-second flight Mercury travels a visible fraction of its
       orbit, and a destination captured at take-off lands the camera beside
       an empty patch of sky. Shifting `toPos` by the same delta keeps the
       framing that framePosition() worked out. */
    if (f.follow) {
      f.follow.getWorldPosition(this.tmpV);
      this.tmpV2.copy(this.tmpV).sub(f.toTarget);
      f.toTarget.copy(this.tmpV);
      f.toPos.add(this.tmpV2);
    }

    f.t += dt / f.duration;
    const done = f.t >= 1;
    const t = clamp01(f.t);
    // The intro eases out only (it is already moving when you arrive); a
    // fly-to eases in and out, so it settles rather than stopping dead.
    const e = f.body || f.duration > 2 ? easeInOutCubic(t) : easeOutCubic(t);

    this.camera.position.lerpVectors(f.fromPos, f.toPos, e);
    this.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);

    // Speed, as the frame sees it: peaks mid-flight and is gone on arrival.
    this.warp = Math.sin(t * Math.PI) * (f.body ? 0.85 : 0.35);

    if (done) {
      this.flight = null;
      this.warp = 0;
      this.controls.enabled = true;
      // The body has moved for the whole trip while the follow sat idle, so
      // re-prime it here or the first followed frame would translate the rig
      // by everything that happened during the flight in one go.
      if (f.follow) this.followPrev.copy(f.toTarget);
      // Arriving counts as activity: the scene should not start drifting the
      // instant a fly-to settles.
      this.idleFor = 0;
      if (f.body) this.callbacks.onSelect(f.body);
    }
  }

  /* ══════════════════════════ live data ══════════════════════════ */

  setFeed(feed: FeedMap) {
    this.feedValues = feed;
    // The star's own energy: how much the market is actually moving today.
    // This is the one place in the scene where the data changes the physics
    // rather than just printing a number.
    const values = (Object.keys(feed) as FeedKey[]).map((k) => feed[k]).filter((v): v is number => v !== null);
    const average = values.length ? values.reduce((s, v) => s + Math.abs(v), 0) / values.length : 0;
    this.pulse = clamp01(average / 2.2);

    for (const planet of this.planets) {
      const value = planet.spec.feed ? feed[planet.spec.feed] : null;
      planet.material.uniforms.uTrend.value = value === null || value === undefined ? 0 : clamp01(Math.abs(value) / 2.5) * Math.sign(value);
    }
  }

  setLang(lang: "ko" | "en") {
    this.lang = lang;
    // Force every label to re-read its text on the next frame.
    for (const label of this.labels) {
      label.lastText = "";
      label.lastBody = "";
    }
  }

  /* ══════════════════════════ the frame ══════════════════════════ */

  private tick = () => {
    if (!this.running) return;
    this.frame = requestAnimationFrame(this.tick);

    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    const time = this.timer.getElapsed();
    const speed = this.reducedMotion ? 0.25 : 1;

    this.updateFlight(dt);
    if (!this.flight) {
      this.idleFor += dt;
      // Left alone, the scene starts turning on its own. Slowly enough that it
      // reads as drift rather than as a carousel.
      if (this.idleFor > 22 && !this.reducedMotion) this.controls.autoRotate = true;
    }
    this.advanceTour(dt);

    /* Order matters here, and it is the whole reason the orbital update sits
       above the controls rather than below them:

         1. move the bodies, so the focused one's position is this frame's;
         2. carry the camera rig with it (updateFollow);
         3. only then let OrbitControls re-derive the camera from the pivot.

       Run the controls first and the pivot they read is one frame stale, which
       on a body moving at Mercury's rate is a visible shimmy. */
    this.updatePlanets(dt, time, speed);
    this.updateFollow();
    this.updateZoomFloor();
    this.controls.update();

    this.sunMaterial.uniforms.uTime.value = time * speed;
    this.sunMaterial.uniforms.uPulse.value += (this.pulse - this.sunMaterial.uniforms.uPulse.value) * dt * 1.6;
    this.coronaMaterial.uniforms.uTime.value = time * speed;
    this.coronaMaterial.uniforms.uPulse.value = this.sunMaterial.uniforms.uPulse.value;
    // Face the camera. A billboard has no silhouette of its own to give away,
    // which is the entire reason the corona is one.
    this.corona.quaternion.copy(this.camera.quaternion);
    this.starMaterial.uniforms.uTime.value = time;
    if (this.nebulaMaterial) this.nebulaMaterial.uniforms.uTime.value = time;

    if (this.beltGroup) this.beltGroup.rotation.y += dt * 0.012 * speed;
    this.updateBlackHole(dt, time, speed);
    this.updateNeutron(dt, time, speed);
    this.updateVoyager(time, speed);
    this.updateComets(time, speed);
    this.glow.flush();

    this.updateHover();
    this.updateLabels();
    this.updatePasses(time);

    this.composer.render();

    if (!this.ready) {
      this.ready = true;
      this.callbacks.onReady();
    }
    this.sampleFps();
  };

  private updatePlanets(dt: number, time: number, speed: number) {
    const sun = new THREE.Vector3(0, 0, 0);
    for (const planet of this.planets) {
      const spec = planet.spec;
      planet.angle += (dt / spec.period) * Math.PI * 2 * speed;
      planet.anchor.rotation.y = planet.angle;
      planet.mesh.rotation.y = (time / spec.spin) * Math.PI * 2 * speed;

      const isFocused = this.hovered?.key === spec.key || this.selectedKey === spec.key;
      planet.focus += ((isFocused ? 1 : 0) - planet.focus) * Math.min(1, dt * 7);
      planet.material.uniforms.uFocus.value = planet.focus;
      planet.trailMaterial.uniforms.uFocus.value = planet.focus;
      // The trail's bright head sits at the planet's own angular position. The
      // shader measures backwards from it, so this is the only thing the wake
      // needs to know.
      planet.trailMaterial.uniforms.uHead.value = -planet.angle;

      if (planet.ringMaterial) {
        planet.body.getWorldPosition(this.tmpV);
        planet.ringMaterial.uniforms.uPlanetPos.value.copy(this.tmpV);
        planet.ringMaterial.uniforms.uFocus.value = planet.focus;
      }

      for (const moon of planet.moons) {
        // Dropped by a demotion. Its vent, if it has one, has to be put out
        // too — the glow pool holds whatever was last written to a slot, so a
        // plume left mid-eruption would simply hang there without its moon.
        if (!moon.pivot.visible) {
          if (moon.ventStart !== undefined && moon.ventCount) {
            for (let i = 0; i < moon.ventCount; i++) this.glow.hide(moon.ventStart + i);
          }
          continue;
        }
        moon.pivot.rotation.y = moon.spec.phase * Math.PI * 2 + (time / moon.spec.period) * Math.PI * 2 * speed;
        if (moon.material) {
          moon.mesh.rotation.y = (time / moon.spec.spin) * Math.PI * 2 * speed;
          const moonFocused = this.hovered?.key === moon.info.key;
          moon.material.uniforms.uFocus.value += ((moonFocused ? 1 : 0) - moon.material.uniforms.uFocus.value) * Math.min(1, dt * 7);
        }
        if (moon.spec.craft === "starship") {
          // Kept pointing along its own track, and the plume breathing.
          moon.mesh.rotation.y = -moon.pivot.rotation.y;
          const plume = moon.mesh.getObjectByName("plume") as THREE.Mesh | undefined;
          if (plume) {
            const flicker = 0.42 + Math.abs(Math.sin(time * 9.3)) * 0.3;
            (plume.material as THREE.MeshBasicMaterial).opacity = flicker;
            plume.scale.set(1, 0.85 + Math.sin(time * 13.1) * 0.15, 1);
          }
        }
        if (moon.ventStart !== undefined && moon.ventCount) {
          this.updateVent(moon, time, speed);
        }
      }

      // Keep the sun's position current in every surface shader. It is the
      // origin and never moves, so this is a copy rather than a computation —
      // but it keeps the materials self-describing rather than assuming it.
      planet.material.uniforms.uSunPos.value.copy(sun);
    }
  }

  /** Io's plumes and Enceladus's geysers. Particles are launched from a fixed
   * vent on the surface, arc under a weak pull back toward the moon, and fade
   * — the real ones are ballistic, not a jet, because neither body has enough
   * atmosphere to hold a column up. */
  private updateVent(moon: MoonRig, time: number, speed: number) {
    const start = moon.ventStart!;
    const count = moon.ventCount!;
    const radius = moon.spec.size;
    const io = moon.spec.vent === "io";
    // The vent's own place on the surface. Io's Pele-analogue sits near the
    // equator; Enceladus's tiger stripes are at its south pole, so its plume
    // fires straight "down".
    const ventDir = io ? new THREE.Vector3(0.62, 0.38, 0.68).normalize() : new THREE.Vector3(0.12, -0.98, 0.1).normalize();

    moon.holder.getWorldPosition(this.tmpV);
    const origin = this.tmpV;
    const reach = io ? radius * 7.5 : radius * 9;
    const spread = io ? 0.42 : 0.24;

    for (let i = 0; i < count; i++) {
      const seed = (i * 0.6180339887) % 1;
      const life = ((time * speed * (io ? 0.42 : 0.3) + seed) % 1);
      // Ballistic: up fast, then falling back.
      const height = Math.sin(life * Math.PI) * reach;
      const drift = life * reach * 0.55;

      const a = seed * Math.PI * 2;
      const wobble = spread * life;
      const dir = ventDir
        .clone()
        .add(new THREE.Vector3(Math.cos(a) * wobble, Math.sin(a * 1.7) * wobble * 0.6, Math.sin(a) * wobble))
        .normalize();

      const p = origin.clone().add(dir.clone().multiplyScalar(radius + height * 0.6 + drift * 0.3));
      const fade = Math.sin(life * Math.PI);
      const size = (io ? 0.55 : 0.45) * (0.5 + fade * 0.9);
      if (io) {
        // Sulphur: yellow at the vent, cooling to red as it falls.
        this.glow.set(start + i, p.x, p.y, p.z, size, 1.0, 0.72 - life * 0.32, 0.28, fade * 0.5);
      } else {
        this.glow.set(start + i, p.x, p.y, p.z, size, 0.82, 0.92, 1.0, fade * 0.42);
      }
    }
  }

  /* ─────────────────── the hole, and what it is eating ─────────────────── */

  /* The hole's meal, in order: Pluto in, green afterglow, then a blue star the
     size of this system's own drawn in and torn apart, then a blue afterglow,
     then a pause before it starts again. The two afterglows are five seconds
     each, which is long enough to notice from anywhere in the scene and short
     enough that the disc spends most of its life its own colour. */
  private static readonly PLUTO_APPROACH = 15;
  private static readonly PLUTO_TEAR = 4;
  /** Green: the rock is gone. */
  private static readonly GREEN_GLOW = 7;
  private static readonly STAR_APPROACH = 11;
  private static readonly STAR_TEAR = 4;
  /** Blue-white, and much brighter: a whole star has just gone in. */
  private static readonly BLUE_GLOW = 7;

  /* Cumulative marks on the cycle, which is what the frame actually tests
     against. The last four seconds are the hole at rest, with nothing falling
     in and the disc back to its own colour — the pause is what keeps the two
     meals from reading as one continuous feeding frenzy. */
  private static readonly T_PLUTO_END = 15 + 4; // 19
  private static readonly T_GREEN_END = 19 + 7; // 26
  private static readonly T_STAR_END = 26 + 11 + 4; // 41
  private static readonly T_BLUE_END = 41 + 7; // 48
  private static readonly BH_CYCLE = 48 + 4; // 52, the last 4 being the rest

  /** How long a jet burns. Seven seconds, and the afterglows above were
   * stretched from five to match: the beam and the disc's own colour are one
   * event, and a beam still blowing after the glow it belongs to had faded
   * would read as two. Long enough that a visitor who is looking at something
   * else when it starts still gets to turn round and watch it. */
  private static readonly JET_LIFE = 7;
  /** How much of that the head spends travelling. Nearly all of the drama is
   * here: the beam has to *fire*, not appear. */
  private static readonly JET_LAUNCH = 0.5;

  private updateBlackHole(dt: number, time: number, speed: number) {
    this.discMaterial.uniforms.uTime.value = time * speed;
    this.holeGroup.getWorldPosition(this.tmpV);

    // The disc's spin axis, in world space — everything the Doppler beaming
    // term needs to know about which way the gas is moving.
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(this.holeGroup.getWorldQuaternion(new THREE.Quaternion()));
    this.discMaterial.uniforms.uSpinAxis.value.copy(axis);

    const cycle = (time * speed) % HubScene.BH_CYCLE;
    const holePos = this.tmpV.clone();

    /* The afterglow. Green for the seven seconds after Pluto, blue-white and
       far brighter for the seven after the star. Eased rather than switched,
       so the disc bleeds into and out of the colour instead of flicking. */
    let glowMix = 0;
    let glowBright = 0;
    if (cycle >= HubScene.T_PLUTO_END && cycle < HubScene.T_GREEN_END) {
      const g = (cycle - HubScene.T_PLUTO_END) / HubScene.GREEN_GLOW;
      // Up fast, hold, then fade — the fade is the longer half.
      glowMix = Math.min(1, g * 6) * (1 - Math.pow(g, 2.4));
      this.discMaterial.uniforms.uGlowTint.value.setRGB(0.16, 1.0, 0.5);
      glowBright = glowMix * 0.22;
    } else if (cycle >= HubScene.T_STAR_END && cycle < HubScene.T_BLUE_END) {
      const g = (cycle - HubScene.T_STAR_END) / HubScene.BLUE_GLOW;
      glowMix = Math.min(1, g * 8) * (1 - Math.pow(g, 2.6));
      this.discMaterial.uniforms.uGlowTint.value.setRGB(0.4, 0.72, 1.0);
      // A whole star went in, so this one burns harder than the green — but
      // only about twice as hard, not enough to clip to white.
      glowBright = glowMix * 0.5;
    }
    this.discMaterial.uniforms.uGlowMix.value = glowMix;

    if (cycle < HubScene.T_PLUTO_END) {
      this.pluto.visible = true;
      // A decaying spiral rather than a straight fall: anything falling into a
      // hole with angular momentum to shed goes round several times first.
      const p = cycle / HubScene.T_PLUTO_END;
      const distance = 120 * Math.pow(1 - p, 1.55) + 5;
      const angle = p * Math.PI * 5.4;
      const dir = new THREE.Vector3(Math.cos(angle), Math.sin(angle * 0.6) * 0.22, Math.sin(angle)).normalize();

      const tear = clamp01((cycle - HubScene.PLUTO_APPROACH) / HubScene.PLUTO_TEAR);
      /* Spaghettification, and it is not something that happens at the end.
         The difference between the hole's pull on the near face and on the far
         one goes as 1/r³, so the body is already being drawn out long before
         it arrives — which is why this runs off the distance it has left and
         not off the tear clock. By the time the tear finishes it is a filament
         many tens of times its own diameter, not a ball that abruptly bursts.
         Squashed on the other two axes to conserve something like volume,
         which is what makes it read as being pulled rather than scaled. */
      const drawn = Math.pow(clamp01((125 - distance) / 118), 2.6);
      /* Tuned against the resting camera, not in the abstract. The hole sits
         near the top-left corner of the frame, so a filament here runs across
         the screen and out of it — at the first numbers this reached about
         240 units and left the viewport entirely, which is not a longer effect
         than one that stays in frame, it is a shorter one with its end cut
         off. These land the thread at roughly a third of the screen's width. */
      const stretch = 1 + drawn * 22 + tear * tear * 36;
      const halfLen = PLUTO_RADIUS * stretch;
      /* Where the filament sits. Once it is longer than the distance it still
         has to fall, a body scaled about its own centre would poke out the far
         side of the hole — so past that point the leading tip is pinned just
         outside the horizon and it is the tail that runs outward instead. The
         orbit's direction is untouched; only how far down it the centre sits. */
      const centre = Math.max(distance, halfLen + 5.5);
      this.pluto.position.copy(holePos).addScaledVector(dir, centre);

      this.pluto.lookAt(holePos);
      // The last of it thins to nothing rather than shrinking: a filament that
      // got shorter as it died would read as retreating, not as being eaten.
      /* Volume would say the transverse axes go as stretch^-0.5. They go as
         ^-0.4 instead: at these lengths the honest exponent leaves a filament
         a couple of hundred units long and under a pixel wide, which is not a
         subtler effect, it is an invisible one. */
      const thin = (1 - clamp01((tear - 0.55) / 0.45)) / Math.pow(stretch, 0.4);
      this.pluto.scale.set(thin, thin, stretch);
      this.pluto.visible = thin * stretch > 0.02;

      this.updatePlutoDebris(holePos, tear, time, speed);
      this.feed += ((tear > 0.25 ? tear : 0) - this.feed) * Math.min(1, dt * 2.4);
    } else {
      this.pluto.visible = false;
      for (let i = 0; i < this.debrisCount; i++) this.glow.hide(this.plutoDebrisStart + i);
      // Between meals the hole cools back down; the afterglow above carries
      // the colour, this carries the heat.
      this.feed += (glowBright - this.feed) * Math.min(1, dt * 1.8);
    }

    this.updateBlueStar(cycle, holePos, dt, time, speed);
    const jet = this.updateJets(cycle, holePos, time, speed);
    /* The beam is fed by the same material the disc is: while one is burning,
       the disc under it is brighter than the afterglow alone would make it.
       Held to a third rather than the old 0.6, though — uFeed drives both the
       disc's own brightness and the photon ring's, and at full jet power the
       two together lifted the whole hole past the bloom threshold and turned
       it into a lamp. The disc should warm when it is feeding. It should not
       out-shine the sun. */
    this.discMaterial.uniforms.uFeed.value = this.feed + glowBright + jet * 0.3;
  }

  /** The jet, on the two moments in the cycle that earn one: when the rock is
   * gone, and when the star is gone. Returns its current energy so the disc
   * can burn with it.
   *
   * Driven off the cycle clock rather than fired by an event, like everything
   * else the hole does. A flag set at the moment of ingestion would be missed
   * by a tab that was in the background for the second it mattered, and would
   * then have to be caught up or dropped; a function of `cycle` is simply
   * correct at whatever time the scene is asked about. */
  private updateJets(cycle: number, holePos: THREE.Vector3, time: number, speed: number): number {
    let since = -1;
    // A whole star gives a beam roughly twice the reach of a rock's.
    let power = 0;
    if (cycle >= HubScene.T_PLUTO_END && cycle < HubScene.T_PLUTO_END + HubScene.JET_LIFE) {
      since = cycle - HubScene.T_PLUTO_END;
      power = 0.5;
    } else if (cycle >= HubScene.T_STAR_END && cycle < HubScene.T_STAR_END + HubScene.JET_LIFE) {
      since = cycle - HubScene.T_STAR_END;
      power = 1;
    }

    if (since < 0) {
      this.jetGroup.visible = false;
      for (let i = 0; i < this.jetParticleCount; i++) this.glow.hide(this.jetParticleStart + i);
      return 0;
    }

    const life = since / HubScene.JET_LIFE;
    /* Up almost instantly, then held, then let down. The hole does not ease
       into this — but at seven seconds it cannot decay from the first frame
       either, or the back half is a beam that is already over. So: full
       brightness until half way, then a smooth fade over the rest.

       The head races out over the first half-second, decelerating, because the
       eye reads a constant-speed front as a growing rectangle rather than as
       something launched. */
    const head = Math.pow(clamp01(since / HubScene.JET_LAUNCH), 0.55);
    const held = clamp01((life - 0.5) / 0.5);
    const energy = Math.min(1, since * 24) * (1 - held * held * (3 - 2 * held));

    // Very long, deliberately: this should cross the sky, not the hole.
    const length = 620 + power * 820;
    const width = 8 + power * 10;

    // Green for the rock, matching the afterglow it fires into; blue-white for
    // the star, which is the colour the star itself was.
    const tintR = power < 1 ? 0.24 : 0.36;
    const tintG = power < 1 ? 1.0 : 0.6;
    const tintB = power < 1 ? 0.62 : 1.0;

    for (const material of this.jetMaterials) {
      material.uniforms.uTime.value = time * speed;
      material.uniforms.uHead.value = head;
      material.uniforms.uEnergy.value = energy;
      material.uniforms.uCool.value.setRGB(tintR, tintG, tintB);
    }

    for (const cone of this.jetCones) {
      // Y is the length of the cone, X and Z its width — the beam gets longer
      // and thinner as it goes, rather than simply bigger.
      cone.mesh.scale.set(width * cone.width, length, width * cone.width);
    }
    this.jetGroup.visible = energy > 0.01;

    this.updateJetParticles(holePos, since, head, energy, length, width, time, speed, tintR, tintG, tintB);
    return energy;
  }

  /** The gas climbing the beam, as a rotating funnel of discrete clots.
   *
   * A jet is not a straight pipe of material. The gas arrives with the disc's
   * angular momentum still in it and has nowhere to put it, so it leaves on a
   * helix — wound tight at the throat where the coil is narrow, unwinding as
   * the beam opens out, which is the same reason a hurricane's eyewall turns
   * faster than its outer bands and the reason a skater's spin speeds up when
   * their arms come in. Both of those are one line here: the angular rate is
   * divided by how wide the coil has become.
   *
   * Everything is placed in the hole's own frame — its local Y is the beam,
   * its local X and Z are the plane the gas is turning in — so the funnel
   * stays square to the disc, and turns the same way the disc does. */
  private updateJetParticles(
    holePos: THREE.Vector3,
    since: number,
    head: number,
    energy: number,
    length: number,
    width: number,
    time: number,
    speed: number,
    tintR: number,
    tintG: number,
    tintB: number,
  ) {
    // The hole carries no scale, so its world matrix's columns are the frame.
    const e = this.holeGroup.matrixWorld.elements;
    const side1 = this.jetSideA.set(e[0], e[1], e[2]).normalize();
    const axis = this.jetAxis.set(e[4], e[5], e[6]).normalize();
    const side2 = this.jetSideB.set(e[8], e[9], e[10]).normalize();

    const spin = time * speed;

    for (let i = 0; i < this.jetParticleCount; i++) {
      const slot = this.jetParticleStart + i;
      const p = i * 7;
      const arm = this.jetParticles[p + 1];
      const offJit = this.jetParticles[p + 2];
      const rate = this.jetParticles[p + 3];
      const roll = this.jetParticles[p + 4];
      const pole = this.jetParticles[p + 5];
      const puff = this.jetParticles[p + 6];

      /* Streaming, not a single puff: each grain climbs the beam, falls off
         the end and starts again at the throat. Seven seconds of one wave of
         particles drifting outward would be seven seconds of a thinning
         cloud; a loop is a beam that keeps being fed. */
      const climb = (this.jetParticles[p] + since * 0.34 * rate) % 1;
      // Nothing exists ahead of the head — the front of the beam is still on
      // its way out during the launch.
      if (climb > head) {
        this.glow.hide(slot);
        continue;
      }

      // Accelerating away from the hole, so the throat stays dense and the
      // gas strings out as it climbs.
      const along = Math.pow(climb, 1.35) * length * pole;
      // The funnel: tight at the throat, opening steadily with height.
      const flare = 0.18 + Math.pow(climb, 1.2) * 1.5;
      /* The billow. A clot of gas is not a flat ring — it swells and pinches
         as it goes, and because every grain in one clot shares its phase, the
         whole mass breathes together. Without this the clots are still clots,
         but they are rigid ones, and rigid smoke is not smoke. */
      const billow = 1 + 0.44 * Math.sin(climb * 9.0 + puff * Math.PI * 2 + spin * 1.1);
      const radius = width * flare * offJit * billow;
      /* The wind. Negative, because that is the direction the disc under it
         is turning (see the Doppler term in DISC_FRAG); divided by the flare,
         so a grain at the throat whips round several times while one out near
         the head barely turns at all. Wound harder than it used to be: at the
         old rate the spiral was legible but genteel, and the point of this is
         that the gas is being flung, not stirred. */
      const turn = arm - (spin * 2.5 + climb * 8.5) / flare;
      const cos = Math.cos(turn);
      const sin = Math.sin(turn);

      const ox = side1.x * cos + side2.x * sin;
      const oy = side1.y * cos + side2.y * sin;
      const oz = side1.z * cos + side2.z * sin;

      // White at the throat, cooling into the beam's own colour as it climbs.
      const hot = 1 - clamp01(climb * 2.2);
      /* Nothing at the very throat. The grains ride a cone whose width goes to
         nothing at the origin, so every one of them near climb = 0 lands in
         the same few pixels — and a few hundred additive grains stacked in one
         place, through the bloom, is a white ball sitting exactly where the
         hole is. That ball was the rest of what read as the hole shining;
         deleting the shader's root core only took half of it. Fading them in
         over the first few percent of the climb is what lets the beam leave
         the hole instead of the hole lighting up. */
      const emerge = clamp01(climb / 0.09);
      // Fades out before the head rather than at it, so the beam ends in gas
      // rather than in a row of dots.
      const fade = (1 - climb * climb) * energy * (0.46 + roll * 0.66) * emerge * emerge;

      this.glow.set(
        slot,
        holePos.x + axis.x * along + ox * radius,
        holePos.y + axis.y * along + oy * radius,
        holePos.z + axis.z * along + oz * radius,
        // Expanding as it goes: the gas is under no pressure out there. The
        // exponent is under one so most of the growth happens early, while the
        // clot is still tight enough for its grains to overlap into one mass —
        // which is what makes it read as a body of smoke and not as a swarm.
        1.7 + roll * 2.4 + Math.pow(climb, 0.8) * 5.0,
        tintR + (1 - tintR) * hot,
        tintG + (1 - tintG) * hot,
        tintB + (1 - tintB) * hot,
        fade,
      );
    }
  }

  /** The star's turn: a slow approach, then tidal disruption into a ribbon of
   * gas that winds into the disc.
   *
   * The stretch is the whole point. A star falling into a black hole is not
   * swallowed whole — the difference in pull between its near and far sides
   * exceeds what its own gravity can hold together, and it is drawn out into a
   * stream. So the body elongates along the line to the hole while being
   * squeezed on the other two axes, and the ribbon below is what comes off it. */
  private updateBlueStar(cycle: number, holePos: THREE.Vector3, dt: number, time: number, speed: number) {
    const active = cycle >= HubScene.T_GREEN_END && cycle < HubScene.T_STAR_END;
    if (!active) {
      this.blueStar.visible = false;
      this.blueStarHalo.visible = false;
      for (let i = 0; i < this.streamCount; i++) this.glow.hide(this.streamStart + i);
      return;
    }

    const since = cycle - HubScene.T_GREEN_END;
    const total = HubScene.STAR_APPROACH + HubScene.STAR_TEAR;
    const p = since / total;
    const tear = clamp01((since - HubScene.STAR_APPROACH) / HubScene.STAR_TEAR);

    this.blueStarMaterial.uniforms.uTime.value = time * speed;
    this.blueStarHaloMaterial.uniforms.uTime.value = time * speed;

    /* Comes in from the far side to Pluto's, and much further out — it is a
       star, so it should be visible as one long before it arrives. */
    const distance = 240 * Math.pow(1 - p, 1.4) + 11;
    const angle = Math.PI + p * Math.PI * 3.1;
    const dir = new THREE.Vector3(Math.cos(angle), Math.sin(angle * 0.5) * 0.28, Math.sin(angle)).normalize();

    /* The same spaghettification Pluto gets, and further along it: a star is
       far larger than the rock, so the tide across it is larger too, and it
       spends most of its approach visibly being drawn out. See the comment on
       Pluto's for why this runs off distance rather than off the tear clock,
       and why the centre slides back once the filament outgrows its fall. */
    /* Smaller multipliers than Pluto's for a longer thread: this body is a
       star, and its radius is over three times the rock's, so every unit of
       stretch buys three times the length. */
    const drawn = Math.pow(clamp01((250 - distance) / 236), 2.4);
    /* Divided by the same factor the star's radius grew by, because halfLen
       below is that radius times this: these numbers were tuned against the
       length the filament actually reaches on screen, and a bigger star at the
       old multipliers would have run it back out of the frame. */
    const stretch = 1 + drawn * 6.7 + tear * tear * 10.7;
    const halfLen = SUN_RADIUS * stretch;
    const centre = Math.max(distance, halfLen + 8.5);
    const pos = holePos.clone().addScaledVector(dir, centre);

    this.blueStar.position.copy(pos);
    this.blueStar.lookAt(holePos);
    const left = 1 - clamp01((tear - 0.5) / 0.5);
    // lookAt points -Z at the hole, so Z is the axis along the pull. Only the
    // two transverse axes carry the fade — the filament thins out, it does not
    // reel back in.
    const thin = left / Math.pow(stretch, 0.4); // see Pluto's, on the exponent
    this.blueStar.scale.set(thin, thin, stretch);
    this.blueStar.visible = thin * stretch > 0.02;

    /* The halo belongs to a star, and by the end of this there is no star —
       there is a thread. So it goes out with the stretch as well as with the
       fade, or a round corona sits over a filament for the whole tear. */
    const round = left / Math.pow(stretch, 0.5);
    this.blueStarHalo.position.copy(pos);
    this.blueStarHalo.quaternion.copy(this.camera.quaternion);
    this.blueStarHalo.scale.setScalar(SUN_RADIUS * 3.4 * round);
    this.blueStarHalo.visible = round > 0.05;
    this.blueStarHaloMaterial.uniforms.uIntensity.value = 0.75 * round;

    // The hole brightens as the meal gets close, well before the tearing.
    const heat = Math.max(tear, Math.pow(p, 3) * 0.7);
    this.feed += (heat - this.feed) * Math.min(1, dt * 2.2);

    /* The ribbon. Each particle sits somewhere along a path that runs from the
       star, winds most of the way around the hole, and ends at the disc — so
       the stream reads as material already in orbit rather than as a straight
       line of falling dots. */
    const toStar = pos.clone().sub(holePos);
    const starAngle = Math.atan2(toStar.z, toStar.x);
    const starDist = toStar.length();

    for (let i = 0; i < this.streamCount; i++) {
      const slot = this.streamStart + i;
      const along = this.stream[i * 4];
      const spreadA = this.stream[i * 4 + 1] - 0.5;
      const spreadB = this.stream[i * 4 + 2] - 0.5;
      const roll = this.stream[i * 4 + 3];

      // Nothing until the star is genuinely being pulled apart.
      const born = clamp01((tear - along * 0.55) / 0.45);
      if (born <= 0.01) {
        this.glow.hide(slot);
        continue;
      }

      // Wind from the star's own angle round to the disc, tightening as it goes.
      const t = clamp01(along * 0.85 + born * 0.35);
      const r = starDist * Math.pow(1 - t, 1.5) + 9;
      const a = starAngle + t * Math.PI * 2.2 + roll * 0.35;
      const wob = (1 - t) * 6;

      const x = holePos.x + Math.cos(a) * r + spreadA * wob;
      const y = holePos.y + (toStar.y / Math.max(starDist, 0.001)) * r * 0.6 + spreadB * wob;
      const z = holePos.z + Math.sin(a) * r + spreadB * wob;

      // Blue-white at the star, whitening as it compresses and heats inward.
      const hot = Math.pow(t, 1.3);
      const size = 1.1 + roll * 1.6 + hot * 1.4;
      const alpha = born * (1 - Math.pow(t, 6)) * 0.55;
      this.glow.set(slot, x, y, z, size, 0.55 + hot * 0.45, 0.76 + hot * 0.22, 1.0, alpha);
    }
  }

  private updatePlutoDebris(holePos: THREE.Vector3, tear: number, time: number, speed: number) {
    const plutoPos = this.pluto.position;
    const toHole = holePos.clone().sub(plutoPos);
    const fall = toHole.length();

    for (let i = 0; i < this.debrisCount; i++) {
      const release = this.plutoDebris[i * 5];
      const slot = this.plutoDebrisStart + i;
      if (i >= this.activeDebris || tear < release * 0.85) {
        this.glow.hide(slot);
        continue;
      }
      // How far along its own fall this fragment is, 0 at release to 1 at the
      // horizon.
      const t = clamp01((tear - release * 0.85) / (1 - release * 0.85 + 0.001));

      const spreadX = this.plutoDebris[i * 5 + 1];
      const spreadY = this.plutoDebris[i * 5 + 2];
      const spreadZ = this.plutoDebris[i * 5 + 3];
      const phase = this.plutoDebris[i * 5 + 4];

      // Each fragment winds around the hole on the way in, faster as it gets
      // closer — the same shear the disc shader draws.
      const turns = (1.6 + phase * 2.2) * t;
      const radial = fall * Math.pow(1 - t, 1.7) + 3.5;
      const angle = Math.atan2(plutoPos.z - holePos.z, plutoPos.x - holePos.x) + turns * Math.PI * 2 * 0.35 + phase * 0.6;

      const wobble = (1 - t) * 5.5;
      const x = holePos.x + Math.cos(angle) * radial + spreadX * wobble;
      const y = holePos.y + spreadY * wobble * 0.8 + (plutoPos.y - holePos.y) * Math.pow(1 - t, 1.4);
      const z = holePos.z + Math.sin(angle) * radial + spreadZ * wobble;

      // Heating on the way down: cool rock at release, white-hot at the rim.
      const heat = Math.pow(t, 1.5);
      const r = 1.0;
      const g = 0.42 + heat * 0.5;
      const b = 0.2 + heat * 0.72;
      const alpha = (1 - Math.pow(t, 5)) * 0.75;
      const size = 0.9 + heat * 1.8 + Math.sin(time * speed * 6 + phase * 20) * 0.15;
      this.glow.set(slot, x, y, z, size, r, g, b, alpha);
    }
  }

  /* ─────────────────── the neutron binary ─────────────────── */

  /** Seconds each auto-tour stop gets, travel included. */
  private static readonly TOUR_INTERVAL = 10;
  /** How much of that is spent flying there, leaving the rest to look. */
  private static readonly TOUR_FLIGHT = 2.4;

  private static readonly NS_INSPIRAL = 22;
  /** How long the remnant is on show. Half again what it was: every fade below
   * is a function of `since / NS_MERGED`, so stretching this one number slows
   * the whole expansion and every colour transition with it rather than simply
   * holding a finished cloud on screen for longer. */
  private static readonly NS_MERGED = 30;
  private static readonly NS_CYCLE = 52;

  private updateNeutron(dt: number, time: number, speed: number) {
    const t = (time * speed) % HubScene.NS_CYCLE;
    const center = this.neutronGroup.getWorldPosition(new THREE.Vector3());
    const { a, b, merged } = this.neutronSlots;

    if (t < HubScene.NS_INSPIRAL) {
      const p = t / HubScene.NS_INSPIRAL;
      // Separation shrinks, and the orbit speeds up as it does — Kepler's
      // third law, which is what makes an inspiral read as a countdown rather
      // than as a spin.
      const separation = 11 * Math.pow(1 - p, 0.62) + 0.5;
      const omega = 1.4 / Math.pow(separation * 0.16 + 0.12, 1.5);

      /* Integrated, not `time * omega`. omega itself is a function of time
         here, so multiplying the two gives the angle a *discontinuity* every
         frame as omega changes underneath it — the pair would jump around the
         circle instead of winding up. Accumulating the increment is the only
         way a varying angular rate produces a continuous phase. */
      this.neutronAngle += omega * dt * speed;

      const dx = Math.cos(this.neutronAngle) * separation;
      const dz = Math.sin(this.neutronAngle) * separation;
      // In world units now (see GLOW_VERT): each star is a few units across,
      // against a landmark whose whole reach is about twelve.
      const size = 5 + p * 3;
      const bright = 0.8 + p * 0.6;
      this.glow.set(a, center.x + dx, center.y, center.z + dz, size, 0.72 * bright, 0.86 * bright, 1.0 * bright, 1);
      this.glow.set(b, center.x - dx, center.y, center.z - dz, size, 0.72 * bright, 0.86 * bright, 1.0 * bright, 1);
      this.glow.hide(merged);

      for (const layer of this.remnant) layer.mesh.visible = false;
      for (let i = 0; i < this.knotCount; i++) this.glow.hide(this.knotStart + i);
      // The burst fires in the last instant before contact, not on a timer.
      this.flash = p > 0.995 ? 1 : this.flash * Math.exp(-dt * 6);
    } else {
      const since = t - HubScene.NS_INSPIRAL;
      this.glow.hide(a);
      this.glow.hide(b);

      // What the two of them become: one bright remnant, held while its ejecta
      // cloud expands across the sky behind it.
      const settle = clamp01(since / 1.2);
      this.glow.set(merged, center.x, center.y, center.z, 15 + (1 - settle) * 24, 0.88, 0.94, 1.0, 1);

      this.flash = since < 0.7 ? (1 - since / 0.7) * 1.0 : this.flash * Math.exp(-dt * 4);

      const grow = since / HubScene.NS_MERGED;
      if (grow < 1) {
        /* The shells. Fast at first, then coasting — a real remnant
           decelerates against whatever it is ploughing into. Each layer runs
           at its own rate, so the cloud pulls apart into distinct fronts
           instead of inflating as one surface.

           The ceiling is still bounded. An earlier pass ran this out to 320
           units, which is genuinely sky-wide and looked it on a desktop — and
           on a phone, whose horizontal field is a fraction of that, it became
           a translucent wall across two thirds of the screen. 112 is a step up
           from the 88 that replaced it, enough that the cloud now reaches past
           the pair's own neighbourhood, and still well short of the wall. */
        const front = Math.pow(grow, 0.55);
        for (const layer of this.remnant) {
          layer.mesh.visible = true;
          layer.mesh.scale.setScalar(6 + front * 112 * layer.scale);
          /* The outer, cooler layers arrive late and linger; the synchrotron
             core is brightest at the start and fades first, which is the order
             the real thing cools in. Staggered harder than before: six layers
             need more room between their entrances than four did, or the extra
             two arrive on top of their neighbours and the palette muddies back
             into one colour. */
          const lead = clamp01((grow - (layer.scale - 0.62) * 0.3) / 0.13);
          layer.material.uniforms.uIntensity.value = lead * Math.pow(1 - grow, 1.6) * 1.2;
        }

        /* The knots, thrown clear and scattering through open space. They
           outrun the shells and keep going, which is what stops the explosion
           reading as a bubble with a hard edge. */
        for (let i = 0; i < this.knotCount; i++) {
          const dx = this.knots[i * 6];
          const dy = this.knots[i * 6 + 1];
          const dz = this.knots[i * 6 + 2];
          const speedK = this.knots[i * 6 + 3];
          const sizeK = this.knots[i * 6 + 4];
          const roll = this.knots[i * 6 + 5];

          // Ballistic with drag: quick out, then coasting and thinning. The
          // drag constant is unchanged, so the knots still outrun the shells
          // and still settle inside the same window — they simply settle
          // further out.
          const reach = (1 - Math.exp(-since * 0.42)) * speedK * 205;
          const x = center.x + dx * reach;
          const y = center.y + dy * reach;
          const z = center.z + dz * reach;

          /* Colour by emission line, the same palette the shells use — one
             clump is oxygen, the next hydrogen, the next sulphur, which is why
             a real remnant is many colours at once rather than one fading
             gradient. Cooling shifts each toward its own red end.

             Seven species rather than four. The point of a palette this wide
             is that no two adjacent knots are reliably the same colour, so the
             cloud reads as a mix of materials rather than as one substance
             with noise on it — and the violet and the gold are what stop the
             whole thing sitting in the green-to-red half of the wheel. */
          const cool = clamp01(since / HubScene.NS_MERGED);
          let r: number;
          let g: number;
          let b: number;
          if (roll < 0.2) {
            // [O III] teal-green
            r = 0.24 + cool * 0.3;
            g = 1.0 - cool * 0.2;
            b = 0.82 - cool * 0.3;
          } else if (roll < 0.34) {
            // [Ne III] cold cyan, thrown with the fastest material
            r = 0.32 + cool * 0.28;
            g = 0.9 - cool * 0.12;
            b = 1.0;
          } else if (roll < 0.5) {
            // He II violet
            r = 0.68 + cool * 0.22;
            g = 0.42 - cool * 0.14;
            b = 1.0 - cool * 0.18;
          } else if (roll < 0.68) {
            // Hα / [N II] orange-red
            r = 1.0;
            g = 0.56 - cool * 0.22;
            b = 0.3 - cool * 0.16;
          } else if (roll < 0.8) {
            // [Fe II] and lit dust: gold
            r = 1.0;
            g = 0.82 - cool * 0.24;
            b = 0.38 - cool * 0.2;
          } else if (roll < 0.92) {
            // [S II] deep red
            r = 1.0;
            g = 0.26 + cool * 0.1;
            b = 0.36 + cool * 0.12;
          } else {
            // Synchrotron blue-white, the fastest and first to fade
            r = 0.7 + cool * 0.25;
            g = 0.82;
            b = 1.0;
          }

          const fade = Math.pow(1 - grow, 1.35) * clamp01(since * 2.2);
          this.glow.set(this.knotStart + i, x, y, z, sizeK * (1 + grow * 2.1), r, g, b, fade * 0.72);
        }
      } else {
        for (const layer of this.remnant) layer.mesh.visible = false;
        for (let i = 0; i < this.knotCount; i++) this.glow.hide(this.knotStart + i);
      }
    }
  }

  private updateVoyager(time: number, speed: number) {
    // Out past Neptune and still going, then round again — the real one is at
    // about 165 AU and rising, which no fixed frame can hold.
    const cycle = 150;
    const p = ((time * speed) % cycle) / cycle;
    const distance = 210 + p * 620;
    const angle = 2.35 + p * 0.22;
    this.voyager.position.set(Math.cos(angle) * distance, 55 + p * 130, Math.sin(angle) * distance);
    // The dish stays pointed home, as it does.
    this.voyager.lookAt(0, 0, 0);
    this.voyager.rotateX(Math.PI / 2);
  }

  private updateComets(time: number, speed: number) {
    let slot = this.cometStart;
    for (const comet of this.comets) {
      const M = ((time * speed) / comet.period + comet.phase) % 1;
      for (let i = 0; i <= this.COMET_TAIL; i++) {
        // The tail is the comet's own recent path, sampled backwards — which
        // is very nearly where the dust actually is, and costs one extra
        // evaluation of the orbit per sample.
        const back = (i / this.COMET_TAIL) * 0.052;
        const theta = (M - back) * Math.PI * 2;

        // A real ellipse with the sun at a focus, not a circle: a comet moves
        // visibly faster at perihelion, and that is most of what makes it read
        // as a comet.
        const r = (comet.a * (1 - comet.e * comet.e)) / (1 + comet.e * Math.cos(theta));
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        const y = Math.sin(theta) * r * Math.tan(comet.incl) * 0.4;

        const cn = Math.cos(comet.node);
        const sn = Math.sin(comet.node);
        const wx = x * cn - z * sn;
        const wz = x * sn + z * cn;

        const head = i === 0;
        const fade = Math.pow(1 - i / this.COMET_TAIL, 1.8);
        // The coma only switches on near the sun, which is exactly when a real
        // one does — that is sublimation, not distance from the camera.
        const activity = clamp01((comet.a * 1.4 - r) / (comet.a * 0.9));
        const alpha = fade * (head ? 0.95 : 0.4) * activity;
        // The coma is a real body; the tail is dust spread thin behind it.
        const size = head ? 3.2 : 2.0 * fade + 0.4;
        this.glow.set(slot, wx, y, wz, size, comet.hue.r, comet.hue.g, comet.hue.b, alpha);
        slot++;
      }
    }
  }

  /* ─────────────────── hover, passes, sizing ─────────────────── */

  private updateHover() {
    if (!this.pointerInside || this.flight) return;
    const hit = this.pick();
    const info = hit?.info ?? null;
    if (info?.key === this.hovered?.key) return;
    this.hovered = info;
    this.renderer.domElement.style.cursor = info ? "pointer" : "grab";
    this.callbacks.onHover(info);
  }

  private updatePasses(time: number) {
    const grade = this.gradePass.uniforms;
    grade.uTime.value = time;
    grade.uFlash.value = this.flash * 0.55;
    grade.uWarp.value = this.warp;
    grade.uAberration.value = 1 + this.warp * 1.4;
    grade.uCenter.value = [0.5, 0.5];

    if (!this.lensPass) return;
    const lens = this.lensPass.uniforms;
    const rect = this.container.getBoundingClientRect();
    const aspect = Math.max(rect.width, 1) / Math.max(rect.height, 1);
    lens.uAspect.value = aspect;
    lens.uTime.value = time;
    lens.uFeed.value = this.feed;

    // Where the hole is on screen, and how big. Both come straight out of the
    // projection rather than being tuned by hand, so the effect stays locked
    // to the body at any camera distance.
    this.holeGroup.getWorldPosition(this.tmpV);
    const toHole = this.tmpV.clone().sub(this.camera.position);
    const forward = this.camera.getWorldDirection(this.tmpV2);
    const depth = toHole.dot(forward);
    if (depth <= 1) {
      lens.uStrength.value = 0;
      return;
    }

    const distance = toHole.length();
    this.tmpV.project(this.camera);
    /* Texture space, NOT DOM space. A full-screen quad's `uv` has v = 0 at the
       BOTTOM of the frame, so NDC maps straight through with no flip — unlike
       the label projection above, which is writing CSS pixels and does have to
       invert Y. Flipping here put the lensing ring and the event horizon's
       shadow at the hole's mirror image in the opposite half of the screen,
       where they read as an unexplained wobbling heptagon in empty sky (the
       seven sides being the `atan(d.y, d.x) * 7.0` ripple in the shader). */
    const u = this.tmpV.x * 0.5 + 0.5;
    const v = this.tmpV.y * 0.5 + 0.5;
    lens.uCenter.value = [u, v];

    // A sphere of radius R at distance d spans R / (d·tan(fov/2)) of the
    // half-height, i.e. half that in 0..1 UV over the full height — which is
    // the space the shader's aspect correction puts everything in.
    const halfFov = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const radius = (6.5 / (distance * halfFov)) * 0.5;
    lens.uRadius.value = radius;

    // Fades out once the hole leaves the frame — there is nothing to bend
    // light around off-screen, and the resample would only cost fill rate.
    const offscreen = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5));
    lens.uStrength.value = clamp01(1 - (offscreen - 0.55) / 0.55);
  }

  private sampleFps() {
    if (this.pinned) return;
    this.fpsFrames++;
    const now = performance.now();
    const elapsed = now - this.fpsSince;
    if (elapsed < TIER_SAMPLE_MS) return;

    const fps = (this.fpsFrames * 1000) / elapsed;
    this.fpsFrames = 0;
    this.fpsSince = now;

    // Down only, never up: a scene that oscillates between tiers is worse than
    // one that settles a notch low, because every change is a visible pop.
    const index = TIER_ORDER.indexOf(this.tier);
    if (fps < TIER_DOWN_FPS && index < TIER_ORDER.length - 1) {
      this.demote(TIER_ORDER[index + 1]);
    }
  }

  /** Steps down a tier in place. Only the things that can be changed without
   * rebuilding the world are touched — geometry detail and MSAA are fixed at
   * construction, and rebuilding them mid-run would cost a longer hitch than
   * the one it is trying to fix. */
  private demote(tier: Tier) {
    this.tier = tier;
    const next = TIERS[tier];
    this.config = { ...this.config, ...next, segments: this.config.segments, msaa: this.config.msaa };

    const ratio = Math.min(window.devicePixelRatio, next.dpr);
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    this.starMaterial.uniforms.uPixelRatio.value = ratio;
    this.glow.setPixelRatio(ratio);

    this.starGeometry.setDrawRange(0, Math.min(next.stars, this.starGeometry.attributes.position.count));
    if (this.belt) this.belt.count = Math.min(next.asteroids, this.belt.instanceMatrix.count);
    this.activeDebris = Math.min(next.debris, this.debrisCount);

    if (this.bloom) this.bloom.enabled = next.bloom;
    if (this.lensPass) this.lensPass.enabled = next.lensing;
    this.gradePass.uniforms.uGrain.value = next.grain;

    if (!next.moons) {
      const hidden = new Set<string>();
      for (const planet of this.planets) {
        for (const moon of planet.moons) {
          moon.pivot.visible = false;
          hidden.add(moon.info.key);
        }
      }
      // A hidden body must also stop being hit-testable. The raycaster does
      // not consult `visible`, and the hit spheres are separate meshes from
      // the art anyway — leaving them in would mean hovering empty space and
      // getting Ganymede's label back.
      this.pickables = this.pickables.filter((p) => !hidden.has(p.info.key));
      this.labels = this.labels.filter((label) => {
        if (!hidden.has(label.info.key)) return true;
        label.el.remove();
        return false;
      });
      if (this.hovered && hidden.has(this.hovered.key)) {
        this.hovered = null;
        this.callbacks.onHover(null);
      }
    }

    this.callbacks.onTier(tier);
  }

  /* ══════════════════════════ lifecycle ══════════════════════════ */

  resize() {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    const view = viewFor(width / height, height);
    this.camera.aspect = width / height;
    this.camera.fov = view.fov;
    this.camera.updateProjectionMatrix();
    // A rotation between portrait and landscape changes which axis frames the
    // system, so re-seat the camera — but only for a visitor who has not taken
    // control of it yet. Moving someone's own view on an orientation change is
    // the sort of thing that makes a page feel like it is fighting you.
    if (!this.userMoved && !this.flight) {
      this.camera.position.copy(view.position);
      this.controls.target.set(0, 0, 0);
    }
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    if (this.bloom) this.bloom.setSize(width, height);
    this.gradePass.uniforms.uResolution.value = [width, height];
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();

    const el = this.renderer.domElement;
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerleave", this.onPointerLeave);
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("keydown", this.onModifier);
    window.removeEventListener("keyup", this.onModifier);
    this.controls.removeEventListener("start", this.onUserInput);
    window.removeEventListener("wheel", this.onUserInput);

    this.timer.disconnect();
    this.controls.dispose();
    this.glow.dispose();
    for (const item of this.disposables) item.dispose();
    for (const texture of this.textures) texture.dispose();
    this.composer.dispose();
    this.renderer.dispose();

    el.remove();
    this.labelLayer.remove();
  }

  get currentTier(): Tier {
    return this.tier;
  }
}
