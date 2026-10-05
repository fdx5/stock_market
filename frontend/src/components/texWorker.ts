/// <reference lib="webworker" />
import "./workerCpuRaster";
// Ground textures painted off the page's thread (texPaint): a 2048 px asphalt held the page
// ~60 ms painted on it. Each request answered with an ImageBitmap (transferred).
import { paintAsphalt, paintPaver, paintTactile, type PaverStyle } from "./texPaint";

export type TexJob = { id: number; kind: "asphalt" | "paver" | "tactile"; size: number; style?: PaverStyle };

self.onmessage = (e: MessageEvent<TexJob>) => {
  const { id, kind, size, style } = e.data;
  const c = new OffscreenCanvas(size, size), g = c.getContext("2d")!;
  if (kind === "asphalt") paintAsphalt(g, size);
  else if (kind === "paver") paintPaver(g, size, style ?? "stretcher");
  else paintTactile(g, size);
  const bitmap = c.transferToImageBitmap();
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, bitmap }, [bitmap]);
};
