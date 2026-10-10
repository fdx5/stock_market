// River and pond surfaces for the native WebGPU complex view.
// Shading follows Tidewater's water (MIT, ../../vendor/tidewater): drawn in its own pass
// after the opaque scene, from a copy of that scene's colour and depth: exact dielectric
// Fresnel, sky + screen-space reflections, a refracted view ray through an absorbing and
// scattering water body, GGX sun glints whose roughness comes from the slope variance the
// pixel cannot resolve. Tidewater's ocean FFT is replaced by a small static slope tile
// (a sparse sum of waves, computed once on the GPU) sampled in three drifting, rotated
// layers; its mips keep the second moments of the slopes (LEAN mapping), so far water turns
// rough and dim instead of sparkling.
// The sea (aSea = 1: OpenStreetMap's coastline, /realestate/water) is the same surface in
// another water: clear, deepening ~1:18 off the shore over sand; a swell three times the
// river's ripples running in to the shore; its crests breaking white in the last ~30 m and
// a line of foam washing up and back at the waterline.
import { GPU } from '../../vendor/tidewater/engine/gpu/GPU.js';
import { Texture } from '../../vendor/tidewater/engine/gpu/Texture.js';
import { generateMipmaps } from '../../vendor/tidewater/engine/gpu/Mipmaps.js';
import { FullscreenPass } from '../../vendor/tidewater/engine/render/FullscreenPass.js';
import { Material } from '../../vendor/tidewater/engine/render/Material.js';
import { ShaderModule } from '../../vendor/tidewater/engine/gpu/Shader.js';
import { Vector3 } from '../../vendor/tidewater/engine/math/index.js';

const TILE = 256;

// Waves with whole wavenumbers on the unit tile (it repeats seamlessly), mostly running with
// the current (+x), a few across it. Slope amplitude falls slowly with wavenumber; the sum
// is normalised to unit mean-square slope (the material sets the actual roughness).
function waveList() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const waves = [];
  for (let i = 0; i < 44; i++) {
    const k = 2 + Math.floor(Math.pow(rnd(), 1.6) * 26);
    const spread = (rnd() - 0.5) * (rnd() < 0.8 ? 1.3 : 3.0);
    const nx = Math.round(Math.cos(spread) * k), ny = Math.round(Math.sin(spread) * k);
    if (!nx && !ny) continue;
    waves.push([nx, ny, Math.pow(Math.hypot(nx, ny), -0.35) * (0.6 + rnd() * 0.8), rnd() * Math.PI * 2]);
  }
  // Mean square slope of the sum: half the sum of squared slope amplitudes.
  const ms = waves.reduce((s, [, , a]) => s + a * a * 0.5, 0);
  return waves.map(([nx, ny, a, p]) => [nx, ny, a / Math.sqrt(ms), p]);
}

const f = x => Number(x).toFixed(6);
const tileCode = /* wgsl */`
fn fragment(in: FSIn) -> vec4f {
  let p = in.uv * 6.28318531;
  var g = vec2f(0.0);
${waveList().map(([nx, ny, a, ph]) => `  g += vec2f(${f(nx)}, ${f(ny)}) * (${f(-a / Math.hypot(nx, ny))} * sin(${f(nx)} * p.x + ${f(ny)} * p.y + ${f(ph)}));`).join('\n')}
  // slopes and their squares: averaged by the mips, E[s^2] - E[s]^2 is the variance a
  // coarser texel hides
  return vec4f(g, g * g);
}`;

let tile = null;
let tilePass = null;
let foamTile = null;
let foamPass = null;
// A seamless cellular foam mask, drawn once. R: thin bubble walls, G: coverage.
// Unlike low-frequency wave slopes, it retains holes within a breaking crest.
const foamCode = /* wgsl */`
fn foamHash(p: vec2f) -> vec2f {
  let a = fract(p / 32.0) * 32.0;
  return fract(sin(vec2f(dot(a, vec2f(127.1, 311.7)), dot(a, vec2f(269.5, 183.3)))) * 43758.5453);
}
fn fragment(in: FSIn) -> vec4f {
  let q = in.uv * 32.0; let cell = floor(q); let f = fract(q);
  var d1 = 10.0; var d2 = 10.0;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let b = vec2f(f32(x), f32(y)); let h = foamHash(cell + b);
    let r = b + 0.15 + h * 0.7 - f; let d = length(r);
    if (d < d1) { d2 = d1; d1 = d; } else { d2 = min(d2, d); }
  } }
  let wall = 1.0 - smoothstep(0.035, 0.13, d2 - d1);
  let small = 1.0 - smoothstep(0.05, 0.14, d1);
  let broad = q / 4.0; let ib = floor(broad); let fb = fract(broad);
  let ub = fb * fb * (3.0 - 2.0 * fb);
  // Continuous periodic coverage: a hard random value per cell made square
  // foam patches visible from a low drone camera.
  let coverage = mix(mix(foamHash(ib * 4.0).x, foamHash((ib + vec2f(1.0, 0.0)) * 4.0).x, ub.x),
    mix(foamHash((ib + vec2f(0.0, 1.0)) * 4.0).x, foamHash((ib + vec2f(1.0)) * 4.0).x, ub.x), ub.y);
  return vec4f(max(wall, small * 0.65), coverage, 0.0, 1.0);
}`;
function foamTexture() {
  if (!foamTile) {
    foamTile = new Texture({ label: 'coastal foam cells', width: TILE, height: TILE, format: 'rgba8unorm', mips: true, usage: ['sample', 'render', 'copyDst'] });
    foamTile.ready = false;
    foamPass = new FullscreenPass({ label: 'coastal foam cells', code: foamCode, colorFormats: ['rgba8unorm'] });
  }
  return foamTile;
}
/** The shared slope tile; rendered on the first frame its pipeline is ready. */
export function waveTile() {
  if (tile) return tile;
  tile = new Texture({ label: 'water slopes', width: TILE, height: TILE, format: 'rgba16float', mips: true, usage: ['sample', 'render', 'copyDst'] });
  tile.ready = false;
  tilePass = new FullscreenPass({ label: 'water slope tile', code: tileCode, colorFormats: ['rgba16float'] });
  return tile;
}
export function updateWaveTile() {
  if (foamTile && !foamTile.ready && foamPass.handle.pipeline) {
    foamPass.render({ colorViews: [foamTile.view({ baseMipLevel: 0, mipLevelCount: 1 })] });
    generateMipmaps(foamTile); foamTile.ready = true;
  }
  if (!tile || tile.ready || !tilePass.handle.pipeline) return;
  tilePass.render({ colorViews: [tile.view({ baseMipLevel: 0, mipLevelCount: 1 })] });
  generateMipmaps(tile);
  tile.ready = true;
}

// Fresnel and GGX helpers: Tidewater ocean/WaterMaterial.js.
const helpers = new ShaderModule({ name: 'complexWaterHelpers', code: /* wgsl */`
fn waterFresnel(cosI: f32, eta: f32) -> f32 {
  let c = clamp(cosI, 0.0, 1.0);
  let g2 = eta * eta - 1.0 + c * c;
  let g = sqrt(max(g2, 0.0));
  let a = (g - c) / (g + c);
  let b = (c * (g + c) - 1.0) / (c * (g - c) + 1.0);
  return select(0.5 * (a * a) * (b * b + 1.0), 1.0, g2 < 0.0);
}
fn waterPhaseHG(cosT: f32, g: f32) -> f32 {
  let g2 = g * g;
  return ((1.0 - g2) / (4.0 * PI)) / pow(max(1.0 + g2 - cosT * 2.0 * g, 1e-4), 1.5);
}
fn waterDGGX(NdH: f32, a2: f32) -> f32 { let d = NdH * NdH * (a2 - 1.0) + 1.0; return a2 / (d * d * PI); }
fn waterVSmith(NdL: f32, NdV: f32, a2: f32) -> f32 {
  let gv = NdL * sqrt(NdV * NdV * (1.0 - a2) + a2);
  let gl = NdV * sqrt(NdL * NdL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-5);
}
fn waterProject(pV: vec3f) -> vec2f {
  let c = frame.proj * vec4f(pV, 1.0);
  let n = c.xy / max(c.w, 1e-4);
  return vec2f(n.x * 0.5 + 0.5, 0.5 - n.y * 0.5);
}
fn waterDepthAt(uv: vec2f) -> f32 {
  let size = vec2f(textureDimensions(waterSceneDepth));
  return textureLoad(waterSceneDepth, vec2i(clamp(uv, vec2f(0.0), vec2f(0.9999)) * size), 0).x;
}
// linear view z (negative) of the opaque scene at uv
fn waterSceneZ(uv: vec2f) -> f32 { return -viewDepth(waterDepthAt(uv)); }

// Screen-space reflection (Tidewater _waterSSR, rescaled from a bay to a city block):
// geometric steps through the depth copy, then a bisection. Returns (colour, weight).
fn waterSSR(posV: vec3f, Rv: vec3f, y0: f32, wobble: vec2f) -> vec4f {
  var hit = false;
  let stepScale = max(-posV.z / 60.0, 1.0);
  var t = 0.2 * stepScale;
  var dt = 0.3 * stepScale;
  var prevT = 0.0;
  for (var i = 0; i < 18; i++) {
    prevT = t;
    if (prevT >= 1600.0) { break; }
    t += dt;
    dt *= 1.4;
    let p = posV + Rv * t;
    let uv = waterProject(p);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || p.z > -0.1) { break; }
    let sz = waterSceneZ(uv);
    if (p.z < sz && sz - p.z < max(dt * 1.3, max(t * 0.08, 0.4))) { hit = true; break; }
  }
  if (!hit) { return vec4f(0.0); }
  var a = prevT; var b = t;
  for (var k = 0; k < 5; k++) {
    let m = (a + b) * 0.5;
    let behind = (posV + Rv * m).z < waterSceneZ(waterProject(posV + Rv * m));
    b = select(b, m, behind);
    a = select(m, a, behind);
  }
  let hitV = posV + Rv * b;
  let uv = waterProject(hitV);
  // a ray that only passed far behind a thin object is no hit
  let gap = abs(waterSceneZ(uv) - hitV.z);
  let touch = smoothstep(max(b * 0.05, 0.6), max(b * 0.02, 0.25), gap);
  let edge = smoothstep(0.0, 0.07, uv.x) * smoothstep(1.0, 0.93, uv.x) * smoothstep(0.0, 0.07, uv.y) * smoothstep(1.0, 0.93, uv.y);
  let facing = smoothstep(0.5, 0.1, Rv.z);
  // nothing at the water's own level is reflected (the banks' ground: false hits)
  let hitY = (frame.invView * vec4f(hitV, 1.0)).y;
  // A facet tilted by s turns the reflected ray by 2s: at the hit, b metres on, that is a
  // shift of 2s·b seen from b + the camera distance (uv, capped).
  let shift = clamp(wobble * (2.0 * b / (b - posV.z)), vec2f(-0.06), vec2f(0.06));
  let col = textureSampleLevel(waterSceneColor, smpLinearClamp, clamp(uv + shift, vec2f(0.0), vec2f(1.0)), 0.0).rgb;
  return vec4f(col, edge * facing * touch * smoothstep(1600.0, 900.0, b) * smoothstep(y0 + 0.3, y0 + 1.5, hitY));
}` });

/**
 * The water material. `atmosphere` provides skyBase / skyClouds (ComplexRenderer.js);
 * `scene` is the render target copied after the opaque pass. Quality: ssr (screen-space
 * reflections), clouds (clouds in the reflected sky).
 */
export function waterMaterial({ atmosphere, scene, quality }) {
  const mat = new Material({
    name: 'complex water',
    lit: false,
    modules: [atmosphere, helpers],
    attributes: { aShore: 'f32', aFlow: 'vec2f', aSea: 'f32' },
    varyings: { vShore: 'f32', vFlow: 'vec2f', vSea: 'f32' },
    defines: { IS_WATER: 1, WATER_SSR: quality.ssr ? 1 : 0, WATER_CLOUDS: quality.clouds ? 1 : 0 },
    uniforms: {
      haze: ['f32', 0.0005],
      // Urban river: silt-laden, greenish; per metre.
      absorb: ['vec3f', new Vector3(0.52, 0.26, 0.25)],
      scatter: ['vec3f', new Vector3(0.09, 0.12, 0.12)],
      slope: ['f32', 0.05],
      maxDepth: ['f32', 2.6],
    },
    bindings: {
      waterWaves: { texture: waveTile() },
      waterFoam: { texture: foamTexture() },
      waterSceneColor: { texture: () => scene.textures[0] },
      waterSceneDepth: { texture: () => scene.depthTexture, sampleType: 'unfilterable-float' },
    },
    vertex: 'o.vShore = v.aShore; o.vFlow = v.aFlow; o.vSea = v.aSea;',
    output: WATER_OUTPUT,
  });
  mat.lightingHooks = false;
  mat.userData.water = true;
  return mat;
}

const WATER_OUTPUT = /* wgsl */`
  let P = in.P;
  let screenUV = in.pixel * frame.invResolution;
  let toCam = frame.cameraPos - P;
  let dist = length(toCam);
  let V = toCam / dist;
  let shore = in.vs.vShore;
  let sea = clamp(in.vs.vSea, 0.0, 1.0);
  // A rotating frame multiplied by world position stretches waves into coastal streaks.
  // All sea patches share one swell frame; shore-distance alone bends the breaking crests.
  let flow = normalize(mix(in.vs.vFlow, vec2f(-0.6, 0.8), sea) + vec2f(1e-5, 0.0));
  let side = vec2f(-flow.y, flow.x);
  // metres along / across the channel (the sea: in units of its longer swell, slower)
  let swell = mix(1.0, 3.2, sea);
  let q = vec2f(dot(P.xz, flow), dot(P.xz, side)) / swell;
  let t = frame.time / mix(1.0, 1.7, sea);
  let footprint = max(length(fwidth(q)), 1e-4);

  // Three layers of one slope tile: sizes, turns and drift (current + phase speed) differ,
  // so the pattern never repeats or slides as one sheet. Sampled in uniform control flow.
  let c1 = 0.8253; let s1 = 0.5646;   // 34.4 deg
  let c2 = 0.4536; let s2 = -0.8912;  // -63 deg
  let q2 = vec2f(c1 * q.x - s1 * q.y, s1 * q.x + c1 * q.y);
  let q3 = vec2f(c2 * q.x - s2 * q.y, s2 * q.x + c2 * q.y);
  let w1 = textureSample(waterWaves, smpAnisoRepeat, (q + vec2f(t * 0.62, 0.0)) / 13.0);
  let w2 = textureSample(waterWaves, smpAnisoRepeat, (q2 + vec2f(t * 0.41, t * 0.06)) / 5.3);
  let w3 = textureSample(waterWaves, smpAnisoRepeat, (q3 + vec2f(t * 0.26, -t * 0.05)) / 1.9);
  // calmer against the banks; the finest ripples only where a pixel can show them
  let calm = mix(mix(0.35, 1.0, smoothstep(0.0, 4.0, shore)), mix(0.85, 1.0, smoothstep(0.0, 12.0, shore)), sea);
  let near3 = smoothstep(0.09, 0.025, footprint);
  let slopeK = mix(mat.slope, 0.082, sea);
  let a1 = slopeK * calm; let a2 = slopeK * 0.75 * calm; let a3 = slopeK * 0.6 * calm;
  // back from each layer's turned frame into the channel frame
  let g2 = vec2f(c1 * w2.x + s1 * w2.y, -s1 * w2.x + c1 * w2.y);
  let g3 = vec2f(c2 * w3.x + s2 * w3.y, -s2 * w3.x + c2 * w3.y);
  let gq = w1.xy * a1 + g2 * a2 + g3 * (a3 * near3);
  let gW = gq.x * flow + gq.y * side;
  // unresolved slope variance (LEAN): what the mips averaged away, and the faded layer
  let v1 = max(w1.zw - w1.xy * w1.xy, vec2f(0.0));
  let v2 = max(w2.zw - w2.xy * w2.xy, vec2f(0.0));
  let v3 = max(w3.zw - w3.xy * w3.xy, vec2f(0.0));
  let variance = (v1.x + v1.y) * a1 * a1 + (v2.x + v2.y) * a2 * a2 + ((v3.x + v3.y) * near3 + (1.0 - near3)) * a3 * a3;
  // Specular anti-aliasing (Kaplanyan & Hoffman): slopes that change between neighbouring
  // pixels are unresolvable; their spread joins the roughness, and the reflected direction
  // uses the slope with that spread filtered out (no TAA here to average the noise).
  let dG = fwidth(gW);
  let aa = min(dot(dG, dG), 0.08);
  let varAll = variance + aa * 0.5;
  let gR = gW / (1.0 + aa * 150.0);
  let N = normalize(vec3f(-gR.x, 1.0, -gR.y));
  let alpha2 = 0.0008 + varAll * 2.0;

  let NdV = max(dot(N, V), 1e-4);
  let F = waterFresnel(NdV, 1.333);
  let L = frame.sunDir;
  let sunLight = frame.sunColor * sunShadow(P, vec3f(0.0, 1.0, 0.0), in.pixel);

  // ---- reflection: sky (with its clouds), then the city from the screen
  let Rraw = reflect(-V, N);
  // unresolved facets tilt the mean reflection up toward the darker sky (Tidewater)
  let Rup = max(Rraw.y, 0.004) + sqrt(varAll) * 1.3 * (1.0 - max(Rraw.y, 0.0));
  let R = normalize(vec3f(Rraw.x, Rup, Rraw.z));
#if WATER_CLOUDS
  var sky = skyClouds(R);
#else
  var sky = skyBase(R);
#endif
  var refl = mix(frame.horizonColor * 0.35, sky, smoothstep(-0.12, 0.08, Rraw.y));
  let posV = (frame.view * vec4f(P, 1.0)).xyz;
#if WATER_SSR
  // Estimated coastal terrain produces false reflected blocks at the sand/water
  // contact. In breaking shallows use the continuous sky reflection; restore city
  // reflections smoothly beyond the surf, without changing rivers or open sea.
  let coastReflection = mix(1.0, smoothstep(36.0, 80.0, shore), sea);
  if (F > 0.03 && coastReflection > 0.0) {
    // Marched off the mean (flat) surface: per-pixel ripples would send neighbouring rays
    // past different edges (speckle, with no temporal filter to average it). The ripples
    // distort the image instead, like a rippled mirror: a screen offset along the tilt.
    let Rv = normalize((frame.view * vec4f(reflect(-V, vec3f(0.0, 1.0, 0.0)), 0.0)).xyz);
    if (Rv.z < 0.5) {
      let tilt = (frame.view * vec4f(N.x, 0.0, N.z, 0.0)).xy;
      let hit = waterSSR(posV, Rv, P.y, tilt * vec2f(frame.proj[0][0], -frame.proj[1][1]) * 0.5);
      refl = mix(refl, hit.rgb, hit.a * coastReflection);
    }
  }
#endif

  // ---- sun glint (GGX; the sun light carries its shadow)
  let H = normalize(L + V);
  let NdL = max(dot(N, L), 0.0);
  let spec = waterDGGX(max(dot(N, H), 0.0), alpha2) * waterVSmith(NdL, NdV, alpha2) * waterFresnel(max(dot(V, H), 0.0), 1.333) * NdL;
  let glint = sunLight * min(spec, 60.0);

  // ---- the water body along the refracted view ray
  // No survey of the bed exists: a bank sloping ~1:3 to a modest depth, so the shallows
  // show the ground and the channel reads deep.
  let depth = mix(min(mat.maxDepth, shore * 0.33), min(28.0, 0.2 + shore * 0.055), sea);
  let Tr = refract(-V, N, 1.0 / 1.333);
  let Tv = normalize(vec3f(Tr.x, min(Tr.y, -0.08), Tr.z));
  let pathLen = depth / max(-Tv.y, 0.06);
  // the ground seen through it, displaced along the refracted ray (only if it lies behind)
  let pEndV = (frame.view * vec4f(P + Tv * min(pathLen, 12.0), 1.0)).xyz;
  let uvR = waterProject(pEndV);
  let onScreen = all(uvR > vec2f(0.0)) && all(uvR < vec2f(1.0));
  let valid = onScreen && waterSceneZ(uvR) < posV.z - 0.05;
  let uvBed = select(screenUV, uvR, valid);
  // wet silt: the painted bank ground, darkened
  let bedRaw = textureSampleLevel(waterSceneColor, smpLinearClamp, uvBed, 0.0).rgb;
  // The open sea has no surveyed bed. A constant lit sand estimate must replace the
  // opaque terrain tiles below it: their presence/absence otherwise paints a grid in the sea.
  // Keep the actual ground colour in the coastal shallows.
  let bedLight = frame.skyIrradiance * 0.48 + frame.sunColor * max(L.y, 0.0) * 0.22;
  let shallowSand = vec3f(0.58, 0.52, 0.38) * bedLight;
  let deepSand = vec3f(0.39, 0.43, 0.38) * bedLight;
  let bedSea = mix(shallowSand, deepSand, smoothstep(0.4, 7.0, depth));
  let bed = mix(bedRaw * vec3f(0.62, 0.6, 0.52), bedSea, sea);
  // (clear coastal water: red goes first, then green; a little blue-green scattering)
  let sigA = mix(mat.absorb, vec3f(0.38, 0.085, 0.055), sea); let sigS = mix(mat.scatter, vec3f(0.012, 0.030, 0.038), sea); let sigT = sigA + sigS;
  let Tview = exp(-sigT * pathLen);
  // single scattering (sun, Henyey-Greenstein) + ambient, integrated analytically
  let Ls = -refract(-L, vec3f(0.0, 1.0, 0.0), 1.0 / 1.333);
  let muS = max(Ls.y, 0.1);
  let muV = max(-Tv.y, 0.15);
  let sunIn = sunLight * (1.0 - waterFresnel(max(L.y, 0.02), 1.333));
  let kSun = sigT * (1.0 + muV / muS);
  let kAmb = sigT * (1.0 + muV / 0.75);
  let phase = waterPhaseHG(dot(Tv, Ls), 0.8) * 0.7 + 0.0239;
  let inSun = sunIn * sigS * phase * (1.0 - exp(-kSun * pathLen)) / kSun;
  let inAmb = frame.skyIrradiance * sigS * 0.5 * (1.0 - exp(-kAmb * pathLen)) / kAmb;
  let transmitted = bed * Tview + inSun + inAmb;

  var col = mix(transmitted, refl, F) + glint;
  // The sea's surf: crests running in (along the flow, toward the shore) break white in the last
  // ~30 m, torn by the swell; the swash line at the water's edge comes and goes.
  let foamUV = P.xz / 8.0 + flow * frame.time * 0.012;
  let foamLOD = max(0.0, log2(max(length(fwidth(foamUV)) * 256.0, 1.0)));
  let shoreAA = max(fwidth(shore), 0.08);
  var foam = 0.0;
  if (sea > 0.5 && shore < 36.0) {
    // Explicit LOD keeps this narrow coastal branch legal and antialiased.
    let cells = textureSampleLevel(waterFoam, smpAnisoRepeat, foamUV, foamLOD).rg;
    let patchiness = clamp(0.6 + w1.y * 0.14 + w2.x * 0.12, 0.2, 1.0);
    let phase = fract(shore / 11.5 + frame.time * 0.13 + w1.x * 0.025);
    let aaPhase = min(0.06, shoreAA / 11.5);
    let front = 1.0 - smoothstep(0.018, 0.06 + aaPhase, min(phase, 1.0 - phase));
    let wake = smoothstep(0.015, 0.06 + aaPhase, phase) * (1.0 - smoothstep(0.09, 0.29, phase));
    let surf = (1.0 - smoothstep(16.0, 36.0, shore)) * smoothstep(0.0, 0.65, shore);
    let lace = cells.r * mix(0.38, 0.85, cells.g);
    let broken = smoothstep(0.12, 0.62, cells.g);
    let breaking = (front * (0.06 + 0.94 * lace) + wake * lace * 0.72) * broken * patchiness * surf;
    let reach = 0.9 + 0.85 * (0.5 + 0.5 * sin(frame.time * 0.85 + w1.x * 0.15));
    let swash = (1.0 - smoothstep(reach, reach + 0.5 + shoreAA, shore)) * (0.2 + 0.7 * lace);
    foam = clamp(breaking + swash, 0.0, 0.94);
  }
  let foamLit = (sunLight * max(L.y, 0.0) + frame.skyIrradiance) * 0.46;
  col = mix(col, foamLit, foam);
  // haze, as on every other surface
  let fog = 1.0 - exp(-dist * mat.haze);
  col = mix(col, frame.horizonColor, clamp(fog, 0.0, 0.9));
  // the waterline: into the ground within the first metre (no hard polygon edge)
  let ground = textureSampleLevel(waterSceneColor, smpLinearClamp, screenUV, 0.0).rgb;
  // Sea shallows meet damp sand. Sampling lawn-painted terrain here leaked green
  // triangles into the surf, especially when coarse shore distance became zero.
  let edgeBed = mix(ground * 0.8, shallowSand * 0.85, sea);
  col = mix(edgeBed, col, smoothstep(0.0, 0.65, shore));
  r.color = vec4f(min(col, vec3f(64.0)), 1.0);
`;
