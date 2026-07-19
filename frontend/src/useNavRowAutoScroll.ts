import { RefObject, useEffect } from "react";

// Matches the breakpoint styles.css already uses to switch .app-nav-row into its
// horizontally-scrollable mode (see the @media (max-width: 640px) blocks there) —
// this hook should only animate the row while it's actually in that mode.
const MOBILE_QUERY = "(max-width: 640px)";
const SCROLL_SPEED_PX_PER_SEC = 30;
const RESUME_DELAY_MS = 5000;

/** Auto-pans the top nav-link row back and forth, ticker-style, on mobile only.
 *
 * In portrait mode the row (KOSPI/KOSDAQ/S&P500/NASDAQ100/시총대결/NEWS/Mini Apps/
 * visitor badge) overflows past the visible viewport, and it otherwise just sits
 * there looking like a short, complete row — a visitor has no reason to suspect
 * there's more to scroll to, so the links past the fold go undiscovered. This
 * nudges discovery by slowly panning the row to its scrolled end and back,
 * repeating, instead of relying on the visitor to find the row is scrollable on
 * their own.
 *
 * Pauses the instant the visitor either touches the row themselves or scrolls the
 * page (the header is sticky, so a page-scroll keeps the row on screen and moving
 * it sideways at the same time would fight the visitor's own gesture), and only
 * resumes automatically after RESUME_DELAY_MS with no further touch/scroll — so it
 * never fights a real interaction or restarts mid-gesture.
 * Re-checks the media queries every frame rather than once at mount, so it also
 * correctly falls silent if the viewport is resized past the mobile breakpoint, or
 * if the OS-level "reduce motion" preference is (or becomes) enabled, without
 * needing separate resize/preference-change listeners. */
export function useNavRowAutoScroll(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const mobileQuery = window.matchMedia(MOBILE_QUERY);
    const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    let direction: 1 | -1 = 1;
    let rafId = 0;
    let lastTime: number | null = null;
    let paused = false;
    let resumeTimer = 0;

    const step = (time: number) => {
      const active = mobileQuery.matches && !reduceMotionQuery.matches && !paused;
      if (!active) {
        lastTime = null;
        rafId = requestAnimationFrame(step);
        return;
      }

      if (lastTime === null) lastTime = time;
      const dtSeconds = (time - lastTime) / 1000;
      lastTime = time;

      const maxScroll = el.scrollWidth - el.clientWidth;
      if (maxScroll <= 0) {
        rafId = requestAnimationFrame(step);
        return;
      }

      let next = el.scrollLeft + direction * SCROLL_SPEED_PX_PER_SEC * dtSeconds;
      if (next >= maxScroll) {
        next = maxScroll;
        direction = -1;
      } else if (next <= 0) {
        next = 0;
        direction = 1;
      }
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

    const onInteractionStart = () => pause();
    const onInteractionEnd = () => scheduleResume();
    // Page scroll has no discrete "end" event of its own — every scroll tick both
    // pauses immediately and (re)schedules the same resume timer, so the timer only
    // ever fires RESUME_DELAY_MS after the *last* scroll tick, not the first.
    const onPageScroll = () => {
      pause();
      scheduleResume();
    };

    el.addEventListener("touchstart", onInteractionStart, { passive: true });
    el.addEventListener("touchend", onInteractionEnd, { passive: true });
    el.addEventListener("touchcancel", onInteractionEnd, { passive: true });
    window.addEventListener("scroll", onPageScroll, { passive: true });

    rafId = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(resumeTimer);
      el.removeEventListener("touchstart", onInteractionStart);
      el.removeEventListener("touchend", onInteractionEnd);
      el.removeEventListener("touchcancel", onInteractionEnd);
      window.removeEventListener("scroll", onPageScroll);
    };
  }, [ref]);
}
