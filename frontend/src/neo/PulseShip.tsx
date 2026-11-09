import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useFxLevel } from "./settings";
import type { PulseHorizonController } from "./pulseHorizonRenderer";
import type { ShipSceneHandle, ShipState } from "./pulseShipScene";

/** The container ship riding the pulse sea. Loaded lazily; three.js stays out of the main bundle. */
export default function PulseShip({ state, controller, onBoard, onCargo }: { state: ShipState; controller: MutableRefObject<PulseHorizonController | null>; onBoard?: () => void; onCargo?: (code: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const handle = useRef<ShipSceneHandle | null>(null);
  const latest = useRef(state); latest.current = state;
  const fx = useFxLevel();
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    let live = true;
    const element = canvas.current; if (!element) return;
    const still = fx === "minimal" || matchMedia("(prefers-reduced-motion: reduce)").matches;
    import("./pulseShipScene").then(({ installShipScene }) => {
      if (!live) return;
      try {
        handle.current = installShipScene(element, controller, still, () => { if (live) setStatus("ready"); }, () => { if (live) setStatus("failed"); });
        handle.current.update(latest.current);
      } catch { setStatus("failed"); }
    }).catch(() => { if (live) setStatus("failed"); });
    return () => { live = false; handle.current?.dispose(); handle.current = null; };
  }, [fx, controller]);
  const boarding = useRef(onBoard); boarding.current = onBoard;
  const loading = useRef(onCargo); loading.current = onCargo;
  // The canvas sits under the page, so clicks are caught at window level and ray-tested against the hull.
  useEffect(() => {
    const interactive = (target: EventTarget | null) => target instanceof Element && !!target.closest("a,button,input,select,textarea,label,.sc-stock,.pb-float,header,nav,aside,.ng-sidebar,.ng-header");
    let hovering = false;
    const move = (event: PointerEvent) => {
      const hit = event.pointerType === "mouse" && !interactive(event.target) ? handle.current?.hit(event.clientX, event.clientY) : null;
      const over = !!hit && (hit.kind === "cargo" ? !!loading.current : !!boarding.current);
      if (over !== hovering) { hovering = over; document.documentElement.classList.toggle("pb-ship-hover", over); }
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || interactive(event.target)) return;
      const hit = handle.current?.hit(event.clientX, event.clientY);
      if (!hit) return;
      // a logo container acts exactly like its board cell; the rest of the ship opens the selected stock
      if (hit.kind === "cargo") { const cargo = latest.current.cargo[hit.index]; if (cargo && loading.current) loading.current(cargo.code); }
      else boarding.current?.();
    };
    addEventListener("pointermove", move, { passive: true }); addEventListener("click", click);
    return () => { removeEventListener("pointermove", move); removeEventListener("click", click); document.documentElement.classList.remove("pb-ship-hover"); };
  }, []);
  const key = `${state.mood}|${state.hullName}|${state.hullSub}|${state.cargo.map(item => `${item.code}:${item.change}`).join(",")}`;
  useEffect(() => { handle.current?.update(latest.current); }, [key]);
  return <div className="pb-ship" data-state={status} aria-hidden="true"><canvas ref={canvas} /></div>;
}
