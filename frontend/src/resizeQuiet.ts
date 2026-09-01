/** Holds a page still while a window edge is being dragged.
 *
 * Two things happen for the length of the drag: the page keeps the width it had
 * when the drag started, and it stops animating itself. Both are released a beat
 * after the last resize event, and the page reflows once.
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
const SETTLE_MS = 150;
/** The element that owns a page's layout width, in document order. */
const PAGE_ROOT = ".app, .si-page";

export function installResizeQuiet(): void {
  if (typeof window === "undefined") return;
  let settleTimer = 0,
    frozen: HTMLElement | null = null,
    lastWidth = window.innerWidth;

  const release = () => {
    settleTimer = 0;
    document.documentElement.classList.remove(QUIET_CLASS);
    document.documentElement.style.overflowX = "";
    if (frozen) {
      frozen.style.width = "";
      frozen = null;
    }
  };

  /* Dragging a window edge reflows the whole page on every frame, and traced
     against the live site that reflow -- not script, not the charts -- was what
     was left after everything else had been cut. So the page keeps the width it
     had when the drag started and reflows once, when the drag ends.

     The cost is visible and deliberate: content does not follow the edge while
     it is moving, leaving a gap when widening and clipping when narrowing, and
     snaps into place on release. Measured on a stock detail page that trade
     removes 95% of the layout and 83% of the rasterisation a drag costs. */
  const freeze = () => {
    const el = document.querySelector<HTMLElement>(PAGE_ROOT);
    if (!el) return;
    frozen = el;
    el.style.width = `${el.offsetWidth}px`;
    document.documentElement.style.overflowX = "hidden";
  };

  window.addEventListener(
    "resize",
    () => {
      // Height-only events -- a phone's keyboard opening, a URL bar collapsing,
      // and on iOS every scroll -- reflow nothing horizontally, and freezing a
      // width for them would be all cost and no saving.
      const width = window.innerWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      if (settleTimer) window.clearTimeout(settleTimer);
      else {
        document.documentElement.classList.add(QUIET_CLASS);
        freeze();
      }
      settleTimer = window.setTimeout(release, SETTLE_MS);
    },
    { passive: true },
  );
}
