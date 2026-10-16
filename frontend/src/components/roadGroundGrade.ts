/** Smooth a ground road along its own centreline. Outside its physical ends,
 * continue the inward bank slope instead of sampling a river bed or another road.
 * Self-contained factory, shared with the streamed-road worker. */
export function groundRoadGrade() {
  const geometry = new WeakMap<object, { s: number[]; total: number }>();
  return (line: readonly (readonly number[])[], station: number,
    ground: (x: number, y: number) => number,
    water?: (x: number, y: number) => number | null) => {
    const dry = (p: readonly number[]) => {
      const h = ground(p[0], p[1]), w = water?.(p[0], p[1]);
      return w == null ? h : Math.max(h, w + .3);
    };
    if (line.length < 2) return line.length ? dry(line[0]) : 0;
    let profile = geometry.get(line);
    if (!profile) {
      const s = [0];
      for (let i = 1; i < line.length; i++) s.push(s[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
      profile = { s, total: s[s.length - 1] }; geometry.set(line, profile);
    }
    const { s, total } = profile;
    if (!(total > .001)) return dry(line[0]);
    const at = (distance: number) => {
      let lo = 0, hi = s.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid] <= distance) lo = mid; else hi = mid; }
      const f = Math.max(0, Math.min(1, (distance - s[lo]) / (s[hi] - s[lo] || 1)));
      return dry([line[lo][0] + (line[hi][0] - line[lo][0]) * f, line[lo][1] + (line[hi][1] - line[lo][1]) * f]);
    };
    const center = Math.max(0, Math.min(total, station)), probe = Math.min(4, total);
    const start = center < 16 ? at(0) : 0, startSlope = center < 16 ? (at(probe) - start) / probe : 0;
    const end = center > total - 16 ? at(total) : 0, endSlope = center > total - 16 ? (end - at(total - probe)) / probe : 0;
    let sum = 0;
    for (let d = -16; d <= 16; d += 4) {
      const p = center + d;
      sum += p < 0 ? start + startSlope * p : p > total ? end + endSlope * (p - total) : at(p);
    }
    // Independent pieces meeting at the same surveyed node must agree there.
    // A truncated smoothing window used to give each piece its own bank height
    // (metres apart on a slope), breaking otherwise connected traffic lanes.
    const edge = Math.min(center, total - center), t = Math.min(1, edge / 16);
    const blend = t * t * (3 - 2 * t);
    return at(center) * (1 - blend) + (sum / 9) * blend;
  };
}

export const groundRoadHeight = groundRoadGrade();
