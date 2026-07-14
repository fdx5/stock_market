// Naver's static logo host sends only `Cache-Control: max-age=60`, and the same
// handful of stock icons get re-rendered constantly across this app (map tiles
// refreshing every 10s-60s, search results, the stock header) — so a plain <img src>
// re-fetches from Naver far more often than the logos ever actually change. Caching
// resolved logos in the browser's Cache Storage means each code is fetched from Naver
// at most once for as long as the cache entry survives, no matter how many times or
// how many components render it.
const ICON_CACHE_NAME = "stock-icons-v1";

// Module-level singleton: persists for the lifetime of the tab (this SPA never
// reloads the module on route changes), so every StockIcon instance and the map's PNG
// export share one in-flight/resolved promise per code instead of racing.
const resolvedUrlCache = new Map<string, Promise<string>>();

export function stockIconUrl(code: string): string {
  return `https://ssl.pstatic.net/imgstock/fn/real/logo/png/stock/Stock${code}.png`;
}

async function fetchAndCache(url: string): Promise<string> {
  try {
    if (typeof caches === "undefined") return url;
    const cache = await caches.open(ICON_CACHE_NAME);
    const cached = await cache.match(url);
    const response = cached ?? (await fetch(url, { mode: "cors" }));
    if (!cached) {
      if (!response.ok) return url;
      await cache.put(url, response.clone());
    }
    return URL.createObjectURL(await response.blob());
  } catch {
    // Cache Storage unavailable/blocked (private browsing, unsupported browser, CORS
    // hiccup) — fall back to the direct Naver URL so the icon still loads, just
    // subject to the origin's own (short) cache headers instead of ours.
    return url;
  }
}

/** Resolves to a long-lived object URL backed by the Cache Storage API, memoized per
 * stock code for the lifetime of the tab. Always resolves (never rejects) — falls
 * back to the direct Naver URL on any failure. */
export function loadStockIconUrl(code: string): Promise<string> {
  let cached = resolvedUrlCache.get(code);
  if (!cached) {
    cached = fetchAndCache(stockIconUrl(code));
    resolvedUrlCache.set(code, cached);
  }
  return cached;
}
