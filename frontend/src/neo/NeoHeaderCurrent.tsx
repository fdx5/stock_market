import { useEffect, useRef, useState, type RefObject } from "react";
import { useTone } from "./settings";

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
/* The discharge used to be SVG with SMIL point morphs and per-element CSS opacity animations.
   SVG children cannot be composited, so every frame re-ran style, layout and paint on the main
   thread for all three filaments (about half the pulse board's main-thread time on a phone).
   It is now drawn into a small canvas with the same geometry, timing curves, colours and glow. */
const POINTS = {
  cores: CORES.map(values => values.split(" ").flatMap(pair => pair.split(",").map(Number))),
  forks: FORKS.map(shapes => shapes.map(values => values.split(" ").flatMap(pair => pair.split(",").map(Number)))),
};
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x: number) => {
    if (x <= 0 || x >= 1) return Math.min(1, Math.max(0, x));
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 20; i++) { const v = at(x1, x2, t); if (Math.abs(v - x) < 1e-5) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    return at(y1, y2, t);
  };
}
const SPLINE = bezier(.33, 0, .67, 1), EASE_IN_OUT = bezier(.42, 0, .58, 1), EASE_OUT = bezier(0, 0, .58, 1);
/** SMIL calcMode="spline" over the 10 shapes and back to the first, 4.7 s a loop. */
function morph(shapes: number[][], time: number, out: number[]) {
  const phase = (time % 4.7) / 4.7 * 10, index = Math.floor(phase), f = SPLINE(phase - index);
  const a = shapes[index % 10], b = shapes[(index + 1) % 10];
  out.length = a.length;
  for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * f;
  return out;
}
/** A CSS keyframe track: [offset, ...values] rows with one easing per segment. */
function track(frames: number[][], ease: (x: number) => number, u: number) {
  let i = 1; while (i < frames.length - 1 && frames[i][0] < u) i++;
  const a = frames[i - 1], b = frames[i], f = ease((u - a[0]) / Math.max(1e-6, b[0] - a[0]));
  return a.slice(1).map((value, k) => value + (b[k + 1] - value) * f);
}
const CORONA = [[0, .42], [.36, .85], [.63, .56], [1, .42]];
const MOTE = [[0, 0, 0, 0], [.25, 0, 0, 0], [.3, .8, -1, 0], [.42, 0, -5, -1.5], [.45, 0, 0, 0], [1, 0, 0, 0]];
const PAD = 6, W = 84, H = 19;

type Instance = { canvas: HTMLCanvasElement; host: HTMLElement; visible: boolean; colors: Record<string, string> | null; buffer: HTMLCanvasElement; ratio: number };
const instances = new Set<Instance>();
let frame = 0;
const scratch = { core: [] as number[], fork: [] as number[] };
function withAlpha(g: CanvasRenderingContext2D, color: string, alpha: number) {
  g.fillStyle = "#000"; g.fillStyle = color;
  const value = String(g.fillStyle);
  if (value.startsWith("#")) { const n = parseInt(value.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`; }
  const m = value.match(/rgba?\(([^)]+)\)/); if (!m) return color;
  const [r, gg, b, a = "1"] = m[1].split(",").map(v => v.trim());
  return `rgba(${r},${gg},${b},${Number(a) * alpha})`;
}
function readColors(host: HTMLElement) {
  const style = getComputedStyle(host), out: Record<string, string> = {};
  for (const name of ["color", "bright", "core", "tip", "forks", "glow"]) out[name] = style.getPropertyValue(`--current-${name}`).trim() || "#e4b738";
  return out;
}
function paint(item: Instance, time: number) {
  const ratio = Math.min(4, devicePixelRatio || 1);
  if (item.ratio !== ratio) {
    item.ratio = ratio;
    for (const c of [item.canvas, item.buffer]) { c.width = Math.round((W + PAD * 2) * ratio); c.height = Math.round((H + PAD * 2) * ratio); }
  }
  item.colors ??= readColors(item.host);
  const colors = item.colors;
  const g = item.buffer.getContext("2d")!;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, item.buffer.width, item.buffer.height);
  g.setTransform(ratio, 0, 0, ratio, PAD * ratio, PAD * ratio);
  g.lineJoin = "round"; g.lineCap = "round";
  const stroke = (points: number[]) => { g.beginPath(); g.moveTo(points[0], points[1]); for (let i = 2; i < points.length; i += 2) g.lineTo(points[i], points[i + 1]); g.stroke(); };
  // forks share one corona opacity track
  g.globalAlpha = track(CORONA, EASE_IN_OUT, (time % 2.17) / 2.17)[0];
  g.strokeStyle = colors.forks; g.lineWidth = .65;
  for (const shapes of POINTS.forks) stroke(morph(shapes, time, scratch.fork));
  // the core filament; its gradient spans the polyline's 0..84 bounding box
  g.globalAlpha = 1;
  const gradient = g.createLinearGradient(0, 0, W, 0);
  gradient.addColorStop(0, withAlpha(g, colors.color, 0)); gradient.addColorStop(.3, withAlpha(g, colors.bright, .7));
  gradient.addColorStop(.65, colors.core); gradient.addColorStop(.84, colors.tip); gradient.addColorStop(1, withAlpha(g, colors.glow, 0));
  g.strokeStyle = gradient; g.lineWidth = 1.05;
  stroke(morph(POINTS.cores, time, scratch.core));
  // motes
  g.fillStyle = colors.tip;
  for (const [x, y, r, delay] of [[64, 3.5, .65, 0], [71, 14.5, .55, 1.43]]) {
    const [opacity, dx, dy] = track(MOTE, EASE_OUT, ((time + delay) % 3.4) / 3.4);
    if (opacity <= 0) continue;
    g.globalAlpha = opacity; g.beginPath(); g.arc(x + dx, y + dy, r, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  // drop-shadow(0 0 1.8px glow) over the whole drawing, as the SVG filter did
  const out = item.canvas.getContext("2d")!;
  out.setTransform(1, 0, 0, 1, 0, 0); out.clearRect(0, 0, item.canvas.width, item.canvas.height);
  out.shadowColor = colors.glow; out.shadowBlur = 1.8 * ratio;
  out.drawImage(item.buffer, 0, 0);
}
function tick(now: number) {
  frame = 0;
  const clock = (window as unknown as { __ngCurrentClock?: number }).__ngCurrentClock;
  const time = typeof clock === "number" ? clock : now / 1000;
  let live = false;
  instances.forEach(item => { if (item.visible) { paint(item, time); live = true; } });
  if (live && !document.hidden) frame = requestAnimationFrame(tick);
}
function wake() { if (!frame && !document.hidden) frame = requestAnimationFrame(tick); }
if (typeof document !== "undefined") document.addEventListener("visibilitychange", wake);

function Discharge({ host }: { host: RefObject<HTMLSpanElement> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tone = useTone();
  const item = useRef<Instance | null>(null);
  useEffect(() => {
    const element = canvas.current, owner = host.current;
    if (!element || !owner) return;
    const entry: Instance = { canvas: element, host: owner, visible: false, colors: null, buffer: document.createElement("canvas"), ratio: 0 };
    item.current = entry; instances.add(entry);
    const observer = new IntersectionObserver(([record]) => { entry.visible = record.isIntersecting; if (entry.visible) wake(); });
    observer.observe(element);
    return () => { observer.disconnect(); instances.delete(entry); item.current = null; };
  }, [host]);
  // colours follow the tone: the light tone restyles the --current-* variables
  useEffect(() => { if (item.current) { item.current.colors = null; wake(); } }, [tone]);
  return <canvas ref={canvas} className="ng-current-discharge" data-shape-count={DISCHARGES.length} />;
}

/** Decorative current along the shell's existing horizontal or vertical rules. */
export default function NeoHeaderCurrent({ tone = "gold", placement = "header" }: { tone?: "gold" | "violet"; placement?: "header" | "pulse" | "sidebar" }) {
  const host = useRef<HTMLSpanElement>(null);
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  if (reduced) return null;
  const filament = <span ref={host} className={`ng-header-current ng-current-${placement}`} data-tone={tone} data-placement={placement} aria-hidden="true"><i>
    <Discharge host={host} />
  </i></span>;
  return placement === "sidebar" ? <span className="ng-sidebar-current" aria-hidden="true">{filament}</span> : filament;
}
