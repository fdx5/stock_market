import * as THREE from "three";
import { boxUV, RoundedBoxGeometry } from "./geom";
import type { Palette } from "./materials";
import { bx, cy, rb, puff, type Kit, type Part } from "./models";
import { variantOf } from "./variants";

/* The furnishings' variety beyond the shapes in variants.ts, picked per flat (and per room) from a
 * seed: what things are covered in (a sofa in one of five covers — the style's own, linen, velvet,
 * leather, a nubbly bouclé — in one of 16 fabric or 8 leather colours; a bed's frame, duvet, sheet
 * and runner each their own), eight bed frames, five more chairs and their wood and fabric, eight
 * more light switches, the pictures (ten kinds, painted here: landscapes, the sea, still lifes,
 * portraits, ink-wash mountains, geometric abstracts, botanical drawings, a city at dusk, one-line
 * drawings, colour fields) in six frames, and what stands on the tables and cabinets. The textures are
 * the palette's own (shared); only colours are new. */

const T = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);
const part = (m: THREE.Material, g: THREE.BufferGeometry, cast = true): Part => ({ m, g, cast });
type Keep = { dispose(): void }[];

// ------------------------------------------------------------------ covers
const FABRIC = ["#d9d2c5", "#bfb6aa", "#8e8a84", "#4d4f53", "#2f3a4f", "#6f7d63", "#a8664a", "#c4922e", "#c9a3a0", "#3f5a47", "#cbbba4", "#6c7f95", "#9b7b5c", "#e8e4dc", "#5b4a42", "#7a6f9b"];
const LEATHER = ["#a07c5c", "#6e4a32", "#2b2624", "#d8cfc2", "#8a5a3c", "#4a5a48", "#5c2e2e", "#b39477"];
const BEDDING = ["#ffffff", "#f1ece2", "#d9dde0", "#c7cfc3", "#2f3a4f", "#d8b9b4", "#e3d6bf", "#55585c", "#bcd0dc", "#d7b46a", "#efe7da", "#9fa89a", "#b7a6c9", "#a3b9a0"];
const WOOD = ["#c9a77f", "#a77b52", "#7a5233", "#4b3424", "#d8c3a2", "#8c6a4a"];
const tinted = (base: THREE.Material, color: string, keep: Keep, tweak?: (m: THREE.MeshPhysicalMaterial) => void) => {
  const m = (base as THREE.MeshPhysicalMaterial).clone(); m.color.set(color); tweak?.(m); keep.push(m); return m;
};

/** the sofa's cover: a swap for the palette's sofa fabric, leather and linen */
export function sofaCover(P: Palette, seed: string, keep: Keep): Map<THREE.Material, THREE.Material> {
  const kind = variantOf(seed, "sofaCover", 5);
  const col = kind === 3 ? LEATHER[variantOf(seed, "sofaLeather", LEATHER.length)] : FABRIC[variantOf(seed, "sofaFabric", FABRIC.length)];
  const base = [P.fabricSofa, P.linen, P.velvet, P.leather, P.fabricBed][kind];
  const m = tinted(base, col, keep, kind === 4 ? x => { x.normalScale?.set(1.6, 1.6); x.roughness = 1; } : undefined);
  // (and the bolsters and scatter cushions in a second colour)
  const accent = tinted(P.velvet, FABRIC[variantOf(seed, "sofaAccent", FABRIC.length)], keep);
  return new Map<THREE.Material, THREE.Material>([[P.fabricSofa, m], [P.leather, m], [P.linen, m], [P.velvet, accent]]);
}

/** a chair's wood and seat: swaps for the palette's woods and velvet */
export function chairCover(P: Palette, seed: string, keep: Keep): Map<THREE.Material, THREE.Material> {
  const wood = tinted(P.woodLight, WOOD[variantOf(seed, "chairWood", WOOD.length)], keep);
  return new Map<THREE.Material, THREE.Material>([[P.woodLight, wood], [P.woodDark, wood], [P.velvet, tinted(P.velvet, FABRIC[variantOf(seed, "chairFabric", FABRIC.length)], keep)], [P.linen, tinted(P.linen, FABRIC[variantOf(seed, "chairLinen", FABRIC.length)], keep)]]);
}

export interface BedCover { frame: THREE.Material; duvet: THREE.Material; sheet: THREE.Material; runner: THREE.Material; wood: THREE.Material }
export function bedCover(P: Palette, seed: string, keep: Keep): BedCover {
  const fk = variantOf(seed, "bedFrameCover", 3);
  return {
    frame: tinted([P.linen, P.velvet, P.leather][fk], fk === 2 ? LEATHER[variantOf(seed, "bedLeather", LEATHER.length)] : FABRIC[variantOf(seed, "bedFabric", FABRIC.length)], keep),
    duvet: tinted(P.fabricBed, BEDDING[variantOf(seed, "duvet", BEDDING.length)], keep),
    sheet: tinted(P.fabricBed, BEDDING[variantOf(seed, "sheet", 4)], keep),
    runner: tinted(P.drape, FABRIC[variantOf(seed, "runner", FABRIC.length)], keep),
    wood: tinted(P.woodLight, WOOD[variantOf(seed, "bedWood", WOOD.length)], keep),
  };
}

// ------------------------------------------------------------------ beds
/** a bed (head at z = 0, its length along +z): one of eight frames, dressed in its covers */
export function bedV(P: Palette, w: number, l: number, v: number, C: BedCover): Kit {
  const k: Kit = [], wood = C.wood;
  let top = 0.44;
  if (v === 0) {
    // upholstered, a channel-tufted headboard
    k.push(rb(C.frame, w + 0.1, 0.3, l, 0.03, 0, 0.18, l / 2), rb(C.frame, w + 0.16, 1.05, 0.1, 0.04, 0, 0.525, 0.05, 4));
    const n = Math.round(w / 0.24);
    for (let i = 1; i < n; i++) k.push(bx(P.rubber, 0.006, 0.7, 0.004, -w / 2 - 0.08 + ((w + 0.16) / n) * i, 0.62, 0.101));
  } else if (v === 1) {
    // a low frame on legs, a slatted headboard
    k.push(rb(wood, w + 0.08, 0.12, l + 0.04, 0.01, 0, 0.24, l / 2));
    for (const [x, z] of [[-w / 2, 0.05], [w / 2, 0.05], [-w / 2, l - 0.02], [w / 2, l - 0.02]]) k.push(rb(wood, 0.06, 0.18, 0.06, 0.008, x, 0.09, z));
    const n = Math.round((w + 0.1) / 0.11);
    for (let i = 0; i < n; i++) k.push(rb(wood, 0.07, 0.75, 0.035, 0.006, -w / 2 - 0.05 + (w + 0.1) * (i + 0.5) / n, 0.62, 0.03));
    k.push(rb(wood, w + 0.14, 0.05, 0.06, 0.01, 0, 1.0, 0.03));
    top = 0.5;
  } else if (v === 2) {
    // a platform that seems to float, a wide panel headboard with a padded band
    k.push(rb(P.rubber, w - 0.2, 0.12, l - 0.3, 0.01, 0, 0.06, l / 2), rb(wood, w + 0.3, 0.16, l + 0.1, 0.01, 0, 0.2, l / 2 + 0.02));
    k.push(rb(wood, w + 1.0, 0.9, 0.06, 0.01, 0, 0.73, 0.03), rb(C.frame, w + 0.05, 0.42, 0.06, 0.04, 0, 0.82, 0.08));
    top = 0.48;
  } else if (v === 3) {
    // black steel: posts, rails and bars
    for (const x of [-w / 2 - 0.03, w / 2 + 0.03]) k.push(cy(P.blackMetal, 0.02, 0.02, 1.1, x, 0.55, 0.03, 10), cy(P.blackMetal, 0.02, 0.02, 0.55, x, 0.275, l, 10));
    k.push(rb(P.blackMetal, w + 0.08, 0.035, 0.035, 0.008, 0, 1.08, 0.03), rb(P.blackMetal, w + 0.08, 0.035, 0.035, 0.008, 0, 0.42, 0.03), rb(P.blackMetal, w + 0.08, 0.04, 0.04, 0.008, 0, 0.5, l));
    for (let i = 1; i < 8; i++) k.push(cy(P.blackMetal, 0.008, 0.008, 0.64, -w / 2 + w * i / 8, 0.75, 0.03, 8));
    for (const x of [-w / 2, w / 2]) k.push(rb(P.blackMetal, 0.035, 0.05, l, 0.006, x, 0.28, l / 2));
  } else if (v === 4) {
    // a tall buttoned wingback
    k.push(rb(C.frame, w + 0.1, 0.3, l, 0.03, 0, 0.18, l / 2), rb(C.frame, w + 0.3, 1.35, 0.14, 0.06, 0, 0.675, 0.07, 4));
    for (const s of [-1, 1]) k.push(rb(C.frame, 0.12, 1.25, 0.32, 0.05, s * (w / 2 + 0.11), 0.625, 0.2, 4));
    for (let r = 0; r < 3; r++) for (let x = -w / 2 + 0.2 + (r % 2) * 0.12; x < w / 2 - 0.1; x += 0.24) k.push(part(P.rubber, T(new THREE.SphereGeometry(0.013, 8, 6), x, 0.75 + r * 0.17, 0.142), false));
  } else if (v === 5) {
    // the Korean low bed: a thin platform on the floor, no headboard
    k.push(rb(wood, w + 0.4, 0.1, l + 0.3, 0.01, 0, 0.05, l / 2 + 0.05));
    top = 0.3;
  } else if (v === 6) {
    // a storage bed: drawers along the sides, a padded headboard
    k.push(rb(P.trim, w + 0.1, 0.32, l, 0.01, 0, 0.16, l / 2), rb(C.frame, w + 0.14, 0.7, 0.1, 0.04, 0, 0.75, 0.05, 4));
    for (const s of [-1, 1]) for (const z of [l * 0.3, l * 0.72]) k.push(bx(P.rubber, 0.004, 0.22, 0.6, s * (w / 2 + 0.051), 0.16, z), cy(P.handle, 0.008, 0.008, 0.12, s * (w / 2 + 0.06), 0.24, z, 8));
    top = 0.48;
  } else {
    // a cane-panel headboard in a wooden frame
    k.push(rb(wood, w + 0.1, 0.22, l, 0.01, 0, 0.22, l / 2), rb(wood, w + 0.16, 0.06, 0.06, 0.01, 0, 1.1, 0.03), rb(wood, 0.06, 1.1, 0.06, 0.01, -w / 2 - 0.05, 0.55, 0.03), rb(wood, 0.06, 1.1, 0.06, 0.01, w / 2 + 0.05, 0.55, 0.03));
    k.push(rb(C.frame, w + 0.04, 0.62, 0.012, 0.004, 0, 0.74, 0.03));
    for (let i = 0; i < 14; i++) k.push(bx(wood, w + 0.04, 0.004, 0.016, 0, 0.45 + i * 0.044, 0.035));
    top = 0.46;
  }
  // the mattress, the duvet (folded back at the top), the pillows, a runner across the foot
  k.push(rb(C.sheet, w, 0.24, l - 0.12, 0.06, 0, top, l / 2 + 0.04, 4));
  const dl = l * 0.74, dt = top + 0.06;
  k.push(part(C.duvet, T(puff(w + 0.12, 0.26, dl, { bulge: 0.12, pinch: 0.75, crease: 0.07, seed: 5 + v, seg: 22 }), 0, dt, l - dl / 2 + 0.02)));
  k.push(part(C.duvet, T(puff(w + 0.1, 0.12, 0.3, { bulge: 0.3, pinch: 0.5, crease: 0.1, seed: 9 + v }), 0, dt + 0.14, l - dl + 0.12)));
  if (v % 3 !== 1) k.push(part(C.runner, T(puff(w + 0.16, 0.05, 0.48, { bulge: 0.1, pinch: 0.85, crease: 0.05, seed: 2 }), 0, dt + 0.145, l * 0.83)));
  const pw = w > 1.3 ? 0.66 : 0.62, n = w > 1.3 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const g = puff(pw, 0.17, 0.44, { bulge: 0.5, pinch: 0.15, crease: 0.08, seed: 11 + i }); g.rotateX(-0.45);
    k.push(part(C.sheet, T(g, n === 1 ? 0 : (i ? 1 : -1) * w / 4, dt + 0.19, 0.3)));
  }
  // (a cushion in the runner's colour before the pillows, on some doubles)
  if (n === 2 && v % 2 === 0) { const g = puff(0.45, 0.14, 0.3, { bulge: 0.5, pinch: 0.2, crease: 0.06, seed: 31 }); g.rotateX(-0.6); k.push(part(C.runner, T(g, 0, dt + 0.2, 0.52))); }
  return k;
}

// ------------------------------------------------------------------ more chairs (after variants.ts's five)
/** chairs 5–9: a wishbone (a curved top rail, a woven seat), a café chair in bent metal, a ghost
 * chair in clear plastic, a low lounge chair on splayed legs, a ladder back */
export function chairMore(P: Palette, v: number): Kit {
  const k: Kit = [];
  const legs = (m: THREE.Material, r: number, h: number, inset = 0.2, splay = 0) => [[-inset, 0.06], [inset, 0.06], [-inset, 0.42], [inset, 0.42]].map(([x, z]) => { const g = new THREE.CylinderGeometry(r, r * 0.8, h, 10); g.rotateZ(Math.sign(x) * splay); return part(m, T(boxUV(g), x, h / 2, z)); });
  if (v === 5) {
    k.push(rb(P.linen, 0.46, 0.04, 0.42, 0.012, 0, 0.45, 0.24), ...legs(P.woodLight, 0.017, 0.45));
    const rail = new THREE.TorusGeometry(0.24, 0.016, 8, 24, Math.PI); rail.rotateX(Math.PI / 2); rail.scale(1, 1, 0.6);
    k.push(part(P.woodLight, T(boxUV(rail), 0, 0.72, 0.2)), cy(P.woodLight, 0.012, 0.012, 0.28, 0, 0.6, 0.06, 8));
  } else if (v === 6) {
    k.push(cy(P.woodDark, 0.21, 0.21, 0.03, 0, 0.46, 0.24, 28), ...legs(P.blackMetal, 0.011, 0.45, 0.17, 0.06));
    const back = new THREE.TorusGeometry(0.2, 0.01, 6, 24, Math.PI); back.rotateX(-0.1);
    k.push(part(P.blackMetal, T(boxUV(back), 0, 0.62, 0.05)), part(P.blackMetal, T(boxUV(new THREE.TorusGeometry(0.15, 0.008, 6, 24, Math.PI)), 0, 0.62, 0.05)));
  } else if (v === 7) {
    // clear polycarbonate: drawn in the glass
    k.push(part(P.glass, T(boxUV(new RoundedBoxGeometry(0.46, 0.04, 0.44, 2, 0.02)), 0, 0.46, 0.24), false), part(P.glass, T(boxUV(new RoundedBoxGeometry(0.44, 0.42, 0.04, 2, 0.02)), 0, 0.7, 0.04), false));
    for (const [x, z] of [[-0.2, 0.06], [0.2, 0.06], [-0.2, 0.42], [0.2, 0.42]]) k.push(part(P.glass, T(boxUV(new THREE.BoxGeometry(0.03, 0.45, 0.03)), x, 0.225, z), false));
  } else if (v === 8) {
    k.push(rb(P.velvet, 0.62, 0.12, 0.6, 0.04, 0, 0.36, 0.3), rb(P.velvet, 0.6, 0.42, 0.12, 0.05, 0, 0.62, 0.08, 4));
    for (const s of [-1, 1]) k.push(rb(P.velvet, 0.08, 0.2, 0.5, 0.03, s * 0.31, 0.5, 0.3));
    k.push(...legs(P.woodDark, 0.018, 0.3, 0.25, 0.12));
  } else {
    k.push(rb(P.linen, 0.46, 0.05, 0.42, 0.02, 0, 0.45, 0.24), ...legs(P.woodDark, 0.016, 0.45));
    for (const x of [-0.21, 0.21]) k.push(cy(P.woodDark, 0.014, 0.014, 0.5, x, 0.72, 0.05, 8));
    for (const y of [0.62, 0.74, 0.86]) k.push(rb(P.woodDark, 0.42, 0.05, 0.02, 0.008, 0, y, 0.05));
  }
  return k;
}

// ------------------------------------------------------------------ more switches (after variants.ts's four)
/** switches 4–11: three rockers, a brass toggle on a round plate, a slim white plate with a LED dot,
 * a grey matte double, a gold plate, an oak plate, two push buttons, a black rocker */
export function switchMore(P: Palette, v: number, keep: Keep): { plate: THREE.BufferGeometry; plateM: THREE.Material; rocker: THREE.BufferGeometry; rockerM: THREE.Material } {
  const brass = tinted(P.handle, "#c8a46a", keep), grey = tinted(P.plastic, "#8f9296", keep), wood = tinted(P.woodLight, "#b98f62", keep), black = tinted(P.plastic, "#1d1f22", keep);
  const merge = (gs: THREE.BufferGeometry[]) => { const ng = gs.map(g => (g.index ? g.toNonIndexed() : g)); const out = new THREE.BufferGeometry(); for (const name of ["position", "normal", "uv"]) { const arrs = ng.map(g => g.getAttribute(name)); if (arrs.some(a => !a)) continue; const len = arrs.reduce((s, a) => s + a.array.length, 0), arr = new Float32Array(len); let o = 0; for (const a of arrs) { arr.set(a.array as Float32Array, o); o += a.array.length; } out.setAttribute(name, new THREE.BufferAttribute(arr, arrs[0].itemSize)); } return out; };
  const rock = (w: number, h: number, x = 0) => boxUV(new RoundedBoxGeometry(w, h, 0.01, 2, 0.003)).translate(x, 0, 0);
  const plate = (w: number, h: number, r = 0.004) => boxUV(new RoundedBoxGeometry(w, h, 0.012, 2, r));
  switch (v) {
    case 4: return { plate: plate(0.15, 0.12), plateM: P.plastic, rocker: merge([rock(0.03, 0.085, -0.044), rock(0.03, 0.085, 0), rock(0.03, 0.085, 0.044)]), rockerM: P.plastic };
    case 5: return { plate: boxUV(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 32).rotateX(Math.PI / 2)), plateM: brass, rocker: boxUV(new THREE.CylinderGeometry(0.005, 0.006, 0.03, 10).rotateX(Math.PI / 2).translate(0, 0, 0.012)), rockerM: brass };
    case 6: return { plate: plate(0.07, 0.11, 0.003), plateM: P.trim, rocker: merge([rock(0.05, 0.08), boxUV(new THREE.CylinderGeometry(0.0025, 0.0025, 0.002, 10).rotateX(Math.PI / 2).translate(0, -0.03, 0.006))]), rockerM: P.trim };
    case 7: return { plate: plate(0.13, 0.12), plateM: grey, rocker: merge([rock(0.05, 0.085, -0.03), rock(0.05, 0.085, 0.03)]), rockerM: grey };
    case 8: return { plate: plate(0.08, 0.12, 0.002), plateM: brass, rocker: rock(0.05, 0.08), rockerM: P.plastic };
    case 9: return { plate: plate(0.09, 0.13, 0.006), plateM: wood, rocker: rock(0.05, 0.08), rockerM: P.plastic };
    case 10: return { plate: plate(0.08, 0.12), plateM: P.plastic, rocker: merge([boxUV(new THREE.CylinderGeometry(0.012, 0.012, 0.008, 20).rotateX(Math.PI / 2).translate(0, 0.022, 0)), boxUV(new THREE.CylinderGeometry(0.012, 0.012, 0.008, 20).rotateX(Math.PI / 2).translate(0, -0.022, 0))]), rockerM: P.chrome };
    default: return { plate: plate(0.08, 0.12), plateM: black, rocker: rock(0.052, 0.085), rockerM: black };
  }
}

// ------------------------------------------------------------------ pictures
/** a picture, painted: one of ten kinds, its composition and colours from the seed */
export function paintingTexture(seed: number): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 680;
  const g = c.getContext("2d")!, W = c.width, H = c.height;
  let s = (seed * 7919 + 13) % 2147483647 || 7;
  const R = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const pick = <X,>(xs: X[]) => xs[Math.floor(R() * xs.length)];
  const hsl = (h: number, sat: number, l: number, a = 1) => `hsla(${h},${sat}%,${l}%,${a})`;
  // (a painter's strokes: short dabs of near colours)
  const dabs = (x0: number, y0: number, w: number, h: number, hue: number, sat: number, l: number, n = 500, size = 16) => {
    for (let i = 0; i < n; i++) { g.fillStyle = hsl(hue + (R() - 0.5) * 16, sat + (R() - 0.5) * 14, l + (R() - 0.5) * 12, 0.5); g.beginPath(); g.ellipse(x0 + R() * w, y0 + R() * h, size * (0.4 + R()), size * 0.35 * (0.4 + R()), R() * Math.PI, 0, Math.PI * 2); g.fill(); }
  };
  const kind = seed % 10;
  if (kind === 0) {
    // landscape: sky, layered hills, a field, a few trees
    const hue = pick([200, 210, 30, 15, 260]);
    const sky = g.createLinearGradient(0, 0, 0, H * 0.6); sky.addColorStop(0, hsl(hue, 45, 70)); sky.addColorStop(1, hsl(hue + 20, 50, 86)); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    for (let layer = 0; layer < 4; layer++) {
      const base = H * (0.42 + layer * 0.12), l = 62 - layer * 12;
      g.fillStyle = hsl(110 + layer * 10 + (R() - 0.5) * 30, 25 + layer * 6, l); g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 16) g.lineTo(x, base - Math.sin(x / (120 + layer * 40) + R() * 0.2 + layer) * (40 - layer * 6) - R() * 6);
      g.lineTo(W, H); g.fill();
    }
    for (let i = 0; i < 6; i++) { const x = R() * W, y = H * (0.66 + R() * 0.2), r = 14 + R() * 24; g.fillStyle = hsl(120, 30, 22); g.fillRect(x - 2, y, 4, r); dabs(x - r, y - r * 1.4, r * 2, r * 1.4, 115, 35, 30, 40, 8); }
  } else if (kind === 1) {
    // the sea: a horizon, a sun or a moon, waves
    const warm = R() < 0.5, hue = warm ? 25 : 210;
    const sky = g.createLinearGradient(0, 0, 0, H * 0.55); sky.addColorStop(0, hsl(hue + 200 * +warm, 40, warm ? 55 : 35)); sky.addColorStop(1, hsl(hue, 70, warm ? 75 : 70)); g.fillStyle = sky; g.fillRect(0, 0, W, H * 0.55);
    g.fillStyle = hsl(hue, 80, warm ? 85 : 92); g.beginPath(); g.arc(W * (0.3 + R() * 0.4), H * 0.42, 46, 0, Math.PI * 2); g.fill();
    g.fillStyle = hsl(205, 45, 30); g.fillRect(0, H * 0.55, W, H * 0.45);
    for (let i = 0; i < 260; i++) { const y = H * 0.56 + Math.pow(R(), 1.6) * H * 0.44; g.strokeStyle = hsl(warm ? 30 : 200, 50, 50 + R() * 30, 0.5); g.lineWidth = 1 + (y - H * 0.55) / 60; g.beginPath(); const x = R() * W; g.moveTo(x, y); g.lineTo(x + 20 + R() * 60, y); g.stroke(); }
  } else if (kind === 2) {
    // still life: a table, a vase with flowers, fruit, shadows
    const wall = pick([[35, 25, 78], [200, 12, 72], [10, 30, 60], [90, 12, 70]]);
    g.fillStyle = hsl(wall[0], wall[1], wall[2]); g.fillRect(0, 0, W, H); dabs(0, 0, W, H * 0.62, wall[0], wall[1], wall[2], 700, 24);
    g.fillStyle = hsl(25, 35, 32); g.fillRect(0, H * 0.62, W, H * 0.38); dabs(0, H * 0.62, W, H * 0.38, 25, 35, 32, 400, 20);
    const vx = W * (0.3 + R() * 0.2), vh = 200;
    g.fillStyle = hsl(pick([200, 20, 160, 45]), 40, 45); g.beginPath(); g.ellipse(vx, H * 0.62 - vh * 0.35, 60, vh * 0.42, 0, 0, Math.PI * 2); g.fill(); g.fillRect(vx - 28, H * 0.62 - vh * 0.85, 56, 80);
    for (let i = 0; i < 12; i++) { const a = -Math.PI / 2 + (R() - 0.5) * 1.8, r = 120 + R() * 90, fx = vx + Math.cos(a) * r, fy = H * 0.62 - vh * 0.8 + Math.sin(a) * r; g.strokeStyle = hsl(110, 35, 28); g.lineWidth = 3; g.beginPath(); g.moveTo(vx, H * 0.62 - vh * 0.8); g.quadraticCurveTo(vx + (fx - vx) * 0.3, fy + 40, fx, fy); g.stroke(); dabs(fx - 22, fy - 22, 44, 44, pick([0, 330, 45, 55, 280]), 70, 60, 25, 12); }
    for (let i = 0; i < 4; i++) { const fx = W * (0.55 + R() * 0.3), fy = H * 0.66 + R() * 40; g.fillStyle = hsl(pick([10, 30, 50, 90]), 70, 50); g.beginPath(); g.arc(fx, fy, 30 + R() * 14, 0, Math.PI * 2); g.fill(); }
  } else if (kind === 3) {
    // a portrait: a plain ground, shoulders, a head turned a little, hair; painterly, no features drawn sharp
    const bg = pick([[200, 20, 40], [30, 30, 55], [140, 15, 35], [0, 25, 45], [45, 35, 70]]);
    g.fillStyle = hsl(bg[0], bg[1], bg[2]); g.fillRect(0, 0, W, H); dabs(0, 0, W, H, bg[0], bg[1], bg[2], 900, 30);
    const cx = W * (0.42 + R() * 0.16), skin = pick([[28, 45, 72], [25, 40, 62], [22, 35, 50]]), cloth = pick([210, 0, 30, 120, 270]);
    g.fillStyle = hsl(cloth, 35, 30); g.beginPath(); g.ellipse(cx, H * 1.02, 260, 220, 0, Math.PI, 0); g.fill(); dabs(cx - 260, H * 0.62, 520, H * 0.4, cloth, 35, 30, 300, 22);
    g.fillStyle = hsl(skin[0], skin[1], skin[2]); g.fillRect(cx - 40, H * 0.5, 80, 90);
    g.beginPath(); g.ellipse(cx, H * 0.4, 92, 120, (R() - 0.5) * 0.15, 0, Math.PI * 2); g.fill(); dabs(cx - 90, H * 0.24, 180, 230, skin[0], skin[1], skin[2], 200, 14);
    const hair = pick([[25, 30, 15], [30, 45, 30], [0, 0, 10], [35, 40, 55]]);
    g.fillStyle = hsl(hair[0], hair[1], hair[2]); g.beginPath(); g.ellipse(cx, H * 0.3, 104, 74, 0, Math.PI, 0); g.fill(); g.fillRect(cx - 104, H * 0.3, 30, 110 + R() * 120); g.fillRect(cx + 74, H * 0.3, 30, 110 + R() * 120);
    g.fillStyle = hsl(skin[0], skin[1], skin[2] - 22, 0.6); for (const ex of [-34, 34]) { g.beginPath(); g.ellipse(cx + ex, H * 0.4, 13, 6, 0, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = hsl(0, 40, 45, 0.7); g.beginPath(); g.ellipse(cx, H * 0.5, 22, 7, 0, 0, Math.PI * 2); g.fill();
  } else if (kind === 4) {
    // ink wash (수묵): grey mountains in mist on paper, a red seal
    g.fillStyle = "#efe9dc"; g.fillRect(0, 0, W, H);
    for (let layer = 0; layer < 5; layer++) {
      const base = H * (0.3 + layer * 0.14); g.fillStyle = `rgba(30,30,30,${0.12 + layer * 0.12})`; g.beginPath(); g.moveTo(0, H);
      let x = 0; while (x <= W) { g.lineTo(x, base - Math.abs(Math.sin(x / (60 + R() * 40) + layer)) * (120 - layer * 18) * R()); x += 10 + R() * 20; }
      g.lineTo(W, H); g.fill();
      g.fillStyle = "rgba(239,233,220,0.55)"; g.fillRect(0, base + 10, W, 30);
    }
    g.fillStyle = "#b5322b"; g.fillRect(W * 0.86, H * 0.12, 40, 40);
  } else if (kind === 5) {
    // geometric: blocks of flat colour on a grid, black lines
    const pal = pick([["#d7322b", "#1f4fa0", "#f0c419", "#f3efe6"], ["#2d6a6a", "#e0a96d", "#f2e9dc", "#c2553a"], ["#384e77", "#e6c79c", "#f5f1ea", "#8e8f6a"]]);
    g.fillStyle = pal[3]; g.fillRect(0, 0, W, H);
    const xs = [0, ...Array.from({ length: 3 }, () => R() * W).sort((a, b) => a - b), W], ys = [0, ...Array.from({ length: 2 }, () => R() * H).sort((a, b) => a - b), H];
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) if (R() < 0.35) { g.fillStyle = pal[Math.floor(R() * 3)]; g.fillRect(xs[i], ys[j], xs[i + 1] - xs[i], ys[j + 1] - ys[j]); }
    g.strokeStyle = "#151515"; g.lineWidth = 12; for (const x of xs) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); } for (const y of ys) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  } else if (kind === 6) {
    // botanical: a leafy stem drawn on cream
    g.fillStyle = "#f2ede2"; g.fillRect(0, 0, W, H);
    for (let st = 0; st < 1 + Math.floor(R() * 3); st++) {
      let x = W * (0.3 + R() * 0.4), y = H * 0.95; const hue = pick([100, 120, 80, 150]);
      g.strokeStyle = hsl(hue, 30, 30); g.lineWidth = 4;
      for (let i = 0; i < 14; i++) {
        const nx = x + (R() - 0.5) * 50, ny = y - 40; g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
        const side = i % 2 ? 1 : -1; g.fillStyle = hsl(hue, 35, 40 + R() * 15, 0.85); g.beginPath(); g.ellipse(nx + side * 38, ny + 6, 40, 15, side * 0.5, 0, Math.PI * 2); g.fill();
        x = nx; y = ny;
      }
    }
  } else if (kind === 7) {
    // a city at dusk: a gradient sky, block silhouettes, lit windows
    const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, hsl(240, 40, 22)); sky.addColorStop(0.6, hsl(20, 70, 60)); sky.addColorStop(1, hsl(35, 80, 70)); g.fillStyle = sky; g.fillRect(0, 0, W, H);
    let x = 0; while (x < W) { const w = 40 + R() * 90, h = 120 + R() * 360; g.fillStyle = hsl(240, 20, 12 + R() * 8); g.fillRect(x, H - h, w, h); for (let wy = H - h + 12; wy < H - 10; wy += 18) for (let wx = x + 8; wx < x + w - 8; wx += 14) if (R() < 0.35) { g.fillStyle = hsl(45, 90, 70, 0.9); g.fillRect(wx, wy, 6, 8); } x += w + 2; }
  } else if (kind === 8) {
    // one line: a face or a figure in a single black line on white
    g.fillStyle = pick(["#f7f4ee", "#efe6da", "#e9ece8"]); g.fillRect(0, 0, W, H);
    g.strokeStyle = "#1a1a1a"; g.lineWidth = 5; g.lineCap = "round"; g.beginPath();
    let px = W * 0.3, py = H * 0.8; g.moveTo(px, py);
    for (let i = 0; i < 26; i++) { const nx = W * (0.25 + R() * 0.5), ny = H * (0.15 + R() * 0.7); g.bezierCurveTo(px + (R() - 0.5) * 300, py - 120, nx + (R() - 0.5) * 300, ny + 120, nx, ny); px = nx; py = ny; }
    g.stroke();
    if (R() < 0.6) { g.fillStyle = pick(["#d9a48f", "#9fb3a3", "#e2c46b"]); g.globalAlpha = 0.7; g.beginPath(); g.arc(W * (0.3 + R() * 0.4), H * (0.3 + R() * 0.4), 90, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
  } else {
    // colour fields: two or three soft-edged bands (in the manner of a colour-field painting)
    const hue = R() * 360;
    g.fillStyle = hsl(hue, 40, 30); g.fillRect(0, 0, W, H);
    const bands = 2 + Math.floor(R() * 2);
    for (let b = 0; b < bands; b++) { const y0 = H * (0.08 + b * 0.84 / bands), h = H * 0.84 / bands - 20; g.fillStyle = hsl(hue + (R() - 0.5) * 80, 45 + R() * 30, 35 + R() * 35); g.filter = "blur(6px)"; g.fillRect(W * 0.08, y0, W * 0.84, h); g.filter = "none"; dabs(W * 0.08, y0, W * 0.84, h, hue, 40, 45, 120, 30); }
  }
  // the canvas weave and a varnish's faint sheen
  g.globalAlpha = 0.06; for (let i = 0; i < 4000; i++) { g.fillStyle = R() > 0.5 ? "#000" : "#fff"; g.fillRect(R() * W, R() * H, 2, 2); } g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** a picture frame: thin dark wood, oak, black metal, brass, white with a mount, or a frameless deep canvas */
export function frameV(P: Palette, w: number, h: number, canvas: THREE.Material, v: number, keep: Keep): Kit {
  if (v === 5) return [rb(P.trim, w, h, 0.04, 0.004, 0, 0, 0.02), part(canvas, T(new THREE.PlaneGeometry(w - 0.004, h - 0.004), 0, 0, 0.0405))];
  const fm = [P.woodDark, P.woodLight, P.blackMetal, tinted(P.handle, "#b8935a", keep), P.trim][v] ?? P.woodDark;
  const f = v === 2 || v === 3 ? 0.014 : 0.03, mount = v === 4 ? 0.07 : 0;
  const k: Kit = [bx(fm, w, f, 0.035, 0, h / 2 - f / 2, 0.0175), bx(fm, w, f, 0.035, 0, -h / 2 + f / 2, 0.0175), bx(fm, f, h, 0.035, -w / 2 + f / 2, 0, 0.0175), bx(fm, f, h, 0.035, w / 2 - f / 2, 0, 0.0175)];
  if (mount) k.push(bx(P.trim, w - 2 * f, h - 2 * f, 0.004, 0, 0, 0.01));
  k.push(part(canvas, T(new THREE.PlaneGeometry(w - 2 * f - 2 * mount, h - 2 * f - 2 * mount), 0, 0, 0.0125)));
  return k;
}

// ------------------------------------------------------------------ what stands on things
/** a little arrangement for a table or a cabinet top (frame: the surface at y = 0, centred), one of
 * twelve: a vase with stems, a stack of books with a candle, a fruit bowl, a tray with cups, a
 * sculpture, a framed photograph and a small plant, a pair of ceramic vessels, a lantern... */
export function propsV(P: Palette, v: number, keep: Keep): Kit {
  const glaze = tinted(P.ceramic, pick6(v), keep), k: Kit = [];
  const vase = (x: number, r: number, h: number, m: THREE.Material) => { const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(r * 0.7, 0), new THREE.Vector2(r, h * 0.35), new THREE.Vector2(r * 0.5, h * 0.85), new THREE.Vector2(r * 0.55, h), new THREE.Vector2(0, h)]; return part(m, T(boxUV(new THREE.LatheGeometry(pts, 20)), x, 0, 0)); };
  const books = (x: number, n: number) => { for (let i = 0; i < n; i++) k.push(bx(i % 2 ? P.book : tinted(P.book, ["#7a2e2e", "#2e4a6a", "#d8cfc0", "#3f5a47"][i % 4], keep), 0.24 - i * 0.012, 0.03, 0.17, x, 0.015 + i * 0.031, (i % 2) * 0.01)); };
  switch (v % 12) {
    case 0: k.push(vase(0, 0.07, 0.3, glaze)); for (let i = 0; i < 5; i++) k.push(cy(P.plantLeaf, 0.003, 0.003, 0.35, (i - 2) * 0.02, 0.45, (i % 2) * 0.02, 6)); break;
    case 1: books(-0.05, 3); k.push(cy(tinted(P.trim, "#efe6d3", keep), 0.035, 0.035, 0.09, 0.15, 0.045, 0, 16)); break;
    case 2: k.push(part(glaze, T(boxUV(new THREE.SphereGeometry(0.15, 24, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)).scale(1, 0.4, 1), 0, 0.06, 0))); for (let i = 0; i < 4; i++) k.push(part(tinted(P.ceramic, ["#c8442c", "#e3a52c", "#8db04a", "#d16a2a"][i], keep), T(new THREE.SphereGeometry(0.04, 12, 8), (i - 1.5) * 0.055, 0.07, (i % 2) * 0.03), false)); break;
    case 3: k.push(rb(P.woodLight, 0.36, 0.02, 0.24, 0.008, 0, 0.01, 0)); for (const x of [-0.08, 0.08]) k.push(cy(glaze, 0.035, 0.03, 0.08, x, 0.06, 0, 16)); break;
    case 4: k.push(rb(P.blackMetal, 0.1, 0.02, 0.1, 0.004, 0, 0.01, 0), part(glaze, T(boxUV(new THREE.TorusKnotGeometry(0.06, 0.018, 64, 8)), 0, 0.12, 0))); break;
    case 5: k.push(rb(P.blackMetal, 0.16, 0.2, 0.012, 0.004, -0.08, 0.1, 0), bx(tinted(P.art, "#9fb0b8", keep), 0.13, 0.17, 0.002, -0.08, 0.1, 0.007), cy(P.pot, 0.05, 0.04, 0.09, 0.12, 0.045, 0, 14)); for (let i = 0; i < 6; i++) k.push(part(P.plantLeaf, T(new THREE.SphereGeometry(0.03, 8, 6).scale(1, 0.5, 1), 0.12 + Math.cos(i) * 0.03, 0.11 + (i % 3) * 0.015, Math.sin(i) * 0.03), false)); break;
    case 6: k.push(vase(-0.06, 0.06, 0.24, glaze), vase(0.07, 0.045, 0.16, tinted(P.ceramic, pick6(v + 3), keep))); break;
    case 7: k.push(rb(P.blackMetal, 0.14, 0.02, 0.14, 0.004, 0, 0.01, 0), part(P.glass, T(boxUV(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 16, 1, true)), 0, 0.12, 0), false), cy(tinted(P.trim, "#f2ead8", keep), 0.03, 0.03, 0.08, 0, 0.06, 0, 12), rb(P.blackMetal, 0.14, 0.015, 0.14, 0.004, 0, 0.23, 0)); break;
    case 8: books(0, 4); k.push(part(glaze, T(new THREE.SphereGeometry(0.04, 16, 10), 0, 0.165, 0))); break;
    case 9: k.push(cy(P.pot, 0.08, 0.06, 0.14, 0, 0.07, 0, 16)); for (let i = 0; i < 9; i++) { const g = new THREE.ConeGeometry(0.012, 0.22 + (i % 3) * 0.05, 5); g.rotateZ((i - 4) * 0.12); k.push(part(P.plantLeaf, T(g, (i - 4) * 0.01, 0.25, (i % 2) * 0.02), false)); } break;
    case 10: k.push(vase(0, 0.1, 0.42, glaze)); for (let i = 0; i < 3; i++) { const g = new THREE.CylinderGeometry(0.004, 0.003, 0.6, 5); g.rotateZ((i - 1) * 0.3); k.push(part(P.woodDark, T(g, (i - 1) * 0.05, 0.62, 0), false)); } break;
    default: books(-0.08, 2); k.push(part(glaze, T(boxUV(new THREE.IcosahedronGeometry(0.06, 0)), 0.14, 0.06, 0)), cy(P.chrome, 0.03, 0.03, 0.005, 0.14, 0.0025, 0, 16)); break;
  }
  return k;
}
function pick6(v: number) { return ["#e9e4da", "#2f3a4f", "#b5654a", "#8ca39a", "#d8c28a", "#3c3c3c", "#c9a3a0", "#7d8f6a"][v % 8]; }
