import { wallet } from "./wallet";

/* 오늘의 미션: five a day, drawn from the pool by the date (the same five for the day wherever one
 * plays, in the street or inside), each counted from what the walker does — coins picked up, a car
 * driven fast, a meal cooked, a shop's goods bought, people talked to, buildings gone into. Done:
 * play money and experience; enough experience, the next 탐험 레벨. Kept in this browser. */

export type MissionKind = "coin" | "speed" | "garage" | "jump" | "walk" | "enter" | "buy" | "drink" | "eat" | "cook" | "talk" | "social" | "gift" | "guide" | "crash" | "bike";
export interface MissionDef { id: string; kind: MissionKind; goal: number; title: string; reward: number; xp: number }
export interface MissionState { def: MissionDef; progress: number; done: boolean }

const POOL: MissionDef[] = [
  { id: "coin10", kind: "coin", goal: 10, title: "거리의 코인 10개 줍기", reward: 5000, xp: 40 },
  { id: "coin25", kind: "coin", goal: 25, title: "거리의 코인 25개 줍기", reward: 15000, xp: 90 },
  { id: "speed120", kind: "speed", goal: 120, title: "자동차로 시속 120km 달성", reward: 8000, xp: 50 },
  { id: "speed180", kind: "speed", goal: 180, title: "자동차로 시속 180km 달성", reward: 20000, xp: 110 },
  { id: "garage3", kind: "garage", goal: 3, title: "차고에서 차량 3대 꺼내 타기", reward: 6000, xp: 40 },
  { id: "jump10", kind: "jump", goal: 10, title: "점프 10번 하기", reward: 3000, xp: 25 },
  { id: "walk500", kind: "walk", goal: 500, title: "걸어서 500m 탐험하기", reward: 5000, xp: 40 },
  { id: "walk1500", kind: "walk", goal: 1500, title: "걸어서 1.5km 탐험하기", reward: 15000, xp: 100 },
  { id: "enter2", kind: "enter", goal: 2, title: "건물 2곳 정문으로 들어가기", reward: 8000, xp: 60 },
  { id: "buy3", kind: "buy", goal: 3, title: "상점에서 물건 3개 사기", reward: 5000, xp: 40 },
  { id: "drink3", kind: "drink", goal: 3, title: "음료 3잔 마시기 (캬~)", reward: 4000, xp: 30 },
  { id: "eat2", kind: "eat", goal: 2, title: "음식 2번 먹기", reward: 4000, xp: 30 },
  { id: "cook2", kind: "cook", goal: 2, title: "인덕션에서 요리 2번 하기", reward: 7000, xp: 50 },
  { id: "talk5", kind: "talk", goal: 5, title: "사람들과 5번 대화하기", reward: 5000, xp: 40 },
  { id: "social6", kind: "social", goal: 6, title: "농담·칭찬 등 교류 6번 하기", reward: 8000, xp: 60 },
  { id: "gift1", kind: "gift", goal: 1, title: "누군가에게 선물 건네기", reward: 6000, xp: 50 },
  { id: "guide2", kind: "guide", goal: 2, title: "길 안내 따라 목적지 2곳 도착", reward: 6000, xp: 50 },
  { id: "bike1000", kind: "bike", goal: 1000, title: "자전거로 1km 달리기", reward: 8000, xp: 60 },
];
const KEY = "walk.missions.v1";
interface Saved { day: string; progress: Record<string, number>; done: string[]; xp: number }
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
let saved: Saved | null = null;
function load(): Saved {
  if (saved && saved.day === today()) return saved;
  let s: Saved | null = null;
  try { s = JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { /* private mode */ }
  const xp = s?.xp ?? 0;
  if (!s || s.day !== today()) s = { day: today(), progress: {}, done: [], xp };
  return (saved = s);
}
function store() { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* this visit only */ } listeners.forEach(l => l()); }
const listeners = new Set<() => void>();

/** today's five, the same all day: drawn from the pool by the date */
export function todays(): MissionState[] {
  const s = load(); let h = 0; for (const c of s.day) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const pool = POOL.slice(), out: MissionDef[] = [];
  const kinds = new Set<MissionKind>();
  while (out.length < 5 && pool.length) { h = (h * 1103515245 + 12345) >>> 0; const d = pool.splice(h % pool.length, 1)[0]; if (kinds.has(d.kind)) continue; kinds.add(d.kind); out.push(d); }
  return out.map(def => ({ def, progress: Math.min(def.goal, s.progress[def.id] ?? 0), done: s.done.includes(def.id) }));
}
/** level from experience: each level needs 100 more than the last */
export function level(xp = load().xp) { let lv = 1, need = 120; while (xp >= need) { xp -= need; lv++; need += 100; } return { lv, into: xp, need }; }
export const missions = {
  get xp() { return load().xp; },
  on(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  /** something done: `amount` more of `kind` (or, for speed, the speed reached) */
  event(kind: MissionKind, amount = 1) {
    const s = load(); let changed = false;
    for (const m of todays()) {
      if (m.def.kind !== kind || m.done) continue;
      const was = s.progress[m.def.id] ?? 0, now = kind === "speed" ? Math.max(was, amount) : was + amount;
      if (Math.floor(now) === Math.floor(was) && kind !== "speed") { s.progress[m.def.id] = now; continue; }
      s.progress[m.def.id] = now; changed = true;
      if (now >= m.def.goal) {
        const before = level(s.xp).lv;
        s.done.push(m.def.id); s.xp += m.def.xp; wallet.earn(m.def.reward);
        const after = level(s.xp).lv;
        window.dispatchEvent(new CustomEvent("mission-complete", { detail: { title: m.def.title, reward: m.def.reward, xp: m.def.xp, levelUp: after > before ? after : 0 } }));
      }
    }
    if (changed) store(); else saved = s;
  },
};
