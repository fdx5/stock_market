import { useEffect, useRef, useState } from "react";
import { useFxLevel } from "./settings";
import { installBackdrop } from "./backdropInstaller";
import "./silkFlow.css";

/** Site-wide moving backdrop: luminous silk threads carried by rivers of liquidity. */
export default function NeoSilkFlow({ onUnavailable }: { onUnavailable?: () => void } = {}) {
  const fx = useFxLevel();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [mainOnly, setMainOnly] = useState(false);
  useEffect(() => {
    if (!canvas.current) return;
    setUnavailable(false);
    try { return installBackdrop(canvas.current, "silk", fx, () => setUnavailable(true), () => setEpoch(value => value + 1), mainOnly, () => { setMainOnly(true); setEpoch(value => value + 1); }, onUnavailable ?? (() => setUnavailable(true))); }
    catch (error) {
      if (error instanceof Error) canvas.current.dataset.rendererError = error.message.slice(0, 240);
      if (onUnavailable) onUnavailable(); else setUnavailable(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx, epoch, mainOnly]);
  return <div className="ng-silk" data-pattern="liquidity-silk" data-level={fx} aria-hidden="true">
    <canvas key={`${epoch}-${fx}`} ref={canvas} className="ng-silk-canvas" />
    {unavailable && <div className="ng-silk-fallback" />}
    <div className="ng-silk-shade" />
  </div>;
}
