/** The site's only music catalogue. IDs are the owner's approved YouTube uploads. */
export interface BgmTrack {
  id: string;
  title: string;
  channel: string;
  /** Decorative fallback settings; the normal meter reads measured envelopes. */
  bpm: number;
  energy: number;
  bass: number;
  bright: number;
}

export const BGM_TRACKS: readonly BgmTrack[] = [
  { id: "-lbbHQbZNKg", title: "Lights · Sappheiros", channel: "Audio Library", bpm: 100, energy: 0.66, bass: 0.72, bright: 0.5 },
  { id: "pF2tXC1pXNo", title: "Chill · sakura Hz", channel: "Audio Library", bpm: 80, energy: 0.48, bass: 0.55, bright: 0.4 },
  { id: "DUWRbl3eVi0", title: "Dawn · Sappheiros", channel: "Sappheiros", bpm: 90, energy: 0.62, bass: 0.7, bright: 0.48 },
  { id: "6WQjgHuUDWU", title: "Lost Within · A Himitsu", channel: "A Himitsu", bpm: 100, energy: 0.7, bass: 0.78, bright: 0.6 },
  { id: "vP4jqXzphvc", title: "Way Home · Tokyo Music Walker", channel: "Tokyo Music Walker", bpm: 90, energy: 0.5, bass: 0.55, bright: 0.48 },
  { id: "uYjUI_zeeJk", title: "White Petals · Keys of Moon", channel: "BreakingCopyright", bpm: 70, energy: 0.35, bass: 0.25, bright: 0.65 },
  { id: "TrNDRrDXQdo", title: "Nocturne · Nomyn", channel: "Audio Library", bpm: 80, energy: 0.48, bass: 0.6, bright: 0.45 },
  { id: "8PqN8kexaT0", title: "Breath of the Galaxy", channel: "TJ World", bpm: 72, energy: 0.42, bass: 0.5, bright: 0.6 },
  { id: "TMXlHacZSh0", title: "Interstellar Drift", channel: "TJ World", bpm: 76, energy: 0.5, bass: 0.55, bright: 0.62 },
  { id: "7dn32JVyB6s", title: "Map in Grey", channel: "TJ World", bpm: 68, energy: 0.38, bass: 0.35, bright: 0.5 },
  { id: "DzYp5uqixz0", title: "Embrace · Sappheiros", channel: "BreakingCopyright", bpm: 90, energy: 0.58, bass: 0.65, bright: 0.52 },
  { id: "DHNZeIy4kjs", title: "Lost Within · A Himitsu", channel: "Audio Library", bpm: 100, energy: 0.7, bass: 0.78, bright: 0.6 },
];

export const BGM_SESSION_KEY = "kospimap.bgm.session.v2";
const CATALOGUE = BGM_TRACKS.map(track => track.id).join(",");
type StorageAccess = Pick<Storage, "getItem" | "setItem">;

/** One shuffle for the tab session; wraps reuse that order, including after reloads.
 * Storage contains only public video IDs and a cursor, with no account information. */
export function createBgmSession(storage?: StorageAccess, random: () => number = Math.random) {
  let order = BGM_TRACKS.map(track => track.id);
  let cursor = 0;
  let restored = false;
  try {
    const saved = JSON.parse(storage?.getItem(BGM_SESSION_KEY) ?? "null");
    if (saved?.catalogue === CATALOGUE && Array.isArray(saved.order) &&
        saved.order.length === order.length && new Set(saved.order).size === order.length &&
        saved.order.every((id: unknown) => typeof id === "string" && order.includes(id)) &&
        Number.isInteger(saved.cursor) && saved.cursor >= 0 && saved.cursor < order.length) {
      order = saved.order;
      cursor = saved.cursor;
      restored = true;
    }
  } catch { /* Blocked storage or malformed state: keep an in-memory session. */ }
  if (!restored) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  const persist = () => {
    try { storage?.setItem(BGM_SESSION_KEY, JSON.stringify({ catalogue: CATALOGUE, order, cursor })); }
    catch { /* Private mode/quota: navigation still shares this module's session. */ }
  };
  persist();
  return {
    get track(): BgmTrack { return BGM_TRACKS.find(track => track.id === order[cursor])!; },
    get position() { return cursor + 1; },
    get total() { return order.length; },
    advance(step: number) {
      cursor = ((cursor + step) % order.length + order.length) % order.length;
      persist();
    },
  };
}

let storage: StorageAccess | undefined;
try { storage = window.sessionStorage; } catch { /* Storage access can throw. */ }
export const bgmSession = createBgmSession(storage);
