import type * as THREE from "three";
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
  const tilesOut = new Map<string, Float32Array>();
  let ok = true;
  await Promise.all(Array.from({ length: (tx1 - tx0 + 1) * (ty1 - ty0 + 1) }, (_, i) => {
    const x = tx0 + (i % (tx1 - tx0 + 1)), y = ty0 + Math.floor(i / (tx1 - tx0 + 1));
    return vworldTile(token, x, y).then(t => { if (t) tilesOut.set(`${x}/${y}`, t); else ok = false; });
  }));
  if (!ok) return null;
  return (lo: number, la: number) => {
    const fx = (lo + 180) / VW_TILE, fy = (la + 90) / VW_TILE;
    const x = Math.min(tx1, Math.max(tx0, Math.floor(fx))), y = Math.min(ty1, Math.max(ty0, Math.floor(fy)));
    const t = tilesOut.get(`${x}/${y}`)!;
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
        const t = gridTerrain(radius, 4, (x, y) => sampler(center.lon + x / kx, center.lat + y / ky), false, "국토지리정보원 DEM (브이월드)");
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
  return gridTerrain(radius, 8, sample, true, "NASA SRTM (AWS Terrain Tiles)") ?? FLAT;
}

/** Resample absolute elevations onto a CELL-metre grid over ±radius (surface models get
 * the roof filter), relative to the ground at the centre. */
function gridTerrain(radius: number, CELL: number, sample: (x: number, y: number) => number, surface: boolean, source: string): Terrain | null {
  const n = Math.ceil((2 * radius) / CELL) + 1, R = (n - 1) * CELL / 2;
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = sample(-R + i * CELL, -R + j * CELL);
  if (h.some(v => !Number.isFinite(v) || v < -500 || v > 3000)) return null;
  if (surface) {
    const open = Math.round(26 / CELL);
    morph(h, n, open, Math.min);
    morph(h, n, open, Math.max);
    blur(h, n, 3);
  }
  const ci = (n - 1) / 2, h0 = h[Math.round(ci) * n + Math.round(ci)];
  for (let i = 0; i < h.length; i++) h[i] -= h0;
  const at = (x: number, y: number) => {
    const gx = Math.min(n - 1.001, Math.max(0, (x + R) / CELL)), gy = Math.min(n - 1.001, Math.max(0, (y + R) / CELL));
    const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
    return (h[j * n + i] * (1 - fx) + h[j * n + i + 1] * fx) * (1 - fy) + (h[(j + 1) * n + i] * (1 - fx) + h[(j + 1) * n + i + 1] * fx) * fy;
  };
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
