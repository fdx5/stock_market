import { MOODS, type Mood } from "./pulseHorizonShaders";
import type { PulseHorizonController } from "./pulseHorizonRenderer";
import {
  ASSEMBLE_FRAGMENT, EVOLVE_FRAGMENT, FFT_FRAGMENT, FOAM_PATTERN_FRAGMENT, FULLSCREEN_VERTEX, OCEAN_FRAGMENT, OCEAN_PULSES,
  OCEAN_VERTEX, SKY_FRAGMENT, SPECTRUM_FRAGMENT, SPRAY_FRAGMENT, SPRAY_VERTEX,
} from "./pulseOceanShaders";

type FxLevel = "full" | "balanced" | "minimal";
type Program = { program: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null>; attribs: Map<string, number> };

const G = 9.81, F = 1.6, CAM_H = 75, SEED = 20261109; // a bridge-height eye: the ship sails below the board, not behind it
/** Cascade sizes in metres: incommensurate so no tiling lines up, and band edges at 6 waves per tile. */
const CASCADES = [733, 97, 17.3];
const CUTS = [0, 2 * Math.PI / CASCADES[1] * 6, 2 * Math.PI / CASCADES[2] * 6, 1e9];
const LOOP = 256;
const BOW_SPRAY = 2400, STERN_SPRAY = 3400;

/** Quality tiers, stepped down automatically when frames run long (resolution never drops). */
const TIERS = [
  { N: 256, gridX: 420, gridY: 260, spray: 14000 },
  { N: 256, gridX: 320, gridY: 200, spray: 9000 },
  { N: 128, gridX: 240, gridY: 160, spray: 5000 },
];

/* ---------------------------------------------------------------- CPU twin for the ship */
function pcg2d(x: number, y: number): [number, number] {
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0; y = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, 1664525)) >>> 0; y = (y + Math.imul(x, 1664525)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0;
  x = (x + Math.imul(y, 1664525)) >>> 0; y = (y + Math.imul(x, 1664525)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0;
  return [x, y];
}
function gauss(n: number, m: number, c: number): [number, number] {
  const [a, b] = pcg2d(((n + 4096) + SEED) >>> 0, (m + 4096 + c * 8192) >>> 0);
  const u1 = Math.max(a / 4294967296, 1e-7), u2 = b / 4294967296, r = Math.sqrt(-2 * Math.log(u1));
  return [r * Math.cos(2 * Math.PI * u2), r * Math.sin(2 * Math.PI * u2)];
}
function jonswap(w: number, wp: number, alpha: number, gamma: number) {
  const s = w <= wp ? .07 : .09, r = Math.exp(-((w - wp) ** 2) / (2 * s * s * wp * wp));
  return alpha * G * G / w ** 5 * Math.exp(-1.25 * (wp / w) ** 4) * gamma ** r;
}
function spreadNorm(s: number) {
  let sum = 0; const steps = 720;
  for (let i = 0; i < steps; i++) { const t = -Math.PI + (i + .5) * 2 * Math.PI / steps; sum += Math.abs(Math.cos(t / 2)) ** (2 * s); }
  return 1 / (sum * 2 * Math.PI / steps);
}
interface Sea { wp: number; alpha: number; s: number; norm: number; swellWp: number; swellAlpha: number; swellS: number; swellNorm: number; wind: [number, number]; swell: [number, number]; scale: number }
function seaFor(windSpeed: number): Sea {
  const fetch = 140000;
  const wind: [number, number] = [Math.cos(.32), Math.sin(.32)];
  const swell: [number, number] = [Math.cos(-.55), Math.sin(-.55)];
  return {
    wp: 22 * Math.cbrt(G * G / (windSpeed * fetch)), alpha: .076 * Math.pow(windSpeed * windSpeed / (fetch * G), .22), s: 5, norm: spreadNorm(5),
    // a long, narrow swell from another storm: the ship's slow heave
    swellWp: Math.sqrt(G * 2 * Math.PI / 190), swellAlpha: .0016 * (windSpeed / 9), swellS: 22, swellNorm: spreadNorm(22),
    wind, swell, scale: 1,
  };
}
function spectrumAt(sea: Sea, n: number, m: number, c: number, N: number): [number, number] {
  if (Math.abs(n) === N / 2 || Math.abs(m) === N / 2) return [0, 0];
  const dk = 2 * Math.PI / CASCADES[c], kx = n * dk, kz = m * dk, k = Math.hypot(kx, kz);
  if (k < 1e-6 || k < CUTS[c] || k >= CUTS[c + 1]) return [0, 0];
  const w = Math.sqrt(G * k), dx = kx / k, dz = kz / k;
  const spread = (d: [number, number], s: number, norm: number) => norm * Math.sqrt(Math.max(0, (1 + dx * d[0] + dz * d[1]) / 2)) ** (2 * s);
  const S = jonswap(w, sea.wp, sea.alpha, 3.3) * spread(sea.wind, sea.s, sea.norm) + jonswap(w, sea.swellWp, sea.swellAlpha, 9) * spread(sea.swell, sea.swellS, sea.swellNorm);
  const amp = Math.sqrt(S * G / (2 * w) / k * Math.exp(-k * k * .0004) * dk * dk * .25) * sea.scale;
  const [g1, g2] = gauss(n, m, c);
  return [g1 * amp, g2 * amp];
}
type Wave = { kx: number; kz: number; w: number; a: [number, number]; b: [number, number] };
/** The strongest long components of cascade 0: enough to move a 300 m hull like the drawn sea. */
function dominantWaves(sea: Sea, N: number, count: number): Wave[] {
  const list: (Wave & { e: number })[] = [];
  const dk = 2 * Math.PI / CASCADES[0], w0 = 2 * Math.PI / LOOP;
  const reach = Math.min(N / 2 - 1, 40);
  for (let m = 0; m <= reach; m++) for (let n = -reach; n <= reach; n++) {
    if (m === 0 && n <= 0) continue;
    const a = spectrumAt(sea, n, m, 0, N), bm = spectrumAt(sea, -n, -m, 0, N), b: [number, number] = [bm[0], -bm[1]];
    const e = a[0] ** 2 + a[1] ** 2 + b[0] ** 2 + b[1] ** 2;
    if (e > 0) list.push({ kx: n * dk, kz: m * dk, w: Math.floor(Math.sqrt(G * Math.hypot(n, m) * dk) / w0) * w0, a, b, e });
  }
  return list.sort((x, y) => y.e - x.e).slice(0, count);
}

/* ---------------------------------------------------------------- palette */
const lin = (c: readonly number[]) => c.map(v => Math.pow(v, 2.2));
function paletteFor(mood: Mood) {
  const m = MOODS[mood];
  const fog = lin(m.fog), band1 = lin(m.band1), band2 = lin(m.band2), hot = lin(m.hot), haze = lin(m.haze);
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
  const scale = (a: number[], s: number) => a.map(v => v * s);
  return {
    zenith: [.0035, .0025, .006],
    horizonCol: mix(scale(fog, 1.2), scale(haze, .16), .5),
    band1: scale(band1, .22), band2: scale(band2, .3), hot: scale(hot, .9),
    sunCol: scale(mix(band2, hot, mood === "down" ? .7 : .25), mood === "down" ? .9 : 1.25),
    deep: mix([.002, .009, .016], scale(fog, .35), .45),
    scatter: mix([.02, .19, .17], scale(band2, .35), .3),
  };
}
type Palette = ReturnType<typeof paletteFor>;
const PALETTE_KEYS = ["zenith", "horizonCol", "band1", "band2", "hot", "sunCol", "deep", "scatter"] as const;
const flatten = (p: Palette) => PALETTE_KEYS.flatMap(key => p[key]);

export function oceanSupported(): boolean {
  try {
    const probe = document.createElement("canvas").getContext("webgl2");
    const ok = !!probe && !!probe.getExtension("EXT_color_buffer_float");
    probe?.getExtension("WEBGL_lose_context")?.loseContext();
    return ok;
  } catch { return false; }
}

/**
 * The pulse board sea as a real ocean. Same controller contract as the ridge renderer,
 * so the ship and the board drive it unchanged.
 */
export function installPulseOcean(canvas: HTMLCanvasElement, level: FxLevel, onFailure: () => void, onRestore: () => void, initial: { mood?: Mood; energy?: number; intensity?: number; horizon?: number } = {}): PulseHorizonController {
  const context = canvas.getContext("webgl2", { alpha: false, antialias: true, depth: true, stencil: false, powerPreference: "high-performance" });
  if (!context) throw new Error("WebGL2 unavailable");
  const gl: WebGL2RenderingContext = context;
  if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("Float render targets unavailable");
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  const coarse = matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) < 700;
  let tier = level === "full" && !coarse ? 0 : coarse ? 2 : 1;
  const N = TIERS[tier].N; // FFT size is fixed for the canvas' life; tiers below only thin geometry and spray
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = reduced.matches;
  const still = () => level === "minimal" || reducedMotion;
  const HORIZON = initial.horizon ?? .3;
  const gain = (initial.intensity ?? 1) * (level === "full" ? 1 : level === "minimal" ? .85 : .95);

  const programs: Program[] = [], buffers: WebGLBuffer[] = [], textures: WebGLTexture[] = [], framebuffers: WebGLFramebuffer[] = [];
  function program(vs: string, fs: string): Program {
    const shaders: WebGLShader[] = [];
    try {
      const linked = gl.createProgram()!;
      for (const [kind, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
        const shader = gl.createShader(kind)!;
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "compile failed");
        gl.attachShader(linked, shader);
      }
      gl.linkProgram(linked);
      if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(linked) || "link failed");
      const result = { program: linked, uniforms: new Map(), attribs: new Map() };
      programs.push(result); return result;
    } finally { shaders.forEach(shader => gl.deleteShader(shader)); }
  }
  const U = (p: Program, name: string) => {
    if (!p.uniforms.has(name)) p.uniforms.set(name, gl.getUniformLocation(p.program, name));
    return p.uniforms.get(name)!;
  };
  const A = (p: Program, name: string) => {
    if (!p.attribs.has(name)) p.attribs.set(name, gl.getAttribLocation(p.program, name));
    return p.attribs.get(name)!;
  };
  function texture2d(w: number, h: number, format: number, filter: number) {
    const t = gl.createTexture()!; textures.push(t);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function array(levels: number) {
    const t = gl.createTexture()!; textures.push(t);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA16F, N, N, 3);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    return t;
  }
  function fbo(attach: (fb: WebGLFramebuffer) => void, count: number) {
    const fb = gl.createFramebuffer()!; framebuffers.push(fb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); attach(fb);
    gl.drawBuffers(count === 2 ? [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1] : [gl.COLOR_ATTACHMENT0]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Incomplete framebuffer");
    return fb;
  }
  function buffer(data: ArrayBufferView, target: number = gl.ARRAY_BUFFER) {
    const b = gl.createBuffer()!; buffers.push(b); gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b;
  }

  let spectrum: Program, evolve: Program, fft: Program, assemble: Program, foamPattern: Program, sky: Program, ocean: Program, spray: Program;
  let quad: WebGLBuffer, h0: WebGLTexture, ping: WebGLTexture[], pong: WebGLTexture[], disp: WebGLTexture[], deriv: WebGLTexture, foamTex: WebGLTexture;
  let h0Fbo: WebGLFramebuffer, pingFbo: WebGLFramebuffer, pongFbo: WebGLFramebuffer, assembleFbo: WebGLFramebuffer[][], foamFbo: WebGLFramebuffer;
  const grids: { vertices: WebGLBuffer; indices: WebGLBuffer; count: number }[] = [];
  let sprayIds: WebGLBuffer;
  const levels = Math.log2(N) + 1;
  const vao = gl.createVertexArray();
  try {
    spectrum = program(FULLSCREEN_VERTEX, SPECTRUM_FRAGMENT);
    evolve = program(FULLSCREEN_VERTEX, EVOLVE_FRAGMENT);
    fft = program(FULLSCREEN_VERTEX, FFT_FRAGMENT);
    assemble = program(FULLSCREEN_VERTEX, ASSEMBLE_FRAGMENT);
    foamPattern = program(FULLSCREEN_VERTEX, FOAM_PATTERN_FRAGMENT);
    sky = program(FULLSCREEN_VERTEX, SKY_FRAGMENT);
    ocean = program(OCEAN_VERTEX, OCEAN_FRAGMENT);
    spray = program(SPRAY_VERTEX, SPRAY_FRAGMENT);
    quad = buffer(new Float32Array([-1, -1, 3, -1, -1, 3]));
    h0 = texture2d(N, N * 3, gl.RGBA32F, gl.NEAREST);
    ping = [texture2d(N, N * 3, gl.RGBA32F, gl.NEAREST), texture2d(N, N * 3, gl.RGBA32F, gl.NEAREST)];
    pong = [texture2d(N, N * 3, gl.RGBA32F, gl.NEAREST), texture2d(N, N * 3, gl.RGBA32F, gl.NEAREST)];
    disp = [array(levels), array(levels)];
    deriv = array(levels);
    foamTex = gl.createTexture()!; textures.push(foamTex);
    gl.bindTexture(gl.TEXTURE_2D, foamTex);
    gl.texStorage2D(gl.TEXTURE_2D, 10, gl.RGBA8, 512, 512);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    h0Fbo = fbo(() => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, h0, 0), 1);
    pingFbo = fbo(() => { gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ping[0], 0); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, ping[1], 0); }, 2);
    pongFbo = fbo(() => { gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pong[0], 0); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, pong[1], 0); }, 2);
    assembleFbo = [0, 1].map(target => [0, 1, 2].map(layer => fbo(() => {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, disp[target], 0, layer);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, deriv, 0, layer);
    }, 2)));
    foamFbo = fbo(() => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, foamTex, 0), 1);
    for (const { gridX, gridY } of TIERS) {
      const vertices = new Float32Array(gridX * gridY * 2);
      for (let y = 0; y < gridY; y++) for (let x = 0; x < gridX; x++) vertices.set([x / (gridX - 1), y / (gridY - 1)], (y * gridX + x) * 2);
      const indices = new Uint32Array((gridX - 1) * (gridY - 1) * 6);
      let i = 0;
      for (let y = 0; y < gridY - 1; y++) for (let x = 0; x < gridX - 1; x++) {
        const a = y * gridX + x, b = a + 1, c = a + gridX, d = c + 1;
        indices.set([a, b, c, b, d, c], i); i += 6;
      }
      grids.push({ vertices: buffer(vertices), indices: buffer(indices, gl.ELEMENT_ARRAY_BUFFER), count: indices.length });
    }
    sprayIds = buffer(Float32Array.from({ length: TIERS[0].spray + BOW_SPRAY + STERN_SPRAY }, (_, index) => index));
  } catch (error) {
    dispose(); throw error;
  }
  gl.bindVertexArray(vao);

  function fullscreen(p: Program) {
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    const loc = A(p, "a_pos"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(loc);
  }
  const bindTex = (unit: number, target: number, t: WebGLTexture) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, t); };

  // Foam lace pattern, once.
  gl.bindFramebuffer(gl.FRAMEBUFFER, foamFbo); gl.viewport(0, 0, 512, 512);
  gl.useProgram(foamPattern.program); gl.uniform1f(U(foamPattern, "u_size"), 512); fullscreen(foamPattern);
  gl.bindTexture(gl.TEXTURE_2D, foamTex); gl.generateMipmap(gl.TEXTURE_2D);
  // Both foam targets start clear.
  for (const target of [0, 1]) for (const layer of [0, 1, 2]) { gl.bindFramebuffer(gl.FRAMEBUFFER, assembleFbo[target][layer]); gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); }

  let windSpeed = 0, sea = seaFor(8), waves: Wave[] = [];
  function setWind(speed: number) {
    if (Math.abs(speed - windSpeed) < .04) return;
    windSpeed = speed; sea = seaFor(speed);
    gl.bindFramebuffer(gl.FRAMEBUFFER, h0Fbo); gl.viewport(0, 0, N, N * 3);
    gl.useProgram(spectrum.program);
    gl.uniform1i(U(spectrum, "u_N"), N);
    gl.uniform1fv(U(spectrum, "u_L[0]"), CASCADES); gl.uniform1fv(U(spectrum, "u_cut[0]"), CUTS);
    gl.uniform4f(U(spectrum, "u_sea"), sea.wp, sea.alpha, sea.s, sea.norm);
    gl.uniform4f(U(spectrum, "u_swell"), sea.swellWp, sea.swellAlpha, sea.swellS, sea.swellNorm);
    gl.uniform4f(U(spectrum, "u_dirs"), sea.wind[0], sea.wind[1], sea.swell[0], sea.swell[1]);
    gl.uniform1f(U(spectrum, "u_scale"), sea.scale); gl.uniform1ui(U(spectrum, "u_seed"), SEED);
    fullscreen(spectrum);
    waves = dominantWaves(sea, N, 28);
  }

  let current = 0, simTime = 0;
  function simulate(time: number, dt: number) {
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.viewport(0, 0, N, N * 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, pingFbo);
    gl.useProgram(evolve.program);
    bindTex(0, gl.TEXTURE_2D, h0); gl.uniform1i(U(evolve, "u_h0"), 0);
    gl.uniform1i(U(evolve, "u_N"), N); gl.uniform1fv(U(evolve, "u_L[0]"), CASCADES); gl.uniform1f(U(evolve, "u_time"), time % LOOP);
    fullscreen(evolve);
    gl.useProgram(fft.program);
    gl.uniform1i(U(fft, "u_N"), N); gl.uniform1i(U(fft, "u_a"), 0); gl.uniform1i(U(fft, "u_b"), 1);
    let src = ping, dst = pongFbo, dstTex = pong;
    for (const vertical of [0, 1]) for (let size = 2; size <= N; size *= 2) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst);
      bindTex(0, gl.TEXTURE_2D, src[0]); bindTex(1, gl.TEXTURE_2D, src[1]);
      gl.uniform1i(U(fft, "u_size"), size); gl.uniform1i(U(fft, "u_vertical"), vertical);
      fullscreen(fft);
      const next = src; src = dstTex; dstTex = next; dst = dst === pongFbo ? pingFbo : pongFbo;
    }
    // unpack each cascade, advancing foam from the previous frame's target
    const previous = current; current ^= 1;
    gl.viewport(0, 0, N, N);
    gl.useProgram(assemble.program);
    bindTex(0, gl.TEXTURE_2D, src[0]); bindTex(1, gl.TEXTURE_2D, src[1]); bindTex(2, gl.TEXTURE_2D_ARRAY, disp[previous]);
    gl.uniform1i(U(assemble, "u_a"), 0); gl.uniform1i(U(assemble, "u_b"), 1); gl.uniform1i(U(assemble, "u_prev"), 2);
    gl.uniform1i(U(assemble, "u_N"), N); gl.uniform1f(U(assemble, "u_lambda"), -(1.3 + (windSpeed - 7) * .06));
    gl.uniform1f(U(assemble, "u_decay"), Math.exp(-dt / 4.2)); gl.uniform2f(U(assemble, "u_foam"), .72, 2.2);
    for (const layer of [0, 1, 2]) { gl.bindFramebuffer(gl.FRAMEBUFFER, assembleFbo[current][layer]); gl.uniform1i(U(assemble, "u_layer"), layer); fullscreen(assemble); }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    bindTex(2, gl.TEXTURE_2D_ARRAY, disp[current]); gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    bindTex(2, gl.TEXTURE_2D_ARRAY, deriv); gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  }

  /* ---------------------------------------------------------------- frame */
  let frame = 0, last = 0, elapsed = 0, disposed = false, lost = false;
  let viewWidth = 0, viewHeight = 0, pixelRatio = 0;
  let windowWidth = innerWidth, windowHeight = innerHeight;
  function measureWindow() { windowWidth = innerWidth; windowHeight = innerHeight; }
  let scrollTarget = 0, scrollSmooth = 0, lastScroll = 0;
  const cam = { x: 0, z: 0, sx: 0, sy: 0, tx: 0, ty: 0, vz: 0 };
  const pulses = Array.from({ length: OCEAN_PULSES }, () => ({ born: -99, x: 0, z: 0, w: 0, beacon: 0 }));
  let nextPulse = 1.2, lastClick = -9, seed = 9;
  const pulseData = new Float32Array(OCEAN_PULSES * 4), beaconData = new Float32Array(OCEAN_PULSES * 4);
  const palette = Float32Array.from(flatten(paletteFor(initial.mood ?? "calm"))), paletteTarget = [...palette];
  let energy = initial.energy ?? 1, energyTarget = energy;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // frame-time governor: sustained long frames step down geometry and spray, never resolution
  let slow = 0, fast = 0;

  const camPos = () => [cam.x + cam.sx * 6, CAM_H + cam.sy * 2.2, cam.z] as const;
  function worldAt(screenX: number, distance: number) {
    const aspect = viewWidth / Math.max(1, viewHeight), [cx, , cz] = camPos();
    return { x: cx + (screenX * 2 - 1) * aspect * distance / F, z: cz + distance };
  }
  function spawn(x: number, z: number, strength: number, beacon: number) {
    const slot = pulses.reduce((oldest, pulse) => pulse.born < oldest.born ? pulse : oldest, pulses[0]);
    Object.assign(slot, { born: elapsed, x, z, w: strength, beacon });
  }
  function onPointerMove(event: PointerEvent) { cam.tx = (event.clientX / windowWidth - .5) * 2; cam.ty = (event.clientY / windowHeight - .5) * 2; }
  function onPointerDown(event: PointerEvent) {
    if (still() || elapsed - lastClick < .7) return;
    const y = 1 - event.clientY / innerHeight * 2;
    if (y > HORIZON - .02) return;
    lastClick = elapsed;
    const d = Math.min(1400, CAM_H * F / (HORIZON - y));
    const p = worldAt(event.clientX / innerWidth, d);
    spawn(p.x, p.z, .45, 0);
  }
  function onScroll(event: Event) { const target = event.target; scrollTarget = target instanceof Element ? target.scrollTop : scrollY; }

  let paletteVersion = 1;
  const paletteSent = new Map<Program, number>();
  function setPalette(p: Program) {
    // uniforms persist per program: skip the upload when nothing changed since this program's last one
    if (paletteSent.get(p) === paletteVersion) return;
    paletteSent.set(p, paletteVersion);
    PALETTE_KEYS.forEach((key, index) => { const loc = U(p, `u_${key}`); if (loc) gl.uniform3fv(loc, palette, index * 3, 3); });
    const sun = U(p, "u_sunDir"); if (sun) { const v = [.36, .045, 1], l = Math.hypot(...v); gl.uniform3f(sun, v[0] / l, v[1] / l, v[2] / l); }
    const intensity = U(p, "u_intensity"); if (intensity) gl.uniform1f(intensity, gain);
  }
  let ship: { x: number; z: number; heading: number; speed: number; half: number; beam: number } | null = null;
  function setCamera(p: Program) {
    gl.uniform4f(U(p, "u_ship"), ship?.x ?? 0, ship?.z ?? 0, Math.cos(ship?.heading ?? 0), Math.sin(ship?.heading ?? 0));
    gl.uniform1f(U(p, "u_wakeTime"), simTime);
    gl.uniform4f(U(p, "u_shipInfo"), ship?.speed ?? 0, ship?.half ?? 105, ship?.beam ?? 21, ship ? 1 : 0);
    const [cx, cy, cz] = camPos();
    gl.uniform3f(U(p, "u_cam"), cx, cy, cz);
    gl.uniform1f(U(p, "u_F"), F); gl.uniform1f(U(p, "u_horizon"), HORIZON);
    gl.uniform1f(U(p, "u_aspect"), viewWidth / Math.max(1, viewHeight));
    gl.uniform2f(U(p, "u_res"), canvas.width, canvas.height);
    gl.uniform1fv(U(p, "u_L[0]"), CASCADES); gl.uniform1f(U(p, "u_texel"), N);
  }

  function draw(now: number) {
    frame = 0;
    if (disposed || lost || document.hidden) return;
    const dt = last ? Math.min(.05, (now - last) / 1000) : 1 / 60;
    if (last && !still()) {
      const ms = now - last;
      if (ms > 21 && ms < 200) { slow++; fast = 0; } else if (ms < 17.5) { fast++; slow = Math.max(0, slow - 1); }
      if (slow > 90 && tier < TIERS.length - 1) { tier++; slow = 0; }
      if (fast > 900 && tier > (level === "full" && !coarse ? 0 : 1)) { tier--; fast = 0; }
    }
    last = now;
    if (!still()) elapsed += dt;
    if (viewWidth !== windowWidth || viewHeight !== windowHeight || pixelRatio !== (devicePixelRatio || 1)) {
      viewWidth = windowWidth; viewHeight = windowHeight; pixelRatio = devicePixelRatio || 1;
      canvas.width = Math.round(viewWidth * pixelRatio); canvas.height = Math.round(viewHeight * pixelRatio);
    }
    const ease = 1 - Math.exp(-dt * 1.8);
    scrollSmooth += (scrollTarget - scrollSmooth) * ease;
    const scrollDelta = scrollSmooth - lastScroll; lastScroll = scrollSmooth;
    cam.vz = 1.6 + scrollDelta * .9 / Math.max(dt, 1e-3) * .02;
    cam.z += cam.vz * dt;
    cam.sx += (cam.tx - cam.sx) * (1 - Math.exp(-dt * .8));
    cam.sy += (cam.ty - cam.sy) * (1 - Math.exp(-dt * .8));
    if (!still() && elapsed > nextPulse) {
      const p = worldAt(.12 + random() * .76, 380 + random() * 260);
      spawn(p.x, p.z, .8 + random() * .25, 1);
      nextPulse = elapsed + 8.5 + random() * 4.5;
    }
    if (still() && pulses.every(pulse => pulse.w === 0)) { const p = worldAt(.62, 420); spawn(p.x, p.z, 1, 1); pulses[0].born = elapsed - 3.2; }
    const glide = still() ? 1 : 1 - Math.exp(-dt * 1.6);
    let moved = false;
    for (let i = 0; i < palette.length; i++) { const next = Math.fround(palette[i] + (paletteTarget[i] - palette[i]) * glide); if (next !== palette[i]) { palette[i] = next; moved = true; } }
    if (moved) paletteVersion++;
    energy += (energyTarget - energy) * (still() ? 1 : 1 - Math.exp(-dt * .7));
    setWind(7 + (energy - .78) * 11);

    simTime = still() ? 41 : elapsed + 30;
    simulate(simTime, still() ? 1 : dt);

    const aspect = viewWidth / Math.max(1, viewHeight), [cx, cy, cz] = camPos();
    pulses.forEach((pulse, index) => {
      const age = elapsed - pulse.born, alive = pulse.w > 0 && age < 22;
      const o = index * 4;
      pulseData[o] = age; pulseData[o + 1] = pulse.x; pulseData[o + 2] = pulse.z; pulseData[o + 3] = alive ? pulse.w : 0;
      const dz = pulse.z - cz;
      beaconData[o] = age; beaconData[o + 1] = dz > 1 ? (pulse.x - cx) * F / (dz * aspect) : 0; beaconData[o + 2] = .55; beaconData[o + 3] = alive && dz > 120 ? pulse.beacon : 0;
    });
    void cy;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.depthMask(true);
    gl.clearColor(0, 0, 0, 1); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // sky
    gl.useProgram(sky.program);
    setPalette(sky);
    gl.uniform2f(U(sky, "u_res"), canvas.width, canvas.height); gl.uniform1f(U(sky, "u_time"), simTime);
    gl.uniform1f(U(sky, "u_F"), F); gl.uniform1f(U(sky, "u_horizon"), HORIZON);
    gl.uniform4fv(U(sky, "u_beacon[0]"), beaconData);
    fullscreen(sky);
    // ocean
    const wind = [sea.wind[0], sea.wind[1]];
    const grid = grids[tier];
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
    gl.useProgram(ocean.program);
    setCamera(ocean); setPalette(ocean);
    bindTex(0, gl.TEXTURE_2D_ARRAY, disp[current]); bindTex(1, gl.TEXTURE_2D_ARRAY, deriv); bindTex(2, gl.TEXTURE_2D, foamTex);
    gl.uniform1i(U(ocean, "u_disp"), 0); gl.uniform1i(U(ocean, "u_deriv"), 1); gl.uniform1i(U(ocean, "u_foamTex"), 2);
    gl.uniform4fv(U(ocean, "u_pulse[0]"), pulseData);
    gl.uniform1f(U(ocean, "u_time"), simTime); gl.uniform2f(U(ocean, "u_wind"), wind[0], wind[1]);
    gl.uniform1f(U(ocean, "u_foamAmount"), 1.05 + (energy - .78) * 1.2);
    gl.bindBuffer(gl.ARRAY_BUFFER, grid.vertices);
    const gridLoc = A(ocean, "a_grid"); gl.enableVertexAttribArray(gridLoc); gl.vertexAttribPointer(gridLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, grid.indices);
    gl.drawElements(gl.TRIANGLES, grid.count, gl.UNSIGNED_INT, 0);
    gl.disableVertexAttribArray(gridLoc);
    // spray, depth-tested against the waves but not writing depth
    if (!still()) {
      gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(spray.program);
      setCamera(spray); setPalette(spray);
      gl.uniform1i(U(spray, "u_disp"), 0);
      gl.uniform1f(U(spray, "u_time"), simTime); gl.uniform2f(U(spray, "u_wind"), wind[0], wind[1]);
      gl.uniform3f(U(spray, "u_camVel"), 0, 0, cam.vz);
      gl.uniform1f(U(spray, "u_sprayGain"), .55 + (energy - .78) * .8);
      gl.bindBuffer(gl.ARRAY_BUFFER, sprayIds);
      const idLoc = A(spray, "a_id"); gl.enableVertexAttribArray(idLoc); gl.vertexAttribPointer(idLoc, 1, gl.FLOAT, false, 0, 0);
      // field spray first; the bow spray block is drawn only while a ship sails
      const fieldCount = TIERS[tier].spray;
      gl.uniform1f(U(spray, "u_bowFrom"), 1e9); gl.uniform1f(U(spray, "u_sternFrom"), 1e9);
      gl.drawArrays(gl.POINTS, 0, fieldCount);
      if (ship) {
        // ship spray thins with the quality tier like the field spray, so phones keep their frame rate
        const share = [1, .75, .55][tier] ?? .55;
        gl.uniform1f(U(spray, "u_bowFrom"), TIERS[0].spray); gl.uniform1f(U(spray, "u_sternFrom"), TIERS[0].spray + BOW_SPRAY);
        gl.drawArrays(gl.POINTS, TIERS[0].spray, Math.round(BOW_SPRAY * share));
        gl.drawArrays(gl.POINTS, TIERS[0].spray + BOW_SPRAY, Math.round(STERN_SPRAY * share));
      }
      gl.disableVertexAttribArray(idLoc);
      gl.disable(gl.BLEND); gl.depthMask(true);
    }
    const state = still() ? "still" : "live", tierName = String(tier);
    if (canvas.dataset.state !== state) canvas.dataset.state = state;
    if (canvas.dataset.tier !== tierName) canvas.dataset.tier = tierName;
    if (!still()) frame = requestAnimationFrame(draw);
  }

  function reducedChange() { reducedMotion = reduced.matches; sync(); }
  function sync() { cancelAnimationFrame(frame); frame = 0; last = 0; if (!document.hidden && !disposed && !lost) frame = requestAnimationFrame(draw); }
  function contextLost(event: Event) { event.preventDefault(); lost = true; cancelAnimationFrame(frame); canvas.dataset.state = "unavailable"; onFailure(); }
  function contextRestored() { if (!disposed) onRestore(); }
  canvas.dataset.state = "loading"; canvas.dataset.sea = "ocean";
  addEventListener("pointermove", onPointerMove, { passive: true });
  addEventListener("pointerdown", onPointerDown, { passive: true });
  document.addEventListener("scroll", onScroll, { passive: true, capture: true });
  document.addEventListener("visibilitychange", sync); addEventListener("resize", measureWindow); addEventListener("resize", sync); reduced.addEventListener("change", reducedChange);
  canvas.addEventListener("webglcontextlost", contextLost); canvas.addEventListener("webglcontextrestored", contextRestored);
  sync();

  function dispose() {
    disposed = true; cancelAnimationFrame(frame);
    removeEventListener("pointermove", onPointerMove); removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("scroll", onScroll, { capture: true });
    document.removeEventListener("visibilitychange", sync); removeEventListener("resize", measureWindow); removeEventListener("resize", sync); reduced.removeEventListener("change", reducedChange);
    canvas.removeEventListener("webglcontextlost", contextLost); canvas.removeEventListener("webglcontextrestored", contextRestored);
    framebuffers.forEach(value => gl.deleteFramebuffer(value)); textures.forEach(value => gl.deleteTexture(value));
    buffers.forEach(value => gl.deleteBuffer(value)); programs.forEach(value => gl.deleteProgram(value.program));
    if (vao) gl.deleteVertexArray(vao);
  }

  /** Sea height (m) at a world point from the dominant long waves, as the GPU draws them. */
  function heightAt(x: number, z: number, t: number) {
    let h = 0;
    for (const wave of waves) {
      const ph = wave.w * (t % LOOP), c = Math.cos(ph), s = Math.sin(ph);
      // h(k,t) = a e^{iwt} + b e^{-iwt}; field += 2 Re(h e^{ik.x})
      const re = wave.a[0] * c - wave.a[1] * s + wave.b[0] * c + wave.b[1] * s;
      const im = wave.a[0] * s + wave.a[1] * c - wave.b[0] * s + wave.b[1] * c;
      const q = wave.kx * x + wave.kz * z;
      h += 2 * (re * Math.cos(q) - im * Math.sin(q));
    }
    return h;
  }

  /** The horizon haze as the sea shader shows it (display sRGB), for fogging overlays. */
  function hazeColor(): [number, number, number] {
    const at = (key: typeof PALETTE_KEYS[number]) => Array.from(palette.subarray(PALETTE_KEYS.indexOf(key) * 3, PALETTE_KEYS.indexOf(key) * 3 + 3));
    const horizon = at("horizonCol"), b1 = at("band1"), b2 = at("band2");
    return [0, 1, 2].map(i => {
      const c = (horizon[i] + b1[i] * .55 + b2[i] * .35) * .92 * gain;
      const x = c * (2.51 * c + .03) / (c * (2.43 * c + .59) + .14);
      return Math.pow(Math.min(1, Math.max(0, x)), 1 / 2.2);
    }) as [number, number, number];
  }
  return {
    view() {
      const [x, y, z] = camPos(), v = [.36, .045, 1], l = Math.hypot(...v);
      return { x, y, z, F, horizon: HORIZON, aspect: viewWidth / Math.max(1, viewHeight), haze: hazeColor(), sun: [v[0] / l, v[1] / l, v[2] / l] };
    },
    heightAt(x, z) { return heightAt(x, z, simTime); },
    setShip(pose) { ship = pose; },
    dispose,
    setMood(mood) { paletteTarget.splice(0, paletteTarget.length, ...flatten(paletteFor(mood))); if (still()) sync(); },
    setEnergy(value) { energyTarget = Math.max(.6, Math.min(1.9, value)); if (still()) sync(); },
    sampleSwell(screenX, spread = .12) {
      // the ship sails ~330 m out; one ship unit is ~12.5 m
      const t = simTime, d = 330, aspect = viewWidth / Math.max(1, viewHeight);
      const at = (sx: number, dz: number) => { const p = worldAt(sx, d + dz); return heightAt(p.x, p.z, t) / 12.5; };
      const bow = at(screenX + spread, 0), stern = at(screenX - spread, 0), near = at(screenX, -14), far = at(screenX, 14);
      void aspect;
      return { height: (bow + stern + near + far) / 4 * 1.6, slope: (bow - stern) * 3, cross: (near - far) * 2.4 };
    },
    emit(screenX, strength, beacon = true) {
      if (still() || disposed) return;
      const p = worldAt(Math.max(-.05, Math.min(1.05, screenX)), 300 + random() * 160);
      spawn(p.x, p.z, Math.max(.2, Math.min(1.25, strength)), beacon ? Math.min(1, .45 + strength * .6) : 0);
    },
  };
}
