/// <reference lib="webworker" />
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { photoBuildingsNear, surveyedShape, type PhotoBuilding } from "./vworld3d";
import { fastMergeVertices } from "./fastMerge";
import { aerialColours, type AerialColours } from "./aerial";
import { matchSurveyBuildings } from './surveyBuildingMatch';

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
  /** Registered floor height relative to the shared facade's floor grid. */
  facadeScale?: Float32Array;
};
export type SurveyPart = { material: number; position: Float32Array; normal: Float32Array; uv: Float32Array | null; color: Float32Array; index: Uint32Array;
  /** style, source outline, first vertex, vertex count, surface (0 wall, 1 roof, 2 end) */
  paintSpans: Uint32Array; sphere: [number, number, number, number]; box: [number, number, number, number, number, number] };
/** material: the block's style index (SURVEY_STYLES: its facade), or -1 the plain one */
export type SurveyResult = { id: number; parts: SurveyPart[]; hide: Float32Array; models: number; matched: number; ms: number; retry: boolean;
  /** the tall models found (centre x, y and top), for checking */
  tall?: number[] };

/** A tile's buildings' colours, read off the aerial photographs (aerial.ts: the roof's median,
 * the facade's bright paint beside the outline) — read, never drawn. */
export type ColourJob = { kind: "colours"; id: number; key: string; lat0: number; lon0: number; rings: [number, number][][] };
export type ColourResult = { id: number; colours: (AerialColours | null)[]; retry: boolean };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (e: MessageEvent<SurveyJob | ColourJob>) => {
  if ((e.data as ColourJob).kind === "colours") {
    const j = e.data as ColourJob;
    // (level 17, ~1 m a pixel: a roof's colour reads as well, at a sixteenth of the pictures)
    try {
      const colours = await aerialColours(j.key, j.lat0, j.lon0, j.rings, undefined, 17, true);
      scope.postMessage({ id: j.id, colours, retry: false } satisfies ColourResult);
    } catch { scope.postMessage({ id: j.id, colours: [], retry: true } satisfies ColourResult); }
    return;
  }
  return survey(e as MessageEvent<SurveyJob>);
};

async function survey(e: MessageEvent<SurveyJob>) {
  const t0 = performance.now();
  const { id, key, lat0, lon0, towers, tints, outlines, facadeScale } = e.data;
  const T = 9;
  const blocks = Array.from({ length: towers.length / T }, (_, i) => ({
    x: towers[i * T], y: towers[i * T + 1], h: towers[i * T + 2], g: towers[i * T + 3], s: towers[i * T + 4], n: towers[i * T + 5], style: towers[i * T + 6],
    c: new THREE.Color(tints[i * 3], tints[i * 3 + 1], tints[i * 3 + 2]), scale: facadeScale?.[i] ?? 1, source: towers[i * T + 7], outline: outlines[i] ?? [],
  }));
  // (a large complex's whole outline is looked over, not just round its centre)
  const probes: { x: number; y: number }[] = [...blocks];
  for (const bl of blocks) for (const [x, y] of bl.outline) probes.push({ x, y });
  let photos: PhotoBuilding[] = [];
  let failures = 0;
  try { photos = await photoBuildingsNear(key, lat0, lon0, probes, { onFailure: () => failures++, deadlineMs: 8000 }); } catch { failures++; }
  // (one survey to the other: their constant offset, from the matches)
  const pairs: [number, number][] = [];
  for (const ph of photos) {
    let bd = 15, best: (typeof blocks)[number] | null = null;
    for (const bl of blocks) { const d = Math.hypot(bl.x - ph.cx, bl.y - ph.cy); if (d < bd) { bd = d; best = bl; } }
    ph.geometry.computeBoundingBox();
    if (best) pairs.push([best.x - ph.cx, best.y - ph.cy]);
  }
  const mid = (v: number[]) => { const q = [...v].sort((a, b) => a - b); return q.length ? q[q.length >> 1] : 0; };
  const [ox, oy] = pairs.length >= 3 ? [mid(pairs.map(p => p[0])), mid(pairs.map(p => p[1]))] : [0, 0];
  type Piece = { g: THREE.BufferGeometry; style: number; source: number; surface: number };
  const byMat = new Map<number, Piece[]>();
  const put = (m: number, g: THREE.BufferGeometry | null, c: THREE.Color, bl: (typeof blocks)[number], surface = 0) => {
    if (!g) return;
    const n = g.getAttribute("position").count, col = new Float32Array(n * 3);
    for (let j = 0; j < n; j++) { col[j * 3] = c.r; col[j * 3 + 1] = c.g; col[j * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const uv = g.getAttribute('uv');
    if (m >= 0 && surface === 0 && uv && bl.scale !== 1) for (let j = 0; j < uv.count; j++) uv.setY(j,uv.getY(j)*bl.scale);
    // (one attribute set per material: merged geometries must agree)
    for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color"].includes(name)) g.deleteAttribute(name);
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const shared = fastMergeVertices(g);
    if (shared !== g) g.dispose();
    let list = byMat.get(m); if (!list) byMat.set(m, list = []);
    list.push({ g: shared, style: bl.style, source: bl.source, surface });
  };
  const hide: number[] = [];
  let matched = 0;
  const groups = matchSurveyBuildings(blocks, photos.map(ph => ({ ...ph, height: ph.geometry.boundingBox!.max.z })), ox, oy, failures === 0);
  for (const [bi, models] of groups) {
    const bl = blocks[bi];
    for (const mi of models) {
      const ph = photos[mi], top = ph.geometry.boundingBox!.max.z;
      const shape = surveyedShape(ph, bl.g - 0.25, undefined, 1.0, undefined, top < 150);
      for (const gg of [shape.walls, shape.roofs, shape.cores, shape.ends, shape.bands, shape.painted]) gg?.translate(ox, oy, 0);
      put(bl.style, shape.walls, bl.c, bl); put(-1, shape.roofs, bl.c, bl, 1);
      put(-1, shape.cores, bl.c, bl); put(-1, shape.bands, bl.c, bl); put(-1, shape.ends, bl.c.clone().multiplyScalar(0.86), bl, 2);
      shape.painted?.dispose();
    }
    matched++;
    hide.push(bl.style, bl.s, bl.n);
  }
  const parts: SurveyPart[] = [], transfer: ArrayBuffer[] = [];
  for (const [material, list] of byMat) {
    // (with and without uv apart: a part made without one keeps the plain material's look)
    const withUv = list.filter(p => p.g.getAttribute("uv")), without = list.filter(p => !p.g.getAttribute("uv"));
    for (const group of [withUv, without]) {
      if (!group.length) continue;
      const merged = mergeGeometries(group.map(p => p.g), false);
      if (!merged) continue;
      const a = (n: string) => (merged.getAttribute(n)?.array as Float32Array | undefined) ?? null;
      const index = merged.index ? new Uint32Array(merged.index.array) : new Uint32Array(Array.from({ length: merged.getAttribute("position").count }, (_, i) => i));
      const spans: number[] = []; let first = 0;
      for (const p of group) { const n = p.g.getAttribute('position').count; spans.push(p.style, p.source, first, n, p.surface); first += n; p.g.dispose(); }
      merged.computeBoundingBox(); merged.computeBoundingSphere();
      const s = merged.boundingSphere!;
      const b = merged.boundingBox!;
      const part: SurveyPart = { material, position: a("position")!, normal: a("normal")!, uv: a("uv"), color: a("color")!, index, paintSpans: new Uint32Array(spans), sphere: [s.center.x,s.center.y,s.center.z,s.radius], box: [b.min.x,b.min.y,b.min.z,b.max.x,b.max.y,b.max.z] };
      parts.push(part);
      transfer.push(part.position.buffer as ArrayBuffer, part.normal.buffer as ArrayBuffer, part.color.buffer as ArrayBuffer, part.index.buffer as ArrayBuffer);
      if (part.uv) transfer.push(part.uv.buffer as ArrayBuffer);
      transfer.push(part.paintSpans.buffer as ArrayBuffer);
      merged.dispose();
    }
  }
  const hideArr = new Float32Array(hide);
  transfer.push(hideArr.buffer);
  const tall: number[] = [];
  for (const ph of photos) { ph.geometry.computeBoundingBox(); const top = ph.geometry.boundingBox!.max.z; if (top > 60) tall.push(Math.round(ph.cx + ox), Math.round(ph.cy + oy), Math.round(top)); }
  photos.forEach(ph => ph.geometry.dispose());
  const out: SurveyResult = { id, parts, hide: hideArr, models: photos.length, matched, ms: performance.now() - t0, retry: failures > 0, tall };
  scope.postMessage(out, [...new Set(transfer)]);
}
