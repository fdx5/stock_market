import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMediaQuery } from "../useMediaQuery";
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
import { vworldBuildings, vworldParcels, vworldRoads } from "./vworldBuildings";
import {
  CONTEXT_FLOOR_M, ContextStyle, contextStyle, sharedContextMaterial, warmMaterials, dirFrom, FinishShader, FLOOR_M, GROUND_M, inRing, Look, LOOKS, mixLook,
  moonInSky, paintGroundSteps, waterCovered, Planting, runSliced, facadeSteps, plinthSteps, sharedContextTexturesSliced, paletteFor, patchMaterial, patchSky, rng, shared, starField, Tod, TOD_LABEL, TOD_ORDER, todNow,
} from "./complexScene";
import "../desk2/realestate-hologram.css";
import type { ComplexRenderer } from "./tidewater/ComplexRenderer";
import { facadeRelief } from "./tidewater/facadeRelief";
import { loadBuildings, saveBuildings } from "./buildingStore";
import { buildPlants, preloadPlants } from "./scenePlants";
import { buildLamps, buildTraffic, stitchedRoads } from "./sceneStreet";
import { FLAT, loadTerrain, preconnectTerrain, Terrain } from "./sceneTerrain";
import { buildSidewalks, ringIndex, sidewalkRuns, streetTrees } from "./sceneSidewalk";
import { buildWalkers, ringPaths, sidewalkPaths, WalkPath } from "./sceneWalkers";
import { buildWater } from "./sceneWater";

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
function groundGeometry(T: number, G: number, terrain: Terrain, segs: number) {
  const geo = new THREE.PlaneGeometry(2, 2, segs, segs);
  const p = geo.getAttribute("position") as THREE.BufferAttribute, uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  const a = 0.84;
  const f = (u: number) => { const s = Math.sign(u), v = Math.abs(u); return s * (v <= a ? (v / a) * T : T + (G - T) * ((v - a) / (1 - a)) ** 2); };
  for (let i = 0; i < p.count; i++) {
    const x = f(p.getX(i)), y = f(p.getY(i));
    p.setXYZ(i, x, y, terrain.at(x, y));
    uv.setXY(i, (x + T) / (2 * T), (y + T) / (2 * T));
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
  sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; sky: Sky; stars: THREE.Points;
  reflector: Reflector | null; reflStrength: { value: number };
  /** Planar reflection only on level ground (the mirror is one plane). */
  reflectOn: boolean;
  refreshEnv: () => void;
  look: Look; fade: { from: Look; to: Look; t0: number } | null;
  lit: { windows: THREE.MeshStandardMaterial[]; crowns: THREE.MeshStandardMaterial[]; ground: THREE.MeshStandardMaterial[] };
  /** Per-frame work of the current model (traffic), and what follows the look (lamps). */
  tick: ((dt: number) => void)[]; onLook: ((l: Look) => void)[];
  ground: THREE.Mesh | null; model: THREE.Group | null;
  pickables: THREE.Mesh[];
  intro: { from: THREE.Vector3; to: THREE.Vector3; t0: number } | null;
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
  frame: () => void;
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

/** The real relief under a result, in at most 2.5 s (tiles are cached after the first
 * complex); level ground when it can't be had. Covers the painted ground square. */
async function terrainFor(res: RealEstateBuildingsResponse): Promise<Terrain> {
  if (!res.center) return FLAT;
  const ext = res.buildings.flatMap(b => b.rings[0]).reduce((m, [x, y]) => Math.max(m, Math.hypot(x, y)), 0);
  const radius = Math.min(1400, (ext + 240) * 1.3 + 80);
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
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });
}

const ease = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

export default function ComplexHologram({ complexId, complexName, caption, wide = false, initialTod, paused = false }: {
  complexId: string | null; complexName?: string; caption?: string;
  /** Covered by something the reader is using (the detail popup): stop drawing, and do
   * any loading only in the browser's idle time. */
  paused?: boolean;
  /** Already the large layer: no "크게 보기" button of its own. */
  wide?: boolean; initialTod?: Tod;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const [data, setData] = useState<RealEstateBuildingsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [slowData, setSlowData] = useState(false);
  const [touchMode, setTouchMode] = useState(() => window.matchMedia?.("(any-pointer: coarse)").matches || navigator.maxTouchPoints > 0);
  const [navMode, setNavMode] = useState<"pan" | "rotate">("rotate");
  const [spin, setSpin] = useState(() => !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const [tod, setTod] = useState<Tod>(() => {
    const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("tod") : null;
    return initialTod ?? (q && q in LOOKS ? (q as Tod) : todNow());
  });
  // 크게 보기: a layer over the page at 3x the panel's height (scaled down only as far
  // as the window requires) and 30 % wider than that proportion.
  const [bigBase, setBigBase] = useState<{ w: number; h: number } | null>(null);
  const big = !!bigBase;
  const [, setViewportTick] = useState(0);
  const openBig = () => {
    const r = sectionRef.current?.getBoundingClientRect();
    if (r?.width && r.height) setBigBase({ w: r.width, h: r.height });
  };
  const closeBig = useCallback(() => setBigBase(null), []);
  const [tip, setTip] = useState<{ x: number; y: number; text: string; pinned: boolean; w: number } | null>(null);
  const [failed3d, setFailed3d] = useState(false);
  const [terrainSource, setTerrainSource] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  // Button set follows the page layout (the desktop rail from 981 px, as the map page
  // decides), not the pointer: an iPad in the desktop layout gets the desktop controls.
  const narrow = useMediaQuery("(max-width: 980px)");

  // One renderer for the panel's lifetime; each complex only swaps the model.
  useEffect(() => {
    if (!hostRef.current) return;
    let host: HTMLDivElement = hostRef.current;
    // Phones and small tablets: no planar reflection or AO, fewer trees, lighter shadows.
    const hq = !window.matchMedia?.("(pointer: coarse)").matches && Math.min(screen.width, screen.height) >= 700;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
    } catch {
      setFailed3d(true);
      return;
    }
    // Start at the display's ratio; with frame time to spare, supersample a desktop
    // panel toward 2x (sharper facades; the native path has no MSAA). Never climb
    // back past a level that already dropped frames.
    const dpr = window.devicePixelRatio || 1;
    let ratio = Math.min(dpr, hq ? 2 : 1.6);
    let maxRatio = hq ? Math.min(2, Math.max(dpr, 1.5)) : ratio;
    renderer.setPixelRatio(ratio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(renderer.domElement);
    let native: ComplexRenderer | null = null;
    let disposed = false;
    // The native WebGPU path only on implementations as current as the one it is
    // tested on (pointer_composite_access is a good marker: older Tint builds compile
    // the shaders but may draw nothing); everything else, and ?renderer=webgl, uses WebGL.
    const gpu = (navigator as Navigator & { gpu?: { wgslLanguageFeatures?: { has(name: string): boolean } } }).gpu;
    const forceWebgl = new URLSearchParams(location.search).get("renderer") === "webgl";
    let nativePending = !forceWebgl && !!gpu && !!gpu.wgslLanguageFeatures?.has?.("pointer_composite_access");
    let wasPreparing = nativePending;
    setPreparing(nativePending);
    // Do not compile both renderers on first load: warm native pipelines behind
    // the loading state, and initialize WebGL lighting only if native fails.
    if (nativePending) {
      import("./tidewater/ComplexRenderer").then(m => m.ComplexRenderer.create(host)).then(view => {
        if (disposed) { view.dispose(); return; }
        if (view.canvas.parentElement !== host) host.appendChild(view.canvas);
        native = view;
        nativePending = false;
        resize();
      }).catch(err => {
        if (disposed) return;
        nativePending = false;
        refreshEnv();
        console.info("[3D] Using WebGL compatibility renderer:", err);
      });
    }

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2("#b9cadb", 0.001);
    const camera = new THREE.PerspectiveCamera(36, 1, 1, 8000);
    camera.position.set(260, 160, 260);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.rotateSpeed = 0.65;
    controls.panSpeed = 0.85;
    // A wheel notch moves ~22 % of the distance (0.95^4.8): overview to a person on the
    // sidewalk in about twenty notches. Pinch uses zoomSpeed as an exponent, so touch
    // keeps a gentle 1 (set per input below).
    controls.zoomSpeed = WHEEL_ZOOM;
    renderer.domElement.addEventListener("wheel", () => { controls.zoomSpeed = WHEEL_ZOOM; }, { capture: true, passive: true });
    renderer.domElement.addEventListener("pointerdown", e => { controls.zoomSpeed = e.pointerType === "touch" ? 1 : WHEEL_ZOOM; }, { capture: true });
    controls.touches.ONE = navMode === "pan" ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    controls.autoRotate = spinRef.current;
    controls.autoRotateSpeed = 0.55;
    controls.minPolarAngle = 0.12;
    controls.maxPolarAngle = Math.PI / 2 - 0.035;
    // Zoom toward whatever is under the cursor (or between the pinching fingers),
    // anywhere in view, down to a person on the sidewalk; pan freely.
    controls.zoomToCursor = true;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.addEventListener("change", () => {
      const t = controls.target, st = stageRef.current;
      if (!st) return;
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
    void warmMaterials(warm, () => nextSlice(true), () => !disposed);
    const stars = starField(3000);
    const moon = moonInSky();
    scene.add(moon.group);
    scene.add(stars);

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
      renderer, scene, camera, controls, composer, bloom, finish, sun, hemi, sky, stars, reflector, reflStrength, reflectOn: false, refreshEnv,
      look: LOOKS.day, fade: null, lit: { windows: [], crowns: [], ground: [] }, tick: [], onLook: [],
      ground: null, model: null, pickables: [], intro: null,
      now: 0, top: 50, dist: 300, center: new THREE.Vector3(), floor: 0, nearMax: 0.5, hq, disposeModel: () => {}, resume: () => {}, unshown: false, onShown: [], attach: () => {}, frame: () => {},
    };
    stageRef.current = stage;
    // Dev only: lets the render checks place the camera (never in a production build).
    if (import.meta.env.DEV) (window as unknown as { __complexStage?: Stage }).__complexStage = stage;

    let W = 1, H = 1;
    const resize = () => {
      W = host.clientWidth; H = host.clientHeight;
      if (!W || !H) return;
      renderer.setPixelRatio(ratio);
      renderer.setSize(W, H, false);
      composer.setPixelRatio(ratio);
      composer.setSize(W, H);
      bloom.setSize(W * ratio / 2, H * ratio / 2);
      reflector?.getRenderTarget().setSize(Math.round(W * ratio * 0.5), Math.round(H * ratio * 0.5));
      finish.uniforms.uAspect.value = W / H;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      native?.setSize(W, H, ratio);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    // Exploring a building is deliberate: never restart rotation behind the user.
    const onStart = () => {
      controls.autoRotate = false; spinRef.current = false; setSpin(false);
      stage.intro = null; setTip(null);
    };
    controls.addEventListener("start", onStart);

    const keyDir = new THREE.Vector3(), sunDir = new THREE.Vector3();
    let envFrame = 0, nativeWaitSince = 0;
    // Dynamic resolution with hysteresis: target 60 fps, never below 0.75x.
    let slow = 0, quick = 0, last = performance.now();
    let inView = true, sampleStart = last, sampleFrames = 0;
    const t0 = performance.now();
    let raf = 0;
    // Off screen the loop sleeps, except while shaders and a new model are still being
    // prepared: that work then finishes before the panel scrolls into view.
    // (A model still being built in slices isn't in the scene yet: nothing to warm.)
    const warming = () => (stage.unshown && !!stage.model) || nativePending || (!!native && !native.ready);
    const loop = () => {
      if (document.hidden || ((!inView || pausedRef.current) && !warming())) return;
      raf = requestAnimationFrame(loop);
      const nowMs = performance.now();
      const dt = nowMs - last;
      last = nowMs;
      if (dt > 24 && dt < 250) { slow++; quick = 0; } else if (dt < 18) { quick++; slow = 0; }
      if (dt >= 18 && dt <= 24) { slow = Math.max(0, slow - 1); quick = 0; }
      if (slow > 40 && ratio > 0.75) { ratio = Math.max(0.75, ratio - 0.25); maxRatio = ratio; slow = 0; resize(); }
      else if (quick > 240 && ratio < maxRatio) { ratio = Math.min(maxRatio, ratio + 0.25); quick = 0; resize(); }

      const t = (nowMs - t0) / 1000;
      stage.now = t;
      shared.uTime.value = t;
      sky.material.uniforms.time.value = t;
      if (stage.intro) {
        const k = ease((t - stage.intro.t0) / 3.2);
        camera.position.lerpVectors(stage.intro.from, stage.intro.to, k);
        if (k >= 1) stage.intro = null;
      }
      if (stage.fade) {
        const k = ease((t - stage.fade.t0) / 2.2);
        applyLook(mixLook(stage.fade.from, stage.fade.to, k), k >= 1 || ++envFrame % 8 === 0);
        if (k >= 1) stage.fade = null;
      }
      for (const f of stage.tick) f(dt / 1000);
      controls.update();
      // Near plane follows the zoom: close enough to stand beside a person, and no
      // deeper than needed from afar (depth precision on distant roofs).
      const near = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * 0.04, 0.05, stage.nearMax);
      if (Math.abs(near - camera.near) > camera.near * 0.15) { camera.near = near; camera.updateProjectionMatrix(); }
      stars.position.copy(camera.position);
      moon.update(camera);


      if (native) {
        try { native.render(scene, camera, stage.look, t); }
        catch (err) { console.warn("[3D] WebGPU fallback:", err); native.failed = true; }
        // Watchdog: a built model that WebGPU hasn't put on screen in 8 s goes to WebGL.
        if (!native.shown && stage.model) {
          nativeWaitSince ||= nowMs;
          if (nowMs - nativeWaitSince > 8000) { console.info("[3D] WebGPU never showed the scene; using WebGL"); native.failed = true; }
        } else nativeWaitSince = 0;
        if (native.failed) { native.dispose(); native = null; refreshEnv(); }
      }
      const isPreparing = nativePending || (!!native && !native.shown);
      if (wasPreparing !== isPreparing) { setPreparing(isPreparing); wasPreparing = isPreparing; }
      host.dataset.renderer = native?.shown ? "tidewater-webgpu" : isPreparing ? "preparing" : "webgl";
      if (++sampleFrames >= 60) {
        host.dataset.fps = (sampleFrames * 1000 / (nowMs - sampleStart)).toFixed(1);
        host.dataset.draws = String(native?.ready ? native.stats.draws : renderer.info.render.calls);
        host.dataset.pixelRatio = ratio.toFixed(2);
        sampleFrames = 0; sampleStart = nowMs;
      }
      if (!native && !nativePending && reflector && stage.ground && stage.reflectOn) {
        stage.ground.visible = false;
        (reflector.onBeforeRender as (r: THREE.WebGLRenderer, s: THREE.Scene, c: THREE.Camera) => void)(renderer, scene, camera);
        stage.ground.visible = true;
      }
      if (!native && !nativePending) composer.render();
      if (stage.unshown && stage.model && (native?.ready || (!native && !nativePending))) {
        stage.unshown = false;
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
      (stars.material as THREE.PointsMaterial).opacity = l.stars;
      moon.setLevel(l.stars);
      shared.uCloud.value = l.cloudShade;
      reflStrength.value = l.reflect;
      bloom.strength = l.bloom;
      bloom.threshold = l.bloomAt;
      if (env) refreshEnv();
    };
    stage.refreshEnv = () => applyLook(stage.look, true);
    applyLookRef.current = applyLook;
    applyLook(LOOKS[todRef.current], true);

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
    stage.resume = () => { cancelAnimationFrame(raf); last = performance.now(); loop(); };
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
      controls.dispose();
      composer.dispose();
      target.dispose();
      gtao?.dispose();
      reflector?.dispose();
      envRT?.dispose();
      pmrem.dispose();
      sky.geometry.dispose();
      sky.material.dispose();
      stars.geometry.dispose();
      moon.dispose();
      (stars.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
      stageRef.current = null;
      applyLookRef.current = null;
    };
  }, []);

  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
    if (!paused) stageRef.current?.resume();
  }, [paused]);

  const spinRef = useRef(spin);
  useEffect(() => {
    spinRef.current = spin;
    if (stageRef.current) stageRef.current.controls.autoRotate = spin;
  }, [spin]);

  useEffect(() => {
    const controls = stageRef.current?.controls;
    if (!controls) return;
    controls.touches.ONE = navMode === "pan" ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    controls.mouseButtons.LEFT = navMode === "pan" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  }, [navMode, touchMode]);

  const navigateView = (action: "in" | "out" | "left" | "right" | "home" | "top") => {
    const st = stageRef.current;
    if (!st) return;
    st.controls.autoRotate = false; spinRef.current = false; setSpin(false); setTip(null);
    st.intro = null;
    // Consume residual drag inertia before applying an exact button command.
    st.controls.enableDamping = false; st.controls.update(); st.controls.enableDamping = true;
    if (action === "home") st.frame();
    else {
      const offset = st.camera.position.clone().sub(st.controls.target);
      if (action === "in" || action === "out") {
        offset.setLength(THREE.MathUtils.clamp(offset.length() * (action === "in" ? 0.55 : 1.8), st.controls.minDistance, st.controls.maxDistance));
      } else {
        const sphere = new THREE.Spherical().setFromVector3(offset);
        if (action === "top") sphere.phi = 0.18;
        else sphere.theta += (action === "left" ? -1 : 1) * Math.PI / 8;
        offset.setFromSpherical(sphere);
      }
      st.camera.position.copy(st.controls.target).add(offset);
      st.controls.update();
    }
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
    const inert: [HTMLElement, boolean][] = [];
    for (let node: HTMLElement | null = section; node?.parentElement; node = node.parentElement) {
      for (const sibling of Array.from(node.parentElement.children)) if (sibling !== node && sibling instanceof HTMLElement) {
        inert.push([sibling, sibling.inert]); sibling.inert = true;
      }
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeBig(); }
      if (event.key === 'Tab') {
        const items = Array.from(section.querySelectorAll<HTMLElement>('button,a[href]'));
        const i = items.indexOf(document.activeElement as HTMLElement);
        event.preventDefault(); items[(i + (event.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
      }
    };
    // The page behind is inert; a press on it (the dimmed backdrop) closes the layer.
    const outside = (event: PointerEvent) => { if (!section.contains(event.target as Node)) closeBig(); };
    const refit = () => setViewportTick(n => n + 1);
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', refit);
    return () => {
      document.body.style.overflow = overflow;
      inert.forEach(([node, value]) => { node.inert = value; });
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', refit);
      if (previous?.isConnected) previous.focus();
    };
  }, [big, closeBig]);

  const todRef = useRef(tod);
  const terrainRef = useRef<Terrain>(FLAT);
  const applyLookRef = useRef<((l: Look, env: boolean) => void) | null>(null);
  useEffect(() => {
    const st = stageRef.current;
    if (!st || todRef.current === tod) return;
    todRef.current = tod;
    st.fade = { from: st.look, to: LOOKS[tod], t0: st.now };
  }, [tod]);

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
    if (hostRef.current) { delete hostRef.current.dataset.shownAt; hostRef.current.dataset.selectAt = started.toFixed(0); }
    const slowTimer = window.setTimeout(() => { if (live) setSlowData(true); }, 3000);
    setError("");
    (async () => {
      const cached = buildingCache.get(complexId);
      if (cached && Date.now() - cached.at < 300000) return cached.data;
      const kept = await loadBuildings(complexId);
      if (kept) return kept;
      const peek = await api.realEstateBuildings(complexId, ctl.signal, true);
      if (peek.found) return withRoads(peek);
      // Start independent suppliers together: a slow JSONP endpoint must not
      // delay a server result that is already available (and vice versa).
      const fallback = api.realEstateBuildings(complexId, ctl.signal);
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
    })()
      // Roads and relief together: both only need the result's centre.
      .then(async res => {
        const t0 = performance.now();
        const [full, ground] = await Promise.all([res.found && !res.roads ? withRoads(res) : res,
          res.found ? terrainFor(res).then(t => { if (hostRef.current) hostRef.current.dataset.terrainMs = (performance.now() - t0).toFixed(0); return t; }) : FLAT]);
        if (hostRef.current) hostRef.current.dataset.dataMs = (t0 - started).toFixed(0);
        terrainRef.current = ground;
        if (live) setTerrainSource(ground.source);
        return full;
      })
      .then(res => {
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
  }, [complexId]);

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
      if (force || performance.now() - sliceStart > (pausedRef.current ? 10 : 30)) {
        await nextSlice(pausedRef.current);
        sliceStart = performance.now();
      }
      return alive;
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
      const tex = await runSliced(facadeSteps(palette, s), pace);
      if (!tex) return;
      Object.values(tex).forEach(keep);
      const m = keep(new THREE.MeshPhysicalMaterial({
        map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.9, 0.9),
        roughnessMap: tex.rmMap, metalnessMap: tex.rmMap, roughness: 1, metalness: 1,
        emissiveMap: tex.emissiveMap, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0,
        clearcoat: 0.08, clearcoatRoughness: 0.6,
      }));
      patchMaterial(m, { glass: true });
      lit.windows.push(m);
      walls.push(m);
    }
    if (!await pace(true)) return;
    const roof = keep(new THREE.MeshStandardMaterial({ color: "#6f8174", roughness: 0.93 }));
    const crown = keep(new THREE.MeshStandardMaterial({ color: palette.accent, roughness: 0.4, metalness: 0.45, emissive: palette.accent, emissiveIntensity: 0 }));
    lit.crowns.push(crown);
    const low = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(palette.wall).lerp(new THREE.Color(palette.wall2), 0.45), roughness: 0.75 }));
    // Low-rise facilities (community centre, shops): the shop facade in the complex's
    // colour, drawn with the neighbourhood's shop material (one pipeline fewer).
    const lowTint = new THREE.Color(palette.wall).lerp(new THREE.Color("#ffffff"), 0.2);
    // The towers' own finish, a step above the neighbourhood: a honed granite base
    // (1–2층), end walls (측벽) in the complex's second colour with its accent stripe.
    const stoneTex = await runSliced(plinthSteps(seed + 13, "#" + new THREE.Color(palette.wall2).lerp(new THREE.Color("#8d8a84"), 0.55).getHexString()), pace);
    if (!stoneTex) return;
    Object.values(stoneTex).forEach(keep);
    const stone = keep(new THREE.MeshPhysicalMaterial({
      map: stoneTex.map, normalMap: stoneTex.normalMap, normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: stoneTex.rmMap, roughness: 1, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.35,
    }));
    // Plain painted trim (end walls, their accent stripe, the roof core): one material,
    // colour per vertex.
    const trim = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 }));
    const gableC = new THREE.Color(palette.wall2).lerp(new THREE.Color(palette.wall), 0.25), stripeC = new THREE.Color(palette.accent);
    const plantC = new THREE.Color(palette.wall2).lerp(new THREE.Color("#9a9a96"), 0.5);
    const tinted = (g: THREE.BufferGeometry, c: THREE.Color) => {
      const n = g.getAttribute("position").count, col = new Float32Array(n * 3);
      for (let j = 0; j < n; j++) { col[j * 3] = c.r; col[j * 3 + 1] = c.g; col[j * 3 + 2] = c.b; }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      return g;
    };
    [roof, crown, low, stone, trim].forEach(m => patchMaterial(m));
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
    data.buildings.forEach((b, i) => {
      // Register entries with neither height nor floors and a small footprint are guard
      // posts and ramp covers: drawn as guessed blocks they read as stray objects.
      if (b.height_source === "estimated" && footArea(b.rings[0]) < 300) return;
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
    });
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
    const reach = ext + 240;
    const tints = ["#f1ede4", "#e4e1da", "#d9d4ca", "#c9b8a4", "#b88f78", "#a9b3bb", "#e8e3d3", "#cfc9bd"];
    const styles: ContextStyle[] = ["villa", "shop", "office", "apt"];
    const parapets: THREE.Matrix4[] = [];
    const pm = new THREE.Object3D();
    const neighbours = data.context.filter(b => b.rings[0].some(([x, y]) => Math.hypot(x, y) <= reach));
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
    if (!await pace(true)) return;
    const plan = await runSliced(paintGroundSteps(data, T, stage.hq ? 2048 : 1024, seed), pace);
    if (!plan) return;
    if (!await pace(true)) return;
    [plan.color, plan.rough].forEach(keep);
    const G = dist * 12;
    const groundGeo = keep(groundGeometry(T, G, terrain, stage.hq ? 320 : 200));
    if (!await pace(true)) return;
    [plan.glow].forEach(keep);
    const groundMat = keep(new THREE.MeshStandardMaterial({
      map: plan.color, roughnessMap: plan.rough, roughness: 1, metalness: 0,
      emissiveMap: plan.glow, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0,
    }));
    lit.ground.push(groundMat);
    // Beyond the surveyed area the ground is featureless: it fades into the horizon haze.
    groundMat.userData.edgeFade = true;
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
    preloadPlants();
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
        if (performance.now() - sliceAt > 12) { await nextSlice(pausedRef.current); sliceAt = performance.now(); }
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
    afterShown(() => void nextSlice(pausedRef.current).then(() => {
      if (!alive) return;
      const footprints = [...data.buildings, ...neighbours].map(b => b.rings[0]);
      const runs = sidewalkRuns(roads, footprints);
      if (import.meta.env.DEV) (stage as unknown as { runs: unknown }).runs = runs;
      if (import.meta.env.DEV) (stage as unknown as { data: unknown }).data = data;
      const street = streetTrees(runs, plan.lamps);
      const walks = buildSidewalks(runs, terrain, street.map(([x, y]) => [x, y] as [number, number]));
      decor.add(walks.group);
      disposables.push(walks);
      // Land use (연속지적도 지목) arrives after the first frame: the ground is repainted in
      // place, parks and forest get their trees, and the parcels are kept with the complex.
      // People: on the sidewalks, the complex's perimeter walk and round its towers
      // now; on the alleys (도로 parcels) and park edges once the parcels are in.
      const inFootprint = ringIndex(footprints);
      const blocked = (x: number, y: number) => Math.abs(x) > T || Math.abs(y) > T || inFootprint(x, y);
      const crowd = (paths: WalkPath[], salt: number, spacing: number, cap: number) => {
        const walkers = buildWalkers(paths, terrain, seed + salt, spacing, cap);
        if (!walkers) return;
        decor.add(walkers.group);
        if (import.meta.env.DEV) ((stage as unknown as { walkers: unknown[] }).walkers ??= []).push(...walkers.group.userData.walkers);
        disposables.push(walkers);
        tick.push(dt => walkers.update(dt, stage.camera));
      };
      crowd([...sidewalkPaths(runs), ...ringPaths(data.site, 2.4, blocked, 0.5), ...ringPaths(data.buildings.filter(b => b.floors >= 5).map(b => b.rings[0]), -3.2, blocked, 0.45)],
        0, 6, stage.hq ? 650 : 200);
      // Land use (연속지적도 지목) arrives after the first frame: the ground is repainted in
      // place, parks and forest get their trees, water its surface, alleys their people;
      // the parcels are kept with the complex.
      void landUse().then(planting => {
        if (!alive) return;
        planting.street = street;
        const parcels = data.parcels ?? [];
        const water = buildWater(parcels, waterCovered(data), terrain);
        if (water) { decor.add(water.mesh); disposables.push(water); }
        void nextSlice(pausedRef.current).then(() => {
          if (!alive) return;
          crowd([...ringPaths(parcels.filter(p => p.kind === "도").map(p => p.ring), 1.1, blocked, 0.4, 12),
            ...ringPaths(parcels.filter(p => p.kind === "공" || p.kind === "원" || p.kind === "체").map(p => p.ring), 2.2, blocked, 0.5)],
          1, 9, stage.hq ? 700 : 220);
        });
        return buildPlants(planting, seed, terrain).then(plants => {
          if (!plants) return;
          if (!alive) { plants.dispose(); return; }
          decor.add(plants.mesh);
          disposables.push(plants);
        });
      }).catch(err => console.info("[3D] Plants unavailable:", err));
    }));
    // Street lamps on the surveyed roads (lit from dusk), and traffic both ways.
    const lamps = buildLamps(plan.lamps, terrain);
    afterShown(() => decor.add(lamps.group));
    disposables.push(lamps);
    const onLook = [(l: Look) => lamps.setLevel(l.lamps)];
    // Traffic (its vehicle kit decodes on first use) waits for the first frame and idle time.
    afterShown(() => void nextSlice(pausedRef.current).then(() => (alive ? buildTraffic(roads, seed, stage.hq, terrain) : null)).then(traffic => {
      if (!traffic) return;
      if (!alive) { traffic.dispose(); return; }
      decor.add(traffic.group);
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
      // crowns in the narrow map rail. Keep a little sky above the actual roof.
      const viewDir = new THREE.Vector3(0.74, 0.22, 0.74).normalize();
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), viewDir).normalize();
      const up = new THREE.Vector3().crossVectors(viewDir, right);
      const tanV = Math.tan(THREE.MathUtils.degToRad(stage.camera.fov / 2));
      const tanH = tanV * stage.camera.aspect;
      let fitDistance = 60;
      for (const x of [box.min.x, box.max.x]) for (const y of [floor, top + 6]) for (const z of [-box.max.y, -box.min.y]) {
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
  }, [data]);

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
  const press = useRef<{ id: number; x: number; y: number; t: number; moved: boolean } | null>(null);
  const pointers = useRef(new Set<number>());
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) p.moved = true;
    if (e.pointerType !== "mouse") return;
    if (e.buttons) { setTip(null); return; }
    if (!tip?.pinned) pick(e, false);
  };
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!(e.target instanceof HTMLCanvasElement)) return;
    pointers.current.add(e.pointerId);
    if (e.pointerType === "touch" && !touchMode) setTouchMode(true);
    press.current = pointers.current.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false } : null;
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    pointers.current.delete(e.pointerId);
    press.current = null;
    if (!p || p.id !== e.pointerId || pointers.current.size > 0 || p.moved) return;
    // A drag turned the model: whatever was pinned no longer points at its building.
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8 || performance.now() - p.t > 450) { setTip(null); return; }
    pick(e, true);
  };

  const notice = data?.found && complexId ? staleNotice(data, complexId) : null;
  const measured = data?.coverage ? data.coverage.with_height : 0;
  const total = data?.coverage ? data.coverage.buildings : 0;
  const nextTod = TOD_ORDER[(TOD_ORDER.indexOf(tod) + 1) % TOD_ORDER.length];
  const bigScale = bigBase ? Math.min(3, (window.innerWidth * 0.96) / bigBase.w, (window.innerHeight * 0.94) / bigBase.h) : 1;
  const portal = (node: JSX.Element) => bigBase ? createPortal(node, document.body) : node;
  // 30 % wider than the scaled panel, within the window.
  const bigStyle = bigBase ? { width: Math.round(Math.min(bigBase.w * bigScale * 1.3, window.innerWidth * 0.97)), height: Math.round(bigBase.h * bigScale) } : undefined;
  return (
    <>
    {bigBase && <div className="re-holo-slot" style={{ height: bigBase.h }} aria-hidden="true" />}
    {portal(<section ref={sectionRef} style={bigStyle} className={`re-holo${big ? " re-holo--expanded" : ""}`} role={big ? "dialog" : undefined} aria-modal={big || undefined} aria-label={big ? "단지 3D 뷰 크게 보기" : "단지 3D 뷰"}>
      <header className="re-holo-head">
        <div>
          <small>{caption ?? "3D 단지뷰"}</small>
          <strong>{data?.name ?? complexName ?? "단지를 선택하세요"}</strong>
        </div>
        <div className="re-holo-tools">
          <button type="button" aria-pressed={spin} onClick={() => setSpin(v => !v)} aria-label="자동 회전" title="360° 자동 회전">{spin ? "자동 ■" : "자동 ▶"}</button>
          <button type="button" onClick={() => setTod(nextTod)} title={`시간대 바꾸기 · 다음: ${TOD_LABEL[nextTod]}`}>{TOD_LABEL[tod]}</button>
          {!wide && !narrow && complexId && !big && (
            <button type="button" className="re-holo-big" onClick={openBig} title="큰 화면으로 감상">크게 보기 ⤢</button>
          )}
        </div>
      </header>
      <div className="re-holo-stage" ref={hostRef} onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp}
        onPointerCancel={e => { pointers.current.delete(e.pointerId); press.current = null; }}
        onPointerLeave={e => { if (e.pointerType === "mouse" && !tip?.pinned) setTip(null); }}>
        {data?.found && !loading && !notice && <div className="re-holo-scene-label" aria-hidden="true"><span>ARCHITECTURAL VIEW</span><strong>{TOD_LABEL[tod]}의 단지 풍경</strong><i>{touchMode ? "건물을 짧게 탭하면 동·층수를 볼 수 있습니다" : "드래그 회전 · 휠 확대 · 우클릭 이동"}</i></div>}
        {notice && <p className="re-holo-stale" role="note">{notice}</p>}
        {failed3d && <p className="re-holo-msg">이 브라우저에서는 3D를 표시할 수 없습니다.</p>}
        {loading && <div className="re-holo-scan" role="status"><span />{slowData ? "외부 건물 자료 응답을 기다리고 있습니다. 첫 조회는 더 걸릴 수 있습니다." : "건물 윤곽 불러오는 중…"}</div>}
        {!loading && preparing && <div className="re-holo-scan" role="status"><span />장면의 조명과 재질을 준비하고 있습니다…</div>}
        {!loading && error && <p className="re-holo-msg" role="status">{error}</p>}
        {tip && <div className={`re-holo-tip${tip.x > tip.w * 0.55 ? " is-left" : ""}${tip.pinned ? " is-pinned" : ""}`} style={{ left: tip.x, top: tip.y }}
          role="status">{tip.text}</div>}
      </div>
      {data?.found && !failed3d && <nav className="re-holo-navigation" aria-label="3D 화면 조작">
        <div className="re-holo-nav-row">
          <div className="re-holo-modes" role="group" aria-label="드래그 방식">
            <button type="button" aria-pressed={navMode === "pan"} onClick={() => setNavMode("pan")}>✥ 이동</button>
            <button type="button" aria-pressed={navMode === "rotate"} onClick={() => setNavMode("rotate")}>↻ 회전</button>
          </div>
          <button type="button" onClick={() => navigateView("home")}>전체 보기</button>
          <button type="button" onClick={() => navigateView("top")}>위에서</button>
        </div>
        <div className="re-holo-nav-row re-holo-nav-actions">
          <button type="button" aria-label="3D 축소" onClick={() => navigateView("out")}>− <span>축소</span></button>
          <button type="button" aria-label="3D 확대" onClick={() => navigateView("in")}>+ <span>확대</span></button>
          <button type="button" aria-label="3D 왼쪽 회전" onClick={() => navigateView("left")}>↶ <span>왼쪽</span></button>
          <button type="button" aria-label="3D 오른쪽 회전" onClick={() => navigateView("right")}>↷ <span>오른쪽</span></button>
        </div>
        <p>{touchMode ? `한 손가락 ${navMode === "pan" ? "이동" : "회전"} · 두 손가락으로 확대·축소·이동` : `드래그 ${navMode === "pan" ? "이동" : "회전"} · 휠 확대·축소 · 우클릭 이동`}</p>
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
      {big && <button type="button" className="re-holo-wide-close" onClick={closeBig} aria-label="크게 보기 닫기" title="닫기 (Esc)">×</button>}
    </section>)}
    </>
  );
}
