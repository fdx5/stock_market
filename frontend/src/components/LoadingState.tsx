import { useEffect, useState } from "react";
import { useT } from "../i18n/LanguageContext";

/** How long a load may run before it is worth saying anything about it.
 *
 * Nearly every route chunk and first fetch settles well inside this, and a message that
 * flashes up for 200ms and vanishes reads as a glitch rather than as information — it
 * also shoves the page content down and straight back up. Past this point the wait is
 * long enough that silence is the more confusing choice, so the text appears. */
export const LOADING_MESSAGE_DELAY_MS = 2500;

/**
 * The shared "데이터를 불러오는 중..." block, held back until the load has actually
 * been slow.
 *
 * Mount it only while loading — `{loading && <LoadingState />}`, or as a Suspense
 * fallback — so its timer measures that one load and starts over for the next.
 */
export default function LoadingState({ text = "데이터를 불러오는 중..." }: { text?: string }) {
  const t = useT();
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setElapsed(true), LOADING_MESSAGE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!elapsed) return null;
  return <div className="loading-state">{t(text)}</div>;
}
