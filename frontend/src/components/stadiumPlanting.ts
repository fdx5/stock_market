import type { Planting } from './complexScene';

type Point = [number, number];
export type StadiumTreeMask = { ring: Point[]; box: [number, number, number, number] };

// Jamsil stadium outer boundary, including the open playing field and stands.
// OpenStreetMap way 26254127, relation 6114542; retrieved 2026-10-09 (ODbL).
// https://www.openstreetmap.org/relation/6114542
// A bundled construction-time mask needs no additional API or per-frame checks.
const JAMSIL: Point[] = [
  [127.0712798,37.5129577],[127.0710347,37.5128044],[127.0708517,37.5126038],
  [127.0707449,37.5123711],[127.0707223,37.5121242],[127.0707856,37.5118817],
  [127.0709302,37.5116623],[127.0711448,37.5114825],[127.0714131,37.5113561],
  [127.0717149,37.5112928],[127.072027,37.5112972],[127.0723257,37.5113692],
  [127.0725882,37.5115032],[127.0727627,37.5116528],[127.0728902,37.5118298],
  [127.0729641,37.512025],[127.0729803,37.5122285],[127.0729383,37.5124296],
  [127.0728402,37.5126181],[127.0726908,37.512784],[127.0724982,37.5129189],
  [127.0722721,37.5130159],[127.0720243,37.5130699],[127.0717674,37.513078],
  [127.0715149,37.51304],
];
const CLEARANCE = 4;

export function jamsilTreeMask(lat: number, lon: number, half: number): StadiumTreeMask | null {
  const kx = Math.cos(lat * Math.PI / 180) * 111320;
  const x = (127.0719 - lon) * kx, y = (37.5122 - lat) * 110540;
  if (Math.abs(x) > half + 160 || Math.abs(y) > half + 160) return null;
  const ring: Point[] = JAMSIL.map(([lo, la]) => [(lo-lon)*kx, (la-lat)*110540]);
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  const box: StadiumTreeMask['box'] = [Math.min(...xs)-CLEARANCE, Math.min(...ys)-CLEARANCE,
    Math.max(...xs)+CLEARANCE, Math.max(...ys)+CLEARANCE];
  if (box[0] > half || box[2] < -half || box[1] > half || box[3] < -half) return null;
  return { ring, box };
}

export function stadiumTreeAllowed(mask: StadiumTreeMask, x: number, y: number): boolean {
  const [x0,y0,x1,y1] = mask.box;
  if (x < x0 || x > x1 || y < y0 || y > y1) return true;
  let inside = false;
  for (let i=0,j=mask.ring.length-1;i<mask.ring.length;j=i++) {
    const [ax,ay] = mask.ring[j], [bx,by] = mask.ring[i];
    if ((ay > y) !== (by > y) && x < (bx-ax)*(y-ay)/(by-ay)+ax) inside = !inside;
    const dx=bx-ax,dy=by-ay,length2=dx*dx+dy*dy;
    const t=length2 ? Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/length2)) : 0;
    if ((x-ax-t*dx)**2+(y-ay-t*dy)**2 <= CLEARANCE*CLEARANCE+1e-6) return false;
  }
  return !inside;
}

/** Filter generated tree roots only. Field grass/soil and all other plant lists survive. */
export function withoutStadiumTrees<T extends Planting>(planting: T, mask: StadiumTreeMask | null): T {
  if (!mask) return planting;
  const keep = ([x,y]: number[]) => stadiumTreeAllowed(mask,x,y);
  return { ...planting, trees: planting.trees.filter(keep), street: planting.street.filter(keep),
    ...(planting.groves ? { groves: planting.groves.map(g => ({...g,points:g.points.filter(keep)})).filter(g=>g.points.length) } : {}) };
}
