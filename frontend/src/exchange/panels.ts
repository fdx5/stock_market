/* Painters for every display on the trading floor.
 *
 * Each panel paints into a 720-unit-tall design space (width = 720 × aspect); the canvas is
 * scaled to its real pixel size, so layouts stay identical at any texture resolution. Displays
 * read as OLED panels: true black, saturated colour, glow only on the figures that matter. */
import type { MarketMapItem, MarketTickerItem } from "../api/client";
import { changeToRgb, rgbToCss, textColorForRgb } from "../treemap";
import {
  ASSET_SINGLES, MARKETS, PANEL_LABELS, STOCK_PANELS, assetSymbol, changeText, companyLogo, displayValue, fixedValue,
  isPrice, rowsForPanel, shortTime, stockIndex, type ExchangeMarket, type FloorSnapshot, type Language,
} from "./marketCore";

export type G = CanvasRenderingContext2D;
/** page/prev/t drive list page flips: t runs 0→1 over a flip, 1 when settled. */
export type PaintEnv = { lang: Language; series: Record<string, number[]>; now: number; cycle: number; logo: LogoDraw; page?: number; prev?: number; t?: number };
type LogoDraw = (g: G, market: ExchangeMarket, code: string, x: number, y: number, size: number) => void;
type Painter = (g: G, w: number, h: number, d: FloorSnapshot, e: PaintEnv) => void;

export const FONT = {
  kr: '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
  num: '"IBM Plex Sans Condensed", "Pretendard Variable", sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
  led: 'Doto, "IBM Plex Mono", monospace',
  disp: '"Big Shoulders Display", "IBM Plex Sans Condensed", sans-serif',
};
export const UP = "#ff3d5f", DOWN = "#3b8dff", FLAT = "#8b94a8";
export const tone = (v: number | null | undefined) => v == null || !Number.isFinite(v) || v === 0 ? FLAT : v > 0 ? UP : DOWN;
const arrow = (v: number | null | undefined) => v == null || !Number.isFinite(v) || v === 0 ? "■" : v > 0 ? "▲" : "▼";

// ------------------------------------------------------------------ primitives
type TextOpts = { w?: number; f?: string; a?: CanvasTextAlign; glow?: number; max?: number; ls?: number; base?: CanvasTextBaseline };
export function txt(g: G, s: string, x: number, y: number, size: number, color: string, o: TextOpts = {}) {
  g.font = `${o.w ?? 600} ${size}px ${o.f ?? FONT.kr}`;
  g.textAlign = o.a ?? "left";
  g.textBaseline = o.base ?? "alphabetic";
  const spacing = g as G & { letterSpacing?: string };
  if ("letterSpacing" in g) spacing.letterSpacing = (o.ls ?? 0) + "px";
  let value = s;
  if (o.max && measure(g, value) > o.max) {
    // Longest prefix that fits with an ellipsis: binary search, not one measureText per character.
    let lo = 1, hi = value.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (measure(g, value.slice(0, mid) + "…") <= o.max) lo = mid; else hi = mid - 1;
    }
    value = value.slice(0, lo) + "…";
  }
  if (o.glow) { g.shadowColor = color; g.shadowBlur = o.glow; }
  g.fillStyle = color;
  g.fillText(value, x, y);
  if (o.glow) g.shadowBlur = 0;
  if ("letterSpacing" in g) spacing.letterSpacing = "0px";
  return measure(g, value);
}

/** Text widths repeat every repaint (names, labels, figures): cache them per font and spacing. */
const widths = new Map<string, number>();
function measure(g: G, s: string): number {
  const spacing = (g as G & { letterSpacing?: string }).letterSpacing ?? "";
  const font = g.font, size = /(\d+(?:\.\d+)?)px/.exec(font);
  // Outline fonts scale linearly: measure once at 100 px and scale, so tiles of every size
  // (heat maps, auto-fit labels) share one measurement. Letter spacing does not scale: exact path.
  const scaled = !!size && (spacing === "" || spacing === "0px");
  const ref = scaled ? font.replace(size[0], "100px") : font;
  const key = ref + "|" + spacing + "|" + s;
  let w = widths.get(key);
  if (w === undefined) {
    if (widths.size > 6000) widths.clear();
    if (scaled) { g.font = ref; w = g.measureText(s).width; g.font = font; }
    else w = g.measureText(s).width;
    widths.set(key, w);
  }
  return scaled ? w * Number(size[1]) / 100 : w;
}

function rr(g: G, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function alpha(hex: string, a: number) {
  return hex + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0");
}

function hashHue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** Diverging heat colour: deep blue (−) through graphite to crimson (+). */
/** The site's market-map colour scale (same as /map), so every heat display reads identically. */
export function heat(v: number | null | undefined, _span = 3) {
  if (v == null || !Number.isFinite(v)) return "#1a1d25";
  return rgbToCss(changeToRgb(v));
}

export function pill(g: G, v: number | null | undefined, x: number, y: number, size: number, align: "left" | "right" = "left", label?: string) {
  const s = label ?? `${arrow(v)} ${changeText(v)}`;
  g.font = `700 ${size}px ${FONT.num}`;
  const tw = measure(g, s), pw = tw + size * .9, ph = size * 1.42;
  const x0 = align === "right" ? x - pw : x;
  const c = tone(v);
  rr(g, x0, y - ph * .74, pw, ph, ph * .28);
  g.fillStyle = alpha(c, .17);
  g.fill();
  g.strokeStyle = alpha(c, .45);
  g.lineWidth = 1.5;
  g.stroke();
  txt(g, s, x0 + size * .45, y, size, c, { w: 700, f: FONT.num, glow: size * .35 });
  return pw;
}

function background(g: G, w: number, h: number, accent: string) {
  g.fillStyle = "#000";
  g.fillRect(0, 0, w, h);
  const wash = g.createRadialGradient(w * .12, -h * .25, 10, w * .12, -h * .25, w * .9);
  wash.addColorStop(0, alpha(accent, .2));
  wash.addColorStop(.45, alpha(accent, .05));
  wash.addColorStop(1, "#0000");
  g.fillStyle = wash;
  g.fillRect(0, 0, w, h);
  const floor = g.createLinearGradient(0, h * .7, 0, h);
  floor.addColorStop(0, "#0000");
  floor.addColorStop(1, alpha(accent, .06));
  g.fillStyle = floor;
  g.fillRect(0, h * .7, w, h * .3);
  g.strokeStyle = "#ffffff12";
  g.lineWidth = 2;
  g.strokeRect(9, 9, w - 18, h - 18);
  // Corner ticks give each display a machined, instrument-like frame.
  g.strokeStyle = alpha(accent, .7);
  g.lineWidth = 3;
  for (const [cx, cy, sx, sy] of [[9, 9, 1, 1], [w - 9, 9, -1, 1], [9, h - 9, 1, -1], [w - 9, h - 9, -1, -1]]) {
    g.beginPath();
    g.moveTo(cx, cy + sy * 26); g.lineTo(cx, cy); g.lineTo(cx + sx * 26, cy);
    g.stroke();
  }
}

/** Standard header; returns the y where content starts. */
function header(g: G, w: number, d: FloorSnapshot, e: PaintEnv, id: string, accent: string, sub?: string, scale = 1) {
  const [ko, en] = PANEL_LABELS[id] ?? [id, id];
  const title = e.lang === "ko" ? ko : en;
  const s = scale;
  g.fillStyle = accent;
  g.shadowColor = accent; g.shadowBlur = 14;
  rr(g, 38, 34 * s, 8, 50 * s, 4); g.fill();
  g.shadowBlur = 0;
  const tw = txt(g, title, 62, 74 * s, 44 * s, "#f4f6fb", { w: 700 });
  txt(g, (sub ?? en).toUpperCase(), 62 + tw + 22, 72 * s, 20 * s, alpha(accent, .9), { w: 600, f: FONT.num, ls: 3, max: w - tw - 520 });
  const stamp = shortTime(d.received).replace(" KST", "");
  const live = !d.failed && !!d.received;
  g.fillStyle = live ? "#33ff9c" : "#ffb020";
  g.shadowColor = g.fillStyle; g.shadowBlur = 12;
  g.beginPath(); g.arc(w - 46, 62 * s, 7 * s, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0;
  txt(g, live ? "LIVE  " + stamp : "DELAYED", w - 64, 70 * s, 21 * s, "#9aa3b6", { w: 500, f: FONT.mono, a: "right" });
  const line = g.createLinearGradient(38, 0, w - 38, 0);
  line.addColorStop(0, alpha(accent, .8));
  line.addColorStop(.5, alpha(accent, .18));
  line.addColorStop(1, "#ffffff08");
  g.fillStyle = line;
  g.fillRect(38, 104 * s, w - 76, 2);
  return 130 * s;
}

function waiting(g: G, x: number, y: number, w: number, h: number, e: PaintEnv, label?: string) {
  g.strokeStyle = "#ffffff14";
  g.setLineDash([6, 8]);
  g.strokeRect(x, y, w, h);
  g.setLineDash([]);
  txt(g, label ?? (e.lang === "ko" ? "데이터 수신 대기" : "Awaiting data"), x + w / 2, y + h / 2 + 10, 28, "#6b7488", { a: "center", w: 500 });
}

type ChartOpts = { base?: number; labels?: boolean; glow?: boolean; ma?: number; digits?: number; fill?: number; dot?: boolean; minmax?: boolean; width?: number };
export function areaChart(g: G, pts: readonly number[], x: number, y: number, w: number, h: number, color: string, o: ChartOpts = {}) {
  const points = pts.filter(Number.isFinite);
  const labelW = o.labels ? 118 : 0;
  const cw = w - labelW;
  if (points.length < 2) {
    g.strokeStyle = "#ffffff10";
    for (let i = 0; i <= 4; i++) g.fillRect(x, y + h * i / 4, cw, 1);
    return;
  }
  let lo = Math.min(...points), hi = Math.max(...points);
  if (o.base != null && Number.isFinite(o.base)) { lo = Math.min(lo, o.base); hi = Math.max(hi, o.base); }
  const pad = (hi - lo) * .1 || hi * .01 || 1;
  lo -= pad; hi += pad;
  const px = (i: number) => x + i / (points.length - 1) * cw;
  const py = (v: number) => y + (hi - v) / (hi - lo) * h;
  g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gy = y + h * i / 4;
    g.fillStyle = "#ffffff10";
    g.fillRect(x, gy, cw, 1.5);
    if (o.labels) txt(g, displayValue(hi - (hi - lo) * i / 4, o.digits ?? 2), x + w - 6, gy + 8, 19, "#7d869a", { a: "right", w: 500, f: FONT.mono });
  }
  for (let i = 1; i < 6; i++) { g.fillStyle = "#ffffff07"; g.fillRect(x + cw * i / 6, y, 1.5, h); }
  if (o.base != null && Number.isFinite(o.base)) {
    g.strokeStyle = "#ffffff55";
    g.setLineDash([8, 8]);
    g.beginPath(); g.moveTo(x, py(o.base)); g.lineTo(x + cw, py(o.base)); g.stroke();
    g.setLineDash([]);
  }
  g.beginPath();
  points.forEach((v, i) => i ? g.lineTo(px(i), py(v)) : g.moveTo(px(i), py(v)));
  const stroke = new Path2D();
  points.forEach((v, i) => i ? stroke.lineTo(px(i), py(v)) : stroke.moveTo(px(i), py(v)));
  g.lineTo(px(points.length - 1), y + h);
  g.lineTo(x, y + h);
  g.closePath();
  const fill = g.createLinearGradient(0, y, 0, y + h);
  fill.addColorStop(0, alpha(color, o.fill ?? .42));
  fill.addColorStop(.7, alpha(color, .06));
  fill.addColorStop(1, alpha(color, 0));
  g.fillStyle = fill;
  g.fill();
  if (o.ma && points.length > o.ma) {
    const ma = new Path2D();
    for (let i = o.ma - 1; i < points.length; i++) {
      let sum = 0;
      for (let k = i - o.ma + 1; k <= i; k++) sum += points[k];
      const v = sum / o.ma;
      if (i === o.ma - 1) ma.moveTo(px(i), py(v)); else ma.lineTo(px(i), py(v));
    }
    g.strokeStyle = "#ffd36a";
    g.lineWidth = 2.2;
    g.setLineDash([2, 0]);
    g.globalAlpha = .75;
    g.stroke(ma);
    g.globalAlpha = 1;
  }
  g.lineJoin = "round";
  g.lineWidth = o.width ?? 4;
  g.strokeStyle = color;
  if (o.glow !== false) { g.shadowColor = color; g.shadowBlur = 16; }
  g.stroke(stroke);
  g.shadowBlur = 0;
  const lx = px(points.length - 1), ly = py(points[points.length - 1]);
  if (o.dot !== false) {
    g.fillStyle = alpha(color, .25);
    g.beginPath(); g.arc(lx, ly, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff";
    g.shadowColor = color; g.shadowBlur = 18;
    g.beginPath(); g.arc(lx, ly, 6.5, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
  }
  if (o.minmax) {
    const iMax = points.indexOf(Math.max(...points)), iMin = points.indexOf(Math.min(...points));
    txt(g, "H " + displayValue(points[iMax], o.digits ?? 2), Math.min(px(iMax), x + cw - 120), py(points[iMax]) - 14, 19, "#ffb3c0", { w: 600, f: FONT.mono });
    txt(g, "L " + displayValue(points[iMin], o.digits ?? 2), Math.min(px(iMin), x + cw - 120), py(points[iMin]) + 30, 19, "#a9cbff", { w: 600, f: FONT.mono });
  }
  if (o.labels) {
    const label = displayValue(points[points.length - 1], o.digits ?? 2);
    g.font = `700 21px ${FONT.mono}`;
    const lw = measure(g, label) + 18;
    rr(g, x + cw + 4, ly - 16, Math.min(lw, labelW), 32, 6);
    g.fillStyle = color; g.fill();
    txt(g, label, x + cw + 13, ly + 8, 21, "#000", { w: 700, f: FONT.mono, max: labelW - 16 });
  }
}

export function spark(g: G, pts: readonly number[], x: number, y: number, w: number, h: number, color: string, width = 2.6) {
  areaChart(g, pts, x, y, w, h, color, { glow: false, dot: false, fill: .25, width });
  if (pts.length < 2) return;
}

function monogram(g: G, label: string, x: number, y: number, size: number) {
  const hue = hashHue(label);
  const grad = g.createLinearGradient(x, y, x + size, y + size);
  grad.addColorStop(0, `hsl(${hue} 70% 48%)`);
  grad.addColorStop(1, `hsl(${(hue + 40) % 360} 70% 28%)`);
  rr(g, x, y, size, size, size * .26);
  g.fillStyle = grad;
  g.fill();
  txt(g, label.slice(0, 2).toUpperCase(), x + size / 2, y + size * .66, size * .4, "#fff", { a: "center", w: 800, f: FONT.num });
}

function rows(d: FloorSnapshot, id: string) { return rowsForPanel(d, id); }
const name = (d: FloorSnapshot, r: MarketMapItem) => d.market === "sp500" ? r.code : r.name;
const t = (e: PaintEnv, ko: string, en: string) => e.lang === "ko" ? ko : en;

function moneyKr(v: number, e: PaintEnv) {
  // KR turnover arrives in KRW; show 조/억.
  if (v >= 1e12) return (v / 1e12).toFixed(2) + t(e, "조", "T");
  return Math.round(v / 1e8).toLocaleString("en-US") + t(e, "억", "00M");
}

/** A paged block. While a flip animates the old page slides up and fades as the new one rises in. */
function paged(g: G, e: PaintEnv, pages: number, x: number, y: number, w: number, h: number, draw: (page: number) => void, accent = "#ffffff") {
  const page = (e.page ?? 0) % pages, prev = (e.prev ?? 0) % pages, t = e.t ?? 1;
  g.save();
  g.beginPath(); g.rect(x, y - 4, w, h + 8); g.clip();
  if (t >= 1 || page === prev) draw(page);
  else {
    const k = 1 - Math.pow(1 - t, 3);
    g.save(); g.globalAlpha = 1 - k; g.translate(0, -k * h * .28); draw(prev); g.restore();
    g.save(); g.globalAlpha = k; g.translate(0, (1 - k) * h * .28); draw(page); g.restore();
  }
  g.restore();
  if (pages < 2) return;
  for (let i = 0; i < pages; i++) {
    const cx = x + w - (pages - 1 - i) * 26 - 8;
    g.fillStyle = i === page ? accent : "#ffffff30";
    rr(g, cx - (i === page ? 14 : 5), y + h + 12, i === page ? 28 : 10, 8, 4); g.fill();
  }
}

// ------------------------------------------------------------------ squarified treemap
type Rect = { x: number; y: number; w: number; h: number };
function squarify<T>(items: { v: number; item: T }[], box: Rect): (Rect & { item: T })[] {
  const out: (Rect & { item: T })[] = [];
  const total = items.reduce((s, i) => s + i.v, 0);
  if (!total) return out;
  const scale = box.w * box.h / total;
  let rest = items.map(i => ({ ...i, a: i.v * scale }));
  let r = { ...box };
  while (rest.length) {
    const short = Math.min(r.w, r.h);
    let row: typeof rest = [], best = Infinity;
    for (const item of rest) {
      const next = [...row, item];
      const sum = next.reduce((s, i) => s + i.a, 0);
      const mx = Math.max(...next.map(i => i.a)), mn = Math.min(...next.map(i => i.a));
      const worst = Math.max(short * short * mx / (sum * sum), sum * sum / (short * short * mn));
      if (worst > best) break;
      best = worst; row = next;
    }
    const sum = row.reduce((s, i) => s + i.a, 0);
    const thick = sum / short;
    let off = 0;
    for (const item of row) {
      const len = item.a / thick;
      out.push(r.w >= r.h ? { x: r.x, y: r.y + off, w: thick, h: len, item: item.item } : { x: r.x + off, y: r.y, w: len, h: thick, item: item.item });
      off += len;
    }
    r = r.w >= r.h ? { x: r.x + thick, y: r.y, w: r.w - thick, h: r.h } : { x: r.x, y: r.y + thick, w: r.w, h: r.h - thick };
    rest = rest.slice(row.length);
  }
  return out;
}

// ------------------------------------------------------------------ panels
const P: Record<string, Painter> = {};

P.overview = (g, w, h, d, e) => {
  const spec = MARKETS[d.market];
  const c = spec.color;
  background(g, w, h, c);
  const idx = d.index;
  // Left: the benchmark in display type.
  txt(g, spec.label, 70, 150, 92, c, { f: FONT.disp, w: 800, ls: 6, glow: 26 });
  txt(g, spec.venue + "  ·  " + t(e, "기준 지수", "BENCHMARK INDEX"), 74, 196, 26, "#aab3c6", { w: 600, f: FONT.num, ls: 3 });
  txt(g, displayValue(idx?.close), 64, 372, 188, "#ffffff", { f: FONT.num, w: 700, glow: 30 });
  const chg = idx?.change;
  pill(g, chg, 72, 460, 46);
  txt(g, t(e, "기준 시각 ", "As of ") + shortTime(idx?.time), 72, 530, 24, "#8a93a7", { w: 500, f: FONT.mono });
  // Breadth strip
  const total = d.up + d.down + d.flat;
  const bx = 72, by = 572, bw = 560;
  txt(g, t(e, "상승", "ADV"), bx, by, 24, UP, { w: 700 });
  txt(g, String(d.up), bx + 70, by, 30, UP, { w: 700, f: FONT.num });
  txt(g, t(e, "보합", "UNCH"), bx + 190, by, 24, FLAT, { w: 700 });
  txt(g, String(d.flat), bx + 260, by, 30, FLAT, { w: 700, f: FONT.num });
  txt(g, t(e, "하락", "DEC"), bx + 360, by, 24, DOWN, { w: 700 });
  txt(g, String(d.down), bx + 430, by, 30, DOWN, { w: 700, f: FONT.num });
  if (total) {
    let x = bx;
    for (const [n, col] of [[d.up, UP], [d.flat, FLAT], [d.down, DOWN]] as const) {
      const ww = n / total * bw;
      g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 10;
      g.fillRect(x, by + 22, Math.max(0, ww - 3), 12);
      x += ww;
    }
    g.shadowBlur = 0;
  }
  // Right: large chart.
  const cx = 720, cy = 120, cw = w - cx - 60, ch = 430;
  txt(g, d.market === "sp500" ? t(e, "장중 시계열", "INTRADAY") : t(e, "최근 거래일 종가", "DAILY CLOSES"), cx, 96, 24, "#8f99ad", { w: 600, f: FONT.num, ls: 3 });
  const pts = idx?.points ?? [];
  if (pts.length >= 2) areaChart(g, pts, cx, cy, cw, ch, c, { labels: true, base: pts[0], minmax: true, digits: 2, width: 5 });
  else waiting(g, cx, cy, cw, ch, e);
  // Bottom: sister markets + FX.
  const others: [string, number | null | undefined, number | null | undefined, string, number[]][] = [];
  for (const key of Object.keys(MARKETS) as ExchangeMarket[]) {
    if (key === d.market) continue;
    const v = d.indices[key];
    others.push([MARKETS[key].label, v?.close, v?.change, MARKETS[key].color, v?.points ?? []]);
  }
  const fx = d.tickers["KRW=X"];
  others.push(["USD/KRW", fx?.price, fx?.change_pct, "#4ade80", fx?.points ?? []]);
  const nq = d.tickers["NQ=F"];
  others.push(["NASDAQ FUT", nq?.price, nq?.change_pct, "#818cf8", nq?.points ?? []]);
  const cardW = (cw + 0) / others.length;
  others.forEach(([label, value, change, col, points], i) => {
    const x = cx + i * cardW, y = 590;
    rr(g, x + 4, y, cardW - 14, 100, 10);
    g.fillStyle = "#0d1018"; g.fill();
    g.strokeStyle = alpha(col, .4); g.lineWidth = 1.5; g.stroke();
    txt(g, label, x + 22, y + 34, 22, col, { w: 700, f: FONT.num, ls: 2 });
    txt(g, displayValue(value), x + 22, y + 80, 38, "#fff", { w: 700, f: FONT.num });
    txt(g, changeText(change), x + cardW - 30, y + 34, 22, tone(change), { w: 700, f: FONT.num, a: "right" });
    spark(g, points.slice(-80), x + cardW * .55, y + 50, cardW * .4, 40, tone(change), 2);
  });
};

P.treemap = (g, w, h, d, e) => {
  background(g, w, h, "#ffffff");
  const top = header(g, w, d, e, "treemap", "#e8ecf5", MARKETS[d.market].label + " · " + t(e, "시가총액 가중", "CAP WEIGHTED"));
  const box = { x: 38, y: top, w: w - 76, h: h - top - 70 };
  if (!d.rows.length) { waiting(g, box.x, box.y, box.w, box.h, e); return; }
  const bySector = new Map<string, MarketMapItem[]>();
  for (const r of d.rows) { const k = r.sector || "—"; bySector.set(k, [...(bySector.get(k) ?? []), r]); }
  const sectors = [...bySector.entries()].map(([k, list]) => ({ v: list.reduce((s, r) => s + (r.marcap || 1), 0), item: { k, list } }))
    .sort((a, b) => b.v - a.v);
  for (const s of squarify(sectors, box)) {
    const inner = { x: s.x + 2, y: s.y + 26, w: s.w - 4, h: s.h - 28 };
    g.fillStyle = "#0a0c12";
    g.fillRect(s.x, s.y, s.w, s.h);
    txt(g, s.item.k, s.x + 8, s.y + 20, 18, "#c9d0de", { w: 700, max: s.w - 14 });
    if (inner.h < 8 || inner.w < 8) continue;
    const tiles = squarify(s.item.list.map(r => ({ v: r.marcap || 1, item: r })).sort((a, b) => b.v - a.v), inner);
    for (const tile of tiles) {
      const r = tile.item;
      const grad = g.createLinearGradient(tile.x, tile.y, tile.x, tile.y + tile.h);
      grad.addColorStop(0, heat(r.change_pct));
      grad.addColorStop(1, heat(r.change_pct * .75));
      g.fillStyle = grad;
      g.fillRect(tile.x + 1.5, tile.y + 1.5, tile.w - 3, tile.h - 3);
      const fs = Math.max(12, Math.min(30, Math.sqrt(tile.w * tile.h) / 6.5));
      if (tile.w > 52 && tile.h > fs * 2.2) {
        txt(g, name(d, r), tile.x + tile.w / 2, tile.y + tile.h / 2 - fs * .15, fs, "#fff", { a: "center", w: 600, max: tile.w - 10 });
        txt(g, changeText(r.change_pct), tile.x + tile.w / 2, tile.y + tile.h / 2 + fs * .95, fs * .78, "#ffffffd8", { a: "center", w: 600, f: FONT.num });
      }
    }
  }
  // Legend
  const lx = w - 560, ly = h - 34;
  for (let i = 0; i <= 12; i++) {
    const v = -3 + i * .5;
    g.fillStyle = heat(v);
    g.fillRect(lx + i * 40, ly - 16, 38, 18);
  }
  txt(g, "−3%", lx - 12, ly, 18, "#9aa3b6", { a: "right", f: FONT.num });
  txt(g, "+3%", lx + 13 * 40 + 8, ly, 18, "#9aa3b6", { f: FONT.num });
  txt(g, `${d.rows.length} ${t(e, "종목 표본", "stocks in sample")}`, 40, ly, 20, "#8892a6", { w: 500 });
};

P.heatgrid = (g, w, h, d, e) => {
  // Area ∝ market cap (as on /map), coloured on the site's scale; top 40 by cap.
  const c = "#ffd166";
  background(g, w, h, c);
  const list = d.rows.slice(0, 40);
  const top = header(g, w, d, e, "heatgrid", c, MARKETS[d.market].label + " TOP " + list.length + " · " + t(e, "시총 면적", "AREA = CAP"));
  if (!list.length) { waiting(g, 38, top, w - 76, h - top - 40, e); return; }
  const tiles = squarify(list.map(r => ({ v: Math.max(r.marcap, 1), item: r })), { x: 38, y: top, w: w - 76, h: h - top - 30 });
  for (const tile of tiles) {
    const r = tile.item, rgb = changeToRgb(r.change_pct);
    g.fillStyle = rgbToCss(rgb);
    g.fillRect(tile.x + 1.5, tile.y + 1.5, tile.w - 3, tile.h - 3);
    const ink = textColorForRgb(rgb);
    const fs = Math.max(11, Math.min(34, Math.sqrt(tile.w * tile.h) / 7));
    if (tile.w > 70 && tile.h > 70) e.logo(g, d.market, r.code, tile.x + tile.w / 2 - fs * .75, tile.y + tile.h / 2 - fs * 2.6, fs * 1.5);
    if (tile.w > 44 && tile.h > fs * 2.4) {
      txt(g, name(d, r), tile.x + tile.w / 2, tile.y + tile.h / 2 + fs * .2, fs, ink, { a: "center", w: 700, max: tile.w - 8 });
      txt(g, changeText(r.change_pct), tile.x + tile.w / 2, tile.y + tile.h / 2 + fs * 1.25, fs * .8, ink, { a: "center", w: 600, f: FONT.num });
    }
  }
};

P.breadth = (g, w, h, d, e) => {
  const c = "#7cf2c8";
  background(g, w, h, c);
  const top = header(g, w, d, e, "breadth", c);
  const total = d.up + d.down + d.flat;
  const cx = 300, cy = top + (h - top) / 2 - 10, r = 190;
  const parts = [[d.up, UP], [d.flat, FLAT], [d.down, DOWN]] as const;
  let a = -Math.PI / 2;
  g.lineWidth = 46;
  g.strokeStyle = "#151924";
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  if (total) for (const [n, col] of parts) {
    const span = n / total * Math.PI * 2;
    g.strokeStyle = col; g.shadowColor = col; g.shadowBlur = 20;
    g.beginPath(); g.arc(cx, cy, r, a + .015, a + span - .015); g.stroke();
    a += span;
  }
  g.shadowBlur = 0;
  const ratio = total ? d.up / total * 100 : null;
  txt(g, ratio == null ? "—" : ratio.toFixed(0) + "%", cx, cy + 22, 96, "#fff", { a: "center", f: FONT.num, w: 700, glow: 20 });
  txt(g, t(e, "상승 종목 비율", "ADVANCING SHARE"), cx, cy + 70, 22, "#9fb0c6", { a: "center", w: 600 });
  const lx = 560;
  const lines = [[t(e, "상승", "Advancing"), d.up, UP], [t(e, "보합", "Unchanged"), d.flat, FLAT], [t(e, "하락", "Declining"), d.down, DOWN]] as const;
  lines.forEach(([label, n, col], i) => {
    const y = top + 70 + i * 128;
    txt(g, label, lx, y, 30, col, { w: 700 });
    txt(g, total ? String(n) : "—", w - 70, y + 6, 74, col, { a: "right", f: FONT.num, w: 700, glow: 14 });
    g.fillStyle = "#151924"; g.fillRect(lx, y + 26, w - 70 - lx, 12);
    if (total) { g.fillStyle = col; g.fillRect(lx, y + 26, (w - 70 - lx) * n / total, 12); }
  });
  const adr = d.down ? d.up / d.down : null;
  txt(g, `ADR ${adr == null ? "—" : adr.toFixed(2)}   ·   ${t(e, "표본", "sample")} ${total}/${d.rows.length}`, lx, h - 44, 24, "#a6b2c6", { w: 600, f: FONT.num });
};

P.histogram = (g, w, h, d, e) => {
  const c = "#a78bfa";
  background(g, w, h, c);
  const top = header(g, w, d, e, "histogram", c);
  const changes = d.rows.map(r => r.change_pct).filter(Number.isFinite);
  const bins = Array.from({ length: 17 }, () => 0);
  for (const v of changes) bins[Math.max(0, Math.min(16, Math.round(v) + 8))]++;
  const max = Math.max(1, ...bins);
  const x0 = 70, y0 = h - 90, bw = (w - 140) / 17, bh = y0 - top - 40;
  bins.forEach((n, i) => {
    const v = i - 8;
    const hh = n / max * bh;
    const col = v > 0 ? UP : v < 0 ? DOWN : FLAT;
    const grad = g.createLinearGradient(0, y0 - hh, 0, y0);
    grad.addColorStop(0, col);
    grad.addColorStop(1, alpha(col, .25));
    rr(g, x0 + i * bw + 5, y0 - hh, bw - 10, hh, 6);
    g.fillStyle = grad; g.shadowColor = col; g.shadowBlur = 12; g.fill(); g.shadowBlur = 0;
    if (n) txt(g, String(n), x0 + i * bw + bw / 2, y0 - hh - 12, 22, "#e6e9f2", { a: "center", w: 700, f: FONT.num });
    txt(g, (v > 0 ? "+" : "") + (i === 0 ? "≤-8" : i === 16 ? "≥8" : String(v)), x0 + i * bw + bw / 2, y0 + 34, 19, "#8f98ac", { a: "center", f: FONT.num, w: 600 });
  });
  g.fillStyle = "#ffffff30"; g.fillRect(x0, y0, w - 140, 2);
  if (changes.length) {
    const sorted = [...changes].sort((a, b) => a - b);
    const mean = changes.reduce((s, v) => s + v, 0) / changes.length;
    const med = sorted[Math.floor(sorted.length / 2)];
    txt(g, `${t(e, "평균", "MEAN")} ${changeText(mean)}   ${t(e, "중앙값", "MEDIAN")} ${changeText(med)}   σ ${Math.sqrt(changes.reduce((s, v) => s + (v - mean) ** 2, 0) / changes.length).toFixed(2)}`,
      w - 60, top + 30, 24, "#d9ccff", { a: "right", w: 600, f: FONT.num });
  }
};

P.sectors = (g, w, h, d, e) => {
  const c = "#60a5fa";
  background(g, w, h, c);
  const top = header(g, w, d, e, "sectors", c, t(e, "시가총액 가중 등락률", "CAP-WEIGHTED CHANGE"));
  const all = d.sectors.slice(0, 18);
  if (!all.length) { waiting(g, 38, top, w - 76, h - top - 40, e); return; }
  const max = Math.max(.5, ...all.map(s => Math.abs(s.change)));
  const capTotal = d.sectors.reduce((s, x) => s + x.cap, 0) || 1;
  const rowH = (h - top - 50) / 9;
  const mid = w * .62;
  paged(g, e, Math.ceil(all.length / 9), 38, top, w - 76, h - top - 50, page => all.slice(page * 9, page * 9 + 9).forEach((s, i) => {
    const y = top + i * rowH + rowH / 2;
    txt(g, s.name, 50, y + 10, 27, "#e6ebf5", { w: 650, max: mid - 360 });
    txt(g, `${s.count}${t(e, "종목", "")} · ${(s.cap / capTotal * 100).toFixed(1)}%`, mid - 300, y + 10, 21, "#7f89a0", { f: FONT.num, w: 500 });
    const bw = Math.abs(s.change) / max * (w - mid - 170);
    g.fillStyle = "#ffffff12"; g.fillRect(mid, y - rowH * .3, 2, rowH * .6);
    const col = tone(s.change);
    const grad = g.createLinearGradient(mid, 0, mid + bw * Math.sign(s.change || 1), 0);
    grad.addColorStop(0, alpha(col, .3)); grad.addColorStop(1, col);
    g.fillStyle = grad;
    if (s.change >= 0) g.fillRect(mid, y - 12, bw, 24); else g.fillRect(mid - Math.min(bw, 150), y - 12, Math.min(bw, 150), 24);
    txt(g, changeText(s.change), w - 50, y + 11, 30, col, { a: "right", w: 700, f: FONT.num, glow: 8 });
  }), c);
};

P.capshare = (g, w, h, d, e) => {
  const c = "#f472b6";
  background(g, w, h, c);
  const top = header(g, w, d, e, "capshare", c, t(e, "표본 시가총액 내 비중", "SHARE OF SAMPLE CAP"));
  const total = d.rows.reduce((s, r) => s + (r.marcap || 0), 0);
  if (!total) { waiting(g, 38, top, w - 76, h - top - 40, e); return; }
  const top8 = d.rows.slice(0, 8);
  const palette = ["#f472b6", "#a78bfa", "#60a5fa", "#22d3ee", "#34d399", "#facc15", "#fb923c", "#f87171", "#475569"];
  const cx = 290, cy = top + (h - top) / 2, r = 185;
  let a = -Math.PI / 2;
  const slices = [...top8.map(r => r.marcap), total - top8.reduce((s, r) => s + r.marcap, 0)];
  slices.forEach((v, i) => {
    const span = v / total * Math.PI * 2;
    g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, r, a, a + span); g.closePath();
    g.fillStyle = palette[i]; g.fill();
    g.strokeStyle = "#000"; g.lineWidth = 4; g.stroke();
    a += span;
  });
  g.fillStyle = "#000"; g.beginPath(); g.arc(cx, cy, r * .58, 0, Math.PI * 2); g.fill();
  const share = top8.slice(0, 3).reduce((s, x) => s + x.marcap, 0) / total * 100;
  txt(g, share.toFixed(1) + "%", cx, cy + 16, 62, "#fff", { a: "center", w: 700, f: FONT.num, glow: 16 });
  txt(g, t(e, "상위 3종목", "TOP 3"), cx, cy + 52, 22, "#c8b3d6", { a: "center", w: 600 });
  const lx = 540, rowH = (h - top - 30) / 9;
  [...top8, null].forEach((row, i) => {
    const y = top + 8 + i * rowH + rowH / 2;
    g.fillStyle = palette[i]; rr(g, lx, y - 12, 24, 24, 6); g.fill();
    txt(g, row ? name(d, row) : t(e, "기타", "Others"), lx + 40, y + 9, 25, "#e8ecf4", { w: 600, max: w - lx - 230 });
    txt(g, ((row ? row.marcap : slices[8]) / total * 100).toFixed(1) + "%", w - 60, y + 10, 27, palette[i], { a: "right", w: 700, f: FONT.num });
  });
};

P.investor = (g, w, h, d, e) => {
  const c = "#34d399";
  background(g, w, h, c);
  const top = header(g, w, d, e, "investor", c, (d.market === "kosdaq" ? "KOSDAQ" : "KOSPI") + " · " + t(e, "순매수 억원", "NET BUY, KRW 100M"));
  const tot = d.investorTotals;
  const groups = [[t(e, "개인", "Retail"), tot?.individual_amount], [t(e, "외국인", "Foreign"), tot?.foreign_amount], [t(e, "기관", "Institution"), tot?.institution_amount]] as const;
  const max = Math.max(1, ...groups.map(([, v]) => Math.abs(v ?? 0)));
  const colW = (w * .5 - 60) / 3;
  groups.forEach(([label, v], i) => {
    const x = 50 + i * colW, mid = top + 230;
    txt(g, label, x + colW / 2, top + 40, 28, "#e6ebf4", { a: "center", w: 700 });
    const hh = Math.abs(v ?? 0) / max * 170;
    const col = tone(v);
    const grad = g.createLinearGradient(0, mid - hh, 0, mid + hh);
    grad.addColorStop(0, col); grad.addColorStop(1, alpha(col, .3));
    g.fillStyle = grad; g.shadowColor = col; g.shadowBlur = 16;
    if ((v ?? 0) >= 0) g.fillRect(x + colW * .25, mid - hh, colW * .5, hh); else g.fillRect(x + colW * .25, mid, colW * .5, hh);
    g.shadowBlur = 0;
    txt(g, v == null ? "—" : (v > 0 ? "+" : "") + Math.round(v).toLocaleString("en-US"), x + colW / 2, h - 50, 34, col, { a: "center", w: 700, f: FONT.num });
  });
  g.fillStyle = "#ffffff30"; g.fillRect(50, top + 230, w * .5 - 60, 2);
  const all = [...d.extras.investor].sort((a, b) => Math.abs(b.foreign_amount) - Math.abs(a.foreign_amount)).slice(0, 21);
  const lx = w * .53, rowH = (h - top - 90) / 7;
  txt(g, t(e, "외국인 순매매 상위 (억원)", "Foreign net flow leaders"), lx, top + 26, 22, "#89f0c4", { w: 600 });
  const fmax = Math.max(1, ...all.map(x => Math.abs(x.foreign_amount)));
  if (all.length) paged(g, e, Math.ceil(all.length / 7), lx, top + 50, w - 50 - lx, rowH * 7, page => all.slice(page * 7, page * 7 + 7).forEach((x, i) => {
    const y = top + 56 + i * rowH + rowH / 2;
    txt(g, x.name, lx, y + 9, 24, "#e5e9f2", { w: 600, max: 200 });
    const mid = lx + 330, span = w - 60 - mid - 110;
    const bw = Math.abs(x.foreign_amount) / fmax * span / 2;
    g.fillStyle = tone(x.foreign_amount);
    if (x.foreign_amount >= 0) g.fillRect(mid + span / 2, y - 9, bw, 18); else g.fillRect(mid + span / 2 - bw, y - 9, bw, 18);
    g.fillStyle = "#ffffff25"; g.fillRect(mid + span / 2, y - 16, 2, 32);
    txt(g, (x.foreign_amount > 0 ? "+" : "") + Math.round(x.foreign_amount).toLocaleString("en-US"), w - 50, y + 9, 23, tone(x.foreign_amount), { a: "right", w: 700, f: FONT.num });
  }), c);
};

P.tri = (g, w, h, d, e) => {
  background(g, w, h, "#9fb3ff");
  const top = header(g, w, d, e, "tri", "#c7d2fe", "KOSPI · KOSDAQ · S&P 500");
  const keys = Object.keys(MARKETS) as ExchangeMarket[];
  const cw = (w - 76) / 3;
  keys.forEach((k, i) => {
    const x = 38 + i * cw, v = d.indices[k], col = MARKETS[k].color;
    rr(g, x + 8, top + 6, cw - 16, h - top - 40, 14);
    const grad = g.createLinearGradient(0, top, 0, h);
    grad.addColorStop(0, alpha(col, .14)); grad.addColorStop(1, "#05060a");
    g.fillStyle = grad; g.fill();
    g.strokeStyle = alpha(col, k === d.market ? .9 : .3); g.lineWidth = k === d.market ? 3 : 1.5; g.stroke();
    txt(g, MARKETS[k].label, x + 32, top + 58, 34, col, { w: 800, f: FONT.disp, ls: 3, glow: 10 });
    txt(g, displayValue(v?.close), x + 32, top + 150, 70, "#fff", { w: 700, f: FONT.num, glow: 12 });
    pill(g, v?.change, x + 34, top + 214, 28);
    spark(g, (v?.points ?? []).slice(-90), x + 30, top + 250, cw - 76, h - top - 310, col, 3);
  });
};

function sessionState(tz: string, open: [number, number], close: [number, number], now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "0";
  const wd = get("weekday");
  const mins = Number(get("hour")) % 24 * 60 + Number(get("minute")) + Number(get("second")) / 60;
  const o = open[0] * 60 + open[1], c = close[0] * 60 + close[1];
  const weekend = wd === "Sat" || wd === "Sun";
  const isOpen = !weekend && mins >= o && mins < c;
  const progress = isOpen ? (mins - o) / (c - o) : mins >= c ? 1 : 0;
  let until = isOpen ? c - mins : mins < o ? o - mins : 24 * 60 - mins + o;
  if (!isOpen && (weekend || (wd === "Fri" && mins >= c))) until += (wd === "Fri" ? 2 : wd === "Sat" ? 1 : 0) * 24 * 60;
  return { isOpen, progress, until, clock: `${get("hour")}:${get("minute")}:${get("second")}` };
}
/** Small national flags drawn on the canvas (no external images, so textures stay untainted). */
export function flag(g: G, code: string, x: number, y: number, w: number, h: number) {
  g.save();
  rr(g, x, y, w, h, h * .08);
  g.clip();
  const band = (cols: string[], vertical = false) => cols.forEach((c, i) => {
    g.fillStyle = c;
    if (vertical) g.fillRect(x + w * i / cols.length, y, w / cols.length + 1, h);
    else g.fillRect(x, y + h * i / cols.length, w, h / cols.length + 1);
  });
  if (code === "kr") {
    // Taegukgi to the statutory construction: taeguk diameter = h/2, axis along the flag's diagonal
    // (rising to the upper left), red above / blue below; geon ☰ upper-left, gon ☷ lower-right,
    // gam ☵ upper-right, ri ☲ lower-left, each trigram square to its diagonal.
    g.fillStyle = "#fff"; g.fillRect(x, y, w, h);
    const cx = x + w / 2, cy = y + h / 2, r = h / 4, tilt = Math.atan2(2, 3);
    g.save(); g.translate(cx, cy); g.rotate(tilt);
    g.fillStyle = "#cd2e3a"; g.beginPath(); g.arc(0, 0, r, Math.PI, 0); g.fill();
    g.fillStyle = "#0047a0"; g.beginPath(); g.arc(0, 0, r, 0, Math.PI); g.fill();
    g.fillStyle = "#cd2e3a"; g.beginPath(); g.arc(-r / 2, 0, r / 2, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#0047a0"; g.beginPath(); g.arc(r / 2, 0, r / 2, 0, Math.PI * 2); g.fill();
    g.restore();
    const unit = h / 24, len = h / 4 * 1.0, gap = unit / 2;
    // [direction (dx, dy) toward the corner, bars from the centre outward: true = solid]
    const trigrams: [number, number, boolean[]][] = [
      [-3, -2, [true, true, true]],      // geon
      [3, 2, [false, false, false]],     // gon
      [3, -2, [false, true, false]],     // gam
      [-3, 2, [true, false, true]],      // ri
    ];
    g.fillStyle = "#000";
    for (const [dx, dy, bars] of trigrams) {
      const n = Math.hypot(dx, dy), ux = dx / n, uy = dy / n;
      const start = r + h / 12;   // inner edge of the trigram
      g.save();
      g.translate(cx + ux * start, cy + uy * start);
      g.rotate(Math.atan2(uy, ux));   // local +x points outward along the diagonal; bars run along local y
      bars.forEach((solid, k) => {
        const bx = k * (unit + gap);
        if (solid) g.fillRect(bx, -len / 2, unit, len);
        else { g.fillRect(bx, -len / 2, unit, len / 2 - gap / 2 - unit / 4); g.fillRect(bx, gap / 2 + unit / 4, unit, len / 2 - gap / 2 - unit / 4); }
      });
      g.restore();
    }
  } else if (code === "us") {
    for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? "#fff" : "#b22234"; g.fillRect(x, y + h * i / 13, w, h / 13 + 1); }
    g.fillStyle = "#3c3b6e"; g.fillRect(x, y, w * .4, h * 7 / 13);
    g.fillStyle = "#fff";
    for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) { g.beginPath(); g.arc(x + w * .4 * (c + .5) / 6, y + h * 7 / 13 * (r + .5) / 5, h * .022, 0, Math.PI * 2); g.fill(); }
  } else if (code === "gb") {
    g.fillStyle = "#012169"; g.fillRect(x, y, w, h);
    g.strokeStyle = "#fff"; g.lineWidth = h * .2;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y + h); g.moveTo(x + w, y); g.lineTo(x, y + h); g.stroke();
    g.strokeStyle = "#c8102e"; g.lineWidth = h * .07;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y + h); g.moveTo(x + w, y); g.lineTo(x, y + h); g.stroke();
    g.fillStyle = "#fff"; g.fillRect(x + w / 2 - h * .17, y, h * .34, h); g.fillRect(x, y + h / 2 - h * .17, w, h * .34);
    g.fillStyle = "#c8102e"; g.fillRect(x + w / 2 - h * .1, y, h * .2, h); g.fillRect(x, y + h / 2 - h * .1, w, h * .2);
  } else if (code === "de") band(["#000", "#dd0000", "#ffce00"]);
  else if (code === "jp") {
    g.fillStyle = "#fff"; g.fillRect(x, y, w, h);
    g.fillStyle = "#bc002d"; g.beginPath(); g.arc(x + w / 2, y + h / 2, h * .3, 0, Math.PI * 2); g.fill();
  } else if (code === "hk") {
    g.fillStyle = "#de2910"; g.fillRect(x, y, w, h);
    g.fillStyle = "#fff";
    for (let k = 0; k < 5; k++) {
      g.save(); g.translate(x + w / 2, y + h / 2); g.rotate(k * Math.PI * 2 / 5);
      g.beginPath(); g.ellipse(0, -h * .17, h * .07, h * .16, .5, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  } else band(["#555", "#888"]);
  g.restore();
  g.strokeStyle = "#ffffff40"; g.lineWidth = 1.5;
  rr(g, x, y, w, h, h * .08); g.stroke();
}

function zoned(tz: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "shortOffset" }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return { hr: Number(get("hour")) % 24, mi: Number(get("minute")), se: Number(get("second")), day: get("day"), month: get("month"),
    weekday: get("weekday"), offset: get("timeZoneName").replace("GMT", "UTC") || "UTC" };
}
const WEEK_KO: Record<string, string> = { Mon: "월", Tue: "화", Wed: "수", Thu: "목", Fri: "금", Sat: "토", Sun: "일" };

const SESSIONS = [
  { ko: "서울 · KRX", en: "SEOUL · KRX", flag: "kr", tz: "Asia/Seoul", open: [9, 0], close: [15, 30], col: "#5fe3ff" },
  { ko: "도쿄 · TSE", en: "TOKYO · TSE", flag: "jp", tz: "Asia/Tokyo", open: [9, 0], close: [15, 30], col: "#f87171" },
  { ko: "홍콩 · HKEX", en: "HONG KONG · HKEX", flag: "hk", tz: "Asia/Hong_Kong", open: [9, 30], close: [16, 0], col: "#fb923c" },
  { ko: "런던 · LSE", en: "LONDON · LSE", flag: "gb", tz: "Europe/London", open: [8, 0], close: [16, 30], col: "#a78bfa" },
  { ko: "뉴욕 · NYSE", en: "NEW YORK · NYSE", flag: "us", tz: "America/New_York", open: [9, 30], close: [16, 0], col: "#ffc871" },
] as const;

P.session = (g, w, h, _d, e) => {
  const c = "#fbbf24";
  background(g, w, h, c);
  const now = new Date(e.now);
  txt(g, t(e, "거래 세션", "TRADING SESSIONS"), 50, 92, 52, c, { w: 800, f: FONT.disp, ls: 4, glow: 14 });
  txt(g, t(e, "현지 시각 · 정규장 기준 · 주말 휴장", "LOCAL TIME · REGULAR HOURS"), 52, 132, 22, "#a3a9b8", { w: 600 });
  if (w / h < 2.5) {
    // Detail dialog: one row per exchange so nothing is cut.
    const rowH = (h - 170) / SESSIONS.length;
    SESSIONS.forEach((s, i) => {
      const st = sessionState(s.tz, s.open as unknown as [number, number], s.close as unknown as [number, number], now);
      const z = zoned(s.tz, now);
      const y = 160 + i * rowH;
      rr(g, 40, y + 6, w - 80, rowH - 12, 12);
      g.fillStyle = st.isOpen ? alpha(s.col, .13) : "#0b0d12"; g.fill();
      g.strokeStyle = alpha(s.col, st.isOpen ? .8 : .28); g.lineWidth = 2; g.stroke();
      flag(g, s.flag, 64, y + rowH / 2 - 21, 63, 42);
      txt(g, e.lang === "ko" ? s.ko : s.en, 146, y + rowH / 2 - 6, 28, s.col, { w: 700, max: w * .34 - 162 });
      txt(g, `${z.month}.${z.day} (${e.lang === "ko" ? WEEK_KO[z.weekday] ?? z.weekday : z.weekday}) · ${z.offset}`, 146, y + rowH / 2 + 28, 20, "#9aa3b6", { w: 600, f: FONT.num });
      txt(g, `${String(z.hr).padStart(2, "0")}:${String(z.mi).padStart(2, "0")}:${String(z.se).padStart(2, "0")}`, w * .35, y + rowH / 2 + 18, 50, "#fff", { w: 600, f: FONT.num, glow: st.isOpen ? 10 : 0 });
      g.fillStyle = st.isOpen ? "#2bff9a" : "#ff5470";
      g.beginPath(); g.arc(w * .6, y + rowH / 2 - 14, 9, 0, Math.PI * 2); g.fill();
      txt(g, st.isOpen ? t(e, "개장", "OPEN") : t(e, "폐장", "CLOSED"), w * .6 + 20, y + rowH / 2 - 4, 26, st.isOpen ? "#7dffc0" : "#ff9aaa", { w: 700 });
      const hh = Math.floor(st.until / 60), mm = Math.floor(st.until % 60);
      txt(g, (st.isOpen ? t(e, "마감까지 ", "Closes in ") : t(e, "개장까지 ", "Opens in ")) + `${hh}${t(e, "시간 ", "h ")}${String(mm).padStart(2, "0")}${t(e, "분", "m")}`,
        w - 64, y + rowH / 2 - 4, 24, "#e2e7f0", { a: "right", w: 650 });
      g.fillStyle = "#1a1e29"; rr(g, w * .6, y + rowH / 2 + 16, w * .4 - 64, 12, 6); g.fill();
      g.fillStyle = s.col; rr(g, w * .6, y + rowH / 2 + 16, Math.max(12, (w * .4 - 64) * st.progress), 12, 6); g.fill();
    });
    return;
  }
  const x0 = 40, y0 = 160, cw = (w - 80) / SESSIONS.length, ch = h - y0 - 36;
  SESSIONS.forEach((s, i) => {
    const st = sessionState(s.tz, s.open as unknown as [number, number], s.close as unknown as [number, number], now);
    const z = zoned(s.tz, now);
    const x = x0 + i * cw;
    rr(g, x + 8, y0, cw - 16, ch, 16);
    g.fillStyle = st.isOpen ? alpha(s.col, .13) : "#0b0d12"; g.fill();
    g.strokeStyle = alpha(s.col, st.isOpen ? .9 : .32); g.lineWidth = 3; g.stroke();
    flag(g, s.flag, x + 32, y0 + 30, 66, 44);
    txt(g, e.lang === "ko" ? s.ko : s.en, x + 114, y0 + 66, 34, s.col, { w: 700, max: cw - 300 });
    const label = st.isOpen ? t(e, "개장", "OPEN") : t(e, "폐장", "CLOSED");
    g.fillStyle = st.isOpen ? "#2bff9a" : "#ff5470"; g.shadowColor = g.fillStyle; g.shadowBlur = 12;
    g.beginPath(); g.arc(x + cw - 50, y0 + 54, 10, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
    txt(g, label, x + cw - 70, y0 + 66, 30, st.isOpen ? "#2bff9a" : "#ff8095", { a: "right", w: 700 });
    txt(g, `${String(z.hr).padStart(2, "0")}:${String(z.mi).padStart(2, "0")}:${String(z.se).padStart(2, "0")}`, x + 32, y0 + 196, 92, "#fff", { w: 600, f: FONT.num, glow: st.isOpen ? 14 : 0 });
    txt(g, `${z.month}.${z.day} (${e.lang === "ko" ? WEEK_KO[z.weekday] ?? z.weekday : z.weekday}) · ${z.offset}`, x + 34, y0 + 240, 24, "#aab3c5", { w: 600, f: FONT.num });
    g.fillStyle = "#1a1e29"; rr(g, x + 32, y0 + 270, cw - 80, 18, 9); g.fill();
    g.fillStyle = s.col; rr(g, x + 32, y0 + 270, Math.max(18, (cw - 80) * st.progress), 18, 9); g.fill();
    const hh = Math.floor(st.until / 60), mm = Math.floor(st.until % 60);
    txt(g, (st.isOpen ? t(e, "마감까지 ", "Closes in ") : t(e, "개장까지 ", "Opens in ")) + `${hh}${t(e, "시간 ", "h ")}${String(mm).padStart(2, "0")}${t(e, "분", "m")}`,
      x + 32, y0 + 336, 30, "#e2e7f0", { w: 650 });
    txt(g, `${t(e, "정규장", "Regular")} ${String(s.open[0]).padStart(2, "0")}:${String(s.open[1]).padStart(2, "0")} – ${String(s.close[0]).padStart(2, "0")}:${String(s.close[1]).padStart(2, "0")}`,
      x + 32, y0 + 378, 22, "#7f889c", { w: 500, f: FONT.num });
  });
};

const CLOCKS = [
  { ko: "서울", en: "SEOUL", country: "대한민국", flag: "kr", tz: "Asia/Seoul", ex: "KRX", open: [9, 0], close: [15, 30] },
  { ko: "도쿄", en: "TOKYO", country: "일본", flag: "jp", tz: "Asia/Tokyo", ex: "TSE", open: [9, 0], close: [15, 30] },
  { ko: "홍콩", en: "HONG KONG", country: "중국 홍콩", flag: "hk", tz: "Asia/Hong_Kong", ex: "HKEX", open: [9, 30], close: [16, 0] },
  { ko: "프랑크푸르트", en: "FRANKFURT", country: "독일", flag: "de", tz: "Europe/Berlin", ex: "XETRA", open: [9, 0], close: [17, 30] },
  { ko: "런던", en: "LONDON", country: "영국", flag: "gb", tz: "Europe/London", ex: "LSE", open: [8, 0], close: [16, 30] },
  { ko: "뉴욕", en: "NEW YORK", country: "미국", flag: "us", tz: "America/New_York", ex: "NYSE", open: [9, 30], close: [16, 0] },
];
P.clocks = (g, w, h, _d, e) => {
  const c = "#d9b45a";
  background(g, w, h, c);
  const now = new Date(e.now);
  // Wide wall board: 3 × 2. Narrow (detail dialog): 2 × 3. Each cell is drawn in a 340-unit-tall design space.
  const cols = w / h > 2.5 ? 3 : 2, rowsN = 6 / cols, gw = (w - 60) / cols, gh = (h - 40) / rowsN;
  const k = Math.min(1, gh / 340);
  CLOCKS.forEach((cl, i) => {
    g.save();
    g.translate(30 + (i % cols) * gw, 20 + Math.floor(i / cols) * gh);
    g.scale(k, k);
    const x = 0, y = 0, cw = gw / k, ch = 340;
    const z = zoned(cl.tz, now);
    const st = sessionState(cl.tz, cl.open as [number, number], cl.close as [number, number], now);
    const day = z.hr >= 7 && z.hr < 19;
    rr(g, x + 8, y + 8, cw - 16, ch - 16, 18);
    const bg = g.createLinearGradient(x, y, x, y + ch);
    bg.addColorStop(0, day ? "#1c1a14" : "#10121f"); bg.addColorStop(1, "#050507");
    g.fillStyle = bg; g.fill();
    g.strokeStyle = alpha(c, .35); g.lineWidth = 2; g.stroke();
    // Analog dial.
    const r = ch * .34, cx = x + 30 + r, cy = y + ch / 2 + 4;
    const face = g.createRadialGradient(cx - r * .3, cy - r * .3, r * .1, cx, cy, r);
    face.addColorStop(0, day ? "#f4efe2" : "#1d2136"); face.addColorStop(1, day ? "#c9c0a8" : "#07080e");
    g.fillStyle = face; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = c; g.lineWidth = 7; g.stroke();
    const ink = day ? "#1b1b1f" : "#f2e9cf";
    for (let k = 0; k < 60; k++) {
      const a = k / 60 * Math.PI * 2, big = k % 5 === 0;
      g.strokeStyle = big ? ink : alpha(day ? "#1b1b1f" : "#9aa0b4", .55); g.lineWidth = big ? 4.5 : 1.6;
      g.beginPath(); g.moveTo(cx + Math.sin(a) * r * (big ? .8 : .87), cy - Math.cos(a) * r * (big ? .8 : .87));
      g.lineTo(cx + Math.sin(a) * r * .94, cy - Math.cos(a) * r * .94); g.stroke();
    }
    for (const n of [12, 3, 6, 9]) {
      const a = n / 12 * Math.PI * 2;
      txt(g, String(n), cx + Math.sin(a) * r * .64, cy - Math.cos(a) * r * .64 + r * .08, r * .2, ink, { a: "center", w: 700, f: FONT.num });
    }
    const hand = (ang: number, len: number, wid: number, col: string) => {
      g.strokeStyle = col; g.lineWidth = wid; g.lineCap = "round";
      g.beginPath(); g.moveTo(cx - Math.sin(ang) * len * .16, cy + Math.cos(ang) * len * .16);
      g.lineTo(cx + Math.sin(ang) * len, cy - Math.cos(ang) * len); g.stroke();
    };
    hand((z.hr % 12 + z.mi / 60) / 12 * Math.PI * 2, r * .52, 9, ink);
    hand((z.mi + z.se / 60) / 60 * Math.PI * 2, r * .76, 6, ink);
    hand(z.se / 60 * Math.PI * 2, r * .84, 2.5, "#e5243b");
    g.lineCap = "butt";
    g.fillStyle = "#e5243b"; g.beginPath(); g.arc(cx, cy, 7, 0, Math.PI * 2); g.fill();
    // Flag, city, digital time and market status.
    const tx = cx + r + 34, tw = x + cw - 26 - tx;
    flag(g, cl.flag, tx, y + 34, 60, 40);
    txt(g, e.lang === "ko" ? cl.ko : cl.en, tx + 76, y + 68, 38, "#f6ecd0", { w: 800, max: tw - 80 });
    txt(g, `${e.lang === "ko" ? cl.country : cl.ko} · ${z.offset}`, tx, y + 108, 21, "#aab0c0", { w: 600, max: tw });
    txt(g, `${String(z.hr).padStart(2, "0")}:${String(z.mi).padStart(2, "0")}`, tx - 4, y + 196, 84, "#ffffff", { w: 700, f: FONT.num, glow: 12 });
    g.font = `700 84px ${FONT.num}`;
    const hmW = measure(g, `${String(z.hr).padStart(2, "0")}:${String(z.mi).padStart(2, "0")}`);
    txt(g, ":" + String(z.se).padStart(2, "0"), tx + hmW, y + 196, 40, "#ffd36a", { w: 700, f: FONT.num });
    txt(g, `${z.month}.${z.day} (${e.lang === "ko" ? WEEK_KO[z.weekday] ?? z.weekday : z.weekday})  ${day ? "☀ " + t(e, "주간", "DAY") : "☾ " + t(e, "야간", "NIGHT")}`,
      tx, y + 236, 22, day ? "#ffd36a" : "#9fb3ff", { w: 650 });
    g.fillStyle = st.isOpen ? "#2bff9a" : "#ff5470";
    g.beginPath(); g.arc(tx + 8, y + 268, 7, 0, Math.PI * 2); g.fill();
    txt(g, `${cl.ex} ${st.isOpen ? t(e, "개장 중", "OPEN") : t(e, "폐장", "CLOSED")}`, tx + 24, y + 276, 21, st.isOpen ? "#7dffc0" : "#ff9aaa", { w: 700 });
    g.restore();
  });
};

function stockList(id: string, accent: string, metric: (r: MarketMapItem) => [string, number], sub?: (e: PaintEnv) => string): Painter {
  return (g, w, h, d, e) => {
    background(g, w, h, accent);
    const top = header(g, w, d, e, id, accent, sub?.(e));
    const all = rows(d, id).slice(0, 24);
    if (!all.length) { waiting(g, 38, top, w - 76, h - top - 40, e, t(e, "해당 종목 없음", "No matching stocks")); return; }
    const rowH = (h - top - 46) / 8;
    const maxM = Math.max(1e-9, ...all.map(r => Math.abs(metric(r)[1])));
    paged(g, e, Math.ceil(all.length / 8), 38, top, w - 76, rowH * 8, page => all.slice(page * 8, page * 8 + 8).forEach((r, j) => {
      const i = page * 8 + j;
      const y = top + j * rowH;
      if (j % 2 === 0) { g.fillStyle = "#ffffff05"; g.fillRect(38, y, w - 76, rowH); }
      txt(g, String(i + 1).padStart(2, "0"), 56, y + rowH * .66, 26, i < 3 ? accent : "#5e687d", { w: 700, f: FONT.mono });
      e.logo(g, d.market, r.code, 112, y + rowH * .16, rowH * .68);
      txt(g, name(d, r), 112 + rowH * .85, y + rowH * .66, 28, "#f1f4fa", { w: 650, max: w * .3 });
      txt(g, displayValue(r.close, d.market === "sp500" ? 2 : 0), w * .63, y + rowH * .66, 28, "#d5dbe7", { a: "right", w: 600, f: FONT.num });
      const [label, value] = metric(r);
      const bx = w * .66, bw = w * .2 * Math.abs(value) / maxM;
      g.fillStyle = alpha(id === "movers" ? accent : tone(r.change_pct), .55);
      rr(g, bx, y + rowH * .35, Math.max(4, bw), rowH * .3, 4); g.fill();
      txt(g, label, w - 56, y + rowH * .66, 28, id === "movers" ? "#ffe2ad" : tone(r.change_pct), { a: "right", w: 700, f: FONT.num, glow: 6 });
    }), accent);
  };
}
P.leaders = stockList("leaders", "#5fe3ff", r => [changeText(r.change_pct), r.change_pct]);
P.gainers = stockList("gainers", UP, r => [changeText(r.change_pct), r.change_pct]);
P.laggards = stockList("laggards", DOWN, r => [changeText(r.change_pct), r.change_pct]);
P.movers = (g, w, h, d, e) => stockList("movers", "#f59e0b", r => {
  const v = r.turnover ?? r.close * (r.volume ?? 0);
  return [d.market === "sp500" ? "$" + displayValue(v / 1e6, 0) + "M" : moneyKr(v, e), v];
}, ev => t(ev, "거래대금 기준", "BY TRADED VALUE"))(g, w, h, d, e);

P.world = (g, w, h, d, e) => {
  const c = "#38bdf8";
  background(g, w, h, c);
  const top = header(g, w, d, e, "world", c, t(e, "주요국 대표 지수", "MAJOR BENCHMARKS"));
  const list = d.extras.world.filter(x => x.unit === "index").slice(0, 9);
  if (!list.length) { waiting(g, 38, top, w - 76, h - top - 40, e); return; }
  const rowH = (h - top - 20) / list.length;
  list.forEach((x, i) => {
    const y = top + i * rowH;
    if (i % 2 === 0) { g.fillStyle = "#ffffff05"; g.fillRect(38, y, w - 76, rowH); }
    rr(g, 54, y + rowH * .24, 64, rowH * .52, 6);
    g.fillStyle = `hsl(${hashHue(x.flag ?? x.key)} 45% 30%)`; g.fill();
    txt(g, (x.flag ?? "").toUpperCase(), 86, y + rowH * .62, 22, "#fff", { a: "center", w: 700, f: FONT.num });
    txt(g, x.label, 140, y + rowH * .64, 30, "#eef2f8", { w: 650, max: w * .26 });
    txt(g, displayValue(x.close), w * .5, y + rowH * .64, 32, "#fff", { a: "right", w: 700, f: FONT.num });
    pill(g, x.change_pct, w * .52, y + rowH * .64, 24);
    spark(g, x.points.map(p => p.close).slice(-60), w * .7, y + rowH * .18, w * .26, rowH * .64, tone(x.change_pct), 2.4);
  });
};

P.globaltop = (g, w, h, d, e) => {
  const c = "#facc15";
  background(g, w, h, c);
  const top = header(g, w, d, e, "globaltop", c, "USD");
  const list = d.extras.globalTop.slice(0, 16);
  if (!list.length) { waiting(g, 38, top, w - 76, h - top - 40, e); return; }
  const rowH = (h - top - 20) / 8, cw = (w - 76) / 2;
  const max = list[0].marcap_usd || 1;
  list.forEach((x, i) => {
    const col = Math.floor(i / 8), y = top + (i % 8) * rowH, x0 = 38 + col * cw;
    txt(g, String(x.rank), x0 + 20, y + rowH * .66, 24, i < 3 ? c : "#6d7487", { w: 700, f: FONT.mono });
    monogram(g, x.code, x0 + 64, y + rowH * .14, rowH * .72);
    txt(g, x.name, x0 + 64 + rowH * .9, y + rowH * .64, 25, "#eef1f7", { w: 600, max: cw * .42 });
    g.fillStyle = alpha(c, .3); g.fillRect(x0 + cw * .6, y + rowH * .4, cw * .2 * x.marcap_usd / max, rowH * .22);
    txt(g, "$" + (x.marcap_usd / 1e12).toFixed(2) + "T", x0 + cw * .6, y + rowH * .66, 24, "#fde68a", { w: 700, f: FONT.num });
    txt(g, changeText(x.change_pct), x0 + cw - 20, y + rowH * .66, 24, tone(x.change_pct), { a: "right", w: 700, f: FONT.num });
  });
};

function tickerCards(id: string, accent: string, symbols: string[], cols: number): Painter {
  return (g, w, h, d, e) => {
    background(g, w, h, accent);
    const top = header(g, w, d, e, id, accent);
    const rowsN = Math.ceil(symbols.length / cols);
    const cw = (w - 76) / cols, ch = (h - top - 30) / rowsN;
    symbols.forEach((s, i) => {
      const q = d.tickers[s];
      const x = 38 + (i % cols) * cw, y = top + Math.floor(i / cols) * ch;
      rr(g, x + 8, y + 8, cw - 16, ch - 16, 12);
      const grad = g.createLinearGradient(x, y, x, y + ch);
      grad.addColorStop(0, alpha(tone(q?.change_pct), .14)); grad.addColorStop(1, "#05060a");
      g.fillStyle = grad; g.fill();
      g.strokeStyle = "#ffffff14"; g.lineWidth = 1.5; g.stroke();
      txt(g, s.replace("=F", "").replace("^", ""), x + 28, y + 50, 28, accent, { w: 700, f: FONT.num, ls: 2 });
      txt(g, q?.label ?? "—", x + 28, y + 80, 20, "#9aa3b5", { w: 500, max: cw - 60 });
      txt(g, displayValue(q?.price), x + 28, y + ch * .62, Math.min(54, ch * .26), "#fff", { w: 700, f: FONT.num, glow: 10 });
      txt(g, changeText(q?.change_pct), x + cw - 30, y + 50, 28, tone(q?.change_pct), { a: "right", w: 700, f: FONT.num });
      spark(g, (q?.points ?? []).slice(-120), x + 26, y + ch * .68, cw - 62, ch * .22, tone(q?.change_pct), 2.2);
    });
  };
}
P.semis = tickerCards("semis", "#22d3ee", ["NVDA", "SKHY", "MU", "AVGO", "AMD", "INTC"], 3);
P.bigtech = tickerCards("bigtech", "#818cf8", ["AAPL", "MSFT", "GOOGL", "META", "TSLA", "ANT", "SPCX", "^NDX"], 4);
P.crypto = tickerCards("crypto", "#f7931a", ["BTC-USD", "ETH-USD", "XRP-USD"], 3);
P.fx = (g, w, h, d, e) => {
  const c = "#4ade80";
  background(g, w, h, c);
  const top = header(g, w, d, e, "fx", c, t(e, "원화 기준", "VS KRW"));
  const main = d.tickers["KRW=X"];
  txt(g, "USD / KRW", 60, top + 50, 34, c, { w: 700, f: FONT.num, ls: 3 });
  txt(g, fixedValue(main?.price, 2), 56, top + 160, 108, "#fff", { w: 700, f: FONT.num, glow: 20 });
  pill(g, main?.change_pct, 62, top + 228, 30);
  areaChart(g, (main?.points ?? []).slice(-240), 56, top + 270, w * .5 - 80, h - top - 310, c, { glow: true });
  const others = ["JPYKRW=X", "EURKRW=X", "GBPKRW=X"];
  const rowH = (h - top - 30) / 3;
  others.forEach((s, i) => {
    const q = d.tickers[s], y = top + i * rowH, x = w * .53;
    rr(g, x, y + 8, w - x - 40, rowH - 16, 12); g.fillStyle = "#0b0e14"; g.fill();
    txt(g, s.replace("KRW=X", " / KRW"), x + 26, y + 52, 28, "#bff5d3", { w: 700, f: FONT.num, ls: 2 });
    txt(g, fixedValue(q?.price, 2), x + 26, y + rowH - 34, 50, "#fff", { w: 700, f: FONT.num });
    txt(g, changeText(q?.change_pct), w - 66, y + 52, 26, tone(q?.change_pct), { a: "right", w: 700, f: FONT.num });
    spark(g, (q?.points ?? []).slice(-120), x + (w - x) * .45, y + rowH * .42, (w - x) * .45, rowH * .42, tone(q?.change_pct));
  });
};

function futuresBoard(id: string, accent: string, symbols: string[], tiles = false): Painter {
  return (g, w, h, d, e) => {
    background(g, w, h, accent);
    const top = header(g, w, d, e, id, accent, "COMEX · NYMEX · CBOT · CME");
    const list = symbols.map(s => d.extras.futures.find(f => f.symbol === s)).filter(Boolean) as FloorSnapshot["extras"]["futures"];
    if (!list.length) { waiting(g, 38, top, w - 76, h - top - 40, e); return; }
    if (tiles) {
      const cols = 4, rowsN = Math.ceil(list.length / cols), cw = (w - 76) / cols, ch = (h - top - 26) / rowsN;
      list.forEach((f, i) => {
        const x = 38 + (i % cols) * cw, y = top + Math.floor(i / cols) * ch;
        rr(g, x + 5, y + 5, cw - 10, ch - 10, 10);
        g.fillStyle = heat(f.change_pct, 3); g.fill();
        txt(g, e.lang === "ko" ? f.name : f.name_en, x + 22, y + 44, 26, "#fff", { w: 700, max: cw - 40 });
        txt(g, fixedValue(f.price, Math.min(2, f.decimals)), x + 22, y + ch - 26, 32, "#ffffffe0", { w: 600, f: FONT.num });
        txt(g, changeText(f.change_pct), x + cw - 22, y + ch - 26, 28, "#fff", { a: "right", w: 700, f: FONT.num, glow: 8 });
      });
      return;
    }
    const rowH = (h - top - 20) / list.length;
    const max = Math.max(.5, ...list.map(f => Math.abs(f.change_pct)));
    list.forEach((f, i) => {
      const y = top + i * rowH;
      if (i % 2 === 0) { g.fillStyle = "#ffffff05"; g.fillRect(38, y, w - 76, rowH); }
      g.fillStyle = accent; g.shadowColor = accent; g.shadowBlur = 10;
      g.beginPath(); g.arc(66, y + rowH / 2, 9, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
      txt(g, e.lang === "ko" ? f.name : f.name_en, 94, y + rowH * .62, 32, "#eef2f8", { w: 650, max: w * .26 });
      txt(g, f.market_name, 94 + w * .27, y + rowH * .62, 20, "#7a8398", { w: 500, f: FONT.mono });
      txt(g, fixedValue(f.price, Math.min(3, f.decimals)), w * .66, y + rowH * .64, 38, "#fff", { a: "right", w: 700, f: FONT.num });
      txt(g, f.unit, w * .66 + 12, y + rowH * .64, 20, "#7a8398", { w: 500, f: FONT.num });
      const bw = Math.abs(f.change_pct) / max * w * .1;
      g.fillStyle = alpha(tone(f.change_pct), .55); g.fillRect(w * .76, y + rowH * .4, bw, rowH * .2);
      txt(g, changeText(f.change_pct), w - 56, y + rowH * .64, 32, tone(f.change_pct), { a: "right", w: 700, f: FONT.num, glow: 8 });
    });
  };
}
P.metals = futuresBoard("metals", "#eab308", ["GC=F", "SI=F", "PL=F", "PA=F", "HG=F", "ALI=F"]);
P.energy = futuresBoard("energy", "#14b8a6", ["CL=F", "BZ=F", "NG=F", "HO=F", "RB=F"]);
P.agri = futuresBoard("agri", "#84cc16", ["ZW=F", "ZC=F", "ZS=F", "ZL=F", "ZM=F", "KC=F", "CC=F", "SB=F", "CT=F", "OJ=F", "LE=F", "HE=F"], true);

P.futures = (g, w, h, d, e) => {
  const c = "#fb923c";
  background(g, w, h, c);
  const top = header(g, w, d, e, "futures", c, t(e, "야간 · 주간 · 미국", "NIGHT · DAY · US"));
  const night = d.extras.kospiNight as (typeof d.extras.kospiNight & { points?: { close: number }[] }) | null;
  const items: [string, number | null | undefined, number | null | undefined, number[], string][] = [
    [t(e, "코스피200 야간", "KOSPI200 NIGHT"), night?.close, night?.change_pct, (night?.points ?? []).map(p => p.close), night?.session_state === "open" ? "OPEN" : "CLOSED"],
    [t(e, "코스피200 주간", "KOSPI200 DAY"), d.extras.kospiFutures?.close, d.extras.kospiFutures?.change_pct, [], d.extras.kospiFutures?.session_state === "open" ? "OPEN" : "CLOSED"],
    ["S&P 500 E-mini", d.tickers["ES=F"]?.price, d.tickers["ES=F"]?.change_pct, d.tickers["ES=F"]?.points ?? [], "CME"],
    ["NASDAQ 100 E-mini", d.tickers["NQ=F"]?.price, d.tickers["NQ=F"]?.change_pct, d.tickers["NQ=F"]?.points ?? [], "CME"],
  ];
  const cw = (w - 76) / 2, ch = (h - top - 26) / 2;
  items.forEach(([label, v, chg, pts, state], i) => {
    const x = 38 + (i % 2) * cw, y = top + Math.floor(i / 2) * ch;
    rr(g, x + 8, y + 8, cw - 16, ch - 16, 14); g.fillStyle = "#0a0c12"; g.fill();
    g.strokeStyle = alpha(tone(chg), .5); g.lineWidth = 2; g.stroke();
    txt(g, label, x + 30, y + 54, 28, "#ffd7b0", { w: 700 });
    txt(g, state, x + cw - 34, y + 54, 20, state === "OPEN" ? "#2bff9a" : "#8a93a7", { a: "right", w: 700, f: FONT.mono });
    txt(g, displayValue(v), x + 30, y + 132, 62, "#fff", { w: 700, f: FONT.num, glow: 12 });
    txt(g, changeText(chg), x + 30, y + 180, 30, tone(chg), { w: 700, f: FONT.num });
    spark(g, pts.slice(-160), x + cw * .45, y + 80, cw * .5 - 20, ch - 120, tone(chg));
  });
};

P.rates = (g, w, h, d, e) => {
  const c = "#a3e635";
  background(g, w, h, c);
  const top = header(g, w, d, e, "rates", c, "CNBC · TRADEWEB");
  const two = d.extras.rates.find(r => r.tenor === "2"), ten = d.extras.rates.find(r => r.tenor === "10");
  [[t(e, "2년물", "2-YEAR"), two], [t(e, "10년물", "10-YEAR"), ten]].forEach(([label, r], i) => {
    const q = r as typeof two;
    const x = 60 + i * (w * .3);
    txt(g, label as string, x, top + 54, 32, c, { w: 700 });
    txt(g, q?.yield_pct == null ? "—" : q.yield_pct.toFixed(3) + "%", x, top + 160, 84, "#fff", { w: 700, f: FONT.num, glow: 14 });
    const bp = q?.change_bp;
    txt(g, bp == null ? "—" : (bp > 0 ? "+" : "") + bp.toFixed(1) + " bp", x, top + 214, 34, tone(bp), { w: 700, f: FONT.num });
  });
  // Mini curve and spread gauge.
  const x0 = w * .64, y0 = top + 30, cw = w - x0 - 60, ch = h - top - 120;
  g.strokeStyle = "#ffffff15"; g.strokeRect(x0, y0, cw, ch);
  if (two?.yield_pct != null && ten?.yield_pct != null) {
    const lo = Math.min(two.yield_pct, ten.yield_pct) - .4, hi = Math.max(two.yield_pct, ten.yield_pct) + .4;
    const py = (v: number) => y0 + (hi - v) / (hi - lo) * ch;
    g.strokeStyle = c; g.lineWidth = 5; g.shadowColor = c; g.shadowBlur = 14;
    g.beginPath(); g.moveTo(x0 + cw * .2, py(two.yield_pct)); g.lineTo(x0 + cw * .8, py(ten.yield_pct)); g.stroke(); g.shadowBlur = 0;
    for (const [px, v, l] of [[x0 + cw * .2, two.yield_pct, "2Y"], [x0 + cw * .8, ten.yield_pct, "10Y"]] as const) {
      g.fillStyle = "#fff"; g.beginPath(); g.arc(px, py(v), 10, 0, Math.PI * 2); g.fill();
      txt(g, l, px, y0 + ch + 34, 24, "#b9c2d2", { a: "center", w: 700, f: FONT.num });
    }
    const spread = (ten.yield_pct - two.yield_pct) * 100;
    txt(g, `2s10s ${spread > 0 ? "+" : ""}${spread.toFixed(0)}bp`, 60, h - 54, 34, spread < 0 ? "#ff8a9c" : "#d9f99d", { w: 700, f: FONT.num });
    txt(g, spread < 0 ? t(e, "장단기 역전", "INVERTED") : t(e, "정상 곡선", "NORMAL CURVE"), 60 + 330, h - 54, 26, "#9aa3b5", { w: 600 });
  } else waiting(g, x0, y0, cw, ch, e);
};

P.news = (g, w, h, d, e) => {
  const c = "#f43f5e";
  background(g, w, h, c);
  const hot = d.extras.hot;
  const top = header(g, w, d, e, "news", c, hot?.slot_label ? (hot.edition ?? "") + " " + hot.slot_label + " EDITION" : "BRIEFING");
  if (!hot?.headline) { waiting(g, 38, top, w - 76, h - top - 40, e); return; }
  const mood = hot.mood?.tone;
  const moodCol = mood === "risk-on" ? UP : mood === "risk-off" ? DOWN : "#fbbf24";
  pill(g, mood === "risk-on" ? 1 : mood === "risk-off" ? -1 : 0, 50, top + 40, 24, "left",
    mood === "risk-on" ? t(e, "위험선호", "RISK-ON") : mood === "risk-off" ? t(e, "위험회피", "RISK-OFF") : t(e, "혼조", "MIXED"));
  // Headline wraps over two lines.
  g.font = `800 52px ${FONT.kr}`;
  const words = hot.headline.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? line + " " + word : word;
    if (measure(g, next) > w - 120 && line) { lines.push(line); line = word; } else line = next;
  }
  lines.push(line);
  lines.slice(0, 2).forEach((l, i) => txt(g, l, 50, top + 112 + i * 64, 52, "#fff", { w: 800, glow: 6, max: w - 100 }));
  g.fillStyle = alpha(moodCol, .6); g.fillRect(50, top + 196 + (lines.length > 1 ? 30 : 0), 120, 4);
  const listTop = top + 240 + (lines.length > 1 ? 30 : 0);
  const stories = hot.stories.slice(0, 12);
  const rowH = (h - listTop - 40) / 4;
  if (stories.length) paged(g, e, Math.ceil(stories.length / 4), 40, listTop, w - 80, rowH * 4, page => stories.slice(page * 4, page * 4 + 4).forEach((s, i) => {
    const y = listTop + i * rowH;
    const col = s.impact === "호재" ? UP : s.impact === "악재" ? DOWN : "#fbbf24";
    rr(g, 50, y + rowH * .2, 92, rowH * .6, 8); g.fillStyle = alpha(col, .2); g.fill();
    txt(g, s.impact, 96, y + rowH * .6, 22, col, { a: "center", w: 800 });
    txt(g, s.title, 166, y + rowH * .62, 30, "#edf0f6", { w: 650, max: w - 230 });
  }), c);
};

P.brief = (g, w, h, d, e) => {
  const c = "#fcd34d";
  background(g, w, h, c);
  const top = header(g, w, d, e, "brief", c);
  const hot = d.extras.hot;
  const nums = hot?.key_numbers?.slice(0, 4) ?? [];
  const agenda = hot?.watchlist?.slice(0, 4) ?? [];
  if (!nums.length && !agenda.length) { waiting(g, 38, top, w - 76, h - top - 40, e); return; }
  const cw = (w - 76) / 2;
  nums.forEach((n, i) => {
    const x = 38 + (i % 2) * (cw / 2 + 0) , y = top + Math.floor(i / 2) * 150;
    const bw = cw / 2 - 14;
    rr(g, x + 6, y + 6, bw, 136, 12); g.fillStyle = "#0b0d13"; g.fill();
    txt(g, n.label, x + 24, y + 44, 22, "#fde68a", { w: 650, max: bw - 30 });
    txt(g, n.value, x + 24, y + 96, 40, "#fff", { w: 700, f: FONT.num, max: bw - 30 });
    const neg = /^[-−▼]/.test(n.change);
    txt(g, n.change, x + 24, y + 128, 22, neg ? DOWN : UP, { w: 700, f: FONT.num, max: bw - 30 });
  });
  const ax = 38 + cw + 20;
  txt(g, t(e, "주목할 일정", "WATCHLIST"), ax, top + 30, 24, c, { w: 700, ls: 2 });
  agenda.forEach((a, i) => {
    const y = top + 70 + i * ((h - top - 90) / 4);
    g.fillStyle = c; g.beginPath(); g.arc(ax + 8, y + 8, 7, 0, Math.PI * 2); g.fill();
    if (i < agenda.length - 1) { g.fillStyle = alpha(c, .3); g.fillRect(ax + 7, y + 18, 2, (h - top - 90) / 4 - 14); }
    txt(g, a.when, ax + 30, y + 16, 22, "#fef3c7", { w: 700, f: FONT.num, max: cw - 50 });
    txt(g, a.event, ax + 30, y + 52, 26, "#e8ebf2", { w: 600, max: cw - 50 });
  });
};

function assetPainter(symbol: string): Painter {
  const spec = ASSET_SINGLES[symbol];
  const accent = { "KRW=X": "#4ade80", "GC=F": "#fbbf24", "CL=F": "#2dd4bf", "BTC-USD": "#f7931a", "NQ=F": "#818cf8",
    "ES=F": "#60a5fa", "ETH-USD": "#a78bfa", "SI=F": "#cbd5e1" }[symbol] ?? "#e2e8f0";
  return (g, w, h, d, e) => {
    const q: MarketTickerItem | undefined = d.tickers[symbol];
    background(g, w, h, accent);
    txt(g, e.lang === "ko" ? spec.ko : spec.en, 56, 92, 52, "#fff", { w: 800 });
    txt(g, symbol.replace("=X", "").replace("=F", " FUT").replace("-USD", " / USD"), 58, 134, 24, accent, { w: 700, f: FONT.num, ls: 4 });
    txt(g, q?.session === "regular" ? "● REGULAR" : q?.session ? "● " + q.session.toUpperCase() : "", w - 56, 92, 22, "#2bff9a", { a: "right", w: 700, f: FONT.mono });
    txt(g, fixedValue(q?.price, spec.digits), 52, 290, 136, "#fff", { w: 700, f: FONT.num, glow: 24 });
    txt(g, spec.unit, 58, 338, 26, "#8d96aa", { w: 600, f: FONT.num, ls: 2 });
    pill(g, q?.change_pct, 58, 412, 38);
    const pts = (q?.points ?? []).filter(isPrice);
    if (pts.length > 1) {
      const hi = Math.max(...pts), lo = Math.min(...pts);
      txt(g, `H ${fixedValue(hi, spec.digits)}`, 60, 500, 26, "#ffb3c0", { w: 600, f: FONT.mono });
      txt(g, `L ${fixedValue(lo, spec.digits)}`, 60, 540, 26, "#a9cbff", { w: 600, f: FONT.mono });
      const pos = q && hi > lo ? (q.price - lo) / (hi - lo) : .5;
      g.fillStyle = "#1a1e29"; rr(g, 60, 580, 400, 12, 6); g.fill();
      const grad = g.createLinearGradient(60, 0, 460, 0); grad.addColorStop(0, DOWN); grad.addColorStop(1, UP);
      g.fillStyle = grad; rr(g, 60, 580, 400, 12, 6); g.fill();
      g.fillStyle = "#fff"; g.beginPath(); g.arc(60 + 400 * pos, 586, 13, 0, Math.PI * 2); g.fill();
      txt(g, t(e, "제공 구간 내 위치", "Position in range"), 60, 640, 22, "#8d96aa", { w: 500 });
    }
    areaChart(g, pts.slice(-300), w * .4, 170, w * .6 - 50, h - 230, accent, { labels: true, base: pts[0], digits: spec.digits });
    txt(g, "Yahoo Finance · " + shortTime(q?.quote_time), w - 56, h - 26, 20, "#5f687c", { a: "right", w: 500, f: FONT.mono });
  };
}

function stockPainter(i: number, tag?: string): Painter {
  return (g, w, h, d, e) => {
    const r = d.rows[i];
    const accent = MARKETS[d.market].color;
    background(g, w, h, r ? tone(r.change_pct) : accent);
    if (!r) { waiting(g, 40, 40, w - 80, h - 80, e); return; }
    e.logo(g, d.market, r.code, 50, 44, 96);
    txt(g, tag ?? `POST ${String(Math.floor(i / 2) + 1).padStart(2, "0")} · #${i + 1}`, w - 50, 70, 24, accent, { a: "right", w: 700, f: FONT.mono });
    txt(g, d.market === "sp500" ? r.code : r.name, 170, 96, 54, "#fff", { w: 800, max: w - 520 });
    txt(g, `${d.market === "sp500" ? r.name : r.code}  ·  ${r.sector || MARKETS[d.market].venue}`, 172, 134, 24, "#9aa3b5", { w: 500, max: w - 400 });
    txt(g, displayValue(r.close, d.market === "sp500" ? 2 : 0), 46, 300, 126, "#fff", { w: 700, f: FONT.num, glow: 22 });
    txt(g, MARKETS[d.market].currency, 52, 344, 26, "#8a93a7", { w: 600, f: FONT.num, ls: 3 });
    pill(g, r.change_pct, 52, 420, 40);
    const pts = e.series[r.code] ?? [];
    const stats: [string, string][] = [
      [d.market === "sp500" && d.capBasis === "index_weight" ? t(e, "지수 비중", "Weight") : t(e, "시가총액", "Market cap"),
        d.market === "sp500" ? (d.capBasis === "index_weight" ? displayValue(r.marcap) + "%" : (r.market_cap ? "$" + displayValue(r.market_cap / 1e9, 0) + "B" : "—"))
          : displayValue(r.marcap / 1e12, 1) + t(e, "조", "T KRW")],
      [t(e, "거래대금", "Traded"), r.turnover ? (d.market === "sp500" ? "$" + displayValue(r.turnover / 1e6, 0) + "M" : moneyKr(r.turnover, e)) : "—"],
      [t(e, "90일 범위", "90D range"), pts.length > 1 ? displayValue(Math.min(...pts), 0) + " – " + displayValue(Math.max(...pts), 0) : "—"],
    ];
    stats.forEach(([k, v], j) => {
      const y = 500 + j * 62;
      txt(g, k, 52, y, 24, "#8a93a7", { w: 600 });
      txt(g, v, w * .4 - 30, y, 30, "#e6ebf4", { a: "right", w: 700, f: FONT.num, max: w * .4 - 220 });
      g.fillStyle = "#ffffff10"; g.fillRect(52, y + 18, w * .4 - 82, 1.5);
    });
    areaChart(g, pts, w * .43, 180, w * .57 - 50, h - 240, tone(r.change_pct), { labels: true, ma: 20, base: pts[0], digits: d.market === "sp500" ? 2 : 0 });
    txt(g, t(e, "일별 종가 · 노란선 20일 이동평균", "Daily closes · yellow 20-day MA"), w - 50, h - 28, 20, "#646d80", { a: "right", w: 500 });
  };
}

P.sign = (g, w, h) => {
  g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
  const grad = g.createLinearGradient(0, h * .2, 0, h * .85);
  // Platinum lettering with a cool halo: the hall's nickel, not gilt.
  grad.addColorStop(0, "#ffffff"); grad.addColorStop(.5, "#e4e9f1"); grad.addColorStop(1, "#9aabc4");
  g.font = `800 ${h * .7}px ${FONT.disp}`;
  g.textAlign = "center";
  const spacing = g as G & { letterSpacing?: string };
  if ("letterSpacing" in g) spacing.letterSpacing = h * .12 + "px";
  g.shadowColor = "#7fd3ff"; g.shadowBlur = 34;
  g.fillStyle = grad;
  g.fillText("KOSPIMAP  EXCHANGE", w / 2, h * .76);
  g.shadowBlur = 0;
  if ("letterSpacing" in g) spacing.letterSpacing = "0px";
  // LED pixel pitch.
  g.fillStyle = "#00000055";
  for (let x = 0; x < w; x += 12) g.fillRect(x, 0, 3, h);
  for (let y = 0; y < h; y += 12) g.fillRect(0, y, w, 3);
};

for (let i = 0; i < STOCK_PANELS; i++) P["s" + i] = stockPainter(i);

/** The post-monitor design for any searched stock (detail dialog), in its own market's units. */
export function searchedStockPainter(row: MarketMapItem, market: ExchangeMarket, tag: string): Painter {
  const paint = stockPainter(0, tag);
  return (g, w, h, d, e) => paint(g, w, h, { ...d, market, rows: [row], capBasis: market === "sp500" ? "market_cap" : d.capBasis }, e);
}
for (const symbol of Object.keys(ASSET_SINGLES)) P["a:" + symbol] = assetPainter(symbol);

export const PAINTERS = P;
/** How many pages a list panel cycles through (1 = static). */
export const PAGES: Record<string, (d: FloorSnapshot) => number> = {
  leaders: d => Math.ceil(Math.min(24, rows(d, "leaders").length) / 8),
  gainers: d => Math.ceil(Math.min(24, rows(d, "gainers").length) / 8),
  laggards: d => Math.ceil(Math.min(24, rows(d, "laggards").length) / 8),
  movers: d => Math.ceil(Math.min(24, rows(d, "movers").length) / 8),
  sectors: d => Math.ceil(Math.min(18, d.sectors.length) / 9),
  investor: d => Math.ceil(Math.min(21, d.extras.investor.length) / 7),
  news: d => Math.ceil(Math.min(12, d.extras.hot?.stories.length ?? 0) / 4),
};
/** Panels that change with the clock and repaint every second. */
export const LIVE_PANELS = new Set(["clocks", "session"]);

// ------------------------------------------------------------------ tickers
export type TickerStyle = "amber" | "cyan" | "commodity" | "news" | "ring" | "column";
type Entry = { label: string; value: string; change: number | null | undefined; logo?: string };

/* Company logos on the ticker strips (main thread). Loaded once; when one arrives the strips repaint. */
const tickerLogos = new Map<string, HTMLImageElement | null>();
let tickerLogoListener: (() => void) | undefined;
export function setTickerLogoListener(fn: (() => void) | undefined) { tickerLogoListener = fn; }
function tickerLogo(url: string) {
  const known = tickerLogos.get(url);
  if (known !== undefined) return known && known.complete && known.naturalWidth > 0 ? known : null;
  if (tickerLogos.size > 200) return null;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  tickerLogos.set(url, img);
  img.onload = () => tickerLogoListener?.();
  img.onerror = () => tickerLogos.set(url, null);
  img.src = url;
  return null;
}
/** A rounded white logo chip; returns the width it took (0 when the logo is not ready). */
function drawLogo(g: G, url: string | undefined, x: number, cy: number, size: number) {
  if (!url) return 0;
  const img = tickerLogo(url);
  if (!img) return 0;
  g.save();
  g.beginPath();
  g.roundRect(x, cy - size / 2, size, size, size * .24);
  g.fillStyle = "#f4f6fa";
  g.fill();
  g.clip();
  const s = size * .8 / Math.max(img.naturalWidth, img.naturalHeight);
  g.drawImage(img, x + (size - img.naturalWidth * s) / 2, cy - img.naturalHeight * s / 2, img.naturalWidth * s, img.naturalHeight * s);
  g.restore();
  return size;
}

export function tickerEntries(style: TickerStyle, d: FloorSnapshot, lang: Language): Entry[] {
  const fromRows = d.rows.slice(0, 30).map(r => ({ label: d.market === "sp500" ? r.code : r.name, value: displayValue(r.close, d.market === "sp500" ? 2 : 0), change: r.change_pct, logo: companyLogo(d.market, r.code) }));
  const idx = (Object.keys(MARKETS) as ExchangeMarket[]).map(k => ({ label: MARKETS[k].label, value: displayValue(d.indices[k]?.close), change: d.indices[k]?.change }));
  if (style === "amber" || style === "ring") return [...idx, ...fromRows];
  if (style === "cyan") {
    const world = d.extras.world.map(x => ({ label: x.label, value: displayValue(x.close), change: x.change_pct }));
    const fx = ["KRW=X", "JPYKRW=X", "EURKRW=X", "BTC-USD", "ETH-USD", "GC=F", "CL=F"].map(s => d.tickers[s]).filter(Boolean)
      .map(q => ({ label: q.label, value: displayValue(q.price), change: q.change_pct }));
    return [...idx, ...world, ...fx];
  }
  if (style === "commodity") return d.extras.futures.map(f => ({ label: lang === "ko" ? f.name : f.name_en, value: fixedValue(f.price, Math.min(2, f.decimals)), change: f.change_pct }));
  const hot = d.extras.hot;
  const titles = (hot?.stories ?? []).map(s => ({ label: s.impact, value: s.title, change: s.impact === "호재" ? 1 : s.impact === "악재" ? -1 : 0 }));
  return hot?.headline ? [{ label: "HEADLINE", value: hot.headline, change: 0 }, ...titles] : titles;
}

/** Paints a seamless ticker strip; returns its pixel width (≤ 8192). */
/** The LED strips on the columns: a tall stack of quote cards (name, price, change, a mini bar),
 * scrolled vertically in the shader. Returns the canvas height (the scroll length). */
export function paintColumn(canvas: HTMLCanvasElement, d: FloorSnapshot, lang: Language) {
  const W = 192, H = 4096, CARD = 168;
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext("2d");
  if (!g) return 0;
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  const entries = tickerEntries("ring", d, lang);
  if (!entries.length) return H;
  for (let i = 0, y = 0; y < H; i++, y += CARD) {
    const en = entries[i % entries.length];
    const col = tone(en.change);
    g.fillStyle = "#0b1626"; g.fillRect(8, y + 8, W - 16, CARD - 16);
    g.fillStyle = col; g.fillRect(8, y + 8, 4, CARD - 16);
    const chip = drawLogo(g, en.logo, W - 50, y + 38, 34);
    txt(g, en.label, 20, y + 46, 26, "#e8f2ff", { w: 700, max: W - 34 - (chip ? 40 : 0) });
    txt(g, en.value, 20, y + 90, 30, "#ffffff", { w: 700, f: FONT.num });
    txt(g, `${arrow(en.change)} ${changeText(en.change)}`, 20, y + 128, 24, col, { w: 700, f: FONT.num, glow: 8 });
    const v = Math.max(-1, Math.min(1, (en.change ?? 0) / 5));
    g.fillStyle = "#ffffff14"; g.fillRect(20, y + 142, W - 40, 6);
    g.fillStyle = col; g.fillRect(W / 2, y + 142, (W - 40) / 2 * v, 6);
  }
  // LED pitch, faint
  g.fillStyle = "#00000030";
  for (let py = 0; py < H; py += 4) g.fillRect(0, py, W, 1);
  return H;
}

export function paintTicker(canvas: HTMLCanvasElement, style: TickerStyle, d: FloorSnapshot, lang: Language) {
  const H = 128;
  const g = canvas.getContext("2d");
  if (!g) return 0;
  const entries = tickerEntries(style, d, lang);
  // Readable faces only: Pretendard for names and headlines, Plex Condensed for figures.
  const font = FONT.kr;
  const size = style === "amber" ? 32 : 28;
  g.font = `700 ${size}px ${font}`;
  const widths = entries.map(en => {
    g.font = `700 ${size}px ${font}`;
    const a = measure(g, en.label) + (en.logo ? size * 1.15 + 12 : 0);
    const b = measure(g, en.value);
    g.font = `700 ${size * .8}px ${FONT.num}`;
    const c = style === "news" ? 0 : measure(g, `${arrow(en.change)} ${changeText(en.change)}`);
    return a + b + c + 96;
  });
  let total = 0, count = 0;
  for (const wdt of widths) { if (total + wdt > 8192) break; total += wdt; count++; }
  // Width snaps to 512 px so routine price changes repaint into the same GPU texture.
  const W = Math.max(1024, Math.min(8192, Math.ceil((total || 1) / 512) * 512));
  canvas.width = W; canvas.height = H;
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  const main = style === "amber" ? "#ffb21a" : style === "cyan" ? "#5fe3ff" : style === "commodity" ? "#9cf27a" : style === "ring" ? "#f4f7ff" : "#ffffff";
  let x = 40;
  for (let i = 0; i < count; i++) {
    const en = entries[i];
    g.textBaseline = "middle";
    const col = tone(en.change);
    if (style === "news") {
      g.fillStyle = col; g.beginPath(); g.arc(x + 8, H / 2, 12, 0, Math.PI * 2); g.fill();
      x += 26;
      x += txt(g, en.label, x, H / 2 + 2, size * .75, col, { w: 800, base: "middle" }) + 16;
      x += txt(g, en.value, x, H / 2 + 2, size, main, { w: 600, base: "middle", f: font }) + 70;
      continue;
    }
    x += txt(g, en.label, x, H / 2 + 2, size, style === "amber" ? "#ffcf6a" : main, { w: 600, f: font, base: "middle", glow: style === "amber" ? 6 : 0 }) + 14;
    const chip = drawLogo(g, en.logo, x, H / 2, size * 1.15);
    x += chip ? chip + 12 : 0;
    x += txt(g, en.value, x, H / 2 + 2, size, "#ffffff", { w: 600, f: FONT.num, base: "middle" }) + 12;
    x += txt(g, `${arrow(en.change)} ${changeText(en.change)}`, x, H / 2 + 2, size * .82, col, { w: 700, f: FONT.num, base: "middle", glow: 6 }) + 46;
    g.fillStyle = "#ffffff22"; g.fillRect(x - 26, H * .34, 2, H * .32);
  }
  if (style === "amber") {
    // A faint LED pitch: texture up close without breaking up the letterforms.
    g.fillStyle = "#00000038";
    for (let py = 0; py < H; py += 4) g.fillRect(0, py, W, 1);
  }
  g.textBaseline = "alphabetic";
  return W;
}

/** Panel ids worth listing for a "stocks" picker etc. */
export function panelStockRow(d: FloorSnapshot, id: string) {
  const i = stockIndex(id);
  return i >= 0 ? d.rows[i] : undefined;
}
export { assetSymbol, companyLogo };
