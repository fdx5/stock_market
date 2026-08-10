import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { SceneStats } from "../hub2/scene";

/* ============================================================================
   FRAME METER — the readout behind `?fps`.
   ----------------------------------------------------------------------------
   ORBIT II is a WebGL scene with a DOM heads-up display over it, and the whole
   arrangement rests on one rule: the scene never re-renders React. This panel
   is measuring that scene, so it has to obey the rule more strictly than
   anything else on the page — a meter that costs a React render twice a second
   is a meter reporting on a page that only behaves that way because the meter
   is up.

   So nothing here is state. The markup is written once, refs are taken on the
   nodes that carry numbers, and every update is a textContent assignment and
   one canvas draw. No reconciliation, no allocation per update beyond the
   strings themselves.

   What it is for is the second half of the job: not "is it 60", but "why is it
   not". The four numbers under the graph are chosen to point at a cause rather
   than restate the symptom —

     CPU vs MS   how much of the frame this thread spent. Close to MS means the
                 main thread is the bottleneck and the work to cut is in JS.
                 Far below it means the frame is waiting on the GPU, and the
                 work to cut is fill rate: pixel ratio, bloom, the passes.
     WORST       the hitch a mean hides. A 60fps average with a 90ms worst is a
                 scene that stutters, and the mean will never say so.
     DRAW/TRI    what one frame actually submits. The number to watch while
                 turning an effect off, since it is the one that moves.
     GEO/TEX/PRG what is resident. Flat is correct; climbing is a leak.
   ========================================================================= */

export interface FrameMeterHandle {
  push(stats: SceneStats): void;
}

/** The graph, in CSS pixels. Fixed rather than measured: reading clientWidth
 * inside an update would force a layout flush twice a second, on the thread
 * whose spare time is the thing being reported. */
const GRAPH_W = 184;
const GRAPH_H = 38;

/** Full height of the graph, in milliseconds. Three 60Hz frames — high enough
 * that an ordinary frame sits low and a real hitch has somewhere to go, low
 * enough that the difference between 16 and 22ms is visible rather than a
 * rounding error at the bottom of the box. */
const GRAPH_MS = 50;

/** The two lines drawn across it: one 60Hz frame, and two. A bar under the
 * first is a frame that made its deadline. */
const BUDGET_60 = 1000 / 60;
const BUDGET_30 = 1000 / 30;

/** Green, amber, red — the same thresholds the bars and the headline use, so
 * a red number always has red bars under it. */
function toneOf(ms: number): "good" | "fair" | "bad" {
  if (ms <= 18.5) return "good";
  if (ms <= 26) return "fair";
  return "bad";
}

const BAR_COLOR = {
  good: "#39d98a",
  fair: "#f5c451",
  bad: "#ff5d5d",
} as const;

/** 1_432_118 → "1.4M". The triangle count is the one number here wide enough
 * to push the panel around, and its last five digits never carried anything. */
function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

const FrameMeter = forwardRef<FrameMeterHandle>(function FrameMeter(_props, ref) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fpsRef = useRef<HTMLSpanElement | null>(null);
  const msRef = useRef<HTMLSpanElement | null>(null);
  const cpuRef = useRef<HTMLSpanElement | null>(null);
  const worstRef = useRef<HTMLSpanElement | null>(null);
  const drawRef = useRef<HTMLSpanElement | null>(null);
  const triRef = useRef<HTMLSpanElement | null>(null);
  const memRef = useRef<HTMLSpanElement | null>(null);
  const tierRef = useRef<HTMLParagraphElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  /** The tone currently on the root, so the class is only touched when it
   * changes — a className write every update would invalidate style on the
   * panel sixty times a minute for nothing. */
  const toneRef = useRef<string>("");

  /* The backing store, sized to the display once. The panel never changes
     size, so a resize handler would only ever fire on a monitor change; the
     device pixel ratio is read at mount and left. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(GRAPH_W * dpr);
    canvas.height = Math.round(GRAPH_H * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctxRef.current = ctx;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      push(stats: SceneStats) {
        if (fpsRef.current) fpsRef.current.textContent = String(Math.round(stats.fps));
        if (msRef.current) msRef.current.textContent = `${stats.ms.toFixed(1)} ms`;
        if (cpuRef.current) cpuRef.current.textContent = `${stats.cpu.toFixed(1)}ms`;
        if (worstRef.current) worstRef.current.textContent = `${stats.worst.toFixed(1)}ms`;
        if (drawRef.current) drawRef.current.textContent = String(stats.calls);
        if (triRef.current) triRef.current.textContent = compact(stats.triangles);
        if (memRef.current) {
          memRef.current.textContent = `${stats.geometries} / ${stats.textures} / ${stats.programs}`;
        }
        if (tierRef.current) {
          tierRef.current.textContent = `${stats.tier.toUpperCase()} · DPR ${stats.dpr.toFixed(1)}`;
        }

        const tone = toneOf(stats.ms);
        if (rootRef.current && toneRef.current !== tone) {
          rootRef.current.dataset.tone = tone;
          toneRef.current = tone;
        }

        drawGraph(ctxRef.current, stats.history);
      },
    }),
    []
  );

  return (
    /* aria-hidden, and deliberately: it is a debugging instrument that changes
       twice a second, and a live region announcing "58, 59, 57" over the top of
       a page someone is trying to use would be actively hostile. Nothing here
       is content — every number in it describes the browser, not the market. */
    <div className="h2-fps" ref={rootRef} data-tone="good" aria-hidden="true">
      <div className="h2-fps-head">
        <span className="h2-fps-num" ref={fpsRef}>
          —
        </span>
        <span className="h2-fps-unit">FPS</span>
        <span className="h2-fps-ms" ref={msRef}>
          — ms
        </span>
      </div>
      <canvas className="h2-fps-graph" ref={canvasRef} width={GRAPH_W} height={GRAPH_H} />
      <dl className="h2-fps-grid">
        <div>
          <dt>CPU</dt>
          <dd ref={cpuRef}>—</dd>
        </div>
        <div>
          <dt>WORST</dt>
          <dd ref={worstRef}>—</dd>
        </div>
        <div>
          <dt>DRAW</dt>
          <dd ref={drawRef}>—</dd>
        </div>
        <div>
          <dt>TRI</dt>
          <dd ref={triRef}>—</dd>
        </div>
        <div className="h2-fps-wide">
          <dt>GEO/TEX/PRG</dt>
          <dd ref={memRef}>—</dd>
        </div>
      </dl>
      <p className="h2-fps-tier" ref={tierRef}>
        —
      </p>
    </div>
  );
});

/** One pass over the history: the deadline lines, then a column per frame.
 *
 * Bars are drawn in three runs grouped by colour rather than one at a time,
 * because a fillStyle change between every bar is 128 state changes on the 2D
 * context and the whole point of this panel is not to cost anything. */
function drawGraph(ctx: CanvasRenderingContext2D | null, history: number[]) {
  if (!ctx || !history.length) return;
  ctx.clearRect(0, 0, GRAPH_W, GRAPH_H);

  // The two deadlines, under the bars so a spike is never hidden by a rule.
  ctx.fillStyle = "rgba(140, 165, 200, 0.16)";
  ctx.fillRect(0, GRAPH_H - (BUDGET_60 / GRAPH_MS) * GRAPH_H, GRAPH_W, 1);
  ctx.fillStyle = "rgba(140, 165, 200, 0.1)";
  ctx.fillRect(0, GRAPH_H - (BUDGET_30 / GRAPH_MS) * GRAPH_H, GRAPH_W, 1);

  const width = GRAPH_W / history.length;
  for (const tone of ["good", "fair", "bad"] as const) {
    ctx.fillStyle = BAR_COLOR[tone];
    for (let i = 0; i < history.length; i++) {
      const ms = history[i];
      // A zero is a slot the ring has not reached yet, in the first two
      // seconds of a session. Drawn as a bar it would read as a perfect frame,
      // which is the one thing it is not evidence of.
      if (ms <= 0 || toneOf(ms) !== tone) continue;
      const height = Math.max(1, Math.min(ms / GRAPH_MS, 1) * GRAPH_H);
      ctx.fillRect(i * width, GRAPH_H - height, Math.max(width - 0.4, 0.6), height);
    }
  }
}

export default FrameMeter;
