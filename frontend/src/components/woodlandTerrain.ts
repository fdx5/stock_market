import type { HeightGrid } from './waterCore';

/** A hill is local relief, not height above the selected complex. Self-contained
 * for the far-ground Blob worker. Parcel/building/road masks decide where trees
 * are allowed; this only recognises unclassified hills in the same DEM. */
export function woodedTerrain(g: HeightGrid | null | undefined, x: number, y: number): boolean {
  if (!g) return false;
  const at = (px: number, py: number) => {
    const gx = (px + g.R) / g.cell, gy = (py + g.R) / g.cell;
    if (gx < 0 || gy < 0 || gx >= g.n - 1 || gy >= g.n - 1) return NaN;
    const i = Math.floor(gx), j = Math.floor(gy), a = gx - i, b = gy - j;
    return (g.h[j*g.n+i]*(1-a)+g.h[j*g.n+i+1]*a)*(1-b) + (g.h[(j+1)*g.n+i]*(1-a)+g.h[(j+1)*g.n+i+1]*a)*b;
  };
  const centre = at(x,y); if (!Number.isFinite(centre)) return false;
  let low = centre, high = centre;
  for (const [dx,dy] of [[-48,0],[48,0],[0,-48],[0,48],[-96,0],[96,0],[0,-96],[0,96]]) {
    const h = at(x+dx,y+dy); if (!Number.isFinite(h)) continue;
    low = Math.min(low,h); high = Math.max(high,h);
  }
  return centre-low >= 4 || high-low >= 10;
}
