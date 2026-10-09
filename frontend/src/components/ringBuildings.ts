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

/** What the building register (VWorld GIS건물통합정보) says of a sign's largest building: its parcel
 * (PNU, for the 건축물대장 card), 사용승인일, floors, height and floor area. */
export type DroneLabelInfo = { /** the building's centre (view frame, m) */ bx?: number; by?: number; pnu?: string; approved?: string; floors?: number; basements?: number; height?: number; area?: number; dong?: string };
export type DroneLabel = { name: string; kind: "apt" | "gov" | "major" | "school" | "hospital"; x: number; y: number; top: number; n: number; info?: DroneLabelInfo };
/** The styles in the order RingResult.towers names them. */
export const SURVEY_STYLES: ContextStyle[] = ["apt", "villa", "shop", "office"];
export type RingStyleArrays = { position: Float32Array; normal: Float32Array; uv: Float32Array; color: Float32Array; index: Uint32Array };
export type RingResult = {
  styles: Partial<Record<ContextStyle, RingStyleArrays>>; buildings: number; ms: number;
  footprints: [number,number][][];
  /** The ring's apartment blocks (5 storeys and up), six numbers each: centre x, y, height,
   * ground, and where its triangles lie in the apartment mesh's index (start, count) — so a
   * surveyed shape can take its place (ComplexHologram). */
  apts: Float32Array;
  /** Box mode only (the drone's tiles): the blocks worth their surveyed shape — every building of
   * 5 storeys and up — nine numbers each: centre x, y, height, ground, where its triangles lie in
   * its style's mesh (start, count), the style (SURVEY_STYLES index), its outline (spanRings
   * index) and its area. */
  towers?: Float32Array;
  /** Box mode only: what the drone's signs name — apartment complexes (their blocks of 7 storeys
   * and up, together), public offices, schools, hospitals and tall named buildings; x, y the
   * centre, top the highest roof (view frame), n the buildings it gathers. */
  labels?: DroneLabel[];
  /** Box mode only: per building drawn, its style (SURVEY_STYLES index), walls' first vertex and
   * count, roof's first vertex and count (5 each), and its outline (spanRings, same order). */
  spans?: Float32Array; spanRings?: number[][][];
  /** Box mode only (the drone's tiles): every building over the box (those straddling its edge
   * too) as roof heights on a `heightCell` grid, x east from box[0], y north from box[1]; -1e4
   * where none stands. */
  roofs?: { h: Float32Array; nx: number; ny: number; cell: number; x0: number; y0: number };
};

type RingJob = {
  urls: string[]; lat: number; lon: number; inner: number; outer: number;
  near: Float32Array; seed: number;
  /** the surveyed roads (6 m and wider) as segments: ax, ay, bx, by, half width */
  roads: Float32Array;
  clearedSite?: RealEstateBuildingsResponse['cleared_site'];
  grid: { h: Float32Array; n: number; R: number; cell: number; ox?: number; oy?: number } | null;
  floorM: Record<string, number>;
  /** Drone tiles: only buildings whose centroid lies in [x0, y0, x1, y1) (metres from lat/lon)
   * are drawn, and of those only past `inner`; `roofs` is filled for all of them. */
  box?: [number, number, number, number];
  heightCell?: number;
};

function ringWorkerMain() {
  const SINK = 3, FLOOR_M = 2.9, GROUND_M = 1.5;
  const BRICK = [[0.62, 0.38, 0.3], [0.66, 0.43, 0.34], [0.56, 0.34, 0.27], [0.7, 0.5, 0.4], [0.52, 0.33, 0.27], [0.74, 0.58, 0.47]];
  const STEEL = [[0.62, 0.7, 0.78], [0.55, 0.63, 0.71], [0.72, 0.77, 0.82], [0.6, 0.64, 0.66]];
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
  const rng = (seed: number) => {
    // West/south drone tiles have signed grid coordinates and can produce negative seeds.
    // JavaScript keeps the sign of %, which otherwise selects a negative palette index.
    seed = ((Math.trunc(seed) % 2147483647) + 2147483647) % 2147483647 || 1;
    return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  };
  type Buf = { p: number[]; n: number[]; u: number[]; c: number[]; i: number[] };
  self.onmessage = (e: MessageEvent<RingJob>) => {
    const t0 = performance.now();
    const job = e.data, { lat, lon } = job;
    const kx = Math.cos((lat * Math.PI) / 180) * 111320, ky = 110540;
    // Terrain: the view's own grid (bilinear, clamped at its edge as the view's ground is).
    const g = job.grid;
    const at = (x: number, y: number) => {
      if (!g) return 0;
      // (a drone tile's grid is centred on the tile: ox, oy its centre from lat/lon)
      x -= g.ox ?? 0; y -= g.oy ?? 0;
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
    const apts: number[] = [], towers: number[] = [];
    // (box mode: each drawn building's vertices — style, walls start and count, roof start and
    // count — and its outline, for its colours read off the aerial photographs later)
    const spans: number[] = [], spanRings: number[][][] = [];
    const STYLES = ["apt", "villa", "shop", "office"];
    let count = 0;
    // All the pages first: a record is judged against the others (vworldBuildings.withoutStrays).
    type Cand = { ring: number[][]; area: number; cx: number; cy: number; d: number; props: any; linked: boolean; holes: number[][][] };
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
        const aboveFloors=String(props.grnd_flr??'').trim();
        if(aboveFloors!==''&&Number(aboveFloors)===0&&!(Number(props.height)>0))continue;
        const zero=(v:unknown)=>v!=null&&String(v).trim()!==''&&Number(v)===0;
        if(aboveFloors!==''&&Number(aboveFloors)<=1&&zero(props.height)
          &&['archarea','totalarea','platarea'].every(k=>zero(props[k]))
          &&!String(props.usability??'').trim()&&!String(props.bld_nm??'').trim())continue;
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
          // Its courtyards (a stadium's field, an atrium open to the sky): the outline's inner rings,
          // clockwise, of 20 m² and up.
          const holes: number[][][] = [];
          for (const inner of poly.slice(1)) {
            let h: number[][] = [];
            for (const [x, y] of inner) { const px = (x - lon) * kx, py = (y - lat) * ky; const l = h[h.length - 1]; if (!l || Math.hypot(px - l[0], py - l[1]) > 0.05) h.push([px, py]); }
            if (h.length > 2 && Math.hypot(h[0][0] - h[h.length - 1][0], h[0][1] - h[h.length - 1][1]) < 0.05) h.pop();
            if (h.length < 3) continue;
            let ha = 0;
            for (let i = 0; i < h.length; i++) { const [x1, y1] = h[i], [x2, y2] = h[(i + 1) % h.length]; ha += x1 * y2 - x2 * y1; }
            if (Math.abs(ha / 2) < 20) continue;
            if (ha > 0) h = h.reverse();
            holes.push(h);
          }
          const d = Math.hypot(cx, cy);
          if (job.box) {
            // (everything over the box and a margin: the roofs of buildings across its edge too)
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const [px, py] of ring) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
            if (x1 < job.box[0] || y1 < job.box[1] || x0 > job.box[2] || y0 > job.box[3]) continue;
          } else if (d > job.outer || known(cx, cy) || (d < job.inner && near.size)) continue;
          cands.push({ ring, area: Math.abs(area), cx, cy, d, props, linked: !!props.usability || /^(19|20)\d{2}/.test(props.useapr_day || ""), holes });
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
    // The selected parcel's removed houses must not return through this independent
    // raw-registry query. Keep genuine old neighbours outside the cleared parcel.
    if (job.clearedSite) for (let i=cands.length-1;i>=0;i--) {
      const c=cands[i],p=c.props,day=String(p.useapr_day??''),year=/^(19|20)\d{2}/.test(day)?+day.slice(0,4):null;
      const floors=Math.round(Number(p.grnd_flr)||0)||(Number(p.height)>0?Math.max(1,Math.round((Number(p.height)-GROUND_M)/FLOOR_M)):2);
      const gone=(!!job.clearedSite.built&&!!year&&year<job.clearedSite.built-3)
        || (floors<5&&p.usability==='01000');
      if(gone&&job.clearedSite.rings.some(r=>inRing(c.cx,c.cy,r)))cands.splice(i,1);
    }
    const regAt = new Map<string, Cand[]>();
    for (const c of cands) if (c.linked) { const k = cell(c.cx, c.cy); regAt.set(k, [...(regAt.get(k) ?? []), c]); }
    const onLinked = (c: Cand) => {
      const i0 = Math.floor(c.cx / 40), j0 = Math.floor(c.cy / 40);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const r of regAt.get(i0 + i + "," + (j0 + j)) ?? [])
        if (inRing(c.cx, c.cy, r.ring) || inRing(r.cx, r.cy, c.ring)) return true;
      return false;
    };
    const box = job.box, HC = job.heightCell ?? 2;
    const hnx = box ? Math.ceil((box[2] - box[0]) / HC) : 0, hny = box ? Math.ceil((box[3] - box[1]) / HC) : 0;
    const roofH = new Float32Array(hnx * hny).fill(-1e4);
    // The roof over the grid's cells whose centres the outline covers (scanlines).
    const rasterRoof = (ring: number[][], top: number) => {
      let y0 = Infinity, y1 = -Infinity;
      for (const p of ring) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      const j0 = Math.max(0, Math.ceil((y0 - box![1]) / HC - 0.5)), j1 = Math.min(hny - 1, Math.floor((y1 - box![1]) / HC - 0.5));
      const xs: number[] = [];
      for (let j = j0; j <= j1; j++) {
        const y = box![1] + (j + 0.5) * HC;
        xs.length = 0;
        for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
          const [ax, ay] = ring[k], [bx, by] = ring[i];
          if ((ay > y) !== (by > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
        xs.sort((a, b) => a - b);
        for (let q = 0; q + 1 < xs.length; q += 2) {
          // (a cell the wall passes through counts as building: no grazing a corner)
          const i0 = Math.max(0, Math.floor((xs[q] - box![0]) / HC)), i1 = Math.min(hnx - 1, Math.floor((xs[q + 1] - box![0]) / HC));
          for (let i = i0; i <= i1; i++) { const o = j * hnx + i; if (top > roofH[o]) roofH[o] = top; }
        }
      }
    };
    // The signs (box mode): named buildings gathered by name and kind.
    const labelAt = new Map<string, { name: string; kind: string; x: number; y: number; top: number; n: number; area: number; tall: number; big: number; info: DroneLabelInfo }>();
    const infoOf = (props: any, bx: number, by: number): DroneLabelInfo => {
      const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : undefined; };
      const pnu = String(props.pnu ?? "").trim(), day = String(props.useapr_day ?? "").replace(/\D/g, "");
      return { bx: Math.round(bx * 10) / 10, by: Math.round(by * 10) / 10, pnu: /^\d{19}$/.test(pnu) ? pnu : undefined, approved: /^(18|19|20)\d{2}/.test(day) ? day : undefined,
        floors: num(props.grnd_flr), basements: num(props.ugrnd_flr), height: num(props.height), area: num(props.totalarea),
        dong: String(props.dong_nm ?? "").trim() || undefined };
    };
    const GOV = /(구청|시청|군청|도청|청사|주민센터|행정복지센터|동사무소|경찰서|지구대|파출소|소방서|안전센터|우체국|법원|검찰청|세무서|교육청|교육지원청|보건소|구의회|시의회|도서관|병무청|출입국|등기소)/;
    const JUNK = /^(\d+|[가-힣]?동|.*주택|근생.*|다세대.*|연립.*|단독.*|상가|창고|화장실|관리동|경비실|주차장|기계실|부속.*|.*근린생활시설)$/;
    const sign = (props: any, cx: number, cy: number, top: number, floors: number, area: number, tall: number) => {
      const raw = String(props.bld_nm ?? "").trim().replace(/\s+/g, " ");
      if (raw.length < 2 || JUNK.test(raw)) return;
      const use = String(props.usability ?? "");
      let kind = "";
      if (GOV.test(raw)) kind = "gov";
      else if (use.startsWith("02") && floors >= 7) kind = "apt";
      else if (use.startsWith("09") || /병원|의료원/.test(raw)) kind = floors >= 4 ? "hospital" : "";
      else if (use.startsWith("10") && /(대학교|대학|고등학교|중학교|초등학교|학교)/.test(raw)) kind = "school";
      else if (floors >= 20 || tall >= 60) kind = "major";
      if (!kind) return;
      const name = kind === "apt" ? raw.replace(/\s*아파트$/, "") : raw;
      const k = kind + ":" + name;
      const e = labelAt.get(k);
      if (!e) labelAt.set(k, { name, kind, x: cx * area, y: cy * area, top, n: 1, area, tall, big: area, info: infoOf(props, cx, cy) });
      else {
        e.x += cx * area; e.y += cy * area; e.top = Math.max(e.top, top); e.tall = Math.max(e.tall, tall); e.n++; e.area += area;
        // (the card tells of the largest building under the sign)
        if (area > e.big) { e.big = area; e.info = infoOf(props, cx, cy); }
      }
    };
    // An outline with courtyards as one ring for the roof's ear clipping: each courtyard joined to
    // the outline by a cut from its rightmost point to the nearest outline point it can see.
    const bridged = (outer: number[][], holes: number[][][]) => {
      let ring = outer.slice();
      const crosses = (a: number[], b: number[], r: number[][]) => {
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const c = r[j], e = r[i];
          if ((c === a || c === b || e === a || e === b)) continue;
          const d1 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]), d2 = (b[0] - a[0]) * (e[1] - a[1]) - (b[1] - a[1]) * (e[0] - a[0]);
          const d3 = (e[0] - c[0]) * (a[1] - c[1]) - (e[1] - c[1]) * (a[0] - c[0]), d4 = (e[0] - c[0]) * (b[1] - c[1]) - (e[1] - c[1]) * (b[0] - c[0]);
          if (d1 * d2 < 0 && d3 * d4 < 0) return true;
        }
        return false;
      };
      for (const h of [...holes].sort((p, q) => Math.max(...q.map(v => v[0])) - Math.max(...p.map(v => v[0])))) {
        let mi = 0;
        for (let k = 1; k < h.length; k++) if (h[k][0] > h[mi][0]) mi = k;
        const M = h[mi];
        const order = ring.map((v, k) => [Math.hypot(v[0] - M[0], v[1] - M[1]), k]).sort((p, q) => p[0] - q[0]);
        let pi = -1;
        for (const [, k] of order) { if (!crosses(M, ring[k], ring) && !holes.some(o => crosses(M, ring[k], o))) { pi = k; break; } }
        if (pi < 0) continue;
        const loop = [...h.slice(mi), ...h.slice(0, mi), M.slice()];
        ring = [...ring.slice(0, pi + 1), ...loop, ring[pi].slice(), ...ring.slice(pi + 1)];
      }
      return ring;
    };
    for (const { ring, area, cx, cy, d, props, linked, holes } of cands) {
      const fl = Math.round(parseFloat(props.grnd_flr) || 0);
      if ((fl >= 5 && area < 25) || (!linked && fl >= 8 && area < 10 * fl + 40)) continue;
      if (!linked && onLinked({ ring, area, cx, cy, d: 0, props, linked, holes: [] })) continue;
      // heights as the register gives them (vworldBuildings.fillHeights)
      const hReg = parseFloat(props.height) || 0, fReg = Math.round(parseFloat(props.grnd_flr) || 0);
      let height = hReg, floors = fReg;
      // (a measured height far over the storeys — 404 m for one — is the storeys' height)
      if (height && fReg && height > fReg * 4.5 + 12) height = 0;
      if (height) floors = floors || Math.max(1, Math.round((height - GROUND_M) / FLOOR_M));
      else if (floors) height = Math.round((floors * FLOOR_M + GROUND_M) * 10) / 10;
      else { floors = 2; height = 6.5; }
      if (height < 2.5) continue;
      if (box) {
        let gr = Infinity;
        for (const [x, y] of ring) gr = Math.min(gr, at(x, y));
        rasterRoof(ring, gr + Math.max(2, height));
        if (cx >= box[0] && cy >= box[1] && cx < box[2] && cy < box[3]) sign(props, cx, cy, gr + Math.max(2, height), floors, area, height);
        // (drawn only by the tile its centroid is in, and not where the view already drew it)
        if (cx < box[0] || cy < box[1] || cx >= box[2] || cy >= box[3] || d <= job.inner) continue;
      }
      const style = styleOf(String(props.usability ?? ""), height, rnd());
      // The walls' colour by the register's structure (건축물대장 구조코드): masonry (1x: 벽돌,
      // 블록, 석조) in brick reds and browns, steel frames (3x) in curtain-wall blue-greys,
      // concrete (2x) and the rest in the painted whites and beiges.
      const sc = String(props.strct_cd ?? "").trim().slice(0, 1);
      const brick = sc === "1", steel = sc === "3" && (style === "office" || style === "shop");
      const tint = (brick ? BRICK : steel ? STEEL : TINTS)[Math.floor(rnd() * (brick ? BRICK : steel ? STEEL : TINTS).length)].slice();
      const lift = brick || steel ? 0 : style === "office" ? 0.4 : style === "apt" ? 0.65 : 0;
      for (let k = 0; k < 3; k++) tint[k] += (1 - tint[k]) * lift;
      // on its own ground: the lowest point under it, sunk 3 m (no gap on a slope)
      let ground = Infinity;
      for (const [x, y] of ring) ground = Math.min(ground, at(x, y));
      const depth = Math.max(2, height), bottom = ground - SINK, top = ground + depth;
      const floorM = job.floorM[style] ?? FLOOR_M;
      const kv = Math.min(2, Math.max(0.5, floorM / (depth / Math.max(1, floors))));
      const b = buf(style);
      const iStart = b.i.length, vWalls = b.p.length / 3;
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
      // the courtyards' walls (clockwise rings: their normals face into the courtyard)
      for (const hole of holes) for (let i = 0; i < hole.length; i++) {
        const [ax, ay] = hole[i], [bx, by] = hole[(i + 1) % hole.length];
        const ex = bx - ax, ey = by - ay, el = Math.hypot(ex, ey) || 1, nx = ey / el, ny = -ex / el;
        const alongX = Math.abs(ey) < Math.abs(ex);
        const hb = b.p.length / 3;
        for (const [x, y, z] of [[ax, ay, bottom], [bx, by, bottom], [bx, by, top], [ax, ay, top]]) {
          b.p.push(x, y, z); b.n.push(nx, ny, 0); b.u.push(alongX ? x : y, (1 - (z - ground)) * kv); b.c.push(tint[0], tint[1], tint[2]);
        }
        b.i.push(hb, hb + 1, hb + 2, hb, hb + 2, hb + 3);
      }
      // roof: ear clipping of the outline (outlines are a few to a few dozen points), the courtyards
      // cut out of it
      const roofRing = holes.length ? bridged(ring, holes) : ring;
      const base = b.p.length / 3;
      for (const [x, y] of roofRing) { b.p.push(x, y, top); b.n.push(0, 0, 1); b.u.push(x, y); b.c.push(tint[0], tint[1], tint[2]); }
      const idx = roofRing.map((_, k) => k);
      const cross = (o: number[], p: number[], q: number[]) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
      let guard = idx.length * idx.length + 16;
      while (idx.length > 3 && guard-- > 0) {
        let cut = false;
        for (let k = 0; k < idx.length; k++) {
          const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
          const A = roofRing[ia], B = roofRing[ib], C = roofRing[ic];
          if (cross(A, B, C) <= 0) continue;
          let inside = false;
          for (const m of idx) {
            if (m === ia || m === ib || m === ic) continue;
            const P = roofRing[m];
            // (a courtyard's cut repeats two points: those on the ear's own corners don't count)
            if ((P[0] === A[0] && P[1] === A[1]) || (P[0] === B[0] && P[1] === B[1]) || (P[0] === C[0] && P[1] === C[1])) continue;
            if (cross(A, B, P) >= 0 && cross(B, C, P) >= 0 && cross(C, A, P) >= 0) { inside = true; break; }
          }
          if (inside) continue;
          b.i.push(base + ia, base + ib, base + ic);
          idx.splice(k, 1); cut = true; break;
        }
        if (!cut) break;
      }
      if (idx.length === 3) b.i.push(base + idx[0], base + idx[1], base + idx[2]);
      if (box) { spans.push(STYLES.indexOf(style), vWalls, base - vWalls, base, roofRing.length); spanRings.push(ring); }
      if (style === "apt" && floors >= 5) apts.push(cx, cy, height, ground, iStart, b.i.length - iStart);
      // (every building of five storeys and up, and the large complexes: their real plan, setbacks
      // and rooftop; lower ones keep their registered outline, which is most of their shape)
      if (box && (floors >= 5 || Math.abs(area) >= 6000)) towers.push(cx, cy, height, ground, iStart, b.i.length - iStart, STYLES.indexOf(style), spanRings.length - 1, area);
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
    const roofs = box ? { h: roofH, nx: hnx, ny: hny, cell: HC, x0: box[0], y0: box[1] } : undefined;
    if (roofs) transfer.push(roofH.buffer);
    const towerArr = box ? new Float32Array(towers) : undefined;
    // (an apartment complex is a sign with two blocks or more, or one tall one)
    // (a name the register holds garbled — question marks or replacement characters where the
    // Hangul was lost — is no sign at all)
    const labels = box ? [...labelAt.values()].filter(e => (e.kind !== "apt" || e.n >= 2 || e.tall >= 45) && !/[?\uFFFD]/.test(e.name))
      .map(e => ({ name: e.name, kind: e.kind, x: e.x / e.area, y: e.y / e.area, top: e.top, n: e.n, info: e.info })) : undefined;
    if (towerArr) transfer.push(towerArr.buffer);
    (self as unknown as Worker).postMessage({ styles, buildings: count, ms: performance.now() - t0, apts: aptArr, footprints:cands.map(c=>c.ring), roofs, towers: towerArr, labels, spans: box ? new Float32Array(spans) : undefined, spanRings: box ? spanRings : undefined }, transfer);
  };
}

/** The worker's script as one Blob URL for the page's lifetime (one a call was never revoked: the
 * drone, making workers tile after tile, piled them up in memory). */
let ringUrl: string | null = null;
function ringWorkerUrl(src: string) { return (ringUrl ??= URL.createObjectURL(new Blob([src], { type: "text/javascript" }))); }

/** The ring's buildings (inner < distance ≤ outer from the result's centre, none already drawn —
 * `near`: their centroids), merged per facade style, made in a worker. */
export function ringBuildings(data: RealEstateBuildingsResponse, near: Float32Array, terrain: Terrain, opts: { outer?: number; inner?: number; floorM: Record<string, number>; seed: number; signal?: AbortSignal }): Promise<RingResult | null> {
  const segs: number[] = [];
  for (const r of data.roads ?? []) if (r.width >= 6) for (let i = 1; i < r.line.length; i++) segs.push(r.line[i - 1][0], r.line[i - 1][1], r.line[i][0], r.line[i][1], r.width / 2);
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
  const worker = new Worker(ringWorkerUrl(src));
  const job: RingJob = {
    urls, lat, lon, inner: opts.inner ?? 0, outer, near, seed: opts.seed, roads: new Float32Array(segs), clearedSite:data.cleared_site,
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

/** One drone tile's buildings (ringBuildings in box mode): those whose centroid lies in `box`
 * (metres east / north of the view's centre) and past `inner` from it, in the view's frame and the
 * same facades as the ring; with every roof over the box on a `heightCell` grid (collisions). The
 * terrain is the tile's own grid, centred at (ox, oy). */
export function ringTile(lat: number, lon: number, key: string, domain: string | null | undefined, box: [number, number, number, number], grid: { h: Float32Array; n: number; R: number; cell: number; ox: number; oy: number }, opts: { inner: number; floorM: Record<string, number>; seed: number; heightCell?: number; signal?: AbortSignal }): Promise<RingResult | null> {
  const kx = Math.cos((lat * Math.PI) / 180) * 111320, ky = 110540, m = 60;
  const q = `BOX(${lon + (box[0] - m) / kx},${lat + (box[1] - m) / ky},${lon + (box[2] + m) / kx},${lat + (box[3] + m) / ky})`;
  const urls = Array.from({ length: 8 }, (_, i) => "https://api.vworld.kr/req/data?" + new URLSearchParams({
    service: "data", request: "GetFeature", crs: "EPSG:4326", geometry: "true", attribute: "true",
    key, domain: domain ?? "https://kospimap.com", data: "LT_C_BLDGINFO", geomFilter: q,
    size: "1000", page: String(i + 1), format: "json", callback: "ringCb",
  }));
  const worker = new Worker(ringWorkerUrl(`(${ringWorkerMain.toString()})()`));
  const job: RingJob = {
    urls, lat, lon, inner: opts.inner, outer: Infinity, near: new Float32Array(0), seed: opts.seed, roads: new Float32Array(0),
    grid, floorM: opts.floorM, box, heightCell: opts.heightCell ?? 2,
  };
  return new Promise(resolve => {
    worker.onmessage = e => { worker.terminate(); resolve(e.data as RingResult); };
    worker.onerror = () => { worker.terminate(); resolve(null); };
    opts.signal?.addEventListener("abort", () => { worker.terminate(); resolve(null); });
    worker.postMessage(job);
  });
}
