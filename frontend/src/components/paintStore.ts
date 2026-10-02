const DB = "kospimap-paint", STORE = "tex", LIMIT = 40;
interface Entry { params: unknown; blobs: Record<string, Blob>; at: number }

let dbp: Promise<IDBDatabase | null> | null = null;
const db = () => dbp ??= new Promise(resolve => {
  try {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const store = req.result.objectStoreNames.contains(STORE) ? req.transaction!.objectStore(STORE) : req.result.createObjectStore(STORE);
      if (!store.indexNames.contains('at')) store.createIndex('at', 'at');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  } catch { resolve(null); }
});
const done = <T>(req: IDBRequest<T>) => new Promise<T | null>(resolve => { req.onsuccess = () => resolve(req.result); req.onerror = () => resolve(null); });

export async function readPaint(key: string): Promise<Entry | null> {
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
    const count = await done(d.transaction(STORE).objectStore(STORE).count());
    let excess = (count ?? 0) - LIMIT;
    if (excess <= 0) return;
    await new Promise<void>(resolve => {
      const store = d.transaction(STORE, 'readwrite').objectStore(STORE);
      const cur = store.index('at').openKeyCursor();
      cur.onsuccess = () => { const c = cur.result; if (!c || excess-- <= 0) return resolve(); store.delete(c.primaryKey); c.continue(); };
      cur.onerror = () => resolve();
    });
  } catch { /* the cache is a convenience */ }
}

const RAW: ImageBitmapOptions = { colorSpaceConversion: "none", premultiplyAlpha: "none" };

async function encode(bitmap: ImageBitmap): Promise<Blob> {
  const c = new OffscreenCanvas(bitmap.width, bitmap.height);
  // (the CPU's canvas: a GPU one is run by the browser's GPU process, which the page's frames wait on)
  c.getContext("2d", { willReadFrequently: true })!.drawImage(bitmap, 0, 0);
  bitmap.close();
  try { return await c.convertToBlob({ type: "image/png" }); }
  finally { c.width = c.height = 1; }
}


export async function writePaint(key: string, params: unknown, bitmaps: Record<string, ImageBitmap>, allowed = () => true) {
  try {
    const names = Object.keys(bitmaps), blobs: Blob[] = [];
    for (const name of names) { if (!allowed()) return; blobs.push(await encode(bitmaps[name])); }
    if (!allowed()) return;
    await put(key, { params, blobs: Object.fromEntries(names.map((n, i) => [n, blobs[i]])), at: Date.now() });
  } catch { /* optional cache */ }
  finally { Object.values(bitmaps).forEach(b => b.close()); }
}
