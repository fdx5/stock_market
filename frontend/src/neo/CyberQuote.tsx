import { useEffect, useRef, type ReactNode } from "react";
import { useFxLevel } from "./settings";

/** A real displayed-price change gets one pulse; initial/missing data never does. */
export default function CyberQuote({ value, children, as = "strong" }: {
  value?: number | null; children: ReactNode; as?: "strong" | "b";
}) {
  const ref = useRef<HTMLElement>(null);
  const previous = useRef({ value, text: children });
  const fx = useFxLevel();
  useEffect(() => {
    const before = previous.current;
    previous.current = { value, text: children };
    const node = ref.current;
    if (!node || !Number.isFinite(value) || !Number.isFinite(before.value)
      || !value || !before.value || value === before.value || children === before.text
      || fx === "minimal" || document.hidden || !node.getClientRects().length
      || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = node.getBoundingClientRect();
    if (box.bottom < 0 || box.top > innerHeight) return;
    const animation = node.animate([
      { backgroundColor: "#67e8f933", textShadow: "0 0 16px #67e8f9aa", offset: 0 },
      { backgroundColor: "#a78bfa12", textShadow: "0 0 8px #a78bfa55", offset: .35 },
      { backgroundColor: "transparent", textShadow: "none", offset: 1 },
    ], { duration: fx === "full" ? 1100 : 800, easing: "ease-out" });
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const stop = () => { if (document.hidden || media.matches) animation.cancel(); };
    document.addEventListener("visibilitychange", stop);
    media.addEventListener("change", stop);
    return () => {
      animation.cancel();
      document.removeEventListener("visibilitychange", stop);
      media.removeEventListener("change", stop);
    };
  }, [value, children, fx]);
  const Tag = as;
  return <Tag ref={ref} className="ng-cyber-value">{children}</Tag>;
}
