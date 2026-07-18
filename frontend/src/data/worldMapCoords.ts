/** Percentage position (of a 2:1 equirectangular panel) for each HQ country string as
 * returned by companiesmarketcap.com's scrape (see `country` field on GlobalTop20Item).
 * Computed from each country's capital/major-hub lon/lat via x=(lon+180)/360*100,
 * y=(90-lat)/180*100. Only covers countries that actually show up in the global TOP20
 * roster (confirmed: USA, Taiwan, S. Arabia, S. Korea) plus a handful of others likely
 * to rotate into it (China, Japan, major EU hubs) — an unmapped country just means no
 * pin is drawn for that company, not a crash.
 */
export const WORLD_MAP_COUNTRY_COORDS: Record<string, { x: number; y: number }> = {
  USA: { x: 22.6, y: 27.9 },
  Taiwan: { x: 83.8, y: 36.1 },
  "S. Arabia": { x: 63.0, y: 36.3 },
  "S. Korea": { x: 85.3, y: 29.1 },
  China: { x: 82.3, y: 27.8 },
  Japan: { x: 88.8, y: 30.2 },
  Germany: { x: 53.7, y: 20.8 },
  France: { x: 50.7, y: 22.9 },
  UK: { x: 50.0, y: 21.4 },
  Switzerland: { x: 52.4, y: 23.7 },
  Netherlands: { x: 51.4, y: 20.9 },
  Denmark: { x: 53.5, y: 19.1 },
  Canada: { x: 29.0, y: 24.8 },
  Ireland: { x: 48.3, y: 20.4 },
  India: { x: 71.4, y: 34.1 },
  Australia: { x: 91.4, y: 69.6 },
};

export function coordsForCountry(country: string): { x: number; y: number } | null {
  return WORLD_MAP_COUNTRY_COORDS[country] ?? null;
}
