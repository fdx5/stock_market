/// <reference lib="webworker" />
import {paintWakes} from './sceneBoats';
import { preparedEffect } from './preparedEffects';
self.onmessage = async () => {
  const names = ['wakeMap', 'wakeNormal', 'wash', 'spray'] as const;
  const prepared = await Promise.allSettled(names.map(preparedEffect));
  if (prepared.every(reply => reply.status === 'fulfilled')) {
    const bitmaps: Record<string, ImageBitmap> = {};
    prepared.forEach((reply, i) => { if (reply.status === 'fulfilled') bitmaps[names[i]] = reply.value; });
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(bitmaps, Object.values(bitmaps));
    return;
  }
  for (const reply of prepared) if (reply.status === 'fulfilled') reply.value.close();
  const steps = paintWakes((w,h) => new OffscreenCanvas(w,h) as unknown as HTMLCanvasElement);
  let next = steps.next(); while (!next.done) next = steps.next();
  const bitmaps: Record<string, ImageBitmap> = {};
  for (const [name, texture] of Object.entries(next.value)) bitmaps[name] = await createImageBitmap(texture.image as OffscreenCanvas);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(bitmaps, Object.values(bitmaps));
};
