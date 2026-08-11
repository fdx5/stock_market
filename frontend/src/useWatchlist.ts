import { useEffect, useState } from "react";
import { StoredStock, getRecents, subscribeWatchlist } from "./watchlist";

/** Live view of the localStorage-backed history list. Plain state + a
 * subscription rather than useSyncExternalStore: the store's getter builds a fresh
 * array on every call, which useSyncExternalStore would treat as an endless stream
 * of changed snapshots.
 *
 * Returns an object rather than the bare array, which is what it did when there
 * were two lists to hand back. Kept that shape on purpose: every caller
 * destructures `{ recents }`, and flattening it would be a rename across four
 * files to save one pair of braces. */
export function useWatchlist(): { recents: StoredStock[] } {
  const [lists, setLists] = useState(() => ({ recents: getRecents() }));

  useEffect(() => {
    const sync = () => setLists({ recents: getRecents() });
    // Re-read once on mount as well: the first render's initializer ran before any
    // sibling component had a chance to record the current stock.
    sync();
    return subscribeWatchlist(sync);
  }, []);

  return lists;
}
