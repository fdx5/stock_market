import {ringIndex} from './footprintIndex';
import { frameSlice } from "./frameSlice";
import * as THREE from "three";
import { paintedTexture } from "./paintedTexture";
import { PAVER_STYLES } from "./texPaint";
import type { RealEstateRoad } from "../api/client";
import {roadHeight,sameRoadLevel} from './roadLevels';
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
  sourceRoad?:RealEstateRoad; road: number; side: 1 | -1; half: number; width: number;
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
      if (ri === self || (self>=0&&!sameRoadLevel(roads[self],roads[ri]))) continue;
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

export {ringIndex} from './footprintIndex';

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
          const n = cur.length, run: Run = { sourceRoad:road,road: ri, side, half, width,
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

/** Raised sidewalks with a granite kerb along each run, and tree pits. One draw for the
 * paving, one for kerbs and pits. */
export async function buildSidewalks(runs: Run[], terrain: Terrain, pits: [number, number][]) {
  // The paving in four patterns, by street (both sides of a road alike, as laid): grey running
  // bond most, clay-red herringbone, granite slabs, charcoal basket weave; a yellow tactile guide
  // strip (점자블록) along the wider pavements.
  const styled = PAVER_STYLES.map(() => ({ pos: [] as number[], uv: [] as number[], nor: [] as number[] }));
  const tPos: number[] = [], tUv: number[] = [], tNor: number[] = [];
  const styleOf = (road: number) => { const h = ((road * 2654435761) >>> 0) % 100; return h < 42 ? 0 : h < 66 ? 1 : h < 86 ? 2 : 3; };
  let pos: number[] = styled[0].pos, uv: number[] = styled[0].uv, nor: number[] = styled[0].nor;
  const kPos: number[] = [], kNor: number[] = [], kCol: number[] = [], kIdx: number[] = [];
  // (kerb faces, bands and pits as indexed quads: four vertices each, not six)
  const kQuad = (q: number[][], nx: number, ny: number, nz: number, r: number, g: number, b: number, order: number[]) => {
    const v = kPos.length / 3;
    for (const p of q) { push(kPos, p[0], p[1], p[2]); push(kNor, nx, ny, nz); push(kCol, r, g, b); }
    for (const k of order) kIdx.push(v + k);
  };
  const kerb = new THREE.Color("#b9b6ae"), pit = new THREE.Color("#3a3129"), grate = new THREE.Color("#2b2d2f");
  const granite = new THREE.Color("#e2e0da"), gutterC = new THREE.Color("#9a9b98");
  const push = (arr: number[], ...v: number[]) => { for (const x of v) arr.push(x); };
  // (a few ms at a time: all the runs at once held the page ~45 ms)
  let slice = performance.now();
  for (const r of runs) {
    if (performance.now() - slice > 6) { await frameSlice(); slice = performance.now(); }
    const n = r.cum.length;
    ({ pos, uv, nor } = styled[styleOf(r.road)]);
    // the guide strip: 30 cm, a little past the middle of a pavement 2.6 m or wider
    if (r.width >= 2.6) {
      const o0 = r.half + r.width * 0.55, o1 = o0 + 0.3;
      for (let i = 0; i < n - 1; i++) {
        const p0 = runPt(r, i, o0), p1 = runPt(r, i, o1), q0 = runPt(r, i + 1, o0), q1 = runPt(r, i + 1, o1);
        const y = (q: [number, number]) => (r.sourceRoad?roadHeight(r.sourceRoad,terrain,...q):terrain.at(...q)) + KERB_H + 0.006;
        const V = (q: [number, number]): [number, number, number] => [q[0], y(q), -q[1]];
        const quad = [V(p0), V(q0), V(q1), V(p0), V(q1), V(p1)], u0 = r.cum[i], u1 = r.cum[i + 1];
        const tq = [[u0, 0], [u1, 0], [u1, 1], [u0, 0], [u1, 1], [u0, 1]];
        // (wound to face up)
        const ux = quad[1][0] - quad[0][0], uz = quad[1][2] - quad[0][2], vx = quad[2][0] - quad[0][0], vz = quad[2][2] - quad[0][2];
        const flip = uz * vx - ux * vz < 0;
        const order = flip ? [0, 2, 1, 3, 5, 4] : [0, 1, 2, 3, 4, 5];
        for (const k of order) { tPos.push(...quad[k]); tUv.push(tq[k][0], tq[k][1]); tNor.push(0, 1, 0); }
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a0 = runPt(r, i, r.half), a1 = runPt(r, i, r.half + r.width), b0 = runPt(r, i + 1, r.half), b1 = runPt(r, i + 1, r.half + r.width);
      const ya0 = (r.sourceRoad?roadHeight(r.sourceRoad,terrain,...a0):terrain.at(...a0)) + KERB_H, ya1 = (r.sourceRoad?roadHeight(r.sourceRoad,terrain,...a1):terrain.at(...a1)) + KERB_H, yb0 = (r.sourceRoad?roadHeight(r.sourceRoad,terrain,...b0):terrain.at(...b0)) + KERB_H, yb1 = (r.sourceRoad?roadHeight(r.sourceRoad,terrain,...b1):terrain.at(...b1)) + KERB_H;
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
        kQuad(quad, nx, 0, ny, kerb.r, kerb.g, kerb.b, [0, 3, 2, 0, 2, 1]);
      }
      // Kerbstone top edge: a 22 cm granite band along the road side, light against the paving —
      // and on the road at its foot a 30 cm concrete gutter (측구): the edge between road and
      // pavement a clear double line from any height.
      const k0 = runPt(r, i, r.half + 0.22), k1 = runPt(r, i + 1, r.half + 0.22);
      const band: [number, number, number][] = [W(a0, ya0 + 0.004), W(b0, yb0 + 0.004), W(k1, yb0 + 0.004), W(k0, ya0 + 0.004)];
      const up = r.side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      kQuad(band, 0, 1, 0, granite.r, granite.g, granite.b, up);
      const g0 = runPt(r, i, r.half - 0.3), g1 = runPt(r, i + 1, r.half - 0.3);
      // (just over the road's own surface, 2.5 cm up: buildRoadSurface)
      const gy0 = ya0 - KERB_H + 0.04, gy1 = yb0 - KERB_H + 0.04;
      const gutter: [number, number, number][] = [W(g0, gy0), W(g1, gy1), W(b0, gy1), W(a0, gy0)];
      kQuad(gutter, 0, 1, 0, gutterC.r, gutterC.g, gutterC.b, up);
    }
  }
  // Tree pits: 1.2 m squares, soil with a cast-iron grate frame.
  for (const [x, y] of pits) {
    const h = terrain.at(x, y) + KERB_H + 0.006;
    for (const [s, c] of [[0.62, grate], [0.5, pit]] as const) {
      const lift = c === pit ? 0.002 : 0;
      const q: [number, number, number][] = [[x - s, h + lift, -y - s], [x + s, h + lift, -y - s], [x + s, h + lift, -y + s], [x - s, h + lift, -y + s]];
      kQuad(q, 0, 1, 0, c.r, c.g, c.b, [0, 3, 2, 0, 2, 1]);
    }
  }
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  // (the textures painted in a worker, all four at once: texPaint)
  const used = styled.map(st => st.pos.length > 0);
  const maps = await Promise.all(PAVER_STYLES.map((style, k) => used[k] ? paintedTexture("paver", 1024, style) : Promise.resolve(null)));
  styled.forEach((st, k) => {
    const map = maps[k];
    if (!st.pos.length || !map) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(st.pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(st.nor, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(st.uv, 2));
    // (granite a touch smoother; clay and concrete matt)
    const mat = new THREE.MeshStandardMaterial({ map, roughness: k === 2 ? 0.7 : 0.9, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = `paving ${PAVER_STYLES[k]}`;
    group.add(mesh);
    disposables.push(geo, mat, map);
  });
  if (tPos.length) {
    const map = await paintedTexture("tactile", 512);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(tPos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(tNor, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(tUv, 2));
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = "tactile strip";
    group.add(mesh);
    disposables.push(geo, mat, map);
  }
  if (kPos.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(kPos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(kNor, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(kCol, 3));
    geo.setIndex(kIdx);
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
