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

/** Target 60 fps with a 50 fps lower bound. Sustained pressure reduces pixel
 * work before increasing it again; isolated network/decode stalls are ignored. */
export function frameResolutionBudget() {
  let elapsed = 0, frames = 0, coolUntil = 0, fastSince = 0;
  return {
    reset() { elapsed = frames = fastSince = 0; },
    sample(now: number, frameMs: number, ratio: number, floor: number, ceiling: number) {
      if (now < coolUntil || frameMs <= 0 || frameMs > 250) return ratio;
      elapsed += frameMs; frames++;
      if (elapsed < 750 || frames < 12) return ratio;
      const average = elapsed / frames; elapsed = frames = 0;
      if (average > 19 && ratio > floor + .01) {
        fastSince = 0; coolUntil = now + 1500;
        return Math.max(floor, ratio * .875);
      }
      if (average < 17.5 && ratio < ceiling - .01) {
        fastSince ||= now;
        if (now - fastSince >= 8000) {
          coolUntil = now + 4000; fastSince = 0;
          return Math.min(ceiling, ratio * 1.05);
        }
      } else fastSince = 0;
      return ratio;
    },
  };
}
