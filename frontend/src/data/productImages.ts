/** Representative product/service photo for each global-TOP20 roster company, keyed
 * by the same `code` companiesmarketcap.com returns. Files live in /img/products/
 * (Wikimedia Commons photos via Wikipedia's lead-image API, freely licensed — not
 * people's likenesses, just products/hardware/facilities, so no portrait-rights
 * concern). Used as the fight arena's split left/right background. A company
 * missing here (roster rotation, new entrant) just gets no background image.
 *
 * Sources (en.wikipedia.org page each photo was pulled from): GeForce, IPhone,
 * Google_Nest, Microsoft_Surface, Amazon_(company), TSMC, Broadcom_Inc.,
 * Saudi_Aramco, Meta_Quest, Falcon_9_first-stage_landing_tests, Tesla_Model_3,
 * Samsung_Galaxy, NetJets, Insulin_pen, Micron_Technology, Walmart, JPMorgan_Chase,
 * DDR5_SDRAM, Ryzen, Visa_Inc.
 */
const sanitize = (code: string): string => code.replace(/[^A-Za-z0-9]/g, "_");

const HAS_PRODUCT_IMAGE = new Set([
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

export function productImageFor(code: string): string | null {
  if (!HAS_PRODUCT_IMAGE.has(code)) return null;
  return `/img/products/${sanitize(code)}.jpg`;
}
