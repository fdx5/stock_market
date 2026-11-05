import * as THREE from "three";
import * as M from "./models";
import type { Extra } from "./facilityModels";
import type { Frame, Placer, SideName, Sound } from "./furnish";
import type { FacCtx } from "./facilityFurnish";
import type { FacilityKind, Room, RoomType } from "./plan/types";

/* The equipment of a building's rooms beyond their main furniture — what a real office, clinic,
 * shop, station, school, gym or museum of its kind has on its walls and floor: copiers and water
 * coolers, number-ticket machines and blood-pressure booths, digital signage and price checkers,
 * ticket gates and arrival boards, electronic whiteboards and lockers, InBody scales, audio-guide
 * kiosks, fire cabinets and AEDs, clocks that tell the time. Each kind in a few shapes and colours
 * (chosen by the building and the room), most electronic ones working: they light up, show
 * something live, take a card, print, measure, beep. Placed after a room's own furnishing, on what
 * wall and floor it leaves. */

type Kit = M.Kit;
const { bx, rb, cy } = M;
/** a disc facing +z (a clock face, a wheel seen from the side when turned) */
const disc = (m: THREE.Material, r: number, t: number, x: number, y: number, z: number, axis: "z" | "x" = "z"): M.Part => ({ m, g: new THREE.CylinderGeometry(r, r, t, 32).rotateX(axis === "z" ? Math.PI / 2 : 0).rotateZ(axis === "x" ? Math.PI / 2 : 0).translate(x, y, z) });

export interface DressApi {
  c: FacCtx; room: Room; pl: Placer; zone: number; kind: FacilityKind; name: string; H: number;
  doorSide: SideName;
  wallPut(s: SideName, kit: Kit, w: number, d: number, prefer?: number | null, height?: number, solid?: boolean, clear?: number): Frame | null;
  freeNear(x: number, z: number, w: number, d: number, yaw?: number): Frame | null;
  at(f: Frame | THREE.Matrix4, x: number, y: number, z: number): THREE.Vector3;
}

/** what a fixture does when used: its button's words now, and the act (a sound back) */
interface Use { label(): string; act(): Sound | null; update?(dt: number): void; box: [number, number, number, number, number, number] }
interface Made { kit: Kit; screen?: { w: number; h: number; x: number; y: number; z: number; paint: Painter; fps?: number; on?: boolean }; use?: (s: Live) => Use }
/** a live screen's drawing: the canvas, the time, the state its fixture keeps */
type Painter = (g: CanvasRenderingContext2D, W: number, H: number, t: number, st: Record<string, number | string | boolean>) => void;
interface Live { st: Record<string, number | string | boolean>; screenOn(on: boolean): void; toast(t: string): void; fx(n: Parameters<NonNullable<FacCtx["hooks"]["fx"]>>[0]): void; consume(name: string, color: string): void }

interface Def {
  id: string; label: string;
  /** which rooms take it (by room type, and the building's kind if it matters) */
  rooms: RoomType[]; kinds?: FacilityKind[];
  /** against a wall (its back at the wall) or free-standing */
  wall: boolean; w: number; d: number; h: number;
  /** how many of its looks */
  looks: number;
  /** at most this many in a room; its weight in the draw */
  max?: number; weight?: number;
  /** only in rooms this big (m²) */
  minArea?: number;
  make(P: import("./materials").Palette, X: Extra, v: number, api: DressApi): Made;
}

// ---------------------------------------------------------------- screens drawn live
const font = (px: number, w = 700) => `${w} ${px}px "Pretendard","Noto Sans KR","Malgun Gothic",sans-serif`;
const clockFace: Painter = (g, W, H) => {
  const now = new Date(), r = Math.min(W, H) * 0.46, x = W / 2, y = H / 2;
  g.fillStyle = "#f7f7f3"; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#222"; g.lineWidth = r * 0.05; g.stroke();
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.lineWidth = i % 3 ? r * 0.025 : r * 0.05; g.beginPath(); g.moveTo(x + Math.sin(a) * r * 0.8, y - Math.cos(a) * r * 0.8); g.lineTo(x + Math.sin(a) * r * 0.92, y - Math.cos(a) * r * 0.92); g.stroke(); }
  const hand = (a: number, l: number, w: number, c: string) => { g.strokeStyle = c; g.lineWidth = w; g.lineCap = "round"; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.sin(a) * l, y - Math.cos(a) * l); g.stroke(); };
  const h = now.getHours() % 12, m = now.getMinutes(), s = now.getSeconds();
  hand((h + m / 60) / 12 * Math.PI * 2, r * 0.5, r * 0.07, "#111"); hand((m + s / 60) / 60 * Math.PI * 2, r * 0.75, r * 0.045, "#111"); hand(s / 60 * Math.PI * 2, r * 0.82, r * 0.015, "#c62828");
};
const digitalClock: Painter = (g, W, H) => {
  const now = new Date();
  g.fillStyle = "#050607"; g.fillRect(0, 0, W, H); g.fillStyle = "#ff3b30"; g.font = font(H * 0.6); g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`, W / 2, H / 2);
};
const STATIONS = ["시청", "을지로입구", "강남", "역삼", "선릉", "삼성", "잠실", "건대입구", "왕십리", "홍대입구", "신촌", "사당", "교대", "서울역", "종각"];
const arrivals: Painter = (g, W, H, t, st) => {
  g.fillStyle = "#06090d"; g.fillRect(0, 0, W, H);
  const line = String(st.line ?? "2호선"), col = String(st.colour ?? "#3cb44a");
  g.fillStyle = col; g.fillRect(0, 0, W, H * 0.2); g.fillStyle = "#fff"; g.font = font(H * 0.12); g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(`${line} 열차 도착 안내`, W * 0.03, H * 0.1);
  const now = Math.floor(t);
  for (let i = 0; i < 3; i++) {
    const y = H * (0.34 + i * 0.25), left = (Number(st.base ?? 120) + i * 290 - now) % 600, left2 = left < 0 ? left + 600 : left, min = Math.floor(left2 / 60);
    g.fillStyle = "#ffb300"; g.font = font(H * 0.13); g.fillText(`${STATIONS[(Number(st.seed ?? 0) + i * 3) % STATIONS.length]}행`, W * 0.04, y);
    g.fillStyle = min === 0 ? "#ff5252" : "#7cf27c"; g.textAlign = "right"; g.fillText(min === 0 ? (left2 < 30 ? "진입" : "곧 도착") : `${min}분 후`, W * 0.96, y); g.textAlign = "left";
  }
};
const ADS = [["#e60012", "SALE", "최대 50%"], ["#1a73e8", "NEW", "신상품 입고"], ["#00a862", "이벤트", "1+1 행사"], ["#7b2cbf", "회원 혜택", "포인트 2배"], ["#ff8f00", "오늘의 특가", "한정 수량"]];
const signage: Painter = (g, W, H, t, st) => {
  const i = Math.floor(t / 4 + Number(st.seed ?? 0)) % ADS.length, [c, a, b] = ADS[i], k = (t % 4) / 4;
  const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, c); grd.addColorStop(1, "#111"); g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(255,255,255,0.12)"; g.beginPath(); g.arc(W * (0.2 + k * 0.6), H * 0.7, H * 0.5, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.font = font(Math.min(W, H) * 0.22, 900); g.fillText(a, W / 2, H * 0.4);
  g.font = font(Math.min(W, H) * 0.11); g.fillText(b, W / 2, H * 0.66);
};
const queueBoard: Painter = (g, W, H, _t, st) => {
  g.fillStyle = "#0b1a2a"; g.fillRect(0, 0, W, H); g.fillStyle = "#9fd3ff"; g.font = font(H * 0.16); g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(String(st.title ?? "진료 대기"), W / 2, H * 0.18);
  g.fillStyle = "#fff"; g.font = font(H * 0.38, 900); g.fillText(String(st.now ?? 41).padStart(4, "0"), W / 2, H * 0.55);
  g.fillStyle = "#ffd54f"; g.font = font(H * 0.13); g.fillText(`${st.window ?? 2}번 창구`, W / 2, H * 0.86);
};
const ecg: Painter = (g, W, H, t, st) => {
  g.fillStyle = "#020a06"; g.fillRect(0, 0, W, H);
  g.strokeStyle = "#33ff77"; g.lineWidth = 2; g.beginPath();
  for (let x = 0; x < W; x++) { const u = (x / W * 3 + t * 1.2) % 1, y = u > 0.42 && u < 0.46 ? -0.8 : u > 0.46 && u < 0.5 ? 0.35 : u > 0.6 && u < 0.7 ? -0.12 * Math.sin((u - 0.6) / 0.1 * Math.PI) : 0; g.lineTo(x, H * 0.42 + y * H * 0.3); }
  g.stroke();
  g.fillStyle = "#33ff77"; g.font = font(H * 0.18); g.textAlign = "left"; g.fillText(`HR ${72 + Math.round(Math.sin(t * 0.3) * 4)}`, W * 0.04, H * 0.86);
  g.fillStyle = "#4fc3f7"; g.fillText(`SpO₂ ${97 + (Math.floor(t) % 3 === 0 ? 1 : 0)}`, W * 0.52, H * 0.86); void st;
};
const kioskScreen: Painter = (g, W, H, t, st) => {
  const c = String(st.colour ?? "#1f6fd1");
  g.fillStyle = "#f4f6f9"; g.fillRect(0, 0, W, H); g.fillStyle = c; g.fillRect(0, 0, W, H * 0.16);
  g.fillStyle = "#fff"; g.font = font(H * 0.07); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(st.title ?? "안내"), W / 2, H * 0.08);
  const items = String(st.items ?? "메뉴1|메뉴2|메뉴3|메뉴4").split("|");
  items.forEach((s, i) => { const x = W * (0.06 + (i % 2) * 0.47), y = H * (0.22 + Math.floor(i / 2) * 0.2); g.fillStyle = (Math.floor(t * 0.7) % items.length) === i ? c : "#dfe4ea"; g.fillRect(x, y, W * 0.41, H * 0.16); g.fillStyle = (Math.floor(t * 0.7) % items.length) === i ? "#fff" : "#333"; g.font = font(H * 0.05); g.fillText(s, x + W * 0.205, y + H * 0.08); });
  g.fillStyle = "#555"; g.font = font(H * 0.045, 500); g.fillText(String(st.foot ?? "화면을 터치하세요"), W / 2, H * 0.92);
};
const whiteboardOn: Painter = (g, W, H, t, st) => {
  g.fillStyle = "#fbfbfb"; g.fillRect(0, 0, W, H);
  g.strokeStyle = "#1565c0"; g.lineWidth = 4; g.beginPath();
  for (let x = 0; x < W * 0.9; x += 4) g.lineTo(W * 0.05 + x, H * 0.55 - Math.sin(x / 30 + t) * H * 0.18 * Math.exp(-x / W));
  g.stroke(); g.fillStyle = "#222"; g.font = font(H * 0.09); g.textAlign = "left"; g.fillText(String(st.title ?? "오늘의 수업"), W * 0.05, H * 0.15);
};

// ---------------------------------------------------------------- the catalogue
const pick = <T,>(a: T[], v: number) => a[((v % a.length) + a.length) % a.length];
const tints = (X: Extra, P: import("./materials").Palette, v: number) => pick([P.appliance, P.applianceDark, X.accent, P.steel, X.laminate], v);

const DEFS: Def[] = [
  // ---- everywhere a building has its people: safety, time, water
  { id: "clock", label: "벽시계", rooms: ["corridor", "lobby", "waiting", "openOffice", "office", "meeting", "classroom", "staffroom", "service", "cafe", "pantry", "gym", "treatment"], wall: true, w: 0.4, d: 0.06, h: 0.4, looks: 3, max: 1, weight: 3,
    make: (P, X, v) => v === 2
      ? { kit: [rb(P.applianceDark, 0.56, 0.22, 0.05, 0.01, 0, 2.35, 0.025)], screen: { w: 0.5, h: 0.17, x: 0, y: 2.35, z: 0.052, paint: digitalClock, fps: 0.5, on: true } }
      : { kit: [disc(v ? X.accentDark : P.blackMetal, 0.2, 0.04, 0, 2.3, 0.02)], screen: { w: 0.37, h: 0.37, x: 0, y: 2.3, z: 0.042, paint: clockFace, fps: 1, on: true } } },
  { id: "extinguisher", label: "소화기", rooms: ["corridor", "lobby", "liftHall", "storage", "plant", "parking", "openOffice", "shop", "cafe", "classroom", "gym", "service"], wall: true, w: 0.25, d: 0.2, h: 0.6, looks: 2, max: 1, weight: 2,
    make: (P, X, v) => ({ kit: [cy(X.tail, 0.08, 0.08, 0.5, 0, 0.3, 0.1, 16), cy(P.blackMetal, 0.03, 0.04, 0.08, 0, 0.59, 0.1, 10), bx(P.blackMetal, 0.12, 0.02, 0.02, 0.04, 0.64, 0.1), ...(v ? [bx(P.steel, 0.26, 0.04, 0.2, 0, 0.02, 0.1)] : [])] }) },
  { id: "hydrant", label: "옥내소화전", rooms: ["corridor", "liftHall", "parking", "lobby"], wall: true, w: 0.75, d: 0.18, h: 1.5, looks: 2, max: 1, minArea: 8,
    make: (P, X, v) => ({ kit: [bx(v ? X.tail : P.steel, 0.75, 1.3, 0.18, 0, 0.95, 0.09), bx(P.glass, 0.6, 0.6, 0.01, 0, 1.25, 0.185), bx(P.ledWarm, 0.06, 0.06, 0.02, 0.28, 1.55, 0.19), bx(P.trim, 0.6, 0.02, 0.01, 0, 0.6, 0.185)],
      use: s => ({ box: [0.75, 1.3, 0.2, 0, 0.95, 0.1], label: () => s.st.open ? "소화전함 닫기" : "소화전함 열어 보기", act: () => { s.st.open = !s.st.open; if (s.st.open) s.toast("호스와 노즐, 밸브가 들어 있어요. 화재 시 밸브를 돌려 사용합니다."); return "door"; } }) }) },
  { id: "aed", label: "자동심장충격기(AED)", rooms: ["lobby", "liftHall", "corridor", "waiting", "gym", "service"], wall: true, w: 0.45, d: 0.2, h: 0.55, looks: 2, max: 1, minArea: 10,
    make: (P, X, v) => ({ kit: [bx(v ? P.appliance : P.ledPanel, 0.45, 0.55, 0.2, 0, 1.3, 0.1), bx(X.accent, 0.45, 0.08, 0.205, 0, 1.6, 0.1), bx(P.glass, 0.36, 0.36, 0.01, 0, 1.25, 0.205), rb(X.tail, 0.2, 0.2, 0.08, 0.04, 0, 1.25, 0.15)],
      use: s => ({ box: [0.45, 0.55, 0.22, 0, 1.3, 0.1], label: () => "AED 사용법 보기", act: () => { s.toast("① 전원 켜기 ② 패드 부착 ③ 심장 리듬 분석 ④ 쇼크 버튼 — 119에 먼저 신고하세요."); s.fx("chime"); return "beep"; } }) }) },
  { id: "sanitizer", label: "손소독기", rooms: ["lobby", "waiting", "corridor", "liftHall", "treatment", "consult", "ward", "cafe", "shop", "service", "classroom"], wall: true, w: 0.14, d: 0.12, h: 0.25, looks: 3, max: 1, weight: 2,
    make: (P, X, v) => ({ kit: v === 2 ? [cy(P.steel, 0.025, 0.025, 1.1, 0, 0.55, 0.08, 10), bx(P.steel, 0.3, 0.02, 0.3, 0, 0.01, 0.08), rb(P.appliance, 0.14, 0.24, 0.12, 0.02, 0, 1.2, 0.08)] : [rb(v ? P.applianceDark : P.appliance, 0.13, 0.24, 0.11, 0.02, 0, 1.25, 0.055), bx(X.accent, 0.13, 0.03, 0.112, 0, 1.16, 0.056)],
      use: s => ({ box: [0.2, 0.3, 0.15, 0, 1.22, 0.08], label: () => "손 소독하기", act: () => { s.toast("칙— 손이 촉촉하고 시원해졌어요."); s.fx("water"); return "click"; } }) }) },
  { id: "water", label: "냉온정수기", rooms: ["corridor", "lobby", "waiting", "openOffice", "pantry", "staffroom", "classroom", "gym", "service", "liftHall"], wall: true, w: 0.34, d: 0.4, h: 1.15, looks: 3, max: 1, weight: 2,
    make: (P, X, v) => ({ kit: [rb(v === 1 ? P.applianceDark : P.appliance, 0.32, 1.1, 0.38, 0.02, 0, 0.55, 0.19), bx(P.applianceDark, 0.22, 0.2, 0.06, 0, 0.92, 0.35), bx(X.accent, 0.05, 0.03, 0.02, -0.06, 1.0, 0.39), bx(X.tail, 0.05, 0.03, 0.02, 0.06, 1.0, 0.39), bx(P.steel, 0.22, 0.01, 0.1, 0, 0.8, 0.34),
      ...(v === 2 ? [cy(P.glass, 0.13, 0.13, 0.45, 0, 1.33, 0.19, 20)] : [])],
      use: s => ({ box: [0.34, 1.15, 0.4, 0, 0.6, 0.2], label: () => "정수기에서 물 받아 마시기", act: () => { s.fx("water"); s.consume("시원한 물", "#dff3ff"); return "water"; } }) }) },
  { id: "bin", label: "분리수거함", rooms: ["corridor", "lobby", "pantry", "cafe", "waiting", "liftHall", "classroom", "gym", "shop"], wall: true, w: 0.9, d: 0.4, h: 0.9, looks: 3, max: 1,
    make: (P, X, v) => ({ kit: [0, 1, 2].flatMap(i => [rb(pick([P.steel, P.applianceDark, X.laminate], v), 0.28, 0.85, 0.38, 0.02, -0.3 + i * 0.3, 0.425, 0.19), bx(pick([X.accent, X.paintYellow, X.tail], i), 0.2, 0.04, 0.01, -0.3 + i * 0.3, 0.75, 0.385)]) }) },
  { id: "cctv", label: "CCTV", rooms: ["corridor", "lobby", "liftHall", "parking", "shop", "storage"], wall: true, w: 0.16, d: 0.16, h: 0.16, looks: 2, max: 1,
    make: (P, _X, v, api) => ({ kit: v ? [cy(P.appliance, 0.07, 0.07, 0.03, 0, api.H - 0.18, 0.12, 16), bx(P.appliance, 0.05, 0.12, 0.08, 0, api.H - 0.1, 0.04), cy(P.applianceDark, 0.05, 0.05, 0.16, 0, api.H - 0.26, 0.16, 14)] : [bx(P.appliance, 0.06, 0.2, 0.06, 0, api.H - 0.12, 0.03), rb(P.appliance, 0.1, 0.09, 0.22, 0.03, 0, api.H - 0.25, 0.13), cy(P.applianceDark, 0.03, 0.03, 0.01, 0, api.H - 0.25, 0.245, 12)] }) },

  // ---- offices
  { id: "copier", label: "복합기", rooms: ["openOffice", "office", "staffroom", "service", "classroom", "pantry"], wall: true, w: 0.62, d: 0.68, h: 1.2, looks: 4, max: 1, weight: 3,
    make: (P, X, v) => ({ kit: [rb(v % 2 ? P.appliance : P.plastic, 0.6, 0.85, 0.65, 0.02, 0, 0.425, 0.33), rb(P.applianceDark, 0.58, 0.12, 0.6, 0.02, 0, 0.94, 0.33), rb(v > 1 ? P.applianceDark : P.appliance, 0.5, 0.18, 0.4, 0.02, 0, 1.1, 0.33), bx(X.monitor, 0.2, 0.12, 0.01, 0.18, 1.07, 0.66), bx(P.rubber, 0.003, 0.4, 0.5, 0.3, 0.5, 0.33), bx(P.appliance, 0.3, 0.02, 0.22, -0.1, 0.98, 0.55)],
      use: s => ({ box: [0.62, 1.2, 0.7, 0, 0.6, 0.33], label: () => s.st.busy ? "출력 중…" : "복합기로 복사·출력하기", act: () => { if (s.st.busy) return null; s.st.busy = true; s.fx("copier"); setTimeout(() => { s.st.busy = false; s.toast(pick(["A4 3장 출력 완료.", "양면 복사가 끝났어요.", "스캔한 파일을 메일로 보냈어요.", "용지가 부족합니다 — 2번 트레이에 채워 주세요."], Math.floor(Math.random() * 4))); }, 2600); return "beep"; } }) }) },
  { id: "printer", label: "레이저 프린터", rooms: ["office", "openOffice", "staffroom", "service", "pharmacy", "consult"], wall: true, w: 0.45, d: 0.45, h: 1.0, looks: 3, max: 1,
    make: (P, X, v) => ({ kit: [rb(P.appliance, 0.5, 0.72, 0.46, 0.02, 0, 0.36, 0.23), rb(v ? P.applianceDark : P.plastic, 0.42, 0.28, 0.4, 0.02, 0, 0.86, 0.22), bx(X.accent, 0.05, 0.02, 0.01, 0.15, 0.95, 0.43)],
      use: s => ({ box: [0.5, 1.0, 0.5, 0, 0.5, 0.23], label: () => "문서 출력하기", act: () => { s.fx("copier"); s.toast("인쇄 대기열 1건 — 출력했어요."); return "beep"; } }) }) },
  { id: "shredder", label: "문서 세단기", rooms: ["office", "openOffice", "staffroom", "service"], wall: true, w: 0.4, d: 0.32, h: 0.7, looks: 2, max: 1,
    make: (P, _X, v) => ({ kit: [rb(v ? P.applianceDark : P.plastic, 0.38, 0.6, 0.3, 0.02, 0, 0.3, 0.16), rb(P.applianceDark, 0.38, 0.1, 0.3, 0.01, 0, 0.65, 0.16), bx(P.rubber, 0.24, 0.005, 0.02, 0, 0.705, 0.16)],
      use: s => ({ box: [0.4, 0.7, 0.32, 0, 0.35, 0.16], label: () => "서류 파쇄하기", act: () => { s.fx("copier"); s.toast("드르륵— 기밀 문서를 안전하게 파쇄했어요."); return "click"; } }) }) },
  { id: "coffee", label: "커피머신", rooms: ["pantry", "staffroom", "lobby", "meeting", "waiting"], wall: true, w: 0.5, d: 0.5, h: 1.0, looks: 3, max: 1, weight: 2,
    make: (P, X, v) => ({ kit: [rb(X.laminate, 0.7, 0.86, 0.55, 0.02, 0, 0.43, 0.27), rb(pick([P.chrome, P.applianceDark, X.accentDark], v), 0.34, 0.42, 0.38, 0.03, 0, 1.07, 0.24), bx(P.applianceDark, 0.2, 0.05, 0.1, 0, 0.93, 0.38), bx(X.monitor, 0.12, 0.08, 0.01, 0, 1.22, 0.43)],
      use: s => ({ box: [0.5, 0.6, 0.5, 0, 1.05, 0.25], label: () => s.st.brew ? "커피 내리는 중…" : "아메리카노 내리기", act: () => { if (s.st.brew) return null; s.st.brew = true; s.fx("coffee"); setTimeout(() => { s.st.brew = false; s.consume(pick(["따뜻한 아메리카노", "카페라테", "에스프레소"], Math.floor(Math.random() * 3)), "#6f4e37"); }, 3000); return "beep"; } }) }) },
  { id: "projector", label: "빔프로젝터·스크린", rooms: ["meeting", "classroom"], wall: true, w: 2.0, d: 0.1, h: 1.4, looks: 2, max: 1, minArea: 12,
    make: (P, X, v) => ({ kit: [bx(P.appliance, 2.1, 0.1, 0.1, 0, 2.7, 0.05), bx(P.blackMetal, 2.0, 0.02, 0.02, 0, 1.25, 0.06), bx(v ? X.whiteboard : P.trim, 1.96, 1.4, 0.004, 0, 1.95, 0.052)],
      screen: { w: 1.9, h: 1.07, x: 0, y: 1.95, z: 0.056, paint: (g, W, H, t) => { g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); g.fillStyle = "#1a73e8"; g.fillRect(0, 0, W, H * 0.16); g.fillStyle = "#fff"; g.font = font(H * 0.08); g.textAlign = "left"; g.textBaseline = "middle"; g.fillText("2026 사업 계획", W * 0.04, H * 0.08); const n = 6; for (let i = 0; i < n; i++) { const hh = H * 0.5 * (0.35 + 0.65 * Math.abs(Math.sin(i * 1.7 + t * 0.2))); g.fillStyle = ["#1a73e8", "#34a853", "#fbbc04", "#ea4335", "#7b2cbf", "#00acc1"][i]; g.fillRect(W * (0.1 + i * 0.13), H * 0.88 - hh, W * 0.08, hh); } }, fps: 2, on: false },
      use: s => ({ box: [2.0, 1.4, 0.12, 0, 1.95, 0.05], label: () => s.st.on ? "프로젝터 끄기" : "프로젝터 켜고 발표 화면 띄우기", act: () => { s.st.on = !s.st.on; s.screenOn(!!s.st.on); return "click"; } }) }) },
  { id: "display", label: "회의실 대형 디스플레이", rooms: ["meeting", "office", "staffroom"], wall: true, w: 1.45, d: 0.08, h: 0.85, looks: 2, max: 1,
    make: (P, _X, v) => ({ kit: [rb(P.applianceDark, 1.45, 0.84, 0.05, 0.01, 0, 1.45, 0.03), ...(v ? [rb(P.applianceDark, 0.3, 0.05, 0.08, 0.02, 0, 1.92, 0.05)] : [])],
      screen: { w: 1.4, h: 0.79, x: 0, y: 1.45, z: 0.056, paint: (g, W, H, t) => { g.fillStyle = "#0f1720"; g.fillRect(0, 0, W, H); const tiles = 4; for (let i = 0; i < tiles; i++) { g.fillStyle = ["#2b3a4a", "#344b5e", "#2d4255", "#3a5166"][i]; g.fillRect((i % 2) * W / 2 + 6, Math.floor(i / 2) * H / 2 + 6, W / 2 - 12, H / 2 - 12); g.fillStyle = "#cfe7ff"; g.beginPath(); g.arc((i % 2) * W / 2 + W / 4, Math.floor(i / 2) * H / 2 + H / 4 - 8, H * 0.09, 0, Math.PI * 2); g.fill(); g.fillRect((i % 2) * W / 2 + W / 4 - H * 0.12, Math.floor(i / 2) * H / 2 + H / 4 + H * 0.04, H * 0.24, H * 0.1); } g.fillStyle = "#ff5252"; g.beginPath(); g.arc(W - 20, 18, 6 + Math.sin(t * 4) * 2, 0, Math.PI * 2); g.fill(); }, fps: 3, on: false },
      use: s => ({ box: [1.45, 0.85, 0.1, 0, 1.45, 0.03], label: () => s.st.on ? "화상회의 종료" : "화상회의 시작하기", act: () => { s.st.on = !s.st.on; s.screenOn(!!s.st.on); if (s.st.on) s.toast("4명이 회의에 참여했어요."); return "beep"; } }) }) },
  { id: "phonebooth", label: "1인 포커스 부스", rooms: ["openOffice"], wall: true, w: 1.1, d: 1.1, h: 2.2, looks: 3, max: 1, minArea: 40,
    make: (P, X, v) => ({ kit: [bx(pick([X.accentDark, P.appliance, P.woodLight], v), 1.1, 2.2, 0.05, 0, 1.1, 0.025), bx(pick([X.accentDark, P.appliance, P.woodLight], v), 0.05, 2.2, 1.1, -0.525, 1.1, 0.55), bx(pick([X.accentDark, P.appliance, P.woodLight], v), 0.05, 2.2, 1.1, 0.525, 1.1, 0.55), bx(P.glass, 1.0, 2.1, 0.02, 0, 1.05, 1.09), bx(pick([X.accentDark, P.appliance, P.woodLight], v), 1.1, 0.06, 1.1, 0, 2.2, 0.55), bx(X.laminate, 0.8, 0.03, 0.4, 0, 1.05, 0.25), bx(X.seat, 0.4, 0.45, 0.4, 0, 0.23, 0.7)] }) },
  { id: "lockers", label: "개인 사물함", rooms: ["openOffice", "staffroom", "gym", "classroom", "storage"], wall: true, w: 1.8, d: 0.45, h: 1.8, looks: 4, max: 1, minArea: 12,
    make: (P, X, v) => ({ kit: [bx(pick([P.steel, X.accent, P.appliance, P.woodLight], v), 1.8, 1.8, 0.45, 0, 0.9, 0.225), ...Array.from({ length: 12 }, (_, i) => bx(P.rubber, 0.005, 0.005, 0.01, -0.75 + (i % 6) * 0.3, 0.45 + Math.floor(i / 6) * 0.9, 0.452)), ...Array.from({ length: 6 }, (_, i) => bx(P.rubber, 0.003, 1.78, 0.005, -0.6 + i * 0.3, 0.9, 0.452)), bx(P.rubber, 1.8, 0.003, 0.005, 0, 0.9, 0.452)],
      use: s => ({ box: [1.8, 1.8, 0.47, 0, 0.9, 0.22], label: () => "사물함 열어 보기", act: () => { s.toast(pick(["우산, 텀블러, 여분의 셔츠가 들어 있어요.", "체육복과 운동화가 있어요.", "서류 봉투와 충전기가 있어요."], Math.floor(Math.random() * 3))); return "door"; } }) }) },
  { id: "plantwall", label: "대형 화분", rooms: ["openOffice", "lobby", "meeting", "waiting", "cafe", "office", "corridor", "liftHall"], wall: true, w: 0.5, d: 0.5, h: 1.6, looks: 3, max: 2,
    make: (P, _X, v) => ({ kit: M.plant(P, 1.2 + v * 0.25, 11 + v * 5).map(p => ({ ...p, g: p.g.clone().translate(0, 0, 0.25) })) }) },
  { id: "speedgate", label: "스피드게이트", rooms: ["lobby"], kinds: ["office", "civic"], wall: false, w: 2.8, d: 1.4, h: 1.1, looks: 2, max: 1, minArea: 60,
    make: (P, X, v) => gateKit(P, X, v, "사원증 태그", "출입 승인 — 좋은 하루 되세요.") },
  { id: "infokiosk", label: "안내 키오스크", rooms: ["lobby", "liftHall", "corridor", "waiting"], wall: true, w: 0.55, d: 0.45, h: 1.6, looks: 3, max: 1, minArea: 20,
    make: (P, X, v, api) => kiosk(P, X, v, { title: `${api.name} 층별 안내`, items: "층별 안내|편의시설|주차 정산|분실물 센터", foot: "원하는 메뉴를 누르세요", colour: "#1f6fd1" }, s => s.toast(pick([`${api.name} — 1층 로비, 2층부터 사무·매장이 있어요.`, "화장실은 엘리베이터 홀 옆에 있어요.", "주차 정산은 출구 정산기에서 할 수 있어요."], Math.floor(Math.random() * 3)))) },

  // ---- clinics and hospitals
  { id: "ticket", label: "번호표 발급기", rooms: ["waiting", "service", "pharmacy", "lobby"], wall: true, w: 0.45, d: 0.4, h: 1.3, looks: 3, max: 1, weight: 4,
    make: (P, X, v) => ({ kit: [rb(pick([P.appliance, X.accent, P.steel], v), 0.42, 1.2, 0.36, 0.03, 0, 0.6, 0.18), bx(P.applianceDark, 0.3, 0.2, 0.01, 0, 1.0, 0.365), bx(P.applianceDark, 0.12, 0.02, 0.02, 0, 0.75, 0.37)],
      screen: { w: 0.28, h: 0.18, x: 0, y: 1.0, z: 0.372, paint: (g, W, H) => { g.fillStyle = "#0b1a2a"; g.fillRect(0, 0, W, H); g.fillStyle = "#fff"; g.font = font(H * 0.28); g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("번호표", W / 2, H * 0.35); g.fillStyle = "#ffd54f"; g.font = font(H * 0.2); g.fillText("버튼을 누르세요", W / 2, H * 0.72); }, fps: 0.2, on: true },
      use: s => ({ box: [0.45, 1.3, 0.4, 0, 0.65, 0.18], label: () => "번호표 뽑기", act: () => { const n = 40 + Math.floor(Math.random() * 30); s.toast(`대기번호 ${String(n).padStart(4, "0")}번 — 앞에 ${Math.floor(Math.random() * 6) + 1}명이 기다리고 있어요.`); s.fx("register"); return "beep"; } }) }) },
  { id: "queue", label: "대기 순번 표시기", rooms: ["waiting", "service", "pharmacy"], wall: true, w: 0.9, d: 0.06, h: 0.5, looks: 2, max: 1, weight: 3,
    make: (P, _X, v, api) => ({ kit: [rb(P.applianceDark, 0.9, 0.5, 0.05, 0.01, 0, 2.05, 0.025)], screen: { w: 0.86, h: 0.46, x: 0, y: 2.05, z: 0.052, paint: queueBoard, fps: 0.25, on: true },
      use: s => { s.st.title = api.room.type === "pharmacy" ? "조제 완료" : /원무|수납/.test(api.room.label) ? "수납 대기" : "진료 대기"; s.st.now = 37 + v * 9; s.st.window = 1 + v; let k = 0; return { box: [0.9, 0.5, 0.08, 0, 2.05, 0.03], label: () => `현재 ${String(s.st.now).padStart(4, "0")}번`, act: () => null, update: dt => { k += dt; if (k > 9) { k = 0; s.st.now = Number(s.st.now) + 1; s.st.window = 1 + Math.floor(Math.random() * 3); s.fx("chime"); } } }; } }) },
  { id: "bp", label: "자동 혈압계", rooms: ["waiting", "lobby", "pharmacy", "treatment"], kinds: ["clinic", "ward", "civic"], wall: true, w: 0.7, d: 0.8, h: 1.25, looks: 2, max: 1, minArea: 10,
    make: (P, X, v) => ({ kit: [rb(v ? P.appliance : X.laminate, 0.7, 1.1, 0.5, 0.03, 0, 0.55, 0.25), disc(P.applianceDark, 0.14, 0.35, 0, 1.0, 0.42), bx(X.seat, 0.45, 0.08, 0.45, 0, 0.45, 0.85), bx(P.blackMetal, 0.04, 0.45, 0.04, 0, 0.22, 0.85), bx(X.monitor, 0.24, 0.15, 0.01, 0, 1.2, 0.505)],
      use: s => ({ box: [0.7, 1.2, 0.9, 0, 0.7, 0.4], label: () => s.st.busy ? "측정 중… 팔을 움직이지 마세요" : "혈압 재기", act: () => { if (s.st.busy) return null; s.st.busy = true; s.fx("treadmill"); setTimeout(() => { s.st.busy = false; const sys = 108 + Math.floor(Math.random() * 30), dia = 66 + Math.floor(Math.random() * 18); s.toast(`혈압 ${sys}/${dia} mmHg · 맥박 ${64 + Math.floor(Math.random() * 20)}회 — ${sys < 130 ? "정상 범위예요." : "약간 높아요. 의사와 상담해 보세요."}`); }, 3500); return "beep"; } }) }) },
  { id: "scale", label: "신장·체중계", rooms: ["waiting", "treatment", "consult"], kinds: ["clinic", "ward", "school"], wall: true, w: 0.45, d: 0.55, h: 2.0, looks: 2, max: 1,
    make: (P, X, v) => ({ kit: [bx(v ? P.appliance : X.laminate, 0.42, 0.08, 0.5, 0, 0.04, 0.3), bx(P.steel, 0.06, 2.0, 0.05, 0, 1.0, 0.03), bx(P.appliance, 0.3, 0.04, 0.2, 0, 1.75, 0.13), bx(X.monitor, 0.16, 0.08, 0.01, 0, 1.3, 0.06)],
      use: s => ({ box: [0.45, 2.0, 0.55, 0, 1.0, 0.3], label: () => "키와 몸무게 재기", act: () => { s.toast(`키 ${168 + Math.floor(Math.random() * 18)}cm · 몸무게 ${58 + Math.floor(Math.random() * 25)}kg`); return "beep"; } }) }) },
  { id: "monitor", label: "환자 감시 모니터", rooms: ["treatment", "ward"], kinds: ["clinic", "ward"], wall: true, w: 0.5, d: 0.35, h: 1.6, looks: 2, max: 1,
    make: (P, X, v) => ({ kit: [cy(P.steel, 0.02, 0.02, 1.2, 0, 0.6, 0.2, 8), bx(P.steel, 0.45, 0.03, 0.45, 0, 0.02, 0.2), rb(v ? P.appliance : X.laminate, 0.36, 0.28, 0.12, 0.02, 0, 1.35, 0.18)], screen: { w: 0.3, h: 0.2, x: 0, y: 1.36, z: 0.242, paint: ecg, fps: 12, on: true } }) },
  { id: "ivstand", label: "수액 거치대", rooms: ["treatment", "ward", "consult"], kinds: ["clinic", "ward"], wall: false, w: 0.5, d: 0.5, h: 1.9, looks: 1, max: 1,
    make: (P, X) => ({ kit: F_ivPole(P, X) }) },
  { id: "wheelchair", label: "휠체어", rooms: ["lobby", "waiting", "corridor", "ward"], kinds: ["clinic", "ward"], wall: true, w: 0.65, d: 0.9, h: 0.95, looks: 2, max: 2, minArea: 8,
    make: (P, X, v) => ({ kit: [bx(v ? X.seat : P.leather, 0.45, 0.05, 0.45, 0, 0.5, 0.5), bx(v ? X.seat : P.leather, 0.45, 0.45, 0.04, 0, 0.75, 0.28), ...[-1, 1].flatMap(sx => [disc(P.chrome, 0.28, 0.03, sx * 0.3, 0.3, 0.45, "x"), cy(P.rubber, 0.07, 0.07, 0.03, sx * 0.2, 0.07, 0.8, 12)]), bx(P.chrome, 0.5, 0.03, 0.03, 0, 0.95, 0.27)] }) },
  { id: "lightbox", label: "엑스레이 판독기", rooms: ["consult", "treatment"], kinds: ["clinic", "ward"], wall: true, w: 0.9, d: 0.08, h: 0.55, looks: 1, max: 1,
    make: (P) => ({ kit: [rb(P.appliance, 0.9, 0.55, 0.07, 0.01, 0, 1.55, 0.035)], screen: { w: 0.84, h: 0.48, x: 0, y: 1.55, z: 0.072, paint: (g, W, H) => { g.fillStyle = "#eef3f7"; g.fillRect(0, 0, W, H); for (const ox of [W * 0.27, W * 0.73]) { g.fillStyle = "#1b1e22"; g.fillRect(ox - W * 0.21, H * 0.06, W * 0.42, H * 0.88); g.strokeStyle = "rgba(220,230,240,0.85)"; g.lineWidth = 3; for (let r = 0; r < 9; r++) { g.beginPath(); g.ellipse(ox, H * (0.25 + r * 0.06), W * 0.15, H * 0.03, 0, Math.PI * 0.1, Math.PI * 0.9); g.stroke(); } g.fillStyle = "rgba(220,230,240,0.6)"; g.fillRect(ox - 4, H * 0.15, 8, H * 0.7); } }, fps: 0.1, on: false },
      use: s => ({ box: [0.9, 0.55, 0.1, 0, 1.55, 0.035], label: () => s.st.on ? "판독기 끄기" : "흉부 엑스레이 판독기 켜기", act: () => { s.st.on = !s.st.on; s.screenOn(!!s.st.on); return "click"; } }) }) },
  { id: "medcart", label: "드레싱 카트", rooms: ["treatment", "ward", "consult"], kinds: ["clinic", "ward"], wall: true, w: 0.6, d: 0.45, h: 1.0, looks: 2, max: 1,
    make: (P, X, v) => ({ kit: [bx(P.chrome, 0.6, 0.02, 0.45, 0, 0.9, 0.225), bx(P.chrome, 0.6, 0.02, 0.45, 0, 0.5, 0.225), bx(P.chrome, 0.6, 0.02, 0.45, 0, 0.15, 0.225), ...[-1, 1].flatMap(a => [-1, 1].map(b => cy(P.chrome, 0.01, 0.01, 0.9, a * 0.28, 0.5, 0.225 + b * 0.2, 8))), ...Array.from({ length: 6 }, (_, i) => rb(pick([X.accent, P.appliance, X.sheetGreen], i + v), 0.08, 0.06, 0.06, 0.01, -0.22 + i * 0.09, 0.94, 0.22))] }) },

  // ---- shops, marts and the department store's floors
  { id: "signage", label: "디지털 사이니지", rooms: ["shop", "corridor", "lobby", "cafe", "liftHall"], kinds: ["retail", "food", "office", "museum", "civic"], wall: true, w: 0.7, d: 0.45, h: 1.9, looks: 3, max: 1, weight: 3, minArea: 10,
    make: (P, _X, v) => v === 2
      ? { kit: [rb(P.applianceDark, 1.2, 0.7, 0.06, 0.01, 0, 2.0, 0.03)], screen: { w: 1.16, h: 0.66, x: 0, y: 2.0, z: 0.062, paint: signage, fps: 6, on: true } }
      : { kit: [rb(v ? P.applianceDark : P.appliance, 0.7, 1.8, 0.06, 0.02, 0, 0.92, 0.2), bx(P.steel, 0.5, 0.03, 0.4, 0, 0.015, 0.2)], screen: { w: 0.64, h: 1.12, x: 0, y: 1.1, z: 0.232, paint: signage, fps: 6, on: true } } },
  { id: "pricecheck", label: "가격 확인기", rooms: ["shop"], kinds: ["retail"], wall: true, w: 0.3, d: 0.12, h: 0.3, looks: 2, max: 2,
    make: (P, X, v) => ({ kit: [rb(v ? X.accent : P.applianceDark, 0.25, 0.3, 0.1, 0.02, 0, 1.4, 0.05), bx(X.monitor, 0.18, 0.12, 0.01, 0, 1.45, 0.101), bx(X.tail, 0.06, 0.01, 0.02, 0, 1.3, 0.1)],
      use: s => ({ box: [0.3, 0.35, 0.15, 0, 1.4, 0.05], label: () => "바코드 대고 가격 확인하기", act: () => { s.fx("scan"); s.toast(`${pick(["유기농 우유 900ml", "국산 콩 두부", "제주 감귤 1kg", "프리미엄 라면 5입", "그릭 요거트"], Math.floor(Math.random() * 5))} — ${(1 + Math.floor(Math.random() * 12)) * 990}원 (회원가 ${Math.floor(Math.random() * 10 + 5)}% 할인)`); return "beep"; } }) }) },
  { id: "selfcheckout", label: "무인 계산대", rooms: ["shop"], kinds: ["retail"], wall: true, w: 0.8, d: 0.7, h: 1.6, looks: 2, max: 2, minArea: 40,
    make: (P, X, v) => ({ kit: [rb(v ? P.appliance : X.accentDark, 0.8, 0.9, 0.6, 0.02, 0, 0.45, 0.3), bx(P.glass, 0.55, 0.02, 0.4, -0.05, 0.91, 0.35), rb(P.applianceDark, 0.42, 0.32, 0.05, 0.02, 0.1, 1.3, 0.28), bx(P.steel, 0.04, 0.4, 0.04, 0.1, 1.05, 0.25), bx(X.accent, 0.12, 0.25, 0.12, -0.32, 1.5, 0.3)],
      screen: { w: 0.4, h: 0.3, x: 0.1, y: 1.3, z: 0.306, paint: kioskScreen, fps: 1, on: true },
      use: s => { s.st.title = "셀프 계산"; s.st.items = "상품 스캔|봉투 구매|포인트 적립|카드 결제"; s.st.colour = "#00a862"; return { box: [0.8, 1.5, 0.7, 0, 0.8, 0.3], label: () => "무인 계산대에서 계산하기", act: () => { s.fx("scan"); setTimeout(() => s.fx("scan"), 250); setTimeout(() => { s.fx("register"); s.toast("결제가 완료됐어요. 영수증을 받아 가세요."); }, 800); return "beep"; } }; } }) },
  { id: "freezer", label: "아이스크림 냉동고", rooms: ["shop"], kinds: ["retail", "food"], wall: true, w: 1.5, d: 0.75, h: 0.9, looks: 2, max: 1, minArea: 12,
    make: (P, X, v) => ({ kit: [rb(v ? P.appliance : X.accent, 1.5, 0.82, 0.75, 0.03, 0, 0.41, 0.375), bx(P.glass, 1.4, 0.02, 0.65, 0, 0.83, 0.375), ...Array.from({ length: 10 }, (_, i) => rb(pick(X.products, i * 3 + v), 0.12, 0.05, 0.2, 0.01, -0.6 + i * 0.13, 0.8, 0.3 + (i % 2) * 0.15))],
      use: s => ({ box: [1.5, 0.9, 0.75, 0, 0.45, 0.375], label: () => "냉동고에서 아이스크림 고르기", act: () => { s.fx("pick"); s.consume(pick(["바닐라 콘", "초코바 아이스크림", "팥빙수 바", "딸기 셔벗"], Math.floor(Math.random() * 4)), "#f8e1c8"); return "fridge"; } }) }) },
  { id: "claw", label: "인형뽑기 기계", rooms: ["shop", "corridor", "lobby"], kinds: ["retail", "food"], wall: true, w: 0.9, d: 0.9, h: 1.9, looks: 3, max: 1, minArea: 20,
    make: (P, X, v) => ({ kit: [rb(pick([X.accent, X.tail, P.ledPanel], v), 0.9, 0.85, 0.9, 0.03, 0, 0.425, 0.45), bx(P.glass, 0.86, 0.85, 0.86, 0, 1.28, 0.45), rb(pick([X.accent, X.tail, X.accentDark], v), 0.9, 0.2, 0.9, 0.03, 0, 1.8, 0.45), ...Array.from({ length: 14 }, (_, i) => rb(pick(X.products, i + v), 0.14, 0.14, 0.14, 0.05, -0.3 + (i % 5) * 0.15, 0.92 + Math.floor(i / 5) * 0.1, 0.25 + (i % 3) * 0.2)), bx(P.chrome, 0.04, 0.12, 0.04, 0.1, 1.6, 0.45), bx(P.applianceDark, 0.3, 0.1, 0.12, 0, 0.8, 0.95)],
      use: s => ({ box: [0.9, 1.9, 0.95, 0, 0.95, 0.45], label: () => s.st.busy ? "집게가 내려가는 중…" : "인형뽑기 한 판 (1,000원)", act: () => { if (s.st.busy) return null; s.st.busy = true; s.fx("chime"); setTimeout(() => { s.st.busy = false; const win = Math.random() < 0.22; s.toast(win ? "🎉 성공! 곰 인형을 뽑았어요." : pick(["아깝다! 집게에서 미끄러졌어요.", "거의 잡았는데… 한 번 더?", "인형이 출구 앞에 걸렸어요."], Math.floor(Math.random() * 3))); if (win) s.fx("register"); }, 3200); return "beep"; } }) }) },
  { id: "massage", label: "안마의자", rooms: ["lobby", "corridor", "shop"], kinds: ["retail"], wall: true, w: 0.85, d: 1.4, h: 1.2, looks: 3, max: 1, minArea: 30,
    make: (P, X, v) => ({ kit: [rb(pick([P.leather, P.applianceDark, X.seat], v), 0.8, 0.5, 1.0, 0.12, 0, 0.35, 0.75), rb(pick([P.leather, P.applianceDark, X.seat], v), 0.8, 1.0, 0.35, 0.15, 0, 0.9, 0.25), rb(P.appliance, 0.18, 0.5, 0.8, 0.06, -0.38, 0.6, 0.6), rb(P.appliance, 0.18, 0.5, 0.8, 0.06, 0.38, 0.6, 0.6)],
      use: s => ({ box: [0.85, 1.2, 1.4, 0, 0.6, 0.7], label: () => s.st.on ? "안마 멈추기" : "안마의자 체험하기 (10분)", act: () => { s.st.on = !s.st.on; if (s.st.on) s.toast("어깨부터 종아리까지 시원하게 풀어 주는 중이에요."); return "beep"; } }) }) },
  { id: "photobooth", label: "즉석사진 부스", rooms: ["shop", "corridor"], kinds: ["retail"], wall: true, w: 1.3, d: 1.5, h: 2.2, looks: 3, max: 1, minArea: 40,
    make: (P, X, v) => ({ kit: [bx(pick([P.appliance, X.accentDark, P.applianceDark], v), 1.3, 2.2, 0.05, 0, 1.1, 0.025), bx(pick([P.appliance, X.accentDark, P.applianceDark], v), 0.05, 2.2, 1.5, -0.625, 1.1, 0.75), bx(pick([P.appliance, X.accentDark, P.applianceDark], v), 0.05, 2.2, 1.5, 0.625, 1.1, 0.75), bx(P.drape, 1.2, 1.8, 0.02, 0, 1.25, 1.49), bx(pick([P.appliance, X.accentDark, P.applianceDark], v), 1.3, 0.3, 1.5, 0, 2.2, 0.75), bx(P.ledPanel, 1.0, 0.12, 0.02, 0, 2.1, 1.51)],
      use: s => ({ box: [1.3, 2.2, 1.5, 0, 1.1, 0.75], label: () => "네 컷 사진 찍기", act: () => { s.fx("chime"); setTimeout(() => s.toast("찰칵! 찰칵! — 네 컷 사진이 인쇄돼 나왔어요."), 1800); return "beep"; } }) }) },
  { id: "atm", label: "ATM", rooms: ["lobby", "liftHall"], kinds: ["retail", "office", "civic", "clinic"], wall: true, w: 0.7, d: 0.75, h: 1.7, looks: 3, max: 1, minArea: 15,
    make: (P, X, v) => ({ kit: [rb(pick([P.appliance, X.accentDark, P.steel], v), 0.7, 1.65, 0.7, 0.03, 0, 0.825, 0.35), bx(P.applianceDark, 0.5, 0.25, 0.08, 0, 1.25, 0.66), bx(P.steel, 0.25, 0.02, 0.05, 0, 0.95, 0.71), bx(X.accent, 0.7, 0.2, 0.71, 0, 1.6, 0.35)],
      screen: { w: 0.32, h: 0.22, x: 0, y: 1.25, z: 0.701, paint: kioskScreen, fps: 1, on: true },
      use: s => { s.st.title = "ATM"; s.st.items = "출금|입금|조회|이체"; s.st.colour = "#1f4e9c"; return { box: [0.7, 1.7, 0.75, 0, 0.85, 0.35], label: () => "ATM에서 잔액 조회하기", act: () => { s.fx("atm"); setTimeout(() => s.toast(`잔액 ${(Math.floor(Math.random() * 900) + 100) * 1000}원 — 이용해 주셔서 감사합니다.`), 900); return "beep"; } }; } }) },

  // ---- schools
  { id: "eboard", label: "전자칠판", rooms: ["classroom"], wall: true, w: 2.2, d: 0.1, h: 1.3, looks: 2, max: 1, weight: 4,
    make: (P, _X, v) => ({ kit: [rb(P.applianceDark, 2.2, 1.28, 0.08, 0.02, 0, 1.45, 0.04), bx(P.steel, 0.6, 0.04, 0.1, 0, 0.8, 0.06), ...(v ? [bx(P.trim, 1.2, 1.0, 0.02, -1.8, 1.45, 0.012)] : [])], screen: { w: 2.12, h: 1.2, x: 0, y: 1.45, z: 0.082, paint: whiteboardOn, fps: 3, on: false },
      use: s => { s.st.title = pick(["수학 — 이차함수의 그래프", "과학 — 파동의 성질", "국어 — 시의 운율", "영어 — Present Perfect"], v); return { box: [2.2, 1.3, 0.12, 0, 1.45, 0.04], label: () => s.st.on ? "전자칠판 끄기" : "전자칠판 켜기", act: () => { s.st.on = !s.st.on; s.screenOn(!!s.st.on); return "click"; } }; } }) },
  { id: "piano", label: "업라이트 피아노", rooms: ["classroom", "lobby"], kinds: ["school", "museum"], wall: true, w: 1.5, d: 0.6, h: 1.25, looks: 2, max: 1, minArea: 30,
    make: (P, X, v) => ({ kit: [rb(v ? P.woodDark : X.lacquer ?? P.applianceDark, 1.5, 1.25, 0.6, 0.02, 0, 0.625, 0.3), bx(P.appliance, 1.3, 0.03, 0.15, 0, 0.75, 0.66), ...Array.from({ length: 15 }, (_, i) => bx(P.applianceDark, 0.025, 0.035, 0.09, -0.55 + i * 0.08, 0.775, 0.63)), bx(v ? P.woodDark : X.lacquer ?? P.applianceDark, 0.8, 0.5, 0.35, 0, 0.25, 1.05)],
      use: s => ({ box: [1.5, 1.25, 0.7, 0, 0.7, 0.35], label: () => "피아노 쳐 보기", act: () => { s.fx("chime"); setTimeout(() => s.fx("chime"), 300); s.toast("♪ 도레미파솔— 맑은 소리가 울려요."); return "click"; } }) }) },
  { id: "flag", label: "태극기 액자", rooms: ["classroom", "service", "office", "lobby"], kinds: ["school", "civic"], wall: true, w: 0.6, d: 0.04, h: 0.4, looks: 1, max: 1,
    make: (P) => ({ kit: [bx(P.woodDark, 0.6, 0.42, 0.03, 0, 2.2, 0.015)], screen: { w: 0.54, h: 0.36, x: 0, y: 2.2, z: 0.032, paint: (g, W, H) => { g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); const r = H * 0.25; g.fillStyle = "#cd2e3a"; g.beginPath(); g.arc(W / 2, H / 2, r, Math.PI, 0); g.fill(); g.fillStyle = "#0047a0"; g.beginPath(); g.arc(W / 2, H / 2, r, 0, Math.PI); g.fill(); g.fillStyle = "#cd2e3a"; g.beginPath(); g.arc(W / 2 - r / 2, H / 2, r / 2, 0, Math.PI * 2); g.fill(); g.fillStyle = "#0047a0"; g.beginPath(); g.arc(W / 2 + r / 2, H / 2, r / 2, 0, Math.PI * 2); g.fill(); g.fillStyle = "#000"; for (const [x, y] of [[0.18, 0.2], [0.82, 0.2], [0.18, 0.8], [0.82, 0.8]]) for (let k = 0; k < 3; k++) g.fillRect(W * x - W * 0.06, H * y - H * 0.1 + k * H * 0.07, W * 0.12, H * 0.04); }, fps: 0.01, on: true } }) },

  // ---- gyms
  { id: "inbody", label: "체성분 측정기", rooms: ["gym"], wall: true, w: 0.6, d: 0.8, h: 1.1, looks: 2, max: 1, weight: 3,
    make: (P, X, v) => ({ kit: [rb(v ? P.appliance : P.applianceDark, 0.55, 0.08, 0.7, 0.02, 0, 0.04, 0.45), bx(P.steel, 0.08, 0.9, 0.08, 0, 0.5, 0.1), rb(v ? P.appliance : P.applianceDark, 0.6, 0.25, 0.15, 0.03, 0, 1.0, 0.12), bx(X.monitor, 0.25, 0.16, 0.01, 0, 1.05, 0.2)],
      use: s => ({ box: [0.6, 1.1, 0.8, 0, 0.55, 0.4], label: () => s.st.busy ? "측정 중… 손잡이를 잡고 서 계세요" : "체성분(인바디) 측정하기", act: () => { if (s.st.busy) return null; s.st.busy = true; s.fx("chime"); setTimeout(() => { s.st.busy = false; s.toast(`골격근량 ${(26 + Math.random() * 8).toFixed(1)}kg · 체지방률 ${(14 + Math.random() * 12).toFixed(1)}% · 점수 ${70 + Math.floor(Math.random() * 20)}점`); }, 4000); return "beep"; } }) }) },
  { id: "bike", label: "실내 자전거", rooms: ["gym"], wall: false, w: 0.6, d: 1.2, h: 1.3, looks: 2, max: 4, minArea: 30,
    make: (P, X, v) => ({ kit: [bx(P.blackMetal, 0.08, 0.08, 1.1, 0, 0.05, 0), bx(P.blackMetal, 0.5, 0.05, 0.08, 0, 0.03, 0.5), bx(P.blackMetal, 0.5, 0.05, 0.08, 0, 0.03, -0.5), bx(v ? X.accent : P.applianceDark, 0.08, 0.8, 0.08, 0, 0.5, -0.1), rb(P.leather, 0.2, 0.06, 0.28, 0.02, 0, 0.95, -0.15), bx(v ? X.accent : P.applianceDark, 0.08, 0.9, 0.08, 0, 0.6, 0.4), bx(P.blackMetal, 0.45, 0.04, 0.04, 0, 1.08, 0.42), disc(P.chrome, 0.25, 0.04, 0, 0.35, 0.25, "x")],
      use: s => ({ box: [0.6, 1.3, 1.2, 0, 0.65, 0], label: () => s.st.on ? "자전거 그만 타기" : "실내 자전거 타기", act: () => { s.st.on = !s.st.on; if (s.st.on) { s.fx("treadmill"); s.toast("페달을 밟는 중 — 120 RPM, 3분에 30kcal."); } return "click"; } }) }) },

  // ---- stations
  { id: "arrivals", label: "열차 도착 안내기", rooms: ["lobby", "corridor"], kinds: ["civic"], wall: true, w: 1.6, d: 0.1, h: 0.5, looks: 3, max: 2, weight: 4,
    make: (P, _X, v) => ({ kit: [rb(P.applianceDark, 1.6, 0.5, 0.08, 0.01, 0, 2.55, 0.04)], screen: { w: 1.56, h: 0.46, x: 0, y: 2.55, z: 0.082, paint: arrivals, fps: 1, on: true },
      use: s => { s.st.line = pick(["2호선", "9호선", "신분당선"], v); s.st.colour = pick(["#3cb44a", "#bdb092", "#d4003b"], v); s.st.seed = v * 5; s.st.base = 120 + v * 70; return { box: [1.6, 0.5, 0.1, 0, 2.55, 0.04], label: () => `${s.st.line} 도착 정보 보기`, act: () => null }; } }) },
  { id: "ticketvm", label: "승차권 발매기", rooms: ["lobby", "corridor"], kinds: ["civic"], wall: true, w: 0.75, d: 0.6, h: 1.8, looks: 2, max: 3, minArea: 20,
    make: (P, X, v) => kiosk(P, X, v, { title: "승차권 발매·교통카드 충전", items: "1회용 교통카드|교통카드 충전|정기권|외국어 Language", foot: "카드를 올려 주세요", colour: "#0057a8" }, s => { s.fx("register"); s.toast(pick(["교통카드에 10,000원을 충전했어요.", "1회용 교통카드를 발급했어요 (보증금 500원 포함).", "카드 잔액은 8,450원이에요."], Math.floor(Math.random() * 3))); }, 0.75, 1.8) },
  { id: "gates", label: "개찰구", rooms: ["lobby"], kinds: ["civic"], wall: false, w: 3.6, d: 1.6, h: 1.0, looks: 2, max: 1, minArea: 60,
    make: (P, X, v) => gateKit(P, X, v, "교통카드 찍고 통과하기", "삑— 1,400원 결제됐어요. 잔액 6,850원.") },
  { id: "lockerbox", label: "물품보관함", rooms: ["lobby", "corridor"], kinds: ["civic", "retail"], wall: true, w: 1.8, d: 0.6, h: 1.9, looks: 2, max: 1, minArea: 25,
    make: (P, X, v) => ({ kit: [bx(v ? X.accent : P.steel, 1.8, 1.9, 0.6, 0, 0.95, 0.3), ...Array.from({ length: 15 }, (_, i) => bx(P.rubber, 0.33, 0.005, 0.005, -0.72 + (i % 5) * 0.36, 0.3 + Math.floor(i / 5) * 0.6, 0.603)), bx(X.monitor, 0.25, 0.18, 0.01, 0, 1.15, 0.606)],
      use: s => ({ box: [1.8, 1.9, 0.62, 0, 0.95, 0.3], label: () => "물품보관함 이용하기", act: () => { s.toast(`${10 + Math.floor(Math.random() * 30)}번 칸에 짐을 넣었어요. 비밀번호를 기억하세요 (4시간 2,000원).`); s.fx("keys"); return "door"; } }) }) },
  { id: "routemap", label: "노선도", rooms: ["lobby", "corridor", "liftHall"], kinds: ["civic"], wall: true, w: 2.0, d: 0.05, h: 1.2, looks: 1, max: 1,
    make: (P) => ({ kit: [bx(P.steel, 2.04, 1.24, 0.04, 0, 1.6, 0.02)], screen: { w: 2.0, h: 1.2, x: 0, y: 1.6, z: 0.042, paint: (g, W, H) => { g.fillStyle = "#fbfbf8"; g.fillRect(0, 0, W, H); const lines = ["#0052a4", "#3cb44a", "#ef7c1c", "#00a5de", "#996cac", "#cd7c2f", "#747f00", "#e6186c", "#bdb092"]; lines.forEach((c, i) => { g.strokeStyle = c; g.lineWidth = 6; g.beginPath(); const y0 = H * (0.12 + i * 0.09); g.moveTo(W * 0.05, y0); for (let k = 0; k <= 8; k++) g.lineTo(W * (0.05 + k * 0.11), y0 + Math.sin(k * 1.3 + i) * H * 0.06); g.stroke(); for (let k = 0; k <= 8; k++) { g.fillStyle = "#fff"; g.beginPath(); g.arc(W * (0.05 + k * 0.11), y0 + Math.sin(k * 1.3 + i) * H * 0.06, 4, 0, Math.PI * 2); g.fill(); g.strokeStyle = c; g.lineWidth = 2; g.stroke(); } }); g.fillStyle = "#222"; g.font = font(H * 0.045); g.fillText("수도권 전철 노선도", W * 0.05, H * 0.05); }, fps: 0.01, on: true } }) },

  // ---- museums
  { id: "audioguide", label: "오디오 가이드 키오스크", rooms: ["gallery", "lobby"], kinds: ["museum"], wall: true, w: 0.55, d: 0.45, h: 1.5, looks: 2, max: 1,
    make: (P, X, v, api) => kiosk(P, X, v, { title: "오디오 가이드", items: "한국어|English|中文|日本語", foot: "작품 번호를 누르세요", colour: "#5b2e2e" }, s => { s.fx("chime"); s.toast(pick([`이 작품은 ${api.name}의 대표 소장품으로, 조선 후기 생활상을 담고 있어요.`, "청자의 비색은 철분이 환원되며 생긴 푸른빛이에요.", "이 그림은 원근보다 시점의 이동으로 공간을 표현해요."], Math.floor(Math.random() * 3))); }) },
  { id: "vitrine", label: "전시 진열장", rooms: ["gallery"], kinds: ["museum"], wall: false, w: 1.0, d: 0.7, h: 1.6, looks: 4, max: 3, minArea: 30,
    make: (P, X, v) => ({ kit: [rb(pick([P.woodDark, P.applianceDark, X.laminate, P.appliance], v), 1.0, 0.85, 0.7, 0.01, 0, 0.425, 0), bx(P.glass, 0.96, 0.7, 0.66, 0, 1.2, 0), bx(P.ledWarm, 0.9, 0.01, 0.6, 0, 1.55, 0), ...(v % 2 ? [cy(P.ceramic, 0.12, 0.08, 0.32, 0, 1.01, 0, 24), cy(X.sheetGreen, 0.05, 0.1, 0.06, 0, 1.2, 0, 24)] : [rb(X.brass ?? P.chrome, 0.3, 0.2, 0.2, 0.03, 0, 0.95, 0), bx(P.book, 0.25, 0.02, 0.18, 0.25, 0.86, 0.1)])],
      use: s => ({ box: [1.0, 1.6, 0.7, 0, 0.8, 0], label: () => "전시품 설명 보기", act: () => { s.toast(pick(["청자 상감운학문 매병 — 고려 12세기, 구름과 학이 상감된 매병.", "백자 달항아리 — 조선 18세기, 넉넉한 둥근 형태가 특징.", "금동 반가사유상 — 삼국시대, 생각에 잠긴 미소.", "분청사기 — 조선 15세기, 백토를 분장한 자유로운 문양."], Math.floor(Math.random() * 4))); return "click"; } }) }) },
];

// (pieces some kits borrow)
function F_ivPole(P: import("./materials").Palette, X: Extra): Kit {
  return [cy(P.chrome, 0.012, 0.012, 1.85, 0, 0.925, 0, 8), ...[0, 1, 2, 3, 4].map(i => { const a = i / 5 * Math.PI * 2; return bx(P.chrome, 0.28, 0.02, 0.02, Math.cos(a) * 0.14, 0.04, Math.sin(a) * 0.14); }), bx(P.chrome, 0.3, 0.015, 0.015, 0, 1.85, 0), rb(X.curtain, 0.1, 0.16, 0.04, 0.02, 0.12, 1.72, 0)];
}
function gateKit(P: import("./materials").Palette, X: Extra, v: number, label: string, ok: string): Made {
  // three lanes: four cabinets, glass flaps between (the lane's gate)
  const k: Kit = [];
  for (let i = 0; i < 4; i++) k.push(rb(v ? P.steel : P.appliance, 0.22, 1.0, 1.5, 0.03, -1.5 + i * 1.0, 0.5, 0), bx(P.applianceDark, 0.2, 0.02, 1.4, -1.5 + i * 1.0, 1.01, 0), bx(X.accent, 0.12, 0.12, 0.01, -1.5 + i * 1.0, 0.95, 0.755), bx(P.ledPanel, 0.18, 0.03, 0.01, -1.5 + i * 1.0, 0.78, 0.756));
  return { kit: k, use: s => ({ box: [3.2, 1.0, 1.6, 0, 0.5, 0], label: () => s.st.open ? "통과 중…" : label, act: () => { if (s.st.open) return null; s.st.open = true; s.fx("scan"); s.toast(ok); setTimeout(() => { s.st.open = false; }, 2500); return "beep"; } }) };
}
function kiosk(P: import("./materials").Palette, X: Extra, v: number, screen: Record<string, string>, act: (s: Live) => void, w = 0.55, h = 1.6): Made {
  return { kit: [rb(pick([P.appliance, P.applianceDark, X.accentDark], v), w, h, 0.42, 0.03, 0, h / 2, 0.21), bx(P.applianceDark, w * 0.78, h * 0.3, 0.02, 0, h * 0.7, 0.425), bx(P.applianceDark, w * 0.4, 0.04, 0.12, 0, h * 0.42, 0.47), bx(X.accent, w, 0.12, 0.43, 0, h - 0.06, 0.21)],
    screen: { w: w * 0.74, h: h * 0.28, x: 0, y: h * 0.7, z: 0.437, paint: kioskScreen, fps: 1.4, on: true },
    use: s => { Object.assign(s.st, screen); return { box: [w, h, 0.5, 0, h / 2, 0.22], label: () => `${screen.title} 이용하기`, act: () => { act(s); return "beep"; } }; } };
}

// ---------------------------------------------------------------- placing them
const seedOf = (s: string) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Dress a room of a building with the equipment its kind of room has, on the wall and floor its
 * furnishing left: a few for a small room, more for a big one; each its own look by the building. */
export function dressRoom(api: DressApi) {
  const { c, room, pl, zone, kind } = api;
  const area = (pl.X1 - pl.X0) * (pl.Z1 - pl.Z0);
  if (area < 3) return;
  const station = /역$|역\s|지하철|역사/.test(api.name);
  const cands = DEFS.filter(d => d.rooms.includes(room.type) && (!d.kinds || d.kinds.includes(kind) || (station && d.kinds.includes("civic"))) && (d.minArea ?? 0) <= area
    // (the station's gates, machines and boards only in a station; the office's gates in offices)
    && (!["arrivals", "ticketvm", "gates", "routemap", "lockerbox"].includes(d.id) || station || (d.id === "lockerbox" && kind === "retail"))
    && !(d.id === "speedgate" && station));
  if (!cands.length) return;
  const seed = seedOf(`${api.name}|${room.id}|${room.label}`);
  let r = seed;
  const rnd = () => ((r = Math.imul(r ^ (r >>> 15), 2246822507) ^ Math.imul(r ^ (r >>> 13), 3266489909)) >>> 0) / 4294967296;
  // (how many: a small room two or three, a hall up to a dozen)
  const budget = Math.min(12, Math.max(2, Math.round(Math.sqrt(area) * 0.9)));
  const bag: Def[] = [];
  for (const d of cands) for (let i = 0; i < (d.weight ?? 1); i++) bag.push(d);
  const used = new Map<string, number>();
  const sides: SideName[] = ["n", "e", "s", "w"];
  let placed = 0;
  for (let tries = 0; tries < budget * 4 && placed < budget && bag.length; tries++) {
    const d = bag[Math.floor(rnd() * bag.length)], n = used.get(d.id) ?? 0;
    if (n >= (d.max ?? 1)) continue;
    const v = (seed + n * 7 + d.id.length) % d.looks;
    const made = d.make(c.P, c.X, v, api);
    let f: Frame | null = null;
    if (d.wall) {
      const order = [...sides].sort(() => rnd() - 0.5);
      for (const s of order) { f = api.wallPut(s, made.kit, d.w, d.d, null, d.h + 0.05, true); if (f) break; }
    } else {
      const cx = (pl.X0 + pl.X1) / 2, cz = (pl.Z0 + pl.Z1) / 2;
      f = api.freeNear(cx + (rnd() - 0.5) * (pl.X1 - pl.X0) * 0.5, cz + (rnd() - 0.5) * (pl.Z1 - pl.Z0) * 0.5, d.w, d.d, Math.floor(rnd() * 4) * Math.PI / 2);
      if (f) c.put(made.kit, f, zone, true);
    }
    if (!f) { for (const p of made.kit) p.g.dispose(); continue; }
    used.set(d.id, n + 1); placed++;
    live(api, d, made, f);
  }
}

/** a placed fixture brought to life: its screen (a canvas redrawn at its rate), its use */
function live(api: DressApi, d: Def, made: Made, f: Frame) {
  const { c, room, zone } = api;
  let screen: THREE.Mesh | null = null, tex: THREE.CanvasTexture | null = null, g: CanvasRenderingContext2D | null = null, clock = 0, t = 0;
  const st: Live["st"] = {};
  const sc = made.screen;
  if (sc) {
    const cv = document.createElement("canvas"), aspect = sc.w / sc.h;
    cv.width = Math.round(Math.min(512, 256 * Math.max(1, aspect))); cv.height = Math.round(cv.width / aspect);
    g = cv.getContext("2d"); tex = c.own(new THREE.CanvasTexture(cv)); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = c.own(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    const geo = c.own(new THREE.PlaneGeometry(sc.w, sc.h));
    screen = new THREE.Mesh(geo, mat); screen.applyMatrix4(new THREE.Matrix4().multiplyMatrices(f.m, new THREE.Matrix4().makeTranslation(sc.x, sc.y, sc.z)));
    screen.visible = sc.on !== false; c.dynamic.add(screen);
    if (g) sc.paint(g, cv.width, cv.height, 0, st), tex.needsUpdate = true;
  }
  const s: Live = {
    st,
    screenOn: on => { if (screen) screen.visible = on; },
    toast: text => c.hooks.toast?.(text),
    fx: n => c.hooks.fx?.(n),
    consume: (name, color) => c.hooks.consume ? c.hooks.consume({ id: `fx-${name}`, name, price: 0, kind: "drink", how: "drink", color } as unknown as import("./shop").Consumable) : c.hooks.toast?.(`${name} — 맛있게 먹었어요.`),
  };
  const use = made.use?.(s);
  const step = (dt: number) => {
    use?.update?.(dt);
    if (screen && g && tex && screen.visible && sc) {
      t += dt; clock += dt;
      if (clock >= 1 / (sc.fps ?? 1)) { clock = 0; sc.paint(g, g.canvas.width, g.canvas.height, t, st); tex.needsUpdate = true; }
    }
  };
  if (use) {
    const [w, h, dd, x, y, z] = use.box;
    c.interactables.push({ id: `fix-${d.id}-${room.id}-${c.interactables.length}`, zone, room, hit: c.hitIn(f, w, h, dd, x, y, z), label: use.label, act: use.act, update: step });
  } else if (screen) {
    // (a screen with nothing to use still runs: a clock, a board)
    c.interactables.push({ id: `fix-${d.id}-${room.id}-${c.interactables.length}`, zone, room, hit: c.hitIn(f, 0.01, 0.01, 0.01, 0, -5, 0), label: () => d.label, act: () => null, update: step, enabled: () => false });
  }
}

/** how many kinds the catalogue has, and their looks (for the checks) */
export const FIXTURE_COUNT = { kinds: DEFS.length, looks: DEFS.reduce((a, d) => a + d.looks, 0) };
