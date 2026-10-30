import { originAt, toFrame, toLonLat } from "../drivegame/world/geo";

export type Point = [number, number];
export interface WalkFootprint { id: string; pnu: string; name: string; floors: number; use: string; ring: Point[] }
export interface WalkEntry { lat: number; lon: number; name: string; floors: number; heading: number; foot: Point[]; campus: Point[][]; door: Point; back?: string }
export function parseWalkAt(value: string | null): Point | null {
  if (!value || !/^\d+(?:\.\d+)?,\d+(?:\.\d+)?$/.test(value)) return null;
  const [lat, lon] = value.split(",").map(Number);
  return lat >= 33 && lat <= 39 && lon >= 124 && lon <= 132 ? [lat, lon] : null;
}
export function walkLink(lat: number, lon: number, floor = 1) {
  if (!parseWalkAt(`${lat},${lon}`)) throw Error("Invalid walk location");
  return `/walk?at=${lat.toFixed(6)},${lon.toFixed(6)}${Number.isInteger(floor) && floor !== 1 && floor >= -20 && floor <= 200 ? `&f=${floor}` : ""}`;
}
const inside = ([x, y]: Point, r: Point[]) => {
  let hit = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
};
const area = (r: Point[]) => Math.abs(r.reduce((sum, a, i) => { const b = r[(i + 1) % r.length]; return sum + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
const closest = (p: Point, r: Point[]) => {
  let best = { d: Infinity, p: r[0] };
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const q: Point = [a[0] + dx * t, a[1] + dy * t], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best.d) best = { d, p: q };
  }
  return best;
};
/** A point inside even a concave building, so a copied coordinate selects the same block. */
export function walkAnchor(ring: Point[]): Point {
  const o = originAt(ring[0][1], ring[0][0]), r = ring.map(([lon, lat]) => toFrame(o, lon, lat));
  const ys = r.map(p => p[1]).sort((a, b) => a - b);
  let best: Point = r[0], width = -1;
  for (let i = 1; i < ys.length; i++) {
    if (ys[i] - ys[i - 1] < .02) continue;
    const y = (ys[i] + ys[i - 1]) / 2, xs: number[] = [];
    for (let a = 0, b = r.length - 1; a < r.length; b = a++) if ((r[a][1] > y) !== (r[b][1] > y)) xs.push(r[a][0] + (y - r[a][1]) * (r[b][0] - r[a][0]) / (r[b][1] - r[a][1]));
    xs.sort((a, b) => a - b);
    for (let j = 1; j < xs.length; j += 2) if (xs[j] - xs[j - 1] > width) { width = xs[j] - xs[j - 1]; best = [(xs[j] + xs[j - 1]) / 2, y]; }
  }
  const [lon, lat] = toLonLat(o, ...best); return [lat, lon];
}
export function resolveWalkEntry(lat: number, lon: number, buildings: WalkFootprint[]): WalkEntry {
  const o = originAt(lat, lon);
  const all = buildings.filter(b => b.ring.length >= 3).map(b => ({ b, r: b.ring.map(([lo, la]) => toFrame(o, lo, la)) }));
  const ranked = all.map(b => ({ ...b, distance: inside([0, 0], b.r) ? 0 : closest([0, 0], b.r).d })).sort((a, b) => a.distance - b.distance || area(a.r) - area(b.r));
  const target = ranked[0]; if (!target || target.distance > 25) throw Error("건물 외곽선을 찾지 못했습니다. 잠시 후 다시 열어 주세요.");
  const got: typeof all = [target], rest = all.filter(a => a.b.id !== target.b.id && area(a.r) > 150 && (!target.b.pnu || a.b.pnu === target.b.pnu));
  for (let grew = true; grew && got.length < 16;) {
    grew = false;
    for (let i = 0; i < rest.length; i++) if (got.some(g => g.r.some(p => closest(p, rest[i].r).d < 30) || rest[i].r.some(p => closest(p, g.r).d < 30))) {
      got.push(rest[i]); rest.splice(i--, 1); grew = true; if (got.length >= 16) break;
    }
  }
  const edge = closest([0, 0], target.r).p;
  // The normal pointing outside the footprint gives an entrance and an outdoor return point.
  let door: Point = edge, heading = 0;
  for (let k = 0; k < 24; k++) {
    const a = k * Math.PI / 12, p: Point = [edge[0] + Math.cos(a) * 1.5, edge[1] + Math.sin(a) * 1.5];
    if (!inside(p, target.r) && closest(p, target.r).d > 1) { door = p; heading = a; break; }
  }
  return { lat, lon, name: target.b.name, floors: target.b.floors, heading, foot: target.b.ring,
    campus: got.slice(1).map(g => g.b.ring), door: toLonLat(o, ...door) };
}
const cacheKey = (lat: number, lon: number) => `walk.entry:${lat.toFixed(6)},${lon.toFixed(6)}`;
export function rememberWalkEntry(entry: WalkEntry) { try { sessionStorage.setItem(cacheKey(entry.lat, entry.lon), JSON.stringify(entry)); } catch { /* A shared link resolves without browser storage. */ } }
export function recalledWalkEntry(lat: number, lon: number): WalkEntry | null {
  try {
    const e = JSON.parse(sessionStorage.getItem(cacheKey(lat, lon)) ?? "null") as WalkEntry | null;
    return e && Array.isArray(e.foot) && e.foot.length >= 3 && e.foot.length < 10000 && e.foot.every(p => p.length === 2 && p.every(Number.isFinite)) && Array.isArray(e.campus) && Array.isArray(e.door) ? e : null;
  } catch { return null; }
}
export function safeWalkBack(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  try { const url = new URL(value, "https://kospimap.com"); return url.origin === "https://kospimap.com" ? url.pathname + url.search + url.hash : null; } catch { return null; }
}
