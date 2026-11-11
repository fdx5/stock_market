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
  { id: "bcmTHIqefMk", title: "DARK SIGNAL · SoundFlow Lab", channel: "SoundFlow Lab", bpm: 100, energy: 0.7, bass: 0.8, bright: 0.55 },
  { id: "zXGb3k-A1Vo", title: "NIGHT PROTOCOL · SoundFlow Lab", channel: "SoundFlow Lab", bpm: 100, energy: 0.68, bass: 0.78, bright: 0.52 },
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
  { id: "twTHMnVM9L4", title: "Inception · Angel Lover", channel: "Angel Lover", bpm: 90, energy: 0.6, bass: 0.62, bright: 0.55 },
];

export const BGM_SESSION_KEY = "kospimap.bgm.session.v2";
const CATALOGUE = BGM_TRACKS.map(track => track.id).join(",");
/** The owner's two opening tracks. Each session puts them first and second in random order. */
export const BGM_OPENING_IDS: readonly string[] = [BGM_TRACKS[0].id, BGM_TRACKS[1].id];
const OPENING = BGM_OPENING_IDS.length;
type StorageAccess = Pick<Storage, "getItem" | "setItem">;

/** The owner's two opening tracks play first and second, in a random order; the rest
 * are shuffled once per tab session. Route changes and repeat laps share the current
 * position. A fresh page load starts again at track 1, while reusing the saved order.
 * Storage contains only public video IDs and a cursor, with no account information. */
export function createBgmSession(storage?: StorageAccess, random: () => number = Math.random) {
  let order = BGM_TRACKS.map(track => track.id);
  let cursor = 0;
  let restored = false;
  try {
    const saved = JSON.parse(storage?.getItem(BGM_SESSION_KEY) ?? "null");
    if (saved?.catalogue === CATALOGUE && Array.isArray(saved.order) &&
        BGM_OPENING_IDS.every(id => saved.order.indexOf(id) >= 0 && saved.order.indexOf(id) < OPENING) &&
        saved.order.length === order.length && new Set(saved.order).size === order.length &&
        saved.order.every((id: unknown) => typeof id === "string" && order.includes(id)) &&
        Number.isInteger(saved.cursor) && saved.cursor >= 0 && saved.cursor < order.length) {
      order = saved.order;
      cursor = 0;
      restored = true;
    }
  } catch { /* Blocked storage or malformed state: keep an in-memory session. */ }
  if (!restored) {
    if (random() < 0.5) [order[0], order[1]] = [order[1], order[0]];
    for (let i = order.length - 1; i > OPENING; i--) {
      const j = OPENING + Math.floor(random() * (i - OPENING + 1));
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
