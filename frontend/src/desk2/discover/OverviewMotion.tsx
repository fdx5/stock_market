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

/** Only a changed displayed value starts a turn; chart beats never replay it. */
export function RollingNumber({ text, active }: { text: string; active: boolean }) {
  const [motion, setMotion] = useState({ text, revision: 0, rolling: false });
  if (motion.text !== text) {
    setMotion({ text, revision: motion.revision + 1,
      rolling: active && /\d/.test(motion.text) && /\d/.test(text) });
  } else if (!active && motion.rolling) {
    // A hidden/reduced-motion change is settled, never queued for a later replay.
    setMotion({ ...motion, rolling: false });
  }
  useEffect(() => {
    if (!motion.rolling) return;
    // CSS lasts 960ms with up to 144ms digit staggering.
    const revision = motion.revision;
    const timer = window.setTimeout(() => setMotion(current => current.revision === revision
      ? { ...current, rolling: false } : current), 1200);
    return () => window.clearTimeout(timer);
  }, [motion.revision, motion.rolling]);

  return <span className="ed-rolling-number" data-value={text}>
    <span className="ed-number-label">{text}</span>
    <span className="ed-reel-visual" aria-hidden="true">{Array.from(text).map((char, index) => {
      if (!/\d/.test(char)) return <span className="ed-reel-punctuation" key={index}>{char}</span>;
      const digit = Number(char);
      const reel = Array.from({ length: 11 }, (_, offset) => (digit + offset) % 10);
      return <span className="ed-reel-digit" key={index}><span key={`${motion.revision}:${char}`} className={`ed-reel-strip${active && motion.rolling ? " is-rolling" : ""}`}
        style={{ "--reel-delay": `${index % 7 * 24}ms` } as CSSProperties}>{reel.map((value, row) => <span className="ed-reel-cell" key={row}>{value}</span>)}</span></span>;
    })}</span>
  </span>;
}
