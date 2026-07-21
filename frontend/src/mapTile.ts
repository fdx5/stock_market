/** Tile-legibility metrics shared by every treemap surface in the app: the full-page
 * market maps (MarketMapPage, which renders these both as DOM tiles and again onto a
 * canvas for its PNG export) and the dashboard's per-sector map (SectorMapPanel).
 *
 * These thresholds decide what a tile is big enough to say. Duplicating them per
 * surface is what lets a map's export silently drift from what it displays, so they
 * live in one place and every caller reads the same answer.
 */

export const TILE_FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', sans-serif";

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Used to decide whether a tile has room to show its company icon: only when the name
 * still fits at full length (no CSS ellipsis) after making room for the icon, so the
 * icon never pushes a name into truncation. */
export function measureTextWidth(text: string, fontSizePx: number, weight = 700): number {
  if (measureCtx === undefined) {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  if (!measureCtx) return text.length * fontSizePx * 0.6;
  measureCtx.font = `${weight} ${fontSizePx}px ${TILE_FONT_FAMILY}`;
  return measureCtx.measureText(text).width;
}

/** Scales name/pct text with how much area the tile actually has, instead of a single
 * fixed size for every tile that clears the "show text" threshold — a tile many times
 * larger than another (e.g. Samsung vs. a mid-cap name) reads noticeably larger too. */
export function tileFontSizes(w: number, h: number): { name: number; pct: number } {
  const minDim = Math.min(w, h);
  const name = Math.min(26, 11 + Math.max(0, minDim - 30) * 0.09);
  const pctSize = Math.min(19, 10 + Math.max(0, minDim - 30) * 0.07);
  return { name, pct: pctSize };
}

export function tileDisplayInfo(w: number, h: number, name: string) {
  const showName = w >= 46 && h >= 30;
  const showPctOnly = !showName && w >= 24 && h >= 16;
  const fontSizes = tileFontSizes(w, h);
  const iconSize = Math.round(fontSizes.name);
  const TILE_H_PADDING = 10; // .kospi-map-tile's 5px left/right padding
  const ICON_GAP = 4;
  const availableWithIcon = w - TILE_H_PADDING - iconSize - ICON_GAP;
  // Only worth showing the icon when the name still fits at full length afterward —
  // a truncated "Sam… 🏷" reads worse than no icon at all.
  const showIcon = showName && measureTextWidth(name, fontSizes.name) <= availableWithIcon;
  return { showName, showPctOnly, fontSizes, showIcon, iconSize, iconGap: ICON_GAP };
}

export function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
