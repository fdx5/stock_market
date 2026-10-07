import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** An articulated, fully geometric mechanical sentinel. No sprites or remote assets. */
export function createAtlasSentinel(scene: T.Scene, variant: number, fidelity: number, animatePose = true, sensorColor = "#ff142c") {
  const group = new T.Group();
  const hull = new T.MeshStandardMaterial({ color: "#3e5357", metalness: .94, roughness: .32 });
  const armor = new T.MeshStandardMaterial({ color: "#182829", metalness: .92, roughness: .36 });
  const steel = new T.MeshStandardMaterial({ color: "#99abaa", metalness: .88, roughness: .23 });
  const dark = new T.MeshStandardMaterial({ color: "#050b0c", metalness: .7, roughness: .38 });
  const red = new T.MeshBasicMaterial({ color: sensorColor });
  const add = (geometry: T.BufferGeometry, material: T.Material, position: [number, number, number], scale?: [number, number, number]) => {
    const mesh = new T.Mesh(geometry, material); mesh.position.set(...position); if (scale) mesh.scale.set(...scale); group.add(mesh); return mesh;
  };
  // Sculpted shell, split armor plates and exposed ventral turbine.
  add(new T.SphereGeometry(1, fidelity, Math.floor(fidelity * .65)), hull, [0, 0, 0], [1.24, .75, 1.47]);
  add(new T.SphereGeometry(1, fidelity, 24), armor, [0, .15, -.38], [1.28, .69, 1.08]);
  add(new T.SphereGeometry(1, fidelity, 24), dark, [0, -.08, .9], [1.08, .54, .64]);
  const brow = add(new T.TorusGeometry(.88, .065, 10, fidelity, Math.PI * 1.1), steel, [0, .12, 1.17]); brow.rotation.z = -.05;
  const spine = add(new T.BoxGeometry(.24, .15, 2.52), steel, [0, .71, -.15]); spine.rotation.x = .02;
  for (let i = 0; i < 9; i++) {
    const z = -.97 + i * .21;
    const plate = add(new T.BoxGeometry(1.7 - Math.abs(i - 4) * .12, .05, .075), steel, [0, .65 - Math.abs(i - 4) * .023, z]);
    plate.rotation.x = -.07;
    for (const sign of [-1, 1]) {
      const vent = add(new T.BoxGeometry(.13, .12, .07), dark, [sign * (.95 - Math.abs(i - 4) * .05), .31, z]); vent.rotation.z = sign * -.2;
    }
  }
  // Clustered optical sensors recessed into machined sockets.
  for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) {
    const x = (col - 2) * .32 + (row % 2 ? .08 : 0), y = .31 - row * .29;
    const z = 1.61 - x * x * .28 - y * y * .12;
    const size = row === 1 && col === 2 ? .15 : .098;
    add(new T.CylinderGeometry(size * 1.45, size * 1.55, .115, 20), steel, [x, y, z]).rotation.x = Math.PI / 2;
    add(new T.SphereGeometry(size, 24, 16), red, [x, y, z + .065], [1, 1, .48]);
    const ring = add(new T.TorusGeometry(size * 1.2, .015, 6, 24), dark, [x, y, z + .087]); ring.rotation.y = x * .2;
  }
  for (const sign of [-1, 1]) {
    const rail = add(new T.CapsuleGeometry(.105, 1.4, 6, 16), steel, [sign * 1.08, -.18, .1]); rail.rotation.x = Math.PI / 2; rail.rotation.z = sign * .12;
    const turbine = add(new T.CylinderGeometry(.33, .27, .23, 24), dark, [sign * .72, -.58, -.47]); turbine.rotation.x = .18;
    add(new T.TorusGeometry(.29, .032, 8, 32), steel, [sign * .72, -.69, -.45]).rotation.x = Math.PI / 2;
  }
  // Hundreds of separate vertebrae, batched into three instanced draw calls.
  const arms = variant === 0 ? 24 : 20, segments = variant === 0 ? 48 : 38;
  const bones = new T.InstancedMesh(new T.CylinderGeometry(1, .86, 1, 10), steel, arms * segments);
  const joints = new T.InstancedMesh(new T.SphereGeometry(1, 10, 8), armor, arms * segments);
  const cable = new T.InstancedMesh(new T.CylinderGeometry(1, 1, 1, 7), dark, arms * segments);
  [bones, joints, cable].forEach(mesh => { mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.frustumCulled = false; group.add(mesh); });
  const claw = new T.MeshStandardMaterial({ color: "#bec8c4", metalness: .92, roughness: .25 });
  const claws = new T.InstancedMesh(new T.ConeGeometry(.14, .58, 16), claw, arms * 3); claws.instanceMatrix.setUsage(T.DynamicDrawUsage); claws.frustumCulled = false; group.add(claws);
  for (let a = 0; a < arms; a++) {
    const base = a / arms * Math.PI * 2;
    add(new T.SphereGeometry(.23, 16, 12), dark, [Math.cos(base) * .88, Math.sin(base) * .43, -.85]);
  }
  const redLight = new T.PointLight(sensorColor, 2.2, 6); redLight.position.set(0, 0, 2); group.add(redLight);
  // Batch the fixed armor and optics by material; keep articulated parts separate.
  const staticParts = new Map<T.Material, T.BufferGeometry[]>();
  for (const child of [...group.children]) {
    if (!(child instanceof T.Mesh) || child instanceof T.InstancedMesh) continue;
    child.updateMatrix();
    const material = child.material as T.Material;
    const geometry = child.geometry.clone().applyMatrix4(child.matrix);
    if (!staticParts.has(material)) staticParts.set(material, []);
    staticParts.get(material)!.push(geometry); group.remove(child); child.geometry.dispose();
  }
  staticParts.forEach((parts, material) => { const merged = mergeGeometries(parts, false); if (merged) group.add(new T.Mesh(merged, material)); parts.forEach(part => part.dispose()); });
  scene.add(group);
  const transform = new T.Object3D(), previous = new T.Vector3(), next = new T.Vector3(), dir = new T.Vector3(), up = new T.Vector3(0, 1, 0);
  function point(a: number, s: number, t: number, out: T.Vector3) {
    const angle = a / arms * Math.PI * 2, phase = a * 1.73 + variant * 2.4;
    const sweep = Math.sin(t * .55 + phase) * .65;
    const spread = .82 + Math.sin(s * Math.PI * .78) * (1.7 + a % 3 * .38);
    out.set(Math.cos(angle) * spread + Math.sin(s * 8 - t * 1.35 + phase) * s * .58 + sweep * s,
      Math.sin(angle) * (.5 + s * 1.4) - Math.pow(s, 1.6) * 1.18 + Math.cos(s * 7 - t * 1.2 + phase) * s * .44,
      -.8 - s * (5.1 + a % 4 * .42) + Math.sin(s * 4 + t * .65 + phase) * s * .75);
  }
  function update(t: number) {
    if (animatePose) {
    if (variant === 0) {
      group.position.set(12.7 + Math.sin(t * .12) * 1.5, 6.7 + Math.sin(t * .33) * .55, 2.2 + Math.cos(t * .14));
      group.rotation.set(Math.sin(t * .22) * .11, .45 + Math.sin(t * .16) * .2, -.13 + Math.sin(t * .28) * .08);
      group.scale.setScalar(1.62);
    } else {
      const angle = t * (.06 + variant * .018) + variant * 2.5;
      group.position.set(Math.cos(angle) * (17 + variant * 4), 6.6 + variant * 2.4 + Math.sin(t * .25 + variant), -14 + Math.sin(angle) * 9);
      group.rotation.set(.12, -angle + 1.1, Math.sin(t * .2) * .16); group.scale.setScalar(variant === 1 ? .72 : .48);
    }
    }
    for (let a = 0; a < arms; a++) {
      point(a, 0, t, previous);
      for (let j = 0; j < segments; j++) {
        const s = (j + 1) / segments, index = a * segments + j;
        point(a, s, t, next); dir.subVectors(next, previous); const length = dir.length(); dir.normalize();
        const radius = .104 * (1 - s * .66);
        transform.position.copy(previous).lerp(next, .5); transform.quaternion.setFromUnitVectors(up, dir); transform.scale.set(radius, length * .72, radius); transform.updateMatrix(); bones.setMatrixAt(index, transform.matrix);
        transform.position.copy(next); transform.scale.setScalar(radius * 1.15); transform.updateMatrix(); joints.setMatrixAt(index, transform.matrix);
        transform.position.copy(previous).lerp(next, .5); transform.scale.set(radius * .46, length, radius * .46); transform.updateMatrix(); cable.setMatrixAt(index, transform.matrix);
        previous.copy(next);
      }
      for (let prong = 0; prong < 3; prong++) { transform.position.copy(next); transform.position.x += (prong - 1) * .1; transform.quaternion.setFromUnitVectors(up, dir); transform.rotateZ((prong - 1) * .24); transform.scale.setScalar(1); transform.updateMatrix(); claws.setMatrixAt(a * 3 + prong, transform.matrix); }
    }
    [bones, joints, cable, claws].forEach(mesh => mesh.instanceMatrix.needsUpdate = true);
  }
  update(0);
  return { group, update };
}
