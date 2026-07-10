/** Starts `callback` on a repeating interval, skipping ticks while the tab is hidden
 * and firing once immediately when it becomes visible again (so data doesn't sit stale
 * for a full interval after switching back). Cuts backend request volume from tabs a
 * user has open in the background without changing behavior for the active tab.
 * Returns a cleanup function that stops both the interval and the visibility listener. */
export function startVisibilityAwareInterval(callback: () => void, intervalMs: number): () => void {
  const id = window.setInterval(() => {
    if (document.visibilityState === "visible") callback();
  }, intervalMs);

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") callback();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    window.clearInterval(id);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
