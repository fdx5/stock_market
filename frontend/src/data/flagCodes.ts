/** Maps the `country` string companiesmarketcap.com scrapes (see country_el in
 * global_marketcap_fetcher.py — confirmed values: "USA", "Taiwan", "S. Arabia",
 * "S. Korea", plus other countries likely to rotate into the TOP20) to an ISO
 * 3166-1 alpha-2 code, for use with flagcdn.com's vector flags.
 *
 * companiesmarketcap's own flag images are a tiny 32x32px PNG — fine as a small
 * icon elsewhere, but visibly blurry/pixelated stretched across the fight page's
 * full-width flag banner. flagcdn.com serves the same flags as crisp SVG that scales
 * to any size, so the info-card banner uses this mapping instead; an unmapped
 * country just falls back to the small original PNG rather than breaking.
 */
export const FLAG_ISO_CODES: Record<string, string> = {
  USA: "us",
  Taiwan: "tw",
  "S. Arabia": "sa",
  "S. Korea": "kr",
  China: "cn",
  Japan: "jp",
  Germany: "de",
  France: "fr",
  UK: "gb",
  Switzerland: "ch",
  Netherlands: "nl",
  Denmark: "dk",
  Canada: "ca",
  Ireland: "ie",
  India: "in",
  Australia: "au",
  // Added for the 글로벌 시가총액 TOP 100 page — a 100-constituent roster surfaces
  // countries the TOP 20 fight-page roster never has (see companiesmarketcap's
  // `country` scrape field, global_marketcap_fetcher.py).
  Argentina: "ar",
  Austria: "at",
  Belgium: "be",
  Brazil: "br",
  Finland: "fi",
  "Hong Kong": "hk",
  Italy: "it",
  Luxembourg: "lu",
  Mexico: "mx",
  Norway: "no",
  Singapore: "sg",
  Spain: "es",
  Sweden: "se",
  Thailand: "th",
  UAE: "ae",
  Vietnam: "vn",
};

export function hiResFlagUrl(country: string): string | null {
  const iso = FLAG_ISO_CODES[country];
  return iso ? `https://flagcdn.com/${iso}.svg` : null;
}
