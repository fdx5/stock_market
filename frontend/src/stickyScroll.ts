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

/* Everything that can be pinned over the top of the page, in stacking order.
 *
 * It was just `.app-header` for as long as that was the only sticky thing on any
 * route. The market desk pins a second strip under it — the command deck, with
 * search, the live index and the shortcut chips — so on that page a scroll
 * measured against the header alone lands its target underneath the deck. The
 * symptom was expanding a post in 종목토론방: the row it scrolled to arrived
 * behind the deck and had to be nudged back down by hand.
 *
 * Anything added to this list has to be genuinely pinned to the viewport top, and
 * that is checked rather than assumed — see below. */
const STICKY_SELECTORS = [".app-header", ".desk-command"];

/** How much of the viewport's top edge is covered by pinned chrome right now.
 *
 * Each candidate is included only when it is *currently* sticky or fixed. The
 * command deck is `position: static` below the phone breakpoint — where the
 * header is at its tallest and a second pinned strip would eat the screen — and
 * counting its height there would scroll every target a deck's height too far.
 * Reading the computed style is what keeps this correct across that breakpoint
 * without either file knowing the other's media query. */
export function stickyHeaderOffset(gap = HEADER_CLEARANCE): number {
  let covered = 0;
  for (const selector of STICKY_SELECTORS) {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) continue;
    const position = window.getComputedStyle(el).position;
    if (position !== "sticky" && position !== "fixed") continue;
    covered += el.getBoundingClientRect().height;
  }
  return covered + gap;
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
