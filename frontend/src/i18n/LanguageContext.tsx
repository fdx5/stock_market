import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { DICTIONARY } from "./dictionary";

export type Lang = "ko" | "en";

const STORAGE_KEY = "site_lang";

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const LanguageContext = createContext<LanguageContextValue>({ lang: "ko", setLang: () => {} });

function getInitialLang(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "en" ? "en" : "ko";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getInitialLang);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang);
  }, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang: setLangState }}>{children}</LanguageContext.Provider>
  );
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
