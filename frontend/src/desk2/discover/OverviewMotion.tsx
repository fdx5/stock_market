import { useEffect, useRef, useState, type CSSProperties } from "react";

export const OVERVIEW_MOTION_MS = 5_000;

/** One visual clock for the summary. It never manufactures or fetches prices. */
export function useOverviewMotion() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const rect = element.getBoundingClientRect();
    let visible = rect.bottom > 0 && rect.top < window.innerHeight;
    const update = () => setActive(visible && !preference.matches && document.visibilityState === "visible");
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); });
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    preference.addEventListener("change", update);
    update();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      preference.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setCycle(value => value + 1), OVERVIEW_MOTION_MS);
    return () => window.clearInterval(timer);
  }, [active]);
  return { ref, active, cycle };
}

/** Accessible text stays exact; decorative reels make one turn back to each digit. */
export function RollingNumber({ text, cycle, active }: { text: string; cycle: number; active: boolean }) {
  return <span className="ed-rolling-number" data-value={text}>
    <span className="ed-number-label">{text}</span>
    <span className="ed-reel-visual" aria-hidden="true">{Array.from(text).map((char, index) => {
      if (!/\d/.test(char)) return <span className="ed-reel-punctuation" key={index}>{char}</span>;
      const digit = Number(char);
      const reel = Array.from({ length: 11 }, (_, offset) => (digit + offset) % 10).join("\n");
      return <span className="ed-reel-digit" key={index}><span key={`${cycle}:${char}`} className={`ed-reel-strip${active && cycle > 0 ? " is-rolling" : ""}`}
        style={{ "--reel-delay": `${index % 7 * 24}ms` } as CSSProperties}>{reel}</span></span>;
    })}</span>
  </span>;
}
