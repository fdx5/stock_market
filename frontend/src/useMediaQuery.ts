import { useEffect, useState } from "react";

/** The phone breakpoint every responsive block in styles.css keys on. Imported rather
 * than retyped so a layout that branches in JS can never drift from the stylesheet. */
export const MOBILE_QUERY = "(max-width: 640px)";

/** Live match state for a media query.
 *
 * Used where a breakpoint has to change *structure*, not just styling — a component
 * that renders a different tree (or declines to mount, and to fetch) on a phone than
 * on a desktop. Anything that only needs different styling belongs in a CSS media
 * query instead; this exists for the cases CSS alone cannot express.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    // Re-read on subscribe as well: the initializer above ran on first render, and the
    // viewport can have crossed the breakpoint between then and this effect.
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);

  return matches;
}
