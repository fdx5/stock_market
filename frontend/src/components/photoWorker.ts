import "./workerCpuRaster";
import * as THREE from "three";
import { coloursFrom, rhythmFrom, wallPaintFrom } from "./photoAnalysis";

/* A VWorld photograph decoded and read off the main thread (vworld3d photoAnalysis). */
self.onmessage = async (e: MessageEvent) => {
  const { id, img, pos, uv, index } = e.data as { id: number; img: ArrayBuffer; pos: Float32Array; uv: Float32Array; index: Uint16Array | Uint32Array };
  try {
    const S = 512;
    const bmp = await createImageBitmap(new Blob([img], { type: "image/jpeg" }), { resizeWidth: S, resizeHeight: S, resizeQuality: "medium" });
    const cv = new OffscreenCanvas(S, S), cx = cv.getContext("2d", { willReadFrequently: true })!;
    cx.drawImage(bmp, 0, 0); bmp.close();
    const px = cx.getImageData(0, 0, S, S).data;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    const rhythm = rhythmFrom(px, S, g), colours = coloursFrom(px, S, g), paint = wallPaintFrom(px, S, g);
    (self as unknown as Worker).postMessage({ id, rhythm: { ...rhythm, planes: [...rhythm.planes] }, colours, paint });
  } catch {
    (self as unknown as Worker).postMessage({ id, rhythm: null, colours: null });
  }
};
