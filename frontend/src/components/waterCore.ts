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
  // The DEM gives open water as a level surface (the Han: the same height to the centimetre for
  // hundreds of metres; a stream's bed a plane falling along it); a 둔치, a field, a bank varies by
  // decimetres. Water is only where such a surface is within 12 m and this ground no more than
  // 0.5 m over it — a riverside field
  // inside a river parcel, its own lowest point nearby, is no water (it flooded whole 둔치).
  levelWater(h, wet, nx, ny, s);
  // A river's channel is the lowest ground round it: a level flat 3.5 m and more over the lowest
  // ground within 500 m — a reed field on the 둔치 the DEM shows smooth — is no water. (The pool
  // above one of the Han's weirs lies some 3 m over the river below it: still water.)
  // (the river's fall allowed: 0.2 % of the distance — a stream's bed stays water along it)
  {
    const G = 16, gx0 = x0 - 500, gy0 = y0 - 500, gnx = Math.ceil((nx * s + 1000) / G) + 1, gny = Math.ceil((ny * s + 1000) / G) + 1;
    const gh = new Float32Array(gnx * gny);
    for (let j = 0; j < gny; j++) for (let i = 0; i < gnx; i++) { const v = at(gx0 + i * G, gy0 + j * G); gh[j * gnx + i] = Number.isFinite(v) ? v : Infinity; }
    const floorAt = floorField(gh, gnx, gny, 0.002 * G);
    if (!await pace()) return null;
    for (let c = 0; c < n; c++) {
      if (!wet[c]) continue;
      const i = Math.round((x0 + (c % nx) * s - gx0) / G), j = Math.round((y0 + Math.floor(c / nx) * s - gy0) / G);
      if (h[c] > floorAt[Math.min(gny - 1, Math.max(0, j)) * gnx + Math.min(gnx - 1, Math.max(0, i))] + 3.5) wet[c] = 0;
    }
  }
  // (the riverside parks' raised ground, 둔치, is no water: dryTerraces)
  for (let c = 0; c < n; c++) if (seaIn[c]) wet[c] = 0;
  dryTerraces(h, wet, nx, ny, s);
  for (let c = 0; c < n; c++) if (seaIn[c] && Number.isFinite(seaLevel)) wet[c] = 1;
  if (!await pace()) return null;
  // A river runs on under its bridges, where the DEM carries the road across as a dam:
  // close the channel (dilate by R on the water parcels, erode by R), bridging gaps up
  // to ~2R along it.
  const R = 15, toWet = await chamfer(wet), grown = new Uint8Array(n);
  if (!toWet) return null;
  for (let c = 0; c < n; c++) grown[c] = inside[c] && toWet[c] <= R ? 0 : 1; // seeds: outside the grown water
  const toOut = await chamfer(grown);
  if (!toOut) return null;
  for (let c = 0; c < n; c++) if (!wet[c] && inside[c] && toOut[c] > R) wet[c] = 1;
  // A circular closing cannot reconnect a channel narrower than its 30 m disk:
  // erosion removes the entire replacement, including streams below bridges.
  // Search along the channel instead. Both existing water ends must be within
  // 64 m, the whole connection must remain inside mapped water, and the cross
  // section must be a stream corridor (<=128 m). Never propagate from new fills.
  const seeds=wet.slice(),fills:[number,number][]=[];
  const axes=[[1,0],[0,1],[1,1],[1,-1]];
  for(let j=0;j<ny;j++){
    if(!await pace())return null;
    for(let i=0;i<nx;i++){
      const c=j*nx+i;if(!inside[c]||seeds[c]||toWet[c]>32)continue;
      let best=Infinity,value=0;
      for(const [dx,dy] of axes){
        const step=s*Math.hypot(dx,dy),limit=Math.floor(64/step);
        const end=(sign:number)=>{
          for(let q=1;q<=limit;q++){
            const a=i+dx*q*sign,b=j+dy*q*sign;
            if(a<0||b<0||a>=nx||b>=ny||!inside[b*nx+a])return null;
            if(seeds[b*nx+a])return {c:b*nx+a,d:q*step};
          }
          return null;
        };
        const a=end(-1);if(!a)continue;
        const b=end(1);if(!b||a.d+b.d>64||a.d+b.d>=best)continue;
        if(Math.abs(lvl[a.c]-lvl[b.c])>.75+.03*(a.d+b.d))continue;
        let width=0;
        for(const sign of [-1,1])for(let q=1;q*step<=130;q++){
          const x=i-dy*q*sign,y=j+dx*q*sign;
          if(x<0||y<0||x>=nx||y>=ny||!inside[y*nx+x])break;
          width+=step;if(width>128)break;
        }
        if(width>128)continue;
        best=a.d+b.d;value=(lvl[a.c]*b.d+lvl[b.c]*a.d)/best;
      }
      if(Number.isFinite(best))fills.push([c,value]);
    }
  }
  for(const [c,value] of fills){wet[c]=1;lvl[c]=value;}
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
    // Boats, collision queries and draping sample this continuously. Preserve the
    // accumulation order without allocating a closure for each bilinear lookup.
    let val = f[c], k = (1 - u) * (1 - v);
    if (k > 0 && Number.isFinite(val)) { sum += val * k; w += k; }
    val = f[c + 1]; k = u * (1 - v);
    if (k > 0 && Number.isFinite(val)) { sum += val * k; w += k; }
    val = f[c + nx]; k = (1 - u) * v;
    if (k > 0 && Number.isFinite(val)) { sum += val * k; w += k; }
    val = f[c + nx + 1]; k = u * v;
    if (k > 0 && Number.isFinite(val)) { sum += val * k; w += k; }
    return w > 0 ? sum / w : fallback;
  };
  const node = (x: number, y: number) => {
    const i = Math.round((x - x0) / s), j = Math.round((y - y0) / s);
    return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : j * nx + i;
  };
  return {
    data: d,
    coast,
    level: (x: number, y: number) => {
      if (coast?.wet(x, y)) return coast.level;
      const level = sample(lvl, x, y, NaN);
      // A finite water level needs no terrain fallback (often another costly grid lookup).
      return Number.isNaN(level) ? at(x, y) : level;
    },
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

/** Boats/wakes share the continuous sea datum where a tidal river overlaps it. */
export function withSeaLevel(field:WaterField,sea:()=>WaterField|null):WaterField{
  return {...field,level:(x,y)=>{const coast=sea();return coast?.wet(x,y)?coast.level(x,y):field.level(x,y);}};
}

/** The lowest ground with the river's fall allowed: per cell, min over cells of (height + rise ×
 * distance in cells) — two chamfer passes (8 neighbours), linear in the cells. Self-contained. */
export function floorField(h: Float32Array, nx: number, ny: number, rise: number) {
  const f = Float32Array.from(h), d1 = rise, d2 = rise * Math.SQRT2;
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = j * nx + i; let v = f[c];
      if (i > 0) v = Math.min(v, f[c - 1] + d1);
      if (j > 0) { v = Math.min(v, f[c - nx] + d1); if (i > 0) v = Math.min(v, f[c - nx - 1] + d2); if (i < nx - 1) v = Math.min(v, f[c - nx + 1] + d2); }
      f[c] = v;
    }
    for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
      const c = j * nx + i; let v = f[c];
      if (i < nx - 1) v = Math.min(v, f[c + 1] + d1);
      if (j < ny - 1) { v = Math.min(v, f[c + nx] + d1); if (i < nx - 1) v = Math.min(v, f[c + nx + 1] + d2); if (i > 0) v = Math.min(v, f[c + nx - 1] + d2); }
      f[c] = v;
    }
  }
  return f;
}

/** (waterField, and farGround's painting of the bed) Keeps `wet` only near the level surfaces
 * open water shows in the DEM: round a node (4 m, over the other candidates only)
 * the heights lie within 6 cm of a plane (a stream's bed may fall along it). Self-contained. */
export function levelWater(h: Float32Array, wet: Uint8Array, nx: number, ny: number, s: number) {
  const n = nx * ny, r = Math.max(1, Math.round(4 / s)), reach = Math.max(1, Math.round(12 / s));
  const level = new Float32Array(n).fill(NaN);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i; if (!wet[c]) continue;
    // least-squares plane z = a + b·u + d·v over the window's candidates, then its worst residual
    let N = 0, su = 0, sv = 0, sz = 0, suu = 0, svv = 0, suv = 0, suz = 0, svz = 0;
    for (let b = Math.max(0, j - r); b <= Math.min(ny - 1, j + r); b++) for (let a = Math.max(0, i - r); a <= Math.min(nx - 1, i + r); a++) {
      const k = b * nx + a, z = h[k]; if (!wet[k] || !Number.isFinite(z)) continue;
      const u = a - i, v = b - j; N++; su += u; sv += v; sz += z; suu += u * u; svv += v * v; suv += u * v; suz += u * z; svz += v * z;
    }
    if (N < 5) continue;
    const mu = su / N, mv = sv / N, mz = sz / N, cuu = suu / N - mu * mu, cvv = svv / N - mv * mv, cuv = suv / N - mu * mv, cuz = suz / N - mu * mz, cvz = svz / N - mv * mz;
    // A one-node-wide stream has a rank-one covariance: fit along its line,
    // rather than assuming a horizontal bed when the 2D determinant is zero.
    const det = cuu * cvv - cuv * cuv, trace=cuu+cvv;
    const B = Math.abs(det) > 1e-9 ? (cuz * cvv - cvz * cuv) / det : trace>1e-9?cuz/trace:0;
    const D = Math.abs(det) > 1e-9 ? (cvz * cuu - cuz * cuv) / det : trace>1e-9?cvz/trace:0;
    let worst = 0;
    for (let b = Math.max(0, j - r); b <= Math.min(ny - 1, j + r); b++) for (let a = Math.max(0, i - r); a <= Math.min(nx - 1, i + r); a++) {
      const k = b * nx + a, z = h[k]; if (!wet[k] || !Number.isFinite(z)) continue;
      worst = Math.max(worst, Math.abs(z - (mz + B * (a - i - mu) + D * (b - j - mv))));
    }
    if (worst <= 0.06) level[c] = h[c];
  }
  const keep = new Uint8Array(n);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i; if (!wet[c]) continue;
    let ok = false;
    for (let b = Math.max(0, j - reach); b <= Math.min(ny - 1, j + reach) && !ok; b++) for (let a = Math.max(0, i - reach); a <= Math.min(nx - 1, i + reach); a++) {
      const L = level[b * nx + a]; if (L === L && h[c] <= L + 0.5 && (a - i) ** 2 + (b - j) ** 2 <= reach * reach) { ok = true; break; }
    }
    keep[c] = ok ? 1 : 0;
  }
  wet.set(keep);
}

/** The riverside parks' raised ground (둔치) inside a river's parcels: a flat that is its own lowest
 * point nearby passes the 0.7 m rule as if it were water. The connected water candidates (8-way)
 * are taken as regions: a region with another one 1.5 m lower within 120 m is a terrace — land —
 * unless it is a level surface as the DEM gives open water (half its nodes within 6 cm over ±10 m:
 * the pool above a weir); a park's ground varies more. A stream falling along its bed is one
 * region with nothing lower beside it. Self-contained (also serialised into farGround's worker).
 * `wet` (1/0 over nx × ny nodes `s` m apart, heights `h`) is changed in place. */
export function dryTerraces(h: Float32Array, wet: Uint8Array, nx: number, ny: number, s: number) {
  const n = nx * ny, label = new Int32Array(n).fill(-1), mins: number[] = [], members: number[][] = [];
  const queue = new Int32Array(n);
  for (let c0 = 0; c0 < n; c0++) {
    if (!wet[c0] || label[c0] >= 0) continue;
    const id = mins.length; let head = 0, tail = 0, lo = Infinity; const list: number[] = [];
    queue[tail++] = c0; label[c0] = id;
    while (head < tail) {
      const c = queue[head++], i = c % nx, j = (c - i) / nx; list.push(c); if (h[c] < lo) lo = h[c];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const k = b * nx + a; if (wet[k] && label[k] < 0) { label[k] = id; queue[tail++] = k; }
      }
    }
    mins.push(lo); members.push(list);
  }
  if (mins.length < 2) return;
  const fr = Math.max(1, Math.round(10 / s)), R = Math.round(120 / s), rs: number[] = [];
  for (let r = Math.max(1, Math.round(4 / s)); r <= R; r += Math.max(1, Math.round(8 / s))) rs.push(r);
  for (let id = 0; id < mins.length; id++) {
    const list = members[id], stride = Math.max(1, Math.floor(list.length / 400));
    let lower = false;
    for (let q = 0; q < list.length && !lower; q += stride) {
      const c = list[q], i = c % nx, j = (c - i) / nx;
      for (const r of rs) { for (let k = 0; k < 16 && !lower; k++) {
        const a = i + Math.round(Math.cos(k * Math.PI / 8) * r), b = j + Math.round(Math.sin(k * Math.PI / 8) * r);
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const o = label[b * nx + a]; if (o >= 0 && o !== id && mins[o] <= mins[id] - 1.5) lower = true;
      } if (lower) break; }
    }
    if (!lower) continue;
    let level = 0, seen = 0;
    for (let q = 0; q < list.length; q += stride) {
      const c = list[q], i = c % nx, j = (c - i) / nx; let lo = Infinity, hi = -Infinity;
      for (let b = Math.max(0, j - fr); b <= Math.min(ny - 1, j + fr); b++) for (let a = Math.max(0, i - fr); a <= Math.min(nx - 1, i + fr); a++) { const v = h[b * nx + a]; if (!Number.isFinite(v)) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
      seen++; if (hi - lo <= 0.06) level++;
    }
    if (level * 2 >= seen) continue;
    for (const c of list) wet[c] = 0;
  }
}

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

/** The rings a surface is laid over, cut to ±clip (the field is made from the rings as given — past
 * it, so its edge is no shore): a streamed tile's water meets its neighbour's edge to edge, with
 * no cut of the finished mesh. Sutherland–Hodgman against each side; without `clip`, as given. */
export function surfaceRings(rings: [number, number][][], holes: [number, number][][], sea: boolean[], clip?: number) {
  if (!clip) return { rings, holes, sea };
  const cut = (ring: [number, number][]) => {
    let pts = ring;
    for (const axis of [0, 1] as const) for (const side of [-1, 1]) {
      const bound = side * clip, out: [number, number][] = [];
      const inside = (p: [number, number]) => side * (p[axis] - bound) <= 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length], ia = inside(a), ib = inside(b);
        if (ia) out.push(a);
        if (ia !== ib) { const t = (bound - a[axis]) / ((b[axis] - a[axis]) || 1e-9); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
      }
      pts = out;
      if (pts.length < 3) return pts;
    }
    return pts;
  };
  const outR: [number, number][][] = [], outS: boolean[] = [];
  rings.forEach((r, i) => { const c = cut(r); if (c.length >= 3) { outR.push(c); outS.push(!!sea[i]); } });
  return { rings: outR, holes: holes.map(cut).filter(h => h.length >= 3), sea: outS };
}
