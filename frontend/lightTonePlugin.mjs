// Light tone generator.
//
// The neon terminal stylesheets hard-code their dark palette in thousands of
// declarations. Rather than fork every file, this PostCSS plugin writes a
// light counterpart for each colour-bearing declaration, scoped under
// :root[data-tone="light"], directly after the original rule. Colours are
// remapped in OKLCH: hue is kept, lightness is folded so dark surfaces become
// soft cool whites (elevated panels whitest), light ink becomes toned-down
// slate, and neon accents become deeper, readable shades. Hand-tuned rules in
// files marked `tone:manual` are left untouched and are applied on top.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const TONE = '[data-tone="light"]';
const SKIP_MARK = "tone:manual";
const COLOR_PROP = /^(color|background(-color|-image)?|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|border-(block|inline)-(start|end)-color|outline(-color)?|box-shadow|text-shadow|fill|stroke|caret-color|text-decoration(-color)?|column-rule(-color)?|accent-color|filter|stop-color|flood-color|-webkit-text-fill-color|-webkit-text-stroke(-color)?|scrollbar-color|color-scheme)$/i;
const SHADOW_PROP = /^(box-shadow|text-shadow)$/i;
const NAMED = { white: "#ffffff", black: "#000000", red: "#ff0000", blue: "#0000ff", green: "#008000", yellow: "#ffff00", orange: "#ffa500", gray: "#808080", grey: "#808080", silver: "#c0c0c0", gold: "#ffd700", cyan: "#00ffff", magenta: "#ff00ff", lime: "#00ff00", pink: "#ffc0cb", purple: "#800080", violet: "#ee82ee", navy: "#000080", teal: "#008080", aqua: "#00ffff", whitesmoke: "#f5f5f5", gainsboro: "#dcdcdc" };
const COLOR_RE = new RegExp(String.raw`#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^()]*\)|\b(?:${Object.keys(NAMED).join("|")})\b`, "gi");

// ---- colour maths -------------------------------------------------------
const lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const gam = c => c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
function toOklch([r, g, b]) {
  r = lin(r); g = lin(g); b = lin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}
function fromOklch(L, C, h) {
  const A = C * Math.cos(h), B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
function inGamut(L, C, h) {
  let lo = 0, hi = C;
  if (fromOklch(L, C, h).every(v => v >= -1e-4 && v <= 1 + 1e-4)) return fromOklch(L, C, h);
  for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (fromOklch(L, mid, h).every(v => v >= -1e-4 && v <= 1 + 1e-4)) lo = mid; else hi = mid; }
  return fromOklch(L, lo, h);
}
// Lightness fold: page (darkest) -> cool off-white, panels (slightly lighter in
// the dark theme) -> white, hovers/lines -> soft greys, ink -> deep slate.
const KNOTS = [[0, .952], [.1, .958], [.14, .968], [.17, .988], [.2, .996], [.235, .976], [.28, .948], [.34, .905], [.42, .84], [.5, .74], [.58, .64], [.66, .555], [.74, .48], [.82, .41], [.9, .33], [.96, .255], [1, .22]];
const TEXT_KNOTS = L => L >= .95 ? .24 : L >= .85 ? .24 + (.95 - L) * .9 : L >= .7 ? .33 + (.85 - L) * .8 : Math.min(.54, .45 + (.7 - L) * .45);
function foldL(L) {
  if (L <= 0) return KNOTS[0][1];
  for (let i = 1; i < KNOTS.length; i++) {
    const [x1, y1] = KNOTS[i];
    if (L <= x1) { const [x0, y0] = KNOTS[i - 1]; return y0 + (y1 - y0) * (L - x0) / (x1 - x0); }
  }
  return KNOTS[KNOTS.length - 1][1];
}
function parse(token) {
  let t = token.toLowerCase();
  if (NAMED[t]) t = NAMED[t];
  if (t[0] === "#") {
    let h = t.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = i => parseInt(h.slice(i, i + 2), 16) / 255;
    return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
  }
  const m = t.match(/^(rgba?|hsla?)\((.*)\)$/);
  if (!m || /var\(|calc\(/.test(m[2])) return null;
  const parts = m[2].replace(/\//g, " ").split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const num = (v, scale) => v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v) / scale;
  const alpha = parts[3] != null ? num(parts[3], 1) : 1;
  if (m[1].startsWith("rgb")) return [num(parts[0], 255), num(parts[1], 255), num(parts[2], 255), alpha];
  const H = parseFloat(parts[0]) / 360, S = num(parts[1], 100), Lh = num(parts[2], 100);
  const q = Lh < .5 ? Lh * (1 + S) : Lh + S - Lh * S, p = 2 * Lh - q;
  const hue = t2 => { t2 = (t2 + 1) % 1; return t2 < 1 / 6 ? p + (q - p) * 6 * t2 : t2 < .5 ? q : t2 < 2 / 3 ? p + (q - p) * (2 / 3 - t2) * 6 : p; };
  return [hue(H + 1 / 3), hue(H), hue(H - 1 / 3), alpha];
}
function format([r, g, b], a) {
  const c = v => Math.round(Math.min(1, Math.max(0, gam(Math.min(1, Math.max(0, v))))) * 255);
  if (a >= 0.999) return "#" + [r, g, b].map(v => c(v).toString(16).padStart(2, "0")).join("");
  return `rgba(${c(r)},${c(g)},${c(b)},${Math.round(a * 1000) / 1000})`;
}
export function lightColor(token, role = "paint") {
  const rgba = parse(token);
  if (!rgba) return token;
  const [L, C, h] = toOklch(rgba);
  let a = rgba[3];
  if (role === "shadow") {
    // Depth shadows become soft slate; neon glows keep hue but lose most force.
    if (L < 0.45) return format(inGamut(.28, Math.min(C, .03), h), a * .16);
    return format(inGamut(Math.min(foldL(L), .62), C * .8, h), a * .38);
  }
  let L2 = foldL(L), C2 = C;
  if (role === "text") {
    // Text needs AA contrast on white even at 8-11px: every ink lands at or
    // below L .54 (~4.6:1 on white), quiet labels included; faint text gains alpha.
    if (L > .3) L2 = Math.min(L2, TEXT_KNOTS(L));
    if (a < 1) a = Math.min(1, a * 1.25 + .22);
  }
  // Vivid signal colours (neon green, amber, cyan) keep a mid lightness so they
  // stay recognisably themselves on white instead of sinking to brown/olive.
  if (C > .09 && L > .55) L2 = Math.min(.58, Math.max(.47, L2));
  if (L2 > .93) C2 = Math.min(C * .45, .011);          // surfaces: almost neutral, cool
  else if (L2 > .8) C2 = Math.min(C * .6, .03);        // lines and quiet fills
  else if (L2 < .36) C2 = Math.min(C * .55, .045);     // ink: toned, not tinted
  else C2 = Math.min(C * .92, .2);                      // accents: deep but alive
  // Translucent light veils (white-on-dark highlights) become ink veils of the
  // same weight; very faint dark veils (vignettes) fade further on white.
  if (a < 1 && L < .3) a *= .7;
  return format(inGamut(L2, C2, h), a);
}
const TEXT_PROP = /^(color|-webkit-text-fill-color|caret-color|text-decoration-color|--(text|ink)[\w-]*|--[\w-]*-(text|ink|muted|label|fg)(-[\w-]*)?)$/i;
export function lightValue(value, prop = "") {
  const role = SHADOW_PROP.test(prop) || /drop-shadow/.test(value) ? "shadow" : TEXT_PROP.test(prop) ? "text" : "paint";
  if (/^color-scheme$/i.test(prop)) return value.replace(/\bdark\b/g, "light");
  if (role === "shadow" && /drop-shadow/.test(value) && !SHADOW_PROP.test(prop)) {
    return value.replace(/drop-shadow\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g, (_m, inner) => `drop-shadow(${inner.replace(COLOR_RE, t => lightColor(t, "shadow"))})`);
  }
  return value.replace(COLOR_RE, t => lightColor(t, role));
}

// ---- keyframes registry (animations whose frames carry colour) ----------
function scanKeyframes(root) {
  const names = new Set();
  const walk = dir => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!full.endsWith(".css")) continue;
      const text = readFileSync(full, "utf8");
      if (text.includes(SKIP_MARK)) continue;
      const re = /@keyframes\s+([\w-]+)\s*\{/g; let m;
      while ((m = re.exec(text))) {
        let depth = 1, i = re.lastIndex;
        while (i < text.length && depth) { if (text[i] === "{") depth++; else if (text[i] === "}") depth--; i++; }
        const body = text.slice(re.lastIndex, i);
        if (/(?:^|[;{\s])(?:color|background[\w-]*|border[\w-]*|box-shadow|text-shadow|fill|stroke|filter|outline[\w-]*)\s*:[^;}]*(#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\bwhite\b|\bblack\b)/i.test(body)) names.add(m[1]);
      }
    }
  };
  walk(root);
  return names;
}

function toneSelector(sel) {
  const s = sel.trim();
  if (/^html\b/.test(s)) return s.replace(/^html/, `html${TONE}`);
  if (/^:root\b/.test(s)) return s.replace(/^:root/, `:root${TONE}`);
  // Attributes and classes that live on <html> itself merge into :root.
  const m = s.match(/^([^\s>+~]+)([\s\S]*)$/);
  if (m && /^(?:\[data-(?:theme|design|fx|frame-light|backdrop|tone)[^\]]*\]|\.(?:js|is-mm|pb-ship-hover|re-page-covered)(?![\w-]))+$/.test(m[1])) return `:root${TONE}${m[1]}${m[2]}`;
  return `:root${TONE} ${s}`;
}

export default function lightTone({ include }) {
  const animated = scanKeyframes(include);
  const ANIM_NAMES = new RegExp(`\\b(${[...animated].map(n => n.replace(/[-]/g, "\\-")).join("|") || "\\u0000"})\\b`, "g");
  return {
    postcssPlugin: "kstock-light-tone",
    Once(root) {
      const file = root.source?.input?.file ?? "";
      if (!file || !path.resolve(file).startsWith(path.resolve(include)) || !file.endsWith(".css")) return;
      if (root.toString().includes(SKIP_MARK)) return;
      const additions = [];
      root.walkAtRules(/keyframes$/i, rule => {
        if (!animated.has(rule.params.trim())) return;
        const copy = rule.clone({ params: `${rule.params.trim()}--lt` });
        copy.walkDecls(decl => { if (COLOR_PROP.test(decl.prop) || decl.prop.startsWith("--")) decl.value = lightValue(decl.value, decl.prop); });
        additions.push([rule, copy]);
      });
      root.walkRules(rule => {
        if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
        for (let p = rule.parent; p && p.type !== "root"; p = p.parent) if (p.type === "atrule" && /^(media)$/i.test(p.name) && /\bprint\b/.test(p.params) && !/screen/.test(p.params)) return;
        const decls = [];
        rule.each(node => {
          if (node.type !== "decl") return;
          const prop = node.prop;
          if (prop.startsWith("--")) {
            if (COLOR_RE.test(node.value) || /var\(/.test(node.value)) { COLOR_RE.lastIndex = 0; decls.push(node.clone({ value: lightValue(node.value, prop) })); }
            COLOR_RE.lastIndex = 0;
            return;
          }
          if (/^(animation|animation-name)$/i.test(prop) && animated.size) {
            ANIM_NAMES.lastIndex = 0;
            if (ANIM_NAMES.test(node.value)) { ANIM_NAMES.lastIndex = 0; decls.push(node.clone({ value: node.value.replace(ANIM_NAMES, "$1--lt") })); }
            return;
          }
          if (COLOR_PROP.test(prop)) decls.push(node.clone({ value: lightValue(node.value, prop) }));
        });
        if (!decls.length) return;
        const copy = rule.clone({ selectors: rule.selectors.map(toneSelector) });
        copy.removeAll();
        decls.forEach(d => copy.append(d));
        additions.push([rule, copy]);
      });
      for (const [after, node] of additions.reverse()) after.after(node);
    },
  };
}
lightTone.postcss = true;
