/** Representative product/facility photo for a company, keyed by the same `code`
 * companiesmarketcap.com returns. Files live in /img/products/ — Wikimedia Commons
 * photos, all freely licensed and vetted by hand for actually being the right
 * company (text search on Commons turns up same-name false positives often enough —
 * e.g. a query for "Applied Materials" once returned a building owned by "Applied
 * Intuition", an unrelated startup — so every entry here was confirmed by eye, not
 * just an unreviewed search hit) and for being product/facility photography rather
 * than a person's likeness, so there's no portrait-rights concern the way a CEO photo
 * would raise. Used both as the /fight arena's split left/right background (that page
 * only ever shows its fixed TOP 20 roster) and as the /global-top100 detail panel's
 * blurred banner. A company missing here (roster rotation, new entrant, or simply no
 * suitable free photo turned up on Commons) just gets no background image — this is
 * a best-effort set, not a claim of full TOP 100 coverage.
 */
const sanitize = (code: string): string => code.replace(/[^A-Za-z0-9]/g, "_");

const HAS_PRODUCT_IMAGE = new Set([
  // Original /fight TOP 20 roster
  "NVDA",
  "AAPL",
  "GOOG",
  "MSFT",
  "AMZN",
  "TSM",
  "AVGO",
  "2222.SR",
  "META",
  "SPCX",
  "TSLA",
  "005930.KS",
  "BRK-B",
  "LLY",
  "MU",
  "WMT",
  "JPM",
  "000660.KS",
  "AMD",
  "V",
  // Extended for /global-top100 (ranks 21-100) — added as each is found/verified
  "ASML",
  "CSCO",
  "COST",
  "CVX",
  "KO",
  "PG",
  "HD",
  "MS",
  "XOM",
  "TCEHY",
  "MRK",
  "JNJ",
  "TXN",
  "RO.SW",
  "RY",
  "AZN",
]);

export function productImageFor(code: string): string | null {
  if (!HAS_PRODUCT_IMAGE.has(code)) return null;
  return `/img/products/${sanitize(code)}.webp`;
}
