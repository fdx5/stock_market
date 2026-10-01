// Native WebGPU adapter for the MIT-licensed Tidewater engine.
// Copyright (c) 2026 DRG Software Solutions LLC (engine).
// Upstream and full MIT notice: ../../vendor/tidewater/{NOTICE.md,LICENSE}.
import { GPU } from '../../vendor/tidewater/engine/gpu/GPU.js';
import { Texture, RenderTarget } from '../../vendor/tidewater/engine/gpu/Texture.js';
import { generateMipmaps, warmMipmaps } from '../../vendor/tidewater/engine/gpu/Mipmaps.js';
import { MeshRenderer } from '../../vendor/tidewater/engine/render/MeshRenderer.js';
import { Material } from '../../vendor/tidewater/engine/render/Material.js';
import { FullscreenPass } from '../../vendor/tidewater/engine/render/FullscreenPass.js';
import { SunShadows } from '../../vendor/tidewater/engine/render/Shadows.js';
import { FrameUniforms, setFrameCamera, createViewUniforms } from '../../vendor/tidewater/engine/render/Frame.js';
import { ShaderModule } from '../../vendor/tidewater/engine/gpu/Shader.js';
import { UniformBlock } from '../../vendor/tidewater/engine/gpu/Uniforms.js';
import { SceneLighting } from '../../vendor/tidewater/engine/render/wgsl/lighting.js';
import { Scene, Mesh, PerspectiveCamera } from '../../vendor/tidewater/engine/index.js';
import { waterMaterial, updateWaveTile } from './ComplexWater.js';
import { GpuTimer } from './GpuTimer.js';
import { packInto, warmPack } from './texturePack.js';
import { canEncodeBC7, encodeBC7, warmBC7 } from './bc7Encode.js';
import { gpuCaps } from '../gpuCaps';
import { fetchStatic } from '../../staticCdn';

/** Render quality. high: desktop; medium: tablets and integrated GPUs; low: phones and
 * software / fallback adapters. The view steps down on its own while frames are slow. */
export const QUALITY = {
  high: { name: 'high', shadow: 2048, pcss: 1, ssr: true, clouds: true },
  medium: { name: 'medium', shadow: 2048, pcss: 0, ssr: true, clouds: false },
  low: { name: 'low', shadow: 1024, pcss: 0, ssr: false, clouds: false },
};

// The engine owns a device singleton. Share it, but give each panel its own
// canvas context, scene, buffers and targets. Render/submit each view atomically.
let initialization;
let shadows;
let deviceLost = false;
let shadowOwner;
let shadowKey = '';
/** pcss: cascades with contact-hardening soft shadows (the costliest filter); 0 = PCF. */
function useShadows({ shadow: size, pcss }) {
  if (shadowKey === size + '/' + pcss) return;
  shadows?.dispose();
  shadows = new SunShadows({ size, splits: [180, 600, 1800], normalBias: [0.12, 0.3, 0.7], pcssCascades: pcss });
  shadowKey = size + '/' + pcss;
  shadowOwner = null;
}
// Photographic surface detail (scripts/detail-textures.py): small CC0 scans tiled in world
// space over the painted surfaces up close. Loaded with the device, alongside the page.
let details = null;
let detailLoad = null;
async function loadDetails() {
  const meta = await fetchStatic('/3d/detail.json').then(r => { if (!r.ok) throw new Error('detail.json ' + r.status); return r.json(); });
  const out = {};
  await Promise.all(Object.entries(meta).map(async ([name, m]) => {
    const blob = await fetchStatic('/3d/' + m.file).then(r => { if (!r.ok) throw new Error(m.file + ' ' + r.status); return r.blob(); });
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const tex = new Texture({ width: bmp.width, height: bmp.height, format: 'rgba8unorm', mips: true, usage: ['sample', 'render', 'copyDst'], label: 'detail ' + name });
    GPU.queue.copyExternalImageToTexture({ source: bmp }, { texture: tex.getGPU() }, [bmp.width, bmp.height]);
    generateMipmaps(tex);
    bmp.close();
    out[name] = { tex, metres: m.metres, avgRough: m.avgRough };
  }));
  details = out;
}
async function device() {
  // (a device already made — before a hot update of this module — is reused)
  initialization ??= (GPU.device && !deviceLost ? Promise.resolve() : GPU.init({ headless: true })).then(() => {
    gpuCaps.bc = GPU.features.has('texture-compression-bc');
    gpuCaps.etc2 = GPU.features.has('texture-compression-etc2');
    warmBC7();
    // (the mip chains and the surface pack, made ahead: see warmMipmaps)
    warmMipmaps(['rgba8unorm', 'rgba8unorm-srgb', 'rgba16float', 'r8unorm']);
    warmPack('rgba8unorm', 'vec4f(A.x, A.y, B.y, B.z)', 2);
    warmPack('r8unorm', 'vec4f(A.y, 0.0, 0.0, 1.0)', 1);
    // (the browser's own copy pipelines for pictures, made on the first copy into each format —
    // a compile on its GPU process's main thread: done here, as the device is made, not later
    // while a complex is on screen)
    void warmCopies();
    GPU.format = navigator.gpu.getPreferredCanvasFormat();
    SceneLighting.set('envSpecular', new ShaderModule({ name: 'complex reflected surroundings', deps: [atmosphere],
      bindings: { env: { uniform: EnvUniforms }, envCube: { texture: envTexture, viewDimension: 'cube' }, envPrev: { texture: envPrevTexture, viewDimension: 'cube' } }, code: `
      var<private> envP: vec3f;
      fn hookEnvSpecular(R: vec3f, roughness: f32) -> vec3f {
        let sky = mix(skyBase(R), frame.horizonColor, roughness * 0.55) * frame.envIntensity;
        // (smooth surfaces only — glass, car paint, wet paving: a painted band or wall keeps the
        // colour measured from the photographs, not a tint of its grey neighbours)
        let w = env.on * (1.0 - smoothstep(0.15, 0.3, roughness));
        if (w <= 0.0) { return sky; }
        // (where the ray leaves the sphere round the complex, seen from the cube's centre)
        let o = envP - env.probe.xyz; let b = dot(o, R); let c = dot(o, o) - env.probe.w * env.probe.w;
        let t = max(-b + sqrt(max(b * b - c, 0.0)), 0.0);
        let dir = normalize(o + R * t) * vec3f(1.0, 1.0, -1.0);
        // (a new capture fades in over a second: swapped at once, every window's reflection
        // changed in one frame — a flicker whenever the sun had moved on a few degrees)
        let s = mix(textureSampleLevel(envPrev, smpLinearClamp, dir, 0.0), textureSampleLevel(envCube, smpLinearClamp, dir, 0.0), env.fade);
        // (leaves are drawn with a partial alpha: any cover counts)
        return mix(sky, s.rgb / max(s.a, 1e-3) * min(s.a, 1.0), w * min(s.a * 8.0, 1.0));
      }` }));
    // Light bounced off the ground (paving, grass, soil: a warm grey, ~20 %) onto what faces
    // sideways or down: the shaded side of a block is filled from below as well as by the
    // blue sky, instead of reading cold violet. (The sky's own lower half stays in envDiffuse.)
    SceneLighting.set('bounce', new ShaderModule({ name: 'complex ground bounce', code: `
      fn hookBounce(P: vec3f, N: vec3f) -> vec3f {
        let below = sat(0.5 - 0.5 * N.y);
        let ground = frame.sunColor * max(frame.sunDir.y, 0.0) * 0.75 + frame.skyIrradiance * PI;
        return vec3f(0.2, 0.185, 0.16) * ground * below * INV_PI;
      }` }));
    // Plant cards: the shadow looked up a couple of metres toward the sun, so a tree's crossed
    // cards don't shade one another in dark wedges (buildings and other trees still do).
    SceneLighting.set('shadowPosition', new ShaderModule({ name: 'complex foliage shadow offset', code: `
      fn hookShadowPosition(P: vec3f, N: vec3f, pixel: vec2f) -> vec3f {
#if FOLIAGE == 2
        return P + frame.sunDir * 0.6;
#elif FOLIAGE
        return P + frame.sunDir * 2.2;
#else
        return P;
#endif
      }` }));
    detailLoad ??= loadDetails().catch(err => console.info('[3D] surface detail unavailable:', err));
    GPU.device.lost.then(() => { deviceLost = true; });
    GPU.device.addEventListener('uncapturederror', event => {
      console.warn('[3D] Native GPU validation failed:', event.error.message);
      deviceLost = true;
    });
  });
  await initialization;
  if (deviceLost) throw new Error('WebGPU device lost');
}

// Development: a hot update runs this module again. The engine's other modules keep
// their layouts, uniform blocks and pipelines on the device they were made with, so the
// new module must reuse that device (device() below); a second one fails validation
// and leaves the first, still referenced, holding ~400 MB. Only this module's shadow
// atlas is its own to release.
if (import.meta.hot) import.meta.hot.dispose(() => { shadows?.dispose(); shadows = null; shadowKey = ''; });

const atmosphere = new ShaderModule({ name: 'complex daylight atmosphere', code: /* wgsl */`
fn skyHash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn skyNoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(skyHash(i), skyHash(i + vec2f(1, 0)), u.x), mix(skyHash(i + vec2f(0, 1)), skyHash(i + vec2f(1, 1)), u.x), u.y);
}
fn skyFbm(p0: vec2f) -> f32 {
  var p = p0; var a = 0.5; var s = 0.0;
  for (var i = 0; i < 5; i++) { s += a * skyNoise(p); p = mat2x2f(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; }
  return s;
}
// Fair-weather cumulus: domain-warped billows, gathered into separate puffs of varied
// size by a slow coverage field.
fn cumulus(uv: vec2f) -> f32 {
  let warp = vec2f(skyFbm(uv * 0.7 + vec2f(3.1, 1.7)), skyFbm(uv * 0.7 + vec2f(8.3, 2.8))) - 0.5;
  let billow = skyFbm(uv * 1.7 + warp * 0.9);
  let cover = smoothstep(0.34, 0.6, skyNoise(uv * 0.85 + vec2f(5.0, 1.0)) * 0.7 + skyNoise(uv * 0.3 + vec2f(2.0, 7.0)) * 0.3);
  // Crisp, heaped edges where a puff is dense; nothing between puffs.
  return smoothstep(0.5, 0.6, billow * (0.62 + 0.55 * cover)) * smoothstep(0.05, 0.4, cover);
}
// Weather (frame.debug): x overcast 0..1, y rain, z snow.
// The overcast deck's colour without its texture (grey by day, milky in snow, leaden in
// rain; the haze colour lit by the city at night). Twin of patchSky in complexScene.ts.
fn deckColor(ray: vec3f) -> vec3f {
  let day = 1.0 - frame.night;
  let e = clamp(ray.y, 0.0, 1.0);
  var grey = mix(vec3f(0.6, 0.64, 0.69), vec3f(0.8, 0.82, 0.85), frame.debug.z) * mix(1.0, 0.66, frame.debug.y);
  grey *= mix(0.35, 1.0, smoothstep(-0.12, 0.35, frame.sunDir.y));
  return mix(frame.horizonColor * 0.9 + vec3f(0.025, 0.02, 0.016), grey, day) * mix(0.93, 1.05, e);
}
// Clear-sky gradient, closed over by any overcast (also what glass reflects: no cloud
// noise per facade pixel).
fn skyBase(ray: vec3f) -> vec3f {
  let day = 1.0 - frame.night;
  let e = clamp(ray.y, 0.0, 1.0);
  let dusk = 1.0 - smoothstep(0.04, 0.45, frame.sunDir.y);
  let zenith = mix(vec3f(0.08, 0.27, 0.72), vec3f(0.24, 0.2, 0.34), dusk);
  let horizon = mix(vec3f(0.55, 0.71, 0.9), frame.horizonColor, dusk * 0.85);
  let daySky = mix(horizon, zenith, pow(e, 0.55));
  let nightSky = mix(frame.horizonColor * 0.45, vec3f(0.006, 0.013, 0.04), pow(e, 0.35));
  return mix(mix(nightSky, daySky, day), deckColor(ray), frame.debug.x * smoothstep(-0.02, 0.06, ray.y) * 0.95);
}
// The sky with its clouds, without the sun disc (also what the water reflects).
fn skyClouds(ray: vec3f) -> vec3f { return skyCloudsOver(ray, skyBase(ray)); }
fn skyCloudsOver(ray: vec3f, base: vec3f) -> vec3f {
  let day = 1.0 - frame.night;
  var sky = base;
  if (ray.y > 0.0) {
    // A cloud layer overhead, seen in perspective; drifting slowly with the wind.
    // A curved cloud deck: near the horizon puffs flatten, but are not smeared into streaks.
    let uv = ray.xz / (ray.y + 0.22) * 1.35 + vec2f(frame.time * 0.005, frame.time * 0.0018);
    let d = cumulus(uv) * (1.0 - frame.debug.x);
    if (d > 0.002) {
      // Self-shadow: denser toward the sun means a darker underside.
      let toSun = normalize(frame.sunDir.xz + vec2f(0.0001, 0.0)) * 0.22;
      let lit = clamp(1.0 - (cumulus(uv + toSun) - d * 0.35) * 1.5, 0.0, 1.0);
      let sunTint = frame.sunColor / max(max(frame.sunColor.r, max(frame.sunColor.g, frame.sunColor.b)), 0.001);
      let dayCloud = mix(vec3f(0.6, 0.65, 0.74), vec3f(1.06, 1.05, 1.02) * mix(vec3f(1.0), sunTint, 0.3), lit);
      let cloud = mix(frame.horizonColor * 0.25, dayCloud, day);
      // Thin toward the horizon, where the haze takes over.
      sky = mix(sky, cloud, clamp(d * 1.25, 0.0, 0.97) * smoothstep(0.0, 0.08, ray.y));
    }
  }
  if (frame.debug.x > 0.001) {
    // The deck's texture: uneven thickness, darker ragged scud under rain.
    let uv = ray.xz / (max(ray.y, 0.0) + 0.3) * 0.9 + vec2f(frame.time * 0.012, frame.time * 0.004);
    let thick = skyFbm(uv * 0.8);
    let scud = smoothstep(0.52, 0.72, skyFbm(uv * 1.9 + vec2f(4.0, 9.0) + frame.time * 0.01));
    var deck = deckColor(ray) * (0.8 + 0.34 * thick) * (1.0 - 0.3 * frame.debug.y * scud);
    // The sun a pale glow behind thin cloud (snow, never rain).
    let sunHue = frame.sunColor / max(max(frame.sunColor.r, max(frame.sunColor.g, frame.sunColor.b)), 0.001);
    deck += sunHue * 0.22 * pow(max(dot(ray, frame.sunDir), 0.0), 18.0) * day * (1.0 - frame.debug.y) * smoothstep(-0.02, 0.1, frame.sunDir.y);
    sky = mix(sky, deck, frame.debug.x * smoothstep(-0.02, 0.06, ray.y) * 0.95);
  }
  return sky;
}
// Stars (frame.debug.w: how many show; frame.pad0: the sky's turn about the pole, from
// sidereal time). Twin of starField in complexScene.ts patchSky.
fn sHash3(p0: vec3f) -> vec3f { var p = fract(p0 * vec3f(0.1031, 0.103, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
fn starLayer(d: vec3f, scale: f32, density: f32, pr: f32, bright: f32, halo: f32, t: f32) -> vec3f {
  let c = floor(d * scale); let h = sHash3(c);
  if (h.x > density) { return vec3f(0.0); }
  let sd = normalize(c + 0.2 + 0.6 * sHash3(c + 17.0));
  let ang = length(d - sd); let k = h.z;
  var col = vec3f(1.15, 0.78, 0.58);
  if (k < 0.12) { col = vec3f(0.72, 0.82, 1.15); } else if (k < 0.6) { col = vec3f(1.0, 0.98, 0.95); } else if (k < 0.86) { col = vec3f(1.1, 0.95, 0.78); }
  let b = bright * (0.2 + 0.8 * pow(h.y, 3.0));
  let tw = 1.0 + 0.45 * sin(t * (1.5 + 5.0 * h.y) + h.x * 90.0) * sin(t * (2.3 + 3.0 * h.z) + h.y * 40.0);
  let core = exp(-pow(ang / (pr * 0.95), 2.0)) + halo * exp(-ang / (pr * 3.5));
  return col * b * tw * core;
}
fn starField(ray: vec3f, pr: f32) -> vec3f {
  let vis = frame.debug.w;
  if (vis < 0.002 || ray.y < -0.02) { return vec3f(0.0); }
  let k = vec3f(0.0, 0.6088, -0.7934);
  let cs = cos(-frame.pad0); let sn = sin(-frame.pad0);
  let d = ray * cs + cross(k, ray) * sn + k * dot(k, ray) * (1.0 - cs);
  let n = normalize(vec3f(0.42, 0.18, 0.89));
  let band = exp(-pow(dot(d, n) / 0.17, 2.0));
  let dust = skyFbm(vec2f(atan2(d.z, d.x) * 5.0, d.y * 7.0));
  let t = frame.time;
  let s = starLayer(d, 95.0, 0.5 + 0.4 * band, pr, 0.32, 0.0, t)
        + starLayer(d, 42.0, 0.45, pr, 0.85, 0.04, t)
        + starLayer(d, 15.0, 0.28, pr * 1.3, 2.6, 0.12, t);
  let milky = vec3f(0.022, 0.025, 0.036) * band * smoothstep(0.3, 0.75, dust) * (1.0 - 0.6 * smoothstep(0.55, 0.7, skyFbm(vec2f(atan2(d.z, d.x) * 11.0, d.y * 16.0))));
  return (s + milky) * vis * smoothstep(-0.02, 0.22, ray.y);
}
fn complexSky(ray: vec3f, pr: f32) -> vec3f {
  let day = 1.0 - frame.night;
  var sky = skyCloudsOver(ray, skyBase(ray) + starField(ray, pr));
  // The sun: a small soft disc, no glare halo (the sky reads as plain blue with clouds).
  let sun = max(dot(ray, frame.sunDir), 0.0);
  let sunHue = frame.sunColor / max(max(frame.sunColor.r, max(frame.sunColor.g, frame.sunColor.b)), 0.001);
  sky = mix(sky, sunHue * 1.15, smoothstep(0.99985, 0.99995, sun) * day * 0.85 * (1.0 - frame.debug.x));
  return sky;
}` });
const skyCode = /* wgsl */`
fn fragment(in: FSIn) -> vec4f {
  let p = frame.invProj * vec4f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0, 0.001, 1.0);
  let ray = normalize((frame.invView * vec4f(normalize(p.xyz / p.w), 0.0)).xyz);
  // (a pixel's angular size, for stars one pixel across)
  let pr = length(fwidth(ray));
  return vec4f(complexSky(ray, pr), 1.0);
}`;

// Falling rain and snow: twin of PRECIP_GLSL / precipField in complexScene.ts (keep the
// two in step). Drops live on cylinders around the camera (PRECIP_RADII); a cylinder
// shows where nothing in the scene is nearer along the ray.
const PRECIP_WGSL = /* wgsl */`
fn pHash(p: vec2f) -> f32 { var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
fn rainAt(q0: vec2f, r: f32, pix: f32, t: f32, amount: f32, slant: f32) -> f32 {
  let cu = r * 0.024; let cv = cu * 7.0;
  var q = q0; q.x += q.y * slant; q.y += t * 8.5;
  let g = q / vec2f(cu, cv); let cell = floor(g); let f = g - cell;
  if (pHash(cell + r) > amount * 0.6) { return 0.0; }
  let x0 = 0.2 + 0.6 * pHash(cell + r + 1.7); let y0 = 0.25 * pHash(cell + r + 3.1);
  let w = max(0.0045, pix * 0.75);
  let across = smoothstep(w, 0.0, abs(f.x - x0) * cu);
  let along = (f.y - y0) / 0.7;
  return across * smoothstep(0.0, 0.2, along) * smoothstep(1.0, 0.55, along) * min(1.0, 0.0045 / w * 1.6);
}
fn snowAt(q0: vec2f, r: f32, pix: f32, t: f32, amount: f32) -> f32 {
  let c = r * 0.045;
  var q = q0; q.y += t * 0.735;
  let g = q / c; let cell = floor(g); let f = g - cell;
  let h = pHash(cell + r);
  if (h > amount * 0.42) { return 0.0; }
  var p0 = vec2f(0.3 + 0.4 * pHash(cell + r + 1.7), 0.3 + 0.4 * pHash(cell + r + 3.1));
  p0.x += sin(t * 1.3 + h * 40.0) * 0.14;
  let rad = 0.007 + 0.008 * pHash(cell + r + 5.3); let rr = max(rad, pix * 0.9);
  let d = length((f - p0) * c);
  return smoothstep(rr, rr * 0.3, d) * min(1.0, pow(rad / rr, 2.0) * 1.4);
}
fn precipitate(c0: vec3f, uv: vec2f) -> vec3f {
  let rain = frame.debug.y; let snow = frame.debug.z;
  if (rain < 0.001 && snow < 0.001) { return c0; }
  let p = frame.invProj * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.001, 1.0);
  let ray = normalize((frame.invView * vec4f(normalize(p.xyz / p.w), 0.0)).xyz);
  let fwd = normalize((frame.invView * vec4f(0.0, 0.0, -1.0, 0.0)).xyz);
  let size = vec2f(textureDimensions(sceneDepth));
  let d = textureLoad(sceneDepth, vec2i(clamp(uv, vec2f(0.0), vec2f(0.9999)) * size), 0).x;
  // (nothing drawn: the sky, as far as can be)
  var sceneZ = 1e9;
  if (d > 0.0) { sceneZ = viewDepth(d); }
  let pixAngle = 2.0 / (frame.proj[1][1] * frame.resolution.y);
  let hl = max(length(ray.xz), 1e-4);
  let side = smoothstep(0.12, 0.45, hl);
  let rainTint = frame.horizonColor * 1.35 + 0.025;
  let snowTint = frame.horizonColor * 1.7 + 0.05;
  var c = c0;
  let radii = array<f32, 5>(28.0, 16.0, 9.0, 5.0, 2.5);
  for (var i = 0; i < 5; i++) {
    let r = radii[i];
    let t = r / hl;
    if (t * dot(ray, fwd) > sceneZ) { continue; }
    let w = frame.cameraPos + ray * t;
    let q = vec2f(atan2(ray.z, ray.x) * r, w.y);
    let pix = t * pixAngle;
    var a = 0.0; var s = 0.0;
    if (rain > 0.001) { a = rainAt(q, r, pix, frame.time, rain, 0.18); }
    if (snow > 0.001) { s = snowAt(q, r, pix, frame.time, snow); }
    let k = clamp(a * 0.34 + s * 0.9, 0.0, 1.0) * exp(-t * 0.012) * side;
    c = mix(c, mix(rainTint, snowTint, s / max(a + s, 0.001)), k);
  }
  return c;
}`;

// Ambient occlusion in screen space, at half resolution (after N8AO / Alchemy AO, McGuire
// 2011): what the flat sky and bounce light miss — where a building meets the ground, the
// window reveals and slab undersides, the ground under trees and between blocks. The
// radius follows the distance (a metre up close, several from the overview), so corners
// read at every zoom. Normals come from the depth (the forward pass writes none).
const AO_CODE = /* wgsl */`
fn aoView(ip: vec2i, size: vec2f) -> vec3f {
  let q = clamp(ip, vec2i(0), vec2i(size) - 1);
  // (the sky, at infinite depth: a point far behind instead of a NaN)
  return viewFromDepth((vec2f(q) + 0.5) / size, max(textureLoad(sceneDepth, q, 0).x, 1e-6));
}
fn fragment(in: FSIn) -> vec4f {
  let size = vec2f(textureDimensions(sceneDepth));
  let ip = vec2i(in.uv * size);
  let d = textureLoad(sceneDepth, ip, 0).x;
  if (d <= 0.0) { return vec4f(1.0, 60000.0, 0.0, 1.0); }
  let P = aoView(ip, size);
  // (the flatter side of each pair: no normals bent across silhouettes)
  let l = aoView(ip - vec2i(1, 0), size); let r = aoView(ip + vec2i(1, 0), size);
  let u = aoView(ip - vec2i(0, 1), size); let b = aoView(ip + vec2i(0, 1), size);
  let dx = select(P - l, r - P, abs(r.z - P.z) < abs(P.z - l.z));
  let dy = select(P - u, b - P, abs(b.z - P.z) < abs(P.z - u.z));
  var N = normalize(cross(dx, dy));
  if (dot(N, P) > 0.0) { N = -N; }
  let dist = -P.z;
  let R = clamp(dist * 0.035, 0.7, 9.0);
  // the radius on screen, in pixels of the full-size depth
  let rPx = R * frame.proj[1][1] * 0.5 * size.y / dist;
  if (rPx < 1.5) { return vec4f(1.0, dist, 0.0, 1.0); }
  // interleaved gradient noise: each pixel turns the pattern, the blur averages it out
  let ign = fract(52.9829189 * fract(dot(in.pos.xy, vec2f(0.06711056, 0.00583715))));
  var occ = 0.0;
  let COUNT = 12;
  for (var i = 0; i < COUNT; i++) {
    let t = (f32(i) + ign) / f32(COUNT);
    let a = t * 18.8495559 + ign * 6.2831853;   // three turns of a spiral
    let o = vec2f(cos(a), sin(a)) * rPx * (0.12 + 0.88 * t * t);
    let S = aoView(ip + vec2i(o), size);
    let v = S - P;
    let vv = dot(v, v);
    let fall = sat(1.0 - vv / (R * R));
    occ += sat(dot(v, N) * inverseSqrt(vv + 1e-4) - 0.08) * fall;
  }
  let ao = sat(1.0 - occ / f32(COUNT) * 2.2);
  return vec4f(ao * ao, dist, 0.0, 1.0);
}`;
// Depth-aware blur of the AO (one axis per pass): no dark halo spills off an edge.
const aoBlurCode = axis => /* wgsl */`
fn fragment(in: FSIn) -> vec4f {
  let size = vec2f(textureDimensions(aoSrc));
  let full = vec2f(textureDimensions(sceneDepth));
  let ip = vec2i(in.uv * size);
  let z0 = viewDepth(max(textureLoad(sceneDepth, vec2i(in.uv * full), 0).x, 1e-6));
  var sum = 0.0; var wsum = 0.0;
  for (var i = -3; i <= 3; i++) {
    let q = clamp(ip + ${axis === 0 ? 'vec2i(i, 0)' : 'vec2i(0, i)'}, vec2i(0), vec2i(size) - 1);
    let z = viewDepth(max(textureLoad(sceneDepth, vec2i((vec2f(q) + 0.5) / size * full), 0).x, 1e-6));
    let dz = (z - z0) / (z0 * 0.03 + 0.05);
    let w = exp(-f32(i * i) / 8.0) * exp(-dz * dz);
    sum += textureLoad(aoSrc, q, 0).r * w; wsum += w;
  }
  return vec4f(sum / max(wsum, 1e-4), textureLoad(aoSrc, ip, 0).g, 0.0, 1.0);
}`;

const finishCode = /* wgsl */`
fn fragment(in: FSIn) -> vec4f {
  let px = 1.0 / vec2f(textureDimensions(src));
  var c = textureSampleLevel(src, smpLinearClamp, in.uv, 0.0).rgb;
  c = select(min(c, vec3f(30000.0)), vec3f(0.0), c != c);
#if AO
  // (before the edge filter: a sampled blur of the occlusion, whole-screen)
  let aoTexel = textureSampleLevel(aoTex, smpLinearClamp, in.uv, 0.0);
  let finalZ = viewDepth(max(textureLoad(sceneDepth, vec2i(in.uv * vec2f(textureDimensions(sceneDepth))), 0).x, 1e-6));
  // (a plant or the water in front of the depth the occlusion was taken at: unshaded)
  let occl = select(1.0, aoTexel.r, abs(finalZ - aoTexel.g) < finalZ * 0.03 + 0.3);
#endif
  // Small edge-aware filter at internal resolution reduces facade shimmer.
  let a = textureSampleLevel(src, smpLinearClamp, in.uv + vec2f(px.x, 0.0), 0.0).rgb;
  let b = textureSampleLevel(src, smpLinearClamp, in.uv - vec2f(px.x, 0.0), 0.0).rgb;
  let d = textureSampleLevel(src, smpLinearClamp, in.uv + vec2f(0.0, px.y), 0.0).rgb;
  let e = textureSampleLevel(src, smpLinearClamp, in.uv - vec2f(0.0, px.y), 0.0).rgb;
  let edge = length(a - b) + length(d - e);
  c = mix(c, (a + b + d + e + c * 4.0) / 8.0, smoothstep(0.15, 0.8, edge) * 0.65);
#if AO
  c *= occl;
#if AO_SHOW
  return vec4f(vec3f(occl), 1.0);
#endif
#endif
  c = precipitate(c, in.uv);
  c *= frame.exposure;
#if BLOOM
  c += textureSampleLevel(bloomTex, smpLinearClamp, in.uv, 0.0).rgb * bloom.strength;
#endif
#if TONEMAP_NEUTRAL
  // Khronos PBR Neutral: base colours come out as painted (no ACES hue skew and
  // oversaturation of the facades and grass); highlights roll off into white.
  c *= 1.45;
  let lo = min(c.r, min(c.g, c.b));
  c -= select(0.04, lo - 6.25 * lo * lo, lo < 0.08);
  let peak = max(c.r, max(c.g, c.b));
  if (peak > 0.76) {
    let newPeak = 1.0 - 0.0576 / (peak - 0.52);
    c *= newPeak / peak;
    c = mix(c, vec3f(newPeak), 1.0 - 1.0 / (0.15 * (peak - newPeak) + 1.0));
  }
  c = clamp(c, vec3f(0.0), vec3f(1.0));
  c = select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
#else
  c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
  c = pow(c, vec3f(1.0 / 2.2));
#endif
  return vec4f(c, 1.0);
}`;
// Bloom (Jimenez 2014, Call of Duty: Advanced Warfare): the bright part of the frame
// (lit windows, street lamps, the sun on glass) blurred through a chain of half-size
// levels and added back — light spilling round a lit window at night instead of a
// hard-edged rectangle. 13-tap downsample (a soft threshold on the first), tent upsample.
const BloomUniforms = new UniformBlock('Bloom', { strength: ['f32', 0], threshold: ['f32', 1], exposure: ['f32', 1], pad: ['f32', 0] }, { label: 'complex bloom' });
const BLOOM_LEVELS = 5;
const BLOOM_THRESHOLD = /* wgsl */`
  c = select(min(c, vec3f(30000.0)), vec3f(0.0), c != c);
  c *= bloom.exposure;
  // soft knee over the threshold; very bright specks capped (no flicker from single pixels)
  let br = max(c.r, max(c.g, c.b));
  let knee = bloom.threshold * 0.5;
  let soft = clamp(br - bloom.threshold + knee, 0.0, 2.0 * knee);
  c *= max(soft * soft / (4.0 * knee + 1e-4), br - bloom.threshold) / max(br, 1e-4);
  c = min(c, vec3f(8.0));`;
const bloomDownCode = first => /* wgsl */`
fn tap(uv: vec2f) -> vec3f { return textureSampleLevel(src, smpLinearClamp, uv, 0.0).rgb; }
fn fragment(in: FSIn) -> vec4f {
  let t = 1.0 / vec2f(textureDimensions(src));
  let uv = in.uv;
  var c = tap(uv) * 0.125
    + (tap(uv + t * vec2f(-2.0, -2.0)) + tap(uv + t * vec2f(2.0, -2.0)) + tap(uv + t * vec2f(-2.0, 2.0)) + tap(uv + t * vec2f(2.0, 2.0))) * 0.03125
    + (tap(uv + t * vec2f(0.0, -2.0)) + tap(uv + t * vec2f(-2.0, 0.0)) + tap(uv + t * vec2f(2.0, 0.0)) + tap(uv + t * vec2f(0.0, 2.0))) * 0.0625
    + (tap(uv + t * vec2f(-1.0, -1.0)) + tap(uv + t * vec2f(1.0, -1.0)) + tap(uv + t * vec2f(-1.0, 1.0)) + tap(uv + t * vec2f(1.0, 1.0))) * 0.125;
  ${first ? BLOOM_THRESHOLD : ''}
  return vec4f(c, 1.0);
}`;
const bloomUpCode = /* wgsl */`
fn tap(uv: vec2f) -> vec3f { return textureSampleLevel(src, smpLinearClamp, uv, 0.0).rgb; }
fn fragment(in: FSIn) -> vec4f {
  let t = 1.0 / vec2f(textureDimensions(src));
  let uv = in.uv;
  let c = tap(uv) * 4.0
    + (tap(uv + vec2f(t.x, 0.0)) + tap(uv - vec2f(t.x, 0.0)) + tap(uv + vec2f(0.0, t.y)) + tap(uv - vec2f(0.0, t.y))) * 2.0
    + tap(uv + t) + tap(uv - t) + tap(uv + vec2f(t.x, -t.y)) + tap(uv + vec2f(-t.x, t.y));
  return vec4f(c / 16.0, 1.0);
}`;

// Look switches for side-by-side checks (?ao=0, ?tm=aces, ?bloom=0).
const lookParams = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const TONEMAP_NEUTRAL = lookParams.get('tm') !== 'aces';
const AO_ALLOWED = lookParams.get('ao') !== '0';
const BLOOM_ALLOWED = lookParams.get('bloom') !== '0';
const TAA_ALLOWED = lookParams.get('taa') !== '0';
// Temporal anti-aliasing. The native view has no MSAA: window grids, railings and far rooflines
// stepped and shimmered, and the soft shadows' sampling noise showed (it was written to be
// resolved over frames). Each frame is drawn a sub-pixel off (Halton 2,3) and blended into the
// history, reprojected by depth and last frame's camera; the history is held to the colour range
// of the pixel's neighbours (no trails behind cars and people) and read with Catmull-Rom (no blur).
const TaaUniforms = new UniformBlock('Taa', { valid: ['f32', 0], pad0: ['f32', 0], pad1: ['f32', 0], pad2: ['f32', 0] }, { label: 'complex taa' });
const TAA_CODE = /* wgsl */`
fn taaY(c: vec3f) -> vec3f { return vec3f(dot(c, vec3f(0.25, 0.5, 0.25)), dot(c, vec3f(0.5, 0.0, -0.5)), dot(c, vec3f(-0.25, 0.5, -0.25))); }
fn taaRgb(c: vec3f) -> vec3f { return vec3f(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
// (blended in a tone-mapped space: one bright highlight can't outweigh its neighbours)
fn taaTm(c: vec3f) -> vec3f { return c / (1.0 + max(c.r, max(c.g, c.b))); }
fn taaItm(c: vec3f) -> vec3f { return c / max(1e-4, 1.0 - max(c.r, max(c.g, c.b))); }
fn taaHistory(uv: vec2f) -> vec3f {
  let size = vec2f(textureDimensions(hist));
  let sp = uv * size; let t1 = floor(sp - 0.5) + 0.5; let f = sp - t1;
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f)); let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f)); let w3 = f * f * (-0.5 + 0.5 * f);
  let w12 = w1 + w2; let a = (t1 - 1.0) / size; let b = (t1 + w2 / w12) / size; let c = (t1 + 2.0) / size;
  var r = textureSampleLevel(hist, smpLinearClamp, vec2f(b.x, a.y), 0.0).rgb * (w12.x * w0.y);
  r += textureSampleLevel(hist, smpLinearClamp, vec2f(a.x, b.y), 0.0).rgb * (w0.x * w12.y);
  r += textureSampleLevel(hist, smpLinearClamp, b, 0.0).rgb * (w12.x * w12.y);
  r += textureSampleLevel(hist, smpLinearClamp, vec2f(c.x, b.y), 0.0).rgb * (w3.x * w12.y);
  r += textureSampleLevel(hist, smpLinearClamp, vec2f(b.x, c.y), 0.0).rgb * (w12.x * w3.y);
  let ws = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(r / ws, vec3f(0.0));
}
fn fragment(in: FSIn) -> vec4f {
  let size = vec2i(textureDimensions(src));
  let p = vec2i(in.pos.xy);
  let cur = textureLoad(src, p, 0).rgb;
  if (taa.valid < 0.5) { return vec4f(cur, 1.0); }
  // the neighbours' colour range (mean and spread)
  var m1 = vec3f(0.0); var m2 = vec3f(0.0);
  for (var dy = -1; dy <= 1; dy++) { for (var dx = -1; dx <= 1; dx++) {
    let q = taaY(taaTm(textureLoad(src, clamp(p + vec2i(dx, dy), vec2i(0), size - 1), 0).rgb));
    m1 += q; m2 += q * q;
  } }
  m1 /= 9.0; m2 /= 9.0;
  let sigma = sqrt(max(m2 - m1 * m1, vec3f(0.0)));
  // where this pixel was last frame
  let d = textureLoad(sceneDepth, p, 0).x;
  let ndc = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let wp = frame.invViewProj * vec4f(ndc, d, 1.0);
  let pc = frame.prevViewProjNoJitter * vec4f(wp.xyz / wp.w, 1.0);
  let puv = vec2f(pc.x / pc.w * 0.5 + 0.5, 0.5 - pc.y / pc.w * 0.5);
  if (pc.w <= 0.0 || any(puv < vec2f(0.0)) || any(puv > vec2f(1.0))) { return vec4f(cur, 1.0); }
  let h = clamp(taaY(taaTm(taaHistory(puv))), m1 - sigma * 1.25, m1 + sigma * 1.25);
  // (more of the new frame while the view moves fast: less to reproject wrongly)
  let moved = length((puv - in.uv) * vec2f(size));
  let k = mix(0.1, 0.3, clamp(moved / 6.0, 0.0, 1.0));
  return vec4f(taaItm(taaRgb(mix(h, taaY(taaTm(cur)), k))), 1.0);
}`;
// The surroundings in the reflections: what glass, car paint and wet paving reflect was the sky
// alone; a city's windows show the towers across from them. The scene is captured once into a
// cube around the complex (one face a frame, again when the light, the weather or the scene
// changes) and smooth surfaces reflect it, the ray carried out to a sphere round the complex
// so a tower far from the centre sees its own side of the street. Rough surfaces keep the sky.
const ENV_ALLOWED = lookParams.get('envmap') !== '0';
// Windows set into the wall: the glass and its frames sit 14 cm behind the facade, so seen at an
// angle the opening's side and head show (in the wall's paint, shaded) and the glass shifts
// within it. Drawn in the facade's own shader — no geometry is added — on the painted window grid
// of facadeSteps (openings 6–94 % across a bay, 10–84 % down a storey; every fourth bay the
// pilaster); near views only, fading out from 40 m to 140 m.
const RECESS_ALLOWED = lookParams.get('recess') !== '0';
const RECESS_WGSL = /* wgsl */`
{
  let uvT0 = in.uv * mat.uvemissiveMap.xy + mat.uvemissiveMap.zw;
  let cu = uvT0 * mat.room.xy; let cl = floor(cu); let f0 = fract(cu);
  let N0 = normalize(in.N);
  let a0 = dpdx(in.P); let a1 = dpdy(in.P); let b0 = dpdx(uvT0); let b1 = dpdy(uvT0);
  let a1p = cross(a1, N0); let a0p = cross(N0, a0);
  let T0 = normalize(a1p * b0.x + a0p * b1.x + vec3f(1e-7)); let B0 = normalize(a1p * b0.y + a0p * b1.y + vec3f(1e-7));
  let dv = normalize(in.P - frame.cameraPos);
  let r3 = vec3f(dot(dv, T0), dot(dv, B0), max(-dot(dv, N0), 0.05));
  let cellM = mat.room.zw;
  let depthM = 0.14 * (1.0 - smoothstep(40.0, 140.0, length(in.P - frame.cameraPos)));
  let lo = vec2f(0.06, 0.10) * cellM; let hi = vec2f(0.94, 0.84) * cellM;
  let p0 = f0 * cellM;
  let bay = ((i32(cl.x) % 4) + 4) % 4;
  if (depthM > 0.002 && bay != 3 && all(p0 > lo) && all(p0 < hi)) {
    let q = p0 + r3.xy * (depthM / r3.z);
    if (all(q > lo) && all(q < hi)) { puv = in.uv + (q - p0) / cellM / (mat.room.xy * mat.uvemissiveMap.xy); }
    else {
      reveal = 1.0;
      // (the wall's own paint, from beside the opening in the same bay)
      revealUV = (((cl + vec2f(0.03, 0.47)) / mat.room.xy) - mat.uvemissiveMap.zw) / mat.uvemissiveMap.xy;
    }
  }
}
`;
const ENV_SIZE = 256;
const EnvUniforms = new UniformBlock('Env', { probe: ['vec4f', [0, 25, 0, 320]], on: ['f32', 0], fade: ['f32', 1], pad1: ['f32', 0], pad2: ['f32', 0] }, { label: 'complex env' });
let envView = null, envBlank = null;
const envTexture = () => envView?.env?.tex ?? (envBlank ??= new Texture({ width: 4, height: 4, dimension: 'cube', format: 'rgba16float', usage: ['sample', 'render'], label: 'complex env blank' }));
// (the capture before the current one: the reflections fade from it — env.fade — not jump)
const envPrevTexture = () => envView?.env?.back ?? envTexture();
// Cube faces +x, -x, +y, -y, +z, -z: where each looks and its up. A WebGPU cube's faces are laid
// out left-handed against the scene's right-handed camera, so no turn of the camera matches them;
// each face is drawn of the scene mirrored in z (look and up below, mirrored) and read with z
// mirrored back (envDir), the two mirrors cancelling.
const ENV_FACES = [[1, 0, 0, 0, 1, 0], [-1, 0, 0, 0, 1, 0], [0, 1, 0, 0, 0, 1], [0, -1, 0, 0, 0, -1], [0, 0, -1, 0, 1, 0], [0, 0, 1, 0, 1, 0]];
const HALTON = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
const INTERIOR_ALLOWED = lookParams.get('int') !== '0';
const DETAIL_ALLOWED = lookParams.get('detail') !== '0';

// Interior mapping (van Dongen 2008; the windows of Marvel's Spider-Man, Cities: Skylines
// II): behind each pane of clear glass a room — back wall, side walls, floor and ceiling —
// found by casting the view ray into a box one bay wide, one storey high and a room deep.
// No textures: per-room colours and furniture from a hash of the window's cell. By day it
// is lit through the window (bright near the glass, dim at the back); a lit window at
// night (the lit-window colour) is a room under its ceiling lamp. The glass itself turns
// clear, reflecting like double glazing. Painted cells: 8 bays by 8 storeys a texture
// tile (facadeSteps), the storey's floor at the top of its slab band.
const INTERIOR_WGSL = /* wgsl */`
  let uvT = in.uv * REPEAT + OFFSET;
  let cellUV = uvT * GRID;
  let cell = floor(cellUV);
  let fc = fract(cellUV);
  let Ng = normalize(in.N);
  let iq0 = dpdx(in.P); let iq1 = dpdy(in.P); let ist0 = dpdx(uvT); let ist1 = dpdy(uvT);
  let iq1p = cross(iq1, Ng); let iq0p = cross(Ng, iq0);
  let Tn = normalize(iq1p * ist0.x + iq0p * ist1.x + vec3f(1e-7));
  let Bn = normalize(iq1p * ist0.y + iq0p * ist1.y + vec3f(1e-7));
  let dW = normalize(in.P - frame.cameraPos);
  let rd = vec3f(dot(dW, Tn), dot(dW, Bn), max(-dot(dW, Ng), 0.04));
  let rh = vec3f(skyHash(cell), skyHash(cell + 17.3), skyHash(cell + 41.9));
  // (the cell's v runs down the wall: its ceiling at CEIL, its floor at FLOOR of the storey)
  let RW = BAYW; let RH = STOREY; let RC = STOREY * CEIL; let RF = STOREY * FLOOR; let RD = 3.6 + 2.2 * rh.z;
  let rp = vec3f(fc.x * RW, fc.y * RH, 0.0);
  let rdx = select(min(rd.x, -1e-4), max(rd.x, 1e-4), rd.x >= 0.0);
  let rdy = select(min(rd.y, -1e-4), max(rd.y, 1e-4), rd.y >= 0.0);
  let tx = (select(0.0, RW, rd.x >= 0.0) - rp.x) / rdx;
  let ty = (select(RC, RF, rd.y >= 0.0) - rp.y) / rdy;
  let tz = RD / rd.z;
  let th = min(tx, min(ty, tz));
  let hp = rp + rd * th;
  let wallC = mix(vec3f(0.78, 0.74, 0.67), vec3f(0.9, 0.89, 0.86), rh.x);
  let floorC = mix(vec3f(0.34, 0.24, 0.15), vec3f(0.64, 0.57, 0.47), rh.y);
  var col = wallC * 0.95; var lamp = 0.5;
  if (th == tz) {
    col = wallC * 0.9;
    // along the back wall: a sofa or cabinet, now and then a picture above it
    if (hp.y > RF - 0.85 && abs(hp.x - RW * 0.5) < RW * (0.25 + 0.2 * rh.y)) { col = mix(vec3f(0.2, 0.18, 0.17), vec3f(0.58, 0.52, 0.45), rh.x); }
    else if (rh.y > 0.55 && abs(hp.y - (RF - 1.75)) < 0.3 && abs(hp.x - RW * 0.5) < 0.45) { col = mix(vec3f(0.25, 0.3, 0.36), vec3f(0.62, 0.45, 0.32), rh.z); }
  } else if (th == ty) {
    if (rd.y >= 0.0) { col = floorC; lamp = 0.3; }
    else { col = vec3f(0.9); lamp = 1.0 - 0.7 * min(length(vec2f(hp.x - RW * 0.5, hp.z - RD * 0.5)) / RD, 1.0); }
  }
  let deep = sat(hp.z / RD);
  // (a room by day is several times darker than the sunlit wall outside it)
  let dayIn = (frame.skyIrradiance * PI * 0.3 + frame.sunColor * max(frame.sunDir.y, 0.0) * 0.035) * mix(0.85, 0.12, deep);
  var room = col * dayIn * INV_PI * 1.15 + s.emissive * col * (0.5 + 1.15 * lamp);
  // A window a few pixels across: the room's average (single cells would flicker).
  let avg = wallC * (dayIn * INV_PI * 0.7 + s.emissive * 0.95);
  room = mix(room, avg, smoothstep(0.12, 0.45, max(fwidth(cellUV).x, fwidth(cellUV).y)));
  s.emissive = mix(s.emissive, room, roomOpen);
  s.albedo = mix(s.albedo, vec3f(0.012, 0.014, 0.016), roomOpen);
  s.metalness = mix(s.metalness, 0.0, roomOpen);
  s.roughness = mix(s.roughness, 0.05, roomOpen);
  s.specularIntensity = mix(s.specularIntensity, 3.3, roomOpen);`;

// Surface detail in world space, from noise alone (no textures to load): what a painted
// canvas cannot hold up close, faded out by the pixel's footprint so nothing shimmers far
// away. Each reads the albedo already sampled (s.albedo, linear).
//
// Ground: the painted land use tells the surface — grass (clumps, dry patches, blades),
// asphalt (aggregate grain, worn tone), light paving (20 x 10 cm blocks in running bond,
// joints and per-block tone, as on apartment-complex walks).
const GROUND_DETAIL = /* wgsl */`{
  let a = s.albedo; let lum = luminance(a);
  let hi = max(a.r, max(a.g, a.b)); let chroma = (hi - min(a.r, min(a.g, a.b))) / max(hi, 1e-4);
  let xz = in.P.xz;
  let px = max(length(fwidth(xz)), 1e-4);
  let fine = 1.0 - smoothstep(0.02, 0.09, px);
  let mid = 1.0 - smoothstep(0.15, 0.7, px);
  let broad = skyNoise(xz * 0.07) * 0.6 + skyNoise(xz * 0.23 + 3.7) * 0.4;
  let grain = skyNoise(xz * 3.1) * 0.5 + skyNoise(xz * 7.3 + 1.3) * 0.5;
  let grass = smoothstep(0.015, 0.06, a.g - max(a.r, a.b));
  let tar = (1.0 - grass) * (1.0 - smoothstep(0.05, 0.13, lum)) * (1.0 - smoothstep(0.15, 0.35, chroma));
  let pave = (1.0 - grass) * smoothstep(0.13, 0.28, lum) * (1.0 - smoothstep(0.2, 0.4, chroma));
  var alb = a;
  // grass
  // (lawns read olive rather than paint-green; clumps and worn patches break them up)
  alb = mix(alb, vec3f(luminance(alb)) * vec3f(0.95, 1.12, 0.62) + alb * 0.25, grass * 0.45);
  let clump = mix(0.7, 1.15, broad) * mix(1.0, mix(0.74, 1.2, grain), fine);
  let dry = smoothstep(0.55, 0.8, skyNoise(xz * 0.045 + 9.1));
  alb *= mix(1.0, clump, grass);
  alb = mix(alb, alb * vec3f(1.35, 1.1, 0.7), dry * grass * 0.7 * mid);
  // (asphalt is a neutral dark grey, never the blue the painted plan and the sky tint give it)
  alb = mix(alb, vec3f(luminance(alb)) * vec3f(1.02, 1.0, 0.97), tar * 0.7);
  // asphalt: coarse aggregate, worn and patched (repairs a few metres across), the odd stain
  let agg = mix(0.72, 1.25, skyHash(floor(xz * 45.0)));
  let repair = smoothstep(0.68, 0.72, skyNoise(floor(xz * 0.4) * 0.37 + 11.0)) * 0.14;
  let stain = smoothstep(0.7, 0.9, skyNoise(xz * 0.9 + 4.2)) * 0.18;
  alb *= mix(1.0, mix(0.84, 1.1, broad) * (1.0 - repair - stain * mid) * mix(1.0, agg, fine * 0.7), tar);
  // (stone chips catch the sun: a jittered normal per few centimetres, only up close)
  let chip = vec2f(skyHash(floor(xz * 30.0) + 1.7), skyHash(floor(xz * 30.0) + 8.3)) - 0.5;
  s.normal = normalize(s.normal + vec3f(chip.x, 0.0, chip.y) * 0.22 * fine * (tar + pave * 0.5));
  // paving blocks
  let bw = vec2f(0.2, 0.1);
  var q = xz / bw; q.x += 0.5 * step(0.5, fract(q.y * 0.5));
  let cellB = floor(q); let fb = fract(q);
  let joint = min(min(fb.x, 1.0 - fb.x) * bw.x, min(fb.y, 1.0 - fb.y) * bw.y);
  let jointK = 1.0 - smoothstep(0.004, 0.011, joint);
  let fineP = 1.0 - smoothstep(0.012, 0.045, px);
  alb *= mix(1.0, mix(0.93, 1.04, broad) * mix(1.0, mix(0.9, 1.08, skyHash(cellB + 3.1)) * (1.0 - 0.32 * jointK), fineP), pave * mid);
  s.albedo = alb;
  s.roughness = s.roughness * mix(1.0, mix(0.86, 1.08, grain), fine);
}`;
// Flat roofs: urethane waterproofing in patches of wear and repair, the seams of its runs.
const ROOF_DETAIL = /* wgsl */`{
  let xz = in.P.xz;
  let px = max(length(fwidth(xz)), 1e-4);
  let m = skyNoise(xz * 0.18) * 0.6 + skyNoise(xz * 0.61 + 2.0) * 0.4;
  let d = (0.5 - abs(fract(xz / 4.5) - 0.5)) * 4.5;
  let seam = (1.0 - smoothstep(0.02, 0.06, min(d.x, d.y))) * (1.0 - smoothstep(0.04, 0.2, px));
  s.albedo *= mix(0.8, 1.1, m) * (1.0 - 0.2 * seam);
  s.roughness *= mix(0.82, 1.05, m);
}`;
// Walls: faint rain streaks run down from the slabs and sills, and the paint's tone drifts
// across a block (no two panels quite the same) — the clean CG sheen goes.
const WALL_WEATHER = /* wgsl */`if (abs(in.N.y) < 0.5) {
  let along = dot(in.P.xz, normalize(vec2f(-in.N.z, in.N.x) + vec2f(1e-5, 0.0)));
  let px = max(length(fwidth(in.P)), 1e-4);
  let streak = smoothstep(0.55, 0.9, skyNoise(vec2f(along * 1.7, in.P.y * 0.07))) * (1.0 - smoothstep(0.3, 1.5, px));
  let drift = mix(0.95, 1.03, skyNoise(vec2f(along * 0.035, in.P.y * 0.02) + 5.3));
  s.albedo *= drift * (1.0 - 0.09 * streak);
}`;
// Photographic detail over a painted surface: the scan's grain and relief projected in world
// space (walls by their run and height, tops from above) at its real size, strongest up
// close and gone by the time a texel would shimmer; a second, broad tap of the same scan
// gives the blotchy unevenness of real render and stone from further off. Glass and metal
// (the glazing and frames painted into the same texture) are left alone.
const DETAIL_WGSL = (metres, albedo, relief, avgRough) => /* wgsl */`{
  let dN = normalize(in.N);
  let dTop = abs(dN.y) > 0.7;
  let dRun = normalize(vec3f(-dN.z, 0.0, dN.x) + vec3f(1e-5, 0.0, 0.0));
  let dUV = select(vec2f(dot(in.P, dRun), in.P.y), in.P.xz, dTop) / ${metres.toFixed(3)};
  let dT = select(dRun, vec3f(1.0, 0.0, 0.0), dTop);
  let dB = select(vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0), dTop);
  let dFine = textureSample(detailMap, smpAnisoRepeat, dUV);
  let dBroad = textureSample(detailMap, smpAnisoRepeat, dUV * 0.21 + vec2f(0.37, 0.61));
  let dPx = max(length(fwidth(in.P)), 1e-4);
  let dNear = (1.0 - smoothstep(0.012, 0.07, dPx)) * (1.0 - smoothstep(0.3, 0.5, s.metalness));
  let dMid = (1.0 - smoothstep(0.15, 0.6, dPx)) * (1.0 - smoothstep(0.3, 0.5, s.metalness));
  s.albedo *= mix(1.0, dFine.r * 2.0, dNear * ${albedo.toFixed(2)}) * mix(1.0, dBroad.r * 2.0, dMid * ${(albedo * 0.7).toFixed(2)});
  let dn = dFine.gb * 2.0 - 1.0;
  s.normal = normalize(s.normal + (dT * dn.x + dB * dn.y) * dNear * ${relief.toFixed(2)});
  s.roughness = mix(s.roughness, s.roughness * clamp(dFine.a / ${avgRough.toFixed(3)}, 0.6, 1.4), dNear * 0.6);
}`;
// The modelled cars (gen-cars.py): each part from its uv slot. Only the body takes the
// instance's paint (a clear-coated finish); rims and trim chrome are metal, lamps glass.
const CAR_MODEL = /* wgsl */`{
  let part = i32(floor(in.uv.x * 16.0));
  var paint = vec3f(0.8);
#if INSTANCE_COLOR
  paint = clamp((in.color.rgb - 0.3) / 0.7, vec3f(0.0), vec3f(1.0));
#endif
  s.clearcoat = 0.0; s.metalness = 0.0; s.roughness = 0.6; s.emissive = vec3f(0.0);
  switch part {
    case 0: { s.albedo = paint * 0.92; s.clearcoat = 1.0; s.clearcoatRoughness = 0.12; s.roughness = 0.32; s.metalness = 0.35; }
    case 1: { s.albedo = vec3f(0.012, 0.015, 0.02); s.roughness = 0.12; s.specularIntensity = 3.0; }
    case 2: { s.albedo = vec3f(0.03); s.roughness = 0.55; }
    case 3: { s.albedo = vec3f(0.6, 0.61, 0.63); s.metalness = 1.0; s.roughness = 0.3; }
    case 4: { s.albedo = vec3f(0.78, 0.79, 0.8); s.metalness = 1.0; s.roughness = 0.16; }
    case 5: { s.albedo = vec3f(0.85, 0.85, 0.82); s.roughness = 0.12; s.specularIntensity = 2.0; }
    case 6: { s.albedo = vec3f(0.42, 0.02, 0.02); s.roughness = 0.14; s.specularIntensity = 2.0; }
    case 7: { s.albedo = vec3f(0.78, 0.78, 0.75); s.roughness = 0.45; }
    case 8: { s.albedo = vec3f(0.95, 0.6, 0.1); s.roughness = 0.4; }
    case 10: { s.albedo = vec3f(0.66, 0.68, 0.7); s.metalness = 0.6; s.roughness = 0.38; }
    case 11: { s.albedo = vec3f(0.86, 0.86, 0.84); s.clearcoat = 1.0; s.clearcoatRoughness = 0.15; s.roughness = 0.35; s.metalness = 0.2; }
    default: { s.albedo = vec3f(0.018); s.roughness = 0.9; }
  }
}`;

// How strongly each scan shows (albedo grain, relief).
const DETAIL_LOOK = { paint: [0.55, 0.45], granite: [0.6, 0.35], concrete: [0.6, 0.5], roof: [0.55, 0.45] };

// Kenney's cars carry flat colour swatches: the body becomes clear-coated paint (a sharp
// sky reflection over the colour — what makes a car read as one), the windows dark
// reflective glass, tyres and trim matte.
const CAR_PAINT = /* wgsl */`{
  let t = carTex; let tl = luminance(t);
  let glass = smoothstep(0.08, 0.16, t.b - t.r) * smoothstep(0.45, 0.65, tl);
  let dark = 1.0 - smoothstep(0.02, 0.07, tl);
  let body = (1.0 - glass) * (1.0 - dark);
#if INSTANCE_COLOR
  // The repaint was made for multiplying over the swatch (lerped 30 % toward white): here the
  // body takes the paint itself — white, silver, black as on Korean roads, not a red-tinted
  // version of each over the kit's red body.
  let paint = clamp((in.color.rgb - 0.3) / 0.7, vec3f(0.0), vec3f(1.0));
  s.albedo = mix(s.albedo, paint * mat.color * 0.92, body);
#endif
  s.clearcoat = body; s.clearcoatRoughness = 0.12;
  s.roughness = mix(mix(s.roughness, 0.85, dark), 0.3, body);
  s.metalness = mix(s.metalness * (1.0 - dark), 0.3, body);
  s.albedo = mix(s.albedo, vec3f(0.01, 0.012, 0.015), glass);
  s.roughness = mix(s.roughness, 0.12, glass);
  s.metalness = mix(s.metalness, 0.0, glass);
  s.specularIntensity = mix(s.specularIntensity, 3.0, glass);
}`;

/** The device, ahead of the first view (ComplexHologram.warmGpu). */
export function warmDevice() { return device().catch(() => {}); }
async function warmCopies() {
  try {
    const c = new OffscreenCanvas(4, 4); c.getContext('2d', { willReadFrequently: true }).fillRect(0, 0, 4, 4);
    const bmp = await createImageBitmap(c);
    for (const format of ['rgba8unorm-srgb', 'rgba8unorm']) for (const flipY of [false, true]) {
      const t = GPU.device.createTexture({ size: [4, 4], format, usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
      GPU.queue.copyExternalImageToTexture({ source: bmp, flipY }, { texture: t }, [4, 4]);
      GPU.onSubmit(null, () => t.destroy());
    }
    bmp.close();
  } catch { /* (only a warm-up) */ }
}

const isMoving = mesh => mesh.moving === true;
const NO_STRIPS = typeof location !== 'undefined' && new URLSearchParams(location.search).get('strips') === '0';
// (twin of scenePlants' WebGL fade)
const FOLIAGE_FADE = '0.14, 0.46, face';
const FOLIAGE_STEEP = '0.5, 0.78, abs(v.y)';
function sameMatrix(a, b) {
  const x = a.elements, y = b.elements;
  for (let i = 0; i < 16; i++) if (x[i] !== y[i]) return false;
  return true;
}

export class ComplexRenderer {
  static async create(host, quality = QUALITY.high) {
    await device();
    // (the surface detail with the first view, if it comes within a moment: never held up for it)
    await Promise.race([detailLoad, new Promise(r => setTimeout(r, 1500))]);
    // a software adapter (no usable GPU): the lightest setting from the start
    if (GPU.adapter.info?.isFallbackAdapter || GPU.adapter.isFallbackAdapter) quality = QUALITY.low;
    return new ComplexRenderer(host, quality);
  }
  constructor(host, quality = QUALITY.high) {
    this.quality = quality;
    useShadows(quality);
    this.canvas = document.createElement('canvas');
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.visibility = 'hidden';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.context = this.canvas.getContext('webgpu');
    if (!this.context) throw new Error('WebGPU canvas unavailable');
    this.context.configure({ device: GPU.device, format: GPU.format, alphaMode: 'opaque' });
    host.appendChild(this.canvas);
    this.scene = new Scene();
    // (the scene itself never moves: its meshes' world matrices are worked out only when sync()
    // gives them a new one — not every mesh in every pass, as an auto-updating root forced)
    this.scene.matrixAutoUpdate = false;
    this.camera = new PerspectiveCamera();
    this.renderer = new MeshRenderer();
    // A new complex's pipelines spread over frames (see MeshRenderer._pipeline).
    // (3 a frame, 5 ms apart: at 12 ms apart a new complex's ~35 pipelines came one a frame at
    // the loading view's half rate, and held its first picture back most of a second)
    this.renderer.pipelinesPerFrame = 3;
    this.renderer.pipelineGapMs = 5;
    this.renderer.syncPipelines = false;
    // Unchanged runs of draws replayed as render bundles (MeshRenderer.drawItems); ?bundles=0 draws
    // every one directly, for comparison.
    this.renderer.bundles = typeof location === 'undefined' || new URLSearchParams(location.search).get('bundles') !== '0';
    this.target = new RenderTarget(1, 1, { colors: ['rgba16float'], depth: 'depth32float', label: 'complex HDR' });
    // What the water sees through and reflects: the opaque scene, copied before the water
    // pass (Tidewater's sceneCopy). Allocated once water is in the scene.
    this.copy = null;
    this.sky = new FullscreenPass({ label: 'complex atmosphere', modules: [atmosphere], code: skyCode, colorFormats: ['rgba16float'], depthFormat: 'depth32float', depthCompare: 'equal' });
    // (?envdebug=1: the captured surroundings as the background, to check the cube's faces)
    if (lookParams.get('envdebug')) this.sky = new FullscreenPass({ label: 'complex env debug', modules: [atmosphere], colorFormats: ['rgba16float'], depthFormat: 'depth32float', depthCompare: 'always',
      bindings: { envCube: { texture: envTexture, viewDimension: 'cube' } }, code: `
      fn fragment(in: FSIn) -> vec4f {
        let p = frame.invProj * vec4f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0, 0.001, 1.0);
        let ray = normalize((frame.invView * vec4f(normalize(p.xyz / p.w), 0.0)).xyz);
        let s = textureSampleLevel(envCube, smpLinearClamp, ray * vec3f(1.0, 1.0, -1.0), 0.0);
        return vec4f(mix(vec3f(1.0, 0.0, 1.0), s.rgb, s.a), 1.0);
      }` });
    // Ambient occlusion (not on the low setting): half-size, blurred across then down.
    this.aoOn = AO_ALLOWED && quality.name !== 'low';
    const depthBinding = { texture: () => this.target.depthTexture, sampleType: 'unfilterable-float' };
    if (this.aoOn) {
      // (occlusion, and the view depth it was taken at: the finish tells the plants in front)
      this.ao = new RenderTarget(1, 1, { colors: ['rg16float'], label: 'complex ao', usage: ['sample', 'render'] });
      this.aoTmp = new RenderTarget(1, 1, { colors: ['rg16float'], label: 'complex ao blur', usage: ['sample', 'render'] });
    }
    this.depthBinding = depthBinding;
    // Bloom (not on the low setting): half, quarter … 1/32 size levels.
    this.bloomOn = BLOOM_ALLOWED && quality.name !== 'low';
    if (this.bloomOn) {
      this.bloomRT = [];
      for (let i = 0; i < BLOOM_LEVELS; i++) this.bloomRT.push(new RenderTarget(1, 1, { colors: ['rgba16float'], label: 'complex bloom ' + i, usage: ['sample', 'render', ...(import.meta.env.DEV && lookParams.get('probe') ? ['copySrc'] : [])] }));
    }
    // (TAA: two history images, written in turn; what the bloom and the finish read)
    this.taaOn = TAA_ALLOWED;
    if (this.taaOn) {
      this.taaHist = [0, 1].map(i => new RenderTarget(1, 1, { colors: ['rgba16float'], label: 'complex taa ' + i, usage: ['sample', 'render'] }));
      this.taaIdx = 0;
      this.taaPass = new FullscreenPass({ label: 'complex taa', code: TAA_CODE, colorFormats: ['rgba16float'],
        bindings: { src: { texture: () => this.target.texture }, hist: { texture: () => this.taaHist[this.taaIdx ^ 1].texture }, sceneDepth: depthBinding, taa: { uniform: TaaUniforms } } });
    }
    this.resolved = () => (this.taaNow ? this.taaHist[this.taaIdx] : this.target);
    if (ENV_ALLOWED) this.env = {
      // (two cubes: the faces of a new capture go into the back one, one face every few frames,
      // and the two swap once all six are in. With one cube the reflections changed face by
      // face as a capture went on — the windows flickered whenever the sun or the scene moved on)
      tex: new Texture({ width: ENV_SIZE, height: ENV_SIZE, dimension: 'cube', format: 'rgba16float', usage: ['sample', 'copyDst'], label: 'complex env' }),
      back: new Texture({ width: ENV_SIZE, height: ENV_SIZE, dimension: 'cube', format: 'rgba16float', usage: ['sample', 'copyDst'], label: 'complex env back' }),
      faceRT: new RenderTarget(ENV_SIZE, ENV_SIZE, { colors: ['rgba16float'], label: 'complex env face', usage: ['render', 'copySrc'] }),
      depth: new RenderTarget(ENV_SIZE, ENV_SIZE, { colors: [], depth: 'depth32float', label: 'complex env depth' }),
      block: createViewUniforms('complex env view'), cam: new PerspectiveCamera(90, 1, 0.5, 4000),
      face: -1, dirtyAt: performance.now(), key: '', meshes: 0, on: false,
    };
    this.finish = new FullscreenPass({ label: 'complex filmic resolve', modules: [new ShaderModule({ name: 'complex precipitation', code: PRECIP_WGSL })], code: finishCode, colorFormats: [GPU.format],
      defines: { AO: this.aoOn ? 1 : 0, AO_SHOW: lookParams.get('ao') === 'show' ? 1 : 0, TONEMAP_NEUTRAL: TONEMAP_NEUTRAL ? 1 : 0, BLOOM: this.bloomOn ? 1 : 0 },
      bindings: { src: { texture: () => this.resolved().texture }, sceneDepth: depthBinding, ...(this.aoOn ? { aoTex: { texture: () => this.ao.texture } } : {}),
        ...(this.bloomOn ? { bloomTex: { texture: () => this.bloomRT[0].texture }, bloom: { uniform: BloomUniforms } } : {}) } });
    this.meshes = new Map();
    this.materials = new Map();
    this.textures = new Map();
    this.ready = false;
    // After the first complete frame the view never blanks again: meshes added later
    // (plants, traffic, the next complex) appear once their pipelines are built.
    this.shown = false;
    this.failed = false;
    this.disposed = false;
    this.compiling = false;
    this.stats = this.renderer.stats;
    /** GPU ms per pass (timer.ms.total: the frame), where timestamps exist. */
    this.timer = new GpuTimer();
  }
  /** The AO and bloom passes, made once the first frame is up: their twelve pipelines
   * compiled alongside the scene's held the first frame back by a quarter second. Until
   * they are ready the frame goes without (a white occlusion, no bloom). */
  makePost() {
    if (this.postMade) return;
    this.postMade = true;
    const depthBinding = this.depthBinding;
    if (this.aoOn) {
      this.aoPass = new FullscreenPass({ label: 'complex ao', code: AO_CODE, colorFormats: ['rg16float'], bindings: { sceneDepth: depthBinding } });
      this.aoBlurX = new FullscreenPass({ label: 'complex ao blur x', code: aoBlurCode(0), colorFormats: ['rg16float'],
        bindings: { aoSrc: { texture: () => this.ao.texture, sampleType: 'unfilterable-float' }, sceneDepth: depthBinding } });
      this.aoBlurY = new FullscreenPass({ label: 'complex ao blur y', code: aoBlurCode(1), colorFormats: ['rg16float'],
        bindings: { aoSrc: { texture: () => this.aoTmp.texture, sampleType: 'unfilterable-float' }, sceneDepth: depthBinding } });
    }
    if (this.bloomOn) {
      const u = { bloom: { uniform: BloomUniforms } };
      this.bloomDown = this.bloomRT.map((_, i) => new FullscreenPass({ label: 'complex bloom down ' + i, code: bloomDownCode(i === 0), colorFormats: ['rgba16float'],
        bindings: { src: { texture: () => (i === 0 ? this.resolved() : this.bloomRT[i - 1]).texture }, ...(i === 0 ? u : {}) } }));
      this.bloomUp = this.bloomRT.slice(1).map((_, i) => new FullscreenPass({ label: 'complex bloom up ' + i, code: bloomUpCode, colorFormats: ['rgba16float'], blend: 'add',
        bindings: { src: { texture: () => this.bloomRT[i + 1].texture } } }));
    }
  }
  /** Development (?probe=1): the smallest bloom level read back each frame; a non-finite or
   * absurd value there is a pixel that would flash the whole frame (window.__hdrBad). */
  probeBloom() {
    if (this.probing) return;
    const rt = this.bloomRT[BLOOM_LEVELS - 1], w = rt.width, h = rt.height, row = Math.ceil(w * 8 / 256) * 256;
    const buf = GPU.device.createBuffer({ size: row * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    GPU.getEncoder().copyTextureToBuffer({ texture: rt.texture.getGPU() }, { buffer: buf, bytesPerRow: row }, [w, h]);
    this.probing = true;
    setTimeout(() => buf.mapAsync(GPUMapMode.READ).then(() => {
      const u = new Uint16Array(buf.getMappedRange());
      let bad = 0, max = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w * 4; x++) {
        const v = u[y * row / 2 + x], e = (v >> 10) & 31;
        if (e === 31) bad++; else max = Math.max(max, e);
      }
      buf.unmap(); buf.destroy(); this.probing = false;
      const g = window; g.__hdrFrames = (g.__hdrFrames ?? 0) + 1;
      if (bad) { g.__hdrBad = (g.__hdrBad ?? 0) + 1; console.warn('[3D probe] non-finite bloom', bad, performance.now().toFixed(0)); }
      g.__hdrMaxExp = Math.max(g.__hdrMaxExp ?? 0, max);
    }).catch(() => { this.probing = false; }), 0);
  }
  setSize(w, h, ratio) {
    const limit = GPU.device.limits.maxTextureDimension2D;
    const width = Math.min(limit, Math.max(1, Math.round(w * ratio)));
    const height = Math.min(limit, Math.max(1, Math.round(h * ratio)));
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.target.setSize(this.canvas.width, this.canvas.height);
    this.copy?.setSize(this.canvas.width, this.canvas.height);
    this.taaHist?.forEach(rt => rt.setSize(this.canvas.width, this.canvas.height));
    this.taaValid = false;
    const hw = Math.max(1, Math.ceil(width / 2)), hh = Math.max(1, Math.ceil(height / 2));
    this.ao?.setSize(hw, hh); this.aoTmp?.setSize(hw, hh);
    this.bloomRT?.forEach((rt, i) => rt.setSize(Math.max(1, width >> (i + 1)), Math.max(1, height >> (i + 1))));
  }
  /** Lower (or raise) the quality: shadow resolution and the water's reflection. */
  setQuality(quality) {
    if (this.quality === quality) return;
    this.quality = quality;
    useShadows(quality);
    // The water's defines change: a new material; its mesh is re-created on the next sync.
    for (const [src, mat] of this.materials) if (src.userData.water) { mat.dispose(); mat.uniformBlock.buffer?.destroy(); this.materials.delete(src); }
    for (const [obj, mesh] of this.meshes) if (obj.material?.userData?.water) { this.scene.remove(mesh); this.meshes.delete(obj); }
  }
  /** A large painted canvas goes up to the GPU in strips of rows, a few a frame (its pixels
   * read with getImageData — the canvases are drawn by the CPU — and written in): copied at
   * once, a 2048 px canvas held the main thread ~40 ms in the frame that needed it. Returns
   * the filled rgba8unorm texture (with mips to make) once the last strip is in, else null. */
  staged(source) {
    const img = source.image, w = img.width, h = img.height;
    this.stagings ??= new Map();
    let st = this.stagings.get(source);
    if (st && st.version !== source.version) { st.tex.destroy(); st = null; }   // (repainted meanwhile: again)
    if (!st) {
      st = { tex: new Texture({ label: 'staged canvas', width: w, height: h, format: 'rgba8unorm', mips: true, usage: ['sample', 'render', 'copySrc', 'copyDst'] }), y: 0, version: source.version, at: this.frameNo };
      this.stagings.set(source, st);
    }
    if (st.y < h) {
      if (this.stageFrame !== this.frameNo) { this.stageFrame = this.frameNo; this.stageBudget = 0.6e6; }
      const ctx = img.getContext('2d', { willReadFrequently: true });
      if (!ctx) { this.stagings.delete(source); st.tex.destroy(); return null; }
      while (this.stageBudget > 0 && st.y < h) {
        const rows = Math.min(128, h - st.y), data = ctx.getImageData(0, st.y, w, rows).data;
        let buf = data, y = st.y;
        if (source.flipY) {
          // (the texture's rows bottom-up: the strip lands mirrored, its rows reversed)
          y = h - st.y - rows; buf = new Uint8Array(data.length);
          for (let r = 0; r < rows; r++) buf.set(data.subarray(r * w * 4, (r + 1) * w * 4), (rows - 1 - r) * w * 4);
        }
        GPU.queue.writeTexture({ texture: st.tex.getGPU(), origin: { x: 0, y } }, buf, { bytesPerRow: w * 4, rowsPerImage: rows }, { width: w, height: rows });
        st.y += rows; this.stageBudget -= w * rows;
      }
    }
    return st.y >= h ? st.tex : null;
  }
  /** The staged texture into `into` (BC7: encoded from it; else copied, mips made); it is
   * then freed. */
  fromStaged(source, st, into) {
    this.stagings.delete(source);
    if (into.format.startsWith('bc7')) { encodeBC7(null, { staged: st, into }); return; }
    GPU.getEncoder().copyTextureToTexture({ texture: st.getGPU() }, { texture: into.getGPU() }, [st.width, st.height, 1]);
    generateMipmaps(into);
    GPU.onSubmit(null, () => st.destroy());
  }
  /** Whether a canvas goes up in strips (see staged). */
  stripped(img) {
    if (NO_STRIPS || !(typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) || img.width * img.height < 512 * 512 || img.width % 4 || img.height % 4) return false;
    // (only a canvas drawn by the CPU: reading a GPU-drawn one back took ~50 ms a strip)
    if (img.__cpu === undefined) img.__cpu = !!img.getContext('2d')?.getContextAttributes?.().willReadFrequently;
    return img.__cpu;
  }
  /** A loaded picture (<img>) is decoded in the background before it is uploaded: copied
   * straight away, its decode ran on the main thread in the frame that needed it (~100 ms for
   * the plants' atlases). A large canvas goes up in strips (staged). Returns the image once
   * ready, else null. */
  snapshot(source, strips = true) {
    const img = source.image;
    if (img && this.stripped(img)) return !strips || this.staged(source) ? img : null;
    if (!(typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement)) return img;
    this.snaps ??= new Map();
    const s = this.snaps.get(source);
    if (s) return s.ready ? img : null;
    const entry = { version: source.version, ready: false };
    this.snaps.set(source, entry);
    const done = () => { entry.ready = true; };
    if (img.decode) img.decode().then(done, done); else done();
    return null;
  }
  /** Done with a picture's decode: forget it. */
  dropSnapshot(source) { this.snaps?.delete(source); }
  /** Whether the pictures a material reads are all decoded (see snapshot). */
  imagesReady(material) {
    let ready = true;
    for (const m of Array.isArray(material) ? material : [material]) {
      for (const t of [m.map, m.emissiveMap, m.userData?.farGround?.map]) {
        if (!t || this.textures.has(t) || t.userData?.compressed) continue;
        if (!this.snapshot(t)) ready = false;
      }
      // (normal and roughness maps are packed together from their canvases — packedSurface —
      // not uploaded in strips: only a picture among them waits for its decode)
      for (const t of [m.normalMap, m.roughnessMap, m.metalnessMap]) {
        if (!t || this.textures.has(t) || t.userData?.compressed) continue;
        if (!this.snapshot(t, false)) ready = false;
      }
    }
    return ready;
  }
  texture(source) {
    if (this.textures.has(source)) return this.textures.get(source);
    // Pre-compressed levels (the plant atlas as BC7): uploaded as they are, a quarter of the memory.
    const packed = source.userData?.compressed;
    if (packed && GPU.features.has(packed.format.startsWith('etc2') ? 'texture-compression-etc2' : 'texture-compression-bc')) {
      const tex = new Texture({ width: packed.width, height: packed.height, format: packed.format, mips: packed.levels.length, usage: ['sample', 'copyDst'] });
      packed.levels.forEach(({ w, h, data }, level) => {
        const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4);
        GPU.queue.writeTexture({ texture: tex.getGPU(), mipLevel: level }, data, { bytesPerRow: bw * 16, rowsPerImage: bh }, { width: bw * 4, height: bh * 4 });
      });
      tex.sourceVersion = source.version;
      this.textures.set(source, tex);
      return tex;
    }
    const img = source.image;
    if (!img?.width || !img?.height) return null;
    const version = source.version;
    // (a large canvas: from its strips once all are up — a material made before then copies it)
    const st = this.stripped(img) && this.stagings?.get(source)?.version === version ? this.staged(source) : null;
    // (strips begun but not all up: dropped, the canvas copied as it is)
    if (!st && this.stagings?.has(source)) { this.stagings.get(source).tex.destroy(); this.stagings.delete(source); }
    // Painted colour maps (facades, glazing, lit windows, the ground's paint): BC7, made on
    // the GPU — a quarter of the memory, the same look (48–62 dB against the source).
    if (!img.data && source.colorSpace === 'srgb' && canEncodeBC7(img)) {
      const tex = st ? (this.stagings.delete(source), encodeBC7(null, { staged: st })) : encodeBC7(img, { flipY: source.flipY });
      tex.sourceVersion = version;
      this.textures.set(source, tex);
      this.dropSnapshot(source);
      this.release(source);
      return tex;
    }
    const tex = new Texture({ width: img.width, height: img.height, format: source.colorSpace === 'srgb' ? 'rgba8unorm-srgb' : 'rgba8unorm', mips: true, usage: ['sample', 'render', 'copyDst'] });
    if (st) this.fromStaged(source, st, tex);
    else {
      if (img.data) tex.upload(img.data);
      else GPU.queue.copyExternalImageToTexture({ source: img, flipY: source.flipY }, { texture: tex.getGPU() }, [img.width, img.height]);
      generateMipmaps(tex);
    }
    tex.sourceVersion = version;
    this.textures.set(source, tex);
    this.dropSnapshot(source);
    this.release(source);
    return tex;
  }
  /** Normal map + roughness (G) / metalness (B) map of the same size and placement as one
   * rgba8 texture (x, y, roughness, metalness): a quarter of a facade's texture memory. */
  packedSurface(source) {
    const n = source.normalMap, r = source.roughnessMap;
    if (!n || !r || (source.metalnessMap && source.metalnessMap !== r)) return null;
    if (this.textures.has(n)) return this.textures.get(n).packed ? this.textures.get(n) : null;
    const a = n.image, b = r.image;
    const same = (u, v) => u.x === v.x && u.y === v.y;
    if (!a?.width || !b?.width || a.width !== b.width || a.height !== b.height || n.flipY !== r.flipY
      || n.wrapS !== 1000 || r.wrapS !== 1000 || !same(n.repeat, r.repeat) || !same(n.offset, r.offset)) return null;
    const tex = new Texture({ width: a.width, height: a.height, format: 'rgba8unorm', mips: true, usage: ['sample', 'render'] });
    packInto(tex, [{ img: a, flipY: n.flipY }, { img: b, flipY: r.flipY }], 'vec4f(A.x, A.y, B.y, B.z)');
    tex.packed = true;
    tex.sourceVersion = n.version;
    this.textures.set(n, tex);
    this.release(n); this.release(r);
    return tex;
  }
  /** A roughness map (read from G) as a single-channel texture: a quarter of its memory. */
  singleChannel(source) {
    const known = this.textures.get(source);
    if (known) return known.channel ? known : null;
    const img = source.image;
    if (!img?.width || !img?.height || img.data) return null;
    const tex = new Texture({ width: img.width, height: img.height, format: 'r8unorm', mips: true, usage: ['sample', 'render'] });
    tex.repack = () => packInto(tex, [{ img: source.image, flipY: source.flipY }], 'vec4f(A.y, 0.0, 0.0, 1.0)');
    tex.repack();
    tex.channel = true;
    tex.sourceVersion = source.version;
    this.textures.set(source, tex);
    this.release(source);
    return tex;
  }
  /** A canvas painted for one complex and never repainted (userData.releaseAfterUpload):
   * once on the GPU, its pixels are held twice — the page's 2D canvas (GPU-backed in
   * Chrome) or bitmap, and this texture. Emptied here (~100 MB a complex). `released` counts
   * them: a later fall back to WebGL has to paint them again. */
  release(source) {
    const img = source.image;
    if (!source.userData?.releaseAfterUpload || source.userData.released || !img || img.data || !('width' in img)) return;
    // A canvas is emptied; a bitmap (painted in the worker) let go.
    if (typeof img.close === 'function') img.close(); else { img.width = 1; img.height = 1; }
    source.userData.released = true;
    this.released = (this.released ?? 0) + 1;
  }
  /** Canvas textures repainted in place (the ground once land use arrives): upload again. */
  refreshTextures() {
    // About one big canvas a frame: the ground repainted with land use and the facades with the
    // survey's colours come in the same moment, and each copy from a canvas holds the main thread
    // (~40–110 ms for 2048 px); together they made one long, visible stall. The rest wait a frame.
    let budget = 4.5e6;
    for (const [source, tex] of this.textures) {
      if (tex.sourceVersion === source.version) continue;
      if (budget <= 0) break;
      const raw = source.image;
      if (!raw?.width || raw.data || raw.width !== tex.width || raw.height !== tex.height || tex.packed) { tex.sourceVersion = source.version; continue; }
      if (tex.repack) { tex.sourceVersion = source.version; tex.repack(); this.release(source); continue; }
      const img = raw;
      if (this.stripped(img)) {
        // (a repainted canvas: up in strips over a few frames, then into the texture)
        const st = this.staged(source);
        if (!st) continue;
        tex.sourceVersion = source.version;
        this.fromStaged(source, st, tex);
        this.release(source);
        continue;
      }
      tex.sourceVersion = source.version;
      budget -= img.width * img.height;
      if (tex.format.startsWith('bc7')) encodeBC7(img, { flipY: source.flipY, into: tex });
      else { GPU.queue.copyExternalImageToTexture({ source: img, flipY: source.flipY }, { texture: tex.getGPU() }, [img.width, img.height]); generateMipmaps(tex); }
      this.dropSnapshot(source);
      this.release(source);
    }
  }
  /** The native material for a three material, made again when the source changed (its
   * version: new maps — the neighbourhood's sharper paint swapped in); the old one is freed
   * next frame, once no mesh draws with it. */
  material(source) {
    const had = this.materials.get(source);
    if (had && had.srcVersion === source.version) return had;
    if (had) { this.materials.delete(source); (this.retired ??= []).push(had); }
    const mat = this.makeMaterial(source);
    mat.srcVersion = source.version;
    return mat;
  }
  makeMaterial(source) {
    if (source.userData.water) {
      this.copy ??= new RenderTarget(this.target.width, this.target.height, { colors: ['rgba16float'], depth: 'depth32float', label: 'complex scene copy', usage: ['sample', 'copyDst'], depthUsage: ['sample', 'copyDst'] });
      const mat = waterMaterial({ atmosphere, scene: this.copy, quality: this.quality });
      this.materials.set(source, mat);
      return mat;
    }
    const textures = {};
    // Per-material numbers (texture placement, the window grid, atlas sizes) as uniforms, not
    // written into the shader: materials of one kind then share one shader source, and the
    // browser compiles it once — a first visit compiled ~70 shaders of ~38 KB, a third of them
    // differing only in such numbers.
    const extra = {};
    // Facades with a glass mask (the lit-window map's alpha): a room behind the clear glass.
    const interior = INTERIOR_ALLOWED && !!(source.userData.interior && source.emissiveMap);
    const car = !!(source.userData.carPaint && source.map);
    const recess = RECESS_ALLOWED && interior && source.userData.interior === true;
    let surface = '#if !PASS_DEPTH\nenvP = in.P;\n#endif\nvar puv = in.uv;\nvar reveal = 0.0;\nvar revealUV = in.uv;\n' + (recess ? RECESS_WGSL : '') + (interior ? 'var roomOpen = 0.0;\n' : '') + (car ? 'var carTex = vec3f(0.5);\n' : '');
    // Relief normals and roughness / metalness in one texture where they line up (the
    // facades): normal x, y, roughness, metalness; z comes back from x and y.
    const surfaceTex = this.packedSurface(source);
    // Roughness alone (the ground): its one channel.
    const roughOnly = !surfaceTex && source.roughnessMap && source.roughnessMap !== source.metalnessMap ? this.singleChannel(source.roughnessMap) : null;
    // Number plates: the plate's cell of the atlas from the instance colour (scenePlates).
    const plate = source.userData.plate;
    if (plate && source.map) {
      textures.map = this.texture(source.map);
      extra.plateGrid = ['vec4f', [plate.cols, plate.rows, 0, 0]];
      surface += `{ let pid = floor(in.color.r * 255.0 + 0.5) + 256.0 * floor(in.color.g * 255.0 + 0.5);
        let cell = vec2f(pid % mat.plateGrid.x, floor(pid / mat.plateGrid.x));
        let puv = (cell + clamp(in.uv, vec2f(0.01), vec2f(0.99))) / mat.plateGrid.xy;
        s.albedo = textureSampleLevel(map, smpLinearClamp, puv, 0.0).rgb; s.roughness = 0.45; s.metalness = 0.0; }\n`;
    }
    for (const [key, statement] of plate ? [] : [
      ['map', car ? 's.albedo *= texel.rgb; s.alpha *= texel.a; carTex = texel.rgb;' : 's.albedo *= texel.rgb; s.alpha *= texel.a;'],
      ['roughnessMap', roughOnly ? 's.roughness *= texel.r;' : 's.roughness *= texel.g;'],
      ['metalnessMap', 's.metalness *= texel.b;'],
      ['emissiveMap', interior ? 's.emissive *= texel.rgb; roomOpen = texel.a;' : 's.emissive *= texel.rgb;'],
    ]) {
      if (surfaceTex && (key === 'roughnessMap' || key === 'metalnessMap')) continue;
      const tex = source[key] && (key === 'roughnessMap' && roughOnly ? roughOnly : this.texture(source[key]));
      if (!tex) continue;
      textures[key] = tex;
      const t = source[key];
      extra['uv' + key] = ['vec4f', [t.repeat.x, t.repeat.y, t.offset.x, t.offset.y]];
      const sampler = t.wrapS === 1000 ? 'smpAnisoRepeat' : 'smpAnisoClamp';
      // (the car kit's colour swatches at full resolution, always: mipmapped from afar they
      // blended into the kit's dark red, the paint mask failed and far cars showed red)
      const sample = car && key === 'map' ? `textureSampleLevel(${key}, smpLinearClamp, uv, 0.0)` : `textureSample(${key}, ${sampler}, uv)`;
      surface += `{ let uv = puv * mat.uv${key}.xy + mat.uv${key}.zw; let texel = ${sample}; ${statement} }\n`;
    }
    if (source.normalMap) {
      textures.normalMap = surfaceTex ?? this.texture(source.normalMap);
      const t = source.normalMap;
      extra.uvNormal = ['vec4f', [t.repeat.x, t.repeat.y, t.offset.x, t.offset.y]];
      // Cotangent frame from screen derivatives: works on arbitrary GIS walls.
      surface += `{
        let uv = puv * mat.uvNormal.xy + mat.uvNormal.zw;
        ${surfaceTex ? `let packed = textureSample(normalMap, smpAnisoRepeat, uv);
        var mapN = vec3f(packed.xy * 2.0 - 1.0, 0.0);
        mapN.z = sqrt(max(1.0 - dot(mapN.xy, mapN.xy), 0.0));
        s.roughness *= packed.z;${source.metalnessMap === source.roughnessMap ? ' s.metalness *= packed.w;' : ''}`
          : 'let mapN = textureSample(normalMap, smpAnisoRepeat, uv).xyz * 2.0 - 1.0;'}
        let q0 = dpdx(in.P); let q1 = dpdy(in.P);
        let st0 = dpdx(uv); let st1 = dpdy(uv);
        let q1p = cross(q1, in.N); let q0p = cross(in.N, q0);
        let T = q1p * st0.x + q0p * st1.x;
        let B = q1p * st0.y + q0p * st1.y;
        let inv = inverseSqrt(max(max(dot(T,T), dot(B,B)), 0.000001));
        // Relief reads up close; far away it only sparkles, so it fades out.
        let near = 0.65 * (1.0 - smoothstep(60.0, 260.0, length(in.P - frame.cameraPos)));
        s.normal = normalize(T * inv * mapN.x * near + B * inv * mapN.y * near + in.N * mapN.z);
      }`;
    }
    if (interior) {
      // (the painted grid: bays across, storeys up, and where each storey's ceiling and floor lie;
      // the complex's facade tile unless the material says otherwise — placed as the emissive
      // map is, uvemissiveMap)
      const g = { grid: [8, 8], bay: 3.2, storey: 2.9, ceil: 0.0, floor: 0.9, ...(typeof source.userData.interior === 'object' ? source.userData.interior : {}) };
      extra.room = ['vec4f', [g.grid[0], g.grid[1], g.bay, g.storey]];
      extra.roomCF = ['vec4f', [g.ceil, g.floor, 0, 0]];
      const code = INTERIOR_WGSL.replace('in.uv * REPEAT', 'puv * REPEAT').replace('REPEAT', 'mat.uvemissiveMap.xy').replace('OFFSET', 'mat.uvemissiveMap.zw')
        .replace('GRID', 'mat.room.xy').replaceAll('BAYW', 'mat.room.z').replaceAll('STOREY', 'mat.room.w').replace('CEIL;', 'mat.roomCF.x;').replace('FLOOR;', 'mat.roomCF.y;');
      surface += `if (roomOpen > 0.02) { ${code} }\n`;
      // (the opening's reveal: the wall's paint, shaded — no glass, no room)
      if (recess) surface += `if (reveal > 0.5) {
        let wallTex = textureSampleLevel(map, smpAnisoRepeat, revealUV * mat.uvmap.xy + mat.uvmap.zw, 0.0).rgb;
        s.albedo = mat.color * wallTex * 0.55; s.emissive = vec3f(0.0); s.metalness = 0.0; s.roughness = 0.85; s.specularIntensity = 0.5;
      }\n`;
    }
    // The ground out to 1 km (farGround.ts): past the painted square, the land-use picture; its
    // water (alpha ½) smooth, reflecting. Always bound — a blank until the picture comes — so the
    // picture arriving only swaps a texture, never the shader.
    const far = source.userData.farGround;
    if (far?.map) {
      textures.farMap = this.texture(far.map);
      extra.farT = ['vec4f', [far.half, far.on ? 1 : 0, 0, 0]];
      // (farB: the square the near land use covers, in x and z; past it, the picture)
      extra.farB = ['vec4f', far.box ?? [-1e9, -1e9, 1e9, 1e9]];
      surface += `let pz = vec2f(in.P.x, in.P.z);
      if (mat.farT.y > 0.5 && (any(in.uv < vec2f(0.0)) || any(in.uv > vec2f(1.0)) || any(pz < mat.farB.xy) || any(pz > mat.farB.zw))) {
        let fuv = vec2f(in.P.x, in.P.z) / (2.0 * mat.farT.x) + 0.5;
        if (all(fuv > vec2f(0.0)) && all(fuv < vec2f(1.0))) {
          let ft = textureSample(farMap, smpAnisoClamp, fuv);
          s.albedo = ft.rgb; s.metalness = 0.0; s.emissive = vec3f(0.0);
          s.roughness = select(0.95, 0.07, ft.a < 0.75);
        }
      }\n`;
    }
    if (DETAIL_ALLOWED && source.userData.groundDetail) surface += GROUND_DETAIL + '\n';
    const scan = DETAIL_ALLOWED && details?.[source.userData.detail];
    if (scan) {
      textures.detailMap = scan.tex;
      const [albedo, relief] = DETAIL_LOOK[source.userData.detail] ?? [0.5, 0.4];
      // (not on the clear glass of the windows)
      surface += (interior ? DETAIL_WGSL(scan.metres, albedo, relief, scan.avgRough).replace('let dNear = (', 'let dNear = (1.0 - roomOpen) * (') : DETAIL_WGSL(scan.metres, albedo, relief, scan.avgRough)) + '\n';
    }
    if (source.userData.roofDetail) surface += ROOF_DETAIL + '\n';
    if (interior || source.userData.weathered) surface += WALL_WEATHER + '\n';
    // Leaves let light through: a little transmitted sun on the shaded side.
    if (source.userData.foliage) extra.atlasGrid = ['vec4f', [Number(source.userData.atlasCells ?? 8), Number(source.userData.atlasRows ?? source.userData.atlasCells ?? 8), 0, 0]];
    if (source.userData.foliage) surface += `s.translucency = s.albedo * 0.32;
      // Plant cards thin out as they turn edge-on to the eye (or the sun, in the shadow
      // pass): no flat slabs from the side, no six-pointed star of crossed cards from above.
      // Looked down on steeply, the upright cards squash into streaks round the trunk (a
      // snowflake about every tree): they give way to the crown card seen from above.
      { let ng = normalize(cross(dpdx(in.P), dpdy(in.P))); let v = normalize(frame.cameraPos - in.P);
        let face = abs(dot(ng, v)); let upright = 1.0 - abs(ng.y);
        // (for the sun, harder: a card at a low angle to it casts a thin straight band)
#if PASS_DEPTH
        let faceCut = smoothstep(0.35, 0.75, face);
#else
        let faceCut = smoothstep(${FOLIAGE_FADE});
#endif
        s.alpha *= faceCut * mix(1.0, 1.0 - smoothstep(${FOLIAGE_STEEP}), upright);
        // Crowns cut straight at their card's border read as polygons (and cast polygon
        // shadows): the upright cards soften at their sides and top, the crown card round.
        let cell = fract(in.uv * mat.atlasGrid.xy);
        let side = smoothstep(0.0, 0.12, min(min(cell.x, 1.0 - cell.x), 1.0 - cell.y));
        let crownEdge = 1.0 - smoothstep(0.78, 1.0, length(cell - 0.5) * 2.0);
        s.alpha *= select(crownEdge, side, upright > 0.5);
#if !PASS_DEPTH
        // Lit as a crown, not as flat cards (the foliage normals of SpeedTree and co.): the
        // normal leans out from the middle of the crown — sunlit on one side, shading off
        // smoothly round the other — instead of each card flat-lit, bright or dark, with
        // hard seams where they cross.
        let fq0 = dpdx(in.P); let fq1 = dpdy(in.P); let fu0 = dpdx(in.uv); let fu1 = dpdy(in.uv);
        let facing = select(-ng, ng, dot(ng, v) >= 0.0);
        let fT = normalize(cross(fq1, facing) * fu0.x + cross(facing, fq0) * fu1.x + vec3f(1e-7));
        var round = facing * 0.55;
        if (upright > 0.5) { round += fT * (cell.x - 0.5) * 2.0 + vec3f(0.0, (cell.y - 0.62) * 1.7, 0.0); }
        else { round += vec3f(0.0, 1.0, 0.0) + fT * (cell.x - 0.5) * 1.4; }
        s.normal = normalize(mix(s.normal, normalize(round), 0.75));
#endif
      }`;
    // Leaf-cluster cards of the mesh trees: light through the leaves, and a card turning
    // edge-on thins out (no hard straight line of leaves).
    if (source.userData.leafCluster) surface += `s.translucency = s.albedo * 0.4;
      { let ng = normalize(cross(dpdx(in.P), dpdy(in.P))); let v = normalize(frame.cameraPos - in.P);
        s.alpha *= smoothstep(0.08, 0.3, abs(dot(ng, v)));
        // Mipmaps average the leaves' edges (and a needle tuft's thin lines) away: the alpha
        // falls under the test and distant crowns go bare. Scaled back up by how far down the
        // mip chain the texel is read (after Golus's alpha-to-coverage notes).
        let texel = in.uv * vec2f(textureDimensions(map));
        let mip = max(0.0, log2(max(length(dpdx(texel)), length(dpdy(texel)))));
        s.alpha *= 1.0 + min(mip, 4.0) * 0.28; }`;
    if (source.userData.contextBuilding) surface += WALL_WEATHER + 'if (in.N.y > 0.7) { s.albedo = vec3f(0.24, 0.27, 0.25); s.emissive = vec3f(0.0); s.metalness = 0.0; s.roughness = 0.9;\n' + ROOF_DETAIL + ' }';
    // Weather: rain darkens what faces up and makes it glossy (puddles where the ground
    // dips in the noise); snow settles on it, patchy on slopes. Twin of patchMaterial.
    if (!source.userData.sky) surface += `{
      let up = smoothstep(0.45, 0.9, in.N.y);
      let puddle = smoothstep(0.55, 0.75, skyFbm(in.P.xz * 0.35));
      s.albedo *= 1.0 - frame.debug.y * (0.18 + 0.22 * up + 0.12 * puddle * up);
      s.roughness = mix(s.roughness, 0.12 + 0.2 * (1.0 - puddle), frame.debug.y * up * 0.85);
      let snow = frame.debug.z * smoothstep(0.35, 0.8, in.N.y * (0.8 + 0.35 * skyFbm(in.P.xz * 0.6)));
      s.albedo = mix(s.albedo, vec3f(0.86, 0.88, 0.92), snow);
      s.roughness = mix(s.roughness, 0.9, snow); s.metalness *= 1.0 - snow;
      s.emissive *= 1.0 - snow * 0.8;
    }`;
    // Contact darkening and physical glass response (no procedural grain: it aliases).
    surface += `s.roughness = clamp(s.roughness, 0.12, 1.0);
      s.clearcoat = ${source.clearcoat ? '0.16' : '0.0'}; s.clearcoatRoughness = 0.22;`;
    if (car) surface += CAR_PAINT;
    if (source.userData.carModel) surface += CAR_MODEL;
    const mat = new Material({ name: 'complex ' + source.id, color: source.color, roughness: source.roughness ?? 0.8,
      metalness: source.metalness ?? 0, vertexColors: source.vertexColors,
      side: source.side === 2 ? 'double' : source.side === 1 ? 'back' : 'front',
      alphaTest: source.alphaTest || 0, transparent: source.transparent, opacity: source.opacity,
      // Sky objects (the moon) sit beyond the haze.
      // (atmosphere: skyFbm for the puddles and the snow's patchiness)
      modules: [atmosphere], textures, surface, output: source.userData.sky ? '' : `// (never a NaN or an overflow into the half-float target: one such pixel, spread by the
        // bloom, would flash the whole frame black or white)
        r.color = vec4f(select(min(r.color.rgb, vec3f(30000.0)), vec3f(0.0), r.color.rgb != r.color.rgb), r.color.a);
        let fog = 1.0 - exp(-length(in.P - frame.cameraPos) * mat.haze * mat.hazeScale);
        r.color = vec4f(mix(r.color.rgb, frame.horizonColor, clamp(fog, 0.0, 0.9)), r.color.a);${source.userData.edgeFade ? `
        // Past the painted (surveyed) ground, uv leaves 0..1: fade into the horizon haze (past the
        // 1 km land use once it is in).
        let pastNear = max(max(-in.uv.x, in.uv.x - 1.0), max(-in.uv.y, in.uv.y - 1.0));${source.userData.farGround ? `
        let fq = abs(vec2f(in.P.x, in.P.z)) / mat.farT.x;
        let past = select(pastNear, (max(fq.x, fq.y) - 1.0) * 0.5, mat.farT.y > 0.5);` : `
        let past = pastNear;`}
        r.color = vec4f(mix(r.color.rgb, frame.horizonColor * 0.92, smoothstep(-0.05, 0.9, past)), r.color.a);` : ''}`,
      uniforms: { haze: ['f32', 0.0005], hazeScale: ['f32', source.userData.hazeScale ?? 1], ...extra }, defines: { CLEARCOAT: source.clearcoat || car || source.userData.carModel ? 1 : 0, FOLIAGE: source.userData.leafCluster ? 2 : source.userData.foliage ? 1 : 0 },
      userData: { foliage: !!(source.userData.foliage || source.userData.leafCluster) },
    });
    this.materials.set(source, mat);
    return mat;
  }
  sync(source) {
    source.updateMatrixWorld(true);
    const active = this.active ??= new Set();
    active.clear();
    let added = false, deferred = false, swapped = false;
    // A new complex brings dozens of materials, each with textures to upload (and encode as
    // BC7 on the GPU) and a shader to compose: all in one frame that is a long task and a
    // burst of GPU work, and the pointer stalls with it. They come a few per frame instead
    // (behind the loading overlay before the first frame, unseen; later meshes just appear
    // a frame or two on).
    const until = performance.now() + (this.shown ? 3 : 6);
    // (and by texels: a 2048 px colour map is a BC7 encode of 260k blocks on the GPU, a
    // 30-50 ms task in the browser's GPU process that the whole page's drawing waits behind)
    const texels = () => { let n = 0; for (const t of this.textures.values()) n += t.width * t.height; return n; };
    const room = (this.shown ? 1 : 1.5) * 1e6;
    const startTexels = texels();
    let made = 0;
    source.traverseVisible(obj => {
      if (!obj.isMesh || obj.material?.isShaderMaterial) return;
      active.add(obj);
      let mesh = this.meshes.get(obj);
      if (mesh && !Array.isArray(obj.material) && mesh.material.srcVersion !== obj.material.version) { mesh.material = this.material(obj.material); this.ready = false; }
      if (!mesh) {
        if (made && (performance.now() > until || texels() - startTexels > room)) { deferred = true; return; }
        // (its painted canvases taken off the page first: they come in a frame or two)
        if (!this.imagesReady(obj.material)) { deferred = true; return; }
        const before = this.materials.size + this.textures.size;
        const material = Array.isArray(obj.material) ? obj.material.map(m => this.material(m)) : this.material(obj.material);
        if (this.materials.size + this.textures.size !== before) made++;
        // CPU geometry is shared; no WebGL draw calls are used in this path.
        mesh = new Mesh(obj.geometry, material);
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = obj.frustumCulled;
        mesh.castShadow = obj.castShadow;
        if (obj.isInstancedMesh) {
          mesh.isInstancedMesh = true;
          mesh.instanceMatrix = obj.instanceMatrix;
          mesh.instanceColor = obj.instanceColor;
          if (obj.frustumCulled && !obj.boundingSphere) obj.computeBoundingSphere();
          mesh.boundingSphere = obj.boundingSphere;
        }
        this.meshes.set(obj, mesh);
        this.scene.add(mesh);
        this.ready = false;
        added = true;
        // A new caster joins the cached shadows (as still, until it moves).
        if (mesh.castShadow) this.castersChanged = true;
        mesh.matrix.copy(obj.matrixWorld); mesh.matrixWorldNeedsUpdate = true;
        mesh.count = obj.count ?? 1;
        mesh.instVersion = obj.instanceMatrix?.version;
      }
      // Casters that moved lately (walkers, traffic, boats, the balloon) are drawn into the
      // shadow maps every frame; the still ones can be kept (SunShadows.render). A change
      // of either set invalidates what is kept.
      // (instance data replaced — a level of trees grown: the old buffers are let go below)
      if (obj.isInstancedMesh && (mesh.instanceMatrix !== obj.instanceMatrix || mesh.instanceColor !== obj.instanceColor)) {
        mesh.instanceMatrix = obj.instanceMatrix; mesh.instanceColor = obj.instanceColor; mesh.instVersion = -1; swapped = true;
      }
      const moved = mesh.count !== (obj.count ?? 1) || mesh.instVersion !== obj.instanceMatrix?.version || !sameMatrix(mesh.matrix, obj.matrixWorld);
      if (moved) {
        if (mesh.castShadow && !mesh.moving) this.castersChanged = true;
        mesh.moving = true; mesh.movedAt = this.frameNo;
        mesh.count = obj.count ?? 1;
        mesh.instVersion = obj.instanceMatrix?.version;
        mesh.matrix.copy(obj.matrixWorld); mesh.matrixWorldNeedsUpdate = true;
      } else if (mesh.moving && this.frameNo - mesh.movedAt > 90) {
        mesh.moving = false;
        if (mesh.castShadow) this.castersChanged = true;
      }
    });
    this.pending = deferred;
    if (deferred) this.ready = false;
    let removed = false;
    for (const [obj, mesh] of this.meshes) if (!active.has(obj)) {
      this.scene.remove(mesh); this.meshes.delete(obj); removed = true;
      if (mesh.castShadow && !mesh.moving) this.castersChanged = true;
    }
    // Release what the scene no longer uses — on a change, and every couple of seconds
    // (the scans allocate; most frames change nothing). A material (with its textures)
    // goes only after 20 s out of use: dropping one clears every pipeline, and things
    // shown and hidden again (weather, time of day, a burner's flame) would otherwise
    // rebuild them all each time — a stutter. Switching complexes still frees them.
    this.sweep = (this.sweep ?? 0) + 1;
    if (!removed && !added && !swapped && !this.forgetSoon?.size && this.sweep % 120 !== 0) return;
    if (removed || added || swapped) this.renderer.retainGeometry(this.meshes.values());
    const used = new Set([...active].flatMap(o => Array.isArray(o.material) ? o.material : [o.material]));
    const unusedAt = this.unusedAt ??= new Map();
    const now = performance.now();
    let dropped = false;
    for (const [src, mat] of this.materials) {
      if (used.has(src)) { unusedAt.delete(src); continue; }
      const since = unusedAt.get(src) ?? now;
      unusedAt.set(src, since);
      // (a model taken off the scene — the complex left for another — goes at once: kept 20 s, two
      // or three complexes' facades were held at a time, ~200 MB more while hopping between them)
      const gone = this.forgetSoon?.has(src);
      if (now - since < 20000 && !gone) continue;
      mat.dispose(); mat.uniformBlock.buffer?.destroy(); this.materials.delete(src); unusedAt.delete(src);
      if (!gone) dropped = true;
    }
    this.forgetSoon?.clear();
    if (dropped) this.renderer.pipelines.clear();
    const kept = new Set([...this.materials.keys()].flatMap(m => [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.emissiveMap, m.userData.farGround?.map]));
    for (const [src, tex] of this.textures) if (!kept.has(src)) { tex.destroy(); this.textures.delete(src); }
    // (strips of a canvas no material uses any more)
    if (this.stagings) for (const [src, st] of this.stagings) if (!kept.has(src) && this.frameNo - (st.at ?? 0) > 600) { st.tex.destroy(); this.stagings.delete(src); }
  }
  /** The materials of a model taken off the scene: freed at the next sweep (with their textures,
   * where nothing else uses them), not after 20 s out of use. */
  forget(sources) { this.forgetSoon ??= new Set(); for (const s of sources) this.forgetSoon.add(s); }
  render(source, camera, look, time) {
    if (this.disposed || this.failed) return;
    if (deviceLost) { this.failed = true; return; }
    GPU.beginFrame();
    this.frameNo = (this.frameNo ?? 0) + 1;
    if (this.retired?.length) { for (const m of this.retired.splice(0)) { m.dispose(); m.uniformBlock.buffer?.destroy(); } }
    this.sync(source);
    this.refreshTextures();
    const c = this.camera;
    c.position.copy(camera.position); c.quaternion.copy(camera.quaternion);
    c.fov = camera.fov; c.aspect = camera.aspect; c.near = camera.near; c.far = camera.far;
    c.updateProjectionMatrix(); c.updateMatrixWorld();
    const f = FrameUniforms.fields;
    const elev = look.keyElev * Math.PI / 180, az = look.keyAz * Math.PI / 180;
    f.sunDir.value.set(Math.cos(elev) * Math.sin(az), Math.sin(elev), Math.cos(elev) * Math.cos(az));
    f.sunColor.value.copy(look.key).multiplyScalar(look.keyI);
    f.skyIrradiance.value.copy(look.hemiSky).multiplyScalar(Math.max(0.18, look.hemiI));
    f.horizonColor.value.copy(look.fog); f.exposure.value = look.exposure * 1.15;
    f.time.value = time; f.night.value = look.stars; f.envIntensity.value = Math.max(0.9, look.env);
    f.debug.value.set(look.overcast ?? 0, look.rain ?? 0, look.snow ?? 0, (look.stars ?? 0) * (1 - (look.overcast ?? 0)));
    f.pad0.value = look.starTurn ?? 0;
    // (the look's bloom: faint by day, strong at night; threshold in exposed units)
    this.bloomStrength = (look.bloom ?? 0.2) * 0.5;
    BloomUniforms.set('threshold', Math.max(0.6, (look.bloomAt ?? 4) * 0.35));
    BloomUniforms.set('exposure', f.exposure.value);
    for (const [src, mat] of this.materials) {
      mat.emissive.copy(src.emissive ?? { r: 0, g: 0, b: 0 }).multiplyScalar(src.emissiveIntensity ?? 0);
      mat.set('haze', (source.fog?.density ?? 0.0005) * 0.5);
    }
    // Shared shadow atlas must be refreshed for each view (including modal views).
    if (shadowOwner !== this) { shadows.cascades.forEach(x => { x.dirty = true; }); shadows.invalidateCache(); }
    shadowOwner = this;
    if (this.castersChanged) { shadows.invalidateCache(); this.castersChanged = false; }
    this.shadowStats = shadows.stats;
    this.renderer.precompiling = !this.shown;
    GPU.deferCompiles = !this.shown;
    this.renderer.starved = false;
    const timer = this.timer;
    timer.begin();
    shadows.render(this.scene, this.renderer, shadows.update(c, f.sunDir.value), i => timer.pass('shadow' + i), this.renderer.precompiling ? null : isMoving);
    if (this.env && this.shown) this.captureEnv(look);
    // TAA: the frame a sub-pixel off (8 Halton offsets); a jump (a hop, a resize, the balloon's
    // basket) starts the history afresh.
    this.taaNow = this.taaOn && this.shown && !!this.taaPass?.handle.pipeline;
    const camAt = c.position.clone();
    if (this.taaNow && this.taaPrevAt && (camAt.distanceTo(this.taaPrevAt) > 40 || c.fov !== this.taaPrevFov)) this.taaValid = false;
    const k = (this.frameNo % 8) + 1;
    setFrameCamera(c, this.canvas.width, this.canvas.height, this.taaNow
      ? { jitterX: HALTON(k, 2) - 0.5, jitterY: HALTON(k, 3) - 0.5, prevViewProj: this.taaPrevVP ?? null }
      : {});
    this.taaPrevVP = f.viewProjNoJitter.value.clone();
    this.taaPrevAt = camAt; this.taaPrevFov = c.fov;
    const pass = { camera: c, kind: 'color', colorViews: [this.target.texture.view()], colorFormats: ['rgba16float'], depthView: this.target.depthTexture.view(), depthFormat: 'depth32float' };
    // One collection per frame. Opaque geometry, then the sky where nothing was drawn;
    // with water on screen: a copy of that (colour + depth), the water, then the blended
    // surfaces over it. Without water it stays a single pass.
    const lists = this.renderer.collect(this.scene, pass);
    let water = null;
    for (let i = lists.opaque.length - 1; i >= 0; i--) if (lists.opaque[i].material.userData.water) (water ??= []).push(...lists.opaque.splice(i, 1));
    if (this.shown) this.makePost();
    const aoNow = this.shown && this.aoOn && this.quality.name !== 'low' && !!this.aoPass?.handle.pipeline && !!this.aoBlurX?.handle.pipeline && !!this.aoBlurY?.handle.pipeline;
    const sky = rp => { if (this.sky.handle.pipeline) this.sky.draw(rp); };
    if (aoNow) {
      // The occlusion comes from the solid scene alone: buildings, ground, people. Plant
      // cards would shade the ground in a star round each trunk (their bases), so they are
      // drawn after it, and the finish leaves whatever lies in front of that depth unshaded.
      const plants = [], solid = [];
      for (const item of lists.opaque) (item.material.userData.foliage ? plants : solid).push(item);
      this.renderer.render(this.scene, { ...pass, timestampWrites: timer.pass('scene'), items: { opaque: solid, transparent: [] }, clearColors: [[0, 0, 0, 1]], clearDepth: 0 });
      this.aoPass.timestampWrites = timer.pass('ao');
      this.aoPass.render({ colorViews: [this.ao.texture] });
      this.aoBlurX.timestampWrites = timer.pass('aoBlur');
      this.aoBlurX.render({ colorViews: [this.aoTmp.texture] });
      this.aoBlurY.timestampWrites = undefined;
      this.aoBlurY.render({ colorViews: [this.ao.texture] });
      this.renderer.render(this.scene, { ...pass, label: 'complex plants', timestampWrites: timer.pass('plants'), items: { opaque: plants, transparent: water ? [] : lists.transparent }, betweenLists: sky });
    } else {
      this.renderer.render(this.scene, { ...pass, timestampWrites: timer.pass('scene'), items: { opaque: lists.opaque, transparent: water ? [] : lists.transparent }, clearColors: [[0, 0, 0, 1]], clearDepth: 0, betweenLists: sky });
      // (no occlusion this frame: the finish reads a white one, never an empty — black — texture)
      if (this.shown && this.aoOn) GPU.getEncoder().beginRenderPass({ label: 'complex ao off', colorAttachments: [{ view: this.ao.texture.view(), loadOp: 'clear', storeOp: 'store', clearValue: [1, 0, 0, 1] }] }).end();
    }
    if (water) {
      updateWaveTile();
      if (!this.renderer.precompiling) {
        const enc = GPU.getEncoder(), size = [this.target.width, this.target.height];
        enc.copyTextureToTexture({ texture: this.target.texture.getGPU() }, { texture: this.copy.texture.getGPU() }, size);
        enc.copyTextureToTexture({ texture: this.target.depthTexture.getGPU() }, { texture: this.copy.depthTexture.getGPU() }, size);
      }
      this.renderer.render(this.scene, { ...pass, label: 'complex water', timestampWrites: timer.pass('water'), items: { opaque: water, transparent: lists.transparent } });
    }
    this.renderer.precompiling = false;
    if (this.taaNow) {
      this.taaIdx ^= 1;
      TaaUniforms.set('valid', this.taaValid ? 1 : 0);
      this.taaPass.timestampWrites = timer.pass('taa');
      this.taaPass.render({ colorViews: [this.taaHist[this.taaIdx].texture] });
      this.taaValid = true;
    } else this.taaValid = false;
    const bloomNow = this.shown && this.bloomOn && this.quality.name !== 'low' && !!this.bloomDown?.every(p => p.handle.pipeline) && !!this.bloomUp?.every(p => p.handle.pipeline);
    BloomUniforms.set('strength', bloomNow ? this.bloomStrength ?? 0 : 0);
    if (bloomNow) {
      this.bloomDown.forEach((p, i) => { p.timestampWrites = i === 0 ? timer.pass('bloom') : undefined; p.render({ colorViews: [this.bloomRT[i].texture] }); });
      for (let i = this.bloomUp.length - 1; i >= 0; i--) this.bloomUp[i].render({ colorViews: [this.bloomRT[i].texture] });
      if (import.meta.env.DEV && lookParams.get('probe')) this.probeBloom();
    }
    if (this.shown) {
      this.finish.timestampWrites = timer.pass('finish');
      this.finish.render({ colorViews: [this.context.getCurrentTexture().createView()] });
    }
    // (a frame that held pipelines back to the pace hasn't got the scene's pipelines yet)
    this.starved = this.renderer.starved;
    const readTimes = this.renderer.precompiling ? null : timer.end(GPU.getEncoder());
    GPU.submit();
    readTimes?.();
    if (!this.ready && !this.compiling) {
      this.compiling = true;
      GPU.pipelinesReady().then(() => {
        this.compiling = false;
        if (this.disposed) return;
        this.failed = [...this.renderer.pipelines.values()].some(p => p.handle.failed) || this.sky.handle.failed || this.finish.handle.failed
          || !!(this.aoPass?.handle.failed || this.aoBlurX?.handle.failed || this.aoBlurY?.handle.failed);
        this.ready = !this.failed && !this.pending && !this.starved;
        if (this.ready) this.shown = true;
      });
    }
    const vis = this.shown && !this.failed ? 'visible' : 'hidden';
    if (this.canvas.style.visibility !== vis) this.canvas.style.visibility = vis;
  }
  /** The surroundings cube: one face a frame once the light, the weather or the scene has
   * changed and settled (each face drawn as the main view is: no pipelines of its own). */
  captureEnv(look) {
    const e = this.env, now = performance.now();
    envView = this;
    EnvUniforms.set('on', e.on ? 1 : 0);
    EnvUniforms.set('fade', e.fadeAt ? Math.min(1, (now - e.fadeAt) / 1000) : 1);
    // (the sun in 3° steps: captured again each degree, the reflections changed every few minutes)
    const key = `${Math.round(look.keyElev / 3)}|${Math.round(look.keyAz / 3)}|${(look.rain ?? 0).toFixed(1)}|${(look.snow ?? 0).toFixed(1)}|${(look.stars ?? 0).toFixed(1)}|${(look.overcast ?? 0).toFixed(1)}`;
    if (key !== e.key) { e.key = key; e.dirtyAt = now; }
    if (Math.abs(this.meshes.size - e.meshes) > Math.max(8, e.meshes * 0.1)) { e.meshes = this.meshes.size; e.dirtyAt = now; }
    // (once the scene has held still for 3 s — a new complex's decoration all in — and then a face
    // every third frame: each is a whole scene drawn again, and in a row they made the load stutter)
    // (not while the last one still fades in: its predecessor, being faded from, is the cube drawn into)
    if (e.face < 0) { if (!e.dirtyAt || now - e.dirtyAt < 3000 || !this.ready || (e.fadeAt && now - e.fadeAt < 1100)) return; e.face = 0; e.dirtyAt = 0; }
    if (this.frameNo % 3) return;
    const [dx, dy, dz, ux, uy, uz] = ENV_FACES[e.face];
    const probe = EnvUniforms.fields.probe.value;
    const cam = e.cam;
    cam.far = this.camera.far;
    cam.position.set(probe[0], probe[1], probe[2]);
    cam.up.set(ux, uy, uz);
    cam.lookAt(probe[0] + dx, probe[1] + dy, probe[2] + dz);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    setFrameCamera(cam, ENV_SIZE, ENV_SIZE, { block: e.block });
    this.renderer.render(this.scene, {
      label: 'complex env ' + e.face, camera: cam, kind: 'color', frameBlock: e.block,
      colorViews: [e.faceRT.texture.view()], colorFormats: ['rgba16float'],
      depthView: e.depth.depthTexture.view(), depthFormat: 'depth32float', clearColors: [[0, 0, 0, 0]], clearDepth: 0,
    });
    GPU.getEncoder().copyTextureToTexture({ texture: e.faceRT.texture.getGPU() }, { texture: e.back.getGPU(), origin: [0, 0, e.face] }, [ENV_SIZE, ENV_SIZE, 1]);
    if (++e.face === 6) { e.face = -1; e.on = true; [e.tex, e.back] = [e.back, e.tex]; e.fadeAt = performance.now(); }
  }
  dispose() {
    this.disposed = true;
    this.snaps = null;
    this.stagings?.forEach(st => st.tex.destroy()); this.stagings = null;
    if (shadowOwner === this) shadowOwner = null;
    this.context.unconfigure();
    this.canvas.remove();
    for (const mat of this.materials.values()) { mat.dispose(); mat.uniformBlock.buffer?.destroy(); }
    for (const tex of this.textures.values()) tex.destroy();
    // Also detaches disposal listeners from CPU geometry shared by later views.
    this.renderer.dispose();
    this.timer.dispose();
    this.target.textures.forEach(t => t.destroy()); this.target.depthTexture.destroy();
    this.copy?.textures.forEach(t => t.destroy()); this.copy?.depthTexture.destroy();
    this.ao?.textures.forEach(t => t.destroy()); this.aoTmp?.textures.forEach(t => t.destroy());
    this.bloomRT?.forEach(rt => rt.textures.forEach(t => t.destroy()));
    this.taaHist?.forEach(rt => rt.textures.forEach(t => t.destroy()));
    if (this.env) { this.env.tex.destroy(); this.env.back.destroy(); this.env.faceRT.textures.forEach(t => t.destroy()); this.env.depth.depthTexture.destroy(); if (envView === this) envView = null; }
    this.renderer.pipelines.clear(); this.materials.clear(); this.textures.clear(); this.meshes.clear();
  }
}
