import type { WoodlandBed } from './landscapeDiversity';

type Point = [number, number];
export type PalaceGarden = { id: string; x: number; y: number; scaleX: number; rimWidth: number; rings: Point[][] };
export type PalaceGardenPlanting = {
  id: string; earthM2: number; lawnM2: number; flowerM2: number;
  beds: WoodlandBed[]; grass: Point[];
};

/** Requested landscape treatment, rather than a claim about the historical courtyards.
 * Only the heritage parcel containing each palace centre receives this treatment. */
const PALACES = [
  { id: 'gyeongbokgung', lat: 37.5796, lon: 126.9770, reach: 700, rimWidth: 36 },
  { id: 'changgyeonggung', lat: 37.5787, lon: 126.9948, reach: 1000, rimWidth: 28 },
  { id: 'deoksugung', lat: 37.5658, lon: 126.9751, reach: 400, rimWidth: 22 },
];

export function palaceGardens(lat: number, lon: number, half: number): PalaceGarden[] {
  const kx = Math.cos(lat * Math.PI / 180) * 111320;
  return PALACES.flatMap(p => {
    const x = (p.lon - lon) * kx, y = (p.lat - lat) * 110540;
    if (Math.abs(x) > half + p.reach || Math.abs(y) > half + p.reach) return [];
    return [{ id: p.id, x, y, scaleX: Math.cos(p.lat * Math.PI / 180) * 111320 / kx, rimWidth:p.rimWidth,rings:[] }];
  });
}

/** Adjacent palaces, streets, ponds and other land uses must keep their own surfaces. */
export function palaceParcelGarden(kind: string, rings: Point[][], gardens: PalaceGarden[]): PalaceGarden | null {
  if (kind !== '사') return null;
  const inside = (x: number, y: number, ring: Point[]) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j], [bx, by] = ring[i];
      if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) hit = !hit;
    }
    return hit;
  };
  return gardens.find(g => rings[0]?.length >= 3 && inside(g.x, g.y, rings[0]) && !rings.slice(1).some(r => inside(g.x, g.y, r))) ?? null;
}

/** Lawn and flower borders follow the actual compound boundary. The central
 * courtyards and entrance axis stay earth; there are no circular interior beds.
 * Rings use palace-relative metres, independent of the tile or viewing origin. */
export function palaceGardenCover(g: PalaceGarden, x: number, y: number): number {
  const u = Math.round((x - g.x) * g.scaleX * 1000) / 1000, v = Math.round((y - g.y) * 1000) / 1000;
  if (Math.abs(u) < 18) return 0;
  let distance2 = Infinity;
  for(const ring of g.rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [ax,ay]=ring[j],[bx,by]=ring[i],dx=bx-ax,dy=by-ay;
    const t=Math.max(0,Math.min(1,((u-ax)*dx+(v-ay)*dy)/(dx*dx+dy*dy||1)));
    distance2=Math.min(distance2,(u-ax-dx*t)**2+(v-ay-dy*t)**2);
  }
  const distance=Math.sqrt(distance2);
  if(distance>g.rimWidth)return 0;
  const species = 2 + ((Math.floor(u/63) + Math.floor(v/81)) % 4 + 4) % 4;
  return distance>g.rimWidth-5 && distance<g.rimWidth-1.5 ? species : 1;
}

/** Shared by the ground worker and its browser regression fixture. No GPU readback. */
export function paintPalaceGarden(
  ctx: OffscreenCanvasRenderingContext2D, mask: Uint8ClampedArray, g: PalaceGarden, size: number, half: number,
  blocked: Uint8ClampedArray | null, nearHalf: number, cover: typeof palaceGardenCover,
): PalaceGardenPlanting {
  const image = ctx.getImageData(0, 0, size, size), d = image.data, metres = 2 * half / size;
  const colors = [[154, 124, 184], [196, 113, 148], [215, 179, 77], [220, 217, 188]];
  const species = ['lavender', 'cosmos', 'coreopsis', 'daisy'];
  const result: PalaceGardenPlanting = { id: g.id, earthM2: 0, lawnM2: 0, flowerM2: 0, beds: species.map(species => ({ species, points: [] })), grass: [] };
  // Boundary distance is sampled once on a palace-relative 1.5m lattice rather
  // than walking hundreds of parcel edges for every texture pixel and plant.
  const cell=1.5,u0=Math.floor((-half-g.x)*g.scaleX/cell),v0=Math.floor((-half-g.y)/cell);
  const nx=Math.ceil((half-g.x)*g.scaleX/cell)-u0+2,ny=Math.ceil((half-g.y)/cell)-v0+2;
  const covers=new Uint8Array(nx*ny);
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)covers[j*nx+i]=cover(g,g.x+(u0+i+.5)*cell/g.scaleX,g.y+(v0+j+.5)*cell);
  const kindAt=(x:number,y:number)=>{const i=Math.floor((x-g.x)*g.scaleX/cell)-u0,j=Math.floor((y-g.y)/cell)-v0;return covers[j*nx+i]??0;};
  const sample = (x: number, y: number) => {
    const px = Math.floor((x + half) / metres), py = Math.floor((half - y) / metres);
    if (px < 0 || py < 0 || px >= size || py >= size) return 0;
    const o = (py * size + px) * 4;
    return mask[o + 3] > 200 && d[o + 3] > 200 && (!blocked || blocked[o + 3] < 128) ? kindAt(x,y) : 0;
  };
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const o = (py * size + px) * 4;
    if (mask[o + 3] < 200 || d[o + 3] < 200 || blocked && blocked[o + 3] > 127) continue;
    const x = -half + (px + .5) * metres, y = half - (py + .5) * metres, kind = kindAt(x,y);
    if (!kind) { result.earthM2 += metres * metres; continue; }
    const u = (x - g.x) * g.scaleX, v = y - g.y;
    const noise = Math.sin(Math.floor(u * 1.3) * 12.9898 + Math.floor(v * 1.3) * 78.233) * 43758.5453;
    const shade = .94 + (noise - Math.floor(noise)) * .12;
    const color = kind > 1 && noise - Math.floor(noise) > .3 ? colors[kind - 2] : [76, 121, 58];
    d[o] = color[0] * shade; d[o + 1] = color[1] * shade; d[o + 2] = color[2] * shade;
    if (kind > 1) result.flowerM2 += metres * metres; else result.lawnM2 += metres * metres;
  }
  ctx.putImageData(image, 0, 0);
  // Palace-relative lattices: no duplicated plants or changes in a neighbouring tile.
  for (const [step, flowers] of [[1.8, true], [4.2, false]] as const) {
    const x0 = Math.floor((-half - g.x) * g.scaleX / step), x1 = Math.ceil((half - g.x) * g.scaleX / step);
    const y0 = Math.floor((-half - g.y) / step), y1 = Math.ceil((half - g.y) / step);
    for (let iy = y0; iy <= y1; iy++) for (let ix = x0; ix <= x1; ix++) {
      const x = g.x + (ix + .25 * Math.sin(ix * 13 + iy * 7)) * step / g.scaleX;
      const y = g.y + (iy + .25 * Math.sin(ix * 3 + iy * 17)) * step;
      if (x < -half || x >= half || y < -half || y >= half || Math.abs(x) < nearHalf && Math.abs(y) < nearHalf) continue;
      const kind = sample(x, y);
      if (flowers && kind > 1) result.beds[kind - 2].points.push([x, y]);
      else if (!flowers && kind === 1) result.grass.push([x, y]);
    }
  }
  result.beds = result.beds.filter(b => b.points.length);
  return result;
}
