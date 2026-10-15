import * as THREE from "three";

/* The drone tiles' woodland, pooled. Each tile's grove (sceneGroves) is a trunk mesh and a leaf
 * mesh per species and detail level — six to eleven instanced meshes a tile, some five hundred
 * in a city's reach, and every one of them walked by the renderer's scene sync, draw lists and
 * shadow passes each frame. The same trees (their shared models and materials: the grove bank)
 * are drawn here from one instanced mesh per model, material and shadow role in each 2 × 2 tile
 * cell (680 m): the same instances, the same matrices and tints, the same shadows — a quarter of
 * the meshes, still culled cell by cell. A tile's trees leave its cell's meshes with the tile. */

const CELL = 2;
type Seg = { start: number; count: number };
type Pool = { mesh: THREE.InstancedMesh; segs: Map<string, Seg>; total: number };

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
        pool = { mesh, segs: new Map(), total: 0 };
        this.pools.set(key, pool);
        this.o.addWarm(this.root, mesh);
      }
      // (the instances moved into the cell's frame: the tile's own placement folded in)
      const e = src.matrixWorld.elements, n = src.count, need = pool.total + n;
      if (need > pool.mesh.instanceMatrix.count) this.grow(pool, Math.ceil(need * 1.5));
      const dst = pool.mesh.instanceMatrix.array as Float32Array, srcM = src.instanceMatrix.array as Float32Array;
      const m = new THREE.Matrix4(), w = new THREE.Matrix4().fromArray(e);
      for (let k = 0; k < n; k++) { m.fromArray(srcM, k * 16).premultiply(w); m.toArray(dst, (pool.total + k) * 16); }
      const dc = pool.mesh.instanceColor!.array as Float32Array, sc = src.instanceColor?.array as Float32Array | undefined;
      if (sc) dc.set(sc.subarray(0, n * 3), pool.total * 3); else dc.fill(1, pool.total * 3, need * 3);
      pool.segs.set(tile, { start: pool.total, count: n });
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
      const pool = this.pools.get(key), seg = pool?.segs.get(tile);
      if (!pool || !seg) continue;
      pool.segs.delete(tile);
      // (the later tiles' trees moved down over the gap)
      const end = seg.start + seg.count, tail = pool.total - end;
      const mA = pool.mesh.instanceMatrix.array as Float32Array, cA = pool.mesh.instanceColor!.array as Float32Array;
      mA.copyWithin(seg.start * 16, end * 16, pool.total * 16); cA.copyWithin(seg.start * 3, end * 3, pool.total * 3);
      for (const s of pool.segs.values()) if (s.start >= end) s.start -= seg.count;
      pool.total -= seg.count; pool.mesh.count = pool.total;
      if (!pool.total) { pool.mesh.removeFromParent(); pool.mesh.dispose(); this.pools.delete(key); continue; }
      this.touched(pool, seg.start, tail);
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
  }
  dispose() {
    for (const p of this.pools.values()) { p.mesh.removeFromParent(); p.mesh.dispose(); }
    this.pools.clear(); this.byTile.clear(); this.root.removeFromParent();
  }
}
