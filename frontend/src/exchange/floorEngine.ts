import {
  Box3, BoxGeometry, Color, EquirectangularReflectionMapping, Frustum, MeshBasicMaterial, Vector3, HemisphereLight, Matrix4, Mesh, MeshStandardMaterial, NeutralToneMapping,
  PerspectiveCamera, Raycaster, SRGBColorSpace, Scene, Texture, TextureLoader, Vector2, WebGPUCoordinateSystem,
  type Ray,
  type BufferGeometry, type Material, type Object3D,
} from "three";
import { RenderPipeline, WebGPURenderer } from "three/webgpu";
import { pass } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import bake from "./bake.json";
import { FLOOR, MARKETS, STORAGE_ASSETS, type FloorSnapshot, type Language } from "./market";
import { createScreens } from "./screens";

type Pose = { x: number; z: number; yaw: number; pitch: number; y?: number };
/** Elevator state for the UI: whether the visitor stands in a cabin, where the cabins are. */
export type LiftState = { inside: number | null; floor: number; moving: boolean; cabins: number[] };
type Captions = Record<string, number[]>;
export type FloorDriver = {
  move: (x: number, forward: number) => void;
  jump: (pose: Pose) => void;
  stop: () => void;
  update: (snapshot: FloorSnapshot, series: Captions, language: Language) => void;
  /** Send the cabin the visitor stands in to a floor (0 = ground). */
  ride: (floor: number) => void;
  /** Stop rendering while a full-screen overlay (the art viewer) hides the hall. */
  suspend: (on: boolean) => void;
  dispose: () => void;
};

// Every bake changes the lightmap scales: use them as a cache key, so a reload always gets the
// current model and maps (the file names stay the same between local rebuilds).
const BAKE_KEY = "?v=" + Math.round(bake.shell.scale * 1e4).toString(36) + Math.round(bake.fixtures.scale * 1e4).toString(36);
const hallAsset = (file: string) => `${STORAGE_ASSETS}/${file}${BAKE_KEY}`;
const ENV = STORAGE_ASSETS + "/hall-env-v5.hdr" + BAKE_KEY;   // Cycles panorama of this hall
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
  for (const L of [...WALK.landings, ...WALK.thresholds]) if (inSector(r, t, L)) take(L.y);
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
    if (node.name === "shell" || node.name === "fixtures" || node.name === "emit") return node.name;
  }
  return "props";
}

/** Texture quality for screen canvases: full on capable devices, lighter on small-memory phones. */
function screenQuality() {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const coarse = matchMedia("(pointer: coarse)").matches;
  return memory <= 4 ? .62 : coarse ? .8 : 1;
}

type Events = {
  renderer: (mode: "webgpu" | "webgl2") => void;
  position: (x: number, z: number, yaw: number) => void;
  select: (panel: string) => void;
  progress?: (fraction: number) => void;
  lift?: (state: LiftState) => void;
  floor?: (floor: number) => void;
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
      progress?.(Math.min(.99, received / out.length));
    }
  } finally {
    reader.releaseLock();
  }
  if (!out || received !== out.length) throw new Error("Incomplete trading hall model download");
  return out.buffer;
}

export async function createFloor(host: HTMLDivElement, canvas: HTMLCanvasElement, signal: AbortSignal, events: Events, retryWithWebGL = false): Promise<FloorDriver> {
  if (signal.aborted) throw signal.reason;
  const params = new URLSearchParams(location.search);
  // Phones: dense pixels already hide edges, so skip MSAA there and start without bloom.
  const touch = matchMedia("(pointer: coarse)").matches;
  // iPadOS can present a desktop user agent. Use the established WebGL 2 backend on Apple touch devices.
  const appleTouch = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1);
  const mobile = touch || appleTouch;
  const dense = (window.devicePixelRatio || 1) >= 2;
  const renderer = new WebGPURenderer({ canvas, antialias: !(mobile && dense), alpha: false, powerPreference: "high-performance",
    forceWebGL: appleTouch || retryWithWebGL });
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = .72;   // calm daylight: bright stone floors must not glare
  const scene = new Scene();
  scene.background = new Color("#d9dde2");
  const camera = new PerspectiveCamera(62, 1, .08, 90);
  const sky = new HemisphereLight(SKY, "#5a5048", .5);
  scene.add(sky);
  const releases: (() => void)[] = [];
  let disposed = false, frame = 0;
  let environment: Texture | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    for (const release of releases.reverse()) release();
    environment?.dispose();
    renderer.dispose();
  };
  const fail = (error: unknown) => {
    if (disposed || signal.aborted) return;
    dispose();
    events.error(error);
  };
  try {
    renderer.onDeviceLost = info => fail(new Error(`${info.api} device lost: ${info.message}`));
    await renderer.init();
    signal.throwIfAborted();
    if (disposed) throw new Error("Trading hall GPU context was lost");
    const compressed = mobile && (["texture-compression-astc", "texture-compression-etc2", "texture-compression-bc",
      "texture-compression-s3tc"] as const).some(feature => renderer.hasFeature(feature));
    if (params.has("exchangeMetrics")) canvas.dataset.hallTextures = compressed ? "ktx2" : "webp";
    const textures = new TextureLoader();
    const ktx = compressed ? new KTX2Loader().setWorkerLimit(2).detectSupport(renderer) : undefined;
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    if (ktx) loader.setKTX2Loader(ktx);
    const lightmap = async (file: string) => {
      const tex = ktx ? await ktx.loadAsync(hallAsset(file.replace(/\.webp$/, ".ktx2"))) : await textures.loadAsync(hallAsset(file));
      if (disposed || signal.aborted) { tex.dispose(); throw signal.reason ?? new Error("Trading hall GPU context was lost"); }
      tex.flipY = false;
      tex.channel = 1;
      tex.colorSpace = SRGBColorSpace;
      releases.push(() => tex.dispose());
      return tex;
    };
    const loadModel = async () => {
      const file = compressed ? "trading-hall-v5-ktx2.glb" : "trading-hall-v5.glb";
      const binary = await fetchWithProgress(hallAsset(file), signal, events.progress);
      events.progress?.(.99);
      const { scene: model } = await loader.parseAsync(binary, STORAGE_ASSETS + "/");
      if (disposed || signal.aborted) { releaseModel(model); throw signal.reason ?? new Error("Trading hall GPU context was lost"); }
      releases.push(() => releaseModel(model));
      return model;
    };
    const { model, shellMap, fixtureMap } = await (async () => {
      // Limit the mobile startup peak: decode the hall before allocating either 4K lightmap.
      try {
        if (mobile) return { model: await loadModel(), shellMap: await lightmap(bake.shell.file), fixtureMap: await lightmap(bake.fixtures.file) };
        const [model, shellMap, fixtureMap] = await Promise.all([loadModel(), lightmap(bake.shell.file), lightmap(bake.fixtures.file)]);
        return { model, shellMap, fixtureMap };
      } finally { ktx?.dispose(); }
    })();
    signal.throwIfAborted();
    const screens = createScreens(screenQuality(), mobile, texture => renderer.initTexture(texture));
    releases.push(screens.dispose);

    // Baked global illumination: each lightmapped group gets its own material copies.
    const cloned = new Map<string, MeshStandardMaterial>();
    const propMaterials = new Set<MeshStandardMaterial>();
    model.traverse(child => {
      if (!(child instanceof Mesh)) return;
      const group = groupOf(child);
      child.matrixAutoUpdate = false;
      child.updateMatrix();
      const source = child.material as MeshStandardMaterial;
      if ((group === "shell" || group === "fixtures") && child.geometry.getAttribute("uv1")) {
        const key = group + ":" + source.uuid;
        let m = cloned.get(key);
        if (!m) {
          m = source.clone();
          // Light stone floors and slabs read too bright under the skylight: tone them down.
          if (/light stone/i.test(source.name)) m.color.multiplyScalar(.7);
          m.lightMap = group === "shell" ? shellMap : fixtureMap;
          m.lightMapIntensity = (group === "shell" ? bake.shell.scale : bake.fixtures.scale) * Math.PI;
          m.envMapIntensity = m.metalness > .5 ? 1.0 : .55;
          cloned.set(key, m);
        }
        child.material = m;
      } else if (group === "emit") {
        // Daylight glazing reads as soft sky, not a glare source; lamps a touch dimmer for long sessions.
        if (source.name === "Daylight glazing") source.emissiveIntensity *= .6;
        else if (source.emissiveIntensity > 1) source.emissiveIntensity *= .8;
        if (source.transparent || source.name === "Balustrade glass") {
          source.transparent = true; source.opacity = .16; source.depthWrite = false;
        }
      } else {
        propMaterials.add(source);   // bronze bull, chandeliers, furniture: lit by the hall panorama
      }
    });
    // Art: canvases named "Artwork:<id>" get their picture lazily; sculptures get cheap pick proxies.
    const artTargets: Mesh[] = [];
    const artCanvases: { mesh: Mesh; id: string; center: Vector3 }[] = [];
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
      artCanvases.push({ mesh, id, center: mesh.getWorldPosition(new Vector3()) });
    });
    for (const id of SCULPTURE_IDS) {
      const node = model.getObjectByName(id + "_1") ?? model.getObjectByName(id + " 1") ?? model.getObjectByName(id);
      if (!node) continue;
      const box = new Box3().setFromObject(node);
      const proxy = new Mesh(new BoxGeometry(...box.getSize(new Vector3()).toArray()), new MeshBasicMaterial({ visible: false }));
      proxy.position.copy(box.getCenter(new Vector3()));
      proxy.userData.panel = "sculpture:" + id;
      proxy.updateMatrixWorld(true);
      scene.add(proxy);
      artTargets.push(proxy);
    }
    if (params.has("exchangeMetrics")) {
      const names: string[] = [];
      model.traverse(o => { if (/artwork|elevator/i.test(o.name)) names.push(o.type + ":" + o.name); });
      canvas.dataset.artNodes = String(artCanvases.length) + " | " + names.slice(0, 6).join(", ");
    }
    const cabinNodes = LIFTS.map(e => model.getObjectByName(`Elevator_cabin_${e.id}`) ?? model.getObjectByName(`Elevator cabin ${e.id}`) ?? null);
    // Glass doors: two curved leaves on pivots at the cabin centre; they slide round the drum.
    const doorNodes = LIFTS.map(e => ["L", "R"].map(side => model.getObjectByName(`Elevator_door${side}_${e.id}`) ?? null));
    const doorBase = doorNodes.map(pair => pair.map(n => n?.rotation.y ?? 0));
    const doorOpen = LIFTS.map(() => 1);
    scene.add(model);
    scene.add(screens.group);
    const loadEnvironment = () => void new HDRLoader().loadAsync(ENV).then(texture => {
      if (disposed || signal.aborted) { texture.dispose(); return; }
      texture.mapping = EquirectangularReflectionMapping;
      scene.environment = environment = texture;
      for (const m of propMaterials) { m.envMap = texture; m.envMapIntensity = 1.7; m.needsUpdate = true; }
      // The panorama is the lit hall itself; lightmaps already carry diffuse light, so keep it modest.
      scene.environmentIntensity = .5;
    }).catch(() => {});
    if (!mobile) loadEnvironment();

    const artwork = new Map<Mesh, () => void>();
    let artPending = false;
    const loadArtwork = async ({ mesh, id }: typeof artCanvases[number]) => {
      const original = mesh.material;
      try {
        const map = await textures.loadAsync(`${STORAGE_ASSETS}/art/${id}-1k.webp`);
        if (disposed || signal.aborted) { map.dispose(); return; }
        map.colorSpace = SRGBColorSpace;
        map.flipY = false;
        map.anisotropy = 8;
        const material = new MeshStandardMaterial({ map, roughness: .78, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: .22 });
        artwork.set(mesh, () => { mesh.material = original; material.dispose(); map.dispose(); });
        mesh.material = material;
        renderer.initTexture(map);
      } catch { /* a missing picture leaves the neutral canvas */ }
    };
    releases.push(() => { for (const release of artwork.values()) release(); artwork.clear(); });
    function updateArtwork() {
      if (artPending) return;
      const nearest = artCanvases.map(art => ({ art, distance: art.center.distanceToSquared(camera.position), visible: frustum.containsPoint(art.center) }))
        .filter(({ distance, visible }) => visible || distance < 14 ** 2)
        .sort((a, b) => Number(b.visible) - Number(a.visible) || a.distance - b.distance).slice(0, 8).map(({ art }) => art);
      for (const [mesh, release] of artwork) {
        if (nearest.some(art => art.mesh === mesh)) continue;
        release();
        artwork.delete(mesh);
      }
      const next = nearest.find(art => !artwork.has(art.mesh));
      if (next) {
        artPending = true;
        void loadArtwork(next).finally(() => { artPending = false; });
      }
    }

    // Bloom only on genuinely bright pixels: lamps, daylight, the brightest figures.
    let pipeline: RenderPipeline | undefined;
    if (params.get("bloom") === "1" || (params.get("bloom") !== "0" && !mobile)) {
      pipeline = new RenderPipeline(renderer);
      const scenePass = pass(scene, camera);
      const color = scenePass.getTextureNode("output");
      pipeline.outputNode = color.add(bloom(color, .22, .4, .9));
      releases.push(() => pipeline?.dispose());
    }

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
    let slowSince = 0, tier = 0, started = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const measure = params.has("exchangeMetrics");
    const frames: number[] = [];
    const recent: number[] = [];
    const pointer = new Vector2(), ray = new Raycaster();
    const frustum = new Frustum(), viewProjection = new Matrix4();
    const backend = renderer.coordinateSystem === WebGPUCoordinateSystem ? "webgpu" : "webgl2";
    const pause = () => { keys.clear(); touchX = touchForward = velX = velZ = 0; };
    const isField = (event: KeyboardEvent) => event.target instanceof HTMLElement &&
      !!event.target.closest("input,button,select,textarea,a,[contenteditable],[role=dialog]");
    const maxRatio = () => Math.min(window.devicePixelRatio || 1, tier >= 2 ? 1.25 : tier >= 1 ? 1.6 : touch ? 2 : 2.5);

    function resize() {
      const { width, height } = host.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const ratio = maxRatio();
      if (dpr === ratio && canvas.width === Math.floor(width * ratio) && canvas.height === Math.floor(height * ratio)) return;
      dpr = ratio;
      aspect = camera.aspect = width / height;
      camera.fov = aspect < 1 ? Math.min(96, Math.max(72, 2 * Math.atan(Math.tan(31 * RAD) / aspect) / RAD)) : 62;
      camera.updateProjectionMatrix();
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
      ray.far = 45;
      const hit = ray.intersectObjects(artTargets.length ? [...screens.targets, ...artTargets] : screens.targets, false)[0];
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
      if (KEYS.has(event.code)) { event.preventDefault(); keys.add(event.code); }
    }
    const keyup = (event: KeyboardEvent) => { keys.delete(event.code); };

    function govern(elapsed: number, now: number) {
      // Hold 60 fps: shed bloom first, then cap the pixel ratio; resolution goes only when needed.
      // Ignore the first seconds: pipeline compiles and the first paint of every display are one-off.
      if (!started) started = now;
      if (now - started < 6000) return;
      recent.push(elapsed);
      if (recent.length > 90) recent.shift();
      if (recent.length < 90 || tier >= 3) return;
      const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
      if (avg > 18.2) {
        if (!slowSince) slowSince = now;
        if (now - slowSince > 2500) {
          tier++;
          slowSince = 0;
          recent.length = 0;
          if (tier === 1 && pipeline) { pipeline.dispose(); pipeline = undefined; tier = 1; } else resize();
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
      LIFTS.forEach((e, i) => {
        const travelling = Math.abs(cabinTarget[i] - cabins[i]) > .01;
        const near = Math.hypot(state.x - e.x, state.z - e.z) < e.r + 3 && Math.abs(state.y - cabins[i]) < 1;
        const want = travelling ? 0 : near ? 1 : 0;
        doorOpen[i] += Math.sign(want - doorOpen[i]) * Math.min(Math.abs(want - doorOpen[i]), step * 1.6);
        doorNodes[i].forEach((node, k) => {
          if (!node) return;
          node.rotation.y = doorBase[i][k] + (k === 0 ? -1 : 1) * doorOpen[i] * 31 * RAD;
          node.updateMatrixWorld(true);
        });
      });
      // A cabin leaves only once its doors have closed.
      // Calling: standing on a gallery threshold (or by the ground door) brings an idle cabin over.
      LIFTS.forEach((e, i) => {
        if (inside === i || Math.abs(cabinTarget[i] - cabins[i]) > .01) return;
        const near = Math.hypot(state.x - e.x, state.z - e.z) < e.r + 1.6;
        if (near && Math.abs(cabins[i] - state.y) > .3) cabinTarget[i] = FLOORS[levelOf(state.y)];
      });
      const nx = state.x + velX * step, nz = state.z + velZ * step;
      if (!moving) {
        const hx = surfaceAt(nx, state.z, state.y, cabins);
        if (hx !== null) { state.x = nx; state.y = hx; }
        const hz = surfaceAt(state.x, nz, state.y, cabins);
        if (hz !== null) { state.z = nz; state.y = hz; }
      }
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
      const liftKey = inside + ":" + moving + ":" + cabins.map(c => levelOf(c)).join(",");
      if (liftKey !== lastLift) {
        lastLift = liftKey;
        events.lift?.({ inside: inside >= 0 ? inside : null, floor: levelOf(state.y), moving, cabins: cabins.map(levelOf) });
      }
      if (levelOf(state.y) !== lastFloor) { lastFloor = levelOf(state.y); events.floor?.(lastFloor); }
      const ease = 1 - Math.exp(-step * 22);
      lookYaw += (state.yaw - lookYaw) * ease;
      lookPitch += (pitch - lookPitch) * ease;
      camera.rotation.set(lookPitch, lookYaw, 0, "YXZ");
      camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem);
      screens.tick(now, reduced.matches, frustum);
      if (pipeline) pipeline.render(); else renderer.render(scene, camera);
      rendered = true;
      if (mobile && ready && now - lastArtwork > 350) {
        lastArtwork = now;
        updateArtwork();
      }
      if (!pushedPose || now - lastPosition > 130) {
        pushedPose = true; lastPosition = now;
        events.position(state.x, state.z, state.yaw);
        if (measure && frames.length) {
          canvas.dataset.frameMs = frames.slice(-300).map(delta => delta.toFixed(2)).join(",");
          canvas.dataset.drawCalls = String(renderer.info.render.drawCalls);
          canvas.dataset.triangles = String(renderer.info.render.triangles);
          canvas.dataset.pose = [state.x, state.z, state.yaw].map(v => v.toFixed(2)).join(",");
          canvas.dataset.paintMs = JSON.stringify(screens.paintMs);
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
    if (!mobile && backend === "webgpu") {
      // WebGPU desktop can warm the scene. On WebGL 2 the eager binding pass can fail before
      // the first render, and on mobile it also forces every texture into memory at once.
      await renderer.compileAsync(scene, camera);
      signal.throwIfAborted();
      if (disposed) throw new Error("Trading hall GPU context was lost");
      const hallTextures = new Set<Texture>();
      model.traverse(child => {
        if (!(child instanceof Mesh)) return;
        for (const m of Array.isArray(child.material) ? child.material : [child.material]) {
          for (const value of Object.values(m)) if (value instanceof Texture) hallTextures.add(value);
        }
      });
      for (const texture of hallTextures) renderer.initTexture(texture);
    }
    const update = (snapshot: FloorSnapshot, series: Captions, language: Language) => {
      sky.color.set(SKY).lerp(new Color(MARKETS[snapshot.market].color), .06);
      screens.update(snapshot, series, language);
    };
    await screens.ready();
    signal.throwIfAborted();
    if (disposed) throw new Error("Trading hall GPU context was lost");
    const initial = events.initialDisplays();
    update(initial.snapshot, initial.series, initial.language);
    visibility();
    // Reveal once every visible display has its first picture (or after 5 s): no black screens on entry.
    const revealStart = performance.now();
    await new Promise<void>(resolve => {
      const check = () => {
        if (disposed || signal.aborted || (rendered && screens.settled()) || performance.now() - revealStart > 5000) resolve();
        else setTimeout(check, 60);
      };
      check();
    });
    signal.throwIfAborted();
    if (disposed) throw new Error("Trading hall GPU context was lost");
    events.renderer(backend);
    ready = true;
    if (mobile) loadEnvironment();
    else void (async () => {
      for (const art of artCanvases) {
        if (disposed || signal.aborted) return;
        await loadArtwork(art);
      }
    })();
    return {
      move(x, forward) { touchX = clamp(x, -1, 1); touchForward = clamp(forward, -1, 1); },
      jump(pose) {
        const y = pose.y ?? 0;
        if (surfaceAt(pose.x, pose.z, y, cabins) === null) return;
        pause();
        state.x = pose.x; state.z = pose.z; state.y = eyeY = y;
        state.yaw = lookYaw = pose.yaw * RAD; pitch = lookPitch = pose.pitch;
        canvas.focus({ preventScroll: true });
      },
      stop: pause,
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
