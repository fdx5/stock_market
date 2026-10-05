import * as THREE from "three";
import { mergeGeometries, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { fetchStatic } from "../../staticCdn";

/* Passenger cars built from their proportions, in place of the Kenney kit's blocky bodies:
 * a side profile (bonnet, windscreen, roof, rear screen, boot or hatch) lofted through
 * cross-sections with tumblehome (the glasshouse narrower than the body), rounded in plan,
 * wheel arches, and wheels with tyre and rim. Proportions after the cars on Korean roads
 * (Sonata / Avante sedans, Tucson / Santa Fe SUVs, Morning, Staria). About 2k triangles a
 * car, made in a few milliseconds, nothing to download.
 *
 * Colours are swatches of the kit's palette texture (/3d/vehicles.png) picked by uv, so the
 * cars keep its material and the WebGPU view's car paint (sceneStreet, ComplexRenderer):
 * the red body swatch takes the instance's paint, the pale blue one is glazing, the dark
 * one tyres and trim. Front is +z, x across, y up, wheels on y = 0 (as the kit). */

type Swatch = keyof typeof SWATCH;
// Centres of the palette's 64 px cells (uv, flipY false).
const SWATCH = {
  body: [0.3125, 0.8125], glass: [0.0625, 0.0625], trim: [0.1875, 0.5625], rim: [0.5625, 0.5625],
  lamp: [0.8125, 0.5625], signal: [0.1875, 0.8125], tail: [0.8125, 0.3125],
} as const;

export interface CarSpec {
  length: number; width: number; height: number;
  /** Top of the body along the car, rear (0) to front (1): [t, height m]. */
  top: [number, number][];
  /** The glasshouse: from where to where along the car (t), and the belt line height. */
  cabin: [number, number]; belt: number;
  /** Axles (t) and wheel radius; ground clearance under the sills. */
  axles: [number, number]; wheel: number; clearance: number;
  /** Glass side lean (m inward per m up) and the roof's half width as a share of the body. */
  tumble: number; roof: number;
  /** A taxi's roof sign. */
  sign?: boolean;
}

export const CAR_SPECS: Record<string, CarSpec> = {
  // mid-size saloon (Sonata / Grandeur)
  sedan: { length: 4.9, width: 1.86, height: 1.45, top: [[0, 0.68], [0.03, 0.9], [0.1, 0.98], [0.22, 1.0], [0.3, 1.06], [0.4, 1.38], [0.5, 1.45], [0.6, 1.42], [0.7, 1.12], [0.76, 1.0], [0.9, 0.93], [0.97, 0.8], [1, 0.62]],
    cabin: [0.3, 0.72], belt: 0.98, axles: [0.19, 0.78], wheel: 0.33, clearance: 0.16, tumble: 0.32, roof: 0.72 },
  // sporty compact saloon (Avante)
  "sedan-sports": { length: 4.65, width: 1.82, height: 1.4, top: [[0, 0.66], [0.03, 0.88], [0.12, 0.97], [0.24, 1.0], [0.33, 1.12], [0.44, 1.37], [0.54, 1.4], [0.63, 1.35], [0.72, 1.06], [0.78, 0.96], [0.92, 0.88], [0.98, 0.74], [1, 0.58]],
    cabin: [0.3, 0.74], belt: 0.95, axles: [0.19, 0.79], wheel: 0.32, clearance: 0.14, tumble: 0.36, roof: 0.7 },
  // compact SUV (Tucson)
  suv: { length: 4.63, width: 1.87, height: 1.68, top: [[0, 0.8], [0.02, 1.12], [0.05, 1.55], [0.15, 1.66], [0.5, 1.68], [0.62, 1.62], [0.73, 1.22], [0.8, 1.13], [0.93, 1.08], [0.98, 0.95], [1, 0.72]],
    cabin: [0.05, 0.74], belt: 1.1, axles: [0.18, 0.8], wheel: 0.37, clearance: 0.2, tumble: 0.22, roof: 0.78 },
  // large SUV (Santa Fe / Palisade)
  "suv-luxury": { length: 4.95, width: 1.95, height: 1.75, top: [[0, 0.84], [0.02, 1.2], [0.04, 1.62], [0.12, 1.74], [0.55, 1.75], [0.66, 1.68], [0.76, 1.26], [0.82, 1.17], [0.94, 1.12], [0.985, 1.0], [1, 0.76]],
    cabin: [0.04, 0.76], belt: 1.14, axles: [0.17, 0.81], wheel: 0.39, clearance: 0.21, tumble: 0.2, roof: 0.8 },
  // city car (Morning / Casper)
  "hatchback-sports": { length: 3.6, width: 1.6, height: 1.5, top: [[0, 0.72], [0.02, 1.02], [0.05, 1.42], [0.14, 1.49], [0.52, 1.5], [0.64, 1.42], [0.76, 1.02], [0.84, 0.92], [0.95, 0.84], [1, 0.62]],
    cabin: [0.05, 0.77], belt: 0.96, axles: [0.16, 0.83], wheel: 0.29, clearance: 0.15, tumble: 0.26, roof: 0.76 },
  // minivan (Staria / Carnival)
  van: { length: 5.2, width: 2.0, height: 1.95, top: [[0, 0.9], [0.015, 1.4], [0.03, 1.86], [0.1, 1.95], [0.68, 1.95], [0.76, 1.84], [0.86, 1.32], [0.92, 1.1], [0.98, 0.98], [1, 0.74]],
    cabin: [0.03, 0.86], belt: 1.08, axles: [0.16, 0.83], wheel: 0.34, clearance: 0.18, tumble: 0.14, roof: 0.84 },
  // large saloon (Grandeur / Genesis G80): long bonnet, fastback roofline
  "sedan-large": { length: 5.0, width: 1.88, height: 1.47, top: [[0, 0.7], [0.03, 0.92], [0.1, 1.0], [0.2, 1.03], [0.28, 1.1], [0.4, 1.4], [0.5, 1.47], [0.6, 1.44], [0.69, 1.12], [0.75, 1.02], [0.9, 0.96], [0.97, 0.82], [1, 0.64]],
    cabin: [0.28, 0.71], belt: 1.0, axles: [0.19, 0.79], wheel: 0.34, clearance: 0.15, tumble: 0.3, roof: 0.72 },
  // small SUV (Kona / Seltos)
  "suv-small": { length: 4.35, width: 1.82, height: 1.58, top: [[0, 0.78], [0.02, 1.08], [0.06, 1.46], [0.16, 1.56], [0.48, 1.58], [0.6, 1.5], [0.72, 1.14], [0.8, 1.05], [0.93, 1.0], [0.98, 0.88], [1, 0.68]],
    cabin: [0.06, 0.73], belt: 1.04, axles: [0.18, 0.81], wheel: 0.35, clearance: 0.18, tumble: 0.24, roof: 0.76 },
  // boxy city car (Ray / Casper): tall and square
  "kei-box": { length: 3.6, width: 1.6, height: 1.7, top: [[0, 0.8], [0.02, 1.2], [0.035, 1.62], [0.1, 1.7], [0.62, 1.7], [0.7, 1.6], [0.8, 1.12], [0.88, 1.0], [0.96, 0.9], [1, 0.66]],
    cabin: [0.035, 0.81], belt: 1.0, axles: [0.15, 0.84], wheel: 0.29, clearance: 0.15, tumble: 0.1, roof: 0.88 },
  // minivan (Carnival): long, lower than the Staria
  mpv: { length: 5.15, width: 1.99, height: 1.78, top: [[0, 0.86], [0.015, 1.3], [0.03, 1.7], [0.1, 1.78], [0.6, 1.78], [0.7, 1.7], [0.8, 1.22], [0.87, 1.08], [0.97, 0.98], [1, 0.72]],
    cabin: [0.03, 0.8], belt: 1.08, axles: [0.16, 0.82], wheel: 0.36, clearance: 0.18, tumble: 0.16, roof: 0.82 },
  // pickup (Rexton Sports): open bed behind a double cab, tall bonnet
  pickup: { length: 5.42, width: 1.95, height: 1.84, top: [[0, 0.95], [0.02, 1.16], [0.36, 1.18], [0.385, 1.5], [0.41, 1.8], [0.47, 1.84], [0.62, 1.82], [0.7, 1.46], [0.76, 1.3], [0.94, 1.24], [0.985, 1.06], [1, 0.8]],
    cabin: [0.4, 0.72], belt: 1.18, axles: [0.2, 0.82], wheel: 0.4, clearance: 0.24, tumble: 0.18, roof: 0.8 },
  taxi: { length: 4.9, width: 1.86, height: 1.45, top: [[0, 0.68], [0.03, 0.9], [0.1, 0.98], [0.22, 1.0], [0.3, 1.06], [0.4, 1.38], [0.5, 1.45], [0.6, 1.42], [0.7, 1.12], [0.76, 1.0], [0.9, 0.93], [0.97, 0.8], [1, 0.62]],
    cabin: [0.3, 0.72], belt: 0.98, axles: [0.19, 0.78], wheel: 0.33, clearance: 0.16, tumble: 0.32, roof: 0.72, sign: true },
};

/** Catmull-Rom through [t, v] points (t ascending). */
function curve(points: [number, number][], t: number) {
  const n = points.length;
  let i = 0;
  while (i < n - 2 && points[i + 1][0] < t) i++;
  const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(n - 1, i + 2)];
  const u = THREE.MathUtils.clamp((t - p1[0]) / Math.max(1e-6, p2[0] - p1[0]), 0, 1);
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * u + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3);
}

class Builder {
  pos: number[] = []; uv: number[] = [];
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, s: Swatch) {
    const [u, v] = SWATCH[s];
    for (const p of [a, b, c]) { this.pos.push(p.x, p.y, p.z); this.uv.push(u, v); }
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, s: Swatch) { this.tri(a, b, c, s); this.tri(a, c, d, s); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

const STATIONS = 40, HALF = 11;

/** The body shell: stations along the car, each a closed section (mirrored half). */
function body(sp: CarSpec, b: Builder) {
  const L = sp.length, W = sp.width / 2;
  const zOf = (t: number) => (t - 0.5) * L;
  // Rounded in plan: full width over most of the length, easing in at both ends.
  const halfW = (t: number) => {
    const e = Math.abs(t - 0.5) * 2;
    return W * Math.pow(Math.max(0, 1 - Math.pow(e, 7)), 0.18) * (t > 0.5 ? 1 : 0.985);
  };
  const bottom = (t: number) => sp.clearance + 0.12 * Math.pow(Math.abs(t - 0.5) * 2, 6);
  const sections: THREE.Vector3[][] = [];
  const kinds: Swatch[][] = [];
  // Wheel arches: over each wheel the lower side is cut round, a hand's width above the tyre.
  const axleZ = sp.axles.map(zOf), R = sp.wheel, open = R + 0.07;
  const archY = (z: number) => {
    let y = -Infinity;
    for (const a of axleZ) { const dz = Math.abs(z - a); if (dz < open) y = Math.max(y, R + Math.sqrt(open * open - dz * dz)); }
    return y;
  };
  for (let i = 0; i <= STATIONS; i++) {
    // (stations closer together at the ends, where the shape turns fastest)
    const s = i / STATIONS, t = 0.5 - 0.5 * Math.cos(Math.PI * s);
    const z = zOf(t), w = Math.max(0.02, halfW(t)), top = Math.max(bottom(t) + 0.1, curve(sp.top, t));
    const y0 = Math.min(bottom(t), top - 0.05);
    const cabin = t >= sp.cabin[0] && t <= sp.cabin[1] && top > sp.belt + 0.08;
    const shoulder = Math.min(top, sp.belt);
    // half section, bottom centre round to top centre
    const pts: [number, number, Swatch][] = [];
    pts.push([0, y0, "trim"], [w * 0.86, y0, "trim"], [w * 0.97, y0 + 0.07, "body"]);
    pts.push([w, y0 + (shoulder - y0) * 0.45, "body"], [w * 0.985, shoulder - 0.06 * Math.min(1, shoulder - y0), "body"], [w * 0.95, shoulder, "body"]);
    if (cabin) {
      const gh = top - shoulder;
      const rw = Math.max(0.1, w * sp.roof);
      pts.push([Math.max(rw, w * 0.95 - sp.tumble * gh * 0.55), shoulder + gh * 0.55, "glass"], [rw + 0.04, top - 0.03, "glass"], [rw * 0.6, top, "body"], [rw * 0.25, top + 0.012, "body"], [0, top + 0.015, "body"]);
    } else {
      const k = Math.max(0, top - shoulder);
      pts.push([w * 0.9, shoulder + k * 0.5, "body"], [w * 0.8, top, "body"], [w * 0.55, top + 0.012, "body"], [w * 0.25, top + 0.02, "body"], [0, top + 0.022, "body"]);
    }
    // (the lower side points rise over the wheels: the arch opening)
    const ay = archY(z);
    sections.push(pts.map(([x, y], j) => new THREE.Vector3(x, j >= 1 && j <= 3 ? Math.max(y, Math.min(ay, shoulder - 0.08)) : y, z)));
    kinds.push(pts.map(p => p[2]));
  }
  const [a0, a1] = axleZ;
  const arch = (p: THREE.Vector3) => Math.min(Math.hypot(p.z - a0, p.y - R), Math.hypot(p.z - a1, p.y - R)) < R + 0.12 && p.x > sp.width / 2 * 0.8;
  for (let i = 0; i < STATIONS; i++) {
    const A = sections[i], B = sections[i + 1];
    const tMid = 0.5 - 0.5 * Math.cos(Math.PI * (i + 0.5) / STATIONS);
    const front = tMid > 0.965, rear = tMid < 0.035;
    for (let j = 0; j < HALF - 1; j++) {
      let s: Swatch = kinds[i][j + 1] === "glass" && kinds[i + 1][j + 1] === "glass" ? "glass" : kinds[i][j] === "trim" ? "trim" : "body";
      // windscreen and rear screen: the steep part of the top over the cabin
      const topFace = j >= HALF - 3;
      if (topFace) {
        const dy = Math.abs(B[j].y - A[j].y) / Math.max(1e-4, Math.abs(B[j].z - A[j].z));
        if (dy > 0.45 && tMid > sp.cabin[0] - 0.02 && tMid < sp.cabin[1] + 0.02 && A[j].y > sp.belt) s = "glass";
      }
      const mid = A[j].clone().add(B[j + 1]).multiplyScalar(0.5);
      if (s === "body" && arch(mid)) s = "trim";
      // lamps: the outer corners of the nose and tail, grille between the headlamps
      if (s === "body" && (front || rear) && mid.y > sp.belt - 0.38 && mid.y < sp.belt - 0.1) s = mid.x > sp.width * 0.24 ? (front ? "lamp" : "tail") : front ? "trim" : s;
      if (s === "body" && (front || rear) && mid.y < sp.clearance + 0.22) s = "trim";
      for (const m of [1, -1]) {
        const p = (v: THREE.Vector3) => new THREE.Vector3(v.x * m, v.y, v.z);
        if (m > 0) b.quad(p(A[j]), p(A[j + 1]), p(B[j + 1]), p(B[j]), s);
        else b.quad(p(A[j]), p(B[j]), p(B[j + 1]), p(A[j + 1]), s);
      }
    }
  }
  // caps at the very nose and tail
  for (const [k, flip] of [[0, true], [STATIONS, false]] as const) {
    const S = sections[k], c = new THREE.Vector3(0, (S[0].y + S[HALF - 1].y) / 2, S[0].z);
    for (let j = 0; j < HALF - 1; j++) for (const m of [1, -1]) {
      const p = (v: THREE.Vector3) => new THREE.Vector3(v.x * m, v.y, v.z);
      if (flip === (m > 0)) b.tri(c, p(S[j]), p(S[j + 1]), "body"); else b.tri(c, p(S[j + 1]), p(S[j]), "body");
    }
  }
}

/** A wheel: tyre tread and walls, a rim face with spokes' shade, at (x, z) facing out. */
function wheel(b: Builder, x: number, z: number, R: number, width: number, out: 1 | -1) {
  const N = 20, inner = x - out * width / 2, outer = x + out * width / 2;
  const rimR = R * 0.62;
  const at = (a: number, r: number, xx: number) => new THREE.Vector3(xx, R + Math.sin(a) * r, z + Math.cos(a) * r);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, c = ((i + 1) / N) * Math.PI * 2;
    const q = (p: THREE.Vector3, r: THREE.Vector3, s: THREE.Vector3, t: THREE.Vector3, sw: Swatch) => out > 0 ? b.quad(p, r, s, t, sw) : b.quad(p, t, s, r, sw);
    q(at(a, R, inner), at(c, R, inner), at(c, R, outer), at(a, R, outer), "trim");                       // tread
    q(at(a, R, outer), at(c, R, outer), at(c, rimR, outer - out * 0.02), at(a, rimR, outer - out * 0.02), "trim"); // sidewall
    const hub = new THREE.Vector3(outer - out * 0.05, R, z);
    const spoke = i % 4 < 2 ? "rim" : "trim";
    if (out > 0) b.tri(hub, at(c, rimR, outer - out * 0.02), at(a, rimR, outer - out * 0.02), spoke);
    else b.tri(hub, at(a, rimR, outer - out * 0.02), at(c, rimR, outer - out * 0.02), spoke);
  }
}

const cache = new Map<string, THREE.BufferGeometry>();
/** A car's shape made elsewhere (vehicleWorker): taken as this kind's from now on. */
export function primeCarGeometry(kind: string, g: THREE.BufferGeometry) { if (!cache.has(kind)) cache.set(kind, g); }

/** The car of a kind (CAR_SPECS keys), shared by every car of that kind. */
export function carGeometry(kind: string): THREE.BufferGeometry | null {
  const sp = CAR_SPECS[kind];
  if (!sp) return null;
  const hit = cache.get(kind);
  if (hit) return hit;
  const b = new Builder();
  body(sp, b);
  // (outer tyre face just inside the body side)
  const L = sp.length, x = sp.width / 2 - 0.04 - 0.11;
  for (const t of sp.axles) for (const side of [1, -1] as const) wheel(b, x * side, (t - 0.5) * L, sp.wheel, 0.22, side);
  // side mirrors
  const top = curve(sp.top, sp.cabin[1] - 0.04);
  for (const side of [1, -1]) {
    const m = new THREE.BoxGeometry(0.2, 0.11, 0.14).toNonIndexed();
    m.translate(side * (sp.width / 2 + 0.05), sp.belt + 0.08, (sp.cabin[1] - 0.05 - 0.5) * L);
    const n = m.getAttribute("position").count, uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) uv.set(SWATCH.body, i * 2);
    m.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); m.deleteAttribute("normal");
    b.pos.push(...(m.getAttribute("position").array as Float32Array)); b.uv.push(...uv);
    m.dispose();
  }
  const parts = [b.geometry()];
  if (sp.sign) {
    // 택시 roof sign
    const s = new THREE.BoxGeometry(0.55, 0.16, 0.26).toNonIndexed();
    s.translate(0, top + 0.1, 0);
    const n = s.getAttribute("position").count, uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) uv.set(SWATCH.signal, i * 2);
    s.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); s.deleteAttribute("normal");
    parts.push(s);
  }
  const merged = parts.length > 1 ? mergeGeometries(parts)! : parts[0];
  // Smooth over the panels, hard at real creases (sills, screen edges, wheel faces).
  const g = toCreasedNormals(merged, (40 * Math.PI) / 180);
  parts.forEach(p => p.dispose()); if (merged !== parts[0]) merged.dispose();
  cache.set(kind, g);
  return g;
}

/* Detailed cars modelled in Blender (scripts/gen-cars.py): public/3d/cars.bin, same
 * proportions and palette swatches as the ones built above, which stay as the fallback. */
interface CarPart { verts: number; index: number; pos: number; nor: number; uv: number; idx: number }
let modelled: Promise<Map<string, THREE.BufferGeometry>> | null = null;
export function loadCarModels(): Promise<Map<string, THREE.BufferGeometry>> {
  modelled ??= Promise.all([
    fetchStatic("/3d/cars.json").then(r => { if (!r.ok) throw new Error("cars.json " + r.status); return r.json() as Promise<{ kinds: Record<string, CarPart> }>; }),
    fetchStatic("/3d/cars.bin").then(r => { if (!r.ok) throw new Error("cars.bin " + r.status); return r.arrayBuffer(); }),
  ]).then(([meta, bin]) => {
    const out = new Map<string, THREE.BufferGeometry>();
    for (const [kind, p] of Object.entries(meta.kinds)) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(bin, p.pos, p.verts * 3).slice(), 3));
      const n8 = new Int8Array(bin, p.nor, p.verts * 4), nor = new Float32Array(p.verts * 3);
      for (let i = 0; i < p.verts; i++) { nor[i * 3] = n8[i * 4] / 127; nor[i * 3 + 1] = n8[i * 4 + 1] / 127; nor[i * 3 + 2] = n8[i * 4 + 2] / 127; }
      g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      const u16 = new Uint16Array(bin, p.uv, p.verts * 2), uv = new Float32Array(p.verts * 2);
      for (let i = 0; i < uv.length; i++) uv[i] = u16[i] / 65535;
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g.setIndex(new THREE.BufferAttribute(new Uint16Array(bin, p.idx, p.index).slice(), 1));
      g.computeBoundingSphere();
      out.set(kind, g);
    }
    return out;
  });
  modelled.catch(() => { modelled = null; });
  return modelled;
}

/** Parts of the modelled cars by uv slot (gen-cars.py PARTS), for renderers that read
 * colours (WebGL): body white (times the instance's paint), glass, trim, rims, chrome,
 * head and tail lamps, plates, the taxi sign, tyres, aluminium panels (truck boxes, beds),
 * the white cabs of trucks whose body is painted (container, refuse, mixer). The WebGPU view sets each part's
 * surface itself (ComplexRenderer CAR_MODEL). */
const PART_RGB = ["#ffffff", "#1b2028", "#141414", "#9ea3a8", "#c8ccd0", "#f2efe6", "#9a1c1c", "#eeeeea", "#f0a823", "#0c0c0c", "#d4d7da", "#eeeeeb"];
let partTex: THREE.Texture | null = null;
/** The modelled cars' lamps lit (night): head lamps white, tail lamps red, by the same uv slots. */
export function carLampMap() {
  const c = document.createElement("canvas"); c.width = 16; c.height = 1;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000"; g.fillRect(0, 0, 16, 1);
  g.fillStyle = "#fff4dc"; g.fillRect(5, 0, 1, 1);
  g.fillStyle = "#ff1a10"; g.fillRect(6, 0, 1, 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
}
export function carModelMaterial() {
  if (!partTex) {
    const c = document.createElement("canvas"); c.width = 16; c.height = 1;
    const g = c.getContext("2d")!;
    PART_RGB.forEach((col, i) => { g.fillStyle = col; g.fillRect(i, 0, 1, 1); });
    partTex = new THREE.CanvasTexture(c);
    partTex.colorSpace = THREE.SRGBColorSpace; partTex.magFilter = partTex.minFilter = THREE.NearestFilter; partTex.generateMipmaps = false;
  }
  const m = new THREE.MeshStandardMaterial({ map: partTex, roughness: 0.4, metalness: 0.2 });
  m.userData.carModel = true;
  return m;
}
