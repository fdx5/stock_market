/** Ground surfaces painted procedurally, for a canvas on the page or an OffscreenCanvas in a
 * worker (texWorker): asphalt, and block paving (보도블록) in the patterns of Seoul's pavements.
 * No three.js here (the worker stays small). */

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type PaverStyle = "stretcher" | "herringbone" | "slab" | "basket";
export const PAVER_STYLES: PaverStyle[] = ["stretcher", "herringbone", "slab", "basket"];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1_000_000) / 1_000_000; };
}

/** Asphalt, a 4 m tile at S px: dark binder, graded aggregate, soft wear and patching. */
export function paintAsphalt(g: Ctx, S: number, seed = 907) {
  const rnd = rng(seed), k = S / 1024;
  g.fillStyle = "#3b3e43"; g.fillRect(0, 0, S, S);
  for (let n = 0; n < 60; n++) {
    const x = rnd() * S, y = rnd() * S, r = (40 + rnd() * 140) * k, a = 0.03 + rnd() * 0.05, dark = rnd() < 0.5;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      gr.addColorStop(0, dark ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.6})`); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, 2 * r, 2 * r);
    }
  }
  // aggregate: more stones at the finer resolution (each a few millimetres across)
  const count = Math.round(26000 * k * k * (k > 1 ? 0.8 : 1));
  for (let n = 0; n < count; n++) {
    const x = rnd() * S, y = rnd() * S, big = rnd() < 0.08, sz = (big ? 1.6 + rnd() * 1.6 : 0.6 + rnd() * 0.9) * Math.max(1, k * 0.9);
    const v = rnd() < 0.55 ? 85 + rnd() * 60 : 20 + rnd() * 25;
    g.fillStyle = `rgba(${v | 0},${v | 0},${(v + 3) | 0},${(0.35 + rnd() * 0.4).toFixed(2)})`;
    g.fillRect(x, y, sz, sz * (0.7 + rnd() * 0.6));
  }
  if (k > 1) {
    // fine: hairline cracks and tar seals here and there
    g.strokeStyle = "rgba(15,16,18,.55)"; g.lineCap = "round";
    for (let n = 0; n < 7; n++) {
      let x = rnd() * S, y = rnd() * S;
      g.lineWidth = 1 + rnd() * 2.5;
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 14; s++) { x += (rnd() - 0.5) * 60 * k; y += (rnd() - 0.3) * 40 * k; g.lineTo(x, y); }
      g.stroke();
    }
  }
}

/** One block: its own shade, a bevelled edge (lit top-left), speckle. */
function block(g: Ctx, rnd: () => number, x: number, y: number, w: number, h: number, base: [number, number, number], vary: number, j: number) {
  const v = (rnd() - 0.5) * vary, [r0, g0, b0] = base;
  g.fillStyle = `rgb(${(r0 + v) | 0},${(g0 + v * 0.95) | 0},${(b0 + v * 0.9) | 0})`;
  g.fillRect(x + j, y + j, w - 2 * j, h - 2 * j);
  const e = Math.max(1.5, Math.min(w, h) * 0.04);
  g.fillStyle = "rgba(255,255,255,0.11)"; g.fillRect(x + j, y + j, w - 2 * j, e); g.fillRect(x + j, y + j, e, h - 2 * j);
  g.fillStyle = "rgba(0,0,0,0.17)"; g.fillRect(x + j, y + h - j - e, w - 2 * j, e); g.fillRect(x + w - j - e, y + j, e, h - 2 * j);
  // weathering
  g.fillStyle = `rgba(0,0,0,${(rnd() * 0.07).toFixed(3)})`;
  g.fillRect(x + j + rnd() * w * 0.5, y + j + rnd() * h * 0.3, w * 0.35, h * 0.5);
  const n = Math.round((w * h) / 200);
  for (let k = 0; k < n; k++) {
    const sv = rnd() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${sv},${sv},${sv},${(0.05 + rnd() * 0.09).toFixed(3)})`;
    g.fillRect(x + j + rnd() * (w - 2 * j - 2), y + j + rnd() * (h - 2 * j - 2), 1.6, 1.6);
  }
}

/** Block paving, a 2 m tile at S px (u along the pavement, v across it). */
export function paintPaver(g: Ctx, S: number, style: PaverStyle, seed = 71) {
  const rnd = rng(seed + style.length * 131);
  const cm = S / 200;   // px per centimetre
  if (style === "stretcher") {
    // 20 × 10 cm grey concrete blocks in running bond (the common 보도블록)
    g.fillStyle = "#6f6b66"; g.fillRect(0, 0, S, S);
    const bw = 20 * cm, bh = 10 * cm;
    for (let row = 0; row < 20; row++) for (let col = -1; col < 11; col++)
      block(g, rnd, col * bw + (row % 2 ? bw / 2 : 0), row * bh, bw, bh, [160, 158, 152], 34, 3 * cm / 5);
  } else if (style === "herringbone") {
    // 20 × 10 cm clay-red interlocking pavers at 90° herringbone, a mix of reds and a few greys
    g.fillStyle = "#4e3a33"; g.fillRect(0, 0, S, S);
    const u = 10 * cm, tones: [number, number, number][] = [[150, 78, 62], [138, 70, 58], [162, 92, 70], [124, 66, 56], [150, 140, 128]];
    // A pair (a horizontal brick, a vertical one beside it) on the lattice (1, 1), (2, −2) in
    // brick widths: tiles the 2 m square exactly (100 pairs). Each brick drawn in every wrapped
    // copy that reaches the square, with the same shade (its own seed).
    const j = 2.5 * cm / 5;
    for (let i = 0; i < 20; i++) for (let k = 0; k < 5; k++) {
      const x = (((i + 2 * k) * u) % S + S) % S, y = (((i - 2 * k) * u) % S + S) % S;
      const tH = tones[rnd() < 0.08 ? 4 : Math.floor(rnd() * 4)], tV = tones[rnd() < 0.08 ? 4 : Math.floor(rnd() * 4)], sH = rnd() * 1e6, sV = rnd() * 1e6;
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        if (x + ox > S || x + ox + 3 * u < 0 || y + oy > S + u || y + oy + 2 * u < 0) continue;
        block(g, rng(sH), x + ox, y + oy, 2 * u, u, tH, 22, j);
        block(g, rng(sV), x + ox + 2 * u, y + oy - u, u, 2 * u, tV, 22, j);
      }
    }
  } else if (style === "slab") {
    // 40 × 40 cm granite slabs (화강석 판석), light warm grey, dense speckle, half-bond rows
    g.fillStyle = "#8a8782"; g.fillRect(0, 0, S, S);
    const s = 40 * cm;
    for (let row = 0; row < 5; row++) for (let col = -1; col < 6; col++) {
      const x = col * s + (row % 2 ? s / 2 : 0), y = row * s;
      block(g, rnd, x, y, s, s, [196, 192, 184], 18, 2 * cm / 5);
      // granite grains: black mica and pink feldspar
      for (let k = 0; k < 700 * (S / 1024); k++) {
        const c = rnd(), px = x + 2 + rnd() * (s - 4), py = y + 2 + rnd() * (s - 4);
        g.fillStyle = c < 0.5 ? "rgba(30,30,32,.45)" : c < 0.75 ? "rgba(190,150,140,.35)" : "rgba(255,255,255,.35)";
        g.fillRect(px, py, 1.4 + rnd() * 1.6, 1.2 + rnd() * 1.4);
      }
    }
  } else {
    // basket weave: pairs of 20 × 10 cm blocks turned alternately, charcoal and mid grey
    g.fillStyle = "#3e3f41"; g.fillRect(0, 0, S, S);
    const q = 20 * cm;
    for (let row = 0; row < 10; row++) for (let col = 0; col < 10; col++) {
      const x = col * q, y = row * q, flip = (row + col) % 2 === 0, dark = (row * 7 + col * 3) % 5 === 0;
      const base: [number, number, number] = dark ? [96, 98, 100] : [138, 139, 140];
      if (flip) { block(g, rnd, x, y, q, q / 2, base, 20, 2.5 * cm / 5); block(g, rnd, x, y + q / 2, q, q / 2, base, 20, 2.5 * cm / 5); }
      else { block(g, rnd, x, y, q / 2, q, base, 20, 2.5 * cm / 5); block(g, rnd, x + q / 2, y, q / 2, q, base, 20, 2.5 * cm / 5); }
    }
  }
}

/** The tactile guide strip (점자블록): 30 cm yellow blocks with raised bars along the way. A
 * 1 m tile, 30 cm wide (u along, v across). */
export function paintTactile(g: Ctx, S: number) {
  g.fillStyle = "#6a5a10"; g.fillRect(0, 0, S, S);
  const b = S / 10 * 3, rnd = rng(5);
  for (let i = 0; i < 4; i++) {
    const x = i * b - b * 0.33;
    block(g, rnd, x, 0, b, S, [222, 184, 30], 14, S / 200);
    // four raised bars along each block
    for (let k = 0; k < 4; k++) {
      const by = S * (0.12 + k * 0.22), bx = x + b * 0.18, bw = b * 0.64, bh = S * 0.08;
      g.fillStyle = "rgba(255,240,150,.55)"; g.fillRect(bx, by, bw, bh * 0.45);
      g.fillStyle = "rgba(90,70,0,.45)"; g.fillRect(bx, by + bh * 0.55, bw, bh * 0.45);
    }
  }
}
