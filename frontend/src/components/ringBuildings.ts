import type { RealEstateBuildingsResponse } from "../api/client";
import type { Terrain } from "./sceneTerrain";
import type { ContextStyle } from "./complexScene";

/* The neighbourhood out to 1 km, after the first frame. The view's own data reaches ~290 m round
 * the complex; past that, every registered building (국토교통부 GIS건물통합정보, as the near ones)
 * is drawn in the same facades. VWorld answers only JSONP — on the page, a page of 1000
 * buildings was ~250 ms of script the main thread had to run — so all of it happens in a worker:
 * the JSONP pages (importScripts), the footprints projected and cleaned, heights from the
 * register, each building extruded on the relief (walls fitted to its storeys, a roof) and the
 * whole ring merged per facade style. The page only makes a few meshes from the arrays.
 *
 * The worker is one self-contained function (no imports: it runs from a Blob, as a classic
 * worker, which importScripts needs). Keep its rules in step with the view's own neighbours:
 * vworldBuildings.fillHeights, complexScene.contextStyle and the tints in ComplexHologram. */

export type RingStyleArrays = { position: Float32Array; normal: Float32Array; uv: Float32Array; color: Float32Array; index: Uint32Array };
export type RingResult = {
  styles: Partial<Record<ContextStyle, RingStyleArrays>>; buildings: number; ms: number;
  /** The ring's apartment blocks (5 storeys and up), six numbers each: centre x, y, height,
   * ground, and where its triangles lie in the apartment mesh's index (start, count) — so a
   * surveyed shape can take its place (ComplexHologram). */
  apts: Float32Array;
};

type RingJob = {
  urls: string[]; lat: number; lon: number; inner: number; outer: number;
  near: Float32Array; seed: number;
  grid: { h: Float32Array; n: number; R: number; cell: number } | null;
  floorM: Record<string, number>;
};

function ringWorkerMain() {
  const SINK = 3, FLOOR_M = 2.9, GROUND_M = 1.5;
  const TINTS = [[0.945, 0.929, 0.894], [0.894, 0.882, 0.855], [0.851, 0.831, 0.792], [0.788, 0.722, 0.643], [0.722, 0.561, 0.471], [0.663, 0.702, 0.733], [0.91, 0.89, 0.827], [0.812, 0.788, 0.741]];
  const CODES: Record<string, string> = { "01": "주택", "02": "공동주택", "03": "근린", "04": "근린", "07": "판매", "09": "의료", "10": "연구", "14": "업무", "15": "숙박", "16": "위락", "13": "운동", "24": "방송" };
  const styleOf = (use: string, height: number, r: number) => {
    const u = /^\d{5}$/.test(use) ? CODES[use.slice(0, 2)] ?? "" : use;
    if (/업무|오피스|방송|연구|의료|숙박/.test(u)) return "office";
    if (/근린|판매|상가|음식|위락|운동/.test(u)) return height > 36 ? "office" : "shop";
    if (/공동주택|아파트/.test(u) && height > 16) return "apt";
    if (/주택|기숙/.test(u)) return height > 24 ? "apt" : "villa";
    return height > 36 ? "office" : r < 0.5 ? "shop" : "villa";
  };
  const rng = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  type Buf = { p: number[]; n: number[]; u: number[]; c: number[]; i: number[] };
  self.onmessage = (e: MessageEvent<RingJob>) => {
    const t0 = performance.now();
    const job = e.data, { lat, lon } = job;
    const kx = Math.cos((lat * Math.PI) / 180) * 111320, ky = 110540;
    // Terrain: the view's own grid (bilinear, clamped at its edge as the view's ground is).
    const g = job.grid;
    const at = (x: number, y: number) => {
      if (!g) return 0;
      const gx = Math.min(g.n - 1.001, Math.max(0, (x + g.R) / g.cell)), gy = Math.min(g.n - 1.001, Math.max(0, (y + g.R) / g.cell));
      const i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j, h = g.h, n = g.n;
      return (h[j * n + i] * (1 - fx) + h[j * n + i + 1] * fx) * (1 - fy) + (h[(j + 1) * n + i] * (1 - fx) + h[(j + 1) * n + i + 1] * fx) * fy;
    };
    // The near buildings (already drawn): their centroids on a 4 m hash.
    const near = new Set<string>();
    for (let k = 0; k < job.near.length; k += 2) near.add(Math.round(job.near[k] / 4) + "," + Math.round(job.near[k + 1] / 4));
    const known = (x: number, y: number) => { const a = Math.round(x / 4), b = Math.round(y / 4); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (near.has(a + i + "," + (b + j))) return true; return false; };
    const bufs: Record<string, Buf> = {};
    const buf = (s: string) => (bufs[s] ??= { p: [], n: [], u: [], c: [], i: [] });
    const rnd = rng(job.seed + 7);
    const seen = new Set<string>();
    const apts: number[] = [];
    let count = 0;
    // All the pages first: a record is judged against the others (vworldBuildings.withoutStrays).
    type Cand = { ring: number[][]; area: number; cx: number; cy: number; d: number; props: any; linked: boolean };
    const cands: Cand[] = [];
    for (const url of job.urls) {
      let body: any = null;
      (self as any).ringCb = (b: unknown) => { body = b; };
      try { importScripts(url); } catch { continue; }
      const fs = body?.response?.result?.featureCollection?.features ?? [];
      // (past the last page VWorld answers with the first again: stop at a short page)
      const last = fs.length < 1000;
      for (const f of fs) {
        const geom = f.geometry, props = f.properties ?? {};
        const polys: number[][][][] = geom?.type === "Polygon" ? [geom.coordinates] : geom?.type === "MultiPolygon" ? geom.coordinates : [];
        for (const poly of polys) {
          const raw = poly[0];
          if (!raw || raw.length < 4) continue;
          const sig = raw[0][0].toFixed(6) + raw[0][1].toFixed(6) + raw.length;
          if (seen.has(sig)) continue;
          seen.add(sig);
          // footprint in metres, closing point and repeats dropped, counter-clockwise
          let ring: number[][] = [];
          for (const [x, y] of raw) { const px = (x - lon) * kx, py = (y - lat) * ky; const l = ring[ring.length - 1]; if (!l || Math.hypot(px - l[0], py - l[1]) > 0.05) ring.push([px, py]); }
          if (ring.length > 2 && Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) < 0.05) ring.pop();
          if (ring.length < 3) continue;
          let area = 0, cx = 0, cy = 0;
          for (let i = 0; i < ring.length; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length]; area += x1 * y2 - x2 * y1; cx += x1; cy += y1; }
          area /= 2; cx /= ring.length; cy /= ring.length;
          if (Math.abs(area) < 12) continue;
          if (area < 0) ring = ring.reverse();
          const d = Math.hypot(cx, cy);
          if (d > job.outer || known(cx, cy) || (d < job.inner && near.size)) continue;
          cands.push({ ring, area: Math.abs(area), cx, cy, d, props, linked: !!props.usability || /^(19|20)\d{2}/.test(props.useapr_day || "") });
        }
      }
      if (last) break;
    }
    // Records not linked to the register (no 용도, no 사용승인일): gone where they lie on a
    // linked one (a second copy), or as needles (8+ storeys on under 10 m² a storey + 40 m²);
    // any 5+ storeys on under 25 m².
    const inRing = (x: number, y: number, r: number[][]) => {
      let hit = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [x1, y1] = r[i], [x2, y2] = r[j]; if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) hit = !hit; }
      return hit;
    };
    const cell = (x: number, y: number) => Math.floor(x / 40) + "," + Math.floor(y / 40);
    const regAt = new Map<string, Cand[]>();
    for (const c of cands) if (c.linked) { const k = cell(c.cx, c.cy); regAt.set(k, [...(regAt.get(k) ?? []), c]); }
    const onLinked = (c: Cand) => {
      const i0 = Math.floor(c.cx / 40), j0 = Math.floor(c.cy / 40);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const r of regAt.get(i0 + i + "," + (j0 + j)) ?? [])
        if (inRing(c.cx, c.cy, r.ring) || inRing(r.cx, r.cy, c.ring)) return true;
      return false;
    };
    for (const { ring, area, cx, cy, props, linked } of cands) {
      const fl = Math.round(parseFloat(props.grnd_flr) || 0);
      if ((fl >= 5 && area < 25) || (!linked && fl >= 8 && area < 10 * fl + 40)) continue;
      if (!linked && onLinked({ ring, area, cx, cy, d: 0, props, linked })) continue;
      // heights as the register gives them (vworldBuildings.fillHeights)
      const hReg = parseFloat(props.height) || 0, fReg = Math.round(parseFloat(props.grnd_flr) || 0);
      let height = hReg, floors = fReg;
      // (a measured height far over the storeys — 404 m for one — is the storeys' height)
      if (height && fReg && height > fReg * 4.5 + 12) height = 0;
      if (height) floors = floors || Math.max(1, Math.round((height - GROUND_M) / FLOOR_M));
      else if (floors) height = Math.round((floors * FLOOR_M + GROUND_M) * 10) / 10;
      else { floors = 2; height = 6.5; }
      if (height < 2.5) continue;
      const style = styleOf(String(props.usability ?? ""), height, rnd());
      const tint = TINTS[Math.floor(rnd() * TINTS.length)].slice();
      const lift = style === "office" ? 0.4 : style === "apt" ? 0.65 : 0;
      for (let k = 0; k < 3; k++) tint[k] += (1 - tint[k]) * lift;
      // on its own ground: the lowest point under it, sunk 3 m (no gap on a slope)
      let ground = Infinity;
      for (const [x, y] of ring) ground = Math.min(ground, at(x, y));
      const depth = Math.max(2, height), bottom = ground - SINK, top = ground + depth;
      const floorM = job.floorM[style] ?? FLOOR_M;
      const kv = Math.min(2, Math.max(0.5, floorM / (depth / Math.max(1, floors))));
      const b = buf(style);
      const iStart = b.i.length;
      // walls: a quad per edge, outward normal, uv as three's world uv (along x or y) with
      // v counting storeys from the ground (ComplexHologram.extrude)
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
        const ex = bx - ax, ey = by - ay, el = Math.hypot(ex, ey) || 1, nx = ey / el, ny = -ex / el;
        const alongX = Math.abs(ey) < Math.abs(ex);
        const base = b.p.length / 3;
        for (const [x, y, z] of [[ax, ay, bottom], [bx, by, bottom], [bx, by, top], [ax, ay, top]]) {
          b.p.push(x, y, z); b.n.push(nx, ny, 0); b.u.push(alongX ? x : y, (1 - (z - ground)) * kv); b.c.push(tint[0], tint[1], tint[2]);
        }
        b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      // roof: ear clipping of the outline (outlines are a few to a few dozen points)
      const base = b.p.length / 3;
      for (const [x, y] of ring) { b.p.push(x, y, top); b.n.push(0, 0, 1); b.u.push(x, y); b.c.push(tint[0], tint[1], tint[2]); }
      const idx = ring.map((_, k) => k);
      const cross = (o: number[], p: number[], q: number[]) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
      let guard = idx.length * idx.length;
      while (idx.length > 3 && guard-- > 0) {
        let cut = false;
        for (let k = 0; k < idx.length; k++) {
          const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
          const A = ring[ia], B = ring[ib], C = ring[ic];
          if (cross(A, B, C) <= 0) continue;
          let inside = false;
          for (const m of idx) {
            if (m === ia || m === ib || m === ic) continue;
            const P = ring[m];
            if (cross(A, B, P) >= 0 && cross(B, C, P) >= 0 && cross(C, A, P) >= 0) { inside = true; break; }
          }
          if (inside) continue;
          b.i.push(base + ia, base + ib, base + ic);
          idx.splice(k, 1); cut = true; break;
        }
        if (!cut) break;
      }
      if (idx.length === 3) b.i.push(base + idx[0], base + idx[1], base + idx[2]);
      if (style === "apt" && floors >= 5) apts.push(cx, cy, height, ground, iStart, b.i.length - iStart);
      count++;
    }
    const styles: Record<string, unknown> = {}, transfer: ArrayBuffer[] = [];
    for (const [s, b] of Object.entries(bufs)) {
      const o = { position: new Float32Array(b.p), normal: new Float32Array(b.n), uv: new Float32Array(b.u), color: new Float32Array(b.c), index: new Uint32Array(b.i) };
      styles[s] = o;
      transfer.push(o.position.buffer, o.normal.buffer, o.uv.buffer, o.color.buffer, o.index.buffer);
    }
    const aptArr = new Float32Array(apts);
    transfer.push(aptArr.buffer);
    (self as unknown as Worker).postMessage({ styles, buildings: count, ms: performance.now() - t0, apts: aptArr }, transfer);
  };
}

/** The ring's buildings (inner < distance ≤ outer from the result's centre, none already drawn —
 * `near`: their centroids), merged per facade style, made in a worker. */
export function ringBuildings(data: RealEstateBuildingsResponse, near: Float32Array, terrain: Terrain, opts: { outer?: number; inner?: number; floorM: Record<string, number>; seed: number; signal?: AbortSignal }): Promise<RingResult | null> {
  if (!data.center || !data.vworld_key) return Promise.resolve(null);
  const { lat, lon } = data.center, outer = opts.outer ?? 1000;
  const kx = Math.cos((lat * Math.PI) / 180) * 111320, ky = 110540;
  const box = `BOX(${lon - outer / kx},${lat - outer / ky},${lon + outer / kx},${lat + outer / ky})`;
  // (pages of 1000; a dense 2 km square holds up to ~15 000 buildings)
  const urls = Array.from({ length: 15 }, (_, i) => "https://api.vworld.kr/req/data?" + new URLSearchParams({
    service: "data", request: "GetFeature", crs: "EPSG:4326", geometry: "true", attribute: "true",
    key: data.vworld_key!, domain: data.vworld_domain ?? "https://kospimap.com", data: "LT_C_BLDGINFO", geomFilter: box,
    size: "1000", page: String(i + 1), format: "json", callback: "ringCb",
  }));
  const src = `(${ringWorkerMain.toString()})()`;
  const worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
  const job: RingJob = {
    urls, lat, lon, inner: opts.inner ?? 0, outer, near, seed: opts.seed,
    grid: terrain.grid ? { ...terrain.grid, h: terrain.grid.h.slice() } : null, floorM: opts.floorM,
  };
  return new Promise(resolve => {
    worker.onmessage = e => { worker.terminate(); resolve(e.data as RingResult); };
    worker.onerror = () => { worker.terminate(); resolve(null); };
    // (another complex chosen meanwhile: the work stops at once)
    opts.signal?.addEventListener("abort", () => { worker.terminate(); resolve(null); });
    worker.postMessage(job);
  });
}
