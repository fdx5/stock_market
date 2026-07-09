import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { DICTIONARY } from "./dictionary";

export type Lang = "ko" | "en";

const STORAGE_KEY = "site_lang";

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const LanguageContext = createContext<LanguageContextValue>({ lang: "ko", setLang: () => {} });

function getStoredLang(): Lang | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "en" || stored === "ko" ? stored : null;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => getStoredLang() ?? "ko");

  useEffect(() => {
    // Only worth auto-detecting when this visitor has never explicitly picked KO/EN —
    // an explicit choice (made via setLang below, which persists it) always wins over
    // an IP-based guess, including on later visits.
    if (getStoredLang()) return;

    fetch("/api/geo/country")
      .then((res) => res.json())
      .then((data: { country: string | null }) => {
        // Default to English for any non-Korean IP; still only a *default* — the
        // toggle remains fully available and an explicit click overrides it for good.
        if (data.country && data.country !== "KR") {
          setLangState("en");
        }
      })
      .catch(() => {
        // Geo lookup failing just keeps the Korean default.
      });
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
  };

  return <LanguageContext.Provider value={{ lang, setLang }}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}

/** Translates fixed UI copy via the pre-built dictionary — instant, no network call.
 * Falls back to the Korean source text for anything not yet in the dictionary. */
export function useT(): (text: string) => string {
  const { lang } = useLanguage();
  return (text: string) => (lang === "en" ? DICTIONARY[text] ?? text : text);
}
