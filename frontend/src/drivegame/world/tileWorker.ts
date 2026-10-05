/* The drive game's tile builder: everything about one tile made off the page — its data fetched
 * (VWorld 국가기본도 도로중심선 and GIS건물통합정보 as JSONP, which only a classic worker's
 * importScripts can load; VWorld's national DEM; open water from our server), cached in
 * IndexedDB, and turned into arrays the page only wraps: ground and water, asphalt with its
 * junctions, kerbs and sidewalks, road markings, bridges, buildings by facade style and their
 * roofs, lamp and tree positions, footprints and decks to drive into and onto, the full road
 * lines for the traffic, and apartment complexes to deliver to.
 *
 * One self-contained function (no imports): it is started from a Blob as a classic worker.
 * World coordinates out: x east, y up, z = −north, metres from the session's origin. */

export type TileJob = {
  type: "tile"; i: number; j: number; rect: [number, number, number, number];
  lon0: number; lat0: number; lon1: number; lat1: number;
};
export type InitJob = {
  type: "init"; lat: number; lon: number; kx: number; ky: number;
  key: string; domain: string; apiBase: string; version: number;
};
export type MeshArrays = { pos: Float32Array; nor: Float32Array; uv?: Float32Array; col?: Float32Array; index?: Uint32Array };
export type Dest = { name: string; x: number; y: number; floors: number; n: number };
export type RoadLine = { id: string; pts: Float32Array; w: number; lanes: number; major: boolean };
export type TileResult = {
  type: "tile"; key: string; i: number; j: number; ok: boolean; error?: string; ms: number; net: number;
  ground?: { pos: Float32Array; nor: Float32Array; col: Float32Array; index: Uint32Array; nx: number; ny: number; heights: Float32Array; wet: Uint8Array };
  water?: MeshArrays | null;
  asphalt?: MeshArrays | null; walks?: MeshArrays | null; marks?: MeshArrays | null; concrete?: MeshArrays | null;
  styles?: Record<string, MeshArrays>; roofs?: MeshArrays | null;
  lamps?: Float32Array; trees?: Float32Array;
  feet?: { pts: Float32Array; starts: Uint32Array; tops: Float32Array };
  decks?: Float32Array; lines?: RoadLine[]; dests?: Dest[];
  stats?: Record<string, number>;
};

export function tileWorkerMain() {
  const W = self as any;
  const VW_TILE = 36 / 2 ** 13, STEP = 3, SINK = 3, FLOOR_M = 2.9, GROUND_M = 1.5;
  const FLOOR: Record<string, number> = { villa: 2.9, shop: 3.4, office: 3.8, apt: 2.9 };
  const TINTS = [[0.945, 0.929, 0.894], [0.894, 0.882, 0.855], [0.851, 0.831, 0.792], [0.788, 0.722, 0.643], [0.722, 0.561, 0.471], [0.663, 0.702, 0.733], [0.91, 0.89, 0.827], [0.812, 0.788, 0.741]];
  const CODES: Record<string, string> = { "01": "주택", "02": "공동주택", "03": "근린", "04": "근린", "07": "판매", "09": "의료", "10": "연구", "14": "업무", "15": "숙박", "16": "위락", "13": "운동", "24": "방송" };
  let cfg: any = null, token: Promise<string | null> | null = null, h0 = 0;
  let ready: Promise<void> | null = null;

  // ---------- small helpers ----------
  const rngOf = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const hashStr = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 2147483646 + 1; };
  const P = (lon: number, lat: number): [number, number] => [(lon - cfg.lon) * cfg.kx, (lat - cfg.lat) * cfg.ky];
  const inRing = (x: number, y: number, r: number[]) => {
    let hit = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const x1 = r[i], y1 = r[i + 1], x2 = r[j], y2 = r[j + 1];
      if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) hit = !hit;
    }
    return hit;
  };
  const styleOf = (use: string, height: number, r: number) => {
    const u = /^\d{5}$/.test(use) ? CODES[use.slice(0, 2)] ?? "" : use;
    if (/업무|오피스|방송|연구|의료|숙박/.test(u)) return "office";
    if (/근린|판매|상가|음식|위락|운동/.test(u)) return height > 36 ? "office" : "shop";
    if (/공동주택|아파트/.test(u) && height > 16) return "apt";
    if (/주택|기숙/.test(u)) return height > 24 ? "apt" : "villa";
    return height > 36 ? "office" : r < 0.5 ? "shop" : "villa";
  };
  // value noise for the ground's colour (deterministic in world space: tiles meet without seams)
  const hash2 = (x: number, y: number) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  };

  // ---------- storage (IndexedDB, raw data by tile) ----------
  let dbp: Promise<IDBDatabase | null> | null = null;
  const db = () => dbp ??= new Promise(res => {
    try {
      const rq = indexedDB.open("drivegame", 1);
      rq.onupgradeneeded = () => { const d = rq.result; if (!d.objectStoreNames.contains("raw")) d.createObjectStore("raw"); };
      rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null);
    } catch { res(null); }
  });
  const dbGet = async (k: string): Promise<any> => {
    const d = await db(); if (!d) return null;
    return new Promise(res => { try { const rq = d.transaction("raw").objectStore("raw").get(k); rq.onsuccess = () => res(rq.result ?? null); rq.onerror = () => res(null); } catch { res(null); } });
  };
  const dbPut = async (k: string, v: any) => {
    const d = await db(); if (!d) return;
    try { d.transaction("raw", "readwrite").objectStore("raw").put(v, k); } catch { /* (full, or private browsing) */ }
  };

  // ---------- fetching ----------
  let seq = 0;
  /** VWorld's data API as JSONP (it sends no CORS headers): importScripts runs its callback. */
  const jsonp = (params: Record<string, string | number>): any => {
    const name = `__dg${seq++}`;
    let body: any = null;
    W[name] = (b: any) => { body = b; };
    const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), format: "json", callback: name });
    try { W.importScripts(`https://api.vworld.kr/req/data?${q}`); } catch { /* (network) */ }
    delete W[name];
    return body?.response ?? null;
  };
  /** Every page of a layer in a box (VWorld repeats the first page past the last). */
  const pages = (layer: string, box: string, max: number, extra: Record<string, string> = {}) => {
    const out: any[] = [];
    for (let page = 1; page <= max; page++) {
      let r: any = null;
      for (let attempt = 0; attempt < 4 && !r; attempt++) {
        const got = jsonp({ service: "data", request: "GetFeature", crs: "EPSG:4326", geometry: "true", attribute: "true", key: cfg.key, domain: cfg.domain, data: layer, geomFilter: box, size: 1000, page, ...extra });
        if (got?.status === "OK") r = got; else if (got?.status === "NOT_FOUND") return out;
      }
      if (!r) throw new Error("VWorld " + layer);
      const fs = r.result?.featureCollection?.features ?? [];
      out.push(...fs);
      if (fs.length < 1000) break;
    }
    return out;
  };
  const demTiles = new Map<string, Promise<Float32Array | null>>();
  const demTile = async (x: number, y: number) => {
    const k = x + "/" + y;
    let hit = demTiles.get(k);
    if (!hit) {
      hit = (async () => {
        const t = await token;
        if (!t) return null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const host = ["xdworld", "xdworld1", "xdworld2", "xdworld3"][(x + y) % 4];
            const r = await fetch(`https://${host}.vworld.kr/XDServer/3DData?Version=2.0.0.0&Request=GetLayer&Layer=dem&Level=13&IDX=${x}&IDY=${y}&Key=${encodeURIComponent(t)}`, { referrerPolicy: "no-referrer" });
            const b = await r.arrayBuffer();
            if (b.byteLength === 65 * 65 * 4) return new Float32Array(b);
          } catch { /* retry */ }
        }
        return null;
      })();
      demTiles.set(k, hit);
      if (demTiles.size > 600) demTiles.delete(demTiles.keys().next().value!);
    }
    return hit;
  };
  /** DEM tiles covering a lon/lat box, loaded; then heights are synchronous. */
  const ensureDem = async (lo0: number, la0: number, lo1: number, la1: number) => {
    const tx0 = Math.floor((lo0 + 180) / VW_TILE), tx1 = Math.floor((lo1 + 180) / VW_TILE);
    const ty0 = Math.floor((la0 + 90) / VW_TILE), ty1 = Math.floor((la1 + 90) / VW_TILE);
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 120) return;
    const jobs: Promise<unknown>[] = [];
    for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) jobs.push(demTile(x, y).then(t => { if (t) demReady.set(x + "/" + y, t); }));
    await Promise.all(jobs);
  };
  const demReady = new Map<string, Float32Array>();
  /** Absolute elevation (m) at lon/lat; NaN where no tile is loaded. */
  const elev = (lo: number, la: number) => {
    const fx = (lo + 180) / VW_TILE, fy = (la + 90) / VW_TILE, x = Math.floor(fx), y = Math.floor(fy);
    const t = demReady.get(x + "/" + y);
    if (!t) return NaN;
    const u = Math.min(64, Math.max(0, (fx - x) * 64)), v = Math.min(64, Math.max(0, (1 - (fy - y)) * 64));
    const c = Math.min(63, Math.floor(u)), r = Math.min(63, Math.floor(v)), a = u - c, b = v - r;
    return (t[r * 65 + c] * (1 - a) + t[r * 65 + c + 1] * a) * (1 - b) + (t[(r + 1) * 65 + c] * (1 - a) + t[(r + 1) * 65 + c + 1] * a) * b;
  };
  /** Frame height (m over the origin's ground) at a frame point. */
  const ground = (x: number, y: number) => { const e = elev(cfg.lon + x / cfg.kx, cfg.lat + y / cfg.ky); return Number.isFinite(e) ? e - h0 : 0; };

  // ---------- raw data for a tile (cached) ----------
  const RAW_V = 4;  // (raw data only: geometry is made fresh each time)
  const rawFor = async (job: TileJob) => {
    const key = `v${RAW_V}:${job.i}_${job.j}`;
    const kept = await dbGet(key);
    if (kept) return { raw: kept, net: 0 };
    const t0 = performance.now();
    const { lon0, lat0, lon1, lat1 } = job;
    const mLon = 90 / cfg.kx, mLat = 90 / cfg.ky;
    const bFs = pages("LT_C_BLDGINFO", `BOX(${lon0},${lat0},${lon1},${lat1})`, 6);
    const rFs = pages("LT_L_N3A0020000", `BOX(${lon0 - mLon},${lat0 - mLat},${lon1 + mLon},${lat1 + mLat})`, 4);
    const buildings: any[] = [], seen = new Set<string>();
    for (const f of bFs) {
      const g = f.geometry, p = f.properties ?? {};
      const polys: number[][][][] = g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : [];
      for (const poly of polys) {
        const ring = poly[0];
        if (!ring || ring.length < 4) continue;
        const sig = ring[0][0].toFixed(6) + ring[0][1].toFixed(6) + ring.length;
        if (seen.has(sig)) continue;
        seen.add(sig);
        buildings.push({ r: ring.flat(), h: parseFloat(p.height) || 0, f: Math.round(parseFloat(p.grnd_flr) || 0), u: String(p.usability ?? ""),
          n: (p.bld_nm || "").trim(), d: (p.dong_nm || "").trim(), L: !!p.usability || /^(19|20)\d{2}/.test(p.useapr_day || "") });
      }
    }
    const roads: any[] = [], rseen = new Set<string>();
    for (const f of rFs) {
      const p = f.properties ?? {}, g = f.geometry;
      const width = parseFloat(p.rvwd) || 0, lanes = Math.round(parseFloat(p.rdln) || 0);
      if (width < 4 && lanes < 1) continue;
      const lines = g?.type === "LineString" ? [g.coordinates] : g?.type === "MultiLineString" ? g.coordinates : [];
      for (const l of lines as number[][][]) {
        if (l.length < 2) continue;
        const sig = l[0][0].toFixed(7) + l[0][1].toFixed(7) + l[l.length - 1][0].toFixed(7) + l.length;
        if (rseen.has(sig)) continue;
        rseen.add(sig);
        roads.push({ id: sig, l: l.flat(), w: Math.min(60, width || lanes * 3.3), n: Math.max(1, lanes) });
      }
    }
    // open water: the cadastral parcels registered as 하천, 유지 (ponds, reservoirs) and 양어장
    // (VWorld's attribute filter: one query a category — a "|" between conditions means and)
    const water: number[][] = [];
    const wb = `BOX(${lon0 - mLon * 0.6},${lat0 - mLat * 0.6},${lon1 + mLon * 0.6},${lat1 + mLat * 0.6})`;
    for (const cat of ["천", "유", "양"]) {
      for (const f of pages("LP_PA_CBND_BUBUN", wb, 3, { attrFilter: `jibun:like:${cat}` })) {
        if (!new RegExp(cat + "$").test(String(f.properties?.jibun ?? "").trim())) continue;
        const g = f.geometry;
        const polys: number[][][][] = g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : [];
        for (const poly of polys) if (poly[0]?.length > 3) water.push(poly[0].flat());
      }
    }
    const raw = { buildings, roads, water };
    void dbPut(key, raw);
    return { raw, net: performance.now() - t0 };
  };
  const waterJobs = new Map<string, Promise<number[][] | null>>();
  const waterBlock = (bi: number, bj: number) => {
    const k = bi + "_" + bj;
    let hit = waterJobs.get(k);
    if (!hit) {
      hit = (async () => {
        const kept = await dbGet("water:" + k);
        if (kept) return kept as number[][];
        const lat = (bj * 3 + 1.5) * 0.0025, lon = (bi * 3 + 1.5) * 0.003;
        const la = +lat.toFixed(4), lo = +lon.toFixed(4), kx = Math.cos((la * Math.PI) / 180) * 111320, ky = 110540;
        try {
          const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 12000);
          const r = await fetch(`${cfg.apiBase}/realestate/water?lat=${la.toFixed(4)}&lon=${lo.toFixed(4)}&r=560`, { signal: ctl.signal });
          clearTimeout(timer);
          if (!r.ok) return null;
          const body = await r.json();
          const rings = (body.rings ?? []).map((w: any) => (w.ring as number[][]).flatMap(([x, y]) => [lo + x / kx, la + y / ky]));
          void dbPut("water:" + k, rings);
          return rings;
        } catch { return null; }
      })();
      waterJobs.set(k, hit);
      hit.then(v => { if (!v) waterJobs.delete(k); });
    }
    return hit;
  };

  // ---------- building the tile ----------
  type Buf = { p: number[]; n: number[]; u: number[]; c: number[]; i: number[] };
  const newBuf = (): Buf => ({ p: [], n: [], u: [], c: [], i: [] });
  const arrays = (b: Buf, withUv = true, withCol = true): any => b.p.length ? {
    pos: new Float32Array(b.p), nor: new Float32Array(b.n), uv: withUv ? new Float32Array(b.u) : undefined,
    col: withCol ? new Float32Array(b.c) : undefined, index: b.i.length ? new Uint32Array(b.i) : undefined,
  } : null;

  const build = async (job: TileJob): Promise<any> => {
    const t0 = performance.now();
    const { raw, net } = await rawFor(job);
    const [X0, Y0, X1, Y1] = job.rect;
    const owns = (x: number, y: number) => x >= X0 && x < X1 && y >= Y0 && y < Y1;
    const tileSeed = hashStr(job.i + "_" + job.j);
    const rnd = rngOf(tileSeed);
    const stats: Record<string, number> = {};

    // ---- water (frame rings) ----
    const water: { r: number[]; b: [number, number, number, number]; lv: number }[] = [];
    for (const wr of raw.water as number[][]) {
      const r: number[] = [];
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (let k = 0; k < wr.length; k += 2) { const [x, y] = P(wr[k], wr[k + 1]); r.push(x, y); bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
      if (bx1 < X0 - 400 || bx0 > X1 + 400 || by1 < Y0 - 400 || by0 > Y1 + 400) continue;
      water.push({ r, b: [bx0, by0, bx1, by1], lv: NaN });
    }
    // (a river parcel takes in its banks and parks too: water only up to a metre and a half over
    // the lowest ground of the parcel near this tile — its surface)
    if (water.length) {
      await ensureDem(job.lon0 - 0.006, job.lat0 - 0.005, job.lon1 + 0.006, job.lat1 + 0.005);
      for (const w of water) {
        const x0 = Math.max(w.b[0], X0 - 450), x1 = Math.min(w.b[2], X1 + 450), y0 = Math.max(w.b[1], Y0 - 450), y1 = Math.min(w.b[3], Y1 + 450);
        let lo = Infinity;
        for (let y = y0; y <= y1; y += 15) for (let x = x0; x <= x1; x += 15) if (inRing(x, y, w.r)) lo = Math.min(lo, ground(x, y));
        w.lv = lo;
      }
    }
    const wet = (x: number, y: number) => {
      for (const w of water) if (x >= w.b[0] && x <= w.b[2] && y >= w.b[1] && y <= w.b[3] && Number.isFinite(w.lv) && inRing(x, y, w.r) && ground(x, y) < w.lv + 1.5) return true;
      return false;
    };

    // ---- roads: full lines in the frame, resampled every STEP m ----
    type Line = { id: string; xs: number[]; ys: number[]; s: number[]; w: number; lanes: number; major: boolean; h: number[]; nx: number[]; ny: number[]; wet: boolean[] };
    const lines: Line[] = [];
    let lo0 = job.lon0 - 0.004, la0 = job.lat0 - 0.004, lo1 = job.lon1 + 0.004, la1 = job.lat1 + 0.004;
    for (const rd of raw.roads) for (let k = 0; k < rd.l.length; k += 2) { lo0 = Math.min(lo0, rd.l[k]); lo1 = Math.max(lo1, rd.l[k]); la0 = Math.min(la0, rd.l[k + 1]); la1 = Math.max(la1, rd.l[k + 1]); }
    // (a road the box catches may run on for kilometres: heights only within 1.5 km)
    lo0 = Math.max(lo0, job.lon0 - 0.017); lo1 = Math.min(lo1, job.lon1 + 0.017); la0 = Math.max(la0, job.lat0 - 0.0135); la1 = Math.min(la1, job.lat1 + 0.0135);
    await ensureDem(lo0, la0, lo1, la1);
    for (const rd of raw.roads) {
      const xs: number[] = [], ys: number[] = [], s: number[] = [];
      const pts: [number, number][] = [];
      for (let k = 0; k < rd.l.length; k += 2) { const p = P(rd.l[k], rd.l[k + 1]); const q = pts[pts.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) pts.push(p); }
      if (pts.length < 2) continue;
      let acc = 0;
      for (let k = 1; k < pts.length; k++) {
        const [ax, ay] = pts[k - 1], [bx, by] = pts[k], len = Math.hypot(bx - ax, by - ay);
        for (let d = 0; d < len - 1e-6; d += STEP) { xs.push(ax + (bx - ax) * d / len); ys.push(ay + (by - ay) * d / len); s.push(acc + d); }
        acc += len;
      }
      xs.push(pts[pts.length - 1][0]); ys.push(pts[pts.length - 1][1]); s.push(acc);
      const n = xs.length, nx: number[] = [], ny: number[] = [], h: number[] = [], wt: boolean[] = [];
      for (let k = 0; k < n; k++) {
        const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1), dx = xs[b] - xs[a], dy = ys[b] - ys[a], l = Math.hypot(dx, dy) || 1;
        nx.push(-dy / l); ny.push(dx / l);
        h.push(ground(xs[k], ys[k])); wt.push(water.length ? wet(xs[k], ys[k]) : false);
      }
      // Bridges: a run over open water stands on a deck between the banks' heights, well clear of the water.
      for (let k = 0; k < n;) {
        if (!wt[k]) { k++; continue; }
        let e = k; while (e < n && wt[e]) e++;
        const ha = k > 0 ? h[k - 1] : NaN, hb = e < n ? h[e] : NaN;
        let lowest = Infinity; for (let m = k; m < e; m++) lowest = Math.min(lowest, h[m]);
        const top = Math.max(Number.isFinite(ha) ? ha : -Infinity, Number.isFinite(hb) ? hb : -Infinity, lowest + 10);
        // (the deck rises from each bank over 120 m to its height)
        for (let m = k; m < e; m++) {
          const fa = Number.isFinite(ha) ? Math.min(1, (s[m] - s[Math.max(0, k - 1)]) / 120) : 1, fb = Number.isFinite(hb) ? Math.min(1, (s[Math.min(n - 1, e)] - s[m]) / 120) : 1;
          const rise = Math.min(fa, fb), base = Number.isFinite(ha) && Number.isFinite(hb) ? ha + (hb - ha) * ((s[m] - s[k]) / Math.max(1, s[e - 1] - s[k])) : Number.isFinite(ha) ? ha : hb;
          h[m] = Number.isFinite(base) ? base + (top - base) * (rise * rise * (3 - 2 * rise)) : top;
        }
        k = e;
      }
      lines.push({ id: rd.id, xs, ys, s, w: rd.w, lanes: rd.n, major: rd.w >= 8 || rd.n >= 2, h, nx, ny, wet: wt });
    }
    stats.lines = lines.length;

    // junctions: road ends within 6 m are one node; three ends or more a junction; junction nodes
    // within 25 m one intersection
    type End = { li: number; start: boolean; x: number; y: number; hx: number; hy: number; w: number; h: number };
    const ends: End[] = [];
    lines.forEach((L, li) => {
      const n = L.xs.length;
      ends.push({ li, start: true, x: L.xs[0], y: L.ys[0], hx: L.xs[0] - L.xs[1], hy: L.ys[0] - L.ys[1], w: L.w, h: L.h[0] });
      ends.push({ li, start: false, x: L.xs[n - 1], y: L.ys[n - 1], hx: L.xs[n - 1] - L.xs[n - 2], hy: L.ys[n - 1] - L.ys[n - 2], w: L.w, h: L.h[n - 1] });
    });
    const cell = (x: number, y: number) => Math.floor(x / 30) + "," + Math.floor(y / 30);
    const endGrid = new Map<string, number[]>();
    ends.forEach((e, k) => { const c = cell(e.x, e.y); const l = endGrid.get(c); if (l) l.push(k); else endGrid.set(c, [k]); });
    const near = (x: number, y: number, r: number, f: (k: number) => void) => {
      const i0 = Math.floor((x - r) / 30), i1 = Math.floor((x + r) / 30), j0 = Math.floor((y - r) / 30), j1 = Math.floor((y + r) / 30);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const k of endGrid.get(i + "," + j) ?? []) f(k);
    };
    const degree = ends.map(e => { let c = 0; near(e.x, e.y, 6, k => { if (Math.hypot(ends[k].x - e.x, ends[k].y - e.y) < 6) c++; }); return c; });
    // a road end that meets another road's side (a T): the other road's width there
    const segGrid = new Map<string, [number, number][]>();
    lines.forEach((L, li) => { for (let k = 1; k < L.xs.length; k++) { const c = cell((L.xs[k] + L.xs[k - 1]) / 2, (L.ys[k] + L.ys[k - 1]) / 2); const l = segGrid.get(c); if (l) l.push([li, k]); else segGrid.set(c, [[li, k]]); } });
    const sideOf = (x: number, y: number, self: number) => {
      let w = 0;
      const i0 = Math.floor((x - 40) / 30), i1 = Math.floor((x + 40) / 30), j0 = Math.floor((y - 40) / 30), j1 = Math.floor((y + 40) / 30);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const [li, k] of segGrid.get(i + "," + j) ?? []) {
        if (li === self) continue;
        const L = lines[li], ax = L.xs[k - 1], ay = L.ys[k - 1], dx = L.xs[k] - ax, dy = L.ys[k] - ay, l2 = dx * dx + dy * dy || 1;
        const t = ((x - ax) * dx + (y - ay) * dy) / l2;
        if (t < 0 || t > 1) continue;
        if (Math.hypot(x - ax - dx * t, y - ay - dy * t) < L.w / 2 + 1.5) w = Math.max(w, L.w);
      }
      return w;
    };
    /** How far back from each end a road's lines and sidewalks stop (a junction, or a T). */
    const cutOf = ends.map((e, k) => {
      let w = 0, n = 0;
      near(e.x, e.y, 6, m => { if (m !== k && ends[m].li !== e.li && Math.hypot(ends[m].x - e.x, ends[m].y - e.y) < 6) { n++; w = Math.max(w, ends[m].w); } });
      const tee = sideOf(e.x, e.y, e.li);
      return n >= 2 || tee > 0 ? Math.max(w, tee) / 2 + 2 : 0;
    });
    const junction = ends.map((_, k) => degree[k] >= 3 || cutOf[k] > 0);

    // ---- asphalt, junction fills, sidewalks with kerbs, markings, bridges ----
    const asphalt = newBuf(), walks = newBuf(), marks = newBuf(), concrete = newBuf();
    const lamps: number[] = [], trees: number[] = [], decks: number[] = [];
    const quad = (b: Buf, a: number[], bb: number[], c: number[], d: number[], nrm: number[], uvs?: number[][], col?: number[]) => {
      const base = b.p.length / 3;
      for (const [k, v] of [a, bb, c, d].entries()) { b.p.push(v[0], v[1], v[2]); b.n.push(nrm[0], nrm[1], nrm[2]); if (uvs) b.u.push(uvs[k][0], uvs[k][1]); if (col) b.c.push(col[0], col[1], col[2]); }
      b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const W3 = (x: number, y: number, h: number) => [x, h, -y];
    const YELLOW = [0.94, 0.7, 0.04], WHITE = [0.93, 0.93, 0.9];
    // building footprints fetched (all of them, for keeping trees and lamps out)
    const footGrid = new Map<string, number[][]>();
    const feetAll: { r: number[]; cx: number; cy: number; b: any; area: number }[] = [];
    for (const b of raw.buildings) {
      const r: number[] = [];
      for (let k = 0; k < b.r.length; k += 2) { const [x, y] = P(b.r[k], b.r[k + 1]); const n = r.length; if (!n || Math.hypot(x - r[n - 2], y - r[n - 1]) > 0.05) r.push(x, y); }
      if (r.length > 4 && Math.hypot(r[0] - r[r.length - 2], r[1] - r[r.length - 1]) < 0.05) r.splice(r.length - 2, 2);
      if (r.length < 6) continue;
      let area = 0, cx = 0, cy = 0;
      const m = r.length / 2;
      for (let k = 0; k < m; k++) { const x1 = r[k * 2], y1 = r[k * 2 + 1], x2 = r[((k + 1) % m) * 2], y2 = r[((k + 1) % m) * 2 + 1]; area += x1 * y2 - x2 * y1; cx += x1; cy += y1; }
      area /= 2; cx /= m; cy /= m;
      if (Math.abs(area) < 12) continue;
      if (area < 0) { const rr: number[] = []; for (let k = m - 1; k >= 0; k--) rr.push(r[k * 2], r[k * 2 + 1]); r.length = 0; r.push(...rr); }
      const f = { r, cx, cy, b, area: Math.abs(area) };
      feetAll.push(f);
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (let k = 0; k < r.length; k += 2) { bx0 = Math.min(bx0, r[k]); bx1 = Math.max(bx1, r[k]); by0 = Math.min(by0, r[k + 1]); by1 = Math.max(by1, r[k + 1]); }
      for (let i = Math.floor(bx0 / 20); i <= Math.floor(bx1 / 20); i++) for (let j = Math.floor(by0 / 20); j <= Math.floor(by1 / 20); j++) {
        const kk = i + "," + j, l = footGrid.get(kk); if (l) l.push(r); else footGrid.set(kk, [r]);
      }
    }
    const inBuilding = (x: number, y: number) => { for (const r of footGrid.get(Math.floor(x / 20) + "," + Math.floor(y / 20)) ?? []) if (inRing(x, y, r)) return true; return false; };

    lines.forEach((L, li) => {
      const n = L.xs.length, hw = L.w / 2;
      const c0 = cutOf[li * 2], c1 = cutOf[li * 2 + 1], total = L.s[n - 1];
      const at = (sv: number) => {
        let k = 1; while (k < n - 1 && L.s[k] < sv) k++;
        const t = Math.max(0, Math.min(1, (sv - L.s[k - 1]) / ((L.s[k] - L.s[k - 1]) || 1)));
        const nx = L.nx[k - 1] + (L.nx[k] - L.nx[k - 1]) * t, ny = L.ny[k - 1] + (L.ny[k] - L.ny[k - 1]) * t, nl = Math.hypot(nx, ny) || 1;
        return { x: L.xs[k - 1] + (L.xs[k] - L.xs[k - 1]) * t, y: L.ys[k - 1] + (L.ys[k] - L.ys[k - 1]) * t, h: L.h[k - 1] + (L.h[k] - L.h[k - 1]) * t, nx: nx / nl, ny: ny / nl };
      };
      /** A painted strip `w` wide at offset `off` (left +), between sa and sb along the road. */
      const strip = (off: number, w: number, sa: number, sb: number, col: number[], lift = 0.07) => {
        if (sb - sa < 0.05) return;
        for (let sv = sa; sv < sb - 1e-6;) {
          const se = Math.min(sb, sv + STEP), p = at(sv), q = at(se);
          const A = (r: typeof p, side: number) => W3(r.x + r.nx * (off + side * w / 2), r.y + r.ny * (off + side * w / 2), r.h + lift);
          quad(marks, A(p, 1), A(p, -1), A(q, -1), A(q, 1), [0, 1, 0], undefined, col);
          sv = se;
        }
      };
      // sidewalk widths on a major road; none on a bridge's water part
      const sw = !L.major ? 0 : L.w >= 20 ? 4 : L.w >= 12 ? 3 : 2;
      // a side road's mouth along this road (no kerb across it)
      const mouths: [number, number][] = [];
      if (sw) for (let m = 0; m < ends.length; m++) {
        const e = ends[m];
        if (e.li === li || degree[m] >= 3) continue;
        // (near this road's side?)
        let best = Infinity, bs = 0;
        for (let k = 1; k < n; k++) {
          const ax = L.xs[k - 1], ay = L.ys[k - 1], dx = L.xs[k] - ax, dy = L.ys[k] - ay, l2 = dx * dx + dy * dy || 1;
          if (Math.abs(e.x - ax) > hw + 40 || Math.abs(e.y - ay) > hw + 40) continue;
          const t = Math.max(0, Math.min(1, ((e.x - ax) * dx + (e.y - ay) * dy) / l2)), d = Math.hypot(e.x - ax - dx * t, e.y - ay - dy * t);
          if (d < best) { best = d; bs = L.s[k - 1] + t * Math.sqrt(l2); }
        }
        if (best < hw + sw + 2) mouths.push([bs - e.w / 2 - 2, bs + e.w / 2 + 2]);
      }
      const inMouth = (sv: number) => mouths.some(([a, b]) => sv > a && sv < b);
      for (let k = 1; k < n; k++) {
        const mx = (L.xs[k] + L.xs[k - 1]) / 2, my = (L.ys[k] + L.ys[k - 1]) / 2;
        if (!owns(mx, my)) continue;
        const sa = L.s[k - 1], sb = L.s[k];
        const p = { x: L.xs[k - 1], y: L.ys[k - 1], h: L.h[k - 1], nx: L.nx[k - 1], ny: L.ny[k - 1] }, q = { x: L.xs[k], y: L.ys[k], h: L.h[k], nx: L.nx[k], ny: L.ny[k] };
        const E = (r: typeof p, off: number, lift: number) => W3(r.x + r.nx * off, r.y + r.ny * off, r.h + lift);
        const U = (r: typeof p, off: number) => [(r.x + r.nx * off) / 4, (r.y + r.ny * off) / 4];
        // the asphalt (anticlockwise seen from above)
        quad(asphalt, E(p, hw, 0.05), E(p, -hw, 0.05), E(q, -hw, 0.05), E(q, hw, 0.05), [0, 1, 0], [U(p, hw), U(p, -hw), U(q, -hw), U(q, hw)]);
        const overWater = L.wet[k - 1] || L.wet[k];
        if (overWater) {
          decks.push(p.x, p.y, p.h, q.x, q.y, q.h, hw + 0.5);
          // the bridge: deck edges and a parapet each side, the slab under it
          for (const side of [1, -1]) {
            const o = side * (hw + 0.4);
            quad(concrete, E(p, side * hw, 0.05), E(q, side * hw, 0.05), E(q, o, 1.0), E(p, o, 1.0), [p.nx * side, 0.5, -p.ny * side], [[sa / 3, 0], [sb / 3, 0], [sb / 3, 0.3], [sa / 3, 0.3]]);
            quad(concrete, E(p, o, 1.0), E(q, o, 1.0), E(q, o, -1.6), E(p, o, -1.6), [p.nx * side, 0, -p.ny * side], [[sa / 3, 0], [sb / 3, 0], [sb / 3, 0.9], [sa / 3, 0.9]]);
          }
          quad(concrete, E(p, -hw - 0.4, -1.6), E(p, hw + 0.4, -1.6), E(q, hw + 0.4, -1.6), E(q, -hw - 0.4, -1.6), [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
          // piers every 48 m
          if (Math.floor(sb / 48) !== Math.floor(sa / 48)) {
            const g = ground(p.x, p.y) - 4, top = p.h - 1.6;
            for (const off of [-hw * 0.55, hw * 0.55]) {
              const cx = p.x + p.nx * off, cy = p.y + p.ny * off, r = 1.1;
              const c = [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
              for (let e = 0; e < 4; e++) {
                const a = c[e], b = c[(e + 1) % 4], ex = b[0] - a[0], ey = b[1] - a[1], el = Math.hypot(ex, ey);
                quad(concrete, W3(a[0], a[1], g), W3(b[0], b[1], g), W3(b[0], b[1], top), W3(a[0], a[1], top), [ey / el, 0, ex / el], [[0, 0], [1, 0], [1, 4], [0, 4]]);
              }
            }
          }
        }
        // sidewalks: a kerb face and the paving, both sides, cut back at junctions and side roads
        const mid = (sa + sb) / 2;
        if (sw && !overWater && mid > c0 && mid < total - c1 && !inMouth(mid)) {
          for (const side of [1, -1]) {
            const a = side * hw, b = side * (hw + sw);
            quad(walks, E(p, a, 0.05), E(q, a, 0.05), E(q, a, 0.17), E(p, a, 0.17), [-p.nx * side, 0, p.ny * side], [[sa / 2, 0], [sb / 2, 0], [sb / 2, 0.06], [sa / 2, 0.06]]);
            if (side > 0) quad(walks, E(p, a, 0.17), E(p, b, 0.17), E(q, b, 0.17), E(q, a, 0.17), [0, 1, 0], [U(p, a), U(p, b), U(q, b), U(q, a)]);
            else quad(walks, E(p, b, 0.17), E(p, a, 0.17), E(q, a, 0.17), E(q, b, 0.17), [0, 1, 0], [U(p, b), U(p, a), U(q, a), U(q, b)]);
            // trees on a wide sidewalk every 8 m, lamps every 32 m (offset each side)
            const sPhase = side > 0 ? 0 : 16;
            if (Math.floor((sb + sPhase) / 32) !== Math.floor((sa + sPhase) / 32) && L.w >= 10) {
              const r = at(Math.floor((sb + sPhase) / 32) * 32 - sPhase), lx = r.x + r.nx * side * (hw + 0.45), ly = r.y + r.ny * side * (hw + 0.45);
              if (!inBuilding(lx, ly)) lamps.push(lx, ly, r.h + 0.17, Math.atan2(-r.nx * side, -r.ny * side));
            }
            if (sw >= 3 && Math.floor(sb / 8) !== Math.floor(sa / 8) && Math.abs(((Math.floor(sb / 8) * 8 + sPhase) % 32) - 0) > 3) {
              const r = at(Math.floor(sb / 8) * 8), tx = r.x + r.nx * side * (hw + sw * 0.55), ty = r.y + r.ny * side * (hw + sw * 0.55);
              if (!inBuilding(tx, ty) && !wet(tx, ty)) trees.push(tx, ty, r.h + 0.17, 0.8 + rnd() * 0.45, rnd() * Math.PI * 2);
            }
          }
        }
        // markings
        if (L.major && L.w >= 5) {
          const a = Math.max(sa, c0 > 0 ? c0 + 6 : 0), b = Math.min(sb, total - (c1 > 0 ? c1 + 6 : 0));
          if (b > a) {
            if (L.lanes >= 4) { strip(0.17, 0.15, a, b, YELLOW); strip(-0.17, 0.15, a, b, YELLOW); }
            else if (L.lanes >= 2) strip(0, 0.15, a, b, YELLOW);
            if (L.w >= 7) for (const side of [1, -1]) strip(side * (hw - 0.3), 0.15, a, b, WHITE);
            const per = Math.floor(L.lanes / 2), lw = L.w / Math.max(2, L.lanes);
            for (let m = 1; m < per; m++) for (const side of [1, -1]) {
              // (dashes 3 m painted, 5 m bare, by the road's own length: the same on either tile)
              for (let d = Math.floor(a / 8) * 8; d < b; d += 8) strip(side * m * lw, 0.12, Math.max(a, d), Math.min(b, d + 3), WHITE);
            }
          }
          // the stop line and a zebra at a junction end
          for (const [c, atStart] of [[c0, true], [c1, false]] as const) {
            if (c <= 0 || L.w < 8) continue;
            const z0 = atStart ? c : total - c - 4, z1 = z0 + 4;
            for (let off = -hw + 0.8; off <= hw - 0.8; off += 1.0) strip(off, 0.5, Math.max(sa, z0), Math.min(sb, z1), WHITE);
            const st = atStart ? c + 5 : total - c - 5.4;
            strip((atStart ? 1 : -1) * hw / 2, hw - 0.3, Math.max(sa, st), Math.min(sb, st + 0.4), WHITE);
          }
        }
      }
    });
    // junction fills: the hull of the arms' corners, where the intersection's middle is in this tile
    {
      const jn = ends.map((_, k) => k).filter(k => degree[k] >= 3);
      const parent = new Map<number, number>(); jn.forEach(k => parent.set(k, k));
      const find = (k: number): number => { const p = parent.get(k)!; if (p === k) return k; const r = find(p); parent.set(k, r); return r; };
      for (const a of jn) near(ends[a].x, ends[a].y, 25, b => { if (b > a && parent.has(b) && Math.hypot(ends[a].x - ends[b].x, ends[a].y - ends[b].y) < 25) parent.set(find(a), find(b)); });
      const groups = new Map<number, number[]>();
      for (const k of jn) { const r = find(k); const g = groups.get(r); if (g) g.push(k); else groups.set(r, [k]); }
      for (const g of groups.values()) {
        const cx = g.reduce((t, k) => t + ends[k].x, 0) / g.length, cy = g.reduce((t, k) => t + ends[k].y, 0) / g.length;
        if (!owns(cx, cy)) continue;
        const hh = g.reduce((t, k) => t + ends[k].h, 0) / g.length;
        const pts: [number, number][] = [];
        for (const k of g) { const e = ends[k], l = Math.hypot(e.hx, e.hy) || 1, rx = e.hy / l, ry = -e.hx / l, w = e.w / 2; pts.push([e.x + rx * w, e.y + ry * w], [e.x - rx * w, e.y - ry * w]); }
        pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        const lo: [number, number][] = [], hi: [number, number][] = [];
        for (const q of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
        for (let k = pts.length - 1; k >= 0; k--) { const q = pts[k]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
        const hull = lo.slice(0, -1).concat(hi.slice(0, -1));
        if (hull.length < 3) continue;
        const base = asphalt.p.length / 3;
        asphalt.p.push(cx, hh + 0.055, -cy); asphalt.n.push(0, 1, 0); asphalt.u.push(cx / 4, cy / 4);
        for (const [x, y] of hull) { asphalt.p.push(x, hh + 0.055, -y); asphalt.n.push(0, 1, 0); asphalt.u.push(x / 4, y / 4); }
        // (anticlockwise in x, y; seen from above once y is −z)
        for (let k = 0; k < hull.length; k++) asphalt.i.push(base, base + 1 + k, base + 1 + ((k + 1) % hull.length));
      }
    }
    stats.lamps = lamps.length / 4; stats.trees = trees.length / 5;

    /** The road nearest under a point: its height there and how far outside its kerbs (≤ 0 on it). */
    const roadBed = (x: number, y: number) => {
      let best: { h: number; d: number } | null = null;
      const i0 = Math.floor((x - 35) / 30), i1 = Math.floor((x + 35) / 30), j0 = Math.floor((y - 35) / 30), j1 = Math.floor((y + 35) / 30);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const [li, k] of segGrid.get(i + "," + j) ?? []) {
        const L = lines[li];
        if (L.wet[k] || L.wet[k - 1]) continue;
        const ax = L.xs[k - 1], ay = L.ys[k - 1], dx = L.xs[k] - ax, dy = L.ys[k] - ay, l2 = dx * dx + dy * dy || 1e-6;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
        const sw = !L.major ? 0.6 : L.w >= 20 ? 4 : L.w >= 12 ? 3 : 2;
        const d = Math.hypot(x - ax - dx * t, y - ay - dy * t) - (L.w / 2 + sw + 0.5);
        if (d < 4 && (!best || d < best.d)) best = { h: L.h[k - 1] + (L.h[k] - L.h[k - 1]) * t, d };
      }
      return best;
    };

    // ---- the ground and the water, on a ~4 m grid over the tile ----
    const nx = Math.max(2, Math.round((X1 - X0) / 4)), ny = Math.max(2, Math.round((Y1 - Y0) / 4));
    const gp: number[] = [], gn: number[] = [], gc: number[] = [], heights = new Float32Array((nx + 1) * (ny + 1));
    const wetV = new Uint8Array((nx + 1) * (ny + 1));
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const x = X0 + (X1 - X0) * i / nx, y = Y0 + (Y1 - Y0) * j / ny, k = j * (nx + 1) + i;
      const w = water.length ? wet(x, y) : false;
      wetV[k] = w ? 1 : 0;
      let h = ground(x, y);
      // under a road: the ground kept just below the road's own profile (a 4 m grid otherwise
      // rises through a 3 m-sampled road on a slope), easing back to the relief over 4 m
      const rh = roadBed(x, y);
      // (what a vehicle stands on: the road's surface where there is one, else the ground)
      heights[k] = rh && rh.d <= 0 ? rh.h + 0.05 : h;
      if (rh) h = rh.d <= 0 ? Math.min(h, rh.h - 0.3) : h + (Math.min(h, rh.h - 0.3) - h) * (1 - rh.d / 4);
      gp.push(x, w ? h - 2.5 : h, -y);
      // paving, worn and patched; greener in places (world-space noise: no seams between tiles)
      const n1 = noise(x / 37, y / 37), n2 = noise(x / 9 + 50, y / 9 + 50), green = Math.min(1, Math.max(0, noise(x / 70 + 13, y / 70 - 7) - 0.5) * 2.6);
      const v = 0.105 + n1 * 0.045 + n2 * 0.02;
      // paving grey, and here and there grass (a lawn's green, darker)
      gc.push(v * (1 - green * 0.5), v * (1 - green * 0.08), v * (1 - green * 0.62));
    }
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const k = j * (nx + 1) + i, dx = (X1 - X0) / nx, dy = (Y1 - Y0) / ny;
      const hl = i > 0 ? heights[k - 1] : ground(X0 + dx * (i - 1), Y0 + dy * j), hr = i < nx ? heights[k + 1] : ground(X0 + dx * (i + 1), Y0 + dy * j);
      const hd = j > 0 ? heights[k - nx - 1] : ground(X0 + dx * i, Y0 + dy * (j - 1)), hu = j < ny ? heights[k + nx + 1] : ground(X0 + dx * i, Y0 + dy * (j + 1));
      const ax = -(hr - hl) / (2 * dx), az = (hu - hd) / (2 * dy), l = Math.hypot(ax, 1, az);
      gn.push(ax / l, 1 / l, az / l);
    }
    const gi: number[] = [], wi: number[] = [];
    const wp: number[] = [], wn: number[] = [], wuv: number[] = [], wmap = new Map<number, number>();
    const wv = (k: number) => { let m = wmap.get(k); if (m === undefined) { m = wp.length / 3; wmap.set(k, m); wp.push(gp[k * 3], gp[k * 3 + 1] + 2.35, gp[k * 3 + 2]); wn.push(0, 1, 0); wuv.push(gp[k * 3] / 20, -gp[k * 3 + 2] / 20); } return m; };
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      // (x east, y north; seen from above with y as −z, a→b→d→c is anticlockwise)
      gi.push(a, b, d, a, d, c);
      if (wetV[a] + wetV[b] + wetV[c] + wetV[d] >= 2) wi.push(wv(a), wv(b), wv(d), wv(a), wv(d), wv(c));
    }

    // ---- buildings, by facade style; roofs apart ----
    const styles: Record<string, Buf> = {}, roofs = newBuf();
    const feetPts: number[] = [], feetStarts: number[] = [], feetTops: number[] = [];
    // records not linked to the register lying on a linked one (a second copy), needles
    const linkedAt = new Map<string, any[]>();
    for (const f of feetAll) if (f.b.L) { const kk = Math.floor(f.cx / 40) + "," + Math.floor(f.cy / 40); const l = linkedAt.get(kk); if (l) l.push(f); else linkedAt.set(kk, [f]); }
    const onLinked = (f: any) => {
      const i0 = Math.floor(f.cx / 40), j0 = Math.floor(f.cy / 40);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const o of linkedAt.get(i0 + i + "," + (j0 + j)) ?? []) if (o !== f && (inRing(f.cx, f.cy, o.r) || inRing(o.cx, o.cy, f.r))) return true;
      return false;
    };
    // carriageways: a footprint mostly on a major road is a survey error
    const onRoad = (x: number, y: number) => {
      for (const [li, k] of segGrid.get(cell(x, y)) ?? []) {
        const L = lines[li];
        if (!L.major) continue;
        const ax = L.xs[k - 1], ay = L.ys[k - 1], dx = L.xs[k] - ax, dy = L.ys[k] - ay, l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
        if (Math.hypot(x - ax - dx * t, y - ay - dy * t) < L.w / 2 - 1.5) return true;
      }
      return false;
    };
    const dests = new Map<string, { x: number; y: number; n: number; floors: number }>();
    let nb = 0;
    for (const f of feetAll) {
      if (!owns(f.cx, f.cy)) continue;
      const b = f.b, fl = b.f;
      if ((fl >= 5 && f.area < 25) || (!b.L && fl >= 8 && f.area < 10 * fl + 40)) continue;
      if (!b.L && onLinked(f)) continue;
      let onR = 0; for (let k = 0; k < f.r.length; k += 2) if (onRoad(f.r[k], f.r[k + 1])) onR++;
      if (onRoad(f.cx, f.cy) && onR * 2 >= f.r.length / 2) continue;
      let height = b.h, floors = fl;
      if (height && fl && height > fl * 4.5 + 12) height = 0;
      if (height) floors = floors || Math.max(1, Math.round((height - GROUND_M) / FLOOR_M));
      else if (floors) height = Math.round((floors * FLOOR_M + GROUND_M) * 10) / 10;
      else { floors = 2; height = 6.5; }
      if (height < 2.5) continue;
      const brnd = rngOf(hashStr(f.cx.toFixed(1) + "," + f.cy.toFixed(1)));
      const style = styleOf(b.u, height, brnd());
      const tint = TINTS[Math.floor(brnd() * TINTS.length)].slice();
      const lift = style === "office" ? 0.4 : style === "apt" ? 0.65 : 0;
      for (let k = 0; k < 3; k++) tint[k] += (1 - tint[k]) * lift;
      let g0 = Infinity;
      for (let k = 0; k < f.r.length; k += 2) g0 = Math.min(g0, ground(f.r[k], f.r[k + 1]));
      const depth = Math.max(2, height), bottom = g0 - SINK, top = g0 + depth;
      const kv = Math.min(2, Math.max(0.5, FLOOR[style] / (depth / Math.max(1, floors))));
      const sb = (styles[style] ??= newBuf());
      const m = f.r.length / 2;
      for (let k = 0; k < m; k++) {
        const ax = f.r[k * 2], ay = f.r[k * 2 + 1], bx = f.r[((k + 1) % m) * 2], by = f.r[((k + 1) % m) * 2 + 1];
        const ex = bx - ax, ey = by - ay, el = Math.hypot(ex, ey) || 1, nxx = ey / el, nyy = -ex / el;
        const alongX = Math.abs(ey) < Math.abs(ex);
        const base = sb.p.length / 3;
        for (const [x, y, z] of [[ax, ay, bottom], [bx, by, bottom], [bx, by, top], [ax, ay, top]]) {
          sb.p.push(x, z, -y); sb.n.push(nxx, 0, -nyy); sb.u.push(alongX ? x : y, (1 - (z - g0)) * kv); sb.c.push(tint[0], tint[1], tint[2]);
        }
        sb.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      // the roof (ear clipping), a concrete tone from the tint
      const rb = roofs.p.length / 3, rt = 0.22 + brnd() * 0.1;
      for (let k = 0; k < m; k++) { roofs.p.push(f.r[k * 2], top, -f.r[k * 2 + 1]); roofs.n.push(0, 1, 0); roofs.c.push(rt * (0.9 + tint[0] * 0.1), rt * (0.9 + tint[1] * 0.1), rt * (0.92 + tint[2] * 0.08)); }
      const idx = Array.from({ length: m }, (_, k) => k);
      const crs = (o: number, p: number, q: number) => (f.r[p * 2] - f.r[o * 2]) * (f.r[q * 2 + 1] - f.r[o * 2 + 1]) - (f.r[p * 2 + 1] - f.r[o * 2 + 1]) * (f.r[q * 2] - f.r[o * 2]);
      let guard = m * m;
      while (idx.length > 3 && guard-- > 0) {
        let cut = false;
        for (let k = 0; k < idx.length; k++) {
          const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
          if (crs(ia, ib, ic) <= 0) continue;
          let inside = false;
          for (const q of idx) { if (q === ia || q === ib || q === ic) continue; if (crs(ia, ib, q) >= 0 && crs(ib, ic, q) >= 0 && crs(ic, ia, q) >= 0) { inside = true; break; } }
          if (inside) continue;
          roofs.i.push(rb + ia, rb + ib, rb + ic); idx.splice(k, 1); cut = true; break;
        }
        if (!cut) break;
      }
      if (idx.length === 3) roofs.i.push(rb + idx[0], rb + idx[1], rb + idx[2]);
      feetStarts.push(feetPts.length / 2); feetPts.push(...f.r); feetTops.push(top);
      nb++;
      // apartment complexes to deliver to: 공동주택 of five storeys and up, by name
      const name = String(b.n || "");
      if (name && floors >= 5 && /^02/.test(b.u)) {
        const d = dests.get(name) ?? { x: 0, y: 0, n: 0, floors: 0 };
        d.x += f.cx; d.y += f.cy; d.n++; d.floors = Math.max(d.floors, floors); dests.set(name, d);
      }
    }
    stats.buildings = nb;

    // the roofs join the ground's mesh (both plain vertex-coloured surfaces: one draw)
    {
      const base = gp.length / 3;
      for (let k = 0; k < roofs.p.length; k++) gp.push(roofs.p[k]);
      for (let k = 0; k < roofs.n.length; k++) gn.push(roofs.n[k]);
      for (let k = 0; k < roofs.c.length; k++) gc.push(roofs.c[k]);
      for (let k = 0; k < roofs.i.length; k++) gi.push(roofs.i[k] + base);
      roofs.p.length = roofs.n.length = roofs.c.length = roofs.i.length = 0;
    }
    const out: any = {
      type: "tile", key: job.i + "_" + job.j, i: job.i, j: job.j, ok: true, net, ms: 0,
      ground: { pos: new Float32Array(gp), nor: new Float32Array(gn), col: new Float32Array(gc), index: new Uint32Array(gi), nx, ny, heights, wet: wetV },
      water: wi.length ? { pos: new Float32Array(wp), nor: new Float32Array(wn), uv: new Float32Array(wuv), index: new Uint32Array(wi) } : null,
      asphalt: arrays(asphalt, true, false), walks: arrays(walks, true, false), marks: arrays(marks, false, true), concrete: arrays(concrete, true, false),
      styles: Object.fromEntries(Object.entries(styles).map(([k, b]) => [k, arrays(b)])), roofs: arrays(roofs, false, true),
      lamps: new Float32Array(lamps), trees: new Float32Array(trees),
      feet: { pts: new Float32Array(feetPts), starts: new Uint32Array(feetStarts), tops: new Float32Array(feetTops) },
      decks: new Float32Array(decks),
      lines: lines.map(L => { const pts = new Float32Array(L.xs.length * 3); for (let k = 0; k < L.xs.length; k++) { pts[k * 3] = L.xs[k]; pts[k * 3 + 1] = L.ys[k]; pts[k * 3 + 2] = L.h[k]; } return { id: L.id, pts, w: L.w, lanes: L.lanes, major: L.major }; }),
      dests: [...dests.entries()].map(([name, d]) => ({ name, x: d.x / d.n, y: d.y / d.n, floors: d.floors, n: d.n })),
      stats,
    };
    out.ms = performance.now() - t0;
    return out;
  };

  const transfers = (o: any, list: ArrayBuffer[] = []): ArrayBuffer[] => {
    if (!o || typeof o !== "object") return list;
    if (ArrayBuffer.isView(o)) { if (!list.includes(o.buffer as ArrayBuffer)) list.push(o.buffer as ArrayBuffer); return list; }
    for (const v of Array.isArray(o) ? o : Object.values(o)) transfers(v, list);
    return list;
  };

  self.onmessage = (e: MessageEvent) => {
    const job = e.data;
    if (job.type === "init") {
      cfg = job;
      token = fetch(`https://map.vworld.kr/dtkmap/selectApiKeyJson.do?apiKey=${encodeURIComponent(job.key)}&output=json`, { referrerPolicy: "no-referrer" })
        .then(r => r.json()).then(d => (typeof d?.apiKey === "string" && d.apiKey.startsWith("$$") ? d.apiKey : null)).catch(() => null);
      ready = (async () => {
        await ensureDem(job.lon - 0.001, job.lat - 0.001, job.lon + 0.001, job.lat + 0.001);
        const e0 = elev(job.lon, job.lat);
        h0 = Number.isFinite(e0) ? e0 : 0;
        (self as any).postMessage({ type: "ready", h0, dem: Number.isFinite(e0) });
      })();
      return;
    }
    if (job.type === "tile") {
      void (async () => {
        try {
          await ready;
          const out = await build(job);
          (self as any).postMessage(out, transfers(out));
        } catch (err) {
          (self as any).postMessage({ type: "tile", key: job.i + "_" + job.j, i: job.i, j: job.j, ok: false, error: String(err), ms: 0, net: 0 });
        }
      })();
    }
  };
}

/** A tile worker, started from the function above. */
export function startTileWorker(): Worker {
  const src = `(${tileWorkerMain.toString()})()`;
  return new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
}
