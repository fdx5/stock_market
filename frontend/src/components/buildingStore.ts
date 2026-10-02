import type { RealEstateBuildingsResponse } from "../api/client";

/* Building shapes kept in this browser (IndexedDB), so a complex opened before
 * draws without a network round trip. Shapes change on a scale of years; the
 * server keeps them 30 days, and so do we. Any storage failure is a cache miss. */

// v2: responses carry roads. v3: every registered neighbour in the radius. v4: a
// 288 m radius (1.25x).
const DB = "kospimap-3d", STORE = "buildings-v4", KEEP_MS = 30 * 86400_000, MAX = 60;

let opening: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  opening ??= new Promise(resolve => {
    try {
      const req = indexedDB.open(DB, 5);
      req.onupgradeneeded = () => {
        const names = req.result.objectStoreNames;
        for (const old of ["buildings", "buildings-v2", "buildings-v3"]) if (names.contains(old)) req.result.deleteObjectStore(old);
        const store = names.contains(STORE) ? req.transaction!.objectStore(STORE) : req.result.createObjectStore(STORE);
        if (!store.indexNames.contains("at")) store.createIndex("at", "at");
      };
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
    // Key-only age index: never clone up to 60 complete city-building responses
    // into the browser heap merely to evict an old disk-cache entry.
    const count = store.count();
    count.onsuccess = () => {
      let excess = Math.max(0, count.result - MAX);
      if (!excess) return;
      const oldest = store.index("at").openKeyCursor();
      oldest.onsuccess = () => {
        const cursor = oldest.result;
        if (!cursor || !excess) return;
        store.delete(cursor.primaryKey); excess--;
        if (excess) cursor.continue();
      };
    };
  } catch { /* quota or private mode: stay uncached */ }
}
