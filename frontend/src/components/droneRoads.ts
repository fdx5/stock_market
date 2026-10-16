import { sceneWorkerOnce } from "./sceneWorkerPool";
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
import type {RealEstateRoad} from '../api/client';
type Arr = { position: Float32Array; normal: Float32Array; index: Uint32Array;level?:Float32Array };
export type RoadTileResult = {
  surface: Arr | null;
  /** lane paint, true to size and broad (for far off) */
  marks: (Arr & { color: Float32Array }) | null;
  marksFar: (Arr & { color: Float32Array }) | null;
  /** bridge decks' slabs, parapets and piers */
  structure: Arr | null;
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
  /** per lane (in `lanes` order): [m, s, junction, phase, …] — the stop lines of signalled junctions it meets */
  stops: Float32Array; signals: number;
  roads: number; bridges: number; ms: number;
};
type Grid = { h: Float32Array; n: number; R: number; cell: number; ox: number; oy: number };
type RoadJob = {
  urls: string[]; linkUrls: string[]; riverUrls: string[]; lat: number; lon: number; box: [number, number, number, number];
  grid: Grid;
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
  chains?: { ids: string[]; line: number[][]; s: number[]; z: number[]; deck?: { w: number; off: number; lanes: number; twoWay: boolean } }[];
};

function roadWorkerMain() {
  self.onmessage = async (e: MessageEvent<RoadJob>) => {
    try {
    const rules=(self as unknown as {__roadRules:ReturnType<typeof surfaceGeometryRules>}).__roadRules;
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
    type Seg = { ax: number; ay: number; bx: number; by: number; kind: 0 | 1 | 2 | -1;id:string;line:number[][] };
    const segs = new Map<string, Seg[]>();
    const linkList: { id: string; kind: number; rank: string; line: number[][] }[] = [];
    await pages(e.data.linkUrls, "linkCb", f => {
      const t = String(f.properties?.rd_type_h ?? "");
      const kind = t === "교량" ? 1 : t === "고가도로" ? 2 : t === "터널" || t === "지하차도" ? -1 : 0;
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
          if(j>i){spans.push({chain:k,line:pts.slice(i,j+1)});at.push({rec,i0:i,i1:j});}
          i=j+1;
        }
      });
      if(spans.length){
        const {decks,taken}=(self as unknown as {__chainDecks:typeof chainDeckRoads}).__chainDecks(spans,e.data.chains!);
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
          for(const c of cuts){keep(from,c.i0);from=c.i1;}
          keep(from,record.pts.length-1);
        });
        const chainSeg=new Map<string,Seg>();
        for(const d of decks){
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
        prepared.splice(0,prepared.length,...next);
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
    const baseline=(r:RealEstateRoad,x:number,y:number)=>r.profile_line&&r.profile_s&&r.profile_z?rules.profileAt(r.profile_line,r.profile_s,r.profile_z,x,y):r.structure==='bridge'||r.structure==='elevated'?rules.profileHeight(r.profile_line??r.line,x,y,ground,waterAt,(x,y)=>inGrid(g,x,y)||!!wide&&inGrid(wide,x,y),e.data):ground(x,y);
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
      // grid's hollows, a culvert) are filled to the road's ±12 m mean — never lowered under the
      // ground — and where it meets a deck it climbs to it at 6 % at most, never a sheer drop
      // (where the base map's line leaves the official bridge link a few metres early).
      {
        // (the ground under it is cut to the road — the tile's grid, below — so the road is no
        // longer lifted onto each post of the relief: smooth along ±16 m, a filled dip kept filled)
        const g = z.slice(), W = Math.max(1, Math.round(16 / rules.step)), GRADE = 0.06 * rules.step;
        for (let i = 0; i < z.length; i++) {
          if (kind[i] !== 0) continue;
          let sum = 0, n = 0;
          for (let k = Math.max(0, i - W); k <= Math.min(z.length - 1, i + W); k++) if (kind[k] === 0) { sum += g[k]; n++; }
          z[i] = sum / n;
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
              let sag = 0;
              for (let k = i; k <= j; k++) sag = Math.max(sag, z[a] + (z[b] - z[a]) * (k - a) / (b - a) - z[k]);
              if (sag > 2) for (let k = i; k <= j; k++) z[k] = Math.max(z[k], z[a] + (z[b] - z[a]) * (k - a) / (b - a));
            }
            i = j + 1;
          }
        }
        // (a deck whose link ends low — in a dip, short of the bank — is lifted to the road it meets
        // the same way; a deck is never lowered, the landmark bridge's own deck never touched)
        const base = z.slice(), lifts = (from: number, to: number) => kind[to] === 0 ? kind[from] >= 0 && kind[from] !== 3 : kind[to] > 0 && kind[to] !== 3 && (kind[from] === 0 || z[from] > base[from] + 1e-6);
        for (let i = 1; i < z.length; i++) if (lifts(i - 1, i)) z[i] = Math.max(z[i], z[i - 1] - GRADE);
        for (let i = z.length - 2; i >= 0; i--) if (lifts(i + 1, i)) z[i] = Math.max(z[i], z[i + 1] - GRADE);
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
      // cut to the tile
      const normals=rules.miters(pts);
      let run:number[][]=[],runZ:number[]=[],runKind:number[]=[],runOwners:(Seg|null)[]=[],runNormals:number[][]=[];
      const flush = () => {
        if (run.length > 1) pieces.push({ ...r, line:run,z:runZ,kind:runKind,owners:runOwners,normals:runNormals,jn:run.map(()=>false),id:roads.indexOf(r) });
        run=[];runZ=[];runKind=[];runOwners=[];runNormals=[];
      };
      for(let k=1;k<pts.length;k++){
        const hit=rules.clipSegment(pts[k-1],pts[k],box);if(!hit){flush();continue;}
        const push=(p:number[],t:number)=>{run.push(p);runZ.push(z[k-1]+(z[k]-z[k-1])*t);runKind.push(t<.5?kind[k-1]:kind[k]);runOwners.push(t<.5?owners[k-1]:owners[k]);runNormals.push(normals[k-1].map((n,i)=>n+(normals[k][i]-n)*t));};
        if(run.length&&Math.hypot(run[run.length-1][0]-hit.a[0],run[run.length-1][1]-hit.a[1])>1e-5)flush();
        if(!run.length)push(hit.a,hit.lo);push(hit.b,hit.hi);if(hit.hi<1-1e-7)flush();
      }
      flush();
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
    const Wk = { p: [] as number[], n: [] as number[], i: [] as number[] };
    const walkPaths: number[] = [];
    const lanes: number[] = [];
    const WHITE = [0.95, 0.95, 0.93], YELLOW = [0.98, 0.74, 0.1];
    const normalsByLine=new Map(pieces.map(r=>[r.line,r.normals]));
    const normalAt = (l:number[][],k:number)=>normalsByLine.get(l)![k];
    // A band along a piece from s0 to s1 m, offset `off` to the left, `w` wide, `lift` over the road.
    const band = (r: Piece, off: number, w: number, lift: number, out: { p: number[]; n: number[]; i: number[]; c?: number[];level?:number[] }, col: number[] | null, dash: number, skip: (k: number) => boolean) => {
      const l = r.line, cum = [0];
      for (let k = 1; k < l.length; k++) cum.push(cum[k - 1] + Math.hypot(l[k][0] - l[k - 1][0], l[k][1] - l[k - 1][1]));
      const total = cum[cum.length - 1];
      const at = (s: number) => {
        let k = 0; while (k < l.length - 2 && cum[k + 1] < s) k++;
        const f = Math.min(1, Math.max(0, (s - cum[k]) / ((cum[k + 1] - cum[k]) || 1)));
        const a=r.normals[k],b=r.normals[k+1];
        return { x: l[k][0] + (l[k + 1][0] - l[k][0]) * f, y: l[k][1] + (l[k + 1][1] - l[k][1]) * f, z: r.z[k] + (r.z[k + 1] - r.z[k]) * f, k,nx:a[0]+(b[0]-a[0])*f,ny:a[1]+(b[1]-a[1])*f };
      };
      const range = (s0: number, s1: number) => {
        const ss = [s0, ...cum.filter(c => c > s0 && c < s1), s1];
        for (let q = 0; q < ss.length - 1; q++) {
          const A = at(ss[q]), B = at(ss[q + 1]);
          if (skip(A.k)) continue;
          const across=out===S?Math.max(1,Math.ceil(w/rules.step)):1;
          for(let strip=0;strip<across;strip++){
          const base = out.p.length / 3;
          for (const P of [A, B]) {
            for(const side of [strip,strip+1]){
              const offset=off-w/2+w*side/across,px=P.x+P.nx*offset,py=P.y+P.ny*offset;
              // Both cross-sections own the slab height, including a structure transition.
              const next=Math.min(r.kind.length-1,P.k+1),owner=r.owners[P.k];
              // (a road at grade level across — its centre line's height, smooth along it: never the
              // relief's every post under its edges)
              const h=r.kind[P.k]===0&&r.kind[next]===0?P.z:owner&&r.kind[P.k]>0&&r.kind[next]>0&&r.owners[next]?.id===owner.id?ownerHeight(owner,px,py)+Math.max(0,P.z-ownerHeight(owner,P.x,P.y)):P.z;
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
      for (let s0 = 2; s0 < total - 0.5; s0 += dash) range(s0, Math.min(total, s0 + dash * (dash > 10 ? 0.3 : 0.375)));
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
      const paintSkip = (k: number) => under(k) || r.jn[k] || r.jn[k1(k)];
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
      // A road at grade raised over the ground (a bridge's approach laid along its deck, a ramp
      // eased up to it): its embankment's retaining walls down to the ground on both sides, as an
      // approach stands — not a ribbon of road in the air. (Through a junction, or on another
      // road's lanes, none.)
      for (let k = 0; k < r.line.length - 1; k++) {
        const kb = k + 1;
        if (r.kind[k] < 0 || r.kind[kb] < 0 || r.kind[k] === 3 || r.kind[kb] === 3 || (r.kind[k] > 0 && r.kind[kb] > 0) || r.jn[k] || r.jn[kb]) continue;
        const A = r.line[k], B = r.line[kb], na = normalAt(r.line, k), nb = normalAt(r.line, kb);
        const liftA = r.z[k] - ground(A[0], A[1]), liftB = r.z[kb] - ground(B[0], B[1]);
        if (Math.max(liftA, liftB) < 0.6) continue;
        for (const side of [-1, 1]) {
          if (open[side][k]) continue;
          const h = w / 2 + sw + 0.3;
          const a0 = [A[0] + na[0] * side * h, A[1] + na[1] * side * h], b0 = [B[0] + nb[0] * side * h, B[1] + nb[1] * side * h];
          const ga = ground(a0[0], a0[1]), gb = ground(b0[0], b0[1]);
          const ta = ga + Math.max(0, liftA) + rules.surfaceLift + (sw ? 0.15 : 0), tb = gb + Math.max(0, liftB) + rules.surfaceLift + (sw ? 0.15 : 0);
          const o = side > 0 ? [a0, b0] : [b0, a0], top = side > 0 ? [ta, tb] : [tb, ta], bot = side > 0 ? [ga - 0.5, gb - 0.5] : [gb - 0.5, ga - 0.5];
          quad([o[0][0], o[0][1], bot[0]], [o[1][0], o[1][1], bot[1]], [o[1][0], o[1][1], top[1] + 0.6], [o[0][0], o[0][1], top[0] + 0.6]);
          quad([o[1][0], o[1][1], top[1] + 0.6], [o[0][0], o[0][1], top[0] + 0.6], [o[0][0] - na[0] * side * 0.3, o[0][1] - na[1] * side * 0.3, top[0] + 0.6], [o[1][0] - nb[0] * side * 0.3, o[1][1] - nb[1] * side * 0.3, top[1] + 0.6]);
        }
      }
      // Sidewalks on the roads of 8 m and up (on a bridge too — not along a tunnel): paving 15 cm
      // over the road, ~15 % of its width (1.8–4 m), a kerb face along the road's edge at grade;
      // their middle lines for the people.
      if (sw > 0) {
        const flat = (k: number) => r.kind[k] !== 0 || r.kind[k1(k)] !== 0 || r.jn[k] || r.jn[k1(k)];
        const paved = (k: number) => r.kind[k] < 0 || r.kind[k1(k)] < 0 || r.kind[k] === 3 || r.kind[k1(k)] === 3 || r.jn[k] || r.jn[k1(k)];
        // (nor over another road's lanes: where a ramp joins, the paving stops)
        const across = (side: number) => (k: number) => {
          if (paved(k)) return true;
          const o = side * (w / 2 + sw / 2), A = r.line[k], B = r.line[k1(k)], na = normalAt(r.line, k), nb = normalAt(r.line, k1(k));
          return onOther(r, A[0] + na[0] * o, A[1] + na[1] * o, r.z[k]) || onOther(r, B[0] + nb[0] * o, B[1] + nb[1] * o, r.z[k1(k)]);
        };
        band(r, w / 2 + sw / 2, sw, rules.surfaceLift+.15, Wk, null, 0, across(1));
        band(r, -(w / 2 + sw / 2), sw, rules.surfaceLift+.15, Wk, null, 0, across(-1));
        for (const side of [1, -1]) {
          for (let k = 0; k < r.line.length - 1; k++) {
            if (flat(k)) continue;
            const A = r.line[k], B = r.line[k + 1], na = normalAt(r.line, k), nb = normalAt(r.line, k + 1), e = w / 2;
            const a = [A[0] + na[0] * side * e, A[1] + na[1] * side * e], b = [B[0] + nb[0] * side * e, B[1] + nb[1] * side * e];
            const base = Wk.p.length / 3;
            const lo = [r.z[k]+rules.surfaceLift,r.z[k + 1]+rules.surfaceLift], hi = lo.map(h=>h+.15);
            Wk.p.push(a[0], a[1], lo[0], b[0], b[1], lo[1], b[0], b[1], hi[1], a[0], a[1], hi[0]);
            for (let q = 0; q < 4; q++) Wk.n.push(-na[0] * side, -na[1] * side, 0);
            if (side > 0) Wk.i.push(base, base + 2, base + 1, base, base + 3, base + 2); else Wk.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
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
    const surface=clearance.drape(arr(S),g),nearPaint=clearance.drape(arr(Mk),g,rules.paintLift),farPaint=clearance.drape(arr(Mf),g,rules.paintLift);
    let paths=new Float32Array(lanes);
    if(surface){const lookup=clearance.index(surface);clearance.raisePaint(nearPaint,surface,lookup);clearance.raisePaint(farPaint,surface,lookup);
      const corrected:number[]=[];
      for(let k=0;k<lanes.length;){const n=lanes[k],points:number[]=[];for(let i=1;i<n;i++){const at=k+2+i*3,segment=lookup.trace(lanes.slice(at-3,at),lanes.slice(at,at+3));for(let j=i===1?0:3;j<segment.length;j++)points.push(segment[j]);}corrected.push(points.length/3,lanes[k+1]);for(const v of points)corrected.push(v);k+=2+n*3;}paths=new Float32Array(corrected);}
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
      const order = Array.from({ length: found.length / 3 }, (_, q) => q).sort((p, q) => found[p * 3] - found[q * 3]);
      stops.push(order.length); for (const q of order) stops.push(found[q * 3], found[q * 3 + 1], found[q * 3 + 2]);
      k += 2 + n * 3;
    }
    const out = { surface, marks:nearPaint, marksFar:farPaint, structure: arr(St), walks: arr(Wk), walkPaths: new Float32Array(walkPaths), streetTrees: new Float32Array(streetTrees), clear: new Float32Array(clear), ground: g.h, junctions: null, lanes: paths, stops: new Float32Array(stops), signals: sig.length, roads: pieces.length, bridges, ms: performance.now() - t0 };
    for(const a of [out.surface,out.marks,out.marksFar,out.structure,out.walks])if(a)for(const value of Object.values(a))if(value instanceof Float32Array||value instanceof Uint32Array)transfer.push(value.buffer as ArrayBuffer);
    transfer.push(out.lanes.buffer, out.stops.buffer, out.walkPaths.buffer, out.streetTrees.buffer, out.clear.buffer);
    (self as unknown as Worker).postMessage(out, transfer);
    }catch{(self as unknown as Worker).postMessage(null);}
  };
}

/** (one Blob URL for the page's lifetime) */
let roadUrl: string | null = null;
/** One tile's roads (box in the view's frame, metres from lat/lon), made in a worker. */
export function roadTile(lat: number, lon: number, key: string, domain: string | null | undefined, box: [number, number, number, number],
  grid: RoadJob["grid"], wide: Grid | null, signal?: AbortSignal, tile?: { lat: number; lon: number },
  extra?: Pick<RoadJob, "sea" | "seaHoles" | "seaLevel" | "deck" | "chains">): Promise<RoadTileResult | null> {
  const kx = Math.cos((lat * Math.PI) / 180) * 111320, ky = 110540, m = 30;
  const q = `BOX(${lon + (box[0] - m) / kx},${lat + (box[1] - m) / ky},${lon + (box[2] + m) / kx},${lat + (box[3] + m) / ky})`;
  const ask = (layer: string, cb: string, n: number) => Array.from({ length: n }, (_, i) => "https://api.vworld.kr/req/data?" + new URLSearchParams({
    service: "data", request: "GetFeature", crs: "EPSG:4326", geometry: "true", attribute: "true",
    key, domain: domain ?? "https://kospimap.com", data: layer, geomFilter: q,
    size: "1000", page: String(i + 1), format: "json", callback: cb,
  }));
  roadUrl ??= URL.createObjectURL(new Blob([`self.__roadRules=(${surfaceGeometryRules.toString()})();self.__approachHeight=(${roadApproachHeight.toString()});self.__terrainClearance=(${terrainSurfaceClearance.toString()})();self.__linkFallback=(${linkFallbackRoads.toString()});self.__chainDecks=(${chainDeckRoads.toString()});(${roadWorkerMain.toString()})()`], { type: "text/javascript" }));
    // (the crossings asked about the tile's rounded centre, as the view asks: the server's cache)
    const crossings = tile && typeof location !== "undefined" ? (() => {
      const la = +tile.lat.toFixed(4), lo = +tile.lon.toFixed(4);
      return { url: `${location.origin}/api/realestate/crossings?lat=${la.toFixed(4)}&lon=${lo.toFixed(4)}&r=260&v=3`, ox: (lo - lon) * kx, oy: (la - lat) * ky };
    })() : undefined;
    const job: RoadJob = { urls: ask("LT_L_N3A0020000", "roadCb", 4), linkUrls: ask("LT_L_MOCTLINK", "linkCb", 2), riverUrls: ask("LT_C_WKMSTRM", "riverCb", 1), lat, lon, box, grid, wide, crossings, ...extra };
    return sceneWorkerOnce<RoadTileResult>(() => new Worker(roadUrl!), job, signal);
}
