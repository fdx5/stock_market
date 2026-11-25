import {
  AgXToneMapping, Box3, BoxGeometry, BufferAttribute, BufferGeometry, ClampToEdgeWrapping, Color, CylinderGeometry, DirectionalLight, EquirectangularReflectionMapping, Float32BufferAttribute, Frustum, Group, LinearFilter, LinearMipmapLinearFilter, MeshBasicMaterial, NormalBlending, UnsignedByteType, PointLight, RepeatWrapping, Vector3, HemisphereLight, Matrix4, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Raycaster, SRGBColorSpace, Scene, Sphere, Texture, TextureLoader, Vector2, WebGPUCoordinateSystem,
  type Ray,
  type Material, type Object3D,
} from "three";
import { BlendMode, RenderPipeline, WebGPURenderer } from "three/webgpu";
import { clamp as tslClamp, clearcoat, diffuseColor, step, normalWorld, roughness, unpackRGBToNormal, packNormalToRGB, emissive, float, luminance, mix, mrt, normalView, output, pass, sample, screenUV, smoothstep, vec2, vec4, vibrance } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { ssr } from "three/addons/tsl/display/SSRNode.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import bakeV7 from "./bake.json";
import bakeV6 from "./bake-v6.json";
import { createAtriumFX, ShowcaseTour, type AtriumMood, type TrackedLightmapMat } from "./atriumFx";
import { FLOOR, MARKETS, STORAGE_ASSETS, type FloorSnapshot, type Language } from "./market";
import { createScreens } from "./screens";

export type { AtriumMood };
type Pose = { x: number; z: number; yaw: number; pitch: number; y?: number };
/** Elevator state for the UI: whether the visitor stands in a cabin, where the cabins are. */
export type LiftState = { inside: number | null; floor: number; moving: boolean; cabins: number[] };
type Captions = Record<string, number[]>;
export type SculptureControlAction =
  | { type: "orbit"; dx: number; dy: number }
  | { type: "pan"; dx: number; dy: number }
  | { type: "zoom"; factor: number }
  | { type: "reset" }
  | { type: "autoRotate"; on: boolean };

export type FloorDriver = {
  move: (x: number, forward: number) => void;
  jump: (pose: Pose) => void;
  stop: () => void;
  update: (snapshot: FloorSnapshot, series: Captions, language: Language) => void;
  /** Send the cabin the visitor stands in to a floor (0 = ground). */
  ride: (floor: number) => void;
  /** Switch real-time architectural lighting mood (daylight / golden / night). */
  setMood: (mood: AtriumMood) => void;
  /** Toggle smooth cinematic architectural camera tour. */
  setTour: (on: boolean) => void;
  /** Open or close interactive 360° 3D museum studio viewer for a loaded sculpture. */
  inspectSculpture: (id: string | null) => boolean;
  /** Control the 360° sculpture viewer camera (orbit, pan, zoom, reset, autoRotate). */
  sculptureControl: (action: SculptureControlAction) => void;
  /** Stop rendering while a full-screen overlay (the art viewer) hides the hall. */
  suspend: (on: boolean) => void;
  dispose: () => void;
};

// Every bake changes the lightmap scales: use them as a cache key, so a reload always gets the
// current model and maps (the file names stay the same between local rebuilds).
type Bake = { shell: { scale: number; file: string }; fixtures: { scale: number; file: string }; ground?: { scale: number; file: string } };
const bakeKey = (b: Bake) => "?v=" + Math.round(b.shell.scale * 1e4).toString(36) + Math.round(b.fixtures.scale * 1e4).toString(36);
const BAKE_KEY = bakeKey(bakeV6 as Bake);
const hallAsset = (file: string) => `${STORAGE_ASSETS}/${file}${BAKE_KEY}`;
// Desktop: v7 hall (1F plaza on its own 4K lightmap). Phones and iPad keep the v6 hall and its GPU-compressed copy.
const HALL_V7 = { bake: bakeV7 as Bake, glb: "trading-hall-v7.glb", env: "hall-env-v7.hdr" };
const HALL_V6 = { bake: bakeV6 as Bake, glb: "trading-hall-v6.glb", env: "hall-env-v6.hdr" };
const ENV_MOBILE = STORAGE_ASSETS + "/hall-env-v5.hdr" + bakeKey(bakeV6 as Bake); // 4x lighter 1.6MB HDR for iPad/mobile memory budget
// Slot order and dimensions match scripts/build_exchange_art_preview.py.
const ART_PREVIEW = { columns: 8, tile: 256, border: 8 };
const SKY = "#f4f1ea";   // daylight through the skylight, warmed by the oak
const EYE = 1.68, RADIUS = .32;
const RAD = Math.PI / 180;
const KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight", "ShiftLeft", "ShiftRight"]);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/* The v5 atrium is round: walking is a disc, blocked by circles (core, columns, planters) and by
 * annular sectors (desk rows with their chairs, lounges, pools, the central counter with gaps). */
type Arc = { r0: number; r1: number; a0: number; a1: number; h?: number; gaps?: number[]; gap?: number };
type Circle = { x: number; z: number; r: number };
const ARCS = FLOOR.arcs as Arc[];
const CIRCLES = FLOOR.circles as Circle[];
/** Angle of (x, z) in degrees from +z toward +x, 0..360 — the layout's convention. */
const angleOf = (x: number, z: number) => (Math.atan2(x, z) / RAD + 360) % 360;
const within = (t: number, a0: number, a1: number) => a1 - a0 >= 360 || ((t - a0) % 360 + 360) % 360 <= a1 - a0;
const near = (t: number, g: number) => Math.abs(((t - g) % 360 + 540) % 360 - 180);

/* Four floors: the ground disc and three gallery rings, joined by a switchback stair (flights whose
 * height follows the angle, with landings) and two glass elevators. A position is walkable when a
 * surface lies under it within a step of the current height. */
type Flight = { r0: number; r1: number; aFrom: number; aTo: number; y0: number; y1: number };
type Patch = { r0: number; r1: number; a0: number; a1: number; y: number; elevator?: number };
type Ring = { r0: number; r1: number; y: number };
const WALK = FLOOR.walk as unknown as { r: number; galleries: Ring[]; flights: Flight[]; landings: Patch[]; thresholds: Patch[] };
const LANDINGS_AND_THRESHOLDS: Patch[] = [...WALK.landings, ...WALK.thresholds];
const LIFTS = (FLOOR as unknown as { elevators: { id: number; x: number; z: number; r: number; levels: number[] }[] }).elevators ?? [];
export const FLOORS = [0, ...(FLOOR.levels as number[])];
const STEP = .62;
const CABIN_WALK = .1;           // the cabin floor is walkable to 10 cm inside the glass
/** Current cabin heights, shared with walkable(): the ground shaft ring blocks only while the cabin is up. */
let CABIN_Y: number[] = [];
const inSector = (r: number, t: number, p: { r0: number; r1: number; a0: number; a1: number }) =>
  r >= p.r0 && r <= p.r1 && within(t, p.a0, p.a1);
const levelOf = (y: number) => FLOORS.reduce((best, f, i) => Math.abs(f - y) < Math.abs(FLOORS[best] - y) ? i : best, 0);

function groundClear(x: number, z: number) {
  return walkable(x, z);
}
function galleryClear(x: number, z: number, level: number) {
  for (const c of CIRCLES as (Circle & { level?: number })[]) {
    if ((c.level === undefined || c.level === level) && Math.hypot(x - c.x, z - c.z) < c.r + RADIUS) return false;
  }
  return true;
}
/** Height of the walkable surface under (x, z) nearest to y, or null. cabins: current cabin heights. */
export function surfaceAt(x: number, z: number, y: number, cabins: number[] = []): number | null {
  const r = Math.hypot(x, z), t = angleOf(x, z);
  let best: number | null = null;
  const take = (h: number) => { if (Math.abs(h - y) <= STEP && (best === null || Math.abs(h - y) < Math.abs(best - y))) best = h; };
  if (Math.abs(y) <= STEP && groundClear(x, z)) take(0);
  WALK.galleries.forEach((g, i) => { if (r >= g.r0 && r <= g.r1 && galleryClear(x, z, i + 1)) take(g.y); });
  for (const f of WALK.flights) {
    if (r < f.r0 + .12 || r > f.r1 - .12) continue;
    const span = f.aTo - f.aFrom, u = (((t - f.aFrom) % 360 + 540) % 360 - 180) / span;
    if (u >= -.02 && u <= 1.02) take(f.y0 + (f.y1 - f.y0) * clamp(u, 0, 1));
  }
  for (const L of LANDINGS_AND_THRESHOLDS) if (inSector(r, t, L)) take(L.y);
  LIFTS.forEach((e, i) => { if (Math.hypot(x - e.x, z - e.z) < e.r - CABIN_WALK && cabins[i] !== undefined) take(cabins[i]); });
  return best;
}

export function walkable(x: number, z: number) {
  const r = Math.hypot(x, z);
  if (r > FLOOR.walk.r) return false;
  if ((CIRCLES as (Circle & { level?: number; cabin?: number })[]).some(c => (c.level === undefined || c.level === 0)
    && !(c.cabin !== undefined && (CABIN_Y[c.cabin] ?? 0) < .05) && Math.hypot(x - c.x, z - c.z) < c.r + RADIUS)) return false;
  const t = angleOf(x, z);
  for (const a of ARCS as (Arc & { level?: number })[]) {
    if (a.level !== undefined && a.level !== 0) continue;
    if (r < a.r0 - RADIUS || r > a.r1 + RADIUS) continue;
    const pad = RADIUS / Math.max(r, 1) / RAD;
    if (!within(t, a.a0 - pad, a.a1 + pad)) continue;
    if (a.gaps && a.gaps.some(g => near(t, g) < ((a.gap ?? 0) / 2 - RADIUS) / Math.max(r, 1) / RAD)) continue;
    return false;
  }
  return true;
}

/* Monitor picking: what can stand between the eye and a screen, from the layout's simple solids
 * (cylinders, sector solids, gallery slabs), tested by marching along the ray. Raycasting the
 * merged hall (no BVH) froze phones for hundreds of ms per tap; this costs well under 1 ms. */
type Solid = { x: number; z: number; r: number; y0: number; y1: number };
type SectorSolid = { r0: number; r1: number; a0: number; a1: number; y0: number; y1: number };
type Slab = { r0: number; r1: number; y0: number; y1: number };
const OCC = FLOOR.occluders as { cylinders: Solid[]; arcs: SectorSolid[]; slabs: Slab[] };
function solidAt(x: number, y: number, z: number) {
  for (const c of OCC.cylinders) if (y >= c.y0 && y <= c.y1 && Math.hypot(x - c.x, z - c.z) < c.r) return true;
  const r = Math.hypot(x, z);
  for (const s of OCC.slabs) if (y >= s.y0 && y <= s.y1 && r >= s.r0 && r <= s.r1) return true;
  const t = angleOf(x, z);
  for (const a of OCC.arcs) if (y >= a.y0 && y <= a.y1 && r >= a.r0 && r <= a.r1 && within(t, a.a0, a.a1)) return true;
  return false;
}
function occluded(ray: Ray, far: number) {
  const { origin: o, direction: d } = ray;
  for (let k = .35; k < far; k += .2) if (solidAt(o.x + d.x * k, o.y + d.y * k, o.z + d.z * k)) return true;
  return false;
}

function releaseModel(root: Object3D) {
  const geometries = new Set<BufferGeometry>(), materials = new Set<Material>(), textures = new Set<Texture>();
  root.traverse(child => {
    if (!(child instanceof Mesh)) return;
    geometries.add(child.geometry);
    for (const m of Array.isArray(child.material) ? child.material : [child.material]) {
      materials.add(m);
      for (const value of Object.values(m)) if (value instanceof Texture) textures.add(value);
    }
  });
  for (const texture of textures) {
    const data = texture.source?.data;
    texture.dispose();
    if (typeof ImageBitmap !== "undefined" && data instanceof ImageBitmap) data.close();
  }
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

function groupOf(object: Object3D) {
  for (let node: Object3D | null = object; node; node = node.parent) {
    if (node.name === "shell" || node.name === "fixtures" || node.name === "emit" || node.name === "ground") return node.name;
  }
  return "props";
}

/** Texture quality for screen canvases: full on desktop & flagship Android (Fold 7/8, S26), 0.72x on iPad, 0.55x on phones. */
function screenQuality(mobile: boolean, isIPad: boolean) {
  if (isIPad) return .72;
  if (mobile) return .55;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return memory <= 4 ? .65 : 1;
}

type Events = {
  renderer: (mode: "webgpu" | "webgl2") => void;
  position: (x: number, z: number, yaw: number) => void;
  select: (panel: string) => void;
  progress?: (fraction: number) => void;
  lift?: (state: LiftState) => void;
  floor?: (floor: number) => void;
  tour?: (active: boolean) => void;
  initialDisplays: () => { snapshot: FloorSnapshot; series: Captions; language: Language };
  error: (error: unknown) => void;
};

async function fetchWithProgress(url: string, signal: AbortSignal, progress?: (f: number) => void) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Trading hall model unavailable (${response.status})`);
  if (!response.body) return response.arrayBuffer();
  // The GLB header gives the decoded size even when the CDN compresses the HTTP response.
  // Read into one buffer so the download chunks do not also occupy memory during model decode.
  const reader = response.body.getReader();
  const header = new Uint8Array(12);
  let out: Uint8Array<ArrayBuffer> | undefined;
  let received = 0;
  let lastProgress = -1;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!out) {
        header.set(value.subarray(0, header.length - received), received);
        if (received + value.length < header.length) { received += value.length; continue; }
        const glb = new DataView(header.buffer);
        const bytes = glb.getUint32(8, true);
        if (glb.getUint32(0, true) !== 0x46546c67 || bytes < header.length || bytes > 256 * 1024 ** 2) {
          throw new Error("Invalid trading hall model header");
        }
        out = new Uint8Array(bytes);
        out.set(header);
      }
      out.set(value, received);
      received += value.length;
      const frac = Math.min(.99, received / out.length);
      // Throttle progress callbacks (~50 updates instead of ~1,800) so React never churns during GLB download!
      if (frac - lastProgress >= 0.02 || frac >= 0.99) {
        lastProgress = frac;
        progress?.(frac);
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (!out || received !== out.length) throw new Error("Incomplete trading hall model download");
  return out.buffer;
}

export async function createFloor(host: HTMLDivElement, canvas: HTMLCanvasElement, signal: AbortSignal, events: Events, retryWithWebGL = false): Promise<FloorDriver> {
  if (signal.aborted) throw signal.reason;
  const tBoot0 = performance.now();
  const params = new URLSearchParams(location.search);
  const measure = params.has("exchangeMetrics");
  const touch = matchMedia("(pointer: coarse)").matches;
  // iPadOS can present a desktop user agent. Detect iOS/iPadOS Safari separately for WebKit memory safety.
  const appleTouch = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1);
  const isIPad = appleTouch && Math.max(window.screen?.width ?? 0, window.screen?.height ?? 0) >= 900;
  const deviceMem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? (appleTouch ? 4 : 8);
  const cpuCores = navigator.hardwareConcurrency ?? 4;
  const hasWebGPU = "gpu" in navigator && !!navigator.gpu;
  // Flagship Android devices (Galaxy Z Fold 7/8, Galaxy S25/S26, Tab S10+ — 8GB+ RAM, 8+ cores, Vulkan WebGPU)
  // preserve FULL desktop-grade 16K + Bloom + 2K HDR + full fireworks quality without forced downgrade!
  const flagshipMobile = !appleTouch && hasWebGPU && deviceMem >= 8 && cpuCores >= 8;
  const mobile = (touch || appleTouch) && !flagshipMobile;
  const hall = mobile ? HALL_V6 : HALL_V7;
  const bake = hall.bake;
  const hallKey = bakeKey(bake);
  const hallFile = (file: string) => `${STORAGE_ASSETS}/${file}${hallKey}`;
  const dense = (window.devicePixelRatio || 1) >= 2;

  // Determine initial mood upfront so we ONLY download ONE skyline before reveal (saves 8-10MB critical-path download!)
  const testChangeRaw = params.get("testChange");
  const testChange = testChangeRaw !== null && Number.isFinite(Number(testChangeRaw)) ? Number(testChangeRaw) : null;
  const bootDisplays = events.initialDisplays();
  const initialChange = testChange ?? bootDisplays.snapshot.index?.change ?? 0;
  const initialMood: AtriumMood = initialChange >= 3.0 ? "night" : "daylight";
  const initialSkyKey = initialMood === "daylight" ? "day" : initialMood;

  // Start screens worker & font fetch at t=0ms — 100% IN PARALLEL with WebGPU init & 28MB GLB download!
  const screens = createScreens(screenQuality(mobile, isIPad), mobile, undefined, appleTouch);
  let prewarmCancelled = false;
  void screens.ready().then(() => {
    if (prewarmCancelled || signal.aborted) return;
    const latest = events.initialDisplays();
    screens.update(latest.snapshot, latest.series, latest.language);
    screens.prewarm(24);
  }).catch(() => {});

  // iPadOS/iOS Safari uses Metal-backed WebGL2 directly (avoids experimental Safari WebGPU hangs/OOM crashes!).
  const renderer = new WebGPURenderer({
    canvas,
    antialias: !(mobile && dense),
    alpha: false,
    powerPreference: "high-performance",
    forceWebGL: retryWithWebGL || appleTouch || !("gpu" in navigator && navigator.gpu),
  });
  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = .62;   // AgX calm luxury exposure: true sapphire/crimson hues, zero glare, effortless viewing
  const scene = new Scene();
  scene.background = new Color("#d9dde2");
  const camera = new PerspectiveCamera(62, 1, .08, 90);
  const sky = new HemisphereLight(SKY, "#5a5048", .5);
  scene.add(sky);
  const releases: (() => void)[] = [
    () => { prewarmCancelled = true; screens.dispose(); },
  ];
  let disposed = false, frame = 0;
  let environment: Texture | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    prewarmCancelled = true;
    cancelAnimationFrame(frame);
    for (const release of releases.reverse()) release();
    scene.environment = null;
    environment?.dispose();
    environment = undefined;
    renderer.dispose();
  };
  const fail = (error: unknown) => {
    if (disposed || signal.aborted) return;
    dispose();
    events.error(error);
  };
  try {
    renderer.onDeviceLost = info => fail(new Error(`${info.api} device lost: ${info.message}`));
    // Start downloading the GLB immediately on desktop while renderer.init() warms up WebGPU!
    const earlyDesktopGlb = !mobile ? fetchWithProgress(hallFile(hall.glb), signal, events.progress) : null;
    await renderer.init();
    const tInitDone = performance.now();
    signal.throwIfAborted();
    if (disposed) throw new Error("Trading hall GPU context was lost");
    screens.setUpload(texture => renderer.initTexture(texture));
    const backend = renderer.coordinateSystem === WebGPUCoordinateSystem ? "webgpu" : "webgl2";
    const compressed = mobile && (["texture-compression-astc", "texture-compression-etc2", "texture-compression-bc",
      "texture-compression-s3tc"] as const).some(feature => renderer.hasFeature(feature));
    if (params.has("exchangeMetrics")) canvas.dataset.hallTextures = compressed ? "ktx2" : "webp";
    const textures = new TextureLoader();
    // Single KTX2 WASM worker on mobile/iPad halves peak transcode RAM (prevents iPadOS JetSam OOM kills!).
    const ktx = compressed ? new KTX2Loader().setWorkerLimit(1).detectSupport(renderer) : undefined;
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    if (ktx) loader.setKTX2Loader(ktx);
    const maxAniso = mobile ? 2 : Math.min(4, renderer.getMaxAnisotropy());
    const useBitmapUpload = !appleTouch && backend === "webgpu" && typeof createImageBitmap === "function";
    const closeBitmapOnUpload = (tex: Texture) => {
      const img = tex.image as unknown;
      if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) img.close();
    };
    const disposeTexSafe = (tex: Texture) => {
      closeBitmapOnUpload(tex);
      const img = tex.image as unknown;
      if (typeof HTMLCanvasElement !== "undefined" && img instanceof HTMLCanvasElement) {
        img.width = 0; img.height = 0;
      }
      tex.dispose();
    };
    /** Decode static WebP textures cleanly: zero-CPU-RAM ImageBitmap on WebGPU desktop, Safari-safe downscaled canvas on iPad/WebGL2! */
    const loadBitmapTexture = async (url: string, resize?: { width: number; height: number }): Promise<Texture> => {
      if (useBitmapUpload) {
        const res = await fetch(url, { signal });
        if (!res.ok) throw new Error(`Texture unavailable (${res.status}): ${url}`);
        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("text/html")) throw new Error(`Unexpected HTML response for texture: ${url}`);
        const blob = await res.blob();
        signal.throwIfAborted();
        const bitmap = resize
          ? await createImageBitmap(blob, { resizeWidth: resize.width, resizeHeight: resize.height, resizeQuality: "high" })
          : await createImageBitmap(blob);
        if (disposed || signal.aborted) { bitmap.close(); throw signal.reason ?? new Error("Trading hall GPU context was lost"); }
        const tex = new Texture(bitmap);
        tex.onUpdate = closeBitmapOnUpload;
        tex.needsUpdate = true;
        return tex;
      }
      const tex = await textures.loadAsync(url);
      if (disposed || signal.aborted) { tex.dispose(); throw signal.reason ?? new Error("Trading hall GPU context was lost"); }
      // On iPad/WebGL2, downscale giant 8K textures cleanly via 2D canvas -> 2048x512 (4MB vs 67MB VRAM, 16x safer on iPadOS!)
      if (resize && tex.image) {
        const c = document.createElement("canvas");
        c.width = resize.width;
        c.height = resize.height;
        const g = c.getContext("2d", { alpha: false });
        if (g) {
          g.drawImage(tex.image as CanvasImageSource, 0, 0, resize.width, resize.height);
          tex.dispose();
          const scaled = new Texture(c);
          scaled.needsUpdate = true;
          return scaled;
        }
      }
      return tex;
    };
    const lightmap = async (file: string) => {
      const tex = ktx ? await ktx.loadAsync(hallFile(file.replace(/\.webp$/, ".ktx2"))) : await loadBitmapTexture(hallFile(file));
      if (disposed || signal.aborted) { disposeTexSafe(tex); throw signal.reason ?? new Error("Trading hall GPU context was lost"); }
      tex.flipY = false;
      tex.channel = 1;
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = maxAniso;
      releases.push(() => disposeTexSafe(tex));
      return tex;
    };
    const loadModel = async () => {
      const file = compressed ? "trading-hall-v6-ktx2.glb" : hall.glb;
      const binary = earlyDesktopGlb ? await earlyDesktopGlb : await fetchWithProgress(hallFile(file), signal, events.progress);
      events.progress?.(.99);
      const { scene: model } = await loader.parseAsync(binary, STORAGE_ASSETS + "/");
      if (disposed || signal.aborted) { releaseModel(model); throw signal.reason ?? new Error("Trading hall GPU context was lost"); }
      releases.push(() => releaseModel(model));
      return model;
    };
    const loadSkyline = async (file: string, isHiResTile = false) => {
      // Desktop & flagship Android upgrade active mood to native 16K (4096x1024 crossfade fallback);
      // iPad uses crisp 4096x1024 (16MB vs 201MB -> zero crash!); low-mem phones use 2048x512 (4MB VRAM!).
      const resizeFallback = isHiResTile ? undefined : (mobile && !isIPad) ? { width: 2048, height: 512 } : { width: 4096, height: 1024 };
      const tex = await loadBitmapTexture(hallAsset(file) + "v7c", resizeFallback);
      if (disposed || signal.aborted) { disposeTexSafe(tex); throw signal.reason ?? new Error("Trading hall GPU context was lost"); }
      tex.colorSpace = SRGBColorSpace;
      tex.flipY = false;
      tex.wrapS = isHiResTile ? ClampToEdgeWrapping : RepeatWrapping;
      tex.wrapT = ClampToEdgeWrapping;
      if (isHiResTile) {
        tex.generateMipmaps = true;
        tex.minFilter = LinearMipmapLinearFilter;
        tex.magFilter = LinearFilter;
        tex.anisotropy = Math.min(8, renderer.getMaxAnisotropy());
      } else {
        tex.generateMipmaps = false;
        tex.minFilter = LinearFilter;
        tex.magFilter = LinearFilter;
        tex.anisotropy = Math.min(4, renderer.getMaxAnisotropy());
      }
      renderer.initTexture(tex);
      return tex;
    };
    const makeEmergencySkyline = (file: string) => {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 32;
      const g = c.getContext("2d", { alpha: false });
      if (g) {
        const grad = g.createLinearGradient(0, 0, 0, c.height);
        if (file.includes("night")) {
          grad.addColorStop(0, "#091326");
          grad.addColorStop(0.55, "#132645");
          grad.addColorStop(1, "#0b1628");
        } else if (file.includes("golden")) {
          grad.addColorStop(0, "#4b6b94");
          grad.addColorStop(0.55, "#d89c6a");
          grad.addColorStop(1, "#2b3648");
        } else {
          grad.addColorStop(0, "#6fa7de");
          grad.addColorStop(0.55, "#cbe0f5");
          grad.addColorStop(1, "#3b5875");
        }
        g.fillStyle = grad;
        g.fillRect(0, 0, c.width, c.height);
      }
      const tex = new Texture(c);
      tex.colorSpace = SRGBColorSpace;
      tex.flipY = false;
      tex.wrapS = RepeatWrapping;
      tex.wrapT = ClampToEdgeWrapping;
      tex.generateMipmaps = false;
      tex.minFilter = LinearFilter;
      tex.magFilter = LinearFilter;
      tex.needsUpdate = true;
      renderer.initTexture(tex);
      releases.push(() => disposeTexSafe(tex));
      return tex;
    };
    const loadSkylineFallback = async (file: string) => {
      try {
        const tex = await loadSkyline(file, false);
        releases.push(() => disposeTexSafe(tex));
        return tex;
      } catch (err) {
        if (disposed || signal.aborted) throw err;
        const prev = file.replace(/-v7\.webp$/, "-v6.webp");
        if (prev !== file) {
          try {
            console.warn(`[exchange] skyline ${file} unavailable, falling back to ${prev}`, err);
            const tex = await loadSkyline(prev, false);
            releases.push(() => disposeTexSafe(tex));
            return tex;
          } catch (prevErr) {
            if (disposed || signal.aborted) throw prevErr;
          }
        }
        console.warn(`[exchange] skyline ${file} unavailable, using procedural sky fallback`, err);
        return makeEmergencySkyline(file);
      }
    };
    // Download ONLY the active initial mood's skyline before reveal (saves 8-10MB critical-path bytes + 2x 8K decodes!)
    const { model, shellMap, fixtureMap, groundMap, initialSkyTex } = await (async () => {
      try {
        if (mobile) {
          const model = await loadModel();
          const shellMap = await lightmap(bake.shell.file);
          const fixtureMap = await lightmap(bake.fixtures.file);
          const groundMap = bake.ground ? await lightmap(bake.ground.file) : undefined;
          const initialSkyTex = await loadSkylineFallback(`skyline-${initialSkyKey}-v7.webp`);
          return { model, shellMap, fixtureMap, groundMap, initialSkyTex };
        }
        const [model, shellMap, fixtureMap, groundMap, initialSkyTex] = await Promise.all([
          loadModel(), lightmap(bake.shell.file), lightmap(bake.fixtures.file),
          bake.ground ? lightmap(bake.ground.file) : Promise.resolve(undefined),
          loadSkylineFallback(`skyline-${initialSkyKey}-v7.webp`),
        ]);
        return { model, shellMap, fixtureMap, groundMap, initialSkyTex };
      } finally { ktx?.dispose(); }
    })();
    const tAssetsDone = performance.now();
    signal.throwIfAborted();

    // Baked global illumination: each lightmapped group gets its own material copies.
    const cloned = new Map<string, MeshStandardMaterial>();
    const detachedSources = new Set<MeshStandardMaterial>();
    const lightmapped: TrackedLightmapMat[] = [];
    const propMaterials = new Set<MeshStandardMaterial>();
    model.traverse(child => {
      if (!(child instanceof Mesh)) return;
      const group = groupOf(child);
      child.matrixAutoUpdate = false;
      child.updateMatrix();
      const source = child.material as MeshStandardMaterial;
      const map = group === "ground" ? groundMap : group === "shell" ? shellMap : group === "fixtures" ? fixtureMap : undefined;
      if (map && child.geometry.getAttribute("uv1")) {
        const key = group + ":" + source.uuid;
        let m = cloned.get(key);
        if (!m) {
          m = source.clone();
          // Calm luxury honed Italian stone & plaster palette (warm, rich, zero blinding white glare).
          if (/calacatta|light stone/i.test(source.name)) m.color.multiplyScalar(.78);
          else if (/travertine|plaster|gallery wall|composite/i.test(source.name)) m.color.multiplyScalar(.85);
          // Satin champagne brass reads as metal, not brown paint: bright warm F0, brushed-satin roughness.
          if (/champagne brushed brass/i.test(source.name)) { m.color.set("#e3c793"); m.map = null; m.roughnessMap = m.metalnessMap = null; m.metalness = 1; m.roughness = .3; }
          m.userData.isFloorShell = group === "shell" || group === "ground";
          m.lightMap = map;
          const baseIntensity = (group === "ground" && bake.ground ? bake.ground.scale : group === "fixtures" ? bake.fixtures.scale : bake.shell.scale) * Math.PI;
          m.lightMapIntensity = baseIntensity;
          // Understated satin metallic luster on champagne brass & bronze; soft reflections on stone & walnut.
          m.envMapIntensity = /champagne brushed brass/i.test(source.name) ? 1.7 : m.metalness > .5 ? 1.25 : /marble/i.test(source.name) ? .62 : /walnut|oak/i.test(source.name) ? .45 : .34;
          cloned.set(key, m);
          lightmapped.push({ mat: m, base: baseIntensity });
        }
        detachedSources.add(source);
        child.material = m;
      } else if (group === "emit") {
        if (source.name === "Daylight glazing") source.emissiveIntensity *= .62;
        else if (/perimeter daylight window/i.test(source.name)) source.emissiveIntensity *= .92;
        else if (source.emissiveIntensity > 1) source.emissiveIntensity *= .85;
        if (source.transparent || /glass/i.test(source.name)) {
          source.transparent = true;
          source.opacity = /core crystal/i.test(source.name) ? .22 : .16;
          source.depthWrite = false;
        }
      } else {
        propMaterials.add(source);
      }
    });
    // Dispose original un-lightmapped GLTF materials that were replaced by lightmapped clones.
    releases.push(() => {
      for (const s of detachedSources) s.dispose();
      detachedSources.clear();
    });
    // Art: canvases named "Artwork:<id>" get their picture lazily; sculptures get cheap pick proxies.
    const artTargets: Mesh[] = [];
    const artCanvases: { mesh: Mesh; id: string; bounds: Sphere; placeholder: Mesh["material"]; retryAt: number }[] = [];
    const SCULPTURE_IDS = ((FLOOR as unknown as { sculptures?: { id: string }[] }).sculptures ?? []).map(s => s.id);
    model.traverse(child => {
      // GLTFLoader sanitises node names (drops ":" and ".", spaces become "_"): "Artwork:starry-night" ->
      // "Artworkstarry-night". gltfpack keeps the named node as a group with the canvas mesh inside.
      if (!child.name.startsWith("Artwork") || child.parent?.name.startsWith("Artwork")) return;
      const id = child.name.replace(/^Artwork:?/, "");
      let mesh: Mesh | undefined;
      child.traverse(o => { if (!mesh && o instanceof Mesh) mesh = o; });
      if (!mesh) return;
      mesh.userData.panel = "art:" + id;
      artTargets.push(mesh);
      // gltfpack gives these meshes a shared quantization origin. The geometry locates the picture.
      const bounds = new Box3().setFromObject(mesh).getBoundingSphere(new Sphere());
      artCanvases.push({ mesh, id, bounds, placeholder: mesh.material, retryAt: 0 });
    });
    const proxyMat = new MeshBasicMaterial({ visible: false });
    const proxyGeos: BufferGeometry[] = [];
    const sculptureNodes = new Map<string, Object3D>();
    for (const id of SCULPTURE_IDS) {
      const node = model.getObjectByName(id + "_1") ?? model.getObjectByName(id + " 1") ?? model.getObjectByName(id);
      if (!node) continue;
      sculptureNodes.set(id, node);
      const box = new Box3().setFromObject(node);
      const geo = new BoxGeometry(...box.getSize(new Vector3()).toArray());
      proxyGeos.push(geo);
      const proxy = new Mesh(geo, proxyMat);
      proxy.position.copy(box.getCenter(new Vector3()));
      proxy.userData.panel = "sculpture:" + id;
      proxy.matrixAutoUpdate = false;
      proxy.updateMatrix();
      proxy.updateMatrixWorld(true);
      scene.add(proxy);
      artTargets.push(proxy);
    }
    releases.push(() => {
      for (const g of proxyGeos) g.dispose();
      proxyMat.dispose();
    });
    // Clickable exterior panoramic windows: clicking any daylight window opens the 360° Seoul skyline observatory!
    model.traverse(child => {
      if (!(child instanceof Mesh)) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      if (mats.some(m => m && /perimeter daylight window/i.test(m.name))) {
        child.userData.panel = "skyline:view";
        artTargets.push(child);
      }
    });
    const pickTargets = artTargets.length ? [...screens.targets, ...artTargets] : screens.targets;
    if (measure) {
      const names: string[] = [];
      model.traverse(o => { if (/artwork|elevator/i.test(o.name)) names.push(o.type + ":" + o.name); });
      canvas.dataset.artNodes = String(artCanvases.length) + " | " + names.slice(0, 6).join(", ");
    }
    const cabinNodes = LIFTS.map(e => model.getObjectByName(`Elevator_cabin_${e.id}`) ?? model.getObjectByName(`Elevator cabin ${e.id}`) ?? null);
    // Glass doors: two curved leaves on pivots at the cabin centre; they slide round the drum.
    const doorNodes = LIFTS.map(e => ["L", "R"].map(side => model.getObjectByName(`Elevator_door${side}_${e.id}`) ?? null));
    const doorBase = doorNodes.map(pair => pair.map(n => n?.rotation.y ?? 0));
    const doorOpen = LIFTS.map(() => 1);

    // Lossless GPU Draw-Call Optimization: batch static non-interactive prop meshes (chairs, tables, plants, brass/leather
    // furniture) by (material, attribute-layout, North/South hemisphere). Preserves 100% identical visuals, PBR materials,
    // and hemisphere frustum culling while cutting ~65-80 GPU draw calls EVERY SINGLE FRAME!
    model.updateMatrixWorld(true);
    const dynamicNodes = new Set<Object3D>();
    for (const node of sculptureNodes.values()) dynamicNodes.add(node);
    for (const node of cabinNodes) if (node) dynamicNodes.add(node);
    for (const pair of doorNodes) for (const node of pair) if (node) dynamicNodes.add(node);
    const hasProtectedAncestor = (obj: Object3D) => {
      for (let cur: Object3D | null = obj; cur; cur = cur.parent) {
        if (
          dynamicNodes.has(cur) ||
          cur.name.startsWith("Artwork") ||
          cur.name.startsWith("Elevator") ||
          cur.name === "WaterSurface" ||
          cur.name === "HoloCoreFX"
        ) return true;
      }
      return false;
    };
    type BatchBucket = { mat: Material; meshes: Mesh[] };
    const propBuckets = new Map<string, BatchBucket>();
    const tmpBox = new Box3();
    const tmpCenter = new Vector3();
    model.traverse(child => {
      if (!(child instanceof Mesh)) return;
      if (groupOf(child) !== "props") return;
      if (child.userData.panel || Array.isArray(child.material) || hasProtectedAncestor(child)) return;
      if (child.matrixWorld.determinant() < 0) return;
      const geo = child.geometry;
      if (!geo || !geo.getAttribute("position")) return;
      if (!geo.boundingBox) geo.computeBoundingBox();
      if (!geo.boundingBox) return;
      tmpBox.copy(geo.boundingBox).applyMatrix4(child.matrixWorld).getCenter(tmpCenter);
      const hemi = tmpCenter.z >= 0 ? "S" : "N";
      const attrSig = Object.keys(geo.attributes).sort().map(k => {
        const a = geo.attributes[k];
        // position/normal/tangent are promoted to Float32 before world-matrix bake (fixes KHR_mesh_quantization Uint16 overflow!)
        const promoted = k === "position" || k === "normal" || k === "tangent";
        const typeTag = promoted ? "Float32Array" : a.array.constructor.name;
        const normTag = promoted ? 0 : (a.normalized ? 1 : 0);
        return `${k}:${a.itemSize}:${normTag}:${typeTag}`;
      }).join("|");
      const key = `${child.material.uuid}#${geo.index ? "I" : "N"}#${attrSig}#${hemi}`;
      let bucket = propBuckets.get(key);
      if (!bucket) { bucket = { mat: child.material, meshes: [] }; propBuckets.set(key, bucket); }
      bucket.meshes.push(child);
    });
    const dequantizeForMerge = (src: BufferGeometry): BufferGeometry => {
      const dst = new BufferGeometry();
      if (src.index) dst.setIndex(src.index.clone());
      for (const name of Object.keys(src.attributes)) {
        const a = src.attributes[name];
        const count = a.count, itemSize = a.itemSize;
        if (name === "position" || name === "normal" || name === "tangent") {
          // Promote quantized integer attributes (e.g. KHR_mesh_quantization Uint16 position / Int8 normal)
          // to full Float32 BEFORE applyMatrix4, so negative/fractional world coordinates never wrap or truncate!
          const arr = new Float32Array(count * itemSize);
          if (itemSize === 3) {
            for (let i = 0; i < count; i++) {
              arr[i * 3] = a.getX(i);
              arr[i * 3 + 1] = a.getY(i);
              arr[i * 3 + 2] = a.getZ(i);
            }
          } else if (itemSize === 4) {
            for (let i = 0; i < count; i++) {
              arr[i * 4] = a.getX(i);
              arr[i * 4 + 1] = a.getY(i);
              arr[i * 4 + 2] = a.getZ(i);
              arr[i * 4 + 3] = a.getW(i);
            }
          } else {
            for (let i = 0; i < count; i++) {
              for (let c = 0; c < itemSize; c++) arr[i * itemSize + c] = a.getComponent(i, c);
            }
          }
          dst.setAttribute(name, new Float32BufferAttribute(arr, itemSize, false));
        } else if ("isInterleavedBufferAttribute" in a && a.isInterleavedBufferAttribute) {
          const Ctor = a.array.constructor as new (len: number) => Float32Array | Uint16Array | Uint8Array | Int16Array | Int8Array;
          const arr = new Ctor(count * itemSize);
          for (let i = 0; i < count; i++) {
            for (let c = 0; c < itemSize; c++) arr[i * itemSize + c] = a.getComponent(i, c);
          }
          dst.setAttribute(name, new BufferAttribute(arr, itemSize, a.normalized));
        } else {
          dst.setAttribute(name, a.clone());
        }
      }
      return dst;
    };
    const mergedStaticGroup = new Group();
    mergedStaticGroup.name = "StaticBatchedProps";
    mergedStaticGroup.matrixAutoUpdate = false;
    mergedStaticGroup.updateMatrix();
    let mergedDrawCallsSaved = 0;
    for (const bucket of propBuckets.values()) {
      if (bucket.meshes.length < 2) continue;
      const clones: BufferGeometry[] = [];
      let ok = true;
      for (const m of bucket.meshes) {
        const g = dequantizeForMerge(m.geometry);
        g.applyMatrix4(m.matrixWorld);
        clones.push(g);
      }
      const merged = mergeGeometries(clones, false);
      for (const g of clones) g.dispose();
      if (!merged) ok = false;
      if (ok && merged) {
        merged.computeBoundingBox();
        merged.computeBoundingSphere();
        // Sanity check: merged bounds must stay strictly inside the atrium hall (never exploded!)
        const bb = merged.boundingBox;
        if (!bb || Math.abs(bb.min.x) > 80 || Math.abs(bb.max.x) > 80 || Math.abs(bb.min.z) > 80 || Math.abs(bb.max.z) > 80) {
          merged.dispose();
          continue;
        }
        const batchMesh = new Mesh(merged, bucket.mat);
        batchMesh.matrixAutoUpdate = false;
        batchMesh.updateMatrix();
        mergedStaticGroup.add(batchMesh);
        for (const m of bucket.meshes) {
          m.parent?.remove(m);
          m.geometry.dispose();
        }
        mergedDrawCallsSaved += bucket.meshes.length - 1;
      }
    }
    if (mergedStaticGroup.children.length > 0) model.add(mergedStaticGroup);
    if (measure) canvas.dataset.batchedDrawsSaved = String(mergedDrawCallsSaved);

    // Freeze static matrix hierarchy across the entire GLB model (except animated elevator cabins/doors) -> 0 wasted tree traversal!
    model.traverse(node => {
      if (!hasProtectedAncestor(node) || node.name.startsWith("Artwork")) {
        node.matrixAutoUpdate = false;
        node.updateMatrix();
      }
    });
    model.updateMatrixWorld(true);

    scene.add(model);
    scene.add(screens.group);
    const fx = createAtriumFX(model, scene, renderer, sky, lightmapped, mobile, { initial: initialSkyTex }, camera, screens.group);
    scene.add(fx.group);
    releases.push(fx.dispose);
    const tour = new ShowcaseTour();
    const stopTour = () => {
      if (!tour.isActive()) return;
      tour.stop();
      events.tour?.(false);
    };
    const loadEnvironment = () => void new HDRLoader().loadAsync(mobile ? ENV_MOBILE : hallFile(hall.env)).then(texture => {
      if (disposed || signal.aborted) { texture.dispose(); return; }
      texture.mapping = EquirectangularReflectionMapping;
      scene.environment = environment = texture;
      inspectScene.environment = texture;
      for (const m of propMaterials) { m.envMap = texture; m.envMapIntensity = 1.7; m.needsUpdate = true; }
      fx.setEnvironment(texture);
    }).catch(() => {});

    // ---- Interactive 360° 3D Sculpture Inspection Studio (shares the same WebGPURenderer & 2K HDR!)
    const inspectScene = new Scene();
    inspectScene.background = new Color("#090d16");
    inspectScene.environmentIntensity = 0.85;
    const inspectCamera = new PerspectiveCamera(40, 1, 0.05, 30);
    const sHemi = new HemisphereLight("#eef4ff", "#24201c", 0.82);
    const sKey = new DirectionalLight("#fff4e0", 2.05);
    sKey.position.set(3.4, 5.2, 4.2);
    const sRim = new DirectionalLight("#72ccff", 1.1);
    sRim.position.set(-4.2, 3.0, -3.6);
    const sFill = new PointLight("#ffdcb4", 1.35, 12, 1.5);
    sFill.position.set(0, 1.2, 3.4);
    inspectScene.add(sHemi, sKey, sRim, sFill);
    // Sleek museum pedestal turntable (satin dark obsidian + champagne brass collar)
    const pedGeo = new CylinderGeometry(0.76, 0.84, 0.16, 64);
    const pedMat = new MeshStandardMaterial({ color: "#151820", roughness: 0.48, metalness: 0.12 });
    const pedMesh = new Mesh(pedGeo, pedMat);
    pedMesh.position.y = -0.76;
    const pedRingGeo = new CylinderGeometry(0.778, 0.778, 0.016, 64, 1, true);
    const pedRingMat = new MeshStandardMaterial({ color: "#c8a974", roughness: 0.28, metalness: 0.88 });
    const pedRingMesh = new Mesh(pedRingGeo, pedRingMat);
    pedRingMesh.position.y = -0.689;
    const inspectStage = new Group();
    inspectStage.add(pedMesh, pedRingMesh);
    inspectScene.add(inspectStage);
    const inspectHolder = new Group();
    inspectStage.add(inspectHolder);
    releases.push(() => {
      inspectScene.environment = null;
      pedGeo.dispose(); pedMat.dispose(); pedRingGeo.dispose(); pedRingMat.dispose();
      sHemi.dispose(); sKey.dispose(); sRim.dispose(); sFill.dispose();
    });
    let inspectingId: string | null = null;
    const orbit = {
      theta: 0.42, targetTheta: 0.42,
      phi: 1.24, targetPhi: 1.24,
      dist: 2.35, targetDist: 2.35,
      panX: 0, targetPanX: 0,
      panY: 0.04, targetPanY: 0.04,
      autoRotate: true,
    };
    const resetOrbit = () => {
      orbit.targetTheta = 0.42;
      orbit.targetPhi = 1.24;
      orbit.targetDist = 2.35;
      orbit.targetPanX = 0;
      orbit.targetPanY = 0.04;
    };
    const clearInspectHolder = () => {
      while (inspectHolder.children.length) inspectHolder.remove(inspectHolder.children[0]);
    };
    const openSculptureInspect = (id: string | null) => {
      clearInspectHolder();
      inspectingId = null;
      if (!id) return true;
      const source = sculptureNodes.get(id);
      if (!source) return false;
      const clone = source.clone(true);
      clone.position.set(0, 0, 0);
      clone.rotation.set(0, 0, 0);
      clone.scale.set(1, 1, 1);
      clone.matrixAutoUpdate = true;
      clone.traverse(o => { o.matrixAutoUpdate = true; });
      clone.updateMatrixWorld(true);
      const bounds = new Box3().setFromObject(clone);
      const size = bounds.getSize(new Vector3());
      const center = bounds.getCenter(new Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 0.001);
      const normScale = 1.38 / maxDim;
      clone.scale.setScalar(normScale);
      clone.position.set(-center.x * normScale, -bounds.min.y * normScale - 0.672, -center.z * normScale);
      inspectHolder.add(clone);
      resetOrbit();
      orbit.theta = orbit.targetTheta;
      orbit.phi = orbit.targetPhi;
      orbit.dist = orbit.targetDist;
      orbit.panX = orbit.targetPanX;
      orbit.panY = orbit.targetPanY;
      orbit.autoRotate = true;
      inspectingId = id;
      return true;
    };
    // Defer 6.39MB HDR environment & preview atlas until right after reveal so boot bandwidth stays 100% focused!

    const artwork = new Map<Mesh, () => void>();
    const previewMeshes = new Set<Mesh>();
    let previewMaterial: MeshStandardMaterial | undefined;
    let artPending = false;
    // Museum anti-glare matte canvas: zero milky envMap reflection over dark brushstrokes, crisp vivid detail!
    const pictureMaterial = (map: Texture) => {
      const mat = new MeshStandardMaterial({ map, roughness: .94, metalness: 0.0, emissive: 0xfff8ee, emissiveMap: map, emissiveIntensity: .38 });
      mat.envMapIntensity = 0.0;
      return mat;
    };
    const artworkMetrics = () => {
      if (measure) canvas.dataset.artDetails = artCanvases.filter(({ mesh }) => artwork.has(mesh)).map(({ id }) => id).join(",");
    };
    const loadPreview = async () => {
      const map = await loadBitmapTexture(`${STORAGE_ASSETS}/art/gallery-preview-v1.webp`);
      if (disposed || signal.aborted) { disposeTexSafe(map); return; }
      map.colorSpace = SRGBColorSpace;
      map.flipY = false;
      map.channel = 1;
      previewMaterial = pictureMaterial(map);
      const { columns, tile, border } = ART_PREVIEW;
      const slots = new Map(FLOOR.artWalls.map(({ id }, index) => [id, index]));
      const width = columns * tile, height = Math.ceil(slots.size / columns) * tile;
      const span = tile - 2 * border - 1;
      for (const { mesh, id } of artCanvases) {
        const slot = slots.get(id), uv = mesh.geometry.getAttribute("uv");
        if (slot === undefined || !uv) continue;
        const x = slot % columns * tile + border + .5, y = Math.floor(slot / columns) * tile + border + .5;
        const coords = new Float32Array(uv.count * 2);
        for (let i = 0; i < uv.count; i++) {
          coords[i * 2] = (x + uv.getX(i) * span) / width;
          coords[i * 2 + 1] = (y + uv.getY(i) * span) / height;
        }
        mesh.geometry.setAttribute("uv1", new Float32BufferAttribute(coords, 2));
        previewMeshes.add(mesh);
        if (!artwork.has(mesh)) mesh.material = previewMaterial;
      }
      if (measure) canvas.dataset.artPreviews = String(previewMeshes.size);
    };
    const loadArtwork = async (art: typeof artCanvases[number]) => {
      const { mesh, id, placeholder } = art;
      let map: Texture | undefined;
      try {
        map = await loadBitmapTexture(`${STORAGE_ASSETS}/art/${id}-1k.webp`);
        if (disposed || signal.aborted) { disposeTexSafe(map); return; }
        map.colorSpace = SRGBColorSpace;
        map.flipY = false;
        map.anisotropy = maxAniso;
        renderer.initTexture(map);
        const material = pictureMaterial(map);
        artwork.set(mesh, () => {
          mesh.material = previewMeshes.has(mesh) && previewMaterial ? previewMaterial : placeholder;
          if (material.map) disposeTexSafe(material.map);
          material.dispose();
        });
        mesh.material = material;
        artworkMetrics();
      } catch {
        if (map) disposeTexSafe(map);
        art.retryAt = performance.now() + 10_000;
      }
    };
    releases.push(() => {
      for (const release of artwork.values()) release();
      artwork.clear();
      for (const { mesh, placeholder } of artCanvases) mesh.material = placeholder;
      if (previewMaterial?.map) disposeTexSafe(previewMaterial.map);
      previewMaterial?.dispose();
      previewMeshes.clear();
    });
    // Preview atlas loads right after reveal so boot stays instant; nearest 6 visible paintings upgrade lazily to 1K!
    const maxLiveArt = mobile ? 5 : 6;
    function updateArtwork() {
      if (artPending || drag || tour.isActive() || velX * velX + velZ * velZ > 0.16) return;
      const nearest = artCanvases.map(art => ({ art, distance: art.bounds.center.distanceToSquared(camera.position), visible: frustum.intersectsSphere(art.bounds) }))
        .filter(({ distance, visible }) => visible && distance < 10.5 ** 2)
        .sort((a, b) => a.distance - b.distance).slice(0, maxLiveArt).map(({ art }) => art);
      for (const [mesh, release] of artwork) {
        if (nearest.some(art => art.mesh === mesh)) continue;
        release();
        artwork.delete(mesh);
        artworkMetrics();
      }
      const now = performance.now();
      const next = nearest.find(art => !artwork.has(art.mesh) && art.retryAt <= now);
      if (next) {
        artPending = true;
        void loadArtwork(next).finally(() => { artPending = false; });
      }
    }

    // Restrained cinema post-processing: whisper-soft high-threshold bloom (zero glare!) + subtle luxury vignette,
    // plus screen-space ambient occlusion (GTAO) so chairs, sofas, monitors and planters sit on the floor with real
    // contact shadows. Lit screens/LEDs are masked out of the AO through the emissive channel packed in normal.a.
    let pipeline: RenderPipeline | undefined;
    const wantBloom = params.get("bloom") === "1" || (params.get("bloom") !== "0" && !mobile);
    let wantAO = wantBloom && params.get("ao") !== "0" && backend === "webgpu";
    let wantSSR = wantAO && params.get("ssr") !== "0";
    const ssrStrength = float(Number(params.get("ssrk") ?? 1));
    const buildPipeline = () => {
      pipeline?.dispose();
      pipeline = new RenderPipeline(renderer);
      const scenePass = pass(scene, camera);
      const sceneColor = scenePass.getTextureNode("output");
      let color: ReturnType<typeof vec4> | typeof sceneColor = sceneColor;
      if (wantAO) {
        // Only opaque surfaces may write the AO/SSR buffers: light shafts, holo rings, glass and motes are
        // translucent (alpha < 1). Without this a god-ray sheet overwrote the floor's normals and GTAO
        // drew it as a dark wall from ceiling to floor. Per-attachment alpha blending keeps what is behind.
        const opaque = step(.985, diffuseColor.a);
        const geometryMrt = mrt({
          output,
          normal: vec4(packNormalToRGB(normalView), opaque),
          // r = SSR reflectivity (level clear-coated stone/water), g = roughness, b = glow (never darkened by AO)
          surface: vec4(clearcoat.mul(smoothstep(.8, .97, normalWorld.y)), roughness, tslClamp(luminance(emissive).mul(6), 0, 1), opaque),
        });
        geometryMrt.setBlendMode("normal", new BlendMode(NormalBlending));
        geometryMrt.setBlendMode("surface", new BlendMode(NormalBlending));
        scenePass.setMRT(geometryMrt);
        scenePass.getTexture("normal").type = UnsignedByteType;
        scenePass.getTexture("surface").type = UnsignedByteType;
        const packed = scenePass.getTextureNode("normal");
        const surface = scenePass.getTextureNode("surface");
        const depth = scenePass.getTextureNode("depth");
        const sceneNormal = sample(uv => unpackRGBToNormal(packed.sample(uv).rgb));
        const aoPass = ao(depth, sceneNormal, camera);
        aoPass.resolutionScale = .5;
        aoPass.radius.value = .6;         // metres: chair legs, desk skirts, sofa seams, monitor feet
        aoPass.thickness.value = .9;
        aoPass.distanceExponent.value = 1.6;
        aoPass.scale.value = 1.2;
        aoPass.samples.value = 12;
        const occlusion = aoPass.getTextureNode().sample(screenUV).r;
        const glow = surface.b;           // screens, LEDs, coves: never darkened
        const factor = mix(float(1), occlusion, float(.9).mul(float(1).sub(glow)));
        let rgb = sceneColor.rgb.mul(factor);
        if (wantSSR) {
          // Polished stone floor mirrors the desks, screens and core (only pixels the marble marks are traced).
          const reflection = ssr(sceneColor, depth, sceneNormal, { metalnessNode: surface.r, roughnessNode: surface.g, camera });
          reflection.resolutionScale = .5;
          reflection.maxDistance.value = 14;
          reflection.thickness.value = .08;
          reflection.quality.value = .5;
          reflection.maxLuminance.value = 6;
          reflection.screenEdgeFade.value = .25;
          rgb = rgb.add(reflection.getTextureNode().sample(screenUV).rgb.mul(ssrStrength));
        }
        color = vec4(rgb, sceneColor.a);
      }
      const lit = color.add(bloom(color, .085, .36, 1.48));
      const centered = screenUV.sub(vec2(0.5, 0.5)).mul(2.0);
      const vig = float(1.0).sub(smoothstep(float(0.42), float(1.36), centered.length()).mul(0.15));
      const graded = vibrance(lit, float(0.04));
      pipeline.outputNode = vec4(graded.rgb.mul(vig), lit.a);
      if (measure) canvas.dataset.ao = (wantAO ? "ao" : "-") + (wantAO && wantSSR ? "+ssr" : "");
    };
    if (wantBloom) buildPipeline();
    releases.push(() => pipeline?.dispose());

    const keys = new Set<string>();
    const state = { ...FLOOR.spawn, y: 0 };
    let eyeY = state.y;
    const cabins = LIFTS.map(() => 0), cabinTarget = LIFTS.map(() => 0);
    let lastLift = "", lastFloor = -1, wasMoving = false;
    state.yaw *= RAD;
    let pitch = state.pitch;
    let lookYaw = state.yaw, lookPitch = pitch;   // rendered view eases toward the dragged target
    let touchX = 0, touchForward = 0, velX = 0, velZ = 0;
    let drag: { pointer: number; x: number; y: number; travel: number } | undefined;
    let last = 0, lastPosition = 0, lastHover = -Infinity, lastArtwork = 0, pushedPose = false, aspect = 1, dpr = 0;
    let lastSentX = NaN, lastSentZ = NaN, lastSentYaw = NaN;
    let lastCamX = NaN, lastCamY = NaN, lastCamZ = NaN, lastCamYaw = NaN, lastCamPitch = NaN;
    let slowSince = 0, tier = 0, started = 0, fastSince = 0, ssrDropped = false, ssrRetries = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const frames: number[] = [];
    const recent: number[] = [];
    const pointer = new Vector2(), ray = new Raycaster();
    const frustum = new Frustum(), viewProjection = new Matrix4();
    const pause = () => { keys.clear(); touchX = touchForward = velX = velZ = 0; };
    const isField = (event: KeyboardEvent) => event.target instanceof HTMLElement &&
      !!event.target.closest("input,button,select,textarea,a,[contenteditable],[role=dialog]");
    // Cap DPR: 1.5x on desktop & flagship Android, 1.35x on iPad, 1.25x on low-memory phones.
    const maxRatio = () => Math.min(window.devicePixelRatio || 1, tier >= 4 ? 1.0 : isIPad ? 1.35 : mobile ? 1.25 : tier >= 2 ? 1.25 : 1.5);

    function resize() {
      const { width, height } = host.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const ratio = maxRatio();
      if (dpr === ratio && canvas.width === Math.floor(width * ratio) && canvas.height === Math.floor(height * ratio)) return;
      dpr = ratio;
      aspect = camera.aspect = inspectCamera.aspect = width / height;
      camera.fov = aspect < 1 ? Math.min(96, Math.max(72, 2 * Math.atan(Math.tan(31 * RAD) / aspect) / RAD)) : 62;
      camera.updateProjectionMatrix();
      inspectCamera.fov = aspect < 1 ? 50 : 40;
      inspectCamera.updateProjectionMatrix();
      renderer.setDrawingBufferSize(width, height, dpr);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    releases.push(() => observer.disconnect());
    resize();

    function pick(clientX: number, clientY: number) {
      const rect = canvas.getBoundingClientRect();
      pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
      ray.setFromCamera(pointer, camera);
      ray.far = 65;
      const hit = ray.intersectObjects(pickTargets, false)[0];
      if (!hit) return null;
      return occluded(ray.ray, hit.distance - .02) ? null : hit.object.userData.panel as string;
    }

    function down(event: PointerEvent) {
      if (event.button !== 0 || drag) return;
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(event.pointerId);
      drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, travel: 0 };
    }
    function move(event: PointerEvent) {
      if (!drag || drag.pointer !== event.pointerId) {
        if (event.pointerType === "mouse" && !drag && event.timeStamp - lastHover >= 90) {
          lastHover = event.timeStamp;
          canvas.style.cursor = pick(event.clientX, event.clientY) ? "pointer" : "grab";
        }
        return;
      }
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      drag.x = event.clientX; drag.y = event.clientY;
      drag.travel += Math.abs(dx) + Math.abs(dy);
      if (drag.travel < 5) return;
      stopTour();
      state.yaw -= dx * .0045;
      pitch = clamp(pitch - dy * .0045, -.8, 1.15);
      canvas.style.cursor = "grabbing";
    }
    function up(event: PointerEvent) {
      if (!drag || drag.pointer !== event.pointerId) return;
      const choose = event.type === "pointerup" && drag.travel < 8;
      drag = undefined;
      canvas.style.cursor = "grab";
      if (!choose) return;
      const panel = pick(event.clientX, event.clientY);
      if (panel) { pause(); events.select(panel); }
    }
    function keydown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || isField(event) || document.querySelector(".ng-dialog")) return;
      if (event.code === "Enter" && event.target === canvas) {
        const rect = canvas.getBoundingClientRect();
        const panel = pick(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (panel) { event.preventDefault(); pause(); events.select(panel); }
      }
      if (KEYS.has(event.code)) { event.preventDefault(); stopTour(); keys.add(event.code); }
    }
    const keyup = (event: KeyboardEvent) => { keys.delete(event.code); };

    function govern(elapsed: number, now: number) {
      // Hold locked 60 fps smoothly without pipeline reallocation hitches:
      // tier 1 = drop SSR (restored once frames recover) -> tier 2 = cap DPR 1.25 -> tier 3 = disable bloom -> tier 4 = cap DPR 1.0.
      if (!started) started = now;
      if (now - started < 5000) return;
      recent.push(elapsed);
      if (recent.length > 60) recent.shift();
      if (recent.length < 60 || tier >= 4) return;
      const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
      if (measure) canvas.dataset.govern = `${tier}:${avg.toFixed(1)}:${ssrDropped ? 1 : 0}:${ssrRetries}`;
      // SSR is often dropped by the burst of big texture uploads right after entering (16K skyline, art).
      // Once frames hold 60 fps again for 10 s, try it again (twice at most, so a slow GPU cannot flap).
      if (tier === 1 && ssrDropped && ssrRetries < 2 && avg <= 17.6) {
        if (!fastSince) fastSince = now;
        if (now - fastSince > 10000) {
          tier = 0; ssrDropped = false; ssrRetries++; fastSince = 0; recent.length = 0;
          wantSSR = true; buildPipeline();
          canvas.dataset.qualityTier = "0";
          return;
        }
      } else fastSince = 0;
      if (avg > 19.2) {
        if (!slowSince) slowSince = now;
        if (now - slowSince > 1800) {
          tier++;
          slowSince = 0;
          recent.length = 0;
          if (tier === 1) {
            // First step down: drop the floor reflections only (picture stays sharp at full resolution).
            if (wantSSR && pipeline) { wantSSR = false; ssrDropped = true; buildPipeline(); } else resize();
          } else if (tier === 2) resize();
          else if (tier === 3) {
            if (pipeline) { pipeline.dispose(); pipeline = undefined; }
          } else resize();
          canvas.dataset.qualityTier = String(tier);
        }
      } else slowSince = 0;
    }

    let ready = false, rendered = false;
    function repaint(now: number) {
      if (!last) last = now;
      const elapsed = now - last, step = Math.min(elapsed / 1000, .033);
      last = now;
      if (elapsed > 0 && elapsed < 250) govern(elapsed, now);
      if (measure && elapsed > 0) {
        frames.push(elapsed);
        if (frames.length > 2400) frames.splice(0, 600);
      }
      if (dpr !== maxRatio()) resize();
      // When inspecting a 3D sculpture, pause the hall simulation & render ONLY the lightweight 360° studio!
      if (inspectingId) {
        if (orbit.autoRotate && !reduced.matches) orbit.targetTheta += step * 0.34;
        const k = 1 - Math.exp(-step * 12);
        orbit.theta += (orbit.targetTheta - orbit.theta) * k;
        orbit.phi += (orbit.targetPhi - orbit.phi) * k;
        orbit.dist += (orbit.targetDist - orbit.dist) * k;
        orbit.panX += (orbit.targetPanX - orbit.panX) * k;
        orbit.panY += (orbit.targetPanY - orbit.panY) * k;
        const sinPhi = Math.sin(orbit.phi);
        inspectCamera.position.set(
          orbit.panX + orbit.dist * sinPhi * Math.sin(orbit.theta),
          orbit.panY + orbit.dist * Math.cos(orbit.phi),
          orbit.dist * sinPhi * Math.cos(orbit.theta),
        );
        inspectCamera.lookAt(orbit.panX, orbit.panY, 0);
        const prevExposure = renderer.toneMappingExposure;
        renderer.toneMappingExposure = 1.02;
        renderer.render(inspectScene, inspectCamera);
        renderer.toneMappingExposure = prevExposure;
        rendered = true;
        return;
      }
      const axisX = Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft")) + touchX;
      const axisZ = Number(keys.has("KeyW") || keys.has("ArrowUp")) - Number(keys.has("KeyS") || keys.has("ArrowDown")) + touchForward;
      const scale = ((keys.has("ShiftLeft") || keys.has("ShiftRight")) ? 5.2 : 3.0) / Math.max(1, Math.hypot(axisX, axisZ));
      const cos = Math.cos(state.yaw), sin = Math.sin(state.yaw);
      const blend = 1 - Math.exp(-step * 8);   // gentle acceleration and glide
      velX += ((axisX * cos - axisZ * sin) * scale - velX) * blend;
      velZ += ((-axisX * sin - axisZ * cos) * scale - velZ) * blend;
      // Elevators: cabins glide toward their target floor; a visitor inside rides along.
      CABIN_Y = cabins;
      const inside = LIFTS.findIndex((e, i) => Math.hypot(state.x - e.x, state.z - e.z) < e.r - CABIN_WALK && Math.abs(state.y - cabins[i]) < .3);
      let moving = false;
      LIFTS.forEach((_, i) => {
        const d = cabinTarget[i] - cabins[i];
        if (Math.abs(d) < .005) { cabins[i] = cabinTarget[i]; return; }
        if (doorOpen[i] > .05) return;          // wait for the doors
        moving = moving || i === inside;
        const v = Math.sign(d) * Math.min(Math.abs(d) * 2.2 + .25, 1.8);   // ease in and out, 1.8 m/s top
        cabins[i] += Math.abs(v * step) > Math.abs(d) ? d : v * step;
        if (i === inside) state.y = cabins[i];
        const node = cabinNodes[i];
        if (node) { node.position.y = cabins[i]; node.updateMatrixWorld(true); }
      });
      // Doors: closed while the cabin travels; open when it stands at a floor and someone is near.
      for (let i = 0; i < LIFTS.length; i++) {
        const e = LIFTS[i];
        const travelling = Math.abs(cabinTarget[i] - cabins[i]) > .01;
        const near = Math.hypot(state.x - e.x, state.z - e.z) < e.r + 3 && Math.abs(state.y - cabins[i]) < 1;
        const want = travelling ? 0 : near ? 1 : 0;
        const diff = want - doorOpen[i];
        if (Math.abs(diff) > 1e-4) {
          doorOpen[i] += Math.sign(diff) * Math.min(Math.abs(diff), step * 1.6);
          const pair = doorNodes[i];
          for (let k = 0; k < pair.length; k++) {
            const node = pair[k];
            if (!node) continue;
            node.rotation.y = doorBase[i][k] + (k === 0 ? -1 : 1) * doorOpen[i] * 31 * RAD;
            node.updateMatrixWorld(true);
          }
        }
        if (inside !== i && !travelling) {
          const callNear = Math.hypot(state.x - e.x, state.z - e.z) < e.r + 1.6;
          if (callNear && Math.abs(cabins[i] - state.y) > .3) cabinTarget[i] = FLOORS[levelOf(state.y)];
        }
      }
      const tourPose = tour.step(step);
      if (!moving && !tourPose && (Math.abs(velX) > 1e-4 || Math.abs(velZ) > 1e-4)) {
        const nx = state.x + velX * step, nz = state.z + velZ * step;
        const hx = surfaceAt(nx, state.z, state.y, cabins);
        if (hx !== null) { state.x = nx; state.y = hx; }
        const hz = surfaceAt(state.x, nz, state.y, cabins);
        if (hz !== null) { state.z = nz; state.y = hz; }
      }
      if (tourPose) {
        camera.position.set(tourPose.x, tourPose.y, tourPose.z);
        lookYaw = state.yaw = tourPose.yaw;
        lookPitch = pitch = tourPose.pitch;
        camera.rotation.set(lookPitch, lookYaw, 0, "YXZ");
      } else {
        eyeY += (state.y - eyeY) * (1 - Math.exp(-step * 14));    // stairs read as steps, not a ramp jolt
        const stride = reduced.matches ? 0 : clamp(Math.hypot(velX, velZ) / 3, 0, 1) * Math.sin(now * .0085) * .02;
        camera.position.set(state.x, eyeY + EYE + stride, state.z);
        // Riding up or down: turn the view to the atrium and the light core (the reason to ride a glass cabin).
        if (moving && !wasMoving) {
          const face = Math.atan2(state.x, state.z);                       // yaw that looks at the centre
          const turn = Math.atan2(Math.sin(face - state.yaw), Math.cos(face - state.yaw));
          state.yaw += turn;                                               // shortest way round; the view eases there
          pitch = .06;
        }
        wasMoving = moving;
        const ease = 1 - Math.exp(-step * 22);
        lookYaw += (state.yaw - lookYaw) * ease;
        lookPitch += (pitch - lookPitch) * ease;
        camera.rotation.set(lookPitch, lookYaw, 0, "YXZ");
      }
      // Zero-allocation lift state key check
      let liftKey = `${inside}:${moving ? 1 : 0}`;
      for (let i = 0; i < cabins.length; i++) liftKey += ":" + levelOf(cabins[i]);
      if (liftKey !== lastLift) {
        lastLift = liftKey;
        events.lift?.({ inside: inside >= 0 ? inside : null, floor: levelOf(state.y), moving, cabins: cabins.map(levelOf) });
      }
      if (levelOf(state.y) !== lastFloor) { lastFloor = levelOf(state.y); events.floor?.(lastFloor); }
      const camMoved =
        Math.abs(camera.position.x - lastCamX) > 1e-4 ||
        Math.abs(camera.position.y - lastCamY) > 1e-4 ||
        Math.abs(camera.position.z - lastCamZ) > 1e-4 ||
        Math.abs(lookYaw - lastCamYaw) > 1e-4 ||
        Math.abs(lookPitch - lastCamPitch) > 1e-4;
      if (camMoved) {
        lastCamX = camera.position.x; lastCamY = camera.position.y; lastCamZ = camera.position.z;
        lastCamYaw = lookYaw; lastCamPitch = lookPitch;
        camera.updateMatrixWorld();
        frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem);
      }
      fx.tick(now, step, reduced.matches);
      screens.tick(now, reduced.matches, camMoved ? frustum : undefined);
      if (pipeline) pipeline.render(); else renderer.render(scene, camera);
      rendered = true;
      if (ready && now - lastArtwork > (mobile ? 400 : 450)) {
        lastArtwork = now;
        updateArtwork();
      }
      if (!pushedPose || now - lastPosition > (tourPose ? 260 : 140)) {
        pushedPose = true; lastPosition = now;
        const posX = tourPose ? tourPose.x : state.x;
        const posZ = tourPose ? tourPose.z : state.z;
        const posYaw = tourPose ? tourPose.yaw : state.yaw;
        if (
          Math.abs(posX - lastSentX) > 0.01 ||
          Math.abs(posZ - lastSentZ) > 0.01 ||
          Math.abs(posYaw - lastSentYaw) > 0.004
        ) {
          lastSentX = posX; lastSentZ = posZ; lastSentYaw = posYaw;
          events.position(posX, posZ, posYaw);
        }
        if (measure && frames.length) {
          canvas.dataset.frameMs = frames.slice(-300).map(delta => delta.toFixed(2)).join(",");
          canvas.dataset.drawCalls = String(renderer.info.render.drawCalls);
          canvas.dataset.triangles = String(renderer.info.render.triangles);
          canvas.dataset.pose = [posX, posZ, posYaw].map(v => v.toFixed(2)).join(",");
          canvas.dataset.paintMs = JSON.stringify(screens.paintMs);
          const perfMem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
          if (perfMem) canvas.dataset.jsHeapMb = (perfMem.usedJSHeapSize / (1024 * 1024)).toFixed(1);
        }
      }
    }
    function drawFrame(now: number) {
      frame = 0;
      if (disposed || signal.aborted) return;
      try { repaint(now); } catch (error) { fail(error); }
      if (!disposed && dpr && aspect) frame = requestAnimationFrame(drawFrame);
    }
    // Render only while someone can see it: tab visible and the view at least partly on screen.
    let onScreen = true, suspended = false;
    const visibility = () => {
      if (document.hidden || !onScreen || suspended) { cancelAnimationFrame(frame); frame = 0; last = 0; pause(); }
      else if (!disposed && !frame) frame = requestAnimationFrame(drawFrame);
    };
    const sight = new IntersectionObserver(entries => {
      onScreen = entries[entries.length - 1].isIntersecting;
      visibility();
    });
    sight.observe(host);
    releases.push(() => sight.disconnect());
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", visibility);
    releases.push(() => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", pause);
      document.removeEventListener("visibilitychange", visibility);
    });
    // Set crisp anisotropy on GLB hall textures without a 6.1-second blocking compileAsync over all 120+ offscreen materials!
    // Frame 1 compiles only the visible frustum (~0.6-1.0s instead of 6.1s!), cutting total load time by ~5+ seconds!
    if (!mobile) {
      model.traverse(child => {
        if (!(child instanceof Mesh)) return;
        for (const m of Array.isArray(child.material) ? child.material : [child.material]) {
          for (const value of Object.values(m)) {
            if (value instanceof Texture && value.anisotropy < maxAniso) value.anisotropy = maxAniso;
          }
        }
      });
    }
    const tCompileDone = performance.now();
    const update = (snapshot: FloorSnapshot, series: Captions, language: Language) => {
      fx.setIndexChange(testChange ?? snapshot.index?.change ?? 0);
      if (measure) {
        const c = fx.getCelebrationState();
        canvas.dataset.rallyTier = String(c.tier);
        canvas.dataset.rallySparks = String(c.activeCeilingSparks);
      }
      screens.update(snapshot, series, language);
    };
    await Promise.race([screens.ready(), new Promise<void>(r => window.setTimeout(r, 900))]);
    signal.throwIfAborted();
    if (disposed) throw new Error("Trading hall GPU context was lost");
    const initial = events.initialDisplays();
    if (initialMood === "night") fx.setMood("night");
    update(initial.snapshot, initial.series, initial.language);
    visibility();
    // Reveal as soon as Frame 1 renders + hero boards flush (max 450ms post-first-frame, never stuck at 99% for 3s!)
    let firstRenderAt = 0;
    await new Promise<void>(resolve => {
      const check = () => {
        if (disposed || signal.aborted) { resolve(); return; }
        if (rendered && !firstRenderAt) firstRenderAt = performance.now();
        if (rendered && (screens.settled() || performance.now() - firstRenderAt > 450)) resolve();
        else requestAnimationFrame(check);
      };
      check();
    });
    signal.throwIfAborted();
    if (disposed) throw new Error("Trading hall GPU context was lost");
    // Keep fast boot-burst screen uploads active briefly after reveal until all visible boards settle, then lock to 1/frame for 60 FPS!
    const finishBootBurst = () => {
      if (disposed || signal.aborted) return;
      if (screens.settled()) screens.setBootMode(false);
      else window.setTimeout(() => { if (!disposed && !signal.aborted) screens.setBootMode(false); }, 1200);
    };
    finishBootBurst();
    if (measure) {
      const tReveal = performance.now();
      canvas.dataset.bootMs = JSON.stringify({
        init: Math.round(tInitDone - tBoot0),
        assets: Math.round(tAssetsDone - tInitDone),
        compile: Math.round(tCompileDone - tAssetsDone),
        reveal: Math.round(tReveal - tCompileDone),
        total: Math.round(tReveal - tBoot0),
      });
    }
    events.renderer(backend);
    ready = true;
    // Lazy-load the other 2 inactive fallback skylines after reveal (or immediately on mood switch!)
    let fallbackSkylinesPromise: Promise<void> | null = null;
    const ensureAllFallbackSkylines = () => {
      if (fallbackSkylinesPromise) return fallbackSkylinesPromise;
      fallbackSkylinesPromise = (async () => {
        try {
          const dayTex = initialMood === "daylight" ? initialSkyTex : await loadSkylineFallback("skyline-day-v7.webp");
          if (disposed || signal.aborted) return;
          const goldenTex = await loadSkylineFallback("skyline-golden-v7.webp");
          if (disposed || signal.aborted) return;
          const nightTex = initialMood === "night" ? initialSkyTex : await loadSkylineFallback("skyline-night-v7.webp");
          if (disposed || signal.aborted) return;
          fx.setFallbackSkylines(dayTex, goldenTex, nightTex);
        } catch {
          // Keep active skyline intact if secondary fallback fails
        }
      })();
      return fallbackSkylinesPromise;
    };
    // On-demand effective-16K dual-hemisphere skyline loader (desktop only: 2x 8192x4096 = 16,380x4,096 seamless!).
    // Keeps GPU VRAM strictly bounded to ONLY the currently active mood (~256 MB) while instant 8K handles smooth crossfades.
    let activeHiRes: { mood: AtriumMood; L: Texture; R: Texture } | null = null;
    let hiResToken = 0;
    const disposeHiResLater = (pair: { L: Texture; R: Texture }) => {
      window.setTimeout(() => {
        disposeTexSafe(pair.L);
        disposeTexSafe(pair.R);
      }, 250);
    };
    releases.push(() => {
      hiResToken += 1;
      if (activeHiRes) {
        fx.setHiResSkyline(null);
        disposeTexSafe(activeHiRes.L);
        disposeTexSafe(activeHiRes.R);
        activeHiRes = null;
      }
    });
    const loadHiResSkyline = async (mood: AtriumMood) => {
      if (mobile || disposed || signal.aborted) return;
      if (activeHiRes?.mood === mood) {
        fx.setHiResSkyline(mood, activeHiRes.L, activeHiRes.R);
        return;
      }
      const token = ++hiResToken;
      if (activeHiRes) {
        const stale = activeHiRes;
        activeHiRes = null;
        fx.setHiResSkyline(null);
        disposeHiResLater(stale);
      }
      if (params.has("exchangeMetrics")) canvas.dataset.skylineRes = "8k-loading-16k";
      const key = mood === "daylight" ? "day" : mood;
      try {
        const [texL, texR] = await Promise.all([
          loadSkyline(`skyline-${key}-16k-L-v7.webp`, true),
          loadSkyline(`skyline-${key}-16k-R-v7.webp`, true),
        ]);
        if (disposed || signal.aborted || token !== hiResToken) {
          texL.dispose();
          texR.dispose();
          return;
        }
        // Avoid hitching an active pointer drag when binding the 16K pair
        while (drag && !disposed && !signal.aborted && token === hiResToken) {
          await new Promise(r => setTimeout(r, 60));
        }
        if (disposed || signal.aborted || token !== hiResToken) {
          texL.dispose();
          texR.dispose();
          return;
        }
        activeHiRes = { mood, L: texL, R: texR };
        fx.setHiResSkyline(mood, texL, texR);
        if (params.has("exchangeMetrics")) canvas.dataset.skylineRes = `16k-${key}`;
      } catch {
        // Keep seamless 8K fallback active silently if 16K tiles are unavailable
        if (params.has("exchangeMetrics") && token === hiResToken) canvas.dataset.skylineRes = "8k-fallback";
      }
    };

    // Post-reveal progressive enhancement: load HDR env, gallery preview atlas, 16K skyline (desktop), & secondary moods!
    loadEnvironment();
    void loadPreview().catch(() => { /* nearby 1K pictures still load independently */ });
    if (!mobile) {
      void loadHiResSkyline(fx.getMood()).then(() => {
        if (!disposed && !signal.aborted) window.setTimeout(() => void ensureAllFallbackSkylines(), 1500);
      });
    } else {
      window.setTimeout(() => { if (!disposed && !signal.aborted) void ensureAllFallbackSkylines(); }, 2500);
    }
    if (measure) {
      // Repeatable screenshots/timings: put the camera on an exact pose (only with ?exchangeMetrics).
      const w = window as unknown as { __exchangePose?: (p: Pose) => void };
      w.__exchangePose = p => {
        stopTour(); pause();
        state.x = p.x; state.z = p.z; state.y = eyeY = p.y ?? 0;
        state.yaw = lookYaw = p.yaw * RAD; pitch = lookPitch = p.pitch;
      };
      (window as unknown as { __exchangePick?: (x: number, y: number) => unknown }).__exchangePick = (x, y) => {
        const rect = canvas.getBoundingClientRect();
        pointer.set((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1);
        ray.setFromCamera(pointer, camera);
        return ray.intersectObjects(scene.children, true).slice(0, 4).map(h => {
          const m = (h.object as Mesh).material as Material | Material[];
          const mat = Array.isArray(m) ? m.map(v => v.name).join("+") : m?.name;
          return { name: h.object.name, parent: h.object.parent?.name, mat, d: +h.distance.toFixed(2), p: h.point.toArray().map(v => +v.toFixed(2)) };
        });
      };
      releases.push(() => { delete w.__exchangePose; });
    }
    return {
      move(x, forward) { if (Math.abs(x) > .05 || Math.abs(forward) > .05) stopTour(); touchX = clamp(x, -1, 1); touchForward = clamp(forward, -1, 1); },
      jump(pose) {
        const y = pose.y ?? 0;
        if (surfaceAt(pose.x, pose.z, y, cabins) === null) return;
        stopTour();
        pause();
        state.x = pose.x; state.z = pose.z; state.y = eyeY = y;
        state.yaw = lookYaw = pose.yaw * RAD; pitch = lookPitch = pose.pitch;
        canvas.focus({ preventScroll: true });
      },
      stop: pause,
      setMood(mood) {
        void ensureAllFallbackSkylines();
        fx.setMood(mood);
        void loadHiResSkyline(mood);
      },
      setTour(on) {
        if (on) { pause(); tour.start(); events.tour?.(true); }
        else stopTour();
      },
      inspectSculpture(id) {
        if (id) { stopTour(); pause(); }
        return openSculptureInspect(id);
      },
      sculptureControl(action) {
        if (action.type === "orbit") {
          orbit.autoRotate = false;
          orbit.targetTheta -= action.dx * 0.0085;
          orbit.targetPhi = clamp(orbit.targetPhi - action.dy * 0.0075, 0.14, 1.54);
        } else if (action.type === "pan") {
          const s = orbit.targetDist * 0.0014;
          orbit.targetPanX = clamp(orbit.targetPanX - action.dx * s, -0.75, 0.75);
          orbit.targetPanY = clamp(orbit.targetPanY + action.dy * s, -0.55, 0.75);
        } else if (action.type === "zoom") {
          orbit.targetDist = clamp(orbit.targetDist / action.factor, 0.85, 4.4);
        } else if (action.type === "reset") {
          resetOrbit();
        } else if (action.type === "autoRotate") {
          orbit.autoRotate = action.on;
        }
      },
      suspend(on) { suspended = on; visibility(); },
      ride(floor) {
        const i = LIFTS.findIndex((e, k) => Math.hypot(state.x - e.x, state.z - e.z) < e.r - CABIN_WALK && Math.abs(state.y - cabins[k]) < .3);
        if (i >= 0 && FLOORS[floor] !== undefined) cabinTarget[i] = FLOORS[floor];
      },
      update,
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
