import { onPageSeenChange, pageUnseen } from "../pageCovered";

export interface BackdropEnvironment {
  viewport(): { width: number; height: number; dpr: number };
  unseen(): boolean;
  reduced: Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">;
  onSeen(callback: () => void): () => void;
  onResize(callback: () => void): () => void;
  onScroll(callback: (top: number) => void): () => void;
  onPointer(callback: (x: number, y: number) => void): () => void;
}

/** Browser fallback and render-worker use the same inputs, units and native DPR. */
export function browserBackdropEnvironment(): BackdropEnvironment {
  const view = { width: 0, height: 0, dpr: 1 };
  return {
    viewport: () => { view.width = innerWidth; view.height = innerHeight; view.dpr = devicePixelRatio || 1; return view; },
    unseen: pageUnseen, reduced: matchMedia("(prefers-reduced-motion: reduce)"), onSeen: onPageSeenChange,
    onResize(callback) { addEventListener("resize", callback); return () => removeEventListener("resize", callback); },
    onScroll(callback) {
      const listener = (event: Event) => callback(event.target instanceof Element ? event.target.scrollTop : scrollY);
      document.addEventListener("scroll", listener, { passive: true, capture: true });
      return () => document.removeEventListener("scroll", listener, { capture: true });
    },
    onPointer(callback) {
      const listener = (event: PointerEvent) => callback(event.clientX, event.clientY);
      addEventListener("pointermove", listener, { passive: true });
      return () => removeEventListener("pointermove", listener);
    },
  };
}
