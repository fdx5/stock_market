import * as THREE from 'three';

type Box = [number, number, number, number];
/** Subtract a world x/north box from sea triangles only, with exact interpolated cut edges.
 * Rivers, coastline/island outlines and the source geometry are preserved. */
export function seaOutsideBox(source: THREE.BufferGeometry, box: Box, matrix = new THREE.Matrix4(), inside = false) {
  const pos = source.getAttribute('position'), sea = source.getAttribute('aSea'), index = source.getIndex();
  if (!pos || !index) return source.clone();
  const attrs = Object.entries(source.attributes) as [string, THREE.BufferAttribute][];
  if (!inside && sea?.array.every(v => v >= .5)) {
    source.computeBoundingBox();
    const bounds = source.boundingBox!.clone().applyMatrix4(matrix);
    if (bounds.min.x >= box[0] && bounds.max.x <= box[2] && -bounds.max.z >= box[1] && -bounds.min.z <= box[3]) {
      const empty = new THREE.BufferGeometry();
      for (const [name, a] of attrs) empty.setAttribute(name, new THREE.BufferAttribute(new Float32Array(), a.itemSize, a.normalized));
      empty.setIndex(new THREE.BufferAttribute(new Uint32Array(), 1));
      empty.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
      return empty;
    }
  }
  const sizes = attrs.map(([, a]) => a.itemSize), offsets: number[] = [];
  let width = 0; for (const size of sizes) { offsets.push(width); width += size; }
  const pOffset = offsets[attrs.findIndex(([name]) => name === 'position')];
  type Vertex = { data: number[]; x: number; y: number };
  const vertex = (i: number): Vertex => {
    const data = attrs.flatMap(([, a]) => Array.from({ length: a.itemSize }, (_, k) => a.array[i * a.itemSize + k]));
    const p = new THREE.Vector3(data[pOffset], data[pOffset + 1], data[pOffset + 2]).applyMatrix4(matrix);
    return { data, x: p.x, y: -p.z };
  };
  const mix = (a: Vertex, b: Vertex, t: number): Vertex => ({ data: a.data.map((v, k) => v + (b.data[k] - v) * t), x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const clip = (ring: Vertex[], axis: 'x' | 'y', value: number, sign: number) => {
    const out: Vertex[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], da = sign * (a[axis] - value), db = sign * (b[axis] - value);
      if (da >= 0) out.push(a);
      if ((da < 0) !== (db < 0)) out.push(mix(a, b, da / (da - db)));
    }
    return out;
  };
  const values = attrs.map(() => [] as number[]), outIndex: number[] = [];
  const originals = new Map<number, number>();
  const push = (v: Vertex) => { const n = values[0].length / sizes[0]; values.forEach((a, k) => a.push(...v.data.slice(offsets[k], offsets[k] + sizes[k]))); return n; };
  const keep = (ids: number[]) => { for (const id of ids) { let n = originals.get(id); if (n === undefined) { n = push(vertex(id)); originals.set(id, n); } outIndex.push(n); } };
  const fan = (ring: Vertex[]) => {
    for (let j = 1; j + 1 < ring.length; j++) {
      const a = ring[0], b = ring[j], c = ring[j + 1];
      if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) < 1e-8) continue;
      outIndex.push(push(a), push(b), push(c));
    }
  };
  const planes: ['x' | 'y', number, number][] = [['x', box[0], 1], ['x', box[2], -1], ['y', box[1], 1], ['y', box[3], -1]];
  for (let k = 0; k < index.count; k += 3) {
    const ids = [index.getX(k), index.getX(k + 1), index.getX(k + 2)];
    if (sea && ids.some(i => sea.getX(i) < .5)) { keep(ids); continue; }
    let ring = ids.map(vertex);
    if (planes.some(([axis, value, sign]) => ring.every(p => sign * (p[axis] - value) <= 0))) { if(!inside)keep(ids); continue; }
    if (planes.every(([axis, value, sign]) => ring.every(p => sign * (p[axis] - value) >= 0))) { if(inside)keep(ids); continue; }
    if(inside){for(const[axis,value,sign]of planes)ring=clip(ring,axis,value,sign);fan(ring);continue;}
    for (const [axis, value, sign] of planes) { fan(clip(ring, axis, value, -sign)); ring = clip(ring, axis, value, sign); if (ring.length < 3) break; }
  }
  const out = new THREE.BufferGeometry();
  attrs.forEach(([name, a], k) => out.setAttribute(name, new THREE.BufferAttribute(new Float32Array(values[k]), a.itemSize, a.normalized)));
  out.setIndex(new THREE.BufferAttribute(new Uint32Array(outIndex), 1));
  if (outIndex.length) out.computeBoundingSphere(); else out.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
  return out;
}

/** Near water relinquishes just its sea to the continuous regional surface. Restorable on exit. */
export class SeaCoverage {
  private saved = new Map<THREE.Mesh, { original: THREE.BufferGeometry; derived: THREE.BufferGeometry; key: string; visible: boolean }>();
  private rivers = new WeakSet<THREE.BufferGeometry>();
  private pending = new Map<THREE.Mesh,{original:THREE.BufferGeometry;key:string;stop:AbortController}>();
  constructor(private prepare?: (source:THREE.BufferGeometry,box:Box,matrix:THREE.Matrix4,signal:AbortSignal)=>Promise<THREE.BufferGeometry|null>){}
  update(meshes: THREE.Mesh[], box: Box) {
    const key = box.join(',');
    for (const mesh of meshes) {
      const old = this.saved.get(mesh);
      if (old && mesh.geometry !== old.derived) { mesh.visible = old.visible; old.derived.dispose(); this.saved.delete(mesh); }
      const current = this.saved.get(mesh);
      if (current?.key === key) continue;
      const original = current?.original ?? mesh.geometry;
      const sea = original.getAttribute('aSea');
      if (this.rivers.has(original)) continue;
      if (!sea || !sea.array.some(v => v >= .5)) { this.rivers.add(original); continue; }
      const visible = current?.visible ?? mesh.visible;
      mesh.updateWorldMatrix(true, false);
      if(this.prepare){
        const oldJob=this.pending.get(mesh);if(oldJob?.key===key&&oldJob.original===original)continue;
        oldJob?.stop.abort();const job={original,key,stop:new AbortController()};this.pending.set(mesh,job);
        void this.prepare(original,box,mesh.matrixWorld.clone(),job.stop.signal).then(derived=>{
          if(!derived)return;
          if(job.stop.signal.aborted||this.pending.get(mesh)!==job||mesh.geometry!==(this.saved.get(mesh)?.derived??original)){derived.dispose();return;}
          const previous=this.saved.get(mesh);mesh.geometry=derived;mesh.visible=visible&&!!derived.index?.count;previous?.derived.dispose();
          this.saved.set(mesh,{original,derived,key,visible});
        }).catch(()=>{}).finally(()=>{if(this.pending.get(mesh)===job)this.pending.delete(mesh);});
        continue;
      }
      const derived = seaOutsideBox(original, box, mesh.matrixWorld);
      mesh.geometry = derived; mesh.visible = visible && !!derived.index?.count; current?.derived.dispose();
      this.saved.set(mesh, { original, derived, key, visible });
    }
  }
  restore() { for(const job of this.pending.values())job.stop.abort();this.pending.clear();for (const [mesh, v] of this.saved) { if (mesh.geometry === v.derived) { mesh.geometry = v.original; mesh.visible = v.visible; } v.derived.dispose(); } this.saved.clear(); }
}

/** Height-grid normals exclude vertical skirt faces, which otherwise darken tile edges. */
export function skirtedGridNormals(geo: THREE.BufferGeometry) {
  const { row, cell, edges } = geo.userData.skirtGrid as { row: number; cell: number; edges: number[][] };
  const p = geo.getAttribute('position') as THREE.BufferAttribute, n = geo.getAttribute('normal') as THREE.BufferAttribute;
  for (let j = 0; j < row; j++) for (let i = 0; i < row; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(row - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(row - 1, j + 1);
    const x = (p.getZ(j * row + i0) - p.getZ(j * row + i1)) / ((i1 - i0) * cell), y = (p.getZ(j0 * row + i) - p.getZ(j1 * row + i)) / ((j1 - j0) * cell), l = Math.hypot(x, y, 1);
    n.setXYZ(j * row + i, x / l, y / l, 1 / l);
  }
  let k = row * row;
  for (const edge of edges) for (const top of edge) { p.setZ(k, Math.min(p.getZ(k), p.getZ(top) - 4)); n.setXYZ(k++, n.getX(top), n.getY(top), n.getZ(top)); }
  n.needsUpdate = true; p.needsUpdate = true;
}
