/** Safari does not expose deviceMemory. iPad also reports a desktop Mac UA. */
export function sceneDeviceBudget(device: { userAgent?: string; platform?: string; maxTouchPoints?: number; deviceMemory?: number } = typeof navigator === 'undefined' ? {} : navigator) {
  const appleTouch = /iPad|iPhone|iPod/.test(device.userAgent ?? '') ||
    (/Mac/.test(device.platform ?? '') && (device.maxTouchPoints ?? 0) > 1);
  const constrained = appleTouch || (device.deviceMemory !== undefined && device.deviceMemory <= 4);
  return { constrained, maxRatio: constrained ? 1.5 : 3, startPixels: constrained ? 1.25e6 : 4.5e6,
    maxPixels: constrained ? 2e6 : 14e6, samples: constrained ? 0 : 4,
    shadow: constrained ? 1024 : 2048, paintEdge: constrained ? 768 : Infinity,
    retainPrevious: !constrained };
}

/** Memory caps apply to every input method, full-screen resize and debug pr override. */
export function capSceneRatio(width: number, height: number, wanted: number, budget: ReturnType<typeof sceneDeviceBudget>) {
  const w = Math.max(1, width), h = Math.max(1, height);
  const ratio = Math.min(Math.max(0.01, wanted), budget.maxRatio, Math.sqrt(budget.maxPixels / (w * h)));
  // Canvas dimensions round independently; reserve half a pixel in each axis
  // when their product would exceed the mathematical area cap.
  return Math.round(w * ratio) * Math.round(h * ratio) > budget.maxPixels
    ? Math.max(0.001, ratio - 0.5 / w - 0.5 / h) : ratio;
}

/** Canvas width/height setters allocate separately. Avoid a large intermediate
 * rectangle when changing between portrait and landscape before the final resize. */
export function prepareCanvasResize(canvas: { width: number; height: number }, width: number, height: number, maxPixels: number) {
  if (width * canvas.height > maxPixels) canvas.height = 1;
  if (height * canvas.width > maxPixels) canvas.width = 1;
}

/** User policy: never lower resolution for performance. Choose the initial
 * display resolution once, then retain it through loading, pressure and resize.
 * The pixel budget limits optional supersampling, not the display's native DPR.
 * An explicit pr URL parameter remains a user-selected comparison override. */
export function fixedSceneResolution(dpr: number, desktop: boolean, budget: ReturnType<typeof sceneDeviceBudget>, requested = 0) {
  const native = Math.max(.01, dpr || 1);
  let locked: number | undefined;
  return {
    forSize(width: number, height: number) {
      if (locked !== undefined) return locked;
      if (width <= 0 || height <= 0) return requested || native;
      if (requested > 0) return locked = capSceneRatio(width, height, requested, budget);
      const wanted = desktop ? Math.max(native, Math.min(2, Math.floor(Math.sqrt(budget.startPixels / (width * height)) * 4) / 4)) : native;
      return locked = Math.max(native, capSceneRatio(width, height, wanted, budget));
    },
  };
}
