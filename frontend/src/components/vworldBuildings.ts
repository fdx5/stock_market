import { RealEstateBuilding, RealEstateBuildingsResponse, RealEstateParcel, RealEstateRoad } from "../api/client";
import { prefetchTerrain } from "./sceneTerrain";

/* A complex's buildings straight from VWorld (국토교통부 GIS건물통합정보), in the
 * browser. VWorld answers Korean networks only, so the server abroad can't ask it;
 * a reader in Korea can. It sends no CORS headers but supports JSONP. The logic
 * mirrors backend app/services/realestate_buildings.py (_from_vworld, _fill_heights):
 * keep the two in step. */

const ADDRESS = "https://api.vworld.kr/req/address";
const DATA = "https://api.vworld.kr/req/data";
const FLOOR_M = 2.9, GROUND_M = 1.5, CONTEXT_M = 288, ROAD_M = 150;  // (the server: realestate_buildings.py)

let seq = 0;
function jsonp(url: string, params: Record<string, string | number>, timeoutMs = 6000): Promise<any> {
  return new Promise((resolve, reject) => {
    const name = `__vw${Date.now().toString(36)}${seq++}`;
    const script = document.createElement("script");
    const w = window as unknown as Record<string, unknown>;
    const done = () => { window.clearTimeout(timer); delete w[name]; script.remove(); };
    const timer = window.setTimeout(() => { done(); reject(new Error("VWorld 응답 시간 초과")); }, timeoutMs);
    w[name] = (body: unknown) => { done(); resolve(body); };
    script.onerror = () => { done(); reject(new Error("VWorld 연결 실패")); };
    const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), format: "json", callback: name });
    // The key is checked against the `domain` parameter; a Referer that doesn't match
    // the registered domain (a dev host, a preview) is refused by some VWorld nodes
    // (0/15 with it, 15/15 without, measured).
    script.referrerPolicy = "no-referrer";
    script.src = `${url}?${q}`;
    document.head.appendChild(script);
  });
}

// VWorld's data nodes can still answer a valid key with "인증키 정보가 올바르지
// 않습니다" now and then. A retry lands on another node after a short pause; without
// it the viewer fell back to OpenStreetMap, which takes 8-50 s.
async function call(url: string, params: Record<string, string | number>) {
  let last: Error | null = null, down = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    // Rejections come in bursts of ~150 ms: back off 0, 80, 160 … ms (≈2.2 s at most).
    if (attempt) await new Promise(r => window.setTimeout(r, attempt * 80));
    let body: any;
    try { body = (await jsonp(url, params, attempt ? 3000 : 5000))?.response ?? {}; }
    catch (err) { last = err as Error; if (++down >= 2) break; continue; }
    if (body.status === "NOT_FOUND") return {};
    if (body.status === "OK") return body.result ?? {};
    last = new Error(`VWorld: ${body.error?.text ?? body.status}`);
    if (body.error?.code !== "INVALID_KEY" && !/인증키/.test(body.error?.text ?? "")) break;
  }
  throw last ?? new Error("VWorld 응답 없음");
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

/** Major roads only: 8 m or wider, or two lanes and more (alleys and paths are 3 m). */
function parseRoads(list: Feature[], project: (p: number[]) => [number, number]): RealEstateRoad[] {
  const roads: RealEstateRoad[] = [];
  for (const f of list) {
    const width = num(f.properties.rvwd) ?? 0, lanes = Math.round(num(f.properties.rdln) ?? 0);
    if (width < 8 && lanes < 2) continue;
    const lines = f.geometry?.type === "LineString" ? [f.geometry.coordinates] : f.geometry?.type === "MultiLineString" ? f.geometry.coordinates : [];
    for (const l of lines as number[][][]) if (l.length > 1) roads.push({ line: l.map(project), width: Math.min(60, width || lanes * 3.3), lanes: Math.max(1, lanes) });
  }
  return roads;
}

/** Major roads for a result that came without them (kept by the server, or from
 * OpenStreetMap): the same 국가기본도 도로중심선 query around the result's centre,
 * in its own metre frame (x east, y north from `center`). */
export async function vworldRoads(data: RealEstateBuildingsResponse, key: string, domain = "https://kospimap.com"): Promise<RealEstateRoad[]> {
  if (!data.center) return [];
  const { lat, lon } = data.center;
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320, ky = 110_540;
  const pts = [...data.site.flat(), ...data.buildings.flatMap(b => b.rings[0])];
  if (!pts.length) return [];
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const box = `BOX(${lon + (Math.min(...xs) - ROAD_M) / kx},${lat + (Math.min(...ys) - ROAD_M) / ky},${lon + (Math.max(...xs) + ROAD_M) / kx},${lat + (Math.max(...ys) + ROAD_M) / ky})`;
  const result = await call(DATA, { service: "data", request: "GetFeature", crs: "EPSG:4326", geometry: "true", attribute: "true",
    key, domain, data: "LT_L_N3A0020000", geomFilter: box, size: 1000, page: 1 });
  const project = ([x, y]: number[]): [number, number] => [Math.round((x - lon) * kx * 100) / 100, Math.round((y - lat) * ky * 100) / 100];
  return parseRoads(features(result), project);
}

/** Every 연속지적도 parcel around a result (the neighbourhood's radius), with its 지목 —
 * the last character of the 지번 (대 대지, 도 도로, 공 공원, 학 학교용지, 천 하천, 임 임야,
 * 전 밭, 답 논, 주 주차장, 체 체육용지, 종 종교용지, 구 구거, 유 유지, 잡 잡종지 …). Pages of
 * 1000 in parallel; about 1 MB per page, so this runs after the first frame. */
export async function vworldParcels(data: RealEstateBuildingsResponse, key: string, domain = "https://kospimap.com"): Promise<{ parcels: RealEstateParcel[]; streets: [number, number][][] }> {
  if (!data.center) return { parcels: [], streets: [] };
  const { lat, lon } = data.center;
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320, ky = 110_540;
  const pts = [...data.site.flat(), ...data.buildings.flatMap(b => b.rings[0])];
  if (!pts.length) return { parcels: [], streets: [] };
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), pad = CONTEXT_M + 30;
  const box = `BOX(${lon + (Math.min(...xs) - pad) / kx},${lat + (Math.min(...ys) - pad) / ky},${lon + (Math.max(...xs) + pad) / kx},${lat + (Math.max(...ys) + pad) / ky})`;
  const page = (n: number) => call(DATA, { service: "data", request: "GetFeature", crs: "EPSG:4326", geometry: "true", attribute: "true",
    key, domain, data: "LP_PA_CBND_BUBUN", geomFilter: box, size: 1000, page: n }).then(features).catch(() => [] as Feature[]);
  // 도로명주소 도로 (all named roads, alleys too) alongside.
  const streetFs = call(DATA, { service: "data", request: "GetFeature", crs: "EPSG:4326", geometry: "true", attribute: "false",
    key, domain, data: "LT_L_SPRD", geomFilter: box, size: 1000, page: 1 }).then(features).catch(() => [] as Feature[]);
  // Page on only while pages come back full (a page past the end repeats the first).
  const all = await page(1);
  for (let n = 2; n <= 6 && all.length >= (n - 1) * 1000; n++) all.push(...await page(n));
  const seen = new Set<string>();
  const unique = all.filter(f => { const k = f.properties.pnu ?? JSON.stringify(f.geometry?.coordinates ?? "").slice(0, 80); if (seen.has(k)) return false; seen.add(k); return true; });
  const project = ([x, y]: number[]): [number, number] => [Math.round((x - lon) * kx * 100) / 100, Math.round((y - lat) * ky * 100) / 100];
  const out: RealEstateParcel[] = [];
  for (const f of unique) {
    const kind = (f.properties.jibun ?? "").trim().slice(-1);
    for (const poly of polygons(f.geometry)) {
      const ring = clean(poly[0].map(project));
      if (ring) out.push({ ring, kind });
    }
  }
  const streets: [number, number][][] = [];
  for (const f of await streetFs) {
    const g = f.geometry;
    const lines = g?.type === "LineString" ? [g.coordinates] : g?.type === "MultiLineString" ? g.coordinates : [];
    for (const l of lines as number[][][]) if (l.length > 1) streets.push(l.map(project));
  }
  return { parcels: out, streets };
}

// The last few complexes (a full response is a few MB: every neighbour's footprint).
const memo = new Map<string, RealEstateBuildingsResponse | null>();
const remember = (id: string, value: RealEstateBuildingsResponse | null) => {
  memo.delete(id);
  memo.set(id, value);
  if (memo.size > 8) memo.delete(memo.keys().next().value!);
};

export async function vworldBuildings(
  id: string, query: { parcel: string | null; name: string }, key: string,
  // The key is bound to the domain registered with VWorld, sent as `domain`.
  domain = "https://kospimap.com",
): Promise<RealEstateBuildingsResponse | null> {
  if (memo.has(id)) return memo.get(id)!;
  if (!query.parcel) return null;
  const point = (await call(ADDRESS, { service: "address", request: "getcoord", version: "2.0", crs: "epsg:4326",
    address: query.parcel, refine: "true", simple: "false", type: "parcel", key, domain })).point;
  if (!point) { remember(id, null); return null; }
  const lon = +point.x, lat = +point.y;
  prefetchTerrain({ lat, lon }, 700, key);
  const common = { service: "data", request: "GetFeature", crs: "EPSG:4326", geometry: "true", attribute: "true", key, domain };
  const parcel = features(await call(DATA, { ...common, data: "LP_PA_CBND_BUBUN", geomFilter: `POINT(${lon} ${lat})`, size: 10 }))[0];
  if (!parcel) { remember(id, null); return null; }
  const rings = polygons(parcel.geometry).map(p => p[0] as unknown as Ring);
  const lons = rings.flat().map(p => p[0]), lats = rings.flat().map(p => p[1]);
  const padLon = CONTEXT_M / (111_320 * Math.cos((lat * Math.PI) / 180)), padLat = CONTEXT_M / 110_540;
  const box = `BOX(${Math.min(...lons) - padLon},${Math.min(...lats) - padLat},${Math.max(...lons) + padLon},${Math.max(...lats) + padLat})`;
  // The parcel's own box (every page: the complex must be whole) and the padded
  // neighbourhood (every page too: each registered neighbour in the radius is drawn),
  // in parallel — each JSONP call is ~1 MB of uncompressed GeoJSON, the slow part.
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
  // Major roads around the parcel: 국가기본도 도로중심선 with surveyed width and lanes.
  const rLon = ROAD_M / (111_320 * Math.cos((lat * Math.PI) / 180)), rLat = ROAD_M / 110_540;
  const roadBox = `BOX(${Math.min(...lons) - rLon},${Math.min(...lats) - rLat},${Math.max(...lons) + rLon},${Math.max(...lats) + rLat})`;
  const roadFs = call(DATA, { ...common, data: "LT_L_N3A0020000", geomFilter: roadBox, size: 1000, page: 1 }).then(features).catch(() => [] as Feature[]);
  const around1 = (async () => {
    // Pages 1 and 2 together (dense city blocks fill a page), then more only if needed.
    const [p1, p2] = await Promise.all([fetchBox(box, 1).catch(() => [] as Feature[]), fetchBox(box, 2).catch(() => [] as Feature[])]);
    const all = [...p1, ...p2];
    for (let page = 3, last = p2; page <= 5 && last.length >= 1000; page++) { last = await fetchBox(box, page).catch(() => []); all.push(...last); }
    return all;
  })();
  const [mineFs, padFs, roadList] = await Promise.all([own, around1, roadFs]);
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
        title: (p.bld_nm || "").trim() || null,
        approved: /^(19|20)\d{2}/.test(p.useapr_day || "") ? +p.useapr_day.slice(0, 4) : null,
      };
      if (!height && !floors) b.height_source = "estimated";
      (mine ? buildings : context).push(b);
    }
  }
  if (!buildings.length) { remember(id, null); return null; }
  fillHeights(buildings);
  fillHeights(context);
  const near = (b: RealEstateBuilding) => Math.hypot(...centroid(b.rings[0]));
  // Every registered building, down to low annexes (2.5 m); only sheds below that go.
  const nearby = context.filter(b => b.height >= 2.5).sort((a, b) => near(a) - near(b)).slice(0, 3000);
  const site = rings.map(r => clean(r.map(project))).filter((r): r is Ring => !!r);
  const roads = parseRoads(roadList, project);
  const measured = buildings.filter(b => b.height_source !== "estimated").length;
  const out: RealEstateBuildingsResponse = {
    id, name: query.name, address: query.parcel, built: null, found: true, source: "vworld",
    attribution: "국토교통부 GIS건물통합정보 · 연속지적도 (브이월드)", center: { lat, lon },
    site, buildings, context: nearby, roads, coverage: { buildings: buildings.length, with_height: measured },
    vworld: true, error: null, fetched_at: new Date().toISOString(),
  };
  remember(id, out);
  return out;
}

/** Registered buildings on the complex's parcel that predate it: the houses its site was
 * cleared of. The national building data keeps them until they are deregistered, so a
 * rebuilt complex showed hundreds of one- and two-storey houses between its towers.
 * Gone: approved more than 3 years before the complex was completed, and detached
 * houses (용도 01000) under 5 storeys (an apartment site has none). Only
 * while the complex's own towers remain: where the data still holds just the old
 * buildings (not yet updated), they are all that can be shown. */
export function withoutDemolished(data: RealEstateBuildingsResponse): RealEstateBuildingsResponse {
  if (!data.found || !data.buildings?.length) return data;
  const built = data.built;
  const gone = (b: RealEstateBuilding) => (!!built && !!b.approved && b.approved < built - 3)
    || (b.floors < 5 && b.use === "01000");
  const keep = data.buildings.filter(b => !gone(b));
  if (keep.length === data.buildings.length || !keep.some(b => b.floors >= 10)) return data;
  return { ...data, buildings: keep, coverage: { ...data.coverage, buildings: keep.length, with_height: keep.filter(b => b.height_source !== "estimated").length } };
}

