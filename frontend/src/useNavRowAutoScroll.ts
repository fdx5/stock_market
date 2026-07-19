import { RefObject, useEffect } from "react";

// Matches the breakpoint styles.css already uses to switch .app-nav-row into its
// horizontally-scrollable mode (see the @media (max-width: 640px) blocks there) —
// this hook should only animate the row while it's actually in that mode.
const MOBILE_QUERY = "(max-width: 640px)";
const SCROLL_SPEED_PX_PER_SEC = 30;
const RESUME_DELAY_MS = 5000;
const CLONE_MARKER = "data-ticker-clone";

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
 * Known tradeoff: the cloned copy is a frozen DOM snapshot taken once at mount, so
 * if the visitor badge's live count changes later, only the original (not the
 * clone) reflects it — accepted rather than adding a MutationObserver purely to
 * keep a decorative echo in sync.
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

    const mobileQuery = window.matchMedia(MOBILE_QUERY);
    const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    let rafId = 0;
    let lastTime: number | null = null;
    let paused = false;
    let resumeTimer = 0;

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

      let next = el.scrollLeft + SCROLL_SPEED_PX_PER_SEC * dtSeconds;
      if (next >= singleSetWidth) next -= singleSetWidth;
      el.scrollLeft = next;
      rafId = requestAnimationFrame(step);
    };

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
      // Drop the clones on cleanup so a remount (route change away and back) can't
      // compound duplicates on top of whatever's already there.
      el.querySelectorAll(`[${CLONE_MARKER}]`).forEach((clone) => clone.remove());
    };
  }, [ref]);
}
