/* Live public data over the drone view (the server's /api/realestate/live/*: public_live.py):
 * subway trains and stations, emergency-room beds, road speeds, 따릉이 docks, public car parks.
 * The provider keys stay on the server; here only what it answers. */

export type LiveStatus = 'ok' | 'partial' | 'needs_key' | 'invalid_key' | 'unavailable' | 'outside';
export type LiveKind = 'subway' | 'er' | 'traffic' | 'bike' | 'parking' | 'facility';

export type SubwayStation = { name: string; key: string; lat: number; lon: number; lines: string[] };
export type SubwayData = { lines: Record<string, { colour: string; routes: { stops: number[]; loop?: '내선' | '외선' }[] }>; stations: SubwayStation[]; attribution: string };
export type Train = { line: string; train: string; station: string; stationId: string; direction: string; terminal: string;
  status: string; express: boolean; last: boolean; at: string };
export type Arrival = { line: string; direction: string; heading: string; toward: string; train: string; seconds: number; message: string;
  at: string; code: string; kind: string; last: boolean; received: string; order: string };
export type Timetable = { line: string; code: string; fr?: string; inout: string; direction?: string; status: LiveStatus; items: { time: string; arrive: string; train: string; to: string; from: string; express: boolean }[] };
export type StationInfo = { name: string; week: '1' | '2' | '3'; weekName: string; status: LiveStatus; arrivalStatus?: LiveStatus; timetableStatus?: LiveStatus;
  arrivals: Arrival[]; timetables: Timetable[]; source: string; updated: string };
export type EmergencyRoom = { id: string; name: string; lat: number; lon: number; kind: string; address: string; tel: string; updated: string; distance: number;
  er: number | null; erTotal: number | null; surgery: number | null; icu: number | null; ward: number | null; neonatal: number | null; neuroIcu: number | null; chestIcu: number | null;
  ct: boolean; mri: boolean; angio: boolean; ventilator: boolean; ambulance: boolean };
export type BikeDock = { id: string; name: string; lat: number; lon: number; bikes: number; racks: number; shared: number; distance: number };
export type ParkingLot = { id: string; name: string; address: string; lat: number; lon: number; total: number | null; parked: number | null; live: boolean; updated: string;
  type: string; tel: string; paid: string; basic: { won: number | null; minutes: number | null }; extra: { won: number | null; minutes: number | null }; dayMax: number | null;
  hours: { weekday: string; weekend: string; holiday: string }; distance: number };
export type Facility = { id: string; kind: 'fire' | 'police' | 'health' | 'post' | 'aed' | 'shelter' | 'exit'; ref?: string; wheelchair?: string; name: string; lat: number; lon: number; address: string; phone: string; hours: string; access: string; indoor: boolean; description: string; distance: number };
export const FACILITY: Record<Facility['kind'], { icon: string; label: string; colour: string }> = {
  fire: { icon: '🚒', label: '소방서·119안전센터', colour: '#ff6b4a' }, police: { icon: '🚓', label: '경찰서·지구대', colour: '#6aa8ff' },
  health: { icon: '⚕️', label: '보건소', colour: '#5fd39a' }, post: { icon: '📮', label: '우체국', colour: '#ff9b3d' },
  aed: { icon: '❤️', label: '자동심장충격기(AED)', colour: '#ff5a7a' }, shelter: { icon: '🛡️', label: '대피소·대피장소', colour: '#ffd34d' },
  exit: { icon: '🚇', label: '지하철 출입구', colour: '#f2c200' },
};
export type LiveList<T> = { status: LiveStatus; items: T[]; source?: string; updated?: string; stale?: boolean };

/** What a sign of the live layers carries: its panel opens on a tap. */
export type LiveRef =
  | { type: 'station'; station: SubwayStation; exit?: Facility }
  | { type: 'train'; train: Train; colour: string }
  | { type: 'er'; room: EmergencyRoom }
  | { type: 'bike'; dock: BikeDock }
  | { type: 'parking'; lot: ParkingLot }
  | { type: 'facility'; place: Facility }
  | { type: 'list' };

const API = '/api/realestate/live';
async function json<T>(url: string, signal?: AbortSignal, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { signal, ...init });
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<T>;
}
const at = (lat: number, lon: number) => `lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`;
export const liveApi = {
  trains: (lines: string[], signal?: AbortSignal) => json<LiveList<Train>>(`${API}/subway/trains?lines=${encodeURIComponent(lines.join(','))}`, signal),
  station: (name: string, lines: string[], week?: string, signal?: AbortSignal) =>
    json<StationInfo>(`${API}/subway/station?name=${encodeURIComponent(name)}&lines=${encodeURIComponent(lines.join(','))}${week ? `&week=${week}` : ''}`, signal),
  emergency: (lat: number, lon: number, signal?: AbortSignal) => json<LiveList<EmergencyRoom>>(`${API}/emergency?${at(lat, lon)}`, signal),
  bikes: (lat: number, lon: number, signal?: AbortSignal) => json<LiveList<BikeDock>>(`${API}/bikes?${at(lat, lon)}`, signal),
  parking: (lat: number, lon: number, signal?: AbortSignal) => json<LiveList<ParkingLot>>(`${API}/parking?${at(lat, lon)}`, signal),
  facilities: (lat: number, lon: number, signal?: AbortSignal) => nearFacilities(lat, lon, signal),
  aed: (lat: number, lon: number, signal?: AbortSignal) => json<LiveList<Facility & { model?: string; manager?: string }>>(`${API}/aed?${at(lat, lon)}`, signal),
  traffic: (lat: number, lon: number, links: string[], signal?: AbortSignal) => json<{ status: LiveStatus; speeds: Record<string, number>; pending?: number; source: string; updated: string }>(
    `${API}/traffic`, signal, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat, lon, links }) }),
};

let subway: Promise<SubwayData | null> | null = null;
/** The stations and each line's station order (OpenStreetMap, built by scripts/build-subway-stations.py). */
export function subwayData(): Promise<SubwayData | null> {
  return subway ??= fetch('/live/subway-20261017-v2.json').then(r => (r.ok ? r.json() : null)).catch(() => { subway = null; return null; });
}

/** A station's name as both sources write it: no 역, no bracketed alias, no spaces. */
export const stationKey = (name: string) => {
  const n = name.replace(/\(.*?\)/g, '').replace(/\s+/g, '');
  return n.length > 2 && n.endsWith('역') ? n.slice(0, -1) : n;
};

/** Where a train is, from the station the feed names it at and what it is doing there: at the
 * station (도착), coming in (진입: a little before it), just gone (출발: a little past it), or
 * between the station before and it (전역출발). Before and past along its line's order the way
 * it is going (toward its terminal; 2호선 by 내선/외선). */
export function placeTrain(d: SubwayData, t: Train, near: { lat: number; lon: number }): { lat: number; lon: number; next: SubwayStation[]; heading: number } | null {
  const line = d.lines[t.line]; if (!line) return null;
  const key = stationKey(t.station), term = stationKey(t.terminal);
  const cand = d.stations.map((s, i) => [s, i] as const).filter(([s]) => s.key === key && s.lines.includes(t.line));
  if (!cand.length) return null;
  const kx = Math.cos(near.lat * Math.PI / 180) * 111320, dist = (s: { lat: number; lon: number }) => Math.hypot((s.lon - near.lon) * kx, (s.lat - near.lat) * 110540);
  const [st, si] = cand.sort((a, b) => dist(a[0]) - dist(b[0]))[0];
  let best: { stops: number[]; i: number } | null = null;
  const loop = t.line === '2호선' ? (t.direction === '0' ? '내선' : '외선') : null;
  for (const r of line.routes) {
    const i = r.stops.indexOf(si); if (i < 0) continue;
    if (loop) { if (r.loop === loop) { best = { stops: r.stops, i }; break; } continue; }
    const ti = r.stops.findIndex(s => d.stations[s].key === term);
    if (ti > i && (!best || r.stops.length > best.stops.length)) best = { stops: r.stops, i };
  }
  const stop = (k: number) => {
    if (!best) return null; const n = best.stops.length;
    const j = loop ? ((k % n) + n) % n : k; return j >= 0 && j < n ? d.stations[best.stops[j]] : null;
  };
  const prev = stop((best?.i ?? 0) - 1), next = stop((best?.i ?? 0) + 1);
  const mix = (a: SubwayStation, b: SubwayStation | null, f: number) => b ? { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f } : { lat: a.lat, lon: a.lon };
  const p = t.status === '진입' ? mix(st, prev, .2) : t.status === '출발' ? mix(st, next, .2) : t.status === '전역출발' ? mix(st, prev, .55) : { lat: st.lat, lon: st.lon };
  const ahead = next ?? st, from = prev ?? st;
  const heading = Math.atan2((ahead.lon - from.lon) * kx, (ahead.lat - from.lat) * 110540) * 180 / Math.PI;
  const upcoming: SubwayStation[] = [];
  if (best) for (let k = 1; k <= 6; k++) { const s = stop(best.i + k); if (!s) break; upcoming.push(s); if (s.key === term) break; }
  return { ...p, next: upcoming, heading };
}

/** How far (in stations) each train on the line is from the station, coming toward it. */
export function trainsComing(d: SubwayData, trains: Train[], station: SubwayStation, line: string): { train: Train; away: number; direction: string }[] {
  const out: { train: Train; away: number; direction: string }[] = [];
  const si = d.stations.indexOf(station); if (si < 0) return out;
  const routes = d.lines[line]?.routes ?? [];
  for (const t of trains) {
    if (t.line !== line) continue;
    const key = stationKey(t.station), term = stationKey(t.terminal), loop = line === '2호선' ? (t.direction === '0' ? '내선' : '외선') : null;
    let found: number | null = null;
    for (const r of routes) {
      if (loop && r.loop !== loop) continue;
      const i = r.stops.findIndex(s => d.stations[s].key === key), j = r.stops.indexOf(si);
      if (i < 0 || j < 0) continue;
      let away = j - i; if (loop && away < 0) away += r.stops.length;
      if (!loop) { const ti = r.stops.findIndex(s => d.stations[s].key === term); if (ti < j) continue; }
      if (away >= 0 && away <= 12 && (found === null || away < found)) found = away;
    }
    if (found !== null) out.push({ train: t, away: found + (t.status === '전역출발' ? -.5 : t.status === '출발' && found > 0 ? -.2 : 0), direction: t.direction });
  }
  return out.sort((a, b) => a.away - b.away);
}

export const LIVE_STATUS_TEXT: Record<string, string> = {
  needs_key: '서버에 제공기관 인증키 설정이 필요합니다',
  invalid_key: '제공기관이 인증키를 승인하지 않았습니다 (활용신청 확인)',
  unavailable: '제공기관 연결이 지연되고 있습니다 · 다시 시도 중',
  partial: '일부 정보를 불러오지 못했습니다',
  outside: '도로소통 정보는 현재 서울 지역만 제공됩니다',
};

/** The trains last fetched (the station panel counts the ones coming its way). */
export const liveState = {
  subway: null as SubwayData | null, trains: [] as Train[], trainsAt: 0,
  /** the last lists round the drone (the 종합 목록 panel) */
  rooms: [] as EmergencyRoom[], docks: [] as BikeDock[], lots: [] as ParkingLot[], places: [] as Facility[],
  listeners: new Set<() => void>(),
  emit() { for (const f of this.listeners) f(); },
};

/** An emergency room's free beds as a word: E-Gen reports more patients than beds as a negative. */
export const bedsText = (er: number | null) => er === null ? '정보 없음' : er < 0 ? `포화 (${-er}명 초과)` : er === 0 ? '병상 없음' : `${er}병상`;

/* The public facilities and subway entrances: static cells built from OpenStreetMap
 * (scripts/build-public-facilities.py) — the hosting network cannot reach Overpass at run time. */
const FACILITY_ROOT = '/live/facilities-20261017-v1';
let facilityCells: Promise<{ cell: number; cells: Set<string> } | null> | null = null;
const facilityCell = new Map<string, Promise<Facility[]>>();
async function nearFacilities(lat: number, lon: number, signal?: AbortSignal, radius = 3000): Promise<LiveList<Facility>> {
  facilityCells ??= fetch(`${FACILITY_ROOT}/manifest.json`).then(r => (r.ok ? r.json() : null)).then(m => m ? { cell: m.cell, cells: new Set<string>(m.cells) } : null).catch(() => { facilityCells = null; return null; });
  const m = await facilityCells;
  if (!m) return { status: 'unavailable', items: [] };
  const dy = radius / 110540, dx = radius / (111320 * Math.cos(lat * Math.PI / 180)), out: Facility[] = [];
  const keys: string[] = [];
  for (let i = Math.floor((lat - dy) / m.cell); i <= Math.floor((lat + dy) / m.cell); i++)
    for (let j = Math.floor((lon - dx) / m.cell); j <= Math.floor((lon + dx) / m.cell); j++) if (m.cells.has(`${i}_${j}`)) keys.push(`${i}_${j}`);
  const lists = await Promise.all(keys.map(k => {
    let p = facilityCell.get(k);
    if (!p) { p = fetch(`${FACILITY_ROOT}/${k}.json`, { signal }).then(r => (r.ok ? r.json() : [])).catch(() => { facilityCell.delete(k); return []; }); facilityCell.set(k, p); }
    return p;
  }));
  if (facilityCell.size > 200) for (const k of facilityCell.keys()) { if (facilityCell.size <= 150) break; if (!keys.includes(k)) facilityCell.delete(k); }
  const kx = 111320 * Math.cos(lat * Math.PI / 180);
  for (const list of lists) for (const f of list) {
    const d = Math.hypot((f.lon - lon) * kx, (f.lat - lat) * 110540);
    if (d <= radius) out.push(Object.assign({ address: '', phone: '', hours: '', access: '', indoor: false, description: '' }, f, { distance: Math.round(d) }));
  }
  out.sort((a, b) => a.distance - b.distance);
  return { status: 'ok', items: out.slice(0, 800), source: '© OpenStreetMap contributors (ODbL)' };
}
