/* Which edition of the paper the reader is in — the domestic desk or the world
 * edition — so the masthead's 1면 goes back to the right front page.
 *
 * A page about Korean names (a KRX code, the KOSPI/KOSDAQ maps and boards, the
 * brief, the domestic tabs of 종목정보 and ETF) is the domestic edition; a page
 * about US names (a ticker, the S&P 500 and NASDAQ maps and board, the US tabs) is
 * the world edition. Pages about neither (news, forecasts, the cap fight) keep
 * whichever edition the reader came from, remembered for the session. */

export type Edition = "kr" | "us";

const KEY = "d2:edition";
const US_PATHS = new Set(["/global", "/sp500-map", "/nasdaq100-map", "/nasdaq-100", "/nasdaq100-orbit", "/sp500-orbit"]);
const KR_PATHS = new Set(["/desk", "/map", "/kosdaq-map", "/kospi-100", "/kosdaq-100", "/kospi-orbit", "/kosdaq-orbit"]);
const KRX_CODE = /^\d[0-9A-Z]{5}$/i;

export function editionOf(path: string, search: string): Edition | null {
  if (US_PATHS.has(path)) return "us";
  if (KR_PATHS.has(path) || path.startsWith("/market-brief") || path.startsWith("/index/")) return "kr";
  const stock = path.match(/^\/stock\/([^/?#]+)/);
  if (stock) return KRX_CODE.test(decodeURIComponent(stock[1])) ? "kr" : "us";
  const p = new URLSearchParams(search);
  if (path === "/stocks") {
    const m = p.get("market");
    return m === "sp500" || m === "us_etf" ? "us" : "kr";
  }
  if (path === "/etf") return p.get("region") === "US" ? "us" : "kr";
  return null;
}

/** The edition for the page on screen, remembering it for the pages that have none. */
export function currentEdition(): Edition {
  if (typeof window === "undefined") return "kr";
  const here = editionOf(window.location.pathname, window.location.search);
  try {
    if (here) {
      window.sessionStorage.setItem(KEY, here);
      return here;
    }
    return window.sessionStorage.getItem(KEY) === "us" ? "us" : "kr";
  } catch {
    return here ?? "kr";
  }
}

export function frontPageOf(edition: Edition): string {
  return edition === "us" ? "/global" : "/desk";
}
