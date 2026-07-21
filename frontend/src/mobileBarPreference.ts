import { useEffect, useState } from "react";

const DISMISS_KEY = "kstock_mobile_bar_dismissed";

// Same same-tab broadcast idiom as watchlist.ts, and for the same reason: the native
// `storage` event only fires in *other* tabs, so it cannot sync the two components
// that read this one (the bar itself, and the dashboard shell that reserves the strip
// of page the bar would otherwise cover).
const CHANGE_EVENT = "kstock:mobile-bar-change";

/** sessionStorage rather than localStorage, deliberately.
 *
 * Dismissing the bar means "not while I'm reading this", not "never again" — and the
 * bar carries the live price of the stock the visitor came for, which is not something
 * a single stray tap should be able to hide permanently. sessionStorage gives exactly
 * the asked-for lifetime: it survives reloads and in-app navigation within the tab
 * (the same per-tab lifetime session.ts hangs the visitor id off) and is gone on the
 * next visit, so a new session starts with the bar back.
 */
export function isMobileBarDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    // Private-mode denials — treating storage as empty just means the bar shows, which
    // is the safe direction to fail in.
    return false;
  }
}

export function dismissMobileBar(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // A failed write only costs the dismissal its persistence across reloads; the
    // event below still hides the bar for the current page view.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Live view of the flag, so the bar and the dashboard's bottom spacing react to a
 * dismissal in the same paint. */
export function useMobileBarDismissed(): boolean {
  const [dismissed, setDismissed] = useState(isMobileBarDismissed);

  useEffect(() => {
    const sync = () => setDismissed(isMobileBarDismissed());
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);

  return dismissed;
}
