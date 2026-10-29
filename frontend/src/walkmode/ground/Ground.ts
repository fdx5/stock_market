import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { World } from "../../drivegame/world/World";
import type { Origin } from "../../drivegame/world/geo";
import { carGeometry } from "../../drivegame/vehicle/cars";
import { realCarMaterial } from "./carMaterial";
import { parkedCarPaint } from "./carPaint";
import { attachCarWindows } from "./carModels";
import { roadsideParking } from "./parkingPlacement";
import type { CarBatches } from "./CarBatches";
import type { ParkedCars, ParkedCar } from "../game/ParkedCars";
import { boxesOverlap, type Body } from "../../drivegame/vehicle/physics";
import { buildWalkers, ringPaths, type WalkPath } from "../../components/sceneWalkers";
import { analyse, CELL, K, tilesFor, type AerialAsk, type AerialResult } from "./aerial";
import { broadleaf, foliageMaterial, pine, type TreeKind } from "./trees";

/* The ground round the walk, made from what the aerial photographs show (aerial.ts) on the drive
 * world's terrain, buildings and roads: every surface between the buildings and off the roads in its
 * material — concrete block paving, red brick, asphalt car parks and drives, lawn, planting beds
 * under the trees — with granite kerbs where paving meets asphalt; each tree read from the canopy,
 * at its size, in the season's colours; clipped hedges and flowers round the buildings; the cars
 * parked where the photograph shows them; and people walking the sidewalks and round the buildings.
 * The photograph itself is never shown. Only the walk uses this (the drive game's own street trees
 * are hidden where these stand). */

const TEX = "/3d/walk/out/";
interface Surf { name: string; size: number; tint?: THREE.ColorRepresentation; rough?: number; lift: number }
/** each class's surface: texture set, its real size (m), how high it sits over the drive world's ground */
/** (a class of the walk's own: paving by the buildings, laid in interlocking concrete blocks) */
const PAVERS = 6;
/** (and sand: a beach, from the coastline data — the photograph read it as paving) */
const SAND = 7;
/** (and the land that is not paved: bare earth, the leaf litter of a wooded slope, rock on the
 * steepest — the photograph's dark ground read as asphalt on every hillside) */
const SOIL = 8, FOREST = 9, ROCK = 10;
const SURF: Record<number, Surf> = {
  [K.ASPHALT]: { name: "asphalt_02", size: 3.0, tint: "#8c8c8a", lift: 0.035 },
  // (Korean block paving: grey concrete blocks; the red brick is the same laid in red)
  [K.PAVE]: { name: "brick_pavement_02", size: 2.0, tint: "#d6d4ce", lift: 0.075 },
  [K.RED]: { name: "brick_pavement_02", size: 2.0, tint: "#d0907a", lift: 0.075 },
  [PAVERS]: { name: "interlocking_concrete_pavers", size: 1.6, tint: "#cdc8bf", lift: 0.075 },
  [SAND]: { name: "coast_sand_01", size: 7.5, tint: "#fbe9c6", lift: 0.05 },
  [SOIL]: { name: "dry_ground_01", size: 4.0, tint: "#d9cbb4", lift: 0.06 },
  [FOREST]: { name: "forest_ground_06", size: 3.0, tint: "#c8c0a8", lift: 0.07 },
  [ROCK]: { name: "rocky_terrain_02", size: 5.0, tint: "#c9c4bb", lift: 0.08 },
  [K.GRASS]: { name: "grass_ground", size: 2.5, tint: "#b8cc90", lift: 0.07 },
  // (under the trees: planted beds, ground cover over soil)
  [K.TREE]: { name: "grass_ground", size: 1.6, tint: "#93a676", lift: 0.11 },
};
/** raised surfaces (a kerb stands where one meets asphalt) */
const RAISED = new Set<number>([K.PAVE, K.RED, K.GRASS, K.TREE, PAVERS]);

// ------------------------------------------------------------------ the season
/** Foliage colours for the month (Seoul): spring green, summer deep green, autumn turning. */
function foliage(month: number) {
  if (month >= 10 && month <= 11) return month === 11
    ? ["#b4561e", "#c9862a", "#d8b03a", "#8a3a1c", "#5d6a2a"]
    : ["#6f7d2c", "#b07a28", "#c9a032", "#9a4a22", "#56702e"];
  if (month === 12 || month <= 2) return ["#6a5a44", "#5a4c3a", "#7a6a50", "#3f5a32"]; // bare, and the evergreens
  if (month <= 4) return ["#7fae4a", "#94bf58", "#e7b9c8", "#6c9a40"];               // fresh green, a cherry in flower
  return ["#3f6d2c", "#4c7a32", "#355f26", "#5a8a3a"];
}

// ------------------------------------------------------------------ models
const rng = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

// ------------------------------------------------------------------ shared by every patch
/** Textures, materials and tree models are the same for every patch of ground: made once, kept
 * until the walk ends (disposeGroundShared). A patch made again would upload ~20 MB of textures
 * again and stall the walk. */
const SHARED = { tex: new Map<string, THREE.Texture[]>(), mats: new Map<string, THREE.Material>(), trees: null as null | TreeKind[] };
function sharedTex(name: string) {
  let set = SHARED.tex.get(name);
  if (!set) {
    const l = new THREE.TextureLoader();
    set = ["diff", "nor", "arm"].map(s => { const t = l.load(`${TEX}${name}_${s}.webp`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (s === "diff") t.colorSpace = THREE.SRGBColorSpace; return t; });
    SHARED.tex.set(name, set);
  }
  return set;
}
function sharedMat<T extends THREE.Material>(key: string, make: () => T): T {
  let m = SHARED.mats.get(key) as T | undefined;
  if (!m) { m = make(); SHARED.mats.set(key, m); }
  return m;
}
export function disposeGroundShared() {
  SHARED.tex.forEach(l => l.forEach(t => t.dispose())); SHARED.tex.clear();
  SHARED.mats.forEach(m => { (m as THREE.MeshStandardMaterial).map?.dispose(); m.dispose(); }); SHARED.mats.clear();
  SHARED.trees?.forEach(k => { k.trunk.dispose(); k.crown.dispose(); k.trunkFar.dispose(); k.crownFar.dispose(); }); SHARED.trees = null;
}

// ------------------------------------------------------------------ the ground
export interface GroundOptions {
  world: World; origin: Origin; key: string; scene: THREE.Scene; month?: number; onProgress?(text: string): void;
  /** the modelled cars (the drive game's loaded models, as the traffic uses) */
  carModels?: Map<string, THREE.BufferGeometry>;
  carWindows?: Map<string, THREE.BufferGeometry>;
  carGlass?: THREE.Material;
  carBatches?: CarBatches;
  parkedCars?: ParkedCars;
  parkingBlocked?(x:number,y:number,hx:number,hy:number,hl:number,hw:number):boolean;
  /** kept clear (an entrance's approach): no tree planted there */
  keepClear?(x: number, y: number): boolean;
  prepare?(group:THREE.Group):Promise<void>;
  /** people on this patch's paths, at most (default 150) */
  peopleCap?: number;
  /** leave the drive world's street trees to the caller (GroundStream hides them under all its patches) */
  sharedTrees?: boolean;
}

export class Ground {
  readonly group = new THREE.Group();
  private disposables: { dispose(): void }[] = [];
  private walkers: Awaited<ReturnType<typeof buildWalkers>> = null;
  /** each kind's trees, near (the full model) and far (one lump), sorted between them every half second */
  private treeLods: { near: THREE.InstancedMesh[]; far: THREE.InstancedMesh[]; all: THREE.Matrix4[]; colors: THREE.Color[]; pos: THREE.Vector3[] }[] = [];
  private lodT = 0; private lodEye = new THREE.Vector3(1e9, 0, 0);
  private solids = new Map<string, Body[]>();
  private indexSolid(body: Body) {
    const reach = body.length / 2 + body.width / 2;
    for (let i = Math.floor((body.x - reach) / 12); i <= Math.floor((body.x + reach) / 12); i++) for (let j = Math.floor((body.y - reach) / 12); j <= Math.floor((body.y + reach) / 12); j++) {
      const key = `${i}:${j}`, list = this.solids.get(key) ?? []; list.push(body); this.solids.set(key, list);
    }
  }
  /** The same parked cars and trunks that are actually drawn, for walking and bicycle collisions. */
  blocks(body: Body) {
    const reach = body.length / 2 + body.width / 2;
    for (let i = Math.floor((body.x - reach) / 12); i <= Math.floor((body.x + reach) / 12); i++) for (let j = Math.floor((body.y - reach) / 12); j <= Math.floor((body.y + reach) / 12); j++)
      for (const solid of this.solids.get(`${i}:${j}`) ?? []) if (boxesOverlap(body, solid, 0.04)) return true;
    return false;
  }
  stats = { ms: 0, tiles: 0, trees: 0, cars: 0, people: 0, cells: 0 };
  data: AerialResult | null = null;
  /** (for inspection) the building / road mask */
  block: Uint8Array | null = null;
  /** The height of the surface drawn at (x, y): the paving's, the lawn's (each laid a little over the
   * terrain, a pavement at its road's level) or the carriageway's asphalt; NaN off the patch or in a
   * building. The drive world's height is its 4 m grid's, under these by a few centimetres — a wheel
   * or a foot stood on it sank into the paving. */
  surfaceAt: (x: number, y: number) => number = () => NaN;

  constructor(private o: GroundOptions) { if(o.prepare)this.group.visible=false;o.scene.add(this.group); }

  /** Read the photographs round (cx, cy) and build. */
  async build(cx: number, cy: number, half = 260) {
    const t0 = performance.now(), o = this.o;
    // (built while the walk goes on: the work given up to the frame every ~6 ms)
    let slice = performance.now();
    const breathe = async () => { if (performance.now() - slice > 2) { await new Promise(r => requestAnimationFrame(() => r(null))); slice = performance.now(); } };
    console.info("walk: ground start");
    o.onProgress?.("항공사진으로 동네를 읽는 중");
    const ask: AerialAsk = { key: o.key, lat0: o.origin.lat, lon0: o.origin.lon, kx: o.origin.kx, ky: o.origin.ky, cx, cy, half };
    const tr = performance.now();
    const res = await read(ask);
    this.data = res;
    const lap = (what: string) => console.info(`walk: ground ${what} ${Math.round(performance.now() - tr)} ms`);
    lap(`read (worker ${res.ms} ms, ${res.tiles} tiles)`);
    o.onProgress?.("나무와 포장, 주차된 차를 세우는 중");
    const W = o.world;
    const { nx, ny, x0, y0 } = res, cls = res.cls;
    const cx0 = (i: number) => x0 + (i + 0.5) * CELL, cy0 = (j: number) => y0 + (j + 0.5) * CELL;
    // ---- masks: buildings (left as they are), roads (the drive world's carriageways and sidewalks)
    const block = new Uint8Array(nx * ny);   // 1 building, 2 carriageway, 3 roadside (sidewalk)
    this.block = block;
    for (const f of W.footprintsIn(x0, y0, x0 + nx * CELL, y0 + ny * CELL)) fillRing(block, nx, ny, x0, y0, f.ring, 1);
    // (a road's points are x y height triples)
    const X1 = x0 + nx * CELL, Y1 = y0 + ny * CELL;
    for (const r of W.roads.values()) {
      const p = r.pts, side = r.major ? 3.2 : 1.8, m = r.w / 2 + side;
      for (let k = 0; k + 5 < p.length; k += 3) {
        const ax = p[k], ay = p[k + 1], bx = p[k + 3], by = p[k + 4];
        if (Math.max(ax, bx) + m < x0 || Math.min(ax, bx) - m > X1 || Math.max(ay, by) + m < y0 || Math.min(ay, by) - m > Y1) continue;
        stampSeg(block, nx, ny, x0, y0, ax, ay, bx, by, m, 3);
        stampSeg(block, nx, ny, x0, y0, ax, ay, bx, by, r.w / 2 + 0.2, 2);
      }
    }
    // water (a river, a stream, the sea, a pond): the drive world's own, drawn there — the
    // photograph reads dark water as tarmac; nothing of the patch is laid on it (marked as a
    // building's: no surface, tree, car or path)
    for (let j = 0; j < ny; j += 2) for (let i = 0; i < nx; i += 2) {
      const wet = W.wetAt(cx0(i), cy0(j)), sand = !wet && W.beachAt(cx0(i), cy0(j));
      if (!wet && !sand) continue;
      // (a sand beach laid as sand: the photograph read it as paving)
      for (let dj = 0; dj < 2 && j + dj < ny; dj++) for (let di = 0; di < 2 && i + di < nx; di++) { const c = (j + dj) * nx + i + di; if (wet) { block[c] = 1; cls[c] = K.NONE; } else if (block[c] !== 1 && block[c] !== 2) cls[c] = SAND; }
    }
    // the pavement along each road one surface: the band the drive world keeps for its sidewalk is
    // paved (its street trees' beds kept) — the photograph's reading of it (shadows, cars, a tree's
    // crown) made a broken, heaving patchwork there
    for (let c = 0; c < block.length; c++) if (block[c] === 3 && cls[c] !== K.TREE) cls[c] = K.PAVE;
    // paving within 10 m of a building: its forecourt, laid in other blocks than the street's
    {
      const dist = new Uint8Array(nx * ny).fill(255), q: number[] = [];
      for (let c = 0; c < block.length; c++) if (block[c] === 1) { dist[c] = 0; q.push(c); }
      for (let h = 0; h < q.length; h++) {
        const c = q[h], d = dist[c]; if (d >= 20) continue;
        const i = c % nx;
        for (const n of [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, c - nx, c + nx]) if (n >= 0 && n < dist.length && dist[n] > d + 1) { dist[n] = d + 1; q.push(n); }
      }
      for (let c = 0; c < block.length; c++) if (cls[c] === K.PAVE && dist[c] <= 20 && block[c] !== 3) cls[c] = PAVERS;
    }
    // ---- the land: asphalt only where a road or a complex's own drive or car park can be — by a
    // road, or near the buildings on level ground; elsewhere the photograph's dark ground is earth,
    // a wooded slope's leaf litter (near the canopy, or in shade), rock where it is steepest. Paving
    // never on a steep slope; nothing left bare (the drive world's flat grey showed through).
    {
      const N = nx * ny, roadD = new Uint8Array(N).fill(255), bldD = new Uint8Array(N).fill(255), treeD = new Uint8Array(N).fill(255);
      const bfs = (d: Uint8Array, seed: (c: number) => boolean, cap: number) => {
        const q: number[] = [];
        for (let c = 0; c < N; c++) if (seed(c)) { d[c] = 0; q.push(c); }
        for (let h = 0; h < q.length; h++) {
          const c = q[h], v = d[c]; if (v >= cap) continue;
          const i = c % nx;
          for (const n of [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, c - nx, c + nx]) if (n >= 0 && n < N && d[n] > v + 1) { d[n] = v + 1; q.push(n); }
        }
      };
      bfs(roadD, c => block[c] === 2 || block[c] === 3, 14);
      bfs(bldD, c => block[c] === 1 && !W.wetAt(cx0(c % nx), cy0((c - (c % nx)) / nx)), 60);
      bfs(treeD, c => cls[c] === K.TREE, 16);
      await breathe();
      // the slope (rise over run) on a 2 m grid from the terrain
      const S = 4, sx = Math.ceil(nx / S) + 1, sy = Math.ceil(ny / S) + 1, hs = new Float32Array(sx * sy);
      for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) { const h = W.heightAt(x0 + i * S * CELL, y0 + j * S * CELL); hs[j * sx + i] = Number.isFinite(h) ? h : NaN; }
      const slopeAt = (i: number, j: number) => {
        const a = Math.min(sx - 2, Math.floor(i / S)), b = Math.min(sy - 2, Math.floor(j / S));
        const h00 = hs[b * sx + a], h10 = hs[b * sx + a + 1], h01 = hs[(b + 1) * sx + a];
        return Number.isFinite(h00 + h10 + h01) ? Math.hypot(h10 - h00, h01 - h00) / (S * CELL) : 0;
      };
      const rgbAt = res.rgb;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const c = j * nx + i, b = block[c];
        if (b === 1 || b === 2) continue;
        const k = cls[c], slope = slopeAt(i, j), nearRoad = roadD[c] <= 12, nearBld = bldD[c] <= 50;
        // (the pavement band along a road: paved where it is level; where it climbs a bank, that bank)
        if (b === 3) { if (slope > 0.3 && k !== K.TREE) cls[c] = K.GRASS; continue; }
        const wooded = treeD[c] <= 12 || bldD[c] > 50;
        const l = rgbAt ? (rgbAt[c * 3] + rgbAt[c * 3 + 1] + rgbAt[c * 3 + 2]) / 765 : 0.3;
        // (a bank by a road or a block is a planted slope — 법면, in grass; leaf litter only in a wood
        // away from the buildings; bare earth on level open ground; rock only off in the hills)
        const land = slope > 0.65 && !nearBld ? ROCK : (nearRoad || bldD[c] <= 30) && slope > 0.15 ? K.GRASS : wooded && bldD[c] > 30 ? FOREST : l < 0.18 ? FOREST : SOIL;
        if (k === K.ASPHALT) { if (!((nearRoad && slope < 0.2) || (nearBld && slope < 0.12))) cls[c] = land; }
        else if ((k === K.PAVE || k === K.RED || k === PAVERS) && slope > 0.25 && !nearRoad) cls[c] = land;
        else if (k === K.NONE) cls[c] = wooded ? FOREST : K.GRASS;
        else if (k === K.TREE && bldD[c] > 60) cls[c] = FOREST;
        else if (k === K.GRASS && slope > 0.65) cls[c] = ROCK;
      }
    }
    lap("masks"); await breathe();
    const terrainH = (x: number, y: number) => { const h = W.heightAt(x, y); return Number.isFinite(h) ? h : W.h0; };
    // The pavement beside a road at the road's own level (a kerb above it), easing back to the
    // terrain over 6 m: the roads are laid at their surveyed heights, the terrain model is coarser,
    // and a pavement on the terrain stood a metre over (or under) its road on a slope.
    const RG = 1, rgx = Math.ceil(nx * CELL / RG) + 1, rgy = Math.ceil(ny * CELL / RG) + 1;
    const roadH = new Float32Array(rgx * rgy).fill(NaN), roadD = new Float32Array(rgx * rgy).fill(1e9), roadE = new Float32Array(rgx * rgy);
    for (const r of W.roads.values()) {
      const p = r.pts, edge = r.w / 2 + (r.major ? 3.2 : 1.8);
      for (let k = 0; k + 5 < p.length; k += 3) {
        const ax = p[k], ay = p[k + 1], ah = p[k + 2], bx = p[k + 3], by = p[k + 4], bh = p[k + 5], m = edge + 6;
        if (Math.max(ax, bx) + m < x0 || Math.min(ax, bx) - m > X1 || Math.max(ay, by) + m < y0 || Math.min(ay, by) - m > Y1) continue;
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - m - x0) / RG)), i1 = Math.min(rgx - 1, Math.ceil((Math.max(ax, bx) + m - x0) / RG));
        const j0 = Math.max(0, Math.floor((Math.min(ay, by) - m - y0) / RG)), j1 = Math.min(rgy - 1, Math.ceil((Math.max(ay, by) + m - y0) / RG));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const px = x0 + i * RG, py = y0 + j * RG, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
          const d = Math.hypot(px - ax - dx * t, py - ay - dy * t), c = j * rgx + i;
          if (d - edge < roadD[c] - roadE[c]) { roadD[c] = d; roadE[c] = edge; roadH[c] = ah + (bh - ah) * t; }
        }
      }
    }
    // (the drive world's ground is drawn under every patch: a surface laid lower than it is hidden
    // under it — a bare dark flat where a road runs below the terrain model, the feet sunk in it)
    const height = (x: number, y: number) => { const h = eased(x, y), m = W.groundMeshAt(x, y); return Number.isFinite(m) ? Math.max(h, m + 0.04) : h; };
    const eased = (x: number, y: number) => {
      const g = terrainH(x, y);
      const fi = (x - x0) / RG, fj = (y - y0) / RG, i = Math.round(fi), j = Math.round(fj);
      if (i < 0 || j < 0 || i >= rgx || j >= rgy) return g;
      const c = j * rgx + i, rh = roadH[c];
      // (not a road passing high over this ground, or deep under it: a bridge, an underpass)
      if (!Number.isFinite(rh) || Math.abs(rh - g) > 3) return g;
      const over = roadD[c] - roadE[c];
      if (over <= 0) return rh + 0.12;
      const t = Math.min(1, over / 6), k = t * t * (3 - 2 * t);
      return (rh + 0.12) * (1 - k) + g * k;
    };
    // (the carriageway: the drive world's asphalt, laid 0.05 m over its road's profile)
    const roadAt = (x: number, y: number) => {
      const fi = (x - x0) / RG, fj = (y - y0) / RG, i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
      let s = 0, w = 0;
      for (const [di, dj, k] of [[0, 0, (1 - u) * (1 - v)], [1, 0, u * (1 - v)], [0, 1, (1 - u) * v], [1, 1, u * v]]) {
        const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= rgx || b >= rgy) continue;
        const h = roadH[b * rgx + a]; if (Number.isFinite(h) && k > 0) { s += h * k; w += k; }
      }
      return w > 0 ? s / w + 0.05 : NaN;
    };
    this.surfaceAt = (x, y) => {
      const i = Math.floor((x - x0) / CELL), j = Math.floor((y - y0) / CELL);
      if (i < 0 || j < 0 || i >= nx || j >= ny) return NaN;
      const c = j * nx + i;
      if (block[c] === 1) return NaN;
      if (block[c] === 2) return roadAt(x, y);
      const sf = (SURF as Partial<Record<number, Surf>>)[cls[c]];
      return sf ? height(x, y) + sf.lift : NaN;
    };
    { let b1 = 0, b2 = 0; for (const v of block) { if (v === 1) b1++; else if (v === 2) b2++; } console.info(`walk: ground mask buildings ${b1} carriageway ${b2} of ${block.length}`); }
    // ---- surfaces: each class's area traced through the cell centres by marching squares (edges
    // cut on the diagonal, no stair-steps), whole squares merged into rectangles (≤ 4 m, to follow the
    // terrain); world-space uv
    // (where the ground slopes, its surfaces in half-metre squares that follow it: merged into 4 m
    // rectangles, the drive world's ground poked through their middles in jagged teeth on a bank)
    const SB = 4, sbx = Math.ceil(nx / SB) + 1, sby = Math.ceil(ny / SB) + 1, hv = new Float32Array(sbx * sby);
    for (let j = 0; j < sby; j++) for (let i = 0; i < sbx; i++) hv[j * sbx + i] = height(cx0(Math.min(nx - 1, i * SB)), cy0(Math.min(ny - 1, j * SB)));
    const steepAt = (i: number, j: number) => {
      const a = Math.min(sbx - 2, Math.floor(i / SB)), b = Math.min(sby - 2, Math.floor(j / SB));
      const v = [hv[b * sbx + a], hv[b * sbx + a + 1], hv[(b + 1) * sbx + a], hv[(b + 1) * sbx + a + 1]];
      return Math.max(...v) - Math.min(...v) > 0.18;
    };
    const loadT = sharedTex;
    for (const [ks, sf] of Object.entries(SURF) as [string, Surf][]) {
      const k = +ks;
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      const inside = (i: number, j: number) => { const c = j * nx + i; return cls[c] === k && block[c] !== 1 && block[c] !== 2; };
      const vert = (x: number, y: number) => { pos.push(x, height(x, y) + sf.lift, -y); uv.push(x / sf.size, y / sf.size); return pos.length / 3 - 1; };
      const sq = nx - 1, sqy = ny - 1, full = new Uint8Array(sq * sqy), done = new Uint8Array(sq * sqy);
      for (let j = 0; j < sqy; j++) for (let i = 0; i < sq; i++) full[j * sq + i] = inside(i, j) && inside(i + 1, j) && inside(i + 1, j + 1) && inside(i, j + 1) ? 1 : 0;
      await breathe();
      // whole squares: rectangles
      for (let j = 0; j < sqy; j++) for (let i = 0; i < sq; i++) {
        const c = j * sq + i; if (!full[c] || done[c]) continue;
        const lim = steepAt(i, j) ? 1 : 8;
        let w = 1; while (i + w < sq && w < lim && full[c + w] && !done[c + w] && !steepAt(i + w, j)) w++;
        let h = 1; grow: while (j + h < sqy && h < lim) { for (let q = 0; q < w; q++) { const d = (j + h) * sq + i + q; if (!full[d] || done[d] || steepAt(i + q, j + h)) break grow; } h++; }
        for (let bb = 0; bb < h; bb++) for (let q = 0; q < w; q++) done[(j + bb) * sq + i + q] = 1;
        const xa = cx0(i), xb = cx0(i + w), ya = cy0(j), yb = cy0(j + h);
        const v0 = vert(xa, ya), v1 = vert(xb, ya), v2 = vert(xb, yb), v3 = vert(xa, yb);
        idx.push(v0, v1, v2, v0, v2, v3);
      }
      await breathe();
      // edge squares: the inside part of the square, cut through the edges' midpoints
      for (let j = 0; j < sqy; j++) { if (!(j & 63)) await breathe(); for (let i = 0; i < sq; i++) {
        if (full[j * sq + i]) continue;
        const cs: [number, number, boolean][] = [[i, j, inside(i, j)], [i + 1, j, inside(i + 1, j)], [i + 1, j + 1, inside(i + 1, j + 1)], [i, j + 1, inside(i, j + 1)]];
        if (!cs.some(c => c[2])) continue;
        const poly: number[] = [];
        for (let e = 0; e < 4; e++) {
          const [ai, aj, ain] = cs[e], [bi, bj, bin] = cs[(e + 1) % 4];
          if (ain) poly.push(vert(cx0(ai), cy0(aj)));
          if (ain !== bin) poly.push(vert((cx0(ai) + cx0(bi)) / 2, (cy0(aj) + cy0(bj)) / 2));
        }
        for (let t = 1; t + 1 < poly.length; t++) idx.push(poly[0], poly[t], poly[t + 1]);
      } }
      if (!idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
      g.computeVertexNormals();
      const [map, normalMap, arm] = loadT(sf.name);   // (shared textures; each class its own material and tint)
      const m = sharedMat(`surf-${k}`, () => new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap: arm, metalnessMap: arm, aoMap: arm, color: sf.tint ?? "#ffffff", roughness: 1, metalness: 1, normalScale: new THREE.Vector2(0.8, 0.8) }));
      // (the arm map's metal channel is 0: metalness 1 × 0)
      const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.name = `ground-${sf.name}`;
      this.group.add(mesh); this.disposables.push(g, m);
      this.stats.cells += idx.length / 3;
    }
    lap("surfaces"); await breathe();
    // ---- kerbs: granite where a raised surface meets asphalt — on the same traced line the
    // surfaces are cut along (marching squares through the cell centres), the segments joined into
    // lines, rounded (Chaikin), and laid as a kerb: a top and both faces following the ground
    {
      // (the carriageway counts as asphalt: the kerb runs along every road's edge as well)
      const isA = (i: number, j: number) => { const c = j * nx + i; return (cls[c] === K.ASPHALT && block[c] !== 1) || block[c] === 2; };
      const isR = (i: number, j: number) => { const c = j * nx + i; return RAISED.has(cls[c]) && block[c] !== 1 && block[c] !== 2; };
      const segs: [string, string][] = [], at = new Map<string, [number, number]>();
      const H = (i: number, j: number) => { const k = `h${i},${j}`; if (!at.has(k)) at.set(k, [(cx0(i) + cx0(i + 1)) / 2, cy0(j)]); return k; };
      const V = (i: number, j: number) => { const k = `v${i},${j}`; if (!at.has(k)) at.set(k, [cx0(i), (cy0(j) + cy0(j + 1)) / 2]); return k; };
      for (let j = 0; j < ny - 1; j++) {
        if (!(j & 63)) await breathe();
        for (let i = 0; i < nx - 1; i++) {
          const c = [isR(i, j), isR(i + 1, j), isR(i + 1, j + 1), isR(i, j + 1)];
          const n = (c[0] ? 1 : 0) + (c[1] ? 1 : 0) + (c[2] ? 1 : 0) + (c[3] ? 1 : 0);
          if (n === 0 || n === 4) continue;
          // (only where the other side is the carriageway: not between paving and lawn)
          if (!((!c[0] && isA(i, j)) || (!c[1] && isA(i + 1, j)) || (!c[2] && isA(i + 1, j + 1)) || (!c[3] && isA(i, j + 1)))) continue;
          const e = [H(i, j), V(i + 1, j), H(i, j + 1), V(i, j)];
          const cross = [0, 1, 2, 3].filter(k => c[k] !== c[(k + 1) % 4]);
          if (cross.length === 2) segs.push([e[cross[0]], e[cross[1]]]);
          else if (c[0]) { segs.push([e[3], e[0]]); segs.push([e[1], e[2]]); }
          else { segs.push([e[0], e[1]]); segs.push([e[2], e[3]]); }
        }
      }
      // join the segments into lines
      const by = new Map<string, number[]>();
      segs.forEach(([a, b], n) => { (by.get(a) ?? by.set(a, []).get(a)!).push(n); (by.get(b) ?? by.set(b, []).get(b)!).push(n); });
      const used = new Uint8Array(segs.length), lines: [number, number][][] = [];
      const walk = (from: string, n0: number) => {
        const out: string[] = [from]; let cur = from, n = n0;
        while (n >= 0 && !used[n]) { used[n] = 1; const [a, b] = segs[n]; cur = a === cur ? b : a; out.push(cur); n = (by.get(cur) ?? []).find(m => !used[m]) ?? -1; }
        return out;
      };
      // (open lines from their ends first, then the closed ones)
      for (const pass of [0, 1]) for (let n = 0; n < segs.length; n++) {
        if (used[n]) continue;
        const [a, b] = segs[n];
        if (pass === 0 && (by.get(a)!.length !== 1 && by.get(b)!.length !== 1)) continue;
        const start = pass === 0 && by.get(b)!.length === 1 && by.get(a)!.length !== 1 ? b : a;
        lines.push(walk(start, n).map(k => at.get(k)!));
      }
      await breathe();
      const pos: number[] = [], W = 0.075, TOP = 0.13, FOOT = -0.18;
      for (let line of lines) {
        let len = 0; for (let q = 1; q < line.length; q++) len += Math.hypot(line[q][0] - line[q - 1][0], line[q][1] - line[q - 1][1]);
        if (len < 1.5) continue;     // (the short ones are noise in the reading)
        const closed = line.length > 3 && Math.hypot(line[0][0] - line[line.length - 1][0], line[0][1] - line[line.length - 1][1]) < 0.01;
        // (straightened first: the photograph's reading wavers by a cell; a kerb is laid true)
        const simplify = (pts: [number, number][], tol: number): [number, number][] => {
          if (pts.length < 3) return pts;
          const [ax, ay] = pts[0], [bx, by2] = pts[pts.length - 1], dl = Math.hypot(bx - ax, by2 - ay) || 1;
          let worst = 0, at = 0;
          for (let q = 1; q < pts.length - 1; q++) { const d = Math.abs((pts[q][0] - ax) * (by2 - ay) - (pts[q][1] - ay) * (bx - ax)) / dl; if (d > worst) { worst = d; at = q; } }
          if (worst < tol) return [pts[0], pts[pts.length - 1]];
          return [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
        };
        if (closed) { const h2 = Math.floor(line.length / 2); line = [...simplify(line.slice(0, h2 + 1), 0.45).slice(0, -1), ...simplify(line.slice(h2), 0.45)]; }
        else line = simplify(line, 0.45);
        for (let it = 0; it < 2; it++) {
          const out: [number, number][] = closed ? [] : [line[0]];
          for (let q = 0; q < line.length - 1; q++) { const [ax, ay] = line[q], [bx, by2] = line[q + 1]; out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by2 * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by2 * 0.75]); }
          if (closed) out.push(out[0]); else out.push(line[line.length - 1]);
          line = out;
        }
        // (and the points that the rounding left in a straight run dropped again: the kerb's
        // triangles only where it bends)
        line = simplify(line, 0.025);
        const L: number[][] = [], Rr: number[][] = [];
        for (let q = 0; q < line.length; q++) {
          const p0 = line[Math.max(0, q - 1)], p1 = line[Math.min(line.length - 1, q + 1)];
          let tx = p1[0] - p0[0], ty = p1[1] - p0[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
          const [x, y] = line[q], h = height(x, y);
          L.push([x - ty * W, y + tx * W, h]); Rr.push([x + ty * W, y - tx * W, h]);
        }
        const P = (p: number[], dy: number) => [p[0], p[2] + dy, -p[1]];
        const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
        for (let q = 0; q < line.length - 1; q++) {
          quad(P(L[q], TOP), P(Rr[q], TOP), P(Rr[q + 1], TOP), P(L[q + 1], TOP));
          quad(P(Rr[q], TOP), P(Rr[q], FOOT), P(Rr[q + 1], FOOT), P(Rr[q + 1], TOP));
          quad(P(L[q + 1], TOP), P(L[q + 1], FOOT), P(L[q], FOOT), P(L[q], TOP));
        }
      }
      if (pos.length) {
        const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
        const m = sharedMat("kerb", () => new THREE.MeshStandardMaterial({ color: "#85827b", roughness: 0.8, side: THREE.DoubleSide }));
        const mesh = new THREE.Mesh(geo, m); mesh.receiveShadow = true; this.group.add(mesh); this.disposables.push(geo, m);
      }
    }
    lap("kerbs"); await breathe();
    // ---- the pavement's furniture: the yellow guide line of tactile blocks down the middle of a
    // main road's pavement (점자블록), and manhole covers here and there in the paving
    {
      const guide: number[] = [], R2 = rng(41);
      const paved = (x: number, y: number) => { const i = Math.floor((x - x0) / CELL), j = Math.floor((y - y0) / CELL); if (i < 0 || j < 0 || i >= nx || j >= ny) return false; const c = j * nx + i; return block[c] === 3 && cls[c] === K.PAVE; };
      for (const r of W.roads.values()) {
        if (!r.major || r.w < 10) continue;
        const p = r.pts;
        for (const side of [1, -1]) {
          const off = r.w / 2 + 1.6;
          for (let k = 0; k + 5 < p.length; k += 3) {
            const ax = p[k], ay = p[k + 1], bx = p[k + 3], by = p[k + 4], l = Math.hypot(bx - ax, by - ay); if (l < 0.5) continue;
            const ux = (bx - ax) / l, uy = (by - ay) / l, nx2 = -uy * side, ny2 = ux * side;
            for (let d = 0; d < l; d += 0.6) {
              const x = ax + ux * d + nx2 * off, y = ay + uy * d + ny2 * off, d1 = Math.min(l, d + 0.6), x1 = ax + ux * d1 + nx2 * off, y1 = ay + uy * d1 + ny2 * off;
              if (!paved(x, y) || !paved(x1, y1)) continue;
              const h0 = height(x, y) + 0.082, h1 = height(x1, y1) + 0.082, wx = -uy * 0.15, wy = ux * 0.15;
              guide.push(x - wx, h0, -(y - wy), x + wx, h0, -(y + wy), x1 + wx, h1, -(y1 + wy), x - wx, h0, -(y - wy), x1 + wx, h1, -(y1 + wy), x1 - wx, h1, -(y1 - wy));
            }
          }
        }
      }
      if (guide.length) {
        const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(guide, 3)); g.computeVertexNormals();
        // (raised bars across the block: a little bump in the shading, drawn in its shader)
        const m = sharedMat("tactile", () => { const mm = new THREE.MeshStandardMaterial({ color: "#d8ad1a", roughness: 0.62 });
          mm.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vTw;").replace("#include <project_vertex>", "#include <project_vertex>\nvTw = (modelMatrix * vec4(transformed, 1.0)).xyz;");
            sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vTw;").replace("#include <color_fragment>", "#include <color_fragment>\nfloat bar = smoothstep(0.35, 0.5, abs(fract((vTw.x + vTw.z) * 3.33) - 0.5) * 2.0); float seam = step(0.96, fract(vTw.x * 3.33)) + step(0.96, fract(vTw.z * 3.33)); diffuseColor.rgb *= (0.82 + 0.18 * bar) * (1.0 - 0.35 * min(seam, 1.0));"); };
          mm.customProgramCacheKey = () => "walkTactile1"; return mm; });
        const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; this.group.add(mesh); this.disposables.push(g);
      }
      // manholes: one about every 250 m² of paving, never in a planted bed
      const holes: THREE.Matrix4[] = [];
      for (let c = 0; c < cls.length; c += 37) {
        if (cls[c] !== K.PAVE && cls[c] !== PAVERS) continue;
        if (R2() > 0.025) continue;
        const i = c % nx, j = (c - i) / nx, x = cx0(i), y = cy0(j);
        holes.push(new THREE.Matrix4().compose(new THREE.Vector3(x, height(x, y) + 0.081, -y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), R2() * 6.28), new THREE.Vector3(1, 1, 1)));
      }
      if (holes.length) {
        const cover = new THREE.CylinderGeometry(0.34, 0.34, 0.012, 28);
        const m = sharedMat("manhole", () => { const mm = new THREE.MeshStandardMaterial({ color: "#3c3b39", roughness: 0.55, metalness: 0.6 });
          mm.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vMh;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvMh = position.xz;");
            sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vMh;").replace("#include <color_fragment>", "#include <color_fragment>\nfloat r = length(vMh); float ring = step(0.3, r) + step(abs(r - 0.2), 0.012); float grid = step(0.85, fract(vMh.x * 14.0)) * step(r, 0.18) + step(0.85, fract(vMh.y * 14.0)) * step(r, 0.18); diffuseColor.rgb *= 1.0 - 0.35 * min(ring + grid, 1.0);"); };
          mm.customProgramCacheKey = () => "walkManhole1"; return mm; });
        const im = new THREE.InstancedMesh(cover, m, holes.length); holes.forEach((h, n) => im.setMatrixAt(n, h)); im.receiveShadow = true; im.computeBoundingSphere();
        this.group.add(im); this.disposables.push(cover, im);
      }
    }
    // ---- trees: the canopy's crowns, three kinds, in the month's colours
    const month = (o.month ?? new Date().getMonth() + 1);
    const pal = foliage(month).map(c => new THREE.Color(c));
    const kinds = SHARED.trees ??= [broadleaf(3), broadleaf(17), pine(5)];
    const tl = new THREE.TextureLoader();
    const barkM = sharedMat("bark", () => { const bark = tl.load(`${TEX}bark_diff.webp`); bark.colorSpace = THREE.SRGBColorSpace; bark.wrapS = bark.wrapT = THREE.RepeatWrapping; return new THREE.MeshStandardMaterial({ map: bark, color: "#b8aa98", roughness: 0.95 }); });
    // (no leaf cards: solid crowns, the leaves drawn in their shader — trees.ts)
    const leafM = sharedMat("foliage", () => foliageMaterial(false)), needleM = sharedMat("foliage-pine", () => foliageMaterial(true));
    const R = rng(29), place: { k: number; m: THREE.Matrix4; c: THREE.Color; p: THREE.Vector3 }[] = [], grates: THREE.Matrix4[] = [];
    const T = res.trees, q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    let inArea = 0;
    for (let t = 0; t < T.length; t += 3) {
      const x = T[t], y = T[t + 1], r = T[t + 2];
      const i = Math.floor((x - x0) / CELL), j = Math.floor((y - y0) / CELL), b = block[j * nx + i];
      if (b === 1 || b === 2) continue;                                         // on a roof, in the carriageway
      if (o.keepClear?.(x, y)) continue;                                        // before a 동's door
      inArea++;
      // (a street tree in the pavement stands in an iron grate: 가로수 보호판)
      if (b === 3) grates.push(new THREE.Matrix4().compose(new THREE.Vector3(x, height(x, y) + 0.083, -y), q.setFromAxisAngle(up, Math.round(R() * 4) * Math.PI / 2), new THREE.Vector3(1, 1, 1)));
      const kind = r < 2.2 && R() < 0.35 ? 2 : R() < 0.5 ? 0 : 1, s = r / 3 * (0.9 + R() * 0.2);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, height(x, y), -y), q.setFromAxisAngle(up, R() * Math.PI * 2), new THREE.Vector3(s, s * (0.9 + R() * 0.25), s));
      const c = kind === 2 ? new THREE.Color("#3c5a30").multiplyScalar(0.9 + R() * 0.2) : pal[Math.floor(R() * pal.length)].clone().multiplyScalar(0.85 + R() * 0.3);
      place.push({ k: kind, m, c, p: new THREE.Vector3(x, 0, -y) });
      this.indexSolid({ x, y, hx: 1, hy: 0, length: Math.max(0.16, s * 0.4), width: Math.max(0.16, s * 0.4), speed: 0 });
    }
    for (let k = 0; k < kinds.length; k++) {
      const mine = place.filter(p => p.k === k);
      if (!mine.length) continue;
      const fm = kinds[k].pine ? needleM : leafM;
      const tr = new THREE.InstancedMesh(kinds[k].trunk, barkM, mine.length), cr = new THREE.InstancedMesh(kinds[k].crown, fm, mine.length);
      const tf = new THREE.InstancedMesh(kinds[k].trunkFar, barkM, mine.length), cf = new THREE.InstancedMesh(kinds[k].crownFar, fm, mine.length);
      // (all far until the first look round sorts them: update())
      mine.forEach((p, n) => { for (const im of [tr, cr, tf, cf]) im.setMatrixAt(n, p.m); cr.setColorAt(n, p.c); cf.setColorAt(n, p.c); });
      // (the bounds over every tree, before the near set starts empty)
      for (const im of [tr, cr, tf, cf]) { im.computeBoundingSphere(); this.group.add(im); }
      tr.count = cr.count = 0;
      for (const im of [tr, cr]) { im.castShadow = true; im.receiveShadow = true; }
      for (const im of [tf, cf]) { im.castShadow = false; im.receiveShadow = false; }
      this.treeLods.push({ near: [tr, cr], far: [tf, cf], all: mine.map(p => p.m), colors: mine.map(p => p.c), pos: mine.map(p => p.p) });
      this.disposables.push(tr, cr, tf, cf);
    }
    this.stats.trees = place.length;
    if (grates.length) {
      const bars: THREE.BufferGeometry[] = [];
      for (const s2 of [-1, 1]) { bars.push(new THREE.BoxGeometry(1.3, 0.02, 0.06).translate(0, 0, s2 * 0.62), new THREE.BoxGeometry(0.06, 0.02, 1.3).translate(s2 * 0.62, 0, 0)); }
      for (let i = -4; i <= 4; i++) if (Math.abs(i) > 1) { bars.push(new THREE.BoxGeometry(0.025, 0.015, 1.2).translate(i * 0.13, 0, 0)); }
      const g = mergeGeometries(bars.map(b => b.toNonIndexed()))!; bars.forEach(b => b.dispose());
      const m = sharedMat("grate", () => new THREE.MeshStandardMaterial({ color: "#2e2f30", roughness: 0.6, metalness: 0.7 }));
      const im = new THREE.InstancedMesh(g, m, grates.length); grates.forEach((h, n) => im.setMatrixAt(n, h)); im.receiveShadow = true; im.computeBoundingSphere();
      this.group.add(im); this.disposables.push(g, im);
    }
    // the drive world's own street trees give way where these stand
    if (!o.sharedTrees) W.hideTrees((x, y) => x > x0 + 4 && x < X1 - 4 && y > y0 + 4 && y < Y1 - 4);
    // ---- hedges and flowers round the buildings: where a building's edge meets paving or a bed
    {
      const hedge: THREE.Matrix4[] = [], flower: { m: THREE.Matrix4; c: THREE.Color }[] = [];
      const fl = month >= 9 && month <= 11 ? ["#f2c230", "#f4f0e8", "#b55aa0", "#e0782c"] : month >= 3 && month <= 5 ? ["#e8508a", "#f39ab8", "#f4f0e8", "#d03a5a"] : ["#d84a5a", "#f4f0e8", "#8a6ad0", "#f2c230"];
      for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
        const c = j * nx + i;
        if (block[c] || !(cls[c] === K.TREE || cls[c] === K.GRASS || cls[c] === K.PAVE)) continue;
        const nearB = block[c - 1] === 1 || block[c + 1] === 1 || block[c - nx] === 1 || block[c + nx] === 1;
        if (!nearB || (i + j) % 3) continue;
        const x = cx0(i), y = cy0(j), h = height(x, y);
        if (cls[c] === K.PAVE) { if (R() < 0.25) flower.push({ m: new THREE.Matrix4().makeTranslation(x, h + 0.08, -y).scale(new THREE.Vector3(1, 0.8 + R() * 0.5, 1)), c: new THREE.Color(fl[Math.floor(R() * fl.length)]) }); continue; }
        hedge.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h + 0.1, -y), q.setFromAxisAngle(up, R() * 0.3), new THREE.Vector3(1.6, 0.8 + R() * 0.3, 1.6)));
        if (R() < 0.3) flower.push({ m: new THREE.Matrix4().makeTranslation(x + (R() - 0.5), h + 0.1, -y + (R() - 0.5)), c: new THREE.Color(fl[Math.floor(R() * fl.length)]) });
      }
      if (hedge.length) {
        const g = new RoundedBoxGeometry(0.9, 0.9, 0.9, 2, 0.35).translate(0, 0.45, 0);
        const pp = g.getAttribute("position"); for (let k = 0; k < pp.count; k++) { const x = pp.getX(k), y = pp.getY(k), z = pp.getZ(k), n = 1 + 0.06 * Math.sin(x * 9 + y * 7) * Math.cos(z * 8); pp.setXYZ(k, x * n, y, z * n); } g.computeVertexNormals();
        const m = sharedMat(`hedge-${month}`, () => new THREE.MeshStandardMaterial({ color: month >= 11 || month <= 2 ? "#3c4a2c" : "#3f6a2e", roughness: 0.9 }));
        const im = new THREE.InstancedMesh(g, m, hedge.length); hedge.forEach((h, n) => im.setMatrixAt(n, h)); im.castShadow = im.receiveShadow = true; im.computeBoundingSphere();
        this.group.add(im); this.disposables.push(g, im);
      }
      if (flower.length) {
        // a clump: a mound of blooms (many small heads on a leafy base)
        const parts: THREE.BufferGeometry[] = [], r2 = rng(5);
        for (let k = 0; k < 14; k++) { const s = new THREE.IcosahedronGeometry(0.07, 0); s.translate((r2() - 0.5) * 0.5, 0.25 + r2() * 0.15, (r2() - 0.5) * 0.5); parts.push(s); }
        const g = mergeGeometries(parts)!; parts.forEach(p => p.dispose());
        const base = new THREE.SphereGeometry(0.3, 8, 6); base.scale(1, 0.6, 1); base.translate(0, 0.15, 0);
        const bloomM = sharedMat("bloom", () => new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.6 })), leafM = sharedMat("bloomLeaf", () => new THREE.MeshStandardMaterial({ color: "#3e6a2c", roughness: 0.9 }));
        const ib = new THREE.InstancedMesh(g, bloomM, flower.length), il = new THREE.InstancedMesh(base, leafM, flower.length);
        flower.forEach((f, n) => { ib.setMatrixAt(n, f.m); ib.setColorAt(n, f.c); il.setMatrixAt(n, f.m); });
        for (const im of [ib, il]) { im.receiveShadow = true; im.computeBoundingSphere(); this.group.add(im); }
        this.disposables.push(g, base, ib, il);
      }
    }
    lap("trees, hedges"); await breathe();
    // ---- parked cars, where the photographs show them (off the carriageways), in their colours
    {
      const C = res.cars, by = new Map<string, { m: THREE.Matrix4; c: THREE.Color; record?:ParkedCar }[]>();
      const passengerKinds = [...(o.carModels?.keys() ?? [])].filter(name => !["bus", "container", "garbage", "mixer", "taxi"].includes(name));
      for (let k = 0; k < C.length; k += 8) {
        if(!(k%128))await breathe();
        let x = C[k], y = C[k + 1], ang = C[k + 2];const len = C[k + 3];
        const i = Math.floor((x - x0) / CELL), j = Math.floor((y - y0) / CELL), b = block[j * nx + i];
        if (b === 1 || b === 2) continue;
        let kind = len < 4.2 ? "hatchback-sports" : len > 4.85 ? (R() < 0.5 ? "suv" : R() < 0.3 ? "mpv" : "sedan-large") : R() < 0.6 ? "sedan" : "suv-small";
        const choices = passengerKinds.filter(name => { const b = o.carModels!.get(name)!.boundingBox; return b && Math.abs(b.max.z - b.min.z - len) < 0.7; });
        if (choices.length) kind = choices[Math.floor(R() * choices.length)];
        if (!o.carModels?.has(kind)) kind = "sedan";
        const geo = o.carModels?.get(kind) ?? carGeometry(kind); if (!geo) continue;
        const size=geo.boundingBox!,carLength=size.max.z-size.min.z,carWidth=size.max.x-size.min.x;
        const pose=roadsideParking({x,y,heading:ang,length:carLength,width:carWidth},W.roads.values(),p=>{
          const hx=Math.cos(p.heading),hy=Math.sin(p.heading),points:number[]=[];
          for(const a of [-p.length/2,0,p.length/2])for(const b of [-p.width/2,p.width/2]){
            const px=p.x+hx*a-hy*b,py=p.y+hy*a+hx*b,ci=Math.floor((px-x0)/CELL),cj=Math.floor((py-y0)/CELL);
            if(ci<0||cj<0||ci>=nx||cj>=ny||block[cj*nx+ci]===1||block[cj*nx+ci]===2||cls[cj*nx+ci]!==K.ASPHALT||W.wetAt(px,py))return false;points.push(px,py);
          }
          if(W.buildingAt(points)>0||W.poleIn(p.x,p.y,hx,hy,p.length/2+.25,p.width/2+.25)||o.parkingBlocked?.(p.x,p.y,hx,hy,p.length/2+.25,p.width/2+.25)||this.blocks({x:p.x,y:p.y,hx,hy,length:p.length+.3,width:p.width+.3,speed:0}))return false;
          const id=`${Math.round(p.x*2)}:${Math.round(-p.y*2)}`;
          return !o.parkedCars||!o.parkedCars.blocks({x:p.x,y:p.y,hx,hy,length:p.length+.6,width:p.width+.4,speed:0},id);
        });
        if(!pose)continue;({x,y,heading:ang}=pose);
        // (either way round along its axis: half nose-in)
        const dir = R() < 0.5 ? 1 : -1, hx = Math.cos(ang) * dir, hy = Math.sin(ang) * dir;
        if(!o.parkedCars)this.indexSolid({ x, y, hx, hy, length: len, width: Math.max(1.55, C[k + 4]), speed: 0 });
        // (stood on the highest of its four wheels' ground and the asphalt's lift: on a slope the
        // middle's height sank the uphill wheels into the surface)
        const wl = len * 0.36, ww = 0.75;
        let gz = -Infinity;
        for (const [a, b] of [[wl, ww], [wl, -ww], [-wl, ww], [-wl, -ww]]) gz = Math.max(gz, height(x + hx * a - hy * b, y + hy * a + hx * b));
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, gz + 0.05, -y), q.setFromAxisAngle(up, Math.atan2(hx, -hy)), new THREE.Vector3(1, 1, 1));
        const c=parkedCarPaint(C[k+5],C[k+6],C[k+7],o.origin.lon+C[k]/o.origin.kx,o.origin.lat+C[k+1]/o.origin.ky),record=o.parkedCars?.provide(kind,m,c,geo);
        const l = by.get(kind) ?? []; l.push({ m, c, record }); by.set(kind, l);
      }
      const mat = sharedMat("car", realCarMaterial);
      for (const [kind, l] of by) {
        const geo = (o.carModels?.get(kind) ?? carGeometry(kind))!, im = new THREE.InstancedMesh(geo, mat, l.length);
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(l.length * 3), 3);
        l.forEach((p, n) => { im.setMatrixAt(n, p.m); im.setColorAt(n, p.c); });
        if(o.parkedCars)im.userData.carRecords=l.map(p=>p.record);
        im.castShadow = im.receiveShadow = true; im.computeBoundingSphere(); this.group.add(im); this.disposables.push(im);
        const glass = o.carWindows?.get(kind);
        if (o.carBatches) this.disposables.push(o.carBatches.add(im));
        else if (glass?.getIndex()?.count && o.carGlass) this.disposables.push(attachCarWindows(im, glass, o.carGlass));
        this.stats.cars += l.length;
      }
    }
    lap("cars"); await breathe();
    // ---- people: on the sidewalks of the roads in the area, and round the buildings
    {
      const paths: WalkPath[] = [];
      const mk = (pts: [number, number][], lift: number): WalkPath => {
        const n = pts.length, xs = new Float32Array(n), ys = new Float32Array(n), cum = new Float32Array(n);
        pts.forEach(([x, y], i) => { xs[i] = x; ys[i] = y; if (i) cum[i] = cum[i - 1] + Math.hypot(x - xs[i - 1], y - ys[i - 1]); });
        return { xs, ys, cum, closed: false, lift, lateral: 0.6 };
      };
      for (const r of W.roads.values()) {
        const p = r.pts; if (p.length < 6) continue;
        let inside = false; for (let k = 0; k < p.length; k += 3) if (Math.abs(p[k] - cx) < half && Math.abs(p[k + 1] - cy) < half) { inside = true; break; }
        if (!inside) continue;
        for (const side of [1, -1]) {
          const off = side * (r.w / 2 + (r.major ? 1.6 : 0.9)), pts: [number, number][] = [];
          for (let k = 0; k < p.length; k += 3) {
            const a = Math.max(0, k - 3), b = Math.min(p.length - 3, k + 3), dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], l = Math.hypot(dx, dy) || 1;
            pts.push([p[k] - (dy / l) * off, p[k + 1] + (dx / l) * off]);
          }
          // (every 2 m along; cut where it would cross a carriageway or a building: people keep to
          // the pavement, a junction crossed at the crossing, not down the middle of a road)
          let run: [number, number][] = [];
          const flush = () => { let len = 0; for (let q = 1; q < run.length; q++) len += Math.hypot(run[q][0] - run[q - 1][0], run[q][1] - run[q - 1][1]); if (len >= 8) paths.push(mk(run, 0.17)); run = []; };
          for (let q = 0; q + 1 < pts.length; q++) {
            const [ax, ay] = pts[q], [bx, by] = pts[q + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2));
            for (let t = 0; t < n; t++) {
              const x = ax + (bx - ax) * t / n, y = ay + (by - ay) * t / n;
              const i = Math.floor((x - x0) / CELL), j = Math.floor((y - y0) / CELL);
              const bad = i < 0 || j < 0 || i >= nx || j >= ny || block[j * nx + i] === 1 || block[j * nx + i] === 2;
              if (bad) { if (run.length) flush(); } else run.push([x, y]);
            }
          }
          if (run.length) flush();
        }
      }
      const rings = W.footprintsIn(cx - half, cy - half, cx + half, cy + half).filter(f => f.top > 9).map(f => { const r: [number, number][] = []; for (let k = 0; k < f.ring.length; k += 2) r.push([f.ring[k], f.ring[k + 1]]); return r; });
      const blocked = (x: number, y: number) => { const i = Math.floor((x - x0) / CELL), j = Math.floor((y - y0) / CELL); if (i < 0 || j < 0 || i >= nx || j >= ny) return true; const b = block[j * nx + i]; return b === 1 || b === 2 || cls[j * nx + i] === K.TREE; };
      paths.push(...ringPaths(rings as never, 3.2, blocked, 0.5));
      const terrain = { at: (x: number, y: number) => height(x, y) + 0.07, base: () => 0 };
      // (the walk's crowd: with its children, commuters, joggers and couriers — sceneWalkers extras)
      // (each patch its own crowd: one seed for all made every patch the same seventy people)
      this.walkers = await buildWalkers(paths, terrain as never, 7 + (Math.abs(Math.round(cx * 0.37 + cy * 0.71)) % 9973), 16, o.peopleCap ?? 150, true);
      if (this.walkers) { this.group.add(this.walkers.group); this.stats.people = (this.walkers.group.userData.walkers as unknown[]).length; }
    }
    lap("people");
    if(o.prepare)await o.prepare(this.group);
    this.group.visible=true;
    this.stats.ms = Math.round(performance.now() - t0); this.stats.tiles = res.tiles;
  }

  /** People walk; the trees within 140 m in their full model, the rest one lump (sorted every half
   * second, when the eye has moved 6 m) */
  update(dt: number, camera: THREE.Camera, near = true) {
    // (a patch far off: its people stand hidden — one crowd's draws for every patch was too many)
    if (this.walkers) { this.walkers.group.visible = near; if (near) this.walkers.update(dt, camera); }
    this.lodT -= dt;
    if (this.lodT > 0) return;
    this.lodT = 0.5;
    const eye = camera.position;
    if (this.lodEye.distanceToSquared(eye) < 36) return;
    this.lodEye.copy(eye);
    for (const t of this.treeLods) {
      let n = 0, f = 0;
      for (let k = 0; k < t.all.length; k++) {
        const close = t.pos[k].distanceToSquared(eye) < 140 * 140;
        const set = close ? t.near : t.far, at = close ? n++ : f++;
        set[0].setMatrixAt(at, t.all[k]); set[1].setMatrixAt(at, t.all[k]); set[1].setColorAt(at, t.colors[k]);
      }
      t.near[0].count = t.near[1].count = n; t.far[0].count = t.far[1].count = f;
      for (const im of [...t.near, ...t.far]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    }
  }

  dispose() {
    this.solids.clear();
    if (!this.o.sharedTrees) this.o.world.hideTrees(null);
    this.walkers?.dispose();
    this.o.scene.remove(this.group);
    this.disposables.forEach(d => d.dispose());
  }
}

// ------------------------------------------------------------------ helpers
/** The aerial reading: in a worker when it can draw off the page, else here. */
async function read(a: AerialAsk): Promise<AerialResult> {
  if (typeof OffscreenCanvas !== "undefined") {
    try {
      const w = new Worker(new URL("./aerialWorker.ts", import.meta.url), { type: "module" });
      return await new Promise<AerialResult>((res, rej) => { w.onmessage = e => { w.terminate(); res(e.data); }; w.onerror = e => { w.terminate(); rej(e); }; w.postMessage(a); });
    } catch { /* below */ }
  }
  const t0 = performance.now(), { urls, w, h, ox, oy } = tilesFor(a);
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const g = cv.getContext("2d", { willReadFrequently: true })!;
  let failed = 0;
  await Promise.all(urls.map(async u => { try { const r = await fetch(u.url); const b = await createImageBitmap(await r.blob()); g.drawImage(b, u.x * 256, u.y * 256); } catch { failed++; } }));
  const res = analyse(a, g.getImageData(0, 0, w, h).data, w, h, ox, oy);
  return { ...res, ms: Math.round(performance.now() - t0), tiles: urls.length, failed };
}

/** Mark the cells inside a ring (x y pairs) with `v`. */
function fillRing(grid: Uint8Array, nx: number, ny: number, x0: number, y0: number, ring: Float32Array, v: number) {
  let ya = Infinity, yb = -Infinity;
  for (let k = 1; k < ring.length; k += 2) { ya = Math.min(ya, ring[k]); yb = Math.max(yb, ring[k]); }
  const j0 = Math.max(0, Math.floor((ya - y0) / CELL)), j1 = Math.min(ny - 1, Math.floor((yb - y0) / CELL));
  const xs: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const y = y0 + (j + 0.5) * CELL; xs.length = 0;
    for (let a = 0, b = ring.length - 2; a < ring.length; b = a, a += 2) {
      const ay = ring[a + 1], by = ring[b + 1];
      if ((ay > y) !== (by > y)) xs.push(ring[a] + ((y - ay) / (by - ay)) * (ring[b] - ring[a]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - x0) / CELL - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[k + 1] - x0) / CELL - 0.5));
      for (let i = i0; i <= i1; i++) grid[j * nx + i] = v;
    }
  }
}
/** Mark the cells within r of a segment with `v` (lower marks don't overwrite higher priority: 1 > 2 > 3). */
function stampSeg(grid: Uint8Array, nx: number, ny: number, x0: number, y0: number, ax: number, ay: number, bx: number, by: number, r: number, v: number) {
  const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - x0) / CELL)), i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx) + r - x0) / CELL));
  const j0 = Math.max(0, Math.floor((Math.min(ay, by) - r - y0) / CELL)), j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by) + r - y0) / CELL));
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = x0 + (i + 0.5) * CELL, y = y0 + (j + 0.5) * CELL, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    if (Math.hypot(x - ax - dx * t, y - ay - dy * t) > r) continue;
    const c = j * nx + i, cur = grid[c];
    if (cur === 1 || (cur === 2 && v === 3)) continue;
    grid[c] = v;
  }
}
