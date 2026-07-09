import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useLanguage } from "./LanguageContext";

// Shared across every component using this hook for the lifetime of the tab, so the
// same stock name / news headline / cheer comment is only ever translated once no
// matter how many lists or pages it shows up in.
const translationCache = new Map<string, string>();

/** Live-translates arbitrary (dynamic, not-in-the-static-dictionary) Korean text —
 * stock names, news headlines, cheer comments — via the backend's /api/translate,
 * which itself caches per source string. Returns the original Korean immediately and
 * swaps in the English translation once it resolves; never blocks rendering. */
export function useTranslatedTexts(texts: string[]): string[] {
  const { lang } = useLanguage();
  const [translated, setTranslated] = useState<string[]>(texts);
  const keyRef = useRef<string>("");

  const key = texts.join("␟");

  useEffect(() => {
    keyRef.current = key;

    if (lang === "ko") {
      setTranslated(texts);
      return;
    }

    const missing = Array.from(new Set(texts.filter((t) => t.trim() && !translationCache.has(t))));
    if (missing.length === 0) {
      setTranslated(texts.map((t) => translationCache.get(t) ?? t));
      return;
    }

    let cancelled = false;
    api
      .translate(missing)
      .then((res) => {
        missing.forEach((t, i) => translationCache.set(t, res.translations[i] ?? t));
        // A newer call may have started (texts changed) while this one was in flight —
        // only apply the result if it's still the latest request for this key.
        if (!cancelled && keyRef.current === key) {
          setTranslated(texts.map((t) => translationCache.get(t) ?? t));
        }
      })
      .catch(() => {
        if (!cancelled && keyRef.current === key) setTranslated(texts);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, key]);

  return translated;
}

export function useTranslatedText(text: string): string {
  return useTranslatedTexts([text])[0] ?? text;
}
