import * as THREE from "three";
import type { Kit, Part } from "./models";
import { displayPick, type Cat, type Product, type Store } from "./catalog";
import { drawFace, garmentPath } from "./productArt";

/* The goods themselves, on the shelves: each product made at its real size in its own shape — a book
 * face out, a lipstick, a jar, a pump bottle, a snack's bag, a gadget's box, a pair of trainers, a
 * handbag, sunglasses on a stand, a shirt on its hanger — its painted face (productArt.ts) in one
 * atlas a floor, so every product on the floor is one material and batches with the rest. */

const CELL = 128, SIZE = 2048, PER = SIZE / CELL;
type UV = [number, number, number, number];

export class ProductAtlas {
  readonly canvas = document.createElement("canvas");
  readonly texture: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private cells = new Map<string, number>();
  private next = 0;
  /** small solid-colour cells (8 px each), in the last row */
  private swatches = new Map<string, UV>();
  private swNext = 0;
  constructor(readonly material: THREE.MeshPhysicalMaterial) {
    this.canvas.width = this.canvas.height = SIZE;
    this.g = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.anisotropy = 8;
    material.map = this.texture; material.alphaTest = 0.5; material.side = THREE.DoubleSide; material.needsUpdate = true;
  }
  private uvOf(i: number, inset = 3): UV {
    const x = (i % PER) * CELL, y = Math.floor(i / PER) * CELL;
    return [(x + inset) / SIZE, 1 - (y + CELL - inset) / SIZE, (x + CELL - inset) / SIZE, 1 - (y + inset) / SIZE];
  }
  /** a product's face (or its cut-out, for a garment), painted once */
  face(p: Product, cut = false): UV {
    const key = `${p.id}|${cut ? 1 : 0}`;
    let i = this.cells.get(key);
    if (i === undefined) {
      // (the last row is the swatches'; full: the oldest cells reused)
      i = this.next++ % (PER * (PER - 1)); this.cells.set(key, i);
      const x = (i % PER) * CELL, y = Math.floor(i / PER) * CELL, g = this.g;
      g.clearRect(x, y, CELL, CELL);
      if (cut) { g.save(); garmentPath(g, p.form, x + 4, y + 4, CELL - 8, CELL - 8); g.clip(); drawFace(g, p, x, y, CELL, CELL); g.restore(); }
      else { drawFace(g, p, x, y, CELL, CELL); }
      this.texture.needsUpdate = true;
    }
    return this.uvOf(i, cut ? 1 : 3);
  }
  swatch(colour: string): UV {
    let s = this.swatches.get(colour);
    if (!s) {
      const n = this.swNext++ % (PER * 16), x = (n % (SIZE / 8)) * 8, y = SIZE - CELL + Math.floor(n / (SIZE / 8)) * 8;
      this.g.fillStyle = colour; this.g.fillRect(x, y, 8, 8); this.texture.needsUpdate = true;
      s = [(x + 3) / SIZE, 1 - (y + 5) / SIZE, (x + 5) / SIZE, 1 - (y + 3) / SIZE]; this.swatches.set(colour, s);
    }
    return s;
  }
  dispose() { this.texture.dispose(); }
}

// ------------------------------------------------------------------ geometry helpers
const tmp = new THREE.Vector3();
/** project along z onto a cell: the face toward +z shows it whole, the sides take its edges */
function planar(g: THREE.BufferGeometry, uv: UV): THREE.BufferGeometry {
  g = g.index ? g.toNonIndexed() : g;
  g.computeBoundingBox(); const b = g.boundingBox!, pos = g.getAttribute("position");
  const out = new Float32Array(pos.count * 2), w = Math.max(1e-6, b.max.x - b.min.x), h = Math.max(1e-6, b.max.y - b.min.y);
  for (let i = 0; i < pos.count; i++) { tmp.fromBufferAttribute(pos, i); out[i * 2] = uv[0] + (uv[2] - uv[0]) * (tmp.x - b.min.x) / w; out[i * 2 + 1] = uv[1] + (uv[3] - uv[1]) * (tmp.y - b.min.y) / h; }
  g.setAttribute("uv", new THREE.BufferAttribute(out, 2)); return g;
}
/** one colour all over */
function solid(g: THREE.BufferGeometry, uv: UV): THREE.BufferGeometry {
  g = g.index ? g.toNonIndexed() : g;
  const n = g.getAttribute("position").count, out = new Float32Array(n * 2), u = (uv[0] + uv[2]) / 2, v = (uv[1] + uv[3]) / 2;
  for (let i = 0; i < n; i++) { out[i * 2] = u; out[i * 2 + 1] = v; }
  g.setAttribute("uv", new THREE.BufferAttribute(out, 2)); return g;
}
/** a box whose front (+z) shows the face and whose other sides take a sliver of its left edge */
function faceBox(w: number, h: number, d: number, uv: UV, side?: UV): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(), a = g.getAttribute("uv") as THREE.BufferAttribute;
  const s = side ?? [uv[0], uv[1], uv[0] + (uv[2] - uv[0]) * 0.06, uv[3]];
  // (BoxGeometry's faces: +x −x +y −y +z −z, six vertices each once unindexed)
  for (let f = 0; f < 6; f++) { const r = f === 4 ? uv : s; for (let k = 0; k < 6; k++) { const i = f * 6 + k; a.setXY(i, r[0] + (r[2] - r[0]) * a.getX(i), r[1] + (r[3] - r[1]) * a.getY(i)); } }
  return g;
}
/** a cylinder with the label wrapped round it, its seam at the back */
function labelCyl(r0: number, r1: number, h: number, uv: UV, cap: UV, seg = 18): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r0, r1, h, seg, 1, false, Math.PI).toNonIndexed(), a = g.getAttribute("uv") as THREE.BufferAttribute, nor = g.getAttribute("normal");
  for (let i = 0; i < a.count; i++) {
    if (Math.abs(nor.getY(i)) > 0.9) a.setXY(i, (cap[0] + cap[2]) / 2, (cap[1] + cap[3]) / 2);
    else { const u = a.getX(i), v = a.getY(i); a.setXY(i, uv[0] + (uv[2] - uv[0]) * Math.min(1, Math.max(0, (u - 0.25) * 2)), uv[1] + (uv[3] - uv[1]) * v); }
  }
  return g;
}
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) => { if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry); return g.translate(x, y, z); };

/** the product's own shape, standing on y = 0, its front toward +z, centred; and its footprint */
export function productKit(A: ProductAtlas, p: Product): { kit: Kit; w: number; d: number; h: number } {
  const m = A.material, part = (g: THREE.BufferGeometry): Part => ({ m, g, cast: false });
  const F = () => A.face(p), S = (c: string) => A.swatch(c);
  const k: Kit = [];
  let w = 0.1, d = 0.1, h = 0.1;
  switch (p.form) {
    case "book": w = 0.15; h = 0.22; d = 0.03; k.push(part(at(faceBox(w, h, d, F(), S("#f1ece0")), 0, h / 2, 0))); break;
    case "notebook": w = 0.15; h = 0.21; d = 0.012; k.push(part(at(faceBox(w, h, d, F()), 0, h / 2, 0))); break;
    case "device": w = 0.13; h = 0.19; d = 0.05; k.push(part(at(faceBox(w, h, d, F()), 0, h / 2, 0))); break;
    case "box": {
      const big = p.cat === "household" || p.cat === "toys" || p.cat === "kitchen" || p.cat === "deco", cereal = p.cat === "grocery";
      w = big ? 0.26 : cereal ? 0.18 : 0.14; h = big ? 0.24 : cereal ? 0.26 : 0.17; d = big ? 0.16 : 0.05;
      k.push(part(at(faceBox(w, h, d, F()), 0, h / 2, 0))); break;
    }
    case "pouch": case "sheet": {
      w = p.form === "sheet" ? 0.16 : 0.17; h = p.form === "sheet" ? 0.22 : 0.25; d = p.form === "sheet" ? 0.012 : 0.06;
      const g = new THREE.BoxGeometry(w, h, d, 6, 6, 2); const pos = g.getAttribute("position");
      for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) / (w / 2), y = pos.getY(i) / (h / 2); pos.setZ(i, pos.getZ(i) * Math.max(0.15, (1 - x * x) * (1 - y ** 6))); }
      g.computeVertexNormals(); k.push(part(at(planar(g, F()), 0, h / 2, 0))); break;
    }
    case "bottle": case "pump": case "pet": {
      const r = p.form === "pet" ? 0.034 : 0.03; h = p.form === "pet" ? 0.22 : p.form === "pump" ? 0.19 : 0.15; w = d = r * 2;
      k.push(part(at(labelCyl(r, r, h * 0.78, F(), S(p.color)), 0, h * 0.39, 0)));
      k.push(part(at(solid(new THREE.CylinderGeometry(r * 0.45, r, h * 0.1, 14), S(p.color)), 0, h * 0.83, 0)));
      k.push(part(at(solid(new THREE.CylinderGeometry(r * 0.42, r * 0.42, h * 0.08, 12), S(p.color2)), 0, h * 0.92, 0)));
      if (p.form === "pump") k.push(part(at(solid(new THREE.BoxGeometry(0.012, 0.012, 0.04), S(p.color2)), 0, h + 0.004, 0.015)));
      break;
    }
    case "perfume": w = 0.07; h = 0.11; d = 0.04; k.push(part(at(faceBox(w, h * 0.72, d, F(), S(p.color)), 0, h * 0.36, 0)), part(at(solid(new THREE.BoxGeometry(0.03, h * 0.26, 0.03), S(p.color2)), 0, h * 0.85, 0))); break;
    case "jar": w = d = 0.08; h = 0.07; k.push(part(at(labelCyl(0.04, 0.04, 0.05, F(), S(p.color)), 0, 0.025, 0)), part(at(solid(new THREE.CylinderGeometry(0.041, 0.041, 0.02, 18), S(p.color2)), 0, 0.06, 0))); break;
    case "tube": w = 0.05; h = 0.16; d = 0.025; k.push(part(at(planar(new THREE.CylinderGeometry(0.022, 0.012, 0.14, 14).scale(1, 1, 0.5), F()), 0, 0.09, 0)), part(at(solid(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 12), S(p.color2)), 0, 0.01, 0))); break;
    case "lipstick": w = d = 0.024; h = 0.085; k.push(part(at(solid(new THREE.CylinderGeometry(0.012, 0.012, 0.055, 14), S(p.color2)), 0, 0.0275, 0)), part(at(solid(new THREE.CylinderGeometry(0.008, 0.008, 0.025, 12), S(p.color)), 0, 0.068, 0))); break;
    case "compact": w = d = 0.08; h = 0.02; k.push(part(at(solid(new THREE.CylinderGeometry(0.04, 0.04, 0.016, 24), S(p.color2)), 0, 0.008, 0)), part(at(planar(new THREE.CylinderGeometry(0.036, 0.036, 0.002, 24).rotateX(Math.PI / 2), F()), 0, 0.017, 0, 0, -Math.PI / 2))); break;
    case "can": w = d = 0.066; h = 0.122; k.push(part(at(labelCyl(0.033, 0.033, h, F(), S("#cfd3d8")), 0, h / 2, 0))); break;
    case "carton": w = 0.065; h = 0.15; d = 0.045; k.push(part(at(faceBox(w, 0.12, d, F(), S(p.color)), 0, 0.06, 0)), part(at(solid(new THREE.CylinderGeometry(0.0, 0.045, 0.03, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 0.7), S("#f4f4f1")), 0, 0.135, 0))); break;
    case "cup": case "mug": w = d = 0.09; h = 0.14; k.push(part(at(labelCyl(0.045, 0.035, 0.13, F(), S(p.color)), 0, 0.065, 0))); if (p.form === "cup") k.push(part(at(solid(new THREE.CylinderGeometry(0.047, 0.047, 0.012, 18), S("#f4f4f1")), 0, 0.136, 0))); break;
    case "shoe": case "boot": case "heel": {
      // a pair: soles, the uppers (the colourway), a boot's shaft, a heel's block
      w = 0.24; d = 0.28; h = p.form === "boot" ? 0.2 : 0.1;
      for (const sx of [-0.06, 0.06]) {
        k.push(part(at(solid(new THREE.BoxGeometry(0.095, 0.025, 0.27), S("#f2f2ef")), sx, 0.0125, 0)));
        const up = new THREE.SphereGeometry(0.5, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.092, p.form === "heel" ? 0.07 : 0.11, 0.27);
        k.push(part(at(planar(up, F()), sx, 0.024, 0)));
        if (p.form === "boot") k.push(part(at(planar(new THREE.CylinderGeometry(0.045, 0.048, 0.14, 14), F()), sx, 0.12, -0.07)));
        if (p.form === "heel") k.push(part(at(solid(new THREE.BoxGeometry(0.03, 0.07, 0.03), S(p.color)), sx, 0.035, -0.11)));
      }
      break;
    }
    case "bag": case "backpack": case "wallet": {
      const f = p.form; w = f === "wallet" ? 0.19 : f === "backpack" ? 0.28 : 0.3; h = f === "wallet" ? 0.1 : f === "backpack" ? 0.4 : 0.24; d = f === "wallet" ? 0.025 : f === "backpack" ? 0.15 : 0.12;
      const g = new THREE.BoxGeometry(w, h, d, 4, 4, 2), pos = g.getAttribute("position");
      for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / (h / 2); pos.setX(i, pos.getX(i) * (f === "bag" ? 1 - 0.12 * (y + 1) / 2 : 1)); }
      g.computeVertexNormals(); k.push(part(at(planar(g, F()), 0, h / 2, 0)));
      if (f !== "wallet") k.push(part(at(solid(new THREE.TorusGeometry(f === "backpack" ? 0.05 : 0.08, 0.008, 6, 18, Math.PI), S(p.color)), 0, h, 0)));
      break;
    }
    case "sunglasses": case "glasses": {
      // on a small clear stand: the two lenses, the bridge, the temples folded back
      w = 0.15; d = 0.12; h = 0.09;
      const fr = S(p.color), ln = S(p.form === "sunglasses" ? p.color2 : "#d7e6ee"), y = 0.06;
      k.push(part(at(solid(new THREE.BoxGeometry(0.05, 0.035, 0.05), S("#e9edf0")), 0, 0.0175, -0.02)));
      for (const sx of [-0.036, 0.036]) {
        k.push(part(at(solid(new THREE.CylinderGeometry(0.026, 0.026, 0.004, 18).rotateX(Math.PI / 2).scale(1, 0.78, 1), ln), sx, y, 0.012)));
        k.push(part(at(solid(new THREE.TorusGeometry(0.026, 0.0035, 5, 20).scale(1, 0.78, 1), fr), sx, y, 0.012)));
        k.push(part(at(solid(new THREE.BoxGeometry(0.004, 0.004, 0.12), fr), sx * 1.85, y + 0.008, -0.05)));
      }
      k.push(part(at(solid(new THREE.BoxGeometry(0.022, 0.005, 0.005), fr), 0, y + 0.012, 0.012)));
      break;
    }
    case "watch": w = 0.08; d = 0.08; h = 0.06; k.push(part(at(solid(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 16).rotateZ(Math.PI / 2).scale(1, 1, 1), S(p.color2)), 0, 0.035, 0, 0, 0, 0)), part(at(solid(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 20).rotateX(Math.PI / 2), S(p.color)), 0, 0.045, 0.036)), part(at(solid(new THREE.CylinderGeometry(0.016, 0.016, 0.002, 20).rotateX(Math.PI / 2), S("#f4f2ec")), 0, 0.045, 0.043))); break;
    case "ring": w = d = 0.05; h = 0.04; k.push(part(at(solid(new THREE.BoxGeometry(0.05, 0.02, 0.05), S("#1f1f24")), 0, 0.01, 0)), part(at(solid(new THREE.TorusGeometry(0.01, 0.002, 6, 16), S(p.color)), 0, 0.032, 0))); break;
    case "necklace": w = 0.12; d = 0.08; h = 0.2; k.push(part(at(solid(new THREE.BoxGeometry(0.05, 0.2, 0.04), S("#1f1f24")), 0, 0.1, -0.02)), part(at(solid(new THREE.TorusGeometry(0.05, 0.002, 4, 24, Math.PI), S(p.color)), 0, 0.17, 0.001, 0, 0, Math.PI)), part(at(solid(new THREE.SphereGeometry(0.008, 8, 6), S(p.color)), 0, 0.118, 0.004))); break;
    case "cap": w = 0.2; d = 0.26; h = 0.12; k.push(part(at(planar(new THREE.SphereGeometry(0.095, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), F()), 0, 0, 0)), part(at(solid(new THREE.CylinderGeometry(0.09, 0.09, 0.006, 16, 1, false, 0, Math.PI).scale(1, 1, 0.8), S(p.color)), 0, 0.004, 0.06))); break;
    case "fruit": {
      w = 0.28; d = 0.22; h = 0.12;
      for (let i = 0; i < 6; i++) k.push(part(at(solid(new THREE.IcosahedronGeometry(/수박/.test(p.name) ? 0.1 : /포도|샤인|블루베리|토마토|딸기/.test(p.name) ? 0.03 : 0.045, 1), S(p.color)), -0.09 + (i % 3) * 0.09, 0.045 + Math.floor(i / 3) * 0.05, -0.04 + Math.floor(i / 3) * 0.06)));
      k.push(part(at(solid(new THREE.BoxGeometry(0.3, 0.04, 0.22), S("#c9a270")), 0, 0.02, 0)));
      break;
    }
    case "tray": w = 0.22; d = 0.16; h = 0.05; k.push(part(at(solid(new THREE.BoxGeometry(0.22, 0.02, 0.16), S("#f4f4f1")), 0, 0.01, 0)), part(at(planar(new THREE.BoxGeometry(0.19, 0.03, 0.13).rotateX(-Math.PI / 2), F()), 0, 0.035, 0, 0, Math.PI / 2))); break;
    case "bread": w = 0.14; d = 0.09; h = 0.06; k.push(part(at(solid(new THREE.SphereGeometry(0.5, 12, 8).scale(0.13, 0.06, 0.08), S(p.color)), 0, 0.028, 0))); break;
    case "cake": w = 0.09; d = 0.09; h = 0.07; k.push(part(at(solid(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 3, 1).scale(1, 1, 0.9), S(p.color)), 0, 0.03, 0)), part(at(solid(new THREE.SphereGeometry(0.01, 8, 6), S("#e63946")), 0, 0.068, 0))); break;
    case "pen": w = 0.16; d = 0.02; h = 0.02; k.push(part(at(solid(new THREE.CylinderGeometry(0.006, 0.006, 0.15, 8).rotateZ(Math.PI / 2), S(p.color)), 0, 0.006, 0)), part(at(solid(new THREE.CylinderGeometry(0.0065, 0.0065, 0.03, 8).rotateZ(Math.PI / 2), S(p.color2)), 0.06, 0.006, 0))); break;
    case "plant": w = d = 0.14; h = 0.25; k.push(part(at(solid(new THREE.CylinderGeometry(0.06, 0.045, 0.1, 14), S(p.color)), 0, 0.05, 0)), part(at(solid(new THREE.IcosahedronGeometry(0.075, 1), S("#3f7d20")), 0, 0.16, 0))); break;
    case "toy": w = d = 0.14; h = 0.2; k.push(part(at(solid(new THREE.SphereGeometry(0.06, 12, 8), S(p.color)), 0, 0.06, 0)), part(at(solid(new THREE.SphereGeometry(0.045, 12, 8), S(p.color)), 0, 0.15, 0)), part(at(solid(new THREE.SphereGeometry(0.016, 8, 6), S(p.color)), -0.035, 0.19, 0)), part(at(solid(new THREE.SphereGeometry(0.016, 8, 6), S(p.color)), 0.035, 0.19, 0))); break;
    case "ball": w = d = h = 0.22; k.push(part(at(solid(new THREE.IcosahedronGeometry(0.11, 2), S(p.color)), 0, 0.11, 0))); break;
    case "tee": case "shirt": case "pants": case "dress": case "coat": case "folded":
      // (folded on a table: a stack in its fabric)
      w = 0.3; d = 0.26; h = 0.08;
      for (let i = 0; i < 3; i++) k.push(part(at(new THREE.BoxGeometry(0.3, 0.025, 0.25).toNonIndexed(), 0, 0.0125 + i * 0.026, 0)));
      for (const q of k) planarTop(q.g, F());
      break;
    default: k.push(part(at(faceBox(0.1, 0.1, 0.1, F()), 0, 0.05, 0)));
  }
  return { kit: k, w, d, h };
}
/** a folded garment's fabric on its top and sides alike */
function planarTop(g: THREE.BufferGeometry, uv: UV) {
  g.computeBoundingBox(); const b = g.boundingBox!, pos = g.getAttribute("position"), out = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { out[i * 2] = uv[0] + (uv[2] - uv[0]) * (pos.getX(i) - b.min.x) / (b.max.x - b.min.x); out[i * 2 + 1] = uv[1] + (uv[3] - uv[1]) * (pos.getZ(i) - b.min.z) / (b.max.z - b.min.z); }
  g.setAttribute("uv", new THREE.BufferAttribute(out, 2));
}
const moveKit = (k: Kit, m: THREE.Matrix4) => { for (const p of k) p.g.applyMatrix4(m); return k; };

/** a garment on its hanger, seen side-on along a rail (thin, its fabric all over) or face-out */
export function hangingGarment(A: ProductAtlas, p: Product, faceOut: boolean, hook: THREE.Material): Kit {
  const m = A.material, long = p.form === "pants" || p.form === "dress" || p.form === "coat";
  const w = p.form === "pants" ? 0.42 : p.form === "coat" ? 0.6 : 0.52, h = long ? 1.0 : 0.72;
  const k: Kit = [];
  if (faceOut) k.push({ m, g: at(planar(new THREE.PlaneGeometry(w, h), A.face(p, true)), 0, -h / 2 - 0.04, 0), cast: false });
  else { const g = new THREE.BoxGeometry(0.035, h, w * 0.85, 1, 4, 1); k.push({ m, g: at(planar(g.rotateY(Math.PI / 2), A.face(p)).rotateY(-Math.PI / 2), 0, -h / 2 - 0.04, 0), cast: false }); }
  // the hanger's hook and bar
  k.push({ m: hook, g: new THREE.TorusGeometry(0.018, 0.003, 4, 10, Math.PI * 1.4).rotateY(faceOut ? 0 : Math.PI / 2).translate(0, 0.012, 0), cast: false });
  k.push({ m: hook, g: new THREE.BoxGeometry(faceOut ? w * 0.8 : 0.012, 0.012, faceOut ? 0.012 : w * 0.8).translate(0, -0.03, 0), cast: false });
  return k;
}

/** goods for one display: what the store sells (or of the given categories) */
export function stockFor(store: Store, cats: Cat[] | null, n: number, seed: number) { return displayPick(store, cats, n, seed); }

/** A shelf's row: products standing along x from −len/2 to len/2 at height y, fronts at z = front,
 * two or three facings of each, as many as fit. */
export function shelfRow(A: ProductAtlas, items: Product[], len: number, y: number, front: number, maxH: number, seed: number): Kit {
  const out: Kit = [];
  let x = -len / 2 + 0.03, i = 0;
  while (x < len / 2 - 0.05 && items.length) {
    const p = items[(seed + i++) % items.length];
    const probe = productKit(A, p); probe.kit.forEach(q => q.g.dispose());
    if (probe.h > maxH) { if (i > items.length * 2) break; continue; }
    const facings = probe.w < 0.08 ? 3 : probe.w < 0.18 ? 2 : 1, gap = probe.w < 0.05 ? 0.012 : 0.02;
    for (let f = 0; f < facings; f++) {
      if (x + probe.w > len / 2 - 0.02) break;
      const { kit } = productKit(A, p);
      out.push(...moveKit(kit, new THREE.Matrix4().makeTranslation(x + probe.w / 2, y, front - probe.d / 2)));
      x += probe.w + gap;
    }
    x += 0.025;
  }
  return out;
}
/** a table's top laid with goods in a grid (folded clothes, bags, shoes, cosmetics…) */
export function tableTop(A: ProductAtlas, items: Product[], w: number, d: number, y: number, seed: number): Kit {
  const out: Kit = [];
  if (!items.length) return out;
  const probe = productKit(A, items[seed % items.length]); probe.kit.forEach(q => q.g.dispose());
  const cw = Math.max(0.08, probe.w + 0.06), cd = Math.max(0.08, probe.d + 0.06);
  const nx = Math.max(1, Math.floor((w - 0.1) / cw)), nz = Math.max(1, Math.floor((d - 0.1) / cd));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const p = items[(seed + i * nz + j) % items.length], { kit } = productKit(A, p);
    out.push(...moveKit(kit, new THREE.Matrix4().makeRotationY(j >= nz / 2 ? Math.PI : 0).setPosition(-w / 2 + (i + 0.5) * (w / nx), y, -d / 2 + (j + 0.5) * (d / nz))));
  }
  return out;
}

/** a display mannequin dressed: its top's fabric on the torso, its bottom's on the legs, a white
 * glossy head, on a steel stand */
export function mannequin(A: ProductAtlas, top: Product | undefined, bottom: Product | undefined, steel: THREE.Material, gloss: THREE.Material): Kit {
  const m = A.material, k: Kit = [
    { m: steel, g: new THREE.CylinderGeometry(0.17, 0.2, 0.03, 24).translate(0, 0.015, 0) },
    { m: steel, g: new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8).translate(0, 0.17, 0) },
  ];
  const fabric = (p: Product | undefined, g: THREE.BufferGeometry) => p ? { m, g: planar(g, A.face(p)) } : { m: gloss, g };
  k.push(fabric(bottom, new THREE.CylinderGeometry(0.13, 0.09, 0.62, 16).translate(0, 0.62, 0)));
  k.push(fabric(top, new THREE.CylinderGeometry(0.16, 0.13, 0.5, 18).scale(1, 1, 0.7).translate(0, 1.18, 0)));
  k.push(fabric(top, new THREE.SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 0.7).translate(0, 1.43, 0)));
  for (const sx of [-1, 1]) k.push(fabric(top, new THREE.CylinderGeometry(0.045, 0.035, 0.5, 10).rotateZ(sx * 0.18).translate(sx * 0.2, 1.2, 0)));
  k.push({ m: gloss, g: new THREE.CylinderGeometry(0.04, 0.045, 0.1, 12).translate(0, 1.52, 0) });
  k.push({ m: gloss, g: new THREE.SphereGeometry(0.1, 18, 14).scale(0.85, 1.1, 0.95).translate(0, 1.68, 0) });
  return k;
}
