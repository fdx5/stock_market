import * as THREE from 'three';
import type { RealEstateBuilding } from '../../api/client';

/** Synthesized facade relief, never presented as surveyed balcony geometry, laid on the
 * facade tile it stands in front of (complexScene facadeSteps through ExtrudeGeometry's
 * world uvs: u = x or y by the wall's run, v = 1 − z; 8 bays of `bay` m across, 8 storeys
 * of `storey` m up, the slab band at the bottom 10 % of each storey cell): a slab ledge on
 * every painted slab band, and a fin on every bay edge of the long faces (the short end
 * walls stay flat). Out of step with the paint they read as a cage in front of the windows.
 * Returns unit-box transforms (footprint frame): one instanced draw for every tower. */
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

export function facadeRelief(building: RealEstateBuilding, out: THREE.Matrix4[], limit: number, bay = 3.2, storey = 2.9) {
  const ring = building.rings[0];
  const object = new THREE.Object3D();
  let area = 0, longest = 0;
  ring.forEach(([x, y], i) => {
    const q = ring[(i + 1) % ring.length];
    area += x * q[1] - q[0] * y;
    longest = Math.max(longest, Math.hypot(q[0] - x, q[1] - y));
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
      object.position.set((x + qx) / 2 + nx * 0.14, (y + qy) / 2 + ny * 0.14, z + 0.05 * s);
      object.scale.set(length, 0.28, 0.1 * s);
      object.updateMatrix(); out.push(object.matrix.clone());
    }
    // Fins on the long faces only, where the tile's u (x or y, by the wall's run) crosses
    // a whole number of bays: between the windows, never across them.
    if (length < Math.max(8, longest * 0.5)) continue;
    const alongX = Math.abs(qx - x) > Math.abs(qy - y);
    const a0 = alongX ? x : y, a1 = alongX ? qx : qy;
    const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
    for (let u = Math.ceil((lo + 0.3) / bay) * bay; u < hi - 0.3 && out.length < limit; u += bay) {
      const t = (u - a0) / (a1 - a0);
      object.position.set(x + (qx - x) * t + nx * 0.14, y + (qy - y) * t + ny * 0.14, (z0 + z1) / 2);
      object.scale.set(0.14, 0.28, z1 - z0);
      object.updateMatrix(); out.push(object.matrix.clone());
    }
  }
}
