/** Canvas artwork only: every sign still shares the floor's single atlas/material. */
const FONT = 'Pretendard, "Noto Sans KR", "Malgun Gothic", sans-serif';
export function labelHash(s: string) { let n = 2166136261; for (const c of s) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; }
const WORDS: [RegExp, string, string][] = [
  [/화장실|남자|여자/, "Restroom", "wc"], [/엘리베이터|승강기/, "Elevator", "lift"], [/계단/, "Stairs", "stairs"],
  [/약국|조제/, "Pharmacy", "cross"], [/카페|커피/, "Cafe", "cup"], [/안내|접수|프런트/, "Information", "info"],
  [/검사|채혈/, "Laboratory", "flask"], [/영상|촬영/, "Imaging", "scan"], [/진료|의원|치료/, "Clinic", "cross"],
  [/병실|입원/, "Ward", "bed"], [/대기|휴게/, "Lounge", "seat"], [/창고|보관/, "Storage", "box"], [/주차/, "Parking", "parking"],
];
function icon(g: CanvasRenderingContext2D, kind: string, x: number, y: number, s: number, text: string) {
  g.save(); g.translate(x, y); g.scale(s, s); g.lineWidth = .065; g.lineCap = "round"; g.lineJoin = "round";
  const path = (p: number[][]) => { g.beginPath(); p.forEach(([a, b], i) => i ? g.lineTo(a, b) : g.moveTo(a, b)); g.stroke(); };
  if (kind === "cross") { g.fillRect(.37, .1, .26, .8); g.fillRect(.1, .37, .8, .26); }
  else if (kind === "wc") { const people = /남/.test(text) ? [.5] : /여/.test(text) ? [.5] : [.25, .75]; for (const a of people) { g.beginPath(); g.arc(a, .18, .095, 0, Math.PI * 2); g.fill(); if (/여/.test(text) || a === .75) path([[a, .35], [a - .15, .65], [a + .15, .65], [a, .35]]); else path([[a - .1, .63], [a - .1, .36], [a + .1, .36], [a + .1, .63]]); path([[a - .06, .65], [a - .06, .9]]); path([[a + .06, .65], [a + .06, .9]]); } }
  else if (kind === "stairs") path([[.08, .87], [.28, .87], [.28, .63], [.5, .63], [.5, .4], [.72, .4], [.72, .16], [.94, .16]]);
  else if (kind === "lift") { g.strokeRect(.18, .3, .64, .62); path([[.5, .35], [.5, .85]]); path([[.25, .2], [.35, .08], [.45, .2]]); path([[.58, .08], [.68, .2], [.78, .08]]); }
  else if (kind === "cup") { path([[.16, .35], [.22, .8], [.7, .8], [.76, .35], [.16, .35]]); path([[.78, .4], [.94, .4], [.94, .62], [.75, .62]]); path([[.28, .12], [.33, .24]]); path([[.55, .12], [.6, .24]]); }
  else if (kind === "flask") path([[.35, .12], [.65, .12], [.59, .12], [.59, .4], [.86, .85], [.14, .85], [.41, .4], [.41, .12]]);
  else if (kind === "bed") { path([[.12, .2], [.12, .85]]); path([[.12, .65], [.9, .65], [.9, .85]]); g.strokeRect(.3, .4, .6, .25); g.strokeRect(.16, .35, .14, .2); }
  else if (kind === "seat") { path([[.2, .15], [.2, .65], [.85, .65]]); path([[.28, .65], [.28, .9]]); path([[.78, .65], [.78, .9]]); }
  else if (kind === "scan") { g.strokeRect(.12, .12, .76, .76); g.beginPath(); g.arc(.5, .5, .24, 0, Math.PI * 2); g.stroke(); }
  else if (kind === "box") { g.strokeRect(.15, .25, .7, .6); path([[.15, .25], [.5, .1], [.85, .25]]); path([[.5, .25], [.5, .5]]); }
  else { g.font = `800 .9px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(kind === "parking" ? "P" : "i", .5, .53); }
  g.restore();
}
export function paintSpecial(g: CanvasRenderingContext2D, style: string, lines: string[], w: number, h: number, accent: string): boolean {
  if (!["plate", "fascia", "notice", "wayfinding"].includes(style)) return false;
  const main = lines[0] ?? "", hash = labelHash(main), v = hash % (style === "fascia" ? 5 : 4);
  const word = WORDS.find(([r]) => r.test(main));
  const fit = (t: string, size: number, max: number, weight = 700) => { g.font = `${weight} ${size}px ${FONT}`; const width = g.measureText(t).width; if (width > max) g.font = `${weight} ${Math.max(5, size * max / width)}px ${FONT}`; };
  let bg = "#edf5fa", fg = "#101f30";
  if (style === "plate") { if (v === 1) { bg = "#142231"; fg = "#e9faff"; } if (v === 2) { bg = accent; fg = "#ffffff"; } }
  if (style === "fascia") { bg = [accent, "#090f19", "#c9d6dd", "#071621", "#45342b"][v]; fg = v === 2 ? "#172a36" : "#eaffff"; }
  if (style === "notice" || style === "wayfinding") { bg = "#102534"; fg = "#e2faff"; }
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  if (style === "fascia" && v === 0) { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, "#ffffff33"); gr.addColorStop(1, "#00000077"); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
  if (style === "fascia" && (v === 2 || v === 4)) { g.strokeStyle = v === 4 ? "#b08b5e44" : "#ffffff55"; g.lineWidth = 1; for (let i = 1; i < 7; i++) { g.beginPath(); g.moveTo(0, h * i / 7); g.lineTo(w, h * i / 7 + (v === 4 ? 2 : 0)); g.stroke(); } }
  g.strokeStyle = accent; g.lineWidth = Math.max(1, h * .022);
  if (style === "plate" && v === 0) { g.fillStyle = accent; g.fillRect(0, 0, w * .035, h); }
  else g.strokeRect(w * .018, h * .05, w * .964, h * .9);
  g.fillStyle = fg; g.strokeStyle = fg; g.textBaseline = "middle";
  if (style === "wayfinding") {
    g.textAlign = "left";
    lines.slice(0, 3).forEach((t, i, a) => { fit(t, h / a.length * .58, w * .9); g.fillText(t, w * .05, h * (i + .5) / a.length); }); return true;
  }
  if (style === "notice") {
    g.fillStyle = accent; g.fillRect(0, 0, w, h * .08); g.fillStyle = fg; g.textAlign = "center";
    g.font = `800 ${h * .17}px ${FONT}`; g.fillText(/금연/.test(main) ? "⊘" : /손/.test(main) ? "+" : "i", w / 2, h * .27);
    fit(main, h * .12, w * .85, 800); g.fillText(main, w / 2, h * .51);
    lines.slice(1, 4).forEach((t, i) => { fit(t, h * .065, w * .84, 500); g.fillText(t, w / 2, h * (.69 + i * .1)); }); return true;
  }
  const hasIcon = style === "plate" && word;
  if (hasIcon) icon(g, word[2], h * .18, h * .18, h * .64, main);
  const left = hasIcon ? h * 1.02 : w * .07, tw = w - left - w * .06, tx = left + tw / 2;
  const sub = style === "plate" ? [word?.[1], lines[1]].filter(Boolean).join(" · ") : lines[1];
  g.textAlign = "center";
  if (style === "fascia" && (v === 1 || v === 3)) { g.shadowColor = v === 3 ? "#32edff" : "#ffffff"; g.shadowBlur = h * .12; }
  fit(main, h * (sub ? .4 : .55), tw, 800); g.fillText(main, tx, h * (sub ? .39 : .5));
  g.shadowBlur = 0;
  if (sub) { g.globalAlpha = .8; fit(sub, h * .2, tw, 500); g.fillText(sub, tx, h * .76); g.globalAlpha = 1; }
  return true;
}
