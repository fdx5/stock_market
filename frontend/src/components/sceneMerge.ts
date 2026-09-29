import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** The meshes under `root` that never move against each other (a boat and its crew, a
 * balloon's basket and cables), merged into one mesh per material: the same shapes,
 * colours and shadows in a handful of draws instead of dozens. `keep` spares a subtree
 * that moves on its own (a flame, an envelope that glows). The merged meshes join
 * `root`; the originals' geometries are disposed. Returns the new meshes. */
export function mergeStatic(root: THREE.Object3D, keep: (o: THREE.Object3D) => boolean = () => false): THREE.Mesh[] {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const groups = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean; receive: boolean }>();
  const merged: THREE.Mesh[] = [];
  const visit = (o: THREE.Object3D) => {
    for (const child of [...o.children]) {
      if (keep(child)) continue;
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(mesh.material)) {
        const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld));
        for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color"].includes(name)) g.deleteAttribute(name);
        const entry = groups.get(mesh.material) ?? { geos: [], cast: false, receive: false };
        entry.geos.push(g); entry.cast ||= mesh.castShadow; entry.receive ||= mesh.receiveShadow;
        groups.set(mesh.material, entry);
        mesh.geometry.dispose();
        o.remove(mesh);
      }
      visit(child);
    }
  };
  visit(root);
  for (const [material, { geos, cast, receive }] of groups) {
    // One attribute set per material (a uv or colour missing on some part: dropped).
    const names = ["position", "normal", "uv", "color"].filter(n => geos.every(g => g.getAttribute(n)));
    for (const g of geos) for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n);
    const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (geos.length > 1) geos.forEach(g => g.dispose());
    if (!geo) continue;
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, material);
    m.castShadow = cast; m.receiveShadow = receive;
    root.add(m);
    merged.push(m);
  }
  return merged;
}
