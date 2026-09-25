import { ReactNode, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

/** A hover card that follows the pointer without ever leaving the screen.
 *
 * It opens below-right of the pointer, the way the maps' tooltips always have, but it
 * is measured before it paints: past the right edge it opens to the left of the
 * pointer instead, past the bottom it opens above, and if neither side has room it is
 * pinned inside the viewport. A card on the right-hand side of a map used to open half
 * off the screen, which the user then had to read around.
 *
 * Positioned by writing left/top straight onto the element in a layout effect, so a
 * pointer move re-places it without a second React render. */
const GAP = 16;
const EDGE = 10;

export default function FloatingTip({
  x,
  y,
  className,
  portalClassName,
  children,
}: {
  x: number;
  y: number;
  className?: string;
  /** Renders the card on <body> inside a display: contents wrapper with these
   * classes, so a page box that contains fixed descendants cannot move it. */
  portalClassName?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;

    let left = x + GAP;
    if (left + w > vw - EDGE) left = x - GAP - w;
    left = Math.max(EDGE, Math.min(left, vw - w - EDGE));

    let top = y + GAP;
    if (top + h > vh - EDGE) top = y - GAP - h;
    top = Math.max(EDGE, Math.min(top, vh - h - EDGE));

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = "visible";
  });

  // Hidden until placed, so the first frame never shows it at the unmeasured spot.
  const card = (
    <div ref={ref} className={className} style={{ left: x + GAP, top: y + GAP, visibility: "hidden" }}>
      {children}
    </div>
  );
  return portalClassName ? createPortal(<div className={portalClassName}>{card}</div>, document.body) : card;
}
