import * as THREE from 'three';
import type { RealEstateBuilding } from '../../api/client';

/** The end walls (측벽) of a slab tower: faces square to its long axis (the longest edge's
 * run) at either extreme of it. A stepped front's short segments run along the axis and
 * are no end walls, nor are the small returns between the steps (short, and inside). */
export function endWalls(ring: [number, number][]): Set<number> {
  let longest = 0, ax = 1, ay = 0;
  ring.forEach(([x, y], i) => {
    const [qx, qy] = ring[(i + 1) % ring.length], len = Math.hypot(qx - x, qy - y);
    if (len > longest) { longest = len; ax = (qx - x) / len; ay = (qy - y) / len; }
  });
  const along = ring.map(([x, y]) => x * ax + y * ay), lo = Math.min(...along), hi = Math.max(...along);
  const out = new Set<number>();
  ring.forEach(([x, y], i) => {
    const [qx, qy] = ring[(i + 1) % ring.length], len = Math.hypot(qx - x, qy - y);
    if (len < 5 || len > 24 || len > longest * 0.6) return;
    const nx = -(qy - y) / len, ny = (qx - x) / len;
    if (Math.abs(nx * ax + ny * ay) < 0.9) return;
    const m = ((x + qx) / 2) * ax + ((y + qy) / 2) * ay;
    if (m - lo < 3.5 || hi - m < 3.5) out.add(i);
  });
  return out;
}

/** A thin slab ledge on every painted slab band of a modelled tower's window faces (never
 * the end walls, never past a corner), laid on the facade tile it stands in front of
 * (ComplexHologram extrude uvs). No fins or rails: bars over the fronts read as scaffolding.
 * Returns unit-box transforms (footprint frame): one instanced draw for every tower. */
export function facadeRelief(building: RealEstateBuilding, out: THREE.Matrix4[], limit: number, storey = 2.9) {
  const ring = building.rings[0];
  const object = new THREE.Object3D();
  let area = 0;
  ring.forEach(([x, y], i) => {
    const q = ring[(i + 1) % ring.length];
    area += x * q[1] - q[0] * y;
  });
  const sign = area >= 0 ? 1 : -1;
  const z0 = building.base + 2.4, z1 = building.height - 0.5;
  // Slab bands. The modelled towers' walls (ComplexHologram extrude) stretch the tile to
  // the registered storey: v = (1 − (z − ground))·k, k = storey / (height / floors) clamped
  // to 0.5..2; with the tile's offset (1 − GROUND_M) / storey the bands sit at
  // z = ground + 1 + s·(m + c), s = storey / k, c = (1 − GROUND_M) / storey.
  const floors = Math.max(1, building.floors);
  const k = THREE.MathUtils.clamp(storey / ((building.height - building.base) / floors), 0.5, 2);
  const s = storey / k, c = (1 - 1.5) / storey, ground = building.base;
  const slabs: number[] = [];
  for (let m = Math.ceil((z0 - ground - 1) / s - c); ground + 1 + s * (m + c) < z1; m++) slabs.push(ground + 1 + s * (m + c));
  // (the end walls are blank on the real blocks: no slab ledges across them)
  const ends = endWalls(ring);
  for (let i = 0; i < ring.length && out.length < limit; i++) {
    const [x, y] = ring[i], [qx, qy] = ring[(i + 1) % ring.length];
    const length = Math.hypot(qx - x, qy - y);
    if (length < 5 || ends.has(i)) continue;
    const dx = (qx - x) / length, dy = (qy - y) / length;
    const nx = dy * sign, ny = -dx * sign;   // outward
    object.rotation.set(0, 0, Math.atan2(dy, dx));
    // Projecting slab ledges catch direct light and cast true narrow shadows.
    for (const z of slabs) {
      if (out.length >= limit) break;
      // (inside the face's ends: a ledge running past a corner reads as a bare frame)
      object.position.set((x + qx) / 2 + nx * 0.14, (y + qy) / 2 + ny * 0.14, z + 0.05 * s);
      object.scale.set(Math.max(0, length - 0.6), 0.28, 0.1 * s);
      object.updateMatrix(); out.push(object.matrix.clone());
    }
    // (no fins: bars down the fronts read as scaffolding)
  }
}
