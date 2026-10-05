/// <reference lib="webworker" />
import "./workerCpuRaster";
import { contextSteps, facadeSteps, NEIGHBOUR_PALETTE, plinthSteps, runNow } from "./complexScene";
import type { PaintJob, TexParams } from "./paintClient";
import { preparedNormal, preparedContext } from './preparedPaint';

// Run the original painters, at their original resolution and with the same seeds.
// No animation-frame waits or nested normal workers are needed off the UI thread.
let queue = Promise.resolve();
self.onmessage = (e: MessageEvent<{ id: number; job: PaintJob }>) => {
  queue = queue.then(() => paint(e.data));
};
async function paint({ id, job }: { id: number; job: PaintJob }) {
  let readyNormal: ImageBitmap | null = null;
  try {
    const prepared = await preparedContext(job);
    if (prepared) {
      (self as unknown as Worker).postMessage({id,bitmaps:prepared.bitmaps,params:prepared.params,prepared:true},Object.values(prepared.bitmaps));
      return;
    }
    readyNormal = await preparedNormal(job);
    const normal = readyNormal as unknown as HTMLCanvasElement | undefined;
    const steps = job.kind === "facade" ? facadeSteps(job.palette, job.seed, job.scale ?? 1, normal ?? undefined, job.appearance === 'architecture')
      : job.kind === "plinth" ? plinthSteps(job.seed, job.tone, normal ?? undefined)
        : job.style === "apt" ? facadeSteps(NEIGHBOUR_PALETTE, 4242, job.scale ?? 1) : contextSteps(1000 + job.style.length, job.style, job.scale ?? 1);
    const textures = runNow(steps);
    const params: Record<string, TexParams> = {};
    const bitmaps: Record<string, ImageBitmap> = {};
    try {
      for (const [name, t] of Object.entries(textures)) {
        params[name] = { wrapS: t.wrapS, wrapT: t.wrapT, flipY: t.flipY, anisotropy: t.anisotropy,
          colorSpace: t.colorSpace, repeat: [t.repeat.x, t.repeat.y], offset: [t.offset.x, t.offset.y] };
        if (job.kind === 'facade' && job.appearance === 'architecture' && (name === 'normalMap' || name === 'rmMap')) params[name].surfaceKey = 'architecture-facade-v1';
        else if (readyNormal && (name === 'normalMap' || name === 'rmMap')) params[name].surfaceKey = job.kind === 'facade' || (job.kind === 'context' && job.style === 'apt')
          ? `facade-${job.scale ?? 1}` : job.kind === 'plinth' ? 'plinth' : `context-${job.style}-${job.scale ?? 1}`;
        const image = t.image as unknown as OffscreenCanvas;
        const raw = image instanceof OffscreenCanvas ? image.transferToImageBitmap()
          : await createImageBitmap(image, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
        bitmaps[name] = t.flipY ? await createImageBitmap(raw, {imageOrientation:'flipY',colorSpaceConversion:'none',premultiplyAlpha:'none'}) : raw;
        if (bitmaps[name] !== raw) raw.close();
        params[name].flipY = false;
        if (image instanceof OffscreenCanvas) image.width = image.height = 1;
        t.dispose();
      }
      (self as unknown as Worker).postMessage({ id, bitmaps, params }, Object.values(bitmaps));
    } catch (err) { Object.values(bitmaps).forEach(b => b.close()); throw err; }
  } catch {
    (self as unknown as Worker).postMessage({ id, bitmaps: null, params: null });
  } finally { readyNormal?.close(); }
}
