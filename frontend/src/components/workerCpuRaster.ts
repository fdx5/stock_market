/// <reference lib="webworker" />
/* Imported first by the 3D view's workers that paint on OffscreenCanvas (facades, ground, road
 * textures, photographs): their 2D contexts raster on the CPU, in the worker itself. Rastered by
 * the GPU (the default), every new kind of stroke or gradient made the browser's GPU process
 * compile a Skia shader while the complex loaded — 75–145 ms tasks there that held the page's
 * frames (trace 2026-10-05: "RendererBlinkWorker" flushes). On the CPU the time is the worker's
 * own, and the page keeps its frame rate. (The page's own canvases stay on the GPU: on the main
 * thread the CPU raster cost more than it saved — complexScene.ts CPU_CANVAS.) */
if (typeof OffscreenCanvas !== "undefined" && typeof document === "undefined") {
  const proto = OffscreenCanvas.prototype as unknown as { getContext: (type: string, opts?: Record<string, unknown>) => unknown };
  const original = proto.getContext;
  proto.getContext = function (this: OffscreenCanvas, type: string, opts?: Record<string, unknown>) {
    return original.call(this, type, type === "2d" ? { willReadFrequently: true, ...opts } : opts);
  };
}
export {};
