/** Stops the page from animating itself while a window edge is being dragged.
 *
 * Percentage-width gauges are everywhere on this site — breadth bars, flow bars,
 * sector meters, score meters — and most of them carry `transition: width` so the
 * bar glides when its *value* changes. CSS cannot tell the two apart: widening the
 * window changes the same computed px width, so every frame of a drag starts a
 * fresh sub-second width animation on every bar on the page, and the layout keeps
 * animating for another beat after the drag stops.
 *
 * Transitions are suppressed for the duration of the drag instead, which costs two
 * style recalculations — one when the class goes on, one when it comes off —
 * rather than a continuous animation per bar. Nothing is lost: a transition exists
 * to show a value moving, and no value moves because a window got wider.
 */
const QUIET_CLASS = "is-window-resizing";
/** How long after the last resize event the page is considered settled. */
const SETTLE_MS = 140;

export function installResizeQuiet(): void {
  if (typeof window === "undefined") return;
  let settleTimer = 0;
  const release = () => {
    settleTimer = 0;
    document.documentElement.classList.remove(QUIET_CLASS);
  };
  window.addEventListener(
    "resize",
    () => {
      // classList.add on a class already present does not invalidate style, so the
      // repeated calls through a drag cost nothing after the first.
      document.documentElement.classList.add(QUIET_CLASS);
      if (settleTimer) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(release, SETTLE_MS);
    },
    { passive: true },
  );
}
