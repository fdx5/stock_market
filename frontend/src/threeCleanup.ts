import type * as THREE from "three";

/** OrbitControls.dispose() takes its keydown listener off `domElement.getRootNode()`.
 * React removes a component's DOM before running its cleanup, so by then the canvas is
 * detached, its root node is not the document, and the listener stays on the document,
 * holding the controls and with them the whole unmounted 3D view (renderers, scenes,
 * geometry: tens of MB per view opened and closed). Take it off the document too. */
export function disposeControls(controls: { dispose(): void }) {
  const listener = (controls as unknown as { _interceptControlDown?: EventListener })._interceptControlDown;
  if (listener) document.removeEventListener("keydown", listener, { capture: true });
  controls.dispose();
}

/** Free a WebGL renderer and give its context back now (browsers keep ~16 contexts and
 * drop the oldest beyond that; a disposed renderer's context otherwise lingers until GC). */
export function releaseRenderer(renderer: THREE.WebGLRenderer) {
  renderer.dispose();
  (renderer as Partial<THREE.WebGLRenderer>).forceContextLoss?.();
  renderer.domElement.remove();
}
