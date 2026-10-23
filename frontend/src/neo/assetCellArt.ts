/** Procedural animations for the "Prices in between" cells. Each draws one frame at
 *  time `t` (seconds) into a context already scaled to CSS pixels (w × h). */
export type CellArtKind = "usd-krw" | "bitcoin" | "ethereum" | "xrp" | "wti" | "gold" | "silver";
type Draw = (g:CanvasRenderingContext2D, w:number, h:number, t:number) => void;

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
// The public-domain obverse of the series 2009 $100 note (US government work, via Wikimedia Commons).
let billImage:HTMLImageElement | null = null;
function bill():HTMLImageElement | null {
  if (!billImage && typeof Image !== "undefined") { billImage = new Image(); billImage.src = "/img/ticker/usd100-obverse.webp"; }
  return billImage?.complete && billImage.naturalWidth ? billImage : null;
}
function noteFace(g:CanvasRenderingContext2D, w:number, h:number, back:boolean) {
  const photo = back ? null : bill();
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
  for (let i = layers; i >= 1; i--) { g.fillStyle = i % 2 ? "#b9c4ac" : "#dbe1cf"; roundRect(g, -bw / 2 + i * .25, -bh / 2 + i * .7, bw, bh, bh * .05); g.fill(); }
  // The note underneath, fully visible once the counted one has gone.
  g.save(); g.translate(-bw / 2, -bh / 2); noteFace(g, bw, bh, false); g.restore();
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
    noteFace(g, bw, bh, false);
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
function createOil():Draw {
  const CYCLE = 14;
  let surface:Surface | null = null;
  return (g, w, h, t) => {
    const n = Math.max(14, Math.round(w / 5));
    if (!surface || surface.n !== n) surface = new Surface(n, .016, .05, .1);
    const p = (t % CYCLE) / CYCLE;
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#fdfcf8"); bg.addColorStop(1, "#ece6d8");
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const tip = p < .08 ? easeOut(p / .08) : p < .8 ? 1 : 1 - ease((p - .8) / .2);
    const level = p < .09 ? 0 : p < .66 ? ease((p - .09) / .57) : p < .8 ? 1 : 1 - ease((p - .8) / .2);
    const base = h - level * h * .6;
    // Standing at the upper right; tipping past horizontal turns its mouth down onto the pool.
    const dh = Math.min(h * .5, w * .32), dw = dh * .68, px = w - 4, py = h * .56, angle = -tip * Math.PI * .6;
    const lx = -dw / 2, ly = -dh, mouth = { x:px + Math.cos(angle) * lx - Math.sin(angle) * ly, y:py + Math.sin(angle) * lx + Math.cos(angle) * ly };
    const flow = p > .07 && p < .7 ? (p < .1 ? (p - .07) / .03 : p > .64 ? (.7 - p) / .06 : 1) : 0;
    const glug = 1 + .35 * Math.sin(t * 13) + .15 * Math.sin(t * 29);
    const landX = Math.max(6, mouth.x - dh * .25);
    if (flow > 0) {
      surface.poke(landX / w, 2.4 * flow * glug, 2);
    }
    if (Math.abs(p - .7) < .003) surface.poke(.35, -3, 7);
    surface.step(t);
    // Pool
    if (level > 0) {
      g.save(); g.beginPath();
      const pts = surface.path(g, w, base, x => Math.sin(x * .05 + t * 1.5) * .8);
      g.lineTo(w, h); g.lineTo(0, h); g.closePath();
      const oil = g.createLinearGradient(0, base - 4, 0, h);
      oil.addColorStop(0, "#4b3720"); oil.addColorStop(.08, "#1f150a"); oil.addColorStop(.5, "#0b0703"); oil.addColorStop(1, "#030201");
      g.fillStyle = oil; g.fill(); g.clip();
      const drift = (t * 16) % (w * 2) - w, slick = g.createLinearGradient(drift, 0, drift + w, 0);
      slick.addColorStop(0, "rgba(90,50,200,0)"); slick.addColorStop(.3, "rgba(110,70,230,.22)"); slick.addColorStop(.5, "rgba(30,190,170,.18)"); slick.addColorStop(.7, "rgba(230,170,40,.16)"); slick.addColorStop(1, "rgba(230,170,40,0)");
      g.fillStyle = slick; g.fillRect(0, base - 6, w, 16);
      // Broad, slow highlights rolling under the glossy surface.
      g.globalCompositeOperation = "lighter";
      for (let i = 0; i < 3; i++) { const x = ((t * (9 + i * 4) + i * 70) % (w + 60)) - 30; glow(g, x, base + 8 + i * 7, 18, "rgba(255,230,190,.07)"); }
      g.restore();
      g.lineCap = "round";
      surfaceLight(g, pts, slope => `rgba(255,248,232,${clamp(.2 - slope * 1, .04, .8)})`, 1.5);
    }
    // Drum in front of the pool.
    g.save(); g.translate(px, py); g.rotate(angle); blackDrum(g, dw, dh); g.restore();
    // Crude only ever falls: once the pool reaches the mouth the stream simply enters it there.
    if (flow > 0 && base > mouth.y + 2) {
      const thick = (3.2 * glug + 1) * flow;
      pourStream(g, mouth.x, mouth.y, landX, base, t, thick, "#0d0804", "rgba(255,236,200,.5)");
      g.fillStyle = "#0d0804"; g.beginPath(); g.ellipse(mouth.x, mouth.y, thick * 1.1, thick * .8, 0, 0, TAU); g.fill();
    }
  };
}

/* Gold: a large ingot glitters, melts away completely and fills the cell to 70%. */
function ingot(g:CanvasRenderingContext2D, x:number, y:number, iw:number, ih:number, t:number, heat:number) {
  // Trapezoid ingot seen from slightly above: top face, front face, side.
  const inset = iw * .14, topH = ih * .32;
  const front = g.createLinearGradient(x, y + topH, x, y + ih);
  front.addColorStop(0, "#ffe27a"); front.addColorStop(.5, `rgb(${235 + heat * 20},${170 - heat * 30},${40})`); front.addColorStop(1, "#a8650c");
  g.fillStyle = front; g.beginPath(); g.moveTo(x, y + ih); g.lineTo(x + inset * .6, y + topH); g.lineTo(x + iw - inset * .6, y + topH); g.lineTo(x + iw, y + ih); g.closePath(); g.fill();
  const top = g.createLinearGradient(x, y, x + iw, y + topH);
  top.addColorStop(0, "#fff8d2"); top.addColorStop(.5, "#ffd659"); top.addColorStop(1, "#e3a52a");
  g.fillStyle = top; g.beginPath(); g.moveTo(x + inset * .6, y + topH); g.lineTo(x + inset, y); g.lineTo(x + iw - inset, y); g.lineTo(x + iw - inset * .6, y + topH); g.closePath(); g.fill();
  g.fillStyle = "rgba(120,70,0,.55)"; g.font = `700 ${ih * .26}px Georgia`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("999.9", x + iw / 2, y + topH + (ih - topH) * .5); g.textAlign = "left";
  // Bling: a sweep of light across the bar.
  g.save(); g.beginPath(); g.moveTo(x, y + ih); g.lineTo(x + inset, y); g.lineTo(x + iw - inset, y); g.lineTo(x + iw, y + ih); g.closePath(); g.clip();
  const sweep = x - iw + ((t * .55) % 1) * iw * 3, band = g.createLinearGradient(sweep - iw * .2, 0, sweep + iw * .2, 0);
  band.addColorStop(0, "rgba(255,255,255,0)"); band.addColorStop(.5, "rgba(255,255,255,.75)"); band.addColorStop(1, "rgba(255,255,255,0)");
  g.globalCompositeOperation = "lighter"; g.fillStyle = band; g.fillRect(x, y, iw, ih); g.restore();
}
function createGold():Draw {
  const CYCLE = 13;
  let surface:Surface | null = null;
  const drips:Drop[] = [], splashes:Drop[] = [];
  return (g, w, h, t) => {
    const n = Math.max(14, Math.round(w / 5));
    if (!surface || surface.n !== n) surface = new Surface(n, .022, .03, .11);
    const p = (t % CYCLE) / CYCLE;
    const melt = p < .14 ? 0 : p < .62 ? ease((p - .14) / .48) : 1;     // 0 solid → 1 gone
    const reform = p < .84 ? 0 : ease((p - .84) / .16);                  // the next bar appears
    const level = p < .16 ? 0 : p < .66 ? ease((p - .16) / .5) : p < .82 ? 1 : 1 - ease((p - .82) / .18);
    const base = h - level * h * .7;
    const iw = Math.min(w * .42, h * 1.05), ih = iw * .42, ix = w - iw - 6, floor = h * .5;
    // Heat glow behind the bar while it melts.
    g.save(); g.globalCompositeOperation = "lighter"; glow(g, ix + iw / 2, floor, iw * 1.1, `rgba(255,150,40,${.08 + melt * .3})`); g.restore();
    const solid = p < .84 ? 1 - melt : reform;
    if (solid > .01) {
      // The bar slumps from the top down and spreads at its foot as it goes.
      const height = ih * solid, spread = (1 - solid) * iw * .25 * (p < .84 ? 1 : 0);
      g.save(); g.globalAlpha = p < .84 ? 1 : reform;
      g.translate(ix - spread / 2, floor - height); g.scale((iw + spread) / iw, Math.max(.05, solid));
      ingot(g, 0, 0, iw, ih, t, melt);
      g.restore();
      // Glints on the corners while it is still a bar.
      if (melt < .3) {
        const s = .5 + .5 * Math.sin(t * 5);
        star(g, ix + iw * .2, floor - height, ih * .55, s * (1 - melt * 3));
        star(g, ix + iw * .85, floor - height * .3, ih * .45, (1 - s) * (1 - melt * 3));
      }
      if (melt > .02 && melt < .98 && Math.random() < .2) drips.push({ x:ix + iw * (.15 + Math.random() * .7), y:floor, vx:0, vy:12, r:1.6 + Math.random() });
    }
    for (let i = drips.length - 1; i >= 0; i--) {
      const d = drips[i]; d.vy += 8; d.y += d.vy / 60;
      if (d.y >= base) { surface.poke(d.x / w, 2.6, 1); splash(splashes, d.x, base, 2, 45); drips.splice(i, 1); continue; }
      g.fillStyle = "#ffbf3c"; g.beginPath(); g.ellipse(d.x, d.y, d.r, d.r * (1 + Math.min(2, d.vy / 110)), 0, 0, TAU); g.fill();
      g.save(); g.globalCompositeOperation = "lighter"; glow(g, d.x, d.y, 6, "rgba(255,180,60,.5)"); g.restore();
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
export const CELL_ART:Record<CellArtKind, { create:() => Draw; fill:boolean }> = {
  "usd-krw":{ create:() => drawBills, fill:false },
  bitcoin:{ create:() => drawBitcoin, fill:false },
  ethereum:{ create:() => drawEthereum, fill:false },
  xrp:{ create:() => drawXrp, fill:false },
  wti:{ create:createOil, fill:true },
  gold:{ create:createGold, fill:true },
  silver:{ create:() => drawSilver, fill:false },
};
