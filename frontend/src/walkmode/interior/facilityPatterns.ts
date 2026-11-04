import * as THREE from "three";

/* Surfaces a building's interior is known by that no scanned set has: a hotel corridor's patterned
 * carpet, an office's carpet tiles laid in alternating pile, damask and grasscloth wallpapers, timber
 * slat walls, stone cladding with its joints, a gallery's coloured plaster. Painted on canvases once
 * a floor (each a seamless tile of a stated physical size), worn over a scanned set's relief and
 * roughness (facilityMaterials.ts), so they take light like the rest. */

export type PatternName = "hotelCarpet" | "carpetTile" | "damask" | "grasscloth" | "woodSlat" | "stonePanel" | "travertine" | "darkStone" | "goldInlay" | "mosaic"
  | "ceilingTile" | "metalStrip" | "vinylSheet" | "epoxy" | "carpetPlank" | "lvtPlank";
/** one repeat's size in metres */
export const PATTERN_SIZE: Record<PatternName, number> = { hotelCarpet: 1.2, carpetTile: 1.0, damask: 0.42, grasscloth: 0.9, woodSlat: 0.6, stonePanel: 2.4, travertine: 1.8, darkStone: 2.4, goldInlay: 2.4, mosaic: 0.6,
  ceilingTile: 1.2, metalStrip: 1.2, vinylSheet: 1.0, epoxy: 2.0, carpetPlank: 1.0, lvtPlank: 1.83 };

const rnd = (seed: number) => { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296; };
const shade = (hex: string, k: number) => { const c = new THREE.Color(hex); if (k >= 0) c.lerp(new THREE.Color("#ffffff"), k); else c.multiplyScalar(1 + k); return `#${c.getHexString()}`; };

/** a tile repeating seamlessly: what is drawn past an edge is drawn again on the other side */
function wrapDraw(g: CanvasRenderingContext2D, S: number, draw: (ox: number, oy: number) => void) {
  for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.save(); g.translate(ox, oy); draw(ox, oy); g.restore(); }
}

/** stone veins: soft wandering lines over a mottled ground */
function veins(g: CanvasRenderingContext2D, S: number, r: () => number, base: string, vein: string, n: number, alpha: number) {
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) { g.fillStyle = r() > 0.5 ? `rgba(255,255,255,${0.02 + r() * 0.04})` : `rgba(0,0,0,${0.015 + r() * 0.03})`; const x = r() * S, y = r() * S, rr = 10 + r() * 60; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill(); }
  const paths: [number, number][][] = [];
  for (let i = 0; i < n; i++) {
    let x = r() * S, y = r() * S, a = r() * Math.PI * 2; const p: [number, number][] = [[x, y]];
    for (let k = 0; k < 40; k++) { a += (r() - 0.5) * 0.7; x += Math.cos(a) * S / 30; y += Math.sin(a) * S / 30; p.push([x, y]); }
    paths.push(p);
  }
  wrapDraw(g, S, () => {
    for (const p of paths) {
      for (const [w, al] of [[5, alpha * 0.25], [1.6, alpha]] as [number, number][]) {
        g.strokeStyle = vein; g.globalAlpha = al; g.lineWidth = w; g.beginPath(); p.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
      }
    }
    g.globalAlpha = 1;
  });
}

export function patternTexture(name: PatternName, colours: string[], seed = 1): THREE.CanvasTexture {
  const S = name === "stonePanel" || name === "darkStone" || name === "goldInlay" || name === "travertine" || name === "ceilingTile" || name === "lvtPlank" || name === "epoxy" ? 1024 : 512;
  const c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d")!, r = rnd(seed * 7919 + name.length * 131);
  const [a, b = shade(a, -0.3), d = shade(a, 0.4)] = colours;
  switch (name) {
    case "hotelCarpet": {
      // (a deep ground, a lattice of medallions and a fine border pattern between, wool flecks over all)
      g.fillStyle = a; g.fillRect(0, 0, S, S);
      wrapDraw(g, S, () => {
        g.strokeStyle = b; g.lineWidth = S * 0.012;
        for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(i * S / 2, 0); g.lineTo(i * S / 2 - S / 2, S / 2); g.lineTo(i * S / 2, S); g.lineTo(i * S / 2 + S / 2, S / 2); g.closePath(); g.stroke(); }
        for (const [x, y] of [[0, 0], [S / 2, S / 2], [S, 0], [0, S], [S, S]]) {
          g.fillStyle = b; g.beginPath(); g.arc(x, y, S * 0.15, 0, Math.PI * 2); g.fill();
          g.fillStyle = d; for (let k = 0; k < 8; k++) { const t = k * Math.PI / 4; g.beginPath(); g.ellipse(x + Math.cos(t) * S * 0.09, y + Math.sin(t) * S * 0.09, S * 0.05, S * 0.02, t, 0, Math.PI * 2); g.fill(); }
          g.fillStyle = a; g.beginPath(); g.arc(x, y, S * 0.045, 0, Math.PI * 2); g.fill();
          g.strokeStyle = d; g.lineWidth = S * 0.006; g.beginPath(); g.arc(x, y, S * 0.165, 0, Math.PI * 2); g.stroke();
        }
        g.fillStyle = d; for (const [x, y] of [[S / 2, 0], [0, S / 2], [S / 2, S], [S, S / 2]]) { g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillRect(-S * 0.03, -S * 0.03, S * 0.06, S * 0.06); g.restore(); }
      });
      for (let i = 0; i < 9000; i++) { g.fillStyle = r() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.07)"; g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2); }
      break;
    }
    case "carpetTile": {
      // (four 500 mm tiles, the pile turned a quarter each, a faint seam)
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        const x0 = i * S / 2, y0 = j * S / 2, turn = (i + j) % 2;
        g.fillStyle = turn ? a : shade(a, -0.06); g.fillRect(x0, y0, S / 2, S / 2);
        g.strokeStyle = turn ? shade(a, 0.08) : shade(a, -0.14); g.lineWidth = 2;
        for (let k = 0; k < 40; k++) { g.beginPath(); const t = y0 + (k + 0.5) * S / 80; if (turn) { g.moveTo(x0, t); g.lineTo(x0 + S / 2, t + (r() - 0.5) * 2); } else { const u = x0 + (k + 0.5) * S / 80; g.moveTo(u, y0); g.lineTo(u + (r() - 0.5) * 2, y0 + S / 2); } g.stroke(); }
        for (let k = 0; k < 1400; k++) { g.fillStyle = r() > 0.6 ? b : d; g.globalAlpha = 0.18; g.fillRect(x0 + r() * S / 2, y0 + r() * S / 2, 2, 2); }
        g.globalAlpha = 1; g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 1.5; g.strokeRect(x0 + 0.75, y0 + 0.75, S / 2 - 1.5, S / 2 - 1.5);
      }
      break;
    }
    case "damask": {
      g.fillStyle = a; g.fillRect(0, 0, S, S);
      // (a silk ground's sheen stripes, the damask's leaves and its central flower, tone on tone)
      for (let i = 0; i < S; i += 3) { g.fillStyle = `rgba(255,255,255,${0.02 + 0.02 * Math.sin(i * 0.3)})`; g.fillRect(i, 0, 1, S); }
      const motif = (x: number, y: number, s: number) => {
        g.save(); g.translate(x, y); g.scale(s, s);
        for (const sx of [-1, 1]) {
          g.save(); g.scale(sx, 1); g.beginPath(); g.moveTo(0, -1); g.bezierCurveTo(0.5, -0.8, 0.6, -0.3, 0.15, -0.1); g.bezierCurveTo(0.7, 0, 0.75, 0.5, 0.2, 0.55); g.bezierCurveTo(0.35, 0.8, 0.15, 0.95, 0, 1); g.lineTo(0, -1); g.fill();
          g.beginPath(); g.moveTo(0.22, -0.55); g.bezierCurveTo(0.6, -0.65, 0.85, -0.35, 0.7, -0.05); g.bezierCurveTo(0.55, -0.3, 0.4, -0.4, 0.22, -0.55); g.fill(); g.restore();
        }
        g.restore();
      };
      wrapDraw(g, S, () => { g.fillStyle = b; motif(S / 2, S / 2, S * 0.3); motif(0, 0, S * 0.3); motif(S, 0, S * 0.3); motif(0, S, S * 0.3); motif(S, S, S * 0.3); g.fillStyle = d; for (const [x, y] of [[0, S / 2], [S, S / 2], [S / 2, 0], [S / 2, S]]) { g.beginPath(); g.arc(x, y, S * 0.04, 0, Math.PI * 2); g.fill(); } });
      break;
    }
    case "grasscloth": {
      g.fillStyle = a; g.fillRect(0, 0, S, S);
      for (let y = 0; y < S; y += 1) { g.fillStyle = r() > 0.5 ? `rgba(255,255,255,${r() * 0.12})` : `rgba(0,0,0,${r() * 0.12})`; g.fillRect(0, y, S, 1); }
      for (let i = 0; i < 300; i++) { g.strokeStyle = r() > 0.5 ? shade(a, 0.25) : shade(a, -0.2); g.globalAlpha = 0.35; g.lineWidth = 1; const y = r() * S, x = r() * S; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 40 + r() * 120, y + (r() - 0.5) * 2); g.stroke(); }
      g.globalAlpha = 1; for (let x = 0; x < S; x += S / 6) { g.fillStyle = "rgba(0,0,0,0.05)"; g.fillRect(x, 0, 2, S); }
      break;
    }
    case "woodSlat": {
      // (five 120 mm slats of oak with dark shadow gaps)
      const n = 5, w = S / n;
      for (let i = 0; i < n; i++) {
        const tone = shade(a, (r() - 0.5) * 0.12); g.fillStyle = tone; g.fillRect(i * w, 0, w, S);
        for (let k = 0; k < 26; k++) { g.strokeStyle = shade(tone, -0.18 - r() * 0.12); g.globalAlpha = 0.35; g.lineWidth = 1 + r() * 1.5; const x = i * w + 6 + r() * (w - 12); g.beginPath(); g.moveTo(x, 0); for (let y = 0; y <= S; y += S / 16) g.lineTo(x + Math.sin(y * 0.02 + k) * 3, y); g.stroke(); }
        g.globalAlpha = 1; g.fillStyle = "#16100b"; g.fillRect(i * w + w - w * 0.16, 0, w * 0.16, S);
        g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect(i * w, 0, 2, S);
      }
      break;
    }
    case "stonePanel": case "darkStone": case "travertine": case "goldInlay": {
      // (large-format slabs — 1.2 m × 0.6 m on the tile — with fine joints; veins wandering across)
      veins(g, S, r, a, b, name === "travertine" ? 4 : 9, name === "darkStone" ? 0.55 : 0.35);
      if (name === "travertine") for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(90,70,40,${0.05 + r() * 0.08})`; g.beginPath(); g.ellipse(r() * S, r() * S, 2 + r() * 10, 1 + r() * 2, 0, 0, Math.PI * 2); g.fill(); }
      const rows = 4, cols = 2;
      g.strokeStyle = name === "goldInlay" ? "#c9a24a" : name === "darkStone" ? "rgba(0,0,0,0.6)" : "rgba(60,50,40,0.32)"; g.lineWidth = name === "goldInlay" ? 5 : 2.5;
      for (let i = 0; i <= rows; i++) { g.beginPath(); g.moveTo(0, i * S / rows); g.lineTo(S, i * S / rows); g.stroke(); }
      for (let j = 0; j < rows; j++) for (let i = 0; i <= cols; i++) { const x = i * S / cols + (j % 2) * S / cols / 2; g.beginPath(); g.moveTo(x % S, j * S / rows); g.lineTo(x % S, (j + 1) * S / rows); g.stroke(); }
      break;
    }
    case "mosaic": {
      const n = 24, w = S / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = [a, b, d][Math.floor(r() * 3)]; g.fillRect(i * w + 1, j * w + 1, w - 2, w - 2); }
      break;
    }
    case "ceilingTile": {
      // 600 mm mineral-fibre tiles in a white T-bar grid (2 × 2 to the repeat): each tile's fissures
      // and pinholes its own, the tiles a hair different in tone, the grid's flange with its shadow
      const t = S / 2;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        const k = (r() - 0.5) * 0.03; g.fillStyle = shade(a, k); g.fillRect(i * t, j * t, t, t);
        for (let n = 0; n < 900; n++) { const x = i * t + r() * t, y = j * t + r() * t; g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.1})`; const w = 1 + r() * 2.2; g.fillRect(x, y, w, w * (0.4 + r() * 0.6)); }
        for (let n = 0; n < 70; n++) { let x = i * t + r() * t, y = j * t + r() * t, ang = r() * Math.PI * 2; g.strokeStyle = `rgba(0,0,0,${0.05 + r() * 0.06})`; g.lineWidth = 1 + r(); g.beginPath(); g.moveTo(x, y); for (let q = 0; q < 4; q++) { ang += (r() - 0.5) * 1.6; x += Math.cos(ang) * 6; y += Math.sin(ang) * 6; g.lineTo(x, y); } g.stroke(); }
      }
      const gw = S * 0.02;
      g.fillStyle = b; for (const v of [0, t, S]) { g.fillRect(v - gw / 2, 0, gw, S); g.fillRect(0, v - gw / 2, S, gw); }
      g.fillStyle = "rgba(0,0,0,0.12)"; for (const v of [0, t, S]) { g.fillRect(v + gw / 2, 0, gw * 0.5, S); g.fillRect(0, v + gw / 2, S, gw * 0.5); }
      break;
    }
    case "metalStrip": {
      // a linear metal strip ceiling: 100 mm panels, 15 mm dark reveals, a faint brushed grain
      const n = 10, w = S / n;
      for (let i = 0; i < n; i++) {
        g.fillStyle = shade(a, (r() - 0.5) * 0.04); g.fillRect(0, i * w, S, w);
        for (let q = 0; q < 50; q++) { g.fillStyle = `rgba(255,255,255,${r() * 0.05})`; g.fillRect(0, i * w + r() * w, S, 1); }
        g.fillStyle = b; g.fillRect(0, i * w + w * 0.86, S, w * 0.14);
      }
      break;
    }
    case "vinylSheet": {
      // a hospital's homogeneous sheet vinyl: a pale ground with directional chips and flecks
      g.fillStyle = a; g.fillRect(0, 0, S, S);
      for (let n = 0; n < 5200; n++) { const x = r() * S, y = r() * S, w = 1 + r() * 4; g.fillStyle = r() > 0.55 ? shade(a, -0.08 - r() * 0.12) : r() > 0.5 ? shade(b, 0.2) : shade(a, 0.12); g.globalAlpha = 0.5 + r() * 0.5; g.fillRect(x, y, w * 2.2, w * 0.8); }
      g.globalAlpha = 1;
      break;
    }
    case "epoxy": {
      // a sealed concrete / epoxy floor: a smooth tone with soft clouding and rare aggregate specks
      g.fillStyle = a; g.fillRect(0, 0, S, S);
      wrapDraw(g, S, () => { for (let n = 0; n < 120; n++) { g.fillStyle = r() > 0.5 ? `rgba(255,255,255,${0.008 + r() * 0.012})` : `rgba(0,0,0,${0.008 + r() * 0.014})`; g.beginPath(); g.arc(r() * S, r() * S, 30 + r() * 140, 0, Math.PI * 2); g.fill(); } });
      for (let n = 0; n < 1500; n++) { g.fillStyle = `rgba(0,0,0,${0.08 + r() * 0.15})`; const w = 1 + r() * 1.6; g.fillRect(r() * S, r() * S, w, w); }
      break;
    }
    case "carpetPlank": {
      // 250 × 1000 mm carpet planks in a herringbone-ish ashlar, loop pile, two tones and a third fleck
      const pw = S / 4;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const flip = (i + j) % 2, x = i * pw, y = j * pw;
        g.fillStyle = flip ? a : b; g.fillRect(x, y, pw, pw);
        for (let n = 0; n < 420; n++) { g.fillStyle = r() > 0.8 ? d : shade(flip ? a : b, (r() - 0.5) * 0.25); const lx = x + r() * pw, ly = y + r() * pw; flip ? g.fillRect(lx, ly, 1.2, 4) : g.fillRect(lx, ly, 4, 1.2); }
        g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, pw - 1, pw - 1);
      }
      break;
    }
    case "lvtPlank": {
      // luxury vinyl plank: 180 mm × 1.2 m boards, staggered, a printed oak grain and bevelled joints
      const rows = 10, h = S / rows;
      for (let j = 0; j < rows; j++) {
        let x = -r() * S * 0.6;
        while (x < S) {
          const L = S * (0.45 + r() * 0.3), tone = shade(a, (r() - 0.5) * 0.18);
          g.fillStyle = tone; g.fillRect(x, j * h, L, h);
          for (let q = 0; q < 26; q++) { g.strokeStyle = `rgba(60,35,15,${0.05 + r() * 0.1})`; g.lineWidth = 1 + r() * 1.5; const yy = j * h + r() * h; g.beginPath(); g.moveTo(x, yy); g.bezierCurveTo(x + L * 0.3, yy + (r() - 0.5) * 6, x + L * 0.6, yy + (r() - 0.5) * 6, x + L, yy + (r() - 0.5) * 4); g.stroke(); }
          g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(x, j * h, 2, h);
          x += L;
        }
        g.fillStyle = "rgba(0,0,0,0.2)"; g.fillRect(0, j * h, S, 1.5);
      }
      break;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 16;
  t.repeat.set(1 / PATTERN_SIZE[name], 1 / PATTERN_SIZE[name]);
  return t;
}
