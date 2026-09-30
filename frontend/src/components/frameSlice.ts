/* Yielding between slices of work (building a complex, painting, decoration) so the view and the
 * page keep drawing. A new task (MessageChannel) alone is not enough: Chrome runs queued tasks
 * ahead of rendering, so a run of short slices back to back still made frames of 50–120 ms —
 * each slice within its budget, the frame made of many. Here the work done since the last frame
 * is counted, and past `budgetMs` the next slice waits for the next frame to be drawn. */

let frameAt = 0, seen = -1, windowStart = 0, ticking = false, usedAt = 0;
const tick = () => {
  frameAt = performance.now();
  // (the frame clock runs only while slices are being taken)
  if (frameAt - usedAt < 1000) requestAnimationFrame(tick); else ticking = false;
};
const task = () => new Promise<void>(resolve => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
  ch.port2.postMessage(0);
});

export function frameSlice(budgetMs = 10): Promise<void> {
  const now = usedAt = performance.now();
  if (!ticking) { ticking = true; frameAt = now; requestAnimationFrame(tick); }
  // (a hidden page draws no frames)
  if (document.hidden) return task();
  if (frameAt !== seen) { seen = frameAt; windowStart = now; }
  if (now - windowStart < budgetMs) return task();
  return new Promise(resolve => {
    let done = false;
    const go = () => { if (!done) { done = true; void task().then(resolve); } };
    requestAnimationFrame(go);
    window.setTimeout(go, 100);
  });
}
