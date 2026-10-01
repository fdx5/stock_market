import { frameSlice } from "./frameSlice";
import * as THREE from "three";
import type { RealEstateRoad } from "../api/client";
import type { Terrain } from "./sceneTerrain";
import { inRing, rng, type Ring } from "./complexScene";

/* Sidewalks on the surveyed roads (국가기본도 도로중심선: centreline, registered width).
 * The carriageway is the registered width; each side gets a raised sidewalk (15 cm
 * granite kerb, block paving) as wide as 도로의 구조·시설 기준에 관한 규칙 gives a road of
 * that width, clipped where it would cross another road's carriageway. Street trees
 * stand in pits along the kerb, one species per road; people walk in two lanes.
 * Footprint frame (x east, y north) maps to world (x, height, -y). */

export const KERB_H = 0.15;

/** Sidewalk width (m) for a road of registered width w. */
export function sidewalkWidth(w: number) {
  return w >= 30 ? 5 : w >= 20 ? 4 : w >= 12 ? 3 : 2.25;
}

/** One continuous stretch of sidewalk: samples along the road centreline (every STEP
 * metres), the left normal there, which side, the road half-width and sidewalk width. */
export interface Run {
  road: number; side: 1 | -1; half: number; width: number;
  cx: Float32Array; cy: Float32Array; nx: Float32Array; ny: Float32Array; cum: Float32Array;
}
const STEP = 2;

/** Point `off` metres out from the centreline at sample i. */
export const runPt = (r: Run, i: number, off: number): [number, number] =>
  [r.cx[i] + r.nx[i] * r.side * off, r.cy[i] + r.ny[i] * r.side * off];

/** Bucketed line segments, for fast "is this inside another road" tests. */
function segmentIndex(roads: RealEstateRoad[]) {
  const cell = 25, map = new Map<string, number[][]>();
  roads.forEach((r, ri) => {
    for (let i = 1; i < r.line.length; i++) {
      const [ax, ay] = r.line[i - 1], [bx, by] = r.line[i], pad = r.width / 2 + 6;
      for (let gx = Math.floor((Math.min(ax, bx) - pad) / cell); gx <= Math.floor((Math.max(ax, bx) + pad) / cell); gx++)
        for (let gy = Math.floor((Math.min(ay, by) - pad) / cell); gy <= Math.floor((Math.max(ay, by) + pad) / cell); gy++) {
          const k = `${gx},${gy}`, l = map.get(k);
          const seg = [ax, ay, bx, by, r.width / 2, ri];
          if (l) l.push(seg); else map.set(k, [seg]);
        }
    }
  });
  /** Whether (x, y) lies on the carriageway of a road other than `self` (plus a margin). */
  return (x: number, y: number, self: number, margin: number) => {
    for (const [ax, ay, bx, by, half, ri] of map.get(`${Math.floor(x / cell)},${Math.floor(y / cell)}`) ?? []) {
      if (ri === self) continue;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      if (Math.hypot(ax + dx * t - x, ay + dy * t - y) < half + margin) return true;
    }
    return false;
  };
}

/** Whether (x, y) is on the carriageway of any surveyed road (its registered width,
 * plus `margin`): where people must not walk. */
export function carriageway(roads: RealEstateRoad[], margin: number) {
  const onRoad = segmentIndex(roads);
  return (x: number, y: number) => onRoad(x, y, -1, margin);
}

/** Bucketed footprint rings, for "inside a building" tests. */
export function ringIndex(rings: Ring[]) {
  const cell = 30, map = new Map<string, Ring[]>();
  for (const r of rings) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) {
      const k = `${gx},${gy}`, l = map.get(k);
      if (l) l.push(r); else map.set(k, [r]);
    }
  }
  return (x: number, y: number) => (map.get(`${Math.floor(x / cell)},${Math.floor(y / cell)}`) ?? []).some(r => inRing([x, y], r));
}

/** Sidewalk runs on both sides of every road, split wherever the sidewalk would cross
 * another carriageway (junctions) or run into a building. */
export function sidewalkRuns(roads: RealEstateRoad[], footprints: Ring[]): Run[] {
  const onRoad = segmentIndex(roads), inBuilding = ringIndex(footprints);
  const runs: Run[] = [];
  roads.forEach((road, ri) => {
    const half = road.width / 2, width = sidewalkWidth(road.width);
    // Resample the centreline every STEP metres with smoothed normals.
    const pts: [number, number, number, number][] = [];
    let carry = 0;
    for (let i = 1; i < road.line.length; i++) {
      const [ax, ay] = road.line[i - 1], [bx, by] = road.line[i], len = Math.hypot(bx - ax, by - ay);
      if (len < 0.01) continue;
      const ux = (bx - ax) / len, uy = (by - ay) / len;
      let d = carry;
      for (; d < len; d += STEP) pts.push([ax + ux * d, ay + uy * d, -uy, ux]);
      carry = d - len;
      if (i === road.line.length - 1 && carry > 0.3) pts.push([bx, by, -uy, ux]);
    }
    for (let i = 1; i < pts.length - 1; i++) {
      const nx = pts[i - 1][2] + pts[i + 1][2], ny = pts[i - 1][3] + pts[i + 1][3], l = Math.hypot(nx, ny) || 1;
      pts[i][2] = nx / l; pts[i][3] = ny / l;
    }
    for (const side of [1, -1] as const) {
      let cur: [number, number, number, number][] = [];
      const flush = () => {
        if (cur.length >= 3) {
          const n = cur.length, run: Run = { road: ri, side, half, width,
            cx: new Float32Array(n), cy: new Float32Array(n), nx: new Float32Array(n), ny: new Float32Array(n), cum: new Float32Array(n) };
          cur.forEach(([x, y, nx, ny], k) => {
            run.cx[k] = x; run.cy[k] = y; run.nx[k] = nx; run.ny[k] = ny;
            if (k) run.cum[k] = run.cum[k - 1] + Math.hypot(x - cur[k - 1][0], y - cur[k - 1][1]);
          });
          runs.push(run);
        }
        cur = [];
      };
      for (const p of pts) {
        const o = (d: number): [number, number] => [p[0] + p[2] * side * d, p[1] + p[3] * side * d];
        const [ix, iy] = o(half + 0.2), [mx, my] = o(half + width / 2), [ox, oy] = o(half + width - 0.1);
        const ok = !onRoad(ix, iy, ri, 0.3) && !onRoad(ox, oy, ri, 0.3) && !inBuilding(mx, my);
        if (ok) cur.push(p); else flush();
      }
      flush();
    }
  });
  return runs;
}

/** Block paving (보도블록): 20 × 10 cm pavers in running bond. Repeats every 2 m. */
function paverTexture() {
  const S = 512, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!, rnd = rng(71);
  g.fillStyle = "#8f8a84"; g.fillRect(0, 0, S, S);
  const bw = S / 10, bh = S / 20; // 20 cm × 10 cm at 2 m per tile
  for (let row = 0; row < 20; row++) for (let col = -1; col < 11; col++) {
    const x = col * bw + (row % 2 ? bw / 2 : 0), y = row * bh;
    const v = 150 + rnd() * 40, warm = rnd() * 10;
    g.fillStyle = `rgb(${v + warm},${v + warm * 0.4},${v - 4})`;
    g.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
    g.fillStyle = `rgba(0,0,0,${rnd() * 0.06})`;
    g.fillRect(x + 1.5 + rnd() * bw * 0.6, y + 2, bw * 0.3, bh - 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Raised sidewalks with a granite kerb along each run, and tree pits. One draw for the
 * paving, one for kerbs and pits. */
export async function buildSidewalks(runs: Run[], terrain: Terrain, pits: [number, number][]) {
  const pos: number[] = [], uv: number[] = [], nor: number[] = [];
  const kPos: number[] = [], kNor: number[] = [], kCol: number[] = [];
  const kerb = new THREE.Color("#b9b6ae"), pit = new THREE.Color("#3a3129"), grate = new THREE.Color("#2b2d2f");
  const push = (arr: number[], ...v: number[]) => { for (const x of v) arr.push(x); };
  // (a few ms at a time: all the runs at once held the page ~45 ms)
  let slice = performance.now();
  for (const r of runs) {
    if (performance.now() - slice > 6) { await frameSlice(); slice = performance.now(); }
    const n = r.cum.length;
    for (let i = 0; i < n - 1; i++) {
      const a0 = runPt(r, i, r.half), a1 = runPt(r, i, r.half + r.width), b0 = runPt(r, i + 1, r.half), b1 = runPt(r, i + 1, r.half + r.width);
      const ya0 = terrain.at(...a0) + KERB_H, ya1 = terrain.at(...a1) + KERB_H, yb0 = terrain.at(...b0) + KERB_H, yb1 = terrain.at(...b1) + KERB_H;
      // Top: two triangles, wound so the face points up whichever side of the road.
      const tri = (p: [number, number, number][], t: [number, number][]) => {
        const [p0, p1, p2] = p;
        const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const order = ny < 0 ? [0, 2, 1] : [0, 1, 2];
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const l = Math.hypot(nx, ny, nz) || 1;
        for (const k of order) { push(pos, ...p[k]); push(uv, ...t[k]); push(nor, nx / l, ny / l, nz / l); }
      };
      const W = (p: [number, number], y: number): [number, number, number] => [p[0], y, -p[1]];
      const ua = r.cum[i] / 2, ub = r.cum[i + 1] / 2, v1 = r.width / 2;
      tri([W(a0, ya0), W(b0, yb0), W(b1, yb1)], [[ua, 0], [ub, 0], [ub, v1]]);
      tri([W(a0, ya0), W(b1, yb1), W(a1, ya1)], [[ua, 0], [ub, v1], [ua, v1]]);
      // Kerb face toward the road, and the low outer edge: vertical quads.
      for (const [p, q, yp, yq, drop, out] of [[a0, b0, ya0, yb0, KERB_H + 0.08, -1], [a1, b1, ya1, yb1, KERB_H + 0.08, 1]] as const) {
        const nx = r.nx[i] * r.side * out, ny = -r.ny[i] * r.side * out;
        const quad: [number, number, number][] = [W(p, yp), W(q, yq), W(q, yq - drop), W(p, yp - drop)];
        for (const k of [0, 3, 2, 0, 2, 1]) { push(kPos, ...quad[k]); push(kNor, nx, 0, ny); push(kCol, kerb.r, kerb.g, kerb.b); }
      }
      // Kerbstone top edge: a 15 cm granite band along the road side.
      const k0 = runPt(r, i, r.half + 0.15), k1 = runPt(r, i + 1, r.half + 0.15);
      const band: [number, number, number][] = [W(a0, ya0 + 0.004), W(b0, yb0 + 0.004), W(k1, yb0 + 0.004), W(k0, ya0 + 0.004)];
      const up = r.side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      for (const k of up) { push(kPos, ...band[k]); push(kNor, 0, 1, 0); push(kCol, kerb.r * 1.05, kerb.g * 1.05, kerb.b * 1.05); }
    }
  }
  // Tree pits: 1.2 m squares, soil with a cast-iron grate frame.
  for (const [x, y] of pits) {
    const h = terrain.at(x, y) + KERB_H + 0.006;
    for (const [s, c] of [[0.62, grate], [0.5, pit]] as const) {
      const q: [number, number, number][] = [[x - s, h, -y - s], [x + s, h, -y - s], [x + s, h, -y + s], [x - s, h, -y + s]];
      for (const k of [0, 3, 2, 0, 2, 1]) { push(kPos, q[k][0], q[k][1] + (c === pit ? 0.002 : 0), q[k][2]); push(kNor, 0, 1, 0); push(kCol, c.r, c.g, c.b); }
    }
  }
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  if (pos.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    const map = paverTexture();
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.88, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
    disposables.push(geo, mat, map);
  }
  if (kPos.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(kPos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(kNor, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(kCol, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
    disposables.push(geo, mat);
  }
  return { group, dispose: () => disposables.forEach(d => d.dispose()) };
}

/** Street trees: 8 m apart in pits 0.8 m in from the kerb (가로수 식재 기준), one species
 * and size per road so each street reads as planted together; clear of lamps and of the
 * ends of a run (junction corners, signal poles). Returns [x, y, road] per tree. */
export function streetTrees(runs: Run[], lamps: { x: number; y: number }[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  const nearLamp = (x: number, y: number) => lamps.some(l => Math.abs(l.x - x) < 4 && Math.abs(l.y - y) < 4 && Math.hypot(l.x - x, l.y - y) < 4);
  for (const r of runs) {
    const len = r.cum[r.cum.length - 1];
    if (len < 16) continue;
    // Same phase on both sides of a road: trees face each other across it.
    const phase = 6 + ((r.road * 3.7) % 4);
    let i = 0;
    for (let d = phase; d < len - 6; d += 8) {
      while (i < r.cum.length - 2 && r.cum[i + 1] < d) i++;
      const t = (d - r.cum[i]) / Math.max(0.01, r.cum[i + 1] - r.cum[i]);
      const off = r.half + 0.8;
      const [ax, ay] = runPt(r, i, off), [bx, by] = runPt(r, i + 1, off);
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      if (nearLamp(x, y)) continue;
      out.push([x, y, r.road]);
    }
  }
  return out.slice(0, 900);
}
