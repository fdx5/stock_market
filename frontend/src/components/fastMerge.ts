import * as THREE from "three";

/** three's mergeVertices, by numbers: every attribute value rounded to `tol`, vertices whose
 * rounded values are all equal shared (the first one's exact values kept), an index made.
 * three's builds a string key a vertex — a large surveyed building took 20-40 ms of a frame;
 * this hashes the rounded integers instead. Takes indexed or not; float attributes only. */
export function fastMergeVertices(g: THREE.BufferGeometry, tol = 1e-4): THREE.BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g;
  const names = Object.keys(src.attributes);
  const attrs = names.map(n => src.getAttribute(n) as THREE.BufferAttribute);
  if (!attrs.length || attrs.some(a => (a as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute)) return src;
  const n = attrs[0].count, sizes = attrs.map(a => a.itemSize), stride = sizes.reduce((s, x) => s + x, 0);
  const inv = 1 / tol, q = new Int32Array(n * stride);
  for (let i = 0, o = 0; i < n; i++) for (let k = 0; k < attrs.length; k++) {
    const a = attrs[k].array as ArrayLike<number>, sz = sizes[k];
    for (let c = 0; c < sz; c++) q[o++] = Math.round(a[i * sz + c] * inv);
  }
  const heads = new Map<number, number>(), chain = new Int32Array(n), first = new Int32Array(n), index = new Uint32Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const o = i * stride;
    let h = 0x811c9dc5;
    for (let c = 0; c < stride; c++) h = Math.imul(h ^ q[o + c], 0x01000193);
    let u = heads.get(h) ?? -1, found = -1;
    while (u >= 0) {
      const p = first[u] * stride;
      let same = true;
      for (let c = 0; c < stride; c++) if (q[p + c] !== q[o + c]) { same = false; break; }
      if (same) { found = u; break; }
      u = chain[u];
    }
    if (found < 0) { found = count++; first[found] = i; chain[found] = heads.get(h) ?? -1; heads.set(h, found); }
    index[i] = found;
  }
  const out = new THREE.BufferGeometry();
  attrs.forEach((a, k) => {
    const sz = sizes[k], from = a.array as ArrayLike<number>;
    const arr = new (a.array.constructor as Float32ArrayConstructor)(count * sz);
    for (let u = 0; u < count; u++) for (let c = 0; c < sz; c++) arr[u * sz + c] = from[first[u] * sz + c];
    out.setAttribute(names[k], new THREE.BufferAttribute(arr, sz, a.normalized));
  });
  out.setIndex(new THREE.BufferAttribute(count < 65536 ? new Uint16Array(index) : index, 1));
  for (const gr of src.groups) out.addGroup(gr.start, gr.count, gr.materialIndex);
  if (src !== g) src.dispose();
  return out;
}
