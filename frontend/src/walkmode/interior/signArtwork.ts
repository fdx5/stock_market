/** Canvas artwork only: every sign still shares the floor's single atlas/material.
 *
 * Signs made as such signs are: a room plate of brushed metal with its pictogram in a coloured
 * badge and an engraved name; a shop's fascia a backlit lightbox in its brand colour with a logo
 * medallion; a business's name board over the corridor channel letters glowing on a dark panel; a
 * notice a printed poster; wayfinding a dark board with arrow chips. Nothing white with black type. */
import { brandColour, shopStyle } from "./shopInteriors";

const FONT = 'Pretendard, "Noto Sans KR", "Malgun Gothic", sans-serif';
export function labelHash(s: string) { let n = 2166136261; for (const c of s) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; }
const WORDS: [RegExp, string, string][] = [
  [/화장실|남자|여자/, "Restroom", "wc"], [/엘리베이터|승강기/, "Elevator", "lift"], [/계단/, "Stairs", "stairs"],
  [/약국|조제/, "Pharmacy", "cross"], [/카페|커피|라운지 바/, "Cafe", "cup"], [/안내|접수|프런트|리셉션/, "Information", "info"],
  [/검사|채혈/, "Laboratory", "flask"], [/영상|촬영/, "Imaging", "scan"], [/진료|의원|치료|처치/, "Clinic", "cross"],
  [/병실|입원/, "Ward", "bed"], [/대기|휴게/, "Lounge", "seat"], [/창고|보관|수장고/, "Storage", "box"], [/주차/, "Parking", "parking"],
  [/\d+호$|객실|스위트/, "Guest Room", "key"], [/전시|갤러리|미술|박물/, "Gallery", "frame"], [/회의|세미나|컨퍼런스/, "Meeting", "meet"],
  [/사무|오피스|업무/, "Office", "case"], [/민원|창구|발급/, "Civil Service", "doc"], [/식당|레스토랑|구내|푸드/, "Restaurant", "dine"],
  [/아트숍|매점|숍|상점|매장/, "Shop", "bag"], [/탕비|팬트리/, "Pantry", "cup"], [/교실|학년|반$/, "Classroom", "book"], [/도서|서고|자료/, "Library", "book"],
  [/헬스|피트니스|체력/, "Fitness", "gym"], [/상담/, "Consulting", "meet"], [/기계|전기|설비/, "Plant Room", "bolt"], [/복도|로비|홀/, "Hall", "info"],
];
type G = CanvasRenderingContext2D;
function rr(g: G, x: number, y: number, w: number, h: number, r: number) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
const mix = (a: string, b: string, k: number) => { const p = (s: string) => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16)); const A = p(a), B = p(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(",")})`; };
const hex = (c: string) => /^#[0-9a-f]{6}$/i.test(c) ? c : "#5ef0ff";
const luma = (c: string) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex(c).slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

function icon(g: G, kind: string, x: number, y: number, s: number, text: string) {
  g.save(); g.translate(x, y); g.scale(s, s); g.lineWidth = .075; g.lineCap = "round"; g.lineJoin = "round";
  const path = (p: number[][], close = false) => { g.beginPath(); p.forEach(([a, b], i) => i ? g.lineTo(a, b) : g.moveTo(a, b)); if (close) g.closePath(); g.stroke(); };
  const circ = (cx: number, cy: number, r: number, fill = false) => { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); if (fill) g.fill(); else g.stroke(); };
  if (kind === "cross") { g.fillRect(.37, .12, .26, .76); g.fillRect(.12, .37, .76, .26); }
  else if (kind === "wc") { const people = /남/.test(text) ? [.5] : /여/.test(text) ? [.5] : [.27, .73]; for (const a of people) { circ(a, .18, .09, true); if (/여/.test(text) || a === .73) { g.beginPath(); g.moveTo(a, .32); g.lineTo(a - .16, .66); g.lineTo(a + .16, .66); g.closePath(); g.fill(); } else g.fillRect(a - .1, .32, .2, .34); g.fillRect(a - .08, .64, .05, .28); g.fillRect(a + .03, .64, .05, .28); } }
  else if (kind === "stairs") path([[.08, .87], [.28, .87], [.28, .63], [.5, .63], [.5, .4], [.72, .4], [.72, .16], [.94, .16]]);
  else if (kind === "lift") { g.strokeRect(.18, .3, .64, .62); path([[.5, .35], [.5, .85]]); g.beginPath(); g.moveTo(.25, .22); g.lineTo(.35, .08); g.lineTo(.45, .22); g.fill(); g.beginPath(); g.moveTo(.55, .08); g.lineTo(.65, .22); g.lineTo(.75, .08); g.fill(); }
  else if (kind === "cup") { path([[.16, .35], [.22, .8], [.7, .8], [.76, .35]], true); path([[.78, .42], [.92, .42], [.92, .6], [.75, .62]]); path([[.3, .1], [.34, .24]]); path([[.5, .1], [.54, .24]]); }
  else if (kind === "flask") path([[.35, .12], [.65, .12], [.59, .12], [.59, .4], [.86, .85], [.14, .85], [.41, .4], [.41, .12]]);
  else if (kind === "bed") { path([[.12, .2], [.12, .85]]); path([[.12, .65], [.9, .65], [.9, .85]]); g.strokeRect(.3, .42, .6, .23); circ(.22, .5, .07, true); }
  else if (kind === "seat") { path([[.22, .15], [.22, .62], [.82, .62]]); path([[.3, .62], [.3, .9]]); path([[.76, .62], [.76, .9]]); }
  else if (kind === "scan") { g.strokeRect(.12, .12, .76, .76); circ(.5, .5, .24); }
  else if (kind === "box") { g.strokeRect(.15, .3, .7, .56); path([[.15, .3], [.3, .12], [.7, .12], [.85, .3]]); path([[.42, .45], [.58, .45]]); }
  else if (kind === "key") { circ(.32, .5, .17); path([[.49, .5], [.9, .5]]); path([[.78, .5], [.78, .66]]); path([[.88, .5], [.88, .62]]); }
  else if (kind === "frame") { g.strokeRect(.12, .16, .76, .68); path([[.2, .74], [.42, .46], [.58, .62], [.68, .52], [.8, .74]]); circ(.66, .32, .06, true); }
  else if (kind === "meet") { circ(.3, .3, .1, true); circ(.7, .3, .1, true); path([[.12, .78], [.18, .5], [.42, .5], [.48, .78]]); path([[.52, .78], [.58, .5], [.82, .5], [.88, .78]]); }
  else if (kind === "case") { g.strokeRect(.1, .32, .8, .52); path([[.36, .32], [.36, .2], [.64, .2], [.64, .32]]); path([[.1, .52], [.9, .52]]); }
  else if (kind === "doc") { path([[.22, .1], [.62, .1], [.8, .28], [.8, .9], [.22, .9]], true); path([[.34, .45], [.68, .45]]); path([[.34, .6], [.68, .6]]); path([[.34, .75], [.56, .75]]); }
  else if (kind === "dine") { path([[.3, .1], [.3, .9]]); path([[.2, .1], [.2, .36], [.4, .36], [.4, .1]]); path([[.68, .9], [.68, .1]]); g.beginPath(); g.ellipse(.68, .3, .1, .2, 0, 0, Math.PI * 2); g.fill(); }
  else if (kind === "bag") { path([[.16, .34], [.84, .34], [.78, .9], [.22, .9]], true); g.beginPath(); g.arc(.5, .34, .17, Math.PI, 0); g.stroke(); }
  else if (kind === "book") { path([[.5, .22], [.5, .88]]); path([[.5, .22], [.12, .14], [.12, .8], [.5, .88], [.88, .8], [.88, .14], [.5, .22]]); }
  else if (kind === "gym") { g.fillRect(.1, .32, .12, .36); g.fillRect(.78, .32, .12, .36); g.fillRect(.2, .4, .08, .2); g.fillRect(.72, .4, .08, .2); g.fillRect(.28, .46, .44, .08); }
  else if (kind === "bolt") { g.beginPath(); g.moveTo(.58, .06); g.lineTo(.24, .56); g.lineTo(.48, .56); g.lineTo(.4, .94); g.lineTo(.78, .42); g.lineTo(.54, .42); g.closePath(); g.fill(); }
  else { g.font = `800 .8px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(kind === "parking" ? "P" : "i", .5, .55); }
  g.restore();
}

/** brushed metal: a ground of fine horizontal streaks under a soft sheen */
function brushed(g: G, x: number, y: number, w: number, h: number, base: string, seed: number) {
  g.fillStyle = base; g.fillRect(x, y, w, h);
  let s = seed || 1; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < h; i += 1) { g.fillStyle = rnd() > .5 ? `rgba(255,255,255,${rnd() * .07})` : `rgba(0,0,0,${rnd() * .08})`; g.fillRect(x, y + i, w, 1); }
  const sh = g.createLinearGradient(x, y, x + w, y + h); sh.addColorStop(0, "rgba(255,255,255,.18)"); sh.addColorStop(.45, "rgba(255,255,255,0)"); sh.addColorStop(.55, "rgba(255,255,255,.08)"); sh.addColorStop(1, "rgba(0,0,0,.18)");
  g.fillStyle = sh; g.fillRect(x, y, w, h);
}
/** the monogram medallion of a brand: its first letter in a ring */
function medallion(g: G, cx: number, cy: number, r: number, ground: string, ink: string, text: string) {
  const gr = g.createRadialGradient(cx - r * .3, cy - r * .3, r * .1, cx, cy, r); gr.addColorStop(0, mix(hex(ground), "#ffffff", .25)); gr.addColorStop(1, hex(ground));
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = ink; g.lineWidth = r * .09; g.beginPath(); g.arc(cx, cy, r * .82, 0, Math.PI * 2); g.stroke();
  g.fillStyle = ink; g.font = `900 ${r * 1.05}px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText([...text.replace(/[\s()]/g, "")][0] ?? "★", cx, cy + r * .05);
}
const ENGLISH: Record<string, string> = { convenience: "CONVENIENCE STORE", cosmetics: "BEAUTY & COSMETICS", clothing: "FASHION", bank: "BANKING", books: "BOOKS & MORE", bakery: "BAKERY & CAFE", restaurant: "RESTAURANT", salon: "HAIR SALON", electronics: "ELECTRONICS", eyewear: "OPTICAL", pcroom: "PC ZONE", gym: "FITNESS", variety: "LIFESTYLE", general: "STORE" };

export function paintSpecial(g: G, style: string, lines: string[], w: number, h: number, accent: string): boolean {
  if (!["plate", "fascia", "notice", "wayfinding", "brand", "label"].includes(style)) return false;
  const main = lines[0] ?? "", hash = labelHash(main), word = WORDS.find(([r]) => r.test(main));
  const fit = (t: string, size: number, max: number, weight = 700) => { g.font = `${weight} ${size}px ${FONT}`; const width = g.measureText(t).width; if (width > max) g.font = `${weight} ${Math.max(5, size * max / width)}px ${FONT}`; };
  g.textBaseline = "middle";
  const A = hex(accent);

  if (style === "plate" || style === "label") {
    // (brushed metal in one of three finishes — champagne, graphite, satin silver — framed; the
    // pictogram in an accent badge; the name engraved, the English under it)
    const v = hash % 3, base = ["#b9a98a", "#3a3d42", "#c6c9cc"][v], ink = v === 1 ? "#f1ede4" : "#1d1f22";
    g.fillStyle = "#111214"; g.fillRect(0, 0, w, h);
    brushed(g, h * .04, h * .04, w - h * .08, h - h * .08, base, hash);
    g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = Math.max(1, h * .02); g.strokeRect(h * .05, h * .05, w - h * .1, h - h * .1);
    const badge = h * .78, bx = h * .11, by = (h - badge) / 2;
    const gr = g.createLinearGradient(0, by, 0, by + badge); gr.addColorStop(0, mix(A, "#ffffff", .2)); gr.addColorStop(1, mix(A, "#000000", .25));
    g.fillStyle = gr; rr(g, bx, by, badge, badge, badge * .18); g.fill();
    g.fillStyle = "#ffffff"; g.strokeStyle = "#ffffff"; icon(g, word?.[2] ?? "info", bx + badge * .16, by + badge * .16, badge * .68, main);
    const left = bx + badge + h * .16, tw = w - left - h * .14;
    const sub = [word?.[1] ?? "", lines[1] ?? ""].filter(Boolean).join(" · ");
    g.textAlign = "left";
    // engraved: a light edge under the dark cut
    fit(main, h * (sub ? .4 : .52), tw, 800);
    g.fillStyle = v === 1 ? "rgba(0,0,0,.6)" : "rgba(255,255,255,.55)"; g.fillText(main, left + 1, h * (sub ? .38 : .5) + 1.5);
    g.fillStyle = ink; g.fillText(main, left, h * (sub ? .38 : .5));
    if (sub) { fit(sub.toUpperCase(), h * .17, tw, 600); g.fillStyle = v === 1 ? "#c9b98f" : mix(A, "#000000", .35); g.fillText(sub.toUpperCase(), left, h * .74); }
    return true;
  }

  if (style === "fascia" || style === "brand") {
    const kind = shopStyle(main), brand = hex(brandColour(main, kind)), tag = lines[1] ?? (kind === "general" ? "" : ENGLISH[kind] ?? "");
    const v = hash % 3;
    if (style === "fascia") {
      // (a backlit lightbox: the brand's colour graded, a bright band of light along the top edge,
      // a polished metal frame; the logo medallion and the name in white with a soft glow)
      const deep = mix(brand, "#000000", .45), lift = mix(brand, "#ffffff", .18);
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, lift); gr.addColorStop(.55, brand); gr.addColorStop(1, deep);
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      if (v === 1) { g.globalAlpha = .12; g.strokeStyle = "#ffffff"; g.lineWidth = h * .05; for (let x = -h; x < w + h; x += h * .5) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.stroke(); } g.globalAlpha = 1; }
      if (v === 2) { const rg = g.createRadialGradient(w * .5, h * .5, 0, w * .5, h * .5, w * .6); rg.addColorStop(0, "rgba(255,255,255,.22)"); rg.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = rg; g.fillRect(0, 0, w, h); }
      const band = g.createLinearGradient(0, 0, 0, h * .18); band.addColorStop(0, "rgba(255,255,255,.55)"); band.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = band; g.fillRect(0, 0, w, h * .18);
      const fr = g.createLinearGradient(0, 0, 0, h); fr.addColorStop(0, "#e8e8e8"); fr.addColorStop(.5, "#8a8d92"); fr.addColorStop(1, "#d8d8d8");
      g.strokeStyle = fr; g.lineWidth = h * .07; g.strokeRect(h * .035, h * .035, w - h * .07, h - h * .07);
      const r = h * .32, ink = luma(brand) > .62 ? "#16181c" : "#ffffff";
      medallion(g, h * .62, h / 2, r, ink === "#ffffff" ? "#ffffff" : "#16181c", brand, main);
      const left = h * 1.1, tw = w - left - h * .3;
      g.textAlign = "left"; g.shadowColor = ink === "#ffffff" ? "rgba(255,255,255,.7)" : "rgba(0,0,0,.3)"; g.shadowBlur = h * .12;
      fit(main, h * (tag ? .44 : .56), tw, 900); g.fillStyle = ink; g.fillText(main, left, h * (tag ? .42 : .52));
      g.shadowBlur = 0;
      if (tag) { fit(tag, h * .14, tw, 700); g.globalAlpha = .85; g.fillText(tag.split("").join(" "), left + 2, h * .76); g.globalAlpha = 1; }
      return true;
    }
    // brand: channel letters on a dark panel — each letter lit in the brand colour with a halo,
    // a thin brand line beneath, the panel's own faint grain
    const panel = g.createLinearGradient(0, 0, 0, h); panel.addColorStop(0, "#1c1e22"); panel.addColorStop(1, "#0c0d0f");
    g.fillStyle = panel; g.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 3) { g.fillStyle = `rgba(255,255,255,${0.012 + 0.012 * Math.sin(i * .7)})`; g.fillRect(i, 0, 1, h); }
    const lit = luma(brand) < .25 ? "#f4f4f4" : mix(brand, "#ffffff", .15);
    const r = h * .3; medallion(g, h * .55, h / 2, r, brand, "#ffffff", main);
    const left = h * 1.0, tw = w - left - h * .3;
    g.textAlign = "left"; fit(main, h * .5, tw, 900);
    for (const [blur, a] of [[h * .35, .55], [h * .14, .8], [0, 1]] as [number, number][]) { g.shadowColor = lit; g.shadowBlur = blur; g.globalAlpha = a; g.fillStyle = blur ? lit : "#ffffff"; g.fillText(main, left, h * .46); }
    g.globalAlpha = 1; g.shadowBlur = 0;
    g.fillStyle = lit; g.fillRect(left, h * .8, Math.min(tw, g.measureText(main).width), Math.max(2, h * .035));
    if (tag) { g.font = `700 ${h * .11}px ${FONT}`; g.fillStyle = "rgba(255,255,255,.6)"; g.textAlign = "right"; g.fillText(tag, w - h * .2, h * .84); }
    return true;
  }

  if (style === "notice") {
    // (a printed poster in a slim frame: a graded header with its symbol, the title, the lines)
    const v = hash % 3, top = [A, "#c8102e", "#1f6f5a"][v];
    g.fillStyle = "#1b1d20"; g.fillRect(0, 0, w, h);
    const paper = g.createLinearGradient(0, 0, 0, h); paper.addColorStop(0, "#fbf8f1"); paper.addColorStop(1, "#ece6da");
    g.fillStyle = paper; g.fillRect(w * .03, h * .02, w * .94, h * .96);
    const hd = g.createLinearGradient(0, 0, w, h * .4); hd.addColorStop(0, mix(hex(top), "#ffffff", .15)); hd.addColorStop(1, mix(hex(top), "#000000", .3));
    g.fillStyle = hd; g.fillRect(w * .03, h * .02, w * .94, h * .38);
    g.fillStyle = "rgba(255,255,255,.12)"; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(w * (.15 + i * .17), h * .3, w * .12, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = "#ffffff"; g.textAlign = "center"; g.font = `900 ${h * .16}px ${FONT}`;
    g.fillText(/금연/.test(main) ? "⊘" : /손/.test(main) ? "✚" : /SALE/i.test(main) ? "%" : /NEW/i.test(main) ? "★" : "i", w / 2, h * .2);
    fit(main, h * .1, w * .85, 900); g.fillStyle = "#111"; g.fillText(main, w / 2, h * .5);
    g.fillStyle = hex(top); g.fillRect(w * .35, h * .57, w * .3, Math.max(2, h * .008));
    lines.slice(1, 4).forEach((t, i) => { fit(t, h * .055, w * .82, 500); g.fillStyle = "#3a3a3a"; g.fillText(t, w / 2, h * (.66 + i * .09)); });
    return true;
  }

  // wayfinding: a dark navy board, each destination an arrow chip and its name
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#14283a"); gr.addColorStop(1, "#0a1622");
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = A; g.fillRect(0, 0, w, Math.max(2, h * .04));
  const rows = lines.slice(0, 3), rh = h * .92 / Math.max(1, rows.length);
  rows.forEach((t, i) => {
    const y = h * .06 + rh * (i + .5), m = t.match(/^([↑↓←→])\s*(.*)$/), arrow = m?.[1] ?? "→", label = m?.[2] ?? t;
    const s = rh * .7;
    g.fillStyle = "#f3c843"; rr(g, w * .04, y - s / 2, s, s, s * .2); g.fill();
    g.fillStyle = "#14283a"; g.textAlign = "center"; g.font = `900 ${s * .8}px ${FONT}`; g.fillText(arrow, w * .04 + s / 2, y + s * .04);
    g.textAlign = "left"; g.fillStyle = "#eaf6ff"; fit(label, rh * .48, w * .72, 700); g.fillText(label, w * .04 + s * 1.35, y);
    const wd = WORDS.find(([r]) => r.test(label)); if (wd) { g.globalAlpha = .55; g.font = `600 ${rh * .24}px ${FONT}`; g.textAlign = "right"; g.fillText(wd[1].toUpperCase(), w * .96, y); g.globalAlpha = 1; }
  });
  return true;
}
