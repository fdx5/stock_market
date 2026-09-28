import * as THREE from "three";
import type { RealEstateParcel } from "../api/client";
import type { Terrain } from "./sceneTerrain";
import { inRing, shared } from "./complexScene";

/* Water on the parcels registered as water (연속지적도 지목 천 하천, 구 구거, 유 유지,
 * 양 양어장): exactly their surveyed outline, laid on the real terrain. The surface is
 * one draw whose normals ripple with small waves running along the channel's long
 * axis, so the sky and haze it reflects move like flowing water. No bank, weir or
 * anything else is added. uv = metres along (x) and across (y) the channel.
 * The wave field is kept identical in the WebGPU adapter (tidewater/ComplexRenderer.js). */

const WATER = new Set(["천", "구", "유", "양"]);

/** A water parcel that is not open water: a surveyed road or named street runs along it
 * (a covered stream, 복개천 — its surface is road), or registered buildings stand on a
 * third of it. `lines` are road centrelines, `onBuilding` tests a point. */
export function coveredStream(ring: [number, number][], lines: [number, number][][], onBuilding: (x: number, y: number) => boolean): boolean {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  // Road along it: at least half the parcel's length, and the parcel no wider than a
  // road (a river parcel is far wider: roads along its banks don't cover it).
  let perimeter = 0, area = 0;
  ring.forEach(([x, y], i) => { const [qx, qy] = ring[(i + 1) % ring.length]; perimeter += Math.hypot(qx - x, qy - y); area += x * qy - qx * y; });
  const width = (2 * Math.abs(area / 2)) / Math.max(1, perimeter), length = perimeter / 2;
  const need = width <= 25 ? 0.5 * length : Infinity;
  let inside = 0;
  for (const line of lines) for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i];
    if (Math.max(ax, bx) < x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < y0 || Math.min(ay, by) > y1) continue;
    const len = Math.hypot(bx - ax, by - ay);
    for (let d = 0; d < len; d += 1) if (inRing([ax + (bx - ax) * d / len, ay + (by - ay) * d / len], ring)) inside += Math.min(1, len - d);
    if (inside >= need) return true;
  }
  let n = 0, built = 0;
  const step = Math.max(1, Math.sqrt((x1 - x0) * (y1 - y0) / 400));
  for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) {
    if (!inRing([x, y], ring)) continue;
    n++; if (onBuilding(x, y)) built++;
  }
  return n > 0 && built / n > 0.33;
}

/** GLSL: height gradient of four travelling waves at p (metres, x along the flow). */
export const WAVES_GLSL = /* glsl */`
vec2 waterGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
  vec2 k; float a;
  k = vec2(0.55, 0.08); a = 0.50; g += a * k * cos(dot(p, k) - t * 1.3);
  k = vec2(0.90, -0.35); a = 0.35; g += a * k * cos(dot(p, k) - t * 1.9);
  k = vec2(1.70, 0.60); a = 0.22; g += a * k * cos(dot(p, k) - t * 2.6);
  k = vec2(2.90, -1.10); a = 0.12; g += a * k * cos(dot(p, k) - t * 3.4);
  return g;
}`;

/** Rasterised water: every open-water parcel on one grid (adjacent parcels of one river
 * are one channel, not separate ponds with banks between them). Per node: inside,
 * ground height, the local water level and the distance to the nearest dry node (the
 * bank), in metres. Replaces point-in-polygon tests per vertex (seconds on a river). */
function waterField(rings: [number, number][][], terrain: Terrain) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  // 2 m nodes; a coarser step only for very large rivers (at most ~300k nodes).
  const s = Math.max(2, Math.sqrt(((x1 - x0) * (y1 - y0)) / 300000));
  x0 -= s; y0 -= s;
  const nx = Math.ceil((x1 - x0) / s) + 2, ny = Math.ceil((y1 - y0) / s) + 2, n = nx * ny;
  const inside = new Uint8Array(n), h = new Float32Array(n), lvl = new Float32Array(n);
  // Scanline fill (even-odd per ring, union over rings).
  const xs: number[] = [];
  for (const r of rings) for (let j = 0; j < ny; j++) {
    const y = y0 + j * s;
    xs.length = 0;
    for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
      const [xi, yi] = r[i], [xk, yk] = r[k];
      if (yi > y !== yk > y) xs.push(((xk - xi) * (y - yi)) / (yk - yi) + xi);
    }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2)
      for (let i = Math.max(0, Math.ceil((xs[q] - x0) / s)), e = Math.min(nx - 1, Math.floor((xs[q + 1] - x0) / s)); i <= e; i++) inside[j * nx + i] = 1;
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = inside[j * nx + i] ? terrain.at(x0 + i * s, y0 + j * s) : Infinity;
  // Where the water actually is: a 하천 parcel also holds its banks and riverside paths
  // (둔치). The national DEM shows the channel as the lowest ground: water only within
  // 0.7 m of the lowest point nearby (25 m round, on water parcels).
  const r = Math.round(25 / s), dirs = Array.from({ length: 8 }, (_, k) => [Math.round(Math.cos(k * Math.PI / 4) * r), Math.round(Math.sin(k * Math.PI / 4) * r)]);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i;
    if (!inside[c]) { lvl[c] = Infinity; continue; }
    let m = h[c];
    for (const [di, dj] of dirs) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nx && b < ny) m = Math.min(m, h[b * nx + a]); }
    lvl[c] = m;
  }
  // Chamfer distance (m) from the seed nodes, forward and backward pass.
  const d1 = s, d2 = s * Math.SQRT2;
  const chamfer = (seed: Uint8Array) => {
    const d = new Float32Array(n);
    for (let c = 0; c < n; c++) d[c] = seed[c] ? 0 : 1e6;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = j * nx + i; if (!d[c]) continue;
      let v = d[c];
      if (i > 0) v = Math.min(v, d[c - 1] + d1);
      if (j > 0) { v = Math.min(v, d[c - nx] + d1); if (i > 0) v = Math.min(v, d[c - nx - 1] + d2); if (i < nx - 1) v = Math.min(v, d[c - nx + 1] + d2); }
      d[c] = v;
    }
    for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
      const c = j * nx + i; if (!d[c]) continue;
      let v = d[c];
      if (i < nx - 1) v = Math.min(v, d[c + 1] + d1);
      if (j < ny - 1) { v = Math.min(v, d[c + nx] + d1); if (i < nx - 1) v = Math.min(v, d[c + nx + 1] + d2); if (i > 0) v = Math.min(v, d[c + nx - 1] + d2); }
      d[c] = v;
    }
    return d;
  };
  const wet = new Uint8Array(n);
  for (let c = 0; c < n; c++) wet[c] = inside[c] && h[c] <= lvl[c] + 0.7 ? 1 : 0;
  // A river runs on under its bridges, where the DEM carries the road across as a dam:
  // close the channel (dilate by R on the water parcels, erode by R), bridging gaps up
  // to ~2R along it.
  const R = 15, toWet = chamfer(wet), grown = new Uint8Array(n);
  for (let c = 0; c < n; c++) grown[c] = inside[c] && toWet[c] <= R ? 0 : 1; // seeds: outside the grown water
  const toOut = chamfer(grown);
  for (let c = 0; c < n; c++) if (!wet[c] && inside[c] && toOut[c] > R) wet[c] = 1;
  const dry = new Uint8Array(n);
  for (let c = 0; c < n; c++) dry[c] = wet[c] ? 0 : 1;
  const dist = chamfer(dry);
  /** Bilinear over the nodes (finite values only: the level exists on water parcels). */
  const sample = (f: Float32Array, x: number, y: number, fallback: number) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - x0) / s)), fy = Math.min(ny - 1.001, Math.max(0, (y - y0) / s));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const c = j * nx + i;
    let sum = 0, w = 0;
    const add = (val: number, k: number) => { if (k > 0 && Number.isFinite(val)) { sum += val * k; w += k; } };
    add(f[c], (1 - u) * (1 - v)); add(f[c + 1], u * (1 - v)); add(f[c + nx], (1 - u) * v); add(f[c + nx + 1], u * v);
    return w > 0 ? sum / w : fallback;
  };
  const node = (x: number, y: number) => {
    const i = Math.round((x - x0) / s), j = Math.round((y - y0) / s);
    return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : j * nx + i;
  };
  return {
    level: (x: number, y: number) => sample(lvl, x, y, terrain.at(x, y)),
    /** On the (closed) water. */
    wet: (x: number, y: number) => { const c = node(x, y); return c >= 0 && wet[c] === 1; },
    // Half a node: the bank line lies between a wet and a dry node.
    shore: (x: number, y: number) => Math.max(0, sample(dist, x, y, 0) - s * 0.5),
  };
}

export function buildWater(parcels: RealEstateParcel[], covered: boolean[], terrain: Terrain) {
  // Slivers under 300 m² are left-over strips of channelled streams, not open water.
  const open = parcels.filter((p, pi) => WATER.has(p.kind) && p.ring.length >= 3 && !covered[pi]
    && Math.abs(p.ring.reduce((acc, [x, y], i) => { const q = p.ring[(i + 1) % p.ring.length]; return acc + x * q[1] - q[0] * y; }, 0) / 2) >= 300);
  if (!open.length) return null;
  const field = waterField(open.map(p => p.ring), terrain);
  const pos: number[] = [], uv: number[] = [], nor: number[] = [], shore: number[] = [], flow: number[] = [];
  for (const p of open) {
    // Flow along the parcel's longest edge.
    let best = 0, ang = 0;
    p.ring.forEach((a, i) => { const b = p.ring[(i + 1) % p.ring.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > best) { best = l; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); } });
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const pts = p.ring.map(([x, y]) => new THREE.Vector2(x, y));
    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    const wet = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2) => field.wet((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3);
    // Subdivided finely so the waterline follows the channel; the surface at the local
    // level. aShore = metres to the bank, aFlow = the channel direction in world x/z
    // (the WebGPU water: its depth, soft edge and current).
    const push = (x: number, y: number) => {
      pos.push(x, field.level(x, y) + 0.12, -y);
      uv.push(x * ux + y * uy, -x * uy + y * ux);
      nor.push(0, 1, 0);
      shore.push(field.shore(x, y));
      flow.push(ux, -uy);
    };
    const split = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2, depth: number): void => {
      const ab = a.distanceTo(b), bc = b.distanceTo(c), ca = c.distanceTo(a), m = Math.max(ab, bc, ca);
      if (m < 6 || depth > 14) { if (wet(a, b, c)) { push(a.x, a.y); push(b.x, b.y); push(c.x, c.y); } return; }
      if (m === ab) { const d = a.clone().lerp(b, 0.5); split(a, d, c, depth + 1); split(d, b, c, depth + 1); }
      else if (m === bc) { const d = b.clone().lerp(c, 0.5); split(a, b, d, depth + 1); split(a, d, c, depth + 1); }
      else { const d = c.clone().lerp(a, 0.5); split(a, b, d, depth + 1); split(d, b, c, depth + 1); }
    };
    for (const [i, j, k] of tris) {
      // Wind upward (+y): footprint frame x east / y north maps to world (x, -y).
      const a = pts[i], b = pts[j], c = pts[k];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (cross > 0) split(a, b, c, 0); else split(a, c, b, 0);
    }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("aShore", new THREE.Float32BufferAttribute(shore, 1));
  geo.setAttribute("aFlow", new THREE.Float32BufferAttribute(flow, 2));
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ color: "#1f3d49", roughness: 0.06, metalness: 0 });
  mat.userData.water = true;
  mat.defines = { USE_UV: "" };
  // WebGL: ripple the normal with the travelling waves (world-space frame from the
  // screen derivatives of position and uv), and tint the troughs slightly deeper.
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = shared.uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWaterPos;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float uTime;\nvarying vec3 vWaterPos;\n${WAVES_GLSL}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
{
  vec2 g = waterGrad(vUv, uTime) + 0.6 * waterGrad(vUv * 2.3 + 11.0, uTime * 1.4);
  vec3 q0 = dFdx(vWaterPos), q1 = dFdy(vWaterPos);
  vec2 s0 = dFdx(vUv), s1 = dFdy(vUv);
  vec3 N = vec3(0.0, 1.0, 0.0);
  vec3 T = cross(q1, N) * s0.x + cross(N, q0) * s1.x;
  vec3 B = cross(q1, N) * s0.y + cross(N, q0) * s1.y;
  float inv = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-8));
  float near = 1.0 - smoothstep(80.0, 600.0, length(vWaterPos - cameraPosition));
  vec3 nW = normalize(N - (T * g.x + B * g.y) * inv * 0.16 * near);
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}`);
  };
  mat.customProgramCacheKey = () => "complex:water";
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  /** Lower the ground mesh (local x east, y north, z up) under the water below its
   * surface: interpolated between DEM samples the ground otherwise rises through the
   * level surface in patches, and a bridge the DEM carries across stays a dam. The
   * roads keep their height: a road over the channel reads as its bridge. */
  const sink = (ground: THREE.BufferGeometry) => {
    const p = ground.getAttribute("position") as THREE.BufferAttribute;
    let changed = false;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      if (!field.wet(x, y)) continue;
      const z = field.level(x, y) - 0.35;
      if (p.getZ(i) > z) { p.setZ(i, z); changed = true; }
    }
    if (!changed) return;
    p.needsUpdate = true;
    ground.computeVertexNormals();
    ground.computeBoundingSphere();
  };
  return { mesh, sink, dispose: () => { geo.dispose(); mat.dispose(); } };
}
