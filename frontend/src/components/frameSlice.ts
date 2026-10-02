/** Admit concurrent background builders one at a time after animation callbacks.
 * A visible busy frame has no forced background slice. */
const waiting: { resolve: () => void; budget: number }[] = [];
let scheduled = false;
function background(f: () => void) {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: { postTask(f: () => void, options: { priority: string }): Promise<void> } }).scheduler;
  if (scheduler?.postTask) { void scheduler.postTask(f, { priority: "background" }); return; }
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { ch.port1.close(); ch.port2.close(); f(); };
  ch.port2.postMessage(0);
}
function schedule() {
  if (scheduled || !waiting.length) return;
  scheduled = true;
  if (document.hidden) {
    background(() => { scheduled = false; waiting.shift()?.resolve(); schedule(); });
    return;
  }
  requestAnimationFrame(at => background(() => {
    scheduled = false;
    // This timestamp precedes the view drawing; the task observes its cost too.
    if (waiting.length && performance.now() - at < waiting[0].budget) waiting.shift()!.resolve();
    queueMicrotask(schedule);
  }));
}
export function frameSlice(budgetMs = 9): Promise<void> {
  return new Promise(resolve => { waiting.push({ resolve, budget: budgetMs }); schedule(); });
}
