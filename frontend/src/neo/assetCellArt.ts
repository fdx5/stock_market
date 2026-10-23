/** Procedural animations for the "Prices in between" cells. Each draws one frame at
 *  time `t` (seconds) into a context already scaled to CSS pixels (w × h). */
export type CellArtKind = "usd-krw" | "bitcoin" | "ethereum" | "xrp" | "wti" | "gold" | "silver";
type Draw = (g:CanvasRenderingContext2D, w:number, h:number, t:number) => void;
/** Live inputs a cell's art reads every frame (kept current by the component). */
export type CellOpts = { up:boolean };

const TAU = Math.PI * 2;
const clamp = (v:number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const ease = (v:number) => v * v * (3 - 2 * v);
const easeOut = (v:number) => 1 - (1 - v) ** 3;

function glow(g:CanvasRenderingContext2D, x:number, y:number, r:number, color:string, alpha = 1) {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, color); grad.addColorStop(1, "transparent");
  g.globalAlpha = alpha; g.fillStyle = grad; g.fillRect(x - r, y - r, r * 2, r * 2); g.globalAlpha = 1;
}
function star(g:CanvasRenderingContext2D, x:number, y:number, r:number, alpha:number, color = "#ffffff") {
  if (alpha <= 0) return;
  g.save(); g.globalAlpha = alpha; g.globalCompositeOperation = "lighter";
  glow(g, x, y, r * .9, color, .8);
  g.fillStyle = color; g.beginPath();
  for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, d = i % 2 ? r * .12 : r; g.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); }
  g.closePath(); g.fill(); g.restore();
}
function roundRect(g:CanvasRenderingContext2D, x:number, y:number, w:number, h:number, r:number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/* ── USD/KRW: a strap of $100 notes, laid on the diagonal, riffled one by one ──── */
/** Engraved Franklin portrait in an oval, in the note's own ink colours. */
function portrait(g:CanvasRenderingContext2D, cx:number, cy:number, rw:number, rh:number) {
  g.save();
  g.beginPath(); g.ellipse(cx, cy, rw, rh, 0, 0, TAU); g.clip();
  const field = g.createRadialGradient(cx, cy - rh * .2, rh * .1, cx, cy, rh);
  field.addColorStop(0, "#e9eee0"); field.addColorStop(1, "#b9c6ad");
  g.fillStyle = field; g.fillRect(cx - rw, cy - rh, rw * 2, rh * 2);
  // Fine engraved background lines.
  g.strokeStyle = "rgba(70,95,70,.25)"; g.lineWidth = Math.max(.25, rh * .02);
  for (let y = cy - rh; y < cy + rh; y += Math.max(.8, rh * .07)) { g.beginPath(); g.moveTo(cx - rw, y); g.lineTo(cx + rw, y); g.stroke(); }
  const ink = "#2f4632", mid = "#6d7f62", light = "#c9d2bb";
  // Coat and collar.
  g.fillStyle = ink; g.beginPath(); g.ellipse(cx, cy + rh * 1.02, rw * 1.05, rh * .55, 0, 0, TAU); g.fill();
  g.fillStyle = light; g.beginPath(); g.moveTo(cx - rw * .22, cy + rh * .48); g.lineTo(cx, cy + rh * .78); g.lineTo(cx + rw * .22, cy + rh * .48); g.closePath(); g.fill();
  // Long hair falling to the shoulders.
  g.fillStyle = mid; g.beginPath(); g.ellipse(cx, cy + rh * .12, rw * .62, rh * .5, 0, 0, TAU); g.fill();
  // Face, with the high forehead.
  const skin = g.createRadialGradient(cx - rw * .1, cy - rh * .12, rh * .05, cx, cy, rh * .45);
  skin.addColorStop(0, "#e3e8d6"); skin.addColorStop(1, "#97a68a");
  g.fillStyle = skin; g.beginPath(); g.ellipse(cx, cy - rh * .02, rw * .36, rh * .42, 0, 0, TAU); g.fill();
  // Features: brows, eyes, nose shadow, mouth, cheek shading.
  g.strokeStyle = ink; g.lineWidth = Math.max(.35, rh * .035); g.lineCap = "round";
  for (const s of [-1, 1]) {
    g.beginPath(); g.moveTo(cx + s * rw * .06, cy - rh * .06); g.lineTo(cx + s * rw * .2, cy - rh * .08); g.stroke();
    g.beginPath(); g.moveTo(cx + s * rw * .08, cy - rh * .01); g.lineTo(cx + s * rw * .18, cy - rh * .01); g.stroke();
  }
  g.beginPath(); g.moveTo(cx + rw * .02, cy + rh * .02); g.lineTo(cx + rw * .05, cy + rh * .13); g.lineTo(cx - rw * .02, cy + rh * .14); g.stroke();
  g.beginPath(); g.moveTo(cx - rw * .1, cy + rh * .23); g.quadraticCurveTo(cx, cy + rh * .26, cx + rw * .1, cy + rh * .23); g.stroke();
  g.fillStyle = "rgba(47,70,50,.28)";
  g.beginPath(); g.ellipse(cx + rw * .24, cy + rh * .08, rw * .1, rh * .2, 0, 0, TAU); g.fill();
  g.restore();
  g.strokeStyle = "#3f5a40"; g.lineWidth = Math.max(.5, rh * .05); g.beginPath(); g.ellipse(cx, cy, rw, rh, 0, 0, TAU); g.stroke();
}
// Note photographs (Wikimedia Commons): the series 2009 $100 obverse (US government work,
// public domain) and the Bank of Korea's ₩50,000 specimen ("보기") under its currency-image terms.
const NOTE_SRC = ["/img/ticker/usd100-obverse.webp", "/img/ticker/krw50000-obverse.webp"];
const noteImages:(HTMLImageElement | null)[] = [null, null];
function bill(kind = 0):HTMLImageElement | null {
  if (!noteImages[kind] && typeof Image !== "undefined") { const image = new Image(); image.src = NOTE_SRC[kind]; noteImages[kind] = image; }
  const image = noteImages[kind];
  return image?.complete && image.naturalWidth ? image : null;
}
function noteFace(g:CanvasRenderingContext2D, w:number, h:number, back:boolean, kind = 0) {
  const photo = back ? null : bill(kind);
  if (photo) {
    g.save(); roundRect(g, 0, 0, w, h, h * .04); g.clip(); g.drawImage(photo, 0, 0, w, h); g.restore();
    g.strokeStyle = "rgba(60,80,60,.6)"; g.lineWidth = .5; roundRect(g, 0, 0, w, h, h * .04); g.stroke();
    return;
  }
  const face = g.createLinearGradient(0, 0, w, h);
  face.addColorStop(0, back ? "#d6e2d2" : "#eef1e6"); face.addColorStop(.5, back ? "#c3d3c0" : "#dde3d2"); face.addColorStop(1, back ? "#b2c4ae" : "#ccd6c0");
  g.fillStyle = face; roundRect(g, 0, 0, w, h, h * .05); g.fill();
  g.strokeStyle = "#6f8a6a"; g.lineWidth = .5; g.stroke();
  g.strokeStyle = "rgba(90,120,85,.45)"; g.lineWidth = .4; g.strokeRect(w * .03, h * .07, w * .94, h * .86);
  g.fillStyle = "#38563a"; g.textBaseline = "middle";
  if (!back) {
    // THE UNITED STATES OF AMERICA band, portrait, ribbon, bell in inkwell, numerals.
    g.fillStyle = "rgba(56,86,58,.55)"; g.fillRect(w * .1, h * .1, w * .8, h * .045);
    portrait(g, w * .42, h * .53, w * .16, h * .4);
    const ribbon = g.createLinearGradient(w * .63, 0, w * .67, 0);
    ribbon.addColorStop(0, "#2a59a8"); ribbon.addColorStop(.5, "#6fa3ff"); ribbon.addColorStop(1, "#2a59a8");
    g.fillStyle = ribbon; g.fillRect(w * .63, 0, w * .035, h);
    g.fillStyle = "#b8873a"; g.beginPath(); g.ellipse(w * .76, h * .6, w * .045, h * .15, 0, 0, TAU); g.fill();
    g.fillStyle = "#e0b45a"; g.beginPath(); g.ellipse(w * .76, h * .56, w * .022, h * .07, 0, 0, TAU); g.fill();
    g.fillStyle = "#38563a"; g.font = `800 ${h * .2}px Georgia, serif`; g.fillText("100", w * .05, h * .24);
    g.fillStyle = "#c0913c"; g.font = `800 ${h * .3}px Georgia, serif`; g.textAlign = "right"; g.fillText("100", w * .97, h * .8); g.textAlign = "left";
  } else {
    // Independence Hall on the back.
    g.fillStyle = "#6f8a68"; g.fillRect(w * .3, h * .45, w * .4, h * .3); g.fillRect(w * .47, h * .22, w * .06, h * .25);
    g.beginPath(); g.moveTo(w * .46, h * .22); g.lineTo(w * .5, h * .12); g.lineTo(w * .54, h * .22); g.fill();
    g.font = `800 ${h * .2}px Georgia, serif`; g.fillStyle = "#38563a"; g.fillText("100", w * .05, h * .24);
  }
}
const drawBills:Draw = (g, w, h, t) => {
  // As large as asked, but the whole tilted strap stays inside the cell.
  const tilt = .36, aspect = 2.37, cos = Math.cos(tilt), sin = Math.sin(tilt);
  const fitW = (w * .98) / (cos + sin / aspect), fitH = (h * .95 - 7) / (sin + cos / aspect);
  const bw = Math.min(Math.min(w * .92, h * .98) * 1.35, fitW, fitH), bh = bw / aspect;
  // Counting: every COUNT seconds the top note is pushed off; the strap thins and refills.
  const COUNT = 1.1, counted = Math.floor(t / COUNT), p = (t % COUNT) / COUNT;
  const layers = 9 - (counted % 6);
  g.save();
  g.translate(w * .5, h * .5); g.rotate(-tilt); // the strap lies on the diagonal
  glow(g, 0, bh * .2, bw * .6, "rgba(140,220,150,.16)");
  g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.ellipse(bw * .03, bh * .62, bw * .5, bh * .16, 0, 0, TAU); g.fill();
  for (let i = layers; i >= 1; i--) { g.fillStyle = i % 2 ? "#e6c27a" : "#d3dcc8"; roundRect(g, -bw / 2 + i * .25, -bh / 2 + i * .7, bw, bh, bh * .05); g.fill(); }
  // Notes alternate: $100, ₩50,000, $100 … — the one revealed is always the other kind.
  // (Until the ₩50,000 photo has loaded, the $100 face stands in.)
  const face = (n:number) => noteFace(g, bw, bh, false, bill(n % 2) ? n % 2 : 0);
  // The note underneath, fully visible once the counted one has gone.
  g.save(); g.translate(-bw / 2, -bh / 2); face(counted + 1); g.restore();
  // Paper band at the far end, clear of the portrait.
  const band = g.createLinearGradient(0, -bh / 2, 0, bh / 2);
  band.addColorStop(0, "#e9c873"); band.addColorStop(1, "#b58a32");
  g.fillStyle = band; g.fillRect(bw * .33, -bh / 2 - .5, bw * .08, bh + layers * .7 + 1);
  // The note being counted: a thumb lifts it, then it is pushed off along its length,
  // crisp and opaque, out past the cell's edge. No fading: each note visibly goes.
  const lift = Math.sin(clamp(p / .3) * Math.PI / 2) * bh * .06;
  const push = p < .42 ? 0 : (clamp((p - .42) / .4)) ** 2;
  if (push < 1) {
    g.save();
    g.translate(-bw / 2 + push * bw * 1.6, -bh / 2 - lift - push * bh * .25);
    g.rotate(push * -.06);
    g.fillStyle = "rgba(0,0,0,.28)"; roundRect(g, 1.5, 2.5, bw, bh, bh * .05); g.fill();
    face(counted);
    g.restore();
  }
  g.restore();
};

/* ── Bitcoin: a gold coin turning, flashing as its face meets the light ───────── */
const drawBitcoin:Draw = (g, w, h, t) => {
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * .38;
  const a = t * 2.6, c = Math.cos(a), sx = Math.max(.04, Math.abs(c));
  const face = Math.abs(c), flash = Math.max(0, face - .9) * 10;
  glow(g, cx, cy, r * 1.9, `rgba(255,190,60,${.22 + flash * .35})`);
  // Rim (edge thickness) behind the face.
  const rim = r * .16 * Math.sqrt(1 - sx * sx);
  g.fillStyle = "#8a5a10";
  g.beginPath(); g.ellipse(cx + Math.sign(c || 1) * rim, cy, r * sx, r, 0, 0, TAU); g.fill();
  g.fillStyle = "#b37a1c"; g.fillRect(cx - (c > 0 ? 0 : rim), cy - r, rim, r * 2);
  // Face
  const grad = g.createRadialGradient(cx - r * .35 * sx, cy - r * .4, r * .1, cx, cy, r);
  grad.addColorStop(0, "#fff3b0"); grad.addColorStop(.45, "#f7b733"); grad.addColorStop(1, "#b8730f");
  g.fillStyle = grad; g.beginPath(); g.ellipse(cx, cy, r * sx, r, 0, 0, TAU); g.fill();
  g.strokeStyle = "#ffe08a"; g.lineWidth = r * .07; g.beginPath(); g.ellipse(cx, cy, r * .82 * sx, r * .82, 0, 0, TAU); g.stroke();
  g.save(); g.translate(cx, cy); g.scale(c >= 0 ? sx : -sx, 1);
  g.fillStyle = "#fffaf0"; g.font = `800 ${r * 1.15}px Arial, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  g.shadowColor = "#7a4a00"; g.shadowBlur = r * .12; g.fillText("₿", 0, r * .04);
  g.restore();
  // Sheen sweeping across and a star flash when the face is square on.
  g.save(); g.beginPath(); g.ellipse(cx, cy, r * sx, r, 0, 0, TAU); g.clip();
  const sweep = cx - r + ((t * .8) % 1) * r * 3;
  const band = g.createLinearGradient(sweep - r * .3, 0, sweep + r * .3, 0);
  band.addColorStop(0, "transparent"); band.addColorStop(.5, "rgba(255,255,255,.55)"); band.addColorStop(1, "transparent");
  g.fillStyle = band; g.fillRect(cx - r, cy - r, r * 2, r * 2); g.restore();
  star(g, cx + r * .45 * sx, cy - r * .55, r * .9, flash);
};

/* ── Ethereum and XRP: logos snapping half a turn, vertices lit ──────────────── */
function flipAngle(t:number, period:number, offset = 0) {
  const p = ((t + offset) % period) / period;
  const turn = Math.floor((t + offset) / period);
  return (turn + ease(clamp(p / .32))) * Math.PI; // quick 180°, then a held pose
}
const drawEthereum:Draw = (g, w, h, t) => {
  const cx = w / 2, cy = h / 2, s = Math.min(w * .42, h * .44);
  const a = flipAngle(t, 1.3), c = Math.cos(a), sx = Math.max(.06, Math.abs(c)), back = c < 0;
  glow(g, cx, cy, s * 1.1, "rgba(130,140,255,.16)");
  const P = (x:number, y:number):[number, number] => [cx + x * s * sx * (back ? -1 : 1), cy + y * s];
  const poly = (pts:[number, number][], fill:string) => { g.fillStyle = fill; g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill(); };
  const top = P(0, -1), left = P(-.62, .08), right = P(.62, .08), mid = P(0, .36), mid2 = P(0, .5), low = P(0, 1), lowL = P(-.62, .2), lowR = P(.62, .2);
  const shade = (base:number) => `hsl(232, 38%, ${base + (back ? -8 : 0) + Math.abs(Math.sin(a)) * 6}%)`;
  poly([top, left, P(0, -.16)], shade(78)); poly([top, P(0, -.16), right], shade(60));
  poly([left, P(0, -.16), mid], shade(55)); poly([P(0, -.16), right, mid], shade(40));
  poly([lowL, mid2, low], shade(70)); poly([mid2, lowR, low], shade(48));
  // Light only at the top and bottom tips, softly.
  const pulse = .45 + .25 * Math.sin(t * 4);
  star(g, top[0], top[1], s * .32, pulse, "#dfe4ff");
  star(g, low[0], low[1], s * .28, pulse * .9, "#dfe4ff");
};
// The XRP mark (official geometry, 512 × 424 units), on a dark token disc.
const XRP_TOP = typeof Path2D !== "undefined" ? new Path2D("M437 0h74L357 152.48c-55.77 55.19-146.19 55.19-202 0L.94 0H75l117 115.83a91.37 91.37 0 0 0 127.91 0z") : null;
const XRP_BOTTOM = typeof Path2D !== "undefined" ? new Path2D("M74.05 424H0l155-153.42c55.77-55.19 146.19-55.19 202 0L512 424h-74L320 307.23a91.37 91.37 0 0 0-127.91 0z") : null;
const drawXrp:Draw = (g, w, h, t) => {
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * .4;
  const a = flipAngle(t, 1.6, .5), c = Math.cos(a), sx = Math.max(.05, Math.abs(c));
  // Coin edge
  const rim = r * .12 * Math.sqrt(1 - sx * sx);
  g.fillStyle = "#0b0e12"; g.beginPath(); g.ellipse(cx + Math.sign(c || 1) * rim, cy, r * sx, r, 0, 0, TAU); g.fill();
  g.fillStyle = "#3a4048"; g.fillRect(cx - (c > 0 ? 0 : rim), cy - r, rim, r * 2);
  const disc = g.createRadialGradient(cx - r * .3 * sx, cy - r * .35, r * .1, cx, cy, r);
  disc.addColorStop(0, "#3c444e"); disc.addColorStop(1, "#14181d");
  g.fillStyle = disc; g.beginPath(); g.ellipse(cx, cy, r * sx, r, 0, 0, TAU); g.fill();
  g.strokeStyle = "rgba(255,255,255,.18)"; g.lineWidth = r * .05; g.beginPath(); g.ellipse(cx, cy, r * .9 * sx, r * .9, 0, 0, TAU); g.stroke();
  if (XRP_TOP && XRP_BOTTOM) {
    const unit = r * 1.1 / 512;
    g.save(); g.translate(cx, cy); g.scale((c >= 0 ? 1 : -1) * sx * unit, unit); g.translate(-256, -212);
    g.fillStyle = "#f4f6f8"; g.fill(XRP_TOP); g.fill(XRP_BOTTOM);
    g.restore();
  }
};

/* ── Liquids: a column-spring surface so the pool sloshes and settles naturally ── */
class Surface {
  h:Float32Array; v:Float32Array; last = -1;
  constructor(readonly n:number, readonly stiffness:number, readonly damping:number, readonly spread:number) {
    this.h = new Float32Array(n); this.v = new Float32Array(n);
  }
  /** Push the surface down (positive) or up at a fraction 0..1 across the cell. */
  poke(at:number, force:number, width = 2) {
    const c = Math.round(clamp(at) * (this.n - 1));
    for (let i = Math.max(0, c - width); i <= Math.min(this.n - 1, c + width); i++) this.v[i] += force * (1 - Math.abs(i - c) / (width + 1));
  }
  step(t:number) {
    const dt = this.last < 0 ? 1 / 60 : clamp(t - this.last, 0, .05); this.last = t;
    for (let sub = 0; sub < 3; sub++) {
      const k = dt / 3 * 60;
      for (let i = 0; i < this.n; i++) { this.v[i] += (-this.stiffness * this.h[i] - this.damping * this.v[i]) * k; this.h[i] += this.v[i] * k; }
      for (let pass = 0; pass < 2; pass++)
        for (let i = 0; i < this.n; i++) {
          const left = i ? this.h[i - 1] : this.h[i], right = i < this.n - 1 ? this.h[i + 1] : this.h[i];
          this.v[i] += this.spread * (left + right - 2 * this.h[i]) * k;
        }
    }
  }
  /** Smooth path of the surface; returns slope per column for lighting. */
  path(g:CanvasRenderingContext2D, w:number, base:number, ripple:(x:number) => number) {
    const pts = Array.from(this.h, (y, i) => [i / (this.n - 1) * w, base + y + ripple(i / (this.n - 1) * w)] as const);
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) g.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    return pts;
  }
}

function surfaceLight(g:CanvasRenderingContext2D, pts:readonly (readonly [number, number])[], color:(slope:number) => string, width:number) {
  // Specular streak along the surface, brightest where the slope faces the light (upper left).
  for (let i = 1; i < pts.length; i++) {
    const slope = (pts[i][1] - pts[i - 1][1]) / Math.max(1e-3, pts[i][0] - pts[i - 1][0]);
    g.strokeStyle = color(slope); g.lineWidth = width;
    g.beginPath(); g.moveTo(pts[i - 1][0], pts[i - 1][1] + width * .6); g.lineTo(pts[i][0], pts[i][1] + width * .6); g.stroke();
  }
}

function pourStream(g:CanvasRenderingContext2D, x0:number, y0:number, x1:number, y1:number, t:number, thick:number, body:string, shine:string) {
  // A tapered, wobbling ribbon that thins as it falls and spreads where it lands.
  const steps = 14;
  const at = (k:number) => { const u = k / steps, x = x0 + (x1 - x0) * (1 - (1 - u) ** 2), y = y0 + (y1 - y0) * u * u + (y1 - y0) * .2 * u; return [x + Math.sin(u * 9 - t * 18) * u * 1.2, y] as const; };
  const left:[number, number][] = [], right:[number, number][] = [];
  for (let k = 0; k <= steps; k++) { const [x, y] = at(k), r = thick * (1 - k / steps * .55) * (k === steps ? 1.6 : 1); left.push([x - r, y]); right.push([x + r, y]); }
  g.beginPath(); left.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); right.reverse().forEach(([x, y]) => g.lineTo(x, y)); g.closePath();
  g.fillStyle = body; g.fill();
  g.strokeStyle = shine; g.lineWidth = Math.max(.6, thick * .35); g.beginPath();
  for (let k = 1; k < steps; k++) { const [x, y] = at(k); if (k === 1) g.moveTo(x - thick * .3, y); else g.lineTo(x - thick * .3, y); }
  g.stroke();
}

type Drop = { x:number; y:number; vx:number; vy:number; r:number };
function splash(drops:Drop[], x:number, y:number, n:number, power:number) {
  for (let i = 0; i < n && drops.length < 40; i++) drops.push({ x, y, vx:(Math.random() - .5) * power * 1.6, vy:-(.4 + Math.random()) * power, r:.8 + Math.random() * 1.4 });
}
function stepDrops(g:CanvasRenderingContext2D, drops:Drop[], floor:(x:number) => number, color:string) {
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i]; d.vy += 7; d.x += d.vx / 60; d.y += d.vy / 60;
    if (d.y > floor(d.x)) { drops.splice(i, 1); continue; }
    g.fillStyle = color; g.beginPath(); g.ellipse(d.x, d.y, d.r, d.r * (1 + Math.min(1.5, Math.abs(d.vy) / 120)), Math.atan2(d.vx, d.vy) * -.3, 0, TAU); g.fill();
  }
}

/* WTI: a bright cell; a black steel drum tips and crude gushes out, rising to 60%. */
function blackDrum(g:CanvasRenderingContext2D, dw:number, dh:number) {
  // Local frame: drum occupies x ∈ [-dw, 0], y ∈ [-dh, 0].
  const body = g.createLinearGradient(-dw, 0, 0, 0);
  body.addColorStop(0, "#050505"); body.addColorStop(.18, "#2b2b2e"); body.addColorStop(.32, "#77777c"); body.addColorStop(.42, "#2a2a2d");
  body.addColorStop(.75, "#111113"); body.addColorStop(1, "#000");
  g.fillStyle = body; roundRect(g, -dw, -dh, dw, dh, dw * .06); g.fill();
  // Rolling hoops and chimes.
  for (const y of [.04, .33, .67, .96]) {
    const hoop = g.createLinearGradient(-dw, 0, 0, 0);
    hoop.addColorStop(0, "#111"); hoop.addColorStop(.3, "#9a9aa0"); hoop.addColorStop(.45, "#3a3a3e"); hoop.addColorStop(1, "#080808");
    g.fillStyle = hoop; g.fillRect(-dw - .5, -dh * (1 - y) - dh * .025, dw + 1, dh * .05);
  }
  // Top lid with a bung.
  g.fillStyle = "#1a1a1c"; g.beginPath(); g.ellipse(-dw / 2, -dh, dw * .5, dw * .12, 0, 0, TAU); g.fill();
  g.strokeStyle = "#58585e"; g.lineWidth = .8; g.stroke();
  g.fillStyle = "#77777d"; g.beginPath(); g.ellipse(-dw * .72, -dh, dw * .07, dw * .03, 0, 0, TAU); g.fill();
  // Oil-drop emblem in an amber roundel.
  const ex = -dw * .5, ey = -dh * .5, er = dw * .2;
  g.fillStyle = "#f2b31d"; g.beginPath(); g.arc(ex, ey, er, 0, TAU); g.fill();
  g.fillStyle = "#111"; g.beginPath();
  g.moveTo(ex, ey - er * .72); g.bezierCurveTo(ex + er * .55, ey - er * .05, ex + er * .55, ey + er * .6, ex, ey + er * .62);
  g.bezierCurveTo(ex - er * .55, ey + er * .6, ex - er * .55, ey - er * .05, ex, ey - er * .72); g.fill();
  g.fillStyle = "rgba(255,255,255,.7)"; g.beginPath(); g.ellipse(ex - er * .15, ey + er * .15, er * .08, er * .16, -.4, 0, TAU); g.fill();
}
type Flame = { x:number; y:number; vx:number; vy:number; age:number; life:number; r:number };
/** A lit match: wooden stick, red head, flame always streaming upward. */
function drawMatch(g:CanvasRenderingContext2D, x:number, y:number, len:number, angle:number, t:number) {
  g.save(); g.translate(x, y); g.rotate(angle);
  const wood = g.createLinearGradient(0, -len * .05, 0, len * .05);
  wood.addColorStop(0, "#f3d9a4"); wood.addColorStop(1, "#b98a4a");
  g.fillStyle = wood; g.fillRect(-len / 2, -len * .045, len, len * .09);
  g.fillStyle = "#3a1d12"; g.beginPath(); g.ellipse(len / 2, 0, len * .09, len * .07, 0, 0, TAU); g.fill();
  g.restore();
  const hx = x + Math.cos(angle) * len / 2, hy = y + Math.sin(angle) * len / 2, f = len * (.32 + .05 * Math.sin(t * 31) + .03 * Math.sin(t * 17));
  glow(g, hx, hy - f * .3, f * 1.3, "rgba(255,180,60,.35)");
  flameTongue(g, hx, hy, f * .42, f, "rgba(255,120,30,.9)");
  flameTongue(g, hx, hy, f * .24, f * .62, "rgba(255,236,150,.95)");
}
/** A flame tongue standing on (x, y): round at the foot, pointed at the tip. */
function flameTongue(g:CanvasRenderingContext2D, x:number, y:number, r:number, height:number, color:string) {
  g.fillStyle = color; g.beginPath();
  g.moveTo(x, y - height);
  g.bezierCurveTo(x + r * .5, y - height * .55, x + r * 1.1, y - r * .4, x, y + r * .35);
  g.bezierCurveTo(x - r * 1.1, y - r * .4, x - r * .5, y - height * .55, x, y - height);
  g.fill();
}
function createOil(opts:CellOpts):Draw {
  // Seconds: tip 0–1.1, fill 1.3–9.2, hold full 5 s, drain and right the drum 14.2–17.
  // When crude is up the scene carries on instead: a lit match drops in, the slick burns for
  // 4 s under rising smoke, then fire and smoke die away as the pool is consumed.
  const FULL = 9.24, HOLD = FULL + 5, THROW = HOLD, IGNITE = THROW + 1.4, OUT = IGNITE + 4;
  let surface:Surface | null = null, last = 0;
  const flames:Flame[] = [], smoke:Flame[] = [];
  return (g, w, h, t) => {
    const dt = clamp(t - last, 0, .05); last = t;
    const fire = opts.up, cycle = fire ? OUT + 2.4 : HOLD + 2.76, drain = fire ? OUT : HOLD;
    const n = Math.max(14, Math.round(w / 5));
    if (!surface || surface.n !== n) surface = new Surface(n, .016, .05, .1);
    const s = t % cycle;
    const burn = !fire || s < IGNITE ? 0 : s < OUT ? clamp((s - IGNITE) / .35) : 1 - clamp((s - OUT) / 1.2);
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#fdfcf8"); bg.addColorStop(1, "#ece6d8");
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    if (burn > 0) {
      // The fire warms the whole cell.
      const warm = g.createLinearGradient(0, 0, 0, h);
      warm.addColorStop(0, `rgba(255,190,120,${.12 * burn})`); warm.addColorStop(1, `rgba(255,120,40,${.3 * burn})`);
      g.fillStyle = warm; g.fillRect(0, 0, w, h);
    }
    const tip = s < 1.12 ? easeOut(s / 1.12) : s < drain ? 1 : 1 - ease((s - drain) / (cycle - drain));
    const level = s < 1.26 ? 0 : s < FULL ? ease((s - 1.26) / (FULL - 1.26)) : s < drain ? 1 : 1 - ease((s - drain) / (cycle - drain));
    const base = h - level * h * .6;
    // Standing at the upper right; tipping past horizontal turns its mouth down onto the pool.
    const dh = Math.min(h * .5, w * .32), dw = dh * .68, px = w - 4, py = h * .56, angle = -tip * Math.PI * .6;
    const lx = -dw / 2, ly = -dh, mouth = { x:px + Math.cos(angle) * lx - Math.sin(angle) * ly, y:py + Math.sin(angle) * lx + Math.cos(angle) * ly };
    const flow = s > .98 && s < 9.8 ? (s < 1.4 ? (s - .98) / .42 : s > 8.96 ? (9.8 - s) / .84 : 1) : 0;
    const glug = 1 + .35 * Math.sin(t * 13) + .15 * Math.sin(t * 29);
    const landX = Math.max(6, mouth.x - dh * .25), fireX = w * .64;
    if (flow > 0) {
      surface.poke(landX / w, 2.4 * flow * glug, 2);
    }
    if (Math.abs(s - 9.8) < .042) surface.poke(.35, -3, 7);
    if (fire && Math.abs(s - IGNITE) < .03) surface.poke(fireX / w, 3, 3);
    surface.step(t);
    // Pool
    let pts:readonly (readonly [number, number])[] = [];
    if (level > 0) {
      g.save(); g.beginPath();
      pts = surface.path(g, w, base, x => Math.sin(x * .05 + t * 1.5) * .8);
      g.lineTo(w, h); g.lineTo(0, h); g.closePath();
      const oil = g.createLinearGradient(0, base - 4, 0, h);
      oil.addColorStop(0, "#4b3720"); oil.addColorStop(.08, "#1f150a"); oil.addColorStop(.5, "#0b0703"); oil.addColorStop(1, "#030201");
      g.fillStyle = oil; g.fill(); g.clip();
      const drift = (t * 16) % (w * 2) - w, slick = g.createLinearGradient(drift, 0, drift + w, 0);
      slick.addColorStop(0, "rgba(90,50,200,0)"); slick.addColorStop(.3, "rgba(110,70,230,.22)"); slick.addColorStop(.5, "rgba(30,190,170,.18)"); slick.addColorStop(.7, "rgba(230,170,40,.16)"); slick.addColorStop(1, "rgba(230,170,40,0)");
      g.fillStyle = slick; g.fillRect(0, base - 6, w, 16);
      // Broad, slow highlights rolling under the glossy surface; firelight when it burns.
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < 3; i++) { const x = ((t * (9 + i * 4) + i * 70) % (w + 60)) - 30; glow(g, x, base + 8 + i * 7, 18, "rgba(255,230,190,.07)"); }
      if (burn > 0) { const shine = g.createLinearGradient(0, base, 0, base + h * .2); shine.addColorStop(0, `rgba(255,140,40,${.45 * burn})`); shine.addColorStop(1, "rgba(255,120,30,0)"); g.fillStyle = shine; g.fillRect(0, base - 4, w, h * .2 + 4); }
      g.restore();
      g.lineCap = "round";
      surfaceLight(g, pts, slope => `rgba(255,248,232,${clamp(.2 - slope * 1, .04, .8)})`, 1.5);
    }
    const surfaceY = (x:number) => pts.length ? pts[Math.round(clamp(x / w) * (pts.length - 1))][1] : base;
    // Fire spreads out from where the match lands.
    const spread = clamp((s - IGNITE) / .7), left = fireX - spread * w, right = fireX + spread * w * .8;
    if (burn > 0 && pts.length) {
      const reach = (x:number) => clamp(Math.min(x - left, right - x) / (w * .1));
      for (const [tall, stops, phase] of [[h * .55, ["rgba(240,90,20,.85)", "rgba(220,60,15,.65)", "rgba(160,30,10,0)"], 0], [h * .4, ["rgba(255,200,90,.95)", "rgba(255,130,30,.85)", "rgba(230,70,15,0)"], 1.7], [h * .2, ["rgba(255,252,225,1)", "rgba(255,215,100,.9)", "rgba(255,150,40,0)"], 3.1]] as const) {
        g.beginPath();
        const top:[number, number][] = [];
        for (const [x, y] of pts) {
          if (x < left || x > right) continue;
          const tongue = Math.max(0, Math.sin(x * .19 + t * 9 + phase + Math.sin(x * .05 + t * 3 + phase) * 2)) ** 1.4, sway = Math.sin(t * 6 + x * .07 + phase) * 2;
          top.push([x + sway, y - tall * burn * reach(x) * (.3 + .7 * tongue)]);
          if (top.length === 1) g.moveTo(x, y + 1); else g.lineTo(x, y + 1);
        }
        for (let i = top.length - 1; i >= 0; i--) g.lineTo(top[i][0], top[i][1]);
        g.closePath();
        const fill = g.createLinearGradient(0, base, 0, base - tall);
        fill.addColorStop(0, stops[0]); fill.addColorStop(.45, stops[1]); fill.addColorStop(1, stops[2]);
        g.fillStyle = fill; g.fill();
      }
      // Loose tongues of flame leaping off the sheet, and smoke from their tips.
      for (let k = 0; k < 4 * burn; k++) {
        const x = left + Math.random() * (right - left);
        flames.push({ x, y:surfaceY(x) - Math.random() * h * .06, vx:(Math.random() - .5) * 12, vy:-(.35 + Math.random() * .45) * h, age:0, life:.4 + Math.random() * .4, r:h * (.03 + Math.random() * .035) });
      }
      if (s < OUT && Math.random() < dt * 9 && smoke.length < 30) {
        const x = left + Math.random() * (right - left);
        smoke.push({ x, y:surfaceY(x) - h * .3, vx:(Math.random() - .3) * 14, vy:-(.09 + Math.random() * .07) * h, age:0, life:2.6 + Math.random() * 1, r:h * (.08 + Math.random() * .05) });
      }
    }
    for (let i = flames.length - 1; i >= 0; i--) {
      const f = flames[i]; f.age += dt; f.x += f.vx * dt; f.y += f.vy * dt;
      if (f.age > f.life) { flames.splice(i, 1); continue; }
      const a = f.age / f.life, size = f.r * (1 - a * .6);
      const color = a < .3 ? `rgba(255,226,140,${.6 * (1 - a)})` : a < .65 ? `rgba(255,140,40,${.55 * (1 - a)})` : `rgba(200,55,20,${.45 * (1 - a)})`;
      flameTongue(g, f.x, f.y, size * 1.3, size * (1.8 + (f.r * 37 % 1)), color);
    }
    if (flames.length > 220) flames.splice(0, flames.length - 220);
    // Ignition flash where the match lands.
    if (fire && s >= IGNITE && s < IGNITE + .35) {
      const p = (s - IGNITE) / .35;
      glow(g, fireX, surfaceY(fireX) - h * .05, h * (.25 + p * .4), `rgba(255,220,130,${.9 * (1 - p)})`);
    }
    // Drum in front of the pool.
    g.save(); g.translate(px, py); g.rotate(angle); blackDrum(g, dw, dh); g.restore();
    // Crude only ever falls: once the pool reaches the mouth the stream simply enters it there.
    if (flow > 0 && base > mouth.y + 2) {
      const thick = (3.2 * glug + 1) * flow;
      pourStream(g, mouth.x, mouth.y, landX, base, t, thick, "#0d0804", "rgba(255,236,200,.5)");
      g.fillStyle = "#0d0804"; g.beginPath(); g.ellipse(mouth.x, mouth.y, thick * 1.1, thick * .8, 0, 0, TAU); g.fill();
    }
    // The match, tossed in from above, tumbling as it falls.
    if (fire && s >= THROW && s < IGNITE) {
      const p = (s - THROW) / (IGNITE - THROW), x0 = w * .82, y0 = -h * .1, y1 = surfaceY(fireX);
      const mx = x0 + (fireX - x0) * p, my = y0 + (y1 - y0) * p * p - Math.sin(p * Math.PI) * h * .08;
      drawMatch(g, mx, my, h * .3, .5 - p * 2.6, t);
    }
    // Smoke rolls up over everything and thins out; it all clears once the fire is out.
    const clear = !fire || s < OUT ? 1 : 1 - clamp((s - OUT) / 1.6);
    for (let i = smoke.length - 1; i >= 0; i--) {
      const p = smoke[i]; p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx += Math.sin(p.age * 2 + i) * 4 * dt;
      if (p.age > p.life || clear <= 0) { smoke.splice(i, 1); continue; }
      const a = p.age / p.life, r = p.r * (1 + a * 3.2), alpha = Math.sin(Math.PI * Math.min(1, a * 1.3 + .05)) * .55 * clear;
      const puff = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      puff.addColorStop(0, `rgba(38,34,33,${alpha})`); puff.addColorStop(.55, `rgba(60,55,52,${alpha * .6})`); puff.addColorStop(1, "rgba(80,74,70,0)");
      g.fillStyle = puff; g.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    }
  };
}

/* Gold: a minted bar, ray-traced once under studio lights and cached; it melts away from
 * one end into a pool that fills the cell to 70%. */
type V3 = [number, number, number];
const dot = (a:V3, b:V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a:V3):V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
// The bar (x length, y up, z toward the viewer): a wide foot tapering to a smaller top.
const BAR:V3[] = [[-1, 0, -.48], [1, 0, -.48], [1, 0, .48], [-1, 0, .48], [-.8, .32, -.3], [.8, .32, -.3], [.8, .32, .3], [-.8, .32, .3]];
const BAR_PLANES:[V3, number][] = [[[0, -1, 0], 0], [[0, 1, 0], .32], [[0, .5625, 1], .48], [[0, .5625, -1], .48], [[1, .625, 0], 1], [[-1, .625, 0], 1]];
const BAR_UNIT = BAR_PLANES.map(([n]) => norm(n));
// Seen three-quarters on from above, so the right end (where it melts) faces the viewer.
const YAW_C = Math.cos(-.42), YAW_S = Math.sin(-.42), TILT_C = Math.cos(.74), TILT_S = Math.sin(.74);
const toView = ([x, y, z]:V3):V3 => [x * YAW_C + z * YAW_S, y, -x * YAW_S + z * YAW_C];
const toBar = ([x, y, z]:V3):V3 => [x * YAW_C - z * YAW_S, y, x * YAW_S + z * YAW_C];
const VIEW:V3 = [0, TILT_S, TILT_C], SCREEN_UP:V3 = [0, -TILT_C, TILT_S];
const flatOf = (p:V3) => { const r = toView(p); return [r[0], -r[1] * TILT_C + r[2] * TILT_S]; };
const BAR_FLAT = BAR.map(flatOf);
const FLAT_CX = (Math.min(...BAR_FLAT.map(p => p[0])) + Math.max(...BAR_FLAT.map(p => p[0]))) / 2, FLAT_MAXY = Math.max(...BAR_FLAT.map(p => p[1]));
/** Bar coordinates → canvas, for a bar fitted into the box (x, y, iw, ih). */
function barLayout(x:number, y:number, iw:number, ih:number) {
  const k = Math.min(iw / 2.3, ih / 1.15);
  return { k, at:(p:V3) => { const [a, b] = flatOf(p); return [x + iw / 2 + (a - FLAT_CX) * k, y + ih - (FLAT_MAXY - b) * k] as [number, number]; } };
}
const KEY = norm([-.5, .75, .45]);
/** One ray against the bar: [r, g, b] in 0…1, or null on a miss. Edges are rounded by bending the normal. */
function traceBar(u:number, v:number, hot:boolean):V3 | null {
  const o = toBar([u, v * SCREEN_UP[1] + 5 * VIEW[1], v * SCREEN_UP[2] + 5 * VIEW[2]]), d = toBar([0, -VIEW[1], -VIEW[2]]);
  let near = -Infinity, far = Infinity, hit = -1;
  for (let i = 0; i < BAR_PLANES.length; i++) {
    const [n, c] = BAR_PLANES[i], den = dot(n, d), num = c - dot(n, o);
    if (Math.abs(den) < 1e-9) { if (num < 0) return null; continue; }
    const t = num / den;
    if (den < 0) { if (t > near) { near = t; hit = i; } } else if (t < far) far = t;
  }
  if (hit < 0 || near > far) return null;
  const p:V3 = [o[0] + d[0] * near, o[1] + d[1] * near, o[2] + d[2] * near];
  let n:V3 = [...BAR_UNIT[hit]];
  for (let i = 0; i < BAR_PLANES.length; i++) {
    if (i === hit) continue;
    const [m, c] = BAR_PLANES[i], gap = (c - dot(m, p)) / Math.hypot(...m);
    if (gap < .045) { const w = (1 - gap / .045) ** 2 * 1.4; n = [n[0] + BAR_UNIT[i][0] * w, n[1] + BAR_UNIT[i][1] * w, n[2] + BAR_UNIT[i][2] * w]; }
  }
  n = norm(toView(n));
  const nv = Math.max(0, dot(n, VIEW)), r:V3 = [2 * nv * n[0] - VIEW[0], 2 * nv * n[1] - VIEW[1], 2 * nv * n[2] - VIEW[2]];
  // Studio: a big softbox overhead, a tall strip light on the right, a dark horizon, a warm floor.
  const env = .05 + ease(clamp((r[1] - .1) / .55)) + ease(clamp((r[0] - .5) / .3)) * .75 * (r[1] > -.15 ? 1 : .3)
    + clamp((r[2] - .75) / .25) * .3 + (r[1] < -.25 ? .2 : 0);
  const spec = Math.max(0, dot(r, KEY)) ** 90 * 2.2, fres = (1 - nv) ** 5 * .5;
  const gold:V3 = [Math.min(1, env * 1.02 + spec + fres * env), Math.min(1, env * .76 + spec + fres * env), Math.min(1, env * .31 + spec * .9 + fres * env * .8)];
  return hot ? [Math.min(1, .95 + gold[0] * .05), Math.min(1, .38 + env * .3 + spec), Math.min(1, .05 + env * .08 + spec * .7)] : gold;
}
/** The engraved refinery stamp pressed into the top face, drawn in that face's own plane. */
function barStamp(g:CanvasRenderingContext2D, at:(p:V3) => [number, number], hot:boolean) {
  const o = at(BAR[4]), a = at(BAR[5]), b = at(BAR[7]);
  g.save(); g.transform((a[0] - o[0]) / 100, (a[1] - o[1]) / 100, (b[0] - o[0]) / 40, (b[1] - o[1]) / 40, o[0], o[1]);
  const ink = hot ? "rgba(150,40,0," : "rgba(96,52,0,", shine = hot ? "rgba(255,226,150," : "rgba(255,246,210,";
  const well = g.createLinearGradient(0, 5, 0, 35);
  well.addColorStop(0, `${ink}.30)`); well.addColorStop(1, `${ink}.10)`);
  g.fillStyle = well; roundRect(g, 12, 5, 76, 30, 4); g.fill();
  // Sunk well: shadowed on the far edges, lit on the near ones.
  g.lineWidth = 1.4; g.strokeStyle = `${ink}.65)`; g.beginPath(); g.moveTo(12.5, 33); g.lineTo(12.5, 9); g.arcTo(12.5, 5.5, 16, 5.5, 3.5); g.lineTo(87.5, 5.5); g.stroke();
  g.strokeStyle = `${shine}.9)`; g.beginPath(); g.moveTo(87.5, 8); g.lineTo(87.5, 31); g.arcTo(87.5, 34.5, 84, 34.5, 3.5); g.lineTo(13, 34.5); g.stroke();
  g.textAlign = "center"; g.textBaseline = "middle";
  const engrave = (text:string, ty:number, size:number, weight = 700) => {
    g.font = `${weight} ${size}px Georgia, "Times New Roman", serif`;
    g.fillStyle = `${shine}.85)`; g.fillText(text, 50.5, ty + .8);
    g.fillStyle = `${ink}.9)`; g.fillText(text, 50, ty);
  };
  engrave("FINE GOLD", 11.5, 6.4); engrave("999.9", 21, 13); engrave("1 KILO", 30, 5.6, 600);
  g.restore();
}
type BarArt = { key:string; cold:HTMLCanvasElement; hot:HTMLCanvasElement; mask:HTMLCanvasElement };
let barArt:BarArt | null = null;
/** Renders the bar (cold and white-hot) once per size; edges get 4× supersampling. */
function barImages(iw:number, ih:number, dpr:number):BarArt {
  const pw = Math.max(1, Math.round(iw * dpr)), ph = Math.max(1, Math.round(ih * dpr)), key = `${pw}x${ph}`;
  if (barArt?.key === key) return barArt;
  const { k } = barLayout(0, 0, iw, ih);
  const toU = (px:number) => (px / dpr - iw / 2) / k + FLAT_CX, toV = (py:number) => FLAT_MAXY - (ih - py / dpr) / k;
  const make = () => { const c = document.createElement("canvas"); c.width = pw; c.height = ph; return c; };
  const out:BarArt = { key, cold:make(), hot:make(), mask:make() };
  for (const hot of [false, true]) {
    const ctx = (hot ? out.hot : out.cold).getContext("2d")!, img = ctx.createImageData(pw, ph), px = img.data;
    const centre = new Uint8Array(pw * ph);
    for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++) centre[j * pw + i] = traceBar(toU(i + .5), toV(j + .5), hot) ? 1 : 0;
    for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++) {
      const at = j * pw + i, c = centre[at];
      const edge = i > 0 && i < pw - 1 && j > 0 && j < ph - 1 ? centre[at - 1] !== c || centre[at + 1] !== c || centre[at - pw] !== c || centre[at + pw] !== c : c === 1;
      const offs = edge ? [[.25, .25], [.75, .25], [.25, .75], [.75, .75]] : [[.5, .5]];
      let r = 0, gg = 0, b = 0, n = 0;
      for (const [dx, dy] of offs) { const s = traceBar(toU(i + dx), toV(j + dy), hot); if (s) { r += s[0]; gg += s[1]; b += s[2]; n++; } }
      if (!n) continue;
      // A whisper of grain so the metal does not look airbrushed.
      const grain = 1 + (((i * 73856093 ^ j * 19349663) >>> 0) % 1000 / 1000 - .5) * .035;
      px[at * 4] = Math.min(255, r / n * 255 * grain); px[at * 4 + 1] = Math.min(255, gg / n * 255 * grain); px[at * 4 + 2] = Math.min(255, b / n * 255 * grain); px[at * 4 + 3] = n / offs.length * 255;
    }
    ctx.putImageData(img, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Keep the stamp on the bar's silhouette.
    ctx.globalCompositeOperation = "source-atop"; barStamp(ctx, barLayout(0, 0, iw, ih).at, hot);
  }
  return (barArt = out);
}
/** Cross-section of the bar at length position c (the face a melt front exposes). */
function barSection(c:number):V3[] {
  const yh = Math.min(.32, .32 * (1 - Math.abs(c)) / .2), zt = .48 - .5625 * yh;
  return [[c, 0, .48], [c, 0, -.48], [c, yh, -zt], [c, yh, zt]];
}
function hull(pts:[number, number][]) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cross = (o:number[], a:number[], b:number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo:[number, number][] = [], hi:[number, number][] = [];
  for (const q of p) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
/** The bar with everything right of `cut` (−1…1) melted away; the region near the front glows hot. */
function drawIngot(g:CanvasRenderingContext2D, x:number, y:number, iw:number, ih:number, cut:number, heat:number, alpha:number) {
  const dpr = g.getTransform().a || 1, art = barImages(iw, ih, dpr), { k, at } = barLayout(x, y, iw, ih);
  const poly = (pts:[number, number][]) => { g.beginPath(); pts.forEach(([px, py], i) => i ? g.lineTo(px, py) : g.moveTo(px, py)); g.closePath(); };
  g.save(); g.globalAlpha = alpha;
  // Contact shadow under what is left of the bar.
  const [sx, sy] = at([(cut - 1) / 2, 0, 0]);
  g.save(); g.translate(sx, sy + k * .02); g.scale((cut + 1.3) / 2.3, .2);
  const shade = g.createRadialGradient(0, 0, 0, 0, 0, k * 1.3);
  shade.addColorStop(0, "rgba(30,14,0,.6)"); shade.addColorStop(1, "rgba(30,14,0,0)");
  g.fillStyle = shade; g.fillRect(-k * 1.3, -k * 1.3, k * 2.6, k * 2.6); g.restore();
  const section = barSection(cut).map(at);
  g.save();
  if (cut < .999) { poly(hull([...BAR.filter(p => p[0] <= cut).map(at), ...section])); g.clip(); }
  g.drawImage(art.cold, x, y, iw, ih);
  if (heat > 0) {
    // White-hot near the melt front, fading back along the bar.
    const m = art.mask.getContext("2d")!;
    m.setTransform(1, 0, 0, 1, 0, 0); m.globalCompositeOperation = "copy";
    m.drawImage(art.hot, 0, 0);
    const local = barLayout(0, 0, iw, ih).at, a = local([cut - .55, .16, 0]), b = local([cut, .16, 0]);
    const fade = m.createLinearGradient(a[0] * dpr, a[1] * dpr, b[0] * dpr, b[1] * dpr);
    fade.addColorStop(0, "rgba(0,0,0,0)"); fade.addColorStop(1, `rgba(0,0,0,${heat})`);
    m.globalCompositeOperation = "destination-in"; m.fillStyle = fade; m.fillRect(0, 0, art.mask.width, art.mask.height);
    g.drawImage(art.mask, x, y, iw, ih);
  }
  g.restore();
  if (cut < .999) {
    // The exposed molten face.
    const [b0, b1, t1, t0] = section, top = [(t0[0] + t1[0]) / 2, (t0[1] + t1[1]) / 2], bot = [(b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2];
    const face = g.createLinearGradient(top[0], top[1], bot[0], bot[1]);
    face.addColorStop(0, "#fff0b0"); face.addColorStop(.35, "#ffbe4a"); face.addColorStop(1, "#d2560c");
    g.fillStyle = face; poly(section); g.fill();
    g.strokeStyle = "rgba(255,250,225,.9)"; g.lineWidth = Math.max(.6, k * .02); g.beginPath(); g.moveTo(t0[0], t0[1]); g.lineTo(t1[0], t1[1]); g.stroke();
  }
  g.restore();
  return { at, section };
}
function createGold():Draw {
  // Seconds: melt 1.8–8.1, fill 2.1–8.6, hold full 5 s, drain 13.6–16 while the next bar forms.
  const CYCLE = 16, FULL = 8.58, DRAIN = FULL + 5, REFORM = 13.92;
  let surface:Surface | null = null;
  // Sticky strands hang from the melt front, stretch, neck and let go as falling drops.
  const strands:{ f:number; len:number; v:number; r:number; max:number; x:number; y:number }[] = [];
  const drips:(Drop & { tail:number })[] = [], splashes:Drop[] = [];
  return (g, w, h, t) => {
    const n = Math.max(14, Math.round(w / 5));
    if (!surface || surface.n !== n) surface = new Surface(n, .022, .03, .11);
    const s = t % CYCLE;
    const melt = s < 1.82 ? 0 : s < 8.06 ? ease((s - 1.82) / 6.24) : 1;   // 0 solid → 1 gone
    const reform = s < REFORM ? 0 : ease((s - REFORM) / (CYCLE - REFORM)); // the next bar appears
    const level = s < 2.08 ? 0 : s < FULL ? ease((s - 2.08) / (FULL - 2.08)) : s < DRAIN ? 1 : 1 - ease((s - DRAIN) / (CYCLE - DRAIN));
    const base = h - level * h * .7;
    const iw = Math.min(w * .42, h * 1.05), ih = iw * .5, ix = w - iw - 6, floor = h * .5;
    const melting = s < REFORM, cut = melting ? 1 - melt * 2 : 1, shown = melting ? melt < .995 : reform > .01;
    if (shown) {
      // It melts away from the right end, a sliver at a time; the next bar rises in place.
      const lift = melting ? 0 : (1 - reform) * ih * .25;
      const { at, section } = drawIngot(g, ix, floor - ih + lift, iw, ih, cut, melting ? clamp(melt * 10) : 0, melting ? 1 : reform);
      // One glint only, on the top's far edge, staying on what is left of the bar.
      const [gx, gy] = at([Math.min(.4, cut - .25), .32, -.3]), pulse = .5 + .5 * Math.sin(t * 2.4);
      star(g, gx, gy, ih * .32, pulse * pulse * (melting ? 1 - melt : reform));
      if (melting && melt > .01) {
        const [a, b] = section, anchor = (f:number) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        if (strands.length < 6 && Math.random() < .09) strands.push({ f:Math.random() * .8, len:0, v:3 + Math.random() * 4, r:1.3 + Math.random() * .8, max:ih * (.28 + Math.random() * .4), x:0, y:0 });
        // Small beads also roll off the edge between the strands.
        if (Math.random() < .14) { const [x0, y0] = anchor(Math.random()); drips.push({ x:x0, y:y0, vx:0, vy:10, r:1 + Math.random() * .9, tail:4 }); }
        for (let i = strands.length - 1; i >= 0; i--) {
          const st = strands[i], [x0, y0] = anchor(st.f);
          st.x = x0; st.y = y0;
          // Slow at first, then the weight of the bead pulls it out faster.
          st.v += (6 + st.len * .9) / 60; st.len += st.v / 60; st.r = Math.min(3.2, st.r + .012);
          if (st.len > st.max) {
            drips.push({ x:x0, y:y0 + st.len, vx:0, vy:st.v * 2, r:st.r, tail:st.len * .7 });
            // The thread snaps back up into a short stub, which starts a new strand.
            Object.assign(st, { len:st.len * .18, v:1 + Math.random() * 2, r:1.2 + Math.random() * .6, max:ih * (.28 + Math.random() * .4) });
          }
          const r = st.r, len = st.len, neck = Math.max(.35, r * (.9 - Math.min(.6, len / st.max * .7)));
          const body = g.createLinearGradient(x0, y0, x0, y0 + len + r);
          body.addColorStop(0, "#e9871a"); body.addColorStop(.6, "#ffb83a"); body.addColorStop(1, "#ffd76a");
          g.fillStyle = body; g.beginPath();
          g.moveTo(x0 - r * 1.3, y0);
          g.bezierCurveTo(x0 - r * .5, y0 + len * .25, x0 - neck, y0 + len * .55, x0 - neck, y0 + len - r * .9);
          g.arc(x0, y0 + len, r, Math.PI + .35, -.35 + TAU, true);
          g.bezierCurveTo(x0 + neck, y0 + len * .55, x0 + r * .5, y0 + len * .25, x0 + r * 1.3, y0);
          g.closePath(); g.fill();
          g.fillStyle = "rgba(255,250,225,.85)"; g.beginPath(); g.arc(x0 - r * .35, y0 + len - r * .3, r * .32, 0, TAU); g.fill();
          g.strokeStyle = "rgba(255,240,190,.55)"; g.lineWidth = Math.max(.4, neck * .35); g.beginPath(); g.moveTo(x0 - r * .5, y0 + 1); g.quadraticCurveTo(x0 - neck * .6, y0 + len * .5, x0 - neck * .4, y0 + len - r); g.stroke();
        }
      }
    }
    // Once the bar has gone the last strands let go.
    if (!melting || melt >= .995) { for (const st of strands) drips.push({ x:st.x, y:st.y + st.len, vx:0, vy:st.v, r:st.r, tail:st.len * .5 }); strands.length = 0; }
    for (let i = drips.length - 1; i >= 0; i--) {
      const d = drips[i]; d.vy += 8; d.y += d.vy / 60;
      if (d.y >= base) { surface.poke(d.x / w, 2.6, 1); splash(splashes, d.x, base, 2, 45); drips.splice(i, 1); continue; }
      // A falling bead trails a thinning thread of molten gold.
      d.tail = Math.max(0, d.tail - .25);
      if (d.tail > .5) {
        const tail = g.createLinearGradient(d.x, d.y - d.tail, d.x, d.y);
        tail.addColorStop(0, "rgba(255,190,60,0)"); tail.addColorStop(1, "#ffbf3c");
        g.strokeStyle = tail; g.lineWidth = Math.max(.5, d.r * .45); g.beginPath(); g.moveTo(d.x, d.y - d.tail - d.r); g.lineTo(d.x, d.y); g.stroke();
      }
      g.fillStyle = "#ffbf3c"; g.beginPath(); g.ellipse(d.x, d.y, d.r, d.r * (1 + Math.min(1.6, d.vy / 120)), 0, 0, TAU); g.fill();
      g.fillStyle = "rgba(255,248,220,.8)"; g.beginPath(); g.arc(d.x - d.r * .3, d.y - d.r * .3, d.r * .35, 0, TAU); g.fill();
    }
    surface.step(t);
    if (level > 0) {
      g.save(); g.beginPath();
      const pts = surface.path(g, w, base, x => Math.sin(x * .045 + t * 1.3) * .9 + Math.sin(x * .13 - t * 2.1) * .3);
      g.lineTo(w, h); g.lineTo(0, h); g.closePath();
      const molten = g.createLinearGradient(0, base - 3, 0, h);
      molten.addColorStop(0, "#fff4b8"); molten.addColorStop(.06, "#ffd552"); molten.addColorStop(.4, "#f39a1c"); molten.addColorStop(1, "#7a3204");
      g.fillStyle = molten; g.fill(); g.clip();
      g.globalCompositeOperation = "multiply";
      for (let i = 0; i < 8; i++) {
        const x = ((t * (6 + i * 2.3) + i * 41) % (w + 60)) - 30, y = base + 4 + ((i * 11) % Math.max(4, h - base - 4));
        g.fillStyle = "rgba(200,120,45,.32)"; g.beginPath(); g.ellipse(x, y, 16 + i * 2, 2.2, Math.sin(t * .4 + i) * .2, 0, TAU); g.fill();
      }
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < 7; i++) {
        const x = ((t * (11 + i * 4) + i * 53) % (w + 40)) - 20, y = base + 6 + ((i * 15) % Math.max(4, h - base - 6));
        glow(g, x, y, 13 + i * 2.5, "rgba(255,228,150,.3)");
      }
      g.restore();
      g.lineCap = "round";
      surfaceLight(g, pts, slope => `rgba(255,252,225,${clamp(.35 - slope * 1.1, .08, .95)})`, 1.6);
      // Dazzle: a pulsing bloom over the surface, glints riding it and glitter in the melt.
      g.save(); g.globalCompositeOperation = "lighter";
      const pulse = .75 + .25 * Math.sin(t * 3.1);
      const bloom = g.createLinearGradient(0, base - h * .18, 0, base + 6);
      bloom.addColorStop(0, "rgba(255,220,120,0)"); bloom.addColorStop(.8, `rgba(255,230,150,${.28 * pulse})`); bloom.addColorStop(1, `rgba(255,250,220,${.45 * pulse})`);
      g.fillStyle = bloom; g.fillRect(0, base - h * .18, w, h * .18 + 6);
      for (let i = 0; i < 6; i++) {
        const u = ((t * (.07 + i * .023) + i * .17) % 1), k = Math.min(pts.length - 1, Math.floor(u * pts.length));
        const twinkle = Math.max(0, Math.sin(t * (5 + i) + i * 2.1));
        star(g, pts[k][0], pts[k][1] + 1, 5 + (i % 3) * 2.5, twinkle ** 2);
      }
      for (let i = 0; i < 36; i++) {
        const gx = (i * 73.13 + Math.sin(i) * 40) % w, gy = base + 4 + ((i * 29.7) % Math.max(6, h - base - 6));
        const tw = Math.sin(t * (3 + (i % 5)) + i * 1.9);
        if (tw > .55) { glow(g, gx, gy, 3.2, `rgba(255,255,235,${(tw - .55) * 2})`); if (tw > .93) star(g, gx, gy, 4.5, (tw - .93) * 14); }
      }
      g.restore();
    }
    stepDrops(g, splashes, () => base, "#ffc84a");
  };
}

/* ── Silver: a fine chain with set stones and a drop pendant, turning in the light ── */
function diamond(g:CanvasRenderingContext2D, x:number, y:number, r:number, t:number, seed:number) {
  const facets = 8;
  for (let i = 0; i < facets; i++) {
    const a0 = i / facets * TAU + seed, a1 = (i + 1) / facets * TAU + seed, light = .55 + .45 * Math.sin(t * 3 + i * 1.3 + seed);
    g.fillStyle = `hsl(210, 30%, ${55 + light * 40}%)`;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a0) * r, y + Math.sin(a0) * r); g.lineTo(x + Math.cos(a1) * r, y + Math.sin(a1) * r); g.closePath(); g.fill();
  }
  g.strokeStyle = "#e9eef5"; g.lineWidth = Math.max(.4, r * .18); g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
}
const drawSilver:Draw = (g, w, h, t) => {
  // Hung from the clasp and swinging like a pendulum ride, ±30°.
  const cx = w / 2, cy = h * .24, R = Math.min(w * .34, h * .4), spin = 0, tilt = .58, sag = h * .18;
  const swing = Math.sin(t * 1.9) * 30 * Math.PI / 180, pivotY = cy - R * tilt;
  g.save(); g.translate(cx, pivotY); g.rotate(swing); g.translate(-cx, -pivotY);
  glow(g, cx, cy + sag * .6, R * 1.1, "rgba(200,215,240,.14)");
  type Item = { x:number; y:number; z:number; kind:"link" | "stone"; u:number };
  const items:Item[] = [];
  const at = (u:number) => {
    // u: position round the necklace (0 = front centre). It hangs lowest at the front.
    const a = u + spin, x = cx + Math.sin(a) * R, z = Math.cos(a);
    const y = cy + z * R * tilt + sag * (Math.cos(u) * .5 + .5) ** 1.6;
    return { x, y, z };
  };
  const links = 64;
  for (let i = 0; i < links; i++) { const u = i / links * TAU - Math.PI; items.push({ ...at(u), kind:"link", u }); }
  for (const u of [-.55, -.32, -.14, .14, .32, .55]) items.push({ ...at(u), kind:"stone", u });
  items.sort((a, b) => a.z - b.z);
  const frontPoint = at(0);
  for (const it of items) {
    const depth = .5 + it.z * .5;
    g.globalAlpha = .45 + depth * .55;
    if (it.kind === "link") {
      // Cable chain: alternating flat and edge-on oval links.
      const flat = Math.round((it.u + Math.PI) / TAU * links) % 2 === 0, s = 1.3 + depth * .9;
      g.strokeStyle = `hsl(215, 12%, ${55 + depth * 35}%)`; g.lineWidth = .7;
      g.beginPath(); g.ellipse(it.x, it.y, flat ? s : s * .45, flat ? s * .65 : s * .8, 0, 0, TAU); g.stroke();
    } else diamond(g, it.x, it.y, 1.8 + depth * 1.6, t, it.u * 7);
    g.globalAlpha = 1;
  }
  // Pendant: a bail, a halo of small stones and a pear-shaped centre stone.
  if (frontPoint.z > -.2) {
    const px = frontPoint.x, py = frontPoint.y + 3, pr = Math.min(w, h) * .11 * (.8 + frontPoint.z * .2);
    g.strokeStyle = "#dfe6ef"; g.lineWidth = .9; g.beginPath(); g.moveTo(frontPoint.x, frontPoint.y); g.lineTo(px, py); g.stroke();
    const drop = (scale:number) => { g.beginPath(); g.moveTo(px, py); g.bezierCurveTo(px + pr * scale, py + pr * .5 * scale, px + pr * .9 * scale, py + pr * 1.9 * scale, px, py + pr * 2 * scale); g.bezierCurveTo(px - pr * .9 * scale, py + pr * 1.9 * scale, px - pr * scale, py + pr * .5 * scale, px, py); };
    drop(1.25); g.fillStyle = "#cfd8e4"; g.fill();
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI + Math.PI * .05; diamond(g, px + Math.cos(a) * pr * 1.05, py + pr * 1.3 + Math.sin(a) * pr * .95, pr * .17, t, i); }
    drop(1);
    const stone = g.createLinearGradient(px - pr, py, px + pr, py + pr * 2);
    stone.addColorStop(0, "#e8f1ff"); stone.addColorStop(.45, "#6f9fe6"); stone.addColorStop(1, "#1e3f86");
    g.fillStyle = stone; g.fill();
    g.strokeStyle = "rgba(255,255,255,.7)"; g.lineWidth = .6; g.stroke();
    g.beginPath(); g.moveTo(px, py + pr * .2); g.lineTo(px - pr * .4, py + pr * 1.2); g.moveTo(px, py + pr * .2); g.lineTo(px + pr * .4, py + pr * 1.2); g.stroke();
    star(g, px - pr * .25, py + pr * .8, pr * 1.6, .55 + .45 * Math.sin(t * 5));
  }
  // Bling: every stone twinkles on its own beat, and light runs along the chain.
  items.filter(it => it.kind === "stone").forEach((it, i) => { const tw = Math.sin(t * (4 + i * .7) + i * 2.3); if (tw > .3) star(g, it.x, it.y, 5 + (i % 2) * 2, (tw - .3) * 1.4); });
  const run = items.filter(it => it.kind === "link");
  for (let k = 0; k < 3; k++) { const it = run[Math.floor(((t * .45 + k / 3) % 1) * run.length)]; if (it && it.z > -.3) star(g, it.x, it.y, 4, .8); }
  g.restore();
};

/** One animation instance per cell: liquids keep their own surface state. */
export const CELL_ART:Record<CellArtKind, { create:(opts:CellOpts) => Draw; fill:boolean }> = {
  "usd-krw":{ create:() => drawBills, fill:false },
  bitcoin:{ create:() => drawBitcoin, fill:false },
  ethereum:{ create:() => drawEthereum, fill:false },
  xrp:{ create:() => drawXrp, fill:false },
  wti:{ create:createOil, fill:true },
  gold:{ create:createGold, fill:true },
  silver:{ create:() => drawSilver, fill:false },
};
