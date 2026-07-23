import { Lang } from "./LanguageContext";

/** "조" (trillion KRW) has no single-glyph English equivalent — spell it out as "T". */
export function trillionSuffix(lang: Lang): string {
  return lang === "en" ? "T" : "조";
}

/** "원" (KRW symbol) becomes the ISO code for an English-reading audience. */
export function wonSuffix(lang: Lang): string {
  return lang === "en" ? " KRW" : "원";
}

/** News `published` timestamps arrive in two shapes: Bing's RFC-822 GMT string
 * ("Wed, 22 Jul 2026 06:57:00 GMT"), which the Date constructor parses natively, and
 * Naver's "YYYY.MM.DD HH:MM" (occasionally date-only) KST wall-clock, which it does
 * not. Returns a Date for either, or null when neither shape matches. */
function parseNewsDate(published: string): Date | null {
  // Naver: bare "2026.07.23 20:27" / "2026.07.23" — no timezone in the string, but
  // it's always Korea local time, so pin it to +09:00 explicitly rather than letting
  // the browser assume its own locale offset.
  const naver = published.trim().match(/^(\d{4})\.(\d{2})\.(\d{2})(?:\s+(\d{2}):(\d{2}))?$/);
  if (naver) {
    const [, y, mo, d, h = "00", mi = "00"] = naver;
    const parsed = new Date(`${y}-${mo}-${d}T${h}:${mi}:00+09:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(published);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Formats a news item's `published` timestamp for display in Korea Standard Time —
 * e.g. "2026년 7월 23일 목요일" — regardless of whether the source string was a GMT
 * (Bing) or KST (Naver) timestamp. Falls back to the raw string when it can't be
 * parsed, so an unexpected format degrades to showing something rather than blank. */
export function formatNewsDate(published: string | null | undefined, lang: Lang): string {
  if (!published) return "";
  const date = parseNewsDate(published);
  if (!date) return published;
  return new Intl.DateTimeFormat(lang === "en" ? "en-US" : "ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}
