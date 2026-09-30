import * as THREE from "three";
import { vworldToken } from "./sceneTerrain";
import { mainRoofOf, planeKey, around, type Rhythm, type Colours, type WallPaint } from "./photoAnalysis";
export { mainRoofOf, planeKey, type Rhythm, type Colours, type WallPaint };

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

async function bytes(u: string, signal?: AbortSignal, retry = 1): Promise<ArrayBuffer> {
  // (VWorld drops a request now and then under load: once more after a moment)
  const r = await fetch(u, { referrerPolicy: "no-referrer", signal }).catch(err => { if (retry > 0 && !signal?.aborted) return null; throw err; });
  if (!r || (!r.ok && r.status >= 500)) {
    if (retry <= 0 || signal?.aborted) throw new Error("VWorld 3D: " + (r?.status ?? "network"));
    await new Promise(res => setTimeout(res, 400));
    return bytes(u, signal, retry - 1);
  }
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
    // (a face with no image has no thumbnail either: nothing more to skip)
    if (name) { const nail = r.u32(); r.o += nail; }
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

/** The photograph read in a worker (a few at a time): fetched here, decoded and
 * analysed there, so the page never stalls on it. One analysis per building. */
const workers: Worker[] = [];
let wid = 0;
const waiting = new Map<number, (r: { rhythm: Rhythm; colours: Colours; paint: WallPaint[] } | null) => void>();
function worker(i: number) {
  if (!workers[i]) {
    const w = new Worker(new URL("./photoWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = e => { const { id, rhythm, colours, paint } = e.data; const f = waiting.get(id); waiting.delete(id); f?.(rhythm ? { rhythm: { ...rhythm, planes: new Map(rhythm.planes) }, colours, paint: paint ?? [] } : null); };
    workers[i] = w;
  }
  return workers[i];
}
const analysed = new WeakMap<PhotoBuilding, Promise<{ rhythm: Rhythm; colours: Colours; paint: WallPaint[] } | null>>();
function photoAnalysis(key: string, ph: PhotoBuilding, signal?: AbortSignal) {
  let p = analysed.get(ph);
  if (!p) {
    p = (async () => {
      if (!ph.src.img) return null;
      const token = await vworldToken(key);
      const img = await bytes(url(token, ph.src.x, ph.src.y, ph.src.img), signal);
      const g = ph.geometry, pos = (g.getAttribute("position").array as Float32Array).slice(), uv = (g.getAttribute("uv").array as Float32Array).slice();
      const index = g.index!.array.slice();
      const id = ++wid;
      return new Promise<{ rhythm: Rhythm; colours: Colours; paint: WallPaint[] } | null>(res => {
        waiting.set(id, res);
        worker(id % 2).postMessage({ id, img, pos, uv, index }, [img, pos.buffer, uv.buffer, index.buffer]);
      });
    })();
    analysed.set(ph, p);
  }
  return p;
}
export async function photoRhythm(key: string, ph: PhotoBuilding, signal?: AbortSignal): Promise<Rhythm> {
  return (await photoAnalysis(key, ph, signal))?.rhythm ?? { planes: new Map(), storey: null, bay: null };
}
/** The measured paint of the building's walls (its end walls are repainted from it). */
export async function photoWallPaint(key: string, ph: PhotoBuilding, signal?: AbortSignal): Promise<WallPaint[]> {
  return (await photoAnalysis(key, ph, signal))?.paint ?? [];
}
export async function photoColours(key: string, ph: PhotoBuilding, signal?: AbortSignal): Promise<Colours | null> {
  return (await photoAnalysis(key, ph, signal))?.colours ?? null;
}

/** The surveyed shape made ready for the view's own materials (no photograph): walls
 * with facade uvs — u along the wall, v = 1 − height, as ExtrudeGeometry's world uvs, so
 * the facade tiles' floors and bays land as on the modelled buildings — and the roofs
 * (faces within ~45° of level) apart. Normals from the triangles themselves. `z0` is the
 * height the model's foot will stand at in the scene. */
export function surveyedShape(ph: PhotoBuilding, z0: number, windows?: Map<string, boolean>, bandDepth = 1.0,
  /** Where an end wall's measured paint sits in the view's atlas: (plane key, u along the
   * wall, height in the model) → texture uv, or null (the wall painted plain). */
  paintUv?: (key: string, u: number, z: number) => [number, number] | null) {
  const g = ph.geometry.index ? ph.geometry.toNonIndexed() : ph.geometry.clone();
  const p = g.getAttribute("position");
  const walls: number[] = [], wallUv: number[] = [], roofs: number[] = [], roofUv: number[] = [], cores: number[] = [], coreUv: number[] = [];
  const mainRoof = mainRoofOf(ph.geometry);
  // The walls by plane (direction to 6°, offset to 0.6 m) and each plane's width: the
  // fronts and backs carry the windows and balconies; the end walls (측벽) and the short
  // returns of the plan are blank, as they are on Korean apartment blocks.
  const extent = new Map<string, [number, number]>(), offsets = new Map<string, [number, number, number, number]>();
  const planeStats = new Map<string, [number, number]>();   // area, top
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
      const st = planeStats.get(key) ?? [0, -Infinity];
      st[0] += w.subVectors(r, q).cross(m.clone().subVectors(s, q)).length() / 2; st[1] = Math.max(st[1], q.z, r.z, s.z);
      planeStats.set(key, st);
    }
  }
  let longest = 0;
  for (const [a0, a1] of extent.values()) longest = Math.max(longest, a1 - a0);
  // The building's long axis (the widest wall's run) and its extent along it: the end walls
  // (측벽) are the faces square to the axis at either extreme. A stepped front's segments run
  // along the axis — fronts, however short, never ends.
  let ax = 1, ay = 0;
  {
    let lw = 0;
    for (const [k, e] of extent) { const o = offsets.get(k)!; if (e[1] - e[0] > lw) { lw = e[1] - e[0]; ax = -o[3]; ay = o[2]; } }
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < p.count; i++) { const u = p.getX(i) * ax + p.getY(i) * ay; lo = Math.min(lo, u); hi = Math.max(hi, u); }
  const trueEnd = (key: string) => {
    const o = offsets.get(key);
    if (!o) return false;
    const dot = o[2] * ax + o[3] * ay;
    if (Math.abs(dot) < 0.9) return false;
    const along = (o[0] / o[1]) * Math.sign(dot);
    return along - lo < 3.5 || hi - along < 3.5;
  };
  const ends: number[] = [], endUv: number[] = [], bands: number[] = [], bandUv: number[] = [], painted: number[] = [], paintedUv: number[] = [];
  const endKeys = new Set<string>(), faceKeys = new Set<string>();
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
    // (the roof level is taken to the metre: a room on it may start a little under that)
    const core = Math.min(a.z, b.z, c.z) > mainRoof - 0.8;
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
    // An end: a true end wall the photograph doesn't show windows on, or a short return (under
    // 6 m) it shows blank. Everything else — every face along the axis above all — has windows.
    const end = !core && seen !== true && ((trueEnd(key) && width < longest * 0.6) || (seen === false && width < 6));
    if (end && width > 6) endKeys.add(key);
    if (!end && !core && width > 8) faceKeys.add(key);
    // (an end wall with its paint measured: repainted from it, in the atlas's uvs)
    const atlas = end && paintUv ? [a, b, c].map(v => paintUv(key, v.x * t.x + v.y * t.y, v.z)) : null;
    if (atlas && atlas.every(Boolean)) {
      [a, b, c].forEach((v, j) => { painted.push(v.x, v.y, v.z + z0); paintedUv.push(...atlas[j]!); });
      continue;
    }
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
  // The end walls worth a number: the building's two true ends only — the widest face on
  // each side along the building's length (its normal within 25° of the long axis), at
  // least 8 m wide, reaching the roof. Split buckets of one face are merged first, so a
  // number is never repeated or left floating on a short return of the plan.
  const endPlanes: { x: number; y: number; nx: number; ny: number; width: number }[] = [];
  {
    // the long axis: the direction of the widest wall
    let lx = 1, ly = 0, lw = 0;
    for (const [k, e] of extent) { const o = offsets.get(k)!; if (e[1] - e[0] > lw) { lw = e[1] - e[0]; lx = -o[3]; ly = o[2]; } }
    const merged = new Map<string, { area: number; top: number; u0: number; u1: number; off: number; nx: number; ny: number }>();
    for (const k of endKeys) {
      const [a0, o0] = k.split(":").map(Number);
      let home = k;
      for (let da = -1; da <= 1; da++) for (let d0 = -1; d0 <= 1; d0++) { const kk = `${a0 + da}:${o0 + d0}`; if (merged.has(kk)) home = kk; }
      const e = extent.get(k)!, o = offsets.get(k)!, st = planeStats.get(k)!;
      const m = merged.get(home) ?? { area: 0, top: -Infinity, u0: Infinity, u1: -Infinity, off: o[0] / o[1], nx: o[2], ny: o[3] };
      m.area += st[0]; m.top = Math.max(m.top, st[1]); m.u0 = Math.min(m.u0, e[0]); m.u1 = Math.max(m.u1, e[1]);
      merged.set(home, m);
    }
    const best = new Map<number, (typeof merged extends Map<string, infer V> ? V : never)>();
    for (const m of merged.values()) {
      const along = m.nx * lx + m.ny * ly;
      if (Math.abs(along) < 0.9 || m.u1 - m.u0 < 8 || (Number.isFinite(mainRoof) && m.top < mainRoof - 1.5)) continue;
      const side = along > 0 ? 1 : -1, cur = best.get(side);
      if (!cur || m.area > cur.area) best.set(side, m);
    }
    for (const m of best.values()) {
      const u = (m.u0 + m.u1) / 2;
      endPlanes.push({ x: m.nx * m.off - m.ny * u, y: m.ny * m.off + m.nx * u, nx: m.nx, ny: m.ny, width: m.u1 - m.u0 });
    }
  }
  // the window faces (for balconies and slab ledges): plane, outward normal, span along
  // the face (u = −ny·x + nx·y, as the facade uvs), each once
  const facePlanes: { off: number; nx: number; ny: number; u0: number; u1: number }[] = [];
  const doneFace = new Set<string>();
  for (const k of faceKeys) {
    const [a0, o0] = k.split(":").map(Number);
    let dup = false;
    for (let da = -1; da <= 1; da++) for (let d0 = -1; d0 <= 1; d0++) if (doneFace.has(`${a0 + da}:${o0 + d0}`)) dup = true;
    if (dup) continue;
    doneFace.add(k);
    const e = extent.get(k)!, o = offsets.get(k)!;
    facePlanes.push({ off: o[0] / o[1], nx: o[2], ny: o[3], u0: e[0], u1: e[1] });
  }
  return { walls: make(walls, wallUv), roofs: make(roofs, roofUv), cores: make(cores, coreUv), ends: make(ends, endUv), bands: make(bands, bandUv), painted: make(painted, paintedUv),
    endPlanes, facePlanes, roofZ: Number.isFinite(mainRoof) ? mainRoof + z0 : null, z0 };
}
