import { useEffect, useId, useRef, useState } from "react";

const DISCHARGES = [
  { core: "M0 9H17L25 8L31 11L39 4L44 13L51 7L57 10L65 9H84", forks: "M39 4L44 2L48 4M51 7L55 3L60 4M57 10L63 15L68 14" },
  { core: "M0 9H20L30 10L37 7L43 11L49 3L54 12L61 8L68 9H84", forks: "M37 7L34 3L29 4M49 3L55 2M54 12L58 16L63 15" },
  { core: "M0 9H14L26 8L34 10L42 6L49 12L57 5L63 10L70 9H84", forks: "M42 6L45 2L50 3M49 12L46 15L42 14M57 5L63 3L67 5" },
  { core: "M0 9H21L28 7L34 10L40 5L47 13L52 8L60 10L68 9H84", forks: "M28 7L25 3L20 4M40 5L43 1.5L47 3M47 13L51 16L56 15" },
  { core: "M0 9H11L23 10L30 6L38 11L45 2L50 12L58 8L65 9H84", forks: "M30 6L34 2L38 3M38 11L34 15L28 14M58 8L63 4L68 5" },
  { core: "M0 9H19L29 8L36 12L43 6L50 10L57 3L63 11L70 9H84", forks: "M29 8L25 4L20 5M43 6L46 2L52 3M63 11L67 16L72 14" },
  { core: "M0 9H14L24 7L32 11L39 8L46 14L53 5L60 10L69 9H84", forks: "M32 11L29 15L23 14M46 14L50 17L54 15M53 5L58 1.5L63 3" },
  { core: "M0 9H23L31 10L38 4L44 11L51 7L59 13L66 8L72 9H84", forks: "M38 4L33 1.5L28 3M51 7L55 3L61 4M59 13L64 16L69 14" },
  { core: "M0 9H16L27 8L33 12L41 7L49 10L56 2L62 12L69 9H84", forks: "M33 12L38 16L43 14M41 7L37 3L32 4M56 2L62 3L65 5" },
  { core: "M0 9H10L22 10L29 7L36 11L44 3L51 13L58 6L65 10L73 9H84", forks: "M29 7L25 3L19 4M44 3L49 1.5L54 4M51 13L56 17L62 15M65 10L70 5L75 6" },
] as const;

type Point = [number, number];
function readLines(path: string) {
  const tokens = path.match(/[MLH]|-?\d*\.?\d+/g)!;
  const lines: Point[][] = [];
  let line: Point[] = [], y = 9;
  for (let index = 0; index < tokens.length;) {
    const command = tokens[index++];
    const x = Number(tokens[index++]);
    if (command !== "H") y = Number(tokens[index++]);
    if (command === "M") { line = []; lines.push(line); }
    line.push([x, y]);
  }
  return lines;
}
const SHAPES = DISCHARGES.map(arc => ({ core: readLines(arc.core)[0], forks: readLines(arc.forks) }));
// Equal point counts let the browser interpolate geometry instead of swapping drawings.
const CORES = SHAPES.map(({ core }) => {
  let edge = 1;
  return Array.from({ length: 43 }, (_, index) => {
    const x = index * 2;
    while (edge < core.length - 1 && core[edge][0] < x) edge++;
    const [a, b] = [core[edge - 1], core[edge]];
    const y = a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
    return `${x},${y.toFixed(3)}`;
  }).join(" ");
});
const FORKS = Array.from({ length: 4 }, (_, branch) => SHAPES.map(({ forks }) => {
  const points = forks[branch] ?? [[65, 9]];
  return Array.from({ length: 3 }, (_, index) => points[Math.min(index, points.length - 1)].join(",")).join(" ");
}));
const KEY_TIMES = Array.from({ length: 11 }, (_, index) => index / 10).join(";");
const KEY_SPLINES = Array(10).fill("0.33 0 0.67 1").join(";");
function Morph({ values }: { values: string[] }) {
  return <animate attributeName="points" values={[...values, values[0]].join(";")} dur="4.7s"
    calcMode="spline" keyTimes={KEY_TIMES} keySplines={KEY_SPLINES} repeatCount="indefinite" />;
}

/** Decorative current along the shell's existing horizontal or vertical rules. */
export default function NeoHeaderCurrent({ tone = "gold", placement = "header" }: { tone?: "gold" | "violet"; placement?: "header" | "pulse" | "sidebar" }) {
  const gradientId = `ng-current-${useId().replace(/:/g, "")}`;
  const svg = useRef<SVGSVGElement>(null);
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const sync = () => { if (document.hidden) svg.current?.pauseAnimations(); else svg.current?.unpauseAnimations(); };
    sync(); document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [reduced]);
  if (reduced) return null;
  const filament = <span className={`ng-header-current ng-current-${placement}`} data-tone={tone} data-placement={placement} aria-hidden="true"><i>
    <svg ref={svg} className="ng-current-discharge" viewBox="0 0 84 19" focusable="false" data-shape-count={DISCHARGES.length}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--current-color)" stopOpacity="0" />
          <stop offset=".3" stopColor="var(--current-bright)" stopOpacity=".7" />
          <stop offset=".65" stopColor="var(--current-core)" />
          <stop offset=".84" stopColor="var(--current-tip)" />
          <stop offset="1" stopColor="var(--current-glow)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {FORKS.map((values, branch) => <polyline key={branch} className="ng-current-forks" points={values[0]}><Morph values={values} /></polyline>)}
      <polyline className="ng-current-filament" style={{ stroke: `url(#${gradientId})` }} points={CORES[0]}><Morph values={CORES} /></polyline>
      <circle className="ng-current-mote ng-current-mote-a" cx="64" cy="3.5" r=".65" />
      <circle className="ng-current-mote ng-current-mote-b" cx="71" cy="14.5" r=".55" />
    </svg>
  </i></span>;
  return placement === "sidebar" ? <span className="ng-sidebar-current" aria-hidden="true">{filament}</span> : filament;
}
