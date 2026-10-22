import { useEffect, useRef } from "react";

/** Decorative circuits, deliberately independent of market activity. */
export default function CyberBackdrop() {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let visible = true;
    const update = () => {
      node.dataset.running = String(visible && !document.hidden);
      node.parentElement?.toggleAttribute("data-cyber-paused", document.hidden);
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting); update();
    });
    observer.observe(node);
    document.addEventListener("visibilitychange", update);
    update();
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, []);
  const paths = [
    "M0 38H116L152 74H390L428 36H650",
    "M1440 140H1300L1240 200H1090L1048 242H860",
    "M0 610H94L136 568H330L376 614H540",
    "M1440 840H1320L1270 790H1120L1084 826H920",
  ];
  return <svg ref={ref} className="ng-cyber-backdrop" viewBox="0 0 1440 1000" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    {paths.map((d, i) => <g key={d}>
      <path d={d} className="ng-cyber-trace" />
      <path d={d} className={`ng-cyber-packet ng-cyber-packet-${i}`} pathLength="1000" />
    </g>)}
    <g className="ng-cyber-terminals"><circle cx="650" cy="36" r="3" /><circle cx="860" cy="242" r="3" /><circle cx="540" cy="614" r="3" /><circle cx="920" cy="826" r="3" /></g>
  </svg>;
}
