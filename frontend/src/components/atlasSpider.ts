import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Eight articulated, weight-bearing legs. Gait advances by distance, never by idle time. */
export function createAtlasSpider(scene: T.Scene, variant: number, detailed: boolean, accent: string) {
  const group = new T.Group(), body = new T.Group(); group.add(body); scene.add(group);
  const shell = new T.MeshPhysicalMaterial({ color: "#33434b", metalness: .72, roughness: .29, clearcoat: .95, clearcoatRoughness: .2 });
  const graphite = new T.MeshStandardMaterial({ color: "#0d151b", metalness: .5, roughness: .38 });
  const steel = new T.MeshStandardMaterial({ color: "#a0aeb9", metalness: .9, roughness: .24 });
  const copper = new T.MeshStandardMaterial({ color: variant === 1 ? "#8163a6" : variant === 2 ? "#98645c" : "#497b89", metalness: .8, roughness: .3 });
  const optic = new T.MeshPhysicalMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.1, metalness: .28, roughness: .12, clearcoat: 1 });
  const batches = new Map<T.Material, T.BufferGeometry[]>();
  function part(geometry: T.BufferGeometry, material: T.Material, x: number, y: number, z: number, scale: [number, number, number] = [1, 1, 1], rotation: [number, number, number] = [0, 0, 0]) {
    const transform = new T.Object3D(); transform.position.set(x, y, z); transform.scale.set(...scale); transform.rotation.set(...rotation); transform.updateMatrix(); geometry.applyMatrix4(transform.matrix);
    const list = batches.get(material) || []; list.push(geometry); batches.set(material, list);
  }
  const sphere = (r: number) => new T.SphereGeometry(r, detailed ? 36 : 22, detailed ? 24 : 16);
  // Teardrop abdomen, plated cephalothorax, neck and paired forward fangs.
  part(sphere(1), shell, -10, 0, 9, [13.5, 9.4, 7.5]);
  part(sphere(1), graphite, -6, 0, 4.4, [12, 8.6, 3.5]);
  part(sphere(1), shell, 7, 0, 9, [10.2, 7.9, 5.3]);
  part(sphere(1), copper, 0, 0, 8, [4.4, 5.5, 3.8]);
  // Overlapping armor ribs on the abdomen leave dark seams and catch the rim light.
  for (let i = 0; i < 7; i++) {
    const x = -20 + i * 3.2, span = Math.sqrt(Math.max(.05, 1 - ((x + 10) / 14) ** 2));
    part(new T.TorusGeometry(1, .045, 5, 36), i % 2 ? graphite : copper, x, 0, 9, [1, 9.5 * span, 7.6 * span], [0, Math.PI / 2, 0]);
  }
  part(new T.BoxGeometry(13, .75, .5), steel, -9, 0, 16.4);
  for (const side of [-1, 1]) {
    part(sphere(1), graphite, 16.1, side * 3, 7, [3.2, 2.2, 2.5]);
    part(new T.ConeGeometry(1.3, 6, 12), steel, 18.7, side * 3.2, 4.6, [1, 1, 1], [0, 0, -Math.PI / 2 + side * .22]);
    part(sphere(1), shell, 13.7, side * 6.5, 7, [4.8, 1.3, 1.6]);
  }
  // Eight glassy eyes, two large principal eyes and six smaller lateral sensors.
  const eyes = [[14, -2.4, 12.2, 2.1], [14, 2.4, 12.2, 2.1], [11.5, -5.1, 11.4, 1.25], [11.5, 5.1, 11.4, 1.25], [7.4, -6.8, 10.8, 1], [7.4, 6.8, 10.8, 1], [3.3, -6.5, 11.2, .9], [3.3, 6.5, 11.2, .9]];
  for (const [x, y, z, r] of eyes) { part(sphere(r * 1.2), graphite, x, y, z); part(sphere(r), optic, x + .3, y, z + .55); part(sphere(r * .27), steel, x + .1, y - .35, z + r * .94); }
  // Fine abdominal setae; these are geometry, so they remain sharp at any DPR.
  const hairs: number[] = [];
  for (let i = 0; i < (detailed ? 520 : 220); i++) {
    const a = i * 2.399963, v = 1 - 2 * (i + .5) / (detailed ? 520 : 220), s = Math.sqrt(1 - v * v);
    const normal = new T.Vector3(s * Math.cos(a), s * Math.sin(a), v), p = normal.clone().multiply(new T.Vector3(13.6, 9.5, 7.6)).add(new T.Vector3(-10, 0, 9));
    const q = p.clone().addScaledVector(normal, .75 + .65 * Math.sin(i * 7.13) ** 2); hairs.push(...p.toArray(), ...q.toArray());
  }
  const fuzz = new T.BufferGeometry(); fuzz.setAttribute("position", new T.Float32BufferAttribute(hairs, 3)); body.add(new T.LineSegments(fuzz, new T.LineBasicMaterial({ color: "#88949b", transparent: true, opacity: .5 })));
  batches.forEach((geometries, material) => { const merged = mergeGeometries(geometries, false)!; geometries.forEach(g => g.dispose()); body.add(new T.Mesh(merged, material)); });
  const segments = new T.InstancedMesh(new T.CylinderGeometry(.85, 1.2, 1, detailed ? 12 : 8), shell, 24);
  const tendons = new T.InstancedMesh(new T.CylinderGeometry(.33, .48, 1, 7), graphite, 24);
  const joints = new T.InstancedMesh(sphere(1), copper, 32);
  const cuffs = new T.InstancedMesh(new T.CylinderGeometry(1.02, 1.02, .055, 10), steel, 24);
  [segments, tendons, joints, cuffs].forEach(mesh => { mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.frustumCulled = false; group.add(mesh); });
  // A soft contact shadow grounds the feet instead of presenting a flying object.
  for (let i = 0; i < 3; i++) { const shadow = new T.Mesh(new T.CircleGeometry(1, 48), new T.MeshBasicMaterial({ color: "#01050a", transparent: true, opacity: .13, depthWrite: false })); shadow.scale.set(28 - i * 5, 21 - i * 4, 1); shadow.position.z = -.8 + i * .1; group.add(shadow); }
  const transform = new T.Object3D(), axis = new T.Vector3(0, 1, 0), direction = new T.Vector3();
  const feet = [new T.Vector3(30, 25, 0), new T.Vector3(14, 32, 0), new T.Vector3(-13, 32, 0), new T.Vector3(-30, 23, 0)];
  function bone(mesh: T.InstancedMesh, index: number, a: T.Vector3, b: T.Vector3, radius: number) { direction.subVectors(b, a); transform.position.copy(a).add(b).multiplyScalar(.5); transform.quaternion.setFromUnitVectors(axis, direction.clone().normalize()); transform.scale.set(radius, direction.length(), radius); transform.updateMatrix(); mesh.setMatrixAt(index, transform.matrix); }
  function joint(index: number, p: T.Vector3, radius: number) { transform.position.copy(p); transform.quaternion.identity(); transform.scale.setScalar(radius); transform.updateMatrix(); joints.setMatrixAt(index, transform.matrix); }
  function update(distance: number, walking: boolean, time: number) {
    const gait = distance / 28, stride = walking ? 11 : 0;
    body.position.z = walking ? Math.sin(gait * Math.PI * 4) * .45 : 0;
    body.rotation.x = walking ? Math.sin(gait * Math.PI * 2) * .025 : 0;
    for (let side = 0; side < 2; side++) for (let leg = 0; leg < 4; leg++) {
      const sign = side ? 1 : -1, i = side * 4 + leg, phase = (gait + ((leg + side) % 2) * .5) % 1;
      const stance = phase < .64, step = stance ? .5 - phase / .64 : -.5 + (phase - .64) / .36;
      const foot = feet[leg].clone(); foot.y *= sign; foot.x += stride * step; foot.z = walking && !stance ? Math.sin((phase - .64) / .36 * Math.PI) * 7 : 0;
      const root = new T.Vector3(8 - leg * 4, sign * 5.8, 8.2), knee = new T.Vector3(foot.x * .65 + root.x * .35, sign * (14 + (leg === 1 || leg === 2 ? 2 : 0)), 16 + foot.z * .35);
      const ankle = new T.Vector3(foot.x * .94, foot.y * .94, 3 + foot.z);
      const points = [root, knee, ankle, foot];
      for (let j = 0; j < 3; j++) {
        const n = i * 3 + j, radius = j === 0 ? 1.3 : j === 1 ? .9 : .55;
        bone(segments, n, points[j], points[j + 1], radius); const innerA = points[j].clone().add(new T.Vector3(0, 0, -.85)), innerB = points[j + 1].clone().add(new T.Vector3(0, 0, -.85)); bone(tendons, n, innerA, innerB, radius);
        const mid = points[j].clone().lerp(points[j + 1], .22), end = mid.clone().lerp(points[j + 1], .055); bone(cuffs, n, mid, end, radius);
      }
      points.forEach((p, j) => joint(i * 4 + j, p, j === 0 ? 1.8 : j === 1 ? 1.65 : j === 2 ? 1 : .55));
    }
    [segments, tendons, joints, cuffs].forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });
    optic.emissiveIntensity = 1 + Math.sin(time * 2 + variant) * .12;
  }
  update(0, false, 0); group.userData.legs = 8;
  return { group, update };
}
