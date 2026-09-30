import * as THREE from "three";
import { contextSteps, facadeSteps, keepPaintWith, NEIGHBOUR_PALETTE, paletteFor, plinthSteps, runSliced, type ContextStyle, type Palette } from "./complexScene";
import { normalRows } from "./normalKernel";

/* The painted textures of the 3D view, kept between visits (paintWorker stores and
 * decodes them off the page's thread), and a complex's facades started the moment it is
 * chosen: the page is idle while its buildings are on the network, so the paint that
 * used to follow them now overlaps them. */

export type PaintJob =
  | { kind: "facade"; palette: Palette; seed: number; scale?: number }
  | { kind: "plinth"; seed: number; tone: string }
  | { kind: "context"; style: ContextStyle };
type Textures = Record<string, THREE.Texture>;
interface TexParams { wrapS: number; wrapT: number; flipY: boolean; anisotropy: number; colorSpace: string; repeat: [number, number]; offset: [number, number] }

// The key carries a hash of the painting code: a change to it never reads an old copy.
const hash = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};
let version = "";
const keyOf = (job: PaintJob) => `${version ||= hash([facadeSteps, plinthSteps, contextSteps, normalRows].map(f => String(f)).join("|"))}:${JSON.stringify(job)}`;

type Reply = { id: number; bitmaps: Record<string, ImageBitmap> | null; params: Record<string, TexParams> | null };
let worker: Worker | null | undefined;
let nextId = 0;
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

/** The kept copy of `job`, or null. */
function lookUp(job: PaintJob): Promise<Textures | null> {
  const w = store();
  if (!w) return Promise.resolve(null);
  const id = ++nextId;
  return new Promise(resolve => {
    waiting.set(id, r => {
      if (!r?.bitmaps || !r.params) return resolve(null);
      const out: Textures = {};
      for (const [name, bitmap] of Object.entries(r.bitmaps)) {
        const p = r.params[name];
        const t = new THREE.Texture(bitmap as unknown as HTMLImageElement);
        t.wrapS = p.wrapS as THREE.Wrapping; t.wrapT = p.wrapT as THREE.Wrapping;
        t.flipY = p.flipY; t.anisotropy = p.anisotropy; t.colorSpace = p.colorSpace as THREE.ColorSpace;
        t.repeat.set(p.repeat[0], p.repeat[1]); t.offset.set(p.offset[0], p.offset[1]);
        t.needsUpdate = true;
        out[name] = t;
      }
      resolve(out);
    });
    w.postMessage({ op: "get", id, key: keyOf(job) });
  });
}

/** Hand freshly painted textures to the worker to keep (snapshots: the canvases may be
 * emptied once they are on the GPU). */
function keep(job: PaintJob, textures: Textures) {
  const w = store();
  if (!w) return;
  const names = Object.keys(textures);
  const params = Object.fromEntries(names.map(n => {
    const t = textures[n];
    const p: TexParams = { wrapS: t.wrapS, wrapT: t.wrapT, flipY: t.flipY, anisotropy: t.anisotropy, colorSpace: t.colorSpace, repeat: [t.repeat.x, t.repeat.y], offset: [t.offset.x, t.offset.y] };
    return [n, p];
  }));
  // Encoded once the page is idle: never alongside a loading view.
  void Promise.all(names.map(n => createImageBitmap(textures[n].image as HTMLCanvasElement))).then(list => {
    const bitmaps = Object.fromEntries(names.map((n, i) => [n, list[i]]));
    const send = () => w.postMessage({ op: "put", key: keyOf(job), params, bitmaps }, list);
    if (typeof requestIdleCallback === "function") requestIdleCallback(send, { timeout: 4000 }); else setTimeout(send, 1500);
  }).catch(() => {});
}

const stepsOf = (job: PaintJob) =>
  job.kind === "facade" ? facadeSteps(job.palette, job.seed, job.scale ?? 1)
    : job.kind === "plinth" ? plinthSteps(job.seed, job.tone)
      : job.style === "apt" ? facadeSteps(NEIGHBOUR_PALETTE, 4242) : contextSteps(1000 + job.style.length, job.style);

/** Short slices between other work (the page stays responsive while it paints). */
function slicer() {
  let at = performance.now();
  return async () => {
    if (performance.now() - at > 8) {
      await new Promise<void>(resolve => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); resolve(); }; ch.port2.postMessage(0); });
      at = performance.now();
    }
    return true;
  };
}

/** `job`'s textures: the kept copy, else painted here in slices (and kept). */
async function obtain(job: PaintJob, pace: () => Promise<boolean> = slicer()): Promise<Textures | null> {
  const kept = await lookUp(job);
  if (kept) { paintStats.kept++; return kept; }
  const made = await runSliced<Textures>(stepsOf(job) as Generator<void | Promise<unknown>, Textures, boolean | undefined>, pace);
  if (!made) return null;
  paintStats.painted++;
  keep(job, made);
  return made;
}

// Jobs started ahead (prefetchPaint) and not collected yet.
const ahead = new Map<string, Promise<Textures | null>>();

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
export function prefetchPaint(id: string) {
  if (!store()) return;
  for (const [key, job] of ahead) { ahead.delete(key); void job.then(t => t && Object.values(t).forEach(x => x.dispose())); }
  // (all at once: their drawing is brief, the waits — normal maps in the worker pool, the
  // kept copies — overlap)
  for (const job of complexPaintJobs(id, id.split(":").pop() ?? "")) ahead.set(JSON.stringify(job), obtain(job));
}

// The neighbourhood's styles, shared by every complex: kept too.
keepPaintWith({
  lookUp: (style: ContextStyle) => (store() ? lookUp({ kind: "context", style }) : Promise.resolve(null)),
  keep: (style: ContextStyle, t: Textures) => keep({ kind: "context", style }, t),
});

// Up (and its database open) before the first complex asks.
if (typeof window !== "undefined") store()?.postMessage({ op: "get", id: 0, key: "" });
