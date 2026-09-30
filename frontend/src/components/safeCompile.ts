import type * as THREE from "three";

/** WebGLRenderer.compileAsync without its failure mode: three's version polls each
 * material's program on a timer and throws there (never settling) when a material is
 * disposed while it compiles — a region map repainted mid-compile. This one skips
 * materials that have lost their program and always settles. */
export function safeCompileAsync(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera, target: THREE.Scene | null = null): Promise<void> {
  return new Promise(resolve => {
    let materials: Set<THREE.Material>;
    try { materials = renderer.compile(scene, camera, target) as unknown as Set<THREE.Material>; } catch { resolve(); return; }
    if (!renderer.extensions.has("KHR_parallel_shader_compile") || !materials?.size) { resolve(); return; }
    const started = performance.now();
    const check = () => {
      for (const m of materials) {
        const program = (renderer.properties.get(m) as { currentProgram?: { isReady(): boolean } }).currentProgram;
        if (!program || program.isReady()) materials.delete(m);
      }
      // (a stuck driver: give up after 20 s rather than hold the view back for ever)
      if (!materials.size || performance.now() - started > 20000) resolve();
      else setTimeout(check, 10);
    };
    setTimeout(check, 10);
  });
}
