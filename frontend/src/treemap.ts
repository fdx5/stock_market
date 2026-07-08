export interface TreemapItem {
  id: string;
  value: number;
}

export interface TreemapRect extends TreemapItem {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function worstRatio(areas: number[], side: number): number {
  const sum = areas.reduce((a, b) => a + b, 0);
  const rmax = Math.max(...areas);
  const rmin = Math.min(...areas);
  const lenSq = side * side;
  const sumSq = sum * sum;
  return Math.max((lenSq * rmax) / sumSq, sumSq / (lenSq * rmin));
}

/** Squarified treemap (Bruls, Huizing, van Wijk). Caller should pre-sort items descending by value. */
export function squarify(items: TreemapItem[], x: number, y: number, w: number, h: number): TreemapRect[] {
  const total = items.reduce((a, b) => a + b.value, 0);
  if (total <= 0 || items.length === 0 || w <= 0 || h <= 0) return [];

  const scale = (w * h) / total;
  const scaled = items.map((it) => ({ ...it, area: Math.max(it.value * scale, 0) }));

  const result: TreemapRect[] = [];
  let rect: Rect = { x, y, w, h };
  let remaining = scaled;

  while (remaining.length > 0) {
    const side = Math.min(rect.w, rect.h);
    let row: typeof scaled = [];
    let i = 0;

    while (i < remaining.length) {
      const candidate = [...row, remaining[i]];
      if (
        row.length > 0 &&
        worstRatio(
          row.map((it) => it.area),
          side
        ) <
          worstRatio(
            candidate.map((it) => it.area),
            side
          )
      ) {
        break;
      }
      row = candidate;
      i += 1;
    }

    const rowSum = row.reduce((a, b) => a + b.area, 0);
    if (rect.w >= rect.h) {
      const colWidth = rect.h > 0 ? rowSum / rect.h : 0;
      let yCursor = rect.y;
      for (const item of row) {
        const itemHeight = colWidth > 0 ? item.area / colWidth : 0;
        result.push({ id: item.id, value: item.value, x: rect.x, y: yCursor, w: colWidth, h: itemHeight });
        yCursor += itemHeight;
      }
      rect = { x: rect.x + colWidth, y: rect.y, w: rect.w - colWidth, h: rect.h };
    } else {
      const rowHeight = rect.w > 0 ? rowSum / rect.w : 0;
      let xCursor = rect.x;
      for (const item of row) {
        const itemWidth = rowHeight > 0 ? item.area / rowHeight : 0;
        result.push({ id: item.id, value: item.value, x: xCursor, y: rect.y, w: itemWidth, h: rowHeight });
        xCursor += itemWidth;
      }
      rect = { x: rect.x, y: rect.y + rowHeight, w: rect.w, h: rect.h - rowHeight };
    }

    remaining = remaining.slice(i);
  }

  return result;
}

// Diverging blue<->gray<->red scale reusing this app's existing dark-mode series
// colors (up=red, down=blue, per the Korean market convention already used
// throughout the app) so the map's palette matches the rest of the UI.
const NEG_POLE = { r: 0x39, g: 0x87, b: 0xe5 }; // --series-blue (dark)
const MID = { r: 0x38, g: 0x38, b: 0x35 }; // --baseline (dark neutral)
const POS_POLE = { r: 0xe6, g: 0x67, b: 0x67 }; // --series-red (dark)

const FULL_SATURATION_PCT = 5;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function changeToRgb(changePct: number): Rgb {
  const t = Math.max(-1, Math.min(1, changePct / FULL_SATURATION_PCT));
  const [from, to, localT] = t >= 0 ? [MID, POS_POLE, t] : [NEG_POLE, MID, t + 1];
  return {
    r: Math.round(lerp(from.r, to.r, localT)),
    g: Math.round(lerp(from.g, to.g, localT)),
    b: Math.round(lerp(from.b, to.b, localT)),
  };
}

export function rgbToCss({ r, g, b }: Rgb): string {
  return `rgb(${r}, ${g}, ${b})`;
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (c: number) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function textColorForRgb(rgb: Rgb): string {
  return relativeLuminance(rgb) > 0.35 ? "#0b0b0b" : "#ffffff";
}
