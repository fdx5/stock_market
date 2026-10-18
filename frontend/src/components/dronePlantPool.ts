import * as THREE from "three";

/* The drone tiles' woodland, pooled. Each tile's grove (sceneGroves) is a trunk mesh and a leaf
 * mesh per species and detail level — six to eleven instanced meshes a tile, some five hundred
 * in a city's reach, and every one of them walked by the renderer's scene sync, draw lists and
 * shadow passes each frame. The same trees (their shared models and materials: the grove bank)
 * are drawn here from one instanced mesh per model, material and shadow role in each 2 × 2 tile
 * cell (680 m): the same instances, the same matrices and tints, the same shadows — a quarter of
 * the meshes, still culled cell by cell. A tile's trees leave its cell's meshes with the tile. */

const CELL = 2;
/** Within a tile its trees are kept in blocks of this size (m), each block's instances together
 * with a sphere round them: the renderer draws a pooled mesh as the runs of blocks in sight of
 * the pass (the camera's, each shadow cascade's) — the same trees in view, not the cell's whole
 * 680 m of them behind and beside the camera (the trees' vertices were most of the frame's GPU
 * time on a phone). See MeshRenderer instanceRanges. */
// Four cells across a 340 m tile balance conservative culling and draw submission.
const BLOCK = 85;
/** a block of a tile's trees: its offset in the tile's segment, its count and bounding sphere */
type Block = { off: number; n: number; x: number; y: number; z: number; r: number; hx: number; hy: number; hz: number };
type Seg = { start: number; count: number; blocks: Block[] };
/** a tile's runs in a pool: one for each of its meshes of that model, material and role */
type Pool = { mesh: THREE.InstancedMesh; segs: Map<string, Seg[]>; total: number };

export class PlantPool {
  readonly root = new THREE.Group();
  private pools = new Map<string, Pool>();
  private byTile = new Map<string, Set<string>>();
  constructor(private readonly o: { addWarm: (parent: THREE.Object3D, obj: THREE.Object3D) => void }) { this.root.name = "drone pooled woodland"; this.root.matrixAutoUpdate = false; }

  /** Moves a tile's woodland meshes (under `group`, placed at the tile) into the pools. */
  adopt(tile: string, i: number, j: number, group: THREE.Object3D) {
    const taken: THREE.InstancedMesh[] = [];
    group.traverse(o => { const m = o as THREE.InstancedMesh; if (m.isInstancedMesh && /^woodland /.test(m.name) && m.count > 0 && !Array.isArray(m.material)) taken.push(m); });
    const keys = this.byTile.get(tile) ?? new Set<string>();
    this.byTile.set(tile, keys);
    group.updateMatrixWorld(true);
    for (const src of taken) {
      const mat = src.material as THREE.Material;
      // (its shadow role as built: the tile may have switched its casting off for distance)
      const casts = (src.userData.castWas ?? src.castShadow) as boolean;
      const key = `${Math.floor(i / CELL)},${Math.floor(j / CELL)}|${src.geometry.uuid}|${mat.uuid}|${casts ? 1 : 0}|${src.name}`;
      let pool = this.pools.get(key);
      if (!pool) {
        const mesh = new THREE.InstancedMesh(src.geometry, mat, Math.max(64, src.count * 2));
        mesh.name = src.name + " (pooled)"; mesh.count = 0; mesh.castShadow = casts; mesh.receiveShadow = src.receiveShadow;
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3), 3);
        mesh.userData.castWas = casts;
        // Population edits replace stationary instances atomically. Invalidate
        // their cached shadow once, rather than treating them as moving trees.
        mesh.userData.staticShadowInstances = true;
        pool = { mesh, segs: new Map(), total: 0 };
        this.pools.set(key, pool);
        this.o.addWarm(this.root, mesh);
      }
      // (the instances moved into the cell's frame: the tile's own placement folded in)
      const e = src.matrixWorld.elements, n = src.count, need = pool.total + n;
      if (need > pool.mesh.instanceMatrix.count) this.grow(pool, Math.ceil(need * 1.5));
      const dst = pool.mesh.instanceMatrix.array as Float32Array, srcM = src.instanceMatrix.array as Float32Array;
      const w = new THREE.Matrix4().fromArray(e);
      const placed = Array.from({ length: n }, (_, k) => new THREE.Matrix4().fromArray(srcM, k * 16).premultiply(w));
      // (in blocks: the order of a tile's trees is free, the same trees drawn in another order)
      const blockOf = (m: THREE.Matrix4) => `${Math.floor(m.elements[12] / BLOCK)},${Math.floor(m.elements[14] / BLOCK)}`;
      const order = placed.map((m, k) => [blockOf(m), k] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1])).map(([, k]) => k);
      order.forEach((k, at) => placed[k].toArray(dst, (pool.total + at) * 16));
      const dc = pool.mesh.instanceColor!.array as Float32Array, sc = src.instanceColor?.array as Float32Array | undefined;
      if (sc) order.forEach((k, at) => dc.set(sc.subarray(k * 3, k * 3 + 3), (pool.total + at) * 3)); else dc.fill(1, pool.total * 3, need * 3);
      // (a tile can bring two meshes of one key: each is its own run — one kept per tile left the
      // first out of the pool's books, never taken out with the tile)
      const seg = { start: pool.total, count: n, blocks: blocks(src.geometry, order.map(k => placed[k]), blockOf) };
      const runs = pool.segs.get(tile);
      if (runs) runs.push(seg); else pool.segs.set(tile, [seg]);
      pool.total = need; pool.mesh.count = need;
      this.touched(pool, pool.total - n, n);
      keys.add(key);
      src.removeFromParent();
    }
    return taken.length;
  }

  /** Takes a tile's trees out of the pools. */
  release(tile: string) {
    const keys = this.byTile.get(tile);
    if (!keys) return;
    this.byTile.delete(tile);
    for (const key of keys) {
      const pool = this.pools.get(key), segs = pool?.segs.get(tile);
      if (!pool || !segs) continue;
      pool.segs.delete(tile);
      // (the later runs' trees moved down over each gap, the last run first)
      let from = pool.total;
      for (const seg of [...segs].sort((a, b) => b.start - a.start)) {
        const end = seg.start + seg.count;
        const mA = pool.mesh.instanceMatrix.array as Float32Array, cA = pool.mesh.instanceColor!.array as Float32Array;
        mA.copyWithin(seg.start * 16, end * 16, pool.total * 16); cA.copyWithin(seg.start * 3, end * 3, pool.total * 3);
        for (const runs of pool.segs.values()) for (const s of runs) if (s.start >= end) s.start -= seg.count;
        pool.total -= seg.count; from = seg.start;
      }
      pool.mesh.count = pool.total;
      if (!pool.total) { pool.mesh.removeFromParent(); pool.mesh.dispose(); this.pools.delete(key); continue; }
      this.touched(pool, from, pool.total - from);
    }
  }

  /** Shadows from the pooled trees of the cells within `r` of (x, y) only. */
  shadows(x: number, y: number, r: number, tileM: number) {
    const span = CELL * tileM;
    for (const [key, pool] of this.pools) {
      const [ci, cj] = key.split("|")[0].split(",").map(Number);
      const d = Math.hypot(Math.max(ci * span - x, 0, x - (ci + 1) * span), Math.max(cj * span - y, 0, y - (cj + 1) * span));
      const cast = !!pool.mesh.userData.castWas && d < r;
      if (cast !== pool.mesh.castShadow) pool.mesh.castShadow = cast;
    }
  }

  private grow(pool: Pool, size: number) {
    const m = new Float32Array(size * 16), c = new Float32Array(size * 3);
    m.set((pool.mesh.instanceMatrix.array as Float32Array).subarray(0, pool.total * 16));
    c.set((pool.mesh.instanceColor!.array as Float32Array).subarray(0, pool.total * 3));
    pool.mesh.instanceMatrix = new THREE.InstancedBufferAttribute(m, 16);
    pool.mesh.instanceColor = new THREE.InstancedBufferAttribute(c, 3);
  }
  private touched(pool: Pool, start: number, count: number) {
    const im = pool.mesh.instanceMatrix, ic = pool.mesh.instanceColor!;
    if (count > 0) { im.addUpdateRange(start * 16, count * 16); ic.addUpdateRange(start * 3, count * 3); }
    im.needsUpdate = true; ic.needsUpdate = true;
    pool.mesh.computeBoundingSphere();
    // the blocks in the pool's order, for the renderer (instanceRanges: start, count, sphere)
    const list: number[] = [], halfExtents: number[] = [];
    for (const seg of [...pool.segs.values()].flat().sort((a, b) => a.start - b.start)) for (const b of seg.blocks) {
      list.push(seg.start + b.off, b.n, b.x, b.y, b.z, b.r);
      halfExtents.push(b.hx, b.hy, b.hz);
    }
    pool.mesh.userData.instanceRanges = { total: pool.total, list: Float64Array.from(list), halfExtents: Float64Array.from(halfExtents) };
  }
  dispose() {
    for (const p of this.pools.values()) { p.mesh.removeFromParent(); p.mesh.dispose(); }
    this.pools.clear(); this.byTile.clear(); this.root.removeFromParent();
  }
}

/** A tile's trees (in their drawing order) as blocks: each block's run of instances and a sphere
 * holding every tree of it whole (the model's own bounding sphere placed by each instance). */
function blocks(geometry: THREE.BufferGeometry, placed: THREE.Matrix4[], blockOf: (m: THREE.Matrix4) => string): Block[] {
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  const gs = geometry.boundingSphere!, c = new THREE.Vector3(), out: Block[] = [];
  let at = 0;
  while (at < placed.length) {
    const key = blockOf(placed[at]);
    let end = at;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    while (end < placed.length && blockOf(placed[end]) === key) {
      const m = placed[end];
      c.copy(gs.center).applyMatrix4(m);
      const r = gs.radius * m.getMaxScaleOnAxis();
      lo[0] = Math.min(lo[0], c.x - r); lo[1] = Math.min(lo[1], c.y - r); lo[2] = Math.min(lo[2], c.z - r);
      hi[0] = Math.max(hi[0], c.x + r); hi[1] = Math.max(hi[1], c.y + r); hi[2] = Math.max(hi[2], c.z + r);
      end++;
    }
    out.push({ off: at, n: end - at, x: (lo[0] + hi[0]) / 2, y: (lo[1] + hi[1]) / 2, z: (lo[2] + hi[2]) / 2, r: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2,
      hx: (hi[0] - lo[0]) / 2, hy: (hi[1] - lo[1]) / 2, hz: (hi[2] - lo[2]) / 2 });
    at = end;
  }
  return out;
}
