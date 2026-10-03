import * as THREE from 'three';

/** Original 512px roughness map, without replaying 2,606 canvas drawing commands. */
export async function preparedSteel(): Promise<THREE.Texture | null> {
  if (typeof createImageBitmap !== 'function') return null;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 1500);
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}3d/steel/ba619de86101d2b516d1.png`, { signal: controller.signal });
    if (!r.ok) return null;
    const bitmap = await createImageBitmap(await r.blob(), { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const t = new THREE.Texture(bitmap);
    t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(0.6, 1.6); t.anisotropy = 8; t.needsUpdate = true;
    t.userData.immutableKey = 'steel/ba619de86101d2b516d1';
    t.addEventListener('dispose', () => bitmap.close());
    return t;
  } catch { return null; } finally { clearTimeout(timer); }
}
