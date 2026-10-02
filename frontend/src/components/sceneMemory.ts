/** Shared workers live only while a 3D view owns them. Multiple rail/modal views
 * share the lease; closing the last view releases workers and unclaimed images. */
const releases = new Set<() => void>();
let views = 0;
export function onSceneMemoryRelease(release: () => void) { releases.add(release); }
export function retainSceneMemory(): () => void {
  views++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--views === 0) for (const release of releases) release();
  };
}
