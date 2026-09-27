import type { RealEstateBuildingsResponse } from "../api/client";

/* Building shapes kept in this browser (IndexedDB), so a complex opened before
 * draws without a network round trip. Shapes change on a scale of years; the
 * server keeps them 30 days, and so do we. Any storage failure is a cache miss. */

// v2: responses carry roads.
const DB = "kospimap-3d", STORE = "buildings-v2", KEEP_MS = 30 * 86400_000, MAX = 60;

let opening: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  opening ??= new Promise(resolve => {
    try {
      const req = indexedDB.open(DB, 2);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return opening;
}

type Row = { at: number; data: RealEstateBuildingsResponse };

export async function loadBuildings(id: string): Promise<RealEstateBuildingsResponse | null> {
  const d = await db();
  if (!d) return null;
  return new Promise(resolve => {
    try {
      const req = d.transaction(STORE).objectStore(STORE).get(id);
      req.onsuccess = () => {
        const row = req.result as Row | undefined;
        resolve(row && Date.now() - row.at < KEEP_MS && row.data?.found ? row.data : null);
      };
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function saveBuildings(id: string, data: RealEstateBuildingsResponse): Promise<void> {
  const d = await db();
  if (!d || !data.found) return;
  try {
    const store = d.transaction(STORE, "readwrite").objectStore(STORE);
    store.put({ at: Date.now(), data } satisfies Row, id);
    // Oldest out beyond MAX entries.
    const all = store.getAll(), keys = store.getAllKeys();
    all.onsuccess = () => keys.onsuccess = () => {
      const rows = (all.result as Row[]).map((r, i) => [r.at, keys.result[i]] as const).sort((a, b) => a[0] - b[0]);
      rows.slice(0, Math.max(0, rows.length - MAX)).forEach(([, k]) => store.delete(k));
    };
  } catch { /* quota or private mode: stay uncached */ }
}
