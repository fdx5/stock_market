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
  approaches: {line:number[][]}[] = [],
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
    // Directional links share a surveyed carriageway even when their bank
    // extensions finish at different nodes. Compare the actual bridge core,
    // in both directions, rather than rejecting it on those approach endpoints.
    if (c.core && o.core) {
      let hits = 0;const differences:number[]=[];
      for (const [a, b] of [[c, o], [o, c]]) {
        const core = a.core!;
        for (let k = 0; k < 10; k++) {
          const station = core[0] + (core[1] - core[0]) * ((k + .5) / 10);
          const point = at(a, station, a.deck!.off), p = along(b, point[0], point[1]);
          const ap = along(a, point[0], point[1]);
          if (ap.tx * p.tx + ap.ty * p.ty > -.9) return false;
          const az = height(a, station), bz = height(b, p.s);
          if (az!==null&&bz!==null)differences.push(Math.abs(az-bz));
          if (distance(point, at(b, p.s, b.deck!.off)) <= 3) hits++;
        }
      }
      differences.sort((a,b)=>a-b);
      // Profiles are DEM bank estimates, not measured deck elevations. A few
      // differing bank samples must not create overlapping opposite slabs.
      // Consistently separated storeys still remain independent.
      return hits >= 18 && (!differences.length || differences[Math.floor(differences.length/2)]<1.5&&differences[differences.length-1]<4.5);
    }
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
    {
      for (const o of byKey.values()) {
        if (o === c) continue;
        const oq=cum(o),hq=cum(h),ol=oq[oq.length-1],hl=hq[hq.length-1];
        if(ol<hl-3||Math.abs(ol-hl)<=3&&o.ids[0]>=h.ids[0])continue;
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
    const q = cum(c), total = q[q.length - 1], a = 0, b = total;
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
      const knots=[s0,...q.filter(s=>s>s0+.5&&s<s1-.5),s1];
      if(approaches.length){const band=Math.min(90,(s1-s0)/4);for(const f of [.25,.5,.75,1])knots.push(s0+band*f,s1-band*f);}
      knots.sort((a,b)=>a-b);
      const line:number[][]=knots.filter((s,i)=>!i||s-knots[i-1]>1e-6).map(s=>at(c,s,c.deck!.off));
      // Meet a surveyed bank endpoint exactly. Only an outward continuation
      // within one lane is eligible; nearby parallel roads and XY crossings
      // cannot pull the bridge sideways or create an intersection.
      for (const begin of [true, false]) {
        const k = begin ? 0 : line.length - 1, p = line[k], inside = line[begin ? 1 : k - 1];
        const dx = inside[0] - p[0], dy = inside[1] - p[1], length = Math.hypot(dx, dy);
        let best = 22, endpoint:number[]|undefined;
        for (const road of approaches) for (let j=1;j<road.line.length;j++) {
          const a=road.line[j-1],b=road.line[j],ex=b[0]-a[0],ey=b[1]-a[1],l=Math.hypot(ex,ey);
          if (!l || Math.abs(dx*ex+dy*ey)/(length*l||1)<.9) continue;
          const t=Math.max(0,Math.min(1,((p[0]-a[0])*ex+(p[1]-a[1])*ey)/(l*l)));
          // The approach must actually continue beyond the bank, not end below
          // the bridge's interior. The bank can be inside an unsplit source road.
          const outward=(q:number[])=>(q[0]-p[0])*dx+(q[1]-p[1])*dy;
          if(Math.min(outward(a),outward(b))>=-.5*length)continue;
          const point=[a[0]+ex*t,a[1]+ey*t],d=Math.hypot(point[0]-p[0],point[1]-p[1]);
          const lateral=Math.abs((point[0]-p[0])*dy-(point[1]-p[1])*dx)/(length||1);
          if(lateral>Math.min(10,Math.max(4,c.deck!.w/2)))continue;
          if(d<best){best=d;endpoint=point;}
        }
        if (endpoint) {
          const ex=endpoint[0]-p[0],ey=endpoint[1]-p[1],band=Math.min(90,(s1-s0)/4);
          let walked=0,previous=[...p];
          for(let j=k;j>=0&&j<line.length;j+=begin?1:-1){
            const point=[...line[j]];if(j!==k)walked+=Math.hypot(point[0]-previous[0],point[1]-previous[1]);previous=point;
            if(walked>=band)break;
            const u=walked/(band||1),blend=1-3*u*u+2*u*u*u;
            line[j]=[point[0]+ex*blend,point[1]+ey*blend];
          }
        }
      }
      const shared = [...byKey.values()].some(o => o !== c && sameDeck(c, o));
      const separated=[...byKey.values()].some(o=>{
        if(o===c||!c.core||!o.core)return false;
        let hits=0;const edge=(c.deck!.w+o.deck!.w)/2;
        for(const f of [.1,.3,.5,.7,.9]){
          const point=at(c,c.core[0]+(c.core[1]-c.core[0])*f,c.deck!.off),p=along(o,point[0],point[1]),a=along(c,point[0],point[1]);
          const d=Math.hypot(point[0]-at(o,p.s,o.deck!.off)[0],point[1]-at(o,p.s,o.deck!.off)[1]);
          if(a.tx*p.tx+a.ty*p.ty<-.9&&d>=edge-.5&&d<=edge+12)hits++;
        }return hits>=3;
      });
      decks.push({ chain: c.ids[0], line, width: c.deck!.w, lanes: c.deck!.lanes,
        twoWay: shared || c.deck!.twoWay&&!separated });
    }
  }
  return { decks, taken };
}
