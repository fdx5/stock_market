import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/* Block-figure people, as in the popular building games: a rounded cube of a head with a painted
 * face, a box torso wearing a printed shirt, box limbs, and the hair, hats and things they carry
 * made of the same chunky pieces. Dozens of characters from a few tables — faces, prints, hair,
 * hats, accessories, colourways — and the jobs' own outfits (a doctor's coat, a chef's hat, a
 * guard's cap). Every face and print is painted once into one shared atlas, so every person on a
 * floor uses the same material. Jointed as the walker's figure is (avatar.ts poses it). */

const CELL = 128, SIZE = 2048, PER = SIZE / CELL;
type UV = [number, number, number, number];
const FONT = 'Pretendard, "Noto Sans KR", "Malgun Gothic", sans-serif';

class CharacterAtlas {
  readonly canvas = document.createElement("canvas");
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshPhysicalMaterial;
  private g: CanvasRenderingContext2D;
  private cells = new Map<string, number>();
  private next = 0;
  private sw = new Map<string, UV>(); private swNext = 0;
  constructor() {
    this.canvas.width = this.canvas.height = SIZE;
    this.g = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.anisotropy = 8;
    // (a satin plastic, as such figures are: a soft highlight, a little clearcoat)
    this.material = new THREE.MeshPhysicalMaterial({ map: this.texture, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.35, alphaTest: 0.5, side: THREE.DoubleSide });
  }
  cell(key: string, paint: (g: CanvasRenderingContext2D, s: number) => void): UV {
    let i = this.cells.get(key);
    if (i === undefined) {
      i = this.next++ % (PER * (PER - 1)); this.cells.set(key, i);
      const x = (i % PER) * CELL, y = Math.floor(i / PER) * CELL, g = this.g;
      g.save(); g.clearRect(x, y, CELL, CELL); g.translate(x, y); g.beginPath(); g.rect(0, 0, CELL, CELL); g.clip(); paint(g, CELL); g.restore();
      this.texture.needsUpdate = true;
    }
    const x = (i % PER) * CELL, y = Math.floor(i / PER) * CELL, k = 2;
    return [(x + k) / SIZE, 1 - (y + CELL - k) / SIZE, (x + CELL - k) / SIZE, 1 - (y + k) / SIZE];
  }
  swatch(c: string): UV {
    let s = this.sw.get(c);
    if (!s) {
      const n = this.swNext++ % 4096, x = (n % 256) * 8, y = SIZE - CELL + Math.floor(n / 256) * 8;
      this.g.fillStyle = c; this.g.fillRect(x, y, 8, 8); this.texture.needsUpdate = true;
      s = [(x + 3) / SIZE, 1 - (y + 5) / SIZE, (x + 5) / SIZE, 1 - (y + 3) / SIZE]; this.sw.set(c, s);
    }
    return s;
  }
}
let atlas: CharacterAtlas | null = null;
/** the shared atlas (kept for the session: a few MB, every figure's faces and prints) */
export const characterAtlas = () => (atlas ??= new CharacterAtlas());

// ------------------------------------------------------------------ painting
const mix = (a: string, b: string, k: number) => { const p = (s: string) => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) || 0); const A = p(a), B = p(b); return `#${A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, "0")).join("")}`; };
const luma = (c: string) => { const v = parseInt(c.slice(1), 16); return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255; };

export const EYES = ["dots", "shine", "happy", "wink", "big", "sleepy", "shades", "glasses", "angry", "surprised", "star", "lashes"] as const;
export const MOUTHS = ["smile", "grin", "smirk", "o", "tongue", "flat", "cat", "teeth", "laugh", "pout"] as const;
export const EXTRAS = ["none", "blush", "freckles", "mustache", "stubble", "none", "blush", "none"] as const;
function paintFace(g: CanvasRenderingContext2D, S: number, eyes: string, mouth: string, extra: string) {
  const ink = "#1b1b1f";
  g.lineCap = "round"; g.lineJoin = "round";
  const eye = (cx: number) => {
    const cy = S * 0.42;
    g.fillStyle = ink; g.strokeStyle = ink; g.lineWidth = S * 0.035;
    switch (eyes) {
      case "dots": g.beginPath(); g.ellipse(cx, cy, S * 0.04, S * 0.06, 0, 0, Math.PI * 2); g.fill(); break;
      case "shine": case "lashes": case "big": {
        const rx = eyes === "big" ? S * 0.075 : S * 0.055, ry = eyes === "big" ? S * 0.1 : S * 0.075;
        g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#ffffff"; g.beginPath(); g.ellipse(cx + rx * 0.3, cy - ry * 0.35, rx * 0.35, ry * 0.3, 0, 0, Math.PI * 2); g.fill();
        if (eyes === "big") { g.fillStyle = "#5aa0ff"; g.globalAlpha = 0.5; g.beginPath(); g.ellipse(cx, cy + ry * 0.4, rx * 0.6, ry * 0.3, 0, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
        if (eyes === "lashes") { g.strokeStyle = ink; g.lineWidth = S * 0.022; for (const k of [-1, 0, 1]) { g.beginPath(); g.moveTo(cx + k * rx * 0.6, cy - ry * 0.9); g.lineTo(cx + k * rx * 0.9, cy - ry * 1.35); g.stroke(); } }
        break;
      }
      case "happy": g.beginPath(); g.arc(cx, cy + S * 0.02, S * 0.05, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); break;
      case "wink": if (cx < S / 2) { g.beginPath(); g.ellipse(cx, cy, S * 0.045, S * 0.065, 0, 0, Math.PI * 2); g.fill(); } else { g.beginPath(); g.moveTo(cx - S * 0.05, cy); g.lineTo(cx + S * 0.05, cy - S * 0.02); g.stroke(); } break;
      case "sleepy": g.beginPath(); g.moveTo(cx - S * 0.05, cy + S * 0.01); g.lineTo(cx + S * 0.05, cy + S * 0.01); g.stroke(); g.globalAlpha = 0.5; g.beginPath(); g.arc(cx, cy - S * 0.01, S * 0.05, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); g.globalAlpha = 1; break;
      case "angry": g.beginPath(); g.ellipse(cx, cy + S * 0.01, S * 0.04, S * 0.05, 0, 0, Math.PI * 2); g.fill(); g.lineWidth = S * 0.04; g.beginPath(); g.moveTo(cx - S * 0.07, cy - S * (cx < S / 2 ? 0.1 : 0.05)); g.lineTo(cx + S * 0.07, cy - S * (cx < S / 2 ? 0.05 : 0.1)); g.stroke(); break;
      case "surprised": g.beginPath(); g.arc(cx, cy, S * 0.06, 0, Math.PI * 2); g.fillStyle = "#ffffff"; g.fill(); g.stroke(); g.fillStyle = ink; g.beginPath(); g.arc(cx, cy, S * 0.025, 0, Math.PI * 2); g.fill(); break;
      case "star": g.fillStyle = "#f6c945"; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? S * 0.03 : S * 0.07, t = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(cx + Math.cos(t) * r, cy + Math.sin(t) * r); } g.closePath(); g.fill(); g.strokeStyle = ink; g.lineWidth = S * 0.012; g.stroke(); break;
      default: break;
    }
  };
  if (eyes === "shades") { g.fillStyle = "#0e0f12"; g.beginPath(); g.roundRect(S * 0.18, S * 0.34, S * 0.27, S * 0.14, S * 0.05); g.roundRect(S * 0.55, S * 0.34, S * 0.27, S * 0.14, S * 0.05); g.fill(); g.fillRect(S * 0.44, S * 0.37, S * 0.12, S * 0.03); g.fillStyle = "rgba(255,255,255,.45)"; g.fillRect(S * 0.22, S * 0.36, S * 0.06, S * 0.025); g.fillRect(S * 0.59, S * 0.36, S * 0.06, S * 0.025); }
  else if (eyes === "glasses") { eye(S * 0.33); eyes = "dots"; eye(S * 0.33); eye(S * 0.67); g.strokeStyle = "#2a2a30"; g.lineWidth = S * 0.025; g.beginPath(); g.arc(S * 0.33, S * 0.42, S * 0.11, 0, Math.PI * 2); g.moveTo(S * 0.78, S * 0.42); g.arc(S * 0.67, S * 0.42, S * 0.11, 0, Math.PI * 2); g.moveTo(S * 0.44, S * 0.41); g.lineTo(S * 0.56, S * 0.41); g.stroke(); }
  else { eye(S * 0.33); eye(S * 0.67); }
  // brows (a few faces)
  if (eyes === "dots" || eyes === "shine") { g.strokeStyle = ink; g.lineWidth = S * 0.028; for (const cx of [S * 0.33, S * 0.67]) { g.beginPath(); g.moveTo(cx - S * 0.06, S * 0.3); g.quadraticCurveTo(cx, S * 0.27, cx + S * 0.06, S * 0.3); g.stroke(); } }
  // mouth
  const my = S * 0.66; g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = S * 0.035;
  switch (mouth) {
    case "smile": g.beginPath(); g.arc(S / 2, my - S * 0.06, S * 0.12, Math.PI * 0.2, Math.PI * 0.8); g.stroke(); break;
    case "grin": case "laugh": g.beginPath(); g.moveTo(S * 0.36, my - S * 0.02); g.quadraticCurveTo(S / 2, my + (mouth === "laugh" ? S * 0.2 : S * 0.14), S * 0.64, my - S * 0.02); g.closePath(); g.fill(); g.fillStyle = "#ffffff"; g.fillRect(S * 0.39, my - S * 0.015, S * 0.22, S * 0.03); if (mouth === "laugh") { g.fillStyle = "#e0606e"; g.beginPath(); g.ellipse(S / 2, my + S * 0.08, S * 0.06, S * 0.03, 0, 0, Math.PI * 2); g.fill(); } break;
    case "smirk": g.beginPath(); g.moveTo(S * 0.4, my); g.quadraticCurveTo(S * 0.55, my + S * 0.04, S * 0.63, my - S * 0.04); g.stroke(); break;
    case "o": g.beginPath(); g.ellipse(S / 2, my, S * 0.04, S * 0.05, 0, 0, Math.PI * 2); g.fill(); break;
    case "tongue": g.beginPath(); g.arc(S / 2, my - S * 0.06, S * 0.11, Math.PI * 0.15, Math.PI * 0.85); g.stroke(); g.fillStyle = "#e0606e"; g.beginPath(); g.ellipse(S * 0.55, my + S * 0.05, S * 0.04, S * 0.05, 0, 0, Math.PI * 2); g.fill(); break;
    case "flat": g.beginPath(); g.moveTo(S * 0.42, my); g.lineTo(S * 0.58, my); g.stroke(); break;
    case "cat": g.beginPath(); g.arc(S * 0.45, my - S * 0.01, S * 0.05, 0, Math.PI); g.arc(S * 0.55, my - S * 0.01, S * 0.05, 0, Math.PI); g.stroke(); break;
    case "teeth": g.beginPath(); g.roundRect(S * 0.38, my - S * 0.04, S * 0.24, S * 0.08, S * 0.03); g.fill(); g.fillStyle = "#ffffff"; g.fillRect(S * 0.41, my - S * 0.025, S * 0.18, S * 0.05); g.strokeStyle = ink; g.lineWidth = S * 0.01; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(S * (0.41 + i * 0.045), my - S * 0.025); g.lineTo(S * (0.41 + i * 0.045), my + S * 0.025); g.stroke(); } break;
    case "pout": g.fillStyle = "#c45a6a"; g.beginPath(); g.ellipse(S / 2, my, S * 0.05, S * 0.035, 0, 0, Math.PI * 2); g.fill(); break;
  }
  if (extra === "blush") { g.fillStyle = "rgba(255,110,140,.45)"; for (const cx of [S * 0.24, S * 0.76]) { g.beginPath(); g.ellipse(cx, S * 0.56, S * 0.07, S * 0.04, 0, 0, Math.PI * 2); g.fill(); } }
  if (extra === "freckles") { g.fillStyle = "rgba(120,70,40,.7)"; for (const [x, y] of [[0.24, 0.53], [0.29, 0.57], [0.21, 0.58], [0.76, 0.53], [0.71, 0.57], [0.79, 0.58]]) { g.beginPath(); g.arc(S * x, S * y, S * 0.012, 0, Math.PI * 2); g.fill(); } }
  if (extra === "mustache") { g.fillStyle = "#3a2a20"; g.beginPath(); g.ellipse(S * 0.43, S * 0.58, S * 0.08, S * 0.03, -0.2, 0, Math.PI * 2); g.ellipse(S * 0.57, S * 0.58, S * 0.08, S * 0.03, 0.2, 0, Math.PI * 2); g.fill(); }
  if (extra === "stubble") { g.fillStyle = "rgba(40,30,25,.25)"; g.beginPath(); g.ellipse(S / 2, S * 0.74, S * 0.24, S * 0.14, 0, 0, Math.PI); g.fill(); }
}

export const PRINTS = ["plain", "stripes", "star", "heart", "number", "word", "bolt", "smile", "planet", "camo", "checker", "hoodie", "suit", "overall", "floral", "jersey", "coat", "scrubs", "chef", "guard", "apron", "uniform", "gown", "tiedye", "pixel", "gradient"] as const;
export type Print = (typeof PRINTS)[number];
const WORDS = ["SEOUL", "HAPPY", "GAME ON", "LOVE", "COOL", "K-CITY", "HELLO", "BUSAN", "RUN!", "LUCKY", "DREAM", "VIBES"];
function paintShirt(g: CanvasRenderingContext2D, S: number, print: Print, a: string, b: string, seed: number) {
  const ink = luma(a) > 0.6 ? "#1c1c1f" : "#ffffff";
  g.fillStyle = a; g.fillRect(0, 0, S, S);
  // (a soft fold shading for every shirt)
  const sh = g.createLinearGradient(0, 0, S, 0); sh.addColorStop(0, "rgba(0,0,0,.12)"); sh.addColorStop(0.5, "rgba(255,255,255,.06)"); sh.addColorStop(1, "rgba(0,0,0,.12)"); g.fillStyle = sh; g.fillRect(0, 0, S, S);
  const neck = () => { g.fillStyle = mix(a, "#000000", 0.25); g.beginPath(); g.moveTo(S * 0.36, 0); g.quadraticCurveTo(S / 2, S * 0.14, S * 0.64, 0); g.fill(); };
  switch (print) {
    case "stripes": g.fillStyle = b; for (let y = S * 0.12; y < S; y += S * 0.16) g.fillRect(0, y, S, S * 0.07); neck(); break;
    case "star": neck(); g.fillStyle = b; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? S * 0.12 : S * 0.27, t = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(S / 2 + Math.cos(t) * r, S * 0.52 + Math.sin(t) * r); } g.closePath(); g.fill(); break;
    case "heart": neck(); g.fillStyle = b; g.beginPath(); g.moveTo(S / 2, S * 0.78); g.bezierCurveTo(S * 0.1, S * 0.5, S * 0.28, S * 0.22, S / 2, S * 0.4); g.bezierCurveTo(S * 0.72, S * 0.22, S * 0.9, S * 0.5, S / 2, S * 0.78); g.fill(); break;
    case "number": neck(); g.fillStyle = b; g.font = `900 ${S * 0.5}px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(seed % 99 + 1), S / 2, S * 0.56); break;
    case "word": { neck(); const w = WORDS[seed % WORDS.length]; g.fillStyle = b; g.font = `900 ${S * 0.2}px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle"; let s = S * 0.2; while (g.measureText(w).width > S * 0.86 && s > 8) { s -= 2; g.font = `900 ${s}px ${FONT}`; } g.fillText(w, S / 2, S * 0.5); g.fillRect(S * 0.2, S * 0.64, S * 0.6, S * 0.03); break; }
    case "bolt": neck(); g.fillStyle = b; g.beginPath(); g.moveTo(S * 0.58, S * 0.2); g.lineTo(S * 0.3, S * 0.56); g.lineTo(S * 0.48, S * 0.56); g.lineTo(S * 0.4, S * 0.86); g.lineTo(S * 0.72, S * 0.46); g.lineTo(S * 0.54, S * 0.46); g.closePath(); g.fill(); break;
    case "smile": neck(); g.fillStyle = "#f6c945"; g.beginPath(); g.arc(S / 2, S * 0.52, S * 0.24, 0, Math.PI * 2); g.fill(); g.fillStyle = "#1c1c1f"; g.beginPath(); g.arc(S * 0.42, S * 0.46, S * 0.03, 0, 7); g.arc(S * 0.58, S * 0.46, S * 0.03, 0, 7); g.fill(); g.strokeStyle = "#1c1c1f"; g.lineWidth = S * 0.03; g.beginPath(); g.arc(S / 2, S * 0.52, S * 0.13, 0.3, Math.PI - 0.3); g.stroke(); break;
    case "planet": neck(); g.fillStyle = b; g.beginPath(); g.arc(S / 2, S * 0.52, S * 0.17, 0, Math.PI * 2); g.fill(); g.strokeStyle = mix(b, "#ffffff", 0.4); g.lineWidth = S * 0.04; g.beginPath(); g.ellipse(S / 2, S * 0.52, S * 0.32, S * 0.08, -0.35, 0, Math.PI * 2); g.stroke(); for (let i = 0; i < 6; i++) { g.fillStyle = "#ffffff"; g.fillRect(((seed * 31 + i * 47) % 100) / 100 * S, ((seed * 17 + i * 71) % 100) / 100 * S, 3, 3); } break;
    case "camo": for (let i = 0; i < 26; i++) { g.fillStyle = [b, mix(a, "#000000", 0.3), mix(b, "#ffffff", 0.2)][i % 3]; g.beginPath(); g.ellipse(((seed * 13 + i * 37) % 100) / 100 * S, ((seed * 7 + i * 53) % 100) / 100 * S, S * 0.12, S * 0.07, i, 0, Math.PI * 2); g.fill(); } neck(); break;
    case "checker": { const n = 6; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if ((i + j) % 2) { g.fillStyle = b; g.fillRect(i * S / n, j * S / n, S / n, S / n); } neck(); break; }
    case "hoodie": g.fillStyle = mix(a, "#000000", 0.2); g.beginPath(); g.roundRect(S * 0.24, S * 0.58, S * 0.52, S * 0.24, S * 0.06); g.fill(); g.strokeStyle = "#f4f4f1"; g.lineWidth = S * 0.025; g.beginPath(); g.moveTo(S * 0.44, S * 0.05); g.lineTo(S * 0.42, S * 0.34); g.moveTo(S * 0.56, S * 0.05); g.lineTo(S * 0.58, S * 0.34); g.stroke(); g.fillStyle = mix(a, "#000000", 0.3); g.beginPath(); g.moveTo(S * 0.3, 0); g.quadraticCurveTo(S / 2, S * 0.22, S * 0.7, 0); g.fill(); break;
    case "suit": g.fillStyle = "#f4f4f1"; g.beginPath(); g.moveTo(S * 0.34, 0); g.lineTo(S / 2, S * 0.5); g.lineTo(S * 0.66, 0); g.fill(); g.fillStyle = b; g.beginPath(); g.moveTo(S * 0.47, S * 0.06); g.lineTo(S * 0.53, S * 0.06); g.lineTo(S * 0.56, S * 0.42); g.lineTo(S / 2, S * 0.5); g.lineTo(S * 0.44, S * 0.42); g.fill(); g.strokeStyle = mix(a, "#000000", 0.4); g.lineWidth = S * 0.02; g.beginPath(); g.moveTo(S * 0.34, 0); g.lineTo(S / 2, S * 0.62); g.lineTo(S * 0.66, 0); g.stroke(); g.fillStyle = "#c9a24a"; for (const y of [0.68, 0.82]) { g.beginPath(); g.arc(S / 2, S * y, S * 0.02, 0, 7); g.fill(); } break;
    case "overall": g.fillStyle = b; g.fillRect(S * 0.26, S * 0.4, S * 0.48, S * 0.6); g.fillRect(S * 0.26, 0, S * 0.08, S * 0.45); g.fillRect(S * 0.66, 0, S * 0.08, S * 0.45); g.fillStyle = "#e8c04a"; g.beginPath(); g.arc(S * 0.3, S * 0.42, S * 0.03, 0, 7); g.arc(S * 0.7, S * 0.42, S * 0.03, 0, 7); g.fill(); g.fillStyle = mix(b, "#000000", 0.2); g.fillRect(S * 0.38, S * 0.52, S * 0.24, S * 0.14); break;
    case "floral": for (let i = 0; i < 12; i++) { const cx = ((seed * 11 + i * 41) % 100) / 100 * S, cy = ((seed * 5 + i * 67) % 100) / 100 * S; g.fillStyle = [b, "#ffffff", "#f6c945"][i % 3]; for (let k = 0; k < 5; k++) { const t = k * Math.PI * 2 / 5; g.beginPath(); g.ellipse(cx + Math.cos(t) * S * 0.04, cy + Math.sin(t) * S * 0.04, S * 0.035, S * 0.02, t, 0, Math.PI * 2); g.fill(); } } neck(); break;
    case "jersey": g.fillStyle = b; g.fillRect(0, 0, S * 0.12, S); g.fillRect(S * 0.88, 0, S * 0.12, S); g.font = `900 ${S * 0.42}px ${FONT}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = ink; g.fillText(String((seed % 30) + 1), S / 2, S * 0.56); g.fillStyle = b; g.beginPath(); g.moveTo(S * 0.36, 0); g.lineTo(S / 2, S * 0.14); g.lineTo(S * 0.64, 0); g.fill(); break;
    case "coat": g.fillStyle = "#f6f6f3"; g.fillRect(0, 0, S, S); g.fillStyle = b; g.beginPath(); g.moveTo(S * 0.38, 0); g.lineTo(S / 2, S * 0.36); g.lineTo(S * 0.62, 0); g.fill(); g.strokeStyle = "#c9ccd0"; g.lineWidth = S * 0.02; g.beginPath(); g.moveTo(S / 2, S * 0.36); g.lineTo(S / 2, S); g.stroke(); g.strokeRect(S * 0.62, S * 0.5, S * 0.16, S * 0.12); g.strokeStyle = "#2a2d33"; g.lineWidth = S * 0.025; g.beginPath(); g.arc(S / 2, S * 0.2, S * 0.2, Math.PI * 0.1, Math.PI * 0.9); g.stroke(); g.fillStyle = "#9aa0a8"; g.beginPath(); g.arc(S * 0.4, S * 0.4, S * 0.04, 0, 7); g.fill(); g.fillStyle = "#3a7bd5"; g.fillRect(S * 0.22, S * 0.5, S * 0.14, S * 0.06); break;
    case "scrubs": g.fillStyle = mix(a, "#000000", 0.2); g.beginPath(); g.moveTo(S * 0.34, 0); g.lineTo(S / 2, S * 0.3); g.lineTo(S * 0.66, 0); g.fill(); g.strokeStyle = mix(a, "#000000", 0.25); g.lineWidth = S * 0.02; g.strokeRect(S * 0.18, S * 0.48, S * 0.18, S * 0.14); g.fillStyle = "#ffffff"; g.fillRect(S * 0.6, S * 0.4, S * 0.2, S * 0.07); break;
    case "chef": g.fillStyle = "#f6f6f3"; g.fillRect(0, 0, S, S); g.fillStyle = "#2a2d33"; for (const x of [0.38, 0.62]) for (const y of [0.3, 0.5, 0.7]) { g.beginPath(); g.arc(S * x, S * y, S * 0.025, 0, 7); g.fill(); } g.strokeStyle = "#d8dadc"; g.lineWidth = S * 0.02; g.beginPath(); g.moveTo(S * 0.3, 0); g.lineTo(S * 0.7, S * 0.9); g.stroke(); g.fillStyle = b; g.fillRect(S * 0.3, 0, S * 0.4, S * 0.06); break;
    case "guard": neck(); g.fillStyle = "#e8c04a"; g.beginPath(); g.moveTo(S * 0.7, S * 0.26); g.lineTo(S * 0.82, S * 0.3); g.lineTo(S * 0.82, S * 0.42); g.lineTo(S * 0.76, S * 0.48); g.lineTo(S * 0.7, S * 0.42); g.closePath(); g.fill(); g.fillStyle = "#f4f4f1"; g.font = `800 ${S * 0.09}px ${FONT}`; g.textAlign = "center"; g.fillText("SECURITY", S * 0.42, S * 0.36); g.fillStyle = mix(a, "#000000", 0.35); g.fillRect(0, S * 0.84, S, S * 0.06); break;
    case "apron": g.fillStyle = b; g.beginPath(); g.moveTo(S * 0.26, S * 0.3); g.lineTo(S * 0.74, S * 0.3); g.lineTo(S * 0.8, S); g.lineTo(S * 0.2, S); g.fill(); g.strokeStyle = b; g.lineWidth = S * 0.04; g.beginPath(); g.moveTo(S * 0.3, S * 0.3); g.lineTo(S * 0.38, 0); g.moveTo(S * 0.7, S * 0.3); g.lineTo(S * 0.62, 0); g.stroke(); g.fillStyle = "#ffffff"; g.beginPath(); g.roundRect(S * 0.36, S * 0.42, S * 0.28, S * 0.1, S * 0.03); g.fill(); break;
    case "uniform": g.fillStyle = "#f4f4f1"; g.beginPath(); g.moveTo(S * 0.36, 0); g.lineTo(S / 2, S * 0.36); g.lineTo(S * 0.64, 0); g.fill(); g.fillStyle = b; g.beginPath(); g.moveTo(S * 0.42, S * 0.1); g.lineTo(S * 0.58, S * 0.1); g.lineTo(S / 2, S * 0.24); g.fill(); g.fillStyle = "#e8c04a"; g.beginPath(); g.arc(S * 0.72, S * 0.36, S * 0.05, 0, 7); g.fill(); break;
    case "gown": g.fillStyle = b; for (let x = 0; x < S; x += S * 0.14) g.fillRect(x, 0, S * 0.05, S); neck(); break;
    case "tiedye": { for (let r = S; r > 0; r -= S * 0.08) { g.fillStyle = ["#ff6b9a", "#ffd166", "#06d6a0", "#118ab2", "#9b5de5"][Math.round(r / (S * 0.08)) % 5]; g.beginPath(); g.arc(S / 2, S * 0.55, r, 0, Math.PI * 2); g.fill(); } neck(); break; }
    case "pixel": { neck(); const px = S / 12; const heart = ["0110110", "1111111", "1111111", "0111110", "0011100", "0001000"]; heart.forEach((row, j) => [...row].forEach((c, i) => { if (c === "1") { g.fillStyle = b; g.fillRect(S * 0.29 + i * px, S * 0.3 + j * px, px - 1, px - 1); } })); break; }
    case "gradient": { const gr = g.createLinearGradient(0, 0, 0, S); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, S, S); neck(); break; }
    default: neck();
  }
}
function paintPants(g: CanvasRenderingContext2D, S: number, kind: string, a: string) {
  g.fillStyle = a; g.fillRect(0, 0, S, S);
  if (kind === "jeans") { for (let i = 0; i < 900; i++) { g.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.07)"; g.fillRect(Math.random() * S, Math.random() * S, 2, 1); } g.strokeStyle = "#d9a441"; g.setLineDash([4, 3]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(S * 0.5, 0); g.lineTo(S * 0.5, S); g.moveTo(S * 0.12, S * 0.1); g.quadraticCurveTo(S * 0.3, S * 0.3, S * 0.44, S * 0.12); g.stroke(); g.setLineDash([]); }
  else if (kind === "cargo") { g.fillStyle = mix(a, "#000000", 0.18); g.fillRect(S * 0.06, S * 0.45, S * 0.26, S * 0.2); g.fillRect(S * 0.68, S * 0.45, S * 0.26, S * 0.2); }
  else if (kind === "track") { g.fillStyle = "#f4f4f1"; g.fillRect(S * 0.02, 0, S * 0.06, S); g.fillRect(S * 0.92, 0, S * 0.06, S); }
  g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(S * 0.49, 0, S * 0.02, S);
}

// ------------------------------------------------------------------ characters
export type HairStyle = "buzz" | "short" | "spiky" | "bob" | "long" | "pony" | "bun" | "mohawk" | "afro" | "sidepart" | "twintail" | "bald";
export type Hat = "none" | "cap" | "beanie" | "tophat" | "crown" | "headphones" | "bunny" | "hardhat" | "chef" | "nurse" | "guard" | "beret" | "flower" | "horns";
export type Accessory = "none" | "backpack" | "glasses" | "scarf" | "sword" | "cape" | "wings" | "bag";
export interface Look {
  skin: string; hair: HairStyle; hairColor: string; hat: Hat; hatColor: string;
  eyes: string; mouth: string; extra: string;
  print: Print; shirt: string; shirt2: string; longSleeve: boolean;
  pants: "jeans" | "plain" | "cargo" | "track" | "shorts" | "skirt"; pantsColor: string; shoes: string; acc: Accessory; accColor: string;
}
const SKINS = ["#f6d7b8", "#eec39a", "#d9a37a", "#b9805a", "#8d5a3b", "#f8e0c6", "#ffcc99", "#e8b48a"];
const HAIRC = ["#1c1612", "#3a2618", "#6b4423", "#a0652c", "#d8a548", "#f2d57a", "#e8e4dc", "#c23b3b", "#3b62c2", "#8a4bd6", "#2fb38a", "#f07aa8"];
const BRIGHT = ["#e63946", "#f4a261", "#2a9d8f", "#264653", "#e9c46a", "#8338ec", "#3a86ff", "#ff006e", "#fb5607", "#06d6a0", "#118ab2", "#ef476f", "#ffd166", "#1d3557", "#f1faee", "#2b2d42", "#9b5de5", "#00bbf9", "#80ed99", "#ffadad"];
const DENIM = ["#2f4b7c", "#3d5a80", "#1f2f4f", "#5a6f8f", "#23262c", "#4a4f57", "#8a7a5c", "#3b3b3f"];

/** named characters: the town's regulars, each with a look of its own (the seed adds colours) */
export const CHARACTERS: { name: string; look: Partial<Look> }[] = [
  { name: "스케이터", look: { hair: "spiky", hat: "cap", print: "bolt", pants: "cargo", acc: "none", eyes: "shine", mouth: "grin" } },
  { name: "아이돌 지망생", look: { hair: "twintail", print: "heart", pants: "skirt", eyes: "lashes", mouth: "smile", extra: "blush" } },
  { name: "게이머", look: { hair: "short", hat: "headphones", print: "pixel", pants: "track", eyes: "glasses", mouth: "smirk" } },
  { name: "농구 선수", look: { hair: "buzz", print: "jersey", pants: "shorts", eyes: "dots", mouth: "grin" } },
  { name: "회사원", look: { hair: "sidepart", print: "suit", pants: "plain", pantsColor: "#23262c", eyes: "dots", mouth: "smile", acc: "bag" } },
  { name: "탐험가", look: { hair: "short", hat: "beret", print: "camo", pants: "cargo", acc: "backpack", eyes: "shine", mouth: "smirk" } },
  { name: "왕자님", look: { hair: "bob", hat: "crown", hatColor: "#e8c04a", print: "uniform", acc: "cape", eyes: "star", mouth: "smile" } },
  { name: "공주님", look: { hair: "long", hat: "crown", hatColor: "#e8c04a", print: "floral", pants: "skirt", eyes: "lashes", mouth: "smile", extra: "blush" } },
  { name: "토끼 소녀", look: { hair: "bob", hat: "bunny", print: "plain", pants: "skirt", eyes: "big", mouth: "cat", extra: "blush" } },
  { name: "해적", look: { hair: "long", hat: "tophat", hatColor: "#1c1c1f", print: "stripes", acc: "sword", eyes: "angry", mouth: "teeth", extra: "stubble" } },
  { name: "기사", look: { hair: "short", print: "checker", acc: "sword", eyes: "angry", mouth: "flat" } },
  { name: "마법사", look: { hair: "long", hat: "tophat", print: "planet", acc: "cape", eyes: "star", mouth: "o" } },
  { name: "힙합 댄서", look: { hair: "afro", print: "word", pants: "cargo", eyes: "shades", mouth: "smirk" } },
  { name: "서퍼", look: { hair: "long", print: "floral", pants: "shorts", eyes: "shades", mouth: "grin" } },
  { name: "등산객", look: { hair: "short", hat: "beanie", print: "plain", pants: "cargo", acc: "backpack", eyes: "dots", mouth: "smile" } },
  { name: "학생", look: { hair: "short", print: "uniform", pants: "plain", acc: "backpack", eyes: "shine", mouth: "smile" } },
  { name: "여학생", look: { hair: "pony", print: "uniform", pants: "skirt", acc: "backpack", eyes: "lashes", mouth: "smile" } },
  { name: "펑크 록커", look: { hair: "mohawk", print: "star", pants: "jeans", eyes: "angry", mouth: "tongue" } },
  { name: "패셔니스타", look: { hair: "bun", print: "tiedye", pants: "jeans", eyes: "shades", mouth: "pout", acc: "bag" } },
  { name: "할아버지", look: { hair: "bald", hairColor: "#d8d4cc", print: "plain", pants: "plain", eyes: "glasses", mouth: "smile", extra: "mustache" } },
  { name: "할머니", look: { hair: "bun", hairColor: "#d8d4cc", print: "floral", pants: "plain", eyes: "happy", mouth: "smile", extra: "blush" } },
  { name: "러너", look: { hair: "short", hat: "cap", print: "gradient", pants: "track", eyes: "shine", mouth: "o" } },
  { name: "아티스트", look: { hair: "sidepart", hat: "beret", print: "overall", pants: "plain", eyes: "happy", mouth: "smirk", extra: "freckles" } },
  { name: "우주 덕후", look: { hair: "spiky", print: "planet", pants: "jeans", eyes: "big", mouth: "grin" } },
  { name: "꽃집 사장", look: { hair: "bob", hat: "flower", print: "apron", pants: "plain", eyes: "happy", mouth: "smile", extra: "blush" } },
  { name: "악마 코스프레", look: { hair: "mohawk", hat: "horns", hatColor: "#c0262e", print: "plain", shirt: "#2b2d42", acc: "wings", eyes: "angry", mouth: "teeth" } },
  { name: "천사 코스프레", look: { hair: "long", hairColor: "#f2d57a", print: "plain", shirt: "#f6f6f3", acc: "wings", accColor: "#ffffff", eyes: "happy", mouth: "smile" } },
  { name: "후드 소년", look: { hair: "short", print: "hoodie", pants: "jeans", eyes: "sleepy", mouth: "flat" } },
  { name: "웃음 장인", look: { hair: "spiky", print: "smile", pants: "shorts", eyes: "happy", mouth: "laugh" } },
  { name: "겨울 소녀", look: { hair: "long", hat: "beanie", print: "plain", pants: "jeans", acc: "scarf", eyes: "shine", mouth: "smile", extra: "blush" } },
  { name: "카우보이", look: { hair: "short", hat: "tophat", hatColor: "#8a5a3b", print: "checker", pants: "jeans", eyes: "dots", mouth: "smirk", extra: "mustache" } },
  { name: "축구 소년", look: { hair: "buzz", print: "jersey", pants: "shorts", eyes: "shine", mouth: "grin", extra: "freckles" } },
  { name: "독서가", look: { hair: "bob", print: "plain", pants: "plain", eyes: "glasses", mouth: "smile", acc: "bag" } },
  { name: "선글라스 아저씨", look: { hair: "sidepart", print: "floral", pants: "shorts", eyes: "shades", mouth: "grin", extra: "stubble" } },
  { name: "꼬마 탐정", look: { hair: "short", hat: "beret", print: "plain", pants: "plain", acc: "scarf", eyes: "glasses", mouth: "o" } },
  { name: "무지개 친구", look: { hair: "afro", hairColor: "#f07aa8", print: "tiedye", pants: "track", eyes: "star", mouth: "laugh" } },
  { name: "소방관", look: { hair: "short", hat: "hardhat", hatColor: "#c0262e", print: "jersey", shirt: "#c0262e", shirt2: "#f2c230", pants: "cargo", pantsColor: "#2b2d42", eyes: "angry", mouth: "grin" } },
  { name: "경찰관", look: { hair: "short", hat: "guard", hatColor: "#1d3557", print: "guard", shirt: "#1d3557", shirt2: "#e8c04a", pants: "plain", pantsColor: "#1b2029", eyes: "dots", mouth: "flat", longSleeve: true } },
  { name: "우체부", look: { hair: "short", hat: "cap", hatColor: "#c0262e", print: "plain", shirt: "#c0262e", acc: "bag", accColor: "#8a5a3b", eyes: "shine", mouth: "smile" } },
  { name: "택배 기사", look: { hair: "buzz", hat: "cap", hatColor: "#2d5a9c", print: "word", shirt: "#2d5a9c", shirt2: "#ffffff", pants: "cargo", eyes: "dots", mouth: "grin" } },
  { name: "건설 노동자", look: { hair: "short", hat: "hardhat", print: "overall", shirt: "#f4a261", shirt2: "#2f4b7c", pants: "jeans", eyes: "dots", mouth: "smirk", extra: "stubble" } },
  { name: "과학자", look: { hair: "afro", hairColor: "#e8e4dc", print: "coat", shirt2: "#9fc7e8", eyes: "glasses", mouth: "o", longSleeve: true } },
  { name: "우주비행사", look: { hair: "buzz", hat: "hardhat", hatColor: "#f4f4f1", print: "planet", shirt: "#f4f4f1", shirt2: "#3a86ff", pants: "plain", pantsColor: "#f4f4f1", acc: "backpack", accColor: "#f4f4f1", eyes: "big", mouth: "grin" } },
  { name: "파일럿", look: { hair: "sidepart", hat: "guard", hatColor: "#1d3557", print: "suit", shirt: "#1d3557", shirt2: "#e8c04a", eyes: "shades", mouth: "smile", longSleeve: true } },
  { name: "승무원", look: { hair: "bun", hat: "beret", hatColor: "#c0262e", print: "uniform", shirt: "#1d3557", shirt2: "#c0262e", pants: "skirt", pantsColor: "#1d3557", eyes: "lashes", mouth: "smile" } },
  { name: "바리스타", look: { hair: "short", hat: "beanie", hatColor: "#6b4423", print: "apron", shirt: "#f4f4f1", shirt2: "#3b2416", eyes: "happy", mouth: "smile", extra: "freckles" } },
  { name: "파티시에", look: { hair: "bob", hat: "chef", print: "chef", shirt2: "#ffadad", eyes: "happy", mouth: "smile", extra: "blush" } },
  { name: "피자 배달원", look: { hair: "spiky", hat: "cap", hatColor: "#e63946", print: "word", shirt: "#e63946", shirt2: "#ffd166", acc: "bag", accColor: "#e63946", eyes: "shine", mouth: "grin" } },
  { name: "정원사", look: { hair: "short", hat: "beret", hatColor: "#2a9d8f", print: "overall", shirt: "#80ed99", shirt2: "#2a9d8f", pants: "cargo", eyes: "happy", mouth: "smile" } },
  { name: "어부", look: { hair: "short", hat: "beanie", hatColor: "#f4a261", print: "stripes", shirt: "#1d3557", shirt2: "#f1faee", pants: "cargo", eyes: "dots", mouth: "smirk", extra: "stubble" } },
  { name: "농부", look: { hair: "short", hat: "beret", hatColor: "#e9c46a", print: "checker", shirt: "#e63946", shirt2: "#f1faee", pants: "jeans", eyes: "happy", mouth: "grin", extra: "freckles" } },
  { name: "화가", look: { hair: "long", hat: "beret", hatColor: "#c0262e", print: "floral", pants: "plain", eyes: "shine", mouth: "smirk", acc: "scarf" } },
  { name: "음악가", look: { hair: "long", hat: "headphones", print: "star", pants: "jeans", eyes: "sleepy", mouth: "smile" } },
  { name: "DJ", look: { hair: "mohawk", hairColor: "#3b62c2", hat: "headphones", hatColor: "#1c1c1f", print: "gradient", shirt: "#8338ec", shirt2: "#00bbf9", eyes: "shades", mouth: "grin" } },
  { name: "록 기타리스트", look: { hair: "long", hairColor: "#1c1612", print: "bolt", shirt: "#1c1c1f", shirt2: "#e63946", pants: "jeans", eyes: "angry", mouth: "tongue" } },
  { name: "발레리나", look: { hair: "bun", print: "plain", shirt: "#ffadad", pants: "skirt", pantsColor: "#ffc8dd", eyes: "lashes", mouth: "smile", extra: "blush" } },
  { name: "태권도 사범", look: { hair: "buzz", print: "uniform", shirt: "#f4f4f1", shirt2: "#1c1c1f", pants: "plain", pantsColor: "#f4f4f1", eyes: "angry", mouth: "flat" } },
  { name: "야구 선수", look: { hair: "short", hat: "cap", hatColor: "#1d3557", print: "jersey", shirt: "#f1faee", shirt2: "#1d3557", pants: "plain", pantsColor: "#f1faee", eyes: "shine", mouth: "grin" } },
  { name: "테니스 선수", look: { hair: "pony", hat: "cap", hatColor: "#f4f4f1", print: "plain", shirt: "#f4f4f1", pants: "skirt", pantsColor: "#f4f4f1", eyes: "shine", mouth: "smile" } },
  { name: "수영 선수", look: { hair: "bald", hat: "beanie", hatColor: "#3a86ff", print: "gradient", shirt: "#3a86ff", shirt2: "#00bbf9", pants: "shorts", eyes: "shades", mouth: "grin" } },
  { name: "e스포츠 프로", look: { hair: "spiky", hairColor: "#3b62c2", hat: "headphones", print: "jersey", shirt: "#2b2d42", shirt2: "#00bbf9", pants: "track", eyes: "glasses", mouth: "smirk" } },
  { name: "유튜버", look: { hair: "sidepart", hairColor: "#d8a548", print: "word", pants: "jeans", eyes: "big", mouth: "laugh", acc: "bag" } },
  { name: "인플루언서", look: { hair: "long", hairColor: "#f2d57a", print: "heart", pants: "skirt", eyes: "shades", mouth: "pout", acc: "bag", accColor: "#ffadad" } },
  { name: "대학생", look: { hair: "sidepart", print: "hoodie", pants: "jeans", acc: "backpack", eyes: "shine", mouth: "smile" } },
  { name: "신입사원", look: { hair: "short", print: "suit", shirt: "#2b2d42", shirt2: "#3a86ff", pants: "plain", pantsColor: "#2b2d42", eyes: "big", mouth: "smile", acc: "bag", longSleeve: true } },
  { name: "사장님", look: { hair: "sidepart", hairColor: "#6b4423", print: "suit", shirt: "#1c1c1f", shirt2: "#c0262e", pants: "plain", pantsColor: "#1c1c1f", eyes: "shades", mouth: "smirk", extra: "mustache", longSleeve: true } },
  { name: "투자자", look: { hair: "sidepart", print: "suit", shirt: "#264653", shirt2: "#e9c46a", pants: "plain", pantsColor: "#264653", eyes: "glasses", mouth: "grin", acc: "bag", longSleeve: true } },
  { name: "부동산 중개인", look: { hair: "bob", print: "suit", shirt: "#6b4423", shirt2: "#f4a261", pants: "skirt", pantsColor: "#3b3b3f", eyes: "shine", mouth: "smile", longSleeve: true } },
  { name: "여행자", look: { hair: "short", hat: "cap", print: "planet", pants: "shorts", acc: "backpack", eyes: "happy", mouth: "grin" } },
  { name: "캠핑족", look: { hair: "short", hat: "beanie", hatColor: "#2a9d8f", print: "checker", shirt: "#2a9d8f", shirt2: "#264653", pants: "cargo", acc: "backpack", eyes: "dots", mouth: "smile", extra: "stubble" } },
  { name: "자전거 라이더", look: { hair: "buzz", hat: "hardhat", hatColor: "#06d6a0", print: "gradient", shirt: "#06d6a0", shirt2: "#118ab2", pants: "track", eyes: "shades", mouth: "o" } },
  { name: "요가 강사", look: { hair: "pony", print: "plain", shirt: "#80ed99", pants: "track", pantsColor: "#2b2d42", eyes: "happy", mouth: "smile" } },
  { name: "헬스 트레이너", look: { hair: "buzz", print: "word", shirt: "#1c1c1f", shirt2: "#e63946", pants: "track", eyes: "angry", mouth: "grin" } },
  { name: "치어리더", look: { hair: "twintail", hairColor: "#d8a548", print: "jersey", shirt: "#e63946", shirt2: "#f1faee", pants: "skirt", pantsColor: "#e63946", eyes: "star", mouth: "laugh" } },
  { name: "마술사", look: { hair: "sidepart", hat: "tophat", print: "suit", shirt: "#1c1c1f", shirt2: "#c0262e", acc: "cape", accColor: "#c0262e", eyes: "star", mouth: "smirk", longSleeve: true } },
  { name: "광대", look: { hair: "afro", hairColor: "#e63946", print: "checker", shirt: "#ffd166", shirt2: "#3a86ff", pants: "track", eyes: "surprised", mouth: "laugh", extra: "blush" } },
  { name: "닌자", look: { hair: "bald", hat: "beanie", hatColor: "#1c1c1f", print: "plain", shirt: "#1c1c1f", pants: "plain", pantsColor: "#1c1c1f", shoes: "#1c1c1f", acc: "sword", eyes: "angry", mouth: "flat" } },
  { name: "사무라이", look: { hair: "bun", print: "uniform", shirt: "#c0262e", shirt2: "#1c1c1f", acc: "sword", eyes: "angry", mouth: "flat" } },
  { name: "바이킹", look: { hair: "long", hairColor: "#d8a548", hat: "horns", hatColor: "#e8e4dc", print: "camo", shirt: "#6b4423", shirt2: "#8a5a3b", acc: "sword", eyes: "angry", mouth: "teeth", extra: "stubble" } },
  { name: "로봇", look: { hair: "bald", hat: "headphones", hatColor: "#9aa0a8", print: "pixel", shirt: "#9aa0a8", shirt2: "#00bbf9", pants: "plain", pantsColor: "#6b7280", eyes: "surprised", mouth: "teeth" } },
  { name: "외계인 친구", look: { hair: "bald", hat: "bunny", hatColor: "#80ed99", skin: "#80ed99", print: "planet", shirt: "#8338ec", shirt2: "#80ed99", eyes: "big", mouth: "o" } },
  { name: "좀비 코스프레", look: { hair: "short", hairColor: "#3a2618", skin: "#9fc59a", print: "camo", shirt: "#6b7280", shirt2: "#3a2618", eyes: "sleepy", mouth: "teeth" } },
  { name: "뱀파이어", look: { hair: "sidepart", hairColor: "#1c1612", skin: "#f8e0c6", print: "suit", shirt: "#1c1c1f", shirt2: "#c0262e", acc: "cape", accColor: "#1c1c1f", eyes: "angry", mouth: "teeth", longSleeve: true } },
  { name: "호박 머리", look: { hair: "bald", hat: "beanie", hatColor: "#2a9d8f", skin: "#fb8500", print: "stripes", shirt: "#1c1c1f", shirt2: "#fb8500", eyes: "angry", mouth: "teeth" } },
  { name: "산타", look: { hair: "short", hairColor: "#f4f4f1", hat: "beanie", hatColor: "#c0262e", print: "plain", shirt: "#c0262e", pants: "plain", pantsColor: "#c0262e", shoes: "#1c1c1f", eyes: "happy", mouth: "laugh", extra: "mustache" } },
  { name: "눈사람 코스프레", look: { hair: "bald", hat: "tophat", hatColor: "#1c1c1f", skin: "#f4f4f1", print: "plain", shirt: "#f4f4f1", acc: "scarf", accColor: "#c0262e", eyes: "dots", mouth: "smile" } },
  { name: "곰돌이 탈", look: { hair: "bald", hat: "bunny", hatColor: "#8a5a3b", skin: "#c08552", print: "heart", shirt: "#8a5a3b", shirt2: "#ffadad", eyes: "dots", mouth: "cat", extra: "blush" } },
  { name: "고양이 소녀", look: { hair: "bob", hairColor: "#e8e4dc", hat: "horns", hatColor: "#e8e4dc", print: "smile", shirt: "#ffc8dd", pants: "skirt", eyes: "big", mouth: "cat", extra: "blush" } },
  { name: "공룡 덕후", look: { hair: "spiky", hairColor: "#2fb38a", print: "camo", shirt: "#2a9d8f", shirt2: "#80ed99", pants: "shorts", eyes: "big", mouth: "teeth" } },
  { name: "해변 소녀", look: { hair: "long", hairColor: "#a0652c", hat: "flower", print: "floral", shirt: "#00bbf9", shirt2: "#ffd166", pants: "shorts", eyes: "shades", mouth: "smile" } },
  { name: "스키어", look: { hair: "short", hat: "beanie", hatColor: "#3a86ff", print: "gradient", shirt: "#e63946", shirt2: "#3a86ff", pants: "track", acc: "scarf", eyes: "shades", mouth: "grin" } },
  { name: "양치기 소년", look: { hair: "short", hat: "beret", print: "stripes", shirt: "#f1faee", shirt2: "#80ed99", pants: "shorts", eyes: "happy", mouth: "smile", extra: "freckles" } },
  { name: "탐정", look: { hair: "sidepart", hat: "tophat", hatColor: "#8a5a3b", print: "suit", shirt: "#8a5a3b", shirt2: "#264653", acc: "scarf", eyes: "glasses", mouth: "smirk", longSleeve: true } },
  { name: "기자", look: { hair: "bob", print: "plain", shirt: "#e9c46a", pants: "plain", acc: "bag", eyes: "glasses", mouth: "o" } },
  { name: "사진작가", look: { hair: "short", hat: "cap", hatColor: "#1c1c1f", print: "plain", shirt: "#2b2d42", pants: "cargo", acc: "bag", accColor: "#1c1c1f", eyes: "sleepy", mouth: "smirk" } },
  { name: "편의점 알바", look: { hair: "short", print: "apron", shirt: "#3a86ff", shirt2: "#80ed99", pants: "jeans", eyes: "sleepy", mouth: "flat" } },
  { name: "도서관 사서", look: { hair: "bun", print: "plain", shirt: "#9b5de5", pants: "skirt", pantsColor: "#3b3b3f", eyes: "glasses", mouth: "smile" } },
  { name: "미용사", look: { hair: "mohawk", hairColor: "#f07aa8", print: "apron", shirt: "#1c1c1f", shirt2: "#ffadad", pants: "jeans", eyes: "lashes", mouth: "grin" } },
  { name: "수의사", look: { hair: "pony", print: "scrubs", shirt: "#80ed99", shirt2: "#ffffff", pants: "plain", pantsColor: "#80ed99", eyes: "happy", mouth: "smile" } },
  { name: "꼬마 왕자", look: { hair: "spiky", hairColor: "#f2d57a", hat: "crown", hatColor: "#e8c04a", print: "plain", shirt: "#3a86ff", acc: "scarf", accColor: "#ffd166", eyes: "big", mouth: "grin" } },
];

const ROLE_LOOK: Record<string, Partial<Look>> = {
  doctor: { print: "coat", shirt: "#f6f6f3", shirt2: "#9fc7e8", pants: "plain", pantsColor: "#2c3442", longSleeve: true, hat: "none", eyes: "glasses", mouth: "smile" },
  nurse: { print: "scrubs", shirt: "#8ec5d6", shirt2: "#ffffff", pants: "plain", pantsColor: "#8ec5d6", hat: "nurse", mouth: "smile", eyes: "shine" },
  guard: { print: "guard", shirt: "#1f2a3a", shirt2: "#e8c04a", pants: "plain", pantsColor: "#1b2029", hat: "guard", hatColor: "#1f2a3a", eyes: "dots", mouth: "flat", longSleeve: true },
  cook: { print: "chef", shirt: "#f6f6f3", shirt2: "#d33a3a", pants: "plain", pantsColor: "#2a2a2a", hat: "chef", hatColor: "#ffffff", mouth: "grin", longSleeve: true },
  clerk: { print: "apron", shirt: "#f4f4f1", shirt2: "#2f6fd1", pants: "plain", pantsColor: "#23272e", mouth: "smile", eyes: "shine" },
  patient: { print: "gown", shirt: "#cfe3f2", shirt2: "#8eb6d8", pants: "plain", pantsColor: "#a9c4dc", mouth: "flat", eyes: "sleepy" },
  student: { print: "uniform", shirt: "#2b3a55", shirt2: "#b3263a", pants: "plain", pantsColor: "#4a4d52", acc: "backpack" },
  teacher: { print: "suit", shirt: "#6b5b4b", shirt2: "#2a5a8a", pants: "plain", pantsColor: "#2d3036", eyes: "glasses", longSleeve: true },
  desk: { print: "suit", shirt: "#2f3e52", shirt2: "#8a2f3a", pants: "plain", pantsColor: "#23262c", longSleeve: true },
};

/** a look for a seed (one of the named characters, coloured by it) and, for a job, its outfit */
export function lookFor(seed: number, role?: string, colours?: { top?: string; bottom?: string; hair?: string; shoe?: string }): Look {
  let s = (seed * 2654435761) >>> 0;
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  const base = CHARACTERS[seed % CHARACTERS.length].look;
  const look: Look = {
    skin: pick(SKINS), hair: pick(["buzz", "short", "spiky", "bob", "long", "pony", "bun", "sidepart"] as HairStyle[]), hairColor: r() < 0.7 ? pick(HAIRC.slice(0, 4)) : pick(HAIRC),
    hat: "none", hatColor: pick(BRIGHT), eyes: pick(EYES), mouth: pick(MOUTHS), extra: pick(EXTRAS),
    print: pick(PRINTS.slice(0, 16)), shirt: pick(BRIGHT), shirt2: pick(BRIGHT), longSleeve: r() < 0.45,
    pants: pick(["jeans", "plain", "cargo", "track", "shorts"] as Look["pants"][]), pantsColor: pick(DENIM), shoes: pick(["#f4f4f1", "#1c1c1f", "#e63946", "#3a86ff", "#8a5a3b", "#f6c945"]), acc: "none", accColor: pick(BRIGHT),
    ...base,
  };
  if (look.shirt2 === look.shirt) look.shirt2 = mix(look.shirt, luma(look.shirt) > 0.5 ? "#000000" : "#ffffff", 0.6);
  if (role && ROLE_LOOK[role]) Object.assign(look, { hat: "none", acc: "none", ...ROLE_LOOK[role] });
  if (colours?.top && !(role && ROLE_LOOK[role])) look.shirt = colours.top;
  if (colours?.bottom && !(role && ROLE_LOOK[role])) look.pantsColor = colours.bottom;
  if (colours?.shoe) look.shoes = colours.shoe; else if (role && ROLE_LOOK[role]) look.shoes = role === "nurse" || role === "cook" ? "#f4f4f1" : "#1c1c1f";
  return look;
}

// ------------------------------------------------------------------ geometry
const rbox = (w: number, h: number, d: number, r = 0.03, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
function planar(g: THREE.BufferGeometry, uv: UV, axis: "z" | "x" = "z"): THREE.BufferGeometry {
  g = g.index ? g.toNonIndexed() : g;
  g.computeBoundingBox(); const b = g.boundingBox!, pos = g.getAttribute("position"), out = new Float32Array(pos.count * 2);
  const u0 = axis === "z" ? b.min.x : b.min.z, uw = Math.max(1e-6, axis === "z" ? b.max.x - b.min.x : b.max.z - b.min.z), h = Math.max(1e-6, b.max.y - b.min.y);
  for (let i = 0; i < pos.count; i++) { const u = ((axis === "z" ? pos.getX(i) : pos.getZ(i)) - u0) / uw, v = (pos.getY(i) - b.min.y) / h; out[i * 2] = uv[0] + (uv[2] - uv[0]) * u; out[i * 2 + 1] = uv[1] + (uv[3] - uv[1]) * v; }
  g.setAttribute("uv", new THREE.BufferAttribute(out, 2)); return g;
}
function solid(g: THREE.BufferGeometry, uv: UV): THREE.BufferGeometry {
  g = g.index ? g.toNonIndexed() : g;
  const n = g.getAttribute("position").count, out = new Float32Array(n * 2), u = (uv[0] + uv[2]) / 2, v = (uv[1] + uv[3]) / 2;
  for (let i = 0; i < n; i++) { out[i * 2] = u; out[i * 2 + 1] = v; }
  g.setAttribute("uv", new THREE.BufferAttribute(out, 2)); return g;
}
/** a box with its front (+z) and back printed, its sides in the base colour */
function printedBox(w: number, h: number, d: number, r: number, front: UV, side: UV) {
  const g = rbox(w, h, d, r).toNonIndexed(), pos = g.getAttribute("position"), nor = g.getAttribute("normal"), out = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i += 3) {
    let nz = 0, nx = 0; for (let k = 0; k < 3; k++) { nz += nor.getZ(i + k); nx += nor.getX(i + k); }
    const faceOn = Math.abs(nz) > Math.abs(nx) * 1.2 && Math.abs(nz) > 0.9;
    for (let k = 0; k < 3; k++) {
      const x = pos.getX(i + k), y = pos.getY(i + k);
      if (faceOn) { const u = (nz > 0 ? x + w / 2 : w / 2 - x) / w, v = (y + h / 2) / h; out[(i + k) * 2] = front[0] + (front[2] - front[0]) * u; out[(i + k) * 2 + 1] = front[1] + (front[3] - front[1]) * v; }
      else { out[(i + k) * 2] = (side[0] + side[2]) / 2; out[(i + k) * 2 + 1] = (side[1] + side[3]) / 2; }
    }
  }
  g.setAttribute("uv", new THREE.BufferAttribute(out, 2)); return g;
}

/** The figure's parts for each joint (in that joint's frame), built for a look. */
export function blockyParts(look: Look) {
  const A = characterAtlas(), S = (c: string) => A.swatch(c);
  const face = A.cell(`face|${look.eyes}|${look.mouth}|${look.extra}`, (g, s) => paintFace(g, s, look.eyes, look.mouth, look.extra));
  const shirt = A.cell(`shirt|${look.print}|${look.shirt}|${look.shirt2}|${look.print === "number" || look.print === "word" || look.print === "jersey" ? look.shirt.length + look.shirt2.charCodeAt(2) : 0}`, (g, s) => paintShirt(g, s, look.print, look.shirt, look.shirt2, look.shirt.charCodeAt(3) + look.shirt2.charCodeAt(4)));
  const pants = A.cell(`pants|${look.pants}|${look.pantsColor}`, (g, s) => paintPants(g, s, look.pants, look.pantsColor));
  const sideShirt = look.print === "coat" || look.print === "chef" ? "#f6f6f3" : look.shirt;
  const P: Record<string, THREE.BufferGeometry[]> = { hips: [], spine: [], neck: [], head: [], lShoulder: [], rShoulder: [], lElbow: [], rElbow: [], lHip: [], rHip: [], lKnee: [], rKnee: [], lAnkle: [], rAnkle: [] };
  // hips: the pelvis (trousers) — a skirt flares from it
  P.hips.push(planar(rbox(0.36, 0.2, 0.21, 0.03).translate(0, -0.01, 0), pants));
  if (look.pants === "skirt") P.hips.push(solid(new THREE.CylinderGeometry(0.2, 0.27, 0.28, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 0.72).translate(0, -0.2, 0), S(look.pantsColor)));
  // torso: shirt printed front and back; a doctor's or chef's coat hangs below the waist
  P.spine.push(printedBox(0.42, 0.5, 0.22, 0.035, shirt, S(sideShirt)).translate(0, 0.25, 0));
  if (look.print === "coat") P.spine.push(solid(rbox(0.44, 0.34, 0.235, 0.02).translate(0, -0.12, 0), S("#f6f6f3")));
  // neck & head: a rounded cube, the face painted on a plate just proud of the front
  P.neck.push(solid(rbox(0.13, 0.08, 0.13, 0.02).translate(0, 0.03, 0), S(look.skin)));
  P.head.push(solid(rbox(0.3, 0.29, 0.29, 0.085, 4).translate(0, 0.09, 0), S(look.skin)));
  P.head.push(planar(new THREE.PlaneGeometry(0.26, 0.25).translate(0, 0.09, 0.1465), face));
  hair(P.head, look, S);
  hat(P.head, look, S);
  if (look.eyes === "glasses" || look.acc === "glasses") { /* painted on the face */ }
  // arms: sleeves (short or long), forearms, hands
  for (const side of ["l", "r"] as const) {
    const sx = side === "l" ? -1 : 1;
    P[`${side}Shoulder`].push(solid(rbox(0.15, 0.3, 0.17, 0.035).translate(sx * 0.005, -0.13, 0), S(sideShirt)));
    P[`${side}Elbow`].push(solid(rbox(0.14, 0.23, 0.16, 0.035).translate(sx * 0.005, -0.1, 0), S(look.longSleeve ? sideShirt : look.skin)));
    P[`${side}Elbow`].push(solid(rbox(0.13, 0.11, 0.15, 0.045).translate(sx * 0.005, -0.27, 0), S(look.skin)));
    // legs: trousers (shorts show the shin), shoes
    const shortLeg = look.pants === "shorts" || look.pants === "skirt";
    P[`${side}Hip`].push(look.pants === "skirt" ? solid(rbox(0.17, 0.44, 0.19, 0.03).translate(0, -0.2, 0), S(look.skin)) : planar(rbox(0.18, 0.44, 0.2, 0.03).translate(0, -0.2, 0), pants));
    P[`${side}Knee`].push(shortLeg ? solid(rbox(0.16, 0.42, 0.18, 0.03).translate(0, -0.2, 0), S(look.skin)) : planar(rbox(0.17, 0.42, 0.19, 0.03).translate(0, -0.2, 0), pants));
    P[`${side}Ankle`].push(solid(rbox(0.19, 0.08, 0.28, 0.035).translate(0, -0.02, 0.045), S(look.shoes)));
    P[`${side}Ankle`].push(solid(rbox(0.195, 0.025, 0.285, 0.01).translate(0, -0.055, 0.045), S("#2a2a2e")));
  }
  accessory(P, look, S);
  return { parts: P, material: A.material };
}

type Put = THREE.BufferGeometry[];
function hair(H: Put, look: Look, S: (c: string) => UV) {
  const c = S(look.hairColor), top = 0.235, add = (g: THREE.BufferGeometry) => H.push(solid(g, c));
  if (look.hair === "bald") return;
  if (look.hat === "chef" || look.hat === "tophat" || look.hat === "hardhat" || look.hat === "guard" || look.hat === "beanie") { add(rbox(0.31, 0.06, 0.3, 0.025).translate(0, top - 0.02, -0.005)); if (look.hair === "long" || look.hair === "pony" || look.hair === "twintail") add(rbox(0.3, 0.22, 0.06, 0.025).translate(0, 0.1, -0.135)); return; }
  // the cap of hair, its fringe, and the style's own pieces
  add(rbox(0.32, 0.09, 0.31, 0.04).translate(0, top, -0.005));
  if (look.hair !== "buzz") add(rbox(0.32, 0.07, 0.07, 0.025).translate(0, top - 0.05, 0.125));
  switch (look.hair) {
    case "spiky": for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; add(new THREE.ConeGeometry(0.045, 0.12, 4).translate(Math.cos(a) * 0.08, top + 0.09, Math.sin(a) * 0.08 - 0.01)); } add(new THREE.ConeGeometry(0.05, 0.14, 4).translate(0, top + 0.1, 0)); break;
    case "bob": add(rbox(0.33, 0.2, 0.31, 0.04).translate(0, 0.15, -0.01)); break;
    case "long": add(rbox(0.33, 0.2, 0.31, 0.04).translate(0, 0.15, -0.01)); add(rbox(0.31, 0.34, 0.07, 0.03).translate(0, 0.02, -0.135)); break;
    case "pony": add(rbox(0.33, 0.14, 0.31, 0.04).translate(0, 0.18, -0.01)); add(rbox(0.08, 0.26, 0.08, 0.035).rotateX(0.3).translate(0, 0.1, -0.2)); break;
    case "twintail": add(rbox(0.33, 0.14, 0.31, 0.04).translate(0, 0.18, -0.01)); for (const sx of [-1, 1]) add(rbox(0.08, 0.28, 0.08, 0.035).rotateZ(sx * 0.25).translate(sx * 0.2, 0.08, -0.06)); break;
    case "bun": add(new THREE.SphereGeometry(0.075, 10, 8).translate(0, top + 0.08, -0.06)); break;
    case "mohawk": add(rbox(0.07, 0.16, 0.3, 0.025).translate(0, top + 0.08, -0.01)); break;
    case "afro": add(new THREE.IcosahedronGeometry(0.21, 1).scale(1, 0.85, 1).translate(0, top + 0.02, -0.02)); break;
    case "sidepart": add(rbox(0.2, 0.06, 0.3, 0.025).rotateZ(0.12).translate(-0.06, top + 0.05, -0.005)); break;
    default: break;
  }
}
function hat(H: Put, look: Look, S: (c: string) => UV) {
  const c = S(look.hatColor), top = 0.235, add = (g: THREE.BufferGeometry, uv = c) => H.push(solid(g, uv));
  switch (look.hat) {
    case "cap": add(rbox(0.33, 0.1, 0.32, 0.04).translate(0, top + 0.02, -0.005)); add(rbox(0.26, 0.018, 0.16, 0.008).translate(0, top - 0.02, 0.2)); break;
    case "beanie": add(rbox(0.33, 0.14, 0.32, 0.05).translate(0, top + 0.03, -0.005)); add(rbox(0.335, 0.05, 0.325, 0.02).translate(0, top - 0.03, -0.005), S("#f4f4f1")); add(new THREE.SphereGeometry(0.045, 10, 8).translate(0, top + 0.12, 0), S("#f4f4f1")); break;
    case "tophat": add(new THREE.CylinderGeometry(0.24, 0.24, 0.02, 20).translate(0, top - 0.01, 0)); add(new THREE.CylinderGeometry(0.14, 0.15, 0.24, 20).translate(0, top + 0.11, 0)); add(new THREE.CylinderGeometry(0.152, 0.152, 0.04, 20).translate(0, top + 0.02, 0), S("#c0262e")); break;
    case "crown": for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; add(rbox(0.07, 0.1, 0.03, 0.01).rotateY(-a).translate(Math.sin(a) * 0.13, top + 0.06, Math.cos(a) * 0.13)); } add(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 16, 1, true).translate(0, top + 0.02, 0)); add(new THREE.SphereGeometry(0.025, 8, 6).translate(0, top + 0.05, 0.15), S("#e63946")); break;
    case "headphones": add(new THREE.TorusGeometry(0.17, 0.018, 6, 20, Math.PI).translate(0, 0.09, 0)); for (const sx of [-1, 1]) add(rbox(0.06, 0.12, 0.11, 0.03).translate(sx * 0.165, 0.09, 0)); break;
    case "bunny": for (const sx of [-1, 1]) { add(rbox(0.06, 0.24, 0.035, 0.025).rotateZ(sx * -0.15).translate(sx * 0.08, top + 0.14, 0)); add(rbox(0.03, 0.18, 0.04, 0.012).rotateZ(sx * -0.15).translate(sx * 0.08, top + 0.14, 0.004), S("#ffb3c9")); } break;
    case "hardhat": add(new THREE.SphereGeometry(0.17, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, top - 0.02, 0), S("#f2c230")); add(new THREE.CylinderGeometry(0.2, 0.2, 0.015, 16).translate(0, top - 0.02, 0.02), S("#f2c230")); break;
    case "chef": add(new THREE.CylinderGeometry(0.15, 0.15, 0.12, 16).translate(0, top + 0.04, 0), S("#ffffff")); add(new THREE.SphereGeometry(0.19, 14, 10).scale(1, 0.6, 1).translate(0, top + 0.14, 0), S("#ffffff")); break;
    case "nurse": add(rbox(0.22, 0.07, 0.12, 0.02).translate(0, top + 0.02, 0.05), S("#ffffff")); add(rbox(0.05, 0.04, 0.005, 0.005).translate(0, top + 0.03, 0.112), S("#e63946")); break;
    case "guard": add(new THREE.CylinderGeometry(0.17, 0.165, 0.08, 18).translate(0, top + 0.01, 0)); add(rbox(0.24, 0.014, 0.12, 0.006).translate(0, top - 0.025, 0.17), S("#111111")); add(rbox(0.05, 0.05, 0.01, 0.004).translate(0, top + 0.02, 0.17), S("#e8c04a")); break;
    case "beret": add(new THREE.CylinderGeometry(0.19, 0.17, 0.05, 18).rotateZ(0.15).translate(-0.02, top + 0.03, 0)); break;
    case "flower": for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; add(new THREE.SphereGeometry(0.03, 8, 6).translate(0.12 + Math.cos(a) * 0.035, top + 0.01 + Math.sin(a) * 0.035, 0.08), S("#ff6b9a")); } add(new THREE.SphereGeometry(0.022, 8, 6).translate(0.12, top + 0.01, 0.09), S("#ffd166")); break;
    case "horns": for (const sx of [-1, 1]) add(new THREE.ConeGeometry(0.04, 0.13, 6).rotateZ(sx * -0.4).translate(sx * 0.1, top + 0.07, 0.02)); break;
    default: break;
  }
}
function accessory(P: Record<string, THREE.BufferGeometry[]>, look: Look, S: (c: string) => UV) {
  const c = S(look.accColor);
  switch (look.acc) {
    case "backpack": P.spine.push(solid(rbox(0.32, 0.38, 0.14, 0.04).translate(0, 0.26, -0.18), c)); P.spine.push(solid(rbox(0.24, 0.12, 0.04, 0.02).translate(0, 0.16, -0.26), S("#1c1c1f"))); break;
    case "scarf": P.neck.push(solid(rbox(0.24, 0.07, 0.24, 0.03).translate(0, 0.0, 0), c)); P.spine.push(solid(rbox(0.07, 0.22, 0.04, 0.015).translate(0.08, 0.38, 0.13), c)); break;
    case "sword": P.spine.push(solid(rbox(0.04, 0.6, 0.02, 0.008).rotateZ(0.6).translate(0.05, 0.25, -0.13), S("#c8ccd2"))); P.spine.push(solid(rbox(0.16, 0.03, 0.04, 0.01).rotateZ(0.6).translate(-0.12, 0.47, -0.13), S("#c9a24a"))); break;
    case "cape": P.spine.push(solid(new THREE.BoxGeometry(0.46, 0.85, 0.02).translate(0, 0.08, -0.13), S(look.accColor === "#ffffff" ? "#c0262e" : look.accColor))); break;
    case "wings": for (const sx of [-1, 1]) P.spine.push(solid(rbox(0.32, 0.4, 0.03, 0.015).rotateZ(sx * -0.5).rotateY(sx * 0.4).translate(sx * 0.2, 0.32, -0.17), c)); break;
    case "bag": P.spine.push(solid(rbox(0.04, 0.6, 0.02, 0.008).rotateZ(0.7).translate(0, 0.25, 0.12), S("#3a2a1f"))); P.spine.push(solid(rbox(0.2, 0.16, 0.07, 0.025).translate(0.2, -0.05, 0.06), c)); break;
    default: break;
  }
}
