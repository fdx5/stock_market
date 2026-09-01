import type { IChartApi } from "lightweight-charts";

/** Keeps lightweight-charts from re-measuring itself while a window is resized.
 *
 * `autoSize` observes the chart's container and, on every frame of a window drag,
 * re-measures it and redraws every canvas the chart owns — and one chart owns
 * several (panes, both scales, the crosshair overlay). Traced against the live
 * site, the three charts on a stock detail page were the most expensive thing on
 * it by a wide margin while a window edge was being dragged.
 *
 * So autoSize is switched off for the duration of the drag and back on once it
 * settles; turning it back on re-attaches the observer, which re-measures and
 * redraws once. The chart holds its previous width for a fraction of a second in
 * between, which is the whole cost.
 *
 * Only *window* resizes are held. A container that changes on its own — a panel
 * growing as its data lands, a section unfolding — still resizes the chart
 * immediately, because that is the case autoSize exists for.
 */
export function holdChartSizeDuringResize(...charts: IChartApi[]): () => void {
  /** How long after the last resize event the drag is considered over. */
  const SETTLE_MS = 180;
  let settle = 0;
  const onResize = () => {
    if (settle) window.clearTimeout(settle);
    else for (const chart of charts) chart.applyOptions({ autoSize: false });
    settle = window.setTimeout(() => {
      settle = 0;
      for (const chart of charts) chart.applyOptions({ autoSize: true });
    }, SETTLE_MS);
  };
  window.addEventListener("resize", onResize, { passive: true });
  return () => {
    window.removeEventListener("resize", onResize);
    if (settle) window.clearTimeout(settle);
  };
}
