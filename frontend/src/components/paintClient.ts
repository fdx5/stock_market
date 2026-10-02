import { frameSlice } from "./frameSlice";
import * as THREE from "three";
import { contextSteps, facadeSteps, keepPaintWith, NEIGHBOUR_PALETTE, paletteFor, plinthSteps, runSliced, type ContextStyle, type Palette } from "./complexScene";
import { normalRows } from "./normalKernel";
import { onSceneMemoryRelease } from "./sceneMemory";
import { preparedContext } from './preparedPaint';

/* The painted textures of the 3D view, kept between visits (paintWorker stores and
 * decodes them off the page's thread), and a complex's facades started the moment it is
 * chosen: the page is idle while its buildings are on the network, so the paint that
 * used to follow them now overlaps them. */

export type PaintJob =
  | { kind: "facade"; palette: Palette; seed: number; scale?: number }
  | { kind: "plinth"; seed: number; tone: string }
  | { kind: "context"; style: ContextStyle; scale?: number };
type Textures = Record<string, THREE.Texture>;
export interface TexParams { wrapS: number; wrapT: number; flipY: boolean; anisotropy: number; colorSpace: string; repeat: [number, number]; offset: [number, number]; surfaceKey?: string }

// The key carries a hash of the painting code: a change to it never reads an old copy.
const hash = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};
let version = "";
const keyOf = (job: PaintJob) => `raster-v3:${version ||= hash([facadeSteps, plinthSteps, contextSteps, normalRows].map(f => String(f)).join("|"))}:${JSON.stringify(job)}`;

type Reply = { id: number; bitmaps: Record<string, ImageBitmap> | null; params: Record<string, TexParams> | null };
let worker: Worker | null | undefined;
let nextId = 0;
let epoch = 0;
const waiting = new Map<number, (r: Reply | null) => void>();
function store(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  // (VITE_PAINT_ON_PAGE: a build that neither keeps nor starts early, for comparisons.)
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined" || typeof indexedDB === "undefined" || import.meta.env.VITE_PAINT_ON_PAGE) return worker;
  try {
    const w = new Worker(new URL("./paintWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<Reply>) => { waiting.get(e.data.id)?.(e.data); waiting.delete(e.data.id); };
    // A worker that fails to load: painted every time, as before.
    w.onerror = () => { worker = null; waiting.forEach(done => done(null)); waiting.clear(); };
    worker = w;
  } catch { worker = null; }
  return worker;
}

/** For the development build's timings: jobs answered from the kept copy / painted. */
export const paintStats = { kept: 0, painted: 0 };

async function fromReply(r: Reply | null): Promise<Textures | null> {
  if (!r?.bitmaps || !r.params) return null;
  const out: Textures = {};
  try { for (const [name, raw] of Object.entries(r.bitmaps)) {
    const p = r.params[name];
    // WebGL ignores Texture.flipY for ImageBitmap. Bake its original orientation
    // into the bitmap so WebGL and WebGPU sample the same texels.
    const bitmap = p.flipY ? await createImageBitmap(raw, {imageOrientation:'flipY',colorSpaceConversion:'none',premultiplyAlpha:'none'}) : raw;
    if (bitmap !== raw) raw.close();
    const t = new THREE.Texture(bitmap as unknown as HTMLImageElement);
    t.wrapS = p.wrapS as THREE.Wrapping; t.wrapT = p.wrapT as THREE.Wrapping;
    t.flipY = false; t.anisotropy = p.anisotropy; t.colorSpace = p.colorSpace as THREE.ColorSpace;
    t.repeat.set(...p.repeat); t.offset.set(...p.offset); t.needsUpdate = true;
    if (p.surfaceKey) t.userData.surfaceKey = p.surfaceKey;
    t.addEventListener("dispose", () => bitmap.close());
    out[name] = t;
  } } catch { Object.values(out).forEach(t => t.dispose()); Object.values(r.bitmaps).forEach(b => b.close()); return null; }
  return out;
}

let rasterPool: { w: Worker; busy: number; pending: Map<number, (r: Reply | null) => void>; idle?: ReturnType<typeof setTimeout> }[] | null | undefined;
const pendingWrites = new Set<() => void>();
function paintOffThread(job: PaintJob): Promise<Textures | null> {
  if (rasterPool === undefined) {
    rasterPool = [];
    try {
      if (typeof OffscreenCanvas === "undefined" || import.meta.env.VITE_PAINT_ON_PAGE) return Promise.resolve(null);
      for (let i = 0; i < Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2)); i++) {
        const w = new Worker(new URL("./paintRasterWorker.ts", import.meta.url), { type: "module" });
        const slot = { w, busy: 0, pending: new Map<number, (r: Reply | null) => void>() };
        w.onmessage = (e: MessageEvent<Reply>) => { slot.pending.get(e.data.id)?.(e.data); };
        w.onerror = () => {
          w.terminate(); slot.pending.forEach(done => done(null));
          rasterPool = rasterPool?.filter(s => s !== slot) ?? null;
        };
        rasterPool.push(slot);
      }
    } catch { rasterPool.forEach(s => s.w.terminate()); rasterPool = null; }
  }
  if (!rasterPool?.length) return Promise.resolve(null);
  const slot = rasterPool.reduce((a, b) => a.busy <= b.busy ? a : b), id = ++nextId;
  clearTimeout(slot.idle);
  slot.busy++;
  return new Promise(resolve => {
    slot.pending.set(id, r => {
      slot.pending.delete(id); slot.busy--; resolve(fromReply(r));
      if (slot.busy === 0) slot.idle = setTimeout(() => {
        slot.w.terminate(); rasterPool = rasterPool?.filter(s => s !== slot);
        if (!rasterPool?.length) rasterPool = undefined;
      }, 5000);
    });
    slot.w.postMessage({ id, job });
  });
}

/** The kept copy of `job`, or null. */
function lookUp(job: PaintJob): Promise<Textures | null> {
  const w = store();
  if (!w) return Promise.resolve(null);
  const id = ++nextId;
  return new Promise(resolve => {
    waiting.set(id, r => {
      if (!r?.bitmaps || !r.params) return resolve(null);
      resolve(fromReply(r));
    });
    w.postMessage({ op: "get", id, key: keyOf(job) });
  });
}

/** Hand freshly painted textures to the worker to keep (snapshots: the canvases may be
 * emptied once they are on the GPU). */
function keep(job: PaintJob, textures: Textures) {
  const w = store();
  if (!w) return;
  const startedIn = epoch;
  const names = Object.keys(textures);
  const params = Object.fromEntries(names.map(n => {
    const t = textures[n];
    const p: TexParams = { wrapS: t.wrapS, wrapT: t.wrapT, flipY: t.flipY, anisotropy: t.anisotropy, colorSpace: t.colorSpace, repeat: [t.repeat.x, t.repeat.y], offset: [t.offset.x, t.offset.y], surfaceKey: t.userData.surfaceKey };
    return [n, p];
  }));
  // Encoded once the page is idle: never alongside a loading view.
  void Promise.allSettled(names.map(n => createImageBitmap(textures[n].image as HTMLCanvasElement, {colorSpaceConversion:'none',premultiplyAlpha:'none'}))).then(results => {
    const list = results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
    if (list.length !== names.length) { list.forEach(b => b.close()); return; }
    const bitmaps = Object.fromEntries(names.map((n, i) => [n, list[i]]));
    const send = () => {
      if (startedIn !== epoch || worker !== w) { list.forEach(b => b.close()); return; }
      try { w.postMessage({ op: "put", key: keyOf(job), params, bitmaps }, list); }
      catch { list.forEach(b => b.close()); }
    };
    if (startedIn !== epoch) { list.forEach(b => b.close()); return; }
    let cancel = () => {};
    const discard = () => { cancel(); list.forEach(b => b.close()); pendingWrites.delete(discard); };
    const flush = () => { pendingWrites.delete(discard); send(); };
    pendingWrites.add(discard);
    if (typeof requestIdleCallback === "function") { const id = requestIdleCallback(flush, { timeout: 4000 }); cancel = () => cancelIdleCallback(id); }
    else { const id = setTimeout(flush, 1500); cancel = () => clearTimeout(id); }
  }).catch(() => {});
}

const stepsOf = (job: PaintJob) =>
  job.kind === "facade" ? facadeSteps(job.palette, job.seed, job.scale ?? 1)
    : job.kind === "plinth" ? plinthSteps(job.seed, job.tone)
      : job.style === "apt" ? facadeSteps(NEIGHBOUR_PALETTE, 4242, job.scale ?? 1) : contextSteps(1000 + job.style.length, job.style, job.scale ?? 1);

/** Short slices between other work (the page stays responsive while it paints). */
function slicer() {
  let at = performance.now();
  return async () => {
    if (performance.now() - at > 8) {
      await frameSlice();
      at = performance.now();
    }
    return true;
  };
}

/** `job`'s textures: the kept copy, else painted here in slices (and kept). */
async function obtain(job: PaintJob, pace: () => Promise<boolean> = slicer()): Promise<Textures | null> {
  const startedIn = epoch;
  const kept = await fromReply(await preparedContext(job)) ?? await lookUp(job);
  if (startedIn !== epoch) { if (kept) Object.values(kept).forEach(t => t.dispose()); return null; }
  if (kept) { paintStats.kept++; return kept; }
  let made = await paintOffThread(job);
  if (startedIn !== epoch) { if (made) Object.values(made).forEach(t => t.dispose()); return null; }
  if (!made && await pace()) made = await runSliced<Textures>(stepsOf(job) as Generator<void | Promise<unknown>, Textures, boolean | undefined>, pace);
  if (!made) return null;
  paintStats.painted++;
  keep(job, made);
  return made;
}

// Jobs started ahead (prefetchPaint) and not collected yet.
const ahead = new Map<string, Promise<Textures | null>>();

onSceneMemoryRelease(() => {
  epoch++;
  pendingWrites.forEach(discard => discard());
  for (const job of ahead.values()) void job.then(t => t && Object.values(t).forEach(x => x.dispose()));
  ahead.clear();
  for (const slot of rasterPool ?? []) { clearTimeout(slot.idle); slot.w.terminate(); slot.pending.forEach(done => done(null)); clearTimeout(slot.idle); }
  rasterPool = undefined;
  worker?.terminate(); worker = undefined;
  waiting.forEach(done => done(null)); waiting.clear();
});

/** The textures for `job`: the ones started ahead when there are, else obtained now with
 * the caller's pacing. Each result is handed out once. */
export function paintTextures(job: PaintJob, pace: () => Promise<boolean>): Promise<Textures | null> {
  const key = JSON.stringify(job);
  const got = ahead.get(key);
  if (got) { ahead.delete(key); return got; }
  return obtain(job, pace);
}

export const plinthTone = (palette: Palette) => "#" + new THREE.Color(palette.wall2).lerp(new THREE.Color("#8d8a84"), 0.55).getHexString();

/** The facade jobs of a complex, exactly as its build asks for them. */
export function complexPaintJobs(id: string, name: string): PaintJob[] {
  let seed = 0;
  for (const ch of id) seed = (seed * 33 + ch.charCodeAt(0)) % 2147483647;
  const palette = paletteFor(name);
  return [
    { kind: "facade", palette, seed },
    { kind: "facade", palette, seed: seed + 7919 },
    { kind: "plinth", seed: seed + 13, tone: plinthTone(palette) },
  ];
}

/** Start on a complex's facades now (its id ends in its name), all together; its
 * build collects them. Unclaimed ones are dropped when another complex is chosen. */
export function prefetchPaint(id: string, name?: string | null) {
  if (!store()) return;
  const paintName = name || (id.includes(":") ? id.split(":").pop() : null);
  if (!paintName) return; // An opaque id cannot predict the eventual building's palette.
  const jobs = complexPaintJobs(id, paintName).map(j => JSON.stringify(j));
  // (already under way — started when the pointer rested on its tile: kept as they are)
  if (jobs.every(k => ahead.has(k))) return;
  for (const [key, job] of ahead) { ahead.delete(key); void job.then(t => t && Object.values(t).forEach(x => x.dispose())); }
  // (all at once: their drawing is brief, the waits — normal maps in the worker pool, the
  // kept copies — overlap)
  for (const job of complexPaintJobs(id, paintName)) ahead.set(JSON.stringify(job), obtain(job));
}

/** A complex's facades painted in idle time and kept (the paint store), not held: for the
 * complexes likely chosen next (the 3D view's nearest neighbours). Chosen later, its build
 * finds them kept — a decode in the worker instead of painting on the way to the screen. */
export async function paintAhead(id: string) {
  if (!store()) return;
  const startedIn = epoch;
  const idle = async () => {
    await new Promise<void>(resolve => (typeof requestIdleCallback === "function" ? requestIdleCallback(() => resolve(), { timeout: 3000 }) : setTimeout(resolve, 50)));
    return startedIn === epoch;
  };
  for (const job of complexPaintJobs(id, id.split(":").pop() ?? "")) {
    if (startedIn !== epoch) break;
    if (ahead.has(JSON.stringify(job))) continue;
    const t = await obtain(job, idle).catch(() => null);
    if (t) Object.values(t).forEach(x => x.dispose());
  }
}

// The neighbourhood's styles, shared by every complex: kept too.
const contextJob = (style: ContextStyle): PaintJob => style.endsWith("@2")
  ? { kind: "context", style: style.slice(0, -2) as ContextStyle, scale: 2 }
  : { kind: "context", style };
keepPaintWith({
  lookUp: (style: ContextStyle) => obtain(contextJob(style)),
  keep: (style: ContextStyle, t: Textures) => keep(contextJob(style), t),
});

// Up (and its database open) before the first complex asks.
if (typeof window !== "undefined") store()?.postMessage({ op: "get", id: 0, key: "" });
