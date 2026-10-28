import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/* The walk's trees, no leaf cards: a crown is a solid volume — overlapping lumps, each a low icosphere
 * pushed about by noise so the outline is ragged and the sky shows between them — and the leaves
 * are drawn on it in the shader: clumps of foliage from 3D cellular noise in the tree's own space
 * (each clump rounded by bump-lighting, darker in its hollows, some clumps another shade), fine leaf
 * texture over that, the crown darker inside and underneath (a vertex attribute), the bump faded
 * where a pixel covers more than a clump. Opaque: no alpha test, no overdraw.
 *   near (to 140 m)  broadleaf ≈ 1 100 triangles (trunk and limbs, ten lumps); pine ≈ 1 000
 *   far              one lump and a five-sided trunk: ≈ 100
 * The model's crown radius is 3 m (the instance scale is the photo's crown radius / 3). */

const rng = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

function hashNoise(x: number, y: number, z: number) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s);
}

/** a lump: an icosphere (smooth normals), its surface pushed in and out by noise; normals leaned
 * out from the crown's centre (foliage lit as a mass); the aAO attribute from depth and height */
function lump(c: THREE.Vector3, r: THREE.Vector3, crown: THREE.Vector3, crownR: THREE.Vector3, seed: number, detail = 1) {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute("normal"); g.deleteAttribute("uv"); g = mergeVertices(g);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + (hashNoise(v.x * 2.1 + seed, v.y * 2.1, v.z * 2.1) - 0.5) * 0.16;
    p.setXYZ(i, c.x + v.x * r.x * n, c.y + v.y * r.y * n, c.z + v.z * r.z * n);
  }
  g.computeVertexNormals();
  const nor = g.attributes.normal, ao = new Float32Array(p.count), d = new THREE.Vector3(), w = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i).sub(crown); d.set(d.x / crownR.x, d.y / crownR.y, d.z / crownR.z);
    const depth = Math.min(1, d.length());
    w.fromBufferAttribute(nor, i).lerp(d.clone().normalize(), 0.7).normalize(); nor.setXYZ(i, w.x, w.y, w.z);
    ao[i] = THREE.MathUtils.clamp(0.35 + 0.65 * depth * depth, 0, 1) * THREE.MathUtils.clamp(0.72 + 0.28 * (d.y + 0.4), 0.55, 1);
  }
  g.setAttribute("aAO", new THREE.BufferAttribute(ao, 1));
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(p.count * 2), 2));
  // (white: the instance's colour is the foliage's — vertex colours on so it reaches the fragment)
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(p.count * 3).fill(1), 3));
  return g;
}

/** a limb: a tapered five-sided tube on a gentle curve, bark uv in metres */
function limb(from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, bend: THREE.Vector3, seg = 5, rad = 5) {
  const mid = from.clone().lerp(to, 0.5).add(bend), curve = new THREE.QuadraticBezierCurve3(from, mid, to);
  const g = new THREE.TubeGeometry(curve, seg, 1, rad, false), pos = g.getAttribute("position"), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.floor(i / (rad + 1)) / seg; curve.getPointAt(t, c); const r = r0 + (r1 - r0) * t;
    pos.setXYZ(i, c.x + (pos.getX(i) - c.x) * r, c.y + (pos.getY(i) - c.y) * r, c.z + (pos.getZ(i) - c.z) * r);
  }
  const uv = g.getAttribute("uv"), len = curve.getLength();
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * len / 1.5);
  g.computeVertexNormals();
  return g;
}
const merge = (l: THREE.BufferGeometry[]) => {
  const parts = l.map(g => (g.index ? g.toNonIndexed() : g)), m = mergeGeometries(parts)!;
  parts.forEach((g, i) => { if (g !== l[i]) g.dispose(); }); l.forEach(g => g.dispose()); return m;
};

export interface TreeKind { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry; trunkFar: THREE.BufferGeometry; crownFar: THREE.BufferGeometry; pine: boolean }

/** a broad-leaved tree (zelkova, cherry, maple): a trunk forking into limbs under a crown of lumps */
export function broadleaf(seed: number): TreeKind {
  const r = rng(seed), trunk: THREE.BufferGeometry[] = [], lumps: THREE.BufferGeometry[] = [];
  const H = 3.1 + r() * 0.6, top = new THREE.Vector3((r() - 0.5) * 0.3, H, (r() - 0.5) * 0.3);
  trunk.push(limb(new THREE.Vector3(0, -0.2, 0), top, 0.21, 0.15, new THREE.Vector3((r() - 0.5) * 0.25, 0, (r() - 0.5) * 0.25), 5, 7));
  const n = 4 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.6, out = 1.4 + r() * 0.8, up = 1.6 + r() * 1.0;
    trunk.push(limb(top, top.clone().add(new THREE.Vector3(Math.cos(a) * out, up, Math.sin(a) * out)), 0.12, 0.05, new THREE.Vector3(0, -0.3, 0)));
  }
  const cc = new THREE.Vector3(0, H + 2.6, 0), cr = new THREE.Vector3(3.0, 2.5, 3.0);
  // the crown: a top, a ring of five round its waist, three above, one low in the middle
  const spots: [number, number, number, number][] = [[0, 1.2, 0, 1.55], [0, -0.6, 0, 1.6]];
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + r() * 0.5; spots.push([Math.cos(a) * 1.75, -0.15 + (r() - 0.5) * 0.6, Math.sin(a) * 1.75, 1.35 + r() * 0.3]); }
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.6 + r() * 0.5; spots.push([Math.cos(a) * 1.0, 0.85 + r() * 0.3, Math.sin(a) * 1.0, 1.25 + r() * 0.25]); }
  spots.forEach(([x, y, z, s], k) => lumps.push(lump(new THREE.Vector3(cc.x + x, cc.y + y, cc.z + z), new THREE.Vector3(s, s * 0.85, s), cc, cr, seed * 13 + k)));
  const far = lump(cc, new THREE.Vector3(2.9, 2.35, 2.9), cc, cr.clone().multiplyScalar(1.05), seed);
  const trunkFar = new THREE.CylinderGeometry(0.12, 0.2, H + 1.6, 5, 1, true).translate(0, (H + 1.6) / 2 - 0.2, 0);
  return { trunk: merge(trunk), crown: merge(lumps), trunkFar, crownFar: far, pine: false };
}

/** a pine (the complexes' 소나무): a tall leaning trunk, flat tiers of needles, each two lumps */
export function pine(seed: number): TreeKind {
  const r = rng(seed), trunk: THREE.BufferGeometry[] = [], lumps: THREE.BufferGeometry[] = [];
  const lean = new THREE.Vector3(0.5 + r() * 0.4, 6.2, 0.2);
  trunk.push(limb(new THREE.Vector3(0, -0.2, 0), lean, 0.17, 0.08, new THREE.Vector3(0.35, 0, 0), 6, 7));
  const cc = new THREE.Vector3(lean.x * 0.75, 4.8, 0), cr = new THREE.Vector3(1.8, 1.8, 1.6);
  for (let i = 0; i < 5; i++) {
    const y = 3.6 + i * 0.6, a = r() * Math.PI * 2, d = 0.4 + r() * 0.6, c = new THREE.Vector3(lean.x * y / 6.2 + Math.cos(a) * d, y, Math.sin(a) * d);
    trunk.push(limb(new THREE.Vector3(lean.x * y / 6.2, y - 0.3, 0), c, 0.05, 0.03, new THREE.Vector3(0, 0.15, 0), 3, 4));
    for (let k = 0; k < 2; k++) {
      const o = new THREE.Vector3((r() - 0.5) * 0.7, 0.05 * k, (r() - 0.5) * 0.6);
      lumps.push(lump(c.clone().add(o), new THREE.Vector3(1.05 - i * 0.08, 0.36, 0.95 - i * 0.07), cc, cr, seed * 31 + i * 2 + k));
    }
  }
  const far = lump(cc, new THREE.Vector3(1.6, 1.5, 1.4), cc, cr, seed);
  const trunkFar = new THREE.CylinderGeometry(0.08, 0.17, 6.4, 5, 1, true).translate(lean.x / 2, 3.0, 0);
  return { trunk: merge(trunk), crown: merge(lumps), trunkFar, crownFar: far, pine: true };
}

/** The crown's material: the foliage drawn in the shader (see above). One for broadleaves, one for
 * pines (needles: finer, darker, the clumps flatter). */
export function foliageMaterial(pineKind: boolean) {
  const m = new THREE.MeshStandardMaterial({ color: "#ffffff", vertexColors: true, roughness: 0.78, metalness: 0 });
  // leaves (m): a broadleaf's ~15 cm, a pine's needle tufts long and thin
  const freq = pineKind ? "10.0" : "8.6", shape = pineKind ? "vec2(1.1, 0.24)" : "vec2(0.95, 0.52)";
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aAO; varying float vAO; varying vec3 vTP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvAO = aAO; vTP = position;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
varying float vAO; varying vec3 vTP;
vec3 th3(vec3 p) { p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6))); return fract(sin(p) * 43758.5453); }
float tn3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(th3(i).x, th3(i + vec3(1, 0, 0)).x, f.x), mix(th3(i + vec3(0, 1, 0)).x, th3(i + vec3(1, 1, 0)).x, f.x), f.y),
             mix(mix(th3(i + vec3(0, 0, 1)).x, th3(i + vec3(1, 0, 1)).x, f.x), mix(th3(i + vec3(0, 1, 1)).x, th3(i + vec3(1, 1, 1)).x, f.x), f.y), f.z); }
/* the leaves: one in each cell of a jittered grid, each an ellipsoid on its own axis — the cover
 * (0..1, soft over the pixel w), the leaf's id and the way it faces */
float leaves(vec3 p, float w, out float lid, out vec3 tilt) {
  vec3 b = floor(p - 0.5); float best = 0.0; lid = 0.0; tilt = vec3(0.0);
  for (int k = 0; k < 8; k++) {
    vec3 c = b + vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 d = p - (c + th3(c) * 0.8 + 0.1);
    vec3 ax = normalize(th3(c + 3.1) * 2.0 - 1.0);
    float along = dot(d, ax); vec3 perp = d - ax * along;
    float e = sqrt(along * along / (${shape}.x * ${shape}.x) + dot(perp, perp) / (${shape}.y * ${shape}.y));
    float cov = 1.0 - smoothstep(0.85 - w * 2.0, 1.0 + w * 2.0, e);
    if (cov > best) { best = cov; lid = th3(c + 9.7).x; tilt = normalize(th3(c + 5.3) * 2.0 - 1.0); }
  }
  return best;
}
float fCov; vec3 fTilt; float fKeep;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
{
  vec3 p = vTP * ${freq};
  float w = length(fwidth(p));
  fKeep = 1.0 - smoothstep(0.22, 0.65, w);                    // leaves drawn while a pixel is smaller than one
  float lid; fCov = leaves(p, w, lid, fTilt);
  vec3 c = diffuseColor.rgb;
  // the crown's masses light and dark (a few metres across), each leaf its own shade, a few turned
  float mass = 0.72 + 0.5 * tn3(vTP * 0.9 + 3.0);
  vec3 leafC = c * (0.72 + 0.55 * lid) * (lid > 0.86 ? vec3(1.2, 1.05, 0.7) : vec3(1.0));
  vec3 gapC = c * 0.34;                                       // the dark between the leaves, inside
  vec3 nearC = mix(gapC, leafC, fCov), farC = c * 0.68;
  diffuseColor.rgb = mix(farC, nearC, fKeep) * mass * vAO;
}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
{
  // each leaf faces its own way; the crown's edge open between the leaves (no cards: the surface
  // of the crown's volume, cut where it turns from the eye)
  float rim = 1.0 - abs(dot(normal, normalize(vViewPosition)));
  if (fKeep > 0.5 && rim > 0.68 && fCov < (rim - 0.68) * 2.4) discard;
  normal = normalize(normal + fTilt * 0.55 * fCov * fKeep);
}`)
      // (light through the leaves: a little of their own colour where the sky's fill would not reach)
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.04;");
  };
  m.customProgramCacheKey = () => (pineKind ? "walkFoliage5-pine" : "walkFoliage5");
  return m;
}
