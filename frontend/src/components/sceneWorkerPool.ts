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
