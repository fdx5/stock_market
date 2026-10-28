/// <reference lib="webworker" />
import { analyse, tilesFor, type AerialAsk, type AerialResult } from "./aerial";

/* The aerial reading off the page: the tiles fetched and pieced together on an OffscreenCanvas,
 * read, and only the result sent back (the photo never reaches the page). */

self.onmessage = async (e: MessageEvent<AerialAsk>) => {
  const t0 = performance.now(), a = e.data;
  const { urls, w, h, ox, oy } = tilesFor(a);
  const canvas = new OffscreenCanvas(w, h), g = canvas.getContext("2d", { willReadFrequently: true })!;
  let failed = 0, next = 0;
  // (eight at a time)
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < urls.length) {
      const u = urls[next++];
      try {
        const r = await fetch(u.url);
        if (!r.ok) throw new Error(String(r.status));
        const bmp = await createImageBitmap(await r.blob());
        g.drawImage(bmp, u.x * 256, u.y * 256); bmp.close();
      } catch { failed++; }
    }
  }));
  const px = g.getImageData(0, 0, w, h).data;
  const res = analyse(a, px, w, h, ox, oy);
  const out: AerialResult = { ...res, ms: Math.round(performance.now() - t0), tiles: urls.length, failed };
  (self as unknown as Worker).postMessage(out, [out.cls.buffer, out.rgb.buffer, out.trees.buffer, out.cars.buffer]);
};
