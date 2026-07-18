import { useEffect } from "react";

// While a modal is open, wheel/touch scroll events on the backdrop otherwise still
// scroll the page underneath it (the backdrop's own fixed positioning doesn't stop
// that), which reads as the background visibly shifting behind a supposedly modal
// dialog. Locking body scroll for the modal's lifetime — and restoring whatever
// value was there before, since nothing else in this app sets it — fixes that.
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}
