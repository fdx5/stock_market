import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RealEstateBuilding, RealEstateBuildingsResponse } from "../api/client";

/* The natural-light scene around one complex (components/ComplexHologram.tsx):
 * facades, ground, trees, lamps and the time-of-day looks. Footprints and heights
 * are real; paint, glazing, landscaping, trees and lamps are drawn to read as a
 * lived-in complex, not surveyed. */

export type Ring = [number, number][];

export interface Palette { wall: string; wall2: string; accent: string; glass: [string, string]; roof: string }

// Brand-inspired schemes (colour only, never a mark), matched on the complex name.
const BRANDS: [RegExp, Palette][] = [
  [/래미안|raemian/i, { wall: "#ecebe6", wall2: "#c9cbc4", accent: "#2f6b57", glass: ["#9cc3d6", "#27414f"], roof: "#6f7771" }],
  [/자이|xi\b/i, { wall: "#e7e5e1", wall2: "#3c3f45", accent: "#8b1d2c", glass: ["#a9c4d8", "#1f2c3a"], roof: "#4a4d52" }],
  [/힐스테이트|hillstate/i, { wall: "#efe9e0", wall2: "#7a5a48", accent: "#5a3a2e", glass: ["#b3cad6", "#2c3b45"], roof: "#6b5347" }],
  [/아이파크|ipark/i, { wall: "#f2f1ee", wall2: "#d8d6d0", accent: "#d1492e", glass: ["#a4c9e0", "#233a4d"], roof: "#8a8d90" }],
  [/푸르지오|prugio/i, { wall: "#eeeae0", wall2: "#b9c3a4", accent: "#4f7a3a", glass: ["#aecbd2", "#28413f"], roof: "#6f7865" }],
  [/롯데캐슬|캐슬/i, { wall: "#f0ebe4", wall2: "#9c6b5d", accent: "#8c2230", glass: ["#b5c9d4", "#2e3a44"], roof: "#6e4c47" }],
  [/e편한|이편한|편한세상/i, { wall: "#f3f2ef", wall2: "#cfd3d6", accent: "#c8102e", glass: ["#a8cde3", "#20384c"], roof: "#8d9296" }],
  [/더샵|the ?sharp/i, { wall: "#eceef0", wall2: "#304a63", accent: "#1d7a8c", glass: ["#9fc9dc", "#1b3244"], roof: "#4c5c6a" }],
  [/아크로|acro/i, { wall: "#e9e3d6", wall2: "#3a3631", accent: "#b08d57", glass: ["#b9c6cc", "#262a2e"], roof: "#4b463f" }],
  [/디에이치|the ?h\b/i, { wall: "#2f2f31", wall2: "#1d1d1f", accent: "#c4a05a", glass: ["#9fb0bd", "#15191d"], roof: "#2a2a2c" }],
  [/sk ?뷰|sk ?view|에스케이/i, { wall: "#f1efeb", wall2: "#d6d2ca", accent: "#e8661c", glass: ["#a6c8dc", "#22384a"], roof: "#8c8a86" }],
  [/써밋|summit|호반/i, { wall: "#ebedf0", wall2: "#26344d", accent: "#3d5a8c", glass: ["#a2c1dc", "#1a2a40"], roof: "#46526a" }],
  [/위브|weve|두산/i, { wall: "#f0eee9", wall2: "#5b6f86", accent: "#2f5d8a", glass: ["#a8c6db", "#213448"], roof: "#5f6b78" }],
  [/센트레빌|centreville|동부/i, { wall: "#f1eee6", wall2: "#8aa36b", accent: "#3d6b3a", glass: ["#afcbd0", "#27403a"], roof: "#6c775f" }],
];
const FALLBACKS: Palette[] = [
  { wall: "#eeebe4", wall2: "#b8b3a8", accent: "#6d5d4b", glass: ["#aac5d4", "#26394a"], roof: "#77716a" },
  { wall: "#e8ecef", wall2: "#8a9bab", accent: "#34566f", glass: ["#9fc4dc", "#1c3246"], roof: "#5d6a76" },
  { wall: "#f0ece6", wall2: "#c2a38c", accent: "#9a5b3c", glass: ["#b1c8d2", "#2d3b43"], roof: "#806a5c" },
  { wall: "#eceee9", wall2: "#9fae9a", accent: "#48644a", glass: ["#a9cbcd", "#243f3c"], roof: "#697663" },
  { wall: "#efedf0", wall2: "#a69bb3", accent: "#5b4a78", glass: ["#adc2dc", "#252f47"], roof: "#6f6879" },
];

export function paletteFor(name: string): Palette {
  const brand = BRANDS.find(([re]) => re.test(name));
  if (brand) return brand[1];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACKS[h % FALLBACKS.length];
}

export const rng = (seed: number) => {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
};

const canvas = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

/** Tangent-space normals from a height canvas (brighter = further out). */
function normalCanvas(height: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const { width: W, height: H } = height;
  const src = height.getContext("2d")!.getImageData(0, 0, W, H).data;
  const out = canvas(W, H);
  const ctx = out.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  const h = (x: number, y: number) => src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (h(x - 1, y) - h(x + 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * W + x) * 4;
      img.data[i] = (dx / l * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function mixHex(a: string, b: string, k: number) {
  return "#" + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();
}

function worldTexture(c: HTMLCanvasElement, srgb: boolean, tileW: number, tileH: number, groundOffset = 0) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.flipY = false;
  t.repeat.set(1 / tileW, 1 / tileH);
  // WorldUVGenerator gives v = 1 - z: shift so floor lines start above the ground floor.
  t.offset.set(0, (1 - groundOffset) / tileH);
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

// One facade tile: BAYS windows across, ROWS floors up; world scale set by the texture repeat.
export const BAY_M = 3.2, FLOOR_M = 2.9, GROUND_M = 1.5;
const BAYS = 8, ROWS = 8;

/** A Korean apartment facade: expanded-balcony glazing with glass rails, slab bands,
 * AC louvres and pilasters. Colour, normals, roughness (G) / metalness (B) and the
 * lit windows for the evening. */
export function facadeTextures(p: Palette, seed: number) {
  const W = 1024, H = 928, cw = W / BAYS, ch = H / ROWS;
  const color = canvas(W, H), height = canvas(W, H), rm = canvas(W, H), glow = canvas(W, H);
  const g = color.getContext("2d")!, hh = height.getContext("2d")!, r = rm.getContext("2d")!, e = glow.getContext("2d")!;
  const rnd = rng(seed);
  const slab = mixHex(p.wall, p.wall2, 0.25);

  g.fillStyle = p.wall; g.fillRect(0, 0, W, H);
  hh.fillStyle = "rgb(140,140,140)"; hh.fillRect(0, 0, W, H);
  r.fillStyle = "rgb(0,210,0)"; r.fillRect(0, 0, W, H);
  e.fillStyle = "#000"; e.fillRect(0, 0, W, H);
  // Paint texture and rain streaks running down from each slab.
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? "0,0,0" : "255,255,255"},${rnd() * 0.03})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 18, 1 + rnd() * 2);
  }
  for (let i = 0; i < 180; i++) {
    const x = rnd() * W, y = Math.floor(rnd() * ROWS) * ch + ch * 0.92;
    const grad = g.createLinearGradient(0, y, 0, y + 30 + rnd() * 90);
    grad.addColorStop(0, `rgba(70,62,52,${0.05 + rnd() * 0.06})`); grad.addColorStop(1, "rgba(70,62,52,0)");
    g.fillStyle = grad; g.fillRect(x, y, 1 + rnd() * 4, 120);
  }

  const lit = [[255, 196, 128], [255, 214, 160], [255, 228, 196], [226, 236, 255]];
  const curtains = ["#ece4d4", "#ddd5c6", "#d3d9dd", "#efe7d8", "#c9c0b0"];
  for (let row = 0; row < ROWS; row++) {
    const y = row * ch;
    for (let bay = 0; bay < BAYS; bay++) {
      const x = bay * cw;
      if (bay % 4 === 3) {
        // Pilaster with the outdoor-unit louvre beside it.
        g.fillStyle = p.wall2; g.fillRect(x + cw * 0.62, y, cw * 0.38, ch);
        hh.fillStyle = "rgb(175,175,175)"; hh.fillRect(x + cw * 0.62, y, cw * 0.38, ch);
        const lx = x + cw * 0.08, ly = y + ch * 0.16, lw = cw * 0.48, lh = ch * 0.66;
        g.fillStyle = "#4a4e52"; g.fillRect(lx, ly, lw, lh);
        hh.fillStyle = "rgb(80,80,80)"; hh.fillRect(lx, ly, lw, lh);
        r.fillStyle = "rgb(0,120,150)"; r.fillRect(lx, ly, lw, lh);
        for (let s = ly + 3; s < ly + lh - 3; s += 7) {
          g.fillStyle = "#8d9296"; g.fillRect(lx + 3, s, lw - 6, 3);
          hh.fillStyle = "rgb(125,125,125)"; hh.fillRect(lx + 3, s, lw - 6, 3);
        }
        g.strokeStyle = "#d8dadb"; g.lineWidth = 3; g.strokeRect(lx, ly, lw, lh);
        continue;
      }
      const wx = x + cw * 0.06, ww = cw * 0.88, wy = y + ch * 0.1, wh = ch * 0.74;
      // Glass: the room behind, darker low, catching sky high.
      const grad = g.createLinearGradient(0, wy, 0, wy + wh);
      grad.addColorStop(0, p.glass[0]); grad.addColorStop(0.45, p.glass[1]); grad.addColorStop(1, mixHex(p.glass[1], "#000000", 0.3));
      g.fillStyle = grad; g.fillRect(wx, wy, ww, wh);
      if (rnd() < 0.55) {
        g.fillStyle = curtains[Math.floor(rnd() * curtains.length)];
        g.globalAlpha = 0.55 + rnd() * 0.3;
        const cwid = ww * (0.18 + rnd() * 0.3);
        if (rnd() < 0.5) g.fillRect(wx, wy + 2, cwid, wh * 0.95);
        if (rnd() < 0.6) g.fillRect(wx + ww - cwid, wy + 2, cwid, wh * 0.95);
        g.globalAlpha = 1;
      }
      // Recess shadow under the lintel.
      const sh = g.createLinearGradient(0, wy, 0, wy + 16);
      sh.addColorStop(0, "rgba(0,0,0,0.45)"); sh.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = sh; g.fillRect(wx, wy, ww, 16);
      hh.fillStyle = "rgb(35,35,35)"; hh.fillRect(wx, wy, ww, wh);
      r.fillStyle = "rgb(0,14,150)"; r.fillRect(wx, wy, ww, wh);
      if (rnd() < 0.42) {
        const [lr, lg, lb] = lit[Math.floor(rnd() * lit.length)];
        const a = 0.45 + rnd() * 0.55;
        const lgGrad = e.createLinearGradient(0, wy, 0, wy + wh);
        lgGrad.addColorStop(0, `rgba(${lr},${lg},${lb},${a})`);
        lgGrad.addColorStop(1, `rgba(${lr},${lg},${lb},${a * 0.55})`);
        e.fillStyle = lgGrad; e.fillRect(wx + 3, wy + 3, ww - 6, wh - 6);
      }
      // Frames: white aluminium outline, sliding-sash mullion, fixed upper light.
      g.strokeStyle = "#e3e5e4"; g.lineWidth = 4; g.strokeRect(wx + 2, wy + 2, ww - 4, wh - 4);
      g.fillStyle = "#e3e5e4";
      g.fillRect(wx + ww / 2 - 2, wy, 4, wh);
      g.fillRect(wx, wy + wh * 0.24, ww, 3);
      hh.fillStyle = "rgb(120,120,120)";
      hh.fillRect(wx + ww / 2 - 2, wy, 4, wh); hh.fillRect(wx, wy + wh * 0.24, ww, 3);
      hh.strokeStyle = "rgb(120,120,120)"; hh.lineWidth = 4; hh.strokeRect(wx + 2, wy + 2, ww - 4, wh - 4);
      // Glass balcony rail across the lower third.
      const ry = wy + wh * 0.64;
      g.fillStyle = "rgba(190,210,220,0.22)"; g.fillRect(wx, ry, ww, wy + wh - ry);
      g.fillStyle = "#f2f4f4"; g.fillRect(wx - 2, ry - 2, ww + 4, 4);
      for (let px = wx + 6; px < wx + ww; px += ww / 4) g.fillRect(px, ry, 2, wy + wh - ry);
      hh.fillStyle = "rgb(200,200,200)"; hh.fillRect(wx - 2, ry - 2, ww + 4, 4);
      r.fillStyle = "rgb(0,90,40)"; r.fillRect(wx - 2, ry - 2, ww + 4, 4);
    }
    // Floor slab band, the strongest horizontal line of a Korean apartment facade.
    g.fillStyle = slab; g.fillRect(0, y + ch * 0.9, W, ch * 0.1);
    g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(0, y + ch, W, 3);
    hh.fillStyle = "rgb(205,205,205)"; hh.fillRect(0, y + ch * 0.9, W, ch * 0.1);
    r.fillStyle = "rgb(0,190,0)"; r.fillRect(0, y + ch * 0.9, W, ch * 0.1);
  }
  // Soften the height steps into bevels before taking normals.
  const soft = canvas(W, H);
  const sctx = soft.getContext("2d")!;
  sctx.filter = "blur(1.2px)";
  sctx.drawImage(height, 0, 0);
  const normal = normalCanvas(soft, 5);
  const tile = (c: HTMLCanvasElement, srgb: boolean) => worldTexture(c, srgb, BAYS * BAY_M, ROWS * FLOOR_M, GROUND_M);
  return { map: tile(color, true), normalMap: tile(normal, false), rmMap: tile(rm, false), emissiveMap: tile(glow, true) };
}

/** The neighbourhood: plainer office and villa facades, tinted per building. */
export function contextTextures(seed: number) {
  const W = 512, H = 512, cols = 4, rows = 4, cw = W / cols, ch = H / rows;
  const color = canvas(W, H), rm = canvas(W, H), glow = canvas(W, H);
  const g = color.getContext("2d")!, r = rm.getContext("2d")!, e = glow.getContext("2d")!;
  const rnd = rng(seed);
  g.fillStyle = "#e6e3dc"; g.fillRect(0, 0, W, H);
  r.fillStyle = "rgb(0,225,0)"; r.fillRect(0, 0, W, H);
  e.fillStyle = "#000"; e.fillRect(0, 0, W, H);
  for (let i = 0; i < 700; i++) {
    g.fillStyle = `rgba(0,0,0,${rnd() * 0.05})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 14, 1 + rnd() * 2);
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const wx = col * cw + cw * 0.14, wy = row * ch + ch * 0.2, ww = cw * 0.72, wh = ch * 0.52;
      const grad = g.createLinearGradient(0, wy, 0, wy + wh);
      grad.addColorStop(0, "#7c8e9c"); grad.addColorStop(1, "#27313a");
      g.fillStyle = grad; g.fillRect(wx, wy, ww, wh);
      g.strokeStyle = "#cfd2d2"; g.lineWidth = 3; g.strokeRect(wx, wy, ww, wh);
      g.fillStyle = "#cfd2d2"; g.fillRect(wx + ww / 2 - 1, wy, 3, wh);
      r.fillStyle = "rgb(0,20,140)"; r.fillRect(wx, wy, ww, wh);
      if (rnd() < 0.3) {
        e.fillStyle = `rgba(255,${200 + Math.floor(rnd() * 40)},${140 + Math.floor(rnd() * 70)},${0.4 + rnd() * 0.5})`;
        e.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
      }
    }
    g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(0, row * ch + ch - 4, W, 4);
  }
  const tile = (c: HTMLCanvasElement, srgb: boolean) => worldTexture(c, srgb, cols * 3.4, rows * 3.1);
  return { map: tile(color, true), rmMap: tile(rm, false), emissiveMap: tile(glow, true) };
}

/* ---------- Shader patches shared by the scene's materials ---------- */

export const shared = {
  uTime: { value: 0 },
  uCloud: { value: 0 },
  /** Sky reflection in glass, independent of how much the sky lights the walls. */
  uGlass: { value: 1 },
};

const NOISE = /* glsl */`
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm3(vec2 p) { return vnoise(p) * .5 + vnoise(p * 2.03 + 7.1) * .3 + vnoise(p * 4.1 + 3.3) * .2; }
float cloudShade(vec2 xz) {
  return smoothstep(0.5, 0.78, fbm3(xz * 0.0028 + uTime * vec2(0.006, 0.0035)));
}
`;

interface PatchOpts {
  /** Planar reflection: the reflector's texture and matrix, in this mesh's local frame. */
  reflect?: { tex: { value: THREE.Texture | null }; matrix: { value: THREE.Matrix4 }; strength: { value: number }; far: { value: number } };
  /** Ground detail noise, so the painted ground holds up close. */
  detail?: boolean;
  /** Flat roofs of merged context blocks take this colour instead of the facade tile. */
  roof?: THREE.Color;
  /** Metallic texels (glazing, frames) reflect the sky at full strength. */
  glass?: boolean;
}

/** World position, drifting cloud shadows and the optional extras above. */
export function patchMaterial(mat: THREE.Material, opts: PatchOpts = {}) {
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, shared);
    if (opts.reflect) {
      shader.uniforms.tRefl = opts.reflect.tex;
      shader.uniforms.uReflMatrix = opts.reflect.matrix;
      shader.uniforms.uReflect = opts.reflect.strength;
      shader.uniforms.uReflFar = opts.reflect.far;
    }
    if (opts.roof) shader.uniforms.uRoof = { value: opts.roof };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
varying vec3 vWPos;
${opts.roof ? "varying float vUpN;" : ""}
${opts.reflect ? "uniform mat4 uReflMatrix; varying vec4 vReflUv;" : ""}`)
      .replace("#include <project_vertex>", `#include <project_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
${opts.roof ? "vUpN = normal.z;" : ""}
${opts.reflect ? "vReflUv = uReflMatrix * vec4(transformed, 1.0);" : ""}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform float uTime; uniform float uCloud; uniform float uGlass;
varying vec3 vWPos;
${opts.roof ? "varying float vUpN; uniform vec3 uRoof;" : ""}
${opts.reflect ? "uniform sampler2D tRefl; uniform float uReflect; uniform float uReflFar; varying vec4 vReflUv;" : ""}
${NOISE}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
${opts.roof ? "if (vUpN > 0.5) diffuseColor.rgb = uRoof;" : ""}
${opts.detail ? `diffuseColor.rgb *= 0.86 + 0.2 * fbm3(vWPos.xz * 0.9) + 0.08 * vnoise(vWPos.xz * 6.0);` : ""}`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>
${opts.roof ? "if (vUpN > 0.5) { metalnessFactor = 0.0; roughnessFactor = 0.9; }" : ""}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
${opts.roof ? "if (vUpN > 0.5) totalEmissiveRadiance = vec3(0.0);" : ""}`)
      .replace("#include <opaque_fragment>", `
outgoingLight *= 1.0 - uCloud * cloudShade(vWPos.xz);
${opts.glass ? `#ifdef USE_ENVMAP
outgoingLight += metalnessFactor * (0.2 + 0.8 * pow(1.0 - clamp(dot(normal, geometryViewDir), 0.0, 1.0), 3.0))
  * getIBLRadiance(geometryViewDir, normal, roughnessFactor) * uGlass;
#endif` : ""}
${opts.reflect ? `{
  vec3 V = normalize(cameraPosition - vWPos);
  float gloss = clamp(1.0 - roughnessFactor, 0.0, 1.0);
  float fres = 0.1 + 0.9 * pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
  vec2 ruv = vReflUv.xy / vReflUv.w;
  ruv += (vec2(vnoise(vWPos.xz * 1.7), vnoise(vWPos.zx * 1.7 + 5.0)) - 0.5) * 0.006 * (1.0 - gloss);
  float br = (1.0 - gloss) * 0.01;
  vec3 refl = texture2D(tRefl, ruv).rgb * 0.36
    + (texture2D(tRefl, ruv + vec2(br, 0.0)).rgb + texture2D(tRefl, ruv - vec2(br, 0.0)).rgb
     + texture2D(tRefl, ruv + vec2(0.0, br)).rgb + texture2D(tRefl, ruv - vec2(0.0, br)).rgb) * 0.16;
  float near = smoothstep(uReflFar, uReflFar * 0.35, length(vWPos - cameraPosition));
  outgoingLight = mix(outgoingLight, refl, clamp(fres * pow(gloss, 2.2) * uReflect * near, 0.0, 0.85));
}` : ""}
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `complex:${!!opts.reflect}:${!!opts.detail}:${!!opts.roof}:${!!opts.glass}`;
}

/* ---------- Ground ---------- */

export interface GroundPlan {
  color: THREE.CanvasTexture; rough: THREE.CanvasTexture; glow: THREE.CanvasTexture;
  /** R: lawn, G: under or beside a building. */
  mask: { data: Uint8ClampedArray; size: number; at: (x: number, y: number) => [number, number] };
}

type Season = "spring" | "summer" | "autumn" | "winter";
export function seasonNow(): Season {
  const m = new Date().getMonth() + 1;
  return m >= 3 && m <= 5 ? "spring" : m >= 6 && m <= 9 ? "summer" : m >= 10 && m <= 11 ? "autumn" : "winter";
}

/** The ground painted top-down over ±T metres: roads, pavements, the complex's
 * paving and lawns, damp patches after rain, soft contact shade and lamp pools. */
export function paintGround(data: RealEstateBuildingsResponse, T: number, lamps: [number, number][], seed: number, size: number): GroundPlan {
  const S = size, k = S / (2 * T);
  const X = (x: number) => (x + T) * k, Y = (y: number) => (T - y) * k, m = (v: number) => v * k;
  const rnd = rng(seed);
  const season = seasonNow();
  const grassTone = season === "autumn" ? "#6b7443" : season === "winter" ? "#7a785c" : season === "spring" ? "#5f8240" : "#4f7236";
  const color = canvas(S, S), rough = canvas(S, S), glow = canvas(S, S), mask = canvas(S, S);
  const cg = color.getContext("2d")!, rg = rough.getContext("2d")!, gg = glow.getContext("2d")!, mg = mask.getContext("2d")!;
  const path = (ctx: CanvasRenderingContext2D, ring: Ring) => {
    ctx.beginPath();
    ring.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.closePath();
  };
  const outer = (b: RealEstateBuilding) => b.rings[0];
  const ctxRings = data.context.map(outer), towerRings = data.buildings.map(outer);
  const lineJoin = (ctx: CanvasRenderingContext2D) => { ctx.lineJoin = "round"; ctx.lineCap = "round"; };
  [cg, rg, mg].forEach(lineJoin);

  // A street grid on the complex's own axis, a guess at the city around it: the
  // footprints drawn on top hide whatever it gets wrong.
  let axis = 0, best = 0;
  (data.site[0] ?? towerRings[0] ?? []).forEach((p, i, r) => {
    const q = r[(i + 1) % r.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len > best) { best = len; axis = Math.atan2(q[1] - p[1], q[0] - p[0]); }
  });
  const roads: [number, number, number][] = []; // offset along the normal, direction, width
  for (const dirA of [axis, axis + Math.PI / 2]) {
    for (let o = -T * 1.5; o < T * 1.5; o += 150 + rnd() * 90) roads.push([o, dirA, rnd() < 0.25 ? 30 : 16]);
  }
  const drawRoads = (ctx: CanvasRenderingContext2D, style: string, widen = 0) => {
    ctx.strokeStyle = style; ctx.lineCap = "butt";
    for (const [o, a, w] of roads) {
      const nx = -Math.sin(a), ny = Math.cos(a), dx = Math.cos(a) * T * 3, dy = Math.sin(a) * T * 3;
      ctx.lineWidth = m(w + widen);
      ctx.beginPath(); ctx.moveTo(X(nx * o - dx), Y(ny * o - dy)); ctx.lineTo(X(nx * o + dx), Y(ny * o + dy)); ctx.stroke();
    }
    ctx.lineCap = "round";
  };
  // Layout, drawn identically into colour, roughness (G) and the mask.
  // Pocket parks between the streets.
  const parks: [number, number, number, number][] = [];
  for (let i = 0; i < Math.floor((T * T) / 90000) + 4; i++) parks.push([(rnd() * 2 - 1) * T, (rnd() * 2 - 1) * T, 25 + rnd() * 60, 20 + rnd() * 45]);
  const layout = (ctx: CanvasRenderingContext2D, c: { base: string; walk: string; under: string; pave: string; lawn: string; road: string }, marks = false) => {
    ctx.fillStyle = c.base; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = c.lawn;
    parks.forEach(([x, y, w, h]) => {
      ctx.save(); ctx.translate(X(x), Y(y)); ctx.rotate(-axis);
      ctx.beginPath(); ctx.roundRect(-m(w) / 2, -m(h) / 2, m(w), m(h), m(6)); ctx.fill(); ctx.restore();
    });
    drawRoads(ctx, c.walk, 8);
    drawRoads(ctx, c.road);
    if (marks) {
      ctx.setLineDash([m(3), m(5)]);
      for (const [o, a, w] of roads) {
        const nx = -Math.sin(a), ny = Math.cos(a), dx = Math.cos(a) * T * 3, dy = Math.sin(a) * T * 3;
        const line = (off: number, style: string, width: number) => {
          ctx.strokeStyle = style; ctx.lineWidth = Math.max(1, m(width));
          ctx.beginPath(); ctx.moveTo(X(nx * (o + off) - dx), Y(ny * (o + off) - dy)); ctx.lineTo(X(nx * (o + off) + dx), Y(ny * (o + off) + dy)); ctx.stroke();
        };
        for (let lane = -w / 2 + 3.3; lane < w / 2 - 1; lane += 3.3) if (Math.abs(lane) > 0.8) line(lane, "rgba(225,225,220,0.45)", 0.2);
        ctx.setLineDash([]);
        line(-0.2, "rgba(220,180,70,0.6)", 0.16); line(0.2, "rgba(220,180,70,0.6)", 0.16);
        ctx.setLineDash([m(3), m(5)]);
      }
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = c.walk; ctx.lineWidth = m(7);
    ctxRings.forEach(r => { path(ctx, r); ctx.stroke(); });
    ctx.fillStyle = c.under;
    ctxRings.forEach(r => { path(ctx, r); ctx.fill(); });
    data.site.forEach(r => { ctx.fillStyle = c.lawn; path(ctx, r); ctx.fill(); });
    ctx.strokeStyle = c.pave; ctx.lineWidth = m(13);
    data.site.forEach(r => { path(ctx, r); ctx.stroke(); });
    ctx.lineWidth = m(11);
    towerRings.forEach(r => { path(ctx, r); ctx.stroke(); });
    if (!data.site.length) { ctx.lineWidth = m(30); towerRings.forEach(r => { path(ctx, r); ctx.stroke(); }); }
    ctx.fillStyle = c.under;
    towerRings.forEach(r => { path(ctx, r); ctx.fill(); });
  };
  layout(cg, { base: "#8a877e", walk: "#9d998f", under: "#5a5a58", pave: "#a8a092", lawn: grassTone, road: "#3d4043" }, true);
  layout(rg, { base: "rgb(0,185,0)", walk: "rgb(0,150,0)", under: "rgb(0,200,0)", pave: "rgb(0,112,0)", lawn: "rgb(0,250,0)", road: "rgb(0,155,0)" });
  layout(mg, { base: "#000", walk: "#000", under: "#00ff00", pave: "#000", lawn: "#ff0000", road: "#0000ff" });
  // Keep trees off building edges.
  mg.strokeStyle = "#00ff00"; mg.lineWidth = m(5);
  [...ctxRings, ...towerRings].forEach(r => { path(mg, r); mg.stroke(); });
  const md = mg.getImageData(0, 0, S, S).data;
  const at = (x: number, y: number): [number, number] => {
    const px = Math.floor(X(x)), py = Math.floor(Y(y));
    if (px < 0 || py < 0 || px >= S || py >= S) return [0, 255];
    const i = (py * S + px) * 4;
    return [md[i], md[i + 1]];
  };

  // Surface grain: grass tufts, asphalt aggregate, paving stains.
  const grain = Math.min(90000, Math.floor(S * S / 45));
  for (let i = 0; i < grain; i++) {
    const x = rnd() * S, y = rnd() * S, s = 0.6 + rnd() * 2.4;
    cg.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${rnd() * 0.12})` : `rgba(255,255,240,${rnd() * 0.07})`;
    cg.fillRect(x, y, s, s);
  }
  for (let i = 0; i < 260; i++) {
    const x = rnd() * S, y = rnd() * S, rad = m(4 + rnd() * 22);
    const grd = cg.createRadialGradient(x, y, 0, x, y, rad);
    const tone = rnd() < 0.5 ? "0,0,0" : "255,250,220";
    grd.addColorStop(0, `rgba(${tone},${0.03 + rnd() * 0.05})`); grd.addColorStop(1, `rgba(${tone},0)`);
    cg.fillStyle = grd; cg.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // Damp patches and puddles after rain, only on hard ground.
  const puddles = Math.floor(60 + (T * T) / 5000);
  rg.filter = `blur(${Math.max(1, m(0.7))}px)`;
  cg.filter = `blur(${Math.max(1, m(0.7))}px)`;
  for (let i = 0; i < puddles; i++) {
    const x = (rnd() * 2 - 1) * T * 0.5, y = (rnd() * 2 - 1) * T * 0.5;
    const [lawn, blocked] = at(x, y);
    if (lawn > 128 || blocked > 128) continue;
    const rx = m(1.2 + rnd() * 6), ry = rx * (0.4 + rnd() * 0.6), rot = rnd() * Math.PI;
    rg.fillStyle = `rgb(0,${25 + Math.floor(rnd() * 40)},0)`;
    rg.beginPath(); rg.ellipse(X(x), Y(y), rx, ry, rot, 0, Math.PI * 2); rg.fill();
    cg.fillStyle = "rgba(10,14,20,0.18)";
    cg.beginPath(); cg.ellipse(X(x), Y(y), rx, ry, rot, 0, Math.PI * 2); cg.fill();
  }
  rg.filter = "none";
  // Soft contact shade around every footprint.
  cg.filter = `blur(${Math.max(2, m(2.6))}px)`;
  cg.fillStyle = "rgba(0,0,0,0.42)";
  [...ctxRings, ...towerRings].forEach(r => { path(cg, r); cg.fill(); });
  cg.filter = "none";

  // Fade the plan into plain ground toward its edge, so nothing streaks past it.
  for (const [ctx, base] of [[cg, "138,135,126"], [rg, "0,185,0"]] as const) {
    const fade = ctx.createRadialGradient(S / 2, S / 2, S * 0.36, S / 2, S / 2, S * 0.5);
    fade.addColorStop(0, `rgba(${base},0)`); fade.addColorStop(1, `rgba(${base},1)`);
    ctx.fillStyle = fade; ctx.fillRect(0, 0, S, S);
  }

  // Pools of lamp light, lit in the evening.
  gg.fillStyle = "#000"; gg.fillRect(0, 0, S, S);
  gg.globalCompositeOperation = "lighter";
  lamps.forEach(([x, y]) => {
    const rad = m(11), px = X(x), py = Y(y);
    const grd = gg.createRadialGradient(px, py, 0, px, py, rad);
    grd.addColorStop(0, "rgba(255,196,130,0.85)"); grd.addColorStop(0.35, "rgba(255,170,100,0.3)"); grd.addColorStop(1, "rgba(255,160,90,0)");
    gg.fillStyle = grd; gg.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  });

  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
    return t;
  };
  return { color: tex(color, true), rough: tex(rough, false), glow: tex(glow, true), mask: { data: md, size: S, at } };
}

/** Evenly spaced points along closed rings. */
export function alongRings(rings: Ring[], step: number, max: number): [number, number][] {
  const pts: [number, number][] = [];
  for (const ring of rings) {
    let acc = 0;
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
      const len = Math.hypot(bx - ax, by - ay);
      if (!len) continue;
      let pos = step - acc;
      while (pos <= len) {
        const t = pos / len;
        pts.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
        pos += step;
      }
      acc = len - (pos - step);
    }
  }
  return pts.slice(0, max);
}

export function inRing([x, y]: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ---------- Trees ---------- */

/** Unit-height tree parts: a rounded broadleaf crown, a layered pine, one trunk. */
export function treeGeometries() {
  const rnd = rng(7);
  const trunk = new THREE.CylinderGeometry(0.028, 0.05, 0.55, 6);
  trunk.translate(0, 0.275, 0);
  const prep = (g: THREE.BufferGeometry) => { g.deleteAttribute("uv"); g.deleteAttribute("normal"); return g; };
  const lumps: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.IcosahedronGeometry(0.17 + rnd() * 0.1, 1);
    const a = rnd() * Math.PI * 2, d = i ? 0.1 + rnd() * 0.08 : 0;
    g.translate(Math.cos(a) * d, 0.6 + rnd() * 0.25, Math.sin(a) * d);
    lumps.push(prep(g));
  }
  const leaf = mergeVertices(mergeGeometries(lumps)!);
  const pos = leaf.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) + (rnd() - 0.5) * 0.05, pos.getY(i) + (rnd() - 0.5) * 0.05, pos.getZ(i) + (rnd() - 0.5) * 0.05);
  }
  leaf.computeVertexNormals();
  const tiers: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const g = new THREE.ConeGeometry(0.3 - k * 0.06, 0.34, 9, 1);
    g.translate(0, 0.36 + k * 0.17, 0);
    tiers.push(prep(g));
  }
  const pine = mergeVertices(mergeGeometries(tiers)!);
  pine.computeVertexNormals();
  lumps.forEach(g => g.dispose());
  tiers.forEach(g => g.dispose());
  return { trunk, leaf, pine };
}

/** Crowns sway a little in the wind. */
export function patchFoliage(mat: THREE.Material) {
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = shared.uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 ip = instanceMatrix[3].xyz;
  float sw = sin(uTime * 1.25 + ip.x * 0.11 + ip.z * 0.07) + 0.5 * sin(uTime * 2.6 + ip.z * 0.13);
  transformed.xz += vec2(0.02, 0.013) * sw * smoothstep(0.35, 1.0, position.y);
#endif`);
  };
  mat.customProgramCacheKey = () => "foliage";
}

export function foliageColors(season: Season): string[] {
  const green = ["#3f6b2c", "#4d7a33", "#35602a", "#5a8a3a", "#44722f"];
  if (season === "autumn") return [...green, "#c9a227", "#d98b2b", "#b8452a", "#e0b43c", "#a8612a"];
  if (season === "spring") return [...green, "#7fae4a", "#9cc15a", "#f1c9d6"];
  if (season === "winter") return ["#3a5a33", "#4a5f3a", "#6e6250", "#7a6b58"];
  return green;
}

/* ---------- Time of day ---------- */

export type Tod = "day" | "dusk" | "night";
export const TOD_ORDER: Tod[] = ["day", "dusk", "night"];
export const TOD_LABEL: Record<Tod, string> = { day: "낮", dusk: "노을", night: "밤" };

export function todNow(): Tod {
  const h = new Date().getHours();
  return h >= 7 && h < 17 ? "day" : (h >= 17 && h < 20) || (h >= 5 && h < 7) ? "dusk" : "night";
}

export interface Look {
  sunElev: number; sunAz: number; keyElev: number; keyAz: number;
  turbidity: number; rayleigh: number; mie: number; mieG: number;
  key: THREE.Color; keyI: number; hemiSky: THREE.Color; hemiGround: THREE.Color; hemiI: number;
  fog: THREE.Color; fogK: number; exposure: number; env: number;
  windows: number; lamps: number; stars: number; clouds: number; cloudShade: number;
  bloom: number; bloomAt: number; reflect: number;
}

const look = (l: Omit<Look, "key" | "hemiSky" | "hemiGround" | "fog"> & { key: string; hemiSky: string; hemiGround: string; fog: string }): Look => ({
  ...l, key: new THREE.Color(l.key), hemiSky: new THREE.Color(l.hemiSky), hemiGround: new THREE.Color(l.hemiGround), fog: new THREE.Color(l.fog),
});

// Azimuth in degrees from south (+z) toward east (+x); the camera opens from the south-east.
export const LOOKS: Record<Tod, Look> = {
  day: look({
    sunElev: 40, sunAz: -28, keyElev: 40, keyAz: -28, turbidity: 2, rayleigh: 1.3, mie: 0.004, mieG: 0.8,
    key: "#fff3e0", keyI: 3.4, hemiSky: "#c4dcf6", hemiGround: "#6f6552", hemiI: 0.3,
    fog: "#bfd0e2", fogK: 0.16, exposure: 0.6, env: 0.16, windows: 0, lamps: 0, stars: 0, clouds: 0.42, cloudShade: 0.26, bloom: 0.2, bloomAt: 4, reflect: 0.85,
  }),
  dusk: look({
    sunElev: 3.5, sunAz: -70, keyElev: 6, keyAz: -70, turbidity: 6.5, rayleigh: 2.6, mie: 0.007, mieG: 0.9,
    key: "#ffa65a", keyI: 3.4, hemiSky: "#8e9bd0", hemiGround: "#4a3a3a", hemiI: 0.45,
    fog: "#e3aa86", fogK: 0.12, exposure: 0.72, env: 0.3, windows: 0.22, lamps: 0.7, stars: 0, clouds: 0.5, cloudShade: 0.05, bloom: 0.3, bloomAt: 2.5, reflect: 1,
  }),
  night: look({
    sunElev: -5, sunAz: -85, keyElev: 42, keyAz: 55, turbidity: 2, rayleigh: 1, mie: 0.004, mieG: 0.8,
    key: "#a4b8ff", keyI: 0.8, hemiSky: "#3b4f7a", hemiGround: "#0d0f16", hemiI: 0.6,
    fog: "#152238", fogK: 0.2, exposure: 1.05, env: 1.0, windows: 2.1, lamps: 1.8, stars: 1, clouds: 0.3, cloudShade: 0, bloom: 0.55, bloomAt: 1.3, reflect: 1.1,
  }),
};

export function mixLook(a: Look, b: Look, t: number): Look {
  const n = (x: number, y: number) => x + (y - x) * t;
  const c = (x: THREE.Color, y: THREE.Color) => x.clone().lerp(y, t);
  return {
    sunElev: n(a.sunElev, b.sunElev), sunAz: n(a.sunAz, b.sunAz), keyElev: n(a.keyElev, b.keyElev), keyAz: n(a.keyAz, b.keyAz),
    turbidity: n(a.turbidity, b.turbidity), rayleigh: n(a.rayleigh, b.rayleigh), mie: n(a.mie, b.mie), mieG: n(a.mieG, b.mieG),
    key: c(a.key, b.key), keyI: n(a.keyI, b.keyI), hemiSky: c(a.hemiSky, b.hemiSky), hemiGround: c(a.hemiGround, b.hemiGround), hemiI: n(a.hemiI, b.hemiI),
    fog: c(a.fog, b.fog), fogK: n(a.fogK, b.fogK), exposure: n(a.exposure, b.exposure), env: n(a.env, b.env),
    windows: n(a.windows, b.windows), lamps: n(a.lamps, b.lamps), stars: n(a.stars, b.stars), clouds: n(a.clouds, b.clouds),
    cloudShade: n(a.cloudShade, b.cloudShade), bloom: n(a.bloom, b.bloom), bloomAt: n(a.bloomAt, b.bloomAt), reflect: n(a.reflect, b.reflect),
  };
}

export function dirFrom(elevDeg: number, azDeg: number, out = new THREE.Vector3()) {
  const el = THREE.MathUtils.degToRad(elevDeg), az = THREE.MathUtils.degToRad(azDeg);
  return out.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
}

/** The sky melts into the haze at the horizon, and below it is haze, so the far
 * ground and the sky never meet at a hard line. */
export function patchSky(mat: THREE.ShaderMaterial, horizon: THREE.Color) {
  mat.uniforms.uHorizon = { value: horizon };
  mat.fragmentShader = mat.fragmentShader
    .replace("uniform float time;", "uniform float time;\nuniform vec3 uHorizon;")
    .replace("gl_FragColor = vec4( texColor, 1.0 );",
      "texColor = mix( uHorizon, texColor, smoothstep( -0.01, 0.07, direction.y ) );\ngl_FragColor = vec4( texColor, 1.0 );");
  mat.needsUpdate = true;
}

/** A sky full of faint stars, drawn at a fixed distance around the camera. */
export function starField(radius: number) {
  const rnd = rng(42), n = 1800;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = rnd(), v = 0.04 + rnd() * 0.96;
    const th = u * Math.PI * 2, y = v, r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(th) * r * radius, y * radius, Math.sin(th) * r * radius], i * 3);
    const b = 0.5 + rnd() * 0.5, warm = rnd();
    col.set([b * (0.85 + warm * 0.15), b * 0.9, b * (1 - warm * 0.12)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false });
  return new THREE.Points(geo, mat);
}

/** Display-referred finish: a lens flare for the sun (ghosts strung along the line
 * through the image centre, a soft veil and a short starburst, faded by how much of
 * the sun the buildings hide), a gentle vignette, and dither against sky banding. */
export const FinishShader = {
  uniforms: {
    tDiffuse: { value: null }, uVignette: { value: 0.9 },
    uSun: { value: new THREE.Vector2(0.5, 0.5) }, uSunVis: { value: 0 }, uAspect: { value: 1 },
    uFlare: { value: new THREE.Color(1, 0.9, 0.75) },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse; uniform float uVignette; uniform vec2 uSun; uniform float uSunVis; uniform float uAspect; uniform vec3 uFlare;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float ghost(vec2 uv, float a, float r) {
  vec2 c = mix(vec2(0.5), uSun, a);
  float d = length((uv - c) * vec2(uAspect, 1.0));
  return smoothstep(r, r * 0.55, d) * 0.6 + smoothstep(r * 0.08, 0.0, abs(d - r * 0.92)) * 0.5;
}
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  if (uSunVis > 0.001) {
    vec2 ds = (vUv - uSun) * vec2(uAspect, 1.0);
    float d = length(ds);
    float ang = atan(ds.y, ds.x);
    vec3 f = uFlare * (exp(-d * 7.0) * 0.16 + exp(-d * 30.0) * 0.35);
    f += uFlare * pow(abs(cos(ang * 7.0 + 0.3)), 60.0) * exp(-d * 11.0) * 0.28;
    f += vec3(1.0, 0.85, 0.6) * ghost(vUv, 0.62, 0.022) * 0.07;
    f += vec3(0.55, 0.9, 1.0) * ghost(vUv, 0.3, 0.05) * 0.045;
    f += vec3(0.8, 1.0, 0.7) * ghost(vUv, -0.2, 0.03) * 0.06;
    f += vec3(0.6, 0.75, 1.0) * ghost(vUv, -0.55, 0.085) * 0.035;
    f += vec3(1.0, 0.75, 0.9) * ghost(vUv, -0.95, 0.045) * 0.05;
    c.rgb += f * uSunVis;
  }
  vec2 dv = vUv - 0.5;
  c.rgb *= mix(1.0, smoothstep(0.95, 0.25, length(dv)), uVignette * 0.35);
  c.rgb += (h(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = c;
}`,
};
