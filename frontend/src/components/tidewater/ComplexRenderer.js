// Native WebGPU adapter for the MIT-licensed Tidewater engine.
// Copyright (c) 2026 DRG Software Solutions LLC (engine).
// Upstream and full MIT notice: ../../vendor/tidewater/{NOTICE.md,LICENSE}.
import { GPU } from '../../vendor/tidewater/engine/gpu/GPU.js';
import { Texture, RenderTarget } from '../../vendor/tidewater/engine/gpu/Texture.js';
import { generateMipmaps } from '../../vendor/tidewater/engine/gpu/Mipmaps.js';
import { MeshRenderer } from '../../vendor/tidewater/engine/render/MeshRenderer.js';
import { Material } from '../../vendor/tidewater/engine/render/Material.js';
import { FullscreenPass } from '../../vendor/tidewater/engine/render/FullscreenPass.js';
import { SunShadows } from '../../vendor/tidewater/engine/render/Shadows.js';
import { FrameUniforms, setFrameCamera } from '../../vendor/tidewater/engine/render/Frame.js';
import { ShaderModule } from '../../vendor/tidewater/engine/gpu/Shader.js';
import { SceneLighting } from '../../vendor/tidewater/engine/render/wgsl/lighting.js';
import { Scene, Mesh, PerspectiveCamera } from '../../vendor/tidewater/engine/index.js';
import { waterMaterial, updateWaveTile } from './ComplexWater.js';
import { GpuTimer } from './GpuTimer.js';
import { packInto } from './texturePack.js';
import { canEncodeBC7, encodeBC7, warmBC7 } from './bc7Encode.js';
import { gpuCaps } from '../gpuCaps';

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
async function device() {
  // (a device already made — before a hot update of this module — is reused)
  initialization ??= (GPU.device && !deviceLost ? Promise.resolve() : GPU.init({ headless: true })).then(() => {
    gpuCaps.bc = GPU.features.has('texture-compression-bc');
    warmBC7();
    GPU.format = navigator.gpu.getPreferredCanvasFormat();
    SceneLighting.set('envSpecular', new ShaderModule({ name: 'complex reflected sky', deps: [atmosphere], code: `
      fn hookEnvSpecular(R: vec3f, roughness: f32) -> vec3f {
        return mix(skyBase(R), frame.horizonColor, roughness * 0.55) * frame.envIntensity;
      }` }));
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

const finishCode = /* wgsl */`
fn fragment(in: FSIn) -> vec4f {
  let px = 1.0 / vec2f(textureDimensions(src));
  var c = textureSampleLevel(src, smpLinearClamp, in.uv, 0.0).rgb;
  // Small edge-aware filter at internal resolution reduces facade shimmer.
  let a = textureSampleLevel(src, smpLinearClamp, in.uv + vec2f(px.x, 0.0), 0.0).rgb;
  let b = textureSampleLevel(src, smpLinearClamp, in.uv - vec2f(px.x, 0.0), 0.0).rgb;
  let d = textureSampleLevel(src, smpLinearClamp, in.uv + vec2f(0.0, px.y), 0.0).rgb;
  let e = textureSampleLevel(src, smpLinearClamp, in.uv - vec2f(0.0, px.y), 0.0).rgb;
  let edge = length(a - b) + length(d - e);
  c = mix(c, (a + b + d + e + c * 4.0) / 8.0, smoothstep(0.15, 0.8, edge) * 0.65);
  c = precipitate(c, in.uv);
  c *= frame.exposure;
  c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
  c = pow(c, vec3f(1.0 / 2.2));
  return vec4f(c, 1.0);
}`;

/** The device, ahead of the first view (ComplexHologram.warmGpu). */
export function warmDevice() { return device().catch(() => {}); }

const isMoving = mesh => mesh.moving === true;
// (twin of scenePlants' WebGL fade)
const FOLIAGE_FADE = '0.14, 0.46, face';
function sameMatrix(a, b) {
  const x = a.elements, y = b.elements;
  for (let i = 0; i < 16; i++) if (x[i] !== y[i]) return false;
  return true;
}

export class ComplexRenderer {
  static async create(host, quality = QUALITY.high) {
    await device();
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
    this.camera = new PerspectiveCamera();
    this.renderer = new MeshRenderer();
    // A new complex's pipelines spread over frames (see MeshRenderer._pipeline).
    this.renderer.pipelinesPerFrame = 3;
    this.renderer.syncPipelines = false;
    this.target = new RenderTarget(1, 1, { colors: ['rgba16float'], depth: 'depth32float', label: 'complex HDR' });
    // What the water sees through and reflects: the opaque scene, copied before the water
    // pass (Tidewater's sceneCopy). Allocated once water is in the scene.
    this.copy = null;
    this.sky = new FullscreenPass({ label: 'complex atmosphere', modules: [atmosphere], code: skyCode, colorFormats: ['rgba16float'], depthFormat: 'depth32float', depthCompare: 'equal' });
    this.finish = new FullscreenPass({ label: 'complex filmic resolve', modules: [new ShaderModule({ name: 'complex precipitation', code: PRECIP_WGSL })], code: finishCode, colorFormats: [GPU.format],
      bindings: { src: { texture: () => this.target.texture }, sceneDepth: { texture: () => this.target.depthTexture, sampleType: 'unfilterable-float' } } });
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
  setSize(w, h, ratio) {
    const limit = GPU.device.limits.maxTextureDimension2D;
    const width = Math.min(limit, Math.max(1, Math.round(w * ratio)));
    const height = Math.min(limit, Math.max(1, Math.round(h * ratio)));
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.target.setSize(this.canvas.width, this.canvas.height);
    this.copy?.setSize(this.canvas.width, this.canvas.height);
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
  texture(source) {
    if (this.textures.has(source)) return this.textures.get(source);
    // Pre-compressed levels (the plant atlas as BC7): uploaded as they are, a quarter of the memory.
    const packed = source.userData?.compressed;
    if (packed && GPU.features.has('texture-compression-bc')) {
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
    // Painted colour maps (facades, glazing, lit windows, the ground's paint): BC7, made on
    // the GPU — a quarter of the memory, the same look (48–62 dB against the source).
    if (!img.data && source.colorSpace === 'srgb' && canEncodeBC7(img)) {
      const tex = encodeBC7(img, { flipY: source.flipY });
      tex.sourceVersion = source.version;
      this.textures.set(source, tex);
      this.release(source);
      return tex;
    }
    const tex = new Texture({ width: img.width, height: img.height, format: source.colorSpace === 'srgb' ? 'rgba8unorm-srgb' : 'rgba8unorm', mips: true, usage: ['sample', 'render', 'copyDst'] });
    if (img.data) tex.upload(img.data);
    else GPU.queue.copyExternalImageToTexture({ source: img, flipY: source.flipY }, { texture: tex.getGPU() }, [img.width, img.height]);
    generateMipmaps(tex);
    tex.sourceVersion = source.version;
    this.textures.set(source, tex);
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
    for (const [source, tex] of this.textures) {
      if (tex.sourceVersion === source.version) continue;
      tex.sourceVersion = source.version;
      const img = source.image;
      if (!img?.width || img.data || img.width !== tex.width || img.height !== tex.height || tex.packed) continue;
      if (tex.repack) { tex.repack(); this.release(source); continue; }
      if (tex.format.startsWith('bc7')) { encodeBC7(img, { flipY: source.flipY, into: tex }); this.release(source); continue; }
      GPU.queue.copyExternalImageToTexture({ source: img, flipY: source.flipY }, { texture: tex.getGPU() }, [img.width, img.height]);
      generateMipmaps(tex);
      this.release(source);
    }
  }
  material(source) {
    if (this.materials.has(source)) return this.materials.get(source);
    if (source.userData.water) {
      this.copy ??= new RenderTarget(this.target.width, this.target.height, { colors: ['rgba16float'], depth: 'depth32float', label: 'complex scene copy', usage: ['sample', 'copyDst'], depthUsage: ['sample', 'copyDst'] });
      const mat = waterMaterial({ atmosphere, scene: this.copy, quality: this.quality });
      this.materials.set(source, mat);
      return mat;
    }
    const textures = {};
    let surface = '';
    // Relief normals and roughness / metalness in one texture where they line up (the
    // facades): normal x, y, roughness, metalness; z comes back from x and y.
    const surfaceTex = this.packedSurface(source);
    // Roughness alone (the ground): its one channel.
    const roughOnly = !surfaceTex && source.roughnessMap && source.roughnessMap !== source.metalnessMap ? this.singleChannel(source.roughnessMap) : null;
    for (const [key, statement] of [
      ['map', 's.albedo *= texel.rgb; s.alpha *= texel.a;'],
      ['roughnessMap', roughOnly ? 's.roughness *= texel.r;' : 's.roughness *= texel.g;'],
      ['metalnessMap', 's.metalness *= texel.b;'],
      ['emissiveMap', 's.emissive *= texel.rgb;'],
    ]) {
      if (surfaceTex && (key === 'roughnessMap' || key === 'metalnessMap')) continue;
      const tex = source[key] && (key === 'roughnessMap' && roughOnly ? roughOnly : this.texture(source[key]));
      if (!tex) continue;
      textures[key] = tex;
      const t = source[key];
      const f = n => Number(n).toFixed(8);
      const sampler = t.wrapS === 1000 ? 'smpAnisoRepeat' : 'smpAnisoClamp';
      surface += `{ let uv = in.uv * vec2f(${f(t.repeat.x)}, ${f(t.repeat.y)}) + vec2f(${f(t.offset.x)}, ${f(t.offset.y)}); let texel = textureSample(${key}, ${sampler}, uv); ${statement} }\n`;
    }
    if (source.normalMap) {
      textures.normalMap = surfaceTex ?? this.texture(source.normalMap);
      const t = source.normalMap;
      // Cotangent frame from screen derivatives: works on arbitrary GIS walls.
      surface += `{
        let uv = in.uv * vec2f(${t.repeat.x.toFixed(8)}, ${t.repeat.y.toFixed(8)}) + vec2f(${t.offset.x.toFixed(8)}, ${t.offset.y.toFixed(8)});
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
    // Leaves let light through: a little transmitted sun on the shaded side.
    if (source.userData.foliage) surface += `s.translucency = s.albedo * 0.25;
      // Plant cards thin out as they turn edge-on to the eye (or the sun, in the shadow
      // pass): no flat slabs from the side, no six-pointed star of crossed cards from above.
      { let ng = normalize(cross(dpdx(in.P), dpdy(in.P))); let face = abs(dot(ng, normalize(frame.cameraPos - in.P)));
        s.alpha *= smoothstep(${FOLIAGE_FADE}); }`;
    if (source.userData.contextBuilding) surface += 'if (in.N.y > 0.7) { s.albedo = vec3f(0.24, 0.27, 0.25); s.emissive = vec3f(0.0); s.metalness = 0.0; s.roughness = 0.9; }';
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
    const mat = new Material({ name: 'complex ' + source.id, color: source.color, roughness: source.roughness ?? 0.8,
      metalness: source.metalness ?? 0, vertexColors: source.vertexColors,
      side: source.side === 2 ? 'double' : source.side === 1 ? 'back' : 'front',
      alphaTest: source.alphaTest || 0, transparent: source.transparent, opacity: source.opacity,
      // Sky objects (the moon) sit beyond the haze.
      // (atmosphere: skyFbm for the puddles and the snow's patchiness)
      modules: [atmosphere], textures, surface, output: source.userData.sky ? '' : `let fog = 1.0 - exp(-length(in.P - frame.cameraPos) * mat.haze * mat.hazeScale);
        r.color = vec4f(mix(r.color.rgb, frame.horizonColor, clamp(fog, 0.0, 0.9)), r.color.a);${source.userData.edgeFade ? `
        // Past the painted (surveyed) ground, uv leaves 0..1: fade into the horizon haze.
        let past = max(max(-in.uv.x, in.uv.x - 1.0), max(-in.uv.y, in.uv.y - 1.0));
        r.color = vec4f(mix(r.color.rgb, frame.horizonColor * 0.92, smoothstep(-0.05, 0.9, past)), r.color.a);` : ''}`,
      uniforms: { haze: ['f32', 0.0005], hazeScale: ['f32', source.userData.hazeScale ?? 1] }, defines: { CLEARCOAT: source.clearcoat ? 1 : 0 },
    });
    this.materials.set(source, mat);
    return mat;
  }
  sync(source) {
    source.updateMatrixWorld(true);
    const active = this.active ??= new Set();
    active.clear();
    let added = false;
    source.traverseVisible(obj => {
      if (!obj.isMesh || obj.material?.isShaderMaterial) return;
      active.add(obj);
      let mesh = this.meshes.get(obj);
      if (!mesh) {
        const material = Array.isArray(obj.material) ? obj.material.map(m => this.material(m)) : this.material(obj.material);
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
        mesh.matrix.copy(obj.matrixWorld);
        mesh.count = obj.count ?? 1;
        mesh.instVersion = obj.instanceMatrix?.version;
      }
      // Casters that moved lately (walkers, traffic, boats, the balloon) are drawn into the
      // shadow maps every frame; the still ones can be kept (SunShadows.render). A change
      // of either set invalidates what is kept.
      const moved = mesh.count !== (obj.count ?? 1) || mesh.instVersion !== obj.instanceMatrix?.version || !sameMatrix(mesh.matrix, obj.matrixWorld);
      if (moved) {
        if (mesh.castShadow && !mesh.moving) this.castersChanged = true;
        mesh.moving = true; mesh.movedAt = this.frameNo;
        mesh.count = obj.count ?? 1;
        mesh.instVersion = obj.instanceMatrix?.version;
        mesh.matrix.copy(obj.matrixWorld);
      } else if (mesh.moving && this.frameNo - mesh.movedAt > 90) {
        mesh.moving = false;
        if (mesh.castShadow) this.castersChanged = true;
      }
    });
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
    if (!removed && !added && this.sweep % 120 !== 0) return;
    if (removed || added) this.renderer.retainGeometry(this.meshes.values());
    const used = new Set([...active].flatMap(o => Array.isArray(o.material) ? o.material : [o.material]));
    const unusedAt = this.unusedAt ??= new Map();
    const now = performance.now();
    let dropped = false;
    for (const [src, mat] of this.materials) {
      if (used.has(src)) { unusedAt.delete(src); continue; }
      const since = unusedAt.get(src) ?? now;
      unusedAt.set(src, since);
      if (now - since < 20000) continue;
      mat.dispose(); mat.uniformBlock.buffer?.destroy(); this.materials.delete(src); unusedAt.delete(src); dropped = true;
    }
    if (dropped) this.renderer.pipelines.clear();
    const kept = new Set([...this.materials.keys()].flatMap(m => [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.emissiveMap]));
    for (const [src, tex] of this.textures) if (!kept.has(src)) { tex.destroy(); this.textures.delete(src); }
  }
  render(source, camera, look, time) {
    if (this.disposed || this.failed) return;
    if (deviceLost) { this.failed = true; return; }
    GPU.beginFrame();
    this.frameNo = (this.frameNo ?? 0) + 1;
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
    const timer = this.timer;
    timer.begin();
    shadows.render(this.scene, this.renderer, shadows.update(c, f.sunDir.value), i => timer.pass('shadow' + i), this.renderer.precompiling ? null : isMoving);
    setFrameCamera(c, this.canvas.width, this.canvas.height);
    const pass = { camera: c, kind: 'color', colorViews: [this.target.texture.view()], colorFormats: ['rgba16float'], depthView: this.target.depthTexture.view(), depthFormat: 'depth32float' };
    // One collection per frame. Opaque geometry, then the sky where nothing was drawn;
    // with water on screen: a copy of that (colour + depth), the water, then the blended
    // surfaces over it. Without water it stays a single pass.
    const lists = this.renderer.collect(this.scene, pass);
    let water = null;
    for (let i = lists.opaque.length - 1; i >= 0; i--) if (lists.opaque[i].material.userData.water) (water ??= []).push(...lists.opaque.splice(i, 1));
    this.renderer.render(this.scene, { ...pass, timestampWrites: timer.pass('scene'), items: { opaque: lists.opaque, transparent: water ? [] : lists.transparent }, clearColors: [[0, 0, 0, 1]], clearDepth: 0,
      betweenLists: rp => { if (this.sky.handle.pipeline) this.sky.draw(rp); } });
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
    if (this.shown) {
      this.finish.timestampWrites = timer.pass('finish');
      this.finish.render({ colorViews: [this.context.getCurrentTexture().createView()] });
    }
    const readTimes = this.renderer.precompiling ? null : timer.end(GPU.getEncoder());
    GPU.submit();
    readTimes?.();
    if (!this.ready && !this.compiling) {
      this.compiling = true;
      GPU.pipelinesReady().then(() => {
        this.compiling = false;
        if (this.disposed) return;
        this.failed = [...this.renderer.pipelines.values()].some(p => p.handle.failed) || this.sky.handle.failed || this.finish.handle.failed;
        this.ready = !this.failed;
        if (this.ready) this.shown = true;
      });
    }
    this.canvas.style.visibility = this.shown && !this.failed ? 'visible' : 'hidden';
  }
  dispose() {
    this.disposed = true;
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
    this.renderer.pipelines.clear(); this.materials.clear(); this.textures.clear(); this.meshes.clear();
  }
}
