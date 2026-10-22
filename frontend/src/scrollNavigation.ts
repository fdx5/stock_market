let cancelRestoration: (() => void) | undefined;

export function stopScrollRestoration(): void {
  cancelRestoration?.();
  cancelRestoration = undefined;
}

export function ownScrollRestoration(cancel: () => void): () => void {
  stopScrollRestoration();
  cancelRestoration = cancel;
  return () => { if (cancelRestoration === cancel) cancelRestoration = undefined; };
}

/** Measure the pinned stack, including bars which have not reached their sticky top yet. */
export function pinnedScrollOffset(gap = 12): number {
  let bottom = 0;
  const bars = document.querySelectorAll<HTMLElement>(".ng-header, .ng-top-rail, .app-header, .desk-command, [data-d2-sticky], .re-map-crumbs");
  for (const bar of bars) {
    const style = window.getComputedStyle(bar);
    const rect = bar.getBoundingClientRect();
    if (!["sticky", "fixed"].includes(style.position) || rect.height === 0) continue;
    const top = Number.parseFloat(style.top);
    if (Number.isFinite(top)) bottom = Math.max(bottom, top + rect.height);
  }
  return bottom + gap;
}

/** Keep pagination inside its scroll pane; move the window only when needed. */
export function scrollContentStart(element: HTMLElement): void {
  stopScrollRestoration();
  const behavior: ScrollBehavior = "instant" as ScrollBehavior;
  let parent = element.parentElement;
  while (parent && parent !== document.body && parent !== document.documentElement) {
    const style = window.getComputedStyle(parent);
    if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight) {
      parent.scrollTo({ top: Math.max(0, parent.scrollTop + element.getBoundingClientRect().top - parent.getBoundingClientRect().top), behavior });
      return;
    }
    parent = parent.parentElement;
  }
  window.scrollTo({ top: Math.max(0, window.scrollY + element.getBoundingClientRect().top - pinnedScrollOffset()), behavior });
}
