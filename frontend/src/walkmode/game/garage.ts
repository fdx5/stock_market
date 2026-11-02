/* The garage of the on-foot world: the cars and bicycles a walker can call up (N), each a body of
 * the traffic's own models (CAR_SPECS kinds) with its own paint, top speed and pull. The names
 * are made up by class, not makers' models. */

export interface GarageCar {
  id: string; name: string; group: string;
  /** the traffic model it is drawn with (sceneCars CAR_SPECS) */
  kind: string; paint: string;
  /** km/h, and the pull (multiplies the kind's own acceleration) */
  top: number; pull: number;
  /** a siren's lights: police and 119 */
  siren?: boolean;
  /** length, width, height (m) for a model the drawn car kinds (CAR_SPECS) do not have */
  size?: [number, number, number];
}
export interface GarageBike { id: string; name: string; top: number; accel: number; paint: string; note: string }

const car = (group: string, kind: string, rows: [string, string, string, number, number, boolean?][]): GarageCar[] =>
  rows.map(([id, name, paint, top, pull, siren]) => ({ id, name, group, kind, paint, top, pull, siren }));

export const GARAGE_CARS: GarageCar[] = [
  ...car("경차·소형", "kei-box", [["cube-mint", "시티 큐브", "#8fd6c4", 145, 0.9], ["cube-yellow", "시티 큐브 옐로", "#f2c94c", 145, 0.9], ["box-ev", "박스 EV", "#e9ecef", 150, 1.25]]),
  ...car("경차·소형", "hatchback-sports", [["hatch-red", "핫 해치 R", "#d62f2f", 205, 1.35], ["hatch-blue", "어반 해치", "#2f6fd6", 175, 1.05], ["hatch-white", "어반 해치 화이트", "#f5f5f2", 175, 1.05]]),
  ...car("세단", "sedan", [["sedan-silver", "패밀리 세단", "#b8bec6", 190, 1], ["sedan-black", "패밀리 세단 블랙", "#16181c", 190, 1], ["sedan-blue", "하이브리드 세단", "#36507a", 185, 1.1]]),
  ...car("세단", "sedan-sports", [["sport-orange", "스포츠 세단 GT", "#f07a1a", 240, 1.45], ["sport-green", "스포츠 세단 그린", "#1f7a4a", 235, 1.4], ["sport-gray", "스포츠 세단 N", "#5b6168", 250, 1.55]]),
  ...car("세단", "sedan-large", [["grand-black", "그랜드 리무진", "#0e0f12", 230, 1.2], ["grand-pearl", "그랜드 펄", "#ece6da", 225, 1.15], ["grand-wine", "그랜드 와인", "#5a1a24", 228, 1.18]]),
  ...car("SUV", "suv-small", [["cross-lime", "어반 크로스", "#a6c94a", 180, 1.05], ["cross-sky", "어반 크로스 스카이", "#8ec5e8", 180, 1.05]]),
  ...car("SUV", "suv", [["suv-white", "투어러 SUV", "#f2f2ef", 195, 1.1], ["suv-khaki", "트레일 SUV", "#6f6b4d", 185, 1.0], ["suv-red", "투어러 SUV 레드", "#a31f24", 195, 1.1]]),
  ...car("SUV", "suv-luxury", [["luxe-black", "플래그십 SUV", "#141619", 220, 1.2], ["luxe-blue", "플래그십 SUV 블루", "#1d3557", 220, 1.2]]),
  ...car("승합·화물", "mpv", [["mpv-white", "패밀리 MPV", "#f4f4f1", 175, 0.85], ["mpv-gray", "VIP 리무진 MPV", "#3a3e44", 180, 0.9]]),
  ...car("승합·화물", "van", [["van-white", "스타 밴", "#eeeeea", 165, 0.8], ["van-ambulance", "119 구급차", "#ffffff", 190, 1.15, true]]),
  ...car("승합·화물", "cargo", [["cargo-blue", "1톤 트럭", "#2d5fa8", 150, 0.75], ["cargo-white", "1톤 트럭 화이트", "#eeeeea", 150, 0.75]]).map(c => ({ ...c, size: [5.1, 1.75, 2.0] as [number, number, number] })),
  ...car("승합·화물", "boxtruck", [["box-white", "탑차", "#e9e9e6", 130, 0.6]]).map(c => ({ ...c, size: [6.5, 2.2, 3.0] as [number, number, number] })),
  ...car("승합·화물", "bus", [["bus-blue", "시내버스", "#2a6fc4", 110, 0.5]]).map(c => ({ ...c, size: [11, 2.5, 3.2] as [number, number, number] })),
  ...car("특수", "taxi", [["taxi-orange", "개인택시", "#f39c12", 190, 1.0], ["taxi-black", "모범택시", "#121212", 195, 1.05]]),
  ...car("특수", "sedan", [["police", "경찰 순찰차", "#f4f6f8", 230, 1.4, true]]),
];

export const GARAGE_BIKES: GarageBike[] = [
  { id: "city", name: "시티 자전거", top: 32 / 3.6, accel: 2.4, paint: "#2f6fd6", note: "바구니 달린 생활형" },
  { id: "road", name: "로드 바이크", top: 58 / 3.6, accel: 3.4, paint: "#d62f2f", note: "가볍고 빠름" },
  { id: "mtb", name: "산악 자전거(MTB)", top: 45 / 3.6, accel: 3.6, paint: "#2c8a4a", note: "출발이 힘참" },
  { id: "ebike", name: "전기 자전거", top: 25 / 3.6 * 1.6, accel: 4.6, paint: "#f2c94c", note: "모터 보조" },
  { id: "bmx", name: "BMX", top: 36 / 3.6, accel: 4.2, paint: "#8e44ad", note: "민첩한 회전" },
  { id: "turbo", name: "터보 바이크 (게임용)", top: 100 / 3.6, accel: 3.2, paint: "#5ef0ff", note: "최고 100km/h" },
];
