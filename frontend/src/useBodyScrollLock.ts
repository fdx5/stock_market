import { useEffect } from "react";

// While a modal is open, wheel/touch scroll events on the backdrop otherwise still
// scroll the page underneath it (the backdrop's own fixed positioning doesn't stop
// that), which reads as the background visibly shifting behind a supposedly modal
// dialog. Locking body scroll for the modal's lifetime fixes that.
//
// Modals can overlap (the 부동산 card opens the comparison before it has closed),
// so the locks are counted: the first one saves and hides, the last one restores.
// Saving per modal instead let an inner modal "restore" the outer one's hidden
// value after both closed, leaving the page unable to scroll.
let holders = 0;
let saved = "";

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (holders++ === 0) {
      saved = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    return () => {
      if (--holders === 0) document.body.style.overflow = saved;
    };
  }, [active]);
}
