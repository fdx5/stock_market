import * as THREE from "three";
import type { DroneLabel, DroneLabelInfo } from "./ringBuildings";

/* The drone's signs (드론 mode): the apartment complexes, public offices, schools, hospitals and
 * tall named buildings of the tiles round it (ringBuildings: from the building register's names
 * and uses), drawn on one canvas over the view — as the view draws its 단지 팻말 — each frame
 * for the drone's camera. Public offices first, then tall buildings, complexes and hospitals,
 * then schools, nearer before farther; a sign that would cover one already placed is left out.
 * They thin out with the haze toward the edge of the loaded world.
 * A sign with a card to show (its register parcel, or a name to look up) glows softly in its own
 * colour, breathing, and a tap on it opens the card (DroneBuildingCard): `hit` finds it. */

const STYLE: Record<DroneLabel["kind"], { bg: string; fg: string; edge: string; icon: string; rank: number; reach: number }> = {
  gov: { bg: "rgba(18,74,140,0.92)", fg: "#ffffff", edge: "#7fb6ff", icon: "🏛", rank: 5, reach: 2600 },
  major: { bg: "rgba(24,28,36,0.88)", fg: "#ffffff", edge: "#c9d3df", icon: "🏢", rank: 4, reach: 2600 },
  commercial: { bg: 'rgba(78,43,12,0.93)', fg: '#fff5de', edge: '#ffc66e', icon: '🛍', rank: 5, reach: 2400 },
  market: { bg: 'rgba(120,44,20,0.93)', fg: '#fff5de', edge: '#ffad76', icon: '🏮', rank: 5, reach: 2200 },
  district: { bg: 'rgba(74,32,88,0.93)', fg: '#ffffff', edge: '#dfadff', icon: '📍', rank: 5, reach: 2400 },
  apt: { bg: "rgba(10,34,58,0.86)", fg: "#ffe7a8", edge: "#ffcf5c", icon: "", rank: 3, reach: 1900 },
  hospital: { bg: "rgba(150,24,36,0.9)", fg: "#ffffff", edge: "#ff9aa5", icon: "✚", rank: 3, reach: 1700 },
  school: { bg: "rgba(20,96,58,0.88)", fg: "#ffffff", edge: "#8fe0b0", icon: "🎓", rank: 2, reach: 1400 },
  station: { bg: "rgba(8,68,92,0.92)", fg: "#ffffff", edge: "#86e5f2", icon: "🚉", rank: 4, reach: 1900 },
  bridge: { bg: "rgba(8,54,78,0.94)", fg: "#ffffff", edge: "#75e0f5", icon: "🌉", rank: 6, reach: 2800 },
  cctv: { bg: 'rgba(17,65,63,0.94)', fg:'#ffffff',edge:'#79f3ce',icon:'📹 CCTV',rank:3,reach:1300 },
  // the live public layers (droneLive.ts): each sign's edge in its own state's colour (tint)
  er: { bg: 'rgba(120,10,24,0.94)', fg: '#ffffff', edge: '#ff8a96', icon: '🚑', rank: 7, reach: 4000 },
  subway: { bg: 'rgba(10,30,60,0.94)', fg: '#ffffff', edge: '#86e5f2', icon: '🚇', rank: 5, reach: 2600 },
  train: { bg: 'rgba(8,20,36,0.92)', fg: '#ffffff', edge: '#9cd', icon: '🚆', rank: 4, reach: 2200 },
  parking: { bg: 'rgba(14,40,92,0.92)', fg: '#ffffff', edge: '#7fb6ff', icon: '🅿️', rank: 2, reach: 1400 },
  bike: { bg: 'rgba(14,62,40,0.92)', fg: '#ffffff', edge: '#8fe0b0', icon: '🚲', rank: 1, reach: 700 },
  // public facilities (소방서, 경찰, 보건소, 우체국, AED, 대피소): the icon is in the name
  exit: { bg: 'rgba(40,34,6,0.92)', fg: '#ffe680', edge: '#f2c200', icon: '🚇', rank: 2, reach: 900 },
  service: { bg: 'rgba(30,30,44,0.92)', fg: '#ffffff', edge: '#c9d3df', icon: '', rank: 3, reach: 1500 },
};

export type Sign = { key: string; name: string; kind: DroneLabel["kind"]; x: number; y: number; top: number; n: number; w: number; info?: DroneLabelInfo; camera?:import('./trafficCctv').TrafficCamera; live?: DroneLabel["live"]; tint?: string };

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
  /** where each sign was drawn this frame (CSS px), for taps */
  private boxes: { x: number; y: number; w: number; h: number; sx: number; sy: number; s: Sign }[] = [];
  /** the sign whose card is open (drawn lit) */
  selected: string | null = null;
  /** no glow (?signfx=0) */
  private fx = typeof location === "undefined" || !location.search.includes("signfx=0");

  /** The sign under (x, y) (CSS px over the view), the pill or its stem, with a little slack for a
   * finger; the nearest of several. */
  hit(x: number, y: number, slack = 10): Sign | null {
    let best: Sign | null = null, bd = Infinity;
    for (const b of this.boxes) {
      const inPill = x > b.x - slack && x < b.x + b.w + slack && y > b.y - slack && y < b.y + b.h + slack;
      const inStem = Math.abs(x - b.sx) < slack + 4 && y > b.y + b.h && y < b.sy + slack;
      if (!inPill && !inStem) continue;
      const d = Math.hypot(x - (b.x + b.w / 2), y - (b.y + b.h / 2));
      if (d < bd) { bd = d; best = b.s; }
    }
    return best;
  }
  /** Whether a sign has a card to open. */
  static hasCard(s: Sign) { return !!s.live || (s.kind !== 'station' && s.kind !== 'bridge' && s.name.length >= 2); }

  /** every label of a kind now held (the complexes' names, for their bicycles) */
  labelsOfKind(kind: DroneLabel["kind"]): DroneLabel[] { const out: DroneLabel[] = []; for (const l of this.byTile.values()) for (const x of l) if (x.kind === kind) out.push(x); return out; }
  set(tile: string, labels: DroneLabel[] | null) {
    if (labels?.length) this.byTile.set(tile, labels); else if (!this.byTile.delete(tile)) return;
    this.dirty = true;
  }

  /** One sign per complex or building: the same name and kind from neighbouring tiles (a complex
   * across a tile edge) within 600 m are one, at their buildings' weighted centre. */
  private merge() {
    const groups = new Map<string, Sign[]>();
    for (const list of this.byTile.values()) for (const l of list) {
      const k = l.key ?? (l.kind + ":" + (l.camera?.id??l.name)), near = l.key ? undefined : groups.get(k)?.find(s => Math.hypot(s.x - l.x, s.y - l.y) < 600);
      if (near) { near.x = (near.x * near.n + l.x * l.n) / (near.n + l.n); near.y = (near.y * near.n + l.y * l.n) / (near.n + l.n); near.top = Math.max(near.top, l.top); near.info = { ...near.info, ...l.info, complexId: near.info?.complexId ?? l.info?.complexId, pnu: near.info?.pnu ?? l.info?.pnu }; near.n += l.n; }
      else { const sign = { key: k, name: l.name, kind: l.kind, x: l.x, y: l.y, top: l.top, n: l.n, w: 0, info: l.info, camera:l.camera, live: l.live, tint: l.tint }, list = groups.get(k); if (list) list.push(sign); else groups.set(k, [sign]); }
    }
    this.merged = [...groups.values()].flat();
    // A provider building name and a mapped facility describe the same sign.
    // Keep the mapped place's stable identity and business info, the register's
    // PNU/height, and never merge two separate mapped branches together.
    const hidden=new Set<Sign>(),normal=(s:string)=>s.replace(/[\s()（）]/g,'').toLowerCase();
    for(const p of this.merged.filter(s=>s.info?.place))for(const b of this.merged){
      if(b.info?.place||hidden.has(b)||p.kind!==b.kind||Math.hypot(p.x-b.x,p.y-b.y)>160)continue;
      const a=normal(p.name),n=normal(b.name);
      const brand=(s:string)=>s.match(/스타필드|신세계|홈플러스|코스트코|롯데마트|이마트|트레이더스/)?.[0];
      if(a!==n&&!(Math.min(a.length,n.length)>=4&&(a.includes(n)||n.includes(a)))&&!(brand(a)&&brand(a)===brand(n)))continue;
      p.top=Math.max(p.top,b.top);p.info={...b.info,...p.info,pnu:b.info?.pnu??p.info?.pnu};hidden.add(b);
    }
    this.merged=this.merged.filter(s=>!hidden.has(s));
    this.dirty = false;
  }

  /** Draw for this frame's camera (w × h CSS pixels); `fade`: where the haze starts and ends (m). */
  /** A phone's drone: the labels drawn every other frame, at 1.5x. Their canvas covers the screen —
   * redrawn, rasterised and sent to the compositor each frame at the phone's 2x it was a third of
   * the page's work there; the 3D under them is drawn at its full resolution all the same. */
  lite = false;
  private frameNo = 0;
  draw(camera: THREE.PerspectiveCamera, w: number, h: number, fade: [number, number]) {
    const cv = this.canvas;
    if (!cv) return;
    if (this.lite && (++this.frameNo & 1) && this.size[0] === w && this.size[1] === h) return;
    if (!this.ctx) this.ctx = cv.getContext("2d");
    const ctx = this.ctx;
    if (!ctx) return;
    const dpr = Math.min(this.lite ? 1.5 : 2, window.devicePixelRatio || 1);
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
    this.boxes.length = 0;
    const t = performance.now() / 1000;
    let drawn = 0;
    for (const [d, s, sx, sy] of seen) {
      if (drawn >= 60) break;
      const st = STYLE[s.kind];
      const k = 1 - THREE.MathUtils.smoothstep(d, 250, 2200);
      const font = Math.round(10 + 3 * k);
      const card = DroneSigns.hasCard(s), lit = this.selected === s.key;
      const label = (st.icon ? `${st.icon} ${s.name}` : s.name) + (card ? " ⓘ" : "");
      const wkey = font + "|" + label;
      let tw = this.widths.get(wkey);
      if (tw === undefined) { ctx.font = `700 ${font}px system-ui, sans-serif`; tw = ctx.measureText(label).width; this.widths.set(wkey, tw); }
      const bw = tw + 14, bh = font + 9, stem = 10 + 8 * k;
      const x0 = sx - bw / 2, y0 = sy - stem - bh;
      if (x0 < -bw || x0 > w || y0 < -bh || sy > h + 4) continue;
      if (placed.some(([px, py, pw, ph]) => x0 < px + pw + 3 && x0 + bw + 3 > px && y0 < py + ph + 3 && y0 + bh + 3 > py)) continue;
      placed.push([x0, y0, bw, bh]);
      this.boxes.push({ x: x0, y: y0, w: bw, h: bh, sx, sy, s });
      drawn++;
      // (fading into the haze with the ground under it)
      ctx.globalAlpha = 1 - 0.85 * THREE.MathUtils.smoothstep(d, fade[0], fade[1] * 0.92);
      const edge = s.tint ?? st.edge;
      ctx.strokeStyle = edge; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, y0 + bh); ctx.stroke();
      ctx.fillStyle = edge; ctx.beginPath(); ctx.arc(sx, sy, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = st.bg;
      ctx.beginPath(); ctx.roundRect(x0, y0, bw, bh, bh / 2); ctx.fill();
      if (card && this.fx && s.kind!=='cctv' && s.kind!=='bike' && s.kind!=='parking' && s.kind!=='train' && s.kind!=='service' && s.kind!=='exit') {
        // (a soft glow in the sign's own colour, breathing slowly — a sign to tap; steady and
        // brighter while its card is open)
        const pulse = lit ? 1 : 0.5 + 0.5 * Math.sin(t * 2.4 + sx * 0.02);
        ctx.save();
        ctx.strokeStyle = edge;
        for (const [lw, al] of [[7, 0.07], [4, 0.14]] as const) {
          ctx.globalAlpha = (1 - 0.85 * THREE.MathUtils.smoothstep(d, fade[0], fade[1] * 0.92)) * al * (0.45 + 0.75 * pulse);
          ctx.lineWidth = lw; ctx.beginPath(); ctx.roundRect(x0, y0, bw, bh, bh / 2); ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = edge; ctx.lineWidth = lit ? 1.8 : 1.2; ctx.stroke();
      } else { ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.font = `700 ${font}px system-ui, sans-serif`; ctx.fillStyle = st.fg; ctx.textBaseline = "middle"; ctx.textAlign = "center";
      ctx.fillText(label, sx, y0 + bh / 2 + 0.5);
    }
    ctx.globalAlpha = 1;
    if (this.widths.size > 4000) this.widths.clear();
  }

  /** Every sign now known (for the radar). */
  all(): readonly Sign[] { if (this.dirty) this.merge(); return this.merged; }
}
