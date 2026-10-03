import * as THREE from "three";
import type { RealEstateBuilding } from "../api/client";

const SINK = 3;
export function compactExtrude(b: RealEstateBuilding, ground = 0, floorM = 2.9): THREE.BufferGeometry {
  const depth = Math.max(2, b.height - b.base), below = b.base > 0 ? 0 : SINK;
  const z0 = ground + b.base - below, z1 = ground + b.base + depth;
  const k = THREE.MathUtils.clamp(floorM / (depth / Math.max(1, b.floors)), 0.5, 2);
  const area = (r: [number, number][]) => r.reduce((sum, [x1, y1], i) => { const [x2, y2] = r[(i + 1) % r.length]; return sum + x1 * y2 - x2 * y1; }, 0);
  const outer = area(b.rings[0]) >= 0 ? b.rings[0] : [...b.rings[0]].reverse();
  const holes = b.rings.slice(1).map(h => (area(h) <= 0 ? h : [...h].reverse()));
  const P: number[] = [], N: number[] = [], U: number[] = [], I: number[] = [];
  for (const ring of [outer, ...holes]) for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
    const ex = bx - ax, ey = by - ay, el = Math.hypot(ex, ey);
    if (el < 1e-4) continue;
    const nx = ey / el, ny = -ex / el, alongX = Math.abs(ey) < Math.abs(ex), v = P.length / 3;
    for (const [x, y, z] of [[ax, ay, z0], [bx, by, z0], [bx, by, z1], [ax, ay, z1]]) { P.push(x, y, z); N.push(nx, ny, 0); U.push(alongX ? x : y, (1 - (z - ground)) * k); }
    I.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }
  const roof = P.length / 3, pts = [...outer, ...holes.flat()];
  for (const [x, y] of pts) { P.push(x, y, z1); N.push(0, 0, 1); U.push(x, y); }
  const tris = THREE.ShapeUtils.triangulateShape(outer.map(([x, y]) => new THREE.Vector2(x, y)), holes.map(h => h.map(([x, y]) => new THREE.Vector2(x, y))));
  for (const [a, c, d] of tris) I.push(roof + a, roof + c, roof + d);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
  geo.setIndex(I);
  return geo;
}

export interface NeighbourJob {
  building: RealEstateBuilding;
  ground: number;
  floorM: number;
  color: [number, number, number];
}
export interface NeighbourArrays {
  position: Float32Array; normal: Float32Array; uv: Float32Array;
  color: Float32Array; index: Uint16Array | Uint32Array;
}
/** Preserve the original indexed geometry and float32 rounding off the UI thread. */
export function neighbourArrays(job: NeighbourJob): NeighbourArrays {
  const geo = compactExtrude(job.building, job.ground, job.floorM);
  const count = geo.getAttribute('position').count, color = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) color.set(job.color, i * 3);
  const out = { position: geo.getAttribute('position').array as Float32Array,
    normal: geo.getAttribute('normal').array as Float32Array,
    uv: geo.getAttribute('uv').array as Float32Array,
    color, index: geo.index!.array as Uint16Array | Uint32Array };
  geo.dispose();
  return out;
}
export function neighbourGeometry(arrays: NeighbourArrays): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arrays.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(arrays.normal, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(arrays.uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(arrays.color, 3));
  geo.setIndex(new THREE.BufferAttribute(arrays.index, 1));
  return geo;
}
