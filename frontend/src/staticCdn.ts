/** The large static files (the 3D view's trees, cars, plants and textures; the planets, sky
 * panoramas and product photos) served by jsDelivr from this repository on GitHub, not by
 * our own server: their bytes were most of the site's bandwidth bill. Pinned to a commit
 * (cached for good there); a file not in it, or the CDN unreachable, comes from our server.
 *
 * When a file under frontend/public/3d or /img changes (or one is added), push it and move
 * STATIC_PIN to that commit — until then the CDN keeps serving the pinned version. */
export const STATIC_PIN = "8876765";
const ROOT = (import.meta.env.VITE_STATIC_CDN as string | undefined || `https://cdn.jsdelivr.net/gh/fdx5/stock_market@${STATIC_PIN}/frontend/public`).replace(/\/$/, "");

/** The URL a site path ("/3d/trees.bin") is fetched from: the CDN in production. */
export function cdn(path: string): string {
  if (import.meta.env.DEV || !path.startsWith("/")) return path;
  return ROOT + path;
}

/** fetch() of a site path from the CDN, from our server when that fails. */
export async function fetchStatic(path: string, init?: RequestInit): Promise<Response> {
  const url = cdn(path);
  if (url !== path) {
    try { const r = await fetch(url, init); if (r.ok) return r; } catch { /* (the server's copy below) */ }
  }
  return fetch(path, init);
}
