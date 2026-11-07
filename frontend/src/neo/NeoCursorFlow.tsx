import { useEffect } from "react";
import { useFxLevel } from "./settings";
import { installCursorFlow } from "./cursorFlow";
import "./cursorFlow.css";

/** One decorative layer for every workspace, including menus and lazy routes. */
export default function NeoCursorFlow() {
  const fx = useFxLevel();
  useEffect(() => {
    const pointer = matchMedia("(any-hover: hover) and (any-pointer: fine)");
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let dispose: (() => void) | undefined;
    const sync = () => {
      dispose?.();
      dispose = undefined;
      if (fx !== "minimal" && pointer.matches && !motion.matches) {
        dispose = installCursorFlow(fx);
      }
    };
    sync();
    pointer.addEventListener("change", sync);
    motion.addEventListener("change", sync);
    return () => {
      pointer.removeEventListener("change", sync);
      motion.removeEventListener("change", sync);
      dispose?.();
    };
  }, [fx]);
  return null;
}
