import { RefObject, useEffect } from "react";

// Matches the breakpoint styles.css already uses to switch .app-nav-row into its
// horizontally-scrollable mode (see the @media (max-width: 640px) blocks there) —
// this hook should only animate the row while it's actually in that mode.
const MOBILE_QUERY = "(max-width: 640px)";
const RESUME_DELAY_MS = 5000;
const CLONE_MARKER = "data-ticker-clone";
// MarketTickerBar's .ticker-track traverses one full item-set width every 46s
// (see styles.css's `ticker-scroll` keyframes) — a width-relative pace, since that
// bar's content width varies with how many live market items are shown. Matching
// "50% of the ticker-bar's speed" the same way (rather than a fixed px/sec) keeps
// this row's pace proportionally correct even as its own link count changes:
// doubling the reference duration halves the pace for an equivalent width.
const TICKER_BAR_SET_TRAVERSAL_SECONDS = 46;
const SET_TRAVERSAL_SECONDS = TICKER_BAR_SET_TRAVERSAL_SECONDS * 2;

/** Auto-pans the top nav-link row continuously rightward, ticker/marquee-style, on
 * mobile only, looping seamlessly instead of bouncing back and forth.
 *
 * In portrait mode the row (KOSPI/KOSDAQ/S&P500/NASDAQ100/시총대결/NEWS/Mini Apps/
 * visitor badge) overflows past the visible viewport, and it otherwise just sits
 * there looking like a short, complete row — a visitor has no reason to suspect
 * there's more to scroll to, so the links past the fold go undiscovered. This
 * nudges discovery by slowly, continuously panning the row rightward and wrapping
 * around, instead of relying on the visitor to find the row is scrollable on their
 * own.
 *
 * The seamless wrap is real DOM duplication, not a CSS transform loop: every child
 * is cloned once (marked aria-hidden + unfocusable + pointer-events:none, since
 * they're a purely visual echo, not a second set of real links) so the row's total
 * scrollable width doubles, and once scrollLeft passes the first (real) copy's
 * width it's decremented by that same amount — since the second copy is
 * pixel-identical, the reset is invisible. This deliberately keeps the row as a
 * genuinely native scrollable element (overflow-x + real scrollLeft), so a visitor
 * can still manually swipe through the actual links, unlike a CSS @keyframes
 * marquee (transform-based loops need overflow:hidden, which would make the row no
 * longer manually scrollable at all).
 * That wrap check lives in an `el`-level scroll listener rather than inline in the
 * rAF step, so it applies uniformly no matter what moved scrollLeft — the automatic
 * animation or the visitor's own manual swipe. The clones are a purely decorative
 * device for making the automatic loop invisible; without this, a manual drag past
 * the real copy would leave the visitor looking at the aria-hidden clone set, which
 * has no functional purpose to actually land on.
 * Known tradeoff: the cloned copy is a frozen DOM snapshot taken once at mount, so
 * if the visitor badge's live count changes later, only the original (not the
 * clone) reflects it — accepted rather than adding a MutationObserver purely to
 * keep a decorative echo in sync.
 *
 * Speed matches MarketTickerBar's pace model rather than a fixed px/sec: that bar
 * traverses one full item-set width every 46s (see styles.css's `ticker-scroll`
 * keyframes), so this row traverses its own single-set width (measured post-clone,
 * whatever the current link count happens to be) over twice that — 92s — for a
 * proportionally equivalent 50% pace, and moves in the same visual direction
 * (content flows leftward / scrollLeft increases).
 *
 * Pauses the instant the visitor touches anywhere on the page (the row itself or
 * elsewhere in the body — any interaction is a signal this isn't the moment for
 * something to be moving on its own) or scrolls the page, and only resumes
 * automatically after RESUME_DELAY_MS with no further touch/scroll.
 * Re-checks the media queries every frame rather than once at mount, so it also
 * correctly falls silent if the viewport is resized past the mobile breakpoint, or
 * if the OS-level "reduce motion" preference is (or becomes) enabled, without
 * needing separate resize/preference-change listeners.
 *
 * The page-scroll pause check specifically compares window.scrollY against its last
 * known value, rather than treating "a scroll event fired anywhere" as a pause
 * trigger — confirmed directly (console-traced against a real run) that this row's
 * own scrollLeft writes, driven every animation frame, fire native `scroll` events
 * that reach a plain window.addEventListener('scroll', ...) listener even though
 * they're a horizontal, different-element scroll with nothing to do with the page's
 * vertical position. Without the scrollY comparison, the ticker paused itself
 * within about a second of every start (its own movement kept re-triggering the
 * "page is scrolling" pause faster than the 5s resume timer could ever survive
 * uninterrupted) and then sat still until a lucky gap over RESUME_DELAY_MS let it
 * resume — reading as "doesn't actually move" rather than the intended continuous
 * motion. */
export function useNavRowAutoScroll(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const originalChildren = Array.from(el.children);
    for (const child of originalChildren) {
      const clone = child.cloneNode(true) as HTMLElement;
      clone.setAttribute("aria-hidden", "true");
      clone.setAttribute(CLONE_MARKER, "true");
      clone.style.pointerEvents = "none";
      if (clone.matches("a, button")) clone.setAttribute("tabindex", "-1");
      clone.querySelectorAll("a, button").forEach((focusable) => focusable.setAttribute("tabindex", "-1"));
      el.appendChild(clone);
    }
    const singleSetWidth = el.scrollWidth / 2;
    const scrollSpeedPxPerSec = singleSetWidth / SET_TRAVERSAL_SECONDS;

    const mobileQuery = window.matchMedia(MOBILE_QUERY);
    const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    let rafId = 0;
    let lastTime: number | null = null;
    let paused = false;
    let resumeTimer = 0;
    // Tracks the intended scroll position as a float, independent of el.scrollLeft's
    // own value — the DOM property rounds to the nearest integer on both read and
    // write, so at this row's sub-1px-per-frame pace (a handful of px/sec at 60fps),
    // reading it back as the next frame's base silently discards the fractional
    // remainder every single frame and the row never accumulates past 0. Keeping a
    // separate accumulator and only ever writing to el.scrollLeft (never reading it
    // back into the accumulator) avoids that trap.
    let scrollPos = el.scrollLeft;
    // Distinguishes our own writes to el.scrollLeft (below) from a genuine
    // visitor-driven scroll reaching the listener further down — set right before
    // every programmatic write, and consumed (cleared) by the very next scroll
    // event that listener sees, whichever write caused it.
    let isProgrammaticScroll = false;

    const step = (time: number) => {
      const active = mobileQuery.matches && !reduceMotionQuery.matches && !paused && singleSetWidth > 0;
      if (!active) {
        lastTime = null;
        rafId = requestAnimationFrame(step);
        return;
      }

      if (lastTime === null) lastTime = time;
      const dtSeconds = (time - lastTime) / 1000;
      lastTime = time;

      // Wrapping happens in the scroll listener below, not here, so the same
      // clamp logic covers manual drags too — this just advances the position.
      scrollPos += scrollSpeedPxPerSec * dtSeconds;
      isProgrammaticScroll = true;
      el.scrollLeft = scrollPos;
      rafId = requestAnimationFrame(step);
    };

    // Snaps scrollLeft back by one set's width the instant it wanders into the
    // cloned second copy, regardless of whether the advance came from the rAF loop
    // above or the visitor's own manual swipe/drag — the clones exist purely to
    // make that snap invisible, so they must never be left sitting on screen from a
    // real, user-driven scroll.
    // Also the one place a genuine manual drag re-syncs `scrollPos` (our float
    // accumulator) to follow it — step() only ever runs while !paused, and a touch
    // always pauses first (see onTouchStart below), so by the time a real user
    // scroll event can land here, step() has stopped writing and
    // isProgrammaticScroll reliably reads false.
    const onElScroll = () => {
      if (isProgrammaticScroll) {
        isProgrammaticScroll = false;
      } else {
        scrollPos = el.scrollLeft;
      }
      if (el.scrollLeft >= singleSetWidth) {
        el.scrollLeft -= singleSetWidth;
        scrollPos -= singleSetWidth;
      }
    };
    el.addEventListener("scroll", onElScroll, { passive: true });

    const pause = () => {
      paused = true;
      window.clearTimeout(resumeTimer);
    };

    const scheduleResume = () => {
      window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        paused = false;
        lastTime = null;
      }, RESUME_DELAY_MS);
    };

    let lastScrollY = window.scrollY;
    const onPageScroll = () => {
      const currentScrollY = window.scrollY;
      if (Math.abs(currentScrollY - lastScrollY) < 1) return;
      lastScrollY = currentScrollY;
      pause();
      scheduleResume();
    };
    const onTouchStart = () => pause();

    // Document-level (not just on `el`) so touching the row itself or anywhere else
    // in the page body both pause it.
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", scheduleResume, { passive: true });
    document.addEventListener("touchcancel", scheduleResume, { passive: true });
    window.addEventListener("scroll", onPageScroll, { passive: true });

    rafId = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(resumeTimer);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", scheduleResume);
      document.removeEventListener("touchcancel", scheduleResume);
      window.removeEventListener("scroll", onPageScroll);
      el.removeEventListener("scroll", onElScroll);
      // Drop the clones on cleanup so a remount (route change away and back) can't
      // compound duplicates on top of whatever's already there.
      el.querySelectorAll(`[${CLONE_MARKER}]`).forEach((clone) => clone.remove());
    };
  }, [ref]);
}
