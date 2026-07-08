import { useEffect, useRef, useState } from "react";

// Flashes red/blue (KR up/down convention) and replays a slide-in animation whenever
// `value` changes, so every polled indicator visibly "ticks" instead of silently
// swapping its text.
export default function RollingValue({
  value,
  text,
  className,
}: {
  value: number;
  text: string;
  className?: string;
}) {
  const prevValueRef = useRef(value);
  const [flashClass, setFlashClass] = useState("");
  const [animKey, setAnimKey] = useState(0);

  useEffect(() => {
    const prev = prevValueRef.current;
    prevValueRef.current = value;
    if (prev === value) return;

    setFlashClass(value > prev ? "flash-up" : "flash-down");
    setAnimKey((k) => k + 1);
    const timer = window.setTimeout(() => setFlashClass(""), 800);
    return () => window.clearTimeout(timer);
  }, [value]);

  return (
    <span className={`rolling-value ${flashClass} ${className ?? ""}`}>
      <span key={animKey} className="rolling-value-inner">
        {text}
      </span>
    </span>
  );
}
