/* Desktop scrolling for the header link rows (.app-nav-row and the masthead index).

   The row holds 15+ pills and, on several pages, is kept on one line with its
   scrollbar hidden (touch users swipe it). With a mouse there is nothing to grab, so
   the trailing pills were simply unreachable. One delegated installer covers every
   page that renders the row, including ones that mount it later (route changes) and
   the portalled VOLTARIS pill:

   - vertical wheel over the row scrolls it sideways (only while it still can, so the
     page scrolls normally once the row hits either end);
   - click-and-drag with the mouse pans the row, and swallows the click that ends a
     drag so a pan never opens a link;
   - `data-nav-overflow` / `data-nav-more-start` / `data-nav-more-end` mirror the
     scroll state so the CSS can show a thin scrollbar and edge fades only when there
     is something to scroll to. */

// .app-nav-row: the classic header's link pills; .d2-mast-nav > ul: the market desk
// masthead's site index (its own has-before/has-after fades are set by Masthead.tsx).
const ROW = ".app-nav-row, .d2-mast-nav > ul";
const DRAG_THRESHOLD = 5;

function canScroll(row: HTMLElement): boolean {
  return row.scrollWidth - row.clientWidth > 1;
}

function syncRow(row: HTMLElement) {
  const max = row.scrollWidth - row.clientWidth;
  const overflow = max > 1;
  const set = (name: string, on: boolean) => {
    const value = on ? "true" : "false";
    if (row.getAttribute(name) !== value) row.setAttribute(name, value);
  };
  set("data-nav-overflow", overflow);
  set("data-nav-more-start", overflow && row.scrollLeft > 1);
  set("data-nav-more-end", overflow && row.scrollLeft < max - 1);
}

function syncAll() {
  document.querySelectorAll<HTMLElement>(ROW).forEach(syncRow);
}

export function installNavRowScroll() {
  if (typeof window === "undefined") return;
  const w = window as typeof window & { __navRowScrollInstalled?: boolean };
  if (w.__navRowScrollInstalled) return;
  w.__navRowScrollInstalled = true;

  document.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey || event.defaultPrevented) return;
      const row = (event.target as Element | null)?.closest?.<HTMLElement>(ROW);
      if (!row || !canScroll(row)) return;
      // A trackpad's own sideways swipe already scrolls the row natively.
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const max = row.scrollWidth - row.clientWidth;
      const next = row.scrollLeft + event.deltaY;
      if ((event.deltaY < 0 && row.scrollLeft <= 0) || (event.deltaY > 0 && row.scrollLeft >= max)) return;
      event.preventDefault();
      row.scrollLeft = Math.max(0, Math.min(max, next));
    },
    { passive: false }
  );

  let drag: { row: HTMLElement; startX: number; startLeft: number; active: boolean } | null = null;
  let suppressClick = false;

  document.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    const row = (event.target as Element | null)?.closest?.<HTMLElement>(ROW);
    if (!row || !canScroll(row)) return;
    drag = { row, startX: event.clientX, startLeft: row.scrollLeft, active: false };
  });

  document.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    if (!drag.active) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      drag.active = true;
      drag.row.setAttribute("data-nav-dragging", "true");
    }
    drag.row.scrollLeft = drag.startLeft - dx;
  });

  const endDrag = () => {
    if (!drag) return;
    if (drag.active) {
      suppressClick = true;
      // The click that closes a drag fires right after pointerup; clear the flag on
      // the next task so a later, genuine click is never eaten.
      window.setTimeout(() => {
        suppressClick = false;
      }, 0);
    }
    drag.row.removeAttribute("data-nav-dragging");
    drag = null;
  };
  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);

  document.addEventListener(
    "click",
    (event) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true
  );

  // Links inside the row would otherwise start a native link-drag ghost mid-pan.
  document.addEventListener("dragstart", (event) => {
    if ((event.target as Element | null)?.closest?.(ROW)) event.preventDefault();
  });

  // scroll events do not bubble, but they do capture.
  document.addEventListener(
    "scroll",
    (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.matches(ROW)) syncRow(target);
    },
    true
  );

  window.addEventListener("resize", syncAll);

  // Rows come and go with route changes and fonts/translations change their width.
  // Debounced so busy pages (tickers, WebGL overlays) do not pay for a layout read on
  // every DOM mutation.
  let timer = 0;
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(syncAll, 120);
  };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener("load", schedule);
  document.fonts?.ready.then(schedule).catch(() => {});
  schedule();
}
