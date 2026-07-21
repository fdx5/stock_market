/** Every poller registered in this tab gets its own phase offset, handed out in
 * fixed steps. Without it, pollers all start when their component mounts, so
 * harmonically related periods (5s / 10s / 15s / 30s / 60s — which is exactly what
 * the dashboard runs) line up and fire together every 30s and 60s. That burst is a
 * handful of fetches plus a handful of React state updates landing in one frame,
 * which shows up as a periodic stutter in anything animating at the time — the
 * scrolling ticker most visibly. Spreading the starts keeps each tick cheap and
 * isolated. The map pages never showed it because they run three pollers, not ten. */
let pollerCount = 0;
const PHASE_STEP_MS = 700;

function nextPhase(intervalMs: number): number {
  // Modulo the interval so a long-period poller never gets pushed a full cycle
  // late; the step is coprime enough with the periods in use that same-interval
  // pollers land on distinct phases rather than doubling up.
  return (pollerCount++ * PHASE_STEP_MS) % intervalMs;
}

/** Starts `callback` on a repeating interval, skipping ticks while the tab is hidden
 * and firing once (after this poller's phase offset) when it becomes visible again —
 * so data doesn't sit stale for a full interval after switching back, without every
 * poller in the tab stampeding the backend the instant it regains focus. Cuts backend
 * request volume from tabs a user has open in the background without changing behavior
 * for the active tab. Returns a cleanup function that stops the interval, any pending
 * phase timers, and the visibility listener.
 *
 * The caller still owns the initial load: this only schedules the *refreshes*, the
 * first of which lands at `phase + intervalMs`. */
export function startVisibilityAwareInterval(callback: () => void, intervalMs: number): () => void {
  const phase = nextPhase(intervalMs);
  let intervalId: number | undefined;
  let wakeId: number | undefined;

  const tick = () => {
    if (document.visibilityState === "visible") callback();
  };

  // Delaying the whole train by `phase` (rather than firing once at `phase` and
  // then starting the interval) keeps the first refresh no earlier than it was
  // before staggering existed.
  const startId = window.setTimeout(() => {
    intervalId = window.setInterval(tick, intervalMs);
  }, phase);

  const onVisibilityChange = () => {
    if (document.visibilityState !== "visible") return;
    window.clearTimeout(wakeId);
    wakeId = window.setTimeout(tick, phase);
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    window.clearTimeout(startId);
    window.clearTimeout(wakeId);
    if (intervalId !== undefined) window.clearInterval(intervalId);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
