/// <reference lib="webworker" />
import { normalRows } from "./normalKernel";

/* Normal maps off the main thread: reading back the facade and ground height images of a
 * complex and the pixel loop over them add up to several hundred ms, which would otherwise
 * stall its loading. Height bitmap in, normal-map bitmap out (null on failure). */
self.onmessage = (e: MessageEvent<{ id: number; src: ImageBitmap; strength: number }>) => {
  const { id, src, strength } = e.data;
  let bitmap: ImageBitmap | null = null;
  try {
    const W = src.width, H = src.height;
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(src, 0, 0);
    const pixels = g.getImageData(0, 0, W, H).data;
    const img = new ImageData(W, H);
    normalRows(pixels, img.data, W, H, strength, 0, H);
    g.putImageData(img, 0, 0);
    bitmap = c.transferToImageBitmap();
  } catch { bitmap = null; }
  src.close();
  (self as unknown as Worker).postMessage({ id, bitmap }, bitmap ? [bitmap] : []);
};
