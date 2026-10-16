/** Roads the national base map's centre lines (국가기본도 도로중심선, LT_L_N3A0020000) do not have
 * yet — a new bridge or expressway (고덕토평대교: 세종포천고속도로) — drawn from the standard
 * node-link itself (표준노드링크 LT_L_MOCTLINK): each stretch of an official link (not a tunnel or
 * underpass) with no centre line along it for 30 m or more, inside the box the centre lines were
 * asked for. A link is one direction of travel: one-way, its lanes by the road's class (the link
 * carries no lane count); the two directions of an undivided road on one line become one two-way
 * road. Self-contained (serialised into the streamed-road worker): no imports, no closures.
 * Nothing is moved: the link's own surveyed line is the road's. */
export function linkFallbackRoads(
  roads: { line: number[][]; width: number; lanes: number }[],
  links: { id: string; kind: number; rank: string; line: number[][] }[],
  box: [number, number, number, number],
): { line: number[][]; width: number; lanes: number; oneway: boolean; link: string }[] {
  const cell = 10, hash = new Map<string, number[][]>();
  for (const r of roads) for (let i = 1; i < r.line.length; i++) {
    const a = r.line[i - 1], b = r.line[i], m = r.width / 2 + 8;
    for (let x = Math.floor((Math.min(a[0], b[0]) - m) / cell); x <= Math.floor((Math.max(a[0], b[0]) + m) / cell); x++)
      for (let y = Math.floor((Math.min(a[1], b[1]) - m) / cell); y <= Math.floor((Math.max(a[1], b[1]) + m) / cell); y++) {
        const k = x + ',' + y, l = hash.get(k), seg = [a[0], a[1], b[0], b[1], r.width / 2];
        if (l) l.push(seg); else hash.set(k, [seg]);
      }
  }
  const covered = (x: number, y: number, dx: number, dy: number) => (hash.get(Math.floor(x / cell) + ',' + Math.floor(y / cell)) ?? []).some(([ax, ay, bx, by, hw]) => {
    const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey || 1, u = ((x - ax) * ex + (y - ay) * ey) / l2, t = Math.max(0, Math.min(1, u));
    // (past a centre line's end by more than 2 m is not covered by it: the road ends there)
    if (Math.abs(u - t) * Math.sqrt(l2) > 2 || Math.hypot(ax + ex * t - x, ay + ey * t - y) > hw + 8) return false;
    return Math.abs(ex * dx + ey * dy) / Math.sqrt(l2) > 0.8;
  });
  const LANES: Record<string, number> = { '고속국도': 3, '도시고속국도': 3, '도시고속도로': 3, '일반국도': 2, '특별·광역시도': 2, '국가지원지방도': 2, '지방도': 1, '시·군도': 1, '구도': 1 };
  const inBox = (p: number[]) => p[0] >= box[0] + 20 && p[0] <= box[2] - 20 && p[1] >= box[1] + 20 && p[1] <= box[3] - 20;
  type Out = { line: number[][]; width: number; lanes: number; oneway: boolean; link: string };
  const out: Out[] = [];
  for (const l of links) {
    if (l.kind < 0 || l.line.length < 2) continue;
    const lanes = LANES[l.rank] ?? 1;
    // the link resampled every 5 m; runs not covered by any centre line
    const pts: number[][] = [];
    for (let i = 1; i < l.line.length; i++) {
      const a = l.line[i - 1], b = l.line[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 5));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    }
    let run: number[][] = [];
    // (a bridge's or a viaduct's, or one reaching the link's own end — where it meets the next
    // link — even a short stretch: left out, the deck or the road stops short of what it joins)
    const first = pts[0], last = pts[pts.length - 1];
    const flush = () => {
      let len = 0; for (let i = 1; i < run.length; i++) len += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
      const atEnd = run.length > 1 && (run[0] === first || run[run.length - 1] === last);
      if (len >= (l.kind > 0 || atEnd ? 8 : 30)) out.push({ line: run, width: Math.min(60, lanes * 3.5 + 1), lanes, oneway: true, link: l.id });
      run = [];
    };
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
      if (!inBox(p) || covered(p[0], p[1], q[0] - o[0], q[1] - o[1])) {
        // (one point into the covered road: the two surfaces overlap, no gap)
        if (run.length && inBox(p)) run.push(p);
        flush(); continue;
      }
      if (!run.length && i > 0 && inBox(pts[i - 1])) run.push(pts[i - 1]);
      run.push(p);
    }
    flush();
  }
  // The two directions of an undivided road on one line: one two-way road.
  const mid = (r: Out) => r.line[Math.floor(r.line.length / 2)];
  const dir = (r: Out) => { const a = r.line[0], b = r.line[r.line.length - 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  const gone = new Set<Out>();
  for (const a of out) {
    if (gone.has(a)) continue;
    for (const b of out) {
      if (a === b || gone.has(b) || !a.oneway || !b.oneway) continue;
      const ma = mid(a), mb = mid(b), da = dir(a), db = dir(b);
      if (Math.hypot(ma[0] - mb[0], ma[1] - mb[1]) < 3 && da[0] * db[0] + da[1] * db[1] < -0.9) {
        a.oneway = false; a.lanes += b.lanes; a.width = Math.min(60, a.lanes * 3.5 + 1); gone.add(b); break;
      }
    }
  }
  return out.filter(r => !gone.has(r));
}
