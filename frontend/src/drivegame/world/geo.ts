/* The drive game's ground plan: one metre frame for the whole session (x east, y north, metres
 * from where the game started), and the world cut into fixed tiles by latitude and longitude, so
 * a tile's key and its cached data are the same in every session wherever it started. */

/** Tile size in degrees: about 277 m north–south and 265 m east–west at Seoul's latitude. */
export const TILE_LAT = 0.0025;
export const TILE_LON = 0.003;

export interface Origin { lat: number; lon: number; kx: number; ky: number }

export function originAt(lat: number, lon: number): Origin {
  return { lat, lon, kx: Math.cos((lat * Math.PI) / 180) * 111_320, ky: 110_540 };
}

export const toFrame = (o: Origin, lon: number, lat: number): [number, number] => [(lon - o.lon) * o.kx, (lat - o.lat) * o.ky];
export const toLonLat = (o: Origin, x: number, y: number): [number, number] => [o.lon + x / o.kx, o.lat + y / o.ky];

export const tileKey = (i: number, j: number) => `${i}_${j}`;

/** The tile holding a frame point. */
export function tileOf(o: Origin, x: number, y: number): [number, number] {
  const [lon, lat] = toLonLat(o, x, y);
  return [Math.floor(lon / TILE_LON), Math.floor(lat / TILE_LAT)];
}

/** A tile's rectangle in the frame: [x0, y0, x1, y1]. (The same arithmetic everywhere: two
 * neighbours' shared edge is the same number to the last bit.) */
export function tileRect(o: Origin, i: number, j: number): [number, number, number, number] {
  return [(i * TILE_LON - o.lon) * o.kx, (j * TILE_LAT - o.lat) * o.ky, ((i + 1) * TILE_LON - o.lon) * o.kx, ((j + 1) * TILE_LAT - o.lat) * o.ky];
}

/** Distance from a point to a rectangle (0 inside). */
export function rectDist(r: [number, number, number, number], x: number, y: number) {
  const dx = Math.max(r[0] - x, 0, x - r[2]), dy = Math.max(r[1] - y, 0, y - r[3]);
  return Math.hypot(dx, dy);
}
