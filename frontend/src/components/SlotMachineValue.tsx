import { useEffect, useRef, useState } from "react";

const SPIN_TICK_MS = 45;
const SPIN_BASE_MS = 450;
const SPIN_STAGGER_MS = 70;

function randomDigit(): string {
  return String(Math.floor(Math.random() * 10));
}

function randomizedChars(text: string): string[] {
  return text.split("").map((ch) => (/[0-9]/.test(ch) ? randomDigit() : ch));
}

function digitFlags(text: string): boolean[] {
  return text.split("").map((ch) => /[0-9]/.test(ch));
}

// Unlike RollingValue (which only rolls the characters that actually differ), this
// spins every digit through a rapid random sequence before landing on the real value —
// a slot-machine reel effect for the two headline market-cap totals. It always plays
// once on mount (there's no prior value yet to compare against), then only replays
// when `value` actually changes.
export default function SlotMachineValue({
  value,
  text,
  className,
}: {
  value: number;
  text: string;
  className?: string;
}) {
  const [display, setDisplay] = useState<string[]>(() => randomizedChars(text));
  const [spinFlags, setSpinFlags] = useState<boolean[]>(() => digitFlags(text));
  const prevValueRef = useRef<number | null>(null);

  useEffect(() => {
    const changed = prevValueRef.current === null || prevValueRef.current !== value;
    prevValueRef.current = value;
    if (!changed) return;

    const finalChars = text.split("");
    const intervalIds: number[] = [];
    const timeoutIds: number[] = [];

    setSpinFlags(finalChars.map((ch) => /[0-9]/.test(ch)));

    finalChars.forEach((ch, i) => {
      if (!/[0-9]/.test(ch)) {
        setDisplay((prev) => {
          const next = [...prev];
          next[i] = ch;
          return next;
        });
        return;
      }

      const intervalId = window.setInterval(() => {
        setDisplay((prev) => {
          const next = [...prev];
          next[i] = randomDigit();
          return next;
        });
      }, SPIN_TICK_MS);
      intervalIds.push(intervalId);

      const stopAt = SPIN_BASE_MS + i * SPIN_STAGGER_MS;
      const timeoutId = window.setTimeout(() => {
        window.clearInterval(intervalId);
        setDisplay((prev) => {
          const next = [...prev];
          next[i] = ch;
          return next;
        });
        setSpinFlags((prev) => {
          const next = [...prev];
          next[i] = false;
          return next;
        });
      }, stopAt);
      timeoutIds.push(timeoutId);
    });

    return () => {
      intervalIds.forEach((id) => window.clearInterval(id));
      timeoutIds.forEach((id) => window.clearTimeout(id));
    };
  }, [value, text]);

  return (
    <span className={`slot-machine-value ${className ?? ""}`}>
      {display.map((ch, i) => (
        <span key={i} className={`slot-machine-digit ${spinFlags[i] ? "spin-active" : ""}`}>
          {ch === " " ? " " : ch}
        </span>
      ))}
    </span>
  );
}
