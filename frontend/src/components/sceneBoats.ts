import * as THREE from "three";
import type { Look } from "./complexScene";
import { rng } from "./complexScene";
import type { WaterField } from "./sceneWater";

/* Boats on a big river (the Han and rivers like it), in clear weather from morning to
 * sunset: a bowrider towing a wakeboarder, a jet ski and a small cruiser, each on its own
 * loop of the channel at its own speed. Each cuts the water as boats do:
 * - a Kelvin wake: its arms open at 19.47° behind the hull whatever the speed, with
 *   transverse and diverging crests at the wavelength the speed sets (2πv²/g), the
 *   ridges in a normal map so they catch the sky like the river around them;
 * - churned white water behind the hull (the prop wash), widening and fading;
 * - spray thrown from the bow, a jet ski's rooster tail and a wakeboard's cuts, flying
 *   under gravity and drag and falling back to the surface.
 * Hulls lift at the bow on the plane, heel into turns (tan φ = v²/gr) and ride the
 * waves. Plain meshes and standard materials: the same in WebGL and the WebGPU adapter
 * (which re-uploads the moving ribbons and particles each frame).
 * Footprint frame: x east, y north; world (x, height, -y). */

const G = 9.81;
const KELVIN = Math.tan(19.47 * Math.PI / 180);

/* ---------- The route ---------- */

/** Why the last scene got no boats (shown on the stage's data-boats, for diagnosis). */
export let noBoatsReason = "";

/** Loops along the river's core near the complex: out along one lane, a U-turn, back
 * along another. Null when there is no river wider than ~110 m in the scene. */
function riverLoops(field: WaterField, cx: number, cy: number, fractions: [number, number][]) {
  const { x0, y0, x1, y1 } = field.bounds;
  const pts: [number, number, number][] = [];
  const reach = 1600;
  for (let y = Math.max(y0, cy - reach); y <= Math.min(y1, cy + reach); y += 10)
    for (let x = Math.max(x0, cx - reach); x <= Math.min(x1, cx + reach); x += 10) {
      if (!field.wet(x, y)) continue;
      const sh = field.shore(x, y);
      if (sh >= 55) pts.push([x, y, sh]);
    }
  if (pts.length < 40) { noBoatsReason = `narrow (${pts.length} core points)`; return null; }
  // The channel's axis: principal direction of its core.
  let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= pts.length; my /= pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux;
  // Along the axis in 20 m bins: the widest point across is the channel's middle.
  const bin = 20, t0 = (cx - mx) * ux + (cy - my) * uy;
  const bins = new Map<number, { w: number; sh: number }>();
  for (const [x, y, sh] of pts) {
    const t = (x - mx) * ux + (y - my) * uy, w = (x - mx) * vx + (y - my) * vy;
    const k = Math.round(t / bin), b = bins.get(k);
    if (!b || sh > b.sh) bins.set(k, { w, sh });
  }
  const keys = [...bins.keys()].sort((a, b) => a - b);
  // The longest unbroken run nearest the complex.
  const runs: number[][] = [];
  for (const k of keys) { const r = runs[runs.length - 1]; if (r && k - r[r.length - 1] <= 2) r.push(k); else runs.push([k]); }
  const score = (r: number[]) => r.length * bin - Math.max(0, Math.min(...r.map(k => Math.abs(k * bin - t0))) - 300);
  const run = runs.filter(r => r.length * bin >= 400).sort((a, b) => score(b) - score(a))[0];
  if (!run) { noBoatsReason = `no run ≥400 m (${runs.map(r => r.length * bin).join(",")})`; return null; }
  const lo = Math.max(run[0], Math.round((t0 - 1100) / bin)), hi = Math.min(run[run.length - 1], Math.round((t0 + 1100) / bin));
  if ((hi - lo) * bin < 400) { noBoatsReason = `run near complex ${(hi - lo) * bin} m`; return null; }
  const line: { t: number; w: number; sh: number }[] = [];
  for (let k = lo; k <= hi; k++) {
    const near = [k - 1, k, k + 1].map(q => bins.get(q)).filter(Boolean) as { w: number; sh: number }[];
    if (near.length) line.push({ t: k * bin, w: near.reduce((a, b) => a + b.w, 0) / near.length, sh: Math.min(...near.map(b => b.sh)) });
  }
  // Smooth the middle line (moving average over ~180 m).
  const mid = line.map((p, i) => {
    const win = line.slice(Math.max(0, i - 4), i + 5);
    return { t: p.t, w: win.reduce((a, b) => a + b.w, 0) / win.length, sh: Math.min(...win.map(b => b.sh)) };
  });
  const at = (t: number, w: number): [number, number] => [mx + ux * t + vx * w, my + uy * t + vy * w];
  const ok = (p: [number, number]) => field.wet(p[0], p[1]) && field.shore(p[0], p[1]) > 14;
  // Each lane point is placed on open water: at its share of the way to the bank, or,
  // where that falls on an island, a pier or the bank, moved toward the middle (or
  // past it) until it is on the water. The U-turns shorten where the run ends early.
  const place = (p: { t: number; w: number; sh: number }, f: number) => {
    for (const k of [1, 0.8, 0.6, 0.4, 0.2, 0, -0.2, -0.4, -0.6]) {
      const q = at(p.t, p.w + f * k * (p.sh - 20));
      if (ok(q)) return { q, w: p.w + f * k * (p.sh - 20) };
    }
    return null;
  };
  return fractions.map(([out, back]) => {
    const body = mid.slice(3, -3);
    if (body.length < 4) return null;
    const lane = (f: number) => body.map(p => ({ p, at: place(p, f) })).filter(x => x.at) as { p: typeof body[number]; at: { q: [number, number]; w: number } }[];
    const fwd = lane(out), rev = lane(back);
    if (fwd.length < body.length * 0.8 || rev.length < body.length * 0.8) return null;
    const turn = (p: { t: number }, from: number, to: number, dir: number): [number, number][] => {
      for (const reach of [60, 40, 20, 0]) {
        const c = (from + to) / 2, b = (to - from) / 2, pts: [number, number][] = [];
        for (let i = 0; i < 11; i++) { const th = (Math.PI * (i + 1)) / 12; pts.push(at(p.t + reach * dir * Math.sin(th), c - b * Math.cos(th))); }
        if (pts.every(ok)) return pts;
      }
      return [];
    };
    const f0 = fwd[fwd.length - 1], r0 = rev[rev.length - 1], f1 = fwd[0], r1 = rev[0];
    const loop: [number, number][] = [
      ...fwd.map(x => x.at.q),
      ...turn(f0.p, f0.at.w, r0.at.w, 1),
      ...rev.slice().reverse().map(x => x.at.q),
      ...turn(f1.p, r1.at.w, f1.at.w, -1),
    ];
    let pl = loop;
    for (let i = 0; i < 3; i++) pl = chaikin(pl);
    // Smoothing may cut a corner over the edge here and there: allow a few such points.
    const off = pl.filter(q => !ok(q)).length;
    if (off > pl.length * 0.03) { noBoatsReason = `lanes off the water (${off}/${pl.length})`; return null; }
    return new Loop(pl);
  });
}

function chaikin(p: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  return out;
}

/** A closed path, sampled by arc length. */
class Loop {
  s: number[] = [0];
  length: number;
  constructor(public p: [number, number][]) {
    for (let i = 1; i <= p.length; i++) { const a = p[i - 1], b = p[i % p.length]; this.s.push(this.s[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    this.length = this.s[this.s.length - 1];
  }
  /** Position, unit tangent and heading at arc length d (wraps). */
  at(d: number) {
    d = ((d % this.length) + this.length) % this.length;
    let lo = 0, hi = this.s.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.s[m] <= d) lo = m; else hi = m; }
    const a = this.p[lo], b = this.p[(lo + 1) % this.p.length];
    const seg = this.s[lo + 1] - this.s[lo] || 1, k = (d - this.s[lo]) / seg;
    const tx = (b[0] - a[0]) / seg, ty = (b[1] - a[1]) / seg;
    return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, tx, ty, yaw: Math.atan2(ty, tx) };
  }
}

/* ---------- Shapes ---------- */

type Rgb = [number, number, number];
const hex = (h: string): Rgb => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };

/** A planing hull: V bottom with a hard chine, flared topsides with a colour band, a
 * sheer rising to a fine rounded bow, a flat transom; deck laid on top. Local frame: +x
 * forward (bow), +y up, +z starboard; the waterline at y = 0. */
function hullGeometry(o: { L: number; B: number; H: number; draft: number; bottom: string; band: string; top: string; deck: string }) {
  const N = 22;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const half = (x: number) => {
    const xs = -o.L * 0.05, e = o.L / 2 - xs;
    return x <= xs ? o.B / 2 * (0.94 + 0.06 * (x + o.L / 2) / (xs + o.L / 2)) : o.B / 2 * Math.sqrt(Math.max(0, 1 - ((x - xs) / e) ** 2.2));
  };
  const f = (x: number) => (x + o.L / 2) / o.L;
  const sheer = (x: number) => o.H - o.draft + 0.28 * o.H * f(x) ** 2;
  const keel = (x: number) => -o.draft + o.draft * 0.9 * Math.max(0, (f(x) - 0.62) / 0.38) ** 1.6 + 0.2 * o.H * Math.max(0, (f(x) - 0.8) / 0.2) ** 2;
  const xs = Array.from({ length: N + 1 }, (_, i) => -o.L / 2 + (o.L * i) / N * (1 - 1e-3));
  // Section: keel, chine, band bottom, band top, gunwale (per side).
  const section = (x: number, side: number): [number, number, number][] => {
    const b = half(x), k = keel(x), s = sheer(x), ch = k + (s - k) * 0.28;
    return [[x, k, 0], [x, ch, side * b * 0.86], [x, ch + (s - ch) * 0.62, side * b * 0.96], [x, ch + (s - ch) * 0.8, side * b * 0.985], [x, s, side * b]];
  };
  const colours = [hex(o.bottom), hex(o.top), hex(o.band), hex(o.top)];
  const strip = (a: (i: number) => [number, number, number], b: (i: number) => [number, number, number], c: Rgb, flip: boolean) => {
    const base = pos.length / 3;
    for (let i = 0; i <= N; i++) { pos.push(...a(i), ...b(i)); col.push(...c, ...c); }
    for (let i = 0; i < N; i++) {
      const p = base + i * 2;
      if (flip) idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); else idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2);
    }
  };
  for (const side of [1, -1]) for (let j = 0; j < 4; j++) strip(i => section(xs[i], side)[j], i => section(xs[i], side)[j + 1], colours[j], side < 0);
  // Deck, a hand's breadth below the gunwale.
  strip(i => { const s = section(xs[i], -1)[4]; return [s[0], s[1] - 0.04, s[2] * 0.97]; }, i => { const s = section(xs[i], 1)[4]; return [s[0], s[1] - 0.04, s[2] * 0.97]; }, hex(o.deck), true);
  // Transom.
  const tr = [...section(xs[0], -1).slice().reverse(), ...section(xs[0], 1).slice(1)];
  const tb = pos.length / 3, tc = hex(o.top);
  tr.forEach(p => { pos.push(...p); col.push(...tc); });
  for (let i = 1; i < tr.length - 1; i++) idx.push(tb, tb + i + 1, tb + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  // Every face outward (away from a point amidships at mid height): seen from outside,
  // front faces only.
  const mid = (sheer(0) + keel(0)) / 2;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const ox = (pos[a] + pos[b] + pos[c]) / 3, oy = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3 - mid, oz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
    if (nx * ox + ny * oy + nz * oz < 0) { const q = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = q; }
  }
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

interface Kit {
  hull: THREE.MeshStandardMaterial; glass: THREE.MeshStandardMaterial; skin: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial; white: THREE.MeshStandardMaterial; hair: THREE.MeshStandardMaterial; vests: THREE.MeshStandardMaterial[];
  board: THREE.MeshStandardMaterial; rope: THREE.MeshStandardMaterial; chrome: THREE.MeshStandardMaterial;
  geos: THREE.BufferGeometry[];
}

function kit(): Kit {
  const m = (color: string, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  return {
    hull: m("#ffffff", 0.32, 0, { vertexColors: true }),
    glass: m("#22313b", 0.08, 0.6, { transparent: true, opacity: 0.72 }),
    skin: m("#d9aa88", 0.7), dark: m("#23272c", 0.8), hair: m("#2a1d15", 0.85), white: m("#f2f3f1", 0.45), chrome: m("#c9ced3", 0.25, 0.9),
    vests: [m("#ff5a1f", 0.7), m("#f7d21e", 0.7), m("#e8293b", 0.7), m("#2d7be0", 0.7)],
    board: m("#19c2c9", 0.4), rope: m("#f3f0e6", 0.8),
    geos: [],
  };
}

/** A person about 1.75 m tall, jointed: pelvis, a tapered torso under a life vest, neck,
 * head with hair, upper arms, forearms and hands, thighs, shins and feet, each hung
 * from its joint so a pose is a set of joint angles. Local frame: +x the way they
 * face, +y up, +z their right; feet on y = 0 when standing, seat on y = 0 seated. */
type Pose = {
  lean: number; roll?: number; twist?: number; head?: number;
  hip: [number, number]; knee: [number, number]; spread?: number; stance?: number;
  shoulder: [number, number]; elbow: [number, number]; out?: [number, number];
  pelvisY: number;
};
const POSES: Record<"sit" | "stand" | "ride" | "surf", Pose> = {
  // At the wheel: upright, arms forward and bent to it.
  stand: { lean: 0.06, hip: [0.05, 0.05], knee: [-0.08, -0.08], shoulder: [0.75, 0.7], elbow: [0.9, 0.95], pelvisY: 0.93 },
  // On a bench: thighs forward, shins down, hands on the knees.
  sit: { lean: -0.12, hip: [1.45, 1.4], knee: [-1.5, -1.45], shoulder: [0.35, 0.3], elbow: [0.85, 0.9], pelvisY: 0.08 },
  // Astride a jet ski: leaning forward to the bars, knees tucked.
  ride: { lean: 0.42, hip: [1.2, 1.2], knee: [-1.75, -1.75], spread: 0.1, shoulder: [1.15, 1.15], elbow: [0.35, 0.35], out: [0.25, 0.25], pelvisY: 0.12 },
  // Wakeboarding: side-on, knees bent, leaning back on the rope, both hands at the handle
  // by the leading hip, looking at the boat (to the left).
  surf: { lean: 0.12, roll: 0.3, head: 0.9, hip: [0.55, 0.45], knee: [-0.95, -0.85], stance: 0.3, shoulder: [0.55, 0.9], elbow: [0.25, 0.15], out: [0.45, -0.95], pelvisY: 0.8 },
};

function person(k: Kit, vest: THREE.Material, pose: keyof typeof POSES) {
  const P = POSES[pose];
  const root = new THREE.Group();
  const limb = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, y: number, scale?: [number, number, number]) => {
    k.geos.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y; m.castShadow = true;
    if (scale) m.scale.set(...scale);
    parent.add(m);
    return m;
  };
  const joint = (parent: THREE.Object3D, x: number, y: number, z: number) => { const j = new THREE.Group(); j.position.set(x, y, z); parent.add(j); return j; };
  // Whole-body roll (a wakeboarder leaning back on the rope) about the feet.
  const body = joint(root, 0, 0, 0);
  body.rotation.x = P.roll ?? 0;
  const pelvis = joint(body, 0, P.pelvisY, 0);
  limb(pelvis, new THREE.SphereGeometry(0.15, 12, 8), k.dark, 0.02, [0.85, 0.62, 1.15]);
  // Torso: waist to shoulders, the vest over the chest; lean forward about the hips.
  const spine = joint(pelvis, 0, 0.06, 0);
  spine.rotation.z = -P.lean; spine.rotation.y = P.twist ?? 0;
  limb(spine, new THREE.CylinderGeometry(0.155, 0.13, 0.46, 12), k.skin, 0.23, [0.72, 1, 1.05]);
  limb(spine, new THREE.CylinderGeometry(0.175, 0.16, 0.36, 12), vest, 0.3, [0.78, 1, 1.08]);
  limb(spine, new THREE.CylinderGeometry(0.045, 0.05, 0.1, 8), k.skin, 0.52);
  const neck = joint(spine, 0.01, 0.6, 0);
  neck.rotation.y = P.head ?? 0;
  limb(neck, new THREE.SphereGeometry(0.1, 14, 10), k.skin, 0.1, [0.95, 1.12, 0.9]);
  const hair = limb(neck, new THREE.SphereGeometry(0.104, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), k.hair, 0.12, [1.0, 1.1, 0.95]);
  hair.rotation.z = 0.25;
  // Arms from the shoulders: swing forward (z rotation), out to the side (x rotation).
  for (const [i, side] of [[0, -1], [1, 1]] as const) {
    const sh = joint(spine, 0, 0.47, side * 0.19);
    sh.rotation.z = P.shoulder[i]; sh.rotation.x = -side * (P.out?.[i] ?? 0.08);
    limb(sh, new THREE.CapsuleGeometry(0.045, 0.22, 3, 8), k.skin, -0.14);
    const el = joint(sh, 0, -0.29, 0);
    el.rotation.z = P.elbow[i];
    limb(el, new THREE.CapsuleGeometry(0.038, 0.21, 3, 8), k.skin, -0.13);
    limb(el, new THREE.SphereGeometry(0.042, 8, 6), k.skin, -0.28, [1, 1.2, 0.7]);
  }
  // Legs from the hips: thighs, knees, shins, feet (shorts to the knee).
  for (const [i, side] of [[0, -1], [1, 1]] as const) {
    const off = pose === "surf" ? side * (P.stance ?? 0.28) : side * (0.1 + (P.spread ?? 0));
    const hp = joint(pelvis, 0, 0, off);
    hp.rotation.z = P.hip[i];
    limb(hp, new THREE.CapsuleGeometry(0.072, 0.3, 3, 8), k.dark, -0.2);
    const kn = joint(hp, 0, -0.43, 0);
    kn.rotation.z = P.knee[i];
    limb(kn, new THREE.CapsuleGeometry(0.052, 0.32, 3, 8), k.skin, -0.2);
    const ft = limb(kn, new THREE.BoxGeometry(0.24, 0.07, 0.1), k.dark, -0.42);
    ft.position.x = 0.06;
    ft.rotation.z = -(P.hip[i] + P.knee[i]) * 0.9;
  }
  return root;
}

interface Boat {
  group: THREE.Group; loop: Loop; speed: number; L: number; beam: number; d: number; phase: number;
  pitch: number; kind: "bowrider" | "jetski" | "cruiser"; yawPrev: number; roll: number;
  surfer?: { group: THREE.Group; board: THREE.Object3D; rope: THREE.Mesh; tow: number; swing: number; lateralPrev: number; x: number; y: number };
  wake: Ribbon; wash: Ribbon; surferWake?: Ribbon;
}

function makeBoat(k: Kit, kind: Boat["kind"]): { group: THREE.Group; L: number; beam: number; pitch: number } {
  const group = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rz = 0) => {
    k.geos.push(geo);
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x, y, z); mesh.rotation.z = rz; mesh.castShadow = true; group.add(mesh); return mesh;
  };
  const seat = (p: THREE.Group, x: number, y: number, z: number, yaw = 0) => { p.position.set(x, y, z); p.rotation.y = yaw; group.add(p); };
  if (kind === "bowrider") {
    const L = 6.8, B = 2.4, H = 1.05;
    add(hullGeometry({ L, B, H, draft: 0.38, bottom: "#7a2230", band: "#c8182b", top: "#fbfbf9", deck: "#e9e3d6" }), k.hull, 0, 0, 0);
    // Windshield over the console, the tow pylon aft of it.
    add(new THREE.BoxGeometry(0.06, 0.42, 2.0), k.glass, 0.55, 0.95, 0, -0.55);
    add(new THREE.BoxGeometry(0.7, 0.45, 0.6), k.white, 0.1, 0.78, 0.55);
    add(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 6), k.chrome, -1.3, 1.2, 0);
    seat(person(k, k.vests[0], "stand"), -0.2, 0.62, 0.55);
    seat(person(k, k.vests[1], "sit"), -1.9, 1.02, -0.45, Math.PI);
    return { group, L, beam: B, pitch: 0.07 };
  }
  if (kind === "jetski") {
    const L = 3.2, B = 1.2, H = 0.62;
    add(hullGeometry({ L, B, H, draft: 0.2, bottom: "#1c1e22", band: "#1c1e22", top: "#f5c518", deck: "#2a2d33" }), k.hull, 0, 0, 0);
    add(new THREE.BoxGeometry(1.25, 0.22, 0.42), k.dark, -0.35, 0.62, 0);
    add(new THREE.BoxGeometry(0.7, 0.3, 0.8), k.white, 0.8, 0.58, 0, 0.2);
    add(new THREE.CylinderGeometry(0.025, 0.025, 0.78, 6), k.chrome, 0.35, 0.95, 0, 0).rotation.x = Math.PI / 2;
    seat(person(k, k.vests[2], "ride"), -0.4, 0.74, 0);
    return { group, L, beam: B, pitch: 0.06 };
  }
  const L = 9.2, B = 3.0, H = 1.4;
  add(hullGeometry({ L, B, H, draft: 0.55, bottom: "#12233a", band: "#caa45a", top: "#1d3557", deck: "#d8cbb0" }), k.hull, 0, 0, 0);
  // Cabin with a band of windows, a bimini over the cockpit on four posts.
  add(new THREE.BoxGeometry(3.0, 0.9, 2.1), k.white, 1.3, 1.35, 0);
  add(new THREE.BoxGeometry(2.6, 0.32, 2.14), k.glass, 1.35, 1.48, 0);
  add(new THREE.BoxGeometry(2.6, 0.05, 2.4), k.white, -1.8, 2.55, 0);
  for (const [x, z] of [[-3.0, 1.1], [-3.0, -1.1], [-0.6, 1.1], [-0.6, -1.1]]) add(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 5), k.chrome, x, 1.75, z);
  seat(person(k, k.vests[3], "stand"), -0.9, 0.9, 0.5);
  seat(person(k, k.vests[1], "sit"), -2.6, 1.32, -0.75, Math.PI / 2);
  seat(person(k, k.vests[0], "sit"), -3.1, 1.32, 0.75, -Math.PI / 2);
  return { group, L, beam: B, pitch: 0.025 };
}

/* ---------- Wakes ---------- */

/** Canvas textures shared by every wake. Wake: foam where the Kelvin arms break, fading
 * with age (v), the water between them clear but for scattered streaks; its normal map
 * carries the transverse crests and the diverging feathers. Wash: churned white water
 * down the middle. Spray: a soft round droplet cloud. */
let textures: { wakeMap: THREE.CanvasTexture; wakeNormal: THREE.CanvasTexture; wash: THREE.CanvasTexture; spray: THREE.CanvasTexture } | null = null;
function wakeTextures() {
  if (textures) return textures;
  const W = 128, H = 256, r = rng(7);
  const noise = new Float32Array(64 * 64).map(() => r());
  const n2 = (u: number, v: number) => {
    const x = u * 63, y = v * 63, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const q = (a: number, b: number) => noise[((b & 63) * 64) + (a & 63)];
    return (q(i, j) * (1 - fx) + q(i + 1, j) * fx) * (1 - fy) + (q(i, j + 1) * (1 - fx) + q(i + 1, j + 1) * fx) * fy;
  };
  const make = (w: number, h: number, px: (u: number, v: number) => [number, number, number, number]) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d")!, img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [R, Gc, B, A] = px((x + 0.5) / w, (y + 0.5) / h), o = (y * w + x) * 4;
      img.data[o] = R * 255; img.data[o + 1] = Gc * 255; img.data[o + 2] = B * 255; img.data[o + 3] = A * 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    // Rows as drawn: v = 0 (the hull) is the first row.
    t.flipY = false;
    t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  };
  const water: Rgb = [0.12, 0.24, 0.29];
  const wakeMap = make(W, H, (u, v) => {
    const edge = Math.min(u, 1 - u);                          // 0 at the arms
    const age = v;                                            // 0 at the hull
    const arm = Math.exp(-(((edge - 0.035) / (0.03 + 0.05 * age)) ** 2)) * (1 - age) ** 1.6;
    const streak = Math.max(0, n2(u * 0.6, v * 3) - 0.62) * 2.2 * (1 - age) ** 2 * (0.4 + edge);
    const foam = Math.min(1, arm * (0.55 + 0.6 * n2(u * 4, v * 12)) + streak * 0.5);
    const wave = Math.sin(Math.PI * Math.min(1, edge * 2.4)) * (1 - age) ** 0.8;
    const a = Math.min(1, Math.max(foam, 0.28 * wave * Math.min(1, age * 12 + 0.2)));
    return [water[0] + (0.95 - water[0]) * foam, water[1] + (0.97 - water[1]) * foam, water[2] + (0.98 - water[2]) * foam, a];
  });
  // Height: transverse crests across the wake plus feathers along the arms, as a normal map.
  const h = (u: number, v: number) => {
    const edge = Math.min(u, 1 - u), across = Math.abs(u - 0.5) * 2;
    const transverse = Math.sin(2 * Math.PI * v * 1.0) * (1 - across * 0.7);
    const feather = Math.sin(2 * Math.PI * (v * 1.0 + across * 0.9) * 2.2) * Math.exp(-edge * 7);
    return (transverse * 0.6 + feather) * (1 - v) ** 0.6;
  };
  const wakeNormal = make(W, H, (u, v) => {
    const e = 1 / W, dx = (h(u + e, v) - h(u - e, v)) / (2 * e), dy = (h(u, v + 1 / H) - h(u, v - 1 / H)) / (2 / H);
    const nx = -dx * 0.02, ny = -dy * 0.02, l = Math.hypot(nx, ny, 1);
    return [0.5 + 0.5 * nx / l, 0.5 + 0.5 * ny / l, 0.5 + 0.5 / l, 1];
  });
  wakeNormal.wrapT = THREE.RepeatWrapping;
  const wash = make(64, 256, (u, v) => {
    const across = Math.abs(u - 0.5) * 2;
    // Churned water: bright boils near the hull breaking into streaks and patches.
    const churn = 0.35 + 0.8 * n2(u * 3 + v * 0.3, v * 16) - 0.45 * n2(u * 9, v * 40) + 0.3 * (Math.max(0, n2(u * 6, v * 70) - 0.5));
    const a = Math.max(0, Math.min(1, (1 - across ** 1.4) * churn * (1 - v) ** 1.6 * 0.85 * (v < 0.02 ? v / 0.02 : 1)));
    return [0.96, 0.98, 1, a];
  });
  // A cloud of droplets rather than a ball: speckles inside a soft falloff.
  const spray = make(64, 64, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    const speck = Math.max(0, n2(u * 5, v * 5) - 0.45) * 2.4;
    const a = Math.max(0, 1 - d) ** 2.2 * (0.25 + speck);
    return [1, 1, 1, Math.min(1, a)];
  });
  textures = { wakeMap, wakeNormal, wash, spray };
  return textures;
}

/** A strip laid on the water behind something moving: one pair of vertices per sample of
 * its track, its width a function of each sample's age. */
class Ribbon {
  mesh: THREE.Mesh;
  private pos: THREE.BufferAttribute; private uv: THREE.BufferAttribute;
  constructor(public max: number, mat: THREE.Material, order: number) {
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 6), 3);
    this.uv = new THREE.BufferAttribute(new Float32Array(max * 4), 2);
    this.pos.setUsage(THREE.DynamicDrawUsage); this.uv.setUsage(THREE.DynamicDrawUsage);
    const nor = new Float32Array(max * 6);
    for (let i = 0; i < max * 2; i++) nor[i * 3 + 1] = 1;
    const idx: number[] = [];
    for (let i = 0; i < max - 1; i++) { const p = i * 2; idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3); }
    g.setAttribute("position", this.pos); g.setAttribute("uv", this.uv); g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
  }
  /** track: newest first, [x, y, dirX, dirY, age, h]; width(age), v(age) 0..1. On a
   * turn the inner half is kept inside the turning radius, so the strip never folds. */
  set(track: number[][], width: (age: number) => number, v: (age: number) => number) {
    const n = Math.min(track.length, this.max), p = this.pos.array as Float32Array, t = this.uv.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const [x, y, dx, dy, age, h] = track[i], w = width(age);
      let wl = w, wr = w;
      const a = track[Math.max(0, i - 1)], b = track[Math.min(n - 1, i + 1)];
      if (a !== b) {
        const cross = b[2] * a[3] - b[3] * a[2], dot = b[2] * a[2] + b[3] * a[3];
        const dth = Math.atan2(cross, dot), ds = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (Math.abs(dth) > 1e-4 && ds > 1e-3) {
          const radius = ds / Math.abs(dth);
          // Turning left (dth > 0 from older to newer): the left side is inside.
          if (dth > 0) wl = Math.min(wl, radius * 0.7); else wr = Math.min(wr, radius * 0.7);
        }
      }
      p.set([x - dy * wl, h, -(y + dx * wl), x + dy * wr, h, -(y - dx * wr)], i * 6);
      const vv = v(age);
      t.set([0, vv, 1, vv], i * 4);
    }
    // The rest collapse onto the last pair (degenerate triangles): the WebGPU adapter
    // draws the whole index buffer, not the draw range.
    const lastP = n ? p.slice((n - 1) * 6, n * 6) : new Float32Array(6), lastT = n ? t.slice((n - 1) * 4, n * 4) : new Float32Array(4);
    for (let i = n; i < this.max; i++) { p.set(lastP, i * 6); t.set(lastT, i * 4); }
    this.mesh.visible = n > 1;
    this.pos.needsUpdate = true; this.uv.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
  }
}

/* ---------- Spray ---------- */

class Spray {
  mesh: THREE.InstancedMesh;
  private p: Float32Array; private v: Float32Array; private life: Float32Array; private max: Float32Array; private size: Float32Array;
  private next = 0; private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private sc = new THREE.Vector3(); private at = new THREE.Vector3();
  constructor(public n: number, tex: THREE.Texture) {
    const mat = new THREE.MeshStandardMaterial({ color: "#ffffff", map: tex, transparent: true, opacity: 0.55, depthWrite: false, roughness: 1, metalness: 0, emissive: "#ffffff", emissiveIntensity: 0.1 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.life = new Float32Array(n).fill(1); this.max = new Float32Array(n).fill(1); this.size = new Float32Array(n);
    this.mesh.count = n;
  }
  /** World position and velocity (m, m/s). */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.p.set([x, y, z], i * 3); this.v.set([vx, vy, vz], i * 3); this.life[i] = 0; this.max[i] = life; this.size[i] = size;
  }
  update(dt: number, camera: THREE.Camera, surface: (x: number, z: number) => number) {
    this.q.copy(camera.quaternion);
    // Drag on each droplet cloud, gravity; a cloud that falls back to the water is gone.
    const drag = Math.exp(-1.6 * dt);
    for (let i = 0; i < this.n; i++) {
      let s = 0;
      if (this.life[i] < this.max[i]) {
        const o = i * 3;
        this.v[o] *= drag; this.v[o + 2] *= drag; this.v[o + 1] = this.v[o + 1] * drag - G * dt;
        this.p[o] += this.v[o] * dt; this.p[o + 1] += this.v[o + 1] * dt; this.p[o + 2] += this.v[o + 2] * dt;
        this.life[i] += dt;
        const k = this.life[i] / this.max[i];
        if (this.p[o + 1] < surface(this.p[o], this.p[o + 2]) - 0.05 && this.v[o + 1] < 0) this.life[i] = this.max[i];
        else s = this.size[i] * (0.5 + 1.3 * k) * (1 - k * k);
        this.at.set(this.p[o], this.p[o + 1], this.p[o + 2]);
      }
      this.sc.setScalar(Math.max(s, 1e-4));
      this.m.compose(this.at, this.q, this.sc);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* ---------- The fleet ---------- */

export function buildBoats(field: WaterField, cx: number, cy: number, seed: number) {
  const loops = riverLoops(field, cx, cy, [[0.32, -0.3], [0.6, 0.12], [-0.12, -0.58]]);
  if (!loops || loops.every(l => !l)) return null;
  const r = rng(seed * 31 + 5);
  const k = kit(), tx = wakeTextures();
  const group = new THREE.Group();
  const WAKE_AGE = 14, WASH_AGE = 7;
  const wakeMat = (speed: number) => {
    // Crests at the wavelength the speed sets, over the distance the wake covers.
    const lambda = (2 * Math.PI * speed * speed) / G, normal = tx.wakeNormal.clone();
    normal.repeat.set(1, (WAKE_AGE * speed) / lambda);
    normal.needsUpdate = true;
    const m = new THREE.MeshStandardMaterial({ map: tx.wakeMap, normalMap: normal, normalScale: new THREE.Vector2(1.4, 1.4), transparent: true, depthWrite: false, roughness: 0.08, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 });
    return m;
  };
  const washMat = new THREE.MeshStandardMaterial({ color: "#ffffff", map: tx.wash, transparent: true, depthWrite: false, roughness: 0.9, emissive: "#ffffff", emissiveIntensity: 0.06, emissiveMap: tx.wash, polygonOffset: true, polygonOffsetFactor: -4 });
  const spray = new Spray(1600, tx.spray);
  group.add(spray.mesh);
  const specs: { kind: Boat["kind"]; speed: number; loop: Loop | null }[] = [
    { kind: "bowrider", speed: 8.8, loop: loops[0] },
    { kind: "jetski", speed: 14.5, loop: loops[1] },
    { kind: "cruiser", speed: 5.2, loop: loops[2] },
  ];
  const boats: Boat[] = [];
  for (const sp of specs) {
    if (!sp.loop) continue;
    const b = makeBoat(k, sp.kind);
    group.add(b.group);
    const wake = new Ribbon(96, wakeMat(sp.speed), 8), wash = new Ribbon(64, washMat, 9);
    group.add(wake.mesh, wash.mesh);
    const boat: Boat = { group: b.group, loop: sp.loop, speed: sp.speed, L: b.L, beam: b.beam, d: r() * sp.loop.length, phase: r() * 10, pitch: b.pitch, kind: sp.kind, yawPrev: NaN, roll: 0, wake, wash };
    if (sp.kind === "bowrider") {
      // The wakeboarder on 18 m of rope, cutting back and forth across the wake.
      const sg = new THREE.Group();
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.05, 0.43), k.board);
      k.geos.push(board.geometry);
      board.position.y = 0.04; board.castShadow = true;
      sg.add(board);
      const rider = person(k, k.vests[3], "surf");
      // Side-on to the travel: facing starboard, left foot forward.
      rider.position.set(0, 0.07, 0); rider.rotation.y = -Math.PI / 2;
      sg.add(rider);
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 4), k.rope);
      k.geos.push(rope.geometry);
      group.add(sg, rope);
      boat.surfer = { group: sg, board, rope, tow: 18, swing: r() * 6, lateralPrev: 0, x: 0, y: 0 };
      boat.surferWake = new Ribbon(48, washMat, 9);
      group.add(boat.surferWake.mesh);
    }
    boats.push(boat);
  }
  if (!boats.length) return null;
  // Tracks: newest first, [x, y, dirX, dirY, time]; every 0.15 s.
  const tracks = new Map<Boat, number[][]>(), surferTracks = new Map<Boat, number[][]>();
  let time = 0, lastSample = -1, on = false;
  const surface = (x: number, y: number) => field.level(x, y) + 0.12;
  const e = new THREE.Euler(0, 0, 0, "YZX");

  const update = (dt: number, camera: THREE.Camera) => {
    // A frame of no time (the loop just resumed) moves nothing: rates over it are 0/0,
    // and a NaN heel once stored would hide the hull for good.
    if (!on || !(dt > 0)) return;
    dt = Math.min(dt, 0.05);
    time += dt;
    const sample = time - lastSample >= 0.15;
    if (sample) lastSample = time;
    for (const b of boats) {
      b.d += b.speed * dt;
      const p = b.loop.at(b.d);
      // Heel into the turn (planing hulls lean in): tan φ = v²/(g r), r from the heading rate.
      let yawRate = 0;
      if (!Number.isNaN(b.yawPrev)) { let dy = p.yaw - b.yawPrev; dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI; yawRate = dy / dt; }
      b.yawPrev = p.yaw;
      const heel = Math.max(-0.35, Math.min(0.35, Math.atan((b.speed * yawRate) / G) * (b.kind === "cruiser" ? 0.35 : 0.8)));
      if (Number.isFinite(heel)) b.roll += (heel - b.roll) * Math.min(1, dt * 3);
      if (!Number.isFinite(b.roll)) b.roll = 0;
      // Riding the waves: a slow heave and pitch, quicker for a small hull.
      const f = b.kind === "jetski" ? 2.6 : b.kind === "bowrider" ? 1.8 : 1.1;
      const heave = 0.05 * Math.sin(time * f + b.phase), pitchWave = 0.02 * Math.sin(time * f * 1.3 + b.phase * 1.7);
      const h = surface(p.x, p.y);
      b.group.position.set(p.x, h + heave + (b.kind === "cruiser" ? 0 : 0.12), -p.y);
      e.set(-b.roll, p.yaw, b.pitch + pitchWave);
      b.group.quaternion.setFromEuler(e);
      // Tracks from the stern.
      const sx = p.x - p.tx * b.L * 0.45, sy = p.y - p.ty * b.L * 0.45;
      const tr = tracks.get(b) ?? [];
      if (sample || !tr.length) { tr.unshift([sx, sy, p.tx, p.ty, time]); if (tr.length > 96) tr.pop(); }
      tracks.set(b, tr);
      const live = [[sx, sy, p.tx, p.ty, 0, h + 0.03], ...tr.map(s => [s[0], s[1], s[2], s[3], time - s[4], surface(s[0], s[1]) + 0.03])].filter(s => s[4] <= WAKE_AGE);
      b.wake.set(live, age => b.beam * 0.5 + age * b.speed * KELVIN, age => age / WAKE_AGE);
      const liveWash = live.filter(s => s[4] <= WASH_AGE).map(s => [s[0], s[1], s[2], s[3], s[4], s[5] + 0.02]);
      // The prop wash stays about the hull's width, spreading slowly as it settles.
      b.wash.set(liveWash, age => b.beam * 0.45 + age * 0.35, age => age / WASH_AGE);
      // Spray: sheets off both sides of the bow; a jet ski's rooster tail.
      const bowX = p.x + p.tx * b.L * 0.28, bowY = p.y + p.ty * b.L * 0.28;
      const rate = b.speed * (b.kind === "cruiser" ? 2.5 : 6.5) * dt;
      for (let n = rate + r(); n >= 1; n--) {
        const side = r() < 0.5 ? -1 : 1, out = 1.2 + r() * 2.2;
        const nx = -p.ty * side, ny = p.tx * side;
        spray.emit(bowX + nx * b.beam * 0.45, h + 0.15, -(bowY + ny * b.beam * 0.45),
          p.tx * b.speed * 0.35 + nx * out, 1.2 + r() * 2.4 * (b.speed / 10), -(p.ty * b.speed * 0.35 + ny * out), 0.14 + r() * 0.22, 0.5 + r() * 0.5);
      }
      if (b.kind === "jetski") {
        for (let n = 70 * dt + r(); n >= 1; n--) {
          spray.emit(sx, h + 0.2, -sy, -p.tx * (3 + r() * 3) + (r() - 0.5), 4 + r() * 3, p.ty * (3 + r() * 3) + (r() - 0.5), 0.2 + r() * 0.3, 0.8 + r() * 0.5);
        }
      }
      if (b.surfer) {
        const s = b.surfer;
        // Along the track behind the boat, swinging out across the wake (±6 m) and back.
        const q = b.loop.at(b.d - s.tow);
        const lateral = 6 * Math.sin(time * 0.42 + s.swing);
        const nx = -q.ty, ny = q.tx;
        s.x = q.x + nx * lateral; s.y = q.y + ny * lateral;
        const lvRaw = (lateral - s.lateralPrev) / dt; s.lateralPrev = lateral;
        const lv = Number.isFinite(lvRaw) ? Math.max(-8, Math.min(8, lvRaw)) : 0;
        const hs = surface(s.x, s.y);
        s.group.position.set(s.x, hs + 0.02 + 0.03 * Math.sin(time * 3 + s.swing), -s.y);
        // The board points a little across its path; the rider leans against the rope and into the cut.
        const cut = Math.atan2(lv, b.speed);
        e.set(Math.max(-0.5, Math.min(0.5, -lv * 0.09)), q.yaw - cut, 0.1);
        s.group.quaternion.setFromEuler(e);
        // Rope from the pylon to the handle.
        const pylon = new THREE.Vector3(-1.3, 1.75, 0).applyQuaternion(b.group.quaternion).add(b.group.position);
        const handle = new THREE.Vector3(0.5, 0.95, 0).applyQuaternion(s.group.quaternion).add(s.group.position);
        const mid = pylon.clone().add(handle).multiplyScalar(0.5), dir = handle.clone().sub(pylon);
        s.rope.position.copy(mid);
        s.rope.scale.set(1, dir.length(), 1);
        s.rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        const st = surferTracks.get(b) ?? [];
        if (sample || !st.length) { st.unshift([s.x, s.y, q.tx, q.ty, time]); if (st.length > 48) st.pop(); }
        surferTracks.set(b, st);
        const sl = [[s.x, s.y, q.tx, q.ty, 0, hs + 0.05], ...st.map(v => [v[0], v[1], v[2], v[3], time - v[4], surface(v[0], v[1]) + 0.05])].filter(v => v[4] <= 5);
        b.surferWake!.set(sl, age => 0.25 + age * 0.3, age => age / 5);
        // Spray off the board's edge, most on the hardest cut.
        for (let n = (8 + Math.abs(lv) * 10) * dt + r(); n >= 1; n--) {
          const side = lv > 0 ? -1 : 1;
          spray.emit(s.x + nx * side * 0.4, hs + 0.1, -(s.y + ny * side * 0.4), q.tx * b.speed * 0.2 + nx * side * (1 + Math.abs(lv) * 0.6), 1 + r() * 2 + Math.abs(lv) * 0.4, -(q.ty * b.speed * 0.2 + ny * side * (1 + Math.abs(lv) * 0.6)), 0.12 + r() * 0.2, 0.45 + r() * 0.4);
        }
      }
    }
    spray.update(dt, camera, (x, z) => surface(x, -z));
  };

  group.visible = false;
  return {
    group,
    update,
    /** World positions of the boats (and the wakeboarder), for tests. */
    positions: () => boats.map(b => ({ kind: b.kind, at: b.group.position.clone(), yaw: b.loop.at(b.d).yaw, surfer: b.surfer?.group.position.clone() })),
    /** Out in clear weather while the sun is up (to just after sunset). */
    setLook(l: Look) {
      const next = l.rain < 0.05 && l.snow < 0.05 && l.sunElev > -4;
      if (next === on) return;
      on = next; group.visible = on;
      if (!on) { tracks.clear(); surferTracks.clear(); for (const b of boats) { b.yawPrev = NaN; b.wake.set([], () => 0, () => 0); b.wash.set([], () => 0, () => 0); b.surferWake?.set([], () => 0, () => 0); } }
    },
    dispose() {
      k.geos.forEach(g => g.dispose());
      [k.hull, k.glass, k.skin, k.dark, k.hair, k.white, k.board, k.rope, k.chrome, ...k.vests, washMat].forEach(m => m.dispose());
      boats.forEach(b => { b.group.traverse(o => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); }); b.wake.mesh.geometry.dispose(); (b.wake.mesh.material as THREE.MeshStandardMaterial).normalMap?.dispose(); (b.wake.mesh.material as THREE.Material).dispose(); b.wash.mesh.geometry.dispose(); b.surferWake?.mesh.geometry.dispose(); });
      spray.mesh.geometry.dispose(); (spray.mesh.material as THREE.Material).dispose();
    },
  };
}
