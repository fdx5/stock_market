import * as THREE from 'three';
/** Identical glow, painted off-thread; a closed view never retains a late bitmap. */
export function moonGlow() {
  const texture = new THREE.Texture(); texture.colorSpace = THREE.SRGBColorSpace;
  let worker: Worker | undefined, bitmap: ImageBitmap | undefined, dead = false;
  const fallback = () => {
    if (dead) return;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d')!, grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0,'rgba(255,250,235,0.32)'); grad.addColorStop(0.3,'rgba(225,232,255,0.1)'); grad.addColorStop(1,'rgba(200,215,255,0)');
    g.fillStyle = grad; g.fillRect(0,0,128,128); texture.image = c; texture.needsUpdate = true;
  };
  try {
    worker = new Worker(new URL('./moonGlowWorker.ts',import.meta.url),{type:'module'});
    worker.onmessage = e => {
      worker?.terminate(); worker = undefined;
      if (dead) { e.data.close(); return; }
      bitmap = e.data; texture.image = bitmap; texture.needsUpdate = true;
    };
    worker.onerror = () => { worker?.terminate(); worker = undefined; fallback(); };
    worker.postMessage(0);
  } catch { fallback(); }
  return { texture, dispose() { dead = true; worker?.terminate(); bitmap?.close(); texture.dispose(); } };
}
