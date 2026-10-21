import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFrameLight, useFxLevel } from "./settings";

const FRAMES = ".ng-top-rail,.ng-sidebar,.ng-context,.ng-atlas-heading,.ng-region-board,.ng-region-us,.ng-asset-belt,.ng-panel,.ng-dialog,.ed-market-overview,.ed-discovery-section,.d2-flow-panel,.d2-rank-panel,.sk-hero,.ng-stock-top-grid>#sk-chart,.ef-front,.bd-front,.gc-front,.bf-sheet,.nw-company,.st-pane,.sl-summary,.ng-sector-digest";
const keys = new WeakMap<Element, number>(); let nextKey = 0;
function frameKey(element: Element) { if (!keys.has(element)) keys.set(element, ++nextKey); return keys.get(element)!; }

function FrameGlow({ target, index }: { target: HTMLElement; index: number }) {
  const svg = useRef<SVGSVGElement>(null);
  const path = useRef<SVGPathElement>(null);
  useEffect(() => {
    const previous = target.style.position;
    const changed = getComputedStyle(target).position === "static";
    if (changed) target.style.position = "relative";
    const measure = () => {
      if (!svg.current || !path.current) return;
      const style = getComputedStyle(target), box = target.getBoundingClientRect();
      const top = parseFloat(style.borderTopWidth) || 0, right = parseFloat(style.borderRightWidth) || 0;
      const bottom = parseFloat(style.borderBottomWidth) || 0, left = parseFloat(style.borderLeftWidth) || 0;
      Object.assign(svg.current.style, { left: `${-left}px`, top: `${-top}px`, width: `${box.width}px`, height: `${box.height}px` });
      const commands = [];
      if (top) commands.push(`M0 ${top / 2}H${box.width}`);
      if (right) commands.push(`M${box.width - right / 2} 0V${box.height}`);
      if (bottom) commands.push(`M0 ${box.height - bottom / 2}H${box.width}`);
      if (left) commands.push(`M${left / 2} 0V${box.height}`);
      path.current.setAttribute("d", commands.join(" "));
    };
    let pendingMeasure = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(pendingMeasure);
      pendingMeasure = requestAnimationFrame(measure);
    });
    resize.observe(target); measure();
    const observer = new IntersectionObserver(entries => { svg.current?.classList.toggle("is-visible", entries.some(entry => entry.isIntersecting)); }, { rootMargin: "20px" });
    observer.observe(target);
    return () => { observer.disconnect(); resize.disconnect(); cancelAnimationFrame(pendingMeasure); if (changed && target.style.position === "relative") target.style.position = previous; };
  }, [target]);
  return createPortal(<svg ref={svg} className="ng-frame-layer" aria-hidden="true" focusable="false" style={{ "--glow-duration": `${12 + index % 3 * 3}s`, "--glow-delay": `${-index * 1.1}s` } as React.CSSProperties}>
    <path ref={path} className="ng-frame-glow" />
  </svg>, target);
}

/** Only existing border sides glow. Pulse fades completely out between cycles. */
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
  return <>{targets.map((target, index) => <FrameGlow target={target} index={index} key={frameKey(target)} />)}</>;
}
