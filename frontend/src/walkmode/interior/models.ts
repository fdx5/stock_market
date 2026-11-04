import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { boxUV, RoundedBoxGeometry } from "./geom";
import type { Palette } from "./materials";

/* Furniture and fittings, modelled in code at their real sizes (Korean flats: a 75" TV, a 3.5-seat
 * fabric sofa, a queen bed, 600 mm kitchen modules at 850 mm, a one-piece toilet…). Each model is a
 * list of parts in its own frame: origin at the floor, the back against the wall at z = 0, facing
 * +z, centred on x. Parts are merged into the room's batches; the moving ones are made apart. */

export interface Part { m: THREE.Material; g: THREE.BufferGeometry; cast?: boolean }
export type Kit = Part[];

const T = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);
// Repeated chairs/desks have identical parts. Keep a bounded, construction-only cache of their
// untranslated geometry; callers still own independent clones, at exactly the original detail.
let shapeCache: Map<string, THREE.BufferGeometry> | null = null;
export function withKitGeometryCache<T>(make: () => T): T {
  const previous = shapeCache, cache = new Map<string, THREE.BufferGeometry>(); shapeCache = cache;
  try { return make(); } finally { shapeCache = previous; for (const g of cache.values()) g.dispose(); }
}
function shape(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  if (!shapeCache) return make();
  const had = shapeCache.get(key); if (had) return had.clone();
  const g = make();
  if (shapeCache.size >= 96) { const first = shapeCache.keys().next().value!; shapeCache.get(first)!.dispose(); shapeCache.delete(first); }
  shapeCache.set(key, g); return g.clone();
}
export const rb = (P: THREE.Material, w: number, h: number, d: number, r: number, x: number, y: number, z: number, seg = 3): Part =>
  ({ m: P, g: T(shape(`r|${w}|${h}|${d}|${r}|${seg}`, () => boxUV(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)))), x, y, z) });
export const bx = (P: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): Part =>
  ({ m: P, g: T(shape(`b|${w}|${h}|${d}`, () => boxUV(new THREE.BoxGeometry(w, h, d))), x, y, z) });
export const cy = (P: THREE.Material, r0: number, r1: number, h: number, x: number, y: number, z: number, seg = 24): Part =>
  ({ m: P, g: T(shape(`c|${r0}|${r1}|${h}|${seg}`, () => boxUV(new THREE.CylinderGeometry(r0, r1, h, seg))), x, y, z) });
const lathe = (_m: THREE.Material, pts: [number, number][], seg = 40): THREE.BufferGeometry => boxUV(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg));
const part = (m: THREE.Material, g: THREE.BufferGeometry, cast = true): Part => ({ m, g, cast });

/** A filled, sewn shape — a cushion, a pillow, a duvet: a box whose edges pinch to the seam and
 * whose faces swell, with a few soft creases. `bulge` how much the middle swells, `pinch` the
 * seam's thickness (of h), `crease` the wrinkles' depth (of h). Centred on the origin. */
export function puff(w: number, h: number, d: number, o: { bulge?: number; pinch?: number; crease?: number; seed?: number; seg?: number } = {}): THREE.BufferGeometry {
  const seg = o.seg ?? 14, bulge = o.bulge ?? 0.25, pinch = o.pinch ?? 0.45, crease = o.crease ?? 0.06, sd = o.seed ?? 1;
  let g: THREE.BufferGeometry = new THREE.BoxGeometry(1, 1, 1, seg, Math.max(2, seg >> 2), seg);
  g.deleteAttribute("normal"); g.deleteAttribute("uv");
  g = mergeVertices(g);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const wav = (u: number, v: number) => Math.sin(u * 5.1 + sd * 1.7) * Math.sin(v * 3.3 + sd) * 0.6 + Math.sin(u * 2.3 - v * 4.1 + sd * 2.9) * 0.4;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) * 2, t = p.getY(i) * 2, v = p.getZ(i) * 2;
    const fu = 1 - Math.abs(u) ** 4, fv = 1 - Math.abs(v) ** 4, f = Math.max(0, fu * fv);
    const th = h / 2 * (pinch + (1 - pinch) * Math.sqrt(f)) * (1 + bulge * f);
    // (the sides draw in toward the seam as the faces swell)
    const inset = 1 - 0.06 * Math.abs(t) * bulge;
    p.setXYZ(i, u * w / 2 * inset, t * th + Math.sign(t) * crease * h * wav(u, v) * f, v * d / 2 * inset);
  }
  g.computeVertexNormals();
  return boxUV(g);
}
const pf = (m: THREE.Material, g: THREE.BufferGeometry, x: number, y: number, z: number): Part => ({ m, g: T(g, x, y, z) });

// ------------------------------------------------------------------ living room

export function sofa(P: Palette, w: number): Kit {
  const d = 0.98, seatH = 0.42, arm = 0.2, k: Kit = [];
  const F = P.fabricSofa;
  k.push(rb(F, w, 0.22, d, 0.04, 0, 0.13, d / 2));                       // base
  k.push(rb(F, w, 0.66, 0.24, 0.07, 0, 0.36, 0.12));                     // back frame
  k.push(rb(F, arm, 0.6, d, 0.06, -w / 2 + arm / 2, 0.32, d / 2));       // arms
  k.push(rb(F, arm, 0.6, d, 0.06, w / 2 - arm / 2, 0.32, d / 2));
  const n = w > 2.3 ? 3 : 2, cw = (w - 2 * arm) / n;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + arm + cw * (i + 0.5);
    k.push(pf(F, puff(cw - 0.008, 0.17, d - 0.27, { bulge: 0.18, pinch: 0.7, crease: 0.05, seed: i + 1 }), x, seatH - 0.07, 0.26 + (d - 0.27) / 2));  // seat cushion
    const back = puff(cw - 0.02, 0.2, 0.5, { bulge: 0.35, pinch: 0.55, crease: 0.08, seed: i + 7 });
    back.rotateX(Math.PI / 2 - 0.14); k.push(pf(F, back, x, seatH + 0.28, 0.33));
  }
  // two throw pillows, plumped and leaning back
  for (const s of [-1, 1]) {
    const g = puff(0.45, 0.16, 0.45, { bulge: 0.55, pinch: 0.12, crease: 0.1, seed: s + 3 });
    g.rotateX(Math.PI / 2 - 0.3); g.rotateZ(s * 0.06); k.push(pf(P.velvet, g, s * (w / 2 - arm - 0.3), seatH + 0.22, 0.46));
  }
  for (const s of [-1, 1]) for (const z of [0.08, d - 0.08]) k.push(cy(P.blackMetal, 0.018, 0.014, 0.035, s * (w / 2 - 0.08), 0.0175, z, 12));
  return k;
}

export function coffeeTable(P: Palette): Kit {
  const k: Kit = [];
  const top = new THREE.CylinderGeometry(0.42, 0.42, 0.025, 48); top.scale(1.55, 1, 1);
  k.push(part(P.counter, T(boxUV(top), 0, 0.37, 0)));
  const base = new THREE.CylinderGeometry(0.3, 0.32, 0.34, 40); base.scale(1.5, 1, 0.9);
  k.push(part(P.woodDark, T(boxUV(base), 0, 0.17, 0)));
  // a tray with a vase
  k.push(rb(P.blackMetal, 0.36, 0.018, 0.22, 0.008, 0.2, 0.392, 0.02));
  k.push(part(P.ceramic, T(lathe(P.ceramic, [[0, 0], [0.045, 0.002], [0.06, 0.06], [0.04, 0.16], [0.022, 0.2], [0.025, 0.215], [0, 0.215]], 28), 0.24, 0.4, 0.02)));
  return k;
}

export function tvCabinet(P: Palette, w: number): Kit {
  const k: Kit = [];
  const h = 0.36, d = 0.42;
  k.push(rb(P.woodDark, w, h, d, 0.01, 0, 0.12 + h / 2, d / 2));
  // door seams (dark grooves) and a recessed plinth
  const n = Math.max(3, Math.round(w / 0.6));
  for (let i = 1; i < n; i++) k.push(bx(P.rubber, 0.004, h - 0.02, 0.002, -w / 2 + (w / n) * i, 0.12 + h / 2, d + 0.0005));
  k.push(bx(P.rubber, w - 0.1, 0.11, d - 0.06, 0, 0.055, d / 2 - 0.02));
  // books and a speaker on top
  k.push(rb(P.applianceDark, 0.9, 0.06, 0.1, 0.02, 0, 0.12 + h + 0.03, d * 0.55));
  for (let i = 0; i < 4; i++) k.push(bx(i % 2 ? P.book : P.trim, 0.24, 0.025, 0.17, w / 2 - 0.3, 0.12 + h + 0.0125 + i * 0.026, d / 2));
  return k;
}

/** the TV's frame (the screen itself is made apart: it lights up) */
export function tvFrame(P: Palette, w: number, h: number): Kit {
  return [rb(P.applianceDark, w + 0.012, h + 0.012, 0.028, 0.004, 0, 0, 0.014)];
}

export function standAircon(P: Palette,variant=0): Kit {
  if(variant===3)return [cy(P.appliance,.17,.17,1.76,0,.91,.18,40),cy(P.handle,.18,.18,.03,0,.025,.18,40),rb(P.applianceDark,.17,1.24,.012,.035,0,1.04,.351),rb(P.ledPanel,.045,.012,.004,.004,0,1.64,.361)];
  if(variant===2){
    const k:Kit=[rb(P.applianceDark,.36,1.82,.36,.035,0,.91,.18,4),rb(P.appliance,.25,1.38,.012,.016,0,1.04,.356)];
    for(let i=0;i<14;i++)k.push(rb(P.applianceDark,.23,.017,.008,.003,0,.43+i*.085,.365));
    return k;
  }
  const k: Kit = [rb(P.appliance, 0.36, 1.82, 0.36, 0.05, 0, 0.91, 0.18, 4)];
  // the round outlets of a 무풍 aircon (dark discs) and a small display
  for (const y of variant===1?[1.43,1.02]:[1.48, 1.2, 0.92]) { const c = new THREE.CircleGeometry(variant===1?.12:.105, 32); k.push(part(P.applianceDark, T(c, 0, y, 0.3605), false)); }
  k.push(rb(P.applianceDark, 0.07, 0.03, 0.006, 0.01, 0, 1.68, 0.362));
  return k;
}

export function floorLamp(P: Palette): Kit {
  return [
    cy(P.blackMetal, 0.15, 0.16, 0.02, 0, 0.01, 0, 32), cy(P.blackMetal, 0.011, 0.011, 1.45, 0, 0.74, 0, 12),
    part(P.lampShade, T(boxUV(new THREE.CylinderGeometry(0.17, 0.22, 0.3, 40, 1, true)), 0, 1.55, 0), false),
  ];
}

export function plant(P: Palette, h = 1.5, seed = 1): Kit {
  const k: Kit = [];
  k.push(part(P.pot, T(lathe(P.pot, [[0, 0], [0.16, 0], [0.2, 0.36], [0.205, 0.38], [0.18, 0.38], [0.18, 0.34], [0, 0.34]], 32), 0, 0, 0)));
  k.push(cy(P.soil, 0.18, 0.18, 0.01, 0, 0.34, 0, 24));
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  k.push(cy(P.woodDark, 0.012, 0.016, h - 0.5, 0, 0.34 + (h - 0.5) / 2, 0, 8));
  // broad leaves (여인초 / 떡갈고무나무): curved blades along the stems
  for (let i = 0; i < 16; i++) {
    const y = 0.75 + (h - 0.75) * (i / 16) + rnd() * 0.1, ang = rnd() * Math.PI * 2, len = 0.22 + rnd() * 0.16, wid = len * 0.55;
    const g = new THREE.PlaneGeometry(wid, len, 2, 4);
    const p = g.getAttribute("position");
    for (let j = 0; j < p.count; j++) { const x = p.getX(j), yy = p.getY(j); p.setZ(j, -Math.abs(x) * 0.6 + (yy / len) ** 2 * 0.15); p.setX(j, x * (1 - ((yy / len) + 0.5) ** 2 * 0.6)); }
    g.computeVertexNormals();
    g.translate(0, len / 2, 0); g.rotateX(-0.9 + rnd() * 0.5); g.rotateY(ang); g.translate(Math.cos(ang) * 0.04, y, -Math.sin(ang) * 0.04);
    k.push(part(P.plantLeaf, boxUV(g)));
  }
  return k;
}

/** a canvas painted once: soft abstract colour fields (the art over the sofa) */
export function artTexture(seed: number): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 640;
  const g = c.getContext("2d")!;
  let s = seed * 7919 + 13;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const pal = [["#e9e1d3", "#c9b79c", "#8c7b65", "#d9c8b0", "#3e3a35"], ["#e7e4df", "#9fb0b8", "#5d6f78", "#d4c9bb", "#2c3238"], ["#efe6dc", "#d8a48f", "#a3644e", "#e2cdb8", "#433128"]][seed % 3];
  g.fillStyle = pal[0]; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 9; i++) {
    g.globalAlpha = 0.35 + rnd() * 0.5; g.fillStyle = pal[1 + Math.floor(rnd() * 4)];
    g.beginPath();
    const x = rnd() * c.width, y = rnd() * c.height, r = 80 + rnd() * 260;
    g.ellipse(x, y, r, r * (0.4 + rnd() * 0.8), rnd() * Math.PI, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 0.08; for (let i = 0; i < 3000; i++) { g.fillStyle = rnd() > 0.5 ? "#000" : "#fff"; g.fillRect(rnd() * c.width, rnd() * c.height, 2, 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function artFrame(P: Palette, w: number, h: number, canvas: THREE.Material): Kit {
  const f = 0.025;
  return [
    bx(P.woodDark, w, f, 0.035, 0, h / 2 - f / 2, 0.0175), bx(P.woodDark, w, f, 0.035, 0, -h / 2 + f / 2, 0.0175),
    bx(P.woodDark, f, h, 0.035, -w / 2 + f / 2, 0, 0.0175), bx(P.woodDark, f, h, 0.035, w / 2 - f / 2, 0, 0.0175),
    part(canvas, T(new THREE.PlaneGeometry(w - 2 * f, h - 2 * f), 0, 0, 0.012)),
  ];
}

export function rug(P: Palette, w: number, d: number): Kit {
  return [rb(P.rug, w, 0.012, d, 0.005, 0, 0.006, 0, 2)];
}

// ------------------------------------------------------------------ bedrooms

export function bed(P: Palette, w: number, l: number): Kit {
  const k: Kit = [];
  k.push(rb(P.linen, w + 0.1, 0.3, l, 0.03, 0, 0.18, l / 2));                       // upholstered frame
  k.push(rb(P.linen, w + 0.16, 1.05, 0.1, 0.04, 0, 0.525, 0.05, 4));                // headboard
  for (let i = 0; i < Math.round(w / 0.3); i++) k.push(bx(P.linen, 0.006, 0.6, 0.004, -w / 2 + (w / Math.round(w / 0.3)) * i + 0.0, 0.66, 0.101));
  k.push(rb(P.fabricBed, w, 0.24, l - 0.12, 0.06, 0, 0.44, l / 2 + 0.04, 4));         // mattress
  // the duvet: a filled quilt over the mattress, its edges falling over the sides and the foot,
  // folded back at the top; soft creases
  const dl = l * 0.74;
  k.push(pf(P.fabricBed, puff(w + 0.12, 0.26, dl, { bulge: 0.12, pinch: 0.75, crease: 0.07, seed: 5, seg: 22 }), 0, 0.5, l - dl / 2 + 0.02));
  k.push(pf(P.fabricBed, puff(w + 0.1, 0.12, 0.3, { bulge: 0.3, pinch: 0.5, crease: 0.1, seed: 9 }), 0, 0.64, l - dl + 0.12));
  k.push(pf(P.drape, puff(w + 0.16, 0.05, 0.48, { bulge: 0.1, pinch: 0.85, crease: 0.05, seed: 2 }), 0, 0.645, l * 0.83));  // a runner across the foot
  const pw = w > 1.3 ? 0.66 : 0.62, n = w > 1.3 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : (i ? 1 : -1) * w / 4;
    const g = puff(pw, 0.17, 0.44, { bulge: 0.5, pinch: 0.15, crease: 0.08, seed: 11 + i }); g.rotateX(-0.45);
    k.push(pf(P.fabricBed, g, x, 0.69, 0.3));
  }
  return k;
}

export function nightstand(P: Palette): Kit {
  return [rb(P.woodLight, 0.48, 0.5, 0.4, 0.012, 0, 0.27, 0.2), bx(P.rubber, 0.44, 0.002, 0.003, 0, 0.32, 0.401), cy(P.blackMetal, 0.01, 0.01, 0.04, 0, 0.02, 0.2)];
}
export function tableLamp(P: Palette): Kit {
  return [
    part(P.ceramic, T(lathe(P.ceramic, [[0, 0], [0.07, 0], [0.09, 0.12], [0.05, 0.24], [0.015, 0.28], [0, 0.28]], 28), 0, 0, 0)),
    part(P.lampShade, T(boxUV(new THREE.CylinderGeometry(0.12, 0.15, 0.2, 36, 1, true)), 0, 0.37, 0), false),
  ];
}

export function wardrobe(P: Palette, w: number, h: number, d = 0.6): Kit {
  const k: Kit = [rb(P.cabinetUpper, w, h, d, 0.004, 0, h / 2, d / 2, 2)];
  const n = Math.max(2, Math.round(w / 0.5));
  for (let i = 1; i < n; i++) k.push(bx(P.rubber, 0.003, h - 0.02, 0.002, -w / 2 + (w / n) * i, h / 2, d + 0.0005));
  // recessed finger pulls (dark slots) at handle height
  for (let i = 0; i < n; i++) k.push(bx(P.rubber, 0.012, 0.25, 0.003, -w / 2 + (w / n) * (i + (i % 2 ? 0.08 : 0.92)), 1.1, d + 0.0012));
  return k;
}

export function desk(P: Palette, w: number): Kit {
  return [
    rb(P.woodLight, w, 0.03, 0.6, 0.006, 0, 0.735, 0.3),
    bx(P.blackMetal, 0.03, 0.72, 0.56, -w / 2 + 0.04, 0.36, 0.3), bx(P.blackMetal, 0.03, 0.72, 0.56, w / 2 - 0.04, 0.36, 0.3),
    ...tableLamp(P).map(p => ({ ...p, g: p.g.clone().scale(0.8, 0.8, 0.8).translate(w / 2 - 0.2, 0.75, 0.2) })),
  ];
}
export function chair(P: Palette): Kit {
  return [
    rb(P.linen, 0.46, 0.06, 0.44, 0.02, 0, 0.46, 0.24), rb(P.linen, 0.44, 0.38, 0.05, 0.02, 0, 0.72, 0.03, 3),
    ...[[-0.2, 0.06], [0.2, 0.06], [-0.2, 0.42], [0.2, 0.42]].map(([x, z]) => cy(P.woodDark, 0.014, 0.012, 0.44, x, 0.22, z, 10)),
  ];
}
export function bookshelf(P: Palette, w: number, h: number): Kit {
  const k: Kit = [];
  const d = 0.32, t = 0.02, shelves = Math.max(3, Math.round(h / 0.38));
  k.push(bx(P.woodLight, t, h, d, -w / 2 + t / 2, h / 2, d / 2), bx(P.woodLight, t, h, d, w / 2 - t / 2, h / 2, d / 2), bx(P.woodLight, w, h, 0.01, 0, h / 2, 0.005));
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let i = 0; i <= shelves; i++) {
    const y = (h - t) * (i / shelves) + t / 2;
    k.push(bx(P.woodLight, w - 2 * t, t, d, 0, y, d / 2));
    if (i === shelves) break;
    let x = -w / 2 + t + 0.02;
    while (x < w / 2 - 0.15) {
      const bw = 0.02 + rnd() * 0.035, bh = 0.2 + rnd() * 0.1;
      if (rnd() < 0.12) { x += 0.1; continue; }
      k.push(bx([P.book, P.trim, P.woodDark, P.linen][Math.floor(rnd() * 4)], bw, bh, 0.2 + rnd() * 0.05, x + bw / 2, y + t / 2 + bh / 2, d * 0.55));
      x += bw + 0.003;
    }
  }
  return k;
}
export function vanity(P: Palette): Kit {
  return [
    rb(P.cabinetUpper, 0.9, 0.04, 0.42, 0.01, 0, 0.74, 0.21), bx(P.cabinetUpper, 0.86, 0.14, 0.4, 0, 0.65, 0.2),
    ...[[-0.4, 0.05], [0.4, 0.05], [-0.4, 0.37], [0.4, 0.37]].map(([x, z]) => cy(P.blackMetal, 0.012, 0.01, 0.58, x, 0.29, z, 10)),
    rb(P.blackMetal, 0.64, 0.84, 0.018, 0.3, 0, 1.38, 0.009, 6), rb(P.blackMetal, 0.6, 0.8, 0.004, 0.28, 0, 1.38, 0.02, 6),
  ];
}

// ------------------------------------------------------------------ kitchen

/** a kitchen's door fronts: 0 handleless (a groove under the top), 1 long bar pulls, 2 shaker
 * (framed panels), 3 two-tone (the lower run in dark wood, slim black pulls) */
export type KitchenFront = 0 | 1 | 2 | 3;
export const KITCHEN_FRONTS = 4;
/** the fronts on a run of doors w wide, h tall from y0, at depth zf; `upper`: pulls at the bottom */
function fronts(P: Palette, k: Kit, w: number, y0: number, h: number, zf: number, front: KitchenFront, upper: boolean, door = 0.6) {
  const n = Math.max(1, Math.round(w / door)), dw = w / n;
  for (let i = 1; i < n; i++) k.push(bx(P.rubber, 0.003, h - 0.01, 0.002, -w / 2 + dw * i, y0 + h / 2, zf + 0.0005));
  for (let i = 0; i < n; i++) {
    const cx = -w / 2 + dw * (i + 0.5);
    if (front === 1) k.push(bx(P.chrome, Math.min(0.32, dw * 0.55), 0.014, 0.022, cx, upper ? y0 + 0.06 : y0 + h - 0.07, zf + 0.012));
    if (front === 3) k.push(bx(P.blackMetal, 0.012, Math.min(0.22, h * 0.4), 0.02, cx + (i % 2 ? -1 : 1) * (dw / 2 - 0.05), upper ? y0 + 0.14 : y0 + h - 0.16, zf + 0.011));
    if (front === 2) {
      // a raised frame round each door (a shaker front)
      const f = 0.055, t = 0.008, inner = h - 2 * f, m = upper ? P.cabinetUpper : P.cabinet;
      k.push(bx(m, dw - 0.012, f, t, cx, y0 + f / 2, zf + t / 2), bx(m, dw - 0.012, f, t, cx, y0 + h - f / 2, zf + t / 2));
      k.push(bx(m, f, inner, t, cx - dw / 2 + f / 2 + 0.006, y0 + h / 2, zf + t / 2), bx(m, f, inner, t, cx + dw / 2 - f / 2 - 0.006, y0 + h / 2, zf + t / 2));
      k.push(cy(P.handle, 0.012, 0.012, 0.025, cx + dw / 2 - 0.07, upper ? y0 + 0.08 : y0 + h - 0.09, zf + 0.02, 12));
    }
  }
}

export function lowerRun(P: Palette, w: number, opts: { sinkAt?: number; cookAt?: number; holeW?: number; front?: KitchenFront; double?: boolean } = {}): Kit {
  const k: Kit = [], h = 0.85, d = 0.6, top = opts.front === 3 ? 0.04 : 0.03, kick = 0.1, front = opts.front ?? 0;
  k.push(bx(P.rubber, w, kick, d - 0.06, 0, kick / 2, (d - 0.06) / 2));
  k.push(bx(front === 3 ? P.woodDark : P.cabinet, w, h - top - kick, d - 0.02, 0, kick + (h - top - kick) / 2, (d - 0.02) / 2));
  fronts(P, k, w, kick + 0.005, h - top - kick - 0.01, d - 0.02, front, false);
  // a handleless groove under the top
  if (front === 0) k.push(bx(P.steel, w, 0.03, 0.004, 0, h - top - 0.035, d - 0.018));
  // the counter top, with holes for the sink
  const y = h - top / 2;
  if (opts.sinkAt !== undefined) {
    const hw = opts.holeW ?? 0.78, a = opts.sinkAt - hw / 2, b = opts.sinkAt + hw / 2, front = 0.06, back = 0.12;
    if (a > -w / 2) k.push(bx(P.counter, a + w / 2, top, d + 0.02, (-w / 2 + a) / 2, y, (d + 0.02) / 2));
    if (b < w / 2) k.push(bx(P.counter, w / 2 - b, top, d + 0.02, (b + w / 2) / 2, y, (d + 0.02) / 2));
    k.push(bx(P.counter, hw, top, back, opts.sinkAt, y, back / 2), bx(P.counter, hw, top, front, opts.sinkAt, y, d + 0.02 - front / 2));
    // the bowl: stainless, square with rounded corners, open at the top
    const bw = hw, bd = d + 0.02 - front - back, depth = 0.22, cx = opts.sinkAt, cz = back + bd / 2, yt = h - top;
    k.push(bx(P.steel, bw, 0.004, bd, cx, yt - depth, cz));
    k.push(part(P.steel, T(new THREE.PlaneGeometry(bw, depth), cx, yt - depth / 2, back + 0.001)), part(P.steel, T(new THREE.PlaneGeometry(bw, depth).rotateY(Math.PI), cx, yt - depth / 2, back + bd - 0.001)));
    k.push(part(P.steel, T(new THREE.PlaneGeometry(bd, depth).rotateY(Math.PI / 2), cx - bw / 2 + 0.001, yt - depth / 2, cz)), part(P.steel, T(new THREE.PlaneGeometry(bd, depth).rotateY(-Math.PI / 2), cx + bw / 2 - 0.001, yt - depth / 2, cz)));
    k.push(cy(P.chrome, 0.045, 0.045, 0.006, cx + bw * 0.25, yt - depth + 0.004, cz, 24));
    // a double bowl: a divider across, its second drain
    if (opts.double) { k.push(bx(P.steel, 0.02, depth - 0.04, bd, cx + bw * 0.08, yt - depth / 2 - 0.02, cz), cy(P.chrome, 0.04, 0.04, 0.006, cx - bw * 0.25, yt - depth + 0.004, cz, 24)); }
  } else k.push(bx(P.counter, w, top, d + 0.02, 0, y, (d + 0.02) / 2));
  if (opts.cookAt !== undefined) {
    k.push(rb(P.applianceDark, 0.58, 0.008, 0.5, 0.004, opts.cookAt, h + 0.004, 0.31));
  }
  return k;
}

export function upperRun(P: Palette, w: number, bottom: number, top: number, d = 0.35, front: KitchenFront = 0): Kit {
  const k: Kit = [], h = top - bottom;
  k.push(bx(P.cabinetUpper, w, h, d, 0, bottom + h / 2, d / 2));
  fronts(P, k, w, bottom + 0.005, h - 0.01, d, front, true, 0.45);
  return k;
}

/** a 키큰장: a full-height column beside the counter — a built-in oven and a steam oven in it
 * (`oven`), or a pantry of tall doors */
export function tallUnit(P: Palette, w: number, h: number, oven: boolean, front: KitchenFront = 0): Kit {
  const k: Kit = [], d = 0.6;
  k.push(bx(P.rubber, w, 0.1, d - 0.06, 0, 0.05, (d - 0.06) / 2));
  k.push(bx(front === 3 ? P.woodDark : P.cabinet, w, h - 0.1, d - 0.02, 0, 0.1 + (h - 0.1) / 2, (d - 0.02) / 2));
  if (oven) {
    // two appliances stacked at eye height, in black glass with a steel bar
    for (const [y, hh] of [[0.92, 0.58], [1.54, 0.44]] as [number, number][]) {
      k.push(rb(P.applianceDark, w - 0.04, hh, 0.02, 0.004, 0, y + hh / 2, d - 0.01, 2));
      k.push(bx(P.steel, w - 0.16, 0.018, 0.025, 0, y + hh - 0.06, d + 0.012));
      k.push(bx(P.screen, 0.16, 0.035, 0.002, 0, y + hh - 0.03, d + 0.001));
    }
    fronts(P, k, w, 0.105, 0.8, d - 0.02, front, false, w);
    if (h > 2.1) fronts(P, k, w, 2.0, h - 2.005, d - 0.02, front, true, w);
  } else fronts(P, k, w, 0.105, h - 0.11, d - 0.02, front, false, w / 2);
  return k;
}

export function hood(P: Palette, w: number, bottom: number, top: number): Kit {
  return [bx(P.cabinetUpper, w, top - bottom - 0.1, 0.38, 0, bottom + 0.1 + (top - bottom - 0.1) / 2, 0.19), bx(P.steel, w, 0.1, 0.4, 0, bottom + 0.05, 0.2), bx(P.rubber, w - 0.06, 0.002, 0.3, 0, bottom - 0.001, 0.2)];
}

export function fridge(P: Palette, w: number, h: number): Kit {
  // a 4-door built-in fridge in panel colours (the Korean "bespoke" look)
  const k: Kit = [];
  const d = 0.72, gap = 0.006;
  k.push(bx(P.rubber, w, h, d - 0.04, 0, h / 2, (d - 0.04) / 2));
  const panelM = P.appliance;
  const doors: [number, number, number, number][] = [[-w / 4, h * 0.62, w / 2 - gap, h * 0.76], [w / 4, h * 0.62, w / 2 - gap, h * 0.76], [-w / 4, h * 0.12, w / 2 - gap, h * 0.235], [w / 4, h * 0.12, w / 2 - gap, h * 0.235]];
  for (const [x, y, ww, hh] of doors) k.push(rb(panelM, ww, hh, 0.04, 0.006, x, y + 0.01, d - 0.02, 2));
  return k;
}

/** a standing 김치냉장고: a top door and two drawers, in the fridge's panel colour */
export function kimchiFridge(P: Palette, w: number, h: number): Kit {
  const d = 0.72, k: Kit = [bx(P.rubber, w, h, d - 0.04, 0, h / 2, (d - 0.04) / 2)];
  const cuts = [0, h * 0.34, h * 0.6, h];
  for (let i = 0; i < 3; i++) k.push(rb(P.appliance, w - 0.006, cuts[i + 1] - cuts[i] - 0.008, 0.04, 0.006, 0, (cuts[i] + cuts[i + 1]) / 2, d - 0.02, 2));
  k.push(rb(P.applianceDark, 0.12, 0.03, 0.006, 0.004, 0, h * 0.92, d + 0.001));
  return k;
}

export function diningTable(P: Palette, w: number, d: number): Kit {
  return [
    rb(P.woodDark, w, 0.035, d, 0.012, 0, 0.735, 0),
    bx(P.blackMetal, 0.06, 0.7, d * 0.7, -w / 2 + 0.22, 0.36, 0), bx(P.blackMetal, 0.06, 0.7, d * 0.7, w / 2 - 0.22, 0.36, 0),
    bx(P.blackMetal, w - 0.5, 0.04, 0.05, 0, 0.12, 0),
    part(P.ceramic, T(lathe(P.ceramic, [[0, 0], [0.11, 0], [0.13, 0.03], [0.14, 0.06], [0, 0.06]], 32), 0.15, 0.753, 0)),
  ];
}
export function pendant(P: Palette, drop: number): Kit {
  return [cy(P.blackMetal, 0.002, 0.002, drop, 0, -drop / 2, 0, 6), part(P.lampShade, T(boxUV(new THREE.SphereGeometry(0.085, 32, 16)), 0, -drop - 0.06, 0), false)];
}

// ------------------------------------------------------------------ bathroom

export function toilet(P: Palette): Kit {
  const k: Kit = [];
  // a one-piece toilet: a pedestal narrowing to the floor, flaring to an elongated bowl
  const ped = lathe(P.ceramic, [[0, 0], [0.105, 0], [0.11, 0.015], [0.1, 0.06], [0.1, 0.16], [0.13, 0.26], [0.168, 0.33], [0.186, 0.375], [0.188, 0.392], [0.176, 0.4], [0.15, 0.398], [0.1, 0.33], [0.06, 0.26], [0, 0.25]], 48);
  ped.scale(1, 1, 1.38); ped.translate(0, 0, 0.43);
  k.push(part(P.ceramic, ped));
  // the trapway's cover between bowl and tank
  k.push(rb(P.ceramic, 0.26, 0.34, 0.24, 0.07, 0, 0.2, 0.2, 4));
  const tank = rb(P.ceramic, 0.4, 0.38, 0.19, 0.04, 0, 0.6, 0.1, 4); k.push(tank);
  k.push(rb(P.ceramic, 0.42, 0.03, 0.21, 0.015, 0, 0.805, 0.1));
  k.push(cy(P.chrome, 0.025, 0.025, 0.01, 0, 0.823, 0.1));
  // the seat (a flattened ring) and the lid raised against the tank
  const seat = new THREE.TorusGeometry(0.15, 0.03, 12, 40); seat.rotateX(Math.PI / 2); seat.scale(1, 0.45, 1.3);
  k.push(part(P.plastic, T(boxUV(seat), 0, 0.405, 0.43)));
  const lid = rb(P.plastic, 0.38, 0.45, 0.025, 0.08, 0, 0.64, 0.21, 4); lid.g.rotateX(-0.12); lid.g.translate(0, 0.02, 0.07); k.push(lid);
  return k;
}

export function washbasinVanity(P: Palette, w: number): Kit {
  const k: Kit = [];
  k.push(rb(P.cabinet, w, 0.45, 0.46, 0.01, 0, 0.6, 0.23));         // wall-hung cabinet
  k.push(bx(P.rubber, w - 0.02, 0.003, 0.002, 0, 0.62, 0.461));
  k.push(rb(P.counter, w, 0.03, 0.48, 0.006, 0, 0.84, 0.24));
  const basin = lathe(P.ceramic, [[0, 0.0], [0.15, 0.0], [0.2, 0.05], [0.215, 0.12], [0.21, 0.13], [0.19, 0.125], [0.17, 0.06], [0.0, 0.03]], 40);
  basin.scale(1.25, 1, 0.92); basin.translate(0, 0.855, 0.27);
  k.push(part(P.ceramic, basin));
  return k;
}

export function mirrorCabinet(P: Palette, w: number): Kit {
  return [bx(P.cabinetUpper, w, 0.75, 0.14, 0, 0, 0.07), bx(P.ledPanel, w - 0.04, 0.012, 0.004, 0, -0.38, 0.12)];
}

export function bathtub(P: Palette, l: number, wd: number): Kit {
  // built in: a tiled skirt, a ceramic basin open at the top (its inner faces), a deck round it
  const k: Kit = [], h = 0.55, rim = 0.07, depth = 0.42;
  // the tiled skirt round it (front and ends) and the block under the basin, below its floor
  k.push(bx(P.wallWet, rim, h - 0.03, l, wd - rim / 2, (h - 0.03) / 2, l / 2));
  k.push(bx(P.wallWet, wd, h - 0.03, rim, wd / 2, (h - 0.03) / 2, rim / 2), bx(P.wallWet, wd, h - 0.03, rim, wd / 2, (h - 0.03) / 2, l - rim / 2));
  k.push(bx(P.wallWet, wd, h - depth - 0.04, l, wd / 2, (h - depth - 0.04) / 2, l / 2));
  const yt = h, X0 = rim, X1 = wd - rim, Z0 = rim, Z1 = l - rim;
  k.push(bx(P.ceramic, wd, 0.03, rim, wd / 2, yt - 0.015, rim / 2), bx(P.ceramic, wd, 0.03, rim, wd / 2, yt - 0.015, l - rim / 2));
  k.push(bx(P.ceramic, rim, 0.03, l - 2 * rim, rim / 2, yt - 0.015, l / 2), bx(P.ceramic, rim, 0.03, l - 2 * rim, wd - rim / 2, yt - 0.015, l / 2));
  const yb = yt - depth, inset = 0.06;
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([a, b, c, a, c, d].flatMap(v => [v.x, v.y, v.z]), 3));
    g.computeVertexNormals();
    return boxUV(g);
  };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  k.push(part(P.ceramic, quad(V(X0 + inset, yb, Z0 + inset), V(X0 + inset, yb, Z1 - inset), V(X1 - inset, yb, Z1 - inset), V(X1 - inset, yb, Z0 + inset))));
  k.push(part(P.ceramic, quad(V(X0, yt - 0.03, Z0), V(X1, yt - 0.03, Z0), V(X1 - inset, yb, Z0 + inset), V(X0 + inset, yb, Z0 + inset))));
  k.push(part(P.ceramic, quad(V(X1, yt - 0.03, Z1), V(X0, yt - 0.03, Z1), V(X0 + inset, yb, Z1 - inset), V(X1 - inset, yb, Z1 - inset))));
  k.push(part(P.ceramic, quad(V(X0, yt - 0.03, Z1), V(X0, yt - 0.03, Z0), V(X0 + inset, yb, Z0 + inset), V(X0 + inset, yb, Z1 - inset))));
  k.push(part(P.ceramic, quad(V(X1, yt - 0.03, Z0), V(X1, yt - 0.03, Z1), V(X1 - inset, yb, Z1 - inset), V(X1 - inset, yb, Z0 + inset))));
  k.push(cy(P.chrome, 0.025, 0.025, 0.005, wd / 2, yb + 0.003, l - rim - 0.14, 20));
  return k;
}

export function showerSet(P: Palette, wallH: number): Kit {
  // a rain shower column against the wall: bar, overhead arm and head, hand shower, mixer
  return [
    cy(P.chrome, 0.012, 0.012, 1.1, 0, 1.05 + 0.55, 0.05, 16),
    bx(P.chrome, 0.02, 0.02, 0.32, 0, 2.15, 0.16), cy(P.chrome, 0.13, 0.13, 0.012, 0, 2.13, 0.3, 40),
    rb(P.chrome, 0.22, 0.06, 0.07, 0.025, 0, 1.0, 0.045, 3),
    cy(P.chrome, 0.018, 0.012, 0.22, 0.08, 1.35, 0.06, 16),
  ].map(p => ({ ...p, g: p.g.translate(0, Math.min(0, wallH - 2.25), 0) }));
}

export function towelRail(P: Palette): Kit {
  const k: Kit = [];
  for (const y of [0, 0.16, 0.32]) k.push(part(P.chrome, boxUV(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 12).rotateZ(Math.PI / 2)).translate(0, y, 0.06)));
  k.push(bx(P.chrome, 0.012, 0.36, 0.06, -0.25, 0.16, 0.03), bx(P.chrome, 0.012, 0.36, 0.06, 0.25, 0.16, 0.03));
  k.push(rb(P.fabricBed, 0.42, 0.5, 0.03, 0.012, 0, 0.0, 0.075, 3));
  return k;
}

// ------------------------------------------------------------------ entrance, utility, dressroom

export function shoeCabinet(P: Palette, w: number, h: number): Kit {
  const k: Kit = [];
  const d = 0.38, nicheY = 0.95, nicheH = 0.3;
  k.push(bx(P.cabinetUpper, w, nicheY - 0.12, d, 0, 0.12 + (nicheY - 0.12) / 2, d / 2));
  k.push(bx(P.cabinetUpper, w, h - nicheY - nicheH, d, 0, nicheY + nicheH + (h - nicheY - nicheH) / 2, d / 2));
  k.push(bx(P.woodDark, w, 0.02, d, 0, nicheY + 0.01, d / 2), bx(P.woodDark, w, nicheH, 0.01, 0, nicheY + nicheH / 2, 0.005));
  k.push(bx(P.ledWarm, w - 0.04, 0.008, 0.01, 0, nicheY + nicheH - 0.006, d - 0.04));
  const n = Math.max(2, Math.round(w / 0.45));
  for (let i = 1; i < n; i++) for (const [y0, y1] of [[0.12, nicheY], [nicheY + nicheH, h]]) k.push(bx(P.rubber, 0.003, y1 - y0 - 0.01, 0.002, -w / 2 + (w / n) * i, (y0 + y1) / 2, d + 0.0005));
  k.push(bx(P.rubber, w, 0.12, d - 0.05, 0, 0.06, (d - 0.05) / 2));
  return k;
}

export function washerDryer(P: Palette): Kit {
  const k: Kit = [];
  for (const [y, hh] of [[0, 0.85], [0.86, 0.85]] as [number, number][]) {
    k.push(rb(P.appliance, 0.6, hh, 0.66, 0.02, 0, y + hh / 2, 0.33, 2));
    const ring = new THREE.TorusGeometry(0.19, 0.03, 12, 48); k.push(part(P.steel, T(boxUV(ring), 0, y + hh * 0.48, 0.665)));
    k.push(part(P.applianceDark, T(new THREE.CircleGeometry(0.17, 40), 0, y + hh * 0.48, 0.667)));
    k.push(rb(P.applianceDark, 0.5, 0.08, 0.01, 0.01, 0, y + hh - 0.08, 0.662));
  }
  return k;
}

export function boiler(P: Palette): Kit {
  return [rb(P.appliance, 0.44, 0.62, 0.26, 0.02, 0, 1.55, 0.13, 2), rb(P.applianceDark, 0.12, 0.06, 0.006, 0.005, 0, 1.5, 0.262), ...[-0.1, -0.03, 0.04, 0.11].map(x => cy(P.steel, 0.012, 0.012, 0.3, x, 1.09, 0.1, 10))];
}

export function closetSystem(P: Palette, w: number, h: number, colours: THREE.Material[]): Kit {
  const k: Kit = [];
  const d = 0.5;
  const n = Math.max(1, Math.round(w / 0.9));
  for (let i = 0; i <= n; i++) k.push(bx(P.blackMetal, 0.025, h, 0.025, -w / 2 + (w / n) * i, h / 2, d - 0.05));
  k.push(bx(P.woodLight, w, 0.025, d, 0, h - 0.35, d / 2), bx(P.woodLight, w, 0.025, d, 0, 0.45, d / 2));
  k.push(part(P.chrome, boxUV(new THREE.CylinderGeometry(0.012, 0.012, w - 0.06, 12).rotateZ(Math.PI / 2)).translate(0, h - 0.42, d / 2)));
  // hanging clothes in a few colours, and folded stacks on the shelf
  let s = 3;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let x = -w / 2 + 0.06; x < w / 2 - 0.06; x += 0.045 + rnd() * 0.03) {
    const len = 0.6 + rnd() * 0.5;
    k.push(rb(colours[Math.floor(rnd() * colours.length)], 0.035, len, 0.42, 0.015, x, h - 0.45 - len / 2, d / 2, 2));
  }
  for (let x = -w / 2 + 0.2; x < w / 2 - 0.2; x += 0.42) k.push(rb(colours[Math.floor(rnd() * colours.length)], 0.32, 0.14, 0.3, 0.02, x, 0.53, d / 2, 2));
  return k;
}

/** taps: 12 shapes. Each built on a deck at y (its base at z0, the wall side) and reaching out to
 * its spout; returns the kit and the spout's mouth (where the water leaves), both in the same frame. */
export const FAUCET_KINDS = 12;
export function faucetKit(P: Palette, kind: number, finish: THREE.Material, y: number, z0: number, scale = 1): { kit: Kit; spout: [number, number, number] } {
  const k: Kit = [], s = scale, M = finish; void P;
  const col = (r0: number, r1: number, h: number, x = 0, z = z0) => k.push({ m: M, g: boxUV(new THREE.CylinderGeometry(r0 * s, r1 * s, h * s, 20)).translate(x, y + (h * s) / 2, z) });
  const box = (w: number, h: number, d: number, x: number, yy: number, z: number) => k.push({ m: M, g: boxUV(new THREE.BoxGeometry(w * s, h * s, d * s)).translate(x, yy, z) });
  const arc = (R: number, r: number, top: number, zc: number, sweep = Math.PI) => { const g = new THREE.TorusGeometry(R * s, r * s, 12, 32, sweep); g.rotateY(Math.PI / 2); k.push({ m: M, g: boxUV(g).translate(0, top, zc) }); };
  const lever = (h: number, side = 0) => k.push({ m: M, g: boxUV(new THREE.CylinderGeometry(0.006 * s, 0.006 * s, 0.08 * s, 10).rotateZ(side ? 0 : Math.PI / 2).rotateX(side ? 0 : -0.5)).translate(side ? 0.04 * s * side : 0.03 * s, y + h * s, z0 + (side ? 0 : -0.01)) });
  let mouth: [number, number, number];
  switch (((kind % FAUCET_KINDS) + FAUCET_KINDS) % FAUCET_KINDS) {
    case 0: { col(0.014, 0.022, 0.33); arc(0.11, 0.011, y + 0.33 * s, z0 + 0.11 * s); lever(0.1); mouth = [0, y + 0.33 * s - 0.012, z0 + 0.22 * s]; break; } // gooseneck
    case 1: { col(0.018, 0.026, 0.42); arc(0.13, 0.013, y + 0.42 * s, z0 + 0.13 * s); col(0.016, 0.016, 0.09, 0, z0 + 0.26 * s); k[k.length - 1].g.translate(0, 0.3 * s, 0); lever(0.14, 1); mouth = [0, y + 0.3 * s - 0.01, z0 + 0.26 * s]; break; } // high-arc pull-down
    case 2: { box(0.035, 0.3, 0.035, 0, y + 0.15 * s, z0); box(0.03, 0.03, 0.22, 0, y + 0.3 * s, z0 + 0.11 * s); box(0.03, 0.05, 0.03, 0, y + 0.27 * s, z0 + 0.21 * s); box(0.06, 0.012, 0.02, 0.03 * s, y + 0.2 * s, z0); mouth = [0, y + 0.245 * s, z0 + 0.21 * s]; break; } // L square
    case 3: { col(0.02, 0.024, 0.14); arc(0.07, 0.012, y + 0.14 * s, z0 + 0.07 * s); lever(0.1); mouth = [0, y + 0.14 * s - 0.012, z0 + 0.14 * s]; break; } // low arc
    case 4: { col(0.02, 0.028, 0.12); for (let i = 0; i < 9; i++) { const g = new THREE.TorusGeometry(0.028 * s, 0.004 * s, 6, 20).rotateX(Math.PI / 2); k.push({ m: M, g: g.translate(0, y + (0.13 + i * 0.03) * s, z0) }); } col(0.008, 0.008, 0.42); box(0.012, 0.012, 0.24, 0, y + 0.42 * s, z0 + 0.12 * s); col(0.016, 0.014, 0.08, 0, z0 + 0.24 * s); k[k.length - 1].g.translate(0, 0.3 * s, 0); mouth = [0, y + 0.3 * s - 0.005, z0 + 0.24 * s]; break; } // pro spring
    case 5: { box(0.24, 0.022, 0.022, 0, y + 0.06 * s, z0); for (const x of [-0.1, 0.1]) { col(0.012, 0.016, 0.06, x * s); box(0.06, 0.008, 0.008, x * s, y + 0.1 * s, z0); box(0.008, 0.008, 0.06, x * s, y + 0.1 * s, z0); } col(0.012, 0.014, 0.25); arc(0.09, 0.011, y + 0.25 * s, z0 + 0.09 * s); mouth = [0, y + 0.25 * s - 0.012, z0 + 0.18 * s]; break; } // bridge, two cross handles
    case 6: { col(0.022, 0.025, 0.24); lever(0.2, 1); k.push({ m: M, g: boxUV(new THREE.CylinderGeometry(0.011 * s, 0.013 * s, 0.2 * s, 14)).rotateX(Math.PI / 2 - 0.35).translate(0, y + 0.22 * s, z0 + 0.09 * s) }); mouth = [0, y + 0.185 * s, z0 + 0.185 * s]; break; } // side lever, angled spout
    case 7: { box(0.05, 0.36, 0.05, 0, y + 0.18 * s, z0); box(0.07, 0.012, 0.16, 0, y + 0.355 * s, z0 + 0.1 * s); box(0.012, 0.06, 0.03, 0.035 * s, y + 0.3 * s, z0); mouth = [0, y + 0.345 * s, z0 + 0.17 * s]; break; } // pillar, waterfall
    case 8: { col(0.024, 0.024, 0.2); k.push({ m: M, g: boxUV(new THREE.CylinderGeometry(0.012 * s, 0.012 * s, 0.13 * s, 14)).rotateX(Math.PI / 2).translate(0, y + 0.18 * s, z0 + 0.075 * s) }); box(0.012, 0.05, 0.012, 0, y + 0.225 * s, z0 - 0.005); mouth = [0, y + 0.17 * s, z0 + 0.14 * s]; break; } // minimal cylinder, joystick
    case 9: { col(0.016, 0.03, 0.08); col(0.012, 0.012, 0.2); arc(0.08, 0.012, y + 0.2 * s, z0 + 0.08 * s); for (const x of [-0.07, 0.07]) { col(0.01, 0.018, 0.05, x * s, z0 - 0.02); box(0.05, 0.008, 0.008, x * s, y + 0.06 * s, z0 - 0.02); box(0.008, 0.008, 0.05, x * s, y + 0.06 * s, z0 - 0.02); } mouth = [0, y + 0.2 * s - 0.012, z0 + 0.16 * s]; break; } // classic cross handles
    case 10: { col(0.013, 0.02, 0.22); arc(0.06, 0.012, y + 0.22 * s, z0 + 0.06 * s); k.push({ m: M, g: boxUV(new THREE.CylinderGeometry(0.012 * s, 0.012 * s, 0.006, 16)).translate(0, y + 0.12 * s, z0 + 0.012 * s) }); mouth = [0, y + 0.22 * s - 0.012, z0 + 0.12 * s]; break; } // sensor, no handle
    default: { col(0.018, 0.022, 0.18); k.push({ m: M, g: boxUV(new THREE.CylinderGeometry(0.01 * s, 0.01 * s, 0.24 * s, 14)).rotateX(Math.PI / 4).translate(0, y + 0.26 * s, z0 + 0.085 * s) }); lever(0.12); mouth = [0, y + 0.34 * s - 0.03, z0 + 0.17 * s]; break; } // swivel tube
  }
  return { kit: k, spout: mouth };
}
