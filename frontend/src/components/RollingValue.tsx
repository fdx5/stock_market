import { useEffect, useRef, useState } from "react";

function useFlash(value: number): string {
  const prevRef = useRef(value);
  const [flashClass, setFlashClass] = useState("");

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    if (prev === value) return;

    setFlashClass(value > prev ? "flash-up" : "flash-down");
    const timer = window.setTimeout(() => setFlashClass(""), 800);
    return () => window.clearTimeout(timer);
  }, [value]);

  return flashClass;
}

// Flashes red/blue (KR up/down convention) on the whole value, and replays a
// slide-in "odometer" animation on just the individual characters that changed —
// so "1561.2조" -> "1561.3조" only rolls the "2"->"3" digit, not the whole string.
export default function RollingValue({
  value,
  text,
  className,
}: {
  value: number;
  text: string;
  className?: string;
}) {
  const flashClass = useFlash(value);
  const chars = text.split("");

  const prevCharsRef = useRef<string[]>(chars);
  const genRef = useRef<number[]>(chars.map(() => 0));

  if (prevCharsRef.current.join("") !== text) {
    const prevChars = prevCharsRef.current;
    const sameLength = prevChars.length === chars.length;
    genRef.current = chars.map((ch, i) => {
      const changed = !sameLength || ch !== prevChars[i];
      const prevGen = genRef.current[i] ?? 0;
      return changed ? prevGen + 1 : prevGen;
    });
    prevCharsRef.current = chars;
  }

  return (
    <span className={`rolling-value ${flashClass} ${className ?? ""}`}>
      {chars.map((ch, i) => (
        <span key={`${i}-${genRef.current[i] ?? 0}`} className="rolling-digit">
          {ch === " " ? " " : ch}
        </span>
      ))}
    </span>
  );
}
