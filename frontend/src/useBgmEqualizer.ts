import { useEffect } from "react";
import { envelopeLevel, loadBgmEnvelope } from "./bgmEnvelope";

/* ============================================================================
   Driving the equaliser from the actual music.
   ----------------------------------------------------------------------------
   The bars move to the real track — the same peaks, the same quiet passages —
   without anything analysing audio in the browser, because nothing in the
   browser can. The sound comes out of a cross-origin YouTube iframe and the Web
   Audio API has no way to reach into one; there is no element to hand to
   createMediaElementSource and no way to obtain one.

   What IS reachable is the playback position. So the analysis happened once,
   offline (backend/scripts/bgm_envelope.py), and this reads the answer at the
   right moment: `getCurrentTime()` gives a second, that second gives a frame,
   and the frame gives fourteen levels.

   Two things about how it writes them:

   - Straight to the DOM, not through React state. Fourteen bars at twenty
     frames a second is 280 updates a second; through state that is 280 renders
     of a component that also owns the index tickers and the whole HUD.

   - At the envelope's own rate, not the screen's. There is no more data
     between frames, so a 60 Hz loop would write the same numbers three times
     over. A CSS transition covers the gap instead, which puts the smoothing on
     the compositor where it costs nothing.
   ========================================================================= */

export function useBgmEqualizer(
  containerRef: React.RefObject<HTMLElement>,
  trackId: string | null,
  playing: boolean,
  getTime: () => number | null
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !playing || !trackId) return;

    let stopped = false;
    let timer: number | undefined;

    loadBgmEnvelope(trackId).then((envelope) => {
      if (stopped || !envelope) return;
      const bars = Array.from(container.children) as HTMLElement[];
      if (bars.length === 0) return;

      // Hands the bars over from the CSS animation to us. Without this the
      // keyframes keep overwriting the transform and nothing appears to
      // happen — an animation beats an inline style.
      container.classList.add("is-live");

      const tick = () => {
        const seconds = getTime();
        if (seconds === null) return;
        for (let i = 0; i < bars.length; i++) {
          const level = envelopeLevel(envelope, seconds, i, bars.length);
          // A floor rather than zero: a bar scaled to nothing vanishes, and a
          // row with gaps in it reads as broken rather than as quiet.
          bars[i].style.transform = `scaleY(${(0.08 + level * 0.92).toFixed(3)})`;
        }
      };

      tick();
      timer = window.setInterval(tick, 1000 / envelope.fps);
    });

    return () => {
      stopped = true;
      window.clearInterval(timer);
      // Back to the decorative animation, and the inline transforms cleared so
      // it has somewhere to move from.
      container.classList.remove("is-live");
      for (const bar of Array.from(container.children) as HTMLElement[]) {
        bar.style.transform = "";
      }
    };
  }, [containerRef, trackId, playing, getTime]);
}
