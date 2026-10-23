import type { Planting } from './complexScene';

type Point = [number, number];
export type PlantWaterPolygon = { ring: Point[]; holes?: Point[][]; islands?: Point[][] };

/** Vector membership, independent of ground colour, DEM height and raster resolution.
 * Self-contained so the land-use worker uses exactly the same exclusion rule. */
export function plantingWaterMask(polygons: PlantWaterPolygon[]) {
  const prepare = (ring: Point[]) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const rows = new Map<number, number[]>();
    ring.forEach(([x, y], i) => {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      const b = ring[(i + 1) % ring.length];
      for (let j = Math.floor(Math.min(y, b[1]) / 64); j <= Math.floor(Math.max(y, b[1]) / 64); j++) {
        const row = rows.get(j) ?? []; row.push(i); rows.set(j, row);
      }
    });
    return { ring, rows, x0, y0, x1, y1 };
  };
  const prepared = polygons.map(p => ({ outer: prepare(p.ring), holes: (p.holes ?? p.islands ?? []).map(prepare) }));
  // 0 outside, 1 inside, 2 boundary. A shoreline itself is not a planting root.
  const inside = (p: ReturnType<typeof prepare>, x: number, y: number) => {
    if (x < p.x0 || x > p.x1 || y < p.y0 || y > p.y1) return 0;
    let odd = false;
    for (const i of p.rows.get(Math.floor(y / 64)) ?? []) {
      const a = p.ring[i], b = p.ring[(i + 1) % p.ring.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
      if (Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) < 1e-6) return 2;
      if ((a[1] > y) !== (b[1] > y) && x < dx * (y - a[1]) / dy + a[0]) odd = !odd;
    }
    return odd ? 1 : 0;
  };
  return (x: number, y: number) => prepared.some(p => inside(p.outer, x, y) !== 0 && !p.holes.some(h => inside(h, x, y) === 1));
}

/** Every vegetation channel, including street roots and patterned garden beds.
 * Preserve identity when unchanged so a late water answer only rebuilds affected tiles. */
export function filterPlanting(p: Planting, dry: (x: number, y: number) => boolean): Planting {
  let changed = false;
  const points = <T extends readonly number[]>(list: T[]): T[] => {
    const kept = list.filter(q => Number.isFinite(q[0]) && Number.isFinite(q[1]) && dry(q[0], q[1]));
    if (kept.length === list.length) return list;
    changed = true; return kept;
  };
  const result: Planting = { ...p, trees: points(p.trees), shrubs: points(p.shrubs), flowers: points(p.flowers), street: points(p.street),
    ...(p.grass ? { grass: points(p.grass) } : {}), ...(p.border ? { border: points(p.border) } : {}),
    ...(p.groves ? { groves: p.groves.map(g => ({ ...g, points: points(g.points) })) } : {}),
    ...(p.woodlandFlowers ? { woodlandFlowers: p.woodlandFlowers.map(b => ({ ...b, points: points(b.points) })) } : {}) };
  return changed ? result : p;
}
