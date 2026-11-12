import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";

/* Korean stock and sector names in English, for the home board and maps.
   One cache for the tab: the scanner and the mini maps show the same names, so
   each is asked of /api/translate once. Text without Hangul (US tickers, names
   already in English) is never sent. */
const cache = new Map<string, string>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
const HANGUL = /[가-힣]/;
const tidy = (text: string) => text ? text.charAt(0).toUpperCase() + text.slice(1) : text;

export function useEnglishNames(texts: readonly (string | null | undefined)[]): (text: string) => string {
  const { lang } = useLanguage();
  const [, bump] = useState(0);
  const key = lang === "en"
    ? [...new Set(texts.filter((text): text is string => !!text && HANGUL.test(text)))].sort().join("␟")
    : "";
  useEffect(() => {
    const refresh = () => bump(n => n + 1);
    listeners.add(refresh);
    return () => { listeners.delete(refresh); };
  }, []);
  useEffect(() => {
    if (!key) return;
    const missing = key.split("␟").filter(text => !cache.has(text) && !pending.has(text));
    for (let start = 0; start < missing.length; start += 500) {
      const batch = missing.slice(start, start + 500);
      batch.forEach(text => pending.add(text));
      api.translate(batch)
        .then(result => batch.forEach((text, i) => { const english = result.translations[i]; if (english && !HANGUL.test(english)) cache.set(text, tidy(english.trim())); }))
        .catch(() => undefined)
        .finally(() => { batch.forEach(text => pending.delete(text)); listeners.forEach(listener => listener()); });
    }
  }, [key]);
  return useCallback((text: string) => lang === "en" ? cache.get(text) ?? text : text, [lang, key, cache.size]);
}
