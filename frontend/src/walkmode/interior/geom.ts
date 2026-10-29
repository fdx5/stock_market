import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/* Static geometry gathered by material and merged: the whole flat is a few dozen draw calls.
 * Every vertex carries its light zone (the room it belongs to) so a room's lamps light only that
 * room — see lightZones.ts. UVs are in metres. */

interface Bucket { pos: number[]; nor: number[]; uv: number[]; zone: number[]; idx: number[]; cast: boolean; receive: boolean }

export class Batcher {
  private buckets = new Map<string, Bucket & { m: THREE.Material }>();
  /** `chunk` (m): a big floor's batches cut into squares this size, each a mesh of its own, so the
   * parts out of view or far away are not drawn (0: one mesh a material, a flat's whole) */
  constructor(private chunk = 0) {}
  private bucket(m: THREE.Material, cast = true, x = 0, z = 0) {
    const key = this.chunk > 0 ? `${m.uuid}|${Math.floor(x / this.chunk)}|${Math.floor(z / this.chunk)}` : m.uuid;
    let b = this.buckets.get(key);
    if (!b) { b = { m, pos: [], nor: [], uv: [], zone: [], idx: [], cast, receive: true }; this.buckets.set(key, b); }
    if (!cast) b.cast = false;
    return b;
  }
  /** a flat quad: corners in order (counter-clockwise seen from the side the normal points to) */
  quad(m: THREE.Material, zone: number, p: THREE.Vector3[], n: THREE.Vector3, uv: [number, number][]) {
    const b = this.bucket(m, true, (p[0].x + p[2].x) / 2, (p[0].z + p[2].z) / 2), base = b.pos.length / 3;
    for (let i = 0; i < 4; i++) { b.pos.push(p[i].x, p[i].y, p[i].z); b.nor.push(n.x, n.y, n.z); b.uv.push(uv[i][0], uv[i][1]); b.zone.push(zone); }
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  /** any geometry, transformed (its UVs as they are — call boxUV first for metre UVs) */
  add(m: THREE.Material, zone: number, g: THREE.BufferGeometry, mat?: THREE.Matrix4, cast = true) {
    const pos = g.getAttribute("position"), nor = g.getAttribute("normal"), uv = g.getAttribute("uv");
    const at = new THREE.Vector3(); if (this.chunk > 0) { if (pos.count) at.fromBufferAttribute(pos, 0); if (mat) at.applyMatrix4(mat); }
    const b = this.bucket(m, cast, at.x, at.z), base = b.pos.length / 3;
    const v = new THREE.Vector3(), nm = mat ? new THREE.Matrix3().getNormalMatrix(mat) : null;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i); if (mat) v.applyMatrix4(mat); b.pos.push(v.x, v.y, v.z);
      if (nor) { v.fromBufferAttribute(nor, i); if (nm) v.applyMatrix3(nm).normalize(); b.nor.push(v.x, v.y, v.z); } else b.nor.push(0, 1, 0);
      if (uv) b.uv.push(uv.getX(i), uv.getY(i)); else b.uv.push(0, 0);
      b.zone.push(zone);
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) b.idx.push(base + index.getX(i));
    else for (let i = 0; i < pos.count; i++) b.idx.push(base + i);
    // (a mirroring transform turns the faces inside out)
    if (mat && mat.determinant() < 0) for (let i = b.idx.length - (index ? index.count : pos.count); i < b.idx.length; i += 3) { const t = b.idx[i + 1]; b.idx[i + 1] = b.idx[i + 2]; b.idx[i + 2] = t; }
  }
  build(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const b of this.buckets.values()) {
      const m = b.m;
      if (!b.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute("zone", new THREE.Float32BufferAttribute(b.zone, 1));
      g.setIndex(b.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = b.cast; mesh.receiveShadow = b.receive;
      mesh.matrixAutoUpdate = false;
      out.push(mesh);
    }
    this.buckets.clear();
    return out;
  }
}

/** UVs in metres by box projection (each face from the axis it faces most). */
export function boxUV(g: THREE.BufferGeometry, scale = 1): THREE.BufferGeometry {
  const geo = g.index !== null ? g.toNonIndexed() : g;
  if (geo !== g) g.dispose();
  if (!geo.getAttribute("normal")) geo.computeVertexNormals();
  const pos = geo.getAttribute("position"), nor = geo.getAttribute("normal");
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i += 3) {
    // (one projection a triangle, by its face normal: no seams inside a face)
    let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 3; k++) { nx += nor.getX(i + k); ny += nor.getY(i + k); nz += nor.getZ(i + k); }
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    for (let k = 0; k < 3; k++) {
      const x = pos.getX(i + k), y = pos.getY(i + k), z = pos.getZ(i + k);
      let u: number, v: number;
      if (ay >= ax && ay >= az) { u = x; v = z; } else if (ax >= az) { u = z; v = y; } else { u = x; v = y; }
      uv[(i + k) * 2] = u * scale; uv[(i + k) * 2 + 1] = v * scale;
    }
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** A rectangle (u0..u1 × v0..v1) less rectangular holes, as quads: vertical strips between the
 * holes' edges, each strip's spans not covered by a hole. */
export function rectMinusHoles(u0: number, u1: number, v0: number, v1: number, holes: [number, number, number, number][]): [number, number, number, number][] {
  const hs = holes.map(([a0, a1, b0, b1]) => [Math.max(u0, a0), Math.min(u1, a1), Math.max(v0, b0), Math.min(v1, b1)] as [number, number, number, number]).filter(h => h[1] - h[0] > 1e-4 && h[3] - h[2] > 1e-4);
  const cuts = [...new Set([u0, u1, ...hs.flatMap(h => [h[0], h[1]])])].sort((a, b) => a - b);
  const out: [number, number, number, number][] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1];
    if (b - a < 1e-5) continue;
    const mid = (a + b) / 2;
    const cover = hs.filter(h => h[0] <= mid && h[1] >= mid).map(h => [h[2], h[3]] as [number, number]).sort((p, q) => p[0] - q[0]);
    let y = v0;
    for (const [c0, c1] of cover) { if (c0 > y + 1e-5) out.push([a, b, y, c0]); y = Math.max(y, c1); }
    if (v1 > y + 1e-5) out.push([a, b, y, v1]);
  }
  return out;
}

/** A group's own mesh children merged by material (their transforms baked in): a door leaf's
 * slab, roses, levers and lock become one mesh a material — fewer draws in every pass. Children
 * that are groups, or invisible (look-ray targets), are left alone. Returns the new geometries. */
export function mergeMeshChildren(g: THREE.Object3D): THREE.BufferGeometry[] {
  const by = new Map<THREE.Material, THREE.Mesh[]>();
  for (const c of g.children) {
    const m = c as THREE.Mesh;
    if (!m.isMesh || m.children.length || Array.isArray(m.material) || !m.material.visible) continue;
    const l = by.get(m.material) ?? []; l.push(m); by.set(m.material, l);
  }
  const made: THREE.BufferGeometry[] = [];
  for (const [mat, list] of by) {
    if (list.length < 2) continue;
    const parts = list.map(m => {
      m.updateMatrix();
      let x = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      x.applyMatrix4(m.matrix);
      for (const k of Object.keys(x.attributes)) if (!["position", "normal", "uv", "furLayer", "furMix"].includes(k)) x.deleteAttribute(k);
      if (!x.getAttribute("uv")) x.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(x.getAttribute("position").count * 2), 2));
      x = x.index ? x.toNonIndexed() : x;
      return x;
    });
    const merged = mergeGeometries(parts);
    parts.forEach(x => x.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = list.some(m => m.castShadow); mesh.receiveShadow = list.some(m => m.receiveShadow);
    for (const m of list) g.remove(m);
    g.add(mesh); made.push(merged);
  }
  return made;
}

/** Shapes for furniture: a rounded box with metre UVs. */
export { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
