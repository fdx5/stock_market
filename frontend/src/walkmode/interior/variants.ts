import * as THREE from "three";
import { boxUV, RoundedBoxGeometry } from "./geom";
import type { Palette } from "./materials";
import { bx, cy, rb, chair, coffeeTable, pendant, puff, sofa, standAircon, toilet, type Kit, type Part } from "./models";

/* More than one of each thing, so no two flats are furnished alike: the flat's own number picks
 * (variantOf: a hash of the complex, the 동, the floor and the thing) one of —
 *   sofa        fabric with arms · low modular · leather with rolled arms · an L-shaped corner ·
 *               a slim mid-century one on wooden legs
 *   chair       linen on wooden legs · a spindle-back wooden chair · an upholstered high back ·
 *               a moulded shell on a metal frame · a round stool
 *   pendant     an opal globe · a black metal cone · a clear glass globe · a fabric drum · a brass dome
 *   toilet      one-piece · wall-hung (the cistern in the wall) · one-piece with a bidet seat
 *   coffee      an oval marble top · a rectangular oak table · a pair of round nesting tables
 *   aircon      a stand · a wall-mounted unit high on the wall · a ceiling cassette (system aircon)
 *   switch      a wide rocker · two rockers · a round dimmer · a black glass touch panel
 *   중문         slim black aluminium · oak frame with a frosted panel · bronze grid · white full-height
 * Each in the models' frame: the floor at y = 0, the back to the wall at z = 0, facing +z. */

const T = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);
const part = (m: THREE.Material, g: THREE.BufferGeometry, cast = true): Part => ({ m, g, cast });

export function variantOf(seed: string, key: string, n: number) {
  let h = 2166136261;
  for (const c of seed + "|" + key) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 997) % n;
}

// ------------------------------------------------------------------ sofas
export function sofaV(P: Palette, w: number, v: number): Kit {
  if (v === 0) return sofa(P, w);
  const k: Kit = [], F = P.fabricSofa;
  if (v === 1) {
    // low modular: no arms, deep square seats, low cushioned back, a hidden plinth
    const d = 1.05, n = w > 2.3 ? 3 : 2, cw = w / n;
    k.push(bx(P.rubber, w - 0.06, 0.08, d - 0.08, 0, 0.04, d / 2));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + cw * (i + 0.5);
      k.push({ m: F, g: T(puff(cw - 0.01, 0.3, d - 0.02, { bulge: 0.12, pinch: 0.6, crease: 0.04, seed: i + 2 }), x, 0.23, d / 2) });
      const back = puff(cw - 0.03, 0.18, 0.42, { bulge: 0.3, pinch: 0.5, crease: 0.07, seed: i + 9 }); back.rotateX(Math.PI / 2 - 0.2);
      k.push({ m: F, g: T(back, x, 0.58, 0.12) });
    }
    return k;
  }
  if (v === 2) {
    // leather, rolled arms, a buttoned back, dark turned feet
    const d = 0.95, L = P.leather;
    k.push(rb(L, w, 0.24, d, 0.04, 0, 0.16, d / 2));
    k.push(rb(L, w, 0.62, 0.22, 0.06, 0, 0.38, 0.11));
    for (const s of [-1, 1]) {
      k.push(rb(L, 0.22, 0.5, d, 0.05, s * (w / 2 - 0.11), 0.3, d / 2));
      const roll = new THREE.CylinderGeometry(0.13, 0.13, d, 24); roll.rotateX(Math.PI / 2);
      k.push(part(L, T(boxUV(roll), s * (w / 2 - 0.11), 0.6, d / 2)));
    }
    const n = w > 2.3 ? 3 : 2, cw = (w - 0.44) / n;
    for (let i = 0; i < n; i++) k.push({ m: L, g: T(puff(cw - 0.01, 0.15, d - 0.25, { bulge: 0.15, pinch: 0.7, crease: 0.03, seed: i + 4 }), -w / 2 + 0.22 + cw * (i + 0.5), 0.35, 0.22 + (d - 0.25) / 2) });
    // the back's buttons in a diamond
    for (let r = 0; r < 2; r++) for (let x = -w / 2 + 0.35 + (r ? 0.15 : 0); x < w / 2 - 0.3; x += 0.3) k.push(part(P.rubber, T(new THREE.SphereGeometry(0.012, 8, 6), x, 0.55 + r * 0.14, 0.225), false));
    for (const s of [-1, 1]) for (const z of [0.1, d - 0.1]) k.push(cy(P.woodDark, 0.03, 0.022, 0.06, s * (w / 2 - 0.1), 0.03, z, 12));
    return k;
  }
  if (v === 3) {
    // an L-shaped corner sofa: the seat run along the wall and a chaise out at one end
    const d = 0.95, ch = 1.6;
    k.push(...sofa(P, w));
    k.push({ m: F, g: T(puff(0.85, 0.36, ch - d + 0.05, { bulge: 0.1, pinch: 0.6, crease: 0.04, seed: 21 }), w / 2 - 0.45, 0.2, d + (ch - d) / 2 - 0.02) });
    k.push({ m: F, g: T(puff(0.82, 0.14, ch - d, { bulge: 0.2, pinch: 0.7, crease: 0.05, seed: 22 }), w / 2 - 0.45, 0.42, d + (ch - d) / 2) });
    return k;
  }
  // v4: slim mid-century on tapered oak legs, one long bench cushion, bolsters
  const d = 0.86;
  k.push(rb(F, w, 0.14, d, 0.03, 0, 0.3, d / 2));
  k.push(rb(F, w - 0.1, 0.48, 0.14, 0.04, 0, 0.6, 0.08));
  for (const s of [-1, 1]) k.push(rb(F, 0.08, 0.3, d - 0.05, 0.03, s * (w / 2 - 0.04), 0.5, d / 2));
  k.push({ m: F, g: T(puff(w - 0.18, 0.13, d - 0.18, { bulge: 0.12, pinch: 0.7, crease: 0.03, seed: 31 }), 0, 0.43, 0.16 + (d - 0.18) / 2) });
  for (const s of [-1, 1]) { const b = new THREE.CylinderGeometry(0.1, 0.1, 0.45, 24); b.rotateX(Math.PI / 2); b.rotateY(Math.PI / 2); k.push(part(P.velvet, T(boxUV(b), s * (w / 2 - 0.34), 0.58, 0.3))); }
  for (const s of [-1, 1]) for (const z of [0.1, d - 0.1]) { const l = new THREE.CylinderGeometry(0.022, 0.013, 0.24, 10); l.rotateZ(s * 0.12); k.push(part(P.woodLight, T(boxUV(l), s * (w / 2 - 0.12), 0.12, z))); }
  return k;
}

// ------------------------------------------------------------------ chairs
export function chairV(P: Palette, v: number): Kit {
  if (v === 0) return chair(P);
  const k: Kit = [];
  const legs = (m: THREE.Material, r0: number, r1: number, h: number, inset = 0.2) => [[-inset, 0.06], [inset, 0.06], [-inset, 0.42], [inset, 0.42]].map(([x, z]) => cy(m, r0, r1, h, x, h / 2, z, 10));
  if (v === 1) {
    // a wooden chair with a spindle back
    k.push(rb(P.woodLight, 0.46, 0.035, 0.44, 0.012, 0, 0.45, 0.24), ...legs(P.woodLight, 0.016, 0.013, 0.44));
    for (let i = 0; i < 5; i++) k.push(cy(P.woodLight, 0.008, 0.008, 0.4, -0.16 + i * 0.08, 0.66, 0.04, 8));
    k.push(rb(P.woodLight, 0.44, 0.05, 0.03, 0.012, 0, 0.88, 0.04));
    return k;
  }
  if (v === 2) {
    // upholstered, a high curved back, black metal legs
    k.push(rb(P.velvet, 0.48, 0.09, 0.46, 0.035, 0, 0.47, 0.25), rb(P.velvet, 0.46, 0.5, 0.07, 0.035, 0, 0.78, 0.04, 4), ...legs(P.blackMetal, 0.012, 0.01, 0.43));
    return k;
  }
  if (v === 3) {
    // a moulded shell on a thin metal frame
    const shell = new THREE.SphereGeometry(0.3, 28, 14, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.32); shell.scale(0.8, 0.9, 0.75); shell.rotateX(-0.35);
    k.push(part(P.plastic, T(boxUV(shell), 0, 0.72, 0.22)), ...legs(P.chrome, 0.007, 0.007, 0.45, 0.18));
    return k;
  }
  // v4: a round wooden stool
  k.push(cy(P.woodDark, 0.17, 0.17, 0.04, 0, 0.46, 0.22, 28));
  for (const a of [0, 2.1, 4.2]) { const l = new THREE.CylinderGeometry(0.015, 0.012, 0.45, 8); l.rotateZ(Math.cos(a) * 0.12); l.rotateX(Math.sin(a) * 0.12); k.push(part(P.woodDark, T(boxUV(l), Math.cos(a) * 0.12, 0.225, 0.22 + Math.sin(a) * 0.12))); }
  return k;
}

// ------------------------------------------------------------------ pendant lights
export function pendantV(P: Palette, drop: number, v: number): Kit {
  if (v === 0) return pendant(P, drop);
  const cord = cy(P.blackMetal, 0.002, 0.002, drop, 0, -drop / 2, 0, 6), y = -drop;
  if (v === 1) return [cord, part(P.blackMetal, T(boxUV(new THREE.CylinderGeometry(0.02, 0.14, 0.18, 32, 1, true)), 0, y - 0.09, 0)), part(P.lampShade, T(new THREE.CircleGeometry(0.13, 24).rotateX(Math.PI / 2), 0, y - 0.175, 0), false)];
  if (v === 2) return [cord, part(P.glass, T(new THREE.SphereGeometry(0.12, 28, 16), 0, y - 0.12, 0), false), part(P.lampShade, T(new THREE.SphereGeometry(0.03, 12, 8), 0, y - 0.12, 0), false), cy(P.chrome, 0.03, 0.03, 0.03, 0, y - 0.005, 0, 16)];
  if (v === 3) return [cord, part(P.lampShade, T(boxUV(new THREE.CylinderGeometry(0.2, 0.2, 0.2, 40, 1, true)), 0, y - 0.1, 0), false), part(P.lampShade, T(new THREE.CircleGeometry(0.2, 32).rotateX(Math.PI / 2), 0, y - 0.2, 0), false)];
  return [cord, part(P.handle, T(boxUV(new THREE.SphereGeometry(0.16, 32, 12, 0, Math.PI * 2, 0, Math.PI * 0.5)), 0, y - 0.16, 0)), part(P.lampShade, T(new THREE.CircleGeometry(0.155, 28).rotateX(Math.PI / 2), 0, y - 0.161, 0), false)];
}

// ------------------------------------------------------------------ toilets
export function toiletV(P: Palette, v: number): Kit {
  if (v === 0) return toilet(P);
  const k: Kit = toilet(P).filter((_, i) => v === 2 || i === 0 || i >= 5);
  if (v === 1) {
    // wall-hung: the bowl only, off the floor; the cistern behind a tiled box, a flush plate on it
    for (const p of k) p.g.translate(0, 0.06, 0.04);
    k.push(rb(P.wallWet, 0.6, 1.05, 0.2, 0.01, 0, 0.525, 0.1), rb(P.chrome, 0.22, 0.15, 0.012, 0.01, 0, 0.98, 0.205));
    return k;
  }
  // v2: one-piece with an electronic bidet seat (a thicker seat, the control arm at the side)
  k.push(rb(P.plastic, 0.42, 0.06, 0.18, 0.03, 0, 0.42, 0.18), rb(P.plastic, 0.07, 0.05, 0.22, 0.02, 0.24, 0.45, 0.32), rb(P.screen, 0.04, 0.005, 0.12, 0.004, 0.24, 0.477, 0.32));
  return k;
}

// ------------------------------------------------------------------ coffee tables
export function coffeeTableV(P: Palette, v: number): Kit {
  if (v === 0) return coffeeTable(P);
  if (v === 1) {
    const k: Kit = [rb(P.woodLight, 1.2, 0.04, 0.6, 0.012, 0, 0.36, 0)];
    for (const [x, z] of [[-0.52, -0.22], [0.52, -0.22], [-0.52, 0.22], [0.52, 0.22]]) k.push(rb(P.woodLight, 0.05, 0.34, 0.05, 0.008, x, 0.17, z));
    k.push(rb(P.woodLight, 1.1, 0.02, 0.5, 0.008, 0, 0.1, 0), ...[0, 1, 2].map(i => bx(i % 2 ? P.book : P.trim, 0.26, 0.03, 0.19, -0.3, 0.125 + i * 0.031, 0)));
    return k;
  }
  // a pair of round nesting tables: black metal, a smoked glass top and an oak one
  return [cy(P.blackMetal, 0.36, 0.36, 0.015, -0.18, 0.4, 0, 40), part(P.glass, T(new THREE.CylinderGeometry(0.35, 0.35, 0.01, 40), -0.18, 0.41, 0)), cy(P.blackMetal, 0.012, 0.012, 0.4, -0.18, 0.2, 0, 8),
    cy(P.woodLight, 0.26, 0.26, 0.025, 0.32, 0.32, 0.12, 36), cy(P.blackMetal, 0.012, 0.012, 0.32, 0.32, 0.16, 0.12, 8), cy(P.blackMetal, 0.16, 0.16, 0.01, 0.32, 0.005, 0.12, 24), cy(P.blackMetal, 0.2, 0.2, 0.01, -0.18, 0.005, 0, 24)];
}

// ------------------------------------------------------------------ aircons
export { standAircon };
/** a wall-mounted split unit, its underside 2.0 m up (frame: on the wall, facing out) */
export function wallAircon(P: Palette): Kit {
  const k: Kit = [rb(P.appliance, 0.95, 0.3, 0.23, 0.04, 0, 2.15, 0.115, 4)];
  k.push(rb(P.applianceDark, 0.82, 0.05, 0.02, 0.01, 0, 2.03, 0.22));                // the louvre
  k.push(rb(P.applianceDark, 0.06, 0.02, 0.004, 0.004, 0.36, 2.24, 0.231));
  // its pipe sleeve down the wall to the outdoor unit's hole
  k.push(rb(P.trim, 0.07, 0.4, 0.06, 0.01, 0.42, 1.8, 0.03));
  return k;
}
/** a ceiling cassette (a new flat's 시스템 에어컨): the square panel flush with the ceiling at y = 0 (frame: the ceiling) */
export function ceilingCassette(P: Palette): Kit {
  const k: Kit = [rb(P.appliance, 0.95, 0.04, 0.95, 0.01, 0, -0.02, 0)];
  k.push(rb(P.trim, 0.56, 0.006, 0.56, 0.004, 0, -0.043, 0));
  for (const [x, z, w, d] of [[0, 0.36, 0.6, 0.07], [0, -0.36, 0.6, 0.07], [0.36, 0, 0.07, 0.6], [-0.36, 0, 0.07, 0.6]]) k.push(bx(P.applianceDark, w, 0.006, d, x, -0.043, z));
  return k;
}

// ------------------------------------------------------------------ light switches
/** the plate and its moving part(s) for a switch style (in the plate's frame, facing +z) */
export function switchV(P: Palette, v: number): { plate: THREE.BufferGeometry; plateM: THREE.Material; rocker: THREE.BufferGeometry; rockerM: THREE.Material } {
  if (v === 1) {
    // two rockers side by side on a wide plate
    const r = new THREE.BoxGeometry(0.03, 0.08, 0.01), r2 = r.clone().translate(0.034, 0, 0); r.translate(-0.034, 0, 0);
    const merged = mergePair(r, r2);
    return { plate: boxUV(new RoundedBoxGeometry(0.12, 0.12, 0.012, 2, 0.004)), plateM: P.plastic, rocker: merged, rockerM: P.plastic };
  }
  if (v === 2) return { plate: boxUV(new RoundedBoxGeometry(0.086, 0.086, 0.012, 2, 0.006)), plateM: P.plastic, rocker: boxUV(new THREE.CylinderGeometry(0.022, 0.024, 0.012, 24).rotateX(Math.PI / 2)), rockerM: P.handle };
  if (v === 3) return { plate: boxUV(new RoundedBoxGeometry(0.086, 0.13, 0.01, 2, 0.004)), plateM: P.applianceDark, rocker: boxUV(new THREE.BoxGeometry(0.03, 0.006, 0.004)), rockerM: P.ledPanel };
  return { plate: boxUV(new RoundedBoxGeometry(0.075, 0.12, 0.012, 2, 0.004)), plateM: P.plastic, rocker: boxUV(new RoundedBoxGeometry(0.052, 0.085, 0.01, 2, 0.003)), rockerM: P.plastic };
}
function mergePair(a: THREE.BufferGeometry, b: THREE.BufferGeometry) {
  const A = a.index ? a.toNonIndexed() : a, B = b.index ? b.toNonIndexed() : b, out = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv"]) {
    const x = A.getAttribute(name), y = B.getAttribute(name); if (!x || !y) continue;
    const arr = new Float32Array(x.array.length + y.array.length); arr.set(x.array as Float32Array); arr.set(y.array as Float32Array, x.array.length);
    out.setAttribute(name, new THREE.BufferAttribute(arr, x.itemSize));
  }
  [a, b, A, B].forEach(g => g.dispose());
  return out;
}

// ------------------------------------------------------------------ 중문 panels
/** the frame and bars of one 중문 panel, by style: the frame's material and width, the rails
 * (heights, as a share of the panel's) and the stiles (across, -0.5…0.5), whether the glass is frosted */
export function middleDoorBars(v: number): { m: "blackMetal" | "woodLight" | "handle" | "trim"; f: number; rails: number[]; stiles: number[]; frosted: boolean } {
  if (v === 1) return { m: "woodLight", f: 0.065, rails: [0.42], stiles: [], frosted: true };
  if (v === 2) return { m: "handle", f: 0.024, rails: [0.25, 0.5, 0.75], stiles: [0], frosted: false };
  if (v === 3) return { m: "trim", f: 0.035, rails: [], stiles: [0.22], frosted: true };
  return { m: "blackMetal", f: 0.028, rails: [0.36, 0.68], stiles: [], frosted: false };
}
