import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useFxLevel } from "./settings";
import { installPulseHorizon, type PulseHorizonController } from "./pulseHorizonRenderer";
import type { Mood } from "./pulseHorizonShaders";
import "./pulseHorizon.css";

/** Neon price-ridge sea crossed by heartbeat waves; colour follows the market mood. */
export default function NeoPulseHorizon({ mood = "calm", energy = 1, intensity = 1, horizon, controller }: {
  mood?: Mood; energy?: number; intensity?: number; horizon?: number; controller?: MutableRefObject<PulseHorizonController | null>;
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
      const installed = installPulseHorizon(canvas.current, fx, () => setUnavailable(true), () => setEpoch(value => value + 1), { ...latest.current, intensity, horizon });
      live.current = installed; if (controller) controller.current = installed;
      return () => { installed.dispose(); live.current = null; if (controller && controller.current === installed) controller.current = null; };
    } catch { setUnavailable(true); }
  }, [fx, epoch, intensity, horizon, controller]);
  useEffect(() => { live.current?.setMood(mood); }, [mood]);
  useEffect(() => { live.current?.setEnergy(energy); }, [energy]);
  return <div className="ng-pulse-horizon" data-pattern="pulse-horizon" data-mood={mood} data-level={fx} aria-hidden="true">
    <canvas key={epoch} ref={canvas} className="ng-pulse-canvas" />
    {unavailable && <div className="ng-pulse-fallback" />}
    <div className="ng-pulse-shade" />
  </div>;
}
