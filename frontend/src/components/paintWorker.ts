/// <reference lib="webworker" />

/* The painted textures of the 3D view (a complex's facades and granite base, the
 * neighbourhood's facade styles) kept in IndexedDB, so a later visit decodes them instead
 * of painting them again. Encoding (lossless PNG: normals and masks are data) and
 * decoding both happen here, off the page's thread.
 *
 *   { op: "get", id, key }                 -> { id, bitmaps: { name: ImageBitmap } | null, params }
 *   { op: "put", key, params, bitmaps }    -> (kept; the bitmaps are closed)
 */

const DB = "kospimap-paint", STORE = "tex", LIMIT = 40;
interface Entry { params: unknown; blobs: Record<string, Blob>; at: number }

let dbp: Promise<IDBDatabase | null> | null = null;
const db = () => dbp ??= new Promise(resolve => {
  try {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  } catch { resolve(null); }
});
const done = <T>(req: IDBRequest<T>) => new Promise<T | null>(resolve => { req.onsuccess = () => resolve(req.result); req.onerror = () => resolve(null); });

async function get(key: string): Promise<Entry | null> {
  const d = await db();
  if (!d) return null;
  try {
    const entry = await done<Entry | undefined>(d.transaction(STORE).objectStore(STORE).get(key));
    // Touched: the least recently used go first.
    if (entry) d.transaction(STORE, "readwrite").objectStore(STORE).put({ ...entry, at: Date.now() }, key);
    return entry ?? null;
  } catch { return null; }
}

async function put(key: string, entry: Entry) {
  const d = await db();
  if (!d) return;
  try {
    await done(d.transaction(STORE, "readwrite").objectStore(STORE).put(entry, key));
    const ages: [IDBValidKey, number][] = [];
    await new Promise<void>(resolve => {
      const cur = d.transaction(STORE).objectStore(STORE).openCursor();
      cur.onsuccess = () => { const c = cur.result; if (!c) return resolve(); ages.push([c.key, (c.value as Entry).at]); c.continue(); };
      cur.onerror = () => resolve();
    });
    if (ages.length <= LIMIT) return;
    ages.sort((a, b) => a[1] - b[1]);
    const store = d.transaction(STORE, "readwrite").objectStore(STORE);
    for (const [k] of ages.slice(0, ages.length - LIMIT)) store.delete(k);
  } catch { /* the cache is a convenience */ }
}

const RAW: ImageBitmapOptions = { colorSpaceConversion: "none", premultiplyAlpha: "none" };

async function encode(bitmap: ImageBitmap): Promise<Blob> {
  const c = new OffscreenCanvas(bitmap.width, bitmap.height);
  c.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return c.convertToBlob({ type: "image/png" });
}

type Msg = { op: "get"; id: number; key: string } | { op: "put"; key: string; params: unknown; bitmaps: Record<string, ImageBitmap> };

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  if (m.op === "get") {
    let bitmaps: Record<string, ImageBitmap> | null = null, params: unknown = null;
    try {
      const hit = await get(m.key);
      if (hit) {
        const names = Object.keys(hit.blobs);
        const list = await Promise.all(names.map(n => createImageBitmap(hit.blobs[n], RAW)));
        bitmaps = Object.fromEntries(names.map((n, i) => [n, list[i]]));
        params = hit.params;
      }
    } catch { bitmaps = null; }
    (self as unknown as Worker).postMessage({ id: m.id, bitmaps, params }, bitmaps ? Object.values(bitmaps) : []);
    return;
  }
  try {
    const names = Object.keys(m.bitmaps);
    const blobs = await Promise.all(names.map(n => encode(m.bitmaps[n])));
    await put(m.key, { params: m.params, blobs: Object.fromEntries(names.map((n, i) => [n, blobs[i]])), at: Date.now() });
  } catch { /* not kept: painted again next time */ }
};
