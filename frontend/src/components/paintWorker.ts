/// <reference lib="webworker" />

/* The painted textures of the 3D view (a complex's facades and granite base, the
 * neighbourhood's facade styles) kept in IndexedDB, so a later visit decodes them instead
 * of painting them again. Encoding (lossless PNG: normals and masks are data) and
 * decoding both happen here, off the page's thread.
 *
 *   { op: "get", id, key }                 -> { id, bitmaps: { name: ImageBitmap } | null, params }
 *   { op: "put", key, params, bitmaps }    -> (kept; the bitmaps are closed)
 */

import { readPaint, writePaint } from "./paintStore";
import { contextSteps, facadeSteps, plinthSteps, NEIGHBOUR_PALETTE, runNow } from './complexScene';
import type { PaintJob, TexParams } from './paintClient';
let cacheQueue = Promise.resolve();
let cacheAllowed = false;
const RAW: ImageBitmapOptions = { colorSpaceConversion: "none", premultiplyAlpha: "none" };

type Msg = {op:"cacheVisibility";hidden:boolean} | {op:"paint";key:string;job:PaintJob} | { op: "get"; id: number; key: string } | { op: "put"; key: string; params: unknown; bitmaps: Record<string, ImageBitmap> };

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  if (m.op === 'cacheVisibility') { cacheAllowed=m.hidden; return; }
  if (m.op === 'paint') {
    cacheQueue = cacheQueue.then(async () => {
      if (!cacheAllowed) return;
      const job=m.job;
      const textures=runNow(job.kind==='facade' ? facadeSteps(job.palette,job.seed,job.scale??1,undefined,job.appearance==='architecture')
        : job.kind==='plinth' ? plinthSteps(job.seed,job.tone)
        : job.style==='apt' ? facadeSteps(NEIGHBOUR_PALETTE,4242,job.scale??1) : contextSteps(1000+job.style.length,job.style,job.scale??1));
      const bitmaps: Record<string,ImageBitmap>={}, params: Record<string,TexParams>={};
      try {
        for (const [name,t] of Object.entries(textures)) {
          params[name]={wrapS:t.wrapS,wrapT:t.wrapT,flipY:t.flipY,anisotropy:t.anisotropy,colorSpace:t.colorSpace,repeat:[t.repeat.x,t.repeat.y],offset:[t.offset.x,t.offset.y]};
          if (job.kind === 'facade' && job.appearance === 'architecture' && (name === 'normalMap' || name === 'rmMap')) params[name].surfaceKey = 'architecture-facade-v1';
          const image=t.image as unknown as OffscreenCanvas;
          bitmaps[name]=image.transferToImageBitmap(); image.width=image.height=1; t.dispose();
        }
        await writePaint(m.key,params,bitmaps,() => cacheAllowed);
      } catch { Object.values(bitmaps).forEach(b=>b.close()); }
    }).catch(() => {});
    return;
  }
  if (m.op === "get") {
    let bitmaps: Record<string, ImageBitmap> | null = null, params: unknown = null;
    try {
      const hit = await readPaint(m.key);
      if (hit) {
        const names = Object.keys(hit.blobs);
        const original = hit.params as Record<string, { flipY: boolean }>;
        const results = await Promise.allSettled(names.map(n => createImageBitmap(hit.blobs[n], { ...RAW, imageOrientation: original[n].flipY ? 'flipY' : 'none' })));
        const list = results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
        if (list.length !== names.length) { list.forEach(b => b.close()); throw Error('partial cached maps'); }
        bitmaps = Object.fromEntries(names.map((n, i) => [n, list[i]]));
        params = Object.fromEntries(names.map(n => [n, {...original[n],flipY:false}]));
      }
    } catch { bitmaps = null; }
    (self as unknown as Worker).postMessage({ id: m.id, bitmaps, params }, bitmaps ? Object.values(bitmaps) : []);
    return;
  }
  await writePaint(m.key, m.params, m.bitmaps);
};
