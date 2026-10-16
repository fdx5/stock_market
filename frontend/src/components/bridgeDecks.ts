/** One deck per bridge (pure): the pieces of road lying on a bridge's chain (bridgeChains.ts) —
 * the base map's centre lines (each its own surveyed width: 39.3, 34.1, 4.5 m pieces of one
 * 성산대교 deck), the links laid where the base map has none (one lane wide) — are not drawn
 * piece by piece. Each chain's stretch they cover (projected on its line; gaps up to `gap` m
 * between them closed: one bridge is never cut) becomes one road along the chain's own line, at its
 * deck's offset, with its deck's width and lanes (ChainDeck) — the same across the whole bridge, in
 * the view and in every tile, from the same chain. The two directions' chains of a two-way deck
 * (both on one base-map line) are one deck: the lower id's.
 * Self-contained (serialised into the streamed-road worker): no imports, no closures.
 * Returns the decks, and per span whether it was taken in (otherwise its piece is kept as it was). */
export function chainDeckRoads(
  spans: { chain: string; line: number[][] }[],
  chains: { ids: string[]; line: number[][]; core?: [number, number]; s?: number[]; z?: number[];
    deck?: { w: number; off: number; lanes: number; twoWay: boolean } }[],
  gap = 120,
  ext = 3,
): { decks: { chain: string; line: number[][]; width: number; lanes: number; twoWay: boolean }[]; taken: boolean[] } {
  type C = (typeof chains)[number];
  const byKey = new Map<string, C>();
  for (const c of chains) if (c.deck && c.line.length > 1) byKey.set(c.ids[0], c);
  const cumOf = new Map<C, number[]>();
  const cum = (c: C) => {
    let v = cumOf.get(c);
    if (!v) { v = [0]; for (let i = 1; i < c.line.length; i++) v.push(v[i - 1] + Math.hypot(c.line[i][0] - c.line[i - 1][0], c.line[i][1] - c.line[i - 1][1])); cumOf.set(c, v); }
    return v;
  };
  // (a point's station along a chain's line, its signed offset left of it, and the line's way there)
  const along = (c: C, x: number, y: number) => {
    const l = c.line, q = cum(c);
    let best = { d: Infinity, s: 0, o: 0, tx: 1, ty: 0 };
    for (let i = 1; i < l.length; i++) {
      const a = l[i - 1], b = l[i], ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey);
      if (!L) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / (L * L))), px = a[0] + ex * t, py = a[1] + ey * t, d = Math.hypot(x - px, y - py);
      if (d < best.d) best = { d, s: q[i - 1] + t * L, o: (x - px) * (-ey / L) + (y - py) * (ex / L), tx: ex / L, ty: ey / L };
    }
    return best;
  };
  // (a point at station s of a chain's line, offset `off` to its left; at a vertex the two
  // segments' normals averaged — a mitred edge, no kink)
  const at = (c: C, s: number, off: number) => {
    const l = c.line, q = cum(c);
    let i = 1; while (i < l.length - 1 && q[i] < s) i++;
    const a = l[i - 1], b = l[i], L = (q[i] - q[i - 1]) || 1, f = Math.max(0, Math.min(1, (s - q[i - 1]) / L));
    let nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
    const near = (k: number) => Math.abs(s - q[k]) < 1e-6;
    const nOf = (k: number) => { const u = l[k - 1], v = l[k], m = Math.hypot(v[0] - u[0], v[1] - u[1]) || 1; return [-(v[1] - u[1]) / m, (v[0] - u[0]) / m]; };
    if (near(i) && i < l.length - 1) {
      const n2 = nOf(i + 1), m = Math.hypot(nx + n2[0], ny + n2[1]);
      if (m > 1e-6) {
        const mx = (nx + n2[0]) / m, my = (ny + n2[1]) / m;
        const scale = Math.min(2.5, 1 / Math.max(.4, mx * nx + my * ny));
        nx = mx * scale; ny = my * scale;
      }
    }
    return [a[0] + (b[0] - a[0]) * f + nx * off, a[1] + (b[1] - a[1]) * f + ny * off];
  };
  const height = (c: C, station: number) => {
    if (!c.s || !c.z || c.s.length !== c.z.length || c.s.length < 2) return null;
    let i = 1; while (i < c.s.length - 1 && c.s[i] < station) i++;
    const f = Math.max(0, Math.min(1, (station - c.s[i - 1]) / (c.s[i] - c.s[i - 1] || 1)));
    return c.z[i - 1] + (c.z[i] - c.z[i - 1]) * f;
  };
  // Both ends and the interior must describe the same physical deck. A midpoint
  // alone also matches crossing, stacked and shorter neighbouring bridges.
  const sameDeck = (c: C, o: C) => {
    if (Math.abs(c.deck!.w - o.deck!.w) > Math.max(2, Math.min(c.deck!.w, o.deck!.w) * .1)) return false;
    const cq = cum(c), oq = cum(o), ct = cq[cq.length - 1], ot = oq[oq.length - 1];
    const ca = at(c, 0, c.deck!.off), cb = at(c, ct, c.deck!.off), oa = at(o, 0, o.deck!.off), ob = at(o, ot, o.deck!.off);
    const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (Math.min(Math.max(distance(ca, oa), distance(cb, ob)), Math.max(distance(ca, ob), distance(cb, oa))) > 3) return false;
    for (const [a, b, total] of [[c, o, ct], [o, c, ot]] as [C, C, number][]) {
      for (const fraction of [0, .25, .5, .75, 1]) {
        const station = total * fraction, point = at(a, station, a.deck!.off), p = along(b, point[0], point[1]);
        if (distance(point, at(b, p.s, b.deck!.off)) > 3) return false;
        const az = height(a, station), bz = height(b, p.s);
        if (az !== null && bz !== null && Math.abs(az - bz) > .5) return false;
      }
    }
    return true;
  };
  // The deck a chain's pieces go on: its own, or the verified deck both directions share.
  const home = new Map<C, C>();
  const homeOf = (c: C): C => {
    let h = home.get(c);
    if (h) return h;
    h = c;
    if (c.deck!.twoWay) {
      for (const o of byKey.values()) {
        if (o === c || !o.deck!.twoWay || o.ids[0] >= h.ids[0]) continue;
        if (sameDeck(c, o)) h = o;
      }
    }
    home.set(c, h);
    return h;
  };
  const runs = new Map<C, [number, number][]>();
  // The official bridge core is continuous even when the base map has missing
  // pieces or a tile contains none. Only the confirmed chain supplies its shape.
  for (const c of byKey.values()) {
    if (!c.core || !c.core.every(Number.isFinite)) continue;
    const q = cum(c), total = q[q.length - 1], a = Math.max(0, c.core[0]), b = Math.min(total, c.core[1]);
    if (b - a < 1) continue;
    const h = homeOf(c), p = at(c, a, c.deck!.off), r = at(c, b, c.deck!.off);
    const s0 = along(h, p[0], p[1]).s, s1 = along(h, r[0], r[1]).s;
    let list = runs.get(h); if (!list) runs.set(h, list = []);
    list.push([Math.min(s0, s1), Math.max(s0, s1)]);
  }
  const taken = spans.map(sp => {
    const c = byKey.get(sp.chain);
    if (!c || sp.line.length < 2) return false;
    const h = homeOf(c), A = sp.line[0], B = sp.line[sp.line.length - 1];
    const pa = along(h, A[0], A[1]), pb = along(h, B[0], B[1]), reach = h.deck!.w / 2 + Math.abs(h.deck!.off) + 8;
    // (a piece off the deck's line — a ramp leaving it — is not the deck: kept as it is)
    if (pa.d > reach || pb.d > reach) return false;
    let list = runs.get(h); if (!list) runs.set(h, list = []);
    list.push([Math.min(pa.s, pb.s), Math.max(pa.s, pb.s)]);
    return true;
  });
  const decks: { chain: string; line: number[][]; width: number; lanes: number; twoWay: boolean }[] = [];
  for (const [c, list] of runs) {
    list.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const r of list) { const m = merged[merged.length - 1]; if (m && r[0] - m[1] <= gap) m[1] = Math.max(m[1], r[1]); else merged.push([r[0], r[1]]); }
    const q = cum(c), total = q[q.length - 1];
    for (const [s0r, s1r] of merged) {
      // (a little past each end, under the road it meets: no seam open between them)
      const s0 = Math.max(0, s0r - ext), s1 = Math.min(total, s1r + ext);
      if (s1 - s0 < 1) continue;
      const line: number[][] = [at(c, s0, c.deck!.off)];
      for (let i = 1; i < q.length - 1; i++) if (q[i] > s0 + 0.5 && q[i] < s1 - 0.5) line.push(at(c, q[i], c.deck!.off));
      line.push(at(c, s1, c.deck!.off));
      decks.push({ chain: c.ids[0], line, width: c.deck!.w, lanes: c.deck!.lanes, twoWay: c.deck!.twoWay });
    }
  }
  return { decks, taken };
}
