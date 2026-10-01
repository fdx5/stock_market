import * as THREE from "three";

/* The photographs' analysis (never drawn), pure: run in photoWorker off the main thread. */

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
export function around<T>(m: Map<string, T>, key: string, merge: (a: T, b: T) => T): T | undefined {
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
export function rhythmFrom(px: Uint8ClampedArray, S: number, g: THREE.BufferGeometry): Rhythm {
  const out: Rhythm = { planes: new Map(), storey: null, bay: null };
  const pos = g.getAttribute("position"), uv = g.getAttribute("uv"), idx = g.index!;
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
    const pts = samples(tris, 450);
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
export function coloursFrom(px: Uint8ClampedArray, S: number, g: THREE.BufferGeometry): Colours {
  const pos = g.getAttribute("position"), uv = g.getAttribute("uv"), idx = g.index!;
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
      const X = Math.min(S - 1, Math.max(0, Math.floor(u * S))), Y = Math.min(S - 1, Math.max(0, Math.floor(v * S)));
      const o = (Y * S + X) * 4, c = [px[o] / 255, px[o + 1] / 255, px[o + 2] / 255];
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


/** A wall's paint as measured (read, never drawn): the face in cells (~1.2 m across, ~1.5 m
 * up) of the photograph's colour, reduced to its few paints — k-means, clusters under a
 * tenth of the wall folded into the nearest (a painted number, a stain, a tree top), the
 * ground floors (trees, shade) given the paint above them. The view repaints the end walls
 * from it: their real bands and blocks, in clean colour, under the view's own light. */
export interface WallPaint { key: string; u0: number; u1: number; z0: number; z1: number; cols: number; rows: number; rgb: number[] }
export function wallPaintFrom(px: Uint8ClampedArray, S: number, g: THREE.BufferGeometry): WallPaint[] {
  const pos = g.getAttribute("position"), uv = g.getAttribute("uv"), idx = g.index!;
  interface Tri { A: THREE.Vector3; e0: THREE.Vector3; e1: THREE.Vector3; d00: number; d01: number; d11: number; den: number; i: [number, number, number] }
  interface Plane { tris: Tri[]; nx: number; ny: number; off: number; n: number; u0: number; u1: number; z0: number; z1: number }
  const planes = new Map<string, Plane>();
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), T = new THREE.Vector3(), q = new THREE.Vector3();
  for (let t = 0; t < idx.count; t += 3) {
    const i0 = idx.getX(t), i1 = idx.getX(t + 1), i2 = idx.getX(t + 2);
    A.fromBufferAttribute(pos, i0); B.fromBufferAttribute(pos, i1); C.fromBufferAttribute(pos, i2);
    N.subVectors(B, A).cross(T.subVectors(C, A));
    if (N.length() / 2 < 0.5) continue;
    N.normalize();
    if (Math.abs(N.z) > 0.3) continue;
    const h = Math.hypot(N.x, N.y), nx = N.x / h, ny = N.y / h;
    const key = planeKey(nx, ny, (A.x + B.x + C.x) / 3, (A.y + B.y + C.y) / 3);
    const e0 = new THREE.Vector3().subVectors(B, A), e1 = new THREE.Vector3().subVectors(C, A);
    const d00 = e0.dot(e0), d01 = e0.dot(e1), d11 = e1.dot(e1), den = d00 * d11 - d01 * d01;
    if (Math.abs(den) < 1e-9) continue;
    const pl: Plane = planes.get(key) ?? { tris: [], nx, ny, off: 0, n: 0, u0: Infinity, u1: -Infinity, z0: Infinity, z1: -Infinity };
    pl.tris.push({ A: A.clone(), e0, e1, d00, d01, d11, den, i: [i0, i1, i2] });
    for (const v of [A, B, C]) {
      const u = -ny * v.x + nx * v.y;
      pl.u0 = Math.min(pl.u0, u); pl.u1 = Math.max(pl.u1, u); pl.z0 = Math.min(pl.z0, v.z); pl.z1 = Math.max(pl.z1, v.z);
      pl.off += nx * v.x + ny * v.y; pl.n++;
    }
    planes.set(key, pl);
  }
  const out: WallPaint[] = [];
  const P = new THREE.Vector3();
  const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const d2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  for (const [key, pl] of planes) {
    const width = pl.u1 - pl.u0, height = pl.z1 - pl.z0;
    if (width < 5 || width > 30 || height < 8) continue;
    const off = pl.off / pl.n;
    const cols = Math.max(4, Math.round(width / 1.2)), rows = Math.max(4, Math.round(height / 1.5));
    const cell: (number[] | null)[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const acc: number[][] = [];
      for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
        const u = pl.u0 + (c + (sx + 0.5) / 3) * width / cols, z = pl.z0 + (r + (sy + 0.5) / 3) * height / rows;
        P.set(pl.nx * off - pl.ny * u, pl.ny * off + pl.nx * u, z);
        for (const t of pl.tris) {
          q.subVectors(P, t.A);
          const d20 = q.dot(t.e0), d21 = q.dot(t.e1);
          const bb = (t.d11 * d20 - t.d01 * d21) / t.den, cc = (t.d00 * d21 - t.d01 * d20) / t.den, aa = 1 - bb - cc;
          if (aa < -1e-3 || bb < -1e-3 || cc < -1e-3) continue;
          const [i0, i1, i2] = t.i;
          const U = uv.getX(i0) * aa + uv.getX(i1) * bb + uv.getX(i2) * cc, V = uv.getY(i0) * aa + uv.getY(i1) * bb + uv.getY(i2) * cc;
          const X = Math.min(S - 1, Math.max(0, Math.floor(U * S))), Y = Math.min(S - 1, Math.max(0, Math.floor(V * S)));
          const o = (Y * S + X) * 4;
          acc.push([px[o] / 255, px[o + 1] / 255, px[o + 2] / 255]);
          break;
        }
      }
      if (acc.length < 3) { cell.push(null); continue; }
      const ch = (k: number) => { const v = acc.map(a => a[k]).sort((x, y) => x - y); return v[v.length >> 1]; };
      cell.push([ch(0), ch(1), ch(2)]);
    }
    const have = cell.filter((c): c is number[] => !!c);
    if (have.length < cell.length * 0.6) continue;
    // k-means, three paints at most (seeded by brightness)
    const sorted = [...have].sort((a, b) => lum(a) - lum(b));
    let cent = [sorted[Math.floor(sorted.length * 0.15)], sorted[sorted.length >> 1], sorted[Math.floor(sorted.length * 0.85)]].map(c => [...c]);
    const nearest = (c: number[]) => { let bi = 0, bd = Infinity; cent.forEach((m, i) => { const d = d2(c, m); if (d < bd) { bd = d; bi = i; } }); return bi; };
    for (let it = 0; it < 8; it++) {
      const sum = cent.map(() => [0, 0, 0, 0]);
      for (const c of have) { const k = nearest(c); sum[k][0] += c[0]; sum[k][1] += c[1]; sum[k][2] += c[2]; sum[k][3]++; }
      cent = cent.map((m, i) => (sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : m));
    }
    // (a tenth of the wall at least; two paints closer than a shade apart are one — light
    // and shadow on one colour)
    const count = cent.map(() => 0);
    for (const c of have) count[nearest(c)]++;
    const keep = cent.map((_, i) => count[i] >= have.length * 0.1);
    for (let i = 0; i < cent.length; i++) for (let j = 0; j < cent.length; j++)
      if (i !== j && keep[i] && keep[j] && d2(cent[i], cent[j]) < 0.004 && count[j] >= count[i]) keep[i] = false;
    const kept = cent.filter((_, i) => keep[i]);
    if (!kept.length) continue;
    const paintOf = (c: number[]) => { let bi = 0, bd = Infinity; kept.forEach((m, i) => { const d = d2(c, m); if (d < bd) { bd = d; bi = i; } }); return bi; };
    const tally = kept.map(() => 0);
    for (const c of have) tally[paintOf(c)]++;
    const dominant = tally.indexOf(Math.max(...tally));
    const lab = cell.map(c => (c ? paintOf(c) : dominant));
    // (the lowest 6 m: trees and shade in the photograph — the paint of the cell above)
    const firstRow = Math.min(rows - 1, Math.ceil(6 / (height / rows)));
    for (let r = firstRow - 1; r >= 0; r--) for (let c = 0; c < cols; c++) lab[r * cols + c] = lab[(r + 1) * cols + c];
    // (a lone cell unlike its four neighbours, which agree, is noise)
    const clean = [...lab];
    for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c, nb = [lab[i - 1], lab[i + 1], lab[i - cols], lab[i + cols]];
      if (nb.every(v => v !== lab[i]) && nb.every(v => v === nb[0])) clean[i] = nb[0];
    }
    // Paint is laid out in straight bands and blocks; a shadow falls in slants and steps. Each
    // paint's cells are fitted with their rectilinear version (whole rows and columns where
    // it holds most of them).
    const fit = (p: number) => {
      const fr = Array.from({ length: rows }, (_, r) => { let n = 0; for (let c = 0; c < cols; c++) n += +(clean[r * cols + c] === p); return n / cols; });
      const fc = Array.from({ length: cols }, (_, c) => { let n = 0; for (let r = 0; r < rows; r++) n += +(clean[r * cols + c] === p); return n / rows; });
      let inter = 0, union = 0;
      const rect = clean.map((_, i) => { const r = Math.floor(i / cols), c = i % cols; return (fr[r] > 0.6 && fc[c] > 0.25) || (fc[c] > 0.6 && fr[r] > 0.25); });
      clean.forEach((l, i) => { const m = l === p; if (m && rect[i]) inter++; if (m || rect[i]) union++; });
      return { agree: union ? inter / union : 0, rect };
    };
    // Light and shade on one paint: the same hue, one darker (and a little bluer, lit by the
    // sky). Unless their border is ruler-straight they are one paint, as it looks in the sun.
    const colour = kept.map(c => [...c]);
    const chroma = (c: number[]) => { const t = c[0] + c[1] + c[2] || 1; return [c[0] / t, c[1] / t]; };
    const satOf = (c: number[]) => (Math.max(...c) - Math.min(...c)) / Math.max(Math.max(...c), 1e-3);
    const order = kept.map((_, i) => i).sort((i, j) => lum(kept[j]) - lum(kept[i]));   // brightest first
    for (const i of order) for (const j of order) {
      if (lum(kept[j]) <= lum(kept[i])) continue;   // j brighter than i
      const [ri, gi] = chroma(kept[i]), [rj, gj] = chroma(kept[j]), ratio = lum(kept[i]) / Math.max(lum(kept[j]), 1e-3);
      const shade = Math.abs(ri - rj) < 0.05 && Math.abs(gi - gj) < 0.04 && ratio > 0.35 && ratio < 0.92 && satOf(kept[i]) < 0.35 && satOf(kept[j]) < 0.35;
      if (shade && fit(i).agree < 0.9) { colour[i] = colour[j]; break; }
    }
    // The paints drawn in their clean shapes where they fit (else the wall's own paint).
    const same = (a: number[], b: number[]) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
    // A wall in shade takes the sky's blue in the photograph (as the roof band does, see
    // photoColours): a sky-blue paint is not read as paint — the wall keeps its default end-wall
    // paint when its main colour is, and a blue patch is dropped (한양1차 9동: a blue end wall).
    const skyBlue = (c: number[]) => {
      const mx = Math.max(...c), mn = Math.min(...c);
      if (mx - mn < 0.04 || c[2] !== mx) return false;
      const hue = (60 * ((c[0] - c[1]) / (mx - mn)) + 240 + 360) % 360;
      return hue > 190 && hue < 255 && c[2] > c[0] * 1.12;
    };
    if (skyBlue(colour[dominant])) continue;
    for (let p = 0; p < colour.length; p++) if (skyBlue(colour[p])) colour[p] = colour[dominant];
    const base = colour[dominant];
    const final: number[][] = clean.map(() => base);
    for (let p = 0; p < kept.length; p++) {
      if (same(colour[p], base)) continue;
      const f = fit(p);
      if (f.agree >= 0.6) f.rect.forEach((on, i) => { if (on) final[i] = colour[p]; });
    }
    const rgb: number[] = [];
    for (const c of final) rgb.push(...c);
    out.push({ key, u0: pl.u0, u1: pl.u1, z0: pl.z0, z1: pl.z1, cols, rows, rgb });
  }
  return out;
}
