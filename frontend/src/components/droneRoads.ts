import { sceneWorkerFresh } from "./sceneWorkerPool";
/* The drone's roads (드론 mode), tile by tile: the national road survey's centre lines (국가기본도
 * 도로중심선, VWorld LT_L_N3A0020000: width rvwd, lanes rdln) cut to the tile and laid on its
 * relief — an asphalt band the road's width, its lane lines (white dashes between lanes going the
 * same way, a double yellow centre line on a two-way road of two lanes or more), and the lanes
 * themselves as paths for the traffic (droneTraffic.ts): right-hand traffic, each lane its line
 * offset from the centre, in the direction it is driven.
 *
 * Structures from the standard node-link (표준노드링크, LT_L_MOCTLINK rd_type_h): a road along a
 * 교량 or 고가도로 link is a deck — along the full official link's bank-to-bank profile,
 * shared with the initial scene — with its slab, parapets and piers down to the ground every
 * ~30 m; along a 터널 or 지하차도 link nothing is drawn (it is underground) and nobody drives
 * there in sight. The lane lines come twice: true to size, and broad for a camera far off (a
 * 15 cm line is far under a pixel from 300 m; droneWorld shows one or the other by distance).
 *
 * VWorld answers only JSONP: all of it in a worker (importScripts), as the ring's buildings. One
 * self-contained function (a Blob worker): no imports inside. */

import {surfaceGeometryRules} from './surfaceGeometry';
import {roadApproachHeight} from './roadApproaches';
import {terrainSurfaceClearance} from './terrainSurfaceClearance';
import {linkFallbackRoads} from './roadLinkFallback';
import {chainDeckRoads} from './bridgeDecks';
import {groundRoadGrade} from './roadGroundGrade';
import {roadCorridorRules} from './roadCorridors';
import {tunnelPortal, portalNormals, tunnelPortal as tunnelPortalShape, portalNormals as portalNormalsOf} from './tunnelPortal';
import type {RealEstateRoad} from '../api/client';
type Arr = { position: Float32Array; normal: Float32Array; index: Uint32Array;level?:Float32Array };
export type RoadTileResult = {
  surface: Arr | null;
  /** lane paint, true to size and broad (for far off) */
  marks: (Arr & { color: Float32Array }) | null;
  marksFar: (Arr & { color: Float32Array }) | null;
  /** bridge decks' slabs, parapets and piers */
  structure: Arr | null;
  /** tunnels' mouths (터널 links): the portals' concrete, and the dark of their bores */
  portals: { concrete: Arr | null; dark: Arr | null };
  /** the live traffic layer's bands: triangles (6 vertices a quad), each vertex's link (an index
   * into ids), the links' standard IDs and road classes */
  traffic: { position: Float32Array; link: Uint16Array; ids: string[]; ranks: string[] } | null;
  /** sidewalks: raised paving and its kerb along the roads of 8 m and wider */
  walks: Arr | null;
  /** the sidewalks' middle lines, for the people: [n, x0, y0, x1, y1, …] one after another */
  walkPaths: Float32Array;
  /** street trees along the sidewalks, x, y and the road (one species a road), three each */
  streetTrees: Float32Array;
  /** the ground every road takes, kerb to kerb and its sidewalks, 1 m more: [n, half width, x0, y0,
   * x1, y1, …] one line after another — no tree of the land's planted on it */
  clear: Float32Array;
  /** the tile's grid heights cut to its roads (the ground mesh is made from them) */
  ground: Float32Array;
  /** the junctions' asphalt (where roads cross: filled, no lane lines through it) */
  junctions: Arr | null;
  /** lanes: [n, road width, x0, y0, z0, x1, y1, z1, …] one after another (view frame, z the road's height) */
  lanes: Float32Array;
  /** Confirmed physical bank junctions, x/y pairs in the shared view frame. */
  banks: Float32Array;
  /** per lane (in `lanes` order): [m, s, junction, phase, …] — the stop lines of signalled junctions it meets */
  stops: Float32Array; signals: number;
  roads: number; bridges: number; ms: number;
};
type Grid = { h: Float32Array; n: number; R: number; cell: number; ox: number; oy: number };
type RoadJob = {
  urls: string[]; linkUrls: string[]; riverUrls: string[]; lat: number; lon: number; box: [number, number, number, number];
  grid: Grid;
  footprints?:[number,number][][];
  /** the relief over ±1.4 km at 16 m: a long bridge's ends lie far past the tile */
  wide: Grid | null;
  /** the crossings OpenStreetMap maps round the tile (the site's /api/realestate/crossings): lines in
   * metres about the rounded point asked at, (ox, oy) that point in this frame */
  crossings?: { url: string; ox: number; oy: number };
  /** Confirmed tidal water and islands. Only official bridge links use bank support. */
  sea?: number[][][]; seaHoles?: number[][][]; seaLevel?: number;
  /** a landmark bridge's upper deck (광안대교: sceneLandmarks.gwanganDeck), its line and heights:
   * the roads along it are on it — its own model draws the structure */
  deck?: { pts: number[][]; z: number[] };
  /** whole bridges (bridgeChains.ts): each official bridge link's deck along its chain, bank to bank */
  /** build the live traffic layer's bands (off while that layer is hidden) */
  traffic?: boolean;
  chains?: { ids: string[]; line: number[][]; s: number[]; z: number[]; core?: [number,number]; deck?: { w: number; off: number; lanes: number; twoWay: boolean } }[];
};

function roadWorkerMain() {
  self.onmessage = async (e: MessageEvent<RoadJob>) => {
    try {
    const rules=(self as unknown as {__roadRules:ReturnType<typeof surfaceGeometryRules>}).__roadRules;
    const groundGrade=(self as unknown as {__groundGrade:ReturnType<typeof groundRoadGrade>}).__groundGrade;
    const t0 = performance.now();
    // The mapped crossings (the server fetches them from OpenStreetMap on a first ask: asked again
    // a little later while it answers with none and no source).
    type Crossing = { line: [number, number][]; signals: boolean; layer?: number };
    let crossings: Crossing[] = [];
    let crossPoints: { at: [number, number]; signals: boolean; marked: boolean }[] = [];
    // (the traffic signals OpenStreetMap maps: highway=traffic_signals nodes)
    let signalPts: [number, number][] = [];
    let mapped = false;
    // (never holding the tile up: two seconds at most — the drone world asked for them ahead, when
    // the tile was queued, so the server has them by now)
    if (e.data.crossings) {
      const got = await fetch(e.data.crossings.url, { signal: AbortSignal.timeout(2000) }).then(r => (r.ok ? r.json() : null)).catch(() => null) as { crossings?: Crossing[]; points?: typeof crossPoints; source?: string | null } | null;
      crossings = got?.crossings ?? [];
      crossPoints = got?.points ?? [];
      signalPts = ((got as { signals?: [number, number][] } | null)?.signals ?? []).filter(p => Array.isArray(p) && p.length >= 2);
      mapped = !!got?.source;
    }
    const cox = e.data.crossings?.ox ?? 0, coy = e.data.crossings?.oy ?? 0;
    const { lat, lon, box, grid: g, wide } = e.data;
    // The hashes below cover only the tile and 1.5 km round it (a long bridge's ends): a river's
    // whole channel or a link kilometres long, hashed cell by cell over its full extent, filled the
    // worker's memory by gigabytes by the Han river and killed the page.
    const SPAN = 1500, hx0 = box[0] - SPAN, hy0 = box[1] - SPAN, hx1 = box[2] + SPAN, hy1 = box[3] + SPAN;
    const cells = (x0: number, y0: number, x1: number, y1: number, size: number, f: (k: string) => void) => {
      const i0 = Math.floor(Math.max(x0, hx0) / size), i1 = Math.floor(Math.min(x1, hx1) / size);
      const j0 = Math.floor(Math.max(y0, hy0) / size), j1 = Math.floor(Math.min(y1, hy1) / size);
      if (!(i1 >= i0 && j1 >= j0)) return;
      for (let cx = i0; cx <= i1; cx++) for (let cy = j0; cy <= j1; cy++) f(cx + "," + cy);
    };
    const add = <T,>(m: Map<string, T[]>, k: string, v: T) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };
    const kx = Math.cos((lat * Math.PI) / 180) * 111320, ky = 110540;
    const sample = (G: Grid, x: number, y: number) => {
      x -= G.ox; y -= G.oy;
      const gx = Math.min(G.n - 1.001, Math.max(0, (x + G.R) / G.cell)), gy = Math.min(G.n - 1.001, Math.max(0, (y + G.R) / G.cell));
      const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j, h = G.h, n = G.n;
      return (h[j * n + i] * (1 - fx) + h[j * n + i + 1] * fx) * (1 - fy) + (h[(j + 1) * n + i] * (1 - fx) + h[(j + 1) * n + i + 1] * fx) * fy;
    };
    const inGrid = (G: Grid, x: number, y: number) => Math.abs(x - G.ox) < G.R - 2 && Math.abs(y - G.oy) < G.R - 2;
    // (the fine grid where it reaches, the wide one past it)
    const ground = (x: number, y: number) => (inGrid(g, x, y) || !wide ? sample(g, x, y) : sample(wide, x, y));
    const pages = async (urls: string[], cb: string, each: (f: any) => void) => {
      const seen = new Set<string>();
      for (const url of urls) {
        let body: any = null;
        (self as any)[cb] = (b: unknown) => { body = b; };
        for(let attempt=0;attempt<4;attempt++){
          body=null;
          try { importScripts(url); } catch { if(attempt===3)throw new Error('Road geography request failed'); }
          if(body?.response?.status==='OK'||body?.response?.status==='NOT_FOUND')break;
          if(attempt===3)throw new Error('Road geography response unavailable');
          await new Promise(resolve=>setTimeout(resolve,80*(attempt+1)));
        }
        const fs = body?.response?.result?.featureCollection?.features ?? [];
        for (const f of fs) {
          const id = String(f.id ?? f.properties?.ufid ?? f.properties?.link_id ?? "");
          if (id && seen.has(id)) continue;
          if (id) seen.add(id);
          each(f);
        }
        if (fs.length < 1000) break;
      }
    };
    const linesOf = (geom: any): number[][][] => geom?.type === "LineString" ? [geom.coordinates] : geom?.type === "MultiLineString" ? geom.coordinates : [];
    const project = ([x, y]: number[]) => [(x - lon) * kx, (y - lat) * ky];
    type Road = { line: number[][]; width: number; lanes: number; oneway?: boolean };
    const roads: Road[] = [];
    await pages(e.data.urls, "roadCb", f => {
      const width = parseFloat(f.properties?.rvwd) || 0, lanes = Math.round(parseFloat(f.properties?.rdln) || 0);
      if (width < 3.5 && lanes < 1) return;
      const w = Math.min(60, width || Math.max(1, lanes) * 3.3);
      // (no lane count registered: as many 3.3 m lanes as the width holds)
      for (const l of linesOf(f.geometry)) if (l.length > 1) roads.push({ line: l.map(project), width: w, lanes: Math.max(1, lanes || Math.floor(w / 3.3)) });
    });
    // The structures: 교량 / 고가도로 (raised), 터널 / 지하차도 (under), as segments on a 10 m hash.
    type Seg = { ax: number; ay: number; bx: number; by: number; kind: 0 | 1 | 2 | -1 | -2;id:string;line:number[][] };
    const segs = new Map<string, Seg[]>();
    const linkList: { id: string; kind: number; rank: string; line: number[][] }[] = [];
    await pages(e.data.linkUrls, "linkCb", f => {
      const t = String(f.properties?.rd_type_h ?? "");
      // (a tunnel through a hill -2, an underpass -1: both under, only a tunnel's mouth is drawn)
      const kind = t === "교량" ? 1 : t === "고가도로" ? 2 : t === "터널" ? -2 : t === "지하차도" ? -1 : 0;
      for (const l of linesOf(f.geometry)) if (l.length > 1) linkList.push({ id: String(f.properties?.link_id ?? f.id ?? ''), kind, rank: String(f.properties?.rd_rank_h ?? ''), line: l.map(project) });
      for (const l of linesOf(f.geometry)) for (let i = 1; i < l.length; i++) {
        const [ax, ay] = project(l[i - 1]), [bx, by] = project(l[i]);
        const s: Seg = { ax, ay, bx, by, kind: kind as Seg["kind"],id:String(f.properties?.link_id??f.id??JSON.stringify(l)),line:l.map(project) };
        cells(Math.min(ax, bx) - 20, Math.min(ay, by) - 20, Math.max(ax, bx) + 20, Math.max(ay, by) + 20, 10, k => add(segs, k, s));
      }
    });
    // The river areas (하천망 LT_C_WKMSTRM): a road over one that the links do not call a bridge
    // must still not lie in the water (below).
    const rivers: number[][][] = [];
    if (e.data.riverUrls.length) await pages(e.data.riverUrls, "riverCb", f => {
      const g = f.geometry, polys: number[][][][] = g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : [];
      for (const poly of polys) if (poly[0]?.length >= 3) {
        // (cut to the tile and 200 m round it: a river's outline runs on for kilometres)
        let ring = poly[0].map(project);
        const lim = [box[0] - 200, box[1] - 200, box[2] + 200, box[3] + 200];
        for (const [axis, side, v] of [[0, -1, lim[0]], [0, 1, lim[2]], [1, -1, lim[1]], [1, 1, lim[3]]] as const) {
          if (!ring.length) break;
          const inside = (p: number[]) => side < 0 ? p[axis] >= v : p[axis] <= v, out: number[][] = [];
          for (let k = 0; k < ring.length; k++) { const a = ring[(k + ring.length - 1) % ring.length], b = ring[k];
            if (inside(a) !== inside(b)) { const t = (v - a[axis]) / (b[axis] - a[axis]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
            if (inside(b)) out.push(b); }
          ring = out;
        }
        if (ring.length >= 3) rivers.push(ring);
      }
    });
    // Roads the base map's centre lines do not have yet (a new bridge, a new expressway): from the
    // official links themselves (roadLinkFallback.ts).
    const fallback = (self as unknown as { __linkFallback: typeof linkFallbackRoads }).__linkFallback(roads, linkList, [box[0] - 30, box[1] - 30, box[2] + 30, box[3] + 30]);
    for (const f of fallback) roads.push({ line: f.line, width: f.width, lanes: f.lanes, oneway: f.oneway });
    // The dedicated landmark supplies its own slab, four-lane markings and traffic on both storeys.
    const deck = e.data.deck;
    const onDeck = (x: number, y: number, dx: number, dy: number): number | null => {
      if (!deck) return null;
      let best: number | null = null, bd = 13;
      for (let i = 1; i < deck.pts.length; i++) {
        const [ax, ay] = deck.pts[i - 1], [bx, by] = deck.pts[i], ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / l2)), d = Math.hypot(ax + ex * t - x, ay + ey * t - y);
        if (d >= bd) continue;
        if (Math.abs(ex * dx + ey * dy) / (Math.sqrt(l2) * (Math.hypot(dx, dy) || 1)) < 0.85) continue;
        bd = d; best = deck.z[i - 1] + (deck.z[i] - deck.z[i - 1]) * t;
      }
      return best;
    };
    // A road point's structure: a link within 20 m running the same way (a road under a bridge
    // crosses it: not the same way). Water adjacency does not establish a bridge.
    const ownerAt = (x: number, y: number, dx: number, dy: number): Seg|null => {
      let best:Seg|null = null, bd = 20;
      const hits:{s:Seg;d:number}[]=[];
      for (const s of segs.get(Math.floor(x / 10) + "," + Math.floor(y / 10)) ?? []) {
        const ex = s.bx - s.ax, ey = s.by - s.ay, l2 = ex * ex + ey * ey || 1, t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (y - s.ay) * ey) / l2));
        const d = Math.hypot(s.ax + ex * t - x, s.ay + ey * t - y);
        if (d >20) continue;
        const cos = Math.abs(ex * dx + ey * dy) / (Math.sqrt(l2) * (Math.hypot(dx, dy) || 1));
        if (cos < 0.9) continue;
        hits.push({s,d});if(d<bd){bd=d;best=s;}
      }
      return best&&hits.some(h=>h.s.kind!==best!.kind&&h.d-bd<2)?null:best;
    };
    // Each line resampled every ~6 m (over a margin past the tile: a bridge's far end may lie
    // outside it), its heights, then cut to the tile.
    const [bx0, by0, bx1, by1] = box, M = 150;
    type Piece = Road & { z: number[]; kind: number[]; owners:(Seg|null)[]; normals:number[][];jn: boolean[]; id: number };
    const pieces: Piece[] = [];
    let bridges = 0;
    const prepared = roads.map(r => {
      const pts: number[][] = [];
      for (let i = 1; i < r.line.length; i++) {
        const a = r.line[i - 1], b = r.line[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / rules.step));
        // (a point the survey repeats: once — see surfaceGeometry.miters)
        if (L < 0.01 && pts.length) continue;
        for (let k = i === 1 ? 0 : 1; k <= n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      }
      const owners=pts.map((p,k)=>{const q=pts[Math.min(pts.length-1,k+1)],o=pts[Math.max(0,k-1)];return ownerAt(p[0],p[1],q[0]-o[0],q[1]-o[1]);});
      const kind:number[]=owners.map(o=>o?.kind??0);
      return {r,pts,owners,kind};
    });
    const ends=prepared.flatMap(record=>[true,false].map(begin=>{
      const {pts,owners}=record,ids=begin?[1,2,3]:[pts.length-2,pts.length-3,pts.length-4];
      const hits=ids.filter(i=>i>=0&&i<pts.length).map(i=>owners[i]).filter((o):o is Seg=>!!o),first=hits[0];
      const owner=first&&!hits.some(o=>o.kind!==first.kind||o.id!==first.id)?first:null;
      return {record,begin,owner,point:begin?pts[0]:pts[pts.length-1],inside:begin?pts[1]:pts[pts.length-2]};
    }));
    for(const edge of ends){
      if(!edge.owner||edge.owner.kind<=0)continue;
      const dx=edge.inside[0]-edge.point[0],dy=edge.inside[1]-edge.point[1];
      const bank=ends.some(other=>other.record!==edge.record&&other.owner?.kind===0&&Math.hypot(other.point[0]-edge.point[0],other.point[1]-edge.point[1])<=1.5&&((other.inside[0]-other.point[0])*dx+(other.inside[1]-other.point[1])*dy)/(Math.hypot(dx,dy)*Math.hypot(other.inside[0]-other.point[0],other.inside[1]-other.point[1])||1)<-.5);
      if(!bank)continue;
      // Resolve only the tiny ambiguous bank end backed by two actual source endpoints.
      // Interior crossings and unmatched/parallel roads retain their original classification.
      for(let k=0;k<Math.min(4,edge.record.pts.length);k++){
        const i=edge.begin?k:edge.record.pts.length-1-k;
        if(edge.record.owners[i])break;
        edge.record.owners[i]=edge.owner;edge.record.kind[i]=edge.owner.kind;
      }
    }
    // A stretch of a base-map line the links did not claim, between two pieces of one bridge's
    // chain (at a link's end, or by a ramp where the match was ambiguous), is that deck: never
    // the ground or the water between them.
    {
      const chainKey=new Map<string,string>();
      for(const c of e.data.chains??[])for(const id of c.ids)chainKey.set(id,c.ids[0]);
      const same=(a:Seg|null|undefined,b:Seg|null|undefined)=>!!a&&!!b&&a.kind>0&&b.kind>0&&(a.id===b.id||(chainKey.get(a.id)??a.id)===(chainKey.get(b.id)??b.id));
      for(const record of prepared){
        const {pts,owners}=record;
        for(let i=1;i<pts.length-1;i++){
          if(owners[i]||!owners[i-1])continue;
          let j=i;while(j<pts.length&&!owners[j])j++;
          if(j<pts.length&&same(owners[i-1],owners[j])&&Math.hypot(pts[j][0]-pts[i-1][0],pts[j][1]-pts[i-1][1])<=120)
            for(let k=i;k<j;k++){owners[k]=owners[i-1];record.kind[k]=owners[i-1]!.kind;}
          i=j;
        }
      }
    }
    const bankPoints:number[]=[];
    // One deck per bridge (bridgeDecks.ts, the view's rule too): the stretches of the lines on a
    // bridge's chain are not drawn piece by piece, each its own width — one road along the chain's
    // line, its deck's width, offset and lanes, the same in every tile.
    {
      const decked=new Map<string,NonNullable<RoadJob['chains']>[number]>();
      for(const c of e.data.chains??[])if(c.deck)for(const id of c.ids)decked.set(id,c);
      const spans:{chain:string;line:number[][]}[]=[],at:{rec:number;i0:number;i1:number}[]=[];
      prepared.forEach(({pts,owners},rec)=>{
        const key=(i:number)=>{const o=owners[i];return o&&o.kind===1?decked.get(o.id)?.ids[0]:undefined;};
        for(let i=0;i<pts.length;){
          const k=key(i);if(!k){i++;continue;}
          let j=i;while(j+1<pts.length&&key(j+1)===k)j++;
          const i0=Math.max(0,i-1),i1=Math.min(pts.length-1,j+1);
          if(i1>i0){spans.push({chain:k,line:pts.slice(i0,i1+1)});at.push({rec,i0,i1});}
          i=j+1;
        }
      });
      if(spans.length || decked.size){
        const banks:{line:number[][]}[]=[];
        for(const {pts,kind} of prepared)for(let i=0;i<pts.length-1;i++)
          if(kind[i]===0&&kind[i+1]===0)banks.push({line:[pts[i],pts[i+1]]});
        const {decks,taken}=(self as unknown as {__chainDecks:typeof chainDeckRoads}).__chainDecks(spans,e.data.chains!,120,3,banks);
        const cut=new Map<number,{i0:number;i1:number}[]>();
        at.forEach((a,k)=>{if(!taken[k])return;let l=cut.get(a.rec);if(!l)cut.set(a.rec,l=[]);l.push(a);});
        const next:typeof prepared=[];
        prepared.forEach((record,rec)=>{
          const cuts=cut.get(rec);if(!cuts){next.push(record);return;}
          // (the rest of the line, the road at grade on to the bridge: up to the deck's end, where
          // the deck reaches under it)
          const starts=new Set(cuts.map(c=>c.i1)),stops=new Set(cuts.map(c=>c.i0));
          const keep=(a:number,b:number)=>{
            if(b-a<1)return;
            const owners=record.owners.slice(a,b+1),kind=record.kind.slice(a,b+1);
            if(starts.has(a)){owners[0]=record.owners[a+1];kind[0]=record.kind[a+1];}
            if(stops.has(b)){owners[owners.length-1]=record.owners[b-1];kind[kind.length-1]=record.kind[b-1];}
            const r={...record.r,line:record.pts.slice(a,b+1)};roads.push(r);
            next.push({r,pts:record.pts.slice(a,b+1),owners,kind});
          };
          cuts.sort((x,y)=>x.i0-y.i0);
          let from=0;
          for(const c of cuts){keep(from,c.i0);from=Math.max(from,c.i1);}
          keep(from,record.pts.length-1);
        });
        const chainSeg=new Map<string,Seg>();
        for(const d of decks){
          bankPoints.push(...d.line[0],...d.line[d.line.length-1]);
          const c=(e.data.chains??[]).find(q=>q.ids[0]===d.chain)!;
          let o=chainSeg.get(d.chain);
          if(!o){const l=c.line;o={ax:l[0][0],ay:l[0][1],bx:l[l.length-1][0],by:l[l.length-1][1],kind:1,id:c.ids[0],line:l};chainSeg.set(d.chain,o);}
          const pts:number[][]=[];
          for(let i=1;i<d.line.length;i++){const a=d.line[i-1],b=d.line[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.ceil(L/rules.step));
            for(let k=i===1?0:1;k<=n;k++)pts.push([a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n]);}
          if(pts.length<2)continue;
          const r:Road={line:pts,width:d.width,lanes:d.lanes,oneway:!d.twoWay};roads.push(r);
          next.push({r,pts,owners:pts.map(()=>o!),kind:pts.map(()=>1)});
        }
        // A bank can land inside an unsplit base-map road. Split its ground
        // record there so the rendered surface AND outgoing lane paths share
        // that endpoint; an XY overpass crossing never enters this list.
        const bankEnds=decks.flatMap(d=>[d.line[0],d.line[d.line.length-1]]);
        const joined:typeof prepared=[];
        for(const record of next){
          const {pts,kind,owners}=record,cuts:{k:number;t:number;p:number[]}[]=[];
          for(const p of bankEnds){
            for(let k=1;k<pts.length;k++){
              if(kind[k-1]!==0||kind[k]!==0)continue;
              const a=pts[k-1],b=pts[k],dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;
              if(!l2)continue;
              const t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2;
              if(t<0||t>1||Math.hypot(a[0]+dx*t-p[0],a[1]+dy*t-p[1])>1e-4)continue;
              if(k===1&&t<1e-4||k===pts.length-1&&t>1-1e-4)break;
              if(!cuts.some(c=>Math.hypot(c.p[0]-p[0],c.p[1]-p[1])<.1))cuts.push({k,t,p});
              break;
            }
          }
          if(!cuts.length){joined.push(record);continue;}
          cuts.sort((a,b)=>a.k+a.t-b.k-b.t);
          let line=[pts[0]],ks=[kind[0]],os=[owners[0]],cut=0;
          const flush=()=>{if(line.length>1)joined.push({r:{...record.r,line},pts:line,kind:ks,owners:os});};
          for(let k=1;k<pts.length;k++){
            while(cut<cuts.length&&cuts[cut].k===k){const p=cuts[cut++].p;
              if(Math.hypot(line[line.length-1][0]-p[0],line[line.length-1][1]-p[1])>.001){line.push(p);ks.push(0);os.push(owners[k-1]);}
              flush();line=[p];ks=[0];os=[owners[k-1]];
            }
            if(Math.hypot(line[line.length-1][0]-pts[k][0],line[line.length-1][1]-pts[k][1])>.001){line.push(pts[k]);ks.push(kind[k]);os.push(owners[k]);}
          }
          flush();
        }
        prepared.splice(0,prepared.length,...joined.filter(r=>!r.kind.every(k=>k===0)||!decks.some(d=>r.r.width<=d.width*1.2&&rules.deckCoversLine(r.pts,d.line,d.width/2))));
      }
    }
    const insideRing=(ring:number[][],x:number,y:number)=>{let odd=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])odd=!odd;}return odd;};
    const waterAtEarly=(x:number,y:number)=>Number.isFinite(e.data.seaLevel)&&(e.data.sea??[]).some(r=>insideRing(r,x,y))&&!(e.data.seaHoles??[]).some(r=>insideRing(r,x,y))?e.data.seaLevel!:null;
    const approachRoads:RealEstateRoad[]=[];
    for(const {r,pts,owners} of prepared){
      let start=0;
      const emit=(end:number)=>{const owner=owners[start];if(end>start)approachRoads.push({line:pts.slice(start,end+1) as [number,number][],width:r.width,lanes:r.lanes,link_id:owner?.id,profile_line:owner?.line as [number,number][]|undefined,structure:owner?.kind===1?'bridge':owner?.kind===2?'elevated':owner?.kind===0?'ground':'unknown',structure_source:owner?'VWorld LT_L_MOCTLINK':undefined});};
      for(let i=1;i<pts.length;i++)if(owners[i]?.id!==owners[start]?.id){emit(i);start=i;}
      emit(pts.length-1);
      // Provider structure matching can be ambiguous within a few metres of the bank.
      // Retain a source road's physical endpoint when its inward samples confirm its owner.
      for(const begin of [true,false]){
        const ids=begin?[1,2,3]:[pts.length-2,pts.length-3,pts.length-4];
        const candidates=ids.filter(i=>i>=0&&i<pts.length).map(i=>owners[i]).filter((o):o is Seg=>!!o);
        const owner=candidates[0];if(!owner||owner.kind<0||candidates.some(o=>o.kind!==owner.kind||o.id!==owner.id))continue;
        const endpoint=begin?pts[0]:pts[pts.length-1],inside=pts[ids.find(i=>i>=0&&i<pts.length&&owners[i]?.id===owner.id)!];
        if(!inside)continue;
        approachRoads.push({line:[endpoint,inside] as [number,number][],width:r.width,lanes:r.lanes,link_id:owner.id,profile_line:owner.line as [number,number][],structure:owner.kind===1?'bridge':owner.kind===2?'elevated':'ground',structure_source:'VWorld LT_L_MOCTLINK'});
      }
    }
    // A bridge link's deck along its whole chain (one profile for every tile and the view).
    type Chain=NonNullable<RoadJob['chains']>[number];
    const chainOf=new Map<string,Chain>();
    for(const c of e.data.chains??[])for(const id of c.ids)chainOf.set(id,c);
    for(const a of approachRoads){const c=a.structure==='bridge'&&a.link_id?chainOf.get(a.link_id):undefined;if(c){a.profile_line=c.line as [number,number][];a.profile_s=c.s;a.profile_z=c.z;}}
    const insideWater=(ring:number[][],x:number,y:number)=>{let odd=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])odd=!odd;}return odd;};
    const waterAt=(x:number,y:number)=>Number.isFinite(e.data.seaLevel)&&(e.data.sea??[]).some(r=>insideWater(r,x,y))&&!(e.data.seaHoles??[]).some(r=>insideWater(r,x,y))?e.data.seaLevel!:null;
    const baseline=(r:RealEstateRoad,x:number,y:number)=>r.profile_line&&r.profile_s&&r.profile_z?rules.profileAt(r.profile_line,r.profile_s,r.profile_z,x,y):r.structure==='bridge'||r.structure==='elevated'?rules.profileHeight(r.profile_line??r.line,x,y,ground,waterAt,(x,y)=>inGrid(g,x,y)||!!wide&&inGrid(wide,x,y),e.data):r.structure==='ground'?groundGrade(r.line,rules.along(r.line,x,y).along,ground,waterAt):ground(x,y);
    const nearest=(line:readonly [number,number][],x:number,y:number)=>{const p=rules.along(line as unknown as number[][],x,y);let s=0,dir:[number,number]=[1,0];for(let i=1;i<line.length;i++){const dx=line[i][0]-line[i-1][0],dy=line[i][1]-line[i-1][1],l=Math.hypot(dx,dy);if(s+l>=p.along-1e-8&&l){dir=[dx/l,dy/l];break;}s+=l;}return {...p,point:[p.x,p.y] as [number,number],dir};};
    const approach=(self as unknown as {__approachHeight:typeof roadApproachHeight}).__approachHeight(approachRoads,{at:ground,height:baseline,nearest,key:r=>r.link_id??r.id??JSON.stringify(r.profile_line??r.line)});
    const ownerRoads=new Map<Seg,RealEstateRoad>();
    const ownerRoad=(o:Seg):RealEstateRoad=>{let r=ownerRoads.get(o);if(!r){const c=o.kind===1?chainOf.get(o.id):undefined;
      r={line:o.line as [number,number][],profile_line:(c?.line??o.line) as [number,number][],profile_s:c?.s,profile_z:c?.z,link_id:o.id,width:0,lanes:0,structure:o.kind===1?'bridge':'elevated'};ownerRoads.set(o,r);}return r;};
    const ownerHeight=(o:Seg,x:number,y:number)=>{const r=ownerRoad(o);return approach?.(r,x,y)??baseline(r,x,y);};
    for (const {r,pts,owners,kind} of prepared) {
      const near = (p: number[]) => p[0] > bx0 - M && p[0] < bx1 + M && p[1] > by0 - M && p[1] < by1 + M;
      if (!pts.some(near)) continue;
      const z = pts.map((p,i)=>{const o=owners[i];return !o||kind[i]<=0?ground(p[0],p[1]):ownerHeight(o,p[0],p[1]);});
      // A road at grade is laid smooth along its length: the relief's dips under it (a 4 m
      // grid's hollows, a culvert) are smoothed within its own road corridor.
      // Confirmed bridge banks are joined separately; ordinary roads never
      // inherit the height of another road or an overhead deck.
      {
        // (the ground under it is cut to the road — the tile's grid, below — so the road is no
        // longer lifted onto each post of the relief: smooth along ±16 m, a filled dip kept filled)
        for (let i = 0; i < z.length;) {
          if (kind[i] !== 0) { i++; continue; }
          let end = i; while (end + 1 < z.length && kind[end + 1] === 0) end++;
          const line = pts.slice(i, end + 1); let station = 0;
          for (let k = i; k <= end; k++) {
            if (k > i) station += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
            z[k] = groundGrade(line, station, ground, waterAt);
          }
          i = end + 1;
        }
        // Never in the sea; and over a river area, a stretch sunk more than 2 m under the line
        // between its dry ends is a crossing the links do not register: laid straight bank to bank.
        if (Number.isFinite(e.data.seaLevel)) for (let i = 0; i < z.length; i++) if (kind[i] === 0 && waterAtEarly(pts[i][0], pts[i][1]) !== null) z[i] = Math.max(z[i], e.data.seaLevel! + 0.4);
        if (rivers.length) {
          const inRiver = pts.map(p => rivers.some(r => insideRing(r, p[0], p[1])));
          for (let i = 0; i < z.length;) {
            if (!inRiver[i] || kind[i] !== 0) { i++; continue; }
            let j = i; while (j + 1 < z.length && inRiver[j + 1] && kind[j + 1] === 0) j++;
            const a = i - 1, b = j + 1;
            if (a >= 0 && b < z.length) {
              // Smooth each dry bank inward along its own road. The full-road
              // window includes river-bed DEM beside the bank and lowers both
              // supports before interpolation, submerging the entire crossing.
              let left = a, right = b;
              while (left > 0 && !inRiver[left - 1] && kind[left - 1] === 0) left--;
              while (right + 1 < z.length && !inRiver[right + 1] && kind[right + 1] === 0) right++;
              const dryLeft = pts.slice(left, a + 1), dryRight = pts.slice(b, right + 1);
              let length = 0;
              for (let k = 1; k < dryLeft.length; k++) length += Math.hypot(dryLeft[k][0] - dryLeft[k - 1][0], dryLeft[k][1] - dryLeft[k - 1][1]);
              const za = Math.max(z[a], groundGrade(dryLeft, length, ground, waterAt));
              const zb = Math.max(z[b], groundGrade(dryRight, 0, ground, waterAt));
              let sag = 0;
              for (let k = i; k <= j; k++) sag = Math.max(sag, za + (zb - za) * (k - a) / (b - a) - z[k]);
              if (sag > 2) for (let k = a; k <= b; k++) z[k] = Math.max(z[k], za + (zb - za) * (k - a) / (b - a));
            }
            i = j + 1;
          }
        }
      }
      // (on the landmark deck: its height, kind 3 — no slab or piers of ours under it)
      pts.forEach((p, k) => {
        const q = pts[Math.min(pts.length - 1, k + 1)], o = pts[Math.max(0, k - 1)], h = onDeck(p[0], p[1], q[0] - o[0], q[1] - o[1]);
        if (h !== null) { z[k] = h; kind[k] = 3; }
      });
      // Official full-link bank profiles are stable across tiles. Water alone
      // cannot classify a road as a bridge or fabricate a 7/8 m height.
      for (let k = 0; k < kind.length;) {
        let e2 = k; while (e2 < kind.length && kind[e2] === kind[k]) e2++;
        if (kind[k] > 0 && kind[k] !== 3) {
          bridges++;
        }
        k = e2;
      }
      // Include centrelines whose width reaches this tile. Final triangles are
      // clipped to tile bounds, so adjacent road/terrain owners meet exactly.
      const normals=rules.miters(pts);
      const pad=r.width/2+(r.width>=30?5:r.width>=20?4:r.width>=12?3:2.25)+2;
      const roadBox=[box[0]-pad,box[1]-pad,box[2]+pad,box[3]+pad];
      let run:number[][]=[],runZ:number[]=[],runKind:number[]=[],runOwners:(Seg|null)[]=[],runNormals:number[][]=[];
      const flush = () => {
        if (run.length > 1) pieces.push({ ...r, line:run,z:runZ,kind:runKind,owners:runOwners,normals:runNormals,jn:run.map(()=>false),id:roads.indexOf(r) });
        run=[];runZ=[];runKind=[];runOwners=[];runNormals=[];
      };
      for(let k=1;k<pts.length;k++){
        const hit=rules.clipSegment(pts[k-1],pts[k],roadBox);if(!hit){flush();continue;}
        const push=(p:number[],t:number)=>{run.push(p);runZ.push(z[k-1]+(z[k]-z[k-1])*t);runKind.push(t<.5?kind[k-1]:kind[k]);runOwners.push(t<.5?owners[k-1]:owners[k]);runNormals.push(normals[k-1].map((n,i)=>n+(normals[k][i]-n)*t));};
        if(run.length&&Math.hypot(run[run.length-1][0]-hit.a[0],run[run.length-1][1]-hit.a[1])>1e-5)flush();
        if(!run.length)push(hit.a,hit.lo);push(hit.b,hit.hi);if(hit.hi<1-1e-7)flush();
      }
      flush();
    }
    // Every ground arm at a confirmed bank shares the measured terrain node.
    // River-fill smoothing on one arm must not leave a separate height for the
    // incoming arm. Ease only these bank endpoints back to their own grade.
    for(const r of pieces)for(const begin of [true,false]){
      const end=begin?0:r.line.length-1,p=r.line[end];if(r.kind[end]!==0)continue;
      let bank:number[]|undefined;
      for(let i=0;i<bankPoints.length;i+=2)if(Math.hypot(p[0]-bankPoints[i],p[1]-bankPoints[i+1])<.15){bank=[bankPoints[i],bankPoints[i+1]];break;}
      if(!bank)continue;
      const delta=ground(bank[0],bank[1])-r.z[end];let walked=0;
      for(let k=end;k>=0&&k<r.line.length;k+=begin?1:-1){
        if(k!==end){const j=k+(begin?-1:1);walked+=Math.hypot(r.line[k][0]-r.line[j][0],r.line[k][1]-r.line[j][1]);}
        if(walked>=16||r.kind[k]!==0)break;
        const u=walked/16;r.z[k]+=delta*(1-3*u*u+2*u*u*u);
      }
    }
    // The same registered-footprint clearance as the departure area. Preserve
    // confirmed decks; XY-only building evidence cannot cut an elevated road.
    if(e.data.footprints?.length){
      const constrain=(self as unknown as {__corridors:ReturnType<typeof roadCorridorRules>}).__corridors;
      const fitted:Piece[]=[];
      for(const r of pieces){
        if(r.kind.some(k=>k!==0)){fitted.push(r);continue;}
        for(const fixed of constrain([{line:r.line as [number,number][],width:r.width,lanes:r.lanes,oneway:r.oneway}],e.data.footprints)){
          if(fixed.line===r.line){fitted.push({...r,width:fixed.width});continue;}
          const heights:number[]=[];
          let k=1;
          for(const p of fixed.line){
            while(k<r.line.length-1&&rules.along(r.line,p[0],p[1]).along>rules.along(r.line,r.line[k][0],r.line[k][1]).along+1e-6)k++;
            const a=r.line[k-1],b=r.line[k],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
            heights.push(r.z[k-1]+(r.z[k]-r.z[k-1])*t);
          }
          // (its own line's miters: the original's, carried over to a line moved off a building,
          // were no longer square to it — its paint narrowed to a point and kinked)
          const normals=rules.miters(fixed.line as number[][]);
          fitted.push({...r,width:fixed.width,line:fixed.line,z:heights,normals,kind:fixed.line.map(()=>0),owners:fixed.line.map(()=>null),jn:fixed.line.map(()=>false)});
        }
      }
      pieces.splice(0,pieces.length,...fitted);
    }
    // Junctions: a point of one road on another road's carriageway (another road, on the same
    // level — a bridge over a road is no junction).
    const segAt = new Map<string, [number, number][]>();
    pieces.forEach((r, pi) => {
      for (let k = 1; k < r.line.length; k++) {
        const a = r.line[k - 1], b = r.line[k], m = r.width / 2 + 2;
        cells(Math.min(a[0], b[0]) - m, Math.min(a[1], b[1]) - m, Math.max(a[0], b[0]) + m, Math.max(a[1], b[1]) + m, 15, kk => add(segAt, kk, [pi, k] as [number, number]));
      }
    });
    const clusters = new Map<string, { x: number; y: number; z: number; n: number; r: number; elevated:boolean; roads?: Map<number, number>; axis?: [number, number, number] }>();
    pieces.forEach(r => {
      for (let k = 0; k < r.line.length; k++) {
        const [x, y] = r.line[k];
        for (const [qi, qk] of segAt.get(Math.floor(x / 15) + "," + Math.floor(y / 15)) ?? []) {
          const q = pieces[qi];
          if (q.id === r.id || (q.kind[qk] > 0) !== (r.kind[k] > 0) || q.kind[qk] < 0 || r.kind[k] < 0) continue;
          const a = q.line[qk - 1], b = q.line[qk], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1;
          const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / l2));
          if(r.kind[k]>0&&Math.abs(r.z[k]-(q.z[qk-1]+(q.z[qk]-q.z[qk-1])*t))>1)continue;
          if (Math.hypot(a[0] + ex * t - x, a[1] + ey * t - y) > q.width / 2 + 0.5) continue;
          // (two carriageways side by side — a divided road, a bridge's two decks — are no junction:
          // a junction is where they cross or meet at an angle)
          const o = r.line[Math.min(r.line.length - 1, k + 1)], pv = r.line[Math.max(0, k - 1)], rx = o[0] - pv[0], ry = o[1] - pv[1];
          if (Math.abs(rx * ex + ry * ey) / ((Math.hypot(rx, ry) || 1) * Math.sqrt(l2)) > 0.9) continue;
          r.jn[k] = true;
          const ck = Math.round(x / 14) + "," + Math.round(y / 14)+':'+(r.kind[k]>0?r.owners[k]?.id??'deck':'ground'), c = clusters.get(ck) ?? { x: 0, y: 0, z: 0, n: 0, r: 0, elevated:r.kind[k]>0 };
          c.x += x; c.y += y; c.z += r.z[k]; c.n++; c.r = Math.max(c.r, r.width / 2, q.width / 2);
          // (the roads meeting there and the widest one's direction: the signal's two phases)
          c.roads ??= new Map(); c.roads.set(r.id, r.width); c.roads.set(q.id, q.width);
          const rl = Math.hypot(rx, ry) || 1, ql = Math.sqrt(l2);
          for (const [w, dx, dy] of [[r.width, rx / rl, ry / rl], [q.width, ex / ql, ey / ql]]) if (!c.axis || w > c.axis[2]) c.axis = [dx, dy, w];
          clusters.set(ck, c);
          break;
        }
      }
    });
    const S = { p: [] as number[], n: [] as number[], i: [] as number[],level:[] as number[] };
    // (the junctions' asphalt goes with the roads': one mesh)
    const Jn = S;
    const streetTrees: number[] = [], clear: number[] = [];
    // the junctions' asphalt: a disc the widest road's half width round each, over the bands
    for (const c of clusters.values()) {
      const cx = c.x / c.n, cy = c.y / c.n, cz = c.z / c.n, R = c.r + 1.5, base = Jn.p.length / 3;
      // (a little under the roads' own surfaces and well under their paint)
      Jn.p.push(cx, cy, (c.elevated?cz:ground(cx,cy)) + rules.surfaceLift-.01); Jn.n.push(0, 0, 1);Jn.level.push(c.elevated?1:0);
      for (let q = 0; q <= 20; q++) { const a = (q / 20) * Math.PI * 2, x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R; Jn.p.push(x, y, (c.elevated?cz:ground(x,y)) + rules.surfaceLift-.01); Jn.n.push(0, 0, 1);Jn.level.push(c.elevated?1:0); }
      for (let q = 1; q <= 20; q++) Jn.i.push(base, base + q, base + q + 1);
    }
    // A painted rectangle (a crossing's stripe, a stop line): centre, direction along, half sizes.
    // (`z` here is the height over the ground: each corner follows the relief, as the road does —
    // a flat stripe across a cambered or sloping road sank under it on one side)
    const rect = (out: { p: number[]; n: number[]; i: number[]; c?: number[];level?:number[] }, x: number, y: number, z: number, dx: number, dy: number, ha: number, hc: number, col: number[], zAt?: (x: number, y: number) => number) => {
      const nx = -dy, ny = dx, base = out.p.length / 3;
      for (const [a, c] of [[-ha, -hc], [ha, -hc], [ha, hc], [-ha, hc]]) {
        const px = x + dx * a + nx * c, py = y + dy * a + ny * c;
        out.p.push(px, py, zAt ? zAt(px, py) : ground(px, py) + z); out.n.push(0, 0, 1); out.c?.push(col[0], col[1], col[2]);out.level?.push(0);
      }
      out.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const Mk = { p: [] as number[], n: [] as number[], i: [] as number[], c: [] as number[],level:[] as number[] };
    const Mf = { p: [] as number[], n: [] as number[], i: [] as number[], c: [] as number[],level:[] as number[] };
    const St = { p: [] as number[], n: [] as number[], i: [] as number[] };
    const Wk = { p: [] as number[], n: [] as number[], i: [] as number[],level:[] as number[] };
    const kerbs:number[][]=[];
    const walkPaths: number[] = [];
    const lanes: number[] = [];
    const WHITE = [0.95, 0.95, 0.93], YELLOW = [0.98, 0.74, 0.1];
    const normalsByLine=new Map(pieces.map(r=>[r.line,r.normals]));
    const normalAt = (l:number[][],k:number)=>normalsByLine.get(l)![k];
    // Where paint may go: not inside the carriageway of a road crossing at its level (each road's
    // lines stop at the other's edge) — a road of two lanes or more, or half this one's width: an
    // alley meeting a boulevard leaves its lines whole. Roads running side by side are not crossings
    // (the survey gives a divided road's two centre lines the whole road's width each). (The
    // junctions were found by vertex: a whole 3 m step and more of the centre line went at each.)
    const paintFree = (self: Piece, x: number, y: number, z: number, dx: number, dy: number) => {
      for (const [qi, qk] of segAt.get(Math.floor(x / 15) + "," + Math.floor(y / 15)) ?? []) {
        const q = pieces[qi];
        if (q === self || q.id === self.id || q.kind[qk] < 0 || q.kind[qk - 1] < 0) continue;
        const a = q.line[qk - 1], b = q.line[qk], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey;
        if (!l2) continue;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / l2));
        if (Math.hypot(a[0] + ex * t - x, a[1] + ey * t - y) > q.width / 2) continue;
        if (Math.abs(q.z[qk - 1] + (q.z[qk] - q.z[qk - 1]) * t - z) > 1.5) continue;
        if (q.width < 8 && q.width < self.width / 2) continue;
        if (Math.abs(dx * ex + dy * ey) / ((Math.hypot(dx, dy) || 1) * Math.sqrt(l2)) <= 0.9) return false;
      }
      return true;
    };
    // A band along a piece from s0 to s1 m, offset `off` to the left, `w` wide, `lift` over the road.
    const band = (r: Piece, off: number, w: number, lift: number, out: { p: number[]; n: number[]; i: number[]; c?: number[];level?:number[] }, col: number[] | null, dash: number, skip: (k: number) => boolean) => {
      const l = r.line, cum = [0];
      for (let k = 1; k < l.length; k++) cum.push(cum[k - 1] + Math.hypot(l[k][0] - l[k - 1][0], l[k][1] - l[k - 1][1]));
      const total = cum[cum.length - 1];
      const at = (s: number) => {
        let k = 0; while (k < l.length - 2 && cum[k + 1] < s) k++;
        const f = Math.min(1, Math.max(0, (s - cum[k]) / ((cum[k + 1] - cum[k]) || 1)));
        const a=r.normals[k],b=r.normals[k+1];
        return { x: l[k][0] + (l[k + 1][0] - l[k][0]) * f, y: l[k][1] + (l[k + 1][1] - l[k][1]) * f, z: r.z[k] + (r.z[k + 1] - r.z[k]) * f, k,nx:a[0]+(b[0]-a[0])*f,ny:a[1]+(b[1]-a[1])*f,s };
      };
      // The slab's height at a point of the cross-section (`offset` to the left of the line).
      const heightAt = (P: ReturnType<typeof at>, offset: number) => {
        const px=P.x+P.nx*offset,py=P.y+P.ny*offset;
        // Both cross-sections own the slab height, including a structure transition.
        const next=Math.min(r.kind.length-1,P.k+1),owner=r.owners[P.k];
        // (a road at grade level across — its centre line's height, smooth along it: never the
        // relief's every post under its edges)
        return r.kind[P.k]===0&&r.kind[next]===0?P.z:owner&&r.kind[P.k]>0&&r.kind[next]>0&&r.owners[next]?.id===owner.id?ownerHeight(owner,px,py)+Math.max(0,P.z-ownerHeight(owner,P.x,P.y)):P.z;
      };
      // The asphalt's own height under a point of the paint (s along, `offset` across): on the very
      // triangles band(r, 0, r.width, …, S) lays — the paint asked the deck's profile at its own
      // corners, a few centimetres off the slab's 3 m samples, and stood twisted through it (a
      // dash half under the asphalt: a white wedge).
      const pavedAt = (sAt: number, offset: number) => {
        let q = 0; while (q < cum.length - 2 && cum[q + 1] < sAt) q++;
        const A = at(cum[q]), B = at(cum[q + 1]), W = r.width, n = Math.max(1, Math.ceil(W / rules.step));
        const u0 = ((offset + W / 2) / W) * n, i = Math.max(0, Math.min(n - 1, Math.floor(u0))), u = Math.max(0, Math.min(1, u0 - i));
        const v = Math.max(0, Math.min(1, (sAt - cum[q]) / ((cum[q + 1] - cum[q]) || 1)));
        const h0 = heightAt(A, -W / 2 + (W * i) / n), h1 = heightAt(A, -W / 2 + (W * (i + 1)) / n), h2 = heightAt(B, -W / 2 + (W * i) / n), h3 = heightAt(B, -W / 2 + (W * (i + 1)) / n);
        return u <= v ? h0 + (h3 - h2) * u + (h2 - h0) * v : h0 + (h1 - h0) * u + (h3 - h1) * v;
      };
      const range = (s0: number, s1: number) => {
        const ss = [s0, ...cum.filter(c => c > s0 && c < s1), s1];
        for (let q = 0; q < ss.length - 1; q++) {
          const A0 = at(ss[q]);
          if (skip(A0.k)) continue;
          // (paint: only where it is not on another road's carriageway — paintFree — in steps of
          // at most 1.5 m, each run of free steps one quad)
          if (col) {
            const len = ss[q + 1] - ss[q], n = Math.max(1, Math.ceil(len / 1.5)), k = A0.k;
            const dx = l[k + 1][0] - l[k][0], dy = l[k + 1][1] - l[k][1];
            let from = -1;
            for (let i = 0; i <= n; i++) {
              let ok = false;
              if (i < n) { const P = at(ss[q] + (len * (i + 0.5)) / n); ok = paintFree(r, P.x + P.nx * off, P.y + P.ny * off, P.z, dx, dy); }
              if (ok && from < 0) from = i;
              if (!ok && from >= 0) { quadAt(at(ss[q] + (len * from) / n), at(ss[q] + (len * i) / n)); from = -1; }
            }
            continue;
          }
          quadAt(A0, at(ss[q + 1]));
        }
      };
      const quadAt = (A: ReturnType<typeof at>, B: ReturnType<typeof at>) => {
        {
          const across=out===S?Math.max(1,Math.ceil(w/rules.step)):1;
          for(let strip=0;strip<across;strip++){
          const base = out.p.length / 3;
          for (const P of [A, B]) {
            for(const side of [strip,strip+1]){
              const offset=off-w/2+w*side/across,px=P.x+P.nx*offset,py=P.y+P.ny*offset;
              const h=col?pavedAt(P.s,offset):heightAt(P,offset);
              out.p.push(px,py,h+lift);
              out.level?.push(r.kind[P.k]>0?1:0);
              out.n.push(0, 0, 1);
              if (out.c && col) out.c.push(col[0], col[1], col[2]);
            }
          }
          // (counter-clockwise seen from above: the right edge first, then forward, then the left)
          out.i.push(base, base + 2, base + 3, base, base + 3, base + 1);
          }
        }
      };
      if (!dash) { if (total > 0.05) range(0, total); return; }
      // (dashes placed along the whole road, from its own start: a road cut by the tiles, or
      // split where it changes, keeps one rhythm across the cuts)
      const from = r.id >= 0 && roads[r.id] ? rules.along(roads[r.id].line as unknown as number[][], l[0][0], l[0][1]).along : 0;
      for (let s0 = 2 + dash * Math.ceil((from - 2) / dash) - from; s0 < total - 0.5; s0 += dash) {
        const e0 = Math.min(total, s0 + dash * (dash > 10 ? 0.3 : 0.375));
        if (e0 > Math.max(0, s0) + 0.05) range(Math.max(0, s0), e0);
      }
    };
    // A box (a pier, a slab edge) between two points of the deck, for the structures.
    const quad = (a: number[], b: number[], c: number[], d: number[]) => {
      const base = St.p.length / 3;
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
      for (const p of [a, b, c, d]) { St.p.push(p[0], p[1], p[2]); St.n.push(nx, ny, nz); }
      St.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const pier = (x: number, y: number, z0: number, z1: number, hx: number, hy: number) => {
      const c = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]];
      for (let q = 0; q < 4; q++) {
        const [px, py] = c[q], [qx, qy] = c[(q + 1) % 4];
        quad([x + px, y + py, z0], [x + qx, y + qy, z0], [x + qx, y + qy, z1], [x + px, y + py, z1]);
      }
    };
    const PIER_SPAN = 45;
    // (a point on a road's carriageway at ground level, kerb included)
    const onCarriageway = (x: number, y: number, m: number) => (segAt.get(Math.floor(x / 15) + "," + Math.floor(y / 15)) ?? []).some(([qi, qk]) => {
      const q = pieces[qi]; if (q.kind[qk] !== 0 || q.kind[qk - 1] !== 0) return false;
      const a = q.line[qk - 1], b = q.line[qk], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / l2));
      return Math.hypot(a[0] + ex * t - x, a[1] + ey * t - y) < q.width / 2 + m;
    });
    // (a point on another road's carriageway at about the height z — a ramp merging, the next
    // carriageway where two decks meet: a deck's parapet or sidewalk there stood across its lanes)
    const onOther = (self: Piece, x: number, y: number, z: number) => (segAt.get(Math.floor(x / 15) + "," + Math.floor(y / 15)) ?? []).some(([qi, qk]) => {
      const q = pieces[qi]; if (q === self) return false;
      const a = q.line[qk - 1], b = q.line[qk], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / l2));
      return Math.hypot(a[0] + ex * t - x, a[1] + ey * t - y) < q.width / 2 && Math.abs(q.z[qk - 1] + (q.z[qk] - q.z[qk - 1]) * t - z) < 2.5;
    });
    for (const r of pieces) {
      const w = r.width, lanesN = Math.max(1, r.lanes);
      const under = (k: number) => r.kind[k] < 0 || r.kind[Math.min(r.kind.length - 1, k + 1)] < 0 || r.kind[k]===3 || r.kind[Math.min(r.kind.length-1,k+1)]===3;
      const k1 = (k: number) => Math.min(r.kind.length - 1, k + 1);
      // (no lane lines through a junction)
      // (and nothing on another road's carriageway: paintFree)
      const paintSkip = (k: number) => under(k);
      band(r, 0, w, rules.surfaceLift, S, null, 0, under);
      const twoWay = lanesN >= 2 && !r.oneway;
      const perDir = twoWay ? Math.max(1, Math.floor(lanesN / 2)) : lanesN;
      const laneW = Math.min(3.6, w / Math.max(1, twoWay ? perDir * 2 : perDir));
      // (true to size: 15 cm lines, 3 m dashes in 8 m; broad, for a camera 300 m to 2 km off where a
      // metre is about a pixel: a 1.2 m double centre line, 1 m lane lines in 6 m dashes every 20 m)
      // (true to size only: the broad far-off paint is gone — Mf stays empty)
      for (const [out, k] of [[Mk, 1]] as const) {
        const lift = rules.paintLift + (k > 1 ? 0.02 : 0), far = k > 1;
        if (twoWay && w >= 6) {
          if (far) band(r, 0, 1.2, lift, out, YELLOW, 0, paintSkip);
          else { band(r, 0.12, 0.15, lift, out, YELLOW, 0, paintSkip); band(r, -0.12, 0.15, lift, out, YELLOW, 0, paintSkip); }
        }
        for (let q = 1; q < perDir; q++) for (const side of twoWay ? [1, -1] : [1])
          band(r, side * (twoWay ? q * laneW : q * laneW - (perDir * laneW) / 2), far ? 1.0 : 0.15, lift, out, WHITE, far ? 20 : 8, paintSkip);
        // edge lines on the wider roads
        if (w >= 7) for (const side of [1, -1]) band(r, side * (w / 2 - (far ? 0.6 : 0.35)), far ? 0.8 : 0.15, lift, out, WHITE, 0, paintSkip);
      }
      // Bridges: the slab under the deck's edges, parapets, piers every ~30 m. (Its sidewalks on it:
      // the slab and parapets outside them, as the view's own bridges have them.)
      // (the view's sidewalk width — sceneSidewalk.sidewalkWidth — so a road or a bridge is the same
      // inside the view's square and out of it; a deck always has its sidewalks, as the view's)
      const sw = w >= 8 || r.kind.some(k => k > 0 && k !== 3) ? (w >= 30 ? 5 : w >= 20 ? 4 : w >= 12 ? 3 : 2.25) : 0;
      if (r.kind.some(k => k >= 0)) { clear.push(r.line.length, w / 2 + sw + 1); for (const p of r.line) clear.push(p[0], p[1]); }
      // Each side's parapet: none where its edge lies on another road's lanes (the ramp merging
      // there, the deck alongside — the roads run on into one another, open), nor a stub under
      // 20 m left between such places.
      const open: Record<number, boolean[]> = {};
      for (const side of [-1, 1]) {
        const h = w / 2 + sw + 0.3, f: boolean[] = [];
        for (let k = 0; k < r.line.length - 1; k++) {
          const A = r.line[k], B = r.line[k + 1], na = normalAt(r.line, k), nb = normalAt(r.line, k + 1), za = r.z[k], zb = r.z[k + 1];
          const a0 = [A[0] + na[0] * side * h, A[1] + na[1] * side * h], b0 = [B[0] + nb[0] * side * h, B[1] + nb[1] * side * h];
          f.push(onOther(r, a0[0], a0[1], za) || onOther(r, b0[0], b0[1], zb) || onOther(r, (a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2, (za + zb) / 2));
        }
        for (let k = 0; k < f.length;) {
          if (f[k]) { k++; continue; }
          let e = k, len = 0;
          while (e < f.length && !f[e]) { len += Math.hypot(r.line[e + 1][0] - r.line[e][0], r.line[e + 1][1] - r.line[e][1]); e++; }
          const deck = (q: number) => r.kind[q] > 0 && r.kind[q + 1] > 0;
          // (only a run cut short by another road: a deck's own whole span, however short, keeps them)
          if (len < 20 && ((k > 0 && f[k - 1]) || (e < f.length && f[e])) && Array.from({ length: e - k }, (_, i) => deck(k + i)).some(Boolean)) for (let q = k; q < e; q++) f[q] = true;
          k = e;
        }
        open[side] = f;
      }
      for (let k = 0; k < r.line.length - 1; k++) {
        if (r.kind[k] <= 0 || r.kind[k + 1] <= 0 || r.kind[k] === 3 || r.kind[k + 1] === 3) continue;
        const A = r.line[k], B = r.line[k + 1], na = normalAt(r.line, k), nb = normalAt(r.line, k + 1), za = r.z[k] + rules.surfaceLift, zb = r.z[k + 1] + rules.surfaceLift;
        for (const side of [-1, 1]) {
          const h = w / 2 + sw + 0.3;
          const a0 = [A[0] + na[0] * side * h, A[1] + na[1] * side * h], b0 = [B[0] + nb[0] * side * h, B[1] + nb[1] * side * h];
          const o = side > 0 ? [a0, b0] : [b0, a0], zo = side > 0 ? [za, zb] : [zb, za];
          if (open[side][k]) continue;
          // slab edge (1.4 m deep) and a 1 m parapet
          quad([o[0][0], o[0][1], zo[0] - 1.4], [o[1][0], o[1][1], zo[1] - 1.4], [o[1][0], o[1][1], zo[1] + 1.0], [o[0][0], o[0][1], zo[0] + 1.0]);
          quad([o[1][0], o[1][1], zo[1] + 1.0], [o[0][0], o[0][1], zo[0] + 1.0], [o[0][0] - na[0] * side * 0.3, o[0][1] - na[1] * side * 0.3, zo[0] + 1.0], [o[1][0] - nb[0] * side * 0.3, o[1][1] - nb[1] * side * 0.3, zo[1] + 1.0]);
        }
        // the slab's underside
        const hw = w / 2 + sw + 0.3;
        quad([A[0] - na[0] * hw, A[1] - na[1] * hw, za - 1.4], [B[0] - nb[0] * hw, B[1] - nb[1] * hw, zb - 1.4], [B[0] + nb[0] * hw, B[1] + nb[1] * hw, zb - 1.4], [A[0] + na[0] * hw, A[1] + na[1] * hw, za - 1.4]);
        // Piers at a fixed spacing along the whole official bridge (its chain: the same stations
        // in every tile), standing on the ground or the river bed — never on a road under the deck.
        const owner = r.owners[k], chain = owner && owner.kind === 1 ? chainOf.get(owner.id) : undefined, line = chain?.line ?? owner?.line;
        const sa = line ? rules.along(line, A[0], A[1]).along : k * rules.step, sb = line ? rules.along(line, B[0], B[1]).along : (k + 1) * rules.step;
        if (Math.floor(sa / PIER_SPAN) !== Math.floor(sb / PIER_SPAN)) {
          const f = Math.max(0, Math.min(1, (Math.max(Math.floor(sa / PIER_SPAN), Math.floor(sb / PIER_SPAN)) * PIER_SPAN - sa) / ((sb - sa) || 1)));
          const px = A[0] + (B[0] - A[0]) * f, py = A[1] + (B[1] - A[1]) * f, pz = za + (zb - za) * f, pn = [na[0] + (nb[0] - na[0]) * f, na[1] + (nb[1] - na[1]) * f];
          // one column under a narrow deck, two under a wide one
          const cols = w > 14 ? [-w / 4, w / 4] : [0];
          for (const c of cols) {
            const cx = px + pn[0] * c, cy = py + pn[1] * c, gz = ground(cx, cy);
            if (pz - 1.4 - gz > 2.5 && !onCarriageway(cx, cy, 1.4)) pier(cx, cy, gz - 2, pz - 1.4, 0.9, 0.9);
          }
        }
      }
      // Ground roads have no generated retaining walls. Confirmed bridge chains
      // include their surveyed bank extensions above and use the same spaced
      // piers as the river deck; a smoothed ordinary road never becomes a wall.
      // Sidewalks on the roads of 8 m and up (on a bridge too — not along a tunnel): paving 15 cm
      // over the road, ~15 % of its width (1.8–4 m), a kerb face along the road's edge at grade;
      // their middle lines for the people.
      if (sw > 0) {
        const flat = (k: number) => r.kind[k] !== 0 || r.kind[k1(k)] !== 0 || r.jn[k] || r.jn[k1(k)];
        const paved = (k: number) => r.kind[k] < 0 || r.kind[k1(k)] < 0 || r.kind[k] === 3 || r.kind[k1(k)] === 3 || r.jn[k] || r.jn[k1(k)];
        // (nor over another road's lanes: where a ramp joins, the paving stops)
        const across = (side: number) => (k: number) => {
          if (r.kind[k]===0&&r.kind[k1(k)]===0)return false; // exact asphalt subtraction after generation
          if (paved(k)) return true;
          const o = side * (w / 2 + sw / 2), A = r.line[k], B = r.line[k1(k)], na = normalAt(r.line, k), nb = normalAt(r.line, k1(k));
          return onOther(r, A[0] + na[0] * o, A[1] + na[1] * o, r.z[k]) || onOther(r, B[0] + nb[0] * o, B[1] + nb[1] * o, r.z[k1(k)]);
        };
        band(r, w / 2 + sw / 2, sw, rules.surfaceLift+.15, Wk, null, 0, across(1));
        band(r, -(w / 2 + sw / 2), sw, rules.surfaceLift+.15, Wk, null, 0, across(-1));
        for (const side of [1, -1]) {
          for (let k = 0; k < r.line.length - 1; k++) {
            if (flat(k)||across(side)(k)) continue;
            const A = r.line[k], B = r.line[k + 1], na = normalAt(r.line, k), nb = normalAt(r.line, k + 1), e = w / 2;
            const a = [A[0] + na[0] * side * e, A[1] + na[1] * side * e], b = [B[0] + nb[0] * side * e, B[1] + nb[1] * side * e];
            kerbs.push([...a,r.z[k]+rules.surfaceLift,...b,r.z[k+1]+rules.surfaceLift,-na[0]*side,-na[1]*side,side]);
          }
          // street trees by the kerb, one every ~12 m (one species along a road)
          for (let k = 1; k < r.line.length; k += 2) {
            if (flat(k) || flat(k - 1)) continue;
            const nn = normalAt(r.line, k), o2 = side * (w / 2 + 0.7);
            streetTrees.push(r.line[k][0] + nn[0] * o2, r.line[k][1] + nn[1] * o2, r.id);
          }
          const pts: number[] = [];
          const off = side * (w / 2 + sw * 0.55);
          const flush = () => { if (pts.length >= 4) walkPaths.push(pts.length / 2, ...pts); pts.length = 0; };
          for (let k = 0; k < r.line.length; k++) {
            if (r.kind[k] !== 0) { flush(); continue; }
            const nn = normalAt(r.line, k);
            pts.push(r.line[k][0] + nn[0] * off, r.line[k][1] + nn[1] * off);
          }
          flush();
        }
      }
      // the lanes: right of the centre line forward, left of it backward (right-hand traffic);
      // not along a tunnel (cut there), not on alleys
      if (w < 5) continue;
      const lanePaths: [number, boolean][] = [];
      for (let k = 0; k < perDir; k++) {
        const off = twoWay ? (k + 0.5) * laneW : (k + 0.5) * laneW - (perDir * laneW) / 2;
        lanePaths.push([-off, true]);
        if (twoWay) lanePaths.push([off, false]);
      }
      for (const [off, fwd] of lanePaths) {
        let pts: number[] = [];
        const emit = () => {
          if (pts.length >= 6) {
            if (!fwd) { const rev: number[] = []; for (let k = pts.length - 3; k >= 0; k -= 3) rev.push(pts[k], pts[k + 1], pts[k + 2]); lanes.push(rev.length / 3, w, ...rev); }
            else lanes.push(pts.length / 3, w, ...pts);
          }
          pts = [];
        };
        for (let k = 0; k < r.line.length; k++) {
          if (r.kind[k] < 0 || r.kind[k]===3) { emit(); continue; }
          const nn = normalAt(r.line, k), x = r.line[k][0] + nn[0] * off, y = r.line[k][1] + nn[1] * off;
          const owner=r.owners[k],h=r.kind[k]===0?r.z[k]:owner?ownerHeight(owner,x,y)+Math.max(0,r.z[k]-ownerHeight(owner,r.line[k][0],r.line[k][1])):r.z[k];
          pts.push(x,y,h+rules.surfaceLift);
        }
        emit();
      }
    }
    // The crossings as mapped: where a mapped crossing line meets a road (within its width), zebra
    // stripes the whole way across the carriageway — kerb to kerb, one stripe a metre — 4 m wide
    // along the road; at a signalled one, the stop lines 3 m back on the lanes coming to it.
    const drawn = new Set<string>();
    // the stop lines painted (centre, the direction of the traffic they stop, half their length):
    // the signalled cars stop at these, not somewhere of their own
    const paintedStops: { x: number; y: number; dx: number; dy: number; half: number }[] = [];
    // (mapped as ways across the road, or as nodes on it — the most of them; an unmarked one, none)
    const marks: { mx: number; my: number; signals: boolean }[] = [];
    for (const c of crossings) {
      if ((c.layer ?? 0) !== 0 || c.line.length < 2) continue;
      const pts = c.line.map(([x, y]) => [x + cox, y + coy]);
      // one mark on each carriageway the line goes over (a divided road's two halves both striped:
      // the line's middle alone lay on the median, and one half was left bare)
      let hit = 0;
      for (const r of pieces) {
        if (r.width < 5) continue;
        for (let k = 1; k < r.line.length; k++) {
          if (r.kind[k] !== 0 || r.kind[k - 1] !== 0) continue;
          const A = r.line[k - 1], B = r.line[k];
          for (let q = 1; q < pts.length; q++) {
            const P = pts[q - 1], Q = pts[q];
            const den = (B[0] - A[0]) * (Q[1] - P[1]) - (B[1] - A[1]) * (Q[0] - P[0]);
            if (Math.abs(den) < 1e-9) continue;
            const u = ((P[0] - A[0]) * (Q[1] - P[1]) - (P[1] - A[1]) * (Q[0] - P[0])) / den;
            const v = ((P[0] - A[0]) * (B[1] - A[1]) - (P[1] - A[1]) * (B[0] - A[0])) / den;
            if (u < 0 || u > 1 || v < -0.15 || v > 1.15) continue;
            marks.push({ mx: A[0] + (B[0] - A[0]) * u, my: A[1] + (B[1] - A[1]) * u, signals: c.signals });
            hit++;
          }
        }
      }
      if (!hit) marks.push({ mx: pts.reduce((a, p) => a + p[0], 0) / pts.length, my: pts.reduce((a, p) => a + p[1], 0) / pts.length, signals: c.signals });
    }
    for (const p of crossPoints) if (p.marked !== false) marks.push({ mx: p.at[0] + cox, my: p.at[1] + coy, signals: p.signals });
    // (where the map has nothing for this place, nothing is painted across: no crossing is invented)
    for (const c of marks) {
      const { mx, my } = c;
      if (mx < bx0 || my < by0 || mx >= bx1 || my >= by1) continue;
      // the road it crosses: the nearest centre line within its half width (and 3 m)
      let best: { r: Piece; k: number; t: number; d: number } | null = null;
      for (const r of pieces) {
        if (r.width < 5) continue;
        for (let k = 1; k < r.line.length; k++) {
          if (r.kind[k] !== 0 || r.kind[k - 1] !== 0) continue;
          const a = r.line[k - 1], b = r.line[k], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1;
          const t = Math.max(0, Math.min(1, ((mx - a[0]) * ex + (my - a[1]) * ey) / l2));
          const d = Math.hypot(a[0] + ex * t - mx, a[1] + ey * t - my);
          if (d < r.width / 2 + 3 && (!best || d < best.d)) best = { r, k, t, d };
        }
      }
      if (!best) continue;
      const { r, k, t } = best, a = r.line[k - 1], b = r.line[k], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L, w = r.width;
      const cx = a[0] + (b[0] - a[0]) * t, cy = a[1] + (b[1] - a[1]) * t;
      const key = Math.round(cx / 3) + "," + Math.round(cy / 3);
      if (drawn.has(key)) continue;
      drawn.add(key);
      // The paint's height: 8 cm over the highest asphalt under each corner — this road's surface (its
      // points' heights, as the asphalt is laid, not the bare relief: a stripe on the relief went under
      // the road where it rides a little over it) and any other road's met there.
      const near: [number[], number[], number, number, number, number][] = [];
      for (const o of pieces) {
        const ou = Math.min(6, Math.floor(o.width / 4)) * 0.012;
        for (let q = 1; q < o.line.length; q++) {
          if (o.kind[q] !== 0 || o.kind[q - 1] !== 0) continue;
          const A = o.line[q - 1], B = o.line[q];
          if (Math.min(Math.hypot(A[0] - cx, A[1] - cy), Math.hypot(B[0] - cx, B[1] - cy)) < w + o.width + 20) near.push([A, B, o.z[q - 1], o.z[q], o.width / 2 + 0.5, ou]);
        }
      }
      const paintZ = (px: number, py: number) => {
        let z = ground(px, py) + rules.paintLift;
        for (const [A, B, za, zb, hw, ou] of near) {
          const ex = B[0] - A[0], ey = B[1] - A[1], l2 = ex * ex + ey * ey || 1;
          const f = Math.max(0, Math.min(1, ((px - A[0]) * ex + (py - A[1]) * ey) / l2));
          if (Math.hypot(A[0] + ex * f - px, A[1] + ey * f - py) <= hw) z = Math.max(z, za + (zb - za) * f + rules.paintLift);
        }
        return z;
      };
      for (let o = -w / 2 + 0.5; o <= w / 2 - 0.45; o += 1.0) rect(Mk, cx - dy * o, cy + dx * o, 0, dx, dy, 2.0, 0.25, WHITE, paintZ);
      if (c.signals && w >= 7) {
        const twoWay = r.lanes >= 2;
        for (const dir of twoWay ? [1, -1] : [1]) {
          // coming along +dir: the lanes to the right of the centre line, 3 m short of the stripes
          const sx = cx - dx * dir * 5, sy = cy - dy * dir * 5, half = twoWay ? w / 4 : w / 2, o = twoWay ? -dir * w / 4 : 0;
          rect(Mk, sx - dy * o, sy + dx * o, 0, dx, dy, 0.25, half, WHITE, paintZ);
          paintedStops.push({ x: sx - dy * o, y: sy + dx * o, dx: dx * dir, dy: dy * dir, half });
        }
      }
    }
    const transfer: ArrayBuffer[] = [];
    const arr = (o: { p: number[]; n: number[]; i: number[]; c?: number[];level?:number[] }) => {
      if (!o.i.length) return null;
      const a: any = { position: new Float32Array(o.p), normal: new Float32Array(o.n), index: new Uint32Array(o.i) };
      if (o.c) a.color = new Float32Array(o.c);
      if(o.level)a.level=new Float32Array(o.level);
      return a;
    };
    // The ground cut to the roads: every post of the tile's grid under a road at grade (its kerbs and
    // sidewalks, half a metre more) no higher than the road, 12 cm under it — the road is laid smooth
    // and the relief made to meet it, never the road lifted onto the relief in bumps. Returned: the
    // tile's ground mesh is made from the same cut grid.
    {
      const G = g, n = G.n, x0 = G.ox - G.R, y0 = G.oy - G.R;
      for (const r of pieces) {
        const w = r.width, sw = w >= 8 || r.kind.some(k => k > 0 && k !== 3) ? (w >= 30 ? 5 : w >= 20 ? 4 : w >= 12 ? 3 : 2.25) : 0, half = w / 2 + sw + 0.5;
        for (let k = 1; k < r.line.length; k++) {
          if (r.kind[k - 1] !== 0 || r.kind[k] !== 0) continue;
          const a = r.line[k - 1], b = r.line[k], ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey || 1;
          const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - half - x0) / G.cell)), i1 = Math.min(n - 1, Math.ceil((Math.max(a[0], b[0]) + half - x0) / G.cell));
          const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - half - y0) / G.cell)), j1 = Math.min(n - 1, Math.ceil((Math.max(a[1], b[1]) + half - y0) / G.cell));
          for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const x = x0 + i * G.cell, y = y0 + j * G.cell, t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / L2));
            if (Math.hypot(a[0] + ex * t - x, a[1] + ey * t - y) > half) continue;
            const zr = r.z[k - 1] + (r.z[k] - r.z[k - 1]) * t - 0.12;
            if (G.h[j * n + i] > zr) G.h[j * n + i] = zr;
          }
        }
      }
    }
    const clearance=(self as unknown as {__terrainClearance:ReturnType<typeof terrainSurfaceClearance>}).__terrainClearance;
    const surface=clearance.clipBox(clearance.drape(arr(S),g),box),nearPaint=clearance.clipBox(clearance.drape(arr(Mk),g,rules.paintLift),box),farPaint=clearance.clipBox(clearance.drape(arr(Mf),g,rules.paintLift),box);
    const walks=clearance.drape(arr(Wk),g,.17);
    if(surface&&walks&&kerbs.length){
      const lookup=clearance.index(surface),p=Array.from(walks.position),n=Array.from(walks.normal),idx=Array.from(walks.index),levels=Array.from(walks.level??new Float32Array(p.length/3));
      for(const edge of kerbs){const line=lookup.trace(edge.slice(0,3),edge.slice(3,6));
        for(let k=3;k<line.length;k+=3){const a=line.slice(k-3,k),b=line.slice(k,k+3),base=p.length/3;
          p.push(...a,...b,b[0],b[1],b[2]+.15,a[0],a[1],a[2]+.15);
          for(let j=0;j<4;j++){n.push(edge[6],edge[7],0);levels.push(0);}
          if(edge[8]>0)idx.push(base,base+2,base+1,base,base+3,base+2);else idx.push(base,base+1,base+2,base,base+2,base+3);
        }
      }
      walks.position=new Float32Array(p);walks.normal=new Float32Array(n);walks.index=new Uint32Array(idx);walks.level=new Float32Array(levels);
    }
    const clipPaths=(packed:number[],stride:number,header:number)=>{
      const result:number[]=[];
      for(let k=0;k<packed.length;){const count=packed[k],start=k+header,width=packed[k+1];let run:number[]=[];
        const flush=()=>{if(run.length>=stride*2){result.push(run.length/stride);if(header===2)result.push(width);for(const v of run)result.push(v);}run=[];};
        for(let i=1;i<count;i++){const a=packed.slice(start+(i-1)*stride,start+i*stride),b=packed.slice(start+i*stride,start+(i+1)*stride),hit=rules.clipSegment(a,b,box);
          if(!hit){flush();continue;}
          const at=(t:number)=>a.map((v,j)=>v+(b[j]-v)*t),p=at(hit.lo),q=at(hit.hi);
          if(run.length&&Math.hypot(run[run.length-stride]-p[0],run[run.length-stride+1]-p[1])>1e-5)flush();
          if(!run.length)run.push(...p);run.push(...q);if(hit.hi<1-1e-7)flush();
        }flush();k=start+count*stride;
      }return result;
    };
    const clippedLanes=clipPaths(lanes,3,2);
    let paths=new Float32Array(clippedLanes);
    if(surface){const lookup=clearance.index(surface);clearance.raisePaint(nearPaint,surface,lookup);clearance.raisePaint(farPaint,surface,lookup);
      const corrected:number[]=[];
      for(let k=0;k<clippedLanes.length;){const n=clippedLanes[k],points:number[]=[];for(let i=1;i<n;i++){const at=k+2+i*3,segment=lookup.trace(clippedLanes.slice(at-3,at),clippedLanes.slice(at,at+3));for(let j=i===1?0:3;j<segment.length;j++)points.push(segment[j]);}corrected.push(points.length/3,clippedLanes[k+1]);for(const v of points)corrected.push(v);k+=2+n*3;}paths=new Float32Array(corrected);}
    // Signalled junctions: where OpenStreetMap maps a traffic signal at the junction (when the map
    // answered for this place), else where two roads of 8 m and more cross (the view's own policy,
    // trafficJunction.ts). Two phases: along the widest road, and across it. Each lane gets the
    // stop lines it meets: [m, s, junction, phase, …] lane by lane.
    const junctions: { x: number; y: number; R: number; ax: number; ay: number; wide: Set<number>; aw: number }[] = [];
    for (const c of clusters.values()) {
      if (c.elevated || !c.axis) continue;
      const x = c.x / c.n, y = c.y / c.n;
      let j = junctions.find(o => Math.hypot(o.x - x, o.y - y) < 25);
      if (!j) junctions.push(j = { x, y, R: 0, ax: c.axis[0], ay: c.axis[1], wide: new Set(), aw: 0 });
      j.R = Math.max(j.R, c.r + 1.5, Math.hypot(j.x - x, j.y - y) + c.r);
      if (c.axis[2] > j.aw) { j.ax = c.axis[0]; j.ay = c.axis[1]; j.aw = c.axis[2]; }
      for (const [id, w] of c.roads ?? []) if (w >= 8) j.wide.add(id);
    }
    const sig = junctions.filter(j => mapped ? signalPts.some(([px, py]) => Math.hypot(px + cox - j.x, py + coy - j.y) < j.R + 20) : j.wide.size >= 2);
    const stops: number[] = [];
    for (let k = 0; k < paths.length;) {
      const n = paths[k], at = k + 2, found: number[] = [];
      let s = 0;
      for (let i = 1; i < n; i++) {
        const ax = paths[at + i * 3 - 3], ay = paths[at + i * 3 - 2], bx = paths[at + i * 3], by = paths[at + i * 3 + 1], L = Math.hypot(bx - ax, by - ay);
        for (const j of sig) {
          // entering the junction's disc on this segment (from outside it)
          const da = Math.hypot(ax - j.x, ay - j.y), db = Math.hypot(bx - j.x, by - j.y);
          if (!(da >= j.R && db < j.R) || !L) continue;
          const dx = (bx - ax) / L, dy = (by - ay) / L, fx = ax - j.x, fy = ay - j.y, B = fx * dx + fy * dy, C = fx * fx + fy * fy - j.R * j.R, D = B * B - C;
          const t = D >= 0 ? -B - Math.sqrt(D) : 0, stop = s + Math.max(0, Math.min(L, t)) - 1.5;
          if (stop < 3) continue;
          const id = (Math.round(j.x / 10) & 0xffff) * 65536 + (Math.round(j.y / 10) & 0xffff);
          found.push(stop, id, Math.abs(dx * j.ax + dy * j.ay) > 0.707 ? 0 : 1);
        }
        s += L;
      }
      // A painted stop line across this lane, facing its way: the car stops there. It stands for the
      // junction just beyond it (its stop, worked out from the junction's disc, gives way to it); a
      // signalled crossing between junctions is a junction of its own, one phase.
      s = 0;
      for (let i = 1; i < n; i++) {
        const ax = paths[at + i * 3 - 3], ay = paths[at + i * 3 - 2], bx = paths[at + i * 3], by = paths[at + i * 3 + 1], L = Math.hypot(bx - ax, by - ay);
        if (L < 1e-6) continue;
        const ux = (bx - ax) / L, uy = (by - ay) / L;
        for (const P of paintedStops) {
          if (ux * P.dx + uy * P.dy < 0.7) continue;
          // where the segment meets the line across the road (P ± its half length, square to its traffic)
          const qx = -P.dy, qy = P.dx, den = ux * qy - uy * qx;
          if (Math.abs(den) < 1e-6) continue;
          const t = ((P.x - ax) * qy - (P.y - ay) * qx) / den, u = ((P.x - ax) * uy - (P.y - ay) * ux) / den;
          if (t < 0 || t > L || Math.abs(u) > P.half + 0.3) continue;
          const stop = s + t - 0.2;
          if (stop < 0.5) continue;
          let J: (typeof sig)[number] | null = null, best = Infinity;
          for (const j of sig) {
            const ox = j.x - P.x, oy = j.y - P.y, d = Math.hypot(ox, oy);
            if (d < j.R + 35 && ox * ux + oy * uy > -2 && d < best) { best = d; J = j; }
          }
          const id = J ? (Math.round(J.x / 10) & 0xffff) * 65536 + (Math.round(J.y / 10) & 0xffff) : (Math.round(P.x / 10) & 0xffff) * 65536 + (Math.round(P.y / 10) & 0xffff) + 0x40000000;
          const phase = J ? (Math.abs(ux * J.ax + uy * J.ay) > 0.707 ? 0 : 1) : 0;
          // (the disc's own stop for that junction on this lane gives way to the painted line)
          for (let q = found.length - 3; q >= 0; q -= 3) if (found[q + 1] === id && found[q] > stop - 5 && found[q] < stop + 45) found.splice(q, 3);
          if (!found.some((v, q) => q % 3 === 1 && v === id && Math.abs(found[q - 1] - stop) < 3)) found.push(stop, id, phase);
        }
        s += L;
      }
      const order = Array.from({ length: found.length / 3 }, (_, q) => q).sort((p, q) => found[p * 3] - found[q * 3]);
      stops.push(order.length); for (const q of order) stops.push(found[q * 3], found[q * 3 + 1], found[q * 3 + 2]);
      k += 2 + n * 3;
    }
    // A tunnel's mouth: each end of a 터널 link (-2) where a link not under the ground meets it,
    // its portal and the first metres of the bore; the road in the hill is not drawn. (A link is
    // one direction of travel: the two of an undivided road at one mouth are one portal, as wide as
    // both; a divided road's tubes each their own. Lanes by the road's class: the links carry none.)
    const portal = { concrete: [] as number[], dark: [] as number[] };
    const { __tunnelPortal: tunnelPortal, __portalNormals: portalNormals } = self as unknown as { __tunnelPortal: typeof tunnelPortalShape; __portalNormals: typeof portalNormalsOf };
    {
      const LANES: Record<string, number> = { '고속국도': 3, '도시고속국도': 3, '도시고속도로': 3, '일반국도': 2, '특별·광역시도': 2, '국가지원지방도': 2, '지방도': 1, '시·군도': 1, '구도': 1 };
      const ends = new Map<string, number>(), key = (p: number[]) => Math.round(p[0] / 2) + ',' + Math.round(p[1] / 2);
      for (const l of linkList) if (l.kind >= 0) for (const p of [l.line[0], l.line[l.line.length - 1]])
        for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) ends.set((Math.round(p[0] / 2) + dx) + ',' + (Math.round(p[1] / 2) + dy), 1);
      const mouths: { x: number; y: number; dx: number; dy: number; lanes: number }[] = [];
      for (const l of linkList) {
        if (l.kind !== -2) continue;
        for (const begin of [true, false]) {
          const line = begin ? l.line : [...l.line].reverse(), p = line[0];
          if (!ends.has(key(p)) || p[0] < bx0 || p[0] >= bx1 || p[1] < by0 || p[1] >= by1) continue;
          // (in: the tunnel's line 8 m on)
          let q = 1; while (q < line.length - 1 && Math.hypot(line[q][0] - p[0], line[q][1] - p[1]) < 8) q++;
          const dx = line[q][0] - p[0], dy = line[q][1] - p[1], L = Math.hypot(dx, dy); if (L < 1) continue;
          const lanes = LANES[l.rank] ?? 2, same = mouths.find(m => Math.hypot(m.x - p[0], m.y - p[1]) < 3 && m.dx * dx / L + m.dy * dy / L > .8);
          if (same) same.lanes += lanes; else mouths.push({ x: p[0], y: p[1], dx: dx / L, dy: dy / L, lanes });
        }
      }
      for (const m of mouths) {
        // (the road's own height at the mouth, where it is drawn: else the ground's)
        let z = ground(m.x, m.y), best = 12;
        for (const r of pieces) for (let k = 0; k < r.line.length; k++) {
          if (r.kind[k] !== 0) continue;
          const d = Math.hypot(r.line[k][0] - m.x, r.line[k][1] - m.y); if (d < best) { best = d; z = r.z[k]; }
        }
        tunnelPortal(m.x, m.y, z, m.dx, m.dy, { halfWidth: Math.min(12, m.lanes * 1.65 + 1.2), height: 5.4, length: 30, floor: .02 }, portal);
      }
    }
    // The live traffic layer's bands (droneLive.ts colours them by each link's speed): along each
    // official link of the tile (one direction of travel each), a band to the right of its line —
    // the two directions of a road side by side — on the road's own surface (a bridge's deck, the
    // road at grade), none in a tunnel or an underpass. One vertex attribute names the link.
    const trafficPos: number[] = [], trafficLink: number[] = [], trafficIds: string[] = [], trafficRanks: string[] = [];
    if (e.data.traffic) {
      const zHash = new Map<string, [number, number, number, number][]>();
      for (const r of pieces) for (let k = 0; k < r.line.length; k++) {
        if (r.kind[k] < 0) continue;
        const p = r.line[k]; add(zHash, Math.floor(p[0] / 12) + ',' + Math.floor(p[1] / 12), [p[0], p[1], r.z[k], r.kind[k] > 0 ? 1 : 0]);
      }
      const zAt = (x: number, y: number, raised: boolean) => {
        let best = 16, z: number | null = null, any = 16, za: number | null = null;
        const i = Math.floor(x / 12), j = Math.floor(y / 12);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const q of zHash.get((i + a) + ',' + (j + b)) ?? []) {
          const d = Math.hypot(q[0] - x, q[1] - y);
          if (d < any) { any = d; za = q[2]; }
          if (d < best && (q[3] === 1) === raised) { best = d; z = q[2]; }
        }
        return z ?? (raised ? za : null) ?? ground(x, y);
      };
      const ids = new Map<string, number>();
      for (const l of linkList) {
        if (l.kind < 0 || !l.id) continue;
        const raised = l.kind > 0;
        let index = -1;
        for (let k = 1; k < l.line.length; k++) {
          const a = l.line[k - 1], b = l.line[k], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
          // (each segment in the one tile its middle is in)
          if (mx < bx0 || my < by0 || mx >= bx1 || my >= by1) continue;
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < .5) continue;
          if (index < 0) { index = ids.get(l.id) ?? -1; if (index < 0) { index = trafficIds.length; ids.set(l.id, index); trafficIds.push(l.id); trafficRanks.push(l.rank); } }
          const dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L, rx = dy, ry = -dx, n = Math.max(1, Math.ceil(L / 10));
          for (let s = 0; s < n; s++) {
            const t0 = s / n, t1 = (s + 1) / n;
            const x0 = a[0] + (b[0] - a[0]) * t0, y0 = a[1] + (b[1] - a[1]) * t0, x1 = a[0] + (b[0] - a[0]) * t1, y1 = a[1] + (b[1] - a[1]) * t1;
            const z0 = zAt(x0, y0, raised) + .4, z1 = zAt(x1, y1, raised) + .4;
            const q = [[x0 + rx * .7, y0 + ry * .7, z0], [x0 + rx * 3.3, y0 + ry * 3.3, z0], [x1 + rx * 3.3, y1 + ry * 3.3, z1], [x1 + rx * .7, y1 + ry * .7, z1]];
            for (const v of [q[0], q[1], q[2], q[0], q[2], q[3]]) { trafficPos.push(v[0], v[1], v[2]); trafficLink.push(index); }
          }
        }
      }
    }
    const traffic = trafficPos.length ? { position: new Float32Array(trafficPos), link: new Uint16Array(trafficLink), ids: trafficIds, ranks: trafficRanks } : null;
    if (traffic) transfer.push(traffic.position.buffer as ArrayBuffer, traffic.link.buffer as ArrayBuffer);
    const portalArr = (p: number[]) => p.length ? { position: new Float32Array(p), normal: portalNormals(p), index: Uint32Array.from({ length: p.length / 3 }, (_, i) => i) } : null;
    const portals = { concrete: portalArr(portal.concrete), dark: portalArr(portal.dark) };
    for (const a of [portals.concrete, portals.dark]) if (a) transfer.push(a.position.buffer as ArrayBuffer, a.normal.buffer as ArrayBuffer, a.index.buffer as ArrayBuffer);
    const ownedTrees:number[]=[];for(let k=0;k<streetTrees.length;k+=3)if(streetTrees[k]>=box[0]&&streetTrees[k]<box[2]&&streetTrees[k+1]>=box[1]&&streetTrees[k+1]<box[3])ownedTrees.push(streetTrees[k],streetTrees[k+1],streetTrees[k+2]);
    const out = { surface, marks:nearPaint, marksFar:farPaint, structure: clearance.clipBox(arr(St),box), portals, traffic, walks:clearance.clipBox(walks,box), walkPaths: new Float32Array(clipPaths(walkPaths,2,1)), streetTrees: new Float32Array(ownedTrees), clear: new Float32Array(clear), ground: g.h, junctions: null, lanes: paths, banks:new Float32Array(bankPoints), stops: new Float32Array(stops), signals: sig.length, roads: pieces.length, bridges, ms: performance.now() - t0 };
    for(const a of [out.surface,out.marks,out.marksFar,out.structure,out.walks])if(a)for(const value of Object.values(a))if(value instanceof Float32Array||value instanceof Uint32Array)transfer.push(value.buffer as ArrayBuffer);
    transfer.push(out.lanes.buffer, out.banks.buffer, out.stops.buffer, out.walkPaths.buffer, out.streetTrees.buffer, out.clear.buffer);
    (self as unknown as Worker).postMessage(out, transfer);
    }catch{(self as unknown as Worker).postMessage(null);}
  };
}

/** The live traffic layer (droneLive): its bands are built only while it can be shown. Off: TOPIS
 * answers for few of the standard links, and the national ITS feed does not answer the host. */
export const LIVE_TRAFFIC_BANDS = false;

/** (one Blob URL for the page's lifetime) */
let roadUrl: string | null = null;
/** One tile's roads (box in the view's frame, metres from lat/lon), made in a worker. */
export function roadTile(lat: number, lon: number, key: string, domain: string | null | undefined, box: [number, number, number, number],
  grid: RoadJob["grid"], wide: Grid | null, signal?: AbortSignal, tile?: { lat: number; lon: number },
  extra?: Pick<RoadJob, "sea" | "seaHoles" | "seaLevel" | "deck" | "chains" | "footprints">): Promise<RoadTileResult | null> {
  const kx = Math.cos((lat * Math.PI) / 180) * 111320, ky = 110540, m = 64;
  const q = `BOX(${lon + (box[0] - m) / kx},${lat + (box[1] - m) / ky},${lon + (box[2] + m) / kx},${lat + (box[3] + m) / ky})`;
  const ask = (layer: string, cb: string, n: number) => Array.from({ length: n }, (_, i) => "https://api.vworld.kr/req/data?" + new URLSearchParams({
    service: "data", request: "GetFeature", crs: "EPSG:4326", geometry: "true", attribute: "true",
    key, domain: domain ?? "https://kospimap.com", data: layer, geomFilter: q,
    size: "1000", page: String(i + 1), format: "json", callback: cb,
  }));
  roadUrl ??= URL.createObjectURL(new Blob([`self.__corridors=(${roadCorridorRules.toString()})();self.__roadRules=(${surfaceGeometryRules.toString()})();self.__groundGrade=(${groundRoadGrade.toString()})();self.__approachHeight=(${roadApproachHeight.toString()});self.__terrainClearance=(${terrainSurfaceClearance.toString()})();self.__linkFallback=(${linkFallbackRoads.toString()});self.__chainDecks=(${chainDeckRoads.toString()});self.__tunnelPortal=(${tunnelPortal.toString()});self.__portalNormals=(${portalNormals.toString()});(${roadWorkerMain.toString()})()`], { type: "text/javascript" }));
    // (the crossings asked about the tile's rounded centre, as the view asks: the server's cache)
    const crossings = tile && typeof location !== "undefined" ? (() => {
      const la = +tile.lat.toFixed(4), lo = +tile.lon.toFixed(4);
      return { url: `${location.origin}/api/realestate/crossings?lat=${la.toFixed(4)}&lon=${lo.toFixed(4)}&r=260&v=3`, ox: (lo - lon) * kx, oy: (la - lat) * ky };
    })() : undefined;
    const job: RoadJob = { traffic: LIVE_TRAFFIC_BANDS, urls: ask("LT_L_N3A0020000", "roadCb", 4), linkUrls: ask("LT_L_MOCTLINK", "linkCb", 2), riverUrls: ask("LT_C_WKMSTRM", "riverCb", 1), lat, lon, box, grid, wide, crossings, ...extra };
    return sceneWorkerFresh<RoadTileResult>(roadUrl, () => new Worker(roadUrl!), job, signal);
}
