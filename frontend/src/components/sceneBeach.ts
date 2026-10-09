import * as THREE from "three";
import type { Terrain } from "./sceneTerrain";
import type { Pace, WaterField } from "./waterCore";
import { rng } from "./complexScene";

/* The beaches (OpenStreetMap natural=beach, /api/realestate/water): sand laid over the ground
 * to each beach's outline. Dry sand pale and a little mottled; toward the water it darkens wet
 * and runs down under the sea's surface (the waterline is where the sand meets the water, not a
 * step), with the faint line of the last high water a few metres up. Built after the water, from
 * its field (where the water is and at what level). */

const DRY = new THREE.Color("#dccb9f"), DAMP = new THREE.Color("#c4ad80"), WET = new THREE.Color("#a08a62");

export async function buildBeach(rings: [number, number][][], terrain: Terrain, water: WaterField | null, pace: Pace, seed = 1) {
  if (!rings.length) return null;
  const pos: number[] = [], col: number[] = [], index: number[] = [];
  const rnd = rng(seed * 31 + 7);
  /** metres from (x, y) to the water, up to 14 (8 directions, 1 m steps) */
  const toWater = (x: number, y: number) => {
    if (!water) return 99;
    if (water.wet(x, y)) return 0;
    for (let d = 1; d <= 14; d += 1)
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        if (water.wet(x + Math.cos(a) * d, y + Math.sin(a) * d)) return d;
      }
    return 99;
  };
  const c = new THREE.Color();
  for (const ring of rings) {
    const at = new Map<string, number>();
    const pts = ring.map(([x, y]) => new THREE.Vector2(x, y));
    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    const push = (x: number, y: number) => {
      const key = `${x.toFixed(2)},${y.toFixed(2)}`;
      const had = at.get(key);
      if (had !== undefined) { index.push(had); return; }
      at.set(key, pos.length / 3); index.push(pos.length / 3);
      const d = toWater(x, y);
      let z = terrain.at(x, y) + 0.05;
      // (into the water: the sand slopes down under the surface, ~1:8)
      if (water && d < 10) {
        const lvl = water.level(x, y);
        if (Number.isFinite(lvl)) z = Math.min(z, lvl - 0.25 + d * 0.12);
      }
      pos.push(x, z, -y);
      // wet → damp → dry, the high-water line, and a mottle
      const k = THREE.MathUtils.smoothstep(d, 0.5, 6), hw = Math.exp(-((d - 8.5) ** 2) / 1.5) * 0.35;
      c.copy(WET).lerp(DAMP, k).lerp(DRY, THREE.MathUtils.smoothstep(d, 5, 11));
      c.lerp(DAMP, hw);
      const m = 1 + (rnd() - 0.5) * 0.07;
      col.push(c.r * m, c.g * m, c.b * m);
    };
    const split = (a: THREE.Vector2, b: THREE.Vector2, cc: THREE.Vector2, depth: number) => {
      const ab = a.distanceTo(b), bc = b.distanceTo(cc), ca = cc.distanceTo(a), m = Math.max(ab, bc, ca);
      if (m < 2.5 || depth > 16) { push(a.x, a.y); push(b.x, b.y); push(cc.x, cc.y); return; }
      if (m === ab) { const d = a.clone().lerp(b, 0.5); split(a, d, cc, depth + 1); split(d, b, cc, depth + 1); }
      else if (m === bc) { const d = b.clone().lerp(cc, 0.5); split(a, b, d, depth + 1); split(a, d, cc, depth + 1); }
      else { const d = cc.clone().lerp(a, 0.5); split(a, b, d, depth + 1); split(d, b, cc, depth + 1); }
    };
    for (const [i, j, k] of tris) {
      if (!await pace()) return null;
      const a = pts[i], b = pts[j], q = pts[k];
      // (wound to face up: footprint x east / y north is world (x, -y))
      if ((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x) > 0) split(a, b, q, 0); else split(a, q, b, 0);
    }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "beach sand";
  mesh.receiveShadow = true;
  mesh.renderOrder = -1;
  return { mesh, dispose: () => { geo.dispose(); mat.dispose(); } };
}

/** The strand along the sea within the view's square: the land within `width` m of the sea (its
 * rings, view frame) laid with sand — wet by the water, dry further up — over whatever lawn the
 * ground had there (made ground with no parcel of its own reads as lawn otherwise). Roads and
 * buildings stand over it as before. 2 m cells. */
export async function buildCoastFringe(seaRings: { ring: [number, number][]; holes?: [number, number][][] }[], half: number, terrain: Terrain, pace: Pace, width = 14, seed = 1) {
  if (!seaRings.length || typeof OffscreenCanvas === "undefined") return null;
  const cell = 2, n = Math.ceil((2 * half) / cell);
  // the sea on a raster (filled, its islands cut out)
  const cv = new OffscreenCanvas(n, n), g = cv.getContext("2d", { willReadFrequently: true })!;
  const X = (x: number) => (x + half) / cell, Y = (y: number) => (half - y) / cell;
  g.fillStyle = "#fff";
  for (const r of seaRings) {
    g.beginPath();
    for (const ring of [r.ring, ...(r.holes ?? [])]) ring.forEach(([x, y], k) => (k ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    g.fill("evenodd");
  }
  const sea = g.getImageData(0, 0, n, n).data;
  if (!await pace()) return null;
  const dist = new Float32Array(n * n);
  for (let o = 0; o < n * n; o++) dist[o] = sea[o * 4 + 3] > 127 ? 0 : 1e6;
  for (let y = 0; y < n; y++) { for (let x = 0; x < n; x++) { const o = y * n + x; if (!dist[o]) continue; let v = dist[o]; if (x > 0) v = Math.min(v, dist[o - 1] + 1); if (y > 0) { v = Math.min(v, dist[o - n] + 1); if (x > 0) v = Math.min(v, dist[o - n - 1] + 1.414); if (x < n - 1) v = Math.min(v, dist[o - n + 1] + 1.414); } dist[o] = v; } if (y % 64 === 63 && !await pace()) return null; }
  for (let y = n - 1; y >= 0; y--) { for (let x = n - 1; x >= 0; x--) { const o = y * n + x; if (!dist[o]) continue; let v = dist[o]; if (x < n - 1) v = Math.min(v, dist[o + 1] + 1); if (y < n - 1) { v = Math.min(v, dist[o + n] + 1); if (x < n - 1) v = Math.min(v, dist[o + n + 1] + 1.414); if (x > 0) v = Math.min(v, dist[o + n - 1] + 1.414); } dist[o] = v; } if (y % 64 === 0 && !await pace()) return null; }
  const band = width / cell;
  const pos: number[] = [], col: number[] = [], index: number[] = [], at = new Map<number, number>();
  const rnd = rng(seed * 53 + 11), c = new THREE.Color();
  const vert = (i: number, j: number, d: number) => {
    const key = j * (n + 1) + i, had = at.get(key);
    if (had !== undefined) return had;
    const x = -half + i * cell, y = half - j * cell;
    at.set(key, pos.length / 3);
    pos.push(x, terrain.at(x, y) + 0.03, -y);
    const k = THREE.MathUtils.smoothstep(d * cell, 1, 6);
    c.copy(WET).lerp(DAMP, k).lerp(DRY, THREE.MathUtils.smoothstep(d * cell, 5, 12));
    const m = 1 + (rnd() - 0.5) * 0.07;
    col.push(c.r * m, c.g * m, c.b * m);
    return at.get(key)!;
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const d = dist[j * n + i];
    if (!d || d > band) continue;
    const a = vert(i, j, d), b = vert(i + 1, j, d), e = vert(i + 1, j + 1, d), f = vert(i, j + 1, d);
    index.push(a, f, e, a, e, b);
  }
  if (!index.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "coast strand";
  mesh.receiveShadow = true;
  mesh.renderOrder = -1;
  return { mesh, dispose: () => { geo.dispose(); mat.dispose(); } };
}
