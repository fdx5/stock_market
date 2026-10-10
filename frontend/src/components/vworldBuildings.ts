import { RealEstateBuilding, RealEstateBuildingsResponse, RealEstateNearbyParcel, RealEstateParcel, RealEstateRoad } from "../api/client";
import { prefetchTerrain } from "./sceneTerrain";
import {hasAboveGroundEvidence} from './buildingEvidence';
import {attachRoadStructures,clipRoadContextRing,clipRoadLine,type RoadStructureLink} from './roadLevels';

/* A complex's buildings straight from VWorld (국토교통부 GIS건물통합정보), in the
 * browser. VWorld answers Korean networks only, so the server abroad can't ask it;
 * a reader in Korea can. It sends no CORS headers but supports JSONP. The logic
 * mirrors backend app/services/realestate_buildings.py (_from_vworld, _fill_heights):
 * keep the two in step. */

const ADDRESS = "https://api.vworld.kr/req/address";
const DATA = "https://api.vworld.kr/req/data";
const FLOOR_M = 2.9, GROUND_M = 1.5, CONTEXT_M = 288, ROAD_M = 150;  // (the server: realestate_buildings.py)

let seq = 0;
let jsonpActive = 0;
const jsonpWaiting: (() => void)[] = [];
async function jsonp(url: string, params: Record<string, string | number>, timeoutMs = 6000): Promise<any> {
  await new Promise<void>(resolve => {
    if (jsonpActive < 4) { jsonpActive++; resolve(); }
    else jsonpWaiting.push(resolve);
  });
  try { return await jsonpNow(url, params, timeoutMs); }
  finally {
    const next = jsonpWaiting.shift();
    if (next) next(); else jsonpActive--;
  }
}
function jsonpNow(url: string, params: Record<string, string | number>, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const name = `__vw${Date.now().toString(36)}${seq++}`;
    const script = document.createElement("script");
    const w = window as unknown as Record<string, unknown>;
    const done = (late = false) => {
      window.clearTimeout(timer); script.remove();
      if (late) {
        // Removing a script does not reliably cancel an already received JSONP
        // response. A late callback must not become an uncaught ReferenceError.
        w[name] = () => {};
        window.setTimeout(() => { delete w[name]; }, 600000);
      } else delete w[name];
    };
    const timer = window.setTimeout(() => { done(true); reject(new Error("VWorld 응답 시간 초과")); }, timeoutMs);
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
const calls=new Map<string,{at:number;value:Promise<any>}>();
function call(url:string,params:Record<string,string|number>) {
  const key=url+JSON.stringify(params),old=calls.get(key);
  if(old && Date.now()-old.at<300000)return old.value;
  const value=loadCall(url,params);calls.delete(key);calls.set(key,{at:Date.now(),value});
  if(calls.size>24)calls.delete(calls.keys().next().value!);
  void value.catch(()=>{if(calls.get(key)?.value===value)calls.delete(key);});
  return value;
}
async function loadCall(url: string, params: Record<string, string | number>) {
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
type Feature = { id?:string; properties: Record<string, string>; geometry: { type: string; coordinates: any } };

const features = (r: any): Feature[] => r?.featureCollection?.features ?? [];
/** Pages asked for at once: past the last one VWorld answers with a page already given (the
 * roads round a complex came four times over — 1,800 for 450, every one overlapping itself), so
 * a feature is kept once, by its geometry. */
const unique = (fs: Feature[]) => {
  const seen = new Set<string>();
  return fs.filter(f => { const k = JSON.stringify(f.geometry?.coordinates ?? null) + (f.properties?.bld_nm ?? ""); if (seen.has(k)) return false; seen.add(k); return true; });
};
// Pages asked four at a time (one after another, a 600 m square of buildings was seven round
// trips — ~1.5 s before the view's first frame); taken in order with the same stop as before (a
// short page, or nothing new), pages past the last discarded, a failed page only fatal when needed.
async function pagedFeatures(page:(n:number)=>Promise<Feature[]>):Promise<Feature[]> {
  let all:Feature[]=[];
  for(let n=1;n<=24;n+=4){
    const batch=await Promise.allSettled([0,1,2,3].filter(k=>n+k<=24).map(k=>page(n+k)));
    for(const r of batch){
      if(r.status==='rejected')throw r.reason;
      const next=r.value,merged=unique([...all,...next]);
      if(merged.length===all.length||next.length<1000)return merged;
      all=merged;
    }
  }
  throw new Error('VWorld feature coverage exceeded 24 pages');
}
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

export function physicalBuildingFootprints(list: Feature[], project: (p: number[]) => [number,number]): Ring[] {
  return unique(list).flatMap(f => {
    const p=f.properties;
    if(!hasAboveGroundEvidence(p))return [];
    return polygons(f.geometry).flatMap(poly=>{const r=clean(poly[0].map(project));return r?[r]:[];});
  });
}

/** Buildings must cover the same square as roads, including structures outside
 * the selected parcel and the near context loaded for the first frame. */
export async function vworldRoadFootprints(data:RealEstateBuildingsResponse,key:string,domain="https://kospimap.com",radius=600):Promise<Ring[]> {
  if(!data.center)return [];
  const {lat,lon}=data.center,kx=Math.cos(lat*Math.PI/180)*111320,ky=110540,R=radius+80;
  const box=`BOX(${lon-R/kx},${lat-R/ky},${lon+R/kx},${lat+R/ky})`;
  const page=async(n:number)=>features(await call(DATA,{service:'data',request:'GetFeature',crs:'EPSG:4326',geometry:'true',attribute:'true',key,domain,data:'LT_C_BLDGINFO',geomFilter:box,size:1000,page:n}));
  const all=await pagedFeatures(page);
  return physicalBuildingFootprints(all,([x,y])=>[Math.round((x-lon)*kx*100)/100,Math.round((y-lat)*ky*100)/100]);
}

export function parseRoads(list: Feature[], project: (p: number[]) => [number, number]): RealEstateRoad[] {
  const roads: RealEstateRoad[] = [];
  for (const f of unique(list)) {
    const width = num(f.properties.rvwd) ?? 0, lanes = Math.round(num(f.properties.rdln) ?? 0);
    // Keep registered single-lane ramps and connecting roads as well as main roads.
    if (width < 4 && lanes < 1) continue;
    const lines = f.geometry?.type === "LineString" ? [f.geometry.coordinates] : f.geometry?.type === "MultiLineString" ? f.geometry.coordinates : [];
    for (const [part,l] of (lines as number[][][]).entries()) if (l.length > 1) {
      const id=f.id??f.properties.ufid;
      roads.push({ id:id?`${id}:${part}`:undefined,source:'VWorld LT_L_N3A0020000',line: l.map(project), width: Math.min(60, width || lanes * 3.3), lanes: Math.max(1, lanes) });
    }
  }
  return roads;
}

/** Official transport structure attributes and river boundaries, in the same centre/CRS
 * as the national road survey. A failed/partial request never claims complete coverage. */
/** The structure links and river boundaries in a box, asked once (kept a few boxes): the view
 * starts them with the roads themselves (prefetchRoadContext) — they don't need the roads, and
 * asked after them they were a further round of pages before the first frame. */
const contextAsks=new Map<string,Promise<[PromiseSettledResult<Feature[]>,PromiseSettledResult<Feature[]>]>>();
function roadContextAsk(box:string,key:string,domain='https://kospimap.com'){
 let hit=contextAsks.get(box);
 if(!hit){
  const ask=(layer:string)=>pagedFeatures(async page=>features(await call(DATA,{service:'data',request:'GetFeature',crs:'EPSG:4326',geometry:'true',attribute:'true',key,domain,data:layer,geomFilter:box,size:1000,page})));
  hit=Promise.allSettled([ask('LT_L_MOCTLINK'),ask('LT_C_WKMSTRM')]) as Promise<[PromiseSettledResult<Feature[]>,PromiseSettledResult<Feature[]>]>;
  contextAsks.set(box,hit);
  if(contextAsks.size>4)contextAsks.delete(contextAsks.keys().next().value!);
 }
 return hit;
}
export function prefetchRoadContext(data:RealEstateBuildingsResponse,radius=600){
 if(!data.center||!data.vworld_key)return;
 const {lat,lon}=data.center,kx=Math.cos(lat*Math.PI/180)*111320,ky=110540;
 void roadContextAsk(`BOX(${lon-(radius+80)/kx},${lat-(radius+80)/ky},${lon+(radius+80)/kx},${lat+(radius+80)/ky})`,data.vworld_key,data.vworld_domain).catch(()=>{});
}
export async function vworldRoadContext(data:RealEstateBuildingsResponse,roads:RealEstateRoad[],radius=600):Promise<RealEstateBuildingsResponse>{
 if(!data.center||!data.vworld_key)return {...data,roads};
 const {lat,lon}=data.center,kx=Math.cos(lat*Math.PI/180)*111320,ky=110540;
 const project=([x,y]:number[]):[number,number]=>[(x-lon)*kx,(y-lat)*ky];
 const box=`BOX(${lon-(radius+80)/kx},${lat-(radius+80)/ky},${lon+(radius+80)/kx},${lat+(radius+80)/ky})`;
 const [linkResult,riverResult]=await roadContextAsk(box,data.vworld_key,data.vworld_domain);
 const links:RoadStructureLink[]=[];
 if(linkResult.status==='fulfilled')for(const f of linkResult.value){
  const type=f.properties.rd_type_h;
  const structure:RoadStructureLink['structure']=type==='교량'?'bridge':type==='고가도로'?'elevated':type==='지하차도'?'underpass':type==='터널'?'tunnel':type==='일반도로'?'ground':'unknown';
  const lines=f.geometry?.type==='LineString'?[f.geometry.coordinates]:f.geometry?.type==='MultiLineString'?f.geometry.coordinates:[];
  for(const l of lines)if(l.length>1)links.push({id:f.properties.link_id??f.id??'',line:l.map(project),structure});
 }
 const rivers=riverResult.status==='fulfilled'?riverResult.value.flatMap(f=>polygons(f.geometry).flatMap(poly=>{
  const outer=clipRoadContextRing(poly[0].map(project),radius+50);if(outer.length<3)return [];
  return [{id:f.id??'',name:f.properties.riv_nm??'',rings:[outer,...poly.slice(1).map(r=>clipRoadContextRing(r.map(project),radius+50)).filter(r=>r.length>=3)]}];
 })):[];
 const enriched=links.length?attachRoadStructures(roads,links):roads.map(r=>r.structure_source?r:{...r,structure:'unknown' as const}),matched=enriched.filter(r=>r.structure_source&&r.structure!=='unknown').length;
 return {...data,roads:enriched,road_context:{source:'VWorld LT_L_MOCTLINK · LT_C_WKMSTRM',fetched_at:new Date().toISOString(),coverage:linkResult.status==='fulfilled'&&riverResult.status==='fulfilled'&&matched===enriched.length?'complete':'partial',links:links.length,matched,total:enriched.length,rivers}};
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

/** The surveyed roads (국가기본도 도로중심선) of the whole neighbourhood drawn round a result —
 * `radius` m about its centre (the 3D view's 600 m), not only the parcel's 150 m: the traffic,
 * signals, kerbs and lamps reach as far as the buildings. Pages of 1000 in parallel. */
export async function vworldRoadsAround(data: RealEstateBuildingsResponse, key: string, domain = "https://kospimap.com", radius = 600): Promise<RealEstateRoad[]> {
  if (!data.center) return [];
  const { lat, lon } = data.center;
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320, ky = 110_540;
  const box = `BOX(${lon - radius / kx},${lat - radius / ky},${lon + radius / kx},${lat + radius / ky})`;
  const page = (n: number) => call(DATA, { service: "data", request: "GetFeature", crs: "EPSG:4326", geometry: "true", attribute: "true",
    key, domain, data: "LT_L_N3A0020000", geomFilter: box, size: 1000, page: n }).then(features).catch(() => [] as Feature[]);
  const all = await pagedFeatures(page);
  const project = ([x, y]: number[]): [number, number] => [Math.round((x - lon) * kx * 100) / 100, Math.round((y - lat) * ky * 100) / 100];
  // (a road the box catches runs on for kilometres: cut to the drawn square, a little past it)
  return parseRoads(all,project).flatMap(r=>clipRoadLine(r.line,radius+50).map((line,part)=>({...r,line,id:r.id?`${r.id}:clip${part}`:undefined})));
}

/** The registered names (건물명), 주용도 and storeys of the buildings round a result, for
 * results kept before names were (the hover labels): centroids in the result's metres.
 * Pages of 1000 in parallel; runs after the first frame. */
export async function vworldBuildingNames(data: RealEstateBuildingsResponse, key: string, domain = "https://kospimap.com", radius = 450): Promise<{ x: number; y: number; title: string; use: string | null; floors: number; dong: string | null }[]> {
  if (!data.center) return [];
  const { lat, lon } = data.center;
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320, ky = 110_540;
  const box = `BOX(${lon - radius / kx},${lat - radius / ky},${lon + radius / kx},${lat + radius / ky})`;
  const page = (n: number) => call(DATA, { service: "data", request: "GetFeature", crs: "EPSG:4326", geometry: "true", attribute: "true",
    key, domain, data: "LT_C_BLDGINFO", geomFilter: box, size: 1000, page: n }).then(features).catch(() => [] as Feature[]);
  const all = unique((await Promise.all([1, 2, 3].map(page))).flat());
  const out: { x: number; y: number; title: string; use: string | null; floors: number; dong: string | null }[] = [];
  for (const f of all) {
    const p = f.properties, title = String(p.bld_nm || "").trim();
    if (!title) continue;
    const poly = polygons(f.geometry)[0];
    if (!poly) continue;
    const [cx, cy] = centroid(poly[0] as unknown as Ring);
    out.push({ x: (cx - lon) * kx, y: (cy - lat) * ky, title, use: p.usability || null, floors: Math.round(num(p.grnd_flr) ?? 0), dong: String(p.dong_nm || "").trim() || null });
  }
  return out;
}

/** The 공동주택 (주용도 02000, five storeys and up) within `radius` of a result, grouped by
 * the 연속지적도 parcel each stands on — what the server matches to the complexes in the
 * trades (their 지번), for the 주변 단지 selector. A parcel is asked for at a building's
 * centroid only when no parcel already read holds it (a complex's towers mostly share
 * one lot), six at a time, nearest first. */
export async function vworldNearbyParcels(data: RealEstateBuildingsResponse, key: string, domain = "https://kospimap.com", radius = 500): Promise<RealEstateNearbyParcel[]> {
  if (!data.center) return [];
  const { lat, lon } = data.center;
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320, ky = 110_540;
  const box = `BOX(${lon - radius / kx},${lat - radius / ky},${lon + radius / kx},${lat + radius / ky})`;
  const common = { service: "data", request: "GetFeature", crs: "EPSG:4326", geometry: "true", attribute: "true", key, domain };
  const page = (n: number) => call(DATA, { ...common, data: "LT_C_BLDGINFO", geomFilter: box, attrFilter: "usability:=:02000", size: 1000, page: n }).then(features);
  const first = await page(1);
  const all = first.length >= 1000 ? [...first, ...(await page(2).catch(() => []))] : first;
  const towers = all.flatMap(f => {
    const p = f.properties, floors = Math.round(num(p.grnd_flr) ?? 0), poly = polygons(f.geometry)[0];
    if (floors < 5 || !poly) return [];
    const [cx, cy] = centroid(poly[0] as unknown as Ring);
    return [{ lonlat: [cx, cy] as [number, number], x: Math.round((cx - lon) * kx * 10) / 10, y: Math.round((cy - lat) * ky * 10) / 10,
      name: String(p.bld_nm || "").trim(), dong: String(p.dong_nm || "").trim(), floors }];
  }).sort((a, b) => a.x * a.x + a.y * a.y - b.x * b.x - b.y * b.y).slice(0, 96);
  const parcels: (RealEstateNearbyParcel & { rings: Ring[] })[] = [];
  const holder = (pt: [number, number]) => parcels.find(p => p.rings.some(r => inside(pt, r)));
  const waiting = [...towers];
  const worker = async () => {
    for (let t = waiting.shift(); t; t = waiting.shift()) {
      let lot = holder(t.lonlat);
      if (!lot) {
        const f = features(await call(DATA, { ...common, data: "LP_PA_CBND_BUBUN", geomFilter: `POINT(${t.lonlat[0]} ${t.lonlat[1]})`, size: 1 }).catch(() => null))[0];
        const pnu = String(f?.properties.pnu ?? "");
        if (!f || !pnu) continue;
        // (another worker may have read the same lot meanwhile)
        lot = parcels.find(p => p.pnu === pnu);
        if (!lot) {
          lot = { pnu, addr: String(f.properties.addr ?? ""), buildings: [], rings: polygons(f.geometry).map(p => p[0] as unknown as Ring) };
          parcels.push(lot);
        }
      }
      lot.buildings.push({ x: t.x, y: t.y, name: t.name, dong: t.dong, floors: t.floors });
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return parcels.map(({ rings: _rings, ...p }) => p);
}

/** Every 연속지적도 parcel around a result (the neighbourhood's radius), with its 지목 —
 * the last character of the 지번 (대 대지, 도 도로, 공 공원, 학 학교용지, 천 하천, 임 임야,
 * 전 밭, 답 논, 주 주차장, 체 체육용지, 종 종교용지, 구 구거, 유 유지, 잡 잡종지 …). Pages of
 * 1000 in parallel; about 1 MB per page, so this runs after the first frame. */
/** The square the parcels are read for (footprint metres, [x0, y0, x1, y1]): the complex and
 * its context; its land use is painted out to here (the 1 km picture takes over past it). */
export function parcelBox(data: RealEstateBuildingsResponse): [number, number, number, number] | null {
  const pts = [...data.site.flat(), ...data.buildings.flatMap(b => b.rings[0])];
  if (!pts.length) return null;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), pad = CONTEXT_M + 30;
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

// Single-flight cadastral data can download while roads and buildings are prepared.
const parcelJobs=new Map<string,{at:number;job:ReturnType<typeof fetchParcels>}>();
export function vworldParcels(data:RealEstateBuildingsResponse,key:string,domain="https://kospimap.com"){
 const box=parcelBox(data),id=JSON.stringify([data.center,box,key,domain]);
 const cached=parcelJobs.get(id);if(cached&&Date.now()-cached.at<300000)return cached.job;
 const job=fetchParcels(data,key,domain);parcelJobs.set(id,{at:Date.now(),job});
 job.then(r=>{if(!r.parcels.length)parcelJobs.delete(id);},()=>parcelJobs.delete(id));
 if(parcelJobs.size>8)parcelJobs.delete(parcelJobs.keys().next().value!);
 return job;
}

async function fetchParcels(data: RealEstateBuildingsResponse, key: string, domain = "https://kospimap.com"): Promise<{ parcels: RealEstateParcel[]; streets: [number, number][][] }> {
  if (!data.center) return { parcels: [], streets: [] };
  const { lat, lon } = data.center;
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320, ky = 110_540;
  const pts = [...data.site.flat(), ...data.buildings.flatMap(b => b.rings[0])];
  if (!pts.length) return { parcels: [], streets: [] };
  const [x0, y0, x1, y1] = parcelBox(data)!;
  const box = `BOX(${lon + x0 / kx},${lat + y0 / ky},${lon + x1 / kx},${lat + y1 / ky})`;
  const page = (n: number) => call(DATA, { service: "data", request: "GetFeature", crs: "EPSG:4326", geometry: "true", attribute: "true",
    key, domain, data: "LP_PA_CBND_BUBUN", geomFilter: box, size: 1000, page: n }).then(features).catch(() => [] as Feature[]);
  // 도로명주소 도로 (all named roads, alleys too) alongside.
  const streetFs = call(DATA, { service: "data", request: "GetFeature", crs: "EPSG:4326", geometry: "true", attribute: "false",
    key, domain, data: "LT_L_SPRD", geomFilter: box, size: 1000, page: 1 }).then(features).catch(() => [] as Feature[]);
  // Page on only while pages come back full (a page past the end repeats the first).
  // (three pages at a time, taken in order while each came back full: one after another a
  // dense block's four pages were four round trips before its land use could be painted)
  const all: Feature[] = [];
  for (let n = 1, full = true; n <= 6 && full; n += 3) {
    const batch = await Promise.all([n, n + 1, n + 2].filter(k => k <= 6).map(page));
    for (const fs of batch) { if (!full) break; all.push(...fs); full = fs.length >= 1000; }
  }
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
    if(!hasAboveGroundEvidence(p))continue;
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
  if (!keep.some(b => b.floors >= 10)) return data;
  const context = (data.context ?? []).filter(b => !gone(b) || !data.site.some(r => inside(centroid(b.rings[0]), r)));
  // Recompute this even for an already-clean cached result: later workers fetch raw
  // registry data again and cannot infer the cleared parcel from kept centroids.
  if (keep.length === data.buildings.length && context.length === (data.context ?? []).length && !data.site.length) return data;
  return { ...data, buildings: keep, context, cleared_site: data.site.length ? { built, rings: data.site } : undefined,
    coverage: { ...data.coverage, buildings: keep.length, with_height: keep.filter(b => b.height_source !== "estimated").length } };
}

/** Records of the national building data that aren't buildings as drawn. VWorld's
 * GIS건물통합정보 also holds footprints not linked to the building register (no 용도, no
 * 사용승인일) that carry only the complex's name and its storey count: slivers of a few m²
 * (ramp mouths, vents, pieces of the deck) drawn as 18-storey needles between the towers, and
 * second copies of the register's own buildings (a 동 drawn twice, one inside the other).
 * Gone: an unlinked record on a register-linked one (either's middle inside the other), and
 * an unlinked one of 8 storeys or more too slender for them (under 10 m² a storey + 40 m²); any record of
 * 5 storeys or more on under 25 m². A measured height far over its storeys (404 m for one
 * storey) is the storeys' height instead. */
export function withoutStrays(data: RealEstateBuildingsResponse): RealEstateBuildingsResponse {
  if (!data.found || !data.buildings?.length) return data;
  const linked = (b: RealEstateBuilding) => !!b.use || !!b.approved;
  const all = [...data.buildings, ...(data.context ?? [])];
  const reg = all.filter(linked).map(b => ({ ring: b.rings[0], c: centroid(b.rings[0]) }));
  // (the linked ones by 60 m cell: each record looks only at its neighbourhood — against all
  // of them, a thousand-building neighbourhood took ~10 ms of the load)
  const cellOf = (x: number, y: number) => Math.floor(x / 60) * 100003 + Math.floor(y / 60);
  const regAt = new Map<number, typeof reg>();
  for (const r of reg) { const k = cellOf(r.c[0], r.c[1]); const l = regAt.get(k); if (l) l.push(r); else regAt.set(k, [r]); }
  const near = (c: [number, number]) => {
    const out: typeof reg = [], i0 = Math.floor(c[0] / 60), j0 = Math.floor(c[1] / 60);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const l = regAt.get((i0 + i) * 100003 + j0 + j); if (l) out.push(...l); }
    return out;
  };
  let dropped = 0, fixed = 0;
  const keep = (b: RealEstateBuilding) => {
    const ring = b.rings[0], a = Math.abs(area(ring));
    const stray = (b.floors >= 5 && a < 25)
      || (!linked(b) && b.floors >= 8 && a < 10 * b.floors + 40)
      || (!linked(b) && (() => { const c = centroid(ring); return near(c).some(r => inside(c, r.ring) || inside(r.c, ring)); })());
    if (stray) dropped++;
    return !stray;
  };
  const sane = (b: RealEstateBuilding) => {
    if (b.height_source !== "measured" || !b.floors || b.height <= b.floors * 4.5 + 12) return b;
    fixed++;
    return { ...b, height: Math.round((b.floors * FLOOR_M + GROUND_M) * 10) / 10, height_source: "floors" as const };
  };
  const buildings = data.buildings.filter(keep).map(sane);
  const context = (data.context ?? []).filter(keep).map(sane);
  if (!dropped && !fixed) return data;
  // (never the complex's last tower: then the data is all there is)
  if (!buildings.some(b => b.floors >= 2)) return data;
  return { ...data, buildings, context, coverage: data.coverage && { ...data.coverage, buildings: buildings.length } };
}


/** The neighbourhood round any point, for a view centred there with no complex in it (driving
 * on past the complexes): every registered building within CONTEXT_M (the one nearest the point
 * standing as the view's own, its footprint its site), the major roads, the place's name from
 * VWorld's reverse geocoder. Null where VWorld has no building near. */
/** The parcel under a point (연속지적도): its PNU (the 건축물대장's key) and 지번 address. */
export async function vworldParcelAt(lat: number, lon: number, key: string, domain = "https://kospimap.com"): Promise<{ pnu: string; address: string | null } | null> {
  const list = await call(DATA, { service: "data", request: "GetFeature", crs: "EPSG:4326", geometry: "false", attribute: "true", key, domain,
    data: "LP_PA_CBND_BUBUN", geomFilter: `POINT(${lon.toFixed(7)} ${lat.toFixed(7)})`, size: 5 }).then(features).catch(() => [] as Feature[]);
  const p = list.find(f => /^\d{19}$/.test(String(f.properties?.pnu ?? "")))?.properties;
  return p ? { pnu: String(p.pnu), address: String(p.addr ?? "").trim() || null } : null;
}

export async function vworldPointArea(lat: number, lon: number, key: string, domain = "https://kospimap.com"): Promise<RealEstateBuildingsResponse | null> {
  const id = `pt:${lat.toFixed(5)},${lon.toFixed(5)}`;
  if (memo.has(id)) return memo.get(id)!;
  prefetchTerrain({ lat, lon }, 700, key);
  const common = { service: "data", request: "GetFeature", crs: "EPSG:4326", geometry: "true", attribute: "true", key, domain };
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320, ky = 110_540;
  const boxOf = (r: number) => `BOX(${lon - r / kx},${lat - r / ky},${lon + r / kx},${lat + r / ky})`;
  // (one page within 200 m: the drive is coming, and the 1 km ring fills the rest in once shown)
  const pagesJob = call(DATA, { ...common, data: "LT_C_BLDGINFO", geomFilter: boxOf(200), size: 1000, page: 1 }).then(features).then(unique).catch(() => [] as Feature[]);
  const roadJob = call(DATA, { ...common, data: "LT_L_N3A0020000", geomFilter: boxOf(ROAD_M + 150), size: 1000, page: 1 }).then(features).catch(() => [] as Feature[]);
  const nameJob = call(ADDRESS, { service: "address", request: "getAddress", version: "2.0", crs: "epsg:4326", point: `${lon},${lat}`, format: "json", type: "parcel", simple: "true", key, domain })
    .then((r: any) => { const s = r?.[0]?.structure; return [s?.level2, s?.level4L || s?.level4A].filter(Boolean).join(" ") || null; }).catch(() => null);
  const [all, roadList, place] = await Promise.all([pagesJob, roadJob, nameJob]);
  const project = ([x, y]: number[]): [number, number] => [Math.round((x - lon) * kx * 100) / 100, Math.round((y - lat) * ky * 100) / 100];
  const list: RealEstateBuilding[] = [];
  for (const f of all) {
    const p = f.properties;
    for (const poly of polygons(f.geometry)) {
      if(!hasAboveGroundEvidence(p))continue;
      const outer = clean(poly[0].map(project));
      if (!outer) continue;
      const holes = poly.slice(1).map(r => clean(r.map(project))).filter((h): h is Ring => !!h).map(h => h.reverse());
      const height = num(p.height), floors = num(p.grnd_flr);
      list.push({
        rings: [outer, ...holes], height: height ?? 0, floors: floors ? Math.round(floors) : 0, base: 0,
        height_source: height ? "measured" : floors ? "floors" : "estimated", name: (p.dong_nm || "").trim() || null, use: p.usability || null,
        title: (p.bld_nm || "").trim() || null,
        approved: /^(19|20)\d{2}/.test(p.useapr_day || "") ? +p.useapr_day.slice(0, 4) : null,
      });
    }
  }
  if (!list.length) { remember(id, null); return null; }
  fillHeights(list);
  const near = (b: RealEstateBuilding) => Math.hypot(...centroid(b.rings[0]));
  list.sort((a, b) => near(a) - near(b));
  // (the nearest building of two storeys or more stands as the view's own)
  const own = list.find(b => b.height >= 6) ?? list[0];
  const context = list.filter(b => b !== own && b.height >= 2.5).slice(0, 3000);
  const out: RealEstateBuildingsResponse = {
    id, name: place ?? own.title ?? "주변 지역", address: place ?? "", built: null, found: true, source: "vworld",
    attribution: "국토교통부 GIS건물통합정보 · 국가기본도 (브이월드)", center: { lat, lon },
    site: [own.rings[0]], buildings: [own], context, roads: parseRoads(roadList, project),
    coverage: { buildings: 1, with_height: own.height_source === "estimated" ? 0 : 1 },
    vworld: true, error: null, fetched_at: new Date().toISOString(), vworld_key: key, vworld_domain: domain,
  };
  remember(id, out);
  return out;
}
