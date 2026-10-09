/* The drone's roads (드론 mode), tile by tile: the national road survey's centre lines (국가기본도
 * 도로중심선, VWorld LT_L_N3A0020000: width rvwd, lanes rdln) cut to the tile and laid on its
 * relief — an asphalt band the road's width, its lane lines (white dashes between lanes going the
 * same way, a double yellow centre line on a two-way road of two lanes or more), and the lanes
 * themselves as paths for the traffic (droneTraffic.ts): right-hand traffic, each lane its line
 * offset from the centre, in the direction it is driven.
 *
 * Structures from the standard node-link (표준노드링크, LT_L_MOCTLINK rd_type_h): a road along a
 * 교량 or 고가도로 link is a deck — straight between the ground at its two ends, over a 고가도로
 * at least 7 m over the ground — with its slab, parapets and piers down to the ground every
 * ~30 m; along a 터널 or 지하차도 link nothing is drawn (it is underground) and nobody drives
 * there in sight. The lane lines come twice: true to size, and broad for a camera far off (a
 * 15 cm line is far under a pixel from 300 m; droneWorld shows one or the other by distance).
 *
 * VWorld answers only JSONP: all of it in a worker (importScripts), as the ring's buildings. One
 * self-contained function (a Blob worker): no imports inside. */

type Arr = { position: Float32Array; normal: Float32Array; index: Uint32Array };
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
  /** the junctions' asphalt (where roads cross: filled, no lane lines through it) */
  junctions: Arr | null;
  /** lanes: [n, road width, x0, y0, z0, x1, y1, z1, …] one after another (view frame, z the road's height) */
  lanes: Float32Array;
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
  /** the sea round the tile (the coastline's, view frame): a road over it is on a bridge, clear of
   * the sea's level by 8 m and more */
  sea?: number[][][]; seaLevel?: number;
  /** a landmark bridge's upper deck (광안대교: sceneLandmarks.gwanganDeck), its line and heights:
   * the roads along it are on it — its own model draws the structure */
  deck?: { pts: number[][]; z: number[] };
};

function roadWorkerMain() {
  self.onmessage = async (e: MessageEvent<RoadJob>) => {
    const t0 = performance.now();
    // The mapped crossings (the server fetches them from OpenStreetMap on a first ask: asked again
    // a little later while it answers with none and no source).
    type Crossing = { line: [number, number][]; signals: boolean; layer?: number };
    let crossings: Crossing[] = [];
    let crossPoints: { at: [number, number]; signals: boolean; marked: boolean }[] = [];
    let mapped = false;
    // (never holding the tile up: two seconds at most — the drone world asked for them ahead, when
    // the tile was queued, so the server has them by now)
    if (e.data.crossings) {
      const got = await fetch(e.data.crossings.url, { signal: AbortSignal.timeout(2000) }).then(r => (r.ok ? r.json() : null)).catch(() => null) as { crossings?: Crossing[]; points?: typeof crossPoints; source?: string | null } | null;
      crossings = got?.crossings ?? [];
      crossPoints = got?.points ?? [];
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
    const pages = (urls: string[], cb: string, each: (f: any) => void) => {
      const seen = new Set<string>();
      for (const url of urls) {
        let body: any = null;
        (self as any)[cb] = (b: unknown) => { body = b; };
        try { importScripts(url); } catch { break; }
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
    type Road = { line: number[][]; width: number; lanes: number };
    const roads: Road[] = [];
    pages(e.data.urls, "roadCb", f => {
      const width = parseFloat(f.properties?.rvwd) || 0, lanes = Math.round(parseFloat(f.properties?.rdln) || 0);
      if (width < 3.5 && lanes < 1) return;
      const w = Math.min(60, width || Math.max(1, lanes) * 3.3);
      // (no lane count registered: as many 3.3 m lanes as the width holds)
      for (const l of linesOf(f.geometry)) if (l.length > 1) roads.push({ line: l.map(project), width: w, lanes: Math.max(1, lanes || Math.floor(w / 3.3)) });
    });
    // The structures: 교량 / 고가도로 (raised), 터널 / 지하차도 (under), as segments on a 10 m hash.
    type Seg = { ax: number; ay: number; bx: number; by: number; kind: 1 | 2 | -1 };
    const segs = new Map<string, Seg[]>();
    pages(e.data.linkUrls, "linkCb", f => {
      const t = String(f.properties?.rd_type_h ?? "");
      const kind = t === "교량" ? 1 : t === "고가도로" ? 2 : t === "터널" || t === "지하차도" ? -1 : 0;
      if (!kind) return;
      for (const l of linesOf(f.geometry)) for (let i = 1; i < l.length; i++) {
        const [ax, ay] = project(l[i - 1]), [bx, by] = project(l[i]);
        const s: Seg = { ax, ay, bx, by, kind: kind as Seg["kind"] };
        cells(Math.min(ax, bx) - 12, Math.min(ay, by) - 12, Math.max(ax, bx) + 12, Math.max(ay, by) + 12, 10, k => add(segs, k, s));
      }
    });
    // The water areas of the stream network (하천망): a road over one is on a bridge, whatever the
    // link says (a wide bridge's two carriageways can lie 15–20 m off its one link).
    const water: number[][][] = [];
    const wcell = new Map<string, number[]>();
    pages(e.data.riverUrls, "riverCb", f => {
      const geom = f.geometry, polys = geom?.type === "Polygon" ? [geom.coordinates] : geom?.type === "MultiPolygon" ? geom.coordinates : [];
      for (const poly of polys) {
        const rings = poly.map((r: number[][]) => r.map(project));
        const k = water.push(rings as unknown as number[][]) - 1;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [x, y] of rings[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        cells(x0, y0, x1, y1, 50, kk => add(wcell, kk, k));
      }
    });
    const inside = (x: number, y: number, ring: number[][]) => {
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    // (and the sea: the coastline's)
    const seaRings = e.data.sea ?? [], seaBox = seaRings.map(r => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [x0, y0, x1, y1]; });
    const overSea = (x: number, y: number) => seaRings.some((r, i) => x >= seaBox[i][0] && x <= seaBox[i][2] && y >= seaBox[i][1] && y <= seaBox[i][3] && inside(x, y, r));
    const overWater = (x: number, y: number) => overSea(x, y) || (wcell.get(Math.floor(x / 50) + "," + Math.floor(y / 50)) ?? []).some(k => {
      const rings = water[k] as unknown as number[][][];
      return inside(x, y, rings[0]) && !rings.slice(1).some(h => inside(x, y, h));
    });
    const seaLevel = e.data.seaLevel ?? -1e9;
    // the landmark deck: a road point within 32 m of it (either carriageway), running along it, is on it (its height)
    const deck = e.data.deck;
    const onDeck = (x: number, y: number, dx: number, dy: number): number | null => {
      if (!deck) return null;
      let best: number | null = null, bd = 32;
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
    // crosses it: not the same way); a point over the water, a bridge.
    const structureAt = (x: number, y: number, dx: number, dy: number): number => {
      if (overWater(x, y)) return 1;
      let best = 0, bd = 20;
      for (const s of segs.get(Math.floor(x / 10) + "," + Math.floor(y / 10)) ?? []) {
        const ex = s.bx - s.ax, ey = s.by - s.ay, l2 = ex * ex + ey * ey || 1, t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (y - s.ay) * ey) / l2));
        const d = Math.hypot(s.ax + ex * t - x, s.ay + ey * t - y);
        if (d >= bd) continue;
        const cos = Math.abs(ex * dx + ey * dy) / (Math.sqrt(l2) * (Math.hypot(dx, dy) || 1));
        if (cos < 0.9) continue;
        bd = d; best = s.kind;
      }
      return best;
    };
    // Each line resampled every ~6 m (over a margin past the tile: a bridge's far end may lie
    // outside it), its heights, then cut to the tile.
    const [bx0, by0, bx1, by1] = box, M = 150;
    type Piece = Road & { z: number[]; kind: number[]; jn: boolean[]; id: number };
    const pieces: Piece[] = [];
    let bridges = 0;
    for (const r of roads) {
      const pts: number[][] = [];
      for (let i = 1; i < r.line.length; i++) {
        const a = r.line[i - 1], b = r.line[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 6));
        for (let k = i === 1 ? 0 : 1; k <= n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      }
      const near = (p: number[]) => p[0] > bx0 - M && p[0] < bx1 + M && p[1] > by0 - M && p[1] < by1 + M;
      if (!pts.some(near)) continue;
      const kind = pts.map((p, k) => { const q = pts[Math.min(pts.length - 1, k + 1)], o = pts[Math.max(0, k - 1)]; return structureAt(p[0], p[1], q[0] - o[0], q[1] - o[1]); });
      // (a structure run shorter than 15 m is a match at a junction: ground)
      for (let k = 0; k < kind.length;) {
        let e2 = k; while (e2 < kind.length && kind[e2] === kind[k]) e2++;
        if (kind[k] && (e2 - k) * 6 < 15) for (let q = k; q < e2; q++) kind[q] = 0;
        k = e2;
      }
      const z = pts.map(p => ground(p[0], p[1]));
      // (on the landmark deck: its height, kind 3 — no slab or piers of ours under it)
      pts.forEach((p, k) => {
        const q = pts[Math.min(pts.length - 1, k + 1)], o = pts[Math.max(0, k - 1)], h = onDeck(p[0], p[1], q[0] - o[0], q[1] - o[1]);
        if (h !== null && h > z[k] + 1) { z[k] = h; kind[k] = 3; }
      });
      // decks: straight between their ends' ground; a viaduct at least 7 m up, eased in and out
      for (let k = 0; k < kind.length;) {
        let e2 = k; while (e2 < kind.length && kind[e2] === kind[k]) e2++;
        if (kind[k] > 0 && kind[k] !== 3) {
          bridges++;
          const a = Math.max(0, k - 1), b = Math.min(kind.length - 1, e2), za = ground(pts[a][0], pts[a][1]), zb = ground(pts[b][0], pts[b][1]);
          for (let q = k; q < e2; q++) {
            const f = (q - a) / Math.max(1, b - a);
            let h = za + (zb - za) * f;
            const ease = Math.min(1, Math.min(q - a, b - q) * 6 / 60);
            if (kind[k] === 2) h = Math.max(h, z[q] + 7 * ease);
            // (over the water, clear of it: a river bridge stands 8 m or more over its channel)
            else if (overWater(pts[q][0], pts[q][1])) h = Math.max(h, Math.max(z[q], seaLevel) + 8 * ease);
            z[q] = Math.max(h, z[q] + 0.3);
          }
        }
        k = e2;
      }
      // cut to the tile
      const inside = (p: number[]) => p[0] >= bx0 - 0.01 && p[0] <= bx1 + 0.01 && p[1] >= by0 - 0.01 && p[1] <= by1 + 0.01;
      let run: number[] = [];
      const flush = () => {
        if (run.length > 1) pieces.push({ ...r, line: run.map(k => pts[k]), z: run.map(k => z[k]), kind: run.map(k => kind[k]), jn: run.map(() => false), id: roads.indexOf(r) });
        run = [];
      };
      for (let k = 0; k < pts.length; k++) {
        if (inside(pts[k])) { run.push(k); continue; }
        // (the point just past the edge too, so pieces of neighbouring tiles meet)
        if (run.length) { run.push(k); flush(); }
        else if (k + 1 < pts.length && inside(pts[k + 1])) run.push(k);
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
    const clusters = new Map<string, { x: number; y: number; z: number; n: number; r: number; up: number }>();
    pieces.forEach(r => {
      for (let k = 0; k < r.line.length; k++) {
        const [x, y] = r.line[k];
        for (const [qi, qk] of segAt.get(Math.floor(x / 15) + "," + Math.floor(y / 15)) ?? []) {
          const q = pieces[qi];
          if (q.id === r.id || (q.kind[qk] > 0) !== (r.kind[k] > 0) || q.kind[qk] < 0 || r.kind[k] < 0) continue;
          const a = q.line[qk - 1], b = q.line[qk], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1;
          const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / l2));
          if (Math.hypot(a[0] + ex * t - x, a[1] + ey * t - y) > q.width / 2 + 0.5) continue;
          // (two carriageways side by side — a divided road, a bridge's two decks — are no junction:
          // a junction is where they cross or meet at an angle)
          const o = r.line[Math.min(r.line.length - 1, k + 1)], pv = r.line[Math.max(0, k - 1)], rx = o[0] - pv[0], ry = o[1] - pv[1];
          if (Math.abs(rx * ex + ry * ey) / ((Math.hypot(rx, ry) || 1) * Math.sqrt(l2)) > 0.9) continue;
          r.jn[k] = true;
          const ck = Math.round(x / 14) + "," + Math.round(y / 14), c = clusters.get(ck) ?? { x: 0, y: 0, z: 0, n: 0, r: 0, up: 0 };
          c.x += x; c.y += y; c.z += r.z[k]; c.n++; c.r = Math.max(c.r, r.width / 2, q.width / 2);
          c.up = Math.max(c.up, Math.min(6, Math.floor(Math.max(r.width, q.width) / 4)) * 0.012);
          clusters.set(ck, c);
          break;
        }
      }
    });
    const S = { p: [] as number[], n: [] as number[], i: [] as number[] };
    // (the junctions' asphalt goes with the roads': one mesh)
    const Jn = S;
    const streetTrees: number[] = [];
    // the junctions' asphalt: a disc the widest road's half width round each, over the bands
    for (const c of clusters.values()) {
      const cx = c.x / c.n, cy = c.y / c.n, cz = c.z / c.n, R = c.r + 1.5, base = Jn.p.length / 3;
      // (a little under the roads' own surfaces and well under their paint)
      Jn.p.push(cx, cy, Math.max(cz, ground(cx, cy)) + 0.28 + c.up); Jn.n.push(0, 0, 1);
      for (let q = 0; q <= 20; q++) { const a = (q / 20) * Math.PI * 2, x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R; Jn.p.push(x, y, ground(x, y) + 0.28 + c.up); Jn.n.push(0, 0, 1); }
      for (let q = 1; q <= 20; q++) Jn.i.push(base, base + q, base + q + 1);
    }
    // A painted rectangle (a crossing's stripe, a stop line): centre, direction along, half sizes.
    // (`z` here is the height over the ground: each corner follows the relief, as the road does —
    // a flat stripe across a cambered or sloping road sank under it on one side)
    const rect = (out: { p: number[]; n: number[]; i: number[]; c?: number[] }, x: number, y: number, z: number, dx: number, dy: number, ha: number, hc: number, col: number[], zAt?: (x: number, y: number) => number) => {
      const nx = -dy, ny = dx, base = out.p.length / 3;
      for (const [a, c] of [[-ha, -hc], [ha, -hc], [ha, hc], [-ha, hc]]) {
        const px = x + dx * a + nx * c, py = y + dy * a + ny * c;
        out.p.push(px, py, zAt ? zAt(px, py) : ground(px, py) + z); out.n.push(0, 0, 1); out.c?.push(col[0], col[1], col[2]);
      }
      out.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const Mk = { p: [] as number[], n: [] as number[], i: [] as number[], c: [] as number[] };
    const Mf = { p: [] as number[], n: [] as number[], i: [] as number[], c: [] as number[] };
    const St = { p: [] as number[], n: [] as number[], i: [] as number[] };
    const Wk = { p: [] as number[], n: [] as number[], i: [] as number[] };
    const walkPaths: number[] = [];
    const lanes: number[] = [];
    const WHITE = [0.95, 0.95, 0.93], YELLOW = [0.98, 0.74, 0.1];
    const normalAt = (l: number[][], k: number) => {
      const a = l[Math.max(0, k - 1)], b = l[Math.min(l.length - 1, k + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      return [-dy / L, dx / L];
    };
    // A band along a piece from s0 to s1 m, offset `off` to the left, `w` wide, `lift` over the road.
    const band = (r: Piece, off: number, w: number, lift: number, out: { p: number[]; n: number[]; i: number[]; c?: number[] }, col: number[] | null, dash: number, skip: (k: number) => boolean) => {
      const l = r.line, cum = [0];
      for (let k = 1; k < l.length; k++) cum.push(cum[k - 1] + Math.hypot(l[k][0] - l[k - 1][0], l[k][1] - l[k - 1][1]));
      const total = cum[cum.length - 1];
      const at = (s: number) => {
        let k = 0; while (k < l.length - 2 && cum[k + 1] < s) k++;
        const f = Math.min(1, Math.max(0, (s - cum[k]) / ((cum[k + 1] - cum[k]) || 1)));
        return { x: l[k][0] + (l[k + 1][0] - l[k][0]) * f, y: l[k][1] + (l[k + 1][1] - l[k][1]) * f, z: r.z[k] + (r.z[k + 1] - r.z[k]) * f, k };
      };
      const range = (s0: number, s1: number) => {
        const ss = [s0, ...cum.filter(c => c > s0 && c < s1), s1];
        for (let q = 0; q < ss.length - 1; q++) {
          const A = at(ss[q]), B = at(ss[q + 1]);
          if (skip(A.k)) continue;
          const base = out.p.length / 3;
          for (const P of [A, B]) {
            const nn = normalAt(l, P.k);
            for (const side of [-1, 1]) {
              out.p.push(P.x + nn[0] * (off + (side * w) / 2), P.y + nn[1] * (off + (side * w) / 2), P.z + lift);
              out.n.push(0, 0, 1);
              if (out.c && col) out.c.push(col[0], col[1], col[2]);
            }
          }
          // (counter-clockwise seen from above: the right edge first, then forward, then the left)
          out.i.push(base, base + 2, base + 3, base, base + 3, base + 1);
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
    for (const r of pieces) {
      const w = r.width, lanesN = Math.max(1, r.lanes), up = Math.min(6, Math.floor(w / 4)) * 0.012;
      const under = (k: number) => r.kind[k] < 0 || r.kind[Math.min(r.kind.length - 1, k + 1)] < 0;
      const k1 = (k: number) => Math.min(r.kind.length - 1, k + 1);
      // (no lane lines through a junction)
      const paintSkip = (k: number) => under(k) || r.jn[k] || r.jn[k1(k)];
      band(r, 0, w, 0.3 + up, S, null, 0, under);
      const twoWay = lanesN >= 2;
      const perDir = twoWay ? Math.max(1, Math.floor(lanesN / 2)) : lanesN;
      const laneW = Math.min(3.6, w / Math.max(1, twoWay ? perDir * 2 : perDir));
      // (true to size: 15 cm lines, 3 m dashes in 8 m; broad, for a camera 300 m to 2 km off where a
      // metre is about a pixel: a 1.2 m double centre line, 1 m lane lines in 6 m dashes every 20 m)
      // (true to size only: the broad far-off paint is gone — Mf stays empty)
      for (const [out, k] of [[Mk, 1]] as const) {
        const lift = 0.38 + up + (k > 1 ? 0.02 : 0), far = k > 1;
        if (twoWay && w >= 6) {
          if (far) band(r, 0, 1.2, lift, out, YELLOW, 0, paintSkip);
          else { band(r, 0.12, 0.15, lift, out, YELLOW, 0, paintSkip); band(r, -0.12, 0.15, lift, out, YELLOW, 0, paintSkip); }
        }
        for (let q = 1; q < perDir; q++) for (const side of twoWay ? [1, -1] : [1])
          band(r, side * (twoWay ? q * laneW : q * laneW - (perDir * laneW) / 2), far ? 1.0 : 0.15, lift, out, WHITE, far ? 20 : 8, paintSkip);
        // edge lines on the wider roads
        if (w >= 7) for (const side of [1, -1]) band(r, side * (w / 2 - (far ? 0.6 : 0.35)), far ? 0.8 : 0.15, lift, out, WHITE, 0, paintSkip);
      }
      // Bridges: the slab under the deck's edges, parapets, piers every ~30 m.
      for (let k = 0; k < r.line.length - 1; k++) {
        if (r.kind[k] <= 0 || r.kind[k + 1] <= 0 || r.kind[k] === 3 || r.kind[k + 1] === 3) continue;
        const A = r.line[k], B = r.line[k + 1], na = normalAt(r.line, k), nb = normalAt(r.line, k + 1), za = r.z[k] + 0.3, zb = r.z[k + 1] + 0.3;
        for (const side of [-1, 1]) {
          const h = w / 2 + 0.3;
          const a0 = [A[0] + na[0] * side * h, A[1] + na[1] * side * h], b0 = [B[0] + nb[0] * side * h, B[1] + nb[1] * side * h];
          const o = side > 0 ? [a0, b0] : [b0, a0], zo = side > 0 ? [za, zb] : [zb, za];
          // slab edge (1.4 m deep) and a 1 m parapet
          quad([o[0][0], o[0][1], zo[0] - 1.4], [o[1][0], o[1][1], zo[1] - 1.4], [o[1][0], o[1][1], zo[1] + 1.0], [o[0][0], o[0][1], zo[0] + 1.0]);
          quad([o[1][0], o[1][1], zo[1] + 1.0], [o[0][0], o[0][1], zo[0] + 1.0], [o[0][0] - na[0] * side * 0.3, o[0][1] - na[1] * side * 0.3, zo[0] + 1.0], [o[1][0] - nb[0] * side * 0.3, o[1][1] - nb[1] * side * 0.3, zo[1] + 1.0]);
        }
        // the slab's underside
        const hw = w / 2 + 0.3;
        quad([A[0] - na[0] * hw, A[1] - na[1] * hw, za - 1.4], [B[0] - nb[0] * hw, B[1] - nb[1] * hw, zb - 1.4], [B[0] + nb[0] * hw, B[1] + nb[1] * hw, zb - 1.4], [A[0] + na[0] * hw, A[1] + na[1] * hw, za - 1.4]);
        if (k % 5 === 0) {
          const gz = ground(A[0], A[1]);
          if (za - 1.4 - gz > 2.5) {
            // one column under a narrow deck, two under a wide one
            const cols = w > 14 ? [-w / 4, w / 4] : [0];
            for (const c of cols) pier(A[0] + na[0] * c, A[1] + na[1] * c, gz - 2, za - 1.4, 0.9, 0.9);
          }
        }
      }
      // Sidewalks on the roads of 8 m and up (not along a tunnel or a bridge): paving 15 cm over the
      // road, ~15 % of its width (1.8–4 m), a kerb face along the road's edge; their middle lines
      // for the people.
      if (w >= 8) {
        const sw = Math.max(1.8, Math.min(4, w * 0.15));
        const flat = (k: number) => r.kind[k] !== 0 || r.kind[k1(k)] !== 0 || r.jn[k] || r.jn[k1(k)];
        band(r, w / 2 + sw / 2, sw, 0.45 + up, Wk, null, 0, flat);
        band(r, -(w / 2 + sw / 2), sw, 0.45 + up, Wk, null, 0, flat);
        for (const side of [1, -1]) {
          for (let k = 0; k < r.line.length - 1; k++) {
            if (flat(k)) continue;
            const A = r.line[k], B = r.line[k + 1], na = normalAt(r.line, k), nb = normalAt(r.line, k + 1), e = w / 2;
            const a = [A[0] + na[0] * side * e, A[1] + na[1] * side * e], b = [B[0] + nb[0] * side * e, B[1] + nb[1] * side * e];
            const base = Wk.p.length / 3;
            const lo = [r.z[k] + 0.3 + up, r.z[k + 1] + 0.3 + up], hi = [r.z[k] + 0.45 + up, r.z[k + 1] + 0.45 + up];
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
          if (r.kind[k] < 0) { emit(); continue; }
          const nn = normalAt(r.line, k), x = r.line[k][0] + nn[0] * off, y = r.line[k][1] + nn[1] * off;
          pts.push(x, y, r.z[k] + 0.3 + up);
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
        let z = ground(px, py) + 0.4;
        for (const [A, B, za, zb, hw, ou] of near) {
          const ex = B[0] - A[0], ey = B[1] - A[1], l2 = ex * ex + ey * ey || 1;
          const f = Math.max(0, Math.min(1, ((px - A[0]) * ex + (py - A[1]) * ey) / l2));
          if (Math.hypot(A[0] + ex * f - px, A[1] + ey * f - py) <= hw) z = Math.max(z, za + (zb - za) * f + 0.3 + ou + 0.08);
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
    const arr = (o: { p: number[]; n: number[]; i: number[]; c?: number[] }) => {
      if (!o.i.length) return null;
      const a: any = { position: new Float32Array(o.p), normal: new Float32Array(o.n), index: new Uint32Array(o.i) };
      transfer.push(a.position.buffer, a.normal.buffer, a.index.buffer);
      if (o.c) { a.color = new Float32Array(o.c); transfer.push(a.color.buffer); }
      return a;
    };
    const out = { surface: arr(S), marks: arr(Mk), marksFar: arr(Mf), structure: arr(St), walks: arr(Wk), walkPaths: new Float32Array(walkPaths), streetTrees: new Float32Array(streetTrees), junctions: null, lanes: new Float32Array(lanes), roads: pieces.length, bridges, ms: performance.now() - t0 };
    transfer.push(out.lanes.buffer, out.walkPaths.buffer, out.streetTrees.buffer);
    (self as unknown as Worker).postMessage(out, transfer);
  };
}

/** (one Blob URL for the page's lifetime) */
let roadUrl: string | null = null;
/** One tile's roads (box in the view's frame, metres from lat/lon), made in a worker. */
export function roadTile(lat: number, lon: number, key: string, domain: string | null | undefined, box: [number, number, number, number],
  grid: RoadJob["grid"], wide: Grid | null, signal?: AbortSignal, tile?: { lat: number; lon: number },
  extra?: Pick<RoadJob, "sea" | "seaLevel" | "deck">): Promise<RoadTileResult | null> {
  const kx = Math.cos((lat * Math.PI) / 180) * 111320, ky = 110540, m = 30;
  const q = `BOX(${lon + (box[0] - m) / kx},${lat + (box[1] - m) / ky},${lon + (box[2] + m) / kx},${lat + (box[3] + m) / ky})`;
  const ask = (layer: string, cb: string, n: number) => Array.from({ length: n }, (_, i) => "https://api.vworld.kr/req/data?" + new URLSearchParams({
    service: "data", request: "GetFeature", crs: "EPSG:4326", geometry: "true", attribute: "true",
    key, domain: domain ?? "https://kospimap.com", data: layer, geomFilter: q,
    size: "1000", page: String(i + 1), format: "json", callback: cb,
  }));
  roadUrl ??= URL.createObjectURL(new Blob([`(${roadWorkerMain.toString()})()`], { type: "text/javascript" }));
  const worker = new Worker(roadUrl);
  return new Promise(resolve => {
    worker.onmessage = e => { worker.terminate(); resolve(e.data as RoadTileResult); };
    worker.onerror = () => { worker.terminate(); resolve(null); };
    signal?.addEventListener("abort", () => { worker.terminate(); resolve(null); });
    // (the crossings asked about the tile's rounded centre, as the view asks: the server's cache)
    const crossings = tile && typeof location !== "undefined" ? (() => {
      const la = +tile.lat.toFixed(4), lo = +tile.lon.toFixed(4);
      return { url: `${location.origin}/api/realestate/crossings?lat=${la.toFixed(4)}&lon=${lo.toFixed(4)}&r=260&v=3`, ox: (lo - lon) * kx, oy: (la - lat) * ky };
    })() : undefined;
    worker.postMessage({ urls: ask("LT_L_N3A0020000", "roadCb", 4), linkUrls: ask("LT_L_MOCTLINK", "linkCb", 2), riverUrls: ask("LT_C_WKMSTRM", "riverCb", 2), lat, lon, box, grid, wide, crossings, ...extra } satisfies RoadJob);
  });
}
