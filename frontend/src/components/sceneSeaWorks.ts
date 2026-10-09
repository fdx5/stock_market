import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { rng } from "./complexScene";

/* The sea works (OpenStreetMap man_made=breakwater, groyne, pier; the site's bundled copy,
 * /api/realestate/water): a concrete crown standing out of the water on each — a breakwater
 * 8 m wide, a groyne or a pier 5 m, its deck 2.2 m over the sea, its sides down into it — and
 * along the breakwaters and groynes, both sides, banks of tetrapods (소파블록) heaped against
 * them: one instanced draw, capped in number. Coordinates: x east, y north (the view frame or a
 * drone tile's); `level` the sea's height there. */

export type SeaWork = { kind: string; closed: boolean; pts: [number, number][] };

const CROWN = 2.2, FOOT = -1.6;
const WIDTH: Record<string, number> = { breakwater: 8, groyne: 5, pier: 5 };

let tetra: THREE.BufferGeometry | null = null;
/** One tetrapod (about 2.6 m across): four tapered legs from its centre, along a tetrahedron's axes. */
function tetrapod() {
  if (tetra) return tetra;
  const dirs = [new THREE.Vector3(1, 1, 1), new THREE.Vector3(-1, -1, 1), new THREE.Vector3(-1, 1, -1), new THREE.Vector3(1, -1, -1)].map(v => v.normalize());
  const legs = dirs.map(d => {
    const g = new THREE.CylinderGeometry(0.26, 0.42, 1.3, 7, 1, false);
    g.translate(0, 0.65, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
    g.deleteAttribute("uv");
    return g;
  });
  tetra = mergeGeometries(legs, false)!;
  tetra.computeVertexNormals();
  return tetra;
}

export function buildSeaWorks(works: SeaWork[], level: number, seed = 1, opts: { tetrapods?: boolean; maxTetrapods?: number } = {}) {
  if (!works.length || !Number.isFinite(level)) return null;
  const pos: number[] = [], index: number[] = [];
  const top = level + CROWN, foot = level + FOOT;
  const quad = (a: number, b: number, c: number, d: number) => index.push(a, b, c, a, c, d);
  /** a wall from (x0, y0) to (x1, y1), its face outward to the right */
  const wall = (x0: number, y0: number, x1: number, y1: number) => {
    const k = pos.length / 3;
    pos.push(x0, top, -y0, x1, top, -y1, x1, foot, -y1, x0, foot, -y0);
    quad(k, k + 3, k + 2, k + 1);
  };
  const deck = (ring: [number, number][]) => {
    const pts = ring.map(([x, y]) => new THREE.Vector2(x, y));
    const k = pos.length / 3;
    for (const p of pts) pos.push(p.x, top, -p.y);
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(pts, [])) index.push(k + a, k + c, k + b);
  };
  /** where the tetrapods go: each side of a work, its outward normal and how far out it starts */
  const sides: { x0: number; y0: number; x1: number; y1: number; nx: number; ny: number; off: number }[] = [];
  for (const w of works) {
    const half = (WIDTH[w.kind] ?? 5) / 2;
    if (w.closed && w.pts.length >= 4) {
      const ring = w.pts.slice(0, -1) as [number, number][];
      const ccw = ring.reduce((a, [x, y], i) => { const q = ring[(i + 1) % ring.length]; return a + x * q[1] - q[0] * y; }, 0) > 0;
      const r = ccw ? ring : [...ring].reverse();
      deck(r);
      for (let i = 0; i < r.length; i++) {
        const [x0, y0] = r[i], [x1, y1] = r[(i + 1) % r.length];
        wall(x1, y1, x0, y0);
        const L = Math.hypot(x1 - x0, y1 - y0) || 1;
        // (outward, for a ring wound anticlockwise: the right of each edge)
        if (w.kind !== "pier") sides.push({ x0, y0, x1, y1, nx: (y1 - y0) / L, ny: -(x1 - x0) / L, off: 0 });
      }
    } else {
      // a line: a strip `half` each side, closed at its ends
      const P = w.pts, n = P.length, left: [number, number][] = [], right: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
        left.push([P[i][0] + nx * half, P[i][1] + ny * half]); right.push([P[i][0] - nx * half, P[i][1] - ny * half]);
        if (w.kind !== "pier" && i > 0) {
          const [x0, y0] = P[i - 1], [x1, y1] = P[i], l = Math.hypot(x1 - x0, y1 - y0) || 1, sx = -(y1 - y0) / l, sy = (x1 - x0) / l;
          sides.push({ x0, y0, x1, y1, nx: sx, ny: sy, off: half }, { x0, y0, x1, y1, nx: -sx, ny: -sy, off: half });
        }
      }
      const ring = [...right, ...left.reverse()];
      deck(ring);
      for (let i = 0; i < ring.length; i++) { const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length]; wall(x1, y1, x0, y0); }
    }
  }
  const group = new THREE.Group();
  group.name = "sea works";
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const concrete = new THREE.MeshStandardMaterial({ color: "#b7b3aa", roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
  const crown = new THREE.Mesh(geo, concrete);
  crown.name = "sea works crown";
  crown.castShadow = crown.receiveShadow = true;
  group.add(crown);
  const disposeAll: (() => void)[] = [() => { geo.dispose(); concrete.dispose(); }];
  // The tetrapods: heaped along both sides, ~1.6 m apart in three rows going out and down.
  if (opts.tetrapods !== false && sides.length) {
    const rnd = rng(seed * 977 + 13), max = opts.maxTetrapods ?? 6000, q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
    const mats: THREE.Matrix4[] = [];
    for (const sd of sides) {
      const sl = Math.hypot(sd.x1 - sd.x0, sd.y1 - sd.y0);
      for (let t = 0.8; t < sl && mats.length < max; t += 1.6) {
        const f = t / sl, x = sd.x0 + (sd.x1 - sd.x0) * f, y = sd.y0 + (sd.y1 - sd.y0) * f;
        for (let row = 0; row < 3 && mats.length < max; row++) {
          const off = sd.off + 1.1 + row * 1.7 + (rnd() - 0.5) * 0.8;
          const px = x + sd.nx * off + (rnd() - 0.5) * 0.7, py = y + sd.ny * off + (rnd() - 0.5) * 0.7;
          // (heaped: highest against the crown, down into the water further out)
          const z = level + CROWN - 0.9 - row * 1.25 + (rnd() - 0.5) * 0.6;
          e.set(rnd() * Math.PI * 2, rnd() * Math.PI * 2, rnd() * Math.PI * 2); q.setFromEuler(e);
          const k = 0.9 + rnd() * 0.2; sc.set(k, k, k);
          mats.push(new THREE.Matrix4().compose(new THREE.Vector3(px, z, -py), q, sc));
        }
      }
    }
    if (mats.length) {
      const pod = new THREE.MeshStandardMaterial({ color: "#c4c0b6", roughness: 0.92, metalness: 0 });
      const inst = new THREE.InstancedMesh(tetrapod(), pod, mats.length);
      mats.forEach((mm, k) => inst.setMatrixAt(k, mm));
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      inst.name = "tetrapods";
      inst.castShadow = inst.receiveShadow = true;
      group.add(inst);
      disposeAll.push(() => { pod.dispose(); inst.dispose(); });
    }
  }
  group.updateMatrixWorld(true);
  return { group, dispose: () => disposeAll.forEach(f => f()) };
}
