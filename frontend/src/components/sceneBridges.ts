import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RealEstateParcel, RealEstateRoad } from "../api/client";
import { inRing } from "./ringMath";
import { sidewalkWidth } from "./sceneSidewalk";
import type { Terrain } from "./sceneTerrain";

/* Bridges where a surveyed road crosses open water (a river parcel — 천, 구, 유, 양 — that is
 * not a covered stream). Without them the river's surface lay over the road and the traffic
 * drove on the water. The deck rises from the banks to ~12 m over the river's level (the DEM's
 * lowest ground in the channel), on a box girder with concrete parapets and pairs of piers about
 * every 50 m; lane markings by the registered lane count. The road's height on a bridge
 * (`bridgeAt`) is what the traffic, kerbs, people and lamps there stand on. */

const WATER = new Set(["천", "구", "유", "양"]);
const STEP = 3;           // metres between deck samples
const CLEAR = 15;         // deck over the river's level (m)
const RAMP = 90;          // rise from a bank to the full height (m, at most a third of the span)
const PIER_EVERY = 50;
const PARAPET = 0.5;

export interface Bridge {
  /** Centreline samples (footprint frame), the left normal, distance along, and the deck height. */
  x: Float32Array; y: Float32Array; nx: Float32Array; ny: Float32Array; s: Float32Array; h: Float32Array;
  /** Half the carriageway, and the half-width out to the parapets' outer faces. */
  half: number; outer: number; lanes: number; level: number;
  box: [number, number, number, number];
}

/** The bridges of `roads` over the open water among `parcels` (covered: per parcel, a covered stream). */
export function findBridges(roads: RealEstateRoad[], parcels: RealEstateParcel[], covered: boolean[], terrain: Terrain): Bridge[] {
  const water = parcels.filter((p, i) => WATER.has(p.kind) && !covered[i] && p.ring.length >= 3).map(p => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of p.ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { ring: p.ring, box: [x0, y0, x1, y1] as const };
  });
  if (!water.length) return [];
  const onParcel = (x: number, y: number) => water.some(w => x >= w.box[0] && x <= w.box[2] && y >= w.box[1] && y <= w.box[3] && inRing([x, y], w.ring));
  // Past the parcels this view has (the road runs on, the river with it, painted by the far
  // ground): river where no parcel says otherwise and the ground lies within 2.5 m of the river's level.
  const all = parcels.filter(p => p.ring.length >= 3).map(p => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of p.ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { ring: p.ring, box: [x0, y0, x1, y1] as const };
  });
  const onAny = (x: number, y: number) => all.some(w => x >= w.box[0] && x <= w.box[2] && y >= w.box[1] && y <= w.box[3] && inRing([x, y], w.ring));
  let river = Infinity;
  for (const w of water) for (let i = 0; i < w.ring.length; i += Math.max(1, Math.floor(w.ring.length / 40))) river = Math.min(river, terrain.at(w.ring[i][0], w.ring[i][1]));
  const waterAt = (x: number, y: number) => onParcel(x, y) || (Number.isFinite(river) && !onAny(x, y) && terrain.at(x, y) <= river + 2.5);
  // (the road over a river has a parcel of its own, registered as road: water on both sides of it
  // is what makes it a bridge)
  const wetAt = (x: number, y: number, nx: number, ny: number) => onParcel(x, y)
    || [1, -1].every(side => [20, 35, 55].some(o => waterAt(x + nx * o * side, y + ny * o * side)));
  const out: Bridge[] = [];
  for (const road of roads) {
    if (road.line.length < 2) continue;
    // Resampled every STEP m.
    const xs: number[] = [], ys: number[] = [];
    let carry = 0;
    for (let i = 1; i < road.line.length; i++) {
      const [ax, ay] = road.line[i - 1], [bx, by] = road.line[i], len = Math.hypot(bx - ax, by - ay);
      if (len < 0.01) continue;
      let d = carry;
      for (; d < len; d += STEP) { xs.push(ax + (bx - ax) * d / len); ys.push(ay + (by - ay) * d / len); }
      carry = d - len;
    }
    const last = road.line[road.line.length - 1];
    xs.push(last[0]); ys.push(last[1]);
    const n = xs.length;
    if (n < 3) continue;
    const w = xs.map((x, i) => {
      const p = Math.max(0, i - 1), q = Math.min(n - 1, i + 1), dx = xs[q] - xs[p], dy = ys[q] - ys[p], l = Math.hypot(dx, dy) || 1;
      return wetAt(x, ys[i], -dy / l, dx / l);
    });
    // Wet runs, gaps under 30 m joined (a pier island, a strip of bank inside the parcel).
    const runs: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      if (!w[i]) continue;
      let j = i; while (j + 1 < n && w[j + 1]) j++;
      const prev = runs[runs.length - 1];
      if (prev && (i - prev[1]) * STEP < 30) prev[1] = j; else runs.push([i, j]);
      i = j;
    }
    for (const [a0, b0] of runs) {
      if ((b0 - a0) * STEP < 40) continue;        // a culvert or a ditch, not a bridge
      // Give each approach enough surveyed road to meet the bank gradually.
      // A fixed four samples (12 m) squeezed a 15 m rise into a cliff-like ramp.
      const approach = Math.ceil(RAMP / STEP);
      const a = Math.max(0, a0 - approach), b = Math.min(n - 1, b0 + approach);
      const m = b - a + 1;
      const bx = new Float32Array(m), by = new Float32Array(m), bnx = new Float32Array(m), bny = new Float32Array(m), bs = new Float32Array(m), bh = new Float32Array(m);
      for (let k = 0; k < m; k++) { bx[k] = xs[a + k]; by[k] = ys[a + k]; if (k) bs[k] = bs[k - 1] + Math.hypot(bx[k] - bx[k - 1], by[k] - by[k - 1]); }
      for (let k = 0; k < m; k++) {
        const p = Math.max(0, k - 1), q = Math.min(m - 1, k + 1), dx = bx[q] - bx[p], dy = by[q] - by[p], l = Math.hypot(dx, dy) || 1;
        bnx[k] = -dy / l; bny[k] = dx / l;
      }
      // The river's level: the lowest ground in the channel, across the road (the DEM carries the
      // road itself over the water as a dam).
      let level = Infinity;
      for (let k = 0; k < m; k += 3) for (const off of [-60, -40, 40, 60]) {
        const x = bx[k] + bnx[k] * off, y = by[k] + bny[k] * off;
        if (onParcel(x, y)) level = Math.min(level, terrain.at(x, y));
      }
      if (!Number.isFinite(level)) level = Number.isFinite(river) ? river : Math.min(...Array.from(bx, (x, k) => terrain.at(x, by[k])));
      // Ends: on the bank (the ground there) — or, where the data stops mid-river, already up.
      const total = bs[m - 1], top = level + CLEAR;
      const startOnLand = a < a0, endOnLand = b > b0;
      const hA = startOnLand ? terrain.at(bx[0], by[0]) : top, hB = endOnLand ? terrain.at(bx[m - 1], by[m - 1]) : top;
      const H = Math.max(top, hA, hB), R = Math.min(RAMP, total / 2);
      const ease = (t: number) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
      for (let k = 0; k < m; k++) {
        const s = bs[k], base = hA + (hB - hA) * (s / (total || 1));
        const up = Math.min(startOnLand ? ease(s / R) : 1, endOnLand ? ease((total - s) / R) : 1);
        bh[k] = base + (H - base) * up;
      }
      const half = road.width / 2, outer = half + sidewalkWidth(road.width) + PARAPET;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 0; k < m; k++) { x0 = Math.min(x0, bx[k]); y0 = Math.min(y0, by[k]); x1 = Math.max(x1, bx[k]); y1 = Math.max(y1, by[k]); }
      out.push({ x: bx, y: by, nx: bnx, ny: bny, s: bs, h: bh, half, outer, lanes: Math.max(1, road.lanes), level, box: [x0 - outer, y0 - outer, x1 + outer, y1 + outer] });
    }
  }
  return out;
}

/** The deck's height under (x, y), or null off every bridge. */
export function bridgeHeight(bridges: Bridge[]) {
  return (x: number, y: number): number | null => {
    let height: number | null = null;
    for (const b of bridges) {
      if (x < b.box[0] || x > b.box[2] || y < b.box[1] || y > b.box[3]) continue;
      let best = Infinity, h = 0;
      for (let k = 1; k < b.x.length; k++) {
        const ax = b.x[k - 1], ay = b.y[k - 1], dx = b.x[k] - ax, dy = b.y[k] - ay, l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
        const d2 = (x - ax - dx * t) ** 2 + (y - ay - dy * t) ** 2;
        if (d2 < best) { best = d2; h = b.h[k - 1] + (b.h[k] - b.h[k - 1]) * t; }
      }
      // Overlapping approaches must not jump when the first bridge's box ends.
      if (best <= b.outer * b.outer) height = height === null ? h : Math.max(height, h);
    }
    return height;
  };
}

/** The road's ground: a bridge's deck where there is one, the terrain elsewhere. */
export function roadGround(terrain: Terrain, bridges: Bridge[]): Terrain {
  if (!bridges.length) return terrain;
  const deck = bridgeHeight(bridges);
  return { ...terrain, at: (x, y) => deck(x, y) ?? terrain.at(x, y) };
}

/** Deck, girder, parapets, piers and markings of every bridge, one mesh a material. */
export function buildBridges(bridges: Bridge[]) {
  const asphalt: THREE.BufferGeometry[] = [], concrete: THREE.BufferGeometry[] = [];
  // A band along the deck between offsets o0..o1 (m from the centreline, left +), from the
  // deck height + z0 to + z1; faces: top, bottom, and the two sides.
  const band = (b: Bridge, o0: number, o1: number, z0: number, z1: number, out: THREE.BufferGeometry[], k0 = 0, k1 = b.x.length - 1, faces = { top: true, bottom: true, sides: true }) => {
    const pos: number[] = [], idx: number[] = [];
    const quad = (p: number[][]) => { const v = pos.length / 3; for (const q of p) pos.push(q[0], q[1], q[2]); idx.push(v, v + 2, v + 1, v, v + 3, v + 2); };   // (wound so each face looks outward: x east, y north -> world x, -z)
    const P = (k: number, o: number, z: number) => [b.x[k] + b.nx[k] * o, b.h[k] + z, -(b.y[k] + b.ny[k] * o)];
    for (let k = k0; k < k1; k++) {
      if (faces.top) quad([P(k, o0, z1), P(k, o1, z1), P(k + 1, o1, z1), P(k + 1, o0, z1)]);
      if (faces.bottom) quad([P(k, o0, z0), P(k + 1, o0, z0), P(k + 1, o1, z0), P(k, o1, z0)]);
      if (faces.sides) {
        quad([P(k, o1, z0), P(k + 1, o1, z0), P(k + 1, o1, z1), P(k, o1, z1)]);
        quad([P(k, o0, z0), P(k, o0, z1), P(k + 1, o0, z1), P(k + 1, o0, z0)]);
      }
    }
    if (!pos.length) return;
    let g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    // (flat faces: each quad's own normal)
    g = g.toNonIndexed(); g.computeVertexNormals();
    out.push(g);
  };
  for (const b of bridges) {
    const n = b.x.length;
    // The carriageway: asphalt slab (its top at the deck height), the walkways each side are
    // the kerbs' (sceneSidewalk, on this deck), the parapets outside them.
    band(b, -b.half - 0.05, b.half + 0.05, -0.35, 0, asphalt);
    band(b, -b.outer + PARAPET, -b.half, -0.35, 0, concrete, 0, n - 1, { top: true, bottom: true, sides: false });
    band(b, b.half, b.outer - PARAPET, -0.35, 0, concrete, 0, n - 1, { top: true, bottom: true, sides: false });
    for (const side of [-1, 1]) {
      const o = side * (b.outer - PARAPET / 2);
      band(b, o - PARAPET / 2, o + PARAPET / 2, -0.35, 1.1, concrete);
    }
    // The girder under the deck (a box narrower than it: the slab overhangs).
    band(b, -b.outer * 0.72, b.outer * 0.72, -2.4, -0.35, concrete);
    // (lane lines: the road markings, laid on the deck through the road's ground)
    // Piers in pairs across the deck, every ~50 m along the span (not on the abutments).
    const total = b.s[n - 1];
    for (let s = PIER_EVERY / 2 + (total % PIER_EVERY) / 2; s < total - 15; s += PIER_EVERY) {
      if (s < 15) continue;
      let k = 0; while (k + 1 < n && b.s[k + 1] < s) k++;
      const t = (s - b.s[k]) / ((b.s[k + 1] ?? b.s[k]) - b.s[k] || 1);
      const cx = b.x[k] + ((b.x[k + 1] ?? b.x[k]) - b.x[k]) * t, cy = b.y[k] + ((b.y[k + 1] ?? b.y[k]) - b.y[k]) * t;
      const top = b.h[k] + ((b.h[k + 1] ?? b.h[k]) - b.h[k]) * t - 2.4, foot = b.level - 3;
      if (top - foot < 3) continue;
      const ang = Math.atan2(b.ny[k], b.nx[k]);
      for (const side of [-1, 1]) {
        const o = side * b.outer * 0.42;
        const col = new THREE.BoxGeometry(2.4, top - foot, 3.2);
        col.rotateY(ang); col.translate(cx + b.nx[k] * o, (top + foot) / 2, -(cy + b.ny[k] * o));
        concrete.push(col.toNonIndexed());
      }
      // The pier cap the girder rests on.
      const cap = new THREE.BoxGeometry(b.outer * 1.5, 1.4, 3.6);
      cap.rotateY(ang); cap.translate(cx, top - 0.7, -cy);
      concrete.push(cap.toNonIndexed());
    }
  }
  const group = new THREE.Group();
  group.name = "bridges";
  const mats: THREE.Material[] = [];
  const add = (list: THREE.BufferGeometry[], mat: THREE.MeshStandardMaterial, shadow: boolean) => {
    if (!list.length) return;
    const g = mergeGeometries(list.map(x => { x.deleteAttribute("uv"); return x; }));
    list.forEach(x => x.dispose());
    if (!g) return;
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    group.add(mesh); mats.push(mat);
  };
  add(asphalt, new THREE.MeshStandardMaterial({ color: "#3b3e43", roughness: 0.92, metalness: 0 }), true);
  add(concrete, new THREE.MeshStandardMaterial({ color: "#a7a39b", roughness: 0.86, metalness: 0 }), true);
  return {
    group,
    dispose: () => { group.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); }); mats.forEach(m => m.dispose()); },
  };
}
