import type * as THREE from "three";
import { frameSlice } from "./frameSlice";
import { gridAt } from "./waterCore";
import { corridorRoadGrade } from "./roadGrade";
/* The ground's real relief around one complex (components/ComplexHologram.tsx).
 *
 * Source, best first: VWorld's national DEM (국토지리정보원, the WebGL 3D map's
 * terrain; bare ground at ≈6–8 m posts; needs the key's WebGL 3D 지도 API service).
 * Otherwise NASA SRTM 1″ elevation (≈30 m posts), served as Terrarium PNG tiles by the
 * AWS Open Data terrain tiles (CORS open, no key). SRTM is a surface model: in a city
 * its radar also returns off roofs, so a block of towers reads as a low hill. A
 * morphological opening (a minimum then a maximum over ~50 m, the usual DSM → DTM
 * filter) takes those bumps off and keeps the land's own slope; a light blur then
 * smooths the 30 m steps. Heights are relative to the ground at the complex centre.
 *
 * Nothing here is invented: where no tile answers the ground stays level. */

export interface Terrain {
  /** Ground height (m) at x east, y north of the complex centre (footprint frame). */
  at(x: number, y: number): number;
  /** Lowest ground height under a footprint ring (where a building meets its ground). */
  base(ring: [number, number][]): number;
  /** Height range inside `radius` of the centre (m), for deciding on planar reflection. */
  relief: number;
  /** Absolute elevation of the centre (m above sea level), null when level fallback. */
  elevation: number | null;
  source: string | null;
  /** The height grid itself (for work done off the page: the 1 km ring's buildings): n × n
   * heights, CELL metres apart, centred, R the half-size. */
  grid?: { h: Float32Array; n: number; R: number; cell: number };
}

export const FLAT: Terrain = { at: () => 0, base: () => 0, relief: 0, elevation: null, source: null };

// ~12 m pixels at 37°N: SRTM itself is 30 m, so finer tiles add nothing but requests.
const Z = 13;
const HOST = "https://s3.amazonaws.com";

/** Open the connection to the tile host early (TLS from Korea costs several round trips). */
export function preconnectTerrain() {
  for (const href of [HOST, "https://map.vworld.kr", "https://xdworld.vworld.kr", "https://xdworld1.vworld.kr", "https://xdworld2.vworld.kr", "https://xdworld3.vworld.kr"]) {
    if (document.head.querySelector(`link[rel="preconnect"][href="${href}"]`)) continue;
    const link = document.createElement("link");
    link.rel = "preconnect"; link.href = href; link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }
}
const URL = (x: number, y: number) => `${HOST}/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;
const tiles = new Map<string, Promise<Float32Array | null>>();

function tile(x: number, y: number): Promise<Float32Array | null> {
  const key = `${x}/${y}`;
  let hit = tiles.get(key);
  if (!hit) {
    hit = fetch(URL(x, y), { mode: "cors" })
      .then(r => { if (!r.ok) throw new Error(`terrain ${r.status}`); return r.blob(); })
      // Terrarium encodes metres in the RGB bytes: no colour management may touch them.
      .then(b => createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" }))
      .then(img => {
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        const g = c.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" })!;
        g.drawImage(img, 0, 0);
        img.close();
        const d = g.getImageData(0, 0, c.width, c.height).data, out = new Float32Array(256 * 256);
        for (let i = 0; i < out.length; i++) out[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
        return out;
      })
      .catch(() => { tiles.delete(key); return null; });
    tiles.set(key, hit);
    if (tiles.size > 256) tiles.delete(tiles.keys().next().value!);
  }
  return hit;
}

/** Start fetching the tiles around a point (the result's centre is known well before
 * its buildings are parsed); loadTerrain then finds them cached. */
export function prefetchTerrain(center: { lat: number; lon: number }, radius: number, vworldKey?: string | null) {
  if (vworldKey) { void vworldSampler(vworldKey, center.lat, center.lon, radius).catch(() => {}); return; }
  const { lat, lon } = center, scale = 256 * 2 ** Z;
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320, ky = 110_540;
  const px = (x: number) => Math.floor((((lon + x / kx + 180) / 360) * scale) / 256);
  const py = (y: number) => {
    const φ = ((lat + y / ky) * Math.PI) / 180;
    return Math.floor((((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2) * scale) / 256);
  };
  for (let x = px(-radius); x <= px(radius); x++) for (let y = py(radius); y <= py(-radius); y++) void tile(x, y);
}

/** Filter a grid in place with a square window: min (erode) or max (dilate), separable. */
function morph(src: Float32Array, n: number, r: number, op: (a: number, b: number) => number) {
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let v = src[y * n + x];
    for (let k = Math.max(0, x - r); k <= Math.min(n - 1, x + r); k++) v = op(v, src[y * n + k]);
    tmp[y * n + x] = v;
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let v = tmp[y * n + x];
    for (let k = Math.max(0, y - r); k <= Math.min(n - 1, y + r); k++) v = op(v, tmp[k * n + x]);
    src[y * n + x] = v;
  }
}

function blur(src: Float32Array, n: number, r: number) {
  const w: number[] = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp(-(k * k) / (2 * (r / 2) ** 2)));
  const tmp = new Float32Array(src.length);
  for (let pass = 0; pass < 2; pass++) {
    const [a, b] = pass ? [tmp, src] : [src, tmp];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let s = 0, ws = 0;
      for (let k = -r; k <= r; k++) {
        const xx = pass ? x : Math.min(n - 1, Math.max(0, x + k)), yy = pass ? Math.min(n - 1, Math.max(0, y + k)) : y;
        s += a[yy * n + xx] * w[k + r]; ws += w[k + r];
      }
      b[y * n + x] = s / ws;
    }
  }
}

/* ---------- VWorld 국가 DEM (WebGL 3D 지도 API) ---------- */

// Level 13 tiles: 0.0044° (≈390 × 490 m) with 65 × 65 heights, ≈6–8 m posts; bare
// ground (DTM), so no roof filter. The API key is exchanged for a session token first
// (the raw key is refused by the tile servers).
const VW_LEVEL = 13, VW_TILE = 36 / 2 ** VW_LEVEL;
const vwTokens = new Map<string, Promise<string>>();
const vwTiles = new Map<string, Promise<Float32Array | null>>();

export function vworldToken(key: string): Promise<string> {
  let hit = vwTokens.get(key);
  if (!hit) {
    hit = fetch(`https://map.vworld.kr/dtkmap/selectApiKeyJson.do?apiKey=${encodeURIComponent(key)}&output=json`, { referrerPolicy: "no-referrer" })
      .then(r => r.json())
      .then(d => { if (typeof d?.apiKey !== "string" || !d.apiKey.startsWith("$$")) throw new Error("VWorld 3D token refused"); return d.apiKey as string; });
    hit.catch(() => vwTokens.delete(key));
    vwTokens.set(key, hit);
  }
  return hit;
}

function vworldTile(token: string, x: number, y: number): Promise<Float32Array | null> {
  const k = `${x}/${y}`;
  let hit = vwTiles.get(k);
  if (!hit) {
    const host = ["xdworld", "xdworld1", "xdworld2", "xdworld3"][(x + y) % 4];
    hit = fetch(`https://${host}.vworld.kr/XDServer/3DData?Version=2.0.0.0&Request=GetLayer&Layer=dem&Level=${VW_LEVEL}&IDX=${x}&IDY=${y}&Key=${encodeURIComponent(token)}`,
      { referrerPolicy: "no-referrer" })
      .then(r => r.arrayBuffer())
      // 65 × 65 little-endian float32 metres, row 0 the tile's north edge, column 0 west.
      .then(b => (b.byteLength === 65 * 65 * 4 ? new Float32Array(b) : null))
      .catch(() => null)
      .then(t => { if (!t) vwTiles.delete(k); return t; });
    vwTiles.set(k, hit);
    // (a few MB at most: 17 KB per tile, a complex needs a handful)
    if (vwTiles.size > 256) vwTiles.delete(vwTiles.keys().next().value!);
  }
  return hit;
}

/** Absolute elevation at (lon, lat) from VWorld DEM tiles, or null if any tile is missing. */
async function vworldSampler(key: string, lat: number, lon: number, radius: number) {
  const token = await vworldToken(key);
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320, ky = 110_540;
  const tx0 = Math.floor((lon - radius / kx + 180) / VW_TILE), tx1 = Math.floor((lon + radius / kx + 180) / VW_TILE);
  const ty0 = Math.floor((lat - radius / ky + 90) / VW_TILE), ty1 = Math.floor((lat + radius / ky + 90) / VW_TILE);
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 64) return null;
  // (tiles by index: a string key a sample was most of a ~0.5 M-sample grid's time)
  const cols = tx1 - tx0 + 1;
  const tilesOut: (Float32Array | null)[] = new Array(cols * (ty1 - ty0 + 1)).fill(null);
  let ok = true;
  await Promise.all(Array.from({ length: (tx1 - tx0 + 1) * (ty1 - ty0 + 1) }, (_, i) => {
    const x = tx0 + (i % cols), y = ty0 + Math.floor(i / cols);
    return vworldTile(token, x, y).then(t => { if (t) tilesOut[i] = t; else ok = false; });
  }));
  if (!ok) return null;
  return (lo: number, la: number) => {
    const fx = (lo + 180) / VW_TILE, fy = (la + 90) / VW_TILE;
    const x = Math.min(tx1, Math.max(tx0, Math.floor(fx))), y = Math.min(ty1, Math.max(ty0, Math.floor(fy)));
    const t = tilesOut[(y - ty0) * cols + (x - tx0)]!;
    const u = Math.min(64, Math.max(0, (fx - x) * 64)), v = Math.min(64, Math.max(0, (1 - (fy - y)) * 64));
    const c = Math.min(63, Math.floor(u)), r = Math.min(63, Math.floor(v)), a = u - c, b = v - r;
    return (t[r * 65 + c] * (1 - a) + t[r * 65 + c + 1] * a) * (1 - b) + (t[(r + 1) * 65 + c] * (1 - a) + t[(r + 1) * 65 + c + 1] * a) * b;
  };
}

/** The ground over ±radius metres around `center`: VWorld's national DEM (bare ground,
 * 국토지리정보원) when a key is given and it answers, else SRTM with roofs filtered out. */
export async function loadTerrain(center: { lat: number; lon: number }, radius: number, vworldKey?: string | null): Promise<Terrain> {
  if (vworldKey) {
    try {
      const sampler = await vworldSampler(vworldKey, center.lat, center.lon, radius);
      if (sampler) {
        const kx = Math.cos((center.lat * Math.PI) / 180) * 111_320, ky = 110_540;
        const t = await gridTerrain(radius, 4, (x, y) => sampler(center.lon + x / kx, center.lat + y / ky), false, "국토지리정보원 DEM (브이월드)");
        if (t) return t;
      }
    } catch { /* fall back to SRTM */ }
  }
  return loadSrtm(center, radius);
}

/** SRTM (surface model) over ±radius metres, roofs taken off. */
async function loadSrtm(center: { lat: number; lon: number }, radius: number): Promise<Terrain> {
  const { lat, lon } = center;
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320, ky = 110_540;
  const scale = 256 * 2 ** Z;
  // Global pixel coordinates (Web Mercator) of a footprint-frame point.
  const px = (x: number) => ((lon + x / kx + 180) / 360) * scale;
  const py = (y: number) => {
    const φ = ((lat + y / ky) * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2) * scale;
  };
  const x0 = Math.floor(px(-radius) / 256), x1 = Math.floor(px(radius) / 256);
  const y0 = Math.floor(py(radius) / 256), y1 = Math.floor(py(-radius) / 256);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 16) return FLAT;
  const grid: (Float32Array | null)[][] = [];
  await Promise.all(Array.from({ length: y1 - y0 + 1 }, (_, j) => Promise.all(Array.from({ length: x1 - x0 + 1 }, (_, i) =>
    tile(x0 + i, y0 + j).then(t => { (grid[j] ??= [])[i] = t; })))));
  if (grid.some(row => row.some(t => !t))) return FLAT;
  const raw = (gx: number, gy: number) => {
    const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
    const t = grid[Math.min(y1, Math.max(y0, ty)) - y0][Math.min(x1, Math.max(x0, tx)) - x0]!;
    const ix = Math.min(255, Math.max(0, Math.floor(gx - tx * 256))), iy = Math.min(255, Math.max(0, Math.floor(gy - ty * 256)));
    return t[iy * 256 + ix];
  };
  const sample = (x: number, y: number) => {
    const gx = px(x) - 0.5, gy = py(y) - 0.5, fx = gx - Math.floor(gx), fy = gy - Math.floor(gy), bx = Math.floor(gx), by = Math.floor(gy);
    return (raw(bx, by) * (1 - fx) + raw(bx + 1, by) * fx) * (1 - fy) + (raw(bx, by + 1) * (1 - fx) + raw(bx + 1, by + 1) * fx) * fy;
  };
  return (await gridTerrain(radius, 8, sample, true, "NASA SRTM (AWS Terrain Tiles)")) ?? FLAT;
}

/** Resample absolute elevations onto a CELL-metre grid over ±radius (surface models get
 * the roof filter), relative to the ground at the centre. */
async function gridTerrain(radius: number, CELL: number, sample: (x: number, y: number) => number, surface: boolean, source: string): Promise<Terrain | null> {
  const n = Math.ceil((2 * radius) / CELL) + 1, R = (n - 1) * CELL / 2;
  const h = new Float32Array(n * n);
  // (in slices of rows: the whole grid at once held the page up to ~70 ms while a complex loaded)
  let at0 = performance.now();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) h[j * n + i] = sample(-R + i * CELL, -R + j * CELL);
    if (performance.now() - at0 > 6) { await frameSlice(); at0 = performance.now(); }
  }
  if (h.some(v => !Number.isFinite(v) || v < -500 || v > 3000)) return null;
  if (surface) {
    const open = Math.round(26 / CELL);
    morph(h, n, open, Math.min);
    await frameSlice();
    morph(h, n, open, Math.max);
    await frameSlice();
    blur(h, n, 3);
  }
  const ci = (n - 1) / 2, h0 = h[Math.round(ci) * n + Math.round(ci)];
  for (let i = 0; i < h.length; i++) h[i] -= h0;
  const at = gridAt({ h, n, R, cell: CELL });
  let lo = Infinity, hi = -Infinity;
  const inner = radius * 0.6;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -R + i * CELL, y = -R + j * CELL;
    if (Math.abs(x) > inner || Math.abs(y) > inner) continue;
    lo = Math.min(lo, h[j * n + i]); hi = Math.max(hi, h[j * n + i]);
  }
  return {
    at,
    base(ring) {
      let m = Infinity;
      for (const [x, y] of ring) m = Math.min(m, at(x, y));
      return Number.isFinite(m) ? m : 0;
    },
    relief: Number.isFinite(hi - lo) ? hi - lo : 0,
    elevation: Math.round(h0 * 10) / 10,
    source,
    grid: { h, n, R, cell: CELL },
  };
}

/** Normals of a ground grid (a PlaneGeometry laid over the terrain, heights in z) straight
 * from its heights: central differences over the real spacing, which the builder keeps in
 * `userData.grid` (world x per column, y per row). The same smooth shading as
 * computeVertexNormals without its pass over every triangle; other geometry falls back to it. */
export function gridNormals(geo: THREE.BufferGeometry) {
  const grid = geo.userData.grid as { xs: Float64Array; ys: Float64Array } | undefined;
  const pos = geo.getAttribute("position") as THREE.BufferAttribute, nor = geo.getAttribute("normal") as THREE.BufferAttribute | undefined;
  if (!grid || !nor || pos.count !== grid.xs.length * grid.ys.length) { geo.computeVertexNormals(); return; }
  const P = pos.array as Float32Array, N = nor.array as Float32Array, { xs, ys } = grid, row = xs.length, last = row - 1;
  for (let j = 0; j < ys.length; j++) {
    const j0 = Math.max(0, j - 1), j1 = Math.min(ys.length - 1, j + 1), dy = ys[j1] - ys[j0];
    for (let i = 0; i < row; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(last, i + 1), dx = xs[i1] - xs[i0];
      const gx = (P[(j * row + i1) * 3 + 2] - P[(j * row + i0) * 3 + 2]) / dx, gy = (P[(j1 * row + i) * 3 + 2] - P[(j0 * row + i) * 3 + 2]) / dy;
      const l = Math.hypot(gx, gy, 1), k = (j * row + i) * 3;
      N[k] = -gx / l; N[k + 1] = -gy / l; N[k + 2] = 1 / l;
    }
  }
  nor.needsUpdate = true;
}

/** The roads graded: a DEM's posts (and the bilinear steps between them) came out on the
 * asphalt as bumps, and a road sampled at both edges leaned across. Under each road (and its
 * sidewalks) the ground is set to the road's own grade — the heights under the roads alone,
 * smoothed over ~16 m (a normalised masked blur: junctions agree, the hills beside a road
 * don't pull it). Continuous slope envelopes remove large DEM steps too; the corridor
 * eases back to the surveyed ground over FADE m. Bridge decks are applied separately.
 * A new Terrain; the given one unchanged. */
export async function gradeRoads(t: Terrain, roads: { line: [number, number][]; width: number }[]): Promise<Terrain> {
  const g = t.grid;
  if (!g || !roads.length) return t;
  const { n, R, cell, h } = g;
  const SIDE = 4, FADE = 8, SIG = 16 / cell, K = Math.ceil(SIG * 3);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, wMax = 0;
  for (const r of roads) {
    wMax = Math.max(wMax, r.width / 2);
    for (const [x, y] of r.line) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  if (!Number.isFinite(x0)) return t;
  const pad = wMax + SIDE + FADE + (K + 1) * cell;
  const ci = (v: number) => Math.min(n - 1, Math.max(0, Math.round((v + R) / cell)));
  const i0 = ci(x0 - pad), i1 = ci(x1 + pad), j0 = ci(y0 - pad), j1 = ci(y1 + pad);
  const W = i1 - i0 + 1, H = j1 - j0 + 1, N = W * H;
  if (W < 2 || H < 2) return t;
  const near = new Float32Array(N).fill(Infinity), mask = new Float32Array(N);
  const anchorX = new Float32Array(N), anchorY = new Float32Array(N);
  let slice = performance.now();
  const pace = async () => { if (performance.now() - slice > 6) { await frameSlice(); slice = performance.now(); } };
  for (const r of roads) {
    const hw = r.width / 2, reach = hw + SIDE + FADE, core = Math.max(hw, cell * 0.75);
    for (let s = 1; s < r.line.length; s++) {
      await pace();
      const [ax, ay] = r.line[s - 1], [bx, by] = r.line[s], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-6;
      const ia = Math.max(i0, ci(Math.min(ax, bx) - reach) - 1), ib = Math.min(i1, ci(Math.max(ax, bx) + reach) + 1);
      const ja = Math.max(j0, ci(Math.min(ay, by) - reach) - 1), jb = Math.min(j1, ci(Math.max(ay, by) + reach) + 1);
      for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
        const x = -R + i * cell, y = -R + j * cell;
        const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)), qx = ax + dx * u, qy = ay + dy * u;
        const d = Math.hypot(x - qx, y - qy);
        if (d > reach) continue;
        const k = (j - j0) * W + (i - i0);
        if (d <= core) mask[k] = 1;
        if (d - hw < near[k]) { near[k] = d - hw; anchorX[k] = qx; anchorY[k] = qy; }
      }
    }
  }
  // the masked blur, separable: Σ(h·m·G) / Σ(m·G)
  const ker = Array.from({ length: 2 * K + 1 }, (_, i) => Math.exp(-((i - K) ** 2) / (2 * SIG * SIG)));
  let num = new Float32Array(N), den = Float32Array.from(mask);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const k = j * W + i; num[k] = mask[k] * h[(j0 + j) * n + i0 + i]; }
  const pass = async (src: Float32Array, horiz: boolean) => {
    const out = new Float32Array(N);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        let s = 0;
        for (let o = -K; o <= K; o++) {
          const a = horiz ? i + o : j + o;
          if (a < 0 || a >= (horiz ? W : H)) continue;
          s += ker[o + K] * src[horiz ? j * W + a : a * W + i];
        }
        out[j * W + i] = s;
      }
      await pace();
    }
    return out;
  };
  num = await pass(await pass(num, true), false);
  den = await pass(await pass(den, true), false);
  const sAt = (x: number, y: number, fallback: number) => {
    const gx = Math.min(W - 1.001, Math.max(0, (x + R) / cell - i0)), gy = Math.min(H - 1.001, Math.max(0, (y + R) / cell - j0));
    const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
    let s = 0, w = 0;
    for (const [k, f] of [[j * W + i, (1 - fx) * (1 - fy)], [j * W + i + 1, fx * (1 - fy)], [(j + 1) * W + i, (1 - fx) * fy], [(j + 1) * W + i + 1, fx * fy]] as const) {
      if (den[k] > 1e-3 && f > 0) { s += (num[k] / den[k]) * f; w += f; }
    }
    return w > 0 ? s / w : fallback;
  };
  // A large DEM discrepancy used to disable grading entirely, preserving the
  // very cliff it needed to remove. Bound the continuous grade in the corridor;
  // terrain outside it remains surveyed and bridges are applied separately.
  const grade = new Float32Array(N);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) grade[j * W + i] = sAt(-R + (i0 + i) * cell, -R + (j0 + j) * cell, h[(j0 + j) * n + i0 + i]);
    await pace();
  }
  const bounded = await corridorRoadGrade(grade, W, H, cell, mask, pace);
  const roadAt = (x: number, y: number, fallback: number) => {
    const gx = Math.min(W - 1.001, Math.max(0, (x + R) / cell - i0)), gy = Math.min(H - 1.001, Math.max(0, (y + R) / cell - j0));
    const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
    let sum = 0, weight = 0;
    for (const [q, w] of [[j * W + i, (1-fx)*(1-fy)], [j * W + i + 1, fx*(1-fy)], [(j+1)*W+i, (1-fx)*fy], [(j+1)*W+i+1, fx*fy]])
      if (mask[q] && w > 0) { sum += bounded[q] * w; weight += w; }
    return weight > 0 ? sum / weight : fallback;
  };
  const out = Float32Array.from(h);
  const ease = (v: number) => { const c = Math.max(0, Math.min(1, v)); return c * c * (3 - 2 * c); };
  for (let k = 0; k < N; k++) {
    const e = near[k];
    if (!Number.isFinite(e)) continue;
    const idx = (j0 + Math.floor(k / W)) * n + i0 + (k % W), was = h[idx];
    const to = roadAt(anchorX[k], anchorY[k], grade[k]), diff = to - was;
    const w = 1 - ease((e - SIDE) / FADE);
    out[idx] = was + diff * w;
  }
  const at = gridAt({ h: out, n, R, cell });
  return {
    ...t,
    at,
    base(ring) {
      let m = Infinity;
      for (const [x, y] of ring) m = Math.min(m, at(x, y));
      return Number.isFinite(m) ? m : 0;
    },
    grid: { h: out, n, R, cell },
  };
}
