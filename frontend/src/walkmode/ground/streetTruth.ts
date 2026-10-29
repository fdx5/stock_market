import * as THREE from "three";
import type { World } from "../../drivegame/world/World";
import type { RoadLine } from "../../drivegame/world/tileWorker";

/* The street as surveyed, and nothing standing where it cannot:
 *   RoadIndex — the carriageways (the road links' centre lines and widths) in a 16 m grid, to ask
 *     whether a point is on a road: a lamp, a bollard or anything else placed there is left out;
 *   MappedCrossings — zebra crossings only where they are mapped (OpenStreetMap footway=crossing
 *     ways and marked crossing nodes, through /api/realestate/crossings), laid across the road they
 *     cross, bars 0.45 m wide every 0.9 m, 4 m long, painted only on the carriageway. The drive
 *     world's crossings at every junction end (a guess) are turned off for the walk. */

type Seg = { ax: number; ay: number; bx: number; by: number; hw: number };

export class RoadIndex {
  private cells = new Map<number, Seg[]>();
  private readonly C = 16;
  private key(i: number, j: number) { return (i + 50000) * 100000 + (j + 50000); }
  rebuild(lines: Iterable<RoadLine>) {
    this.cells.clear();
    for (const L of lines) {
      const p = L.pts, hw = L.w / 2;
      for (let k = 0; k + 5 < p.length; k += 3) {
        const s: Seg = { ax: p[k], ay: p[k + 1], bx: p[k + 3], by: p[k + 4], hw };
        const x0 = Math.floor((Math.min(s.ax, s.bx) - hw) / this.C), x1 = Math.floor((Math.max(s.ax, s.bx) + hw) / this.C);
        const y0 = Math.floor((Math.min(s.ay, s.by) - hw) / this.C), y1 = Math.floor((Math.max(s.ay, s.by) + hw) / this.C);
        for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) { const kk = this.key(i, j), l = this.cells.get(kk); if (l) l.push(s); else this.cells.set(kk, [s]); }
      }
    }
  }
  /** the nearest carriageway segment within `within` m of the edge: its direction and how far in */
  nearest(x: number, y: number, within = 0): { s: Seg; d: number; t: number } | null {
    let best: { s: Seg; d: number; t: number } | null = null;
    for (const s of this.cells.get(this.key(Math.floor(x / this.C), Math.floor(y / this.C))) ?? []) {
      const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / l2));
      const d = Math.hypot(s.ax + dx * t - x, s.ay + dy * t - y);
      if (d <= s.hw + within && (!best || d - s.hw < best.d - best.s.hw)) best = { s, d, t };
    }
    return best;
  }
  /** on a carriageway (its edge less `margin` inside: a kerbside lamp stays) */
  on(x: number, y: number, margin = 0.3) { const n = this.nearest(x, y); return !!n && n.d < n.s.hw - margin; }
}

export class MappedCrossings {
  readonly group = new THREE.Group();
  private mat = new THREE.MeshStandardMaterial({ color: "#f2f2ee", roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  private data: { lines: [number, number][][]; points: [number, number][]; reg: { at: [number, number]; width: number; length: number }[] } | null = null;
  private builtAt = { x: Infinity, y: Infinity, roads: -1 };
  private tries = 0; private timer = 0; private dead = false;
  constructor(private world: World, private roads: RoadIndex, private lat: number, private lon: number, private apiBase: string) { this.ask(); }
  /** the crossings: the national register first (전국횡단보도표준데이터, its place, width and length);
   * while the server is still gathering it, asked again in 30 s; where it has none, OpenStreetMap's.
   * Until one answers, none are drawn rather than guessed ones. */
  private ask() {
    if (this.dead || this.tries++ >= 20) return;
    const q = `lat=${this.lat.toFixed(4)}&lon=${this.lon.toFixed(4)}&r=1500`;
    const again = () => { this.timer = window.setTimeout(() => this.ask(), 30000); };
    fetch(`${this.apiBase}/realestate/crosswalks?${q}`).then(r => r.ok ? r.json() : null).then(d => {
      if (d?.status === "available" && d.items?.length) {
        this.data = { lines: [], points: [], reg: d.items.map((c: { at: [number, number]; width: number; length: number }) => ({ at: c.at, width: c.width, length: c.length })) };
        this.builtAt.roads = -1; return;
      }
      if (d?.status === "loading") { again(); return; }
      return fetch(`${this.apiBase}/realestate/crossings?${q}&v=3`).then(r => r.ok ? r.json() : null).then(o => {
        if (!o?.source) { again(); return; }
        this.data = { lines: (o.crossings ?? []).map((c: { line: [number, number][] }) => c.line), points: (o.points ?? []).filter((p: { marked: boolean }) => p.marked).map((p: { at: [number, number] }) => p.at), reg: [] };
        this.builtAt.roads = -1;
      });
    }).catch(again);
  }
  /** laid again round the walker when they have gone 120 m or the roads have changed */
  update(x: number, y: number, roadCount: number) {
    if (!this.data) return;
    if (Math.hypot(x - this.builtAt.x, y - this.builtAt.y) < 120 && roadCount === this.builtAt.roads) return;
    this.builtAt = { x, y, roads: roadCount };
    const pos: number[] = [], idx: number[] = [];
    const bar = (cx: number, cy: number, ux: number, uy: number, len: number, wid: number) => {
      const z = this.world.surfaceAt(cx, cy); if (!Number.isFinite(z)) return;
      const vx = -uy, vy = ux, b = pos.length / 3;
      for (const [a, c] of [[-wid / 2, -len / 2], [wid / 2, -len / 2], [wid / 2, len / 2], [-wid / 2, len / 2]]) pos.push(cx + ux * a + vx * c, z + 0.07, -(cy + uy * a + vy * c));
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    };
    // a crossing's path from p to q (its direction u), bars across it every 0.9 m where it is on the road
    const lay = (px: number, py: number, qx: number, qy: number) => {
      const len = Math.hypot(qx - px, qy - py); if (len < 2 || len > 60) return;
      const ux = (qx - px) / len, uy = (qy - py) / len;
      for (let t = 0.45; t < len; t += 0.9) { const cx = px + ux * t, cy = py + uy * t; if (this.roads.on(cx, cy, 0.25)) bar(cx, cy, ux, uy, 4.0, 0.45); }
    };
    for (const line of this.data.lines) {
      if (!line.some(([lx, ly]) => Math.hypot(lx - x, ly - y) < 360)) continue;
      for (let k = 0; k + 1 < line.length; k++) lay(line[k][0], line[k][1], line[k + 1][0], line[k + 1][1]);
    }
    // (a registered crossing: across the road at its place, as long as registered (or kerb to kerb),
    // its bars as long as its registered width)
    for (const c of this.data.reg) {
      const [px, py] = c.at; if (Math.hypot(px - x, py - y) > 360) continue;
      const n = this.roads.nearest(px, py, 4); if (!n) continue;
      const s = n.s, l = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1, ox = -(s.by - s.ay) / l, oy = (s.bx - s.ax) / l;
      const cx = s.ax + (s.bx - s.ax) * n.t, cy = s.ay + (s.by - s.ay) * n.t, half = Math.min(25, Math.max(s.hw, (c.length || 0) / 2));
      const wid = Math.min(8, Math.max(3, c.width || 4));
      const len = Math.hypot(2 * half, 0), ux = ox, uy = oy, px0 = cx - ox * half, py0 = cy - oy * half;
      for (let t = 0.45; t < len; t += 0.9) { const bx = px0 + ux * t, by = py0 + uy * t; if (this.roads.on(bx, by, 0.25)) bar(bx, by, ux, uy, wid, 0.45); }
    }
    for (const [px, py] of this.data.points) {
      if (Math.hypot(px - x, py - y) > 360) continue;
      // (a crossing node: across the road it lies on, from kerb to kerb)
      const n = this.roads.nearest(px, py, 2); if (!n) continue;
      const s = n.s, l = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1, rx = (s.bx - s.ax) / l, ry = (s.by - s.ay) / l, ox = -ry, oy = rx;
      const cx = s.ax + (s.bx - s.ax) * n.t, cy = s.ay + (s.by - s.ay) * n.t;
      lay(cx - ox * s.hw, cy - oy * s.hw, cx + ox * s.hw, cy + oy * s.hw);
    }
    for (const c of [...this.group.children]) { (c as THREE.Mesh).geometry.dispose(); this.group.remove(c); }
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.mat); m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
    this.group.add(m);
  }
  dispose() { this.dead = true; clearTimeout(this.timer); for (const c of this.group.children) (c as THREE.Mesh).geometry.dispose(); this.mat.dispose(); this.group.removeFromParent(); }
}
