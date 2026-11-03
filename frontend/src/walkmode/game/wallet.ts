/* The walker's play money (게임 머니, not real money) and what they carry: picked up as coins in the
 * street, spent at a building's shop or convenience store, kept in this browser only. Listeners are
 * told of every change (the HUD's balance). */

export interface Carried { id: string; name: string; kind: "drink" | "food" | "goods"; fizzy?: boolean; count: number; /** what it cost, when it was first bought (ms) — the bag's list */ price?: number; at?: number }
interface Saved { v: 1; money: number; items: Carried[] }
const KEY = "walk.wallet.v1", START = 30000;
const listeners = new Set<() => void>();
let state: Saved | null = null;

function load(): Saved {
  if (state) return state;
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Saved | null; if (s && s.v === 1 && Number.isFinite(s.money) && Array.isArray(s.items)) return (state = s); } catch { /* private mode */ }
  return (state = { v: 1, money: START, items: [] });
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* this visit only */ } listeners.forEach(l => l()); }

export const wallet = {
  get money() { return load().money; },
  get items(): readonly Carried[] { return load().items; },
  earn(n: number) { load().money += Math.max(0, Math.round(n)); save(); },
  /** pay for something; false (nothing taken) if there is not enough */
  spend(n: number) { const s = load(); if (s.money < n) return false; s.money -= n; save(); return true; },
  carry(item: Omit<Carried, "count">, n = 1) { const s = load(), have = s.items.find(i => i.id === item.id); if (have) have.count += n; else s.items.push({ ...item, at: item.at ?? Date.now(), count: n }); save(); },
  /** one of a carried thing used up (drunk, eaten); false if none */
  use(id: string) { const s = load(), have = s.items.find(i => i.id === id); if (!have) return false; if (--have.count <= 0) s.items.splice(s.items.indexOf(have), 1); save(); return true; },
  on(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};
export const won = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;
