import { CSSProperties, MouseEvent, ReactNode, useEffect, useState } from "react";
import { readingUrl, resolvedBrowsingUrl, saveReadingPosition } from "./browsingMemory";

const makeEntry = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
let activeUrl = readingUrl();
let activeEntry = window.history.state?.kstockEntry ?? makeEntry();
window.history.replaceState({ ...window.history.state, kstockEntry: activeEntry }, "");
window.history.scrollRestoration = "manual";
let returning = true;
let pushing = false;
window.addEventListener("popstate", () => {
  if (pushing) return;
  saveReadingPosition(activeUrl, activeEntry);
  activeUrl = readingUrl();
  activeEntry = window.history.state?.kstockEntry ?? makeEntry();
  window.history.replaceState({ ...window.history.state, kstockEntry: activeEntry }, "");
  returning = true;
});
window.addEventListener("pagehide", () => saveReadingPosition(readingUrl(), activeEntry));

export function navigationSnapshot() { return { url: activeUrl, entry: activeEntry, returning }; }

export function navigate(path: string): void {
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
}) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
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
