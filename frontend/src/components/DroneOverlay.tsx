import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent as RPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { DroneHud } from "./droneMode";
import { AUTO_MIN_AGL, AUTO_MAX_AGL, MAX_SPEED, type DroneFlight } from "./droneFlight";
import type { DroneSigns, Sign } from "./droneSigns";
import DroneBuildingCard from "./DroneBuildingCard";
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
  const [autoSettings, setAutoSettings] = useState(false);
  const [speedDraft, setSpeedDraft] = useState<string | null>(null);
  const [altitudeDraft, setAltitudeDraft] = useState<string | null>(null);
  const settingsDialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const dialog=settingsDialog.current;
    if(!autoSettings||!dialog)return;
    // The native top layer stays above transformed/fullscreen scene containers
    // and footer layers. Essential control styles travel with the component.
    if(typeof dialog.showModal==='function')dialog.showModal();
    else dialog.setAttribute('open','');
    return()=>{if(dialog.open)dialog.close();};
  },[autoSettings]);
  const settingInputStyle={width:80,minWidth:80,height:36,boxSizing:'border-box' as const,marginLeft:'auto',padding:'6px 8px',border:'1px solid #ffffff66',borderRadius:6,background:'#162b38',color:'#fff',fontSize:16,display:'block'};
  const settingLabelStyle={display:'flex',alignItems:'center',gap:8,minHeight:36,color:'#eaf6ff',fontSize:13};
  const updateFlight = () => setHud(h => h ? { ...h } : h);
  useEffect(() => {
    const close = () => setAutoSettings(false);
    window.addEventListener('drone-auto-settings-close', close);
    return () => window.removeEventListener('drone-auto-settings-close', close);
  }, []);
  useEffect(() => {
    sink.current = setHud;
    const t = window.setTimeout(() => setHelp(false), touch ? 6000 : 9000);
    return () => { sink.current = null; window.clearTimeout(t); };
  }, [sink]);
  // A tap on a sign (a short press that hardly moved, not on a control) opens its building's card.
  const root = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState<{ sign: Sign; at: { lat: number; lon: number }; distance: number } | null>(null);
  useEffect(() => {
    const stage = root.current?.parentElement;
    if (!stage) return;
    let down: { x: number; y: number; t: number; id: number } | null = null;
    const local = (e: PointerEvent) => { const r = (signs.canvas ?? stage).getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
    const onControl = (e: Event) => !!(e.target as HTMLElement | null)?.closest?.("button, a, input, label, .re-drone-auto-controls, .re-drone-stick, .re-drone-card, .re-drone-radar, .re-drone-tools");
    const pd = (e: PointerEvent) => { down = onControl(e) ? null : { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; };
    const pu = (e: PointerEvent) => {
      const d = down; down = null;
      if (!d || d.id !== e.pointerId || onControl(e) || performance.now() - d.t > 600 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return;
      const [x, y] = local(e);
      const s = signs.hit(x, y, e.pointerType === "touch" ? 16 : 6);
      if (!s) return;
      const o = radar.origin, kx = Math.cos((o.lat * Math.PI) / 180) * 111320;
      const p = flight.pos;
      signs.selected = s.key;
      // (looked up at its largest building — the parcel under it is the register's — else at the sign)
      const bx = s.info?.bx ?? s.x, by = s.info?.by ?? s.y;
      setCard({ sign: s, at: { lat: o.lat + by / 110540, lon: o.lon + bx / kx }, distance: Math.hypot(s.x - p.x, s.y + p.z) });
    };
    // (a mouse over a sign: the hand)
    const pm = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.buttons) return;
      const [x, y] = local(e);
      const over = !onControl(e) && !!signs.hit(x, y, 4);
      if (stage.style.cursor !== (over ? "pointer" : "")) stage.style.cursor = over ? "pointer" : "";
    };
    stage.addEventListener("pointerdown", pd, true);
    stage.addEventListener("pointerup", pu, true);
    stage.addEventListener("pointermove", pm, { passive: true });
    return () => {
      stage.removeEventListener("pointerdown", pd, true); stage.removeEventListener("pointerup", pu, true);
      stage.removeEventListener("pointermove", pm); stage.style.cursor = "";
    };
  }, [signs, flight, radar.origin]);
  const closeCard = () => { signs.selected = null; setCard(null); };
  useEffect(() => {
    const close = () => { signs.selected = null; setCard(null); };
    window.addEventListener("drone-card-close", close);
    return () => { window.removeEventListener("drone-card-close", close); signs.selected = null; };
  }, [signs]);
  const h = hud;
  const auto = flight.autopilot;
  const autoStatus = flight.autopilotStatus === 'obstacle' ? '장애물 앞 대기 · 방향을 바꿔주세요'
    : flight.autopilotStatus === 'altitude' ? `자동 고도 조절 중 · 목표 ${Math.round(flight.autoCruiseAgl)}m`
    : `${Math.round(flight.autoCruiseSpeed * 3.6)}km/h 항속 · 목표 ${Math.round(flight.autoCruiseAgl)}m`;
  const dir = h ? COMPASS[Math.round(h.heading / 45) % 8] : "";
  return (
    <div ref={root} className="re-drone" aria-live="off">
      <canvas className="re-drone-signs" aria-hidden="true" ref={el => { signs.canvas = el; }} />
      <div className="re-drone-hud" role="status" data-autopilot={auto ? flight.autopilotStatus : 'off'} data-agl={h?.agl.toFixed(1) ?? ''} data-ahead={h ? Math.round(Math.min(h.ahead, 9999)) : ""} data-unready={h ? Math.round(h.unready) : ""} data-front={h ? Math.round(h.unreadyFront) : ""} data-kmh={h ? h.kmh.toFixed(1) : ""}>
        <b className="re-drone-speed">{h ? Math.round(h.kmh) : 0}<small>km/h</small></b>
        <span className="re-drone-alt">고도 <b>{h ? Math.round(h.agl) : 0}</b>m</span>
        <span className="re-drone-dir">{dir} {h ? Math.round(h.heading) : 0}°</span>
        <span className={`re-drone-world${h?.limited ? " is-held" : ""}`} title="드론 주변 타일(340m) 중 화면에 모두 그려진 수 / 필요한 수">
          {h ? (h.limited ? `앞쪽 렌더링 대기 · 최고 ${Math.round(h.limit)}km/h` : `주변 ${(h.radius / 1000).toFixed(1)}km 렌더링 ${h.ready}/${h.tiles}`) : "준비 중"}
        </span>
      </div>
      <div className="re-drone-auto-controls">
      <button type="button" className={`re-drone-autopilot${auto ? ' is-on' : ''}`} aria-pressed={auto}
        title="설정한 속도와 고도로 시선 방향 자동 전진 · 10~1,000m 지형·건물 회피 · 이동/고도 조작 시 수동 전환"
        onClick={() => { flight.toggleAutopilot(); setHud(h => h ? { ...h, autopilot: flight.autopilot, autopilotStatus: flight.autopilotStatus } : h); }}>
        <b>{auto ? '⏸ 오토 파일럿 켜짐' : '▶ 오토 파일럿'}</b>
        <small>{auto ? autoStatus : `${Math.round(flight.autoCruiseSpeed * 3.6)}km/h · 고도 10~1,000m`}</small>
      </button>
      <button type="button" className="re-drone-auto-settings-toggle" aria-expanded={autoSettings} aria-controls="drone-auto-settings"
        onClick={() => setAutoSettings(v => !v)}>속도·고도 설정</button>
      {autoSettings && createPortal(<dialog ref={settingsDialog} data-covers-page className="re-drone-auto-settings" id="drone-auto-settings" aria-label="오토파일럿 설정"
        style={{position:'fixed',inset:'50% auto auto 50%',transform:'translate(-50%, -50%)',margin:0,width:304,maxWidth:'calc(100vw - 24px)',maxHeight:'calc(100vh - 24px)',overflowY:'auto',boxSizing:'border-box',display:'grid',gap:12,padding:16,border:'1px solid #7fd8ff88',borderRadius:12,background:'#07131c',color:'#eaf6ff',fontFamily:'sans-serif',visibility:'visible',opacity:1}}
        onCancel={e=>{e.preventDefault();setAutoSettings(false);}} onPointerDown={e => e.stopPropagation()}>
        <strong style={{display:'block',fontSize:15,color:'#fff'}}>오토파일럿 속도·고도 설정</strong>
        <label style={settingLabelStyle}>속도 <input style={settingInputStyle} aria-label="오토파일럿 속도" type="number" min={0} max={MAX_SPEED * 3.6} step={1}
          value={speedDraft ?? Math.round(flight.autoCruiseSpeed * 3.6)} onFocus={e => setSpeedDraft(e.target.value)}
          onChange={e => {setSpeedDraft(e.target.value);if(e.target.value!==''&&e.target.validity.valid)flight.setAutoSpeed(e.target.valueAsNumber);updateFlight();}}
          onBlur={e => {if(e.target.value!=='')flight.setAutoSpeed(e.target.valueAsNumber);setSpeedDraft(null);updateFlight();}}
          onKeyDown={e => {if(e.key==='Enter')e.currentTarget.blur();}} /> km/h</label>
        <input style={{display:'block',width:'100%',height:24,margin:0,accentColor:'#82d4ff'}} aria-label="오토파일럿 속도 슬라이더" type="range" min={0} max={MAX_SPEED * 3.6} step={1}
          value={Math.round(flight.autoCruiseSpeed * 3.6)} onChange={e => {flight.setAutoSpeed(e.target.valueAsNumber);updateFlight();}} />
        <label style={settingLabelStyle}>목표 고도 <input style={settingInputStyle} aria-label="오토파일럿 목표 고도" type="number" min={AUTO_MIN_AGL} max={AUTO_MAX_AGL} step={1}
          value={altitudeDraft ?? Math.round(flight.autoCruiseAgl)} onFocus={e => setAltitudeDraft(e.target.value)}
          onChange={e => {setAltitudeDraft(e.target.value);if(e.target.value!==''&&e.target.validity.valid)flight.setAutoAltitude(e.target.valueAsNumber);updateFlight();}}
          onBlur={e => {if(e.target.value!=='')flight.setAutoAltitude(e.target.valueAsNumber);setAltitudeDraft(null);updateFlight();}}
          onKeyDown={e => {if(e.key==='Enter')e.currentTarget.blur();}} /> m</label>
        <input style={{display:'block',width:'100%',height:24,margin:0,accentColor:'#82d4ff'}} aria-label="오토파일럿 고도 슬라이더" type="range" min={AUTO_MIN_AGL} max={AUTO_MAX_AGL} step={1}
          value={Math.round(flight.autoCruiseAgl)} onChange={e => {flight.setAutoAltitude(e.target.valueAsNumber);updateFlight();}} />
        <small style={{display:'block',fontSize:11,color:'#aacada'}}>속도 0~200km/h · 지면 기준 10~1,000m<br/>장애물에 따라 상승·대기</small>
        <button style={{display:'block',width:'100%',minHeight:36,padding:8,border:'1px solid #7fd8ff88',borderRadius:6,background:'#16384a',color:'#fff',fontSize:14,cursor:'pointer'}} type="button" onClick={() => setAutoSettings(false)}>설정 완료</button>
      </dialog>, document.body)}
      </div>
      <div className="re-drone-tools">
        <button type="button" className="re-drone-view" onClick={onView} title="1인칭 ↔ 3인칭 (V)"><i className="re-drone-view-icon" aria-hidden="true">🚁</i><span>{view === "fpv" ? "1인칭" : "3인칭"}</span></button>
        <button type="button" onClick={() => { const m = !muted; setMuted(m); onMute(m); }} aria-pressed={muted} title={muted ? "드론 소리 켜기" : "드론 소리 끄기"} className="re-drone-mute">{muted ? "🔇 음소거" : "🔊 소리"}</button>
        <button type="button" onClick={() => setHelp(v => !v)} aria-pressed={help} title="조작법">?</button>
        <button type="button" className="re-drone-exit" onClick={onExit} title="드론에서 나가기 (Esc)">착륙</button>
      </div>
      <DroneRadar vkey={radar.vkey} domain={radar.domain} origin={radar.origin} where={radar.where} signs={signs} />
      {help && <div className="re-drone-help" role="note">
        {touch
          ? <><b>왼쪽 스틱</b> ↕ 상승·하강 ↔ 회전<br /><b>오른쪽 스틱</b> ↕ 전진·후진 ↔ 좌우 이동<br />화면 드래그: 카메라 각도 · <b>빛나는 팻말</b>을 누르면 건물 정보</>
          : <><b>W S</b> 전진·후진 · <b>A D</b> 좌우 이동 · <b>Q E</b>·<b>← →</b> 회전 · <b>Space</b>/<b>R</b>/<b>PgUp</b>/휠↑ 상승 · <b>Shift</b>/<b>F</b>/<b>PgDn</b>/휠↓ 하강 · <b>V</b> 1인칭/3인칭 · 드래그: 카메라 각도 · <b>Esc</b> 착륙 · <b>빛나는 팻말</b> 클릭: 건물 정보</>}
        <span>최고 200km/h · 지면·건물 위 2m 이상 · 수동 고도 상한 없음</span>
        <span>오토 파일럿: 속도 0~200km/h · 목표 고도 10~1,000m 설정 · 시선 방향 전진 · 이동·고도 조작 시 수동 전환</span>
      </div>}
      <div className="re-drone-alt-buttons" aria-label="고도 조절">
        {([["BtnUp", "▲", "상승 (누르고 있기)"], ["BtnDown", "▼", "하강 (누르고 있기)"]] as const).map(([code, label, title]) => (
          <button key={code} type="button" title={title} aria-label={title}
            onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); flight.keys.add(code); }}
            onPointerUp={e => { e.stopPropagation(); flight.keys.delete(code); }} onPointerCancel={() => flight.keys.delete(code)}
            onLostPointerCapture={() => flight.keys.delete(code)} onContextMenu={e => e.preventDefault()}>
            <svg className="re-drone-alt-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d={label === '▲' ? 'M5 16L12 8L19 16Z' : 'M5 8L12 16L19 8Z'} /></svg>
          </button>
        ))}
        <button type="button" className={`re-drone-rotate${flight.autoRotate?' is-on':''}`} aria-pressed={flight.autoRotate}
          aria-label={flight.autoRotate?'제자리 자동 회전 정지':'제자리 자동 회전 시작'}
          title={flight.autoRotate?'자동 회전 정지':'제자리에서 천천히 360도 반복 회전 · 조작하면 정지'}
          onPointerDown={e=>e.stopPropagation()}
          onClick={e=>{e.stopPropagation();flight.toggleAutoRotate();setHud(h=>h?{...h,autoRotate:flight.autoRotate,autopilot:flight.autopilot}:h);e.currentTarget.blur();}}>
          <svg viewBox="0 0 24 24" className="re-drone-rotate-icon" aria-hidden="true"><path d="M19 9a7.5 7.5 0 1 0 .2 5M19 4v5h-5" /></svg>
          <span>회전</span>
        </button>
      </div>
      {card && <DroneBuildingCard sign={card.sign} at={card.at} distance={card.distance} vkey={radar.vkey} domain={radar.domain} onClose={closeCard} />}
      {touch && <>
        <Stick side="left" flight={flight} label={["상승·하강", "회전"]} />
        <Stick side="right" flight={flight} label={["전진·후진", "좌우 이동"]} />
      </>}
    </div>
  );
}
