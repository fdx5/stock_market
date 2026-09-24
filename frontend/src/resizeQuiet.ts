/** Holds a page still while a window edge is being dragged.
 *
 * Dragging a window edge reflows the whole page on every frame, and traced
 * against the live site that reflow -- not script, not the charts -- was what was
 * left after everything else had been cut. So the page keeps the width it had
 * when the drag started and reflows once, a beat after the last resize event.
 *
 * The cost is visible and deliberate: content does not follow the edge while it
 * is moving, leaving a gap when widening and clipping when narrowing, and snaps
 * into place on release.
 *
 * Two things this used to do made a drag *slower*, and must not come back:
 *
 * - It toggled a class on <html> matched by `html.is-window-resizing *` to switch
 *   off transitions and animations. A universal descendant selector keyed on the
 *   root invalidates every element's style, so each toggle cost a full-document
 *   style recalc -- 50-90ms on the broadsheet pages (8-12k elements), twice per
 *   drag. Nothing needs it: with the width held, no percentage gauge changes size
 *   mid-drag, so no width transition starts.
 * - It read `offsetWidth` inside the resize event, right after that class write,
 *   forcing that recalc and a full layout synchronously. The width is now kept
 *   current by a ResizeObserver, which reports after layout and forces nothing.
 *
 * Those two together fed on themselves: a frame slower than the settle delay
 * released the hold mid-drag, and the next event paid for all of it again.
 */
/** How long after the last resize event the page is considered settled. */
const SETTLE_MS = 200;
/** The element that owns a page's layout width, in document order. Every page has
 * to be named here or it silently reflows on every frame of a drag -- the
 * broadsheet pages (`.d2`) were missing, and they are the heaviest on the site. */
const PAGE_ROOT = ".app, .si-page, .d2";

export function installResizeQuiet(): void {
  if (typeof window === "undefined") return;
  let settleTimer = 0,
    frozen: HTMLElement | null = null,
    lastWidth = window.innerWidth,
    observed: HTMLElement | null = null,
    observedWidth = 0;

  const observer =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver((entries) => {
          const entry = entries[entries.length - 1];
          const box = entry.borderBoxSize?.[0];
          observedWidth = box ? box.inlineSize : (entry.target as HTMLElement).offsetWidth;
        });

  /** Starts watching the current page root, so its width is on hand before a drag. */
  const watch = () => {
    const el = document.querySelector<HTMLElement>(PAGE_ROOT);
    if (!el || el === observed || !observer) return el;
    if (observed) observer.unobserve(observed);
    observed = el;
    observedWidth = 0;
    observer.observe(el);
    return el;
  };

  const release = () => {
    settleTimer = 0;
    document.documentElement.style.overflowX = "";
    if (frozen) {
      frozen.style.width = "";
      frozen = null;
    }
    // A route change swaps the root; pick up the new one while the page is idle.
    watch();
  };

  const freeze = () => {
    const el = watch();
    if (!el) return;
    // The observed width is the one from before this event -- exactly the width
    // to hold. Only a root that appeared since the last check has to be measured.
    const width = el === observed && observedWidth > 0 ? observedWidth : el.offsetWidth;
    frozen = el;
    el.style.width = `${width}px`;
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
      else freeze();
      settleTimer = window.setTimeout(release, SETTLE_MS);
    },
    { passive: true },
  );

  // Pages mount after this runs; catch the root once it exists.
  const prime = () => {
    if (!watch()) window.setTimeout(prime, 500);
  };
  window.setTimeout(prime, 0);
}
