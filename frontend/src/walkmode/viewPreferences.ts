/** Session-only comfort controls, shared by walking and drone views. No account/browsing data. */
export interface ViewPreferences { fov: number; sensitivity: number; distance: number; reduceMotion: boolean; invertY: boolean }
export const DEFAULT_VIEW: Readonly<ViewPreferences> = { fov: 70, sensitivity: 1, distance: 1, reduceMotion: true, invertY: false };
/** a wide room at a phone's arm length wants more than the desk's 60–90° and a short boom */
export const FOV_RANGE = [50, 100] as const, DISTANCE_RANGE = [.5, 2] as const;
let current: ViewPreferences = { ...DEFAULT_VIEW };
const listeners = new Set<() => void>();
let menuOpen = false;
export const cameraControlsPaused = () => menuOpen;
export const setCameraControlsPaused = (on: boolean) => { menuOpen = on; };
export const viewPreferences = () => current;
export const subscribeView = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setViewPreferences(next: Partial<ViewPreferences>) {
  const clamp = (v: number | undefined, old: number, lo: number, hi: number) => v === undefined || !Number.isFinite(v) ? old : Math.min(hi, Math.max(lo, v));
  current = { fov: clamp(next.fov, current.fov, FOV_RANGE[0], FOV_RANGE[1]), sensitivity: clamp(next.sensitivity, current.sensitivity, .4, 1.8), distance: clamp(next.distance, current.distance, DISTANCE_RANGE[0], DISTANCE_RANGE[1]), reduceMotion: next.reduceMotion ?? current.reduceMotion, invertY: next.invertY ?? current.invertY };
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
/** Pinch, wheel or the ± buttons: in third person the camera's boom, in first person the field of
 * view (a spread — scale > 1 — brings things closer: a shorter boom, a narrower view). */
export function zoomView(scale: number, third: boolean) {
  if (!Number.isFinite(scale) || scale <= 0) return;
  if (third) setViewPreferences({ distance: Math.round(current.distance / scale * 100) / 100 });
  else setViewPreferences({ fov: Math.round(current.fov / scale) });
}
