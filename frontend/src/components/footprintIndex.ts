import {inRing} from './ringMath';
type Ring=[number,number][];

/** Bucketed footprint rings, for "inside a building" tests. */
export function ringIndex(rings: Ring[]) {
  // (numeric cells, and each ring's bounds first: a point clear of them is outside — the same
  // answers as testing every ring in the cell, without walking long road outlines for each sample)
  const cell = 30, map = new Map<number, { r: Ring; x0: number; y0: number; x1: number; y1: number }[]>();
  const key = (gx: number, gy: number) => (gx + 1048576) * 2097152 + (gy + 1048576);
  for (const r of rings) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const e = { r, x0: x0 - 1e-6, y0: y0 - 1e-6, x1: x1 + 1e-6, y1: y1 + 1e-6 };
    for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) {
      const k = key(gx, gy), l = map.get(k);
      if (l) l.push(e); else map.set(k, [e]);
    }
  }
  return (x: number, y: number) => {
    const l = map.get(key(Math.floor(x / cell), Math.floor(y / cell)));
    if (l) for (const e of l) if (x >= e.x0 && x <= e.x1 && y >= e.y0 && y <= e.y1 && inRing([x, y], e.r)) return true;
    return false;
  };
}
