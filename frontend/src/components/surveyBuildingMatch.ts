import { ShapeUtils, Vector2 } from 'three';

type Point = [number, number];
export type SurveyBlock = { x: number; y: number; h: number; outline: Point[] };
export type SurveyModel = { cx: number; cy: number; hull: Point[]; height: number };
const area = (ring: Point[]) => Math.abs(ring.reduce((s, p, i) => {
  const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1];
}, 0)) / 2;
const bounds = (ring: Point[]) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
};
function intersection(hull: Point[], triangles: Point[][]) {
  let total = 0;
  for (const tri of triangles) {
    let pts = hull;
    const [a, b, c] = tri;
    const sign = Math.sign((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]));
    for (let k = 0; k < 3 && pts.length; k++) {
      const A = tri[k], B = tri[(k + 1) % 3];
      const distance = (p: Point) => sign * ((B[0]-A[0])*(p[1]-A[1])-(B[1]-A[1])*(p[0]-A[0]));
      const out: Point[] = [];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length], dp = distance(p), dq = distance(q);
        if (dp >= 0) out.push(p);
        if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push([p[0]+(q[0]-p[0])*t, p[1]+(q[1]-p[1])*t]); }
      }
      pts = out;
    }
    if (pts.length >= 3) total += area(pts);
  }
  return total;
}

/** A matching height is supporting evidence; a surveyed footprint is stronger.
 * A nearby building across a street must never replace the registered building.
 * Each model belongs to at most one record; a record can include multiple parts. */
export function matchSurveyBuildings(blocks: SurveyBlock[], models: SurveyModel[], ox = 0, oy = 0, complete = true) {
  const prepared = blocks.map(bl => ({ ...bl, area: area(bl.outline), box: bounds(bl.outline),
    triangles: ShapeUtils.triangulateShape(bl.outline.map(p => new Vector2(...p)), []).map(t => t.map(i => bl.outline[i])) }));
  const cells = new Map<string, number[]>();
  prepared.forEach((b, i) => {
    // The grid indexes the registered footprint before exact matching.
    const box = b.outline.length >= 3 ? b.box : [b.x-12,b.y-12,b.x+12,b.y+12];
    for (let y = Math.floor(box[1]/80); y <= Math.floor(box[3]/80); y++) for (let x = Math.floor(box[0]/80); x <= Math.floor(box[2]/80); x++) {
      const key = x+','+y; let list = cells.get(key); if (!list) cells.set(key, list = []); list.push(i);
    }
  });
  const groups = new Map<number, number[]>(), coverage = new Map<number, number>();
  models.forEach((model, mi) => {
    const ring: Point[] = model.hull.map(([x,y]) => [x+ox,y+oy]), box = bounds(ring), ma = area(ring);
    const candidates = new Set<number>();
    const scan = ring.length >= 3 ? box : [model.cx+ox-12,model.cy+oy-12,model.cx+ox+12,model.cy+oy+12];
    for (let y = Math.floor(scan[1]/80); y <= Math.floor(scan[3]/80); y++) for (let x = Math.floor(scan[0]/80); x <= Math.floor(scan[2]/80); x++) for (const i of cells.get(x+','+y) ?? []) candidates.add(i);
    let best = -1, score = 0, overlap = 0;
    for (const i of candidates) {
      const b = prepared[i], d = Math.hypot(b.x-model.cx-ox,b.y-model.cy-oy);
      let value = 0, shared = 0;
      if (ma > 1 && b.area > 1 && box[0] < b.box[2] && box[2] > b.box[0] && box[1] < b.box[3] && box[3] > b.box[1]) {
        shared = intersection(ring, b.triangles);
        const cm = shared/ma, cb = shared/b.area;
        // Include surveyed pieces inside a large record, but exclude a large model
        // extending across unrelated neighbouring records.
        if (cm >= .65 && (cb >= .25 || b.area >= 6000)) value = 2 + cm + Math.min(1, cb) - d*.001;
        else if (cm >= .35 && cb >= .65) value = 2 + cm + cb - d*.001;
      }
      // Retain the existing strict centre/height match as a fallback for survey
      // outlines drawn around a podium rather than its separately modelled tower.
      // A proven footprint match always wins over this fallback.
      if (!value && d < 12 && model.height >= b.h*.65 && model.height <= b.h*1.35) value = 1-d/12;
      if (value > score) { best = i; score = value; overlap = shared; }
    }
    if (best >= 0) { let list = groups.get(best); if (!list) groups.set(best, list = []); list.push(mi); coverage.set(best, (coverage.get(best) ?? 0) + overlap); }
  });
  // A rooftop room alone cannot replace the complete registered tower.
  for (const [i, list] of groups) {
    const b = prepared[i];
    if ((coverage.get(i) ?? 0) < b.area*.55 && !list.some(mi => models[mi].height >= b.h*.65)) groups.delete(i);
    // A timed-out multipart download must not hide the whole registered building
    // after receiving only one wing. Wait for near-complete footprint coverage;
    // broad but low roof pieces also keep the coarse building until the retry.
    if (!complete && ((b.area > 1 && (coverage.get(i) ?? 0) < b.area*.85) || !list.some(mi => models[mi].height >= Math.min(b.h*.65,12)))) groups.delete(i);
  }
  return groups;
}
