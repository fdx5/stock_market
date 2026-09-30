import * as THREE from "three";
import { vworldToken } from "./sceneTerrain";

/* VWorld's photo-textured 3D buildings (국토교통부 브이월드 3D 건물, XDServer layer
 * facility_build): the real buildings as surveyed, their facades from aerial photographs.
 * Fetched by the browser (VWorld answers Korean networks only, like the DEM tiles),
 * after the first frame; the 3D view swaps them in for the modelled ones they match.
 *
 * Level 15 tiles (36 / 2^15 ° ≈ 97 × 122 m). A tile's list gives each building's model
 * (.xdo 3.0.0.2) and centre; a model is one or more faces of float vertices (position
 * relative to its box centre, normal, uv), u16 indices and a texture (a separate JPEG,
 * fetched by name). World frame: a sphere of radius 6378137 m with
 * (x, y, z) = (R cosφ cosλ, −R cosφ sinλ, R sinφ). */

const LEVEL = 15, SIZE = 36 / 2 ** LEVEL, R = 6378137;
const HOSTS = ["xdworld", "xdworld1", "xdworld2", "xdworld3"];

interface Entry { key: string; lon: number; lat: number; data: string; x: number; y: number }
export interface PhotoBuilding {
  key: string;
  /** Local metres (x east, y north, z up) about the complex centre; ground at z = 0. */
  geometry: THREE.BufferGeometry;
  texture: THREE.Texture | null;
  /** Footprint centre and the outline of its lowest vertices (x, y). */
  cx: number; cy: number; ground: number;
  hull: [number, number][];
  /** Where its photograph is (for colour analysis only — never drawn). */
  src: { x: number; y: number; img: string };
}

class Reader {
  o = 0;
  v: DataView;
  constructor(public b: ArrayBuffer) { this.v = new DataView(b); }
  u8() { return this.v.getUint8(this.o++); }
  u32() { const x = this.v.getUint32(this.o, true); this.o += 4; return x; }
  f32() { const x = this.v.getFloat32(this.o, true); this.o += 4; return x; }
  f64() { const x = this.v.getFloat64(this.o, true); this.o += 8; return x; }
  str() { const n = this.u8(); const s = new TextDecoder("latin1").decode(new Uint8Array(this.b, this.o, n)); this.o += n; return s; }
}

const url = (token: string, x: number, y: number, file?: string) =>
  `https://${HOSTS[(x + y) % 4]}.vworld.kr/XDServer/3DData?Version=2.0.0.0&Request=GetLayer&Layer=facility_build&Level=${LEVEL}&IDX=${x}&IDY=${y}${file ? `&DataFile=${encodeURIComponent(file)}` : ""}&Key=${encodeURIComponent(token)}`;

async function bytes(u: string, signal?: AbortSignal) {
  const r = await fetch(u, { referrerPolicy: "no-referrer", signal });
  const b = await r.arrayBuffer();
  // (an error comes back as XML with status 200)
  if (b.byteLength >= 5 && new Uint8Array(b, 0, 5).every((c, i) => c === "<?xml".charCodeAt(i))) throw new Error("VWorld 3D: " + new TextDecoder().decode(b).slice(0, 120));
  return b;
}

async function tileList(token: string, x: number, y: number, signal?: AbortSignal): Promise<Entry[]> {
  const b = await bytes(url(token, x, y), signal).catch(() => null);
  if (!b || b.byteLength < 16) return [];
  const r = new Reader(b);
  r.u32(); r.u32(); r.u32();
  const n = r.u32(), out: Entry[] = [];
  for (let i = 0; i < n; i++) {
    r.o += 4; r.u8();
    const key = r.str(), lon = r.f64(), lat = r.f64();
    r.f32(); r.o += 48; r.u8();
    const data = r.str(); r.str();
    out.push({ key, lon, lat, data, x, y });
  }
  return out;
}

/** Convex hull (x, y), for matching a model to a registered footprint. */
function hull(pts: [number, number][]) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], hi: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

async function model(token: string, e: Entry, lat0: number, lon0: number, maxTex: number, signal?: AbortSignal, photo = false): Promise<PhotoBuilding | null> {
  const b = await bytes(url(token, e.x, e.y, e.data), signal);
  const r = new Reader(b);
  r.u8(); r.u32(); r.str();
  const box = Array.from({ length: 6 }, () => r.f64());
  r.f32();
  const bc = [(box[0] + box[3]) / 2, (box[1] + box[4]) / 2, (box[2] + box[5]) / 2];
  const faces = r.u8();
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  let img = "";
  const cl = Math.cos((lat0 * Math.PI) / 180), la0 = (lat0 * Math.PI) / 180, lo0 = (lon0 * Math.PI) / 180;
  for (let f = 0; f < faces; f++) {
    const nv = r.u32(), base = pos.length / 3;
    for (let i = 0; i < nv; i++) {
      const vx = r.f32() + bc[0], vy = r.f32() + bc[1], vz = r.f32() + bc[2];
      const nx = r.f32(), ny = r.f32(), nz = r.f32();
      const u = r.f32(), v = r.f32();
      const rr = Math.hypot(vx, vy, vz), lam = Math.atan2(-vy, vx), phi = Math.asin(vz / rr);
      pos.push(R * cl * (lam - lo0), R * (phi - la0), rr - R);
      // (the normal in the same frame: rotate the world vector into east, north, up)
      const sl = Math.sin(lam), cln = Math.cos(lam), sp = Math.sin(phi), cp = Math.cos(phi);
      const wx = nx, wy = -ny, wz = nz;   // back to a right-handed ECEF-like frame
      nor.push(-sl * wx + cln * wy, -sp * cln * wx - sp * sl * wy + cp * wz, cp * cln * wx + cp * sl * wy + sp * wz);
      uv.push(u, v);
    }
    const ni = r.u32();
    // (VWorld's frame is mirrored — y = −R cosφ sinλ — so its triangles wind the other way)
    for (let i = 0; i + 2 < ni; i += 3) {
      const a0 = r.v.getUint16(r.o + i * 2, true), a1 = r.v.getUint16(r.o + i * 2 + 2, true), a2 = r.v.getUint16(r.o + i * 2 + 4, true);
      idx.push(base + a0, base + a2, base + a1);
    }
    r.o += ni * 2;
    r.u32(); r.u8();
    const name = r.str();
    if (name && !img) img = name;
    const nail = r.u32(); r.o += nail;
  }
  if (!idx.length) return null;
  // ground: the model's lowest point; heights from it
  let zmin = Infinity;
  for (let i = 2; i < pos.length; i += 3) zmin = Math.min(zmin, pos[i]);
  const low: [number, number][] = [];
  for (let i = 0; i < pos.length; i += 3) { pos[i + 2] -= zmin; if (pos[i + 2] < 1.5) low.push([pos[i], pos[i + 1]]); }
  const h = hull(low.length >= 3 ? low : pos.reduce<[number, number][]>((a, _, i) => (i % 3 === 0 ? [...a, [pos[i], pos[i + 1]]] : a), []));
  const cx = h.reduce((s, p) => s + p[0], 0) / h.length, cy = h.reduce((s, p) => s + p[1], 0) / h.length;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  let texture: THREE.Texture | null = null;
  if (img && photo) {
    try {
      const blob = new Blob([await bytes(url(token, e.x, e.y, img), signal)], { type: "image/jpeg" });
      let bmp = await createImageBitmap(blob, { imageOrientation: "none" });
      if (bmp.width > maxTex) { const s = maxTex / bmp.width; const small = await createImageBitmap(bmp, { resizeWidth: maxTex, resizeHeight: Math.round(bmp.height * s), resizeQuality: "high" }); bmp.close(); bmp = small; }
      texture = new THREE.Texture(bmp as unknown as HTMLImageElement);
      texture.flipY = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      texture.needsUpdate = true;
    } catch { texture = null; }
  }
  return { key: e.key, geometry: g, texture, cx, cy, ground: zmin, hull: h, src: { x: e.x, y: e.y, img } };
}

/** Every VWorld 3D building whose centre is within `radius` m of the centre. */
export async function photoBuildings(key: string, lat0: number, lon0: number, radius: number, opts: { maxTex?: number; signal?: AbortSignal; onBuilding?: (b: PhotoBuilding) => void; photo?: boolean } = {}): Promise<PhotoBuilding[]> {
  const token = await vworldToken(key);
  const dlat = radius / 110540, dlon = radius / (111320 * Math.cos((lat0 * Math.PI) / 180));
  const x0 = Math.floor((lon0 - dlon + 180) / SIZE), x1 = Math.floor((lon0 + dlon + 180) / SIZE);
  const y0 = Math.floor((lat0 - dlat + 90) / SIZE), y1 = Math.floor((lat0 + dlat + 90) / SIZE);
  const lists: Promise<Entry[]>[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) lists.push(tileList(token, x, y, opts.signal));
  const seen = new Set<string>(), entries: Entry[] = [];
  for (const e of (await Promise.all(lists)).flat()) {
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    const dx = (e.lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180), dy = (e.lat - lat0) * 110540;
    if (Math.hypot(dx, dy) <= radius) entries.push(e);
  }
  // nearest first, a few at a time
  entries.sort((a, b) => Math.hypot(a.lon - lon0, a.lat - lat0) - Math.hypot(b.lon - lon0, b.lat - lat0));
  const out: PhotoBuilding[] = [];
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const e = entries[next++];
      const b = await model(token, e, lat0, lon0, opts.maxTex ?? 2048, opts.signal, opts.photo).catch(() => null);
      if (b) { out.push(b); opts.onBuilding?.(b); }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}

/** The main roof of a model: the level (to 1 m) holding the most roof area; stair cores and
 * lift rooms stand on it. Infinity for a model without one. */
export function mainRoofOf(geo: THREE.BufferGeometry) {
  const p = geo.getAttribute("position"), idx = geo.index;
  const levels = new Map<number, number>();
  const q = new THREE.Vector3(), r = new THREE.Vector3(), s = new THREE.Vector3(), m = new THREE.Vector3(), w = new THREE.Vector3();
  const n = idx ? idx.count : p.count;
  for (let i = 0; i < n; i += 3) {
    const [i0, i1, i2] = idx ? [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)] : [i, i + 1, i + 2];
    q.fromBufferAttribute(p, i0); r.fromBufferAttribute(p, i1); s.fromBufferAttribute(p, i2);
    m.subVectors(r, q).cross(w.subVectors(s, q));
    if (m.length() < 1e-6 || Math.abs(m.z / m.length()) < 0.9) continue;
    const lv = Math.round((q.z + r.z + s.z) / 3);
    levels.set(lv, (levels.get(lv) ?? 0) + m.length() / 2);
  }
  let roof = Infinity, best = 0;
  for (const [lv, ar] of levels) if (lv > 6 && ar > best) { best = ar; roof = lv; }
  return roof;
}

/** A wall plane's key: its direction to 6° and its offset to 0.6 m. */
export const planeKey = (nx: number, ny: number, x: number, y: number) =>
  `${Math.round(Math.atan2(ny, nx) / (Math.PI / 30))}:${Math.round((x * nx + y * ny) / 0.6)}`;
/** Looked up with the neighbouring buckets (a face split across two counts as one). */
function around<T>(m: Map<string, T>, key: string, merge: (a: T, b: T) => T): T | undefined {
  const [a0, o0] = key.split(":").map(Number);
  let out: T | undefined;
  for (let da = -1; da <= 1; da++) for (let d0 = -1; d0 <= 1; d0++) {
    const v = m.get(`${a0 + da}:${o0 + d0}`);
    if (v !== undefined) out = out === undefined ? v : merge(out, v);
  }
  return out;
}

/** What the photograph (never drawn) says about the walls:
 * - planes: which wall planes carry windows. Storeys repeat: on a face with windows the
 *   photograph alternates pane and slab up the wall, so two points half a storey apart
 *   differ far more than two a storey apart; a blank wall, its shade, a tree or a painted
 *   number have no such rhythm.
 * - storey, bay: the storey height and the window pitch along the wall (m), where the
 *   rhythm is clear: the lag at which the photograph best repeats itself. */
export interface Rhythm { planes: Map<string, boolean>; storey: number | null; bay: number | null }
export async function photoRhythm(key: string, ph: PhotoBuilding, signal?: AbortSignal): Promise<Rhythm> {
  const out: Rhythm = { planes: new Map(), storey: null, bay: null };
  if (!ph.src.img) return out;
  const token = await vworldToken(key);
  const blob = new Blob([await bytes(url(token, ph.src.x, ph.src.y, ph.src.img), signal)], { type: "image/jpeg" });
  const S = 512;
  const bmp = await createImageBitmap(blob, { resizeWidth: S, resizeHeight: S, resizeQuality: "medium" });
  const cv = new OffscreenCanvas(S, S), cx = cv.getContext("2d")!;
  cx.drawImage(bmp, 0, 0); bmp.close();
  const px = cx.getImageData(0, 0, S, S).data;
  const g = ph.geometry, pos = g.getAttribute("position"), uv = g.getAttribute("uv"), idx = g.index!;
  const lumAt = (u: number, v: number) => {
    const X = Math.min(S - 1, Math.max(0, Math.floor(u * S))), Y = Math.min(S - 1, Math.max(0, Math.floor(v * S)));
    const o = (Y * S + X) * 4;
    return (0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2]) / 255;
  };
  // wall triangles by plane, each able to give the uv of a point on it
  interface Tri { A: THREE.Vector3; e0: THREE.Vector3; e1: THREE.Vector3; d00: number; d01: number; d11: number; den: number; i: [number, number, number]; area: number }
  const planes = new Map<string, Tri[]>(), dirs = new Map<string, THREE.Vector3>();
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), T = new THREE.Vector3(), q = new THREE.Vector3();
  for (let t = 0; t < idx.count; t += 3) {
    const i0 = idx.getX(t), i1 = idx.getX(t + 1), i2 = idx.getX(t + 2);
    A.fromBufferAttribute(pos, i0); B.fromBufferAttribute(pos, i1); C.fromBufferAttribute(pos, i2);
    N.subVectors(B, A).cross(T.subVectors(C, A));
    const area = N.length() / 2;
    if (area < 1) continue;
    N.normalize();
    if (Math.abs(N.z) > 0.3) continue;
    const h = Math.hypot(N.x, N.y), k = planeKey(N.x / h, N.y / h, (A.x + B.x + C.x) / 3, (A.y + B.y + C.y) / 3);
    const e0 = new THREE.Vector3().subVectors(B, A), e1 = new THREE.Vector3().subVectors(C, A);
    const d00 = e0.dot(e0), d01 = e0.dot(e1), d11 = e1.dot(e1), den = d00 * d11 - d01 * d01;
    if (Math.abs(den) < 1e-9) continue;
    planes.set(k, [...(planes.get(k) ?? []), { A: A.clone(), e0, e1, d00, d01, d11, den, i: [i0, i1, i2], area }]);
    dirs.set(k, new THREE.Vector3(-N.y / h, N.x / h, 0));
  }
  const lumOn = (tris: Tri[], P: THREE.Vector3) => {
    for (const r of tris) {
      q.subVectors(P, r.A);
      const d20 = q.dot(r.e0), d21 = q.dot(r.e1);
      const bb = (r.d11 * d20 - r.d01 * d21) / r.den, cc = (r.d00 * d21 - r.d01 * d20) / r.den, aa = 1 - bb - cc;
      if (aa < -1e-3 || bb < -1e-3 || cc < -1e-3) continue;
      const [i0, i1, i2] = r.i;
      return lumAt(uv.getX(i0) * aa + uv.getX(i1) * bb + uv.getX(i2) * cc, uv.getY(i0) * aa + uv.getY(i1) * bb + uv.getY(i2) * cc);
    }
    return null;
  };
  let seed = 777;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  // sample points on a plane's triangles (above the trees)
  const samples = (tris: Tri[], max: number) => {
    const total = tris.reduce((t, r) => t + r.area, 0), pts: THREE.Vector3[] = [];
    for (const r of tris) {
      const n = Math.min(max, Math.ceil((r.area / total) * max));
      for (let j = 0; j < n; j++) {
        let a = rnd(), b = rnd(); if (a + b > 1) { a = 1 - a; b = 1 - b; }
        const P = r.A.clone().addScaledVector(r.e0, a).addScaledVector(r.e1, b);
        if (P.z >= 7) pts.push(P);
      }
    }
    return pts;
  };
  // mean |L(P) - L(P + lag * dir)| over the samples
  const diff = (tris: Tri[], pts: THREE.Vector3[], dir: THREE.Vector3, lag: number) => {
    let s = 0, n = 0;
    const P2 = new THREE.Vector3();
    for (const P of pts) {
      const l0 = lumOn(tris, P), l1 = lumOn(tris, P2.copy(P).addScaledVector(dir, lag));
      if (l0 === null || l1 === null) continue;
      s += Math.abs(l0 - l1); n++;
    }
    return n > 30 ? s / n : null;
  };
  const up = new THREE.Vector3(0, 0, 1);
  const storeys: number[] = [], bays: number[] = [];
  const seenPlane = new Set<string>();
  for (const k of planes.keys()) {
    const tris: Tri[] = [];
    const [a0, o0] = k.split(":").map(Number);
    for (let da = -1; da <= 1; da++) for (let d0 = -1; d0 <= 1; d0++) tris.push(...(planes.get(`${a0 + da}:${o0 + d0}`) ?? []));
    const pts = samples(tris, 700);
    if (pts.length < 60) continue;
    // (apartments ~2.9 m a storey, shops ~3.4, offices ~3.8: any of them with a rhythm)
    let half: number | null = null, full: number | null = null, windowed = false;
    for (const st of [2.9, 2.75, 3.1, 3.4, 3.8]) {
      const hv = diff(tris, pts, up, st / 2), fv = diff(tris, pts, up, st);
      if (hv === null || fv === null) continue;
      if (half === null) { half = hv; full = fv; }
      if (hv - fv > 0.04 && hv > 0.08) { windowed = true; half = hv; full = fv; break; }
    }
    if (half === null || full === null) continue;
    out.planes.set(k, windowed);
    const dbg = (globalThis as { __winDebug?: Record<string, number[]> }).__winDebug;
    if (dbg) dbg[k] = [+half.toFixed(3), +full.toFixed(3), pts.length];
    // storey and bay from each windowed face once (its own bucket, not the neighbours')
    const own = `${a0}:${o0}`;
    if (!windowed || seenPlane.has(own) || tris.reduce((t, r) => t + r.area, 0) < 150) continue;
    seenPlane.add(own);
    let bestS = 0, bestSV = Infinity;
    for (let lag = 2.6; lag <= 3.4; lag += 0.05) { const d = diff(tris, pts, up, lag); if (d !== null && d < bestSV) { bestSV = d; bestS = lag; } }
    if (bestS) storeys.push(bestS);
    const along = dirs.get(k)!;
    let bestB = 0, bestBV = Infinity;
    const base = diff(tris, pts, along, 0.9) ?? 0;
    for (let lag = 2.2; lag <= 4.6; lag += 0.1) { const d = diff(tris, pts, along, lag); if (d !== null && d < bestBV) { bestBV = d; bestB = lag; } }
    // (only a clear repeat: the best lag well below the mismatch of an off-beat one)
    if (bestB && bestBV < base * 0.8) bays.push(bestB);
  }
  const median = (v: number[]) => { const s = [...v].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
  out.storey = median(storeys);
  out.bay = median(bays);
  return out;
}

/** The building's colours, read from its photograph (which is never drawn): the paint of
 * its walls (their brighter half: not the windows, not the shade), the band just under
 * the roof edge (a parapet stripe), the roof. sRGB, 0..1. Null without a photograph. */
export interface Colours { wall: [number, number, number]; band: [number, number, number]; roof: [number, number, number]; samples: number }
export async function photoColours(key: string, ph: PhotoBuilding, signal?: AbortSignal): Promise<Colours | null> {
  if (!ph.src.img) return null;
  const token = await vworldToken(key);
  const blob = new Blob([await bytes(url(token, ph.src.x, ph.src.y, ph.src.img), signal)], { type: "image/jpeg" });
  const bmp = await createImageBitmap(blob, { resizeWidth: 256, resizeHeight: 256, resizeQuality: "medium" });
  const cv = new OffscreenCanvas(256, 256), cx = cv.getContext("2d")!;
  cx.drawImage(bmp, 0, 0); bmp.close();
  const px = cx.getImageData(0, 0, 256, 256).data;
  const g = ph.geometry, pos = g.getAttribute("position"), uv = g.getAttribute("uv"), idx = g.index!;
  // (the band round the main roof's edge; the stair cores above it are not the band)
  const roofZ = mainRoofOf(g), top = Number.isFinite(roofZ) ? roofZ : Math.max(...Array.from({ length: pos.count }, (_, i) => pos.getZ(i)));
  const walls: number[][] = [], band: number[][] = [], roof: number[][] = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), T = new THREE.Vector3();
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let t = 0; t < idx.count; t += 3) {
    const i0 = idx.getX(t), i1 = idx.getX(t + 1), i2 = idx.getX(t + 2);
    A.fromBufferAttribute(pos, i0); B.fromBufferAttribute(pos, i1); C.fromBufferAttribute(pos, i2);
    N.subVectors(B, A).cross(T.subVectors(C, A));
    const area = N.length() / 2;
    if (area < 0.5) continue;
    N.normalize();
    const n = Math.min(60, Math.ceil(area / 4));
    for (let k = 0; k < n; k++) {
      let a = rnd(), b = rnd(); if (a + b > 1) { a = 1 - a; b = 1 - b; }
      const u = uv.getX(i0) * (1 - a - b) + uv.getX(i1) * a + uv.getX(i2) * b;
      const v = uv.getY(i0) * (1 - a - b) + uv.getY(i1) * a + uv.getY(i2) * b;
      const z = A.z * (1 - a - b) + B.z * a + C.z * b;
      const X = Math.min(255, Math.max(0, Math.floor(u * 256))), Y = Math.min(255, Math.max(0, Math.floor(v * 256)));
      const o = (Y * 256 + X) * 4, c = [px[o] / 255, px[o + 1] / 255, px[o + 2] / 255];
      if (Math.abs(N.z) > 0.7) roof.push(c);
      else if (z > top - 1.3 && z < top + 1.5) band.push(c);
      else if (z > 4) walls.push(c);   // (not the ground floor: trees and shade in the photo)
    }
  }
  const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const median = (list: number[][], upper = 0): [number, number, number] => {
    if (!list.length) return [0.8, 0.8, 0.8];
    const s = [...list].sort((p, q) => lum(p) - lum(q)).slice(Math.floor(list.length * upper));
    const ch = (k: number) => { const v = s.map(c => c[k]).sort((p, q) => p - q); return v[v.length >> 1]; };
    return [ch(0), ch(1), ch(2)];
  };
  // the band: its most colourful fifth (a red or brand stripe among windows and paint)
  const satOf = (c: number[]) => (Math.max(...c) - Math.min(...c)) / Math.max(Math.max(...c), 1e-3);
  const vivid = [...band, ...walls.filter(() => false)].sort((p, q) => satOf(q) - satOf(p)).slice(0, Math.max(1, Math.floor(band.length / 5)));
  return { wall: median(walls, 0.55), band: median(vivid), roof: median(roof, 0.25), samples: walls.length };
}

/** The surveyed shape made ready for the view's own materials (no photograph): walls
 * with facade uvs — u along the wall, v = 1 − height, as ExtrudeGeometry's world uvs, so
 * the facade tiles' floors and bays land as on the modelled buildings — and the roofs
 * (faces within ~45° of level) apart. Normals from the triangles themselves. `z0` is the
 * height the model's foot will stand at in the scene. */
export function surveyedShape(ph: PhotoBuilding, z0: number, windows?: Map<string, boolean>, bandDepth = 1.0) {
  const g = ph.geometry.index ? ph.geometry.toNonIndexed() : ph.geometry.clone();
  const p = g.getAttribute("position");
  const walls: number[] = [], wallUv: number[] = [], roofs: number[] = [], roofUv: number[] = [], cores: number[] = [], coreUv: number[] = [];
  const mainRoof = mainRoofOf(ph.geometry);
  // The walls by plane (direction to 6°, offset to 0.6 m) and each plane's width: the
  // fronts and backs carry the windows and balconies; the end walls (측벽) and the short
  // returns of the plan are blank, as they are on Korean apartment blocks.
  const extent = new Map<string, [number, number]>(), offsets = new Map<string, [number, number, number, number]>();
  {
    const q = new THREE.Vector3(), r = new THREE.Vector3(), s = new THREE.Vector3(), m = new THREE.Vector3(), w = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 3) {
      q.fromBufferAttribute(p, i); r.fromBufferAttribute(p, i + 1); s.fromBufferAttribute(p, i + 2);
      m.subVectors(r, q).cross(w.subVectors(s, q));
      if (m.length() < 1e-6) continue;
      m.normalize();
      if (Math.abs(m.z) > 0.7) continue;
      const h = Math.hypot(m.x, m.y), nx = m.x / h, ny = m.y / h, key = planeKey(nx, ny, (q.x + r.x + s.x) / 3, (q.y + r.y + s.y) / 3);
      const e = extent.get(key) ?? [Infinity, -Infinity];
      for (const v of [q, r, s]) { const u = -ny * v.x + nx * v.y; e[0] = Math.min(e[0], u); e[1] = Math.max(e[1], u); }
      extent.set(key, e);
      const o = offsets.get(key) ?? [0, 0, 0, 0];
      o[0] += (q.x + r.x + s.x) / 3 * nx + (q.y + r.y + s.y) / 3 * ny; o[1]++; o[2] = nx; o[3] = ny;
      offsets.set(key, o);
    }
  }
  let longest = 0;
  for (const [a0, a1] of extent.values()) longest = Math.max(longest, a1 - a0);
  const ends: number[] = [], endUv: number[] = [], bands: number[] = [], bandUv: number[] = [];
  const endKeys = new Set<string>();
  // (a triangle cut by the plane z = zc: the part above to the band, the rest as given)
  const zc = Number.isFinite(mainRoof) ? mainRoof - bandDepth : Infinity;
  const clip = (tri: THREE.Vector3[], keepBelow: boolean) => {
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < 3; i++) {
      const P = tri[i], Q = tri[(i + 1) % 3];
      const pin = keepBelow ? P.z <= zc : P.z >= zc, qin = keepBelow ? Q.z <= zc : Q.z >= zc;
      if (pin) out.push(P);
      if (pin !== qin) out.push(P.clone().lerp(Q, (zc - P.z) / (Q.z - P.z)));
    }
    const tris: THREE.Vector3[][] = [];
    for (let i = 1; i + 1 < out.length; i++) tris.push([out[0], out[i], out[i + 1]]);
    return tris;
  };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3();
  const up = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(b, a).cross(t.subVectors(c, a));
    if (n.lengthSq() < 1e-8) continue;
    n.normalize();
    if (Math.abs(n.z) > 0.7) {
      // (only the faces looking up: the underside of an overhang is dark in any case)
      for (const v of [a, b, c]) { roofs.push(v.x, v.y, v.z + z0); roofUv.push(v.x, v.y); }
      continue;
    }
    t.crossVectors(up, n).normalize();   // along the wall, counter-clockwise seen from above
    const core = Math.min(a.z, b.z, c.z) > mainRoof - 0.3;
    const h = Math.hypot(n.x, n.y), key = planeKey(n.x / h, n.y / h, (a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3);
    // (a face split across two buckets of direction or offset counts at its full width)
    let width = 0;
    {
      const [ang0, off0] = key.split(":").map(Number);
      for (let da = -1; da <= 1; da++) for (let d0 = -1; d0 <= 1; d0++) {
        const e = extent.get(`${ang0 + da}:${off0 + d0}`);
        if (e) width = Math.max(width, e[1] - e[0]);
      }
    }
    // the photograph decides where it covers the plane; else only a true end (short
    // against the building's length) is blank
    const seen = windows?.get(key);
    // The long faces (over half the building's length) carry windows; a shorter face only
    // where the photograph shows them — where it can't tell, the face is painted plain in
    // the building's colour rather than given windows it may not have.
    const end = !core && width < Math.max(4, longest * 0.5) && seen !== true;
    if (end && width > 6) endKeys.add(key);
    const [P, U] = core ? [cores, coreUv] : end ? [ends, endUv] : [walls, wallUv];
    const push = (L: number[], LU: number[], tri: THREE.Vector3[]) => { for (const v of tri) { L.push(v.x, v.y, v.z + z0); LU.push(v.x * t.x + v.y * t.y, 1 - (v.z + z0)); } };
    const tri = [a.clone(), b.clone(), c.clone()];
    if (core || Math.max(a.z, b.z, c.z) <= zc) push(P, U, tri);
    else {
      for (const lo of clip(tri, true)) push(P, U, lo);
      for (const hi of clip(tri, false)) push(bands, bandUv, hi);
    }
  }
  g.dispose();
  const make = (pos: number[], uv: number[]) => {
    if (!pos.length) return null;
    const m = new THREE.BufferGeometry();
    m.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    m.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    m.computeVertexNormals();
    m.computeBoundingSphere();
    return m;
  };
  // the end walls worth a number: their centre (model frame), outward normal, width
  const endPlanes: { x: number; y: number; nx: number; ny: number; width: number }[] = [];
  for (const k of endKeys) {
    const e = extent.get(k)!, o = offsets.get(k)!;
    const off = o[0] / o[1], nx = o[2], ny = o[3], u = (e[0] + e[1]) / 2;
    endPlanes.push({ x: nx * off - ny * u, y: ny * off + nx * u, nx, ny, width: e[1] - e[0] });
  }
  return { walls: make(walls, wallUv), roofs: make(roofs, roofUv), cores: make(cores, coreUv), ends: make(ends, endUv), bands: make(bands, bandUv),
    endPlanes, roofZ: Number.isFinite(mainRoof) ? mainRoof + z0 : null };
}
