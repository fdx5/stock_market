import { GPU } from '../../vendor/tidewater/engine/gpu/GPU.js';
import { Texture } from '../../vendor/tidewater/engine/gpu/Texture.js';
import { generateMipmaps } from '../../vendor/tidewater/engine/gpu/Mipmaps.js';

// Painted colour maps compressed to BC7 on the GPU, as they are uploaded: a quarter of the
// memory, and sampled faster. One compute thread per 4x4 block, BC7 mode 6 (one RGBA
// line, 7-bit endpoints with p-bits, 16 steps along it): the principal axis of the block's
// colours, endpoints refined by least squares, both p-bits tried. On the facades' flat
// paint, glazing and lit windows it measures 48–65 dB against the source (scripts: see
// the review notes); maps with independent channels (normals + roughness) stay as they are.
//
//   encodeBC7(image, { flipY, srgb }) -> Texture (bc7-rgba-unorm[-srgb], full mip chain)

export const BC7_WGSL = // (exported for tests)
  /* wgsl */`
struct Params { bw: u32, bh: u32, stride: u32, w: u32, h: u32 };
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> outb: array<u32>;
@group(0) @binding(2) var<uniform> p: Params;

const WEIGHTS = array<f32, 16>(0.0, 4.0, 9.0, 13.0, 17.0, 21.0, 26.0, 30.0, 34.0, 38.0, 43.0, 47.0, 51.0, 55.0, 60.0, 64.0);

fn quantize(v: vec4f, pbit: f32) -> vec4f {
  return clamp(round((v - pbit) * 0.5), vec4f(0.0), vec4f(127.0)) * 2.0 + pbit;
}
fn lerp6(a: vec4f, b: vec4f, k: u32) -> vec4f {
  let w = WEIGHTS[k];
  return floor(((64.0 - w) * a + w * b + 32.0) / 64.0);
}
fn put(bits: ptr<function, array<u32, 4>>, pos: u32, n: u32, v: u32) {
  let word = pos / 32u; let s = pos % 32u;
  (*bits)[word] |= v << s;
  if (s + n > 32u) { (*bits)[word + 1u] |= v >> (32u - s); }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= p.bw || id.y >= p.bh) { return; }
  var px: array<vec4f, 16>;
  var mean = vec4f(0.0); var lo = vec4f(255.0); var hi = vec4f(0.0);
  for (var i = 0u; i < 16u; i++) {
    let at = vec2i(i32(min(id.x * 4u + (i % 4u), p.w - 1u)), i32(min(id.y * 4u + (i / 4u), p.h - 1u)));
    let c = round(textureLoad(src, at, 0) * 255.0);
    px[i] = c; mean += c; lo = min(lo, c); hi = max(hi, c);
  }
  mean /= 16.0;
  // Principal axis: power iteration on the covariance, started along the bounding box.
  var cov: mat4x4f = mat4x4f(vec4f(0.0), vec4f(0.0), vec4f(0.0), vec4f(0.0));
  for (var i = 0u; i < 16u; i++) {
    let d = px[i] - mean;
    cov += mat4x4f(d * d.x, d * d.y, d * d.z, d * d.w);
  }
  var axis = hi - lo;
  if (dot(axis, axis) < 1e-4) { axis = vec4f(1.0, 1.0, 1.0, 1.0); }
  for (var it = 0; it < 6; it++) {
    let next = cov * axis;
    let len = length(next);
    if (len < 1e-6) { break; }
    axis = next / len;
  }
  axis = normalize(axis);
  var tmin = 1e9; var tmax = -1e9;
  for (var i = 0u; i < 16u; i++) { let t = dot(px[i] - mean, axis); tmin = min(tmin, t); tmax = max(tmax, t); }
  var e0 = clamp(mean + axis * tmin, vec4f(0.0), vec4f(255.0));
  var e1 = clamp(mean + axis * tmax, vec4f(0.0), vec4f(255.0));

  var bq0 = vec4f(0.0); var bq1 = vec4f(0.0); var bp0 = 0.0; var bp1 = 0.0;
  var idx: array<u32, 16>;
  for (var round = 0; round < 3; round++) {
    // Best p-bit pair for these endpoints, and each texel's step.
    var bestErr = 1e30;
    for (var pb = 0u; pb < 4u; pb++) {
      let p0 = f32(pb & 1u); let p1 = f32(pb >> 1u);
      let q0 = quantize(e0, p0); let q1 = quantize(e1, p1);
      var err = 0.0;
      var sel: array<u32, 16>;
      for (var i = 0u; i < 16u; i++) {
        var be = 1e30; var bk = 0u;
        for (var k = 0u; k < 16u; k++) {
          let d = px[i] - lerp6(q0, q1, k);
          let e = dot(d, d);
          if (e < be) { be = e; bk = k; }
        }
        err += be; sel[i] = bk;
      }
      if (err < bestErr) { bestErr = err; bq0 = q0; bq1 = q1; bp0 = p0; bp1 = p1; idx = sel; }
    }
    if (round == 2 || bestErr == 0.0) { break; }
    // Least-squares endpoints for those steps.
    var a2 = 0.0; var ab = 0.0; var b2 = 0.0; var x0 = vec4f(0.0); var x1 = vec4f(0.0);
    for (var i = 0u; i < 16u; i++) {
      let t = WEIGHTS[idx[i]] / 64.0; let s = 1.0 - t;
      a2 += s * s; ab += s * t; b2 += t * t; x0 += s * px[i]; x1 += t * px[i];
    }
    let det = a2 * b2 - ab * ab;
    if (abs(det) < 1e-6) { break; }
    e0 = clamp((b2 * x0 - ab * x1) / det, vec4f(0.0), vec4f(255.0));
    e1 = clamp((a2 * x1 - ab * x0) / det, vec4f(0.0), vec4f(255.0));
  }
  // The first texel's step must have its top bit clear: swap the ends if not.
  if (idx[0] >= 8u) {
    let tq = bq0; bq0 = bq1; bq1 = tq;
    let tp = bp0; bp0 = bp1; bp1 = tp;
    for (var i = 0u; i < 16u; i++) { idx[i] = 15u - idx[i]; }
  }
  var bits = array<u32, 4>(0u, 0u, 0u, 0u);
  put(&bits, 0u, 7u, 64u); // mode 6
  let a = vec4u(bq0 * 0.5); let b = vec4u(bq1 * 0.5);
  put(&bits, 7u, 7u, a.x); put(&bits, 14u, 7u, b.x);
  put(&bits, 21u, 7u, a.y); put(&bits, 28u, 7u, b.y);
  put(&bits, 35u, 7u, a.z); put(&bits, 42u, 7u, b.z);
  put(&bits, 49u, 7u, a.w); put(&bits, 56u, 7u, b.w);
  put(&bits, 63u, 1u, u32(bp0)); put(&bits, 64u, 1u, u32(bp1));
  put(&bits, 65u, 3u, idx[0]);
  for (var i = 1u; i < 16u; i++) { put(&bits, 68u + (i - 1u) * 4u, 4u, idx[i]); }
  let o = id.y * p.stride + id.x * 4u;
  outb[o] = bits[0]; outb[o + 1u] = bits[1]; outb[o + 2u] = bits[2]; outb[o + 3u] = bits[3];
}`;

let pipeline = null, compiling = null, device = null;
/** Compile the encoder in the background (a synchronous compile would stall the page):
 * until it is ready, maps go up uncompressed. */
export function warmBC7() {
  if (!GPU.device || !GPU.features.has('texture-compression-bc')) return;
  if (device !== GPU.device) { device = GPU.device; pipeline = null; compiling = null; }
  compiling ??= GPU.device.createComputePipelineAsync({
    label: 'bc7 encode', layout: 'auto',
    compute: { module: GPU.device.createShaderModule({ label: 'bc7 encode', code: BC7_WGSL }), entryPoint: 'main' },
  }).then(p => { if (device === GPU.device) pipeline = p; }).catch(() => {});
}
const encoder = () => pipeline;

/** Whether `encodeBC7` can run now (a device with BC textures and the encoder compiled,
 * sizes in whole blocks). */
export function canEncodeBC7(img) {
  if (!GPU.device || device !== GPU.device || !pipeline) { warmBC7(); return false; }
  return img?.width >= 4 && img.width % 4 === 0 && img.height % 4 === 0;
}

/** The image as a BC7 texture with its full mip chain. `into`: an existing BC7 Texture of
 * the same size to refill (a repainted canvas). */
export function encodeBC7(img, { flipY = false, srgb = true, into = null, readback = null, staged = null } = {}) {
  // (staged: the source already on the GPU — an rgba8unorm Texture with mips, level 0 filled,
  // taken over and freed here — instead of an image copied in now)
  const width = staged ? staged.width : img.width, height = staged ? staged.height : img.height;
  // Source with mips (the same box filter as every other texture), then each level encoded.
  const staging = staged ?? new Texture({ label: 'bc7 source', width, height, format: 'rgba8unorm', mips: true, usage: ['sample', 'render', 'copyDst'] });
  if (!staged) GPU.queue.copyExternalImageToTexture({ source: img, flipY }, { texture: staging.getGPU() }, [width, height]);
  const enc = GPU.getEncoder();
  generateMipmaps(staging, enc);
  const tex = into ?? new Texture({ label: 'bc7', width, height, format: srgb ? 'bc7-rgba-unorm-srgb' : 'bc7-rgba-unorm', mips: true, usage: ['sample', 'copyDst'] });
  const pipe = encoder();
  const temps = [];
  for (let level = 0; level < staging.mipLevelCount; level++) {
    const w = Math.max(1, width >> level), h = Math.max(1, height >> level);
    const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4);
    const rowBytes = Math.ceil((bw * 16) / 256) * 256;
    const out = GPU.device.createBuffer({ label: 'bc7 blocks', size: rowBytes * bh, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const params = GPU.device.createBuffer({ label: 'bc7 params', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    GPU.queue.writeBuffer(params, 0, new Uint32Array([bw, bh, rowBytes / 4, w, h, 0, 0, 0]));
    const bind = GPU.device.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: staging.getGPU().createView({ baseMipLevel: level, mipLevelCount: 1 }) },
        { binding: 1, resource: { buffer: out } },
        { binding: 2, resource: { buffer: params } },
      ],
    });
    const pass = enc.beginComputePass({ label: 'bc7 encode' });
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(bw / 8), Math.ceil(bh / 8));
    pass.end();
    enc.copyBufferToTexture({ buffer: out, bytesPerRow: rowBytes, rowsPerImage: bh }, { texture: tex.getGPU(), mipLevel: level }, { width: bw * 4, height: bh * 4 });
    temps.push(out, params);
    // (tests: the top level's blocks, packed rows)
    if (readback && level === 0) {
      const read = GPU.device.createBuffer({ size: rowBytes * bh, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      enc.copyBufferToBuffer(out, 0, read, 0, rowBytes * bh);
      GPU.onSubmit(null, () => read.mapAsync(GPUMapMode.READ).then(() => {
        const all = new Uint8Array(read.getMappedRange()), rows = new Uint8Array(bw * 16 * bh);
        for (let y = 0; y < bh; y++) rows.set(all.subarray(y * rowBytes, y * rowBytes + bw * 16), y * bw * 16);
        read.unmap(); read.destroy(); readback(rows);
      }));
    }
  }
  GPU.onSubmit(null, () => { temps.forEach(b => b.destroy()); staging.destroy(); });
  return tex;
}
