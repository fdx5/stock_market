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
export function matchSurveyBuildings(blocks: SurveyBlock[], models: SurveyModel[], ox = 0, oy = 0, complete:boolean|readonly boolean[] = true) {
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
    if (!(typeof complete==='boolean'?complete:complete[i]) && ((b.area > 1 && (coverage.get(i) ?? 0) < b.area*.85) || !list.some(mi => models[mi].height >= Math.min(b.h*.65,12)))) groups.delete(i);
  }
  return groups;
}

/** Polygon vertex averages differ for L-shaped/slab buildings and their convex
 * survey hulls. They are not evidence of a coordinate offset. Infer alignment
 * only from similarly sized, already overlapping whole footprint bounds and a
 * consistent consensus; otherwise retain the source's georeferenced position. */
export function surveyAlignment(blocks:SurveyBlock[],models:SurveyModel[]):[number,number]{
  const groups=matchSurveyBuildings(blocks,models),pairs:[number,number][]=[];
  for(const [i,list] of groups){
    const b=bounds(blocks[i].outline),m=bounds(list.flatMap(i=>models[i].hull));
    const bw=b[2]-b[0],bh=b[3]-b[1],mw=m[2]-m[0],mh=m[3]-m[1];
    if(Math.min(bw,bh,mw,mh)<2||mw/bw<.85||mw/bw>1.15||mh/bh<.85||mh/bh>1.15)continue;
    const x=(b[0]+b[2]-m[0]-m[2])/2,y=(b[1]+b[3]-m[1]-m[3])/2;
    if(Math.hypot(x,y)<=12)pairs.push([x,y]);
  }
  if(pairs.length<3)return[0,0];
  const median=(a:number[])=>{const s=a.sort((a,b)=>a-b);return s[Math.floor(s.length/2)];};
  const x=median(pairs.map(p=>p[0])),y=median(pairs.map(p=>p[1]));
  return pairs.filter(p=>Math.hypot(p[0]-x,p[1]-y)<=1).length>=Math.max(3,Math.ceil(pairs.length*.7))?[x,y]:[0,0];
}

/** A failed neighbour or empty forest tile does not make every apartment's
 * successfully downloaded model incomplete. Only failures near its footprint
 * retain the strict multipart protection for that record. */
export function surveyCompleteFor(blocks:SurveyBlock[],failures:{kind:string;x?:number;y?:number;box?:readonly number[]}[]){
  return blocks.map(b=>{
    const box=b.outline.length>=3?bounds(b.outline):[b.x-12,b.y-12,b.x+12,b.y+12];
    return !failures.some(f=>{
      if(f.kind==='unknown')return true;
      if(f.box)return f.box[0]<=box[2]+20&&f.box[2]>=box[0]-20&&f.box[1]<=box[3]+20&&f.box[3]>=box[1]-20;
      return f.x!==undefined&&f.y!==undefined&&f.x>=box[0]-20&&f.x<=box[2]+20&&f.y>=box[1]-20&&f.y<=box[3]+20;
    });
  });
}
