/** Admit builders after drawing, with bounded backoff so scenery cannot starve. */
const waiting: { resolve: () => void; budget: number; since: number }[] = [];
let scheduled = false;
let lastAdmission = -Infinity;
function background(f: () => void) {
  // Background-priority postTask itself can starve under continuous animation,
  // before the bounded admission check ever runs. Use the ordinary task queue.
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
    const now = performance.now(), first = waiting[0];
    // Prefer spare frame time. Under sustained load, admit just one waiting
    // continuation per 100ms instead of postponing all scenery indefinitely.
    if (first && (now - at < first.budget || (now - first.since >= 100 && now - lastAdmission >= 100))) {
      lastAdmission = now;
      waiting.shift()!.resolve();
    }
    queueMicrotask(schedule);
  }));
}
export function frameSlice(budgetMs = 9): Promise<void> {
  return new Promise(resolve => { waiting.push({ resolve, budget: budgetMs, since: performance.now() }); schedule(); });
}
