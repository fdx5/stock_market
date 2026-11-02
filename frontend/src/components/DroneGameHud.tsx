import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DroneFlight } from "./droneFlight";
import { GARAGE_BIKES, GARAGE_CARS, type GarageBike, type GarageCar } from "../walkmode/game/garage";
import { wallet, won } from "../walkmode/game/wallet";
import "./drone-game.css";

/* On foot in the drone's world, played as a game: health and breath on the left, the play money
 * and the speedometer on the right, what can be done here as key prompts down the right edge, the
 * garage (N) to call up any of ~30 cars or 6 bicycles, and the knocks felt — the screen shakes,
 * a red flash, the car's damage. Nothing in the middle of the screen. */

export default function DroneGameHud({ flight, touch }: { flight: DroneFlight; touch: boolean }) {
  const [, tick] = useState(0);
  const [money, setMoney] = useState(wallet.money);
  const [gains, setGains] = useState<{ id: number; text: string }[]>([]);
  const [garage, setGarage] = useState<null | "car" | "bike">(null);
  const [flash, setFlash] = useState<{ n: number; k: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** going in through an entrance: its name over the picture as it fades out */
  const [entering, setEntering] = useState<{ label: string; after: number; cut?: boolean } | null>(null);
  const health = useRef(100), damage = useRef(0), hurtAt = useRef(0), seq = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  // (redrawn ten times a second: the bars and the speed; health back by 4 a second after a while)
  useEffect(() => {
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now(), dt = (now - last) / 1000; last = now;
      if (now - hurtAt.current > 4000) health.current = Math.min(100, health.current + 4 * dt);
      if (!flight.car) damage.current = 0;
      tick(t => t + 1);
    }, 100);
    return () => window.clearInterval(id);
  }, [flight]);
  useEffect(() => wallet.on(() => setMoney(wallet.money)), []);
  useEffect(() => {
    const got = (e: Event) => {
      const n = (e as CustomEvent<{ amount: number }>).detail?.amount ?? 0, id = ++seq.current;
      setGains(g => [...g.slice(-3), { id, text: `+${won(n)}` }]);
      window.setTimeout(() => setGains(g => g.filter(x => x.id !== id)), 1600);
    };
    const hit = (e: Event) => {
      const d = (e as CustomEvent<{ level: number; car: boolean }>).detail; if (!d) return;
      hurtAt.current = performance.now();
      if (d.car) {
        damage.current = Math.min(100, damage.current + d.level * 38);
        if (damage.current >= 100) { setToast("차량이 크게 파손되었습니다 · 차에서 내립니다"); window.dispatchEvent(new Event("drone-car-toggle")); damage.current = 0; window.setTimeout(() => setToast(null), 2600); }
      } else health.current = Math.max(5, health.current - d.level * 45);
      setFlash({ n: seq.current++, k: d.level });
      // (the whole picture shaken a moment: the stage the 3D canvas is in)
      const stage = root.current?.closest(".re-holo-stage") as HTMLElement | null ?? root.current?.parentElement?.parentElement ?? null;
      if (stage) { stage.classList.remove("is-crash-shake"); void stage.offsetWidth; stage.style.setProperty("--crash-k", String(0.4 + d.level)); stage.classList.add("is-crash-shake"); window.setTimeout(() => stage.classList.remove("is-crash-shake"), 450); }
    };
    const inside = (e: Event) => { const d = (e as CustomEvent<{ label: string; after: number; cut?: boolean }>).detail; if (d) setEntering(d); };
    window.addEventListener("drone-pickup", got); window.addEventListener("drone-crash", hit); window.addEventListener("drone-entering", inside);
    return () => { window.removeEventListener("drone-pickup", got); window.removeEventListener("drone-crash", hit); window.removeEventListener("drone-entering", inside); };
  }, []);
  // N: the garage; Esc closes it first
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null; if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.code === "KeyN" && !e.repeat && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopImmediatePropagation(); flight.keys.clear(); setGarage(g => g ? null : "car"); }
      else if (e.key === "Escape" && garage) { e.preventDefault(); e.stopImmediatePropagation(); setGarage(null); }
    };
    const close = () => setGarage(null);
    window.addEventListener("keydown", key, true); window.addEventListener("drone-garage-close", close);
    return () => { window.removeEventListener("keydown", key, true); window.removeEventListener("drone-garage-close", close); };
  }, [flight, garage]);
  const pickCar = (m: GarageCar) => { setGarage(null); window.dispatchEvent(new CustomEvent("drone-garage-car", { detail: m })); };
  const pickBike = (m: GarageBike) => { setGarage(null); window.dispatchEvent(new CustomEvent("drone-garage-bike", { detail: m })); };

  const f = flight, kmh = f.car ? Math.abs(f.carSpeed) * 3.6 : f.cycling ? f.bikeSpeed * 3.6 : Math.hypot(f.vel.x, f.vel.z) * 3.6;
  const top = f.car ? f.car.top * 3.6 : f.cycling ? f.bike.top * 3.6 : 25;
  const gear = f.car ? (f.carSpeed < -0.3 ? "R" : Math.abs(f.carSpeed) < 0.3 ? "N" : String(Math.min(6, 1 + Math.floor(Math.abs(f.carSpeed) / (f.car.top / 6))))) : "";
  const prompts: [string, string][] = [];
  if (f.door && !f.car && !f.cycling) prompts.push(["E", f.door.at ? `${f.door.label ?? "건물"}으로 들어가기` : f.door.label ? `${f.door.label}까지 길 안내 (${f.door.far ?? 0}m)` : "건물 안으로 들어가기"]);
  if (!f.car) prompts.push(["X", f.nav && f.nav.left >= 0 ? "길 안내 끄기" : "가까운 입구로 길 안내"]);
  prompts.push(["F", f.car ? "차에서 내리기" : "가까운 차 타기"]);
  if (!f.car) prompts.push(["B", f.cycling ? "자전거에서 내리기" : "자전거 타기"]);
  prompts.push(["N", "차고 · 차량·자전거 선택"]);
  if (!f.car && !f.cycling) prompts.push(["Shift", f.sprinting ? "전력 질주 중" : "달리기 (계속 누르면 질주)"], ["Space", "점프"]);
  if (f.car) prompts.push(["Space", "핸드브레이크 · 드리프트"]);
  const arc = Math.min(1, kmh / Math.max(1, top));
  return (
    <div ref={root} className={`re-game${touch ? " is-touch" : ""}`}>
      <div className="re-game-vitals" aria-label="상태">
        <div className="re-game-bar is-health" title="체력"><i style={{ width: `${health.current}%` }} /><b>체력</b></div>
        {!f.car && <div className={`re-game-bar is-stamina${f.stamina < 0.25 ? " is-low" : ""}`} title="스태미나"><i style={{ width: `${f.stamina * 100}%` }} /><b>{f.stamina < 0.02 ? "숨 고르는 중" : "스태미나"}</b></div>}
        {f.car && <div className="re-game-bar is-damage" title="차량 손상"><i style={{ width: `${100 - damage.current}%` }} /><b>차량 내구도</b></div>}
      </div>
      <div className="re-game-money" aria-live="polite"><span>{won(money)}</span><small>게임 머니</small>{gains.map(g => <em key={g.id}>{g.text}</em>)}</div>
      {(f.car || f.cycling || kmh > 1) && <div className="re-game-speedo" aria-label={`속도 ${Math.round(kmh)}km/h`}>
        <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="50" className="trk" /><circle cx="60" cy="60" r="50" className="val" style={{ strokeDasharray: `${arc * 235.6} 314.2` }} /></svg>
        <b>{Math.round(kmh)}</b><small>km/h</small>{gear && <i>{gear}</i>}
        <span className="re-game-speedo-name">{f.car ? "운전 중" : f.cycling ? "자전거" : f.sprinting ? "질주" : "걷기"}</span>
      </div>}
      {!touch && <ul className="re-game-prompts">{prompts.map(([k, t]) => <li key={k + t}><kbd>{k}</kbd>{t}</li>)}</ul>}
      {touch && <div className="re-game-touch">
        <button type="button" onPointerDown={e => { e.stopPropagation(); flight.keys.add("Space"); window.setTimeout(() => flight.keys.delete("Space"), 120); }}>{f.car ? "핸드브레이크" : "점프"}</button>
        <button type="button" onClick={() => setGarage("car")}>차고</button>
        <button type="button" onClick={() => window.dispatchEvent(new Event("drone-nav"))}>입구 안내</button>
      </div>}
      {flash && <div key={flash.n} className="re-game-flash" style={{ opacity: Math.min(0.75, 0.25 + flash.k * 0.6) }} onAnimationEnd={() => setFlash(null)} />}
      {toast && <div className="re-game-toast" role="status">{toast}</div>}
      {f.door?.at && !f.car && !f.cycling && !entering && <button type="button" className="re-game-entry" onClick={() => window.dispatchEvent(new Event("drone-enter-door"))}>
        <small>{f.door.label}</small><b>{f.door.name ?? "건물"}</b><span>{!touch && <kbd>E</kbd>} 들어가기</span>
      </button>}
      {f.nav && <div className="re-game-nav" role="status"><i aria-hidden="true">➤</i><span><b>{f.nav.label}</b><small>{f.nav.left >= 0 ? `남은 거리 ${Math.round(f.nav.left)}m · 바닥 화살표를 따라가세요` : ""}</small></span></div>}
      {entering?.cut && <div className="re-game-cut" />}
      {entering && <div className="re-game-enter" role="status" style={{ animationDelay: `${Math.max(0, entering.after + 0.05)}s` }}><b>{entering.label}</b><span>안으로 들어가는 중 · 도면으로 실내를 만드는 중</span></div>}
      {garage && createPortal(
        <div className="re-game-garage" role="dialog" aria-label="차고" onPointerDown={e => e.stopPropagation()} onClick={e => { if (e.target === e.currentTarget) setGarage(null); }}>
          <div className="re-game-garage-box">
            <header><h2>차고</h2><div role="tablist"><button role="tab" aria-selected={garage === "car"} onClick={() => setGarage("car")}>자동차 {GARAGE_CARS.length}종</button><button role="tab" aria-selected={garage === "bike"} onClick={() => setGarage("bike")}>자전거 {GARAGE_BIKES.length}종</button></div><button className="re-game-x" onClick={() => setGarage(null)} aria-label="닫기">×</button></header>
            {garage === "car" ? <div className="re-game-grid">{GARAGE_CARS.map(m => (
              <button key={m.id} className="re-game-card" onClick={() => pickCar(m)}>
                <span className="sw" style={{ background: m.paint }} /><b>{m.name}</b><small>{m.group}{m.siren ? " · 경광등" : ""}</small>
                <span className="st"><i>최고속도</i><em style={{ width: `${Math.min(100, m.top / 2.6)}%` }} /><u>{m.top}km/h</u></span>
                <span className="st"><i>가속</i><em style={{ width: `${Math.min(100, m.pull * 60)}%` }} /></span>
              </button>))}</div>
              : <div className="re-game-grid">{GARAGE_BIKES.map(m => (
                <button key={m.id} className="re-game-card" onClick={() => pickBike(m)}>
                  <span className="sw" style={{ background: m.paint }} /><b>{m.name}</b><small>{m.note}</small>
                  <span className="st"><i>최고속도</i><em style={{ width: `${Math.min(100, m.top * 3.6)}%` }} /><u>{Math.round(m.top * 3.6)}km/h</u></span>
                  <span className="st"><i>가속</i><em style={{ width: `${Math.min(100, m.accel * 20)}%` }} /></span>
                </button>))}</div>}
            <footer>선택하면 가까운 길가에 바로 준비됩니다 · <kbd>N</kbd> 열기/닫기 · <kbd>Esc</kbd> 닫기</footer>
          </div>
        </div>, document.body)}
    </div>
  );
}
