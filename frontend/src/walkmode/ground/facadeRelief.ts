import * as THREE from "three";
import type { World } from "../../drivegame/world/World";

/* The walls' relief, in three dimensions, near the walker. The drive world's walls are flat and the
 * facade shader (ground/facades.ts) paints each style's windows on them, on a grid it reads from the
 * wall's uv: metres along world x or y (whichever the wall follows) in bays of BW, and "scaled
 * metres" up it in floors of FH above a base, h = 1 − kv + kv·(z − g0). Here the same grid, in the
 * same numbers, gets what stands proud of a real wall, so the painted windows are framed in depth:
 *   apt     each floor's slab edge; a balcony's glass balustrade and its rail along every bay
 *   villa   stone sills, the outdoor AC units on their brackets under some windows, security grilles
 *           on the ground floor, drainpipes down the corners
 *   shop    the shopfronts' piers, a sign band over each tenant (6.4 m, as the shader's), sills above
 *   office  vertical mullion fins at every bay, a transom at each spandrel
 *   all     a granite plinth
 * Built in 80 m chunks round the walker (three merged meshes each: matte, metal, glass), let go
 * behind; only the lower 45 m of a wall (beyond, the relief reads as the paint it frames). */

const CHUNK = 80, NEAR = 150, DROP = 230, MAX_UP = 45;
// (the facade shader's grid: floor height, bay width, base, window cell (x0, y0, x1, y1))
const GRID = [
  { FH: 2.9, BW: 3.4, base: 1.1, w: [0.32, 0.38, 3.08, 2.48] },   // apt
  { FH: 2.9, BW: 3.0, base: 1.1, w: [0.7, 0.95, 2.3, 2.35] },     // villa
  { FH: 3.4, BW: 2.6, base: 4.2, w: [0.4, 0.9, 2.2, 2.8] },       // shop (upper floors)
  { FH: 3.8, BW: 1.6, base: 1.1, w: [0.06, 1.05, 1.54, 3.72] },   // office
];
const hash = (x: number, y: number) => { let h = Math.imul(Math.round(x * 10) | 0, 73856093) ^ Math.imul(Math.round(y * 10) | 0, 19349663); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

class Buf {
  p: number[] = []; n: number[] = []; c: number[] = []; i: number[] = [];
  private v(x: number, y: number, z: number, n: number[], col: number[]) { this.p.push(x, z, -y); this.n.push(n[0], n[2], -n[1]); this.c.push(col[0], col[1], col[2]); return this.p.length / 3 - 1; }
  quad(a: number[], b: number[], c: number[], d: number[], n: number[], col: number[]) {
    const k = [a, b, c, d].map(q => this.v(q[0], q[1], q[2], n, col)); this.i.push(k[0], k[1], k[2], k[0], k[2], k[3]);
  }
  /** a box on a wall: along it from t0 to t1, out from it o0 to o1, up z0 to z1 (P maps (t, out, z)
   * to the frame); its back face left out (against the wall) */
  slab(P: (t: number, o: number, z: number) => number[], tn: number[], on: number[], t0: number, t1: number, o0: number, o1: number, z0: number, z1: number, col: number[], top = col) {
    const A = P(t0, o1, z0), B = P(t1, o1, z0), C = P(t1, o1, z1), D = P(t0, o1, z1);
    this.quad(A, B, C, D, on, col);                                                         // front
    this.quad(D, C, P(t1, o0, z1), P(t0, o0, z1), [0, 0, 1], top);                           // top
    this.quad(P(t0, o0, z0), P(t1, o0, z0), B, A, [0, 0, -1], col.map(x => x * 0.6));        // under
    this.quad(P(t0, o0, z0), A, D, P(t0, o0, z1), tn.map(x => -x), col.map(x => x * 0.85));  // ends
    this.quad(B, P(t1, o0, z0), P(t1, o0, z1), C, tn, col.map(x => x * 0.85));
  }
  mesh(m: THREE.Material, shadow: boolean) {
    if (!this.i.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, m); mesh.castShadow = shadow; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    return mesh;
  }
}

function reliefOf(M: Buf, Me: Buf, G: Buf, ring: Float32Array, style: number, top: number, g0: number, kv: number) {
  const m = ring.length / 2, grid = GRID[style];
  if (m < 3 || !grid || !(kv > 0)) return;
  const zOf = (h: number) => g0 + (h - 1 + kv) / kv;                       // the shader's h → world z
  const hTop = 1 - kv + kv * Math.min(top - g0, MAX_UP);
  let area = 0; for (let k = 0; k < m; k++) area += ring[k * 2] * ring[((k + 1) % m) * 2 + 1] - ring[((k + 1) % m) * 2] * ring[k * 2 + 1];
  const ccw = area > 0;
  const stone = [0.62, 0.6, 0.56], granite = [0.24, 0.24, 0.25], metal = [0.36, 0.37, 0.39], dark = [0.12, 0.13, 0.14];
  for (let k = 0; k < m; k++) {
    const a = ccw ? k : (k + 1) % m, b = ccw ? (k + 1) % m : k;
    const ax = ring[a * 2], ay = ring[a * 2 + 1], bx = ring[b * 2], by = ring[b * 2 + 1], len = Math.hypot(bx - ax, by - ay);
    if (len < 2.5) continue;
    const tx = (bx - ax) / len, ty = (by - ay) / len, ox = ty, oy = -tx, tn = [tx, ty, 0], on = [ox, oy, 0];
    const P = (t: number, o: number, z: number) => [ax + tx * t + ox * o, ay + ty * t + oy * o, z];
    // (u: the shader's coordinate along this wall — world x or y — and back to t)
    const alongX = Math.abs(by - ay) < Math.abs(bx - ax), ua = alongX ? ax : ay, du = alongX ? tx : ty;
    const tOf = (u: number) => (u - ua) / du;
    const u0 = Math.min(ua, ua + du * len), u1 = Math.max(ua, ua + du * len);
    const cells = (bw: number, fn: (c0: number, c1: number) => void) => { for (let q = Math.floor(u0 / bw); q * bw < u1; q++) { const s = tOf(q * bw), e = tOf((q + 1) * bw); fn(Math.min(s, e), Math.max(s, e)); } };
    const floors = (fn: (hb: number, fl: number) => void) => { for (let fl = 0; grid.base + (fl + 1) * grid.FH <= hTop + 0.01; fl++) fn(grid.base + fl * grid.FH, fl); };
    const inside = (t0: number, t1: number) => t0 > 0.25 && t1 < len - 0.25;
    // the plinth
    if (style !== 2) M.slab(P, tn, on, 0, len, 0, 0.05, g0 - 0.3, g0 + 0.45, granite);
    if (style === 0) {
      // slab edges at each floor line; balconies: glass in front of each bay's window, a rail on top
      floors((hb, fl) => {
        const z = zOf(hb + grid.FH); if (fl >= 0) M.slab(P, tn, on, 0, len, 0, 0.12, z - 0.02, z + 0.2 / kv, [0.56, 0.55, 0.52]);
        const zb = zOf(hb + grid.w[1]) - 0.05, zr = zb + 1.0;
        cells(grid.BW, (c0, c1) => {
          const g0t = c0 + 0.18, g1t = c1 - 0.18; if (!inside(g0t, g1t)) return;
          G.quad(P(g0t, 0.16, zb), P(g1t, 0.16, zb), P(g1t, 0.16, zr), P(g0t, 0.16, zr), on, [0.55, 0.68, 0.72]);
          Me.slab(P, tn, on, g0t, g1t, 0.02, 0.2, zr, zr + 0.05, metal);
          for (const t of [g0t, g1t]) Me.slab(P, tn, on, t - 0.03, t + 0.03, 0.02, 0.18, zb, zr, metal);
        });
      });
    } else if (style === 1 || style === 2) {
      if (style === 2) {
        // shopfronts: piers every 3.2 m up to the sign band; a sign band over each tenant
        const zt = zOf(3.45), zs = zOf(4.15);
        cells(3.2, (c0) => { if (c0 > 0.2 && c0 < len - 0.2) M.slab(P, tn, on, c0 - 0.15, c0 + 0.15, 0, 0.12, g0 - 0.2, zt, stone); });
        cells(6.4, (c0, c1) => {
          const s0 = Math.max(0.2, c0 + 0.15), s1 = Math.min(len - 0.2, c1 - 0.15); if (s1 - s0 < 1) return;
          const r = hash((P(s0, 0, 0)[0]), (P(s0, 0, 0)[1])), col = [[0.75, 0.12, 0.1], [0.1, 0.28, 0.6], [0.95, 0.75, 0.15], [0.1, 0.45, 0.25], [0.15, 0.15, 0.17], [0.92, 0.92, 0.9]][Math.floor(r * 6)];
          M.slab(P, tn, on, s0, s1, 0, 0.2, zt, zs, col, [0.3, 0.3, 0.3]);
        });
      }
      // sills (and on villas the AC units, the ground floor's grilles)
      floors((hb, fl) => {
        cells(grid.BW, (c0, c1) => {
          const w0 = c0 + (c1 - c0) * grid.w[0] / grid.BW, w1 = c0 + (c1 - c0) * grid.w[2] / grid.BW; if (!inside(w0, w1)) return;
          const zb = zOf(hb + grid.w[1]), zt = zOf(hb + grid.w[3]);
          M.slab(P, tn, on, w0 - 0.08, w1 + 0.08, 0, 0.12, zb - 0.08, zb, stone);
          if (style === 1) {
            const r = hash(P(w0, 0, 0)[0] + fl, P(w0, 0, 0)[1]);
            if (r < 0.28 && fl > 0) {
              const mid = (w0 + w1) / 2, za = zb - 0.75;
              M.slab(P, tn, on, mid - 0.42, mid + 0.42, 0.05, 0.37, za, za + 0.58, [0.86, 0.86, 0.84]);
              M.slab(P, tn, on, mid - 0.2, mid + 0.2, 0.37, 0.38, za + 0.12, za + 0.48, [0.25, 0.26, 0.27]);
              Me.slab(P, tn, on, mid - 0.45, mid + 0.45, 0, 0.4, za - 0.04, za, dark);
            }
            if (fl === 0) for (let t = w0 + 0.06; t < w1; t += 0.13) Me.slab(P, tn, on, t - 0.012, t + 0.012, 0.06, 0.085, zb, zt, dark);
            if (fl === 0) for (const z of [zb + 0.02, zt - 0.02]) Me.slab(P, tn, on, w0, w1, 0.06, 0.09, z - 0.02, z + 0.02, dark);
          }
        });
      });
      // drainpipes down the corners (villas)
      if (style === 1) Me.slab(P, tn, on, 0.15, 0.25, 0.04, 0.14, g0, Math.min(top, g0 + MAX_UP), [0.55, 0.56, 0.57]);
    } else if (style === 3) {
      // fins at every bay line, a transom at each spandrel's top
      const zb = zOf(grid.base), zt = Math.min(top - 0.3, g0 + MAX_UP);
      if (zt - zb > 3) cells(grid.BW, (c0) => { if (c0 > 0.3 && c0 < len - 0.3) Me.slab(P, tn, on, c0 - 0.03, c0 + 0.03, 0, 0.24, zb, zt, [0.28, 0.3, 0.33]); });
      floors(hb => { const z = zOf(hb + grid.w[1]); Me.slab(P, tn, on, 0, len, 0, 0.06, z - 0.05, z, [0.3, 0.32, 0.34]); });
    }
  }
}

export class FacadeRelief {
  readonly group = new THREE.Group();
  private chunks = new Map<string, THREE.Mesh[]>();
  private matte = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
  private metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.75 });
  private glass = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
  constructor(private world: World) {}
  /** chunks within reach built (one a call), far ones let go */
  update(x: number, y: number) {
    for (const [k, list] of this.chunks) {
      const [i, j] = k.split(":").map(Number);
      if (Math.hypot((i + 0.5) * CHUNK - x, (j + 0.5) * CHUNK - y) > DROP) { list.forEach(m => { m.geometry.dispose(); m.removeFromParent(); }); this.chunks.delete(k); }
    }
    let want: [number, number] | null = null, wd = Infinity;
    for (let i = Math.floor((x - NEAR) / CHUNK); i <= Math.floor((x + NEAR) / CHUNK); i++) for (let j = Math.floor((y - NEAR) / CHUNK); j <= Math.floor((y + NEAR) / CHUNK); j++) {
      const d = Math.hypot((i + 0.5) * CHUNK - x, (j + 0.5) * CHUNK - y);
      if (d > NEAR + CHUNK * 0.7 || this.chunks.has(`${i}:${j}`) || d >= wd) continue;
      if (this.world.readiness((i + 0.5) * CHUNK, (j + 0.5) * CHUNK, CHUNK * 0.75) < 0.95) continue;
      want = [i, j]; wd = d;
    }
    if (want) this.build(want[0], want[1]);
  }
  private build(i: number, j: number) {
    const M = new Buf(), Me = new Buf(), G = new Buf(), x0 = i * CHUNK, y0 = j * CHUNK;
    for (const f of this.world.footprintsIn(x0, y0, x0 + CHUNK, y0 + CHUNK)) {
      if (f.ring[0] < x0 || f.ring[0] >= x0 + CHUNK || f.ring[1] < y0 || f.ring[1] >= y0 + CHUNK) continue;
      if (f.style === undefined || f.base === undefined || f.kv === undefined) continue;
      reliefOf(M, Me, G, f.ring, f.style, f.top, f.base, f.kv);
    }
    const list: THREE.Mesh[] = [];
    for (const m of [M.mesh(this.matte, true), Me.mesh(this.metal, true), G.mesh(this.glass, false)]) if (m) list.push(m);
    list.forEach(m => { if (m.material === this.glass) m.renderOrder = 2; this.group.add(m); });
    this.chunks.set(`${i}:${j}`, list);
  }
  dispose() {
    for (const l of this.chunks.values()) l.forEach(m => m.geometry.dispose());
    this.chunks.clear(); this.group.removeFromParent(); this.matte.dispose(); this.metal.dispose(); this.glass.dispose();
  }
}
