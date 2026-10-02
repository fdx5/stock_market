/// <reference lib="webworker" />
import { preparedEffect } from './preparedEffects';
self.onmessage = async () => {
  try {
    const bitmap = await preparedEffect('moon');
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(bitmap, [bitmap]);
    return;
  } catch { /* Preserve the original generator if the prepared asset is unavailable. */ }
  const canvas = new OffscreenCanvas(128, 128), g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,250,235,0.32)'); grad.addColorStop(0.3, 'rgba(225,232,255,0.1)'); grad.addColorStop(1, 'rgba(200,215,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const bitmap = canvas.transferToImageBitmap();
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(bitmap, [bitmap]);
};
export {};
