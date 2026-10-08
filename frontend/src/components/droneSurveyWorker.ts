/// <reference lib="webworker" />
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { photoBuildingsNear, surveyedShape, type PhotoBuilding } from "./vworld3d";
import { fastMergeVertices } from "./fastMerge";
import { aerialColours, type AerialColours } from "./aerial";

/* The drone's towers in their surveyed shapes (droneWorld.surveyTile), off the page: VWorld's 3D
 * model of each block downloaded and read here, matched to the registered block, shaped
 * (vworld3d.surveyedShape: windowed long fronts, plain end walls, cores and parapet bands) and
 * merged per material. The same rules as the view's ring (ComplexHologram): within 12 m of the
 * block after the two surveys' constant offset, ±35 % of its height; shape only, never the
 * photograph. The page gets arrays: a mesh per material, and the boxes to empty. */

export type SurveyJob = {
  id: number; key: string; lat0: number; lon0: number;
  /** RingResult.towers: x, y, height, ground, index start, count, style, outline, area (9 each) */
  towers: Float32Array;
  /** the outlines of the large complexes (empty for the rest), one per tower */
  outlines: [number, number][][];
  /** each block's colour (r, g, b) */
  tints: Float32Array;
};
export type SurveyPart = { material: number; position: Float32Array; normal: Float32Array; uv: Float32Array | null; color: Float32Array; index: Uint32Array };
/** material: the block's style index (SURVEY_STYLES: its facade), or -1 the plain one */
export type SurveyResult = { id: number; parts: SurveyPart[]; hide: Float32Array; models: number; matched: number; ms: number;
  /** the tall models found (centre x, y and top), for checking */
  tall?: number[] };

/** A tile's buildings' colours, read off the aerial photographs (aerial.ts: the roof's median,
 * the facade's bright paint beside the outline) — read, never drawn. */
export type ColourJob = { kind: "colours"; id: number; key: string; lat0: number; lon0: number; rings: [number, number][][] };
export type ColourResult = { id: number; colours: (AerialColours | null)[] };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (e: MessageEvent<SurveyJob | ColourJob>) => {
  if ((e.data as ColourJob).kind === "colours") {
    const j = e.data as ColourJob;
    // (level 17, ~1 m a pixel: a roof's colour reads as well, at a sixteenth of the pictures)
    const colours = await aerialColours(j.key, j.lat0, j.lon0, j.rings, undefined, 17).catch(() => [] as (AerialColours | null)[]);
    scope.postMessage({ id: j.id, colours } satisfies ColourResult);
    return;
  }
  return survey(e as MessageEvent<SurveyJob>);
};

async function survey(e: MessageEvent<SurveyJob>) {
  const t0 = performance.now();
  const { id, key, lat0, lon0, towers, tints, outlines } = e.data;
  const T = 9;
  const blocks = Array.from({ length: towers.length / T }, (_, i) => ({
    x: towers[i * T], y: towers[i * T + 1], h: towers[i * T + 2], g: towers[i * T + 3], s: towers[i * T + 4], n: towers[i * T + 5], style: towers[i * T + 6],
    c: new THREE.Color(tints[i * 3], tints[i * 3 + 1], tints[i * 3 + 2]), used: false, outline: outlines[i] ?? [],
  }));
  // (a large complex's whole outline is looked over, not just round its centre)
  const probes: { x: number; y: number }[] = [...blocks];
  for (const bl of blocks) for (const [x, y] of bl.outline) probes.push({ x, y });
  let photos: PhotoBuilding[] = [];
  try { photos = await photoBuildingsNear(key, lat0, lon0, probes); } catch { photos = []; }
  const edgeDist = (x: number, y: number, r: [number, number][]) => {
    let d = Infinity;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [ax, ay] = r[j], [bx, by] = r[i], ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / l2));
      d = Math.min(d, Math.hypot(ax + ex * t - x, ay + ey * t - y));
    }
    return d;
  };
  const inside = (x: number, y: number, r: [number, number][]) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; }
    return c;
  };
  // (one survey to the other: their constant offset, from the matches)
  const pairs: [number, number][] = [];
  for (const ph of photos) {
    let bd = 15, best: (typeof blocks)[number] | null = null;
    for (const bl of blocks) { const d = Math.hypot(bl.x - ph.cx, bl.y - ph.cy); if (d < bd) { bd = d; best = bl; } }
    if (best) pairs.push([best.x - ph.cx, best.y - ph.cy]);
  }
  const mid = (v: number[]) => { const q = [...v].sort((a, b) => a - b); return q.length ? q[q.length >> 1] : 0; };
  const [ox, oy] = pairs.length >= 3 ? [mid(pairs.map(p => p[0])), mid(pairs.map(p => p[1]))] : [0, 0];
  const byMat = new Map<number, THREE.BufferGeometry[]>();
  const put = (m: number, g: THREE.BufferGeometry | null, c: THREE.Color) => {
    if (!g) return;
    const n = g.getAttribute("position").count, col = new Float32Array(n * 3);
    for (let j = 0; j < n; j++) { col[j * 3] = c.r; col[j * 3 + 1] = c.g; col[j * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    // (one attribute set per material: merged geometries must agree)
    for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color"].includes(name)) g.deleteAttribute(name);
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const shared = fastMergeVertices(g);
    byMat.set(m, [...(byMat.get(m) ?? []), shared]);
  };
  const hide: number[] = [];
  let matched = 0;
  const taken = new Set<PhotoBuilding>();
  // A large complex: every model whose centre lies in its outline (a tower, its podium, the mall),
  // shaped as surveyed; a supertall that steps back as it rises keeps all of its height painted
  // (no rooftop-room rule: its upper floors are not rooms on a roof).
  for (const bl of blocks) {
    if (bl.outline.length < 3) continue;
    // (inside it, or within 60 m of its edge: a tower's model can sit off a record drawn round its
    // podium and mall)
    const mine = photos.filter(ph => !taken.has(ph) && (inside(ph.cx + ox, ph.cy + oy, bl.outline) || edgeDist(ph.cx + ox, ph.cy + oy, bl.outline) < 60));
    if (!mine.length) continue;
    for (const ph of mine) {
      taken.add(ph);
      ph.geometry.computeBoundingBox();
      const top = ph.geometry.boundingBox!.max.z;
      const shape = surveyedShape(ph, bl.g - 0.25, undefined, 1.0, undefined, top < 150);
      for (const gg of [shape.walls, shape.roofs, shape.cores, shape.ends, shape.bands, shape.painted]) gg?.translate(ox, oy, 0);
      put(bl.style, shape.walls, bl.c); put(bl.style, shape.roofs, bl.c);
      put(-1, shape.cores, bl.c); put(-1, shape.bands, bl.c); put(-1, shape.ends, bl.c.clone().multiplyScalar(0.86));
    }
    bl.used = true; matched++;
    hide.push(bl.style, bl.s, bl.n);
  }
  for (const ph of photos) {
    if (taken.has(ph)) continue;
    const px = ph.cx + ox, py = ph.cy + oy;
    let bd = 12, best: (typeof blocks)[number] | null = null;
    for (const bl of blocks) { if (bl.used) continue; const d = Math.hypot(bl.x - px, bl.y - py); if (d < bd) { bd = d; best = bl; } }
    ph.geometry.computeBoundingBox();
    const top = ph.geometry.boundingBox!.max.z;
    if (!best || top < best.h * 0.65 || top > best.h * 1.35) continue;
    best.used = true; matched++;
    const shape = surveyedShape(ph, best.g - 0.25, undefined, 1.0);
    for (const gg of [shape.walls, shape.roofs, shape.cores, shape.ends, shape.bands, shape.painted]) gg?.translate(ox, oy, 0);
    put(best.style, shape.walls, best.c);
    put(best.style, shape.roofs, best.c);
    put(-1, shape.cores, best.c);
    put(-1, shape.bands, best.c);
    put(-1, shape.ends, best.c.clone().multiplyScalar(0.86));
    hide.push(best.style, best.s, best.n);
  }
  const parts: SurveyPart[] = [], transfer: ArrayBuffer[] = [];
  for (const [material, list] of byMat) {
    // (with and without uv apart: a part made without one keeps the plain material's look)
    const withUv = list.filter(g => g.getAttribute("uv")), without = list.filter(g => !g.getAttribute("uv"));
    for (const group of [withUv, without]) {
      if (!group.length) continue;
      const merged = mergeGeometries(group, false);
      if (!merged) continue;
      const a = (n: string) => (merged.getAttribute(n)?.array as Float32Array | undefined) ?? null;
      const index = merged.index ? new Uint32Array(merged.index.array) : new Uint32Array(Array.from({ length: merged.getAttribute("position").count }, (_, i) => i));
      const part: SurveyPart = { material, position: a("position")!, normal: a("normal")!, uv: a("uv"), color: a("color")!, index };
      parts.push(part);
      transfer.push(part.position.buffer as ArrayBuffer, part.normal.buffer as ArrayBuffer, part.color.buffer as ArrayBuffer, part.index.buffer as ArrayBuffer);
      if (part.uv) transfer.push(part.uv.buffer as ArrayBuffer);
    }
  }
  const hideArr = new Float32Array(hide);
  transfer.push(hideArr.buffer);
  const tall: number[] = [];
  for (const ph of photos) { ph.geometry.computeBoundingBox(); const top = ph.geometry.boundingBox!.max.z; if (top > 60) tall.push(Math.round(ph.cx + ox), Math.round(ph.cy + oy), Math.round(top)); }
  const out: SurveyResult = { id, parts, hide: hideArr, models: photos.length, matched, ms: performance.now() - t0, tall };
  scope.postMessage(out, [...new Set(transfer)]);
}
