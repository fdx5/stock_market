import * as THREE from "three";
import { boxUV } from "./geom";
import type { Palette } from "./materials";
import { bx, cy, rb, type Kit, type Part } from "./models";

/* The fittings of buildings other than flats, modelled in code at their real sizes (a 1400 × 700
 * office desk, a 1900 × 650 treatment couch, a hospital bed with its side rails, 900 mm gondola
 * shelving, restroom cubicles of 900 × 1500, 1100 mm lift doors…). The same convention as models.ts:
 * origin at the floor, the back against the wall at z = 0, facing +z, centred on x — free-standing
 * pieces centred on the origin. */

export interface Extra {
  accent: THREE.Material; accentDark: THREE.Material; seat: THREE.Material; mesh: THREE.Material; vinyl: THREE.Material;
  laminate: THREE.Material; partition: THREE.Material; whiteboard: THREE.Material; monitor: THREE.Material; sign: THREE.Material;
  products: THREE.Material[]; carPaint: THREE.Material[]; paintWhite: THREE.Material; paintYellow: THREE.Material; concrete: THREE.Material;
  sheetGreen: THREE.Material; curtain: THREE.Material; mat: THREE.Material; mirrorWall: THREE.Material; hazard: THREE.Material; tail: THREE.Material;
}

const part = (m: THREE.Material, g: THREE.BufferGeometry, cast = true): Part => ({ m, g, cast });
const T = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);
/** a kit moved and turned (about y) in its own frame */
export function moved(k: Kit, x: number, z: number, yaw = 0, y = 0): Kit {
  const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
  for (const p of k) p.g.applyMatrix4(m);
  return k;
}

// ------------------------------------------------------------------ seats

/** an office task chair: a five-star base on casters, a gas lift, a mesh back — centred, facing +z */
export function taskChair(P: Palette, X: Extra): Kit {
  const k: Kit = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2, g = boxUV(new THREE.BoxGeometry(0.035, 0.03, 0.3));
    g.translate(0, 0.07, 0.15); g.rotateY(a); k.push(part(P.blackMetal, g));
    k.push(cy(P.rubber, 0.025, 0.025, 0.04, Math.sin(a) * 0.3, 0.025, Math.cos(a) * 0.3, 10));
  }
  k.push(cy(P.chrome, 0.022, 0.022, 0.3, 0, 0.24, 0, 12));
  k.push(rb(X.seat, 0.5, 0.08, 0.48, 0.03, 0, 0.46, 0.02));
  k.push(rb(P.blackMetal, 0.46, 0.56, 0.03, 0.04, 0, 0.82, -0.23), rb(X.mesh, 0.42, 0.5, 0.02, 0.03, 0, 0.82, -0.215));
  for (const s of [-1, 1]) k.push(bx(P.blackMetal, 0.03, 0.2, 0.03, s * 0.25, 0.56, 0.0), rb(P.rubber, 0.06, 0.025, 0.26, 0.01, s * 0.25, 0.67, 0.02));
  return k;
}
/** a stacking chair (classrooms, waiting rooms): a chrome frame, a moulded shell */
export function stackChair(P: Palette, X: Extra): Kit {
  const k: Kit = [];
  for (const [x, z] of [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.18], [0.2, 0.18]]) k.push(cy(P.chrome, 0.01, 0.01, 0.45, x, 0.225, z, 8));
  k.push(rb(X.seat, 0.46, 0.04, 0.44, 0.02, 0, 0.465, 0), rb(X.seat, 0.44, 0.34, 0.03, 0.03, 0, 0.7, -0.21));
  return k;
}
/** linked waiting-room seats on a beam: n seats, 0.56 m each */
export function beamSeats(P: Palette, X: Extra, n: number): Kit {
  const w = n * 0.56, k: Kit = [bx(P.steel, w, 0.05, 0.06, 0, 0.32, 0)];
  for (const s of [-1, 1]) k.push(bx(P.steel, 0.05, 0.32, 0.05, s * (w / 2 - 0.2), 0.16, 0), bx(P.steel, 0.06, 0.02, 0.5, s * (w / 2 - 0.2), 0.01, 0));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.28 + i * 0.56;
    k.push(rb(X.seat, 0.5, 0.07, 0.46, 0.03, x, 0.43, 0.02), rb(X.seat, 0.5, 0.42, 0.06, 0.03, x, 0.72, -0.21));
    if (i < n - 1) k.push(rb(P.blackMetal, 0.05, 0.03, 0.36, 0.01, x + 0.28, 0.62, 0.0), bx(P.steel, 0.02, 0.18, 0.02, x + 0.28, 0.52, 0.12));
  }
  return k;
}
/** a lounge bench in a gallery or a lobby: upholstered top on a plinth */
export function bench(P: Palette, X: Extra, w: number): Kit {
  return [rb(P.woodDark, w, 0.36, 0.42, 0.01, 0, 0.18, 0), rb(X.seat, w - 0.04, 0.08, 0.4, 0.03, 0, 0.4, 0)];
}

// ------------------------------------------------------------------ desks and tables

/** an office desk: a 25 mm top on a steel frame, a modesty panel, a monitor on an arm, a keyboard */
export function officeDesk(P: Palette, X: Extra, w = 1.4, d = 0.7, monitors = 1): Kit {
  const k: Kit = [rb(X.laminate, w, 0.025, d, 0.004, 0, 0.725, d / 2)];
  for (const s of [-1, 1]) k.push(bx(P.blackMetal, 0.05, 0.71, 0.05, s * (w / 2 - 0.05), 0.355, 0.08), bx(P.blackMetal, 0.05, 0.71, 0.05, s * (w / 2 - 0.05), 0.355, d - 0.08), bx(P.blackMetal, 0.05, 0.03, d - 0.1, s * (w / 2 - 0.05), 0.04, d / 2));
  k.push(bx(P.blackMetal, w - 0.1, 0.3, 0.015, 0, 0.5, 0.06));
  for (let i = 0; i < monitors; i++) {
    const x = monitors === 1 ? 0 : (i - (monitors - 1) / 2) * 0.58;
    k.push(bx(P.blackMetal, 0.2, 0.012, 0.16, x, 0.744, 0.16), bx(P.blackMetal, 0.03, 0.3, 0.03, x, 0.89, 0.13));
    k.push(rb(P.applianceDark, 0.56, 0.34, 0.03, 0.006, x, 1.08, 0.16), part(X.monitor, T(new THREE.PlaneGeometry(0.535, 0.31), x, 1.08, 0.1765), false));
  }
  k.push(rb(P.plastic, 0.44, 0.018, 0.14, 0.006, -0.05, 0.747, 0.42), rb(P.plastic, 0.06, 0.02, 0.1, 0.006, 0.28, 0.748, 0.43));
  k.push(rb(P.applianceDark, 0.2, 0.08, 0.06, 0.01, w / 2 - 0.2, 0.778, 0.12));    // (a phone)
  k.push(rb(P.cabinet, 0.4, 0.58, 0.55, 0.008, w / 2 - 0.26, 0.31, 0.32));           // the drawer pedestal
  return k;
}
/** a bench of desks for a team: two rows facing over a screen, n a row — centred on its spine */
export function deskPod(P: Palette, X: Extra, n: number): Kit {
  const k: Kit = [];
  for (let i = 0; i < n; i++) for (const s of [-1, 1]) {
    const x = (i - (n - 1) / 2) * 1.4;
    k.push(...moved(officeDesk(P, X, 1.38, 0.7, 1), x, s * 0.02, s > 0 ? 0 : Math.PI));
  }
  k.push(rb(X.accent, n * 1.4, 0.38, 0.03, 0.01, 0, 0.93, 0));   // the screen between the rows
  return k;
}
/** a meeting table with rounded ends (centred) */
export function meetingTable(P: Palette, w: number, d: number): Kit {
  return [
    rb(P.woodDark, w, 0.04, d, Math.min(0.3, d / 2 - 0.01), 0, 0.73, 0, 6),
    bx(P.blackMetal, 0.08, 0.7, d * 0.5, -w / 2 + d * 0.5, 0.36, 0), bx(P.blackMetal, 0.08, 0.7, d * 0.5, w / 2 - d * 0.5, 0.36, 0),
    bx(P.blackMetal, w - d, 0.05, 0.06, 0, 0.1, 0), rb(P.applianceDark, 0.3, 0.02, 0.1, 0.01, 0, 0.76, 0),
  ];
}
/** a small round table (a café's) */
export function cafeTable(P: Palette, r = 0.35): Kit {
  return [cy(P.woodLight, r, r, 0.03, 0, 0.735, 0, 36), cy(P.blackMetal, 0.025, 0.025, 0.7, 0, 0.36, 0, 12), cy(P.blackMetal, 0.22, 0.24, 0.02, 0, 0.01, 0, 28)];
}
/** a classroom desk with its chair behind (centred, the pupil facing +z) */
export function schoolDesk(P: Palette, X: Extra): Kit {
  const k: Kit = [rb(X.laminate, 0.6, 0.025, 0.45, 0.004, 0, 0.72, 0.1)];
  for (const [x, z] of [[-0.27, -0.08], [0.27, -0.08], [-0.27, 0.28], [0.27, 0.28]]) k.push(cy(P.steel, 0.012, 0.012, 0.71, x, 0.355, z, 8));
  k.push(bx(P.steel, 0.56, 0.12, 0.3, 0, 0.6, 0.1));
  k.push(...moved(stackChair(P, X), 0, -0.35, 0));
  return k;
}

// ------------------------------------------------------------------ counters and storage

/** a reception counter: a raised transaction ledge over a work top, its front in the accent — against a wall at z = 0 */
export function reception(P: Palette, X: Extra, w: number): Kit {
  const d = 0.75;
  return [
    rb(P.cabinet, w, 0.74, 0.6, 0.006, 0, 0.37, 0.3),                       // the work side
    rb(X.accent, w, 1.08, 0.06, 0.01, 0, 0.54, d + 0.15),                   // the front panel
    rb(P.counter, w + 0.06, 0.04, 0.32, 0.008, 0, 1.1, d + 0.06),          // the ledge
    rb(P.counter, w, 0.03, 0.62, 0.006, 0, 0.755, 0.31),
    bx(P.ledWarm, w - 0.1, 0.012, 0.01, 0, 0.06, d + 0.185),               // a light line at the toe
    rb(P.applianceDark, 0.5, 0.32, 0.03, 0.006, -w / 4, 0.95, 0.38), rb(P.applianceDark, 0.5, 0.32, 0.03, 0.006, w / 4, 0.95, 0.38),
  ];
}
/** a free counter facing +z (a café's bar, a pharmacy's): a back bar against the wall behind is separate */
export function serviceCounter(P: Palette, X: Extra, w: number, d = 0.65): Kit {
  return [rb(X.accentDark, w, 0.98, d, 0.01, 0, 0.49, 0), rb(P.counter, w + 0.05, 0.04, d + 0.05, 0.008, 0, 1.0, 0), bx(P.ledWarm, w - 0.1, 0.012, 0.01, 0, 0.05, d / 2 + 0.002)];
}
/** steel shelving against a wall, stocked: n bays of 0.9 m, `rows` shelves */
export function wallShelves(P: Palette, X: Extra, w: number, h = 1.9, d = 0.45, rows = 5, seed = 1): Kit {
  const k: Kit = [bx(P.appliance, w, h, 0.02, 0, h / 2, 0.01)];
  const n = Math.max(1, Math.round(w / 0.9));
  for (let i = 0; i <= n; i++) k.push(bx(P.steel, 0.03, h, d, -w / 2 + (w / n) * i, h / 2, d / 2));
  let s = seed * 9301 + 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let r = 0; r < rows; r++) {
    const y = 0.12 + (h - 0.25) * (r / (rows - 1 || 1)) * (rows > 1 ? 1 : 0);
    k.push(bx(P.steel, w, 0.02, d, 0, y, d / 2), bx(X.accent, w, 0.04, 0.01, 0, y + 0.0, d + 0.005));
    if (r === rows - 1 && h > 1.7) continue;
    let x = -w / 2 + 0.04;
    while (x < w / 2 - 0.1) {
      const bw = 0.05 + rnd() * 0.08, bh = 0.09 + rnd() * 0.15, bd = Math.min(0.2, d * (0.4 + rnd() * 0.3));
      if (x + bw > w / 2 - 0.03) break;
      const m = X.products[Math.floor(rnd() * X.products.length)];
      // (a row of the same: three or four facings)
      const facings = 1 + Math.floor(rnd() * 3);
      for (let f = 0; f < facings && x + bw < w / 2 - 0.03; f++) { k.push(rnd() < 0.3 ? cy(m, bw * 0.4, bw * 0.4, bh, x + bw / 2, y + 0.01 + bh / 2, bd / 2 + 0.02, 12) : bx(m, bw, bh, bd, x + bw / 2, y + 0.01 + bh / 2, bd / 2 + 0.02)); x += bw + 0.01; }
      x += 0.02;
    }
  }
  return k;
}
/** a gondola: shelves on both faces, free-standing, centred, its length along x */
export function gondola(P: Palette, X: Extra, l: number, seed: number): Kit {
  const a = wallShelves(P, X, l, 1.45, 0.42, 4, seed), b = wallShelves(P, X, l, 1.45, 0.42, 4, seed + 3);
  moved(b, 0, 0, Math.PI);
  return [...a, ...b, bx(X.accent, l, 0.12, 0.06, 0, 1.52, 0)];
}
/** a drinks cooler with glass doors (편의점), against a wall */
export function cooler(P: Palette, X: Extra, w: number): Kit {
  const h = 2.0, d = 0.7, k: Kit = [rb(P.appliance, w, h, d, 0.01, 0, h / 2, d / 2)];
  const n = Math.max(1, Math.round(w / 0.75));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w / n) * (i + 0.5);
    for (let r = 0; r < 5; r++) for (let j = 0; j < 6; j++) k.push(cy(X.products[(i * 7 + r * 3 + j) % X.products.length], 0.03, 0.03, 0.22, x - w / n / 2 + 0.08 + j * ((w / n - 0.16) / 5), 0.28 + r * 0.33, d - 0.15, 10));
    k.push(bx(P.blackMetal, w / n - 0.04, h - 0.25, 0.02, x, h / 2, d + 0.01), part(P.glass, T(new THREE.PlaneGeometry(w / n - 0.1, h - 0.33), x, h / 2, d + 0.025), false));
    k.push(bx(P.chrome, 0.02, 0.6, 0.03, x + w / n / 2 - 0.07, 1.1, d + 0.04));
  }
  k.push(bx(P.ledPanel, w - 0.1, 0.03, 0.02, 0, h - 0.1, d + 0.03));
  return k;
}
/** a lateral filing cabinet / storage wall (doors, pulls) */
export function cabinets(P: Palette, w: number, h = 1.2, d = 0.45): Kit {
  const k: Kit = [rb(P.cabinetUpper, w, h, d, 0.004, 0, h / 2, d / 2, 2)];
  const n = Math.max(1, Math.round(w / 0.45));
  for (let i = 1; i < n; i++) k.push(bx(P.rubber, 0.003, h - 0.02, 0.002, -w / 2 + (w / n) * i, h / 2, d + 0.0005));
  for (let i = 0; i < n; i++) k.push(bx(P.steel, 0.12, 0.012, 0.02, -w / 2 + (w / n) * (i + 0.5), h - 0.12, d + 0.01));
  return k;
}
/** lockers: a row of steel doors with vents and number plates */
export function lockers(P: Palette, X: Extra, w: number): Kit {
  const h = 1.8, d = 0.5, n = Math.max(1, Math.round(w / 0.4)), k: Kit = [rb(X.accentDark, w, h, d, 0.004, 0, h / 2, d / 2, 2)];
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w / n) * (i + 0.5);
    k.push(bx(P.rubber, 0.004, h - 0.04, 0.002, x + w / n / 2, h / 2, d + 0.001), bx(P.steel, 0.025, 0.08, 0.02, x + w / n / 2 - 0.05, 1.05, d + 0.01));
    for (let v = 0; v < 4; v++) k.push(bx(P.rubber, 0.16, 0.008, 0.002, x, 1.55 + v * 0.03, d + 0.001));
  }
  return k;
}

// ------------------------------------------------------------------ medical

/** a treatment couch: a vinyl top on a steel base with a raised head, the paper roll — centred, its length along x */
export function examCouch(P: Palette, X: Extra): Kit {
  return [
    rb(X.vinyl, 1.9, 0.09, 0.65, 0.03, 0, 0.66, 0), rb(X.vinyl, 0.55, 0.08, 0.63, 0.03, -0.75, 0.76, 0),
    bx(P.steel, 1.4, 0.06, 0.4, 0, 0.58, 0), bx(P.appliance, 0.5, 0.55, 0.45, 0, 0.28, 0), bx(P.appliance, 0.6, 0.06, 0.55, 0, 0.03, 0),
    cy(P.plastic, 0.055, 0.055, 0.62, -0.97, 0.66, 0, 16), part(P.fabricBed, T(new THREE.PlaneGeometry(1.5, 0.5).rotateX(-Math.PI / 2), 0.1, 0.706, 0)),
  ];
}
/** a hospital bed: frame, mattress and sheets, side rails, head and foot boards — centred, length along z (the head at -z) */
export function hospitalBed(P: Palette, X: Extra): Kit {
  const k: Kit = [
    bx(P.steel, 0.92, 0.08, 2.0, 0, 0.42, 0), rb(P.fabricBed, 0.9, 0.16, 1.95, 0.05, 0, 0.54, 0.02),
    rb(X.sheetGreen, 0.94, 0.04, 1.3, 0.02, 0, 0.62, 0.3), rb(P.fabricBed, 0.6, 0.12, 0.4, 0.06, 0, 0.66, -0.72),
    rb(P.appliance, 0.98, 0.55, 0.05, 0.02, 0, 0.73, -1.0), rb(P.appliance, 0.98, 0.42, 0.05, 0.02, 0, 0.62, 1.0),
  ];
  for (const s of [-1, 1]) {
    k.push(rb(P.appliance, 0.03, 0.22, 0.85, 0.01, s * 0.49, 0.72, -0.45));
    for (const z of [-0.85, 0.85]) k.push(cy(P.rubber, 0.06, 0.06, 0.05, s * 0.4, 0.06, z, 14), bx(P.steel, 0.04, 0.34, 0.04, s * 0.4, 0.24, z));
  }
  return k;
}
/** an IV pole with a bag */
export function ivPole(P: Palette): Kit {
  return [cy(P.chrome, 0.012, 0.012, 1.8, 0, 0.9, 0, 8), bx(P.chrome, 0.3, 0.012, 0.012, 0, 1.78, 0), rb(P.water, 0.12, 0.2, 0.04, 0.02, 0.12, 1.62, 0), cy(P.steel, 0.25, 0.25, 0.03, 0, 0.06, 0, 5)];
}
/** a curtain on a ceiling track round a bed (privacy): an L of pleated fabric, drawn back */
export function bedCurtain(X: Extra, w: number, l: number, ceil: number): Kit {
  const k: Kit = [];
  const pleat = (len: number) => { const g = new THREE.PlaneGeometry(len, ceil - 0.6, Math.ceil(len * 10), 1); const p = g.getAttribute("position"); for (let j = 0; j < p.count; j++) p.setZ(j, Math.sin(p.getX(j) * 28) * 0.03); g.computeVertexNormals(); return boxUV(g); };
  k.push(part(X.curtain, T(pleat(0.7), -w / 2 + 0.35, (ceil - 0.6) / 2 + 0.5, l / 2)));
  const side = pleat(0.6); side.rotateY(Math.PI / 2); k.push(part(X.curtain, T(side, -w / 2, (ceil - 0.6) / 2 + 0.5, l / 2 - 0.35)));
  return k;
}
/** a doctor's desk side: a desk against the wall with two monitors, a stool for the patient */
export function stool(P: Palette, X: Extra): Kit {
  return [cy(X.seat, 0.19, 0.19, 0.07, 0, 0.5, 0, 24), cy(P.chrome, 0.02, 0.02, 0.4, 0, 0.27, 0, 10), cy(P.blackMetal, 0.26, 0.26, 0.03, 0, 0.05, 0, 5)];
}

// ------------------------------------------------------------------ restrooms

/** a cubicle against the back wall (z = 0): two side panels, a front with a door ajar, a WC inside */
export function cubicle(X: Extra, w = 0.95, d = 1.55, h = 2.0): Kit {
  const k: Kit = [];
  for (const s of [-1, 1]) k.push(bx(X.partition, 0.025, h - 0.15, d, s * (w / 2), 0.15 + (h - 0.15) / 2, d / 2));
  k.push(bx(X.partition, 0.18, h - 0.15, 0.025, -w / 2 + 0.09, 0.15 + (h - 0.15) / 2, d), bx(X.partition, 0.12, h - 0.15, 0.025, w / 2 - 0.06, 0.15 + (h - 0.15) / 2, d));
  // (its door half open into the cubicle)
  const door = boxUV(new THREE.BoxGeometry(w - 0.3, h - 0.25, 0.025)); door.translate((w - 0.3) / 2, 0.2 + (h - 0.25) / 2, 0); door.rotateY(-1.1); door.translate(-w / 2 + 0.18, 0, d);
  k.push(part(X.partition, door));
  k.push(bx(X.hazard, 0.05, 0.02, 0.01, w / 2 - 0.12, 1.0, d + 0.015));
  return k;
}
/** a urinal on the wall with its divider */
export function urinal(P: Palette, X: Extra): Kit {
  const g = boxUV(new THREE.CylinderGeometry(0.19, 0.15, 0.62, 32, 1, false, -Math.PI / 2, Math.PI)); g.scale(1, 1, 0.9);
  return [part(P.ceramic, T(g, 0, 0.82, 0.0)), cy(P.chrome, 0.015, 0.015, 0.25, 0, 1.25, 0.05, 10), bx(X.partition, 0.02, 0.8, 0.45, 0.4, 0.95, 0.225)];
}
/** a long vanity with n basins under a mirror wall */
export function basinCounter(P: Palette, X: Extra, w: number, n: number): Kit {
  const k: Kit = [rb(P.counter, w, 0.12, 0.55, 0.01, 0, 0.8, 0.275), bx(P.cabinet, w, 0.1, 0.02, 0, 0.7, 0.52)];
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w / n) * (i + 0.5);
    const b = boxUV(new THREE.CylinderGeometry(0.2, 0.15, 0.13, 32)); b.scale(1.1, 1, 0.8); k.push(part(P.ceramic, T(b, x, 0.92, 0.3)));
    k.push(cy(P.chrome, 0.018, 0.022, 0.2, x, 0.97, 0.08, 12), bx(P.chrome, 0.025, 0.025, 0.14, x, 1.06, 0.14));
  }
  k.push(bx(X.mirrorWall, w, 0.95, 0.01, 0, 1.55, 0.005));
  k.push(rb(P.appliance, 0.28, 0.36, 0.2, 0.03, w / 2 + 0.35, 1.25, 0.1));        // the hand dryer
  return k;
}

// ------------------------------------------------------------------ lifts, stairs, the car park

/** a lift's landing door set into the wall (z = 0 the wall face): its jambs, two steel leaves, the indicator */
export function liftDoor(P: Palette): Kit {
  const w = 1.1, h = 2.2, k: Kit = [];
  k.push(bx(P.steel, w / 2 - 0.004, h, 0.03, -w / 4, h / 2, 0.015), bx(P.steel, w / 2 - 0.004, h, 0.03, w / 4, h / 2, 0.015));
  k.push(bx(P.chrome, 0.1, h + 0.1, 0.05, -w / 2 - 0.05, (h + 0.1) / 2, 0.025), bx(P.chrome, 0.1, h + 0.1, 0.05, w / 2 + 0.05, (h + 0.1) / 2, 0.025), bx(P.chrome, w + 0.2, 0.1, 0.05, 0, h + 0.05, 0.025));
  k.push(bx(P.blackMetal, 0.5, 0.14, 0.02, 0, h + 0.25, 0.01));
  k.push(bx(P.chrome, w + 0.2, 0.012, 0.12, 0, 0.006, 0.06));
  // the call buttons beside it
  k.push(rb(P.steel, 0.09, 0.22, 0.015, 0.008, w / 2 + 0.3, 1.15, 0.008), rb(P.ledWarm, 0.04, 0.04, 0.012, 0.01, w / 2 + 0.3, 1.2, 0.018), rb(P.ledWarm, 0.04, 0.04, 0.012, 0.01, w / 2 + 0.3, 1.1, 0.018));
  return k;
}
/** a stair: two flights up a well (the first along +z from z = 0), with landing, stringers and rails — in a box w × d */
export function stairs(P: Palette, X: Extra, w: number, d: number, H: number): Kit {
  const k: Kit = [], flight = (w - 0.1) / 2, rise = 0.17, n = Math.min(10, Math.floor((H - 0.3) / rise)), run = Math.min(0.28, (d - 1.4) / n);
  for (let i = 0; i < n; i++) {
    const y = (i + 1) * rise;
    k.push(bx(X.concrete, flight, rise, run, -w / 2 + flight / 2, y - rise / 2, 0.3 + i * run + run / 2));
    k.push(bx(X.hazard, flight, 0.012, 0.04, -w / 2 + flight / 2, y + 0.006, 0.3 + i * run + 0.02));
    k.push(bx(X.concrete, flight, 0.06, run + 0.02, -w / 2 + flight / 2, y - rise - 0.03, 0.3 + i * run + run / 2));
  }
  const top = n * rise, landZ = 0.3 + n * run;
  k.push(bx(X.concrete, w - 0.05, 0.15, d - landZ - 0.05, 0, top - 0.075, landZ + (d - landZ - 0.05) / 2));
  // the second flight going back up, beyond the ceiling
  for (let i = 0; i < n; i++) k.push(bx(X.concrete, flight, 0.18, run, w / 2 - flight / 2, top + (i + 1) * rise - 0.09, landZ - (i + 0.5) * run));
  // handrails
  const rail = (x: number, z0: number, y0: number, z1: number, y1: number) => { const l = Math.hypot(z1 - z0, y1 - y0); const g = new THREE.CylinderGeometry(0.022, 0.022, l, 10); g.rotateX(Math.atan2(z1 - z0, y1 - y0)); k.push(part(P.steel, T(g, x, (y0 + y1) / 2, (z0 + z1) / 2))); };
  rail(-w / 2 + flight + 0.02, 0.3, 0.9, landZ, top + 0.9);
  for (let i = 0; i <= n; i += 2) k.push(cy(P.steel, 0.012, 0.012, 0.9, -w / 2 + flight + 0.02, i * rise + 0.45, 0.3 + i * run, 8));
  return k;
}
/** a parked car (a mid-size saloon): body, glasshouse, wheels — centred, its length along z */
export function parkedCar(P: Palette, X: Extra, paint: THREE.Material): Kit {
  const L = 4.7, W = 1.85, k: Kit = [];
  k.push(rb(paint, W, 0.62, L, 0.2, 0, 0.6, 0, 4));
  const cab = rb(paint, W - 0.14, 0.5, L * 0.5, 0.18, 0, 1.12, -0.15, 4); k.push(cab);
  k.push(rb(P.applianceDark, W - 0.1, 0.4, L * 0.46, 0.16, 0, 1.12, -0.15, 4));
  k.push(rb(paint, W - 0.24, 0.06, L * 0.42, 0.03, 0, 1.38, -0.15));
  for (const sx of [-1, 1]) for (const z of [-1.45, 1.4]) { const g = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 24); g.rotateZ(Math.PI / 2); k.push(part(P.rubber, T(g, sx * (W / 2 - 0.12), 0.33, z))); const h = new THREE.CylinderGeometry(0.2, 0.2, 0.25, 18); h.rotateZ(Math.PI / 2); k.push(part(P.steel, T(h, sx * (W / 2 - 0.115), 0.33, z))); }
  for (const sx of [-1, 1]) k.push(bx(P.chrome, 0.32, 0.08, 0.04, sx * 0.62, 0.78, L / 2 - 0.01), bx(X.tail, 0.36, 0.08, 0.04, sx * 0.6, 0.82, -L / 2 + 0.01));
  return k;
}
/** a car park column with its bumper strip and number */
export function column(P: Palette, X: Extra, H: number): Kit {
  return [bx(X.concrete, 0.7, H, 0.7, 0, H / 2, 0), bx(X.hazard, 0.72, 0.9, 0.72, 0, 0.45, 0), bx(P.rubber, 0.74, 0.12, 0.74, 0, 0.9, 0)];
}

// ------------------------------------------------------------------ gym, gallery

export function treadmill(P: Palette, X: Extra): Kit {
  return [
    rb(P.applianceDark, 0.8, 0.22, 1.9, 0.04, 0, 0.15, 0), rb(P.rubber, 0.55, 0.02, 1.5, 0.01, 0, 0.27, 0.1),
    bx(P.blackMetal, 0.06, 1.1, 0.06, -0.36, 0.75, -0.75), bx(P.blackMetal, 0.06, 1.1, 0.06, 0.36, 0.75, -0.75),
    rb(P.applianceDark, 0.8, 0.35, 0.16, 0.04, 0, 1.3, -0.8), part(X.monitor, T(new THREE.PlaneGeometry(0.35, 0.2).rotateX(-0.4), 0, 1.33, -0.71), false),
  ];
}
export function weightBench(P: Palette, X: Extra): Kit {
  return [rb(X.vinyl, 0.3, 0.08, 1.2, 0.03, 0, 0.45, 0), bx(P.blackMetal, 0.06, 0.42, 0.06, 0, 0.21, -0.45), bx(P.blackMetal, 0.06, 0.42, 0.06, 0, 0.21, 0.45), bx(P.blackMetal, 0.5, 0.04, 0.06, 0, 0.02, -0.45), bx(P.blackMetal, 0.5, 0.04, 0.06, 0, 0.02, 0.45)];
}
export function dumbbellRack(P: Palette, w: number): Kit {
  const k: Kit = [bx(P.blackMetal, w, 0.05, 0.4, 0, 0.45, 0.25), bx(P.blackMetal, w, 0.05, 0.4, 0, 0.8, 0.2), bx(P.blackMetal, 0.06, 0.85, 0.5, -w / 2, 0.42, 0.25), bx(P.blackMetal, 0.06, 0.85, 0.5, w / 2, 0.42, 0.25)];
  const n = Math.floor(w / 0.22);
  for (let i = 0; i < n; i++) for (const [y, z] of [[0.53, 0.25], [0.88, 0.2]]) {
    const x = -w / 2 + 0.12 + i * 0.22, r = 0.05 + (i % 5) * 0.008;
    for (const s of [-1, 1]) { const g = new THREE.CylinderGeometry(r, r, 0.05, 14); g.rotateZ(Math.PI / 2); k.push(part(P.rubber, T(g, x + s * 0.07, y, z))); }
    const h = new THREE.CylinderGeometry(0.015, 0.015, 0.12, 8); h.rotateZ(Math.PI / 2); k.push(part(P.chrome, T(h, x, y, z)));
  }
  return k;
}
/** a plinth with a piece on it (a gallery's) */
export function plinth(P: Palette, X: Extra, seed: number): Kit {
  const k: Kit = [bx(P.appliance, 0.6, 0.95, 0.6, 0, 0.475, 0)];
  if (seed % 3 === 0) { const g = new THREE.TorusKnotGeometry(0.16, 0.05, 96, 12, 2, 3); k.push(part(P.chrome, T(boxUV(g), 0, 1.22, 0))); }
  else if (seed % 3 === 1) { const g = new THREE.LatheGeometry([[0, 0], [0.12, 0.02], [0.17, 0.15], [0.1, 0.35], [0.06, 0.42], [0.08, 0.46], [0, 0.46]].map(([x, y]) => new THREE.Vector2(x, y)), 40); k.push(part(X.accentDark, T(boxUV(g), 0, 0.95, 0))); }
  else { const g = new THREE.IcosahedronGeometry(0.22, 1); k.push(part(P.woodDark, T(boxUV(g), 0, 1.2, 0))); }
  k.push(part(P.glass, T(new THREE.BoxGeometry(0.62, 0.6, 0.62), 0, 1.26, 0), false));
  return k;
}
/** a whiteboard on the wall (its tray, its pens) */
export function whiteboard(P: Palette, X: Extra, w: number): Kit {
  return [bx(P.steel, w + 0.04, 1.24, 0.03, 0, 1.45, 0.015), bx(X.whiteboard, w, 1.2, 0.01, 0, 1.45, 0.032), bx(P.steel, w * 0.6, 0.03, 0.08, 0, 0.83, 0.05),
    cy(X.accent, 0.009, 0.009, 0.13, -0.1, 0.86, 0.05, 8), cy(P.rubber, 0.009, 0.009, 0.13, 0.05, 0.86, 0.06, 8)];
}
/** machinery: a pump set or a switchboard (plant rooms) */
export function machine(P: Palette, X: Extra, kind: number): Kit {
  if (kind % 2 === 0) return [bx(X.concrete, 1.6, 0.15, 0.9, 0, 0.075, 0.45), rb(X.accentDark, 0.7, 0.55, 0.55, 0.06, -0.35, 0.45, 0.45), cy(P.steel, 0.2, 0.2, 0.7, 0.4, 0.5, 0.45, 20), cy(P.steel, 0.08, 0.08, 2.0, 0.4, 1.6, 0.45, 14)];
  const k: Kit = [bx(P.appliance, 2.4, 2.1, 0.6, 0, 1.05, 0.3)];
  for (let i = 0; i < 4; i++) k.push(bx(P.rubber, 0.003, 2.0, 0.002, -1.2 + 0.6 * (i + 1), 1.05, 0.601), bx(X.hazard, 0.08, 0.08, 0.01, -0.9 + 0.6 * i, 1.7, 0.605), bx(P.steel, 0.02, 0.15, 0.03, -0.75 + 0.6 * i, 1.1, 0.61));
  return k;
}
