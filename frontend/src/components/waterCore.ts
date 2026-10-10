import * as THREE from "three";
import { inRing } from "./ringMath";
import { coastField, type CoastData } from './coastField';

/* The water's work that needs no page: the raster of the open-water parcels (level, wet,
 * distance to the bank) and the surface's vertices. Run in the scene worker (sceneWorker.ts),
 * or on the page in slices where a worker can't run (sceneWater.ts). */

/** Yields the thread when the current slice is used up; false once the view is gone. */
export type Pace = () => Promise<boolean>;

/** The water raster: per node the local level, wet (1/0) and metres to the nearest dry node. */
export interface FieldData { lvl: Float32Array; wet: Uint8Array; dist: Float32Array; x0: number; y0: number; s: number; nx: number; ny: number; coast?: CoastData }
/** A terrain height grid (sceneTerrain's Terrain.grid) as a height function. */
export type HeightGrid = { h: Float32Array; n: number; R: number; cell: number };
export function gridAt({ h, n, R, cell }: HeightGrid) {
  return (x: number, y: number) => {
    const gx = Math.min(n - 1.001, Math.max(0, (x + R) / cell)), gy = Math.min(n - 1.001, Math.max(0, (y + R) / cell));
    const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
    return (h[j * n + i] * (1 - fx) + h[j * n + i + 1] * fx) * (1 - fy) + (h[(j + 1) * n + i] * (1 - fx) + h[(j + 1) * n + i + 1] * fx) * fy;
  };
}
export interface WaterArrays { pos: Float32Array; uv: Float32Array; nor: Float32Array; shore: Float32Array; flow: Float32Array; sea: Float32Array; index: Uint32Array }

/** Rasterised water: every open-water parcel on one grid (adjacent parcels of one river
 * are one channel, not separate ponds with banks between them). Per node: inside,
 * ground height, the local water level and the distance to the nearest dry node (the
 * bank), in metres. Replaces point-in-polygon tests per vertex (seconds on a river). */
export async function waterField(rings: [number, number][][], at: (x: number, y: number) => number, pace: Pace, holes: [number,number][][] = [],
  /** per ring: the sea (made from the coastline — its outline is the water's edge): all of it
   * water, at one level, the sea's */
  sea: boolean[] = [],
  /** the square the rings were cut to (the water goes on past it: its edge is no shore) */
  open: [number, number, number, number] | null = null, seaDatum: number | null = null): Promise<FieldData | null> {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  // 2 m nodes; a coarser step only for very large rivers (at most ~300k nodes).
  const s = Math.max(2, Math.sqrt(((x1 - x0) * (y1 - y0)) / 300000));
  x0 -= s; y0 -= s;
  const nx = Math.ceil((x1 - x0) / s) + 2, ny = Math.ceil((y1 - y0) / s) + 2, n = nx * ny;
  const inside = new Uint8Array(n), h = new Float32Array(n), lvl = new Float32Array(n), seaIn = new Uint8Array(n);
  // Scanline fill (even-odd per ring, union over rings).
  const xs: number[] = [];
  for (const [ri, r] of rings.entries()) for (let j = 0; j < ny; j++) {
    if (!await pace()) return null;
    const y = y0 + j * s;
    xs.length = 0;
    for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
      const [xi, yi] = r[i], [xk, yk] = r[k];
      if (yi > y !== yk > y) xs.push(((xk - xi) * (y - yi)) / (yk - yi) + xi);
    }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2)
      for (let i = Math.max(0, Math.ceil((xs[q] - x0) / s)), e = Math.min(nx - 1, Math.floor((xs[q + 1] - x0) / s)); i <= e; i++) { inside[j * nx + i] = 1; if (sea[ri]) seaIn[j * nx + i] = 1; }
  }
  for (const hole of holes) {
    const minX=Math.min(...hole.map(p=>p[0])),maxX=Math.max(...hole.map(p=>p[0])),minY=Math.min(...hole.map(p=>p[1])),maxY=Math.max(...hole.map(p=>p[1]));
    for(let j=Math.max(0,Math.ceil((minY-y0)/s));j<ny&&y0+j*s<=maxY;j++){
      if(!await pace())return null;
      for(let i=Math.max(0,Math.ceil((minX-x0)/s));i<nx&&x0+i*s<=maxX;i++)if(inRing([x0+i*s,y0+j*s],hole))inside[j*nx+i]=seaIn[j*nx+i]=0;
    }
  }
  for (let j = 0; j < ny; j++) {
    if (!await pace()) return null;
    for (let i = 0; i < nx; i++) h[j * nx + i] = inside[j * nx + i] ? at(x0 + i * s, y0 + j * s) : Infinity;
  }
  // Where the water actually is: a 하천 parcel also holds its banks and riverside paths
  // (둔치). The national DEM shows the channel as the lowest ground: water only within
  // 0.7 m of the lowest point nearby (25 m round, on water parcels).
  const r = Math.round(25 / s), dirs = Array.from({ length: 8 }, (_, k) => [Math.round(Math.cos(k * Math.PI / 4) * r), Math.round(Math.sin(k * Math.PI / 4) * r)]);
  for (let j = 0; j < ny; j++) {
    if (!await pace()) return null;
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      if (!inside[c]) { lvl[c] = Infinity; continue; }
      let m = h[c];
      for (const [di, dj] of dirs) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nx && b < ny) m = Math.min(m, h[b * nx + a]); }
      lvl[c] = m;
    }
  }
  // Chamfer distance (m) from the seed nodes, forward and backward pass.
  const d1 = s, d2 = s * Math.SQRT2;
  const chamfer = async (seed: Uint8Array) => {
    const d = new Float32Array(n);
    for (let c = 0; c < n; c++) d[c] = seed[c] ? 0 : 1e6;
    for (let j = 0; j < ny; j++) {
      if (!await pace()) return null;
      for (let i = 0; i < nx; i++) {
        const c = j * nx + i; if (!d[c]) continue;
        let v = d[c];
        if (i > 0) v = Math.min(v, d[c - 1] + d1);
        if (j > 0) { v = Math.min(v, d[c - nx] + d1); if (i > 0) v = Math.min(v, d[c - nx - 1] + d2); if (i < nx - 1) v = Math.min(v, d[c - nx + 1] + d2); }
        d[c] = v;
      }
    }
    for (let j = ny - 1; j >= 0; j--) {
      if (!await pace()) return null;
      for (let i = nx - 1; i >= 0; i--) {
        const c = j * nx + i; if (!d[c]) continue;
        let v = d[c];
        if (i < nx - 1) v = Math.min(v, d[c + 1] + d1);
        if (j < ny - 1) { v = Math.min(v, d[c + nx] + d1); if (i < nx - 1) v = Math.min(v, d[c + nx + 1] + d2); if (i > 0) v = Math.min(v, d[c + nx - 1] + d2); }
        d[c] = v;
      }
    }
    return d;
  };
  // The sea: one level — low in what the DEM gives over it (its posts out at sea; the shore's
  // are the land's) — and wet to the coastline; the ground under it is sunk below (sink).
  let seaLevel = Infinity;
  {
    const hs: number[] = [];
    for (let c = 0; c < n; c += 3) if (seaIn[c] && Number.isFinite(h[c])) hs.push(h[c]);
    if (hs.length) { hs.sort((a, b) => a - b); seaLevel = hs[Math.floor(hs.length * 0.1)]; }
  }
  if (seaDatum !== null && Number.isFinite(seaDatum)) seaLevel = seaDatum;
  const wet = new Uint8Array(n);
  for (let c = 0; c < n; c++) {
    if (seaIn[c] && Number.isFinite(seaLevel)) { lvl[c] = seaLevel; wet[c] = 1; continue; }
    wet[c] = inside[c] && h[c] <= lvl[c] + 0.7 ? 1 : 0;
  }
  // A river runs on under its bridges, where the DEM carries the road across as a dam:
  // close the channel (dilate by R on the water parcels, erode by R), bridging gaps up
  // to ~2R along it.
  const R = 15, toWet = await chamfer(wet), grown = new Uint8Array(n);
  if (!toWet) return null;
  for (let c = 0; c < n; c++) grown[c] = inside[c] && toWet[c] <= R ? 0 : 1; // seeds: outside the grown water
  const toOut = await chamfer(grown);
  if (!toOut) return null;
  for (let c = 0; c < n; c++) if (!wet[c] && inside[c] && toOut[c] > R) wet[c] = 1;
  const dry = new Uint8Array(n);
  for (let c = 0; c < n; c++) dry[c] = wet[c] ? 0 : 1;
  // (past the square the rings were cut to, the water is taken to go on: the distance to the
  // bank is to the real shore, not to the cut — no surf along it)
  if (open) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * s, y = y0 + j * s;
    if (x <= open[0] || y <= open[1] || x >= open[2] || y >= open[3]) dry[j * nx + i] = 0;
  }
  const dist = await chamfer(dry);
  if (!dist) return null;
  const seaRings = rings.filter((_, i) => sea[i]);
  const coast = seaRings.length && Number.isFinite(seaLevel) ? { rings: seaRings, holes: holes.filter(h => seaRings.some(r => inRing(h[0], r))), open, level: seaLevel, seaOnly: seaRings.length === rings.length } : undefined;
  return { lvl, wet, dist, x0, y0, s, nx, ny, coast };
}

export function fieldFrom(d: FieldData, at: (x: number, y: number) => number) {
  const { lvl, wet, dist, x0, y0, s, nx, ny } = d;
  const coast = d.coast ? coastField(d.coast) : null;
  /** Bilinear over the nodes (finite values only: the level exists on water parcels). */
  const sample = (f: Float32Array, x: number, y: number, fallback: number) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - x0) / s)), fy = Math.min(ny - 1.001, Math.max(0, (y - y0) / s));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const c = j * nx + i;
    let sum = 0, w = 0;
    const add = (val: number, k: number) => { if (k > 0 && Number.isFinite(val)) { sum += val * k; w += k; } };
    add(f[c], (1 - u) * (1 - v)); add(f[c + 1], u * (1 - v)); add(f[c + nx], (1 - u) * v); add(f[c + nx + 1], u * v);
    return w > 0 ? sum / w : fallback;
  };
  const node = (x: number, y: number) => {
    const i = Math.round((x - x0) / s), j = Math.round((y - y0) / s);
    return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : j * nx + i;
  };
  return {
    coast,
    level: (x: number, y: number) => coast?.wet(x, y) ? coast.level : sample(lvl, x, y, at(x, y)),
    /** On the (closed) water. */
    wet: (x: number, y: number) => {
      const c = node(x, y);
      if (coast && d.coast!.seaOnly) return coast.wet(x, y);
      if (coast?.wet(x, y)) return true;
      if (coast && c >= 0 && coast.distance(x, y) < Math.max(32, s * 2) && coast.wet(x0 + (c % nx) * s, y0 + Math.floor(c / nx) * s)) return false;
      return coast?.wet(x, y) || (c >= 0 && wet[c] === 1);
    },
    // Half a node: the bank line lies between a wet and a dry node.
    shore: (x: number, y: number) => coast && (d.coast!.seaOnly || coast.wet(x, y) || coast.distance(x, y) < .01) ? coast.distance(x, y) : Math.max(0, sample(dist, x, y, 0) - s * 0.5),
    /** The grid's extent (footprint metres), for walking the water (sceneBoats.ts). */
    bounds: { x0, y0, x1: x0 + (nx - 1) * s, y1: y0 + (ny - 1) * s },
  };
}

export type WaterField = ReturnType<typeof fieldFrom>;

/** The surface over the open-water parcels' rings, subdivided to follow the channel. */
export async function waterSurface(rings: [number, number][][], field: WaterField, pace: Pace, holes: [number,number][][] = [], sea: boolean[] = []): Promise<WaterArrays | null> {
  const pos: number[] = [], uv: number[] = [], nor: number[] = [], shore: number[] = [], flow: number[] = [], seaA: number[] = [], index: number[] = [];
  // (a corner shared by the triangles round it is one vertex: everything at a vertex follows from
  // where it is and which parcel it belongs to. Unshared, each was stored ~6 times — 8 MB of
  // vertices on the Han river, and as many shore and level look-ups.)
  for (const [ri, ring] of rings.entries()) {
    const at = new Map<string, number>();
    const isSea = !!sea[ri];
    // Flow along the parcel's longest edge.
    let best = 0, ang = 0;
    ring.forEach((a, i) => { const b = ring[(i + 1) % ring.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > best) { best = l; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); } });
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const distances = new WeakMap<THREE.Vector2, number>();
    const shoreAt = (p: THREE.Vector2) => { let d = distances.get(p); if (d === undefined) { d = field.shore(p.x, p.y); distances.set(p, d); } return d; };
    const pts = ring.map(([x, y]) => new THREE.Vector2(x, y));
    const inner=holes.filter(h=>inRing(h[0],ring)).map(h=>h.map(([x,y])=>new THREE.Vector2(x,y)));
    const tris = THREE.ShapeUtils.triangulateShape(pts, inner);
    pts.push(...inner.flat());
    const wet = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2) => field.wet((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3);
    // Subdivided finely so the waterline follows the channel; the surface at the local
    // level. aShore = metres to the bank, aFlow = the channel direction in world x/z
    // (the WebGPU water: its depth, soft edge and current).
    const push = (x: number, y: number) => {
      const key = `${x.toFixed(3)},${y.toFixed(3)}`;
      const had = at.get(key);
      if (had !== undefined) { index.push(had); return; }
      at.set(key, pos.length / 3); index.push(pos.length / 3);
      pos.push(x, field.level(x, y) + 0.12, -y);
      uv.push(x * ux + y * uy, -x * uy + y * ux);
      nor.push(0, 1, 0);
      const sh = field.shore(x, y);
      shore.push(sh);
      if (isSea) {
        // (the sea's waves run in to the shore — down the distance to it — near it; out at sea, one
        // swell for all the sea's surfaces, from the south-east: the distance's slope out there
        // turned from vertex to vertex and tore the waves into streaks)
        const gx = field.shore(x + 3, y) - field.shore(x - 3, y), gy = field.shore(x, y + 3) - field.shore(x, y - 3), gl = Math.hypot(gx, gy);
        const k = Math.min(1, Math.max(0, (sh - 30) / 50)), sx = -0.6, sy = 0.8;
        let fx = sx, fy = sy;
        if (gl > 1e-3 && k < 1) { fx = -gx / gl * (1 - k) + sx * k; fy = gy / gl * (1 - k) + sy * k; const fl = Math.hypot(fx, fy) || 1; fx /= fl; fy /= fl; }
        flow.push(fx, fy);
      } else flow.push(ux, -uy);
      seaA.push(isSea ? 1 : 0);
    };
    const split = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2, depth: number): void => {
      const ab = a.distanceTo(b), bc = b.distanceTo(c), ca = c.distanceTo(a), m = Math.max(ab, bc, ca);
      // (the open sea, past its surf zone, in larger triangles: it is all one level)
      // Sea is level: sub-6 m triangles added no wave detail (waves are per pixel).
      // Keep every real coastline/island vertex, refine only the narrow surf zone, and
      // use 96 m triangles beyond the surf zone. River relief keeps its 6 m grid.
      const da = isSea ? shoreAt(a) : 0, db = isSea ? shoreAt(b) : 0, dc = isSea ? shoreAt(c) : 0, sh = Math.min(da, db, dc);
      let step = isSea ? sh < 96 ? 16 : 96 : 6;
      // Straight beaches interpolate the exact vector distance already. Refine only
      // where curves/corners exceed 25 cm error; full 4 m surf strips were wasteful.
      if (isSea && sh < 36 && m < 16 && m > 4) {
        const error = Math.max(
          Math.abs(field.shore((a.x+b.x)/2,(a.y+b.y)/2)-(da+db)/2),
          Math.abs(field.shore((b.x+c.x)/2,(b.y+c.y)/2)-(db+dc)/2),
          Math.abs(field.shore((c.x+a.x)/2,(c.y+a.y)/2)-(dc+da)/2),
          Math.abs(field.shore((a.x+b.x+c.x)/3,(a.y+b.y+c.y)/3)-(da+db+dc)/3));
        if (error > .25) step = 4;
      }
      if (m < step || depth > 18) { if (isSea || wet(a, b, c)) { push(a.x, a.y); push(b.x, b.y); push(c.x, c.y); } return; }
      if (m === ab) { const d = a.clone().lerp(b, 0.5); split(a, d, c, depth + 1); split(d, b, c, depth + 1); }
      else if (m === bc) { const d = b.clone().lerp(c, 0.5); split(a, b, d, depth + 1); split(a, d, c, depth + 1); }
      else { const d = c.clone().lerp(a, 0.5); split(a, b, d, depth + 1); split(d, b, c, depth + 1); }
    };
    for (const [i, j, k] of tris) {
      if (!await pace()) return null;
      // Wind upward (+y): footprint frame x east / y north maps to world (x, -y).
      const a = pts[i], b = pts[j], c = pts[k];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (cross > 0) split(a, b, c, 0); else split(a, c, b, 0);
    }
  }
  if (!pos.length) return null;
  return { pos: new Float32Array(pos), uv: new Float32Array(uv), nor: new Float32Array(nor), shore: new Float32Array(shore), flow: new Float32Array(flow), sea: new Float32Array(seaA), index: new Uint32Array(index) };
}

/** A water parcel that is not open water: a surveyed road or named street runs along it
 * (a covered stream, 복개천 — its surface is road), or registered buildings stand on a
 * third of it. `lines` are road centrelines, `onBuilding` tests a point. */
export function coveredStream(ring: [number, number][], lines: [number, number][][], onBuilding: (x: number, y: number) => boolean): boolean {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  // Road along it: at least half the parcel's length, and the parcel no wider than a
  // road (a river parcel is far wider: roads along its banks don't cover it).
  let perimeter = 0, area = 0;
  ring.forEach(([x, y], i) => { const [qx, qy] = ring[(i + 1) % ring.length]; perimeter += Math.hypot(qx - x, qy - y); area += x * qy - qx * y; });
  const width = (2 * Math.abs(area / 2)) / Math.max(1, perimeter), length = perimeter / 2;
  const need = width <= 25 ? 0.5 * length : Infinity;
  let inside = 0;
  for (const line of lines) for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i];
    if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1) continue;
    const len = Math.hypot(bx - ax, by - ay);
    for (let d = 0; d < len; d += 1) if (inRing([ax + (bx - ax) * d / len, ay + (by - ay) * d / len], ring)) inside += Math.min(1, len - d);
    if (inside >= need) return true;
  }
  let n = 0, built = 0;
  const step = Math.max(1, Math.sqrt((x1 - x0) * (y1 - y0) / 400));
  for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) {
    if (!inRing([x, y], ring)) continue;
    n++; if (onBuilding(x, y)) built++;
  }
  return n > 0 && built / n > 0.33;
}
