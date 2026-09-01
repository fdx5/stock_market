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

/** Scrolls to an element by id, below whatever is pinned. What both desks' rails
 * call, so the two cannot drift apart in where a jump lands. */
export function scrollToSection(id: string): void {
  const el = document.getElementById(id);
  if (el) scrollBelowStickyHeader(el);
}

/** Publishes the measured height of the pinned stack onto an element as
 * `--desk-sticky-h`, and keeps it current as the stack resizes.
 *
 * CSS needs this figure too — `scroll-margin-top` on the bands is what any
 * scroll-into-view lands against — and CSS cannot measure. It used to be written
 * as the header variable plus a hard-coded 78px for the command deck, which is
 * wrong the moment the deck is any other height, and the deck's height changes
 * with the viewport: the chips wrap, the index strip wraps, and below the phone
 * breakpoint the deck stops being sticky at all and should count for nothing.
 *
 * Derived from stickyHeaderOffset rather than measured again here, so the number
 * CSS scrolls to and the number the rail's own click scrolls to are the same
 * number by construction.
 *
 * Returns a teardown for the caller's effect.
 */
export function trackStickyHeight(target: HTMLElement): () => void {
  /* Dragging a window edge fires both sources below on nearly every frame, and
     the write is the expensive part: setting a custom property on the page root
     invalidates style for everything under it, which on a desk is the whole page.
     The measured height, meanwhile, only changes at the two or three widths where
     the header's nav row wraps — every other write recalculates the page to
     restate a number CSS already had.

     So the measurement is coalesced to one animation frame per burst, and the
     property is written only when the figure actually moved. */
  let published = Number.NaN,
    frame = 0;
  const publish = () => {
    frame = 0;
    const height = stickyHeaderOffset(0);
    if (height === published) return;
    published = height;
    target.style.setProperty("--desk-sticky-h", `${height}px`);
  };
  const apply = () => {
    if (!frame) frame = requestAnimationFrame(publish);
  };
  publish();

  if (typeof ResizeObserver === "undefined") {
    window.addEventListener("resize", apply);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", apply);
    };
  }

  const observer = new ResizeObserver(apply);
  for (const selector of STICKY_SELECTORS) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) observer.observe(el);
  }
  /* The deck flips between sticky and static at a breakpoint the observer cannot
     see — nothing resizes when a media query changes `position`, so a rotation
     into the phone layout would leave the old figure in place. */
  window.addEventListener("resize", apply);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener("resize", apply);
  };
}
