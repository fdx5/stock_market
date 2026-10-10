import * as THREE from "three";
import type { RealEstateParcel } from "../api/client";
import { FLAT, gridNormals, type Terrain } from "./sceneTerrain";
import { fieldFrom, waterField, waterSurface, type FieldData, type Pace, type WaterArrays } from "./waterCore";
import { sceneWork } from "./sceneWorkerClient";
export type { Pace, WaterField } from "./waterCore";
export { coveredStream } from "./waterCore";
import { shared } from "./complexScene";
import { coastFoamTexture } from './coastFoam';

/* Water on the parcels registered as water (연속지적도 지목 천 하천, 구 구거, 유 유지,
 * 양 양어장): exactly their surveyed outline, laid on the real terrain. The surface is
 * one draw whose normals ripple with small waves running along the channel's long
 * axis, so the sky and haze it reflects move like flowing water. No bank, weir or
 * anything else is added. uv = metres along (x) and across (y) the channel.
 * The wave field is kept identical in the WebGPU adapter (tidewater/ComplexRenderer.js). */

const WATER = new Set(["천", "구", "유", "양"]);

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

/** Built in slices (`pace`); null when there is no open water, or the view went away. */
export async function buildWater(parcels: RealEstateParcel[], covered: boolean[], terrain: Terrain, pace: Pace) {
  // Slivers under 300 m² are left-over strips of channelled streams, not open water.
  const open = parcels.filter((p, pi) => WATER.has(p.kind) && p.ring.length >= 3 && !covered[pi]
    && Math.abs(p.ring.reduce((acc, [x, y], i) => { const q = p.ring[(i + 1) % p.ring.length]; return acc + x * q[1] - q[0] * y; }, 0) / 2) >= 300);
  if (!open.length) return null;
  const rings = open.map(p => p.ring),holes=open.flatMap(p=>p.holes??[]),sea=open.map(p=>!!p.sea);
  // (the square the water was cut to: where a ring reaches its edge, the water goes on)
  const cut = open.reduce<[number, number, number, number] | null>((b, p) => !p.open ? b : !b ? [...p.open] : [Math.min(b[0], p.open[0]), Math.min(b[1], p.open[1]), Math.max(b[2], p.open[2]), Math.max(b[3], p.open[3])], null);
  // In the scene worker (the raster and the surface were ~1 s of a slow phone's page while a
  // riverside complex loaded); on the page, in slices, where it can't run.
  let made: { field: FieldData; surface: WaterArrays | null } | null = null, off = false;
  const seaDatum = terrain.elevation === null ? null : -terrain.elevation;
  const job = terrain.grid || terrain === FLAT ? sceneWork("water", { rings, holes, grid: terrain.grid ?? null, sea, open: cut, seaDatum }) : null;
  if (job) {
    try { made = await job; off = true; } catch { made = null; }
    if (!await pace()) return null;
  }
  if (!off) {
    const data = await waterField(rings, terrain.at, pace, holes, sea, cut, seaDatum);
    const surface = data && await waterSurface(rings, fieldFrom(data, terrain.at), pace, holes, sea);
    if (!data) return null;
    made = { field: data, surface };
  }
  if (!made?.surface) return null;
  const field = fieldFrom(made.field, terrain.at), { pos, uv, nor, shore, flow, sea: seaA, index } = made.surface;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("aShore", new THREE.BufferAttribute(shore, 1));
  geo.setAttribute("aFlow", new THREE.BufferAttribute(flow, 2));
  geo.setAttribute("aSea", new THREE.BufferAttribute(seaA, 1));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ color: "#1f3d49", roughness: 0.06, metalness: 0 });
  mat.userData.water = true;
  mat.defines = { USE_UV: "" };
  // WebGL: ripple the normal with the travelling waves (world-space frame from the
  // screen derivatives of position and uv), and tint the troughs slightly deeper.
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uCoastFoam = { value: sea.some(Boolean) ? coastFoamTexture() : null };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWaterPos;\nattribute float aShore;\nattribute float aSea;\nvarying float vShore;\nvarying float vSea;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvShore = aShore;\nvSea = aSea;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float uTime;\nuniform sampler2D uCoastFoam;\nvarying vec3 vWaterPos;\nvarying float vShore;\nvarying float vSea;\n${WAVES_GLSL}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
  float shoreSea = clamp(vSea, 0.0, 1.0);
  vec3 seaTint = mix(vec3(0.075, 0.24, 0.25), vec3(0.023, 0.095, 0.16), smoothstep(2.0, 160.0, vShore));
  float foam = 0.0;
  float shoreAA = max(fwidth(vShore), 0.08);
  vec2 foamUV = vWaterPos.xz / 8.0 + vec2(-0.6, 0.8) * uTime * 0.012;
  vec2 foamDx = dFdx(foamUV), foamDy = dFdy(foamUV);
  if (shoreSea > 0.5 && vShore < 36.0) {
    vec2 cells = textureGrad(uCoastFoam, foamUV, foamDx, foamDy).rg;
    float lace = cells.r * mix(0.38, 0.85, cells.g);
    float broken = smoothstep(0.12, 0.62, cells.g);
    float patchiness = 0.7 + 0.15 * sin(vWaterPos.x * 0.4 + vWaterPos.z * 0.6);
    float phase = fract(vShore / 11.5 + uTime * 0.13 + sin(vWaterPos.x * 0.07 + vWaterPos.z * 0.1) * 0.018);
    float aaPhase = min(0.06, shoreAA / 11.5);
    float front = 1.0 - smoothstep(0.018, 0.06 + aaPhase, min(phase, 1.0 - phase));
    float wake = smoothstep(0.015, 0.06 + aaPhase, phase) * (1.0 - smoothstep(0.09, 0.29, phase));
    float surf = (1.0 - smoothstep(16.0, 36.0, vShore)) * smoothstep(0.0, 0.65, vShore);
    float reach = 0.9 + 0.85 * (0.5 + 0.5 * sin(uTime * 0.85));
    float swash = (1.0 - smoothstep(reach, reach + 0.5 + shoreAA, vShore)) * (0.2 + 0.7 * lace);
    foam = clamp((front * (0.06 + 0.94 * lace) + wake * lace * 0.72) * broken * patchiness * surf + swash, 0.0, 0.94);
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(seaTint, vec3(0.6, 0.66, 0.67), foam), shoreSea);
`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
{
  vec2 seaQ = vec2(dot(vWaterPos.xz, vec2(-0.6, 0.8)), dot(vWaterPos.xz, vec2(-0.8, -0.6))) / 3.2;
  vec2 q = mix(vUv, seaQ, clamp(vSea, 0.0, 1.0));
  float wt = uTime / mix(1.0, 1.7, clamp(vSea, 0.0, 1.0));
  vec2 g = waterGrad(q, wt) + 0.6 * waterGrad(q * 2.3 + 11.0, wt * 1.4);
  vec3 q0 = dFdx(vWaterPos), q1 = dFdy(vWaterPos);
  vec2 s0 = dFdx(q), s1 = dFdy(q);
  vec3 N = vec3(0.0, 1.0, 0.0);
  vec3 T = cross(q1, N) * s0.x + cross(N, q0) * s1.x;
  vec3 B = cross(q1, N) * s0.y + cross(N, q0) * s1.y;
  float inv = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-8));
  float near = 1.0 - smoothstep(80.0, 600.0, length(vWaterPos - cameraPosition));
  float calm = mix(1.0, mix(0.85, 1.0, smoothstep(0.0, 12.0, vShore)), clamp(vSea, 0.0, 1.0));
  vec3 nW = normalize(N - (T * g.x + B * g.y) * inv * mix(0.16, 0.15, clamp(vSea, 0.0, 1.0)) * calm * near);
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}`);
  };
  mat.customProgramCacheKey = () => "complex:water:coast-v4";
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  /** Lower the ground mesh (local x east, y north, z up) under the water below its
   * surface: interpolated between DEM samples the ground otherwise rises through the
   * level surface in patches, and a bridge the DEM carries across stays a dam. The
   * roads keep their height: a road over the channel reads as its bridge. */
  const sink = async (ground: THREE.BufferGeometry) => {
    const p = ground.getAttribute("position") as THREE.BufferAttribute;
    let changed = false;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      if (i % 2048 === 2047 && !await pace()) return;
      if (!field.wet(x, y)) continue;
      const z = field.level(x, y) - 0.35;
      if (p.getZ(i) > z) { p.setZ(i, z); changed = true; }
    }
    if (!changed) return;
    p.needsUpdate = true;
    gridNormals(ground);
    ground.computeBoundingSphere();
  };
  return { mesh, sink, field, dispose: () => { geo.dispose(); mat.dispose(); } };
}
