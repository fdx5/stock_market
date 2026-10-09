import * as THREE from "three";
import type { RealEstateBuildingsResponse, RealEstateParcel } from "../api/client";
import { buildWater, type WaterField } from "./sceneWater";
import { buildSeaWorks } from "./sceneSeaWorks";
import { Landmarks, LANDMARK_SITES, type LandmarkSite } from "./sceneLandmarks";
import { ringTile, SURVEY_STYLES, type DroneLabel, type RingResult } from "./ringBuildings";
import type { ColourJob, ColourResult, SurveyJob, SurveyResult } from "./droneSurveyWorker";
import { roadTile } from "./droneRoads";
import { DroneTraffic } from "./droneTraffic";
import { farGround } from "./farGround";
import { vworldSampler, type Terrain } from "./sceneTerrain";
import { gridAt } from "./waterCore";
import { CONTEXT_FLOOR_M, seasonGround, sharedContextMaterial, sharedContextTexturesSliced, type ContextStyle, type Planting } from "./complexScene";
import { buildPlants } from "./scenePlants";
import { frameSlice } from "./frameSlice";
import { textureBudgetEnabled } from "./textureBudget";

/* The drone's world past the view's own neighbourhood (ComplexHologram: the complex, its 600 m
 * ring of buildings and the ±680 m land-use ground). Fixed square tiles of TILE_M, in the view's
 * frame (metres east / north of the complex, heights from its ground), each made the way the view
 * makes its neighbourhood — the same generators, so the same look:
 *   - relief: VWorld's national DEM (국토지리정보원), the same posts the view's ground samples
 *     (sceneTerrain.vworldSampler), so neighbouring tiles meet exactly;
 *   - buildings: every registered building (국토교통부 GIS건물통합정보) whose centroid is in the
 *     tile, extruded in a worker in the shared neighbourhood facades (ringBuildings.ringTile);
 *   - ground: the parcels in their registered land use (연속지적도 지목), painted in a worker
 *     (farGround.ts), with its park and woodland trees (scenePlants).
 *   - sea: the coastline's sea (bundled on the server, /api/realestate/water), the view's own
 *     water surface — swell, surf, its depth over the sand — at sea level, the ground under it
 *     sunk below it; not inside the view's square (its own water is there).
 * The tiles inside the view's own square draw only what it does not (the ring's corners past
 * 600 m) and give the collision roofs. Loading runs ahead of the drone: by distance from where it
 * will be in a few seconds, more tiles the higher it flies. `clearAhead` tells the flight how far
 * along a direction everything is on screen — the flight keeps 300 m of it ahead (droneFlight.ts).
 *
 * Palace courtyards also receive the requested earth, lawn and flower garden treatment.
 * Where VWorld does not answer, a tile stays empty and is retried. */

export const TILE_M = 340;
/** The coarse sea laid round the drone at once (see regionSea), half a side (m). */
const REGION_SEA = 3000;
/** The view's own neighbourhood: buildings out to RING_M (a disc), land use over ±FAR_HALF. */
export type ViewExtent = { ring: number; farHalf: number };

type Roofs = NonNullable<RingResult["roofs"]>;
type TileGrid = { h: Float32Array; n: number; R: number; cell: number; ox: number; oy: number };
type Tile = {
  i: number; j: number; key: string; box: [number, number, number, number]; cx: number; cy: number;
  /** Inside the view's own land-use square: no ground of its own. */
  inner: boolean;
  state: "queued" | "loading" | "placed" | "ready" | "failed";
  tries: number; retryAt: number;
  grid: TileGrid | null; at: ((x: number, y: number) => number) | null;
  roofs: Roofs | null;
  zup: THREE.Group | null; yup: THREE.Group | null;
  materials: THREE.Material[]; dispose: (() => void)[];
  stop: AbortController;
  startedAt: number; readyAt: number;
  /** Its trees (park and woodland), kept to be planted while the drone is within PLANT_R. */
  planting: Planting | null; local: Terrain | null;
  plants: { state: "building" | "placed" | "ready"; group: THREE.Group | null; materials: THREE.Material[]; dispose: () => void } | null;
  /** Its towers (RingResult.towers) and the style meshes they sit in, for their surveyed shapes. */
  towers: Float32Array | null; styleGeo: Partial<Record<ContextStyle, THREE.BufferGeometry>>;
  survey: "none" | "running" | "placed" | "ready";
  /** its buildings' vertex spans and outlines (RingResult.spans), and their aerial colours' state */
  spans?: Float32Array; spanRings?: number[][][]; colour?: "running" | "done";
  /** its lane paint (true to size, broad) and how many bridges */
  marks?: (THREE.Mesh | null)[]; bridges?: number;
  /** its fine parts, not drawn far off (FINE_R) */
  fine?: THREE.Mesh[];
  /** its sidewalks' middle lines ([n, x, y, …]…), for the people */
  walkPaths?: Float32Array;
  /** its lanes for the traffic (droneRoads) */
  lanes?: Float32Array;
  /** whether its buildings and its trees cast shadows now */
  castB: boolean; castP: boolean;
  surveyGroup: THREE.Group | null;
  /** its water as the server had it (asked before the rest; undefined: not yet asked) */
  seaBody?: SeaBody | null;
};
type SeaBody = { rings?: { ring: [number, number][]; kind: string; islands?: [number, number][][] }[]; beaches?: { ring: [number, number][] }[]; works?: { kind: string; closed: boolean; pts: [number, number][] }[] };
/** A ring cut to an axis-aligned box (Sutherland–Hodgman; a concave ring leaving and coming back
 * keeps a seam along the box's edge, harmless to the fill). */
function clipToBox(ring: [number, number][], [x0, y0, x1, y1]: [number, number, number, number]): [number, number][] {
  let pts = ring;
  const edges: [(p: [number, number]) => boolean, (a: [number, number], b: [number, number]) => [number, number]][] = [
    [p => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / ((b[0] - a[0]) || 1e-9)]],
    [p => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / ((b[0] - a[0]) || 1e-9)]],
    [p => p[1] >= y0, (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / ((b[1] - a[1]) || 1e-9), y0]],
    [p => p[1] <= y1, (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / ((b[1] - a[1]) || 1e-9), y1]],
  ];
  for (const [inside, cross] of edges) {
    if (!pts.length) break;
    const out: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + pts.length - 1) % pts.length];
      if (inside(p)) { if (!inside(q)) out.push(cross(q, p)); out.push(p); }
      else if (inside(q)) out.push(cross(q, p));
    }
    pts = out;
  }
  return pts;
}
export type DroneWorldStats = { tiles: number; ready: number; loading: number; failed: number; buildings: number; lastMs: number; radius: number };

const key = (i: number, j: number) => `${i},${j}`;
/** numbers per tower in RingResult.towers */
const TOWER = 9;
/** Shadows off for everything under `root`, or back to what each mesh cast before. */
const castShadows = (root: THREE.Object3D, on: boolean) => root.traverse(o => {
  if (!(o as THREE.Mesh).isMesh) return;
  o.userData.castWas ??= o.castShadow;
  o.castShadow = on && o.userData.castWas;
});
/** Trees are planted on the tiles within this distance of the drone (past it a tree is a dot in the
 * haze; the land use underneath stays green), and kept until 400 m beyond. Within PLANT_NEED, a tile
 * counts as on screen only with its trees. */
const PLANT_R = { hq: 1050, lite: 700 }, PLANT_NEED = 700;
/** The towers in their surveyed shapes (VWorld's 3D models: the real plan, setbacks, rooftop rooms)
 * on the tiles within this distance; kept once made. */
const SURVEY_R = { hq: 800, lite: 500 }, SURVEY_NEED = 600;
/** Past this distance a tile's fine parts — sidewalks, bridge railings and piers, the true-to-size
 * lane paint — are not drawn (each under a pixel there; the broad lane paint stands in). */
const FINE_R = 700;
/** Shadows are cast by the buildings within this distance of the drone and by trees within
 * TREE_SHADOW (past them a shadow is a few pixels in the haze; each caster costs a draw in every
 * shadow cascade it reaches). */
const BUILDING_SHADOW = 700, TREE_SHADOW = 350;
/** Each building's colours from the aerial photographs (roof, facade) on the tiles within this
 * distance — before their towers take their surveyed shapes, which keep the colour they find. */
const COLOUR_R = { hq: 600, lite: 400 };
/** (?dronecolour=0: without them, for comparing) */
const OFF = typeof location !== "undefined" ? (new URLSearchParams(location.search).get("droneoff") ?? "").split(",") : [];
const DTRACE = typeof location !== "undefined" && location.search.includes("dtrace=1");
const NO_COLOUR = typeof location !== "undefined" && (new URLSearchParams(location.search).get("dronecolour") === "0" || OFF.includes("colour"));
const distToBox = (x: number, y: number, b: [number, number, number, number]) =>
  Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - y, 0, y - b[3]));

export class DroneWorld {
  readonly root = new THREE.Group();
  private tiles = new Map<string, Tile>();
  private base: number | null = null;
  private baseJob: Promise<number | null> | null = null;
  private loading = 0;
  private disposed = false;
  private slice = performance.now();
  private buildings = 0;
  private lastMs = 0;
  private radius = 900;
  private planting = 0;
  private surveying = 0;
  private shadowCheck = 0;
  /** Cores, bands and end walls of the surveyed towers: one material for every tile. */
  private plain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  /** The roads (droneRoads): asphalt and lane paint, one material each for every tile. */
  private asphalt = new THREE.MeshStandardMaterial({ color: "#3d4045", roughness: 0.9, metalness: 0 });
  private paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, emissive: "#ffffff", emissiveIntensity: 0.12 });
  /** Bridge slabs, parapets and piers. */
  private concrete = new THREE.MeshStandardMaterial({ color: "#b9b6ae", roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  /** Sidewalk paving and kerbs. */
  private paving = new THREE.MeshStandardMaterial({ color: "#a7a39b", roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  /** The cars on them. */
  readonly traffic: DroneTraffic;
  readonly landmarks: Landmarks;
  private readonly kx: number;
  private readonly ky = 110540;
  private readonly season = seasonGround(undefined, textureBudgetEnabled());

  constructor(private readonly o: {
    data: RealEstateBuildingsResponse; terrain: Terrain; extent: ViewExtent; seed: number; hq: boolean;
    addWarm: (parent: THREE.Object3D, obj: THREE.Object3D) => void;
    drawReady: (obj: THREE.Object3D) => boolean;
    forget?: (materials: Set<THREE.Material>) => void;
    /** where the view's own trees stand (view frame): on the collision grid of its tiles */
    viewTrees?: () => [number, number][];
    /** a tile's signs (null: gone) */
    onLabels?: (tile: string, labels: DroneLabel[] | null) => void;
  }) {
    this.kx = Math.cos((o.data.center!.lat * Math.PI) / 180) * 111320;
    this.root.name = "drone world";
    // (WebGPU: the same asphalt grain as the view's road surfaces)
    this.asphalt.userData.groundDetail = true;
    this.traffic = new DroneTraffic(o.seed + 31);
    this.root.add(this.traffic.group);
    // The landmarks: the palaces and stadiums in VWorld's photo-textured models, 광안대교 built.
    this.landmarks = new Landmarks({
      key: o.data.vworld_key!, lat0: o.data.center!.lat, lon0: o.data.center!.lon, hq: o.hq,
      groundAt: (x, y) => this.groundAt(x, y),
      // (the sea, 0 m on the national DEM: −base in the view frame)
      seaLevel: () => { void this.baseHeight(); return this.base === null ? null : -this.base; },
      addWarm: o.addWarm, forget: o.forget,
      onPlaced: site => { for (const t of this.tiles.values()) this.hideInSite(t, site); },
    });
    this.root.add(this.landmarks.root);
  }

  /** Builders keep to ~2 ms of a frame (frameSlice admits them after the view has drawn). */
  private async pace(force = false) {
    if (force || performance.now() - this.slice > 2) { await frameSlice(6); this.slice = performance.now(); }
    return !this.disposed;
  }

  private tileAt(x: number, y: number) { return this.tiles.get(key(Math.floor(x / TILE_M), Math.floor(y / TILE_M))); }

  /** Ground height (view frame): the tile's own relief where it has one, else the view's. */
  groundAt(x: number, y: number): number {
    const t = this.tileAt(x, y);
    return t?.at ? t.at(x, y) : this.o.terrain.at(x, y);
  }
  /** The highest roof over (x, y) — from the tile's collision grid — or -1e4 where none. */
  roofAt(x: number, y: number): number {
    const r = this.tileAt(x, y)?.roofs;
    if (!r) return -1e4;
    const i = Math.floor((x - r.x0) / r.cell), j = Math.floor((y - r.y0) / r.cell);
    return i < 0 || j < 0 || i >= r.nx || j >= r.ny ? -1e4 : r.h[j * r.nx + i];
  }
  /** Whether a tile `d` m from the drone is fully on screen: its buildings and ground, and near
   * the drone its trees too. */
  private shown(t: Tile, _d: number) {
    // (what holds the drone back: the tile's buildings, ground, roads and lane paint. The trees and
    // the towers' surveyed shapes come in over it as it flies, nearest first.)
    return t.state === "ready";
  }
  /** The distance from (x, y) to the nearest tile not yet fully on screen within `max` (m). */
  nearestUnready(x: number, y: number, max: number): number {
    let d = max;
    for (const t of this.tiles.values()) { const b = distToBox(x, y, t.box); if (!this.shown(t, b)) d = Math.min(d, b); }
    // (tiles not even made yet: anything past the loading radius)
    return Math.min(d, this.radius);
  }
  /** How far from (x, y) everything ahead — the half of the world in front along (dx, dy), a
   * unit vector, the sides included — is on screen, up to `max`: the nearest tile not yet on
   * screen there (or the edge of what is loading). */
  clearAhead(x: number, y: number, dx: number, dy: number, max: number): number {
    let d = Math.min(max, this.radius);
    for (const t of this.tiles.values()) {
      const b = distToBox(x, y, t.box);
      if (b >= d || this.shown(t, b)) continue;
      // (in front: any part of the tile past the line through the drone across its flight)
      const ahead = Math.max((t.box[0] - x) * dx, (t.box[2] - x) * dx) + Math.max((t.box[1] - y) * dy, (t.box[3] - y) * dy);
      if (ahead < 0) continue;
      d = b;
    }
    // (and where no tile has been made yet: along the flight itself)
    for (let s = 0; s <= d; s += 20) if (!this.tileAt(x + dx * s, y + dy * s)) return s;
    return d;
  }
  /** The sidewalks' middle lines on the tiles within `r` of (x, y) (view frame). */
  walkPathsNear(x: number, y: number, r: number): Float32Array[] {
    const out: Float32Array[] = [];
    for (const t of this.tiles.values()) if (t.walkPaths && t.state === "ready" && distToBox(x, y, t.box) < r) out.push(t.walkPaths);
    return out;
  }
  /** The loading radius's share the memory allows (1 normally): a device of 4 GB or less starts at
   * 0.7; with the page's script memory over 65 % of its limit it steps down (and the tiles past the
   * smaller radius go), under 50 % it steps back up — the page never runs out of memory. */
  private memScale = typeof navigator !== "undefined" && ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4 ? 0.7 : 1;
  private memAt = 0;
  private memoryScale() {
    const now = performance.now();
    if (now - this.memAt > 1000) {
      this.memAt = now;
      const m = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
      if (m && m.jsHeapSizeLimit > 0) {
        const use = m.usedJSHeapSize / m.jsHeapSizeLimit;
        if (use > 0.65) this.memScale = Math.max(0.45, this.memScale - 0.1);
        else if (use < 0.5) this.memScale = Math.min(this.memCap(), this.memScale + 0.02);
      }
    }
    return this.memScale;
  }
  private memCap() { return typeof navigator !== "undefined" && ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4 ? 0.7 : 1; }
  /** How much later a tile comes for being out of the camera's view (m in the queue). */
  private offView(t: Tile, x: number, y: number, look?: [number, number]) {
    if (!look) return 0;
    const cx = t.cx - x, cy = t.cy - y, cl = Math.hypot(cx, cy);
    if (cl < TILE_M) return 0;
    const c = (cx * look[0] + cy * look[1]) / cl;
    return c > 0.64 ? 0 : 3000 * (1 - c);
  }
  /** How far round the drone tiles are loaded now (m). */
  get reach() { return this.radius; }
  stats(): DroneWorldStats {
    let ready = 0, failed = 0;
    for (const t of this.tiles.values()) { if (t.state === "ready") ready++; else if (t.state === "failed") failed++; }
    return { tiles: this.tiles.size, ready, loading: this.loading, failed, buildings: this.buildings, lastMs: this.lastMs, radius: this.radius };
  }

  /** Each frame: tiles wanted round the drone (at x, y, `alt` m over the ground, moving vx, vy)
   * queued nearest-to-where-it-will-be first; tiles left far behind freed; placed tiles checked. */
  update(x: number, y: number, vx: number, vy: number, alt: number, look?: [number, number]) {
    if (this.disposed) return;
    if (!OFF.includes("sea") && !this.regionBusy && (!this.region || Math.hypot(x - this.region.x, y - this.region.y) > REGION_SEA * 0.5)) void this.regionSea(x, y);
    if (!OFF.includes("landmarks")) this.landmarks.update(x, y);
    // (higher, more of the city in sight: 1.15 km low down, 1.8 km at 500 m; less on a phone — and
    // loaded for where the drone will be in 5.5 s)
    this.radius = Math.min(this.o.hq ? 1820 : 1260, 1155 + Math.max(0, alt) * 1.4) * this.memoryScale();
    // (and 200 m more ahead still, the way it flies — or looks, hovering — so what it comes to was
    // loaded well before: the front never waits)
    const sp = Math.hypot(vx, vy), fx = sp > 1 ? vx / sp : look?.[0] ?? 0, fy = sp > 1 ? vy / sp : look?.[1] ?? 0;
    const R = this.radius, lead = 5.5, ax = x + vx * lead + fx * 200, ay = y + vy * lead + fy * 200;
    const now = performance.now(), plantR = this.o.hq ? PLANT_R.hq : PLANT_R.lite;
    const plantWant: [number, Tile][] = [];
    const far: [number, Tile][] = [];
    for (const t of this.tiles.values()) {
      if (t.state === "placed" && this.placedReady(t)) { t.state = "ready"; t.readyAt = now; this.lastMs = now - t.startedAt; performance.mark?.(`drone:ready ${t.key}`); }
      const d = Math.min(distToBox(x, y, t.box), distToBox(ax, ay, t.box));
      // (out of reach: freed at once — its meshes, textures and workers' arrays — with 250 m of slack
      // so a tile on the edge is not loaded and freed by turns)
      if (d > R + 250) { this.drop(t); continue; }
      far.push([d, t]);
      // Trees: planted coming within reach, cleared going well past it.
      if (t.plants?.state === "placed" && t.plants.group && this.o.drawReady(t.plants.group)) t.plants.state = "ready";
      if (t.planting && t.state === "ready" && !t.plants && d <= plantR && !OFF.includes("plants")) plantWant.push([d + this.offView(t, x, y, look), t]);
      else if (t.plants && t.plants.state !== "building" && d > plantR + 200) this.unplant(t);
    }
    // Colours from the aerial photographs, two tiles at a time, nearest first.
    const colourR = this.o.hq ? COLOUR_R.hq : COLOUR_R.lite;
    let colourBusy = 0, colourNext: [number, Tile] | null = null;
    for (const t of this.tiles.values()) {
      if (t.colour === "running") colourBusy++;
      if (t.state !== "ready" || t.colour || !t.spans?.length) continue;
      const d = distToBox(x, y, t.box);
      if (d <= colourR && (!colourNext || d < colourNext[0])) colourNext = [d, t];
    }
    if (colourNext && colourBusy < 2) { if (NO_COLOUR) colourNext[1].colour = "done"; else void this.colourTile(colourNext[1]); }
    // Towers: their surveyed shapes, nearest to where the drone is going first, a few tiles at a
    // time (their models come over the network; the merging is the page's, in short slices).
    const surveyR = this.o.hq ? SURVEY_R.hq : SURVEY_R.lite;
    const surveyWant: [number, Tile][] = [];
    for (const t of this.tiles.values()) {
      if (t.survey === "placed" && t.surveyGroup && this.o.drawReady(t.surveyGroup)) t.survey = "ready";
      if (t.state !== "ready" || t.survey !== "none" || !t.towers?.length) continue;
      const d = Math.min(distToBox(x, y, t.box), distToBox(ax, ay, t.box)) + this.offView(t, x, y, look);
      if (d <= surveyR && !OFF.includes("survey")) surveyWant.push([d, t]);
    }
    surveyWant.sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < Math.min((this.o.hq ? 4 : 2) - this.surveying, surveyWant.length); k++) void this.surveyTile(surveyWant[k][1]);
    // Shadows from the near tiles only (with 80 m of slack: not switched back and forth); the lane
    // paint true to size within ~260 m of the camera (its height counted), broad past it.
    if (++this.shadowCheck % 15 === 0) for (const t of this.tiles.values()) {
      const d = distToBox(x, y, t.box);
      // (the lane paint, true to size, drawn within ~700 m of the camera: past it, under a pixel)
      if (t.marks?.[0]) t.marks[0].visible = Math.hypot(d, alt) < (t.marks[0].visible ? 760 : 700);
      const fine = d < FINE_R;
      for (const m of t.fine ?? []) m.visible = fine;
      const b = t.castB ? d < BUILDING_SHADOW + 80 : d < BUILDING_SHADOW, p = t.castP ? d < TREE_SHADOW + 80 : d < TREE_SHADOW;
      if (b !== t.castB) { t.castB = b; if (t.zup) castShadows(t.zup, b); }
      if (p !== t.castP) { t.castP = p; if (t.plants?.group) castShadows(t.plants.group, p); }
    }
    // Never more tiles than the device holds: the nearest `cap` places within reach are the only ones
    // made; a tile past them (with a few of slack) goes at once. (Freeing tiles the loop below then made
    // again, frame after frame, was what ran the memory out and kept the ones ahead from loading.)
    const cap = this.o.hq ? 90 : 45;
    const keep = this.nearestPlaces(x, y, ax, ay, R, cap);
    if (far.length > cap) {
      far.sort((a, b) => b[0] - a[0]);
      let over = far.length - cap;
      for (const [, t] of far) { if (over <= 0) break; if (!keep.has(t.key)) { this.drop(t); over--; } }
    }
    plantWant.sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < Math.min((this.o.hq ? 4 : 2) - this.planting, plantWant.length); k++) void this.plant(plantWant[k][1]);
    const i0 = Math.floor((Math.min(x, ax) - R) / TILE_M), i1 = Math.floor((Math.max(x, ax) + R) / TILE_M);
    const j0 = Math.floor((Math.min(y, ay) - R) / TILE_M), j1 = Math.floor((Math.max(y, ay) + R) / TILE_M);
    const want: [number, Tile][] = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const box: [number, number, number, number] = [i * TILE_M, j * TILE_M, (i + 1) * TILE_M, (j + 1) * TILE_M];
      const near = Math.min(distToBox(x, y, box), distToBox(ax, ay, box));
      if (near > R || !keep.has(key(i, j))) continue;
      // (the way the camera looks first: a tile within ~50° of the view comes before any tile out of
      // it, nearest first among each; the one under the drone always first)
      let order = near;
      if (look && near > TILE_M / 2) {
        const cx = (box[0] + box[2]) / 2 - x, cy = (box[1] + box[3]) / 2 - y, cl = Math.hypot(cx, cy) || 1, c = (cx * look[0] + cy * look[1]) / cl;
        // (out of the view's cone a tile comes later in proportion to its distance — never behind
        // every tile in view: a near tile beside the drone waited there for good, and held it)
        // (ahead and to the sides — within ~70° of the view — first; abeam a little later; behind last)
        order *= c > 0.34 ? 1 : c > -0.34 ? 1.2 : 1.6 + 0.6 * (1 - c);
      }
      let t = this.tiles.get(key(i, j));
      if (!t) { t = this.make(i, j, box); this.tiles.set(t.key, t); }
      if (t.state === "queued" || (t.state === "failed" && now > t.retryAt)) want.push([order, t]);
    }
    want.sort((a, b) => a[0] - b[0]);
    const slots = (this.o.hq ? 8 : 3) - this.loading;
    for (let k = 0; k < Math.min(slots, want.length); k++) void this.load(want[k][1]);
  }

  /** The keys of the `cap` places (tiles) nearest the drone or where it is going, within R. */
  private nearestPlaces(x: number, y: number, ax: number, ay: number, R: number, cap: number) {
    const i0 = Math.floor((Math.min(x, ax) - R) / TILE_M), i1 = Math.floor((Math.max(x, ax) + R) / TILE_M);
    const j0 = Math.floor((Math.min(y, ay) - R) / TILE_M), j1 = Math.floor((Math.max(y, ay) + R) / TILE_M);
    const all: [number, string][] = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const box: [number, number, number, number] = [i * TILE_M, j * TILE_M, (i + 1) * TILE_M, (j + 1) * TILE_M];
      const near = Math.min(distToBox(x, y, box), distToBox(ax, ay, box));
      if (near <= R) all.push([near, key(i, j)]);
    }
    all.sort((a, b) => a[0] - b[0]);
    return new Set(all.slice(0, cap).map(a => a[1]));
  }
  /** The places whose OpenStreetMap answers were asked for already (each once a page). */
  private warmed = new Set<string>();
  private make(i: number, j: number, box: [number, number, number, number]): Tile {
    const H = this.o.extent.farHalf;
    // The site's OpenStreetMap answers (water, crossings) asked now, unawaited: the server fetches
    // them on a first ask, and by the time this tile is built they are in its cache.
    if (typeof location !== "undefined" && !this.warmed.has(key(i, j))) {
      this.warmed.add(key(i, j));
      const c = this.o.data.center!, la = +(c.lat + ((box[1] + box[3]) / 2) / this.ky).toFixed(4), lo = +(c.lon + ((box[0] + box[2]) / 2) / this.kx).toFixed(4);
      const q = `lat=${la.toFixed(4)}&lon=${lo.toFixed(4)}`;
      void fetch(`${location.origin}/api/realestate/crossings?${q}&r=260&v=3`).catch(() => {});
      void fetch(`${location.origin}/api/realestate/water?${q}&r=${Math.round((TILE_M / 2) * 1.5)}&v=3&fast=1`).catch(() => {});
    }
    return {
      i, j, key: key(i, j), box, cx: (box[0] + box[2]) / 2, cy: (box[1] + box[3]) / 2,
      inner: box[0] >= -H - 1 && box[2] <= H + 1 && box[1] >= -H - 1 && box[3] <= H + 1,
      state: "queued", tries: 0, retryAt: 0, grid: null, at: null, roofs: null, zup: null, yup: null,
      materials: [], dispose: [], stop: new AbortController(), startedAt: 0, readyAt: 0,
      planting: null, local: null, plants: null, towers: null, styleGeo: {}, survey: "none", surveyGroup: null, castB: true, castP: true,
    };
  }

  /** (checks) the meshes of a tile not yet drawable */
  notReady(k: string) {
    const t = this.tiles.get(k), out: string[] = [];
    for (const g of [t?.zup, t?.yup]) g?.traverseVisible(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !this.o.drawReady(m)) out.push(`${m.name || "?"}|${(Array.isArray(m.material) ? m.material : [m.material]).map(x => x.type + ":" + (x.name || "")).join("+")}|cast${+m.castShadow}|n${(m.geometry.index?.count ?? 0)}`);
    });
    return out.slice(0, 8);
  }
  private placedReady(t: Tile) {
    return (!t.zup || this.o.drawReady(t.zup)) && (!t.yup || this.o.drawReady(t.yup));
  }

  /** The DEM's height at the view's centre, which the view's heights count from. */
  private baseHeight(): Promise<number | null> {
    const { data } = this.o;
    this.baseJob ??= vworldSampler(data.vworld_key!, data.center!.lat, data.center!.lon, 20)
      .then(s => (s ? s(data.center!.lon, data.center!.lat) : null)).catch(() => null)
      .then(b => { this.base = b; return b; });
    return this.baseJob;
  }

  /** The tile's relief on a 4 m grid over it and a margin, and (for long bridges' ends) on a 16 m
   * grid over ±1.3 km round it. */
  private async tileGrid(t: Tile): Promise<{ grid: TileGrid; wide: TileGrid | null } | null> {
    // (a 160 m margin: the buildings across the tile's edge, and a bridge's near end)
    const { data } = this.o, R = TILE_M / 2 + 160, cell = 4, n = Math.round((2 * R) / cell) + 1;
    const lat = data.center!.lat + t.cy / this.ky, lon = data.center!.lon + t.cx / this.kx;
    const WR = 1300, wcell = 16, wn = Math.round((2 * WR) / wcell) + 1;
    const [base, sampler, wideSampler] = await Promise.all([this.baseHeight(), vworldSampler(data.vworld_key!, lat, lon, R + 8).catch(() => null),
      t.inner ? Promise.resolve(null) : vworldSampler(data.vworld_key!, lat, lon, WR + 20).catch(() => null)]);
    const fill = async (gr: number, gc: number, gn: number, smp: typeof sampler) => {
      const h = new Float32Array(gn * gn);
      for (let j = 0; j < gn; j++) {
        for (let i = 0; i < gn; i++) {
          const x = t.cx - gr + i * gc, y = t.cy - gr + j * gc;
          h[j * gn + i] = smp && base !== null ? smp(data.center!.lon + x / this.kx, data.center!.lat + y / this.ky) - base : this.o.terrain.at(x, y);
        }
        if (!await this.pace()) return null;
      }
      return { h, n: gn, R: gr, cell: gc, ox: t.cx, oy: t.cy };
    };
    const grid = await fill(R, cell, n, sampler);
    if (!grid) return null;
    const wide = wideSampler && base !== null ? await fill(WR, wcell, wn, wideSampler) : null;
    return { grid, wide };
  }

  private async load(t: Tile) {
    const { data, hq } = this.o;
    t.state = "loading"; t.tries++; t.startedAt = performance.now();
    this.loading++;
    const stop = t.stop = new AbortController();
    const fail = () => {
      if (this.disposed || stop.signal.aborted) return;
      this.clear(t);
      // A failed tile is still missing. Keep retrying with backoff; counting an empty tile
      // as ready after three attempts left permanent holes under the palaces and stadiums.
      t.state = "failed";
      t.retryAt = performance.now() + Math.min(30000, 2500 * t.tries);
    };
    try {
      const grids = await this.tileGrid(t);
      if (!grids || stop.signal.aborted) return;
      const grid = grids.grid;
      t.grid = grid;
      const local = gridAt(grid);
      t.at = (x, y) => local(x - grid.ox, y - grid.oy);
      // Its water first (the server answers at once from the bundled coastline): without it the
      // sea would be painted as land — no answer, the tile is tried again. A tile all at sea:
      // nothing to ask VWorld for (no building, road or parcel out there) — only the sea.
      let sea: SeaBody | null = null;
      if (!t.inner && !OFF.includes("sea")) {
        sea = await this.seaAnswer(t);
        if (stop.signal.aborted || this.disposed) return;
        if (!sea) { fail(); return; }
        if (this.seaCovers(sea)) {
          const localTerrain: Terrain = { at: local, base: r => Math.min(...r.map(([x, y]) => local(x, y))), relief: 0, elevation: null, source: "drone tile", grid };
          await this.seaOn(t, null, localTerrain, stop.signal, sea);
          if (stop.signal.aborted || this.disposed) return;
          const zup = new THREE.Group();
          zup.rotation.x = -Math.PI / 2; zup.name = `drone tile ${t.key} (sea)`; zup.updateMatrixWorld();
          t.zup = zup;
          this.o.addWarm(this.root, zup);
          if (t.yup) this.o.addWarm(this.root, t.yup);
          t.state = "placed";
          performance.mark?.(`drone:placed ${t.key} sea`);
          return;
        }
        t.seaBody = sea;
      }
      // The tile's three workers at once: its roads (past the view's own square, where it draws none),
      // its ground's land use and its buildings.
      const dlog = (w: string) => { if (DTRACE) console.info(`[dtile] ${t.key} ${w} ${Math.round(performance.now())}`); };
      dlog("start");
      const roadJob = t.inner || OFF.includes("roads") ? Promise.resolve(null) : roadTile(data.center!.lat, data.center!.lon, data.vworld_key!, data.vworld_domain, t.box, grid, grids.wide, stop.signal,
        { lat: data.center!.lat + t.cy / this.ky, lon: data.center!.lon + t.cx / this.kx }, this.roadExtras(t));
      const tileLat = data.center!.lat + t.cy / this.ky, tileLon = data.center!.lon + t.cx / this.kx;
      const localTerrain: Terrain = { at: local, base: r => Math.min(...r.map(([x, y]) => local(x, y))), relief: 0, elevation: null, source: "drone tile", grid };
      const groundJob = t.inner || OFF.includes("ground") ? Promise.resolve(null) : farGround({ ...data, center: { lat: tileLat, lon: tileLon }, roads: [] } as RealEstateBuildingsResponse, localTerrain,
        { half: TILE_M / 2, size: hq ? 1024 : 512, lawn: this.season.lawn, paddy: this.season.paddy, landscape: textureBudgetEnabled(), nearHalf: 0, footprints: [], signal: stop.signal, rivers: true, lakes: true, water: sea });
      void roadJob.then(() => dlog("roads done")); void groundJob.then(() => dlog("ground done"));
      const ring = OFF.includes("ring") ? null : await ringTile(data.center!.lat, data.center!.lon, data.vworld_key!, data.vworld_domain, t.box, grid,
        { inner: this.o.extent.ring, floorM: CONTEXT_FLOOR_M, seed: this.o.seed + t.i * 7919 + t.j * 104729, heightCell: 2, signal: stop.signal });
      if (stop.signal.aborted || this.disposed) return;
      dlog("ring done");
      if (!ring) { fail(); return; }
      t.roofs = ring.roofs ?? null;
      t.towers = ring.towers ?? null;
      t.spans = ring.spans; t.spanRings = ring.spanRings;
      this.o.onLabels?.(t.key, ring.labels ?? null);
      // (inside the view's square, the trees the view planted itself)
      if (t.inner && t.roofs) this.treesOnGrid(t.roofs, (this.o.viewTrees?.() ?? []).filter(([x, y]) => x >= t.box[0] && y >= t.box[1] && x < t.box[2] && y < t.box[3]), this.o.terrain.at);
      const zup = new THREE.Group();
      zup.rotation.x = -Math.PI / 2;
      zup.name = `drone tile ${t.key}`;
      zup.updateMatrixWorld();
      // The buildings, a mesh per facade style (the shared neighbourhood materials: no new shaders).
      for (const [style, a] of Object.entries(ring.styles) as [ContextStyle, NonNullable<RingResult["styles"]["apt"]>][]) {
        if (!a.index.length) continue;
        if (!await sharedContextTexturesSliced(style, () => this.pace()) || stop.signal.aborted) return;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(a.position, 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(a.normal, 3));
        geo.setAttribute("uv", new THREE.BufferAttribute(a.uv, 2));
        geo.setAttribute("color", new THREE.BufferAttribute(a.color, 3));
        geo.setIndex(new THREE.BufferAttribute(a.index, 1));
        geo.computeBoundingSphere();
        t.dispose.push(() => geo.dispose());
        const mesh = new THREE.Mesh(geo, sharedContextMaterial(style));
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.solid = true;
        zup.add(mesh);
        t.styleGeo[style] = geo;
        if (!await this.pace(true)) return;
      }
      // (inside a landmark site already on screen: its models stand there, not the boxes)
      for (const site of this.landmarks.placedSites()) this.hideInSite(t, site);
      // The roads: asphalt to the road's surveyed width on the relief, lane lines, and the lanes for the cars.
      const roads = await roadJob;
      if (stop.signal.aborted || this.disposed) return;
      if (roads?.surface) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(roads.surface.position, 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(roads.surface.normal, 3));
        geo.setIndex(new THREE.BufferAttribute(roads.surface.index, 1));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, this.asphalt);
        mesh.receiveShadow = true; mesh.name = "drone tile ground";
        zup.add(mesh);
        t.dispose.push(() => geo.dispose());
      }
      const mesh = (a: { position: Float32Array; normal: Float32Array; index: Uint32Array; color?: Float32Array } | null, m: THREE.Material, name: string, cast = false) => {
        if (!a) return null;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(a.position, 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(a.normal, 3));
        if (a.color) geo.setAttribute("color", new THREE.BufferAttribute(a.color, 3));
        geo.setIndex(new THREE.BufferAttribute(a.index, 1));
        geo.computeBoundingSphere();
        const me = new THREE.Mesh(geo, m);
        me.receiveShadow = true; me.castShadow = cast; me.name = name;
        zup.add(me);
        t.dispose.push(() => geo.dispose());
        return me;
      };
      // lane paint: true to size near, broad far (droneWorld.update shows one of them)
      t.marks = [mesh(roads?.marks ?? null, this.paint, "drone tile ground"), mesh(roads?.marksFar ?? null, this.paint, "drone tile ground")];
      if (t.marks[0]) t.marks[0].visible = false;
      t.fine = [mesh(roads?.structure ?? null, this.concrete, "drone tile bridges", true), mesh(roads?.walks ?? null, this.paving, "drone tile ground")].filter(m => !!m) as THREE.Mesh[];
      if (roads?.walkPaths.length) t.walkPaths = roads.walkPaths;
      t.bridges = roads?.bridges ?? 0;
      if (roads?.lanes.length) {
        const lanes = roads.lanes;
        t.lanes = lanes;
      }
      this.buildings += ring.buildings;
      t.dispose.push(() => { this.buildings -= ring.buildings; });
      // Outside the view's square: its own ground in its land use, and the trees on it.
      if (!t.inner) {
        const fg = await groundJob;
        if (stop.signal.aborted || this.disposed) { fg?.bitmap.close(); return; }
        if (!fg) { fail(); return; }
        const ground = this.groundMesh(t, grid, local);
        const tex = new THREE.Texture(fg.bitmap as unknown as HTMLImageElement);
        tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = 8; tex.needsUpdate = true;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.userData.releaseAfterUpload = true;
        const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
        // (WebGPU: the same world-space grass, asphalt and paving detail as the view's ground)
        mat.userData.groundDetail = true;
        const mesh = new THREE.Mesh(ground, mat);
        mesh.receiveShadow = true;
        mesh.name = "drone tile ground";
        zup.add(mesh);
        t.materials.push(mat);
        t.dispose.push(() => { ground.dispose(); tex.dispose(); mat.dispose(); fg.bitmap.close(); });
        if (!await this.pace(true)) return;
        if (!OFF.includes("sea")) await this.seaOn(t, ground, localTerrain, stop.signal);
        if (stop.signal.aborted || this.disposed) return;
        // General park trees are loaded near the drone. The requested palace flower beds
        // and grass tufts also have 3D geometry; their ground colors remain visible from above.
        // (and the street trees by the kerbs of the roads with sidewalks: one species a road)
        const street: [number, number, number][] = [];
        const st = roads?.streetTrees;
        if (st) for (let k = 0; k < st.length; k += 3) street.push([st[k] - t.cx, st[k + 1] - t.cy, st[k + 2]]);
        // (painted before the buildings were in: no tree where a building stands)
        const free = ([lx, ly]: [number, number]) => this.roofAt(lx + t.cx, ly + t.cy) < local(lx, ly) + 1;
        const gardenBeds = fg.gardens.flatMap(g => g.beds).map(b => ({ ...b, points: b.points.filter(free) })).filter(b => b.points.length);
        const gardenGrass = fg.gardens.flatMap(g => g.grass).filter(free);
        mesh.userData.palaceGardens = fg.gardens.map(g => ({ id: g.id, earthM2: g.earthM2, lawnM2: g.lawnM2, flowerM2: g.flowerM2 }));
        const p = { ...fg.planting, trees: fg.planting.trees.filter(free), groves: (fg.planting.groves ?? []).map(g => ({ ...g, points: g.points.filter(free) })),
          shrubs: [], flowers: [], grass: gardenGrass, street, woodlandFlowers: gardenBeds };
        if (textureBudgetEnabled() && (p.trees.length || p.groves?.length || p.street.length || p.grass.length || p.woodlandFlowers.length)) {
          t.planting = p; t.local = localTerrain;
          // (and the drone flies round them)
          if (t.roofs) this.treesOnGrid(t.roofs, [...p.trees, ...p.street.map(([lx, ly]) => [lx, ly] as [number, number]), ...(p.groves ?? []).flatMap(g => g.points)].map(([lx, ly]) => [lx + t.cx, ly + t.cy] as [number, number]), (x, y) => local(x - t.cx, y - t.cy));
        }
      }
      if (this.disposed || stop.signal.aborted) return;
      t.zup = zup;
      this.o.addWarm(this.root, zup);
      if (t.yup) this.o.addWarm(this.root, t.yup);
      t.state = "placed";
      if (t.lanes) this.traffic.addTile(t.key, t.lanes);
      performance.mark?.(`drone:placed ${t.key}`);
    } catch (err) {
      console.info("[3D] drone tile failed:", t.key, err);
      fail();
    } finally {
      this.loading--;
      if (t.state === "loading" && !this.disposed && !stop.signal.aborted) fail();
    }
  }

  /** The sea on a tile (see the top): its surface under t.yup (the tile's centre), the tile's
   * ground (view frame, z up) sunk under it. */
  /** The sea round the drone out to REGION_SEA, at once (the bundled coastline): a coarse surface
   * a little under the tiles' own, so the sea is there before they come in — not their land-use
   * picture's lawn — and past what is loaded. Laid again when the drone has gone half its reach;
   * none inside the view's square (its own sea is there). */
  private region: { x: number; y: number; mesh: THREE.Mesh; field?: WaterField; dispose: () => void } | null = null;
  /** the region's answer (view frame): its sea rings with their islands, and the beaches */
  private regionWater: { x: number; y: number; R: number; rings: { ring: [number, number][]; islands: [number, number][][] }[]; beaches: [number, number][][]; works: NonNullable<SeaBody["works"]> } | null = null;
  private regionWait: (() => void)[] = [];
  private regionBusy = false;
  private async regionSea(x: number, y: number) {
    if (typeof location === "undefined") return;
    this.regionBusy = true;
    try {
      const c = this.o.data.center!, R = REGION_SEA;
      const lat = c.lat + y / this.ky, lon = c.lon + x / this.kx;
      let body: SeaBody | null = null;
      for (let k = 0; k < 4 && !body && !this.disposed; k++) {
        if (k) await new Promise(r => setTimeout(r, 1500 * k));
        body = await fetch(`${location.origin}/api/realestate/water?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&r=${R}&v=3&fast=1`, { signal: AbortSignal.timeout(15000) })
          .then(r => (r.ok ? r.json() : null)).catch(() => null) as SeaBody | null;
      }
      if (this.disposed || !body) return;
      // (its rings in the view frame, for the tiles to cut theirs from: no request a tile)
      const shift = (r: [number, number][]) => r.map(([px, py]) => [px + x, py + y] as [number, number]);
      // (islands under 2500 m² — a bridge pier's footing, a rock — are no hole in the sea: the pier
      // stands in the water)
      const big = (r: [number, number][]) => Math.abs(r.reduce((a, [px, py], i) => { const q = r[(i + 1) % r.length]; return a + px * q[1] - q[0] * py; }, 0) / 2) >= 2500;
      this.regionWater = { x, y, R, rings: (body.rings ?? []).filter(w => w.kind === "sea").map(w => ({ ring: shift(w.ring), islands: (w.islands ?? []).filter(big).map(shift) })), beaches: (body.beaches ?? []).map(b => shift(b.ring)), works: (body.works ?? []).map(w => ({ ...w, pts: shift(w.pts) })) };
      for (const f of this.regionWait.splice(0)) f();
      const seas = (body?.rings ?? []).filter(w => w.kind === "sea");
      if (!seas.length) { this.dropRegion(); this.region = { x, y, mesh: new THREE.Mesh(), dispose: () => {} }; return; }
      const parcels: RealEstateParcel[] = this.regionWater.rings.map(w => ({ kind: "유", sea: true, ring: w.ring, holes: w.islands, open: [x - R, y - R, x + R, y + R] }));
      // National sea datum is 0 m. Per-tile DEM noise must not create different sea levels.
      await this.baseHeight();
      const seaLevel = -(this.base ?? 0);
      const seaTerrain: Terrain = { ...this.o.terrain, at: () => seaLevel,
        grid: { h: new Float32Array([seaLevel, seaLevel, seaLevel, seaLevel]), n: 2, R: 1, cell: 2 } };
      const water = await buildWater(parcels, parcels.map(() => false), seaTerrain, () => this.pace());
      if (!water || this.disposed) { water?.dispose(); return; }
      const geo = water.mesh.geometry, pos = geo.getAttribute("position") as THREE.BufferAttribute, idx = geo.getIndex()!;
      const F = this.o.extent.farHalf, keep: number[] = [];
      for (let k = 0; k < idx.count; k += 3) {
        const a = idx.getX(k), b = idx.getX(k + 1), d = idx.getX(k + 2);
        const cx = (pos.getX(a) + pos.getX(b) + pos.getX(d)) / 3, cy = -(pos.getZ(a) + pos.getZ(b) + pos.getZ(d)) / 3;
        if (Math.abs(cx) < F && Math.abs(cy) < F) continue;
        keep.push(a, b, d);
      }
      if (keep.length !== idx.count) { geo.setIndex(keep); geo.computeBoundingSphere(); }
      // (under the tiles' sea, which takes its place as it comes in)
      water.mesh.position.y = -0.3;
      water.mesh.name = "drone region sea";
      water.mesh.updateMatrixWorld();
      this.dropRegion();
      this.region = { x, y, mesh: water.mesh, field: water.field, dispose: () => water.dispose() };
      // Tiles may have finished first. Give every sea patch the same regional shore/depth field.
      for (const t of this.tiles.values()) for (const mesh of t.yup?.children ?? []) {
        const material = (mesh as THREE.Mesh).material as THREE.Material | undefined;
        if (material?.userData.water && this.regionCovers(t.cx, t.cy)) {
          // Two reflective layers at the same location make the tile grid visible in WebGPU.
          // The continuous regional surface now replaces this temporary tile surface.
          mesh.removeFromParent(); this.o.forget?.(new Set([material]));
        }
      }
      if (keep.length) this.o.addWarm(this.root, water.mesh);
    } finally { this.regionBusy = false; }
  }
  private dropRegion() {
    const r = this.region;
    if (!r) return;
    this.region = null;
    if (r.mesh.parent) { r.mesh.removeFromParent(); this.o.forget?.(new Set([r.mesh.material as THREE.Material])); }
    r.dispose();
  }

  /** What a tile's roads need of the sea and the landmark bridge: the sea round it (out to
   * 1.5 km: a bridge's ends), its level, and 광안대교's deck when it is near. */
  private roadExtras(t: Tile) {
    const w = this.regionWater, M = 1500;
    const box: [number, number, number, number] = [t.box[0] - M, t.box[1] - M, t.box[2] + M, t.box[3] + M];
    const sea = w ? w.rings.map(r => clipToBox(r.ring, box)).filter(r => r.length >= 3) : [];
    const seaLevel = this.base === null ? undefined : -this.base;
    const d = this.landmarks.gwanganDeck();
    const near = d && d.P.some(([x, y]) => x > box[0] && x < box[2] && y > box[1] && y < box[3]);
    return { sea, seaLevel, deck: near ? { pts: d.P, z: d.z } : undefined };
  }

  /** A landmark site's boxes (the register's extrusions on this tile, inside the site's radius)
   * folded away: the site's surveyed models stand there. */
  private hideInSite(t: Tile, site: LandmarkSite) {
    const spans = t.spans, rings = t.spanRings;
    if (!spans || !rings) return;
    const [sx, sy] = this.landmarks.at(site.lat, site.lon), touched = new Set<THREE.BufferGeometry>();
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      if (!r?.length) continue;
      const cx = r.reduce((a, q) => a + q[0], 0) / r.length, cy = r.reduce((a, q) => a + q[1], 0) / r.length;
      if (Math.hypot(cx - sx, cy - sy) > site.radius) continue;
      if (!this.landmarks.hasModelAt(site, cx, cy)) continue;
      const g = t.styleGeo[SURVEY_STYLES[spans[i * 5]]];
      const pos = g?.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (!g || !pos) continue;
      const a = pos.array as Float32Array, w0 = spans[i * 5 + 1], px = a[w0 * 3], py = a[w0 * 3 + 1], pz = a[w0 * 3 + 2] - 50;
      // (every vertex of it at one point under the ground: its triangles have no area)
      const fold = (start: number, count: number) => { for (let v = start; v < start + count; v++) { a[v * 3] = px; a[v * 3 + 1] = py; a[v * 3 + 2] = pz; } };
      fold(spans[i * 5 + 1], spans[i * 5 + 2]); fold(spans[i * 5 + 3], spans[i * 5 + 4]);
      touched.add(g);
    }
    for (const g of touched) { (g.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true; g.computeBoundingSphere(); }
  }

  /** The tile's water, as the server has it at once (its sea from the bundled coastline). */
  private async seaAnswer(t: Tile): Promise<SeaBody | null> {
    if (typeof location === "undefined") return null;
    const H = TILE_M / 2, c = this.o.data.center!;
    // (the region's answer, cut to the tile: waited for a few seconds as it comes)
    const covers = () => { const w = this.regionWater; return !!w && Math.max(Math.abs(t.cx - w.x), Math.abs(t.cy - w.y)) + H <= w.R; };
    if (!covers()) await Promise.race([new Promise<void>(r => this.regionWait.push(r)), new Promise(r => setTimeout(r, 8000))]);
    if (covers()) {
      const w = this.regionWater!, box: [number, number, number, number] = [t.cx - H, t.cy - H, t.cx + H, t.cy + H];
      const local = (r: [number, number][]) => r.map(([px, py]) => [px - t.cx, py - t.cy] as [number, number]);
      const rings: NonNullable<SeaBody["rings"]> = [];
      for (const sw of w.rings) {
        const cut = clipToBox(sw.ring, box);
        if (cut.length < 3) continue;
        const islands = sw.islands.map(h => clipToBox(h, box)).filter(h => h.length >= 3).map(local);
        rings.push({ ring: local(cut), kind: "sea", ...(islands.length ? { islands } : {}) });
      }
      const beaches = w.beaches.map(b => clipToBox(b, box)).filter(b => b.length >= 3).map(b => ({ ring: local(b) }));
      // (the works with a point on the tile — each on the one tile its first point is on, whole)
      const works = w.works.filter(k => { const [px, py] = k.pts[0]; return px >= box[0] && py >= box[1] && px < box[2] && py < box[3]; }).map(k => ({ ...k, pts: local(k.pts) }));
      return { rings, beaches, works };
    }
    const lat = c.lat + t.cy / this.ky, lon = c.lon + t.cx / this.kx;
    return fetch(`${location.origin}/api/realestate/water?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&r=${H}&v=3&fast=1`, { signal: AbortSignal.timeout(12000) })
      .then(r => (r.ok ? r.json() : null)).catch(() => null) as Promise<SeaBody | null>;
  }
  /** Whether the sea covers the whole tile (its islands, rocks and piers aside: under 0.5 %). */
  private seaCovers(body: SeaBody) {
    const area = (r: [number, number][]) => Math.abs(r.reduce((a, [x, y], i) => { const q = r[(i + 1) % r.length]; return a + x * q[1] - q[0] * y; }, 0) / 2);
    let wet = 0;
    for (const w of body.rings ?? []) if (w.kind === "sea") wet += area(w.ring) - (w.islands ?? []).reduce((a, h) => a + area(h), 0);
    return wet >= TILE_M * TILE_M * 0.995;
  }
  /** Tile boundaries are neither shores nor depth changes. Sample the region in world metres. */
  private alignSea(mesh: THREE.Mesh, ox: number, oy: number) {
    const geo = mesh.geometry, pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const shore = geo.getAttribute("aShore") as THREE.BufferAttribute, flow = geo.getAttribute("aFlow") as THREE.BufferAttribute;
    const field = this.region?.field, level = this.base === null ? null : -this.base + 0.12;
    for (let i = 0; i < pos.count; i++) {
      if (level !== null) pos.setY(i, level);
      if (!field) continue;
      const x = pos.getX(i) + ox, y = -pos.getZ(i) + oy, sh = field.shore(x, y);
      shore.setX(i, sh);
      const gx = field.shore(x + 3, y) - field.shore(x - 3, y), gy = field.shore(x, y + 3) - field.shore(x, y - 3), gl = Math.hypot(gx, gy);
      const k = Math.min(1, Math.max(0, (sh - 30) / 50));
      let fx = -0.6, fy = 0.8;
      if (gl > 1e-3 && k < 1) { fx = -gx / gl * (1 - k) - 0.6 * k; fy = gy / gl * (1 - k) + 0.8 * k; const n = Math.hypot(fx, fy) || 1; fx /= n; fy /= n; }
      flow.setXY(i, fx, fy);
    }
    pos.needsUpdate = true; shore.needsUpdate = true; flow.needsUpdate = true;
    geo.computeBoundingSphere();
  }
  private regionCovers(x: number, y: number) {
    const r = this.region, w = this.regionWater;
    return !!r?.field && !!w && Math.max(Math.abs(x - r.x), Math.abs(y - r.y)) + TILE_M / 2 <= w.R;
  }
  private async seaOn(t: Tile, ground: THREE.BufferGeometry | null, terrain: Terrain, signal: AbortSignal, answer?: SeaBody | null) {
    const H = TILE_M / 2;
    const body = answer !== undefined ? answer : t.seaBody !== undefined ? t.seaBody : await this.seaAnswer(t);
    const seas = (body?.rings ?? []).filter(w => w.kind === "sea");
    if (!seas.length || signal.aborted || this.disposed) return;
    const parcels: RealEstateParcel[] = seas.map(w => ({ kind: "유", sea: true, ring: w.ring, holes: w.islands, open: [-H, -H, H, H] }));
    const water = await buildWater(parcels, parcels.map(() => false), terrain, () => this.pace());
    if (!water || signal.aborted || this.disposed) { water?.dispose(); return; }
    this.alignSea(water.mesh, t.cx, t.cy);
    // (none of it inside the view's square: the view's own sea is there)
    const geo = water.mesh.geometry, pos = geo.getAttribute("position") as THREE.BufferAttribute, idx = geo.getIndex()!;
    const F = this.o.extent.farHalf, keep: number[] = [];
    for (let k = 0; k < idx.count; k += 3) {
      const a = idx.getX(k), b = idx.getX(k + 1), d = idx.getX(k + 2);
      const x = (pos.getX(a) + pos.getX(b) + pos.getX(d)) / 3 + t.cx, y = -(pos.getZ(a) + pos.getZ(b) + pos.getZ(d)) / 3 + t.cy;
      if (Math.abs(x) < F && Math.abs(y) < F) continue;
      keep.push(a, b, d);
    }
    if (!keep.length) { water.dispose(); return; }
    if (keep.length !== idx.count) { geo.setIndex(keep); geo.computeBoundingSphere(); }
    // the tile's ground under the sea: below its surface (the DEM's coast rises through it)
    const gp = ground?.getAttribute("position") as THREE.BufferAttribute | undefined;
    let sunk = false;
    if (gp) for (let i = 0; i < gp.count; i++) {
      const lx = gp.getX(i) - t.cx, ly = gp.getY(i) - t.cy;
      if (!water.field.wet(lx, ly)) continue;
      const z = (this.base === null ? water.field.level(lx, ly) : -this.base) - 0.6;
      if (gp.getZ(i) > z) { gp.setZ(i, z); sunk = true; }
    }
    if (sunk && gp && ground) { gp.needsUpdate = true; ground.computeVertexNormals(); ground.computeBoundingSphere(); }
    const yup = t.yup ?? new THREE.Group();
    yup.name = `drone tile ${t.key} sea`;
    yup.position.set(t.cx, 0, -t.cy);
    if (!this.regionCovers(t.cx, t.cy)) yup.add(water.mesh);
    // its breakwaters, groynes and piers (none inside the view's square: the view has its own)
    const works = (body?.works ?? []).filter(k => { const [px, py] = k.pts[0]; return Math.abs(px + t.cx) >= this.o.extent.farHalf || Math.abs(py + t.cy) >= this.o.extent.farHalf; });
    if (works.length) {
      let lvl = this.base === null ? NaN : -this.base;
      if (!Number.isFinite(lvl)) for (const k of works) for (const [px, py] of k.pts) { if (water.field.wet(px, py)) { lvl = water.field.level(px, py); break; } }
      if (!Number.isFinite(lvl)) { const g = (water.mesh.geometry.getAttribute("position") as THREE.BufferAttribute); if (g.count) lvl = g.getY(0) - 0.12; }
      const sw = buildSeaWorks(works, lvl, this.o.seed + t.i * 31 + t.j * 17, { maxTetrapods: this.o.hq ? 1500 : 700 });
      if (sw) {
        yup.add(sw.group);
        sw.group.traverse(o => { const m = (o as THREE.Mesh).material; if (m) for (const x of Array.isArray(m) ? m : [m]) t.materials.push(x); });
        t.dispose.push(() => sw.dispose());
      }
    }
    yup.updateMatrixWorld(true);
    t.yup = yup;
    t.materials.push(water.mesh.material as THREE.Material);
    t.dispose.push(() => water.dispose());
  }

  /** The tile's ground: a 4 m grid on its relief, uv over the land-use picture (north at v 0),
   * with a 4 m skirt round it (no crack against the view's own ground or a neighbour). */
  private groundMesh(t: Tile, grid: TileGrid, at: (x: number, y: number) => number) {
    const S = Math.round(TILE_M / grid.cell), row = S + 1, cell = grid.cell;
    const n = row * row + 4 * row;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), UV = new Float32Array(n * 2);
    const [x0, y0] = t.box;
    const h = (x: number, y: number) => at(x - grid.ox, y - grid.oy);
    for (let j = 0; j < row; j++) for (let i = 0; i < row; i++) {
      const k = j * row + i, x = x0 + i * cell, y = y0 + j * cell, z = h(x, y);
      P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z;
      const nx = h(x - cell, y) - h(x + cell, y), ny = h(x, y - cell) - h(x, y + cell), nz = 2 * cell, l = Math.hypot(nx, ny, nz);
      N[k * 3] = nx / l; N[k * 3 + 1] = ny / l; N[k * 3 + 2] = nz / l;
      UV[k * 2] = i / S; UV[k * 2 + 1] = 1 - j / S;
    }
    const idx: number[] = [];
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
    // Skirts: each edge's vertices again, 4 m lower.
    const edges = [
      Array.from({ length: row }, (_, i) => i),
      Array.from({ length: row }, (_, j) => j * row + S),
      Array.from({ length: row }, (_, i) => S * row + S - i),
      Array.from({ length: row }, (_, j) => (S - j) * row),
    ];
    let o = row * row;
    for (const e of edges) {
      const start = o;
      for (const k of e) {
        P[o * 3] = P[k * 3]; P[o * 3 + 1] = P[k * 3 + 1]; P[o * 3 + 2] = P[k * 3 + 2] - 4;
        N.copyWithin(o * 3, k * 3, k * 3 + 3); UV[o * 2] = UV[k * 2]; UV[o * 2 + 1] = UV[k * 2 + 1];
        o++;
      }
      for (let q = 0; q + 1 < e.length; q++) {
        const a = e[q], b = e[q + 1], c = start + q, d = start + q + 1;
        idx.push(a, c, d, a, d, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(UV, 2));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    geo.computeBoundingSphere();
    return geo;
  }

  /** A tile's towers in their surveyed shapes, as the view's ring does its apartment blocks
   * (ComplexHologram): VWorld's 3D model of each — shape only, never its photograph — made in a
   * worker (droneSurveyWorker.ts); the page makes a mesh per material and, once those are drawn,
   * empties the boxes they replace from the style meshes. */
  private async surveyTile(t: Tile) {
    const { data } = this.o, stop = t.stop;
    // (not the towers of a landmark site: its photo-textured models stand there — sceneLandmarks)
    const inSite = (x: number, y: number) => LANDMARK_SITES.some(st => { const [sx, sy] = this.landmarks.at(st.lat, st.lon); return Math.hypot(x - sx, y - sy) < st.radius; });
    const all = t.towers!, keepT: number[] = [];
    for (let i = 0; i < all.length; i += TOWER) if (!inSite(all[i], all[i + 1])) for (let k = 0; k < TOWER; k++) keepT.push(all[i + k]);
    const towers = keepT.length === all.length ? all : new Float32Array(keepT);
    if (!towers.length) { t.survey = "ready"; return; }
    t.survey = "running";
    this.surveying++;
    try {
      // (each block's colour, from its box: the shape is painted as the box was)
      const n = towers.length / TOWER, tints = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const g = t.styleGeo[SURVEY_STYLES[towers[i * TOWER + 6]]];
        if (!g?.index) continue;
        const col = g.getAttribute("color"), v = g.index.getX(towers[i * TOWER + 4]);
        tints[i * 3] = col.getX(v); tints[i * 3 + 1] = col.getY(v); tints[i * 3 + 2] = col.getZ(v);
      }
      // (a large complex — a supertall, or one record for a tower and its mall — with its outline:
      // every surveyed model standing inside it replaces it)
      const outlines: [number, number][][] = [];
      for (let i = 0; i < n; i++) {
        const big = towers[i * TOWER + 2] >= 120 || towers[i * TOWER + 8] >= 6000;
        outlines.push(big && t.spanRings ? t.spanRings[towers[i * TOWER + 7]] as [number, number][] : []);
      }
      const res = await this.surveyWork({ key: data.vworld_key!, lat0: data.center!.lat, lon0: data.center!.lon, towers: towers.slice(), tints, outlines }, stop.signal) as SurveyResult | null;
      if (!res || this.disposed || stop.signal.aborted || !t.zup || !this.tiles.has(t.key)) return;
      (t as unknown as { surveyInfo: unknown }).surveyInfo = { models: res.models, matched: res.matched, tall: res.tall };
      if (!res.parts.length) { t.survey = "ready"; return; }
      const group = new THREE.Group(), geos: THREE.BufferGeometry[] = [];
      group.name = `drone tile ${t.key} surveyed`;
      for (const part of res.parts) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(part.position, 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(part.normal, 3));
        if (part.uv) geo.setAttribute("uv", new THREE.BufferAttribute(part.uv, 2));
        geo.setAttribute("color", new THREE.BufferAttribute(part.color, 3));
        geo.setIndex(new THREE.BufferAttribute(part.index, 1));
        geo.computeBoundingSphere();
        geos.push(geo);
        const mesh = new THREE.Mesh(geo, part.material >= 0 && part.uv ? sharedContextMaterial(SURVEY_STYLES[part.material]) : this.plain);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.solid = true;
        group.add(mesh);
        if (!await this.pace()) { geos.forEach(g => g.dispose()); return; }
      }
      if (this.disposed || stop.signal.aborted || !t.zup) { geos.forEach(g => g.dispose()); return; }
      t.dispose.push(() => geos.splice(0).forEach(g => g.dispose()));
      t.zup.add(group);
      group.updateMatrixWorld(true);
      if (!t.castB) castShadows(group, false);
      t.surveyGroup = group;
      t.survey = "placed";
      const hide = res.hide;
      // (the boxes go once the shapes are drawn: never a frame with neither)
      const swap = () => {
        if (t.surveyGroup !== group || !this.tiles.has(t.key)) return;
        if (!this.o.drawReady(group)) { requestAnimationFrame(swap); return; }
        for (let k = 0; k < hide.length; k += 3) {
          const g = t.styleGeo[SURVEY_STYLES[hide[k]]];
          if (!g?.index) continue;
          (g.index.array as Uint32Array).fill(0, hide[k + 1], hide[k + 1] + hide[k + 2]);
          g.index.needsUpdate = true;
        }
      };
      requestAnimationFrame(swap);
    } catch (err) {
      console.info("[3D] drone survey failed:", t.key, err);
    } finally {
      this.surveying--;
      if (t.survey === "running") t.survey = this.tiles.has(t.key) && !stop.signal.aborted ? "ready" : "none";
    }
  }
  /** A tile's buildings in the colours the aerial photographs show: the roof's own colour (a green
   * waterproofed slab, a grey one, red tiles), the walls' paint where the photograph shows it. */
  private async colourTile(t: Tile) {
    const { data } = this.o, spans = t.spans!, rings = t.spanRings!, stop = t.stop;
    t.colour = "running";
    try {
      const res = await this.surveyWork({ kind: "colours", key: data.vworld_key!, lat0: data.center!.lat, lon0: data.center!.lon, rings: rings as [number, number][][] }, stop.signal) as ColourResult | null;
      if (!res || this.disposed || stop.signal.aborted || !this.tiles.has(t.key)) return;
      const touched = new Set<THREE.BufferGeometry>();
      for (let i = 0; i < res.colours.length; i++) {
        const c = res.colours[i];
        if (!c) continue;
        const g = t.styleGeo[SURVEY_STYLES[spans[i * 5]]];
        const col = g?.getAttribute("color") as THREE.BufferAttribute | undefined;
        if (!g || !col) continue;
        const a = col.array as Float32Array;
        const paint = (start: number, count: number, rgb: [number, number, number]) => { for (let v = start; v < start + count; v++) { a[v * 3] = rgb[0]; a[v * 3 + 1] = rgb[1]; a[v * 3 + 2] = rgb[2]; } };
        // (the walls: the photograph's paint only where it is clearly paint — bright, not a wall in
        // shade — mixed into the colour the structure gave; the roof as the photograph shows it)
        const ws = spans[i * 5 + 1], f = c.facade;
        if (f && 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2] > 0.42) {
          const mix: [number, number, number] = [a[ws * 3] * 0.35 + f[0] * 0.65, a[ws * 3 + 1] * 0.35 + f[1] * 0.65, a[ws * 3 + 2] * 0.35 + f[2] * 0.65];
          paint(ws, spans[i * 5 + 2], mix);
        }
        paint(spans[i * 5 + 3], spans[i * 5 + 4], c.roof);
        touched.add(g);
        if (i % 200 === 199 && !await this.pace()) return;
      }
      for (const g of touched) (g.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    } catch (err) {
      console.info("[3D] drone colours failed:", t.key, err);
    } finally {
      if (t.colour === "running") t.colour = "done";
    }
  }

  /** The survey workers (two on a desktop), and the jobs waiting on them. */
  private surveyPool: { w: Worker; busy: number }[] = [];
  private surveyJobs = new Map<number, (r: SurveyResult | ColourResult | null) => void>();
  private surveyId = 0;
  private surveyWork(job: Omit<SurveyJob, "id"> | Omit<ColourJob, "id">, signal: AbortSignal): Promise<SurveyResult | ColourResult | null> {
    if (!this.surveyPool.length) for (let k = 0; k < (this.o.hq ? 2 : 1); k++) {
      const w = new Worker(new URL("./droneSurveyWorker.ts", import.meta.url), { type: "module" });
      const slot = { w, busy: 0 };
      w.onmessage = (e: MessageEvent<SurveyResult | ColourResult>) => { slot.busy--; const f = this.surveyJobs.get(e.data.id); this.surveyJobs.delete(e.data.id); f?.(e.data); };
      w.onerror = () => { /* each job is settled by its abort or its answer */ };
      this.surveyPool.push(slot);
    }
    const slot = this.surveyPool.reduce((a, b) => (b.busy < a.busy ? b : a));
    const id = ++this.surveyId;
    slot.busy++;
    return new Promise(resolve => {
      this.surveyJobs.set(id, resolve);
      signal.addEventListener("abort", () => { if (this.surveyJobs.delete(id)) resolve(null); });
      slot.w.postMessage({ ...job, id }, "towers" in job ? [job.towers.buffer, job.tints.buffer] : []);
    });
  }

  /** Trees (view frame) on a collision grid: each a crown ~4.5 m round, up to 12 m over its
   * ground (the kit's park and woodland trees are 6–14 m tall). */
  private treesOnGrid(r: Roofs, trees: [number, number][], ground: (x: number, y: number) => number) {
    const reach = Math.ceil(4.5 / r.cell);
    for (const [x, y] of trees) {
      const top = ground(x, y) + 12, ci = Math.floor((x - r.x0) / r.cell), cj = Math.floor((y - r.y0) / r.cell);
      for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= r.nx || j >= r.ny || Math.hypot(di, dj) * r.cell > 4.5) continue;
        if (r.h[j * r.nx + i] < top) r.h[j * r.nx + i] = top;
      }
    }
  }

  /** Plant a tile's trees (scenePlants, as the view's own: the same kit, its workers). */
  /** The last trees' build times (ms), for the checks. */
  plantMs: number[] = [];
  private async plant(t: Tile) {
    if (!t.planting || !t.local || t.plants) return;
    const entry: NonNullable<Tile["plants"]> = { state: "building", group: null, materials: [], dispose: () => {} };
    t.plants = entry;
    this.planting++;
    try {
      const pt0 = performance.now();
      const plants = await buildPlants(t.planting, this.o.seed + 887 + t.i * 31 + t.j * 17, t.local, this.o.hq).catch(() => null);
      this.plantMs.push(Math.round(performance.now() - pt0)); if (this.plantMs.length > 50) this.plantMs.shift();
      if (this.disposed || t.plants !== entry || !this.tiles.has(t.key)) { plants?.dispose(); return; }
      if (!plants) { t.planting = null; t.plants = null; return; }
      const yup = new THREE.Group();
      yup.name = `drone tile ${t.key} plants`;
      yup.position.set(t.cx, 0, -t.cy);
      yup.add(plants.mesh);
      yup.updateMatrixWorld(true);
      plants.mesh.traverse(o => { const m = (o as THREE.Mesh).material; if (m) for (const x of Array.isArray(m) ? m : [m]) entry.materials.push(x); });
      entry.group = yup; entry.dispose = () => plants.dispose();
      if (!t.castP) castShadows(yup, false);
      this.o.addWarm(this.root, yup);
      entry.state = "placed";
    } finally { this.planting--; }
  }
  private unplant(t: Tile) {
    const p = t.plants;
    if (!p) return;
    t.plants = null;
    if (p.group) this.root.remove(p.group);
    if (p.materials.length) this.o.forget?.(new Set(p.materials));
    p.dispose();
  }

  private clear(t: Tile) {
    this.unplant(t);
    this.traffic.removeTile(t.key);
    this.o.onLabels?.(t.key, null);
    for (const g of [t.zup, t.yup]) if (g) this.root.remove(g);
    if (t.materials.length) this.o.forget?.(new Set(t.materials));
    for (const f of t.dispose) f();
    t.zup = t.yup = null; t.materials = []; t.dispose = []; t.roofs = null; t.surveyGroup = null; t.styleGeo = {};
  }
  private drop(t: Tile) {
    t.stop.abort();
    this.clear(t);
    this.tiles.delete(t.key);
  }
  dispose() {
    this.disposed = true;
    for (const t of [...this.tiles.values()]) this.drop(t);
    this.dropRegion();
    this.landmarks.dispose();
    this.o.forget?.(new Set([this.plain, this.asphalt, this.paint, this.concrete, this.paving, ...this.traffic.materials()]));
    this.plain.dispose(); this.asphalt.dispose(); this.paint.dispose(); this.concrete.dispose(); this.paving.dispose();
    this.traffic.dispose();
    for (const { w } of this.surveyPool) w.terminate();
    this.surveyPool = [];
    for (const f of this.surveyJobs.values()) f(null);
    this.surveyJobs.clear();
    this.root.removeFromParent();
  }
}
