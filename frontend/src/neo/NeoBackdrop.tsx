import { lazy, Suspense, useEffect, useState } from "react";

// Only the selected renderer, shaders and styles belong on the initial load.
const NeoRiverBackground = lazy(() => import("./NeoRiverBackground"));
const NeoSilkFlow = lazy(() => import("./NeoSilkFlow"));

type Backdrop = "nanotube" | "silk";

/** Chosen once per page entry, so in-app navigation never swaps the backdrop. */
function pick(): Backdrop {
  try {
    const forced = new URLSearchParams(window.location.search).get("bg");
    if (forced === "nanotube" || forced === "silk") return forced;
  } catch { /* fall through to a random choice */ }
  return Math.random() < .5 ? "nanotube" : "silk";
}
const ENTRY_CHOICE: Backdrop = typeof window === "undefined" ? "nanotube" : pick();

export default function NeoBackdrop() {
  const [choice, setChoice] = useState<Backdrop>(ENTRY_CHOICE);
  useEffect(() => { document.documentElement.dataset.backdrop = choice; }, [choice]);
  // Devices without WebGL2 float targets keep the existing nanotube structures.
  return <Suspense fallback={null}>{choice === "silk" ? <NeoSilkFlow onUnavailable={() => setChoice("nanotube")} /> : <NeoRiverBackground />}</Suspense>;
}
