import * as THREE from "three";
import { paintAsphalt, paintPaver, paintTactile, type PaverStyle } from "./texPaint";
import type { TexJob } from "./texWorker";
import {onSceneMemoryRelease} from './sceneMemory';

/** A tiling ground texture (texPaint), painted in a worker where the browser has OffscreenCanvas
 * (else on the page, as before). Repeat-wrapped, sRGB, anisotropic. */
let worker: Worker | null | undefined;
let nextId = 1;
const waiting = new Map<number, (b: ImageBitmap | null) => void>();
onSceneMemoryRelease(()=>{
  worker?.terminate();worker=undefined;
  waiting.forEach(done=>done(null));waiting.clear();
});

function getWorker() {
  if (worker !== undefined) return worker;
  try {
    if (typeof OffscreenCanvas === "undefined") throw new Error("no OffscreenCanvas");
    worker = new Worker(new URL("./texWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; bitmap: ImageBitmap }>) => { const done=waiting.get(e.data.id);if(done)done(e.data.bitmap);else e.data.bitmap?.close();waiting.delete(e.data.id); };
    worker.onerror = () => { worker?.terminate();for (const f of waiting.values()) f(null); waiting.clear(); worker = null; };
  } catch { worker = null; }
  return worker;
}

export async function paintedTexture(kind: TexJob["kind"], size: number, style?: PaverStyle): Promise<THREE.Texture> {
  const w = getWorker();
  let t: THREE.Texture | null = null;
  if (w) {
    const id = nextId++;
    const bitmap = await new Promise<ImageBitmap | null>(res => { waiting.set(id, res); w.postMessage({ id, kind, size, style } satisfies TexJob); });
    if (bitmap) { t = new THREE.Texture(bitmap as unknown as HTMLImageElement); t.flipY = false; }
  }
  if (!t) {
    const c = document.createElement("canvas"); c.width = c.height = size;
    const g = c.getContext("2d")!;
    if (kind === "asphalt") paintAsphalt(g, size); else if (kind === "paver") paintPaver(g, size, style ?? "stretcher"); else paintTactile(g, size);
    t = new THREE.CanvasTexture(c);
  }
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}
