import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMediaQuery } from "../useMediaQuery";
import { captionedShot, saveImage3d, shareLink3d, view3dUrl, type ShareStage } from "./share3d";
import { OnScreen } from "./mapExport";
import KakaoIcon from "./KakaoIcon";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { api, RealEstateBuilding, RealEstateBuildingsResponse } from "../api/client";
import { vworldBuildings, vworldParcels, vworldRoads, withoutDemolished } from "./vworldBuildings";
import {
  CONTEXT_FLOOR_M, ContextStyle, contextStyle, sharedContextMaterial, warmMaterials, dirFrom, FinishShader, FLOOR_M, GROUND_M, inRing, Look, atmosphereLook,
  moonInSky, paintGroundSteps, waterCovered, type Ring, Planting, runSliced, facadeSteps, plinthSteps, sharedContextTexturesSliced, paletteFor, patchMaterial, patchSky, precipField, rng, shared, Tod, Weather, WEATHER_ORDER, WEATHER_LABEL, WEATHER_ICON, hourNow, hourForTod, sunAt, phaseLabel, formatHour,
} from "./complexScene";
import { paintStats, paintTextures, plinthTone, prefetchPaint } from "./paintClient";
import "../desk2/realestate-hologram.css";
import type { ComplexRenderer, Quality } from "./tidewater/ComplexRenderer";
import { facadeRelief } from "./tidewater/facadeRelief";
import { loadBuildings, saveBuildings } from "./buildingStore";
import { buildPlants, preloadPlants } from "./scenePlants";
import { buildLamps, buildTraffic, stitchedRoads } from "./sceneStreet";
import { FLAT, loadTerrain, preconnectTerrain, Terrain } from "./sceneTerrain";
import { buildSidewalks, carriageway, ringIndex, sidewalkRuns, streetTrees } from "./sceneSidewalk";
import { buildWalkers, cutPaths, ringPaths, sidewalkPaths, WalkPath } from "./sceneWalkers";
import { buildWater } from "./sceneWater";
import { buildBoats, noBoatsReason } from "./sceneBoats";
import { buildKids } from "./sceneKids";
import { buildBalloon, type Balloon } from "./sceneBalloon";
import { disposeControls, releaseRenderer } from "../threeCleanup";

/* 부동산 맵 — one complex in natural light. Footprints, heights and the parcel are the
 * real ones (backend app/services/realestate_buildings.py: 국토부 GIS건물통합정보 via
 * VWorld, else OpenStreetMap), standing on the real relief (sceneTerrain.ts: SRTM with
 * roofs filtered out); every registered neighbour within the radius is drawn. Facade
 * paint and glazing are drawn (complexScene.ts); on the surveyed roads come sidewalks,
 * street trees, lamps, traffic and people (sceneSidewalk / sceneStreet / sceneWalkers).
 * Blue sky with clouds, haze, damp ground reflecting on level sites, day / dusk / night.
 *
 * Draw calls: every tower of a complex shares one mesh per material (the merged
 * geometry is what renders); the per-building meshes are kept only for picking. */

function shapeOf(b: RealEstateBuilding): THREE.Shape {
  const [outer, ...holes] = b.rings;
  const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
  holes.forEach(h => shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y)))));
  return shape;
}

/** How far a building is sunk below its lowest ground point: on a slope no side shows a gap. */
const SINK = 3;

/** A footprint extruded from its ground (`ground`, the terrain under it) to its
 * registered height above that ground. Wall uv.y counts storeys from the ground, fitted
 * to the registered floor count at `floorM` per drawn storey. */
function extrude(b: RealEstateBuilding, ground = 0, floorM = FLOOR_M): THREE.ExtrudeGeometry {
  const depth = Math.max(2, b.height - b.base);
  const below = b.base > 0 ? 0 : SINK;
  const geo = new THREE.ExtrudeGeometry(shapeOf(b), { depth: depth + below, bevelEnabled: false, steps: 1 });
  geo.translate(0, 0, ground + b.base - below);
  const uv = geo.getAttribute('uv'), pos = geo.getAttribute('position');
  const k = THREE.MathUtils.clamp(floorM / (depth / Math.max(1, b.floors)), 0.5, 2);
  for (const group of geo.groups) if (group.materialIndex === 1) {
    for (let i = group.start; i < group.start + group.count; i++) uv.setY(i, (1 - (pos.getZ(i) - ground)) * k);
  }
  return geo;
}

/** The ground as one grid over ±G: fine (≈T/100) inside the surveyed square ±T, growing
 * outward to the horizon; heights from the terrain, uv spanning the painted square. */
async function groundGeometry(T: number, G: number, terrain: Terrain, segs: number, pace: () => Promise<boolean>) {
  const geo = new THREE.PlaneGeometry(2, 2, segs, segs);
  const p = geo.getAttribute("position") as THREE.BufferAttribute, uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  const a = 0.84;
  const f = (u: number) => { const s = Math.sign(u), v = Math.abs(u); return s * (v <= a ? (v / a) * T : T + (G - T) * ((v - a) / (1 - a)) ** 2); };
  // (a fine grid is 100k terrain lookups: laid a few rows at a time)
  const row = segs + 1;
  for (let i = 0; i < p.count; i++) {
    const x = f(p.getX(i)), y = f(p.getY(i));
    p.setXYZ(i, x, y, terrain.at(x, y));
    uv.setXY(i, (x + T) / (2 * T), (y + T) / (2 * T));
    if (i % row === row - 1 && !await pace()) return null;
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** The faces of a non-indexed geometry's material groups, one geometry per material index. */
function splitGroups(geo: THREE.BufferGeometry): (THREE.BufferGeometry | undefined)[] {
  const ranges: [number, number][][] = [];
  for (const g of geo.groups) (ranges[g.materialIndex ?? 0] ??= []).push([g.start, g.count]);
  return Array.from(ranges, list => {
    if (!list) return undefined;
    const out = new THREE.BufferGeometry();
    const n = list.reduce((sum, [, c]) => sum + c, 0);
    for (const [name, attr] of Object.entries(geo.attributes) as [string, THREE.BufferAttribute][]) {
      const size = attr.itemSize, arr = new Float32Array(n * size);
      let o = 0;
      for (const [start, count] of list) { arr.set((attr.array as Float32Array).subarray(start * size, (start + count) * size), o); o += count * size; }
      out.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    return out;
  });
}

type Stage = {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  controls: OrbitControls; composer: EffectComposer; bloom: UnrealBloomPass; finish: ShaderPass;
  sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; sky: Sky;
  reflector: Reflector | null; reflStrength: { value: number };
  /** Planar reflection only on level ground (the mirror is one plane). */
  reflectOn: boolean;
  refreshEnv: () => void;
  look: Look;
  /** The clock hour on the slider and the weather: rain and snow ease toward want*
   * (0 … 1) over a second or two; env: when to re-render the WebGL reflections. */
  atmos: { hour: number; rain: number; snow: number; wantRain: number; wantSnow: number; dirty: boolean; envAt: number; lat?: number; lon?: number };
  lit: { windows: THREE.MeshStandardMaterial[]; crowns: THREE.MeshStandardMaterial[]; ground: THREE.MeshStandardMaterial[] };
  /** Per-frame work of the current model (traffic), and what follows the look (lamps). */
  tick: ((dt: number) => void)[]; onLook: ((l: Look) => void)[];
  ground: THREE.Mesh | null; model: THREE.Group | null;
  pickables: THREE.Mesh[];
  intro: { from: THREE.Vector3; to: THREE.Vector3; t0: number } | null;
  /** A smooth camera move (buttons, keys, a double-click on a building): camera and
   * orbit target eased from where they were to where they go. */
  fly: { fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t0: number; dur: number } | null;
  now: number; top: number; dist: number; center: THREE.Vector3;
  /** Lowest ground under the complex (the orbit target never goes below it). */
  floor: number;
  /** Near plane when zoomed out (it shrinks as the camera closes in). */
  nearMax: number;
  hq: boolean; disposeModel: () => void; resume: () => void;
  /** A new model is built but has not reached the screen yet. */
  unshown: boolean;
  /** Run once the new model's first frame is on screen (decoration waits for it). */
  onShown: (() => void)[];
  /** Move the live canvases into another stage element (the 크게 보기 layer). */
  attach: (next: HTMLDivElement) => void;
  /** Add decoration; on WebGL its programs compile in parallel before it joins the scene. */
  addWarm: (parent: THREE.Object3D, obj: THREE.Object3D) => void;
  frame: () => void;
  /** A picture of the next frame drawn, for sharing (null: none wanted). */
  snap: ((frame: Blob | null) => void) | null;
  /** The hot-air balloon circling the complex, and the view from its basket while on
   * (yaw/pitch of the look in radians, fov the zoom; baseFov restored on leaving). */
  balloon: Balloon | null;
  balloonView: { yaw: number; pitch: number; fov: number; baseFov: number } | null;
};

const heightLabel = (b: RealEstateBuilding) =>
  `${b.floors}층 · 높이 ${Math.round(b.height)}m${b.height_source === "measured" ? " (실측)" : b.height_source === "floors" ? " (층수 기준)" : " (추정)"}${b.approved ? ` · ${b.approved}년 사용승인` : ""}`;

/** When the register's buildings are likely not yet the complex's current ones:
 * a complex completed after every tower on its parcel was approved is a rebuild the
 * national data hasn't caught up with; a recent or pre-completion complex may be too. */
function staleNotice(data: RealEstateBuildingsResponse, complexId: string): string | null {
  const towers = data.buildings.filter(b => b.floors >= 5);
  const approved = towers.map(b => b.approved).filter((y): y is number => !!y);
  const latest = approved.length ? Math.max(...approved) : null;
  const built = data.built;
  if (built && latest && latest < built - 1)
    return `자료 갱신 전일 수 있음 · ${built}년 준공 단지인데 건물 자료는 ${latest}년 사용승인 건물입니다(재건축 전 모습일 수 있습니다).`;
  if (complexId.includes(":rights:"))
    return "자료 갱신 전일 수 있음 · 분양·입주권 거래 단지로 준공 전이거나 건물 자료에 아직 반영되지 않았을 수 있습니다.";
  if (built && built >= new Date().getFullYear() - 2 && !latest)
    return "자료 갱신 전일 수 있음 · 최근 준공 단지는 국가 건물 자료에 늦게 반영됩니다.";
  return null;
}

const buildingCache = new Map<string, { at: number; data: RealEstateBuildingsResponse }>();

/** Loads started before the view mounts (the map page knows the complex it will show
 * while the view's code is still arriving): the server's kept shapes, and the relief
 * under them (terrainFor caches its tiles). Taken, once, by the view. */
const prefetched = new Map<string, Promise<RealEstateBuildingsResponse>>();
export function prefetchComplex(id: string): void {
  if (prefetched.has(id) || buildingCache.has(id)) return;
  const peek = api.realEstateBuildings(id, undefined, true);
  prefetched.set(id, peek);
  peek.then(res => { if (res.found) void terrainFor(res); }).catch(() => { prefetched.delete(id); });
  if (prefetched.size > 4) prefetched.delete(prefetched.keys().next().value!);
}

/** The WebGPU device, made ahead of the first view (adapter and device requests take a
 * few hundred ms); only where the view would use WebGPU. */
export function warmGpu(): void {
  const gpu = (navigator as Navigator & { gpu?: { wgslLanguageFeatures?: { has(name: string): boolean } } }).gpu;
  if (!gpu?.wgslLanguageFeatures?.has?.("pointer_composite_access") || new URLSearchParams(location.search).get("renderer") === "webgl") return;
  void import("./tidewater/ComplexRenderer").then(m => m.warmDevice()).catch(() => {});
}

/** The real relief under a result, in at most 2.5 s (tiles are cached after the first
 * complex); level ground when it can't be had. Covers the painted ground square. */
async function terrainFor(res: RealEstateBuildingsResponse): Promise<Terrain> {
  if (!res.center) return FLAT;
  const ext = res.buildings.flatMap(b => b.rings[0]).reduce((m, [x, y]) => Math.max(m, Math.hypot(x, y)), 0);
  const radius = Math.min(1400, (ext + 300) * 1.3 + 80);
  return Promise.race([
    loadTerrain(res.center, radius, res.vworld_key).catch(() => FLAT),
    new Promise<Terrain>(r => window.setTimeout(() => r(FLAT), 2500)),
  ]);
}

const WHEEL_ZOOM = 4.8;

/** Yield the main thread: the next task, or (when the view is covered) the next idle
 * period, so input and scrolling elsewhere on the page come first. */
function nextSlice(idle: boolean): Promise<void> {
  return new Promise(resolve => {
    if (idle && typeof window.requestIdleCallback === "function") { window.requestIdleCallback(() => resolve(), { timeout: 1500 }); return; }
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); ch.port2.close(); resolve(); };
    ch.port2.postMessage(0);
  });
}

/** Like nextSlice, but past the next frame: the browser hands a canvas's recorded drawing
 * to the GPU at the end of a frame, so painting a big canvas in frame-sized pieces gives
 * the GPU its work in pieces too (one 2048 px ground was a single ~170 ms GPU task, and the
 * pointer and the whole page's drawing waited behind it). A hidden page has no frames. */
function nextFrame(idle: boolean): Promise<void> {
  if (idle || document.hidden) return nextSlice(idle);
  return new Promise(resolve => {
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(() => void nextSlice(false).then(go));
    window.setTimeout(go, 150);
  });
}

/** The time slider's track: the sky's colour at each hour of today (night, dawn,
 * day, dusk), so the track itself shows where the light is. */
function dayGradient(lat?: number, lon?: number): string {
  const stops: string[] = [];
  for (let h = 0; h <= 24; h += 0.5) {
    const e = sunAt(h, undefined, lat, lon).elev;
    const c = e < -10 ? "#1a2238" : e < -3 ? "#3b3f6e" : e < 3 ? "#d9855a" : e < 12 ? "#f2c07a" : "#8cc8ee";
    stops.push(`${c} ${(h / 24 * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

const ease = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

/** Stands in for the WebGL renderer where the browser gives no WebGL context: the view
 * draws with WebGPU, and this only carries the input canvas and the settings the
 * WebGL-only code writes (it is never asked to draw). */
function inputOnlyRenderer(): THREE.WebGLRenderer {
  const canvas = document.createElement("canvas");
  let ratio = 1, target: THREE.WebGLRenderTarget | null = null;
  return {
    domElement: canvas, shadowMap: { enabled: false, type: THREE.PCFShadowMap }, info: { render: { calls: 0 } },
    outputColorSpace: THREE.SRGBColorSpace, toneMapping: THREE.NoToneMapping, toneMappingExposure: 1,
    setPixelRatio(v: number) { ratio = v; }, getPixelRatio: () => ratio,
    getSize: (t: THREE.Vector2) => t.set(canvas.width, canvas.height), setSize() {},
    getRenderTarget: () => target, setRenderTarget(t: THREE.WebGLRenderTarget | null) { target = t; },
    compileAsync: () => Promise.resolve(), dispose() {},
  } as unknown as THREE.WebGLRenderer;
}

export default function ComplexHologram({ complexId, complexName, caption, wide = false, initialTod, paused = false, openFull = 0, onFullChange }: {
  complexId: string | null; complexName?: string; caption?: string;
  /** Each increase opens this view full screen (the map's detail card on a desktop
   * shows its complex here rather than in a second renderer). */
  openFull?: number;
  onFullChange?: (open: boolean) => void;
  /** Covered by something the reader is using (the detail popup): stop drawing, and do
   * any loading only in the browser's idle time. */
  paused?: boolean;
  /** Already the full-screen layer: no "전체화면" button of its own. */
  wide?: boolean; initialTod?: Tod;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const hourRef = useRef(0);
  /** Build the current model again (its textures painted afresh). */
  const rebuildRef = useRef<(() => void) | null>(null);
  const weatherRef = useRef<Weather>("clear");
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [data, setData] = useState<RealEstateBuildingsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [slowData, setSlowData] = useState(false);
  // Waiting on the building shapes: which attempt (a stalled request is retried), and a
  // manual retry after the last one fails.
  const [dataTry, setDataTry] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  // Controls follow the pointer in use: a touch laptop starts with the mouse set (its
  // primary pointer is fine) and switches when the screen is actually touched.
  const [touchMode, setTouchMode] = useState(() => !!window.matchMedia?.("(pointer: coarse)").matches
    || (navigator.maxTouchPoints > 0 && !!window.matchMedia?.("(hover: none)").matches));
  // Auto-rotation on from the first load (a press on the view or its buttons stops it).
  const [spin, setSpin] = useState(true);
  // The hour on the time slider (?hour= or ?tod= to open elsewhere), and the weather.
  const [hour, setHour] = useState<number>(() => {
    const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
    const h = Number(q?.get("hour"));
    const t = q?.get("tod");
    if (initialTod) return hourForTod(initialTod);
    if (q?.has("hour") && Number.isFinite(h)) return ((h % 24) + 24) % 24;
    return t === "day" || t === "dusk" || t === "night" ? hourForTod(t) : Math.round(hourNow() * 4) / 4;
  });
  const [weather, setWeather] = useState<Weather>(() => {
    const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("weather") : null;
    return q === "rain" || q === "snow" ? q : "clear";
  });
  hourRef.current = hour;
  weatherRef.current = weather;
  // 전체화면: the panel fills the window, as the card's 3D 건물뷰 does on a phone. The
  // rail keeps a slot of the panel's height so the page underneath does not jump.
  const [bigBase, setBigBase] = useState<{ w: number; h: number } | null>(null);
  const [bigSize, setBigSize] = useState<{ w: number; h: number } | null>(null);
  const resizeDrag = useRef<{ id: number; x: number; y: number; w: number; h: number } | null>(null);
  const fitBigSize = (w: number, h: number) => ({
    w: Math.round(Math.min(window.innerWidth, Math.max(760, w))),
    h: Math.round(Math.min(window.innerHeight, Math.max(480, h))),
  });
  const big = !!bigBase;
  const openBig = () => {
    const r = sectionRef.current?.getBoundingClientRect();
    if (r?.width && r.height) {
      setBigSize(null);
      setBigBase({ w: r.width, h: r.height });
    }
  };
  const closeBig = useCallback(() => {
    resizeDrag.current = null;
    setBigSize(null);
    setBigBase(null);
  }, []);
  // 카카오톡 공유, as the map pages share: a picture of this view and a link that opens it
  // full screen at this hour and weather (share3d.ts).
  const [shareStage, setShareStage] = useState<ShareStage>("idle");
  const [sharing, setSharing] = useState(false);
  const shareUrl = useRef("");
  const onShare = async () => {
    if (!complexId || sharing) return;
    const name = data?.name ?? complexName ?? "단지";
    shareUrl.current = view3dUrl(complexId, hour, weather);
    setShareStage(await shareLink3d({ url: shareUrl.current, title: `${name} 3D 단지뷰`, text: `${name} 3D 단지뷰 · ${phaseCaption()}` }));
  };
  // 이미지 저장: the next frame drawn, with its caption band.
  const onSaveImage = async () => {
    const st = stageRef.current;
    if (!st || sharing) return;
    setSharing(true);
    try {
      const name = data?.name ?? complexName ?? "단지";
      const frame = await new Promise<Blob | null>(resolve => {
        const timer = window.setTimeout(() => { if (st.snap) { st.snap = null; resolve(null); } }, 1500);
        st.snap = b => { window.clearTimeout(timer); resolve(b); };
        st.resume();
      });
      const image = frame ? await captionedShot(frame, name, phaseCaption()) : null;
      if (image) await saveImage3d(image, name);
    } finally { setSharing(false); }
  };
  const [tip, setTip] = useState<{ x: number; y: number; text: string; pinned: boolean; w: number } | null>(null);
  const [failed3d, setFailed3d] = useState(false);
  // WebGPU-capable browsers start without a WebGL renderer at all (a WebGL context costs
  // ~250 ms of the main thread at start and a share of the GPU): the view is built again in
  // "webgl" mode only if WebGPU fails.
  const [renderMode, setRenderMode] = useState<"auto" | "webgl">("auto");
  const [terrainSource, setTerrainSource] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  // Button set follows the page layout (the desktop rail from 981 px, as the map page
  // decides), not the pointer: an iPad in the desktop layout gets the desktop controls.
  const narrow = useMediaQuery("(max-width: 980px)");

  useEffect(() => {
    if (!big || narrow) { resizeDrag.current = null; return; }
    const fit = () => setBigSize(size => size ? fitBigSize(size.w, size.h) : null);
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [big, narrow]);

  // One renderer for the panel's lifetime; each complex only swaps the model.
  useEffect(() => {
    if (!hostRef.current) return;
    let host: HTMLDivElement = hostRef.current;
    // Phones and small tablets: no planar reflection or AO, fewer trees, lighter shadows.
    const hq = !window.matchMedia?.("(pointer: coarse)").matches && Math.min(screen.width, screen.height) >= 700;
    // The native WebGPU path only on implementations as current as the one it is
    // tested on (pointer_composite_access is a good marker: older Tint builds compile
    // the shaders but may draw nothing); everything else, and ?renderer=webgl, uses WebGL.
    const gpu = (navigator as Navigator & { gpu?: { wgslLanguageFeatures?: { has(name: string): boolean } } }).gpu;
    const forceWebgl = renderMode === "webgl" || new URLSearchParams(location.search).get("renderer") === "webgl";
    const nativeCapable = !forceWebgl && !!gpu && !!gpu.wgslLanguageFeatures?.has?.("pointer_composite_access");
    // WebGL with whichever GPU the browser will give (a blocklisted discrete GPU on a
    // laptop can still leave the integrated one). Where WebGPU will draw, none is made: a
    // stand-in carries the input, and WebGL is set up (renderMode "webgl") only if WebGPU
    // fails.
    let made: THREE.WebGLRenderer | null = null;
    if (!nativeCapable) for (const powerPreference of ["high-performance", "default", "low-power"] as const) {
      try { made = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference }); break; } catch { /* next */ }
    }
    const glMissing = !made;
    if (glMissing && !nativeCapable) { setFailed3d(true); return; }
    const renderer = made ?? inputOnlyRenderer();
    // Start at the display's ratio; with frame time to spare, supersample a desktop
    // panel toward 2x (sharper facades; the native path has no MSAA). Never climb
    // back past a level that already dropped frames.
    const dpr = window.devicePixelRatio || 1;
    let ratio = Math.min(dpr, hq ? 2 : 1.6);
    let maxRatio = hq ? Math.min(2, Math.max(dpr, 1.5)) : ratio;
    // The last pointer, wheel or key on the view (the loop draws at full rate for 3 s after).
    let lastInput = performance.now();
    const touched = () => { lastInput = performance.now(); };
    renderer.setPixelRatio(ratio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(renderer.domElement);
    let native: ComplexRenderer | null = null;
    let disposed = false;
    let nativePending = nativeCapable || glMissing;
    let wasPreparing = nativePending;
    setPreparing(nativePending);
    // Do not compile both renderers on first load: warm native pipelines behind
    // the loading state, and initialize WebGL lighting only if native fails.
    // Native quality from the device: phones and small-memory devices start low (no
    // screen-space reflection, half the shadow resolution), tablets medium; the loop
    // below steps down further while frames stay slow at the lowest resolution.
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const coarse = !!window.matchMedia?.("(pointer: coarse)").matches;
    const tier: Quality["name"] = (coarse && Math.min(screen.width, screen.height) < 700) || mem <= 3 ? "low" : !hq || mem <= 4 || navigator.hardwareConcurrency <= 4 ? "medium" : "high";
    let qualities: Record<Quality["name"], Quality> | null = null;
    if (nativePending) {
      import("./tidewater/ComplexRenderer").then(m => { qualities = m.QUALITY; return m.ComplexRenderer.create(host, m.QUALITY[tier]); }).then(view => {
        if (disposed) { view.dispose(); return; }
        if (view.canvas.parentElement !== host) host.appendChild(view.canvas);
        native = view;
        if (import.meta.env.DEV) Object.assign(window, { __holoNative: view, __holoGL: renderer, __holoStageAny: stageRef });
        nativePending = false;
        resize();
      }).catch(err => {
        if (disposed) return;
        nativePending = false;
        if (glMissing) { console.info("[3D] WebGPU failed, using WebGL:", err); setRenderMode("webgl"); return; }
        refreshEnv();
        resize();
        console.info("[3D] Using WebGL compatibility renderer:", err);
      });
    }

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2("#b9cadb", 0.001);
    const camera = new THREE.PerspectiveCamera(36, 1, 1, 8000);
    camera.position.set(260, 160, 260);
    // Every listener this view puts on its canvas goes when it closes: the canvas stays
    // reachable from materials shared between views (three's dispose listeners), and
    // through these closures it would keep the closed view's scene alive.
    const listening = new AbortController();
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.rotateSpeed = 0.65;
    controls.panSpeed = 0.85;
    // A wheel notch moves ~22 % of the distance (0.95^4.8): overview to a person on the
    // sidewalk in about twenty notches. Pinch uses zoomSpeed as an exponent, so touch
    // keeps a gentle 1 (set per input below).
    controls.zoomSpeed = WHEEL_ZOOM;
    renderer.domElement.addEventListener("wheel", () => { controls.zoomSpeed = WHEEL_ZOOM; }, { capture: true, passive: true, signal: listening.signal });
    renderer.domElement.addEventListener("pointerdown", e => { controls.zoomSpeed = e.pointerType === "touch" ? 1 : WHEEL_ZOOM; }, { capture: true, signal: listening.signal });
    // The usual 3D-viewer gestures, no mode button: one finger turns, two fingers move
    // and pinch together; a mouse turns with the left button and moves with the right.
    controls.touches.ONE = THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    // Pinch zooms toward the point between the two fingers. OrbitControls takes that
    // midpoint in page coordinates (scroll included) but maps it with the element's
    // viewport rectangle, so on a scrolled page the zoom went toward a point off by the
    // scroll: convert to viewport coordinates for that one call.
    {
      type ZoomInternals = { _updateZoomParameters(x: number, y: number): void; _handleTouchMoveDolly(e: PointerEvent): void };
      const c = controls as unknown as ZoomInternals;
      const dolly = c._handleTouchMoveDolly, update = c._updateZoomParameters;
      c._handleTouchMoveDolly = function (this: ZoomInternals, e: PointerEvent) {
        this._updateZoomParameters = (x, y) => update.call(this, x - window.scrollX, y - window.scrollY);
        try { dolly.call(this, e); } finally { this._updateZoomParameters = update; }
      };
    }
    controls.autoRotate = spinRef.current;
    controls.autoRotateSpeed = 0.55;
    controls.minPolarAngle = 0.12;
    controls.maxPolarAngle = Math.PI / 2 - 0.035;
    // Zoom toward whatever is under the cursor (or between the pinching fingers),
    // anywhere in view, down to a person on the sidewalk; pan freely.
    controls.zoomToCursor = true;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    // Zoom and pan scale with the distance to the orbit target, and zooming to the cursor
    // re-places the target that far in front of the camera. After some panning and
    // turning that distance no longer matches what is on screen: shrunk to the minimum
    // in mid-air, zoom stops and panning crawls; too short, each wheel notch moves only
    // centimetres. So every gesture starts from the surface actually at the centre of
    // the view (a building or the ground), moving the target only along the line of
    // sight: the picture does not jump.
    const aim = new THREE.Raycaster(), ahead = new THREE.Vector3();
    const reanchor = () => {
      const st = stageRef.current;
      if (!st) return;
      camera.getWorldDirection(ahead);
      aim.set(camera.position, ahead);
      aim.far = st.dist * 8;
      let d = aim.intersectObjects(st.pickables, false)[0]?.distance ?? Infinity;
      if (ahead.y < -1e-3) { const g = (st.floor - camera.position.y) / ahead.y; if (g > 0) d = Math.min(d, g); }
      const r = camera.position.distanceTo(controls.target);
      // Looking at the sky: keep a sensible radius rather than the collapsed one.
      const next = Number.isFinite(d) ? d : Math.max(r, st.dist * 0.4);
      if (Math.abs(next - r) < r * 0.02) return;
      controls.target.copy(camera.position).addScaledVector(ahead, Math.max(next, controls.minDistance * 1.5));
    };
    controls.addEventListener("start", reanchor);
    // While zooming, the target follows the cursor; the scene bounds below apply to
    // panning only (pulling the camera back mid-zoom cancelled the zoom).
    // (through the damped frames after it; then the target returns to the surface on
    // the line of sight, which keeps the picture still and the target within bounds)
    let zooming = false, zoomEnd = 0;
    const zoomNow = () => {
      zooming = true;
      clearTimeout(zoomEnd);
      zoomEnd = window.setTimeout(() => { zooming = false; reanchor(); }, 300);
    };
    renderer.domElement.addEventListener("wheel", zoomNow, { capture: true, passive: true, signal: listening.signal });
    const touches = new Set<number>();
    renderer.domElement.addEventListener("pointerdown", e => { if (e.pointerType === "touch") touches.add(e.pointerId); }, { capture: true, signal: listening.signal });
    renderer.domElement.addEventListener("pointermove", e => { if (touches.size > 1 && touches.has(e.pointerId)) zoomNow(); }, { capture: true, signal: listening.signal });
    for (const type of ["pointerup", "pointercancel"] as const) renderer.domElement.addEventListener(type, e => { touches.delete(e.pointerId); }, { capture: true, signal: listening.signal });
    controls.addEventListener("change", () => {
      const t = controls.target, st = stageRef.current;
      if (!st || zooming) return;
      const before = t.clone();
      t.y = Math.min(Math.max(t.y, st.floor), Math.max(st.top, st.dist * 0.5));
      const dx = t.x - st.center.x, dz = t.z - st.center.z, r = Math.hypot(dx, dz), limit = st.dist * 2.5;
      if (r > limit) { t.x = st.center.x + dx / r * limit; t.z = st.center.z + dz / r * limit; }
      // Keep the viewing direction stable when a pan reaches the scene boundary.
      camera.position.add(t.clone().sub(before));
    });

    const sky = new Sky();
    sky.scale.setScalar(40000);
    patchSky(sky.material, (scene.fog as THREE.FogExp2).color);
    scene.add(sky);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(sky.geometry, sky.material));
    const pmrem = new THREE.PMREMGenerator(renderer);
    let envRT: THREE.WebGLRenderTarget | null = null;
    const refreshEnv = () => {
      if (native || nativePending) return;
      const next = pmrem.fromScene(envScene, 0, 0.1, 1000);
      scene.environment = next.texture;
      envRT?.dispose();
      envRT = next;
    };
    preconnectTerrain();
    // The neighbourhood's shared materials start compiling now, behind the data fetch.
    const warm = new THREE.Group();
    scene.add(warm);
    // (WebGL: each warmed style joins the scene once its programs are linked.)
    const warmAdd = warm.add.bind(warm);
    warm.add = (...objs: THREE.Object3D[]) => {
      for (const o of objs) { if (native || nativePending) warmAdd(o); else void glCompile(o).then(() => warmAdd(o)); }
      return warm;
    };
    void warmMaterials(warm, () => nextSlice(true), () => !disposed);
    const moon = moonInSky();
    const precip = precipField();
    scene.add(precip.group);
    scene.add(moon.group);
    const balloon = buildBalloon();
    balloon.group.visible = false;   // until a complex gives it a route
    scene.add(balloon.group);

    const hemi = new THREE.HemisphereLight("#c4dcf6", "#6f6552", 0.45);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight("#fff3e0", 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(hq ? 4096 : 2048, hq ? 4096 : 2048);
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.5;
    sun.shadow.radius = 3;
    scene.add(sun, sun.target);

    // Rain-damp ground mirrors the towers: a planar reflection sampled by the ground shader.
    const reflStrength = { value: 0.85 };
    const reflector = hq ? new Reflector(new THREE.PlaneGeometry(1, 1), { clipBias: 0.002, textureWidth: 512, textureHeight: 512, multisample: 0 }) : null;
    if (reflector) { reflector.rotation.x = -Math.PI / 2; reflector.updateMatrixWorld(); }

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    /** WebGL programs for `obj` (with this scene's lights and fog), linked in parallel
     * (KHR_parallel_shader_compile) instead of stalling its first draw in turn. Compiled
     * as the composer draws them: into its HDR target (linear, no tone mapping). */
    const glCompile = (obj: THREE.Object3D) => {
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      const done = renderer.compileAsync(obj, camera, scene).catch(() => {});
      renderer.setRenderTarget(prev);
      return done;
    };
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    const gtao = hq ? new GTAOPass(scene, camera, 1, 1) : null;
    if (gtao) {
      gtao.updateGtaoMaterial({ radius: 5, distanceExponent: 1.5, thickness: 6, scale: 1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      gtao.blendIntensity = 0.75;
      composer.addPass(gtao);
    }
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.2, 0.55, 1.15);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    const finish = new ShaderPass(FinishShader);
    composer.addPass(finish);

    const stage: Stage = {
      renderer, scene, camera, controls, composer, bloom, finish, sun, hemi, sky, reflector, reflStrength, reflectOn: false, refreshEnv,
      look: atmosphereLook(hourRef.current, 0, 0),
      atmos: { hour: hourRef.current, rain: +(weatherRef.current === "rain"), snow: +(weatherRef.current === "snow"),
        wantRain: +(weatherRef.current === "rain"), wantSnow: +(weatherRef.current === "snow"), dirty: true, envAt: 0 },
      lit: { windows: [], crowns: [], ground: [] }, tick: [], onLook: [],
      ground: null, model: null, pickables: [], intro: null, fly: null,
      now: 0, top: 50, dist: 300, center: new THREE.Vector3(), floor: 0, nearMax: 0.5, hq, disposeModel: () => {}, resume: () => {}, unshown: false, onShown: [], attach: () => {}, frame: () => {}, snap: null, balloon: null, balloonView: null,
      addWarm: (parent, obj) => { if (native || nativePending) parent.add(obj); else void glCompile(obj).then(() => parent.add(obj)); },
    };
    stageRef.current = stage;
    stage.balloon = balloon;
    // Dev only: lets the render checks place the camera (never in a production build).
    if (import.meta.env.DEV) (window as unknown as { __complexStage?: Stage }).__complexStage = stage;

    let W = 1, H = 1;
    const resize = () => {
      W = host.clientWidth; H = host.clientHeight;
      if (!W || !H) return;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      native?.setSize(W, H, ratio);
      // The WebGL buffers (MSAA HDR target, AO, bloom, reflection) only while WebGL draws:
      // reallocating them on every native resolution step cost frames for nothing.
      if (native || nativePending) return;
      renderer.setPixelRatio(ratio);
      renderer.setSize(W, H, false);
      composer.setPixelRatio(ratio);
      composer.setSize(W, H);
      bloom.setSize(W * ratio / 2, H * ratio / 2);
      reflector?.getRenderTarget().setSize(Math.round(W * ratio * 0.5), Math.round(H * ratio * 0.5));
      finish.uniforms.uAspect.value = W / H;
    };
    // (a new canvas size clears it: drawn again at once, before the page paints, not a blank
    // frame first — the loop may be skipping this frame at the idle rate)
    const ro = new ResizeObserver(() => { const w = W, h = H; resize(); if ((W !== w || H !== h) && raf) stage.resume(); });
    ro.observe(host);
    resize();

    // Exploring a building is deliberate: never restart rotation behind the user.
    const onStart = () => {
      controls.autoRotate = false; spinRef.current = false; setSpin(false);
      stage.intro = null; stage.fly = null; setTip(null);
    };
    controls.addEventListener("start", onStart);
    // (a drag's start and end, not "change": auto-rotation fires that every frame)
    controls.addEventListener("start", touched);
    controls.addEventListener("end", touched);
    for (const type of ["pointerdown", "pointermove", "wheel", "keydown"] as const) renderer.domElement.addEventListener(type, touched, { passive: true, signal: listening.signal });

    const keyDir = new THREE.Vector3(), sunDir = new THREE.Vector3();
    const bvAt = new THREE.Vector3(), bvLook = new THREE.Vector3();
    let envFrame = 0, nativeWaitSince = 0;
    let glCompiled: THREE.Object3D | null = null, glCompiling = false;
    // Dynamic quality and resolution with hysteresis: at least 40 fps, never below 0.6x.
    let slow = 0, quick = 0, gpuHot = 0, last = performance.now(), settleUntil = 0, calibrated = false;
    const calDt: number[] = [];
    let inView = true, sampleStart = last, sampleFrames = 0;
    const t0 = performance.now();
    let raf = 0;
    // Off screen the loop sleeps, except while shaders and a new model are still being
    // prepared: that work then finishes before the panel scrolls into view.
    // (A model still being built in slices isn't in the scene yet: nothing to warm.)
    const warming = () => (stage.unshown && !!stage.model) || nativePending || (!!native && !native.ready);
    // Left alone (no pointer, wheel or key on the view for 3 s, nothing in motion but
    // the scene's own life), the view draws every other display frame: the same
    // pictures at 30 fps, half the GPU and main-thread time for the rest of the page.
    let idleSkip = false;
    // The slowest submit (CPU, ms) since the last sample: dataset.renderMaxMs.
    let renderMax = 0;
    // (a model still loading, behind its scan overlay, renders at the idle rate: those
    // frames only prepare its pipelines, and at full rate they held the GPU — and with it
    // the pointer and the page — through every load)
    const busy = () => performance.now() - lastInput < 3000 || !!stage.balloonView || !!stage.fly || !!stage.intro || stage.atmos.dirty || stage.atmos.rain !== stage.atmos.wantRain
      || stage.atmos.snow !== stage.atmos.wantSnow || !!stage.snap;
    const loop = () => {
      if (document.hidden || ((!inView || pausedRef.current) && !warming())) return;
      raf = requestAnimationFrame(loop);
      const idle = !busy();
      if (idle) { idleSkip = !idleSkip; if (idleSkip) return; } else idleSkip = false;
      const nowMs = performance.now();
      const dt = nowMs - last;
      last = nowMs;
      // Floor: 40 fps. A frame over 25 ms missed it; misses accumulate and on-time frames
      // drain them slowly, so a steady ~35 fps also counts as slow within seconds. Not
      // judged while a model is still being decorated (one-off building work).
      // (not while idle: every other frame is skipped on purpose, 33 ms is not slow)
      const judge = !idle && !stage.unshown && nowMs > settleUntil && dt < 250;
      // (weighted by how late: on a very slow device each frame counts several times)
      if (judge && dt > 25.5) { slow += Math.min(10, dt / 25); quick = 0; }
      else if (judge) { slow = Math.max(0, slow - 0.2); if (dt < 20) quick++; else quick = 0; }
      // Resolution is kept longest: the native view first drops quality steps
      // (screen-space reflections, clouds in them, shadow resolution), then resolution
      // (down to 0.6x). Resolution climbs back only with 50 fps to spare.
      // Once, shortly after the first model settles: the GPU time measured on this device
      // (timestamp queries) sets quality and resolution at once, instead of stepping
      // down over many slow seconds. Frame timing keeps adjusting from there.
      // Without timestamps: the median frame interval over the first second.
      if (native?.shown && !calibrated && !idle && !stage.unshown && nowMs > settleUntil && dt < 2000) calDt.push(dt);
      if (native?.shown && !calibrated && (native.timer.samples > 30 || (!native.timer.enabled && calDt.length >= 5 && nowMs - settleUntil > 1000))) {
        calibrated = true;
        const g = native.timer.enabled ? native.timer.ms.total ?? 0 : calDt.sort((a, b) => a - b)[calDt.length >> 1] * 0.85;
        if (g > 16 && qualities && native.quality.name !== "low") native.setQuality(g > 30 || native.quality.name === "medium" ? qualities.low : qualities.medium);
        if (g > 24) { ratio = Math.max(0.6, Math.round(ratio * Math.sqrt(20 / g) * 20) / 20); maxRatio = ratio; resize(); }
        slow = 0;
      }
      if (slow > 30 && native?.shown && qualities && native.quality.name !== "low") {
        native.setQuality(native.quality.name === "high" ? qualities.medium : qualities.low);
        slow = 0;
      } else if (slow > 30 && ratio > 0.6) { ratio = Math.max(0.6, ratio - 0.25); maxRatio = ratio; slow = 0; resize(); }
      // Resolution up only with GPU time to spare. The frame interval can't tell: vsync
      // holds it at 16.7 ms however full the GPU is, and a GPU run to 100 % starves the
      // browser (the pointer and the rest of the page stutter). With timestamps: climb
      // under 7 ms of GPU work a frame, step down over 12 ms; without, never past the
      // display's own ratio.
      // (changes judged over seconds, not a moment: each reallocates the render targets,
      // a visible hitch, and a view moving about — the balloon — varies from frame to frame)
      else if (native?.timer.enabled && (native.timer.ms.total ?? 0) > 12 && ratio > Math.min(1, dpr) && judge && ++gpuHot > 180) {
        ratio = Math.max(Math.min(1, dpr), ratio - 0.25); maxRatio = ratio; gpuHot = 0; resize();
      }
      else if (quick > 600 && ratio < maxRatio && (native?.timer.enabled ? (native.timer.ms.total ?? 99) < 7 : ratio + 0.25 <= dpr)) { ratio = Math.min(maxRatio, ratio + 0.25); quick = 0; resize(); }

      const t = (nowMs - t0) / 1000;
      stage.now = t;
      shared.uTime.value = t;
      sky.material.uniforms.time.value = t;
      if (stage.fly) {
        // (orbit target and camera together: the view glides, the shot stays composed)
        const f = stage.fly, k = ease((t - f.t0) / f.dur);
        controls.target.lerpVectors(f.fromTarget, f.toTarget, k);
        camera.position.lerpVectors(f.fromPos, f.toPos, k);
        if (k >= 1) stage.fly = null;
      }
      if (stage.intro) {
        const k = ease((t - stage.intro.t0) / 3.2);
        camera.position.lerpVectors(stage.intro.from, stage.intro.to, k);
        if (k >= 1) stage.intro = null;
      }
      {
        // The slider moves the sun at once; the weather sets in over about 1.6 s.
        const a = stage.atmos, step = Math.min(dt, 100) / 1600;
        const toward = (x: number, y: number) => x + THREE.MathUtils.clamp(y - x, -step, step);
        const moving = a.rain !== a.wantRain || a.snow !== a.wantSnow;
        if (moving) { a.rain = toward(a.rain, a.wantRain); a.snow = toward(a.snow, a.wantSnow); }
        if (moving || a.dirty) {
          const smooth = (x: number) => x * x * (3 - 2 * x);
          const settled = a.rain === a.wantRain && a.snow === a.wantSnow;
          applyLook(atmosphereLook(a.hour, smooth(a.rain), smooth(a.snow), undefined, a.lat, a.lon), false);
          // Reflections (WebGL): now and then while the weather changes, and once the
          // slider rests.
          if (moving && (settled || ++envFrame % 8 === 0)) refreshEnv();
          else if (a.dirty) a.envAt = t + 0.25;
          a.dirty = false;
        }
        if (a.envAt && t >= a.envAt) { a.envAt = 0; refreshEnv(); }
      }
      for (const f of stage.tick) f(dt / 1000);
      if (balloon.group.visible) balloon.update(dt / 1000);
      const bv = stage.balloonView;
      if (bv) {
        // Standing at the basket's rim on the side the look faces, leaning out a little:
        // the rim along the bottom of the view, the complex below, the envelope overhead.
        balloon.basket(bvAt);
        const fx = Math.cos(bv.yaw), fz = Math.sin(bv.yaw);
        camera.position.set(bvAt.x + fx * 1.02, bvAt.y + 1.62, bvAt.z + fz * 1.02);
        bvLook.set(fx * Math.cos(bv.pitch), Math.sin(bv.pitch), fz * Math.cos(bv.pitch)).add(camera.position);
        camera.lookAt(bvLook);
        if (camera.fov !== bv.fov || camera.near !== 0.08) { camera.fov = bv.fov; camera.near = 0.08; camera.updateProjectionMatrix(); }
      } else {
        controls.update();
        // Near plane follows the zoom: close enough to stand beside a person, and no
        // deeper than needed from afar (depth precision on distant roofs).
        const near = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * 0.04, 0.05, stage.nearMax);
        if (Math.abs(near - camera.near) > camera.near * 0.15) { camera.near = near; camera.updateProjectionMatrix(); }
      }
      // The camera's world matrices, every frame: three only refreshes them while it
      // draws, and on the WebGPU path it doesn't, so view-dependent work (which people
      // to draw, and how) would go on judging from a stale camera.
      camera.updateMatrixWorld();
      moon.update(camera);
      precip.update(camera, t, host.clientHeight);


      if (native) {
        try {
          const r0 = performance.now();
          native.render(scene, camera, stage.look, t);
          renderMax = Math.max(renderMax, performance.now() - r0);
        }
        catch (err) { console.warn("[3D] WebGPU fallback:", err); native.failed = true; }
        // Watchdog: a built model that WebGPU hasn't put on screen in 8 s goes to WebGL.
        if (!native.shown && stage.model) {
          nativeWaitSince ||= nowMs;
          // (a slow GPU may take a while to build its pipelines; with no WebGL, keep waiting)
          // (generous: a slow GPU compiling its pipelines is not a failure, and WebGL on top
          // of the WebGPU memory already held is what stalls a weak machine)
          if (nowMs - nativeWaitSince > 40000) { console.info("[3D] WebGPU never showed the scene; using WebGL"); native.failed = true; }
        } else nativeWaitSince = 0;
        if (native.failed) {
          const released = native.released ?? 0;
          native.dispose(); native = null;
          // The view is set up again with WebGL (and its model built again: canvases emptied
          // after upload can't feed it); with no WebGL there either, it says so.
          if (glMissing) { console.info("[3D] WebGPU lost, using WebGL"); setRenderMode("webgl"); return; }
          if (released) rebuildRef.current?.();
          refreshEnv(); resize();
        }
      }
      const isPreparing = nativePending || (!!native && !native.shown);
      if (wasPreparing !== isPreparing) { setPreparing(isPreparing); wasPreparing = isPreparing; }
      host.dataset.renderer = native?.shown ? "tidewater-webgpu" : isPreparing ? "preparing" : "webgl";
      if (++sampleFrames >= 60 || (sampleFrames >= 2 && nowMs - sampleStart > 1000)) {
        host.dataset.fps = (sampleFrames * 1000 / (nowMs - sampleStart)).toFixed(1);
        host.dataset.draws = String(native?.ready ? native.stats.draws : renderer.info.render.calls);
        host.dataset.pixelRatio = ratio.toFixed(2);
        host.dataset.renderMaxMs = renderMax.toFixed(0); renderMax = 0;
        if (native) { host.dataset.quality = native.quality.name; host.dataset.gpuMs = (native.timer.ms.total ?? 0).toFixed(2); }
        sampleFrames = 0; sampleStart = nowMs;
      }
      // WebGL: a new model's programs compile in parallel (KHR_parallel_shader_compile)
      // before it is drawn; a first draw would wait on each link in turn (seconds).
      const gl = !native && !nativePending;
      // (and once at the start: sky, stars, moon)
      const pending = stage.unshown && stage.model ? stage.model : glCompiled ? null : scene;
      if (gl && pending && glCompiled !== pending && !glCompiling) {
        glCompiling = true;
        void glCompile(scene).then(() => { glCompiling = false; glCompiled = pending; });
      }
      const glWait = gl && !!pending && glCompiled !== pending;
      if (gl && !glWait && reflector && stage.ground && stage.reflectOn) {
        stage.ground.visible = false;
        (reflector.onBeforeRender as (r: THREE.WebGLRenderer, s: THREE.Scene, c: THREE.Camera) => void)(renderer, scene, camera);
        stage.ground.visible = true;
      }
      if (gl && !glWait) composer.render();
      // A picture for sharing: read in the task that drew the frame (neither canvas keeps
      // its drawing after it is shown).
      if (stage.snap) {
        const done = stage.snap; stage.snap = null;
        (native?.shown ? native.canvas : renderer.domElement).toBlob(b => done(b), "image/png");
      }
      if (stage.unshown && stage.model && (native?.ready || (gl && !glWait))) {
        stage.unshown = false;
        settleUntil = nowMs + 4000;
        stage.onShown.splice(0).forEach(f => f());
        host.dataset.shownAt = performance.now().toFixed(0);
      }
    };

    /** Sun, sky, haze and every light-dependent material for one look. */
    const applyLook = (l: Look, env: boolean) => {
      stage.look = l;
      const u = sky.material.uniforms;
      u.turbidity.value = l.turbidity;
      u.rayleigh.value = l.rayleigh;
      u.mieCoefficient.value = l.mie;
      u.mieDirectionalG.value = l.mieG;
      u.cloudCoverage.value = l.clouds;
      u.cloudDensity.value = 0.45;
      u.cloudElevation.value = 0.55;
      u.cloudScale.value = 0.00022;
      u.cloudSpeed.value = 0.00006;
      dirFrom(l.sunElev, l.sunAz, sunDir);
      u.sunPosition.value.copy(sunDir);
      u.uSunColor.value.copy(l.key).multiplyScalar(l.keyI);
      u.uNight.value = l.stars;
      u.uWeather.value.set(l.overcast, l.rain, l.snow);
      dirFrom(l.keyElev, l.keyAz, keyDir);
      const reach = stage.dist * 2 + stage.top * 2;
      sun.position.copy(stage.center).addScaledVector(keyDir, reach);
      sun.target.position.copy(stage.center);
      sun.color.copy(l.key);
      sun.intensity = l.keyI;
      hemi.color.copy(l.hemiSky);
      hemi.groundColor.copy(l.hemiGround);
      hemi.intensity = l.hemiI;
      const fog = scene.fog as THREE.FogExp2;
      fog.color.copy(l.fog);
      fog.density = l.fogK / stage.dist;
      renderer.toneMappingExposure = l.exposure;
      scene.environmentIntensity = l.env;
      shared.uGlass.value = 0.7 / Math.max(0.05, l.env);
      stage.lit.windows.forEach(m => { m.emissiveIntensity = l.windows; });
      stage.lit.crowns.forEach(m => { m.emissiveIntensity = l.windows * 0.5; });
      stage.lit.ground.forEach(m => { m.emissiveIntensity = l.lamps * 0.9; });
      stage.onLook.forEach(f => f(l));
      // Behind an overcast no stars or moon.
      u.uStarVis.value = l.stars * (1 - l.overcast);
      u.uStarTurn.value = l.starTurn;
      moon.setPosition(l.moonElev, l.moonAz, l.moonLit);
      balloon.setLook(l);
      moon.setLevel(l.stars * (1 - l.overcast));
      shared.uCloud.value = l.cloudShade;
      shared.uWet.value = l.rain;
      shared.uSnow.value = l.snow;
      precip.setLook(l);
      reflStrength.value = l.reflect;
      bloom.strength = l.bloom;
      bloom.threshold = l.bloomAt;
      if (env) refreshEnv();
    };
    stage.refreshEnv = () => applyLook(stage.look, true);
    applyLookRef.current = applyLook;
    applyLook(stage.look, true);

    // Paused while off screen: a model below the fold should cost nothing.
    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      cancelAnimationFrame(raf);
      if (entry.isIntersecting || warming()) { last = performance.now(); loop(); }
    });
    io.observe(host);
    stage.attach = next => {
      if (next === host) return;
      ro.unobserve(host); io.unobserve(host);
      Object.assign(next.dataset, host.dataset);
      next.appendChild(renderer.domElement);
      if (native) next.appendChild(native.canvas);
      host = next;
      ro.observe(host); io.observe(host);
      resize();
      stage.resume();
    };
    stage.resume = () => { cancelAnimationFrame(raf); touched(); last = performance.now(); loop(); };
    const visibility = () => {
      cancelAnimationFrame(raf);
      last = performance.now(); sampleStart = last; sampleFrames = 0;
      if (!document.hidden) loop();
    };
    document.addEventListener("visibilitychange", visibility);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", visibility);
      cancelAnimationFrame(raf);
      native?.dispose();
      io.disconnect();
      ro.disconnect();

      stage.disposeModel();
      disposeControls(controls);
      listening.abort();
      composer.dispose();
      target.dispose();
      gtao?.dispose();
      reflector?.dispose();
      envRT?.dispose();
      pmrem.dispose();
      sky.geometry.dispose();
      sky.material.dispose();
      moon.dispose();
      balloon.dispose();
      precip.dispose();
      releaseRenderer(renderer);
      stageRef.current = null;
      applyLookRef.current = null;
    };
  }, [renderMode]);

  // Full screen, the view draws even when its owner would pause it (the card is under it).
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused && !big;
    if (!pausedRef.current) stageRef.current?.resume();
  }, [paused, big]);
  const openedFull = useRef(0);
  useEffect(() => {
    if (!openFull || openFull === openedFull.current) return;
    openedFull.current = openFull;
    openBig();
  }, [openFull]);
  const fullChange = useRef(onFullChange);
  fullChange.current = onFullChange;
  useEffect(() => { fullChange.current?.(big); }, [big]);

  const spinRef = useRef(spin);
  useEffect(() => {
    spinRef.current = spin;
    if (stageRef.current) stageRef.current.controls.autoRotate = spin;
  }, [spin]);

  const navigateView = (action: "in" | "out" | "left" | "right" | "up" | "down" | "home" | "top") => {
    const st = stageRef.current;
    if (!st) return;
    if (st.balloonView) {
      const bv = st.balloonView;
      if (action === "home") leaveBalloon();
      else if (action === "in" || action === "out") zoomBalloon(action === "in" ? 0.7 : 1.4);
      else if (action === "left" || action === "right") bv.yaw += (action === "left" ? -1 : 1) * Math.PI / 8;
      else if (action === "up" || action === "down") bv.pitch = THREE.MathUtils.clamp(bv.pitch + (action === "up" ? 0.15 : -0.15), -1.5, 0.9);
      else bv.pitch = -1.45;
      st.resume();
      return;
    }
    st.controls.autoRotate = false; spinRef.current = false; setSpin(false); setTip(null);
    st.intro = null;
    // Consume residual drag inertia before applying an exact button command.
    st.controls.enableDamping = false; st.controls.update(); st.controls.enableDamping = true;
    // From where a flight in progress is heading (a second press adds to the first).
    const fromPos = st.fly ? st.fly.toPos.clone() : st.camera.position.clone();
    const fromTarget = st.fly ? st.fly.toTarget.clone() : st.controls.target.clone();
    let toPos: THREE.Vector3, toTarget = fromTarget.clone();
    if (action === "home") {
      // Where the opening shot puts the camera, then glide there.
      const pos = st.camera.position.clone(), target = st.controls.target.clone();
      st.frame();
      toPos = st.camera.position.clone(); toTarget = st.controls.target.clone();
      st.camera.position.copy(pos); st.controls.target.copy(target); st.controls.update();
    } else {
      const offset = fromPos.clone().sub(fromTarget);
      if (action === "in" || action === "out") {
        offset.setLength(THREE.MathUtils.clamp(offset.length() * (action === "in" ? 0.55 : 1.8), st.controls.minDistance, st.controls.maxDistance));
      } else {
        const sphere = new THREE.Spherical().setFromVector3(offset);
        if (action === "top") sphere.phi = 0.18;
        else if (action === "up" || action === "down") sphere.phi = THREE.MathUtils.clamp(sphere.phi + (action === "up" ? -1 : 1) * 0.16, 0.12, Math.PI / 2 - 0.035);
        else sphere.theta += (action === "left" ? -1 : 1) * Math.PI / 8;
        offset.setFromSpherical(sphere);
      }
      toPos = fromTarget.clone().add(offset);
    }
    st.fly = { fromPos: st.camera.position.clone(), toPos, fromTarget: st.controls.target.clone(), toTarget, t0: st.now, dur: 0.6 };
    st.resume();
  };
  /** Glide to a point (a double-clicked building): the orbit target there, the camera
   * keeping its bearing at a distance that frames it. */
  const flyTo = (point: THREE.Vector3, distance: number) => {
    const st = stageRef.current;
    if (!st || st.balloonView) return;
    st.controls.autoRotate = false; spinRef.current = false; setSpin(false); st.intro = null;
    const dir = st.camera.position.clone().sub(st.controls.target).normalize();
    // (not flatter than 20°: a building seen from its own ground level reads badly)
    if (dir.y < 0.34) { dir.y = 0.34; dir.normalize(); }
    const d = THREE.MathUtils.clamp(distance, st.controls.minDistance * 4, st.controls.maxDistance);
    st.fly = { fromPos: st.camera.position.clone(), toPos: point.clone().addScaledVector(dir, d), fromTarget: st.controls.target.clone(), toTarget: point.clone(), t0: st.now, dur: 0.9 };
    st.resume();
  };

  // The layer is portaled to <body> (a transformed ancestor would otherwise pin a
  // fixed layer to itself, off screen); the running renderer moves with it.
  useLayoutEffect(() => {
    if (hostRef.current) stageRef.current?.attach(hostRef.current);
  }, [big]);

  useEffect(() => {
    stageRef.current?.resume();
    if (!big) return;
    const previous = document.activeElement as HTMLElement | null;
    const section = sectionRef.current!;
    section.querySelector<HTMLButtonElement>('.re-holo-wide-close')?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // No `inert` on the page behind: the layer already covers it (pointer), Tab is kept
    // inside below and the section is aria-modal. Toggling inert on the page root restyled
    // and rebuilt the accessibility tree of the whole page on open and on close (~60 ms here,
    // far more with accessibility clients running): the pointer stuck right after closing,
    // on its way to the detail card's ×.
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeBig(); }
      if (event.key === 'Tab') {
        const items = Array.from(section.querySelectorAll<HTMLElement>('button,a[href]'));
        const i = items.indexOf(document.activeElement as HTMLElement);
        event.preventDefault(); items[(i + (event.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', key, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [big, closeBig]);

  const terrainRef = useRef<Terrain>(FLAT);
  rebuildRef.current = () => setData(d => (d ? { ...d } : d));
  const applyLookRef = useRef<((l: Look, env: boolean) => void) | null>(null);
  useEffect(() => {
    hourRef.current = hour;
    const st = stageRef.current;
    if (!st) return;
    st.atmos.hour = hour; st.atmos.dirty = true;
    st.resume();
  }, [hour]);
  useEffect(() => {
    weatherRef.current = weather;
    const st = stageRef.current;
    if (!st) return;
    st.atmos.wantRain = +(weather === "rain"); st.atmos.wantSnow = +(weather === "snow");
    st.resume();
  }, [weather]);
  // The sun over the complex itself (its latitude and longitude, when known).
  const center = data?.center;
  useEffect(() => {
    const st = stageRef.current;
    if (!st || !center) return;
    st.atmos.lat = center.lat; st.atmos.lon = center.lon; st.atmos.dirty = true;
  }, [center?.lat, center?.lon]);

  /** A result without surveyed roads (kept by the server, or from OpenStreetMap) gets
   * them from VWorld, in at most 2.5 s; without them it still draws, just roadless. */
  const withRoads = async (res: RealEstateBuildingsResponse): Promise<RealEstateBuildingsResponse> => {
    if (res.roads || !res.vworld_key || !res.center) return res;
    const roads = await Promise.race([
      vworldRoads(res, res.vworld_key, res.vworld_domain).catch(() => null),
      new Promise<null>(r => window.setTimeout(() => r(null), 2500)),
    ]);
    return roads ? { ...res, roads } : res;
  };

  // Every selection: this browser's copy, else kept shapes from the server, else
  // VWorld from this browser (VWorld refuses the server abroad) raced against the
  // server's OpenStreetMap fallback.
  useEffect(() => {
    setTip(null);
    if (!complexId) { setData(null); return; }
    const ctl = new AbortController();
    let live = true;
    setLoading(true);
    setSlowData(false);
    const started = performance.now();
    // Its facades start painting now, alongside the network.
    prefetchPaint(complexId);
    if (hostRef.current) { delete hostRef.current.dataset.shownAt; hostRef.current.dataset.selectAt = started.toFixed(0); }
    const slowTimer = window.setTimeout(() => { if (live) setSlowData(true); }, 3000);
    setError("");
    setDataTry(0);
    // One attempt at the shapes. The server's first look-up of a complex asks outside
    // sources (OpenStreetMap, several tries each) and can take minutes, or stall; a
    // request left waiting only ended with a page reload. Each attempt now has a time
    // limit and the next one starts over (by then the server has usually kept the
    // result, and answers at once).
    const attempt = async (signal: AbortSignal): Promise<RealEstateBuildingsResponse> => {
      const cached = buildingCache.get(complexId);
      if (cached && Date.now() - cached.at < 300000) return cached.data;
      const early = prefetched.get(complexId);
      prefetched.delete(complexId);
      const kept = await loadBuildings(complexId);
      if (kept) return kept;
      const peek = await (early ?? api.realEstateBuildings(complexId, signal, true)).catch(() => api.realEstateBuildings(complexId, signal, true));
      // Roads and terrain only need these footprints/centre. The common stage below
      // loads them together; awaiting roads here serialized the two network waits.
      if (peek.found) return peek;
      // Start independent suppliers together: a slow JSONP endpoint must not
      // delay a server result that is already available (and vice versa).
      const fallback = api.realEstateBuildings(complexId, signal);
      if (!peek.vworld_key || !peek.query?.parcel) return fallback;
      const direct = vworldBuildings(complexId, peek.query, peek.vworld_key, peek.vworld_domain)
        .then(value => value ? { ...value, built: peek.built ?? null, vworld_key: peek.vworld_key, vworld_domain: peek.vworld_domain } : null);
      return new Promise<RealEstateBuildingsResponse>((resolve, reject) => {
        let remaining = 2;
        let empty: RealEstateBuildingsResponse | null = null;
        let failure: unknown;
        for (const request of [fallback, direct]) request.then(result => {
          if (result?.found) resolve(result);
          else if (result) empty = result;
        }).catch(err => { failure = err; }).finally(() => {
          if (--remaining === 0) { if (empty) resolve(empty); else reject(failure ?? new Error("건물 자료를 찾지 못했습니다.")); }
        });
      });
    };
    const LIMITS = [20000, 30000, 45000];
    (async () => {
      for (let n = 0; ; n++) {
        const one = new AbortController();
        const stop = () => one.abort();
        ctl.signal.addEventListener("abort", stop);
        const limit = window.setTimeout(stop, LIMITS[n]);
        try {
          return await Promise.race([
            attempt(one.signal),
            new Promise<never>((_, reject) => one.signal.addEventListener("abort", () => reject(new Error("건물 자료 응답이 늦어지고 있습니다.")))),
          ]);
        } catch (err) {
          if (ctl.signal.aborted || n === LIMITS.length - 1) throw err;
          if (live) setDataTry(n + 1);
        } finally {
          window.clearTimeout(limit);
          ctl.signal.removeEventListener("abort", stop);
        }
      }
    })()
      // Roads and relief together: both only need the result's centre.
      .then(async res => {
        if (!live) return res;
        const t0 = performance.now();
        const [full, ground] = await Promise.all([res.found && !res.roads ? withRoads(res) : res,
          res.found ? terrainFor(res).then(t => { if (hostRef.current) hostRef.current.dataset.terrainMs = (performance.now() - t0).toFixed(0); return t; }) : FLAT]);
        if (live) {
          if (hostRef.current) hostRef.current.dataset.dataMs = (t0 - started).toFixed(0);
          terrainRef.current = ground;
          setTerrainSource(ground.source);
        }
        return full;
      })
      .then(found => {
        const res = withoutDemolished(found);
        if (res.found) {
          if (!buildingCache.has(complexId)) void saveBuildings(complexId, res);
          buildingCache.set(complexId, { at: Date.now(), data: res });
          if (buildingCache.size > 8) buildingCache.delete(buildingCache.keys().next().value!);
        }
        if (!live) return;
        if (hostRef.current) hostRef.current.dataset.fetchMs = (performance.now() - started).toFixed(0);
        setData(res); if (!res.found) setError(res.error || "건물 윤곽 자료를 찾지 못했습니다."); })
      .catch(err => { if (live && !ctl.signal.aborted) { setData(null); setError(err instanceof Error ? err.message : "불러오지 못했습니다."); } })
      .finally(() => { window.clearTimeout(slowTimer); if (live) setLoading(false); });
    return () => { live = false; window.clearTimeout(slowTimer); ctl.abort(); };
  }, [complexId, reloadKey]);

  // Build the model for the loaded complex.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.disposeModel();
    if (!data?.found || !data.buildings.length) return;
    const modelStarted = performance.now();
    const terrain = terrainRef.current;
    // Buildings first: plants, lamps and traffic join once this model is on screen,
    // so their shaders never hold back the first frame.
    stage.unshown = true;
    const afterShown = (f: () => void) => { if (stage.unshown) stage.onShown.push(f); else f(); };
    const palette = paletteFor(data.name);
    const disposables: { dispose: () => void }[] = [];
    const keep = <T extends { dispose: () => void }>(x: T) => { disposables.push(x); return x; };
    const group = new THREE.Group();
    group.rotation.x = -Math.PI / 2; // footprints are x east / y north, extruded up z
    group.updateMatrixWorld();
    const lit: Stage["lit"] = { windows: [], crowns: [], ground: [] };
    let alive = true;
    let ground: THREE.Mesh | null = null;
    const decor = new THREE.Group();
    // Set before any work: a newer selection disposes a half-built model cleanly.
    stage.disposeModel = () => {
      alive = false;
      stage.onShown = [];
      stage.scene.remove(group, decor);
      if (ground) stage.scene.remove(ground);
      disposables.forEach(d => d.dispose());
      stage.model = null; stage.ground = null; stage.pickables = [];
      stage.lit = { windows: [], crowns: [], ground: [] };
      stage.tick = []; stage.onLook = [];
    };
    // The build runs in slices so the page (the detail popup above all) stays
    // responsive; behind an open popup, only in the browser's idle time.
    let sliceStart = performance.now();
    const pace = async (force = false) => {
      if (force || performance.now() - sliceStart > 8) {
        cpu += performance.now() - sliceStart;
        await nextSlice(pausedRef.current);
        sliceStart = performance.now();
      }
      return alive;
    };
    // Where the build's time goes (dataset.buildSteps: step=wall ms/main-thread ms).
    const steps: string[] = [];
    let stepAt = performance.now(), cpu = 0, cpuAt = 0;
    const step = (name: string) => {
      const now = performance.now(), used = cpu + (now - sliceStart);
      steps.push(`${name}=${(now - stepAt).toFixed(0)}/${(used - cpuAt).toFixed(0)}`);
      console.timeStamp(`3d:${name}`);
      stepAt = now; cpuAt = used;
    };
    void (async () => {

    let seed = 0;
    for (const ch of data.id) seed = (seed * 33 + ch.charCodeAt(0)) % 2147483647;
    const rnd = rng(seed);

    // Two facade variants so neighbouring towers don't light the same windows.
    if (!await pace(true)) return;
    const walls: THREE.MeshPhysicalMaterial[] = [];
    for (const s of [seed, seed + 7919]) {
      if (!await pace(true)) return;
      // Started when the complex was chosen (alongside its network wait), or kept from
      // an earlier visit.
      const tex = await paintTextures({ kind: "facade", palette, seed: s }, pace);
      if (!tex) return;
      if (!alive) { Object.values(tex).forEach(t => t.dispose()); return; }
      // Painted for this complex only and never repainted: the WebGPU view empties the
      // canvas once the texture is on the GPU (ComplexRenderer.release).
      Object.values(tex).forEach(t => { t.userData.releaseAfterUpload = true; });
      Object.values(tex).forEach(keep);
      const m = keep(new THREE.MeshPhysicalMaterial({
        map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.9, 0.9),
        roughnessMap: tex.rmMap, metalnessMap: tex.rmMap, roughness: 1, metalness: 1,
        emissiveMap: tex.emissiveMap, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0,
        clearcoat: 0.08, clearcoatRoughness: 0.6,
      }));
      patchMaterial(m, { glass: true });
      // (WebGPU: rooms behind the clear glass — interior mapping, ComplexRenderer)
      m.userData.interior = true;
      m.userData.detail = "paint";
      lit.windows.push(m);
      walls.push(m);
    }
    step("facades");
    if (!await pace(true)) return;
    const roof = keep(new THREE.MeshStandardMaterial({ color: "#6f8174", roughness: 0.93 }));
    roof.userData.roofDetail = true;
    roof.userData.detail = "roof";
    const crown = keep(new THREE.MeshStandardMaterial({ color: palette.accent, roughness: 0.4, metalness: 0.45, emissive: palette.accent, emissiveIntensity: 0 }));
    lit.crowns.push(crown);
    const low = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.wall).lerp(new THREE.Color(palette.wall2), 0.45), roughness: 0.75 }));
    low.userData.weathered = true;
    low.userData.detail = "paint";
    // Low-rise facilities (community centre, shops): the shop facade in the complex's
    // colour, drawn with the neighbourhood's shop material (one pipeline fewer).
    const lowTint = new THREE.Color(palette.wall).lerp(new THREE.Color("#ffffff"), 0.2);
    // The towers' own finish, a step above the neighbourhood: a honed granite base
    // (1–2층), end walls (측벽) in the complex's second colour with its accent stripe.
    const stoneTex = await paintTextures({ kind: "plinth", seed: seed + 13, tone: plinthTone(palette) }, pace);
    if (!stoneTex) return;
    if (!alive) { Object.values(stoneTex).forEach(t => t.dispose()); return; }
    Object.values(stoneTex).forEach(keep);
    Object.values(stoneTex).forEach(t => { t.userData.releaseAfterUpload = true; });
    const stone = keep(new THREE.MeshPhysicalMaterial({
      map: stoneTex.map, normalMap: stoneTex.normalMap, normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: stoneTex.rmMap, roughness: 1, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.35,
    }));
    stone.userData.detail = "granite";
    // Plain painted trim (end walls, their accent stripe, the roof core): one material,
    // colour per vertex.
    const trim = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 }));
    trim.userData.weathered = true;
    trim.userData.detail = "paint";
    const gableC = new THREE.Color(palette.wall2).lerp(new THREE.Color(palette.wall), 0.25), stripeC = new THREE.Color(palette.accent);
    const plantC = new THREE.Color(palette.wall2).lerp(new THREE.Color("#9a9a96"), 0.5);
    const tinted = (g: THREE.BufferGeometry, c: THREE.Color) => {
      const n = g.getAttribute("position").count, col = new Float32Array(n * 3);
      for (let j = 0; j < n; j++) { col[j * 3] = c.r; col[j * 3 + 1] = c.g; col[j * 3 + 2] = c.b; }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      return g;
    };
    step("stone");
    [roof, crown, low, stone, trim].forEach(m => patchMaterial(m));
    // The complex's own materials start compiling now, while its buildings are laid out
    // (their pipelines used to wait for the finished model: ~1 s after it, on a first
    // visit). One invisible triangle each — zero area, never culled, shadow-casting so the
    // shadow passes compile too — with the attributes their meshes will have; gone once
    // the model is on screen.
    {
      const tri = (color: boolean) => {
        const g = keep(new THREE.BufferGeometry());
        g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(9), 3));
        g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(6), 2));
        if (color) g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(9), 3));
        return g;
      };
      const plainTri = tri(false), tintedTri = tri(true);
      const warmBox = new THREE.Group();
      stage.scene.add(warmBox);
      for (const m of [...walls, roof, crown, low, stone, trim]) {
        const mesh = new THREE.Mesh(m.vertexColors ? tintedTri : plainTri, m);
        mesh.frustumCulled = false; mesh.castShadow = true;
        stage.addWarm(warmBox, mesh);
      }
      stage.onShown.push(() => warmBox.removeFromParent());
      disposables.push({ dispose: () => warmBox.removeFromParent() });
    }
    // The neighbourhood's facades (and the complex's own low-rise) by style.
    const ctxGeos: Record<ContextStyle, THREE.BufferGeometry[]> = { villa: [], shop: [], office: [], apt: [] };

    if (!await pace(true)) return;
    // Geometry per material, merged once below: a few draws for the whole complex.
    const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const add = (mat: THREE.Material, geo: THREE.BufferGeometry | undefined) => {
      if (!geo) return;
      if (!parts.has(mat)) parts.set(mat, []);
      parts.get(mat)!.push(geo);
    };
    const relief: THREE.Matrix4[] = [];
    const reliefLimit = stage.hq ? 40000 : 12000;
    const box = new THREE.Box3();
    const pickables: THREE.Mesh[] = [];
    let top = 10, floor = Infinity;
    const footArea = (r: [number, number][]) => Math.abs(r.reduce((a, [x, y], j) => { const q = r[(j + 1) % r.length]; return a + x * q[1] - q[0] * y; }, 0) / 2);
    const panel = (x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, out: number, thick: number, inset: number) => {
      const len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / len, uy = (y1 - y0) / len;
      const g = new THREE.BoxGeometry(len * inset, thick, z1 - z0).toNonIndexed();
      g.rotateZ(Math.atan2(uy, ux));
      // Outward normal of a counter-clockwise ring is to the right of travel.
      g.translate((x0 + x1) / 2 + uy * out, (y0 + y1) / 2 - ux * out, (z0 + z1) / 2);
      return g;
    };
    for (const [i, b] of data.buildings.entries()) {
      if (!await pace()) return;
      // Register entries with neither height nor floors and a small footprint are guard
      // posts and ramp covers: drawn as guessed blocks they read as stray objects.
      if (b.height_source === "estimated" && footArea(b.rings[0]) < 300) continue;
      // Seated on the real ground: its lowest point under the footprint.
      const g = terrain.base(b.rings[0]);
      const isTower = b.floors >= 5;
      const geo = extrude(b, g, isTower ? FLOOR_M : CONTEXT_FLOOR_M.shop);
      const [caps, sides] = splitGroups(geo);
      add(roof, caps);
      if (isTower) add(walls[i % 2], sides);
      else if (sides) ctxGeos.shop.push(tinted(sides, lowTint));
      // Picking only: never rendered, shares the group's transform.
      geo.clearGroups();
      const pick = new THREE.Mesh(keep(geo));
      pick.userData.label = `${b.name ? b.name + " · " : ""}${heightLabel(b)}`;
      pick.matrixWorld.copy(group.matrixWorld);
      pickables.push(pick);
      const H = b.height + g, B = b.base + g;
      if (isTower) {
        facadeRelief({ ...b, base: B, height: H }, relief, reliefLimit);
        // Rooftop crown band in the complex's accent colour, and the lift / stair core.
        const cap = new THREE.ExtrudeGeometry(shapeOf(b), { depth: 1.6, bevelEnabled: false });
        cap.translate(0, 0, H);
        const [capTop, capSide] = splitGroups(cap);
        cap.dispose();
        add(roof, capTop);
        add(crown, capSide);
        const ring = b.rings[0];
        const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
        // Granite base: the footprint, 8 cm proud of the wall, up to the 2nd floor slab.
        const plinthTop = B + Math.min((b.height - b.base) * 0.3, GROUND_M + 2 * FLOOR_M);
        const span = Math.max(8, ...ring.map(([x, y]) => Math.hypot(x - cx, y - cy)));
        const k = 1 + 0.08 / span;
        const plinth = new THREE.ExtrudeGeometry(new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(cx + (x - cx) * k, cy + (y - cy) * k))),
          { depth: plinthTop - B + SINK, bevelEnabled: false });
        plinth.translate(0, 0, B - SINK);
        const [, plinthSide] = splitGroups(plinth);
        plinth.dispose();
        add(stone, plinthSide);
        // End walls: the short sides of a slab tower, full height above the base.
        let longest = 0;
        ring.forEach((p, j) => { const q = ring[(j + 1) % ring.length]; longest = Math.max(longest, Math.hypot(q[0] - p[0], q[1] - p[1])); });
        ring.forEach((p, j) => {
          const q = ring[(j + 1) % ring.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (len < 6 || len > 22 || len > longest * 0.6) return;
          add(trim, tinted(panel(p[0], p[1], q[0], q[1], plinthTop, H, 0.12, 0.22, 0.92), gableC));
          add(trim, tinted(panel(p[0], p[1], q[0], q[1], B + (H - B) * 0.45, H - 0.4, 0.26, 0.06, Math.min(0.2, 1.4 / len)), stripeC));
        });
        if (inRing([cx, cy], ring)) {
          let ang = 0, best = 0;
          ring.forEach((p, j) => {
            const q = ring[(j + 1) % ring.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
            if (len > best) { best = len; ang = Math.atan2(q[1] - p[1], q[0] - p[0]); }
          });
          const core = new THREE.BoxGeometry(Math.min(9, best * 0.3), 5, 4.2).toNonIndexed();
          core.rotateZ(ang);
          core.translate(cx, cy, H + 1.6 + 2.1);
          add(trim, tinted(core, plantC));
        }
      }
      geo.computeBoundingBox();
      box.union(geo.boundingBox!);
      top = Math.max(top, H);
      floor = Math.min(floor, g);
    }
    step("towers");
    if (!Number.isFinite(floor)) floor = 0;
    for (const [mat, geos] of parts) {
      const merged = keep(mergeGeometries(geos, false)!);
      geos.forEach(g => g.dispose());
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    if (relief.length) {
      const unit = keep(new THREE.BoxGeometry(1, 1, 1));
      const ledges = new THREE.InstancedMesh(unit, low, relief.length);
      relief.forEach((m, j) => ledges.setMatrixAt(j, m));
      ledges.castShadow = ledges.receiveShadow = true;
      ledges.computeBoundingSphere();
      group.add(ledges);
      disposables.push(ledges);
    }

    // The neighbourhood: every registered building within the surveyed radius, on its
    // own ground, in one of three facades chosen by its registered use, tinted per
    // building, windows fitted to its registered floors, a parapet round its roof.
    const ext = data.buildings.flatMap(b => b.rings[0]).reduce((m, [x, y]) => Math.max(m, Math.hypot(x, y)), 0);
    // Neighbours drawn this far out (the fetched radius, CONTEXT_M 288 m, plus the parcel).
    const reach = ext + 300;
    const tints = ["#f1ede4", "#e4e1da", "#d9d4ca", "#c9b8a4", "#b88f78", "#a9b3bb", "#e8e3d3", "#cfc9bd"];
    const styles: ContextStyle[] = ["villa", "shop", "office", "apt"];
    const parapets: THREE.Matrix4[] = [];
    const pm = new THREE.Object3D();
    const neighbours = data.context.filter(b => b.rings[0].some(([x, y]) => Math.hypot(x, y) <= reach));
    step("merge");
    if (!await pace(true)) return;
    for (const b of neighbours) {
      if (!await pace()) return;
      const g = terrain.base(b.rings[0]);
      const style = contextStyle(b.use, b.height, rnd());
      const geo = extrude(b, g, CONTEXT_FLOOR_M[style]);
      geo.clearGroups();
      const c = new THREE.Color(tints[Math.floor(rnd() * tints.length)]);
      if (style === "office") c.lerp(new THREE.Color("#ffffff"), 0.4);
      if (style === "apt") c.lerp(new THREE.Color("#ffffff"), 0.65);
      const n = geo.getAttribute("position").count, col = new Float32Array(n * 3);
      for (let j = 0; j < n; j++) col.set([c.r, c.g, c.b], j * 3);
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      ctxGeos[style].push(geo);
      // Parapet: a 0.9 m upstand, 0.2 m thick, along every roof edge longer than 2 m.
      const ring = b.rings[0], H = b.height + g;
      if (b.height >= 5 && parapets.length < (stage.hq ? 24000 : 8000)) ring.forEach((p, j) => {
        const q = ring[(j + 1) % ring.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (len < 2) return;
        const ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len;
        pm.position.set((p[0] + q[0]) / 2 - uy * 0.1, (p[1] + q[1]) / 2 + ux * 0.1, H + 0.45);
        pm.rotation.set(0, 0, Math.atan2(uy, ux));
        pm.scale.set(len + 0.2, 0.2, 0.9);
        pm.updateMatrix();
        parapets.push(pm.matrix.clone());
      });
    }
    step("neighbours");
    for (const style of styles) {
      if (!await pace()) return;
      const list = ctxGeos[style];
      if (!list.length) continue;
      const merged = keep(mergeGeometries(list, false)!);
      list.forEach(g => g.dispose());
      // Apartment neighbours get the apartment facade (neutral colours, one variant, no
      // base, end walls or crown: those stay the complex's own). Shared by every complex,
      // compiled while the first one loads.
      if (!await sharedContextTexturesSliced(style, pace)) return;
      const ctxMat = sharedContextMaterial(style);
      lit.windows.push(ctxMat);
      const ctxMesh = new THREE.Mesh(merged, ctxMat);
      ctxMesh.castShadow = ctxMesh.receiveShadow = true;
      group.add(ctxMesh);
    }
    if (parapets.length) {
      // Same material and instanced pipeline as the towers' floor ledges.
      const unit = keep(new THREE.BoxGeometry(1, 1, 1));
      const im = new THREE.InstancedMesh(unit, low, parapets.length);
      parapets.forEach((m, j) => im.setMatrixAt(j, m));
      im.castShadow = im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
      disposables.push(im);
    }

    const span = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, 60);
    const cx = (box.max.x + box.min.x) / 2, cy = (box.max.y + box.min.y) / 2;
    const dist = Math.max(span, top * 1.4) * 1.1 + 40;

    // The ground: the surveyed parcel landscaped (flat paint only), laid over the real
    // relief; damp paving reflects the towers where the ground is level.
    const T = Math.max(reach * 1.15, span * 0.9 + 120);
    step("ctxMaterials");
    if (!await pace(true)) return;
    let paintAt = performance.now();
    const plan = await runSliced(paintGroundSteps(data, T, stage.hq ? 2048 : 1024, seed), async () => {
      if (performance.now() - paintAt > 6) { cpu += performance.now() - sliceStart; await nextFrame(pausedRef.current); paintAt = sliceStart = performance.now(); }
      return alive;
    });
    if (!plan) return;
    step("groundPaint");
    if (!await pace(true)) return;
    [plan.color, plan.rough].forEach(keep);
    const G = dist * 12;
    // No elevation data (level ground): no relief for a fine grid to follow.
    const groundGrid = await groundGeometry(T, G, terrain, terrain.source === null ? 64 : stage.hq ? 320 : 200, pace);
    if (!groundGrid) return;
    const groundGeo = keep(groundGrid);
    if (!await pace(true)) return;
    [plan.glow].forEach(keep);
    const groundMat = keep(new THREE.MeshStandardMaterial({
      map: plan.color, roughnessMap: plan.rough, roughness: 1, metalness: 0,
      emissiveMap: plan.glow, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0,
    }));
    lit.ground.push(groundMat);
    // Beyond the surveyed area the ground is featureless: it fades into the horizon haze.
    groundMat.userData.edgeFade = true;
    // (WebGPU: grass, asphalt and paving detail in world space)
    groundMat.userData.groundDetail = true;
    const level = terrain.relief < 1.2;
    patchMaterial(groundMat, {
      detail: true,
      reflect: stage.reflector && level ? {
        tex: { value: stage.reflector.getRenderTarget().texture },
        matrix: (stage.reflector.material as THREE.ShaderMaterial).uniforms.textureMatrix,
        strength: stage.reflStrength,
        far: { value: dist * 2.2 },
      } : undefined,
    });
    step("groundGeo");
    ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    // The model and its ground reach the scene together, in one frame.
    stage.scene.add(group, ground);
    stage.unshown = true;

    // Street furniture on the surveyed roads: raised sidewalks with kerbs, street trees
    // in pits, lamps, traffic and people walking. All of it after the first frame.
    stage.scene.add(decor);
    const roads = stitchedRoads(data.roads ?? []);
    // (the plant kit — meshes, twig and bark textures, ~3 MB — after the first frame: fetched and
    // decoded alongside it, it held the first frame back by a few hundred ms)
    afterShown(() => preloadPlants());
    const landUse = async (): Promise<Planting> => {
      if (data.parcels || !data.vworld_key) return plan.planting;
      const got = await Promise.race([
        vworldParcels(data, data.vworld_key, data.vworld_domain).catch(() => null),
        new Promise<null>(r => window.setTimeout(() => r(null), 12000)),
      ]);
      const parcels = got?.parcels;
      if (!parcels?.length || !alive) return plan.planting;
      await nextSlice(pausedRef.current);
      if (!alive) return plan.planting;
      data.parcels = parcels;
      data.streets = got!.streets;
      void saveBuildings(data.id, data);
      let sliceAt = performance.now();
      const next = await runSliced(paintGroundSteps(data, T, stage.hq ? 2048 : 1024, seed), async () => {
        if (performance.now() - sliceAt > 6) { await nextFrame(pausedRef.current); sliceAt = performance.now(); }
        return alive;
      });
      if (!next) return plan.planting;
      for (const k of ["color", "rough", "glow"] as const) {
        // The canvases still carry their painting state (a scale, additive blending).
        const g = (plan[k].image as HTMLCanvasElement).getContext("2d")!;
        g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "copy"; g.filter = "none"; g.globalAlpha = 1;
        g.drawImage(next[k].image as HTMLCanvasElement, 0, 0);
        plan[k].needsUpdate = true;
        next[k].dispose();
      }
      if (hostRef.current) hostRef.current.dataset.parcels = String(parcels.length);
      return next.planting;
    };
    const tick: Stage["tick"] = [];
    // Sidewalks, street trees, planting and people: laid out once the buildings are on
    // screen (none of it may hold back the first frame).
    // (each stage is its own task, and the long ones slice themselves: what runs after the
    // first frame must never hold the pointer; dataset.longChunks names any piece over 12 ms)
    const chunks: string[] = [];
    const timed = <R,>(name: string, fn: () => R): R => {
      const t = performance.now();
      try { return fn(); } finally {
        const d = performance.now() - t;
        if (d > 12 && hostRef.current) { chunks.push(`${name}=${d.toFixed(0)}`); hostRef.current.dataset.longChunks = chunks.join(" "); }
      }
    };
    const later = async () => { await nextSlice(pausedRef.current); return alive; };
    afterShown(() => void (async () => {
      if (!await later()) return;
      const footprints = [...data.buildings, ...neighbours].map(b => b.rings[0]);
      const runs = timed("sidewalkRuns", () => sidewalkRuns(roads, footprints));
      if (import.meta.env.DEV) (stage as unknown as { runs: unknown }).runs = runs;
      if (import.meta.env.DEV) (stage as unknown as { data: unknown }).data = data;
      const street = streetTrees(runs, plan.lamps);
      if (!await later()) return;
      const walks = timed("buildSidewalks", () => buildSidewalks(runs, terrain, street.map(([x, y]) => [x, y] as [number, number])));
      stage.addWarm(decor, walks.group);
      disposables.push(walks);
      if (!await later()) return;
      // Land use (연속지적도 지목) arrives after the first frame: the ground is repainted in
      // place, parks and forest get their trees, and the parcels are kept with the complex.
      // People: on the sidewalks, the complex's perimeter walk and round its towers
      // now; on the alleys (도로 parcels) and park edges once the parcels are in.
      const inFootprint = ringIndex(footprints);
      // Nobody walks on a carriageway: paths (parcel edges cross roads where a road's
      // parcels meet) are cut wherever they enter the surveyed road width.
      const onCarriageway = carriageway(roads, 0.8);
      const blocked = (x: number, y: number) => Math.abs(x) > T || Math.abs(y) > T || inFootprint(x, y) || onCarriageway(x, y);
      const crowd = (paths: WalkPath[], salt: number, spacing: number, cap: number, cut = true) => {
        const walkers = timed("buildWalkers", () => buildWalkers(cut ? cutPaths(paths, blocked) : paths, terrain, seed + salt, spacing, cap));
        if (!walkers) return;
        stage.addWarm(decor, walkers.group);
        if (import.meta.env.DEV) {
          ((stage as unknown as { walkers: unknown[] }).walkers ??= []).push(...walkers.group.userData.walkers);
          (stage as unknown as { terrainAt: (x: number, y: number) => number }).terrainAt = (x, y) => terrain.at(x, y);
        }
        disposables.push(walkers);
        tick.push(dt => walkers.update(dt, stage.camera));
      };
      crowd([...sidewalkPaths(runs), ...ringPaths(data.site, 2.4, blocked, 0.5), ...ringPaths(data.buildings.filter(b => b.floors >= 5).map(b => b.rings[0]), -3.2, blocked, 0.45)],
        0, 6, stage.hq ? 650 : 200);
      // Land use (연속지적도 지목) arrives after the first frame: the ground is repainted in
      // place, parks and forest get their trees, water its surface, alleys their people;
      // the parcels are kept with the complex.
      try {
        const planting = await landUse();
        // The ground's last paint is done (land use in, or none to come): its canvases
        // may go once uploaded again.
        for (const t of [plan.color, plan.rough, plan.glow]) { t.userData.releaseAfterUpload = true; t.needsUpdate = true; }
        if (!await later()) return;
        planting.street = street;
        const parcels = data.parcels ?? [];
        // Children at play on the school grounds, by day in dry weather.
        const kids = timed("buildKids", () => buildKids(parcels, terrain, blocked, T, seed));
        if (kids) {
          stage.addWarm(decor, kids.group);
          disposables.push(kids);
          tick.push(dt => kids.update(dt));
          onLook.push(l => kids.setLook(l));
          kids.setLook(stage.look);
          if (hostRef.current) hostRef.current.dataset.kids = String(kids.group.children[0] ? (kids.group.children[0] as THREE.InstancedMesh).count : 0);
          if (import.meta.env.DEV) Object.assign(window, { __holoKids: kids, __holoStage: stage });
          if (!await later()) return;
        }
        const water = await buildWater(parcels, waterCovered(data), terrain, pace);
        if (!alive) { water?.dispose(); return; }
        if (water) {
          stage.addWarm(decor, water.mesh); disposables.push(water);
          await water.sink(groundGeo);
          if (!await later()) return;
          // A big river: boats in clear weather by day (none on streams and ponds).
          const boats = timed("buildBoats", () => buildBoats(water.field, cx, cy, seed));
          if (!boats && hostRef.current) hostRef.current.dataset.boats = `none: ${noBoatsReason}`;
          if (boats) {
            stage.addWarm(decor, boats.group);
            disposables.push(boats);
            tick.push(dt => boats.update(dt, stage.camera));
            onLook.push(l => boats.setLook(l));
            boats.setLook(stage.look);
            if (hostRef.current) hostRef.current.dataset.boats = String(boats.group.children.length);
            // (development: tests aim the camera at a boat)
            if (import.meta.env.DEV) {
              Object.assign(window, { __holoStage: stage, __holoBoats: boats });
              disposables.push({ dispose: () => { const w = window as unknown as Record<string, unknown>; if (w.__holoBoats === boats) { delete w.__holoBoats; delete w.__holoStage; } } });
            }
            if (!await later()) return;
          }
        }
        // Thousands of parcel edges, each tested every 2 m against buildings and
        // carriageways: laid out 60 parcels per slice, in idle time.
        void (async () => {
          const edges: [Ring, number, number, number][] = [
            ...parcels.filter(p => p.kind === "도").map(p => [p.ring, 1.1, 0.4, 12] as [Ring, number, number, number]),
            ...parcels.filter(p => p.kind === "공" || p.kind === "원" || p.kind === "체").map(p => [p.ring, 2.2, 0.5, 20] as [Ring, number, number, number]),
          ].filter(([ring]) => ring.some(([x, y]) => Math.abs(x) < T && Math.abs(y) < T));
          const paths: WalkPath[] = [];
          for (let i = 0; i < edges.length; i += 60) {
            await nextSlice(pausedRef.current);
            if (!alive) return;
            timed("parcelEdges", () => { for (const [ring, off, lateral, minLen] of edges.slice(i, i + 60)) paths.push(...cutPaths(ringPaths([ring], off, blocked, lateral, minLen), blocked)); });
          }
          await nextSlice(pausedRef.current);
          if (alive) crowd(paths, 1, 9, stage.hq ? 700 : 220, false);
        })();
        const plants = await timed("buildPlants", () => buildPlants(planting, seed, terrain, stage.hq));
        if (!plants) return;
        if (!alive) { plants.dispose(); return; }
        stage.addWarm(decor, plants.mesh);
        disposables.push(plants);
      } catch (err) { console.info("[3D] Plants unavailable:", err); }
    })());
    // Street lamps on the surveyed roads (lit from dusk), and traffic both ways.
    const lamps = buildLamps(plan.lamps, terrain);
    afterShown(() => stage.addWarm(decor, lamps.group));
    disposables.push(lamps);
    const onLook = [(l: Look) => lamps.setLevel(l.lamps)];
    // Traffic (its vehicle kit decodes on first use) waits for the first frame and idle time.
    afterShown(() => void nextSlice(pausedRef.current).then(() => (alive ? buildTraffic(roads, seed, stage.hq, terrain) : null)).then(traffic => {
      if (!traffic) return;
      if (!alive) { traffic.dispose(); return; }
      stage.addWarm(decor, traffic.group);
      disposables.push(traffic);
      tick.push(dt => traffic.update(dt));
      onLook.push(l => traffic.setLamps(l.lamps));
      traffic.setLamps(stage.look.lamps);
    }).catch(err => console.info("[3D] Traffic unavailable:", err)));

    // Camera, sun and shadows framed on the complex, not the neighbourhood.
    const center = new THREE.Vector3(cx, floor + (top - floor) * 0.45, -cy);
    stage.center.copy(center);
    stage.dist = dist;
    stage.top = top;
    stage.floor = Math.min(0, floor, terrain.at(cx, cy));
    stage.frame = () => {
      stage.controls.target.copy(center);
      // Fit all eight corners to both frustum axes; tall towers used to lose their
      // crowns in the narrow map rail. Keep the sky above the roofs where the hot-air
      // balloon circles (its envelope up to ~55 m over the tallest roof).
      const viewDir = new THREE.Vector3(0.74, 0.22, 0.74).normalize();
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), viewDir).normalize();
      const up = new THREE.Vector3().crossVectors(viewDir, right);
      const tanV = Math.tan(THREE.MathUtils.degToRad(stage.camera.fov / 2));
      const tanH = tanV * stage.camera.aspect;
      let fitDistance = 60;
      for (const x of [box.min.x, box.max.x]) for (const y of [floor, top + 50]) for (const z of [-box.max.y, -box.min.y]) {
        const v = new THREE.Vector3(x, y, z).sub(center);
        fitDistance = Math.max(fitDistance, Math.max(Math.abs(v.dot(right)) / tanH, Math.abs(v.dot(up)) / tanV) + v.dot(viewDir));
      }
      fitDistance *= 1.16;
      // Close enough to see the people on the sidewalk (about 1.7 m tall).
      stage.controls.minDistance = 1.2;
      stage.controls.maxDistance = Math.max(dist, fitDistance) * 4;
      stage.camera.position.copy(center).addScaledVector(viewDir, fitDistance);
      stage.controls.update();
    };
    stage.frame();
    stage.intro = null;
    stage.balloon?.setRoute(center, span, top);
    if (stage.balloon) stage.balloon.group.visible = true;
    stage.camera.far = dist * 14 + 2000;
    stage.nearMax = Math.max(0.5, dist / 800);
    stage.camera.near = stage.nearMax;
    stage.camera.updateProjectionMatrix();
    const sc2 = stage.sun.shadow.camera;
    const half = span * 0.75 + (top - floor) * 0.9 + 40;
    sc2.left = -half; sc2.right = half; sc2.top = half; sc2.bottom = -half;
    sc2.near = 1; sc2.far = (dist * 2 + top * 2) * 2 + top * 2;
    sc2.updateProjectionMatrix();

    if (hostRef.current) {
      hostRef.current.dataset.modelBuildMs = (performance.now() - modelStarted).toFixed(0);
      step("rest");
      hostRef.current.dataset.buildSteps = steps.join(" ");
      hostRef.current.dataset.paint = `kept ${paintStats.kept} / painted ${paintStats.painted}`;
      hostRef.current.dataset.builtAt = performance.now().toFixed(0);
      hostRef.current.dataset.terrain = terrain.source ? `${terrain.relief.toFixed(1)}m` : "flat";
      hostRef.current.dataset.neighbours = String(neighbours.length);
    }
    stage.model = group;
    stage.ground = ground;
    stage.reflectOn = level;
    stage.lit = lit;
    stage.tick = tick;
    stage.onLook = onLook;
    stage.pickables = pickables;
    stage.refreshEnv();
    stage.unshown = true;
    stage.resume();
    })().catch(err => console.warn("[3D] Model build failed:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, renderMode]);

  // Which 동, how many floors, whether that height is surveyed: on hover with a
  // mouse, and on a tap (a touch that didn't turn the model) on phones.
  const pick = (e: { clientX: number; clientY: number; currentTarget: HTMLDivElement }, pinned: boolean) => {
    const stage = stageRef.current;
    if (!stage || !stage.pickables.length) { setTip(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, stage.camera);
    const hit = ray.intersectObjects(stage.pickables, false)[0];
    setTip(hit ? { x: e.clientX - rect.left, y: e.clientY - rect.top, text: hit.object.userData.label, pinned, w: rect.width } : null);
  };
  // 열기구: the view from the balloon's basket. Drag looks around, the wheel, a pinch or
  // −/+ zoom (the field of view, like binoculars); the button, 처음 or Esc steps out.
  const [balloonOn, setBalloonOn] = useState(false);
  const enterBalloon = () => {
    const st = stageRef.current;
    if (!st?.balloon || !st.balloon.group.visible || st.balloonView) return;
    const at = st.balloon.basket(new THREE.Vector3());
    // Facing the complex, looking down at it.
    const yaw = Math.atan2(st.center.z - at.z, st.center.x - at.x);
    const pitch = -Math.atan2(at.y - st.center.y, Math.hypot(st.center.x - at.x, st.center.z - at.z));
    st.balloonView = { yaw, pitch: Math.max(-1.45, Math.min(-0.15, pitch)), fov: 50, baseFov: st.camera.fov };
    st.controls.enabled = false; st.controls.autoRotate = false; spinRef.current = false; setSpin(false);
    st.intro = null; setTip(null); setBalloonOn(true); st.resume();
  };
  const leaveBalloon = () => {
    const st = stageRef.current;
    if (!st?.balloonView) return;
    st.camera.fov = st.balloonView.baseFov; st.camera.updateProjectionMatrix();
    st.balloonView = null;
    st.controls.enabled = true;
    st.frame();
    setBalloonOn(false); st.resume();
  };
  const zoomBalloon = (factor: number) => {
    const bv = stageRef.current?.balloonView;
    if (bv) bv.fov = THREE.MathUtils.clamp(bv.fov * factor, 6, 75);
  };
  const lookBalloon = (dx: number, dy: number) => {
    const bv = stageRef.current?.balloonView;
    if (!bv) return;
    // Drag moves the view like grabbing the scene; slower when zoomed in.
    const k = (bv.fov / 50) * 0.0045;
    bv.yaw += dx * k; bv.pitch = THREE.MathUtils.clamp(bv.pitch + dy * k, -1.5, 0.9);
  };
  useEffect(() => {
    if (!balloonOn) return;
    const host = hostRef.current;
    const wheel = (e: WheelEvent) => { e.preventDefault(); zoomBalloon(Math.exp(e.deltaY * 0.0012)); stageRef.current?.resume(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); leaveBalloon(); } };
    host?.addEventListener("wheel", wheel, { passive: false });
    // (on the window, capturing: ahead of the full-screen layer's Esc on the document)
    window.addEventListener("keydown", key, true);
    return () => { host?.removeEventListener("wheel", wheel); window.removeEventListener("keydown", key, true); };
  }, [balloonOn, big]);
  // A new complex, or the view going away: back on the ground.
  useEffect(() => { if (balloonOn) leaveBalloon(); }, [complexId]);
  const drag = useRef<{ x: number; y: number; pinch: number } | null>(null);
  // Keys, while the pointer is over the view or it is full screen: arrows turn and
  // tilt, +/- zoom, H back to the opening shot, T from above, R auto-rotation,
  // F full screen, B the balloon (not while typing, nor on the time slider).
  const hovering = useRef(false);
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (!(hovering.current || big) || e.ctrlKey || e.metaKey || e.altKey || !data?.found) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
    const k = e.key;
    const act = k === "ArrowLeft" ? "left" : k === "ArrowRight" ? "right" : k === "ArrowUp" ? "up" : k === "ArrowDown" ? "down"
      : k === "+" || k === "=" ? "in" : k === "-" || k === "_" ? "out" : k === "h" || k === "H" || k === "Home" ? "home" : k === "t" || k === "T" ? "top" : null;
    if (act) { e.preventDefault(); navigateView(act); return; }
    if (k === "r" || k === "R") { e.preventDefault(); setSpin(v => !v); stageRef.current?.resume(); return; }
    if ((k === "f" || k === "F") && !wide && !narrow) { e.preventDefault(); if (big) closeBig(); else openBig(); return; }
    if (k === "b" || k === "B") { e.preventDefault(); if (stageRef.current?.balloonView) leaveBalloon(); else enterBalloon(); }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const press = useRef<{ id: number; x: number; y: number; t: number; moved: boolean } | null>(null);
  const pointers = useRef(new Set<number>());
  const pinchSpan = () => { const ps = [...touchPoints.current.values()]; return ps.length >= 2 ? Math.hypot(ps[0][0] - ps[1][0], ps[0][1] - ps[1][1]) : 0; };
  const touchPoints = useRef(new Map<number, [number, number]>());
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) p.moved = true;
    if (stageRef.current?.balloonView) {
      if (touchPoints.current.has(e.pointerId)) touchPoints.current.set(e.pointerId, [e.clientX, e.clientY]);
      const d = drag.current;
      if (d && touchPoints.current.size >= 2) {
        const span = pinchSpan();
        if (d.pinch && span) zoomBalloon(d.pinch / span);
        d.pinch = span;
      } else if (d && (e.buttons || e.pointerType !== "mouse")) { lookBalloon(e.clientX - d.x, e.clientY - d.y); d.x = e.clientX; d.y = e.clientY; }
      stageRef.current.resume();
      return;
    }
    if (e.pointerType !== "mouse") return;
    if (e.buttons) { setTip(null); return; }
    if (!tip?.pinned) pick(e, false);
  };
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!(e.target instanceof HTMLCanvasElement)) return;
    pointers.current.add(e.pointerId);
    if (stageRef.current?.balloonView) {
      touchPoints.current.set(e.pointerId, [e.clientX, e.clientY]);
      drag.current = { x: e.clientX, y: e.clientY, pinch: pinchSpan() };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    const touch = e.pointerType !== "mouse";
    if (touch !== touchMode) setTouchMode(touch);
    press.current = pointers.current.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false } : null;
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    pointers.current.delete(e.pointerId);
    touchPoints.current.delete(e.pointerId);
    press.current = null;
    if (stageRef.current?.balloonView) { if (touchPoints.current.size === 0) drag.current = null; else if (drag.current) drag.current.pinch = pinchSpan(); return; }
    if (!p || p.id !== e.pointerId || pointers.current.size > 0 || p.moved) return;
    // A drag turned the model: whatever was pinned no longer points at its building.
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8 || performance.now() - p.t > 450) { setTip(null); return; }
    // A tap on the balloon: into its basket.
    const st = stageRef.current;
    if (st?.balloon?.group.visible) {
      const rect = e.currentTarget.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), st.camera);
      if (ray.intersectObjects(st.balloon.pickables, true).length) { enterBalloon(); return; }
    }
    // A second tap on the same spot soon after: fly to that building.
    const last = lastTap.current;
    lastTap.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    // (touch only: a mouse has its own double-click)
    if (e.pointerType !== "mouse" && last && performance.now() - last.t < 350 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 24) { lastTap.current = null; focusAt(e); return; }
    pick(e, true);
  };
  const lastTap = useRef<{ x: number; y: number; t: number } | null>(null);
  /** Fly to the building under a point (double-click or double-tap). */
  const focusAt = (e: { clientX: number; clientY: number; currentTarget: HTMLDivElement }) => {
    const st = stageRef.current;
    if (!st || !st.pickables.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), st.camera);
    const hit = ray.intersectObjects(st.pickables, false)[0];
    if (!hit) return;
    // Framed whole: the orbit on its middle, about three of its heights away.
    const box = new THREE.Box3().setFromObject(hit.object);
    const mid = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const tall = Math.min(size.y, 160), wide = Math.min(Math.max(size.x, size.z), 120);
    setTip(null);
    flyTo(new THREE.Vector3(hit.point.x, box.min.y + tall * 0.5, hit.point.z).lerp(mid.setY(box.min.y + tall * 0.5), 0.5), Math.max(tall, wide) * 2.4 + 20);
  };

  const notice = data?.found && complexId ? staleNotice(data, complexId) : null;
  const measured = data?.coverage ? data.coverage.with_height : 0;
  const total = data?.coverage ? data.coverage.buildings : 0;
  const phase = phaseLabel(sunAt(hour, undefined, center?.lat, center?.lon).elev, hour);
  function phaseCaption() { return `${formatHour(hour)} ${phase}${weather === "clear" ? "" : ` · ${weather === "rain" ? "비" : "눈"}`}`; }
  const sceneTitle = weather === "rain" ? `비 오는 ${phase}` : weather === "snow" ? `눈 내리는 ${phase}` : `${phase}의 단지 풍경`;
  const portal = (node: JSX.Element) => bigBase ? createPortal(node, document.body) : node;
  const dayTrack = useMemo(() => dayGradient(center?.lat, center?.lon), [center?.lat, center?.lon]);
  return (
    <>
    {bigBase && <div className="re-holo-slot" style={{ height: bigBase.h }} aria-hidden="true" />}
    {big && !narrow && createPortal(<div className="re-holo-resize-backdrop" aria-hidden="true" />, document.body)}
    {portal(<section ref={sectionRef} className={`re-holo${big ? " re-holo--expanded" : ""}${big && !narrow && bigSize ? " re-holo--resized" : ""}`}
      style={big && !narrow && bigSize ? { width: bigSize.w, height: bigSize.h } : undefined}
      role={big ? "dialog" : undefined} aria-modal={big || undefined} aria-label={big ? "단지 3D 뷰 전체화면" : "단지 3D 뷰"}>
      <header className="re-holo-head">
        <div>
          <small>{caption ?? "3D 단지뷰"}</small>
          <strong>{data?.name ?? complexName ?? "단지를 선택하세요"}</strong>
        </div>
        <div className="re-holo-tools">
          {big && !narrow && <button type="button" onClick={() => { resizeDrag.current = null; setBigSize(null); }}
            title="3D 뷰를 화면 전체 크기로 되돌리기">⤢ 화면 채우기</button>}
          <button type="button" aria-pressed={spin} onClick={() => setSpin(v => !v)} aria-label="자동 회전" title="360° 자동 회전">{spin ? "자동 ■" : "자동 ▶"}</button>
          {complexId && data?.found && (
            <button type="button" className="re-holo-save" onClick={() => void onSaveImage()} disabled={sharing} title="지금 3D 화면을 이미지(PNG)로 저장" aria-label="이미지 저장">
              <span aria-hidden="true">⤓</span><span className="re-holo-share-long">{sharing ? "저장 중…" : "이미지 저장"}</span>
            </button>
          )}
          {complexId && data?.found && (
            <button type="button" className="re-holo-share" onClick={() => void onShare()} title="이 3D 화면 링크를 카카오톡으로 공유 (지금 시간대·날씨 그대로)">
              <KakaoIcon /><span className="re-holo-share-long">카카오톡 공유</span><span className="re-holo-share-short">공유</span>
            </button>
          )}
          {!wide && !narrow && complexId && !big && (
            <button type="button" className="re-holo-big" onClick={openBig} title="전체화면으로 보기 (Esc로 닫기)">⤢ 전체화면</button>
          )}
        </div>
      </header>
      <div className="re-holo-stage" ref={hostRef} onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp}
        onPointerCancel={e => { pointers.current.delete(e.pointerId); press.current = null; }}
        onPointerEnter={() => { hovering.current = true; }}
        onDoubleClick={e => { if (!stageRef.current?.balloonView && e.target instanceof HTMLCanvasElement) focusAt(e); }}
        onPointerLeave={e => { hovering.current = false; if (e.pointerType === "mouse" && !tip?.pinned) setTip(null); }}>
        {data?.found && !loading && !notice && <div className="re-holo-scene-label" aria-hidden="true"><span>ARCHITECTURAL VIEW</span><strong>{sceneTitle}</strong></div>}
        {notice && <p className="re-holo-stale" role="note">{notice}</p>}
        {failed3d && <p className="re-holo-msg">3D 화면을 불러오지 못했습니다. 브라우저 설정에서 하드웨어 가속이 켜져 있는지 확인해 주세요.{" "}
          <button type="button" className="re-holo-retry" onClick={() => location.reload()}>다시 시도</button></p>}
        {loading && <div className="re-holo-scan" role="status"><span />{dataTry ? `응답이 늦어 다시 요청하는 중입니다 (${dataTry + 1}/3)…` : slowData ? "외부 건물 자료 응답을 기다리고 있습니다. 첫 조회는 더 걸릴 수 있습니다." : "건물 윤곽 불러오는 중…"}</div>}
        {!loading && preparing && <div className="re-holo-scan" role="status"><span />장면의 조명과 재질을 준비하고 있습니다…</div>}
        {!loading && error && <p className="re-holo-msg" role="status">{error}{" "}
          <button type="button" className="re-holo-retry" onClick={() => setReloadKey(k => k + 1)}>다시 시도</button></p>}
        {balloonOn && <div className="re-holo-balloon-hint" role="status"><b>🎈 열기구에서 내려다보는 중</b><span>{touchMode ? "드래그로 둘러보기 · 두 손가락으로 확대·축소" : "드래그로 둘러보기 · 휠로 확대·축소 · Esc로 내리기"}</span></div>}
        {tip && <div className={`re-holo-tip${tip.x > tip.w * 0.55 ? " is-left" : ""}${tip.pinned ? " is-pinned" : ""}`} style={{ left: tip.x, top: tip.y }}
          role="status">{tip.text}</div>}
      </div>
      {data?.found && !failed3d && <div className="re-holo-env">
        <label className="re-holo-time">
          <span className="re-holo-time-read"><b>{formatHour(hour)}</b>{phase}
            <button type="button" className="re-holo-now" onClick={e => { e.preventDefault(); setHour(Math.round(hourNow() * 4) / 4); }} title="지금 시각으로">지금</button></span>
          <input type="range" min={0} max={24} step={0.25} value={hour} aria-label="시간대"
            aria-valuetext={`${formatHour(hour)} ${phase}`} style={{ background: dayTrack }}
            onChange={e => setHour(Number(e.currentTarget.value))} />
          <span className="re-holo-ticks" aria-hidden="true"><i>0</i><i>6</i><i>12</i><i>18</i><i>24</i></span>
        </label>
        <div className="re-holo-weather" role="radiogroup" aria-label="날씨">
          {WEATHER_ORDER.map(w => (
            <button key={w} type="button" role="radio" aria-checked={weather === w} onClick={() => setWeather(w)} title={WEATHER_LABEL[w]}>
              <i aria-hidden="true">{WEATHER_ICON[w]}</i><span>{WEATHER_LABEL[w]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="re-holo-balloon-btn" aria-pressed={balloonOn} onClick={() => (balloonOn ? leaveBalloon() : enterBalloon())}
          title={balloonOn ? "열기구에서 내려 원래 시점으로" : "열기구에 타고 단지를 내려다보기 (열기구를 눌러도 됩니다)"}>
          <i aria-hidden="true">🎈</i><span>{balloonOn ? "내리기" : "열기구"}</span>
        </button>
      </div>}
      {data?.found && !failed3d && <nav className="re-holo-navigation" aria-label="3D 화면 조작">
        {/* One row of views and steps; the gestures do the rest. A mouse also gets
         * turn buttons (a finger turns by dragging anyway). */}
        <div className="re-holo-nav-row">
          <button type="button" onClick={() => navigateView("home")} title="처음 시점으로">⟲ 처음</button>
          <button type="button" onClick={() => navigateView("top")} title="위에서 내려다보기">⤓ 위에서</button>
          <button type="button" aria-label="3D 축소" title="축소" onClick={() => navigateView("out")}>−</button>
          <button type="button" aria-label="3D 확대" title="확대" onClick={() => navigateView("in")}>+</button>
          {!touchMode && <>
            <button type="button" aria-label="3D 왼쪽 회전" title="왼쪽으로 돌리기" onClick={() => navigateView("left")}>↶</button>
            <button type="button" aria-label="3D 오른쪽 회전" title="오른쪽으로 돌리기" onClick={() => navigateView("right")}>↷</button>
          </>}
        </div>
        <p>{touchMode ? "한 손가락 회전 · 두 손가락 이동·확대 · 두 번 탭: 건물로" : "드래그 회전 · 우클릭 이동 · 휠 확대 · 더블클릭: 건물로 · ←→ +− H B"}</p>
      </nav>}
      <footer className="re-holo-foot">
        <a className="re-holo-credit" href="/licenses/tidewater-MIT.txt" target="_blank" rel="noreferrer" title="렌더링 엔진 MIT 라이선스">MIT</a>
        {data?.found ? (
          <>
            <span>건물 {total}개 · 층수·높이 확인 {measured}개{total > measured ? ` · ${data.source === "vworld" ? "층수 미등록 부대시설" : "높이 추정"} ${total - measured}개` : ""}</span>
            <span>{data.source === "vworld" ? "건물 윤곽·높이: " : "건물 윤곽: "}{data.attribution}. 도로: 국가기본도 도로중심선 · 지형: {terrainSource ?? "평지(지형 자료 없음)"}{data.vworld_key ? " · 토지이용: 연속지적도 지목" : ""}. 외벽·창호·조경·가로수·보행자·차량은 표현용</span>
          </>
        ) : <span>{touchMode ? "한 손가락으로 돌리고 두 손가락으로 확대·이동, 건물을 탭하면 동·층수를 봅니다." : "드래그로 회전, 휠로 커서 쪽 확대, 우클릭 드래그로 이동합니다. 지도에서 단지를 누르면 바뀝니다."}</span>}
      </footer>
      {big && <button type="button" className="re-holo-wide-close" onClick={closeBig} aria-label="전체화면 닫기" title="닫기 (Esc)">×</button>}
      {big && !narrow && <button type="button" className="re-holo-resize" aria-label="3D 뷰 크기 조절"
        title="드래그로 화면 크기 조절 · 방향키로 조절 · 두 번 클릭으로 화면 채우기"
        onPointerDown={e => {
          if (e.button !== 0) return;
          e.preventDefault(); e.stopPropagation();
          e.currentTarget.focus();
          const rect = sectionRef.current!.getBoundingClientRect();
          resizeDrag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, w: rect.width, h: rect.height };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={e => {
          const drag = resizeDrag.current;
          if (!drag || drag.id !== e.pointerId) return;
          // The panel stays centered, so each corner moves half the size change.
          setBigSize(fitBigSize(drag.w + 2 * (e.clientX - drag.x), drag.h + 2 * (e.clientY - drag.y)));
        }}
        onPointerUp={e => {
          if (resizeDrag.current?.id !== e.pointerId) return;
          resizeDrag.current = null;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => { resizeDrag.current = null; }}
        onLostPointerCapture={() => { resizeDrag.current = null; }}
        onDoubleClick={() => setBigSize(null)}
        onKeyDown={e => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
          e.preventDefault(); e.stopPropagation();
          const rect = sectionRef.current!.getBoundingClientRect(), step = e.shiftKey ? 80 : 20;
          setBigSize(fitBigSize(rect.width + (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0),
            rect.height + (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0)));
        }}><span aria-hidden="true">◢</span></button>}
    </section>)}
    {shareStage !== "idle" && (
      <OnScreen>
        <div className="kospi-map-share-backdrop re-holo-share-layer" onClick={() => setShareStage("idle")} />
        <div className="kospi-map-share-popover is-centered re-holo-share-layer" role="status">
          <button type="button" className="kospi-map-share-popover-close" onClick={() => setShareStage("idle")} aria-label="닫기">×</button>
          <p>3D 화면 링크가 복사되었습니다. 카카오톡 채팅창에 Ctrl+V로 붙여넣어 주세요.</p>
        </div>
      </OnScreen>
    )}
    </>
  );
}
