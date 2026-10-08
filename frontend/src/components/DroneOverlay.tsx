import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent as RPointerEvent } from "react";
import type { DroneHud } from "./droneMode";
import type { DroneFlight } from "./droneFlight";
import type { DroneSigns } from "./droneSigns";
import DroneRadar, { type DroneWhere } from "./DroneRadar";

/* 드론 mode's screen: speed, height, heading, how much of the world round it is drawn (and when
 * the drone is held back for it), sound on/off, leave; on touch screens two sticks (mode 2: the
 * left climbs and turns, the right flies forward / back and sideways). Re-renders on its own (the
 * flight reports ~8 times a second): the 3D view around it is not re-rendered. */

const COMPASS = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];

function Stick({ side, flight, label }: { side: "left" | "right"; flight: DroneFlight; label: [string, string] }) {
  const pad = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState<[number, number]>([0, 0]);
  const active = useRef<number | null>(null);
  const set = (x: number, y: number) => {
    setKnob([x, y]);
    // (a little dead zone round the centre; y up is +1)
    const dz = (v: number) => (Math.abs(v) < 0.08 ? 0 : v);
    flight.sticks[side] = [dz(x), dz(-y)];
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (active.current !== e.pointerId || !pad.current) return;
    const r = pad.current.getBoundingClientRect(), R = r.width / 2;
    let x = (e.clientX - r.left - R) / R, y = (e.clientY - r.top - R) / R;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    set(x, y);
  };
  const end = (e: RPointerEvent<HTMLDivElement>) => {
    if (active.current !== e.pointerId) return;
    active.current = null;
    set(0, 0);
  };
  useEffect(() => () => { flight.sticks[side] = [0, 0]; }, [flight, side]);
  return (
    <div ref={pad} className={`re-drone-stick is-${side}`} aria-label={`${label[0]} · ${label[1]}`} role="application"
      onPointerDown={e => { e.stopPropagation(); active.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); move(e); }}
      onPointerMove={e => { e.stopPropagation(); move(e); }} onPointerUp={e => { e.stopPropagation(); end(e); }} onPointerCancel={end}>
      <span className="re-drone-stick-label is-v">{label[0]}</span>
      <span className="re-drone-stick-label is-h">{label[1]}</span>
      <i style={{ transform: `translate(${knob[0] * 50}%, ${knob[1] * 50}%)` }} />
    </div>
  );
}

export default function DroneOverlay({ sink, flight, signs, radar, touch, onExit, onMute, view, onView }: {
  view: "fpv" | "chase"; onView: () => void;
  sink: MutableRefObject<((h: DroneHud) => void) | null>; flight: DroneFlight; signs: DroneSigns; touch: boolean;
  radar: { vkey: string; domain: string; origin: { lat: number; lon: number }; where: () => DroneWhere | null };
  onExit: () => void; onMute: (muted: boolean) => void;
}) {
  const [hud, setHud] = useState<DroneHud | null>(null);
  const [muted, setMuted] = useState(false);
  const [help, setHelp] = useState(true);
  useEffect(() => {
    sink.current = setHud;
    const t = window.setTimeout(() => setHelp(false), 9000);
    return () => { sink.current = null; window.clearTimeout(t); };
  }, [sink]);
  const h = hud;
  const dir = h ? COMPASS[Math.round(h.heading / 45) % 8] : "";
  return (
    <div className="re-drone" aria-live="off">
      <canvas className="re-drone-signs" aria-hidden="true" ref={el => { signs.canvas = el; }} />
      <div className="re-drone-hud" role="status" data-ahead={h ? Math.round(Math.min(h.ahead, 9999)) : ""} data-unready={h ? Math.round(h.unready) : ""} data-front={h ? Math.round(h.unreadyFront) : ""} data-kmh={h ? h.kmh.toFixed(1) : ""}>
        <b className="re-drone-speed">{h ? Math.round(h.kmh) : 0}<small>km/h</small></b>
        <span className="re-drone-alt">고도 <b>{h ? Math.round(h.agl) : 0}</b>m</span>
        <span className="re-drone-dir">{dir} {h ? Math.round(h.heading) : 0}°</span>
        <span className={`re-drone-world${h?.limited ? " is-held" : ""}`} title="드론 주변 타일(340m) 중 화면에 모두 그려진 수 / 필요한 수">
          {h ? (h.limited ? `앞쪽 렌더링 대기 · 최고 ${Math.round(h.limit)}km/h` : `주변 ${(h.radius / 1000).toFixed(1)}km 렌더링 ${h.ready}/${h.tiles}`) : "준비 중"}
        </span>
      </div>
      <div className="re-drone-tools">
        <button type="button" onClick={onView} title="1인칭 ↔ 3인칭 (V)">{view === "fpv" ? "🎥 1인칭" : "🚁 3인칭"}</button>
        <button type="button" onClick={() => { const m = !muted; setMuted(m); onMute(m); }} aria-pressed={muted} title={muted ? "드론 소리 켜기" : "드론 소리 끄기"}>{muted ? "🔇" : "🔊"}</button>
        <button type="button" onClick={() => setHelp(v => !v)} aria-pressed={help} title="조작법">?</button>
        <button type="button" className="re-drone-exit" onClick={onExit} title="드론에서 나가기 (Esc)">착륙</button>
      </div>
      <DroneRadar vkey={radar.vkey} domain={radar.domain} origin={radar.origin} where={radar.where} signs={signs} />
      {help && <div className="re-drone-help" role="note">
        {touch
          ? <><b>왼쪽 스틱</b> 상승·하강 / 좌우 회전 · <b>오른쪽 스틱</b> 전진·후진 / 좌우 이동 · 화면 드래그: 카메라 각도</>
          : <><b>W S</b> 전진·후진 · <b>A D</b> 좌우 이동 · <b>Q E</b>·<b>← →</b> 회전 · <b>Space</b>/<b>R</b>/<b>PgUp</b>/휠↑ 상승 · <b>Shift</b>/<b>F</b>/<b>PgDn</b>/휠↓ 하강 · <b>V</b> 1인칭/3인칭 · 드래그: 카메라 각도 · <b>Esc</b> 착륙</>}
        <span>최고 200km/h · 지면 2m ~ 상공 500m</span>
      </div>}
      <div className="re-drone-alt-buttons" aria-label="고도 조절">
        {([["BtnUp", "▲", "상승 (누르고 있기)"], ["BtnDown", "▼", "하강 (누르고 있기)"]] as const).map(([code, label, title]) => (
          <button key={code} type="button" title={title} aria-label={title}
            onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); flight.keys.add(code); }}
            onPointerUp={e => { e.stopPropagation(); flight.keys.delete(code); }} onPointerCancel={() => flight.keys.delete(code)}
            onLostPointerCapture={() => flight.keys.delete(code)} onContextMenu={e => e.preventDefault()}>{label}</button>
        ))}
      </div>
      {touch && <>
        <Stick side="left" flight={flight} label={["상승·하강", "회전"]} />
        <Stick side="right" flight={flight} label={["전진·후진", "좌우 이동"]} />
      </>}
    </div>
  );
}
