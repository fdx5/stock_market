import { frameSlice } from "./frameSlice";
import { vehicleOverlap, VehicleTrajectoryCache } from "./trafficCollision";
import { onSceneMemoryRelease } from "./sceneMemory";
import * as THREE from "three";
import { paintedTexture } from "./paintedTexture";
import { mergeGeometries, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { RealEstateRoad } from "../api/client";
import type { Lamp } from "./complexScene";
import { rng } from "./complexScene";
import { FLAT, type Terrain } from "./sceneTerrain";
import { KERB_H } from "./sceneSidewalk";
import { carGeometry, carModelMaterial, CAR_SPECS, loadCarModels } from "./sceneCars";
import { DIMS } from "./vehicleShapes";
import { vehicleShapes, heroGeometry, type Shapes } from "./vehicleClient";
import { plateAtlasReady, plateGeometry, plateMaterial, PLATE_COUNT, PLATE_WHITE } from "./scenePlates";
import { bitmapTexture } from "./bitmapTexture";
import { preparedSteel } from "./preparedSteel";
import { coupangTruck, cybertruck, heroSurface, type HeroName, type HeroShape } from "./heroVehicles";

/* The street: lamps on the surveyed major roads, and traffic driving both ways on
 * them. Cars, vans and box trucks are Kenney's CC0 Car Kit (packed by type into
 * /3d/vehicles.bin), scaled to real dimensions; city buses, cargo and container
 * trucks are modelled here in the same plain style; the service vehicles (119 구급차,
 * 경찰차, 소방 펌프차, 압축 청소차, 레미콘) in rounded panels with real proportions.
 * Everything stands on the terrain (sceneTerrain.ts). Footprint frame (x east, y north) maps to world (x, -z). */

// ---------- Lamps ----------

/** The road surface as geometry over the painted ground (its paint is ~0.5 m a texel, and a
 * road's edge against the paving came out in steps): each road a strip at its surveyed width,
 * each junction filled between its arms' ends; asphalt tiled in world space. On the road's
 * ground (decks too). */
export async function buildRoadSurface(roads: RealEstateRoad[], terrain: Terrain = FLAT) {
  const pos: number[] = [], uv: number[] = [];
  const LIFT = 0.025, STEP = 3, TILE = 4;
  const vtx = (x: number, y: number) => { pos.push(x, terrain.at(x, y) + LIFT, -y); uv.push(x / TILE, y / TILE); };
  const ends: { x: number; y: number; hx: number; hy: number; w: number }[] = [];
  let slice = performance.now();
  for (const r of roads) {
    if (performance.now() - slice > 5) { await frameSlice(); slice = performance.now(); }
    if (r.line.length < 2) continue;
    const pts: [number, number][] = [];
    for (let i = 1; i < r.line.length; i++) {
      const [ax, ay] = r.line[i - 1], [bx, by] = r.line[i], len = Math.hypot(bx - ax, by - ay);
      for (let d = 0; d < len; d += STEP) pts.push([ax + (bx - ax) * d / len, ay + (by - ay) * d / len]);
    }
    pts.push(r.line[r.line.length - 1]);
    if (pts.length < 2) continue;
    const h = r.width / 2;
    const nrm = pts.map((_, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      return [-dy / l, dx / l] as [number, number];
    });
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [anx, any] = nrm[i - 1], [bnx, bny] = nrm[i];
      // (wound to face up: world x, up, -y)
      vtx(ax + anx * h, ay + any * h); vtx(ax - anx * h, ay - any * h); vtx(bx - bnx * h, by - bny * h);
      vtx(ax + anx * h, ay + any * h); vtx(bx - bnx * h, by - bny * h); vtx(bx + bnx * h, by + bny * h);
    }
    const n = pts.length;
    const d0x = pts[1][0] - pts[0][0], d0y = pts[1][1] - pts[0][1], l0 = Math.hypot(d0x, d0y) || 1;
    const d1x = pts[n - 1][0] - pts[n - 2][0], d1y = pts[n - 1][1] - pts[n - 2][1], l1 = Math.hypot(d1x, d1y) || 1;
    ends.push({ x: pts[0][0], y: pts[0][1], hx: -d0x / l0, hy: -d0y / l0, w: r.width }, { x: pts[n - 1][0], y: pts[n - 1][1], hx: d1x / l1, hy: d1y / l1, w: r.width });
  }
  // Junctions, as the traffic finds them: nodes where three or more road ends meet (within 6 m),
  // and such nodes within 35 m of each other one intersection (split carriageways, offset ends).
  // Each filled with the hull of its arms' corners (where it reaches past the kerb, the paving
  // stands over it).
  const nodes: { x: number; y: number; ends: number[] }[] = [];
  ends.forEach((e, i) => {
    let n = nodes.findIndex(o => Math.hypot(o.x - e.x, o.y - e.y) < 6);
    if (n < 0) { n = nodes.length; nodes.push({ x: e.x, y: e.y, ends: [] }); }
    nodes[n].ends.push(i);
  });
  const jn = nodes.filter(n => n.ends.length >= 3);
  const parent = jn.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  jn.forEach((a, i) => jn.forEach((b, j) => { if (j > i && Math.hypot(a.x - b.x, a.y - b.y) < 35) parent[find(i)] = find(j); }));
  const groups = new Map<number, number[]>();
  jn.forEach((n, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), ...n.ends]); });
  for (const grp of groups.values()) {
    const corners: [number, number][] = [];
    for (const k of grp) {
      const e = ends[k], rx = e.hy, ry = -e.hx, hw = e.w / 2;
      corners.push([e.x + rx * hw, e.y + ry * hw], [e.x - rx * hw, e.y - ry * hw]);
    }
    const h = hull2(corners);
    if (h.length < 3) continue;
    const cx = h.reduce((s, p) => s + p[0], 0) / h.length, cy = h.reduce((s, p) => s + p[1], 0) / h.length;
    // (a fan, sampled along each hull edge so it follows the ground)
    for (let k = 0; k < h.length; k++) {
      const a = h[k], b = h[(k + 1) % h.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / STEP));
      for (let s = 0; s < n; s++) {
        const p0 = [a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n], p1 = [a[0] + (b[0] - a[0]) * (s + 1) / n, a[1] + (b[1] - a[1]) * (s + 1) / n];
        vtx(cx, cy); vtx(p0[0], p0[1]); vtx(p1[0], p1[1]);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const map = await paintedTexture("asphalt", 1024);
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = "road surface";
  // Driving: the asphalt at 2048 px a 4 m tile (2 mm a texel), painted in the worker meanwhile.
  let hi: THREE.Texture | null = null, want = false, dead = false;
  return {
    group: mesh,
    async setDetail(on: boolean) {
      want = on;
      if (on && !hi) {
        const t = await paintedTexture("asphalt", 2048);
        if (dead || hi) { t.dispose(); return; }
        hi = t;
      }
      if (dead) return;
      const next = want && hi ? hi : map;
      // (a new version: the renderer makes its material again with the other map)
      if (mat.map !== next) { mat.map = next; mat.needsUpdate = true; }
      if (!want && hi) { const h = hi; hi = null; setTimeout(() => h.dispose(), 500); }
    },
    dispose: () => { dead = true; geo.dispose(); mat.dispose(); map.dispose(); hi?.dispose(); },
  };
}

/** Convex hull, anticlockwise (monotone chain). */
function hull2(pts: [number, number][]) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], hi: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

/** Road markings as geometry on the road surface (the ground's paint is ~0.45 m a texel: a
 * 15 cm line in it came out a faint smear): a solid yellow centre line on a two-way road of two
 * or three lanes, a double one from four lanes up, white dashed lines between the lanes each way
 * (3 m painted, 5 m bare). They stop short of the junctions at the road's ends, and follow the
 * ground — and a bridge's deck — through `terrain` (the road's ground). */
export async function buildRoadMarkings(roads: RealEstateRoad[], terrain: Terrain = FLAT,
  /** The traffic's junction arms (buildTraffic().arms.at, for these same roads): their crossing
   * and stop line where the traffic stops. Without it, junctions are found from the ends. */
  armAt?: (road: number, atStart: boolean) => ArmLayout | null,
  /** Roads lying inside one intersection (the stubs between a split junction's pieces): no lines
   * on them at all — a centre line and two zebras had stood in the middle of the crossroads. */
  inside?: (road: number) => boolean) {
  const yellow: number[] = [], white: number[] = [];
  // (a little over the road: the ground mesh is coarser than the height samples, and a line
  // 3.5 cm up sank under it in patches — the centre line looked broken)
  const LIFT = 0.06, STEP = 3;
  // A road end is cut back only at a junction — two or more other roads ending there, or it meets
  // another road's side (a T): elsewhere (a road's pieces joined end to end, a dead end) the lines
  // run on unbroken.
  const ends = roads.flatMap((r, i) => r.line.length > 1 ? [{ i, p: r.line[0] }, { i, p: r.line[r.line.length - 1] }] : []);
  const sideOf = (x: number, y: number, self: number) => {
    let w = 0;
    roads.forEach((o, j) => {
      if (j === self) return;
      for (let k = 1; k < o.line.length; k++) {
        const [ax, ay] = o.line[k - 1], [bx, by] = o.line[k], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
        const t = ((x - ax) * dx + (y - ay) * dy) / l2;
        if (t < 0.05 || t > 0.95) continue;
        if (Math.hypot(x - ax - dx * t, y - ay - dy * t) < o.width / 2 + 1.5) w = Math.max(w, o.width);
      }
    });
    return w;
  };
  const cutAt = (self: number, [x, y]: [number, number]) => {
    let n = 0, w = 0;
    for (const e of ends) if (e.i !== self && Math.hypot(e.p[0] - x, e.p[1] - y) < 4) { n++; w = Math.max(w, roads[e.i].width); }
    const tee = sideOf(x, y, self);
    if (n >= 2 || tee > 0) return Math.max(w, tee) / 2 + 2;
    return 0;
  };
  let slice = performance.now();
  for (const [ri, r] of roads.entries()) {
    if (performance.now() - slice > 5) { await frameSlice(); slice = performance.now(); }
    const lanes = Math.round(r.lanes);
    if (lanes < 2 || r.line.length < 2 || inside?.(ri)) continue;
    // resampled every STEP m, with smoothed left normals
    const pts: [number, number][] = [];
    for (let i = 1; i < r.line.length; i++) {
      const [ax, ay] = r.line[i - 1], [bx, by] = r.line[i], len = Math.hypot(bx - ax, by - ay);
      for (let d = 0; d < len; d += STEP) pts.push([ax + (bx - ax) * d / len, ay + (by - ay) * d / len]);
    }
    pts.push(r.line[r.line.length - 1]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1];
    const arm0 = armAt?.(ri, true) ?? null, arm1 = armAt?.(ri, false) ?? null;
    // (an arm without the traffic's layout: cut back at a junction found from the road ends)
    const cut0 = arm0 ? 0 : Math.min(total / 3, cutAt(ri, r.line[0])), cut1 = arm1 ? 0 : Math.min(total / 3, cutAt(ri, r.line[r.line.length - 1]));
    const CROSS = 3, GAP = 0.6, STOP = 0.35;
    const lay = (arm: ArmLayout | null, cut: number) => arm ?? (cut > 0 ? { crossA: cut, crossB: cut + CROSS, stopA: cut + CROSS + GAP, stopB: cut + CROSS + GAP + STOP, surveyed: false } : null);
    const L0 = lay(arm0, cut0), L1 = lay(arm1, cut1);
    const s0 = L0 ? L0.stopB + 0.4 : 0, s1 = total - (L1 ? L1.stopB + 0.4 : 0);
    if (s1 - s0 < 4) continue;
    const halfW = r.width / 2;
    const nrm = pts.map((_, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      return [-dy / l, dx / l] as [number, number];
    });
    /** A line `w` wide at offset `off` (left +), from sa to sb along the road. */
    const strip = (out: number[], off: number, w: number, sa: number, sb: number) => {
      const at = (sv: number) => {
        let i = 1; while (i < cum.length - 1 && cum[i] < sv) i++;
        const t = (sv - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
        const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
        const nx = nrm[i - 1][0] + (nrm[i][0] - nrm[i - 1][0]) * t, ny = nrm[i - 1][1] + (nrm[i][1] - nrm[i - 1][1]) * t, nl = Math.hypot(nx, ny) || 1;
        return [x + (nx / nl) * off, y + (ny / nl) * off, nx / nl, ny / nl];
      };
      let prev = at(sa);
      for (let sv = Math.min(sb, sa + STEP); ; sv = Math.min(sb, sv + STEP)) {
        const cur = at(sv);
        const q = (p: number[], side: number) => { const x = p[0] + p[2] * side * w / 2, y = p[1] + p[3] * side * w / 2; return [x, terrain.at(x, y) + LIFT, -y]; };
        const a = q(prev, 1), b = q(prev, -1), c = q(cur, -1), d = q(cur, 1);
        // (wound to face up: world x, up, -y)
        out.push(...a, ...b, ...c, ...a, ...c, ...d);
        prev = cur;
        if (sv >= sb) break;
      }
    };
    /** A point at sv along the road, `off` to its left: [x, y]. */
    const ptAt = (sv: number, off: number): [number, number] => {
      let i = 1; while (i < cum.length - 1 && cum[i] < sv) i++;
      const t = (sv - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
      const nx = nrm[i - 1][0] + (nrm[i][0] - nrm[i - 1][0]) * t, ny = nrm[i - 1][1] + (nrm[i][1] - nrm[i - 1][1]) * t, nl = Math.hypot(nx, ny) || 1;
      return [x + (nx / nl) * off, y + (ny / nl) * off];
    };
    /** A painted triangle, wound to face up. */
    const tri = (out: number[], a: [number, number], b: [number, number], c: [number, number]) => {
      const up = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
      const P = (p: [number, number]) => [p[0], terrain.at(p[0], p[1]) + LIFT, -p[1]];
      // (anticlockwise in x, y faces up once y is flipped to −z: three's winding)
      if (up) out.push(...P(a), ...P(b), ...P(c)); else out.push(...P(a), ...P(c), ...P(b));
    };
    // the centre line: one solid yellow line, a double one from four lanes up
    if (lanes >= 4) { strip(yellow, 0.17, 0.15, s0, s1); strip(yellow, -0.17, 0.15, s0, s1); }
    else strip(yellow, 0, 0.15, s0, s1);
    for (const [L, atStart] of [[L0, true], [L1, false]] as const) {
      if (!L || r.width < 5 || L.zebra === false && L.stop === false) continue;
      // the zebra crossing: stripes along the road, the full width across
      const a = atStart ? L.crossA : total - L.crossB, b = atStart ? L.crossB : total - L.crossA;
      if (L.zebra !== false) for (let off = -halfW + 0.8; off <= halfW - 0.8; off += 1.0) strip(white, off, 0.5, a, b);
      // the stop line across the lanes coming in (right-hand traffic: toward the start end on the
      // left half (+), toward the far end on the right (−))
      const st = atStart ? L.stopA : total - L.stopB;
      strip(white, (atStart ? 1 : -1) * halfW / 2, halfW - 0.3, st, st + (L.stopB - L.stopA));
    }
    // Lane arrows (노면 방향표시) before each junction, as painted in Seoul: the inner lane turns
    // left, the outer goes straight on and right, the rest straight; a single lane straight and
    // left. Each 5 m long, its tip 3 m behind the stop line.
    const perSideA = Math.max(1, Math.floor(lanes / 2)), laneWA = r.width / Math.max(2, lanes);
    for (const [L, atStart] of [[L0, true], [L1, false]] as const) {
      if (!L || r.width < 5) continue;
      const tip = atStart ? L.stopB + 3 : total - L.stopB - 3, back = atStart ? 1 : -1;
      if ((atStart ? tip + 6 : total - tip + 6) > total / 2) continue;
      // incoming lanes: the left half of the road (+) toward the start, the right (−) toward the end;
      // the driver's left in road offsets is − going toward the start
      const side = atStart ? 1 : -1, left = atStart ? -1 : 1;
      for (let k = 0; k < perSideA; k++) {
        const laneOff = side * (k + 0.5) * laneWA;
        const kind = perSideA === 1 ? "SL" : k === 0 ? "L" : k === perSideA - 1 && perSideA >= 3 ? "SR" : "S";
        for (const poly of arrowPolys(kind)) {
          const w = poly.map(([u, v]) => ptAt(tip + back * u, laneOff + v * left));
          for (let i = 1; i + 1 < w.length; i++) tri(white, w[0], w[i], w[i + 1]);
        }
      }
    }
    // the edge lines (차도외측선): solid white along both kerbs of a wide road
    if (r.width >= 7) for (const side of [1, -1]) strip(white, side * (r.width / 2 - 0.3), 0.15, s0, s1);
    // lane lines each way: dashed white between the lanes
    const perSide = Math.floor(lanes / 2), laneW = r.width / lanes;
    for (let k = 1; k < perSide; k++) for (const side of [1, -1]) {
      for (let d = s0; d + 3 <= s1; d += 8) strip(white, side * k * laneW, 0.12, d, d + 3);
    }
  }
  const group = new THREE.Group();
  group.name = "road markings";
  const mats: THREE.Material[] = [];
  for (const [pos, color] of [[yellow, "#f0b40a"], [white, "#f2f2ee"]] as const) {
    if (!pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    group.add(mesh); mats.push(m);
  }
  return { group, dispose: () => { group.children.forEach(c => (c as THREE.Mesh).geometry.dispose()); mats.forEach(m => m.dispose()); } };
}

/** A lane arrow as convex polygons in (u: metres back from the tip, v: metres to the driver's
 * left): S straight on, L left, SL straight and left, SR straight and right. 5 m long. */
function arrowPolys(kind: "S" | "L" | "SL" | "SR"): [number, number][][] {
  const out: [number, number][][] = [];
  const shaft = (u0: number, u1: number, v = 0, w = 0.15): [number, number][] => [[u0, v - w], [u1, v - w], [u1, v + w], [u0, v + w]];
  const headUp = (): [number, number][] => [[0, 0], [1.5, -0.55], [1.5, 0.55]];
  // a branch off the shaft at u to one side (s: +1 left, −1 right): a bar out, then its head
  const branch = (u: number, s: number) => {
    out.push([[u - 0.15, 0], [u + 0.15, 0], [u + 0.15, s * 0.75], [u - 0.15, s * 0.75]].map(([a, b]) => [a, b]) as [number, number][]);
    // (a little sweep into the bar: a wedge from the shaft)
    out.push([[u + 0.15, 0], [u + 0.95, 0], [u + 0.15, s * 0.6]] as [number, number][]);
    out.push([[u - 0.55, s * 0.75], [u + 0.55, s * 0.75], [u, s * 1.5]] as [number, number][]);
  };
  if (kind === "L") { out.push(shaft(2.0, 5)); branch(2.0, 1); out.push([[1.85, -0.15], [2.15, -0.15], [2.15, 0.15], [1.85, 0.15]]); }
  else {
    out.push(headUp(), shaft(1.5, 5));
    if (kind === "SL") branch(3.0, 1);
    if (kind === "SR") branch(3.0, -1);
  }
  return out;
}

/** Made in slices (a few dozen lamps each): at once, with the ground, it held a frame ~50 ms. */
export async function buildLamps(lamps: Lamp[], terrain: Terrain = FLAT) {
  const posts: THREE.BufferGeometry[] = [], heads: THREE.BufferGeometry[] = [], halos: THREE.BufferGeometry[] = [];
  const pole = new THREE.CylinderGeometry(0.08, 0.13, 9, 6).toNonIndexed(); pole.translate(0, 4.5, 0);
  const arm = new THREE.BoxGeometry(0.1, 0.1, 1.9).toNonIndexed(); arm.translate(0, 8.9, 0.9);
  const head = new THREE.BoxGeometry(0.34, 0.14, 0.7).toNonIndexed(); head.translate(0, 8.82, 1.85);
  const halo = new THREE.SphereGeometry(0.9, 10, 6).toNonIndexed(); halo.translate(0, 8.55, 1.85);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  let at0 = performance.now();
  for (const l of lamps) {
    if (performance.now() - at0 > 5) { await frameSlice(); at0 = performance.now(); }
    // Arm (+z of the model) reaches over the road: world direction (dx, 0, -dy).
    q.setFromAxisAngle(up, Math.atan2(l.dx, -l.dy));
    // Lamps stand on the sidewalk (kerb height above the ground).
    m.compose(new THREE.Vector3(l.x, terrain.at(l.x, l.y) + KERB_H, -l.y), q, one);
    posts.push(pole.clone().applyMatrix4(m), arm.clone().applyMatrix4(m));
    heads.push(head.clone().applyMatrix4(m));
    halos.push(halo.clone().applyMatrix4(m));
  }
  [pole, arm, head, halo].forEach(g => g.dispose());
  const group = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: "#5b6168", roughness: 0.5, metalness: 0.6 });
  const headMat = new THREE.MeshStandardMaterial({ color: "#e9e4da", emissive: "#ffd29a", emissiveIntensity: 0, roughness: 0.35 });
  // A soft glow around each head, shown only while the lamps are on.
  const haloMat = new THREE.MeshStandardMaterial({ color: "#000000", emissive: "#ffcf93", emissiveIntensity: 0, transparent: true, opacity: 0.28, depthWrite: false, roughness: 1 });
  const disposables: { dispose(): void }[] = [postMat, headMat, haloMat];
  let haloMesh: THREE.Mesh | null = null;
  if (lamps.length) {
    for (const [list, mat, shadow] of [[posts, postMat, true], [heads, headMat, false], [halos, haloMat, false]] as const) {
      await frameSlice();
      const geo = mergeGeometries(list as THREE.BufferGeometry[], false)!;
      (list as THREE.BufferGeometry[]).forEach(g => g.dispose());
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = shadow;
      mesh.receiveShadow = !!shadow;
      if (mat === haloMat) { mesh.renderOrder = 2; mesh.visible = false; haloMesh = mesh; }
      group.add(mesh);
      disposables.push(geo);
    }
  }
  return {
    group,
    /** 0 by day, ~1.6 at night (Look.lamps). */
    setLevel(level: number) {
      headMat.emissiveIntensity = level * 9;
      haloMat.emissiveIntensity = level * 2.2;
      if (haloMesh) haloMesh.visible = level > 0.25;
    },
    dispose: () => disposables.forEach(d => d.dispose()),
  };
}

// ---------- Traffic ----------

let kit: Promise<{ geos: Map<string, THREE.BufferGeometry>; procedural: Map<string, THREE.BufferGeometry>; heroes: Shapes['heroes']; texture: THREE.Texture; steel: THREE.Texture | null }> | null = null;
onSceneMemoryRelease(() => {
  const old = kit; kit = null;
  void old?.then(k => { k.texture.dispose(); k.steel?.dispose(); }).catch(() => {});
});

function loadKit() {
  if (kit) return kit;
  // Never put this optional prepared map on the vehicle loading critical path.
  // If it arrives late, retain the original painter and release the unused bitmap.
  let steel: THREE.Texture | null = null, acceptingSteel = true;
  void preparedSteel().then(t => { if (acceptingSteel) steel = t; else t?.dispose(); });
  kit = Promise.all([
    vehicleShapes(),
    bitmapTexture("/3d/vehicles.png", false),
  ]).then(([shapes, texture]) => {
    acceptingSteel = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter; // flat colour swatches
    // (glTF uv convention: not flipped)
    return { geos: shapes.kit, procedural: shapes.procedural, heroes: shapes.heroes, texture, steel };
  }, error => { acceptingSteel = false; steel?.dispose(); throw error; });
  const current = kit;
  current.catch(() => { if (kit === current) kit = null; });
  return current;
}

/** Head and tail lamps for a vehicle of length L, width W at height y: two warm white
 * lamps at the front (+z), two red at the back. uv.x picks white (0) or red (1) from
 * the emissive map, so one material and one draw per vehicle type. */
function lampGeometry(L: number, W: number, y: number) {
  const list: THREE.BufferGeometry[] = [];
  for (const [z, u] of [[L / 2 + 0.03, 0.02], [-L / 2 - 0.03, 0.98]] as const) for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(0.34, 0.16, 0.06).toNonIndexed();
    g.translate(s * (W / 2 - 0.32), y, z);
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u, 0.5);
    list.push(g);
  }
  const out = mergeGeometries(list, false)!;
  list.forEach(g => g.dispose());
  return out;
}
/** A modelled vehicle's own lamps (heroVehicles: HeroShape.lamps), in the same one-draw form. */
function lampGeometryOf(parts: { x: number; y: number; z: number; w: number; h: number; red: boolean }[]) {
  const list = parts.map(p => {
    const g = new THREE.BoxGeometry(p.w, p.h, 0.03).toNonIndexed();
    g.translate(p.x, p.y, p.z);
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.red ? 0.98 : 0.02, 0.5);
    return g;
  });
  const out = mergeGeometries(list, false)!;
  list.forEach(g => g.dispose());
  return out;
}
let lampTexture: THREE.DataTexture | null = null;
function lampMap() {
  if (lampTexture) return lampTexture;
  // 64 x 1: warm white on the left half, tail-light red on the right (mips stay pure).
  const data = new Uint8Array(64 * 4);
  for (let i = 0; i < 64; i++) data.set(i < 32 ? [255, 236, 200, 255] : [255, 28, 22, 255], i * 4);
  lampTexture = new THREE.DataTexture(data, 64, 1);
  lampTexture.colorSpace = THREE.SRGBColorSpace;
  lampTexture.needsUpdate = true;
  return lampTexture;
}

interface Link { road: number; forward: boolean; s0: number }
type Turn = "straight" | "left" | "right" | "uturn";
/** The drive from the end of one road onto the next: a cubic curve from the stop
 * line in this lane to the entry of the chosen lane, sampled by arc length. */
interface Conn {
  key: string; fromKey: string; toKey: string; link: Link; turn: Turn; lane: number;
  /** the intersection it crosses (-1 none), and whether it gives way there (a side street into an unsignalled one) */
  cluster: number; giveWay: boolean;
  /** Where it leaves this road and joins the next (travel coordinates), its length. */
  endS: number; startS: number; len: number;
  /** Signalled node, its approach key; T-junction mouth (yield to the through road). */
  node: number; approach: string; tJoin: boolean;
  xs: Float32Array; ys: Float32Array; cum: Float32Array;
}
/** The surveyed centrelines come cut at every junction and width change, often into
 * pieces of a few metres. Where exactly two pieces meet end to end with the same lane
 * count and about the same width, they are one road: join them, repeatedly. */
function stitchRoads(input: RealEstateRoad[]): RealEstateRoad[] {
  let roads = input.map(r => ({ ...r, line: r.line.map(p => [p[0], p[1]] as [number, number]) }));
  const key = ([x, y]: [number, number]) => `${Math.round(x / 1.5)},${Math.round(y / 1.5)}`;
  for (let pass = 0; pass < 50; pass++) {
    const at = new Map<string, { i: number; start: boolean }[]>();
    roads.forEach((r, i) => {
      for (const start of [true, false]) {
        const k = key(start ? r.line[0] : r.line[r.line.length - 1]);
        const l = at.get(k); if (l) l.push({ i, start }); else at.set(k, [{ i, start }]);
      }
    });
    const used = new Set<number>(), next: typeof roads = [];
    for (const ends of at.values()) {
      if (ends.length !== 2) continue;
      const [a, b] = ends;
      if (a.i === b.i || used.has(a.i) || used.has(b.i)) continue;
      const ra = roads[a.i], rb = roads[b.i];
      if (ra.lanes !== rb.lanes || Math.abs(ra.width - rb.width) > 4) continue;
      // Orient a to end at the joint and b to start there.
      const la = a.start ? [...ra.line].reverse() : ra.line, lb = b.start ? rb.line : [...rb.line].reverse();
      next.push({ line: [...la, ...lb.slice(1)], width: Math.max(ra.width, rb.width), lanes: ra.lanes });
      used.add(a.i); used.add(b.i);
    }
    if (!used.size) break;
    roads = [...roads.filter((_, i) => !used.has(i)), ...next];
  }
  return roads;
}

interface Car {
  road: number; forward: boolean; lane: number; s: number; type: number; slot: number;
  /** World position and heading last placed (footprint frame), its height, width, id. */
  x: number; y: number; z?: number; hx: number; hy: number; width: number; id: number;
  /** Current and cruising speed (m/s); length (m). */
  speed: number; cruise: number; length: number;
  /** The planned drive onto the next road (a turn, straight on, or a U-turn where the
   * surveyed roads end), whether it is on it now and how far along. */
  conn: Conn; inConn: boolean; u: number;
  /** Cleared to cross the stop line (the light and the exit allowed it). */
  go: boolean;
  /** Just out of an intersection: its rear still inside that box. */
  arrive: { node: number; startS: number; approach: string } | null;
  /** What holds it, for inspection. */
  why?: string;
  /** the vehicle whose body it last stopped short of (any road), for finding rings of waiting */
  bodyBy?: Car | null;
  /** struck by the driven vehicle: stands (s left), its hazard lights going */
  stunned?: number;
  /** Driven by hand (driveSim): its pose is its own, the others give way to it; `steer` its front
   * wheels' angle; `hide` while seen from its driver's seat. */
  manual?: boolean; steer?: number; hide?: boolean;
  /** the driver's step, run in the traffic's own step before it is placed */
  pilot?: (dt: number) => void;
}

/** Traffic both ways on the surveyed roads. Mostly cars (seven kinds); taxis, vans,
 * delivery, box and cargo trucks, city buses in three liveries and container trucks.
 * Right-hand traffic on the registered lanes, car following, signals at intersections;
 * lamps lit at night. */
export function stitchedRoads(roads: RealEstateRoad[]) { return stitchRoads(roads.filter(r => r.line.length > 1)); }


/** A junction arm's layout, in metres from the road's end along it: the zebra crossing
 * (crossA–crossB), the stop line (stopA–stopB); vehicles stop just behind the line. */
export interface ArmLayout { crossA: number; crossB: number; stopA: number; stopB: number; surveyed: boolean;
  /** false: no zebra crossing drawn (an unsignalled junction); `stop` false: no stop line either */
  zebra?: boolean; stop?: boolean }

export async function buildTraffic(roads: RealEstateRoad[], seed: number, hq: boolean, terrain: Terrain = FLAT,
  /** Mapped crosswalks (OpenStreetMap footway=crossing), in the footprint frame: where a junction
   * arm has one, its crossing (and so its stop line and stopping point) stands there. */
  crossings: { line: [number, number][] }[] = []) {
  const usable = stitchRoads(roads.filter(r => r.line.length > 1));
  if (!usable.length) return null;
  const { geos, texture, procedural } = await loadKit();
  // (the boxed vehicles' shapes, kept for the session: shared by every complex's traffic)
  const shape = (name: string) => procedural.get(name)!;
  // (the modelled cars where they load; else built from their proportions)
  const models = await loadCarModels().catch(err => { console.info("[3D] car models unavailable:", err); return null; });
  const rnd = rng(seed + 29);
  // Road polylines with cumulative lengths.
  const paths = usable.map(r => {
    const cum = [0];
    for (let i = 1; i < r.line.length; i++) cum.push(cum[i - 1] + Math.hypot(r.line[i][0] - r.line[i - 1][0], r.line[i][1] - r.line[i - 1][1]));
    return { ...r, cum, len: cum[cum.length - 1] };
  }).filter(p => p.len > 0.5); // short pieces stay: they carry the network across
  if (!paths.length) return null;

  const bodyMat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.45, metalness: 0.25 });
  // (WebGPU: clear-coated paint, dark glazing, matte tyres from the swatches)
  bodyMat.userData.carPaint = true;
  // WebGL: the same repaint as the WebGPU view (ComplexRenderer CAR_PAINT) — the body takes
  // the paint itself, glass and tyres stay; the kit's swatches read at full resolution.
  // Multiplied over the kit's red body instead, every car came out red-tinted (from afar,
  // with the swatches blended, red outright).
  bodyMat.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <map_fragment>", `
        vec4 carTexel = textureLod(map, vMapUv, 0.0);
        float carL = dot(carTexel.rgb, vec3(0.2126, 0.7152, 0.0722));
        float carGlass = smoothstep(0.08, 0.16, carTexel.b - carTexel.r) * smoothstep(0.45, 0.65, carL);
        float carBody = (1.0 - carGlass) * smoothstep(0.02, 0.07, carL);
        // (three defines USE_INSTANCING_COLOR for the vertex stage only; the fragment stage
        // sees vColor under USE_COLOR)
        #if defined( USE_INSTANCING_COLOR ) || defined( USE_COLOR )
        vec3 carPaint = clamp((vColor.rgb - 0.3) / 0.7, 0.0, 1.0) * 0.92;
        #else
        vec3 carPaint = carTexel.rgb;
        #endif
        diffuseColor.rgb = mix(mix(carTexel.rgb, carPaint, carBody), vec3(0.01, 0.012, 0.015), carGlass);`)
      .replace("#include <color_fragment>", "");
  };
  bodyMat.customProgramCacheKey = () => "car-paint";
  const boxMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });
  const lampMat = new THREE.MeshStandardMaterial({ color: "#000000", emissive: "#ffffff", emissiveMap: lampMap(), emissiveIntensity: 0, roughness: 0.3 });
  // Passenger cars from their proportions (sceneCars); vans, trucks and the rest from the kit.
  // (far and by default: the cars built from their proportions; near the eye the modelled ones)
  const kit = (name: string) => carGeometry(name) ?? geos.get(name)!;
  const modelMat = models ? carModelMaterial() : null;
  const nearGeo = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  if (models) for (const name of Object.keys(CAR_SPECS)) { const g = models.get(name), f = carGeometry(name); if (g && f) nearGeo.set(f, g); }
  // [geometry, material, weight, speed factor, length, width, lamp height, repaint]
  // model: the modelled mesh near the eye (sceneCars loadCarModels); livery: its paint when
  // the kind has one colour (buses by route, trucks, containers)
  const K = (geo: THREE.BufferGeometry, mat: THREE.Material, weight: number, speed: number, dims: [number, number, number], paint = false, model?: string, livery?: string) =>
    ({ geo, mat, weight, speed, dims, paint, own: false, model, livery });
  // (emergency vehicles keep white plates; the other box-built trucks and buses are commercial)
  const officials = new Set<THREE.BufferGeometry | null>();
  const official = <G,>(g: G) => { officials.add(g as unknown as THREE.BufferGeometry); return g; };
  const d = (n: string): [number, number, number] => CAR_SPECS[n] ? [CAR_SPECS[n].length, CAR_SPECS[n].width, CAR_SPECS[n].height] : DIMS[n];
  // Mix: passenger cars about 70 %; then trucks, buses and containers.
  // (made one kind at a time, the page breathing between: all at once held it ~0.1 s)
  const makers: (() => ReturnType<typeof K>)[] = [
    // (the passenger cars: sceneCars; shares after what Korean roads carry)
    () => K(kit("sedan"), bodyMat, 12, 1, [d("sedan")[0], d("sedan")[1], 0.62], true),
    () => K(kit("sedan-large"), bodyMat, 8, 1, [d("sedan-large")[0], d("sedan-large")[1], 0.64], true),
    () => K(kit("sedan-sports"), bodyMat, 8, 1.06, [d("sedan-sports")[0], d("sedan-sports")[1], 0.58], true),
    () => K(kit("suv"), bodyMat, 10, 1, [d("suv")[0], d("suv")[1], 0.75], true),
    () => K(kit("suv-small"), bodyMat, 8, 1.02, [d("suv-small")[0], d("suv-small")[1], 0.72], true),
    () => K(kit("suv-luxury"), bodyMat, 6, 1, [d("suv-luxury")[0], d("suv-luxury")[1], 0.78], true),
    () => K(kit("hatchback-sports"), bodyMat, 5, 1.02, [d("hatchback-sports")[0], d("hatchback-sports")[1], 0.62], true),
    () => K(kit("kei-box"), bodyMat, 4, 1, [d("kei-box")[0], d("kei-box")[1], 0.66], true),
    () => K(kit("taxi"), bodyMat, 8, 1, [d("taxi")[0], d("taxi")[1], 0.62], true),
    () => K(kit("mpv"), bodyMat, 5, 0.98, [d("mpv")[0], d("mpv")[1], 0.76], true),
    () => K(kit("van"), bodyMat, 3, 0.95, [d("van")[0], d("van")[1], 0.78], true),
    () => K(kit("delivery"), bodyMat, 3, 0.9, [d("delivery")[0], d("delivery")[1], 0.8], true, "boxtruck"),
    () => K(shape("cargo-blue"), boxMat, 4, 0.9, [5.1, 1.75, 0.75], false, "cargo", "#2d5fa8"),
    () => K(shape("cargo-white"), boxMat, 2, 0.9, [5.1, 1.75, 0.75], false, "cargo", "#e9e9e6"),
    () => K(shape("bus-blue"), boxMat, 2.5, 0.8, [11, 2.5, 0.75], false, "bus", "#2a6fc4"),   // 간선 blue
    () => K(shape("bus-green"), boxMat, 2.5, 0.8, [11, 2.5, 0.75], false, "bus", "#3b9a44"),   // 지선 green
    () => K(shape("bus-red"), boxMat, 0.5, 0.85, [11, 2.5, 0.75], false, "bus", "#c8322f"),  // 광역 red
    () => K(shape("container-red"), boxMat, 0.5, 0.8, [16.2, 2.45, 0.85], false, "container", "#b2402f"),
    () => K(shape("container-blue"), boxMat, 1.6, 0.8, [16.2, 2.45, 0.85], false, "container", "#2e5e8c"),
    () => K(shape("container-orange"), boxMat, 0.5, 0.8, [16.2, 2.45, 0.85], false, "container", "#c77a2a"),
    () => K(official(shape("ambulance")), boxMat, 1.1, 1.05, [5.7, 2.02, 0.85]),
    () => K(official(shape("police")), boxMat, 1.3, 1, [4.85, 1.84, 0.62]),
    () => K(official(shape("fire")), boxMat, 0.6, 0.85, [7.5, 2.42, 1.0]),
    () => K(shape("garbage"), boxMat, 1.0, 0.75, [7.0, 2.35, 0.95], false, "garbage", "#3f8f4e"),
    () => K(shape("mixer"), boxMat, 1.2, 0.75, [8.6, 2.39, 1.0], false, "mixer", "#e8e6e0"),
    // (twenty more: construction plant, goods, service, buses, a scooter, a pickup, the yellow school van)
    ...(new URLSearchParams(location.search).get("veh") === "0" ? [] : [
    () => K(shape("dump-orange"), boxMat, 0.9, 0.75, [9.6, 2.5, 1.05]),
    () => K(shape("dump-yellow"), boxMat, 0.6, 0.75, [9.6, 2.5, 1.05]),
    () => K(shape("dump-small"), boxMat, 0.6, 0.85, [6.0, 2.0, 0.8]),
    () => K(shape("excavator"), boxMat, 0.35, 0.55, [9.0, 2.5, 0.9]),
    () => K(shape("lowbed"), boxMat, 0.25, 0.65, [17.4, 2.6, 1.0]),
    () => K(shape("cargo-crane"), boxMat, 0.5, 0.8, [8.6, 2.4, 0.95]),
    () => K(shape("mobile-crane"), boxMat, 0.25, 0.6, [13.2, 2.75, 1.0]),
    () => K(shape("pump"), boxMat, 0.3, 0.7, [12.0, 2.5, 1.0]),
    () => K(shape("wing"), boxMat, 0.9, 0.8, [9.6, 2.5, 1.0]),
    () => K(shape("tanker"), boxMat, 0.35, 0.75, [13.2, 2.48, 1.0]),
    () => K(shape("box-cooled"), boxMat, 1.4, 0.9, [5.3, 1.86, 0.75]),
    () => K(shape("box-dry"), boxMat, 1.4, 0.9, [5.3, 1.86, 0.75]),
    () => K(shape("ladder"), boxMat, 0.5, 0.85, [7.4, 1.8, 0.75]),
    () => K(shape("tow"), boxMat, 0.4, 1, [6.2, 1.95, 0.8]),
    () => K(shape("sweeper"), boxMat, 0.25, 0.5, [6.4, 2.17, 0.9]),
    () => K(shape("bus-village"), boxMat, 1.0, 0.85, [8.9, 2.3, 0.75]),
    () => K(shape("bus-coach"), boxMat, 0.6, 0.9, [12, 2.5, 0.8]),
    () => K(shape("bus-double"), boxMat, 0.35, 0.8, [12, 2.5, 0.75]),
    () => K(shape("scooter"), boxMat, 2.2, 1.05, [1.95, 0.7, 0.8]),
    () => K(kit("pickup"), bodyMat, 2.5, 1, [d("pickup")[0], d("pickup")[1], 0.78], true),
    () => K(kit("van"), bodyMat, 0.9, 0.9, [d("van")[0], d("van")[1], 0.78], false, undefined, "#f2c414"),
    ]),
  ];
  const kinds: ReturnType<typeof K>[] = [];
  let slice = performance.now();
  for (const make of makers) {
    // (a slice a kind or two: some take several ms the first time — 45 kinds now)
    if (performance.now() - slice > 4) { await frameSlice(); slice = performance.now(); }
    const k = make();
    if (k.geo) kinds.push(k);
  }
  // The two vehicles a reader can follow: one of each, never dealt out at random (weight 0).
  const heroKind = new Map<HeroName, number>(), heroMats: THREE.Material[] = [], heroShape = new Map<number, HeroShape>();
  for (const [name, make] of [["coupang", coupangTruck], ["cyber", cybertruck]] as const) {
    await frameSlice();
    const kit = await loadKit(), prepared = kit.heroes[name];
    const h = prepared ? {...heroGeometry(prepared), material: heroSurface(name, kit.steel)} : make();
    heroShape.set(kinds.length, h);
    const k = K(h.geometry, [boxMat, h.material] as unknown as THREE.Material, 0, name === "cyber" ? 1.05 : 0.95, h.dims);
    k.own = true;
    heroKind.set(name, kinds.length); kinds.push(k); heroMats.push(h.material);
    if (name === "coupang") officials.delete(h.geometry);
  }
  const totalW = kinds.reduce((s, k) => s + k.weight, 0);
  const pickKind = () => { let r = rnd() * totalW; for (let i = 0; i < kinds.length; i++) { r -= kinds[i].weight; if (r <= 0) return i; } return 0; };

  // ---- The network: nodes where road ends meet, T-junctions, signals ----
  // Lanes per direction: the registered count split both ways, but only as many as
  // fit at 3 m or wider (some registered counts exceed what the width allows).
  const lanesOf = (road: number) => { const p = paths[road]; return Math.max(1, Math.min(Math.floor(Math.max(2, p.lanes) / 2), Math.floor(p.width / 2 / 3))); };
  const laneWidth = (road: number) => Math.max(3, paths[road].width / 2 / lanesOf(road));
  /** Point at centreline distance d along a road, and the forward unit direction there. The
   * direction eases from one segment's to the next over a few metres either side of each bend
   * (a surveyed curve is a polyline: taken segment by segment, a vehicle turned in steps, and
   * its lane, offset along the turned direction, jumped). */
  const segDir = (p: (typeof paths)[number], i: number) => {
    const [ax, ay] = p.line[i - 1], [bx, by] = p.line[i], seg = p.cum[i] - p.cum[i - 1] || 1;
    return [(bx - ax) / seg, (by - ay) / seg];
  };
  const bendR = (p: (typeof paths)[number], i: number) => Math.min(4, 0.45 * (p.cum[i] - p.cum[i - 1]), 0.45 * (p.cum[i + 1] - p.cum[i]));
  const at = (p: (typeof paths)[number], d: number) => {
    let i = 1;
    const last = p.cum.length - 1;
    while (i < last && p.cum[i] < d) i++;
    const [ax, ay] = p.line[i - 1], [bx, by] = p.line[i];
    const seg = p.cum[i] - p.cum[i - 1] || 1, t = Math.min(1, Math.max(0, (d - p.cum[i - 1]) / seg));
    let [ux, uy] = segDir(p, i);
    const blend = (o: number[], w: number) => {   // w: this segment's share, 0.5 at the bend
      w = w * w * (3 - 2 * w);
      const x = ux * w + o[0] * (1 - w), y = uy * w + o[1] * (1 - w), l = Math.hypot(x, y) || 1;
      ux = x / l; uy = y / l;
    };
    const into = d - p.cum[i - 1], left = p.cum[i] - d;
    if (i > 1) { const r = bendR(p, i - 1); if (r > 0.05 && into < r) blend(segDir(p, i - 1), 0.5 + 0.5 * Math.max(0, into) / r); }
    if (i < last) { const r = bendR(p, i); if (r > 0.05 && left < r) blend(segDir(p, i + 1), 0.5 + 0.5 * Math.max(0, left) / r); }
    return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, ux, uy };
  };
  /** Unit heading of travel at the end a vehicle is driving towards. */
  const headingIn = (road: number, forward: boolean) => {
    const p = paths[road], a = at(p, forward ? p.len : 0);
    return forward ? [a.ux, a.uy] : [-a.ux, -a.uy];
  };
  // Nodes: road ends within 6 m of each other. `${road}:${atStart}` names a road end.
  const nodes: { x: number; y: number; ends: { road: number; atStart: boolean }[] }[] = [];
  const nodeOf = new Map<string, number>();
  paths.forEach((p, road) => {
    for (const atStart of [true, false]) {
      const [x, y] = atStart ? p.line[0] : p.line[p.line.length - 1];
      let n = nodes.findIndex(o => Math.hypot(o.x - x, o.y - y) < 6);
      if (n < 0) { n = nodes.length; nodes.push({ x, y, ends: [] }); }
      nodes[n].ends.push({ road, atStart });
      nodeOf.set(`${road}:${atStart}`, n);
    }
  });
  // Intersections. Surveyed centrelines split one real intersection into several nodes
  // (split carriageways, offset road ends) joined by short stubs. Nodes where three or
  // more road ends meet, within 35 m of each other or joined by a stub under 40 m, form
  // one intersection; the stubs are inside it and carry no queue. Traffic enters from
  // the roads outside (approaches) and leaves by the others (exits).
  const junction = nodes.map(n => n.ends.length >= 3);
  // (how far apart a junction's pieces lie grows with its roads: across a 50 m boulevard the
  // split carriageways' nodes are ~50 m apart, and two "intersections" stood in one)
  const nodeW = nodes.map(n => Math.max(0, ...n.ends.map(e => paths[e.road].width)));
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  nodes.forEach((a, i) => nodes.forEach((b, j) => {
    if (j > i && junction[i] && junction[j] && Math.hypot(a.x - b.x, a.y - b.y) < Math.max(35, 0.6 * (nodeW[i] + nodeW[j]))) parent[find(i)] = find(j);
  }));
  paths.forEach((p, r) => {
    const a = nodeOf.get(`${r}:true`)!, b = nodeOf.get(`${r}:false`)!;
    if (junction[a] && junction[b] && p.len < Math.max(40, 1.2 * Math.max(nodeW[a], nodeW[b]))) parent[find(a)] = find(b);
  });
  const clusterIds = new Map<number, number>();
  const clusterOf = nodes.map((_, i) => {
    if (!junction[i]) return -1;
    const root = find(i);
    if (!clusterIds.has(root)) clusterIds.set(root, clusterIds.size);
    return clusterIds.get(root)!;
  });
  const clusters = [...clusterIds.keys()].map(() => ({ nodes: [] as number[], x: 0, y: 0, r: 0 }));
  clusterOf.forEach((c, i) => { if (c >= 0) clusters[c].nodes.push(i); });
  for (const c of clusters) {
    c.x = c.nodes.reduce((s, i) => s + nodes[i].x, 0) / c.nodes.length;
    c.y = c.nodes.reduce((s, i) => s + nodes[i].y, 0) / c.nodes.length;
    c.r = Math.max(0, ...c.nodes.map(i => Math.hypot(nodes[i].x - c.x, nodes[i].y - c.y)));
  }
  const endCluster = (road: number, atStart: boolean) => clusterOf[nodeOf.get(`${road}:${atStart}`)!];
  const internal = paths.map((_, r) => { const a = endCluster(r, true); return a >= 0 && a === endCluster(r, false); });
  /** Road ends outside roads have at an intersection: [road, atStart]. */
  const clusterEnds = clusters.map((c, ci) => c.nodes.flatMap(ni => nodes[ni].ends.filter(e => !internal[e.road])).filter(e => endCluster(e.road, e.atStart) === ci));

  /** Ways on from the end of `road` in direction `forward`, with how straight each is. */
  const linkCache = new Map<string, { link: Link; dot: number }[]>();
  const linksFrom = (road: number, forward: boolean) => {
    const key = `${road}:${forward}`;
    if (linkCache.has(key)) return linkCache.get(key)!;
    const [hx, hy] = headingIn(road, forward);
    const out: { link: Link; dot: number }[] = [];
    const ni = nodeOf.get(`${road}:${!forward}`)!, node = nodes[ni], ci = clusterOf[ni];
    // At an intersection: straight across to any other road leaving it.
    const candidates = ci >= 0 && !internal[road] ? clusterEnds[ci] : node.ends;
    for (const e of candidates) {
      if (e.road === road || internal[e.road]) continue;
      const p = paths[e.road], a = at(p, e.atStart ? 0 : p.len);
      const ux = e.atStart ? a.ux : -a.ux, uy = e.atStart ? a.uy : -a.uy;
      out.push({ link: { road: e.road, forward: e.atStart, s0: 0 }, dot: ux * hx + uy * hy });
    }
    if (node.ends.length === 1) {
      // A T-junction: this road ends part way along another.
      const { x: ex, y: ey } = at(paths[road], forward ? paths[road].len : 0);
      for (let r = 0; r < paths.length; r++) {
        if (r === road || internal[r]) continue;
        const p = paths[r];
        for (let i = 1; i < p.line.length; i++) {
          const [ax, ay] = p.line[i - 1], [bx, by] = p.line[i], dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
          const t = Math.max(0, Math.min(1, ((ex - ax) * dx + (ey - ay) * dy) / (l * l)));
          if (Math.hypot(ax + dx * t - ex, ay + dy * t - ey) > 5) continue;
          const d = p.cum[i - 1] + t * l, ux = dx / l, uy = dy / l;
          if (d < p.len - 3) out.push({ link: { road: r, forward: true, s0: d }, dot: ux * hx + uy * hy });
          if (d > 3) out.push({ link: { road: r, forward: false, s0: p.len - d }, dot: -(ux * hx + uy * hy) });
          break;
        }
      }
    }
    const usable = out.filter(o => o.dot > -0.35); // no reversing into the road just left
    linkCache.set(key, usable);
    return usable;
  };
  const laneKey = (road: number, forward: boolean, lane: number) => `${road}|${forward}|${Math.min(lane, lanesOf(road) - 1)}`;
  /** Point and travel heading at distance s (travel coordinates) in a lane. */
  const lanePt = (road: number, forward: boolean, s: number, lane: number) => {
    const p = paths[road], pt = at(p, forward ? s : p.len - s);
    const hx = forward ? pt.ux : -pt.ux, hy = forward ? pt.uy : -pt.uy;
    // Right-hand traffic: lanes to the right of the direction of travel.
    const off = (Math.min(lane, lanesOf(road) - 1) + 0.5) * laneWidth(road);
    return { x: pt.x + hy * off, y: pt.y - hx * off, hx, hy };
  };
  const turnOf = (road: number, forward: boolean, link: Link): Turn => {
    if (link.road === road && link.forward !== forward) return "uturn";
    const [hx, hy] = headingIn(road, forward);
    const o = lanePt(link.road, link.forward, link.s0, 0);
    const dot = hx * o.hx + hy * o.hy, cross = hx * o.hy - hy * o.hx;
    return dot > 0.7 ? "straight" : cross > 0 ? "left" : "right";
  };
  // Roads with nowhere to go at either end (fragments at the edge of the data), short
  // dead-end stubs, and the stubs inside intersections carry no traffic of their own.
  // (Repeated: a road whose only ways on lead into idle roads is a dead end too.)
  const idle = paths.map((_, r) => internal[r]);
  for (let pass = 0; pass < 6; pass++) {
    const deadEnd = (road: number, forward: boolean) => linksFrom(road, forward).every(o => idle[o.link.road]);
    let changed = false;
    paths.forEach((p, r) => {
      const now = (deadEnd(r, true) && deadEnd(r, false) && p.len < 60) || ((deadEnd(r, true) || deadEnd(r, false)) && p.len < 30);
      if (now && !idle[r]) { idle[r] = true; changed = true; }
    });
    if (!changed) break;
  }
  /** Mostly straight on, sometimes a turn, from the lane that allows it (1차로 좌회전,
   * 끝 차로 우회전); where the surveyed roads end, a U-turn. */
  const choose = (road: number, forward: boolean, lane: number): Link => {
    let opts = linksFrom(road, forward).filter(o => !idle[o.link.road]);
    if (!opts.length) return { road, forward: !forward, s0: 0 };
    const n = lanesOf(road);
    if (n > 1) {
      const ok = opts.filter(o => {
        const t = turnOf(road, forward, o.link);
        return t === "straight" || (t === "left" && lane === 0) || (t === "right" && lane === n - 1);
      });
      if (ok.length) opts = ok;
    }
    const w = opts.map(o => Math.exp(3 * o.dot)), total = w.reduce((a, b) => a + b, 0);
    let r = rnd() * total;
    for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i].link; }
    return opts[0].link;
  };

  // Where traffic stops on each approach (nothing is painted): walking back out of the
  // intersection, the first point where both edges of the road are 2 m clear of the
  // asphalt of every road crossing it there — the stubs inside included; roads running
  // parallel (the continuation, the other carriageway) don't count. The same distance
  // is where traffic leaving by that road rejoins its lane.
  // (the box's edge: clear of the crossing roads by half a metre; the crossing, the stop line and
  // the stopping point follow outward from it — ArmLayout)
  const CLEAR = 0.5;
  const distToRoad = (x: number, y: number, o: (typeof paths)[number]) => {
    let best = Infinity;
    for (let i = 1; i < o.line.length; i++) {
      const [ax, ay] = o.line[i - 1], [bx, by] = o.line[i], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
    }
    return best;
  };
  const trimAt = new Map<string, number>(), layout = new Map<string, ArmLayout>();
  /** An intersection's arms, major and minor: a side street (under 8 m, or a third of the widest
   * road there) joining a road is no signalled crossroads — no lights, no zebra across the main
   * road, no stop line on it; the side street gives way. Signals where three or more major arms meet. */
  const armInfo = clusters.map((_, ci) => {
    const ends = clusterEnds[ci], wMax = Math.max(0, ...ends.map(e => paths[e.road].width));
    const minor = new Set(ends.filter(e => paths[e.road].width < Math.max(8, 0.35 * wMax)).map(e => `${e.road}:${e.atStart}`));
    const majors = ends.length - minor.size;
    return { minor, majors, signal: ends.length >= 3 && majors >= 3 };
  });
  /** Where a mapped crossing crosses a road, in metres from the end `atStart` (within lo–hi), or null. */
  const crossingOn = (road: number, atStart: boolean, lo: number, hi: number): number | null => {
    const p = paths[road];
    let best: number | null = null;
    for (const cw of crossings) for (let k = 1; k < cw.line.length; k++) {
      const [cx0, cy0] = cw.line[k - 1], [cx1, cy1] = cw.line[k];
      for (let i = 1; i < p.line.length; i++) {
        const [ax, ay] = p.line[i - 1], [bx, by] = p.line[i];
        const d1x = bx - ax, d1y = by - ay, d2x = cx1 - cx0, d2y = cy1 - cy0, den = d1x * d2y - d1y * d2x;
        if (Math.abs(den) < 1e-6) continue;
        const t = ((cx0 - ax) * d2y - (cy0 - ay) * d2x) / den, u = ((cx0 - ax) * d1y - (cy0 - ay) * d1x) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const along = p.cum[i - 1] + t * Math.hypot(d1x, d1y), fromEnd = atStart ? along : p.len - along;
        if (fromEnd >= lo && fromEnd <= hi && (best === null || fromEnd < best)) best = fromEnd;
      }
    }
    return best;
  };
  clusters.forEach((c, ci) => {
    for (const e of clusterEnds[ci]) {
      const p = paths[e.road], [hx, hy] = headingIn(e.road, !e.atStart);
      const crossing = paths.filter((o, r) => {
        if (r === e.road || distToRoad(c.x, c.y, o) > c.r + 25) return false;
        let dir = [0, 0], dmin = Infinity;
        for (let i = 1; i < o.line.length; i++) {
          const [ax, ay] = o.line[i - 1], [bx, by] = o.line[i], d = Math.hypot((ax + bx) / 2 - c.x, (ay + by) / 2 - c.y);
          if (d < dmin) { dmin = d; const l = Math.hypot(bx - ax, by - ay) || 1; dir = [(bx - ax) / l, (by - ay) / l]; }
        }
        return Math.abs(dir[0] * hx + dir[1] * hy) < 0.85;
      });
      // Leave room to queue: half the block when another intersection is at its far end,
      // else all but 12 m (a queue can't reach back onto the road before).
      const far = endCluster(e.road, !e.atStart);
      const limit = far >= 0 ? p.len * 0.45 : Math.max(3, p.len - 12);
      let d = 3;
      for (; d < limit; d += 0.5) {
        const pt = at(p, e.atStart ? d : p.len - d), rx = hy, ry = -hx, w = p.width / 2;
        if (crossing.every(o => [-w, 0, w].every(k => distToRoad(pt.x + rx * k, pt.y + ry * k, o) > o.width / 2 + CLEAR))) break;
      }
      // From the box's edge outward: the crossing (the mapped one when it crosses this arm within
      // 25 m, else 4 m wide just outside the box), a metre, the 40 cm stop line; the stopping
      // point (trim) 30 cm behind the line.
      let cA = d + 0.5, cB = d + 4.5, surveyed = false;
      const mapped = crossingOn(e.road, e.atStart, d - 3, d + 25);
      if (mapped !== null) { cA = Math.max(d, mapped - 2); cB = mapped + 2; surveyed = true; }
      const sA = cB + 1, sB = sA + 0.4, stopAt = sB + 0.3;
      const ai = armInfo[ci], key = `${e.road}:${e.atStart}`;
      if (ai.signal) {
        if (stopAt <= limit) layout.set(key, { crossA: cA, crossB: cB, stopA: sA, stopB: sB, surveyed });
        trimAt.set(key, Math.min(stopAt, limit));
      } else if (clusterEnds[ci].length >= 3) {
        // unsignalled: no zebra drawn; a stop line only where the arm gives way
        const gives = ai.minor.has(key) || ai.majors === 0, s0 = Math.min(d + 0.5, limit);
        layout.set(key, { crossA: s0, crossB: s0, stopA: s0, stopB: s0 + 0.4, surveyed: false, zebra: false, stop: gives });
        trimAt.set(key, Math.min(gives ? s0 + 0.7 : d + 1.5, limit));
      } else trimAt.set(key, Math.min(d + 1.5, limit));
    }
  });
  const trim = (road: number, atStart: boolean) => trimAt.get(`${road}:${atStart}`) ?? 1.5;
  // Korean 방향별 신호: each approach direction in turn (clockwise) gets green with the
  // left arrow, then yellow, then all-red, while every other direction is red. Roads
  // arriving from about the same direction share a phase: at most four phases.
  const G = 9, Y = 3, AR = 2, P = G + Y + AR;
  const signals = clusters.map((_, ci) => {
    const ends = clusterEnds[ci];
    if (ends.length < 3 || !armInfo[ci].signal) return null;
    const ang = (e: { road: number; atStart: boolean }) => { const [hx, hy] = headingIn(e.road, !e.atStart); return Math.atan2(hy, hx); };
    const groups: { a: number; keys: string[] }[] = [];
    for (const e of [...ends].sort((a, b) => ang(b) - ang(a))) {
      const a = ang(e), g = groups.find(o => Math.abs(Math.atan2(Math.sin(a - o.a), Math.cos(a - o.a))) < 0.7);
      if (g) g.keys.push(`${e.road}:${e.atStart}`); else groups.push({ a, keys: [`${e.road}:${e.atStart}`] });
    }
    while (groups.length > 4) { const g = groups.pop()!; groups[groups.length - 1].keys.push(...g.keys); }
    const phase = new Map<string, number>();
    groups.forEach((g, i) => g.keys.forEach(k => phase.set(k, i)));
    return { phase, phases: groups.length, offset: rnd() * P * groups.length };
  });
  let clock = 0;
  type Light = "green" | "yellow" | "red";
  /** The light shown to traffic arriving at road end `key` (`${road}:${atStart}`). */
  const lightAt = (ci: number, key: string): Light => {
    const sg = signals[ci];
    if (!sg) return "green";
    const t = (clock + sg.offset) % (P * sg.phases), i = Math.floor(t / P), w = t - i * P;
    if (sg.phase.get(key) !== i) return "red";
    return w < G ? "green" : w < G + Y ? "yellow" : "red";
  };

  const connCache = new Map<string, Conn>();
  const connector = (road: number, forward: boolean, lane: number, link: Link): Conn => {
    const turn = turnOf(road, forward, link);
    const nl = lanesOf(link.road);
    const nextLane = turn === "left" || turn === "uturn" ? 0 : turn === "right" ? nl - 1 : Math.min(lane, nl - 1);
    const key = `${road}|${forward}|${lane}>${link.road}|${link.forward}|${link.s0.toFixed(1)}|${nextLane}`;
    const hit = connCache.get(key);
    if (hit) return hit;
    const ci = endCluster(road, !forward), sig = ci >= 0 && signals[ci] !== null, tJoin = link.s0 > 0;
    const endTrim = ci >= 0 ? trim(road, !forward) : tJoin ? paths[link.road].width / 2 + 1.5 : turn === "uturn" ? 2 : 1.5;
    const startTrim = ci >= 0 ? trim(link.road, link.forward) : tJoin ? paths[road].width / 2 + 1.5 : turn === "uturn" ? 2 : 1.5;
    const endS = paths[road].len - endTrim, startS = Math.min(paths[link.road].len - 1, link.s0 + startTrim);
    const a = lanePt(road, forward, endS, lane), b = lanePt(link.road, link.forward, startS, nextLane);
    const dist = Math.hypot(b.x - a.x, b.y - a.y), k = turn === "uturn" ? Math.max(3.5, dist) : Math.max(1, dist * 0.42);
    const p1 = [a.x + a.hx * k, a.y + a.hy * k], p2 = [b.x - b.hx * k, b.y - b.hy * k];
    const N = 24, xs = new Float32Array(N + 1), ys = new Float32Array(N + 1), cum = new Float32Array(N + 1);
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      xs[i] = u * u * u * a.x + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * b.x;
      ys[i] = u * u * u * a.y + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * b.y;
      if (i) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    }
    const conn: Conn = { key, fromKey: laneKey(road, forward, lane), toKey: laneKey(link.road, link.forward, nextLane), link, turn, lane: nextLane,
      endS, startS, len: Math.max(0.5, cum[N]), node: sig ? ci : -1, approach: `${road}:${!forward}`, tJoin, xs, ys, cum,
      cluster: ci, giveWay: ci >= 0 && !sig && clusterEnds[ci].length >= 3 && (armInfo[ci].minor.has(`${road}:${!forward}`) || armInfo[ci].majors === 0) };
    connCache.set(key, conn);
    return conn;
  };
  /** Where a road's own start leaves off (travel coordinates): past its start intersection. */
  const startOf = (road: number, forward: boolean) => trim(road, forward);

  // About one vehicle per 55 m of lane, capped; spaced so none overlap.
  const laneMetres = paths.reduce((s, p) => s + p.len * Math.max(2, p.lanes), 0);
  // (the network now spans the 600 m neighbourhood: more vehicles, the same spacing)
  const count = Math.min(hq ? 460 : 170, Math.round(laneMetres / 55));
  const cars: Car[] = [];
  const perKind = kinds.map(() => 0);
  for (let tries = 0; cars.length < count && tries < count * 10; tries++) {
    const road = Math.floor(rnd() * paths.length), forward = rnd() < 0.5, lane = Math.floor(rnd() * lanesOf(road));
    if (idle[road]) continue;
    const type = pickKind(), length = kinds[type].dims[0];
    const conn = connector(road, forward, lane, choose(road, forward, lane));
    const s0 = startOf(road, forward), span = conn.endS - s0 - length - 2;
    if (span < 2) continue;
    const s = s0 + length / 2 + rnd() * span;
    if (cars.some(o => !o.inConn && o.road === road && o.forward === forward && o.lane === lane && Math.abs(o.s - s) < (o.length + length) / 2 + 6)) continue;
    // (nor on another vehicle of a road surveyed over this one, or a lane where two meet)
    const at0 = lanePt(road, forward, s, lane), width = kinds[type].dims[1];
    if (cars.some(o => { const dx = o.x - at0.x, dy = o.y - at0.y; return Math.abs(dx * at0.hx + dy * at0.hy) < (o.length + length) / 2 + 2 && Math.abs(dx * at0.hy - dy * at0.hx) < (o.width + width) / 2 + 0.3; })) continue;
    const cruise = (7 + rnd() * 5) * kinds[type].speed;
    cars.push({ road, forward, lane, s, type, slot: perKind[type]++, x: at0.x, y: at0.y, hx: at0.hx, hy: at0.hy, width, id: cars.length,
      speed: cruise, cruise, length, conn, inConn: false, u: 0, go: false, arrive: null });
  }
  /** A vehicle of `type` placed on a random free lane (null when none is found). */
  const spawnOf = (type: number): Car | null => {
    for (let tries = 0; tries < 400; tries++) {
      const road = Math.floor(rnd() * paths.length), forward = rnd() < 0.5, lane = Math.floor(rnd() * lanesOf(road));
      if (idle[road]) continue;
      const length = kinds[type].dims[0], conn = connector(road, forward, lane, choose(road, forward, lane));
      const s0 = startOf(road, forward), span = conn.endS - s0 - length - 2;
      if (span < 2) continue;
      const s = s0 + length / 2 + rnd() * span;
      if (cars.some(o => !o.inConn && o.road === road && o.forward === forward && o.lane === lane && Math.abs(o.s - s) < (o.length + length) / 2 + 6)) continue;
    // (nor on another vehicle of a road surveyed over this one, or a lane where two meet)
    const at0 = lanePt(road, forward, s, lane), width = kinds[type].dims[1];
    if (cars.some(o => { const dx = o.x - at0.x, dy = o.y - at0.y; return Math.abs(dx * at0.hx + dy * at0.hy) < (o.length + length) / 2 + 2 && Math.abs(dx * at0.hy - dy * at0.hx) < (o.width + width) / 2 + 0.3; })) continue;
      const cruise = 10 * kinds[type].speed;
      const c: Car = { road, forward, lane, s, type, slot: perKind[type]++, x: at0.x, y: at0.y, hx: at0.hx, hy: at0.hy, width, id: cars.length,
        speed: cruise, cruise, length, conn, inConn: false, u: 0, go: false, arrive: null };
      cars.push(c);
      return c;
    }
    return null;
  };
  const heroes = new Map<HeroName, Car>();
  for (const [name, type] of heroKind) { const c = spawnOf(type); if (c) heroes.set(name, c); }
  const group = new THREE.Group();
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow: boolean) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    im.count = n;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.castShadow = shadow;
    im.frustumCulled = false;
    group.add(im);
    return im;
  };
  await frameSlice();
  const meshes = kinds.map((k, i) => instanced(k.geo, k.mat, perKind[i], true));
  // The followed vehicles' wheels: their own instanced mesh each, turned as the vehicle rolls
  // (the angle: the distance driven over the rolling radius).
  const heroWheels = [...heroes].map(([, c]) => {
    const h = heroShape.get(c.type)!;
    const im = instanced(h.wheel, boxMat, h.wheels.length, true);
    return { c, h, im, spin: 0 };
  });
  const wm = new THREE.Matrix4(), wl = new THREE.Matrix4(), wr = new THREE.Matrix4(), ws = new THREE.Matrix4(), flip = new THREE.Matrix4().makeRotationY(Math.PI);
  const turnWheels = (dt: number) => {
    for (const hw of heroWheels) {
      hw.spin = (hw.spin + (hw.c.speed * dt) / hw.h.radius) % (Math.PI * 2);
      meshes[hw.c.type].getMatrixAt(hw.c.slot, wm);
      hw.h.wheels.forEach((wh, i) => {
        // (a left wheel faces out the other way: turned half round, its spin reversed)
        wl.makeTranslation(wh.x, hw.h.radius, wh.z);
        // (the front pair turned to the steering: + to the left)
        if (wh.z > 0 && hw.c.steer) wl.multiply(ws.makeRotationY(hw.c.steer));
        if (wh.side < 0) wl.multiply(flip);
        wl.multiply(wr.makeRotationX(wh.side < 0 ? -hw.spin : hw.spin));
        hw.im.setMatrixAt(i, wr.multiplyMatrices(wm, wl));
      });
      hw.im.instanceMatrix.needsUpdate = true;
    }
  };
  // Near the eye (NEAR_M) a car is drawn from its modelled mesh: those instances are packed
  // into a second mesh per kind each frame and hidden in the far one.
  let NEAR_M = 55;   // (wider while driving: setDetail)
  const near = kinds.map((k, i) => {
    const g = nearGeo.get(k.geo) ?? (k.model ? models?.get(k.model) : undefined);
    if (!g || !modelMat) return null;
    const im = instanced(g, modelMat, perKind[i], true);
    im.count = 0;
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, perKind[i]) * 3).fill(1), 3);
    return im;
  });
  const white = new THREE.Color("#ffffff");
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0), mm = new THREE.Matrix4(), cc = new THREE.Color(), eyeLocal = new THREE.Vector3();
  // Number plates, front and rear, on the vehicles near enough to read them (PLATE_M):
  // yellow for taxis, delivery vans, trucks and buses, white for the rest.
  let PLATE_M = 40;
  await plateAtlasReady();
  const plateMat = plateMaterial();
  const commercial = kinds.map((k, i) => k.geo === kit("taxi") || k.geo === kit("delivery") || (k.mat === boxMat && !officials.has(k.geo)) || i === heroKind.get("coupang"));
  await frameSlice();
  const plateGeos = kinds.map(k => {
    const spec = Object.entries(CAR_SPECS).find(([n]) => kit(n) === k.geo)?.[1];
    const L = k.dims[0], c = spec?.clearance ?? 0.3;
    // (the modelled trucks' plates: on the bumper, and under the tail lamps — gen-cars.py)
    const TRUCK: Record<string, [number, number, number, number]> = { cargo: [0.6, 0.55, 0.14, 0.05], boxtruck: [0.7, 0.7, 0.14, 0.05],
      bus: [0.45, 0.73, 0.18, 0.05], container: [0.98, 1.03, 0.14, 0.07], garbage: [0.88, 1.08, 0.14, 0.07], mixer: [0.93, 1.03, 0.14, 0.05] };
    const t = k.model ? TRUCK[k.model] : undefined;
    if (t) return plateGeometry(L, t[0], t[1], t[2], t[3]);
    const hp = heroShape.get(kinds.indexOf(k))?.plate;
    if (hp) return plateGeometry(...hp);
    return plateGeometry(L, spec ? c + 0.2 : 0.55, spec ? c + 0.35 : 0.65);
  });
  const plates = kinds.map((_, i) => {
    const im = instanced(plateGeos[i], plateMat, perKind[i], false);
    im.count = 0;
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, perKind[i]) * 3), 3);
    return im;
  });
  // (each vehicle its own plate: the white and the yellow ones dealt out shuffled, no repeats
  // until a deck runs out)
  const deck = (lo: number, hi: number) => { const d = Array.from({ length: hi - lo }, (_, i) => lo + i); for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } return d; };
  const whites = deck(0, PLATE_WHITE), yellows = deck(PLATE_WHITE, PLATE_COUNT);
  let wi = 0, yi = 0;
  const plateOf = cars.map(c => commercial[c.type] ? yellows[yi++ % yellows.length] : whites[wi++ % whites.length]);
  const nearNow = kinds.map(() => new Set<number>());
  const swapNear = (eye?: THREE.Vector3) => {
    if (!eye) return;
    eyeLocal.copy(eye); group.worldToLocal(eyeLocal);
    const packed = near.map(() => 0), platesN = kinds.map(() => 0);
    for (const c of cars) {
      const far = meshes[c.type];
      const pdx = c.x - eyeLocal.x, pdz = -c.y - eyeLocal.z;
      if (pdx * pdx + pdz * pdz < PLATE_M * PLATE_M) {
        far.getMatrixAt(c.slot, mm);
        const k = platesN[c.type]++;
        plates[c.type].setMatrixAt(k, mm);
        plates[c.type].setColorAt(k, cc.setRGB((plateOf[c.id] % 256) / 255, Math.floor(plateOf[c.id] / 256) / 255, 0));
      }
      const im = near[c.type];
      if (!im) continue;
      far.getMatrixAt(c.slot, mm);
      const was = nearNow[c.type].has(c.slot);
      const dx = c.x - eyeLocal.x, dz = -c.y - eyeLocal.z, isNear = dx * dx + dz * dz < NEAR_M * NEAR_M;
      if (isNear) {
        if (!was) nearNow[c.type].add(c.slot);
        const k = packed[c.type]++;
        im.setMatrixAt(k, mm);
        if (kinds[c.type].livery) im.setColorAt(k, cc.set(kinds[c.type].livery!).lerp(white, 0.3));
        else if (far.instanceColor) { far.getColorAt(c.slot, cc); im.setColorAt(k, cc); }
        far.setMatrixAt(c.slot, hidden);
      } else if (was) nearNow[c.type].delete(c.slot);
    }
    plates.forEach((im, i) => { im.count = platesN[i]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; });
    near.forEach((im, i) => { if (!im) return; im.count = packed[i]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; });
  };
  await frameSlice();
  // (the two followed vehicles light their own modelled lamps; the rest a generic pair at each end)
  const lampGeos = kinds.map((k, i) => { const own = heroShape.get(i)?.lamps; return own?.length ? lampGeometryOf(own) : lampGeometry(k.dims[0], k.dims[1], k.dims[2]); });
  const lamps = kinds.map((_, i) => { const im = instanced(lampGeos[i], lampMat, perKind[i], false); im.visible = false; return im; });
  let lampsOn = false;
  // Body colours for the Kenney cars vary through the per-instance colour.
  // Colours by their share of Korean registrations: white and pearl about a third, greys a
  // fifth, black a sixth, silver, blue; red, beige, brown and green only now and then.
  const paintShares: [string, number][] = [
    ["#f7f7f5", 20], ["#ecebe6", 13], ["#6b6e72", 10], ["#4a4d51", 10], ["#141518", 17], ["#b9bcc0", 8],
    ["#223a5e", 4], ["#3d5f86", 2], ["#7a1c22", 3], ["#c8bca6", 3], ["#5a4336", 2], ["#2f4436", 2], ["#9a9d8f", 2]];
  const paintTotal = paintShares.reduce((t, [, w]) => t + w, 0);
  const paintPick = () => { let r = rnd() * paintTotal; for (const [c, w] of paintShares) { r -= w; if (r <= 0) return c; } return paintShares[0][0]; };
  // (taxis in the city's liveries: orange, white, silver)
  const taxiPaints = ["#e8772a", "#f2f2f0", "#c9ccd0", "#f2f2f0", "#c9ccd0"];
  // (delivery vans: white, silver, the odd blue)
  const vanPaints = ["#f4f4f2", "#f4f4f2", "#c9ccd0", "#2d5fa8"];
  const taxiKind = kinds.findIndex(k => k.geo === kit("taxi")), deliveryKind = kinds.findIndex(k => k.geo === kit("delivery"));
  await frameSlice();
  cars.forEach(c => {
    // (one colour for every car of a kind: the school vans' yellow)
    const fixed = kinds[c.type].mat === bodyMat && !kinds[c.type].paint ? kinds[c.type].livery : undefined;
    if (fixed) { meshes[c.type].setColorAt(c.slot, new THREE.Color(fixed)); return; }
    if (!kinds[c.type].paint) return;
    const colour = c.type === taxiKind ? taxiPaints[Math.floor(rnd() * taxiPaints.length)]
      : c.type === deliveryKind ? vanPaints[Math.floor(rnd() * vanPaints.length)] : paintPick();
    meshes[c.type].setColorAt(c.slot, new THREE.Color(colour).lerp(new THREE.Color("#ffffff"), 0.3));
  });
  meshes.forEach(m => { if (m.instanceColor) m.instanceColor.needsUpdate = true; });

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const qp = new THREE.Quaternion(), across = new THREE.Vector3(1, 0, 0), zero = new THREE.Vector3(0, 0, 0);
  const place = (c: Car) => {
    if (c.manual) { /* (where the driver put it) */ }
    else if (c.inConn) {
      const cn = c.conn, u = Math.min(c.u, cn.len);
      let i = 1;
      while (i < cn.cum.length - 1 && cn.cum[i] < u) i++;
      const seg = cn.cum[i] - cn.cum[i - 1] || 1, t = (u - cn.cum[i - 1]) / seg;
      const dx = cn.xs[i] - cn.xs[i - 1], dy = cn.ys[i] - cn.ys[i - 1];
      c.x = cn.xs[i - 1] + dx * t; c.y = cn.ys[i - 1] + dy * t;
      // (the heading eased from segment to segment, not stepped at each)
      const n = cn.cum.length - 1, j = t < 0.5 ? Math.max(1, i - 1) : Math.min(n, i + 1), w = t < 0.5 ? 0.5 + t : 1.5 - t;
      const ox = cn.xs[j] - cn.xs[j - 1], oy = cn.ys[j] - cn.ys[j - 1], lo = Math.hypot(ox, oy) || 1, li = Math.hypot(dx, dy) || 1;
      const hx = dx / li * w + ox / lo * (1 - w), hy = dy / li * w + oy / lo * (1 - w), l = Math.hypot(hx, hy) || 1;
      c.hx = hx / l; c.hy = hy / l;
    } else {
      const pt = lanePt(c.road, c.forward, c.s, c.lane);
      c.x = pt.x; c.y = pt.y; c.hx = pt.hx; c.hy = pt.hy;
    }
    // On the terrain, pitched to the slope under its wheelbase.
    const reach = c.length * 0.35;
    const hf = terrain.at(c.x + c.hx * reach, c.y + c.hy * reach), hb = terrain.at(c.x - c.hx * reach, c.y - c.hy * reach);
    q.setFromAxisAngle(up, Math.atan2(c.hx, -c.hy)).multiply(qp.setFromAxisAngle(across, -Math.atan2(hf - hb, 2 * reach)));
    c.z = (hf + hb) / 2;
    m4.compose(v.set(c.x, c.z + 0.02, -c.y), q, c.hide ? zero : one);
    meshes[c.type].setMatrixAt(c.slot, m4);
    if (lampsOn) lamps[c.type].setMatrixAt(c.slot, m4);
  };

  const inCorridor = (a: Car, b: Car, reach: number) => {
    const dx = b.x - a.x, dy = b.y - a.y, along = dx * a.hx + dy * a.hy;
    if (along <= 0 || along > reach) return -1;
    return Math.abs(dx * a.hy - dy * a.hx) < (a.width + b.width) / 2 + 0.5 ? along : -1;
  };

  /** Per frame: road cars by lane (sorted by s), cars on each connector (by u),
   * connector cars heading into each lane, and who occupies each intersection box. */
  /** Room (m, from its front) to the nearest other vehicle's body in this one's path: the other's
   * corners in this one's frame, across its width with a little margin, ahead within `reach`. When
   * the two stand in each other's paths (crossing, or already touching) the lower id goes first. */
  const bodies = new Map<number, Car[]>(), NEAR = 24;
  const nearKey = (x: number, y: number) => Math.floor(x / NEAR) * 4096 + Math.floor(y / NEAR);
  /** Where a vehicle's middle will be `d` metres on along its own way — its lane, its connector
   * through the junction, the lane that joins — and its heading there (into `pose`). */
  const pose = { x: 0, y: 0, hx: 1, hy: 0 };
  const connAt = (cn: Conn, u: number) => {
    let i = 1;
    while (i < cn.cum.length - 1 && cn.cum[i] < u) i++;
    const seg = cn.cum[i] - cn.cum[i - 1] || 1, t = Math.max(0, Math.min(1, (u - cn.cum[i - 1]) / seg));
    const dx = cn.xs[i] - cn.xs[i - 1], dy = cn.ys[i] - cn.ys[i - 1], l = Math.hypot(dx, dy) || 1;
    pose.x = cn.xs[i - 1] + dx * t; pose.y = cn.ys[i - 1] + dy * t; pose.hx = dx / l; pose.hy = dy / l;
  };
  const laneAt = (road: number, forward: boolean, sv: number, lane: number) => {
    const p = lanePt(road, forward, sv, lane);
    pose.x = p.x; pose.y = p.y; pose.hx = p.hx; pose.hy = p.hy;
  };
  const poseAhead = (c: Car, d: number) => {
    const cn = c.conn;
    let u: number;
    if (c.inConn) u = c.u + d;
    else { const sv = c.s + d; if (sv <= cn.endS) { laneAt(c.road, c.forward, sv, c.lane); return; } u = sv - cn.endS; }
    if (u <= cn.len) connAt(cn, u); else laneAt(cn.link.road, cn.link.forward, cn.startS + u - cn.len, cn.lane);
  };
  /** Two vehicles' footprints (rectangles about their middles) overlap? (separating axes) */
  const overlap = vehicleOverlap;
  // Each candidate car checks the same one-metre trajectory against many other
  // bodies. Cache those exact double-precision poses until its travel state changes.
  const trajectories = new VehicleTrajectoryCache<Car>();
  /** How far (m) this vehicle can go along its own way before its body meets the other's as it
   * stands (Infinity: not within `reach`); followed along the lane and through the turn it will
   * really take, not straight on from its heading (a turn swept straight on across the waiting
   * cars of the road beside, and stopped in the junction for them). */
  const pathHits = (c: Car, o: Car, reach: number) => {
    if (Math.hypot(o.x - c.x, o.y - c.y) > reach + (c.length + o.length) / 2 + 1) return Infinity;
    for (let d = 0; d <= reach; d += 1) {
      trajectories.read(c, d, pose, poseAhead);
      if (overlap(pose.x, pose.y, pose.hx, pose.hy, c.length, c.width + 0.3, o)) {
        // touching already: only what is ahead of it holds it (one beside or behind pulls clear)
        if (d === 0 && (o.x - c.x) * c.hx + (o.y - c.y) * c.hy <= 0) return Infinity;
        return d;
      }
    }
    return Infinity;
  };
  /** Room (m) to the nearest other vehicle's body on this one's way, and which one. Those in
   * its own lane or on its own connector are left to the car following; two in each other's way
   * (crossing) — the lower id goes first. */
  const bodyAhead = (c: Car, reach: number) => {
    let room = Infinity, by: Car | null = null;
    const r = Math.ceil((reach + c.length) / NEAR), gx = Math.floor(c.x / NEAR), gy = Math.floor(c.y / NEAR);
    for (let i = gx - r; i <= gx + r; i++) for (let j = gy - r; j <= gy + r; j++) {
      for (const o of bodies.get(i * 4096 + j) ?? []) {
        if (o === c || o.manual) continue;
        if (!c.inConn && !o.inConn && o.road === c.road && o.forward === c.forward && o.lane === c.lane) continue;
        if (c.inConn && o.inConn && o.conn === c.conn) continue;
        const d = pathHits(c, o, reach);
        if (d === Infinity || d - 0.5 >= room) continue;
        if (c.id < o.id && pathHits(o, c, Math.max(8, o.speed * 1.6 + o.length)) < Infinity) continue;
        room = Math.max(0, d - 0.5); by = o;
      }
    }
    return { room, by };
  };

  const lanes = new Map<string, Car[]>(), onConn = new Map<string, Car[]>(), intoLane = new Map<string, Car[]>();
  const boxes = new Map<number, Car[]>();
  const push = <K,>(m: Map<K, Car[]>, k: K, c: Car) => { const l = m.get(k); if (l) l.push(c); else m.set(k, [c]); };
  const connCars: Car[] = [], driven: Car[] = [];

  /** Space free on a target lane past where a connector joins it. */
  const exitSpace = (cn: Conn, self: Car) => {
    let space = Infinity;
    for (const o of lanes.get(cn.toKey) ?? []) if (o.s >= cn.startS - o.length) { space = o.s - o.length / 2 - cn.startS; break; }
    for (const o of intoLane.get(cn.toKey) ?? []) if (o !== self) space -= o.length + 2;
    return space;
  };
  /** May this vehicle cross its stop line now? */
  const admit = (c: Car, toStop: number) => {
    const cn = c.conn;
    if (cn.node >= 0) {
      const light = lightAt(cn.node, cn.approach), inBox = boxes.get(cn.node) ?? [];
      if (light === "red") {
        // 적신호 우회전: stop first, then only into an empty box.
        if (!(cn.turn === "right" && c.speed < 0.6 && toStop < 1.5 && inBox.every(o => o === c))) { c.why = "red"; return false; }
      } else if (light === "yellow" && toStop > (c.speed * c.speed) / 10 + 1) { c.why = "yellow"; return false; }
      // One direction in the box at a time (stragglers from the last phase clear first).
      const ph = (k: string | undefined) => (k === undefined ? -1 : signals[cn.node]!.phase.get(k));
      if (inBox.some(o => o !== c && ph(o.inConn ? o.conn.approach : o.arrive?.approach) !== ph(cn.approach))) { c.why = "box"; return false; }
    } else if (cn.giveWay) {
      // An unsignalled junction from a side street: in only when nothing is crossing it and
      // nothing on the main road is coming up to it.
      const cl = clusters[cn.cluster], reach = cl.r + 26;
      const g = Math.ceil(reach / NEAR), gx = Math.floor(cl.x / NEAR), gy = Math.floor(cl.y / NEAR);
      const near: Car[] = [...driven];
      for (let i = gx - g; i <= gx + g; i++) for (let j = gy - g; j <= gy + g; j++) near.push(...(bodies.get(i * 4096 + j) ?? []));
      for (const o of near) {
        if (o === c) continue;
        if (o.inConn && o.conn.cluster === cn.cluster) { c.why = "giveway"; return false; }
        if (!o.inConn && o.conn.giveWay && o.conn.cluster === cn.cluster) continue;   // (waiting on a side street too)
        const dx = cl.x - o.x, dy = cl.y - o.y, dd = Math.hypot(dx, dy);
        if (dd < reach && Math.abs(o.speed) > 0.5 && (dx * o.hx + dy * o.hy) > 0) { c.why = "giveway"; return false; }
      }
    } else if (cn.tJoin) {
      // A side road joins mid-block: wait for a gap in the through traffic, both ways.
      const p = paths[cn.link.road], j = cn.link.forward ? cn.link.s0 : p.len - cn.link.s0;
      for (const [k, list] of lanes) {
        if (!k.startsWith(`${cn.link.road}|`)) continue;
        for (const o of list) {
          const pos = o.forward ? o.s : p.len - o.s, toward = o.forward ? j - pos : pos - j;
          if (toward > -8 && toward < 22) { c.why = "tjoin"; return false; }
        }
      }
    }
    // 꼬리물기 금지: enter only with room to leave the box on the other side.
    if (exitSpace(cn, c) > c.length + 3) return true;
    c.why = "exit";
    return false;
  };

  const plan = (c: Car) => { c.conn = connector(c.road, c.forward, c.lane, choose(c.road, c.forward, c.lane)); c.go = false; };

  /** Car following on each lane and through each junction; stopping at stop lines for
   * red, for a full exit and for crossing traffic. No vehicle closes to less than half a
   * metre of the one ahead, and paths through an intersection never cross (one
   * approach at a time), so nothing overlaps and nothing locks up. */
  const step = (dt: number) => {
    clock += dt;
    lanes.clear(); onConn.clear(); intoLane.clear(); boxes.clear(); connCars.length = 0; driven.length = 0; bodies.clear();
    for (const c of cars) {
      if (!c.manual) { const k = nearKey(c.x, c.y), l = bodies.get(k); if (l) l.push(c); else bodies.set(k, [c]); }
      if (c.manual) driven.push(c);
      else if (c.inConn) {
        push(onConn, c.conn.key, c); push(intoLane, c.conn.toKey, c); connCars.push(c);
        if (c.conn.node >= 0) push(boxes, c.conn.node, c);
      } else {
        push(lanes, laneKey(c.road, c.forward, c.lane), c);
        // In a box: cleared across its stop line, or rear not yet out of the last one.
        if (c.conn.node >= 0 && c.go) { c.arrive = null; push(boxes, c.conn.node, c); }
        // (Half a metre of slack: one stopped in a queue right at the edge must not hold
        // the box for every other direction.)
        else if (c.arrive && c.s - c.length / 2 < c.arrive.startS - 0.5) push(boxes, c.arrive.node, c);
        else c.arrive = null;
      }
    }
    lanes.forEach(l => l.sort((a, b) => a.s - b.s));
    onConn.forEach(l => l.sort((a, b) => a.u - b.u));
    for (const c of cars) {
      if (c.manual) { c.pilot?.(dt); place(c); continue; }
      if (c.stunned && c.stunned > 0) { c.stunned -= dt; c.speed = 0; c.why = "struck"; place(c); continue; }
      const cn = c.conn;
      let room = Infinity;
      c.why = "";
      // A vehicle driven by hand, ahead in this one's path (on the lane or across a junction):
      // stopped for, as for any other.
      for (const o of driven) {
        const al = inCorridor(c, o, Math.max(12, c.speed * 1.8 + c.length));
        if (al >= 0) { room = Math.min(room, al - (o.length + c.length) / 2); c.why = "driver"; }
      }
      const gap = (o: Car, d: number) => d - (o.length + c.length) / 2;
      const firstOnTarget = () => { for (const o of lanes.get(cn.toKey) ?? []) if (o.s >= cn.startS - o.length) return o; return null; };
      if (c.inConn) {
        const list = onConn.get(cn.key)!, ahead = list[list.indexOf(c) + 1];
        if (ahead) room = gap(ahead, ahead.u - c.u);
        else { const f = firstOnTarget(); if (f) room = gap(f, cn.len - c.u + f.s - cn.startS); }
        // Two connectors into one lane (from side-by-side lanes): the one nearer the merge goes
        // first, the other falls in behind it, as if on one lane already.
        const mine = cn.len - c.u;
        for (const o of intoLane.get(cn.toKey) ?? []) {
          if (o === c || o.conn === cn || !o.inConn) continue;
          const theirs = o.conn.len - o.u;
          if (theirs < mine || (theirs === mine && o.id < c.id)) room = Math.min(room, gap(o, mine - theirs));
        }
      } else {
        const list = lanes.get(laneKey(c.road, c.forward, c.lane))!, ahead = list[list.indexOf(c) + 1];
        if (ahead) room = gap(ahead, ahead.s - c.s);
        else {
          const inC = onConn.get(cn.key);
          if (inC?.length) room = gap(inC[0], cn.endS - c.s + inC[0].u);
          else { const f = firstOnTarget(); if (f) room = gap(f, cn.endS - c.s + cn.len + f.s - cn.startS); }
        }
        // Until cleared, the stop line holds (a vehicle already past it on a short road
        // simply waits there). Cleared once its front reaches the line with the way open.
        const toStop = cn.endS - 0.5 - (c.s + c.length / 2);
        if (!c.go) {
          if (toStop < 60 && !admit(c, Math.max(0, toStop))) room = Math.min(room, Math.max(0, toStop));
          else if (toStop < 1.5) c.go = true;
        }
        // Give way to anything already turning across this lane.
        // (Not those merging into this very lane behind it: they follow this vehicle.)
        const reach = Math.max(9, c.speed * 1.6 + c.length), own = laneKey(c.road, c.forward, c.lane);
        for (const o of connCars) {
          if (o.conn.toKey === own) continue;
          const al = inCorridor(c, o, reach);
          if (al >= 0) room = Math.min(room, gap(o, al));
        }
      }
      // Whatever else stands in its way, on any road or connector (two surveyed roads that run
      // over each other, lanes that meet where no junction joins them): never into another body.
      const hit = bodyAhead(c, Math.max(8, c.speed * 1.6 + c.length));
      c.bodyBy = hit.by;
      if (hit.by) {
        // A ring of vehicles each waiting on the next (none could ever move): the lowest id in it
        // goes. (A queue behind a red light is no ring: it ends at the light.)
        let o: Car | null | undefined = hit.by, n = 0, lowest = c.id, ring = false;
        while (o && n++ < 8) { if (o === c) { ring = true; break; } lowest = Math.min(lowest, o.id); o = o.bodyBy; }
        if (!(ring && lowest === c.id)) { room = Math.min(room, hit.room); if (!c.why) c.why = "body"; }
      }
      const want = c.cruise * Math.min(1, Math.max(0, (room - 2) / 16)) * (c.inConn && cn.turn !== "straight" ? 0.6 : 1);
      c.speed = Math.max(0, c.speed + Math.max(-8 * dt, Math.min(2.5 * dt, want - c.speed)));
      const adv = Math.min(c.speed * dt, Math.max(0, room - 0.5));
      if (c.inConn) {
        c.u += adv;
        if (c.u >= cn.len) {
          const over = c.u - cn.len;
          c.road = cn.link.road; c.forward = cn.link.forward; c.lane = cn.lane; c.s = cn.startS + over;
          c.inConn = false; c.u = 0;
          c.arrive = cn.node >= 0 ? { node: cn.node, startS: cn.startS, approach: cn.approach } : null;
          plan(c);
        }
      } else {
        c.s += adv;
        if (c.s >= cn.endS && c.go) { c.inConn = true; c.u = c.s - cn.endS; }
      }
      place(c);
    }
  };
  cars.forEach(place);
  meshes.forEach(m => { m.instanceMatrix.needsUpdate = true; });

  // ---- Signal heads: Korean 4-colour horizontal (적·황·좌회전 화살표·녹), one per
  // approach on a pole at the right kerb of the stop line, arm over the lanes. ----
  const heads: { ni: number; key: string; light: Light | null }[] = [];
  const headMats: THREE.Matrix4[] = [];
  const staticParts: THREE.BufferGeometry[] = [];
  const colored = (g: THREE.BufferGeometry, color: string, m: THREE.Matrix4) => {
    const out = g.clone().applyMatrix4(m).toNonIndexed();
    const c = new THREE.Color(color), n = out.getAttribute("position").count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    out.deleteAttribute("uv");
    return out;
  };
  const poleG = new THREE.CylinderGeometry(0.1, 0.14, 6.6, 8); poleG.translate(0, 3.3, 0);
  const housingG = new THREE.BoxGeometry(1.5, 0.42, 0.3);
  const visorG = new THREE.BoxGeometry(1.5, 0.05, 0.22);
  const lensG = new THREE.CylinderGeometry(0.14, 0.14, 0.04, 18); lensG.rotateX(Math.PI / 2);
  const arrowShape = new THREE.Shape();
  // Pointing along +x (the driver's left), in the lamp's face.
  arrowShape.moveTo(0.13, 0); arrowShape.lineTo(0.02, 0.09); arrowShape.lineTo(0.02, 0.035); arrowShape.lineTo(-0.12, 0.035);
  arrowShape.lineTo(-0.12, -0.035); arrowShape.lineTo(0.02, -0.035); arrowShape.lineTo(0.02, -0.09); arrowShape.closePath();
  const arrowG = new THREE.ExtrudeGeometry(arrowShape, { depth: 0.02, bevelEnabled: false });
  const LAMP_X = [0.54, 0.18, -0.18, -0.54]; // red, yellow, arrow, green: red on the driver's left
  const basis = new THREE.Matrix4(), tm = new THREE.Matrix4();
  // (an intersection a slice: all the heads at once were ~50 ms of a frame)
  for (let ni = 0; ni < clusters.length; ni++) {
    if (!signals[ni]) continue;
    await frameSlice();
    for (const e of clusterEnds[ni]) {
      const road = e.road, forward = !e.atStart, p = paths[road];
      const [hx, hy] = headingIn(road, forward);
      // Korean practice: the signal for an approach stands across the junction, beyond the far
      // crossing, on the approaching driver's right, its arm over the lanes it faces. With no road
      // straight on (a T), at the near corner by the stop line.
      const rx = hy, ry = -hx; // right of travel
      let px: number, py: number, hw = p.width / 2;
      let straight: { road: number; atStart: boolean } | null = null, bestDot = 0.75;
      for (const o of clusterEnds[ni]) {
        if (o.road === road && o.atStart === e.atStart) continue;
        const [ox, oy] = headingIn(o.road, o.atStart);   // leaving the junction by o
        const dot = ox * hx + oy * hy;
        if (dot > bestDot) { bestDot = dot; straight = o; }
      }
      if (straight) {
        const q = paths[straight.road], lay = layout.get(`${straight.road}:${straight.atStart}`);
        const out = Math.min((lay ? lay.crossB : trim(straight.road, straight.atStart)) + 1.2, q.len * 0.5);
        const far = at(q, straight.atStart ? out : q.len - out);
        hw = q.width / 2;
        px = far.x + rx * (hw + 0.9); py = far.y + ry * (hw + 0.9);
      } else {
        const lay = layout.get(`${road}:${e.atStart}`);
        const tr = Math.min((lay ? lay.stopA : trim(road, e.atStart)), p.len * 0.5), stop = at(p, e.atStart ? tr : p.len - tr);
        px = stop.x + rx * (hw + 0.9); py = stop.y + ry * (hw + 0.9);
      }
      const armLen = Math.min(hw + 0.9, Math.max(2.5, hw * 0.7));
      const hxW = px - rx * armLen, hyW = py - ry * armLen; // head over the lanes
      // Basis: X = driver's left, Y = up, Z = travel direction (the face looks back at traffic).
      const L = new THREE.Vector3(-hy, 0, -hx), U = new THREE.Vector3(0, 1, 0), H = new THREE.Vector3(hx, 0, -hy);
      const gy = terrain.at(px, py) + KERB_H;
      staticParts.push(colored(poleG, "#6b7076", tm.makeTranslation(px, gy, -py)));
      const armG = new THREE.BoxGeometry(0.1, 0.1, armLen);
      const armAt = new THREE.Matrix4().makeBasis(L.clone().negate().cross(U).negate(), U, L.clone().negate()).setPosition((px + hxW) / 2, gy + 6.45, -(py + hyW) / 2);
      staticParts.push(colored(armG, "#6b7076", armAt)); armG.dispose();
      basis.makeBasis(L, U, H).setPosition(hxW, gy + 6.2, -hyW);
      staticParts.push(colored(housingG, "#16181b", basis));
      staticParts.push(colored(visorG, "#16181b", tm.copy(basis).multiply(new THREE.Matrix4().makeTranslation(0, 0.23, -0.2))));
      for (const x of LAMP_X) staticParts.push(colored(lensG, "#2a2c2f", tm.copy(basis).multiply(new THREE.Matrix4().makeTranslation(x, 0, -0.16))));
      heads.push({ ni, key: `${road}:${e.atStart}`, light: null });
      headMats.push(basis.clone());
    }
  }
  const signalMeshes: THREE.Mesh[] = [];
  const litMeshes: THREE.InstancedMesh[] = [];
  const signalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 });
  const litMats = ["#ff2a1a", "#ffb400", "#19e07a", "#19e07a"].map(c => new THREE.MeshStandardMaterial({ color: "#000000", emissive: c, emissiveIntensity: 4, roughness: 0.4 }));
  if (heads.length) {
    const merged = mergeGeometries(staticParts, false)!;
    staticParts.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(merged, signalMat);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    signalMeshes.push(mesh);
    const disc = lensG.clone();
    const shapes = [disc, disc, arrowG, disc];
    for (let k = 0; k < 4; k++) {
      const im = new THREE.InstancedMesh(shapes[k], litMats[k], heads.length);
      im.frustumCulled = false;
      group.add(im);
      litMeshes.push(im);
    }
  }
  const off = new THREE.Matrix4().makeScale(0, 0, 0);
  const lampOffset = LAMP_X.map((x, k) => new THREE.Matrix4().makeTranslation(x, 0, k === 2 ? -0.2 : -0.185));
  /** Light each head for its approach: green with the left arrow, yellow, or red. */
  const showSignals = () => {
    let dirty = false;
    heads.forEach((h, i) => {
      const light = lightAt(h.ni, h.key);
      if (light === h.light) return;
      h.light = light; dirty = true;
      const on = [light === "red", light === "yellow", light === "green", light === "green"];
      for (let k = 0; k < 4; k++) litMeshes[k].setMatrixAt(i, on[k] ? tm.copy(headMats[i]).multiply(lampOffset[k]) : off);
    });
    if (dirty) litMeshes.forEach(m => { m.instanceMatrix.needsUpdate = true; });
  };
  showSignals();
  // ---- Navigation: the shortest way along the roads between two points (Dijkstra over the road
  // ends; the nodes of one intersection joined across it). ----
  const nearestOnRoad = (x: number, y: number) => {
    let best = { road: -1, d: 0, dist: Infinity };
    paths.forEach((p, road) => {
      if (idle[road]) return;
      for (let i = 1; i < p.line.length; i++) {
        const [ax, ay] = p.line[i - 1], [bx, by] = p.line[i], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)), dist = Math.hypot(x - ax - dx * t, y - ay - dy * t);
        if (dist < best.dist) best = { road, d: p.cum[i - 1] + Math.sqrt(l2) * t, dist };
      }
    });
    return best.road < 0 ? null : best;
  };
  /** A road's centreline from d0 to d1 (either way along it). */
  const along = (road: number, d0: number, d1: number) => {
    const p = paths[road], out: [number, number][] = [], pt = (d: number) => { const a = at(p, d); return [a.x, a.y] as [number, number]; };
    out.push(pt(d0));
    if (d1 >= d0) { for (let i = 1; i < p.line.length - 1; i++) if (p.cum[i] > d0 && p.cum[i] < d1) out.push(p.line[i]); }
    else for (let i = p.line.length - 2; i >= 1; i--) if (p.cum[i] < d0 && p.cum[i] > d1) out.push(p.line[i]);
    out.push(pt(d1));
    return out;
  };
  // edges: each road both ways between its end nodes; the nodes of a cluster to each other
  const adj: { to: number; w: number; road: number; fwd: boolean }[][] = nodes.map(() => []);
  paths.forEach((p, road) => {
    if (idle[road]) return;
    const a = nodeOf.get(`${road}:true`)!, b = nodeOf.get(`${road}:false`)!;
    adj[a].push({ to: b, w: p.len, road, fwd: true }); adj[b].push({ to: a, w: p.len, road, fwd: false });
  });
  clusters.forEach(c => { for (const i of c.nodes) for (const j of c.nodes) if (i !== j) adj[i].push({ to: j, w: Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y), road: -1, fwd: true }); });
  const route = (ax: number, ay: number, bx: number, by: number) => {
    const s = nearestOnRoad(ax, ay), e = nearestOnRoad(bx, by);
    if (!s || !e) return null;
    if (s.road === e.road) return { line: along(s.road, s.d, e.d), end: [bx, by] as [number, number] };
    const ps = paths[s.road], pe = paths[e.road];
    const dist = new Float64Array(nodes.length).fill(Infinity), prev: ({ from: number; road: number; fwd: boolean } | null)[] = nodes.map(() => null), done = new Uint8Array(nodes.length);
    const sa = nodeOf.get(`${s.road}:true`)!, sb = nodeOf.get(`${s.road}:false`)!;
    dist[sa] = s.d; dist[sb] = Math.min(dist[sb], ps.len - s.d);
    for (;;) {
      let u = -1;
      for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0) break;
      done[u] = 1;
      for (const ed of adj[u]) if (dist[u] + ed.w < dist[ed.to]) { dist[ed.to] = dist[u] + ed.w; prev[ed.to] = { from: u, road: ed.road, fwd: ed.fwd }; }
    }
    const ea = nodeOf.get(`${e.road}:true`)!, eb = nodeOf.get(`${e.road}:false`)!;
    const viaA = dist[ea] + e.d, viaB = dist[eb] + pe.len - e.d;
    if (!Number.isFinite(Math.min(viaA, viaB))) return null;
    const last = viaA <= viaB ? ea : eb;
    // back from the last node to the start's
    const chain: { from: number; road: number; fwd: boolean }[] = [];
    for (let n = last; prev[n]; n = prev[n]!.from) { chain.unshift(prev[n]!); if (chain.length > nodes.length) break; }
    const first = chain.length ? chain[0].from : last;
    const line: [number, number][] = [...along(s.road, s.d, first === sa ? 0 : ps.len)];
    for (const ed of chain) {
      if (ed.road < 0) continue;   // (across an intersection: straight to the next road's end)
      const p = paths[ed.road];
      line.push(...(ed.fwd ? along(ed.road, 0, p.len) : along(ed.road, p.len, 0)));
    }
    line.push(...along(e.road, last === ea ? 0 : pe.len, e.d));
    // (consecutive duplicates out)
    const clean = line.filter((q, i) => i === 0 || Math.hypot(q[0] - line[i - 1][0], q[1] - line[i - 1][1]) > 0.3);
    return { line: clean, end: [bx, by] as [number, number] };
  };

  group.userData.traffic = { cars, paths, nodes, nodeOf, trimAt, clusters, idle, internal, drawn: roads.length }; // inspection in dev tools

  return {
    group,
    /** eye: the camera's world position (the cars near it get their modelled mesh). */
    update(dt: number, eye?: THREE.Vector3) {
      step(Math.min(0.1, dt));
      turnWheels(Math.min(0.1, dt));
      swapNear(eye);
      showSignals();
      meshes.forEach(m => { m.instanceMatrix.needsUpdate = true; });
      if (lampsOn) lamps.forEach(m => { m.instanceMatrix.needsUpdate = true; });
    },
    /** The roads as the traffic drives them, and each junction arm's crossing and stop line —
     * the road markings are laid from these, so line, signal and stopping point agree. */
    arms: { roads: paths as RealEstateRoad[], at: (road: number, atStart: boolean) => layout.get(`${road}:${atStart}`) ?? null, inside: (road: number) => internal[road] },
    /** The height of the surface the traffic drives on (the road's ground, a bridge's deck). */
    groundAt: (x: number, y: number) => terrain.at(x, y),
    /** A followed vehicle as it is now (footprint frame), or null. */
    hero(name: HeroName) { return heroes.get(name) ?? null; },
    /** Bring a followed vehicle onto the lane nearest (x, y) — where the reader is looking —
     * heading on with the traffic from there. */
    summon(name: HeroName, x: number, y: number, hx?: number, hy?: number) {
      const c = heroes.get(name);
      if (!c) return false;
      c.manual = false; c.hide = false; c.steer = 0; c.pilot = undefined;
      let best: { road: number; s: number; forward: boolean; d: number } | null = null;
      paths.forEach((p, road) => {
        if (idle[road] || p.len < c.length + 12) return;
        for (let i = 1; i < p.line.length; i++) {
          const [ax, ay] = p.line[i - 1], [bx, by] = p.line[i], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)), d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
          // (heading as asked, when asked: one handed back from its driver goes on the way it faced)
          const fwd = hx !== undefined && hy !== undefined ? dx * hx + dy * hy >= 0 : rnd() < 0.5;
          if (!best || d < best.d) best = { road, s: p.cum[i - 1] + Math.sqrt(l2) * t, forward: fwd, d };
        }
      });
      if (!best) return false;
      const b = best as { road: number; s: number; forward: boolean };
      const p = paths[b.road], s = b.forward ? b.s : p.len - b.s;
      c.road = b.road; c.forward = b.forward; c.lane = 0; c.inConn = false; c.u = 0; c.go = false; c.arrive = null;
      plan(c);
      const s0 = startOf(c.road, c.forward), lo = s0 + c.length / 2, hi = c.conn.endS - c.length / 2 - 1;
      // (a free gap on the lane, near where it was asked for: never on top of another vehicle)
      const free = (at: number) => !cars.some(o => o !== c && !o.inConn && o.road === c.road && o.forward === c.forward && o.lane === c.lane && Math.abs(o.s - at) < (o.length + c.length) / 2 + 4);
      let at = Math.max(lo, Math.min(hi, s));
      for (let k = 1; k < 24 && !free(at); k++) at = Math.max(lo, Math.min(hi, s + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 6));
      c.s = at;
      c.speed = c.cruise * 0.5;
      place(c);
      turnWheels(0);
      return true;
    },
    /** Take a followed vehicle into the driver's hands (it stops following its lane; the others
     * give way to it), or hand it back to the traffic on the lane nearest where it was left. */
    drive(name: HeroName, on: boolean) {
      const c = heroes.get(name);
      if (!c) return null;
      if (on) { c.manual = true; c.inConn = false; return c; }
      if (c.manual) this.summon(name, c.x, c.y, c.hx, c.hy);
      return c;
    },
    /** A followed vehicle's model (its geometry, wheels), for its wreck. */
    heroShape(name: HeroName) { const c = heroes.get(name); return c ? heroShape.get(c.type) ?? null : null; },
    /** The way along the roads from (ax, ay) to (bx, by): a polyline, or null where none joins them. */
    route,
    /** More detail while driving: the modelled vehicles and plates out to these distances. */
    setDetail(nearM: number, plateM: number) { NEAR_M = nearM; PLATE_M = plateM; },
    /** The vehicles within r of (x, y) (for the driven one's collisions). */
    near(x: number, y: number, r: number) {
      const out: Car[] = [];
      for (const c of cars) if (Math.abs(c.x - x) < r && Math.abs(c.y - y) < r) out.push(c);
      return out;
    },
    /** A followed vehicle's placement this frame (world matrix within the traffic's group). */
    heroMatrix(name: HeroName, out: THREE.Matrix4) {
      const c = heroes.get(name);
      if (!c) return null;
      const hide = c.hide; c.hide = false; place(c); meshes[c.type].getMatrixAt(c.slot, out); c.hide = hide; place(c);
      return out;
    },
    /** Head and tail lamps from dusk (Look.lamps: 0 by day). */
    setLamps(level: number) {
      const on = level > 0.25;
      lampMat.emissiveIntensity = level * 5;
      if (on === lampsOn) return;
      lampsOn = on;
      lamps.forEach(m => { m.visible = on; });
      if (on) { cars.forEach(place); lamps.forEach(m => { m.instanceMatrix.needsUpdate = true; }); }
    },
    dispose() {
      [...meshes, ...lamps].forEach(m => m.dispose());
      near.forEach(m => m?.dispose()); modelMat?.dispose();
      plates.forEach(m => m.dispose()); plateGeos.forEach(g => g.dispose()); plateMat.dispose();
      kinds.forEach(k => { if (k.own) k.geo.dispose(); }); heroWheels.forEach(hw => { hw.im.dispose(); hw.h.wheel.dispose(); });
      lampGeos.forEach(g => g.dispose());
      [poleG, housingG, visorG, lensG, arrowG].forEach(g => g.dispose());
      signalMeshes.forEach(m => m.geometry.dispose());
      litMeshes.forEach(m => { if (m.geometry !== arrowG) m.geometry.dispose(); m.dispose(); });
      [signalMat, ...litMats].forEach(m => m.dispose());
      bodyMat.dispose(); boxMat.dispose(); lampMat.dispose(); heroMats.forEach(m => { (m as THREE.MeshStandardMaterial).map?.dispose(); m.dispose(); });
    },
  };
}
