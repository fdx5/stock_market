import type { SceneOps } from "./sceneWorker";
import { onSceneMemoryRelease } from "./sceneMemory";

/* The scene worker (sceneWorker.ts), one for the session. null where a module worker can't
 * run, or once it has failed: the caller then does the work on the page, in slices. */

let worker: Worker | null | undefined;
let nextId = 0;
const waiting = new Map<number, (r: { result?: unknown; error?: string }) => void>();
onSceneMemoryRelease(() => {
  worker?.terminate(); worker = undefined;
  waiting.forEach(done => done({ error: "view released" })); waiting.clear();
});

function get(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  try {
    const w = new Worker(new URL("./sceneWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => { waiting.get(e.data.id)?.(e.data); waiting.delete(e.data.id); };
    w.onerror = () => { worker = null; w.terminate(); waiting.forEach(done => done({ error: "worker failed" })); waiting.clear(); };
    worker = w;
  } catch { worker = null; }
  return worker;
}

/** The op's result from the worker; rejects when the worker fails (the caller falls back). */
export function sceneWork<K extends keyof SceneOps>(op: K, args: SceneOps[K]["args"], transfer: Transferable[] = []): Promise<SceneOps[K]["result"]> | null {
  const w = get();
  if (!w) return null;
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    waiting.set(id, r => r.error ? reject(new Error(r.error)) : resolve(r.result as SceneOps[K]["result"]));
    w.postMessage({ id, op, args }, transfer);
  });
}
