import { useEffect, useState } from "react";
import { level, missions, todays } from "./game/missions";
import { won } from "./game/wallet";
import "./missionHud.css";

/* 오늘의 미션 at the edge of the screen (J folds it), the 탐험 레벨 with its bar, and when one is done
 * a banner with a fanfare — and LEVEL UP when it brings one. Shared by the street and the inside. */

let audio: AudioContext | null = null;
function fanfare(big: boolean) {
  try {
    audio ??= new AudioContext(); if (audio.state === "suspended") void audio.resume();
    const c = audio, t0 = c.currentTime, notes = big ? [523, 659, 784, 1047, 784, 1047] : [659, 784, 1047];
    notes.forEach((f, i) => {
      const t = t0 + i * (big ? 0.11 : 0.09), o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
      o.type = "triangle"; o.frequency.value = f; o2.type = "sine"; o2.frequency.value = f * 2;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + (i === notes.length - 1 ? 0.7 : 0.22));
      o.connect(g); o2.connect(g); g.connect(c.destination); o.start(t); o2.start(t); o.stop(t + 0.8); o2.stop(t + 0.8);
    });
  } catch { /* no sound */ }
}

export default function MissionHud({ className = "", folded = false }: { className?: string; /** start folded to its head line (the street, where the edge is busy) */ folded?: boolean }) {
  const store = `walk.missions.open${folded ? ".street" : ""}`;
  const [, tick] = useState(0);
  const [open, setOpen] = useState(() => { try { const v = localStorage.getItem(store); return v === null ? !folded : v === "1"; } catch { return !folded; } });
  const [banner, setBanner] = useState<{ n: number; title: string; reward: number; xp: number; levelUp: number } | null>(null);
  useEffect(() => missions.on(() => tick(t => t + 1)), []);
  useEffect(() => {
    let n = 0;
    const done = (e: Event) => { const d = (e as CustomEvent<{ title: string; reward: number; xp: number; levelUp: number }>).detail; if (!d) return; fanfare(!!d.levelUp); setBanner({ n: ++n, ...d }); window.setTimeout(() => setBanner(b => b?.n === n ? null : b), d.levelUp ? 4200 : 3200); };
    const key = (e: KeyboardEvent) => { const el = e.target as HTMLElement | null; if (el?.closest("input, textarea, [contenteditable=true]")) return; if (e.code === "KeyJ" && !e.repeat) setOpen(o => { try { localStorage.setItem(store, o ? "0" : "1"); } catch { /* */ } return !o; }); };
    window.addEventListener("mission-complete", done); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("mission-complete", done); window.removeEventListener("keydown", key); };
  }, [store]);
  const list = todays(), lv = level(missions.xp), left = list.filter(m => !m.done).length;
  return (
    <>
      <div className={`wk-missions${open ? "" : " is-folded"} ${className}`} onPointerDown={e => e.stopPropagation()}>
        <button type="button" className="wk-missions-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <b>LV {lv.lv}</b><span className="wk-missions-xp"><i style={{ width: `${lv.into / lv.need * 100}%` }} /></span><small>오늘의 미션 {list.length - left}/{list.length} <kbd>J</kbd></small>
        </button>
        {open && <ul>{list.map(m => <li key={m.def.id} className={m.done ? "is-done" : ""}>
          <span>{m.done ? "✔" : "◇"} {m.def.title}</span>
          {!m.done && <em><i style={{ width: `${m.progress / m.def.goal * 100}%` }} /></em>}
          <small>{m.done ? "완료" : `${Math.floor(m.progress)}/${m.def.goal}`} · {won(m.def.reward)}</small>
        </li>)}</ul>}
      </div>
      {banner && <div key={banner.n} className={`wk-mission-banner${banner.levelUp ? " is-level" : ""}`} role="status">
        {banner.levelUp ? <><small>LEVEL UP</small><b>탐험 레벨 {banner.levelUp}</b><span>{banner.title} 완료 · {won(banner.reward)} · +{banner.xp} XP</span></>
          : <><small>MISSION COMPLETE</small><b>{banner.title}</b><span>보상 {won(banner.reward)} · +{banner.xp} XP</span></>}
      </div>}
    </>
  );
}
