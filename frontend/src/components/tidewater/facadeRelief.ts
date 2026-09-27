import * as THREE from 'three';
import type { RealEstateBuilding } from '../../api/client';

/** Synthesized facade relief, never presented as surveyed balcony geometry: floor
 * ledges at the registered floor count and vertical bay lines. Returns unit-box
 * transforms (footprint frame) so every tower of a complex shares one instanced draw. */
export function facadeRelief(building: RealEstateBuilding, out: THREE.Matrix4[], limit: number) {
  const ring = building.rings[0];
  const floors = Math.min(80, Math.max(1, building.floors));
  const floorHeight = (building.height - building.base) / floors;
  if (floorHeight < 1.8 || floorHeight > 5) return;
  const object = new THREE.Object3D();
  let area = 0;
  ring.forEach(([x, y], i) => { const q = ring[(i + 1) % ring.length]; area += x * q[1] - q[0] * y; });
  const sign = area >= 0 ? 1 : -1;
  for (let i = 0; i < ring.length && out.length < limit; i++) {
    const [x, y] = ring[i], [qx, qy] = ring[(i + 1) % ring.length];
    const length = Math.hypot(qx - x, qy - y);
    if (length < 5) continue;
    const dx = (qx - x) / length, dy = (qy - y) / length;
    object.rotation.z = Math.atan2(dy, dx);
    // Projecting floor ledges catch direct light and cast true narrow shadows.
    for (let f = 1; f <= floors && out.length < limit; f++) {
      object.position.set((x + qx) / 2 + dy * sign * 0.12, (y + qy) / 2 - dx * sign * 0.12, building.base + f * floorHeight);
      object.scale.set(length, 0.45, f === floors ? 0.32 : 0.14);
      object.updateMatrix(); out.push(object.matrix.clone());
    }
    // Vertical window bays add depth without thousands of individual meshes.
    const bays = Math.min(24, Math.floor(length / 3.6));
    for (let j = 1; j < bays && out.length < limit; j++) {
      const t = j / bays;
      object.position.set(x + (qx - x) * t + dy * sign * 0.10, y + (qy - y) * t - dx * sign * 0.10, (building.base + building.height) / 2);
      object.scale.set(0.18, 0.36, building.height - building.base);
      object.updateMatrix(); out.push(object.matrix.clone());
    }
  }
}
