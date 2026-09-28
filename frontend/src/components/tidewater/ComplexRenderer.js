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

/** Render quality. high: desktop; medium: tablets and integrated GPUs; low: phones and
 * software / fallback adapters. The view steps down on its own while frames are slow. */
export const QUALITY = {
  high: { name: 'high', shadow: 2048, ssr: true, clouds: true },
  medium: { name: 'medium', shadow: 2048, ssr: true, clouds: false },
  low: { name: 'low', shadow: 1024, ssr: false, clouds: false },
};

// The engine owns a device singleton. Share it, but give each panel its own
// canvas context, scene, buffers and targets. Render/submit each view atomically.
let initialization;
let shadows;
let deviceLost = false;
let shadowOwner;
let shadowSize = 0;
function useShadows(size) {
  if (shadowSize === size) return;
  shadows?.texture.destroy();
  shadows = new SunShadows({ size, splits: [180, 600, 1800], normalBias: [0.12, 0.3, 0.7] });
  shadowSize = size;
  shadowOwner = null;
}
async function device() {
  initialization ??= GPU.init({ headless: true }).then(() => {
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
// Clear-sky gradient only (also what glass reflects: no cloud noise per facade pixel).
fn skyBase(ray: vec3f) -> vec3f {
  let day = 1.0 - frame.night;
  let e = clamp(ray.y, 0.0, 1.0);
  let dusk = 1.0 - smoothstep(0.04, 0.45, frame.sunDir.y);
  let zenith = mix(vec3f(0.08, 0.27, 0.72), vec3f(0.24, 0.2, 0.34), dusk);
  let horizon = mix(vec3f(0.55, 0.71, 0.9), frame.horizonColor, dusk * 0.85);
  let daySky = mix(horizon, zenith, pow(e, 0.55));
  let nightSky = mix(frame.horizonColor * 0.45, vec3f(0.006, 0.013, 0.04), pow(e, 0.35));
  return mix(nightSky, daySky, day);
}
// The sky with its clouds, without the sun disc (also what the water reflects).
fn skyClouds(ray: vec3f) -> vec3f {
  let day = 1.0 - frame.night;
  var sky = skyBase(ray);
  if (ray.y > 0.0) {
    // A cloud layer overhead, seen in perspective; drifting slowly with the wind.
    // A curved cloud deck: near the horizon puffs flatten, but are not smeared into streaks.
    let uv = ray.xz / (ray.y + 0.22) * 1.35 + vec2f(frame.time * 0.005, frame.time * 0.0018);
    let d = cumulus(uv);
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
  return sky;
}
fn complexSky(ray: vec3f) -> vec3f {
  let day = 1.0 - frame.night;
  var sky = skyClouds(ray);
  // The sun: a small soft disc, no glare halo (the sky reads as plain blue with clouds).
  let sun = max(dot(ray, frame.sunDir), 0.0);
  let sunHue = frame.sunColor / max(max(frame.sunColor.r, max(frame.sunColor.g, frame.sunColor.b)), 0.001);
  sky = mix(sky, sunHue * 1.15, smoothstep(0.99985, 0.99995, sun) * day * 0.85);
  return sky;
}` });
const skyCode = /* wgsl */`
fn fragment(in: FSIn) -> vec4f {
  let p = frame.invProj * vec4f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0, 0.001, 1.0);
  let ray = normalize((frame.invView * vec4f(normalize(p.xyz / p.w), 0.0)).xyz);
  return vec4f(complexSky(ray), 1.0);
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
  c *= frame.exposure;
  c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
  c = pow(c, vec3f(1.0 / 2.2));
  return vec4f(c, 1.0);
}`;

export class ComplexRenderer {
  static async create(host, quality = QUALITY.high) {
    await device();
    return new ComplexRenderer(host, quality);
  }
  constructor(host, quality = QUALITY.high) {
    this.quality = quality;
    useShadows(quality.shadow);
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
    this.renderer.syncPipelines = false;
    this.target = new RenderTarget(1, 1, { colors: ['rgba16float'], depth: 'depth32float', label: 'complex HDR' });
    // What the water sees through and reflects: the opaque scene, copied before the water
    // pass (Tidewater's sceneCopy). Allocated once water is in the scene.
    this.copy = null;
    this.sky = new FullscreenPass({ label: 'complex atmosphere', modules: [atmosphere], code: skyCode, colorFormats: ['rgba16float'], depthFormat: 'depth32float', depthCompare: 'equal' });
    this.finish = new FullscreenPass({ label: 'complex filmic resolve', code: finishCode, colorFormats: [GPU.format], bindings: { src: { texture: () => this.target.texture } } });
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
    useShadows(quality.shadow);
    // The water's defines change: a new material; its mesh is re-created on the next sync.
    for (const [src, mat] of this.materials) if (src.userData.water) { mat.dispose(); mat.uniformBlock.buffer?.destroy(); this.materials.delete(src); }
    for (const [obj, mesh] of this.meshes) if (obj.material?.userData?.water) { this.scene.remove(mesh); this.meshes.delete(obj); }
  }
  texture(source) {
    if (this.textures.has(source)) return this.textures.get(source);
    const img = source.image;
    if (!img?.width || !img?.height) return null;
    const tex = new Texture({ width: img.width, height: img.height, format: source.colorSpace === 'srgb' ? 'rgba8unorm-srgb' : 'rgba8unorm', mips: true, usage: ['sample', 'render', 'copyDst'] });
    if (img.data) tex.upload(img.data);
    else GPU.queue.copyExternalImageToTexture({ source: img, flipY: source.flipY }, { texture: tex.getGPU() }, [img.width, img.height]);
    generateMipmaps(tex);
    tex.sourceVersion = source.version;
    this.textures.set(source, tex);
    return tex;
  }
  /** Canvas textures repainted in place (the ground once land use arrives): upload again. */
  refreshTextures() {
    for (const [source, tex] of this.textures) {
      if (tex.sourceVersion === source.version) continue;
      tex.sourceVersion = source.version;
      const img = source.image;
      if (!img?.width || img.data || img.width !== tex.width || img.height !== tex.height) continue;
      GPU.queue.copyExternalImageToTexture({ source: img, flipY: source.flipY }, { texture: tex.getGPU() }, [img.width, img.height]);
      generateMipmaps(tex);
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
    for (const [key, statement] of [
      ['map', 's.albedo *= texel.rgb; s.alpha *= texel.a;'],
      ['roughnessMap', 's.roughness *= texel.g;'],
      ['metalnessMap', 's.metalness *= texel.b;'],
      ['emissiveMap', 's.emissive *= texel.rgb;'],
    ]) {
      const tex = source[key] && this.texture(source[key]);
      if (!tex) continue;
      textures[key] = tex;
      const t = source[key];
      const f = n => Number(n).toFixed(8);
      const sampler = t.wrapS === 1000 ? 'smpAnisoRepeat' : 'smpAnisoClamp';
      surface += `{ let uv = in.uv * vec2f(${f(t.repeat.x)}, ${f(t.repeat.y)}) + vec2f(${f(t.offset.x)}, ${f(t.offset.y)}); let texel = textureSample(${key}, ${sampler}, uv); ${statement} }\n`;
    }
    if (source.normalMap) {
      textures.normalMap = this.texture(source.normalMap);
      const t = source.normalMap;
      // Cotangent frame from screen derivatives: works on arbitrary GIS walls.
      surface += `{
        let uv = in.uv * vec2f(${t.repeat.x.toFixed(8)}, ${t.repeat.y.toFixed(8)}) + vec2f(${t.offset.x.toFixed(8)}, ${t.offset.y.toFixed(8)});
        let mapN = textureSample(normalMap, smpAnisoRepeat, uv).xyz * 2.0 - 1.0;
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
    if (source.userData.foliage) surface += 's.translucency = s.albedo * 0.25;';
    if (source.userData.contextBuilding) surface += 'if (in.N.y > 0.7) { s.albedo = vec3f(0.24, 0.27, 0.25); s.emissive = vec3f(0.0); s.metalness = 0.0; s.roughness = 0.9; }';
    // Contact darkening and physical glass response (no procedural grain: it aliases).
    surface += `s.roughness = clamp(s.roughness, 0.12, 1.0);
      s.clearcoat = ${source.clearcoat ? '0.16' : '0.0'}; s.clearcoatRoughness = 0.22;`;
    const mat = new Material({ name: 'complex ' + source.id, color: source.color, roughness: source.roughness ?? 0.8,
      metalness: source.metalness ?? 0, vertexColors: source.vertexColors,
      side: source.side === 2 ? 'double' : source.side === 1 ? 'back' : 'front',
      alphaTest: source.alphaTest || 0, transparent: source.transparent, opacity: source.opacity,
      // Sky objects (the moon) sit beyond the haze.
      textures, surface, output: source.userData.sky ? '' : `let fog = 1.0 - exp(-length(in.P - frame.cameraPos) * mat.haze * mat.hazeScale);
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
      }
      mesh.count = obj.count ?? 1;
      mesh.matrix.copy(obj.matrixWorld);
    });
    let removed = false;
    for (const [obj, mesh] of this.meshes) if (!active.has(obj)) { this.scene.remove(mesh); this.meshes.delete(obj); removed = true; }
    // Release per-complex resources when switching selections (only then: the scans
    // below allocate, and most frames change nothing).
    if (!removed && !added) return;
    this.renderer.retainGeometry(this.meshes.values());
    const used = new Set([...active].flatMap(o => Array.isArray(o.material) ? o.material : [o.material]));
    for (const [src, mat] of this.materials) if (!used.has(src)) { mat.dispose(); mat.uniformBlock.buffer?.destroy(); this.materials.delete(src); this.renderer.pipelines.clear(); }
    const usedTextures = new Set([...used].flatMap(m => [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.emissiveMap]));
    for (const [src, tex] of this.textures) if (!usedTextures.has(src)) { tex.destroy(); this.textures.delete(src); }
  }
  render(source, camera, look, time) {
    if (this.disposed || this.failed) return;
    if (deviceLost) { this.failed = true; return; }
    GPU.beginFrame();
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
    for (const [src, mat] of this.materials) {
      mat.emissive.copy(src.emissive ?? { r: 0, g: 0, b: 0 }).multiplyScalar(src.emissiveIntensity ?? 0);
      mat.set('haze', (source.fog?.density ?? 0.0005) * 0.5);
    }
    // Shared shadow atlas must be refreshed for each view (including modal views).
    if (shadowOwner !== this) shadows.cascades.forEach(x => { x.dirty = true; });
    shadowOwner = this;
    this.renderer.precompiling = !this.shown;
    shadows.render(this.scene, this.renderer, shadows.update(c, f.sunDir.value));
    setFrameCamera(c, this.canvas.width, this.canvas.height);
    const pass = { camera: c, kind: 'color', colorViews: [this.target.texture.view()], colorFormats: ['rgba16float'], depthView: this.target.depthTexture.view(), depthFormat: 'depth32float' };
    // One collection per frame. Opaque geometry, then the sky where nothing was drawn;
    // with water on screen: a copy of that (colour + depth), the water, then the blended
    // surfaces over it. Without water it stays a single pass.
    const lists = this.renderer.collect(this.scene, pass);
    let water = null;
    for (let i = lists.opaque.length - 1; i >= 0; i--) if (lists.opaque[i].material.userData.water) (water ??= []).push(...lists.opaque.splice(i, 1));
    this.renderer.render(this.scene, { ...pass, items: { opaque: lists.opaque, transparent: water ? [] : lists.transparent }, clearColors: [[0, 0, 0, 1]], clearDepth: 0,
      betweenLists: rp => { if (this.sky.handle.pipeline) this.sky.draw(rp); } });
    if (water) {
      updateWaveTile();
      if (!this.renderer.precompiling) {
        const enc = GPU.getEncoder(), size = [this.target.width, this.target.height];
        enc.copyTextureToTexture({ texture: this.target.texture.getGPU() }, { texture: this.copy.texture.getGPU() }, size);
        enc.copyTextureToTexture({ texture: this.target.depthTexture.getGPU() }, { texture: this.copy.depthTexture.getGPU() }, size);
      }
      this.renderer.render(this.scene, { ...pass, label: 'complex water', items: { opaque: water, transparent: lists.transparent } });
    }
    this.renderer.precompiling = false;
    if (this.shown) this.finish.render({ colorViews: [this.context.getCurrentTexture().createView()] });
    GPU.submit();
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
    this.context.unconfigure();
    this.canvas.remove();
    for (const mat of this.materials.values()) { mat.dispose(); mat.uniformBlock.buffer?.destroy(); }
    for (const tex of this.textures.values()) tex.destroy();
    // Also detaches disposal listeners from CPU geometry shared by later views.
    this.renderer.dispose();
    this.target.textures.forEach(t => t.destroy()); this.target.depthTexture.destroy();
    this.copy?.textures.forEach(t => t.destroy()); this.copy?.depthTexture.destroy();
    this.renderer.pipelines.clear(); this.materials.clear(); this.textures.clear(); this.meshes.clear();
  }
}
