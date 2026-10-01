import { GPU } from '../../vendor/tidewater/engine/gpu/GPU.js';
import { generateMipmaps } from '../../vendor/tidewater/engine/gpu/Mipmaps.js';

// Painted maps repacked on the GPU into fewer, smaller textures (the complex view's
// facades hold most of its texture memory): each source image goes up once into a
// temporary texture, a fullscreen pass writes the channels that are actually read into
// the target's top level, then its mips. The temporaries go after the frame's submit.
//
//   packInto(target, [{ img, flipY }, …], 'vec4f(A.x, A.y, B.y, B.z)')
//
// A, B: the texels of the first and second source (exact texel, no filtering).

const pipelines = new Map();

function descFor(format, body, count) {
  const names = ['A', 'B'].slice(0, count);
  const module = GPU.device.createShaderModule({ label: 'texture pack', code: /* wgsl */`
    @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
      let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
      return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
    }
    ${names.map((n, i) => `@group(0) @binding(${i}) var src${n}: texture_2d<f32>;`).join('\n')}
    @fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
      let at = vec2i(pos.xy);
      ${names.map(n => `let ${n} = textureLoad(src${n}, at, 0);`).join(' ')}
      return ${body};
    }
  ` });
  return {
    label: 'texture pack ' + format,
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  };
}
function pipelineFor(format, body, count) {
  const key = `${format}|${count}|${body}`;
  let p = pipelines.get(key);
  if (p) return p;
  // (made on the spot only when not warmed ahead: see warmPack)
  p = GPU.device.createRenderPipeline(descFor(format, body, count));
  pipelines.set(key, p);
  return p;
}
/** The packs the view uses made ahead, asynchronously: a synchronous compile held the browser's
 * GPU process (and the page's frames) ~20 ms. */
export function warmPack(format, body, count) {
  const key = `${format}|${count}|${body}`;
  if (pipelines.has(key)) return;
  GPU.device.createRenderPipelineAsync(descFor(format, body, count)).then(p => { if (!pipelines.has(key)) pipelines.set(key, p); }, () => {});
}

/** Fill `target` (a Texture with 'render' usage, the sources' size) from the images. */
export function packInto(target, sources, body) {
  const size = [target.width, target.height];
  const temps = sources.map(({ img, flipY }) => {
    const t = GPU.device.createTexture({
      label: 'pack source', size, format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    GPU.queue.copyExternalImageToTexture({ source: img, flipY }, { texture: t }, size);
    return t;
  });
  const pipeline = pipelineFor(target.format, body, sources.length);
  const bind = GPU.device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: temps.map((t, i) => ({ binding: i, resource: t.createView() })),
  });
  const enc = GPU.getEncoder();
  const pass = enc.beginRenderPass({
    label: 'texture pack',
    colorAttachments: [{ view: target.getGPU().createView({ baseMipLevel: 0, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bind);
  pass.draw(3);
  pass.end();
  generateMipmaps(target, enc);
  GPU.onSubmit(null, () => temps.forEach(t => t.destroy()));
}
