import type { RealEstateBuildingsResponse } from "../api/client";
import type { Terrain } from "./sceneTerrain";
import {woodlandBeds,WOODLAND_FLOWERS}from'./landscapeDiversity';
import {woodedTerrain}from'./woodlandTerrain';
import { palaceGardens, palaceParcelGarden, palaceGardenCover, paintPalaceGarden, type PalaceGarden, type PalaceGardenPlanting } from './palaceGardens';

/* The ground out to 1 km in its land use (연속지적도 지목), under the 1 km ring of buildings: past
 * the view's own painted square the ground was one plain colour fading into the haze. Each parcel
 * in the colour its registered use gives it, as the near ground paints them (complexScene LAND):
 * road parcels asphalt, parks lawn, schools earth, forest, fields, lots paving; on a river or
 * stream parcel only the channel is water — where the relief lies within 0.7 m of the parcel's
 * lowest ground (its banks, 둔치, stay land); past the relief's reach, the water parcels inset
 * by the banks' width the relief shows nearer in.
 *
 * VWorld answers only JSONP and a 1 km square is ~10 MB of parcels: a worker fetches them
 * (importScripts) and paints them on an OffscreenCanvas; the page receives one picture. Colour in
 * rgb; alpha 1 on land, ½ on water (the ground's shader makes that smooth: it reflects).
 * One self-contained function (a Blob worker): keep its colours in step with complexScene LAND. */

type FarJob = {
  urls: string[]; lat: number; lon: number; half: number; size: number;
  grid: { h: Float32Array; n: number; R: number; cell: number } | null;
  lawn: string; paddy: string;
  landscape?: boolean; nearHalf: number; footprints: [number,number][][];
  roads: {line:[number,number][];width:number}[];
  flowers: readonly string[];
  gardens: PalaceGarden[];
  /** The drone's tiles: the national stream network's water areas (하천망, LT_C_WKMSTRM), filled
   * whole — a channel stays one channel where its parcels' relief rule leaves gaps. */
  riverUrls?: string[];
  /** The drone's tiles: the open water OpenStreetMap maps (lakes, ponds — 석촌호수 is a park's
   * parcel in the cadastre), from the site's /api/realestate/water: rings in metres about the
   * rounded point it was asked at, (ox, oy) from this picture's centre. */
  osmWater?: { url: string; ox: number; oy: number };
  /** the same, already answered (the drone's tile asks it first): rings about this picture's centre */
  osmBody?: { rings?: { ring: [number, number][] }[]; beaches?: { ring: [number, number][] }[]; works?: SeaWork[] } | null;
};

/** A sea work (OpenStreetMap man_made=breakwater, groyne, pier; the site's bundled copy). */
export type SeaWork = { kind: string; closed: boolean; pts: [number, number][] };

function farWorkerMain() {
  self.onmessage = async (e: MessageEvent<FarJob>) => {
    const t0 = performance.now();
    const job = e.data, { lat, lon, half, size: S } = job;
    // (two seconds at most: the drone asked ahead, when the tile was queued)
    const osm: { rings?: { ring: [number, number][] }[]; beaches?: { ring: [number, number][] }[]; works?: { kind: string; closed: boolean; pts: [number, number][] }[] } | null = job.osmBody ? job.osmBody
      : job.osmWater ? await fetch(job.osmWater.url, { signal: AbortSignal.timeout(2000) }).then(r => (r.ok ? r.json() : null)).catch(() => null) : null;
    const kx = Math.cos((lat * Math.PI) / 180) * 111320, ky = 110540;
    const g = job.grid;
    const at = (x: number, y: number) => {
      if (!g) return NaN;
      const gx = (x + g.R) / g.cell, gy = (y + g.R) / g.cell;
      if (gx < 0 || gy < 0 || gx > g.n - 1.001 || gy > g.n - 1.001) return NaN;
      const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j, h = g.h, n = g.n;
      return (h[j * n + i] * (1 - fx) + h[j * n + i + 1] * fx) * (1 - fy) + (h[(j + 1) * n + i] * (1 - fx) + h[(j + 1) * n + i + 1] * fx) * fy;
    };
    const lots = ["#a9a59c", "#b3aea4", "#9e9a92", "#bbb4a7", "#a49e92", "#aeaaa2", "#98958f"];
    const LAND: Record<string, string> = {
      도: "#55585c", 차: "#4b4e52", 주: "#8f8d88", 장: "#8a8a86", 창: "#8e8c87", 철: "#6d655b",
      ...(job.landscape ? {대:job.lawn} : {}), 공: job.lawn, 체: "#5d8744", 원: job.lawn, 묘: job.lawn, 학: "#bfa27a", 임: job.landscape ? "#376a43" : "#46542f", 전: "#86704f", 답: job.paddy,
      과: "#6f7a45", 목: "#77814a", 천: "#6b7a4f", 구: "#6f7a55", 유: "#6b7a4f", 양: "#6b7a4f",
      제: "#7b8a55", 종: "#a8a298", 사: "#9f9888", 수: "#8e8c87", 잡: "#948a78", 광: "#8f877a", 염: "#b9b8b0",
    };
    const WATER = new Set(["천", "구", "유", "양"]);
    // (drawn by the CPU: a GPU-drawn canvas, even a worker's, is run by the browser's GPU process —
    // the page's frames waited behind each batch of parcels)
    const canvas = new OffscreenCanvas(S, S), ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const forestMask = new OffscreenCanvas(S,S),fc=forestMask.getContext('2d',{willReadFrequently:true})!;fc.fillStyle='#fff';
    const X = (x: number) => ((x + half) / (2 * half)) * S, Y = (y: number) => ((half - y) / (2 * half)) * S;
    ctx.fillStyle = job.landscape ? "#4c7846" : lots[0]; ctx.fillRect(0, 0, S, S);
    const water: number[][][] = [];
    const seen = new Set<string>();
    let parcels = 0, i = 0;
    // (where the cadastre has a parcel: the coast's unregistered land — breakwaters, rocks, the
    // strand — is told apart from it below)
    const pm = new OffscreenCanvas(S, S), pmc = pm.getContext("2d", { willReadFrequently: true })!;
    pmc.fillStyle = "#fff";
    const gardens = new Map<string, { plan: PalaceGarden; ctx: OffscreenCanvasRenderingContext2D }>();
    const hard = new OffscreenCanvas(S, S), hc = hard.getContext('2d', { willReadFrequently: true })!;
    hc.fillStyle = '#fff';
    const hardKinds = new Set(['도', '차', '주', '철', '수', ...WATER]);
    const gardenHelpers = self as unknown as { palaceParcelGarden: typeof palaceParcelGarden; palaceGardenCover: typeof palaceGardenCover; paintPalaceGarden: typeof paintPalaceGarden };
    for (const url of job.urls) {
      let body: any = null;
      (self as any).farCb = (b: unknown) => { body = b; };
      try { importScripts(url); } catch { continue; }
      const fs = body?.response?.result?.featureCollection?.features ?? [];
      const last = fs.length < 1000;
      for (const f of fs) {
        const pnu = String(f.properties?.pnu ?? "");
        if (pnu && seen.has(pnu)) continue;
        if (pnu) seen.add(pnu);
        const kind = String(f.properties?.jibun ?? "").trim().slice(-1);
        const geom = f.geometry;
        const polys: number[][][][] = geom?.type === "Polygon" ? [geom.coordinates] : geom?.type === "MultiPolygon" ? geom.coordinates : [];
        for (const poly of polys) {
          const ring = poly[0].map(([x, y]) => [(x - lon) * kx, (y - lat) * ky]);
          if (ring.length < 3) continue;
          ctx.beginPath();
          ring.forEach(([x, y], k) => (k ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
          ctx.closePath();
          ctx.fillStyle = LAND[kind] ?? lots[i++ % lots.length];
          ctx.fill();
          pmc.beginPath(); ring.forEach(([x, y], k) => (k ? pmc.lineTo(X(x), Y(y)) : pmc.moveTo(X(x), Y(y)))); pmc.closePath(); pmc.fill();
          if(job.landscape && kind==='임'){fc.beginPath();ring.forEach(([x,y],k)=>k?fc.lineTo(X(x),Y(y)):fc.moveTo(X(x),Y(y)));fc.closePath();fc.fill();}
          if (WATER.has(kind)) water.push(ring);
          const garden = job.gardens.length ? gardenHelpers.palaceParcelGarden(kind, poly.map(r => r.map(([x,y]) => [(x-lon)*kx, (y-lat)*ky] as [number,number])), job.gardens) : null;
          if (garden) {
            let entry = gardens.get(garden.id);
            if (!entry) {
              const mask = new OffscreenCanvas(S, S);
              entry = { plan: { ...garden, rings: poly.map(r => r.map(([x,y]) => [((x-lon)*kx-garden.x)*garden.scaleX,(y-lat)*ky-garden.y] as [number,number])) }, ctx: mask.getContext('2d', { willReadFrequently: true })! };
              entry.ctx.fillStyle = '#fff'; gardens.set(garden.id, entry);
            }
            entry.ctx.beginPath();
            for (const r of poly) { r.forEach(([x,y],j) => j ? entry!.ctx.lineTo(X((x-lon)*kx),Y((y-lat)*ky)) : entry!.ctx.moveTo(X((x-lon)*kx),Y((y-lat)*ky))); entry.ctx.closePath(); }
            entry.ctx.fill('evenodd');
          }
          if (job.gardens.length && hardKinds.has(kind)) { hc.beginPath(); ring.forEach(([x,y],j) => j ? hc.lineTo(X(x),Y(y)) : hc.moveTo(X(x),Y(y))); hc.closePath(); hc.fill(); }
          parcels++;
        }
      }
      if (last) break;
    }
    // The beaches (OpenStreetMap natural=beach, the parcels under them often unregistered): sand.
    for (const w of osm?.beaches ?? []) {
      if (w.ring.length < 3) continue;
      ctx.beginPath();
      w.ring.forEach(([x, y], k) => { const px = X(x + (job.osmWater?.ox ?? 0)), py = Y(y + (job.osmWater?.oy ?? 0)); if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.closePath(); ctx.fillStyle = "#d9c7a0"; ctx.fill();
    }
    // The channels: inside each water parcel, the ground within 0.7 m of its lowest point
    // (sceneWater's rule); parcels under 300 m² are culverts and slivers. Past the relief's
    // reach, the water parcels (all together: a river is cut into several) inset by the banks'
    // width the relief shows nearer in.
    if (water.length) {
      const img = ctx.getImageData(0, 0, S, S), d = img.data, m = 2 * half / S;
      const mask = new OffscreenCanvas(S, S), mctx = mask.getContext("2d", { willReadFrequently: true })!;
      mctx.fillStyle = "#fff";
      const paint = (o: number) => { d[o * 4] = 31; d[o * 4 + 1] = 61; d[o * 4 + 2] = 73; d[o * 4 + 3] = 128; };
      const all = new Uint8Array(S * S), wet = new Uint8Array(S * S), unknown = new Uint8Array(S * S);
      for (const ring of water) {
        let area = 0;
        for (let k = 0; k < ring.length; k++) { const [x1, y1] = ring[k], [x2, y2] = ring[(k + 1) % ring.length]; area += x1 * y2 - x2 * y1; }
        if (Math.abs(area / 2) < 300) continue;
        const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
        const px0 = Math.max(0, Math.floor(X(Math.min(...xs)))), px1 = Math.min(S - 1, Math.ceil(X(Math.max(...xs))));
        const py0 = Math.max(0, Math.floor(Y(Math.max(...ys)))), py1 = Math.min(S - 1, Math.ceil(Y(Math.min(...ys))));
        // (the parcel drawn on a mask: a pixel test against a river parcel's thousands of
        // vertices, pixel by pixel, would take seconds)
        const bw = px1 - px0 + 1, bh = py1 - py0 + 1;
        if (bw < 1 || bh < 1) continue;
        mctx.clearRect(0, 0, bw, bh);
        mctx.beginPath();
        ring.forEach(([x, y], k) => (k ? mctx.lineTo(X(x) - px0, Y(y) - py0) : mctx.moveTo(X(x) - px0, Y(y) - py0)));
        mctx.closePath(); mctx.fill();
        const md = mctx.getImageData(0, 0, bw, bh).data;
        const cells: number[] = [];
        let low = Infinity;
        for (let py = py0; py <= py1; py++) for (let px = px0; px <= px1; px++) {
          if (md[((py - py0) * bw + (px - px0)) * 4 + 3] < 128) continue;
          const o = py * S + px;
          all[o] = 1;
          const z = at(-half + (px + 0.5) * m, half - (py + 0.5) * m);
          if (!Number.isFinite(z)) { unknown[o] = 1; continue; }
          cells.push(o, z); low = Math.min(low, z);
        }
        for (let k = 0; k < cells.length; k += 2) if (cells[k + 1] <= low + 0.7) wet[cells[k]] = 1;
      }
      // Distance (px) in from the water parcels' edge: chamfer, two passes.
      const dist = new Float32Array(S * S);
      for (let o = 0; o < S * S; o++) dist[o] = all[o] ? 1e6 : 0;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const o = y * S + x; if (!dist[o]) continue;
        let v = dist[o];
        if (x > 0) v = Math.min(v, dist[o - 1] + 1);
        if (y > 0) { v = Math.min(v, dist[o - S] + 1); if (x > 0) v = Math.min(v, dist[o - S - 1] + 1.414); if (x < S - 1) v = Math.min(v, dist[o - S + 1] + 1.414); }
        dist[o] = v;
      }
      for (let y = S - 1; y >= 0; y--) for (let x = S - 1; x >= 0; x--) {
        const o = y * S + x; if (!dist[o]) continue;
        let v = dist[o];
        if (x < S - 1) v = Math.min(v, dist[o + 1] + 1);
        if (y < S - 1) { v = Math.min(v, dist[o + S] + 1); if (x < S - 1) v = Math.min(v, dist[o + S + 1] + 1.414); if (x > 0) v = Math.min(v, dist[o + S - 1] + 1.414); }
        dist[o] = v;
      }
      // The banks' width: how near the edge the water comes (a low percentile: the narrow
      // places); with no relief over any of it, past 35 % of the widest half-width.
      const depth: number[] = [];
      let deep = 0;
      for (let o = 0; o < S * S; o++) {
        if (!all[o]) continue;
        if (dist[o] < 1e6) deep = Math.max(deep, dist[o]);
        if (wet[o]) { paint(o); if (dist[o] < 1e6) depth.push(dist[o]); }
      }
      depth.sort((p, q) => p - q);
      const inset = depth.length >= 40 ? depth[Math.floor(depth.length * 0.1)] : deep * 0.35;
      for (let o = 0; o < S * S; o++) if (unknown[o] && dist[o] >= inset) paint(o);
      ctx.putImageData(img, 0, 0);
    }
    if (job.riverUrls?.length || osm?.rings?.length) {
      const img = ctx.getImageData(0, 0, S, S), d = img.data;
      const mask = new OffscreenCanvas(S, S), mc = mask.getContext("2d", { willReadFrequently: true })!;
      mc.fillStyle = "#fff";
      let any = false;
      for (const w of osm?.rings ?? []) {
        if (w.ring.length < 3) continue;
        mc.beginPath();
        w.ring.forEach(([x, y], k) => { const px = X(x + (job.osmWater?.ox ?? 0)), py = Y(y + (job.osmWater?.oy ?? 0)); if (k) mc.lineTo(px, py); else mc.moveTo(px, py); });
        mc.closePath(); mc.fill(); any = true;
      }
      for (const url of job.riverUrls ?? []) {
        let body: any = null;
        (self as any).riverCb = (b: unknown) => { body = b; };
        try { importScripts(url); } catch { break; }
        const fs = body?.response?.result?.featureCollection?.features ?? [];
        for (const f of fs) {
          const geom = f.geometry;
          const polys: number[][][][] = geom?.type === "Polygon" ? [geom.coordinates] : geom?.type === "MultiPolygon" ? geom.coordinates : [];
          for (const poly of polys) {
            mc.beginPath();
            for (const ring of poly) ring.forEach(([x, y], k) => { const px = X((x - lon) * kx), py = Y((y - lat) * ky); if (k) mc.lineTo(px, py); else mc.moveTo(px, py); });
            mc.fill("evenodd"); any = true;
          }
        }
        if (fs.length < 1000) break;
      }
      if (any) {
        const md = mc.getImageData(0, 0, S, S).data;
        for (let o = 0; o < S * S; o++) if (md[o * 4 + 3] > 127) { d[o * 4] = 31; d[o * 4 + 1] = 61; d[o * 4 + 2] = 73; d[o * 4 + 3] = 128; }
        ctx.putImageData(img, 0, 0);
      }
    }
    // The coast: the land within 28 m of the water that the cadastre has no parcel for (made
    // ground, rocks, the strand) is sand, not lawn — never a tree on it; the breakwaters,
    // groynes and piers are concrete.
    if (osm?.rings?.length || osm?.works?.length) {
      const img = ctx.getImageData(0, 0, S, S), d = img.data, own = pmc.getImageData(0, 0, S, S).data, m = (2 * half) / S;
      const dist = new Float32Array(S * S);
      for (let o = 0; o < S * S; o++) dist[o] = d[o * 4 + 3] === 128 ? 0 : 1e6;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const o = y * S + x; if (!dist[o]) continue;
        let v = dist[o];
        if (x > 0) v = Math.min(v, dist[o - 1] + 1);
        if (y > 0) { v = Math.min(v, dist[o - S] + 1); if (x > 0) v = Math.min(v, dist[o - S - 1] + 1.414); if (x < S - 1) v = Math.min(v, dist[o - S + 1] + 1.414); }
        dist[o] = v;
      }
      for (let y = S - 1; y >= 0; y--) for (let x = S - 1; x >= 0; x--) {
        const o = y * S + x; if (!dist[o]) continue;
        let v = dist[o];
        if (x < S - 1) v = Math.min(v, dist[o + 1] + 1);
        if (y < S - 1) { v = Math.min(v, dist[o + S] + 1); if (x < S - 1) v = Math.min(v, dist[o + S + 1] + 1.414); if (x > 0) v = Math.min(v, dist[o + S - 1] + 1.414); }
        dist[o] = v;
      }
      const band = 28 / m;
      let seed2 = 4271;
      const r2 = () => { seed2 = (seed2 * 16807) % 2147483647; return seed2 / 2147483647; };
      for (let o = 0; o < S * S; o++) {
        if (!dist[o] || dist[o] > band || own[o * 4 + 3] > 127) continue;
        // (wet sand by the water, dry further up, a little mottled)
        const k = Math.min(1, (dist[o] * m) / 8), n = 0.94 + r2() * 0.1;
        d[o * 4] = (163 + 54 * k) * n; d[o * 4 + 1] = (142 + 57 * k) * n; d[o * 4 + 2] = (104 + 56 * k) * n; d[o * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const ox = job.osmWater?.ox ?? 0, oy = job.osmWater?.oy ?? 0;
      ctx.fillStyle = ctx.strokeStyle = "#a6a39c"; ctx.lineJoin = ctx.lineCap = "round";
      for (const w of osm?.works ?? []) {
        if (w.pts.length < 2) continue;
        ctx.beginPath();
        w.pts.forEach(([x, y], k) => { const px = X(x + ox), py = Y(y + oy); if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
        if (w.closed) { ctx.closePath(); ctx.fill(); }
        else { ctx.lineWidth = (w.kind === "breakwater" ? 12 : 6) / m; ctx.stroke(); }
      }
    }
    const planting:import('./complexScene').Planting={trees:[],shrubs:[],flowers:[],grass:[],street:[],groves:[]};
    // Roads and registered footprints remain clear. Water was painted first and its
    // translucent pixels are excluded from the requested palace garden treatment.
    hc.strokeStyle = hc.fillStyle = '#fff'; hc.lineJoin = hc.lineCap = 'round';
    for (const ring of job.footprints) { hc.beginPath(); ring.forEach(([x,y],i) => i ? hc.lineTo(X(x),Y(y)) : hc.moveTo(X(x),Y(y))); hc.closePath(); hc.fill(); hc.lineWidth = 8*S/(2*half); hc.stroke(); }
    for (const road of job.roads) { hc.beginPath(); road.line.forEach(([x,y],i) => i ? hc.lineTo(X(x),Y(y)) : hc.moveTo(X(x),Y(y))); hc.lineWidth = (road.width+6)*S/(2*half); hc.stroke(); }
    const hardPixels = gardens.size ? hc.getImageData(0,0,S,S).data : null;
    const gardenMasks = [...gardens.values()].map(g => ({ ...g, pixels: g.ctx.getImageData(0,0,S,S).data }));
    const gardenPlanting: PalaceGardenPlanting[] = gardenMasks.map(g => gardenHelpers.paintPalaceGarden(ctx,g.pixels,g.plan,S,half,hardPixels,job.nearHalf,gardenHelpers.palaceGardenCover));
    const inGarden = (x:number,y:number) => { const px=Math.floor(X(x)),py=Math.floor(Y(y));return px>=0 && py>=0 && px<S && py<S && gardenMasks.some(g => g.pixels[(py*S+px)*4+3]>127); };
    if(job.landscape){
      // The registered footprints and roads stay clear even when a lot is park-styled.
      const mask=new OffscreenCanvas(S,S),mc=mask.getContext('2d',{willReadFrequently:true})!;
      mc.fillStyle=mc.strokeStyle='#fff';mc.lineJoin=mc.lineCap='round';mc.lineWidth=8*S/(2*half);
      for(const ring of job.footprints){mc.beginPath();ring.forEach(([x,y],i)=>i?mc.lineTo(X(x),Y(y)):mc.moveTo(X(x),Y(y)));mc.closePath();mc.fill();mc.stroke();}
      for(const road of job.roads){mc.beginPath();road.line.forEach(([x,y],i)=>i?mc.lineTo(X(x),Y(y)):mc.moveTo(X(x),Y(y)));mc.lineWidth=(road.width+6)*S/(2*half);mc.stroke();}
      const blocked=mc.getImageData(0,0,S,S).data,paint=ctx.getImageData(0,0,S,S).data,forest=fc.getImageData(0,0,S,S).data;
      let seed=7919;const rnd=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};
      const green=(x:number,y:number)=>{const px=Math.floor(X(x)),py=Math.floor(Y(y));if(px<0||py<0||px>=S||py>=S||inGarden(x,y))return false;const o=(py*S+px)*4;return blocked[o+3]<128 && paint[o+3]>200 && paint[o+1]>paint[o]*1.18 && paint[o+1]>paint[o+2]*1.18;};
      const groves=new Map<string,{pattern:number;points:[number,number][]}>();let parkSeen=0;
      const wooded=(x:number,y:number)=>forest[(Math.floor(Y(y))*S+Math.floor(X(x)))*4+3]>127 || (self as unknown as {woodedTerrain:typeof woodedTerrain}).woodedTerrain(job.grid,x,y);
      for(let y=-half+8;y<half;y+=5.5)for(let x=-half+8;x<half;x+=5.5){
        const px=x+(rnd()-.5)*2.5,py=y+(rnd()-.5)*2.5;
        if(Math.abs(px)<job.nearHalf && Math.abs(py)<job.nearHalf || !green(px,py))continue;
        if(wooded(px,py)){
          const gx=Math.floor(px/24),gy=Math.floor(py/24),key=`${gx}:${gy}`,patch=groves.get(key)??{pattern:Math.abs(gx*31+gy*17)%4,points:[]};
          if(patch.points.length<26)patch.points.push([px,py]);groves.set(key,patch);continue;
        }
        // Park trees are sparse among the dense wooded clusters, evenly spread across the view.
        if(rnd()>.12)continue;
        parkSeen++;
        if(planting.trees.length<1800)planting.trees.push([px,py]);
        else{const pick=Math.floor(rnd()*parkSeen);if(pick<1800)planting.trees[pick]=[px,py];}
        if(planting.shrubs.length<700 && rnd()<.4 && green(px+1,py+1))planting.shrubs.push([px+1,py+1]);
        if(planting.flowers.length<800 && rnd()<.3)for(let i=0;i<3;i++){const fx=px+2+rnd(),fy=py+2+rnd();if(green(fx,fy))planting.flowers.push([fx,fy]);}
      }
      planting.groves=[...groves.values()];
      const woodland=(self as unknown as {woodlandBeds:typeof woodlandBeds}).woodlandBeds(planting.groves,green,7919,job.flowers);
      planting.groves=woodland.groves;planting.woodlandFlowers=woodland.beds;
      // Soil and foliage mottling are baked once, without per-frame noise work.
      ctx.globalAlpha=.14;
      for(let i=0;i<6000;i++){const x=(rnd()*2-1)*half,y=(rnd()*2-1)*half;if(!green(x,y))continue;ctx.fillStyle=i%6===0?'#876a45':i%2?'#64904e':'#315d3c';ctx.beginPath();ctx.ellipse(X(x),Y(y),2+rnd()*4,1+rnd()*3,rnd()*Math.PI,0,Math.PI*2);ctx.fill();}
      ctx.globalAlpha=1;
    }
    planting.woodlandFlowers = [...(planting.woodlandFlowers ?? []), ...gardenPlanting.flatMap(g => g.beds)];
    planting.grass = gardenPlanting.flatMap(g => g.grass);
    const bitmap = canvas.transferToImageBitmap();
    (self as unknown as Worker).postMessage({ bitmap, parcels, planting, gardens: gardenPlanting, ms: performance.now() - t0 }, [bitmap]);
  };
}

let farUrl: string | null = null;
/** The land-use picture of ±half metres round the result's centre (north up), made in a worker. */
export function farGround(data: RealEstateBuildingsResponse, terrain: Terrain, opts: { half: number; size: number; lawn: string; paddy: string; landscape?: boolean; nearHalf?:number; footprints?:[number,number][][]; signal?: AbortSignal; rivers?: boolean; lakes?: boolean;
  /** the water already asked about this picture's centre (osmBody) */
  water?: FarJob["osmBody"] }): Promise<{ bitmap: ImageBitmap; parcels: number; planting:import('./complexScene').Planting; gardens: PalaceGardenPlanting[]; ms: number } | null> {
  if (!data.center || !data.vworld_key || typeof OffscreenCanvas === "undefined") return Promise.resolve(null);
  const { lat, lon } = data.center, H = opts.half;
  const kx = Math.cos((lat * Math.PI) / 180) * 111320, ky = 110540;
  const box = `BOX(${lon - H / kx},${lat - H / ky},${lon + H / kx},${lat + H / ky})`;
  const urls = Array.from({ length: 30 }, (_, i) => "https://api.vworld.kr/req/data?" + new URLSearchParams({
    service: "data", request: "GetFeature", crs: "EPSG:4326", geometry: "true", attribute: "true",
    key: data.vworld_key!, domain: data.vworld_domain ?? "https://kospimap.com", data: "LP_PA_CBND_BUBUN", geomFilter: box,
    size: "1000", page: String(i + 1), format: "json", callback: "farCb",
  }));
  // (one Blob URL for the page's lifetime: the drone makes these tile after tile)
  farUrl ??= URL.createObjectURL(new Blob([`self.woodedTerrain=(${woodedTerrain.toString()});self.woodlandBeds=(${woodlandBeds.toString()});self.palaceParcelGarden=(${palaceParcelGarden.toString()});self.palaceGardenCover=(${palaceGardenCover.toString()});self.paintPalaceGarden=(${paintPalaceGarden.toString()});(${farWorkerMain.toString()})()`], { type: "text/javascript" }));
  const worker = new Worker(farUrl);
  const job: FarJob = { urls, lat, lon, half: H, size: opts.size, grid: terrain.grid ? { ...terrain.grid, h: terrain.grid.h.slice() } : null, lawn: opts.lawn, paddy: opts.paddy, landscape:opts.landscape,nearHalf:opts.nearHalf??H,footprints:opts.footprints??[],roads:data.roads??[],flowers:WOODLAND_FLOWERS,gardens:palaceGardens(lat,lon,H),
    riverUrls: opts.rivers ? Array.from({ length: 3 }, (_, i) => "https://api.vworld.kr/req/data?" + new URLSearchParams({
      service: "data", request: "GetFeature", crs: "EPSG:4326", geometry: "true", attribute: "false",
      key: data.vworld_key!, domain: data.vworld_domain ?? "https://kospimap.com", data: "LT_C_WKMSTRM", geomFilter: box,
      size: "1000", page: String(i + 1), format: "json", callback: "riverCb",
    })) : undefined,
    // (asked about the rounded point, as the view asks: the server's cache)
    osmBody: opts.water,
    osmWater: opts.lakes && !opts.water && typeof location !== "undefined" ? (() => {
      const la = +lat.toFixed(4), lo = +lon.toFixed(4);
      return { url: `${location.origin}/api/realestate/water?lat=${la.toFixed(4)}&lon=${lo.toFixed(4)}&r=${Math.round(H * 1.5)}&v=3&fast=1`, ox: (lo - lon) * kx, oy: (la - lat) * ky };
    })() : undefined };
  return new Promise(resolve => {
    worker.onmessage = e => { worker.terminate(); resolve(e.data); };
    worker.onerror = () => { worker.terminate(); resolve(null); };
    opts.signal?.addEventListener("abort", () => { worker.terminate(); resolve(null); });
    worker.postMessage(job);
  });
}
