import { Color } from "three";

/** A dark aerial sample can be a windscreen, shadow or asphalt, not black paint.
 * Preserve clear light/chromatic observations. Ambiguous neutral samples use a
 * plausible, position-stable palette; these are inferred colours, not measured ones.
 * Called once when building a parked car, never during rendering. */
export function parkedCarPaint(r: number, g: number, b: number, lon: number, lat: number): Color {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = .3*r + .59*g + .11*b;
  if (max > .2 && (max-min)/max > .32 && max-min > .12) {
    const exposure = Math.max(1, .48/max);
    return new Color(Math.min(.9,r*exposure),Math.min(.9,g*exposure),Math.min(.9,b*exposure)).convertSRGBToLinear();
  }
  if (l > .62) return new Color("#f2f2f0");
  if (l > .42) return new Color("#b8bcc0");
  let seed = Math.imul(Math.round(lon*1e5), 73856093) ^ Math.imul(Math.round(lat*1e5), 19349663);
  seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  const v = ((seed ^ (seed >>> 16)) >>> 0) / 4294967296;
  return new Color(v < .42 ? "#f2f2f0" : v < .68 ? "#b8bcc0" : v < .80 ? "#65717d" : v < .90 ? "#252b33" : v < .95 ? "#315578" : v < .98 ? "#873d45" : "#b4a38a");
}
