// Company logos for US tickers, off companiesmarketcap's image host — the same host
// the 시총대결 roster already draws its logos from, so this adds a CDN dependency the
// app has rather than a new one. Their path is keyed by ticker, which means a logo
// needs no lookup at all: the board already knows the symbol.
//
// Not to be confused with prediction.ts's `usLogoUrl`, which is a different thing under
// a similar name: twelve hand-picked tickers mapped to assets bundled under /img/ticker,
// returning null for everything else so the prediction cards can fall back to a
// monogram. That one is self-hosted and deliberately partial; this one covers every name
// in both US indices, which is what a 100- or 500-tile surface needs. The names here are
// spelled out in full to keep the two apart at a glance in an import list.
//
// Deliberately NOT routed through stockIcon.ts's Cache Storage layer. That layer exists
// because Naver's icon host sends `max-age=60`, so a plain <img> re-fetches constantly.
// This host sends `max-age=1209600` (14 days) and no `Access-Control-Allow-Origin` at
// all — a cors-mode fetch would fail outright, and the browser's own HTTP cache already
// does the job the Cache Storage layer was written to do. A plain <img src> is both the
// simpler and the better answer here.

// The host files a company under one ticker, which is not always the one an index
// quotes. Most of these are dual-share-class names (the host carries whichever class it
// listed first); BNY is a company that changed its ticker and the host hasn't followed.
// Each target below was checked by eye against the company it claims to be — a wrong
// alias is invisible in code review and obvious on the page.
//
// Verified across both indices this covers: with these aliases the S&P 500 resolves
// 503/503 and the Nasdaq-100 102/103. The lone holdout is Ferrovial (FER), which the
// host genuinely doesn't carry. Resist "fixing" it by pointing at FERG — that is
// Ferguson, a different company. A ticker with no logo just falls back to its text.
const TICKER_ALIASES: Record<string, string> = {
  GOOGL: "GOOG", // Alphabet class A -> class C
  FOXA: "FOX", // Fox class A -> class B
  NWSA: "NWS", // News Corp class A -> class B
  "BF.B": "BF-A", // Brown-Forman class B -> class A
  BNY: "BK", // Bank of New York Mellon, still filed under its former ticker
};

// 128px for a 34px tile: sharp at 3x DPR, and about half the bytes of the same logo as
// PNG (~2.4KB vs ~4.7KB average across the roster). Not the 64px variant — this host
// serves a *different asset* at that size for some companies (Samsung's 64px is a bare
// "S" glyph where the larger ones are the full wordmark), so the small variant isn't
// merely softer, it can be the wrong mark. See CompanyLogo.tsx, which hit the same trap.
const LOGO_SIZE = 128;

/** The index's spelling of a ticker, rewritten to the logo host's. Aliases resolve
 * first, so they can be written with the dot the index actually uses; class-share
 * tickers then go from slickcharts' `BRK.B` to this host's `BRK-B` — the same rewrite
 * yahoo_bulk_quote does on the backend, for the same reason. */
function logoSymbol(ticker: string): string {
  return (TICKER_ALIASES[ticker] ?? ticker).replace(/\./g, "-");
}

export function usCompanyLogoUrl(ticker: string): string {
  return `https://companiesmarketcap.com/img/company-logos/${LOGO_SIZE}/${logoSymbol(ticker)}.webp`;
}

/** The same logo by way of our own backend, for the one caller that can't use the URL
 * above: a map's PNG export. The logo host sends no CORS header, and a cross-origin
 * image taints the canvas the map is redrawn into — which makes the `toBlob()` behind
 * the download throw rather than merely skip the logo. Same-origin bytes don't taint.
 *
 * Everything else should keep using `usCompanyLogoUrl`: served straight from the CDN it
 * costs this app no bandwidth at all, and a map is viewed far more often than it is
 * exported. Both go through `logoSymbol`, so the two can never disagree about which
 * image a ticker means. See backend `data/us_logo_fetcher`. */
export function usCompanyLogoProxyUrl(ticker: string): string {
  return `/api/market/us-logo/${logoSymbol(ticker)}`;
}
