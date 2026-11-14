import * as THREE from "three";

/* One draw for a settled drone tile's buildings.
 *
 * A tile's buildings arrive as a mesh per facade style (registered footprints) and a mesh per
 * survey batch (measured shapes), all drawn by the same constructed-facade shader: the style
 * materials differ only in textures that this path never samples (facade.z > 0 selects
 * BUILDING_APPEARANCE in ComplexRenderer). In a dense city that was ~500 building draws, each
 * costing the renderer's per-object work in four passes (three shadow cascades and colour).
 *
 * Once a tile has stopped changing, its building meshes are copied into one mesh. The originals
 * stay where they are — picking, collisions, the survey swap and aerial colours keep using them —
 * and are only left out of drawing (userData.batchedInto, honoured by ComplexRenderer.sync).
 * Any change to an original (an index range hidden by a survey swap, repainted colours, a
 * new batch, a mesh shown or hidden) dissolves the copy; it is made again once the tile has
 * been still for a while. The copy is shown first and the originals hidden only once it is
 * ready to draw, so no frame lacks the buildings. */

const ATTRS: [string, number][] = [["position", 3], ["normal", 3], ["uv", 2], ["color", 3], ["facade", 4]];

type Member = { mesh: THREE.Mesh; sig: number[] };
export type TileBatchState = {
  /** signature of the members last seen and when it last changed */
  sig: string; since: number;
  mesh: THREE.Mesh | null; members: Member[];
  /** the copy is drawn and the originals left out */
  live: boolean;
  /** registered once with the tile's own disposal */
  dispose?: () => void;
};

const meshSig = (m: THREE.Mesh): number[] => {
  const g = m.geometry, out: number[] = [g.id, g.drawRange.start, g.drawRange.count, m.visible ? 1 : 0, (m.material as unknown as { id: number }).id];
  for (const [name] of ATTRS) out.push((g.getAttribute(name) as THREE.BufferAttribute | undefined)?.version ?? -1);
  out.push(g.index?.version ?? -1);
  return out;
};
const sameSig = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Can this mesh be drawn by the shared constructed-facade shader from a merged copy? */
function eligible(m: THREE.Object3D): m is THREE.Mesh {
  const mesh = m as THREE.Mesh;
  if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || !mesh.visible || Array.isArray(mesh.material)) return false;
  const mat = mesh.material as THREE.Material;
  if (!mat?.userData?.constructedBuilding) return false;
  const g = mesh.geometry;
  if (!g.index) return false;
  for (const [name, size] of ATTRS) {
    const a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a || a.itemSize !== size || (a as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) return false;
  }
  return true;
}

/** The meshes of a tile's building groups that a batch would take (direct children). */
export function batchCandidates(groups: (THREE.Object3D | null | undefined)[]): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (const g of groups) if (g?.visible) for (const c of g.children) if (eligible(c)) out.push(c);
  return out;
}

function candidatesSig(list: THREE.Mesh[]): string {
  let s = "";
  for (const m of list) s += meshSig(m).join(",") + ";";
  return s;
}

/** Copy the members' drawn ranges into one geometry (indices rebased, vertices only those the
 * ranges reach). Returns null when there is nothing worth merging. */
export function mergeMembers(list: THREE.Mesh[]): THREE.BufferGeometry | null {
  const parts: { g: THREE.BufferGeometry; start: number; count: number; verts: number }[] = [];
  let totalV = 0, totalI = 0;
  for (const m of list) {
    const g = m.geometry, index = g.index!.array as ArrayLike<number>;
    const start = Math.max(0, g.drawRange.start), end = Math.min(index.length, g.drawRange.count === Infinity ? index.length : start + g.drawRange.count);
    if (end <= start) continue;
    let max = -1;
    for (let i = start; i < end; i++) { const v = index[i]; if (v > max) max = v; }
    const verts = Math.min(max + 1, g.getAttribute("position").count);
    if (verts <= 0) continue;
    parts.push({ g, start, count: end - start, verts });
    totalV += verts; totalI += end - start;
  }
  if (parts.length < 2 || !totalI) return null;
  const out = new THREE.BufferGeometry();
  for (const [name, size] of ATTRS) {
    const arr = new Float32Array(totalV * size);
    let o = 0;
    for (const p of parts) { const src = p.g.getAttribute(name).array as Float32Array; arr.set(src.subarray(0, p.verts * size), o); o += p.verts * size; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const idx = new Uint32Array(totalI);
  let io = 0, base = 0;
  for (const p of parts) {
    const src = p.g.index!.array as ArrayLike<number>;
    for (let i = 0; i < p.count; i++) idx[io + i] = src[p.start + i] + base;
    io += p.count; base += p.verts;
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  // (the members' spheres together: a pass over every vertex costs more than the copy)
  const box = new THREE.Box3(), s = new THREE.Sphere();
  for (const p of parts) {
    if (!p.g.boundingSphere) p.g.computeBoundingSphere();
    const b = p.g.boundingSphere!;
    box.expandByPoint(s.center.copy(b.center).addScalar(-b.radius)).expandByPoint(s.center.copy(b.center).addScalar(b.radius));
  }
  const centre = box.getCenter(new THREE.Vector3());
  let r = 0;
  for (const p of parts) { const b = p.g.boundingSphere!; r = Math.max(r, b.center.distanceTo(centre) + b.radius); }
  out.boundingSphere = new THREE.Sphere(centre, r);
  out.userData.tileBatch = true;
  return out;
}

export function newBatchState(): TileBatchState { return { sig: "", since: 0, mesh: null, members: [], live: false }; }

/** Take the copy away and draw the originals again. */
export function dissolveBatch(st: TileBatchState) {
  for (const m of st.members) if (m.mesh.userData.batchedInto === st.mesh) delete m.mesh.userData.batchedInto;
  if (st.mesh) { st.mesh.removeFromParent(); st.mesh.geometry.dispose(); }
  st.mesh = null; st.members = []; st.live = false;
}

export type BatchStep = "none" | "made" | "live" | "dissolved";

/**
 * One look at a tile (call a few times a second). `parent` takes the copy; `groups` hold the
 * originals (all under `parent`, which must not move). `settleMs`: how long the members must be
 * unchanged before they are merged. `ready(mesh)`: whether the copy can be drawn yet.
 */
export function stepBatch(st: TileBatchState, parent: THREE.Object3D, groups: (THREE.Object3D | null | undefined)[], material: THREE.Material,
  now: number, settleMs: number, ready: (o: THREE.Object3D) => boolean, name: string): BatchStep {
  // A made copy: still true to its members?
  if (st.mesh) {
    const list = batchCandidates(groups);
    let ok = list.length === st.members.length;
    if (ok) for (let i = 0; i < list.length; i++) if (list[i] !== st.members[i].mesh || !sameSig(meshSig(list[i]), st.members[i].sig)) { ok = false; break; }
    // (its caster state follows the tile's: castShadows walks the whole tile group)
    if (!ok || !st.mesh.parent) { dissolveBatch(st); st.sig = ""; st.since = now; return "dissolved"; }
    if (!st.live) {
      if (!ready(st.mesh)) return "none";
      for (const m of st.members) m.mesh.userData.batchedInto = st.mesh;
      st.live = true;
      return "live";
    }
    return "none";
  }
  const list = batchCandidates(groups);
  if (list.length < 2) { st.sig = ""; return "none"; }
  const sig = candidatesSig(list);
  if (sig !== st.sig) { st.sig = sig; st.since = now; return "none"; }
  if (now - st.since < settleMs || !sameFrame(list)) return "none";
  const geo = mergeMembers(list);
  if (!geo) return "none";
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.castShadow = list.some(m => m.castShadow);
  mesh.receiveShadow = true;
  // (the originals answer rays: picking, collisions and walking stay theirs)
  mesh.raycast = () => {};
  mesh.matrixAutoUpdate = false;
  // The originals' groups carry no transform of their own in the tile frame; any that do keep theirs.
  const m0 = list[0];
  m0.updateWorldMatrix(true, false);
  parent.updateWorldMatrix(true, false);
  mesh.matrix.copy(parent.matrixWorld).invert().multiply(m0.matrixWorld);
  parent.add(mesh);
  mesh.updateMatrixWorld(true);
  st.mesh = mesh;
  st.members = list.map(m => ({ mesh: m, sig: meshSig(m) }));
  st.live = false;
  return "made";
}

/** Whether every candidate shares one world transform (a batch can stand for them). */
export function sameFrame(list: THREE.Mesh[]): boolean {
  if (list.length < 2) return true;
  list[0].updateWorldMatrix(true, false);
  const e0 = list[0].matrixWorld.elements;
  for (let i = 1; i < list.length; i++) {
    list[i].updateWorldMatrix(true, false);
    const e = list[i].matrixWorld.elements;
    for (let k = 0; k < 16; k++) if (Math.abs(e[k] - e0[k]) > 1e-6) return false;
  }
  return true;
}
