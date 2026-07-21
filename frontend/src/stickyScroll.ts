/** Scrolling the page to an element, accounting for the sticky header sitting on top
 * of it.
 *
 * `scrollIntoView({ block: "start" })` aligns an element with the top of the *viewport*
 * — which is exactly where `.app-header` is pinned, so whatever was scrolled to lands
 * underneath it and the visitor has to correct the scroll by hand. The header is
 * measured rather than assumed: its nav row wraps to more lines as the viewport
 * narrows, so it is at its tallest on precisely the screens with the least room, and
 * a hard-coded offset would be wrong exactly where it matters most.
 */

/** Breathing room left between the header and whatever is scrolled to. */
export const HEADER_CLEARANCE = 12;

export function stickyHeaderOffset(gap = HEADER_CLEARANCE): number {
  const header = document.querySelector<HTMLElement>(".app-header");
  return (header?.getBoundingClientRect().height ?? 0) + gap;
}

/** Scrolls the page so a given viewport-relative y lands just below the header.
 *
 * Takes a coordinate rather than an element for callers that have already moved an
 * inner scroller and know where the target *will* be, not where it currently is. */
export function scrollViewportTopTo(viewportTop: number, gap?: number): void {
  window.scrollTo({ top: window.scrollY + viewportTop - stickyHeaderOffset(gap), behavior: "smooth" });
}

/** The common case: put this element just below the header. */
export function scrollBelowStickyHeader(el: HTMLElement, gap?: number): void {
  scrollViewportTopTo(el.getBoundingClientRect().top, gap);
}
