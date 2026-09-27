import { RealEstateBuilding, RealEstateBuildingsResponse } from "../api/client";

/* A complex's buildings straight from VWorld (국토교통부 GIS건물통합정보), in the
 * browser. VWorld answers Korean networks only, so the server abroad can't ask it;
 * a reader in Korea can. It sends no CORS headers but supports JSONP. The logic
 * mirrors backend app/services/realestate_buildings.py (_from_vworld, _fill_heights):
 * keep the two in step. */

const ADDRESS = "https://api.vworld.kr/req/address";
const DATA = "https://api.vworld.kr/req/data";
const FLOOR_M = 2.9, GROUND_M = 1.5, CONTEXT_M = 230;

let seq = 0;
function jsonp(url: string, params: Record<string, string | number>, timeoutMs = 15000): Promise<any> {
  return new Promise((resolve, reject) => {
    const name = `__vw${Date.now().toString(36)}${seq++}`;
    const script = document.createElement("script");
    const w = window as unknown as Record<string, unknown>;
    const done = () => { window.clearTimeout(timer); delete w[name]; script.remove(); };
    const timer = window.setTimeout(() => { done(); reject(new Error("VWorld 응답 시간 초과")); }, timeoutMs);
    w[name] = (body: unknown) => { done(); resolve(body); };
    script.onerror = () => { done(); reject(new Error("VWorld 연결 실패")); };
    const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), format: "json", callback: name });
    script.src = `${url}?${q}`;
    document.head.appendChild(script);
  });
}

async function call(url: string, params: Record<string, string | number>) {
  const body = (await jsonp(url, params))?.response ?? {};
  if (body.status === "NOT_FOUND") return {};
  if (body.status !== "OK") throw new Error(`VWorld: ${body.error?.text ?? body.status}`);
  return body.result ?? {};
}

type Ring = [number, number][];
type Feature = { properties: Record<string, string>; geometry: { type: string; coordinates: any } };

const features = (r: any): Feature[] => r?.featureCollection?.features ?? [];
const polygons = (g: Feature["geometry"]): number[][][][] =>
  g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : [];
const area = (r: Ring) => r.reduce((s, [x1, y1], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x1 * y2 - x2 * y1; }, 0) / 2;
const centroid = (r: Ring): [number, number] => [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
function inside([x, y]: [number, number], r: Ring) {
  let hit = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [x1, y1] = r[i], [x2, y2] = r[j];
    if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) hit = !hit;
  }
  return hit;
}
function clean(ring: Ring): Ring | null {
  let r = ring.map(([x, y]) => [x, y] as [number, number]);
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r = r.slice(0, -1);
  if (r.length < 3 || Math.abs(area(r)) < 4) return null;
  return area(r) > 0 ? r : r.reverse();
}
const norm = (s: string) => (s || "").replace(/[\s\p{P}\p{S}_]/gu, "").toLowerCase().replace(/(아파트|apt)$/, "");
function namesMatch(a: string, b: string) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  return x === y || (y.length >= 3 && x.includes(y)) || (x.length >= 3 && y.includes(x));
}
const num = (v: unknown) => { const n = parseFloat(String(v ?? "")); return Number.isFinite(n) && n > 0 ? n : null; };

function fillHeights(list: RealEstateBuilding[]) {
  // A register footprint without 층수 is a guard post or ramp, never an invented tower.
  for (const b of list) {
    if (b.height) { b.floors = b.floors || Math.max(1, Math.round((b.height - GROUND_M) / FLOOR_M)); continue; }
    if (b.floors) { b.height = Math.round((b.floors * FLOOR_M + GROUND_M) * 10) / 10; b.height_source = "floors"; continue; }
    b.floors = 2; b.height = 6.5; b.height_source = "estimated";
  }
}

const memo = new Map<string, RealEstateBuildingsResponse | null>();

export async function vworldBuildings(
  id: string, query: { parcel: string | null; name: string }, key: string,
  // The key is bound to the domain registered with VWorld, sent as `domain`.
  domain = "https://kospimap.com",
): Promise<RealEstateBuildingsResponse | null> {
  if (memo.has(id)) return memo.get(id)!;
  if (!query.parcel) return null;
  const point = (await call(ADDRESS, { service: "address", request: "getcoord", version: "2.0", crs: "epsg:4326",
    address: query.parcel, refine: "true", simple: "false", type: "parcel", key, domain })).point;
  if (!point) { memo.set(id, null); return null; }
  const lon = +point.x, lat = +point.y;
  const common = { service: "data", request: "GetFeature", crs: "EPSG:4326", geometry: "true", attribute: "true", key, domain };
  const parcel = features(await call(DATA, { ...common, data: "LP_PA_CBND_BUBUN", geomFilter: `POINT(${lon} ${lat})`, size: 10 }))[0];
  if (!parcel) { memo.set(id, null); return null; }
  const rings = polygons(parcel.geometry).map(p => p[0] as unknown as Ring);
  const lons = rings.flat().map(p => p[0]), lats = rings.flat().map(p => p[1]);
  const padLon = CONTEXT_M / (111_320 * Math.cos((lat * Math.PI) / 180)), padLat = CONTEXT_M / 110_540;
  const box = `BOX(${Math.min(...lons) - padLon},${Math.min(...lats) - padLat},${Math.max(...lons) + padLon},${Math.max(...lats) + padLat})`;
  // The parcel's own box (every page: the complex must be whole) and the padded
  // neighbourhood (one page is plenty of setting) in parallel — each JSONP call is
  // ~1 MB of uncompressed GeoJSON, the slow part in a browser.
  const tight = `BOX(${Math.min(...lons)},${Math.min(...lats)},${Math.max(...lons)},${Math.max(...lats)})`;
  const fetchBox = (geomFilter: string, page: number) =>
    call(DATA, { ...common, data: "LT_C_BLDGINFO", geomFilter, size: 1000, page }).then(features);
  const own = (async () => {
    const all: Feature[] = [];
    for (let page = 1; page <= 3; page++) {
      const batch = await fetchBox(tight, page);
      all.push(...batch);
      if (batch.length < 1000) break;
    }
    return all;
  })();
  const [mineFs, padFs] = await Promise.all([own, fetchBox(box, 1).catch(() => [] as Feature[])]);
  const seen = new Set<string>();
  const sig = (f: Feature) => JSON.stringify(f.geometry?.coordinates ?? "").slice(0, 80);
  const around = [...mineFs, ...padFs].filter(f => { const k = sig(f); if (seen.has(k)) return false; seen.add(k); return true; });
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320, ky = 110_540;
  const project = ([x, y]: number[]): [number, number] => [Math.round((x - lon) * kx * 100) / 100, Math.round((y - lat) * ky * 100) / 100];
  const buildings: RealEstateBuilding[] = [], context: RealEstateBuilding[] = [];
  for (const f of around) {
    const polys = polygons(f.geometry);
    if (!polys.length) continue;
    const p = f.properties;
    const mine = rings.some(r => inside(centroid(polys[0][0] as unknown as Ring), r)) || namesMatch(p.bld_nm || "", query.name);
    for (const poly of polys) {
      const outer = clean(poly[0].map(project));
      if (!outer) continue;
      const holes = poly.slice(1).map(r => clean(r.map(project))).filter((h): h is Ring => !!h).map(h => h.reverse());
      const height = num(p.height), floors = num(p.grnd_flr);
      const b: RealEstateBuilding = {
        rings: [outer, ...holes], height: height ?? 0, floors: floors ? Math.round(floors) : 0, base: 0,
        height_source: height ? "measured" : "floors", name: (p.dong_nm || "").trim() || null, use: p.usability || null,
        approved: /^(19|20)\d{2}/.test(p.useapr_day || "") ? +p.useapr_day.slice(0, 4) : null,
      };
      if (!height && !floors) b.height_source = "estimated";
      (mine ? buildings : context).push(b);
    }
  }
  if (!buildings.length) { memo.set(id, null); return null; }
  fillHeights(buildings);
  fillHeights(context);
  const near = (b: RealEstateBuilding) => Math.hypot(...centroid(b.rings[0]));
  const nearby = context.filter(b => b.height >= 4).sort((a, b) => near(a) - near(b)).slice(0, 700);
  const site = rings.map(r => clean(r.map(project))).filter((r): r is Ring => !!r);
  const measured = buildings.filter(b => b.height_source !== "estimated").length;
  const out: RealEstateBuildingsResponse = {
    id, name: query.name, address: query.parcel, built: null, found: true, source: "vworld",
    attribution: "국토교통부 GIS건물통합정보 · 연속지적도 (브이월드)", center: { lat, lon },
    site, buildings, context: nearby, coverage: { buildings: buildings.length, with_height: measured },
    vworld: true, error: null, fetched_at: new Date().toISOString(),
  };
  memo.set(id, out);
  return out;
}
