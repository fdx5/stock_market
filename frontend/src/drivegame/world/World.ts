import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type Origin, rectDist, tileKey, tileOf, tileRect } from "./geo";
import { type Materials, STYLES } from "./materials";
import { BatchPool, type BatchItem } from "./batches";
import { startTileWorker, type Dest, type MeshArrays, type RoadLine, type TileResult } from "./tileWorker";

/* The streamed world: tiles asked for ahead of the vehicle (by how soon it can reach them), made
 * in a pool of workers, put on screen a mesh a frame, dropped once well behind. It answers the
 * vehicle's questions: the ground and deck heights, buildings and poles to run into, the roads
 * (for the traffic and the way), the complexes to deliver to. */

type Rect = [number, number, number, number];
interface Tile {
  key: string; i: number; j: number; rect: Rect;
  state: "queued" | "loading" | "built" | "shown" | "failed";
  failedAt?: number; askedAt?: number;
  result?: TileResult; group?: THREE.Group; detail?: THREE.Object3D[];
  pending?: (() => void)[]; disposables: { dispose(): void }[];
  heights?: Float32Array; nx?: number; ny?: number; wet?: Uint8Array;
  lines?: string[]; casters?: boolean;
  /** its surfaces in the material batches (detail: shown near the eye only) */
  items?: BatchItem[]; detailItems?: BatchItem[]; detailOn?: boolean;
}
type Foot = { pts: Float32Array; start: number; end: number; top: number; x0: number; y0: number; x1: number; y1: number };

const CELL = 16;
const cellKey = (i: number, j: number) => (i + 40000) * 80000 + (j + 40000);

export interface WorldOptions {
  origin: Origin; key: string; domain: string; apiBase: string;
  scene: THREE.Scene; mats: Materials;
  onRoads?(added: RoadLine[], removed: string[]): void;
  onDests?(d: Dest[]): void;
}

export class World {
  readonly tiles = new Map<string, Tile>();
  readonly roads = new Map<string, RoadLine & { refs: number }>();
  readonly dests: (Dest & { id: string })[] = [];
  h0 = 0; dem = false;
  private workers: { w: Worker; busy: Tile | null; since: number }[] = [];
  private feet = new Map<number, Foot[]>();
  private poles = new Map<number, number[]>();
  private decks = new Map<number, number[]>();
  private uploads: (() => void)[] = [];
  private eye = new THREE.Vector3();
  private lampGeo: THREE.BufferGeometry;
  private treeGeo: THREE.BufferGeometry;
  private poolGeo = new THREE.PlaneGeometry(15, 15).rotateX(-Math.PI / 2);
  stats = { asked: 0, built: 0, failed: 0, buildMs: 0, netMs: 0, uploadMs: 0, shown: 0, dropped: 0, resultMax: 0, indexMax: 0, roadsMax: 0, unloadMax: 0 };
  private dead = false;
  /** One batch a surface material (batches.ts), sized for ~60 tiles held: grown when needed. */
  private pools = new Map<THREE.Material, BatchPool>();
  private pool(mat: THREE.Material, cast: boolean, receive: boolean) {
    let p = this.pools.get(mat);
    if (!p) {
      const m = this.o.mats, size = mat === m.ground ? [380_000, 1_900_000] : mat === m.marks ? [310_000, 470_000]
        : mat === m.asphalt ? [200_000, 300_000] : mat === m.walks ? [120_000, 180_000] : [96_000, 150_000];
      p = new BatchPool(mat, { cast, receive, vertices: size[0], indices: size[1] });
      this.pools.set(mat, p);
      this.o.scene.add(p.mesh);
    }
    return p;
  }

  constructor(private o: WorldOptions) {
    // lamp: a 9 m post with an arm over the road (+z), its head — one geometry, the head picked
    // out by its uv (the lamp material's emissive map lights only it)
    const uvAt = (g: THREE.BufferGeometry, u: number) => { const n = g.getAttribute("position").count, a = new Float32Array(n * 2); for (let k = 0; k < n; k++) { a[k * 2] = u; a[k * 2 + 1] = 0.5; } g.setAttribute("uv", new THREE.BufferAttribute(a, 2)); return g; };
    const pole = uvAt(new THREE.CylinderGeometry(0.08, 0.13, 9, 6).translate(0, 4.5, 0).toNonIndexed(), 0.25);
    const arm = uvAt(new THREE.BoxGeometry(0.1, 0.1, 1.9).translate(0, 8.9, 0.9).toNonIndexed(), 0.25);
    const head = uvAt(new THREE.BoxGeometry(0.34, 0.14, 0.7).translate(0, 8.82, 1.85).toNonIndexed(), 0.75);
    this.lampGeo = mergeGeometries([pole, arm, head])!;
    [pole, arm, head].forEach(g => g.dispose());
    // street tree: a trunk and a crown of a few lumps, in vertex colours — one geometry
    const parts: THREE.BufferGeometry[] = [];
    const paintG = (g: THREE.BufferGeometry, f: () => [number, number, number]) => { const n = g.getAttribute("position").count, c = new Float32Array(n * 3); for (let k = 0; k < n; k++) c.set(f(), k * 3); g.setAttribute("color", new THREE.BufferAttribute(c, 3)); g.deleteAttribute("uv"); return g; };
    parts.push(paintG(new THREE.CylinderGeometry(0.12, 0.2, 3.2, 6).translate(0, 1.6, 0).toNonIndexed(), () => [0.1, 0.065, 0.04]));
    const r = (s => () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; })(7);
    for (const [x, y, z, sz] of [[0, 4.6, 0, 1.9], [0.9, 4.0, 0.4, 1.3], [-0.8, 4.2, -0.5, 1.4], [0.2, 5.6, -0.3, 1.2], [-0.4, 3.9, 0.9, 1.1]]) {
      parts.push(paintG(new THREE.IcosahedronGeometry(sz, 1).toNonIndexed().translate(x, y, z), () => { const v = 0.75 + r() * 0.35; return [0.22 * v, 0.38 * v, 0.16 * v]; }));
    }
    this.treeGeo = mergeGeometries(parts)!;
    parts.forEach(g => g.dispose());
  }

  /** Start the workers (the origin's ground height comes back from the first). */
  async init(n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 2))): Promise<void> {
    const { origin, key, domain, apiBase } = this.o;
    let first: Promise<void> | null = null;
    for (let k = 0; k < n; k++) {
      const w = startTileWorker(), slot = { w, busy: null as Tile | null, since: 0 };
      const ready = new Promise<void>(res => {
        w.onmessage = (e: MessageEvent) => {
          const m = e.data;
          if (m.type === "ready") { if (k === 0) { this.h0 = m.h0; this.dem = m.dem; } res(); return; }
          if (m.type === "tile") { slot.busy = null; this.onResult(m as TileResult); }
        };
      });
      w.postMessage({ type: "init", lat: origin.lat, lon: origin.lon, kx: origin.kx, ky: origin.ky, key, domain, apiBase, version: 1 });
      if (k === 0) first = ready;
      this.workers.push(slot);
    }
    await first;
  }

  /** Decide which tiles are wanted round (x, y), heading (hx, hy) at `speed`, the way ahead
   * (`route`, flat x, y pairs) first; ask the free workers for the most urgent. */
  update(x: number, y: number, hx: number, hy: number, speed: number, route?: Float32Array | null) {
    const reach = 680 + Math.min(320, speed * 7);
    const [ci, cj] = tileOf(this.o.origin, x, y);
    const span = Math.ceil(reach / 260) + 1;
    const wanted: { t: Tile; score: number }[] = [];
    const moving = speed > 3;
    for (let di = -span; di <= span; di++) for (let dj = -span; dj <= span; dj++) {
      const i = ci + di, j = cj + dj, key = tileKey(i, j);
      const rect = this.tiles.get(key)?.rect ?? tileRect(this.o.origin, i, j);
      const d = rectDist(rect, x, y);
      if (d > reach) continue;
      let t = this.tiles.get(key);
      if (!t) { t = { key, i, j, rect, state: "queued", disposables: [] }; this.tiles.set(key, t); }
      if (t.state !== "queued" && !(t.state === "failed" && performance.now() - (t.failedAt ?? 0) > 6000)) continue;
      // How soon it can be reached: ahead counts nearer, behind farther; the way ahead nearest.
      const mx = (rect[0] + rect[2]) / 2 - x, my = (rect[1] + rect[3]) / 2 - y, ml = Math.hypot(mx, my) || 1;
      const along = moving ? (mx * hx + my * hy) / ml : 0;
      let score = d * (1 - 0.45 * along);
      if (route) for (let k = 0; k < route.length; k += 2) if (rectDist(rect, route[k], route[k + 1]) < 40) { score -= 220; break; }
      wanted.push({ t, score });
    }
    wanted.sort((a, b) => a.score - b.score);
    for (const slot of this.workers) {
      // (a worker stuck on a dead request: restarted)
      if (slot.busy && performance.now() - slot.since > 45000) { const t = slot.busy; t.state = "failed"; t.failedAt = performance.now(); this.restart(slot); }
      if (slot.busy) continue;
      const next = wanted.shift();
      if (!next) break;
      const t = next.t;
      t.state = "loading"; t.askedAt = performance.now();
      slot.busy = t; slot.since = performance.now();
      const lon0 = t.i * 0.003, lat0 = t.j * 0.0025;
      slot.w.postMessage({ type: "tile", i: t.i, j: t.j, rect: t.rect, lon0, lat0, lon1: lon0 + 0.003, lat1: lat0 + 0.0025 });
      this.stats.asked++;
    }
    // Far behind: dropped (their data stays in the browser's store for coming back).
    const drop = reach + 380;
    for (const t of this.tiles.values()) if (rectDist(t.rect, x, y) > drop && t.state !== "loading") this.unload(t);
    // Detail (markings, kerbs, lamps, trees) only near the eye; shadows cast only inside the
    // sun's shadow box (a caster outside it costs a draw in the shadow pass for nothing).
    for (const t of this.tiles.values()) {
      const d = rectDist(t.rect, x, y);
      const on = d < 420;
      if (t.detail) for (const o of t.detail) o.visible = on;
      if (t.detailItems && t.detailOn !== on) { t.detailOn = on; for (const it of t.detailItems) it.pool.visible(it, on); }
      const cast = d < 170;
      if (t.group && t.casters !== cast) { t.casters = cast; t.group.traverse(o => { if ((o as THREE.Mesh).isMesh && o.userData.caster) o.castShadow = cast; }); }
    }
  }

  private restart(slot: { w: Worker; busy: Tile | null; since: number }) {
    slot.w.terminate();
    const w = startTileWorker(), { origin, key, domain, apiBase } = this.o;
    w.onmessage = (e: MessageEvent) => { const m = e.data; if (m.type === "tile") { slot.busy = null; this.onResult(m as TileResult); } };
    w.postMessage({ type: "init", lat: origin.lat, lon: origin.lon, kx: origin.kx, ky: origin.ky, key, domain, apiBase, version: 1 });
    slot.w = w; slot.busy = null;
  }

  private onResult(r: TileResult) {
    if (this.dead) return;
    const t = this.tiles.get(r.key);
    if (!t || t.state !== "loading") return;
    if (!r.ok) { t.state = "failed"; t.failedAt = performance.now(); this.stats.failed++; console.info("[drive] tile failed", r.key, r.error); return; }
    t.state = "built"; t.result = r;
    this.stats.built++; this.stats.buildMs += r.ms; this.stats.netMs += r.net;
    const t0 = performance.now();
    this.queueUpload(t);
    this.stats.resultMax = Math.max(this.stats.resultMax, performance.now() - t0);
  }

  /** The tile's meshes made one per frame (frame()); its collision and roads at once. */
  private queueUpload(t: Tile) {
    const r = t.result!, m = this.o.mats;
    const group = new THREE.Group(); group.name = "tile " + t.key;
    t.group = group; t.detail = [];
    const geo = (a: MeshArrays, uv = true, col = true) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(a.pos, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(a.nor, 3));
      if (uv && a.uv) g.setAttribute("uv", new THREE.BufferAttribute(a.uv, 2));
      if (col && a.col) g.setAttribute("color", new THREE.BufferAttribute(a.col, 3));
      if (a.index) g.setIndex(new THREE.BufferAttribute(a.index, 1));
      g.computeBoundingSphere();
      t.disposables.push(g);
      return g;
    };
    const add = (mesh: THREE.Object3D, detail = false, shadow: [boolean, boolean] = [false, true]) => {
      mesh.userData.caster = shadow[0];
      mesh.castShadow = shadow[0] && t.casters !== false; mesh.receiveShadow = shadow[1];
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      group.add(mesh);
      if (detail) t.detail!.push(mesh);
    };
    // the surfaces: copied into their material's batch (the arrays let go after: the batch holds them)
    t.items = []; t.detailItems = []; t.detailOn = true;
    const batch = (g: THREE.BufferGeometry, mat: THREE.Material, detail = false, shadow: [boolean, boolean] = [false, true]) => {
      if (this.dead || !this.tiles.has(t.key)) { g.dispose(); return; }
      const it = this.pool(mat, shadow[0], shadow[1]).add(g);
      g.dispose(); t.disposables.splice(t.disposables.indexOf(g), 1);
      t.items!.push(it);
      if (detail) { t.detailItems!.push(it); if (t.detailOn === false) it.pool.visible(it, false); }
    };
    const steps: (() => void)[] = [];
    if (r.ground) {
      const gr = r.ground;
      steps.push(() => { batch(geo({ pos: gr.pos, nor: gr.nor, col: gr.col, index: gr.index }), m.ground); gr.pos = gr.nor = gr.col = gr.index = undefined as never; });
    }
    if (r.water) steps.push(() => { batch(geo(r.water!), m.water, false, [false, false]); r.water = undefined; });
    if (r.asphalt) steps.push(() => { batch(geo(r.asphalt!, true, false), m.asphalt); r.asphalt = undefined; });
    if (r.concrete) steps.push(() => { batch(geo(r.concrete!, true, false), m.concrete, false, [true, true]); r.concrete = undefined; });
    for (const s of STYLES) {
      const a = r.styles?.[s];
      if (a) steps.push(() => { batch(geo(a), m.facades[s], false, [true, true]); delete r.styles![s]; });
    }
    if (r.walks) steps.push(() => { batch(geo(r.walks!, true, false), m.walks, true); r.walks = undefined; });
    if (r.marks) steps.push(() => { batch(geo(r.marks!, false, true), m.marks, true); r.marks = undefined; });
    if (r.lamps?.length) steps.push(() => {
      const n = r.lamps!.length / 4, post = new THREE.InstancedMesh(this.lampGeo, m.lampPost, n);
      const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
      for (let k = 0; k < n; k++) {
        const L = r.lamps!;
        q.setFromAxisAngle(up, L[k * 4 + 3]);
        mm.compose(p.set(L[k * 4], L[k * 4 + 2], -L[k * 4 + 1]), q, one);
        post.setMatrixAt(k, mm);
      }
      post.computeBoundingSphere();
      add(post, true, [true, true]);
      t.disposables.push(post);
      // the light each throws on the road at night, under its head (the arm reaches 1.85 m out)
      if (m.pool.visible) {
        const pools = new THREE.InstancedMesh(this.poolGeo, m.pool, n);
        for (let k = 0; k < n; k++) {
          const L = r.lamps!, yaw = L[k * 4 + 3];
          mm.makeTranslation(L[k * 4] + Math.sin(yaw) * 2.4, L[k * 4 + 2] - 0.05, -(L[k * 4 + 1]) + Math.cos(yaw) * 2.4);
          pools.setMatrixAt(k, mm);
        }
        pools.computeBoundingSphere();
        pools.renderOrder = 2;
        add(pools, true, [false, false]);
        t.disposables.push(pools);
      }
    });
    if (r.trees?.length) steps.push(() => {
      const n = r.trees!.length / 5, crown = new THREE.InstancedMesh(this.treeGeo, m.crown, n);
      const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), p = new THREE.Vector3();
      for (let k = 0; k < n; k++) {
        const T = r.trees!;
        q.setFromAxisAngle(up, T[k * 5 + 4]); sc.setScalar(T[k * 5 + 3]);
        mm.compose(p.set(T[k * 5], T[k * 5 + 2], -T[k * 5 + 1]), q, sc);
        crown.setMatrixAt(k, mm);
      }
      crown.computeBoundingSphere();
      add(crown, true, [true, true]);
      t.disposables.push(crown);
    });
    // the group joins the scene with its first mesh; the rest follow a frame apart
    steps[0] && steps.splice(1, 0, () => { this.o.scene.add(group); });
    if (!steps.length) steps.push(() => { this.o.scene.add(group); });
    steps.push(() => { t.state = "shown"; this.stats.shown++; });
    // collision, heights, roads, destinations: at once (cheap, and the vehicle may be near)
    t.heights = r.ground?.heights; t.nx = r.ground?.nx; t.ny = r.ground?.ny; t.wet = r.ground?.wet;
    this.indexTile(t, r);
    this.uploads.push(...steps);
  }

  private indexTile(t: Tile, r: TileResult) {
    const t0 = performance.now();
    const own: number[] = [];
    if (r.feet) {
      const { pts, starts, tops } = r.feet;
      for (let b = 0; b < starts.length; b++) {
        const s = starts[b] * 2, e = b + 1 < starts.length ? starts[b + 1] * 2 : pts.length;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let k = s; k < e; k += 2) { x0 = Math.min(x0, pts[k]); x1 = Math.max(x1, pts[k]); y0 = Math.min(y0, pts[k + 1]); y1 = Math.max(y1, pts[k + 1]); }
        const f: Foot = { pts, start: s, end: e, top: tops[b], x0, y0, x1, y1 };
        for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) {
          const k = cellKey(i, j), l = this.feet.get(k); if (l) l.push(f); else this.feet.set(k, [f]); own.push(k);
        }
      }
    }
    const pole = (x: number, y: number, rr: number) => { const k = cellKey(Math.floor(x / CELL), Math.floor(y / CELL)), l = this.poles.get(k); if (l) l.push(x, y, rr); else this.poles.set(k, [x, y, rr]); own.push(k); };
    if (r.lamps) for (let k = 0; k < r.lamps.length; k += 4) pole(r.lamps[k], r.lamps[k + 1], 0.2);
    if (r.trees) for (let k = 0; k < r.trees.length; k += 5) pole(r.trees[k], r.trees[k + 1], 0.3);
    if (r.decks) for (let k = 0; k < r.decks.length; k += 7) {
      const d = r.decks, mx = (d[k] + d[k + 3]) / 2, my = (d[k + 1] + d[k + 4]) / 2, hw = d[k + 6];
      for (let i = Math.floor((mx - hw - 3) / CELL); i <= Math.floor((mx + hw + 3) / CELL); i++) for (let j = Math.floor((my - hw - 3) / CELL); j <= Math.floor((my + hw + 3) / CELL); j++) {
        const kk = cellKey(i, j), l = this.decks.get(kk); const seg = [d[k], d[k + 1], d[k + 2], d[k + 3], d[k + 4], d[k + 5], hw];
        if (l) l.push(...seg); else this.decks.set(kk, seg); own.push(kk);
      }
    }
    (t as Tile & { cells?: number[] }).cells = own;
    // roads (shared between tiles: counted)
    const added: RoadLine[] = [];
    t.lines = [];
    for (const L of r.lines ?? []) {
      const had = this.roads.get(L.id);
      if (had) had.refs++; else { const e = { ...L, refs: 1 }; this.roads.set(L.id, e); added.push(e); }
      t.lines.push(L.id);
    }
    this.stats.indexMax = Math.max(this.stats.indexMax, performance.now() - t0);
    const t1 = performance.now();
    if (added.length) this.o.onRoads?.(added, []);
    this.stats.roadsMax = Math.max(this.stats.roadsMax, performance.now() - t1);
    // complexes (merged by name within 400 m: one complex spans tiles)
    const fresh: (Dest & { id: string })[] = [];
    for (const d of r.dests ?? []) {
      const same = this.dests.find(o => o.name === d.name && Math.hypot(o.x - d.x, o.y - d.y) < 400);
      if (same) { const n = same.n + d.n; same.x = (same.x * same.n + d.x * d.n) / n; same.y = (same.y * same.n + d.y * d.n) / n; same.n = n; same.floors = Math.max(same.floors, d.floors); continue; }
      const e = { ...d, id: `${d.name}@${Math.round(d.x)},${Math.round(d.y)}` };
      this.dests.push(e); fresh.push(e);
    }
    if (fresh.length) this.o.onDests?.(fresh);
  }

  private unload(t: Tile) {
    const t0 = performance.now();
    try { this.unloadInner(t); } finally { this.stats.unloadMax = Math.max(this.stats.unloadMax, performance.now() - t0); }
  }
  private unloadInner(t: Tile) {
    if (t.group) this.o.scene.remove(t.group);
    t.disposables.forEach(d => d.dispose());
    for (const it of t.items ?? []) it.pool.remove(it);
    t.items = t.detailItems = undefined;
    const cells = (t as Tile & { cells?: number[] }).cells ?? [];
    const set = new Set(cells), pts = t.result?.feet?.pts;
    for (const k of set) {
      const f = this.feet.get(k); if (f && pts) { const left = f.filter(o => o.pts !== pts); if (left.length) this.feet.set(k, left); else this.feet.delete(k); }
    }
    // (poles and decks are rebuilt for the cells this tile touched from the tiles still held)
    for (const k of set) { this.poles.delete(k); this.decks.delete(k); }
    const removed: string[] = [];
    for (const id of t.lines ?? []) { const L = this.roads.get(id); if (L && --L.refs <= 0) { this.roads.delete(id); removed.push(id); } }
    this.tiles.delete(t.key);
    for (const o of this.tiles.values()) if (o.result && (o as Tile & { cells?: number[] }).cells?.some(k => set.has(k))) this.reindexPoles(o, set);
    if (removed.length) this.o.onRoads?.([], removed);
    this.stats.dropped++;
  }
  private reindexPoles(t: Tile, cells: Set<number>) {
    const r = t.result!;
    const pole = (x: number, y: number, rr: number) => { const k = cellKey(Math.floor(x / CELL), Math.floor(y / CELL)); if (!cells.has(k)) return; const l = this.poles.get(k); if (l) l.push(x, y, rr); else this.poles.set(k, [x, y, rr]); };
    if (r.lamps) for (let k = 0; k < r.lamps.length; k += 4) pole(r.lamps[k], r.lamps[k + 1], 0.2);
    if (r.trees) for (let k = 0; k < r.trees.length; k += 5) pole(r.trees[k], r.trees[k + 1], 0.3);
    if (r.decks) for (let k = 0; k < r.decks.length; k += 7) {
      const d = r.decks, mx = (d[k] + d[k + 3]) / 2, my = (d[k + 1] + d[k + 4]) / 2, hw = d[k + 6];
      for (let i = Math.floor((mx - hw - 3) / CELL); i <= Math.floor((mx + hw + 3) / CELL); i++) for (let j = Math.floor((my - hw - 3) / CELL); j <= Math.floor((my + hw + 3) / CELL); j++) {
        const kk = cellKey(i, j); if (!cells.has(kk)) continue;
        const l = this.decks.get(kk), seg = [d[k], d[k + 1], d[k + 2], d[k + 3], d[k + 4], d[k + 5], hw];
        if (l) l.push(...seg); else this.decks.set(kk, seg);
      }
    }
  }

  /** Put queued meshes on screen: at least one a frame, more within `budgetMs`. */
  frame(budgetMs = 2) {
    const t0 = performance.now();
    while (this.uploads.length) {
      this.uploads.shift()!();
      if (performance.now() - t0 > budgetMs) break;
    }
    this.stats.uploadMs += performance.now() - t0;
  }
  get backlog() { return this.uploads.length; }

  /** Ground height (m) at a frame point; NaN where its tile is not in yet. */
  heightAt(x: number, y: number): number {
    const [i, j] = tileOf(this.o.origin, x, y), t = this.tiles.get(tileKey(i, j));
    if (!t?.heights || !t.nx || !t.ny) return NaN;
    const [X0, Y0, X1, Y1] = t.rect, gx = Math.min(t.nx - 1e-6, Math.max(0, (x - X0) / (X1 - X0) * t.nx)), gy = Math.min(t.ny - 1e-6, Math.max(0, (y - Y0) / (Y1 - Y0) * t.ny));
    const a = Math.floor(gx), b = Math.floor(gy), fx = gx - a, fy = gy - b, w = t.nx + 1, h = t.heights;
    return (h[b * w + a] * (1 - fx) + h[b * w + a + 1] * fx) * (1 - fy) + (h[(b + 1) * w + a] * (1 - fx) + h[(b + 1) * w + a + 1] * fx) * fy;
  }
  /** The surface a vehicle stands on: a bridge's deck where there is one, else the ground. */
  surfaceAt(x: number, y: number, near?: number): number {
    const l = this.decks.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (l) {
      // decks under the point: the one nearest the height the vehicle was at (two levels at a
      // crossing); over water, a deck in any case — nothing drives on the river
      let best = Infinity, h = NaN, any = NaN, anyD = Infinity;
      for (let k = 0; k < l.length; k += 7) {
        const ax = l[k], ay = l[k + 1], dx = l[k + 3] - ax, dy = l[k + 4] - ay, l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)), d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
        if (d >= l[k + 6]) continue;
        const hh = l[k + 2] + (l[k + 5] - l[k + 2]) * t;
        const dz = near === undefined ? -hh : Math.abs(hh - near);
        if (dz < anyD) { anyD = dz; any = hh; }
        if ((near === undefined || Math.abs(hh - near) < 6) && d < best) { best = d; h = hh; }
      }
      if (Number.isFinite(h)) return h;
      if (Number.isFinite(any) && this.wetGround(x, y)) return any;
    }
    return this.heightAt(x, y);
  }
  private wetGround(x: number, y: number) {
    const [i, j] = tileOf(this.o.origin, x, y), t = this.tiles.get(tileKey(i, j));
    if (!t?.wet || !t.nx || !t.ny) return false;
    const [X0, Y0, X1, Y1] = t.rect;
    return !!t.wet[Math.round((y - Y0) / (Y1 - Y0) * t.ny) * (t.nx + 1) + Math.round((x - X0) / (X1 - X0) * t.nx)];
  }
  /** Over open water and off any deck (a vehicle there sinks)? */
  wetAt(x: number, y: number): boolean {
    const [i, j] = tileOf(this.o.origin, x, y), t = this.tiles.get(tileKey(i, j));
    if (!t?.wet || !t.nx || !t.ny) return false;
    const [X0, Y0, X1, Y1] = t.rect, a = Math.round((x - X0) / (X1 - X0) * t.nx), b = Math.round((y - Y0) / (Y1 - Y0) * t.ny);
    if (!t.wet[b * (t.nx + 1) + a]) return false;
    const l = this.decks.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (l) for (let k = 0; k < l.length; k += 7) {
      const ax = l[k], ay = l[k + 1], dx = l[k + 3] - ax, dy = l[k + 4] - ay, l2 = dx * dx + dy * dy || 1;
      const tt = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      if (Math.hypot(x - ax - dx * tt, y - ay - dy * tt) < l[k + 6] + 1.5) return false;
    }
    return true;
  }
  /** Is the tile under a point on screen (or built)? */
  ready(x: number, y: number) { const [i, j] = tileOf(this.o.origin, x, y); const t = this.tiles.get(tileKey(i, j)); return !!t && (t.state === "shown" || t.state === "built"); }

  /** A building's footprint under any of the points (x, y pairs)? Its roof height, or 0. */
  buildingAt(px: number[]): number {
    for (let p = 0; p < px.length; p += 2) {
      const x = px[p], y = px[p + 1];
      for (const f of this.feet.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []) {
        if (x < f.x0 || x > f.x1 || y < f.y0 || y > f.y1) continue;
        let hit = false;
        for (let i = f.start, j = f.end - 2; i < f.end; j = i, i += 2) {
          const x1 = f.pts[i], y1 = f.pts[i + 1], x2 = f.pts[j], y2 = f.pts[j + 1];
          if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) hit = !hit;
        }
        if (hit) return f.top;
      }
    }
    return 0;
  }
  /** A pole (lamp post, tree trunk) inside the box (centre, unit heading, half length and width)? */
  poleIn(x: number, y: number, hx: number, hy: number, hl: number, hw: number) {
    const reach = hl + 1;
    for (let i = Math.floor((x - reach) / CELL); i <= Math.floor((x + reach) / CELL); i++) for (let j = Math.floor((y - reach) / CELL); j <= Math.floor((y + reach) / CELL); j++) {
      const l = this.poles.get(cellKey(i, j));
      if (!l) continue;
      for (let k = 0; k < l.length; k += 3) {
        const dx = l[k] - x, dy = l[k + 1] - y, al = dx * hx + dy * hy, la = dx * hy - dy * hx;
        if (Math.abs(al) <= hl + l[k + 2] && Math.abs(la) <= hw + l[k + 2]) return true;
      }
    }
    return false;
  }

  /** Tiles round a point that are on screen / wanted (for the loading screen). */
  readiness(x: number, y: number, r: number) {
    let want = 0, have = 0;
    for (const t of this.tiles.values()) { if (rectDist(t.rect, x, y) > r) continue; want++; if (t.state === "shown") have++; }
    return want ? have / want : 0;
  }

  dispose() {
    this.dead = true;
    this.workers.forEach(s => s.w.terminate());
    for (const t of [...this.tiles.values()]) { if (t.group) this.o.scene.remove(t.group); t.disposables.forEach(d => d.dispose()); }
    this.tiles.clear(); this.feet.clear(); this.poles.clear(); this.decks.clear();
    [this.lampGeo, this.treeGeo, this.poolGeo].forEach(g => g.dispose());
    this.pools.forEach(p => p.dispose()); this.pools.clear();
  }
}
