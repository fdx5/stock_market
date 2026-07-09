import { Lang } from "./LanguageContext";

/** "조" (trillion KRW) has no single-glyph English equivalent — spell it out as "T". */
export function trillionSuffix(lang: Lang): string {
  return lang === "en" ? "T" : "조";
}

/** "원" (KRW symbol) becomes the ISO code for an English-reading audience. */
export function wonSuffix(lang: Lang): string {
  return lang === "en" ? " KRW" : "원";
}
