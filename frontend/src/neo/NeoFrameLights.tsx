import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFrameLight, useFxLevel } from "./settings";

const FRAMES = ".ng-header,.ng-top-rail,.ng-sidebar,.ng-context,.ng-atlas-heading,.ng-region-board,.ng-asset-belt,.ng-panel,.ng-dialog,.ed-market-overview,.ed-discovery-section,.d2-flow-panel,.d2-rank-panel,.sk-hero,.ng-stock-top-grid>#sk-chart,.ef-front,.bd-front,.gc-front,.bf-sheet,.nw-company,.st-pane,.sl-summary,.ng-sector-digest";
const keys = new WeakMap<Element, number>(); let nextKey = 0;
function frameKey(element: Element) { if (!keys.has(element)) keys.set(element, ++nextKey); return keys.get(element)!; }

function FrameBeam({ target, index }: { target: HTMLElement; index: number }) {
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const previous = target.style.position;
    const changed = getComputedStyle(target).position === "static";
    if (changed) target.style.position = "relative";
    const observer = new IntersectionObserver(entries => { svg.current?.classList.toggle("is-visible", entries.some(entry => entry.isIntersecting)); }, { rootMargin: "20px" });
    observer.observe(target);
    return () => { observer.disconnect(); if (changed && target.style.position === "relative") target.style.position = previous; };
  }, [target]);
  return createPortal(<svg ref={svg} className="ng-frame-layer" aria-hidden="true" focusable="false" style={{ "--beam-duration": `${9 + index % 5 * 2}s`, "--beam-delay": `${-index * 1.7}s` } as React.CSSProperties}>
    <rect className="ng-frame-nearline" x="1" y="1" rx="2" pathLength="100" />
    <rect className="ng-frame-halo" x="1" y="1" rx="2" pathLength="100" />
    <rect className="ng-frame-color" x="1" y="1" rx="2" pathLength="100" />
    <rect className="ng-frame-core" x="1" y="1" rx="2" pathLength="100" />
    <rect className="ng-frame-head" x="1" y="1" rx="2" pathLength="100" />
  </svg>, target);
}

/** Visible frame edges only. SVG strokes carry light without touching data renderers. */
export default function NeoFrameLights({ disabled = false }: { disabled?: boolean }) {
  const enabled = useFrameLight(), fx = useFxLevel();
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [targets, setTargets] = useState<HTMLElement[]>([]);
  useEffect(() => { const media = matchMedia("(prefers-reduced-motion: reduce)"); const update = () => setReduced(media.matches); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  useEffect(() => {
    if (!enabled || fx === "minimal" || reduced || disabled) { setTargets([]); return; }
    const shell = document.querySelector(".ng-shell"); if (!shell) return;
    let pending = 0;
    const scan = () => {
      pending = 0;
      const found = [...shell.querySelectorAll<HTMLElement>(FRAMES)];
      setTargets(previous => previous.length === found.length && previous.every((element, i) => element === found[i]) ? previous : found);
    };
    const observer = new MutationObserver(records => {
      const structural = records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && !node.matches(".ng-frame-layer") && !node.closest(".ng-frame-layer")));
      if (structural && !pending) pending = requestAnimationFrame(scan);
    });
    observer.observe(shell, { childList: true, subtree: true }); scan();
    return () => { observer.disconnect(); cancelAnimationFrame(pending); };
  }, [enabled, fx, reduced, disabled]);
  return <>{targets.map((target, index) => <FrameBeam target={target} index={index} key={frameKey(target)} />)}</>;
}
