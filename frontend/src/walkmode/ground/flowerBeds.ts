import * as THREE from "three";

/* The planted beds along a block's foot either side of its 공동현관: a granite kerb, dark mulch, and
 * planting in layers as a landscaper sets it out — shrubs and tall perennials against the wall,
 * flowering perennials in the middle, bedding and edging at the front — each kind in a drift of
 * three to seven plants, two dozen kinds (and their colour forms):
 *   back    회양목 boxwood ball, 사철나무 euonymus, 남천 nandina, 수국 hydrangea, 장미 rose, 영산홍
 *           azalea, 억새 silver grass, 코스모스 cosmos
 *   middle  국화 chrysanthemum, 구절초 Korean daisy, 샐비어 salvia, 라벤더 lavender, 백일홍 zinnia,
 *           루드베키아 rudbeckia, 맨드라미 cockscomb, 천일홍 globe amaranth, 꽃양배추 ornamental kale,
 *           비비추 hosta
 *   front   팬지 pansy, 페튜니아 petunia, 베고니아 begonia, 메리골드 marigold, 맥문동 liriope,
 *           꽃잔디 creeping phlox, 알리섬 sweet alyssum
 * Every plant is a small low-poly model in vertex colours; one bed (both sides of a door, kerbs,
 * soil and every plant) is one mesh in one material — one draw. */

type V3 = [number, number, number];
interface Proto { pos: Float32Array; nor: Float32Array; col: Float32Array }

const rng = (s: number) => () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
const C = (h: string) => { const c = new THREE.Color(h); return [c.r, c.g, c.b] as V3; };

/** a little builder of coloured triangles */
class Tris {
  p: number[] = []; c: number[] = [];
  tri(a: V3, b: V3, d: V3, col: V3) { this.p.push(...a, ...b, ...d); for (let i = 0; i < 3; i++) this.c.push(...col); }
  quad(a: V3, b: V3, d: V3, e: V3, col: V3, col2 = col) { this.tri(a, b, d, col); this.tri(a, d, e, col2); }
  /** a leaf: a pointed blade from `base` along direction (yaw, pitch), length l, width w */
  leaf(base: V3, yaw: number, pitch: number, l: number, w: number, col: V3, tip?: V3) {
    const dx = Math.cos(yaw) * Math.cos(pitch), dz = Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch);
    const sx = -Math.sin(yaw) * w / 2, sz = Math.cos(yaw) * w / 2;
    const m: V3 = [base[0] + dx * l * 0.45, base[1] + dy * l * 0.45 + l * 0.05, base[2] + dz * l * 0.45];
    const t: V3 = [base[0] + dx * l, base[1] + dy * l - l * 0.12 * Math.cos(pitch), base[2] + dz * l];
    const dark: V3 = [col[0] * 0.75, col[1] * 0.75, col[2] * 0.75];
    this.tri(base, [m[0] + sx, m[1], m[2] + sz], m, dark); this.tri(base, m, [m[0] - sx, m[1], m[2] - sz], dark);
    this.tri([m[0] + sx, m[1], m[2] + sz], t, m, tip ?? col); this.tri(m, t, [m[0] - sx, m[1], m[2] - sz], tip ?? col);
  }
  /** a flower head facing up-ish: n petals round a centre */
  bloom(at: V3, r: number, n: number, petal: V3, centre: V3, cup = 0.25) {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 0.5) / n) * Math.PI * 2, a2 = ((i + 1) / n) * Math.PI * 2;
      const ctr: V3 = [at[0], at[1], at[2]];
      const p0: V3 = [at[0] + Math.cos(a0) * r * 0.55, at[1] + r * cup * 0.5, at[2] + Math.sin(a0) * r * 0.55];
      const p1: V3 = [at[0] + Math.cos(a1) * r, at[1] + r * cup, at[2] + Math.sin(a1) * r];
      const p2: V3 = [at[0] + Math.cos(a2) * r * 0.55, at[1] + r * cup * 0.5, at[2] + Math.sin(a2) * r * 0.55];
      this.tri(ctr, p0, p1, petal); this.tri(ctr, p1, p2, petal);
    }
    const k = r * 0.28;
    this.tri([at[0] - k, at[1] + 0.004, at[2]], [at[0] + k / 2, at[1] + 0.004, at[2] + k], [at[0] + k / 2, at[1] + 0.004, at[2] - k], centre);
  }
  /** a rough ball (boxwood, hydrangea head, kale): an icosphere, its colour by height */
  ball(at: V3, r: number, sy: number, top: V3, bottom: V3, seed: number, detail = 1) {
    const g = new THREE.IcosahedronGeometry(r, detail), p = g.attributes.position, R = rng(seed);
    for (let i = 0; i < p.count; i += 3) {
      const tri: V3[] = [];
      for (let k = 0; k < 3; k++) { const j = i + k; const n = 1 + (R() - 0.5) * 0.25; tri.push([at[0] + p.getX(j) * n, at[1] + p.getY(j) * sy * n, at[2] + p.getZ(j) * n]); }
      const y = (tri[0][1] + tri[1][1] + tri[2][1]) / 3 - at[1], k2 = THREE.MathUtils.clamp(y / (r * sy) * 0.5 + 0.5, 0, 1), v = 0.85 + R() * 0.3;
      this.tri(tri[0], tri[1], tri[2], [(bottom[0] + (top[0] - bottom[0]) * k2) * v, (bottom[1] + (top[1] - bottom[1]) * k2) * v, (bottom[2] + (top[2] - bottom[2]) * k2) * v]);
    }
    g.dispose();
  }
  /** a spike of flowers (salvia, lavender, cockscomb, liriope): a tapering four-sided column */
  spike(base: V3, h: number, r: number, col: V3, lean = 0, yaw = 0) {
    const tip: V3 = [base[0] + Math.cos(yaw) * lean, base[1] + h, base[2] + Math.sin(yaw) * lean];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + yaw, b = ((i + 1) / 4) * Math.PI * 2 + yaw;
      const d: V3 = [col[0] * (0.8 + 0.1 * i), col[1] * (0.8 + 0.1 * i), col[2] * (0.8 + 0.1 * i)];
      this.tri([base[0] + Math.cos(a) * r, base[1], base[2] + Math.sin(a) * r], [base[0] + Math.cos(b) * r, base[1], base[2] + Math.sin(b) * r], tip, d);
    }
  }
  stem(a: V3, b: V3, col: V3, w = 0.008) { this.quad([a[0] - w, a[1], a[2]], [a[0] + w, a[1], a[2]], [b[0] + w, b[1], b[2]], [b[0] - w, b[1], b[2]], col); }
  proto(): Proto {
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3)); g.computeVertexNormals();
    // (foliage lit from above: the normals leaned up, so leaves in shade are not black underneath)
    const n = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < n.count; i++) { const v = new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i)); if (v.y < 0) v.y = -v.y; v.y += 0.6; v.normalize(); n.setXYZ(i, v.x, v.y, v.z); }
    const out = { pos: new Float32Array(this.p), nor: new Float32Array(n.array as Float32Array), col: new Float32Array(this.c) };
    g.dispose(); return out;
  }
}

// ---- the plants. Each kind: its layer, its spacing (m), and a maker given a seed and a colour form.
const LEAF = C("#3f6b32"), LEAF2 = C("#4d7a3a"), LEAFD = C("#2d4f27"), GREY = C("#7d8f7a");
const around = (t: Tris, R: () => number, n: number, h: number, l: number, w: number, col: V3, pitch = 0.5) => {
  for (let i = 0; i < n; i++) t.leaf([(R() - 0.5) * 0.05, h * R() * 0.4, (R() - 0.5) * 0.05], R() * 6.283, pitch + (R() - 0.5) * 0.5, l * (0.7 + R() * 0.5), w, i % 2 ? col : LEAF2);
};
type Maker = (R: () => number, form: number) => Tris;
interface Kind { name: string; layer: 0 | 1 | 2; space: number; forms: number; make: Maker }
const KINDS: Kind[] = [
  // ---- back
  { name: "회양목", layer: 0, space: 0.55, forms: 1, make: R => { const t = new Tris(); t.ball([0, 0.3, 0], 0.32, 0.9, C("#4f7a35"), C("#2b4a22"), R() * 1e6 | 0); return t; } },
  { name: "사철나무", layer: 0, space: 0.6, forms: 2, make: (R, f) => { const t = new Tris(); t.ball([0, 0.42, 0], 0.36, 1.15, f ? C("#7e9a3c") : C("#3e6a2c"), C("#24411d"), R() * 1e6 | 0); return t; } },
  { name: "남천", layer: 0, space: 0.5, forms: 1, make: R => { const t = new Tris(); for (let i = 0; i < 5; i++) { const x = (R() - 0.5) * 0.2, z = (R() - 0.5) * 0.2, h = 0.6 + R() * 0.4; t.stem([x, 0, z], [x, h, z], C("#6b4a32")); for (let k = 0; k < 6; k++) t.leaf([x, h * (0.5 + k * 0.08), z], R() * 6.28, -0.1 + R() * 0.4, 0.14, 0.04, k % 2 ? C("#b5372a") : C("#cf5a2c")); } return t; } },
  { name: "수국", layer: 0, space: 0.7, forms: 3, make: (R, f) => { const t = new Tris(); around(t, R, 16, 0.45, 0.22, 0.12, LEAF, 0.2); const col = [C("#7d93d6"), C("#d98cb4"), C("#e9e6ef")][f]; for (let i = 0; i < 5; i++) t.ball([(R() - 0.5) * 0.4, 0.45 + R() * 0.15, (R() - 0.5) * 0.4], 0.11, 0.85, col, [col[0] * 0.7, col[1] * 0.7, col[2] * 0.75], R() * 1e6 | 0); return t; } },
  { name: "장미", layer: 0, space: 0.6, forms: 3, make: (R, f) => { const t = new Tris(); around(t, R, 14, 0.5, 0.12, 0.07, LEAFD, 0.3); const col = [C("#b3172a"), C("#e98aa0"), C("#f2e4c4")][f]; for (let i = 0; i < 6; i++) { const at: V3 = [(R() - 0.5) * 0.4, 0.45 + R() * 0.3, (R() - 0.5) * 0.4]; t.stem([at[0], 0, at[2]], at, LEAFD); t.ball(at, 0.045, 0.8, col, [col[0] * 0.6, col[1] * 0.6, col[2] * 0.6], R() * 1e6 | 0, 0); } return t; } },
  { name: "영산홍", layer: 0, space: 0.6, forms: 1, make: R => { const t = new Tris(); t.ball([0, 0.3, 0], 0.34, 0.7, C("#6c7f34"), C("#3c4f22"), R() * 1e6 | 0); for (let i = 0; i < 8; i++) t.leaf([(R() - 0.5) * 0.4, 0.3 + R() * 0.15, (R() - 0.5) * 0.4], R() * 6.28, 0.3, 0.08, 0.04, C("#a3412e")); return t; } },
  { name: "억새", layer: 0, space: 0.6, forms: 1, make: R => { const t = new Tris(); for (let i = 0; i < 26; i++) t.leaf([(R() - 0.5) * 0.08, 0, (R() - 0.5) * 0.08], R() * 6.28, 1.0 + R() * 0.35, 0.9 + R() * 0.3, 0.025, C("#7d8a4c"), C("#b9ad7c")); for (let i = 0; i < 7; i++) { const a = R() * 6.28, h = 1.2 + R() * 0.3, x = Math.cos(a) * 0.12, z = Math.sin(a) * 0.12; t.stem([0, 0, 0], [x, h, z], C("#9b9364"), 0.005); t.spike([x, h - 0.05, z], 0.28, 0.035, C("#e4d9bd"), 0.08, a); } return t; } },
  { name: "코스모스", layer: 0, space: 0.4, forms: 3, make: (R, f) => { const t = new Tris(); const col = [C("#e57fae"), C("#f4f0f2"), C("#b8306a")][f]; for (let i = 0; i < 7; i++) { const x = (R() - 0.5) * 0.25, z = (R() - 0.5) * 0.25, h = 0.8 + R() * 0.4; t.stem([x * 0.3, 0, z * 0.3], [x, h, z], C("#55803c"), 0.006); t.bloom([x, h, z], 0.05, 8, col, C("#e8b923"), 0.1); for (let k = 0; k < 3; k++) t.leaf([x * 0.6, h * (0.3 + k * 0.2), z * 0.6], R() * 6.28, 0.2, 0.1, 0.012, LEAF2); } return t; } },
  // ---- middle
  { name: "국화", layer: 1, space: 0.38, forms: 4, make: (R, f) => { const t = new Tris(); const col = [C("#f2c230"), C("#f3efe4"), C("#9e2a3e"), C("#e47b2c")][f]; t.ball([0, 0.2, 0], 0.22, 0.75, C("#3f6a30"), C("#294a22"), R() * 1e6 | 0, 1); for (let i = 0; i < 16; i++) { const a = R() * 6.28, r = R() * 0.2; t.bloom([Math.cos(a) * r, 0.31 + (0.2 - r) * 0.5, Math.sin(a) * r], 0.035, 7, col, [col[0] * 0.7, col[1] * 0.6, col[2] * 0.4], 0.35); } return t; } },
  { name: "구절초", layer: 1, space: 0.35, forms: 2, make: (R, f) => { const t = new Tris(); const col = f ? C("#e8d6ee") : C("#f6f4ee"); around(t, R, 10, 0.2, 0.14, 0.03, LEAF); for (let i = 0; i < 9; i++) { const x = (R() - 0.5) * 0.3, z = (R() - 0.5) * 0.3, h = 0.35 + R() * 0.15; t.stem([0, 0, 0], [x, h, z], C("#557a3a"), 0.005); t.bloom([x, h, z], 0.035, 10, col, C("#e6b422"), 0.15); } return t; } },
  { name: "샐비어", layer: 1, space: 0.28, forms: 2, make: (R, f) => { const t = new Tris(); around(t, R, 10, 0.15, 0.1, 0.06, LEAF2, 0.25); for (let i = 0; i < 5; i++) t.spike([(R() - 0.5) * 0.18, 0.12, (R() - 0.5) * 0.18], 0.32 + R() * 0.12, 0.035, f ? C("#5b3fa6") : C("#d8231c"), 0.03, R() * 6.28); return t; } },
  { name: "라벤더", layer: 1, space: 0.35, forms: 1, make: R => { const t = new Tris(); for (let i = 0; i < 22; i++) t.leaf([(R() - 0.5) * 0.06, 0, (R() - 0.5) * 0.06], R() * 6.28, 0.9 + R() * 0.4, 0.22, 0.012, GREY); for (let i = 0; i < 14; i++) { const a = R() * 6.28, r = 0.05 + R() * 0.12, h = 0.35 + R() * 0.15; t.stem([0, 0.1, 0], [Math.cos(a) * r, h, Math.sin(a) * r], GREY, 0.003); t.spike([Math.cos(a) * r, h, Math.sin(a) * r], 0.1, 0.014, C("#7a63b8")); } return t; } },
  { name: "백일홍", layer: 1, space: 0.32, forms: 4, make: (R, f) => { const t = new Tris(); const col = [C("#e8463a"), C("#f29b2e"), C("#e45f9b"), C("#f4d23c")][f]; around(t, R, 10, 0.2, 0.11, 0.05, LEAF); for (let i = 0; i < 5; i++) { const x = (R() - 0.5) * 0.22, z = (R() - 0.5) * 0.22, h = 0.38 + R() * 0.15; t.stem([0, 0, 0], [x, h, z], LEAF2, 0.006); t.bloom([x, h, z], 0.045, 12, col, C("#6b4a1e"), 0.2); t.bloom([x, h + 0.008, z], 0.03, 9, col, C("#e2b33a"), 0.4); } return t; } },
  { name: "루드베키아", layer: 1, space: 0.35, forms: 1, make: R => { const t = new Tris(); around(t, R, 10, 0.2, 0.13, 0.05, LEAF); for (let i = 0; i < 8; i++) { const x = (R() - 0.5) * 0.3, z = (R() - 0.5) * 0.3, h = 0.45 + R() * 0.18; t.stem([0, 0, 0], [x, h, z], LEAF2, 0.006); t.bloom([x, h, z], 0.05, 12, C("#f2b21b"), C("#2a1a0e"), -0.15); t.ball([x, h + 0.012, z], 0.016, 1, C("#3a2412"), C("#24150a"), i, 0); } return t; } },
  { name: "맨드라미", layer: 1, space: 0.3, forms: 2, make: (R, f) => { const t = new Tris(); around(t, R, 8, 0.15, 0.12, 0.05, C("#5d6e2e"), 0.3); const col = f ? C("#f0b72a") : C("#c3123a"); for (let i = 0; i < 3; i++) { const x = (R() - 0.5) * 0.15, z = (R() - 0.5) * 0.15; t.spike([x, 0.25, z], 0.22 + R() * 0.1, 0.06, col, 0.02, R() * 6.28); t.ball([x, 0.27, z], 0.06, 0.8, col, [col[0] * 0.6, col[1] * 0.5, col[2] * 0.5], i, 0); } return t; } },
  { name: "천일홍", layer: 1, space: 0.28, forms: 2, make: (R, f) => { const t = new Tris(); around(t, R, 8, 0.15, 0.09, 0.04, LEAF); const col = f ? C("#f4f2f0") : C("#c42a85"); for (let i = 0; i < 9; i++) { const x = (R() - 0.5) * 0.24, z = (R() - 0.5) * 0.24, h = 0.3 + R() * 0.12; t.stem([0, 0.05, 0], [x, h, z], LEAF2, 0.004); t.ball([x, h, z], 0.022, 1.1, col, [col[0] * 0.7, col[1] * 0.6, col[2] * 0.7], i, 0); } return t; } },
  { name: "꽃양배추", layer: 1, space: 0.38, forms: 2, make: (R, f) => { const t = new Tris(); const inner = f ? C("#f2eef0") : C("#b94a8c"); for (let ring = 0; ring < 3; ring++) for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.28 + ring * 0.45; const col: V3 = ring === 0 ? C("#4d6f62") : ring === 1 ? [(0.3 + inner[0]) / 2, (0.43 + inner[1]) / 2, (0.38 + inner[2]) / 2] : inner; t.leaf([0, 0.06 + ring * 0.035, 0], a + (R() - 0.5) * 0.3, 0.45 + ring * 0.25, 0.2 - ring * 0.055, 0.15 - ring * 0.035, col); } return t; } },
  { name: "비비추", layer: 1, space: 0.42, forms: 1, make: R => { const t = new Tris(); for (let i = 0; i < 11; i++) t.leaf([0, 0.02, 0], (i / 11) * 6.28 + R() * 0.3, 0.55 + R() * 0.3, 0.26, 0.13, i % 2 ? C("#5b8a4a") : C("#7aa05a"), C("#c9d29a")); for (let i = 0; i < 3; i++) { const x = (R() - 0.5) * 0.1; t.stem([x, 0, 0], [x, 0.5, 0.02], LEAF2, 0.004); t.spike([x, 0.44, 0.02], 0.12, 0.02, C("#b9a5d8")); } return t; } },
  // ---- front
  { name: "팬지", layer: 2, space: 0.2, forms: 4, make: (R, f) => { const t = new Tris(); const col = [C("#5a3d9a"), C("#f3d83a"), C("#f0f0f2"), C("#c1446a")][f]; around(t, R, 7, 0.04, 0.07, 0.04, LEAF, 0.2); for (let i = 0; i < 5; i++) t.bloom([(R() - 0.5) * 0.12, 0.1 + R() * 0.03, (R() - 0.5) * 0.12], 0.028, 5, col, C("#2b1d3a"), 0.4); return t; } },
  { name: "페튜니아", layer: 2, space: 0.24, forms: 4, make: (R, f) => { const t = new Tris(); const col = [C("#8b3fa8"), C("#e05a9a"), C("#f4f2f4"), C("#c42638")][f]; around(t, R, 9, 0.04, 0.08, 0.05, LEAF2, 0.15); for (let i = 0; i < 7; i++) t.bloom([(R() - 0.5) * 0.2, 0.09 + R() * 0.04, (R() - 0.5) * 0.2], 0.035, 5, col, [col[0] * 0.5, col[1] * 0.4, col[2] * 0.5], 0.6); return t; } },
  { name: "베고니아", layer: 2, space: 0.2, forms: 3, make: (R, f) => { const t = new Tris(); const col = [C("#d7263b"), C("#f08aa4"), C("#f6f2ee")][f]; t.ball([0, 0.07, 0], 0.1, 0.7, C("#4a6a2a"), C("#2c3f1c"), R() * 1e6 | 0, 1); for (let i = 0; i < 8; i++) { const a = R() * 6.28, r = R() * 0.09; t.bloom([Math.cos(a) * r, 0.13, Math.sin(a) * r], 0.02, 4, col, C("#f2c53a"), 0.3); } return t; } },
  { name: "메리골드", layer: 2, space: 0.22, forms: 2, make: (R, f) => { const t = new Tris(); const col = f ? C("#f2a20e") : C("#e85d12"); around(t, R, 8, 0.05, 0.08, 0.03, LEAFD, 0.3); for (let i = 0; i < 5; i++) t.ball([(R() - 0.5) * 0.14, 0.16 + R() * 0.04, (R() - 0.5) * 0.14], 0.033, 0.7, col, [col[0] * 0.75, col[1] * 0.6, col[2] * 0.3], i, 1); return t; } },
  { name: "맥문동", layer: 2, space: 0.25, forms: 1, make: R => { const t = new Tris(); for (let i = 0; i < 20; i++) t.leaf([(R() - 0.5) * 0.05, 0, (R() - 0.5) * 0.05], R() * 6.28, 0.6 + R() * 0.5, 0.3, 0.014, LEAFD, C("#56703a")); for (let i = 0; i < 4; i++) { const a = R() * 6.28; t.spike([Math.cos(a) * 0.05, 0.08, Math.sin(a) * 0.05], 0.22, 0.016, C("#6b4fa8"), 0.04, a); } return t; } },
  { name: "꽃잔디", layer: 2, space: 0.3, forms: 2, make: (R, f) => { const t = new Tris(); const col = f ? C("#a68ad8") : C("#ef6fa8"); t.ball([0, 0.02, 0], 0.17, 0.25, C("#45692e"), C("#2e4a22"), R() * 1e6 | 0, 1); for (let i = 0; i < 18; i++) { const a = R() * 6.28, r = R() * 0.16; t.bloom([Math.cos(a) * r, 0.055, Math.sin(a) * r], 0.016, 5, col, C("#f5eef2"), 0.1); } return t; } },
  { name: "알리섬", layer: 2, space: 0.2, forms: 2, make: (R, f) => { const t = new Tris(); t.ball([0, 0.05, 0], 0.12, 0.45, f ? C("#c9b3e6") : C("#f7f6f2"), C("#55703c"), R() * 1e6 | 0, 1); return t; } },
];

// prototypes: three seeds of each kind and form (built once)
let protos: Proto[][][] | null = null;
function getProtos() {
  return protos ??= KINDS.map((k, ki) => Array.from({ length: k.forms }, (_, f) => [0, 1, 2].map(v => k.make(rng(ki * 977 + f * 131 + v * 17 + 1), f).proto())));
}

/** months: the bedding changed with the season — autumn kinds in the autumn, and the rest */
function seasonal(month: number) {
  const autumn = ["국화", "구절초", "꽃양배추", "코스모스", "억새", "맨드라미", "천일홍", "메리골드", "남천", "팬지"];
  const spring = ["팬지", "꽃잔디", "영산홍", "알리섬", "베고니아", "페튜니아", "튤립"];
  return (name: string) => (month >= 9 && month <= 11 ? (autumn.includes(name) ? 2.2 : 1) : month >= 3 && month <= 5 ? (spring.includes(name) ? 2.2 : 1) : 1);
}

export interface BedSide { x0: number; x1: number }
let material: THREE.MeshStandardMaterial | null = null;
let users = 0;

/** The beds for one entrance, in its frame (x along the wall, z out, the wall at z = 0): planted
 * strips from |x| = x0 to x1 on each side, `depth` deep. Returns one mesh. */
export function buildBeds(sides: BedSide[], depth: number, seed: number, month: number, groundAt: (x: number) => number) {
  const P = getProtos(), R = rng(seed * 7919 + 13), weight = seasonal(month);
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  const pushProto = (p: Proto, x: number, y: number, z: number, rot: number, s: number, tint: number) => {
    const c = Math.cos(rot), sn = Math.sin(rot);
    for (let i = 0; i < p.pos.length; i += 3) {
      const px = p.pos[i] * s, py = p.pos[i + 1] * s, pz = p.pos[i + 2] * s;
      pos.push(x + px * c - pz * sn, y + py, z + px * sn + pz * c);
      const nx = p.nor[i], nz = p.nor[i + 2];
      nor.push(nx * c - nz * sn, p.nor[i + 1], nx * sn + nz * c);
      col.push(p.col[i] * tint, p.col[i + 1] * tint, p.col[i + 2] * tint);
    }
  };
  const boxAt = (cx: number, cy: number, cz: number, w: number, h: number, d: number, c: V3, top?: V3) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(), p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(cx + p.getX(i), cy + p.getY(i), cz + p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i));
      const cc = top && n.getY(i) > 0.5 ? top : c, v = 0.94 + ((i * 7919) % 13) / 130;
      col.push(cc[0] * v, cc[1] * v, cc[2] * v);
    }
    g.dispose();
  };
  const KERB = C("#a9a69f"), KERBTOP = C("#c2beb6"), SOIL = C("#3a2c22"), MULCH = C("#5a4130");
  const byLayer = [0, 1, 2].map(l => KINDS.map((k, i) => ({ k, i })).filter(e => e.k.layer === l));
  for (const side of sides) for (const sgn of [-1, 1]) {
    const a = side.x0, b = side.x1, len = b - a;
    if (len < 1) continue;
    const mid = sgn * (a + b) / 2, g0 = groundAt(mid);
    // granite kerb on three sides, mulch on the soil
    boxAt(mid, g0 + 0.14, depth - 0.06, len, 0.28, 0.12, KERB, KERBTOP);
    boxAt(sgn * (b - 0.06), g0 + 0.14, depth / 2, 0.12, 0.28, depth, KERB, KERBTOP);
    boxAt(sgn * (a + 0.06), g0 + 0.14, depth / 2, 0.12, 0.28, depth, KERB, KERBTOP);
    boxAt(mid, g0 + 0.1, depth / 2 - 0.03, len - 0.24, 0.2, depth - 0.18, SOIL, MULCH);
    const soil = g0 + 0.2;
    // the three layers, each in drifts of one kind; rows set back from the wall to the kerb
    const rows: [number, number][] = [[0.22, 0], [depth * 0.5, 1], [depth - 0.24, 2]];
    for (const [z, layer] of rows) {
      let x = a + 0.25;
      while (x < b - 0.2) {
        const opts = byLayer[layer]; let tot = 0; for (const o of opts) tot += weight(o.k.name);
        let r = R() * tot, pick = opts[0]; for (const o of opts) { r -= weight(o.k.name); if (r <= 0) { pick = o; break; } }
        const kind = pick.k, form = Math.floor(R() * kind.forms), n = 3 + Math.floor(R() * 5);
        for (let i = 0; i < n && x < b - 0.2; i++) {
          const v = P[pick.i][form][Math.floor(R() * 3)];
          const jz = (R() - 0.5) * (layer === 1 ? 0.25 : 0.12);
          pushProto(v, sgn * x, soil, Math.min(depth - 0.15, Math.max(0.12, z + jz)), R() * 6.283, 0.85 + R() * 0.35, 0.88 + R() * 0.2);
          x += kind.space * (0.8 + R() * 0.4);
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  material ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide });
  users++;
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return { mesh, dispose() { geo.dispose(); if (--users === 0) { material?.dispose(); material = null; } } };
}

export const BED_KINDS = KINDS.map(k => k.name);
