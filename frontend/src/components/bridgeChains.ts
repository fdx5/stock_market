import { vworldStructureLinks } from './vworldBuildings';
import { vworldSampler } from './sceneTerrain';

/* A bridge's deck height, bank to bank, from the official links and the national DEM.
 *
 * The standard node-link splits a long river bridge into several 교량 links that end in mid
 * river or on an island (한강대교: 노들섬). Interpolating each link between the ground under its
 * own two ends put the deck on the water there. Here the bridge links (교량; a 고가도로 keeps its
 * own link's profile: a long viaduct follows the ground) that continue one another — end to start,
 * within 3 m, the same way, each the other's best continuation — are joined into one chain, and the chain's deck is the upper envelope of the
 * bare ground (DEM, DTM) along it between the ground at its two outer ends: straight from bank
 * to bank over the water, at grade where it crosses higher ground (an island), never under the
 * ground, softened over ±25 m. No height is invented: every height comes from the ground at a
 * point of the chain; no surveyed deck Z exists in this feed.
 *
 * One profile per chain for the page's lifetime (absolute metres), shared by the view and every
 * drone tile, so tiles meet without a step. */

type Link = { id: string; kind: 1 | 2; line: [number, number][] };
export type ChainProfile = { ids: string[]; line: [number, number][]; s: number[]; z: number[] };
/** A chain in a view frame (metres east/north of the frame's centre; z over its base). */
export type FrameChain = { ids: string[]; line: [number, number][]; s: number[]; z: number[] };

const CELL = 0.02;
const cells = new Map<string, Promise<Link[] | null>>();
const chainOf = new Map<string, Promise<ChainProfile | null>>();
const KY = 110540;
const kxAt = (lat: number) => Math.cos((lat * Math.PI) / 180) * 111320;

function cellLinks(key: string, domain: string | null | undefined, i: number, j: number) {
  const k = `${i},${j}`;
  let hit = cells.get(k);
  if (!hit) {
    hit = vworldStructureLinks(key, domain, [i * CELL, j * CELL, (i + 1) * CELL, (j + 1) * CELL]).catch(() => null);
    cells.set(k, hit);
    void hit.then(v => { if (!v && cells.get(k) === hit) cells.delete(k); });
    if (cells.size > 96) cells.delete(cells.keys().next().value!);
  }
  return hit;
}

/** Joins links that continue one another into chains (pure; lon/lat or metres alike: `m` is
 * the metres per unit along x and y). Returns, per chain, its links in driving order. */
export function joinStructureLinks(links: Link[], m: [number, number] = [1, 1], tol = 3): Link[][] {
  const dist = (a: number[], b: number[]) => Math.hypot((a[0] - b[0]) * m[0], (a[1] - b[1]) * m[1]);
  const dir = (a: number[], b: number[]) => { const x = (b[0] - a[0]) * m[0], y = (b[1] - a[1]) * m[1], l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  const outDir = (l: Link) => dir(l.line[l.line.length - 2], l.line[l.line.length - 1]);
  const inDir = (l: Link) => dir(l.line[0], l.line[1]);
  const best = (from: Link, list: Link[], score: (o: Link) => number) => {
    let b: Link | null = null, bs = 0.3;
    for (const o of list) { if (o === from) continue; const s = score(o); if (s > bs) { bs = s; b = o; } }
    return b;
  };
  const near = (p: number[], ends: (l: Link) => number[]) => links.filter(o => dist(ends(o), p) <= tol);
  const next = new Map<Link, Link>(), prev = new Map<Link, Link>();
  for (const l of links) {
    const e = l.line[l.line.length - 1], d = outDir(l);
    const n = best(l, near(e, o => o.line[0]), o => { const q = inDir(o); return d[0] * q[0] + d[1] * q[1]; });
    if (!n) continue;
    // mutual: n's best predecessor is l
    const s = n.line[0], q = inDir(n);
    const p = best(n, near(s, o => o.line[o.line.length - 1]), o => { const r = outDir(o); return r[0] * q[0] + r[1] * q[1]; });
    if (p === l) { next.set(l, n); prev.set(n, l); }
  }
  const out: Link[][] = [], seen = new Set<Link>();
  for (const l of links) {
    if (seen.has(l)) continue;
    let head = l; const guard = new Set<Link>([l]);
    while (prev.has(head) && !guard.has(prev.get(head)!)) { head = prev.get(head)!; guard.add(head); }
    const chain: Link[] = [];
    for (let c: Link | undefined = head; c && !seen.has(c); c = next.get(c)) { seen.add(c); chain.push(c); }
    out.push(chain);
  }
  return out;
}

/** The deck heights along a chain from the ground under it (pure): the upper envelope of the
 * ground samples, eased over ±ease m, never under the ground. `g` holds the ground every
 * `step` m from the chain's start (its two ends the outer banks). */
export function deckProfile(g: number[], step: number, ease = 25): number[] {
  const n = g.length;
  if (n < 2) return g.slice();
  // (a single post out of line — a DEM spike — never lifts a deck: the median of three)
  const m = g.map((v, i) => i === 0 || i === n - 1 ? v : [g[i - 1], v, g[i + 1]].sort((a, b) => a - b)[1]);
  // upper hull (monotone chain over increasing s)
  const hull: number[] = [];
  const cross = (o: number, a: number, b: number) => (a - o) * (m[b] - m[o]) - (m[a] - m[o]) * (b - o);
  for (let i = 0; i < n; i++) { while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], i) >= 0) hull.pop(); hull.push(i); }
  const H = new Array<number>(n);
  for (let k = 1; k < hull.length; k++) { const a = hull[k - 1], b = hull[k]; for (let i = a; i <= b; i++) H[i] = m[a] + (m[b] - m[a]) * (i - a) / ((b - a) || 1); }
  const w = Math.max(1, Math.round(ease / step)), out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, c = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(n - 1, i + w); k++) { sum += H[k]; c++; }
    out[i] = Math.max(m[i], i === 0 || i === n - 1 ? H[i] : sum / c);
  }
  return out;
}

async function profileOf(key: string, chain: Link[]): Promise<ChainProfile | null> {
  const line: [number, number][] = [];
  for (const l of chain) for (const p of l.line) { const q = line[line.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) line.push(p); }
  if (line.length < 2) return null;
  const lats = line.map(p => p[1]), lons = line.map(p => p[0]);
  const lat = (Math.min(...lats) + Math.max(...lats)) / 2, lon = (Math.min(...lons) + Math.max(...lons)) / 2, kx = kxAt(lat);
  const radius = Math.hypot((Math.max(...lons) - Math.min(...lons)) * kx, (Math.max(...lats) - Math.min(...lats)) * KY) / 2 + 40;
  const sampler = await vworldSampler(key, lat, lon, radius).catch(() => null);
  if (!sampler) return null;
  const step = 5, cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot((line[i][0] - line[i - 1][0]) * kx, (line[i][1] - line[i - 1][1]) * KY));
  const total = cum[cum.length - 1], s: number[] = [], g: number[] = [];
  for (let d = 0, k = 1; ; d = Math.min(total, d + step)) {
    while (k < cum.length - 1 && cum[k] < d) k++;
    const f = (d - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1);
    const p = [line[k - 1][0] + (line[k][0] - line[k - 1][0]) * f, line[k - 1][1] + (line[k][1] - line[k - 1][1]) * f];
    const h = sampler(p[0], p[1]);
    if (!Number.isFinite(h)) return null;
    s.push(d); g.push(h);
    if (d >= total) break;
  }
  return { ids: chain.map(l => l.id), line, s, z: deckProfile(g, step) };
}

/** The chains of the raised links meeting a view-frame box (and their profiles), in that frame:
 * heights over `base` (the frame centre's absolute DEM height). Links are asked ±2 km round it,
 * so a chain is whole bank to bank. Null if VWorld or the DEM does not answer. */
export async function structureChains(key: string, domain: string | null | undefined, lat0: number, lon0: number, base: number,
  box: [number, number, number, number], signal?: AbortSignal): Promise<FrameChain[] | null> {
  const kx = kxAt(lat0), M = 2000;
  const i0 = Math.floor((lon0 + (box[0] - M) / kx) / CELL), i1 = Math.floor((lon0 + (box[2] + M) / kx) / CELL);
  const j0 = Math.floor((lat0 + (box[1] - M) / KY) / CELL), j1 = Math.floor((lat0 + (box[3] + M) / KY) / CELL);
  const asks: Promise<Link[] | null>[] = [];
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) asks.push(cellLinks(key, domain, i, j));
  const got = await Promise.all(asks);
  if (signal?.aborted || got.some(v => !v)) return null;
  const uniq = new Map<string, Link>();
  for (const l of got.flat() as Link[]) uniq.set(l.id + ':' + l.line[0].join(','), l);
  const all = [...uniq.values()];
  // the links reaching the box (their whole chain is wanted)
  const x0 = lon0 + (box[0] - 30) / kx, x1 = lon0 + (box[2] + 30) / kx, y0 = lat0 + (box[1] - 30) / KY, y1 = lat0 + (box[3] + 30) / KY;
  const wanted = all.filter(l => l.line.some(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1) ||
    l.line.some((p, i) => i > 0 && Math.max(p[0], l.line[i - 1][0]) >= x0 && Math.min(p[0], l.line[i - 1][0]) <= x1 && Math.max(p[1], l.line[i - 1][1]) >= y0 && Math.min(p[1], l.line[i - 1][1]) <= y1));
  if (!wanted.length) return [];
  const chains = joinStructureLinks(all, [kx, KY]);
  const byLink = new Map<Link, Link[]>();
  for (const c of chains) for (const l of c) byLink.set(l, c);
  const profiles = new Set<Promise<ChainProfile | null>>();
  for (const l of wanted) {
    let p = chainOf.get(l.id);
    if (!p) {
      const chain = byLink.get(l)!;
      p = profileOf(key, chain);
      // (each of its links answers with the same profile from now on: one deck for every tile)
      for (const c of chain) if (!chainOf.has(c.id)) chainOf.set(c.id, p);
      void p.then(v => { if (!v) for (const c of chain) if (chainOf.get(c.id) === p) chainOf.delete(c.id); });
      if (chainOf.size > 4000) chainOf.delete(chainOf.keys().next().value!);
    }
    profiles.add(p);
  }
  const done = await Promise.all(profiles);
  if (signal?.aborted) return null;
  return done.filter((c): c is ChainProfile => !!c).map(c => {
    const line = c.line.map(([x, y]) => [(x - lon0) * kx, (y - lat0) * KY] as [number, number]);
    let total = 0; for (let i = 1; i < line.length; i++) total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    // (its stations in this frame's metres: the frame's scale differs a little from the chain's own)
    const scale = total / (c.s[c.s.length - 1] || 1);
    return { ids: c.ids, line, s: c.s.map(v => v * scale), z: c.z.map(h => h - base) };
  });
}
