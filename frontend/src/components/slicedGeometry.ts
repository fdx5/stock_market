import * as THREE from "three";
import { frameSlice } from "./frameSlice";

/** A builder's number array as a Float32Array, a few ms at a time (the same values
 * `new Float32Array(numbers)` gives: a road network's millions at once held a frame). */
export async function float32Sliced(numbers: readonly number[], budgetMs = 4) {
  const out = new Float32Array(numbers.length);
  let t0 = performance.now();
  for (let i = 0; i < numbers.length; i++) {
    if ((i & 65535) === 65535 && performance.now() - t0 > budgetMs) { await frameSlice(); t0 = performance.now(); }
    out[i] = numbers[i];
  }
  return out;
}

/** BufferGeometry.computeVertexNormals for a geometry without an index, a few ms at a time: each
 * triangle's face normal on its three corners, stored and then normalized in float32 exactly as
 * three does it (the same bits), but not in one piece — on a road network's asphalt and paint
 * that was a frame of 20-40 ms. */
export async function flatNormalsSliced(geo: THREE.BufferGeometry, budgetMs = 4) {
  const P = geo.getAttribute("position").array as ArrayLike<number>, n = P.length - (P.length % 9);
  const N = new Float32Array(P.length);
  let t0 = performance.now();
  for (let i = 0; i < n; i += 9) {
    if (i % 9216 === 0 && performance.now() - t0 > budgetMs) { await frameSlice(); t0 = performance.now(); }
    // (three: cb = C − B, ab = A − B, cb × ab, set on all three corners)
    const cbx = P[i + 6] - P[i + 3], cby = P[i + 7] - P[i + 4], cbz = P[i + 8] - P[i + 5];
    const abx = P[i] - P[i + 3], aby = P[i + 1] - P[i + 4], abz = P[i + 2] - P[i + 5];
    N[i] = N[i + 3] = N[i + 6] = cby * abz - cbz * aby;
    N[i + 1] = N[i + 4] = N[i + 7] = cbz * abx - cbx * abz;
    N[i + 2] = N[i + 5] = N[i + 8] = cbx * aby - cby * abx;
  }
  // (normalizeNormals: the stored float32 values, divided by their length)
  for (let i = 0; i < N.length; i += 3) {
    if (i % 9216 === 0 && performance.now() - t0 > budgetMs) { await frameSlice(); t0 = performance.now(); }
    const x = N[i], y = N[i + 1], z = N[i + 2], s = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    N[i] = x * s; N[i + 1] = y * s; N[i + 2] = z * s;
  }
  geo.setAttribute("normal", new THREE.BufferAttribute(N, 3));
}
