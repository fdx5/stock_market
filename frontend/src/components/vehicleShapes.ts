import * as THREE from "three";
import { mergeGeometries, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/* The vehicles' shapes as pure geometry (no page, no materials): built once a session in a
 * worker (vehicleWorker.ts) and sent to the page as arrays — made on the page, every kind's
 * shape was 10-30 ms of a frame, and the boxed trucks were made again for every complex. */

export interface Pack { types: { name: string; verts: number; index: number; offset: number; min: number[]; max: number[] }[] }

/** Real-world length, width, height (m) the Kenney models are scaled to. */
export const DIMS: Record<string, [number, number, number]> = {
  sedan: [4.8, 1.85, 1.45], suv: [4.8, 1.92, 1.75], "hatchback-sports": [4.2, 1.8, 1.42], van: [5.1, 1.95, 1.95],
  taxi: [4.8, 1.85, 1.55], delivery: [6.2, 2.0, 2.6], truck: [7.2, 2.3, 2.7],
  "sedan-sports": [4.7, 1.85, 1.35], "suv-luxury": [5.0, 1.98, 1.8],
};

/** The Kenney kit's vehicles from its packed file (vehicles.bin), scaled to real size. */
export function kitGeometries(pack: Pack, bin: ArrayBuffer): Map<string, THREE.BufferGeometry> {
  const geos = new Map<string, THREE.BufferGeometry>();
  for (const t of pack.types) {
    let o = t.offset;
    const qp = new Int16Array(bin, o, t.verts * 3); o += t.verts * 6;
    const qn = new Int8Array(bin, o, t.verts * 3); o += t.verts * 3; o += o % 2;
    const qu = new Uint16Array(bin, o, t.verts * 2); o += t.verts * 4;
    const idx = new Uint16Array(bin, o, t.index);
    const [L, W, H] = DIMS[t.name] ?? [4.5, 1.8, 1.5];
    const ext = t.max.map((v, i) => v - t.min[i]);
    // Kenney: x across, y up, z along (front +z). Scale each axis to the real size,
    // wheels on the ground, centred on the car.
    const sx = W / ext[0], sy = H / ext[1], sz = L / ext[2];
    const pos = new Float32Array(t.verts * 3), nor = new Float32Array(t.verts * 3), uv = new Float32Array(t.verts * 2);
    const n = new THREE.Vector3();
    for (let i = 0; i < t.verts; i++) {
      const deq = (k: number) => t.min[k] + ((qp[i * 3 + k] + 32767) / 65534) * ext[k];
      pos[i * 3] = (deq(0) - (t.min[0] + ext[0] / 2)) * sx;
      pos[i * 3 + 1] = (deq(1) - t.min[1]) * sy;
      pos[i * 3 + 2] = (deq(2) - (t.min[2] + ext[2] / 2)) * sz;
      n.set(qn[i * 3] / sx, qn[i * 3 + 1] / sy, qn[i * 3 + 2] / sz).normalize();
      nor[i * 3] = n.x; nor[i * 3 + 1] = n.y; nor[i * 3 + 2] = n.z;
      uv[i * 2] = qu[i * 2] / 65535; uv[i * 2 + 1] = qu[i * 2 + 1] / 65535;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
    // Kenney's cars are flat-shaded facets: smooth normals within 45° (the panels read
    // rounded, like pressed steel) and hard at the real creases (roof edge, wheel arch).
    const flat = g.toNonIndexed();
    geos.set(t.name, toCreasedNormals(flat, (45 * Math.PI) / 180));
    flat.dispose();
    g.dispose();
  }
  return geos;
}

/** Plain boxes with vertex colours: body, glazing band, roof, chassis. */
function boxes(parts: [w: number, h: number, l: number, x: number, y: number, z: number, color: string][]) {
  const list = parts.map(([w, h, l, x, y, z, color]) => {
    const g = new THREE.BoxGeometry(w, h, l).toNonIndexed();
    g.translate(x, y, z);
    const c = new THREE.Color(color), n = g.getAttribute("position").count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.deleteAttribute("uv");
    return g;
  });
  const out = mergeGeometries(list, false)!;
  list.forEach(g => g.dispose());
  return out;
}
const wheels = (w: number, axles: number[]) =>
  axles.flatMap(z => [-1, 1].map(s => [0.3, 1.0, 1.0, (s * w) / 2 - s * 0.12, 0.5, z, "#1d1f22"] as [number, number, number, number, number, number, string]));

function busGeometry(body: string) {
  // Korean city bus: 11 m, glazing band, white roof, low floor.
  return boxes([
    [2.5, 2.3, 11, 0, 1.5, 0, body], [2.52, 1.0, 10.2, 0, 2.05, -0.1, "#20303c"], [2.52, 1.4, 0.06, 0, 2.0, 5.5, "#20303c"],
    [2.42, 0.25, 10.8, 0, 2.78, 0, "#f1f1ee"], ...wheels(2.5, [3.6, -3.4]),
  ]);
}
function containerGeometry(box: string) {
  // Tractor unit and a 40 ft container on its chassis.
  return boxes([
    [2.45, 2.5, 2.4, 0, 1.95, 6.9, "#e8e6e1"], [2.47, 0.8, 0.06, 0, 2.5, 8.1, "#22303a"], [1.2, 0.3, 14.5, 0, 0.9, 0, "#2b2d30"],
    [2.44, 2.6, 12.2, 0, 2.35, -1.1, box], ...wheels(2.45, [7.2, 5.6, -5.4, -6.6]),
  ]);
}
function cargoGeometry(cab: string) {
  // Korean 1-ton cargo truck: cab-over front, open bed with low drop sides.
  return boxes([
    [1.75, 1.35, 1.6, 0, 1.25, 1.75, cab], [1.77, 0.55, 0.06, 0, 1.55, 2.56, "#22303a"], [1.4, 0.25, 5.0, 0, 0.62, 0, "#2b2d30"],
    [1.8, 0.1, 3.1, 0, 0.8, -0.85, "#8d9196"], [0.06, 0.42, 3.1, -0.87, 1.05, -0.85, "#b9bdc2"], [0.06, 0.42, 3.1, 0.87, 1.05, -0.85, "#b9bdc2"],
    [1.8, 0.42, 0.06, 0, 1.05, -2.4, "#b9bdc2"], ...wheels(1.75, [1.6, -1.6]),
  ]);
}

/* Service vehicles: rounded panels (vertex colours), glazing, real wheels. */
function paint(g: THREE.BufferGeometry, color: string) {
  const out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  out.deleteAttribute("uv");
  const c = new THREE.Color(color), n = out.getAttribute("position").count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return out;
}
const rbox = (w: number, h: number, l: number, x: number, y: number, z: number, color: string, r = 0.08) =>
  paint(new RoundedBoxGeometry(w, h, l, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, l / 2 - 0.001)).translate(x, y, z), color);
const GLASS = "#1b2630", TYRE = "#1a1b1d", HUB = "#a9adb2";
function wheelPair(W: number, z: number, r = 0.4, dual = false): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const x = s * (W / 2 - (dual ? 0.3 : 0.16));
    out.push(paint(new THREE.CylinderGeometry(r, r, dual ? 0.55 : 0.28, 16).rotateZ(Math.PI / 2).translate(x, r, z), TYRE));
    out.push(paint(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.02, 12).rotateZ(Math.PI / 2).translate(x + s * (dual ? 0.285 : 0.145), r, z), HUB));
  }
  return out;
}
function assemble(list: THREE.BufferGeometry[]) {
  const out = mergeGeometries(list, false)!;
  list.forEach(g => g.dispose());
  return out;
}
/** 119 구급차: 5.7 m van with a box body, red bands, light bar. */
function ambulanceGeometry() {
  return assemble([
    rbox(1.96, 1.2, 1.7, 0, 1.0, 1.95, "#f4f4f2", 0.2), paint(new THREE.BoxGeometry(1.86, 0.62, 0.05).rotateX(-0.35).translate(0, 1.55, 2.62), GLASS),
    rbox(2.02, 2.05, 3.9, 0, 1.52, -0.75, "#f7f7f5", 0.12), rbox(2.05, 0.2, 5.5, 0, 1.0, -0.12, "#d8262b", 0.04), rbox(2.05, 0.08, 3.9, 0, 2.3, -0.75, "#e0632a", 0.03),
    rbox(2.04, 0.5, 1.2, 0, 1.95, -0.2, GLASS, 0.04), paint(new THREE.BoxGeometry(1.6, 0.9, 0.04).translate(0, 1.6, -2.72), GLASS),
    rbox(1.3, 0.14, 0.3, 0, 2.62, 1.5, "#d42525", 0.05), rbox(0.5, 0.14, 0.3, 0.42, 2.62, 1.5, "#2a5fd8", 0.05),
    rbox(1.9, 0.35, 0.2, 0, 0.55, 2.8, "#3a3d42", 0.06), ...wheelPair(1.96, 1.85, 0.37), ...wheelPair(1.96, -1.8, 0.37, true),
  ]);
}
/** 경찰차: a white sedan with a navy band and a red / blue light bar. */
function policeGeometry() {
  return assemble([
    rbox(1.84, 0.62, 4.85, 0, 0.66, 0, "#f5f6f7", 0.22), rbox(1.86, 0.2, 4.4, 0, 0.62, 0, "#1d2d57", 0.05),
    rbox(1.62, 0.56, 2.45, 0, 1.2, -0.25, GLASS, 0.18), rbox(1.56, 0.07, 1.95, 0, 1.49, -0.3, "#f5f6f7", 0.03),
    rbox(1.2, 0.12, 0.28, 0, 1.58, -0.15, "#1f1f22", 0.04), rbox(0.5, 0.1, 0.26, -0.32, 1.66, -0.15, "#e02424", 0.04), rbox(0.5, 0.1, 0.26, 0.32, 1.66, -0.15, "#2456e0", 0.04),
    rbox(1.7, 0.26, 0.2, 0, 0.5, 2.4, "#2a2d31", 0.06), ...wheelPair(1.84, 1.45, 0.34), ...wheelPair(1.84, -1.5, 0.34),
  ]);
}
/** 소방 펌프차: 7.5 m red cab-over with equipment lockers and a roof ladder. */
function fireGeometry() {
  const list = [
    rbox(2.4, 2.1, 2.2, 0, 1.6, 2.6, "#c8141b", 0.18), paint(new THREE.BoxGeometry(2.25, 0.8, 0.05).translate(0, 2.0, 3.71), GLASS),
    rbox(2.44, 0.5, 2.0, 0, 2.05, 2.3, GLASS, 0.04), rbox(2.42, 2.2, 5.1, 0, 1.65, -1.2, "#cf1a1f", 0.1),
    rbox(2.46, 0.16, 7.3, 0, 1.1, 0.3, "#f2f2f0", 0.03), rbox(1.2, 0.1, 0.3, 0, 2.72, 2.9, "#1f6fe0", 0.04),
    rbox(2.1, 0.3, 0.2, 0, 0.7, 3.72, "#2a2a2c", 0.06),
    ...wheelPair(2.4, 2.55, 0.5), ...wheelPair(2.4, -2.3, 0.5, true),
  ];
  for (const x of [-0.45, 0.45]) list.push(rbox(0.07, 0.07, 5.8, x, 2.95, -0.6, "#c9ccd0", 0.02));
  for (let z = -3.3; z <= 2.2; z += 0.45) list.push(rbox(0.9, 0.05, 0.05, 0, 2.95, z, "#c9ccd0", 0.02));
  for (let z = -3.2; z <= 0.8; z += 1.0) for (const s of [-1, 1]) list.push(rbox(0.02, 1.6, 0.9, s * 1.215, 1.7, z, "#a8acb2", 0.01));
  return assemble(list);
}
/** 압축 청소차: 7 m, white cab, green compactor body with the rear hopper. */
function garbageGeometry() {
  return assemble([
    rbox(2.3, 2.0, 1.9, 0, 1.55, 2.5, "#eef0ee", 0.18), paint(new THREE.BoxGeometry(2.15, 0.8, 0.05).translate(0, 1.95, 3.46), GLASS),
    rbox(2.34, 0.5, 1.7, 0, 2.0, 2.25, GLASS, 0.04), rbox(2.35, 2.3, 4.0, 0, 1.75, -0.6, "#2f8a4a", 0.25),
    rbox(2.3, 2.1, 1.3, 0, 1.6, -3.1, "#27733d", 0.35), rbox(2.37, 0.18, 4.0, 0, 1.0, -0.6, "#f2a21a", 0.04),
    rbox(1.4, 0.4, 1.8, 0, 0.45, -0.2, "#2b2d30", 0.05), ...wheelPair(2.3, 2.4, 0.48), ...wheelPair(2.3, -1.8, 0.48, true),
  ]);
}
/** 레미콘: 8.6 m mixer, three axles, a banded drum tilted up to the rear. */
function mixerGeometry() {
  const prof = [[0, -2.3], [0.45, -2.25], [1.05, -1.6], [1.2, -0.6], [1.15, 0.6], [0.8, 1.6], [0.35, 2.1], [0, 2.15]].map(([r, y]) => new THREE.Vector2(r, y));
  const drum = new THREE.LatheGeometry(prof, 20);
  const d = drum.toNonIndexed(); drum.dispose();
  d.deleteAttribute("uv");
  // Bands in the drum's paint, the way its spiral blades read from outside.
  const pos = d.getAttribute("position"), col = new Float32Array(pos.count * 3), a = new THREE.Color("#e9e9e4"), b = new THREE.Color("#d8661e");
  for (let i = 0; i < pos.count; i++) { const c = Math.floor((pos.getY(i) + 3) / 0.7) % 2 ? a : b; col.set([c.r, c.g, c.b], i * 3); }
  d.setAttribute("color", new THREE.BufferAttribute(col, 3));
  d.computeVertexNormals();
  d.rotateX(Math.PI / 2 - 0.2); d.translate(0, 2.3, -1.1);
  return assemble([
    rbox(2.35, 2.0, 1.9, 0, 1.6, 3.2, "#f0f0ec", 0.2), paint(new THREE.BoxGeometry(2.2, 0.8, 0.05).translate(0, 2.0, 4.16), GLASS),
    rbox(2.39, 0.5, 1.7, 0, 2.05, 2.95, GLASS, 0.04), rbox(1.3, 0.35, 6.2, 0, 0.95, -0.9, "#2b2d30", 0.05), d,
    rbox(1.4, 0.3, 0.7, 0, 2.35, -3.4, "#9a9ea4", 0.08), ...wheelPair(2.35, 3.1, 0.5), ...wheelPair(2.35, -1.6, 0.5, true), ...wheelPair(2.35, -2.95, 0.5, true),
  ]);
}

/* More of what Korean roads carry (twenty kinds, same plain style): construction plant — dump
 * trucks, a wheeled excavator driving to its site, a crawler excavator on a low-bed, cargo and
 * mobile cranes, a concrete pump — goods vehicles, the moving-company ladder truck, a tow
 * truck, a street sweeper, village, coach and double-deck buses, a delivery scooter. */
/** A cab-over cab: front face at zFront, the windscreen and a glazing band round it. */
const cabOver = (W: number, H: number, L: number, zFront: number, color: string, y0 = 0.6) => [
  rbox(W, H, L, 0, y0 + H / 2, zFront - L / 2, color, 0.16),
  paint(new THREE.BoxGeometry(W - 0.16, H * 0.4, 0.05).translate(0, y0 + H * 0.7, zFront + 0.005), GLASS),
  rbox(W + 0.03, H * 0.32, L * 0.62, 0, y0 + H * 0.7, zFront - L * 0.36, GLASS, 0.03),
  rbox(W - 0.2, 0.3, 0.22, 0, y0 + 0.05, zFront, "#2a2d31", 0.06),
];
const chassis = (L: number, z = 0, y = 0.95) => rbox(1.2, 0.38, L, 0, y, z, "#2b2d30", 0.05);
/** 25 t 덤프트럭: three axles, a deep body with the cab guard over the roof. */
function dumpGeometry(body: string, cab: string) {
  return assemble([
    ...cabOver(2.45, 2.1, 2.0, 4.75, cab, 0.75), chassis(8.6, -0.3),
    rbox(2.5, 1.55, 5.7, 0, 2.3, -1.85, body, 0.06), rbox(2.54, 0.12, 5.7, 0, 3.1, -1.85, "#3b3e42", 0.03),
    rbox(2.5, 0.1, 0.95, 0, 3.12, 1.3, body, 0.03),
    ...wheelPair(2.45, 3.6, 0.52), ...wheelPair(2.45, 2.25, 0.52), ...wheelPair(2.45, -1.9, 0.52, true), ...wheelPair(2.45, -3.25, 0.52, true),
  ]);
}
/** 2.5 t 소형 덤프: a cargo truck's cab, a steel tipping bed. */
function smallDumpGeometry() {
  return assemble([
    ...cabOver(1.95, 1.6, 1.7, 2.95, "#f2f2f0", 0.6), chassis(5.4, -0.2, 0.75),
    rbox(2.0, 0.85, 3.5, 0, 1.4, -1.1, "#4f6f96", 0.05), rbox(2.02, 0.08, 3.5, 0, 1.86, -1.1, "#30343a", 0.02),
    ...wheelPair(1.95, 2.0, 0.4), ...wheelPair(1.95, -1.6, 0.4, true),
  ]);
}
/** 타이어식 굴착기: on the road between sites — blade at the front, the boom folded forward. */
function excavatorGeometry() {
  const Y = "#f2b705", D = "#2b2d30";
  const boom = paint(new THREE.BoxGeometry(0.5, 0.6, 4.2).translate(0, 0, 2.1).rotateX(-0.42).translate(0.35, 2.3, 0.2), Y);
  const stick = paint(new THREE.BoxGeometry(0.4, 0.45, 2.4).translate(0, 0, 1.2).rotateX(1.15).translate(0.35, 3.95, 3.95), Y);
  return assemble([
    rbox(2.45, 0.55, 4.4, 0, 0.95, 0, D, 0.05), rbox(2.5, 0.55, 0.16, 0, 0.55, 2.55, Y, 0.03),
    rbox(2.45, 1.05, 2.9, 0, 1.75, -0.6, Y, 0.12), rbox(2.45, 0.85, 0.6, 0, 1.65, -2.15, "#3a3c40", 0.15),
    rbox(0.95, 1.55, 1.45, -0.72, 2.95, 0.4, Y, 0.1), rbox(0.97, 0.75, 1.47, -0.72, 3.2, 0.4, GLASS, 0.03),
    boom, stick, rbox(1.0, 0.75, 0.8, 0.35, 1.25, 4.15, "#3a3c40", 0.12),
    ...wheelPair(2.45, 1.3, 0.5, true), ...wheelPair(2.45, -1.3, 0.5, true),
  ]);
}
/** 로베드 트레일러: a tractor and a low deck carrying a crawler excavator, boom folded back. */
function lowbedGeometry() {
  const Y = "#f39800";
  const boom = paint(new THREE.BoxGeometry(0.5, 0.6, 4.6).translate(0, 0, -2.3).rotateX(-0.25).translate(0.35, 2.9, -0.4), Y);
  return assemble([
    ...cabOver(2.5, 2.2, 2.3, 8.5, "#e9ebec", 0.85), chassis(4.0, 6.5),
    rbox(2.6, 0.3, 11.0, 0, 0.75, -2.5, "#30343a", 0.03), rbox(2.6, 0.4, 1.4, 0, 1.15, 4.4, "#30343a", 0.04),
    rbox(0.6, 0.8, 3.6, -0.95, 1.3, -1.0, "#232427", 0.25), rbox(0.6, 0.8, 3.6, 0.95, 1.3, -1.0, "#232427", 0.25),
    rbox(2.4, 0.95, 2.7, 0, 2.2, -1.0, Y, 0.12), rbox(0.9, 1.3, 1.3, -0.7, 3.25, -0.2, Y, 0.1), rbox(0.92, 0.65, 1.32, -0.7, 3.45, -0.2, GLASS, 0.03),
    boom, rbox(0.9, 0.7, 0.8, 0.35, 1.5, -5.1, "#3a3c40", 0.12),
    ...wheelPair(2.5, 7.2, 0.52), ...wheelPair(2.5, 5.4, 0.52, true), ...wheelPair(2.6, -6.2, 0.4, true), ...wheelPair(2.6, -7.2, 0.4, true),
  ]);
}
/** 카고크레인: a 5 t cargo truck, the knuckle crane behind the cab, its boom laid over the bed. */
function cargoCraneGeometry() {
  const C = "#e8c21a";
  return assemble([
    ...cabOver(2.35, 1.95, 1.9, 4.2, "#2d5fa8", 0.7), chassis(7.8, -0.2),
    rbox(0.65, 1.7, 0.65, 0, 2.15, 1.85, C, 0.08), rbox(0.45, 0.45, 5.2, 0.35, 2.85, -0.9, C, 0.06),
    rbox(2.4, 0.12, 5.0, 0, 1.2, -1.55, "#8d9196", 0.02),
    rbox(0.06, 0.5, 5.0, -1.18, 1.5, -1.55, "#b9bdc2", 0.01), rbox(0.06, 0.5, 5.0, 1.18, 1.5, -1.55, "#b9bdc2", 0.01),
    ...wheelPair(2.35, 3.1, 0.48), ...wheelPair(2.35, -1.7, 0.48, true), ...wheelPair(2.35, -2.95, 0.48, true),
  ]);
}
/** 하이드로 크레인: four axles, a small cab beside the deck, the telescopic boom over it all. */
function mobileCraneGeometry() {
  const C = "#f2c400";
  return assemble([
    rbox(2.75, 1.1, 12.2, 0, 1.4, 0, "#dcdddf", 0.1), rbox(0.95, 1.45, 1.8, -0.88, 2.65, 5.0, C, 0.12), rbox(0.97, 0.7, 1.82, -0.88, 2.9, 5.0, GLASS, 0.03),
    rbox(2.5, 1.2, 3.0, 0, 2.55, -3.5, C, 0.1), rbox(0.85, 1.2, 1.4, -0.85, 3.5, -2.5, C, 0.08),
    rbox(0.8, 0.8, 11.0, 0.35, 3.05, 1.2, C, 0.06), rbox(0.6, 0.6, 1.0, 0.35, 3.05, 6.6, "#3a3c40", 0.05),
    ...wheelPair(2.75, 4.6, 0.62), ...wheelPair(2.75, 3.0, 0.62), ...wheelPair(2.75, -1.9, 0.62), ...wheelPair(2.75, -3.5, 0.62),
  ]);
}
/** 콘크리트 펌프카: four axles, the boom folded in three on top. */
function pumpGeometry() {
  const O = "#ea6a1a", W = "#f0f0ec";
  return assemble([
    ...cabOver(2.45, 2.0, 2.0, 5.95, W, 0.75), chassis(10.5, -0.5),
    rbox(1.8, 1.0, 1.6, 0, 1.85, -3.6, O, 0.1), rbox(2.5, 0.35, 8.0, 0, 1.4, -0.9, "#55585c", 0.04),
    rbox(0.45, 0.5, 9.0, 0, 2.65, -0.5, O, 0.05), rbox(0.42, 0.45, 8.4, 0, 3.12, -0.3, W, 0.05), rbox(0.38, 0.42, 7.6, 0, 3.55, 0.0, O, 0.05),
    ...wheelPair(2.45, 4.6, 0.52), ...wheelPair(2.45, 3.2, 0.52), ...wheelPair(2.45, -2.5, 0.52, true), ...wheelPair(2.45, -3.85, 0.52, true),
  ]);
}
/** 이삿짐 사다리차: a 1 t truck, the long ladder laid over the cab. */
function ladderGeometry() {
  const list = [
    ...cabOver(1.78, 1.35, 1.6, 2.6, "#2d5fa8", 0.55), chassis(5.0, -0.6, 0.65),
    rbox(1.8, 0.12, 3.0, 0, 0.85, -1.7, "#8d9196", 0.02), rbox(1.0, 0.55, 1.0, 0, 1.2, -2.4, "#e3e4e2", 0.08),
    rbox(0.5, 0.75, 0.1, 0, 1.95, 1.2, "#c9ccd0", 0.02),
    rbox(0.07, 0.14, 7.4, -0.32, 2.35, -0.25, "#d9dbde", 0.02), rbox(0.07, 0.14, 7.4, 0.32, 2.35, -0.25, "#d9dbde", 0.02),
    ...wheelPair(1.78, 1.7, 0.36), ...wheelPair(1.78, -1.6, 0.36, true),
  ];
  for (let z = -3.7; z <= 3.3; z += 0.7) list.push(rbox(0.6, 0.05, 0.06, 0, 2.35, z, "#c9ccd0", 0.01));
  return assemble(list);
}
/** 탱크로리: tractor and a polished tank trailer. */
function tankerGeometry() {
  const tank = paint(new THREE.CylinderGeometry(1.12, 1.12, 9.6, 18).rotateX(Math.PI / 2).translate(0, 2.25, -1.7), "#cfd3d8");
  return assemble([
    ...cabOver(2.48, 2.2, 2.3, 6.5, "#f4f4f2", 0.85), chassis(4.0, 4.6), rbox(1.2, 0.3, 11.0, 0, 0.95, -1.5, "#2b2d30", 0.04), tank,
    rbox(2.0, 0.1, 6.0, 0, 3.4, -1.7, "#9a9ea4", 0.02),
    ...wheelPair(2.48, 5.3, 0.52), ...wheelPair(2.48, 3.8, 0.52, true), ...wheelPair(2.48, -4.6, 0.52, true), ...wheelPair(2.48, -5.8, 0.52, true),
  ]);
}
/** 5톤 윙바디: an aluminium van body whose sides open as wings (closed on the road). */
function wingGeometry(cab: string) {
  return assemble([
    ...cabOver(2.45, 2.1, 2.0, 4.75, cab, 0.75), chassis(8.8, -0.3),
    rbox(2.5, 2.6, 6.9, 0, 2.45, -1.25, "#c9ccd0", 0.05), rbox(2.53, 0.08, 6.9, 0, 3.72, -1.25, "#8a8f96", 0.02),
    ...wheelPair(2.45, 3.6, 0.5), ...wheelPair(2.45, -2.3, 0.5, true), ...wheelPair(2.45, -3.6, 0.5, true),
  ]);
}
/** 1톤 탑차: the Porter-style cab and a box; a refrigerated one has its cooling unit up front. */
function boxTruckGeometry(cab: string, box: string, cooled: boolean) {
  const list = [
    ...cabOver(1.75, 1.35, 1.6, 2.65, cab, 0.55), chassis(5.0, -0.2, 0.65),
    rbox(1.86, 1.9, 3.25, 0, 1.75, -0.95, box, 0.06),
    ...wheelPair(1.75, 1.75, 0.36), ...wheelPair(1.75, -1.55, 0.36, true),
  ];
  if (cooled) list.push(rbox(1.2, 0.36, 0.55, 0, 2.86, 0.4, "#d6d8da", 0.06));
  return assemble(list);
}
/** 견인차 (렉카): a 2.5 t cab, the lifting boom and wheel lift at the back, an amber bar. */
function towGeometry() {
  return assemble([
    ...cabOver(1.95, 1.55, 1.8, 3.1, "#f0f0ee", 0.6), chassis(5.6, -0.3, 0.7),
    rbox(1.95, 0.3, 3.0, 0, 0.95, -0.8, "#2b2d30", 0.04),
    paint(new THREE.BoxGeometry(0.3, 0.3, 2.6).rotateX(0.35).translate(0, 1.6, -1.6), "#f2c400"),
    rbox(1.6, 0.15, 0.45, 0, 0.42, -3.05, "#f2c400", 0.03), rbox(1.2, 0.12, 0.25, 0, 2.27, 2.4, "#f29f05", 0.04),
    ...wheelPair(1.95, 2.05, 0.4), ...wheelPair(1.95, -1.55, 0.4, true),
  ]);
}
/** 노면 청소차: compact cab-over, a hopper body, side brushes under the front. */
function sweeperGeometry() {
  const brush = (x: number) => paint(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 12).translate(x, 0.06, 1.7), "#56595e");
  return assemble([
    ...cabOver(2.1, 1.75, 1.6, 3.2, "#f2f2f0", 0.55), chassis(5.4, -0.4, 0.7),
    rbox(2.15, 1.9, 3.3, 0, 1.6, -0.9, "#f29a2e", 0.2), rbox(2.17, 0.15, 3.3, 0, 1.0, -0.9, "#2f8a4a", 0.03),
    brush(-0.75), brush(0.75), ...wheelPair(2.1, 2.2, 0.45), ...wheelPair(2.1, -1.8, 0.45, true),
  ]);
}
/** Buses by size: 마을버스 (short, green), 관광·고속 (high deck), 광역 2층. */
function busBox(L: number, W: number, H: number, body: string, bands: number[], roof: string, axles: number[]) {
  return boxes([
    [W, H, L, 0, H / 2 + 0.35, 0, body], ...bands.map(y => [W + 0.02, 0.95, L - 0.8, 0, y, -0.1, "#20303c"] as [number, number, number, number, number, number, string]),
    [W + 0.02, H * 0.45, 0.06, 0, H * 0.62 + 0.35, L / 2, "#20303c"], [W - 0.08, 0.22, L - 0.2, 0, H + 0.46, 0, roof], ...wheels(W, axles),
  ]);
}
/** 배달 오토바이: a scooter with its delivery box, and its rider in a helmet. */
function scooterGeometry() {
  return assemble([
    rbox(0.32, 0.45, 1.3, 0, 0.62, 0, "#eceef0", 0.12), rbox(0.3, 0.1, 0.62, 0, 0.92, -0.15, "#1e1f22", 0.04),
    rbox(0.46, 0.44, 0.46, 0, 1.12, -0.6, "#d8262b", 0.05), rbox(0.68, 0.05, 0.05, 0, 1.12, 0.52, "#1e1f22", 0.02),
    rbox(0.38, 0.58, 0.27, 0, 1.3, -0.08, "#26303e", 0.1), rbox(0.3, 0.32, 0.5, 0, 0.98, 0.12, "#2e3238", 0.08),
    rbox(0.1, 0.36, 0.1, -0.17, 1.28, 0.22, "#26303e", 0.04), rbox(0.1, 0.36, 0.1, 0.17, 1.28, 0.22, "#26303e", 0.04),
    paint(new THREE.SphereGeometry(0.15, 10, 8).translate(0, 1.76, -0.04), "#f2f2f0"),
    paint(new THREE.CylinderGeometry(0.27, 0.27, 0.12, 14).rotateZ(Math.PI / 2).translate(0, 0.27, 0.62), TYRE),
    paint(new THREE.CylinderGeometry(0.27, 0.27, 0.12, 14).rotateZ(Math.PI / 2).translate(0, 0.27, -0.62), TYRE),
  ]);
}


/** Every boxed vehicle by name (sceneStreet's kinds take them from here). */
export const PROCEDURAL: [string, () => THREE.BufferGeometry][] = [
  ["cargo-blue", () => cargoGeometry("#2d5fa8")], ["cargo-white", () => cargoGeometry("#e9e9e6")],
  ["bus-blue", () => busGeometry("#2a6fc4")], ["bus-green", () => busGeometry("#3b9a44")], ["bus-red", () => busGeometry("#c8322f")],
  ["container-red", () => containerGeometry("#b2402f")], ["container-blue", () => containerGeometry("#2e5e8c")], ["container-orange", () => containerGeometry("#c77a2a")],
  ["ambulance", ambulanceGeometry], ["police", policeGeometry], ["fire", fireGeometry], ["garbage", garbageGeometry], ["mixer", mixerGeometry],
  ["dump-orange", () => dumpGeometry("#d4521f", "#eceef0")], ["dump-yellow", () => dumpGeometry("#e3b21c", "#2d5fa8")], ["dump-small", smallDumpGeometry],
  ["excavator", excavatorGeometry], ["lowbed", lowbedGeometry], ["cargo-crane", cargoCraneGeometry], ["mobile-crane", mobileCraneGeometry], ["pump", pumpGeometry],
  ["wing", () => wingGeometry("#eef0f2")], ["tanker", tankerGeometry],
  ["box-cooled", () => boxTruckGeometry("#2d5fa8", "#f4f4f2", true)], ["box-dry", () => boxTruckGeometry("#e9e9e6", "#c9ccd0", false)],
  ["ladder", ladderGeometry], ["tow", towGeometry], ["sweeper", sweeperGeometry],
  ["bus-village", () => busBox(8.9, 2.3, 2.6, "#3b9a44", [2.05], "#f1f1ee", [2.6, -2.6])],
  ["bus-coach", () => busBox(12, 2.5, 3.1, "#f3f3f1", [2.7], "#e9e9e6", [4.2, -3.0, -4.2])],
  ["bus-double", () => busBox(12, 2.5, 3.7, "#c8322f", [1.85, 3.3], "#f1f1ee", [4.2, -3.1, -4.3])],
  ["scooter", scooterGeometry],
];
