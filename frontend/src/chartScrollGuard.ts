import type { IChartApi } from "lightweight-charts";

/**
 * Every lightweight-charts instance on the site used to take the mouse wheel for
 * zooming. On the long detail pages (종목상세, 지수차트, DRAM) that meant a reader
 * scrolling down the page stalled the moment the pointer crossed a chart — the wheel
 * silently rescaled the time axis instead of moving the page, and the only way out
 * was to steer the cursor around the chart.
 *
 * The fix follows the same convention embedded maps use: the wheel always belongs to
 * the page, and zoom moves to an explicit gesture — Ctrl/⌘ + wheel, or a trackpad
 * pinch (which browsers deliver as a ctrl-wheel). Panning by dragging, the range
 * buttons and the crosshair are all untouched.
 */
export const PAGE_SCROLL_SAFE_CHART_OPTIONS = {
  handleScroll: {
    // The wheel and a vertical touch drag are how a page is scrolled; neither may
    // be swallowed here. Horizontal drag still pans the time axis.
    mouseWheel: false,
    vertTouchDrag: false,
    horzTouchDrag: true,
    pressedMouseMove: true,
  },
  handleScale: {
    // Zoom is re-implemented in attachChartZoomGuard behind Ctrl/⌘, because the
    // library's own wheel handler cannot be limited to a modifier.
    mouseWheel: false,
    pinch: true,
    axisPressedMouseMove: true,
    axisDoubleClickReset: true,
  },
} as const;

/** One wheel notch changes the visible span by this fraction. */
const ZOOM_STEP = 0.2;
/** Never zoom in past this many bars, or the chart becomes unreadable. */
const MIN_VISIBLE_BARS = 8;
const HINT_VISIBLE_MS = 1600;

export interface ChartZoomGuardOptions {
  /** Shown briefly when the reader wheels over the chart without a modifier. */
  hint?: string;
  /** Skip the hint entirely (compact panels where the badge would cover the plot). */
  showHint?: boolean;
}

const modifierHeld = (event: WheelEvent) => event.ctrlKey || event.metaKey;

/**
 * Wires the Ctrl/⌘ + wheel zoom onto one chart and lets every unmodified wheel
 * event bubble to the page. Returns a teardown to call before `chart.remove()`.
 */
export function attachChartZoomGuard(
  container: HTMLElement,
  chart: IChartApi,
  options: ChartZoomGuardOptions = {},
): () => void {
  const { hint = "Ctrl + 휠로 확대/축소", showHint = true } = options;

  let hintEl: HTMLDivElement | null = null;
  let hintTimer = 0;
  const restorePosition = getComputedStyle(container).position === "static" ? container.style.position : null;

  const flashHint = () => {
    if (!showHint) return;
    if (!hintEl) {
      if (restorePosition !== null) container.style.position = "relative";
      hintEl = document.createElement("div");
      hintEl.className = "chart-zoom-hint";
      hintEl.setAttribute("aria-hidden", "true");
      hintEl.textContent = hint;
      container.appendChild(hintEl);
    }
    hintEl.classList.add("is-visible");
    window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => hintEl?.classList.remove("is-visible"), HINT_VISIBLE_MS);
  };

  const onWheel = (event: WheelEvent) => {
    if (!modifierHeld(event)) {
      // Vertical intent only: a horizontal wheel/shift-wheel is not a page scroll,
      // so nagging about the modifier there would be noise.
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) flashHint();
      return;
    }
    // Ctrl + wheel is also the browser's own page-zoom shortcut, so it has to be
    // claimed explicitly once we have decided to treat it as a chart gesture.
    if (event.cancelable) event.preventDefault();
    if (!event.deltaY) return;

    const timeScale = chart.timeScale();
    const visible = timeScale.getVisibleLogicalRange();
    if (!visible) return;
    const span = visible.to - visible.from;
    if (span <= 0) return;

    const rect = container.getBoundingClientRect();
    // Anchor the zoom on the bar under the cursor, the way the library's own wheel
    // zoom did, so the candle being examined stays put.
    const ratio = rect.width > 0 ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0.5;
    const anchor = visible.from + span * ratio;
    const nextSpan = Math.max(MIN_VISIBLE_BARS, span * (event.deltaY > 0 ? 1 + ZOOM_STEP : 1 / (1 + ZOOM_STEP)));
    const scale = nextSpan / span;

    timeScale.setVisibleLogicalRange({
      from: anchor - (anchor - visible.from) * scale,
      to: anchor + (visible.to - anchor) * scale,
    });
  };

  container.addEventListener("wheel", onWheel, { passive: false });

  return () => {
    container.removeEventListener("wheel", onWheel);
    window.clearTimeout(hintTimer);
    hintEl?.remove();
    hintEl = null;
    if (restorePosition !== null) container.style.position = restorePosition;
  };
}
