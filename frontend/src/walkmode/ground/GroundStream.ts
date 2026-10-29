import * as THREE from "three";
import { disposeGroundShared, Ground, type GroundOptions } from "./Ground";

/* The aerial ground (Ground.ts) as the walk goes: the town cut into 400 m patches; every patch
 * within 500 m of the walker is read and built ahead — the nearest first, then those in the
 * direction of travel — one at a time while the walk goes on (each built in frame-sized slices),
 * and patches left 900 m behind are let go. The drive world's own street trees give way under all
 * the patches built. */

export const PATCH = 400;
const AHEAD = 500, DROP = 900;

type Body = Parameters<Ground["blocks"]>[0];

/* The drive world's own sidewalks are not drawn where a patch is built: the patch paves them itself
 * (on the terrain, with kerbs at the road), and two pavements at two heights broke through each
 * other. Up to 32 patches' rectangles (frame x0, y0, x1, y1), set as patches come and go. */
const MASK_N = 32;
const maskRects = Array.from({ length: MASK_N }, () => new THREE.Vector4(0, 0, -1, -1));
export function maskInPatches(m: THREE.Material) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.patchRects = { value: maskRects };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vPatchF;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvec4 patchW = modelMatrix * vec4(transformed, 1.0); vPatchF = vec2(patchW.x, -patchW.z);");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>\nvarying vec2 vPatchF; uniform vec4 patchRects[${MASK_N}];`)
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
        for (int i = 0; i < ${MASK_N}; i++) { vec4 r = patchRects[i]; if (vPatchF.x > r.x && vPatchF.x < r.z && vPatchF.y > r.y && vPatchF.y < r.w) discard; }`);
  };
  m.customProgramCacheKey = () => "walkPatchMask1";
  m.needsUpdate = true;
}
interface Patch { i: number; j: number; ground: Ground | null; state: "building" | "ready" | "failed"; rect: [number, number, number, number] }

export class GroundStream {
  private patches = new Map<string, Patch>();
  /** when each patch was first wanted (its tiles awaited from then) */
  private asked = new Map<string, number>();
  private busy = false;
  private hx = 1; private hy = 0;

  constructor(private o: Omit<GroundOptions, "sharedTrees">) {}

  private key(i: number, j: number) { return `${i}:${j}`; }
  private centre(i: number, j: number): [number, number] { return [(i + 0.5) * PATCH, (j + 0.5) * PATCH]; }

  /** The patch under (x, y), built now (the start: before the walk is shown). */
  async prime(x: number, y: number) {
    const i = Math.floor(x / PATCH), j = Math.floor(y / PATCH), [cx, cy] = this.centre(i, j);
    // (the start waits for the world's tiles there, up to 15 s)
    for (let t = 0; t < 75 && this.o.world.readiness(cx, cy, PATCH * 0.6) < 0.9; t++) await new Promise(r => setTimeout(r, 200));
    await this.build(i, j, true);
  }

  /** Where the walker is and heads: start the next patch wanted, let the far ones go. */
  tick(x: number, y: number, hx: number, hy: number) {
    if (Math.hypot(hx, hy) > 0.1) { this.hx = hx; this.hy = hy; }
    for (const [k, p] of this.patches) {
      const [cx, cy] = this.centre(p.i, p.j);
      if (Math.hypot(cx - x, cy - y) > DROP && p.state !== "building") { p.ground?.dispose(); this.patches.delete(k); this.applyTrees(); }
    }
    if (this.busy) return;
    // the wanted patches: any part within AHEAD of the walker
    const want: { i: number; j: number; score: number }[] = [];
    const r = Math.ceil(AHEAD / PATCH) + 1, ci = Math.floor(x / PATCH), cj = Math.floor(y / PATCH);
    for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
      const i = ci + di, j = cj + dj;
      if (this.patches.has(this.key(i, j))) continue;
      const x0 = i * PATCH, y0 = j * PATCH, dx = Math.max(x0 - x, 0, x - x0 - PATCH), dy = Math.max(y0 - y, 0, y - y0 - PATCH), d = Math.hypot(dx, dy);
      if (d > AHEAD) continue;
      const [cx, cy] = this.centre(i, j), ahead = ((cx - x) * this.hx + (cy - y) * this.hy) / (Math.hypot(cx - x, cy - y) || 1);
      want.push({ i, j, score: d - ahead * 150 });
    }
    want.sort((a, b) => a.score - b.score);
    const next = want[0];
    if (next) void this.build(next.i, next.j);
  }

  private async build(i: number, j: number, force = false) {
    const k = this.key(i, j);
    if (this.patches.has(k)) return;
    const [cx, cy] = this.centre(i, j);
    // (the drive world's tiles there must be in: terrain heights, roads and footprints)
    // (the world streams ~680 m round the walker, so the patches wanted come in on their own)
    // (all of them, over the whole patch: with a tenth missing, the paving, the parked cars and the
    // trees there were laid on a default height — floating, or sunk, on a hillside)
    // (a tile that will not come — failed — does not hold the patch back for good: after 6 s, 97 % will do)
    const ready = this.o.world.readiness(cx, cy, PATCH * 0.75), since = this.asked.get(k) ?? (this.asked.set(k, performance.now()), performance.now());
    if (!force && ready < 1 && !(ready >= 0.97 && performance.now() - since > 6000)) return;
    const p: Patch = { i, j, ground: null, state: "building", rect: [i * PATCH, j * PATCH, (i + 1) * PATCH, (j + 1) * PATCH] };
    this.patches.set(k, p);
    this.busy = true;
    try {
      // (only the first patch reports its progress: the later ones are built while walking, unseen)
      const g = new Ground({ ...this.o, sharedTrees: true, peopleCap: 70, onProgress: force ? this.o.onProgress : undefined });
      p.ground = g;
      await g.build(cx, cy, PATCH / 2);
      p.state = "ready";
      this.applyTrees();
    } catch (e) {
      console.warn("walk: ground patch failed", k, e);
      p.ground?.dispose(); p.ground = null; p.state = "failed";
    } finally { this.busy = false; }
  }

  private applyTrees() {
    const rects = [...this.patches.values()].filter(p => p.state === "ready").map(p => p.rect);
    this.o.world.hideTrees(rects.length ? (x, y) => rects.some(r => x > r[0] + 2 && x < r[2] - 2 && y > r[1] + 2 && y < r[3] - 2) : null);
    for (let i = 0; i < MASK_N; i++) { const r = rects[i]; if (r) maskRects[i].set(r[0] + 0.5, r[1] + 0.5, r[2] - 0.5, r[3] - 0.5); else maskRects[i].set(0, 0, -1, -1); }
  }

  /** The built patches (for the map): their rectangles and states. */
  regions() { return [...this.patches.values()].map(p => ({ rect: p.rect, state: p.state })); }
  get stats() {
    const s = { patches: 0, trees: 0, cars: 0, people: 0, ms: 0 };
    for (const p of this.patches.values()) if (p.ground) { s.patches++; s.trees += p.ground.stats.trees; s.cars += p.ground.stats.cars; s.people += p.ground.stats.people; s.ms += p.ground.stats.ms; }
    return s;
  }

  /** The drawn surface's height at (x, y) (its patch's), NaN where no patch is built. */
  surfaceAt(x: number, y: number) {
    for (const p of this.patches.values()) {
      const r = p.rect;
      if (p.state === "ready" && p.ground && x >= r[0] && x < r[2] && y >= r[1] && y < r[3]) return p.ground.surfaceAt(x, y);
    }
    return NaN;
  }
  blocks(body: Body) { for (const p of this.patches.values()) if (p.ground?.blocks(body)) return true; return false; }
  update(dt: number, camera: THREE.Camera) {
    const e = camera.position;
    for (const p of this.patches.values()) {
      if (p.state !== "ready") continue;
      const [cx, cy] = this.centre(p.i, p.j), dx = Math.max(Math.abs(e.x - cx) - PATCH / 2, 0), dy = Math.max(Math.abs(-e.z - cy) - PATCH / 2, 0);
      p.ground?.update(dt, camera, Math.hypot(dx, dy) < 120);
    }
  }
  dispose() {
    for (const p of this.patches.values()) p.ground?.dispose();
    this.patches.clear();
    this.o.world.hideTrees(null);
    for (const r of maskRects) r.set(0, 0, -1, -1);
    disposeGroundShared();
  }
}
