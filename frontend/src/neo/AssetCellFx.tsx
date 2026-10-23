import { useEffect, useRef } from "react";
import { CELL_ART, type CellArtKind, type CellOpts } from "./assetCellArt";
import { useFxLevel } from "./settings";

type Instance = { canvas:HTMLCanvasElement; draw:(g:CanvasRenderingContext2D, w:number, h:number, t:number) => void; visible:boolean };
const live = new Set<Instance>();
let frame = 0;
const start = performance.now();

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
  item.draw(g, w, h, t);
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
    const item:Instance = { canvas, draw:CELL_ART[kind].create(opts), visible:false };
    const still = fx === "minimal" || matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      // A composed still frame instead of motion.
      const show = () => paint(item, 5.2);
      show();
      const sizes = new ResizeObserver(show); sizes.observe(canvas);
      return () => sizes.disconnect();
    }
    live.add(item);
    const seen = new IntersectionObserver(([entry]) => { item.visible = entry.isIntersecting; if (item.visible) wake(); });
    seen.observe(canvas);
    return () => { seen.disconnect(); live.delete(item); };
  }, [kind, fx]);
  return <canvas ref={ref} className={`ng-asset-fx ng-asset-fx--${CELL_ART[kind].fill ? "fill" : "side"}`} aria-hidden="true"/>;
}
