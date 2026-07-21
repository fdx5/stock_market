/** AI-stylized (illustrated, not photographic) CEO/chairman portrait for each global-
 * TOP20 roster company, keyed by the same `code` companiesmarketcap.com returns.
 * Files live in /img/ceo_stylized/. These are illustrated renders (not real photos),
 * generated specifically to sidestep the likeness/portrait-rights concern real CEO
 * photography raised. A company missing here (roster rotation, new entrant) falls
 * back to the plain company logo.
 *
 * The set is sliced from a single 4x5 generated collage (img/ceo_simson.jfif at the
 * repo root, not shipped) whose reading order is exactly the order below — so if the
 * roster changes, regenerate the collage in this same order rather than re-keying
 * the slices.
 */
const sanitize = (code: string): string => code.replace(/[^A-Za-z0-9]/g, "_");

const HAS_STYLIZED_IMAGE = new Set([
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
]);

export function ceoStylizedImageFor(code: string): string | null {
  if (!HAS_STYLIZED_IMAGE.has(code)) return null;
  return `/img/ceo_stylized/${sanitize(code)}.jpg`;
}
