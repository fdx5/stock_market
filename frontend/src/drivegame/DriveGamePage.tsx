import { useEffect, useRef, useState } from "react";
import { complexHref } from "./world/complexAt";
import { api, type DriveBoard } from "../api/client";
import { Game, type TimeOfDay } from "./game/Game";
import { Session, goldTotal, type UiState } from "./game/Session";
import type { VehicleName } from "./vehicle/physics";
import { geocodeParcel } from "./world/geocode";
import "./drivegame.css";

/* /drive — the delivery driving game, a service of its own (it shares nothing at run time with
 * the 3D building view). Opened with ?id=<complex> (where it starts; the VWorld key comes with the
 * complex's data) or ?lat=&lon=, &v=cyber|coupang, &t=day|sunset|night. */

interface Start { lat: number; lon: number; name: string; key: string; domain: string }
const PLAYER_KEY = "kospimap.drive.player", NAME_KEY = "kospimap.drive.name";
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } } };
const playerId = () => { let id = store.get(PLAYER_KEY); if (!id) { id = crypto.randomUUID?.() ?? String(Math.random()).slice(2); store.set(PLAYER_KEY, id); } return id; };

export default function DriveGamePage() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null), sessionRef = useRef<Session | null>(null);
  const q = new URLSearchParams(location.search);
  const [vehicle, setVehicle] = useState<VehicleName>(q.get("v") === "coupang" ? "coupang" : "cyber");
  const [time, setTime] = useState<TimeOfDay>(q.get("t") === "night" ? "night" : q.get("t") === "sunset" ? "sunset" : "day");
  const [start, setStart] = useState<Start | null>(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"menu" | "loading" | "drive">(q.get("auto") === "1" ? "loading" : "menu");
  const [progress, setProgress] = useState({ text: "", k: 0 });
  const [ui, setUi] = useState<UiState | null>(null);
  const [paused, setPaused] = useState(false);
  const [view, setView] = useState<"chase" | "cockpit">("chase");
  const [touch, setTouch] = useState(() => matchMedia?.("(pointer: coarse)").matches ?? false);
  const [board, setBoard] = useState<null | { data: DriveBoard | null; error: string | null }>(null);
  const [nick, setNick] = useState(() => store.get(NAME_KEY) ?? "");
  const [ending, setEnding] = useState(false);
  const speedEl = useRef<HTMLSpanElement>(null), gearEl = useRef<HTMLSpanElement>(null), revsEl = useRef<HTMLDivElement>(null), dbgEl = useRef<HTMLPreElement>(null);
  const hud = { dist: useRef<HTMLElement>(null), time: useRef<HTMLElement>(null), turn: useRef<HTMLElement>(null), turnDist: useRef<HTMLElement>(null), map: useRef<HTMLCanvasElement>(null), fx: useRef<HTMLDivElement>(null), flash: useRef<HTMLDivElement>(null), fuelText: useRef<HTMLElement>(null) };
  const debug = import.meta.env.DEV || q.get("debug") === "1";

  // where to start, and the map key
  useEffect(() => {
    const id = q.get("id"), lat = parseFloat(q.get("lat") ?? ""), lon = parseFloat(q.get("lon") ?? "");
    if (!id) { setError("시작할 단지가 지정되지 않았습니다."); return; }
    api.realEstateBuildings(id, undefined, true).then(async r => {
      const domain = r.vworld_domain ?? "https://kospimap.com";
      if (!r.vworld_key) { setError("지도 자료를 불러올 수 없습니다."); return; }
      let at = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : r.center ?? null;
      // (a complex the server has no coordinates for yet: its parcel address, geocoded here)
      if (!at && r.query?.parcel) at = await geocodeParcel(r.query.parcel, r.vworld_key, domain);
      if (!at) { setError("출발 위치를 찾지 못했습니다."); return; }
      setStart({ lat: at.lat, lon: at.lon, name: r.name, key: r.vworld_key, domain });
    }).catch(() => setError("단지 정보를 불러오지 못했습니다."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase === "menu" || !start || !canvas.current) return;
    const cv = canvas.current;
    let session: Session | null = null;
    const game = new Game({
      canvas: cv, lat: start.lat, lon: start.lon, key: start.key, domain: start.domain, apiBase: `${location.origin}/api`,
      vehicle, time, quality: (navigator.hardwareConcurrency ?? 8) >= 6 ? "high" : "standard",
      onProgress: (text, k) => setProgress({ text, k }),
      onAction: a => {
        const s = sessionRef.current;
        if (a === "pause") { const p = !game.paused; game.paused = p; setPaused(p); }
        else if (a === "view") setView(game.view);
        else if (a === "horn") s?.horn();
        else if (a === "voice") s?.toggleVoice();
        else if (a === "reset") s?.toRoad();
        s?.audio.resume();
      },
    });
    gameRef.current = game;
    if (debug) Object.assign(window, { __driveGame: game });
    const fit = () => game.resize(cv.clientWidth, cv.clientHeight);
    fit();
    const ro = new ResizeObserver(fit); ro.observe(cv);
    let dbgAt = 0;
    game.onFrame = f => {
      const kmh = String(Math.round(Math.abs(f.speed) * 3.6));
      if (speedEl.current && speedEl.current.textContent !== kmh) speedEl.current.textContent = kmh;
      if (gearEl.current && gearEl.current.textContent !== f.gear) gearEl.current.textContent = f.gear;
      if (revsEl.current) revsEl.current.style.transform = `scaleX(${f.revs.toFixed(3)})`;
      const now = performance.now();
      if (debug && dbgEl.current && now - dbgAt > 500) {
        dbgAt = now;
        const w = game.world.stats, p = game.perf;
        dbgEl.current.textContent = `fps ${(1000 / Math.max(1, p.sum / Math.max(1, p.frames))).toFixed(0)} worst ${p.worst.toFixed(0)}ms >33:${p.over33}\ncpu ${p.cpuMs.toFixed(1)} render ${p.renderMs.toFixed(1)} calls ${game.renderer.info.render.calls}\ntiles ${game.world.tiles.size} shown ${w.shown} q ${game.world.backlog} build ${(w.buildMs / Math.max(1, w.built)).toFixed(0)}ms\ncars ${game.traffic.stats.cars} step ${game.traffic.stats.stepMs.toFixed(2)} dests ${game.world.dests.length}`;
      }
    };
    // the rules' objects are made before the warm-up (their materials compiled with the rest)
    game.prepare = () => {
      if (gameRef.current !== game) return;
      session = new Session(game, setUi);
      sessionRef.current = session;
      if (debug) Object.assign(window, { __driveSession: session });
    };
    game.start().then(() => {
      if (gameRef.current !== game || !game.vehicle) return;
      session?.ready();
      setPhase("drive");
    }).catch(err => { console.error(err); setError("게임을 시작하지 못했습니다: " + String(err)); });
    return () => { ro.disconnect(); session?.dispose(); sessionRef.current = null; game.dispose(); gameRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === "menu", start]);

  // (the game's sound starts on the first key or touch: browsers allow it only from a gesture)
  useEffect(() => {
    const wake = () => sessionRef.current?.audio.resume();
    window.addEventListener("keydown", wake, true); window.addEventListener("pointerdown", wake, true);
    return () => { window.removeEventListener("keydown", wake, true); window.removeEventListener("pointerdown", wake, true); };
  }, []);
  // the session writes its fast-changing numbers straight into these
  useEffect(() => {
    const s = sessionRef.current;
    if (s) s.hud = { dist: hud.dist.current, time: hud.time.current, turn: hud.turn.current, turnDist: hud.turnDist.current, map: hud.map.current, fx: hud.fx.current, flash: hud.flash.current, fuelText: hud.fuelText.current };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, ui?.delivery?.n, ui?.result]);

  const [toast, setToast] = useState<UiState["toast"]>(null);
  useEffect(() => { if (!ui?.toast) return; setToast(ui.toast); const t = setTimeout(() => setToast(null), 1800); return () => clearTimeout(t); }, [ui?.toast?.n]);

  const resume = () => { const g = gameRef.current; if (g) { g.paused = false; setPaused(false); sessionRef.current?.audio.resume(); } };
  const toggleView = () => { const g = gameRef.current; if (g) { g.view = g.view === "chase" ? "cockpit" : "chase"; setView(g.view); } };
  const showBoard = () => { setBoard({ data: null, error: null }); api.driveScores(playerId()).then(data => setBoard({ data, error: null })).catch(() => setBoard({ data: null, error: "순위를 불러오지 못했습니다." })); };
  /** Leaving: the drive's gold goes on the board (the nickname asked the first time). */
  const finish = (name = nick) => {
    const s = sessionRef.current, earned = Math.max(0, s?.ui.earned ?? 0);
    if (earned > 0 && !name.trim()) { setEnding(true); return; }
    const leave = () => { if (q.get("back")) location.href = q.get("back")!; else history.length > 1 ? history.back() : (location.href = "/realestate-map"); };
    if (earned > 0) {
      store.set(NAME_KEY, name.trim());
      api.driveScorePost({ player_id: playerId(), name: name.trim().slice(0, 20), score: earned, deliveries: s!.ui.delivered, vehicle }).then(data => { setEnding(false); setBoard({ data, error: null }); }).catch(() => leave());
      return;
    }
    leave();
  };
  const pedal = (k: "up" | "down" | "left" | "right" | "hand" | "boost", on: boolean) => { gameRef.current?.input.setTouch(k, on); sessionRef.current?.audio.resume(); };
  const r = ui?.result;

  return (
    <div className={`dg-root${view === "cockpit" ? " is-cockpit" : ""}`} onPointerDown={e => { if (e.pointerType === "touch" && !touch) setTouch(true); }}>
      <canvas ref={canvas} className="dg-canvas" />
      <div ref={hud.fx} className="dg-speedfx" />
      <div ref={hud.flash} className="dg-flash" />
      {phase === "menu" && (
        <div className="dg-menu">
          <h1>드라이브 배송</h1>
          <p className="dg-sub">{start ? `${start.name} 에서 출발 · 실제 지도 위를 달리며 아파트 단지로 배송합니다` : error || "불러오는 중…"}</p>
          <div className="dg-pick">
            {(["cyber", "coupang"] as VehicleName[]).map(v => <button key={v} className={vehicle === v ? "on" : ""} onClick={() => setVehicle(v)}>{v === "cyber" ? "⚡ 사이버트럭" : "🚚 쿠팡 트럭"}</button>)}
          </div>
          <div className="dg-pick">
            {(["day", "sunset", "night"] as TimeOfDay[]).map(t => <button key={t} className={time === t ? "on" : ""} onClick={() => setTime(t)}>{t === "day" ? "☀ 낮" : t === "sunset" ? "🌇 노을" : "🌙 밤"}</button>)}
          </div>
          <button className="dg-go" disabled={!start} onClick={() => setPhase("loading")}>출발</button>
          <p className="dg-keys">W/↑ 가속 · S/↓ 브레이크·후진 · A/D 조향 · Space 핸드브레이크 · Shift 부스터 · V 시점 · H 경적 · M 음성 · R 도로로 복귀 · Esc 일시정지 · 게임패드 지원</p>
          <p className="dg-gold">보유 골드 {goldTotal().toLocaleString()} G · <button className="dg-link" onClick={showBoard}>순위 보기</button></p>
        </div>
      )}
      {phase === "loading" && (
        <div className="dg-loading">
          <div className="dg-bar"><i style={{ transform: `scaleX(${progress.k})` }} /></div>
          <p>{error || progress.text}</p>
        </div>
      )}
      {phase !== "menu" && (
        <div className="dg-hud">
          <div className="dg-speed"><span ref={speedEl}>0</span><small>km/h</small><b ref={gearEl}>P</b></div>
          <div className="dg-revs"><div ref={revsEl} /></div>
          {ui && <div className="dg-gauges">
            <div className={`dg-gauge${ui.warn.hp === 2 ? " is-crit" : ui.warn.hp ? " is-low" : ""}`}><em>내구도</em><div><i style={{ transform: `scaleX(${ui.hp / 100})` }} /></div><b>{Math.round(ui.hp)}</b></div>
            <div className={`dg-gauge fuel${ui.warn.fuel === 2 ? " is-crit" : ui.warn.fuel ? " is-low" : ""}`}><em>{vehicle === "cyber" ? "배터리" : "연료"}</em><div><i style={{ transform: `scaleX(${ui.fuel})` }} /></div><b ref={hud.fuelText} /></div>
          </div>}
        </div>
      )}
      {ui && phase === "drive" && (
        <>
          <div className="dg-top">
            <div className="dg-gold-now">💰 {ui.gold.toLocaleString()} G{ui.combo > 1 && <span className="dg-combo">×{ui.combo} 연속</span>}</div>
            {ui.limit && <div className="dg-limit">{ui.limit}</div>}
          </div>
          {ui.delivery && !ui.result && (
            <div className="dg-job">
              <div className="dg-turn"><b ref={hud.turn}>↑</b><span ref={hud.turnDist} /></div>
              <div className="dg-dest"><em>배송지 #{ui.delivery.n}</em><strong>{ui.delivery.name}</strong><span><i ref={hud.dist} /> · <i ref={hud.time}>0:00</i></span></div>
            </div>
          )}
          {ui.finding && !ui.delivery && !ui.result && <div className="dg-job dg-finding">배송지를 찾는 중…</div>}
          <canvas ref={hud.map} className="dg-map" />
          {toast && <div key={toast.n} className={`dg-toast is-${toast.kind}`}>{toast.text}</div>}
          {r && (
            <div className="dg-card">
              <h2>배송 완료</h2>
              <p className="dg-card-name">{r.name}<small>{r.floors}층 · {(r.dist / 1000).toFixed(1)}km · {Math.floor(r.secs / 60)}분 {Math.round(r.secs % 60)}초</small></p>
              {r.complex === undefined && <p className="dg-card-link is-wait">단지 정보를 찾는 중…</p>}
              {r.complex && (
                <a className="dg-card-link" href={complexHref(r.complex.id)} target="_blank" rel="noopener">
                  <b>{r.complex.name}</b>
                  {r.complex.built ? <span>{r.complex.built}년 준공</span> : null}
                  <em>단지 정보 · 실거래가 보기 ↗</em>
                </a>
              )}
              <dl>
                <dt>거리</dt><dd>+{r.base}</dd>
                <dt>시간 보너스</dt><dd>+{r.time}</dd>
                <dt>무사고</dt><dd>+{r.clean}</dd>
                {r.combo > 0 && <><dt>연속 정시</dt><dd>+{r.combo}</dd></>}
                {r.penalty > 0 && <><dt>충돌</dt><dd>−{r.penalty}</dd></>}
                <dt className="sum">합계</dt><dd className="sum">{r.total} G</dd>
              </dl>
              <div className="dg-row"><button className="dg-go" onClick={() => sessionRef.current?.nextDelivery()}>다음 배송</button><button className="dg-btn" onClick={() => finish()}>그만하기</button></div>
            </div>
          )}
          {ui.wrecked && ui.wrecked !== "water" && (
            <div className="dg-card dg-wreck">
              <h2>{ui.wrecked === "fuel" ? "연료가 떨어졌습니다" : "차량이 파손되었습니다"}</h2>
              <p>수리하고 가까운 도로에서 다시 출발합니다 (50 G)</p>
              <div className="dg-row"><button className="dg-go" onClick={() => sessionRef.current?.repair()}>수리하기</button><button className="dg-btn" onClick={() => finish()}>그만하기</button></div>
            </div>
          )}
          {ui.wrecked === "water" && <div className="dg-card dg-wreck"><h2>물에 빠졌습니다</h2><p>가까운 도로로 돌아갑니다…</p></div>}
          {paused && (
            <div className="dg-menu dg-pause">
              <h1>일시정지</h1>
              <button className="dg-go" onClick={resume}>계속하기</button>
              <div className="dg-pick">
                <button onClick={toggleView}>{view === "chase" ? "운전석 시점" : "뒤에서 보기"}</button>
                <button onClick={() => sessionRef.current?.toggleVoice()}>{ui.voiceOn ? "음성 안내 끄기" : "음성 안내 켜기"}</button>
                <button onClick={() => { sessionRef.current?.toRoad(); resume(); }}>도로로 복귀</button>
                <button onClick={showBoard}>순위</button>
              </div>
              <p className="dg-sub">이번 주행 {ui.delivered}건 배송 · {ui.earned} G · 위반 {ui.violations}회</p>
              <button className="dg-btn" onClick={() => finish()}>게임 종료</button>
            </div>
          )}
          {touch && !paused && (
            <div className="dg-touch">
              <div className="dg-touch-l">
                {(["left", "right"] as const).map(k => <button key={k} onPointerDown={() => pedal(k, true)} onPointerUp={() => pedal(k, false)} onPointerLeave={() => pedal(k, false)} onPointerCancel={() => pedal(k, false)}>{k === "left" ? "◀" : "▶"}</button>)}
              </div>
              <div className="dg-touch-r">
                {(["boost", "hand", "down", "up"] as const).map(k => <button key={k} className={`k-${k}`} onPointerDown={() => pedal(k, true)} onPointerUp={() => pedal(k, false)} onPointerLeave={() => pedal(k, false)} onPointerCancel={() => pedal(k, false)}>{k === "up" ? "가속" : k === "down" ? "브레이크" : k === "hand" ? "핸드" : "부스터"}</button>)}
              </div>
              <button className="dg-touch-pause" onClick={() => { const g = gameRef.current; if (g) { g.paused = true; setPaused(true); } }}>Ⅱ</button>
            </div>
          )}
        </>
      )}
      {ending && (
        <div className="dg-menu">
          <h1>순위에 기록</h1>
          <p className="dg-sub">이번 주행 {sessionRef.current?.ui.earned ?? 0} G — 닉네임을 정해 주세요</p>
          <input className="dg-input" maxLength={20} value={nick} onChange={e => setNick(e.target.value)} placeholder="닉네임" autoFocus />
          <div className="dg-row"><button className="dg-go" disabled={!nick.trim()} onClick={() => finish(nick)}>기록하기</button><button className="dg-btn" onClick={() => { setEnding(false); history.back(); }}>기록 없이 나가기</button></div>
        </div>
      )}
      {board && (
        <div className="dg-menu dg-board" onClick={() => setBoard(null)}>
          <h1>배송 순위</h1>
          {board.error ? <p className="dg-sub">{board.error}</p> : !board.data ? <p className="dg-sub">불러오는 중…</p> : (
            <ol>{board.data.top.slice(0, 20).map(t => <li key={t.rank} className={t.me ? "me" : ""}><b>{t.rank}</b><span>{t.name}</span><em>{t.score.toLocaleString()} G</em></li>)}</ol>
          )}
          <p className="dg-sub">눌러서 닫기</p>
        </div>
      )}
      {debug && <pre ref={dbgEl} className="dg-debug" />}
    </div>
  );
}
