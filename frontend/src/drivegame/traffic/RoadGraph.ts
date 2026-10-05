import type { RoadLine } from "../world/tileWorker";

/* The roads as the traffic and the navigation see them, grown and shrunk as tiles come and go:
 * each surveyed centreline an edge (resampled every 3 m, with heights: bridges included), its
 * ends merged into nodes where they meet; three or more ends a junction (signalled on major
 * roads), a road ending on another's side a T. Lanes each way from the surveyed count and width. */

export interface Edge {
  id: string; idx: number; xs: Float32Array; ys: Float32Array; hs: Float32Array; cum: Float32Array; len: number;
  w: number; lanes: number; major: boolean; a: number; b: number;
  /** stop back from each end (m, along): the junction's box and its crossing */
  trimA: number; trimB: number;
  /** a T: this end joins `onto` part way along it, at centreline distance `at` */
  teeA?: { edge: number; at: number }; teeB?: { edge: number; at: number };
  alive: boolean;
}
export interface Node {
  idx: number; x: number; y: number; ends: { edge: number; atA: boolean }[];
  signal: { phases: number; phaseOf: Map<string, number>; offset: number } | null;
  alive: boolean;
}

const G = 8;
const gkey = (x: number, y: number) => Math.floor(x / G) * 100003 + Math.floor(y / G);

export class RoadGraph {
  edges: Edge[] = [];
  nodes: Node[] = [];
  private byId = new Map<string, number>();
  private nodeGrid = new Map<number, number[]>();
  private segGrid = new Map<number, number[]>();   // (edge index * 4096 + segment) per 8 m cell... edges by cell
  private free: number[] = [];
  private freeNodes: number[] = [];
  version = 0;

  lanesOf(e: Edge) { return Math.max(1, Math.min(Math.floor(Math.max(2, e.lanes) / 2), Math.floor(e.w / 2 / 3))); }
  laneW(e: Edge) { return Math.max(2.8, e.w / 2 / this.lanesOf(e)); }

  add(lines: RoadLine[]) {
    const touched = new Set<number>();
    for (const L of lines) {
      if (this.byId.has(L.id)) continue;
      const n = L.pts.length / 3;
      if (n < 2) continue;
      const xs = new Float32Array(n), ys = new Float32Array(n), hs = new Float32Array(n), cum = new Float32Array(n);
      for (let k = 0; k < n; k++) { xs[k] = L.pts[k * 3]; ys[k] = L.pts[k * 3 + 1]; hs[k] = L.pts[k * 3 + 2]; if (k) cum[k] = cum[k - 1] + Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]); }
      if (cum[n - 1] < 1) continue;
      const idx = this.free.pop() ?? this.edges.length;
      const e: Edge = { id: L.id, idx, xs, ys, hs, cum, len: cum[n - 1], w: L.w, lanes: L.lanes, major: L.major, a: -1, b: -1, trimA: 0, trimB: 0, alive: true };
      this.edges[idx] = e;
      this.byId.set(L.id, idx);
      e.a = this.nodeAt(xs[0], ys[0]); e.b = this.nodeAt(xs[n - 1], ys[n - 1]);
      this.nodes[e.a].ends.push({ edge: idx, atA: true }); this.nodes[e.b].ends.push({ edge: idx, atA: false });
      touched.add(e.a); touched.add(e.b);
      for (let k = 1; k < n; k++) this.cellAdd(this.segGrid, (xs[k] + xs[k - 1]) / 2, (ys[k] + ys[k - 1]) / 2, idx);
    }
    if (touched.size) this.refresh(touched);
  }
  remove(ids: string[]) {
    const touched = new Set<number>();
    for (const id of ids) {
      const idx = this.byId.get(id);
      if (idx === undefined) continue;
      const e = this.edges[idx];
      e.alive = false; this.byId.delete(id);
      for (const ni of [e.a, e.b]) { const nd = this.nodes[ni]; nd.ends = nd.ends.filter(o => o.edge !== idx); touched.add(ni); }
      for (let k = 1; k < e.xs.length; k++) this.cellDel(this.segGrid, (e.xs[k] + e.xs[k - 1]) / 2, (e.ys[k] + e.ys[k - 1]) / 2, idx);
      this.free.push(idx);
    }
    if (touched.size) this.refresh(touched);
  }
  private cellAdd(m: Map<number, number[]>, x: number, y: number, v: number) { const k = gkey(x, y), l = m.get(k); if (!l) m.set(k, [v]); else if (l[l.length - 1] !== v) l.push(v); }
  private cellDel(m: Map<number, number[]>, x: number, y: number, v: number) { const k = gkey(x, y), l = m.get(k); if (!l) return; const i = l.indexOf(v); if (i >= 0) l.splice(i, 1); if (!l.length) m.delete(k); }
  private nodeAt(x: number, y: number) {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const ni of this.nodeGrid.get(gkey(x + i * G, y + j * G)) ?? []) {
      const n = this.nodes[ni];
      if (n.alive && Math.hypot(n.x - x, n.y - y) < 1.5) return ni;
    }
    const idx = this.freeNodes.pop() ?? this.nodes.length;
    this.nodes[idx] = { idx, x, y, ends: [], signal: null, alive: true };
    this.cellAdd(this.nodeGrid, x, y, idx);
    return idx;
  }
  /** Edges with a segment within r of (x, y). */
  edgesNear(x: number, y: number, r: number, out = new Set<number>()) {
    for (let i = Math.floor((x - r) / G); i <= Math.floor((x + r) / G); i++) for (let j = Math.floor((y - r) / G); j <= Math.floor((y + r) / G); j++)
      for (const e of this.segGrid.get(i * 100003 + j) ?? []) out.add(e);
    return out;
  }
  /** Nearest point on any edge (centreline): edge, distance along, how far off. */
  nearest(x: number, y: number, r = 60, majorOnly = true): { edge: number; d: number; off: number; k: number } | null {
    // (searched in widening rings: a wide radius is thousands of cells)
    if (r > 50) for (const rr of [25, 60, 150]) { if (rr >= r) break; const hit = this.nearest(x, y, rr, majorOnly); if (hit && hit.off <= rr) return hit; }
    let best: { edge: number; d: number; off: number; k: number } | null = null;
    for (const ei of this.edgesNear(x, y, r)) {
      const e = this.edges[ei];
      if (!e.alive || (majorOnly && !e.major)) continue;
      for (let k = 1; k < e.xs.length; k++) {
        const ax = e.xs[k - 1], ay = e.ys[k - 1], dx = e.xs[k] - ax, dy = e.ys[k] - ay, l2 = dx * dx + dy * dy || 1e-6;
        if (Math.abs(x - ax) > r + 4 && Math.abs(x - e.xs[k]) > r + 4) continue;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)), off = Math.hypot(x - ax - dx * t, y - ay - dy * t);
        if (!best || off < best.off) best = { edge: ei, d: e.cum[k - 1] + Math.sqrt(l2) * t, off, k };
      }
    }
    return best;
  }

  /** Junction roles, stop distances, T joins and signals for the nodes touched (and their edges' other ends). */
  private refresh(nodes: Set<number>) {
    this.version++;
    const edges = new Set<number>();
    for (const ni of nodes) for (const e of this.nodes[ni].ends) edges.add(e.edge);
    for (const ni of nodes) {
      const nd = this.nodes[ni];
      if (!nd.ends.length) {
        // (a node with no roads left: its slot free for another)
        if (nd.alive) { nd.alive = false; nd.signal = null; this.cellDel(this.nodeGrid, nd.x, nd.y, ni); this.freeNodes.push(ni); }
        continue;
      }
      // trims: as the tiles paint them (tileWorker cutOf): the widest other arm's half + 2 m, then
      // the crossing (4 m) and the stop line: traffic stops 5.4 m on from there
      for (const end of nd.ends) {
        const e = this.edges[end.edge];
        let w = 0, n = 0;
        for (const o of nd.ends) if (o.edge !== end.edge) { n++; w = Math.max(w, this.edges[o.edge].w); }
        const junction = n >= 2;
        const trim = junction ? Math.max(w, 6) / 2 + 2 + 5.4 : 0;
        if (end.atA) e.trimA = Math.min(trim, e.len * 0.45); else e.trimB = Math.min(trim, e.len * 0.45);
      }
      // signals: three or more major arms on a road 12 m or wider
      const majors = nd.ends.filter(o => this.edges[o.edge].major);
      const wMax = Math.max(0, ...nd.ends.map(o => this.edges[o.edge].w));
      if (majors.length >= 3 && wMax >= 12) {
        // each approach direction its own phase (방향별 신호): arms within 40° share one
        const groups: { a: number; keys: string[] }[] = [];
        for (const end of nd.ends) {
          const [hx, hy] = this.headingInto(this.edges[end.edge], end.atA);
          const a = Math.atan2(hy, hx), g = groups.find(o => Math.abs(Math.atan2(Math.sin(a - o.a), Math.cos(a - o.a))) < 0.7);
          const key = `${end.edge}:${end.atA ? "a" : "b"}`;
          if (g) g.keys.push(key); else groups.push({ a, keys: [key] });
        }
        groups.sort((p, q) => p.a - q.a);
        while (groups.length > 4) { const g = groups.pop()!; groups[groups.length - 1].keys.push(...g.keys); }
        const phaseOf = new Map<string, number>();
        groups.forEach((g, i) => g.keys.forEach(k => phaseOf.set(k, i)));
        nd.signal = { phases: groups.length, phaseOf, offset: nd.signal?.offset ?? (Math.abs(Math.sin(nd.x * 12.9898 + nd.y * 78.233)) * 43758.5453 % 1) * 60 };
      } else nd.signal = null;
    }
    // T joins: an end alone at its node, on another major road's side
    for (const ei of edges) {
      const e = this.edges[ei];
      if (!e.alive) continue;
      for (const atA of [true, false]) {
        const nd = this.nodes[atA ? e.a : e.b];
        let tee: { edge: number; at: number } | undefined;
        if (nd.ends.length === 1) {
          const x = atA ? e.xs[0] : e.xs[e.xs.length - 1], y = atA ? e.ys[0] : e.ys[e.ys.length - 1];
          let best = Infinity;
          for (const oi of this.edgesNear(x, y, 30)) {
            if (oi === ei) continue;
            const o = this.edges[oi];
            if (!o.alive) continue;
            for (let k = 1; k < o.xs.length; k++) {
              const ax = o.xs[k - 1], ay = o.ys[k - 1], dx = o.xs[k] - ax, dy = o.ys[k] - ay, l2 = dx * dx + dy * dy || 1e-6;
              const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)), d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
              const at = o.cum[k - 1] + Math.sqrt(l2) * t;
              if (d < o.w / 2 + 3 && d < best && at > 4 && at < o.len - 4) { best = d; tee = { edge: oi, at }; }
            }
          }
          if (tee) { const o = this.edges[tee.edge]; const trim = o.w / 2 + 1.5; if (atA) e.trimA = Math.min(trim, e.len * 0.45); else e.trimB = Math.min(trim, e.len * 0.45); }
        }
        if (atA) e.teeA = tee; else e.teeB = tee;
      }
    }
  }

  /** Unit heading of travel arriving at end A (atA) or B along the edge. */
  headingInto(e: Edge, atA: boolean): [number, number] {
    const n = e.xs.length;
    if (atA) { const dx = e.xs[0] - e.xs[1], dy = e.ys[0] - e.ys[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; }
    const dx = e.xs[n - 1] - e.xs[n - 2], dy = e.ys[n - 1] - e.ys[n - 2], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l];
  }

  /** Point, heading and height at centreline distance d. */
  at(e: Edge, d: number, out: { x: number; y: number; h: number; ux: number; uy: number }) {
    const n = e.xs.length;
    d = Math.max(0, Math.min(e.len, d));
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (e.cum[m] <= d) lo = m; else hi = m; }
    const seg = e.cum[hi] - e.cum[lo] || 1, t = (d - e.cum[lo]) / seg;
    const dx = e.xs[hi] - e.xs[lo], dy = e.ys[hi] - e.ys[lo], l = Math.hypot(dx, dy) || 1;
    let ux = dx / l, uy = dy / l;
    // (the heading eased over the last and next metre of each bend: no steps)
    if (t < 0.35 && lo > 0) { const px = e.xs[lo] - e.xs[lo - 1], py = e.ys[lo] - e.ys[lo - 1], pl = Math.hypot(px, py) || 1, w = 0.5 + t / 0.7; ux = ux * w + px / pl * (1 - w); uy = uy * w + py / pl * (1 - w); }
    else if (t > 0.65 && hi < n - 1) { const qx = e.xs[hi + 1] - e.xs[hi], qy = e.ys[hi + 1] - e.ys[hi], ql = Math.hypot(qx, qy) || 1, w = 0.5 + (1 - t) / 0.7; ux = ux * w + qx / ql * (1 - w); uy = uy * w + qy / ql * (1 - w); }
    const ul = Math.hypot(ux, uy) || 1;
    out.x = e.xs[lo] + dx * t; out.y = e.ys[lo] + dy * t; out.h = e.hs[lo] + (e.hs[hi] - e.hs[lo]) * t; out.ux = ux / ul; out.uy = uy / ul;
    return out;
  }

  /** The shortest way along the roads from one point to another (A*, binary heap): a polyline, or
   * the way to the reachable point nearest the goal when the roads don't reach it yet. */
  route(ax: number, ay: number, bx: number, by: number): [number, number][] | null {
    const s = this.nearest(ax, ay, 80, false), g = this.nearest(bx, by, 400, false);
    if (!s) return null;
    const edgeLine = (e: Edge, d0: number, d1: number) => {
      const out: [number, number][] = [], p = { x: 0, y: 0, h: 0, ux: 0, uy: 0 };
      this.at(e, d0, p); out.push([p.x, p.y]);
      if (d1 >= d0) { for (let k = 1; k < e.xs.length - 1; k++) if (e.cum[k] > d0 && e.cum[k] < d1) out.push([e.xs[k], e.ys[k]]); }
      else for (let k = e.xs.length - 2; k >= 1; k--) if (e.cum[k] < d0 && e.cum[k] > d1) out.push([e.xs[k], e.ys[k]]);
      this.at(e, d1, p); out.push([p.x, p.y]);
      return out;
    };
    if (g && g.edge === s.edge) return edgeLine(this.edges[s.edge], s.d, g.d);
    // nodes as states; T joins as extra links (from the T's end to the point on the other road)
    const N = this.nodes.length, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), via = new Int32Array(N).fill(-1);
    const heap: number[] = [], key: number[] = [];
    const push = (n: number, k: number) => { heap.push(n); key.push(k); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (key[p] <= key[i]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; [key[p], key[i]] = [key[i], key[p]]; i = p; } };
    const pop = () => { const top = heap[0]; const lh = heap.pop()!, lk = key.pop()!; if (heap.length) { heap[0] = lh; key[0] = lk; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && key[l] < key[m]) m = l; if (r < heap.length && key[r] < key[m]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; [key[m], key[i]] = [key[i], key[m]]; i = m; } } return top; };
    const H = (n: number) => Math.hypot(this.nodes[n].x - bx, this.nodes[n].y - by);
    const se = this.edges[s.edge];
    dist[se.a] = s.d; dist[se.b] = se.len - s.d;
    push(se.a, s.d + H(se.a)); push(se.b, se.len - s.d + H(se.b));
    const ge = g ? this.edges[g.edge] : null;
    let goal = -1, bestN = -1, bestH = Infinity;
    const done = new Uint8Array(N);
    let guard = 0;
    while (heap.length && guard++ < 60000) {
      const u = pop();
      if (done[u]) continue;
      done[u] = 1;
      const hu = H(u); if (hu < bestH) { bestH = hu; bestN = u; }
      if (ge && (u === ge.a || u === ge.b)) { goal = u; break; }
      for (const end of this.nodes[u].ends) {
        const e = this.edges[end.edge];
        if (!e.alive) continue;
        const v = end.atA ? e.b : e.a, nd = dist[u] + e.len;
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; via[v] = end.edge; push(v, nd + H(v)); }
      }
    }
    const target = goal >= 0 ? goal : bestN;
    if (target < 0) return null;
    // back from the target to the start's edge
    const chain: number[] = [];
    for (let n = target; prev[n] >= 0 && chain.length < 5000; n = prev[n]) chain.unshift(via[n]);
    const out: [number, number][] = [];
    // start: along the start edge to the node the chain leaves from
    let at = chain.length ? this.startNodeOf(chain, target) : target;
    out.push(...edgeLine(se, s.d, at === se.a ? 0 : se.len));
    for (const ei of chain) {
      const e = this.edges[ei];
      const fwd = e.a === at;
      out.push(...edgeLine(e, fwd ? 0 : e.len, fwd ? e.len : 0));
      at = fwd ? e.b : e.a;
    }
    if (goal >= 0 && ge) out.push(...edgeLine(ge, at === ge.a ? 0 : ge.len, g!.d));
    return out.filter((q, i) => i === 0 || Math.hypot(q[0] - out[i - 1][0], q[1] - out[i - 1][1]) > 0.3);
  }
  private startNodeOf(chain: number[], target: number) {
    // walk back from the target through the chain to find the node it starts at
    let at = target;
    for (let i = chain.length - 1; i >= 0; i--) { const e = this.edges[chain[i]]; at = e.a === at ? e.b : e.a; }
    return at;
  }
}
