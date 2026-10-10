import { surfaceGeometry } from './surfaceGeometry';

/** One immutable set of cross-sections for the slab, paint and traffic. Heights between
 * sections are linear, exactly like the rendered slab, including curved approaches. */
export function bridgeSections(line: number[][], height: (s: number) => number, step = 10) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const total = cum[cum.length - 1];
  const stations = [...new Set([...cum, ...Array.from({ length: Math.ceil(total / step) }, (_, i) => i * step)])].sort((a, b) => a - b);
  let j = 1;
  const points = stations.map(s => {
    while (j < cum.length - 1 && cum[j] < s) j++;
    const f = (s - cum[j - 1]) / (cum[j] - cum[j - 1] || 1);
    return [line[j - 1][0] + (line[j][0] - line[j - 1][0]) * f, line[j - 1][1] + (line[j][1] - line[j - 1][1]) * f];
  });
  const normals = surfaceGeometry.miters(points), heights = stations.map(height);
  const at = (s: number) => {
    s = Math.max(0, Math.min(total, s));
    let lo = 0, hi = stations.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (stations[m] <= s) lo = m; else hi = m; }
    const f = (s - stations[lo]) / (stations[hi] - stations[lo] || 1);
    const a = points[lo], b = points[hi], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f,
      z: heights[lo] + (heights[hi] - heights[lo]) * f,
      nx: normals[lo][0] + (normals[hi][0] - normals[lo][0]) * f,
      ny: normals[lo][1] + (normals[hi][1] - normals[lo][1]) * f,
      tx: (b[0] - a[0]) / L, ty: (b[1] - a[1]) / L, k: lo };
  };
  return { stations, points, heights, normals, total, at };
}

/** Explicit bridge traffic is cut at exact tile edges. A lower storey is only driven
 * where both ends of its physical slab exist; proximity never connects the two storeys. */
export function bridgeTileLanes(sections: ReturnType<typeof bridgeSections>, lower: boolean[], box: [number, number, number, number], depth = 7.5) {
  const bounds = sections.points.reduce((b, p) => [Math.min(b[0], p[0] - 16), Math.min(b[1], p[1] - 16), Math.max(b[2], p[0] + 16), Math.max(b[3], p[1] + 16)], [Infinity, Infinity, -Infinity, -Infinity]);
  if (bounds[0] > box[2] || bounds[2] < box[0] || bounds[1] > box[3] || bounds[3] < box[1]) return new Float32Array();
  const out: number[] = [];
  for (const storey of [0, 1]) for (const offset of [-5.25, -1.75, 1.75, 5.25]) {
    let run: number[][] = [];
    const flush = () => {
      if (run.length > 1) { if (storey) run.reverse(); out.push(run.length, 14, ...run.flat()); }
      run = [];
    };
    for (let i = 1; i < sections.points.length; i++) {
      if (storey && !lower[i - 1]) { flush(); continue; }
      const point = (k: number) => [sections.points[k][0] + sections.normals[k][0] * offset, sections.points[k][1] + sections.normals[k][1] * offset];
      const hit = surfaceGeometry.clipSegment(point(i - 1), point(i), box);
      if (!hit) { flush(); continue; }
      const row = (xy: number[], f: number) => [...xy, sections.heights[i - 1] + (sections.heights[i] - sections.heights[i - 1]) * f - storey * depth + .02];
      if (run.length && Math.hypot(run[run.length - 1][0] - hit.a[0], run[run.length - 1][1] - hit.a[1]) > 1e-5) flush();
      if (!run.length) run.push(row(hit.a, hit.lo));
      run.push(row(hit.b, hit.hi));
      if (hit.hi < 1 - 1e-7) flush();
    }
    flush();
  }
  return new Float32Array(out);
}

/** A precise, direction-aware footprint; nearby parallel shore roads remain usable. */
export function bridgeContains(line: number[][], x: number, y: number, dx: number, dy: number, half = 13) {
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    if (x < Math.min(a[0], b[0]) - half || x > Math.max(a[0], b[0]) + half || y < Math.min(a[1], b[1]) - half || y > Math.max(a[1], b[1]) + half) continue;
    const ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1;
    if (Math.abs(ex * dx + ey * dy) / (Math.sqrt(l2) * (Math.hypot(dx, dy) || 1)) < .85) continue;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / l2));
    if (Math.hypot(x - a[0] - ex * t, y - a[1] - ey * t) <= half) return true;
  }
  return false;
}
