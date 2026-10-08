import * as THREE from "three";
import type { DroneLabel } from "./ringBuildings";

/* The drone's signs (드론 mode): the apartment complexes, public offices, schools, hospitals and
 * tall named buildings of the tiles round it (ringBuildings: from the building register's names
 * and uses), drawn on one canvas over the view — as the view draws its 단지 팻말 — each frame
 * for the drone's camera. Public offices first, then tall buildings, complexes and hospitals,
 * then schools, nearer before farther; a sign that would cover one already placed is left out.
 * They thin out with the haze toward the edge of the loaded world. */

const STYLE: Record<DroneLabel["kind"], { bg: string; fg: string; edge: string; icon: string; rank: number; reach: number }> = {
  gov: { bg: "rgba(18,74,140,0.92)", fg: "#ffffff", edge: "#7fb6ff", icon: "🏛", rank: 5, reach: 2600 },
  major: { bg: "rgba(24,28,36,0.88)", fg: "#ffffff", edge: "#c9d3df", icon: "🏢", rank: 4, reach: 2600 },
  apt: { bg: "rgba(10,34,58,0.86)", fg: "#ffe7a8", edge: "#ffcf5c", icon: "", rank: 3, reach: 1900 },
  hospital: { bg: "rgba(150,24,36,0.9)", fg: "#ffffff", edge: "#ff9aa5", icon: "✚", rank: 3, reach: 1700 },
  school: { bg: "rgba(20,96,58,0.88)", fg: "#ffffff", edge: "#8fe0b0", icon: "🎓", rank: 2, reach: 1400 },
};

type Sign = { key: string; name: string; kind: DroneLabel["kind"]; x: number; y: number; top: number; n: number; w: number };

export class DroneSigns {
  private byTile = new Map<string, DroneLabel[]>();
  private merged: Sign[] = [];
  private dirty = false;
  private mergedAt = 0;
  private widths = new Map<string, number>();
  private v = new THREE.Vector3();
  canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private size = [0, 0, 0];

  set(tile: string, labels: DroneLabel[] | null) {
    if (labels?.length) this.byTile.set(tile, labels); else if (!this.byTile.delete(tile)) return;
    this.dirty = true;
  }

  /** One sign per complex or building: the same name and kind from neighbouring tiles (a complex
   * across a tile edge) within 600 m are one, at their buildings' weighted centre. */
  private merge() {
    const groups = new Map<string, Sign[]>();
    for (const list of this.byTile.values()) for (const l of list) {
      const k = l.kind + ":" + l.name, near = groups.get(k)?.find(s => Math.hypot(s.x - l.x, s.y - l.y) < 600);
      if (near) { near.x = (near.x * near.n + l.x * l.n) / (near.n + l.n); near.y = (near.y * near.n + l.y * l.n) / (near.n + l.n); near.top = Math.max(near.top, l.top); near.n += l.n; }
      else groups.set(k, [...(groups.get(k) ?? []), { key: k, name: l.name, kind: l.kind, x: l.x, y: l.y, top: l.top, n: l.n, w: 0 }]);
    }
    this.merged = [...groups.values()].flat();
    this.dirty = false;
  }

  /** Draw for this frame's camera (w × h CSS pixels); `fade`: where the haze starts and ends (m). */
  draw(camera: THREE.PerspectiveCamera, w: number, h: number, fade: [number, number]) {
    const cv = this.canvas;
    if (!cv) return;
    if (!this.ctx) this.ctx = cv.getContext("2d");
    const ctx = this.ctx;
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.size[0] !== w || this.size[1] !== h || this.size[2] !== dpr) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      this.size = [w, h, dpr];
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // (gathered again at most twice a second: tiles arrive in bursts)
    if (this.dirty && performance.now() - this.mergedAt > 500) { this.merge(); this.mergedAt = performance.now(); }
    const cam = camera.position;
    const seen: [number, Sign, number, number, number][] = [];
    for (const s of this.merged) {
      const st = STYLE[s.kind];
      const d = Math.hypot(s.x - cam.x, -s.y - cam.z);
      if (d > Math.min(st.reach, fade[1] * 0.92)) continue;
      this.v.set(s.x, s.top + 4, -s.y).project(camera);
      if (this.v.z > 1 || this.v.z < -1 || Math.abs(this.v.x) > 1.1 || Math.abs(this.v.y) > 1.1) continue;
      seen.push([d, s, (this.v.x * 0.5 + 0.5) * w, (0.5 - this.v.y * 0.5) * h, d]);
    }
    // the most important and nearest first
    seen.sort((a, b) => STYLE[b[1].kind].rank - STYLE[a[1].kind].rank || a[0] - b[0]);
    const placed: [number, number, number, number][] = [];
    let drawn = 0;
    for (const [d, s, sx, sy] of seen) {
      if (drawn >= 60) break;
      const st = STYLE[s.kind];
      const k = 1 - THREE.MathUtils.smoothstep(d, 250, 2200);
      const font = Math.round(10 + 3 * k);
      const label = st.icon ? `${st.icon} ${s.name}` : s.name;
      const wkey = font + "|" + label;
      let tw = this.widths.get(wkey);
      if (tw === undefined) { ctx.font = `700 ${font}px system-ui, sans-serif`; tw = ctx.measureText(label).width; this.widths.set(wkey, tw); }
      const bw = tw + 14, bh = font + 9, stem = 10 + 8 * k;
      const x0 = sx - bw / 2, y0 = sy - stem - bh;
      if (x0 < -bw || x0 > w || y0 < -bh || sy > h + 4) continue;
      if (placed.some(([px, py, pw, ph]) => x0 < px + pw + 3 && x0 + bw + 3 > px && y0 < py + ph + 3 && y0 + bh + 3 > py)) continue;
      placed.push([x0, y0, bw, bh]);
      drawn++;
      // (fading into the haze with the ground under it)
      ctx.globalAlpha = 1 - 0.85 * THREE.MathUtils.smoothstep(d, fade[0], fade[1] * 0.92);
      ctx.strokeStyle = st.edge; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, y0 + bh); ctx.stroke();
      ctx.fillStyle = st.edge; ctx.beginPath(); ctx.arc(sx, sy, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = st.bg;
      ctx.beginPath(); ctx.roundRect(x0, y0, bw, bh, bh / 2); ctx.fill();
      ctx.strokeStyle = st.edge; ctx.lineWidth = 1; ctx.stroke();
      ctx.font = `700 ${font}px system-ui, sans-serif`; ctx.fillStyle = st.fg; ctx.textBaseline = "middle"; ctx.textAlign = "center";
      ctx.fillText(label, sx, y0 + bh / 2 + 0.5);
    }
    ctx.globalAlpha = 1;
    if (this.widths.size > 4000) this.widths.clear();
  }

  /** Every sign now known (for the radar). */
  all(): readonly Sign[] { if (this.dirty) this.merge(); return this.merged; }
}
