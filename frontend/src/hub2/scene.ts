import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
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
  WORMHOLE,
  type PlanetSpec,
  type MoonSpec,
} from "./bodies";
import {
  BEAM_FRAG,
  BEAM_VERT,
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
  WORMHOLE_FRAG,
  WORMHOLE_VERT,
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
  /** Kept on at every tier, including the cheap one — see the note on TIERS.
   * The lensing pass is a full-screen resample with three texture fetches;
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
  low: { dpr: 1.15, stars: 6000, asteroids: 520, segments: 40, bloom: false, lensing: true, moons: false, nebula: true, msaa: 0, grain: 0.02, debris: 180 },
};

const TIER_ORDER: Tier[] = ["ultra", "high", "low"];

/* Why the bloom runs at the full frame, and must: a note about a change that
 * looks free, is not, and would otherwise be made twice.
 *
 * The bloom is the most expensive pass on the page: five mip levels, each
 * blurred twice, the first of them at half the frame, which on a 2× display is
 * a 2800×1800 frame. Building the chain at half size quarters that fill, and
 * the reasoning for doing it is obvious — the pass ends in a blur wide enough
 * that no detail could survive it anyway.
 *
 * But the blur kernel is measured in TEXELS, not in pixels. Halve the
 * resolution it runs at and every tap reaches twice as far across the screen,
 * so the star's glow doubles in width and the whole frame comes up under a
 * grey veil: the background stops being black, and on a page that is mostly
 * black background that is the most visible change that could be made to it.
 * The cost is not in the resolution, it is in the reach, and three's
 * UnrealBloomPass gives no way to shorten one without the other — the tap
 * counts are baked into its shader. */

/** Below this for a whole sample window and the scene drops a tier. 45 rather
 * than 60 so a couple of dropped frames during a fly-to don't demote a machine
 * that is otherwise comfortable. */
const TIER_DOWN_FPS = 44;
const TIER_SAMPLE_MS = 1600;

/** How often the frame meter reports, and how many frames of history it hands
 * over for the graph. 400ms is fast enough that the number tracks what the
 * scene is doing while you drag it, slow enough that the digits are readable
 * rather than a blur; 128 frames is about two seconds at 60Hz, which is the
 * span a hitch has to survive in to be worth finding. */
const STATS_REPORT_MS = 400;
const STATS_HISTORY = 128;

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
  /** Whether the second tap dives into the body before opening its page, or
   * opens it straight away. True for the star, the eight planets, the black
   * hole and the neutron binary — the things big enough to fall into. The
   * moons and the probe are too small for the move to read as anything but a
   * lurch, so they keep the plain open. */
  dive: boolean;
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
  /** The probe's grand tour started or stopped from inside the scene: by a tap
   * on the craft itself, or by the tour reaching Neptune and ending. Without
   * it the HUD button would go on claiming the tour is running after it has
   * finished, since the shell has no other way to hear about either. */
  onVoyagerTour(on: boolean): void;
  /** The scene has taken the whole frame — it is blacked out, or holding the
   * plate at the end of the tour. The shell answers by getting its HUD out of
   * the way: every caption, button and readout on this page is DOM sitting on
   * top of the canvas, so none of them go dark when the render does, and a
   * photograph held for five seconds behind a grid of floating labels is not
   * held at all. */
  onCurtain(on: boolean): void;
  /** A performance sample, roughly twice a second. Optional, and the whole
   * meter hangs off whether it was passed: without it the scene keeps no frame
   * history, times nothing and allocates nothing — see sampleFps. It exists for
   * `?fps`, which is a debugging switch, not a feature of the page. */
  onStats?(stats: SceneStats): void;
}

/** One window's worth of measurement. Everything here is either a number the
 * frame already had or one three.js was keeping anyway; nothing is computed
 * for the meter that the scene did not already know.
 *
 * The pair to read together is `ms` against `cpu`. `ms` is wall time between
 * frames — what the visitor sees. `cpu` is how much of it this thread spent
 * building the frame. When they are close the main thread is the bottleneck and
 * the fix is in JS: fewer draw calls, fewer per-frame allocations, less work in
 * the update passes. When `cpu` is far below `ms` the thread is waiting on the
 * GPU and the fix is in pixels: pixel ratio, bloom, the full-screen passes. */
export interface SceneStats {
  /** Frames per second across the window. */
  fps: number;
  /** Mean wall time per frame, ms. 16.7 is a 60Hz frame. */
  ms: number;
  /** The longest single frame in the window — the hitch a mean hides. */
  worst: number;
  /** Mean JS time inside the frame callback, ms: updates plus the render
   * submission, but not the GPU work that submission queues. */
  cpu: number;
  /** Draw calls and triangles in the last frame of the window. */
  calls: number;
  triangles: number;
  /** What is resident on the GPU. Flat while the scene is idle; a number that
   * climbs frame after frame is something being rebuilt that should not be. */
  geometries: number;
  textures: number;
  programs: number;
  tier: Tier;
  /** The pixel ratio actually in use, which the tier caps. */
  dpr: number;
  /** Wall time of the most recent frames, oldest first, for the graph. */
  history: number[];
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
/** Accelerating, with no settle at the end — the shape of a fall. Used by the
 * dive alone; every other camera move in here eases *out*, because every other
 * one is arriving somewhere it means to stop. */
const easeInCubic = (t: number) => t * t * t;
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smoothstep = (a: number, b: number, t: number) => {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};

/** cos of the half-angle a sphere of radius R subtends at distance d — which
 * is the same thing as how much of the sphere's own radius its silhouette is
 * worth from there, and the correction between an orthographic view of a ball
 * and a real one.
 *
 * Two things need it, for the same reason and in different spaces: the
 * wormhole's shader, which has to know where its own edge is, and the lensing
 * pass, which has to know where to start bending sky around it. Floored so a
 * camera at or inside the surface still returns something to divide by. */
const silhouette = (radius: number, distance: number) =>
  Math.sqrt(Math.max(1 - (radius / Math.max(distance, 1e-4)) ** 2, 1e-3));

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
  /** Which of the two sprite profiles each slot draws: 0 a bead with a hot
   * centre, 1 a soft edgeless puff. See GLOW_FRAG. Written once by whoever
   * wants the puff and never touched again — it is a property of the effect,
   * not of the frame, so `set` leaves it alone unless it is asked to. */
  readonly soft: Float32Array;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private cursor = 0;
  /** Whether aSoft has been touched since it was last sent. See flush(). */
  private softDirty = false;

  constructor(capacity: number, pixelRatio: number) {
    this.position = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.color = new Float32Array(capacity * 3);
    this.alpha = new Float32Array(capacity);
    this.soft = new Float32Array(capacity);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.position, 3));
    this.geometry.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    this.geometry.setAttribute("aColor", new THREE.BufferAttribute(this.color, 3));
    this.geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    this.geometry.setAttribute("aSoft", new THREE.BufferAttribute(this.soft, 1));
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

  /** Switches a whole allocated range to the soft profile. Called at build
   * time; see flush() for why that is the only time this attribute is ever
   * sent to the GPU. */
  setSoft(start: number, count: number, value: number) {
    this.soft.fill(value, start, start + count);
    this.softDirty = true;
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

  /** Sends the frame's writes to the GPU.
   *
   * Two things here are about cost rather than correctness, and on a phone they
   * are worth more than they look.
   *
   * The pool is sized for the heaviest tier it might ever be asked to run, and
   * on the cheap tier barely a fifth of it is ever allocated — but a plain
   * `needsUpdate` re-sends the WHOLE array, allocated or not. Bounding every
   * upload at the cursor means the low tier stops paying for four thousand
   * slots that no effect owns. That is the tier that was dropping frames.
   *
   * And aSoft is not per-frame data at all: it is written once at build time
   * and never again, so it is uploaded when it changes and at no other time.
   * Marked every frame it was a fifth of the traffic for a buffer whose
   * contents were identical from the second frame onward. */
  flush() {
    const n = this.cursor;
    if (n === 0) return;
    const position = this.geometry.attributes.position as THREE.BufferAttribute;
    const size = this.geometry.attributes.aSize as THREE.BufferAttribute;
    const color = this.geometry.attributes.aColor as THREE.BufferAttribute;
    const alpha = this.geometry.attributes.aAlpha as THREE.BufferAttribute;

    position.addUpdateRange(0, n * 3);
    position.needsUpdate = true;
    size.addUpdateRange(0, n);
    size.needsUpdate = true;
    color.addUpdateRange(0, n * 3);
    color.needsUpdate = true;
    alpha.addUpdateRange(0, n);
    alpha.needsUpdate = true;

    if (this.softDirty) {
      const soft = this.geometry.attributes.aSoft as THREE.BufferAttribute;
      soft.addUpdateRange(0, n);
      soft.needsUpdate = true;
      this.softDirty = false;
    }
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
  /** Its hit sphere, kept so a moon dropped from `pickables` by a demotion can
   * be registered again. See ensureMoons. */
  hit: THREE.Mesh;
  /** Range in the glow pool for a vent, if this moon has one. */
  ventStart?: number;
  ventCount?: number;
  /** Whether that range has already been switched off. See clearGlow. */
  ventIdle?: boolean;
  /** Starship's engine plume, looked up once on first use. */
  plume?: THREE.Mesh | null;
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

/** Which of the two endings is running. See beginFinale. */
type FinaleMode = "hole" | "wormhole";

/** Where the auto tour parks for one stop, in the body's own outward frame.
 * `azimuth` turns the camera round the body within the ecliptic, `elevation`
 * lifts it out of that plane, and `zoom` scales the framing distance. */
interface TourView {
  azimuth: number;
  elevation: number;
  zoom: number;
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
  /** The last values written to the element's own style, so a frame that would
   * write the same thing writes nothing. See updateLabels. */
  lastOffset: string;
  lastTransform: string;
  lastOpacity: string;
  /** This frame's measurement, written by labelCandidates and read by the pass
   * below it. Kept on the rig rather than in a Map the frame throws away. */
  shown: boolean;
  distance: number;
  fade: number;
  visible: boolean;
}

/* ────────────────────────────── the scene ────────────────────────────── */

/* Half again what it was. Everything that frames the star is written as a
 * multiple of this — the corona's reach, its hit sphere, the camera's floor
 * below — so they all follow.
 *
 * The inner system used to be the exception: at its old reach the corona ran
 * to 41 units, past Mercury at 26 and Venus at 37, and both spent their whole
 * orbits inside the star's outer haze. The corona is a third of that now, so
 * they do not. */
const SUN_RADIUS = 12;
/** Pluto's own radius. Named because the tidal stretch has to work out how
 * long the filament it is drawing has actually become in world units. */
const PLUTO_RADIUS = 2.4;
/** The event horizon. Everything the hole is made of is a multiple of this —
 * the disc, the hit sphere, the debris, the apparent radius the lensing pass
 * is driven by — and so, at half of it, is the wormhole. Hoisted out of
 * buildBlackHole when the wormhole needed to be exactly half: it was a local
 * there and a bare 6.5 in the lensing update, which is two places to change a
 * number that three things now depend on. */
const HOLE_HORIZON = 6.5;
/** A third of the hole's. It began at a half, and two thirds of that is where
 * it settled: against Saturn — 5.85 with a ring sheet out to 13.75 — a sphere
 * of 3.25 was reading as the second largest thing in that part of the sky.
 * Small enough now that the ball is a detail of Saturn's neighbourhood rather
 * than a rival to the planet, and still large enough that the lens inside it
 * resolves once you are up against it. */
const WORMHOLE_RADIUS = HOLE_HORIZON / 3;

/** The axis the galaxy's plane is perpendicular to, in scene coordinates.
 *
 * Tilted off the ecliptic, because the real one is: the solar system's plane
 * and the galaxy's are nothing like parallel, and a band that ran along the
 * orbits would read as a ring belonging to this system. One constant, shared
 * by the photographed band and the glow painted around it — they have to be
 * the same band or the sky has two galaxies in it. */
const GALACTIC_POLE = new THREE.Vector3(0.36, 0.86, -0.35).normalize();

/** The sun's position, and the centre of the system. Never written to. */
const ORIGIN = new THREE.Vector3(0, 0, 0);

/** Where the two venting moons fire from, as unit xyz. Constants, so they are
 * normalised here rather than in the frame — see updateVent. */
const IO_VENT = unit(0.62, 0.38, 0.68);
const ENCELADUS_VENT = unit(0.12, -0.98, 0.1);

function unit(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

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

  /* There is deliberately no `reducedMotion` flag here any more.
   *
   * There was one, read from `prefers-reduced-motion` at construction, and it
   * did five things: it multiplied every moving body in the scene by 0.25, it
   * skipped the opening arrival, it cut fly-tos and the dive-in to a hard cut,
   * and it replaced both endings with a camera reset. The whole scene is
   * motion — it is a solar system — so what the flag actually produced was not
   * a calmer page, it was a quarter-speed one with its transitions missing,
   * reported as a stuck page by somebody whose desktop had the setting on
   * without their knowing. The same visitor's phone, which did not have it on,
   * behaved correctly, which is how it was finally pinned down.
   *
   * The page offers a way out that the setting cannot: nothing here is the
   * only route to anything. Every body's destination is in the dock below the
   * canvas as an ordinary link, so a reader who does not want a camera flying
   * at them can simply not fly it. See the matching note in styles.css. */

  private labelLayer: HTMLDivElement;
  private labels: LabelRig[] = [];
  private pickables: Pickable[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(-10, -10);
  /** Scratch for pick(): the visible hit spheres, and what the ray found. */
  private pickList: THREE.Object3D[] = [];
  private pickHits: THREE.Intersection[] = [];
  private pointerInside = false;
  /** Set by a pointer move, cleared by the frame that acts on it. */
  private pointerMoved = false;
  private hoverClock = 0;

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
  /** The two outer sheets of the disc's slab, hidden when it is far enough
   * away that its thickness is below a pixel. */
  private discSkins: THREE.Mesh[] = [];
  private feed = 0;
  /* the jet, fired along the spin axis whenever something is swallowed */
  private jetGroup!: THREE.Object3D;
  private jetMaterials: THREE.ShaderMaterial[] = [];
  /** Every cone in the jet, with the fraction of the beam's width it carries.
   * Two of them now: the one strand of light, in each of two directions. */
  private jetCones: { mesh: THREE.Mesh; width: number }[] = [];
  /** Nine floats per grain of smoke in the beam: where along it the grain
   * starts, which rope of the braid it belongs to, where it sits around that
   * rope's own axis and how far out from it, a little slack along the rope,
   * how fast it climbs, a size roll, which pole it left by, and the phase of
   * the clot it travels with. */
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

  /* the wormhole off Saturn */
  private wormhole!: THREE.Mesh;
  private wormholeMaterial!: THREE.ShaderMaterial;
  /** Its world position this frame. Its own `position` is an offset inside
   * Saturn's frame now, so it is no longer the answer to "where is it". Kept
   * as a field for the same reason holeWorld is: two things a frame want it,
   * and one of them is aimLens, which uses all three scratch vectors. */
  private wormholeWorld = new THREE.Vector3();

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
  /** Where each spin axis is pointing — one phase per body, star a, star b and
   * the remnant they become. Separate rather than shared, and started apart,
   * because a binary whose two axes swing in lockstep reads as one mechanism
   * with two arms rather than as two stars. Integrated frame by frame for the
   * same reason neutronAngle is: the rate changes at the merger. See pulsars.
   */
  private pulsarPhases = [0, 2.1, 0.7];
  /** A slow clock, quite separate from the spin, that the lean of each axis
   * nods against — see PULSAR_AXES. Kept apart from the phases above because
   * those wrap at a full turn, and anything read through a non-integer
   * multiple of a wrapping angle jumps every time it wraps. */
  private pulsarNod = 0;
  /* The remnant's cone, tipped on two slow clocks. See pulsars(). */
  private pulsarDriftA = 0;
  private pulsarDriftB = 0;
  /** One shaft per body — the two stars and the remnant — each a cylinder run
   * clean through it so that north and south are two ends of one object rather
   * than two beams that have to be kept agreeing with each other. */
  private beams: { mesh: THREE.Mesh; material: THREE.ShaderMaterial }[] = [];
  /** Scratch for the spin axis, rebuilt per body per frame. */
  private beamAxis = new THREE.Vector3();
  /** What a cylinder is built along, and so what the axis is rotated FROM. */
  private static readonly UP = new THREE.Vector3(0, 1, 0);
  /** The layered gas shells of the remnant, innermost first. */
  private remnant: { mesh: THREE.Mesh; material: THREE.ShaderMaterial; scale: number }[] = [];
  /** Clumps of ejecta flying clear of the shells. Six floats each: direction
   * xyz, speed, size, colour roll. */
  private knots: Float32Array = new Float32Array(0);
  private knotStart = 0;
  private knotCount = 0;
  private flash = 0;

  /* Whether each of the big intermittent glow ranges is currently switched off.
   * Between them these cover about three thousand slots that spend most of the
   * cycle dark — see clearGlow for what the flags save. */
  private jetIdle = false;
  private debrisIdle = false;
  private streamIdle = false;
  private knotsIdle = false;

  /* the telescope. Its pivot turns with Earth so it keeps station over the
     same face; the rig itself is what the camera flies to and aims. */
  private hubblePivot?: THREE.Object3D;
  private hubble?: THREE.Object3D;
  private hubbleInfo?: BodyInfo;
  /** What it is currently pointed at, so the tube swings round to face the
   * body being observed rather than staring off in a fixed direction. */
  private hubbleAim = new THREE.Vector3(0, 0, 1);
  /** Earth's rig. Two per-frame updates need it — the telescope reads its
   * rotation rate, the probe its orbital period — and both were searching the
   * planet list for it sixty times a second. */
  private earthRig?: PlanetRig;
  /* One geometry and one material behind every hit sphere. See hitSphere. */
  private hitGeometry?: THREE.SphereGeometry;
  private hitMaterial?: THREE.MeshBasicMaterial;
  private tmpQuat = new THREE.Quaternion();
  private tmpQuat2 = new THREE.Quaternion();
  /** The rig's own nose, and so what a look-direction is rotated FROM. */
  private static readonly FORWARD = new THREE.Vector3(0, 0, 1);

  /* the probe */
  private voyager!: THREE.Object3D;
  /** Everything the craft is painted with, so the whole rig can be faded out
   * together as it leaves the system. */
  private voyagerMaterials: THREE.Material[] = [];
  /** The Endurance's ring — the only part of the ship that moves relative to
   * the rest of it. Everything is bolted to this and turns with it. */
  private enduranceRing!: THREE.Object3D;
  /** The cruciform docking hub in the middle of it, which does NOT turn: a
   * docking port on a spinning ring is a port nothing can reach, and the
   * still centre is also what makes the ring's turning visible. */
  private enduranceHub!: THREE.Object3D;
  /** Where it is heading, smoothed. The ring's axis is pointed down this, so
   * the ship flies through its own middle the way the film's does. */
  private voyagerNose = new THREE.Vector3(0, 0, 1);
  private voyagerAimAt = new THREE.Vector3();
  /** Earth's orbit, and the outermost planet's — read off the specs at build
   * time so the probe's route follows the system if the system is retuned. */
  private voyagerLaunchRadius = 50;
  private voyagerEdge = 206;
  /** The grand tour: on, the probe flies the planets in order and the camera
   * rides with it. Off, it coasts out on its own in the background. */
  private voyagerTour = false;
  /** How far along the route the probe has got, 0..1 on the curve's arc-length
   * parameter. The grand tour is paced by speed rather than by a fraction of a
   * fixed duration — see the speed law in flyGrandTour.
   *
   * Advanced by an increment each frame rather than stored as a distance and
   * divided by the route's length. The two are the same only if the length is
   * constant, and it is not: the route is rebuilt every frame from planets
   * that keep moving, and the legs *behind* the probe change length by
   * hundreds of units over a tour — the Earth–Mars leg alone swings between a
   * short hop and a half-circle round the star as the two planets separate.
   * Held as a distance, every one of those changes rescaled the whole route
   * under the probe: the ratio fell, and the probe slid backwards along a path
   * it had already flown. It cost up to a tenth of the route at a time and it
   * is why a tour would sometimes crawl for three minutes without arriving.
   *
   * Held as the parameter itself, a change behind the probe cannot move it,
   * because getPointAt is arc-length parameterised: adding ds/L advances
   * exactly ds of arc whatever L happens to be this frame. And it only ever
   * increases, so the tour always reaches its end. */
  private voyagerTourU = 0;
  /** The route, rebuilt every frame from where the planets actually are, and
   * the spline through it. Catmull-Rom rather than straight legs: a probe that
   * turned a corner at each planet would be a probe under power, and the whole
   * point of a swing-by is that the planet does the turning. */
  private voyagerRoute: THREE.Vector3[] = [];
  private voyagerCurve: THREE.CatmullRomCurve3 | null = null;
  /** Where the route's planets actually are, and how far out each one reaches
   * (its rings included). The route points are offset to stand clear of them,
   * so they are no longer the planets' own positions — and framing a fly-by
   * needs the planet, not the point the probe passes through. */
  private voyagerCenters: THREE.Vector3[] = [];
  private voyagerReach: number[] = [];
  /** One extra control point per leg, placed to bow the route around the sun
   * instead of through it. See flyGrandTour. */
  private voyagerGuards: THREE.Vector3[] = [];
  /** The stop the probe is currently circling, or -1. See flyGrandTour. */
  private voyagerLoiter = -1;
  /** How far round that circle it has got, in radians. */
  private voyagerLoiterAngle = 0;
  /** Which stops it has already circled this run, so a body is not orbited
   * again on the way past it a second time. */
  private voyagerLoitered: boolean[] = [];
  /** Which stops are behind it, and which one it is on its way to.
   *
   * The speed law brakes for stops it has not reached yet and for no others.
   * Without this it braked for every stop it had not *circled*, which is six
   * of the eight — so the probe went on creeping along after a fly-by until
   * the next planet's window took over, and in the outer system, where the
   * tracks are closer together than the braking distance, the two windows
   * overlap and the tour never got out of the pass at all. */
  private voyagerPassed: boolean[] = [];
  private voyagerStop = 0;
  /** Last frame's distance to that stop, which is how "receding from it" is
   * told from "still on the way in". */
  private voyagerStopDist = Infinity;
  /** The frame the circle is drawn in: where it started, and the two axes of
   * its plane. Captured on entry so the last turn ends exactly where the first
   * began and the probe can rejoin the path without a step. */
  private loiterCenter = new THREE.Vector3();
  private loiterAxisA = new THREE.Vector3();
  private loiterAxisB = new THREE.Vector3();
  private loiterRadius = 0;
  /** How far in this particular orbit is allowed to dip — the configured
   * fraction, or less if that would take the craft inside the body's rings. */
  private loiterDip = 0;
  /** Turns this particular orbit makes. */
  private loiterTurns = 2;
  /** Where the circle's centre sits relative to the planet, so it can be
   * carried along as the planet moves without the circle drifting. */
  private loiterOffset = new THREE.Vector3();
  /** Last frame's position, which is the only way to know which way it is
   * pointing — the path is a spline through moving points and has no closed
   * form to differentiate. */
  private voyagerPrev = new THREE.Vector3();
  private voyagerChase = new THREE.Vector3();
  /** The direction of travel, smoothed. One frame's movement is too short and
   * too noisy to point a camera with on its own. */
  private voyagerHeading = new THREE.Vector3(0, 0, 1);

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
    /** Set only by diveInto(). A dive is a flight — same tween, same re-aiming
     * at a body that is still moving — that ends against the body's surface
     * instead of at arm's length from it, accelerates the whole way instead of
     * settling, and opens the destination when it lands. Optional because it
     * is the one flight in five that is one. */
    dive?: BodyInfo | null;
  } | null = null;
  private warp = 0;
  /** Set the moment a dive is committed and never cleared. A dive ends with
   * the page changing, so from here on nothing else may take the camera:
   * another tap, the tour's next stop or the dock would each restart or
   * hijack a fall that is already on its way to a different document. */
  private diving = false;
  /** The dive's own white-out, kept apart from `flash` because that one is
   * rewritten every frame by the neutron merger and would erase this. */
  private diveFlash = 0;
  private diveTint = new THREE.Color(1, 0.98, 0.94);
  /** Where the streaks converge, in screen UV — see GRADE_SHADER's uCenter. */
  private diveCenter: [number, number] = [0.5, 0.5];
  /** Set the first time the visitor moves the camera themselves. After that a
   * resize keeps their view instead of re-framing it out from under them —
   * which matters on a phone, where the address bar collapsing on scroll fires
   * a resize the visitor did not ask for. */
  private userMoved = false;
  private idleFor = 0;
  private tourIndex = 0;
  private tourEnabled = false;
  private tourTimer = 0;
  /** Where round the last stop the tour parked. Advanced by the golden angle
   * each time, so consecutive stops are always most of a turn apart and the
   * sequence never settles into a pattern. See tourView(). */
  private tourAzimuth = 0;
  /** Seconds into the tour's ending, or -1 when it is not running. The ending
   * is the fall into the hole; see updateFinale. */
  private finaleT = -1;
  /** How black the screen is, 0 to 1. Driven by the finale and by nothing
   * else. */
  private fade = 0;
  /** How far into the hole the *picture* is, 0 to 1 — the swirl, the closing
   * aperture and the cold shift. See uCollapse in GRADE_SHADER. */
  private collapse = 0;
  /** How much of the plate is on screen, and how long since the stone hit it. */
  private plate = 0;
  private ripple = 0;
  /** How badly the signal has gone, 0 to 1 — the snow between the fall and the
   * plate. See uStatic in GRADE_SHADER. */
  private tvStatic = 0;
  /** Whether the shell has been told to stand its HUD down. Edge-triggered —
   * the callback crosses into React, and firing it every frame for four
   * seconds would be four seconds of re-renders. */
  private curtain = false;
  /** The angle the fall has wound up to. Integrated rather than computed from
   * the phase, because the rate is what accelerates and a rate that changes
   * cannot be integrated by multiplying it by elapsed time. */
  private finaleAngle = 0;
  private finaleFrom = new THREE.Vector3();
  /** Which ending is running. The auto tour falls into the hole; the probe's
   * grand tour goes through the wormhole and comes out at it. */
  private finaleMode: FinaleMode = "hole";
  /** Inside the passage, 0 to 1, and where its axis sits relative to the
   * middle of the frame — which is the camera moving across it. */
  private tunnel = 0;
  private tunnelLean: [number, number] = [0, 0];
  private tunnelMouth = 0;
  /** Past the horizon, 0 to 1. */
  private insideHole = 0;
  /** The tour's own noise, seeded, so the angles are varied but a given run of
   * the tour is the same every time — a camera that is different on every page
   * load is not reproducible when one of its shots turns out to be a bad one. */
  private tourRand = mulberry32(90210);

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

  /* ── the meter, which is off unless somebody asked for it ──
   *
   * `metering` is set once, from whether a stats callback was handed in. It
   * gates every line below it: the timestamps, the ring buffer, the sums. The
   * tier sampler above has to count frames whatever happens — that is how the
   * scene knows to demote itself — but nothing here runs on a normal visit.
   *
   * The alternative was to measure always and only report when asked. That
   * would put two performance.now() calls and a handful of stores in the frame
   * of every visitor in order to serve a query parameter, which is exactly the
   * kind of cost this file spends its comments avoiding. */
  private metering = false;
  /** Start of the current meter window, and its frame count. Kept apart from
   * fpsFrames/fpsSince because the two windows are different lengths — the tier
   * sampler wants 1.6s of evidence before it changes the picture, the meter
   * wants to move often enough to read as live. */
  private statsSince = 0;
  private statsFrames = 0;
  /** Wall time of the previous frame's start, for the interval. */
  private statsPrev = 0;
  private statsSum = 0;
  private statsWorst = 0;
  /** Time spent inside the frame callback, summed over the window. */
  private statsCpu = 0;
  /** The last STATS_HISTORY frame intervals, oldest first once it has filled.
   * A plain array used as a ring: allocated once, written in place, never
   * pushed to. */
  private statsHistory: number[] = [];
  private statsHistoryAt = 0;

  private resizeObserver: ResizeObserver;
  /* The viewport, in CSS pixels, as of the last resize.
   *
   * This used to be read with getBoundingClientRect() inside the frame — once
   * for the labels and again for the lensing pass. Both are cheap calls in
   * isolation and neither is cheap here: the label pass writes transform,
   * opacity and a custom property onto a dozen absolutely-positioned elements
   * every frame, so a rect read afterwards forces the browser to flush all of
   * that styling and lay the overlay out again before it can answer. Twice a
   * frame, synchronously, on the main thread. On a phone that alone can be a
   * bigger cost than everything three.js does.
   *
   * The size cannot change without the ResizeObserver firing, so it is read
   * there instead and the frame just uses the number. */
  private viewW = 1;
  private viewH = 1;
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpV3 = new THREE.Vector3();
  /** The approach direction the hole's two meals fall in along. Each of them
   * built and normalised its own vector every frame; neither outlives the
   * statement that reads it. */
  private tmpDir = new THREE.Vector3();
  /** The hole's world position, held across the whole black-hole update — see
   * updateBlackHole for why it cannot share tmpV. */
  private holeWorld = new THREE.Vector3();
  /** The neutron binary's world position, which was being fetched into a fresh
   * vector on every frame of the fifty-two-second cycle. */
  private neutronCentre = new THREE.Vector3();

  constructor(container: HTMLElement, callbacks: SceneCallbacks, tier?: Tier) {
    this.container = container;
    this.callbacks = callbacks;
    this.pinned = tier !== undefined;
    this.tier = tier ?? initialTier();
    this.config = TIERS[this.tier];

    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    this.viewW = width;
    this.viewH = height;

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
    this.buildWormhole();
    this.buildNeutronBinary();
    this.earthRig = this.planets.find((p) => p.spec.key === "earth");
    if (this.earthRig) this.buildHubble(this.earthRig);
    this.buildVoyager();
    this.buildComets();

    /* What is left of the ship after flatten has been over it: the merged
       meshes, and the placement nodes their parts used to hang from. None of
       them moves relative to its neighbours. Left on the default, three
       re-composes every one of those local matrices from its position,
       quaternion and scale on every frame, to arrive at the same matrix it had
       last frame. Composed once here instead; the world matrices still follow
       the rig, because that propagation is a multiply by the parent and has
       nothing to do with this flag. */
    this.voyager.traverse((child) => {
      if (child === this.voyager) return;
      child.updateMatrix();
      child.matrixAutoUpdate = false;
    });
    /* Except the ring, which is the one thing on this ship that DOES move.
       This optimisation was written for the probe, where nothing did — and it
       silently froze the Endurance: the rotation was being written to
       `rotation.z` every frame and never composed into a matrix, so the ring
       stood still and the only symptom was the absence of the thing it was
       supposed to be doing. Its children stay frozen, correctly: they do not
       move relative to the ring, only with it. */
    this.enduranceRing.matrixAutoUpdate = true;

    this.composer = this.buildComposer(width, height);
    this.gradePass = this.composer.passes[this.composer.passes.length - 1] as ShaderPass;

    /* The plate the tour's ending lands on. Loaded here rather than lazily at
       the moment it is wanted: it is shown two frames after a blackout, and a
       texture that is still being fetched then would show as the flat black it
       was initialised with — which on that cut is indistinguishable from the
       effect having failed. It is one small JPEG against a page that already
       ships a nebula.

       The aspect goes in on load, so the shader can cover the frame with it
       instead of stretching it. Until then it is 1, and the plate is not on
       screen at 1 anyway. */
    const plate = new THREE.TextureLoader().load("/img/blackhole.jpg", (tex) => {
      const image = tex.image as { width: number; height: number } | undefined;
      if (image && image.height) {
        this.gradePass.uniforms.uPlateAspect.value = image.width / image.height;
      }
    });
    plate.colorSpace = THREE.SRGBColorSpace;
    this.gradePass.uniforms.tPlate.value = plate;
    this.disposables.push(plate);

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
    const start = performance.now();
    this.fpsSince = start;
    this.metering = typeof callbacks.onStats === "function";
    if (this.metering) {
      this.statsSince = start;
      this.statsPrev = start;
      // Allocated whole, once. A ring that grows by pushing would hand the
      // garbage collector a new array every couple of seconds — inside the
      // thing measuring frame times, which is the one place a collection pause
      // would land in the numbers it is reporting.
      this.statsHistory = new Array<number>(STATS_HISTORY).fill(0);
    }
    this.frame = requestAnimationFrame(this.tick);
  }

  /* ══════════════════════════ construction ══════════════════════════ */

  private texture(url: string): THREE.Texture {
    const tex = new THREE.TextureLoader().load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    /* 16 where the hardware offers it, not 8.
     *
     * This is what a texture looks like at a grazing angle, which on a sphere
     * is the entire limb — the part of a body you spend the most pixels on
     * when it fills the frame. Doubling the cap costs a few samples on the
     * fragments that are already the most foreshortened and nothing anywhere
     * else, and it is free on any GPU that reports less. */
    tex.anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
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

  /** Granulation octaves for SUN_FRAG. The star is one sphere and this shader
   * is essentially the whole cost of it, so the cheap tier gives up two
   * octaves of surface detail rather than the surface — dropping to a lower
   * segment count would only flatten the silhouette, which is not where the
   * expense is. */
  private get starDetail() {
    return this.config.segments >= 64 ? 6 : 4;
  }

  private buildStar() {
    const geo = new THREE.SphereGeometry(SUN_RADIUS, this.config.segments, this.config.segments / 2);
    this.sunMaterial = new THREE.ShaderMaterial({
      vertexShader: SUN_VERT,
      fragmentShader: SUN_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uPulse: { value: 0 },
        /* Gold, not orange. An earlier pass pushed every stop toward orange to
           get the star off a dim-ember reading, and overshot: uWarm carried the
           whole midtone and it sat at a flat orange, so the disc read as a
           coal. These are matched to a white-light photograph of the real
           photosphere instead — deep amber only in the cooling lanes, gold
           across the body, and a yellow (not cream) top end. The cream was the
           other half of the problem: a desaturated peak washes the middle of
           the disc out and takes the colour with it, which is why uHot keeps
           its yellow all the way up. */
        /* Yellower and brighter again, and bought the right way: red is already
           at the top of its range across the whole ramp, so the extra comes out
           of green. That moves toward yellow and up in value in one move.
           Raising the gain instead would only clip red, and clipping is what
           turns a yellow star white. There is a limit — pushed one more step
           the lanes stop being amber and the granulation disappears into a flat
           lemon disc, which is the same washed-out failure the cream uHot used
           to cause. This sits just short of it. */
        /* Softened once more, and the softening is in the *spread*, not in the
           stops. uCool comes up off its near-black amber so the lanes read as
           cooler gas rather than as holes, and uHot comes down off the lemon
           top end — with the shader's own per-channel limb darkening now
           reddening the rim and its highlight shoulder holding the hue in the
           core, the ramp no longer has to carry the whole gradient by itself.
           A narrow ramp between extreme stops is what made the disc look
           posterised; a narrow ramp is also the only thing that ever did. */
        uCool: { value: new THREE.Color(0xd4861c) },
        uWarm: { value: new THREE.Color(0xffc93f) },
        uHot: { value: new THREE.Color(0xffeb9c) },
        uDetail: { value: this.starDetail },
      },
    });
    const sun = new THREE.Mesh(geo, this.sunMaterial);
    this.scene.add(sun);
    this.disposables.push(geo, this.sunMaterial);

    /* A camera-facing disc rather than a shell — see SUNGLOW_FRAG. Built two
       units across so the shader gets position.xy in -1..1 for free, then
       scaled to the reach the glow should actually have. */
    /* The plane has to stay wide enough for the glow to have somewhere to
       live — it is drawn in the band between the photosphere and this edge, so
       a plane close to the star leaves no band and the corona vanishes. That
       is what happened at 1.13. The flame is shortened with uFalloff instead,
       which is the knob that actually controls its reach. */
    /* Widened from 2.0 for the faint outer halo the shader now draws — that
       component is meant to carry two or three radii out at a few thousandths
       of alpha, and on a plane that ends at 2.0 it would be cut off mid-fade,
       which shows as a circular seam. Nothing about the bright part moved: it
       is held where it was by uFalloff below, which is scaled to match. */
    const CORONA_REACH = SUN_RADIUS * 2.6;
    const coronaGeo = new THREE.PlaneGeometry(2, 2, 1, 1);
    this.coronaMaterial = new THREE.ShaderMaterial({
      vertexShader: SUNGLOW_VERT,
      fragmentShader: SUNGLOW_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uPulse: { value: 0 },
        // The corona follows the photosphere, so it moves to gold with it — an
        // orange halo around a yellow star reads as a ring rather than as the
        // star's own light continuing outward.
        uColor: { value: new THREE.Color(0xffc44a) },
        /* And leaves it. Out past a radius or so the photosphere's light no
           longer dominates and what is left is the corona's own — which is
           nearly white, with the faintest cool cast. Keeping the gold out here
           instead is what made the halo read as a painted ring. */
        uOuterColor: { value: new THREE.Color(0xffeedd) },
        uIntensity: { value: 0.62 },
        // Where the photosphere's edge falls in the disc's own 0..1 radius.
        uUnit: { value: SUN_RADIUS / CORONA_REACH },
        /* Re-solved for the wider plane above, not re-guessed: the falloff is
           measured in the band between uUnit and the plane's edge, so widening
           the plane at a fixed number would have thrown the flame outward.
           Solved to reach a little past where the old 5.7 against the old band
           put it — the corona had been tightened to a rind at that setting, and
           a corona that stops at its own limb is the one thing a real one never
           does. The bright body now carries to about 1.7 sun radii and the
           halo past 2.5, with the streamers lengthening the reach where they
           sit rather than merely brightening it. */
        uFalloff: { value: 7.2 },
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
    const hit = this.hitSphere(SUN_RADIUS * 1.12);
    sun.add(hit);
    const info: BodyInfo = { key: "sun", ko: STAR.ko, en: STAR.en, bodyKo: STAR.bodyKo, bodyEn: STAR.bodyEn, to: STAR.to, accent: "#ffce6a", size: SUN_RADIUS, primary: true, dive: true };
    this.pickables.push({ object: hit, info, anchor: sun });
    this.addLabel(info, sun);
  }

  /** An invisible, generously oversized sphere so a body 200 units away is
   * still a comfortable tap target on a phone. Raycasting against the visible
   * mesh alone would make Mercury a two-pixel target.
   *
   * Invisible by *layer*, not by material — see PICK_LAYER. */
  /** An invisible sphere the raycaster can hit, sized to the body it stands in
   * for.
   *
   * One geometry and one material between all of them, scaled per body. There
   * are now some forty of these — every planet, every moon, the landmarks, the
   * probe, the telescope — and each used to bring its own SphereGeometry and
   * its own material: forty vertex buffers uploaded to the GPU for a shape
   * that is the same shape every time, and forty materials for a surface that
   * is never drawn at all. Scaling one unit sphere is identical to the
   * raycaster, which works from the world matrix. */
  /* ── how big a body is to point at ──
   *
   * These were generous — two and a half to three and a half times a body's
   * drawn radius, which is seven to eleven times its area on screen. The
   * effect is that the sky is mostly targets: a tap meant for empty space, or
   * for the body behind, lands on whatever large invisible sphere happens to
   * be in front, and since a second tap opens a page that turns into
   * navigation nobody asked for.
   *
   * They are now close to the body itself, with a small margin so the rim is
   * still grabbable and a floor so that something tiny is not impossible to
   * hit on a touch screen. The floor is what keeps this from being a trade
   * against small moons — it is the multiplier that has come down, not the
   * minimum size of a target.
   */
  private hitSphere(radius: number): THREE.Mesh {
    if (!this.hitGeometry) {
      this.hitGeometry = new THREE.SphereGeometry(1, 12, 8);
      this.hitMaterial = new THREE.MeshBasicMaterial();
      this.disposables.push(this.hitGeometry, this.hitMaterial);
    }
    const mesh = new THREE.Mesh(this.hitGeometry, this.hitMaterial!);
    mesh.scale.setScalar(radius);
    mesh.layers.set(PICK_LAYER);
    return mesh;
  }

  /** Collapse a sub-assembly built out of primitives into one mesh per
   * material, with every part's own transform baked into the vertices.
   *
   * The two spacecraft are modelled the way a model kit is: the Endurance is
   * two hundred boxes and cylinders on a hundred and eighty nodes, the
   * telescope another dozen and a half. That is the right way to *author*
   * them — the ring is twelve modules of eight parts each because it is
   * legible as twelve modules of eight parts — and the wrong way to draw them.
   * Two hundred parts is two hundred draw calls, two hundred local matrices
   * recomposed per frame, and two hundred frustum tests, every frame, for a
   * ship that is four pixels across for most of its life. It was four fifths
   * of the scene's entire draw call count.
   *
   * Nothing about the result changes: the transforms are baked, not dropped,
   * and the parts keep the material they were given. What is required of the
   * caller is that the sub-assembly be *rigid* — anything that has to move on
   * its own must sit outside the root this is handed, which is why the ring
   * and the hub are flattened separately. The ring turns; the hub does not.
   *
   * Skips anything the camera would not draw anyway, which is how the pick
   * spheres survive: they hang off these same rigs and they are invisible by
   * layer, so merging one into the visible geometry would put a smooth ball
   * around the ship. */
  private flatten(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const merged: THREE.Mesh[] = [];

    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.layers.test(this.camera.layers)) return;
      const material = mesh.material as THREE.Material;
      const geometry = (mesh.geometry as THREE.BufferGeometry).clone();
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, mesh.matrixWorld));
      const group = byMaterial.get(material);
      if (group) group.push(geometry);
      else byMaterial.set(material, [geometry]);
      merged.push(mesh);
    });

    for (const mesh of merged) mesh.removeFromParent();

    for (const [material, parts] of byMaterial) {
      /* No groups: one material means one draw, and asking for groups here
         would hand it back the per-part split this exists to remove. */
      const geometry = mergeGeometries(parts, false);
      for (const part of parts) part.dispose();
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, material);
      /* The parts were placed once and never moved; the merged mesh sits at
         the root's own origin and never moves either. Its world matrix still
         follows the rig, which is a multiply by the parent and unaffected. */
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
      this.disposables.push(geometry);
    }
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

      const info: BodyInfo = { key: spec.key, ko: spec.ko, en: spec.en, bodyKo: spec.bodyKo, bodyEn: spec.bodyEn, to: spec.to, feed: spec.feed, accent: spec.glow, size: spec.size, primary: true, dive: true };
      const hit = this.hitSphere(Math.max(spec.size * 1.3, 2.4));
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

      /* Built on every tier now, `config.moons` notwithstanding.
         They were treated as detail to be dropped on a slow device, and that
         was defensible while they were scenery. They are not scenery: they are
         thirteen of the bodies the observation panel exists to look at, and a
         telescope whose list works on a desktop and not on a phone is worse
         than no telescope. The frame-rate budget gives elsewhere — pixel
         ratio, bloom, star count, debris — none of which is a named object
         somebody came to find. */
      const moons: MoonRig[] = [];
      if (spec.moons) {
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
      /* Full planet detail, not half.
       *
       * Moons were tessellated at half a planet's segments because they were
       * small things in the distance, where nobody could count the facets. The
       * observation panel changed what they are: Europa now fills the frame,
       * and at 48×24 its outline is a visible polygon and the terminator steps
       * down its limb in stairs. The texture cannot be sharper than its source,
       * but the silhouette can stop being a lie. */
      const segments = Math.max(48, this.config.segments);
      /* Beaten out of shape if it is one of the small ones, a plain sphere
         otherwise. The displacement needs more to work with than the
         silhouette does, so an irregular body is tessellated finer — smooth
         lumps across too few segments come out as facets. */
      const geo = spec.irregular
        ? this.irregularGeometry(spec.size, Math.max(96, segments), spec.irregular)
        : new THREE.SphereGeometry(spec.size, segments, Math.max(24, segments / 2));
      // Moons run a little hot too: the same dark rock and ice as the inner
      // planets, at a fraction of the on-screen size.
      material = this.planetMaterial(this.texture(spec.texture), spec.glow, 0.18, 0.32, 1.3);
      mesh = new THREE.Mesh(geo, material);
      /* A body too small to have been rounded keeps its own proportions. Its
         overall dimensions are a scale on the mesh; the lumps and craters are
         in the geometry above. Kept separate because the proportions are a
         measured fact about the body and the surface is a rendering of it. */
      if (spec.shape) mesh.scale.set(...spec.shape);
      this.disposables.push(geo, material);
    }
    holder.add(mesh);

    const info: BodyInfo = { key: `${host.key}:${spec.key}`, ko: spec.ko, en: spec.en, bodyKo: spec.ko, bodyEn: spec.en, to: spec.to, accent: spec.glow, size: spec.size, primary: false, dive: false };
    const hit = this.hitSphere(Math.max(spec.size * 1.7, 1.1));
    holder.add(hit);
    this.pickables.push({ object: hit, info, anchor: holder });
    this.addLabel(info, holder);

    // `hit` is kept on the rig so ensureMoons can re-register it — see there.
    const rig: MoonRig = { spec, info, pivot, holder, mesh, material, hit };

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

    const HORIZON = HOLE_HORIZON;

    // The horizon itself. Pure black, and it *writes depth*: it is what hides
    // the far half of the disc behind it. The lensing pass then draws the
    // shadow's hard edge and the photon ring over the top.
    const horizonGeo = new THREE.SphereGeometry(HORIZON, 40, 24);
    const horizonMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const horizon = new THREE.Mesh(horizonGeo, horizonMat);
    this.holeGroup.add(horizon);
    this.disposables.push(horizonGeo, horizonMat);

    /* Out from 5.2 horizon radii to 8.6 — 56 units rather than 34. The ending
       flies across this sheet at a metre or two above it for twenty-five
       seconds, and what that shot needs more than anything is somewhere to
       look: a disc whose far edge is close enough to see is a pond. */
    const DISC_IN = HORIZON * 1.35;
    // In from 8.6 horizon radii to 6.4 — 42 units. The sheet had grown wide
    // enough that its own thickness was a rounding error against it.
    const DISC_OUT = HORIZON * 6.4;
    /* And it has a thickness. A ring has none, and edge-on — which is where
       the ending spends its longest movement — a thing with no thickness is a
       line. Three sheets stacked across the normal, each carrying its own
       structure (see uSlab in DISC_FRAG), give it a top and a bottom: the
       layers add and occlude over each other as the camera crosses, which is
       what a body of gas does and what a plane cannot. */
    const SLAB = 2.6;
    /* The section, and the same expression the shader uses to undo it — the
       two have to match to the digit or a fragment cannot tell which sheet it
       is on.

       Thickest at both ends of the radius and thinnest between them. Inward
       the gas can no longer radiate away what compression does to it and the
       flow puffs into a torus, which is what gives the middle its volume;
       outward the scale height grows with radius the way a thin disc's does,
       so it flares again toward the rim; and there is a waist at about two
       fifths. At 2.6 the bulge is 4.6 units of half-thickness at the ISCO
       against a waist of 1.7 and a rim of 1.9 — a body rather than a blade, which is what a disc
       that tapered to nothing exactly where it is brightest looked like. */
    const flare = (tt: number) => 0.18 + 0.5 * Math.pow(tt, 1.2) + 1.6 * Math.exp(-tt * 3.6);
    this.discMaterial = new THREE.ShaderMaterial({
      vertexShader: DISC_VERT,
      fragmentShader: DISC_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uInner: { value: DISC_IN },
        uOuter: { value: DISC_OUT },
        uFeed: { value: 0 },
        uGlowTint: { value: new THREE.Color(0x39ff9e) },
        uGlowMix: { value: 0 },
        uDetail: { value: 0 },
        uSlab: { value: SLAB },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const disc = new THREE.Object3D();
    for (const k of [-1, -0.5, 0, 0.5, 1]) {
      const geo = new THREE.RingGeometry(DISC_IN, DISC_OUT, 260, 34);
      geo.rotateX(-Math.PI / 2);
      /* Bent per vertex rather than translated as a whole, which is what makes
         it a lens instead of three parallel plates. Baked into the geometry
         rather than done on the mesh for the same reason as before: the shader
         reads which sheet it is off the local position, and a mesh offset would
         leave all five thinking they were the middle one.

         Five sheets rather than three. At three they are 2.6 apart out at the
         rim, which is far enough to resolve — the slab came out as three
         separate planes with dark between them rather than as one body. */
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let v = 0; v < pos.count; v++) {
        const rr = Math.hypot(pos.getX(v), pos.getZ(v));
        pos.setY(v, k * SLAB * flare(clamp01((rr - DISC_IN) / (DISC_OUT - DISC_IN))));
      }
      pos.needsUpdate = true;
      geo.computeBoundingSphere();
      const sheet = new THREE.Mesh(geo, this.discMaterial);
      sheet.renderOrder = 4;
      disc.add(sheet);
      this.disposables.push(geo);
      /* The four outer sheets are the thickness, and thickness is only worth
         anything close up: they follow uDetail off, so the resting view pays
         for one disc rather than five. */
      if (k !== 0) this.discSkins.push(sheet);
    }
    // Tipped well off edge-on so the disc reads as a disc from the default
    // camera rather than as a bright line.
    this.holeGroup.rotation.set(0.44, 0.6, 0.18);
    this.holeGroup.add(disc);
    this.disposables.push(this.discMaterial);

    const info: BodyInfo = { key: "blackhole", ko: BLACK_HOLE.ko, en: BLACK_HOLE.en, bodyKo: BLACK_HOLE.bodyKo, bodyEn: BLACK_HOLE.bodyEn, to: BLACK_HOLE.to, accent: "#ff9a4d", size: HORIZON * 2.2, primary: true, dive: true };
    const hit = this.hitSphere(HORIZON * 2.4);
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
   * Each beam is a single strand of light. There used to be a second, much
   * wider cone around it — a hollow sheath, lit at its silhouette, which is the
   * standard way to make a tube of gas read as a beam. It has been taken out:
   * two nested cones is a beam drawn as *geometry*, and at this length it read
   * as a lit funnel with some sparks in it. What the light does now is one
   * thin filament, and everything wide around it is smoke, made of grains that
   * actually travel (see below). Two meshes, one material, one geometry — the
   * cone is built one unit long so the frame can scale it to whatever length
   * the event calls for. */
  private buildJets() {
    /* Open-ended: a cap across the head would read as a lid on it. Narrow at
       the horizon and barely opening on the way out — a collimated filament,
       not a funnel. The opening the eye wants from a jet is now carried by the
       smoke ropes winding around this, so the light itself can stay a thread. */
    const geo = new THREE.CylinderGeometry(0.55, 0.1, 1, 24, 1, true);
    geo.translate(0, 0.5, 0); // base at the origin, head at +1
    this.disposables.push(geo);

    this.jetGroup = new THREE.Object3D();
    this.jetGroup.visible = false;
    this.holeGroup.add(this.jetGroup);

    const material = new THREE.ShaderMaterial({
      vertexShader: JET_VERT,
      fragmentShader: JET_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uHead: { value: 0 },
        uEnergy: { value: 0 },
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
      this.jetCones.push({ mesh, width: 0.3 });
    }

    /* The smoke the beam is wrapped in. The strand of light alone is a shape:
       it has a length and a colour and it flickers, but nothing in it is
       visibly *moving material*, and at seven seconds there is far too long to
       look at that. These are the grains, and they do not fill the beam evenly
       — they are gathered into a few ropes that twist around the light on their
       way out.

       A rope, not an arm. The old arrangement scattered every grain across the
       full width of the beam, banded only by which of three spiral arms it
       belonged to, and the result was a sheath: a lit tube with structure in
       it. Giving each grain a place *around its own rope's axis* as well as a
       place around the beam's is what makes the bands close up into cords with
       a near and a far side, and cords are what can be seen to braid. Three of
       them per pole, because three is the smallest number that reads as a
       plait rather than as a pair crossing, and because the fewer the ropes the
       more grains each one gets to be solid with.

       And the cords are drawn tight. A rope a quarter as thick holds its grains
       in a sixteenth of the cross-section, so the same smoke that read as a
       spiralling spray now reads as one twisted bar of it — which is the point:
       these are meant to leave in a solid mass, wound around the light the way
       the strands of a screw thread are wound around its shaft, not to drift
       out beside it. The count goes up with the tightening, because a cord this
       narrow shows every gap in itself.

       And they are drawn as cloud, not as grains. The pool's default sprite is
       a bead — a hot point inside a small halo — which is right for a comet
       head and wrong for this: no number of beads is smoke, because each one
       keeps a centre and a rim for the eye to find. These slots ask for the
       soft profile instead (see GLOW_FRAG), and they are made several times
       the width of the cord that carries them, so what is actually seen is not
       the sprites but the single thick body of smoke they overlap into. The
       cord's own radius stops being the visible thickness at that point and
       becomes what it should be: the line the smoke is threaded on.

       And the gas leaves in puffs, not as an even stream. Spreading the launch
       phases uniformly gives smoke of constant density, which the eye reads as
       a lit tube again — a shape, not material. Quantising them into a handful
       of clots, each with its own climb rate so it holds together on the way
       out, is what turns the beam into something that is visibly being
       *thrown*: discrete masses of smoke, wound around the light by the same
       rotation, climbing one after another. */
    /* Held back from what the look alone would want. These are big soft
       additive sprites several deep, so the cost of them is fill rate and
       nothing else, and fill rate is the one budget this scene has already
       spent on the bloom. The counts below are roughly three times the fill
       the beam used before the smoke was gathered into cords — enough for the
       ropes to be continuous, and short of where a seven-second effect starts
       costing the forty other seconds of the cycle their frame rate. */
    /* Sized for the star's beam, not the rock's. The star's is longer and more
       than twice as wide — call it eight times the volume — and pouring the
       same grain count into it made a thinner beam out of a bigger one, which
       is the opposite of what a whole star going in should buy. So the pool
       here is the star's, and the rock draws a fraction of it (see
       updateJetParticles) so its own beam is left as it was.
       Ultra takes the hole's allocation to 6,091 of the pool's 6,200. */
    this.jetParticleCount = this.tier === "low" ? 700 : this.tier === "high" ? 1500 : 2600;
    this.jetParticleStart = this.glow.allocate(this.jetParticleCount);
    this.glow.setSoft(this.jetParticleStart, this.jetParticleCount, 1);
    this.jetParticles = new Float32Array(this.jetParticleCount * 9);
    const rand = mulberry32(51877);
    const ropes = 3;
    const puffs = 7;
    // One rate per clot rather than per grain, so a clot arrives as a clot.
    const puffRate: number[] = [];
    for (let k = 0; k < puffs; k++) puffRate.push(0.84 + rand() * 0.3);
    for (let i = 0; i < this.jetParticleCount; i++) {
      const p = i * 9;
      const puff = i % puffs;
      /* Which rope, and which pole. The rope index is taken off i/2 rather
         than off i, because the pole alternates on i: index both on the same
         counter and every even-numbered rope leaves by the north pole and every
         odd one by the south, which halves the braid at both ends. */
      const rope = Math.floor(i / 2) % ropes;
      // Where along the beam it starts — banded, not scattered.
      this.jetParticles[p] = (puff / puffs + (rand() - 0.5) * 0.055 + 1) % 1;
      // Which rope of the braid, with only enough jitter to soften its edge.
      this.jetParticles[p + 1] = (rope / ropes) * Math.PI * 2 + (rand() - 0.5) * 0.14;
      // Where it sits around that rope's own axis, and how far out from it.
      this.jetParticles[p + 2] = rand() * Math.PI * 2;
      /* Crowded onto the centre-line. An exponent of a half would spread the
         grains at even density across the cord's disc; above that they pile up
         along its axis and thin towards its edge, which is a cord with a solid
         middle rather than a hollow tube of one — the difference between smoke
         being thrown out in a mass and smoke being blown through a pipe. */
      this.jetParticles[p + 3] = Math.pow(rand(), 0.95);
      // A little slack along the rope, so it has a body and not a cross-section.
      this.jetParticles[p + 4] = rand() - 0.5;
      this.jetParticles[p + 5] = puffRate[puff]; // how fast it climbs
      this.jetParticles[p + 6] = rand(); // size and brightness roll
      this.jetParticles[p + 7] = i % 2 === 0 ? 1 : -1; // which pole it left by
      this.jetParticles[p + 8] = puff / puffs; // the clot's own phase
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
        uDetail: { value: this.starDetail },
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
        // Same reasoning as the sun's, one step further: on a hot star the
        // outer halo is not merely white, it keeps a blue cast all the way out.
        uOuterColor: { value: new THREE.Color(0xdcecff) },
        uIntensity: { value: 0.62 },
        uUnit: { value: 1 / 3.4 },
        /* Tightened along with the sun's, and by the same reasoning: 8.5
           against the old 4.6 brings the halo in without touching the plane it
           is drawn on, which is the change that made the sun's disappear. */
        uFalloff: { value: 8.5 },
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
    /* Trebled. This ribbon is supposed to read as a star being drained, and six
       hundred grains across a fifty-unit gap is a thread. The glow pool holds
       6,200 slots against roughly 3,800 already claimed, so the room is there —
       and the cheap tier still gets the smallest share of it. */
    this.streamCount = this.tier === "low" ? 520 : this.tier === "high" ? 1150 : 1800;
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

  /** The wormhole off Saturn.
   *
   * A sphere and one shader, and that is the whole of it in the scene graph —
   * everything that makes it read as a hole through to somewhere else is in
   * WORMHOLE_FRAG, which is where the note on the mapping lives. What is here
   * is the two things the shader cannot know: how close the camera has got,
   * and that this is a body the telescope can be pointed at.
   *
   * Opaque, and it writes depth. It is tempting to make a thing you can see
   * through additive, but there is nothing of this sky to see through it to —
   * what is inside is a different sky, and letting Saturn's stars come through
   * from behind would turn the far side into a transparency laid over the near
   * one. The only part of this sky it touches is the ring of it just outside
   * the silhouette, which the lensing pass bends and this mesh never draws. */
  private buildWormhole() {
    /* Fewer bands than a planet gets. This is a sphere with no features of its
       own — every pixel of it is computed from the interpolated normal — so
       segments buy nothing but a rounder silhouette, and the silhouette is
       where the shader puts its brightest line anyway. */
    const segments = Math.max(48, Math.round(this.config.segments * 0.75));
    const geo = new THREE.SphereGeometry(WORMHOLE_RADIUS, segments, segments / 2);
    this.wormholeMaterial = new THREE.ShaderMaterial({
      vertexShader: WORMHOLE_VERT,
      fragmentShader: WORMHOLE_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uNear: { value: 0 },
        uEdge: { value: 1 },
        // Cold blue-white, and a hair off the rim's colour: the ring is the
        // piled-up image of the same stars, so it cannot be a different sky.
        uRim: { value: new THREE.Color(0xcfe0ff) },
        // Three genuinely different colours rather than three tints of one.
        // A teal, a rose and an amber sit far enough apart on the wheel that
        // the eye reads three objects and not one cloud lit unevenly.
        uNebA: { value: new THREE.Color(0x2f9d86) },
        uNebB: { value: new THREE.Color(0xb2447e) },
        uNebC: { value: new THREE.Color(0xc0863a) },
      },
    });
    this.wormhole = new THREE.Mesh(geo, this.wormholeMaterial);
    this.wormhole.position.set(...WORMHOLE.position);
    /* Hung off Saturn's equatorial frame, not off the scene — so it goes round
       the sun with Saturn instead of standing still while Saturn leaves. That
       frame rather than the planet itself because `axis` carries the rings and
       the moons and does NOT carry the spin: parented to the body the wormhole
       would whip round Saturn once every eighteen seconds. See WORMHOLE for
       what the offset in it means. */
    const saturn = this.planets.find((p) => p.spec.key === "saturn");
    (saturn ? saturn.axis : this.scene).add(this.wormhole);
    this.disposables.push(geo, this.wormholeMaterial);

    /* Pickable, and deliberately not a destination — `to` is empty, the way
       the telescope's is. It has to be in `pickables` at all because that is
       the list observe() looks a target up in, so a wormhole the telescope
       cannot find is a wormhole missing from the deep-sky menu. */
    const info: BodyInfo = {
      key: "wormhole",
      ko: WORMHOLE.ko,
      en: WORMHOLE.en,
      bodyKo: WORMHOLE.bodyKo,
      bodyEn: WORMHOLE.bodyEn,
      to: WORMHOLE.to,
      accent: "#9ec7ff",
      size: WORMHOLE_RADIUS,
      primary: false,
      // Nothing to fall into: a dive ends by opening a page, and this has none.
      dive: false,
    };
    const hit = this.hitSphere(WORMHOLE_RADIUS * 1.8);
    this.wormhole.add(hit);
    this.pickables.push({ object: hit, info, anchor: this.wormhole });
    this.addLabel(info, this.wormhole);
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

    /* The beams: one shaft through each of the two stars and one through the
       remnant they become, each a cylinder capped at neither end and lit as a
       single ray. See BEAM_FRAG for why it is a surface rather than a crowd of
       sprites — a shaft of light has to arrive at ONE width, and a hundred
       sprites laid along an axis will always read as something scattering off
       it however tightly they are packed.

       Twenty-four sides, which is more than the silhouette needs and about
       what the limb term does. That term is computed per vertex and
       interpolated across the wall, so the count is really how finely the
       shaft's brightness is sampled across its own width — too few and the
       ray comes out banded lengthwise. It is two cylinders on screen at once
       and nothing else, so the triangles are free.

       Unit geometry, sized per body by the mesh scale — the remnant's shaft is
       longer and thicker than either star's. */
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
    this.disposables.push(beamGeo);
    for (let i = 0; i < 3; i++) {
      const material = new THREE.ShaderMaterial({
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        uniforms: {
          uColor: { value: new THREE.Color(0x4d99ff) },
          uGain: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        // Both walls, so the near one and the far one sum down the centreline.
        // That sum is what fills the shaft — see the limb note in BEAM_FRAG.
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(beamGeo, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      this.scene.add(mesh);
      this.beams.push({ mesh, material });
      this.disposables.push(material);
    }

    const info: BodyInfo = { key: "neutron", ko: NEUTRON_BINARY.ko, en: NEUTRON_BINARY.en, bodyKo: NEUTRON_BINARY.bodyKo, bodyEn: NEUTRON_BINARY.bodyEn, to: NEUTRON_BINARY.to, accent: "#9fd0ff", size: 5, primary: true, dive: true };
    const hit = this.hitSphere(7.5);
    this.neutronGroup.add(hit);
    this.pickables.push({ object: hit, info, anchor: this.neutronGroup });
    this.addLabel(info, this.neutronGroup);
  }

  /** The probe, built part by part rather than suggested.
   *
   * The old rig was four primitives — a dish, a drum, a stick and a canister —
   * which is enough to say "spacecraft" at the distance it used to keep and
   * nothing at all once it comes anywhere near the camera. Voyager is a very
   * recognisable object, and all of what makes it recognisable is the bits
   * sticking out of it: the subreflector held at the dish's focus on three
   * struts, the three RTGs strung along one boom, the scan platform on the
   * other, and the two enormous whip antennas at a shallow V. Those are what
   * turn a bowl on a stick into a craft with a front, a back and a purpose,
   * and none of them cost anything worth counting — this is one object, at a
   * few hundred triangles, in a scene that draws a nebula.
   *
   * Local +Y is the dish's boresight. updateVoyager turns the whole rig so
   * that axis points home, which is where the real one's dish points. */
  /** The Hubble Space Telescope, in orbit around Earth and carried round with
   * it — geostationary in the sense the request asked for: it keeps station
   * over the same face as Earth turns, rather than racing round on its real
   * 95-minute orbit, which at this scale would be a blur.
   *
   * Built part by part rather than suggested, like the probe. Hubble is a
   * recognisable object and what makes it recognisable is not the tube: it is
   * the two solar wings, the open aperture door tilted back off the front, the
   * pair of dish antennas on booms, and the band of gold insulation round the
   * body. A silver cylinder alone is a thermos.
   */
  /** Beats a sphere into the shape of a body too small to be round.
   *
   * A tri-axial ellipsoid was the first attempt and it is still an ellipsoid:
   * smooth, symmetrical, and nothing like Phobos, which is lumpy, angular, and
   * carries one crater nearly half its own width. Three things are done to the
   * vertices here, in the order they matter:
   *
   *   - Lumps. A handful of broad bulges and hollows in fixed directions, each
   *     falling off with the angle from its own axis. This is what stops the
   *     silhouette being an oval — a real one wanders.
   *   - Stickney. One deep, wide depression, with a raised rim where the
   *     ejecta piled up. It is the single feature that makes Phobos
   *     recognisable and the reason its outline has a bite taken out of it.
   *   - Grain. Small high-frequency displacement so the surface is not
   *     polished between the large features.
   *
   * The UVs are untouched, so the surface map still lands where it should.
   * Deterministic — the same seed every load, because a body that is a
   * different shape on each visit is not a body.
   */
  private irregularGeometry(size: number, segments: number, amount: number): THREE.BufferGeometry {
    const geo = new THREE.SphereGeometry(size, segments, Math.max(16, segments / 2));
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const rand = mulberry32(20250809);

    // Broad bulges. Directions and weights drawn once, then fixed.
    const lumps: { x: number; y: number; z: number; w: number; k: number }[] = [];
    for (let i = 0; i < 9; i++) {
      const u = rand() * 2 - 1;
      const t = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      lumps.push({
        x: Math.cos(t) * s,
        y: u,
        z: Math.sin(t) * s,
        // Both signs: a body this size has hollows as well as shoulders.
        w: (rand() * 2 - 1) * 0.5,
        k: 1.4 + rand() * 2.6,
      });
    }

    /* Stickney, on the leading face. Its real diameter is about nine
       kilometres against a body twenty-seven long, so it takes a third of the
       width — which is why the outline has a notch rather than a dimple. */
    const cx = 0.82;
    const cy = 0.24;
    const cz = 0.52;
    const clen = Math.hypot(cx, cy, cz);

    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const len = v.length() || 1;
      const nx = v.x / len;
      const ny = v.y / len;
      const nz = v.z / len;

      let d = 0;
      for (const l of lumps) {
        const dot = nx * l.x + ny * l.y + nz * l.z;
        if (dot > 0) d += l.w * Math.pow(dot, l.k);
      }

      // The crater: a bowl inside its radius, a rim just outside it.
      const cd = (nx * cx + ny * cy + nz * cz) / clen;
      const angle = Math.acos(Math.min(1, Math.max(-1, cd)));
      const RIM = 0.62;
      if (angle < RIM) {
        const t = angle / RIM;
        d -= (1 - t * t) * 0.5;
      } else if (angle < RIM + 0.22) {
        const t = (angle - RIM) / 0.22;
        d += Math.sin(t * Math.PI) * 0.12;
      }

      // Grain, so the faces between features are not polished.
      d += (Math.sin(nx * 17.3 + ny * 11.7) * Math.cos(nz * 14.1 - nx * 9.3)) * 0.055;

      const scale = 1 + d * amount;
      pos.setXYZ(i, nx * size * scale, ny * size * scale, nz * size * scale);
    }

    pos.needsUpdate = true;
    // The lighting is now wrong everywhere until these are rebuilt: the shader
    // reads normals, and every one of them still points at the sphere it was.
    geo.computeVertexNormals();
    return geo;
  }

  private buildHubble(earth: PlanetRig) {
    /* Parented to Earth's own body, so it rides the orbit for free — the
       telescope needs no orbital mechanics of its own, only a rotation. */
    this.hubblePivot = new THREE.Object3D();
    this.hubblePivot.rotation.z = 0.34;
    earth.body.add(this.hubblePivot);

    const rig = new THREE.Object3D();
    rig.position.x = earth.spec.size * 2.35;
    this.hubblePivot.add(rig);
    this.hubble = rig;

    /* Sized against Earth rather than against reality. To scale the real
       telescope beside this Earth would be a fraction of a pixel — the whole
       point of putting it here is that it can be looked at, so it is drawn at
       the size of a thing you can see and its true dimensions live in the
       observation panel instead. */
    const S = earth.spec.size * 0.15;

    /* Barely metallic, and lit from inside.
     *
     * A high `metalness` was the reason none of this could be seen. A metal in
     * this lighting model has almost no diffuse response — nearly all of what
     * it shows is REFLECTED, and there is no environment map in this scene for
     * it to reflect. So the shell reflected nothing, diffused nothing, and came
     * out very close to black against a black sky.
     *
     * Metalness is therefore low enough for the sun's light to actually land on
     * these surfaces, and each carries an `emissive` floor so the telescope is
     * legible on its own night side too. The floor is what stops half the model
     * disappearing whenever Earth's rotation carries it out of the sun. */
    const shell = new THREE.MeshStandardMaterial({
      color: 0xeef1f6,
      metalness: 0.22,
      roughness: 0.46,
      emissive: 0x6d7891,
      emissiveIntensity: 0.55,
    });
    const foil = new THREE.MeshStandardMaterial({
      color: 0xffc75e,
      metalness: 0.34,
      roughness: 0.3,
      emissive: 0x8a5c12,
      emissiveIntensity: 0.75,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x555f70,
      metalness: 0.2,
      roughness: 0.7,
      emissive: 0x232a36,
      emissiveIntensity: 0.6,
    });
    const panel = new THREE.MeshStandardMaterial({
      color: 0x3f6bb8,
      metalness: 0.18,
      roughness: 0.4,
      emissive: 0x16305e,
      emissiveIntensity: 0.7,
      side: THREE.DoubleSide,
    });
    this.disposables.push(shell, foil, dark, panel);

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      rig.add(mesh);
      this.disposables.push(geo);
      return mesh;
    };

    // The tube. Lying along Z so "the front" is a direction the whole rig can
    // be pointed, which is what the aiming below turns.
    const body = add(new THREE.CylinderGeometry(S * 0.5, S * 0.5, S * 2.5, 28, 1), shell, 0, 0, 0);
    body.rotation.x = Math.PI / 2;

    // The gold insulation blanket, a band round the aft half.
    const wrap = add(new THREE.CylinderGeometry(S * 0.52, S * 0.52, S * 0.85, 28, 1, true), foil, 0, 0, -S * 0.62);
    wrap.rotation.x = Math.PI / 2;

    // The aperture end, and its door standing open off the rim — the detail
    // that says which end is the front from any angle.
    const lip = add(new THREE.CylinderGeometry(S * 0.54, S * 0.5, S * 0.16, 28, 1), dark, 0, 0, S * 1.3);
    lip.rotation.x = Math.PI / 2;
    const door = add(new THREE.CircleGeometry(S * 0.5, 28), shell, 0, S * 0.46, S * 1.5);
    door.rotation.x = -1.15;
    (door.material as THREE.Material).side = THREE.DoubleSide;

    // The aft bulkhead.
    const tail = add(new THREE.CylinderGeometry(S * 0.5, S * 0.44, S * 0.14, 28, 1), dark, 0, 0, -S * 1.3);
    tail.rotation.x = Math.PI / 2;

    /* The two wings. These are most of the silhouette: a metre of tube either
       side of them is what the eye reads as "telescope" rather than "canister
       with panels". Each is a mast out to a flat array. */
    for (const side of [1, -1]) {
      const mast = add(new THREE.CylinderGeometry(S * 0.05, S * 0.05, S * 0.55, 8, 1), shell, side * S * 0.75, 0, 0);
      mast.rotation.z = Math.PI / 2;
      const wing = add(new THREE.BoxGeometry(S * 1.75, S * 0.035, S * 1.15), panel, side * S * 1.9, 0, 0);
      wing.rotation.z = side * 0.05;
      // The array's own frame, so the panel is not one flat rectangle.
      const spine = add(new THREE.BoxGeometry(S * 1.8, S * 0.07, S * 0.07), shell, side * S * 1.9, 0, 0);
      spine.rotation.z = side * 0.05;
    }

    /* The two high-gain antennas, on booms above and below, facing back the
       way Hubble talks to the relay satellites. */
    for (const side of [1, -1]) {
      const boom = add(new THREE.CylinderGeometry(S * 0.045, S * 0.045, S * 0.6, 8, 1), shell, 0, side * S * 0.72, -S * 0.3);
      const dish = add(new THREE.SphereGeometry(S * 0.3, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2.4), shell, 0, side * S * 1.02, -S * 0.3);
      dish.rotation.x = side > 0 ? Math.PI : 0;
      (dish.material as THREE.Material).side = THREE.DoubleSide;
      void boom;
    }

    const info: BodyInfo = {
      key: "hubble",
      ko: "허블 우주망원경",
      en: "Hubble Space Telescope",
      bodyKo: "허블 우주망원경",
      bodyEn: "Hubble Space Telescope",
      to: "",
      accent: "#ffd489",
      size: S * 2.2,
      primary: false,
      // Not a destination: it opens the observation panel rather than a route,
      // so a dive to a page it does not have would be a dead end.
      dive: false,
    };
    const hit = this.hitSphere(S * 1.6);
    rig.add(hit);
    this.pickables.push({ object: hit, info, anchor: rig });
    this.addLabel(info, rig);
    this.hubbleInfo = info;

    /* The telescope is a dozen and a half parts and not one of them moves
       relative to the others — only the rig they hang off is aimed. So they go
       the way the Endurance's do: baked into one mesh per material, which
       takes the per-frame matrix work the note here used to save and the draw
       calls with it. The pick sphere on the rig is left alone — see flatten. */
    this.flatten(rig);
  }

  private buildVoyager() {
    this.voyager = new THREE.Object3D();
    /* Bright, and lit from inside as well as out.
     *
     * These were deliberately dim, on the reasoning that a hard-lit metal
     * probe out in the dark reads as a bug rather than as a spacecraft. That
     * was written when the craft lived out past Neptune as a speck; now it is
     * the subject of its own tour with the camera sixteen units behind it, and
     * dim grey on black is simply unreadable — you cannot see the shape of a
     * thing you built the shape for.
     *
     * The emissive is the more important half of it. The sun is a single point
     * light with decay 0, so every surface facing away from it goes to pure
     * black, and on a craft that is mostly booms and struts that is most of
     * the craft from most angles. A low emissive floor means the unlit side is
     * dark rather than absent, which is what keeps the silhouette whole while
     * the probe turns.
     *
     * All of them transparent, because the craft fades out rather than
     * vanishing when it leaves the system — see updateVoyager. A material that
     * is only ever at opacity 1 pays nothing for the flag but the sort order,
     * and this is one small object. */
    const metal = new THREE.MeshStandardMaterial({
      color: 0xc2ccdc,
      metalness: 0.55,
      roughness: 0.42,
      emissive: 0x2c3444,
      transparent: true,
    });
    const gold = new THREE.MeshStandardMaterial({
      color: 0xe8b85c,
      metalness: 0.8,
      roughness: 0.3,
      emissive: 0x4a3512,
      transparent: true,
    });
    // The seams, the tunnels between modules and the shadowed housings. Not
    // black: a dark segment between two bright ones reads as a gap in the
    // ring, and the one thing this ring must never look is broken.
    const dark = new THREE.MeshStandardMaterial({
      color: 0x76808f,
      metalness: 0.4,
      roughness: 0.7,
      emissive: 0x1c2029,
      transparent: true,
    });
    /* The hull. White thermal blanket over most of the ship, which is what
       the film's is and also what makes twelve modules legible as twelve
       against a black sky — a grey ring at this size is one object. */
    const hull = new THREE.MeshStandardMaterial({
      color: 0xf2f5fa,
      metalness: 0.15,
      roughness: 0.55,
      emissive: 0x3a4354,
      transparent: true,
    });
    /* Windows and the running lights, and the only thing on the ship that is
       its own light source. A crewed vessel with no lit windows is a hull. */
    const glass = new THREE.MeshStandardMaterial({
      color: 0x9fd4ff,
      metalness: 0.1,
      roughness: 0.25,
      emissive: 0x5fa8e8,
      emissiveIntensity: 0.85,
      transparent: true,
    });
    // Engine bells. Dark, and rough, because they are the one part that has
    // been fired.
    const nozzle = new THREE.MeshStandardMaterial({
      color: 0x4a5160,
      metalness: 0.7,
      roughness: 0.55,
      emissive: 0x15181f,
      transparent: true,
    });
    // Kept under its old name so the panel banding reads against the hull.
    const panel = new THREE.MeshStandardMaterial({
      color: 0xa8b3c4,
      metalness: 0.5,
      roughness: 0.5,
      emissive: 0x272e3a,
      transparent: true,
    });
    this.voyagerMaterials = [metal, gold, dark, hull, glass, nozzle, panel];
    this.disposables.push(metal, gold, dark, hull, glass, nozzle, panel);

    /* Every part goes on an inner node, rather than the numbers below being
       scaled. The hit sphere hangs off the OUTER node, so resizing the ship
       does not resize the target a finger has to land on — a ship you can
       barely see is a choice; a ship you can barely tap is a fault. */
    /* Three quarters. The ring below is built at an outer radius of 1.9, so
       it comes out 2.85 units across against the 3.8 it was — and the chase
       distance is deliberately NOT scaled with it, because pulling the camera
       in by the same fraction would leave the ship exactly the size it was
       and the change would be one nobody could see. */
    const craft = new THREE.Object3D();
    craft.scale.setScalar(0.75);
    this.voyager.add(craft);

    /* And the ring is its own node inside that, because the ring is the only
       part of this ship that moves. Everything hangs off it and turns with
       it; the outer node carries the heading and stays still. */
    this.enduranceRing = new THREE.Object3D();
    craft.add(this.enduranceRing);

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, place: (m: THREE.Mesh) => void) => {
      const mesh = new THREE.Mesh(geo, mat);
      place(mesh);
      parent.add(mesh);
      this.disposables.push(geo);
      return mesh;
    };

    /* ─────────────────────────── the ring ───────────────────────────
       Twelve boxy modules standing RADIALLY — long axis pointing out of the
       ring, not lying along it. That is the single thing the first attempt
       got wrong and it changed everything else: laid tangentially as
       capsules, the ship came out a bead necklace, and the real one is a
       cog. The modules are nearly touching at their inner ends and splay
       apart toward their outer ones, which is why the gaps between them are
       wedges and why the tunnels that join them all sit at the inside.

       Proportions taken off a render of the ship rather than invented: the
       hole in the middle is a little over half the outer diameter, so a
       module is about a quarter of the outer radius long, and twelve of them
       at that radius leaves the wedge gaps the reference shows.

       Built in the XY plane with the ring's axis along Z, because the craft
       is then aimed by pointing that axis down its own heading — see
       aimVoyager. */
    const MODULES = 12;
    const R_OUT = 1.9;
    // Out from 1.01, which shortens the modules from 0.89 to 0.72 and opens
    // the hole in the middle at the same time.
    const R_IN = 1.18;
    const MID = (R_OUT + R_IN) * 0.5;
    const RADIAL = R_OUT - R_IN;
    /* Set by the inner end, not the outer one: the arc between module centres
       at R_IN is 0.618, and anything wider than that overlaps its neighbours
       where they are closest.
       Down from 0.5 against the old 0.529 — which left a gap of three
       hundredths at the inner end, so the ring read as a solid band with
       grooves in it rather than as twelve things joined by tunnels. At 0.40
       against 0.618 the gap is 0.22 and the tunnels between them are visible
       as tunnels, which is what they are for. */
    const TANG = 0.4;
    const THICK = 0.5;

    for (let i = 0; i < MODULES; i++) {
      const a = (i / MODULES) * Math.PI * 2;
      /* One node per module, turned so its local +X points out of the ring
         and its local +Y runs along it. Every part below is then placed in
         the module's own terms rather than in trigonometry. */
      const mod = new THREE.Object3D();
      mod.position.set(Math.cos(a) * MID, Math.sin(a) * MID, 0);
      mod.rotation.z = a;
      this.enduranceRing.add(mod);

      // The body.
      add(new THREE.BoxGeometry(RADIAL, TANG, THICK), hull, mod, () => {});
      /* The cap on the outer end, a little proud of the body. Every module in
         the reference has one and it is most of what stops a ring of plain
         boxes reading as a ring of plain boxes. */
      add(new THREE.BoxGeometry(0.1, TANG * 0.92, THICK * 0.92), panel, mod, (m) => {
        m.position.x = RADIAL * 0.5;
      });
      // And the shoulder at the inner end, where the tunnels meet it.
      add(new THREE.BoxGeometry(0.12, TANG * 0.8, THICK * 0.8), panel, mod, (m) => {
        m.position.x = -RADIAL * 0.5;
      });

      /* The big flat panel on each side face — solar array on the habitats,
         plating everywhere else. In the reference these are the darkest thing
         on the ship and they are what gives a white box a scale. */
      /* Inset, not covering. At 0.72 by 0.66 in the darkest material on the
         ship these swallowed the whole side of every module and the ring came
         out black with neon stripes on it — the reference is a WHITE ship with
         a panel let into each face. Smaller, and in the mid grey, so the hull
         reads as the hull and the panel as something set into it. */
      for (const sz of [-1, 1]) {
        add(new THREE.BoxGeometry(RADIAL * 0.52, TANG * 0.48, 0.012), panel, mod, (m) => {
          m.position.z = sz * THICK * 0.5;
        });
      }
      // Two window bands down the middle of it, lit — and narrow. A window is
      // a slot in a wall, not a light bar.
      for (const sy of [-1, 1]) {
        add(new THREE.BoxGeometry(RADIAL * 0.4, 0.032, 0.016), glass, mod, (m) => {
          m.position.set(0, sy * 0.058, THICK * 0.5 + 0.004);
        });
      }

      if (i % 3 === 0) {
        /* The drive modules: four of them, three plasma engines each, which
           is what the ship's own documentation says and what the reference
           shows on every fourth segment. */
        for (const sz of [-1, 0, 1]) {
          add(new THREE.CylinderGeometry(0.055, 0.075, 0.14, 10), nozzle, mod, (m) => {
            m.position.set(RADIAL * 0.5 + 0.11, 0, sz * 0.17);
            m.rotation.z = Math.PI / 2;
          });
        }
      } else if (i % 3 === 1) {
        // The cargo pods: banded, and blanker than the rest — they are the
        // parts meant to be dropped on a surface and left there.
        for (const sx of [-0.22, 0.06, 0.3]) {
          add(new THREE.BoxGeometry(0.05, TANG * 1.03, THICK * 1.03), panel, mod, (m) => {
            m.position.x = sx;
          });
        }
      } else {
        /* Radiators, laid flat against the trailing face rather than standing
           off the sides. Edge-on and proud of the module they were eight thin
           gold splinters sticking out of the ring — from the front they read
           as damage, and the reference has nothing of the kind. Flat, they
           are a plate on the back of four modules, which is what they are. */
        add(new THREE.BoxGeometry(RADIAL * 0.62, TANG * 0.86, 0.014), gold, mod, (m) => {
          m.position.set(0.04, 0, -THICK * 0.5 - 0.012);
        });
      }
    }

    /* The tunnels between modules, and the nodes they meet at.
     *
     * Hung off the RING and not off a module, which is the whole of what was
     * wrong with them before: they were parented to a module and rotated by
     * half a segment, and a rotation in that frame turns about the module's
     * own centre rather than about the ring's — so instead of sitting in the
     * gap they sat buried inside the module that carried them, and the ring
     * looked like twelve slabs that were not joined to anything.
     *
     * They live at the inner edge because that is where the reference puts
     * them and, on a ring of radial slabs, the only place where neighbours
     * are close enough to reach each other at all. */
    for (let i = 0; i < MODULES; i++) {
      const a = ((i + 0.5) / MODULES) * Math.PI * 2;
      const node = new THREE.Object3D();
      node.position.set(Math.cos(a) * (R_IN + 0.07), Math.sin(a) * (R_IN + 0.07), 0);
      node.rotation.z = a;
      this.enduranceRing.add(node);
      add(new THREE.SphereGeometry(0.1, 12, 8), panel, node, () => {});
      // Along the ring, and long enough to reach into both neighbours: the arc
      // between module centres here is 0.618 and a module is 0.40 wide.
      add(new THREE.CylinderGeometry(0.062, 0.062, 0.34, 10), dark, node, () => {});
    }

    /* ────────────────────── the docking hub ──────────────────────
       And the thing the first attempt left out altogether: a cruciform hub
       floating free in the middle of the ring, which is where the Rangers
       and the Landers actually dock. Without it the ship is a hoop, and a
       hoop is not what anybody remembers.

       It does NOT turn with the ring. The ring is the crew's gravity and it
       spins for it; the hub is what a craft coming alongside has to mate
       with, and a docking port on a spinning ring is a docking port nothing
       can reach. That is also the read the shape gives for free — the still
       centre is what makes the turning visible. */
    this.enduranceHub = new THREE.Object3D();
    craft.add(this.enduranceHub);

    // The core: a short octagonal drum with a collar at each end.
    add(new THREE.CylinderGeometry(0.135, 0.135, 0.2, 8), hull, this.enduranceHub, (m) => {
      m.rotation.x = Math.PI / 2;
    });
    for (const sz of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.085, 0.105, 0.09, 12), panel, this.enduranceHub, (m) => {
        m.position.z = sz * 0.15;
        m.rotation.x = Math.PI / 2;
      });
    }

    /* Four arms out of it in the ring's plane, and deliberately not the same
       length: the reference's hub is longer on one side than the other, and
       a perfectly symmetrical cross reads as a decoration rather than as a
       structure something was built onto. */
    const ARMS: { rot: number; reach: number }[] = [
      { rot: 0, reach: 0.52 },
      { rot: Math.PI, reach: 0.3 },
      { rot: Math.PI / 2, reach: 0.26 },
      { rot: -Math.PI / 2, reach: 0.26 },
    ];
    for (const arm of ARMS) {
      const node = new THREE.Object3D();
      node.rotation.z = arm.rot;
      this.enduranceHub.add(node);
      // The arm itself, in two thicknesses so it is segmented rather than a rod.
      add(new THREE.CylinderGeometry(0.062, 0.062, arm.reach, 10), hull, node, (m) => {
        m.position.x = arm.reach * 0.5 + 0.1;
        m.rotation.z = Math.PI / 2;
      });
      add(new THREE.CylinderGeometry(0.082, 0.082, 0.07, 10), panel, node, (m) => {
        m.position.x = arm.reach * 0.62;
        m.rotation.z = Math.PI / 2;
      });
      // The port on the end.
      add(new THREE.CylinderGeometry(0.055, 0.07, 0.06, 12), dark, node, (m) => {
        m.position.x = arm.reach + 0.12;
        m.rotation.z = Math.PI / 2;
      });
    }

    /* A Ranger on the long arm and a Lander on the short one — two of each in
       the film, and the hub is where they ride. */
    const ranger = new THREE.Object3D();
    ranger.position.set(0.74, 0, 0);
    ranger.scale.setScalar(0.62);
    this.enduranceHub.add(ranger);
    add(new THREE.BoxGeometry(0.3, 0.075, 0.115), hull, ranger, () => {});
    add(new THREE.ConeGeometry(0.055, 0.15, 10), hull, ranger, (m) => {
      m.position.x = 0.22;
      m.rotation.z = -Math.PI / 2;
    });
    for (const sz of [-1, 1]) {
      add(new THREE.BoxGeometry(0.19, 0.018, 0.11), hull, ranger, (m) => {
        m.position.set(-0.03, 0, sz * 0.1);
        m.rotation.y = sz * 0.34;
      });
      add(new THREE.CylinderGeometry(0.028, 0.033, 0.075, 8), nozzle, ranger, (m) => {
        m.position.set(-0.18, 0, sz * 0.045);
        m.rotation.z = Math.PI / 2;
      });
    }
    add(new THREE.BoxGeometry(0.1, 0.085, 0.016), hull, ranger, (m) => {
      m.position.set(-0.12, 0.06, 0);
    });
    add(new THREE.BoxGeometry(0.075, 0.03, 0.07), glass, ranger, (m) => {
      m.position.set(0.1, 0.04, 0);
    });

    const lander = new THREE.Object3D();
    lander.position.set(-0.5, 0, 0);
    lander.scale.setScalar(0.72);
    this.enduranceHub.add(lander);
    add(new THREE.BoxGeometry(0.23, 0.15, 0.19), hull, lander, () => {});
    add(new THREE.BoxGeometry(0.12, 0.055, 0.155), dark, lander, (m) => {
      m.position.set(0.04, 0.1, 0);
    });
    add(new THREE.CylinderGeometry(0.055, 0.07, 0.06, 12), nozzle, lander, (m) => {
      m.position.x = 0.14;
      m.rotation.z = Math.PI / 2;
    });
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        add(new THREE.CylinderGeometry(0.012, 0.012, 0.13, 5), metal, lander, (m) => {
          m.position.set(-0.08, sy * 0.085, sz * 0.085);
          m.rotation.z = sy * 0.4;
          m.rotation.x = -sz * 0.4;
        });
      }
    }
    add(new THREE.BoxGeometry(0.055, 0.022, 0.05), glass, lander, (m) => {
      m.position.set(-0.1, 0.05, 0);
    });

    /* Two hundred parts, seven materials, and from here on fourteen draws.
       Separately, because the ring spins and the hub deliberately does not —
       flattening the pair together would weld the crew's gravity to the
       docking ports. See flatten. */
    this.flatten(this.enduranceRing);
    this.flatten(this.enduranceHub);

    this.scene.add(this.voyager);

    /* Follows the ship down to three quarters. This is the figure the chase
       camera stands off by and the telescope frames on, so it is the ship's
       size for every purpose except being tapped. */
    const info: BodyInfo = { key: "voyager", ko: VOYAGER.ko, en: VOYAGER.en, bodyKo: VOYAGER.bodyKo, bodyEn: VOYAGER.bodyEn, to: VOYAGER.to, accent: "#cfe4ff", size: 1.0, primary: false, dive: false };
    // The target a finger has to land on. Held above the ship's own radius of
    // 1.43: a hit sphere that merely matched a shrinking ship would make it
    // harder to tap every time it was made smaller, and the finger has not
    // changed size.
    const hit = this.hitSphere(2.4);
    this.voyager.add(hit);
    this.pickables.push({ object: hit, info, anchor: this.voyager });
    this.addLabel(info, this.voyager);

    /* Where it launches from and where it stops being drawn, both read off the
       system rather than typed in: the innermost figure is Earth's own orbit,
       and the outer one is the edge of the system plus a margin. Hard-coding
       either would mean a planet's radius could be retuned in bodies.ts and
       leave the probe launching from empty space. */
    this.voyagerLaunchRadius = this.planets.find((p) => p.spec.key === "earth")?.spec.radius ?? 50;
    this.voyagerEdge = this.planets.reduce((max, p) => Math.max(max, p.spec.radius), 0);
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

    /* Built whichever tier the scene starts on. It used to be built only when
       the tier of the moment wanted it, and demotion is one-way — so a device
       that opened on the cheap tier, or dipped below the frame-rate threshold
       once at any point, lost the lensing for the rest of the session and
       could never get it back. The aiming carried on perfectly the whole time,
       which is why this looked intermittent rather than switched off. */
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
      // Full frame — see BLOOM_SCALE for why this is not the free win it looks
      // like.
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
      lastOffset: "",
      lastTransform: "",
      lastOpacity: "",
      shown: false,
      distance: 0,
      fade: 0,
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
  /* Both lists are reused across frames rather than rebuilt. This runs sixty
     times a second over a fixed set of labels, and the old version allocated a
     Map, an array and one object per surviving label every time — for a result
     that is thrown away before the next frame starts. The measurements now
     live on the rigs themselves (`shown`, `distance`, `fade`), which is where
     the second pass reads them anyway. */
  private labelRanked: LabelRig[] = [];

  private labelCandidates(camDir: THREE.Vector3, budget: number) {
    const ranked = this.labelRanked;
    ranked.length = 0;
    // Relative to how far the camera itself is sitting, so the fade behaves the
    // same when parked outside Neptune and when flown up against Mercury.
    const orbit = this.camera.position.distanceTo(this.controls.target);
    const reach = orbit + 480;
    let kept = 0;

    for (const label of this.labels) {
      const { info } = label;
      label.shown = false;
      const pinned = this.hovered?.key === info.key || this.selectedKey === info.key;
      if (!info.primary && !pinned) continue;

      label.anchor.getWorldPosition(this.tmpV);
      const toBody = this.tmpV.sub(this.camera.position);
      // Behind the camera: project() still returns a finite point, mirrored.
      if (toBody.dot(camDir) <= 0) continue;

      const distance = toBody.length();
      const fade = 1 - clamp01((distance - reach) / reach);
      if (fade <= 0.02) continue;

      label.distance = distance;
      label.fade = fade;
      if (pinned) {
        label.shown = true;
        kept++;
      } else {
        ranked.push(label);
      }
    }

    ranked.sort((a, b) => a.distance - b.distance);
    for (const label of ranked) {
      if (kept >= budget) break;
      label.shown = true;
      kept++;
    }
  }

  /** Projects every label to screen and writes its transform directly. Runs
   * once a frame; nothing here touches React.
   *
   * Two passes rather than one, because whether a label is shown depends on
   * the *other* labels: on a narrow viewport only the nearest handful survive,
   * and that cannot be decided until all of their distances are known. The
   * first pass measures; the second writes. */
  private updateLabels() {
    // Read off the last resize rather than measured here — see viewW.
    const width = this.viewW;
    const height = this.viewH;
    const halfW = width / 2;
    const halfH = height / 2;
    const camDir = this.camera.getWorldDirection(this.tmpV2);
    const halfFov = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const narrow = width < 760;

    /* A phone cannot hold eleven captions over a solar system without them
       becoming a pile of overlapping pills, and a distance threshold is the
       wrong tool for it — what counts as "far" changes completely between the
       resting view and a body the camera has flown right up to. A hard cap on
       *how many* is stable at every zoom, and nothing is lost: the dock below
       carries the full list, with the same names and the same numbers. */
    const budget = narrow ? 5 : Infinity;
    this.labelCandidates(camDir, budget);

    for (const label of this.labels) {
      const { info } = label;
      if (!label.shown) {
        if (label.visible) {
          label.el.classList.remove("is-on");
          label.visible = false;
        }
        continue;
      }
      const { distance, fade } = label;
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
      const slackX = width * 0.06;
      const slackY = height * 0.06;
      if (rawX < -slackX || rawX > width + slackX || rawY < -slackY || rawY > height + slackY) {
        if (label.visible) {
          label.el.classList.remove("is-on");
          label.visible = false;
        }
        continue;
      }

      // The label is anchored to the right of its body (see .h2-tag's
      // translate in hub2.css), so the right margin has to allow for its own
      // width; 150px covers the longest of them.
      const x = Math.min(Math.max(rawX, 12), width - 150);
      const y = Math.min(Math.max(rawY, 14), height - 14);

      /* Stand the label off by the body's own apparent radius, so it sits
         beside what it names instead of on top of it. A fixed offset works
         for Mercury and buries the black hole's accretion disc under its own
         caption. */
      /* Written only when the value actually changes.
       *
       * Every style write on these elements dirties the overlay's layout, and
       * there are a dozen of them being written three properties each. The
       * transform genuinely does change most frames — the bodies are moving —
       * but the stand-off and the opacity are quantised to a whole pixel and
       * two decimals, and at rest they hold the same value for seconds at a
       * time. Comparing first is much cheaper than writing, and it is the
       * writes that were making the browser re-lay-out the overlay. */
      const apparent = Math.min(Math.max((info.size / distance / halfFov) * halfH + 12, 14), 130).toFixed(0);
      if (apparent !== label.lastOffset) {
        label.el.style.setProperty("--offset", `${apparent}px`);
        label.lastOffset = apparent;
      }
      const transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      if (transform !== label.lastTransform) {
        label.el.style.transform = transform;
        label.lastTransform = transform;
      }
      const opacity = (hovered || selected ? 1 : fade * 0.92).toFixed(2);
      if (opacity !== label.lastOpacity) {
        label.el.style.opacity = opacity;
        label.lastOpacity = opacity;
      }

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

      /* Only the body under the pointer (or held by the camera) says what it
         is; on every other label it stays empty and collapses to nothing.

         The second slot exists to say what a thing IS beside where it GOES —
         토성 next to AI 예측. On a body with no destination there is nowhere to
         go, so both slots carry the body's own name and the label read
         "웜홀 | 웜홀". The useful second thing to say about those is the name
         in English, which is also the one an unfamiliar object most wants
         beside it; and when that is the first slot as well — the same label in
         English — there is nothing left worth saying and the slot goes empty.
         Written as a collision rule rather than a list of which bodies have no
         route, so it covers the telescope and anything added later without
         either of them being named here. */
      let ownName = this.lang === "en" ? info.bodyEn : info.bodyKo;
      if (ownName === text) ownName = info.bodyEn;
      if (ownName === text) ownName = "";
      const bodyText = hovered || selected ? ownName : "";
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
    // The next frame casts immediately: a move is the interaction, and hover
    // that waits for a timer reads as lag. See HOVER_IDLE_INTERVAL.
    this.pointerMoved = true;
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

    if (this.diving) return;
    this.setPointerFromEvent(event);
    const hit = this.pick();
    if (hit) this.tapBody(hit.info);
  };

  private pick(): Pickable | null {
    if (this.pointer.x < -1 || this.pointer.x > 1) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    /* Hidden bodies are not targets. The raycaster does not consult `visible`
       itself, so the probe's hit sphere would go on catching taps for the half
       of its cycle it spends out beyond the system and unrendered.

       Filtered into arrays this call owns and reuses. The pair of throwaway
       arrays this used to build were forty entries each, sixty times a second,
       for a list whose membership changes about twice a minute. */
    this.pickList.length = 0;
    for (const p of this.pickables) if (p.anchor.visible) this.pickList.push(p.object);
    this.pickHits.length = 0;
    const hits = this.raycaster.intersectObjects(this.pickList, false, this.pickHits);
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
    // orbit of Neptune down into the plane.
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
   * a fly-to across the system doesn't whip through 180°.
   *
   * `view` overrides all of that with an explicit angle round the body. Only
   * the tour passes one — a tap wants the predictable framing, because the
   * visitor chose the body and is owed the shot they expected. */
  private framePosition(target: THREE.Vector3, size: number, view?: TourView): THREE.Vector3 {
    const distance = Math.max(size * 6.5, 16);
    const outward = target.clone().setY(0);
    if (outward.lengthSq() < 0.01) outward.set(0, 0, 1);
    outward.normalize();
    const tangent = new THREE.Vector3(-outward.z, 0, outward.x);

    if (view) {
      /* A point on a sphere around the body, in the body's own outward frame
         rather than the world's: azimuth 0 is the far side looking back in at
         the sun, half a turn is the sun-side looking out, and everything
         between is a profile. Anchoring to `outward` rather than to world Z is
         what makes the same azimuth mean the same lighting on Mercury as on
         Neptune — otherwise "the lit side" would be a different number for
         every body and the tour's variety would just be luck. */
      const cosE = Math.cos(view.elevation);
      const dir = outward
        .clone()
        .multiplyScalar(Math.cos(view.azimuth) * cosE)
        .add(tangent.multiplyScalar(Math.sin(view.azimuth) * cosE))
        .add(new THREE.Vector3(0, Math.sin(view.elevation), 0))
        .normalize();
      return target.clone().add(dir.multiplyScalar(distance * view.zoom));
    }

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
   * the eight planets, the moons, the black hole and the neutron binary — with
   * one exception, below.
   *
   * The probe is the exception, and it is one because framing it does not work
   * the way framing a planet does. A planet parked in the middle of the screen
   * is the thing you came to look at; a spacecraft parked in the middle of the
   * screen is a model of a spacecraft. What it is *for* is the journey, so its
   * first tap starts the journey, and the second — available from the button
   * in the HUD, since the craft is under the camera's nose during it — stops
   * it. It has no destination to open on a second tap anyway: `dive` is false
   * and the news page it links to is reached from the dock. */
  tapBody(info: BodyInfo) {
    if (this.diving) return;
    this.cancelFinale();
    if (info.key === "voyager") {
      this.setVoyagerTour(!this.voyagerTour);
      return;
    }
    if (this.selectedKey === info.key) {
      /* Not everything in the sky is a door. The telescope opens a panel and
         the wormhole opens nothing at all, and both carry an empty `to` — so
         the second tap here handed navigate() an empty path, which resolves
         against the current URL and reloads the hub out from under the
         visitor. On a body with nowhere to go, the first tap framing it is
         the whole of the interaction. */
      if (!info.to) return;
      // The second tap. On anything big enough to fall into, the page opens at
      // the end of the fall rather than out from under it.
      if (info.dive && this.diveInto(info)) return;
      this.callbacks.onSelect(info);
      return;
    }
    this.focusOn(info);
  }

  /** The second tap on a body big enough to fall into: drop the camera onto it
   * and open its destination on impact.
   *
   * The move is a flight like any other — it reuses the tween and, critically,
   * the per-frame re-aiming, because a planet keeps orbiting while you fall at
   * it and a dive fixed at take-off lands beside it. What differs is the shape
   * and the end point:
   *
   * - it eases *in*. Every other camera move here settles; this one is still
   *   speeding up when it ends, which is the whole difference between falling
   *   into something and pulling up next to it.
   * - it stops just clear of the surface rather than at framing distance, so
   *   the body fills the frame completely by the end.
   * - the radial streak accelerates with it and converges on the body rather
   *   than on the middle of the screen, which is not the same point until the
   *   last moment.
   * - the last third whites out in the body's own colour, and the page changes
   *   underneath that rather than cutting from a live frame.
   *
   * Returns false when there is nothing to dive at, so the caller can fall
   * back to opening the destination outright. */
  diveInto(info: BodyInfo): boolean {
    const pickable = this.pickables.find((p) => p.info.key === info.key);
    if (!pickable) return false;

    const target = pickable.anchor.getWorldPosition(new THREE.Vector3());
    const dir = this.camera.position.clone().sub(target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();

    /* Stop *outside* the surface, by more than the camera's near plane. Going
       to the centre would be the obvious reading of "dive in" and it is wrong
       twice: the spheres are front-faced, so a camera inside one sees straight
       through the body it was diving into, and anything nearer than near (0.4)
       is clipped away regardless. At size + 0.55 the body subtends well over a
       hundred degrees — it is the entire frame — and it is still being drawn. */
    const stop = info.size + 0.55;

    this.diving = true;
    this.diveTint.set(info.accent);
    this.labelLayer.style.transition = "opacity 0.5s ease-in";
    this.labelLayer.style.opacity = "0";

    this.beginFlight({
      fromPos: this.camera.position.clone(),
      toPos: target.clone().add(dir.multiplyScalar(stop)),
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      t: 0,
      // Long enough to read as a fall, short enough that it is never in the
      // way of someone who just wants the page.
      duration: 1.15,
      // `body` is the dock's on-arrival callback and would fire onSelect a
      // second time; the dive runs its own.
      body: null,
      follow: pickable.anchor,
      dive: info,
    });
    return true;
  }

  /** Frames a body and makes it the camera's pivot. Does not navigate.
   *
   * `view` is the tour's; see framePosition(). */
  focusOn(info: BodyInfo, duration = 1.05, view?: TourView) {
    if (this.diving) return false;
    const pickable = this.pickables.find((p) => p.info.key === info.key);
    if (!pickable) return false;
    // Focusing anything takes the camera off the probe, and out of the hole.
    this.voyagerTour = false;
    this.cancelFinale();

    this.selectedKey = info.key;
    this.followAnchor = pickable.anchor;
    this.callbacks.onFocus(info);

    /* Close enough to fill the frame, but not inside the body itself. This is
       the floor for as long as the camera holds it; updateZoomFloor() reads it
       rather than replacing it. */
    this.focusFloor = Math.max(info.size * 1.7, 2.2);

    const target = pickable.anchor.getWorldPosition(new THREE.Vector3());
    this.followPrev.copy(target);
    this.beginFlight({
      fromPos: this.camera.position.clone(),
      toPos: this.framePosition(target, info.size, view),
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
    // Not false: false tells the shell to navigate outright, and a dive is
    // already on its way to a destination of its own.
    if (this.diving) return true;
    const pickable = this.pickables.find((p) => p.info.key === key);
    if (!pickable) return false;
    const info = pickable.info;
    this.voyagerTour = false;
    this.cancelFinale();

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

  /** Flies to the telescope and holds it. Its own method rather than a
   * selectByKey call, because selecting a body navigates and this one has
   * nowhere to go — the observation panel is where it leads. */
  focusHubble(): boolean {
    if (this.diving || !this.hubble || !this.hubbleInfo) return false;
    /* Everything the telescope can point at has to exist before the list is
       drawn. On the cheap tier the moons were never built and a demotion drops
       the ones that were, so without this half the observation menu is buttons
       with nothing behind them. Paid once, here, by someone who has opened the
       tool for looking at them. */
    this.ensureMoons();
    this.voyagerTour = false;
    this.tourEnabled = false;
    this.cancelFinale();
    this.selectedKey = "hubble";
    /* Held, not just flown to. Without this the camera arrives and then stands
       still while the telescope carries on round with Earth, and the thing it
       was aimed at drifts out of frame within a second or two — which is what
       "loses focus" was. updateFollow moves the whole rig by however far the
       anchor moved each frame, so the visitor's own angle and zoom survive. */
    this.followAnchor = this.hubble;
    const target = this.hubble.getWorldPosition(new THREE.Vector3());
    this.callbacks.onFocus(this.hubbleInfo);
    this.beginFlight({
      fromPos: this.camera.position.clone(),
      toPos: this.framePosition(target, this.hubbleInfo.size),
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      t: 0,
      duration: 1.25,
      body: this.hubbleInfo,
      follow: this.hubble,
    });
    return true;
  }

  /** Points the telescope at a body and takes the camera in to look at it.
   *
   * `frame` is how far back to sit, in multiples of the body's drawn radius,
   * and it comes from the observation table rather than from one constant.
   * "Fills the view" is not a single number: Saturn has rings to fit in, the
   * black hole has a disc five times its horizon, and the neutron star sits at
   * the centre of an ejecta cloud twenty times its own reach. Framed alike,
   * two of those would be off the edge and one would be a dot.
   *
   * The camera is left free afterwards — this sets a viewpoint, it does not
   * hold one, so the visitor can zoom in and out from wherever it lands.
   */
  observe(key: string, frame: number): boolean {
    if (this.diving) return false;
    const pickable = this.pickables.find((p) => p.info.key === key);
    if (!pickable) return false;
    this.voyagerTour = false;
    this.tourEnabled = false;
    this.cancelFinale();

    const info = pickable.info;
    // Asked for the moment the target is chosen, so it has the whole flight to
    // arrive rather than starting to download once the camera has stopped.
    this.loadHighRes(info.key);
    this.selectedKey = info.key;
    // Ride it, like the telescope above — a planet observed from a standstill
    // walks out of frame along its own orbit.
    this.followAnchor = pickable.anchor;
    const target = pickable.anchor.getWorldPosition(new THREE.Vector3());
    // Aimed before the camera moves, so the telescope has begun to swing by
    // the time the flight arrives.
    this.hubbleAim.copy(target);
    this.callbacks.onFocus(info);

    /* Straight out from the body toward where the camera already is, lifted a
       little. Face-on rather than edge-on: the request is to see the whole of
       a thing, and a body's own outward direction is the one view where
       nothing about it is foreshortened. */
    const away = target.clone().sub(this.camera.position);
    const dir = away.lengthSq() > 1e-4 ? away.normalize().negate() : new THREE.Vector3(0, 0, 1);
    dir.y += 0.18;
    dir.normalize();
    /* No absolute floor worth the name.
     *
     * This carried `Math.max(…, 12)`, borrowed from framePosition, where a
     * floor makes sense because it frames destinations you are about to fly
     * into. Here it defeated the whole point on anything small: a moon is
     * between a third and one scene unit across, so its framing distance works
     * out at two or three units and was then raised to twelve. The camera did
     * move — it just stopped far enough away that the moon was a dot, which
     * from the outside looks exactly like nothing having happened.
     *
     * The remaining floor is only there to keep the camera outside the body
     * itself. */
    const distance = Math.max(info.size * frame, info.size * 2.2, 1.4);

    // The zoom floor has to come down with it, or a body framed at close range
    // cannot then be zoomed into at all.
    // Scaled to the body for the same reason: a fixed floor of 2 would sit
    // outside a small moon's whole framing distance and stop the visitor
    // zooming in on it at all.
    this.focusFloor = Math.max(info.size * 1.3, 0.8);
    /* Deliberately no `body` on this flight.
     *
     * updateFlight calls onSelect with it on arrival, and onSelect navigates —
     * so a flight carrying a body is a flight that ends on another page. That
     * is right for tapping a planet in the sky, and wrong here: choosing
     * Mercury from the observation list was flying to it and then leaving for
     * Mercury's page a second later, before it could be looked at at all.
     * Observing is looking; going somewhere is a second, separate press. */
    this.beginFlight({
      fromPos: this.camera.position.clone(),
      toPos: target.clone().add(dir.multiplyScalar(distance)),
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      t: 0,
      duration: 1.35,
      // Explicitly null, not omitted: this is the field that decides whether
      // arriving also means leaving. See the note above.
      body: null,
      follow: pickable.anchor,
    });
    return true;
  }


  /* ── high-resolution maps, fetched only when something is looked at ──

     Every body ships a 900x450 map, which is right for a planet a few pixels
     wide in a wide shot and visibly soft the moment the observation panel
     fills the screen with one. The obvious fix — ship bigger maps — makes
     everyone pay several megabytes on arrival for detail almost nobody scrolls
     in far enough to see, and bandwidth is the constraint this project has
     been most careful about.

     So the big map is a second file that is fetched the first time a body is
     actually observed, and swapped into the material it belongs to when it
     lands. Nobody who never opens the telescope downloads a byte of it; nobody
     who observes Europa downloads Titan's.

     A miss is not an error. If a body has no high-resolution file the fetch
     fails, the base map stays, and the only consequence is that it looks the
     way it looked before. */

  /** Bodies whose big map is already loaded or in flight, so a visitor
   * flicking between two targets does not queue the same download twice. */
  private hiResAsked = new Set<string>();

  /** Swaps in the detailed map for a body, if there is one.
   *
   * `key` is the pickable key, which for a moon is `host:moon`; the file is
   * named after the texture the body already uses, so the two cannot drift
   * apart the way a second hand-written list would. */
  private loadHighRes(key: string) {
    if (this.hiResAsked.has(key)) return;

    let material: THREE.ShaderMaterial | undefined;
    let base: string | undefined;
    const [hostKey, moonKey] = key.split(":");
    if (moonKey) {
      const host = this.planets.find((p) => p.spec.key === hostKey);
      const moon = host?.moons.find((m) => m.spec.key === moonKey);
      material = moon?.material;
      base = moon?.spec.texture;
    } else {
      const planet = this.planets.find((p) => p.spec.key === key);
      material = planet?.material;
      base = planet?.spec.texture;
    }
    // Bodies drawn by their own shaders rather than a surface map — the star,
    // the hole, the neutron pair — have nothing to swap.
    if (!material || !base) return;

    this.hiResAsked.add(key);
    const file = base.replace("/img/planets/", "/img/planets/hi/");
    new THREE.TextureLoader().load(
      file,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        this.textures.push(tex);
        material.uniforms.uMap.value = tex;
      },
      undefined,
      () => {
        /* No such file, or it would not decode. The base map is already on
           screen and stays there — this is a body that simply has no detailed
           version yet, which is a normal state and not a failure to report. */
      }
    );
  }

  /** Builds any moons this session has not got, and shows the ones it has.
   *
   * Moons are skipped on the cheap tier and hidden by a demotion, which is the
   * right default: they are thirteen extra bodies and their textures, and the
   * entrance page has to hold its frame rate on a phone. But it makes the
   * observation list a lie — half its entries had nothing behind them, and
   * choosing one did nothing.
   *
   * So the cost is moved rather than removed. Nobody pays it for arriving at
   * the page; it is paid once, by someone who has opened a tool whose entire
   * purpose is to look at these things. `moonsPinned` then stops a later
   * demotion taking them away again mid-session — having asked for them, a
   * visitor should not watch them vanish.
   */
  ensureMoons() {
    for (const planet of this.planets) {
      if (!planet.spec.moons) continue;
      if (planet.moons.length === 0) {
        for (const moon of planet.spec.moons) {
          planet.moons.push(this.buildMoon(moon, planet.axis, planet.spec));
        }
      }
      for (const moon of planet.moons) {
        moon.pivot.visible = true;
        /* Belt and braces. Nothing strips a moon from the picker any more, but
           a body the picker has never heard of cannot be observed however
           visible it is, and this is the one call that promises it can. */
        if (!this.pickables.some((p) => p.info.key === moon.info.key)) {
          this.pickables.push({ object: moon.hit, info: moon.info, anchor: moon.holder });
        }
      }
    }
  }

  /** Which bodies are actually in the scene right now, for the observation
   * list to tell the truth with.
   *
   * Not every body always exists. Moons are built only on the two upper
   * quality tiers, and a demotion hides the ones that were built — so on a
   * phone the ten moons on that menu are ten buttons with nothing behind
   * them. Rather than let them fail silently, the menu asks. */
  renderedKeys(): Set<string> {
    const keys = new Set<string>();
    for (const p of this.pickables) {
      /* Up the whole chain, not just the object's own flag. A demotion hides a
         moon by switching off its PIVOT, and the anchor hanging under it keeps
         `visible === true` the entire time — an object is drawn only if it and
         every ancestor is visible, so that is what has to be asked. */
      let node: THREE.Object3D | null = p.anchor;
      let shown = true;
      while (node) {
        if (!node.visible) {
          shown = false;
          break;
        }
        node = node.parent;
      }
      if (shown) keys.add(p.info.key);
    }
    return keys;
  }

  /** Dock hover: highlight only. Never moves the camera. */
  focusByKey(key: string | null) {
    if (this.diving) return;
    if (this.selectedKey && this.followAnchor) return; // a real focus outranks a hover
    this.selectedKey = key;
  }

  /** Back to the whole system, and hand the pivot back to the sun. */
  resetCamera() {
    if (this.diving) return;
    // Assigned rather than routed through setVoyagerTour, which calls this.
    this.voyagerTour = false;
    this.cancelFinale();
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
    // Two things that both drive the camera; the one just asked for wins.
    if (on) this.voyagerTour = false;
    // Switching the tour off in the middle of its ending has to give the
    // picture back, or the screen stays black with nothing left to clear it.
    if (!on) this.cancelFinale();
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
    if (!this.tourEnabled || this.diving) return;
    // The ending runs on its own clock and is not a stop with a timer.
    if (this.finaleT >= 0) return;
    this.tourTimer -= dt;
    if (this.tourTimer > 0) return;
    this.tourTimer = HubScene.TOUR_INTERVAL;

    this.tourIndex = (this.tourIndex + 1) % TOUR_ORDER.length;
    const pickable = this.pickables.find((p) => p.info.key === TOUR_ORDER[this.tourIndex]);
    // A body the current quality tier dropped (moons at the low tier) simply
    // is not there to visit; skip to the next tick rather than stalling.
    if (!pickable) return;

    /* The hole is the last stop and it is not a stop. Rather than framing it
       for ten seconds and moving on, the tour goes in — see updateFinale. */
    if (pickable.info.key === "blackhole") {
      this.beginFinale();
      return;
    }

    /* A tour looks, it does not navigate — which is exactly what focusing a
       body does, so it goes through the same path and inherits the follow
       behaviour: the camera rides each planet along its orbit for the whole
       time it is parked there. */
    this.focusOn(pickable.info, HubScene.TOUR_FLIGHT, this.tourView());
  }

  /* ─────────────────────── the tour's ending ───────────────────────
     Several turns around the accretion disc, then in.

     The reference the visitor will have is the fall at the end of Interstellar,
     and what that scene actually does — the part worth copying — is refuse to
     cut. It is one continuous move: a wide orbit that closes, a horizon that
     stops being a shape in the frame and becomes the frame, and then nothing.
     So this is not a sequence of shots either. One camera, one path, and the
     three phases below run into each other rather than beginning.

     Phase one, the orbit: three turns around the disc while the radius closes
     and the camera sinks toward the disc's own plane. Sinking is what does the
     work — from above, an accretion disc is a bright ring; edge-on it is the
     lensed double image the whole scene was built for, and arriving at that
     angle by descending into it is worth more than starting there.

     Phase two, the fall: the radius collapses on an accelerating curve and the
     angular rate climbs as it does, which is an inspiral and also simply what
     happens when something falls in — the closer it gets the faster it goes
     round. The streak pass rises with it, and the picture starts going out
     before the camera arrives.

     Phase three, black. Held, because a blackout that ends the instant it is
     complete was a transition; one that sits there for a second was an event.
     Then the camera is put back at the resting view and the picture returns. */

  /** Seconds of orbiting before the fall. */
  private static readonly FINALE_ORBIT = 17;
  /** Seconds of falling. */
  private static readonly FINALE_FALL = 7.5;
  /** Seconds of dead channel between the fall and the plate. Long enough for
   * the snow to build from nothing to unwatchable, short enough that it is
   * clearly a thing happening rather than a thing that has broken. */
  private static readonly FINALE_BLACK = 2.2;
  /** Seconds the plate is held on the far side of it. */
  private static readonly FINALE_PLATE = 5;
  /** Seconds to bring the picture back. */
  private static readonly FINALE_RETURN = 2.4;
  private static readonly FINALE_FALL_END = HubScene.FINALE_ORBIT + HubScene.FINALE_FALL;
  private static readonly FINALE_BLACK_END = HubScene.FINALE_FALL_END + HubScene.FINALE_BLACK;
  private static readonly FINALE_PLATE_END = HubScene.FINALE_BLACK_END + HubScene.FINALE_PLATE;
  private static readonly FINALE_END = HubScene.FINALE_PLATE_END + HubScene.FINALE_RETURN;

  private beginFinale(mode: FinaleMode = "hole") {
    this.finaleT = 0;
    this.finaleAngle = 0;
    this.finaleMode = mode;
    this.selectedKey = mode === "hole" ? "blackhole" : "wormhole";
    this.followAnchor = null;
    // It drives the camera itself, frame by frame, so nothing else may be.
    this.flight = null;
    this.controls.enabled = false;
    this.controls.autoRotate = false;
    this.finaleFrom.copy(this.camera.position);
    this.callbacks.onFocus(null);
  }

  /** Stops the ending wherever it is and gives the picture and the controls
   * back. Anything that takes the camera calls this. */
  private cancelFinale() {
    if (this.finaleT < 0) return;
    this.finaleT = -1;
    this.clearFinaleEffects();
    this.setCurtain(false);
    this.controls.enabled = true;
  }

  /** Every full-frame effect either ending can leave running. One list rather
   * than two, because the two endings do not use the same subset and the way
   * to get that wrong is to write the subset out twice. */
  private clearFinaleEffects() {
    this.fade = 0;
    this.warp = 0;
    this.collapse = 0;
    this.plate = 0;
    this.tvStatic = 0;
    this.tunnel = 0;
    this.tunnelMouth = 0;
    this.insideHole = 0;
    this.diveFlash = 0;
  }

  /** Tells the shell to hide or restore its HUD, once per change. */
  private setCurtain(on: boolean) {
    if (on === this.curtain) return;
    this.curtain = on;
    this.callbacks.onCurtain(on);
  }

  /** One frame of it. Runs on the camera directly rather than through a
   * flight, because a flight is a move between two fixed points and this is a
   * path — there is no `toPos` for "three times around and then in". */
  /* ─────────────── the probe's ending: through, and out the far side ───────
     The auto tour's ending above is one continuous move into the hole. This
     one is a journey, and the difference is the point: the probe does not fall
     into anything at Saturn, it goes through something and comes out
     somewhere else. Eight movements, and the joins between them are all doing
     the same job — never cut on a live frame. Every hand-off is covered by a
     whiteout, a mouth swallowing the lens, or a blackout that was already
     happening.

       hold      4    it is a bright ring a long way off, and stays one
       close    13    closing hard: the beat that says how big it is
       hug      10    skimming its glass, where the sky inside can be seen moving
       enter     3    round and in
       tunnel   10    inside it, first person, riding across the passage
       space    12    out the far side, closing until the hole is half the frame
       disc     25    down onto the sheet and across it, at a metre above
       inside    4.5  past the horizon: flashes, and light with no source
       static    7    the dead channel, which is the auto tour's own
       plate     5    the far side, held, with the stone dropped in it
       return    2.4  the picture comes back

     Ninety-six seconds. Thirty of them are the arrival and twenty-five are
     the crossing, which is the shot the whole ending exists to get to. That is
     deliberate and it is the change this ending most needed: the wormhole is
     two units across and the first cut at this gave it three seconds, which
     is long enough to identify a thing and not long enough to look at one.
     The interior turns, drifts and shears on its own clock, and none of that
     is visible from a camera that is only ever closing on it. */
  /* The arrival's three movements have no constants of their own: it is one
     continuous curve over WF_T_DIVE seconds and the movements are names for
     stretches of it, not phases with boundaries. See the note where it is
     driven for what writing them as three separate phases cost. */
  private static readonly WF_TUNNEL = 10;
  private static readonly WF_SPACE = 12;
  private static readonly WF_DISC = 25;
  private static readonly WF_INSIDE = 4.5;
  private static readonly WF_STATIC = 7;
  private static readonly WF_PLATE = 5;
  private static readonly WF_RETURN = 2.4;
  private static readonly WF_T_DIVE = 30;
  private static readonly WF_T_TUNNEL = 40;
  private static readonly WF_T_SPACE = 52;
  private static readonly WF_T_DISC = 77;
  private static readonly WF_T_INSIDE = 81.5;
  private static readonly WF_T_STATIC = 88.5;
  private static readonly WF_T_PLATE = 93.5;
  private static readonly WF_END = 95.9;

  private updateWormholeFinale(dt: number) {
    const t = this.finaleT;
    /* The HUD goes early here, and earlier than the picture starts breaking
       up. The arrival is twenty-five seconds of looking at one object, and a
       ring of destination labels floating over it for all of them is the sky
       still trying to be a menu while the tour is trying to be a film. */
    this.setCurtain(t > 1.5);

    /* Everything off by default and switched on by the branch that wants it.
       Eight movements each setting six effects is where a state machine grows
       the bug that one phase leaves something on for the next one. */
    this.warp = 0;
    this.collapse = 0;
    this.fade = 0;
    this.tunnel = 0;
    this.insideHole = 0;
    this.tvStatic = 0;
    this.plate = 0;

    if (t < HubScene.WF_T_DIVE) {
      /* The arrival, in three movements, all of them on one circle around the
         wormhole so that they run into each other rather than beginning.
         `finaleAngle` carries across all three and only its rate changes.

         The circle is built on the world axes and centred on the live world
         position rather than on a frame captured at the start. The wormhole
         rides Saturn, and Saturn covers a good fraction of its orbit in
         twenty-five seconds — pinned to where it was, this would be an arc
         around a point it had long since left. */
      /* Fresh, not last frame's. updateWormhole runs after this in the frame,
         so the cached world position is one frame behind — and the wormhole
         is riding Saturn at about fourteen units a second, so a frame of lag
         is a real offset that changes with the frame rate. */
      const wh = this.wormhole.getWorldPosition(this.tmpV);
      const ax = this.jetSideA.set(1, 0, 0);
      const up = this.jetAxis.set(0, 1, 0);
      const az = this.jetSideB.set(0, 0, 1);
      this.focusFloor = 0.2;
      this.diveTint.setRGB(0.82, 0.92, 1.0);

      /* One curve for the whole arrival rather than three movements with
         their own numbers.
         Written as three, it lurched twice: the approach ended at radius 7
         and the rim began at 6.4, the lift stepped from 1.2 to 1.5, and the
         angular rate nearly doubled at the same instant — three
         discontinuities inside two frames, which is exactly what "it shakes"
         looks like. The rim also rose and fell on a cosine, so the sphere
         swung up and down the frame while the aim point rotated under it.
         Everything below is continuous in t, and the only thing that
         accelerates is the dive. */
      const s = t / HubScene.WF_T_DIVE;
      /* Three beats out of one curve, and the shape of the curve is the whole
         drama:

           hold    the first eighth barely closes at all. The wormhole is a
                   small bright ring a long way off and the camera has time to
                   let it be one — an arrival that starts arriving on frame one
                   never establishes anything to arrive at.
           close   the middle closes hard, and this is the beat that says how
                   big it is. The sphere goes from something in the frame to
                   something the frame cannot hold, and scale is a rate of
                   change rather than a size: it reads as huge because it grew,
                   not because it is wide.
           hug     the last quarter before the dive holds at 2.9 against a
                   surface at 2.17 — seven tenths of a unit off the glass. At
                   that range the star sheets inside separate and drift past
                   each other, which is the only place in the sequence where
                   the surface can be seen to move at all. */
      const close = smoothstep(0.12, 0.72, s);
      const hug = smoothstep(0.66, 0.88, s);
      const plunge = clamp01((s - 0.9) / 0.1);
      const ring = 22 - 18.6 * close - 0.5 * hug;
      const radius = ring * (1 - plunge) + 0.2 * plunge;
      const lift = (6.0 - 5.5 * close) * (1 - plunge * 0.9);
      /* Slow while it is far, quickest while it is skimming. The sphere fills
         the frame by then, so angular rate is what the surface streaming past
         is made of — at the far end the same rate would only spin the sky. */
      this.finaleAngle += (0.2 + 0.34 * close + 0.5 * hug + plunge * 3.4) * dt;

      /* Looking along the edge rather than at the middle of it, and back at
         the centre for the dive. Scaled by the radius rather than fixed: the
         point of the offset is to put the sphere off to one side of the frame
         by a constant fraction of its own apparent size, and a constant offset
         does that at one distance only — at 22 units it was a wobble and at 3
         it pointed the camera off the sphere entirely. It turns at the rate
         the camera does, so in the frame it is a fixed offset and the sphere
         sits still off to one side rather than drifting across. */
      const aim = radius * 0.46 * smoothstep(0.36, 0.56, s) * (1 - smoothstep(0.82, 0.92, s));

      this.warp = Math.pow(plunge, 1.6) * 5.5;
      this.collapse = Math.pow(plunge, 2.0) * 0.5;
      // The whiteout that covers the join. Cold, because what it goes into is.
      this.diveFlash = smoothstep(0.55, 1.0, plunge) * 2.2;

      const cos = Math.cos(this.finaleAngle);
      const sin = Math.sin(this.finaleAngle);
      const want = this.tmpV2
        .copy(wh)
        .addScaledVector(ax, cos * radius)
        .addScaledVector(az, sin * radius)
        .addScaledVector(up, lift);
      /* Eased in from wherever the chase left the camera over the first two
         seconds, for the same reason the other ending does it: the one thing
         this must not do is cut. */
      const blend = clamp01(t / 2.0);
      this.camera.position.lerpVectors(this.finaleFrom, want, blend * blend * (3 - 2 * blend));
      /* Looking along the rim rather than at the middle of it, while it is
         riding one. Offset across the direction of travel, the sphere sits to
         one side and its edge sweeps the frame — dead centre, the brightest
         thing the wormhole has is a circle being stared at rather than an
         edge being ridden. */
      this.controls.target
        .copy(wh)
        .addScaledVector(ax, -sin * aim)
        .addScaledVector(az, cos * aim);
    } else if (t < HubScene.WF_T_TUNNEL) {
      /* Inside. The frame belongs entirely to the passage — see passage() in
         GRADE_SHADER for why there is no tube in the scene — so the camera is
         only parked somewhere harmless and the ride is done with uLean.

         Two rates on each axis rather than one, so the path through the
         passage never repeats and never settles into a circle. That is what
         the eye is actually reading: a single sine is a pendulum, and a
         pendulum reads as the camera being swung rather than flown. */
      const s = (t - HubScene.WF_T_DIVE) / HubScene.WF_TUNNEL;
      this.camera.position.copy(this.wormholeWorld);
      this.controls.target.copy(this.wormholeWorld).addScaledVector(HubScene.UP, 1);
      // Up over the first third of a second, out of the flash it arrives in.
      this.tunnel = clamp01((t - HubScene.WF_T_DIVE) / 0.33);
      this.diveFlash = Math.max(0, 2.2 - (t - HubScene.WF_T_DIVE) * 7);
      const w = t * 1.0;
      this.tunnelLean[0] = (Math.sin(w * 0.83) * 0.62 + Math.sin(w * 1.41 + 2.1) * 0.38) * 0.14;
      this.tunnelLean[1] = (Math.cos(w * 0.67 + 0.8) * 0.6 + Math.sin(w * 1.13 + 1.2) * 0.4) * 0.12;
      /* The far end opens over the last two seconds and takes the frame with
         it, which is the cut to the other side — the whiteout is the mouth,
         not a dissolve laid over one. */
      this.tunnelMouth = clamp01((s - 0.8) / 0.2);
      this.warp = this.tunnelMouth * 2.4;
    } else if (t < HubScene.WF_T_SPACE) {
      /* Out. First person, in open sky, with the hole ahead and closing.
         No craft in the frame from here on: the probe went in and this is
         what it is seeing, which is the only reading under which coming out
         somewhere else makes sense. */
      const s = (t - HubScene.WF_T_TUNNEL) / HubScene.WF_SPACE;
      const ease = s * s * (3 - 2 * s);
      const e = this.holeGroup.matrixWorld.elements;
      const side1 = this.jetSideA.set(e[0], e[1], e[2]).normalize();
      const axis = this.jetAxis.set(e[4], e[5], e[6]).normalize();

      /* Standing between the star and the hole, looking outward.
       *
       * Which side matters, and it took a frame of this to see why. Placed on
       * the hole's own frame at an arbitrary angle, the camera ended up
       * looking back across the system — and Saturn, its rings and the
       * wormhole itself sat in the bottom of the shot. The whole reading of
       * this movement is that the probe has come out somewhere else; it
       * cannot have, with the place it left in the corner of the frame.
       *
       * Square to the star-to-hole line, and slightly inside it. Two tries
       * got this wrong in opposite ways and both were instructive. Sunward
       * along that line overshoots: the hole is only 266 units from the star,
       * so a 290-unit stand-off puts the camera past the star and inside the
       * system, with Saturn's rings filling the bottom of the frame. Outward
       * along it is worse — the star and all eight orbits then sit directly
       * behind the subject, and the shot becomes a group portrait of the place
       * the probe is supposed to have left.
       *
       * Perpendicular puts the system off the side of the view instead: 51°
       * off the axis at the start of the movement, and behind the camera
       * altogether by the end of it. The small sunward component is what does
       * the second half of that, and it is small enough that the camera still
       * sits outside Neptune's orbit the whole way in. */
      const out = this.tmpV3.copy(this.holeWorld).normalize();
      const perp = this.jetSideB.copy(axis).cross(out).normalize();
      /* In to 30 units rather than 95. At 95 the horizon subtends eight
         degrees and the hole is a dot with a bright ring; at 30 it subtends
         twenty-five, which against a fifty-degree field is half the frame —
         and half the frame is the point at which a black hole stops being an
         object in a shot and becomes the shot. */
      const radius = 300 - 270 * ease;
      this.camera.position
        .copy(this.holeWorld)
        .addScaledVector(perp, radius * 0.8)
        .addScaledVector(out, -radius * 0.6)
        .addScaledVector(axis, 26 - 18 * ease);
      /* Not locked dead centre on it. A first-person shot with its subject
         pinned to the middle of the frame for ten seconds is a tripod, and
         the one thing this is not is mounted. */
      this.controls.target
        .copy(this.holeWorld)
        .addScaledVector(side1, Math.sin(t * 0.41) * 7)
        .addScaledVector(axis, Math.cos(t * 0.33) * 5);
      this.tunnel = 0;
      this.warp = Math.pow(s, 3) * 0.5;
      this.focusFloor = 0.35;
    } else if (t < HubScene.WF_T_DISC) {
      /* Down onto the disc and round it. The height goes almost to nothing,
         so the camera is skimming the sheet rather than looking down on it —
         which is the only way the disc reads as the moving, rippling thing it
         is drawn as. Anything above a few units and it is a bright ring again. */
      const s = (t - HubScene.WF_T_SPACE) / HubScene.WF_DISC;
      const e = this.holeGroup.matrixWorld.elements;
      const side1 = this.jetSideA.set(e[0], e[1], e[2]).normalize();
      const axis = this.jetAxis.set(e[4], e[5], e[6]).normalize();
      const side2 = this.jetSideB.set(e[8], e[9], e[10]).normalize();

      /* Over the disc rather than around it.
       *
       * This was an orbit that looked at the middle the whole way, which
       * shows the disc as a ring you are circling — a thing seen from
       * outside. What it should be is the Endurance's dive: a craft down on
       * the sheet, running over it the way a boat runs over water, with the
       * hole ahead and getting nearer. Three things make that difference and
       * none of them is the path's radius.
       *
       * Low. The sheet is flat and at height zero, so at four units and
       * closing the disc fills the bottom of the frame and streams underneath
       * instead of sitting across the middle of it.
       *
       * Weaving. The radius carries a slow in-and-out on top of the closing,
       * so the craft wanders over the sheet rather than tracking one circle
       * of it — which is the whole of "exploring" as a camera move.
       *
       * And looking AHEAD, not at the centre. That is the one that matters:
       * aimed at the middle, everything streams outward from the far side of
       * the frame and the shot reads as an orbit however low it is. Aimed
       * along the track and down, the surface runs at you and past you. */
      /* Twenty seconds, and shaped like a crossing rather than a descent:
         a long way out and high enough to see how far it goes, then down onto
         it, then across it at a metre or two for most of the movement, then
         in. The sheet reaches 43 units now, so at the start the far edge is
         beyond anything the eye can resolve and what is under the camera is a
         plane running away in every direction — which is the only way a flat
         ring becomes an open sea.

         The angular rate is deliberately low and nearly constant. This is the
         one movement in the ending that is not accelerating toward anything:
         it is a glide, and a glide that speeds up is a fall. */
      this.finaleAngle += (0.30 + 0.34 * s) * dt;
      const plunge = clamp01((s - 0.86) / 0.14);
      const descend = smoothstep(0.0, 0.34, s);
      const run = smoothstep(0.26, 0.92, s);
      // 46 out to 13, with a slow weave over the top of the closing so the
      // craft wanders across the sheet rather than tracking one circle of it.
      const ring = 46 - 33 * run + Math.sin(s * Math.PI * 3.1) * 7.0 * (1 - s * 0.55);
      const radius = ring * (1 - plunge) + 5.0 * plunge;
      /* Down from fourteen to a metre and a half. The first third is the only
         part of this shot with any altitude in it and it is what establishes
         the scale — from down on the deck a plane and a wall look the same. */
      /* Down from eighteen to two. Two rather than one and a half, because
         the sheet has a thickness now and the camera has to fly over the slab
         rather than through it. */
      /* Down from fifteen to five. Five rather than two, because the sheet is
         no longer a plate: its outer rim is five units of gas thick, and a
         camera at two would be inside it rather than over it. */
      const height = (15.0 - 10.0 * descend) * (1 - plunge * 0.92);
      const cosA = Math.cos(this.finaleAngle);
      const sinA = Math.sin(this.finaleAngle);
      const want = this.tmpV2
        .copy(this.holeWorld)
        .addScaledVector(side1, cosA * radius)
        .addScaledVector(side2, sinA * radius)
        .addScaledVector(axis, height);
      /* Eased in from wherever the approach left the camera. This join was a
         cut: the approach ends on its own frame at its own radius and this
         movement begins on the hole's, and the two are nowhere near each
         other — every other seam in this ending is covered by a whiteout or a
         blackout and this one is covered by nothing at all. */
      const join = clamp01((t - HubScene.WF_T_SPACE) / 2.2);
      this.camera.position.lerp(want, join * join * (3 - 2 * join));

      /* The look-ahead point: along the track and inward, on the sheet
         itself. It closes on the middle as the plunge takes over, so the last
         seconds of the movement are the camera turning to face what it has
         been running across — which is the turn the whole crossing is for.
         Further ahead than it was, because the shot is longer and slower: at
         0.85 radians the horizon sat off to one side, and what this needs is
         to be looking down the track. */
      const look = this.finaleAngle + 1.15 * (1 - plunge);
      const lookR = ring * 0.62 * (1 - plunge);
      this.controls.target
        .copy(this.holeWorld)
        .addScaledVector(side1, Math.cos(look) * lookR)
        .addScaledVector(side2, Math.sin(look) * lookR);
      this.warp = Math.pow(s, 2.2) * 2.2 + plunge * 3.0;
      /* Held well under the fall's until the plunge, because this movement
         has to stay legible to the end of the ring: the aperture is what eats
         the disc, and the disc is what these eight seconds are for. */
      this.collapse = Math.pow(s, 2.0) * 0.3 + plunge * plunge * 0.55;
      this.focusFloor = 0.2;
    } else if (t < HubScene.WF_T_INSIDE) {
      /* Past it. The scene is gone — the camera is at the centre of a thing
         nothing comes out of — and what fills the frame is inside(). The
         collapse is let go on the way in: it is the winding of a picture, and
         by now there is no picture to wind. */
      const s = (t - HubScene.WF_T_DISC) / HubScene.WF_INSIDE;
      this.camera.position.copy(this.holeWorld);
      this.controls.target.copy(this.holeWorld).addScaledVector(HubScene.UP, 1);
      this.collapse = 0.72 * (1 - clamp01(s * 3));
      this.insideHole = clamp01(s * 5) * (1 - clamp01((s - 0.82) / 0.18));
      // And out into the dark the static comes up from.
      this.fade = clamp01((s - 0.84) / 0.16);
    } else if (t < HubScene.WF_T_STATIC) {
      const s = (t - HubScene.WF_T_INSIDE) / HubScene.WF_STATIC;
      this.fade = 1;
      this.tvStatic = s * s;
      this.camera.position.copy(this.restPosition());
      this.controls.target.set(0, 0, 0);
      this.selectedKey = null;
      this.focusFloor = 14;
    } else if (t < HubScene.WF_T_PLATE) {
      const s = (t - HubScene.WF_T_STATIC) / HubScene.WF_PLATE;
      this.fade = 1;
      this.ripple = t - HubScene.WF_T_STATIC;
      this.plate = 1 - clamp01((s - 0.8) / 0.2);
      this.camera.position.copy(this.restPosition());
      this.controls.target.set(0, 0, 0);
    } else {
      const s = (t - HubScene.WF_T_PLATE) / HubScene.WF_RETURN;
      this.fade = 1 - s * s * (3 - 2 * s);
      this.camera.position.copy(this.restPosition());
      this.controls.target.set(0, 0, 0);
    }

    this.finaleTail(HubScene.WF_END);
  }

  private updateFinale(dt: number) {
    if (this.finaleT < 0) return;
    this.finaleT += dt;
    if (this.finaleMode === "wormhole") {
      this.updateWormholeFinale(dt);
      return;
    }
    const t = this.finaleT;

    /* The HUD goes as soon as the picture starts going, not when the plate
       appears. By the time the fall is half dark the labels are the brightest
       things on screen, and an ending that dims everything except its own
       chrome reads as the page having crashed behind the chrome. */
    this.setCurtain(t > HubScene.FINALE_ORBIT + HubScene.FINALE_FALL * 0.35);

    this.holeGroup.getWorldPosition(this.tmpV);
    const hole = this.tmpV;
    /* The hole's own frame, off its world matrix — the same three columns the
       jet uses. The orbit has to be in the disc's plane rather than the
       world's, or "sinking toward the disc" would only be true for a hole that
       happened to be sitting level. */
    const e = this.holeGroup.matrixWorld.elements;
    const side1 = this.jetSideA.set(e[0], e[1], e[2]).normalize();
    const axis = this.jetAxis.set(e[4], e[5], e[6]).normalize();
    const side2 = this.jetSideB.set(e[8], e[9], e[10]).normalize();

    let radius: number;
    let height: number;
    let rate: number;

    if (t < HubScene.FINALE_ORBIT) {
      const s = t / HubScene.FINALE_ORBIT;
      // Closing, but only to about half — the fall is what covers the rest.
      radius = 96 - 50 * s * s;
      // Down out of the overhead view and into the disc's plane.
      height = 34 * Math.pow(1 - s, 1.7) + 3;
      // Three turns, easing in so the first one is a drift and the last is not.
      rate = ((Math.PI * 2 * 3) / HubScene.FINALE_ORBIT) * (0.45 + s * 1.1);
      this.warp = 0;
      this.fade = 0;
      // A hint of it in the last few seconds of the orbit, so the fall does not
      // begin at the same instant the picture starts coming apart.
      this.collapse = clamp01((s - 0.72) / 0.28) * 0.14;
    } else if (t < HubScene.FINALE_ORBIT + HubScene.FINALE_FALL) {
      const s = (t - HubScene.FINALE_ORBIT) / HubScene.FINALE_FALL;
      /* In. The exponent is what makes it a fall rather than a dolly: most of
         the distance goes in the last third, so the horizon is a shape in the
         frame for a long time and then very suddenly is not. */
      radius = 46 * Math.pow(1 - s, 2.6) + 0.5;
      height = 3 * (1 - s);
      // Faster the closer it gets, which is both the physics and the drama.
      rate = 2.1 + 15 * s * s;
      this.warp = Math.pow(s, 1.9) * 4.2;
      /* The picture is wound in and shut down well before the camera arrives.
         The curve is steep on purpose: the first half of the fall is still a
         recognisable sky being pulled about, and the second half is not a sky
         any more. */
      this.collapse = 0.14 + Math.pow(s, 1.5) * 0.86;
      /* And the flat black comes last, over the final third — under a
         collapse this strong there is very little left to take by then, which
         is the point. It finishes the job rather than doing it. */
      this.fade = clamp01((s - 0.66) / 0.34);
    } else if (t < HubScene.FINALE_BLACK_END) {
      /* The dead channel. The scene itself is gone — fade is full — and what
         fills the frame is snow, coming up out of the black and getting worse.
         Squared, so the first half is a faint grey haze you are not sure you
         are seeing and the second half is the set giving up entirely. */
      const s = (t - HubScene.FINALE_FALL_END) / HubScene.FINALE_BLACK;
      this.warp = 0;
      this.fade = 1;
      // Nothing left to wind. Cleared here rather than held, so the swirl is
      // not still running under the static for the whole hold.
      this.collapse = 0;
      this.tvStatic = s * s;
      this.plate = 0;
      /* The camera goes home now, during the black — which is the only reason
         it can be a cut. There is no flight back from inside a black hole that
         would not be a rewind of the fall. */
      this.camera.position.copy(this.restPosition());
      this.controls.target.set(0, 0, 0);
      this.selectedKey = null;
      this.focusFloor = 14;
      this.finaleTail();
      return;
    } else if (t < HubScene.FINALE_PLATE_END) {
      /* The far side. One still image, three seconds, with a ring spreading
         out from where the stone went in — which is the middle, which is where
         the hole was, which is where the camera has just been.

         It arrives fast and leaves slowly. A plate that faded up over a second
         would be a dissolve, and a dissolve from black is a scene beginning; a
         plate that is simply *there* two frames after the dark is something
         happening to the viewer. It goes out slowly for the opposite reason —
         the picture underneath has to have somewhere to come back from. */
      const s = (t - HubScene.FINALE_BLACK_END) / HubScene.FINALE_PLATE;
      this.warp = 0;
      this.collapse = 0;
      this.fade = 1;
      // The signal does not recover, it is replaced. Cut, not crossfade.
      this.tvStatic = 0;
      this.ripple = t - HubScene.FINALE_BLACK_END;
      /* Full on the first frame — the picture arrives, it does not resolve.
         Two seconds of worsening snow and then the image simply *is* there is
         the whole shape of this; a fade-in would make it the end of the static
         rather than the answer to it. Only the way out is a fade, over the
         last fifth, because the scene underneath needs somewhere to come back
         from. */
      this.plate = 1 - clamp01((s - 0.8) / 0.2);
      this.camera.position.copy(this.restPosition());
      this.controls.target.set(0, 0, 0);
      this.finaleTail();
      return;
    } else {
      // Back up, on the resting view.
      const s = (t - HubScene.FINALE_PLATE_END) / HubScene.FINALE_RETURN;
      this.warp = 0;
      this.plate = 0;
      this.tvStatic = 0;
      this.fade = 1 - s * s * (3 - 2 * s);
      this.camera.position.copy(this.restPosition());
      this.controls.target.set(0, 0, 0);
      this.finaleTail();
      return;
    }

    this.finaleAngle += rate * dt;
    const cos = Math.cos(this.finaleAngle);
    const sin = Math.sin(this.finaleAngle);
    const want = this.tmpV2
      .copy(hole)
      .addScaledVector(side1, cos * radius)
      .addScaledVector(side2, sin * radius)
      .addScaledVector(axis, height);

    /* Eased in from wherever the tour left the camera, over the first couple
       of seconds. The alternative is a cut, and the one thing this ending must
       not do is cut. */
    const blend = clamp01(this.finaleT / 2.2);
    this.camera.position.lerpVectors(this.finaleFrom, want, blend * blend * (3 - 2 * blend));
    this.controls.target.copy(hole);
    this.focusFloor = 0.35;
    this.finaleTail();
  }

  /** The end of every branch above: stop when the clock runs out. */
  private finaleTail(end = HubScene.FINALE_END) {
    if (this.finaleT < end) return;
    this.finaleT = -1;
    this.clearFinaleEffects();
    this.setCurtain(false);
    this.controls.enabled = true;
    // Straight on to the first stop, rather than sitting at rest for a full
    // interval after an ending that just handed the system back.
    this.tourIndex = -1;
    this.tourTimer = 1.6;
  }

  /** A different angle on every stop.
   *
   * The tour used to hand focusOn() no view at all, which meant every stop got
   * framePosition()'s one preferred direction: outside the system, a little
   * above the plane, looking in. Correct for a tap — but eleven stops of it in
   * a row is eleven photographs taken from the same place, and the thing the
   * tour is for is showing that these are bodies in a space rather than icons
   * on a page. Saturn seen edge-on to its rings and then from above them is
   * two different objects; the black hole's disc is a line from one angle and
   * a bowl from another.
   *
   * Not uniform random, though. Independent draws put two stops in nearly the
   * same pose often enough to notice, and the one thing a varied tour must
   * never do is look like it repeated itself. The azimuth advances by the
   * golden angle instead — successive stops land 137.5° apart, and the
   * sequence takes a very long time to come back near anywhere it has been —
   * with a small random push on top so the regularity is not itself legible.
   * Elevation and distance are drawn freely, since neither has a "same again"
   * failure the way the azimuth does. */
  private tourView(): TourView {
    const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // 2.3999… rad, 137.5°
    this.tourAzimuth = (this.tourAzimuth + GOLDEN + (this.tourRand() - 0.5) * 0.5) % (Math.PI * 2);

    /* Biased above the plane but not confined to it. The squared roll spends
       most of its stops in the upper half — where the light is and where an
       orbit reads as an ellipse rather than as a line — while still going
       under the plane now and then, which is the shot that makes a ring system
       or an accretion disc look like an object with a top and a bottom. Kept
       well clear of straight overhead: at the pole the camera's up vector is
       undefined and the view rolls on the way in. */
    const roll = this.tourRand();
    const elevation = -0.34 + roll * roll * 1.28;

    // Near enough to fill the frame, far enough to see what it is orbiting.
    const zoom = 0.82 + this.tourRand() * 0.72;

    return { azimuth: this.tourAzimuth, elevation, zoom };
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
  /** A world point in screen UV, 0..1 with y up — the space GRADE_SHADER's
   * uCenter works in. Uses its own scratch vector: the caller runs inside
   * updateFlight, which is already holding tmpV and tmpV2. */
  private project(p: THREE.Vector3): [number, number] {
    this.tmpV3.copy(p).project(this.camera);
    return [this.tmpV3.x * 0.5 + 0.5, this.tmpV3.y * 0.5 + 0.5];
  }

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
    /* A dive is the one camera move that is meant to cross this floor — the
       floor exists precisely to stop the camera reaching a body's surface, and
       OrbitControls.update() re-clamps the radius every frame whether or not
       the controls are enabled, so leaving it in place would haul the camera
       back out from under the tween. */
    if (this.flight?.dive) {
      this.controls.minDistance = 0.01;
      return;
    }
    /* The tour's ending crosses it for the same reason, and would be hauled
       back out by the same clamp — it holds no followAnchor, so without this
       it lands in the general branch below, which at the hole's distance from
       the star settles on a floor of 2.5 units and simply refuses to let the
       camera reach the horizon. The fall would stop dead a few units short and
       hang there while the screen faded. */
    if (this.finaleT >= 0) {
      this.controls.minDistance = 0.01;
      return;
    }
    // The probe's tour drives the camera itself and holds no anchor either.
    if (this.voyagerTour) {
      this.controls.minDistance = this.focusFloor;
      return;
    }
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
    const dive = f.dive ?? null;
    // The intro eases out only (it is already moving when you arrive); a
    // fly-to eases in and out, so it settles rather than stopping dead; a dive
    // eases in and never settles, because it does not arrive — it lands.
    const e = dive ? easeInCubic(t) : f.body || f.duration > 2 ? easeInOutCubic(t) : easeOutCubic(t);

    this.camera.position.lerpVectors(f.fromPos, f.toPos, e);
    this.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);

    if (dive) {
      /* Everything the fall looks like. The streak climbs with the fall rather
         than peaking in the middle of it, and it converges on the body: early
         on the body is still off to one side, and streaks pulling toward the
         middle of the screen while the camera pulls toward something else read
         as two different moves happening at once. */
      this.warp = Math.pow(t, 1.7) * 2.7;
      this.diveCenter = this.project(f.toTarget);
      // The last third. Held past 1 deliberately — the frame is fully blown out
      // before the route changes, so the page swap happens behind the light
      // instead of cutting from a live frame to a new document.
      this.diveFlash = smoothstep(0.55, 1.0, t) * 1.7;
    } else {
      // Speed, as the frame sees it: peaks mid-flight and is gone on arrival.
      this.warp = Math.sin(t * Math.PI) * (f.body ? 0.85 : 0.35);
    }

    if (done && dive) {
      /* Nothing is reset and the controls stay off. This scene has seconds to
         live: onSelect navigates, the shell unmounts and dispose() takes the
         context with it. Handing the camera back and fading the light out would
         only ever be seen as a flinch on the way out the door. */
      this.flight = null;
      this.callbacks.onSelect(dive);
      return;
    }

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

    /* The top of the frame, read before any work has been done in it. The gap
       back to the previous top is the interval the visitor actually sees; the
       gap forward to the bottom is what this thread spent building it. Both
       come from this one number, and it is not read at all unless the meter is
       on. */
    const top = this.metering ? performance.now() : 0;

    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    const time = this.timer.getElapsed();
    /* One, always. This used to be 0.25 under reduced motion, and it is
     * multiplied into every moving thing in the scene — orbits, spins, the
     * disc, the jets, the merger, the wormhole's sky, the comets, the belt —
     * so the whole system ran as a quarter-speed slow motion. That is not what
     * the setting asks for. `prefers-reduced-motion` is about motion imposed
     * on the visitor: a camera that flies, swoops, spirals and blacks the
     * screen out. A planet going round the star at the rate it has always gone
     * round is the subject of the page, not an effect played at it, and
     * slowing it does not reduce anything — it only makes the page look
     * broken, which is how it was found.
     *
     * The rest of the flag went the same way and for the same reason — see the
     * note by `pinned`. Kept as a name rather than folded away because the
     * shape of the frame is worth being able to read: every update below takes
     * a rate, and it is useful to be able to see that they all take the same
     * one. */
    const speed = 1;

    this.updateFlight(dt);
    if (!this.flight) {
      this.idleFor += dt;
      // Left alone, the scene starts turning on its own. Slowly enough that it
      // reads as drift rather than as a carousel.
      if (this.idleFor > 22) this.controls.autoRotate = true;
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
    /* Above the controls with the planets, and for the same reason twice over:
       the grand tour's route is drawn through this frame's planet positions,
       and during it the probe *is* the camera's pivot. Run below, the chase
       would be aiming at where the probe was last frame. */
    this.updateVoyager(time, speed, dt);
    // After the bodies and before the controls, like the follow below it: the
    // ending orbits the hole and has to use this frame's position for it.
    this.updateFinale(dt);
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

    this.updateHubble(dt, time, speed);
    if (this.beltGroup) this.beltGroup.rotation.y += dt * 0.012 * speed;
    this.updateBlackHole(dt, time, speed);
    this.updateWormhole(time, speed);
    this.updateNeutron(dt, time, speed);
    this.updateComets(time, speed);
    this.glow.flush();

    this.updateHover(dt);
    this.updateLabels();
    this.updatePasses(time);

    this.composer.render();

    if (!this.ready) {
      this.ready = true;
      this.callbacks.onReady();
    }
    this.sampleFps(top);
  };

  private updatePlanets(dt: number, time: number, speed: number) {
    // The sun is the origin and never moves; this used to be rebuilt every
    // frame to be copied into eight materials that already held the value.
    const sun = ORIGIN;
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
            moon.ventIdle = this.clearGlow(moon.ventStart, moon.ventCount, moon.ventIdle ?? false);
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
          /* Found once and kept. getObjectByName walks the subtree, and this
             was walking it every frame to reach the same mesh. `undefined`
             means not looked up yet and `null` means looked up and not there,
             which is the distinction that stops a miss being retried forever. */
          if (moon.plume === undefined) {
            moon.plume = (moon.mesh.getObjectByName("plume") as THREE.Mesh | undefined) ?? null;
          }
          const plume = moon.plume;
          if (plume) {
            const flicker = 0.42 + Math.abs(Math.sin(time * 9.3)) * 0.3;
            (plume.material as THREE.MeshBasicMaterial).opacity = flicker;
            plume.scale.set(1, 0.85 + Math.sin(time * 13.1) * 0.15, 1);
          }
        }
        if (moon.ventStart !== undefined && moon.ventCount) {
          this.updateVent(moon, time, speed);
          moon.ventIdle = false;
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
  /** Switches a whole glow range off, and does nothing at all if the caller
   * says it is already off.
   *
   * Every range this is used on spends most of its cycle dark — the jet burns
   * for seven seconds in fifty-two, Pluto's debris for four, the supernova
   * knots for thirty in fifty-two — and the old code re-wrote the same few
   * thousand zeroes on every frame in between. That is a loop with no output:
   * the alpha was already zero, and now the upload is bounded too, so those
   * slots cost nothing on either side. Returns the caller's new idle flag.
   */
  private clearGlow(start: number, count: number, idle: boolean): boolean {
    if (!idle) for (let i = 0; i < count; i++) this.glow.hide(start + i);
    return true;
  }

  /** Keeps the telescope on station and pointed at whatever it is watching.
   *
   * The pivot turns at Earth's own rotation rate, so it holds its place over
   * the same face — the geostationary reading of the request. Its real orbit
   * is ninety-five minutes, which at this scale is a streak rather than a
   * spacecraft.
   */
  private updateHubble(dt: number, time: number, speed: number) {
    if (!this.hubblePivot || !this.hubble) return;
    // Looked up once. This ran a linear search of the planet list on every
    // frame to read one number that never changes.
    const earth = this.earthRig;
    if (!earth) return;
    this.hubblePivot.rotation.y = (time / earth.spec.spin) * Math.PI * 2 * speed;

    /* Aimed, and eased rather than snapped. The tube swings round to whatever
       is being observed over about a second, which reads as a telescope being
       slewed; set outright it would flick between targets like a cursor. */
    this.hubble.getWorldPosition(this.tmpV);
    const look = this.tmpV2.copy(this.hubbleAim).sub(this.tmpV);
    if (look.lengthSq() > 1e-6) {
      look.normalize();
      // In the rig's own parent frame, since that frame is turning under it.
      this.hubble.parent?.getWorldQuaternion(this.tmpQuat);
      this.tmpV3.copy(look).applyQuaternion(this.tmpQuat.invert());
      const want = this.tmpQuat2.setFromUnitVectors(HubScene.FORWARD, this.tmpV3);
      this.hubble.quaternion.slerp(want, Math.min(1, dt * 2.4));
    }
  }

  private updateVent(moon: MoonRig, time: number, speed: number) {
    const start = moon.ventStart!;
    const count = moon.ventCount!;
    const radius = moon.spec.size;
    const io = moon.spec.vent === "io";
    // The vent's own place on the surface. Io's Pele-analogue sits near the
    // equator; Enceladus's tiger stripes are at its south pole, so its plume
    // fires straight "down". Normalised once at module scope: it is a
    // constant, and it was being rebuilt and re-normalised twice a frame.
    const vent = io ? IO_VENT : ENCELADUS_VENT;

    moon.holder.getWorldPosition(this.tmpV);
    const ox = this.tmpV.x;
    const oy = this.tmpV.y;
    const oz = this.tmpV.z;
    const reach = io ? radius * 7.5 : radius * 9;
    const spread = io ? 0.42 : 0.24;

    /* Plain numbers rather than Vector3s. Every particle used to cost four
       allocations — two clones, a literal and another clone — which across
       both moons was some fourteen thousand short-lived vectors a second, for
       arithmetic that fits in six locals. Nothing about the result changes;
       this is the same expression with the objects taken out from under it. */
    for (let i = 0; i < count; i++) {
      const seed = (i * 0.6180339887) % 1;
      const life = (time * speed * (io ? 0.42 : 0.3) + seed) % 1;
      // Ballistic: up fast, then falling back.
      const height = Math.sin(life * Math.PI) * reach;
      const drift = life * reach * 0.55;

      const a = seed * Math.PI * 2;
      const wobble = spread * life;
      let dx = vent[0] + Math.cos(a) * wobble;
      let dy = vent[1] + Math.sin(a * 1.7) * wobble * 0.6;
      let dz = vent[2] + Math.sin(a) * wobble;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len;
      dy /= len;
      dz /= len;

      const out = radius + height * 0.6 + drift * 0.3;
      const fade = Math.sin(life * Math.PI);
      const size = (io ? 0.55 : 0.45) * (0.5 + fade * 0.9);
      if (io) {
        // Sulphur: yellow at the vent, cooling to red as it falls.
        this.glow.set(start + i, ox + dx * out, oy + dy * out, oz + dz * out, size, 1.0, 0.72 - life * 0.32, 0.28, fade * 0.5);
      } else {
        this.glow.set(start + i, ox + dx * out, oy + dy * out, oz + dz * out, size, 0.82, 0.92, 1.0, fade * 0.42);
      }
    }
  }

  /* ─────────────────── the hole, and what it is eating ─────────────────── */

  /* The hole's meal, in order: Pluto in, gold afterglow, then a blue star the
     size of this system's own drawn in and torn apart, then a blue afterglow,
     then a pause before it starts again. The two afterglows are five seconds
     each, which is long enough to notice from anywhere in the scene and short
     enough that the disc spends most of its life its own colour. */
  private static readonly PLUTO_APPROACH = 15;
  private static readonly PLUTO_TEAR = 4;
  /** Gold: the rock is gone. */
  private static readonly GOLD_GLOW = 7;
  private static readonly STAR_APPROACH = 9;
  /* The star holds at the tidal radius and is stripped rather than swallowed.
     Gas leaves the face turned toward the hole and streams in while the body
     itself stays whole — which is how this actually happens: a star that
     wanders close is eaten over time, not in one bite. Only when enough of it
     is gone does the tide win and the rest goes in. */
  private static readonly STAR_STRIP = 15;
  private static readonly STAR_TEAR = 5;
  /** Blue-white, and much brighter: a whole star has just gone in. */
  private static readonly BLUE_GLOW = 7;

  /* Cumulative marks on the cycle, which is what the frame actually tests
     against. The last four seconds are the hole at rest, with nothing falling
     in and the disc back to its own colour — the pause is what keeps the two
     meals from reading as one continuous feeding frenzy. */
  private static readonly T_PLUTO_END = 15 + 4; // 19
  private static readonly T_GOLD_END = 19 + 7; // 26
  private static readonly T_STAR_END = 26 + 9 + 15 + 5; // 55
  private static readonly T_BLUE_END = 55 + 7; // 62
  private static readonly BH_CYCLE = 62 + 4; // 66, the last 4 being the rest

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

    const cycle = (time * speed) % HubScene.BH_CYCLE;
    /* Its own vector rather than a clone of the scratch one. The clone was
       there for a real reason — this value has to survive updateJets,
       updateBlueStar and updatePlutoDebris, every one of which writes tmpV —
       but the answer to "this must outlive the shared scratch" is a scratch of
       its own, not a fresh vector sixty times a second. */
    const holePos = this.holeWorld.copy(this.tmpV);

    /* The afterglow. Gold for the seven seconds after Pluto, blue-white and
       far brighter for the seven after the star. Eased rather than switched,
       so the disc bleeds into and out of the colour instead of flicking. */
    let glowMix = 0;
    let glowBright = 0;
    if (cycle >= HubScene.T_PLUTO_END && cycle < HubScene.T_GOLD_END) {
      const g = (cycle - HubScene.T_PLUTO_END) / HubScene.GOLD_GLOW;
      // Up fast, hold, then fade — the fade is the longer half.
      glowMix = Math.min(1, g * 6) * (1 - Math.pow(g, 2.4));
      /* Gold. Kept off the red end and well off white: the green this replaced
         could be any value it liked because nothing else in the scene was
         green, but gold has the sun a few hundred units away to be told apart
         from, and a disc that goes pale gold reads as the disc being lit by it
         rather than as the disc burning. The green channel carries it: at
         three-quarters this is gold, and a little under that it is orange. */
      this.discMaterial.uniforms.uGlowTint.value.setRGB(1.0, 0.74, 0.22);
      glowBright = glowMix * 0.22;
    } else if (cycle >= HubScene.T_STAR_END && cycle < HubScene.T_BLUE_END) {
      const g = (cycle - HubScene.T_STAR_END) / HubScene.BLUE_GLOW;
      glowMix = Math.min(1, g * 8) * (1 - Math.pow(g, 2.6));
      this.discMaterial.uniforms.uGlowTint.value.setRGB(0.4, 0.72, 1.0);
      // A whole star went in, so this one burns harder than the gold — but
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
      const dir = this.tmpDir.set(Math.cos(angle), Math.sin(angle * 0.6) * 0.22, Math.sin(angle)).normalize();

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
      /* Scaled against the hole rather than against the screen.
         PLUTO_RADIUS * 14 is a half-length of 33.6, so the finished thread is
         about 67 units end to end — which is the disc's own outer diameter.
         The filament reaches across the thing eating it and stops there.

         It was more than four times that, and the trouble with a filament that
         long is not that it leaves the frame: it is that it stops being
         readable as something falling INTO the hole. At 283 units the hole was
         a small bright knot at the middle of a line that owned the screen, and
         the eye had nothing to tell it which of the two was the subject. */
      const stretch = 1 + drawn * 5.0 + tear * tear * 8.0;
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
      this.debrisIdle = this.clearGlow(this.plutoDebrisStart, this.debrisCount, this.debrisIdle);
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

    /* How much of the disc's expensive structure to compute this frame.
     *
     * The disc is the most costly surface on the page — sixteen turns of
     * simplex a fragment at full detail — and it is on screen for the whole
     * session. For almost all of that it is a small bright ring away in a
     * corner, where the domain warp and the third turbulence sheet are below
     * a pixel and cost exactly what they cost from a metre away. So they are
     * bought by distance: full inside 180 units, gone by 240, and a smooth
     * ramp between the two so nothing pops as it crosses.
     *
     * The threshold is set by where the disc stops being readable rather than
     * by a frame-rate target. At 240 units the sheet subtends about twenty
     * degrees; the ending's crossing flies it between 5 and 46, and the
     * telescope frames it at 157, so everything that is actually looking at
     * this thing gets all of it. */
    const near = this.camera.position.distanceTo(holePos);
    const detail = clamp01((240 - near) / 60);
    this.discMaterial.uniforms.uDetail.value = detail;
    // And the slab's outer sheets with it: three discs when it is worth three,
    // one when the thickness would be under a pixel anyway.
    for (const skin of this.discSkins) skin.visible = detail > 0.01;
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
      this.jetIdle = this.clearGlow(this.jetParticleStart, this.jetParticleCount, this.jetIdle);
      return 0;
    }
    this.jetIdle = false;

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
    let energy = Math.min(1, since * 24) * (1 - held * held * (3 - 2 * held));
    // Half again as bright for the star. It clamps in the shader, so the
    // headroom shows as a beam that stays at full white for longer rather than
    // as one that blows out.
    energy *= 0.85 + power * 0.65;

    // Very long, deliberately: this should cross the sky, not the hole.
    /* The star's jet is the payoff for a thirty-second meal, so it is not
       merely the rock's beam again with a different tint. `power` is 0.5 for
       the rock and 1 for the star, and everything below leans on that gap. */
    const length = 620 + power * 1180;
    const width = 8 + power * 22;

    // Gold for the rock, matching the afterglow it fires into; blue-white for
    // the star, which is the colour the star itself was.
    const tintR = power < 1 ? 1.0 : 0.36;
    const tintG = power < 1 ? 0.72 : 0.6;
    const tintB = power < 1 ? 0.24 : 1.0;

    /* The root of the filament warms with it. uHot is where the beam starts
       before it cools into the tint along its length, and left at the neutral
       white it uses for the star, the first third of a gold beam is white and
       the gold only arrives once the beam is already going away from you —
       which reads as a white beam with a coloured end rather than as a gold
       one. Still nearly white, though: this is the hottest part of it. */
    const hotG = power < 1 ? 0.95 : 0.98;
    const hotB = power < 1 ? 0.82 : 0.94;

    for (const material of this.jetMaterials) {
      material.uniforms.uTime.value = time * speed;
      material.uniforms.uHead.value = head;
      material.uniforms.uEnergy.value = energy;
      material.uniforms.uHot.value.setRGB(1.0, hotG, hotB);
      material.uniforms.uCool.value.setRGB(tintR, tintG, tintB);
    }

    for (const cone of this.jetCones) {
      // Y is the length of the cone, X and Z its width — the beam gets longer
      // and thinner as it goes, rather than simply bigger.
      cone.mesh.scale.set(width * cone.width, length, width * cone.width);
    }
    this.jetGroup.visible = energy > 0.01;

    this.updateJetParticles(holePos, since, head, energy, length, width, power, time, speed, tintR, tintG, tintB);
    return energy;
  }

  /** The smoke climbing the beam, as a few ropes twisted around the light.
   *
   * A jet is not a straight pipe of material. The gas arrives with the disc's
   * angular momentum still in it and has nowhere to put it, so it leaves on a
   * helix — wound tight at the throat where the coil is narrow, unwinding as
   * the beam opens out, which is the same reason a hurricane's eyewall turns
   * faster than its outer bands and the reason a skater's spin speeds up when
   * their arms come in. Both of those are one line here: the angular rate is
   * divided by how wide the coil has become.
   *
   * Each grain is placed twice. Once around the beam's axis, which is the
   * helix its rope's centre-line follows and the thing that makes the smoke
   * twist; and once around that centre-line, which is what gives the rope a
   * thickness and a hollow, so it reads as a cord of smoke with a near and a
   * far side rather than as a spray that happens to be spiralling. The second
   * placement is done in the beam's own radial/tangential plane and rotated
   * into place with the first — a plain 2D rotation, and no dividing by a coil
   * radius that goes to nothing at the throat.
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
    power: number,
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

    /* How much of the pool this beam actually throws. The star gets all of it;
       the rock gets the share that leaves its beam the density it already had.
       Rounded to a multiple of 42 because the seeding above cycles the seven
       clots on `i` and the three ropes and two poles on `i / 2` — any other
       prefix takes an uneven number of some clot or rope and lands a heavier
       cord on one pole than the other. */
    const grains =
      power < 1 ? Math.round((this.jetParticleCount * 0.58) / 42) * 42 : this.jetParticleCount;
    for (let i = grains; i < this.jetParticleCount; i++) this.glow.hide(this.jetParticleStart + i);

    /* And each puff covers its share of a wider beam. The size below is in
       world units and knows nothing about `width`, so on the star's beam — 30
       units across against the rock's 13 — the same sprite covers a fifth of
       the area. Without this the extra grains only restore what the widening
       took, and the two beams end up equally thick again. */
    const puffScale = 0.72 + power * 0.56;

    for (let i = 0; i < grains; i++) {
      const slot = this.jetParticleStart + i;
      const p = i * 9;
      const rope = this.jetParticles[p + 1];
      const ropeAngle = this.jetParticles[p + 2];
      const ropeOff = this.jetParticles[p + 3];
      const slack = this.jetParticles[p + 4];
      const rate = this.jetParticles[p + 5];
      const roll = this.jetParticles[p + 6];
      const pole = this.jetParticles[p + 7];
      const puff = this.jetParticles[p + 8];

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

      // The funnel: tight at the throat, opening steadily with height.
      const flare = 0.18 + Math.pow(climb, 1.2) * 1.5;
      /* The billow. A clot of gas is not a flat ring — it swells and pinches
         as it goes, and because every grain in one clot shares its phase, the
         whole mass breathes together. Without this the clots are still clots,
         but they are rigid ones, and rigid smoke is not smoke. */
      const billow = 1 + 0.44 * Math.sin(climb * 9.0 + puff * Math.PI * 2 + spin * 1.1);
      /* Where the rope's centre-line runs, and how thick the rope is there.
         Both drawn in hard against the light: the coil rides close enough to
         the filament that the three cords and the thread they wrap read as one
         object, and the cord itself is a quarter of the width it was, so its
         grains are packed rather than strewn. It still keeps clear of the
         filament all the way out — a rope that passed through the light would
         put its grains on top of the one thing in the beam that is supposed to
         be brightest, and the braid would wash out into the glare rather than
         turn in front of it. */
      const coil = width * (0.22 + flare * 0.42) * billow;
      const thick = width * (0.04 + flare * 0.105) * billow;
      /* The wind. Negative, because that is the direction the disc under it
         is turning (see the Doppler term in DISC_FRAG); divided by the flare,
         so a grain at the throat whips round several times while one out near
         the head barely turns at all. Wound harder than it used to be: at the
         old rate the spiral was legible but genteel, and the point of this is
         that the gas is being flung, not stirred. Wound harder again now that
         the cords are tight: the number of turns the braid makes over the
         beam's length is what makes it a screw thread rather than three lines
         leaning, and a thin cord can take far more of them before the turns
         run into each other than a fat one could. */
      const turn = rope - (spin * 2.5 + climb * 17.0) / flare;
      /* And the rope turns about its own axis as well as about the beam's, so
         a grain works its way from the near side of the cord to the far side
         on the way up. That is the difference between a cord being carried
         round and a cord being twisted. */
      const twist = ropeAngle + climb * 7.0 + spin * 1.8;
      // The grain's place in the rope's cross-section, before it is swung
      // round the beam: out from the centre-line, and along the way round.
      const outward = coil + Math.cos(twist) * thick * ropeOff;
      const sideways = Math.sin(twist) * thick * ropeOff;

      const cos = Math.cos(turn);
      const sin = Math.sin(turn);
      // The 2D rotation that puts the cross-section where the coil has got to.
      const px = outward * cos - sideways * sin;
      const pz = outward * sin + sideways * cos;

      /* Accelerating away from the hole, so the throat stays dense and the gas
         strings out as it climbs; plus the grain's slack along the rope. The
         slack is no longer measured against the cord's thickness — that would
         have shrunk with it to a quarter, and a cord that is thin in every
         direction at once is a string of beads. Kept at roughly the old figure,
         it now smears each grain *along* the rope instead of across it, which
         is what closes the gaps the tightening opened. */
      const along =
        Math.pow(climb, 1.35) * length * pole + slack * width * (0.13 + flare * 0.34) * pole;

      const ox = side1.x * px + side2.x * pz;
      const oy = side1.y * px + side2.y * pz;
      const oz = side1.z * px + side2.z * pz;

      /* White at the throat, cooling into the beam's own colour as it climbs —
         but less white than it was. This is smoke around a light now, not the
         light itself: keep lifting it all the way to white and the ropes
         out-shine the filament they are supposed to be winding around, and the
         two read as one bright funnel again. */
      const hot = (1 - clamp01(climb * 2.2)) * 0.7;
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
      /* Dimmer per puff, brighter per cord. The tightening put sixteen times
         the areal density into the cords and the puffs overlap several deep on
         top of that, all of it additive: at anything like the old per-grain
         alpha the ropes stop being smoke and become three solid white bars,
         and through the bloom the whole jet goes back to being a lamp. What is
         wanted from all this crowding is opacity, not glare, so each puff gives
         up most of what it had and the stacking puts it back.

         Cut too far the first time, though. Two things were reduced at once —
         this figure and the puff profile's own peak — and the product of the
         two was smoke that read as haze. Roughly doubled here; between the two
         changes the ropes now sit a little brighter than the loose grains that
         preceded them, which is what a body of smoke should do against a sky
         it is supposed to be the foreground of. */
      const fade = (1 - climb * climb) * energy * (0.16 + roll * 0.22) * emerge * emerge;

      this.glow.set(
        slot,
        holePos.x + axis.x * along + ox,
        holePos.y + axis.y * along + oy,
        holePos.z + axis.z * along + oz,
        /* Expanding as it goes: the gas is under no pressure out there. The
           exponent is under one so most of the growth happens early, while the
           rope is still tight enough for its puffs to overlap into one mass —
           which is what makes it read as a body of smoke and not as a swarm.
           Far larger than the cord it rides, and deliberately so: each puff is
           several times the width of the centre-line's own radius, so what the
           eye is given is one thick continuous rope of smoke rather than the
           sprites it is built out of. The cord is the thread; this is the wool
           on it. */
        (4.2 + roll * 3.2 + Math.pow(climb, 0.8) * 8.5) * puffScale,
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
    const active = cycle >= HubScene.T_GOLD_END && cycle < HubScene.T_STAR_END;
    if (!active) {
      this.blueStar.visible = false;
      this.blueStarHalo.visible = false;
      this.streamIdle = this.clearGlow(this.streamStart, this.streamCount, this.streamIdle);
      return;
    }
    this.streamIdle = false;

    const since = cycle - HubScene.T_GOLD_END;

    /* Three acts now, not two.
     *
     *   approach  the star falls in from the far side
     *   strip     it holds at the tidal radius while gas is pulled off the
     *             face turned toward the hole — fifteen seconds of being
     *             eaten without being swallowed
     *   tear      the tide finally wins and the rest of it goes in
     *
     * `p` drives the approach only, so it stops at 1 when the star arrives and
     * the body then holds its distance instead of continuing to fall. That is
     * the whole difference: it used to be one continuous plunge. */
    const approach = clamp01(since / HubScene.STAR_APPROACH);
    const strip = clamp01((since - HubScene.STAR_APPROACH) / HubScene.STAR_STRIP);
    const tear = clamp01(
      (since - HubScene.STAR_APPROACH - HubScene.STAR_STRIP) / HubScene.STAR_TEAR
    );
    const p = approach;

    this.blueStarMaterial.uniforms.uTime.value = time * speed;
    this.blueStarHaloMaterial.uniforms.uTime.value = time * speed;

    /* Comes in from the far side to Pluto's, and much further out — it is a
       star, so it should be visible as one long before it arrives. */
    /* Falls to the tidal radius, then stays there. Only the tear closes the
       last of the gap, which is what makes the ending an event rather than the
       end of a slide. */
    const held = 240 * Math.pow(1 - p, 1.4) + 56;
    const distance = held - tear * tear * 45;
    // Still circling while it is stripped, so the stream sweeps rather than
    // hanging in one place.
    const angle = Math.PI + p * Math.PI * 2.2 + strip * Math.PI * 0.55;
    const dir = this.tmpDir.set(Math.cos(angle), Math.sin(angle * 0.5) * 0.28, Math.sin(angle)).normalize();

    /* The same spaghettification Pluto gets, and further along it: a star is
       far larger than the rock, so the tide across it is larger too, and it
       spends most of its approach visibly being drawn out. See the comment on
       Pluto's for why this runs off distance rather than off the tear clock,
       and why the centre slides back once the filament outgrows its fall. */
    /* Smaller multipliers than Pluto's for a longer thread: this body is a
       star, and its radius is over three times the rock's, so every unit of
       stretch buys three times the length. */
    /* Almost none of this until the tide takes it. Through the strip the star
       is losing gas, not being pulled out of shape — a body visibly stretching
       for fifteen seconds and not falling reads as stuck. */
    const drawn =
      Math.pow(clamp01((250 - distance) / 236), 2.4) * 0.35 * (0.25 + 0.75 * tear);
    /* Held to the same finish as Pluto's, and for the same reason: SUN_RADIUS
       * 2.82 is a half-length of 33.8, so this thread also ends at the disc's
       outer edge rather than running out past the knots and off the frame.

       The multipliers look small next to the rock's because the body they act
       on is not. This star's radius is 12 against Pluto's 2.4 — five times the
       diameter to begin with — so the same finished length is far less
       stretch. What comes out is a fat spindle rather than a thread, which is
       the honest shape for a body that large this close in. */
    const stretch = 1 + drawn * 0.68 + tear * tear * 1.14;
    const halfLen = SUN_RADIUS * stretch;
    const centre = Math.max(distance, halfLen + 8.5);
    // Scratch, not a clone: this is one vector a frame for fifteen seconds of
    // every fifty-two, and it does not outlive the function.
    const pos = this.tmpV2.copy(holePos).addScaledVector(dir, centre);

    this.blueStar.position.copy(pos);
    this.blueStar.lookAt(holePos);
    /* Thinned a little by the stripping before the tear takes the rest. A
       star that gives up fifteen seconds of gas and is exactly the size it
       started reads as nothing having happened to it. */
    const left = (1 - clamp01((tear - 0.5) / 0.5)) * (1 - strip * 0.16);
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
    const toStar = this.tmpV3.copy(pos).sub(holePos);
    const starAngle = Math.atan2(toStar.z, toStar.x);
    const starDist = toStar.length();

    for (let i = 0; i < this.streamCount; i++) {
      const slot = this.streamStart + i;
      const along = this.stream[i * 4];
      const spreadA = this.stream[i * 4 + 1] - 0.5;
      const spreadB = this.stream[i * 4 + 2] - 0.5;
      const roll = this.stream[i * 4 + 3];

      // Nothing until the star is genuinely being pulled apart.
      /* Driven by the strip as well as the tear. Gated on `tear` alone, the
         ribbon stayed empty for the whole fifteen seconds the star is meant to
         be losing gas — the stripping would have been a star sitting still.
         The strip fills most of the ribbon; the tear fills the rest. */
      /* And it drains at the end rather than being switched off. The ribbon
         used to sit at full brightness right up to T_STAR_END and then be
         cleared in one frame — eighteen hundred grains spanning fifty units,
         gone between two frames, at the exact moment the jet fires. The jet
         hides some of it, but a pop that large is still a pop. Over the last
         quarter of the tear the stream empties into the disc instead, which is
         also what should be happening: the star is gone by then, so there is
         nothing left feeding the far end of it. */
      const drain = 1 - clamp01((tear - 0.75) / 0.25);
      const flow = Math.max(strip * 0.86, tear) * drain;
      if (flow <= 0.01) {
        this.glow.hide(slot);
        continue;
      }

      /* The particles TRAVEL now, and that is the whole difference.
         They used to sit at a fixed fraction of the path and merely fade in,
         which is a ribbon drawn between two objects rather than material
         leaving one for the other — it read as decoration hanging in the gap.
         Each one now marches from the star to the disc and wraps, at its own
         rate, so the stream is something moving rather than something placed.

         And it starts at 0. The old expression added a third of the path from
         `born` before anything was drawn, so the youngest particle already sat
         a third of the way in and nothing ever touched the star: the stream
         began in empty space, which is why it looked detached from it. */
      const rate = 0.17 + roll * 0.13;
      const t = (along + time * speed * rate) % 1;
      // Fades in as it leaves the star and out as it reaches the disc, so
      // neither end of the ribbon has a hard edge.
      const born = flow * clamp01(t / 0.06) * clamp01((1 - t) / 0.18);
      if (born <= 0.01) {
        this.glow.hide(slot);
        continue;
      }

      // Wind from the star's own angle round to the disc, tightening as it goes.
      const r = starDist * Math.pow(1 - t, 1.35) + 9;
      const a = starAngle + t * Math.PI * 2.2 + roll * 0.35;
      /* Wider where it leaves the star and narrowing as it is wound in, which
         is what makes it read as a torrent being drawn into a funnel rather
         than a wire between two points. */
      const wob = (1 - t) * 11 + Math.sin(t * 9 + roll * 6) * 2.2;

      const x = holePos.x + Math.cos(a) * r + spreadA * wob;
      const y = holePos.y + (toStar.y / Math.max(starDist, 0.001)) * r * 0.6 + spreadB * wob;
      const z = holePos.z + Math.sin(a) * r + spreadB * wob;

      // Blue-white at the star, whitening as it compresses and heats inward.
      const hot = Math.pow(t, 1.3);
      const size = 1.6 + roll * 2.4 + hot * 2.2;
      const alpha = born * (1 - Math.pow(t, 6)) * 0.82;
      this.glow.set(slot, x, y, z, size, 0.55 + hot * 0.45, 0.76 + hot * 0.22, 1.0, alpha);
    }
  }

  /** Two uniforms a frame.
   *
   * `uNear` is the only one that needs explaining. The finest of the three
   * sheets of stars rides on it, and the reason is sampling rather than
   * taste: from across the system the ball is a handful of pixels wide, and a
   * field fine enough to be worth looking at from arm's length is, at that
   * size, several cells to the pixel — which does not read as more stars, it
   * reads as the inside of the wormhole boiling. Fading that sheet in over the
   * last eighty units is a cross-fade rather than a change of scale, so the
   * stars that are already there stay exactly where they are and more simply
   * arrive between them, which is also what getting closer to a sky does. */
  private updateWormhole(time: number, speed: number) {
    this.wormholeMaterial.uniforms.uTime.value = time * speed;
    this.wormhole.getWorldPosition(this.wormholeWorld);
    const distance = this.camera.position.distanceTo(this.wormholeWorld);
    this.wormholeMaterial.uniforms.uNear.value = clamp01(1 - (distance - WORMHOLE_RADIUS * 4) / 80);
    // Where the silhouette falls at this distance — see the note in the
    // shader. Floored so a camera that ends up inside the sphere divides by
    // something rather than by zero.
    this.wormholeMaterial.uniforms.uEdge.value = silhouette(WORMHOLE_RADIUS, distance);
  }

  private updatePlutoDebris(holePos: THREE.Vector3, tear: number, time: number, speed: number) {
    this.debrisIdle = false;
    const plutoPos = this.pluto.position;
    const toHole = this.tmpV3.copy(holePos).sub(plutoPos);
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

  /* ── the beams ──
     A neutron star's radiation leaves along the spin axis, out of both poles
     at once, and the axis itself is leaning and swinging like a top's. So: one
     shaft of light run clean through each body — one ray north, one south —
     lit steadily and never doing anything but pointing.

     There is no motion in the beam. It does not fire, it does not pulse, and
     nothing climbs it; the only thing that changes from frame to frame is
     which way it points, because the star it belongs to is turning. That is
     the whole effect, and everything that used to compete with it has been
     taken out.

     What is left exists to keep the shaft reading as a RAY. It is one width
     from the star to its tip — nothing about it opens with distance. It is
     drawn at one axis position, not smeared across the arc the axis swept this
     frame. And it is a surface rather than a crowd of particles, because
     particles scatter and a ray does not. */

  /** What each body's axis does, in order: star a, star b, the remnant.
   *
   * `tilt` is the lean off vertical, and it is the number that decides how
   * much of a sweep the turn is: an axis that leans by nothing sweeps nothing.
   * The pair's are shallow, so their rays stay near upright and the turn is a
   * narrow wobble; the remnant's is steep, which is most of why the merger
   * reads as a change of body.
   *
   * `rate` is that body's share of the spin, and `nod`/`off` are a slow drift
   * in the lean itself. Both exist for the same reason: two stars with one
   * tilt, one rate and one phase are one object drawn twice. Deliberately not
   * a random number generator — these are fixed, chosen to have no common
   * factor, so the two axes never come back into step and the scene still
   * looks identical on every load. */
  private static readonly PULSAR_AXES = [
    // The pair are tops: a fixed lean precessing about a fixed axis, which is
    // what a spinning body does and what a cone is for.
    { tilt: 0.33, rate: 1.0, nod: 0.12, off: 0, wander: false },
    { tilt: 0.54, rate: 0.71, nod: 0.17, off: 2.4, wander: false },
    // The remnant is not settled, so its cone is not either. See pulsars().
    { tilt: 0.86, rate: 1.0, nod: 0.07, off: 1.1, wander: true },
  ];
  /** Radians a second the remnant's cone is tipped at, on two axes. Both slow,
   * and deliberately sharing no factor with each other or with the spin — that
   * is what stops the whole thing coming back round to where it started. */
  private static readonly PULSAR_DRIFT_A = 0.37;
  private static readonly PULSAR_DRIFT_B = 0.23;
  /** Radians a second the nod above runs at. Slow enough that it reads as the
   * axis wandering rather than as a second, faster rotation. */
  private static readonly PULSAR_NOD_RATE = 0.55;
  /** Turns per second of the axis, before the merger and after it. */
  private static readonly PULSAR_SPIN_PRE = 5;
  /* The same rate as before the merger.
   *
   * It was sixty, and sixty on a sixty-hertz screen is the one rate that
   * cannot be drawn: each frame samples a whole turn later, so the axis either
   * appears frozen or crawls at whatever the frame timing happens to drift by.
   * The remnant looked broken rather than fast. Five turns a second is a rate
   * the eye can actually follow, which is the point of drawing it at all. */
  private static readonly PULSAR_SPIN_POST = 5;
  /** Half the shaft's length in world units — it runs this far out of EACH
   * pole — against a pair whose orbit is eleven across and stars about five
   * wide. */
  private static readonly PULSAR_REACH = 30;
  /** The shaft's radius in world units. Narrow, and constant along its whole
   * length: this is the number that decides whether it reads as a ray or as a
   * cone, and there is nothing anywhere that scales it by distance. */
  private static readonly PULSAR_GIRTH = 0.5;

  private updateNeutron(dt: number, time: number, speed: number) {
    const t = (time * speed) % HubScene.NS_CYCLE;
    const center = this.neutronGroup.getWorldPosition(this.neutronCentre);
    const { a, b, merged } = this.neutronSlots;

    const merging = t >= HubScene.NS_INSPIRAL;
    /* The axis phase, integrated rather than read off the clock. The rate
       changes at the merger — five turns a second becomes sixty — and
       `time * rate` with a rate that changes is a phase that jumps at the
       moment it changes, which here would be a visible snap of the axis
       exactly on the frame the eye is already watching. */
    const spin = merging ? HubScene.PULSAR_SPIN_POST : HubScene.PULSAR_SPIN_PRE;
    for (let i = 0; i < this.pulsarPhases.length; i++) {
      this.pulsarPhases[i] = (this.pulsarPhases[i] + spin * HubScene.PULSAR_AXES[i].rate * Math.PI * 2 * dt * speed) % (Math.PI * 2);
    }
    this.pulsarNod = (this.pulsarNod + HubScene.PULSAR_NOD_RATE * dt * speed) % (Math.PI * 2);
    this.pulsarDriftA = (this.pulsarDriftA + HubScene.PULSAR_DRIFT_A * dt * speed) % (Math.PI * 2);
    this.pulsarDriftB = (this.pulsarDriftB + HubScene.PULSAR_DRIFT_B * dt * speed) % (Math.PI * 2);

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

      /* A shaft through each star, each on its own axis — different leans,
         different rates, drifting independently, so the two never point the
         same way twice. See PULSAR_AXES. Both brighten as the orbit tightens,
         along with the stars themselves.

         A deep blue rather than the stars' own blue-white. The shaft is a
         narrow thing crossing a sky that already has a bright pair at the
         middle of it, and a pale tint at this width simply washes into them;
         saturating it is what gives the ray an edge to be seen against. */
      const beamGain = 0.5 + p * 0.6;
      this.pulsars(0, center.x + dx, center.y, center.z + dz, beamGain, 0.3, 0.6, 1.0);
      this.pulsars(1, center.x - dx, center.y, center.z - dz, beamGain, 0.3, 0.6, 1.0);
      this.pulsars(2, center.x, center.y, center.z, 0, 0, 0, 0);

      for (const layer of this.remnant) layer.mesh.visible = false;
      this.knotsIdle = this.clearGlow(this.knotStart, this.knotCount, this.knotsIdle);
      // The burst fires in the last instant before contact, not on a timer.
      this.flash = p > 0.995 ? 1 : this.flash * Math.exp(-dt * 6);
    } else {
      const since = t - HubScene.NS_INSPIRAL;
      this.glow.hide(a);
      this.glow.hide(b);

      // What the two of them become: one bright remnant, held while its ejecta
      // cloud expands across the sky behind it.
      const settle = clamp01(since / 1.2);
      /* And a different colour from the two that made it. The pair are
         blue-white — the hottest thing in the scene — and the remnant leaves
         that end of the spectrum for a soft vanilla, so the merger reads as a
         change of body and not merely as a change of size. Held just off
         white: any further into the yellow and it stops looking incandescent.

         Eased in over the same 1.2s the size settles across, so the instant of
         contact is still the blue-white the eye was tracking and the colour
         arrives with the remnant rather than as a cut. */
      const vanR = 0.88 + settle * 0.12;
      const vanG = 0.94 - settle * 0.045;
      const vanB = 1.0 - settle * 0.33;
      this.glow.set(merged, center.x, center.y, center.z, 15 + (1 - settle) * 24, vanR, vanG, vanB, 1);

      /* The remnant's own shaft — one ray north and one south, the same ray
         the pair had, and every way it differs is a way of saying this is a
         bigger body: longer, thicker, leaning further over, swinging twelve
         times faster, and about twice as bright as either star's was. Fades
         out over the last fifth of the remnant's life along with everything
         else in the cloud.

         Deep amber, the saturated end of the body's own vanilla, for the same
         reason the pair's shafts are deep blue: it has to hold its own against
         the remnant it comes out of. */
      const beamGain = clamp01(since / 0.8) * (1 - clamp01((since / HubScene.NS_MERGED - 0.8) / 0.2));
      this.pulsars(2, center.x, center.y, center.z, beamGain * 3.1, 1.0, 0.78, 0.34);
      this.pulsars(0, center.x, center.y, center.z, 0, 0, 0, 0);
      this.pulsars(1, center.x, center.y, center.z, 0, 0, 0, 0);

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
        this.knotsIdle = false;
      } else {
        for (const layer of this.remnant) layer.mesh.visible = false;
        this.knotsIdle = this.clearGlow(this.knotStart, this.knotCount, this.knotsIdle);
      }
    }
  }

  /** One body's beam: a single shaft of light run through it pole to pole,
   * along a spin axis that leans well off vertical and swings round like a
   * knocked top's.
   *
   * `which` picks the shaft — 0 and 1 are the two stars, 2 the remnant — and
   * `gain` at zero puts it away, which is how the inspiral hides the remnant's
   * and the merger hides the pair's.
   *
   * North and south are the two halves of one cylinder rather than two beams,
   * so they cannot drift out of agreement: BEAM_FRAG folds the shaft's UV
   * about its middle and lights both ends identically. All this has to do is
   * put the cylinder where the body is and point it down the axis — which,
   * since the shaft never changes, is the entire animation.
   */
  private pulsars(which: number, x: number, y: number, z: number, gain: number, tintR: number, tintG: number, tintB: number) {
    const { mesh, material } = this.beams[which];
    if (gain <= 0.001) {
      mesh.visible = false;
      return;
    }

    /* The remnant's shaft is far longer and somewhat thicker than either
       star's, because it is a far bigger thing: its own sprite is fifteen
       units across, and a shaft scaled for the pair would start inside it and
       leave looking like a thread.

       3.8 puts each half at 114 units. That sits right on the ejecta shells'
       own reach of 112 — the ray clears the cloud coming out of the same point
       and stops there, rather than carrying on past the knots at 205 the way
       171 did. The width is deliberately not scaled with it: a ray that got
       thicker as it got longer would be back to reading as a cone. */
    const remnant = which === 2;
    const reach = remnant ? HubScene.PULSAR_REACH * 3.8 : HubScene.PULSAR_REACH;
    const girth = remnant ? HubScene.PULSAR_GIRTH * 2.1 : HubScene.PULSAR_GIRTH;

    // This body's own lean, own drift in that lean, and own phase — see
    // PULSAR_AXES for why none of the three is shared with its neighbour.
    const spec = HubScene.PULSAR_AXES[which];
    const tilt = spec.tilt + spec.nod * Math.sin(this.pulsarNod + spec.off);
    const sinT = Math.sin(tilt);
    const phase = this.pulsarPhases[which];
    let ax = sinT * Math.cos(phase);
    let ay = Math.cos(tilt);
    let az = sinT * Math.sin(phase);

    /* For the remnant, tip the cone itself as well as turning inside it.
     *
     * What the expression above draws is a cone and only a cone: the lean is
     * all but fixed and the phase runs round it, so the y component never
     * leaves cos(tilt) and the beam always leans the same amount, always
     * upward. That is right for a top, which is what the two stars are — and
     * wrong for the remnant, which is supposed to be a body whose axis will
     * not settle. Sweeping one cone forever is why it looked like a handful of
     * positions rather than a direction that keeps changing.
     *
     * So the cone's own axis is turned too, on two slow clocks whose rates
     * share no factor with each other or with the spin. Three angles winding
     * at incommensurate rates never repeat, and between them they reach the
     * whole sphere rather than one ring of it. */
    if (spec.wander) {
      const a = this.pulsarDriftA;
      const b = this.pulsarDriftB;
      // About X, then about Z. Written out rather than composed through a
      // quaternion: it is six trig calls a frame and no allocation.
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const y1 = ay * ca - az * sa;
      const z1 = ay * sa + az * ca;
      const cb = Math.cos(b);
      const sb = Math.sin(b);
      const x2 = ax * cb - y1 * sb;
      const y2 = ax * sb + y1 * cb;
      ax = x2;
      ay = y2;
      az = z1;
    }
    this.beamAxis.set(ax, ay, az);

    mesh.visible = true;
    mesh.position.set(x, y, z);
    // The cylinder is built along +Y and centred on its own middle, which is
    // exactly the star — so pointing +Y down the axis aims both ends at once.
    mesh.quaternion.setFromUnitVectors(HubScene.UP, this.beamAxis);
    mesh.scale.set(girth, reach * 2, girth);

    material.uniforms.uGain.value = gain;
    (material.uniforms.uColor.value as THREE.Color).setRGB(tintR, tintG, tintB);
  }

  /** The planets the grand tour calls at, inward to outward. Not Voyager 1's
   * real itinerary — that one skipped the ice giants to go and look at Titan,
   * and Voyager 2's is the one that took all four. This is the route as it is
   * remembered rather than as it was flown, which is what the tour is for. */
  private static readonly VOYAGER_ROUTE = [
    "earth",
    "mars",
    "jupiter",
    "saturn",
    /* And in. The route used to carry on out past Uranus and Neptune to the
       neutron pair and the hole; it ends at Saturn now because what is parked
       beside Saturn is a way out of the system that does not involve crossing
       the rest of it. The probe goes round Saturn twice, and then into the
       wormhole — see the hand-off at the bottom of flyGrandTour, and the
       ending it hands to.

       Uranus, Neptune and the neutron pair are still in the sky, still
       clickable and still on the auto tour. They are simply not on this
       itinerary any more. */
    "wormhole",
  ];
  /** World units per second the probe makes when it is passing something, and
   * when it is not.
   *
   * The tour used to be paced by dividing a fixed duration between the legs,
   * which gets one of the two things wrong whichever way it is arranged.
   * Equal time per leg makes the pass speed depend on how long the leg was:
   * the same fly-by is sedate arriving from Mars and a blur arriving from
   * Neptune. Equal distance per second — constant speed — makes every pass
   * identical but spends the tour's length in proportion to the emptiness
   * between the planets, which out past Saturn is nearly all of it.
   *
   * So neither. Speed is a function of how far the probe is from the nearest
   * body: slow where there is something to look at, quick where there is not.
   * The pass is then the same everywhere by construction, and the gaps cost
   * only what they are worth. */
  /* Both halved. The tour is an exploration and it was being flown as a
     delivery — the whole of it, the passes as much as the gaps. Halving both
     rather than only the passes keeps the relationship between them, which is
     the thing this pair exists to state: how fast the ship goes past something
     against how fast it crosses the nothing in between. */
  private static readonly VOYAGER_PASS_SPEED = 3.75;
  private static readonly VOYAGER_CRUISE_SPEED = 33;
  /** The distances the speed ramps between, as multiples of the stop's own
   * reach: full pass speed inside the first, full cruise beyond the second.
   *
   * Measured against the body rather than in flat world units, and this is the
   * change that decides how long the whole tour takes. A flat window has to be
   * wide enough for Jupiter, and a window wide enough for Jupiter is 128 units
   * — which around here is not a distance, it is a district. Neptune's track
   * is 206 units out and the whole system is 260; eight stops each braking
   * everything within 128 units of them leaves no stretch of the route
   * travelling at cruise at all, and the tour spent about three quarters of
   * its length crawling through sky that has nothing in it. Read off the body,
   * Mars slows the probe within 62 units and Saturn within 151, which is what
   * the difference between the two of them is actually worth.
   *
   * The floors are what stops the small inner planets going past in a blur —
   * a body two units across still needs to be approached from far enough out
   * to be seen coming. */
  private static readonly VOYAGER_PASS_RANGE = 2.6;
  private static readonly VOYAGER_PASS_RANGE_MIN = 12;
  private static readonly VOYAGER_CRUISE_RANGE = 11;
  private static readonly VOYAGER_CRUISE_RANGE_MIN = 62;
  /** And a ceiling on it, which the floor above always needed a partner for.
   *
   * The window is read off the body, and Saturn's body — for this purpose —
   * is the outer edge of its ring sheet at 13.75. Eleven times that is 151
   * units of braking, and Jupiter's own track is inside it: the probe spent
   * the whole of the Jupiter-to-Saturn leg decelerating for something it
   * could not yet see, and that one leg came to twenty-seven seconds against
   * eleven and twelve for the two before it.
   *
   * Seventy-eight is five and a half times Saturn's own ring sheet, which is
   * as much warning as anything here needs. Measured over the route: the
   * Jupiter leg goes from 26.6 seconds to 19.4 and the whole flight from 54
   * to 45.7, with nothing else about the pacing touched. */
  private static readonly VOYAGER_CRUISE_RANGE_MAX = 78;
  /** How much the cruise speed grows with distance from the star.
   *
   * A flat cruise speed makes the outer legs drag, and not because the number
   * is wrong — because the system is not to scale with itself. Earth to Mars
   * is twenty-five units; Neptune to the neutron pair and on to the hole is
   * the better part of eight hundred. At one speed for both, the leg that has
   * the least to look at takes the longest to cross, which is exactly the
   * wrong way round. Scaling with radius makes the outer legs cost roughly
   * what the inner ones do in time rather than in distance. */
  private static readonly VOYAGER_CRUISE_GROWTH = 180;
  /** How close a leg's straight line may come to the star before the route is
   * bowed around it. Comfortably outside the corona, which reaches 3.4 × the
   * star's own radius. See the guard points in flyGrandTour. */
  private static readonly VOYAGER_SUN_KEEPOUT = 62;

  /** Stops the probe goes into orbit around rather than merely passing.
   *
   * Saturn earns it and the others do not. A fly-by shows you a planet from
   * one side, moving, for as long as the pass lasts — which for a ball is
   * enough, because the far side of a ball looks like the near side. Saturn is
   * not a ball: it is a disc system seen at an angle, and the angle is the
   * whole subject. One pass gives you one angle of it and then the tour has
   * gone; one turn gives you the rings edge-on, open, and edge-on again.
   *
   * One rather than the two it had. The second turn shows the same three
   * views the first one did, and it costs seven seconds immediately before
   * the twenty-five the arrival at the wormhole now takes — which is the
   * stretch of the tour that can least afford to be preceded by a repeat.
   *
   * The neutron pair used to take one too, before it came off the route. */
  private static readonly VOYAGER_ORBIT_AT = new Map([["saturn", 1]]);
  /** How long one turn takes.
   *
   * Nine, down from the fourteen it got when the speeds were halved and this
   * was doubled to match. The turn exists to show the rings edge-on, open and
   * edge-on again — three views — and fourteen seconds is longer than three
   * views take: past about nine it stops being a manoeuvre and becomes a wait
   * for one to finish. The swoop that dips through the middle of it is
   * parameterised by how far round it has got rather than by seconds, so it
   * keeps its shape at any period. */
  private static readonly VOYAGER_ORBIT_PERIOD = 9;
  /** How far in the orbit dips at its closest, as a fraction of the radius it
   * was entered at. See the swoop in flyGrandTour's loiter branch. */
  private static readonly VOYAGER_ORBIT_DIP = 0.55;
  /** And how close it is ever allowed to get, in multiples of the body's own
   * reach — which for Saturn is the outer edge of the ring sheet, so this is
   * the number that keeps the craft from flying through the rings. */
  private static readonly VOYAGER_ORBIT_FLOOR = 1.45;
  /** How long the ambient coast takes, launch to gone. Doubled, so the ship
   * drifting across the resting sky moves at the same pace it tours at. */
  private static readonly VOYAGER_COAST = 300;
  /** How fast the ring turns, in radians a second. One revolution every three
   * seconds — still far quicker than the film's 5.6 rpm, because at the size
   * this ship is drawn a wheel that takes ten seconds to come round is a wheel
   * nobody sees turn, but slow enough to read as a ship under way rather than
   * as a fairground ride. */
  private static readonly ENDURANCE_SPIN = (Math.PI * 2) / 3;

  /** Starts or stops the grand tour. Starting it always restarts from Earth:
   * the tour is a thing you watch from the beginning, and resuming it from
   * wherever the ambient coast happened to be would open on empty sky. */
  setVoyagerTour(on: boolean) {
    /* No-op when it is already in that state. The shell mirrors this flag in
       React state and pushes it back down through an effect, so without this
       the mount would fire a stop — and a stop calls resetCamera(), which
       would cut the opening flight short on every load. */
    if (on === this.voyagerTour) return;
    this.voyagerTour = on;
    this.voyagerTourU = 0;
    if (on) {
      // It takes the camera, so nothing else may be holding it.
      this.cancelFinale();
      this.tourEnabled = false;
      this.selectedKey = "voyager";
      this.followAnchor = null;
      this.flight = null;
      this.controls.autoRotate = false;
      this.idleFor = 0;
      this.voyagerChase.set(0, 0, 0);
      this.voyagerHeading.set(0, 0, 0);
      this.voyagerLoiter = -1;
      this.voyagerLoiterAngle = 0;
      this.voyagerLoitered = HubScene.VOYAGER_ROUTE.map(() => false);
      this.voyagerPassed = HubScene.VOYAGER_ROUTE.map(() => false);
      this.voyagerStop = 0;
      this.voyagerStopDist = Infinity;
    } else {
      this.selectedKey = null;
      this.resetCamera();
    }
    this.callbacks.onVoyagerTour(on);
  }

  /** Where the probe is, and — during the grand tour — where the camera is.
   *
   * Two quite different journeys share this. The ambient one is a function of
   * the clock: the probe launches from wherever Earth was when it left, coasts
   * outward, and stops being drawn once it is well clear of the outermost
   * orbit. That last part is the point of it — the old rig started outside
   * Neptune and ran out to 830 units, which is past the resting camera by a
   * factor of three, so the probe was almost never on screen at all. A craft
   * that leaves from somewhere you were looking and disappears into the dark
   * is a craft you see leave.
   *
   * The grand tour is the other one: the planets in order, the camera behind
   * the probe, and a swing-by at each. Its progress is integrated rather than
   * taken from the clock, because unlike everything else the hole and the sky
   * do, this one is started by a person and has to begin when they start it. */
  private updateVoyager(time: number, speed: number, dt: number) {
    /* The ring turns whatever else the ship is doing, and it is the one part
       of this scene that must never stop: the whole reason the Endurance is
       a ring is that spinning it is where the crew's gravity comes from, and
       a stationary one is a diagram of the ship rather than the ship. Ahead
       of the branch so it runs on the tour and on the ambient coast alike.
       Roughly a turn every eight seconds at normal speed, which is slow
       enough to read as deliberate and fast enough to be unmistakable. */
    this.enduranceRing.rotation.z += dt * speed * HubScene.ENDURANCE_SPIN;

    if (this.voyagerTour) {
      this.flyGrandTour(dt);
      return;
    }

    const p = ((time * speed) % HubScene.VOYAGER_COAST) / HubScene.VOYAGER_COAST;

    /* Where Earth was when this run launched. Taken by rotating Earth's
       *current* position backwards through the angle it has swept since —
       which is exact, needs no stored launch state, and does not depend on
       knowing which way round the orbit's phase is measured. A launch angle
       captured in a variable at the moment of wrap would be missed by a tab
       that was in the background for that frame. */
    const earth = this.earthRig;
    let launch = 2.35;
    if (earth) {
      earth.body.getWorldPosition(this.tmpV);
      const swept = ((p * HubScene.VOYAGER_COAST) / earth.spec.period) * Math.PI * 2;
      launch = Math.atan2(this.tmpV.z, this.tmpV.x) - swept;
    }

    /* Out of the system over the first two-thirds of the cycle, and gone for
       the rest of it. The gap is deliberate: a probe that reappears at Earth
       the instant it vanishes past Neptune is on a loop, and a loop is not a
       departure. */
    const gone = this.voyagerEdge * 1.3;
    const span = (gone - this.voyagerLaunchRadius) / 0.68;
    const distance = this.voyagerLaunchRadius + p * span;

    if (distance >= gone) {
      this.voyager.visible = false;
      return;
    }
    this.voyager.visible = true;

    /* Fading over the last stretch rather than blinking out at the line. The
       craft is small and the sky behind it is busy, so a hard cut reads as a
       dropped frame rather than as distance. */
    const fadeFrom = this.voyagerEdge * 1.06;
    const opacity = 1 - clamp01((distance - fadeFrom) / (gone - fadeFrom));
    for (const m of this.voyagerMaterials) m.opacity = opacity;

    // A gentle curve, and a climb out of the ecliptic — which the real one did
    // too, though only after Saturn threw it there.
    const angle = launch + p * 0.55;
    const climb = (distance - this.voyagerLaunchRadius) * 0.34;
    // Kept, because aimVoyager reads the heading off one frame of movement and
    // the ambient coast used not to record one — the ship pointed wherever it
    // had last been left, which on the coast is straight out of the tour.
    this.voyagerPrev.copy(this.voyager.position);
    this.voyager.position.set(Math.cos(angle) * distance, climb, Math.sin(angle) * distance);
    this.aimVoyager(dt);
  }

  /** One frame of the grand tour: the probe along the route, and the camera
   * behind it.
   *
   * The route is rebuilt from live planet positions every frame rather than
   * sampled once at the start. Over seventy seconds the inner planets move a
   * long way round, and a path baked at launch would have the probe swinging
   * past where Mars used to be. */
  private flyGrandTour(dt: number) {
    if (!this.voyagerCurve) {
      /* One point per stop and no more. There used to be two extra on the end
         carrying the probe out into the dark past Neptune; the route does not
         end at Neptune any more, and a leg into empty sky after the hole would
         be a leg after the ending. */
      this.voyagerRoute = HubScene.VOYAGER_ROUTE.map(() => new THREE.Vector3());
      this.voyagerCenters = HubScene.VOYAGER_ROUTE.map(() => new THREE.Vector3());
      this.voyagerReach = HubScene.VOYAGER_ROUTE.map(() => 0);
      /* One guard point between every pair of stops, and the curve is run
         through stop, guard, stop, guard… rather than through the stops alone.
         See the loop that places them: they are what keeps the route from
         cutting the corner between two planets, and the corner between two
         planets is the sun.
         Always present rather than inserted only where a leg needs one: the
         parameter u is spread over however many control points there are, so a
         guard appearing partway through the flight would shift every position
         after it and the probe would jump. A guard on a leg that does not need
         one sits at that leg's own midpoint and does nothing. */
      this.voyagerGuards = HubScene.VOYAGER_ROUTE.slice(1).map(() => new THREE.Vector3());
      const woven: THREE.Vector3[] = [];
      for (let i = 0; i < this.voyagerRoute.length; i++) {
        woven.push(this.voyagerRoute[i]);
        if (i < this.voyagerGuards.length) woven.push(this.voyagerGuards[i]);
      }
      this.voyagerCurve = new THREE.CatmullRomCurve3(woven, false, "catmullrom", 0.4);
    }

    /* How far from the camera a sphere of radius R has to be to fit inside the
       frame: R / tan(fov/2), vertically. Read off the live camera because the
       fov is chosen from the viewport's shape — a phone held upright runs at
       58° and a wide desktop at 46°, and a clearance tuned for one of those
       puts the planet through the edge of the frame on the other. */
    const fit = 1 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);

    for (let i = 0; i < HubScene.VOYAGER_ROUTE.length; i++) {
      const key = HubScene.VOYAGER_ROUTE[i];
      const point = this.voyagerRoute[i];
      /* Planets first, because only they carry a ring spec — and Saturn's is
         more than twice its own radius, so a stop measured by the body alone
         would put the probe inside the rings. Everything else on the route is
         a landmark, and its BodyInfo.size is the figure the rest of the scene
         already frames it by. */
      const planet = this.planets.find((p) => p.spec.key === key);
      const pickable = planet ? null : this.pickables.find((p) => p.info.key === key);
      if (!planet && !pickable) {
        // A body this tier dropped: leave the stop where it was and skip it.
        this.voyagerReach[i] = 0;
        continue;
      }
      if (planet) planet.body.getWorldPosition(point);
      else pickable!.anchor.getWorldPosition(point);
      this.voyagerCenters[i].copy(point);

      /* Past the planet, not through it.
       *
       * The offset used to be a flat 4.5% of the planet's *orbital* radius,
       * which is a number about the system and not about the planet: at
       * Jupiter it came to six units of clearance around a body nine units
       * across, so the probe flew through it, and at Saturn it passed inside
       * the rings. What the clearance has to be measured against is the
       * planet's own extent — its radius, or the outer edge of its ring sheet
       * where it has one, which at Saturn is more than twice the planet.
       *
       * And it has to be at least far enough away to see the thing. `fit` is
       * the distance at which the body exactly fills the frame's height; a
       * quarter more than that leaves it framed with air around it, which is
       * what "the whole planet on screen" means. The floor of eight keeps the
       * small inner planets from being flown through at arm's length. */
      const reach = planet
        ? planet.spec.size * (planet.spec.ring ? planet.spec.ring.outer : 1)
        : pickable!.info.size;
      const clear = Math.max(reach * 2.6, reach * fit * 1.25, 8);
      this.voyagerReach[i] = reach;

      /* Which way to stand off. Sideways, mostly — the route runs outward from
         the sun, so an outward offset is *along* the flight path and would put
         the probe on a collision course with the planet it is offset from
         rather than beside it. The tangent is across that path. Sides
         alternate so the probe weaves through the system instead of passing
         every planet on the same hand, and the vertical share grows along the
         route, which is the climb out of the ecliptic. */
      const radial = this.tmpV3.set(point.x, 0, point.z);
      if (radial.lengthSq() < 1e-6) radial.set(0, 0, 1);
      radial.normalize();
      const side = i % 2 === 0 ? 1 : -1;
      const up = 0.34 + i * 0.07;
      const flat = Math.sqrt(Math.max(0, 1 - up * up));
      point.x += -radial.z * side * flat * clear;
      point.z += radial.x * side * flat * clear;
      point.y += up * clear;
    }

    /* Round the sun, not through it.
     *
     * The stops are wherever the planets happen to be, and two consecutive
     * planets are regularly on opposite sides of the star — Earth at one
     * o'clock and Mars at seven. The shortest path between those two points
     * goes straight through the middle, and the middle is the sun. It is not a
     * rare case either: over a tour this long the inner planets sweep most of
     * the way round, so the leg out of Earth passes through the star for a
     * good fraction of all the times anybody starts one.
     *
     * The fix is a point on each leg placed on the *angular* bisector rather
     * than on the chord — half way round rather than half way across — at a
     * radius no smaller than the two ends'. That bows every leg outward around
     * the star, by a lot when the two stops are opposed and by nothing at all
     * when they are already close together in angle. The keep-out floor covers
     * the remaining case: two stops close in angle but both near the sun, where
     * the bisector is short enough to graze it anyway.
     *
     * And it is faded in by how much the leg actually needs it, rather than
     * applied to all of them. The bow is a detour, and a leg that was never
     * going anywhere near the star pays for it anyway: the two outermost legs
     * — Neptune out to the neutron pair and on to the hole — pass a clear two
     * hundred units from the sun, and the bisector construction was swinging
     * them out around a star they were never in danger of touching. So the
     * guard sits at the leg's own midpoint when the straight line already
     * clears the keep-out, at the bisector when the line runs through the
     * star, and between the two in between. */
    for (let i = 0; i < this.voyagerGuards.length; i++) {
      const a = this.voyagerRoute[i];
      const b = this.voyagerRoute[i + 1];
      const guard = this.voyagerGuards[i];

      const angleA = Math.atan2(a.z, a.x);
      const angleB = Math.atan2(b.z, b.x);
      /* Unwrapped to the short way round, so the bow goes the way the leg is
         already going. Left wrapped, a leg crossing the ±π seam would put its
         guard point on the far side of the system and the probe would fly all
         the way round the sun to reach a planet next door. */
      let sweep = (angleB - angleA) % (Math.PI * 2);
      if (sweep > Math.PI) sweep -= Math.PI * 2;
      if (sweep < -Math.PI) sweep += Math.PI * 2;
      const mid = angleA + sweep * 0.5;

      const radiusA = Math.hypot(a.x, a.z);
      const radiusB = Math.hypot(b.x, b.z);
      /* Outside both ends rather than between them. Half way between two radii
         is still inside the outer orbit, and on a leg that has to bow a long
         way round it is the bow itself that has to clear the star. */
      const radius = Math.max((radiusA + radiusB) * 0.5, SUN_RADIUS * 3.4);
      // Lifted over the midpoint of the two, so the bow rises as the route does
      // rather than dropping back to the ecliptic between every pair.
      const lift = (a.y + b.y) * 0.5 + 3;
      guard.set(Math.cos(mid) * radius, lift, Math.sin(mid) * radius);

      /* How close the plain chord comes to the star, in the plane — the foot of
         the perpendicular from the origin, clamped to the segment so a leg that
         points away from the star is measured from its own near end rather than
         from a point behind it. */
      const legX = b.x - a.x;
      const legZ = b.z - a.z;
      const legSq = legX * legX + legZ * legZ;
      const foot = legSq > 1e-9 ? clamp01(-(a.x * legX + a.z * legZ) / legSq) : 0;
      const graze = Math.hypot(a.x + legX * foot, a.z + legZ * foot);
      const need = clamp01((HubScene.VOYAGER_SUN_KEEPOUT - graze) / HubScene.VOYAGER_SUN_KEEPOUT);
      // Smoothed, because this is recomputed every frame off moving planets and
      // a guard point that slid linearly in and out would put a kink in the
      // route each time a leg crossed the threshold.
      this.tmpV3.set((a.x + b.x) * 0.5, lift, (a.z + b.z) * 0.5);
      guard.lerp(this.tmpV3, 1 - need * need * (3 - 2 * need));
    }

    this.voyager.visible = true;
    for (const m of this.voyagerMaterials) m.opacity = 1;

    /* How close the probe is to the nearest thing worth slowing down for,
       measured from where it got to last frame. Both the speed law below and
       the framing further down are functions of it. */
    let nearest = -1;
    let nearDist = Infinity;
    /* And, over the stops it has not reached yet, how hard the nearest of them
       is braking: 0 out in the gaps, 1 at the stand-off distance. The speed law
       reads this one, the framing reads the other.

       That difference is the whole of "leave when you are done". A stop that is
       behind the probe does not slow it down — otherwise the tour crawls away
       from every fly-by for as long as it takes to get out of the window it
       came in through, which is a probe hanging about beside something it has
       already shown you. Past it, the throttle opens at once.

       The ramp is per-stop rather than taken from one distance, because the
       ranges are now the bodies' own — see VOYAGER_PASS_RANGE. Two stops whose
       windows overlap each brake by their own measure and the deeper of the
       two wins, which is the one the probe is closer to *relative to its
       size*, not simply the closer one. */
    let brake = 0;
    for (let i = 0; i < this.voyagerReach.length; i++) {
      if (this.voyagerReach[i] <= 0) continue;
      const d = this.voyagerCenters[i].distanceTo(this.voyager.position);
      if (d < nearDist) {
        nearDist = d;
        nearest = i;
      }
      if (this.voyagerPassed[i]) continue;
      const near = Math.max(
        this.voyagerReach[i] * HubScene.VOYAGER_PASS_RANGE,
        HubScene.VOYAGER_PASS_RANGE_MIN
      );
      const far = Math.min(
        Math.max(this.voyagerReach[i] * HubScene.VOYAGER_CRUISE_RANGE, HubScene.VOYAGER_CRUISE_RANGE_MIN),
        HubScene.VOYAGER_CRUISE_RANGE_MAX
      );
      brake = Math.max(brake, 1 - clamp01((d - near) / (far - near)));
    }

    /* Which stop is still ahead. It drops behind — and stops braking — once the
       probe has been inside its window and has started to recede from it again,
       which is the earliest moment at which "we have seen this one" is true of
       a path that is rebuilt every frame and has no fixed arc length to test
       against. A stop this tier dropped has no reach and is skipped outright,
       or the cursor would stick on it and brake for a body that is not there. */
    if (this.voyagerStop < HubScene.VOYAGER_ROUTE.length) {
      const i = this.voyagerStop;
      const key = HubScene.VOYAGER_ROUTE[i];
      // Not before it has been round the ones it is meant to go round.
      const owed = HubScene.VOYAGER_ORBIT_AT.has(key) && !this.voyagerLoitered[i];
      if (this.voyagerReach[i] <= 0) {
        this.voyagerPassed[i] = true;
        this.voyagerStop++;
      } else if (!owed && this.voyagerLoiter < 0) {
        const d = this.voyagerCenters[i].distanceTo(this.voyager.position);
        const window = Math.min(
          Math.max(this.voyagerReach[i] * HubScene.VOYAGER_CRUISE_RANGE, HubScene.VOYAGER_CRUISE_RANGE_MIN),
          HubScene.VOYAGER_CRUISE_RANGE_MAX
        );
        if (d < window && d > this.voyagerStopDist) {
          this.voyagerPassed[i] = true;
          this.voyagerStop++;
          this.voyagerStopDist = Infinity;
        } else {
          this.voyagerStopDist = d;
        }
      }
    }

    /* Arriving somewhere worth going round. The trigger is proximity rather
       than a position along the path, because the path is rebuilt every frame
       from moving planets and the arc length of "level with Saturn" is not a
       fixed number. Each stop fires once per run — `voyagerLoitered` — or the
       probe would re-enter orbit on the frame it left and never get out. */
    if (
      this.voyagerLoiter < 0 &&
      nearest >= 0 &&
      !this.voyagerLoitered[nearest] &&
      HubScene.VOYAGER_ORBIT_AT.has(HubScene.VOYAGER_ROUTE[nearest]) &&

      nearDist < Math.max(this.voyagerReach[nearest] * 4.2, 46)
    ) {
      this.beginLoiter(nearest);
    }

    // Left at zero while circling, which also keeps the arrival check at the
    // bottom from firing on a path position that is not being advanced.
    let u = 0;
    if (this.voyagerLoiter >= 0) {
      /* Circling. The path is left exactly where it was — `voyagerTourU` does
         not advance — and the probe is driven round a circle whose first point
         is the point it stopped at. Three full turns bring it back to that
         point to within floating error, so rejoining is not a transition: it
         is the same position, and the next frame simply resumes moving from
         it. That is the whole reason the frame is captured on entry rather
         than recomputed from the planet each frame — a circle around a planet
         that is itself moving does not close. */
      this.voyagerLoiterAngle += ((Math.PI * 2) / HubScene.VOYAGER_ORBIT_PERIOD) * dt;
      const sweep = Math.PI * 2 * this.loiterTurns;
      const done = this.voyagerLoiterAngle >= sweep;

      /* And it comes in while it is round there. Orbiting at the radius the
         route passes at is orbiting at the distance chosen for *seeing the
         whole thing at once*, which is a long way out — going round twice at
         arm's length shows the same view twice. So the radius dips through the
         middle of the manoeuvre and returns to exactly what it was by the end.
         The sine is what makes it return: it is zero at both ends of the
         sweep, so the last frame of the orbit is the first frame's position
         and the path can be rejoined with no step at all. */
      const through = clamp01(this.voyagerLoiterAngle / sweep);
      const radius = this.loiterRadius * (1 - this.loiterDip * Math.sin(Math.PI * through));

      const a = Math.cos(this.voyagerLoiterAngle);
      const b = Math.sin(this.voyagerLoiterAngle);
      this.voyagerPrev.copy(this.voyager.position);
      this.voyager.position
        .copy(this.loiterCenter)
        .addScaledVector(this.loiterAxisA, a * radius)
        .addScaledVector(this.loiterAxisB, b * radius);
      /* The planet moves along its own orbit while this is going on, and the
         circle was pinned to where it was. Carried along with it, so three
         turns around Saturn are three turns around Saturn rather than three
         turns around a point Saturn has since left. */
      this.loiterCenter.copy(this.voyagerCenters[this.voyagerLoiter]).add(this.loiterOffset);
      if (done) {
        this.voyagerLoitered[this.voyagerLoiter] = true;
        this.voyagerLoiter = -1;
      }
      this.aimVoyager(dt);
    } else {
      /* The speed law. Distance travelled is integrated rather than derived
         from a clock, so the pace is stated as a speed and the tour takes
         however long that comes to — which is the right way round when what
         matters is how fast the probe is going past things, not how long the
         whole trip is. */
      const open = 1 - brake;
      // Smoothed at both ends, so leaving a planet is an acceleration and
      // arriving at the next is a deceleration rather than two step changes.
      const throttle = open * open * (3 - 2 * open);
      // Faster the further out it is; see VOYAGER_CRUISE_GROWTH.
      const fromStar = Math.hypot(this.voyager.position.x, this.voyager.position.z);
      const cruise = HubScene.VOYAGER_CRUISE_SPEED * (1 + fromStar / HubScene.VOYAGER_CRUISE_GROWTH);
      const speed = HubScene.VOYAGER_PASS_SPEED + (cruise - HubScene.VOYAGER_PASS_SPEED) * throttle;

      this.voyagerCurve.updateArcLengths();
      /* One frame's worth of arc, as a share of the whole route. getPointAt,
         not getPoint: the step above is a real distance, so the parameter it is
         added to has to be the arc-length one. Feeding it to the raw spline
         parameter would put the speed law back at the mercy of how the control
         points happen to be spaced — and would also break the one property this
         being an increment buys, which is that the route changing shape behind
         the probe cannot move the probe. See voyagerTourU. */
      this.voyagerTourU = clamp01(
        this.voyagerTourU + (speed * dt) / Math.max(this.voyagerCurve.getLength(), 1)
      );
      u = this.voyagerTourU;
      this.voyagerPrev.copy(this.voyager.position);
      this.voyagerCurve.getPointAt(u, this.voyager.position);
      this.aimVoyager(dt);
    }

    /* The chase. Behind the probe along its own heading and a little above it,
       which shows the craft and where it is going in one frame — a true view
       from the cockpit would be a view of the back of a dish.

       The heading is smoothed as well as the position. It is derived from one
       frame's worth of movement, and at this speed that is a very small vector
       whose direction jitters; feeding that straight into the camera offset
       put a shiver on everything. Both easings are exponential in dt rather
       than a fixed fraction per frame, so the smoothing lasts the same wall
       time at 30fps as at 144 — a per-frame lerp is four times faster on a
       fast machine, which is the wrong way round. */
    const step = this.tmpV.copy(this.voyager.position).sub(this.voyagerPrev);
    if (step.lengthSq() > 1e-10) {
      this.voyagerHeading.lerp(step.normalize(), 1 - Math.exp(-dt * 2.2));
      if (this.voyagerHeading.lengthSq() > 1e-8) this.voyagerHeading.normalize();
    }
    if (this.voyagerHeading.lengthSq() < 1e-8) this.voyagerHeading.set(0, 0, 1);

    /* How much of a fly-by this is: `close` runs 0 out in the gaps and 1 at
       the moment of the pass. The nearest body was found above, for the speed
       law — one search serves both, and both want it measured against the same
       position. */
    const reach = nearest >= 0 ? this.voyagerReach[nearest] : 0;
    // The window scales with the planet: Jupiter is worth framing from much
    // further out than Mars, and a fixed distance would mean the same.
    const window = Math.max(reach * 9, 40);
    const close = nearest >= 0 ? 1 - clamp01(nearDist / window) : 0;
    const ease = close * close * (3 - 2 * close);

    /* Back off during a pass, by an amount the planet's own size sets. Chasing
       at a fixed sixteen units framed the craft beautifully and cut the planet
       in half, which is the complaint this answers: what the tour is showing
       at that moment is the planet, and the craft is the thing in front of it.
       Scaled to the craft otherwise.

       The out-of-pass figure went from 6.4 to 9.4 with the ship. The probe was
       2.5 units end to end and the Endurance's ring is 3.8 across, so at the
       old stand-off it subtended half the frame's height and its far side ran
       off the edge — the ring is the one shape here that has to be seen whole
       or it is not a ring. */
    const back = 9.4 + ease * (reach * fit * 0.85 + 6);
    const want = this.tmpV2.copy(this.voyager.position).addScaledVector(this.voyagerHeading, -back);
    want.y += 3.2 + ease * reach * 0.5;
    if (this.voyagerChase.lengthSq() < 1e-6) this.voyagerChase.copy(want);
    else this.voyagerChase.lerp(want, 1 - Math.exp(-dt * 1.9));

    /* And look between the two rather than at the probe. Distance alone does
       not put a planet in the frame — it puts it *somewhere*, and off the side
       of a shot centred on something else is somewhere. Halfway is enough:
       the craft stays comfortably in frame and the planet comes off the edge
       and into the picture. */
    const aim = this.tmpV3.copy(this.voyager.position);
    if (nearest >= 0) aim.lerp(this.voyagerCenters[nearest], ease * 0.5);

    this.camera.position.copy(this.voyagerChase);
    this.controls.target.copy(aim);
    this.focusFloor = 1.2;

    /* Arrived at the wormhole, which is where this route ends and the other
       thing begins. Handing the camera back to the resting view here would end
       the tour by cutting away from the one object the probe has spent three
       minutes flying to; instead the ending takes over from exactly where the
       chase left the camera, and goes through it.

       Unwound by hand rather than through setVoyagerTour(false), which calls
       resetCamera() and would throw the camera back across the system on the
       very frame the dive is starting. */
    if (u >= 1) {
      this.voyagerTour = false;
      this.voyagerTourU = 0;
      this.callbacks.onVoyagerTour(false);
      this.beginFinale("wormhole");
    }
  }

  /** Puts the probe into orbit around one of its stops.
   *
   * The circle is built from where the probe already is rather than from a
   * chosen radius and phase: its centre is the planet, its first point is the
   * probe, and its plane contains the direction the probe was travelling in.
   * All three together mean the orbit is entered tangentially — the craft does
   * not turn to get into it — and that a whole number of turns ends where it
   * started, which is what lets the path be rejoined without a seam. */
  private beginLoiter(stop: number) {
    this.voyagerLoiter = stop;
    this.voyagerLoiterAngle = 0;
    this.loiterTurns = HubScene.VOYAGER_ORBIT_AT.get(HubScene.VOYAGER_ROUTE[stop]) ?? 1;

    const center = this.voyagerCenters[stop];
    /* Lifted a little out of the planet's own plane so three turns are not
       three passes through the ring sheet edge-on — the point of circling
       Saturn is to see the rings open and close, which needs the orbit to be
       inclined to them. */
    this.loiterOffset.set(0, this.voyagerReach[stop] * 0.22, 0);
    this.loiterCenter.copy(center).add(this.loiterOffset);

    this.loiterAxisA.copy(this.voyager.position).sub(this.loiterCenter);
    this.loiterRadius = this.loiterAxisA.length();
    if (this.loiterRadius < 1e-3) {
      // Degenerate: the probe is on top of the body. Should not happen with the
      // stand-off the route is built with, but a zero radius would produce a
      // NaN basis and put the craft at the origin.
      this.voyagerLoiter = -1;
      this.voyagerLoitered[stop] = true;
      return;
    }
    this.loiterAxisA.divideScalar(this.loiterRadius);

    /* How far in it may come. The configured dip, unless that would put the
       closest point inside the body's own reach — at Saturn that reach is the
       outer edge of the rings, and a swoop that ignored it would take the
       craft through the ring sheet rather than under it. */
    const floor = this.voyagerReach[stop] * HubScene.VOYAGER_ORBIT_FLOOR;
    this.loiterDip = Math.min(
      HubScene.VOYAGER_ORBIT_DIP,
      Math.max(0, 1 - floor / this.loiterRadius)
    );

    /* The second axis: the component of the heading perpendicular to the
       first, so the circle carries on the way the probe was already going. */
    this.loiterAxisB
      .copy(this.voyagerHeading)
      .addScaledVector(this.loiterAxisA, -this.voyagerHeading.dot(this.loiterAxisA));
    if (this.loiterAxisB.lengthSq() < 1e-6) {
      // Heading straight at the planet: any perpendicular will do.
      this.loiterAxisB.set(0, 1, 0).cross(this.loiterAxisA);
      if (this.loiterAxisB.lengthSq() < 1e-6) this.loiterAxisB.set(1, 0, 0).cross(this.loiterAxisA);
    }
    this.loiterAxisB.normalize();
  }

  /** Nose-on to where it is going.
   *
   * The probe this replaced kept its dish pointed at Earth, which is what
   * that craft actually did and was the right rule for it. A ring is
   * different: its axis is its direction of travel, and a ring seen from any
   * other angle is an ellipse with things on it. So the axis — local +Z,
   * which is what the model is built about — is laid along the heading.
   *
   * Smoothed, and exponentially in dt rather than by a fixed fraction per
   * frame, so the turn takes the same wall time at 30fps as at 144. The
   * heading is derived from one frame of movement and at these speeds that is
   * a very small vector whose direction jitters; fed in raw it puts a shiver
   * on the whole ship. */
  private aimVoyager(dt = 0.016) {
    const step = this.tmpV.copy(this.voyager.position).sub(this.voyagerPrev);
    if (step.lengthSq() > 1e-10) {
      this.voyagerNose.lerp(step.normalize(), 1 - Math.exp(-dt * 3.2));
      if (this.voyagerNose.lengthSq() > 1e-8) this.voyagerNose.normalize();
    }
    if (this.voyagerNose.lengthSq() < 1e-8) this.voyagerNose.set(0, 0, 1);
    /* lookAt puts local -Z on the target, and the ring is built about +Z, so
       it is aimed at a point BEHIND the ship. Pointing it forward instead
       flies the ring backwards through itself, which on a shape this
       symmetrical is invisible until the Rangers are seen trailing. */
    this.voyagerAimAt.copy(this.voyager.position).addScaledVector(this.voyagerNose, -1);
    this.voyager.lookAt(this.voyagerAimAt);
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

  /** Seconds between raycasts when the pointer is sitting still.
   *
   * A move is answered on the frame it happens — that is the interaction and
   * it must not lag. What does not need answering sixty times a second is a
   * stationary pointer: the only thing that can change under it is a body
   * drifting along its orbit, which at this scale takes seconds to cross a
   * cursor. Twelve casts a second covers that and drops roughly four fifths of
   * the raycasting work on a desktop, where the pointer is over the canvas the
   * whole time and mostly not moving. */
  private static readonly HOVER_IDLE_INTERVAL = 1 / 12;

  private updateHover(dt: number) {
    if (!this.pointerInside || this.flight) return;
    if (this.pointerMoved) {
      this.pointerMoved = false;
      this.hoverClock = 0;
    } else {
      this.hoverClock += dt;
      if (this.hoverClock < HubScene.HOVER_IDLE_INTERVAL) return;
      this.hoverClock = 0;
    }
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
    /* Two sources, one uniform: the merger's burst and a dive's white-out. They
       cannot overlap in practice — a dive is the last second of the page — but
       the tint has to pick one, and the dive is the one the visitor asked for. */
    grade.uFlash.value = this.flash * 0.55 + this.diveFlash;
    /* Written into the array the uniform already holds rather than handed a
       new one. Two literals a frame is nothing on its own; it is one of about
       a dozen such sites, and together they were the reason this scene made
       garbage at a steady rate with nothing happening in it. A collection
       pause is a dropped frame, and on a phone it is several. */
    const tint = grade.uFlashTint.value as number[];
    if (this.diveFlash > 0.001) {
      tint[0] = this.diveTint.r;
      tint[1] = this.diveTint.g;
      tint[2] = this.diveTint.b;
    } else {
      tint[0] = 1.0;
      tint[1] = 0.98;
      tint[2] = 0.94;
    }
    grade.uWarp.value = this.warp;
    grade.uFade.value = this.fade;
    grade.uCollapse.value = this.collapse;
    grade.uTunnel.value = this.tunnel;
    grade.uMouth.value = this.tunnelMouth;
    grade.uInside.value = this.insideHole;
    // Into the array the uniform already holds, like uFlashTint above.
    const lean = grade.uLean.value as number[];
    lean[0] = this.tunnelLean[0];
    lean[1] = this.tunnelLean[1];
    grade.uStatic.value = this.tvStatic;
    grade.uPlate.value = this.plate;
    grade.uRipple.value = this.ripple;
    grade.uAberration.value = 1 + this.warp * 1.4;
    const centred = this.diveFlash > 0.001 || this.flight?.dive;
    const gc = grade.uCenter.value as number[];
    gc[0] = centred ? this.diveCenter[0] : 0.5;
    gc[1] = centred ? this.diveCenter[1] : 0.5;

    if (!this.lensPass) return;
    const lens = this.lensPass.uniforms;
    // Off the last resize, not measured here — see viewW.
    lens.uAspect.value = Math.max(this.viewW, 1) / Math.max(this.viewH, 1);
    lens.uTime.value = time;
    lens.uFeed.value = this.feed;

    /* Two masses bend this frame, and they are aimed the same way — see
       aimLens. Both world positions are this frame's, worked out by
       updateBlackHole and updateWormhole, which both run before this. */
    this.aimLens(this.holeWorld, HOLE_HORIZON, lens.uCenter.value as number[], lens.uRadius, lens.uStrength);
    this.aimLens(
      this.wormholeWorld,
      WORMHOLE_RADIUS,
      lens.uCenter2.value as number[],
      lens.uRadius2,
      lens.uStrength2,
      true,
    );

    /* And when neither mass is bending anything — which is the resting scene,
       with the hole out past the edge of the frame — the pass is switched off
       rather than run.

       The shader already knew: its first two lines test exactly this and fall
       through to a straight copy of the frame. But a straight copy is still a
       full-screen pass. It reads five million texels and writes five million
       more, and it costs a ping-pong between the composer's two half-float
       targets, every frame, to arrive at the image it was handed. The test
       belongs one level up, where the answer is "do not draw" rather than
       "draw the same thing". The thresholds are the shader's own, so the pass
       goes out exactly when it stops having anything to do. */
    this.lensPass.enabled =
      (lens.uStrength.value > 0.001 && lens.uRadius.value > 0.0001) ||
      (lens.uStrength2.value > 0.001 && lens.uRadius2.value > 0.0001);
  }

  /** Where a body sits on screen and how big it looks, in the units the
   * lensing pass works in.
   *
   * Both come straight out of the projection rather than being tuned by hand,
   * so the effect stays locked to the body at any camera distance. Written
   * into the uniforms rather than returned, because the two callers want them
   * in different uniforms and a returned object would be one allocation per
   * body per frame for a result that is read once and thrown away.
   *
   * `world` must not be one of tmpV/tmpV2/tmpV3 — all three are scratch here.
   *
   * `exact` is about how close the camera is allowed to get. The plain figure
   * below is the small-angle one: it treats the silhouette as the sphere's own
   * radius, which is right to within a percent from any normal viewing
   * distance and wrong by half with the camera up against the body. The
   * wormhole is a body you are meant to go and put your face against, and its
   * deflection is an annulus keyed to where its edge is, so it takes the exact
   * silhouette. The hole does not, and deliberately: it grows without bound as
   * the camera reaches the horizon, and the tour's ending flies right into it
   * — the finale is tuned against the figure the hole has always used. */
  private aimLens(
    world: THREE.Vector3,
    bodyRadius: number,
    center: number[],
    radius: THREE.IUniform,
    strength: THREE.IUniform,
    exact = false,
  ) {
    const toBody = this.tmpV3.copy(world).sub(this.camera.position);
    const forward = this.camera.getWorldDirection(this.tmpV2);
    // Behind the camera, where `project` would put it back on screen mirrored.
    if (toBody.dot(forward) <= 1) {
      strength.value = 0;
      return;
    }

    const distance = toBody.length();
    this.tmpV.copy(world).project(this.camera);
    /* Texture space, NOT DOM space. A full-screen quad's `uv` has v = 0 at the
       BOTTOM of the frame, so NDC maps straight through with no flip — unlike
       the label projection above, which is writing CSS pixels and does have to
       invert Y. Flipping here put the lensing ring and the event horizon's
       shadow at the hole's mirror image in the opposite half of the screen,
       where they read as an unexplained wobbling heptagon in empty sky (the
       seven sides being the `atan(d.y, d.x) * 7.0` ripple in the shader). */
    const u = this.tmpV.x * 0.5 + 0.5;
    const v = this.tmpV.y * 0.5 + 0.5;
    center[0] = u;
    center[1] = v;

    // A sphere of radius R at distance d spans R / (d·tan(fov/2)) of the
    // half-height, i.e. half that in 0..1 UV over the full height — which is
    // the space the shader's aspect correction puts everything in.
    const halfFov = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const apparent = (bodyRadius / (distance * halfFov)) * 0.5;
    radius.value = exact ? apparent / silhouette(bodyRadius, distance) : apparent;

    // Fades out once the body leaves the frame — there is nothing to bend
    // light around off-screen, and the resample would only cost fill rate.
    const offscreen = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5));
    strength.value = clamp01(1 - (offscreen - 0.55) / 0.55);
  }

  private sampleFps(top: number) {
    /* One clock read serves both windows. A pinned tier still meters — pinning
       switches off the demotion, not the measurement, and `?tier=ultra&fps=1`
       is precisely the combination worth being able to ask for: hold the
       expensive tier still and watch what it costs. */
    if (this.pinned && !this.metering) return;
    const now = performance.now();
    if (this.metering) this.sampleStats(top, now);
    if (this.pinned) return;

    this.fpsFrames++;
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

  /** Folds one frame into the meter's window and reports when the window is
   * up. Everything in here is arithmetic on numbers already in hand: no clock
   * read of its own, no allocation per frame, and the one array it does build
   * is built twice a second, not sixty times. */
  private sampleStats(top: number, now: number) {
    const frame = top - this.statsPrev;
    this.statsPrev = top;
    this.statsFrames++;
    this.statsSum += frame;
    if (frame > this.statsWorst) this.statsWorst = frame;
    this.statsCpu += now - top;
    this.statsHistory[this.statsHistoryAt] = frame;
    this.statsHistoryAt = (this.statsHistoryAt + 1) % STATS_HISTORY;

    const elapsed = now - this.statsSince;
    if (elapsed < STATS_REPORT_MS) return;

    /* Unrolled from the ring into reading order — the write cursor round to
       itself — so the graph runs left to right in time no matter where in the
       buffer the window happened to end. */
    const history = new Array<number>(STATS_HISTORY);
    for (let i = 0; i < STATS_HISTORY; i++) {
      history[i] = this.statsHistory[(this.statsHistoryAt + i) % STATS_HISTORY];
    }

    const info = this.renderer.info;
    this.callbacks.onStats?.({
      fps: (this.statsFrames * 1000) / elapsed,
      ms: this.statsSum / this.statsFrames,
      worst: this.statsWorst,
      cpu: this.statsCpu / this.statsFrames,
      // The last frame's counts, not the window's: these are what the renderer
      // reset at the top of it, and a sum across a window would only be the
      // same number multiplied by a frame count.
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      tier: this.tier,
      dpr: this.renderer.getPixelRatio(),
      history,
    });

    this.statsSince = now;
    this.statsFrames = 0;
    this.statsSum = 0;
    this.statsWorst = 0;
    this.statsCpu = 0;
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

    // Not if the telescope has claimed them. A demotion here does not merely
    // hide the moons, it drops their hit spheres out of `pickables` — so an
    // observation list built afterwards would find nothing to fly to even
    // though the bodies are still in the scene.
    /* A demotion no longer takes the moons.
     *
     * It used to hide them AND drop their hit spheres out of `pickables` and
     * their captions out of `labels`, destroying the caption elements on the
     * way — which is unrecoverable without rebuilding, and is why choosing a
     * moon from the observation list did nothing on a device that had ever
     * dropped a tier. Ganymede and Titan and Europa are destinations somebody
     * came to find, not detail.
     *
     * The tier still gives, and gives plenty: pixel ratio, bloom, the star
     * count, the asteroid count, Pluto's debris, film grain. None of those is
     * a named body that stops answering when it goes.
     *
     * Lensing came off that list. It is one full-screen pass that early-outs
     * to a single texture fetch whenever neither the hole nor the wormhole is
     * on screen — so it costs the cheap tier almost nothing most of the time,
     * and what it buys is the entire reason those two objects look like what
     * they are. Bloom, which the cheap tier does still drop, is several passes
     * of blur at reduced resolution and is where that budget actually goes. */

    this.callbacks.onTier(tier);
  }

  /* ══════════════════════════ lifecycle ══════════════════════════ */

  resize() {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.viewW = width;
    this.viewH = height;
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
