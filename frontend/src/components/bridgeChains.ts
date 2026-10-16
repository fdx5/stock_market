import { vworldCentreLines, vworldStructureLinks } from './vworldBuildings';
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

type Link = { id: string; kind: number; rank?: string; line: [number, number][] };
/** One bridge's deck across, the same along its whole chain: `w` the carriageway's width, `lanes`,
 * `off` its centre line's offset to the left of the chain's line (a two-way deck on one direction's
 * link: its middle), `twoWay` both directions on it. */
export type ChainDeck = { w: number; off: number; lanes: number; twoWay: boolean };
/** `core`: the stations (m) the chain's own links span — before and after it, its approaches. */
export type ChainProfile = { ids: string[]; line: [number, number][]; s: number[]; z: number[]; core?: [number, number]; deck?: ChainDeck };
/** A chain in a view frame (metres east/north of the frame's centre; z over its base). */
export type FrameChain = { ids: string[]; line: [number, number][]; s: number[]; z: number[]; core?: [number, number]; deck?: ChainDeck };

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

/** A deck never in the water, never on a road it crosses (pure): the water's surface under a chain
 * is the lowest ground along it (the DEM over a river is its surface; never under the sea's, 0 m) —
 * over it the deck keeps `clear` m; over a road crossing it (`crossings`: stations along the
 * chain) it keeps `overRoad` m over the ground there. From each requirement it eases down at
 * `grade`, and it never rises faster than `grade` from either outer bank: where the banks are
 * scarcely above the water (일산대교) the bank-to-bank line lay on it; where a bridge's links run on
 * over flat ground and the roads there (고덕토평대교 over 강변북로 at 토평), its parapets stood across
 * them at grade. Never lowered. */
export function deckClearance(z: number[], g: number[], step: number, clear = 4, grade = 0.05, crossings: number[] = [], overRoad = 6): number[] {
  const n = z.length;
  if (n < 3) return z.slice();
  const water = Math.max(0, Math.min(...g.slice(1, -1)));
  const total = (n - 1) * step;
  const need = crossings.map(c => { const i = Math.max(0, Math.min(n - 1, Math.round(c / step))); return [i * step, g[i] + overRoad]; });
  return z.map((h, i) => {
    let want = water + clear;
    for (const [sc, zc] of need) want = Math.max(want, zc - grade * Math.abs(i * step - sc));
    return Math.max(h, Math.min(want, z[0] + grade * i * step, z[n - 1] + grade * (total - i * step)));
  });
}

/** The stations along a line (metres, x east y north) where another line crosses it — at 30° or
 * more, away from both its ends and the other line's (a ramp leaving it is no crossing). (pure) */
export function crossingStations(line: [number, number][], others: number[][][], end = 15): number[] {
  const out: number[] = [];
  let acc = 0;
  const total = line.reduce((t, p, i) => i ? t + Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]) : 0, 0);
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey);
    if (!L) continue;
    for (const o of others) for (let k = 1; k < o.length; k++) {
      const c = o[k - 1], d = o[k], fx = d[0] - c[0], fy = d[1] - c[1], M = Math.hypot(fx, fy), den = ex * fy - ey * fx;
      if (!M || Math.abs(den) < Math.sin(Math.PI / 6) * L * M) continue;
      const t = ((c[0] - a[0]) * fy - (c[1] - a[1]) * fx) / den, u = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const sc = acc + t * L;
      let ou = 0; for (let q = 1; q < k; q++) ou += Math.hypot(o[q][0] - o[q - 1][0], o[q][1] - o[q - 1][1]);
      const on = ou + u * M, oTotal = o.reduce((t2, p, q) => q ? t2 + Math.hypot(p[0] - o[q - 1][0], p[1] - o[q - 1][1]) : 0, 0);
      if (sc < end || sc > total - end || on < 3 || on > oTotal - 3) continue;
      out.push(sc);
    }
    acc += L;
  }
  return out.sort((x, y) => x - y);
}

const around = new Map<string, Promise<Link[] | null>>();
/** Every link (any type) within ~1 km of a point, kept by 0.01° cell for the page. */
function linksAround(key: string, domain: string | null | undefined, lon: number, lat: number) {
  const cx = Math.round(lon * 100) / 100, cy = Math.round(lat * 100) / 100, k = `${cx},${cy}`;
  let hit = around.get(k);
  if (!hit) {
    hit = vworldStructureLinks(key, domain, [cx - 0.0135, cy - 0.011, cx + 0.0135, cy + 0.011], true).catch(() => null);
    around.set(k, hit);
    void hit.then(v => { if (!v && around.get(k) === hit) around.delete(k); });
    if (around.size > 64) around.delete(around.keys().next().value!);
  }
  return hit;
}

/** A chain whose end lies short of the bank — on the 둔치, on the water — goes on along the links
 * that continue it (any type: an approach ramp the link register calls a road), up to 600 m, to the
 * first point 2 m over the end's ground: the bank its deck stands on. (동호대교: its bridge links end
 * on the 둔치 by 압구정; the 16 m climb to the embankment is a road link.) No bank in reach: none. */
async function extendToBank(key: string, domain: string | null | undefined, line: [number, number][], atStart: boolean, ids: Set<string>,
  ground: (p: [number, number]) => number, kx: number): Promise<[number, number][]> {
  const out: [number, number][] = [];
  const dist = (a: number[], b: number[]) => Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * KY);
  const dir = (a: number[], b: number[]) => { const x = (b[0] - a[0]) * kx, y = (b[1] - a[1]) * KY, l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  let end = atStart ? line[0] : line[line.length - 1], outward = atStart ? dir(line[1], line[0]) : dir(line[line.length - 2], line[line.length - 1]);
  const g0 = ground(end);
  if (!Number.isFinite(g0)) return [];
  let walked = 0, from: Link | null = null;
  for (let hop = 0; hop < 4 && walked < 600; hop++) {
    const links = await linksAround(key, domain, end[0], end[1]);
    if (!links) break;
    // (outward from the chain: from its far end a link starting there; from its near end one ending there)
    let best: { pts: [number, number][]; score: number; link: Link } | null = null;
    for (const l of links) {
      if (ids.has(l.id) || l === from || l.kind < 0 || l.line.length < 2) continue;
      const pts: [number, number][] = atStart ? [...l.line].reverse() : l.line;
      // Another way in beside the chain's (a ramp met by the road it joins, at grade on the 둔치 —
      // 마포대교's to 강변북로): the deck has come down to that road; nothing carries it further.
      const n = pts.length, inward = dir(pts[n - 2], pts[n - 1]);
      if (dist(pts[n - 1], end) <= 3 && inward[0] * outward[0] + inward[1] * outward[1] > 0.3) return [];
      if (dist(pts[0], end) > 3) continue;
      const d = dir(pts[0], pts[1]), score = d[0] * outward[0] + d[1] * outward[1];
      if (score > 0.3 && (!best || score > best.score)) best = { pts: pts as [number, number][], score, link: l };
    }
    if (!best) break;
    for (let i = 1; i < best.pts.length; i++) {
      const a = best.pts[i - 1], b = best.pts[i], L = dist(a, b), n = Math.max(1, Math.ceil(L / 5));
      for (let k = 1; k <= n; k++) {
        const p: [number, number] = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n], h = ground(p);
        if (!Number.isFinite(h)) return [];
        out.push(p); walked += L / n;
        if (h >= g0 + 2) return atStart ? out.reverse() : out;
        if (walked >= 600) return [];
      }
    }
    end = best.pts[best.pts.length - 1]; outward = dir(best.pts[best.pts.length - 2], end); from = best.link;
  }
  return [];
}

async function profileOf(key: string, domain: string | null | undefined, chain: Link[]): Promise<ChainProfile | null> {
  let line: [number, number][] = [];
  for (const l of chain) for (const p of l.line) { const q = line[line.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) line.push(p); }
  if (line.length < 2) return null;
  const lats = line.map(p => p[1]), lons = line.map(p => p[0]);
  const lat = (Math.min(...lats) + Math.max(...lats)) / 2, lon = (Math.min(...lons) + Math.max(...lons)) / 2, kx = kxAt(lat);
  const span = Math.hypot((Math.max(...lons) - Math.min(...lons)) * kx, (Math.max(...lats) - Math.min(...lats)) * KY) / 2;
  // (the DEM round the chain and 650 m past it, for the approaches; just the chain where that is too wide)
  const sampler = (await vworldSampler(key, lat, lon, span + 650).catch(() => null)) ?? (await vworldSampler(key, lat, lon, span + 40).catch(() => null));
  if (!sampler) return null;
  const ground = (p: [number, number]) => sampler(p[0], p[1]);
  const ids = new Set(chain.map(l => l.id));
  const [head, tail] = await Promise.all([extendToBank(key, domain, line, true, ids, ground, kx), extendToBank(key, domain, line, false, ids, ground, kx)]);
  const own = line.length;
  line = [...head, ...line, ...tail];
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
  const core: [number, number] = [cum[head.length], cum[head.length + own - 1]];
  // (the base map unanswered: no profile — asked again — never a deck of a guessed width)
  const deck = await deckAcross(key, domain, line, cum, core, kx, chain.map(l => l.rank ?? ''));
  if (!deck) return null;
  // The roads it crosses (any link not a bridge's own, at grade or under it: not a deck over it)
  const ids2 = new Set(chain.map(l => l.id)), lon0 = line[0][0], lat0 = line[0][1];
  const M = (p: number[]) => [(p[0] - lon0) * kx, (p[1] - lat0) * KY];
  const asks: Promise<Link[] | null>[] = [];
  for (let d = 0; d <= total + 1; d += 800) { const i = Math.min(line.length - 1, cum.findIndex(c => c >= d)); asks.push(linksAround(key, domain, line[i < 0 ? line.length - 1 : i][0], line[i < 0 ? line.length - 1 : i][1])); }
  const near = await Promise.all(asks);
  if (near.some(v => !v)) return null;
  const others = new Map<string, number[][]>();
  for (const l of near.flat() as Link[]) if (!ids2.has(l.id) && l.kind === 0 && l.line.length > 1) others.set(l.id + ':' + l.line[0].join(','), l.line.map(M));
  // (only on the bridge's own links: a road met on its approach is a junction at grade)
  const crossings = crossingStations(line.map(M) as [number, number][], [...others.values()]).filter(c => c > core[0] && c < core[1]).map(c => c * (s[s.length - 1] / (total || 1)));
  return { ids: chain.map(l => l.id), line, s, z: deckClearance(deckProfile(g, step), g, step, 4, 0.05, crossings), core, deck };
}

/** A bridge's one deck across (pure): from the base map's centre lines along the chain's own span
 * (each within 25 m, running its way, the chain's line on its carriageway), the median width, lanes
 * and offset of them all — every piece of the bridge the same, in the view and in every tile. None
 * along it (a bridge newer than the base map: 월드컵대교, 고덕토평대교): one way on the link itself, its
 * lanes by the road's class — the rule the roads it meets are laid by where the base map has none
 * (roadLinkFallback.ts), so the deck meets them at their width. */
export function deckFromCentreLines(chain: [number, number][], stations: number[], roads: { line: number[][]; width: number; lanes: number }[], ranks: string[] = []): ChainDeck {
  const ws: number[] = [], offs: number[] = [], ls: number[] = [];
  for (const s of stations) {
    let k = 1, acc = 0;
    while (k < chain.length - 1 && acc + Math.hypot(chain[k][0] - chain[k - 1][0], chain[k][1] - chain[k - 1][1]) < s) { acc += Math.hypot(chain[k][0] - chain[k - 1][0], chain[k][1] - chain[k - 1][1]); k++; }
    const a = chain[k - 1], b = chain[k], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L;
    const f = Math.max(0, Math.min(1, (s - acc) / L)), px = a[0] + (b[0] - a[0]) * f, py = a[1] + (b[1] - a[1]) * f;
    let best: { o: number; w: number; lanes: number } | null = null;
    for (const r of roads) for (let i = 1; i < r.line.length; i++) {
      const c = r.line[i - 1], d = r.line[i], ex = d[0] - c[0], ey = d[1] - c[1], l = Math.hypot(ex, ey);
      if (!l || Math.abs(ex * tx + ey * ty) < 0.9 * l) continue;
      const t = ((px - c[0]) * ex + (py - c[1]) * ey) / (l * l);
      if (t < -0.05 || t > 1.05) continue;
      const qx = c[0] + ex * Math.max(0, Math.min(1, t)), qy = c[1] + ey * Math.max(0, Math.min(1, t));
      const o = (qx - px) * -ty + (qy - py) * tx, dist = Math.hypot(qx - px, qy - py);
      if (dist > 25 || Math.abs(o) > r.width / 2 + 2) continue;
      if (!best || Math.abs(o) < Math.abs(best.o)) best = { o, w: r.width, lanes: r.lanes };
    }
    if (best) { ws.push(best.w); offs.push(best.o); ls.push(best.lanes); }
  }
  const median = (v: number[]) => { const q = v.slice().sort((x, y) => x - y); return q[Math.floor(q.length / 2)]; };
  if (ws.length < Math.max(2, stations.length * 0.3)) {
    // (roadLinkFallback.ts's lanes by class; a class unknown, as a bridge's link often is: two)
    const LANES: Record<string, number> = { '고속국도': 3, '도시고속국도': 3, '도시고속도로': 3, '일반국도': 2, '특별·광역시도': 2, '국가지원지방도': 2, '지방도': 1, '시·군도': 1, '구도': 1 };
    const lanes = Math.max(...ranks.map(r => LANES[r] ?? 0), 0) || 2;
    return { w: Math.min(60, lanes * 3.5 + 1), off: 0, lanes, twoWay: false };
  }
  const w = median(ws), off = median(offs);
  return { w, off: Math.round(off * 10) / 10, lanes: Math.max(1, Math.round(median(ls))), twoWay: Math.abs(off) > Math.max(2, w * 0.15) };
}

async function deckAcross(key: string, domain: string | null | undefined, line: [number, number][], cum: number[], core: [number, number], kx: number, ranks: string[]): Promise<ChainDeck | null> {
  const lon0 = line[0][0], lat0 = line[0][1], m = line.map(([x, y]) => [(x - lon0) * kx, (y - lat0) * KY] as [number, number]);
  const own = line.filter((_, i) => cum[i] >= core[0] - 1 && cum[i] <= core[1] + 1);
  const lons = own.map(p => p[0]), lats = own.map(p => p[1]), px = 40 / kx, py = 40 / KY;
  const roads = await vworldCentreLines(key, domain, [Math.min(...lons) - px, Math.min(...lats) - py, Math.max(...lons) + px, Math.max(...lats) + py]).catch(() => null);
  if (!roads) return null;
  const stations: number[] = [];
  for (let s = core[0] + 2.5; s < core[1]; s += 5) stations.push(s);
  return deckFromCentreLines(m, stations, roads.map(r => ({ ...r, line: r.line.map(([x, y]) => [(x - lon0) * kx, (y - lat0) * KY]) })), ranks);
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
      p = profileOf(key, domain, chain);
      // (each of its links answers with the same profile from now on: one deck for every tile)
      for (const c of chain) if (!chainOf.has(c.id)) chainOf.set(c.id, p);
      void p.then(v => { if (!v) for (const c of chain) if (chainOf.get(c.id) === p) chainOf.delete(c.id); });
      if (chainOf.size > 4000) chainOf.delete(chainOf.keys().next().value!);
    }
    profiles.add(p);
  }
  const done = await Promise.all(profiles);
  if (signal?.aborted) return null;
  // (QA: dronedebug pages keep every chain answered, by its first link)
  const qa = (globalThis as { __qaChains?: Map<string, ChainProfile> }).__qaChains;
  if (qa) for (const c of done) if (c) qa.set(c.ids[0], c);
  return done.filter((c): c is ChainProfile => !!c).map(c => {
    const line = c.line.map(([x, y]) => [(x - lon0) * kx, (y - lat0) * KY] as [number, number]);
    let total = 0; for (let i = 1; i < line.length; i++) total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    // (its stations in this frame's metres: the frame's scale differs a little from the chain's own)
    const scale = total / (c.s[c.s.length - 1] || 1);
    return { ids: c.ids, line, s: c.s.map(v => v * scale), z: c.z.map(h => h - base), core: c.core ? [c.core[0] * scale, c.core[1] * scale] as [number, number] : undefined, deck: c.deck };
  });
}
