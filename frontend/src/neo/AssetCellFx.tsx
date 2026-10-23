import { useEffect, useRef } from "react";
import { CELL_ART, type CellArtKind, type CellOpts, type Overlay } from "./assetCellArt";
import { useFxLevel } from "./settings";

/** An overlay canvas for art that spills out of its cell (smoke, falling dust); fixed to the viewport and
 *  moved with the cell every frame. It never takes pointer input. */
type Sky = { el:HTMLCanvasElement; used:boolean; area:Overlay };
type Instance = { canvas:HTMLCanvasElement; draw:ReturnType<(typeof CELL_ART)[CellArtKind]["create"]>; visible:boolean; sky:Sky | null };
const live = new Set<Instance>();
let frame = 0;
const start = performance.now();

function makeSky(area:Overlay):Sky {
  const el = document.createElement("canvas");
  el.className = "ng-asset-sky"; el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);
  return { el, used:false, area };
}
function clearSky(sky:Sky | null) {
  if (!sky?.used) return;
  const g = sky.el.getContext("2d");
  // Reset the transform first: the art draws with an offset, and a transformed clear would miss the edges.
  if (g) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, sky.el.width, sky.el.height); }
  sky.used = false;
}

function paint(item:Instance, t:number) {
  const { canvas } = item, dpr = Math.min(devicePixelRatio || 1, 3);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
  let sg:CanvasRenderingContext2D | null = null;
  const { sky } = item;
  if (sky) {
    const { above, below } = sky.area, box = canvas.getBoundingClientRect(), side = w * sky.area.side, sw = w + side * 2, sh = above + h + below;
    const { style } = sky.el, left = `${box.left - side}px`, top = `${box.top - above}px`;
    if (style.left !== left) style.left = left;
    if (style.top !== top) style.top = top;
    if (sky.el.width !== Math.round(sw * dpr) || sky.el.height !== Math.round(sh * dpr)) {
      sky.el.width = Math.round(sw * dpr); sky.el.height = Math.round(sh * dpr);
      style.width = `${sw}px`; style.height = `${sh}px`;
    }
    sg = sky.el.getContext("2d");
    if (sg) { clearSky(sky); sg.setTransform(dpr, 0, 0, dpr, side * dpr, above * dpr); }
  }
  const used = item.draw(g, w, h, t, sg);
  if (sky) sky.used = used === true;
}

/** One loop for every cell; it stops when no cell is on screen or the tab is hidden. */
function loop(now:number) {
  frame = 0;
  if (document.hidden) return;
  let any = false;
  for (const item of live) if (item.visible) { any = true; paint(item, (now - start) / 1000); }
  if (any) frame = requestAnimationFrame(loop);
}
const wake = () => { if (!frame && !document.hidden) frame = requestAnimationFrame(loop); };
if (typeof document !== "undefined") document.addEventListener("visibilitychange", wake);

/** Decorative animation inside a "Prices in between" cell. Not data: hidden from assistive tech. */
export default function AssetCellFx({ kind, up = false }:{ kind:CellArtKind; up?:boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // One object for the life of the canvas, updated in place so the scene need not restart.
  const opts = useRef<CellOpts>({ up }).current;
  opts.up = up;
  const fx = useFxLevel();
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const item:Instance = { canvas, draw:CELL_ART[kind].create(opts), visible:false, sky:null };
    const still = fx === "minimal" || matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      // A composed still frame instead of motion.
      const show = () => paint(item, 5.2);
      show();
      const sizes = new ResizeObserver(show); sizes.observe(canvas);
      return () => sizes.disconnect();
    }
    const area = CELL_ART[kind].overlay;
    if (area) item.sky = makeSky(area);
    live.add(item);
    // An off-screen cell stops painting, so its overlay is wiped rather than left hanging.
    const seen = new IntersectionObserver(([entry]) => { item.visible = entry.isIntersecting; if (item.visible) wake(); else clearSky(item.sky); });
    seen.observe(canvas);
    return () => { seen.disconnect(); live.delete(item); item.sky?.el.remove(); };
  }, [kind, fx]);
  return <canvas ref={ref} className={`ng-asset-fx ng-asset-fx--${CELL_ART[kind].fill ? "fill" : "side"}`} aria-hidden="true"/>;
}
