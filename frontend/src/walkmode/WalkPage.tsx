import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { api } from "../api/client";
import { Interior, prewarmInterior, type HudState } from "./interior/Interior";
import { generatePlan } from "./interior/plan/generate";
import { fetchUnits } from "./interior/plan/fetchUnits";
import { complexOf } from "./complexOf";
import { BuildingInterior, type BuildingHud } from "./building/BuildingInterior";
import { planBuilding, plateOf, type RegBuilding, type RegFloor } from "./building/plan";
import { envelopeOf } from "./interior/plan/envelope";
import { seeded } from "./interior/plan/generate";
import type { FloorPlan, StyleName, UnitsResponse } from "./interior/plan/types";
import { STYLE_LABEL } from "./interior/materials";
import { Sound } from "./game/sound";
import { WalkGame, type Entrance, type BicycleHud, type CarHud } from "./game/WalkGame";
import MiniMap, { type MapSubject } from "./MiniMap";
import OutdoorMap from "./OutdoorMap";
import { LaptopScreen, TvBrowser } from "./ScreenApps";
import type { PetKind } from "./interior/life";

/** the pet chosen last time in this browser (a convenience: a Shiba Inu unless a cat was chosen) */
const PET_KEY = "walk.pet";
function savedPet(q: URLSearchParams): PetKind {
  const fromUrl = q.get("pet");
  if (fromUrl === "cat" || fromUrl === "dog") return fromUrl;
  try { return localStorage.getItem(PET_KEY) === "cat" ? "cat" : "dog"; } catch { return "dog"; }
}
import { geocodeParcel } from "../drivegame/world/geocode";
import "./walkmode.css";

/* /walk — 직접 걷기, a service of its own (nothing shared at run time with the 3D building view):
 * walk the streets round a complex, go into one of its buildings, choose a flat, walk through it.
 * ?id=<complex>&lat=&lon=&hour=&weather=&back=… from the building view; ?interior=demo[&area=84]
 * opens a flat directly. One WebGL renderer for both, its resolution fixed on entry. */

type Phase = "boot" | "outdoor-loading" | "outdoor" | "choose" | "interior-loading" | "interior" | "building-loading" | "building" | "error";
// WebGL scenes own effects and resources outside React. Fast Refresh reused a
// disposed game and left the loading overlay at 100%; a full dev reload rebuilds it.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
interface Start { lat: number; lon: number; name: string; key: string; domain: string; id: string; built: number | null }

export default function WalkPage() {
  const q = useMemo(() => new URLSearchParams(location.search), []);
  const demo = q.get("interior") === "demo";
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<THREE.WebGLRenderer | null>(null);
  const sound = useMemo(() => new Sound(), []);
  const [car,setCar]=useState<CarHud>({driving:false,nearby:null,label:"",speedKmh:0,topKmh:0,gear:"P",message:"",view:"third"});
  const [soundMuted, setSoundMuted] = useState(false);
  const [tvOpen, setTvOpen] = useState(false);
  const [laptopOpen, setLaptopOpen] = useState(false);
  const [zoomed, setZoomed] = useState<"tv" | "laptop" | null>(null);
  const zoomTo = (w: "tv" | "laptop" | null) => { interior.current?.zoomScreen(w); setZoomed(w); if (w) document.exitPointerLock?.(); };
  const laptopCorners = useMemo(() => () => interior.current?.laptopScreen() ?? null, []);
  const outdoorGame = useMemo(() => () => game.current, []);
  const tvCorners = useMemo(() => () => interior.current?.tvScreen() ?? null, []);
  const [pet, setPetState] = useState<PetKind>(() => savedPet(new URLSearchParams(location.search)));
  const setPet = (k: PetKind) => { setPetState(k); try { localStorage.setItem(PET_KEY, k); } catch { /* this visit only */ } };
  const game = useRef<WalkGame | null>(null);
  const interior = useRef<Interior | null>(null);
  const [phase, setPhase] = useState<Phase>("boot");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({ k: 0, text: "단지 정보를 불러오는 중" });
  const [start, setStart] = useState<Start | null>(null);
  const [near, setNear] = useState<Entrance | null>(null);
  const [bicycle, setBicycle] = useState<BicycleHud>({ riding: false, speedKmh: 0, nearby: null, message: "" });
  const [entering, setEntering] = useState<Entrance | null>(null);
  // a building other than flats, gone into by its floors (building/)
  const building = useRef<BuildingInterior | null>(null);
  const [bhud, setBhud] = useState<BuildingHud | null>(null);
  const [liftPanel, setLiftPanel] = useState<{ levels: { level: number; label: string; uses: string }[]; current: number } | null>(null);
  const [bsource, setBsource] = useState("");
  /** the complex of the building being entered, when it is not the one the walk started at */
  const [visit, setVisit] = useState<{ id: string; name: string; built?: number } | null>(null);
  const [units, setUnits] = useState<UnitsResponse | null>(null);
  const [unitsErr, setUnitsErr] = useState("");
  const [pick, setPick] = useState<{ type: string; floor: number; style: StyleName | "auto" }>({ type: "", floor: 0, style: "auto" });
  const [plan, setPlan] = useState<FloorPlan | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [fade, setFade] = useState(false);
  const [touch, setTouch] = useState(() => matchMedia?.("(pointer: coarse)").matches ?? false);
  const [showHelp, setShowHelp] = useState(true);
  const hour = Number(q.get("hour") ?? (demo ? 14 : new Date().getHours())), weather = q.get("weather") ?? "clear";
  const debug = import.meta.env.DEV || q.get("debug") === "1";
  // the interior's shader programs, compiled while the flat is being chosen
  const warm = useRef<Promise<{ release(): void }> | null>(null);
  useEffect(() => {
    if (phase !== "choose" || warm.current || !renderer.current) return;
    warm.current = prewarmInterior(renderer.current).catch(() => ({ release() {} }));
  }, [phase]);

  // one renderer for the page: full resolution, fixed now (a phone's 3× capped at 2, as the drive does)
  useEffect(() => {
    const cv = canvas.current!;
    // (multisampled edges where a pixel is big enough to show steps: at 2× and up they are not seen)
    const r = new THREE.WebGLRenderer({ canvas: cv, antialias: (window.devicePixelRatio || 1) < 1.5 && new URLSearchParams(location.search).get("aa") !== "0", powerPreference: "high-performance", stencil: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(cv.clientWidth, cv.clientHeight, false);
    renderer.current = r;
    const fit = () => { const w = cv.clientWidth, h = cv.clientHeight; if (building.current) building.current.resize(w, h); else if (interior.current) interior.current.resize(w, h); else if (game.current) game.current.resize(w, h); else r.setSize(w, h, false); };
    const ro = new ResizeObserver(fit); ro.observe(cv);
    if (debug) Object.assign(window, { __walk: { renderer: r, get interior() { return interior.current; }, get game() { return game.current; }, get building() { return building.current; } } });
    return () => { ro.disconnect(); interior.current?.dispose(); game.current?.dispose(); r.dispose(); sound.dispose(); renderer.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // where to start
  useEffect(() => {
    if (demo) {
      const area = Number(q.get("area") ?? 84);
      // (cid, built: a demo of another complex's layout)
      const cid = q.get("cid") ?? "demo", built = Number(q.get("built") ?? 2019);
      setStart({ lat: 37.5, lon: 127.05, name: q.get("name") ?? "데모 아파트", key: "", domain: "", id: cid, built });
      setEntering({ name: q.get("name") ?? "데모 아파트", dong: q.get("dong") ?? "101동", x: 0, y: 0, floors: 20, heading: 0 });
      setUnits({ complexId: cid, name: "데모 아파트", built, households: null, dong: null, sources: ["데모: 지정한 전용면적"],
        types: [area, 59.97, 84.97, 114.9].filter((v, i, a) => a.indexOf(v) === i).map(a => ({ key: String(a), areaM2: a, trades: 0, label: `${a.toFixed(2)}㎡`, source: "데모" })) });
      setPick({ type: String(area), floor: Number(q.get("floor") ?? 12), style: (q.get("style") as StyleName) ?? "auto" });
      setPhase("choose");
      if (q.get("auto") === "1") { const go = () => document.querySelector<HTMLButtonElement>(".wk-go")?.click(); const wait = () => (warm.current ? void warm.current.then(() => setTimeout(go, 30)) : setTimeout(wait, 30)); setTimeout(wait, 30); }
      return;
    }
    const id = q.get("id");
    if (!id) { setError("시작할 단지가 지정되지 않았습니다."); setPhase("error"); return; }
    api.realEstateBuildings(id, undefined, true).then(async r => {
      const lat = parseFloat(q.get("lat") ?? ""), lon = parseFloat(q.get("lon") ?? "");
      let at = r.center ?? (Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null);
      // (a complex the server has no coordinates for yet: its parcel address, geocoded here)
      if (!at && r.query?.parcel && r.vworld_key) at = await geocodeParcel(r.query.parcel, r.vworld_key, r.vworld_domain ?? "https://kospimap.com");
      if (!r.vworld_key || !at) { setError("지도 자료를 불러올 수 없습니다."); setPhase("error"); return; }
      setStart({ lat: at.lat, lon: at.lon, name: r.name, key: r.vworld_key, domain: r.vworld_domain ?? "https://kospimap.com", id, built: r.built });
      setPhase("outdoor-loading");
    }).catch(() => { setError("단지 정보를 불러오지 못했습니다."); setPhase("error"); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the street
  useEffect(() => {
    if (phase !== "outdoor-loading" || !start || !renderer.current || game.current) return;
    const g = new WalkGame(renderer.current, {
      lat: start.lat, lon: start.lon, key: start.key, domain: start.domain, apiBase: `${location.origin}/api`,
      hour, weather, complexName: start.name, sound, built: start.built,
      onProgress: (text, k) => setProgress({ text, k }),
      onNear: e => setNear(e),
      onBicycle: setBicycle,
      onCar:setCar,
      onExit: () => leave(),
    });
    game.current = g;
    g.resize(canvas.current!.clientWidth, canvas.current!.clientHeight);
    g.start().then(() => { if (game.current === g) setPhase("outdoor"); }).catch(err => { console.error(err); setError("거리를 불러오지 못했습니다: " + String(err)); setPhase("error"); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, start]);

  // the flat types of the building being entered: fetched now, from the register and the trades
  const enter = (e: Entrance) => {
    if (!start || game.current?.cycling||game.current?.driving) return;
    if (e.kind === "building") { enterBuilding(e); return; }
    sound.resume();
    game.current?.pause();
    document.exitPointerLock?.();
    setEntering(e); setVisit(null); setUnits(null); setUnitsErr(""); setPhase("choose");
    const ctrl = new AbortController();
    // (the building's PNU first, for its register rows; the trades without it)
    (game.current ? game.current.pnuOf(e) : Promise.resolve(null)).then(async pnu => {
      // (a building of another complex walked or driven to: that complex's flats, not the start's)
      const own = !e.name || e.name === start.name || start.name.includes(e.name) || e.name.includes(start.name);
      // (one not among the collected complexes: its own name, its flats from the register by PNU)
      const visit = own ? null : (await complexOf(e.name, pnu, ctrl.signal)) ?? { id: `${pnu?.slice(0, 5) ?? "00000"}:?:0:${e.name}`, name: e.name };
      setVisit(visit);
      return fetchUnits(visit?.id ?? start.id, e.dong, ctrl.signal, pnu);
    }).then(u => {
      setUnits(u);
      const best = [...u.types].sort((a, b) => b.trades - a.trades)[0];
      const top = u.dong?.floors || e.floors || 15;
      if (u.dong?.floors) setEntering({ ...e, floors: u.dong.floors });
      setPick({ type: best?.key ?? "", floor: Math.min(top, 3 + Math.floor(Math.random() * Math.max(1, top - 3))), style: "auto" });
      if (!u.types.length) setUnitsErr("이 단지의 평형 자료가 없어 표준 84㎡ 평면으로 보여드립니다.");
    }).catch(() => { if (ctrl.signal.aborted) return; setUnits({ complexId: start.id, name: e.name || start.name, built: start.built, households: null, types: [], sources: [] }); setUnitsErr("평형 자료를 불러오지 못해 표준 84㎡ 평면으로 보여드립니다."); });
  };

  const goIn = () => {
    if (!start || !entering || !renderer.current) return;
    sound.resume();
    const t = units?.types.find(x => x.key === pick.type);
    const area = t?.areaM2 ?? 84.97;
    // (the flat's frame from its building: the footprint, the register's lines; its line by the floor)
    const envelope = envelopeOf(entering.foot, entering.heading, units?.built ?? visit?.built ?? start.built, area, units?.dong?.lines, t?.lines,
      seeded(`${visit?.id ?? start.id}|${entering.dong}|${pick.floor}|line`));
    const p = generatePlan({
      complexId: visit?.id ?? start.id, complexName: visit?.name ?? start.name, dong: entering.dong, unitType: t?.label ?? `${area}㎡`, area,
      areaBasis: t?.source ?? "표준 84㎡ (자료 없음)", roomsBasis: "면적대별 표준 평면", households: units?.households, built: units?.built ?? visit?.built ?? start.built,
      style: pick.style === "auto" ? undefined : pick.style, floor: pick.floor || undefined, envelope,
    });
    setPlan(p);
    setFade(true);
    setPhase("interior-loading");
    setProgress({ k: 0, text: "엘리베이터를 타고 올라가는 중" });
    const view = game.current?.captureView(entering, p.floor * 2.9 + 1.4) ?? null;
    const it = new Interior(renderer.current, {
      plan: p, hour, view, sound, pet,
      // (a screen in use takes the mouse back from the walk)
      onTv: on => { setTvOpen(on); if (on) document.exitPointerLock?.(); else setZoomed(z => (z === "tv" ? null : z)); },
      onTvMenu: () => { setTvOpen(true); document.exitPointerLock?.(); },
      onLaptop: on => { setLaptopOpen(on); if (on) document.exitPointerLock?.(); else setZoomed(z => (z === "laptop" ? null : z)); },
      onProgress: (k, text) => setProgress({ k, text }),
      onHud: h => setHud(h),
      onExit: () => exitFlat(),
    });
    interior.current = it;
    it.resize(canvas.current!.clientWidth, canvas.current!.clientHeight);
    it.load().then(() => {
      void warm.current?.then(w => w.release()); warm.current = null;
      if (interior.current !== it) return;
      it.start(); setPhase("interior");
      setTimeout(() => setFade(false), 120);
    }).catch(err => { console.error(err); setError("실내를 만들지 못했습니다: " + String(err)); setPhase("error"); });
  };

  const exitFlat = () => {
    document.exitPointerLock?.();
    setFade(true);
    setTimeout(() => {
      interior.current?.dispose(); interior.current = null; setHud(null);
      if (game.current && entering) { game.current.returnFromInterior(entering); setPhase("outdoor"); setNear(null); setFade(false); }
      else leave();
    }, 500);
  };
  // into a building: its register floors (표제부 + 층별개요) for its pnu, then its floors built live
  const enterBuilding = (e: Entrance) => {
    if (!renderer.current) return;
    sound.resume(); game.current?.pause(); document.exitPointerLock?.();
    setEntering(e); setBhud(null); setLiftPanel(null); setPhase("building-loading"); setProgress({ k: 0.05, text: "건축물대장에서 층별 정보를 찾는 중" });
    (game.current ? game.current.pnuOf(e) : Promise.resolve(null)).then(async pnu => {
      let info: RegBuilding = { name: e.name, floors: e.floors }, floors: RegFloor[] = [], src = "건축물대장 정보 없음 · 추정 구성";
      if (pnu) {
        // (its footprint's area picks the right block of a campus: a hospital's main block, not its labs)
        const fa = e.foot && e.foot.length > 2 ? Math.abs(e.foot.reduce((t, [x1, y1], i) => { const [x2, y2] = e.foot![(i + 1) % e.foot!.length]; return t + x1 * y2 - x2 * y1; }, 0)) / 2 : 0;
        const r = await fetch(`/api/realestate/building-floors?${new URLSearchParams({ pnu, name: e.name, ...(fa ? { area: fa.toFixed(0) } : {}) })}`).catch(() => null);
        if (r?.ok) { const d = await r.json(); info = { ...d.building, name: d.building?.name || e.name }; floors = d.floors ?? []; src = `건축물대장 표제부·층별개요 · 지상 ${info.floors ?? "?"}층 / 지하 ${info.basements ?? 0}층 · 승강기 ${(info.rideLifts ?? 0) + (info.emergencyLifts ?? 0)}대`; }
      }
      setBsource(src);
      const { W, D } = plateOf(e.foot, e.heading, info.buildingArea);
      const plan = planBuilding(info, floors, W, D);
      const bi = new BuildingInterior(renderer.current!, {
        plan, seed: Math.abs([...e.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)), hour,
        onHud: setBhud, onLiftPanel: p => { setLiftPanel(p); if (p) document.exitPointerLock?.(); }, onProgress: (k, text) => setProgress({ k, text }), onExit: () => exitBuilding(),
      });
      building.current = bi;
      bi.resize(canvas.current!.clientWidth, canvas.current!.clientHeight);
      await bi.load();
      if (building.current !== bi) return;
      bi.start(); setPhase("building");
    }).catch(err => { console.error(err); setError("건물 내부를 만들지 못했습니다: " + String(err)); setPhase("error"); });
  };
  const exitBuilding = () => {
    document.exitPointerLock?.();
    building.current?.dispose(); building.current = null; setBhud(null); setLiftPanel(null);
    if (game.current && entering) { game.current.returnFromInterior(entering); setPhase("outdoor"); setNear(null); }
    else leave();
  };

  const leave = () => { const b = q.get("back"); if (b && b.startsWith("/")) location.href = b; else if (history.length > 1) history.back(); else location.href = "/realestate-map"; };

  // keys the page owns: Esc leaves (back to the street, then the map), E enters a building
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable || target?.matches("input, textarea, select")) return;
      sound.resume();
      if (e.code === "Escape") { if (document.pointerLockElement) return; if (phase === "building") { if (liftPanel) building.current?.closeLiftPanel(); else exitBuilding(); return; } if (phase === "interior") exitFlat(); else if (phase === "choose" && game.current) { game.current.resume(); setPhase("outdoor"); } else if (phase === "outdoor") leave(); }
      if (e.code === "KeyH") setShowHelp(s => !s);
      if(e.code==="KeyF"&&phase==="outdoor"&&!e.repeat){if(game.current?.interactCar())e.preventDefault();return;}
      if ((e.code === "KeyE" || e.code === "Enter") && phase === "outdoor" && !e.repeat) {
        if(game.current?.driving){game.current.interactCar();e.preventDefault();return;}
        if (near && !game.current?.cycling) { e.preventDefault(); enter(near); return; }
        if (game.current?.interactBicycle()) { e.preventDefault(); return; }
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  });

  // (stepping away — a move key — ends the zoom)
  useEffect(() => { if (zoomed && hud?.seated !== "화면") setZoomed(null); }, [hud?.seated, zoomed]);
  // looking: pointer lock with a mouse, a drag on the right half by touch
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const stick = useRef<{ id: number; x: number; y: number } | null>(null);
  const [stickAt, setStickAt] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const active = () => (phaseRef.current === "interior" ? interior.current : phaseRef.current === "building" ? building.current : phaseRef.current === "outdoor" ? game.current : null);
  useEffect(() => {
    const clear = () => { stick.current = null; drag.current = null; setStickAt(null); active()?.setStick(0, 0, false); };
    window.addEventListener("blur", clear);
    return () => window.removeEventListener("blur", clear);
  }, []);
  const mapSubject = useMemo(() => (): MapSubject | null => {
    const it = interior.current; if (!it) return null;
    const pet = it.pet;
    return { pos: it.pos, yaw: it.yaw, pet: pet ? { x: pet.pos.x, z: pet.pos.y } : null };
  }, []);
  useEffect(() => {
    // (Chrome on Windows can report one huge jump as the pointer is locked or the window refocuses:
    // the first moves after a lock are dropped, and any single move beyond a hand's flick)
    let skip = 2;
    const lc = () => { skip = 2; };
    const mm = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas.current) return;
      if (skip > 0) { skip--; return; }
      if (Math.abs(e.movementX) > 280 || Math.abs(e.movementY) > 180) return;
      active()?.look(e.movementX * 0.0022, e.movementY * 0.0022);
    };
    window.addEventListener("mousemove", mm);
    document.addEventListener("pointerlockchange", lc);
    window.addEventListener("focus", lc);
    return () => { window.removeEventListener("mousemove", mm); document.removeEventListener("pointerlockchange", lc); window.removeEventListener("focus", lc); };
  }, []);
  const onDown = (e: React.PointerEvent) => {
    sound.resume();
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea, iframe")) return;
    if (e.pointerType === "touch") {
      if (!touch) setTouch(true);
      if (e.clientX < window.innerWidth * 0.42 && !stick.current) { stick.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; setStickAt({ x: e.clientX, y: e.clientY, dx: 0, dy: 0 }); }
      else if (!drag.current) drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    if ((phase === "interior" || phase === "outdoor" || phase === "building") && !liftPanel) canvas.current?.requestPointerLock?.();
  };
  const onMove = (e: React.PointerEvent) => {
    if (stick.current?.id === e.pointerId) {
      const dx = e.clientX - stick.current.x, dy = e.clientY - stick.current.y, r = 56, l = Math.hypot(dx, dy), k = l > r ? r / l : 1;
      setStickAt({ x: stick.current.x, y: stick.current.y, dx: dx * k, dy: dy * k });
      active()?.setStick((dx * k) / r, -(dy * k) / r, l > r * 1.25);
    } else if (drag.current?.id === e.pointerId) {
      active()?.look((e.clientX - drag.current.x) * 0.005, (e.clientY - drag.current.y) * 0.005);
      drag.current.x = e.clientX; drag.current.y = e.clientY;
    }
  };
  const onUp = (e: React.PointerEvent) => {
    if (stick.current?.id === e.pointerId) { stick.current = null; setStickAt(null); active()?.setStick(0, 0, false); }
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  const chosen = units?.types.find(t => t.key === pick.type);
  const floors = Math.max(entering?.floors || 25, 5);

  return (
    <div className={`wk-root${fade ? " is-fading" : ""}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <canvas ref={canvas} className="wk-canvas" />
      <div className="wk-fade" />

      {(phase === "boot" || phase === "outdoor-loading" || phase === "interior-loading" || phase === "building-loading") && (
        <div className="wk-loading">
          <div className="wk-load-card">
            <span className="wk-kicker">{phase === "interior-loading" ? `${plan?.complexName ?? ""} ${plan?.dong ?? ""} · ${plan?.floor ?? ""}층` : "직접 걷기"}</span>
            <h1>{phase === "interior-loading" ? "세대 실내를 만드는 중" : phase === "building-loading" ? `${entering?.name ?? "건물"} 내부를 만드는 중` : start?.name ?? "단지를 찾는 중"}</h1>
            <div className="wk-bar"><i style={{ transform: `scaleX(${Math.max(0.02, progress.k)})` }} /></div>
            <p className="wk-progress-text">{progress.text}<b>{Math.round(progress.k * 100)}%</b></p>
            {phase === "interior-loading" && plan && <p className="wk-sub">{plan.template} · 전용 {plan.areaExclusiveM2.toFixed(2)}㎡ · {STYLE_LABEL[plan.style]} · 고품질 자재 약 9MB (첫 방문만)</p>}
            {phase !== "interior-loading" && <p className="wk-sub">WASD·방향키 이동 · Shift 달리기 · 마우스로 둘러보기 · E 상호작용 · V 시점 · Esc 나가기{touch ? " · 왼쪽 스틱 이동, 오른쪽 끌어서 시점" : ""}</p>}
          </div>
        </div>
      )}

      {phase === "error" && <div className="wk-loading"><div className="wk-load-card"><h1>열 수 없습니다</h1><p className="wk-sub">{error}</p><button className="wk-btn" onClick={leave}>돌아가기</button></div></div>}

      {phase === "outdoor" && near && !bicycle.riding && !car.driving && (
        <div className="wk-prompt">
          <p><b>{near.name} {near.dong}</b>에 들어가시겠습니까?</p>
          <div className="wk-row"><button className="wk-go" onClick={() => enter(near)}>들어가기 <kbd>E</kbd></button>{bicycle.nearby && <button className="wk-btn" onClick={() => { sound.resume(); game.current?.interactBicycle(); }}>🚲 자전거 타기</button>}{car.nearby && <button className="wk-btn" onClick={() => { sound.resume(); game.current?.interactCar(); }}>🚗 차량 타기 <kbd>F</kbd></button>}<button className="wk-btn" onClick={() => setNear(null)}>취소</button></div>
        </div>
      )}

      {phase === "outdoor" && bicycle.nearby && !bicycle.riding && !near && (
        <div className="wk-prompt wk-bike-prompt" onPointerDown={e => e.stopPropagation()}>
          <p><b>자전거를 타고 이동하기</b></p>
          <span>{bicycle.nearby} 출입구 자전거 · 최고 60km/h</span>
          {bicycle.message && <small role="status">{bicycle.message}</small>}
          <div className="wk-row"><button className="wk-go wk-board wk-board--bike" onClick={() => { sound.resume(); game.current?.interactBicycle(); }}><kbd>E</kbd> 🚲 자전거 타기</button>{car.nearby&&<button className="wk-go wk-board wk-board--car" onClick={()=>{sound.resume();game.current?.interactCar();}}><kbd>F</kbd> 🚗 차량 타기</button>}{near && <button className="wk-btn" onClick={() => enter(near)}>건물 들어가기</button>}</div>
        </div>
      )}

      {phase === "outdoor" && bicycle.riding && (
        <>
          <div className="wk-bike-speed" aria-label="자전거 속도" onPointerDown={e => e.stopPropagation()}>
            <span>🚲 자전거 주행</span><div><b data-bike-speed>{bicycle.speedKmh}</b><span>km/h</span></div>
            <small>최고 60km/h</small>
            {bicycle.message && <p role="status">{bicycle.message}</p>}
          </div>
          <div className="wk-bike-buttons" onPointerDown={e => e.stopPropagation()}>
            {touch && <button className="wk-btn wk-bike-brake" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); game.current?.setBicycleBrake(true); }} onPointerUp={() => game.current?.setBicycleBrake(false)} onPointerCancel={() => game.current?.setBicycleBrake(false)} onLostPointerCapture={() => game.current?.setBicycleBrake(false)}>브레이크</button>}
            <button className="wk-btn" onClick={() => game.current?.interactBicycle()}>자전거 내리기 <kbd>E</kbd></button>
          </div>
        </>
      )}

      {phase==="outdoor"&&car.nearby&&!car.driving&&!bicycle.riding&&!bicycle.nearby&&!near&&(
        <div className="wk-prompt wk-bike-prompt" onPointerDown={e=>e.stopPropagation()}>
          <p><b>{car.label}</b> 운전하기</p><span>최고 {car.topKmh}km/h · 차종 전용 조향·실내·주행음</span>
          {car.message&&<small role="status">{car.message}</small>}
          <div className="wk-row"><button className="wk-go wk-board wk-board--car" onClick={()=>{sound.resume();game.current?.interactCar();}}><kbd>F</kbd> 🚗 차량 타기</button>{near&&<button className="wk-btn" onClick={()=>enter(near)}>건물 들어가기</button>}</div>
        </div>
      )}
      {phase==="outdoor"&&car.driving&&<>
        <div className="wk-bike-speed" aria-label="차량 속도" onPointerDown={e=>e.stopPropagation()}>
          <span>🚗 {car.label} · {car.gear}</span><div><b data-car-speed>{Math.abs(car.speedKmh)}</b><span>km/h</span></div><small>최고 {car.topKmh}km/h · {car.gear==="R"?"후진":"주행"}</small>{car.message&&<p role="status">{car.message}</p>}
        </div>
        <div className="wk-bike-buttons" onPointerDown={e=>e.stopPropagation()}>
          {touch&&<button className="wk-btn wk-bike-brake" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);game.current?.setBicycleBrake(true);}} onPointerUp={()=>game.current?.setBicycleBrake(false)} onPointerCancel={()=>game.current?.setBicycleBrake(false)} onLostPointerCapture={()=>game.current?.setBicycleBrake(false)}>브레이크</button>}
          <button className="wk-btn" onClick={()=>game.current?.interactCar()}>차량 내리기 <kbd>F / E</kbd></button>
        </div>
      </>}

      {phase === "choose" && entering && (
        <div className="wk-choose">
          <div className="wk-choose-card">
            <span className="wk-kicker">{visit?.name ?? entering.name ?? start?.name} {entering.dong}</span>
            <h2>어느 세대로 갈까요?</h2>
            {!units ? <div className="wk-units-loading"><div className="wk-bar"><i className="is-indeterminate" /></div><p className="wk-sub">건축물대장·실거래 자료에서 이 동의 평형을 받아오는 중…</p></div> : <>
              <div className="wk-field"><label>평형 (전용면적)</label>
                <div className="wk-chips">{units.types.map(t => <button key={t.key} className={pick.type === t.key ? "on" : ""} onClick={() => setPick(p => ({ ...p, type: t.key }))}>{t.areaM2.toFixed(0)}㎡<small>{t.households ? `${t.households}세대` : ""}{t.households && t.trades ? " · " : ""}{t.trades ? `거래 ${t.trades}건` : ""}</small></button>)}</div>
              </div>
              <div className="wk-field"><label>층 <b>{pick.floor}층</b></label><input type="range" min={2} max={floors} value={pick.floor} onChange={e => setPick(p => ({ ...p, floor: +e.target.value }))} /></div>
              <div className="wk-field"><label>인테리어</label>
                <div className="wk-chips">{(["auto", "modern_white", "wood_natural", "gray_minimal", "classic_walnut", "nordic_bright", "hotel_dark", "vintage_warm"] as const).map(s => <button key={s} className={pick.style === s ? "on" : ""} onClick={() => setPick(p => ({ ...p, style: s }))}>{s === "auto" ? "자동" : STYLE_LABEL[s]}</button>)}</div>
              </div>
              <div className="wk-field"><label>반려동물</label>
                <div className="wk-chips">{([["dog", "🐶 시바견"], ["cat", "🐱 고양이"]] as const).map(([k, l]) => <button key={k} className={pet === k ? "on" : ""} onClick={() => setPet(k)}>{l}</button>)}</div>
              </div>
              {unitsErr && <p className="wk-warn">{unitsErr}</p>}
              <p className="wk-basis">
                <span className="wk-badge">추정 평면</span>
                {chosen ? `${chosen.label} · 근거: ${chosen.source}` : "표준 평면"}{units.households ? ` · ${units.households.toLocaleString()}세대` : ""}<br />
                공개 자료에는 평면도가 없어 면적에 맞춘 국내 표준 평면(판상형)으로 실내를 만들고, 인테리어는 연출용 가상 인테리어입니다.
              </p>
              <div className="wk-row"><button className="wk-go" onClick={goIn}>🛗 올라가기</button><button className="wk-btn" onClick={() => { if (game.current) { game.current.resume(); setPhase("outdoor"); } else leave(); }}>취소</button></div>
            </>}
          </div>
        </div>
      )}

      {phase === "interior" && plan && (
        <>
          <div className="wk-topbar">
            <div className="wk-where"><b>{plan.complexName} {plan.dong} {plan.floor}층</b><span>{hud?.room}</span></div>
            <div className="wk-meta"><span className="wk-badge">추정 평면</span>{plan.template} · 전용 {plan.areaExclusiveM2.toFixed(2)}㎡ (방 합계 {plan.check.areaM2}㎡, {(plan.check.error * 100).toFixed(1)}%) · {STYLE_LABEL[plan.style]} · 연출용 가상 인테리어</div>
            <div className="wk-actions">
              <button className="wk-btn" onClick={() => interior.current?.toggleView()}>{hud?.view === "third" ? "1인칭" : "3인칭"} <kbd>V</kbd></button>
              <button className="wk-btn" onClick={exitFlat}>나가기 <kbd>Esc</kbd></button>
            </div>
          </div>
          {hud?.seated !== "화면" && hud?.seated !== "반려동물" && <MiniMap plan={plan} subject={mapSubject} />}
          {tvOpen && <TvBrowser corners={tvCorners} zoom={{ on: zoomed === "tv", set: on => zoomTo(on ? "tv" : null) }} onOff={() => { interior.current?.tvPower(false); setTvOpen(false); if (zoomed === "tv") zoomTo(null); }} onPicture={img => interior.current?.tvPicture(img)} />}
          {laptopOpen && <LaptopScreen corners={laptopCorners} zoom={{ on: zoomed === "laptop", set: on => zoomTo(on ? "laptop" : null) }} onClose={() => { interior.current?.closeLaptop(); setLaptopOpen(false); setZoomed(null); }} />}
          <div className="wk-cross" />
          {hud?.target && !touch && <div className="wk-hint"><kbd>E</kbd> {hud.target}{hud.pet && <> · <kbd>Z</kbd> 확대해서 보기</>}</div>}
          {hud?.pet && touch && <button className="wk-btn wk-pet-zoom" onPointerDown={e => { e.stopPropagation(); interior.current?.zoomPet(true); }}>🔍 확대해서 보기</button>}
          {hud?.seated === "반려동물" && <div className="wk-laptop-bar" onPointerDown={e => e.stopPropagation()}><span>가까이서 보는 중</span><button className="wk-btn" onClick={() => interior.current?.zoomPet(false)}>축소 <kbd>Z</kbd></button></div>}
          {hud?.seated && hud.seated !== "화면" && hud.seated !== "반려동물" && <div className="wk-hint is-seat">{hud.seated} · 이동키를 누르면 일어납니다</div>}
          {showHelp && !touch && <div className="wk-help" onClick={() => setShowHelp(false)}>클릭해서 둘러보기 시작 · WASD 이동 · Shift 달리기 · E 상호작용 (스위치·수전·변기·커튼·문·TV·소파·침대) · V 3인칭 · H 도움말 · Esc 나가기</div>}
        </>
      )}

      {phase === "building" && (
        <>
          <div className="wk-topbar">
            <div className="wk-where"><b>{bhud?.building ?? entering?.name} · {bhud?.floor}</b><span>{bhud?.uses || "층별 용도 정보 없음"} · 사람 {bhud?.people ?? 0}명</span></div>
            <div className="wk-meta"><span className="wk-badge">건축물대장</span>{bsource} · 층 구성·용도는 대장 기준, 실내 배치는 추정</div>
            <div className="wk-actions">
              <button className="wk-btn" onClick={() => building.current?.toggleView()}>{bhud?.view === "third" ? "1인칭" : "3인칭"} <kbd>V</kbd></button>
              <button className="wk-btn" onClick={exitBuilding}>나가기 <kbd>Esc</kbd></button>
            </div>
          </div>
          <div className="wk-cross" />
          {bhud?.prompt && !liftPanel && <div className="wk-hint"><kbd>E</kbd> {bhud.prompt}</div>}
          {bhud?.riding && <div className="wk-hint is-seat">에스컬레이터 이동 중…</div>}
          {liftPanel && (
            <div className="wk-prompt wk-lift" onPointerDown={e => e.stopPropagation()}>
              <p><b>엘리베이터</b> · 현재 {liftPanel.levels.find(l => l.level === liftPanel.current)?.label}</p>
              <div className="wk-lift-grid">
                {[...liftPanel.levels].reverse().map(l => (
                  <button key={l.level} className={`wk-btn${l.level === liftPanel.current ? " on" : ""}`} disabled={l.level === liftPanel.current} onClick={() => building.current?.ride_to(l.level)} title={l.uses}>
                    <b>{l.label}</b>{l.uses && <small>{l.uses}</small>}
                  </button>
                ))}
              </div>
              <div className="wk-row"><button className="wk-btn" onClick={() => building.current?.closeLiftPanel()}>닫기 <kbd>Esc</kbd></button></div>
            </div>
          )}
          {showHelp && !touch && <div className="wk-help" onClick={() => setShowHelp(false)}>WASD 이동 · Shift 달리기 · E 엘리베이터/계단/출입문 · Shift+E 계단 아래층 · 에스컬레이터는 올라서면 이동 · V 시점 · Esc 나가기</div>}
        </>
      )}

      {(phase === "interior" || phase === "outdoor" || phase === "building") && touch && (
        <div className="wk-touch">
          {stickAt && <div className="wk-stick" style={{ left: stickAt.x - 60, top: stickAt.y - 60 }}><i style={{ transform: `translate(${stickAt.dx}px, ${stickAt.dy}px)` }} /></div>}
          {phase === "interior" && <button className={`wk-act${hud?.target ? " on" : ""}`} onPointerDown={e => { e.stopPropagation(); interior.current?.interact(); }}>{hud?.target ?? "상호작용"}</button>}
          {phase === "interior" && <button className="wk-view" onPointerDown={e => { e.stopPropagation(); active()?.toggleView(); }}>시점</button>}
          {phase === "building" && <button className={`wk-act${bhud?.prompt ? " on" : ""}`} onPointerDown={e => { e.stopPropagation(); building.current?.interact(); }}>{bhud?.prompt ?? "상호작용"}</button>}
          {phase === "building" && <button className="wk-view" onPointerDown={e => { e.stopPropagation(); active()?.toggleView(); }}>시점</button>}
        </div>
      )}

      {phase === "outdoor" && (
        <div className="wk-topbar">
          <div className="wk-where"><b>{start?.name}</b><span>{car.driving?`${car.label} 운전 · 최고 ${car.topKmh}km/h`:bicycle.riding ? "자전거로 실외 탐험 · 최고 60km/h" : "각 동 자전거 E · 길가의 주차 차량 F"}</span></div>
          <div className="wk-actions"><button className="wk-btn" aria-label={soundMuted ? "효과음 켜기" : "효과음 끄기"} aria-pressed={soundMuted} onClick={() => { sound.resume(); sound.setMuted(!soundMuted); setSoundMuted(!soundMuted); }}>{soundMuted ? "🔇" : "🔊"} 효과음</button><button className="wk-btn" onClick={() => game.current?.toggleView()}>{car.driving?(car.view==="third"?"3인칭 → 정면":"정면 → 3인칭"):"시점"} <kbd>V</kbd></button><button className="wk-btn" onClick={leave}>지도로 <kbd>Esc</kbd></button></div>
        </div>
      )}
      {phase === "outdoor" && <OutdoorMap game={outdoorGame} />}
      {phase === "outdoor" && showHelp && <div className="wk-help" onClick={() => setShowHelp(false)}>{car.driving?(touch?"왼쪽 스틱: 가속·감속·조향 · 브레이크: 정지 · 시점 버튼: 3인칭/정면":"W 가속 · S 제동/후진 · A/D 조향 · Space 핸드브레이크 · F/E 내리기 · V 3인칭/정면"):bicycle.riding ? touch ? "왼쪽 스틱: 가속·조향 · 뒤로: 감속 · 브레이크 버튼: 정지 · 오른쪽 끌기: 시점" : "W·↑ 가속 · A/D·←/→ 조향 · S·↓ 또는 Space 브레이크 · E 내리기 · V 시점 · 마우스로 둘러보기" : touch ? "왼쪽 스틱으로 걷기 · 근처 자전거/차량 타기 버튼" : "WASD 걷기 · Shift 달리기 · E 건물/자전거 · F 주차 차량 운전 · V 시점"}</div>}
    </div>
  );
}
