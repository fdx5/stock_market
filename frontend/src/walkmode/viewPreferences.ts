/** Session-only comfort controls, shared by walking and drone views. No account/browsing data. */
export interface ViewPreferences { fov: number; sensitivity: number; distance: number; reduceMotion: boolean; invertY: boolean }
export const DEFAULT_VIEW: Readonly<ViewPreferences> = { fov: 70, sensitivity: 1, distance: 1, reduceMotion: true, invertY: false };
let current: ViewPreferences = { ...DEFAULT_VIEW };
const listeners = new Set<() => void>();
let menuOpen = false;
export const cameraControlsPaused = () => menuOpen;
export const setCameraControlsPaused = (on: boolean) => { menuOpen = on; };
export const viewPreferences = () => current;
export const subscribeView = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setViewPreferences(next: Partial<ViewPreferences>) {
  const clamp = (v: number | undefined, old: number, lo: number, hi: number) => v === undefined || !Number.isFinite(v) ? old : Math.min(hi, Math.max(lo, v));
  current = { fov: clamp(next.fov, current.fov, 60, 90), sensitivity: clamp(next.sensitivity, current.sensitivity, .4, 1.8), distance: clamp(next.distance, current.distance, .7, 1.4), reduceMotion: next.reduceMotion ?? current.reduceMotion, invertY: next.invertY ?? current.invertY };
  for (const listener of listeners) listener();
}
/** A portrait phone keeps more peripheral vision without changing any rendering resolution. */
export function comfortableFov(base: number, aspect: number) {
  const a = Math.max(.2, Number.isFinite(aspect) ? aspect : 1);
  const portrait = Math.max(1, 1 / Math.max(.65, a));
  return Math.min(110, 2 * Math.atan(Math.tan(base * Math.PI / 360) * portrait) * 180 / Math.PI);
}
export function applyViewFov(camera: { fov: number; aspect: number; updateProjectionMatrix(): void }, base = current.fov) {
  const fov = comfortableFov(base, camera.aspect);
  if (Math.abs(camera.fov - fov) > .01) { camera.fov = fov; camera.updateProjectionMatrix(); }
}
