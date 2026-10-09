/** The large static files (the 3D view's trees, cars, plants and textures; the planets, sky
 * panoramas and product photos) served by jsDelivr from this repository on GitHub, not by
 * our own server: their bytes were most of the site's bandwidth bill. Pinned to a commit
 * (cached for good there); a file not in it, or the CDN unreachable, comes from our server.
 *
 * When a file under frontend/public/3d or /img changes (or one is added), push it and move
 * STATIC_PIN to that commit — until then the CDN keeps serving the pinned version. */
export const STATIC_PIN = "8876765";
export const SCENE_STATIC_PIN = "480e72b856f5f2f7597fcea1d0b4afde9e6d3af1";
const SCENE_FILES = new Set(['/3d/trees-compact.bin','/3d/trees-compact.json','/3d/dense-twigs.webp','/3d/dense-twigs.bc7.gz','/3d/dense-twigs.etc2.gz']);
const ROOT = (import.meta.env.VITE_STATIC_CDN as string | undefined || `https://cdn.jsdelivr.net/gh/fdx5/stock_market@${STATIC_PIN}/frontend/public`).replace(/\/$/, "");
const SCENE_ROOT = (import.meta.env.VITE_STATIC_CDN as string | undefined || `https://cdn.jsdelivr.net/gh/fdx5/stock_market@${SCENE_STATIC_PIN}/frontend/public`).replace(/\/$/, "");

/** The URL a site path ("/3d/trees.bin") is fetched from: the CDN in production. */
export function cdn(path: string): string {
  if (import.meta.env.DEV || !path.startsWith("/")) return path;
  // Drone assets were added after STATIC_PIN. Serve their deployed copy directly
  // until a CDN pin containing them is published, rather than requesting a 404 first.
  if (path.startsWith('/3d/drone/')) return path;
  return (SCENE_FILES.has(path) ? SCENE_ROOT : ROOT) + path;
}

/** fetch() of a site path from the CDN, from our server when that fails. */
export async function fetchStatic(path: string, init?: RequestInit): Promise<Response> {
  const url = cdn(path);
  if (url !== path) {
    try { const r = await fetch(url, init); if (r.ok) return r; } catch { /* (the server's copy below) */ }
  }
  return fetch(path, init);
}

/** Complete critical surface downloads before returning. A slow CDN must not
 * block the first GPU frame: race its identical origin copy after 250 ms.
 * Deadlines cover the body too, and losing requests are cancelled. */
export async function fetchCriticalStatic(path: string): Promise<Response> {
  const remote = cdn(path);
  const controllers: AbortController[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const download = async (url: string, delay = 0) => {
    if (delay) await new Promise<void>(resolve => timers.push(setTimeout(resolve, delay)));
    const controller = new AbortController();
    controllers.push(controller);
    const deadline = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw Error(`Surface asset ${response.status}: ${path}`);
      const body = await response.blob();
      return new Response(body, { status: response.status, headers: response.headers });
    } finally { clearTimeout(deadline); }
  };
  try {
    const requests = remote === path ? [download(path)] : [download(remote), download(path, 250)];
    return await new Promise<Response>((resolve, reject) => {
      let failed = 0;
      for (const request of requests) request.then(resolve, error => {
        if (++failed === requests.length) reject(error);
      });
    });
  } finally {
    timers.forEach(clearTimeout);
    controllers.forEach(controller => controller.abort());
  }
}
