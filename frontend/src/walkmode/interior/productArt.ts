import type { Product } from "./catalog";

/* Every product's look, painted: a book's cover, a notebook's patterned cover, a cosmetic's label, a
 * snack's bag, a gadget's box, a garment's fabric, a shoe's colourway. `drawFace` paints the face
 * a shelf shows (productDisplay.ts puts it in the floor's product atlas); `productImage` paints the
 * product as a packshot for the shop's menu and the bag (cached data URLs). Code only, no images. */

const FONT = 'Pretendard, "Noto Sans KR", "Malgun Gothic", sans-serif';
type G = CanvasRenderingContext2D;
const rnd = (seed: number) => { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const mix = (a: string, b: string, k: number) => { const p = (s: string) => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) || 0); const A = p(a), B = p(b); return `#${A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, "0")).join("")}`; };
const luma = (c: string) => { const v = parseInt(c.slice(1), 16); return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255; };
const inkOn = (c: string) => luma(c) > 0.62 ? "#1c1c1e" : "#ffffff";
function rr(g: G, x: number, y: number, w: number, h: number, r: number) { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function fitText(g: G, t: string, size: number, max: number, weight = 800, family = FONT) { let s = size; g.font = `${weight} ${s}px ${family}`; while (g.measureText(t).width > max && s > 6) { s -= 1; g.font = `${weight} ${s}px ${family}`; } return s; }
/** text wrapped into lines no wider than max (Korean breaks anywhere, spaces preferred) */
function wrap(g: G, t: string, max: number, lines = 3): string[] {
  const out: string[] = []; let cur = "";
  for (const word of t.split(" ")) { const next = cur ? `${cur} ${word}` : word; if (g.measureText(next).width <= max) cur = next; else { if (cur) out.push(cur); cur = word; } }
  if (cur) out.push(cur); return out.slice(0, lines);
}
const shortName = (p: Product) => p.name.replace(p.brand, "").replace(/[『』]/g, "").trim();

// ------------------------------------------------------------------ patterns (fabric, covers)
function pattern(g: G, kind: string, x: number, y: number, w: number, h: number, a: string, b: string, seed: number) {
  const r = rnd(seed);
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = a; g.fillRect(x, y, w, h);
  const s = Math.max(w, h) / 10;
  if (/스트라이프/.test(kind)) { g.fillStyle = b; for (let i = -h; i < w + h; i += s * 1.4) g.fillRect(x + i, y, s * 0.45, h); }
  else if (/체크/.test(kind)) { g.globalAlpha = 0.45; g.fillStyle = b; for (let i = 0; i < w; i += s * 1.6) g.fillRect(x + i, y, s * 0.6, h); for (let j = 0; j < h; j += s * 1.6) g.fillRect(x, y + j, w, s * 0.6); g.globalAlpha = 1; }
  else if (/도트/.test(kind)) { g.fillStyle = b; for (let i = 0; i < w; i += s) for (let j = 0; j < h; j += s) { g.beginPath(); g.arc(x + i + ((j / s) % 2) * s / 2, y + j, s * 0.18, 0, Math.PI * 2); g.fill(); } }
  else if (/플라워/.test(kind)) { for (let k = 0; k < 14; k++) { const cx = x + r() * w, cy = y + r() * h, rs = s * (0.5 + r() * 0.6); g.fillStyle = b; for (let q = 0; q < 5; q++) { const t = q * Math.PI * 2 / 5; g.beginPath(); g.ellipse(cx + Math.cos(t) * rs * 0.55, cy + Math.sin(t) * rs * 0.55, rs * 0.42, rs * 0.26, t, 0, Math.PI * 2); g.fill(); } g.fillStyle = "#f6d365"; g.beginPath(); g.arc(cx, cy, rs * 0.22, 0, Math.PI * 2); g.fill(); } }
  else if (/지오메트릭/.test(kind)) { for (let k = 0; k < 16; k++) { g.fillStyle = k % 2 ? b : mix(a, "#ffffff", 0.35); g.globalAlpha = 0.8; g.beginPath(); const cx = x + r() * w, cy = y + r() * h, rs = s * (0.6 + r() * 1.4); g.moveTo(cx, cy - rs); g.lineTo(cx + rs, cy + rs * 0.7); g.lineTo(cx - rs, cy + rs * 0.7); g.closePath(); g.fill(); } g.globalAlpha = 1; }
  else if (/로고/.test(kind)) { g.fillStyle = b; g.font = `900 ${s * 1.6}px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("★", x + w / 2, y + h * 0.4); }
  // (the weave: fine cross lines)
  g.globalAlpha = 0.06; g.strokeStyle = "#000"; g.lineWidth = 1;
  for (let i = 0; i < w; i += 3) { g.beginPath(); g.moveTo(x + i, y); g.lineTo(x + i, y + h); g.stroke(); }
  g.globalAlpha = 1; g.restore();
}

// ------------------------------------------------------------------ faces
/** the face a shelf shows, filling x,y,w,h */
export function drawFace(g: G, p: Product, x: number, y: number, w: number, h: number) {
  const r = rnd(p.seed), A = p.color, B = p.color2, I = p.ink;
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.translate(x, y);
  g.textAlign = "center"; g.textBaseline = "middle";
  switch (p.form) {
    case "book": {
      // (the cover: a ground, one of five kinds of art, the title, the author; a spine shadow)
      const art = p.seed % 5, genre = p.desc.split(" · ")[0], author = p.desc.split(" · ")[1] ?? "";
      const bg = g.createLinearGradient(0, 0, w, h); bg.addColorStop(0, mix(A, "#ffffff", 0.08)); bg.addColorStop(1, mix(A, "#000000", 0.2)); g.fillStyle = bg; g.fillRect(0, 0, w, h);
      if (art === 0) { g.fillStyle = B; g.beginPath(); g.arc(w * 0.5, h * 0.55, w * 0.28, 0, Math.PI * 2); g.fill(); g.fillStyle = mix(A, "#000000", 0.35); g.fillRect(0, h * 0.62, w, h * 0.38); g.fillStyle = mix(B, "#000", 0.3); for (let i = 0; i < 4; i++) g.fillRect(w * (0.1 + i * 0.22), h * (0.66 + (i % 2) * 0.04), w * 0.14, h * 0.02); }
      else if (art === 1) { g.fillStyle = B; for (let i = 0; i < 6; i++) { g.globalAlpha = 0.25 + i * 0.1; g.beginPath(); g.moveTo(0, h * (0.35 + i * 0.1)); g.quadraticCurveTo(w * 0.5, h * (0.25 + i * 0.1), w, h * (0.4 + i * 0.1)); g.lineTo(w, h); g.lineTo(0, h); g.fill(); } g.globalAlpha = 1; }
      else if (art === 2) { for (let i = 0; i < 9; i++) { g.fillStyle = i % 2 ? B : mix(A, "#ffffff", 0.3); g.globalAlpha = 0.85; g.beginPath(); const cx = r() * w, cy = h * (0.35 + r() * 0.45), s = w * (0.12 + r() * 0.2); g.moveTo(cx, cy - s); g.lineTo(cx + s, cy + s * 0.8); g.lineTo(cx - s, cy + s * 0.8); g.fill(); } g.globalAlpha = 1; }
      else if (art === 3) { g.fillStyle = mix(B, "#ffffff", 0.2); rr(g, w * 0.16, h * 0.34, w * 0.68, h * 0.42, w * 0.04); g.fill(); g.fillStyle = A; g.beginPath(); g.arc(w * 0.5, h * 0.52, w * 0.14, 0, Math.PI * 2); g.fill(); g.fillStyle = B; g.fillRect(w * 0.16, h * 0.68, w * 0.68, h * 0.08); }
      else { g.fillStyle = B; g.fillRect(w * 0.08, h * 0.08, w * 0.04, h * 0.84); g.globalAlpha = 0.18; g.fillStyle = I; g.font = `900 ${h * 0.5}px ${FONT}`; g.fillText([...shortName(p)][0] ?? "", w * 0.55, h * 0.58); g.globalAlpha = 1; }
      // title
      const title = shortName(p); g.fillStyle = art === 3 ? inkOn(A) : I;
      g.font = `900 ${w * 0.13}px ${FONT}`; const ls = wrap(g, title, w * 0.8, 3);
      const s = fitText(g, ls.reduce((a, b) => (a.length > b.length ? a : b), ""), w * 0.13, w * 0.8, 900);
      ls.forEach((t, i) => g.fillText(t, w / 2, h * 0.14 + i * s * 1.2));
      g.font = `600 ${w * 0.06}px ${FONT}`; g.globalAlpha = 0.85; g.fillText(author, w / 2, h * 0.9); g.globalAlpha = 0.6; g.font = `700 ${w * 0.045}px ${FONT}`; g.fillText(`${genre} · ${p.brand}`, w / 2, h * 0.96); g.globalAlpha = 1;
      const sp = g.createLinearGradient(0, 0, w * 0.08, 0); sp.addColorStop(0, "rgba(0,0,0,.35)"); sp.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = sp; g.fillRect(0, 0, w * 0.08, h);
      break;
    }
    case "notebook": {
      pattern(g, p.desc, 0, 0, w, h, A, B, p.seed);
      g.fillStyle = "rgba(255,255,255,.92)"; rr(g, w * 0.18, h * 0.38, w * 0.64, h * 0.24, w * 0.03); g.fill();
      g.strokeStyle = B; g.lineWidth = Math.max(1, w * 0.01); g.stroke();
      g.fillStyle = "#1c1c1e"; fitText(g, p.name.match(/(줄노트|모눈 노트|스케치북|스프링 노트|다이어리|플래너|수첩)/)?.[0] ?? "NOTE", w * 0.1, w * 0.56, 800); g.fillText(p.name.match(/(줄노트|모눈 노트|스케치북|스프링 노트|다이어리|플래너|수첩)/)?.[0] ?? "NOTE", w / 2, h * 0.46);
      g.font = `600 ${w * 0.05}px ${FONT}`; g.fillStyle = "#555"; g.fillText(p.brand.toUpperCase(), w / 2, h * 0.56);
      if (/다이어리|플래너/.test(p.name)) { g.fillStyle = B; g.fillRect(w * 0.86, 0, w * 0.05, h); }
      if (/스프링/.test(p.name)) { g.fillStyle = "#c8c8cc"; for (let j = h * 0.05; j < h; j += h * 0.06) { g.beginPath(); g.arc(w * 0.05, j, w * 0.025, 0, Math.PI * 2); g.fill(); } }
      break;
    }
    case "device": case "box": {
      const dark = luma(A) < 0.3;
      const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, mix(A, "#ffffff", dark ? 0.08 : 0.05)); bg.addColorStop(1, mix(A, "#000000", 0.12)); g.fillStyle = bg; g.fillRect(0, 0, w, h);
      if (p.cat === "electronics") {
        // (the product pictured on its box)
        if (p.form === "device") { g.fillStyle = "#0b0c0e"; rr(g, w * 0.3, h * 0.18, w * 0.4, h * 0.62, w * 0.05); g.fill(); const sc = g.createLinearGradient(0, h * 0.2, 0, h * 0.78); sc.addColorStop(0, B); sc.addColorStop(1, mix(B, "#000000", 0.5)); g.fillStyle = sc; rr(g, w * 0.32, h * 0.2, w * 0.36, h * 0.58, w * 0.04); g.fill(); g.fillStyle = "rgba(255,255,255,.25)"; g.beginPath(); g.arc(w * 0.5, h * 0.42, w * 0.1, 0, Math.PI * 2); g.fill(); }
        else { g.strokeStyle = B; g.lineWidth = w * 0.05; g.beginPath(); g.arc(w * 0.5, h * 0.48, w * 0.2, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); g.fillStyle = mix(A, "#888888", 0.5); rr(g, w * 0.24, h * 0.46, w * 0.12, h * 0.2, w * 0.03); g.fill(); rr(g, w * 0.64, h * 0.46, w * 0.12, h * 0.2, w * 0.03); g.fill(); }
        g.fillStyle = inkOn(A); g.textAlign = "left"; g.font = `800 ${w * 0.08}px ${FONT}`; g.fillText(p.brand.toUpperCase(), w * 0.08, h * 0.08);
        g.textAlign = "center"; fitText(g, shortName(p), w * 0.08, w * 0.86, 700); g.fillText(shortName(p), w / 2, h * 0.88);
      } else {
        g.fillStyle = B; g.save(); g.translate(w / 2, h / 2); g.rotate(-0.35); g.fillRect(-w, -h * 0.08, w * 2, h * 0.16); g.restore();
        g.fillStyle = mix(B, "#ffffff", 0.3); g.beginPath(); g.arc(w * 0.78, h * 0.22, w * 0.14, 0, Math.PI * 2); g.fill();
        g.fillStyle = inkOn(A); g.font = `700 ${w * 0.07}px ${FONT}`; g.fillText(p.brand, w * 0.5, h * 0.1);
        g.font = `900 ${w * 0.15}px ${FONT}`; const ls = wrap(g, shortName(p), w * 0.86, 2); const s = fitText(g, ls[0] ?? "", w * 0.15, w * 0.86, 900);
        g.lineWidth = s * 0.12; g.strokeStyle = mix(A, "#000000", 0.4); ls.forEach((t, i) => { g.strokeText(t, w / 2, h * 0.66 + i * s * 1.1); g.fillText(t, w / 2, h * 0.66 + i * s * 1.1); });
        g.font = `600 ${w * 0.06}px ${FONT}`; g.fillText(p.desc, w / 2, h * 0.92);
      }
      break;
    }
    case "pouch": {
      // (a snack's bag: a vivid ground, a burst behind the name, the food pictured, the brand ribbon)
      const bg = g.createRadialGradient(w * 0.5, h * 0.45, w * 0.1, w * 0.5, h * 0.5, w * 0.8); bg.addColorStop(0, mix(A, "#ffffff", 0.25)); bg.addColorStop(1, mix(A, "#000000", 0.15)); g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = mix(B, "#ffffff", 0.2); g.beginPath(); for (let i = 0; i < 24; i++) { const t = i * Math.PI / 12, rs = i % 2 ? w * 0.3 : w * 0.42; g.lineTo(w * 0.5 + Math.cos(t) * rs, h * 0.42 + Math.sin(t) * rs); } g.closePath(); g.fill();
      for (let i = 0; i < 7; i++) { g.fillStyle = mix(A, "#f6d365", 0.6); g.beginPath(); g.ellipse(w * (0.2 + r() * 0.6), h * (0.62 + r() * 0.22), w * 0.09, w * 0.06, r() * 3, 0, Math.PI * 2); g.fill(); g.strokeStyle = "rgba(0,0,0,.15)"; g.stroke(); }
      g.fillStyle = "#ffffff"; g.strokeStyle = mix(A, "#000000", 0.5); g.font = `900 ${w * 0.17}px ${FONT}`;
      const ls = wrap(g, shortName(p), w * 0.88, 2); const s = fitText(g, ls.reduce((a, b) => (a.length > b.length ? a : b), ""), w * 0.17, w * 0.88, 900);
      g.lineWidth = s * 0.18; ls.forEach((t, i) => { g.strokeText(t, w / 2, h * 0.36 + i * s * 1.05); g.fillText(t, w / 2, h * 0.36 + i * s * 1.05); });
      g.fillStyle = mix(B, "#000000", 0.2); g.fillRect(0, h * 0.04, w, h * 0.1); g.fillStyle = "#fff"; g.font = `800 ${w * 0.07}px ${FONT}`; g.fillText(p.brand, w / 2, h * 0.09);
      g.fillStyle = "rgba(255,255,255,.85)"; g.font = `700 ${w * 0.06}px ${FONT}`; g.fillText(p.desc, w * 0.8, h * 0.94);
      break;
    }
    case "tee": case "shirt": case "pants": case "dress": case "coat": case "folded": case "cap": {
      pattern(g, p.desc, 0, 0, w, h, A, B, p.seed);
      if (/로고/.test(p.desc)) { g.fillStyle = inkOn(A); g.font = `900 ${w * 0.09}px ${FONT}`; g.fillText(p.brand.toUpperCase(), w / 2, h * 0.32); }
      break;
    }
    case "shoe": case "boot": case "heel": {
      g.fillStyle = A; g.fillRect(0, 0, w, h);
      g.fillStyle = B; g.beginPath(); g.moveTo(w * 0.1, h * 0.75); g.quadraticCurveTo(w * 0.5, h * 0.25, w * 0.9, h * 0.45); g.lineTo(w * 0.9, h * 0.6); g.quadraticCurveTo(w * 0.5, h * 0.45, w * 0.15, h * 0.85); g.fill();
      g.fillStyle = "rgba(0,0,0,.25)"; for (let i = 0; i < 18; i++) { g.beginPath(); g.arc(w * (0.3 + (i % 6) * 0.06), h * (0.2 + Math.floor(i / 6) * 0.06), w * 0.008, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = "#f4f4f1"; g.fillRect(0, h * 0.9, w, h * 0.1);
      break;
    }
    case "bag": case "backpack": case "wallet": {
      g.fillStyle = A; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1600; i++) { g.fillStyle = r() > 0.5 ? "rgba(255,255,255,.05)" : "rgba(0,0,0,.07)"; g.fillRect(r() * w, r() * h, 2, 2); }
      g.setLineDash([w * 0.025, w * 0.02]); g.strokeStyle = mix(A, "#ffffff", 0.35); g.lineWidth = Math.max(1, w * 0.01); g.strokeRect(w * 0.06, h * 0.06, w * 0.88, h * 0.88); g.setLineDash([]);
      g.fillStyle = mix(A, "#000000", 0.15); g.fillRect(0, 0, w, h * 0.3); g.fillStyle = B; rr(g, w * 0.42, h * 0.24, w * 0.16, h * 0.12, w * 0.02); g.fill();
      g.fillStyle = mix(A, "#ffffff", 0.45); g.font = `700 ${w * 0.06}px ${FONT}`; g.fillText(p.brand.toUpperCase(), w / 2, h * 0.7);
      break;
    }
    case "fruit": case "tray": case "bread": case "cake": {
      g.fillStyle = A; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 400; i++) { g.fillStyle = r() > 0.5 ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.12)"; g.beginPath(); g.arc(r() * w, r() * h, 1 + r() * 3, 0, Math.PI * 2); g.fill(); }
      break;
    }
    default: {
      // (a label: bottles, jars, tubes, cans, cartons, cosmetics, drinks)
      const pale = luma(A) > 0.7;
      const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, mix(A, "#ffffff", 0.18)); bg.addColorStop(1, mix(A, "#000000", 0.08)); g.fillStyle = bg; g.fillRect(0, 0, w, h);
      if (p.kind === "drink") {
        g.fillStyle = B === A ? "#ffffff" : B; g.globalAlpha = 0.9; g.beginPath(); g.moveTo(0, h * 0.62); for (let i = 0; i <= 12; i++) g.lineTo(w * i / 12, h * (0.62 + Math.sin(i * 1.3) * 0.03)); g.lineTo(w, h); g.lineTo(0, h); g.fill(); g.globalAlpha = 1;
        g.fillStyle = mix(A, "#ffffff", 0.45); g.beginPath(); g.arc(w * 0.5, h * 0.78, w * 0.13, 0, Math.PI * 2); g.fill();
      } else {
        g.strokeStyle = B; g.lineWidth = Math.max(1, h * 0.015); g.beginPath(); g.moveTo(w * 0.15, h * 0.3); g.lineTo(w * 0.85, h * 0.3); g.moveTo(w * 0.15, h * 0.74); g.lineTo(w * 0.85, h * 0.74); g.stroke();
        g.fillStyle = B; g.beginPath(); g.ellipse(w * 0.5, h * 0.86, w * 0.05, w * 0.1, 0.6, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = pale ? "#1c1c1e" : I; g.font = `700 ${w * 0.09}px ${FONT}`; g.fillText(p.brand.toUpperCase().split("").join(" "), w / 2, h * 0.2);
      g.font = `800 ${w * 0.13}px ${FONT}`; const ls = wrap(g, shortName(p), w * 0.86, 2); const s = fitText(g, ls.reduce((a, b) => (a.length > b.length ? a : b), ""), w * 0.13, w * 0.86, 800);
      ls.forEach((t, i) => g.fillText(t, w / 2, h * 0.43 + i * s * 1.15));
      g.font = `600 ${w * 0.07}px ${FONT}`; g.globalAlpha = 0.8; g.fillText(p.desc, w / 2, h * 0.66); g.globalAlpha = 1;
    }
  }
  g.restore();
}

// ------------------------------------------------------------------ packshots (the menu)
/** a garment's outline in a w×h box (for the packshot and the rail's cut-out) */
export function garmentPath(g: G, form: string, x: number, y: number, w: number, h: number) {
  const P = (u: number, v: number): [number, number] => [x + u * w, y + v * h];
  const poly = (pts: [number, number][]) => { g.beginPath(); pts.forEach(([u, v], i) => { const [a, b] = P(u, v); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.closePath(); };
  if (form === "pants") poly([[0.2, 0.02], [0.8, 0.02], [0.86, 0.98], [0.56, 0.98], [0.5, 0.32], [0.44, 0.98], [0.14, 0.98]]);
  else if (form === "dress") poly([[0.36, 0.02], [0.64, 0.02], [0.7, 0.2], [0.62, 0.32], [0.88, 0.98], [0.12, 0.98], [0.38, 0.32], [0.3, 0.2]]);
  else if (form === "coat") poly([[0.38, 0.02], [0.62, 0.02], [0.92, 0.14], [0.98, 0.7], [0.84, 0.72], [0.8, 0.98], [0.2, 0.98], [0.16, 0.72], [0.02, 0.7], [0.08, 0.14]]);
  else if (form === "shirt") poly([[0.38, 0.02], [0.5, 0.12], [0.62, 0.02], [0.92, 0.14], [0.98, 0.62], [0.84, 0.64], [0.8, 0.98], [0.2, 0.98], [0.16, 0.64], [0.02, 0.62], [0.08, 0.14]]);
  else poly([[0.36, 0.02], [0.5, 0.08], [0.64, 0.02], [0.96, 0.16], [0.88, 0.36], [0.78, 0.32], [0.78, 0.98], [0.22, 0.98], [0.22, 0.32], [0.12, 0.36], [0.04, 0.16]]);
}

const cache = new Map<string, string>();
/** the product photographed: a soft studio ground, its shadow, the product drawn by its kind */
export function productImage(p: Product, size = 192): string {
  const key = `${p.id}|${size}`, had = cache.get(key); if (had) return had;
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d")!, S = size;
  const bg = g.createRadialGradient(S * 0.5, S * 0.4, S * 0.1, S * 0.5, S * 0.5, S * 0.75); bg.addColorStop(0, "#ffffff"); bg.addColorStop(1, "#e4e6ea"); g.fillStyle = bg; g.fillRect(0, 0, S, S);
  g.fillStyle = "rgba(0,0,0,.14)"; g.beginPath(); g.ellipse(S * 0.5, S * 0.88, S * 0.32, S * 0.05, 0, 0, Math.PI * 2); g.fill();
  const face = (x: number, y: number, w: number, h: number) => drawFace(g, p, x, y, w, h);
  const clipDo = (path: () => void, draw: () => void, edge = "rgba(0,0,0,.18)") => { g.save(); path(); g.clip(); draw(); g.restore(); path(); g.strokeStyle = edge; g.lineWidth = 1.2; g.stroke(); };
  const gloss = (x: number, y: number, w: number, h: number) => { const gl = g.createLinearGradient(x, 0, x + w, 0); gl.addColorStop(0, "rgba(0,0,0,.18)"); gl.addColorStop(0.3, "rgba(255,255,255,.35)"); gl.addColorStop(0.5, "rgba(255,255,255,0)"); gl.addColorStop(1, "rgba(0,0,0,.22)"); g.fillStyle = gl; g.fillRect(x, y, w, h); };
  const A = p.color, B = p.color2;
  switch (p.form) {
    case "book": case "notebook": {
      g.fillStyle = mix(A, "#000000", 0.45); g.beginPath(); g.moveTo(S * 0.3, S * 0.1); g.lineTo(S * 0.34, S * 0.07); g.lineTo(S * 0.74, S * 0.07); g.lineTo(S * 0.7, S * 0.1); g.fill();
      g.fillStyle = "#f3efe6"; g.fillRect(S * 0.7, S * 0.1, S * 0.04, S * 0.76); g.fillStyle = "rgba(0,0,0,.1)"; for (let i = 0; i < 12; i++) g.fillRect(S * 0.7, S * (0.12 + i * 0.06), S * 0.04, 1);
      face(S * 0.26, S * 0.1, S * 0.44, S * 0.76); g.strokeStyle = "rgba(0,0,0,.2)"; g.strokeRect(S * 0.26, S * 0.1, S * 0.44, S * 0.76); break;
    }
    case "device": case "box": {
      const x = S * 0.2, y = S * 0.22, w = S * 0.5, h = S * 0.62, d = S * 0.12;
      g.fillStyle = mix(A, "#ffffff", 0.25); g.beginPath(); g.moveTo(x, y); g.lineTo(x + d, y - d * 0.6); g.lineTo(x + w + d, y - d * 0.6); g.lineTo(x + w, y); g.fill();
      g.fillStyle = mix(A, "#000000", 0.3); g.beginPath(); g.moveTo(x + w, y); g.lineTo(x + w + d, y - d * 0.6); g.lineTo(x + w + d, y + h - d * 0.6); g.lineTo(x + w, y + h); g.fill();
      face(x, y, w, h); break;
    }
    case "pouch": case "sheet": {
      const path = () => { g.beginPath(); g.moveTo(S * 0.22, S * 0.12); for (let i = 0; i <= 10; i++) g.lineTo(S * (0.22 + i * 0.056), S * (0.12 + (i % 2) * 0.02)); g.quadraticCurveTo(S * 0.84, S * 0.5, S * 0.78, S * 0.86); for (let i = 10; i >= 0; i--) g.lineTo(S * (0.22 + i * 0.056), S * (0.86 + (i % 2) * 0.02)); g.quadraticCurveTo(S * 0.16, S * 0.5, S * 0.22, S * 0.12); g.closePath(); };
      clipDo(path, () => { face(S * 0.16, S * 0.12, S * 0.68, S * 0.76); gloss(S * 0.16, S * 0.1, S * 0.68, S * 0.8); }); break;
    }
    case "bottle": case "pump": case "pet": case "perfume": case "jar": case "can": case "carton": case "cup": case "tube": case "lipstick": case "compact": case "mug": {
      const f = p.form;
      if (f === "jar") { g.fillStyle = B; rr(g, S * 0.24, S * 0.32, S * 0.52, S * 0.12, 6); g.fill(); gloss(S * 0.24, S * 0.32, S * 0.52, S * 0.12); clipDo(() => rr(g, S * 0.22, S * 0.43, S * 0.56, S * 0.42, 14), () => { face(S * 0.22, S * 0.43, S * 0.56, S * 0.42); gloss(S * 0.22, S * 0.43, S * 0.56, S * 0.42); }); break; }
      if (f === "compact") { g.fillStyle = B; g.beginPath(); g.ellipse(S * 0.5, S * 0.6, S * 0.3, S * 0.18, 0, 0, Math.PI * 2); g.fill(); g.save(); g.beginPath(); g.ellipse(S * 0.5, S * 0.52, S * 0.3, S * 0.18, 0, 0, Math.PI * 2); g.clip(); face(S * 0.2, S * 0.34, S * 0.6, S * 0.36); g.restore(); g.strokeStyle = "rgba(0,0,0,.2)"; g.beginPath(); g.ellipse(S * 0.5, S * 0.52, S * 0.3, S * 0.18, 0, 0, Math.PI * 2); g.stroke(); break; }
      if (f === "lipstick") { g.fillStyle = B; rr(g, S * 0.4, S * 0.46, S * 0.2, S * 0.4, 4); g.fill(); gloss(S * 0.4, S * 0.46, S * 0.2, S * 0.4); g.fillStyle = "#d4af37"; g.fillRect(S * 0.42, S * 0.38, S * 0.16, S * 0.09); g.fillStyle = A; g.beginPath(); g.moveTo(S * 0.44, S * 0.38); g.lineTo(S * 0.44, S * 0.2); g.lineTo(S * 0.56, S * 0.14); g.lineTo(S * 0.56, S * 0.38); g.fill(); gloss(S * 0.44, S * 0.14, S * 0.12, S * 0.24); break; }
      if (f === "can") { clipDo(() => rr(g, S * 0.32, S * 0.2, S * 0.36, S * 0.66, 10), () => { face(S * 0.32, S * 0.2, S * 0.36, S * 0.66); gloss(S * 0.32, S * 0.2, S * 0.36, S * 0.66); }); g.fillStyle = "#cfd3d8"; g.beginPath(); g.ellipse(S * 0.5, S * 0.21, S * 0.17, S * 0.03, 0, 0, Math.PI * 2); g.fill(); break; }
      if (f === "carton") { g.fillStyle = mix(A, "#ffffff", 0.3); g.beginPath(); g.moveTo(S * 0.32, S * 0.3); g.lineTo(S * 0.5, S * 0.14); g.lineTo(S * 0.68, S * 0.3); g.fill(); clipDo(() => g.rect(S * 0.32, S * 0.3, S * 0.36, S * 0.56), () => { face(S * 0.32, S * 0.3, S * 0.36, S * 0.56); gloss(S * 0.32, S * 0.3, S * 0.36, S * 0.56); }); break; }
      if (f === "cup" || f === "mug") { const path = () => { g.beginPath(); g.moveTo(S * 0.3, S * 0.24); g.lineTo(S * 0.7, S * 0.24); g.lineTo(S * 0.64, S * 0.86); g.lineTo(S * 0.36, S * 0.86); g.closePath(); }; if (f === "mug") { g.strokeStyle = A; g.lineWidth = S * 0.05; g.beginPath(); g.arc(S * 0.7, S * 0.52, S * 0.1, -1.2, 1.2); g.stroke(); } clipDo(path, () => { g.fillStyle = f === "cup" ? "#f6f1e8" : A; g.fillRect(0, 0, S, S); if (f === "cup") { g.fillStyle = A; g.fillRect(S * 0.3, S * 0.44, S * 0.4, S * 0.24); g.fillStyle = "#fff"; g.font = `800 ${S * 0.06}px ${FONT}`; g.textAlign = "center"; g.fillText(p.name.slice(0, 6), S * 0.5, S * 0.57); } gloss(S * 0.3, S * 0.24, S * 0.4, S * 0.62); }); if (f === "cup") { g.fillStyle = "#ffffff"; rr(g, S * 0.27, S * 0.17, S * 0.46, S * 0.08, 4); g.fill(); g.strokeStyle = "rgba(0,0,0,.15)"; g.stroke(); } break; }
      if (f === "tube") { const path = () => { g.beginPath(); g.moveTo(S * 0.3, S * 0.16); g.lineTo(S * 0.7, S * 0.16); g.lineTo(S * 0.62, S * 0.74); g.lineTo(S * 0.38, S * 0.74); g.closePath(); }; clipDo(path, () => { face(S * 0.3, S * 0.16, S * 0.4, S * 0.58); gloss(S * 0.3, S * 0.16, S * 0.4, S * 0.58); }); g.fillStyle = B; rr(g, S * 0.42, S * 0.74, S * 0.16, S * 0.12, 3); g.fill(); break; }
      if (f === "perfume") { clipDo(() => rr(g, S * 0.28, S * 0.36, S * 0.44, S * 0.5, 8), () => { g.fillStyle = mix(A, "#ffffff", 0.3); g.fillRect(0, 0, S, S); g.fillStyle = A; g.fillRect(S * 0.28, S * 0.5, S * 0.44, S * 0.36); g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(S * 0.36, S * 0.56, S * 0.28, S * 0.14); g.fillStyle = "#222"; g.font = `700 ${S * 0.035}px ${FONT}`; g.textAlign = "center"; g.fillText(p.brand, S * 0.5, S * 0.63); gloss(S * 0.28, S * 0.36, S * 0.44, S * 0.5); }); g.fillStyle = B; rr(g, S * 0.4, S * 0.2, S * 0.2, S * 0.17, 4); g.fill(); gloss(S * 0.4, S * 0.2, S * 0.2, S * 0.17); break; }
      // bottle / pump / pet
      const path = () => { g.beginPath(); g.moveTo(S * 0.42, S * 0.22); g.lineTo(S * 0.58, S * 0.22); g.quadraticCurveTo(S * 0.6, S * 0.32, S * 0.68, S * 0.36); g.lineTo(S * 0.68, S * 0.86); g.lineTo(S * 0.32, S * 0.86); g.lineTo(S * 0.32, S * 0.36); g.quadraticCurveTo(S * 0.4, S * 0.32, S * 0.42, S * 0.22); g.closePath(); };
      clipDo(path, () => { g.fillStyle = f === "pet" ? mix(A, "#ffffff", 0.5) : mix(A, "#ffffff", 0.2); g.fillRect(0, 0, S, S); face(S * 0.32, S * 0.44, S * 0.36, S * 0.34); gloss(S * 0.32, S * 0.2, S * 0.36, S * 0.7); });
      g.fillStyle = f === "pet" ? B === A ? "#ffffff" : B : B; rr(g, S * 0.41, S * 0.12, S * 0.18, S * 0.1, 3); g.fill();
      if (f === "pump") { g.fillRect(S * 0.47, S * 0.06, S * 0.06, S * 0.06); g.fillRect(S * 0.47, S * 0.06, S * 0.16, S * 0.03); }
      break;
    }
    case "tee": case "shirt": case "pants": case "dress": case "coat": case "folded": {
      g.strokeStyle = "#8a8d92"; g.lineWidth = 2; g.beginPath(); g.moveTo(S * 0.5, S * 0.12); g.lineTo(S * 0.5, S * 0.06); g.arc(S * 0.53, S * 0.06, S * 0.03, Math.PI, 0); g.stroke();
      clipDo(() => garmentPath(g, p.form === "folded" ? "tee" : p.form, S * 0.16, S * 0.12, S * 0.68, S * 0.74), () => { face(S * 0.16, S * 0.12, S * 0.68, S * 0.74); const sh = g.createLinearGradient(S * 0.16, 0, S * 0.84, 0); sh.addColorStop(0, "rgba(0,0,0,.15)"); sh.addColorStop(0.5, "rgba(255,255,255,.08)"); sh.addColorStop(1, "rgba(0,0,0,.18)"); g.fillStyle = sh; g.fillRect(0, 0, S, S); }); break;
    }
    case "shoe": case "boot": case "heel": {
      const f = p.form, path = () => { g.beginPath(); if (f === "heel") { g.moveTo(S * 0.18, S * 0.72); g.quadraticCurveTo(S * 0.3, S * 0.5, S * 0.52, S * 0.62); g.lineTo(S * 0.78, S * 0.38); g.lineTo(S * 0.84, S * 0.42); g.lineTo(S * 0.8, S * 0.74); g.lineTo(S * 0.76, S * 0.74); g.lineTo(S * 0.74, S * 0.6); g.lineTo(S * 0.52, S * 0.74); g.closePath(); } else { const top = f === "boot" ? 0.22 : 0.42; g.moveTo(S * 0.12, S * 0.74); g.quadraticCurveTo(S * 0.14, S * 0.56, S * 0.36, S * 0.52); g.lineTo(S * 0.52, S * top + S * 0.08); g.lineTo(S * 0.56, S * top); g.lineTo(S * 0.84, S * top); g.quadraticCurveTo(S * 0.9, S * 0.6, S * 0.88, S * 0.74); g.closePath(); } };
      clipDo(path, () => { face(S * 0.1, S * 0.2, S * 0.8, S * 0.56); });
      g.fillStyle = "#f4f4f1"; rr(g, S * 0.1, S * 0.72, S * 0.8, S * 0.08, 5); g.fill(); g.strokeStyle = "rgba(0,0,0,.2)"; g.stroke(); break;
    }
    case "bag": case "backpack": case "wallet": {
      const f = p.form;
      if (f !== "wallet") { g.strokeStyle = mix(A, "#000000", 0.3); g.lineWidth = S * 0.035; g.beginPath(); g.arc(S * 0.5, S * 0.36, S * 0.17, Math.PI, 0); g.stroke(); }
      const path = () => f === "wallet" ? rr(g, S * 0.2, S * 0.36, S * 0.6, S * 0.38, 10) : f === "backpack" ? rr(g, S * 0.26, S * 0.26, S * 0.48, S * 0.6, 30) : (g.beginPath(), g.moveTo(S * 0.26, S * 0.36), g.lineTo(S * 0.74, S * 0.36), g.lineTo(S * 0.82, S * 0.86), g.lineTo(S * 0.18, S * 0.86), g.closePath());
      clipDo(path, () => { face(S * 0.18, S * 0.26, S * 0.64, S * 0.6); gloss(S * 0.18, S * 0.26, S * 0.64, S * 0.6); }); break;
    }
    case "sunglasses": case "glasses": {
      const lens = p.form === "sunglasses" ? B : "rgba(210,230,240,.55)", sq = /스퀘어|사각|스포츠/.test(p.name), cat = /캣아이/.test(p.name);
      g.strokeStyle = A; g.lineWidth = S * (p.form === "glasses" && /무테/.test(p.name) ? 0.008 : 0.03);
      for (const cx of [0.32, 0.68]) { g.beginPath(); if (sq) rr(g, S * (cx - 0.15), S * 0.42, S * 0.3, S * 0.2, 8); else if (cat) { g.moveTo(S * (cx - 0.15), S * 0.44); g.quadraticCurveTo(S * cx, S * 0.36, S * (cx + 0.16), S * 0.4); g.quadraticCurveTo(S * (cx + 0.12), S * 0.66, S * cx, S * 0.64); g.quadraticCurveTo(S * (cx - 0.15), S * 0.62, S * (cx - 0.15), S * 0.44); } else g.ellipse(S * cx, S * 0.52, S * 0.15, S * (/보잉/.test(p.name) ? 0.13 : 0.12), 0, 0, Math.PI * 2); g.fillStyle = lens; g.fill(); g.stroke(); }
      g.beginPath(); g.moveTo(S * 0.46, S * 0.48); g.quadraticCurveTo(S * 0.5, S * 0.44, S * 0.54, S * 0.48); g.stroke();
      g.beginPath(); g.moveTo(S * 0.17, S * 0.46); g.lineTo(S * 0.08, S * 0.42); g.moveTo(S * 0.83, S * 0.46); g.lineTo(S * 0.92, S * 0.42); g.stroke();
      g.fillStyle = "rgba(255,255,255,.35)"; g.beginPath(); g.ellipse(S * 0.27, S * 0.47, S * 0.04, S * 0.02, -0.5, 0, Math.PI * 2); g.fill(); break;
    }
    case "watch": {
      g.fillStyle = B; rr(g, S * 0.42, S * 0.08, S * 0.16, S * 0.84, 8); g.fill();
      g.fillStyle = A; g.beginPath(); g.arc(S * 0.5, S * 0.5, S * 0.18, 0, Math.PI * 2); g.fill(); g.fillStyle = /디지털|스마트/.test(p.name) ? "#0b0c0e" : "#f6f4ef"; g.beginPath(); g.arc(S * 0.5, S * 0.5, S * 0.145, 0, Math.PI * 2); g.fill();
      g.strokeStyle = /디지털|스마트/.test(p.name) ? "#5ef0ff" : "#222"; g.lineWidth = 3; g.beginPath(); g.moveTo(S * 0.5, S * 0.5); g.lineTo(S * 0.5, S * 0.4); g.moveTo(S * 0.5, S * 0.5); g.lineTo(S * 0.58, S * 0.54); g.stroke(); break;
    }
    case "ring": case "necklace": {
      g.strokeStyle = A; g.lineWidth = S * 0.03;
      if (p.form === "ring") { g.beginPath(); g.ellipse(S * 0.5, S * 0.58, S * 0.18, S * 0.14, 0, 0, Math.PI * 2); g.stroke(); g.fillStyle = "#e9f6ff"; g.beginPath(); g.moveTo(S * 0.5, S * 0.32); g.lineTo(S * 0.58, S * 0.4); g.lineTo(S * 0.5, S * 0.48); g.lineTo(S * 0.42, S * 0.4); g.fill(); }
      else { g.lineWidth = S * 0.012; g.beginPath(); g.arc(S * 0.5, S * 0.32, S * 0.3, 0.2, Math.PI - 0.2); g.stroke(); g.fillStyle = A; g.beginPath(); g.arc(S * 0.5, S * 0.64, S * 0.05, 0, Math.PI * 2); g.fill(); }
      break;
    }
    case "cap": { clipDo(() => { g.beginPath(); g.arc(S * 0.48, S * 0.6, S * 0.24, Math.PI, 0); g.closePath(); }, () => face(S * 0.24, S * 0.36, S * 0.48, S * 0.26)); g.fillStyle = mix(A, "#000000", 0.2); g.beginPath(); g.ellipse(S * 0.72, S * 0.62, S * 0.18, S * 0.04, 0, 0, Math.PI * 2); g.fill(); break; }
    case "fruit": { for (let i = 0; i < 7; i++) { const x = S * (0.32 + (i % 3) * 0.18), y = S * (0.6 - Math.floor(i / 3) * 0.14); const gr = g.createRadialGradient(x - S * 0.03, y - S * 0.03, 2, x, y, S * 0.1); gr.addColorStop(0, mix(A, "#ffffff", 0.5)); gr.addColorStop(1, A); g.fillStyle = gr; g.beginPath(); g.arc(x, y, S * 0.1, 0, Math.PI * 2); g.fill(); } break; }
    case "tray": { g.fillStyle = "#f4f4f1"; rr(g, S * 0.16, S * 0.46, S * 0.68, S * 0.34, 10); g.fill(); g.strokeStyle = "rgba(0,0,0,.2)"; g.stroke(); clipDo(() => rr(g, S * 0.22, S * 0.5, S * 0.56, S * 0.24, 20), () => face(S * 0.22, S * 0.5, S * 0.56, S * 0.24)); g.fillStyle = "rgba(255,255,255,.35)"; rr(g, S * 0.2, S * 0.48, S * 0.6, S * 0.08, 6); g.fill(); break; }
    case "bread": case "cake": { clipDo(() => p.form === "cake" ? (g.beginPath(), g.moveTo(S * 0.2, S * 0.78), g.lineTo(S * 0.8, S * 0.78), g.lineTo(S * 0.8, S * 0.5), g.lineTo(S * 0.2, S * 0.38), g.closePath()) : (g.beginPath(), g.ellipse(S * 0.5, S * 0.62, S * 0.3, S * 0.18, 0, 0, Math.PI * 2)), () => { face(S * 0.2, S * 0.38, S * 0.6, S * 0.44); const gl = g.createLinearGradient(0, S * 0.4, 0, S * 0.8); gl.addColorStop(0, "rgba(255,255,255,.3)"); gl.addColorStop(1, "rgba(0,0,0,.25)"); g.fillStyle = gl; g.fillRect(0, 0, S, S); }); if (p.form === "cake") { g.fillStyle = "#e63946"; g.beginPath(); g.arc(S * 0.62, S * 0.42, S * 0.05, 0, Math.PI * 2); g.fill(); } break; }
    case "pen": { g.save(); g.translate(S * 0.5, S * 0.5); g.rotate(-0.7); g.fillStyle = A; rr(g, -S * 0.36, -S * 0.035, S * 0.62, S * 0.07, 6); g.fill(); g.fillStyle = B; g.fillRect(S * 0.26, -S * 0.025, S * 0.1, S * 0.05); g.fillStyle = "#c9a24a"; g.fillRect(-S * 0.2, -S * 0.04, S * 0.03, S * 0.08); g.restore(); break; }
    case "plant": { g.fillStyle = A; g.beginPath(); g.moveTo(S * 0.36, S * 0.6); g.lineTo(S * 0.64, S * 0.6); g.lineTo(S * 0.6, S * 0.86); g.lineTo(S * 0.4, S * 0.86); g.fill(); g.fillStyle = "#3f7d20"; for (let i = 0; i < 7; i++) { g.beginPath(); g.ellipse(S * 0.5 + Math.cos(i) * S * 0.1, S * 0.46 - Math.abs(Math.sin(i)) * S * 0.1, S * 0.05, S * 0.12, i - 3, 0, Math.PI * 2); g.fill(); } break; }
    case "toy": { g.fillStyle = A; for (const [x, y, r] of [[0.5, 0.62, 0.2], [0.5, 0.36, 0.14], [0.39, 0.25, 0.05], [0.61, 0.25, 0.05]]) { g.beginPath(); g.arc(S * x, S * y, S * r, 0, Math.PI * 2); g.fill(); } g.fillStyle = "#222"; g.beginPath(); g.arc(S * 0.45, S * 0.34, S * 0.015, 0, 7); g.arc(S * 0.55, S * 0.34, S * 0.015, 0, 7); g.fill(); break; }
    case "ball": { const gr = g.createRadialGradient(S * 0.44, S * 0.44, 4, S * 0.5, S * 0.52, S * 0.26); gr.addColorStop(0, mix(A, "#ffffff", 0.4)); gr.addColorStop(1, A); g.fillStyle = gr; g.beginPath(); g.arc(S * 0.5, S * 0.52, S * 0.26, 0, Math.PI * 2); g.fill(); g.strokeStyle = "rgba(0,0,0,.35)"; g.lineWidth = 2; g.beginPath(); g.arc(S * 0.5, S * 0.52, S * 0.26, 0, Math.PI * 2); g.moveTo(S * 0.24, S * 0.52); g.lineTo(S * 0.76, S * 0.52); g.stroke(); break; }
    default: face(S * 0.2, S * 0.2, S * 0.6, S * 0.6);
  }
  const url = c.toDataURL("image/webp", 0.85);
  if (cache.size > 600) cache.delete(cache.keys().next().value!);
  cache.set(key, url); return url;
}
