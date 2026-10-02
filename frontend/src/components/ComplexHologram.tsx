import { safeCompileAsync } from "./safeCompile";
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
import { fastMergeVertices } from "./fastMerge";
import { api, RealEstateBuilding, RealEstateBuildingsResponse, RealEstateNearbyComplex } from "../api/client";
import { vworldBuildingNames, vworldBuildings, vworldNearbyParcels, vworldParcels, vworldRoads, withoutDemolished, withoutStrays, parcelBox } from "./vworldBuildings";
import {
  CONTEXT_FLOOR_M, ContextStyle, contextStyle, landmarkLabel, sharedContextMaterial, sharpenNeighbourhood, seasonGround, warmMaterials, dirFrom, FinishShader, BAY_M, FLOOR_M, GROUND_M, inRing, Look, atmosphereLook,
  moonInSky, paintGroundSteps, waterCovered, type Ring, Planting, runSliced, facadeSteps, plinthSteps, sharedContextTexturesSliced, paletteFor, patchMaterial, patchSky, precipField, rng, shared, Tod, Weather, WEATHER_ORDER, WEATHER_LABEL, WEATHER_ICON, hourNow, hourForTod, sunAt, phaseLabel, formatHour,
} from "./complexScene";
import { paintAhead, paintStats, paintTextures, plinthTone, prefetchPaint } from "./paintClient";
import "../desk2/realestate-hologram.css";
import type { ComplexRenderer, Quality } from "./tidewater/ComplexRenderer";
import { endWalls, facadeRelief } from "./tidewater/facadeRelief";
import { loadBuildings, saveBuildings } from "./buildingStore";
import { buildPlants, preloadPlants } from "./scenePlants";
import { vehicleShapes } from "./vehicleClient";
import { buildLamps, buildTraffic, stitchedRoads } from "./sceneStreet";
import { FLAT, gridNormals, loadTerrain, preconnectTerrain, Terrain } from "./sceneTerrain";
import { buildSidewalks, carriageway, ringIndex, sidewalkRuns, streetTrees } from "./sceneSidewalk";
import { buildWalkers, cutPaths, ringPaths, sidewalkPaths, WalkPath } from "./sceneWalkers";
import { buildWater } from "./sceneWater";
import { buildBoats, noBoatsReason, prepareWakes } from "./sceneBoats";
import { buildKids, schoolBorders } from "./sceneKids";
import type { Palette } from "./complexScene";
import { photoBuildings, photoBuildingsNear, photoColours, photoRhythm, photoWallPaint, surveyedShape, type PhotoBuilding, type WallPaint } from "./vworld3d";
import { aerialColours } from "./aerial";
import { buildBalloon, type Balloon } from "./sceneBalloon";
import { disposeControls, releaseRenderer } from "../threeCleanup";
import { frameSlice } from "./frameSlice";
import { ringBuildings } from "./ringBuildings";
import { farGround } from "./farGround";

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

/** A neighbour as drawn, compactly: a quad per wall (indexed) and the roof — no floor (it is sunk
 * below the ground anyway) — the same outline, height, wall uv (storeys from the ground, as extrude)
 * and roof uv as ExtrudeGeometry's, in about half its vertex memory (which paid for the 1 km ring:
 * ringBuildings.ts makes those the same way, in its worker). */
function compactExtrude(b: RealEstateBuilding, ground = 0, floorM = FLOOR_M): THREE.BufferGeometry {
  const depth = Math.max(2, b.height - b.base), below = b.base > 0 ? 0 : SINK;
  const z0 = ground + b.base - below, z1 = ground + b.base + depth;
  const k = THREE.MathUtils.clamp(floorM / (depth / Math.max(1, b.floors)), 0.5, 2);
  const area = (r: [number, number][]) => r.reduce((sum, [x1, y1], i) => { const [x2, y2] = r[(i + 1) % r.length]; return sum + x1 * y2 - x2 * y1; }, 0);
  const outer = area(b.rings[0]) >= 0 ? b.rings[0] : [...b.rings[0]].reverse();
  const holes = b.rings.slice(1).map(h => (area(h) <= 0 ? h : [...h].reverse()));
  const P: number[] = [], N: number[] = [], U: number[] = [], I: number[] = [];
  for (const ring of [outer, ...holes]) for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
    const ex = bx - ax, ey = by - ay, el = Math.hypot(ex, ey);
    if (el < 1e-4) continue;
    const nx = ey / el, ny = -ex / el, alongX = Math.abs(ey) < Math.abs(ex), v = P.length / 3;
    for (const [x, y, z] of [[ax, ay, z0], [bx, by, z0], [bx, by, z1], [ax, ay, z1]]) { P.push(x, y, z); N.push(nx, ny, 0); U.push(alongX ? x : y, (1 - (z - ground)) * k); }
    I.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }
  const roof = P.length / 3, pts = [...outer, ...holes.flat()];
  for (const [x, y] of pts) { P.push(x, y, z1); N.push(0, 0, 1); U.push(x, y); }
  const tris = THREE.ShapeUtils.triangulateShape(outer.map(([x, y]) => new THREE.Vector2(x, y)), holes.map(h => h.map(([x, y]) => new THREE.Vector2(x, y))));
  for (const [a, c, d] of tris) I.push(roof + a, roof + c, roof + d);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
  geo.setIndex(I);
  return geo;
}

/** The ground as one grid over ±G: fine (≈T/100) inside the surveyed square ±T, growing
 * outward to the horizon; heights from the terrain, uv spanning the painted square. */
async function groundGeometry(T: number, G: number, terrain: Terrain, segs: number, pace: () => Promise<boolean>) {
  const geo = new THREE.PlaneGeometry(2, 2, segs, segs);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute, uvA = geo.getAttribute("uv") as THREE.BufferAttribute;
  const P = pos.array as Float32Array, UV = uvA.array as Float32Array;
  const a = 0.84;
  const f = (u: number) => { const s = Math.sign(u), v = Math.abs(u); return s * (v <= a ? (v / a) * T : T + (G - T) * ((v - a) / (1 - a)) ** 2); };
  // The grid's world coordinates, once per column and row (PlaneGeometry: x left to right,
  // rows from y = +1 down).
  const row = segs + 1, xs = new Float64Array(row), ys = new Float64Array(row);
  for (let k = 0; k < row; k++) { xs[k] = f((k / segs) * 2 - 1); ys[k] = f(1 - (k / segs) * 2); }
  // (a fine grid is 100k terrain lookups: laid a few rows at a time)
  for (let j = 0; j < row; j++) {
    const y = ys[j];
    for (let i = 0; i < row; i++) {
      const k = j * row + i, x = xs[i], z = terrain.at(x, y);
      P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z;
      UV[k * 2] = (x + T) / (2 * T); UV[k * 2 + 1] = (y + T) / (2 * T);
    }
    if (!await pace()) return null;
  }
  // Normals straight from the height grid (sceneTerrain.gridNormals): the same smooth shading as
  // computeVertexNormals, without its pass over 200k triangles.
  geo.userData.grid = { xs, ys };
  if (!await pace()) return null;
  gridNormals(geo);
  pos.needsUpdate = true; uvA.needsUpdate = true;
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
  /** Stop the current model's late extras (the 1 km ring's fetching and building): another
   * complex was chosen, and its loading comes first. */
  stopExtras: () => void;
  /** The model on screen, to keep in view while the next one is built (a move to a neighbouring
   * complex): stop its late additions, and later take it out of the scene and free it. */
  current: { stop: () => void; release: () => void; parts: () => THREE.Object3D[] } | null;
  /** Free a model's materials now that it is off the scene (the WebGPU view keeps unused ones 20 s). */
  forget?: (materials: Set<THREE.Material>) => void;
  /** A new model is built but has not reached the screen yet. */
  unshown: boolean;
  /** One-off work under way after the first frame (the photo pass): its hitches are not the
   * device being slow, so the resolution and quality steps don't judge them. */
  busy: number;
  /** A model being built: its warm-up meshes (pipelines, textures) are already in the scene. */
  building: boolean;
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
  balloonView: { yaw: number; pitch: number; fov: number; baseFov: number;
    /** Moving to another complex: the look turns toward it (a drag hands it back). */
    aim?: THREE.Vector3 } | null;
  /** Place the complexes' name signs (an HTML layer over the view) for this frame's camera. */
  signs: ((camera: THREE.PerspectiveCamera, w: number, h: number) => void) | null;
  /** The view's height in CSS pixels. */
  viewH: number;
  /** The route given before the balloon was made (it is made in idle time). */
  balloonRoute?: [THREE.Vector3, number, number] | null;
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

/** A complex's shapes as the view will use them, started ahead — as soon as the page
 * knows the complex (the pointer resting on its tile, a click, the region's #1): this
 * browser's copy and the server's kept shapes asked together; a server result from
 * OpenStreetMap (its rough outlines: the server abroad can't reach VWorld's registry) given
 * way to the surveyed buildings (GIS건물통합정보) the browser asks VWorld for itself when
 * they come within a few seconds; then the roads and the relief under them. Null when the
 * complex has no kept shapes yet (the view then asks the slower way). */
const prefetched = new Map<string, Promise<RealEstateBuildingsResponse | null>>();
const roadsOf = new Map<string, Promise<RealEstateBuildingsResponse>>();
const terrainOf = new Map<string, Promise<Terrain>>();
const remember = <T,>(m: Map<string, T>, id: string, v: T) => { m.set(id, v); if (m.size > 6) m.delete(m.keys().next().value!); return v; };
export function prefetchComplex(id: string): void { void firstLook(id); }
function firstLook(id: string): Promise<RealEstateBuildingsResponse | null> {
  const had = prefetched.get(id);
  if (had) return had;
  const job = (async () => {
    const peekJob = api.realEstateBuildings(id, undefined, true).catch(() => null);
    const kept = await loadBuildings(id).catch(() => null);
    const peek = kept ?? await peekJob;
    if (!peek?.found) return null;
    let res = peek;
    if (!kept && peek.source === "osm" && peek.vworld_key && peek.query?.parcel) {
      const surveyed = await Promise.race([
        vworldBuildings(id, peek.query, peek.vworld_key, peek.vworld_domain).catch(() => null),
        new Promise<null>(r => window.setTimeout(() => r(null), 4000)),
      ]);
      if (surveyed?.found && surveyed.buildings.length >= Math.min(2, peek.buildings.length))
        res = { ...surveyed, built: peek.built ?? surveyed.built ?? null, vworld_key: peek.vworld_key, vworld_domain: peek.vworld_domain };
    }
    // (the roads and the relief start now too: the view finds them under way, or done)
    void withRoads(id, res); void terrainOnce(id, res);
    return res;
  })();
  job.catch(() => prefetched.delete(id));
  return remember(prefetched, id, job);
}
/** The surveyed roads for a result that lacks them (once per complex). */
function withRoads(id: string, res: RealEstateBuildingsResponse): Promise<RealEstateBuildingsResponse> {
  if (res.roads || !res.vworld_key || !res.center) return Promise.resolve(res);
  const had = roadsOf.get(id);
  if (had) return had;
  const job = Promise.race([
    vworldRoads(res, res.vworld_key, res.vworld_domain).catch(() => null),
    new Promise<null>(r => window.setTimeout(() => r(null), 2500)),
  ]).then(roads => (roads ? { ...res, roads } : res));
  return remember(roadsOf, id, job);
}
function terrainOnce(id: string, res: RealEstateBuildingsResponse): Promise<Terrain> {
  return terrainOf.get(id) ?? remember(terrainOf, id, terrainFor(res));
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

/** The complexes round a complex (주변 단지 selector), once per complex: where they stand
 * as latitude and longitude, so any complex's view can place them. */
type Nearby = RealEstateNearbyComplex & { lat: number; lon: number };
const nearbyOf = new Map<string, Promise<Nearby[]>>();
function nearbyFor(id: string, res: RealEstateBuildingsResponse): Promise<Nearby[]> {
  const had = nearbyOf.get(id);
  if (had) return had;
  const { lat, lon } = res.center!;
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320, ky = 110_540;
  const job = vworldNearbyParcels(res, res.vworld_key!, res.vworld_domain)
    .then(parcels => (parcels.length ? api.realEstateNearby(id, parcels) : { id, items: [] }))
    .then(r => r.items.map(i => ({ ...i, lat: lat + i.y / ky, lon: lon + i.x / kx })));
  job.catch(() => nearbyOf.delete(id));
  return remember(nearbyOf, id, job);
}
/** Where a latitude and longitude lie from a result's centre: x east, y north (m). */
function metresFrom(center: { lat: number; lon: number }, lat: number, lon: number): [number, number] {
  return [(lon - center.lon) * Math.cos((center.lat * Math.PI) / 180) * 111_320, (lat - center.lat) * 110_540];
}
const BEARINGS = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
const bearing = (x: number, y: number) => BEARINGS[Math.round(((Math.atan2(x, y) * 180) / Math.PI + 360) % 360 / 45) % 8];

/** The 1 km land use's square (half its side, metres) and the blank it starts from (farGround.ts:
 * the ground's shader takes the picture from the first frame, so its arrival swaps a texture,
 * never the shader). */
const FAR_HALF = 1100;
let farBlank: THREE.Texture | null = null;
const blankFar = () => {
  if (farBlank) return farBlank;
  const c = document.createElement("canvas"); c.width = c.height = 4;
  // (drawn on: WebGPU cannot copy a canvas that has no context)
  const x = c.getContext("2d")!; x.fillStyle = "#000"; x.fillRect(0, 0, 4, 4);
  farBlank = new THREE.CanvasTexture(c);
  farBlank.colorSpace = THREE.SRGBColorSpace; farBlank.flipY = false;
  return farBlank;
};

const WHEEL_ZOOM = 4.8;

/** Yield the main thread: the next task, or (when the view is covered) the next idle
 * period, so input and scrolling elsewhere on the page come first. */
function nextSlice(idle: boolean): Promise<void> {
  if (!idle || typeof window.requestIdleCallback !== "function") return frameSlice();
  return new Promise(resolve => { window.requestIdleCallback(() => resolve(), { timeout: 1500 }); });
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

export default function ComplexHologram({ complexId: homeId, complexName: homeName, caption: homeCaption, wide = false, initialTod, paused = false, openFull = 0, onFullChange }: {
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
  // 주변 단지: a neighbouring complex chosen in the selector is built in full detail and
  // the view centres on it; the page's complex (home) comes back from the same selector.
  // (tied to the home it was chosen from: another complex on the map ends it)
  const [hopState, setHop] = useState<{ id: string; name: string; home: string | null } | null>(null);
  const hop = hopState && hopState.home === homeId ? hopState : null;
  const complexId = hop?.id ?? homeId;
  const complexName = hop?.name ?? homeName;
  const caption = hop ? "주변 단지 · 3D" : homeCaption;
  /** A move under way to another complex: where the view's centre was (to carry the
   * camera and the balloon across when the new model's origin replaces it). */
  const hopRef = useRef<{ id: string; from: { lat: number; lon: number }; terrain: Terrain } | null>(null);
  const [nearby, setNearby] = useState<{ home: string; name: string; lat: number; lon: number; items: Nearby[] } | null>(null);
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
  // ?hud=1: the view's own numbers on screen (frame rate, frames dropped, GPU time, resolution,
  // quality, renderer), for a reader's device to tell what it does. Written straight into a
  // <pre> twice a second; the frames counted by their own requestAnimationFrame.
  const hudRef = useRef<HTMLPreElement>(null);
  const hudOn = useMemo(() => new URLSearchParams(location.search).get("hud") === "1", []);
  useEffect(() => {
    if (!hudOn) return;
    let raf = 0, last = performance.now(), n = 0, slow = 0, worst = 0, at = last, totalSlow = 0;
    const tick = (t: number) => {
      const dt = t - last; last = t; n++;
      if (dt > 25) { slow++; totalSlow++; } worst = Math.max(worst, dt);
      if (t - at > 500) {
        const d = (document.querySelector<HTMLElement>(".re-holo--expanded .re-holo-stage") ?? hostRef.current)?.dataset ?? {};
        if (hudRef.current) hudRef.current.textContent =
          `fps ${(n * 1000 / (t - at)).toFixed(0)}  drop>25ms ${slow}/0.5s (total ${totalSlow})  worst ${worst.toFixed(0)}ms
` +
          `gpu ${d.gpuMs ?? "-"}ms  ratio ${d.pixelRatio ?? "-"} x dpr ${devicePixelRatio}  quality ${d.quality ?? "-"}  ${d.renderer ?? ""}
` +
          `draws ${d.draws ?? "-"}  ${innerWidth}x${innerHeight}  ${d.trial ?? ""}`;
        n = 0; slow = 0; worst = 0; at = t;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hudOn]);
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
    // (a phone at its own pixels, up to 3x: it started at 1.6x and could never climb, so a 3x
    // screen showed a soft picture from the first frame)
    let ratio = Math.min(dpr, hq ? 2 : 3);
    // (a desktop supersamples up to 2x where its GPU has the time: the native view has no MSAA,
    // and at the display's own 1x its window grids and edges shimmered)
    let maxRatio = hq ? 2 : ratio;
    // Desktop: the first ratio from a pixel budget (a panel or a normal window starts well above
    // 1x, a 5K full screen at its own pixels), never above ~14 MP of drawing in all (the render
    // targets of a 5120x1440 screen at 2x would be gigabytes). Measured GPU time climbs from there.
    const PIX_START = 4.5e6, PIX_CAP = 14e6;
    let lastArea = 0;
    // (?pr=1.5: a fixed ratio, for comparing sharpness and GPU time)
    const fixedRatio = Number(new URLSearchParams(location.search).get("pr")) || 0;
    if (fixedRatio) ratio = maxRatio = fixedRatio;
    // High resolution on every device is the rule: never below the display's own pixels
    // (a phone's 3x may step down, never under 1 CSS pixel a pixel).
    const minRatio = Math.min(1, dpr);
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
    // Native quality from the device: high quality everywhere is the rule — desktops
    // (panel or full screen) and current phones start high, small-memory or 4-core devices
    // medium; only a tiny-memory device starts low. The GPU time measured once the scene
    // settles steps a genuinely weak GPU down from there.
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    // (a current phone — 8 GB, 8 cores — starts at full quality like a desktop: a small touch
    // screen alone was taken for a weak device; the view still steps down where its GPU proves slow)
    const tier: Quality["name"] = mem <= 2 ? "low" : mem <= 4 || navigator.hardwareConcurrency <= 4 ? "medium" : "high";
    let qualities: Record<Quality["name"], Quality> | null = null;
    if (nativePending) {
      import("./tidewater/ComplexRenderer").then(m => { qualities = m.QUALITY; return m.ComplexRenderer.create(host, m.QUALITY[tier]); }).then(view => {
        if (disposed) { view.dispose(); return; }
        if (view.canvas.parentElement !== host) host.appendChild(view.canvas);
        native = view;
        stage.forget = mats => view.forget(mats);
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
    // (by time, not per drawn frame — controls.update(dt) in the loop: per frame, the turn slowed
    // with every late frame while loading, and halved when the view went to its idle rate. This
    // is the speed the idle view turned at, the one seen longest.)
    controls.autoRotateSpeed = 0.275;
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
    // (in short task slices, not idle time: during page load idle time hardly comes, and the
    // neighbourhood textures then held up the first complex's build by half a second)
    void warmMaterials(warm, () => nextSlice(false), () => !disposed);
    const moon = moonInSky();
    const precip = precipField();
    scene.add(precip.group);
    scene.add(moon.group);
    // The balloon is made in idle slices once the view is up (it shows only over a complex);
    // a route given before it is ready waits for it (stage.balloonRoute).
    let balloon: Balloon | null = null;

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
      const done = safeCompileAsync(renderer, obj, camera, scene);
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
      now: 0, top: 50, dist: 300, center: new THREE.Vector3(), floor: 0, nearMax: 0.5, hq, disposeModel: () => {}, resume: () => {}, stopExtras: () => {}, current: null, unshown: false, busy: 0, building: false, onShown: [], attach: () => {}, frame: () => {}, snap: null, balloon: null, balloonView: null, signs: null, viewH: 600,
      addWarm: (parent, obj) => { if (native || nativePending) parent.add(obj); else void glCompile(obj).then(() => parent.add(obj)); },
    };
    stageRef.current = stage;
    const idleBuild = (f: () => void) => { if (typeof requestIdleCallback === "function") requestIdleCallback(f, { timeout: 2500 }); else window.setTimeout(f, 300); };
    idleBuild(() => void buildBalloon(() => frameSlice()).then(b => {
      if (disposed) { b.dispose(); return; }
      balloon = b; stage.balloon = b;
      b.group.visible = false;   // until a complex gives it a route
      b.setLook(stage.look);
      scene.add(b.group);
      const r = stage.balloonRoute;
      if (r) { b.setRoute(r[0], r[1], r[2]); b.group.visible = true; stage.balloonRoute = null; }
    }));
    // Dev only: lets the render checks place the camera (never in a production build).
    if (import.meta.env.DEV) (window as unknown as { __complexStage?: Stage }).__complexStage = stage;

    let W = 1, H = 1;
    // (sizes from the ResizeObserver: reading clientWidth made the browser lay out the page there
    // and then — ~40 ms twice as the view opened, while the page was still being built)
    const resize = (w = W, h = H) => {
      W = Math.round(w); H = Math.round(h);
      if (!W || !H) return;
      stage.viewH = H;
      if (hq && !fixedRatio) {
        const area = W * H, cap = Math.max(minRatio, Math.min(maxRatio, Math.sqrt(PIX_CAP / area)));
        // First size, or a much larger one (full screen): the ratio this GPU should hold at about
        // 10 ms a frame, from its time measured at the size before (all of it taken as growing with
        // the pixels: on the safe side); unmeasured, the pixel budget.
        if (area > lastArea * 1.3) {
          const gpu = native?.timer.enabled ? native.timer.ms.total ?? 0 : 0, drawn = lastArea * ratio * ratio;
          const want = gpu > 0.5 && drawn > 0 ? Math.sqrt((10 / gpu) * drawn / area) : Math.sqrt(PIX_START / area);
          ratio = Math.max(Math.min(dpr, 2), minRatio, Math.min(cap, Math.floor(want * 4) / 4));
        }
        ratio = Math.min(ratio, cap);
        lastArea = area;
      }
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
    const ro = new ResizeObserver(entries => {
      const box = entries[entries.length - 1].contentRect, w = W, h = H;
      resize(box.width, box.height);
      if ((W !== w || H !== h) && raf) stage.resume();
    });
    ro.observe(host);

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
    // Dynamic quality and resolution with hysteresis: at least 40 fps, never below 1x.
    let slow = 0, quick = 0, gpuHot = 0, gpuCool = 0, last = performance.now(), settleUntil = 0, calibrated = false;
    // A step down on trial (no GPU timestamps), and whether one proved the main thread the limit.
    let trial: { step: string; before: number; ratio: number; quality: Quality | null; from: number; until: number; dts: number[] } | null = null;
    let cpuBound = false;
    const recent: number[] = [];
    const median = (xs: number[]) => { const v = [...xs].sort((a, b) => a - b); return v[v.length >> 1] ?? 0; };
    const calDt: number[] = [];
    let inView = true, sampleStart = last, sampleFrames = 0;
    const t0 = performance.now();
    let raf = 0;
    // Off screen the loop sleeps, except while shaders and a new model are still being
    // prepared: that work then finishes before the panel scrolls into view.
    // (and while a model is being built in slices: its materials' warm-up meshes are in the
    // scene from the start, so its pipelines and textures are ready when it is — behind the
    // detail popup too, at the idle rate)
    const warming = () => stage.building || (stage.unshown && !!stage.model) || nativePending || (!!native && !native.ready);
    // Left alone (no pointer, wheel or key on the view for 3 s, nothing in motion but
    // the scene's own life), the view draws every other display frame: the same
    // pictures at 30 fps, half the GPU and main-thread time for the rest of the page.
    let idleSkip = false;
    // The slowest submit (CPU, ms) since the last sample: dataset.renderMaxMs.
    let renderMax = 0;
    // (a model still loading, behind its scan overlay, renders at the idle rate: those
    // frames only prepare its pipelines, and at full rate they held the GPU — and with it
    // the pointer and the page — through every load)
    // (the camera turning on its own, or the balloon on its way to another complex, is the whole
    // picture moving: at the idle rate it read as a stutter — a model on screen only)
    const busy = () => performance.now() - lastInput < 3000 || !!stage.balloonView || !!stage.fly || !!stage.intro || stage.atmos.dirty || stage.atmos.rain !== stage.atmos.wantRain
      || stage.atmos.snow !== stage.atmos.wantSnow || !!stage.snap
      || (!!stage.model && !stage.unshown && (controls.autoRotate || !!balloon?.travelling));
    const loop = () => {
      if (document.hidden || ((!inView || pausedRef.current) && !warming())) return;
      raf = requestAnimationFrame(loop);
      // (a built model waiting for its pipelines: every frame, each one lets a few more be made
      // — at the idle rate a complex's ~35 took twice as many display frames to reach the screen)
      const idle = !busy() && !(stage.unshown && stage.model);
      if (idle) { idleSkip = !idleSkip; if (idleSkip) return; } else idleSkip = false;
      const nowMs = performance.now();
      const dt = nowMs - last;
      last = nowMs;
      // Floor: 40 fps. A frame over 25 ms missed it; misses accumulate and on-time frames
      // drain them slowly, so a steady ~35 fps also counts as slow within seconds. Not
      // judged while a model is still being decorated (one-off building work).
      // (not while idle: every other frame is skipped on purpose, 33 ms is not slow)
      if (stage.busy) settleUntil = Math.max(settleUntil, nowMs + 1500);
      // (a single stall of 100 ms or more is one-off work — a texture, a pipeline — not the
      // device being slow: that shows as a run of 30–90 ms frames)
      const judge = !idle && !stage.unshown && nowMs > settleUntil && dt < 100;
      // (weighted by how late: on a very slow device each frame counts several times)
      if (judge && dt > 25.5) { slow += Math.min(3, dt / 25); quick = 0; }
      else if (judge) { slow = Math.max(0, slow - 0.2); if (dt < 20) quick++; else quick = 0; }
      // Resolution is kept longest: the native view first drops quality steps
      // (screen-space reflections, clouds in them, shadow resolution), then resolution
      // (down to 1x, the display's own pixels). Resolution climbs back only with 50 fps to spare.
      // Once, shortly after the first model settles: the GPU time measured on this device
      // (timestamp queries) sets quality and resolution at once, instead of stepping
      // down over many slow seconds. Frame timing keeps adjusting from there.
      // Without timestamps: the median frame interval over the first second.
      if (native?.shown && !calibrated && !idle && !stage.unshown && nowMs > settleUntil && dt < 2000) calDt.push(dt);
      if (native?.shown && !calibrated && (native.timer.samples > 30 || (!native.timer.enabled && calDt.length >= 5 && nowMs - settleUntil > 1000))) {
        calibrated = true;
        // (only the GPU's own measured time: a frame interval can't tell a busy main thread —
        // which neither quality nor resolution relieves — from a GPU at its limit)
        const g = native.timer.enabled ? native.timer.ms.total ?? 0 : 0;
        if (g > 16 && qualities && native.quality.name !== "low") native.setQuality(g > 30 || native.quality.name === "medium" ? qualities.low : qualities.medium);
        if (g > 24) { ratio = Math.max(minRatio, Math.round(ratio * Math.sqrt(20 / g) * 20) / 20); maxRatio = Math.max(ratio, Math.min(dpr, maxRatio)); resize(); }
        slow = 0;
      }
      // (sustained slowness only; quality steps to medium at most here — low, without AO
      // and bloom, only for a GPU measured too weak above)
      // Sustained slowness lowers quality, then resolution, only where the GPU is what's slow.
      // With timestamps: its measured time says so (under 12 ms a frame it isn't). Without (most
      // phones): one step is tried, and the frames over the next two seconds judge it — no real
      // gain means the main thread is the limit, the step is undone, and none is tried again.
      if (judge) { recent.push(dt); if (recent.length > 90) recent.shift(); }
      if (trial) {
        if (nowMs > trial.from && judge) trial.dts.push(dt);
        if (nowMs > trial.until && trial.dts.length >= 30) {
          const after = median(trial.dts);
          if (after > trial.before * 0.88) {
            if (trial.quality && qualities) native?.setQuality(trial.quality);
            if (trial.ratio !== ratio) { ratio = trial.ratio; resize(); }
            cpuBound = true;
          }
          host.dataset.trial = `${trial.step} ${trial.before.toFixed(1)}→${after.toFixed(1)}ms ${cpuBound ? "undone" : "kept"}`;
          trial = null; slow = 0;
        }
      } else if (slow > 45) {
        slow = 0;
        const gpuSlow = native?.timer.enabled ? (native.timer.ms.total ?? 0) > 12 : !cpuBound && recent.length >= 30;
        const qualityStep = !!(native?.shown && qualities && native.quality.name === "high");
        if (gpuSlow && (qualityStep || ratio > minRatio)) {
          const before = median(recent);
          trial = native?.timer.enabled ? null : { step: qualityStep ? "quality" : "ratio", before, ratio, quality: qualityStep ? native!.quality : null, from: nowMs + 600, until: nowMs + 2600, dts: [] };
          if (qualityStep) native!.setQuality(qualities!.medium);
          else { ratio = Math.max(minRatio, ratio - 0.25); resize(); }
        }
      }
      // Resolution up only with GPU time to spare. The frame interval can't tell: vsync
      // holds it at 16.7 ms however full the GPU is, and a GPU run to 100 % starves the
      // browser (the pointer and the rest of the page stutter). With timestamps: climb
      // under ~12 ms of GPU work a frame (predicted), step down over 14.5 ms; without, never past the
      // display's own ratio.
      // (changes judged over seconds, not a moment: each reallocates the render targets,
      // a visible hitch, and a view moving about — the balloon — varies from frame to frame)
      // (14.5 ms held for 3 s: the GPU's time swings with the view — shadows redrawn while it
      // turns — and the frame rate holds to well past 13 ms; the page keeps its drawing time)
      else if (native?.timer.enabled && (native.timer.ms.total ?? 0) > 14.5 && ratio > Math.min(1, dpr) && judge && ++gpuHot > 180) {
        ratio = Math.max(minRatio, ratio - 0.25); maxRatio = Math.max(minRatio, ratio); gpuHot = 0; resize();
      }
      // (with timestamps: up whenever the GPU has had time to spare for ~1.5 s — idle frames too:
      // a still view left at a lower ratio stayed soft for good)
      else if (native?.timer.enabled && !fixedRatio) {
        // (a step up only where the GPU time it predicts — growing with the pixels — stays under
        // 12 ms: below the 14.5 ms that steps down, so it never swings back and forth)
        const top = Math.min(maxRatio, Math.sqrt(PIX_CAP / (W * H))), next = Math.min(top, ratio + 0.25);
        const room = !stage.unshown && nowMs > settleUntil && next > ratio && (native.timer.ms.total ?? 99) * (next / ratio) ** 2 < 12;
        if (!room) gpuCool = 0;
        else if (++gpuCool > 60) { ratio = next; gpuCool = 0; settleUntil = nowMs + 500; resize(); }
      }
      else if (quick > 150 && ratio < maxRatio && ratio + 0.25 <= dpr) { ratio = Math.min(maxRatio, ratio + 0.25); quick = 0; resize(); }

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
      if (balloon?.group.visible) balloon.update(dt / 1000);
      const bv = stage.balloonView;
      if (bv) {
        // Standing at the basket's rim on the side the look faces, leaning out a little:
        // the rim along the bottom of the view, the complex below, the envelope overhead.
        balloon?.basket(bvAt);
        if (bv.aim) {
          // (eased: about half the way in a third of a second)
          const k = Math.min(1, (dt / 1000) * 2.2);
          const yaw = Math.atan2(bv.aim.z - bvAt.z, bv.aim.x - bvAt.x);
          const pitch = THREE.MathUtils.clamp(-Math.atan2(bvAt.y - bv.aim.y, Math.hypot(bv.aim.x - bvAt.x, bv.aim.z - bvAt.z)), -1.45, -0.15);
          const dYaw = Math.atan2(Math.sin(yaw - bv.yaw), Math.cos(yaw - bv.yaw));
          bv.yaw += dYaw * k; bv.pitch += (pitch - bv.pitch) * k;
          if (!balloon?.travelling && Math.abs(dYaw) < 0.003 && Math.abs(pitch - bv.pitch) < 0.003) bv.aim = undefined;
        }
        const fx = Math.cos(bv.yaw), fz = Math.sin(bv.yaw);
        camera.position.set(bvAt.x + fx * 1.02, bvAt.y + 1.62, bvAt.z + fz * 1.02);
        bvLook.set(fx * Math.cos(bv.pitch), Math.sin(bv.pitch), fz * Math.cos(bv.pitch)).add(camera.position);
        camera.lookAt(bvLook);
        if (camera.fov !== bv.fov || camera.near !== 0.08) { camera.fov = bv.fov; camera.near = 0.08; camera.updateProjectionMatrix(); }
      } else {
        controls.update(Math.min(dt, 100) / 1000);
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
      precip.update(camera, t, H);   // (H from the resize observer: reading clientHeight here forced a page layout every frame)
      stage.signs?.(camera, W, H);


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
      const rendererName = native?.shown ? "tidewater-webgpu" : isPreparing ? "preparing" : "webgl";
      if (host.dataset.renderer !== rendererName) host.dataset.renderer = rendererName;   // (a write each frame dirtied the page's style)
      if (++sampleFrames >= 60 || (sampleFrames >= 2 && nowMs - sampleStart > 1000)) {
        host.dataset.fps = (sampleFrames * 1000 / (nowMs - sampleStart)).toFixed(1);
        host.dataset.draws = String(native?.ready ? native.stats.draws : renderer.info.render.calls);
        host.dataset.pixelRatio = ratio.toFixed(2);
        host.dataset.renderMaxMs = renderMax.toFixed(0); renderMax = 0;
        if (native) { host.dataset.quality = native.quality.name; host.dataset.gpuMs = (native.timer.ms.total ?? 0).toFixed(2); host.dataset.pipelines = String((native as unknown as { renderer: { pipelines: Map<string, unknown> } }).renderer.pipelines.size); }
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
      balloon?.setLook(l);
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
      // (its size comes with the observer's first report on it: drawn again then)
      ro.observe(host); io.observe(host);
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
      balloon?.dispose();
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
      bv.aim = undefined;
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
  const flyTo = (point: THREE.Vector3, distance: number, dur = 0.9) => {
    const st = stageRef.current;
    if (!st || st.balloonView) return;
    st.controls.autoRotate = false; spinRef.current = false; setSpin(false); st.intro = null;
    const dir = st.camera.position.clone().sub(st.controls.target).normalize();
    // (not flatter than 20°: a building seen from its own ground level reads badly)
    if (dir.y < 0.34) { dir.y = 0.34; dir.normalize(); }
    const d = THREE.MathUtils.clamp(distance, st.controls.minDistance * 4, st.controls.maxDistance);
    st.fly = { fromPos: st.camera.position.clone(), toPos: point.clone().addScaledVector(dir, d), fromTarget: st.controls.target.clone(), toTarget: point.clone(), t0: st.now, dur };
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


  // Every selection: this browser's copy, else kept shapes from the server, else
  // VWorld from this browser (VWorld refuses the server abroad) raced against the
  // server's OpenStreetMap fallback.
  useEffect(() => {
    setTip(null);
    if (!complexId) { setData(null); return; }
    // (the model on screen stops its late extras: this one's loading comes first)
    stageRef.current?.stopExtras();
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
      // (the look started ahead — on the tile's hover, or just now — when it found shapes)
      const early = await firstLook(complexId).catch(() => null);
      prefetched.delete(complexId);
      if (early?.found) return early;
      const peek = await api.realEstateBuildings(complexId, signal, true);
      // Roads and terrain only need these footprints/centre. The common stage below
      // loads them together; awaiting roads here serialized the two network waits.
      // Accuracy first: a server result from OpenStreetMap (its rough outlines; the server
      // can't reach VWorld's registry) gives way to the surveyed buildings (GIS건물통합정보)
      // the browser can ask VWorld for itself, when they come within a few seconds.
      if (peek.found && peek.source === "osm" && peek.vworld_key && peek.query?.parcel) {
        const surveyed = await Promise.race([
          vworldBuildings(complexId, peek.query, peek.vworld_key, peek.vworld_domain).catch(() => null),
          new Promise<null>(res => window.setTimeout(() => res(null), 4000)),
        ]);
        if (surveyed?.found && surveyed.buildings.length >= Math.min(2, peek.buildings.length))
          return { ...surveyed, built: peek.built ?? surveyed.built ?? null, vworld_key: peek.vworld_key, vworld_domain: peek.vworld_domain };
        return peek;
      }
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
        const [full, ground] = await Promise.all([res.found && !res.roads ? withRoads(complexId, res) : res,
          res.found ? terrainOnce(complexId, res).then(t => { if (hostRef.current) hostRef.current.dataset.terrainMs = (performance.now() - t0).toFixed(0); return t; }) : FLAT]);
        if (live) {
          if (hostRef.current) hostRef.current.dataset.dataMs = (t0 - started).toFixed(0);
          terrainRef.current = ground;
          setTerrainSource(ground.source);
        }
        return full;
      })
      .then(found => {
        const res = withoutStrays(withoutDemolished(found));
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
    // Arriving from another complex (the 주변 단지 selector): this model's origin is its own
    // centre, so everything in the scene moves by the offset between the two centres and stays
    // where it was in the world — the camera, the orbit, the balloon, and the complex left
    // behind, which stays in view (no empty sky) until this one's first frame is up.
    const came = hopRef.current?.id === complexId && data?.found && data.center && data.buildings.length ? hopRef.current : null;
    hopRef.current = null;
    let shift: THREE.Vector3 | null = null;
    if (came && data?.center) {
      const [ox, oy] = metresFrom(came.from, data.center.lat, data.center.lon);
      shift = new THREE.Vector3(-ox, -came.terrain.at(ox, oy), oy);
      if (shift.length() > 3000) shift = null;
    }
    let behind = shift && stage.model && !stage.unshown ? stage.current : null;
    if (behind) {
      behind.stop();
      for (const o of behind.parts()) o.position.add(shift!);
      // (its traffic and people keep moving meanwhile: tick stays until this model's replaces it)
      stage.current = null; stage.model = null; stage.ground = null; stage.pickables = []; stage.onShown = [];
    } else stage.disposeModel();
    if (shift) {
      stage.camera.position.add(shift); stage.controls.target.add(shift);
      if (stage.fly) for (const v of [stage.fly.fromPos, stage.fly.toPos, stage.fly.fromTarget, stage.fly.toTarget]) v.add(shift);
      stage.balloon?.shift(shift);
      stage.balloonView?.aim?.add(shift);
    }
    const letGo = () => { behind?.release(); behind = null; };
    if (!data?.found || !data.buildings.length) { letGo(); return; }
    // (idle time, once a session: a river complex's boats need them the moment its water is in)
    prepareWakes();
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
    stage.building = true;
    stage.resume();
    // (its materials handed to the view to free at once: see ComplexRenderer.forget)
    const forgetAll = () => {
      const mats = new Set<THREE.Material>();
      for (const root of [group, decor, ground]) root?.traverse(o => { const m = (o as THREE.Mesh).material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => mats.add(x)); });
      stage.forget?.(mats);
    };
    const release = () => {
      forgetAll();
      stage.scene.remove(group, decor);
      if (ground) stage.scene.remove(ground);
      disposables.forEach(d => d.dispose());
    };
    stage.current = { stop: () => { alive = false; }, release, parts: () => (ground ? [group, decor, ground] : [group, decor]) };
    stage.disposeModel = () => {
      alive = false;
      letGo();
      stage.current = null;
      stage.building = false;
      stage.onShown = [];
      forgetAll();
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
      // (6 ms: what is left of a frame after the view's own drawing — longer slices missed frames)
      if (force || performance.now() - sliceStart > 6) {
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
    /** The complex's facade in a palette (the brand's to start with; the real colours read
     * from the survey photographs later). */
    const facadeMaterial = async (pal: Palette, s: number, bay = BAY_M, storey = FLOOR_M, scale = 1) => {
      // Started when the complex was chosen (alongside its network wait), or kept from
      // an earlier visit.
      const tex = await paintTextures(scale === 1 ? { kind: "facade", palette: pal, seed: s } : { kind: "facade", palette: pal, seed: s, scale }, pace);
      if (!tex) return null;
      if (!alive) { Object.values(tex).forEach(t => t.dispose()); return null; }
      // Painted for this complex only and never repainted: the WebGPU view empties the
      // canvas once the texture is on the GPU (ComplexRenderer.release).
      Object.values(tex).forEach(t => { t.userData.releaseAfterUpload = true; });
      Object.values(tex).forEach(keep);
      // (the tile is 8 bays by 8 storeys: fitted to the measured window pitch and storey)
      if (bay !== BAY_M || storey !== FLOOR_M) Object.values(tex).forEach(t => { t.repeat.set(1 / (8 * bay), 1 / (8 * storey)); t.offset.set(0, (1 - GROUND_M) / (8 * storey)); });
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
      return m;
    };
    for (const s of [seed, seed + 7919]) {
      if (!await pace(true)) return;
      const m = await facadeMaterial(palette, s);
      if (!m) return;
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
    // Every piece remembers its building ("b" + index, "c" + neighbour index): the photo
    // models (VWorld 3D) replace buildings one by one, after the first frame.
    let owner = "";
    const own = <G extends THREE.BufferGeometry>(geo: G) => { geo.userData.owner = owner; return geo; };
    const add = (mat: THREE.Material, geo: THREE.BufferGeometry | undefined) => {
      if (!geo) return;
      if (!parts.has(mat)) parts.set(mat, []);
      parts.get(mat)!.push(own(geo));
    };
    const relief: THREE.Matrix4[] = [], reliefOwner: string[] = [];
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
      owner = "b" + i;
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
      else if (sides) ctxGeos.shop.push(own(tinted(sides, lowTint)));
      // Picking only: never rendered, shares the group's transform.
      geo.clearGroups();
      const pick = new THREE.Mesh(keep(geo));
      pick.userData.label = `${b.name ? b.name + " · " : ""}${heightLabel(b)}`;
      pick.matrixWorld.copy(group.matrixWorld);
      pickables.push(pick);
      const H = b.height + g, B = b.base + g;
      if (isTower) {
        facadeRelief({ ...b, base: B, height: H }, relief, reliefLimit);
        while (reliefOwner.length < relief.length) reliefOwner.push(owner);
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
        // End walls (측벽): the faces square to the slab's long axis at its two extremes — not
        // the short segments of a stepped front. No invented stripes or blocks (every real end
        // wall is its own design): plain paint in the second colour, the number at the top;
        // where VWorld's survey covers the complex, its end walls are repainted from the
        // colours measured on them (the photo pass).
        const ends = endWalls(ring);
        ring.forEach((p, j) => {
          if (!ends.has(j)) return;
          const q = ring[(j + 1) % ring.length];
          add(trim, tinted(panel(p[0], p[1], q[0], q[1], plinthTop, H, 0.12, 0.22, 0.92), gableC));
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
    // The neighbourhood: every registered building within the surveyed radius, on its
    // own ground, in one of three facades chosen by its registered use, tinted per
    // building, windows fitted to its registered floors, a parapet round its roof.
    const ext = data.buildings.flatMap(b => b.rings[0]).reduce((m, [x, y]) => Math.max(m, Math.hypot(x, y)), 0);
    // Neighbours drawn this far out (the fetched radius, CONTEXT_M 288 m, plus the parcel).
    const reach = ext + 300;
    const tints = ["#f1ede4", "#e4e1da", "#d9d4ca", "#c9b8a4", "#b88f78", "#a9b3bb", "#e8e3d3", "#cfc9bd"];
    const styles: ContextStyle[] = ["villa", "shop", "office", "apt"];
    const parapets: THREE.Matrix4[] = [], parapetOwner: string[] = [];
    const pm = new THREE.Object3D();
    const neighbours = data.context.filter(b => b.rings[0].some(([x, y]) => Math.hypot(x, y) <= reach));
    step("merge");
    if (!await pace(true)) return;
    // The landmarks round the complex answer the hover with their names (picking only).
    // (an OpenStreetMap result names its buildings in `name`)
    if (hostRef.current) { delete hostRef.current.dataset.landmarks; delete hostRef.current.dataset.landmarkNames; hostRef.current.dataset.titled = String(neighbours.filter(b => b.title).length); }
    const landmark = (b: RealEstateBuilding) => {
      const known = landmarkLabel(b.title === undefined && data.source === "osm" && /[가-힣A-Za-z]/.test(b.name ?? "") ? { ...b, title: b.name } : b);
      if (!known) return;
      const pick = new THREE.Mesh(keep(extrude(b, terrain.base(b.rings[0]), FLOOR_M)));
      pick.geometry.clearGroups();
      pick.userData.label = known;
      pick.matrixWorld.copy(group.matrixWorld);
      pickables.push(pick);
      if (hostRef.current) hostRef.current.dataset.landmarks = String(+(hostRef.current.dataset.landmarks ?? 0) + 1);
    };
    for (const [j, b] of neighbours.entries()) {
      owner = "c" + j;
      if (!await pace()) return;
      const g = terrain.base(b.rings[0]);
      const style = contextStyle(b.use, b.height, rnd());
      const geo = compactExtrude(b, g, CONTEXT_FLOOR_M[style]);
      const c = new THREE.Color(tints[Math.floor(rnd() * tints.length)]);
      if (style === "office") c.lerp(new THREE.Color("#ffffff"), 0.4);
      if (style === "apt") c.lerp(new THREE.Color("#ffffff"), 0.65);
      const n = geo.getAttribute("position").count, col = new Float32Array(n * 3);
      for (let j = 0; j < n; j++) col.set([c.r, c.g, c.b], j * 3);
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      ctxGeos[style].push(own(geo));
      landmark(b);
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
        parapets.push(pm.matrix.clone()); parapetOwner.push(owner);
      });
    }
    step("neighbours");
    // The buildings as merged meshes, leaving out any in `skip` (replaced by photo models).
    // The pieces are kept until the photo pass is done (they are needed to merge again).
    // (?survey=0: the modelled buildings only, for comparison)
    const photoPending = !!(data.vworld_key && data.center) && new URLSearchParams(location.search).get("survey") !== "0";
    let assembled: THREE.Object3D[] = [];
    const assemble = async (skip: Set<string>, first: boolean) => {
      const out: THREE.Object3D[] = [];
      const kept = (g: THREE.BufferGeometry) => !skip.has(g.userData.owner);
      // (in slices, the photo pass's second assembly too: one task of it stalled the page)
      for (const [mat, geos] of parts) {
        if (!await pace()) return null;
        const list = geos.filter(kept);
        if (!list.length) continue;
        const mesh = new THREE.Mesh(keep(mergeGeometries(list, false)!), mat);
        mesh.castShadow = mesh.receiveShadow = true;
        out.push(mesh);
      }
      const reliefKept = relief.filter((_, j) => !skip.has(reliefOwner[j] ?? ""));
      if (reliefKept.length) {
        const unit = keep(new THREE.BoxGeometry(1, 1, 1));
        const ledges = new THREE.InstancedMesh(unit, low, reliefKept.length);
        reliefKept.forEach((m, j) => ledges.setMatrixAt(j, m));
        ledges.castShadow = ledges.receiveShadow = true;
        ledges.computeBoundingSphere();
        out.push(ledges);
        disposables.push(ledges);
      }
      for (const style of styles) {
        if (!await pace()) return null;
        const list = ctxGeos[style].filter(kept);
        if (!list.length) continue;
        // (the complex's own low sides join the shop facade unindexed: indexed as they are, to merge)
        for (const g of list) if (!g.index) g.setIndex(Array.from({ length: g.getAttribute("position").count }, (_, i) => i));
        const merged = keep(mergeGeometries(list, false)!);
        // Apartment neighbours get the apartment facade (neutral colours, one variant, no
        // base, end walls or crown: those stay the complex's own). Shared by every complex,
        // compiled while the first one loads.
        if (!await sharedContextTexturesSliced(style, pace)) return null;
        const ctxMat = sharedContextMaterial(style);
        if (first) lit.windows.push(ctxMat);
        const ctxMesh = new THREE.Mesh(merged, ctxMat);
        ctxMesh.castShadow = ctxMesh.receiveShadow = true;
        out.push(ctxMesh);
      }
      const parKept = parapets.filter((_, j) => !skip.has(parapetOwner[j] ?? ""));
      if (parKept.length) {
        // Same material and instanced pipeline as the towers' floor ledges.
        const unit = keep(new THREE.BoxGeometry(1, 1, 1));
        const im = new THREE.InstancedMesh(unit, low, parKept.length);
        parKept.forEach((m, j) => im.setMatrixAt(j, m));
        im.castShadow = im.receiveShadow = true;
        im.computeBoundingSphere();
        out.push(im);
        disposables.push(im);
      }
      return out;
    };
    const releasePieces = () => {
      for (const geos of parts.values()) geos.forEach(g => g.dispose());
      for (const style of styles) ctxGeos[style].forEach(g => g.dispose());
    };
    {
      const out = await assemble(new Set(), true);
      if (!out) return;
      assembled = out;
      group.add(...assembled);
      if (!photoPending) releasePieces();
    }
    // Building numbers painted on end walls: one texture per number, dark grey on clear.
    const numberMats = new Map<string, THREE.MeshStandardMaterial>();
    const numberMaterial = (label: string) => {
      let m = numberMats.get(label);
      if (m) return m;
      const cv = document.createElement("canvas"); cv.width = 512; cv.height = 256;
      const g2 = cv.getContext("2d", { willReadFrequently: true })!;
      g2.font = `bold 220px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
      g2.textAlign = "center"; g2.textBaseline = "middle"; g2.fillStyle = "#3a3d42";
      const tw = Math.min(500, g2.measureText(label).width + 30);
      g2.fillText(label, 256, 136, 500);
      const tex = keep(new THREE.CanvasTexture(cv));
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.flipY = false;
      // (the quad covers only the digits: uv x cropped to them)
      tex.repeat.set(tw / 512, 1); tex.offset.set((256 - tw / 2) / 512, 0);
      m = keep(new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.userData.aspect = tw / 256;
      numberMats.set(label, m);
      return m;
    };
    // The real buildings: VWorld's photo-textured 3D models (their facades photographed),
    // fetched after the first frame and swapped in for the modelled buildings they match.
    // Accuracy first: a model is used only over a registered footprint (the survey can
    // predate a rebuild) and at a height within 35 % of the registered one; the rest keep
    // their modelled buildings. A constant survey offset between the two sources is taken
    // out first (the median shift between matched centres).
    // Results kept before building names were: the names asked of VWorld once the view is
    // up, matched to the neighbours by position (within 4 m of the footprint's middle).
    if (data.vworld_key && data.center && data.source !== "osm" && !neighbours.some(b => b.title !== undefined)) afterShown(() => void (async () => {
      const names = await vworldBuildingNames(data, data.vworld_key!, data.vworld_domain, reach + 30).catch(() => []);
      if (!alive || !names.length) return;
      const mid = (r: [number, number][]) => [r.reduce((t, q) => t + q[0], 0) / r.length, r.reduce((t, q) => t + q[1], 0) / r.length];
      let n = 0;
      for (const b of neighbours) {
        const [x, y] = mid(b.rings[0]);
        let best: (typeof names)[number] | null = null, bd = 16;
        for (const c of names) { const d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < bd) { bd = d; best = c; } }
        if (!best) continue;
        const before = pickables.length;
        landmark({ ...b, title: best.title, use: b.use ?? best.use, floors: b.floors || best.floors, name: b.name ?? best.dong });
        n += pickables.length - before;
      }
      if (hostRef.current) hostRef.current.dataset.landmarkNames = `${names.length} names, ${n} matched`;
    })());
    if (photoPending) afterShown(() => { stage.busy++; void (async () => {
      let photos: PhotoBuilding[] = [];
      try {
        // (the complex and the blocks round it: ~220 m, 130 on phones — beyond, the modelled ones)
        photos = await photoBuildings(data.vworld_key!, data.center!.lat, data.center!.lon, Math.min(reach, stage.hq ? 220 : 130), { photo: false });
      } catch (err) { console.info("[3D] photo buildings unavailable:", err); }
      const drop = () => photos.forEach(ph => ph.geometry.dispose());
      if (!alive) { drop(); return; }
      const centre = (r: [number, number][]) => [r.reduce((t, q) => t + q[0], 0) / r.length, r.reduce((t, q) => t + q[1], 0) / r.length] as const;
      const feet = [
        ...data.buildings.map((b, i) => ({ owner: "b" + i, ring: b.rings[0], height: b.height, estimated: b.height_source === "estimated" })),
        ...neighbours.map((b, j) => ({ owner: "c" + j, ring: b.rings[0], height: b.height, estimated: b.height_source === "estimated" })),
      ].map(f => ({ ...f, c: centre(f.ring) }));
      const deltas: [number, number][] = [];
      for (const ph of photos) {
        let best: (typeof feet)[number] | null = null, bd = 15;
        for (const f of feet) { const d = Math.hypot(f.c[0] - ph.cx, f.c[1] - ph.cy); if (d < bd) { bd = d; best = f; } }
        if (best) deltas.push([best.c[0] - ph.cx, best.c[1] - ph.cy]);
      }
      const median = (v: number[]) => { const a = [...v].sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; };
      const [dx, dy] = deltas.length >= 3 ? [median(deltas.map(d => d[0])), median(deltas.map(d => d[1]))] : [0, 0];
      const skip = new Set<string>();
      const used: THREE.Mesh[] = [];
      // The surveyed shapes in the view's own materials (lit, shadowed, reflecting, lit at
      // night like the rest): the complex's facade and roof, the neighbours' facade by use.
      const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
      const put = (m: THREE.Material, g: THREE.BufferGeometry | null) => { if (g) byMat.set(m, [...(byMat.get(m) ?? []), g]); };
      const paint = (g: THREE.BufferGeometry | null, c: THREE.Color) => {
        if (!g) return g;
        const n = g.getAttribute("position").count, col = new Float32Array(n * 3);
        for (let j = 0; j < n; j++) col.set([c.r, c.g, c.b], j * 3);
        g.setAttribute("color", new THREE.BufferAttribute(col, 3));
        return g;
      };
      // The real colours: the complex's own buildings' photographs read (not drawn) —
      // the paint of the walls, the band under the roof edge, the roof — and the facade
      // painted again in them. Brand colours stay where the photographs say little.
      // (every photograph read at once, a few at a time by the browser)
      const rhythmOf = new Map(photos.map(ph => [ph, photoRhythm(data.vworld_key!, ph).catch(() => null)] as const));
      await Promise.all(rhythmOf.values());
      if (!alive) { drop(); releasePieces(); return; }
      const own = photos.filter(ph => feet.some(f => f.owner.startsWith("b") && Math.hypot(f.c[0] - (ph.cx + dx), f.c[1] - (ph.cy + dy)) < 12));
      // (a photograph whose walls read near black — deep shade, an empty patch of the image — says
      // nothing of the paint: left out, as in photoAnalysis.wallPaintFrom)
      const lumOf = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      const colours = (await Promise.all(own.slice(0, 8).map(ph => photoColours(data.vworld_key!, ph).catch(() => null)))).filter(c => c && c.samples > 40 && lumOf(c.wall) >= 0.2) as NonNullable<Awaited<ReturnType<typeof photoColours>>>[];
      if (!alive) { drop(); releasePieces(); return; }
      let measured = { bay: BAY_M, storey: FLOOR_M };
      let ownWalls = walls, coreMat: THREE.Material = low, gableMat: THREE.Material = low, bandMat: THREE.Material = crown;
      // (the neighbours' end walls: plain paint in each building's own tint)
      const plainMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
      plainMat.userData.weathered = true; plainMat.userData.detail = "paint";
      if (colours.length) {
        const avg = (pick: (c: (typeof colours)[number]) => number[]) => [0, 1, 2].map(k => colours.map(c => pick(c)[k]).sort((a, b) => a - b)[colours.length >> 1]);
        const hex = (c: number[], lift = 1) => "#" + c.map(v => Math.round(Math.min(1, v * lift) * 255).toString(16).padStart(2, "0")).join("");
        const sat = (c: number[]) => (Math.max(...c) - Math.min(...c)) / Math.max(Math.max(...c), 1e-3);
        const wall = avg(c => c.wall), band = avg(c => c.band), roofC = avg(c => c.roof);
        // (the photographs are shaded: the paint a little brighter than they show it)
        const lift = Math.min(1.35, 0.9 / Math.max(...wall, 0.05));
        const real: Palette = {
          ...palette,
          wall: hex(wall, lift),
          wall2: hex(wall.map(v => v * 0.86), lift),
          // (the stripe as painted: the photograph greys and darkens it — saturation restored)
          // (a blue or cyan "stripe" is glass mirroring the sky in the photograph, not paint)
          accent: (() => {
            const c = new THREE.Color().setRGB(band[0], band[1], band[2]); const hsl = { h: 0, s: 0, l: 0 }; c.getHSL(hsl);
            const sky = hsl.h > 0.5 && hsl.h < 0.7;
            if (sat(band) <= 0.25 || sky) return hex(wall.map(v => v * 0.7), lift);
            c.setHSL(hsl.h, Math.min(0.6, hsl.s * 1.3), Math.min(0.5, Math.max(0.36, hsl.l)));
            return "#" + c.getHexString();
          })(),
          roof: hex(roofC, 1.1),
        };
        // the window pitch and storey measured on the complex's own faces
        const med = (v: number[]) => { const q = [...v].sort((a, b) => a - b); return q.length ? q[q.length >> 1] : null; };
        const rh = await Promise.all(own.map(ph => rhythmOf.get(ph)));
        const bay = med(rh.map(r => r?.bay).filter((v): v is number => !!v)) ?? BAY_M;
        const storey = med(rh.map(r => r?.storey).filter((v): v is number => !!v)) ?? FLOOR_M;
        // (the complex being viewed at twice the texture resolution: 80 texels a metre; phones 1x)
        const sharp = stage.hq ? 2 : 1;
        const fresh = await Promise.all([facadeMaterial(real, seed, bay, storey, sharp), facadeMaterial(real, seed + 7919, bay, storey, sharp)]);
        if (hostRef.current) hostRef.current.dataset.rhythm = `bay ${bay.toFixed(2)} storey ${storey.toFixed(2)}`;
        measured = { bay, storey };
        if (!alive) { drop(); releasePieces(); return; }
        if (fresh[0] && fresh[1]) ownWalls = fresh as THREE.MeshPhysicalMaterial[];
        roof.color.set(real.roof);
        bandMat = keep(new THREE.MeshStandardMaterial({ color: real.accent, roughness: 0.45, metalness: 0.1 }));
        coreMat = keep(new THREE.MeshStandardMaterial({ color: real.wall, roughness: 0.8 }));
        gableMat = keep(new THREE.MeshStandardMaterial({ color: real.wall2, roughness: 0.8 }));
        for (const m of [coreMat, gableMat]) { m.userData.weathered = true; m.userData.detail = "paint"; }
        if (hostRef.current) hostRef.current.dataset.realColours = `${real.wall} ${real.accent} ${real.roof} (${colours.length})`;
      }
      // (B) relief on the complex's window faces, as instanced boxes
      const ledges: THREE.Matrix4[] = [], rails: THREE.Matrix4[] = [], fins: THREE.Matrix4[] = [];
      const ob = new THREE.Object3D();
      const reliefBox = (list: THREE.Matrix4[], x: number, y: number, z: number, sx: number, sy: number, sz: number, ang: number) => {
        ob.position.set(x, y, z); ob.rotation.set(0, 0, ang); ob.scale.set(sx, sy, sz); ob.updateMatrix(); list.push(ob.matrix.clone());
      };
      const relBay = measured.bay, relStorey = measured.storey;
      // The complex's end walls repainted from the paint measured on them (their real bands,
      // blocks and colours; never the photograph itself): one atlas, 7 px a cell, packed in
      // shelves as the walls ask for it; drawn once every wall is placed.
      const ATLAS = 2048, CELL = 7;
      const atlasCv = document.createElement("canvas"); atlasCv.width = atlasCv.height = ATLAS;
      atlasCv.getContext("2d", { willReadFrequently: true });   // (drawn by the CPU: see complexScene canvas)
      const atlasTex = keep(new THREE.CanvasTexture(atlasCv));
      atlasTex.colorSpace = THREE.SRGBColorSpace; atlasTex.anisotropy = 8; atlasTex.flipY = false;
      const paintMat = keep(new THREE.MeshStandardMaterial({ map: atlasTex, roughness: 0.85 }));
      paintMat.userData.weathered = true; paintMat.userData.detail = "paint";
      const slots = new Map<WallPaint, { x: number; y: number }>();
      let shelfX = 0, shelfY = 0, shelfH = 0;
      const slotOf = (w: WallPaint) => {
        let at = slots.get(w);
        if (at) return at;
        const pw = w.cols * CELL + 2, ph2 = w.rows * CELL + 2;
        if (shelfX + pw > ATLAS) { shelfX = 0; shelfY += shelfH; shelfH = 0; }
        if (shelfY + ph2 > ATLAS || pw > ATLAS) return null;
        at = { x: shelfX + 1, y: shelfY + 1 }; slots.set(w, at);
        shelfX += pw; shelfH = Math.max(shelfH, ph2);
        return at;
      };
      const paintsOf = new Map(await Promise.all(photos.map(async ph => [ph, await photoWallPaint(data.vworld_key!, ph).catch(() => [] as WallPaint[])] as const)));
      let k = 0, matched = 0;
      for (const ph of photos) {
        if (!await pace()) { drop(); releasePieces(); return; }
        ph.geometry.computeBoundingBox();
        const height = ph.geometry.boundingBox!.max.z;
        const hull = ph.hull.map(([x, y]) => [x + dx, y + dy] as [number, number]);
        const cx = ph.cx + dx, cy = ph.cy + dy;
        const hits = feet.filter(f => inRing([f.c[0], f.c[1]], hull) || Math.hypot(f.c[0] - cx, f.c[1] - cy) < 6);
        const fits = hits.filter(f => f.estimated || f.height <= 0 || Math.abs(height - f.height) / f.height < 0.35);
        if (!fits.length) { ph.geometry.dispose(); continue; }
        fits.forEach(f => skip.add(f.owner));
        matched++;
        // (which faces have windows: from the photograph, before the model moves — the plane
        // keys are taken in its own frame)
        const windows = (await rhythmOf.get(ph))?.planes;
        // (the complex's own end walls only, by plane key — a face split across buckets finds
        // its paint in the neighbouring ones)
        const own = fits.some(f => f.owner.startsWith("b")), paints = own ? paintsOf.get(ph) ?? [] : [];
        const byKey = new Map(paints.map(w => [w.key, w] as const));
        const paintUv = (key: string, u: number, z: number): [number, number] | null => {
          let w = byKey.get(key);
          if (!w) { const [a0, o0] = key.split(":").map(Number); for (let da = -1; da <= 1 && !w; da++) for (let d0 = -1; d0 <= 1 && !w; d0++) w = byKey.get(`${a0 + da}:${o0 + d0}`); }
          if (!w || u < w.u0 - 0.5 || u > w.u1 + 0.5) return null;
          const at = slotOf(w);
          if (!at) return null;
          const fu = THREE.MathUtils.clamp((u - w.u0) / (w.u1 - w.u0), 0, 1), fz = THREE.MathUtils.clamp((z - w.z0) / (w.z1 - w.z0), 0, 1);
          return [(at.x + fu * w.cols * CELL) / ATLAS, (at.y + (1 - fz) * w.rows * CELL) / ATLAS];
        };
        const shape = surveyedShape(ph, terrain.base(fits[0].ring) - 0.25, windows, 1.0, own ? paintUv : undefined);
        for (const g of [shape.walls, shape.roofs, shape.cores, shape.ends, shape.bands, shape.painted]) g?.translate(dx, dy, 0);
        ph.geometry.dispose();
        const main = fits.some(f => f.owner.startsWith("b"));
        if (main) {
          put(ownWalls[k++ % 2], shape.walls);
          put(roof, shape.roofs);
          put(coreMat, shape.cores);
          put(gableMat, shape.ends);
          put(paintMat, shape.painted);
          put(bandMat, shape.bands);
          // (no boxed relief over the surveyed faces: ledges, rails and fins laid over the
          // measured shapes read as scaffolding and formwork — an unfinished building — at
          // corners and on stepped fronts; the facade paint carries the balconies)
          // The building's number on its end walls, as painted there (43동 → 43).
          const nb = data.buildings[Number(fits.find(f => f.owner.startsWith("b"))!.owner.slice(1))];
          const label = (nb?.name ?? "").match(/\d+/)?.[0];
          if (label && shape.roofZ !== null) for (const e of shape.endPlanes) {
            const m = numberMaterial(label);
            const h = Math.min(4.2, e.width * 0.3), w = h * (m.userData.aspect as number);
            const cx = e.x + dx + e.nx * 0.08, cy = e.y + dy + e.ny * 0.08, z = shape.roofZ - 2.6 - h / 2;
            const rx = -e.ny * w / 2, ry = e.nx * w / 2;
            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.Float32BufferAttribute([
              cx - rx, cy - ry, z - h / 2, cx + rx, cy + ry, z - h / 2, cx + rx, cy + ry, z + h / 2, cx - rx, cy - ry, z + h / 2], 3));
            g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
            g.setAttribute("normal", new THREE.Float32BufferAttribute([e.nx, e.ny, 0, e.nx, e.ny, 0, e.nx, e.ny, 0, e.nx, e.ny, 0], 3));
            g.setIndex([0, 1, 2, 0, 2, 3]);
            put(m, keep(g));
          }
        } else {
          const nb = neighbours[Number(fits[0].owner.slice(1))];
          const style = contextStyle(nb?.use, height, rnd());
          const c = new THREE.Color(tints[Math.floor(rnd() * tints.length)]);
          if (style === "office") c.lerp(new THREE.Color("#ffffff"), 0.4);
          if (style === "apt") c.lerp(new THREE.Color("#ffffff"), 0.65);
          const m = sharedContextMaterial(style);
          put(m, paint(shape.walls, c));
          put(m, paint(shape.roofs, c));   // (the context material paints its roofs itself)
          // (the lift and stair rooms on the roof, and the parapet band: plain paint, no
          // windows — as the complex's own, and as they are)
          put(plainMat, paint(shape.cores, c));
          put(plainMat, paint(shape.bands, c));
          put(plainMat, paint(shape.ends, c.clone().multiplyScalar(0.86)));
        }
      }
      {
        const unit = keep(new THREE.BoxGeometry(1, 1, 1));
        const wallC = (gableMat as THREE.MeshStandardMaterial).color ?? new THREE.Color("#dcd8cc");
        const slabMat = keep(new THREE.MeshStandardMaterial({ color: wallC.clone().multiplyScalar(0.95), roughness: 0.75 }));
        slabMat.userData.detail = "paint";
        const railMat = keep(new THREE.MeshStandardMaterial({ color: "#e8eaea", roughness: 0.35, metalness: 0.6 }));
        for (const [list, mat] of [[ledges, slabMat], [rails, railMat], [fins, slabMat]] as const) {
          if (!list.length) continue;
          const im = new THREE.InstancedMesh(unit, mat, list.length);
          list.forEach((mm, j) => im.setMatrixAt(j, mm));
          im.castShadow = im.receiveShadow = true;
          im.computeBoundingSphere();
          used.push(im as unknown as THREE.Mesh);
          disposables.push(im);
        }
        if (hostRef.current) hostRef.current.dataset.relief = `${ledges.length}/${rails.length}/${fins.length}`;
      }
      // The measured end-wall paint into the atlas: each cell its paint, a little brighter
      // than the shaded photograph shows it (as the walls' own colour).
      if (slots.size) {
        const g2 = atlasCv.getContext("2d")!;
        for (const [w, at] of slots) {
          let top = 0;
          for (let i = 0; i < w.rgb.length; i += 3) top = Math.max(top, (w.rgb[i] + w.rgb[i + 1] + w.rgb[i + 2]) / 3);
          const lift = Math.min(1.3, 0.85 / Math.max(top, 0.05));
          for (let r = 0; r < w.rows; r++) for (let c = 0; c < w.cols; c++) {
            const o = (r * w.cols + c) * 3, v = (x: number) => Math.round(Math.min(1, x * lift) * 255);
            g2.fillStyle = `rgb(${v(w.rgb[o])},${v(w.rgb[o + 1])},${v(w.rgb[o + 2])})`;
            // (row 0 is the bottom of the wall; each cell spills a pixel so no seams show)
            g2.fillRect(at.x + c * CELL - 1, at.y + (w.rows - 1 - r) * CELL - 1, CELL + 2, CELL + 2);
          }
        }
        atlasTex.needsUpdate = true;
        if (hostRef.current) hostRef.current.dataset.wallPaint = String(slots.size);
      }
      for (const [m, list] of byMat) {
        if (!await pace()) { drop(); releasePieces(); return; }
        const mesh = new THREE.Mesh(keep(mergeGeometries(list, false)!), m);
        list.forEach(g => g.dispose());
        mesh.castShadow = mesh.receiveShadow = true;
        used.push(mesh);
      }
      if (!used.length) {
        // No surveyed shapes here (outside VWorld's 3D coverage): the modelled buildings stay,
        // in the colours the aerial photographs show (roof, its rim, the leaning facade) —
        // or else every complex would look alike — their facade at twice the resolution, and
        // a gable of tiles where the roofs are tiled.
        releasePieces();
        const towers = data.buildings.filter(b => b.floors >= 5);
        const aerial = await aerialColours(data.vworld_key!, data.center!.lat, data.center!.lon, towers.map(b => b.rings[0])).catch(() => [] as never[]);
        if (!alive) return;
        const got = aerial.filter(Boolean) as NonNullable<(typeof aerial)[number]>[];
        const med3 = (list: number[][]) => [0, 1, 2].map(k => list.map(c => c[k]).sort((x, y) => x - y)[list.length >> 1]);
        const hex = (c: number[], lift = 1) => "#" + c.map(v => Math.round(Math.min(1, Math.max(0, v * lift)) * 255).toString(16).padStart(2, "0")).join("");
        let pal: Palette = palette;
        let roofMat: THREE.Material | null = null, rimMat: THREE.Material | null = null;
        if (got.length) {
          const roofC = med3(got.map(g2 => g2.roof));
          const rims = got.map(g2 => g2.rim).filter(Boolean) as number[][];
          const facades = got.map(g2 => g2.facade).filter(Boolean) as number[][];
          const wallC = facades.length ? med3(facades) : null;
          pal = {
            ...palette,
            ...(wallC ? { wall: hex(wallC, Math.min(1.25, 0.92 / Math.max(...wallC, 0.05))), wall2: hex(wallC.map(v => v * 0.85), Math.min(1.25, 0.92 / Math.max(...wallC, 0.05))) } : {}),
            ...(rims.length ? { accent: hex(med3(rims), 1.1) } : {}),
            roof: hex(roofC, 1.1),
          };
          roofMat = keep(new THREE.MeshStandardMaterial({ color: pal.roof, roughness: 0.9 }));
          roofMat.userData.roofDetail = true; roofMat.userData.detail = "roof";
          rimMat = keep(new THREE.MeshStandardMaterial({ color: pal.accent, roughness: 0.45, metalness: 0.2 }));
          if (hostRef.current) hostRef.current.dataset.realColours = `aerial ${pal.wall} ${pal.accent} ${pal.roof} (${got.length}/${towers.length})`;
        }
        const sharp = await Promise.all([facadeMaterial(pal, seed, BAY_M, FLOOR_M, stage.hq ? 2 : 1), facadeMaterial(pal, seed + 7919, BAY_M, FLOOR_M, stage.hq ? 2 : 1)]);
        if (!alive || !sharp[0] || !sharp[1]) return;
        // (new meshes rather than a material swapped under a drawn one: the WebGPU view keeps
        // each mesh's pipeline by its first material)
        // (the ledges and fins in the facade's second colour)
        const reliefMat = got.length ? keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(pal.wall2).lerp(new THREE.Color(pal.wall), 0.4), roughness: 0.75 })) : null;
        assembled = assembled.map(o => {
          if (o instanceof THREE.InstancedMesh) {
            if (!reliefMat || o.material !== low) return o;
            const fresh = new THREE.InstancedMesh(o.geometry, reliefMat, o.count);
            fresh.instanceMatrix.copy(o.instanceMatrix);
            fresh.castShadow = o.castShadow; fresh.receiveShadow = o.receiveShadow;
            fresh.computeBoundingSphere();
            group.remove(o); group.add(fresh); disposables.push(fresh);
            return fresh;
          }
          if (!(o instanceof THREE.Mesh)) return o;
          const j = walls.indexOf(o.material as THREE.MeshPhysicalMaterial);
          if (o.material === trim && got.length) {
            // the end walls, their stripe and the roof cores repainted in the aerial colours
            const g2 = keep(o.geometry.clone()), col = g2.getAttribute("color");
            const nGable = new THREE.Color(pal.wall2).lerp(new THREE.Color(pal.wall), 0.25), nStripe = new THREE.Color(pal.accent);
            const nPlant = new THREE.Color(pal.wall2).lerp(new THREE.Color("#9a9a96"), 0.5);
            const c = new THREE.Color();
            for (let v = 0; v < col.count; v++) {
              c.fromBufferAttribute(col as THREE.BufferAttribute, v);
              const d = (x: THREE.Color) => Math.abs(x.r - c.r) + Math.abs(x.g - c.g) + Math.abs(x.b - c.b);
              const pick = [[gableC, nGable], [stripeC, nStripe], [plantC, nPlant]].sort((p1, p2) => d(p1[0]) - d(p2[0]))[0];
              if (d(pick[0]) < 0.05) col.setXYZ(v, pick[1].r, pick[1].g, pick[1].b);
            }
            const fresh = new THREE.Mesh(g2, trim);
            fresh.castShadow = o.castShadow; fresh.receiveShadow = o.receiveShadow;
            group.remove(o); group.add(fresh);
            return fresh;
          }
          const next = j >= 0 ? sharp[j] : roofMat && o.material === roof ? roofMat : rimMat && o.material === crown ? rimMat : null;
          if (!next) return o;
          const fresh = new THREE.Mesh(o.geometry, next);
          fresh.castShadow = o.castShadow; fresh.receiveShadow = o.receiveShadow;
          group.remove(o); group.add(fresh);
          return fresh;
        });
        // The building numbers on the modelled towers' end walls (their short faces).
        const numbers = new Map<THREE.Material, THREE.BufferGeometry[]>();
        for (const b of towers) {
          const label = (b.name ?? "").match(/\d+/)?.[0];
          if (!label) continue;
          const r0 = b.rings[0], H = b.height + terrain.base(r0);
          const signed = r0.reduce((a2, [x, y], j) => { const q = r0[(j + 1) % r0.length]; return a2 + x * q[1] - q[0] * y; }, 0);
          let longest = 0;
          r0.forEach((p, j) => { const q = r0[(j + 1) % r0.length]; longest = Math.max(longest, Math.hypot(q[0] - p[0], q[1] - p[1])); });
          // (the two ends only: on each side along the long axis, the widest short face)
          let lx = 1, ly = 0;
          r0.forEach((p, j) => { const q = r0[(j + 1) % r0.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]); if (len === longest) { lx = (q[0] - p[0]) / len; ly = (q[1] - p[1]) / len; } });
          const ends = new Map<number, number>();
          r0.forEach((p, j) => {
            const q = r0[(j + 1) % r0.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
            if (len < 8 || len > 24 || len > longest * 0.6) return;
            const ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len;
            const [nx, ny] = signed > 0 ? [uy, -ux] : [-uy, ux];
            const along = nx * lx + ny * ly;
            if (Math.abs(along) < 0.9) return;
            const side = along > 0 ? 1 : -1, cur = ends.get(side);
            if (cur === undefined || len > Math.hypot(r0[(cur + 1) % r0.length][0] - r0[cur][0], r0[(cur + 1) % r0.length][1] - r0[cur][1])) ends.set(side, j);
          });
          r0.forEach((p, j) => {
            if (![...ends.values()].includes(j)) return;
            const q = r0[(j + 1) % r0.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
            const ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len;
            const [nx, ny] = signed > 0 ? [uy, -ux] : [-uy, ux];
            const m = numberMaterial(label);
            const h = Math.min(4.2, len * 0.3), w = h * (m.userData.aspect as number);
            // (on the end-wall panel, 0.12 m proud of the wall, plus a hair)
            const cx = (p[0] + q[0]) / 2 + nx * 0.26, cy = (p[1] + q[1]) / 2 + ny * 0.26, z = H - 2.6 - h / 2;
            const rx = -ny * w / 2, ry = nx * w / 2;
            const g2 = new THREE.BufferGeometry();
            g2.setAttribute("position", new THREE.Float32BufferAttribute([cx - rx, cy - ry, z - h / 2, cx + rx, cy + ry, z - h / 2, cx + rx, cy + ry, z + h / 2, cx - rx, cy - ry, z + h / 2], 3));
            g2.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
            g2.setAttribute("normal", new THREE.Float32BufferAttribute([nx, ny, 0, nx, ny, 0, nx, ny, 0, nx, ny, 0], 3));
            g2.setIndex([0, 1, 2, 0, 2, 3]);
            numbers.set(m, [...(numbers.get(m) ?? []), g2]);
          });
        }
        for (const [m, list] of numbers) {
          const mesh = new THREE.Mesh(keep(mergeGeometries(list, false)!), m);
          list.forEach(g2 => g2.dispose());
          group.add(mesh);
        }
        // Gables of tiles over the towers whose roofs show them.
        const gables: THREE.BufferGeometry[] = [];
        towers.forEach((b, i) => {
          if (!aerial[i]?.pitched) return;
          const r0 = b.rings[0];
          let best = 0, ux = 1, uy = 0;
          r0.forEach((p, j) => { const q = r0[(j + 1) % r0.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]); if (len > best) { best = len; ux = (q[0] - p[0]) / len; uy = (q[1] - p[1]) / len; } });
          // the oriented box: along the longest edge, across it
          let a0 = Infinity, a1 = -Infinity, c0 = Infinity, c1 = -Infinity;
          for (const [x, y] of r0) { const a2 = x * ux + y * uy, c2 = -x * uy + y * ux; a0 = Math.min(a0, a2); a1 = Math.max(a1, a2); c0 = Math.min(c0, c2); c1 = Math.max(c1, c2); }
          const w = c1 - c0, rise = Math.min(4, w * 0.3), z = b.height + terrain.base(r0) + 1.6, cm = (c0 + c1) / 2, eave = 0.4;
          const P = (a2: number, c2: number, zz: number) => [a2 * ux - c2 * uy, a2 * uy + c2 * ux, zz];
          const A = P(a0 - eave, c0 - eave, z), B2 = P(a1 + eave, c0 - eave, z), C = P(a1 + eave, c1 + eave, z), D = P(a0 - eave, c1 + eave, z);
          const R0 = P(a0 - eave, cm, z + rise), R1 = P(a1 + eave, cm, z + rise);
          const tri = (...v: number[][]) => v.flat();
          const pos = [
            ...tri(A, B2, R1), ...tri(A, R1, R0),     // slope on the c0 side
            ...tri(C, D, R0), ...tri(C, R0, R1),      // slope on the c1 side
            ...tri(D, A, R0), ...tri(B2, C, R1),      // gable ends
          ];
          const g2 = new THREE.BufferGeometry();
          g2.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
          g2.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2));
          g2.computeVertexNormals();
          gables.push(g2);
        });
        if (gables.length && roofMat) {
          const tile = keep(new THREE.MeshStandardMaterial({ color: pal.roof, roughness: 0.75, side: THREE.DoubleSide }));
          tile.userData.roofDetail = true;
          const mesh = new THREE.Mesh(keep(mergeGeometries(gables, false)!), tile);
          gables.forEach(g2 => g2.dispose());
          mesh.castShadow = mesh.receiveShadow = true;
          group.add(mesh);
        }
        if (hostRef.current) hostRef.current.dataset.photoBuildings = `0/${photos.length} (aerial${gables.length ? `, ${gables.length} gables` : ""})`;
        stage.resume();
        return;
      }
      const out = await assemble(skip, false);
      if (!out || !alive) { releasePieces(); return; }
      group.remove(...assembled);
      group.add(...out, ...used);
      assembled = out;
      releasePieces();
      if (hostRef.current) {
        hostRef.current.dataset.photoBuildings = `${matched}/${photos.length}`;
        hostRef.current.dataset.photoOffset = `${dx.toFixed(1)},${dy.toFixed(1)}`;
      }
      stage.resume();
    })().finally(() => { stage.busy--; }); });

    const span = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, 60);
    const cx = (box.max.x + box.min.x) / 2, cy = (box.max.y + box.min.y) / 2;
    const dist = Math.max(span, top * 1.4) * 1.1 + 40;

    // The ground: the surveyed parcel landscaped (flat paint only), laid over the real
    // relief; damp paving reflects the towers where the ground is level.
    const T = Math.max(reach * 1.15, span * 0.9 + 120);
    if (import.meta.env.DEV) Object.assign(window, { __holoData: data });
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
    // Beyond the surveyed area the ground is featureless: it fades into the horizon haze — until
    // the 1 km land use is in (farGround.ts), then past that.
    groundMat.userData.edgeFade = true;
    groundMat.userData.farGround = { map: blankFar(), half: FAR_HALF, on: false };
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
    // The model and its ground reach the scene together, in one frame. The complex left behind
    // stays until this one is fully drawn (its pipelines and ground ready: before that it would
    // stand on bare sky), a little lower meanwhile so this one's roofs and ground win where the
    // two coincide; then it is freed.
    stage.scene.add(group, ground);
    if (behind) { for (const o of behind.parts()) o.position.y -= 0.25; stage.onShown.push(letGo); }
    stage.unshown = true;

    // Street furniture on the surveyed roads: raised sidewalks with kerbs, street trees
    // in pits, lamps, traffic and people walking. All of it after the first frame.
    stage.scene.add(decor);
    const roads = stitchedRoads(data.roads ?? []);
    // (the plant kit — meshes, twig and bark textures, ~3 MB — after the first frame: fetched and
    // decoded alongside it, it held the first frame back by a few hundred ms)
    afterShown(() => { preloadPlants(); void vehicleShapes().catch(() => {}); });
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
        // The new paint swapped in (the texture takes the new canvas and uploads it again):
        // drawn over the old one, three 2048 px copies by the CPU held a frame ~90 ms.
        plan[k].image = next[k].image;
        plan[k].userData.released = false;   // (the new canvas emptied in its turn once uploaded)
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
      const walks = await buildSidewalks(runs, terrain, street.map(([x, y]) => [x, y] as [number, number]));
      if (!alive) { walks.dispose(); return; }
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
      const crowd = async (paths: WalkPath[], salt: number, spacing: number, cap: number, cut = true) => {
        // (cut 40 paths a slice: all at once was ~20 ms of a frame)
        let open = paths;
        if (cut) {
          open = [];
          for (let i = 0; i < paths.length; i += 40) {
            if (i && !await later()) return;
            open.push(...timed("cutPaths", () => cutPaths(paths.slice(i, i + 40), blocked)));
          }
        }
        const walkers = await buildWalkers(open, terrain, seed + salt, spacing, cap);
        if (!walkers) return;
        if (!alive) { walkers.dispose(); return; }
        stage.addWarm(decor, walkers.group);
        if (import.meta.env.DEV) {
          ((stage as unknown as { walkers: unknown[] }).walkers ??= []).push(...walkers.group.userData.walkers);
          (stage as unknown as { terrainAt: (x: number, y: number) => number }).terrainAt = (x, y) => terrain.at(x, y);
        }
        disposables.push(walkers);
        tick.push(dt => walkers.update(dt, stage.camera));
      };
      await crowd([...sidewalkPaths(runs), ...ringPaths(data.site, 2.4, blocked, 0.5), ...ringPaths(data.buildings.filter(b => b.floors >= 5).map(b => b.rings[0]), -3.2, blocked, 0.45)],
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
        planting.border = schoolBorders(parcels, blocked, T);
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
          const boats = await buildBoats(water.field, cx, cy, seed);
          if (!alive) { boats?.dispose(); return; }
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
        // carriageways: laid out 20 parcels per slice (60 were ~30 ms), in idle time.
        void (async () => {
          const edges: [Ring, number, number, number][] = [
            ...parcels.filter(p => p.kind === "도").map(p => [p.ring, 1.1, 0.4, 12] as [Ring, number, number, number]),
            ...parcels.filter(p => p.kind === "공" || p.kind === "원" || p.kind === "체").map(p => [p.ring, 2.2, 0.5, 20] as [Ring, number, number, number]),
          ].filter(([ring]) => ring.some(([x, y]) => Math.abs(x) < T && Math.abs(y) < T));
          const paths: WalkPath[] = [];
          for (let i = 0; i < edges.length; i += 20) {
            await nextSlice(pausedRef.current);
            if (!alive) return;
            timed("parcelEdges", () => { for (const [ring, off, lateral, minLen] of edges.slice(i, i + 20)) paths.push(...cutPaths(ringPaths([ring], off, blocked, lateral, minLen), blocked)); });
          }
          await nextSlice(pausedRef.current);
          if (alive) await crowd(paths, 1, 9, stage.hq ? 700 : 220, false);
        })();
        const plants = await timed("buildPlants", () => buildPlants(planting, seed, terrain, stage.hq));
        if (!plants) return;
        if (!alive) { plants.dispose(); return; }
        // (the trees dealt out to their levels, once: fixed by where they stand)
        plants.update?.();
        stage.addWarm(decor, plants.mesh);
        disposables.push(plants);
      } catch (err) { console.info("[3D] Plants unavailable:", err); }
    })());
    // Street lamps on the surveyed roads (lit from dusk), and traffic both ways.
    // (made in slices after the first frame; the look applied to them once they are in)
    let lamps: Awaited<ReturnType<typeof buildLamps>> | null = null;
    afterShown(() => void buildLamps(plan.lamps, terrain).then(l => {
      if (!alive) { l.dispose(); return; }
      lamps = l; stage.addWarm(decor, l.group); l.setLevel(stage.look.lamps);
    }));
    // A desktop's neighbourhood painted again at twice the texels, in idle time once all this is
    // in (complexScene.sharpenNeighbourhood: once a session, kept between visits).
    // The neighbourhood out to 1 km (ringBuildings.ts): every registered building past this
    // view's own data, made in a worker after the first frame (the JSONP, the footprints, the
    // extrusion on the relief all off the page) and drawn in the same shared facades — a mesh per
    // style. (OpenStreetMap results have no key: no ring.) Once the near decoration is in (4 s
    // after the first frame, then idle time): alongside it, the worker's network and the GPU's
    // uploads made that loading stutter more; a model left before then fetches nothing.
    const ringStop = new AbortController();
    disposables.push({ dispose: () => ringStop.abort() });
    stage.stopExtras = () => ringStop.abort();
    const whenIdle = (f: () => void) => { if (typeof requestIdleCallback === "function") requestIdleCallback(f, { timeout: 3000 }); else window.setTimeout(f, 200); };
    afterShown(() => { window.setTimeout(() => whenIdle(() => {
      if (!alive || ringStop.signal.aborted || !data.center || !data.vworld_key || new URLSearchParams(location.search).get("ring") === "0") return;
      const near = new Float32Array([...data.buildings, ...data.context].flatMap(b => {
        const r = b.rings[0]; let x = 0, y = 0;
        for (const [px, py] of r) { x += px; y += py; }
        return [x / r.length, y / r.length];
      }));
      if (hostRef.current) hostRef.current.dataset.ringStart = performance.now().toFixed(0);
      void ringBuildings(data, near, terrain, { outer: 1000, floorM: CONTEXT_FLOOR_M, seed, signal: ringStop.signal }).then(async ring => {
        if (!ring || !alive || ringStop.signal.aborted) return;
        if (hostRef.current) hostRef.current.dataset.ringGot = performance.now().toFixed(0);
        let aptGeo: THREE.BufferGeometry | null = null;
        for (const [style, a] of Object.entries(ring.styles) as [ContextStyle, NonNullable<typeof ring.styles.apt>][]) {
          if (!await pace(true)) return;
          const geo = keep(new THREE.BufferGeometry());
          geo.setAttribute("position", new THREE.BufferAttribute(a.position, 3));
          geo.setAttribute("normal", new THREE.BufferAttribute(a.normal, 3));
          geo.setAttribute("uv", new THREE.BufferAttribute(a.uv, 2));
          geo.setAttribute("color", new THREE.BufferAttribute(a.color, 3));
          geo.setIndex(new THREE.BufferAttribute(a.index, 1));
          geo.computeBoundingSphere();
          if (!await sharedContextTexturesSliced(style, pace)) return;
          const mesh = new THREE.Mesh(geo, sharedContextMaterial(style));
          mesh.castShadow = mesh.receiveShadow = true;
          stage.addWarm(group, mesh);
          if (style === "apt") aptGeo = geo;
        }
        // The ground under the ring in its land use (farGround.ts): parcels by 지목, roads, channels.
        whenIdle(() => {
          if (!alive || ringStop.signal.aborted || new URLSearchParams(location.search).get("far") === "0") return;
          const { lawn, paddy } = seasonGround();
          void farGround(data, terrain, { half: FAR_HALF, size: 1024, lawn, paddy, signal: ringStop.signal }).then(fg => {
            if (!fg) return;
            if (!alive || ringStop.signal.aborted) { fg.bitmap.close(); return; }
            const tex = keep(new THREE.Texture(fg.bitmap as unknown as HTMLImageElement));
            tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = 8; tex.needsUpdate = true;
            tex.userData.releaseAfterUpload = true;
            // (the near land use reaches only the parcels' square: the picture past it, inside the
           // painted square too; without parcels, everywhere past the painted square)
           const pb = data.parcels?.length ? parcelBox(data) : null;
           groundMat.userData.farGround = { map: tex, half: FAR_HALF, on: true, box: pb ? [pb[0], -pb[3], pb[2], -pb[1]] : null };
            groundMat.needsUpdate = true;
            if (hostRef.current) hostRef.current.dataset.farGround = `${fg.parcels} parcels in ${Math.round(fg.ms)} ms`;
          });
        });
        // The ring's apartment blocks in their surveyed shapes (VWorld 3D), as the near ones: shapes
        // only — no photographs (hundreds of them) — the long fronts windowed, the end walls and short
        // returns plain, roof rooms and parapet bands as painted. Each replaces its block in the ring
        // mesh (its triangles emptied). Re-indexed after: vertices shared, as compact as the ring.
        if (aptGeo && ring.apts.length) {
          const geoA = aptGeo as THREE.BufferGeometry, A = ring.apts;
          const blocks = Array.from({ length: A.length / 6 }, (_, i) => ({ x: A[i * 6], y: A[i * 6 + 1], h: A[i * 6 + 2], g: A[i * 6 + 3], s: A[i * 6 + 4], n: A[i * 6 + 5], used: false }));
          await new Promise<void>(r => whenIdle(r));
          if (!alive || ringStop.signal.aborted) return;
          const photos = await photoBuildingsNear(data.vworld_key!, data.center!.lat, data.center!.lon, blocks, { signal: ringStop.signal }).catch(() => [] as PhotoBuilding[]);
          if (!alive) { photos.forEach(ph => ph.geometry.dispose()); return; }
          const pairs: [number, number][] = [];
          for (const ph of photos) {
            let bd = 15, best: (typeof blocks)[number] | null = null;
            for (const bl of blocks) { const d = Math.hypot(bl.x - ph.cx, bl.y - ph.cy); if (d < bd) { bd = d; best = bl; } }
            if (best) pairs.push([best.x - ph.cx, best.y - ph.cy]);
          }
          const mid = (v: number[]) => { const q = [...v].sort((a, b) => a - b); return q.length ? q[q.length >> 1] : 0; };
          const [ox, oy] = pairs.length >= 3 ? [mid(pairs.map(p => p[0])), mid(pairs.map(p => p[1]))] : [0, 0];
          const aptMat = sharedContextMaterial("apt");
          const plain = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
          const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
          const put = (m: THREE.Material, g: THREE.BufferGeometry | null, c: THREE.Color) => {
            if (!g) return;
            const n = g.getAttribute("position").count, col = new Float32Array(n * 3);
            for (let j = 0; j < n; j++) { col[j * 3] = c.r; col[j * 3 + 1] = c.g; col[j * 3 + 2] = c.b; }
            g.setAttribute("color", new THREE.BufferAttribute(col, 3));
            // (vertices shared building by building, a few ms each between slices: the whole ring
            // at once was a 120 ms stall)
            const shared = fastMergeVertices(g);
            if (shared !== g) g.dispose();
            byMat.set(m, [...(byMat.get(m) ?? []), shared]);
          };
          const idx = geoA.index!, colA = geoA.getAttribute("color");
          let replaced = 0;
          const hide: [number, number][] = [];
          for (const ph of photos) {
            if (!await pace() || ringStop.signal.aborted) { photos.forEach(q => q.geometry.dispose()); return; }
            const px = ph.cx + ox, py = ph.cy + oy;
            let bd = 12, best: (typeof blocks)[number] | null = null;
            for (const bl of blocks) { if (bl.used) continue; const d = Math.hypot(bl.x - px, bl.y - py); if (d < bd) { bd = d; best = bl; } }
            ph.geometry.computeBoundingBox();
            const top = ph.geometry.boundingBox!.max.z;
            if (!best || top < best.h * 0.65 || top > best.h * 1.35) { ph.geometry.dispose(); continue; }
            best.used = true; replaced++;
            const shape = surveyedShape(ph, best.g - 0.25, undefined, 1.0);
            for (const gg of [shape.walls, shape.roofs, shape.cores, shape.ends, shape.bands, shape.painted]) gg?.translate(ox, oy, 0);
            ph.geometry.dispose();
            const vi = idx.getX(best.s), c = new THREE.Color(colA.getX(vi), colA.getY(vi), colA.getZ(vi));
            // (a pause between the parts: one building's shape and its five merges together were
            // 20-50 ms of a frame)
            for (const [m, g, cc] of [[aptMat, shape.walls, c], [aptMat, shape.roofs, c], [plain, shape.cores, c], [plain, shape.bands, c], [plain, shape.ends, c.clone().multiplyScalar(0.86)]] as const) {
              if (!await pace() || ringStop.signal.aborted) { photos.forEach(q => q.geometry.dispose()); return; }
              put(m, g, cc);
            }
            hide.push([best.s, best.n]);
          }
          if (!replaced) return;
          for (const [m, geos] of byMat) {
            if (!await pace(true)) return;
            const compact = mergeGeometries(geos, false);
            geos.forEach(g => g.dispose());
            if (!compact) continue;
            keep(compact);
            compact.computeBoundingSphere();
            const mesh = new THREE.Mesh(compact, m);
            mesh.castShadow = mesh.receiveShadow = true;
            stage.addWarm(group, mesh);
          }
          // (the blocks' boxes go only once their surveyed shapes are in: a stop halfway leaves none
          // missing)
          for (const [st, n] of hide) (idx.array as Uint32Array).fill(0, st, st + n);
          idx.needsUpdate = true;
          if (hostRef.current) hostRef.current.dataset.ringSurveyed = `${replaced}/${blocks.length}`;
        }
        if (hostRef.current) { hostRef.current.dataset.ring = `${ring.buildings} in ${Math.round(ring.ms)} ms`; hostRef.current.dataset.ringAt = performance.now().toFixed(0); }
      });
    }), 4000); });
    if (stage.hq) afterShown(() => { window.setTimeout(() => void sharpenNeighbourhood(async () => { await nextSlice(true); return true; }).then(() => { if (hostRef.current) hostRef.current.dataset.sharp = "2x"; }), 4000); });
    disposables.push({ dispose: () => lamps?.dispose() });
    const onLook = [(l: Look) => lamps?.setLevel(l.lamps)];
    // Traffic (its vehicle kit decodes on first use) waits for the first frame and idle time.
    afterShown(() => void nextSlice(pausedRef.current).then(() => (alive ? buildTraffic(roads, seed, stage.hq, terrain) : null)).then(traffic => {
      if (!traffic) return;
      if (!alive) { traffic.dispose(); return; }
      stage.addWarm(decor, traffic.group);
      disposables.push(traffic);
      tick.push(dt => traffic.update(dt, stage.camera.position));
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
    // (from another complex: the camera glides from where it was into this one's opening shot,
    // the look from the balloon turns to it, and the balloon flies on to its sky)
    if (shift) {
      const cam = stage.camera.position.clone(), look = stage.controls.target.clone();
      stage.frame();
      const toPos = stage.camera.position.clone(), toTarget = stage.controls.target.clone();
      stage.camera.position.copy(cam); stage.controls.target.copy(look); stage.controls.update();
      stage.fly = stage.balloonView ? null : { fromPos: cam, toPos, fromTarget: look, toTarget, t0: stage.now, dur: 1.6 };
      if (stage.balloonView) stage.balloonView.aim = center.clone();
    } else {
      stage.frame();
      stage.fly = null;
    }
    stage.intro = null;
    stage.balloon?.setRoute(center, span, top, !!shift);
    if (stage.balloon) stage.balloon.group.visible = true;
    else stage.balloonRoute = [center.clone(), span, top];
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
    stage.building = false;
    stage.resume();
    })().catch(err => { stage.building = false; console.warn("[3D] Model build failed:", err); });
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
    bv.aim = undefined;
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
  // (a move to a neighbouring complex keeps the ride: the balloon flies there)
  useEffect(() => { if (balloonOn) leaveBalloon(); }, [homeId]);
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

  // 주변 단지: the apartment complexes round the page's complex (VWorld's 공동주택 and the
  // parcels they stand on, matched to the trades' 지번 by the server), once its view is up.
  useEffect(() => {
    if (!homeId || complexId !== homeId || !data?.found || !data.center || !data.vworld_key || nearby?.home === homeId) return;
    let live = true;
    const st = stageRef.current, res = data, home = homeId;
    const go = () => void nearbyFor(home, res)
      .then(items => {
        if (!live) return;
        setNearby({ home, name: res.name, lat: res.center!.lat, lon: res.center!.lon, items });
        // The nearest few are fetched ahead (shapes, roads, relief), in idle time: most choices
        // are among them, and the view then has them at once.
        // (their facades too, one complex after another, kept in the paint store)
        const ahead = () => {
          items.slice(0, 3).forEach(i => prefetchComplex(i.id));
          void items.slice(0, 3).reduce((done, i) => done.then(() => (live ? paintAhead(i.id) : undefined)), Promise.resolve());
        };
        if (typeof requestIdleCallback === "function") requestIdleCallback(ahead, { timeout: 4000 }); else window.setTimeout(ahead, 2000);
      })
      .catch(err => console.info("[3D] Nearby complexes unavailable:", err));
    // (after the first frame and the neighbourhood's own requests: none of it may slow the view)
    const timer = window.setTimeout(() => { if (st?.unshown) st.onShown.push(go); else go(); }, 1200);
    return () => { live = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, homeId]);
  const near = nearby && nearby.home === homeId ? nearby : null;
  /** 단지 팻말: a name sign over the shown complex and over each complex within 500 m of it,
   * floating above its tallest roof; a click goes there (as the 주변 단지 list does). An HTML
   * layer moved each frame by transform alone: nothing drawn on the GPU, nothing laid out. */
  const signs = useMemo(() => {
    if (!data?.found || !data.center || !complexId || new URLSearchParams(location.search).get("signs") === "0") return [];
    const t = terrainRef.current;
    const towers = data.buildings.filter(b => b.rings[0]?.length);
    const mid = towers.flatMap(b => b.rings[0]).reduce((m, [x, y], _, a) => [m[0] + x / a.length, m[1] + y / a.length], [0, 0]);
    const top = towers.reduce((m, b) => Math.max(m, b.height + t.base(b.rings[0])), 0);
    const out = [{ id: complexId, name: data.name, x: mid[0], y: mid[1], z: top || t.at(0, 0) + 40, here: true }];
    if (near) {
      const others = [...near.items.map(i => ({ id: i.id, name: i.name, lat: i.lat, lon: i.lon, floors: i.floors ?? 15 })),
        { id: homeId!, name: near.name, lat: near.lat, lon: near.lon, floors: 20 }];
      for (const o of others) {
        if (o.id === complexId) continue;
        const [x, y] = metresFrom(data.center, o.lat, o.lon);
        if (Math.hypot(x, y) > 520) continue;
        out.push({ id: o.id, name: o.name, x, y, z: t.at(x, y) + o.floors * FLOOR_M + GROUND_M, here: false });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, near, complexId, homeId, loading]);
  const signEls = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    const st = stageRef.current;
    if (!st) return;
    const v = new THREE.Vector3(), at = new Map<string, string>();
    st.signs = (camera, w, h) => {
      for (const sgn of signs) {
        const el = signEls.current.get(sgn.id);
        if (!el) continue;
        // (14 m over the roof: clear of the crown and the rooftop signs)
        v.set(sgn.x, sgn.z + 14, -sgn.y);
        const d = v.distanceTo(camera.position);
        v.project(camera);
        const shown = v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15 && !st.balloonView?.aim;
        const k = THREE.MathUtils.clamp(520 / d, 0.62, 1);
        const css = shown ? `translate3d(${((v.x + 1) * 0.5 * w).toFixed(1)}px,${((1 - v.y) * 0.5 * h).toFixed(1)}px,0) translate(-50%,-100%) scale(${k.toFixed(2)})` : "";
        // (written only when it changed: a style write each frame dirtied the page)
        if (at.get(sgn.id) === css) continue;
        at.set(sgn.id, css);
        if (css) { el.style.transform = css; el.style.visibility = "visible"; el.style.zIndex = String(Math.round(10000 - d)); }
        else el.style.visibility = "hidden";
      }
    };
    return () => { if (st.signs) st.signs = null; };
  }, [signs]);
  /** Show another complex in detail: the camera (or, riding it, the balloon) sets off
   * toward it at once over the current scene while its shapes load; the new model then
   * takes over centred on it, and the balloon circles its sky. */
  const goTo = (id: string) => {
    if (!near || !homeId || id === complexId) return;
    const home = id === homeId;
    const item = home ? null : near.items.find(i => i.id === id);
    if (!home && !item) return;
    const st = stageRef.current, cur = data;
    setTip(null);
    if (st && cur?.found && cur.center) {
      const [x, y] = metresFrom(cur.center, item?.lat ?? near.lat, item?.lon ?? near.lon);
      const ground = terrainRef.current.at(x, y);
      const roof = ground + (item?.floors ?? 20) * FLOOR_M + GROUND_M;
      hopRef.current = { id, from: { ...cur.center }, terrain: terrainRef.current };
      const spot = new THREE.Vector3(x, ground, -y);
      // (the balloon over the taller of the two: it never passes through a tower)
      st.balloon?.setRoute(spot, 160, Math.max(st.top, roof), true);
      const mid = spot.clone().setY(ground + (roof - ground) * 0.45);
      if (st.balloonView) st.balloonView.aim = mid;
      else flyTo(mid, Math.max(260, (roof - ground) * 3), THREE.MathUtils.clamp(Math.hypot(x, y) / 300, 1.2, 2.4));
      st.resume();
    } else hopRef.current = null;
    setHop(home ? null : { id, name: item!.name, home: homeId });
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
          <strong>{(hop && loading ? hop.name : data?.name) ?? complexName ?? "단지를 선택하세요"}</strong>
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
        {/* 주변 단지: a row of its own under the name and the tools (inside the name's block it
         * widened it into the tools in the narrow rail) */}
          {near && near.items.length > 0 && (
            <select className="re-holo-nearby" value={hop?.id ?? ""} onChange={e => goTo(e.currentTarget.value || homeId!)}
              // (opening the list: the first few are fetched while the reader chooses)
              onFocus={() => near.items.slice(0, 6).forEach(i => prefetchComplex(i.id))}
              aria-label="주변 아파트 단지 자세히 보기" title="주변 아파트 단지를 고르면 그 단지를 자세히 그리고, 열기구가 그 위로 옮겨 갑니다">
              <option value="">{hop ? `↩ 내 단지로 · ${near.name}` : `주변 단지 ${near.items.length}곳 보기`}</option>
              {near.items.map(i => {
                const d = Math.hypot(i.x, i.y);
                return <option key={i.id} value={i.id}>{`${i.name} · ${bearing(i.x, i.y)} ${d < 950 ? `${Math.round(d / 10) * 10}m` : `${(d / 1000).toFixed(1)}km`}`}</option>;
              })}
            </select>
          )}
      </header>
      <div className="re-holo-stage" ref={hostRef} onPointerMove={onMove} onPointerDown={onDown} onPointerUp={onUp}
        onPointerCancel={e => { pointers.current.delete(e.pointerId); press.current = null; }}
        onPointerEnter={() => { hovering.current = true; }}
        onDoubleClick={e => { if (!stageRef.current?.balloonView && e.target instanceof HTMLCanvasElement) focusAt(e); }}
        onPointerLeave={e => { hovering.current = false; if (e.pointerType === "mouse" && !tip?.pinned) setTip(null); }}>
        {data?.found && !loading && !notice && <div className="re-holo-scene-label" aria-hidden="true"><span>ARCHITECTURAL VIEW</span><strong>{sceneTitle}</strong></div>}
        {hudOn && <pre ref={hudRef} style={{ position: "fixed", right: 8, bottom: 8, zIndex: 2147483647, margin: 0, padding: "6px 8px", background: "rgba(0,0,0,.65)", color: "#9f9", font: "11px/1.35 ui-monospace, monospace", pointerEvents: "none", whiteSpace: "pre" }} />}
        {notice && <p className="re-holo-stale" role="note">{notice}</p>}
        {!loading && signs.length > 0 && (
          <div className="re-holo-signs">
            {signs.map(sg => (
              <button key={sg.id} type="button" ref={el => { if (el) signEls.current.set(sg.id, el); else signEls.current.delete(sg.id); }}
                className={`re-holo-sign${sg.here ? " is-here" : ""}`} style={{ visibility: "hidden" }}
                onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
                onClick={() => (sg.here ? undefined : goTo(sg.id))}
                title={sg.here ? sg.name : `${sg.name}(으)로 이동`} aria-label={sg.here ? sg.name : `${sg.name}(으)로 이동`}>
                {sg.name}
              </button>
            ))}
          </div>
        )}
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
