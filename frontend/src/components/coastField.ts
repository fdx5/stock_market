type Point = [number, number];
export type CoastData = { rings: Point[][]; holes: Point[][]; open: [number, number, number, number] | null; level: number; seaOnly: boolean };

/** Prepared vector coastline. The query box is not a coast; neither grid cells nor
 * terrain samples decide where sea ends. Built once per water job, never per frame. */
export function coastField(data: CoastData) {
  const prepare = (ring: Point[]) => {
    const rows = new Map<number, number[]>();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    ring.forEach(([x, y], i) => {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      const b = ring[(i + 1) % ring.length];
      for (let j = Math.floor(Math.min(y, b[1]) / 64); j <= Math.floor(Math.max(y, b[1]) / 64); j++) {
        const row = rows.get(j) ?? []; row.push(i); rows.set(j, row);
      }
    });
    return { ring, rows, x0, y0, x1, y1 };
  };
  const rings = data.rings.map(prepare), holes = data.holes.map(prepare);
  const inside = (p: ReturnType<typeof prepare>, x: number, y: number) => {
    if (x < p.x0 || x > p.x1 || y < p.y0 || y > p.y1) return false;
    let odd = false;
    for (const i of p.rows.get(Math.floor(y / 64)) ?? []) {
      const a = p.ring[i], b = p.ring[(i + 1) % p.ring.length];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) odd = !odd;
    }
    return odd;
  };
  type Edge = { ax: number; ay: number; dx: number; dy: number; l2: number; x0: number; y0: number; x1: number; y1: number };
  const edges: Edge[] = [];
  for (const p of [...data.rings, ...data.holes]) p.forEach(([ax, ay], i) => {
    const [bx, by] = p[(i + 1) % p.length], o = data.open;
    if (o && ((Math.abs(ax - o[0]) < .05 && Math.abs(bx - o[0]) < .05) || (Math.abs(ax - o[2]) < .05 && Math.abs(bx - o[2]) < .05)
      || (Math.abs(ay - o[1]) < .05 && Math.abs(by - o[1]) < .05) || (Math.abs(ay - o[3]) < .05 && Math.abs(by - o[3]) < .05))) return;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    if (l2 > 1e-8) edges.push({ ax, ay, dx, dy, l2, x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) });
  });
  type Node = { x0: number; y0: number; x1: number; y1: number; edges?: Edge[]; left?: Node; right?: Node };
  const build = (e: Edge[]): Node => {
    const n: Node = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const a of e) { n.x0 = Math.min(n.x0, a.x0); n.y0 = Math.min(n.y0, a.y0); n.x1 = Math.max(n.x1, a.x1); n.y1 = Math.max(n.y1, a.y1); }
    if (e.length <= 8) n.edges = e;
    else { const x = n.x1 - n.x0 > n.y1 - n.y0; e.sort((a, b) => x ? a.x0 + a.x1 - b.x0 - b.x1 : a.y0 + a.y1 - b.y0 - b.y1); const m = e.length >> 1; n.left = build(e.slice(0, m)); n.right = build(e.slice(m)); }
    return n;
  };
  const root = build(edges);
  const boxDistance = (n: Node, x: number, y: number) => Math.max(n.x0 - x, 0, x - n.x1) ** 2 + Math.max(n.y0 - y, 0, y - n.y1) ** 2;
  const distance = (x: number, y: number) => {
    let best = 1e12;
    const visit = (n: Node) => {
      if (boxDistance(n, x, y) >= best) return;
      if (n.edges) for (const a of n.edges) {
        const t = Math.max(0, Math.min(1, ((x - a.ax) * a.dx + (y - a.ay) * a.dy) / a.l2));
        best = Math.min(best, (x - a.ax - a.dx * t) ** 2 + (y - a.ay - a.dy * t) ** 2);
      }
      else {
        const a = n.left!, b = n.right!;
        if (boxDistance(a, x, y) < boxDistance(b, x, y)) { visit(a); visit(b); } else { visit(b); visit(a); }
      }
    };
    visit(root); return Math.sqrt(best);
  };
  return { distance, wet: (x: number, y: number) => rings.some(r => inside(r, x, y)) && !holes.some(r => inside(r, x, y)), level: data.level, open: data.open };
}
