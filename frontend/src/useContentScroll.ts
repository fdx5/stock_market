import { RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { scrollContentStart } from "./scrollNavigation";

/** A click requests one scroll after React commits; async content gets a final alignment. */
export function useContentScroll(target: RefObject<HTMLElement>, busy = false): () => void {
  const pending = useRef(false);
  const deadline = useRef(0);
  useEffect(() => {
    const cancel = () => { pending.current = false; };
    for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) window.addEventListener(type, cancel, { passive: true });
    return () => { for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) window.removeEventListener(type, cancel); };
  }, []);
  useLayoutEffect(() => {
    if (!pending.current || !target.current) return;
    if (performance.now() > deadline.current) { pending.current = false; return; }
    scrollContentStart(target.current);
    if (!busy) pending.current = false;
  });
  return () => { pending.current = true; deadline.current = performance.now() + 4_000; };
}
