/* Yielding between slices of work (building a complex, painting, decoration) so the view and the
 * page keep drawing at the display's rate. A new task (MessageChannel) alone is not enough: Chrome
 * runs queued tasks ahead of rendering, so short slices back to back still made frames of
 * 50–120 ms. Here the main-thread time since the frame began is counted (the view's own drawing
 * included): one slice a frame always runs, more only within the budget, and past it the next
 * slice waits for the next frame. */

let frameAt = 0, ticking = false, usedAt = 0, lastSliceFrame = -1;
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

export function frameSlice(budgetMs = 9): Promise<void> {
  const now = usedAt = performance.now();
  if (!ticking) { ticking = true; frameAt = now; requestAnimationFrame(tick); }
  // (a hidden page draws no frames)
  if (document.hidden) return task();
  // Counted from the frame's start (its animation callbacks — the 3D view's own drawing among
  // them — run first): the slices get what is left of ~9 ms, and the browser the rest of the
  // 16.7 ms to put the frame on screen. Counted from the first slice instead, the view's drawing
  // plus 10 ms of slices overran the frame and every other one was missed (30–45 ms).
  // (one slice a frame always goes, whatever the view's drawing took: work keeps moving)
  if (lastSliceFrame !== frameAt || now - frameAt < budgetMs) { lastSliceFrame = frameAt; return task(); }
  return new Promise(resolve => {
    let done = false;
    const go = () => { if (!done) { done = true; void task().then(resolve); } };
    requestAnimationFrame(go);
    // (not past ~1.5 frames: while the page itself is busy — booting, laying out — its frames
    // run long, and waiting a whole one after each slice made a 25 ms build step take 200 ms)
    window.setTimeout(go, 24);
  });
}
