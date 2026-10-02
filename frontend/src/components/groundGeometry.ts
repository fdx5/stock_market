import * as THREE from "three";
import { gridNormals, type Terrain } from "./sceneTerrain";

export async function makeGroundGeometry(T: number, G: number, terrain: Terrain, segs: number, pace: () => Promise<boolean>) {
  const geo = new THREE.PlaneGeometry(2, 2, segs, segs);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute, uvA = geo.getAttribute("uv") as THREE.BufferAttribute;
  const P = pos.array as Float32Array, UV = uvA.array as Float32Array;
  const a = 0.84;
  const f = (u: number) => { const s = Math.sign(u), v = Math.abs(u); return s * (v <= a ? (v / a) * T : T + (G - T) * ((v - a) / (1 - a)) ** 2); };
  // The grid's world coordinates, once per column and row (PlaneGeometry: x left to right,
  // rows from y = +1 down).
  const row = segs + 1, xs = new Float64Array(row), ys = new Float64Array(row);
  for (let k = 0; k < row; k++) { xs[k] = f((k / segs) * 2 - 1); ys[k] = f(1 - (k / segs) * 2); }
  // (a fine grid is 100k terrain lookups: laid a few rows at a time)
  for (let j = 0; j < row; j++) {
    const y = ys[j];
    for (let i = 0; i < row; i++) {
      const k = j * row + i, x = xs[i], z = terrain.at(x, y);
      P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z;
      UV[k * 2] = (x + T) / (2 * T); UV[k * 2 + 1] = (y + T) / (2 * T);
    }
    if (!await pace()) return null;
  }
  // Normals straight from the height grid (sceneTerrain.gridNormals): the same smooth shading as
  // computeVertexNormals, without its pass over 200k triangles.
  geo.userData.grid = { xs, ys };
  if (!await pace()) return null;
  gridNormals(geo);
  pos.needsUpdate = true; uvA.needsUpdate = true;
  geo.computeBoundingSphere();
  return geo;
}
