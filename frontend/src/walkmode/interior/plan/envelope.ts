/* The flat's own outline, from the building it is in: the 동's surveyed footprint (its length along
 * the front, its depth from front to back, whether it is a slab, a tower or a corridor block) and the
 * register's lines (호 numbers' last two digits: how many flats a floor, each line's area). The
 * floor plate is shared out to its lines by their areas, less the stair cores; the flat taken is a
 * line of its type (an end line has its side wall to the outside: windows there). Public data has
 * no floor plans — this is the plan's frame, measured; the rooms within are still estimated. */

export type PlateKind = "flat" | "tower" | "corridor";
export interface Envelope {
  /** the flat's width along the front and its depth (m, wall centre lines) */
  width: number; depth: number;
  kind: PlateKind;
  /** an end line: its side wall outside (which side, in the plan's frame: x = 0 or x = max) */
  end: "left" | "right" | null;
  line: number | null; lines: number;
  basis: string;
}

const polyArea = (p: [number, number][]) => { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };

export function envelopeOf(foot: [number, number][] | undefined, heading: number, built: number | null | undefined, area: number,
  lines: { line: number; area: number }[] | undefined, typeLines: number[] | undefined, seed: () => number): Envelope | null {
  if (!foot || foot.length < 3) return null;
  // the plate in the door's frame: u along the front, v from back to front
  const hx = Math.cos(heading), hy = Math.sin(heading);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, y] of foot) { const u = -x * hy + y * hx, v = x * hx + y * hy; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  // (the door may be on a short side: the plate's length is its longer extent)
  let L = u1 - u0, D = v1 - v0; if (D > L) [L, D] = [D, L];
  if (L < 8 || D < 6) return null;
  const fill = polyArea(foot) / (L * D), year = built ?? 2005;
  // the per-line areas, ordered by line
  const byLine = new Map<number, number>();
  for (const l of lines ?? []) if (!byLine.has(l.line)) byLine.set(l.line, l.area);
  const order = [...byLine.keys()].sort((a, b) => a - b);
  const n = order.length >= 2 ? order.length : Math.max(2, Math.round(L / Math.max(6.5, Math.min(15, area * 1.3 / Math.max(6, D - 1.5)))));
  const kind: PlateKind = fill < 0.72 || L / D < 1.55 ? "tower" : year < 2000 && D < 10.5 && n >= 5 ? "corridor" : "flat";
  // stair cores: one to a pair of flats (계단식); a corridor block's two or three for the whole slab
  const cores = kind === "corridor" ? Math.max(1, Math.round(L / 35)) : Math.ceil(n / 2), coreW = kind === "corridor" ? 3.0 : 2.5;
  const usable = Math.max(L * 0.6, L - cores * coreW);
  const total = order.length >= 2 ? order.reduce((s, l) => s + byLine.get(l)!, 0) : n * area;
  // which line: one of the type's own (by the seed), or as many as fit
  const mine = (typeLines ?? []).filter(l => byLine.has(l));
  const line = mine.length ? mine[Math.floor(seed() * mine.length)] : order.length ? order[Math.floor(seed() * order.length)] : null;
  const share = line !== null && byLine.has(line) ? byLine.get(line)! / total : 1 / n;
  const width = Math.min(16, Math.max(5.5, usable * share));
  // the depth inside the walls; a corridor block's open corridor (~1.6 m) along the back is not the flat's
  const depth = Math.min(13.5, Math.max(6, D - 1.0 - (kind === "corridor" ? 1.6 : 0)));
  const end = line !== null && order.length >= 2 ? (line === order[0] ? "left" : line === order[order.length - 1] ? "right" : null) : seed() < 2 / n ? (seed() < 0.5 ? "left" : "right") : null;
  const basis = `동 외곽선 ${L.toFixed(1)}×${D.toFixed(1)}m · ${order.length >= 2 ? `건축물대장 ${order.length}개 라인` : `추정 ${n}세대/층`}${line !== null ? ` · ${line}호 라인` : ""}`;
  return { width, depth, kind, end, line, lines: order.length || n, basis };
}
