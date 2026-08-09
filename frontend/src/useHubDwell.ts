import { useEffect } from "react";
import { reportHubEvent } from "./useActivityTracking";

/* ============================================================================
   How long someone actually stayed on the entrance page.
   ----------------------------------------------------------------------------
   "Time on page" is easy to measure badly. The three ways it goes wrong, and
   what is done about each:

   1. A tab left open is not a visit. Someone who opens the orbit, switches to
      another window and comes back tomorrow did not spend fourteen hours here.
      So the clock only runs while the page is VISIBLE — it stops on
      visibilitychange and starts again on return.

   2. An unload is not a reliable moment to do work. A tab being closed, or a
      phone backgrounding a browser, may never run another line of JavaScript,
      and `beforeunload` is the least reliable of the lot on mobile. So nothing
      waits for the end: each visible stretch is flushed as it closes, and
      `pagehide` (which fires on the paths `beforeunload` misses, including the
      back/forward cache) closes the last one.

   3. A normal fetch is cancelled when the page goes away. sendEvent already
      passes `keepalive`, which is what keeps a request alive across the unload
      it was fired during — without it the final and most interesting stretch
      would be the one that never arrived.

   The server therefore receives a stay as several `dwell` rows rather than one
   total, and sums them per session (see hub_event_store.dwell_stats). That is
   also what makes "came back to the tab four times" recoverable later, which a
   single total would have thrown away.
   ========================================================================= */

/** Below this, a stretch is noise: a bounce, a mis-tap, a tab flicked past on
 * the way to somewhere else. Reporting them would drag every average toward
 * zero and fill the log with rows nobody can act on. */
const MIN_STRETCH_SECONDS = 1.5;

/** Long stretches are flushed as they go rather than held to the end, so a
 * session that ends in a way the browser never tells us about still has nearly
 * all of its time recorded. Five minutes: frequent enough to lose almost
 * nothing, rare enough that a long sit costs a handful of requests. */
const FLUSH_EVERY_MS = 5 * 60 * 1000;

export function useHubDwell(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    /* Wall clock, not Date.now(). A device that sleeps, or a clock corrected by
       NTP mid-visit, moves Date.now() by an arbitrary amount and would post a
       dwell of minus four minutes or of a day. performance.now() is monotonic
       and measures elapsed time, which is the thing being asked for. */
    let since = performance.now();
    let flushTimer: number | undefined;

    const flush = () => {
      const now = performance.now();
      const seconds = (now - since) / 1000;
      since = now;
      if (seconds < MIN_STRETCH_SECONDS) return;
      reportHubEvent("dwell", { value: Math.round(seconds * 10) / 10 });
    };

    const arm = () => {
      window.clearInterval(flushTimer);
      flushTimer = window.setInterval(flush, FLUSH_EVERY_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        // Close the stretch that just ended and stop counting. Whatever
        // happens next — a return, a close, a phone going to sleep — the time
        // up to this instant is already recorded.
        flush();
        window.clearInterval(flushTimer);
      } else {
        since = performance.now();
        arm();
      }
    };

    // Fires where beforeunload does not: bfcache entry, and most mobile
    // teardowns. The one line that has to work for a closed tab to be counted.
    const onPageHide = () => {
      flush();
      window.clearInterval(flushTimer);
    };

    arm();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      // Leaving the page for another route inside the app is an ending too, and
      // it is the one the browser gives no event for at all.
      flush();
      window.clearInterval(flushTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [active]);
}
