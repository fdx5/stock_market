import { CSSProperties, MouseEvent, ReactNode, useEffect, useState } from "react";
import { readingUrl, resolvedBrowsingUrl, saveReadingPosition } from "./browsingMemory";
import { stopScrollRestoration } from "./scrollNavigation";

const makeEntry = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
let activeUrl = readingUrl();
let activeEntry = window.history.state?.kstockEntry ?? makeEntry();
window.history.replaceState({ ...window.history.state, kstockEntry: activeEntry }, "");
window.history.scrollRestoration = "manual";
let returning = true;
let pushing = false;
// The pulse board is excluded from AdSense auto ads (no bottom anchor there). Auto ads
// are set up per page load, so crossing into or out of it loads the page afresh: an
// anchor from another page cannot follow the visitor in, and pages after it get theirs.
const ADLESS = "/pulse-board";
let shownPath = window.location.pathname === "/pulse-board-2" ? ADLESS : window.location.pathname;
const crossesAdless = (to: string) => to !== shownPath && (to === ADLESS || shownPath === ADLESS);
window.addEventListener("popstate", () => {
  if (pushing) return;
  if (crossesAdless(window.location.pathname)) { window.location.reload(); return; }
  shownPath = window.location.pathname;
  stopScrollRestoration();
  saveReadingPosition(activeUrl, activeEntry);
  activeUrl = readingUrl();
  activeEntry = window.history.state?.kstockEntry ?? makeEntry();
  window.history.replaceState({ ...window.history.state, kstockEntry: activeEntry }, "");
  returning = true;
});
window.addEventListener("pagehide", () => saveReadingPosition(readingUrl(), activeEntry));

export function navigationSnapshot() { return { url: activeUrl, entry: activeEntry, returning }; }

export function navigate(path: string): void {
  const target = new URL(path, window.location.href).pathname;
  if (crossesAdless(target)) { window.location.assign(path); return; }
  shownPath = target;
  stopScrollRestoration();
  // Cancel an in-flight smooth scroll before saving the outgoing entry.
  window.scrollTo({ top: window.scrollY, left: window.scrollX, behavior: "instant" as ScrollBehavior });
  activeUrl = readingUrl();
  saveReadingPosition(activeUrl, activeEntry);
  path = resolvedBrowsingUrl(path);
  const entry = makeEntry();
  window.history.pushState({ kstockEntry: entry }, "", path);
  // Update before the synthetic pop event so it cannot save the old scroll for
  // the newly created entry. Other route consumers still receive popstate.
  activeUrl = readingUrl();
  activeEntry = entry;
  returning = false;
  pushing = true;
  window.dispatchEvent(new PopStateEvent("popstate"));
  pushing = false;
}

export function useRoute(): string {
  const [route, setRoute] = useState(() => ({ path: window.location.pathname }));

  useEffect(() => {
    const onPopState = () => setRoute({ path: window.location.pathname });
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return route.path;
}

export function Link({
  to,
  className,
  children,
  style,
  "aria-label": ariaLabel,
  "aria-current": ariaCurrent,
  title,
  onClick,
}: {
  to: string;
  className?: string;
  children: ReactNode;
  /** For the handful of callers whose link color is computed from data rather than
   * fixed in the stylesheet — an index tile tinted by whether it is up or down. */
  style?: CSSProperties;
  "aria-label"?: string;
  "aria-current"?: "page";
  title?: string;
  /** Runs before navigation (analytics); it cannot cancel the navigation. */
  onClick?: () => void;
}) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.();
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };

  return (
    <a href={to} className={className} style={style} aria-label={ariaLabel} aria-current={ariaCurrent} title={title} onClick={handleClick}>
      {children}
    </a>
  );
}
