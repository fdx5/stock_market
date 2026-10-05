import type { SceneOps } from "./sceneWorker";
import { onSceneMemoryRelease } from "./sceneMemory";

/* The scene workers (sceneWorker.ts), for the session. null where a module worker can't run, or
 * once it has failed: the caller then does the work on the page, in slices. Two of them: painting
 * the ground (one synchronous job, 0.7-1.2 s) has its own, so the jobs the first frame also waits
 * on (terrain, neighbours, water, roads) are not queued behind it. */
type Lane = { worker: Worker | null | undefined; mine: Set<number> };
const lanes: Record<"paint" | "main", Lane> = { paint: { worker: undefined, mine: new Set() }, main: { worker: undefined, mine: new Set() } };
let nextId = 0;
const waiting = new Map<number, (r: { result?: unknown; error?: string }) => void>();
onSceneMemoryRelease(() => {
  for (const lane of Object.values(lanes)) { lane.worker?.terminate(); lane.worker = undefined; lane.mine.clear(); }
  waiting.forEach(done => done({ error: "view released" })); waiting.clear();
});

function get(lane: Lane): Worker | null {
  if (lane.worker !== undefined) return lane.worker;
  lane.worker = null;
  try {
    const w = new Worker(new URL("./sceneWorker.ts", import.meta.url), { type: "module" });
    const mine = lane.mine;
    w.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => { mine.delete(e.data.id); waiting.get(e.data.id)?.(e.data); waiting.delete(e.data.id); };
    w.onerror = () => {
      if (lane.worker === w) lane.worker = null;
      w.terminate();
      mine.forEach(id => { waiting.get(id)?.({ error: "worker failed" }); waiting.delete(id); }); mine.clear();
    };
    lane.worker = w;
  } catch { lane.worker = null; }
  return lane.worker;
}

/** The op's result from the worker; rejects when the worker fails (the caller falls back). */
export function sceneWork<K extends keyof SceneOps>(op: K, args: SceneOps[K]["args"], transfer: Transferable[] = []): Promise<SceneOps[K]["result"]> | null {
  const lane = op === "ground" ? lanes.paint : lanes.main, w = get(lane);
  if (!w) return null;
  const id = ++nextId;
  lane.mine.add(id);
  return new Promise((resolve, reject) => {
    waiting.set(id, r => r.error ? reject(new Error(r.error)) : resolve(r.result as SceneOps[K]["result"]));
    w.postMessage({ id, op, args }, transfer);
  });
}
