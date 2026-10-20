import type * as THREE from "three";

/* three's updateMatrixWorld, minus the work on objects that did not move. three composes the
 * matrix of every object with matrixAutoUpdate each call and so marks it and its whole subtree
 * for new world matrices: in the drone's scene (some 1,300 objects, nearly all still) that was
 * every matrix of the scene recomputed every frame. Here an object's matrix is composed again
 * only when its position, rotation or scale (or pivot) changed since it was last composed, and
 * world matrices are recomputed exactly where three's rule then asks for them (a changed matrix,
 * matrixWorldNeedsUpdate, or a parent recomputed). The resulting matrices are the same; objects
 * whose class has its own updateMatrixWorld (cameras, skinned meshes…) are left to it. */

type Lean = THREE.Object3D & { __trs?: Float64Array; pivot?: THREE.Vector3 | null };

export function leanUpdateMatrixWorld(root: THREE.Object3D) {
  const base = Object.getPrototypeOf(root).updateMatrixWorld as THREE.Object3D["updateMatrixWorld"];
  const visit = (o: Lean, force: boolean) => {
    if (o.updateMatrixWorld !== base) { o.updateMatrixWorld(force); return; }
    if (o.matrixAutoUpdate) {
      const p = o.position, q = o.quaternion, s = o.scale, k = o.__trs;
      if (o.pivot || !k || k[0] !== p.x || k[1] !== p.y || k[2] !== p.z || k[3] !== q.x || k[4] !== q.y || k[5] !== q.z || k[6] !== q.w
        || k[7] !== s.x || k[8] !== s.y || k[9] !== s.z) {
        o.updateMatrix();
        const t = o.__trs ??= new Float64Array(10);
        t[0] = p.x; t[1] = p.y; t[2] = p.z; t[3] = q.x; t[4] = q.y; t[5] = q.z; t[6] = q.w; t[7] = s.x; t[8] = s.y; t[9] = s.z;
      }
    }
    if (o.matrixWorldNeedsUpdate || force) {
      if (o.matrixWorldAutoUpdate === true) {
        if (o.parent === null) o.matrixWorld.copy(o.matrix);
        else o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
      }
      o.matrixWorldNeedsUpdate = false;
      force = true;
    }
    const children = o.children;
    for (let i = 0, l = children.length; i < l; i++) visit(children[i], force);
  };
  visit(root, false);
}

/** One object's world matrix brought up to date without the walk over the whole tree (the
 * renderer's short frames — see ComplexRenderer's halfSync): its chain of parents from the root
 * down, by the same rule as leanUpdateMatrixWorld (composed again where moved, world matrices
 * where a matrix or a parent changed). */
const chain: Lean[] = [];
export function leanUpdateOne(o: Lean, base: THREE.Object3D["updateMatrixWorld"]) {
  chain.length = 0;
  for (let p: Lean | null = o; p; p = p.parent as Lean | null) chain.push(p);
  let force = false;
  for (let i = chain.length - 1; i >= 0; i--) {
    const n = chain[i];
    if (n.updateMatrixWorld !== base) { n.updateWorldMatrix(false, false); force = true; continue; }
    if (n.matrixAutoUpdate) {
      const p = n.position, q = n.quaternion, s = n.scale, k = n.__trs;
      if (n.pivot || !k || k[0] !== p.x || k[1] !== p.y || k[2] !== p.z || k[3] !== q.x || k[4] !== q.y || k[5] !== q.z || k[6] !== q.w
        || k[7] !== s.x || k[8] !== s.y || k[9] !== s.z) {
        n.updateMatrix();
        const t = n.__trs ??= new Float64Array(10);
        t[0] = p.x; t[1] = p.y; t[2] = p.z; t[3] = q.x; t[4] = q.y; t[5] = q.z; t[6] = q.w; t[7] = s.x; t[8] = s.y; t[9] = s.z;
      }
    }
    if (n.matrixWorldNeedsUpdate || force) {
      if (n.matrixWorldAutoUpdate === true) {
        if (n.parent === null) n.matrixWorld.copy(n.matrix);
        else n.matrixWorld.multiplyMatrices(n.parent.matrixWorld, n.matrix);
      }
      n.matrixWorldNeedsUpdate = false;
      force = true;
    }
  }
}
