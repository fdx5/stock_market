import * as THREE from "three";
import { mergeGeometries, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { chassis, GLASS, paint, rbox } from "./vehicleShapes";

/* The two vehicles a reader can follow (and, later, drive): a 쿠팡 로켓배송 1-ton truck and a
 * Tesla Cybertruck. Modelled to their real proportions — x across, y up, z forward (front +z),
 * wheels on the ground, as the traffic's other shapes — and in more detail than the rest of the
 * traffic. Each is one geometry in two groups: the vertex-coloured parts (the traffic's box
 * material) and its own surface (the truck's livery, the Cybertruck's stainless steel). */

export type HeroName = "coupang" | "cyber";

const withUv = (g: THREE.BufferGeometry) => {
  const n = g.getAttribute("position").count;
  // (normals made again after the merge: every part the same attributes)
  g.deleteAttribute("normal");
  if (!g.getAttribute("uv")) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
};
const whiten = (g: THREE.BufferGeometry) => {
  const n = g.getAttribute("position").count;
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return g;
};
/** Two groups: [0] vertex colours, [1] the vehicle's own material. */
function twoGroups(painted: THREE.BufferGeometry[], own: THREE.BufferGeometry[]) {
  const a = mergeGeometries(painted.map(g => withUv(g.index ? g.toNonIndexed() : g)), false)!;
  const b = mergeGeometries(own.map(g => withUv(whiten(g.index ? g.toNonIndexed() : g))), false)!;
  painted.forEach(g => g.dispose()); own.forEach(g => g.dispose());
  const out = mergeGeometries([a, b], true)!;
  a.dispose(); b.dispose();
  out.groups[0].materialIndex = 0; out.groups[1].materialIndex = 1;
  // (rounded panels smooth, real edges sharp)
  const creased = toCreasedNormals(out, (38 * Math.PI) / 180);
  if (creased !== out) out.dispose();
  return creased;
}

/** The 로켓배송 box's side: white, the multicoloured wordmark, 로켓배송 with its rocket. */
function coupangLivery() {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 576;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f8f8f6"; g.fillRect(0, 0, c.width, c.height);
  const font = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  // the wordmark, letter by letter in its colours
  const word = "coupang", colours = ["#8c2a1d", "#e3382a", "#f3a51d", "#7db53a", "#2a97d5", "#1c63b0", "#8c2a1d"];
  g.font = `800 190px ${font}`; g.textBaseline = "alphabetic";
  const widths = [...word].map(ch => g.measureText(ch).width), total = widths.reduce((a, b) => a + b, 0) - 12 * (word.length - 1);
  let x = (c.width - total) / 2;
  [...word].forEach((ch, i) => { g.fillStyle = colours[i]; g.fillText(ch, x, 270); x += widths[i] - 12; });
  // 로켓배송 and the rocket
  g.font = `900 112px ${font}`;
  const label = "로켓배송", lw = g.measureText(label).width, rocketW = 120, gap = 26;
  const lx = (c.width - (lw + gap + rocketW)) / 2;
  g.fillStyle = "#1e4fb5"; g.fillText(label, lx + rocketW + gap, 455);
  g.save(); g.translate(lx + rocketW / 2, 410); g.rotate(-Math.PI / 4);
  g.fillStyle = "#1e4fb5";
  g.beginPath(); g.moveTo(0, -58); g.quadraticCurveTo(26, -30, 22, 22); g.lineTo(-22, 22); g.quadraticCurveTo(-26, -30, 0, -58); g.fill();
  g.beginPath(); g.moveTo(-22, 2); g.lineTo(-40, 34); g.lineTo(-20, 26); g.fill();
  g.beginPath(); g.moveTo(22, 2); g.lineTo(40, 34); g.lineTo(20, 26); g.fill();
  g.fillStyle = "#f8f8f6"; g.beginPath(); g.arc(0, -18, 9, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#f3a51d"; g.beginPath(); g.moveTo(-14, 26); g.lineTo(0, 58); g.lineTo(14, 26); g.fill();
  g.restore();
  // a thin band in the brand blue along the foot of the box
  g.fillStyle = "#1e4fb5"; g.fillRect(0, c.height - 34, c.width, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

const TYRE = "#17181a", STEEL = "#c4c8cc", DARK = "#232528", CLAD = "#2b2d30", LAMP = "#eef3f8", AMBER = "#f0a020", RED = "#c21f25";
const box = (w: number, h: number, l: number, x: number, y: number, z: number, color: string) => paint(new THREE.BoxGeometry(w, h, l).translate(x, y, z), color);
export interface WheelAt { x: number; z: number; side: -1 | 1; inner?: boolean }
export interface HeroShape {
  geometry: THREE.BufferGeometry; material: THREE.Material; dims: [number, number, number];
  /** One wheel (vertex colours) about its own axle — x through it, its outer face toward +x —
   * the wheels' places on the vehicle, and the rolling radius. */
  wheel: THREE.BufferGeometry; wheels: WheelAt[]; radius: number;
  /** Its own head (white) and tail (red) lamps, where the model has them (x across, y up, z
   * forward; w x h): lit at night in place of the traffic's generic pair at the corners. */
  lamps: { x: number; y: number; z: number; w: number; h: number; red: boolean }[];
  /** The number plates: plateGeometry(L, front height, rear height, front out, rear out). */
  plate: [number, number, number, number, number];
}

/** A wheel in detail, turned on a lathe: the tyre with rounded shoulders, a tread band and its
 * grooves, the sidewall; behind the rim a brake disc. "steel": the Porter's pressed steel wheel —
 * dished, five vent holes, hub and wheel nuts. "aero": the Cybertruck's flat cover in six
 * segments round a dark hub (the segments show it turning). Axle along x, outer face +x. */
export function heroWheel(kind: "steel" | "aero", r: number, w: number) {
  const parts: THREE.BufferGeometry[] = [];
  // (lathe profiles are (radius, y); turned about y, then laid on their side: y -> x)
  const lathe = (pts: [number, number][], color: string, seg = 48) =>
    paint(new THREE.LatheGeometry(pts.map(([rr, y]) => new THREE.Vector2(rr, y)), seg).rotateZ(-Math.PI / 2), color);
  const rIn = r * 0.66, h = w / 2, sh = Math.min(0.05, w * 0.18);
  // tyre: inner bead -> sidewall -> shoulder -> tread -> shoulder -> sidewall -> bead
  parts.push(lathe([[rIn, -h + 0.01], [r - sh, -h], [r - 0.012, -h + sh * 0.35], [r, -h + sh], [r, h - sh], [r - 0.012, h - sh * 0.35], [r - sh, h], [rIn, h - 0.01]], TYRE, 56));
  // the tread's grooves round the crown
  for (const y of [-h * 0.45, 0, h * 0.45]) parts.push(lathe([[r + 0.002, y - 0.008], [r + 0.002, y + 0.008]], "#0c0d0e", 56));
  // the sidewall's lettering band, a shade lighter
  parts.push(lathe([[r * 0.8, h + 0.001], [r * 0.9, h + 0.001]], "#26282b", 56));
  // brake disc behind the rim
  parts.push(paint(new THREE.CylinderGeometry(rIn * 0.85, rIn * 0.85, 0.02, 32).rotateZ(Math.PI / 2).translate(-h * 0.2, 0, 0), "#6e7276"));
  if (kind === "steel") {
    const rim = "#e9ebec";
    // dished face: rim lip, the slope in, the flat centre
    parts.push(lathe([[rIn, -h + 0.02], [rIn, h * 0.55], [rIn * 0.98, h * 0.62], [rIn * 0.7, h * 0.48], [rIn * 0.42, h * 0.62], [0, h * 0.62]], rim, 40));
    // five vent holes in the slope (dark), between them the rim's ribs
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3, rr = rIn * 0.6;
      parts.push(paint(new THREE.CylinderGeometry(rIn * 0.13, rIn * 0.13, 0.012, 16).rotateZ(Math.PI / 2).translate(h * 0.56, Math.sin(a) * rr, Math.cos(a) * rr), "#1c1e20"));
    }
    // hub and five wheel nuts
    parts.push(paint(new THREE.CylinderGeometry(rIn * 0.24, rIn * 0.28, 0.07, 20).rotateZ(Math.PI / 2).translate(h * 0.66, 0, 0), "#b9bdc1"));
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2, rr = rIn * 0.36;
      parts.push(paint(new THREE.CylinderGeometry(0.016, 0.016, 0.035, 6).rotateZ(Math.PI / 2).translate(h * 0.66, Math.sin(a) * rr, Math.cos(a) * rr), "#4c5054"));
    }
  } else {
    // the aero cover: a shallow cone in six segments, alternating shades, round a dark hub
    for (let k = 0; k < 6; k++) {
      const a0 = (k / 6) * Math.PI * 2, a1 = ((k + 1) / 6) * Math.PI * 2;
      const seg = new THREE.LatheGeometry([new THREE.Vector2(r * 0.8, h * 0.5), new THREE.Vector2(rIn * 0.25, h * 0.62)], 10, a0, a1 - a0).rotateZ(-Math.PI / 2);
      parts.push(paint(seg, k % 2 ? "#8a8e93" : "#62666b"));
    }
    parts.push(lathe([[r * 0.8, h * 0.48], [r * 0.82, h * 0.2], [rIn, -h + 0.02]], "#3d4044", 48));
    parts.push(paint(new THREE.CylinderGeometry(rIn * 0.25, rIn * 0.25, 0.03, 24).rotateZ(Math.PI / 2).translate(h * 0.64, 0, 0), "#232528"));
    parts.push(paint(new THREE.CylinderGeometry(rIn * 0.09, rIn * 0.09, 0.034, 16).rotateZ(Math.PI / 2).translate(h * 0.65, 0, 0), "#b9bdc1"));
  }
  const merged = mergeGeometries(parts.map(g => { g.deleteAttribute("uv"); g.deleteAttribute("normal"); return g.index ? g.toNonIndexed() : g; }), false)!;
  parts.forEach(g => g.dispose());
  const out = toCreasedNormals(merged, (35 * Math.PI) / 180);
  if (out !== merged) merged.dispose();
  out.computeBoundingSphere();
  return out;
}
const sides = [-1, 1] as const;

/** A box truck's rear: the frame round the opening and two doors hinged at the outer edges. */
function rearDoors(BW: number, BH: number, by: number, rearZ: number) {
  const out: THREE.BufferGeometry[] = [];
  const frame = 0.07, gap = 0.012, leafW = (BW - 2 * frame - gap) / 2, leafH = BH - 2 * frame - 0.02, z = rearZ - 0.012;
  // frame: header, sill and the two posts
  out.push(box(BW + 0.02, frame, 0.05, 0, by + BH / 2 - frame / 2, rearZ - 0.01, STEEL));
  out.push(box(BW + 0.02, frame + 0.03, 0.06, 0, by - BH / 2 + frame / 2, rearZ - 0.01, STEEL));
  for (const s of sides) out.push(box(frame, BH, 0.05, s * (BW / 2 - frame / 2), by, rearZ - 0.01, STEEL));
  for (const s of sides) {
    const cx = s * (gap / 2 + leafW / 2);
    // the leaf, raised a little proud of the frame, its seal round the edge
    out.push(rbox(leafW, leafH, 0.04, cx, by, z - 0.02, "#f2f2f0", 0.012));
    out.push(box(leafW + 0.02, 0.018, 0.02, cx, by + leafH / 2 + 0.006, z - 0.004, DARK));
    out.push(box(leafW + 0.02, 0.018, 0.02, cx, by - leafH / 2 - 0.006, z - 0.004, DARK));
    out.push(box(0.018, leafH, 0.02, s * (gap / 2 + 0.006), by, z - 0.004, DARK));
    // two lock bars a leaf, their cams in keepers on the header and sill, a handle on each
    for (const f of [0.28, 0.72]) {
      const x = s * (gap / 2 + leafW * f);
      out.push(paint(new THREE.CylinderGeometry(0.018, 0.018, leafH + 0.06, 10).translate(x, by, z - 0.065), STEEL));
      for (const end of [1, -1]) out.push(box(0.07, 0.06, 0.05, x, by + end * (leafH / 2 + 0.02), z - 0.06, "#9da2a7"));
      out.push(box(0.03, 0.04, 0.05, x, by - 0.22, z - 0.07, "#9da2a7"));
      out.push(rbox(0.03, 0.26, 0.04, x + s * 0.045, by - 0.32, z - 0.095, DARK, 0.012));
    }
    // three hinges along the outer edge
    for (const dy of [0.62, 0, -0.62]) out.push(box(0.12, 0.08, 0.035, s * (BW / 2 - frame - 0.02), by + dy, z - 0.055, DARK));
  }
  return out;
}

/** Brushed stainless as a roughness map (green): fine streaks along u (the body's length on its
 * sides), a few broader bands; tiled. Mean ~0.7, so with the material's roughness ~0.3. */
function brushedSteel() {
  const N = 512, c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgb(178,178,178)"; g.fillRect(0, 0, N, N);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    const y = rnd() * N, v = 150 + rnd() * 60, a = 0.12 + rnd() * 0.25;
    g.fillStyle = `rgba(${v},${v},${v},${a})`;
    const x = rnd() * N, len = N * (0.2 + rnd() * 0.8);
    g.fillRect(x, y, len, 1); if (x + len > N) g.fillRect(x - N, y, len, 1);
  }
  for (let i = 0; i < 6; i++) {
    const v = 160 + rnd() * 40;
    g.fillStyle = `rgba(${v},${v},${v},0.18)`; g.fillRect(0, rnd() * N, N, 6 + rnd() * 30);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(0.6, 1.6); t.anisotropy = 8;
  return t;
}

/** 쿠팡 로켓배송 탑차: a Porter-type cab-over 1-ton truck, all white, its aluminium box in the
 * livery — cab glazing, lamps, grille, bumper, mirrors, wipers and steps; the box's corner posts
 * and rails, rear doors with lock bars, tail lamps, side guards, mud flaps; dual rear wheels. */
export function coupangTruck(geometryOnly = false): HeroShape {
  const W = 1.75, cabF = 2.65, cabL = 1.62, white = "#f6f6f4";
  const zc = cabF - cabL / 2, by = 1.75, bz = -0.95, BL = 3.25, BW = 1.86, BH = 1.9, rearZ = bz - BL / 2;
  const painted: THREE.BufferGeometry[] = [
    // cab: body, roof cap, the slightly raked windscreen, door windows, door seams, steps
    rbox(W, 1.36, cabL, 0, 1.23, zc, white, 0.15),
    rbox(W - 0.1, 0.06, cabL - 0.2, 0, 1.93, zc - 0.05, "#e9e9e7", 0.03),
    paint(new THREE.BoxGeometry(W - 0.2, 0.62, 0.04).rotateX(-0.12).translate(0, 1.56, cabF + 0.01), GLASS),
    ...sides.map(s => rbox(0.03, 0.5, 0.82, s * (W / 2 + 0.004), 1.6, zc + 0.12, GLASS, 0.01)),
    ...sides.map(s => box(0.012, 0.86, 0.02, s * (W / 2 + 0.006), 1.42, zc - 0.45, DARK)),
    ...sides.map(s => box(0.012, 0.02, 0.7, s * (W / 2 + 0.006), 1.0, zc + 0.05, DARK)),
    ...sides.map(s => rbox(0.28, 0.05, 0.42, s * (W / 2 - 0.08), 0.5, zc + 0.15, DARK, 0.02)),
    // front: grille slot, headlamps and turn lamps, bumper with fog lamps, wipers
    rbox(1.2, 0.16, 0.04, 0, 0.98, cabF + 0.01, "#2f3236", 0.02),
    ...sides.flatMap(s => [rbox(0.34, 0.17, 0.05, s * 0.6, 1.02, cabF + 0.01, LAMP, 0.03), rbox(0.1, 0.12, 0.05, s * 0.83, 1.02, cabF, AMBER, 0.02)]),
    rbox(W + 0.06, 0.22, 0.24, 0, 0.68, cabF + 0.02, "#2a2c2f", 0.05),
    ...sides.map(s => rbox(0.12, 0.07, 0.03, s * 0.66, 0.68, cabF + 0.15, LAMP, 0.02)),
    ...sides.map(s => box(0.62, 0.02, 0.02, s * 0.33, 1.3, cabF + 0.04, DARK)),
    // arm mirrors
    ...sides.flatMap(s => [box(0.22, 0.03, 0.03, s * (W / 2 + 0.1), 1.62, cabF - 0.25, DARK), rbox(0.07, 0.34, 0.18, s * (W / 2 + 0.22), 1.55, cabF - 0.25, DARK, 0.03)]),
    // chassis, fuel tank, the box with its aluminium frame
    chassis(5.0, -0.2, 0.65),
    rbox(0.34, 0.32, 0.62, -0.58, 0.55, 0.3, "#3a3d41", 0.08),
    rbox(BW, BH, BL, 0, by, bz, "#f7f7f5", 0.04),
    ...[[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sz]) => box(0.07, BH + 0.03, 0.07, sx * (BW / 2), by, bz + sz * (BL / 2), STEEL)),
    ...sides.flatMap(s => [box(0.05, 0.07, BL + 0.02, s * (BW / 2 + 0.005), by + BH / 2, bz, STEEL), box(0.05, 0.09, BL + 0.02, s * (BW / 2 + 0.005), by - BH / 2 + 0.02, bz, STEEL)]),
    box(BW + 0.02, 0.07, 0.05, 0, by + BH / 2, rearZ, STEEL), box(BW + 0.02, 0.09, 0.05, 0, by - BH / 2 + 0.02, rearZ, STEEL),
    // Rear: two swing doors (양문형) in an aluminium frame — each leaf a raised panel with its rubber
    // seal, the gap between them, two lock bars with their cams top and bottom and a handle each,
    // three hinges along the outer edge.
    ...rearDoors(BW, BH, by, rearZ),
    // rear: tail lamps, bumper bar, mud flaps; side guards
    ...sides.flatMap(s => [rbox(0.26, 0.14, 0.05, s * 0.72, 0.72, rearZ - 0.03, RED, 0.02), rbox(0.1, 0.14, 0.05, s * 0.5, 0.72, rearZ - 0.03, AMBER, 0.02)]),
    rbox(1.6, 0.1, 0.1, 0, 0.5, rearZ - 0.05, "#2a2c2f", 0.03),
    ...sides.map(s => box(0.02, 0.42, 0.32, s * 0.75, 0.42, -2.12, DARK)),
    ...sides.flatMap(s => [box(0.04, 0.07, 1.6, s * 0.86, 0.58, 0.05, STEEL), box(0.04, 0.07, 1.6, s * 0.86, 0.38, 0.05, STEEL)]),
    // (wheels: their own meshes, turned as it drives — heroWheel)
  ];
  // The livery on both sides (planes just off the box; text reads the right way).
  const side = (s: 1 | -1) => new THREE.PlaneGeometry(3.05, 1.72).rotateY(s * Math.PI / 2).translate(s * (BW / 2 + 0.006), by, bz);
  // The wordmark across the middle of both rear doors (from the livery's top band), on the
  // leaves' faces, the lock bars over it as on the real decal.
  const rw = BW - 0.2, rh = rw * (0.37 * 576) / (0.9 * 1024);
  const rear = new THREE.PlaneGeometry(rw, rh).rotateY(Math.PI).translate(0, by + 0.18, rearZ - 0.012 - 0.044);
  rear.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0.05, 0.83, 0.95, 0.83, 0.05, 0.46, 0.95, 0.46]), 2));
  // and on both cab doors, under the windows
  const word = new Float32Array([0.05, 0.83, 0.95, 0.83, 0.05, 0.46, 0.95, 0.46]);
  const cabDoor = (s: 1 | -1) => {
    const g = new THREE.PlaneGeometry(0.92, 0.92 * (0.37 * 576) / (0.9 * 1024)).rotateY(s * Math.PI / 2).translate(s * (W / 2 + 0.008), 1.13, zc + 0.08);
    g.setAttribute("uv", new THREE.BufferAttribute(word.slice(), 2));
    return g;
  };
  const geometry = twoGroups(painted, [side(1), side(-1), rear, cabDoor(1), cabDoor(-1)]);
  const material = geometryOnly ? new THREE.MeshStandardMaterial() : heroSurface("coupang");
  const wheels: WheelAt[] = sides.flatMap(sd => [
    { x: sd * (W / 2 - 0.16), z: 1.75, side: sd }, { x: sd * (W / 2 - 0.12), z: -1.55, side: sd }, { x: sd * (W / 2 - 0.38), z: -1.55, side: sd, inner: true },
  ]);
  const lamps = [
    ...sides.map(s => ({ x: s * 0.6, y: 1.02, z: cabF + 0.045, w: 0.36, h: 0.19, red: false })),
    ...sides.map(s => ({ x: s * 0.72, y: 0.72, z: rearZ - 0.065, w: 0.28, h: 0.16, red: true })),
  ];
  return { geometry, material, lamps, dims: [5.15, 1.86, 0.78], wheel: heroWheel("steel", 0.36, 0.24), radius: 0.36, wheels,
    // (plates on the bumpers: front at the bumper's face, rear hung under the tail lamps)
    plate: [5.6, 0.68, 0.62, 0.0, 0.03] };
}

/** Tesla Cybertruck: the faceted stainless body (one profile, a peak over the cabin, the nose and
 * tail chamfered), its glass (windscreen, side windows, the glass roof), door seams and the
 * window-line crease, the vault seam, the full-width light bars, mirrors, the single wiper, the
 * dark arches and cladding, aero-covered 35-inch tyres. */
export function cybertruck(geometryOnly = false): HeroShape {
  const L = 5.68, W = 2.0, front = L / 2, back = -L / 2;
  const nose = 0.98, peakU = -0.35, peak = 1.79, tail = 1.33, floor = 0.42;
  // Side profile (u forward, v up), extruded across the width with a small bevel.
  const profile = new THREE.Shape([
    new THREE.Vector2(front - 0.08, floor), new THREE.Vector2(front, 0.6), new THREE.Vector2(front, nose - 0.04), new THREE.Vector2(front - 0.06, nose),
    new THREE.Vector2(peakU, peak), new THREE.Vector2(back + 0.04, tail), new THREE.Vector2(back, tail - 0.05), new THREE.Vector2(back, floor + 0.1), new THREE.Vector2(back + 0.12, floor),
  ]);
  const B = 0.03;
  const body = new THREE.ExtrudeGeometry(profile, { depth: W - 2 * B, bevelEnabled: true, bevelThickness: B, bevelSize: B, bevelSegments: 1 })
    .rotateY(-Math.PI / 2).translate(W / 2 - B, 0, 0);
  const roofAt = (u: number) => u >= peakU ? nose + (peak - nose) * (front - u) / (front - peakU) : peak + (tail - peak) * (peakU - u) / (peakU - back);
  const onSide = (pts: number[][], s: 1 | -1, inset: number, color: string) => {
    const shape = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(s > 0 ? -u : u, v)));
    return paint(new THREE.ShapeGeometry(shape).rotateY(s * Math.PI / 2).translate(s * (W / 2 + inset), 0, 0), color);
  };
  // Side windows following the roofline, a hand's width under it.
  const windowShape = (s: 1 | -1) => onSide([[1.28, 1.24], [1.28, roofAt(1.28) - 0.07], [peakU, peak - 0.07], [-1.6, roofAt(-1.6) - 0.07], [-1.6, 1.24]], s, 0.008, GLASS);
  // A quad on the long top slopes, from t0 to t1 of the way (front slope: nose → peak; rear: peak → tail).
  const onTop = (frontSlope: boolean, t0: number, t1: number, inset: number, color: string, lift = B + 0.012) => {
    const p = (t: number) => frontSlope ? [front + (peakU - front) * t, nose + (peak - nose) * t] : [peakU + (back - peakU) * t, peak + (tail - peak) * t];
    const [u0, v0] = p(t0), [u1, v1] = p(t1), half = W / 2 - inset;
    const g = new THREE.BufferGeometry();
    const P = frontSlope
      ? [-half, v0 + lift, u0, half, v0 + lift, u0, half, v1 + lift, u1, -half, v0 + lift, u0, half, v1 + lift, u1, -half, v1 + lift, u1]
      : [-half, v0 + lift, u0, half, v1 + lift, u1, half, v0 + lift, u0, -half, v0 + lift, u0, -half, v1 + lift, u1, half, v1 + lift, u1];
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    return paint(g, color);
  };
  // The wheel arches: the well dark, round it the angular cladding flare (dark grey textured
  // plastic, proud of the steel by ~4 cm) — the Cybertruck's trapezoid with clipped corners.
  const ARCH: [number, number][] = [[-0.68, floor - 0.02], [-0.6, 0.78], [-0.4, 0.98], [0.4, 0.98], [0.6, 0.78], [0.68, floor - 0.02]];
  const arch = (z: number, s: 1 | -1) => onSide(ARCH.map(([u, v]) => [u + z, v]), s, 0.004, "#141516");
  /** A flat shape on a side, extruded outward `depth` (holes: openings through it). */
  const onSideSolid = (pts: [number, number][], holes: [number, number][][], s: 1 | -1, inset: number, depth: number, color: string) => {
    const flip = ([u, v]: [number, number]) => new THREE.Vector2(s > 0 ? -u : u, v);
    const shape = new THREE.Shape(pts.map(flip));
    for (const h of holes) shape.holes.push(new THREE.Path(h.map(flip)));
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    g.deleteAttribute("uv");
    return paint(g.rotateY(s * Math.PI / 2).translate(s * (W / 2 + inset), 0, 0), color);
  };
  const flare = (z: number, s: 1 | -1) => {
    // (a band over the wheel, open at its foot: the outer edge up and over, the well's edge back)
    const outer: [number, number][] = [[-0.8, floor + 0.06], [-0.7, 0.84], [-0.46, 1.08], [0.46, 1.08], [0.7, 0.84], [0.8, floor + 0.06]];
    const inner: [number, number][] = [[0.67, floor + 0.06], [0.6, 0.78], [0.4, 0.98], [-0.4, 0.98], [-0.6, 0.78], [-0.67, floor + 0.06]];
    return onSideSolid([...outer, ...inner].map(([u, v]) => [u + z, v]), [], s, -0.005, 0.045, CLAD);
  };
  // Wing mirrors: on the doors at the foot of the A-pillar, a short stalk out to a squared
  // housing, glass facing back (about 2.41 m across them).
  const mirror = (s: 1 | -1) => [
    rbox(0.07, 0.035, 0.05, s * (W / 2 + 0.03), 1.2, 1.23, DARK, 0.012),
    rbox(0.17, 0.12, 0.075, s * (W / 2 + 0.12), 1.24, 1.21, DARK, 0.025),
    box(0.145, 0.095, 0.006, s * (W / 2 + 0.12), 1.24, 1.17, "#9fb1bf"),
  ];
  // Side glass: a black frit round it, the B-pillar dividing front and rear.
  const frit = (s: 1 | -1) => onSide([[1.31, 1.21], [1.31, roofAt(1.31) - 0.045], [peakU, peak - 0.045], [-1.63, roofAt(-1.63) - 0.045], [-1.63, 1.21]], s, 0.006, "#0d0e0f");
  const bPillar = (s: 1 | -1) => onSide([[-0.16, 1.22], [-0.16, peak - 0.06], [-0.22, peak - 0.065], [-0.22, 1.22]], s, 0.0095, "#0d0e0f");
  const seam = (u: number, s: 1 | -1) => onSide([[u - 0.008, 0.62], [u - 0.008, 1.23], [u + 0.008, 1.23], [u + 0.008, 0.62]], s, 0.009, DARK);
  const crease = (s: 1 | -1) => onSide([[back + 0.1, 1.215], [back + 0.1, 1.232], [front - 0.1, 1.232], [front - 0.1, 1.215]], s, 0.009, "#8d9195");
  const wiperT = 0.6;
  const painted: THREE.BufferGeometry[] = [
    frit(1), frit(-1), windowShape(1), windowShape(-1), bPillar(1), bPillar(-1),
    onTop(true, 0.52, 0.985, 0.1, GLASS),                 // windscreen
    onTop(false, 0.015, 0.36, 0.14, GLASS),               // glass roof over the rear seats
    onTop(false, 0.42, 0.425, 0.08, DARK, B + 0.014),         // the vault (bed) seam
    box(0.95, 0.02, 0.02, 0.15, nose + (peak - nose) * wiperT + B + 0.035, front + (peakU - front) * wiperT, DARK),   // the single wiper
    ...sides.flatMap(s => [seam(1.0, s), seam(-0.55, s), crease(s)]),
    // full-width light bars: white across the nose, red across the tail, turn lamps at its ends
    rbox(W - 0.06, 0.035, 0.03, 0, nose - 0.03, front + B + 0.008, LAMP, 0.01),
    rbox(W - 0.06, 0.045, 0.03, 0, tail - 0.07, back - B - 0.008, RED, 0.01),
    ...sides.map(s => rbox(0.05, 0.12, 0.03, s * (W / 2 - 0.05), tail - 0.14, back - B - 0.008, RED, 0.01)),
    // mirrors, the front skid band, dark cladding round the foot and the arches
    ...sides.flatMap(mirror),
    rbox(W - 0.1, 0.14, 0.04, 0, 0.5, front + B - 0.04, CLAD, 0.02),
    rbox(W + 0.012, 0.16, L - 0.5, 0, floor + 0.08, 0, CLAD, 0.02),
    arch(1.9, 1), arch(1.9, -1), arch(-1.9, 1), arch(-1.9, -1),
    flare(1.9, 1), flare(1.9, -1), flare(-1.9, 1), flare(-1.9, -1),
    // amber side markers at the front corners, the charge port door's seam on the left rear
    ...sides.map(s => rbox(0.012, 0.03, 0.09, s * (W / 2 + B + 0.004), 0.86, front - 0.32, AMBER, 0.006)),
    onSide([[-1.98, 1.02], [-1.98, 1.17], [-1.8, 1.17], [-1.8, 1.02]], -1, 0.009, "#7d8185"),
    onSide([[-1.965, 1.035], [-1.965, 1.155], [-1.815, 1.155], [-1.815, 1.035]], -1, 0.0095, "#b4b8bc"),
  ];
  const geometry = twoGroups(painted, [body]);
  // Unpainted stainless steel: brushed lengthwise (the grain in the roughness), a little uneven
  // panel to panel.
  const material = geometryOnly ? new THREE.MeshStandardMaterial() : heroSurface("cyber");
  const wheels: WheelAt[] = sides.flatMap(sd => [{ x: sd * (W / 2 - 0.1), z: 1.9, side: sd }, { x: sd * (W / 2 - 0.1), z: -1.9, side: sd }]);
  const lamps = [
    { x: 0, y: nose - 0.03, z: front + B + 0.03, w: W - 0.04, h: 0.04, red: false },
    { x: 0, y: tail - 0.07, z: back - B - 0.03, w: W - 0.04, h: 0.052, red: true },
    ...sides.map(s => ({ x: s * (W / 2 - 0.05), y: tail - 0.14, z: back - B - 0.03, w: 0.064, h: 0.134, red: true })),
  ];
  return { geometry, material, lamps, dims: [L, W, 0.62], wheel: heroWheel("aero", 0.44, 0.34), radius: 0.44, wheels,
    // (plates a hand proud of the bevelled nose and tail: on their planes they flickered in and out)
    plate: [L, 0.56, 0.86, B + 0.03, B + 0.03] };
}

/** Geometry may come from the worker; surface painting stays with the page's exact font. */
export function heroSurface(name: HeroName) {
  return name === "coupang"
    ? new THREE.MeshStandardMaterial({ map: coupangLivery(), roughness: 0.45, metalness: 0.05 })
    : new THREE.MeshStandardMaterial({ color: "#cfd2d4", metalness: 0.92, roughness: 0.42, roughnessMap: brushedSteel() });
}
