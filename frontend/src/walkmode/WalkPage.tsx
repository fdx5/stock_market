import { useEffect, useMemo, useRef, useState } from "react";
import { originAt, toFrame, toLonLat } from "../drivegame/world/geo";
import { pnuAt } from "./game/pnu";
import { inPoly } from "./building/plan";
import * as THREE from "three";
import { api } from "../api/client";
import { Interior, prewarmInterior, type HudState } from "./interior/Interior";
import { generatePlan } from "./interior/plan/generate";
import { fetchUnits } from "./interior/plan/fetchUnits";
import { complexOf } from "./complexOf";
import { BuildingInterior, type BuildingHud, type BuildingTalk } from "./building/BuildingInterior";
import { getSurvey, type SurveyBuilding, type SurveyFloor } from "./building/survey";
import { fitOut, type FitSource } from "./building/fitout";
import BuildingMap from "./building/BuildingMap";
import { kindOf, planBuilding, plateOf, type RegBuilding, type RegFloor } from "./building/plan";
import { FACILITY_LABEL, facilityKindOf, facilityLevels, generateFacility } from "./interior/plan/facility";
import { generateSurveyed } from "./interior/plan/surveyed";
import { envelopeOf } from "./interior/plan/envelope";
import { seeded } from "./interior/plan/generate";
import type { FloorPlan, StyleName, UnitsResponse } from "./interior/plan/types";
import { STYLE_LABEL } from "./interior/materials";
import { Sound } from "./game/sound";
import { WalkGame, type Entrance, type BicycleHud, type CarHud } from "./game/WalkGame";
import MiniMap, { type MapSubject } from "./MiniMap";
import OutdoorMap from "./OutdoorMap";
import { LaptopScreen, TvBrowser } from "./ScreenApps";
import { FacilityBrowser, VendingMenu } from "./FacilityApps";
import type { VendingSession } from "./interior/vending";
import CameraSettings from "./CameraSettings";
import { viewPreferences } from "./viewPreferences";
import { parseWalkAt, walkLink, walkAnchor, rememberWalkEntry, recalledWalkEntry, resolveWalkEntry, safeWalkBack, type WalkEntry } from "./walkLink";
import { vworldWalkFootprints } from "../components/vworldBuildings";
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
  const root = useRef<HTMLDivElement>(null);
  const renderer = useRef<THREE.WebGLRenderer | null>(null);
  const sound = useMemo(() => new Sound(), []);
  const [car,setCar]=useState<CarHud>({driving:false,nearby:null,label:"",speedKmh:0,topKmh:0,gear:"P",message:"",view:"third"});
  const [soundMuted, setSoundMuted] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const shareBase = useRef<string | null>(null), returnTo = useRef<string | null>(null);
  const outdoorUrl = useRef(location.pathname + location.search);
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(location.href); setCopyStatus("복사됨"); }
    catch { setCopyStatus("주소창에서 복사"); }
    setTimeout(() => setCopyStatus(""), 2500);
  };
  const [tvOpen, setTvOpen] = useState(false);
  const [laptopOpen, setLaptopOpen] = useState(false);
  const [zoomed, setZoomed] = useState<"tv" | "laptop" | null>(null);
  const zoomTo = (w: "tv" | "laptop" | null) => { interior.current?.zoomScreen(w); setZoomed(w); if (w) document.exitPointerLock?.(); };
  const laptopCorners = useMemo(() => () => interior.current?.laptopScreen() ?? null, []);
  const outdoorGame = useMemo(() => () => game.current, []);
  /** where a building's frame points are on the map and its parcel: the street game's, or — entered
   * straight from the drone view (?enter=1) — the same sums about the door the walker stood at */
  const direct = useRef<{ pnuOf(e: Entrance): Promise<string | null>; lonLatOf(x: number, y: number): [number, number]; frameOf(lon: number, lat: number): [number, number] } | null>(null);
  const geo = () => game.current ?? direct.current;
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
  const [reviewEntrance,setReviewEntrance]=useState<Entrance|null>(null);
  const [bicycle, setBicycle] = useState<BicycleHud>({ riding: false, speedKmh: 0, nearby: null, message: "" });
  const [entering, setEntering] = useState<Entrance | null>(null);
  // a building other than flats, gone into by its floors (building/)
  const building = useRef<BuildingInterior | null>(null);
  const [bhud, setBhud] = useState<BuildingHud | null>(null);
  const [liftPanel, setLiftPanel] = useState<{ levels: { level: number; label: string; uses: string }[]; current: number } | null>(null);
  const [vending, setVending] = useState<VendingSession | null>(null);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [cameraPanel, setCameraPanel] = useState(false), [outdoorView, setOutdoorView] = useState<"first" | "third">("third");
  const monitorCorners = useMemo(() => () => interior.current?.monitorScreen() ?? null, []);
  const closeMonitor = () => { interior.current?.closeMonitor(); setMonitorOpen(false); };
  useEffect(() => { const on = !!(liftPanel || vending || monitorOpen || cameraPanel); interior.current?.setOverlay(on); building.current?.setOverlay(on); game.current?.setOverlay(on); }, [liftPanel, vending, monitorOpen, cameraPanel, phase]);
  useEffect(() => {
    const header = root.current?.querySelector(".wk-topbar"); if (!header) return;
    const ro = new ResizeObserver(() => root.current?.style.setProperty("--wk-header-clearance", `${Math.ceil(header.getBoundingClientRect().height) + 16}px`));
    ro.observe(header); return () => ro.disconnect();
  }, [phase]);
  const [bsource, setBsource] = useState("");
  const [talk,setTalk]=useState<BuildingTalk|null>(null);
  /** a building other than flats, walked floor by floor in the interior engine: what is known of it */
  const fac = useRef<{ info: RegBuilding; floors: RegFloor[]; W: number; D: number; levels: { level: number; label: string; uses: string }[]; tenants: { name: string; level: number }[]; departments: string[]; key: string;
    /** the building's survey (SGIS): its frame, its floors' drawings fetched as walked; the way in in plan coords */
    survey?: { id: string; frame: { x: number; y: number; width: number; depth: number }; outline: [number, number][][][] | null; entry: [number, number] | null; stack?: Promise<{ status: string; cores?: { type: string; polygons: [number, number][][][] }[] } | null> };
    /** the way into the plan's frame (the survey's, else the footprint's), its footprint and the way in
     * there, and a hospital's other blocks (its ground floor laid out with them) */
    toPlan?: (x: number, y: number) => [number, number]; foot?: [number, number][]; entry?: [number, number]; campus?: [number, number][][] } | null>(null);
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
    // (a building's floor without a building: ?interior=facility&kind=clinic&level=2&w=30&d=18 — for checks)
    if (q.get("interior") === "facility") {
      const kind = q.get("kind") ?? "office", W = Number(q.get("w") ?? 30), D = Number(q.get("d") ?? 18), top = Number(q.get("floors") ?? 8);
      const use: Record<string, string> = { office: "업무시설", clinic: "의원", ward: "병원 병실", retail: "제1종근린생활시설 소매점", food: "휴게음식점", school: "학원", gym: "체력단련장", hotel: "숙박시설", parking: "주차장", plant: "기계실", civic: "공공업무시설", museum: "전시관" };
      const info: RegBuilding = { name: q.get("name") ?? "검토용 빌딩", floors: top, basements: 2, use: use[kind] ?? "업무시설" };
      const floors: RegFloor[] = [-2, -1, ...Array.from({ length: top }, (_, i) => i + 1)].map(l => ({ level: l, label: l < 0 ? `지하 ${-l}층` : `${l}층`, area: W * D, uses: [{ use: l < 0 ? "주차장" : use[kind] ?? "업무시설", detail: "", area: W * D }] }));
      const levels = floors.map(f => f.level);
      fac.current = { info, floors, W, D, levels: facilityLevels(levels, floors), tenants: [], departments: [], key: `demo|${kind}` };
      setEntering({ name: info.name!, dong: "", x: 0, y: 0, floors: top, heading: 0, kind: "building" });
      pendingFacility.current = Number(q.get("level") ?? 1);
      return;
    }
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
    // (from the drone view, on foot: straight into the building at the door, ?enter=1&lat&lon&foot)
    if (q.get("enter") === "1" || q.has("at")) { void enterDirect(); return; }
    const place=q.get("place"),plat=Number(q.get("lat")),plon=Number(q.get("lon"));
    if(place&&plat>=33&&plat<=39&&plon>=124&&plon<=132){
      fetch("/api/realestate/walk-config").then(r=>{if(!r.ok)throw Error("config");return r.json();}).then(r=>{
        if(!r.vworld_key)throw Error("map key unavailable");
        setStart({lat:plat,lon:plon,name:place,key:r.vworld_key,domain:r.vworld_domain??"https://kospimap.com",id:`place:${place}`,built:null});setPhase("outdoor-loading");
      }).catch(()=>{setError("지도 연결 설정을 불러오지 못했습니다.");setPhase("error");});return;
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
      onView: setOutdoorView,
      onExit: () => leave(),
    });
    game.current = g;
    g.resize(canvas.current!.clientWidth, canvas.current!.clientHeight);
    g.start().then(() => { if (game.current === g) {setPhase("outdoor");if(q.get("review")==="1"){const candidates=g.entrances.filter(e=>e.kind==="building"&&(e.name.includes(start.name)||start.name.includes(e.name))).sort((a,b)=>Math.hypot(a.x,a.y)-Math.hypot(b.x,b.y));setReviewEntrance(candidates[0]??null);}} }).catch(err => { console.error(err); setError("거리를 불러오지 못했습니다: " + String(err)); setPhase("error"); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, start]);

  // the flat types of the building being entered: fetched now, from the register and the trades
  /** The building the drone view's walker stood at: its outline (lon,lat pairs), the door point and
   * the way in; its parcel from VWorld, its register (use, name, floors), then in — a block of flats
   * by its flats, any other building by its floors. */
  const enterDirect = async () => {
    const at = parseWalkAt(q.get("at"));
    if (q.has("at") && !at) { setError("건물 공유 주소의 위치가 올바르지 않습니다."); setPhase("error"); return; }
    const lat = at?.[0] ?? Number(q.get("lat")), lon = at?.[1] ?? Number(q.get("lon"));
    if (!(lat >= 33 && lat <= 39 && lon >= 124 && lon <= 132)) { setError("건물 위치가 올바르지 않습니다."); setPhase("error"); return; }
    try {
      const cfg = await fetch("/api/realestate/walk-config", { signal: AbortSignal.timeout(18000) }).then(r => r.ok ? r.json() : Promise.reject(Error("config")));
      const key: string = cfg.vworld_key, domain: string = cfg.vworld_domain ?? "https://kospimap.com";
      let restored = at ? recalledWalkEntry(lat, lon) : null;
      if (at && !restored) {
        const footprints = await vworldWalkFootprints(lat, lon, key, domain).catch(() => []);
        try { restored = resolveWalkEntry(lat, lon, footprints); }
        catch {
          // Some stations and public buildings only have an SGIS outline. Use its full
          // surveyed polygons rather than opening an unrelated neighbour or a small box.
          const survey = await getSurvey<SurveyBuilding>(`/api/realestate/indoor-building?${new URLSearchParams({ lat: String(lat), lon: String(lon) })}`);
          if (survey?.status !== "available" || !survey.frame || !survey.outlines?.length) throw Error("outline unavailable");
          const frame = survey.frame, origin = originAt(frame.lat, frame.lon);
          restored = resolveWalkEntry(lat, lon, survey.outlines.map((p, i) => ({ id: `${survey.id}:${i}`, pnu: "", name: survey.name ?? "건물", floors: 0, use: "",
            ring: p[0].map(([x, y]) => toLonLat(origin, x - frame.x, y - frame.y)) })));
        }
      }
      const o = originAt(lat, lon);
      direct.current = { pnuOf: en => { const [lo, la] = toLonLat(o, en.cx ?? en.x, en.cy ?? en.y); return pnuAt(lo, la, key, domain); }, lonLatOf: (x, y) => toLonLat(o, x, y), frameOf: (lo, la) => toFrame(o, lo, la) };
      const footLL = restored?.foot ?? (q.get("foot") ?? "").split(";").map(p => p.split(",").map(Number)).filter(p => p.length === 2 && p.every(Number.isFinite)) as [number, number][];
      const foot = footLL.map(([lo, la]) => toFrame(o, lo, la));
      const cx = foot.length ? foot.reduce((t, p) => t + p[0], 0) / foot.length : 0, cy = foot.length ? foot.reduce((t, p) => t + p[1], 0) / foot.length : 0;
      const heading = restored?.heading ?? Number(q.get("heading") ?? 0);
      const [doorX, doorY] = restored ? toFrame(o, ...restored.door) : [0, 0];
      const e: Entrance = { name: restored?.name ?? q.get("name") ?? "", dong: "", x: doorX, y: doorY, floors: restored?.floors ?? (Number(q.get("floors") ?? 0) || 5), heading, cx, cy, foot: foot.length >= 3 ? foot : undefined, kind: "building" };
      // (the blocks standing with it, as the drone view saw them)
      const campusLL = restored?.campus ?? (q.get("campus") ?? "").split("|").map(r => r.split(";").map(p => p.split(",").map(Number)).filter(p => p.length === 2 && p.every(Number.isFinite))) as [number, number][][];
      const campus = campusLL.map(r => r.map(([lo, la]) => toFrame(o, lo, la))).filter(r => r.length >= 3);
      if (campus.length) e.campus = campus;
      returnTo.current = safeWalkBack(q.get("back")) ?? safeWalkBack(restored?.back);
      // (the register first: a block of flats goes by its flats, the rest by their floors)
      const pnu = await direct.current.pnuOf(e);
      const area = foot.length >= 3 ? Math.abs(foot.reduce((t, [x1, y1], i) => { const [x2, y2] = foot[(i + 1) % foot.length]; return t + x1 * y2 - x2 * y1; }, 0)) / 2 : 0;
      const reg = pnu ? await fetch(`/api/realestate/building-floors?${new URLSearchParams({ pnu, ...(area ? { area: area.toFixed(0) } : {}) })}`, { signal: AbortSignal.timeout(18000) }).then(r => r.ok ? r.json() : null).catch(() => null) : null;
      const b = reg?.building ?? {};
      e.name = b.name || e.name || "건물"; e.floors = b.floors || e.floors; e.useLabel = b.use ?? undefined;
      // (its businesses as registered, on their floors, inside its outline)
      const places = await fetch(`/api/realestate/places?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&r=150`, { signal: AbortSignal.timeout(18000) }).then(r => r.ok ? r.json() : null).catch(() => null);
      if (places?.items && e.foot) e.tenants = (places.items as { lat: number; lon: number; name: string; kind: string; category: string | null; floor?: number | null }[])
        .filter(p => { const [px, py] = toFrame(o, p.lon, p.lat); return inPoly(px, py, e.foot!); }).map(p => ({ name: p.name, kind: p.kind, category: p.category, lat: p.lat, lon: p.lon, floor: p.floor ?? null }));
      setStart({ lat, lon, name: e.name, key, domain, id: q.get("id") ?? `place:${e.name}`, built: null });
      const flats = /공동주택|아파트|연립|다세대/.test(`${b.use ?? ""} ${b.useDetail ?? ""}`) && (b.floors ?? 0) >= 4;
      if (flats) { e.kind = "apartment"; e.dong = (b.name ?? "").match(/(\d+|[가-힣A-Z])동$/)?.[0] ?? b.name ?? ""; e.name = (b.name ?? e.name).replace(/\s*(제\s*)?[0-9A-Z]{1,4}\s*동$/, "").trim() || e.name; pendingEnter.current = e; }
      else pendingEnter.current = e;
    } catch { setError("건물 외곽 정보를 불러오지 못했습니다. 잠시 후 이 주소를 다시 열어 주세요."); setPhase("error"); }
  };
  const pendingEnter = useRef<Entrance | null>(null);
  const pendingFacility = useRef<number | null>(null);
  useEffect(() => { const l = pendingFacility.current; if (l === null || !renderer.current) return; pendingFacility.current = null; openFacility(l); });
  // (the start set, the renderer up: in)
  useEffect(() => { const e = pendingEnter.current; if (!e || !start || !renderer.current) return; pendingEnter.current = null; enter(e); });
  const enter = (e: Entrance) => {
    if (!start || game.current?.cycling||game.current?.driving) return;
    const g = geo();
    if (g && e.foot && e.foot.length >= 3) {
      const foot = e.foot.map(([x, y]) => g.lonLatOf(x, y)), [lat, lon] = walkAnchor(foot);
      const back = returnTo.current ?? safeWalkBack(q.get("back")) ?? (game.current ? outdoorUrl.current : null);
      const entry: WalkEntry = { lat, lon, name: e.name, floors: e.floors, heading: e.heading, foot,
        campus: (e.campus ?? []).map(r => r.map(([x, y]) => g.lonLatOf(x, y))), door: g.lonLatOf(e.x, e.y), back: back ?? undefined };
      rememberWalkEntry(entry); shareBase.current = walkLink(lat, lon);
      returnTo.current = back ?? `/drone-explore?lat=${start.lat.toFixed(6)}&lon=${start.lon.toFixed(6)}&walkat=${e.x.toFixed(2)},${e.y.toFixed(2)},${Math.atan2((e.cx ?? 0) - e.x, -((e.cy ?? 0) - e.y)).toFixed(3)}`;
      history.replaceState(history.state, "", shareBase.current);
    }
    if (e.kind === "building") { enterBuilding(e); return; }
    sound.resume();
    game.current?.pause();
    document.exitPointerLock?.();
    setEntering(e); setVisit(null); setUnits(null); setUnitsErr(""); setPhase("choose");
    const ctrl = new AbortController();
    // (the building's PNU first, for its register rows; the trades without it)
    (geo() ? geo()!.pnuOf(e) : Promise.resolve(null)).then(async pnu => {
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
      onTvMenu: () => { setTvOpen(true); zoomTo("tv"); document.exitPointerLock?.(); },
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
    if (exiting.current) return;
    exiting.current = true;
    setVending(null); setMonitorOpen(false); setLiftPanel(null); setCameraPanel(false);
    document.exitPointerLock?.();
    setFade(true);
    setTimeout(() => {
      interior.current?.dispose(); interior.current = null; setHud(null);
      exiting.current = false;
      if (game.current && entering) { game.current.returnFromInterior(entering); history.replaceState(history.state, "", outdoorUrl.current); shareBase.current = null; setPhase("outdoor"); setNear(null); setFade(false); }
      else leave();
    }, 500);
  };
  // into a building: its register floors (표제부 + 층별개요) for its pnu, then its floors built live
  const enterBuilding = (e: Entrance) => {
    if (!renderer.current) return;
    sound.resume(); game.current?.pause(); document.exitPointerLock?.();
    setEntering(e); setBhud(null); setLiftPanel(null); setPhase("building-loading"); setProgress({ k: 0.05, text: "건축물대장에서 층별 정보를 찾는 중" });
    (geo() ? geo()!.pnuOf(e) : Promise.resolve(null)).then(async pnu => {
      let info: RegBuilding = { name: e.name, floors: e.floors, use:e.useLabel }, floors: RegFloor[] = [], src = "건축물대장 정보 없음 · 추정 구성";
      const g=geo()!, [lon,lat]=g.lonLatOf(e.cx??e.x,e.cy??e.y);
      const surveyRequest=getSurvey<SurveyBuilding>(`/api/realestate/indoor-building?${new URLSearchParams({lat:String(lat),lon:String(lon),name:e.name})}`);
      if (pnu) {
        // (its footprint's area picks the right block of a campus: a hospital's main block, not its labs)
        const fa = e.foot && e.foot.length > 2 ? Math.abs(e.foot.reduce((t, [x1, y1], i) => { const [x2, y2] = e.foot![(i + 1) % e.foot!.length]; return t + x1 * y2 - x2 * y1; }, 0)) / 2 : 0;
        const r = await fetch(`/api/realestate/building-floors?${new URLSearchParams({ pnu, name: e.name, ...(fa ? { area: fa.toFixed(0) } : {}) })}`, { signal: AbortSignal.timeout(18000) }).catch(() => null);
        if (r?.ok) { const d = await r.json(); info = { ...d.building, name: d.building?.name || e.name }; floors = d.floors ?? []; src = `건축물대장 표제부·층별개요 · 지상 ${info.floors ?? "?"}층 / 지하 ${info.basements ?? 0}층 · 승강기 ${(info.rideLifts ?? 0) + (info.emergencyLifts ?? 0)}대`; }
      }
      setBsource(src);
      // (the shell: the building's surveyed outline, the door where it was gone into)
      const shape = plateOf(e.foot, e.heading, info.buildingArea, [e.x, e.y]);
      const survey=await surveyRequest;
      const tenants=(e.tenants??[]).filter(t=>t.floor!=null).map(t=>({name:t.name,kind:t.kind,category:t.category,level:t.floor!}));
      const frame=survey?.status==="available"?survey.frame:null;
      const surveyOutline=frame&&survey?.outlines?.[0]?.[0]?.map(([x,y])=>[x-frame.x,frame.depth-(y-frame.y)] as [number,number]);
      const plan = planBuilding(info, floors, frame?.width??shape.W, frame?.depth??shape.D, surveyOutline??shape.poly, frame?frame.width/2:shape.doorX,tenants);
      const origin=frame?g.frameOf(frame.lon,frame.lat):[0,0];
      const entry:[number,number]=frame?[e.x-origin[0],frame.depth-(e.y-origin[1])]:[shape.doorX,0];
      const surveyState=survey?.status??"unavailable";
      const hospital=/의료|병원|의원/.test(`${info.use??""} ${info.useDetail??""} ${info.name??""}`);
      if (q.get("legacy") !== "1") {
        // (the plate along the street its longer side; a hospital's departments for its clinic rooms)
        const W0 = frame?.width ?? shape.W, D0 = frame?.depth ?? shape.D;
        const depts = hospital ? await fetch(`/api/realestate/hospital-departments?${new URLSearchParams({ lat: String(lat), lon: String(lon), name: info.name ?? e.name })}`, { signal: AbortSignal.timeout(18000) }).then(r => r.ok ? r.json() : null).catch(() => null) : null;
        // (the plan's frame: the survey's — x east from its corner, z south — else the footprint's own)
        const fx0 = Math.min(...(e.foot ?? [[0, 0]]).map(p => p[0])), fy1 = Math.max(...(e.foot ?? [[0, 0]]).map(p => p[1]));
        const toPlan = frame ? (x: number, y: number): [number, number] => [x - origin[0], frame.depth - (y - origin[1])] : (x: number, y: number): [number, number] => [x - fx0, fy1 - y];
        fac.current = { info, floors, W: Math.max(W0, D0), D: Math.min(W0, D0), levels: facilityLevels(plan.levels, floors), tenants: plan.tenants,
          toPlan, foot: e.foot, entry: toPlan(e.x, e.y), campus: hospital && e.campus?.length ? e.campus : undefined,
          departments: ((depts?.departments ?? []) as { name: string; doctors: number }[]).sort((a, c) => c.doctors - a.doctors).map(d => d.name), key: `${pnu ?? ""}|${info.name ?? e.name}`,
          survey: frame && survey?.id ? { id: survey.id, frame, outline: survey.outlines?.map(p => p.map(r => r.map(([x, y]) => [x - frame.x, frame.depth - (y - frame.y)] as [number, number]))) ?? null, entry: [e.x - origin[0], frame.depth - (e.y - origin[1])] } : undefined };
        const requested = Number(q.get("f") ?? 1);
        openFacility(plan.levels.includes(requested) ? requested : plan.levels.includes(1) ? 1 : plan.levels[0] ?? 1);
        return;
      }
      let stackReq:Promise<{status:string;level?:number;cores?:{type:string;polygons:[number,number][][][]}[]}|null>|null=null,deptReq:Promise<{departments?:{name:string;doctors:number}[]}|null>|null=null;
      setBsource(`${src} · ${surveyState==="available"?"SGIS 건물 매칭":surveyState==="unconfigured"?"SGIS 키가 서버에 설정되지 않음":surveyState==="auth_error"?"SGIS 인증 확인 필요":surveyState==="not_covered"?"SGIS 도면 미제공 건물":"SGIS 응답 지연·연결 실패"}`);
      const bi = new BuildingInterior(renderer.current!, {
        plan, seed: Math.abs([...e.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)), hour,
        onHud: setBhud, onLiftPanel: p => { setLiftPanel(p); if (p) document.exitPointerLock?.(); }, onProgress: (k, text) => setProgress({ k, text }), onExit: () => exitBuilding(),
        onTalk:t=>{setTalk(t);if(t)document.exitPointerLock?.();},
        loadFloor:async level=>{
          // every floor fitted out by the common generator: this floor's chart (SGIS), the cores from
          // the nearest charted floor, the register's use, the businesses here, a hospital's departments
          const P=(p:[number,number]):[number,number]=>frame?[p[0]-frame.x,frame.depth-(p[1]-frame.y)]:p;
          const data=frame&&survey?.id?await getSurvey<SurveyFloor>(`/api/realestate/indoor-floor?id=${encodeURIComponent(survey.id)}&level=${level}`):null;
          const own=data?.status==="available"&&data.outlines?.length?data:null;
          const stackP=frame&&survey?.id&&!(own?.rooms??[]).some(r=>r.type==="32"||r.type==="34")?(stackReq??=getSurvey<{status:string;level?:number;cores?:{type:string;polygons:[number,number][][][]}[]}>(`/api/realestate/indoor-stack?id=${encodeURIComponent(survey.id)}&levels=${plan.levels.join(",")}`)):null;
          const stack=stackP?await stackP:null;
          const outline=own?own.outlines!.map(p=>p.map(r=>r.map(P))):[[plan.poly??[[0,0],[plan.W,0],[plan.W,plan.D],[0,plan.D]]]];
          const coreRooms=(own?.rooms??[]).some(r=>r.type==="32"||r.type==="34")?own!.rooms!.filter(r=>/^(32|33|34|35|40)$/.test(r.type)):stack?.status==="available"?stack.cores??[]:[];
          const company=(ring:[number,number][])=>own?.companies?.find(c=>{const q=P([c.x,c.y]);let h=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,zi]=ring[i],[xj,zj]=ring[j];if((zi>q[1])!==(zj>q[1])&&q[0]<(xj-xi)*(q[1]-zi)/(zj-zi)+xi)h=!h;}return h;});
          const src:FitSource={outline,
            rooms:(own?.rooms??[]).flatMap(r=>r.polygons.map(p=>{const poly=p.map(q=>q.map(P));const c=r.type==="10"?company(poly[0]):undefined;return {type:r.type,poly,name:c?.name,category:c?.category};})),
            cores:coreRooms.flatMap(r=>r.polygons.map(p=>({type:r.type,ring:p[0].map(P)}))),
            coresFrom:(own?.rooms??[]).some(r=>r.type==="32"||r.type==="34")?level:stack?.status==="available"?stack.level??null:null};
          const depts=hospital?await (deptReq??=fetch(`/api/realestate/hospital-departments?${new URLSearchParams({lat:String(lat),lon:String(lon),name:info.name??e.name})}`).then(r=>r.ok?r.json():null).catch(()=>null)):null;
          return fitOut({b:plan,level,src,entry:frame?entry:[shape.doorX,0.2],departments:(depts?.departments??[]).sort((a:{doctors:number},c:{doctors:number})=>c.doctors-a.doctors).map((d:{name:string})=>d.name),tenants:plan.tenants.filter(t=>t.level===level),seed:7,year:2019});
        },
      });
      building.current = bi;
      bi.resize(canvas.current!.clientWidth, canvas.current!.clientHeight);
      await bi.load();
      if (building.current !== bi) return;
      bi.start(); setPhase("building");
    }).catch(err => { console.error(err); setError("건물 내부를 만들지 못했습니다: " + String(err)); setPhase("error"); });
  };
  /** One floor of the building: its plan from the register's use for it, its businesses, built and
   * lit by the flats' engine; the lift's panel brings another */
  const openFacility = async (level: number) => {
    const f = fac.current; if (!f || !renderer.current) return;
    const reg = f.floors.find(x => x.level === level), main = reg?.uses.slice().sort((a, b) => b.area - a.area)[0];
    const kind = facilityKindOf(kindOf(main?.use ?? f.info.use ?? "", main?.detail ?? f.info.useDetail ?? "", level, f.info));
    const lv = f.levels.find(l => l.level === level);
    const base = { id: f.key, name: f.info.name || entering?.name || "건물", kind, level, levelLabel: lv?.label ?? (level < 0 ? `지하 ${-level}층` : `${level}층`), use: lv?.uses ?? "",
      width: f.W, depth: f.D, tenants: f.tenants.filter(t => t.level === level).map(t => t.name), departments: f.departments, built: f.info.approved ? Number(String(f.info.approved).slice(0, 4)) || null : null };
    setPhase("interior-loading"); setProgress({ k: 0, text: "이 층의 도면을 찾는 중" });
    // (the floor's drawing, where the survey has one: its outline and partitions; the cores of the
    // nearest charted floor; else its outline as the building's; else the rules on the footprint)
    let p: FloorPlan | null = null;
    const sv = f.survey;
    // (a hospital's ground floor: its other blocks with it, joined by passages — campusFloor)
    const campus = level === 1 && f.campus && f.toPlan ? f.campus.map(r => r.map(([x, y]) => f.toPlan!(x, y))) : [];
    if (sv) {
      const P = (q: [number, number]): [number, number] => [q[0] - sv.frame.x, sv.frame.depth - (q[1] - sv.frame.y)];
      const data = await getSurvey<SurveyFloor>(`/api/realestate/indoor-floor?id=${encodeURIComponent(sv.id)}&level=${level}`);
      const own = data?.status === "available" && data.outlines?.length ? data : null;
      const charted = (own?.rooms ?? []).length > 0;
      const stack = !charted ? await (sv.stack ??= getSurvey(`/api/realestate/indoor-stack?id=${encodeURIComponent(sv.id)}&levels=${f.levels.map(l => l.level).join(",")}`)) : null;
      const outline0 = own ? own.outlines!.map(q => q.map(r => r.map(P))) : sv.outline;
      const joined = outline0?.length ? campusFloor(outline0, campus) : null, outline = joined?.outline ?? outline0;
      if (outline?.length) {
        const company = (ring: [number, number][]) => own?.companies?.find(c => { const q = P([c.x, c.y]); let h = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, zi] = ring[i], [xj, zj] = ring[j]; if ((zi > q[1]) !== (zj > q[1]) && q[0] < (xj - xi) * (q[1] - zi) / (zj - zi) + xi) h = !h; } return h; });
        p = generateSurveyed({ ...base, outline, entry: sv.entry, seed: Math.abs([...`${f.key}|${level}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 5)),
          partitions: [...(own?.rooms ?? []).flatMap(r => r.polygons.map(q => { const poly = q.map(rr => rr.map(P)); const c = r.type === "10" || r.type === "20" ? company(poly[0]) : undefined; return { type: r.type, poly, name: c?.name, category: c?.category }; })), ...(joined?.links ?? [])],
          cores: stack?.status === "available" ? (stack.cores ?? []).flatMap(c => c.polygons.map(q => ({ type: c.type, ring: q[0].map(P) }))) : [] });
      }
    }
    // (no survey: the footprint as the drone view drew it — the whole of it, and a hospital's blocks with it)
    if (!p && f.foot && f.foot.length >= 3 && f.toPlan) {
      const joined = campusFloor([[f.foot.map(([x, y]) => f.toPlan!(x, y))]], campus);
      p = generateSurveyed({ ...base, outline: joined.outline, entry: f.entry ?? null, seed: Math.abs([...`${f.key}|${level}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 5)), partitions: joined.links, cores: [] });
    }
    if (!p) p = generateFacility(base);
    sound.resume(); document.exitPointerLock?.();
    setLiftPanel(null); setVending(null); setMonitorOpen(false); setHud(null);
    interior.current?.dispose(); interior.current = null;
    setPlan(p); setFade(true); setPhase("interior-loading"); setProgress({ k: 0, text: level === 1 ? "출입문으로 들어가는 중" : "엘리베이터로 이동하는 중" });
    const it = new Interior(renderer.current, {
      plan: p, hour, view: null, sound, levels: f.levels,
      onProgress: (k, text) => setProgress({ k, text }), onHud: h => setHud(h), onExit: () => exitFlat(),
      onLift: () => { setLiftPanel({ levels: f.levels, current: level }); document.exitPointerLock?.(); },
      onVending: session => { setVending(session); document.exitPointerLock?.(); },
      onMonitor: () => { setMonitorOpen(true); document.exitPointerLock?.(); },
    });
    interior.current = it;
    it.resize(canvas.current!.clientWidth, canvas.current!.clientHeight);
    it.load().then(() => {
      if (interior.current !== it) return;
      it.start(); setPhase("interior");
      if (shareBase.current) history.replaceState(history.state, "", shareBase.current + (level === 1 ? "" : `&f=${level}`));
      setTimeout(() => setFade(false), 120);
    }).catch(err => { console.error(err); setError("건물 내부를 만들지 못했습니다: " + String(err)); setPhase("error"); });
  };
  // (the checks in scripts/: any floor of the building gone into, as its lift's panel would)
  useEffect(() => { if (debug) Object.assign(window, { __walkFloor: openFacility }); });
  const exitBuilding = () => {
    document.exitPointerLock?.();
    building.current?.dispose(); building.current = null; setBhud(null); setLiftPanel(null);setTalk(null);
    if (game.current && entering) { game.current.returnFromInterior(entering); history.replaceState(history.state, "", outdoorUrl.current); shareBase.current = null; setPhase("outdoor"); setNear(null); }
    else leave();
  };

  const leave = () => { const b = returnTo.current ?? safeWalkBack(q.get("back")); if (b) location.href = b; else if (history.length > 1) history.back(); else location.href = "/realestate-map"; };

  // keys the page owns: Esc leaves (back to the street, then the map), E enters a building
  const exiting = useRef(false), lastEscape = useRef(-Infinity), unlockedAt = useRef(-Infinity), escapeHandled = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (e.code === "Escape") {
        if (e.type === "keydown") escapeHandled.current = true;
        if (e.repeat || performance.now() - lastEscape.current < 350) return;
        lastEscape.current = performance.now(); e.preventDefault();
        if (cameraPanel) { setCameraPanel(false); return; }
        if (monitorOpen) { closeMonitor(); return; }
        if (vending) { setVending(null); return; }
        if (phase === "interior") { if (liftPanel) setLiftPanel(null); else exitFlat(); return; }
        if (phase === "building") { if (talk) building.current?.closeTalk(); else if (liftPanel) building.current?.closeLiftPanel(); else exitBuilding(); return; }
        if (phase === "choose" && game.current) { game.current.resume(); setPhase("outdoor"); }
        else if (phase === "outdoor") leave();
        return;
      }
      if (monitorOpen || vending || liftPanel || cameraPanel) return;
      if (target?.isContentEditable || target?.matches("input, textarea, select")) return;
      sound.resume();
      if (e.code === "KeyC" && !e.repeat) { active()?.resetLook(); return; }
      if (e.code === "KeyH") setShowHelp(s => !s);
      if(e.code==="KeyF"&&phase==="outdoor"&&!e.repeat){if(game.current?.interactCar())e.preventDefault();return;}
      if ((e.code === "KeyE" || e.code === "Enter") && phase === "outdoor" && !e.repeat) {
        if(game.current?.driving){game.current.interactCar();e.preventDefault();return;}
        if (near && !game.current?.cycling) { e.preventDefault(); enter(near); return; }
        if (game.current?.interactBicycle()) { e.preventDefault(); return; }
      }
    };
    // Chrome consumes Escape's keydown when it releases pointer lock, but delivers keyup.
    const lock = () => { if (!document.pointerLockElement) unlockedAt.current = performance.now(); };
    const up = (e: KeyboardEvent) => { if (e.code !== "Escape") return; const handled = escapeHandled.current; escapeHandled.current = false; if (!handled && performance.now() - unlockedAt.current < 900) down(e); };
    document.addEventListener("pointerlockchange", lock);
    window.addEventListener("keydown", down, true); window.addEventListener("keyup", up, true);
    return () => { document.removeEventListener("pointerlockchange", lock); window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true); };
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
      const p = viewPreferences(); active()?.look(e.movementX * 0.0022 * p.sensitivity, e.movementY * 0.0022 * p.sensitivity * (p.invertY ? -1 : 1));
    };
    window.addEventListener("mousemove", mm);
    document.addEventListener("pointerlockchange", lc);
    window.addEventListener("focus", lc);
    return () => { window.removeEventListener("mousemove", mm); document.removeEventListener("pointerlockchange", lc); window.removeEventListener("focus", lc); };
  }, []);
  const onDown = (e: React.PointerEvent) => {
    sound.resume();
    if (vending || monitorOpen || liftPanel || cameraPanel || talk) return;
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea, iframe")) return;
    if (e.pointerType === "touch") {
      if (!touch) setTouch(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      if (e.clientX < window.innerWidth * 0.42 && !stick.current) { stick.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; setStickAt({ x: e.clientX, y: e.clientY, dx: 0, dy: 0 }); }
      else if (!drag.current) drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    const c = canvas.current;
    if ((phase === "interior" || phase === "outdoor" || phase === "building") && c?.isConnected && !exiting.current && document.visibilityState === "visible") {
      // Escape/navigation can detach the document before the browser resolves this request.
      try { const pending = c.requestPointerLock?.(); if (pending) void pending.catch(() => undefined); } catch { /* The browser may cancel the request synchronously too. */ }
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (stick.current?.id === e.pointerId) {
      const dx = e.clientX - stick.current.x, dy = e.clientY - stick.current.y, r = 56, l = Math.hypot(dx, dy), k = l > r ? r / l : 1;
      setStickAt({ x: stick.current.x, y: stick.current.y, dx: dx * k, dy: dy * k });
      const gain = l < r * .12 ? 0 : (Math.min(l / r, 1) - .12) / .88;
      active()?.setStick(l ? dx / l * gain : 0, l ? -dy / l * gain : 0, l > r * 1.35);
    } else if (drag.current?.id === e.pointerId) {
      const p = viewPreferences(); active()?.look((e.clientX - drag.current.x) * 0.0032 * p.sensitivity, (e.clientY - drag.current.y) * 0.0032 * p.sensitivity * (p.invertY ? -1 : 1));
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
    <div ref={root} className={`wk-root${fade ? " is-fading" : ""}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onLostPointerCapture={onUp}>
      <canvas ref={canvas} className="wk-canvas" />
      <div className="wk-fade" />

      {(phase === "boot" || phase === "outdoor-loading" || phase === "interior-loading" || phase === "building-loading") && (
        <div className="wk-loading">
          <div className="wk-load-card">
            <span className="wk-kicker">{phase === "interior-loading" ? (plan?.facility ? `${plan.facility.name} · ${plan.facility.levelLabel}` : `${plan?.complexName ?? ""} ${plan?.dong ?? ""} · ${plan?.floor ?? ""}층`) : "직접 걷기"}</span>
            <h1>{phase === "interior-loading" ? (plan?.facility ? `${FACILITY_LABEL[plan.facility.kind]} 내부를 만드는 중` : "세대 실내를 만드는 중") : phase === "building-loading" ? `${entering?.name ?? "건물"} 내부를 만드는 중` : start?.name ?? "단지를 찾는 중"}</h1>
            <div className="wk-bar"><i style={{ transform: `scaleX(${Math.max(0.02, progress.k)})` }} /></div>
            <p className="wk-progress-text">{progress.text}<b>{Math.round(progress.k * 100)}%</b></p>
            {phase === "interior-loading" && plan && (plan.facility ? <p className="wk-sub">{plan.template} · 바닥 {plan.areaExclusiveM2}㎡ · {plan.basis.rooms}</p> : <p className="wk-sub">{plan.template} · 전용 {plan.areaExclusiveM2.toFixed(2)}㎡ · {STYLE_LABEL[plan.style]} · 고품질 자재 약 9MB (첫 방문만)</p>)}
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
          {plan.facility ? (
            <div className="wk-topbar">
              <div className="wk-where"><b>{plan.facility.name} · {plan.facility.levelLabel}</b><span>{hud?.room} · {FACILITY_LABEL[plan.facility.kind]} · 사람 {interior.current?.people?.count ?? 0}명</span></div>
              <div className="wk-meta" title={bsource}><span className="wk-badge">추정 공간</span>{plan.template} · {plan.facility.use ? `층 용도: ${plan.facility.use}` : plan.basis.rooms} · 실내 배치는 추정 · {bsource}</div>
              <div className="wk-actions">
                <button className="wk-btn" onClick={copyLink}>{copyStatus || "링크 복사"}</button>
                <button className="wk-btn" onClick={() => { setLiftPanel({ levels: fac.current?.levels ?? [], current: plan.facility!.level }); document.exitPointerLock?.(); }}>🛗 층 이동</button>
                <button className="wk-btn" onClick={() => interior.current?.toggleView()}>{hud?.view === "third" ? "1인칭으로" : "3인칭으로"} <kbd>V</kbd></button>
                <button className="wk-btn" onClick={exitFlat}>나가기 <kbd>Esc</kbd></button>
              </div>
            </div>
          ) : (
          <div className="wk-topbar">
            <div className="wk-where"><b>{plan.complexName} {plan.dong} {plan.floor}층</b><span>{hud?.room}</span></div>
            <div className="wk-meta"><span className="wk-badge">추정 평면</span>{plan.template} · 전용 {plan.areaExclusiveM2.toFixed(2)}㎡ (방 합계 {plan.check.areaM2}㎡, {(plan.check.error * 100).toFixed(1)}%) · {STYLE_LABEL[plan.style]} · 연출용 가상 인테리어</div>
            <div className="wk-actions">
              <button className="wk-btn" onClick={() => interior.current?.toggleView()}>{hud?.view === "third" ? "1인칭으로" : "3인칭으로"} <kbd>V</kbd></button>
              <button className="wk-btn" onClick={exitFlat}>나가기 <kbd>Esc</kbd></button>
            </div>
          </div>)}
          {plan.facility && liftPanel && (
            <div className="wk-prompt wk-lift" onPointerDown={e => e.stopPropagation()}>
              <p><b>엘리베이터</b> · 현재 {liftPanel.levels.find(l => l.level === liftPanel.current)?.label}</p>
              <div className="wk-lift-grid">
                {[...liftPanel.levels].reverse().map(l => (
                  <button key={l.level} className={`wk-btn${l.level === liftPanel.current ? " on" : ""}`} disabled={l.level === liftPanel.current} onClick={() => openFacility(l.level)} title={l.uses}>
                    <b>{l.label}</b>{l.uses && <small>{l.uses}</small>}
                  </button>
                ))}
              </div>
              <div className="wk-row"><button className="wk-btn" onClick={() => setLiftPanel(null)}>닫기 <kbd>Esc</kbd></button></div>
            </div>
          )}
          {!vending && hud?.seated !== "화면" && hud?.seated !== "반려동물" && <MiniMap plan={plan} subject={mapSubject} />}
          {vending && <VendingMenu key={vending.id} session={vending} onClose={() => setVending(null)} />}
          {monitorOpen && <FacilityBrowser corners={monitorCorners} onClose={closeMonitor} onZoom={on => interior.current?.zoomScreen(on ? "monitor" : null)} />}
          {tvOpen && <TvBrowser corners={tvCorners} zoom={{ on: zoomed === "tv", set: on => zoomTo(on ? "tv" : null) }} onOff={() => { interior.current?.tvPower(false); setTvOpen(false); if (zoomed === "tv") zoomTo(null); }} onPicture={img => interior.current?.tvPicture(img)} />}
          {laptopOpen && <LaptopScreen corners={laptopCorners} zoom={{ on: zoomed === "laptop", set: on => zoomTo(on ? "laptop" : null) }} onClose={() => { interior.current?.closeLaptop(); setLaptopOpen(false); setZoomed(null); }} />}
          <div className="wk-cross" />
          {hud?.target && !touch && !vending && !monitorOpen && !liftPanel && <div className="wk-hint"><kbd>E</kbd> {hud.target}{hud.pet && <> · <kbd>Z</kbd> 확대해서 보기</>}</div>}
          {hud?.pet && touch && <button className="wk-btn wk-pet-zoom" onPointerDown={e => { e.stopPropagation(); interior.current?.zoomPet(true); }}>🔍 확대해서 보기</button>}
          {hud?.seated === "반려동물" && <div className="wk-laptop-bar" onPointerDown={e => e.stopPropagation()}><span>가까이서 보는 중</span><button className="wk-btn" onClick={() => interior.current?.zoomPet(false)}>축소 <kbd>Z</kbd></button></div>}
          {hud?.seated && hud.seated !== "화면" && hud.seated !== "반려동물" && <div className="wk-hint is-seat">{hud.seated} · 이동키를 누르면 일어납니다</div>}
          {showHelp && !touch && <div className="wk-help" onClick={() => setShowHelp(false)}>{plan.facility ? "클릭해서 둘러보기 시작 · WASD 이동 · Shift 달리기 · E 상호작용 (문·엘리베이터·사람과 대화·의자·수전·스위치) · V 3인칭 · M 지도 · Esc 나가기" : "클릭해서 둘러보기 시작 · WASD 이동 · Shift 달리기 · E 상호작용 (스위치·수전·변기·커튼·문·TV·소파·침대) · V 3인칭 · H 도움말 · Esc 나가기"}</div>}
        </>
      )}

      {phase === "building" && (
        <>
          <div className="wk-topbar">
            <div className="wk-where"><b>{bhud?.building ?? entering?.name} · {bhud?.floor}</b><span>{bhud?.uses || "층별 용도 정보 없음"} · 사람 {bhud?.people ?? 0}명</span></div>
            <div className="wk-meta" title={bsource}><span className="wk-badge">{bhud?.source?.includes("공간 구획")?"구획 데이터":bhud?.source?.startsWith("SGIS")?"외곽만 실측":"추정 공간"}</span>{bhud?.source} · {bsource}</div>
            <div className="wk-actions">
              <button className="wk-btn" onClick={copyLink}>{copyStatus || "링크 복사"}</button>
              <button className="wk-btn" disabled={!bhud?.lifts} onClick={()=>building.current?.guideToLift()}>엘리베이터 길 안내 ({bhud?.lifts??0})</button>
              <button className="wk-btn" onClick={() => building.current?.toggleView()}>{bhud?.view === "third" ? "1인칭으로" : "3인칭으로"} <kbd>V</kbd></button>
              <button className="wk-btn" onClick={exitBuilding}>나가기 <kbd>Esc</kbd></button>
            </div>
          </div>
          <div className="wk-cross" />
          <BuildingMap building={()=>building.current}/>
          {bhud?.coverage!=="layout"&&<div className="wk-coverage-note">이 층은 실내 도면이 제공되지 않아 자동 재구성한 공간입니다.</div>}
          {bhud?.notice&&!talk&&!liftPanel&&<div className="wk-nav-notice">{bhud.notice}</div>}
          {bhud?.loading&&<div className="wk-hint">층별 공간 데이터를 불러오는 중…</div>}
          {bhud?.prompt && !liftPanel&&!talk && <button className="wk-hint" onClick={()=>building.current?.interact()}><kbd>E</kbd> {bhud.prompt}</button>}
          {talk&&<div className="wk-prompt wk-talk" role="dialog" aria-label="NPC 안내" onPointerDown={e=>e.stopPropagation()}>
            <h3>{talk.name}</h3><p>{talk.text}</p>
            <div className="wk-talk-destinations">{talk.questions?.map((q,i)=><button className="wk-btn" key={`q${i}`} onClick={()=>building.current?.ask(i)}>{q}</button>)}{talk.destinations.map((d,i)=><button className="wk-btn" key={i} onClick={()=>building.current?.guideTo(d.x,d.z)}>{d.label} 길 안내</button>)}</div>
            {talk.directory.length>0&&<details><summary>층별 안내 보기</summary><div className="wk-talk-directory">{talk.directory.map((f,i)=><p key={i}><b>{f.label}</b> {f.uses}</p>)}</div></details>}
            <button className="wk-btn" onClick={()=>building.current?.closeTalk()}>대화 마치기</button>
          </div>}
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

      {(phase === "interior" || phase === "outdoor" || phase === "building") && !vending && !monitorOpen && !liftPanel && <CameraSettings open={cameraPanel} setOpen={setCameraPanel} onCenter={() => active()?.resetLook()} />}
      {(phase === "interior" || phase === "outdoor" || phase === "building") && touch && !vending && !monitorOpen && !liftPanel && !cameraPanel && (
        <div className="wk-touch">
          {!stickAt && <div className="wk-touch-guide">✥<small>이동 · 바깥으로 밀면 달리기</small></div>}
          {stickAt && <div className="wk-stick" style={{ left: stickAt.x - 60, top: stickAt.y - 60 }}><i style={{ transform: `translate(${stickAt.dx}px, ${stickAt.dy}px)` }} /></div>}
          {phase === "interior" && <button className={`wk-act${hud?.target ? " on" : ""}`} onPointerDown={e => { e.stopPropagation(); interior.current?.interact(); }}>{hud?.target ?? "상호작용"}</button>}
          {phase === "interior" && <button className="wk-view" onPointerDown={e => { e.stopPropagation(); active()?.toggleView(); }}>{hud?.view === "third" ? "1인칭" : "3인칭"}</button>}
          {phase === "building" && <button className={`wk-act${bhud?.prompt ? " on" : ""}`} onPointerDown={e => { e.stopPropagation(); building.current?.interact(); }}>{bhud?.prompt ?? "상호작용"}</button>}
          {phase === "building" && <button className="wk-view" onPointerDown={e => { e.stopPropagation(); active()?.toggleView(); }}>{bhud?.view === "third" ? "1인칭" : "3인칭"}</button>}
        </div>
      )}

      {phase==="outdoor"&&reviewEntrance&&<button className="wk-review-entry wk-btn" onClick={()=>{game.current?.placeAt(reviewEntrance,2.2);enterBuilding(reviewEntrance);}}>{reviewEntrance.name} · 실내 검토 시작</button>}
      {phase === "outdoor" && (
        <div className="wk-topbar">
          <div className="wk-where"><b>{start?.name}</b><span>{car.driving?`${car.label} 운전 · 최고 ${car.topKmh}km/h`:bicycle.riding ? "자전거로 실외 탐험 · 최고 60km/h" : "각 동 자전거 E · 길가의 주차 차량 F"}</span></div>
          <div className="wk-actions"><button className="wk-btn" aria-label={soundMuted ? "효과음 켜기" : "효과음 끄기"} aria-pressed={soundMuted} onClick={() => { sound.resume(); sound.setMuted(!soundMuted); setSoundMuted(!soundMuted); }}>{soundMuted ? "🔇" : "🔊"} 효과음</button><button className="wk-btn" aria-label={`현재 ${outdoorView === "first" ? "1인칭" : "3인칭"}, 시점 전환`} onClick={() => game.current?.toggleView()}>{car.driving?(car.view==="third"?"정면으로":"3인칭으로"):outdoorView === "first" ? "3인칭으로" : "1인칭으로"} <kbd>V</kbd></button><button className="wk-btn" onClick={leave}>지도로 <kbd>Esc</kbd></button></div>
        </div>
      )}
      {phase === "outdoor" && <OutdoorMap game={outdoorGame} />}
      {phase === "outdoor" && showHelp && <div className="wk-help" onClick={() => setShowHelp(false)}>{car.driving?(touch?"왼쪽 스틱: 가속·감속·조향 · 브레이크: 정지 · 시점 버튼: 3인칭/정면":"W 가속 · S 제동/후진 · A/D 조향 · Space 핸드브레이크 · F/E 내리기 · V 3인칭/정면"):bicycle.riding ? touch ? "왼쪽 스틱: 가속·조향 · 뒤로: 감속 · 브레이크 버튼: 정지 · 오른쪽 끌기: 시점" : "W·↑ 가속 · A/D·←/→ 조향 · S·↓ 또는 Space 브레이크 · E 내리기 · V 시점 · 마우스로 둘러보기" : touch ? "왼쪽 스틱으로 걷기 · 근처 자전거/차량 타기 버튼" : "WASD 걷기 · Shift 달리기 · E 건물/자전거 · F 주차 차량 운전 · V 시점"}</div>}
    </div>
  );
}

/** A ground floor with the blocks standing with it: their footprints (plan frame) added to its
 * outline — those not already inside it — each joined to the nearest one already joined by a 4 m
 * passage between their closest points, a metre and a half into each. The passages are charted as
 * open floor named 연결통로 (reconstructed: the survey has no drawing of them). */
function campusFloor(outline: [number, number][][][], campus: [number, number][][]): { outline: [number, number][][][]; links: { type: string; poly: [number, number][][]; name: string }[] } {
  const inside = (x: number, y: number, r: [number, number][]) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const centre = (r: [number, number][]) => [r.reduce((t, p) => t + p[0], 0) / r.length, r.reduce((t, p) => t + p[1], 0) / r.length] as [number, number];
  const joined: [number, number][][] = outline.map(p => p[0]);
  const more = campus.filter(r => { const [x, y] = centre(r); return !joined.some(j => inside(x, y, j)); });
  const links: { type: string; poly: [number, number][][]; name: string }[] = [];
  const out = outline.slice();
  const closest = (a: [number, number][], b: [number, number][]) => {
    let best = { d: Infinity, p: a[0], q: b[0] };
    for (const p of a) for (let i = 0; i < b.length; i++) {
      const q0 = b[i], q1 = b[(i + 1) % b.length], dx = q1[0] - q0[0], dy = q1[1] - q0[1], l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - q0[0]) * dx + (p[1] - q0[1]) * dy) / l2)), q: [number, number] = [q0[0] + dx * t, q0[1] + dy * t], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d < best.d) best = { d, p, q };
    }
    return best;
  };
  const left = more.slice();
  while (left.length) {
    // the block nearest any joined one, joined to it
    let pick = { i: 0, c: { d: Infinity, p: [0, 0] as [number, number], q: [0, 0] as [number, number] } };
    left.forEach((r, i) => { for (const j of joined) { const a = closest(r, j), b = closest(j, r), c = a.d < b.d ? { d: a.d, p: a.q, q: a.p } : b; if (c.d < pick.c.d) pick = { i, c }; } });
    const r = left.splice(pick.i, 1)[0];
    if (pick.c.d > 60) continue;
    out.push([r]); joined.push(r);
    if (pick.c.d > 0.5) {
      // (from the joined block's point to the new block's, overlapping both by 1.5 m, 4 m wide)
      const [ax, ay] = pick.c.p, [bx, by] = pick.c.q, L = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy * 2, ny = ux * 2;
      const a: [number, number] = [ax - ux * 1.5, ay - uy * 1.5], b: [number, number] = [bx + ux * 1.5, by + uy * 1.5];
      const ring: [number, number][] = [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]];
      out.push([ring]); links.push({ type: "20", poly: [ring], name: "연결통로 (재구성)" });
    }
  }
  return { outline: out, links };
}
