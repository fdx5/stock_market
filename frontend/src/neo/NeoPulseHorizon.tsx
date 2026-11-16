import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useFxLevel } from "./settings";
import { installPulseHorizon, type PulseHorizonController } from "./pulseHorizonRenderer";
import { installPulseOcean, oceanSupported } from "./pulseOceanRenderer";
import type { Mood } from "./pulseHorizonShaders";
import "./pulseHorizon.css";

/** Neon price-ridge sea crossed by heartbeat waves; colour follows the market mood. */
export default function NeoPulseHorizon({ mood = "calm", energy = 1, intensity = 1, horizon, controller, sea = "ridge" }: {
  sea?: "ridge" | "ocean"; mood?: Mood; energy?: number; intensity?: number; horizon?: number; controller?: MutableRefObject<PulseHorizonController | null>;
}) {
  const fx = useFxLevel();
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<PulseHorizonController | null>(null);
  const latest = useRef({ mood, energy });
  latest.current = { mood, energy };
  const [unavailable, setUnavailable] = useState(false);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    if (!canvas.current) return;
    setUnavailable(false);
    try {
      const options = { ...latest.current, intensity, horizon };
      const lost = () => setUnavailable(true), restore = () => setEpoch(value => value + 1);
      // The physical ocean needs WebGL2 float targets; older GPUs keep the ridge sea.
      let installed: PulseHorizonController | null = null;
      if (sea === "ocean" && oceanSupported()) { try { installed = installPulseOcean(canvas.current, fx, lost, restore, options); } catch (error) { console.warn("pulse ocean", error); } }
      installed ??= installPulseHorizon(canvas.current, fx, lost, restore, options);
      live.current = installed; if (controller) controller.current = installed;
      // Measure actual added content, including ad fill/unfill and mobile wrapping.
      // Only camera uniforms change; both canvases retain full native resolution.
      const band = sea === "ocean" ? document.querySelector<HTMLElement>(".pb-topline") : null;
      const offset = () => {
        const pixels = (band?.getBoundingClientRect().height ?? 0) + (band && band.offsetHeight > 0 ? 32 : 0);
        installed?.setContentOffset?.(pixels);
        canvas.current?.parentElement?.style.setProperty("--pb-content-offset", `${Math.round(pixels)}px`);
      };
      const observer = band ? new ResizeObserver(offset) : null;
      if (band) observer?.observe(band);
      addEventListener("resize", offset); offset();
      return () => { observer?.disconnect(); removeEventListener("resize", offset); installed.dispose(); live.current = null; if (controller && controller.current === installed) controller.current = null; };
    } catch { setUnavailable(true); }
  }, [fx, epoch, intensity, horizon, controller, sea]);
  useEffect(() => { live.current?.setMood(mood); }, [mood]);
  useEffect(() => { live.current?.setEnergy(energy); }, [energy]);
  return <div className="ng-pulse-horizon" data-pattern={sea === "ocean" ? "pulse-ocean" : "pulse-horizon"} data-mood={mood} data-level={fx} aria-hidden="true">
    <canvas key={epoch} ref={canvas} className="ng-pulse-canvas" />
    {unavailable && <div className="ng-pulse-fallback" />}
    <div className="ng-pulse-shade" />
  </div>;
}
