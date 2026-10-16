import { frameSlice } from "./frameSlice";
/** One job per worker: async handlers must not accumulate concurrent decodes.
 * Cancellation/failure/deadline releases both the job and its worker capacity. */
export class SceneWorkerPool<Q extends object, R extends { id: number }> {
  private queue: Job<Q, R>[] = [];
  private slots: { worker: Worker | null; job: Job<Q, R> | null }[];
  private serial = 0;
  private dead = false;
  readonly stats = { failed: 0, completed: 0 };
  constructor(private create: () => Worker, size: number, private timeoutMs = 45000) {
    this.slots = Array.from({ length: size }, () => ({ worker: null, job: null }));
  }
  /** Makes the workers now (their scripts load while nothing else is asked for), not at the first job. */
  warm() {
    if (this.dead) return;
    for (const slot of this.slots) if (!slot.worker) {
      try {
        const worker = this.create(); slot.worker = worker;
        worker.onmessage = (e: MessageEvent<R>) => { if (slot.worker === worker && slot.job?.id === e.data?.id) this.finish(slot, e.data); };
        worker.onerror = worker.onmessageerror = () => { if (slot.worker === worker) this.finish(slot, null, true); };
      } catch { slot.worker = null; }
    }
  }
  get pending() { return this.queue.length + this.slots.filter(s => s.job).length; }
  run(request: Q, signal: AbortSignal, transfer: Transferable[] = [], priority = 0): Promise<R | null> {
    if (this.dead || signal.aborted) return Promise.resolve(null);
    return new Promise(resolve => {
      const job: Job<Q, R> = { id: ++this.serial, request, transfer, priority, resolve, signal, abort: () => {}, timer: null, settled: false };
      job.abort = () => {
        const slot = this.slots.find(s => s.job === job);
        if (slot) this.finish(slot, null, true);
        else { this.queue = this.queue.filter(j => j !== job); this.settle(job, null); }
      };
      signal.addEventListener('abort', job.abort, { once: true });
      this.queue.push(job); this.queue.sort((a, b) => a.priority - b.priority || a.id - b.id);
      this.pump();
    });
  }
  private settle(job: Job<Q, R>, result: R | null) {
    if (job.settled) return;
    job.settled = true;
    if (job.timer !== null) clearTimeout(job.timer);
    job.signal.removeEventListener('abort', job.abort);
    result ? this.stats.completed++ : this.stats.failed++;
    job.resolve(result);
  }
  private finish(slot: typeof this.slots[number], result: R | null, replace = false) {
    const job = slot.job; slot.job = null;
    if (replace) { slot.worker?.terminate(); slot.worker = null; }
    if (job) this.settle(job, result);
    this.pump();
  }
  private pump() {
    if (this.dead) return;
    for (const slot of this.slots) {
      if (slot.job || !this.queue.length) continue;
      const job = this.queue.shift()!; slot.job = job;
      try {
        if (!slot.worker) {
          const worker = this.create(); slot.worker = worker;
          worker.onmessage = (e: MessageEvent<R>) => {
            if (slot.worker === worker && slot.job?.id === e.data?.id) this.finish(slot, e.data);
          };
          worker.onerror = worker.onmessageerror = () => {
            if (slot.worker === worker) this.finish(slot, null, true);
          };
        }
        job.timer = setTimeout(() => { if (slot.job === job) this.finish(slot, null, true); }, this.timeoutMs);
        slot.worker.postMessage({ ...job.request, id: job.id }, job.transfer);
      } catch { this.finish(slot, null, true); }
    }
  }
  dispose() {
    this.dead = true;
    for (const slot of this.slots) { slot.worker?.terminate(); if (slot.job) this.settle(slot.job, null); slot.job = null; slot.worker = null; }
    for (const job of this.queue) this.settle(job, null);
    this.queue = [];
  }
}
type Job<Q, R> = { id: number; request: Q; transfer: Transferable[]; priority: number; resolve: (r: R | null) => void; signal: AbortSignal; abort: () => void; timer: ReturnType<typeof setTimeout> | null; settled: boolean };

/** A bounded one-shot geometry worker, including synchronous importScripts stalls. */
export function sceneWorkerOnce<R>(create: () => Worker, request: unknown, signal?: AbortSignal, timeoutMs = 45000): Promise<R | null> {
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise(resolve => {
    let worker: Worker | null = null, timer: ReturnType<typeof setTimeout> | null = null, settled = false;
    const finish = (result: R | null) => {
      if (settled) return; settled = true;
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker?.terminate(); resolve(result);
    };
    const abort = () => finish(null);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      worker = create(); worker.onmessage = e => finish(e.data); worker.onerror = worker.onmessageerror = () => finish(null);
      timer = setTimeout(abort, timeoutMs); worker.postMessage(request);
    } catch { finish(null); }
  });
}

/** Fresh workers made ahead, by script, for sceneWorkerFresh. */
const spareWorkers = new Map<string, { create: () => Worker; spares: Worker[]; used: number; expiry?: ReturnType<typeof setTimeout> }>();
let sparing = false;
const SPARES = 2;
/** One new worker at a time, each in a frame's spare time (frameSlice), until every script in use
 * has its spares. */
function makeSpares() {
  if (sparing) return;
  const next = [...spareWorkers.values()].find(s => s.spares.length < SPARES);
  if (!next) return;
  sparing = true;
  void frameSlice().then(() => {
    try { next.spares.push(next.create()); } catch { /* made on demand instead */ }
    // (a script not asked for in 20 s — the drone landed, the view closed — lets its spares go)
    clearTimeout(next.expiry);
    next.expiry = setTimeout(() => { if (performance.now() - next.used >= 19000) next.spares.splice(0).forEach(w => w.terminate()); }, 20000);
    sparing = false;
    makeSpares();
  });
}
/** sceneWorkerOnce with the worker made ahead: a new worker held the page 6-9 ms while Chrome set it
 * up, and a drone tile asked for three at once (its roads, its buildings, its far ground) — several
 * frames in a row late, some 35 ms a second of a flight. Each job still has a worker of its own,
 * ended with the job (its memory with it: kept for the next job instead, the workers held over a
 * gigabyte more); two fresh ones a script wait, made one at a time in the frames' spare time. */
export function sceneWorkerFresh<R>(script: string, create: () => Worker, request: unknown, signal?: AbortSignal, timeoutMs = 45000): Promise<R | null> {
  let entry = spareWorkers.get(script);
  if (!entry) spareWorkers.set(script, entry = { create, spares: [], used: 0 });
  entry.used = performance.now();
  const spare = entry.spares.shift();
  makeSpares();
  if (signal?.aborted) { spare && entry.spares.unshift(spare); return Promise.resolve(null); }
  return sceneWorkerOnce<R>(() => spare ?? create(), request, signal, timeoutMs);
}
