import * as THREE from "three";
import { RealEstateBuildingsResponse } from "../api/client";

/* The natural-light scene around one complex (components/ComplexHologram.tsx):
 * facades, ground and the time-of-day looks. Footprints, heights and the parcel are
 * real; facade paint, glazing and the flat landscaping on the parcel are drawn. No
 * streets or trees are invented. */

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
${opts.detail ? `diffuseColor.rgb *= 0.95 + 0.07 * fbm3(vWPos.xz * 0.12);` : ""}`)
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

/** Where the 3D plants go (metres, footprint frame): trees, shrubs, flowers. */
export interface Planting { trees: [number, number][]; shrubs: [number, number][]; flowers: [number, number][] }
/** A street lamp on a sidewalk: position, and the unit direction its arm reaches over the road. */
export interface Lamp { x: number; y: number; dx: number; dy: number }
export interface GroundPlan { color: THREE.CanvasTexture; rough: THREE.CanvasTexture; glow: THREE.CanvasTexture; planting: Planting; lamps: Lamp[] }

/** Street lamps along the surveyed major roads: both sidewalks, staggered about every
 * 50 m a side, never inside the parcel or a footprint; one lamp where carriageways overlap. */
export function streetLamps(data: RealEstateBuildingsResponse): Lamp[] {
  const lamps: Lamp[] = [], cell = new Map<string, Lamp[]>();
  const key = (x: number, y: number) => `${Math.floor(x / 20)},${Math.floor(y / 20)}`;
  const near = (x: number, y: number) => {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++)
      for (const l of cell.get(`${Math.floor(x / 20) + i},${Math.floor(y / 20) + j}`) ?? []) if (Math.hypot(l.x - x, l.y - y) < 20) return true;
    return false;
  };
  const rings = [...data.buildings, ...data.context].map(b => b.rings[0]);
  const blocked = (x: number, y: number) => data.site.some(r => inRing([x, y], r)) || rings.some(r => inRing([x, y], r));
  for (const road of data.roads ?? []) {
    let carry = 0;
    for (let i = 0; i < road.line.length - 1; i++) {
      const [ax, ay] = road.line[i], [bx, by] = road.line[i + 1], len = Math.hypot(bx - ax, by - ay);
      if (len < 0.5) continue;
      const ux = (bx - ax) / len, uy = (by - ay) / len, nx = -uy, ny = ux;
      for (let d = carry; d < len; d += 25) {
        const side = Math.round((d - carry) / 25 + i) % 2 ? 1 : -1, off = road.width / 2 + 1.2;
        const x = ax + ux * d + nx * off * side, y = ay + uy * d + ny * off * side;
        if (near(x, y) || blocked(x, y)) continue;
        const lamp = { x, y, dx: -nx * side, dy: -ny * side };
        lamps.push(lamp);
        const k = key(x, y);
        if (!cell.has(k)) cell.set(k, []);
        cell.get(k)!.push(lamp);
      }
      carry = (carry - len) % 25; if (carry < 0) carry += 25;
    }
  }
  return lamps.slice(0, 400);
}

type Season = "spring" | "summer" | "autumn" | "winter";
export function seasonNow(): Season {
  const m = new Date().getMonth() + 1;
  return m >= 3 && m <= 5 ? "spring" : m >= 6 && m <= 9 ? "summer" : m >= 10 && m <= 11 ? "autumn" : "winter";
}

/** The ground painted top-down over ±T metres, smooth (no grain or noise).
 * Surveyed: the parcel (연속지적도), every registered footprint, and major roads at
 * their registered width and lane count (국가기본도 도로중심선). Drawn inside the parcel:
 * lawn, paved aprons around the towers, a perimeter walk and planting beds, whose
 * trees, shrubs and flowers are placed as 3D plants (`planting`). */
export function paintGround(data: RealEstateBuildingsResponse, T: number, size: number, seed: number): GroundPlan {
  const S = size, k = S / (2 * T);
  const X = (x: number) => (x + T) * k, Y = (y: number) => (T - y) * k, m = (v: number) => v * k;
  const rnd = rng(seed);
  const season = seasonNow();
  const lawn = season === "autumn" ? "#76784c" : season === "winter" ? "#7b795f" : season === "spring" ? "#688a48" : "#5a7b3e";
  // Colour carries the detail; roughness and the night glow are low-frequency and
  // painted in the same coordinates onto 1024 px canvases (scaled context).
  const R = Math.min(1024, S);
  const color = canvas(S, S), rough = canvas(R, R);
  const cg = color.getContext("2d")!, rg = rough.getContext("2d")!;
  rg.scale(R / S, R / S);
  const path = (ctx: CanvasRenderingContext2D, ring: Ring) => {
    ctx.beginPath();
    ring.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.closePath();
  };
  const line = (ctx: CanvasRenderingContext2D, pts: [number, number][]) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
  };
  const sitePath = (ctx: CanvasRenderingContext2D) => {
    ctx.beginPath();
    for (const r of data.site) r.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.closePath();
  };
  const towers = data.buildings.map(b => b.rings[0]);
  const rings = [...data.context.map(b => b.rings[0]), ...towers];
  const roads = data.roads ?? [];
  const lamps = streetLamps(data);
  const hasSite = data.site.length > 0;

  // Occupancy mask (~0.5 m/px): R = plantable ground (the parcel, or a band round the
  // towers without one), G = blocked (footprints plus clearance, roads plus verge).
  const M = 1024, mk = M / (2 * T);
  const mask = canvas(M, M), mg = mask.getContext("2d", { willReadFrequently: true })!;
  const MX = (x: number) => (x + T) * mk, MY = (y: number) => (T - y) * mk;
  const mpath = (ring: [number, number][], close = true) => {
    mg.beginPath();
    ring.forEach(([x, y], i) => (i ? mg.lineTo(MX(x), MY(y)) : mg.moveTo(MX(x), MY(y))));
    if (close) mg.closePath();
  };
  mg.lineJoin = mg.lineCap = "round";
  mg.globalCompositeOperation = "lighter";
  mg.fillStyle = mg.strokeStyle = "#ff0000";
  if (hasSite) data.site.forEach(r => { mpath(r); mg.fill(); });
  else { mg.lineWidth = 60 * mk; towers.forEach(r => { mpath(r); mg.fill(); mg.stroke(); }); }
  mg.fillStyle = mg.strokeStyle = "#00ff00";
  mg.lineWidth = 12 * mk;
  rings.forEach(r => { mpath(r); mg.fill(); mg.stroke(); });
  roads.forEach(r => { mg.lineWidth = (r.width + 6) * mk; mpath(r.line, false); mg.stroke(); });
  const md = mg.getImageData(0, 0, M, M).data;
  const ok = (x: number, y: number) => {
    const px = Math.floor(MX(x)), py = Math.floor(MY(y));
    if (px < 0 || py < 0 || px >= M || py >= M) return false;
    const i = (py * M + px) * 4;
    return md[i] > 127 && md[i + 1] < 128;
  };
  const reachT = hasSite ? Math.max(...data.site.flat().map(([x, y]) => Math.max(Math.abs(x), Math.abs(y)))) : T * 0.5;

  // Planting beds (shrubs and flowers), then trees on the open lawn and along the walk.
  const beds: [number, number, number, number, number][] = [];
  for (let i = 0; i < 1200 && beds.length < 70; i++) {
    const x = (rnd() * 2 - 1) * reachT, y = (rnd() * 2 - 1) * reachT;
    if (ok(x, y)) beds.push([x, y, 3 + rnd() * 5, 1.8 + rnd() * 2.6, rnd() * Math.PI]);
  }
  const inBed = (x: number, y: number) => beds.some(([bx, by, rx, ry, a]) => {
    const dx = x - bx, dy = y - by, u = dx * Math.cos(a) + dy * Math.sin(a), v = -dx * Math.sin(a) + dy * Math.cos(a);
    return (u / rx) ** 2 + (v / ry) ** 2 < 1;
  });
  const planting: Planting = { trees: [], shrubs: [], flowers: [] };
  // Beds: shrubs in the middle, flowers toward the rim (about 1.3 plants per m²).
  beds.forEach(([bx, by, rx, ry, a]) => {
    const n = Math.round(Math.PI * rx * ry * 1.3);
    for (let j = 0; j < n; j++) {
      const u = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.92, lx = Math.cos(u) * rx * r, ly = Math.sin(u) * ry * r;
      const p: [number, number] = [bx + lx * Math.cos(a) - ly * Math.sin(a), by + lx * Math.sin(a) + ly * Math.cos(a)];
      (r > 0.6 ? planting.flowers : r > 0.3 || rnd() < 0.5 ? planting.shrubs : planting.flowers).push(p);
    }
  });
  // Along the inside of the parcel boundary: a clipped hedge line, and a tree row behind it.
  const spaced = (list: [number, number][], x: number, y: number, gap: number) => !list.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < gap);
  for (const r of data.site) for (let i = 0; i < r.length; i++) {
    const [ax, ay] = r[i], [bx, by] = r[(i + 1) % r.length], len = Math.hypot(bx - ax, by - ay);
    if (len < 4) continue;
    const nx = -(by - ay) / len, ny = (bx - ax) / len; // rings run counter-clockwise: left is inside
    for (let d = 1; d < len - 1; d += 1.4) {
      const x = ax + (bx - ax) * d / len + nx * 5, y = ay + (by - ay) * d / len + ny * 5;
      if (ok(x, y)) planting.shrubs.push([x, y]);
    }
    for (let d = 4; d < len - 4; d += 8 + rnd() * 2) {
      const x = ax + (bx - ax) * d / len + nx * 9, y = ay + (by - ay) * d / len + ny * 9;
      if (ok(x, y) && spaced(planting.trees, x, y, 6)) planting.trees.push([x, y]);
    }
  }
  // Open lawn: trees at least 7 m apart, clear of beds.
  for (let i = 0; i < 5000 && planting.trees.length < 420; i++) {
    const x = (rnd() * 2 - 1) * reachT, y = (rnd() * 2 - 1) * reachT;
    if (ok(x, y) && !inBed(x, y) && spaced(planting.trees, x, y, 7)) planting.trees.push([x, y]);
  }

  const layout = (ctx: CanvasRenderingContext2D, c: { base: string; walk: string; asphalt: string; lawn: string; path: string; apron: string; bed: string }) => {
    ctx.fillStyle = c.base; ctx.fillRect(0, 0, S, S);
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.save();
    if (hasSite) { sitePath(ctx); ctx.clip("evenodd"); ctx.fillStyle = c.lawn; ctx.fillRect(0, 0, S, S); }
    else { ctx.fillStyle = c.lawn; ctx.strokeStyle = c.lawn; ctx.lineWidth = m(40); towers.forEach(r => { path(ctx, r); ctx.stroke(); ctx.fill(); }); }
    if (hasSite) { ctx.strokeStyle = c.path; ctx.lineWidth = m(7); data.site.forEach(r => { path(ctx, r); ctx.stroke(); }); ctx.strokeStyle = c.lawn; ctx.lineWidth = m(2.2); data.site.forEach(r => { path(ctx, r); ctx.stroke(); }); }
    ctx.strokeStyle = c.apron; ctx.lineWidth = m(10);
    towers.forEach(r => { path(ctx, r); ctx.stroke(); });
    ctx.fillStyle = c.bed;
    beds.forEach(([x, y, rx, ry, a]) => { ctx.beginPath(); ctx.ellipse(X(x), Y(y), m(rx), m(ry), a, 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
    // Roads last, at their surveyed width with a 2.5 m sidewalk each side: a road that
    // crosses the parcel is real and stays paved.
    ctx.strokeStyle = c.walk;
    roads.forEach(r => { ctx.lineWidth = m(r.width + 5); line(ctx, r.line); ctx.stroke(); });
    ctx.strokeStyle = c.asphalt;
    roads.forEach(r => { ctx.lineWidth = m(r.width); line(ctx, r.line); ctx.stroke(); });
  };
  layout(cg, { base: "#8e8c86", walk: "#b3aea5", asphalt: "#3e4146", lawn, path: "#b9b1a2", apron: "#aea799", bed: "#4a3d30" });
  layout(rg, { base: "rgb(0,190,0)", walk: "rgb(0,150,0)", asphalt: "rgb(0,120,0)", lawn: "rgb(0,245,0)", path: "rgb(0,140,0)", apron: "rgb(0,125,0)", bed: "rgb(0,250,0)" });

  // Lane markings from the registered lane count.
  cg.save();
  cg.lineCap = "butt";
  roads.forEach(r => {
    const lanes = Math.max(1, r.lanes);
    if (lanes < 2) return;
    for (let i = 0; i < r.line.length - 1; i++) {
      const [ax, ay] = r.line[i], [bx, by] = r.line[i + 1], len = Math.hypot(bx - ax, by - ay);
      if (len < 1) continue;
      const nx = -(by - ay) / len, ny = (bx - ax) / len;
      for (let l = 1; l < lanes; l++) {
        const off = -r.width / 2 + (r.width * l) / lanes, centre = l === lanes / 2;
        cg.strokeStyle = centre ? "rgba(214,178,70,0.7)" : "rgba(226,226,220,0.38)";
        cg.lineWidth = Math.max(0.75, m(0.15));
        cg.setLineDash(centre ? [] : [m(3), m(5)]);
        cg.beginPath(); cg.moveTo(X(ax + nx * off), Y(ay + ny * off)); cg.lineTo(X(bx + nx * off), Y(by + ny * off)); cg.stroke();
      }
    }
  });
  cg.setLineDash([]);
  cg.restore();
  // Lamp light pools, lit at night through the ground's emissive map.
  const glow = canvas(R, R), gg = glow.getContext("2d")!;
  gg.scale(R / S, R / S);
  gg.fillStyle = "#000"; gg.fillRect(0, 0, S, S);
  gg.globalCompositeOperation = "lighter";
  lamps.forEach(l => {
    const px = X(l.x + l.dx * 1.6), py = Y(l.y + l.dy * 1.6), rad = m(13);
    const g = gg.createRadialGradient(px, py, 0, px, py, rad);
    g.addColorStop(0, "rgba(255,206,150,0.9)"); g.addColorStop(0.4, "rgba(255,180,110,0.32)"); g.addColorStop(1, "rgba(255,170,100,0)");
    gg.fillStyle = g; gg.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  });
  // Soft contact shade around every footprint.
  cg.filter = `blur(${Math.max(2, m(2.6))}px)`;
  cg.fillStyle = "rgba(0,0,0,0.34)";
  rings.forEach(r => { path(cg, r); cg.fill(); });
  cg.filter = "none";
  // Fade toward the edge, so nothing streaks past the painted area.
  for (const [ctx, base] of [[cg, "142,140,134"], [rg, "0,190,0"]] as const) {
    const fade = ctx.createRadialGradient(S / 2, S / 2, S * 0.36, S / 2, S / 2, S * 0.5);
    fade.addColorStop(0, `rgba(${base},0)`); fade.addColorStop(1, `rgba(${base},1)`);
    ctx.fillStyle = fade; ctx.fillRect(0, 0, S, S);
  }
  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
    return t;
  };
  return { color: tex(color, true), rough: tex(rough, false), glow: tex(glow, true), planting, lamps };
}

export function inRing([x, y]: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
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
    sunElev: 40, sunAz: -28, keyElev: 40, keyAz: -28, turbidity: 1.4, rayleigh: 1.9, mie: 0.003, mieG: 0.8,
    key: "#fff3e0", keyI: 3.4, hemiSky: "#c4dcf6", hemiGround: "#6f6552", hemiI: 0.3,
    fog: "#a9c1dc", fogK: 0.075, exposure: 0.56, env: 0.16, windows: 0, lamps: 0, stars: 0, clouds: 0.42, cloudShade: 0.26, bloom: 0.2, bloomAt: 4, reflect: 0.85,
  }),
  dusk: look({
    sunElev: 3.5, sunAz: -70, keyElev: 6, keyAz: -70, turbidity: 6.5, rayleigh: 2.6, mie: 0.007, mieG: 0.9,
    key: "#ffa65a", keyI: 3.4, hemiSky: "#8e9bd0", hemiGround: "#4a3a3a", hemiI: 0.45,
    fog: "#e3aa86", fogK: 0.12, exposure: 0.72, env: 0.3, windows: 0.22, lamps: 0.6, stars: 0, clouds: 0.5, cloudShade: 0.05, bloom: 0.3, bloomAt: 2.5, reflect: 1,
  }),
  night: look({
    sunElev: -5, sunAz: -85, keyElev: 42, keyAz: 55, turbidity: 2, rayleigh: 1, mie: 0.004, mieG: 0.8,
    key: "#a4b8ff", keyI: 0.8, hemiSky: "#3b4f7a", hemiGround: "#0d0f16", hemiI: 0.6,
    fog: "#152238", fogK: 0.2, exposure: 1.05, env: 1.0, windows: 2.1, lamps: 1.6, stars: 1, clouds: 0.3, cloudShade: 0, bloom: 0.55, bloomAt: 1.3, reflect: 1.1,
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

/** The full moon: a photographic disk (/3d/moon.webp, from the Solar System Scope
 * lunar map, CC BY 4.0) with a soft halo, at a fixed direction in the sky — up and to
 * the right of the opening view, low over the horizon. It keeps that direction as the
 * camera orbits, zooms or pans, sits beyond the haze, and anything nearer (a tower)
 * hides it. Shown at night only. */
export function moonInSky() {
  // Opening view looks along -(0.74, 0.22, 0.74); 20° to its right, 4° up.
  const fwd = new THREE.Vector3(-1, 0, -1).normalize(), right = new THREE.Vector3(1, 0, -1).normalize();
  const az = THREE.MathUtils.degToRad(20), el = THREE.MathUtils.degToRad(4);
  const dir = fwd.clone().multiplyScalar(Math.cos(az)).addScaledVector(right, Math.sin(az)).multiplyScalar(Math.cos(el)).setY(Math.sin(el)).normalize();
  const disc = new THREE.TextureLoader().load("/3d/moon.webp");
  disc.colorSpace = THREE.SRGBColorSpace;
  const glowCanvas = canvas(128, 128), g = glowCanvas.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,250,235,0.32)"); grad.addColorStop(0.3, "rgba(225,232,255,0.1)"); grad.addColorStop(1, "rgba(200,215,255,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const glow = new THREE.CanvasTexture(glowCanvas);
  glow.colorSpace = THREE.SRGBColorSpace;
  const mat = (tex: THREE.Texture) => {
    // Black albedo, the image as emission, its alpha as coverage: unlit, unfogged.
    const m = new THREE.MeshStandardMaterial({ color: "#000000", map: tex, emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: 0,
      transparent: true, depthWrite: false, fog: false, roughness: 1, metalness: 0 });
    m.userData.sky = true;
    return m;
  };
  const quad = new THREE.PlaneGeometry(1, 1);
  const halo = new THREE.Mesh(quad, mat(glow)), moon = new THREE.Mesh(quad, mat(disc));
  halo.renderOrder = 1; moon.renderOrder = 2;
  const group = new THREE.Group();
  group.add(halo, moon);
  group.visible = false;
  return {
    group,
    /** Each frame: far along the fixed direction from the camera, facing it. */
    update(camera: THREE.PerspectiveCamera) {
      if (!group.visible) return;
      const d = camera.far * 0.6, size = 2 * d * Math.tan(THREE.MathUtils.degToRad(1.3)); // ~2.6°: larger than life, as it reads
      group.position.copy(camera.position).addScaledVector(dir, d);
      group.quaternion.copy(camera.quaternion);
      moon.scale.setScalar(size);
      halo.scale.setScalar(size * 2.6);
    },
    /** Look.stars: 1 at night, 0 by day. */
    setLevel(level: number) {
      group.visible = level > 0.3;
      (moon.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.5 * level;
      (halo.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.7 * level;
    },
    dispose() { quad.dispose(); disc.dispose(); glow.dispose(); [moon, halo].forEach(m => (m.material as THREE.Material).dispose()); },
  };
}
