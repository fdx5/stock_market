import * as THREE from 'three';
import { coastField, type CoastData } from './coastField';

/** Split ground at actual coast/island segments before lowering just its wet pieces.
 * Vertex-only sinking leaves dry corners interpolated above sea inside a triangle.
 * Runs in the bounded coast worker; no per-frame polygon tests or regional exceptions. */
export function sinkSeaGeometry(source: THREE.BufferGeometry, data: CoastData, heightOffset = 0, removeWet = false) {
  const field = coastField(data), attrs = Object.entries(source.attributes) as [string, THREE.BufferAttribute][];
  const offsets: number[] = []; let stride = 0;
  for (const [, a] of attrs) { offsets.push(stride); stride += a.itemSize; }
  const po = offsets[attrs.findIndex(([name]) => name === 'position')];
  const no = offsets[attrs.findIndex(([name]) => name === 'normal')];
  type Edge = { a: [number, number]; b: [number, number] };
  const edges: Edge[] = [], bins = new Map<string, number[]>(), cell = 128;
  for (const ring of [...data.rings, ...data.holes]) ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-8) return;
    const id = edges.length; edges.push({ a, b });
    for (let x = Math.floor(Math.min(a[0], b[0]) / cell); x <= Math.floor(Math.max(a[0], b[0]) / cell); x++)
      for (let y = Math.floor(Math.min(a[1], b[1]) / cell); y <= Math.floor(Math.max(a[1], b[1]) / cell); y++) {
        const key = x + ':' + y, row = bins.get(key) ?? []; row.push(id); bins.set(key, row);
      }
  });
  const vertex = (i: number) => attrs.flatMap(([, a]) => Array.from({ length: a.itemSize }, (_, k) => a.array[i * a.itemSize + k]));
  const cross = (e: Edge, p: number[]) => (e.b[0] - e.a[0]) * (p[po + 1] - e.a[1]) - (e.b[1] - e.a[1]) * (p[po] - e.a[0]);
  const half = (poly: number[][], e: Edge, sign: number) => {
    const out: number[][] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], dp = cross(e, p) * sign, dq = cross(e, q) * sign;
      if (dp >= -1e-8) out.push(p);
      if ((dp < -1e-8) !== (dq < -1e-8)) { const t = dp / (dp - dq); out.push(p.map((v, k) => v + (q[k] - v) * t)); }
    }
    return out;
  };
  const values = attrs.map(() => [] as number[]), index: number[] = [], originals = new Map<number, number>();
  const push = (v: number[], wet: boolean) => {
    const id = values[0].length / attrs[0][1].itemSize, p = v.slice();
    if (wet) {
      p[po + 2] = Math.min(p[po + 2], data.level - .6 - heightOffset);
      if (no !== undefined) { p[no] = 0; p[no + 1] = 0; p[no + 2] = 1; }
    }
    attrs.forEach(([, a], k) => { for (let j = 0; j < a.itemSize; j++) values[k].push(p[offsets[k] + j]); });
    return id;
  };
  const count = source.index?.count ?? source.getAttribute('position').count;
  for (let k = 0; k < count; k += 3) {
    const ids = [0, 1, 2].map(j => source.index?.getX(k + j) ?? k + j), original = ids.map(vertex);
    const xs = original.map(p => p[po]), ys = original.map(p => p[po + 1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), candidates = new Set<number>();
    for (let x = Math.floor(x0 / cell); x <= Math.floor(x1 / cell); x++)
      for (let y = Math.floor(y0 / cell); y <= Math.floor(y1 / cell); y++) for (const id of bins.get(x + ':' + y) ?? []) candidates.add(id);
    let pieces = [original];
    for (const id of candidates) {
      const e = edges[id];
      if (Math.max(e.a[0], e.b[0]) < x0 || Math.min(e.a[0], e.b[0]) > x1 || Math.max(e.a[1], e.b[1]) < y0 || Math.min(e.a[1], e.b[1]) > y1) continue;
      pieces = pieces.flatMap(poly => {
        const d = poly.map(p => cross(e, p));
        return Math.min(...d) < -1e-7 && Math.max(...d) > 1e-7 ? [half(poly, e, 1), half(poly, e, -1)] : [poly];
      });
    }
    for (const poly of pieces) {
      const wet = field.wet(poly.reduce((s, p) => s + p[po], 0) / poly.length, poly.reduce((s, p) => s + p[po + 1], 0) / poly.length);
      if(wet&&removeWet)continue;
      if (poly === original) {
        for (let j = 0; j < 3; j++) {
          const key = ids[j] * 2 + Number(wet); let id = originals.get(key);
          if (id === undefined) { id = push(original[j], wet); originals.set(key, id); }
          index.push(id);
        }
        continue;
      }
      for (let j = 1; j + 1 < poly.length; j++) {
        const a = poly[0], b = poly[j], c = poly[j + 1];
        if (Math.abs((b[po] - a[po]) * (c[po + 1] - a[po + 1]) - (b[po + 1] - a[po + 1]) * (c[po] - a[po])) < 1e-8) continue;
        index.push(push(a, wet), push(b, wet), push(c, wet));
      }
    }
  }
  const out = new THREE.BufferGeometry();
  attrs.forEach(([name, a], k) => out.setAttribute(name, new THREE.Float32BufferAttribute(values[k], a.itemSize, a.normalized)));
  out.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1)); out.computeBoundingSphere();
  return out;
}

/** A tidal river must relinquish only the part covered by the continuous sea.
 * Keep inland river triangles and their heights, with exact coast intersections. */
export function waterOutsideCoast(source:THREE.BufferGeometry,data:CoastData,matrix:THREE.Matrix4){
  const world=source.clone();world.applyMatrix4(matrix);world.rotateX(Math.PI/2);
  const out=sinkSeaGeometry(world,data,0,true);world.dispose();
  out.rotateX(-Math.PI/2);out.applyMatrix4(matrix.clone().invert());out.computeBoundingSphere();return out;
}
