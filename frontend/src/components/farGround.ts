import type { RealEstateBuildingsResponse } from "../api/client";
import type { Terrain } from "./sceneTerrain";

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
};

function farWorkerMain() {
  self.onmessage = (e: MessageEvent<FarJob>) => {
    const t0 = performance.now();
    const job = e.data, { lat, lon, half, size: S } = job;
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
      공: job.lawn, 체: "#5d8744", 원: job.lawn, 묘: job.lawn, 학: "#bfa27a", 임: "#46542f", 전: "#86704f", 답: job.paddy,
      과: "#6f7a45", 목: "#77814a", 천: "#6b7a4f", 구: "#6f7a55", 유: "#6b7a4f", 양: "#6b7a4f",
      제: "#7b8a55", 종: "#a8a298", 사: "#9f9888", 수: "#8e8c87", 잡: "#948a78", 광: "#8f877a", 염: "#b9b8b0",
    };
    const WATER = new Set(["천", "구", "유", "양"]);
    // (drawn by the CPU: a GPU-drawn canvas, even a worker's, is run by the browser's GPU process —
    // the page's frames waited behind each batch of parcels)
    const canvas = new OffscreenCanvas(S, S), ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const X = (x: number) => ((x + half) / (2 * half)) * S, Y = (y: number) => ((half - y) / (2 * half)) * S;
    ctx.fillStyle = lots[0]; ctx.fillRect(0, 0, S, S);
    const water: number[][][] = [];
    const seen = new Set<string>();
    let parcels = 0, i = 0;
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
          if (WATER.has(kind)) water.push(ring);
          parcels++;
        }
      }
      if (last) break;
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
    const bitmap = canvas.transferToImageBitmap();
    (self as unknown as Worker).postMessage({ bitmap, parcels, ms: performance.now() - t0 }, [bitmap]);
  };
}

/** The land-use picture of ±half metres round the result's centre (north up), made in a worker. */
export function farGround(data: RealEstateBuildingsResponse, terrain: Terrain, opts: { half: number; size: number; lawn: string; paddy: string; signal?: AbortSignal }): Promise<{ bitmap: ImageBitmap; parcels: number; ms: number } | null> {
  if (!data.center || !data.vworld_key || typeof OffscreenCanvas === "undefined") return Promise.resolve(null);
  const { lat, lon } = data.center, H = opts.half;
  const kx = Math.cos((lat * Math.PI) / 180) * 111320, ky = 110540;
  const box = `BOX(${lon - H / kx},${lat - H / ky},${lon + H / kx},${lat + H / ky})`;
  const urls = Array.from({ length: 30 }, (_, i) => "https://api.vworld.kr/req/data?" + new URLSearchParams({
    service: "data", request: "GetFeature", crs: "EPSG:4326", geometry: "true", attribute: "true",
    key: data.vworld_key!, domain: data.vworld_domain ?? "https://kospimap.com", data: "LP_PA_CBND_BUBUN", geomFilter: box,
    size: "1000", page: String(i + 1), format: "json", callback: "farCb",
  }));
  const worker = new Worker(URL.createObjectURL(new Blob([`(${farWorkerMain.toString()})()`], { type: "text/javascript" })));
  const job: FarJob = { urls, lat, lon, half: H, size: opts.size, grid: terrain.grid ? { ...terrain.grid, h: terrain.grid.h.slice() } : null, lawn: opts.lawn, paddy: opts.paddy };
  return new Promise(resolve => {
    worker.onmessage = e => { worker.terminate(); resolve(e.data); };
    worker.onerror = () => { worker.terminate(); resolve(null); };
    opts.signal?.addEventListener("abort", () => { worker.terminate(); resolve(null); });
    worker.postMessage(job);
  });
}
