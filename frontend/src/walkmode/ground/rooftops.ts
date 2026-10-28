import * as THREE from "three";
import type { World } from "../../drivegame/world/World";

/* The roofs of the town's buildings as the walk sees them. The drive world closes each building
 * with a flat lid in its ground's colour (and its own ear clipping gave up on some outlines, leaving
 * holes): from the street and from a block's balcony they read as walls cut off. Here each building
 * within reach gets what a Korean roof has: a parapet (its outer face, inner face and a metal cap),
 * the deck in green urethane waterproofing (most low blocks) or grey concrete, a stair house (옥탑)
 * with its door, a water tank, outdoor AC units, and on the tall blocks a lift machine room. Built in
 * 150 m chunks round the walker (one merged, vertex-coloured mesh each), let go 450 m behind. */

const CHUNK = 150, NEAR = 330, DROP = 450;
const hash = (x: number, y: number) => { let h = Math.imul(Math.round(x * 10) | 0, 73856093) ^ Math.imul(Math.round(y * 10) | 0, 19349663); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const rngOf = (seed: number) => { let s = (seed * 4294967296) >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; };

class Buf {
  p: number[] = []; n: number[] = []; c: number[] = []; uv: number[] = []; i: number[] = [];
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, col: number[], u: number, v: number) {
    this.p.push(x, z, -y); this.n.push(nx, nz, -ny); this.c.push(col[0], col[1], col[2]); this.uv.push(u, v); return this.p.length / 3 - 1;
  }
  /** a quad a b c d (frame x y z), facing n */
  quad(a: number[], b: number[], c: number[], d: number[], n: number[], col: number[]) {
    const uvOf = (q: number[]) => Math.abs(n[2]) > 0.5 ? [q[0] / 2.7, q[1] / 2.7] : [(q[0] * -n[1] + q[1] * n[0]) / 2.7, q[2] / 2.7];
    const k = [a, b, c, d].map(q => { const [u, v] = uvOf(q); return this.vert(q[0], q[1], q[2], n[0], n[1], n[2], col, u, v); });
    this.i.push(k[0], k[1], k[2], k[0], k[2], k[3]);
  }
  /** an upright box: centre (x, y), base z, size w × d × h, turned by a */
  box(x: number, y: number, z: number, w: number, d: number, h: number, a: number, col: number[], top = col) {
    const cs = Math.cos(a), sn = Math.sin(a), P = (u: number, v: number, zz: number) => [x + cs * u - sn * v, y + sn * u + cs * v, zz];
    const hw = w / 2, hd = d / 2;
    const c = [P(-hw, -hd, 0), P(hw, -hd, 0), P(hw, hd, 0), P(-hw, hd, 0)];
    for (let e = 0; e < 4; e++) {
      const p0 = c[e], p1 = c[(e + 1) % 4], ex = p1[0] - p0[0], ey = p1[1] - p0[1], l = Math.hypot(ex, ey) || 1;
      this.quad([p0[0], p0[1], z], [p1[0], p1[1], z], [p1[0], p1[1], z + h], [p0[0], p0[1], z + h], [ey / l, -ex / l, 0], col);
    }
    this.quad([c[0][0], c[0][1], z + h], [c[1][0], c[1][1], z + h], [c[2][0], c[2][1], z + h], [c[3][0], c[3][1], z + h], [0, 0, 1], top);
  }
  /** an upright 8-sided drum */
  drum(x: number, y: number, z: number, r: number, h: number, col: number[]) {
    for (let e = 0; e < 8; e++) {
      const a0 = e / 8 * Math.PI * 2, a1 = (e + 1) / 8 * Math.PI * 2, am = (a0 + a1) / 2;
      const p0 = [x + Math.cos(a0) * r, y + Math.sin(a0) * r], p1 = [x + Math.cos(a1) * r, y + Math.sin(a1) * r];
      this.quad([p0[0], p0[1], z], [p1[0], p1[1], z], [p1[0], p1[1], z + h], [p0[0], p0[1], z + h], [Math.cos(am), Math.sin(am), 0], col);
    }
    const base = this.vert(x, y, z + h, 0, 0, 1, col, x / 2.7, y / 2.7);
    for (let e = 0; e < 8; e++) {
      const a0 = e / 8 * Math.PI * 2, a1 = (e + 1) / 8 * Math.PI * 2;
      const v0 = this.vert(x + Math.cos(a0) * r, y + Math.sin(a0) * r, z + h, 0, 0, 1, col, 0, 0), v1 = this.vert(x + Math.cos(a1) * r, y + Math.sin(a1) * r, z + h, 0, 0, 1, col, 0, 0);
      this.i.push(base, v0, v1);
    }
  }
}

function inRing(x: number, y: number, r: ArrayLike<number>) {
  let hit = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) if ((r[i + 1] > y) !== (r[j + 1] > y) && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) hit = !hit;
  return hit;
}

/** one building's roof */
function roofOf(B: Buf, ring: Float32Array, top: number, ground: number) {
  const m = ring.length / 2; if (m < 3) return;
  let area = 0, cx = 0, cy = 0;
  for (let k = 0; k < m; k++) { const x1 = ring[k * 2], y1 = ring[k * 2 + 1], x2 = ring[((k + 1) % m) * 2], y2 = ring[((k + 1) % m) * 2 + 1]; area += x1 * y2 - x2 * y1; cx += x1; cy += y1; }
  area /= 2; cx /= m; cy /= m;
  const ccw = area > 0, A = Math.abs(area), height = top - ground, tall = height > 24;
  const R = rngOf(hash(ring[0], ring[1]));
  // the deck: green urethane on most low blocks, grey concrete (or a light coating) on the rest
  const deckKind = R(), green = !tall && deckKind < 0.62;
  const shade = 0.92 + R() * 0.12;
  const deck = green ? [0.17 * shade, 0.28 * shade, 0.2 * shade] : deckKind < 0.85 ? [0.43 * shade, 0.43 * shade, 0.42 * shade] : [0.56 * shade, 0.57 * shade, 0.56 * shade];
  const wall = [0.46 * shade, 0.45 * shade, 0.43 * shade], cap = [0.62, 0.63, 0.64], inner = [0.38 * shade, 0.37 * shade, 0.36 * shade];
  const ph = tall ? 1.2 : 0.75 + R() * 0.35, th = 0.22, z0 = top - 0.04, zd = top + 0.03;
  // parapet: each edge's outer face, inner face and cap (the outward normal of an anticlockwise ring
  // is (ey, −ex))
  for (let k = 0; k < m; k++) {
    const a = ccw ? k : m - 1 - k, b = ccw ? (k + 1) % m : (m - 2 - k + m) % m;
    const ax = ring[a * 2], ay = ring[a * 2 + 1], bx = ring[b * 2], by = ring[b * 2 + 1], ex = bx - ax, ey = by - ay, l = Math.hypot(ex, ey);
    if (l < 0.3) continue;
    const ox = ey / l, oy = -ex / l, ix = -ox * th, iy = -oy * th;
    B.quad([ax, ay, z0], [bx, by, z0], [bx, by, top + ph], [ax, ay, top + ph], [ox, oy, 0], wall);
    B.quad([bx + ix, by + iy, zd], [ax + ix, ay + iy, zd], [ax + ix, ay + iy, top + ph], [bx + ix, by + iy, top + ph], [-ox, -oy, 0], inner);
    B.quad([ax, ay, top + ph], [bx, by, top + ph], [bx + ix, by + iy, top + ph + 0.02], [ax + ix, ay + iy, top + ph + 0.02], [0, 0, 1], cap);
  }
  // the deck (earcut: no outline left open)
  const contour: THREE.Vector2[] = [];
  for (let k = 0; k < m; k++) contour.push(new THREE.Vector2(ring[k * 2], ring[k * 2 + 1]));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const base = B.p.length / 3;
  for (const v of contour) B.vert(v.x, v.y, zd, 0, 0, 1, deck, v.x / 2.7, v.y / 2.7);
  for (const t of tris) { const [p, q, r] = ccw ? t : [t[0], t[2], t[1]]; B.i.push(base + p, base + q, base + r); }
  // the longest edge's direction: what stands on the roof is set square to the building
  let best = 0, ang = 0;
  for (let k = 0; k < m; k++) { const ex = ring[((k + 1) % m) * 2] - ring[k * 2], ey = ring[((k + 1) % m) * 2 + 1] - ring[k * 2 + 1], l = Math.hypot(ex, ey); if (l > best) { best = l; ang = Math.atan2(ey, ex); } }
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const fits = (x: number, y: number, w: number, d: number, a: number) => {
    const c = Math.cos(a), s = Math.sin(a);
    for (const [u, v] of [[-w / 2 - 0.6, -d / 2 - 0.6], [w / 2 + 0.6, -d / 2 - 0.6], [w / 2 + 0.6, d / 2 + 0.6], [-w / 2 - 0.6, d / 2 + 0.6], [0, 0]]) if (!inRing(x + c * u - s * v, y + s * u + c * v, ring)) return false;
    return true;
  };
  const spot = (w: number, d: number, tries = 8): [number, number] | null => {
    for (let t = 0; t < tries; t++) {
      const x = cx + (R() - 0.5) * Math.sqrt(A) * 0.6 * (t ? 1 : 0), y = cy + (R() - 0.5) * Math.sqrt(A) * 0.6 * (t ? 1 : 0);
      if (fits(x, y, w, d, ang)) return [x, y];
    }
    return null;
  };
  if (A < 40) return;
  // the stair house (옥탑): painted block, a darker steel door, a thin slab over it
  if (A > 90) {
    const w = tall ? 6 + R() * 3 : 3 + R() * 1.5, d = tall ? 4.5 + R() * 2 : 3.6 + R() * 1.2, h = tall ? 3.4 : 2.6 + R() * 0.4, at = spot(w, d);
    if (at) {
      const paint = R() < 0.5 ? [0.74, 0.73, 0.7] : [0.6, 0.6, 0.58];
      B.box(at[0], at[1], zd, w, d, h, ang, paint, [0.4, 0.4, 0.4]);
      B.box(at[0], at[1], zd + h, w + 0.4, d + 0.4, 0.12, ang, [0.5, 0.5, 0.5]);
      // the door on its long side
      const fx = at[0] - sn * (d / 2 + 0.01), fy = at[1] + cs * (d / 2 + 0.01);
      B.quad([fx - cs * 0.45, fy - sn * 0.45, zd], [fx + cs * 0.45, fy + sn * 0.45, zd], [fx + cs * 0.45, fy + sn * 0.45, zd + 2.05], [fx - cs * 0.45, fy - sn * 0.45, zd + 2.05], [-sn, cs, 0], [0.24, 0.27, 0.3]);
      // a tall block's lift machine room beside it
      if (tall) { const at2 = spot(3.2, 3.2); if (at2) B.box(at2[0], at2[1], zd, 3.2, 3.2, 2.4, ang, paint, [0.38, 0.38, 0.38]); }
    }
  }
  // a water tank (old low blocks), on a little steel stand
  if (!tall && R() < 0.5 && A > 70) {
    const at = spot(2.4, 2.4);
    if (at) {
      const col = R() < 0.6 ? [0.32, 0.5, 0.72] : [0.8, 0.8, 0.77];
      B.box(at[0], at[1], zd, 2.2, 2.2, 0.35, ang, [0.3, 0.3, 0.32]);
      B.drum(at[0], at[1], zd + 0.35, 1.0, 1.5, col);
    }
  }
  // outdoor AC units in a row (low blocks: the shops' and offices' condensers)
  if (!tall) {
    const n = Math.floor(R() * (A > 300 ? 7 : 4));
    const at = spot(n * 1.0 + 0.4, 1.0);
    if (at && n) for (let k = 0; k < n; k++) {
      const u = (k - (n - 1) / 2) * 1.0;
      B.box(at[0] + cs * u, at[1] + sn * u, zd + 0.1, 0.85, 0.35, 0.68, ang, [0.84, 0.85, 0.85], [0.7, 0.7, 0.7]);
    }
  }
}

export class Rooftops {
  readonly group = new THREE.Group();
  private chunks = new Map<string, THREE.Mesh | null>();
  private material: THREE.MeshStandardMaterial;
  private detail: THREE.Texture;
  private building = false;
  constructor(private world: World) {
    this.detail = new THREE.TextureLoader().load("/3d/detail-concrete.webp");
    this.detail.wrapS = this.detail.wrapT = THREE.RepeatWrapping; this.detail.colorSpace = THREE.SRGBColorSpace; this.detail.anisotropy = 8;
    // (the concrete's grain over the vertex colours; drawn a hair in front of the drive world's lid)
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, map: this.detail, roughness: 0.88, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.material.onBeforeCompile = sh => {
      // (the grain toned down to a hint, its brightness kept round 1)
      sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", "vec4 sampledDiffuseColor = texture2D( map, vMapUv ); diffuseColor.rgb *= mix(vec3(1.0), sampledDiffuseColor.rgb * 1.9, 0.55);");
    };
    this.material.customProgramCacheKey = () => "walkRoof1";
  }
  /** every quarter second: the chunks within reach built (one per call), the far ones let go */
  update(x: number, y: number) {
    for (const [k, mesh] of this.chunks) {
      const [i, j] = k.split(":").map(Number);
      if (Math.hypot((i + 0.5) * CHUNK - x, (j + 0.5) * CHUNK - y) > DROP) { if (mesh) { mesh.geometry.dispose(); mesh.removeFromParent(); } this.chunks.delete(k); }
    }
    if (this.building) return;
    let want: [number, number] | null = null, wd = Infinity;
    for (let i = Math.floor((x - NEAR) / CHUNK); i <= Math.floor((x + NEAR) / CHUNK); i++) for (let j = Math.floor((y - NEAR) / CHUNK); j <= Math.floor((y + NEAR) / CHUNK); j++) {
      const d = Math.hypot((i + 0.5) * CHUNK - x, (j + 0.5) * CHUNK - y);
      if (d > NEAR + CHUNK * 0.7 || this.chunks.has(`${i}:${j}`) || d >= wd) continue;
      // (a chunk whose tiles are not all shown yet waits: its footprints are still coming)
      if (this.world.readiness((i + 0.5) * CHUNK, (j + 0.5) * CHUNK, CHUNK * 0.75) < 0.95) continue;
      want = [i, j]; wd = d;
    }
    if (want) this.build(want[0], want[1]);
  }
  private build(i: number, j: number) {
    this.building = true;
    const B = new Buf(), x0 = i * CHUNK, y0 = j * CHUNK;
    for (const f of this.world.footprintsIn(x0, y0, x0 + CHUNK, y0 + CHUNK)) {
      // (each building in the chunk holding its first corner: one roof, though it spans two)
      if (f.ring[0] < x0 || f.ring[0] >= x0 + CHUNK || f.ring[1] < y0 || f.ring[1] >= y0 + CHUNK) continue;
      const g = this.world.heightAt(f.ring[0], f.ring[1]);
      roofOf(B, f.ring, f.top, Number.isFinite(g) ? g : f.top - 10);
    }
    let mesh: THREE.Mesh | null = null;
    if (B.i.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(B.p, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(B.n, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(B.c, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(B.uv, 2));
      geo.setIndex(B.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(B.i, 1) : new THREE.Uint16BufferAttribute(B.i, 1));
      geo.computeBoundingSphere();
      mesh = new THREE.Mesh(geo, this.material); mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      this.group.add(mesh);
    }
    this.chunks.set(`${i}:${j}`, mesh);
    this.building = false;
  }
  dispose() {
    for (const m of this.chunks.values()) m?.geometry.dispose();
    this.chunks.clear(); this.group.removeFromParent(); this.material.dispose(); this.detail.dispose();
  }
}
