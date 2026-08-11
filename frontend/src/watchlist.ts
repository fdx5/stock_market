import type { StockSearchResult } from "./api/client";

/** A stock the visitor starred or opened. Deliberately the same shape as
 * StockSearchResult (plus nothing else) so a stored entry can be handed straight
 * back to Dashboard's `onSelect` without a lookup round-trip. */
export interface StoredStock {
  code: string;
  name: string;
  market: string;
}

const RECENTS_KEY = "kstock_recents";

const MAX_RECENTS = 10;

/* There was a starred list here too, under "kstock_favorites", with its own
 * getter, an isFavorite test, a toggle and a remove — and a star button on
 * every stock header to drive them. It is gone from the whole site.
 *
 * The key is deliberately not cleaned up on read. Nothing writes it any more
 * and nothing displays it, so it is inert; deleting it would mean shipping a
 * migration that runs in every visitor's browser to reclaim a few hundred bytes
 * they will never notice, and would throw away the one copy of the data if the
 * feature is ever wanted back. It costs nothing to leave. */

// Both lists live in localStorage (not the backend): they're a per-device
// convenience, and this app has no accounts to hang them off. Writes broadcast a
// window event so every mounted consumer re-reads immediately — `storage` only
// fires in *other* tabs, so it can't be used for same-tab sync on its own.
const CHANGE_EVENT = "kstock:watchlist-change";

function read(key: string): StoredStock[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StoredStock =>
        item && typeof item.code === "string" && typeof item.name === "string"
    );
  } catch {
    // Private-mode denials, quota errors, or hand-edited garbage — an empty list is
    // always a valid state for these, so nothing here is worth surfacing.
    return [];
  }
}

function write(key: string, items: StoredStock[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Best-effort: a failed write just means the list doesn't persist this session.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function getRecents(): StoredStock[] {
  return read(RECENTS_KEY);
}

/** Records a visit, moving an already-seen stock back to the front rather than
 * duplicating it. A blank name is ignored: the dashboard briefly holds a
 * name-less placeholder while `/summary` is in flight, and storing that would
 * render as an empty chip. */
export function recordRecent(stock: StoredStock): void {
  if (!stock.code || !stock.name.trim()) return;
  const rest = getRecents().filter((item) => item.code !== stock.code);
  write(RECENTS_KEY, [stock, ...rest].slice(0, MAX_RECENTS));
}

export function clearRecents(): void {
  write(RECENTS_KEY, []);
}

export function subscribeWatchlist(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  // Keeps a second tab's stars/recents in sync too, since localStorage is shared.
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function toSearchResult(stock: StoredStock): StockSearchResult {
  return { code: stock.code, name: stock.name, market: stock.market };
}
