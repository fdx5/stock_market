import { useEffect, useRef, useState } from "react";
import { DeepDive } from "./deepDive";

/** The 증시 전광판2 background: the deep-dive scene behind the board, coloured by the
 *  market (`change`: the index on arrival, a chosen stock afterwards). */
export default function DeepDiveBackground({ change }: { change: number | null | undefined }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<DeepDive | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!canvas.current) return;
    try {
      const narrow = matchMedia("(max-width: 899px), (pointer: coarse)").matches;
      scene.current = new DeepDive(canvas.current, narrow ? "medium" : "high");
      scene.current.setMood(change);
      (window as unknown as { __deepDive?: DeepDive }).__deepDive = scene.current;
    } catch (error) { console.warn("deep dive", error); setFailed(true); }
    return () => { scene.current?.dispose(); scene.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { scene.current?.setMood(change); }, [change]);
  if (failed) return null;
  return <div className="pb2-deep" aria-hidden="true"><canvas ref={canvas} /></div>;
}
