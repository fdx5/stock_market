import * as THREE from "three";
import { cdn, fetchStatic } from "../staticCdn";

/* A picture of the 3D view (the trees' twigs and leaves, bark, the plant atlas, the vehicles'
 * swatches, the moon) as a texture decoded off the page's thread: a Blob made into an
 * ImageBitmap decodes in the background, and goes to the GPU in ~1–5 ms. Loaded as an <img>,
 * the same 2048 × 1536 picture held the page ~35 ms in the frame it was uploaded (~150 ms on a
 * slow CPU), the view stalling while a complex loaded. The flip is made in the decode (a bitmap
 * is not flipped on its way to the GPU in WebGL), so the texture's own flipY is false. */
export async function bitmapTexture(path: string, flipY: boolean): Promise<THREE.Texture> {
  if (typeof createImageBitmap === "function") {
    try {
      const r = await fetchStatic(path);
      if (!r.ok) throw new Error(`${path} ${r.status}`);
      const bitmap = await createImageBitmap(await r.blob(), flipY ? { imageOrientation: "flipY", premultiplyAlpha: "none" } : { premultiplyAlpha: "none" });
      const t = new THREE.Texture(bitmap as unknown as HTMLImageElement);
      t.flipY = false;
      t.needsUpdate = true;
      return t;
    } catch { /* (the picture as an <img> below) */ }
  }
  const t = await new THREE.TextureLoader().loadAsync(cdn(path));
  t.flipY = flipY;
  return t;
}
