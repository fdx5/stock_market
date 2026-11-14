/* Whether the page can be seen at all: not when the tab is hidden, nor while a full-screen 3D
 * view covers it (components/pageCover.ts). Decorative animations behind the 3D view were still
 * drawing every frame — a WebGL background was ~5% of a slowed phone's main thread in flight. */
export const PAGE_COVER_EVENT = "re-page-cover";
export const pageUnseen = () => { const c = document.documentElement.classList; return document.hidden || c.contains("re-page-covered") || c.contains("re-backdrop-paused"); };
let paused = 0;
/** A page that fills the window with its own view (드론 탐험) while the site's backdrop stays
 * mounted behind it: the backdrop stops drawing until the returned function is called. */
export function pauseBackdrops(): () => void {
  if (paused++ === 0) { document.documentElement.classList.add("re-backdrop-paused"); document.dispatchEvent(new Event(PAGE_COVER_EVENT)); }
  let done = false;
  return () => {
    if (done) return; done = true;
    if (--paused === 0) { document.documentElement.classList.remove("re-backdrop-paused"); document.dispatchEvent(new Event(PAGE_COVER_EVENT)); }
  };
}
/** Call `sync` when the page is hidden, shown, covered or uncovered; returns the remover. */
export function onPageSeenChange(sync: () => void): () => void {
  document.addEventListener("visibilitychange", sync);
  document.addEventListener(PAGE_COVER_EVENT, sync);
  return () => { document.removeEventListener("visibilitychange", sync); document.removeEventListener(PAGE_COVER_EVENT, sync); };
}
