import type { MarketMapItem } from "../api/client";
import { squarify } from "../treemap";

export const MINI_MAP_LIMIT = 60;
export const MINI_MAP_WIDTH = 360;
export const MINI_MAP_HEIGHT = 210;

/** The same area measure as the full maps: KR capitalization / US index weight.
 * Missing quotes are excluded, and missing returns stay unknown rather than 0%. */
export function atlasMiniMap(items: MarketMapItem[], width = MINI_MAP_WIDTH, height = MINI_MAP_HEIGHT) {
  const unique = new Map<string, MarketMapItem>();
  for (const item of items) {
    if (!item.code || unique.has(item.code) || !Number.isFinite(item.marcap) || item.marcap <= 0 ||
        !Number.isFinite(item.close) || item.close <= 0) continue;
    unique.set(item.code, item);
  }
  const selected = [...unique.values()].sort((a, b) => b.marcap - a.marcap || a.code.localeCompare(b.code)).slice(0, MINI_MAP_LIMIT);
  const byCode = new Map(selected.map(item => [item.code, item]));
  const rects = squarify(selected.map(item => ({ id: item.code, value: item.marcap })), 0, 0, width, height);
  const quoted = selected.filter(item => Number.isFinite(item.change_pct) && !(item.change_pct === 0 && !item.volume && !item.turnover && !item.quote_time));
  return {
    count: selected.length,
    up: quoted.filter(item => item.change_pct > 0).length,
    down: quoted.filter(item => item.change_pct < 0).length,
    flat: quoted.filter(item => item.change_pct === 0).length,
    unknown: selected.length - quoted.length,
    tiles: rects.map(rect => ({ ...rect, item: byCode.get(rect.id)! })),
  };
}
