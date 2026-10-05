import * as THREE from "three";

/* One draw for all the held tiles' meshes of a material (THREE.BatchedMesh: one multi-draw call).
 *
 * Drawing was most of the frame on a slow device, and most of the drawing was the fixed cost of a
 * call: ~9 meshes a tile, 150-200 calls a frame (4x slowed CPU: ~13 ms of a 16.7 ms frame). Each
 * kind of tile surface (ground, asphalt, walks, a facade style …) is now one call; the instances
 * outside the view are left out of it each frame (and of the shadow pass, against the sun's box).
 *
 * A tile's mesh is copied into the batch's buffers (only that range is sent to the GPU). A dropped
 * tile's range is kept and given to a later mesh that fits it: ranges are reserved a little larger
 * than asked (in size classes), so the tiles that follow reuse them instead of growing the buffers. */

const CLASS = 1.25;
const classUp = (n: number) => n <= 64 ? 64 : Math.ceil(CLASS ** Math.ceil(Math.log(n) / Math.log(CLASS)));

export interface BatchItem { pool: BatchPool; geo: number; inst: number }

export class BatchPool {
  readonly mesh: THREE.BatchedMesh;
  private free: { geo: number; v: number; i: number }[] = [];
  private instances = 0;
  private maxInstances: number;
  private maxV: number; private maxI: number;
  private nextV = 0; private nextI = 0;

  constructor(material: THREE.Material, opts: { cast: boolean; receive: boolean; vertices?: number; indices?: number; instances?: number; order?: number }) {
    this.maxV = opts.vertices ?? 65536; this.maxI = opts.indices ?? this.maxV * 3;
    this.maxInstances = opts.instances ?? 64;
    this.mesh = new THREE.BatchedMesh(this.maxInstances, this.maxV, this.maxI, material);
    this.mesh.castShadow = opts.cast; this.mesh.receiveShadow = opts.receive;
    this.mesh.frustumCulled = false;          // (per instance instead: perObjectFrustumCulled)
    this.mesh.sortObjects = false;            // (opaque surfaces: the depth test sorts them)
    this.mesh.matrixAutoUpdate = false;
    if (opts.order !== undefined) this.mesh.renderOrder = opts.order;
  }

  /** The geometry's copy in the batch (the geometry itself can be disposed after). */
  add(g: THREE.BufferGeometry): BatchItem {
    const v = g.attributes.position.count, i = g.index?.count ?? 0;
    // the smallest kept range it fits that is not much larger (the rest of a range is cleared)
    let best = -1;
    for (let k = 0; k < this.free.length; k++) {
      const f = this.free[k];
      if (f.v >= v && f.i >= i && f.v <= v * 1.6 + 64 && (best < 0 || f.v < this.free[best].v)) best = k;
    }
    let geo: number;
    if (best >= 0) {
      geo = this.free.splice(best, 1)[0].geo;
      this.mesh.setGeometryAt(geo, g);
    } else {
      const rv = classUp(v), ri = i ? classUp(i) : -1;
      this.ensure(rv, Math.max(0, ri));
      geo = this.mesh.addGeometry(g, rv, ri);
      this.nextV += rv; this.nextI += Math.max(0, ri);
    }
    if (this.instances >= this.maxInstances) { this.maxInstances *= 2; this.mesh.setInstanceCount(this.maxInstances); }
    const inst = this.mesh.addInstance(geo);
    this.instances++;
    return { pool: this, geo, inst };
  }

  remove(it: BatchItem) {
    this.mesh.deleteInstance(it.inst);
    this.instances--;
    const info = (this.mesh as unknown as { _geometryInfo: { reservedVertexCount: number; reservedIndexCount: number }[] })._geometryInfo[it.geo];
    this.free.push({ geo: it.geo, v: info.reservedVertexCount, i: Math.max(0, info.reservedIndexCount) });
  }

  visible(it: BatchItem, on: boolean) { if (this.mesh.getVisibleAt(it.inst) !== on) this.mesh.setVisibleAt(it.inst, on); }

  /** Room for one more range at the end: the buffers grow by half (a rare full upload). */
  private ensure(v: number, i: number) {
    if (this.nextV + v <= this.maxV && this.nextI + i <= this.maxI) return;
    this.maxV = Math.max(this.nextV + v, Math.ceil(this.maxV * 1.5));
    this.maxI = Math.max(this.nextI + i, Math.ceil(this.maxI * 1.5));
    this.mesh.setGeometrySize(this.maxV, this.maxI);
  }

  dispose() { this.mesh.removeFromParent(); this.mesh.dispose(); }
}
