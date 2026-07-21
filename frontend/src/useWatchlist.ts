import { useEffect, useState } from "react";
import { StoredStock, getFavorites, getRecents, subscribeWatchlist } from "./watchlist";

/** Live view of the localStorage-backed star/history lists. Plain state + a
 * subscription rather than useSyncExternalStore: the store's getters build a fresh
 * array on every call, which useSyncExternalStore would treat as an endless stream
 * of changed snapshots. */
export function useWatchlist(): { favorites: StoredStock[]; recents: StoredStock[] } {
  const [lists, setLists] = useState(() => ({ favorites: getFavorites(), recents: getRecents() }));

  useEffect(() => {
    const sync = () => setLists({ favorites: getFavorites(), recents: getRecents() });
    // Re-read once on mount as well: the first render's initializer ran before any
    // sibling component had a chance to record the current stock.
    sync();
    return subscribeWatchlist(sync);
  }, []);

  return lists;
}
